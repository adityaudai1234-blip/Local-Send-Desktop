use chrono::Utc;
use std::sync::Arc;

use crate::trusted_devices::storage::{DeviceStorage, TrustedDevice};

pub struct TrustedDeviceManager {
    storage: Arc<DeviceStorage>,
}

impl TrustedDeviceManager {
    pub fn new() -> Self {
        let storage = DeviceStorage::new("beamdrop_data.sqlite")
            .or_else(|_| DeviceStorage::new_in_memory())
            .expect("Failed to initialize database storage");

        Self {
            storage: Arc::new(storage),
        }
    }

    pub fn new_in_memory() -> Self {
        let storage = DeviceStorage::new_in_memory().expect("Failed to initialize in-memory storage");
        Self {
            storage: Arc::new(storage),
        }
    }

    pub fn get_trusted_devices(&self) -> Result<Vec<TrustedDevice>, String> {
        self.storage.get_all_trusted_devices()
    }

    pub fn get_device_by_id(&self, device_id: &str) -> Result<Option<TrustedDevice>, String> {
        self.storage.get_device_by_id(device_id)
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

    pub fn verify_device_identity(
        &self,
        device_id: &str,
        expected_fingerprint: Option<&str>,
    ) -> Result<TrustedDevice, String> {
        let dev = self
            .storage
            .get_device_by_id(device_id)?
            .ok_or_else(|| format!("Trusted device '{}' not found", device_id))?;

        if let Some(fp) = expected_fingerprint {
            if !fp.trim().is_empty() && !dev.fingerprint.eq_ignore_ascii_case(fp.trim()) {
                return Err(format!(
                    "Fingerprint mismatch: stored {} vs expected {}",
                    dev.fingerprint, fp
                ));
            }
        }

        let now = Utc::now().timestamp_millis();
        self.storage
            .update_verification_status(device_id, "verified", None, Some(now))?;

        self.storage
            .get_device_by_id(device_id)?
            .ok_or_else(|| "Device missing after verification".to_string())
    }

    pub fn flag_identity_change(&self, device_id: &str, details: &str) -> Result<bool, String> {
        self.storage.update_verification_status(
            device_id,
            "identity_changed",
            Some(details),
            None,
        )
    }

    pub fn revoke_device(&self, device_id: &str) -> Result<Option<TrustedDevice>, String> {
        let existing = self.storage.get_device_by_id(device_id)?;
        let _ = self.storage.delete_trusted_device(device_id)?;
        Ok(existing)
    }
}
