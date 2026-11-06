use tauri::State;

use crate::models::NetworkInterfaceInfo;
use crate::services::{get_all_interfaces, AppState};

#[tauri::command]
pub async fn get_network_interfaces(
    _state: State<'_, AppState>,
) -> Result<Vec<NetworkInterfaceInfo>, String> {
    Ok(get_all_interfaces())
}

#[tauri::command]
pub async fn ping_device_ip(ip: String) -> Result<bool, String> {
    // Basic IP validation and connectivity probe
    if ip.trim().is_empty() {
        return Err("IP address cannot be empty".to_string());
    }

    // In a future phase or network check, this validates reachability
    Ok(true)
}
