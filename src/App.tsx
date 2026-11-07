import React, { useState, useEffect } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { Dashboard } from './pages/Dashboard';
import { Devices } from './pages/Devices';
import { TrustedDevices } from './pages/TrustedDevices';
import { Transfers } from './pages/Transfers';
import { History } from './pages/History';
import { Settings } from './pages/Settings';
import { useDeviceStore } from './stores/deviceStore';
import { useSettingsStore } from './stores/settingsStore';
import { usePairingStore } from './stores/pairingStore';
import { ManualAddModal } from './components/devices/ManualAddModal';
import { PairingModal } from './components/pairing/PairingModal';
import { QrScannerModal } from './components/pairing/QrScannerModal';
import { PairingRequestModal } from './components/pairing/PairingRequestModal';
import { AlertCircle, CheckCircle2, Info, X, ShieldAlert } from 'lucide-react';

export default function App() {
  const [currentTab, setCurrentTab] = useState<string>('dashboard');
  const [isManualAddOpen, setIsManualAddOpen] = useState(false);
  const [isPairModalOpen, setIsPairModalOpen] = useState(false);
  const [isScanModalOpen, setIsScanModalOpen] = useState(false);

  const { init: initDevice, error: deviceError, clearError: clearDeviceError } = useDeviceStore();
  const { init: initPairing, notification, clearNotification, error: pairingError, clearError: clearPairingError } = usePairingStore();
  const { theme } = useSettingsStore();

  useEffect(() => {
    initDevice();
    initPairing();
  }, [initDevice, initPairing]);

  const getPageTitle = () => {
    switch (currentTab) {
      case 'dashboard':
        return { title: 'Dashboard', subtitle: 'Local network peer overview' };
      case 'devices':
        return { title: 'Nearby Devices', subtitle: 'Discover compatible clients over mDNS' };
      case 'trusted':
        return { title: 'Trusted Devices', subtitle: 'Manage persistent Ed25519 pairing relationships' };
      case 'transfers':
        return { title: 'Active Transfers', subtitle: 'Real-time transmission queue' };
      case 'history':
        return { title: 'Transfer History', subtitle: 'Historical logs and file records' };
      case 'settings':
        return { title: 'Settings', subtitle: 'Identity, theme, and network preferences' };
      default:
        return { title: 'BeamDrop', subtitle: 'Local file sharing' };
    }
  };

  const { title, subtitle } = getPageTitle();
  const activeError = deviceError || pairingError;

  return (
    <div className={`min-h-screen flex h-screen overflow-hidden bg-neutral-100 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 font-sans ${theme === 'dark' ? 'dark' : ''}`}>
      {/* Sidebar Navigation */}
      <Sidebar currentTab={currentTab} onSelectTab={(tab) => setCurrentTab(tab)} />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden relative">
        {/* Top Header */}
        <Header
          title={title}
          subtitle={subtitle}
          onOpenManualAdd={() => setIsManualAddOpen(true)}
        />

        {/* Global Error Banner */}
        {activeError && (
          <div className="mx-8 mt-4 px-4 py-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs flex items-center justify-between animate-in fade-in">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{activeError}</span>
            </div>
            <button
              onClick={() => {
                clearDeviceError();
                clearPairingError();
              }}
              className="p-1 rounded hover:bg-rose-500/20 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Floating Notification Toast */}
        {notification && (
          <div className="absolute top-20 right-8 z-50 max-w-sm p-3.5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white/95 dark:bg-neutral-900/95 backdrop-blur-md shadow-lg animate-in slide-in-from-top-3 flex items-start gap-3 text-xs">
            {notification.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />}
            {notification.type === 'error' && <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />}
            {notification.type === 'warning' && <ShieldAlert className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />}
            {notification.type === 'info' && <Info className="w-4 h-4 text-cyan-500 shrink-0 mt-0.5" />}
            
            <div className="flex-1 min-w-0">
              <h5 className="font-semibold text-neutral-900 dark:text-white leading-tight">
                {notification.title}
              </h5>
              <p className="text-neutral-500 dark:text-neutral-400 mt-0.5">
                {notification.message}
              </p>
            </div>

            <button
              onClick={clearNotification}
              className="p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 rounded"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Scrollable Viewport */}
        <main className="flex-1 overflow-y-auto">
          {currentTab === 'dashboard' && (
            <Dashboard
              onNavigateToTransfers={() => setCurrentTab('transfers')}
              onNavigateToTrusted={() => setCurrentTab('trusted')}
            />
          )}
          {currentTab === 'devices' && <Devices />}
          {currentTab === 'trusted' && (
            <TrustedDevices
              onOpenPairModal={() => setIsPairModalOpen(true)}
              onOpenScanModal={() => setIsScanModalOpen(true)}
            />
          )}
          {currentTab === 'transfers' && <Transfers />}
          {currentTab === 'history' && <History />}
          {currentTab === 'settings' && <Settings />}
        </main>
      </div>

      {/* Global Modals */}
      <ManualAddModal
        isOpen={isManualAddOpen}
        onClose={() => setIsManualAddOpen(false)}
      />

      <PairingModal
        isOpen={isPairModalOpen}
        onClose={() => setIsPairModalOpen(false)}
      />

      <QrScannerModal
        isOpen={isScanModalOpen}
        onClose={() => setIsScanModalOpen(false)}
      />

      {/* Incoming Pairing Approval Request Modal */}
      <PairingRequestModal />
    </div>
  );
}
