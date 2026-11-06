import React from 'react';
import { RefreshCw, Radio, Plus } from 'lucide-react';
import { useDeviceStore } from '../../stores/deviceStore';

interface HeaderProps {
  title: string;
  subtitle?: string;
  onOpenManualAdd?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ title, subtitle, onOpenManualAdd }) => {
  const { discoveryState, isSearching, refreshDevices, startDiscovery, stopDiscovery } = useDeviceStore();

  return (
    <header className="h-16 px-8 border-b border-neutral-200 dark:border-neutral-800 bg-white/50 dark:bg-neutral-900/40 backdrop-blur-sm flex items-center justify-between shrink-0">
      <div>
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-white leading-tight">
          {title}
        </h2>
        {subtitle && (
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            {subtitle}
          </p>
        )}
      </div>

      <div className="flex items-center gap-3">
        {/* Toggle Discovery */}
        <button
          onClick={() => (discoveryState.isActive ? stopDiscovery() : startDiscovery())}
          className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
            discoveryState.isActive
              ? 'border-neutral-300 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 hover:bg-neutral-200/70'
              : 'border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-500 hover:text-neutral-900 dark:hover:text-white'
          }`}
        >
          <Radio className={`w-3.5 h-3.5 ${discoveryState.isActive ? 'text-cyan-500 animate-pulse' : 'text-neutral-400'}`} />
          <span>{discoveryState.isActive ? 'Discovery On' : 'Discovery Off'}</span>
        </button>

        {/* Refresh Devices Button */}
        <button
          onClick={() => refreshDevices()}
          disabled={isSearching}
          aria-label="Refresh nearby devices"
          className="p-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isSearching ? 'animate-spin text-cyan-500' : ''}`} />
        </button>

        {/* Manual Add Device Button */}
        {onOpenManualAdd && (
          <button
            onClick={onOpenManualAdd}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add by IP</span>
          </button>
        )}
      </div>
    </header>
  );
};
