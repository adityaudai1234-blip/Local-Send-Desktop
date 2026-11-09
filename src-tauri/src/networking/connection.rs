use serde::{Deserialize, Serialize};
use crate::models::Platform;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionState {
    Disconnected,
    Connecting,
    Authenticating,
    Connected,
    Reconnecting,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerConnection {
    pub device_id: String,
    pub device_name: String,
    pub platform: Platform,
    pub ip_address: String,
    pub port: u16,
    pub state: ConnectionState,
    pub connected_at: Option<i64>,
    pub last_heartbeat: i64,
    pub latency_ms: u64,
    pub reconnect_attempts: u32,
    pub is_incoming: bool,
    pub tx_bytes: u64,
    pub rx_bytes: u64,
}

impl PeerConnection {
    pub fn new(
        device_id: String,
        device_name: String,
        platform: Platform,
        ip_address: String,
        port: u16,
        is_incoming: bool,
    ) -> Self {
        Self {
            device_id,
            device_name,
            platform,
            ip_address,
            port,
            state: ConnectionState::Connecting,
            connected_at: None,
            last_heartbeat: chrono::Utc::now().timestamp_millis(),
            latency_ms: 0,
            reconnect_attempts: 0,
            is_incoming,
            tx_bytes: 0,
            rx_bytes: 0,
        }
    }
}
