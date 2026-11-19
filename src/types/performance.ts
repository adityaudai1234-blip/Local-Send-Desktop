import type { TransferPriority, TransferStatus, RecoverableTransferInfo } from './transfer';

export interface ThroughputHistoryPoint {
  timestamp: number;
  uploadBps: number;
  downloadBps: number;
  diskWriteBps: number;
}

export interface TransferPerformanceMetrics {
  activeTransfers: number;
  queuedTransfers: number;
  pausedTransfers: number;
  totalBytesTransferred: number;
  totalUploadSpeedBps: number;
  totalDownloadSpeedBps: number;
  combinedThroughputBps: number;
  averageSpeedBps: number;
  peakSpeedBps: number;
  diskReadSpeedBps: number;
  diskWriteSpeedBps: number;
  retryCount: number;
  failedCount: number;
  currentChunkSizeBytes: number;
  adaptiveChunkingActive: boolean;
  queueDepth: number;
  activeBufferBytes: number;
  updatedAt: number;
}

export interface NetworkThroughputMetrics {
  uploadBps: number;
  downloadBps: number;
  totalTxBytes: number;
  totalRxBytes: number;
  peakUploadBps: number;
  peakDownloadBps: number;
  activeConnections: number;
  networkQuality: 'excellent' | 'good' | 'degraded' | 'congested' | string;
  averageLatencyMs: number;
  congestionEvents: number;
  interfaceIp: string;
  interfaceChangedAt: number | null;
  history: ThroughputHistoryPoint[];
}

export interface DiskThroughputMetrics {
  readBps: number;
  writeBps: number;
  totalReadBytes: number;
  totalWriteBytes: number;
  averageWriteLatencyUs: number;
  bufferedWriteEnabled: boolean;
  writeBufferSizeBytes: number;
  availableDiskBytes: number | null;
  downloadDirPath: string;
}

export interface TransferSpeedDetails {
  transferId: string;
  currentSpeedBps: number;
  averageSpeedBps: number;
  peakSpeedBps: number;
  totalBytes: number;
  bytesTransferred: number;
  remainingBytes: number;
  estimatedSecondsRemaining: number | null;
  reliableEta: boolean;
  recentSamplesBps: number[];
  chunkSizeBytes: number;
  retryAttempts: number;
  status: TransferStatus;
}

export interface TransferOptimizationSettings {
  maxConcurrentTransfers: number;
  maxConcurrentFileOps: number;
  maxConcurrentConnections: number;
  maxConcurrentChunkOps: number;
  adaptiveChunkingEnabled: boolean;
  defaultChunkSizeKb: number;
  performanceGraphEnabled: boolean;
  autoRetryEnabled: boolean;
  maxRetries: number;
  defaultPriority: TransferPriority;
  continueInBackground: boolean;
}

export interface TransferQueueMetrics {
  totalQueued: number;
  activeCount: number;
  waitingCount: number;
  highPriorityCount: number;
  normalPriorityCount: number;
  lowPriorityCount: number;
  starvationBoostsApplied: number;
  totalQueuedBytes: number;
  maxConcurrentTransfers: number;
}

export interface TransferResourceUsage {
  activeFileHandles: number;
  activeChunkBuffers: number;
  pooledBuffersAvailable: number;
  bufferMemoryBytes: number;
  peakBufferMemoryBytes: number;
  activeConcurrentTransfers: number;
  maxConcurrentTransfers: number;
  activeFileOps: number;
  maxConcurrentFileOps: number;
  activeNetworkConnections: number;
  maxConcurrentConnections: number;
  activeChunkOps: number;
  maxConcurrentChunkOps: number;
}

export interface TransferRecoveryStatus {
  recoverableCount: number;
  resumableCount: number;
  rejectedCount: number;
  totalRecoverableBytes: number;
  corruptedPartFilesCleaned: number;
  items: RecoverableTransferInfo[];
}

export interface NetworkQualityEvent {
  quality: string;
  averageLatencyMs: number;
  activeConnections: number;
  congestionDetected: boolean;
  recommendedChunkSizeBytes: number;
  interfaceIp: string;
  timestamp: number;
}
