import { create } from 'zustand';
import { tauriBridge } from '../services/tauriBridge';

export interface SettingsState {
  theme: 'dark' | 'light';
  autoStartDiscovery: boolean;
  discoveryPort: number;
  protocolVersion: string;
  allowIncoming: boolean;
  notifyOnDiscovery: boolean;
  notificationsEnabled: boolean;
  minimizeToTray: boolean;
  launchMinimized: boolean;
  quickSave: boolean;
  saveDirectory: string;
  setTheme: (theme: 'dark' | 'light') => void;
  toggleTheme: () => void;
  updateSettings: (
    partial: Partial<Omit<SettingsState, 'setTheme' | 'toggleTheme' | 'updateSettings' | 'setNotificationsEnabled'>>
  ) => void;
  setNotificationsEnabled: (enabled: boolean) => Promise<void>;
}

const SETTINGS_STORAGE_KEY = 'beamdrop_user_settings';

function getStoredSettings() {
  const defaults = {
    theme: 'dark' as const,
    autoStartDiscovery: true,
    discoveryPort: 53317,
    protocolVersion: '1.0',
    allowIncoming: true,
    notifyOnDiscovery: true,
    notificationsEnabled: true,
    minimizeToTray: true,
    launchMinimized: false,
    quickSave: false,
    saveDirectory: '~/Downloads/BeamDrop',
  };

  if (typeof window === 'undefined') {
    return defaults;
  }

  const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
  if (stored) {
    try {
      return { ...defaults, ...JSON.parse(stored) };
    } catch {
      // ignore
    }
  }

  return defaults;
}

export const useSettingsStore = create<SettingsState>((set, get) => {
  const initial = getStoredSettings();

  if (typeof document !== 'undefined') {
    if (initial.theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }

  return {
    ...initial,

    setTheme: (theme: 'dark' | 'light') => {
      if (typeof document !== 'undefined') {
        if (theme === 'dark') {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
      }
      set({ theme });
      const current = get();
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(current));
    },

    toggleTheme: () => {
      const next = get().theme === 'dark' ? 'light' : 'dark';
      get().setTheme(next);
    },

    updateSettings: (partial) => {
      set(partial);
      const current = get();
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(current));
    },

    setNotificationsEnabled: async (enabled: boolean) => {
      await tauriBridge.setNotificationsEnabled(enabled);
      set({ notificationsEnabled: enabled });
      const current = get();
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(current));
    },
  };
});
