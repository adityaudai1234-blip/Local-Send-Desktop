import { create } from 'zustand';
import {
  BackgroundTransferStatus,
  FileTransferItem,
  FolderFileEntry,
  FolderMetadata,
  HistoryFilterOptions,
  IncomingTransferProposal,
  QueueItemInfo,
  RecoverableTransferInfo,
  SelectedFileItem,
  TransferOverviewStats,
  TransferPriority,
  TransferProgressPayload,
  TransferSession,
  TransferStatistics,
} from '../types/transfer';
import { DiscoveredDevice, Platform } from '../types/device';
import { tauriBridge } from '../services/tauriBridge';
import { useSettingsStore } from './settingsStore';

export interface TransferNotification {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
}

export type TargetDeviceInput = Partial<DiscoveredDevice> & {
  id: string;
  name: string;
  ipAddress?: string;
  port?: number;
  platform?: Platform;
};

interface TransferStoreState {
  transfers: FileTransferItem[];
  historySessions: TransferSession[];
  historyFilters: HistoryFilterOptions;
  selectedFiles: SelectedFileItem[];
  selectedFolders: FolderMetadata[];
  selectedPriority: TransferPriority;
  queueItems: QueueItemInfo[];
  statistics: TransferStatistics | null;
  statsTimeFrame: 'today' | '7d' | '30d' | 'all';
  backgroundStatus: BackgroundTransferStatus | null;
  recoverableTransfers: RecoverableTransferInfo[];
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

  // Folder Selection & Transfers
  addFolderFromFileList: (files: FileList | File[]) => Promise<void>;
  addScannedFolder: (folder: FolderMetadata) => Promise<void>;
  addFolderPath: (folderPath: string) => Promise<void>;
  removeSelectedFolder: (rootPath: string) => Promise<void>;
  clearSelectedFolders: () => Promise<void>;
  setSelectedPriority: (priority: TransferPriority) => void;

  startTransferToDevice: (device: TargetDeviceInput) => Promise<TransferSession | null>;
  startTransferToDevices: (devices: TargetDeviceInput[]) => Promise<void>;
  startFolderTransferToDevices: (devices: TargetDeviceInput[]) => Promise<void>;

  acceptIncomingTransfer: (transferId: string) => Promise<void>;
  rejectIncomingTransfer: (transferId: string, reason?: string) => Promise<void>;

  pauseTransfer: (id: string) => Promise<void>;
  resumeTransfer: (id: string) => Promise<void>;
  cancelTransfer: (id: string) => Promise<void>;
  cancelAllTransfers: () => Promise<void>;
  pauseAllTransfers: () => Promise<void>;
  resumeAllTransfers: () => Promise<void>;
  changeTransferPriority: (transferId: string, priority: TransferPriority) => Promise<void>;
  retryTransfer: (transferId: string) => Promise<TransferSession | null>;
  removeTransfer: (transferId: string) => Promise<void>;

  // History & Analytics
  loadHistory: (filters?: Partial<HistoryFilterOptions>) => Promise<void>;
  deleteHistoryEntry: (transferId: string) => Promise<void>;
  clearAllHistory: () => Promise<void>;
  clearHistory: () => void;
  loadStatistics: (timeFrame?: 'today' | '7d' | '30d' | 'all') => Promise<void>;
  loadQueue: () => Promise<void>;
  loadBackgroundStatus: () => Promise<void>;
  loadRecoverableTransfers: () => Promise<void>;
  recoverTransfer: (transferId: string, freshRetry?: boolean) => Promise<void>;

  setSelectedTransferDetails: (details: TransferSession | null) => void;
  openTransferDetailsById: (transferId: string) => Promise<void>;
  simulateIncomingProposal: () => void;
  setDownloadDirectory: (path: string) => Promise<void>;
  showNotification: (type: TransferNotification['type'], title: string, message: string) => void;
  clearNotification: () => void;
  clearError: () => void;
  addTransfer: (item: Omit<FileTransferItem, 'id' | 'startedAt' | 'progress' | 'bytesTransferred'>) => void;
}

