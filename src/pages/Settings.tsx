import React, { useState } from 'react';
import {
  Sun,
  Moon,
  Laptop,
  Check,
  Shield,
  Radio,
  Folder,
  Layers,
  Database,
  ExternalLink,
} from 'lucide-react';
import { useSettingsStore } from '../stores/settingsStore';
import { useDeviceStore } from '../stores/deviceStore';
import { isTauriEnvironment } from '../services/tauriBridge';

export const Settings: React.FC = () => {
  const {
    theme,
    setTheme,
    autoStartDiscovery,
    discoveryPort,
    allowIncoming,
    notifyOnDiscovery,
    quickSave,
    saveDirectory,
    updateSettings,
  } = useSettingsStore();

  const { localDevice, updateDeviceName, isLoading } = useDeviceStore();

  const [deviceNameInput, setDeviceNameInput] = useState(localDevice?.name || '');
  const [nameSavedNotice, setNameSavedNotice] = useState(false);
  const [portInput, setPortInput] = useState(discoveryPort.toString());

  const isNative = isTauriEnvironment();

  const handleSaveDeviceName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deviceNameInput.trim()) return;
    const success = await updateDeviceName(deviceNameInput.trim());
    if (success) {
      setNameSavedNotice(true);
      setTimeout(() => setNameSavedNotice(false), 2000);
    }
  };

  const handlePortChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setPortInput(val);
    const parsed = parseInt(val, 10);
    if (!isNaN(parsed) && parsed > 0 && parsed <= 65535) {
      updateSettings({ discoveryPort: parsed });
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-white">
          Application Preferences
        </h2>
        <p className="text-xs text-neutral-500">
          Configure discovery parameters, network ports, and client presentation.
        </p>
      </div>

      {/* 1. Device Identity Settings */}
      <section className="p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
            Device Identity
          </h3>
          <p className="text-xs text-neutral-500">
            Customize how your machine advertises itself to other peers on the local network.
          </p>
        </div>

        <form onSubmit={handleSaveDeviceName} className="space-y-3">
          <div className="max-w-md">
            <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
              Device Broadcast Alias
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={deviceNameInput}
                onChange={(e) => setDeviceNameInput(e.target.value)}
                className="flex-1 px-3 py-2 text-xs rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white focus:outline-hidden focus:ring-1 focus:ring-neutral-400"
                maxLength={48}
              />
              <button
                type="submit"
                disabled={isLoading || !deviceNameInput.trim() || deviceNameInput === localDevice?.name}
                className="px-3.5 py-2 text-xs font-medium rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors disabled:opacity-40"
              >
                {isLoading ? 'Saving...' : 'Update'}
              </button>
            </div>
            {nameSavedNotice && (
              <p className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 mt-1.5 font-medium">
                <Check className="w-3.5 h-3.5" />
                Updated and re-advertised across mDNS!
              </p>
            )}
          </div>

          <div className="text-[11px] text-neutral-400 space-y-0.5">
            <p>• Persistent Device UUID: <span className="font-mono text-neutral-600 dark:text-neutral-300">{localDevice?.id}</span></p>
            <p>• Operating System: <span className="font-mono text-neutral-600 dark:text-neutral-300">{localDevice?.platform}</span></p>
          </div>
        </form>
      </section>

      {/* 2. Visual Theme Selection */}
      <section className="p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
            Interface Appearance
          </h3>
          <p className="text-xs text-neutral-500">
            Switch between dark and light desktop palettes.
          </p>
        </div>

        <div className="grid grid-cols-2 max-w-sm gap-3">
          <button
            onClick={() => setTheme('dark')}
            className={`p-3 rounded-lg border text-left transition-all flex items-center justify-between ${
              theme === 'dark'
                ? 'border-neutral-900 dark:border-neutral-100 bg-neutral-100 dark:bg-neutral-800'
                : 'border-neutral-200 dark:border-neutral-800 hover:border-neutral-300'
            }`}
          >
            <div className="flex items-center gap-2 text-xs font-medium text-neutral-900 dark:text-white">
              <Moon className="w-4 h-4 text-cyan-400" />
              <span>Dark Theme</span>
            </div>
            {theme === 'dark' && <Check className="w-4 h-4 text-neutral-900 dark:text-white" />}
          </button>

          <button
            onClick={() => setTheme('light')}
            className={`p-3 rounded-lg border text-left transition-all flex items-center justify-between ${
              theme === 'light'
                ? 'border-neutral-900 dark:border-neutral-100 bg-neutral-100 dark:bg-neutral-800'
                : 'border-neutral-200 dark:border-neutral-800 hover:border-neutral-300'
            }`}
          >
            <div className="flex items-center gap-2 text-xs font-medium text-neutral-900 dark:text-white">
              <Sun className="w-4 h-4 text-amber-500" />
              <span>Light Theme</span>
            </div>
            {theme === 'light' && <Check className="w-4 h-4 text-neutral-900 dark:text-white" />}
          </button>
        </div>
      </section>

      {/* 3. Network Discovery Settings */}
      <section className="p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
            Network & Discovery
          </h3>
          <p className="text-xs text-neutral-500">
            mDNS multicast and local TCP listening configuration.
          </p>
        </div>

        <div className="space-y-3 max-w-lg text-xs">
          {/* Auto discovery toggle */}
          <div className="flex items-center justify-between py-2 border-b border-neutral-100 dark:border-neutral-800">
            <div>
              <span className="font-medium text-neutral-900 dark:text-white block">Auto-Start Discovery</span>
              <span className="text-neutral-500">Automatically listen for nearby devices upon application launch.</span>
            </div>
            <input
              type="checkbox"
              checked={autoStartDiscovery}
              onChange={(e) => updateSettings({ autoStartDiscovery: e.target.checked })}
              className="w-4 h-4 rounded text-neutral-900 focus:ring-0"
            />
          </div>

          {/* Allow incoming */}
          <div className="flex items-center justify-between py-2 border-b border-neutral-100 dark:border-neutral-800">
            <div>
              <span className="font-medium text-neutral-900 dark:text-white block">Allow Incoming Transfers</span>
              <span className="text-neutral-500">Permit compatible peers on this Wi-Fi network to request file sends.</span>
            </div>
            <input
              type="checkbox"
              checked={allowIncoming}
              onChange={(e) => updateSettings({ allowIncoming: e.target.checked })}
              className="w-4 h-4 rounded text-neutral-900 focus:ring-0"
            />
          </div>

          {/* Port setting */}
          <div className="flex items-center justify-between py-2">
            <div>
              <span className="font-medium text-neutral-900 dark:text-white block">Default Socket Port</span>
              <span className="text-neutral-500">Standard BeamDrop / LocalSend port is 53317.</span>
            </div>
            <input
              type="number"
              value={portInput}
              onChange={handlePortChange}
              min="1024"
              max="65535"
              className="w-24 px-2 py-1 text-xs font-mono rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white"
            />
          </div>
        </div>
      </section>

      {/* 4. Startup Preferences UI */}
      <section className="p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60 space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
            Desktop Integration Preferences
          </h3>
          <p className="text-xs text-neutral-500">
            System launch and background tray persistence.
          </p>
        </div>

        <div className="space-y-2 text-xs text-neutral-600 dark:text-neutral-300">
          <label className="flex items-center gap-2.5">
            <input type="checkbox" defaultChecked className="w-4 h-4 rounded text-neutral-900" />
            <span>Launch minimized to system tray upon operating system login</span>
          </label>
          <label className="flex items-center gap-2.5">
            <input type="checkbox" defaultChecked className="w-4 h-4 rounded text-neutral-900" />
            <span>Show system notification when a new device joins the local network</span>
          </label>
          <label className="flex items-center gap-2.5">
            <input type="checkbox" className="w-4 h-4 rounded text-neutral-900" />
            <span>Close to notification tray instead of terminating application</span>
          </label>
        </div>
      </section>

      {/* 5. Application Information & Architecture */}
      <section className="p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-950/40 space-y-3 text-xs">
        <div className="flex items-center gap-2 text-neutral-900 dark:text-white font-semibold">
          <Layers className="w-4 h-4" />
          <span>System & Architecture Specifications</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-neutral-500">
          <div className="p-3 rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200/60 dark:border-neutral-800 space-y-1">
            <span className="font-medium text-neutral-900 dark:text-white block">Tauri 2 Framework</span>
            <p>Rust native backend with zero Chromium overhead. Fast native socket threads.</p>
          </div>

          <div className="p-3 rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200/60 dark:border-neutral-800 space-y-1">
            <span className="font-medium text-neutral-900 dark:text-white block">Zero Cloud Architecture</span>
            <p>No telemetry, no Firebase, no cloud relays. Transfers stay entirely within your local LAN.</p>
          </div>

          <div className="p-3 rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200/60 dark:border-neutral-800 space-y-1">
            <span className="font-medium text-neutral-900 dark:text-white block">mDNS Protocol</span>
            <p>Service <span className="font-mono text-neutral-800 dark:text-neutral-200">_beamdrop._tcp.local.</span> running on multicast port 5353.</p>
          </div>

          <div className="p-3 rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200/60 dark:border-neutral-800 space-y-1">
            <span className="font-medium text-neutral-900 dark:text-white block">Database Integration</span>
            <p>SQLite crate <span className="font-mono text-neutral-800 dark:text-neutral-200">rusqlite</span> bundled in Cargo.toml for future transfer logging.</p>
          </div>
        </div>

        <div className="pt-2 text-[11px] text-neutral-400 flex items-center justify-between">
          <span>BeamDrop Desktop v1.0.0 (Phase 1 Build)</span>
          <span className="font-mono">Runtime: {isNative ? 'Tauri 2.0.0 / Rust' : 'Web Preview / Vite 8'}</span>
        </div>
      </section>
    </div>
  );
};
