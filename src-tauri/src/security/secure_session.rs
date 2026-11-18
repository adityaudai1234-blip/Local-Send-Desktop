use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use super::encryption::{
    build_deterministic_nonce, decode_b64, decrypt_aead, encode_b64, encrypt_aead, CipherSuite,
    EncryptedChunkFrame, EncryptedControlEnvelope,
};
use super::key_derivation::{derive_keys_from_shared_secret, DerivedSessionKeys};
use super::replay_protection::{ReplayProtector, DEFAULT_SESSION_TTL_MS};
use crate::audit::{SecurityAuditLogger, SecurityEventType, SecuritySeverity};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecureSessionSummary {
    pub session_id: String,
    pub peer_device_id: String,
    pub peer_fingerprint: String,
    pub cipher_suite: CipherSuite,
    pub sas_code: String,
    pub is_authenticated: bool,
    pub established_at: i64,
    pub expires_at: i64,
    pub tx_messages: u64,
    pub rx_messages: u64,
    pub tx_chunks: u64,
}

pub struct SecureChannelSession {
    pub session_id: String,
    pub peer_device_id: String,
    pub peer_fingerprint: String,
    pub cipher_suite: CipherSuite,
    pub keys: DerivedSessionKeys,
    pub is_authenticated: bool,
    pub established_at: i64,
    pub expires_at: i64,
    pub tx_control_seq: u64,
    pub tx_file_seq: u64,
    pub rx_control_count: u64,
    pub replay_protector: ReplayProtector,
}

impl SecureChannelSession {
    pub fn summary(&self) -> SecureSessionSummary {
        SecureSessionSummary {
            session_id: self.session_id.clone(),
            peer_device_id: self.peer_device_id.clone(),
            peer_fingerprint: self.peer_fingerprint.clone(),
            cipher_suite: self.cipher_suite,
            sas_code: self.keys.sas_code.clone(),
            is_authenticated: self.is_authenticated,
            established_at: self.established_at,
            expires_at: self.expires_at,
            tx_messages: self.tx_control_seq,
            rx_messages: self.rx_control_count,
            tx_chunks: self.tx_file_seq,
        }
    }

    pub fn encrypt_control(&mut self, plaintext: &[u8]) -> Result<EncryptedControlEnvelope, String> {
        let now = Utc::now().timestamp_millis();
        if now > self.expires_at {
            return Err("Secure session expired; re-authentication required".to_string());
        }
        let seq = self.tx_control_seq;
        self.tx_control_seq += 1;
        let msg_id = Uuid::new_v4().to_string();
        let nonce = build_deterministic_nonce(*b"CTRL", seq);
        let aad = format!("{}|{}|{}|{}", self.session_id, msg_id, seq, now);

        let ct = encrypt_aead(
            self.cipher_suite,
            &self.keys.control_tx_key,
            &nonce,
            plaintext,
            aad.as_bytes(),
        )?;

        Ok(EncryptedControlEnvelope {
            session_id: self.session_id.clone(),
            message_id: msg_id,
            sequence: seq,
            timestamp: now,
            nonce_hex: hex::encode(nonce),
            cipher_suite: self.cipher_suite,
            ciphertext_b64: encode_b64(&ct),
        })
    }

    pub fn decrypt_control(&mut self, env: &EncryptedControlEnvelope) -> Result<Vec<u8>, String> {
        self.replay_protector
            .validate_incoming(&env.session_id, &env.message_id, env.sequence, env.timestamp)
            .map_err(|e| format!("Replay protection rejected message: {}", e))?;

        let nonce_vec = hex::decode(&env.nonce_hex)
            .map_err(|_| "Invalid nonce hex in encrypted envelope".to_string())?;
        if nonce_vec.len() != 12 {
            return Err("Invalid nonce length (must be 12 bytes)".to_string());
        }
        let mut nonce = [0u8; 12];
        nonce.copy_from_slice(&nonce_vec);

        let ct = decode_b64(&env.ciphertext_b64)?;
        let aad = format!(
            "{}|{}|{}|{}",
            env.session_id, env.message_id, env.sequence, env.timestamp
        );

        let pt = decrypt_aead(
            env.cipher_suite,
            &self.keys.control_rx_key,
            &nonce,
            &ct,
            aad.as_bytes(),
        )?;
        self.rx_control_count += 1;
        Ok(pt)
    }

