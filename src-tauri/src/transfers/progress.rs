use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::time::Instant;

use super::metadata::TransferStatus;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgressEvent {
    pub transfer_id: String,
    pub file_id: String,
    pub file_name: String,
    pub current_file_index: usize,
    pub total_files: usize,
    pub bytes_transferred: u64,
    pub total_bytes: u64,
    pub percentage: f64,
    pub speed_bytes_per_sec: u64,
    pub estimated_seconds_remaining: Option<u64>,
    pub status: TransferStatus,
}

pub struct SpeedCalculator {
    samples: VecDeque<(Instant, u64)>,
    last_emit_time: Instant,
}

impl SpeedCalculator {
    pub fn new() -> Self {
        let mut samples = VecDeque::with_capacity(10);
        samples.push_back((Instant::now(), 0));
        Self {
            samples,
            last_emit_time: Instant::now(),
        }
    }

    /// Records transferred bytes at current instant
    pub fn record_progress(&mut self, total_bytes_transferred: u64) {
        let now = Instant::now();
        self.samples.push_back((now, total_bytes_transferred));

        // Keep rolling window of last 2 seconds
        while self.samples.len() > 1 {
            if let Some((first_time, _)) = self.samples.front() {
                if now.duration_since(*first_time).as_secs_f64() > 2.0 {
                    self.samples.pop_front();
                    continue;
                }
            }
            break;
        }
    }

    /// Calculates speed in bytes per second
    pub fn current_speed(&self) -> u64 {
        if self.samples.len() < 2 {
            return 0;
        }

        let (first_time, first_bytes) = match self.samples.front() {
            Some(v) => *v,
            None => return 0,
        };

        let (last_time, last_bytes) = match self.samples.back() {
            Some(v) => *v,
            None => return 0,
        };

        let duration = last_time.duration_since(first_time).as_secs_f64();
        if duration <= 0.05 {
            return 0;
        }

        let bytes_diff = last_bytes.saturating_sub(first_bytes);
        (bytes_diff as f64 / duration) as u64
    }

    /// Calculates estimated seconds remaining
    pub fn estimate_eta(&self, remaining_bytes: u64) -> Option<u64> {
        let speed = self.current_speed();
        if speed > 1024 && remaining_bytes > 0 {
            Some((remaining_bytes / speed).min(86400)) // Cap at 24 hours
        } else {
            None
        }
    }

    /// Rate limits UI progress updates to avoid flooding the IPC channel (e.g. max once every 100ms)
    pub fn should_emit_update(&mut self) -> bool {
        let now = Instant::now();
        if now.duration_since(self.last_emit_time).as_millis() >= 100 {
            self.last_emit_time = now;
            true
        } else {
            false
        }
    }
}
