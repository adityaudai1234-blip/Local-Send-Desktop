use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use super::metadata::{TransferSession, TransferStatus};
use super::priority::TransferPriority;
use super::queue::MAX_QUEUED_TRANSFERS;
use crate::performance::metrics::TransferQueueMetrics;

const AGING_STEP_MS: i64 = 15_000;
const AGING_WEIGHT_PER_STEP: i64 = 25;
const MAX_AGING_BONUS: i64 = 250;
const SMALL_TRANSFER_FAST_LANE_BYTES: u64 = 1_048_576; // 1 MB

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
    pub estimated_seconds_remaining: Option<u64>,
    pub is_folder: bool,
    pub file_count: usize,
    pub enqueued_at: i64,
}

#[derive(Debug, Clone)]
pub struct QueueEntry {
    pub transfer_id: String,
    pub priority: TransferPriority,
    pub total_bytes: u64,
    pub enqueued_at: i64,
    pub dedup_key: String,
}

pub struct TransferScheduler {
    entries: Mutex<Vec<QueueEntry>>,
    starvation_boosts_applied: AtomicU64,
}

impl TransferScheduler {
    pub fn new() -> Self {
        Self {
            entries: Mutex::new(Vec::new()),
            starvation_boosts_applied: AtomicU64::new(0),
        }
    }

    /// Generates a deterministic deduplication key for (recipient + root/files)
    pub fn make_dedup_key(recipient_id: &str, names: &[String]) -> String {
        let mut sorted = names.to_vec();
        sorted.sort();
        format!("{}::{}", recipient_id, sorted.join("|"))
    }

    pub fn enqueue(
        &self,
        transfer_id: String,
        priority: TransferPriority,
        dedup_key: String,
        active_sessions: &HashMap<String, TransferSession>,
    ) -> Result<usize, String> {
        let size = active_sessions
            .get(&transfer_id)
            .map(|s| s.total_bytes)
            .unwrap_or(0);
        self.enqueue_with_size(transfer_id, priority, size, dedup_key, active_sessions)
    }

    /// Enqueues a transfer job with bounded queue limits and anti-starvation scheduling.
    pub fn enqueue_with_size(
        &self,
        transfer_id: String,
        priority: TransferPriority,
        total_bytes: u64,
        dedup_key: String,
        active_sessions: &HashMap<String, TransferSession>,
    ) -> Result<usize, String> {
        let mut lock = self.entries.lock().map_err(|e| e.to_string())?;

        if lock.len() >= MAX_QUEUED_TRANSFERS {
            return Err(format!(
                "Transfer queue limit reached ({} pending jobs); wait for existing transfers to finish",
                MAX_QUEUED_TRANSFERS
            ));
        }

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

        let now = chrono::Utc::now().timestamp_millis();
        lock.push(QueueEntry {
            transfer_id: transfer_id.clone(),
            priority,
            total_bytes,
            enqueued_at: now,
            dedup_key,
        });

        let boosts = Self::sort_entries_with_aging(&mut lock, now);
        if boosts > 0 {
            self.starvation_boosts_applied
                .fetch_add(boosts, Ordering::Relaxed);
        }

        let pos = lock
            .iter()
            .position(|e| e.transfer_id == transfer_id)
            .map(|i| i + 1)
            .unwrap_or(1);

        Ok(pos)
    }

    pub fn update_priority(
        &self,
        transfer_id: &str,
        new_priority: TransferPriority,
    ) -> Result<usize, String> {
        let mut lock = self.entries.lock().map_err(|e| e.to_string())?;
        let entry = lock
            .iter_mut()
            .find(|e| e.transfer_id == transfer_id)
            .ok_or_else(|| format!("Transfer {} not found in queue", transfer_id))?;

        entry.priority = new_priority;
        let now = chrono::Utc::now().timestamp_millis();
        let boosts = Self::sort_entries_with_aging(&mut lock, now);
        if boosts > 0 {
            self.starvation_boosts_applied
                .fetch_add(boosts, Ordering::Relaxed);
        }

        let pos = lock
            .iter()
            .position(|e| e.transfer_id == transfer_id)
            .map(|i| i + 1)
            .unwrap_or(1);

        Ok(pos)
    }