function sessionToTransferItem(session: TransferSession, queuePosition?: number): FileTransferItem {
  const pct =
    session.totalBytes > 0
      ? Math.min(100, Math.round((session.bytesTransferred / session.totalBytes) * 100))
      : session.status === 'completed'
        ? 100
        : 0;

  const isOutgoing = session.direction === 'outgoing';
  const label =
    session.rootFolderName ||
    (session.files.length > 1
      ? `${session.files[0]?.name} (+${session.files.length - 1})`
      : session.files[0]?.name || 'Transfer');

  return {
    id: session.transferId,
    name: label,
    size: session.totalBytes,
    mimeType: session.isFolder ? 'application/x-directory' : session.files[0]?.mimeType || 'application/octet-stream',
    progress: session.status === 'completed' ? 100 : pct,
    bytesTransferred: session.bytesTransferred,
    speed: session.speedBytesPerSec,
    direction: session.direction,
    status: session.status,
    priority: session.priority || 'normal',
    isFolder: session.isFolder,
    rootFolderName: session.rootFolderName,
    queuePosition,
    files: session.files,
    peerDevice: {
      id: isOutgoing ? session.recipientDeviceId : session.senderDeviceId,
      name: isOutgoing ? session.recipientDeviceName : session.senderDeviceName,
      platform: (isOutgoing ? 'android' : session.senderPlatform) as Platform,
      ipAddress: session.recipientIp,
    },
    startedAt: session.startedAt,
    completedAt: session.completedAt,
    destinationDirectory: session.destinationDirectory,
    errorMessage: session.errorMessage,
    errorCode: session.errorCode,
    filesCount: session.files.length,
    etaSeconds: session.estimatedSecondsRemaining,
    checksum: session.files[0]?.sha256Checksum,
    verified: session.files.every(f => f.isVerified),
  };
}

function calculateStats(items: FileTransferItem[]): TransferOverviewStats {
  const active = items.filter(t =>
    ['transferring', 'queued', 'paused', 'waiting_for_approval', 'preparing', 'connecting'].includes(t.status)
  );
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
}

let lastNotifKey = '';
let lastNotifTime = 0;

function triggerDesktopNotification(title: string, body: string) {
  const enabled = useSettingsStore.getState().notificationsEnabled;
  if (!enabled) return;

  const key = `${title}:${body}`;
  const now = Date.now();
  if (key === lastNotifKey && now - lastNotifTime < 2500) return;
  lastNotifKey = key;
  lastNotifTime = now;

  if (typeof window !== 'undefined' && 'Notification' in window) {
    if (Notification.permission === 'granted') {
      try {
        new Notification(title, { body });
      } catch {
        // ignore in restricted iframes
      }
    }
  }
}

