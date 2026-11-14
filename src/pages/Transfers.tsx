import React, { useState, useEffect } from 'react';
import {
  Pause,
  Play,
  X,
  ArrowUpRight,
  ArrowDownLeft,
  File,
  Folder,
  CheckCircle2,
  Trash2,
  Radio,
  RotateCcw,
  RefreshCw,
  HardDriveDownload,
  Gauge,
} from 'lucide-react';
import { useTransferStore } from '../stores/transferStore';
import { formatBytes, formatSpeed } from '../utils/formatters';
import { TransferDetailsModal } from '../components/transfers/TransferDetailsModal';
import { IncomingTransferModal } from '../components/transfers/IncomingTransferModal';
import { TransferPriority } from '../types/transfer';

export const Transfers: React.FC = () => {
  const {
    transfers,
    queueItems,
    backgroundStatus,
    recoverableTransfers,
    pauseTransfer,
    resumeTransfer,
    cancelTransfer,
    cancelAllTransfers,
    pauseAllTransfers,
    resumeAllTransfers,
    changeTransferPriority,
    retryTransfer,
    removeTransfer,
    recoverTransfer,
    loadQueue,
    loadBackgroundStatus,
    loadRecoverableTransfers,
    clearAllHistory,
    openTransferDetailsById,
    simulateIncomingProposal,
  } = useTransferStore();

  const [filter, setFilter] = useState<'all' | 'active' | 'incoming' | 'outgoing' | 'completed' | 'failed'>('all');

  useEffect(() => {
    loadQueue();
    loadBackgroundStatus();
    loadRecoverableTransfers();
  }, [loadQueue, loadBackgroundStatus, loadRecoverableTransfers]);

  const queuePosMap = new Map(queueItems.map((q) => [q.transferId, q.queuePosition]));

  const filteredTransfers = transfers.filter((t) => {
    if (filter === 'active') {
      return ['transferring', 'queued', 'paused', 'waiting_for_approval', 'preparing', 'connecting'].includes(t.status);
    }
    if (filter === 'incoming') return t.direction === 'incoming';
    if (filter === 'outgoing') return t.direction === 'outgoing';
    if (filter === 'completed') return t.status === 'completed';
    if (filter === 'failed') return t.status === 'failed' || t.status === 'cancelled';
    return true;
  });

  const activeCount = transfers.filter((t) =>
    ['transferring', 'queued', 'paused', 'waiting_for_approval', 'preparing'].includes(t.status)
  ).length;
  const pausedCount = transfers.filter((t) => t.status === 'paused').length;
  const transferringCount = transfers.filter((t) => t.status === 'transferring' || t.status === 'queued').length;

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Header and Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-white">
            Transfer Queue &amp; Background Manager
          </h2>
          <p className="text-xs text-neutral-500">
            Priority-scheduled P2P queue with pause/resume, retry, and interrupted session recovery.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={simulateIncomingProposal}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors"
            title="Simulate receiving an incoming folder transfer request"
          >
            <Radio className="w-3.5 h-3.5 text-cyan-500" />
            <span>Simulate Incoming</span>
          </button>

          {transferringCount > 0 && (
            <button
              onClick={pauseAllTransfers}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-amber-500/30 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition-colors"
            >
              <Pause className="w-3.5 h-3.5" />
              <span>Pause All</span>
            </button>
          )}

          {pausedCount > 0 && (
            <button
              onClick={resumeAllTransfers}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-cyan-500/30 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-50 dark:hover:bg-cyan-950/30 transition-colors"
            >
              <Play className="w-3.5 h-3.5" />
              <span>Resume All ({pausedCount})</span>
            </button>
          )}

          {activeCount > 0 && (
            <button
              onClick={cancelAllTransfers}
              className="px-3 py-1.5 text-xs font-medium rounded-lg text-rose-600 dark:text-rose-400 border border-rose-500/30 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
            >
              Cancel All ({activeCount})
            </button>
          )}

          <button
            onClick={clearAllHistory}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-neutral-500 hover:text-neutral-900 dark:hover:text-white transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear Completed</span>
          </button>
        </div>
      </div>

      {/* Background Queue & Tray Banner */}
      {backgroundStatus && (backgroundStatus.activeTransfersCount > 0 || backgroundStatus.pausedTransfersCount > 0) && (
        <div className="p-3.5 rounded-xl border border-cyan-500/30 bg-cyan-500/5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5">
            <HardDriveDownload className="w-4 h-4 text-cyan-500 shrink-0" />
            <div>
              <span className="font-semibold text-neutral-900 dark:text-white">
                Background Transfer Engine Active
              </span>
              <span className="text-neutral-500 ml-2">
                {backgroundStatus.activeTransfersCount} active · {backgroundStatus.pausedTransfersCount} paused ·{' '}
                <span className="font-mono">{formatSpeed(backgroundStatus.totalTransferSpeedBps)}</span> total throughput
              </span>
            </div>
          </div>
          <span className="text-[11px] font-mono text-cyan-600 dark:text-cyan-400">
            System Tray Synced
          </span>
        </div>
      )}

      {/* Interrupted Transfer Recovery Banner */}
      {recoverableTransfers.length > 0 && (
        <div className="p-4 rounded-xl border border-amber-500/40 bg-amber-500/10 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-amber-800 dark:text-amber-300">
              <RefreshCw className="w-4 h-4" />
              <span>Interrupted Transfers Detected ({recoverableTransfers.length})</span>
            </div>
            <span className="text-[11px] text-amber-700 dark:text-amber-400">
              Verified against trusted vault &amp; .part files
            </span>
          </div>

          <div className="space-y-2">
            {recoverableTransfers.map((rec) => (
              <div
                key={rec.transferId}
                className="p-3 rounded-lg bg-white/80 dark:bg-neutral-900/70 border border-amber-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-neutral-900 dark:text-white truncate">{rec.rootName}</p>
                  <p className="text-[11px] text-neutral-500">
                    Peer: {rec.peerDeviceName} · {formatBytes(rec.bytesTransferred)} / {formatBytes(rec.totalBytes)} · {rec.reason}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {rec.canResume && (
                    <button
                      onClick={() => recoverTransfer(rec.transferId, false)}
                      className="px-3 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-500 font-medium transition-colors"
                    >
                      Resume Session
                    </button>
                  )}
                  {rec.canRetryFresh && (
                    <button
                      onClick={() => recoverTransfer(rec.transferId, true)}
                      className="px-3 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 font-medium transition-colors"
                    >
                      Retry Fresh
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center gap-1 p-1 bg-neutral-100 dark:bg-neutral-900 rounded-lg w-fit border border-neutral-200/60 dark:border-neutral-800 text-xs">
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
              Drop files or folders on the Dashboard, or click &ldquo;Simulate Incoming&rdquo; above to test transmission.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredTransfers.map((item) => {
              const isOutgoing = item.direction === 'outgoing';
              const isPaused = item.status === 'paused';
              const isCompleted = item.status === 'completed';
              const isFailed = item.status === 'failed' || item.status === 'cancelled';
              const isTransferring = item.status === 'transferring' || item.status === 'queued';
              const queuePos = queuePosMap.get(item.id) || item.queuePosition;

              return (
                <div
                  key={item.id}
                  className="p-5 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/70 space-y-3 shadow-xs hover:border-neutral-300 dark:hover:border-neutral-700 transition-all"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 flex items-center justify-center text-neutral-700 dark:text-neutral-300 shrink-0">
                        {item.isFolder ? (
                          <Folder className="w-5 h-5 text-amber-500" />
                        ) : (
                          <File className="w-5 h-5" />
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-sm font-semibold text-neutral-900 dark:text-white truncate">
                            {item.name}
                          </h4>
                          {queuePos !== undefined && !isCompleted && !isFailed && (
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300">
                              Queue #{queuePos}
                            </span>
                          )}
                          <span className="flex items-center gap-1 text-[11px] font-medium text-neutral-500 shrink-0">
                            {isOutgoing ? (
                              <ArrowUpRight className="w-3.5 h-3.5 text-cyan-500" />
                            ) : (
                              <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-500" />
                            )}
                            {isOutgoing ? 'Sending' : 'Receiving'}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500 mt-0.5">
                          <span>Peer: {item.peerDevice.name}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">{formatBytes(item.size)}</span>
                          {item.filesCount && item.filesCount > 1 && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{item.filesCount} items</span>
                            </>
                          )}
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums text-neutral-700 dark:text-neutral-300">
                            {isCompleted
                              ? 'Verified (SHA-256)'
                              : isPaused
                                ? 'Paused'
                                : isFailed
                                  ? item.status === 'cancelled'
                                    ? 'Cancelled'
                                    : 'Failed'
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

                    {/* Action & Priority Controls */}
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {!isCompleted && !isFailed && (
                        <div className="flex items-center gap-1 mr-1">
                          <Gauge className="w-3.5 h-3.5 text-neutral-400" />
                          <select
                            aria-label="Transfer priority"
                            value={item.priority || 'normal'}
                            onChange={(e) =>
                              changeTransferPriority(item.id, e.target.value as TransferPriority)
                            }
                            className="text-[11px] font-medium px-2 py-1 rounded-md border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 focus:outline-hidden"
                          >
                            <option value="low">Low</option>
                            <option value="normal">Normal</option>
                            <option value="high">High</option>
                          </select>
                        </div>
                      )}

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

                      {isFailed && (
                        <button
                          onClick={() => retryTransfer(item.id)}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg text-cyan-600 dark:text-cyan-400 hover:bg-cyan-50 dark:hover:bg-cyan-950/30 transition-colors"
                          title="Retry transfer"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Retry</span>
                        </button>
                      )}

                      {(isCompleted || isFailed) && (
                        <button
                          onClick={() => removeTransfer(item.id)}
                          className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors"
                          title="Dismiss from queue view"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}

                      <button
                        onClick={() => openTransferDetailsById(item.id)}
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
                        {item.progress}% {isCompleted ? 'Complete' : isPaused ? 'Paused' : isFailed ? item.status : 'Transferred'}
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
