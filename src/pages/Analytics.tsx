import React, { useEffect } from 'react';
import {
  BarChart3,
  ArrowUpRight,
  ArrowDownLeft,
  Gauge,
  CheckCircle2,
  FileArchive,
  Laptop,
} from 'lucide-react';
import { useTransferStore } from '../stores/transferStore';
import { formatBytes, formatSpeed } from '../utils/formatters';

export const Analytics: React.FC = () => {
  const { statistics, statsTimeFrame, loadStatistics } = useTransferStore();

  useEffect(() => {
    loadStatistics(statsTimeFrame);
  }, [loadStatistics, statsTimeFrame]);

  const timeFrames: { id: 'today' | '7d' | '30d' | 'all'; label: string }[] = [
    { id: 'today', label: 'Today' },
    { id: '7d', label: 'Last 7 Days' },
    { id: '30d', label: 'Last 30 Days' },
    { id: 'all', label: 'All Time' },
  ];

  const sentBytes = statistics?.totalBytesSent || 0;
  const recvBytes = statistics?.totalBytesReceived || 0;
  const totalBytes = sentBytes + recvBytes;
  const sentRatio = totalBytes > 0 ? Math.round((sentBytes / totalBytes) * 100) : 50;
  const recvRatio = totalBytes > 0 ? 100 - sentRatio : 50;

  const successCount = statistics?.successfulTransfersCount || 0;
  const failedCount = statistics?.failedTransfersCount || 0;
  const successRate = statistics?.successRatePercentage ?? 100;

  const dailyVolume = statistics?.dailyVolume || [];
  const maxDailyBytes = Math.max(
    1,
    ...dailyVolume.map((d) => d.sentBytes + d.receivedBytes)
  );

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Header & Time Filter */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-white flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-cyan-500" />
            <span>Transfer Analytics &amp; Insights</span>
          </h2>
          <p className="text-xs text-neutral-500">
            Computed directly from persisted local transfer sessions. Zero cloud telemetry.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-neutral-100 dark:bg-neutral-900 rounded-lg border border-neutral-200/60 dark:border-neutral-800 text-xs">
          {timeFrames.map((tf) => (
            <button
              key={tf.id}
              onClick={() => loadStatistics(tf.id)}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                statsTimeFrame === tf.id
                  ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white shadow-xs'
                  : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60 space-y-2">
          <div className="flex items-center justify-between text-xs text-neutral-500">
            <span>Total Bytes Sent</span>
            <ArrowUpRight className="w-4 h-4 text-cyan-500" />
          </div>
          <p className="text-2xl font-bold font-mono text-neutral-900 dark:text-white">
            {formatBytes(sentBytes)}
          </p>
          <p className="text-[11px] text-neutral-500">
            {statistics?.totalFilesSent || 0} file(s) sent
          </p>
        </div>

        <div className="p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60 space-y-2">
          <div className="flex items-center justify-between text-xs text-neutral-500">
            <span>Total Bytes Received</span>
            <ArrowDownLeft className="w-4 h-4 text-emerald-500" />
          </div>
          <p className="text-2xl font-bold font-mono text-neutral-900 dark:text-white">
            {formatBytes(recvBytes)}
          </p>
          <p className="text-[11px] text-neutral-500">
            {statistics?.totalFilesReceived || 0} file(s) received
          </p>
        </div>

        <div className="p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60 space-y-2">
          <div className="flex items-center justify-between text-xs text-neutral-500">
            <span>Average LAN Speed</span>
            <Gauge className="w-4 h-4 text-purple-500" />
          </div>
          <p className="text-2xl font-bold font-mono text-neutral-900 dark:text-white">
            {formatSpeed(statistics?.averageSpeedBps || 0)}
          </p>
          <p className="text-[11px] text-neutral-500">
            Encrypted direct TCP stream
          </p>
        </div>

        <div className="p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60 space-y-2">
          <div className="flex items-center justify-between text-xs text-neutral-500">
            <span>Transfer Success Rate</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <p className="text-2xl font-bold font-mono text-neutral-900 dark:text-white">
            {successRate.toFixed(1)}%
          </p>
          <p className="text-[11px] text-neutral-500">
            {successCount} succeeded · {failedCount} failed/cancelled
          </p>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Daily Transfer Volume Chart */}
        <div className="lg:col-span-2 p-6 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
                Daily Transfer Volume
              </h3>
              <p className="text-xs text-neutral-500">
                Sent vs. Received bytes grouped by date
              </p>
            </div>
            <div className="flex items-center gap-4 text-[11px] text-neutral-500">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-cyan-500" />
                Sent
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-emerald-500" />
                Received
              </span>
            </div>
          </div>

          {dailyVolume.length === 0 ? (
            <div className="h-44 flex items-center justify-center text-xs text-neutral-400 border border-dashed border-neutral-200 dark:border-neutral-800 rounded-xl">
              No transfers recorded in this time window yet.
            </div>
          ) : (
            <div className="h-48 flex items-end gap-3 pt-4">
              {dailyVolume.map((day) => {
                const sentPct = Math.round((day.sentBytes / maxDailyBytes) * 100);
                const recvPct = Math.round((day.receivedBytes / maxDailyBytes) * 100);
                return (
                  <div key={day.date} className="flex-1 flex flex-col items-center gap-2 min-w-0">
                    <div className="w-full h-36 flex items-end justify-center gap-1.5 px-1">
                      <div
                        className="w-full max-w-[20px] rounded-t-md bg-cyan-500/85 transition-all"
                        style={{ height: `${Math.max(day.sentBytes > 0 ? 8 : 2, sentPct)}%` }}
                        title={`Sent: ${formatBytes(day.sentBytes)}`}
                      />
                      <div
                        className="w-full max-w-[20px] rounded-t-md bg-emerald-500/85 transition-all"
                        style={{ height: `${Math.max(day.receivedBytes > 0 ? 8 : 2, recvPct)}%` }}
                        title={`Received: ${formatBytes(day.receivedBytes)}`}
                      />
                    </div>
                    <div className="text-center">
                      <span className="text-[10px] font-mono text-neutral-500 block truncate">
                        {day.date.slice(5)}
                      </span>
                      <span className="text-[10px] text-neutral-400">{day.count} tx</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Direction Split & Largest File */}
        <div className="space-y-6">
          <div className="p-5 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60 space-y-4">
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
              Sent vs Received Ratio
            </h3>

            <div className="w-full h-3 rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden flex">
              <div className="h-full bg-cyan-500" style={{ width: `${sentRatio}%` }} />
              <div className="h-full bg-emerald-500" style={{ width: `${recvRatio}%` }} />
            </div>

            <div className="flex items-center justify-between text-xs">
              <div>
                <span className="text-neutral-500 block">Sent</span>
                <span className="font-mono font-bold text-cyan-600 dark:text-cyan-400">
                  {sentRatio}% ({formatBytes(sentBytes)})
                </span>
              </div>
              <div className="text-right">
                <span className="text-neutral-500 block">Received</span>
                <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                  {recvRatio}% ({formatBytes(recvBytes)})
                </span>
              </div>
            </div>
          </div>

          <div className="p-5 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60 space-y-3">
            <div className="flex items-center gap-2 text-xs text-neutral-500">
              <FileArchive className="w-4 h-4 text-amber-500" />
              <span>Largest File Transferred</span>
            </div>
            <p className="text-sm font-semibold text-neutral-900 dark:text-white truncate">
              {statistics?.largestFileName || 'None'}
            </p>
            <p className="text-lg font-bold font-mono text-neutral-900 dark:text-white">
              {formatBytes(statistics?.largestFileSize || 0)}
            </p>
          </div>
        </div>
      </div>

      {/* Top Peer Devices Table */}
      <div className="p-6 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
              Most Frequently Connected Peer Devices
            </h3>
            <p className="text-xs text-neutral-500">
              Ranked by transfer session frequency and total local bandwidth exchanged
            </p>
          </div>
        </div>

        {!statistics || statistics.topDevices.length === 0 ? (
          <p className="text-xs text-neutral-400 py-4 text-center">
            No peer transfer records available in this window.
          </p>
        ) : (
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {statistics.topDevices.map((dev, idx) => (
              <div
                key={dev.deviceName}
                className="py-3 flex items-center justify-between text-xs"
              >
                <div className="flex items-center gap-3">
                  <span className="w-6 h-6 rounded-md bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center font-mono text-neutral-600 dark:text-neutral-300">
                    #{idx + 1}
                  </span>
                  <Laptop className="w-4 h-4 text-neutral-400" />
                  <span className="font-medium text-neutral-900 dark:text-white">
                    {dev.deviceName}
                  </span>
                </div>

                <div className="flex items-center gap-6 font-mono">
                  <span className="text-neutral-500">{dev.transferCount} session(s)</span>
                  <span className="font-semibold text-neutral-900 dark:text-white">
                    {formatBytes(dev.totalBytes)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
