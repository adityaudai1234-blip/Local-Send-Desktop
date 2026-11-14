use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;

use super::metadata::{TransferSession, TransferStatus};
use super::priority::TransferPriority;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedTransferInfo {
    pub transfer_id: String,
    pub root_name: String,
    pub priority: TransferPriority,
    pub queue_position: usize,
    pub status: TransferStatus,
    pub recipient_name: String,
    pub total_bytes: u64,
    pub bytes_transferred: u64,
    pub speed_bytes_per_sec: u64,
    pub is_folder: bool,
    pub file_count: usize,
    pub enqueued_at: i64,
}

#[derive(Debug, Clone)]
struct QueueEntry {
    transfer_id: String,
    priority: TransferPriority,
    enqueued_at: i64,
    dedup_key: String,
}

pub struct TransferScheduler {
    entries: Mutex<Vec<QueueEntry>>,
}

impl TransferScheduler {
    pub fn new() -> Self {
        Self {
            entries: Mutex::new(Vec::new()),
        }
    }

    /// Generates a deterministic deduplication key for (recipient + root/files)
    pub fn make_dedup_key(recipient_id: &str, names: &[String]) -> String {
        let mut sorted = names.to_vec();
        sorted.sort();
        format!("{}::{}", recipient_id, sorted.join("|"))
    }

    /// Enqueues a transfer job if not already queued/active with identical target & payload
    pub fn enqueue(
        &self,
        transfer_id: String,
        priority: TransferPriority,
        dedup_key: String,
        active_sessions: &HashMap<String, TransferSession>,
    ) -> Result<usize, String> {
        let mut lock = self.entries.lock().map_err(|e| e.to_string())?;

        // Prevent duplicate active or queued transfer jobs
        for existing in lock.iter() {
            if existing.dedup_key == dedup_key {
                if let Some(session) = active_sessions.get(&existing.transfer_id) {
                    if matches!(
                        session.status,
                        TransferStatus::Queued
                            | TransferStatus::Transferring
                            | TransferStatus::Preparing
                            | TransferStatus::Connecting
                            | TransferStatus::WaitingForApproval
                    ) {
                        return Err("An identical transfer to this device is already queued or active".to_string());
                    }
                }
            }
        }

        lock.push(QueueEntry {
            transfer_id: transfer_id.clone(),
            priority,
            enqueued_at: chrono::Utc::now().timestamp_millis(),
            dedup_key,
        });

        Self::sort_entries(&mut lock);

        let pos = lock
            .iter()
            .position(|e| e.transfer_id == transfer_id)
            .map(|i| i + 1)
            .unwrap_or(1);

        Ok(pos)
    }

    pub fn update_priority(&self, transfer_id: &str, new_priority: TransferPriority) -> Result<usize, String> {
        let mut lock = self.entries.lock().map_err(|e| e.to_string())?;
        let entry = lock
            .iter_mut()
            .find(|e| e.transfer_id == transfer_id)
            .ok_or_else(|| format!("Transfer {} not found in queue", transfer_id))?;

        entry.priority = new_priority;
        Self::sort_entries(&mut lock);

        let pos = lock
            .iter()
            .position(|e| e.transfer_id == transfer_id)
            .map(|i| i + 1)
            .unwrap_or(1);

        Ok(pos)
    }

    pub fn remove(&self, transfer_id: &str) {
        if let Ok(mut lock) = self.entries.lock() {
            lock.retain(|e| e.transfer_id != transfer_id);
        }
    }

    pub fn get_queue_snapshot(&self, active_sessions: &HashMap<String, TransferSession>) -> Vec<QueuedTransferInfo> {
        let lock = match self.entries.lock() {
            Ok(l) => l,
            Err(_) => return Vec::new(),
        };

        let mut list = Vec::new();
        for (idx, entry) in lock.iter().enumerate() {
            if let Some(s) = active_sessions.get(&entry.transfer_id) {
                let root_name = s
                    .root_folder_name
                    .clone()
                    .unwrap_or_else(|| s.files.first().map(|f| f.name.clone()).unwrap_or_else(|| "Transfer".to_string()));

                list.push(QueuedTransferInfo {
                    transfer_id: s.transfer_id.clone(),
                    root_name,
                    priority: entry.priority,
                    queue_position: idx + 1,
                    status: s.status.clone(),
                    recipient_name: s.recipient_device_name.clone(),
                    total_bytes: s.total_bytes,
                    bytes_transferred: s.bytes_transferred,
                    speed_bytes_per_sec: s.speed_bytes_per_sec,
                    is_folder: s.is_folder,
                    file_count: s.files.len(),
                    enqueued_at: entry.enqueued_at,
                });
            }
        }
        list
    }

    fn sort_entries(entries: &mut Vec<QueueEntry>) {
        // Higher priority first, then earliest enqueued timestamp
        entries.sort_by(|a, b| {
            b.priority
                .to_i32()
                .cmp(&a.priority.to_i32())
                .then_with(|| a.enqueued_at.cmp(&b.enqueued_at))
        });
    }
}
