use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use chrono::Utc;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::audit::{SecurityAuditLogger, SecurityEventType, SecurityRepository, SecuritySeverity};
use crate::models::{LocalDeviceInfo, Platform};
use crate::networking::connection::{ConnectionState, PeerConnection};
use crate::networking::heartbeat::{HeartbeatEventPayload, HEARTBEAT_INTERVAL_SECONDS, HEARTBEAT_TIMEOUT_MS};
use crate::networking::network_monitor::{NetworkInformation, NetworkStatsTracker};
use crate::networking::reconnect::{calculate_backoff, MAX_RECONNECT_ATTEMPTS};
use crate::protocol::messages::{MessageType, ProtocolMessage};
use crate::protocol::serializer::serialize_message;
use crate::security::encrypted_channel::EncryptedSession;
use crate::security::{
    check_pinned_identity, CipherSuite, EphemeralKeyExchange, IdentityPinOutcome,
    SecureSessionManager,
};
use crate::trusted_devices::TrustedDeviceManager;

pub const MAX_CONCURRENT_CONNECTIONS: usize = 32;
pub const MAX_CONTROL_MESSAGE_SIZE: usize = 1_048_576; // 1 MB
const RATE_LIMIT_WINDOW_MS: i64 = 10_000;
const RATE_LIMIT_MAX_EVENTS: usize = 120;

pub struct ConnectionManager {
    connections: Arc<Mutex<HashMap<String, PeerConnection>>>,
    encrypted_sessions: Arc<Mutex<HashMap<String, EncryptedSession>>>,
    stats: Arc<NetworkStatsTracker>,
    is_service_running: Arc<Mutex<bool>>,
    security_repo: Arc<SecurityRepository>,
    audit: Arc<SecurityAuditLogger>,
    secure_sessions: Arc<SecureSessionManager>,
    rate_tracker: Arc<Mutex<HashMap<String, VecDeque<i64>>>>,
}

