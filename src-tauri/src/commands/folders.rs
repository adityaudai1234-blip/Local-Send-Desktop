use std::path::Path;
use tauri::State;

use crate::folders::metadata::FolderMetadata;
use crate::folders::scanner::scan_directory;
use crate::services::AppState;
use crate::transfers::metadata::TransferSession;
use crate::transfers::priority::TransferPriority;

#[tauri::command]
pub async fn select_folder(
    folder_path: String,
    state: State<'_, AppState>,
) -> Result<Vec<FolderMetadata>, String> {
    state.transfer_manager.add_selected_folder(&folder_path)
}

#[tauri::command]
pub async fn scan_folder(folder_path: String) -> Result<FolderMetadata, String> {
    scan_directory(Path::new(&folder_path))
}

#[tauri::command]
pub async fn get_folder_metadata(folder_path: String) -> Result<FolderMetadata, String> {
    scan_directory(Path::new(&folder_path))
}

#[tauri::command]
pub async fn get_selected_folders(
    state: State<'_, AppState>,
) -> Result<Vec<FolderMetadata>, String> {
    Ok(state.transfer_manager.get_selected_folders())
}

#[tauri::command]
pub async fn remove_selected_folder(
    root_path: String,
    state: State<'_, AppState>,
) -> Result<Vec<FolderMetadata>, String> {
    Ok(state.transfer_manager.remove_selected_folder(&root_path))
}

#[tauri::command]
pub async fn clear_selected_folders(
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.transfer_manager.clear_selected_folders();
    Ok(())
}

#[tauri::command]
pub async fn start_folder_transfer(
    recipient_id: String,
    recipient_name: String,
    recipient_ip: String,
    recipient_port: u16,
    folder_paths: Option<Vec<String>>,
    priority: Option<TransferPriority>,
    state: State<'_, AppState>,
) -> Result<TransferSession, String> {
    let local = state.get_local_device();

    state
        .transfer_manager
        .start_folder_transfer(
            local.id,
            local.name,
            format!("{:?}", local.platform).to_lowercase(),
            recipient_id,
            recipient_name,
            recipient_ip,
            recipient_port,
            folder_paths,
            priority,
        )
        .await
}
