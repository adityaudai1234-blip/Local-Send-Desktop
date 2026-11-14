use serde::{Deserialize, Serialize};
use super::priority::TransferPriority;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TransferDirection {
    Incoming,
    Outgoing,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TransferStatus {
    WaitingForApproval,
    Preparing,
    Connecting,
    Transferring,
    Verifying,
    Completed,
    Failed,
    Cancelled,
    Paused,
    Queued,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferFileItem {
    pub file_id: String,
    pub name: String,
    pub size: u64,
    pub mime_type: String,
    pub path: Option<String>,
    pub relative_path: Option<String>,
    pub is_directory: bool,
    pub sha256_checksum: Option<String>,
    pub is_verified: bool,
    pub bytes_transferred: u64,
    pub status: TransferStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferSession {
    pub transfer_id: String,
    pub direction: TransferDirection,
    pub sender_device_id: String,
    pub sender_device_name: String,
    pub sender_platform: String,
    pub recipient_device_id: String,
    pub recipient_device_name: String,
    pub recipient_ip: String,
    pub recipient_port: u16,
    pub files: Vec<TransferFileItem>,
    pub total_bytes: u64,
    pub bytes_transferred: u64,
    pub speed_bytes_per_sec: u64,
    pub estimated_seconds_remaining: Option<u64>,
    pub status: TransferStatus,
    pub priority: TransferPriority,
    pub is_folder: bool,
    pub root_folder_name: Option<String>,
    pub error_message: Option<String>,
    pub started_at: i64,
    pub completed_at: Option<i64>,
    pub destination_directory: Option<String>,
}

impl TransferSession {
    pub fn progress_percentage(&self) -> f64 {
        if self.total_bytes == 0 {
            return 100.0;
        }
        ((self.bytes_transferred as f64 / self.total_bytes as f64) * 100.0).min(100.0)
    }
}
