use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::time::{Duration, Instant};

use super::metadata::TransferStatus;

const ROLLING_WINDOW_SECS: f64 = 5.0;
const MIN_RELIABLE_ETA_FILE_BYTES: u64 = 256 * 1024;
const MIN_RELIABLE_ETA_ELAPSED_MS: u128 = 800;

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
    pub average_speed_bps: u64,
    pub peak_speed_bps: u64,
    pub remaining_bytes: u64,
    pub estimated_seconds_remaining: Option<u64>,
    pub reliable_eta: bool,
    pub chunk_size_bytes: usize,
    pub status: TransferStatus,
}

pub struct SpeedCalculator {
    samples: VecDeque<(Instant, u64)>,
    recent_speeds: VecDeque<u64>,
    started_at: Instant,
    last_emit_time: Instant,
    ewma_bps: f64,
    peak_bps: u64,
    last_total_bytes: u64,
    sample_count: u64,
}

impl SpeedCalculator {
    pub fn new() -> Self {
        let now = Instant::now();
        let mut samples = VecDeque::with_capacity(32);
        samples.push_back((now, 0));
        Self {
            samples,
            recent_speeds: VecDeque::with_capacity(16),
            started_at: now,
            last_emit_time: now,
            ewma_bps: 0.0,
            peak_bps: 0,
            last_total_bytes: 0,
            sample_count: 0,
        }
    }

    /// Resets speed window and statistics cleanly upon retry or session restart.
    pub fn reset(&mut self, baseline_bytes: u64) {
        let now = Instant::now();
        self.samples.clear();
        self.samples.push_back((now, baseline_bytes));
        self.recent_speeds.clear();
        self.started_at = now;
        self.last_emit_time = now;
        self.ewma_bps = 0.0;
        self.peak_bps = 0;
        self.last_total_bytes = baseline_bytes;
        self.sample_count = 0;
    }

    /// Records cumulative transferred bytes at current instant.
    pub fn record_progress(&mut self, total_bytes_transferred: u64) {
        self.record_progress_at(Instant::now(), total_bytes_transferred);
    }

    /// Deterministic timestamped sample ingestion (directly testable without wall-clock sleep).
    pub fn record_progress_at(&mut self, now: Instant, total_bytes_transferred: u64) {
        self.samples.push_back((now, total_bytes_transferred));
        self.last_total_bytes = total_bytes_transferred;
        self.sample_count = self.sample_count.saturating_add(1);

        while self.samples.len() > 2 {
            if let Some((first_time, _)) = self.samples.front() {
                if now.duration_since(*first_time).as_secs_f64() > ROLLING_WINDOW_SECS {
                    self.samples.pop_front();
                    continue;
                }
            }
            break;
        }

        let window_rate = self.window_speed_raw();
        if window_rate > 0 {
            if self.ewma_bps == 0.0 {
                self.ewma_bps = window_rate as f64;
            } else {
                self.ewma_bps = 0.35 * (window_rate as f64) + 0.65 * self.ewma_bps;
            }
            let smoothed = self.ewma_bps.round() as u64;
            if smoothed > self.peak_bps {
                self.peak_bps = smoothed;
            }
            if self.recent_speeds.len() >= 12 {
                self.recent_speeds.pop_front();
            }
            self.recent_speeds.push_back(smoothed);
        }
    }

    fn window_speed_raw(&self) -> u64 {
        if self.samples.len() < 2 {
            return 0;
        }
        let (first_time, first_bytes) = *self.samples.front().unwrap();
        let (last_time, last_bytes) = *self.samples.back().unwrap();
        let duration = last_time.duration_since(first_time).as_secs_f64();
        if duration <= 0.04 {
            return 0;
        }
        let bytes_diff = last_bytes.saturating_sub(first_bytes);
        ((bytes_diff as f64) / duration).round() as u64
    }

    pub fn current_speed(&self) -> u64 {
        if self.ewma_bps > 0.0 {
            return self.ewma_bps.round() as u64;
        }
        self.window_speed_raw()
    }

    pub fn average_speed(&self) -> u64 {
        let elapsed = Instant::now()
            .duration_since(self.started_at)
            .as_secs_f64()
            .max(0.1);
        let baseline = self.samples.front().map(|s| s.1).unwrap_or(0);
        let transferred = self.last_total_bytes.saturating_sub(baseline);
        if transferred == 0 && self.recent_speeds.is_empty() {
            return 0;
        }
        if !self.recent_speeds.is_empty() {
            let sum: u64 = self.recent_speeds.iter().sum();
            return sum / (self.recent_speeds.len() as u64);
        }
        ((transferred as f64) / elapsed).round() as u64
    }

    pub fn peak_speed(&self) -> u64 {
        self.peak_bps
    }

    pub fn recent_samples(&self) -> Vec<u64> {
        self.recent_speeds.iter().cloned().collect()
    }

    /// Reliable ETA that returns None when estimates would be noisy (very small files, startup, or stalled transfer).
    pub fn estimate_eta_reliable(&self, remaining_bytes: u64, total_bytes: u64) -> Option<u64> {
        self.estimate_eta_at(Instant::now(), remaining_bytes, total_bytes)
    }

    pub fn estimate_eta_at(
        &self,
        now: Instant,
        remaining_bytes: u64,
        total_bytes: u64,
    ) -> Option<u64> {
        if remaining_bytes == 0 || total_bytes < MIN_RELIABLE_ETA_FILE_BYTES {
            return None;
        }
        if self.sample_count < 3 {
            return None;
        }
        if now.duration_since(self.started_at) < Duration::from_millis(MIN_RELIABLE_ETA_ELAPSED_MS as u64) {
            return None;
        }
        self.estimate_eta(remaining_bytes)
    }

    pub fn estimate_eta(&self, remaining_bytes: u64) -> Option<u64> {
        let speed = self.current_speed();
        if speed > 1024 && remaining_bytes > 0 {
            Some(((remaining_bytes + speed - 1) / speed).min(86_400))
        } else {
            None
        }
    }

    /// Throttles UI progress events to prevent main-thread or IPC congestion (~250ms cadence).
    pub fn should_emit_update(&mut self) -> bool {
        let now = Instant::now();
        if now.duration_since(self.last_emit_time).as_millis() >= 220 {
            self.last_emit_time = now;
            true
        } else {
            false
        }
    }
}
