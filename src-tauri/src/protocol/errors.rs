use thiserror::Error;

#[derive(Error, Debug, Clone)]
pub enum ProtocolError {
    #[error("Message exceeded maximum control frame size ({0} bytes)")]
    MessageTooLarge(usize),

    #[error("Invalid protocol version: '{0}' (expected '1.0')")]
    VersionMismatch(String),

    #[error("Missing required protocol field: '{0}'")]
    MissingField(String),

    #[error("Message timestamp expired or replayed (delta: {0}ms)")]
    TimestampExpired(i64),

    #[error("JSON serialization or deserialization failed: {0}")]
    SerializationError(String),

    #[error("Unauthorized device or signature verification failed")]
    Unauthorized,

    #[error("Connection closed or timed out: {0}")]
    ConnectionError(String),
}
