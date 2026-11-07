use serde::{Deserialize, Serialize};
use crate::pairing::session::PairingSession;

pub const QR_PROTOCOL_ID: &str = "beamdrop-pairing";
pub const QR_PROTOCOL_VERSION: &str = "1.0";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QrPayload {
    pub protocol: String,
    pub version: String,
    pub session_id: String,
    pub device_id: String,
    pub device_name: String,
    pub ip_address: String,
    pub port: u16,
    pub public_key: String,
    pub fingerprint: String,
    pub verification_code: String,
    pub expires_at: i64,
}

impl QrPayload {
    pub fn from_session(session: &PairingSession) -> Self {
        Self {
            protocol: QR_PROTOCOL_ID.to_string(),
            version: QR_PROTOCOL_VERSION.to_string(),
            session_id: session.session_id.clone(),
            device_id: session.local_device_id.clone(),
            device_name: session.local_device_name.clone(),
            ip_address: session.ip_address.clone(),
            port: session.port,
            public_key: session.public_key.clone(),
            fingerprint: session.fingerprint.clone(),
            verification_code: session.verification_code.clone(),
            expires_at: session.expires_at,
        }
    }

    pub fn to_qr_string(&self) -> Result<String, String> {
        serde_json::to_string(self).map_err(|e| format!("Failed to serialize QR payload: {}", e))
    }

    pub fn parse_and_validate(raw_json: &str) -> Result<Self, String> {
        let payload: Self = serde_json::from_str(raw_json)
            .map_err(|e| format!("Invalid QR code JSON structure: {}", e))?;

        if payload.protocol != QR_PROTOCOL_ID {
            return Err(format!("Unsupported pairing protocol: '{}'", payload.protocol));
        }

        if payload.device_id.is_empty() {
            return Err("QR payload is missing deviceId".to_string());
        }

        if payload.public_key.len() != 64 {
            return Err("Invalid public key hex format in QR payload".to_string());
        }

        let now = chrono::Utc::now().timestamp_millis();
        if now >= payload.expires_at {
            return Err("This pairing QR code has expired. Please ask the device owner to regenerate it.".to_string());
        }

        Ok(payload)
    }
}
