use serde::{Deserialize, Serialize};
use crate::audit::SecurityRepository;
use crate::transfers::priority::TransferPriority;

pub const SETTINGS_STORAGE_KEY: &str = "transfer_optimization_settings_v1";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TransferOptimizationSettings {
    pub max_concurrent_transfers: usize,
    pub max_concurrent_file_ops: usize,
    pub max_concurrent_connections: usize,
    pub max_concurrent_chunk_ops: usize,
    pub adaptive_chunking_enabled: bool,
    pub default_chunk_size_kb: usize,
    pub performance_graph_enabled: bool,
    pub auto_retry_enabled: bool,
    pub max_retries: u32,
    pub default_priority: TransferPriority,
    pub continue_in_background: bool,
}

impl Default for TransferOptimizationSettings {
    fn default() -> Self {
        Self {
            max_concurrent_transfers: 3,
            max_concurrent_file_ops: 4,
            max_concurrent_connections: 8,
            max_concurrent_chunk_ops: 4,
            adaptive_chunking_enabled: true,
            default_chunk_size_kb: 256,
            performance_graph_enabled: true,
            auto_retry_enabled: true,
            max_retries: 3,
            default_priority: TransferPriority::Normal,
            continue_in_background: true,
        }
    }
}

impl TransferOptimizationSettings {
    pub fn sanitized(mut self) -> Self {
        self.max_concurrent_transfers = self.max_concurrent_transfers.clamp(1, 16);
        self.max_concurrent_file_ops = self.max_concurrent_file_ops.clamp(1, 16);
        self.max_concurrent_connections = self.max_concurrent_connections.clamp(1, 32);
        self.max_concurrent_chunk_ops = self.max_concurrent_chunk_ops.clamp(1, 16);
        self.default_chunk_size_kb = self.default_chunk_size_kb.clamp(64, 4096);
        self.max_retries = self.max_retries.min(10);
        self
    }

    pub fn default_chunk_bytes(&self) -> usize {
        self.default_chunk_size_kb.clamp(64, 4096) * 1024
    }
}

pub fn load_optimization_settings(repo: &SecurityRepository) -> TransferOptimizationSettings {
    match repo.get_setting_json(SETTINGS_STORAGE_KEY) {
        Ok(Some(json)) => serde_json::from_str::<TransferOptimizationSettings>(&json)
            .map(|s| s.sanitized())
            .unwrap_or_default(),
        _ => TransferOptimizationSettings::default(),
    }
}

pub fn save_optimization_settings(
    repo: &SecurityRepository,
    settings: TransferOptimizationSettings,
) -> Result<TransferOptimizationSettings, String> {
    let clean = settings.sanitized();
    let json = serde_json::to_string(&clean)
        .map_err(|e| format!("Failed to serialize optimization settings: {}", e))?;
    repo.set_setting_json(SETTINGS_STORAGE_KEY, &json)?;
    Ok(clean)
}
