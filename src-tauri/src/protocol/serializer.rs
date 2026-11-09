use crate::protocol::errors::ProtocolError;
use crate::protocol::messages::ProtocolMessage;
use crate::protocol::validator::{validate_message_raw, validate_protocol_message};

pub fn serialize_message(msg: &ProtocolMessage) -> Result<Vec<u8>, ProtocolError> {
    validate_protocol_message(msg)?;
    let json_bytes = serde_json::to_vec(msg)
        .map_err(|e| ProtocolError::SerializationError(e.to_string()))?;
    validate_message_raw(&json_bytes)?;
    Ok(json_bytes)
}

pub fn deserialize_message(data: &[u8]) -> Result<ProtocolMessage, ProtocolError> {
    validate_message_raw(data)?;
    let msg: ProtocolMessage = serde_json::from_slice(data)
        .map_err(|e| ProtocolError::SerializationError(e.to_string()))?;
    validate_protocol_message(&msg)?;
    Ok(msg)
}
