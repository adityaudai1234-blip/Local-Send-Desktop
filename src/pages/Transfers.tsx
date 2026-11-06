import React, { useState } from 'react';
import {
  Pause,
  Play,
  X,
  ArrowUpRight,
  ArrowDownLeft,
  File,
  CheckCircle2,
  AlertCircle,
  Plus,
} from 'lucide-react';
import { useTransferStore } from '../stores/transferStore';
import { useDeviceStore } from '../stores/deviceStore';
import { formatBytes, formatSpeed } from '../utils/formatters';
import { Modal } from '../components/common/Modal';

export const Transfers: React.FC = () => {
  const { transfers, pauseTransfer, resumeTransfer, cancelTransfer, addTransfer } = useTransferStore();
  const { discoveredDevices } = useDeviceStore();

  const [filter, setFilter] = useState<'all' | 'incoming' | 'outgoing'>('all');
  const [isSimulateModalOpen, setIsSimulateModalOpen] = useState(false);
  const [newFileName, setNewFileName] = useState('raw_footage_4k.mov');
  const [newFileSizeMb, setNewFileSizeMb] = useState('320');
  const [newDirection, setNewDirection] = useState<'incoming' | 'outgoing'>('outgoing');

  const filtered = transfers.filter((t) => {
    if (filter === 'incoming') return t.direction === 'incoming';
    if (filter === 'outgoing') return t.direction === 'outgoing';
    return true;
  });

  const activeTransfers = filtered.filter(
    (t) => t.status === 'transferring' || t.status === 'queued' || t.status === 'paused'
  );

  const handleStartSimulated = (e: React.FormEvent) => {
    e.preventDefault();
    const targetPeer = discoveredDevices[0] || {
      name: 'Aditya’s Pixel 8',
      platform: 'android',
      ipAddress: '192.168.1.142',
    };

    addTransfer({
      name: newFileName,
      size: (parseInt(newFileSizeMb, 10) || 100) * 1024 * 1024,
      mimeType: 'video/quicktime',
      speed: 16800000,
      direction: newDirection,
      status: 'transferring',
      peerDevice: targetPeer,
    });

    setIsSimulateModalOpen(false);
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Header and Filter Tabs */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-white">
            File Transfers
          </h2>
          <p className="text-xs text-neutral-500">
            Real-time peer-to-peer transmission queue over local TCP socket.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Filter tabs */}
          <div className="flex items-center gap-1 p-1 bg-neutral-100 dark:bg-neutral-900 rounded-lg border border-neutral-200/60 dark:border-neutral-800">
            <button
              onClick={() => setFilter('all')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                filter === 'all'
                  ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white shadow-xs'
                  : 'text-neutral-600 dark:text-neutral-400'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setFilter('outgoing')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                filter === 'outgoing'
                  ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white shadow-xs'
                  : 'text-neutral-600 dark:text-neutral-400'
              }`}
            >
              Outgoing
            </button>
            <button
              onClick={() => setFilter('incoming')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                filter === 'incoming'
                  ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white shadow-xs'
                  : 'text-neutral-600 dark:text-neutral-400'
              }`}
            >
              Incoming
            </button>
          </div>

          {/* Simulate New Transfer Button */}
          <button
            onClick={() => setIsSimulateModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors shadow-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Test Transfer</span>
          </button>
        </div>
      </div>

      {/* Active Transfers Queue */}
      <div className="space-y-4">
        <div className="flex items-center justify-between text-xs text-neutral-500">
          <span>Active Transfers ({activeTransfers.length})</span>
          <span>Max Bandwidth: 1 Gbps (LAN)</span>
        </div>

        {activeTransfers.length === 0 ? (
          <div className="p-12 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/20 text-center">
            <CheckCircle2 className="w-8 h-8 text-neutral-400 mx-auto mb-2" />
            <h4 className="text-sm font-medium text-neutral-900 dark:text-white">
              Queue is empty
            </h4>
            <p className="text-xs text-neutral-500 mt-1 max-w-sm mx-auto">
              No files are currently being transferred. Select a device on the Dashboard or start a test transfer above.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {activeTransfers.map((item) => {
              const isOutgoing = item.direction === 'outgoing';
              const isPaused = item.status === 'paused';

              return (
                <div
                  key={item.id}
                  className="p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/70 space-y-3 shadow-xs"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 flex items-center justify-center text-neutral-700 dark:text-neutral-300">
                        <File className="w-5 h-5" />
                      </div>

                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-semibold text-neutral-900 dark:text-white">
                            {item.name}
                          </h4>
                          <span className="flex items-center gap-1 text-[11px] text-neutral-500">
                            {isOutgoing ? (
                              <ArrowUpRight className="w-3 h-3 text-cyan-500" />
                            ) : (
                              <ArrowDownLeft className="w-3 h-3 text-emerald-500" />
                            )}
                            {isOutgoing ? 'Sending' : 'Receiving'}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 text-xs text-neutral-500 mt-0.5">
                          <span>Peer: {item.peerDevice.name}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">{formatBytes(item.size)}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums text-neutral-700 dark:text-neutral-300">
                            {isPaused ? 'Paused' : formatSpeed(item.speed)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Action Controls */}
                    <div className="flex items-center gap-1.5">
                      {isPaused ? (
                        <button
                          onClick={() => resumeTransfer(item.id)}
                          className="p-2 rounded-lg text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                          title="Resume"
                        >
                          <Play className="w-4 h-4 fill-current" />
                        </button>
                      ) : (
                        <button
                          onClick={() => pauseTransfer(item.id)}
                          className="p-2 rounded-lg text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                          title="Pause"
                        >
                          <Pause className="w-4 h-4 fill-current" />
                        </button>
                      )}

                      <button
                        onClick={() => cancelTransfer(item.id)}
                        className="p-2 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                        title="Cancel"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="space-y-1.5">
                    <div className="w-full h-2 rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${
                          isPaused ? 'bg-amber-500' : 'bg-cyan-500'
                        }`}
                        style={{ width: `${item.progress}%` }}
                      />
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-neutral-500 font-mono tabular-nums">
                      <span>{item.progress}% Transferred</span>
                      <span>{formatBytes((item.size * item.progress) / 100)} / {formatBytes(item.size)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Simulated Transfer Creator Modal */}
      <Modal
        isOpen={isSimulateModalOpen}
        onClose={() => setIsSimulateModalOpen(false)}
        title="Enqueue Test Transfer"
        description="Verify transfer interface and progress animation."
      >
        <form onSubmit={handleStartSimulated} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
              File Name
            </label>
            <input
              type="text"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                Size (MB)
              </label>
              <input
                type="number"
                value={newFileSizeMb}
                onChange={(e) => setNewFileSizeMb(e.target.value)}
                min="1"
                className="w-full px-3 py-2 text-sm rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white font-mono"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                Direction
              </label>
              <select
                value={newDirection}
                onChange={(e) => setNewDirection(e.target.value as 'incoming' | 'outgoing')}
                className="w-full px-3 py-2 text-sm rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white"
              >
                <option value="outgoing">Outgoing (Send)</option>
                <option value="incoming">Incoming (Receive)</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setIsSimulateModalOpen(false)}
              className="px-3 py-1.5 text-xs font-medium rounded-lg text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 text-xs font-medium rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 shadow-sm"
            >
              Enqueue Transfer
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
