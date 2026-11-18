import React, { useEffect, useState } from 'react';
import {
  Sun,
  Moon,
  Check,
  Layers,
  Folder,
  Bell,
  Shield,
  Lock,
  AlertTriangle,
} from 'lucide-react';
import { useSettingsStore } from '../stores/settingsStore';
import { useDeviceStore } from '../stores/deviceStore';
import { useTransferStore } from '../stores/transferStore';
import { useSecurityStore } from '../stores/securityStore';
import { isTauriEnvironment } from '../services/tauriBridge';
import type { SecurityPrivacySettings } from '../types/security';

export const Settings: React.FC = () => {
  const {
    theme,
    setTheme,
    autoStartDiscovery,
    discoveryPort,
    allowIncoming,
    notifyOnDiscovery,
    notificationsEnabled,
    minimizeToTray,
    launchMinimized,
    updateSettings,
    setNotificationsEnabled,
  } = useSettingsStore();

  const { localDevice, updateDeviceName, isLoading } = useDeviceStore();
  const { downloadDirectory, setDownloadDirectory } = useTransferStore();
  const {
    posture,
    privacySettings,
    updatePrivacySettings,
    refreshAll: refreshSecurity,
  } = useSecurityStore();

  const [deviceNameInput, setDeviceNameInput] = useState(localDevice?.name || '');
  const [nameSavedNotice, setNameSavedNotice] = useState(false);
  const [portInput, setPortInput] = useState(discoveryPort.toString());
  const [dirInput, setDirInput] = useState(downloadDirectory || '~/Downloads/BeamDrop');
  const [dirSavedNotice, setDirSavedNotice] = useState(false);

  const isNative = isTauriEnvironment();

  useEffect(() => {
    refreshSecurity();
  }, [refreshSecurity]);

  const handlePrivacyToggle = async (patch: Partial<SecurityPrivacySettings>) => {
    const base: SecurityPrivacySettings = privacySettings || {
      hideDeviceName: false,
      discoveryEnabled: autoStartDiscovery,
      allowIncomingPairing: true,
      requireTransferApproval: true,
      autoAcceptFromTrusted: false,
      strictIdentityPinning: true,
      downloadDirectory: downloadDirectory || '~/Downloads/BeamDrop',
      notificationsEnabled,
    };

    const next: SecurityPrivacySettings = { ...base, ...patch };
    if (next.requireTransferApproval) {
      next.autoAcceptFromTrusted = false;
    }
    await updatePrivacySettings(next);
  };

  const handleSaveDeviceName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deviceNameInput.trim()) return;
    const success = await updateDeviceName(deviceNameInput.trim());
    if (success) {
      setNameSavedNotice(true);
      setTimeout(() => setNameSavedNotice(false), 2000);
    }
  };

  const handleSaveDownloadDir = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dirInput.trim()) return;
    await setDownloadDirectory(dirInput.trim());
    await handlePrivacyToggle({ downloadDirectory: dirInput.trim() });
    setDirSavedNotice(true);
    setTimeout(() => setDirSavedNotice(false), 2000);
  };

  const handlePortChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setPortInput(val);
    const parsed = parseInt(val, 10);
    if (!isNaN(parsed) && parsed > 0 && parsed <= 65535) {
      updateSettings({ discoveryPort: parsed });
    }
  };

  const handleToggleDesktopNotifications = async (checked: boolean) => {
    await setNotificationsEnabled(checked);
    await handlePrivacyToggle({ notificationsEnabled: checked });
    if (checked && typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => undefined);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-white">
          Application Preferences
        </h2>
        <p className="text-xs text-neutral-500">
          Configure privacy &amp; security policies, discovery parameters, storage folder, notifications, and tray behavior.
        </p>
      </div>

      {/* 1. Privacy & Security Controls (Phase 6) */}
      <section className="p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-white flex items-center gap-2">
              <Shield className="w-4 h-4 text-emerald-500" />
              <span>Privacy &amp; Security Controls</span>
            </h3>
            <p className="text-xs text-neutral-500">
              Control LAN visibility, incoming pairing authorization, key pinning, and transfer approval policies.
            </p>
          </div>
          {posture && (
            <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300">
              {posture.activeVerifiedSessions > 0
                ? `${posture.activeVerifiedSessions} Verified E2EE`
                : 'Standby (E2EE Ready)'}
            </span>
          )}
        </div>

        <div className="space-y-3 text-xs">
          <div className="flex items-center justify-between py-2 border-b border-neutral-100 dark:border-neutral-800">
            <div>
              <span className="font-medium text-neutral-900 dark:text-white block">
                Hide Device Name in LAN Discovery
              </span>
              <span className="text-neutral-500">
                Broadcast an anonymized peer alias (&ldquo;BeamDrop Peer XXXX&rdquo;) until authenticated.
              </span>
            </div>
            <input
              type="checkbox"
              checked={privacySettings?.hideDeviceName ?? false}
              onChange={(e) => handlePrivacyToggle({ hideDeviceName: e.target.checked })}
              className="w-4 h-4 rounded text-neutral-900"
            />
          </div>

          <div className="flex items-center justify-between py-2 border-b border-neutral-100 dark:border-neutral-800">
            <div>
              <span className="font-medium text-neutral-900 dark:text-white block">
                Enable Local Device Discovery (mDNS)
              </span>
              <span className="text-neutral-500">
                Advertise presence and listen for peers on your local Wi-Fi network.
              </span>
            </div>
            <input
              type="checkbox"
              checked={privacySettings?.discoveryEnabled ?? true}
              onChange={(e) => handlePrivacyToggle({ discoveryEnabled: e.target.checked })}
              className="w-4 h-4 rounded text-neutral-900"
            />
          </div>

          <div className="flex items-center justify-between py-2 border-b border-neutral-100 dark:border-neutral-800">
            <div>
              <span className="font-medium text-neutral-900 dark:text-white block">
                Allow New Incoming Pairing Requests
              </span>
              <span className="text-neutral-500">
                Disable temporarily when in untrusted public networks to block new QR pairing attempts.
              </span>
            </div>
            <input
              type="checkbox"
              checked={privacySettings?.allowIncomingPairing ?? true}
              onChange={(e) => handlePrivacyToggle({ allowIncomingPairing: e.target.checked })}
              className="w-4 h-4 rounded text-neutral-900"
            />
          </div>

          <div className="flex items-center justify-between py-2 border-b border-neutral-100 dark:border-neutral-800">
            <div>
              <span className="font-medium text-neutral-900 dark:text-white block">
                Require Explicit Transfer Approval
              </span>
              <span className="text-neutral-500">
                Always prompt before accepting incoming files or folders (Recommended).
              </span>
            </div>
            <input
              type="checkbox"
              checked={privacySettings?.requireTransferApproval ?? true}
              onChange={(e) => handlePrivacyToggle({ requireTransferApproval: e.target.checked })}
              className="w-4 h-4 rounded text-neutral-900"
            />
          </div>

          <div className="flex items-center justify-between py-2 border-b border-neutral-100 dark:border-neutral-800">
            <div>
              <span className="font-medium text-neutral-900 dark:text-white block">
                Auto-Accept Transfers from Verified Trusted Devices
              </span>
              <span className="text-neutral-500">
                Opt-in convenience setting; only permitted when manual approval is turned off.
              </span>
            </div>
            <input
              type="checkbox"
              disabled={privacySettings?.requireTransferApproval ?? true}
              checked={privacySettings?.autoAcceptFromTrusted ?? false}
              onChange={(e) => handlePrivacyToggle({ autoAcceptFromTrusted: e.target.checked })}
              className="w-4 h-4 rounded text-neutral-900 disabled:opacity-40"
            />
          </div>

          <div className="flex items-center justify-between py-2">
            <div>
              <span className="font-medium text-neutral-900 dark:text-white block">
                Strict Peer Identity Pinning
              </span>
              <span className="text-neutral-500">
                Block connections automatically if a trusted device&rsquo;s Ed25519 key changes unexpectedly.
              </span>
            </div>
            <input
              type="checkbox"
              checked={privacySettings?.strictIdentityPinning ?? true}
              onChange={(e) => handlePrivacyToggle({ strictIdentityPinning: e.target.checked })}
              className="w-4 h-4 rounded text-neutral-900"
            />
          </div>
        </div>

        {privacySettings?.autoAcceptFromTrusted && (
          <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 flex items-start gap-2 text-[11px] text-amber-700 dark:text-amber-300">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Auto-accept is active for verified trusted devices. Any previously paired peer can push files to your download directory without a prompt until revoked.
            </span>
          </div>
        )}
      </section>

      {/* 2. Device Identity Settings */}
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
            {posture && (
              <p>• Identity Key Fingerprint: <span className="font-mono text-neutral-600 dark:text-neutral-300">{posture.fingerprint} (v{posture.keyVersion})</span></p>
            )}
          </div>
        </form>
      </section>

      {/* 3. Storage & Received Files Directory */}
      <section className="p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-white flex items-center gap-2">
            <Folder className="w-4 h-4 text-amber-500" />
            <span>Received Files &amp; Folders Location</span>
          </h3>
          <p className="text-xs text-neutral-500">
            Incoming files and directory trees are written atomically via temporary <span className="font-mono">.part</span> files inside your containment sandbox with owner-only permissions.
          </p>
        </div>

        <form onSubmit={handleSaveDownloadDir} className="max-w-lg space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={dirInput}
              onChange={(e) => setDirInput(e.target.value)}
              className="flex-1 px-3 py-2 text-xs font-mono rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white focus:outline-hidden focus:ring-1 focus:ring-neutral-400"
            />
            <button
              type="submit"
              disabled={!dirInput.trim() || dirInput === downloadDirectory}
              className="px-3.5 py-2 text-xs font-medium rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors disabled:opacity-40"
            >
              Apply
            </button>
          </div>
          {dirSavedNotice && (
            <p className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
              <Check className="w-3.5 h-3.5" />
              Save directory updated!
            </p>
          )}
        </form>
      </section>

      {/* 4. Visual Theme Selection */}
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

      {/* 5. Network Discovery Settings */}
      <section className="p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
            Network &amp; Discovery
          </h3>
          <p className="text-xs text-neutral-500">
            mDNS multicast and local TCP listening configuration.
          </p>
        </div>

        <div className="space-y-3 max-w-lg text-xs">
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

          <div className="flex items-center justify-between py-2 border-b border-neutral-100 dark:border-neutral-800">
            <div>
              <span className="font-medium text-neutral-900 dark:text-white block">Allow Incoming Transfers</span>
              <span className="text-neutral-500">Permit compatible peers on this Wi-Fi network to request file &amp; folder sends.</span>
            </div>
            <input
              type="checkbox"
              checked={allowIncoming}
              onChange={(e) => updateSettings({ allowIncoming: e.target.checked })}
              className="w-4 h-4 rounded text-neutral-900 focus:ring-0"
            />
          </div>

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

      {/* 6. Notifications & Background Tray Preferences */}
      <section className="p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60 space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-white flex items-center gap-2">
            <Bell className="w-4 h-4 text-cyan-500" />
            <span>Notifications &amp; System Tray</span>
          </h3>
          <p className="text-xs text-neutral-500">
            Desktop transfer notifications, discovery alerts, and background tray persistence.
          </p>
        </div>

        <div className="space-y-2.5 text-xs text-neutral-600 dark:text-neutral-300">
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={notificationsEnabled}
              onChange={(e) => handleToggleDesktopNotifications(e.target.checked)}
              className="w-4 h-4 rounded text-neutral-900"
            />
            <span>Enable desktop notifications for incoming transfers, completion, and failures</span>
          </label>
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={notifyOnDiscovery}
              onChange={(e) => updateSettings({ notifyOnDiscovery: e.target.checked })}
              className="w-4 h-4 rounded text-neutral-900"
            />
            <span>Show system notification when a new device joins the local network</span>
          </label>
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={launchMinimized}
              onChange={(e) => updateSettings({ launchMinimized: e.target.checked })}
              className="w-4 h-4 rounded text-neutral-900"
            />
            <span>Launch minimized to system tray upon operating system login</span>
          </label>
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={minimizeToTray}
              onChange={(e) => updateSettings({ minimizeToTray: e.target.checked })}
              className="w-4 h-4 rounded text-neutral-900"
            />
            <span>Close window to notification tray while background transfers continue</span>
          </label>
        </div>
      </section>

      {/* 7. Live Security & Cryptographic Architecture Summary */}
      <section className="p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-950/40 space-y-3 text-xs">
        <div className="flex items-center gap-2 text-neutral-900 dark:text-white font-semibold">
          <Lock className="w-4 h-4 text-emerald-500" />
          <span>Cryptographic Security &amp; Architecture Specifications</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-neutral-500">
          <div className="p-3 rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200/60 dark:border-neutral-800 space-y-1">
            <span className="font-medium text-neutral-900 dark:text-white block">Authenticated Key Exchange</span>
            <p>Ed25519 long-term identity authentication + ephemeral X25519 ECDH + HKDF-SHA256.</p>
          </div>

          <div className="p-3 rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200/60 dark:border-neutral-800 space-y-1">
            <span className="font-medium text-neutral-900 dark:text-white block">AEAD Encrypted Transport</span>
            <p>ChaCha20-Poly1305 / AES-256-GCM with deterministic monotonic nonces and +-120s replay guards.</p>
          </div>

          <div className="p-3 rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200/60 dark:border-neutral-800 space-y-1">
            <span className="font-medium text-neutral-900 dark:text-white block">OS Keyring Custody</span>
            <p>
              {posture?.secureStorage.available
                ? `Active via ${posture.secureStorage.backendName}.`
                : 'Plaintext disk storage is disabled; ephemeral RAM key active outside native keyring.'}
            </p>
          </div>

          <div className="p-3 rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200/60 dark:border-neutral-800 space-y-1">
            <span className="font-medium text-neutral-900 dark:text-white block">Zero Cloud Architecture</span>
            <p>No telemetry, no external servers. Standard SQLite holds public peer metadata &amp; redacted audit logs only.</p>
          </div>
        </div>

        <div className="pt-2 text-[11px] text-neutral-400 flex items-center justify-between">
          <span>BeamDrop Desktop v1.0.0 (Phase 6 Hardened Build)</span>
          <span className="font-mono flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5" />
            {isNative ? 'Tauri 2.0.0 / Rust' : 'Web Preview / Vite 8'}
          </span>
        </div>
      </section>
    </div>
  );
};
