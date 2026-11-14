import React, { useEffect, useState } from 'react';
import { Download, ShieldCheck, File, Folder, Clock } from 'lucide-react';
import { useTransferStore } from '../../stores/transferStore';
import { Modal } from '../common/Modal';
import { PlatformIcon } from '../common/PlatformIcon';
import { formatBytes } from '../../utils/formatters';

export const IncomingTransferModal: React.FC = () => {
  const { activeIncomingProposal, acceptIncomingTransfer, rejectIncomingTransfer } = useTransferStore();
  const [secondsLeft, setSecondsLeft] = useState(60);

  useEffect(() => {
    if (!activeIncomingProposal) return;

    const remaining = Math.max(0, Math.ceil((activeIncomingProposal.expiresAt - Date.now()) / 1000));
    setSecondsLeft(remaining);

    const interval = setInterval(() => {
      const sec = Math.max(0, Math.ceil((activeIncomingProposal.expiresAt - Date.now()) / 1000));
      setSecondsLeft(sec);
      if (sec <= 0) {
        rejectIncomingTransfer(activeIncomingProposal.transferId, 'Request expired');
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [activeIncomingProposal, rejectIncomingTransfer]);

  if (!activeIncomingProposal) return null;

  return (
    <Modal
      isOpen={!!activeIncomingProposal}
      onClose={() => rejectIncomingTransfer(activeIncomingProposal.transferId, 'Dismissed')}
      title={activeIncomingProposal.isFolder ? 'Incoming Folder Transfer Request' : 'Incoming File Transfer Request'}
      description="A remote peer wants to transfer local data over your encrypted LAN socket."
    >
      <div className="space-y-4 text-xs">
        {/* Sender Device Card */}
        <div className="p-3.5 rounded-xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 flex items-center justify-center text-neutral-800 dark:text-neutral-200">
              <PlatformIcon platform={activeIncomingProposal.senderPlatform} className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-neutral-900 dark:text-white">
                {activeIncomingProposal.senderDeviceName}
              </h4>
              <p className="text-[11px] font-mono text-neutral-500">
                {activeIncomingProposal.senderIpAddress} · Direct TCP
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 text-neutral-500 font-mono text-[11px]">
            <Clock className="w-3.5 h-3.5" />
            <span>{secondsLeft}s left</span>
          </div>
        </div>

        {/* Folder/Files Overview */}
        <div className="space-y-2">
          <div className="flex justify-between text-neutral-600 dark:text-neutral-400 font-medium">
            <span className="flex items-center gap-1.5">
              {activeIncomingProposal.isFolder && <Folder className="w-3.5 h-3.5 text-amber-500" />}
              {activeIncomingProposal.rootFolderName
                ? `${activeIncomingProposal.rootFolderName}/ (${activeIncomingProposal.fileCount} items)`
                : `Files (${activeIncomingProposal.fileCount})`}
            </span>
            <span className="font-mono">{formatBytes(activeIncomingProposal.totalBytes)}</span>
          </div>

          <div className="max-h-40 overflow-y-auto space-y-1.5 p-1">
            {activeIncomingProposal.files.map((f) => (
              <div
                key={f.fileId}
                className="flex items-center justify-between p-2 rounded-lg bg-neutral-100/70 dark:bg-neutral-800/40 border border-neutral-200/50 dark:border-neutral-700/50"
              >
                <div className="flex items-center gap-2 truncate min-w-0">
                  {f.isDirectory ? (
                    <Folder className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  ) : (
                    <File className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                  )}
                  <span className="truncate text-neutral-900 dark:text-white font-medium">
                    {f.relativePath || f.fileName}
                  </span>
                </div>
                <span className="font-mono text-neutral-500 shrink-0 text-[11px] pl-2">
                  {f.isDirectory ? 'dir' : formatBytes(f.fileSize)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Integrity & Destination Info */}
        <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 flex items-center gap-2.5">
          <ShieldCheck className="w-4 h-4 shrink-0" />
          <span className="text-[11px]">
            Paths are validated against directory traversal, collisions are renamed automatically, and every file is SHA-256 verified.
          </span>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-neutral-100 dark:border-neutral-800">
          <button
            onClick={() => rejectIncomingTransfer(activeIncomingProposal.transferId, 'User rejected')}
            className="px-4 py-2 text-xs font-medium rounded-xl text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
          >
            Decline
          </button>
          <button
            onClick={() => acceptIncomingTransfer(activeIncomingProposal.transferId)}
            className="flex items-center gap-1.5 px-5 py-2 text-xs font-semibold rounded-xl bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors shadow-sm"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Accept &amp; Receive</span>
          </button>
        </div>
      </div>
    </Modal>
  );
};
