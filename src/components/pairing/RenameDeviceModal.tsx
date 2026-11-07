import React, { useState, useEffect } from 'react';
import { Modal } from '../common/Modal';
import { TrustedDevice } from '../../types/pairing';
import { usePairingStore } from '../../stores/pairingStore';

interface RenameDeviceModalProps {
  device: TrustedDevice | null;
  isOpen: boolean;
  onClose: () => void;
}

export const RenameDeviceModal: React.FC<RenameDeviceModalProps> = ({
  device,
  isOpen,
  onClose,
}) => {
  const { renameTrustedDevice, isLoading } = usePairingStore();
  const [name, setName] = useState(device?.name || '');

  useEffect(() => {
    if (device) setName(device.name);
  }, [device]);

  if (!device) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const success = await renameTrustedDevice(device.deviceId, name.trim());
    if (success) onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Rename Trusted Device"
      description="Update the local display alias for this paired peer."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
            Device Alias
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white"
            maxLength={48}
            autoFocus
            required
          />
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
            type="submit"
            disabled={isLoading || !name.trim()}
            className="px-4 py-1.5 text-xs font-medium rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-800 transition-colors disabled:opacity-50"
          >
            Save Alias
          </button>
        </div>
      </form>
    </Modal>
  );
};
