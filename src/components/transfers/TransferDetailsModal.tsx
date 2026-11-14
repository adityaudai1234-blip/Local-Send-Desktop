import React, { useState } from 'react';
import {
  FileText,
  Folder,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  ArrowUpRight,
  ArrowDownLeft,
  Activity,
  HardDrive,
  RotateCcw,
  Copy,
  Check,
  FileCheck2,
} from 'lucide-react';
import { useTransferStore } from '../../stores/transferStore';
import { Modal } from '../common/Modal';
import { formatBytes, formatDateTime, formatSpeed } from '../../utils/formatters';
import { tauriBridge } from '../../services/tauriBridge';

export const TransferDetailsModal: React.FC = () => {
  const { selectedTransferDetails, setSelectedTransferDetails, cancelTransfer, retryTransfer } =
    useTransferStore();
  const [copiedPath, setCopiedPath] = useState(false);

  if (!selectedTransferDetails) return null;

  const isOutgoing = selectedTransferDetails.direction === 'outgoing';
  const isCompleted = selectedTransferDetails.status === 'completed';
  const isFailed = selectedTransferDetails.status === 'failed';
  const isCancelled = selectedTransferDetails.status === 'cancelled';
  const canRetry = isFailed || isCancelled;

  const durationMs = selectedTransferDetails.completedAt
    ? Math.max(200, selectedTransferDetails.completedAt - selectedTransferDetails.startedAt)
    : Math.max(200, Date.now() - selectedTransferDetails.startedAt);
  const durationSec = (durationMs / 1000).toFixed(1);
  const avgSpeedBps =
    selectedTransferDetails.bytesTransferred > 0
      ? Math.round((selectedTransferDetails.bytesTransferred / durationMs) * 1000)
      : selectedTransferDetails.speedBytesPerSec;

  const verifiedFilesCount = selectedTransferDetails.files.filter((f) => f.isVerified).length;

  const handleOpenFolder = () => {
    if (selectedTransferDetails.destinationDirectory) {
      tauriBridge.revealReceivedFile(selectedTransferDetails.destinationDirectory);
    }
  };

  const handleOpenFile = (filePath?: string, fileName?: string) => {
    const target =
      filePath ||
      (selectedTransferDetails.destinationDirectory
        ? `${selectedTransferDetails.destinationDirectory}/${fileName || ''}`
        : '');
    if (target) {
      tauriBridge.openReceivedFile(target);
    }
  };

  const handleCopyPath = async () => {
    const target = selectedTransferDetails.destinationDirectory || selectedTransferDetails.files[0]?.path || '';
    if (!target) return;
    await tauriBridge.copyFilePath(target);
    setCopiedPath(true);
    setTimeout(() => setCopiedPath(false), 1800);
  };

  return (
    <Modal
      isOpen={!!selectedTransferDetails}
      onClose={() => setSelectedTransferDetails(null)}
      title={
        selectedTransferDetails.isFolder
          ? `Folder Transfer: ${selectedTransferDetails.rootFolderName || 'Directory'}`
          : 'Transfer Session Inspection'
      }
      description={`Session ID: ${selectedTransferDetails.transferId} · Started ${formatDateTime(selectedTransferDetails.startedAt)}`}
    >
      <div className="space-y-4 text-xs">
        {/* Status and Direction Ribbon */}
        <div className="p-3 rounded-xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                isOutgoing
                  ? 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400'
                  : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              }`}
            >
              {isOutgoing ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownLeft className="w-4 h-4" />}
            </div>
            <div className="min-w-0">
              <span className="font-semibold text-neutral-900 dark:text-white capitalize block truncate">
                {selectedTransferDetails.direction} {selectedTransferDetails.isFolder ? 'Folder' : 'File'} Transmission
              </span>
              <span className="text-[11px] text-neutral-500 truncate block">
                {isOutgoing ? 'Recipient' : 'Sender'}:{' '}
                {isOutgoing
                  ? selectedTransferDetails.recipientDeviceName
                  : selectedTransferDetails.senderDeviceName}{' '}
                ({selectedTransferDetails.recipientIp})
              </span>
            </div>
          </div>

          <div className="shrink-0">
            {isCompleted ? (
              <span className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Completed
              </span>
            ) : isFailed || isCancelled ? (
              <span className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 font-medium capitalize">
                <AlertCircle className="w-3.5 h-3.5" />
                {selectedTransferDetails.status}
              </span>
            ) : (
              <span className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-cyan-100 dark:bg-cyan-950/60 text-cyan-600 dark:text-cyan-400 font-medium capitalize">
                <Activity className="w-3.5 h-3.5 animate-pulse" />
                {selectedTransferDetails.status.replace('_', ' ')}
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
            <span className="text-neutral-500 block text-[10px]">Duration</span>
            <span className="font-mono font-bold text-neutral-900 dark:text-white">{durationSec}s</span>
          </div>

          <div className="p-2.5 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900/40">
            <span className="text-neutral-500 block text-[10px]">Average Speed</span>
            <span className="font-mono font-bold text-neutral-900 dark:text-white">
              {formatSpeed(avgSpeedBps)}
            </span>
          </div>

          <div className="p-2.5 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900/40">
            <span className="text-neutral-500 block text-[10px]">SHA-256 Verified</span>
            <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
              {verifiedFilesCount} / {selectedTransferDetails.files.length}
            </span>
          </div>
        </div>

        {/* Failure Diagnostic */}
        {(selectedTransferDetails.errorMessage || selectedTransferDetails.errorCode) && (
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 space-y-1">
            <div className="flex items-center justify-between font-semibold">
              <span className="flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5" />
                Transfer Error Diagnostic
              </span>
              {selectedTransferDetails.errorCode && (
                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-rose-500/15">
                  {selectedTransferDetails.errorCode}
                </span>
              )}
            </div>
            <p className="text-[11px]">{selectedTransferDetails.errorMessage}</p>
          </div>
        )}

        {/* Files & Directory Tree */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h5 className="font-semibold text-neutral-900 dark:text-white">
              {selectedTransferDetails.isFolder ? 'Directory Tree & Files' : 'Files'} (
              {selectedTransferDetails.files.length})
            </h5>
            {selectedTransferDetails.priority && (
              <span className="text-[11px] font-mono uppercase text-neutral-500">
                Priority: {selectedTransferDetails.priority}
              </span>
            )}
          </div>

          <div className="max-h-52 overflow-y-auto space-y-2 pr-1">
            {selectedTransferDetails.files.map((file) => {
              const displayPath = file.relativePath || file.name;
              const depth = displayPath.split('/').length - 1;
              return (
                <div
                  key={file.fileId}
                  style={{ marginLeft: `${Math.min(depth * 10, 30)}px` }}
                  className="p-3 rounded-lg bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-200/60 dark:border-neutral-700/60 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 truncate min-w-0">
                      {file.isDirectory ? (
                        <Folder className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      ) : (
                        <FileText className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                      )}
                      <span className="font-medium text-neutral-900 dark:text-white truncate font-mono text-[11px]">
                        {displayPath}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-mono text-neutral-500">
                        {file.isDirectory ? 'empty dir' : formatBytes(file.size)}
                      </span>
                      {!file.isDirectory && isCompleted && (
                        <button
                          type="button"
                          onClick={() => handleOpenFile(file.path, file.relativePath || file.name)}
                          className="text-[11px] text-cyan-600 dark:text-cyan-400 hover:underline flex items-center gap-0.5"
                          title="Open file"
                        >
                          <FileCheck2 className="w-3 h-3" />
                          <span>Open</span>
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-neutral-500 pt-1 border-t border-neutral-200/40 dark:border-neutral-700/40 font-mono">
                    <span>MIME: {file.mimeType}</span>
                    {file.sha256Checksum ? (
                      <span
                        className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400"
                        title={file.sha256Checksum}
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />
                        {file.sha256Checksum.substring(0, 12)}...
                      </span>
                    ) : (
                      <span className="text-neutral-400">{file.isVerified ? 'Verified' : 'Pending'}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Destination Path & Quick File Actions */}
        {selectedTransferDetails.destinationDirectory && (
          <div className="p-3 rounded-lg bg-neutral-100/60 dark:bg-neutral-800/40 border border-neutral-200/50 dark:border-neutral-700/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <HardDrive className="w-4 h-4 text-neutral-400 shrink-0" />
              <span className="font-mono truncate text-neutral-700 dark:text-neutral-300">
                {selectedTransferDetails.destinationDirectory}
              </span>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={handleCopyPath}
                className="flex items-center gap-1 text-[11px] text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white"
              >
                {copiedPath ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                <span>{copiedPath ? 'Copied' : 'Copy Path'}</span>
              </button>

              <button
                type="button"
                onClick={handleOpenFolder}
                className="flex items-center gap-1 text-[11px] text-cyan-600 dark:text-cyan-400 hover:underline"
              >
                <ExternalLink className="w-3 h-3" />
                <span>Reveal Folder</span>
              </button>
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex items-center justify-between pt-2 border-t border-neutral-100 dark:border-neutral-800">
          <div className="flex items-center gap-2">
            {!isCompleted && !isFailed && !isCancelled && (
              <button
                type="button"
                onClick={() => {
                  cancelTransfer(selectedTransferDetails.transferId);
                  setSelectedTransferDetails(null);
                }}
                className="px-3 py-1.5 text-xs font-medium rounded-lg text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
              >
                Cancel Transfer
              </button>
            )}

            {canRetry && (
              <button
                type="button"
                onClick={async () => {
                  await retryTransfer(selectedTransferDetails.transferId);
                  setSelectedTransferDetails(null);
                }}
                className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-lg bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-500/25 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Retry Transfer</span>
              </button>
            )}
          </div>

          <button
            type="button"
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
