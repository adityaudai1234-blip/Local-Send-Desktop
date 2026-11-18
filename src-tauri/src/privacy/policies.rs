use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::AppHandle;

use super::settings::SecurityPrivacySettings;
use crate::audit::{SecurityAuditLogger, SecurityEventType, SecurityRepository, SecuritySeverity};
use crate::file_system::storage::set_download_directory;

const SETTINGS_KEY: &str = "privacy_security_settings";

pub struct PrivacyManager {
    settings: Mutex<SecurityPrivacySettings>,
    repo: Arc<SecurityRepository>,
    audit: Arc<SecurityAuditLogger>,
}

impl PrivacyManager {
    pub fn new(repo: Arc<SecurityRepository>, audit: Arc<SecurityAuditLogger>) -> Self {
        let loaded = repo
            .get_setting_json(SETTINGS_KEY)
            .ok()
            .flatten()
            .and_then(|json| serde_json::from_str::<SecurityPrivacySettings>(&json).ok())
            .unwrap_or_default();

        // Sync download directory on boot if valid
        if !loaded.download_directory.trim().is_empty() {
            let _ = set_download_directory(PathBuf::from(&loaded.download_directory));
        }

        Self {
            settings: Mutex::new(loaded),
            repo,
            audit,
        }
    }

    pub fn get_settings(&self) -> SecurityPrivacySettings {
        self.settings.lock().unwrap().clone()
    }

    pub fn update_settings(
        &self,
        mut next: SecurityPrivacySettings,
        app_handle: Option<&AppHandle>,
    ) -> Result<SecurityPrivacySettings, String> {
        // Security invariant: if require_transfer_approval is enabled, auto-accept MUST remain false
        if next.require_transfer_approval {
            next.auto_accept_from_trusted = false;
        }

        if !next.download_directory.trim().is_empty() {
            let validated = set_download_directory(PathBuf::from(&next.download_directory))?;
            next.download_directory = validated.to_string_lossy().to_string();
        }

        let json = serde_json::to_string(&next)
            .map_err(|e| format!("Failed to serialize privacy settings: {}", e))?;
        self.repo.set_setting_json(SETTINGS_KEY, &json)?;

        *self.settings.lock().unwrap() = next.clone();

        self.audit.log_event(
            SecurityEventType::PrivacySettingChanged,
            SecuritySeverity::Info,
            None,
            None,
            "Privacy and security settings updated",
            Some(&format!(
                "discovery={}, allowPairing={}, requireApproval={}, autoAcceptTrusted={}, hideName={}",
                next.discovery_enabled,
                next.allow_incoming_pairing,
                next.require_transfer_approval,
                next.auto_accept_from_trusted,
                next.hide_device_name
            )),
            app_handle,
        );

        Ok(next)
    }

    /// Returns either the real local name or a privacy-masked alias when `hide_device_name` is active
    pub fn visible_broadcast_name(&self, real_name: &str, short_id: &str) -> String {
        let s = self.settings.lock().unwrap();
        if s.hide_device_name {
            let suffix = &short_id[..short_id.len().min(4)].to_uppercase();
            format!("BeamDrop Peer {}", suffix)
        } else {
            real_name.to_string()
        }
    }

    pub fn can_accept_incoming_pairing(&self) -> bool {
        self.settings.lock().unwrap().allow_incoming_pairing
    }

    pub fn is_discovery_enabled(&self) -> bool {
        self.settings.lock().unwrap().discovery_enabled
    }

    pub fn should_auto_accept_from_trusted(&self, is_verified_trusted: bool) -> bool {
        let s = self.settings.lock().unwrap();
        !s.require_transfer_approval && s.auto_accept_from_trusted && is_verified_trusted
    }
}
