use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::Utc;

pub const CURRENT_PROTOCOL_VERSION: &str = "1.0";
pub const MAX_CONTROL_MESSAGE_SIZE: usize = 1024 * 1024; // 1 MB limit for control frames

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MessageType {
    DeviceHello,
    DeviceInfo,
    AuthRequest,
    AuthResponse,
    Ping,
    Pong,
    ConnectionStatus,
    Disconnect,
    TransferRequest,
    TransferAccepted,
    TransferRejected,
    TransferCancelled,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolMessage {
    pub protocol_version: String,
    pub message_id: String,
    pub sender_device_id: String,
    pub recipient_device_id: String,
    pub message_type: MessageType,
    pub timestamp: i64,
    pub payload: serde_json::Value,
}

impl ProtocolMessage {
    pub fn new(
        sender_id: String,
        recipient_id: String,
        message_type: MessageType,
        payload: serde_json::Value,
    ) -> Self {
        Self {
            protocol_version: CURRENT_PROTOCOL_VERSION.to_string(),
            message_id: Uuid::new_v4().to_string(),
            sender_device_id: sender_id,
            recipient_device_id: recipient_id,
            message_type,
            timestamp: Utc::now().timestamp_millis(),
            payload,
        }
    }

    pub fn ping(sender_id: String, recipient_id: String) -> Self {
        Self::new(
            sender_id,
            recipient_id,
            MessageType::Ping,
            serde_json::json!({ "sentAt": Utc::now().timestamp_millis() }),
        )
    }

    pub fn pong(sender_id: String, recipient_id: String, ping_id: String, ping_sent_at: i64) -> Self {
        Self::new(
            sender_id,
            recipient_id,
            MessageType::Pong,
            serde_json::json!({
                "pingId": ping_id,
                "pingSentAt": ping_sent_at,
                "receivedAt": Utc::now().timestamp_millis()
            }),
        )
    }

    pub fn error(sender_id: String, recipient_id: String, code: &str, message: &str) -> Self {
        Self::new(
            sender_id,
            recipient_id,
            MessageType::Error,
            serde_json::json!({
                "code": code,
                "message": message,
            }),
        )
    }
}

// Typed payload definitions for control messages
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HelloPayload {
    pub device_id: String,
    pub device_name: String,
    pub platform: String,
    pub device_model: String,
    pub app_version: String,
    pub port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthRequestPayload {
    pub session_id: String,
    pub client_device_id: String,
    pub timestamp: i64,
    pub signature_hex: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthResponsePayload {
    pub success: bool,
    pub session_token: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferRequestPayload {
    pub transfer_id: String,
    pub file_name: String,
    pub file_size: u64,
    pub mime_type: String,
    pub sha256_checksum: Option<String>,
}
