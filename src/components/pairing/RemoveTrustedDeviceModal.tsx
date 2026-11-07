import React from 'react';
import { Modal } from '../common/Modal';
import { TrustedDevice } from '../../types/pairing';
import { usePairingStore } from '../../stores/pairingStore';
import { AlertTriangle, Trash2 } from 'lucide-react';

interface RemoveTrustedDeviceModalProps {
  device: TrustedDevice | null;
  isOpen: boolean;
  onClose: () => void;
}

export const RemoveTrustedDeviceModal: React.FC<RemoveTrustedDeviceModalProps> = ({
  device,
  isOpen,
  onClose,
}) => {
  const { removeTrustedDevice, isLoading } = usePairingStore();

  if (!device) return null;

  const handleConfirmRemove = async () => {
    const success = await removeTrustedDevice(device.deviceId);
    if (success) {
      onClose();
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Revoke Device Trust"
      description="Authentication credentials and local encryption keys will be wiped."
    >
      <div className="space-y-4">
        <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-400 text-xs flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Revoke trust for &ldquo;{device.name}&rdquo;?</p>
            <p className="mt-1 text-rose-600/90 dark:text-rose-400/90 leading-relaxed">
              This will delete the shared cryptographic token from your SQLite database. Any future file transfers between these devices will require a new QR handshake.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 text-xs font-medium rounded-lg text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white"
          >
            Cancel
          </button>

          <button
            type="button"
            disabled={isLoading}
            onClick={handleConfirmRemove}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-lg bg-rose-600 text-white hover:bg-rose-700 transition-colors shadow-sm disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{isLoading ? 'Removing...' : 'Confirm Revocation'}</span>
          </button>
        </div>
      </div>
    </Modal>
  );
};
