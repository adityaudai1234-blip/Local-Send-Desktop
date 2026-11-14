use tauri::State;

use crate::history::filters::HistoryFilterOptions;
use crate::services::AppState;
use crate::transfers::metadata::TransferSession;

#[tauri::command]
pub async fn get_transfer_history(
    options: Option<HistoryFilterOptions>,
    state: State<'_, AppState>,
) -> Result<Vec<TransferSession>, String> {
    let opts = options.unwrap_or(HistoryFilterOptions {
        direction: None,
        status: None,
        search_query: None,
        sort_by: Some("newest".to_string()),
        limit: Some(100),
        offset: Some(0),
    });
    state.history_repository.query_history(&opts)
}

#[tauri::command]
pub async fn search_transfer_history(
    query: String,
    state: State<'_, AppState>,
) -> Result<Vec<TransferSession>, String> {
    let opts = HistoryFilterOptions {
        direction: None,
        status: None,
        search_query: Some(query),
        sort_by: Some("newest".to_string()),
        limit: Some(100),
        offset: Some(0),
    };
    state.history_repository.query_history(&opts)
}

#[tauri::command]
pub async fn filter_transfer_history(
    options: HistoryFilterOptions,
    state: State<'_, AppState>,
) -> Result<Vec<TransferSession>, String> {
    state.history_repository.query_history(&options)
}

#[tauri::command]
pub async fn delete_history_entry(
    transfer_id: String,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    state.history_repository.delete_history_entry(&transfer_id)
}

#[tauri::command]
pub async fn clear_transfer_history(
    state: State<'_, AppState>,
) -> Result<usize, String> {
    state.history_repository.clear_history()
}
