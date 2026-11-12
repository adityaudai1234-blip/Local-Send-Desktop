use std::path::PathBuf;
use tauri::State;

use crate::file_system::selection::SelectedFile;
use crate::file_system::storage;
use crate::services::AppState;

#[tauri::command]
pub async fn select_files(
    file_paths: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Vec<SelectedFile>, String> {
    state.transfer_manager.add_selected_files(file_paths)
}

#[tauri::command]
pub async fn get_selected_files(
    state: State<'_, AppState>,
) -> Result<Vec<SelectedFile>, String> {
    Ok(state.transfer_manager.get_selected_files())
}

#[tauri::command]
pub async fn remove_selected_file(
    file_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<SelectedFile>, String> {
    Ok(state.transfer_manager.remove_selected_file(&file_id))
}

#[tauri::command]
pub async fn clear_selected_files(
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.transfer_manager.clear_selected_files();
    Ok(())
}

#[tauri::command]
pub async fn get_download_directory() -> Result<String, String> {
    Ok(storage::get_download_directory().to_string_lossy().to_string())
}

#[tauri::command]
pub async fn set_download_directory(path: String) -> Result<String, String> {
    let p = PathBuf::from(path);
    storage::set_download_directory(p).map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn open_received_file_location(path: String) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("explorer")
            .arg("/select,")
            .arg(&path)
            .spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("xdg-open")
            .arg(std::path::Path::new(&path).parent().unwrap_or(std::path::Path::new("/")))
            .spawn();
    }
    Ok(true)
}
