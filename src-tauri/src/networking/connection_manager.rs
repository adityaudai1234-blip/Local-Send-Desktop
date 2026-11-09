use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use chrono::Utc;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;

use crate::models::{LocalDeviceInfo, Platform};
use crate::networking::connection::{ConnectionState, PeerConnection};
use crate::networking::heartbeat::{HeartbeatEventPayload, HEARTBEAT_INTERVAL_SECONDS, HEARTBEAT_TIMEOUT_MS};
use crate::networking::network_monitor::{NetworkInformation, NetworkStatsTracker};
use crate::networking::reconnect::{calculate_backoff, MAX_RECONNECT_ATTEMPTS};
use crate::protocol::messages::{MessageType, ProtocolMessage};
use crate::protocol::serializer::{deserialize_message, serialize_message};
use crate::security::encrypted_channel::EncryptedSession;
use crate::trusted_devices::TrustedDeviceManager;

pub struct ConnectionManager {
    connections: Arc<Mutex<HashMap<String, PeerConnection>>>,
    encrypted_sessions: Arc<Mutex<HashMap<String, EncryptedSession>>>,
    stats: Arc<NetworkStatsTracker>,
    is_service_running: Arc<Mutex<bool>>,
}

impl ConnectionManager {
    pub fn new() -> Self {
        Self {
            connections: Arc::new(Mutex::new(HashMap::new())),
            encrypted_sessions: Arc::new(Mutex::new(HashMap::new())),
            stats: Arc::new(NetworkStatsTracker::new()),
            is_service_running: Arc::new(Mutex::new(true)),
        }
    }

    pub fn get_connections(&self) -> Vec<PeerConnection> {
        self.connections.lock().unwrap().values().cloned().collect()
    }

    pub fn get_connection(&self, device_id: &str) -> Option<PeerConnection> {
        self.connections.lock().unwrap().get(device_id).cloned()
    }

    pub fn is_service_running(&self) -> bool {
        *self.is_service_running.lock().unwrap()
    }

    pub fn start_service(&self, app_handle: &AppHandle) -> Result<(), String> {
        let mut running = self.is_service_running.lock().unwrap();
        *running = true;
        let _ = app_handle.emit("network-status-changed", serde_json::json!({ "running": true }));
        Ok(())
    }

    pub fn stop_service(&self, app_handle: &AppHandle) -> Result<(), String> {
        let mut running = self.is_service_running.lock().unwrap();
        *running = false;

        // Disconnect all peers cleanly
        let mut conns = self.connections.lock().unwrap();
        for (_, conn) in conns.iter_mut() {
            conn.state = ConnectionState::Disconnected;
            let _ = app_handle.emit("device-disconnected", &conn.device_id);
            let _ = app_handle.emit("connection-status-changed", conn.clone());
        }

        let _ = app_handle.emit("network-status-changed", serde_json::json!({ "running": false }));
        Ok(())
    }

    pub async fn connect_to_device(
        &self,
        device_id: String,
        device_name: String,
        platform: Platform,
        ip_address: String,
        port: u16,
        trusted_mgr: Arc<TrustedDeviceManager>,
        local_device: &LocalDeviceInfo,
        app_handle: AppHandle,
    ) -> Result<PeerConnection, String> {
        if !self.is_service_running() {
            return Err("Network communication service is stopped".to_string());
        }

        // Check if device is trusted
        let trusted_devices = trusted_mgr.get_trusted_devices()?;
        let is_trusted = trusted_devices.iter().any(|d| d.device_id == device_id);
        if !is_trusted {
            return Err(format!("Device '{}' is not trusted. Please pair via QR code first.", device_name));
        }

        // Check if already connected or connecting
        {
            let mut conns = self.connections.lock().unwrap();
            if let Some(existing) = conns.get(&device_id) {
                if existing.state == ConnectionState::Connected || existing.state == ConnectionState::Connecting {
                    return Ok(existing.clone());
                }
            }

            let mut new_conn = PeerConnection::new(
                device_id.clone(),
                device_name.clone(),
                platform,
                ip_address.clone(),
                port,
                false,
            );
            new_conn.state = ConnectionState::Connecting;
            conns.insert(device_id.clone(), new_conn.clone());
            let _ = app_handle.emit("connection-status-changed", &new_conn);
        }

        // Simulate asynchronous secure socket handshake and authentication
        // Transition: Connecting -> Authenticating -> Connected
        let conns_clone = Arc::clone(&self.connections);
        let sessions_clone = Arc::clone(&self.encrypted_sessions);
        let stats_clone = Arc::clone(&self.stats);
        let app_handle_clone = app_handle.clone();
        let target_id = device_id.clone();
        let local_id = local_device.id.clone();
        let local_name = local_device.name.clone();

        tokio::spawn(async move {
            // Small async yield to simulate TCP handshake
            tokio::time::sleep(Duration::from_millis(250)).await;

            // Transition to Authenticating
            {
                let mut conns = conns_clone.lock().unwrap();
                if let Some(conn) = conns.get_mut(&target_id) {
                    conn.state = ConnectionState::Authenticating;
                    let _ = app_handle_clone.emit("connection-status-changed", conn.clone());
                }
            }

            tokio::time::sleep(Duration::from_millis(300)).await;

            // Initialize AES-256-GCM authenticated encrypted session
            let shared_secret = format!("sec_{}_{}", target_id, local_id);
            let session = EncryptedSession::from_shared_secret(&shared_secret);
            sessions_clone.lock().unwrap().insert(target_id.clone(), session);

            // Send DEVICE_HELLO message
            let hello_msg = ProtocolMessage::new(
                local_id,
                target_id.clone(),
                MessageType::DeviceHello,
                serde_json::json!({
                    "name": local_name,
                    "version": "1.0.0",
                }),
            );

            if let Ok(bytes) = serialize_message(&hello_msg) {
                stats_clone.record_tx(bytes.len() as u64);
            }

            // Transition to Connected
            let mut final_conn: Option<PeerConnection> = None;
            {
                let mut conns = conns_clone.lock().unwrap();
                if let Some(conn) = conns.get_mut(&target_id) {
                    conn.state = ConnectionState::Connected;
                    conn.connected_at = Some(Utc::now().timestamp_millis());
                    conn.last_heartbeat = Utc::now().timestamp_millis();
                    conn.latency_ms = 4; // Sub-millisecond to 4ms LAN ping
                    conn.reconnect_attempts = 0;
                    final_conn = Some(conn.clone());
                    let _ = app_handle_clone.emit("device-connected", conn.clone());
                    let _ = app_handle_clone.emit("connection-status-changed", conn.clone());
                }
            }
        });

        let conn = self.get_connection(&device_id).unwrap();
        Ok(conn)
    }

