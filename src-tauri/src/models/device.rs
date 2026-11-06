use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    Windows,
    MacOS,
    Linux,
    Android,
    Ios,
    Web,
    Unknown,
}

impl Default for Platform {
    fn default() -> Self {
        #[cfg(target_os = "windows")]
        return Platform::Windows;
        #[cfg(target_os = "macos")]
        return Platform::MacOS;
        #[cfg(target_os = "linux")]
        return Platform::Linux;
        #[cfg(target_os = "android")]
        return Platform::Android;
        #[cfg(target_os = "ios")]
        return Platform::Ios;
        #[cfg(not(any(
            target_os = "windows",
            target_os = "macos",
            target_os = "linux",
            target_os = "android",
            target_os = "ios"
        )))]
        Platform::Unknown
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DeviceType {
    Desktop,
    Mobile,
    Tablet,
    Server,
    Headless,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DeviceStatus {
    Online,
    Busy,
    Offline,
    Connecting,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalDeviceInfo {
    pub id: String,
    pub name: String,
    pub device_model: String,
    pub platform: Platform,
    pub device_type: DeviceType,
    pub version: String,
    pub protocol_version: String,
    pub port: u16,
    pub ip_addresses: Vec<String>,
    pub is_discoverable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredDevice {
    pub id: String,
    pub name: String,
    pub device_model: String,
    pub platform: Platform,
    pub device_type: DeviceType,
    pub version: String,
    pub protocol_version: String,
    pub ip_address: String,
    pub port: u16,
    pub status: DeviceStatus,
    pub last_seen: i64,
    pub fingerprint: Option<String>,
    pub raw_service_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryState {
    pub is_active: bool,
    pub service_type: String,
    pub advertised_name: String,
    pub device_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkInterfaceInfo {
    pub name: String,
    pub ip_address: String,
    pub is_default: bool,
}
