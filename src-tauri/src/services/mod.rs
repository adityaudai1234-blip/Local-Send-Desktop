use std::sync::{Arc, Mutex};
use uuid::Uuid;

use crate::discovery::MdnsDiscoveryManager;
use crate::models::{DeviceType, LocalDeviceInfo, NetworkInterfaceInfo, Platform};

pub struct AppState {
    pub local_device: Arc<Mutex<LocalDeviceInfo>>,
    pub discovery_manager: Arc<Mutex<MdnsDiscoveryManager>>,
}

impl AppState {
    pub fn new() -> Self {
        let device_id = Uuid::new_v4().to_string();
        let default_name = default_device_name();
        let platform = Platform::default();
        let ip_addresses = detect_local_ips();

        let local_device = LocalDeviceInfo {
            id: device_id,
            name: default_name,
            device_model: default_device_model(&platform),
            platform,
            device_type: DeviceType::Desktop,
            version: "1.0.0".to_string(),
            protocol_version: "1.0".to_string(),
            port: 53317,
            ip_addresses,
            is_discoverable: true,
        };

        Self {
            local_device: Arc::new(Mutex::new(local_device)),
            discovery_manager: Arc::new(Mutex::new(MdnsDiscoveryManager::new())),
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
