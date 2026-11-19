use serde::{Deserialize, Serialize};
use crate::transfers::recovery::RecoverableTransferInfo;
use crate::transfers::metadata::TransferStatus;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThroughputHistoryPoint {
    pub timestamp: i64,
    pub upload_bps: u64,
    pub download_bps: u64,
    pub disk_write_bps: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferPerformanceMetrics {
    pub active_transfers: usize,
    pub queued_transfers: usize,
    pub paused_transfers: usize,
    pub total_bytes_transferred: u64,
    pub total_upload_speed_bps: u64,
    pub total_download_speed_bps: u64,
    pub combined_throughput_bps: u64,
    pub average_speed_bps: u64,
    pub peak_speed_bps: u64,
    pub disk_read_speed_bps: u64,
    pub disk_write_speed_bps: u64,
    pub retry_count: u64,
    pub failed_count: u64,
    pub current_chunk_size_bytes: usize,
    pub adaptive_chunking_active: bool,
    pub queue_depth: usize,
    pub active_buffer_bytes: usize,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkThroughputMetrics {
    pub upload_bps: u64,
    pub download_bps: u64,
    pub total_tx_bytes: u64,
    pub total_rx_bytes: u64,
    pub peak_upload_bps: u64,
    pub peak_download_bps: u64,
    pub active_connections: usize,
    pub network_quality: String,
    pub average_latency_ms: u64,
    pub congestion_events: u64,
    pub interface_ip: String,
    pub interface_changed_at: Option<i64>,
    pub history: Vec<ThroughputHistoryPoint>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskThroughputMetrics {
    pub read_bps: u64,
    pub write_bps: u64,
    pub total_read_bytes: u64,
    pub total_write_bytes: u64,
    pub average_write_latency_us: u64,
    pub buffered_write_enabled: bool,
    pub write_buffer_size_bytes: usize,
    pub available_disk_bytes: Option<u64>,
    pub download_dir_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferSpeedDetails {
    pub transfer_id: String,
    pub current_speed_bps: u64,
    pub average_speed_bps: u64,
    pub peak_speed_bps: u64,
    pub total_bytes: u64,
    pub bytes_transferred: u64,
    pub remaining_bytes: u64,
    pub estimated_seconds_remaining: Option<u64>,
    pub reliable_eta: bool,
    pub recent_samples_bps: Vec<u64>,
    pub chunk_size_bytes: usize,
    pub retry_attempts: u32,
    pub status: TransferStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferResourceUsage {
    pub active_file_handles: usize,
    pub active_chunk_buffers: usize,
    pub pooled_buffers_available: usize,
    pub buffer_memory_bytes: usize,
    pub peak_buffer_memory_bytes: usize,
    pub active_concurrent_transfers: usize,
    pub max_concurrent_transfers: usize,
    pub active_file_ops: usize,
    pub max_concurrent_file_ops: usize,
    pub active_network_connections: usize,
    pub max_concurrent_connections: usize,
    pub active_chunk_ops: usize,
    pub max_concurrent_chunk_ops: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferQueueMetrics {
    pub total_queued: usize,
    pub active_count: usize,
    pub waiting_count: usize,
    pub high_priority_count: usize,
    pub normal_priority_count: usize,
    pub low_priority_count: usize,
    pub starvation_boosts_applied: u64,
    pub total_queued_bytes: u64,
    pub max_concurrent_transfers: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferRecoveryStatus {
    pub recoverable_count: usize,
    pub resumable_count: usize,
    pub rejected_count: usize,
    pub total_recoverable_bytes: u64,
    pub corrupted_part_files_cleaned: usize,
    pub items: Vec<RecoverableTransferInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkQualityEvent {
    pub quality: String,
    pub average_latency_ms: u64,
    pub active_connections: usize,
    pub congestion_detected: bool,
    pub recommended_chunk_size_bytes: usize,
    pub interface_ip: String,
    pub timestamp: i64,
}
