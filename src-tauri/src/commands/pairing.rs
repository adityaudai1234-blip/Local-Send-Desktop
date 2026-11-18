use tauri::{AppHandle, Emitter, State};

use crate::audit::{SecurityEventType, SecuritySeverity};
use crate::pairing::{generate_device_auth_credentials, PairingRequest, PairingResponse, PairingSession, QrPayload};
use crate::security::{check_pinned_identity, IdentityPinOutcome};
use crate::services::AppState;
use crate::trusted_devices::TrustedDevice;

#[tauri::command]
pub async fn create_pairing_session(
    state: State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<PairingSession, String> {
    if !state.privacy_manager.can_accept_incoming_pairing() {
        return Err("Incoming pairing is currently disabled in Privacy & Security settings".to_string());
    }

    let local = state.get_local_device();
    let session = PairingSession::new(&local, &state.key_manager);
    state.handshake_manager.set_session(session.clone());

    let _ = app_handle.emit("pairing:session-created", &session);
    Ok(session)
}

#[tauri::command]
pub async fn cancel_pairing_session(
    state: State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<bool, String> {
    let cancelled = state.handshake_manager.cancel_session();
    let _ = app_handle.emit("pairing:session-cancelled", ());
    Ok(cancelled)
}

#[tauri::command]
pub async fn get_pairing_session(
    state: State<'_, AppState>,
) -> Result<Option<PairingSession>, String> {
    Ok(state.handshake_manager.get_session())
}

#[tauri::command]
pub async fn submit_pairing_request(
    qr_json: String,
    state: State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<PairingRequest, String> {
    if !state.privacy_manager.can_accept_incoming_pairing() {
        state.security_audit.log_event(
            SecurityEventType::InvalidMessageRejected,
            SecuritySeverity::Info,
            None,
            None,
            "Pairing request blocked by privacy settings (allowIncomingPairing=false)",
            None,
            Some(&app_handle),
        );
        return Err("Incoming pairing requests are disabled in Privacy settings".to_string());
    }

    let qr = QrPayload::parse_and_validate(&qr_json)?;
    let local = state.get_local_device();
    let pub_id = state.identity_manager.get_public_identity();

    let primary_ip = local
        .ip_addresses
        .first()
        .cloned()
        .unwrap_or_else(|| "127.0.0.1".to_string());

    // Check pinned trust status in case peer previously paired with a different public key
    let existing_peer = state.trusted_devices_manager.get_device_by_id(&qr.device_id)?;
    let is_revoked = state.security_repo.is_device_revoked(&qr.device_id);
    let pin_outcome = check_pinned_identity(
        &qr.device_id,
        &qr.public_key,
        &qr.public_key[..qr.public_key.len().min(16)],
        is_revoked,
        existing_peer.as_ref().map(|d| d.public_key.as_str()),
        existing_peer.as_ref().map(|d| d.fingerprint.as_str()),
        existing_peer.as_ref().map(|d| d.verification_status.as_str()),
    );

    let mut identity_warning: Option<String> = None;
    if let IdentityPinOutcome::IdentityChanged {
        expected_fingerprint,
        received_fingerprint,
    } = pin_outcome
    {
        let warn = format!(
            "Identity key changed from {} to {}. Verify SAS code out-of-band before approving.",
            expected_fingerprint, received_fingerprint
        );
        state.security_audit.log_event(
            SecurityEventType::IdentityChangeDetected,
            SecuritySeverity::Critical,
            Some(&qr.device_id),
            Some(&qr.device_name),
            "Unexpected peer identity key change detected during pairing",
            Some(&warn),
            Some(&app_handle),
        );
        identity_warning = Some(warn);
    }

    let req = match state.handshake_manager.handle_incoming_request(
        &qr.session_id,
        local.id,
        local.name,
        local.platform,
        local.device_model,
        primary_ip,
        local.port,
        pub_id.public_key_hex,
        pub_id.fingerprint,
        pub_id.key_version,
        identity_warning,
    ) {
        Ok(r) => r,
        Err(err) => {
            if err.contains("replay") || err.contains("consumed") {
                state.security_audit.log_event(
                    SecurityEventType::ReplayAttemptDetected,
                    SecuritySeverity::Critical,
                    Some(&qr.device_id),
                    Some(&qr.device_name),
                    "Replayed pairing payload rejected",
                    Some(&err),
                    Some(&app_handle),
                );
            }
            return Err(err);
        }
    };

    let _ = app_handle.emit("pairing:request-received", &req);
    Ok(req)
}

#[tauri::command]
pub async fn accept_pairing_request(
    request_id: String,
    state: State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<PairingResponse, String> {
    let request = state.handshake_manager.resolve_request(&request_id, true)?;

    // Clear any prior revocation entry when user explicitly approves a fresh pairing
    let _ = state.security_repo.clear_revoked_device(&request.from_device_id);

    let auth = generate_device_auth_credentials();
    let now = chrono::Utc::now().timestamp_millis();

    let trusted = TrustedDevice {
        device_id: request.from_device_id.clone(),
        name: request.from_device_name.clone(),
        platform: request.from_platform.clone(),
        device_model: request.from_device_model.clone(),
        ip_address: request.from_ip_address.clone(),
        port: request.from_port,
        public_key: request.from_public_key.clone(),
        fingerprint: request.from_fingerprint.clone(),
        auth_token_hash: auth.token_hash,
        first_paired_at: now,
        last_connected_at: now,
        is_online: true,
        trust_status: "trusted".to_string(),
        key_version: request.key_version,
        last_auth_at: Some(now),
        verification_status: "verified".to_string(),
        security_warning: None,
    };

    state.trusted_devices_manager.add_trusted_device(trusted.clone())?;

    state.security_audit.log_event(
        SecurityEventType::DevicePaired,
        SecuritySeverity::Info,
        Some(&trusted.device_id),
        Some(&trusted.name),
        &format!(
            "Device paired and identity pinned ({})",
            trusted.fingerprint
        ),
        None,
        Some(&app_handle),
    );

    let response = PairingResponse {
        success: true,
        request_id: request.request_id,
        auth_token: Some(auth.raw_token),
        message: format!("Successfully paired with {}", request.from_device_name),
    };

    let _ = app_handle.emit("pairing:request-accepted", &trusted);
    let _ = app_handle.emit("trusted-devices:updated", ());

    Ok(response)
}

#[tauri::command]
pub async fn reject_pairing_request(
    request_id: String,
    state: State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<PairingResponse, String> {
    let request = state.handshake_manager.resolve_request(&request_id, false)?;

    state.security_audit.log_event(
        SecurityEventType::AuthFailed,
        SecuritySeverity::Warning,
        Some(&request.from_device_id),
        Some(&request.from_device_name),
        "Pairing request manually rejected by user",
        None,
        Some(&app_handle),
    );

    let response = PairingResponse {
        success: false,
        request_id: request.request_id,
        auth_token: None,
        message: "Pairing request was rejected by device owner.".to_string(),
    };

    let _ = app_handle.emit("pairing:request-rejected", &request_id);
    Ok(response)
}

#[tauri::command]
pub async fn get_pending_pairing_requests(
    state: State<'_, AppState>,
) -> Result<Vec<PairingRequest>, String> {
    Ok(state.handshake_manager.get_pending_requests())
}
