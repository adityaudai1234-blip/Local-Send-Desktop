use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

use super::identity::{DeviceIdentityPublic, IdentityManager};
use crate::audit::{SecurityAuditLogger, SecurityEventType, SecuritySeverity};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyRotationResult {
    pub identity: DeviceIdentityPublic,
    pub previous_fingerprint: String,
    pub rotated_at: i64,
}

pub fn rotate_identity_keys(
    identity_mgr: &Arc<IdentityManager>,
    audit: &Arc<SecurityAuditLogger>,
    app_handle: Option<&AppHandle>,
) -> Result<KeyRotationResult, String> {
    let (updated, previous_fp) = identity_mgr.replace_signing_key()?;
    let rotated_at = updated
        .rotated_at
        .unwrap_or_else(|| chrono::Utc::now().timestamp_millis());

    audit.log_event(
        SecurityEventType::KeyRotated,
        SecuritySeverity::Warning,
        Some(&updated.device_id),
        None,
        &format!(
            "Local Ed25519 identity rotated to version v{} ({})",
            updated.key_version, updated.fingerprint
        ),
        Some(&format!("previousFingerprint={}", previous_fp)),
        app_handle,
    );

    if let Some(handle) = app_handle {
        let _ = handle.emit("security:key-rotated", &updated);
    }

    Ok(KeyRotationResult {
        identity: updated,
        previous_fingerprint: previous_fp,
        rotated_at,
    })
}
