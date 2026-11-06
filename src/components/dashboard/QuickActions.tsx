import React, { useState } from 'react';
import { UploadCloud, DownloadCloud, RefreshCw, Info } from 'lucide-react';
import { useDeviceStore } from '../../stores/deviceStore';
import { Modal } from '../common/Modal';

interface QuickActionsProps {
  onSelectSend: () => void;
}

export const QuickActions: React.FC<QuickActionsProps> = ({ onSelectSend }) => {
  const { refreshDevices, isSearching } = useDeviceStore();
  const [modalState, setModalState] = useState<{ isOpen: boolean; title: string; description: string } | null>(null);

  const handleReceiveClick = () => {
    setModalState({
      isOpen: true,
      title: 'Incoming File Listener Active',
      description: 'Your device is actively listening for incoming TCP transfers on port 53317. When a peer sends a file, a prompt will appear asking for authorization.',
    });
  };

  return (
    <>
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
          Quick Actions
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Send Files */}
          <button
            onClick={onSelectSend}
            className="flex items-center gap-3 p-3.5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60 hover:border-neutral-300 dark:hover:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800/40 transition-all text-left"
          >
            <div className="w-10 h-10 rounded-lg bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-neutral-800 dark:text-neutral-200 shrink-0">
              <UploadCloud className="w-5 h-5 text-cyan-500" />
            </div>
            <div>
              <h4 className="text-sm font-medium text-neutral-900 dark:text-white leading-tight">
                Send Files
              </h4>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                Pick files to beam
              </p>
            </div>
          </button>

          {/* Receive Files */}
          <button
            onClick={handleReceiveClick}
            className="flex items-center gap-3 p-3.5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60 hover:border-neutral-300 dark:hover:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800/40 transition-all text-left"
          >
            <div className="w-10 h-10 rounded-lg bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-neutral-800 dark:text-neutral-200 shrink-0">
              <DownloadCloud className="w-5 h-5 text-emerald-500" />
            </div>
            <div>
              <h4 className="text-sm font-medium text-neutral-900 dark:text-white leading-tight">
                Receive Files
              </h4>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                Ready for incoming
              </p>
            </div>
          </button>

          {/* Refresh Devices */}
          <button
            onClick={() => refreshDevices()}
            disabled={isSearching}
            className="flex items-center gap-3 p-3.5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60 hover:border-neutral-300 dark:hover:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800/40 transition-all text-left disabled:opacity-60"
          >
            <div className="w-10 h-10 rounded-lg bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-neutral-800 dark:text-neutral-200 shrink-0">
              <RefreshCw className={`w-5 h-5 text-neutral-600 dark:text-neutral-300 ${isSearching ? 'animate-spin' : ''}`} />
            </div>
            <div>
              <h4 className="text-sm font-medium text-neutral-900 dark:text-white leading-tight">
                Refresh Devices
              </h4>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                Query mDNS multicast
              </p>
            </div>
          </button>
        </div>
      </div>

      {modalState && (
        <Modal
          isOpen={modalState.isOpen}
          onClose={() => setModalState(null)}
          title={modalState.title}
          description="Phase 1 Protocol State"
        >
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3.5 rounded-lg bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-200/80 dark:border-neutral-700/60 text-xs text-neutral-600 dark:text-neutral-300">
              <Info className="w-4 h-4 text-cyan-500 shrink-0 mt-0.5" />
              <p>{modalState.description}</p>
            </div>

            <div className="text-xs text-neutral-500 space-y-1">
              <p>• Listening Port: <span className="font-mono text-neutral-800 dark:text-neutral-200">53317</span></p>
              <p>• Protocol Handshake: <span className="font-mono text-neutral-800 dark:text-neutral-200">BeamDrop v1.0 / LocalSend JSON</span></p>
              <p>• Full chunked socket transfer and TLS certificate authentication will be wired in Phase 2.</p>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setModalState(null)}
                className="px-4 py-1.5 text-xs font-medium rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors"
              >
                Understood
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
};
