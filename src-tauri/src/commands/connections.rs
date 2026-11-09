use tauri::{AppHandle, State};
use crate::models::Platform;
use crate::networking::connection::PeerConnection;
use crate::protocol::messages::{MessageType, ProtocolMessage};
use crate::services::AppState;

#[tauri::command]
pub async fn connect_to_device(
    device_id: String,
    device_name: String,
    platform: Platform,
    ip_address: String,
    port: u16,
    state: State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<PeerConnection, String> {
    let local = state.get_local_device();
    state
        .connection_manager
        .connect_to_device(
            device_id,
            device_name,
            platform,
            ip_address,
            port,
            state.trusted_devices_manager.clone(),
            &local,
            app_handle,
        )
        .await
}

#[tauri::command]
pub async fn disconnect_from_device(
    device_id: String,
    state: State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<bool, String> {
    state.connection_manager.disconnect_from_device(&device_id, &app_handle)
}

#[tauri::command]
pub async fn get_active_connections(
    state: State<'_, AppState>,
) -> Result<Vec<PeerConnection>, String> {
    Ok(state.connection_manager.get_connections())
}

#[tauri::command]
pub async fn get_connection_status(
    device_id: String,
    state: State<'_, AppState>,
) -> Result<Option<PeerConnection>, String> {
    Ok(state.connection_manager.get_connection(&device_id))
}

#[tauri::command]
pub async fn send_device_message(
    recipient_id: String,
    message_type: MessageType,
    payload: serde_json::Value,
    state: State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<ProtocolMessage, String> {
    let local = state.get_local_device();
    state
        .connection_manager
        .send_message(&recipient_id, message_type, payload, &local, &app_handle)
        .await
}

#[tauri::command]
pub async fn reconnect_device(
    device_id: String,
    state: State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<PeerConnection, String> {
    let existing = state.connection_manager.get_connection(&device_id);
    if let Some(conn) = existing {
        let local = state.get_local_device();
        state
            .connection_manager
            .connect_to_device(
                device_id,
                conn.device_name,
                conn.platform,
                conn.ip_address,
                conn.port,
                state.trusted_devices_manager.clone(),
                &local,
                app_handle,
            )
            .await
    } else {
        // Look up in trusted devices
        let trusted_list = state.trusted_devices_manager.get_trusted_devices()?;
        let dev = trusted_list
            .into_iter()
            .find(|d| d.device_id == device_id)
            .ok_or_else(|| format!("Device '{}' not found in trusted storage", device_id))?;

        let local = state.get_local_device();
        state
            .connection_manager
            .connect_to_device(
                dev.device_id,
                dev.name,
                dev.platform,
                dev.ip_address,
                dev.port,
                state.trusted_devices_manager.clone(),
                &local,
                app_handle,
            )
            .await
    }
}
