export type Platform = 'windows' | 'macos' | 'linux' | 'android' | 'ios' | 'web' | 'unknown';

export type DeviceType = 'desktop' | 'mobile' | 'tablet' | 'server' | 'headless';

export type DeviceStatus = 'online' | 'busy' | 'offline' | 'connecting';

export interface LocalDeviceInfo {
  id: string;
  name: string;
  deviceModel: string;
  platform: Platform;
  deviceType: DeviceType;
  version: string;
  protocolVersion: string;
  port: number;
  ipAddresses: string[];
  isDiscoverable: boolean;
}

export interface DiscoveredDevice {
  id: string;
  name: string;
  deviceModel: string;
  platform: Platform;
  deviceType: DeviceType;
  version: string;
  protocolVersion: string;
  ipAddress: string;
  port: number;
  status: DeviceStatus;
  lastSeen: number;
  fingerprint?: string;
  rawServiceName?: string;
}

export interface DiscoveryState {
  isActive: boolean;
  serviceType: string;
  advertisedName: string;
  deviceCount: number;
}

export interface NetworkInterfaceInfo {
  name: string;
  ipAddress: string;
  isDefault: boolean;
}
