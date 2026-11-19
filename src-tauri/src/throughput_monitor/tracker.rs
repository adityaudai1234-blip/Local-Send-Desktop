use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Instant;

use crate::performance::metrics::{
    DiskThroughputMetrics, NetworkThroughputMetrics, ThroughputHistoryPoint,
    TransferPerformanceMetrics, TransferSpeedDetails,
};
use crate::transfers::metadata::{TransferDirection, TransferSession, TransferStatus};

const ROLLING_WINDOW_SECS: f64 = 5.0;
const HISTORY_MAX_POINTS: usize = 60;
const MIN_IPC_EMIT_INTERVAL_MS: u128 = 250;

#[derive(Debug, Clone)]
struct ByteSample {
    instant: Instant,
    bytes: u64,
}

#[derive(Debug)]
struct RollingRateTracker {
    samples: VecDeque<ByteSample>,
    ewma_bps: f64,
    peak_bps: u64,
    total_bytes: u64,
}

impl RollingRateTracker {
    fn new() -> Self {
        Self {
            samples: VecDeque::with_capacity(32),
            ewma_bps: 0.0,
            peak_bps: 0,
            total_bytes: 0,
        }
    }

    fn record_delta(&mut self, delta_bytes: u64) {
        let now = Instant::now();
        self.total_bytes = self.total_bytes.saturating_add(delta_bytes);
        self.samples.push_back(ByteSample {
            instant: now,
            bytes: delta_bytes,
        });
        self.prune(now);

        let instant_rate = self.window_bps(now);
        if self.ewma_bps == 0.0 {
            self.ewma_bps = instant_rate as f64;
        } else {
            self.ewma_bps = 0.35 * (instant_rate as f64) + 0.65 * self.ewma_bps;
        }
        let smoothed = self.ewma_bps.round() as u64;
        if smoothed > self.peak_bps {
            self.peak_bps = smoothed;
        }
    }

    fn prune(&mut self, now: Instant) {
        while let Some(front) = self.samples.front() {
            if now.duration_since(front.instant).as_secs_f64() > ROLLING_WINDOW_SECS {
                self.samples.pop_front();
            } else {
                break;
            }
        }
    }

    fn window_bps(&mut self, now: Instant) -> u64 {
        self.prune(now);
        if self.samples.is_empty() {
            return 0;
        }
        let oldest = self.samples.front().unwrap().instant;
        let elapsed = now.duration_since(oldest).as_secs_f64().max(0.25);
        let sum: u64 = self.samples.iter().map(|s| s.bytes).sum();
        ((sum as f64) / elapsed).round() as u64
    }

    fn current_bps(&mut self) -> u64 {
        let now = Instant::now();
        self.prune(now);
        if self.samples.is_empty() {
            // Decay gently when idle
            self.ewma_bps *= 0.4;
            if self.ewma_bps < 64.0 {
                self.ewma_bps = 0.0;
            }
            return self.ewma_bps.round() as u64;
        }
        self.window_bps(now).max(self.ewma_bps.round() as u64)
    }
}

#[derive(Debug, Clone)]
pub struct PerTransferSpeedRecord {
    pub current_speed_bps: u64,
    pub average_speed_bps: u64,
    pub peak_speed_bps: u64,
    pub recent_samples_bps: Vec<u64>,
    pub chunk_size_bytes: usize,
    pub retry_attempts: u32,
    pub reliable_eta: bool,
}

pub struct ThroughputMonitor {
    upload_tracker: Mutex<RollingRateTracker>,
    download_tracker: Mutex<RollingRateTracker>,
    disk_read_tracker: Mutex<RollingRateTracker>,
    disk_write_tracker: Mutex<RollingRateTracker>,
    history: Mutex<VecDeque<ThroughputHistoryPoint>>,
    per_transfer: Mutex<HashMap<String, PerTransferSpeedRecord>>,
    last_history_sample: Mutex<Instant>,
    last_emit_timestamps: Mutex<HashMap<String, Instant>>,
    disk_write_latency_sum_us: AtomicU64,
    disk_write_ops: AtomicU64,
    retry_count: AtomicU64,
    failed_count: AtomicU64,
    current_chunk_size_bytes: AtomicU64,
}

