use rusqlite::{params, Connection};
use std::sync::Mutex;

use super::database::init_database;
use super::filters::HistoryFilterOptions;
use super::statistics::{calculate_statistics, TransferStatistics};
use crate::transfers::metadata::{TransferDirection, TransferFileItem, TransferSession, TransferStatus};
use crate::transfers::priority::TransferPriority;

pub struct HistoryRepository {
    conn: Mutex<Connection>,
}

impl HistoryRepository {
    pub fn new(db_path: &str) -> Result<Self, String> {
        let conn = Connection::open(db_path).map_err(|e| format!("Failed to open database: {}", e))?;
        init_database(&conn).map_err(|e| format!("Failed to initialize database: {}", e))?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn new_in_memory() -> Result<Self, String> {
        let conn = Connection::open_in_memory().map_err(|e| format!("Failed to open in-memory database: {}", e))?;
        init_database(&conn).map_err(|e| format!("Failed to initialize in-memory database: {}", e))?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Records or updates a full TransferSession into the persistent SQLite database
    pub fn save_session(&self, session: &TransferSession) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;

        let dir_str = match session.direction {
            TransferDirection::Incoming => "incoming",
            TransferDirection::Outgoing => "outgoing",
        };

        let status_str = match session.status {
            TransferStatus::WaitingForApproval => "waiting_for_approval",
            TransferStatus::Preparing => "preparing",
            TransferStatus::Connecting => "connecting",
            TransferStatus::Transferring => "transferring",
            TransferStatus::Verifying => "verifying",
            TransferStatus::Completed => "completed",
            TransferStatus::Failed => "failed",
            TransferStatus::Cancelled => "cancelled",
            TransferStatus::Paused => "paused",
            TransferStatus::Queued => "queued",
        };

        let root_name = session
            .root_folder_name
            .clone()
            .unwrap_or_else(|| session.files.first().map(|f| f.name.clone()).unwrap_or_else(|| "unnamed_transfer".to_string()));

        // Upsert into transfers table
        conn.execute(
            "INSERT INTO transfers (
                transfer_id, direction, sender_id, sender_name, recipient_id, recipient_name,
                recipient_ip, total_bytes, bytes_transferred, speed_bps, status, priority,
                is_folder, root_name, file_count, started_at, completed_at, error_message, destination_directory
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)
            ON CONFLICT(transfer_id) DO UPDATE SET
                bytes_transferred = excluded.bytes_transferred,
                speed_bps = excluded.speed_bps,
                status = excluded.status,
                completed_at = excluded.completed_at,
                error_message = excluded.error_message,
                destination_directory = excluded.destination_directory",
            params![
                session.transfer_id,
                dir_str,
                session.sender_device_id,
                session.sender_device_name,
                session.recipient_device_id,
                session.recipient_device_name,
                session.recipient_ip,
                session.total_bytes as i64,
                session.bytes_transferred as i64,
                session.speed_bytes_per_sec as i64,
                status_str,
                session.priority.to_i32(),
                if session.is_folder { 1 } else { 0 },
                root_name,
                session.files.len() as i64,
                session.started_at,
                session.completed_at,
                session.error_message,
                session.destination_directory
            ],
        )
        .map_err(|e| format!("Failed to insert transfer: {}", e))?;

        // Replace files for this transfer
        let _ = conn.execute("DELETE FROM transfer_files WHERE transfer_id = ?1", params![session.transfer_id]);

        let mut file_stmt = conn
            .prepare(
                "INSERT INTO transfer_files (
                    transfer_id, file_id, file_name, relative_path, file_size, mime_type,
                    bytes_transferred, status, sha256_checksum, is_verified
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            )
            .map_err(|e| e.to_string())?;

        for f in &session.files {
            let f_status_str = match f.status {
                TransferStatus::Completed => "completed",
                TransferStatus::Failed => "failed",
                TransferStatus::Cancelled => "cancelled",
                TransferStatus::Paused => "paused",
                _ => "transferring",
            };

            file_stmt
                .execute(params![
                    session.transfer_id,
                    f.file_id,
                    f.name,
                    f.relative_path,
                    f.size as i64,
                    f.mime_type,
                    f.bytes_transferred as i64,
                    f_status_str,
                    f.sha256_checksum,
                    if f.is_verified { 1 } else { 0 }
                ])
                .map_err(|e| format!("Failed to insert transfer file {}: {}", f.name, e))?;
        }

        Ok(())
    }

