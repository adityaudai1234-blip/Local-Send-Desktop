import React from 'react';
import {
  LayoutDashboard,
  Radio,
  ArrowLeftRight,
  Clock,
  Settings,
  Sun,
  Moon,
  Share2,
  Cpu,
  Wifi,
} from 'lucide-react';
import { useSettingsStore } from '../../stores/settingsStore';
import { useDeviceStore } from '../../stores/deviceStore';
import { isTauriEnvironment } from '../../services/tauriBridge';

interface SidebarProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentTab, onSelectTab }) => {
  const { theme, toggleTheme } = useSettingsStore();
  const { discoveryState, localDevice } = useDeviceStore();
  const isNative = isTauriEnvironment();

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'devices', label: 'Nearby Devices', icon: Radio, count: discoveryState.deviceCount },
    { id: 'transfers', label: 'Transfers', icon: ArrowLeftRight },
    { id: 'history', label: 'History', icon: Clock },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <aside className="w-64 shrink-0 flex flex-col justify-between border-r border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 select-none">
      <div>
        {/* Brand */}
        <div className="h-16 flex items-center px-6 border-b border-neutral-200 dark:border-neutral-800 gap-3">
          <div className="w-9 h-9 rounded-lg bg-neutral-900 dark:bg-neutral-100 flex items-center justify-center text-white dark:text-neutral-900 shadow-sm">
            <Share2 className="w-5 h-5 stroke-[2.2]" />
          </div>
          <div>
            <h1 className="text-base font-semibold tracking-tight text-neutral-900 dark:text-white leading-none">
              BeamDrop
            </h1>
            <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
              Local Peer Share
            </span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="p-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectTab(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-neutral-200/80 dark:bg-neutral-800 text-neutral-900 dark:text-white font-semibold'
                    : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800/50'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </div>
                {item.count !== undefined && item.count > 0 && (
                  <span className="text-xs font-mono font-medium text-neutral-500 dark:text-neutral-400">
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Footer System Info */}
      <div className="p-4 border-t border-neutral-200 dark:border-neutral-800 space-y-3">
        {/* Status indicator */}
        <div className="px-3 py-2.5 rounded-lg bg-neutral-100 dark:bg-neutral-950/60 border border-neutral-200/60 dark:border-neutral-800/80 space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-neutral-500 dark:text-neutral-400 flex items-center gap-1.5">
              <Wifi className="w-3.5 h-3.5 text-neutral-400" />
              mDNS Network
            </span>
            <span className="text-[11px] font-mono text-neutral-700 dark:text-neutral-300">
              {discoveryState.isActive ? 'Active' : 'Paused'}
            </span>
          </div>
          <div className="flex items-center justify-between text-[11px] text-neutral-500">
            <span className="flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-neutral-400" />
              Engine
            </span>
            <span className="font-mono">{isNative ? 'Tauri 2 Rust' : 'Web Bridge'}</span>
          </div>
        </div>

        {/* Version & Theme switch */}
        <div className="flex items-center justify-between px-1">
          <div className="text-xs text-neutral-500 dark:text-neutral-400">
            <span>BeamDrop v1.0.0</span>
          </div>

          <button
            onClick={toggleTheme}
            aria-label="Toggle visual theme"
            className="p-1.5 rounded-md text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-200/60 dark:hover:bg-neutral-800 transition-colors"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </aside>
  );
};
