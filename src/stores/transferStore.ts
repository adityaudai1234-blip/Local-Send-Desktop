import { create } from 'zustand';
import {
  FileTransferItem,
  IncomingTransferProposal,
  SelectedFileItem,
  TransferOverviewStats,
  TransferProgressPayload,
  TransferSession,
} from '../types/transfer';
import { DiscoveredDevice, Platform } from '../types/device';
import { TrustedDevice } from '../types/pairing';
import { tauriBridge } from '../services/tauriBridge';

export interface TransferNotification {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
}

interface TransferStoreState {
  transfers: FileTransferItem[];
  selectedFiles: SelectedFileItem[];
  activeIncomingProposal: IncomingTransferProposal | null;
  selectedTransferDetails: TransferSession | null;
  downloadDirectory: string;
  overviewStats: TransferOverviewStats;
  notification: TransferNotification | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  init: () => Promise<void>;
  addFiles: (files: File[] | FileList) => Promise<void>;
  addFilePath: (path: string) => Promise<void>;
  removeSelectedFile: (fileId: string) => Promise<void>;
  clearSelectedFiles: () => Promise<void>;
  startTransferToDevice: (device: Partial<DiscoveredDevice> & { id: string; name: string; ipAddress?: string; port?: number; platform?: Platform }) => Promise<TransferSession | null>;
  startTransferToDevices: (devices: (Partial<DiscoveredDevice> & { id: string; name: string; ipAddress?: string; port?: number; platform?: Platform })[]) => Promise<void>;
  acceptIncomingTransfer: (transferId: string) => Promise<void>;
  rejectIncomingTransfer: (transferId: string, reason?: string) => Promise<void>;
  pauseTransfer: (id: string) => Promise<void>;
  resumeTransfer: (id: string) => Promise<void>;
  cancelTransfer: (id: string) => Promise<void>;
  cancelAllTransfers: () => Promise<void>;
  clearHistory: () => void;
  setSelectedTransferDetails: (details: TransferSession | null) => void;
  simulateIncomingProposal: () => void;
  setDownloadDirectory: (path: string) => Promise<void>;
  showNotification: (type: TransferNotification['type'], title: string, message: string) => void;
  clearNotification: () => void;
  clearError: () => void;
  // Legacy compatibility for test enqueues
  addTransfer: (item: Omit<FileTransferItem, 'id' | 'startedAt' | 'progress' | 'bytesTransferred'>) => void;
}

const STORAGE_TRANSFERS_KEY = 'beamdrop_transfers_history';

const sampleInitialTransfers: FileTransferItem[] = [
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
    filesCount: 1,
    etaSeconds: 6,
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
    filesCount: 1,
    verified: true,
    checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  },
];

