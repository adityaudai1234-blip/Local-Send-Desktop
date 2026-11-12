import { DiscoveredDevice, Platform } from './device';

export type TransferDirection = 'incoming' | 'outgoing';

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
  // legacy compatibility
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

export interface TransferFileDetail {
  fileId: string;
  name: string;
  size: number;
  mimeType: string;
  path?: string;
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
  errorMessage?: string;
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
  estimatedSecondsRemaining?: number;
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
  files: {
    fileId: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
  }[];
  expiresAt: number;
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
  peerDevice: Partial<DiscoveredDevice> & { name: string; ipAddress?: string; platform?: Platform };
  startedAt: number;
  completedAt?: number;
  errorMessage?: string;
  filesCount?: number;
  etaSeconds?: number;
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
