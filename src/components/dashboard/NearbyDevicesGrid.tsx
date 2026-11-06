import React, { useState } from 'react';
import {
  RefreshCw,
  Radio,
  Send,
  MoreVertical,
  Plus,
  WifiOff,
  Search,
} from 'lucide-react';
import { useDeviceStore } from '../../stores/deviceStore';
import { DiscoveredDevice } from '../../types/device';
import { PlatformIcon } from '../common/PlatformIcon';
import { getPlatformLabel, formatRelativeTime } from '../../utils/formatters';
import { DeviceDetailsModal } from '../devices/DeviceDetailsModal';

interface NearbyDevicesGridProps {
  onSendFilesToDevice: (device: DiscoveredDevice) => void;
  onOpenManualAdd: () => void;
}

export const NearbyDevicesGrid: React.FC<NearbyDevicesGridProps> = ({
  onSendFilesToDevice,
  onOpenManualAdd,
}) => {
  const {
    discoveredDevices,
    discoveryState,
    isSearching,
    refreshDevices,
  } = useDeviceStore();

  const [activeModalDevice, setActiveModalDevice] = useState<DiscoveredDevice | null>(null);

  return (
    <>
      <div className="space-y-4">
        {/* Section Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
              Nearby Devices
            </h3>
            {/* Automatic discovery indicator */}
            <div className="flex items-center gap-1.5 text-xs text-neutral-500">
              <span className={`w-2 h-2 rounded-full ${discoveryState.isActive ? 'bg-cyan-500 animate-ping' : 'bg-neutral-400'}`} />
              <span className="font-mono text-[11px] text-neutral-600 dark:text-neutral-400">
                {discoveryState.isActive ? 'Scanning LAN' : 'Scan Paused'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => refreshDevices()}
              disabled={isSearching}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSearching ? 'animate-spin text-cyan-500' : ''}`} />
              <span>Refresh</span>
            </button>

            <button
              onClick={onOpenManualAdd}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add IP</span>
            </button>
          </div>
        </div>

        {/* Searching Loading State Banner (if searching & no devices yet) */}
        {isSearching && discoveredDevices.length === 0 && (
          <div className="p-8 rounded-xl border border-dashed border-neutral-300 dark:border-neutral-800 flex flex-col items-center justify-center text-center">
            <Search className="w-8 h-8 text-cyan-500 animate-pulse mb-3" />
            <h4 className="text-sm font-medium text-neutral-900 dark:text-white">
              Listening for mDNS Announcements
            </h4>
            <p className="text-xs text-neutral-500 mt-1 max-w-sm">
              Broadcasting on port 5353. Compatible devices running BeamDrop or LocalSend on this Wi-Fi network will appear automatically.
            </p>
          </div>
        )}

        {/* Empty State */}
        {!isSearching && discoveredDevices.length === 0 && (
          <div className="p-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/30 flex flex-col items-center justify-center text-center">
            <div className="w-12 h-12 rounded-xl bg-neutral-200/50 dark:bg-neutral-800/80 flex items-center justify-center text-neutral-400 mb-3">
              <WifiOff className="w-6 h-6" />
            </div>
            <h4 className="text-sm font-semibold text-neutral-900 dark:text-white">
              No Nearby Devices Found
            </h4>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 max-w-sm">
              Ensure target devices are connected to the same Wi-Fi subnet and have BeamDrop open.
            </p>
            <div className="flex items-center gap-3 mt-4">
              <button
                onClick={() => refreshDevices()}
                className="px-3.5 py-1.5 text-xs font-medium rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors"
              >
                Scan Network
              </button>
              <button
                onClick={onOpenManualAdd}
                className="px-3.5 py-1.5 text-xs font-medium rounded-lg border border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
              >
                Enter IP Directly
              </button>
            </div>
          </div>
        )}

        {/* Device Cards Grid */}
        {discoveredDevices.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {discoveredDevices.map((device) => (
              <div
                key={device.id}
                className="group p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/70 hover:border-neutral-300 dark:hover:border-neutral-700 transition-all flex flex-col justify-between"
              >
                <div>
                  {/* Top card bar */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-10 h-10 rounded-lg bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 flex items-center justify-center text-neutral-800 dark:text-neutral-200">
                      <PlatformIcon
                        platform={device.platform}
                        deviceType={device.deviceType}
                        className="w-5 h-5"
                      />
                    </div>

                    <div className="flex items-center gap-1.5">
                      {/* Online Status Indicator */}
                      <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        Online
                      </span>

                      <button
                        onClick={() => setActiveModalDevice(device)}
                        className="p-1 rounded text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                        title="View details"
                      >
                        <MoreVertical className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Device Name & Platform */}
                  <h4 className="text-sm font-semibold text-neutral-900 dark:text-white truncate">
                    {device.name}
                  </h4>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate mt-0.5">
                    {device.deviceModel}
                  </p>

                  {/* IP Address and Last Seen */}
                  <div className="mt-3 pt-3 border-t border-neutral-100 dark:border-neutral-800/80 flex items-center justify-between text-xs">
                    <span className="font-mono text-neutral-600 dark:text-neutral-400 text-[11px]">
                      {device.ipAddress}
                    </span>
                    <span className="text-[11px] text-neutral-400">
                      {formatRelativeTime(device.lastSeen)}
                    </span>
                  </div>
                </div>

                {/* Connect / Pair Action */}
                <div className="mt-4 pt-2">
                  <button
                    onClick={() => onSendFilesToDevice(device)}
                    className="w-full flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors shadow-xs"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Connect & Share</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <DeviceDetailsModal
        device={activeModalDevice}
        isOpen={!!activeModalDevice}
        onClose={() => setActiveModalDevice(null)}
        onSendFiles={onSendFilesToDevice}
      />
    </>
  );
};
