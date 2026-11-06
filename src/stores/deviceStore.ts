import { create } from 'zustand';
import { DiscoveredDevice, DiscoveryState, LocalDeviceInfo, NetworkInterfaceInfo } from '../types/device';
import { tauriBridge } from '../services/tauriBridge';

interface DeviceStoreState {
  localDevice: LocalDeviceInfo | null;
  discoveredDevices: DiscoveredDevice[];
  discoveryState: DiscoveryState;
  networkInterfaces: NetworkInterfaceInfo[];
  isLoading: boolean;
  isSearching: boolean;
  error: string | null;
  lastRefreshedAt: number | null;
  selectedDevice: DiscoveredDevice | null;
  
  // Actions
  init: () => Promise<void>;
  updateDeviceName: (newName: string) => Promise<boolean>;
  startDiscovery: () => Promise<void>;
  stopDiscovery: () => Promise<void>;
  refreshDevices: () => Promise<void>;
  addManualDevice: (ipAddress: string, port?: number, name?: string) => Promise<boolean>;
  removeDevice: (deviceId: string) => Promise<void>;
  setSelectedDevice: (device: DiscoveredDevice | null) => void;
  clearError: () => void;
}

export const useDeviceStore = create<DeviceStoreState>((set, get) => ({
  localDevice: null,
  discoveredDevices: [],
  discoveryState: {
    isActive: false,
    serviceType: '_beamdrop._tcp.local.',
    advertisedName: '',
    deviceCount: 0,
  },
  networkInterfaces: [],
  isLoading: true,
  isSearching: false,
  error: null,
  lastRefreshedAt: null,
  selectedDevice: null,

  init: async () => {
    set({ isLoading: true, error: null });
    try {
      const [local, initialDevices, interfaces] = await Promise.all([
        tauriBridge.getLocalDeviceInfo(),
        tauriBridge.getDiscoveredDevices(),
        tauriBridge.getNetworkInterfaces(),
      ]);

      const state = await tauriBridge.startDiscovery();

      set({
        localDevice: local,
        discoveredDevices: initialDevices,
        networkInterfaces: interfaces,
        discoveryState: state,
        isLoading: false,
        lastRefreshedAt: Date.now(),
      });

      // Subscribe to backend mDNS events
      await tauriBridge.subscribeEvent<DiscoveredDevice>('discovery:device-discovered', (device) => {
        set((state) => {
          const exists = state.discoveredDevices.some((d) => d.id === device.id);
          if (exists) {
            return {
              discoveredDevices: state.discoveredDevices.map((d) => (d.id === device.id ? device : d)),
            };
          }
          return {
            discoveredDevices: [device, ...state.discoveredDevices],
          };
        });
      });

      await tauriBridge.subscribeEvent<DiscoveredDevice>('discovery:device-updated', (device) => {
        set((state) => ({
          discoveredDevices: state.discoveredDevices.map((d) => (d.id === device.id ? device : d)),
        }));
      });

      await tauriBridge.subscribeEvent<string>('discovery:device-lost', (deviceId) => {
        set((state) => ({
          discoveredDevices: state.discoveredDevices.filter((d) => d.id !== deviceId),
          selectedDevice: state.selectedDevice?.id === deviceId ? null : state.selectedDevice,
        }));
      });

      await tauriBridge.subscribeEvent<DiscoveryState>('discovery:state-changed', (discoveryState) => {
        set({ discoveryState });
      });

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message, isLoading: false });
    }
  },

  updateDeviceName: async (newName: string) => {
    if (!newName.trim()) {
      set({ error: 'Device name cannot be blank.' });
      return false;
    }
    set({ isLoading: true, error: null });
    try {
      const updated = await tauriBridge.updateDeviceName(newName);
      set({
        localDevice: updated,
        discoveryState: {
          ...get().discoveryState,
          advertisedName: updated.name,
        },
        isLoading: false,
      });
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message, isLoading: false });
      return false;
    }
  },

  startDiscovery: async () => {
    set({ isSearching: true, error: null });
    try {
      const state = await tauriBridge.startDiscovery();
      const devices = await tauriBridge.getDiscoveredDevices();
      set({
        discoveryState: state,
        discoveredDevices: devices,
        isSearching: false,
        lastRefreshedAt: Date.now(),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message, isSearching: false });
    }
  },

  stopDiscovery: async () => {
    try {
      const state = await tauriBridge.stopDiscovery();
      set({ discoveryState: state });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message });
    }
  },

  refreshDevices: async () => {
    set({ isSearching: true, error: null });
    try {
      const state = await tauriBridge.refreshDevices();
      const devices = await tauriBridge.getDiscoveredDevices();
      set({
        discoveryState: state,
        discoveredDevices: devices,
        isSearching: false,
        lastRefreshedAt: Date.now(),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message, isSearching: false });
    }
  },

  addManualDevice: async (ipAddress: string, port = 53317, name?: string) => {
    // Validate IPv4 format
    const ipv4Regex = /^((25[0-5]|(2[0-4]|1\d|[1-9]|)\d)\.?\b){4}$/;
    if (!ipv4Regex.test(ipAddress.trim()) && ipAddress.trim() !== 'localhost') {
      set({ error: 'Please enter a valid IPv4 address (e.g. 192.168.1.120)' });
      return false;
    }

    set({ isLoading: true, error: null });
    try {
      const added = await tauriBridge.addManualDevice(ipAddress.trim(), port, name);
      set((state) => {
        const withoutOld = state.discoveredDevices.filter(d => d.ipAddress !== added.ipAddress);
        return {
          discoveredDevices: [added, ...withoutOld],
          isLoading: false,
        };
      });
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message, isLoading: false });
      return false;
    }
  },

  removeDevice: async (deviceId: string) => {
    try {
      await tauriBridge.removeDevice(deviceId);
      set((state) => ({
        discoveredDevices: state.discoveredDevices.filter((d) => d.id !== deviceId),
        selectedDevice: state.selectedDevice?.id === deviceId ? null : state.selectedDevice,
      }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message });
    }
  },

  setSelectedDevice: (device) => {
    set({ selectedDevice: device });
  },

  clearError: () => {
    set({ error: null });
  },
}));
