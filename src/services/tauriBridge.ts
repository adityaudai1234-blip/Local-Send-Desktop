import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { DiscoveredDevice, DiscoveryState, LocalDeviceInfo, NetworkInterfaceInfo } from '../types/device';
import { PairingRequest, PairingResponse, PairingSession, QrPayload, TrustedDevice } from '../types/pairing';
import { PeerConnection, NetworkInformation, NetworkStatistics, ConnectionState } from '../types/networking';
import {
  SelectedFileItem,
  TransferSession,
  TransferProgressPayload,
  IncomingTransferProposal,
} from '../types/transfer';

// Detect if running inside Tauri 2 native desktop webview
export const isTauriEnvironment = (): boolean => {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
};

// Web / Simulation state fallback storage
const LOCAL_STORAGE_DEVICE_KEY = 'beamdrop_local_device';
const LOCAL_STORAGE_PEERS_KEY = 'beamdrop_discovered_peers';
const LOCAL_STORAGE_TRUSTED_KEY = 'beamdrop_trusted_devices';

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

// In-memory web fallback discovery and pairing state
let webDiscoveryActive = true;
let webSubscribers: Record<string, ((payload: unknown) => void)[]> = {};
let activeWebSession: PairingSession | null = null;
let pendingWebRequests: PairingRequest[] = [];
let webNetworkRunning = true;
let webConnections: Record<string, PeerConnection> = {
  'peer-pix8-9a3b': {
    deviceId: 'peer-pix8-9a3b',
    deviceName: "Aditya's Pixel 8",
    platform: 'android',
    ipAddress: '192.168.1.142',
    port: 53317,
    state: 'connected',
    connectedAt: Date.now() - 3600000,
    lastHeartbeat: Date.now() - 1200,
    latencyMs: 3,
    reconnectAttempts: 0,
    isIncoming: false,
    txBytes: 450210,
    rxBytes: 128450,
  },
};
let webTxBytes = 450210;
let webRxBytes = 128450;
let webMessagesSent = 84;
let webMessagesReceived = 42;
let webStatsStartTime = Date.now() - 7200000;

// Web Transfer Fallback State
let webSelectedFiles: SelectedFileItem[] = [];
let webActiveTransfers: Record<string, TransferSession> = {};
let webDownloadDirectory = '~/Downloads/BeamDrop';
let webPendingIncomingTransfers: IncomingTransferProposal[] = [];
let webTransferTimer: number | null = null;

