import React, { useState } from 'react';
import {
  Clock,
  ArrowUpRight,
  ArrowDownLeft,
  File,
  Trash2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from 'lucide-react';
import { useTransferStore } from '../stores/transferStore';
import { formatBytes, formatDateTime } from '../utils/formatters';

export const History: React.FC = () => {
  const { transfers, clearHistory } = useTransferStore();
  const [directionFilter, setDirectionFilter] = useState<'all' | 'outgoing' | 'incoming'>('all');

  const historyItems = transfers.filter((t) => {
    if (directionFilter === 'outgoing') return t.direction === 'outgoing';
    if (directionFilter === 'incoming') return t.direction === 'incoming';
    return true;
  });

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-white">
            Transfer History
          </h2>
          <p className="text-xs text-neutral-500">
            Log of completed and past local network transfers.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Direction Filter */}
          <div className="flex items-center gap-1 p-1 bg-neutral-100 dark:bg-neutral-900 rounded-lg border border-neutral-200/60 dark:border-neutral-800">
            <button
              onClick={() => setDirectionFilter('all')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                directionFilter === 'all'
                  ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white shadow-xs'
                  : 'text-neutral-600 dark:text-neutral-400'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setDirectionFilter('outgoing')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                directionFilter === 'outgoing'
                  ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white shadow-xs'
                  : 'text-neutral-600 dark:text-neutral-400'
              }`}
            >
              Sent
            </button>
            <button
              onClick={() => setDirectionFilter('incoming')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                directionFilter === 'incoming'
                  ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white shadow-xs'
                  : 'text-neutral-600 dark:text-neutral-400'
              }`}
            >
              Received
            </button>
          </div>

          <button
            onClick={clearHistory}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors border border-transparent hover:border-rose-200 dark:hover:border-rose-900"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear Log</span>
          </button>
        </div>
      </div>

      {/* History Table */}
      <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-neutral-50 dark:bg-neutral-950/60 border-b border-neutral-200 dark:border-neutral-800 text-neutral-500 font-medium select-none">
              <tr>
                <th className="px-5 py-3">File Name</th>
                <th className="px-4 py-3">Device Name</th>
                <th className="px-4 py-3">Direction</th>
                <th className="px-4 py-3 text-right">File Size</th>
                <th className="px-4 py-3">Date & Time</th>
                <th className="px-5 py-3 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800/80">
              {historyItems.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-neutral-400">
                    <Clock className="w-7 h-7 mx-auto mb-2 text-neutral-400/80" />
                    <p className="font-medium text-neutral-600 dark:text-neutral-300">No transfer records found</p>
                    <p className="text-[11px] text-neutral-400 mt-0.5">Files transferred to or from nearby devices will be logged here.</p>
                  </td>
                </tr>
              ) : (
                historyItems.map((item) => {
                  const isOutgoing = item.direction === 'outgoing';
                  return (
                    <tr
                      key={item.id}
                      className="hover:bg-neutral-50/70 dark:hover:bg-neutral-800/40 transition-colors"
                    >
                      {/* File Name */}
                      <td className="px-5 py-3.5 font-medium text-neutral-900 dark:text-white">
                        <div className="flex items-center gap-2.5">
                          <File className="w-4 h-4 text-neutral-400 shrink-0" />
                          <span className="truncate max-w-[240px]">{item.name}</span>
                        </div>
                      </td>

                      {/* Device Name */}
                      <td className="px-4 py-3.5 text-neutral-700 dark:text-neutral-300">
                        <span className="font-medium">{item.peerDevice.name}</span>
                        {item.peerDevice.ipAddress && (
                          <span className="block text-[11px] font-mono text-neutral-400">
                            {item.peerDevice.ipAddress}
                          </span>
                        )}
                      </td>

                      {/* Transfer Direction */}
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

                      {/* File Size */}
                      <td className="px-4 py-3.5 text-right font-mono tabular-nums text-neutral-700 dark:text-neutral-300">
                        {formatBytes(item.size)}
                      </td>

                      {/* Date & Time */}
                      <td className="px-4 py-3.5 text-neutral-500">
                        {formatDateTime(item.startedAt)}
                      </td>

                      {/* Transfer Status */}
                      <td className="px-5 py-3.5 text-right">
                        {item.status === 'completed' && (
                          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Completed
                          </span>
                        )}
                        {item.status === 'cancelled' && (
                          <span className="inline-flex items-center gap-1 text-neutral-400 font-medium">
                            <XCircle className="w-3.5 h-3.5" />
                            Cancelled
                          </span>
                        )}
                        {item.status === 'failed' && (
                          <span className="inline-flex items-center gap-1 text-rose-500 font-medium">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            Failed
                          </span>
                        )}
                        {item.status === 'transferring' && (
                          <span className="inline-flex items-center gap-1 text-cyan-500 font-medium">
                            Active ({item.progress}%)
                          </span>
                        )}
                        {item.status === 'paused' && (
                          <span className="inline-flex items-center gap-1 text-amber-500 font-medium">
                            Paused
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
