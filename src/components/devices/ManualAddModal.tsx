import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { useDeviceStore } from '../../stores/deviceStore';

interface ManualAddModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ManualAddModal: React.FC<ManualAddModalProps> = ({ isOpen, onClose }) => {
  const { addManualDevice, isLoading } = useDeviceStore();
  const [ip, setIp] = useState('');
  const [port, setPort] = useState('53317');
  const [name, setName] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ip.trim()) {
      setErrorMsg('Please provide an IP address');
      return;
    }

    const portNum = parseInt(port, 10);
    if (isNaN(portNum) || portNum <= 0 || portNum > 65535) {
      setErrorMsg('Invalid port number (1-65535)');
      return;
    }

    setErrorMsg(null);
    const success = await addManualDevice(ip.trim(), portNum, name.trim() || undefined);
    if (success) {
      setIp('');
      setName('');
      onClose();
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Add Device Manually"
      description="Connect directly to a peer using its local IP address when mDNS multicast is restricted."
    >
      <form onSubmit={handleAdd} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
            IP Address
          </label>
          <input
            type="text"
            value={ip}
            onChange={(e) => {
              setIp(e.target.value);
              setErrorMsg(null);
            }}
            placeholder="e.g. 192.168.1.125"
            className="w-full px-3 py-2 text-sm rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white placeholder:text-neutral-400 font-mono focus:outline-hidden focus:ring-2 focus:ring-neutral-400 dark:focus:ring-neutral-600 transition-shadow"
            autoFocus
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
              Port
            </label>
            <input
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white font-mono focus:outline-hidden focus:ring-2 focus:ring-neutral-400 dark:focus:ring-neutral-600 transition-shadow"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
              Device Name (Optional)
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Living Room TV"
              className="w-full px-3 py-2 text-sm rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white placeholder:text-neutral-400 focus:outline-hidden focus:ring-2 focus:ring-neutral-400 dark:focus:ring-neutral-600 transition-shadow"
            />
          </div>
        </div>

        {errorMsg && <p className="text-xs text-rose-500">{errorMsg}</p>}

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
            disabled={isLoading || !ip.trim()}
            className="px-4 py-1.5 text-xs font-medium rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors disabled:opacity-50"
          >
            {isLoading ? 'Connecting...' : 'Add Device'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
