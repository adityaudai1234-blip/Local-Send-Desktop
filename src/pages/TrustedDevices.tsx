import React, { useState } from 'react';
import {
  ShieldCheck,
  QrCode,
  Camera,
  RefreshCw,
  Edit2,
  Trash2,
  CheckCircle2,
  Clock,
  Key,
  Shield,
  Wifi,
  MoreVertical,
  ExternalLink,
} from 'lucide-react';
import { usePairingStore } from '../stores/pairingStore';
import { TrustedDevice } from '../types/pairing';
import { PlatformIcon } from '../components/common/PlatformIcon';
import { getPlatformLabel, formatDateTime, formatRelativeTime } from '../utils/formatters';
import { RemoveTrustedDeviceModal } from '../components/pairing/RemoveTrustedDeviceModal';
import { RenameDeviceModal } from '../components/pairing/RenameDeviceModal';
import { Modal } from '../components/common/Modal';

interface TrustedDevicesProps {
  onOpenPairModal: () => void;
  onOpenScanModal: () => void;
}

export const TrustedDevices: React.FC<TrustedDevicesProps> = ({
  onOpenPairModal,
  onOpenScanModal,
}) => {
  const { trustedDevices, reconnectDevice, simulateIncomingRequest } = usePairingStore();
  const [deviceToRemove, setDeviceToRemove] = useState<TrustedDevice | null>(null);
  const [deviceToRename, setDeviceToRename] = useState<TrustedDevice | null>(null);
  const [deviceDetails, setDeviceDetails] = useState<TrustedDevice | null>(null);
  const [reconnectingId, setReconnectingId] = useState<string | null>(null);

  const handleReconnect = async (device: TrustedDevice) => {
    setReconnectingId(device.deviceId);
    await reconnectDevice(device.deviceId);
    setTimeout(() => setReconnectingId(null), 1000);
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-white flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-500" />
            <span>Trusted Devices</span>
          </h2>
          <p className="text-xs text-neutral-500">
            Devices authorized with persistent Ed25519 cryptographic tokens in your local SQLite store.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onOpenScanModal}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors"
          >
            <Camera className="w-3.5 h-3.5" />
            <span>Scan QR</span>
          </button>

          <button
            onClick={onOpenPairModal}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors shadow-xs"
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>Show My QR</span>
          </button>
        </div>
      </div>

      {/* Trust Status Summary Banner */}
      <div className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/40 flex items-center justify-between text-xs">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
            <Shield className="w-4 h-4" />
          </div>
          <div>
            <span className="font-semibold text-neutral-900 dark:text-white block">
              Zero-Trust Local SQLite Vault Active
            </span>
            <span className="text-neutral-500">
              {trustedDevices.length} authorized peer{trustedDevices.length === 1 ? '' : 's'} with SHA-256 token verification.
            </span>
          </div>
        </div>

        <button
          onClick={simulateIncomingRequest}
          className="text-[11px] text-cyan-600 dark:text-cyan-400 hover:underline"
        >
          Simulate Incoming Handshake
        </button>
      </div>

      {/* Devices Grid */}
      <div className="space-y-3">
        {trustedDevices.length === 0 ? (
          <div className="p-12 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/20 text-center">
            <Shield className="w-8 h-8 text-neutral-400 mx-auto mb-2" />
            <h4 className="text-sm font-medium text-neutral-900 dark:text-white">
              No Trusted Devices Yet
            </h4>
            <p className="text-xs text-neutral-500 mt-1 max-w-sm mx-auto">
              Pair your smartphone or another desktop device via QR code to establish an authenticated relationship.
            </p>
            <div className="flex items-center justify-center gap-3 mt-4">
              <button
                onClick={onOpenPairModal}
                className="px-3.5 py-1.5 text-xs font-medium rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-800 transition-colors"
              >
                Pair with QR Code
              </button>
              <button
                onClick={onOpenScanModal}
                className="px-3.5 py-1.5 text-xs font-medium rounded-lg border border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 transition-colors"
              >
                Scan Camera
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {trustedDevices.map((device) => {
              const isReconnecting = reconnectingId === device.deviceId;

              return (
                <div
                  key={device.deviceId}
                  className="p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/70 hover:border-neutral-300 dark:hover:border-neutral-700 transition-all flex flex-col justify-between space-y-4 shadow-xs"
                >
                  <div>
                    {/* Header: Icon, Name, Trust badge */}
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 flex items-center justify-center text-neutral-800 dark:text-neutral-200">
                          <PlatformIcon platform={device.platform} className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <h4 className="text-sm font-semibold text-neutral-900 dark:text-white truncate">
                              {device.name}
                            </h4>
                            <button
                              onClick={() => setDeviceToRename(device)}
                              className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 p-0.5 rounded transition-colors"
                              title="Rename device"
                            >
                              <Edit2 className="w-3 h-3" />
                            </button>
                          </div>
                          <p className="text-xs text-neutral-500">{device.deviceModel}</p>
                        </div>
                      </div>

                      <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Trusted
                      </span>
                    </div>

                    {/* Metadata table */}
                    <div className="mt-4 pt-3 border-t border-neutral-100 dark:border-neutral-800/80 text-xs space-y-1.5 text-neutral-600 dark:text-neutral-400">
                      <div className="flex justify-between">
                        <span className="text-neutral-500">Platform:</span>
                        <span>{getPlatformLabel(device.platform)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-neutral-500">Local IP:</span>
                        <span className="font-mono text-neutral-700 dark:text-neutral-300">
                          {device.ipAddress}:{device.port}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-neutral-500">Fingerprint:</span>
                        <span className="font-mono">{device.fingerprint}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-neutral-500">First Paired:</span>
                        <span>{formatDateTime(device.firstPairedAt)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-neutral-500">Last Seen:</span>
                        <span>{formatRelativeTime(device.lastConnectedAt)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Actions Footer */}
                  <div className="pt-2 border-t border-neutral-100 dark:border-neutral-800 flex items-center justify-between">
                    <button
                      onClick={() => setDeviceToRemove(device)}
                      className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                      title="Revoke trust"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setDeviceDetails(device)}
                        className="px-2.5 py-1 text-xs font-medium rounded-lg text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                      >
                        Specs
                      </button>

                      <button
                        onClick={() => handleReconnect(device)}
                        disabled={isReconnecting}
                        className="flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors shadow-xs"
                      >
                        <RefreshCw className={`w-3 h-3 ${isReconnecting ? 'animate-spin text-cyan-500' : ''}`} />
                        <span>{isReconnecting ? 'Verifying...' : 'Reconnect'}</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modals */}
      <RemoveTrustedDeviceModal
        device={deviceToRemove}
        isOpen={!!deviceToRemove}
        onClose={() => setDeviceToRemove(null)}
      />

      <RenameDeviceModal
        device={deviceToRename}
        isOpen={!!deviceToRename}
        onClose={() => setDeviceToRename(null)}
      />

      {/* Device Specs Modal */}
      {deviceDetails && (
        <Modal
          isOpen={!!deviceDetails}
          onClose={() => setDeviceDetails(null)}
          title={`Trust Certificate — ${deviceDetails.name}`}
          description="Local SQLite authentication record and cryptographic parameters."
        >
          <div className="space-y-3 text-xs">
            <div className="p-3 rounded-lg bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-700 space-y-1.5">
              <div className="flex justify-between">
                <span className="text-neutral-500">Device ID:</span>
                <span className="font-mono text-neutral-800 dark:text-neutral-200 truncate max-w-[200px]">{deviceDetails.deviceId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500">Public Key (Ed25519):</span>
                <span className="font-mono text-neutral-800 dark:text-neutral-200 truncate max-w-[200px]">{deviceDetails.publicKey}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500">Key Fingerprint:</span>
                <span className="font-mono text-neutral-800 dark:text-neutral-200">{deviceDetails.fingerprint}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500">Auth Token Hash:</span>
                <span className="font-mono text-neutral-800 dark:text-neutral-200 truncate max-w-[200px]">{deviceDetails.authTokenHash}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500">Storage Engine:</span>
                <span className="font-mono text-neutral-800 dark:text-neutral-200">SQLite (beamdrop_data.sqlite)</span>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setDeviceDetails(null)}
                className="px-4 py-1.5 text-xs font-medium rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-800 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
