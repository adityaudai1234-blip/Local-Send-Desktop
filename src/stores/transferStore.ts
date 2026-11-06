import { create } from 'zustand';
import { FileTransferItem, TransferOverviewStats } from '../types/transfer';

interface TransferStoreState {
  transfers: FileTransferItem[];
  overviewStats: TransferOverviewStats;
  
  // Actions
  addTransfer: (item: Omit<FileTransferItem, 'id' | 'startedAt' | 'progress' | 'bytesTransferred'>) => void;
  pauseTransfer: (id: string) => void;
  resumeTransfer: (id: string) => void;
  cancelTransfer: (id: string) => void;
  clearHistory: () => void;
}

const STORAGE_TRANSFERS_KEY = 'beamdrop_transfers_history';

const sampleTransfers: FileTransferItem[] = [
  {
    id: 'tx-preview-01',
    name: 'Family_Vacation_2026.zip',
    size: 428400000,
    mimeType: 'application/zip',
    progress: 74,
    bytesTransferred: 317016000,
    speed: 18450000, // ~18.4 MB/s
    direction: 'outgoing',
    status: 'transferring',
    peerDevice: {
      name: "Aditya's Pixel 8",
      platform: 'android',
      ipAddress: '192.168.1.142',
    },
    startedAt: Date.now() - 25000,
  },
  {
    id: 'tx-preview-02',
    name: 'Architecture_Plan_v3.pdf',
    size: 24500000,
    mimeType: 'application/pdf',
    progress: 100,
    bytesTransferred: 24500000,
    speed: 0,
    direction: 'incoming',
    status: 'completed',
    peerDevice: {
      name: 'Studio Mac M3 Max',
      platform: 'macos',
      ipAddress: '192.168.1.180',
    },
    startedAt: Date.now() - 3600000,
    completedAt: Date.now() - 3590000,
  },
  {
    id: 'tx-preview-03',
    name: 'kernel_build_log.txt',
    size: 890000,
    mimeType: 'text/plain',
    progress: 100,
    bytesTransferred: 890000,
    speed: 0,
    direction: 'outgoing',
    status: 'completed',
    peerDevice: {
      name: 'ThinkPad Workstation',
      platform: 'linux',
      ipAddress: '192.168.1.199',
    },
    startedAt: Date.now() - 7200000,
    completedAt: Date.now() - 7198000,
  },
];

export const useTransferStore = create<TransferStoreState>((set, get) => {
  const initialTransfers = (() => {
    if (typeof window === 'undefined') return sampleTransfers;
    const stored = localStorage.getItem(STORAGE_TRANSFERS_KEY);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        // fallback
      }
    }
    return sampleTransfers;
  })();

  const calculateStats = (items: FileTransferItem[]): TransferOverviewStats => {
    const active = items.filter(t => t.status === 'transferring' || t.status === 'queued' || t.status === 'paused');
    const completed = items.filter(t => t.status === 'completed');
    const sent = items.filter(t => t.direction === 'outgoing' && t.status === 'completed').length;
    const received = items.filter(t => t.direction === 'incoming' && t.status === 'completed').length;
    const totalBytes = completed.reduce((acc, curr) => acc + curr.size, 0);

    return {
      activeCount: active.length,
      completedCount: completed.length,
      totalFilesSent: sent,
      totalFilesReceived: received,
      totalBytesTransferred: totalBytes,
    };
  };

  return {
    transfers: initialTransfers,
    overviewStats: calculateStats(initialTransfers),

    addTransfer: (item) => {
      const newItem: FileTransferItem = {
        ...item,
        id: 'tx-' + Math.random().toString(36).substring(2, 9),
        startedAt: Date.now(),
        progress: 0,
        bytesTransferred: 0,
      };

      const updated = [newItem, ...get().transfers];
      set({
        transfers: updated,
        overviewStats: calculateStats(updated),
      });
      localStorage.setItem(STORAGE_TRANSFERS_KEY, JSON.stringify(updated));
    },

    pauseTransfer: (id) => {
      const updated = get().transfers.map(t => (t.id === id ? { ...t, status: 'paused' as const, speed: 0 } : t));
      set({ transfers: updated, overviewStats: calculateStats(updated) });
      localStorage.setItem(STORAGE_TRANSFERS_KEY, JSON.stringify(updated));
    },

    resumeTransfer: (id) => {
      const updated = get().transfers.map(t => (t.id === id ? { ...t, status: 'transferring' as const, speed: 12400000 } : t));
      set({ transfers: updated, overviewStats: calculateStats(updated) });
      localStorage.setItem(STORAGE_TRANSFERS_KEY, JSON.stringify(updated));
    },

    cancelTransfer: (id) => {
      const updated = get().transfers.map(t => (t.id === id ? { ...t, status: 'cancelled' as const, speed: 0 } : t));
      set({ transfers: updated, overviewStats: calculateStats(updated) });
      localStorage.setItem(STORAGE_TRANSFERS_KEY, JSON.stringify(updated));
    },

    clearHistory: () => {
      const activeOnly = get().transfers.filter(t => t.status === 'transferring' || t.status === 'queued' || t.status === 'paused');
      set({ transfers: activeOnly, overviewStats: calculateStats(activeOnly) });
      localStorage.setItem(STORAGE_TRANSFERS_KEY, JSON.stringify(activeOnly));
    },
  };
});
