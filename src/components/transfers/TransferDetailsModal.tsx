import React from 'react';
import {
  FileText,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Clock,
  ArrowUpRight,
  ArrowDownLeft,
  Activity,
  HardDrive,
} from 'lucide-react';
import { useTransferStore } from '../../stores/transferStore';
import { Modal } from '../common/Modal';
import { formatBytes, formatDateTime, formatSpeed } from '../../utils/formatters';
import { tauriBridge } from '../../services/tauriBridge';

export const TransferDetailsModal: React.FC = () => {
  const { selectedTransferDetails, setSelectedTransferDetails, cancelTransfer } = useTransferStore();

  if (!selectedTransferDetails) return null;

  const isOutgoing = selectedTransferDetails.direction === 'outgoing';
  const isCompleted = selectedTransferDetails.status === 'completed';
  const isFailed = selectedTransferDetails.status === 'failed';

  const handleOpenFolder = () => {
    if (selectedTransferDetails.destinationDirectory) {
      tauriBridge.openReceivedFileLocation(selectedTransferDetails.destinationDirectory);
    }
  };

  return (
    <Modal
      isOpen={!!selectedTransferDetails}
      onClose={() => setSelectedTransferDetails(null)}
      title="Transfer Session Inspection"
      description={`Session ID: ${selectedTransferDetails.transferId}`}
    >
      <div className="space-y-4 text-xs">
        {/* Status and Direction Ribbon */}
        <div className="p-3 rounded-xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                isOutgoing
                  ? 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400'
                  : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              }`}
            >
              {isOutgoing ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownLeft className="w-4 h-4" />}
            </div>
            <div>
              <span className="font-semibold text-neutral-900 dark:text-white capitalize block">
                {selectedTransferDetails.direction} Transmission
              </span>
              <span className="text-[11px] text-neutral-500">
                Target: {selectedTransferDetails.recipientDeviceName} ({selectedTransferDetails.recipientIp})
              </span>
            </div>
          </div>

          <div>
            {isCompleted ? (
              <span className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Completed
              </span>
            ) : isFailed ? (
              <span className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 font-medium">
                <AlertCircle className="w-3.5 h-3.5" />
                Failed
              </span>
            ) : (
              <span className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-cyan-100 dark:bg-cyan-950/60 text-cyan-600 dark:text-cyan-400 font-medium">
                <Activity className="w-3.5 h-3.5 animate-pulse" />
                Active
              </span>
            )}
          </div>
        </div>

        {/* Detailed Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <div className="p-2.5 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900/40">
            <span className="text-neutral-500 block text-[10px]">Total Size</span>
            <span className="font-mono font-bold text-neutral-900 dark:text-white">
              {formatBytes(selectedTransferDetails.totalBytes)}
            </span>
          </div>

          <div className="p-2.5 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900/40">
            <span className="text-neutral-500 block text-[10px]">Bytes Written</span>
            <span className="font-mono font-bold text-neutral-900 dark:text-white">
              {formatBytes(selectedTransferDetails.bytesTransferred)}
            </span>
          </div>

          <div className="p-2.5 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900/40">
            <span className="text-neutral-500 block text-[10px]">Instant Speed</span>
            <span className="font-mono font-bold text-neutral-900 dark:text-white">
              {formatSpeed(selectedTransferDetails.speedBytesPerSec)}
            </span>
          </div>

          <div className="p-2.5 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900/40">
            <span className="text-neutral-500 block text-[10px]">Integrity Hash</span>
            <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
              SHA-256
            </span>
          </div>
        </div>

        {/* Files Included */}
        <div className="space-y-2">
          <h5 className="font-semibold text-neutral-900 dark:text-white">
            Files ({selectedTransferDetails.files.length})
          </h5>

          <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
            {selectedTransferDetails.files.map((file) => (
              <div
                key={file.fileId}
                className="p-3 rounded-lg bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-200/60 dark:border-neutral-700/60 space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 truncate">
                    <FileText className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                    <span className="font-medium text-neutral-900 dark:text-white truncate">
                      {file.name}
                    </span>
                  </div>
                  <span className="font-mono text-neutral-500 shrink-0">
                    {formatBytes(file.size)}
                  </span>
                </div>

                <div className="flex items-center justify-between text-[11px] text-neutral-500 pt-1 border-t border-neutral-200/40 dark:border-neutral-700/40 font-mono">
                  <span>MIME: {file.mimeType}</span>
                  {file.sha256Checksum ? (
                    <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400" title={file.sha256Checksum}>
                      <ShieldCheck className="w-3.5 h-3.5" />
                      {file.sha256Checksum.substring(0, 12)}...
                    </span>
                  ) : (
                    <span className="text-neutral-400">Streaming hash</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Destination Path */}
        {selectedTransferDetails.destinationDirectory && (
          <div className="p-3 rounded-lg bg-neutral-100/60 dark:bg-neutral-800/40 border border-neutral-200/50 dark:border-neutral-700/50 flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <HardDrive className="w-4 h-4 text-neutral-400 shrink-0" />
              <span className="font-mono truncate text-neutral-700 dark:text-neutral-300">
                {selectedTransferDetails.destinationDirectory}
              </span>
            </div>

            <button
              onClick={handleOpenFolder}
              className="flex items-center gap-1 text-[11px] text-cyan-600 dark:text-cyan-400 hover:underline shrink-0"
            >
              <ExternalLink className="w-3 h-3" />
              <span>Show in Folder</span>
            </button>
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex items-center justify-between pt-2 border-t border-neutral-100 dark:border-neutral-800">
          <div>
            {!isCompleted && !isFailed && (
              <button
                onClick={() => {
                  cancelTransfer(selectedTransferDetails.transferId);
                  setSelectedTransferDetails(null);
                }}
                className="px-3 py-1.5 text-xs font-medium rounded-lg text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
              >
                Cancel Transfer
              </button>
            )}
          </div>

          <button
            onClick={() => setSelectedTransferDetails(null)}
            className="px-4 py-1.5 text-xs font-medium rounded-xl bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-800 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
};
