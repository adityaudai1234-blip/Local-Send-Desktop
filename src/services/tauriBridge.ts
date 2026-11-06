import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { DiscoveredDevice, DiscoveryState, LocalDeviceInfo, NetworkInterfaceInfo } from '../types/device';

// Detect if running inside Tauri 2 native desktop webview
export const isTauriEnvironment = (): boolean => {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
};

// Web / Simulation state fallback storage
const LOCAL_STORAGE_DEVICE_KEY = 'beamdrop_local_device';
const LOCAL_STORAGE_PEERS_KEY = 'beamdrop_discovered_peers';

function getInitialWebDevice(): LocalDeviceInfo {
  if (typeof window === 'undefined') {
    return {
      id: 'beam-node-web-01',
      name: 'Local Desktop',
      deviceModel: 'Web Runtime (Tauri Bridge)',
      platform: 'macos',
      deviceType: 'desktop',
      version: '1.0.0',
      protocolVersion: '1.0',
      port: 53317,
      ipAddresses: ['192.168.1.105'],
      isDiscoverable: true,
    };
  }

  const stored = localStorage.getItem(LOCAL_STORAGE_DEVICE_KEY);
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      // ignore
    }
  }

  // Detect user agent for realistic platform
  const ua = navigator.userAgent.toLowerCase();
  let platform: LocalDeviceInfo['platform'] = 'macos';
  let model = 'Apple Mac';
  if (ua.includes('win')) {
    platform = 'windows';
    model = 'Windows Workstation';
  } else if (ua.includes('android')) {
    platform = 'android';
    model = 'Android Smartphone';
  } else if (ua.includes('linux')) {
    platform = 'linux';
    model = 'Linux Machine';
  }

  const randomId = 'bd-' + Math.random().toString(36).substring(2, 9);
  const initial: LocalDeviceInfo = {
    id: randomId,
    name: `${model.split(' ')[0]}'s BeamDrop`,
    deviceModel: model,
    platform,
    deviceType: platform === 'android' ? 'mobile' : 'desktop',
    version: '1.0.0',
    protocolVersion: '1.0',
    port: 53317,
    ipAddresses: ['192.168.1.105', '10.0.0.42'],
    isDiscoverable: true,
  };

  localStorage.setItem(LOCAL_STORAGE_DEVICE_KEY, JSON.stringify(initial));
  return initial;
}

// In-memory web fallback discovery state
let webDiscoveryActive = true;
let webSubscribers: Record<string, ((payload: unknown) => void)[]> = {};

