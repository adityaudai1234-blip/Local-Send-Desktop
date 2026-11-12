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
  Trash2,
  Info,
  Radio,
  Clock,
  ShieldCheck,
  Send,
} from 'lucide-react';
import { useTransferStore } from '../stores/transferStore';
import { formatBytes, formatSpeed, formatRelativeTime } from '../utils/formatters';
import { PlatformIcon } from '../components/common/PlatformIcon';
import { TransferDetailsModal } from '../components/transfers/TransferDetailsModal';
import { IncomingTransferModal } from '../components/transfers/IncomingTransferModal';
import { TransferSession } from '../types/transfer';

export const Transfers: React.FC = () => {
  const {
    transfers,
    pauseTransfer,
    resumeTransfer,
    cancelTransfer,
    cancelAllTransfers,
    clearHistory,
    setSelectedTransferDetails,
    simulateIncomingProposal,
  } = useTransferStore();

  const [filter, setFilter] = useState<'all' | 'active' | 'incoming' | 'outgoing' | 'completed' | 'failed'>('all');

  const filteredTransfers = transfers.filter((t) => {
    if (filter === 'active') {
      return t.status === 'transferring' || t.status === 'queued' || t.status === 'paused' || t.status === 'waiting_for_approval';
    }
    if (filter === 'incoming') return t.direction === 'incoming';
    if (filter === 'outgoing') return t.direction === 'outgoing';
    if (filter === 'completed') return t.status === 'completed';
    if (filter === 'failed') return t.status === 'failed' || t.status === 'cancelled';
    return true;
  });

  const activeCount = transfers.filter(
    (t) => t.status === 'transferring' || t.status === 'queued' || t.status === 'paused' || t.status === 'waiting_for_approval'
  ).length;

  const handleOpenDetails = (item: typeof transfers[0]) => {
    const session: TransferSession = {
      transferId: item.id,
      direction: item.direction,
      senderDeviceId: item.peerDevice.id || 'dev-peer',
      senderDeviceName: item.direction === 'incoming' ? item.peerDevice.name : 'Your Device',
      senderPlatform: String(item.peerDevice.platform || 'android'),
      recipientDeviceId: item.peerDevice.id || 'dev-recipient',
      recipientDeviceName: item.direction === 'outgoing' ? item.peerDevice.name : 'Your Device',
      recipientIp: item.peerDevice.ipAddress || '192.168.1.142',
      recipientPort: 53317,
      files: [
        {
          fileId: 'f-' + item.id,
          name: item.name,
          size: item.size,
          mimeType: item.mimeType,
          isVerified: item.verified ?? true,
          bytesTransferred: item.bytesTransferred,
          status: item.status,
          sha256Checksum: item.checksum,
        },
      ],
      totalBytes: item.size,
      bytesTransferred: item.bytesTransferred,
      speedBytesPerSec: item.speed,
      estimatedSecondsRemaining: item.etaSeconds,
      status: item.status,
      errorMessage: item.errorMessage,
      startedAt: item.startedAt,
      completedAt: item.completedAt,
      destinationDirectory: '~/Downloads/BeamDrop',
    };

    setSelectedTransferDetails(session);
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Header and Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-white">
            File Transfers & Queue
          </h2>
          <p className="text-xs text-neutral-500">
            Real-time peer-to-peer transmission queue over encrypted local TCP socket.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Quick Simulate Button for Testing Incoming Transfers */}
          <button
            onClick={simulateIncomingProposal}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors"
            title="Simulate receiving an incoming transfer request from an Android device"
          >
            <Radio className="w-3.5 h-3.5 text-cyan-500" />
            <span>Simulate Incoming</span>
          </button>

          {activeCount > 0 && (
            <button
              onClick={cancelAllTransfers}
              className="px-3 py-1.5 text-xs font-medium rounded-lg text-rose-600 dark:text-rose-400 border border-rose-500/30 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
            >
              Cancel All ({activeCount})
            </button>
          )}

          <button
            onClick={clearHistory}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-neutral-500 hover:text-neutral-900 dark:hover:text-white transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear Completed</span>
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1 p-1 bg-neutral-100 dark:bg-neutral-900 rounded-lg w-fit border border-neutral-200/60 dark:border-neutral-800 text-xs">
        {(['all', 'active', 'outgoing', 'incoming', 'completed', 'failed'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors capitalize ${
              filter === tab
                ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white shadow-xs'
                : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
            }`}
          >
            {tab}
            {tab === 'active' && activeCount > 0 && (
              <span className="ml-1.5 px-1.5 py-0.2 rounded-full bg-cyan-500 text-white text-[10px]">
                {activeCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Transfers List */}
      <div className="space-y-3">
        {filteredTransfers.length === 0 ? (
          <div className="p-16 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/20 text-center">
            <CheckCircle2 className="w-8 h-8 text-neutral-400 mx-auto mb-2" />
            <h4 className="text-sm font-semibold text-neutral-900 dark:text-white">
              No transfers in this view
            </h4>
            <p className="text-xs text-neutral-500 mt-1 max-w-sm mx-auto">
              Drop files on the Dashboard or click &ldquo;Simulate Incoming&rdquo; above to test real-time transmission.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredTransfers.map((item) => {
              const isOutgoing = item.direction === 'outgoing';
              const isPaused = item.status === 'paused';
              const isCompleted = item.status === 'completed';
              const isFailed = item.status === 'failed' || item.status === 'cancelled';
              const isTransferring = item.status === 'transferring';

              return (
                <div
                  key={item.id}
                  className="p-5 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/70 space-y-3 shadow-xs hover:border-neutral-300 dark:hover:border-neutral-700 transition-all"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 flex items-center justify-center text-neutral-700 dark:text-neutral-300 shrink-0">
                        <File className="w-5 h-5" />
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-semibold text-neutral-900 dark:text-white truncate">
                            {item.name}
                          </h4>
                          <span className="flex items-center gap-1 text-[11px] font-medium text-neutral-500 shrink-0">
                            {isOutgoing ? (
                              <ArrowUpRight className="w-3.5 h-3.5 text-cyan-500" />
                            ) : (
                              <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-500" />
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
                            {isCompleted
                              ? 'Verified (SHA-256)'
                              : isPaused
                              ? 'Paused'
                              : isFailed
                              ? 'Failed'
                              : formatSpeed(item.speed)}
                          </span>
                          {item.etaSeconds !== undefined && item.etaSeconds > 0 && isTransferring && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-[11px] text-neutral-400 font-mono">
                                ETA ~{item.etaSeconds}s
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Action Controls */}
                    <div className="flex items-center gap-2 shrink-0">
                      {isTransferring && (
                        <button
                          onClick={() => pauseTransfer(item.id)}
                          className="p-2 rounded-lg text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                          title="Pause transfer"
                        >
                          <Pause className="w-4 h-4 fill-current" />
                        </button>
                      )}

                      {isPaused && (
                        <button
                          onClick={() => resumeTransfer(item.id)}
                          className="p-2 rounded-lg text-cyan-600 dark:text-cyan-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                          title="Resume transfer"
                        >
                          <Play className="w-4 h-4 fill-current" />
                        </button>
                      )}

                      {!isCompleted && !isFailed && (
                        <button
                          onClick={() => cancelTransfer(item.id)}
                          className="p-2 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                          title="Cancel transfer"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}

                      <button
                        onClick={() => handleOpenDetails(item)}
                        className="px-2.5 py-1 text-xs font-medium rounded-lg text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                      >
                        Details
                      </button>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="space-y-1.5">
                    <div className="w-full h-2 rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${
                          isCompleted
                            ? 'bg-emerald-500'
                            : isFailed
                            ? 'bg-rose-500'
                            : isPaused
                            ? 'bg-amber-500'
                            : 'bg-cyan-500'
                        }`}
                        style={{ width: `${item.progress}%` }}
                      />
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-neutral-500 font-mono tabular-nums">
                      <span>
                        {item.progress}% {isCompleted ? 'Complete' : isPaused ? 'Paused' : 'Transferred'}
                      </span>
                      <span>
                        {formatBytes(item.bytesTransferred)} / {formatBytes(item.size)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Global Modals */}
      <IncomingTransferModal />
      <TransferDetailsModal />
    </div>
  );
};
