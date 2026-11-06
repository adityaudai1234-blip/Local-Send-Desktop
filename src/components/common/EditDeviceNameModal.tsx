import React, { useState, useEffect } from 'react';
import { Modal } from './Modal';
import { useDeviceStore } from '../../stores/deviceStore';

interface EditDeviceNameModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const EditDeviceNameModal: React.FC<EditDeviceNameModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { localDevice, updateDeviceName, isLoading } = useDeviceStore();
  const [name, setName] = useState(localDevice?.name || '');
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (localDevice) {
      setName(localDevice.name);
    }
  }, [localDevice]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setValidationError('Device name cannot be empty');
      return;
    }

    setValidationError(null);
    const success = await updateDeviceName(name.trim());
    if (success) {
      onClose();
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Edit Device Name"
      description="This name is broadcast via mDNS to nearby devices on your local network."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
            Display Alias
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setValidationError(null);
            }}
            maxLength={48}
            className="w-full px-3 py-2 text-sm rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white placeholder:text-neutral-400 focus:outline-hidden focus:ring-2 focus:ring-neutral-400 dark:focus:ring-neutral-600 transition-shadow"
            placeholder="e.g. Alex's MacBook Pro"
            autoFocus
          />
          {validationError && (
            <p className="text-xs text-rose-500 mt-1">{validationError}</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium rounded-lg text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isLoading || !name.trim()}
            className="px-4 py-1.5 text-xs font-medium rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors disabled:opacity-50"
          >
            {isLoading ? 'Updating...' : 'Save Name'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
