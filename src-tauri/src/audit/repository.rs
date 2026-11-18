use rusqlite::{params, Connection, OptionalExtension, Result as SqlResult};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

use super::events::{SecurityAuditEvent, SecurityEventFilter, SecurityEventType, SecuritySeverity};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityMetadataRecord {
    pub device_id: String,
    pub public_key_hex: String,
    pub fingerprint: String,
    pub key_version: u32,
    pub created_at: i64,
    pub rotated_at: Option<i64>,
    pub algorithm: String,
    pub storage_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevokedDeviceRecord {
    pub device_id: String,
    pub previous_fingerprint: String,
    pub reason: String,
    pub revoked_at: i64,
}

pub struct SecurityRepository {
    conn: Mutex<Connection>,
}

impl SecurityRepository {
    pub fn new(db_path: &str) -> SqlResult<Self> {
        let conn = Connection::open(db_path)?;
        let repo = Self {
            conn: Mutex::new(conn),
        };
        repo.initialize_schema()?;
        Ok(repo)
    }

    pub fn new_in_memory() -> SqlResult<Self> {
        let conn = Connection::open_in_memory()?;
        let repo = Self {
            conn: Mutex::new(conn),
        };
        repo.initialize_schema()?;
        Ok(repo)
    }

    fn initialize_schema(&self) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            "
            PRAGMA journal_mode = WAL;
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS security_audit_logs (
                event_id TEXT PRIMARY KEY,
                event_type TEXT NOT NULL,
                severity TEXT NOT NULL,
                device_id TEXT,
                device_name TEXT,
                summary TEXT NOT NULL,
                details TEXT,
                timestamp INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_audit_timestamp
                ON security_audit_logs (timestamp DESC);
            CREATE INDEX IF NOT EXISTS idx_audit_type
                ON security_audit_logs (event_type);

            CREATE TABLE IF NOT EXISTS identity_metadata (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                device_id TEXT NOT NULL,
                public_key_hex TEXT NOT NULL,
                fingerprint TEXT NOT NULL,
                key_version INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                rotated_at INTEGER,
                algorithm TEXT NOT NULL,
                storage_mode TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS security_settings (
                key TEXT PRIMARY KEY,
                value_json TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS revoked_devices (
                device_id TEXT PRIMARY KEY,
                previous_fingerprint TEXT NOT NULL,
                reason TEXT NOT NULL,
                revoked_at INTEGER NOT NULL
            );
            ",
        )?;

        conn.execute(
            "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (1, ?1)",
            params![chrono::Utc::now().timestamp_millis()],
        )?;

        Ok(())
    }

    pub fn insert_audit_event(&self, event: &SecurityAuditEvent) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO security_audit_logs (
                event_id, event_type, severity, device_id, device_name, summary, details, timestamp
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                event.event_id,
                event.event_type.as_str(),
                event.severity.as_str(),
                event.device_id,
                event.device_name,
                event.summary,
                event.details,
                event.timestamp,
            ],
        )
        .map_err(|e| format!("Failed to insert audit event: {}", e))?;
        Ok(())
    }

    pub fn get_audit_events(&self, limit: usize) -> Result<Vec<SecurityAuditEvent>, String> {
        self.search_audit_events(&SecurityEventFilter {
            limit: Some(limit),
            ..Default::default()
        })
    }

    pub fn search_audit_events(
        &self,
        filter: &SecurityEventFilter,
    ) -> Result<Vec<SecurityAuditEvent>, String> {
        let conn = self.conn.lock().unwrap();
        let limit = filter.limit.unwrap_or(200).min(1000) as i64;

        let mut stmt = conn
            .prepare(
                "SELECT event_id, event_type, severity, device_id, device_name, summary, details, timestamp
                 FROM security_audit_logs
                 ORDER BY timestamp DESC
                 LIMIT ?1",
            )
            .map_err(|e| format!("Failed to query audit log: {}", e))?;

        let rows = stmt
            .query_map(params![limit], |row| {
                let event_type_str: String = row.get(1)?;
                let severity_str: String = row.get(2)?;
                Ok(SecurityAuditEvent {
                    event_id: row.get(0)?,
                    event_type: SecurityEventType::from_str_lossy(&event_type_str),
                    severity: SecuritySeverity::from_str_lossy(&severity_str),
                    device_id: row.get(3)?,
                    device_name: row.get(4)?,
                    summary: row.get(5)?,
                    details: row.get(6)?,
                    timestamp: row.get(7)?,
                })
            })
            .map_err(|e| format!("Audit log iteration error: {}", e))?;

        let q = filter.query.as_ref().map(|s| s.to_lowercase());
        let mut results = Vec::new();

        for row in rows {
            let ev = match row {
                Ok(v) => v,
                Err(_) => continue,
            };

            if let Some(ref et) = filter.event_type {
                if !et.is_empty() && et != "all" && ev.event_type.as_str() != et {
                    continue;
                }
            }
            if let Some(ref sev) = filter.severity {
                if !sev.is_empty() && sev != "all" && ev.severity.as_str() != sev {
                    continue;
                }
            }
            if let Some(ref dev) = filter.device_id {
                if !dev.is_empty() && ev.device_id.as_deref() != Some(dev.as_str()) {
                    continue;
                }
            }
            if let Some(ref query) = q {
                if !query.is_empty() {
                    let hay = format!(
                        "{} {} {} {} {}",
                        ev.event_type.as_str(),
                        ev.device_id.as_deref().unwrap_or(""),
                        ev.device_name.as_deref().unwrap_or(""),
                        ev.summary,
                        ev.details.as_deref().unwrap_or("")
                    )
                    .to_lowercase();
                    if !hay.contains(query) {
                        continue;
                    }
                }
            }

            results.push(ev);
        }

        Ok(results)
    }

    pub fn clear_audit_events(&self) -> Result<usize, String> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM security_audit_logs", [])
            .map_err(|e| format!("Failed to clear audit log: {}", e))
    }

    pub fn load_identity_metadata(&self) -> Result<Option<IdentityMetadataRecord>, String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT device_id, public_key_hex, fingerprint, key_version, created_at, rotated_at, algorithm, storage_mode
             FROM identity_metadata WHERE id = 1",
            [],
            |row| {
                Ok(IdentityMetadataRecord {
                    device_id: row.get(0)?,
                    public_key_hex: row.get(1)?,
                    fingerprint: row.get(2)?,
                    key_version: row.get(3)?,
                    created_at: row.get(4)?,
                    rotated_at: row.get(5)?,
                    algorithm: row.get(6)?,
                    storage_mode: row.get(7)?,
                })
            },
        )
        .optional()
        .map_err(|e| format!("Failed to load identity metadata: {}", e))
    }

    pub fn save_identity_metadata(&self, meta: &IdentityMetadataRecord) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO identity_metadata (
                id, device_id, public_key_hex, fingerprint, key_version,
                created_at, rotated_at, algorithm, storage_mode
            ) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                meta.device_id,
                meta.public_key_hex,
                meta.fingerprint,
                meta.key_version,
                meta.created_at,
                meta.rotated_at,
                meta.algorithm,
                meta.storage_mode,
            ],
        )
        .map_err(|e| format!("Failed to save identity metadata: {}", e))?;
        Ok(())
    }

    pub fn get_setting_json(&self, key: &str) -> Result<Option<String>, String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT value_json FROM security_settings WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("Failed to read security setting '{}': {}", key, e))
    }

    pub fn set_setting_json(&self, key: &str, value_json: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO security_settings (key, value_json, updated_at)
             VALUES (?1, ?2, ?3)",
            params![key, value_json, chrono::Utc::now().timestamp_millis()],
        )
        .map_err(|e| format!("Failed to save security setting '{}': {}", key, e))?;
        Ok(())
    }

    pub fn record_revoked_device(&self, record: &RevokedDeviceRecord) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO revoked_devices (device_id, previous_fingerprint, reason, revoked_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![
                record.device_id,
                record.previous_fingerprint,
                record.reason,
                record.revoked_at,
            ],
        )
        .map_err(|e| format!("Failed to save revoked device: {}", e))?;
        Ok(())
    }

    pub fn clear_revoked_device(&self, device_id: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM revoked_devices WHERE device_id = ?1",
            params![device_id],
        )
        .map_err(|e| format!("Failed to clear revoked status: {}", e))?;
        Ok(())
    }

    pub fn is_device_revoked(&self, device_id: &str) -> bool {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT 1 FROM revoked_devices WHERE device_id = ?1",
            params![device_id],
            |_| Ok(true),
        )
        .optional()
        .ok()
        .flatten()
        .unwrap_or(false)
    }

    pub fn get_revoked_devices(&self) -> Result<Vec<RevokedDeviceRecord>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT device_id, previous_fingerprint, reason, revoked_at
                 FROM revoked_devices ORDER BY revoked_at DESC",
            )
            .map_err(|e| format!("Failed to query revoked devices: {}", e))?;
        let rows = stmt
            .query_map([], |row| {
                Ok(RevokedDeviceRecord {
                    device_id: row.get(0)?,
                    previous_fingerprint: row.get(1)?,
                    reason: row.get(2)?,
                    revoked_at: row.get(3)?,
                })
            })
            .map_err(|e| format!("Revoked device query failed: {}", e))?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }
}
