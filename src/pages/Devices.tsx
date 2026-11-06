import React, { useState } from 'react';
import {
  Search,
  Radio,
  Plus,
  RefreshCw,
  Network,
  ShieldCheck,
  Server,
  Info,
} from 'lucide-react';
import { useDeviceStore } from '../stores/deviceStore';
import { PlatformIcon } from '../components/common/PlatformIcon';
import { getPlatformLabel, formatRelativeTime } from '../utils/formatters';
import { ManualAddModal } from '../components/devices/ManualAddModal';
import { DeviceDetailsModal } from '../components/devices/DeviceDetailsModal';
import { DiscoveredDevice, Platform } from '../types/device';

export const Devices: React.FC = () => {
  const {
    discoveredDevices,
    discoveryState,
    networkInterfaces,
    isSearching,
    refreshDevices,
  } = useDeviceStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [platformFilter, setPlatformFilter] = useState<string>('all');
  const [isManualAddOpen, setIsManualAddOpen] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<DiscoveredDevice | null>(null);

  const filteredDevices = discoveredDevices.filter((dev) => {
    const matchesSearch =
      dev.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      dev.ipAddress.includes(searchQuery) ||
      dev.deviceModel.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesPlatform =
      platformFilter === 'all' || dev.platform === platformFilter;

    return matchesSearch && matchesPlatform;
  });

  const platformTabs = [
    { id: 'all', label: 'All Devices' },
    { id: 'android', label: 'Android' },
    { id: 'macos', label: 'macOS' },
    { id: 'windows', label: 'Windows' },
    { id: 'linux', label: 'Linux' },
  ];

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Top Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        {/* Search input */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by device name, model or IP..."
            className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white placeholder:text-neutral-400 focus:outline-hidden focus:ring-1 focus:ring-neutral-400 dark:focus:ring-neutral-600"
          />
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => refreshDevices()}
            disabled={isSearching}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSearching ? 'animate-spin text-cyan-500' : ''}`} />
            <span>Scan Network</span>
          </button>

          <button
            onClick={() => setIsManualAddOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors shadow-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Device</span>
          </button>
        </div>
      </div>

      {/* Filter Tabs (Interactive Segmented Control) */}
      <div className="flex items-center gap-1 p-1 bg-neutral-100 dark:bg-neutral-900 rounded-lg w-fit border border-neutral-200/60 dark:border-neutral-800">
        {platformTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setPlatformFilter(tab.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              platformFilter === tab.id
                ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white shadow-xs'
                : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Protocol Diagnostic Callout */}
      <div className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/40 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
        <div className="flex items-start gap-3">
          <Radio className="w-4 h-4 text-cyan-500 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-neutral-900 dark:text-white block">
              mDNS Broadcast Service
            </span>
            <span className="font-mono text-[11px] text-neutral-500">
              _beamdrop._tcp.local. (port 5353)
            </span>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <Network className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-neutral-900 dark:text-white block">
              Active Interfaces
            </span>
            <span className="text-[11px] text-neutral-500">
              {networkInterfaces.length > 0 ? `${networkInterfaces[0].name} (${networkInterfaces[0].ipAddress})` : 'Scanning interfaces...'}
            </span>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <ShieldCheck className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-neutral-900 dark:text-white block">
              Zero-Trust Verification
            </span>
            <span className="text-[11px] text-neutral-500">
              Discovery separate from file acceptance
            </span>
          </div>
        </div>
      </div>

      {/* Discovered Devices Grid */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs text-neutral-500">
          <span>Found {filteredDevices.length} compatible device{filteredDevices.length === 1 ? '' : 's'}</span>
          <span className="font-mono">Port 53317</span>
        </div>

        {filteredDevices.length === 0 ? (
          <div className="p-12 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/20 text-center">
            <Server className="w-8 h-8 text-neutral-400 mx-auto mb-2" />
            <h4 className="text-sm font-medium text-neutral-900 dark:text-white">
              No matching devices
            </h4>
            <p className="text-xs text-neutral-500 mt-1">
              Try adjusting your search query or platform filter.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredDevices.map((device) => (
              <div
                key={device.id}
                onClick={() => setSelectedDevice(device)}
                className="cursor-pointer p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60 hover:border-neutral-300 dark:hover:border-neutral-700 transition-all"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-neutral-800 dark:text-neutral-200 border border-neutral-200 dark:border-neutral-700">
                      <PlatformIcon platform={device.platform} deviceType={device.deviceType} className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-neutral-900 dark:text-white">
                        {device.name}
                      </h4>
                      <p className="text-xs text-neutral-500">{device.deviceModel}</p>
                    </div>
                  </div>

                  <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    Online
                  </span>
                </div>

                <div className="mt-4 pt-3 border-t border-neutral-100 dark:border-neutral-800 flex items-center justify-between text-xs">
                  <span className="font-mono text-neutral-600 dark:text-neutral-400">
                    {device.ipAddress}:{device.port}
                  </span>
                  <span className="text-neutral-400 text-[11px]">
                    {formatRelativeTime(device.lastSeen)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Network Interface List */}
      <div className="space-y-3 pt-4 border-t border-neutral-200 dark:border-neutral-800">
        <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
          Local Network Interfaces
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {networkInterfaces.map((iface, i) => (
            <div
              key={i}
              className="p-3.5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/40 text-xs"
            >
              <div className="flex items-center justify-between text-neutral-500 mb-1">
                <span className="font-medium text-neutral-900 dark:text-white">{iface.name}</span>
                {iface.isDefault && (
                  <span className="text-[10px] font-mono text-cyan-600 dark:text-cyan-400">Default</span>
                )}
              </div>
              <span className="font-mono text-neutral-700 dark:text-neutral-300">
                {iface.ipAddress}
              </span>
            </div>
          ))}
        </div>
      </div>

      <ManualAddModal isOpen={isManualAddOpen} onClose={() => setIsManualAddOpen(false)} />
      <DeviceDetailsModal
        device={selectedDevice}
        isOpen={!!selectedDevice}
        onClose={() => setSelectedDevice(null)}
      />
    </div>
  );
};