export const tauriBridge = {
  isNative: isTauriEnvironment,

  async getLocalDeviceInfo(): Promise<LocalDeviceInfo> {
    if (isTauriEnvironment()) {
      return await invoke<LocalDeviceInfo>('get_local_device_info');
    }
    return getInitialWebDevice();
  },

  async updateDeviceName(newName: String): Promise<LocalDeviceInfo> {
    if (isTauriEnvironment()) {
      return await invoke<LocalDeviceInfo>('update_device_name', { newName });
    }
    const current = getInitialWebDevice();
    current.name = newName.trim();
    localStorage.setItem(LOCAL_STORAGE_DEVICE_KEY, JSON.stringify(current));
    
    // Broadcast state change
    this.emitWebEvent('discovery:state-changed', {
      isActive: webDiscoveryActive,
      serviceType: '_beamdrop._tcp.local.',
      advertisedName: current.name,
      deviceCount: (await this.getDiscoveredDevices()).length,
    });

    return current;
  },

  async startDiscovery(): Promise<DiscoveryState> {
    if (isTauriEnvironment()) {
      return await invoke<DiscoveryState>('start_device_discovery');
    }
    webDiscoveryActive = true;
    const dev = getInitialWebDevice();
    const devices = await this.getDiscoveredDevices();
    const state: DiscoveryState = {
      isActive: true,
      serviceType: '_beamdrop._tcp.local.',
      advertisedName: dev.name,
      deviceCount: devices.length,
    };
    this.emitWebEvent('discovery:state-changed', state);
    return state;
  },

  async stopDiscovery(): Promise<DiscoveryState> {
    if (isTauriEnvironment()) {
      return await invoke<DiscoveryState>('stop_device_discovery');
    }
    webDiscoveryActive = false;
    const dev = getInitialWebDevice();
    const state: DiscoveryState = {
      isActive: false,
      serviceType: '_beamdrop._tcp.local.',
      advertisedName: dev.name,
      deviceCount: 0,
    };
    this.emitWebEvent('discovery:state-changed', state);
    return state;
  },

  async getDiscoveredDevices(): Promise<DiscoveredDevice[]> {
    if (isTauriEnvironment()) {
      return await invoke<DiscoveredDevice[]>('get_discovered_devices');
    }

    const stored = localStorage.getItem(LOCAL_STORAGE_PEERS_KEY);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        // ignore
      }
    }

    // Default network peers on subnet adhering to BeamDrop discovery protocol
    const defaultPeers: DiscoveredDevice[] = [
      {
        id: 'peer-pix8-9a3b',
        name: "Aditya's Pixel 8",
        deviceModel: 'Google Pixel 8 Pro',
        platform: 'android',
        deviceType: 'mobile',
        version: '1.0.0',
        protocolVersion: '1.0',
        ipAddress: '192.168.1.142',
        port: 53317,
        status: 'online',
        lastSeen: Date.now() - 15000,
        rawServiceName: 'Pixel-8-Pro._beamdrop._tcp.local.',
      },
      {
        id: 'peer-mac-studio-41c',
        name: 'Studio Mac M3 Max',
        deviceModel: 'Mac Studio (Apple Silicon)',
        platform: 'macos',
        deviceType: 'desktop',
        version: '1.0.0',
        protocolVersion: '1.0',
        ipAddress: '192.168.1.180',
        port: 53317,
        status: 'online',
        lastSeen: Date.now() - 32000,
        rawServiceName: 'Mac-Studio._beamdrop._tcp.local.',
      },
      {
        id: 'peer-thinkpad-x1',
        name: 'ThinkPad Workstation',
        deviceModel: 'Lenovo ThinkPad X1 Carbon',
        platform: 'linux',
        deviceType: 'desktop',
        version: '1.0.0',
        protocolVersion: '1.0',
        ipAddress: '192.168.1.199',
        port: 53317,
        status: 'online',
        lastSeen: Date.now() - 64000,
        rawServiceName: 'ThinkPad-X1._beamdrop._tcp.local.',
      },
    ];

    localStorage.setItem(LOCAL_STORAGE_PEERS_KEY, JSON.stringify(defaultPeers));
    return defaultPeers;
  },

  async refreshDevices(): Promise<DiscoveryState> {
    if (isTauriEnvironment()) {
      return await invoke<DiscoveryState>('refresh_devices');
    }
    const dev = getInitialWebDevice();
    const devices = await this.getDiscoveredDevices();
    const state: DiscoveryState = {
      isActive: webDiscoveryActive,
      serviceType: '_beamdrop._tcp.local.',
      advertisedName: dev.name,
      deviceCount: devices.length,
    };
    this.emitWebEvent('discovery:state-changed', state);
    return state;
  },

  async getNetworkInterfaces(): Promise<NetworkInterfaceInfo[]> {
    if (isTauriEnvironment()) {
      return await invoke<NetworkInterfaceInfo[]>('get_network_interfaces');
    }
    return [
      { name: 'en0 (Wi-Fi 6 / 802.11ax)', ipAddress: '192.168.1.105', isDefault: true },
      { name: 'utun3 (Local Bridge)', ipAddress: '10.0.0.42', isDefault: false },
      { name: 'lo0 (Loopback)', ipAddress: '127.0.0.1', isDefault: false },
    ];
  },

  async addManualDevice(ipAddress: string, customPort = 53317, name?: string): Promise<DiscoveredDevice> {
    const devices = await this.getDiscoveredDevices();
    const newDevice: DiscoveredDevice = {
      id: 'manual-' + Math.random().toString(36).substring(2, 9),
      name: name || `Host (${ipAddress})`,
      deviceModel: 'Direct IP Target',
      platform: 'unknown',
      deviceType: 'desktop',
      version: '1.0.0',
      protocolVersion: '1.0',
      ipAddress,
      port: customPort,
      status: 'online',
      lastSeen: Date.now(),
      rawServiceName: `manual.${ipAddress}._beamdrop._tcp.local.`,
    };

    const updated = [newDevice, ...devices.filter(d => d.ipAddress !== ipAddress)];
    localStorage.setItem(LOCAL_STORAGE_PEERS_KEY, JSON.stringify(updated));
    this.emitWebEvent('discovery:device-discovered', newDevice);
    return newDevice;
  },

  async removeDevice(deviceId: string): Promise<void> {
    const devices = await this.getDiscoveredDevices();
    const filtered = devices.filter(d => d.id !== deviceId);
    localStorage.setItem(LOCAL_STORAGE_PEERS_KEY, JSON.stringify(filtered));
    this.emitWebEvent('discovery:device-lost', deviceId);
  },

  // Event Subscription helper supporting both Tauri native events and Web events
  async subscribeEvent<T>(eventName: string, handler: (payload: T) => void): Promise<UnlistenFn> {
    if (isTauriEnvironment()) {
      return await listen<T>(eventName, event => handler(event.payload));
    }

    if (!webSubscribers[eventName]) {
      webSubscribers[eventName] = [];
    }
    webSubscribers[eventName].push(handler as (p: unknown) => void);

    return () => {
      if (webSubscribers[eventName]) {
        webSubscribers[eventName] = webSubscribers[eventName].filter(h => h !== handler);
      }
    };
  },

  emitWebEvent(eventName: string, payload: unknown) {
    if (webSubscribers[eventName]) {
      webSubscribers[eventName].forEach(fn => fn(payload));
    }
  },
};
