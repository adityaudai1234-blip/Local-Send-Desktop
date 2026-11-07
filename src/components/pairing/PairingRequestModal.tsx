import React from 'react';
import { Modal } from '../common/Modal';
import { usePairingStore } from '../../stores/pairingStore';
import { PlatformIcon } from '../common/PlatformIcon';
import { ShieldCheck, Check, X, ShieldAlert } from 'lucide-react';
import { getPlatformLabel } from '../../utils/formatters';

export const PairingRequestModal: React.FC = () => {
  const { pendingRequests, acceptRequest, rejectRequest, isLoading } = usePairingStore();

  const currentRequest = pendingRequests[0] || null;

  if (!currentRequest) return null;

  const handleAccept = async () => {
    await acceptRequest(currentRequest.requestId);
  };

  const handleReject = async () => {
    await rejectRequest(currentRequest.requestId);
  };

  return (
    <Modal
      isOpen={!!currentRequest}
      onClose={handleReject}
      title="Incoming Pairing Request"
      description="A device on your Wi-Fi network wants to establish authenticated mutual trust."
    >
      <div className="space-y-4">
        {/* Device Information Card */}
        <div className="flex items-center gap-3.5 p-3.5 rounded-xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700">
          <div className="w-11 h-11 rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 flex items-center justify-center text-neutral-800 dark:text-neutral-200 shadow-xs shrink-0">
            <PlatformIcon platform={currentRequest.fromPlatform} className="w-6 h-6" />
          </div>

          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-neutral-900 dark:text-white truncate">
              {currentRequest.fromDeviceName}
            </h4>
            <div className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
              <span>{getPlatformLabel(currentRequest.fromPlatform)}</span>
              <span aria-hidden="true">·</span>
              <span>{currentRequest.fromDeviceModel}</span>
            </div>
          </div>
        </div>

        {/* Security & Verification Box */}
        <div className="p-3.5 rounded-xl border border-neutral-200/80 dark:border-neutral-700/80 bg-white dark:bg-neutral-900/60 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-500" />
              <span className="text-xs font-semibold text-neutral-900 dark:text-white">
                Short Authentication String (SAS)
              </span>
            </div>

            <span className="px-3 py-1 font-mono font-bold text-base tracking-widest rounded-md bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white border border-neutral-200 dark:border-neutral-700">
              {currentRequest.verificationCode}
            </span>
          </div>

          <p className="text-[11px] text-neutral-500">
            Confirm that the requesting device is showing this exact 6-digit code.
          </p>

          <div className="pt-2 border-t border-neutral-100 dark:border-neutral-800 text-[11px] space-y-1 text-neutral-500">
            <div className="flex justify-between">
              <span>Local IP:</span>
              <span className="font-mono text-neutral-700 dark:text-neutral-300">
                {currentRequest.fromIpAddress}:{currentRequest.fromPort}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Key Fingerprint:</span>
              <span className="font-mono text-neutral-700 dark:text-neutral-300">
                {currentRequest.fromFingerprint}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Device ID:</span>
              <span className="font-mono text-neutral-600 dark:text-neutral-400 truncate max-w-[200px]" title={currentRequest.fromDeviceId}>
                {currentRequest.fromDeviceId}
              </span>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center justify-end gap-2.5 pt-2">
          <button
            type="button"
            disabled={isLoading}
            onClick={handleReject}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-lg text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors disabled:opacity-50"
          >
            <X className="w-3.5 h-3.5" />
            <span>Reject Pairing</span>
          </button>

          <button
            type="button"
            disabled={isLoading}
            onClick={handleAccept}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors shadow-sm disabled:opacity-50"
          >
            <Check className="w-3.5 h-3.5" />
            <span>{isLoading ? 'Accepting...' : 'Accept & Trust Device'}</span>
          </button>
        </div>
      </div>
    </Modal>
  );
};
