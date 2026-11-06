import React, { useState, useEffect } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { Dashboard } from './pages/Dashboard';
import { Devices } from './pages/Devices';
import { Transfers } from './pages/Transfers';
import { History } from './pages/History';
import { Settings } from './pages/Settings';
import { useDeviceStore } from './stores/deviceStore';
import { useSettingsStore } from './stores/settingsStore';
import { ManualAddModal } from './components/devices/ManualAddModal';
import { AlertCircle, X } from 'lucide-react';

export default function App() {
  const [currentTab, setCurrentTab] = useState<string>('dashboard');
  const [isManualAddOpen, setIsManualAddOpen] = useState(false);
  const { init, error, clearError, isLoading } = useDeviceStore();
  const { theme } = useSettingsStore();

  useEffect(() => {
    init();
  }, [init]);

  const getPageTitle = () => {
    switch (currentTab) {
      case 'dashboard':
        return { title: 'Dashboard', subtitle: 'Local network peer overview' };
      case 'devices':
        return { title: 'Nearby Devices', subtitle: 'Discover compatible clients over mDNS' };
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

  return (
    <div className={`min-h-screen flex h-screen overflow-hidden bg-neutral-100 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 font-sans ${theme === 'dark' ? 'dark' : ''}`}>
      {/* Sidebar Navigation */}
      <Sidebar currentTab={currentTab} onSelectTab={(tab) => setCurrentTab(tab)} />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {/* Top Header */}
        <Header
          title={title}
          subtitle={subtitle}
          onOpenManualAdd={() => setIsManualAddOpen(true)}
        />

        {/* Global Error Banner */}
        {error && (
          <div className="mx-8 mt-4 px-4 py-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs flex items-center justify-between animate-in fade-in">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
            <button
              onClick={clearError}
              className="p-1 rounded hover:bg-rose-500/20 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Scrollable Viewport */}
        <main className="flex-1 overflow-y-auto">
          {currentTab === 'dashboard' && (
            <Dashboard onNavigateToTransfers={() => setCurrentTab('transfers')} />
          )}
          {currentTab === 'devices' && <Devices />}
          {currentTab === 'transfers' && <Transfers />}
          {currentTab === 'history' && <History />}
          {currentTab === 'settings' && <Settings />}
        </main>
      </div>

      {/* Global Manual Add IP Modal */}
      <ManualAddModal
        isOpen={isManualAddOpen}
        onClose={() => setIsManualAddOpen(false)}
      />
    </div>
  );
}
