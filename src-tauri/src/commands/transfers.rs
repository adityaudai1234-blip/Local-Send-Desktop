use tauri::State;

use crate::services::AppState;
use crate::system_tray::BackgroundTransferStatus;
use crate::transfers::metadata::TransferSession;
use crate::transfers::priority::TransferPriority;
use crate::transfers::recovery::RecoverableTransferInfo;
use crate::transfers::scheduler::QueuedTransferInfo;

#[tauri::command]
pub async fn start_file_transfer(
    recipient_id: String,
    recipient_name: String,
    recipient_ip: String,
    recipient_port: u16,
    file_ids: Option<Vec<String>>,
    priority: Option<TransferPriority>,
    state: State<'_, AppState>,
) -> Result<TransferSession, String> {
    let local = state.get_local_device();

    state
        .transfer_manager
        .start_file_transfer(
            local.id,
            local.name,
            format!("{:?}", local.platform).to_lowercase(),
            recipient_id,
            recipient_name,
            recipient_ip,
            recipient_port,
            file_ids,
            priority,
        )
        .await
}

#[tauri::command]
pub async fn accept_transfer(
    transfer_id: String,
    state: State<'_, AppState>,
) -> Result<TransferSession, String> {
    state.transfer_manager.accept_transfer(&transfer_id).await
}

#[tauri::command]
pub async fn reject_transfer(
    transfer_id: String,
    reason: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .transfer_manager
        .reject_transfer(
            &transfer_id,
            &reason.unwrap_or_else(|| "Declined by user".to_string()),
        )
        .await
}

#[tauri::command]
pub async fn pause_transfer(
    transfer_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.transfer_manager.pause_transfer(&transfer_id)
}

#[tauri::command]
pub async fn resume_transfer(
    transfer_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.transfer_manager.resume_transfer(&transfer_id)
}

#[tauri::command]
pub async fn cancel_transfer(
    transfer_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.transfer_manager.cancel_transfer(&transfer_id)
}

#[tauri::command]
pub async fn cancel_transfer_batch(state: State<'_, AppState>) -> Result<usize, String> {
    Ok(state.transfer_manager.cancel_transfer_batch())
}

#[tauri::command]
pub async fn pause_all_transfers(state: State<'_, AppState>) -> Result<usize, String> {
    Ok(state.transfer_manager.pause_all_transfers())
}

#[tauri::command]
pub async fn resume_all_transfers(state: State<'_, AppState>) -> Result<usize, String> {
    Ok(state.transfer_manager.resume_all_transfers())
}

#[tauri::command]
pub async fn get_active_transfers(
    state: State<'_, AppState>,
) -> Result<Vec<TransferSession>, String> {
    Ok(state.transfer_manager.get_active_transfers())
}

#[tauri::command]
pub async fn get_transfer_details(
    transfer_id: String,
    state: State<'_, AppState>,
) -> Result<Option<TransferSession>, String> {
    Ok(state.transfer_manager.get_transfer_details(&transfer_id))
}

#[tauri::command]
pub async fn get_transfer_queue(
    state: State<'_, AppState>,
) -> Result<Vec<QueuedTransferInfo>, String> {
    Ok(state.transfer_manager.get_transfer_queue())
}

#[tauri::command]
pub async fn change_transfer_priority(
    transfer_id: String,
    priority: TransferPriority,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    state
        .transfer_manager
        .change_transfer_priority(&transfer_id, priority)
}

#[tauri::command]
pub async fn retry_transfer(
    transfer_id: String,
    state: State<'_, AppState>,
) -> Result<TransferSession, String> {
    state.transfer_manager.retry_transfer(&transfer_id).await
}

#[tauri::command]
pub async fn remove_transfer(
    transfer_id: String,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    state.transfer_manager.remove_transfer(&transfer_id)
}

#[tauri::command]
pub async fn get_background_transfer_status(
    state: State<'_, AppState>,
) -> Result<BackgroundTransferStatus, String> {
    Ok(state.transfer_manager.get_background_transfer_status())
}

#[tauri::command]
pub async fn get_recoverable_transfers(
    state: State<'_, AppState>,
) -> Result<Vec<RecoverableTransferInfo>, String> {
    Ok(state.transfer_manager.get_recoverable_transfers())
}

#[tauri::command]
pub async fn recover_transfer(
    transfer_id: String,
    fresh_retry: Option<bool>,
    state: State<'_, AppState>,
) -> Result<TransferSession, String> {
    state
        .transfer_manager
        .recover_transfer(&transfer_id, fresh_retry.unwrap_or(false))
        .await
}
