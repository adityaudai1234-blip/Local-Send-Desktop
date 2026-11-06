import React, { useState } from 'react';
import { YourDeviceCard } from '../components/dashboard/YourDeviceCard';
import { NearbyDevicesGrid } from '../components/dashboard/NearbyDevicesGrid';
import { QuickActions } from '../components/dashboard/QuickActions';
import { TransferOverview } from '../components/dashboard/TransferOverview';
import { DiscoveredDevice } from '../types/device';
import { ManualAddModal } from '../components/devices/ManualAddModal';
import { Modal } from '../components/common/Modal';
import { useTransferStore } from '../stores/transferStore';
import { Send, FileText, Check } from 'lucide-react';

interface DashboardProps {
  onNavigateToTransfers: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ onNavigateToTransfers }) => {
  const [isManualAddOpen, setIsManualAddOpen] = useState(false);
  const [selectedDeviceForSend, setSelectedDeviceForSend] = useState<DiscoveredDevice | null>(null);
  const [simulatedFileName, setSimulatedFileName] = useState('project_archive_2026.zip');
  const [simulatedSizeMb, setSimulatedSizeMb] = useState('85');
  const [sendSuccess, setSendSuccess] = useState(false);
  const { addTransfer } = useTransferStore();

  const handleSendSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDeviceForSend) return;

    const sizeInBytes = Math.max(1, parseInt(simulatedSizeMb, 10) || 50) * 1024 * 1024;
    addTransfer({
      name: simulatedFileName.trim() || 'unnamed_file.dat',
      size: sizeInBytes,
      mimeType: 'application/octet-stream',
      speed: 15400000,
      direction: 'outgoing',
      status: 'transferring',
      peerDevice: selectedDeviceForSend,
    });

    setSendSuccess(true);
    setTimeout(() => {
      setSendSuccess(false);
      setSelectedDeviceForSend(null);
      onNavigateToTransfers();
    }, 1200);
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Top Section: Your Device */}
      <section>
        <YourDeviceCard />
      </section>

      {/* Middle Grid: Nearby Devices (Dominant Anchor) */}
      <section>
        <NearbyDevicesGrid
          onSendFilesToDevice={(device) => setSelectedDeviceForSend(device)}
          onOpenManualAdd={() => setIsManualAddOpen(true)}
        />
      </section>

      {/* Quick Actions */}
      <section>
        <QuickActions
          onSelectSend={() => {
            // Trigger selection of first device or prompt
            setIsManualAddOpen(true);
          }}
        />
      </section>

      {/* Bottom: Transfer Overview Summary */}
      <section>
        <TransferOverview />
      </section>

      {/* Modals */}
      <ManualAddModal
        isOpen={isManualAddOpen}
        onClose={() => setIsManualAddOpen(false)}
      />

      {/* Send Files Dialog */}
      {selectedDeviceForSend && (
        <Modal
          isOpen={!!selectedDeviceForSend}
          onClose={() => setSelectedDeviceForSend(null)}
          title={`Beam Files to ${selectedDeviceForSend.name}`}
          description={`Peer target: ${selectedDeviceForSend.ipAddress}:${selectedDeviceForSend.port}`}
        >
          {sendSuccess ? (
            <div className="py-6 flex flex-col items-center justify-center text-center space-y-2">
              <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <Check className="w-6 h-6" />
              </div>
              <h4 className="text-sm font-semibold text-neutral-900 dark:text-white">
                Transfer Initiated!
              </h4>
              <p className="text-xs text-neutral-500">
                Opening active transfers view...
              </p>
            </div>
          ) : (
            <form onSubmit={handleSendSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                  File Name
                </label>
                <div className="relative">
                  <FileText className="w-4 h-4 text-neutral-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={simulatedFileName}
                    onChange={(e) => setSimulatedFileName(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                  Simulated File Size (MB)
                </label>
                <input
                  type="number"
                  value={simulatedSizeMb}
                  onChange={(e) => setSimulatedSizeMb(e.target.value)}
                  min="1"
                  max="10000"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white font-mono"
                  required
                />
              </div>

              <div className="p-3 rounded-lg bg-neutral-50 dark:bg-neutral-800/40 border border-neutral-200/60 dark:border-neutral-800 text-xs text-neutral-500 space-y-1">
                <div className="flex justify-between">
                  <span>Target IP:</span>
                  <span className="font-mono text-neutral-700 dark:text-neutral-300">{selectedDeviceForSend.ipAddress}</span>
                </div>
                <div className="flex justify-between">
                  <span>Protocol:</span>
                  <span className="font-mono text-neutral-700 dark:text-neutral-300">TCP Direct Socket (Port 53317)</span>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedDeviceForSend(null)}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 shadow-sm"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Start Transfer</span>
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </div>
  );
};