export const useTransferStore = create<TransferStoreState>((set, get) => ({
  transfers: [],
  historySessions: [],
  historyFilters: {
    direction: 'all',
    status: 'all',
    searchQuery: '',
    sortBy: 'newest',
    limit: 100,
    offset: 0,
  },
  selectedFiles: [],
  selectedFolders: [],
  selectedPriority: 'normal',
  queueItems: [],
  statistics: null,
  statsTimeFrame: 'all',
  backgroundStatus: null,
  recoverableTransfers: [],
  activeIncomingProposal: null,
  selectedTransferDetails: null,
  downloadDirectory: '~/Downloads/BeamDrop',
  overviewStats: {
    activeCount: 0,
    completedCount: 0,
    totalFilesSent: 0,
    totalFilesReceived: 0,
    totalBytesTransferred: 0,
  },
  notification: null,
  isLoading: false,
  error: null,

  init: async () => {
    try {
      const [dir, files, folders, history, stats, bgStatus, recoverable, queue] = await Promise.all([
        tauriBridge.getDownloadDirectory(),
        tauriBridge.getSelectedFiles(),
        tauriBridge.getSelectedFolders(),
        tauriBridge.getTransferHistory({ sortBy: 'newest', limit: 100 }),
        tauriBridge.getTransferStatistics('all'),
        tauriBridge.getBackgroundTransferStatus(),
        tauriBridge.getRecoverableTransfers(),
        tauriBridge.getTransferQueue(),
      ]);

      const queuePosMap = new Map(queue.map(q => [q.transferId, q.queuePosition]));
      const mapped = history.map(s => sessionToTransferItem(s, queuePosMap.get(s.transferId)));

      set({
        downloadDirectory: dir,
        selectedFiles: files,
        selectedFolders: folders,
        historySessions: history,
        transfers: mapped,
        overviewStats: calculateStats(mapped),
        statistics: stats,
        backgroundStatus: bgStatus,
        recoverableTransfers: recoverable,
        queueItems: queue,
      });

      // Sync notification preference with backend
      const notifEnabled = useSettingsStore.getState().notificationsEnabled;
      await tauriBridge.setNotificationsEnabled(notifEnabled);

      // Event: transfer-progress
      await tauriBridge.subscribeEvent<TransferProgressPayload>('transfer-progress', event => {
        set(state => {
          const updated = state.transfers.map(t =>
            t.id === event.transferId
              ? {
                  ...t,
                  progress: event.percentage,
                  bytesTransferred: event.bytesTransferred,
                  speed: event.speedBytesPerSec,
                  averageSpeedBps: event.averageSpeedBps ?? t.averageSpeedBps,
                  peakSpeedBps: event.peakSpeedBps ?? t.peakSpeedBps,
                  etaSeconds: event.estimatedSecondsRemaining,
                  reliableEta: event.reliableEta ?? event.estimatedSecondsRemaining !== undefined,
                  status: event.status,
                }
              : t
          );
          return {
            transfers: updated,
            overviewStats: calculateStats(updated),
          };
        });
      });

      // Event: transfer-updated
      await tauriBridge.subscribeEvent<TransferSession>('transfer-updated', session => {
        set(state => {
          const item = sessionToTransferItem(session);
          const exists = state.transfers.some(t => t.id === session.transferId);
          const updated = exists
            ? state.transfers.map(t => (t.id === session.transferId ? item : t))
            : [item, ...state.transfers];
          return {
            transfers: updated,
            overviewStats: calculateStats(updated),
          };
        });
        get().loadQueue();
        get().loadBackgroundStatus();
      });

      // Event: transfer-completed
      await tauriBridge.subscribeEvent<TransferSession>('transfer-completed', session => {
        set(state => {
          const item = sessionToTransferItem({ ...session, status: 'completed', speedBytesPerSec: 0 });
          const exists = state.transfers.some(t => t.id === session.transferId);
          const updated = exists
            ? state.transfers.map(t => (t.id === session.transferId ? item : t))
            : [item, ...state.transfers];
          return {
            transfers: updated,
            overviewStats: calculateStats(updated),
          };
        });

        const label = session.rootFolderName || session.files[0]?.name || 'files';
        const msg = `Successfully transferred ${label} (${Math.max(1, Math.round(session.totalBytes / 1024 / 1024))} MB).`;
        get().showNotification('success', 'Transfer Complete', msg);
        triggerDesktopNotification('Transfer Complete', msg);
        get().loadHistory();
        get().loadStatistics();
        get().loadQueue();
        get().loadBackgroundStatus();
      });

      // Event: transfer-failed
      await tauriBridge.subscribeEvent<{ transferId: string; error: string }>('transfer-failed', payload => {
        set(state => {
          const updated = state.transfers.map(t =>
            t.id === payload.transferId
              ? { ...t, status: 'failed' as const, errorMessage: payload.error, speed: 0 }
              : t
          );
          return { transfers: updated, overviewStats: calculateStats(updated) };
        });
        get().showNotification('error', 'Transfer Failed', payload.error);
        triggerDesktopNotification('Transfer Failed', payload.error);
        get().loadHistory();
        get().loadStatistics();
        get().loadQueue();
      });

      // Event: transfer-cancelled
      await tauriBridge.subscribeEvent<TransferSession>('transfer-cancelled', session => {
        set(state => {
          const updated = state.transfers.map(t =>
            t.id === session.transferId ? { ...t, status: 'cancelled' as const, speed: 0 } : t
          );
          return { transfers: updated, overviewStats: calculateStats(updated) };
        });
        get().showNotification('warning', 'Transfer Cancelled', 'Transfer was cancelled by peer or local user.');
        get().loadHistory();
        get().loadQueue();
      });

      // Event: incoming-transfer-request
      await tauriBridge.subscribeEvent<IncomingTransferProposal>('incoming-transfer-request', proposal => {
        set({ activeIncomingProposal: proposal });
        const label = proposal.rootFolderName || `${proposal.fileCount} file(s)`;
        const msg = `${proposal.senderDeviceName} wants to send ${label} (${Math.max(1, Math.round(proposal.totalBytes / 1024 / 1024))} MB).`;
        get().showNotification('info', 'Incoming Transfer Request', msg);
        triggerDesktopNotification('Incoming Transfer Request', msg);
      });

      // Event: desktop-notification emitted by Rust backend
      await tauriBridge.subscribeEvent<{ title: string; body: string; level: string }>('desktop-notification', payload => {
        const level =
          payload.level === 'success' || payload.level === 'warning' || payload.level === 'error'
            ? payload.level
            : 'info';
        get().showNotification(level, payload.title, payload.body);
        triggerDesktopNotification(payload.title, payload.body);
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

  addFolderFromFileList: async (fileList: FileList | File[]) => {
    const arr = Array.from(fileList);
    if (arr.length === 0) return;

    const firstRel = (arr[0] as File & { webkitRelativePath?: string }).webkitRelativePath || arr[0].name;
    const rootName = firstRel.split('/')[0] || 'Selected_Folder';

    const dirSet = new Set<string>();
    const entries: FolderFileEntry[] = [];
    let totalBytes = 0;

    for (const file of arr) {
      const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || `${rootName}/${file.name}`;
      const parts = rel.split('/');
      if (parts.length > 1) {
        for (let i = 1; i < parts.length; i++) {
          dirSet.add(parts.slice(0, i).join('/'));
        }
      }
      totalBytes += file.size;
      entries.push({
        id: 'ff-' + Math.random().toString(36).substring(2, 9),
        name: file.name,
        relativePath: rel,
        fullPath: (file as File & { path?: string }).path || rel,
        size: file.size,
        mimeType: file.type || 'application/octet-stream',
        isDirectory: false,
        lastModified: file.lastModified || Date.now(),
      });
    }

    const folderMeta: FolderMetadata = {
      folderName: rootName,
      rootPath: `local://${rootName}`,
      totalFiles: entries.length,
      totalFolders: Math.max(1, dirSet.size),
      totalBytes,
      files: entries,
    };

    const updated = await tauriBridge.addScannedBrowserFolder(folderMeta);
    set({ selectedFolders: updated });
  },

  addScannedFolder: async (folder: FolderMetadata) => {
    const updated = await tauriBridge.addScannedBrowserFolder(folder);
    set({ selectedFolders: updated });
  },

  addFolderPath: async (folderPath: string) => {
    const updated = await tauriBridge.selectFolder(folderPath);
    set({ selectedFolders: updated });
  },

  removeSelectedFolder: async (rootPath: string) => {
    const updated = await tauriBridge.removeSelectedFolder(rootPath);
    set({ selectedFolders: updated });
  },

  clearSelectedFolders: async () => {
    await tauriBridge.clearSelectedFolders();
    set({ selectedFolders: [] });
  },

  setSelectedPriority: (priority: TransferPriority) => {
    set({ selectedPriority: priority });
  },

  startTransferToDevice: async (device) => {
    const { selectedFiles, selectedPriority } = get();
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
        priority: selectedPriority,
      });

      const newItem = sessionToTransferItem(session, 1);
      const updated = [newItem, ...get().transfers];
      set({
        transfers: updated,
        overviewStats: calculateStats(updated),
        selectedFiles: [],
        isLoading: false,
      });

      await tauriBridge.clearSelectedFiles();
      get().loadQueue();
      get().loadBackgroundStatus();

      get().showNotification('info', 'Transfer Started', `Beaming ${newItem.name} to ${device.name}...`);
      return session;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: msg, isLoading: false });
      get().showNotification('error', 'Transfer Failed', msg);
      return null;
    }
  },

  startTransferToDevices: async (devices) => {
    const { selectedFiles, selectedFolders } = get();
    for (const dev of devices) {
      if (selectedFiles.length > 0) {
        await get().startTransferToDevice(dev);
      }
      if (selectedFolders.length > 0) {
        await tauriBridge.startFolderTransfer({
          recipientId: dev.id,
          recipientName: dev.name,
          recipientIp: dev.ipAddress || '127.0.0.1',
          recipientPort: dev.port || 53317,
          folderPaths: selectedFolders.map(f => f.rootPath),
          priority: get().selectedPriority,
        });
      }
    }
    if (selectedFolders.length > 0) {
      await tauriBridge.clearSelectedFolders();
      set({ selectedFolders: [] });
      await get().loadHistory();
      await get().loadQueue();
    }
  },

  startFolderTransferToDevices: async (devices) => {
    const { selectedFolders, selectedPriority } = get();
    if (selectedFolders.length === 0) {
      get().showNotification('warning', 'No Folders Selected', 'Please select or drop a folder first.');
      return;
    }

    set({ isLoading: true });
    try {
      for (const dev of devices) {
        const session = await tauriBridge.startFolderTransfer({
          recipientId: dev.id,
          recipientName: dev.name,
          recipientIp: dev.ipAddress || '127.0.0.1',
          recipientPort: dev.port || 53317,
          folderPaths: selectedFolders.map(f => f.rootPath),
          priority: selectedPriority,
        });
        const newItem = sessionToTransferItem(session, 1);
        const updated = [newItem, ...get().transfers];
        set({
          transfers: updated,
          overviewStats: calculateStats(updated),
        });
      }

      await tauriBridge.clearSelectedFolders();
      set({ selectedFolders: [], isLoading: false });
      await get().loadQueue();
      await get().loadBackgroundStatus();
      get().showNotification('info', 'Folder Transfer Started', 'Streaming directory hierarchy over local LAN...');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: msg, isLoading: false });
      get().showNotification('error', 'Folder Transfer Failed', msg);
    }
  },

  acceptIncomingTransfer: async (transferId: string) => {
    try {
      const session = await tauriBridge.acceptTransfer(transferId);
      set({ activeIncomingProposal: null });

      const newItem = sessionToTransferItem(session);
      const updated = [newItem, ...get().transfers];
      set({
        transfers: updated,
        overviewStats: calculateStats(updated),
      });
      await get().loadHistory();
      await get().loadStatistics();
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
    get().loadQueue();
    get().loadBackgroundStatus();
  },

  resumeTransfer: async (id: string) => {
    await tauriBridge.resumeTransfer(id);
    const updated = get().transfers.map(t => (t.id === id ? { ...t, status: 'transferring' as const, speed: 12400000 } : t));
    set({ transfers: updated, overviewStats: calculateStats(updated) });
    get().loadQueue();
    get().loadBackgroundStatus();
  },

  cancelTransfer: async (id: string) => {
    await tauriBridge.cancelTransfer(id);
    const updated = get().transfers.map(t => (t.id === id ? { ...t, status: 'cancelled' as const, speed: 0 } : t));
    set({ transfers: updated, overviewStats: calculateStats(updated) });
    await get().loadHistory();
    await get().loadQueue();
    await get().loadBackgroundStatus();
  },

  cancelAllTransfers: async () => {
    await tauriBridge.cancelTransferBatch();
    const updated = get().transfers.map(t =>
      ['transferring', 'paused', 'waiting_for_approval', 'queued', 'preparing'].includes(t.status)
        ? { ...t, status: 'cancelled' as const, speed: 0 }
        : t
    );
    set({ transfers: updated, overviewStats: calculateStats(updated) });
    await get().loadHistory();
    await get().loadQueue();
    await get().loadBackgroundStatus();
  },

  pauseAllTransfers: async () => {
    const count = await tauriBridge.pauseAllTransfers();
    const updated = get().transfers.map(t =>
      ['transferring', 'queued', 'preparing'].includes(t.status)
        ? { ...t, status: 'paused' as const, speed: 0 }
        : t
    );
    set({ transfers: updated, overviewStats: calculateStats(updated) });
    if (count > 0) {
      get().showNotification('info', 'Queue Paused', `Paused ${count} active transfer(s).`);
    }
    await get().loadQueue();
    await get().loadBackgroundStatus();
  },

  resumeAllTransfers: async () => {
    const count = await tauriBridge.resumeAllTransfers();
    const updated = get().transfers.map(t =>
      t.status === 'paused' ? { ...t, status: 'transferring' as const, speed: 15200000 } : t
    );
    set({ transfers: updated, overviewStats: calculateStats(updated) });
    if (count > 0) {
      get().showNotification('info', 'Queue Resumed', `Resumed ${count} paused transfer(s).`);
    }
    await get().loadQueue();
    await get().loadBackgroundStatus();
  },

  changeTransferPriority: async (transferId: string, priority: TransferPriority) => {
    const pos = await tauriBridge.changeTransferPriority(transferId, priority);
    const updated = get().transfers.map(t =>
      t.id === transferId ? { ...t, priority, queuePosition: pos } : t
    );
    set({ transfers: updated });
    await get().loadQueue();
  },

  retryTransfer: async (transferId: string) => {
    try {
      const session = await tauriBridge.retryTransfer(transferId);
      const item = sessionToTransferItem(session, 1);
      const updated = [item, ...get().transfers];
      set({ transfers: updated, overviewStats: calculateStats(updated) });
      get().showNotification('info', 'Transfer Retried', `Re-queued ${item.name} for transmission.`);
      await get().loadHistory();
      await get().loadQueue();
      return session;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      get().showNotification('error', 'Retry Failed', msg);
      return null;
    }
  },

  removeTransfer: async (transferId: string) => {
    await tauriBridge.removeTransfer(transferId);
    const updated = get().transfers.filter(t => t.id !== transferId);
    set({ transfers: updated, overviewStats: calculateStats(updated) });
    await get().loadQueue();
  },

  loadHistory: async (filters?: Partial<HistoryFilterOptions>) => {
    const merged = { ...get().historyFilters, ...filters };
    set({ historyFilters: merged });
    const sessions = await tauriBridge.filterTransferHistory(merged);
    const queue = await tauriBridge.getTransferQueue();
    const queuePosMap = new Map(queue.map(q => [q.transferId, q.queuePosition]));

    // When unfiltered, keep transfers list synced cleanly with persistent storage
    if (
      (!merged.direction || merged.direction === 'all') &&
      (!merged.status || merged.status === 'all') &&
      (!merged.searchQuery || merged.searchQuery.trim() === '')
    ) {
      const mapped = sessions.map(s => sessionToTransferItem(s, queuePosMap.get(s.transferId)));
      set({
        historySessions: sessions,
        transfers: mapped,
        overviewStats: calculateStats(mapped),
        queueItems: queue,
      });
    } else {
      set({ historySessions: sessions, queueItems: queue });
    }
  },

  deleteHistoryEntry: async (transferId: string) => {
    await tauriBridge.deleteHistoryEntry(transferId);
    set(state => ({
      historySessions: state.historySessions.filter(s => s.transferId !== transferId),
      transfers: state.transfers.filter(t => t.id !== transferId),
    }));
    await get().loadStatistics();
    get().showNotification(
      'info',
      'History Record Deleted',
      'Log entry removed from database. Received files on disk remain untouched.'
    );
  },

  clearAllHistory: async () => {
    await tauriBridge.clearTransferHistory();
    const activeOnly = get().transfers.filter(t =>
      ['transferring', 'queued', 'paused', 'waiting_for_approval'].includes(t.status)
    );
    set({
      historySessions: [],
      transfers: activeOnly,
      overviewStats: calculateStats(activeOnly),
    });
    await get().loadStatistics();
    get().showNotification(
      'info',
      'History Cleared',
      'Transfer logs cleared. Received files on disk were preserved.'
    );
  },

  clearHistory: () => {
    get().clearAllHistory();
  },

  loadStatistics: async (timeFrame?: 'today' | '7d' | '30d' | 'all') => {
    const tf = timeFrame ?? get().statsTimeFrame;
    const stats = await tauriBridge.getTransferStatistics(tf);
    set({ statistics: stats, statsTimeFrame: tf });
  },

  loadQueue: async () => {
    const queue = await tauriBridge.getTransferQueue();
    set({ queueItems: queue });
  },

  loadBackgroundStatus: async () => {
    const bgStatus = await tauriBridge.getBackgroundTransferStatus();
    set({ backgroundStatus: bgStatus });
  },

  loadRecoverableTransfers: async () => {
    const rec = await tauriBridge.getRecoverableTransfers();
    set({ recoverableTransfers: rec });
  },

  recoverTransfer: async (transferId: string, freshRetry = false) => {
    try {
      const session = await tauriBridge.recoverTransfer(transferId, freshRetry);
      const item = sessionToTransferItem(session, 1);
      set(state => ({
        transfers: [item, ...state.transfers.filter(t => t.id !== session.transferId)],
        recoverableTransfers: state.recoverableTransfers.filter(r => r.transferId !== transferId),
      }));
      get().showNotification(
        'info',
        freshRetry ? 'Fresh Retry Started' : 'Transfer Restored',
        `${item.name} has been restored to active transfers.`
      );
      await get().loadQueue();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      get().showNotification('error', 'Recovery Failed', msg);
    }
  },

  setSelectedTransferDetails: (details) => {
    set({ selectedTransferDetails: details });
  },

  openTransferDetailsById: async (transferId: string) => {
    const details = await tauriBridge.getTransferDetails(transferId);
    if (details) {
      set({ selectedTransferDetails: details });
      return;
    }
    const found = get().historySessions.find(s => s.transferId === transferId);
    if (found) {
      set({ selectedTransferDetails: found });
    }
  },

  simulateIncomingProposal: () => {
    tauriBridge.simulateIncomingTransferRequest();
  },

  setDownloadDirectory: async (path: string) => {
    const updated = await tauriBridge.setDownloadDirectory(path);
    set({ downloadDirectory: updated });
    useSettingsStore.getState().updateSettings({ saveDirectory: updated });
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
  },
}));
