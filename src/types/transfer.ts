import { DiscoveredDevice } from './device';

export type TransferDirection = 'incoming' | 'outgoing';

export type TransferStatus =
  | 'queued'
  | 'transferring'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

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
  peerDevice: Partial<DiscoveredDevice> & { name: string; ipAddress?: string };
  startedAt: number;
  completedAt?: number;
  errorMessage?: string;
}

export interface TransferOverviewStats {
  activeCount: number;
  completedCount: number;
  totalFilesSent: number;
  totalFilesReceived: number;
  totalBytesTransferred: number;
}
