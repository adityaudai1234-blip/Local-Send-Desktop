use tauri::{AppHandle, State};
use crate::networking::network_monitor::{NetworkInformation, NetworkStatistics};
use crate::services::AppState;

#[tauri::command]
pub async fn start_network_service(
    state: State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<bool, String> {
    state.connection_manager.start_service(&app_handle)?;
    Ok(true)
}

#[tauri::command]
pub async fn stop_network_service(
    state: State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<bool, String> {
    state.connection_manager.stop_service(&app_handle)?;
    Ok(true)
}

#[tauri::command]
pub async fn get_network_information(
    state: State<'_, AppState>,
) -> Result<NetworkInformation, String> {
    let local = state.get_local_device();
    Ok(state.connection_manager.get_network_info(&local))
}

#[tauri::command]
pub async fn get_network_statistics(
    state: State<'_, AppState>,
) -> Result<NetworkStatistics, String> {
    Ok(state.connection_manager.get_stats())
}
