import React from 'react';
import { ArrowLeftRight, CheckCircle, Upload, HardDrive } from 'lucide-react';
import { useTransferStore } from '../../stores/transferStore';
import { formatBytes } from '../../utils/formatters';

export const TransferOverview: React.FC = () => {
  const { overviewStats } = useTransferStore();

  const metrics = [
    {
      label: 'Active Transfers',
      value: overviewStats.activeCount.toString(),
      icon: ArrowLeftRight,
      subtext: 'In queue or transmitting',
      badgeColor: 'text-cyan-500',
    },
    {
      label: 'Completed Transfers',
      value: overviewStats.completedCount.toString(),
      icon: CheckCircle,
      subtext: 'Verified file integrity',
      badgeColor: 'text-emerald-500',
    },
    {
      label: 'Total Files Sent',
      value: overviewStats.totalFilesSent.toString(),
      icon: Upload,
      subtext: 'To local peers',
      badgeColor: 'text-indigo-500',
    },
    {
      label: 'Total Data Transferred',
      value: formatBytes(overviewStats.totalBytesTransferred),
      icon: HardDrive,
      subtext: 'Across local network',
      badgeColor: 'text-amber-500',
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
          Transfer Overview
        </h3>
        <span className="text-[11px] text-neutral-400">
          Design preview metrics
        </span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {metrics.map((metric, i) => {
          const Icon = metric.icon;
          return (
            <div
              key={i}
              className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-neutral-500 dark:text-neutral-400">
                  {metric.label}
                </span>
                <Icon className={`w-4 h-4 ${metric.badgeColor}`} />
              </div>

              {/* Tabular numbers */}
              <div className="text-xl font-bold font-mono tabular-nums text-neutral-900 dark:text-white tracking-tight">
                {metric.value}
              </div>

              <div className="text-[11px] text-neutral-400 dark:text-neutral-500 mt-1 truncate">
                {metric.subtext}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