impl ThroughputMonitor {
    pub fn new(initial_chunk_bytes: usize) -> Self {
        Self {
            upload_tracker: Mutex::new(RollingRateTracker::new()),
            download_tracker: Mutex::new(RollingRateTracker::new()),
            disk_read_tracker: Mutex::new(RollingRateTracker::new()),
            disk_write_tracker: Mutex::new(RollingRateTracker::new()),
            history: Mutex::new(VecDeque::with_capacity(HISTORY_MAX_POINTS)),
            per_transfer: Mutex::new(HashMap::new()),
            last_history_sample: Mutex::new(Instant::now()),
            last_emit_timestamps: Mutex::new(HashMap::new()),
            disk_write_latency_sum_us: AtomicU64::new(0),
            disk_write_ops: AtomicU64::new(0),
            retry_count: AtomicU64::new(0),
            failed_count: AtomicU64::new(0),
            current_chunk_size_bytes: AtomicU64::new(initial_chunk_bytes as u64),
        }
    }

    pub fn record_upload(&self, bytes: u64) {
        if let Ok(mut guard) = self.upload_tracker.lock() {
            guard.record_delta(bytes);
        }
        self.maybe_push_history_point();
    }

    pub fn record_download(&self, bytes: u64) {
        if let Ok(mut guard) = self.download_tracker.lock() {
            guard.record_delta(bytes);
        }
        self.maybe_push_history_point();
    }

    pub fn record_disk_read(&self, bytes: u64) {
        if let Ok(mut guard) = self.disk_read_tracker.lock() {
            guard.record_delta(bytes);
        }
    }

    pub fn record_disk_write(&self, bytes: u64, latency_us: u64) {
        if let Ok(mut guard) = self.disk_write_tracker.lock() {
            guard.record_delta(bytes);
        }
        self.disk_write_latency_sum_us
            .fetch_add(latency_us, Ordering::Relaxed);
        self.disk_write_ops.fetch_add(1, Ordering::Relaxed);
    }

    pub fn record_retry(&self) {
        self.retry_count.fetch_add(1, Ordering::Relaxed);
    }

    pub fn record_failure(&self) {
        self.failed_count.fetch_add(1, Ordering::Relaxed);
    }

    pub fn set_current_chunk_size(&self, bytes: usize) {
        self.current_chunk_size_bytes
            .store(bytes as u64, Ordering::Relaxed);
    }

    pub fn average_write_latency_us(&self) -> u64 {
        let ops = self.disk_write_ops.load(Ordering::Relaxed);
        if ops == 0 {
            return 0;
        }
        self.disk_write_latency_sum_us.load(Ordering::Relaxed) / ops
    }

    pub fn update_transfer_speed(&self, transfer_id: &str, rec: PerTransferSpeedRecord) {
        if let Ok(mut guard) = self.per_transfer.lock() {
            guard.insert(transfer_id.to_string(), rec);
        }
    }

    pub fn reset_transfer_speed(&self, transfer_id: &str) {
        if let Ok(mut guard) = self.per_transfer.lock() {
            guard.remove(transfer_id);
        }
    }

