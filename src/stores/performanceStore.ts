import { create } from 'zustand';
import { tauriBridge } from '../services/tauriBridge';
import type {
  DiskThroughputMetrics,
  NetworkQualityEvent,
  NetworkThroughputMetrics,
  ThroughputHistoryPoint,
  TransferOptimizationSettings,
  TransferPerformanceMetrics,
  TransferQueueMetrics,
  TransferRecoveryStatus,
  TransferResourceUsage,
} from '../types/performance';

const MAX_GRAPH_POINTS = 60;

interface PerformanceStoreState {
  performanceMetrics: TransferPerformanceMetrics | null;
  networkThroughput: NetworkThroughputMetrics | null;
  diskThroughput: DiskThroughputMetrics | null;
  optimizationSettings: TransferOptimizationSettings;
  queueMetrics: TransferQueueMetrics | null;
  resourceUsage: TransferResourceUsage | null;
  recoveryStatus: TransferRecoveryStatus | null;
  networkQuality: NetworkQualityEvent | null;
  historyPoints: ThroughputHistoryPoint[];
  graphPaused: boolean;
  isSavingSettings: boolean;
  settingsSavedAt: number | null;
  initialized: boolean;

  init: () => Promise<void>;
  refreshAll: () => Promise<void>;
  updateSettings: (next: Partial<TransferOptimizationSettings>) => Promise<void>;
  optimizeQueue: () => Promise<void>;
  toggleGraphPaused: () => void;
  clearGraphHistory: () => void;
}

const DEFAULT_SETTINGS: TransferOptimizationSettings = {
  maxConcurrentTransfers: 3,
  maxConcurrentFileOps: 4,
  maxConcurrentConnections: 8,
  maxConcurrentChunkOps: 4,
  adaptiveChunkingEnabled: true,
  defaultChunkSizeKb: 256,
  performanceGraphEnabled: true,
  autoRetryEnabled: true,
  maxRetries: 3,
  defaultPriority: 'normal',
  continueInBackground: true,
};

export const usePerformanceStore = create<PerformanceStoreState>((set, get) => ({
  performanceMetrics: null,
  networkThroughput: null,
  diskThroughput: null,
  optimizationSettings: DEFAULT_SETTINGS,
  queueMetrics: null,
  resourceUsage: null,
  recoveryStatus: null,
  networkQuality: null,
  historyPoints: [],
  graphPaused: false,
  isSavingSettings: false,
  settingsSavedAt: null,
  initialized: false,

  init: async () => {
    if (get().initialized) return;
    set({ initialized: true });
    await get().refreshAll();

    await tauriBridge.subscribeEvent<TransferPerformanceMetrics>(
      'transfer_performance_update',
      (metrics) => {
        set({ performanceMetrics: metrics });
      }
    );

    await tauriBridge.subscribeEvent<NetworkThroughputMetrics>(
      'network_throughput_update',
      (net) => {
        set((state) => {
          let nextHist = state.historyPoints;
          if (!state.graphPaused && state.optimizationSettings.performanceGraphEnabled) {
            if (net.history && net.history.length > 0) {
              nextHist = net.history.slice(-MAX_GRAPH_POINTS);
            } else {
              const pt: ThroughputHistoryPoint = {
                timestamp: Date.now(),
                uploadBps: net.uploadBps,
                downloadBps: net.downloadBps,
                diskWriteBps: state.diskThroughput?.writeBps ?? 0,
              };
              nextHist = [...state.historyPoints, pt].slice(-MAX_GRAPH_POINTS);
            }
          }
          return {
            networkThroughput: net,
            historyPoints: nextHist,
          };
        });
      }
    );

    await tauriBridge.subscribeEvent<TransferQueueMetrics>('transfer_queue_update', (qm) => {
      set({ queueMetrics: qm });
    });

    await tauriBridge.subscribeEvent<TransferRecoveryStatus>('transfer_recovery_update', (rec) => {
      set({ recoveryStatus: rec });
    });

    await tauriBridge.subscribeEvent<NetworkQualityEvent>('network_quality_update', (nq) => {
      set({ networkQuality: nq });
    });
  },

  refreshAll: async () => {
    const [perf, net, disk, opt, qm, res, rec] = await Promise.all([
      tauriBridge.getTransferPerformanceMetrics(),
      tauriBridge.getNetworkThroughput(),
      tauriBridge.getDiskThroughput(),
      tauriBridge.getTransferOptimizationSettings(),
      tauriBridge.getTransferQueueMetrics(),
      tauriBridge.getTransferResourceUsage(),
      tauriBridge.getTransferRecoveryStatus(),
    ]);

    set((state) => ({
      performanceMetrics: perf,
      networkThroughput: net,
      diskThroughput: disk,
      optimizationSettings: opt,
      queueMetrics: qm,
      resourceUsage: res,
      recoveryStatus: rec,
      historyPoints:
        !state.graphPaused && net.history.length > 0
          ? net.history.slice(-MAX_GRAPH_POINTS)
          : state.historyPoints,
    }));
  },

  updateSettings: async (partial) => {
    set({ isSavingSettings: true });
    try {
      const merged: TransferOptimizationSettings = {
        ...get().optimizationSettings,
        ...partial,
      };
      const saved = await tauriBridge.updateTransferOptimizationSettings(merged);
      set({
        optimizationSettings: saved,
        isSavingSettings: false,
        settingsSavedAt: Date.now(),
      });
      await get().refreshAll();
    } catch {
      set({ isSavingSettings: false });
    }
  },

  optimizeQueue: async () => {
    await tauriBridge.optimizeTransferQueue();
    await get().refreshAll();
  },

  toggleGraphPaused: () => {
    set((state) => ({ graphPaused: !state.graphPaused }));
  },

  clearGraphHistory: () => {
    set({ historyPoints: [] });
  },
}));
