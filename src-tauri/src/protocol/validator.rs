use chrono::Utc;
use crate::protocol::errors::ProtocolError;
use crate::protocol::messages::{ProtocolMessage, CURRENT_PROTOCOL_VERSION, MAX_CONTROL_MESSAGE_SIZE};

// Allowed clock skew / replay prevention window: 60 seconds
pub const MAX_TIMESTAMP_SKEW_MS: i64 = 60_000;

pub fn validate_message_raw(data: &[u8]) -> Result<(), ProtocolError> {
    if data.len() > MAX_CONTROL_MESSAGE_SIZE {
        return Err(ProtocolError::MessageTooLarge(data.len()));
    }
    Ok(())
}

pub fn validate_protocol_message(msg: &ProtocolMessage) -> Result<(), ProtocolError> {
    if msg.protocol_version != CURRENT_PROTOCOL_VERSION {
        return Err(ProtocolError::VersionMismatch(msg.protocol_version.clone()));
    }

    if msg.message_id.is_empty() {
        return Err(ProtocolError::MissingField("messageId".to_string()));
    }

    if msg.sender_device_id.is_empty() {
        return Err(ProtocolError::MissingField("senderDeviceId".to_string()));
    }

    let now = Utc::now().timestamp_millis();
    let delta = (now - msg.timestamp).abs();
    if delta > MAX_TIMESTAMP_SKEW_MS {
        return Err(ProtocolError::TimestampExpired(delta));
    }

    Ok(())
}