    pub fn get_transfer_speed_details(&self, session: &TransferSession) -> TransferSpeedDetails {
        let rec = self
            .per_transfer
            .lock()
            .ok()
            .and_then(|g| g.get(&session.transfer_id).cloned());

        let remaining = session.total_bytes.saturating_sub(session.bytes_transferred);
        match rec {
            Some(r) => TransferSpeedDetails {
                transfer_id: session.transfer_id.clone(),
                current_speed_bps: r.current_speed_bps,
                average_speed_bps: r.average_speed_bps,
                peak_speed_bps: r.peak_speed_bps,
                total_bytes: session.total_bytes,
                bytes_transferred: session.bytes_transferred,
                remaining_bytes: remaining,
                estimated_seconds_remaining: session.estimated_seconds_remaining,
                reliable_eta: r.reliable_eta && session.estimated_seconds_remaining.is_some(),
                recent_samples_bps: r.recent_samples_bps,
                chunk_size_bytes: r.chunk_size_bytes,
                retry_attempts: r.retry_attempts,
                status: session.status.clone(),
            },
            None => TransferSpeedDetails {
                transfer_id: session.transfer_id.clone(),
                current_speed_bps: session.speed_bytes_per_sec,
                average_speed_bps: session.speed_bytes_per_sec,
                peak_speed_bps: session.speed_bytes_per_sec,
                total_bytes: session.total_bytes,
                bytes_transferred: session.bytes_transferred,
                remaining_bytes: remaining,
                estimated_seconds_remaining: session.estimated_seconds_remaining,
                reliable_eta: session.estimated_seconds_remaining.is_some(),
                recent_samples_bps: if session.speed_bytes_per_sec > 0 {
                    vec![session.speed_bytes_per_sec]
                } else {
                    Vec::new()
                },
                chunk_size_bytes: self.current_chunk_size_bytes.load(Ordering::Relaxed) as usize,
                retry_attempts: 0,
                status: session.status.clone(),
            },
        }
    }

    pub fn should_emit_channel(&self, channel: &str) -> bool {
        let now = Instant::now();
        if let Ok(mut map) = self.last_emit_timestamps.lock() {
            if let Some(last) = map.get(channel) {
                if now.duration_since(*last).as_millis() < MIN_IPC_EMIT_INTERVAL_MS {
                    return false;
                }
            }
            map.insert(channel.to_string(), now);
            return true;
        }
        true
    }

    fn maybe_push_history_point(&self) {
        let should_sample = self
            .last_history_sample
            .lock()
            .map(|mut last| {
                let now = Instant::now();
                if now.duration_since(*last).as_millis() >= 400 {
                    *last = now;
                    true
                } else {
                    false
                }
            })
            .unwrap_or(false);

        if !should_sample {
            return;
        }

        let upload_bps = self
            .upload_tracker
            .lock()
            .map(|mut t| t.current_bps())
            .unwrap_or(0);
        let download_bps = self
            .download_tracker
            .lock()
            .map(|mut t| t.current_bps())
            .unwrap_or(0);
        let disk_write_bps = self
            .disk_write_tracker
            .lock()
            .map(|mut t| t.current_bps())
            .unwrap_or(0);

        if let Ok(mut hist) = self.history.lock() {
            if hist.len() >= HISTORY_MAX_POINTS {
                hist.pop_front();
            }
            hist.push_back(ThroughputHistoryPoint {
                timestamp: chrono::Utc::now().timestamp_millis(),
                upload_bps,
                download_bps,
                disk_write_bps,
            });
        }
    }

    pub fn snapshot_history(&self) -> Vec<ThroughputHistoryPoint> {
        self.history
            .lock()
            .map(|h| h.iter().cloned().collect())
            .unwrap_or_default()
    }

