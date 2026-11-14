use tauri::State;

use crate::history::statistics::TransferStatistics;
use crate::services::AppState;

#[tauri::command]
pub async fn get_transfer_statistics(
    time_frame: Option<String>,
    state: State<'_, AppState>,
) -> Result<TransferStatistics, String> {
    let tf = time_frame.unwrap_or_else(|| "all".to_string());
    state.history_repository.get_statistics(&tf)
}
