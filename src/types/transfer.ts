import { DiscoveredDevice, Platform } from './device';

export type TransferDirection = 'incoming' | 'outgoing';

export type TransferPriority = 'low' | 'normal' | 'high';

export type TransferStatus =
  | 'waiting_for_approval'
  | 'preparing'
  | 'connecting'
  | 'transferring'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'paused'
  | 'queued';

export interface SelectedFileItem {
  id: string;
  name: string;
  extension: string;
  size: number;
  mimeType: string;
  path: string;
  lastModified: number;
}

export interface FolderFileEntry {
  id: string;
  name: string;
  relativePath: string;
  fullPath?: string;
  size: number;
  mimeType: string;
  isDirectory: boolean;
  lastModified: number;
}

export interface FolderMetadata {
  folderName: string;
  rootPath: string;
  totalFiles: number;
  totalFolders: number;
  totalBytes: number;
  files: FolderFileEntry[];
}

export interface TransferFileDetail {
  fileId: string;
  name: string;
  size: number;
  mimeType: string;
  path?: string;
  relativePath?: string;
  isDirectory?: boolean;
  sha256Checksum?: string;
  isVerified: boolean;
  bytesTransferred: number;
  status: TransferStatus;
}

export interface TransferSession {
  transferId: string;
  direction: TransferDirection;
  senderDeviceId: string;
  senderDeviceName: string;
  senderPlatform: string;
  recipientDeviceId: string;
  recipientDeviceName: string;
  recipientIp: string;
  recipientPort: number;
  files: TransferFileDetail[];
  totalBytes: number;
  bytesTransferred: number;
  speedBytesPerSec: number;
  estimatedSecondsRemaining?: number;
  status: TransferStatus;
  priority?: TransferPriority;
  isFolder?: boolean;
  rootFolderName?: string;
  queuePosition?: number;
  errorMessage?: string;
  errorCode?: string;
  startedAt: number;
  completedAt?: number;
  destinationDirectory?: string;
}

export interface TransferProgressPayload {
  transferId: string;
  fileId: string;
  fileName: string;
  currentFileIndex: number;
  totalFiles: number;
  bytesTransferred: number;
  totalBytes: number;
  percentage: number;
  speedBytesPerSec: number;
  averageSpeedBps?: number;
  peakSpeedBps?: number;
  remainingBytes?: number;
  estimatedSecondsRemaining?: number;
  reliableEta?: boolean;
  chunkSizeBytes?: number;
  status: TransferStatus;
}

export interface IncomingTransferProposal {
  transferId: string;
  senderDeviceId: string;
  senderDeviceName: string;
  senderPlatform: Platform;
  senderIpAddress: string;
  fileCount: number;
  totalBytes: number;
  isFolder?: boolean;
  rootFolderName?: string;
  priority?: TransferPriority;
  files: {
    fileId: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    relativePath?: string;
    isDirectory?: boolean;
  }[];
  expiresAt: number;
}

export interface QueueItemInfo {
  transferId: string;
  rootName: string;
  priority: TransferPriority;
  queuePosition: number;
  status: TransferStatus;
  recipientName: string;
  totalBytes: number;
  bytesTransferred: number;
  speedBytesPerSec: number;
  estimatedSecondsRemaining?: number;
  isFolder: boolean;
  fileCount: number;
  enqueuedAt: number;
}

export interface HistoryFilterOptions {
  direction?: 'all' | 'sent' | 'received' | 'outgoing' | 'incoming';
  status?: 'all' | 'completed' | 'failed' | 'cancelled' | 'active';
  searchQuery?: string;
  sortBy?: 'newest' | 'oldest' | 'largest' | 'smallest' | 'success' | 'failed';
  limit?: number;
  offset?: number;
}

export interface TopDeviceStat {
  deviceName: string;
  transferCount: number;
  totalBytes: number;
}

export interface DailyVolumeStat {
  date: string;
  sentBytes: number;
  receivedBytes: number;
  count: number;
}

export interface TransferStatistics {
  timeFrame: string;
  totalBytesSent: number;
  totalBytesReceived: number;
  totalFilesSent: number;
  totalFilesReceived: number;
  successfulTransfersCount: number;
  failedTransfersCount: number;
  averageSpeedBps: number;
  largestFileName: string;
  largestFileSize: number;
  successRatePercentage: number;
  topDevices: TopDeviceStat[];
  dailyVolume: DailyVolumeStat[];
}

export interface BackgroundTransferStatus {
  activeTransfersCount: number;
  pausedTransfersCount: number;
  totalTransferSpeedBps: number;
  activeTransferNames: string[];
  isBackgroundActive: boolean;
}

export interface RecoverableTransferInfo {
  transferId: string;
  rootName: string;
  direction: string;
  peerDeviceId: string;
  peerDeviceName: string;
  totalBytes: number;
  bytesTransferred: number;
  partialFileExists: boolean;
  canResume: boolean;
  canRetryFresh: boolean;
  reason: string;
  startedAt: number;
}

// Backward-compatible UI item definition used across existing components
export interface FileTransferItem {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  progress: number; // 0 - 100
  bytesTransferred: number;
  speed: number; // bytes per second
  direction: TransferDirection;
  status: TransferStatus;
  priority?: TransferPriority;
  isFolder?: boolean;
  rootFolderName?: string;
  queuePosition?: number;
  files?: TransferFileDetail[];
  peerDevice: Partial<DiscoveredDevice> & { name: string; ipAddress?: string; platform?: Platform };
  startedAt: number;
  completedAt?: number;
  destinationDirectory?: string;
  errorMessage?: string;
  errorCode?: string;
  filesCount?: number;
  etaSeconds?: number;
  averageSpeedBps?: number;
  peakSpeedBps?: number;
  reliableEta?: boolean;
  checksum?: string;
  verified?: boolean;
}

export interface TransferOverviewStats {
  activeCount: number;
  completedCount: number;
  totalFilesSent: number;
  totalFilesReceived: number;
  totalBytesTransferred: number;
}
