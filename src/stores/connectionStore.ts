import { create } from 'zustand';
import {
  HeartbeatPayload,
  NetworkInformation,
  NetworkStatistics,
  PeerConnection,
} from '../types/networking';
import { Platform } from '../types/device';
import { tauriBridge } from '../services/tauriBridge';

export interface ConnectionNotification {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
}

interface ConnectionStoreState {
  connections: Record<string, PeerConnection>;
  networkInfo: NetworkInformation | null;
  networkStats: NetworkStatistics | null;
  selectedConnection: PeerConnection | null;
  isLoading: boolean;
  error: string | null;
  notification: ConnectionNotification | null;

  // Actions
  init: () => Promise<void>;
  connectDevice: (device: {
    id: string;
    name: string;
    platform: Platform;
    ipAddress: string;
    port?: number;
  }) => Promise<PeerConnection | null>;
  disconnectDevice: (deviceId: string) => Promise<boolean>;
  reconnectDevice: (deviceId: string) => Promise<PeerConnection | null>;
  sendMessage: (recipientId: string, messageType: string, payload: unknown) => Promise<boolean>;
  toggleNetworkService: () => Promise<void>;
  refreshStats: () => Promise<void>;
  setSelectedConnection: (conn: PeerConnection | null) => void;
  showNotification: (type: ConnectionNotification['type'], title: string, message: string) => void;
  clearNotification: () => void;
  clearError: () => void;
}

export const useConnectionStore = create<ConnectionStoreState>((set, get) => ({
  connections: {},
  networkInfo: null,
  networkStats: null,
  selectedConnection: null,
  isLoading: false,
  error: null,
  notification: null,

  init: async () => {
    try {
      const [activeList, info, stats] = await Promise.all([
        tauriBridge.getActiveConnections(),
        tauriBridge.getNetworkInformation(),
        tauriBridge.getNetworkStatistics(),
      ]);

      const map: Record<string, PeerConnection> = {};
      activeList.forEach((c) => {
        map[c.deviceId] = c;
      });

      set({
        connections: map,
        networkInfo: info,
        networkStats: stats,
      });

      // Subscribe to real-time events from Rust/Tauri
      await tauriBridge.subscribeEvent<PeerConnection>('device-connected', (conn) => {
        set((state) => ({
          connections: { ...state.connections, [conn.deviceId]: conn },
          selectedConnection: state.selectedConnection?.deviceId === conn.deviceId ? conn : state.selectedConnection,
        }));
        get().showNotification(
          'success',
          'Peer Authenticated & Connected',
          `${conn.deviceName} (${conn.ipAddress}) session established.`
        );
      });

      await tauriBridge.subscribeEvent<string>('device-disconnected', (deviceId) => {
        set((state) => {
          const updated = { ...state.connections };
          if (updated[deviceId]) {
            updated[deviceId] = {
              ...updated[deviceId],
              state: 'disconnected',
              connectedAt: null,
            };
          }
          return {
            connections: updated,
            selectedConnection: state.selectedConnection?.deviceId === deviceId ? updated[deviceId] : state.selectedConnection,
          };
        });
        get().showNotification('warning', 'Device Disconnected', `Session ended for device.`);
      });

      await tauriBridge.subscribeEvent<PeerConnection>('connection-status-changed', (conn) => {
        set((state) => ({
          connections: { ...state.connections, [conn.deviceId]: conn },
          selectedConnection: state.selectedConnection?.deviceId === conn.deviceId ? conn : state.selectedConnection,
        }));
      });

      await tauriBridge.subscribeEvent<{ deviceId: string; message: string }>('connection-error', (err) => {
        get().showNotification('error', 'Connection Alert', err.message);
      });

      await tauriBridge.subscribeEvent<{ running: boolean }>('network-status-changed', (payload) => {
        set((state) => ({
          networkInfo: state.networkInfo ? { ...state.networkInfo, serviceRunning: payload.running } : null,
        }));
      });

      await tauriBridge.subscribeEvent<HeartbeatPayload>('heartbeat-updated', (hb) => {
        set((state) => {
          const current = state.connections[hb.deviceId];
          if (!current) return state;
          const updated = {
            ...state.connections,
            [hb.deviceId]: {
              ...current,
              latencyMs: hb.latencyMs,
              lastHeartbeat: hb.timestamp,
            },
          };
          return {
            connections: updated,
            selectedConnection: state.selectedConnection?.deviceId === hb.deviceId ? updated[hb.deviceId] : state.selectedConnection,
          };
        });
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: msg });
    }
  },

  connectDevice: async (device) => {
    set({ isLoading: true, error: null });
    try {
      const conn = await tauriBridge.connectToDevice(
        device.id,
        device.name,
        device.platform,
        device.ipAddress,
        device.port || 53317
      );

      set((state) => ({
        connections: { ...state.connections, [conn.deviceId]: conn },
        isLoading: false,
      }));

      return conn;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: msg, isLoading: false });
      get().showNotification('error', 'Connection Failed', msg);
      return null;
    }
  },

  disconnectDevice: async (deviceId: string) => {
    try {
      const success = await tauriBridge.disconnectFromDevice(deviceId);
      if (success) {
        set((state) => {
          const updated = { ...state.connections };
          if (updated[deviceId]) {
            updated[deviceId] = {
              ...updated[deviceId],
              state: 'disconnected',
              connectedAt: null,
            };
          }
          return {
            connections: updated,
            selectedConnection: state.selectedConnection?.deviceId === deviceId ? updated[deviceId] : state.selectedConnection,
          };
        });
      }
      return success;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: msg });
      return false;
    }
  },

  reconnectDevice: async (deviceId: string) => {
    set({ isLoading: true });
    get().showNotification('info', 'Reconnecting', 'Attempting authenticated reconnection...');
    try {
      const conn = await tauriBridge.reconnectDevice(deviceId);
      set((state) => ({
        connections: { ...state.connections, [conn.deviceId]: conn },
        isLoading: false,
      }));
      return conn;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: msg, isLoading: false });
      get().showNotification('error', 'Reconnection Failed', msg);
      return null;
    }
  },

  sendMessage: async (recipientId: string, messageType: string, payload: unknown) => {
    try {
      await tauriBridge.sendDeviceMessage(recipientId, messageType, payload);
      get().showNotification('info', 'Message Sent', `Dispatched ${messageType} frame.`);
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: msg });
      get().showNotification('error', 'Message Failed', msg);
      return false;
    }
  },

  toggleNetworkService: async () => {
    const isRunning = get().networkInfo?.serviceRunning ?? true;
    try {
      if (isRunning) {
        await tauriBridge.stopNetworkService();
      } else {
        await tauriBridge.startNetworkService();
      }
      const info = await tauriBridge.getNetworkInformation();
      set({ networkInfo: info });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: msg });
    }
  },

  refreshStats: async () => {
    try {
      const [info, stats] = await Promise.all([
        tauriBridge.getNetworkInformation(),
        tauriBridge.getNetworkStatistics(),
      ]);
      set({ networkInfo: info, networkStats: stats });
    } catch {
      // ignore
    }
  },

  setSelectedConnection: (conn) => {
    set({ selectedConnection: conn });
  },

  showNotification: (type, title, message) => {
    const notif: ConnectionNotification = {
      id: Math.random().toString(36).substring(2, 9),
      type,
      title,
      message,
    };
    set({ notification: notif });
    setTimeout(() => {
      if (get().notification?.id === notif.id) {
        set({ notification: null });
      }
    }, 4500);
  },

  clearNotification: () => {
    set({ notification: null });
  },

  clearError: () => {
    set({ error: null });
  },
}));
