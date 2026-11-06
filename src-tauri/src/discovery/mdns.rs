use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use chrono::Utc;
use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use tauri::{AppHandle, Emitter};

use crate::models::{DeviceStatus, DeviceType, DiscoveredDevice, DiscoveryState, LocalDeviceInfo, Platform};

pub const SERVICE_TYPE: &str = "_beamdrop._tcp.local.";
pub const PROTOCOL_VERSION: &str = "1.0";
pub const DEFAULT_PORT: u16 = 53317;

pub struct MdnsDiscoveryManager {
    daemon: Option<ServiceDaemon>,
    discovered_devices: Arc<Mutex<HashMap<String, DiscoveredDevice>>>,
    is_active: bool,
    registered_instance: Option<String>,
}

impl MdnsDiscoveryManager {
    pub fn new() -> Self {
        Self {
            daemon: None,
            discovered_devices: Arc::new(Mutex::new(HashMap::new())),
            is_active: false,
            registered_instance: None,
        }
    }

    pub fn get_discovered_devices(&self) -> Vec<DiscoveredDevice> {
        let map = self.discovered_devices.lock().unwrap();
        map.values().cloned().collect()
    }

    pub fn start(
        &mut self,
        app_handle: AppHandle,
        local_device: &LocalDeviceInfo,
    ) -> Result<DiscoveryState, String> {
        if self.is_active {
            return Ok(self.current_state(local_device));
        }

        let daemon = ServiceDaemon::new().map_err(|e| format!("Failed to create mDNS daemon: {}", e))?;

        // 1. Register our own service for advertisement
        let instance_name = format!("{}-{}", local_device.name.replace(' ', "-"), &local_device.id[0..6]);
        let host_name = format!("{}.local.", instance_name);

        let mut properties = HashMap::new();
        properties.insert("id".to_string(), local_device.id.clone());
        properties.insert("alias".to_string(), local_device.name.clone());
        properties.insert("model".to_string(), local_device.device_model.clone());
        properties.insert("platform".to_string(), serde_json::to_string(&local_device.platform).unwrap_or_default().trim_matches('"').to_string());
        properties.insert("type".to_string(), serde_json::to_string(&local_device.device_type).unwrap_or_default().trim_matches('"').to_string());
        properties.insert("version".to_string(), local_device.version.clone());
        properties.insert("proto".to_string(), PROTOCOL_VERSION.to_string());
        properties.insert("port".to_string(), local_device.port.to_string());

        let service_info = ServiceInfo::new(
            SERVICE_TYPE,
            &instance_name,
            &host_name,
            "",
            local_device.port,
            properties,
        )
        .map_err(|e| format!("Failed to create mDNS service info: {}", e))?;

        daemon
            .register(service_info)
            .map_err(|e| format!("Failed to register mDNS service: {}", e))?;

        self.registered_instance = Some(instance_name);

        // 2. Start browsing for other devices
        let receiver = daemon
            .browse(SERVICE_TYPE)
            .map_err(|e| format!("Failed to browse mDNS services: {}", e))?;

        let devices_cache = Arc::clone(&self.discovered_devices);
        let my_id = local_device.id.clone();
        let handle_clone = app_handle.clone();

        tokio::spawn(async move {
            while let Ok(event) = receiver.recv_async().await {
                match event {
                    ServiceEvent::ServiceResolved(info) => {
                        let props = info.get_properties();
                        let device_id = match props.get("id") {
                            Some(val) => val.clone(),
                            None => continue,
                        };

                        // Avoid discovering self
                        if device_id == my_id {
                            continue;
                        }

                        let name = props
                            .get("alias")
                            .cloned()
                            .unwrap_or_else(|| info.get_fullname().to_string());
                        let model = props
                            .get("model")
                            .cloned()
                            .unwrap_or_else(|| "Unknown Device".to_string());
                        let proto = props
                            .get("proto")
                            .cloned()
                            .unwrap_or_else(|| "1.0".to_string());
                        let ver = props
                            .get("version")
                            .cloned()
                            .unwrap_or_else(|| "1.0.0".to_string());

                        let platform: Platform = props
                            .get("platform")
                            .map(|s| serde_json::from_str(&format!("\"{}\"", s)).unwrap_or_default())
                            .unwrap_or_default();

                        let device_type: DeviceType = props
                            .get("type")
                            .map(|s| serde_json::from_str(&format!("\"{}\"", s)).unwrap_or(DeviceType::Desktop))
                            .unwrap_or(DeviceType::Desktop);

                        let port = info.get_port();
                        let ip_address = info
                            .get_addresses()
                            .iter()
                            .find(|ip| ip.is_ipv4())
                            .map(|ip| ip.to_string())
                            .or_else(|| info.get_addresses().iter().next().map(|ip| ip.to_string()))
                            .unwrap_or_else(|| "127.0.0.1".to_string());

                        let device = DiscoveredDevice {
                            id: device_id.clone(),
                            name,
                            device_model: model,
                            platform,
                            device_type,
                            version: ver,
                            protocol_version: proto,
                            ip_address,
                            port,
                            status: DeviceStatus::Online,
                            last_seen: Utc::now().timestamp_millis(),
                            fingerprint: props.get("fingerprint").cloned(),
                            raw_service_name: Some(info.get_fullname().to_string()),
                        };

                        let mut cache = devices_cache.lock().unwrap();
                        let is_new = !cache.contains_key(&device_id);
                        cache.insert(device_id.clone(), device.clone());
                        drop(cache);

                        if is_new {
                            let _ = handle_clone.emit("discovery:device-discovered", &device);
                        } else {
                            let _ = handle_clone.emit("discovery:device-updated", &device);
                        }
                    }
                    ServiceEvent::ServiceRemoved(_service_type, fullname) => {
                        let mut cache = devices_cache.lock().unwrap();
                        let mut removed_id: Option<String> = None;

                        for (id, dev) in cache.iter() {
                            if let Some(ref raw) = dev.raw_service_name {
                                if raw == &fullname {
                                    removed_id = Some(id.clone());
                                    break;
                                }
                            }
                        }

                        if let Some(id) = removed_id {
                            cache.remove(&id);
                            drop(cache);
                            let _ = handle_clone.emit("discovery:device-lost", id);
                        }
                    }
                    _ => {}
                }
            }
        });

        // Background TTL / Health check task
        let ttl_cache = Arc::clone(&self.discovered_devices);
        let ttl_handle = app_handle.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(15));
            loop {
                interval.tick().await;
                let now = Utc::now().timestamp_millis();
                let mut cache = ttl_cache.lock().unwrap();
                let mut expired = Vec::new();

                for (id, dev) in cache.iter() {
                    // If device has not been updated in 90 seconds, mark as offline/lost
                    if now - dev.last_seen > 90_000 {
                        expired.push(id.clone());
                    }
                }

                for id in expired {
                    cache.remove(&id);
                    let _ = ttl_handle.emit("discovery:device-lost", id);
                }
            }
        });

        self.daemon = Some(daemon);
        self.is_active = true;

        let state = self.current_state(local_device);
        let _ = app_handle.emit("discovery:state-changed", &state);

        Ok(state)
    }

    pub fn stop(&mut self, app_handle: &AppHandle, local_device: &LocalDeviceInfo) -> Result<DiscoveryState, String> {
        if let Some(daemon) = self.daemon.take() {
            if let Some(instance) = self.registered_instance.take() {
                let _ = daemon.unregister(&format!("{}.{}", instance, SERVICE_TYPE));
            }
            let _ = daemon.shutdown();
        }

        self.is_active = false;
        let state = self.current_state(local_device);
        let _ = app_handle.emit("discovery:state-changed", &state);

        Ok(state)
    }

    pub fn refresh(&mut self, app_handle: &AppHandle, local_device: &LocalDeviceInfo) -> Result<DiscoveryState, String> {
        if self.is_active {
            // Re-trigger browse query
            if let Some(ref daemon) = self.daemon {
                let _ = daemon.browse(SERVICE_TYPE);
            }
        } else {
            return self.start(app_handle.clone(), local_device);
        }

        Ok(self.current_state(local_device))
    }

    pub fn current_state(&self, local_device: &LocalDeviceInfo) -> DiscoveryState {
        let count = self.discovered_devices.lock().unwrap().len();
        DiscoveryState {
            is_active: self.is_active,
            service_type: SERVICE_TYPE.to_string(),
            advertised_name: local_device.name.clone(),
            device_count: count,
        }
    }
}
