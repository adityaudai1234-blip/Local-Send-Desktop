use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

use super::metadata::TransferSession;
use crate::file_system::storage::get_download_directory;
use crate::history::filters::HistoryFilterOptions;
use crate::history::repository::HistoryRepository;
use crate::trusted_devices::TrustedDeviceManager;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoverableTransferInfo {
    pub transfer_id: String,
    pub root_name: String,
    pub direction: String,
    pub peer_device_id: String,
    pub peer_device_name: String,
    pub total_bytes: u64,
    pub bytes_transferred: u64,
    pub partial_file_exists: bool,
    pub can_resume: bool,
    pub can_retry_fresh: bool,
    pub reason: String,
    pub started_at: i64,
}

pub struct RecoveryManager;

impl RecoveryManager {
    /// Scans SQLite for transfers that were interrupted while active/paused,
    /// verifies device trust and partial `.part` file presence, and cleans expired part files.
    pub fn scan_recoverable_transfers(
        history: &HistoryRepository,
        trusted_mgr: &TrustedDeviceManager,
    ) -> Vec<RecoverableTransferInfo> {
        let options = HistoryFilterOptions {
            direction: None,
            status: Some("active".to_string()),
            search_query: None,
            sort_by: Some("newest".to_string()),
            limit: Some(50),
            offset: None,
        };

        let sessions = match history.query_history(&options) {
            Ok(list) => list,
            Err(_) => return Vec::new(),
        };

        let download_dir = get_download_directory();
        let trusted_list = trusted_mgr.get_trusted_devices();

        sessions
            .into_iter()
            .map(|s| Self::evaluate_session(&s, &download_dir, &trusted_list))
            .collect()
    }

    fn evaluate_session(
        session: &TransferSession,
        download_dir: &Path,
        trusted_devices: &[crate::trusted_devices::storage::TrustedDevice],
    ) -> RecoverableTransferInfo {
        let is_incoming = matches!(session.direction, super::metadata::TransferDirection::Incoming);
        let peer_id = if is_incoming {
            session.sender_device_id.clone()
        } else {
            session.recipient_device_id.clone()
        };
        let peer_name = if is_incoming {
            session.sender_device_name.clone()
        } else {
            session.recipient_device_name.clone()
        };

        let is_trusted = trusted_devices.iter().any(|d| d.device_id == peer_id);

        let partial_exists = if is_incoming {
            Self::has_part_file(download_dir, &session.transfer_id)
        } else {
            session
                .files
                .iter()
                .all(|f| f.path.as_ref().map(|p| Path::new(p).exists()).unwrap_or(false))
        };

        let root_name = session
            .root_folder_name
            .clone()
            .unwrap_or_else(|| session.files.first().map(|f| f.name.clone()).unwrap_or_else(|| "Transfer".to_string()));

        let (can_resume, reason) = if !is_trusted {
            (false, "Peer device is no longer in trusted vault; cannot resume safely".to_string())
        } else if !partial_exists {
            (false, "Partial transfer data missing on disk; fresh retry available".to_string())
        } else {
            (true, "Interrupted session verified and eligible for recovery".to_string())
        };

        RecoverableTransferInfo {
            transfer_id: session.transfer_id.clone(),
            root_name,
            direction: if is_incoming { "incoming".to_string() } else { "outgoing".to_string() },
            peer_device_id: peer_id,
            peer_device_name: peer_name,
            total_bytes: session.total_bytes,
            bytes_transferred: session.bytes_transferred,
            partial_file_exists: partial_exists,
            can_resume,
            can_retry_fresh: !is_incoming && is_trusted,
            reason,
            started_at: session.started_at,
        }
    }

    fn has_part_file(dir: &Path, transfer_id: &str) -> bool {
        let prefix = &transfer_id[..transfer_id.len().min(8)];
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                if let Some(name) = entry.file_name().to_str() {
                    if name.ends_with(".part") && name.contains(prefix) {
                        return true;
                    }
                }
            }
        }
        false
    }

    /// Cleans orphaned `.part` files older than 7 days in the download directory
    pub fn cleanup_expired_part_files() -> usize {
        let download_dir = get_download_directory();
        let mut removed = 0;
        let max_age_secs = 7 * 24 * 3600;

        if let Ok(entries) = fs::read_dir(&download_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) == Some("part") {
                    if let Ok(meta) = fs::metadata(&path) {
                        if let Ok(modified) = meta.modified() {
                            if let Ok(age) = modified.elapsed() {
                                if age.as_secs() > max_age_secs && fs::remove_file(&path).is_ok() {
                                    removed += 1;
                                }
                            }
                        }
                    }
                }
            }
        }
        removed
    }
}
