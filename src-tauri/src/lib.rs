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
pub mod folders;
pub mod history;
pub mod notifications;
pub mod system_tray;

use commands::*;
use services::AppState;
use transfers::recovery::RecoveryManager;

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
            state.transfer_manager.set_app_handle(handle.clone());

            // Clean up expired `.part` files on startup
            let _ = RecoveryManager::cleanup_expired_part_files();

            // Initialize desktop system tray (gracefully ignored in headless environments)
            let _ = system_tray::setup_system_tray(&handle);

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
            open_received_file,
            reveal_received_file,
            copy_file_path,
            start_file_transfer,
            accept_transfer,
            reject_transfer,
            pause_transfer,
            resume_transfer,
            cancel_transfer,
            cancel_transfer_batch,
            pause_all_transfers,
            resume_all_transfers,
            get_active_transfers,
            get_transfer_details,
            get_transfer_queue,
            change_transfer_priority,
            retry_transfer,
            remove_transfer,
            get_background_transfer_status,
            get_recoverable_transfers,
            recover_transfer,
            select_folder,
            scan_folder,
            get_folder_metadata,
            get_selected_folders,
            remove_selected_folder,
            clear_selected_folders,
            start_folder_transfer,
            get_transfer_history,
            search_transfer_history,
            filter_transfer_history,
            delete_history_entry,
            clear_transfer_history,
            get_transfer_statistics,
            set_notifications_enabled,
            get_notifications_enabled,
        ])
        .run(tauri::generate_context!())
        .expect("error while running BeamDrop tauri application");
}
