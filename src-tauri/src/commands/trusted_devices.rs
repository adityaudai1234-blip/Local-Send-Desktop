use tauri::{AppHandle, Emitter, State};
use crate::services::AppState;
use crate::trusted_devices::TrustedDevice;

#[tauri::command]
pub async fn get_trusted_devices(
    state: State<'_, AppState>,
) -> Result<Vec<TrustedDevice>, String> {
    state.trusted_devices_manager.get_trusted_devices()
}

#[tauri::command]
pub async fn remove_trusted_device(
    device_id: String,
    state: State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<bool, String> {
    let success = state.trusted_devices_manager.remove_trusted_device(&device_id)?;
    if success {
        let _ = app_handle.emit("trusted-devices:removed", &device_id);
    }
    Ok(success)
}

#[tauri::command]
pub async fn rename_trusted_device(
    device_id: String,
    new_name: String,
    state: State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<bool, String> {
    if new_name.trim().is_empty() {
        return Err("Device name cannot be blank".to_string());
    }
    let success = state
        .trusted_devices_manager
        .rename_trusted_device(&device_id, new_name.trim())?;
    if success {
        let _ = app_handle.emit("trusted-devices:updated", ());
    }
    Ok(success)
}

#[tauri::command]
pub async fn reconnect_trusted_device(
    device_id: String,
    state: State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<bool, String> {
    let now = chrono::Utc::now().timestamp_millis();
    let success = state
        .trusted_devices_manager
        .update_last_connected(&device_id, now)?;
    if success {
        let _ = app_handle.emit("trusted-devices:reconnected", &device_id);
    }
    Ok(success)
}
