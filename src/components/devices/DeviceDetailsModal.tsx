import React from 'react';
import { Modal } from '../common/Modal';
import { DiscoveredDevice } from '../../types/device';
import { PlatformIcon } from '../common/PlatformIcon';
import { getPlatformLabel, getDeviceTypeLabel, formatRelativeTime } from '../../utils/formatters';
import { Trash2, Send } from 'lucide-react';
import { useDeviceStore } from '../../stores/deviceStore';

interface DeviceDetailsModalProps {
  device: DiscoveredDevice | null;
  isOpen: boolean;
  onClose: () => void;
  onSendFiles?: (device: DiscoveredDevice) => void;
}

export const DeviceDetailsModal: React.FC<DeviceDetailsModalProps> = ({
  device,
  isOpen,
  onClose,
  onSendFiles,
}) => {
  const { removeDevice } = useDeviceStore();

  if (!device) return null;

  const handleRemove = () => {
    removeDevice(device.id);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Device Specifications"
      description="Peer discovery metadata resolved via local mDNS broadcast."
    >
      <div className="space-y-4">
        {/* Device Header */}
        <div className="flex items-center gap-3 p-3 rounded-lg bg-neutral-100/70 dark:bg-neutral-800/60 border border-neutral-200/60 dark:border-neutral-700/60">
          <div className="w-10 h-10 rounded-lg bg-white dark:bg-neutral-900 flex items-center justify-center text-neutral-800 dark:text-neutral-200 border border-neutral-200 dark:border-neutral-700">
            <PlatformIcon platform={device.platform} deviceType={device.deviceType} className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-neutral-900 dark:text-white">
              {device.name}
            </h4>
            <div className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
              <span>{getPlatformLabel(device.platform)}</span>
              <span aria-hidden="true">·</span>
              <span>{getDeviceTypeLabel(device.deviceType)}</span>
            </div>
          </div>
        </div>

        {/* Technical Metadata Table */}
        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between py-1.5 border-b border-neutral-100 dark:border-neutral-800">
            <span className="text-neutral-500">Device Model</span>
            <span className="font-medium text-neutral-800 dark:text-neutral-200">{device.deviceModel}</span>
          </div>

          <div className="flex items-center justify-between py-1.5 border-b border-neutral-100 dark:border-neutral-800">
            <span className="text-neutral-500">Local IP Address</span>
            <span className="font-mono text-neutral-800 dark:text-neutral-200">{device.ipAddress}</span>
          </div>

          <div className="flex items-center justify-between py-1.5 border-b border-neutral-100 dark:border-neutral-800">
            <span className="text-neutral-500">Listening Port</span>
            <span className="font-mono text-neutral-800 dark:text-neutral-200">{device.port}</span>
          </div>

          <div className="flex items-center justify-between py-1.5 border-b border-neutral-100 dark:border-neutral-800">
            <span className="text-neutral-500">Device ID</span>
            <span className="font-mono text-neutral-600 dark:text-neutral-400 truncate max-w-[200px]" title={device.id}>
              {device.id}
            </span>
          </div>

          <div className="flex items-center justify-between py-1.5 border-b border-neutral-100 dark:border-neutral-800">
            <span className="text-neutral-500">BeamDrop Version</span>
            <span className="font-mono text-neutral-800 dark:text-neutral-200">v{device.version} (proto {device.protocolVersion})</span>
          </div>

          <div className="flex items-center justify-between py-1.5 border-b border-neutral-100 dark:border-neutral-800">
            <span className="text-neutral-500">Last Seen</span>
            <span className="text-neutral-800 dark:text-neutral-200">{formatRelativeTime(device.lastSeen)}</span>
          </div>

          {device.rawServiceName && (
            <div className="pt-1">
              <span className="text-neutral-500 block mb-1">mDNS Record</span>
              <p className="font-mono text-[11px] text-neutral-600 dark:text-neutral-400 break-all p-2 rounded bg-neutral-100/50 dark:bg-neutral-800/40 border border-neutral-200/50 dark:border-neutral-800">
                {device.rawServiceName}
              </p>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center justify-between pt-2">
          <button
            onClick={handleRemove}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Forget Device</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-medium rounded-lg text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
            >
              Close
            </button>
            <button
              onClick={() => {
                if (onSendFiles) onSendFiles(device);
                onClose();
              }}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors shadow-sm"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Connect</span>
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
