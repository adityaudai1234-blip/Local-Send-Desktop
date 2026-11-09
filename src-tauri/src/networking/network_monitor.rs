use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkInformation {
    pub is_available: bool,
    pub local_ip: String,
    pub port: u16,
    pub active_connections: usize,
    pub total_connected_devices: usize,
    pub service_running: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkStatistics {
    pub total_tx_bytes: u64,
    pub total_rx_bytes: u64,
    pub total_messages_sent: u64,
    pub total_messages_received: u64,
    pub active_connections_count: usize,
    pub uptime_seconds: u64,
}

pub struct NetworkStatsTracker {
    pub total_tx_bytes: AtomicU64,
    pub total_rx_bytes: AtomicU64,
    pub total_messages_sent: AtomicU64,
    pub total_messages_received: AtomicU64,
    pub started_at: i64,
}

impl NetworkStatsTracker {
    pub fn new() -> Self {
        Self {
            total_tx_bytes: AtomicU64::new(0),
            total_rx_bytes: AtomicU64::new(0),
            total_messages_sent: AtomicU64::new(0),
            total_messages_received: AtomicU64::new(0),
            started_at: chrono::Utc::now().timestamp(),
        }
    }

    pub fn record_tx(&self, bytes: u64) {
        self.total_tx_bytes.fetch_add(bytes, Ordering::Relaxed);
        self.total_messages_sent.fetch_add(1, Ordering::Relaxed);
    }

    pub fn record_rx(&self, bytes: u64) {
        self.total_rx_bytes.fetch_add(bytes, Ordering::Relaxed);
        self.total_messages_received.fetch_add(1, Ordering::Relaxed);
    }

    pub fn get_statistics(&self, active_count: usize) -> NetworkStatistics {
        let now = chrono::Utc::now().timestamp();
        let uptime = (now - self.started_at).max(0) as u64;

        NetworkStatistics {
            total_tx_bytes: self.total_tx_bytes.load(Ordering::Relaxed),
            total_rx_bytes: self.total_rx_bytes.load(Ordering::Relaxed),
            total_messages_sent: self.total_messages_sent.load(Ordering::Relaxed),
            total_messages_received: self.total_messages_received.load(Ordering::Relaxed),
            active_connections_count: active_count,
            uptime_seconds: uptime,
        }
    }
}
