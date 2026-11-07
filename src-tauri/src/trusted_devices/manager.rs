use std::sync::Arc;
use crate::trusted_devices::storage::{DeviceStorage, TrustedDevice};

pub struct TrustedDeviceManager {
    storage: Arc<DeviceStorage>,
}

impl TrustedDeviceManager {
    pub fn new() -> Self {
        // Attempt to open persistent local database, or fall back to in-memory if directory permissions fail
        let storage = DeviceStorage::new("beamdrop_data.sqlite")
            .or_else(|_| DeviceStorage::new_in_memory())
            .expect("Failed to initialize database storage");

        Self {
            storage: Arc::new(storage),
        }
    }

    pub fn get_trusted_devices(&self) -> Result<Vec<TrustedDevice>, String> {
        self.storage.get_all_trusted_devices()
    }

    pub fn add_trusted_device(&self, device: TrustedDevice) -> Result<(), String> {
        self.storage.save_trusted_device(&device)
    }

    pub fn remove_trusted_device(&self, device_id: &str) -> Result<bool, String> {
        self.storage.delete_trusted_device(device_id)
    }

    pub fn rename_trusted_device(&self, device_id: &str, new_name: &str) -> Result<bool, String> {
        self.storage.rename_trusted_device(device_id, new_name)
    }

    pub fn update_last_connected(&self, device_id: &str, timestamp: i64) -> Result<bool, String> {
        self.storage.update_last_connected(device_id, timestamp)
    }
}
