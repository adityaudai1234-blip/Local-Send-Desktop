import React, { useEffect, useState } from 'react';
import {
  Clock,
  ArrowUpRight,
  ArrowDownLeft,
  File,
  Folder,
  Trash2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Search,
  ExternalLink,
  RotateCcw,
  Copy,
  Eye,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
} from 'lucide-react';
import { useTransferStore } from '../stores/transferStore';
import { formatBytes, formatDateTime } from '../utils/formatters';
import { tauriBridge } from '../services/tauriBridge';
import { Modal } from '../components/common/Modal';
import { TransferDetailsModal } from '../components/transfers/TransferDetailsModal';
import { HistoryFilterOptions, TransferSession } from '../types/transfer';

const PAGE_SIZE = 10;

export const History: React.FC = () => {
  const {
    historySessions,
    statistics,
    loadHistory,
    loadStatistics,
    deleteHistoryEntry,
    clearAllHistory,
    retryTransfer,
    setSelectedTransferDetails,
    showNotification,
  } = useTransferStore();

  const [direction, setDirection] = useState<HistoryFilterOptions['direction']>('all');
  const [status, setStatus] = useState<HistoryFilterOptions['status']>('all');
  const [sortBy, setSortBy] = useState<HistoryFilterOptions['sortBy']>('newest');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(0);

  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  useEffect(() => {
    loadHistory({ direction, status, sortBy, searchQuery, limit: 100, offset: 0 });
    loadStatistics('all');
  }, [direction, status, sortBy, searchQuery, loadHistory, loadStatistics]);

  const totalPages = Math.max(1, Math.ceil(historySessions.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pagedSessions = historySessions.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const handleCopyInfo = async (session: TransferSession) => {
    const label = session.rootFolderName || session.files[0]?.name || 'Transfer';
    const text = `BeamDrop Transfer ${session.transferId} | ${label} | ${formatBytes(session.totalBytes)} | ${session.status}`;
    await tauriBridge.copyFilePath(text);
    showNotification('info', 'Copied Transfer Info', 'Transfer summary copied to clipboard.');
  };

  const handleRevealLocation = (session: TransferSession) => {
    const target = session.destinationDirectory || '~/Downloads/BeamDrop';
    tauriBridge.revealReceivedFile(target);
  };

  const totalTransferredBytes =
    (statistics?.totalBytesSent || 0) + (statistics?.totalBytesReceived || 0);

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-white">
            Persistent Transfer History
          </h2>
          <p className="text-xs text-neutral-500">
            SQLite-backed audit log of sent &amp; received files and folder hierarchies. Deleting history never deletes received files.
          </p>
        </div>

        <button
          onClick={() => setConfirmClearOpen(true)}
          disabled={historySessions.length === 0}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors border border-rose-500/20 disabled:opacity-40"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Clear History</span>
        </button>
      </div>

      {/* 5 Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60">
          <span className="text-[11px] text-neutral-500 block">Total Transfers</span>
          <span className="text-lg font-bold font-mono text-neutral-900 dark:text-white mt-1 block">
            {(statistics?.successfulTransfersCount || 0) + (statistics?.failedTransfersCount || 0)}
          </span>
        </div>

        <div className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60">
          <span className="text-[11px] text-neutral-500 block">Data Transferred</span>
          <span className="text-lg font-bold font-mono text-neutral-900 dark:text-white mt-1 block">
            {formatBytes(totalTransferredBytes)}
          </span>
        </div>

        <div className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60">
          <span className="text-[11px] text-neutral-500 block">Files Sent</span>
          <span className="text-lg font-bold font-mono text-cyan-600 dark:text-cyan-400 mt-1 block">
            {statistics?.totalFilesSent || 0}
          </span>
        </div>

        <div className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60">
          <span className="text-[11px] text-neutral-500 block">Files Received</span>
          <span className="text-lg font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-1 block">
            {statistics?.totalFilesReceived || 0}
          </span>
        </div>

        <div className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60 col-span-2 md:col-span-1">
          <span className="text-[11px] text-neutral-500 block">Success Rate</span>
          <span className="text-lg font-bold font-mono text-neutral-900 dark:text-white mt-1 block">
            {(statistics?.successRatePercentage ?? 100).toFixed(1)}%
          </span>
        </div>
      </div>

      {/* Search, Filters & Sort Bar */}
      <div className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
        {/* Search Input */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPage(0);
            }}
            placeholder="Search file, folder, device, or transfer ID..."
            className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-neutral-900 dark:text-white focus:outline-hidden focus:ring-1 focus:ring-cyan-500"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* Direction Filter */}
          <div className="flex items-center gap-1 p-1 bg-neutral-100 dark:bg-neutral-950 rounded-lg border border-neutral-200/60 dark:border-neutral-800">
            {(['all', 'sent', 'received'] as const).map((dir) => (
              <button
                key={dir}
                onClick={() => {
                  setDirection(dir);
                  setPage(0);
                }}
                className={`px-2.5 py-1 rounded-md font-medium capitalize transition-colors ${
                  direction === dir
                    ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white shadow-xs'
                    : 'text-neutral-600 dark:text-neutral-400'
                }`}
              >
                {dir}
              </button>
            ))}
          </div>

          {/* Status Filter */}
          <select
            aria-label="Filter by status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as HistoryFilterOptions['status']);
              setPage(0);
            }}
            className="px-3 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200"
          >
            <option value="all">All Statuses</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="cancelled">Cancelled</option>
          </select>

          {/* Sort Dropdown */}
          <select
            aria-label="Sort history"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as HistoryFilterOptions['sortBy'])}
            className="px-3 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200"
          >
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
            <option value="largest">Largest Size</option>
            <option value="smallest">Smallest Size</option>
            <option value="success">Completed First</option>
            <option value="failed">Failed First</option>
          </select>
        </div>
      </div>

      {/* History Table */}
      <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-neutral-50 dark:bg-neutral-950/60 border-b border-neutral-200 dark:border-neutral-800 text-neutral-500 font-medium select-none">
              <tr>
                <th className="px-5 py-3">Item / Folder</th>
                <th className="px-4 py-3">Peer Device</th>
                <th className="px-4 py-3">Direction</th>
                <th className="px-4 py-3 text-right">Size</th>
                <th className="px-4 py-3">Date &amp; Time</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800/80">
              {pagedSessions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-neutral-400">
                    <Clock className="w-7 h-7 mx-auto mb-2 text-neutral-400/80" />
                    <p className="font-medium text-neutral-600 dark:text-neutral-300">
                      No matching transfer records
                    </p>
                    <p className="text-[11px] text-neutral-400 mt-0.5">
                      Adjust your search query or filters, or send/receive files to record new sessions.
                    </p>
                  </td>
                </tr>
              ) : (
                pagedSessions.map((session) => {
                  const isOutgoing = session.direction === 'outgoing';
                  const title =
                    session.rootFolderName ||
                    session.files[0]?.name ||
                    'Transfer Session';
                  const peerName = isOutgoing
                    ? session.recipientDeviceName
                    : session.senderDeviceName;

                  return (
                    <tr
                      key={session.transferId}
                      className="hover:bg-neutral-50/70 dark:hover:bg-neutral-800/40 transition-colors"
                    >
                      <td className="px-5 py-3.5 font-medium text-neutral-900 dark:text-white">
                        <div className="flex items-center gap-2.5">
                          {session.isFolder ? (
                            <Folder className="w-4 h-4 text-amber-500 shrink-0" />
                          ) : (
                            <File className="w-4 h-4 text-neutral-400 shrink-0" />
                          )}
                          <div className="min-w-0">
                            <span className="truncate max-w-[220px] block">{title}</span>
                            <span className="text-[10px] font-mono text-neutral-400">
                              {session.files.length} item(s) · {session.transferId.slice(0, 10)}
                            </span>
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-3.5 text-neutral-700 dark:text-neutral-300">
                        <span className="font-medium block">{peerName}</span>
                        <span className="text-[11px] font-mono text-neutral-400">
                          {session.recipientIp}
                        </span>
                      </td>

                      <td className="px-4 py-3.5">
                        <span className="inline-flex items-center gap-1.5 text-neutral-700 dark:text-neutral-300">
                          {isOutgoing ? (
                            <ArrowUpRight className="w-3.5 h-3.5 text-cyan-500" />
                          ) : (
                            <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-500" />
                          )}
                          <span>{isOutgoing ? 'Sent' : 'Received'}</span>
                        </span>
                      </td>

                      <td className="px-4 py-3.5 text-right font-mono tabular-nums text-neutral-700 dark:text-neutral-300">
                        {formatBytes(session.totalBytes)}
                      </td>

                      <td className="px-4 py-3.5 text-neutral-500">
                        {formatDateTime(session.startedAt)}
                      </td>

                      <td className="px-4 py-3.5">
                        {session.status === 'completed' && (
                          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Completed
                          </span>
                        )}
                        {session.status === 'cancelled' && (
                          <span className="inline-flex items-center gap-1 text-neutral-400 font-medium">
                            <XCircle className="w-3.5 h-3.5" />
                            Cancelled
                          </span>
                        )}
                        {session.status === 'failed' && (
                          <span className="inline-flex items-center gap-1 text-rose-500 font-medium">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            Failed
                          </span>
                        )}
                        {!['completed', 'cancelled', 'failed'].includes(session.status) && (
                          <span className="inline-flex items-center gap-1 text-cyan-500 font-medium capitalize">
                            {session.status}
                          </span>
                        )}
                      </td>

                      <td className="px-5 py-3.5 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={() => setSelectedTransferDetails(session)}
                            className="p-1.5 rounded-md text-neutral-500 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800"
                            title="View Details"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>

                          <button
                            onClick={() => handleRevealLocation(session)}
                            className="p-1.5 rounded-md text-neutral-500 hover:text-cyan-600 dark:hover:text-cyan-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                            title="Open Destination Folder"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </button>

                          {(session.status === 'failed' || session.status === 'cancelled' || isOutgoing) && (
                            <button
                              onClick={() => retryTransfer(session.transferId)}
                              className="p-1.5 rounded-md text-neutral-500 hover:text-cyan-600 dark:hover:text-cyan-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                              title="Retry / Re-send"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                            </button>
                          )}

                          <button
                            onClick={() => handleCopyInfo(session)}
                            className="p-1.5 rounded-md text-neutral-500 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800"
                            title="Copy Transfer Info"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>

                          <button
                            onClick={() => setPendingDeleteId(session.transferId)}
                            className="p-1.5 rounded-md text-neutral-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                            title="Delete History Record"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {historySessions.length > PAGE_SIZE && (
          <div className="px-5 py-3 border-t border-neutral-200 dark:border-neutral-800 flex items-center justify-between text-xs text-neutral-500">
            <span>
              Showing {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, historySessions.length)} of{' '}
              {historySessions.length} records
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={safePage === 0}
                className="p-1.5 rounded-md border border-neutral-200 dark:border-neutral-700 disabled:opacity-40"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="px-2 font-mono">
                {safePage + 1} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={safePage >= totalPages - 1}
                className="p-1.5 rounded-md border border-neutral-200 dark:border-neutral-700 disabled:opacity-40"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Confirm Single Delete Modal */}
      <Modal
        isOpen={!!pendingDeleteId}
        onClose={() => setPendingDeleteId(null)}
        title="Delete History Record"
        description="Remove this session from your transfer database?"
      >
        <div className="space-y-4 text-xs">
          <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span>Safe removal: Your actual received files and folders on disk will remain untouched.</span>
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setPendingDeleteId(null)}
              className="px-3 py-1.5 rounded-lg text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              Cancel
            </button>
            <button
              onClick={async () => {
                if (pendingDeleteId) {
                  await deleteHistoryEntry(pendingDeleteId);
                }
                setPendingDeleteId(null);
              }}
              className="px-4 py-1.5 rounded-lg bg-rose-600 text-white hover:bg-rose-500 font-medium"
            >
              Delete Entry
            </button>
          </div>
        </div>
      </Modal>

      {/* Confirm Clear All Modal */}
      <Modal
        isOpen={confirmClearOpen}
        onClose={() => setConfirmClearOpen(false)}
        title="Clear All Transfer History"
        description="This removes all logged transfer metadata from SQLite."
      >
        <div className="space-y-4 text-xs">
          <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span>Non-destructive cleanup: Received files and folders in your Downloads directory will NOT be deleted.</span>
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setConfirmClearOpen(false)}
              className="px-3 py-1.5 rounded-lg text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              Cancel
            </button>
            <button
              onClick={async () => {
                await clearAllHistory();
                setConfirmClearOpen(false);
              }}
              className="px-4 py-1.5 rounded-lg bg-rose-600 text-white hover:bg-rose-500 font-medium"
            >
              Clear All Logs
            </button>
          </div>
        </div>
      </Modal>

      <TransferDetailsModal />
    </div>
  );
};
