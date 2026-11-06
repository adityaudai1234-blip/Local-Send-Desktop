import { create } from 'zustand';

export interface SettingsState {
  theme: 'dark' | 'light';
  autoStartDiscovery: boolean;
  discoveryPort: number;
  protocolVersion: string;
  allowIncoming: boolean;
  notifyOnDiscovery: boolean;
  quickSave: boolean;
  saveDirectory: string;
  setTheme: (theme: 'dark' | 'light') => void;
  toggleTheme: () => void;
  updateSettings: (partial: Partial<Omit<SettingsState, 'setTheme' | 'toggleTheme' | 'updateSettings'>>) => void;
}

const SETTINGS_STORAGE_KEY = 'beamdrop_user_settings';

function getStoredSettings() {
  if (typeof window === 'undefined') {
    return {
      theme: 'dark' as const,
      autoStartDiscovery: true,
      discoveryPort: 53317,
      protocolVersion: '1.0',
      allowIncoming: true,
      notifyOnDiscovery: true,
      quickSave: false,
      saveDirectory: 'Downloads/BeamDrop',
    };
  }

  const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      // ignore
    }
  }

  return {
    theme: 'dark' as const,
    autoStartDiscovery: true,
    discoveryPort: 53317,
    protocolVersion: '1.0',
    allowIncoming: true,
    notifyOnDiscovery: true,
    quickSave: false,
    saveDirectory: 'Downloads/BeamDrop',
  };
}

export const useSettingsStore = create<SettingsState>((set, get) => {
  const initial = getStoredSettings();

  // Apply dark class to html tag initially
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
  };
});
