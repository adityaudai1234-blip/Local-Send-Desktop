use tauri::State;

use crate::performance::metrics::{
    DiskThroughputMetrics, NetworkThroughputMetrics, TransferPerformanceMetrics,
    TransferQueueMetrics, TransferRecoveryStatus, TransferResourceUsage, TransferSpeedDetails,
};
use crate::performance::settings::TransferOptimizationSettings;
use crate::services::AppState;
use crate::transfers::scheduler::QueuedTransferInfo;

#[tauri::command]
pub async fn get_transfer_performance_metrics(
    state: State<'_, AppState>,
) -> Result<TransferPerformanceMetrics, String> {
    Ok(state.transfer_manager.get_transfer_performance_metrics())
}

#[tauri::command]
pub async fn get_network_throughput(
    state: State<'_, AppState>,
) -> Result<NetworkThroughputMetrics, String> {
    Ok(state.transfer_manager.get_network_throughput())
}

#[tauri::command]
pub async fn get_disk_throughput(
    state: State<'_, AppState>,
) -> Result<DiskThroughputMetrics, String> {
    Ok(state.transfer_manager.get_disk_throughput())
}

#[tauri::command]
pub async fn get_transfer_speed_details(
    transfer_id: String,
    state: State<'_, AppState>,
) -> Result<TransferSpeedDetails, String> {
    state
        .transfer_manager
        .get_transfer_speed_details(&transfer_id)
}

#[tauri::command]
pub async fn get_transfer_optimization_settings(
    state: State<'_, AppState>,
) -> Result<TransferOptimizationSettings, String> {
    Ok(state.transfer_manager.get_optimization_settings())
}

#[tauri::command]
pub async fn update_transfer_optimization_settings(
    settings: TransferOptimizationSettings,
    state: State<'_, AppState>,
) -> Result<TransferOptimizationSettings, String> {
    state
        .transfer_manager
        .update_optimization_settings(settings)
        .await
}

#[tauri::command]
pub async fn get_transfer_queue_metrics(
    state: State<'_, AppState>,
) -> Result<TransferQueueMetrics, String> {
    Ok(state.transfer_manager.get_transfer_queue_metrics())
}

#[tauri::command]
pub async fn get_transfer_resource_usage(
    state: State<'_, AppState>,
) -> Result<TransferResourceUsage, String> {
    Ok(state.transfer_manager.get_transfer_resource_usage())
}

#[tauri::command]
pub async fn get_transfer_recovery_status(
    state: State<'_, AppState>,
) -> Result<TransferRecoveryStatus, String> {
    Ok(state.transfer_manager.get_transfer_recovery_status())
}

#[tauri::command]
pub async fn optimize_transfer_queue(
    state: State<'_, AppState>,
) -> Result<Vec<QueuedTransferInfo>, String> {
    Ok(state.transfer_manager.optimize_transfer_queue())
}