    pub fn encrypt_chunk(
        &mut self,
        transfer_id: &str,
        file_id: &str,
        offset: u64,
        plaintext_chunk: &[u8],
    ) -> Result<EncryptedChunkFrame, String> {
        let now = Utc::now().timestamp_millis();
        if now > self.expires_at {
            return Err("Secure session expired during transfer".to_string());
        }
        let seq = self.tx_file_seq;
        self.tx_file_seq += 1;
        let nonce = build_deterministic_nonce(*b"FILE", seq);
        let aad = format!("{}|{}|{}|{}", transfer_id, file_id, seq, offset);

        let ct = encrypt_aead(
            self.cipher_suite,
            &self.keys.file_tx_key,
            &nonce,
            plaintext_chunk,
            aad.as_bytes(),
        )?;

        Ok(EncryptedChunkFrame {
            transfer_id: transfer_id.to_string(),
            file_id: file_id.to_string(),
            chunk_sequence: seq,
            offset,
            nonce_hex: hex::encode(nonce),
            cipher_suite: self.cipher_suite,
            ciphertext_b64: encode_b64(&ct),
        })
    }

    pub fn decrypt_chunk(&self, frame: &EncryptedChunkFrame) -> Result<Vec<u8>, String> {
        let nonce_vec = hex::decode(&frame.nonce_hex)
            .map_err(|_| "Invalid chunk nonce hex".to_string())?;
        if nonce_vec.len() != 12 {
            return Err("Invalid chunk nonce length".to_string());
        }
        let mut nonce = [0u8; 12];
        nonce.copy_from_slice(&nonce_vec);

        let ct = decode_b64(&frame.ciphertext_b64)?;
        let aad = format!(
            "{}|{}|{}|{}",
            frame.transfer_id, frame.file_id, frame.chunk_sequence, frame.offset
        );

        decrypt_aead(
            frame.cipher_suite,
            &self.keys.file_rx_key,
            &nonce,
            &ct,
            aad.as_bytes(),
        )
    }
}

pub struct SecureSessionManager {
    sessions: Mutex<HashMap<String, SecureChannelSession>>,
    audit: Arc<SecurityAuditLogger>,
}

