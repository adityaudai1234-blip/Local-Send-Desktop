pub mod commands;
pub mod discovery;
pub mod models;
pub mod services;
pub mod pairing;
pub mod security;
pub mod trusted_devices;
pub mod networking;
pub mod protocol;
pub mod file_system;
pub mod transfers;

use commands::*;
use services::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state = AppState::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let state = app.state::<AppState>();
            let local = state.get_local_device();
            let trusted_mgr = state.trusted_devices_manager.clone();
            state.connection_manager.start_background_tasks(local, trusted_mgr, handle.clone());
            state.transfer_manager.set_app_handle(handle);
            Ok(())
        })
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
            create_pairing_session,
            cancel_pairing_session,
            get_pairing_session,
            submit_pairing_request,
            accept_pairing_request,
            reject_pairing_request,
            get_pending_pairing_requests,
            get_trusted_devices,
            remove_trusted_device,
            rename_trusted_device,
            reconnect_trusted_device,
            start_network_service,
            stop_network_service,
            connect_to_device,
            disconnect_from_device,
            get_active_connections,
            get_connection_status,
            send_device_message,
            reconnect_device,
            get_network_information,
            get_network_statistics,
            select_files,
            get_selected_files,
            remove_selected_file,
            clear_selected_files,
            get_download_directory,
            set_download_directory,
            open_received_file_location,
            start_file_transfer,
            accept_transfer,
            reject_transfer,
            pause_transfer,
            resume_transfer,
            cancel_transfer,
            cancel_transfer_batch,
            get_active_transfers,
            get_transfer_details,
        ])
        .run(tauri::generate_context!())
        .expect("error while running BeamDrop tauri application");
}