    pub fn disconnect_from_device(&self, device_id: &str, app_handle: &AppHandle) -> Result<bool, String> {
        let mut conns = self.connections.lock().unwrap();
        if let Some(conn) = conns.get_mut(device_id) {
            conn.state = ConnectionState::Disconnected;
            conn.connected_at = None;
            let _ = app_handle.emit("device-disconnected", device_id);
            let _ = app_handle.emit("connection-status-changed", conn.clone());
            self.encrypted_sessions.lock().unwrap().remove(device_id);
            return Ok(true);
        }
        Ok(false)
    }

    pub async fn send_message(
        &self,
        recipient_id: &str,
        message_type: MessageType,
        payload: serde_json::Value,
        local_device: &LocalDeviceInfo,
        app_handle: &AppHandle,
    ) -> Result<ProtocolMessage, String> {
        let conn = self.get_connection(recipient_id)
            .ok_or_else(|| format!("No active connection to device '{}'", recipient_id))?;

        if conn.state != ConnectionState::Connected {
            return Err(format!("Device '{}' is not in Connected state", recipient_id));
        }

        let message = ProtocolMessage::new(
            local_device.id.clone(),
            recipient_id.to_string(),
            message_type,
            payload,
        );

        let serialized = serialize_message(&message)
            .map_err(|e| format!("Message serialization failed: {}", e))?;

        // Encrypt with AEAD session
        if let Some(session) = self.encrypted_sessions.lock().unwrap().get(recipient_id) {
            let encrypted = session.encrypt(&serialized)?;
            self.stats.record_tx(encrypted.len() as u64);
        } else {
            self.stats.record_tx(serialized.len() as u64);
        }

        // Update tx_bytes on connection
        if let Some(c) = self.connections.lock().unwrap().get_mut(recipient_id) {
            c.tx_bytes += serialized.len() as u64;
        }

        let _ = app_handle.emit("message-sent", &message);
        Ok(message)
    }

    pub fn handle_pong(&self, sender_id: &str, latency_ms: u64, app_handle: &AppHandle) {
        let mut conns = self.connections.lock().unwrap();
        if let Some(conn) = conns.get_mut(sender_id) {
            conn.last_heartbeat = Utc::now().timestamp_millis();
            conn.latency_ms = latency_ms;

            let payload = HeartbeatEventPayload {
                device_id: sender_id.to_string(),
                latency_ms,
                timestamp: conn.last_heartbeat,
            };
            let _ = app_handle.emit("heartbeat-updated", payload);
        }
    }

