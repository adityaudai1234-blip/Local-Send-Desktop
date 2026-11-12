use rusqlite::{params, Connection};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use super::metadata::{TransferDirection, TransferFileItem, TransferSession, TransferStatus};
use super::progress::TransferProgressEvent;
use super::queue::TransferQueue;
use super::receiver::FileReceiver;
use super::sender::FileSender;
use crate::file_system::selection::SelectedFile;
use crate::file_system::storage::get_download_directory;
use crate::networking::ConnectionManager;
use crate::protocol::messages::{MessageType, ProtocolMessage, TransferAcceptedPayload, TransferRejectedPayload};

pub struct TransferManager {
    pub active_sessions: Arc<Mutex<HashMap<String, TransferSession>>>,
    pub pending_requests: Arc<Mutex<HashMap<String, TransferSession>>>,
    pub selected_files: Arc<Mutex<Vec<SelectedFile>>>,
    pub cancellation_tokens: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    pub pause_tokens: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    pub queue: Arc<TransferQueue>,
    pub receiver: Arc<FileReceiver>,
    pub sender: Arc<FileSender>,
    pub db: Mutex<Connection>,
    app_handle: Arc<Mutex<Option<AppHandle>>>,
}

impl TransferManager {
    pub fn new(connection_manager: Arc<ConnectionManager>) -> Self {
        let db_path = "beamdrop_transfers.sqlite";
        let conn = Connection::open(db_path).unwrap_or_else(|_| Connection::open_in_memory().unwrap());

        let _ = conn.execute(
            "CREATE TABLE IF NOT EXISTS transfer_history (
                transfer_id TEXT PRIMARY KEY,
                direction TEXT NOT NULL,
                sender_id TEXT NOT NULL,
                sender_name TEXT NOT NULL,
                recipient_id TEXT NOT NULL,
                recipient_name TEXT NOT NULL,
                file_count INTEGER NOT NULL,
                total_bytes INTEGER NOT NULL,
                status TEXT NOT NULL,
                started_at INTEGER NOT NULL,
                completed_at INTEGER,
                error_message TEXT
            )",
            [],
        );

        let receiver = Arc::new(FileReceiver::new());
        let sender = Arc::new(FileSender::new(connection_manager));

