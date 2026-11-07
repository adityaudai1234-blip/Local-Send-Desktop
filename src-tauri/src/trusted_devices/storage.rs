use rusqlite::{params, Connection, Result as SqlResult};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use crate::models::Platform;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustedDevice {
    pub device_id: String,
    pub name: String,
    pub platform: Platform,
    pub device_model: String,
    pub ip_address: String,
    pub port: u16,
    pub public_key: String,
    pub fingerprint: String,
    pub auth_token_hash: String,
    pub first_paired_at: i64,
    pub last_connected_at: i64,
    pub is_online: bool,
    pub trust_status: String,
}

pub struct DeviceStorage {
    conn: Mutex<Connection>,
}

impl DeviceStorage {
    pub fn new(db_path: &str) -> SqlResult<Self> {
        let conn = Connection::open(db_path)?;
        conn.execute(
            "CREATE TABLE IF NOT EXISTS trusted_devices (
                device_id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                platform TEXT NOT NULL,
                device_model TEXT NOT NULL,
                ip_address TEXT NOT NULL,
                port INTEGER NOT NULL,
                public_key TEXT NOT NULL,
                fingerprint TEXT NOT NULL,
                auth_token_hash TEXT NOT NULL,
                first_paired_at INTEGER NOT NULL,
                last_connected_at INTEGER NOT NULL,
                trust_status TEXT NOT NULL
            )",
            [],
        )?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn new_in_memory() -> SqlResult<Self> {
        let conn = Connection::open_in_memory()?;
        conn.execute(
            "CREATE TABLE IF NOT EXISTS trusted_devices (
                device_id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                platform TEXT NOT NULL,
                device_model TEXT NOT NULL,
                ip_address TEXT NOT NULL,
                port INTEGER NOT NULL,
                public_key TEXT NOT NULL,
                fingerprint TEXT NOT NULL,
                auth_token_hash TEXT NOT NULL,
                first_paired_at INTEGER NOT NULL,
                last_connected_at INTEGER NOT NULL,
                trust_status TEXT NOT NULL
            )",
            [],
        )?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn save_trusted_device(&self, device: &TrustedDevice) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        let platform_str = serde_json::to_string(&device.platform).unwrap_or_default().trim_matches('"').to_string();

        conn.execute(
            "INSERT OR REPLACE INTO trusted_devices (
                device_id, name, platform, device_model, ip_address, port,
                public_key, fingerprint, auth_token_hash, first_paired_at,
                last_connected_at, trust_status
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                device.device_id,
                device.name,
                platform_str,
                device.device_model,
                device.ip_address,
                device.port,
                device.public_key,
                device.fingerprint,
                device.auth_token_hash,
                device.first_paired_at,
                device.last_connected_at,
                device.trust_status,
            ],
        )
        .map_err(|e| format!("Database error inserting device: {}", e))?;

        Ok(())
    }

    pub fn get_all_trusted_devices(&self) -> Result<Vec<TrustedDevice>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT device_id, name, platform, device_model, ip_address, port,
                        public_key, fingerprint, auth_token_hash, first_paired_at,
                        last_connected_at, trust_status
                 FROM trusted_devices
                 WHERE trust_status = 'trusted'
                 ORDER BY last_connected_at DESC",
            )
            .map_err(|e| format!("Failed to prepare select statement: {}", e))?;

        let rows = stmt
            .query_map([], |row| {
                let platform_str: String = row.get(2)?;
                let platform: Platform = serde_json::from_str(&format!("\"{}\"", platform_str)).unwrap_or_default();

                Ok(TrustedDevice {
                    device_id: row.get(0)?,
                    name: row.get(1)?,
                    platform,
                    device_model: row.get(3)?,
                    ip_address: row.get(4)?,
                    port: row.get(5)?,
                    public_key: row.get(6)?,
                    fingerprint: row.get(7)?,
                    auth_token_hash: row.get(8)?,
                    first_paired_at: row.get(9)?,
                    last_connected_at: row.get(10)?,
                    is_online: true,
                    trust_status: row.get(11)?,
                })
            })
            .map_err(|e| format!("Failed to query trusted devices: {}", e))?;

        let mut devices = Vec::new();
        for dev in rows {
            if let Ok(d) = dev {
                devices.push(d);
            }
        }
        Ok(devices)
    }

    pub fn delete_trusted_device(&self, device_id: &str) -> Result<bool, String> {
        let conn = self.conn.lock().unwrap();
        let affected = conn
            .execute("DELETE FROM trusted_devices WHERE device_id = ?1", params![device_id])
            .map_err(|e| format!("Failed to delete trusted device: {}", e))?;
        Ok(affected > 0)
    }

    pub fn rename_trusted_device(&self, device_id: &str, new_name: &str) -> Result<bool, String> {
        let conn = self.conn.lock().unwrap();
        let affected = conn
            .execute("UPDATE trusted_devices SET name = ?1 WHERE device_id = ?2", params![new_name, device_id])
            .map_err(|e| format!("Failed to rename trusted device: {}", e))?;
        Ok(affected > 0)
    }

    pub fn update_last_connected(&self, device_id: &str, timestamp: i64) -> Result<bool, String> {
        let conn = self.conn.lock().unwrap();
        let affected = conn
            .execute("UPDATE trusted_devices SET last_connected_at = ?1 WHERE device_id = ?2", params![timestamp, device_id])
            .map_err(|e| format!("Failed to update last connected: {}", e))?;
        Ok(affected > 0)
    }
}
