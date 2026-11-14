use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundTransferStatus {
    pub active_transfers_count: usize,
    pub paused_transfers_count: usize,
    pub total_transfer_speed_bps: u64,
    pub active_transfer_names: Vec<String>,
    pub is_background_active: bool,
}