export const useTransferStore = create<TransferStoreState>((set, get) => {
  const initialTransfers = (() => {
    if (typeof window === 'undefined') return sampleInitialTransfers;
    const stored = localStorage.getItem(STORAGE_TRANSFERS_KEY);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        // fallback
      }
    }
    return sampleInitialTransfers;
  })();

  const calculateStats = (items: FileTransferItem[]): TransferOverviewStats => {
    const active = items.filter(t => t.status === 'transferring' || t.status === 'queued' || t.status === 'paused' || t.status === 'waiting_for_approval');
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
    selectedFiles: [],
    activeIncomingProposal: null,
    selectedTransferDetails: null,
    downloadDirectory: '~/Downloads/BeamDrop',
    overviewStats: calculateStats(initialTransfers),
    notification: null,
    isLoading: false,
    error: null,

    init: async () => {
      try {
        const [dir, files] = await Promise.all([
          tauriBridge.getDownloadDirectory(),
          tauriBridge.getSelectedFiles(),
        ]);
        set({ downloadDirectory: dir, selectedFiles: files });

        // Event: transfer-progress
        await tauriBridge.subscribeEvent<TransferProgressPayload>('transfer-progress', (event) => {
          set((state) => {
            const updated = state.transfers.map((t) => {
              if (t.id === event.transferId) {
                return {
                  ...t,
                  progress: event.percentage,
                  bytesTransferred: event.bytesTransferred,
                  speed: event.speedBytesPerSec,
                  etaSeconds: event.estimatedSecondsRemaining,
                  status: event.status,
                };
              }
              return t;
            });
            return {
              transfers: updated,
              overviewStats: calculateStats(updated),
            };
          });
        });

        // Event: transfer-completed
        await tauriBridge.subscribeEvent<TransferSession>('transfer-completed', (session) => {
          set((state) => {
            const exists = state.transfers.some(t => t.id === session.transferId);
            let updated: FileTransferItem[];
            if (exists) {
              updated = state.transfers.map(t =>
                t.id === session.transferId
                  ? {
                      ...t,
                      status: 'completed',
                      progress: 100,
                      bytesTransferred: session.totalBytes,
                      speed: 0,
                      completedAt: Date.now(),
                      verified: true,
                    }
                  : t
              );
            } else {
              const newItem: FileTransferItem = {
                id: session.transferId,
                name: session.files[0]?.name || 'Transfer batch',
                size: session.totalBytes,
                mimeType: session.files[0]?.mimeType || 'application/octet-stream',
                progress: 100,
                bytesTransferred: session.totalBytes,
                speed: 0,
                direction: session.direction,
                status: 'completed',
                peerDevice: {
                  name: session.direction === 'outgoing' ? session.recipientDeviceName : session.senderDeviceName,
                  platform: session.direction === 'outgoing' ? 'android' : (session.senderPlatform as Platform),
                  ipAddress: session.direction === 'outgoing' ? session.recipientIp : undefined,
                },
                startedAt: session.startedAt,
                completedAt: Date.now(),
                filesCount: session.files.length,
                verified: true,
              };
              updated = [newItem, ...state.transfers];
            }

            localStorage.setItem(STORAGE_TRANSFERS_KEY, JSON.stringify(updated));
            return {
              transfers: updated,
              overviewStats: calculateStats(updated),
            };
          });

          get().showNotification(
            'success',
            'Transfer Complete',
            `Successfully transferred ${session.files[0]?.name || 'files'} (${Math.round(session.totalBytes / 1024 / 1024)} MB).`
          );
        });

        // Event: transfer-failed
        await tauriBridge.subscribeEvent<{ transferId: string; error: string }>('transfer-failed', (payload) => {
          set((state) => {
            const updated = state.transfers.map(t =>
              t.id === payload.transferId
                ? { ...t, status: 'failed' as const, errorMessage: payload.error, speed: 0 }
                : t
            );
            return { transfers: updated, overviewStats: calculateStats(updated) };
          });
          get().showNotification('error', 'Transfer Failed', payload.error);
        });

        // Event: transfer-cancelled
        await tauriBridge.subscribeEvent<TransferSession>('transfer-cancelled', (session) => {
          set((state) => {
            const updated = state.transfers.map(t =>
              t.id === session.transferId
                ? { ...t, status: 'cancelled' as const, speed: 0 }
                : t
            );
            return { transfers: updated, overviewStats: calculateStats(updated) };
          });
          get().showNotification('warning', 'Transfer Cancelled', 'Transfer was cancelled by peer or local user.');
        });

        // Event: incoming-transfer-request
        await tauriBridge.subscribeEvent<IncomingTransferProposal>('incoming-transfer-request', (proposal) => {
          set({ activeIncomingProposal: proposal });
          get().showNotification(
            'info',
            'Incoming File Transfer',
            `${proposal.senderDeviceName} wants to send ${proposal.fileCount} file(s) (${Math.round(proposal.totalBytes / 1024 / 1024)} MB).`
          );
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        set({ error: msg });
      }
    },

    addFiles: async (fileList: File[] | FileList) => {
      const filesArray = Array.from(fileList);
      for (const f of filesArray) {
        await tauriBridge.addMockFile({
          name: f.name,
          size: f.size,
          mimeType: f.type || 'application/octet-stream',
          path: (f as { path?: string }).path || `~/Downloads/${f.name}`,
        });
      }
      const updated = await tauriBridge.getSelectedFiles();
      set({ selectedFiles: updated });
    },

    addFilePath: async (path: string) => {
      const updated = await tauriBridge.selectFiles([path]);
      set({ selectedFiles: updated });
    },

    removeSelectedFile: async (fileId: string) => {
      const updated = await tauriBridge.removeSelectedFile(fileId);
      set({ selectedFiles: updated });
    },

    clearSelectedFiles: async () => {
      await tauriBridge.clearSelectedFiles();
      set({ selectedFiles: [] });
    },

    startTransferToDevice: async (device) => {
      const { selectedFiles } = get();
      if (selectedFiles.length === 0) {
        get().showNotification('warning', 'No Files Selected', 'Please drop or choose files first.');
        return null;
      }

      set({ isLoading: true });
      try {
        const session = await tauriBridge.startFileTransfer({
          recipientId: device.id,
          recipientName: device.name,
          recipientIp: device.ipAddress || '127.0.0.1',
          recipientPort: device.port || 53317,
          fileIds: selectedFiles.map(f => f.id),
        });

        // Add to transfer items
        const newItem: FileTransferItem = {
          id: session.transferId,
          name: session.files[0]?.name || `${selectedFiles.length} files`,
          size: session.totalBytes,
          mimeType: session.files[0]?.mimeType || 'application/octet-stream',
          progress: 0,
          bytesTransferred: 0,
          speed: 0,
          direction: 'outgoing',
          status: 'transferring',
          peerDevice: {
            name: device.name,
            platform: device.platform || 'android',
            ipAddress: device.ipAddress,
          },
          startedAt: Date.now(),
          filesCount: session.files.length,
        };

        const updated = [newItem, ...get().transfers];
        set({
          transfers: updated,
          overviewStats: calculateStats(updated),
          selectedFiles: [],
          isLoading: false,
        });

        localStorage.setItem(STORAGE_TRANSFERS_KEY, JSON.stringify(updated));

        get().showNotification(
          'info',
          'Transfer Started',
          `Beaming ${newItem.name} to ${device.name}...`
        );

        return session;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        set({ error: msg, isLoading: false });
        get().showNotification('error', 'Transfer Failed', msg);
        return null;
      }
    },

    startTransferToDevices: async (devices) => {
      for (const dev of devices) {
        await get().startTransferToDevice(dev);
      }
    },

    acceptIncomingTransfer: async (transferId: string) => {
      try {
        const session = await tauriBridge.acceptTransfer(transferId);
        set({ activeIncomingProposal: null });

        const newItem: FileTransferItem = {
          id: session.transferId,
          name: session.files[0]?.name || 'Received files',
          size: session.totalBytes,
          mimeType: session.files[0]?.mimeType || 'application/octet-stream',
          progress: 100,
          bytesTransferred: session.totalBytes,
          speed: 0,
          direction: 'incoming',
          status: 'completed',
          peerDevice: {
            name: session.senderDeviceName,
            platform: session.senderPlatform as Platform,
            ipAddress: session.recipientIp,
          },
          startedAt: session.startedAt,
          completedAt: Date.now(),
          filesCount: session.files.length,
          verified: true,
        };

        const updated = [newItem, ...get().transfers];
        set({
          transfers: updated,
          overviewStats: calculateStats(updated),
        });
        localStorage.setItem(STORAGE_TRANSFERS_KEY, JSON.stringify(updated));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        set({ error: msg });
      }
    },

    rejectIncomingTransfer: async (transferId: string, reason?: string) => {
      await tauriBridge.rejectTransfer(transferId, reason);
      set({ activeIncomingProposal: null });
      get().showNotification('info', 'Transfer Declined', 'Declined incoming transfer request.');
    },

    pauseTransfer: async (id: string) => {
      await tauriBridge.pauseTransfer(id);
      const updated = get().transfers.map(t => (t.id === id ? { ...t, status: 'paused' as const, speed: 0 } : t));
      set({ transfers: updated, overviewStats: calculateStats(updated) });
      localStorage.setItem(STORAGE_TRANSFERS_KEY, JSON.stringify(updated));
    },

    resumeTransfer: async (id: string) => {
      await tauriBridge.resumeTransfer(id);
      const updated = get().transfers.map(t => (t.id === id ? { ...t, status: 'transferring' as const, speed: 12400000 } : t));
      set({ transfers: updated, overviewStats: calculateStats(updated) });
      localStorage.setItem(STORAGE_TRANSFERS_KEY, JSON.stringify(updated));
    },

    cancelTransfer: async (id: string) => {
      await tauriBridge.cancelTransfer(id);
      const updated = get().transfers.map(t => (t.id === id ? { ...t, status: 'cancelled' as const, speed: 0 } : t));
      set({ transfers: updated, overviewStats: calculateStats(updated) });
      localStorage.setItem(STORAGE_TRANSFERS_KEY, JSON.stringify(updated));
    },

    cancelAllTransfers: async () => {
      await tauriBridge.cancelTransferBatch();
      const updated = get().transfers.map(t =>
        t.status === 'transferring' || t.status === 'paused' || t.status === 'waiting_for_approval'
          ? { ...t, status: 'cancelled' as const, speed: 0 }
          : t
      );
      set({ transfers: updated, overviewStats: calculateStats(updated) });
      localStorage.setItem(STORAGE_TRANSFERS_KEY, JSON.stringify(updated));
    },

    clearHistory: () => {
      const activeOnly = get().transfers.filter(t => t.status === 'transferring' || t.status === 'queued' || t.status === 'paused');
      set({ transfers: activeOnly, overviewStats: calculateStats(activeOnly) });
      localStorage.setItem(STORAGE_TRANSFERS_KEY, JSON.stringify(activeOnly));
    },

    setSelectedTransferDetails: (details) => {
      set({ selectedTransferDetails: details });
    },

    simulateIncomingProposal: () => {
      tauriBridge.simulateIncomingTransferRequest();
    },

    setDownloadDirectory: async (path: string) => {
      const updated = await tauriBridge.setDownloadDirectory(path);
      set({ downloadDirectory: updated });
    },

    showNotification: (type, title, message) => {
      const notif: TransferNotification = {
        id: Math.random().toString(36).substring(2, 9),
        type,
        title,
        message,
      };
      set({ notification: notif });
      setTimeout(() => {
        if (get().notification?.id === notif.id) {
          set({ notification: null });
        }
      }, 5000);
    },

    clearNotification: () => {
      set({ notification: null });
    },

    clearError: () => {
      set({ error: null });
    },

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
  };
});