        Self {
            active_sessions: Arc::new(Mutex::new(HashMap::new())),
            pending_requests: Arc::new(Mutex::new(HashMap::new())),
            selected_files: Arc::new(Mutex::new(Vec::new())),
            cancellation_tokens: Arc::new(Mutex::new(HashMap::new())),
            pause_tokens: Arc::new(Mutex::new(HashMap::new())),
            queue: Arc::new(TransferQueue::new()),
            receiver,
            sender,
            db: Mutex::new(conn),
            app_handle: Arc::new(Mutex::new(None)),
        }
    }

    pub fn set_app_handle(&self, handle: AppHandle) {
        let mut lock = self.app_handle.lock().unwrap();
        *lock = Some(handle);
    }

    fn emit_event<T: serde::Serialize + Clone>(&self, event_name: &str, payload: T) {
        if let Some(ref handle) = *self.app_handle.lock().unwrap() {
            let _ = handle.emit(event_name, payload);
        }
    }

    // --- File Selection ---

    pub fn add_selected_files(&self, file_paths: Vec<String>) -> Result<Vec<SelectedFile>, String> {
        let mut added = Vec::new();
        let mut lock = self.selected_files.lock().unwrap();

        for path in file_paths {
            match SelectedFile::from_path(&path) {
                Ok(item) => {
                    // Prevent duplicates
                    if !lock.iter().any(|f| f.path == item.path) {
                        lock.push(item.clone());
                        added.push(item);
                    }
                }
                Err(e) => return Err(e),
            }
        }

        Ok(lock.clone())
    }

    pub fn get_selected_files(&self) -> Vec<SelectedFile> {
        self.selected_files.lock().unwrap().clone()
    }

    pub fn remove_selected_file(&self, file_id: &str) -> Vec<SelectedFile> {
        let mut lock = self.selected_files.lock().unwrap();
        lock.retain(|f| f.id != file_id);
        lock.clone()
    }

    pub fn clear_selected_files(&self) {
        let mut lock = self.selected_files.lock().unwrap();
        lock.clear();
    }

    // --- Outgoing Transfers ---

    pub async fn start_file_transfer(
        &self,
        sender_id: String,
        sender_name: String,
        sender_platform: String,
        recipient_id: String,
        recipient_name: String,
        recipient_ip: String,
        recipient_port: u16,
        file_ids: Option<Vec<String>>,
    ) -> Result<TransferSession, String> {
        let selected = self.get_selected_files();
        let files_to_send: Vec<SelectedFile> = match file_ids {
            Some(ids) => selected.into_iter().filter(|f| ids.contains(&f.id)).collect(),
            None => selected,
        };

        if files_to_send.is_empty() {
            return Err("No files selected for transfer".to_string());
        }

        let transfer_id = Uuid::new_v4().to_string();
        let total_bytes: u64 = files_to_send.iter().map(|f| f.size).sum();

        let transfer_files: Vec<TransferFileItem> = files_to_send
            .into_iter()
            .map(|f| TransferFileItem {
                file_id: f.id,
                name: f.name,
                size: f.size,
                mime_type: f.mime_type,
                path: Some(f.path),
                sha256_checksum: None,
                is_verified: false,
                bytes_transferred: 0,
                status: TransferStatus::WaitingForApproval,
            })
            .collect();

        let session = TransferSession {
            transfer_id: transfer_id.clone(),
            direction: TransferDirection::Outgoing,
            sender_device_id: sender_id,
            sender_device_name: sender_name,
            sender_platform,
            recipient_device_id: recipient_id,
            recipient_device_name: recipient_name,
            recipient_ip,
            recipient_port,
            files: transfer_files,
            total_bytes,
            bytes_transferred: 0,
            speed_bytes_per_sec: 0,
            estimated_seconds_remaining: None,
            status: TransferStatus::WaitingForApproval,
            error_message: None,
            started_at: chrono::Utc::now().timestamp_millis(),
            completed_at: None,
            destination_directory: None,
        };

        // Record session
        {
            let mut lock = self.active_sessions.lock().unwrap();
            lock.insert(transfer_id.clone(), session.clone());
        }

        // Initialize cancellation and pause tokens
        {
            let mut c_lock = self.cancellation_tokens.lock().unwrap();
            c_lock.insert(transfer_id.clone(), Arc::new(AtomicBool::new(false)));
            let mut p_lock = self.pause_tokens.lock().unwrap();
            p_lock.insert(transfer_id.clone(), Arc::new(AtomicBool::new(false)));
        }

        // Send initial proposal to peer
        self.sender.send_transfer_request(&session).await?;

        self.emit_event("transfer-updated", session.clone());

        Ok(session)
    }

    // --- Peer Acceptance / Rejection ---

    pub async fn handle_peer_accepted(&self, transfer_id: &str) -> Result<(), String> {
        let mut session = {
            let mut lock = self.active_sessions.lock().unwrap();
            let mut s = lock
                .get_mut(transfer_id)
                .ok_or_else(|| format!("Session {} not found", transfer_id))?;
            s.status = TransferStatus::Transferring;
            s.clone()
        };

        self.emit_event("transfer-accepted", session.clone());

        // Spawn async background streaming task
        let sender = self.sender.clone();
        let active_sessions = self.active_sessions.clone();
        let app_handle_opt = self.app_handle.clone();
        let db_lock = Mutex::new(Connection::open("beamdrop_transfers.sqlite").unwrap_or_else(|_| Connection::open_in_memory().unwrap()));

        let is_cancelled = {
            let lock = self.cancellation_tokens.lock().unwrap();
            lock.get(transfer_id).cloned().unwrap_or_else(|| Arc::new(AtomicBool::new(false)))
        };

        let is_paused = {
            let lock = self.pause_tokens.lock().unwrap();
            lock.get(transfer_id).cloned().unwrap_or_else(|| Arc::new(AtomicBool::new(false)))
        };

        let tx_id = transfer_id.to_string();

        tokio::spawn(async move {
            let handle_clone = app_handle_opt.clone();
            let res = sender
                .stream_session_files(&mut session, is_cancelled, is_paused, move |progress| {
                    if let Some(ref handle) = *handle_clone.lock().unwrap() {
                        let _ = handle.emit("transfer-progress", progress);
                    }
                })
                .await;

            let mut lock = active_sessions.lock().unwrap();
            if let Some(s) = lock.get_mut(&tx_id) {
                match res {
                    Ok(_) => {
                        s.status = TransferStatus::Completed;
                        s.completed_at = Some(chrono::Utc::now().timestamp_millis());
                        if let Some(ref handle) = *app_handle_opt.lock().unwrap() {
                            let _ = handle.emit("transfer-completed", s.clone());
                        }
                    }
                    Err(err) => {
                        s.status = TransferStatus::Failed;
                        s.error_message = Some(err.clone());
                        if let Some(ref handle) = *app_handle_opt.lock().unwrap() {
                            let _ = handle.emit("transfer-failed", serde_json::json!({ "transferId": tx_id, "error": err }));
                        }
                    }
                }

                // Persist into SQLite
                let _ = db_lock.lock().unwrap().execute(
                    "INSERT OR REPLACE INTO transfer_history VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                    params![
                        s.transfer_id,
                        match s.direction { TransferDirection::Incoming => "incoming", TransferDirection::Outgoing => "outgoing" },
                        s.sender_device_id,
                        s.sender_device_name,
                        s.recipient_device_id,
                        s.recipient_device_name,
                        s.files.len() as i64,
                        s.total_bytes as i64,
                        format!("{:?}", s.status).to_lowercase(),
                        s.started_at,
                        s.completed_at,
                        s.error_message
                    ],
                );
            }
        });

        Ok(())
    }

    pub fn handle_peer_rejected(&self, transfer_id: &str, reason: &str) {
        let mut lock = self.active_sessions.lock().unwrap();
        if let Some(s) = lock.get_mut(transfer_id) {
            s.status = TransferStatus::Cancelled;
            s.error_message = Some(format!("Declined: {}", reason));
            self.emit_event("transfer-rejected", s.clone());
        }
    }

    // --- Incoming Transfers Approval ---

    pub fn register_incoming_request(&self, session: TransferSession) {
        let mut lock = self.pending_requests.lock().unwrap();
        lock.insert(session.transfer_id.clone(), session.clone());
        self.emit_event("incoming-transfer-request", session);
    }

    pub async fn accept_transfer(&self, transfer_id: &str) -> Result<TransferSession, String> {
        let mut session = {
            let mut lock = self.pending_requests.lock().unwrap();
            lock.remove(transfer_id)
                .ok_or_else(|| format!("Pending transfer {} not found", transfer_id))?
        };

        session.status = TransferStatus::Transferring;
        session.destination_directory = Some(get_download_directory().to_string_lossy().to_string());

        // Prepare active reception slots for all files
        for f in &session.files {
            self.receiver
                .prepare_file_reception(&session.transfer_id, f)
                .await?;
        }

        {
            let mut lock = self.active_sessions.lock().unwrap();
            lock.insert(transfer_id.to_string(), session.clone());
        }

        // Send accept packet back to sender
        let accepted_payload = TransferAcceptedPayload {
            transfer_id: transfer_id.to_string(),
            accepted_file_ids: session.files.iter().map(|f| f.file_id.clone()).collect(),
            max_chunk_size: 65536,
        };

        let msg = ProtocolMessage::new(
            session.recipient_device_id.clone(),
            session.sender_device_id.clone(),
            MessageType::TransferAccepted,
            serde_json::to_value(accepted_payload).unwrap(),
        );

        let _ = self
            .sender
            .connection_manager
            .send_protocol_message(&session.sender_device_id, &msg)
            .await;

        self.emit_event("transfer-updated", session.clone());

        Ok(session)
    }

    pub async fn reject_transfer(&self, transfer_id: &str, reason: &str) -> Result<(), String> {
        let session_opt = {
            let mut lock = self.pending_requests.lock().unwrap();
            lock.remove(transfer_id)
        };

        if let Some(session) = session_opt {
            let rej_payload = TransferRejectedPayload {
                transfer_id: transfer_id.to_string(),
                reason: reason.to_string(),
                message: "User declined incoming transfer.".to_string(),
            };

            let msg = ProtocolMessage::new(
                session.recipient_device_id.clone(),
                session.sender_device_id.clone(),
                MessageType::TransferRejected,
                serde_json::to_value(rej_payload).unwrap(),
            );

            let _ = self
                .sender
                .connection_manager
                .send_protocol_message(&session.sender_device_id, &msg)
                .await;

            self.emit_event("transfer-rejected", serde_json::json!({ "transferId": transfer_id, "reason": reason }));
        }

        Ok(())
    }

    // --- Controls: Pause / Resume / Cancel ---

    pub fn pause_transfer(&self, transfer_id: &str) -> Result<(), String> {
        let mut lock = self.active_sessions.lock().unwrap();
        let s = lock
            .get_mut(transfer_id)
            .ok_or_else(|| format!("Active transfer {} not found", transfer_id))?;

        s.status = TransferStatus::Paused;
        s.speed_bytes_per_sec = 0;

        if let Some(token) = self.pause_tokens.lock().unwrap().get(transfer_id) {
            token.store(true, Ordering::SeqCst);
        }

        self.emit_event("transfer-updated", s.clone());
        Ok(())
    }

    pub fn resume_transfer(&self, transfer_id: &str) -> Result<(), String> {
        let mut lock = self.active_sessions.lock().unwrap();
        let s = lock
            .get_mut(transfer_id)
            .ok_or_else(|| format!("Active transfer {} not found", transfer_id))?;

        s.status = TransferStatus::Transferring;

        if let Some(token) = self.pause_tokens.lock().unwrap().get(transfer_id) {
            token.store(false, Ordering::SeqCst);
        }

        self.emit_event("transfer-updated", s.clone());
        Ok(())
    }

    pub fn cancel_transfer(&self, transfer_id: &str) -> Result<(), String> {
        if let Some(token) = self.cancellation_tokens.lock().unwrap().get(transfer_id) {
            token.store(true, Ordering::SeqCst);
        }

        let mut lock = self.active_sessions.lock().unwrap();
        if let Some(s) = lock.get_mut(transfer_id) {
            s.status = TransferStatus::Cancelled;
            s.speed_bytes_per_sec = 0;
            self.emit_event("transfer-cancelled", s.clone());
        }

        Ok(())
    }

    pub fn cancel_transfer_batch(&self) -> usize {
        let lock = self.active_sessions.lock().unwrap();
        let ids: Vec<String> = lock.keys().cloned().collect();
        drop(lock);

        let mut count = 0;
        for id in ids {
            if self.cancel_transfer(&id).is_ok() {
                count += 1;
            }
        }
        count
    }

    // --- Query APIs ---

    pub fn get_active_transfers(&self) -> Vec<TransferSession> {
        let lock = self.active_sessions.lock().unwrap();
        lock.values().cloned().collect()
    }

    pub fn get_transfer_details(&self, transfer_id: &str) -> Option<TransferSession> {
        let lock = self.active_sessions.lock().unwrap();
        lock.get(transfer_id).cloned()
    }
}
