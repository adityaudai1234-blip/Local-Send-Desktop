use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use crate::models::LocalDeviceInfo;
use crate::security::{generate_verification_code, KeyManager};

pub const SESSION_DURATION_SECONDS: i64 = 300; // 5 minutes

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingSession {
    pub session_id: String,
    pub local_device_id: String,
    pub local_device_name: String,
    pub ip_address: String,
    pub port: u16,
    pub public_key: String,
    pub fingerprint: String,
    pub verification_code: String,
    pub created_at: i64,
    pub expires_at: i64,
    pub is_active: bool,
}

impl PairingSession {
    pub fn new(local_device: &LocalDeviceInfo, key_manager: &KeyManager) -> Self {
        let session_id = Uuid::new_v4().to_string();
        let pub_info = key_manager.public_key_info();
        let now = Utc::now().timestamp_millis();
        let expires_at = now + (SESSION_DURATION_SECONDS * 1000);

        let primary_ip = local_device
            .ipAddresses
            .first()
            .cloned()
            .unwrap_or_else(|| "127.0.0.1".to_string());

        let verification_code = generate_verification_code(
            &session_id,
            &local_device.id,
            &pub_info.public_key_hex,
        );

        Self {
            session_id,
            local_device_id: local_device.id.clone(),
            local_device_name: local_device.name.clone(),
            ip_address: primary_ip,
            port: local_device.port,
            public_key: pub_info.public_key_hex,
            fingerprint: pub_info.fingerprint,
            verification_code,
            created_at: now,
            expires_at,
            is_active: true,
        }
    }

    pub fn is_expired(&self) -> bool {
        let now = Utc::now().timestamp_millis();
        now >= self.expires_at || !self.is_active
    }
}
