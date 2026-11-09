import React, { useEffect } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  HardDrive,
  Power,
  RefreshCw,
  Server,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useConnectionStore } from '../../stores/connectionStore';
import { formatBytes } from '../../utils/formatters';
import { PeerConnection } from '../../types/networking';

export interface NetworkStatusCardProps {
  onOpenDetails?: (conn: PeerConnection) => void;
}

export const NetworkStatusCard: React.FC<NetworkStatusCardProps> = ({ onOpenDetails }) => {
  const { networkInfo, networkStats, toggleNetworkService, refreshStats } = useConnectionStore();

  useEffect(() => {
    const interval = setInterval(() => {
      refreshStats();
    }, 3000);
    return () => clearInterval(interval);
  }, [refreshStats]);

  const isRunning = networkInfo?.serviceRunning ?? true;

  const formatUptime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hrs > 0) return `${hrs}h ${mins}m`;
    return `${mins}m ${secs}s`;
  };

  return (
    <div className="p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60 transition-all shadow-xs space-y-4">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-lg flex items-center justify-center ${
              isRunning
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-400 border border-neutral-200 dark:border-neutral-700'
            }`}
          >
            {isRunning ? <Wifi className="w-5 h-5" /> : <WifiOff className="w-5 h-5" />}
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
                Network Communications Service
              </h3>
              <span
                className={`flex items-center gap-1 text-[11px] font-medium ${
                  isRunning ? 'text-emerald-600 dark:text-emerald-400' : 'text-neutral-400'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${isRunning ? 'bg-emerald-500' : 'bg-neutral-400'}`} />
                {isRunning ? 'Listening (Port 53317)' : 'Service Suspended'}
              </span>
            </div>

            <p className="text-xs text-neutral-500 mt-0.5">
              Bidirectional peer-to-peer TCP daemon with AES-256-GCM authenticated encryption.
            </p>
          </div>
        </div>

        {/* Start / Stop Toggle */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={toggleNetworkService}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              isRunning
                ? 'border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700'
                : 'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700'
            }`}
          >
            <Power className="w-3.5 h-3.5" />
            <span>{isRunning ? 'Stop Service' : 'Start Service'}</span>
          </button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-neutral-100 dark:border-neutral-800/80 text-xs">
        {/* Active Connections */}
        <div className="p-3 rounded-lg bg-neutral-50 dark:bg-neutral-800/40 border border-neutral-200/50 dark:border-neutral-700/50">
          <div className="flex items-center justify-between text-neutral-500 mb-1">
            <span>Active Peers</span>
            <Activity className="w-3.5 h-3.5 text-cyan-500" />
          </div>
          <div className="font-mono font-bold text-base tabular-nums text-neutral-900 dark:text-white">
            {networkInfo?.activeConnections ?? 0}
          </div>
          <span className="text-[10px] text-neutral-400">Authenticated sessions</span>
        </div>

        {/* Local Binding IP */}
        <div className="p-3 rounded-lg bg-neutral-50 dark:bg-neutral-800/40 border border-neutral-200/50 dark:border-neutral-700/50">
          <div className="flex items-center justify-between text-neutral-500 mb-1">
            <span>Local Interface</span>
            <Server className="w-3.5 h-3.5 text-indigo-500" />
          </div>
          <div className="font-mono font-semibold text-xs text-neutral-900 dark:text-white truncate">
            {networkInfo?.localIp || '127.0.0.1'}
          </div>
          <span className="text-[10px] text-neutral-400">Socket Port 53317</span>
        </div>

        {/* Transmitted Data */}
        <div className="p-3 rounded-lg bg-neutral-50 dark:bg-neutral-800/40 border border-neutral-200/50 dark:border-neutral-700/50">
          <div className="flex items-center justify-between text-neutral-500 mb-1">
            <span>LAN Sent (Tx)</span>
            <ArrowUpRight className="w-3.5 h-3.5 text-cyan-500" />
          </div>
          <div className="font-mono font-bold text-xs tabular-nums text-neutral-900 dark:text-white">
            {formatBytes(networkStats?.totalTxBytes ?? 0)}
          </div>
          <span className="text-[10px] text-neutral-400">
            {networkStats?.totalMessagesSent ?? 0} frames dispatched
          </span>
        </div>

        {/* Received Data & Uptime */}
        <div className="p-3 rounded-lg bg-neutral-50 dark:bg-neutral-800/40 border border-neutral-200/50 dark:border-neutral-700/50">
          <div className="flex items-center justify-between text-neutral-500 mb-1">
            <span>LAN Recv (Rx)</span>
            <ArrowDownRight className="w-3.5 h-3.5 text-emerald-500" />
          </div>
          <div className="font-mono font-bold text-xs tabular-nums text-neutral-900 dark:text-white">
            {formatBytes(networkStats?.totalRxBytes ?? 0)}
          </div>
          <span className="text-[10px] text-neutral-400">
            Uptime: {formatUptime(networkStats?.uptimeSeconds ?? 0)}
          </span>
        </div>
      </div>
    </div>
  );
};