    pub fn build_performance_metrics(
        &self,
        sessions: &HashMap<String, TransferSession>,
        queue_depth: usize,
        adaptive_enabled: bool,
        active_buffer_bytes: usize,
    ) -> TransferPerformanceMetrics {
        let mut active_transfers = 0usize;
        let mut queued_transfers = 0usize;
        let mut paused_transfers = 0usize;
        let mut active_upload_sum = 0u64;
        let mut active_download_sum = 0u64;

        for s in sessions.values() {
            match s.status {
                TransferStatus::Transferring
                | TransferStatus::Preparing
                | TransferStatus::Connecting
                | TransferStatus::Verifying => {
                    active_transfers += 1;
                    match s.direction {
                        TransferDirection::Outgoing => active_upload_sum += s.speed_bytes_per_sec,
                        TransferDirection::Incoming => active_download_sum += s.speed_bytes_per_sec,
                    }
                }
                TransferStatus::Queued => queued_transfers += 1,
                TransferStatus::Paused => paused_transfers += 1,
                _ => {}
            }
        }

        let (up_rolling, up_peak, up_total) = self
            .upload_tracker
            .lock()
            .map(|mut t| (t.current_bps(), t.peak_bps, t.total_bytes))
            .unwrap_or((0, 0, 0));
        let (down_rolling, down_peak, down_total) = self
            .download_tracker
            .lock()
            .map(|mut t| (t.current_bps(), t.peak_bps, t.total_bytes))
            .unwrap_or((0, 0, 0));
        let disk_read_bps = self
            .disk_read_tracker
            .lock()
            .map(|mut t| t.current_bps())
            .unwrap_or(0);
        let disk_write_bps = self
            .disk_write_tracker
            .lock()
            .map(|mut t| t.current_bps())
            .unwrap_or(0);

        let total_upload = up_rolling.max(active_upload_sum);
        let total_download = down_rolling.max(active_download_sum);
        let combined = total_upload.saturating_add(total_download);
        let peak_speed = up_peak.max(down_peak).max(combined);

        let avg_speed = if active_transfers > 0 {
            combined
        } else {
            let hist = self.snapshot_history();
            let non_zero: Vec<u64> = hist
                .iter()
                .map(|p| p.upload_bps + p.download_bps)
                .filter(|v| *v > 0)
                .collect();
            if non_zero.is_empty() {
                0
            } else {
                non_zero.iter().sum::<u64>() / (non_zero.len() as u64)
            }
        };

        TransferPerformanceMetrics {
            active_transfers,
            queued_transfers,
            paused_transfers,
            total_bytes_transferred: up_total.saturating_add(down_total),
            total_upload_speed_bps: total_upload,
            total_download_speed_bps: total_download,
            combined_throughput_bps: combined,
            average_speed_bps: avg_speed,
            peak_speed_bps: peak_speed,
            disk_read_speed_bps: disk_read_bps,
            disk_write_speed_bps: disk_write_bps,
            retry_count: self.retry_count.load(Ordering::Relaxed),
            failed_count: self.failed_count.load(Ordering::Relaxed),
            current_chunk_size_bytes: self.current_chunk_size_bytes.load(Ordering::Relaxed) as usize,
            adaptive_chunking_active: adaptive_enabled,
            queue_depth,
            active_buffer_bytes,
            updated_at: chrono::Utc::now().timestamp_millis(),
        }
    }

    pub fn build_network_metrics(
        &self,
        total_tx_bytes: u64,
        total_rx_bytes: u64,
        active_connections: usize,
        network_quality: String,
        average_latency_ms: u64,
        congestion_events: u64,
        interface_ip: String,
        interface_changed_at: Option<i64>,
    ) -> NetworkThroughputMetrics {
        let (upload_bps, peak_upload_bps) = self
            .upload_tracker
            .lock()
            .map(|mut t| (t.current_bps(), t.peak_bps))
            .unwrap_or((0, 0));
        let (download_bps, peak_download_bps) = self
            .download_tracker
            .lock()
            .map(|mut t| (t.current_bps(), t.peak_bps))
            .unwrap_or((0, 0));

        NetworkThroughputMetrics {
            upload_bps,
            download_bps,
            total_tx_bytes,
            total_rx_bytes,
            peak_upload_bps,
            peak_download_bps,
            active_connections,
            network_quality,
            average_latency_ms,
            congestion_events,
            interface_ip,
            interface_changed_at,
            history: self.snapshot_history(),
        }
    }

    pub fn build_disk_metrics(
        &self,
        write_buffer_size_bytes: usize,
        available_disk_bytes: Option<u64>,
        download_dir_path: String,
    ) -> DiskThroughputMetrics {
        let (read_bps, total_read_bytes) = self
            .disk_read_tracker
            .lock()
            .map(|mut t| (t.current_bps(), t.total_bytes))
            .unwrap_or((0, 0));
        let (write_bps, total_write_bytes) = self
            .disk_write_tracker
            .lock()
            .map(|mut t| (t.current_bps(), t.total_bytes))
            .unwrap_or((0, 0));

        DiskThroughputMetrics {
            read_bps,
            write_bps,
            total_read_bytes,
            total_write_bytes,
            average_write_latency_us: self.average_write_latency_us(),
            buffered_write_enabled: true,
            write_buffer_size_bytes,
            available_disk_bytes,
            download_dir_path,
        }
    }
}
