use tauri::{AppHandle, Emitter, State};
use crate::models::Platform;
use crate::pairing::{generate_device_auth_credentials, PairingRequest, PairingResponse, PairingSession, QrPayload};
use crate::services::AppState;
use crate::trusted_devices::TrustedDevice;

#[tauri::command]
pub async fn create_pairing_session(
    state: State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<PairingSession, String> {
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
    let qr = QrPayload::parse_and_validate(&qr_json)?;
    let local = state.get_local_device();
    let pub_info = state.key_manager.public_key_info();

    let primary_ip = local
        .ipAddresses
        .first()
        .cloned()
        .unwrap_or_else(|| "127.0.0.1".to_string());

    let req = state.handshake_manager.handle_incoming_request(
        &qr.session_id,
        local.id,
        local.name,
        local.platform,
        local.device_model,
        primary_ip,
        local.port,
        pub_info.public_key_hex,
        pub_info.fingerprint,
    )?;

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

    // Generate mutual authentication credentials
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
    };

    state.trusted_devices_manager.add_trusted_device(trusted.clone())?;

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
