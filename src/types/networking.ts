import { Platform } from './device';

export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'authenticating'
  | 'connected'
  | 'reconnecting'
  | 'failed';

export interface PeerConnection {
  deviceId: string;
  deviceName: string;
  platform: Platform;
  ipAddress: string;
  port: number;
  state: ConnectionState;
  connectedAt: number | null;
  lastHeartbeat: number;
  latencyMs: number;
  reconnectAttempts: number;
  isIncoming: boolean;
  txBytes: number;
  rxBytes: number;
}

export interface NetworkInformation {
  isAvailable: boolean;
  localIp: string;
  port: number;
  activeConnections: number;
  totalConnectedDevices: number;
  serviceRunning: boolean;
}

export interface NetworkStatistics {
  totalTxBytes: number;
  totalRxBytes: number;
  totalMessagesSent: number;
  totalMessagesReceived: number;
  activeConnectionsCount: number;
  uptimeSeconds: number;
}

export interface HeartbeatPayload {
  deviceId: string;
  latencyMs: number;
  timestamp: number;
}