impl SecureSessionManager {
    pub fn new(audit: Arc<SecurityAuditLogger>) -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            audit,
        }
    }

    pub fn establish_session(
        &self,
        session_id: String,
        peer_device_id: String,
        peer_device_name: Option<&str>,
        peer_fingerprint: String,
        shared_secret: &[u8],
        is_initiator: bool,
        cipher_suite: CipherSuite,
        app_handle: Option<&AppHandle>,
    ) -> Result<SecureSessionSummary, String> {
        let keys = derive_keys_from_shared_secret(shared_secret, &session_id, is_initiator)?;
        let now = Utc::now().timestamp_millis();
        let expires_at = now + DEFAULT_SESSION_TTL_MS;

        let channel = SecureChannelSession {
            session_id: session_id.clone(),
            peer_device_id: peer_device_id.clone(),
            peer_fingerprint: peer_fingerprint.clone(),
            cipher_suite,
            keys,
            is_authenticated: true,
            established_at: now,
            expires_at,
            tx_control_seq: 0,
            tx_file_seq: 0,
            rx_control_count: 0,
            replay_protector: ReplayProtector::new(session_id, expires_at),
        };

        let summary = channel.summary();
        self.sessions
            .lock()
            .unwrap()
            .insert(peer_device_id.clone(), channel);

        self.audit.log_event(
            SecurityEventType::SecureSessionEstablished,
            SecuritySeverity::Info,
            Some(&peer_device_id),
            peer_device_name,
            &format!(
                "E2E {} session established (SAS {}, key fingerprint {})",
                cipher_suite.as_str(),
                summary.sas_code,
                peer_fingerprint
            ),
            None,
            app_handle,
        );

        if let Some(handle) = app_handle {
            let _ = handle.emit("security:sessions-updated", self.get_active_summaries());
        }

        Ok(summary)
    }

    pub fn terminate_session(
        &self,
        peer_device_id: &str,
        reason: &str,
        app_handle: Option<&AppHandle>,
    ) -> bool {
        let removed = self.sessions.lock().unwrap().remove(peer_device_id).is_some();
        if removed {
            self.audit.log_event(
                SecurityEventType::SecureSessionTerminated,
                SecuritySeverity::Info,
                Some(peer_device_id),
                None,
                &format!("Encrypted session terminated: {}", reason),
                None,
                app_handle,
            );
            if let Some(handle) = app_handle {
                let _ = handle.emit("security:sessions-updated", self.get_active_summaries());
            }
        }
        removed
    }

    pub fn has_verified_session(&self, peer_device_id: &str) -> bool {
        let now = Utc::now().timestamp_millis();
        self.sessions
            .lock()
            .unwrap()
            .get(peer_device_id)
            .map(|s| s.is_authenticated && now <= s.expires_at)
            .unwrap_or(false)
    }

    pub fn get_active_summaries(&self) -> Vec<SecureSessionSummary> {
        let now = Utc::now().timestamp_millis();
        self.sessions
            .lock()
            .unwrap()
            .values()
            .filter(|s| now <= s.expires_at)
            .map(|s| s.summary())
            .collect()
    }

    pub fn encrypt_control_for_peer(
        &self,
        peer_device_id: &str,
        plaintext: &[u8],
    ) -> Result<EncryptedControlEnvelope, String> {
        let mut lock = self.sessions.lock().unwrap();
        let session = lock
            .get_mut(peer_device_id)
            .ok_or_else(|| format!("No active encrypted session for peer {}", peer_device_id))?;
        session.encrypt_control(plaintext)
    }

    pub fn decrypt_control_from_peer(
        &self,
        peer_device_id: &str,
        envelope: &EncryptedControlEnvelope,
        app_handle: Option<&AppHandle>,
    ) -> Result<Vec<u8>, String> {
        let mut lock = self.sessions.lock().unwrap();
        let session = lock
            .get_mut(peer_device_id)
            .ok_or_else(|| format!("No active encrypted session for peer {}", peer_device_id))?;

        match session.decrypt_control(envelope) {
            Ok(pt) => Ok(pt),
            Err(err) => {
                if err.contains("Replay") {
                    self.audit.log_event(
                        SecurityEventType::ReplayAttemptDetected,
                        SecuritySeverity::Critical,
                        Some(peer_device_id),
                        None,
                        "Replay attempt detected on control channel",
                        Some(&err),
                        app_handle,
                    );
                } else {
                    self.audit.log_event(
                        SecurityEventType::InvalidMessageRejected,
                        SecuritySeverity::Warning,
                        Some(peer_device_id),
                        None,
                        "Tampered or unauthenticated control envelope rejected",
                        Some(&err),
                        app_handle,
                    );
                }
                Err(err)
            }
        }
    }

    pub fn encrypt_chunk_for_peer(
        &self,
        peer_device_id: &str,
        transfer_id: &str,
        file_id: &str,
        offset: u64,
        chunk: &[u8],
    ) -> Result<EncryptedChunkFrame, String> {
        let mut lock = self.sessions.lock().unwrap();
        let session = lock
            .get_mut(peer_device_id)
            .ok_or_else(|| format!("No active encrypted session for peer {}", peer_device_id))?;
        session.encrypt_chunk(transfer_id, file_id, offset, chunk)
    }

    pub fn decrypt_chunk_from_peer(
        &self,
        peer_device_id: &str,
        frame: &EncryptedChunkFrame,
    ) -> Result<Vec<u8>, String> {
        let lock = self.sessions.lock().unwrap();
        let session = lock
            .get(peer_device_id)
            .ok_or_else(|| format!("No active encrypted session for peer {}", peer_device_id))?;
        session.decrypt_chunk(frame)
    }
}
