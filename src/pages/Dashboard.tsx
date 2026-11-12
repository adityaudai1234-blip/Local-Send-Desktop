import React, { useState } from 'react';
import { YourDeviceCard } from '../components/dashboard/YourDeviceCard';
import { NearbyDevicesGrid } from '../components/dashboard/NearbyDevicesGrid';
import { QuickActions } from '../components/dashboard/QuickActions';
import { TransferOverview } from '../components/dashboard/TransferOverview';
import { DiscoveredDevice } from '../types/device';
import { ManualAddModal } from '../components/devices/ManualAddModal';
import { PairingModal } from '../components/pairing/PairingModal';
import { QrScannerModal } from '../components/pairing/QrScannerModal';
import { NetworkStatusCard } from '../components/networking/NetworkStatusCard';
import { ConnectionDetailsModal } from '../components/networking/ConnectionDetailsModal';
import { SendFilesDropzone } from '../components/transfers/SendFilesDropzone';
import { IncomingTransferModal } from '../components/transfers/IncomingTransferModal';
import { TransferDetailsModal } from '../components/transfers/TransferDetailsModal';
import { Modal } from '../components/common/Modal';
import { useTransferStore } from '../stores/transferStore';
import { usePairingStore } from '../stores/pairingStore';
import { useConnectionStore } from '../stores/connectionStore';
import { PeerConnection } from '../types/networking';
import { Send, FileText, Check, QrCode, Camera, ShieldCheck, ArrowRight, BellRing } from 'lucide-react';
import { formatDateTime } from '../utils/formatters';

interface DashboardProps {
  onNavigateToTransfers: () => void;
  onNavigateToTrusted: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  onNavigateToTransfers,
  onNavigateToTrusted,
}) => {
  const [isManualAddOpen, setIsManualAddOpen] = useState(false);
  const [isPairModalOpen, setIsPairModalOpen] = useState(false);
  const [isScanModalOpen, setIsScanModalOpen] = useState(false);
  const [selectedDeviceForSend, setSelectedDeviceForSend] = useState<DiscoveredDevice | null>(null);
  const [simulatedFileName, setSimulatedFileName] = useState('project_archive_2026.zip');
  const [simulatedSizeMb, setSimulatedSizeMb] = useState('85');
  const [sendSuccess, setSendSuccess] = useState(false);

  const { addTransfer } = useTransferStore();
  const { pendingRequests, trustedDevices, acceptRequest, rejectRequest } = usePairingStore();
  const { selectedConnection, setSelectedConnection } = useConnectionStore();

  const activeRequest = pendingRequests[0] || null;

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
      {/* Pending Pairing Request Alert Banner */}
      {activeRequest && (
        <div className="p-4 rounded-xl border border-cyan-500/40 bg-cyan-500/10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 animate-in fade-in">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-cyan-500/20 text-cyan-600 dark:text-cyan-400 flex items-center justify-center shrink-0">
              <BellRing className="w-5 h-5 animate-bounce" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-neutral-900 dark:text-white">
                Pairing Request from {activeRequest.fromDeviceName}
              </h4>
              <p className="text-xs text-neutral-600 dark:text-neutral-400">
                Visual code: <span className="font-mono font-bold">{activeRequest.verificationCode}</span> · IP: {activeRequest.fromIpAddress}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => rejectRequest(activeRequest.requestId)}
              className="px-3 py-1.5 text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors"
            >
              Reject
            </button>
            <button
              onClick={() => acceptRequest(activeRequest.requestId)}
              className="px-4 py-1.5 text-xs font-medium rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-800 transition-colors shadow-xs"
            >
              Accept & Trust
            </button>
          </div>
        </div>
      )}

      {/* Top Section: Your Device & Real-time Network Service */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <YourDeviceCard />
        <NetworkStatusCard onOpenDetails={(conn: PeerConnection) => setSelectedConnection(conn)} />
      </section>

      {/* Pairing & Trusted Devices Overview Strip */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Quick Pair CTA Card */}
        <div className="p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-neutral-900 dark:text-white flex items-center gap-2">
                <QrCode className="w-4 h-4 text-cyan-500" />
                QR Code Pairing
              </span>
              <span className="text-[11px] font-mono text-neutral-400">Ed25519</span>
            </div>
            <p className="text-xs text-neutral-500">
              Generate a temporary QR code or scan a nearby device using your camera.
            </p>
          </div>

          <div className="flex items-center gap-2 mt-4 pt-3 border-t border-neutral-100 dark:border-neutral-800">
            <button
              onClick={() => setIsPairModalOpen(true)}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-800 transition-colors"
            >
              <QrCode className="w-3.5 h-3.5" />
              <span>Show QR</span>
            </button>

            <button
              onClick={() => setIsScanModalOpen(true)}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
            >
              <Camera className="w-3.5 h-3.5" />
              <span>Scan QR</span>
            </button>
          </div>
        </div>

        {/* Paired Devices Summary Card */}
        <div className="p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60 flex flex-col justify-between md:col-span-2">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <ShieldCheck className="w-4 h-4 text-emerald-500" />
                <span className="text-xs font-semibold text-neutral-900 dark:text-white">
                  Trusted Peer Vault
                </span>
              </div>
              <p className="text-xs text-neutral-500">
                You have <span className="font-bold text-neutral-900 dark:text-white font-mono">{trustedDevices.length}</span> securely paired device{trustedDevices.length === 1 ? '' : 's'} stored in your local SQLite database.
              </p>
            </div>

            <button
              onClick={onNavigateToTrusted}
              className="flex items-center gap-1 text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white transition-colors"
            >
              <span>Manage</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="mt-4 pt-3 border-t border-neutral-100 dark:border-neutral-800 flex flex-wrap items-center gap-4 text-xs">
            {trustedDevices.slice(0, 3).map((dev) => (
              <div key={dev.deviceId} className="flex items-center gap-2 text-neutral-600 dark:text-neutral-400">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="font-medium text-neutral-900 dark:text-white">{dev.name}</span>
                <span className="font-mono text-[11px] text-neutral-400">({dev.fingerprint})</span>
              </div>
            ))}
            {trustedDevices.length === 0 && (
              <span className="text-neutral-400 text-xs">No devices paired yet. Click &ldquo;Show QR&rdquo; to begin.</span>
            )}
          </div>
        </div>
      </section>

      {/* Send Files Dropzone Section */}
      <section>
        <SendFilesDropzone onTransferStarted={onNavigateToTransfers} />
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
          onSelectSend={() => setIsManualAddOpen(true)}
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

      <PairingModal
        isOpen={isPairModalOpen}
        onClose={() => setIsPairModalOpen(false)}
      />

      <QrScannerModal
        isOpen={isScanModalOpen}
        onClose={() => setIsScanModalOpen(false)}
      />

      <ConnectionDetailsModal
        connection={selectedConnection}
        isOpen={!!selectedConnection}
        onClose={() => setSelectedConnection(null)}
      />

      {/* Incoming File Transfer Request Modal */}
      <IncomingTransferModal />

      {/* Deep Session Details Modal */}
      <TransferDetailsModal />

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
