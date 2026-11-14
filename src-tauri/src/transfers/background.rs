use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};

use super::metadata::{TransferSession, TransferStatus};
use crate::system_tray::BackgroundTransferStatus;

pub struct BackgroundTransferCoordinator {
    minimized_to_tray: AtomicBool,
}

impl BackgroundTransferCoordinator {
    pub fn new() -> Self {
        Self {
            minimized_to_tray: AtomicBool::new(false),
        }
    }

    pub fn set_minimized(&self, minimized: bool) {
        self.minimized_to_tray.store(minimized, Ordering::SeqCst);
    }

    pub fn is_minimized(&self) -> bool {
        self.minimized_to_tray.load(Ordering::SeqCst)
    }

    pub fn build_status(&self, sessions: &HashMap<String, TransferSession>) -> BackgroundTransferStatus {
        let mut active_count = 0;
        let mut paused_count = 0;
        let mut total_speed = 0u64;
        let mut active_names = Vec::new();

        for s in sessions.values() {
            match s.status {
                TransferStatus::Transferring
                | TransferStatus::Preparing
                | TransferStatus::Connecting
                | TransferStatus::Verifying
                | TransferStatus::Queued => {
                    active_count += 1;
                    total_speed += s.speed_bytes_per_sec;
                    let label = s
                        .root_folder_name
                        .clone()
                        .unwrap_or_else(|| s.files.first().map(|f| f.name.clone()).unwrap_or_else(|| "Transfer".to_string()));
                    active_names.push(label);
                }
                TransferStatus::Paused => {
                    paused_count += 1;
                }
                _ => {}
            }
        }

        BackgroundTransferStatus {
            active_transfers_count: active_count,
            paused_transfers_count: paused_count,
            total_transfer_speed_bps: total_speed,
            active_transfer_names: active_names,
            is_background_active: active_count > 0 || self.is_minimized(),
        }
    }
}
