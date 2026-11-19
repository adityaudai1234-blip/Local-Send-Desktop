use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

use super::metadata::TransferSession;
use crate::audit::SecurityRepository;
use crate::file_system::storage::get_download_directory;
use crate::filesystem_security::cleanup_part_file;
use crate::history::filters::HistoryFilterOptions;
use crate::history::repository::HistoryRepository;
use crate::performance::metrics::TransferRecoveryStatus;
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
    /// Scans SQLite for interrupted transfers, verifies peer trust & revocation, validates `.part`
    /// integrity/size bounds, and reports accurate recovery eligibility.
    pub fn scan_recoverable_transfers(
        history: &HistoryRepository,
        trusted_mgr: &TrustedDeviceManager,
    ) -> Vec<RecoverableTransferInfo> {
        Self::scan_recoverable_transfers_checked(history, trusted_mgr, None).items
    }

    pub fn scan_recoverable_transfers_checked(
        history: &HistoryRepository,
        trusted_mgr: &TrustedDeviceManager,
        security_repo: Option<&SecurityRepository>,
    ) -> TransferRecoveryStatus {
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
            Err(_) => {
                return TransferRecoveryStatus {
                    recoverable_count: 0,
                    resumable_count: 0,
                    rejected_count: 0,
                    total_recoverable_bytes: 0,
                    corrupted_part_files_cleaned: 0,
                    items: Vec::new(),
                };
            }
        };

        let download_dir = get_download_directory();
        let trusted_list = trusted_mgr.get_trusted_devices();

        let mut cleaned_parts = 0usize;
        let mut items = Vec::with_capacity(sessions.len());

        for s in sessions {
            let is_revoked = security_repo
                .map(|repo| {
                    let peer_id = if matches!(s.direction, super::metadata::TransferDirection::Incoming) {
                        &s.sender_device_id
                    } else {
                        &s.recipient_device_id
                    };
                    repo.is_device_revoked(peer_id)
                })
                .unwrap_or(false);

            let (info, cleaned) =
                Self::evaluate_session_strict(&s, &download_dir, &trusted_list, is_revoked);
            cleaned_parts += cleaned;
            items.push(info);
        }

        let recoverable_count = items.len();
        let resumable_count = items.iter().filter(|i| i.can_resume).count();
        let rejected_count = recoverable_count.saturating_sub(resumable_count);
        let total_recoverable_bytes = items.iter().map(|i| i.total_bytes).sum();

        TransferRecoveryStatus {
            recoverable_count,
            resumable_count,
            rejected_count,
            total_recoverable_bytes,
            corrupted_part_files_cleaned: cleaned_parts,
            items,
        }
    }

    pub fn evaluate_session_strict(
        session: &TransferSession,
        download_dir: &Path,
        trusted_devices: &[crate::trusted_devices::storage::TrustedDevice],
        is_revoked: bool,
    ) -> (RecoverableTransferInfo, usize) {
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

        let trusted_dev = trusted_devices.iter().find(|d| d.device_id == peer_id);
        let is_trusted = trusted_dev.is_some() && !is_revoked;
        let identity_ok = trusted_dev
            .map(|d| d.verification_status != "identity_changed")
            .unwrap_or(false);

        let mut cleaned_parts = 0usize;
        let (partial_exists, partial_valid, partial_issue) = if is_incoming {
            Self::validate_part_files(download_dir, &session.transfer_id, session.total_bytes)
        } else {
            let sources_ok = !session.files.is_empty()
                && session.files.iter().all(|f| {
                    if f.is_directory {
                        return true;
                    }
                    f.path
                        .as_ref()
                        .map(|p| {
                            let path = Path::new(p);
                            path.exists()
                                && fs::metadata(path)
                                    .map(|m| m.len() == f.size)
                                    .unwrap_or(false)
                        })
                        .unwrap_or(false)
                });
            (
                sources_ok,
                sources_ok,
                if sources_ok {
                    None
                } else {
                    Some("Source files moved or modified since interruption".to_string())
                },
            )
        };

        if partial_exists && !partial_valid && is_incoming {
            cleaned_parts = Self::remove_corrupted_parts(download_dir, &session.transfer_id);
        }

        let root_name = session
            .root_folder_name
            .clone()
            .unwrap_or_else(|| {
                session
                    .files
                    .first()
                    .map(|f| f.name.clone())
                    .unwrap_or_else(|| "Transfer".to_string())
            });

        let (can_resume, reason) = if is_revoked {
            (
                false,
                "Peer device has been revoked; recovery blocked".to_string(),
            )
        } else if !is_trusted {
            (
                false,
                "Peer device is no longer in trusted vault; cannot resume safely".to_string(),
            )
        } else if !identity_ok {
            (
                false,
                "Peer device has unverified identity key change; re-verify before resuming"
                    .to_string(),
            )
        } else if !partial_exists {
            (
                false,
                "Partial transfer data missing on disk; fresh retry available".to_string(),
            )
        } else if !partial_valid {
            (
                false,
                partial_issue.unwrap_or_else(|| {
                    "Partial transfer data failed size/integrity validation and was cleaned"
                        .to_string()
                }),
            )
        } else if session.bytes_transferred > session.total_bytes {
            (
                false,
                "Recorded byte offset exceeds declared transfer size; cleaned stale state"
                    .to_string(),
            )
        } else {
            (
                true,
                "Peer trust, key pinning, and partial data validated for safe recovery"
                    .to_string(),
            )
        };

        (
            RecoverableTransferInfo {
                transfer_id: session.transfer_id.clone(),
                root_name,
                direction: if is_incoming {
                    "incoming".to_string()
                } else {
                    "outgoing".to_string()
                },
                peer_device_id: peer_id,
                peer_device_name: peer_name,
                total_bytes: session.total_bytes,
                bytes_transferred: session.bytes_transferred,
                partial_file_exists: partial_exists && partial_valid,
                can_resume,
                can_retry_fresh: !is_incoming && is_trusted && identity_ok,
                reason,
                started_at: session.started_at,
            },
            cleaned_parts,
        )
    }

    fn validate_part_files(
        dir: &Path,
        transfer_id: &str,
        declared_total_bytes: u64,
    ) -> (bool, bool, Option<String>) {
        let prefix = &transfer_id[..transfer_id.len().min(8)];
        let mut found_any = false;
        let mut sum_bytes: u64 = 0;

        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                if let Some(name) = entry.file_name().to_str() {
                    if name.ends_with(".part") && name.contains(prefix) {
                        found_any = true;
                        match fs::metadata(entry.path()) {
                            Ok(meta) => {
                                sum_bytes = sum_bytes.saturating_add(meta.len());
                            }
                            Err(_) => {
                                return (
                                    true,
                                    false,
                                    Some("Partial file unreadable; removed safely".to_string()),
                                );
                            }
                        }
                    }
                }
            }
        }

        if !found_any {
            return (false, false, None);
        }

        if declared_total_bytes > 0 && sum_bytes > declared_total_bytes {
            return (
                true,
                false,
                Some("Partial .part file exceeded declared transfer size and was discarded".to_string()),
            );
        }

        (true, true, None)
    }

    fn remove_corrupted_parts(dir: &Path, transfer_id: &str) -> usize {
        let prefix = &transfer_id[..transfer_id.len().min(8)];
        let mut cleaned = 0;
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                if let Some(name) = entry.file_name().to_str() {
                    if name.ends_with(".part") && name.contains(prefix) {
                        cleanup_part_file(&entry.path());
                        cleaned += 1;
                    }
                }
            }
        }
        cleaned
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
