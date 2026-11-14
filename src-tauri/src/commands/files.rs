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
    reveal_received_file(path).await
}

#[tauri::command]
pub async fn open_received_file(path: String) -> Result<bool, String> {
    let target = std::path::Path::new(&path);
    if !target.exists() {
        return Err(format!("File does not exist on disk: {}", path));
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(true)
}

#[tauri::command]
pub async fn reveal_received_file(path: String) -> Result<bool, String> {
    let target = std::path::Path::new(&path);
    let fallback_dir = storage::get_download_directory();
    let effective = if target.exists() {
        target.to_path_buf()
    } else {
        fallback_dir
    };

    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("explorer")
            .arg("/select,")
            .arg(&effective)
            .spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .arg("-R")
            .arg(&effective)
            .spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let dir = if effective.is_dir() {
            effective.as_path()
        } else {
            effective.parent().unwrap_or(std::path::Path::new("/"))
        };
        let _ = std::process::Command::new("xdg-open")
            .arg(dir)
            .spawn();
    }
    Ok(true)
}

#[tauri::command]
pub async fn copy_file_path(path: String) -> Result<String, String> {
    Ok(path)
}
