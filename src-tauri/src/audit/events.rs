use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "PascalCase")]
pub enum SecurityEventType {
    DevicePaired,
    DeviceUnpaired,
    DeviceRevoked,
    DeviceVerified,
    AuthSuccess,
    AuthFailed,
    IdentityChangeDetected,
    InvalidMessageRejected,
    ReplayAttemptDetected,
    TransferIntegrityFailure,
    SecureSessionEstablished,
    SecureSessionTerminated,
    KeyRotated,
    FilesystemBlocked,
    PrivacySettingChanged,
    SecuritySelfTest,
}

impl SecurityEventType {
    pub fn as_str(&self) -> &'static str {
        match self {
            SecurityEventType::DevicePaired => "DevicePaired",
            SecurityEventType::DeviceUnpaired => "DeviceUnpaired",
            SecurityEventType::DeviceRevoked => "DeviceRevoked",
            SecurityEventType::DeviceVerified => "DeviceVerified",
            SecurityEventType::AuthSuccess => "AuthSuccess",
            SecurityEventType::AuthFailed => "AuthFailed",
            SecurityEventType::IdentityChangeDetected => "IdentityChangeDetected",
            SecurityEventType::InvalidMessageRejected => "InvalidMessageRejected",
            SecurityEventType::ReplayAttemptDetected => "ReplayAttemptDetected",
            SecurityEventType::TransferIntegrityFailure => "TransferIntegrityFailure",
            SecurityEventType::SecureSessionEstablished => "SecureSessionEstablished",
            SecurityEventType::SecureSessionTerminated => "SecureSessionTerminated",
            SecurityEventType::KeyRotated => "KeyRotated",
            SecurityEventType::FilesystemBlocked => "FilesystemBlocked",
            SecurityEventType::PrivacySettingChanged => "PrivacySettingChanged",
            SecurityEventType::SecuritySelfTest => "SecuritySelfTest",
        }
    }

    pub fn from_str_lossy(s: &str) -> Self {
        match s {
            "DevicePaired" => SecurityEventType::DevicePaired,
            "DeviceUnpaired" => SecurityEventType::DeviceUnpaired,
            "DeviceRevoked" => SecurityEventType::DeviceRevoked,
            "DeviceVerified" => SecurityEventType::DeviceVerified,
            "AuthSuccess" => SecurityEventType::AuthSuccess,
            "AuthFailed" => SecurityEventType::AuthFailed,
            "IdentityChangeDetected" => SecurityEventType::IdentityChangeDetected,
            "InvalidMessageRejected" => SecurityEventType::InvalidMessageRejected,
            "ReplayAttemptDetected" => SecurityEventType::ReplayAttemptDetected,
            "TransferIntegrityFailure" => SecurityEventType::TransferIntegrityFailure,
            "SecureSessionEstablished" => SecurityEventType::SecureSessionEstablished,
            "SecureSessionTerminated" => SecurityEventType::SecureSessionTerminated,
            "KeyRotated" => SecurityEventType::KeyRotated,
            "FilesystemBlocked" => SecurityEventType::FilesystemBlocked,
            "PrivacySettingChanged" => SecurityEventType::PrivacySettingChanged,
            _ => SecurityEventType::SecuritySelfTest,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SecuritySeverity {
    Info,
    Warning,
    Critical,
}

impl SecuritySeverity {
    pub fn as_str(&self) -> &'static str {
        match self {
            SecuritySeverity::Info => "info",
            SecuritySeverity::Warning => "warning",
            SecuritySeverity::Critical => "critical",
        }
    }

    pub fn from_str_lossy(s: &str) -> Self {
        match s {
            "warning" => SecuritySeverity::Warning,
            "critical" => SecuritySeverity::Critical,
            _ => SecuritySeverity::Info,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityAuditEvent {
    pub event_id: String,
    pub event_type: SecurityEventType,
    pub severity: SecuritySeverity,
    pub device_id: Option<String>,
    pub device_name: Option<String>,
    pub summary: String,
    pub details: Option<String>,
    pub timestamp: i64,
}

impl SecurityAuditEvent {
    pub fn new(
        event_type: SecurityEventType,
        severity: SecuritySeverity,
        device_id: Option<String>,
        device_name: Option<String>,
        summary: String,
        details: Option<String>,
    ) -> Self {
        Self {
            event_id: Uuid::new_v4().to_string(),
            event_type,
            severity,
            device_id,
            device_name,
            summary,
            details,
            timestamp: Utc::now().timestamp_millis(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SecurityEventFilter {
    pub query: Option<String>,
    pub event_type: Option<String>,
    pub severity: Option<String>,
    pub device_id: Option<String>,
    pub limit: Option<usize>,
}
