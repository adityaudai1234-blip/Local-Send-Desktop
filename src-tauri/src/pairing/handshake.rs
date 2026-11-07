use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use uuid::Uuid;
use crate::models::Platform;
use crate::pairing::session::PairingSession;
use crate::security::generate_verification_code;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingRequest {
    pub request_id: String,
    pub session_id: String,
    pub from_device_id: String,
    pub from_device_name: String,
    pub from_platform: Platform,
    pub from_device_model: String,
    pub from_ip_address: String,
    pub from_port: u16,
    pub from_public_key: String,
    pub from_fingerprint: String,
    pub verification_code: String,
    pub timestamp: i64,
    pub status: String, // "pending", "accepted", "rejected", "expired"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingResponse {
    pub success: bool,
    pub request_id: String,
    pub auth_token: Option<String>,
    pub message: String,
}

pub struct HandshakeManager {
    active_session: Mutex<Option<PairingSession>>,
    pending_requests: Mutex<HashMap<String, PairingRequest>>,
}

impl HandshakeManager {
    pub fn new() -> Self {
        Self {
            active_session: Mutex::new(None),
            pending_requests: Mutex::new(HashMap::new()),
        }
    }

    pub fn set_session(&self, session: PairingSession) {
        let mut current = self.active_session.lock().unwrap();
        *current = Some(session);
    }

    pub fn get_session(&self) -> Option<PairingSession> {
        let current = self.active_session.lock().unwrap();
        if let Some(ref s) = *current {
            if s.is_expired() {
                return None;
            }
            return Some(s.clone());
        }
        None
    }

    pub fn cancel_session(&self) -> bool {
        let mut current = self.active_session.lock().unwrap();
        let was_active = current.is_some();
        *current = None;
        let mut reqs = self.pending_requests.lock().unwrap();
        reqs.clear();
        was_active
    }

    pub fn handle_incoming_request(
        &self,
        session_id: &str,
        from_device_id: String,
        from_device_name: String,
        from_platform: Platform,
        from_device_model: String,
        from_ip_address: String,
        from_port: u16,
        from_public_key: String,
        from_fingerprint: String,
    ) -> Result<PairingRequest, String> {
        let session = match self.get_session() {
            Some(s) => s,
            None => return Err("No active pairing session or session has expired".to_string()),
        };

        if session.session_id != session_id {
            return Err("Session ID mismatch or invalid pairing token".to_string());
        }

        let verification_code = generate_verification_code(
            session_id,
            &from_public_key,
            &session.public_key,
        );

        let request = PairingRequest {
            request_id: Uuid::new_v4().to_string(),
            session_id: session_id.to_string(),
            from_device_id,
            from_device_name,
            from_platform,
            from_device_model,
            from_ip_address,
            from_port,
            from_public_key,
            from_fingerprint,
            verification_code,
            timestamp: Utc::now().timestamp_millis(),
            status: "pending".to_string(),
        };

        let mut reqs = self.pending_requests.lock().unwrap();
        reqs.insert(request.request_id.clone(), request.clone());

        Ok(request)
    }

    pub fn get_pending_requests(&self) -> Vec<PairingRequest> {
        let reqs = self.pending_requests.lock().unwrap();
        reqs.values().cloned().collect()
    }

    pub fn resolve_request(&self, request_id: &str, accept: bool) -> Result<PairingRequest, String> {
        let mut reqs = self.pending_requests.lock().unwrap();
        let mut request = reqs
            .remove(request_id)
            .ok_or_else(|| "Pairing request not found or already resolved".to_string())?;

        request.status = if accept {
            "accepted".to_string()
        } else {
            "rejected".to_string()
        };

        Ok(request)
    }
}
