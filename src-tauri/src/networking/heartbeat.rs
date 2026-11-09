use chrono::Utc;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub const HEARTBEAT_INTERVAL_SECONDS: u64 = 5;
pub const HEARTBEAT_TIMEOUT_MS: i64 = 15_000;

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatEventPayload {
    pub device_id: String,
    pub latency_ms: u64,
    pub timestamp: i64,
}
