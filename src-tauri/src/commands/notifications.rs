use tauri::State;

use crate::services::AppState;

#[tauri::command]
pub async fn set_notifications_enabled(
    enabled: bool,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    state.notification_manager.set_enabled(enabled);
    Ok(state.notification_manager.is_enabled())
}

#[tauri::command]
pub async fn get_notifications_enabled(
    state: State<'_, AppState>,
) -> Result<bool, String> {
    Ok(state.notification_manager.is_enabled())
}