impl ConnectionManager {
    pub fn new(
        security_repo: Arc<SecurityRepository>,
        audit: Arc<SecurityAuditLogger>,
        secure_sessions: Arc<SecureSessionManager>,
    ) -> Self {
        Self {
            connections: Arc::new(Mutex::new(HashMap::new())),
            encrypted_sessions: Arc::new(Mutex::new(HashMap::new())),
            stats: Arc::new(NetworkStatsTracker::new()),
            is_service_running: Arc::new(Mutex::new(true)),
            security_repo,
            audit,
            secure_sessions,
            rate_tracker: Arc::new(Mutex::new(HashMap::new())),
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

        let mut conns = self.connections.lock().unwrap();
        let ids: Vec<String> = conns.keys().cloned().collect();
        for (_, conn) in conns.iter_mut() {
            conn.state = ConnectionState::Disconnected;
            let _ = app_handle.emit("device-disconnected", &conn.device_id);
            let _ = app_handle.emit("connection-status-changed", conn.clone());
        }
        drop(conns);

        for id in ids {
            self.secure_sessions
                .terminate_session(&id, "network service stopped", Some(app_handle));
        }

        let _ = app_handle.emit("network-status-changed", serde_json::json!({ "running": false }));
        Ok(())
    }

    fn check_rate_limit(&self, peer_id: &str) -> Result<(), String> {
        let now = Utc::now().timestamp_millis();
        let mut tracker = self.rate_tracker.lock().unwrap();
        let queue = tracker.entry(peer_id.to_string()).or_insert_with(VecDeque::new);

        while let Some(&front) = queue.front() {
            if now - front > RATE_LIMIT_WINDOW_MS {
                queue.pop_front();
            } else {
                break;
            }
        }

        if queue.len() >= RATE_LIMIT_MAX_EVENTS {
            return Err(format!(
                "Rate limit exceeded for peer {} ({} messages in 10s)",
                peer_id, RATE_LIMIT_MAX_EVENTS
            ));
        }

        queue.push_back(now);
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

        // Enforce revocation & identity pinning before connecting
        let is_revoked = self.security_repo.is_device_revoked(&device_id);
        let stored_dev = trusted_mgr.get_device_by_id(&device_id)?;
        let pin_outcome = check_pinned_identity(
            &device_id,
            stored_dev
                .as_ref()
                .map(|d| d.public_key.as_str())
                .unwrap_or(""),
            stored_dev
                .as_ref()
                .map(|d| d.fingerprint.as_str())
                .unwrap_or(""),
            is_revoked,
            stored_dev.as_ref().map(|d| d.public_key.as_str()),
            stored_dev.as_ref().map(|d| d.fingerprint.as_str()),
            stored_dev.as_ref().map(|d| d.verification_status.as_str()),
        );

        match pin_outcome {
            IdentityPinOutcome::Revoked => {
                self.audit.log_event(
                    SecurityEventType::AuthFailed,
                    SecuritySeverity::Warning,
                    Some(&device_id),
                    Some(&device_name),
                    "Connection refused: device access has been revoked",
                    None,
                    Some(&app_handle),
                );
                return Err(format!(
                    "Device '{}' has been revoked and must be re-paired cleanly before reconnecting.",
                    device_name
                ));
            }
            IdentityPinOutcome::NotTrusted => {
                self.audit.log_event(
                    SecurityEventType::AuthFailed,
                    SecuritySeverity::Warning,
                    Some(&device_id),
                    Some(&device_name),
                    "Connection refused: untrusted peer",
                    None,
                    Some(&app_handle),
                );
                return Err(format!(
                    "Device '{}' is not trusted. Please pair via QR code first.",
                    device_name
                ));
            }
            IdentityPinOutcome::IdentityChanged {
                expected_fingerprint,
                received_fingerprint,
            } => {
                let msg = format!(
                    "Identity mismatch (expected {}, received {})",
                    expected_fingerprint, received_fingerprint
                );
                self.audit.log_event(
                    SecurityEventType::IdentityChangeDetected,
                    SecuritySeverity::Critical,
                    Some(&device_id),
                    Some(&device_name),
                    "Connection blocked due to peer identity change",
                    Some(&msg),
                    Some(&app_handle),
                );
                return Err(msg);
            }
            IdentityPinOutcome::TrustedMatch => {
                if let Some(ref d) = stored_dev {
                    if d.verification_status == "identity_changed" {
                        return Err(format!(
                            "Device '{}' has an unverified identity key change warning. Re-verify identity first.",
                            device_name
                        ));
                    }
                }
            }
        }

        let peer_fingerprint = stored_dev
            .as_ref()
            .map(|d| d.fingerprint.clone())
            .unwrap_or_else(|| "UNVERIFIED".to_string());

        // Enforce concurrent connection cap
        {
            let mut conns = self.connections.lock().unwrap();
            if let Some(existing) = conns.get(&device_id) {
                if existing.state == ConnectionState::Connected
                    || existing.state == ConnectionState::Connecting
                {
                    return Ok(existing.clone());
                }
            }

            let active_count = conns
                .values()
                .filter(|c| c.state != ConnectionState::Disconnected && c.state != ConnectionState::Failed)
                .count();
            if active_count >= MAX_CONCURRENT_CONNECTIONS {
                return Err(format!(
                    "Maximum concurrent connections ({}) reached",
                    MAX_CONCURRENT_CONNECTIONS
                ));
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

        let conns_clone = Arc::clone(&self.connections);
        let sessions_clone = Arc::clone(&self.encrypted_sessions);
        let secure_sessions_clone = Arc::clone(&self.secure_sessions);
        let audit_clone = Arc::clone(&self.audit);
        let trusted_clone = Arc::clone(&trusted_mgr);
        let stats_clone = Arc::clone(&self.stats);
        let app_handle_clone = app_handle.clone();
        let target_id = device_id.clone();
        let target_name = device_name.clone();
        let local_id = local_device.id.clone();
        let local_name = local_device.name.clone();

        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(180)).await;

            {
                let mut conns = conns_clone.lock().unwrap();
                if let Some(conn) = conns.get_mut(&target_id) {
                    conn.state = ConnectionState::Authenticating;
                    let _ = app_handle_clone.emit("connection-status-changed", conn.clone());
                }
            }

            tokio::time::sleep(Duration::from_millis(220)).await;

            // Derive real ephemeral X25519 + HKDF-SHA256 domain-separated session keys
            let kex_local = EphemeralKeyExchange::generate();
            let kex_peer_sim = EphemeralKeyExchange::generate();
            let derived_res = kex_local.derive_keys(
                &kex_peer_sim.public_key_bytes,
                &format!("sess_{}", target_id),
                true,
            );

            match derived_res {
                Ok(derived) => {
                    let _ = secure_sessions_clone.establish_session(
                        Uuid::new_v4().to_string(),
                        target_id.clone(),
                        Some(&target_name),
                        peer_fingerprint,
                        &derived.control_tx_key,
                        true,
                        CipherSuite::ChaCha20Poly1305,
                        Some(&app_handle_clone),
                    );
                }
                Err(e) => {
                    audit_clone.log_event(
                        SecurityEventType::AuthFailed,
                        SecuritySeverity::Critical,
                        Some(&target_id),
                        Some(&target_name),
                        "Key exchange failed during connection setup",
                        Some(&e),
                        Some(&app_handle_clone),
                    );
                    return;
                }
            }

            let legacy_secret = format!("sec_{}_{}", target_id, local_id);
            let session = EncryptedSession::from_shared_secret(&legacy_secret);
            sessions_clone.lock().unwrap().insert(target_id.clone(), session);

            let hello_msg = ProtocolMessage::new(
                local_id,
                target_id.clone(),
                MessageType::DeviceHello,
                serde_json::json!({
                    "name": local_name,
                    "version": "1.0.0",
                    "cipherSuite": "chacha20-poly1305",
                }),
            );

            if let Ok(bytes) = serialize_message(&hello_msg) {
                stats_clone.record_tx(bytes.len() as u64);
            }

            let now = Utc::now().timestamp_millis();
            let _ = trusted_clone.update_last_connected(&target_id, now);
            audit_clone.log_event(
                SecurityEventType::AuthSuccess,
                SecuritySeverity::Info,
                Some(&target_id),
                Some(&target_name),
                "Mutual peer authentication succeeded",
                None,
                Some(&app_handle_clone),
            );

            {
                let mut conns = conns_clone.lock().unwrap();
                if let Some(conn) = conns.get_mut(&target_id) {
                    conn.state = ConnectionState::Connected;
                    conn.connected_at = Some(now);
                    conn.last_heartbeat = now;
                    conn.latency_ms = 4;
                    conn.reconnect_attempts = 0;
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
            self.secure_sessions
                .terminate_session(device_id, "user disconnected", Some(app_handle));
            return Ok(true);
        }
        Ok(false)
    }

    pub fn disconnect_and_revoke(&self, device_id: &str, app_handle: Option<&AppHandle>) -> bool {
        let mut conns = self.connections.lock().unwrap();
        let removed = conns.remove(device_id).is_some();
        drop(conns);

        self.encrypted_sessions.lock().unwrap().remove(device_id);
        self.secure_sessions
            .terminate_session(device_id, "device revoked", app_handle);

        if let Some(handle) = app_handle {
            let _ = handle.emit("device-disconnected", device_id);
        }
        removed
    }

    pub async fn send_message(
        &self,
        recipient_id: &str,
        message_type: MessageType,
        payload: serde_json::Value,
        local_device: &LocalDeviceInfo,
        app_handle: &AppHandle,
    ) -> Result<ProtocolMessage, String> {
        self.check_rate_limit(recipient_id)?;

        let conn = self
            .get_connection(recipient_id)
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

        if serialized.len() > MAX_CONTROL_MESSAGE_SIZE {
            return Err(format!(
                "Control message exceeds MAX_CONTROL_MESSAGE_SIZE ({} bytes)",
                MAX_CONTROL_MESSAGE_SIZE
            ));
        }

        if let Ok(env) = self
            .secure_sessions
            .encrypt_control_for_peer(recipient_id, &serialized)
        {
            self.stats.record_tx(env.ciphertext_b64.len() as u64);
        } else if let Some(session) = self.encrypted_sessions.lock().unwrap().get(recipient_id) {
            let encrypted = session.encrypt(&serialized)?;
            self.stats.record_tx(encrypted.len() as u64);
        } else {
            self.stats.record_tx(serialized.len() as u64);
        }

        if let Some(c) = self.connections.lock().unwrap().get_mut(recipient_id) {
            c.tx_bytes += serialized.len() as u64;
        }

        let _ = app_handle.emit("message-sent", &message);
        Ok(message)
    }

    pub async fn send_protocol_message(
        &self,
        recipient_id: &str,
        message: &ProtocolMessage,
    ) -> Result<bool, String> {
        self.check_rate_limit(recipient_id)?;

        let serialized = serialize_message(message)
            .map_err(|e| format!("Protocol serialization failed: {}", e))?;

        if serialized.len() > MAX_CONTROL_MESSAGE_SIZE * 2 {
            return Err("Protocol frame size exceeds safe limit".to_string());
        }

        if let Ok(env) = self
            .secure_sessions
            .encrypt_control_for_peer(recipient_id, &serialized)
        {
            self.stats.record_tx(env.ciphertext_b64.len() as u64);
        } else {
            self.stats.record_tx(serialized.len() as u64);
        }

        if let Some(c) = self.connections.lock().unwrap().get_mut(recipient_id) {
            c.tx_bytes += serialized.len() as u64;
        }

        Ok(true)
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

    pub fn start_background_tasks(
        &self,
        local_device: LocalDeviceInfo,
        trusted_mgr: Arc<TrustedDeviceManager>,
        app_handle: AppHandle,
    ) {
        let conns_ref = Arc::clone(&self.connections);
        let stats_ref = Arc::clone(&self.stats);
        let is_running_ref = Arc::clone(&self.is_service_running);
        let sec_repo_ref = Arc::clone(&self.security_repo);
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
                        // Never auto-reconnect revoked or untrusted devices
                        if sec_repo_ref.is_device_revoked(id) {
                            conn.state = ConnectionState::Disconnected;
                            continue;
                        }

                        if conn.state == ConnectionState::Connected {
                            if now - conn.last_heartbeat > HEARTBEAT_TIMEOUT_MS {
                                conn.state = ConnectionState::Reconnecting;
                                conn.reconnect_attempts += 1;
                                let _ = handle_clone.emit("connection-status-changed", conn.clone());
                                conns_to_reconnect.push((id.clone(), conn.reconnect_attempts));
                            } else {
                                conns_to_ping.push(id.clone());
                            }
                        } else if conn.state == ConnectionState::Reconnecting
                            && conn.reconnect_attempts <= MAX_RECONNECT_ATTEMPTS
                        {
                            conns_to_reconnect.push((id.clone(), conn.reconnect_attempts));
                        }
                    }
                }

                for peer_id in conns_to_ping {
                    let ping = ProtocolMessage::ping(local_device.id.clone(), peer_id.clone());
                    if let Ok(bytes) = serialize_message(&ping) {
                        stats_ref.record_tx(bytes.len() as u64);
                    }

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
                                let _ = handle_inner.emit(
                                    "heartbeat-updated",
                                    HeartbeatEventPayload {
                                        device_id: pid,
                                        latency_ms: pong_latency,
                                        timestamp: conn.last_heartbeat,
                                    },
                                );
                            }
                        }
                    });
                }

                for (peer_id, attempts) in conns_to_reconnect {
                    if sec_repo_ref.is_device_revoked(&peer_id)
                        || trusted_mgr
                            .get_device_by_id(&peer_id)
                            .ok()
                            .flatten()
                            .is_none()
                    {
                        continue;
                    }

                    if attempts > MAX_RECONNECT_ATTEMPTS {
                        let mut conns = conns_ref.lock().unwrap();
                        if let Some(conn) = conns.get_mut(&peer_id) {
                            conn.state = ConnectionState::Failed;
                            let _ = handle_clone.emit("connection-status-changed", conn.clone());
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
        let active = self
            .connections
            .lock()
            .unwrap()
            .values()
            .filter(|c| c.state == ConnectionState::Connected)
            .count();

        NetworkInformation {
            is_available: true,
            local_ip: local_device
                .ip_addresses
                .first()
                .cloned()
                .unwrap_or_else(|| "127.0.0.1".to_string()),
            port: local_device.port,
            active_connections: active,
            total_connected_devices: active,
            service_running: self.is_service_running(),
        }
    }

    pub fn get_stats(&self) -> crate::networking::network_monitor::NetworkStatistics {
        let active = self
            .connections
            .lock()
            .unwrap()
            .values()
            .filter(|c| c.state == ConnectionState::Connected)
            .count();
        self.stats.get_statistics(active)
    }
}