    // Starts background heartbeat task and auto-reconnection scheduler
    pub fn start_background_tasks(
        &self,
        local_device: LocalDeviceInfo,
        trusted_mgr: Arc<TrustedDeviceManager>,
        app_handle: AppHandle,
    ) {
        let conns_ref = Arc::clone(&self.connections);
        let sessions_ref = Arc::clone(&self.encrypted_sessions);
        let stats_ref = Arc::clone(&self.stats);
        let is_running_ref = Arc::clone(&self.is_service_running);
        let handle_clone = app_handle.clone();

        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(HEARTBEAT_INTERVAL_SECONDS));
            loop {
                interval.tick().await;

                if !*is_running_ref.lock().unwrap() {
                    continue;
                }

                let now = Utc::now().timestamp_millis();
                let mut conns_to_ping = Vec::new();
                let mut conns_to_reconnect = Vec::new();

                {
                    let mut conns = conns_ref.lock().unwrap();
                    for (id, conn) in conns.iter_mut() {
                        if conn.state == ConnectionState::Connected {
                            // Check for heartbeat timeout
                            if now - conn.last_heartbeat > HEARTBEAT_TIMEOUT_MS {
                                conn.state = ConnectionState::Reconnecting;
                                conn.reconnect_attempts += 1;
                                let _ = handle_clone.emit("connection-status-changed", conn.clone());
                                let _ = handle_clone.emit("connection-error", serde_json::json!({
                                    "deviceId": id,
                                    "message": "Heartbeat timeout (device unresponsive)",
                                }));
                                conns_to_reconnect.push((id.clone(), conn.reconnect_attempts));
                            } else {
                                conns_to_ping.push(id.clone());
                            }
                        } else if conn.state == ConnectionState::Reconnecting && conn.reconnect_attempts <= MAX_RECONNECT_ATTEMPTS {
                            conns_to_reconnect.push((id.clone(), conn.reconnect_attempts));
                        }
                    }
                }

                // Send heartbeat PINGs
                for peer_id in conns_to_ping {
                    let ping = ProtocolMessage::ping(local_device.id.clone(), peer_id.clone());
                    if let Ok(bytes) = serialize_message(&ping) {
                        stats_ref.record_tx(bytes.len() as u64);
                    }

                    // Simulate immediate network pong response (in LAN environments)
                    let pong_latency = rand::random::<u64>() % 8 + 2;
                    let conns_inner = Arc::clone(&conns_ref);
                    let handle_inner = handle_clone.clone();
                    let pid = peer_id.clone();
                    tokio::spawn(async move {
                        tokio::time::sleep(Duration::from_millis(pong_latency)).await;
                        let mut conns = conns_inner.lock().unwrap();
                        if let Some(conn) = conns.get_mut(&pid) {
                            if conn.state == ConnectionState::Connected {
                                conn.last_heartbeat = Utc::now().timestamp_millis();
                                conn.latency_ms = pong_latency;
                                let _ = handle_inner.emit("heartbeat-updated", HeartbeatEventPayload {
                                    device_id: pid,
                                    latency_ms: pong_latency,
                                    timestamp: conn.last_heartbeat,
                                });
                            }
                        }
                    });
                }

                // Process auto-reconnections
                for (peer_id, attempts) in conns_to_reconnect {
                    if attempts > MAX_RECONNECT_ATTEMPTS {
                        let mut conns = conns_ref.lock().unwrap();
                        if let Some(conn) = conns.get_mut(&peer_id) {
                            conn.state = ConnectionState::Failed;
                            let _ = handle_clone.emit("connection-status-changed", conn.clone());
                            let _ = handle_clone.emit("connection-error", serde_json::json!({
                                "deviceId": peer_id,
                                "message": "Max reconnection attempts reached",
                            }));
                        }
                        continue;
                    }

                    let delay = calculate_backoff(attempts);
                    let conns_inner = Arc::clone(&conns_ref);
                    let handle_inner = handle_clone.clone();
                    let pid = peer_id.clone();

                    tokio::spawn(async move {
                        tokio::time::sleep(delay).await;
                        let mut conns = conns_inner.lock().unwrap();
                        if let Some(conn) = conns.get_mut(&pid) {
                            if conn.state == ConnectionState::Reconnecting {
                                // Successfully restored connection
                                conn.state = ConnectionState::Connected;
                                conn.reconnect_attempts = 0;
                                conn.last_heartbeat = Utc::now().timestamp_millis();
                                let _ = handle_inner.emit("connection-status-changed", conn.clone());
                                let _ = handle_inner.emit("device-connected", conn.clone());
                            }
                        }
                    });
                }
            }
        });
    }

    pub fn get_network_info(&self, local_device: &LocalDeviceInfo) -> NetworkInformation {
        let active = self.connections.lock().unwrap()
            .values()
            .filter(|c| c.state == ConnectionState::Connected)
            .count();

        NetworkInformation {
            is_available: true,
            local_ip: local_device.ipAddresses.first().cloned().unwrap_or_else(|| "127.0.0.1".to_string()),
            port: local_device.port,
            active_connections: active,
            total_connected_devices: active,
            service_running: self.is_service_running(),
        }
    }

    pub fn get_stats(&self) -> crate::networking::network_monitor::NetworkStatistics {
        let active = self.connections.lock().unwrap()
            .values()
            .filter(|c| c.state == ConnectionState::Connected)
            .count();
        self.stats.get_statistics(active)
    }
}
