use std::sync::{Arc, Mutex};
use uuid::Uuid;

use crate::audit::{SecurityAuditLogger, SecurityRepository};
use crate::discovery::MdnsDiscoveryManager;
use crate::history::repository::HistoryRepository;
use crate::models::{DeviceType, LocalDeviceInfo, NetworkInterfaceInfo, Platform};
use crate::networking::ConnectionManager;
use crate::notifications::NotificationManager;
use crate::pairing::HandshakeManager;
use crate::privacy::PrivacyManager;
use crate::security::{IdentityManager, KeyManager, SecureSessionManager};
use crate::transfers::TransferManager;
use crate::trusted_devices::TrustedDeviceManager;

pub struct AppState {
    pub local_device: Arc<Mutex<LocalDeviceInfo>>,
    pub discovery_manager: Arc<Mutex<MdnsDiscoveryManager>>,
    pub key_manager: Arc<KeyManager>,
    pub identity_manager: Arc<IdentityManager>,
    pub handshake_manager: Arc<HandshakeManager>,
    pub trusted_devices_manager: Arc<TrustedDeviceManager>,
    pub connection_manager: Arc<ConnectionManager>,
    pub transfer_manager: Arc<TransferManager>,
    pub history_repository: Arc<HistoryRepository>,
    pub notification_manager: Arc<NotificationManager>,
    pub security_repo: Arc<SecurityRepository>,
    pub security_audit: Arc<SecurityAuditLogger>,
    pub secure_session_manager: Arc<SecureSessionManager>,
    pub privacy_manager: Arc<PrivacyManager>,
}

impl AppState {
    pub fn new() -> Self {
        let initial_device_id = Uuid::new_v4().to_string();
        let default_name = default_device_name();
        let platform = Platform::default();
        let ip_addresses = detect_local_ips();

        let security_repo = Arc::new(
            SecurityRepository::new("beamdrop_security.sqlite")
                .unwrap_or_else(|_| {
                    SecurityRepository::new_in_memory()
                        .expect("in-memory security sqlite failed")
                }),
        );
        let security_audit = Arc::new(SecurityAuditLogger::new(Arc::clone(&security_repo)));
        let identity_manager = Arc::new(IdentityManager::new(
            initial_device_id,
            Arc::clone(&security_repo),
        ));
        let stable_device_id = identity_manager.get_public_identity().device_id;

        let privacy_manager = Arc::new(PrivacyManager::new(
            Arc::clone(&security_repo),
            Arc::clone(&security_audit),
        ));
        let secure_session_manager = Arc::new(SecureSessionManager::new(Arc::clone(&security_audit)));

        let local_device = LocalDeviceInfo {
            id: stable_device_id,
            name: default_name,
            device_model: default_device_model(&platform),
            platform,
            device_type: DeviceType::Desktop,
            version: "1.0.0".to_string(),
            protocol_version: "1.0".to_string(),
            port: 53317,
            ip_addresses,
            is_discoverable: privacy_manager.is_discovery_enabled(),
        };

        let conn_mgr = Arc::new(ConnectionManager::new(
            Arc::clone(&security_repo),
            Arc::clone(&security_audit),
            Arc::clone(&secure_session_manager),
        ));
        let trusted_mgr = Arc::new(TrustedDeviceManager::new());
        let history_repo = Arc::new(
            HistoryRepository::new("beamdrop_transfers.sqlite")
                .unwrap_or_else(|_| {
                    HistoryRepository::new_in_memory().expect("in-memory sqlite failed")
                }),
        );
        let notif_mgr = Arc::new(NotificationManager::new());
        notif_mgr.set_enabled(privacy_manager.get_settings().notifications_enabled);

        let transfer_mgr = Arc::new(TransferManager::new(
            conn_mgr.clone(),
            history_repo.clone(),
            notif_mgr.clone(),
            trusted_mgr.clone(),
            security_repo.clone(),
        ));

        Self {
            local_device: Arc::new(Mutex::new(local_device)),
            discovery_manager: Arc::new(Mutex::new(MdnsDiscoveryManager::new())),
            key_manager: Arc::new(KeyManager::new()),
            identity_manager,
            handshake_manager: Arc::new(HandshakeManager::new()),
            trusted_devices_manager: trusted_mgr,
            connection_manager: conn_mgr,
            transfer_manager: transfer_mgr,
            history_repository: history_repo,
            notification_manager: notif_mgr,
            security_repo,
            security_audit,
            secure_session_manager,
            privacy_manager,
        }
    }

    pub fn get_local_device(&self) -> LocalDeviceInfo {
        self.local_device.lock().unwrap().clone()
    }

    pub fn set_device_name(&self, new_name: String) -> LocalDeviceInfo {
        let mut dev = self.local_device.lock().unwrap();
        dev.name = new_name.trim().to_string();
        dev.clone()
    }
}

fn default_device_name() -> String {
    #[cfg(target_os = "macos")]
    return "MacBook Pro".to_string();
    #[cfg(target_os = "windows")]
    return "Windows Desktop".to_string();
    #[cfg(target_os = "linux")]
    return "Linux Workstation".to_string();
    #[cfg(target_os = "android")]
    return "Android Device".to_string();
    #[cfg(target_os = "ios")]
    return "iPhone".to_string();
    #[cfg(not(any(
        target_os = "macos",
        target_os = "windows",
        target_os = "linux",
        target_os = "android",
        target_os = "ios"
    )))]
    "BeamDrop Device".to_string()
}

fn default_device_model(platform: &Platform) -> String {
    match platform {
        Platform::MacOS => "Apple Mac",
        Platform::Windows => "PC (x86_64)",
        Platform::Linux => "Linux Desktop",
        Platform::Android => "Android Handset",
        Platform::Ios => "iOS Device",
        Platform::Web => "Web Browser",
        Platform::Unknown => "Generic System",
    }
    .to_string()
}

pub fn detect_local_ips() -> Vec<String> {
    let mut ips = Vec::new();
    if let Ok(ip) = local_ip_address::local_ip() {
        ips.push(ip.to_string());
    }
    if ips.is_empty() {
        ips.push("127.0.0.1".to_string());
    }
    ips
}

pub fn get_all_interfaces() -> Vec<NetworkInterfaceInfo> {
    let mut results = Vec::new();
    if let Ok(ip) = local_ip_address::local_ip() {
        results.push(NetworkInterfaceInfo {
            name: "Primary Interface".to_string(),
            ip_address: ip.to_string(),
            is_default: true,
        });
    }
    if results.is_empty() {
        results.push(NetworkInterfaceInfo {
            name: "Loopback Interface".to_string(),
            ip_address: "127.0.0.1".to_string(),
            is_default: true,
        });
    }
    results
}