    /// Explicitly optimizes queue ordering with anti-starvation aging & small-file fast lane.
    pub fn optimize_queue(&self, active_sessions: &HashMap<String, TransferSession>) -> Vec<QueuedTransferInfo> {
        if let Ok(mut lock) = self.entries.lock() {
            for entry in lock.iter_mut() {
                if let Some(s) = active_sessions.get(&entry.transfer_id) {
                    entry.total_bytes = s.total_bytes;
                }
            }
            let now = chrono::Utc::now().timestamp_millis();
            let boosts = Self::sort_entries_with_aging(&mut lock, now);
            if boosts > 0 {
                self.starvation_boosts_applied
                    .fetch_add(boosts, Ordering::Relaxed);
            }
        }
        self.get_queue_snapshot(active_sessions)
    }

    pub fn remove(&self, transfer_id: &str) {
        if let Ok(mut lock) = self.entries.lock() {
            lock.retain(|e| e.transfer_id != transfer_id);
        }
    }

    pub fn len(&self) -> usize {
        self.entries.lock().map(|l| l.len()).unwrap_or(0)
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
                    .unwrap_or_else(|| {
                        s.files
                            .first()
                            .map(|f| f.name.clone())
                            .unwrap_or_else(|| "Transfer".to_string())
                    });

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
                    estimated_seconds_remaining: s.estimated_seconds_remaining,
                    is_folder: s.is_folder,
                    file_count: s.files.len(),
                    enqueued_at: entry.enqueued_at,
                });
            }
        }
        list
    }

    pub fn get_queue_metrics(
        &self,
        active_sessions: &HashMap<String, TransferSession>,
        max_concurrent_transfers: usize,
    ) -> TransferQueueMetrics {
        let snapshot = self.get_queue_snapshot(active_sessions);
        let mut active_count = 0usize;
        let mut waiting_count = 0usize;
        let mut high_priority_count = 0usize;
        let mut normal_priority_count = 0usize;
        let mut low_priority_count = 0usize;
        let mut total_queued_bytes = 0u64;

        for item in &snapshot {
            match item.status {
                TransferStatus::Transferring | TransferStatus::Preparing | TransferStatus::Connecting | TransferStatus::Verifying => {
                    active_count += 1;
                }
                TransferStatus::Queued | TransferStatus::WaitingForApproval | TransferStatus::Paused => {
                    waiting_count += 1;
                }
                _ => {}
            }
            match item.priority {
                TransferPriority::High => high_priority_count += 1,
                TransferPriority::Normal => normal_priority_count += 1,
                TransferPriority::Low => low_priority_count += 1,
            }
            total_queued_bytes = total_queued_bytes.saturating_add(item.total_bytes.saturating_sub(item.bytes_transferred));
        }

        TransferQueueMetrics {
            total_queued: snapshot.len(),
            active_count,
            waiting_count,
            high_priority_count,
            normal_priority_count,
            low_priority_count,
            starvation_boosts_applied: self.starvation_boosts_applied.load(Ordering::Relaxed),
            total_queued_bytes,
            max_concurrent_transfers,
        }
    }

    /// Computes effective score combining priority weight, wait-time aging (anti-starvation),
    /// and a modest small-file swiftness bonus so tiny files don't get stuck behind multi-GB batches.
    pub fn effective_score(entry: &QueueEntry, now_ms: i64) -> (i64, bool) {
        let base_weight = match entry.priority {
            TransferPriority::High => 300,
            TransferPriority::Normal => 200,
            TransferPriority::Low => 100,
        };
        let wait_ms = (now_ms - entry.enqueued_at).max(0);
        let aging_steps = wait_ms / AGING_STEP_MS;
        let aging_bonus = (aging_steps * AGING_WEIGHT_PER_STEP).min(MAX_AGING_BONUS);
        let small_bonus = if entry.total_bytes > 0 && entry.total_bytes <= SMALL_TRANSFER_FAST_LANE_BYTES {
            40
        } else {
            0
        };
        (base_weight + aging_bonus + small_bonus, aging_bonus >= 100)
    }

    pub fn sort_entries_with_aging(entries: &mut [QueueEntry], now_ms: i64) -> u64 {
        let mut boosts = 0u64;
        for entry in entries.iter() {
            let (_, boosted) = Self::effective_score(entry, now_ms);
            if boosted {
                boosts += 1;
            }
        }
        entries.sort_by(|a, b| {
            let (score_a, _) = Self::effective_score(a, now_ms);
            let (score_b, _) = Self::effective_score(b, now_ms);
            score_b
                .cmp(&score_a)
                .then_with(|| a.enqueued_at.cmp(&b.enqueued_at))
        });
        boosts
    }
}
