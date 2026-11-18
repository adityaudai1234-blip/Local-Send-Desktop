import { create } from 'zustand';
import { tauriBridge } from '../services/tauriBridge';
import type {
  DeviceIdentityPublic,
  KeyRotationResult,
  SecureSessionSummary,
  SecureStorageStatus,
  SecurityAuditEvent,
  SecurityEventFilter,
  SecurityPostureStatus,
  SecurityPrivacySettings,
  SecuritySelfTestReport,
  TrustedDeviceSecurityInfo,
} from '../types/security';

interface SecurityStoreState {
  posture: SecurityPostureStatus | null;
  identity: DeviceIdentityPublic | null;
  storageStatus: SecureStorageStatus | null;
  privacySettings: SecurityPrivacySettings | null;
  activeSessions: SecureSessionSummary[];
  trustedSecurity: TrustedDeviceSecurityInfo[];
  auditEvents: SecurityAuditEvent[];
  selfTestReport: SecuritySelfTestReport | null;
  isLoading: boolean;
  isRunningSelfTest: boolean;
  error: string | null;

  init: () => Promise<void>;
  refreshAll: () => Promise<void>;
  updatePrivacySettings: (next: SecurityPrivacySettings) => Promise<SecurityPrivacySettings | null>;
  verifyDeviceIdentity: (deviceId: string, expectedFingerprint?: string) => Promise<boolean>;
  revokeDevice: (deviceId: string, reason?: string) => Promise<boolean>;
  rotateDeviceKeys: () => Promise<KeyRotationResult | null>;
  searchAuditEvents: (filter: SecurityEventFilter) => Promise<void>;
  clearAuditLog: () => Promise<number>;
  runSelfTests: () => Promise<SecuritySelfTestReport | null>;
  clearError: () => void;
}

export const useSecurityStore = create<SecurityStoreState>((set, get) => ({
  posture: null,
  identity: null,
  storageStatus: null,
  privacySettings: null,
  activeSessions: [],
  trustedSecurity: [],
  auditEvents: [],
  selfTestReport: null,
  isLoading: false,
  isRunningSelfTest: false,
  error: null,

  init: async () => {
    await get().refreshAll();

    await tauriBridge.subscribeEvent<SecurityAuditEvent>('security:audit-event', (ev) => {
      set((state) => ({
        auditEvents: [ev, ...state.auditEvents.filter((e) => e.eventId !== ev.eventId)].slice(0, 250),
      }));
    });

    await tauriBridge.subscribeEvent<SecureSessionSummary[]>('security:sessions-updated', (sessions) => {
      set({ activeSessions: sessions });
    });

    await tauriBridge.subscribeEvent<DeviceIdentityPublic>('security:key-rotated', (identity) => {
      set({ identity });
      get().refreshAll();
    });

    await tauriBridge.subscribeEvent<void>('security:audit-cleared', () => {
      set({ auditEvents: [] });
    });

    await tauriBridge.subscribeEvent<void>('trusted-devices:updated', () => {
      get().refreshAll();
    });
  },

  refreshAll: async () => {
    set({ isLoading: true, error: null });
    try {
      const [posture, identity, storageStatus, privacySettings, activeSessions, trustedSecurity, auditEvents] =
        await Promise.all([
          tauriBridge.getSecurityStatus(),
          tauriBridge.getDeviceIdentity(),
          tauriBridge.getSecureStorageStatus(),
          tauriBridge.getSecuritySettings(),
          tauriBridge.getActiveSecureSessions(),
          tauriBridge.getTrustedDeviceSecurity(),
          tauriBridge.getSecurityAuditLog(200),
        ]);

      set({
        posture,
        identity,
        storageStatus,
        privacySettings,
        activeSessions,
        trustedSecurity,
        auditEvents,
        isLoading: false,
      });
    } catch (err: unknown) {
      set({
        error: err instanceof Error ? err.message : String(err),
        isLoading: false,
      });
    }
  },

  updatePrivacySettings: async (next) => {
    set({ error: null });
    try {
      const updated = await tauriBridge.updateSecuritySettings(next);
      set({ privacySettings: updated });
      await get().refreshAll();
      return updated;
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  },

  verifyDeviceIdentity: async (deviceId, expectedFingerprint) => {
    set({ error: null });
    try {
      await tauriBridge.verifyDeviceIdentity(deviceId, expectedFingerprint);
      await get().refreshAll();
      return true;
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  revokeDevice: async (deviceId, reason) => {
    set({ error: null });
    try {
      const ok = await tauriBridge.revokeDevice(deviceId, reason);
      await get().refreshAll();
      return ok;
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  rotateDeviceKeys: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await tauriBridge.rotateDeviceKeys();
      await get().refreshAll();
      return res;
    } catch (err: unknown) {
      set({
        error: err instanceof Error ? err.message : String(err),
        isLoading: false,
      });
      return null;
    }
  },

  searchAuditEvents: async (filter) => {
    try {
      const list = await tauriBridge.searchSecurityEvents(filter);
      set({ auditEvents: list });
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  clearAuditLog: async () => {
    try {
      const removed = await tauriBridge.clearSecurityAuditLog();
      set({ auditEvents: [] });
      return removed;
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return 0;
    }
  },

  runSelfTests: async () => {
    set({ isRunningSelfTest: true, error: null });
    try {
      const report = await tauriBridge.runSecuritySelfTest();
      const events = await tauriBridge.getSecurityAuditLog(200);
      set({ selfTestReport: report, auditEvents: events, isRunningSelfTest: false });
      return report;
    } catch (err: unknown) {
      set({
        error: err instanceof Error ? err.message : String(err),
        isRunningSelfTest: false,
      });
      return null;
    }
  },

  clearError: () => set({ error: null }),
}));
