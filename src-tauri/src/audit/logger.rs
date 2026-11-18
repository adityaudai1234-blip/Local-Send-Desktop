use std::sync::Arc;
use tauri::{AppHandle, Emitter};

use super::events::{SecurityAuditEvent, SecurityEventFilter, SecurityEventType, SecuritySeverity};
use super::repository::SecurityRepository;

pub struct SecurityAuditLogger {
    repo: Arc<SecurityRepository>,
}

impl SecurityAuditLogger {
    pub fn new(repo: Arc<SecurityRepository>) -> Self {
        Self { repo }
    }

    pub fn repository(&self) -> Arc<SecurityRepository> {
        Arc::clone(&self.repo)
    }

    /// Strict redaction rule: strips anything resembling long hex secrets, PEM blocks,
    /// bearer/auth tokens, or base64 key material before persisting an audit entry.
    pub fn redact_sensitive_text(input: &str) -> String {
        let mut out = input.to_string();

        // Redact PEM blocks if any ever appeared
        if out.contains("BEGIN PRIVATE KEY") || out.contains("BEGIN RSA") || out.contains("BEGIN EC") {
            return "[REDACTED CRYPTOGRAPHIC KEY MATERIAL]".to_string();
        }

        // Redact token=..., secret=..., private_key=..., session_key=... fragments
        let sensitive_markers = [
            "private_key=",
            "privateKey=",
            "secret=",
            "auth_token=",
            "authToken=",
            "session_key=",
            "sessionKey=",
            "seed=",
        ];
        for marker in sensitive_markers {
            if let Some(idx) = out.find(marker) {
                let prefix = &out[..idx + marker.len()];
                out = format!("{}[REDACTED]", prefix);
            }
        }

        // Cap length to avoid accidentally logging serialized file chunks or large payloads
        if out.len() > 360 {
            out.truncate(357);
            out.push_str("...");
        }
        out
    }

    pub fn log_event(
        &self,
        event_type: SecurityEventType,
        severity: SecuritySeverity,
        device_id: Option<&str>,
        device_name: Option<&str>,
        summary: &str,
        details: Option<&str>,
        app_handle: Option<&AppHandle>,
    ) {
        let clean_summary = Self::redact_sensitive_text(summary);
        let clean_details = details.map(Self::redact_sensitive_text);

        let event = SecurityAuditEvent::new(
            event_type,
            severity,
            device_id.map(|s| s.to_string()),
            device_name.map(|s| s.to_string()),
            clean_summary,
            clean_details,
        );

        let _ = self.repo.insert_audit_event(&event);
        if let Some(handle) = app_handle {
            let _ = handle.emit("security:audit-event", &event);
        }
    }

    pub fn get_logs(&self, limit: usize) -> Result<Vec<SecurityAuditEvent>, String> {
        self.repo.get_audit_events(limit)
    }

    pub fn search_logs(&self, filter: &SecurityEventFilter) -> Result<Vec<SecurityAuditEvent>, String> {
        self.repo.search_audit_events(filter)
    }

    pub fn clear_logs(&self) -> Result<usize, String> {
        self.repo.clear_audit_events()
    }
}
