import React, { useState } from 'react';
import { Edit3, CheckCircle2, Copy, Check, Radio } from 'lucide-react';
import { useDeviceStore } from '../../stores/deviceStore';
import { PlatformIcon } from '../common/PlatformIcon';
import { getPlatformLabel, getDeviceTypeLabel } from '../../utils/formatters';
import { EditDeviceNameModal } from '../common/EditDeviceNameModal';

export const YourDeviceCard: React.FC = () => {
  const { localDevice, discoveryState } = useDeviceStore();
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [copiedIp, setCopiedIp] = useState<string | null>(null);

  if (!localDevice) {
    return (
      <div className="p-6 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/50 animate-pulse">
        <div className="h-6 w-36 bg-neutral-200 dark:bg-neutral-800 rounded mb-4" />
        <div className="h-4 w-52 bg-neutral-100 dark:bg-neutral-800/60 rounded" />
      </div>
    );
  }

  const primaryIp = localDevice.ipAddresses[0] || '127.0.0.1';

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedIp(text);
    setTimeout(() => setCopiedIp(null), 2000);
  };

  return (
    <>
      <div className="p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60 transition-shadow">
        <div className="flex items-start justify-between gap-4">
          {/* Avatar & Info */}
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="w-14 h-14 rounded-xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200/80 dark:border-neutral-700/80 flex items-center justify-center text-neutral-800 dark:text-neutral-200 shadow-xs">
                <PlatformIcon platform={localDevice.platform} deviceType={localDevice.deviceType} className="w-7 h-7" />
              </div>
              <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 border-2 border-white dark:border-neutral-900 flex items-center justify-center" title="Online" />
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-neutral-900 dark:text-white">
                  {localDevice.name}
                </h3>
                <button
                  onClick={() => setIsEditOpen(true)}
                  aria-label="Edit device name"
                  className="p-1 rounded-md text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Clean unboxed metadata with typographic separators */}
              <div className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                <span>{getPlatformLabel(localDevice.platform)}</span>
                <span aria-hidden="true">·</span>
                <span>{localDevice.deviceModel}</span>
                <span aria-hidden="true">·</span>
                <span>Port {localDevice.port}</span>
              </div>
            </div>
          </div>

          {/* Broadcast Status */}
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300">
              <Radio className={`w-3.5 h-3.5 ${discoveryState.isActive ? 'text-cyan-500' : 'text-neutral-400'}`} />
              <span className="font-medium">
                {discoveryState.isActive ? 'Broadcasting mDNS' : 'Offline'}
              </span>
            </div>
            <span className="text-[11px] font-mono text-neutral-400">
              _beamdrop._tcp.local.
            </span>
          </div>
        </div>

        {/* IP Addresses Bar */}
        <div className="mt-4 pt-3.5 border-t border-neutral-100 dark:border-neutral-800/80 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="text-neutral-500">Local IPv4:</span>
            <span className="font-mono font-medium text-neutral-800 dark:text-neutral-200">
              {primaryIp}
            </span>
            <button
              onClick={() => copyToClipboard(primaryIp)}
              className="p-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors"
              title="Copy IP"
            >
              {copiedIp === primaryIp ? (
                <Check className="w-3.5 h-3.5 text-emerald-500" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
          </div>

          <div className="flex items-center gap-2 text-neutral-500">
            <span>Status:</span>
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Ready to Share
            </span>
          </div>
        </div>
      </div>

      <EditDeviceNameModal isOpen={isEditOpen} onClose={() => setIsEditOpen(false)} />
    </>
  );
};
