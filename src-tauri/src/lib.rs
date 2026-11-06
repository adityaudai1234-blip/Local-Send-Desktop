pub mod commands;
pub mod discovery;
pub mod models;
pub mod services;

use commands::*;
use services::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state = AppState::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            get_local_device_info,
            update_device_name,
            start_device_discovery,
            stop_device_discovery,
            get_discovered_devices,
            refresh_devices,
            get_network_interfaces,
            ping_device_ip,
        ])
        .run(tauri::generate_context!())
        .expect("error while running BeamDrop tauri application");
}
