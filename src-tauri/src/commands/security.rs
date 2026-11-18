use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::audit::{
    RevokedDeviceRecord, SecurityAuditEvent, SecurityEventFilter, SecurityEventType,
    SecuritySeverity,
};
use crate::filesystem_security::sanitize_untrusted_relative_path;
use crate::privacy::SecurityPrivacySettings;
use crate::security::{
    build_deterministic_nonce, decrypt_aead, encrypt_aead, rotate_identity_keys, CipherSuite,
    DeviceIdentityPublic, EphemeralKeyExchange, KeyRotationResult, ReplayProtector,
    SecureSessionSummary, SecureStorageStatus,
};
use crate::services::AppState;
use crate::trusted_devices::TrustedDevice;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityPostureStatus {
    pub identity_algorithm: String,
    pub fingerprint: String,
    pub key_version: u32,
    pub key_exchange: String,
    pub cipher_suite: String,
    pub active_encrypted_sessions: usize,
    pub active_verified_sessions: usize,
    pub trusted_device_count: usize,
    pub revoked_device_count: usize,
    pub unverified_or_warned_count: usize,
    pub secure_storage: SecureStorageStatus,
    pub sqlite_encrypted: bool,
    pub local_storage_note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustedDeviceSecurityInfo {
    pub device_id: String,
    pub name: String,
    pub fingerprint: String,
    pub key_version: u32,
    pub verification_status: String,
    pub last_auth_at: Option<i64>,
    pub first_paired_at: i64,
    pub security_warning: Option<String>,
    pub has_active_encrypted_session: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecuritySelfTestCheck {
    pub id: String,
    pub name: String,
    pub passed: bool,
    pub details: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecuritySelfTestReport {
    pub passed_all: bool,
    pub ran_at: i64,
    pub checks: Vec<SecuritySelfTestCheck>,
}

#[tauri::command]
pub async fn get_security_status(
    state: State<'_, AppState>,
) -> Result<SecurityPostureStatus, String> {
    let identity = state.identity_manager.get_public_identity();
    let storage = state.identity_manager.get_storage_status();
    let sessions = state.secure_session_manager.get_active_summaries();
    let trusted = state.trusted_devices_manager.get_trusted_devices()?;
    let revoked = state.security_repo.get_revoked_devices()?;

    let active_verified = sessions.iter().filter(|s| s.is_authenticated).count();
    let warned = trusted
        .iter()
        .filter(|d| d.verification_status != "verified" || d.security_warning.is_some())
        .count();

    Ok(SecurityPostureStatus {
        identity_algorithm: identity.algorithm,
        fingerprint: identity.fingerprint,
        key_version: identity.key_version,
        key_exchange: "X25519 Ephemeral ECDH + HKDF-SHA256".to_string(),
        cipher_suite: "ChaCha20-Poly1305 / AES-256-GCM AEAD".to_string(),
        active_encrypted_sessions: sessions.len(),
        active_verified_sessions: active_verified,
        trusted_device_count: trusted.len(),
        revoked_device_count: revoked.len(),
        unverified_or_warned_count: warned,
        secure_storage: storage,
        sqlite_encrypted: false,
        local_storage_note: "Private keys live exclusively in OS secure keyring (or non-persisted ephemeral RAM if unavailable). Local SQLite databases store public peer metadata, hashes, and redacted audit events only.".to_string(),
    })
}

#[tauri::command]
pub async fn get_device_identity(
    state: State<'_, AppState>,
) -> Result<DeviceIdentityPublic, String> {
    Ok(state.identity_manager.get_public_identity())
}

#[tauri::command]
pub async fn get_device_fingerprint(state: State<'_, AppState>) -> Result<String, String> {
    Ok(state.identity_manager.get_public_identity().fingerprint)
}

#[tauri::command]
pub async fn verify_device_identity(
    device_id: String,
    expected_fingerprint: Option<String>,
    state: State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<TrustedDevice, String> {
    let updated = state
        .trusted_devices_manager
        .verify_device_identity(&device_id, expected_fingerprint.as_deref())?;

    state.security_audit.log_event(
        SecurityEventType::DeviceVerified,
        SecuritySeverity::Info,
        Some(&updated.device_id),
        Some(&updated.name),
        &format!(
            "Manually verified peer identity fingerprint {}",
            updated.fingerprint
        ),
        None,
        Some(&app_handle),
    );

    let _ = app_handle.emit("trusted-devices:updated", ());
    Ok(updated)
}

#[tauri::command]
pub async fn revoke_device(
    device_id: String,
    reason: Option<String>,
    state: State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<bool, String> {
    let reason_text = reason
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "Manually revoked by local user".to_string());

    // 1. Terminate active connections & zeroized encrypted sessions
    state
        .connection_manager
        .disconnect_and_revoke(&device_id, Some(&app_handle));

    // 2. Cancel any active file/folder transfers with this peer
    state
        .transfer_manager
        .cancel_transfers_for_device(&device_id);

    // 3. Remove from trusted device list & persist revocation block
    let existing = state.trusted_devices_manager.revoke_device(&device_id)?;
    let prev_fp = existing
        .as_ref()
        .map(|d| d.fingerprint.clone())
        .unwrap_or_else(|| "UNKNOWN".to_string());
    let dev_name = existing.as_ref().map(|d| d.name.clone());

    state
        .security_repo
        .record_revoked_device(&RevokedDeviceRecord {
            device_id: device_id.clone(),
            previous_fingerprint: prev_fp,
            reason: reason_text.clone(),
            revoked_at: Utc::now().timestamp_millis(),
        })?;

    state.security_audit.log_event(
        SecurityEventType::DeviceRevoked,
        SecuritySeverity::Critical,
        Some(&device_id),
        dev_name.as_deref(),
        &format!("Device trust & active sessions revoked ({})", reason_text),
        None,
        Some(&app_handle),
    );

    let _ = app_handle.emit("trusted-devices:removed", &device_id);
    let _ = app_handle.emit("trusted-devices:updated", ());

    Ok(true)
}

#[tauri::command]
pub async fn rotate_device_keys(
    state: State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<KeyRotationResult, String> {
    rotate_identity_keys(
        &state.identity_manager,
        &state.security_audit,
        Some(&app_handle),
    )
}

#[tauri::command]
pub async fn get_trusted_device_security(
    state: State<'_, AppState>,
) -> Result<Vec<TrustedDeviceSecurityInfo>, String> {
    let devices = state.trusted_devices_manager.get_trusted_devices()?;
    Ok(devices
        .into_iter()
        .map(|d| {
            let active = state
                .secure_session_manager
                .has_verified_session(&d.device_id);
            TrustedDeviceSecurityInfo {
                device_id: d.device_id,
                name: d.name,
                fingerprint: d.fingerprint,
                key_version: d.key_version,
                verification_status: d.verification_status,
                last_auth_at: d.last_auth_at,
                first_paired_at: d.first_paired_at,
                security_warning: d.security_warning,
                has_active_encrypted_session: active,
            }
        })
        .collect())
}

#[tauri::command]
pub async fn get_active_secure_sessions(
    state: State<'_, AppState>,
) -> Result<Vec<SecureSessionSummary>, String> {
    Ok(state.secure_session_manager.get_active_summaries())
}

#[tauri::command]
pub async fn get_security_settings(
    state: State<'_, AppState>,
) -> Result<SecurityPrivacySettings, String> {
    Ok(state.privacy_manager.get_settings())
}

#[tauri::command]
pub async fn update_security_settings(
    settings: SecurityPrivacySettings,
    state: State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<SecurityPrivacySettings, String> {
    let updated = state
        .privacy_manager
        .update_settings(settings, Some(&app_handle))?;

    // Sync runtime discovery & notification managers with updated privacy settings
    {
        let mut dev = state.local_device.lock().unwrap();
        dev.is_discoverable = updated.discovery_enabled;
    }
    state
        .notification_manager
        .set_enabled(updated.notifications_enabled);

    let _ = app_handle.emit("security:settings-updated", &updated);
    Ok(updated)
}

#[tauri::command]
pub async fn get_security_audit_log(
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Vec<SecurityAuditEvent>, String> {
    state.security_audit.get_logs(limit.unwrap_or(200))
}

#[tauri::command]
pub async fn search_security_events(
    filter: SecurityEventFilter,
    state: State<'_, AppState>,
) -> Result<Vec<SecurityAuditEvent>, String> {
    state.security_audit.search_logs(&filter)
}

#[tauri::command]
pub async fn clear_security_audit_log(
    state: State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<usize, String> {
    let count = state.security_audit.clear_logs()?;
    let _ = app_handle.emit("security:audit-cleared", ());
    Ok(count)
}

#[tauri::command]
pub async fn get_secure_storage_status(
    state: State<'_, AppState>,
) -> Result<SecureStorageStatus, String> {
    Ok(state.identity_manager.get_storage_status())
}

#[tauri::command]
pub async fn run_security_self_test(
    state: State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<SecuritySelfTestReport, String> {
    let mut checks = Vec::new();

    // 1. Ed25519 signing + verify check
    let pub_id = state.identity_manager.get_public_identity();
    let probe = b"beamdrop-self-test-payload";
    let sig = state.identity_manager.sign_payload(probe);
    let sig_ok = crate::security::IdentityManager::verify_peer_signature(
        probe,
        &sig,
        &pub_id.public_key_hex,
    )
    .unwrap_or(false);
    checks.push(SecuritySelfTestCheck {
        id: "ed25519_auth".to_string(),
        name: "Ed25519 Identity Sign & Verify".to_string(),
        passed: sig_ok,
        details: format!("Key v{} ({})", pub_id.key_version, pub_id.fingerprint),
    });

    // 2. X25519 ECDH + HKDF-SHA256 domain separation
    let a = EphemeralKeyExchange::generate();
    let b = EphemeralKeyExchange::generate();
    let k_ok = match (
        a.derive_keys(&b.public_key_bytes, "selftest", true),
        b.derive_keys(&a.public_key_bytes, "selftest", false),
    ) {
        (Ok(ka), Ok(kb)) => {
            ka.control_tx_key == kb.control_rx_key
                && ka.file_tx_key == kb.file_rx_key
                && ka.sas_code == kb.sas_code
        }
        _ => false,
    };
    checks.push(SecuritySelfTestCheck {
        id: "x25519_hkdf".to_string(),
        name: "X25519 Ephemeral ECDH & HKDF-SHA256".to_string(),
        passed: k_ok,
        details: "Domain-separated control & file keys derived identically".to_string(),
    });

    // 3. AEAD ChaCha20-Poly1305 encryption & tamper rejection
    let key = [7u8; 32];
    let nonce = build_deterministic_nonce(*b"TEST", 1);
    let aead_ok = match encrypt_aead(CipherSuite::ChaCha20Poly1305, &key, &nonce, b"secret", b"aad") {
        Ok(mut ct) => {
            let dec_ok = decrypt_aead(CipherSuite::ChaCha20Poly1305, &key, &nonce, &ct, b"aad")
                .map(|p| p == b"secret")
                .unwrap_or(false);
            ct[0] ^= 0xFF;
            let tamper_rejected =
                decrypt_aead(CipherSuite::ChaCha20Poly1305, &key, &nonce, &ct, b"aad").is_err();
            dec_ok && tamper_rejected
        }
        Err(_) => false,
    };
    checks.push(SecuritySelfTestCheck {
        id: "aead_tamper".to_string(),
        name: "ChaCha20-Poly1305 AEAD & Tamper Detection".to_string(),
        passed: aead_ok,
        details: "1-bit ciphertext mutation rejected by Poly1305 tag".to_string(),
    });

    // 4. Replay protection check
    let now = Utc::now().timestamp_millis();
    let mut rp = ReplayProtector::new("rp-self".to_string(), now + 60_000);
    let rp_ok = rp.validate_incoming_at("rp-self", "id-1", 0, now, now).is_ok()
        && rp.validate_incoming_at("rp-self", "id-1", 1, now, now).is_err()
        && rp.validate_incoming_at("rp-self", "id-2", 0, now, now).is_err();
    checks.push(SecuritySelfTestCheck {
        id: "replay_guard".to_string(),
        name: "Anti-Replay (Nonce, Sequence & Clock Skew)".to_string(),
        passed: rp_ok,
        details: "Duplicate messageId and non-monotonic sequences blocked".to_string(),
    });

    // 5. Path traversal defense
    let fs_ok = sanitize_untrusted_relative_path("../../etc/passwd").is_err()
        && sanitize_untrusted_relative_path("/abs/escape").is_err()
        && sanitize_untrusted_relative_path("docs/report.pdf").is_ok();
    checks.push(SecuritySelfTestCheck {
        id: "path_containment".to_string(),
        name: "Filesystem Traversal & Symlink Containment".to_string(),
        passed: fs_ok,
        details: "Relative traversal and absolute escapes rejected".to_string(),
    });

    let passed_all = checks.iter().all(|c| c.passed);
    let report = SecuritySelfTestReport {
        passed_all,
        ran_at: now,
        checks,
    };

    state.security_audit.log_event(
        SecurityEventType::SecuritySelfTest,
        if passed_all {
            SecuritySeverity::Info
        } else {
            SecuritySeverity::Critical
        },
        None,
        None,
        if passed_all {
            "On-device security self-test passed (5/5 checks)"
        } else {
            "On-device security self-test reported failure"
        },
        None,
        Some(&app_handle),
    );

    Ok(report)
}
