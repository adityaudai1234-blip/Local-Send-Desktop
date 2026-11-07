import { create } from 'zustand';
import { PairingRequest, PairingResponse, PairingSession, TrustedDevice } from '../types/pairing';
import { tauriBridge } from '../services/tauriBridge';

export interface PairingNotification {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
}

interface PairingStoreState {
  activeSession: PairingSession | null;
  pendingRequests: PairingRequest[];
  trustedDevices: TrustedDevice[];
  isLoading: boolean;
  error: string | null;
  notification: PairingNotification | null;

  // Actions
  init: () => Promise<void>;
  createSession: () => Promise<PairingSession | null>;
  cancelSession: () => Promise<void>;
  submitPairingRequest: (qrJson: string) => Promise<PairingRequest | null>;
  acceptRequest: (requestId: string) => Promise<PairingResponse | null>;
  rejectRequest: (requestId: string) => Promise<PairingResponse | null>;
  removeTrustedDevice: (deviceId: string) => Promise<boolean>;
  renameTrustedDevice: (deviceId: string, newName: string) => Promise<boolean>;
  reconnectDevice: (deviceId: string) => Promise<boolean>;
  simulateIncomingRequest: () => void;
  showNotification: (type: PairingNotification['type'], title: string, message: string) => void;
  clearNotification: () => void;
  clearError: () => void;
}

export const usePairingStore = create<PairingStoreState>((set, get) => ({
  activeSession: null,
  pendingRequests: [],
  trustedDevices: [],
  isLoading: false,
  error: null,
  notification: null,

  init: async () => {
    set({ isLoading: true });
    try {
      const [trusted, session, pending] = await Promise.all([
        tauriBridge.getTrustedDevices(),
        tauriBridge.getPairingSession(),
        tauriBridge.getPendingPairingRequests(),
      ]);

      set({
        trustedDevices: trusted,
        activeSession: session,
        pendingRequests: pending,
        isLoading: false,
      });

      // Subscriptions
      await tauriBridge.subscribeEvent<PairingSession>('pairing:session-created', (session) => {
        set({ activeSession: session });
      });

      await tauriBridge.subscribeEvent<void>('pairing:session-cancelled', () => {
        set({ activeSession: null });
      });

      await tauriBridge.subscribeEvent<PairingRequest>('pairing:request-received', (req) => {
        set((state) => ({
          pendingRequests: [req, ...state.pendingRequests.filter((r) => r.requestId !== req.requestId)],
        }));
        get().showNotification(
          'info',
          'Pairing Request Received',
          `${req.fromDeviceName} (${req.fromIpAddress}) wants to pair.`
        );
      });

      await tauriBridge.subscribeEvent<TrustedDevice>('pairing:request-accepted', (trusted) => {
        set((state) => ({
          trustedDevices: [trusted, ...state.trustedDevices.filter((d) => d.deviceId !== trusted.deviceId)],
          pendingRequests: state.pendingRequests.filter((r) => r.fromDeviceId !== trusted.deviceId),
        }));
        get().showNotification(
          'success',
          'Device Successfully Trusted',
          `${trusted.name} is now a verified peer.`
        );
      });

      await tauriBridge.subscribeEvent<string>('pairing:request-rejected', (requestId) => {
        set((state) => ({
          pendingRequests: state.pendingRequests.filter((r) => r.requestId !== requestId),
        }));
        get().showNotification(
          'warning',
          'Pairing Rejected',
          'The pairing connection was rejected.'
        );
      });

      await tauriBridge.subscribeEvent<string>('trusted-devices:removed', (deviceId) => {
        set((state) => ({
          trustedDevices: state.trustedDevices.filter((d) => d.deviceId !== deviceId),
        }));
        get().showNotification(
          'warning',
          'Device Removed',
          'Device credentials and mutual trust have been revoked.'
        );
      });

      await tauriBridge.subscribeEvent<string>('trusted-devices:reconnected', (deviceId) => {
        set((state) => ({
          trustedDevices: state.trustedDevices.map((d) =>
            d.deviceId === deviceId ? { ...d, lastConnectedAt: Date.now(), isOnline: true } : d
          ),
        }));
        get().showNotification(
          'success',
          'Reconnected',
          'Re-established authenticated session with trusted peer.'
        );
      });

      await tauriBridge.subscribeEvent<void>('trusted-devices:updated', async () => {
        const fresh = await tauriBridge.getTrustedDevices();
        set({ trustedDevices: fresh });
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message, isLoading: false });
    }
  },

  createSession: async () => {
    set({ isLoading: true, error: null });
    try {
      const session = await tauriBridge.createPairingSession();
      set({ activeSession: session, isLoading: false });
      return session;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message, isLoading: false });
      return null;
    }
  },

  cancelSession: async () => {
    try {
      await tauriBridge.cancelPairingSession();
      set({ activeSession: null });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message });
    }
  },

  submitPairingRequest: async (qrJson: string) => {
    set({ isLoading: true, error: null });
    try {
      const req = await tauriBridge.submitPairingRequest(qrJson);
      set({ isLoading: false });
      get().showNotification('info', 'Pairing Request Sent', 'Waiting for peer device to approve...');
      return req;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message, isLoading: false });
      get().showNotification('error', 'Pairing Failed', message);
      return null;
    }
  },

  acceptRequest: async (requestId: string) => {
    set({ isLoading: true, error: null });
    try {
      const res = await tauriBridge.acceptPairingRequest(requestId);
      const updated = await tauriBridge.getTrustedDevices();
      set({
        trustedDevices: updated,
        pendingRequests: get().pendingRequests.filter((r) => r.requestId !== requestId),
        isLoading: false,
      });
      return res;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message, isLoading: false });
      get().showNotification('error', 'Accept Failed', message);
      return null;
    }
  },

  rejectRequest: async (requestId: string) => {
    set({ isLoading: true, error: null });
    try {
      const res = await tauriBridge.rejectPairingRequest(requestId);
      set({
        pendingRequests: get().pendingRequests.filter((r) => r.requestId !== requestId),
        isLoading: false,
      });
      return res;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message, isLoading: false });
      return null;
    }
  },

  removeTrustedDevice: async (deviceId: string) => {
    set({ isLoading: true, error: null });
    try {
      const success = await tauriBridge.removeTrustedDevice(deviceId);
      if (success) {
        set((state) => ({
          trustedDevices: state.trustedDevices.filter((d) => d.deviceId !== deviceId),
          isLoading: false,
        }));
      }
      return success;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message, isLoading: false });
      return false;
    }
  },

  renameTrustedDevice: async (deviceId: string, newName: string) => {
    if (!newName.trim()) return false;
    try {
      const success = await tauriBridge.renameTrustedDevice(deviceId, newName.trim());
      if (success) {
        set((state) => ({
          trustedDevices: state.trustedDevices.map((d) =>
            d.deviceId === deviceId ? { ...d, name: newName.trim() } : d
          ),
        }));
        get().showNotification('success', 'Device Renamed', `Updated to "${newName.trim()}"`);
      }
      return success;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message });
      return false;
    }
  },

  reconnectDevice: async (deviceId: string) => {
    try {
      const success = await tauriBridge.reconnectTrustedDevice(deviceId);
      return success;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message });
      return false;
    }
  },

  simulateIncomingRequest: () => {
    tauriBridge.simulateIncomingPairing();
  },

  showNotification: (type, title, message) => {
    const notif: PairingNotification = {
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