export const tauriBridge = {
  isNative: isTauriEnvironment,

  // Device discovery APIs
  async getLocalDeviceInfo(): Promise<LocalDeviceInfo> {
    if (isTauriEnvironment()) {
      return await invoke<LocalDeviceInfo>('get_local_device_info');
    }
    return getInitialWebDevice();
  },

  async updateDeviceName(newName: string): Promise<LocalDeviceInfo> {
    if (isTauriEnvironment()) {
      return await invoke<LocalDeviceInfo>('update_device_name', { newName });
    }
    const current = getInitialWebDevice();
    current.name = newName.trim();
    localStorage.setItem(LOCAL_STORAGE_DEVICE_KEY, JSON.stringify(current));
    
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

  // -------------------------------------------------------------
  // PHASE 2: Pairing & Authentication APIs
  // -------------------------------------------------------------

  async createPairingSession(): Promise<PairingSession> {
    if (isTauriEnvironment()) {
      return await invoke<PairingSession>('create_pairing_session');
    }

    const dev = getInitialWebDevice();
    const now = Date.now();
    const session: PairingSession = {
      sessionId: 'sess-' + Math.random().toString(36).substring(2, 11),
      localDeviceId: dev.id,
      localDeviceName: dev.name,
      ipAddress: dev.ipAddresses[0] || '192.168.1.105',
      port: dev.port,
      publicKey: 'a3b909f193ec83a31c50e4171694f4c2c5443a53e6b4b455b34bc2e3160a0a91',
      fingerprint: 'E3:4A:9C:12:8F:05:BD:7E',
      verificationCode: '481920',
      createdAt: now,
      expiresAt: now + (300 * 1000), // 5 minutes
      isActive: true,
    };

    activeWebSession = session;
    this.emitWebEvent('pairing:session-created', session);
    return session;
  },

  async cancelPairingSession(): Promise<boolean> {
    if (isTauriEnvironment()) {
      return await invoke<boolean>('cancel_pairing_session');
    }
    activeWebSession = null;
    pendingWebRequests = [];
    this.emitWebEvent('pairing:session-cancelled', null);
    return true;
  },

  async getPairingSession(): Promise<PairingSession | null> {
    if (isTauriEnvironment()) {
      return await invoke<PairingSession | null>('get_pairing_session');
    }
    if (activeWebSession && Date.now() < activeWebSession.expiresAt) {
      return activeWebSession;
    }
    return null;
  },

  async submitPairingRequest(qrJson: string): Promise<PairingRequest> {
    if (isTauriEnvironment()) {
      return await invoke<PairingRequest>('submit_pairing_request', { qrJson });
    }

    let parsedQr: QrPayload;
    try {
      parsedQr = JSON.parse(qrJson);
    } catch {
      throw new Error('Invalid QR code JSON string format');
    }

    if (parsedQr.protocol !== 'beamdrop-pairing') {
      throw new Error(`Incompatible pairing protocol: '${parsedQr.protocol}'`);
    }

    if (Date.now() >= parsedQr.expiresAt) {
      throw new Error('Pairing QR code has expired. Please regenerate.');
    }

    const dev = getInitialWebDevice();
    const request: PairingRequest = {
      requestId: 'req-' + Math.random().toString(36).substring(2, 9),
      sessionId: parsedQr.sessionId,
      fromDeviceId: dev.id,
      fromDeviceName: dev.name,
      fromPlatform: dev.platform,
      fromDeviceModel: dev.deviceModel,
      fromIpAddress: dev.ipAddresses[0] || '192.168.1.105',
      fromPort: dev.port,
      fromPublicKey: 'f9024c084656ec5688a44d858cf09f25752c00222f7743d78c005b766861614e',
      fromFingerprint: '9A:14:8B:D3:52:FC:31:01',
      verificationCode: parsedQr.verificationCode || '481920',
      timestamp: Date.now(),
      status: 'pending',
    };

    pendingWebRequests.push(request);
    this.emitWebEvent('pairing:request-received', request);
    return request;
  },

  async acceptPairingRequest(requestId: string): Promise<PairingResponse> {
    if (isTauriEnvironment()) {
      return await invoke<PairingResponse>('accept_pairing_request', { requestId });
    }

    const reqIndex = pendingWebRequests.findIndex(r => r.requestId === requestId);
    const req = reqIndex >= 0 ? pendingWebRequests[reqIndex] : null;
    if (!req) {
      throw new Error('Pairing request not found or expired');
    }

    pendingWebRequests.splice(reqIndex, 1);

    const newTrusted: TrustedDevice = {
      deviceId: req.fromDeviceId,
      name: req.fromDeviceName,
      platform: req.fromPlatform,
      deviceModel: req.fromDeviceModel,
      ipAddress: req.fromIpAddress,
      port: req.fromPort,
      publicKey: req.fromPublicKey,
      fingerprint: req.fromFingerprint,
      authTokenHash: 'token_hash_' + Math.random().toString(36).substring(2, 10),
      firstPairedAt: Date.now(),
      lastConnectedAt: Date.now(),
      isOnline: true,
      trustStatus: 'trusted',
    };

    const currentTrusted = await this.getTrustedDevices();
    const updated = [newTrusted, ...currentTrusted.filter(d => d.deviceId !== newTrusted.deviceId)];
    localStorage.setItem(LOCAL_STORAGE_TRUSTED_KEY, JSON.stringify(updated));

    this.emitWebEvent('pairing:request-accepted', newTrusted);
    this.emitWebEvent('trusted-devices:updated', null);

    return {
      success: true,
      requestId,
      authToken: 'auth_' + Math.random().toString(36).substring(2, 12),
      message: `Successfully paired with ${req.fromDeviceName}`,
    };
  },

  async rejectPairingRequest(requestId: string): Promise<PairingResponse> {
    if (isTauriEnvironment()) {
      return await invoke<PairingResponse>('reject_pairing_request', { requestId });
    }

    pendingWebRequests = pendingWebRequests.filter(r => r.requestId !== requestId);
    this.emitWebEvent('pairing:request-rejected', requestId);

    return {
      success: false,
      requestId,
      message: 'Pairing request rejected by device owner.',
    };
  },

  async getPendingPairingRequests(): Promise<PairingRequest[]> {
    if (isTauriEnvironment()) {
      return await invoke<PairingRequest[]>('get_pending_pairing_requests');
    }
    return pendingWebRequests;
  },

  // -------------------------------------------------------------
  // PHASE 2: Trusted Devices Management APIs
  // -------------------------------------------------------------

  async getTrustedDevices(): Promise<TrustedDevice[]> {
    if (isTauriEnvironment()) {
      return await invoke<TrustedDevice[]>('get_trusted_devices');
    }

    const stored = localStorage.getItem(LOCAL_STORAGE_TRUSTED_KEY);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        // ignore
      }
    }

    // Default trusted companion devices (e.g. Android phone and Mac workstation)
    const defaults: TrustedDevice[] = [
      {
        deviceId: 'peer-pix8-9a3b',
        name: "Aditya's Pixel 8",
        platform: 'android',
        deviceModel: 'Google Pixel 8 Pro',
        ipAddress: '192.168.1.142',
        port: 53317,
        publicKey: 'f9024c084656ec5688a44d858cf09f25752c00222f7743d78c005b766861614e',
        fingerprint: '9A:14:8B:D3:52:FC:31:01',
        authTokenHash: 'hash_android_sec_token_9a',
        firstPairedAt: Date.now() - 86400000 * 3, // 3 days ago
        lastConnectedAt: Date.now() - 15000,
        isOnline: true,
        trustStatus: 'trusted',
      },
      {
        deviceId: 'peer-mac-studio-41c',
        name: 'Studio Mac M3 Max',
        platform: 'macos',
        deviceModel: 'Mac Studio (Apple Silicon)',
        ipAddress: '192.168.1.180',
        port: 53317,
        publicKey: '2e89fa2110c9a4b37d8011234909ffaa5b642e12908f029a1b18237c00192a01',
        fingerprint: '41:C8:E9:0B:AA:23:D1:77',
        authTokenHash: 'hash_mac_studio_token_41',
        firstPairedAt: Date.now() - 86400000 * 7, // 7 days ago
        lastConnectedAt: Date.now() - 32000,
        isOnline: true,
        trustStatus: 'trusted',
      },
    ];

    localStorage.setItem(LOCAL_STORAGE_TRUSTED_KEY, JSON.stringify(defaults));
    return defaults;
  },

  async removeTrustedDevice(deviceId: string): Promise<boolean> {
    if (isTauriEnvironment()) {
      return await invoke<boolean>('remove_trusted_device', { deviceId });
    }

    const current = await this.getTrustedDevices();
    const updated = current.filter(d => d.deviceId !== deviceId);
    localStorage.setItem(LOCAL_STORAGE_TRUSTED_KEY, JSON.stringify(updated));
    this.emitWebEvent('trusted-devices:removed', deviceId);
    this.emitWebEvent('trusted-devices:updated', null);
    return true;
  },

  async renameTrustedDevice(deviceId: string, newName: string): Promise<boolean> {
    if (isTauriEnvironment()) {
      return await invoke<boolean>('rename_trusted_device', { deviceId, newName });
    }

    const current = await this.getTrustedDevices();
    const updated = current.map(d => (d.deviceId === deviceId ? { ...d, name: newName.trim() } : d));
    localStorage.setItem(LOCAL_STORAGE_TRUSTED_KEY, JSON.stringify(updated));
    this.emitWebEvent('trusted-devices:updated', null);
    return true;
  },

  async reconnectTrustedDevice(deviceId: string): Promise<boolean> {
    if (isTauriEnvironment()) {
      return await invoke<boolean>('reconnect_trusted_device', { deviceId });
    }

    const current = await this.getTrustedDevices();
    const updated = current.map(d => (d.deviceId === deviceId ? { ...d, lastConnectedAt: Date.now(), isOnline: true } : d));
    localStorage.setItem(LOCAL_STORAGE_TRUSTED_KEY, JSON.stringify(updated));
    this.emitWebEvent('trusted-devices:reconnected', deviceId);
    this.emitWebEvent('trusted-devices:updated', null);
    return true;
  },

  // Helper to simulate an incoming pairing request for interactive browser preview testing
  simulateIncomingPairing(name = "Aditya's Pixel 8", platform: LocalDeviceInfo['platform'] = 'android'): PairingRequest {
    const dev = getInitialWebDevice();
    const request: PairingRequest = {
      requestId: 'sim-req-' + Math.random().toString(36).substring(2, 9),
      sessionId: activeWebSession ? activeWebSession.sessionId : 'sess-preview',
      fromDeviceId: 'sim-peer-' + Math.random().toString(36).substring(2, 7),
      fromDeviceName: name,
      fromPlatform: platform,
      fromDeviceModel: platform === 'android' ? 'Google Pixel 8 Pro' : 'Ubuntu Laptop',
      fromIpAddress: '192.168.1.142',
      fromPort: 53317,
      fromPublicKey: 'f9024c084656ec5688a44d858cf09f25752c00222f7743d78c005b766861614e',
      fromFingerprint: '9A:14:8B:D3:52:FC:31:01',
      verificationCode: activeWebSession ? activeWebSession.verificationCode : '481920',
      timestamp: Date.now(),
      status: 'pending',
    };

    pendingWebRequests = [request, ...pendingWebRequests];
    this.emitWebEvent('pairing:request-received', request);
    return request;
  },

  // -------------------------------------------------------------
  // PHASE 3: Network Communication & Connection Management APIs
  // -------------------------------------------------------------

  async startNetworkService(): Promise<boolean> {
    if (isTauriEnvironment()) {
      return await invoke<boolean>('start_network_service');
    }
    webNetworkRunning = true;
    this.emitWebEvent('network-status-changed', { running: true });
    return true;
  },

  async stopNetworkService(): Promise<boolean> {
    if (isTauriEnvironment()) {
      return await invoke<boolean>('stop_network_service');
    }
    webNetworkRunning = false;
    for (const [id, conn] of Object.entries(webConnections)) {
      conn.state = 'disconnected';
      this.emitWebEvent('device-disconnected', id);
      this.emitWebEvent('connection-status-changed', conn);
    }
    this.emitWebEvent('network-status-changed', { running: false });
    return true;
  },

  async connectToDevice(
    deviceId: string,
    deviceName: string,
    platform: LocalDeviceInfo['platform'],
    ipAddress: string,
    port = 53317
  ): Promise<PeerConnection> {
    if (isTauriEnvironment()) {
      return await invoke<PeerConnection>('connect_to_device', {
        deviceId,
        deviceName,
        platform,
        ipAddress,
        port,
      });
    }

    // Web preview simulation
    if (!webNetworkRunning) {
      throw new Error('Network communication service is stopped.');
    }

    const conn: PeerConnection = {
      deviceId,
      deviceName,
      platform,
      ipAddress,
      port,
      state: 'connecting',
      connectedAt: null,
      lastHeartbeat: Date.now(),
      latencyMs: 0,
      reconnectAttempts: 0,
      isIncoming: false,
      txBytes: 0,
      rxBytes: 0,
    };

    webConnections[deviceId] = conn;
    this.emitWebEvent('connection-status-changed', conn);

    // Asynchronous simulated handshake: connecting -> authenticating -> connected
    setTimeout(() => {
      conn.state = 'authenticating';
      this.emitWebEvent('connection-status-changed', conn);

      setTimeout(() => {
        conn.state = 'connected';
        conn.connectedAt = Date.now();
        conn.lastHeartbeat = Date.now();
        conn.latencyMs = Math.floor(Math.random() * 5) + 2; // 2ms - 6ms LAN
        webTxBytes += 1024;
        webRxBytes += 512;
        webMessagesSent += 1;
        webMessagesReceived += 1;
        this.emitWebEvent('device-connected', conn);
        this.emitWebEvent('connection-status-changed', conn);
      }, 350);
    }, 250);

    return conn;
  },

  async disconnectFromDevice(deviceId: string): Promise<boolean> {
    if (isTauriEnvironment()) {
      return await invoke<boolean>('disconnect_from_device', { deviceId });
    }

    const conn = webConnections[deviceId];
    if (conn) {
      conn.state = 'disconnected';
      conn.connectedAt = null;
      this.emitWebEvent('device-disconnected', deviceId);
      this.emitWebEvent('connection-status-changed', conn);
      return true;
    }
    return false;
  },

  async getActiveConnections(): Promise<PeerConnection[]> {
    if (isTauriEnvironment()) {
      return await invoke<PeerConnection[]>('get_active_connections');
    }
    return Object.values(webConnections);
  },

  async getConnectionStatus(deviceId: string): Promise<PeerConnection | null> {
    if (isTauriEnvironment()) {
      return await invoke<PeerConnection | null>('get_connection_status', { deviceId });
    }
    return webConnections[deviceId] || null;
  },

  async sendDeviceMessage(
    recipientId: string,
    messageType: string,
    payload: unknown
  ): Promise<unknown> {
    if (isTauriEnvironment()) {
      return await invoke<unknown>('send_device_message', {
        recipientId,
        messageType,
        payload,
      });
    }

    const conn = webConnections[recipientId];
    if (!conn || conn.state !== 'connected') {
      throw new Error(`Device '${recipientId}' is not in connected state`);
    }

    const msg = {
      protocolVersion: '1.0',
      messageId: 'msg-' + Math.random().toString(36).substring(2, 9),
      senderDeviceId: getInitialWebDevice().id,
      recipientDeviceId: recipientId,
      messageType,
      timestamp: Date.now(),
      payload,
    };

    webTxBytes += JSON.stringify(msg).length;
    webMessagesSent += 1;
    conn.txBytes += JSON.stringify(msg).length;
    this.emitWebEvent('message-sent', msg);
    return msg;
  },

  async reconnectDevice(deviceId: string): Promise<PeerConnection> {
    if (isTauriEnvironment()) {
      return await invoke<PeerConnection>('reconnect_device', { deviceId });
    }

    const conn = webConnections[deviceId];
    if (conn) {
      conn.state = 'reconnecting';
      conn.reconnectAttempts += 1;
      this.emitWebEvent('connection-status-changed', conn);

      setTimeout(() => {
        conn.state = 'connected';
        conn.connectedAt = Date.now();
        conn.lastHeartbeat = Date.now();
        conn.reconnectAttempts = 0;
        conn.latencyMs = 3;
        this.emitWebEvent('connection-status-changed', conn);
        this.emitWebEvent('device-connected', conn);
      }, 600);
      return conn;
    }

    // If not found in memory, try to find in trusted devices
    const trusted = await this.getTrustedDevices();
    const target = trusted.find(d => d.deviceId === deviceId);
    if (!target) {
      throw new Error(`Device '${deviceId}' not found in trusted storage`);
    }

    return this.connectToDevice(target.deviceId, target.name, target.platform, target.ipAddress, target.port);
  },

  async getNetworkInformation(): Promise<NetworkInformation> {
    if (isTauriEnvironment()) {
      return await invoke<NetworkInformation>('get_network_information');
    }
    const dev = getInitialWebDevice();
    const active = Object.values(webConnections).filter(c => c.state === 'connected').length;

    return {
      isAvailable: true,
      localIp: dev.ipAddresses[0] || '192.168.1.105',
      port: dev.port,
      activeConnections: active,
      totalConnectedDevices: active,
      serviceRunning: webNetworkRunning,
    };
  },

  async getNetworkStatistics(): Promise<NetworkStatistics> {
    if (isTauriEnvironment()) {
      return await invoke<NetworkStatistics>('get_network_statistics');
    }
    const active = Object.values(webConnections).filter(c => c.state === 'connected').length;
    const uptime = Math.floor((Date.now() - webStatsStartTime) / 1000);

    return {
      totalTxBytes: webTxBytes,
      totalRxBytes: webRxBytes,
      totalMessagesSent: webMessagesSent,
      totalMessagesReceived: webMessagesReceived,
      activeConnectionsCount: active,
      uptimeSeconds: uptime,
    };
  },

  // --- Phase 4 File Transfer APIs ---

  async selectFiles(filePaths: string[]): Promise<SelectedFileItem[]> {
    if (isTauriEnvironment()) {
      return await invoke<SelectedFileItem[]>('select_files', { filePaths });
    }

    const newItems: SelectedFileItem[] = filePaths.map((p) => {
      const name = p.split('/').pop() || p.split('\\').pop() || p;
      const ext = name.includes('.') ? name.split('.').pop()?.toLowerCase() || '' : '';
      return {
        id: 'f-' + Math.random().toString(36).substring(2, 9),
        name,
        extension: ext,
        size: Math.floor(Math.random() * 85000000) + 1048576, // 1MB - 86MB mock size
        mimeType: ext === 'pdf' ? 'application/pdf' : ext === 'mp4' ? 'video/mp4' : 'application/octet-stream',
        path: p,
        lastModified: Date.now() - 3600000,
      };
    });

    webSelectedFiles = [...webSelectedFiles, ...newItems];
    return webSelectedFiles;
  },

  async addMockFile(file: { name: string; size: number; mimeType: string; path?: string }): Promise<SelectedFileItem[]> {
    const ext = file.name.includes('.') ? file.name.split('.').pop()?.toLowerCase() || '' : '';
    const item: SelectedFileItem = {
      id: 'f-' + Math.random().toString(36).substring(2, 9),
      name: file.name,
      extension: ext,
      size: file.size,
      mimeType: file.mimeType || 'application/octet-stream',
      path: file.path || `~/Documents/${file.name}`,
      lastModified: Date.now(),
    };
    webSelectedFiles = [...webSelectedFiles, item];
    return webSelectedFiles;
  },

  async getSelectedFiles(): Promise<SelectedFileItem[]> {
    if (isTauriEnvironment()) {
      return await invoke<SelectedFileItem[]>('get_selected_files');
    }
    return webSelectedFiles;
  },

  async removeSelectedFile(fileId: string): Promise<SelectedFileItem[]> {
    if (isTauriEnvironment()) {
      return await invoke<SelectedFileItem[]>('remove_selected_file', { fileId });
    }
    webSelectedFiles = webSelectedFiles.filter(f => f.id !== fileId);
    return webSelectedFiles;
  },

  async clearSelectedFiles(): Promise<void> {
    if (isTauriEnvironment()) {
      await invoke('clear_selected_files');
      return;
    }
    webSelectedFiles = [];
  },

  async getDownloadDirectory(): Promise<string> {
    if (isTauriEnvironment()) {
      return await invoke<string>('get_download_directory');
    }
    return webDownloadDirectory;
  },

  async setDownloadDirectory(path: string): Promise<string> {
    if (isTauriEnvironment()) {
      return await invoke<string>('set_download_directory', { path });
    }
    webDownloadDirectory = path;
    return path;
  },

  async openReceivedFileLocation(path: string): Promise<boolean> {
    if (isTauriEnvironment()) {
      return await invoke<boolean>('open_received_file_location', { path });
    }
    return true;
  },

  async startFileTransfer(params: {
    recipientId: string;
    recipientName: string;
    recipientIp: string;
    recipientPort?: number;
    fileIds?: string[];
  }): Promise<TransferSession> {
    if (isTauriEnvironment()) {
      return await invoke<TransferSession>('start_file_transfer', {
        recipientId: params.recipientId,
        recipientName: params.recipientName,
        recipientIp: params.recipientIp,
        recipientPort: params.recipientPort || 53317,
        fileIds: params.fileIds,
      });
    }

    const localDev = getInitialWebDevice();
    const filesToSend = params.fileIds
      ? webSelectedFiles.filter(f => params.fileIds?.includes(f.id))
      : webSelectedFiles;

    const totalBytes = filesToSend.reduce((acc, f) => acc + f.size, 0);
    const transferId = 'tx-' + Math.random().toString(36).substring(2, 9);

    const session: TransferSession = {
      transferId,
      direction: 'outgoing',
      senderDeviceId: localDev.id,
      senderDeviceName: localDev.name,
      senderPlatform: localDev.platform,
      recipientDeviceId: params.recipientId,
      recipientDeviceName: params.recipientName,
      recipientIp: params.recipientIp,
      recipientPort: params.recipientPort || 53317,
      files: filesToSend.map(f => ({
        fileId: f.id,
        name: f.name,
        size: f.size,
        mimeType: f.mimeType,
        path: f.path,
        isVerified: false,
        bytesTransferred: 0,
        status: 'transferring',
      })),
      totalBytes,
      bytesTransferred: 0,
      speedBytesPerSec: 18500000,
      estimatedSecondsRemaining: Math.ceil(totalBytes / 18500000),
      status: 'transferring',
      startedAt: Date.now(),
      destinationDirectory: webDownloadDirectory,
    };

    webActiveTransfers[transferId] = session;

    // Simulate real streaming chunks in web preview
    let currentBytes = 0;
    const interval = setInterval(() => {
      currentBytes += 3500000;
      if (currentBytes >= totalBytes) {
        currentBytes = totalBytes;
        clearInterval(interval);
        session.status = 'completed';
        session.bytesTransferred = totalBytes;
        session.completedAt = Date.now();
        session.speedBytesPerSec = 0;
        this.emitWebEvent('transfer-completed', session);
      } else {
        session.bytesTransferred = currentBytes;
        const remaining = totalBytes - currentBytes;
        session.estimatedSecondsRemaining = Math.max(1, Math.ceil(remaining / session.speedBytesPerSec));
        this.emitWebEvent('transfer-progress', {
          transferId,
          fileId: session.files[0]?.fileId || 'f1',
          fileName: session.files[0]?.name || 'transfer.bin',
          currentFileIndex: 1,
          totalFiles: session.files.length,
          bytesTransferred: currentBytes,
          totalBytes,
          percentage: Math.round((currentBytes / totalBytes) * 100),
          speedBytesPerSec: session.speedBytesPerSec,
          estimatedSecondsRemaining: session.estimatedSecondsRemaining,
          status: 'transferring',
        });
      }
    }, 250);

    return session;
  },

  async acceptTransfer(transferId: string): Promise<TransferSession> {
    if (isTauriEnvironment()) {
      return await invoke<TransferSession>('accept_transfer', { transferId });
    }

    const pending = webPendingIncomingTransfers.find(p => p.transferId === transferId);
    const localDev = getInitialWebDevice();
    const session: TransferSession = {
      transferId,
      direction: 'incoming',
      senderDeviceId: pending?.senderDeviceId || 'peer-remote',
      senderDeviceName: pending?.senderDeviceName || 'Remote Peer',
      senderPlatform: pending?.senderPlatform || 'android',
      recipientDeviceId: localDev.id,
      recipientDeviceName: localDev.name,
      recipientIp: localDev.ipAddresses[0] || '192.168.1.105',
      recipientPort: localDev.port,
      files: pending?.files.map(f => ({
        fileId: f.fileId,
        name: f.fileName,
        size: f.fileSize,
        mimeType: f.mimeType,
        isVerified: true,
        bytesTransferred: f.fileSize,
        status: 'completed',
      })) || [],
      totalBytes: pending?.totalBytes || 10485760,
      bytesTransferred: pending?.totalBytes || 10485760,
      speedBytesPerSec: 0,
      status: 'completed',
      startedAt: Date.now() - 3000,
      completedAt: Date.now(),
      destinationDirectory: webDownloadDirectory,
    };

    webActiveTransfers[transferId] = session;
    webPendingIncomingTransfers = webPendingIncomingTransfers.filter(p => p.transferId !== transferId);
    this.emitWebEvent('transfer-completed', session);
    return session;
  },

  async rejectTransfer(transferId: string, reason?: string): Promise<boolean> {
    if (isTauriEnvironment()) {
      await invoke('reject_transfer', { transferId, reason });
      return true;
    }
    webPendingIncomingTransfers = webPendingIncomingTransfers.filter(p => p.transferId !== transferId);
    this.emitWebEvent('transfer-rejected', { transferId, reason: reason || 'Declined' });
    return true;
  },

  async pauseTransfer(transferId: string): Promise<boolean> {
    if (isTauriEnvironment()) {
      await invoke('pause_transfer', { transferId });
      return true;
    }
    if (webActiveTransfers[transferId]) {
      webActiveTransfers[transferId].status = 'paused';
      webActiveTransfers[transferId].speedBytesPerSec = 0;
      this.emitWebEvent('transfer-updated', webActiveTransfers[transferId]);
    }
    return true;
  },

  async resumeTransfer(transferId: string): Promise<boolean> {
    if (isTauriEnvironment()) {
      await invoke('resume_transfer', { transferId });
      return true;
    }
    if (webActiveTransfers[transferId]) {
      webActiveTransfers[transferId].status = 'transferring';
      webActiveTransfers[transferId].speedBytesPerSec = 15200000;
      this.emitWebEvent('transfer-updated', webActiveTransfers[transferId]);
    }
    return true;
  },

  async cancelTransfer(transferId: string): Promise<boolean> {
    if (isTauriEnvironment()) {
      await invoke('cancel_transfer', { transferId });
      return true;
    }
    if (webActiveTransfers[transferId]) {
      webActiveTransfers[transferId].status = 'cancelled';
      webActiveTransfers[transferId].speedBytesPerSec = 0;
      this.emitWebEvent('transfer-cancelled', webActiveTransfers[transferId]);
    }
    return true;
  },

  async cancelTransferBatch(): Promise<number> {
    if (isTauriEnvironment()) {
      return await invoke<number>('cancel_transfer_batch');
    }
    const count = Object.keys(webActiveTransfers).length;
    Object.values(webActiveTransfers).forEach(s => {
      s.status = 'cancelled';
    });
    return count;
  },

  async getActiveTransfers(): Promise<TransferSession[]> {
    if (isTauriEnvironment()) {
      return await invoke<TransferSession[]>('get_active_transfers');
    }
    return Object.values(webActiveTransfers);
  },

  async getTransferDetails(transferId: string): Promise<TransferSession | null> {
    if (isTauriEnvironment()) {
      return await invoke<TransferSession | null>('get_transfer_details', { transferId });
    }
    return webActiveTransfers[transferId] || null;
  },

  simulateIncomingTransferRequest(fromDevice?: Partial<DiscoveredDevice>): IncomingTransferProposal {
    const proposal: IncomingTransferProposal = {
      transferId: 'tx-inc-' + Math.random().toString(36).substring(2, 9),
      senderDeviceId: fromDevice?.id || 'peer-pix8-9a3b',
      senderDeviceName: fromDevice?.name || "Aditya's Pixel 8",
      senderPlatform: fromDevice?.platform || 'android',
      senderIpAddress: fromDevice?.ipAddress || '192.168.1.142',
      fileCount: 2,
      totalBytes: 52428800, // 50 MB
      files: [
        {
          fileId: 'f-p8-01',
          fileName: 'Pixel_Camera_Photos_2026.zip',
          fileSize: 41943040,
          mimeType: 'application/zip',
        },
        {
          fileId: 'f-p8-02',
          fileName: 'audio_recording_notes.m4a',
          fileSize: 10485760,
          mimeType: 'audio/mp4',
        },
      ],
      expiresAt: Date.now() + 60000,
    };

    webPendingIncomingTransfers.push(proposal);
    this.emitWebEvent('incoming-transfer-request', proposal);
    return proposal;
  },

  // Event Subscription helper
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

