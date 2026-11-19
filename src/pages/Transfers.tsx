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
  Wifi,
  Cpu,
  SlidersHorizontal,
} from 'lucide-react';
import { useTransferStore } from '../stores/transferStore';
import { usePerformanceStore } from '../stores/performanceStore';
import { formatBytes, formatChunkSize, formatEta, formatSpeed } from '../utils/formatters';
import { TransferDetailsModal } from '../components/transfers/TransferDetailsModal';
import { IncomingTransferModal } from '../components/transfers/IncomingTransferModal';
import { ThroughputGraph } from '../components/transfers/ThroughputGraph';
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

  const {
    performanceMetrics,
    networkThroughput,
    diskThroughput,
    resourceUsage,
    queueMetrics,
    optimizationSettings,
    historyPoints,
    graphPaused,
    refreshAll: refreshPerformance,
    optimizeQueue,
    toggleGraphPaused,
    clearGraphHistory,
  } = usePerformanceStore();

  const [filter, setFilter] = useState<'all' | 'active' | 'incoming' | 'outgoing' | 'completed' | 'failed'>('all');
  const [optimizing, setOptimizing] = useState(false);

  useEffect(() => {
    loadQueue();
    loadBackgroundStatus();
    loadRecoverableTransfers();
    refreshPerformance();
  }, [loadQueue, loadBackgroundStatus, loadRecoverableTransfers, refreshPerformance]);

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

  const handleOptimizeQueue = async () => {
    setOptimizing(true);
    try {
      await optimizeQueue();
      await loadQueue();
    } finally {
      setOptimizing(false);
    }
  };

  const netQualityColor =
    networkThroughput?.networkQuality === 'congested'
      ? 'text-rose-600 dark:text-rose-400'
      : networkThroughput?.networkQuality === 'degraded'
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-emerald-600 dark:text-emerald-400';

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Header and Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-white">
            Transfer Queue &amp; Performance Monitor
          </h2>
          <p className="text-xs text-neutral-500">
            Adaptive chunking, anti-starvation queue scheduling, real-time throughput metrics, and interrupted session recovery.
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

      {/* Phase 7: Network Performance & Transfer Performance Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Network Performance Card */}
        <section className="p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/70 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wifi className="w-4 h-4 text-cyan-500" />
              <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
                Network Performance
              </h3>
            </div>
            <span className={`text-xs font-medium capitalize ${netQualityColor}`}>
              {networkThroughput?.networkQuality || 'good'} link
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <span className="text-neutral-500 block">Upload</span>
              <span className="font-mono tabular-nums text-sm font-semibold text-neutral-900 dark:text-white">
                {formatSpeed(networkThroughput?.uploadBps ?? 0)}
              </span>
            </div>
            <div>
              <span className="text-neutral-500 block">Download</span>
              <span className="font-mono tabular-nums text-sm font-semibold text-neutral-900 dark:text-white">
                {formatSpeed(networkThroughput?.downloadBps ?? 0)}
              </span>
            </div>
            <div>
              <span className="text-neutral-500 block">Peak Speed</span>
              <span className="font-mono tabular-nums text-sm font-semibold text-neutral-900 dark:text-white">
                {formatSpeed(performanceMetrics?.peakSpeedBps ?? 0)}
              </span>
            </div>
            <div>
              <span className="text-neutral-500 block">Latency</span>
              <span className="font-mono tabular-nums text-sm font-semibold text-neutral-900 dark:text-white">
                {networkThroughput?.averageLatencyMs ?? 0} ms
              </span>
            </div>
          </div>

          <div className="pt-2 border-t border-neutral-100 dark:border-neutral-800 flex flex-wrap items-center justify-between gap-2 text-[11px] text-neutral-500 font-mono tabular-nums">
            <span>
              Interface: {networkThroughput?.interfaceIp || '127.0.0.1'} · {networkThroughput?.activeConnections ?? 0} peer(s)
            </span>
            <span>
              TX {formatBytes(networkThroughput?.totalTxBytes ?? 0)} / RX {formatBytes(networkThroughput?.totalRxBytes ?? 0)}
            </span>
          </div>
        </section>

        {/* Transfer Performance Card */}
        <section className="p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/70 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Cpu className="w-4 h-4 text-emerald-500" />
              <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
                Transfer Engine Performance
              </h3>
            </div>
            <span className="text-xs font-mono tabular-nums text-neutral-500">
              {optimizationSettings.adaptiveChunkingEnabled ? 'Adaptive' : 'Fixed'} ·{' '}
              {formatChunkSize(performanceMetrics?.currentChunkSizeBytes ?? optimizationSettings.defaultChunkSizeKb * 1024)}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <span className="text-neutral-500 block">Active / Queued</span>
              <span className="font-mono tabular-nums text-sm font-semibold text-neutral-900 dark:text-white">
                {performanceMetrics?.activeTransfers ?? 0} / {performanceMetrics?.queuedTransfers ?? 0}
              </span>
            </div>
            <div>
              <span className="text-neutral-500 block">Disk Write</span>
              <span className="font-mono tabular-nums text-sm font-semibold text-neutral-900 dark:text-white">
                {formatSpeed(diskThroughput?.writeBps ?? 0)}
              </span>
            </div>
            <div>
              <span className="text-neutral-500 block">Buffer Memory</span>
              <span className="font-mono tabular-nums text-sm font-semibold text-neutral-900 dark:text-white">
                {formatBytes(resourceUsage?.bufferMemoryBytes ?? 0)}
              </span>
            </div>
            <div>
              <span className="text-neutral-500 block">Retries / Failures</span>
              <span className="font-mono tabular-nums text-sm font-semibold text-neutral-900 dark:text-white">
                {performanceMetrics?.retryCount ?? 0} / {performanceMetrics?.failedCount ?? 0}
              </span>
            </div>
          </div>

          <div className="pt-2 border-t border-neutral-100 dark:border-neutral-800 flex flex-wrap items-center justify-between gap-2 text-[11px] text-neutral-500 font-mono tabular-nums">
            <span>
              Slots {resourceUsage?.activeConcurrentTransfers ?? 0}/{resourceUsage?.maxConcurrentTransfers ?? optimizationSettings.maxConcurrentTransfers} · Handles {resourceUsage?.activeFileHandles ?? 0}
            </span>
            <span>
              {diskThroughput?.availableDiskBytes !== null && diskThroughput?.availableDiskBytes !== undefined
                ? `Free Disk ${formatBytes(diskThroughput.availableDiskBytes)}`
                : `Write Buffer ${formatChunkSize(diskThroughput?.writeBufferSizeBytes ?? 262144)}`}
            </span>
          </div>
        </section>
      </div>

      {/* Real-Time Performance Graph */}
      {optimizationSettings.performanceGraphEnabled && (
        <ThroughputGraph
          points={historyPoints}
          currentUploadBps={networkThroughput?.uploadBps ?? 0}
          currentDownloadBps={networkThroughput?.downloadBps ?? 0}
          peakSpeedBps={performanceMetrics?.peakSpeedBps ?? 0}
          paused={graphPaused}
          onTogglePause={toggleGraphPaused}
          onClear={clearGraphHistory}
        />
      )}

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
                <span className="font-mono tabular-nums">{formatSpeed(backgroundStatus.totalTransferSpeedBps)}</span> total throughput
              </span>
            </div>
          </div>
          <span className="text-[11px] font-mono text-cyan-600 dark:text-cyan-400">
            System Tray Synced
          </span>
        </div>
      )}

      {/* Phase 7: Transfer Queue Overview Table */}
      {queueItems.length > 0 && (
        <section className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/70 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-neutral-200 dark:border-neutral-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs">
              <SlidersHorizontal className="w-4 h-4 text-cyan-500" />
              <span className="font-semibold text-neutral-900 dark:text-white">
                Transfer Queue Overview
              </span>
              <span className="text-neutral-500 font-mono tabular-nums">
                · {queueItems.length} scheduled · {queueMetrics?.starvationBoostsApplied ?? 0} anti-starvation boosts
              </span>
            </div>

            <button
              type="button"
              onClick={handleOptimizeQueue}
              disabled={optimizing}
              className="px-3 py-1 text-xs font-medium rounded-lg border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors disabled:opacity-50"
            >
              {optimizing ? 'Optimizing...' : 'Optimize Queue'}
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-neutral-200 dark:border-neutral-800 text-[11px] uppercase tracking-wider text-neutral-500 bg-neutral-50/70 dark:bg-neutral-950/30">
                <tr>
                  <th className="py-2.5 px-4 font-medium">#</th>
                  <th className="py-2.5 px-4 font-medium">Transfer</th>
                  <th className="py-2.5 px-4 font-medium">Destination</th>
                  <th className="py-2.5 px-4 font-medium text-right">Size</th>
                  <th className="py-2.5 px-4 font-medium">Priority</th>
                  <th className="py-2.5 px-4 font-medium">Status</th>
                  <th className="py-2.5 px-4 font-medium text-right">ETA</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {queueItems.map((q) => (
                  <tr
                    key={q.transferId}
                    className="hover:bg-neutral-50 dark:hover:bg-neutral-800/40 transition-colors"
                  >
                    <td className="py-2.5 px-4 font-mono tabular-nums text-neutral-500">
                      #{q.queuePosition}
                    </td>
                    <td className="py-2.5 px-4 font-medium text-neutral-900 dark:text-white max-w-[200px] truncate">
                      {q.rootName}
                    </td>
                    <td className="py-2.5 px-4 text-neutral-600 dark:text-neutral-400">
                      {q.recipientName}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-neutral-700 dark:text-neutral-300">
                      {formatBytes(q.totalBytes)}
                    </td>
                    <td className="py-2.5 px-4 capitalize font-medium text-neutral-700 dark:text-neutral-300">
                      {q.priority}
                    </td>
                    <td className="py-2.5 px-4 capitalize text-neutral-600 dark:text-neutral-400">
                      {q.status.replace(/_/g, ' ')}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-neutral-500">
                      {q.status === 'transferring'
                        ? formatEta(q.estimatedSecondsRemaining, q.estimatedSecondsRemaining !== undefined)
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
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
                  <p className="text-[11px] text-neutral-500 font-mono tabular-nums">
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
              <span className="ml-1.5 font-mono tabular-nums text-cyan-600 dark:text-cyan-400">
                ({activeCount})
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
              const remainingBytes = Math.max(0, item.size - item.bytesTransferred);

              return (
                <div
                  key={item.id}
                  className="p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/70 space-y-3 hover:border-neutral-300 dark:hover:border-neutral-700 transition-colors"
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
                            <span className="text-[11px] font-mono tabular-nums text-neutral-500">
                              · Queue #{queuePos}
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
                          {isTransferring && (
                            <>
                              {item.peakSpeedBps ? (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="text-[11px] font-mono tabular-nums text-neutral-400">
                                    Peak {formatSpeed(item.peakSpeedBps)}
                                  </span>
                                </>
                              ) : null}
                              <span aria-hidden="true">·</span>
                              <span className="text-[11px] text-neutral-400 font-mono tabular-nums">
                                ETA {formatEta(item.etaSeconds, item.reliableEta ?? true)}
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
                        {isTransferring && remainingBytes > 0 ? ` · ${formatBytes(remainingBytes)} left` : ''}
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
