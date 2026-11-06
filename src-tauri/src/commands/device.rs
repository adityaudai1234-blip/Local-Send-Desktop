use tauri::{AppHandle, State};

use crate::models::{DiscoveredDevice, DiscoveryState, LocalDeviceInfo};
use crate::services::AppState;

#[tauri::command]
pub async fn get_local_device_info(state: State<'_, AppState>) -> Result<LocalDeviceInfo, String> {
    Ok(state.get_local_device())
}

#[tauri::command]
pub async fn update_device_name(
    new_name: String,
    state: State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<LocalDeviceInfo, String> {
    if new_name.trim().is_empty() {
        return Err("Device name cannot be empty".to_string());
    }

    let updated = state.set_device_name(new_name);

    // If discovery is active, restart or re-advertise with new name
    let mut manager = state.discovery_manager.lock().unwrap();
    let current_state = manager.current_state(&updated);
    if current_state.is_active {
        let _ = manager.stop(&app_handle, &updated);
        let _ = manager.start(app_handle, &updated);
    }

    Ok(updated)
}

#[tauri::command]
pub async fn start_device_discovery(
    state: State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<DiscoveryState, String> {
    let local = state.get_local_device();
    let mut manager = state.discovery_manager.lock().unwrap();
    manager.start(app_handle, &local)
}

#[tauri::command]
pub async fn stop_device_discovery(
    state: State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<DiscoveryState, String> {
    let local = state.get_local_device();
    let mut manager = state.discovery_manager.lock().unwrap();
    manager.stop(&app_handle, &local)
}

#[tauri::command]
pub async fn get_discovered_devices(
    state: State<'_, AppState>,
) -> Result<Vec<DiscoveredDevice>, String> {
    let manager = state.discovery_manager.lock().unwrap();
    Ok(manager.get_discovered_devices())
}

#[tauri::command]
pub async fn refresh_devices(
    state: State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<DiscoveryState, String> {
    let local = state.get_local_device();
    let mut manager = state.discovery_manager.lock().unwrap();
    manager.refresh(&app_handle, &local)
}