    /// Queries transfer history with filtering, searching, and sorting
    pub fn query_history(&self, options: &HistoryFilterOptions) -> Result<Vec<TransferSession>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;

        let mut conditions = Vec::new();
        let mut query_params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        if let Some(ref dir) = options.direction {
            if dir != "all" {
                conditions.push("direction = ?");
                query_params.push(Box::new(dir.clone()));
            }
        }

        if let Some(ref st) = options.status {
            if st != "all" {
                if st == "active" {
                    conditions.push("status IN ('transferring', 'preparing', 'connecting', 'waiting_for_approval', 'paused', 'queued')");
                } else {
                    conditions.push("status = ?");
                    query_params.push(Box::new(st.clone()));
                }
            }
        }

        if let Some(ref search) = options.search_query {
            let s = search.trim();
            if !s.is_empty() {
                let pattern = format!("%{}%", s);
                conditions.push("(root_name LIKE ? OR sender_name LIKE ? OR recipient_name LIKE ? OR transfer_id LIKE ?)");
                query_params.push(Box::new(pattern.clone()));
                query_params.push(Box::new(pattern.clone()));
                query_params.push(Box::new(pattern.clone()));
                query_params.push(Box::new(pattern));
            }
        }

        let where_clause = if conditions.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", conditions.join(" AND "))
        };

        let order_clause = match options.sort_by.as_deref() {
            Some("oldest") => "ORDER BY started_at ASC",
            Some("largest") => "ORDER BY total_bytes DESC",
            Some("smallest") => "ORDER BY total_bytes ASC",
            Some("success") => "ORDER BY (status = 'completed') DESC, started_at DESC",
            Some("failed") => "ORDER BY (status = 'failed') DESC, started_at DESC",
            _ => "ORDER BY started_at DESC",
        };

        let limit = options.limit.unwrap_or(100);
        let offset = options.offset.unwrap_or(0);

        let sql = format!(
            "SELECT 
                transfer_id, direction, sender_id, sender_name, recipient_id, recipient_name,
                recipient_ip, total_bytes, bytes_transferred, speed_bps, status, priority,
                is_folder, root_name, file_count, started_at, completed_at, error_message, destination_directory
             FROM transfers
             {}
             {}
             LIMIT {} OFFSET {}",
            where_clause, order_clause, limit, offset
        );

        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

        let param_refs: Vec<&dyn rusqlite::ToSql> = query_params.iter().map(|b| b.as_ref()).collect();

        let session_rows = stmt
            .query_map(param_refs.as_slice(), |row| {
                let tx_id: String = row.get(0)?;
                let dir_str: String = row.get(1)?;
                let sender_id: String = row.get(2)?;
                let sender_name: String = row.get(3)?;
                let recipient_id: String = row.get(4)?;
                let recipient_name: String = row.get(5)?;
                let recipient_ip: String = row.get::<_, Option<String>>(6)?.unwrap_or_else(|| "127.0.0.1".to_string());
                let total_bytes: i64 = row.get(7)?;
                let bytes_transferred: i64 = row.get(8)?;
                let speed_bps: i64 = row.get(9)?;
                let status_str: String = row.get(10)?;
                let priority_num: i32 = row.get(11)?;
                let is_folder: i32 = row.get(12)?;
                let root_name: String = row.get(13)?;
                let _file_count: i64 = row.get(14)?;
                let started_at: i64 = row.get(15)?;
                let completed_at: Option<i64> = row.get(16)?;
                let error_message: Option<String> = row.get(17)?;
                let destination_directory: Option<String> = row.get(18)?;

                let direction = match dir_str.as_str() {
                    "incoming" => TransferDirection::Incoming,
                    _ => TransferDirection::Outgoing,
                };

                let status = match status_str.as_str() {
                    "completed" => TransferStatus::Completed,
                    "failed" => TransferStatus::Failed,
                    "cancelled" => TransferStatus::Cancelled,
                    "paused" => TransferStatus::Paused,
                    "queued" => TransferStatus::Queued,
                    _ => TransferStatus::Transferring,
                };

                Ok(TransferSession {
                    transfer_id: tx_id,
                    direction,
                    sender_device_id: sender_id,
                    sender_device_name: sender_name,
                    sender_platform: "desktop".to_string(),
                    recipient_device_id: recipient_id,
                    recipient_device_name: recipient_name,
                    recipient_ip,
                    recipient_port: 53317,
                    files: Vec::new(), // will hydrate below
                    total_bytes: total_bytes as u64,
                    bytes_transferred: bytes_transferred as u64,
                    speed_bytes_per_sec: speed_bps as u64,
                    estimated_seconds_remaining: None,
                    status,
                    priority: TransferPriority::from_i32(priority_num),
                    is_folder: is_folder == 1,
                    root_folder_name: Some(root_name),
                    error_message,
                    started_at,
                    completed_at,
                    destination_directory,
                })
            })
            .map_err(|e| e.to_string())?;

        let mut results = Vec::new();
        for s in session_rows.flatten() {
            results.push(s);
        }

        // Hydrate files for each retrieved session
        let mut file_stmt = conn
            .prepare(
                "SELECT file_id, file_name, relative_path, file_size, mime_type, bytes_transferred, status, sha256_checksum, is_verified
                 FROM transfer_files
                 WHERE transfer_id = ?1",
            )
            .map_err(|e| e.to_string())?;

        for session in &mut results {
            let files_iter = file_stmt
                .query_map([&session.transfer_id], |row| {
                    let file_id: String = row.get(0)?;
                    let name: String = row.get(1)?;
                    let relative_path: Option<String> = row.get(2)?;
                    let size: i64 = row.get(3)?;
                    let mime_type: String = row.get(4)?;
                    let bytes: i64 = row.get(5)?;
                    let st: String = row.get(6)?;
                    let sha: Option<String> = row.get(7)?;
                    let is_v: i32 = row.get(8)?;

                    let status = match st.as_str() {
                        "completed" => TransferStatus::Completed,
                        "failed" => TransferStatus::Failed,
                        "cancelled" => TransferStatus::Cancelled,
                        _ => TransferStatus::Transferring,
                    };

                    Ok(TransferFileItem {
                        file_id,
                        name,
                        size: size as u64,
                        mime_type,
                        path: None,
                        relative_path,
                        is_directory: false,
                        sha256_checksum: sha,
                        is_verified: is_v == 1,
                        bytes_transferred: bytes as u64,
                        status,
                    })
                })
                .map_err(|e| e.to_string())?;

            for f in files_iter.flatten() {
                session.files.push(f);
            }
        }

        Ok(results)
    }

    /// Retrieves complete details for a single transfer session
    pub fn get_transfer_details(&self, transfer_id: &str) -> Result<Option<TransferSession>, String> {
        let options = HistoryFilterOptions {
            direction: None,
            status: None,
            search_query: Some(transfer_id.to_string()),
            sort_by: None,
            limit: Some(1),
            offset: None,
        };

        let list = self.query_history(&options)?;
        Ok(list.into_iter().find(|s| s.transfer_id == transfer_id))
    }

    /// Deletes a transfer record from SQLite history.
    /// Crucially: does NOT touch or delete received files on the filesystem!
    pub fn delete_history_entry(&self, transfer_id: &str) -> Result<bool, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let count = conn
            .execute("DELETE FROM transfers WHERE transfer_id = ?1", params![transfer_id])
            .map_err(|e| e.to_string())?;
        Ok(count > 0)
    }

    /// Clears all historical transfer records from SQLite
    pub fn clear_history(&self) -> Result<usize, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let count = conn
            .execute("DELETE FROM transfers", [])
            .map_err(|e| e.to_string())?;
        Ok(count)
    }

    /// Calculates live real statistics
    pub fn get_statistics(&self, time_frame: &str) -> Result<TransferStatistics, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        calculate_statistics(&conn, time_frame)
    }
}
