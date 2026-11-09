import React, { useState, useEffect } from 'react';
import { Modal } from '../common/Modal';
import { PeerConnection } from '../../types/networking';
import { useConnectionStore } from '../../stores/connectionStore';
import { PlatformIcon } from '../common/PlatformIcon';
import { getPlatformLabel, formatRelativeTime, formatBytes } from '../../utils/formatters';
import {
  Activity,
  CheckCircle2,
  Clock,
  RefreshCw,
  Send,
  ShieldCheck,
  Wifi,
  WifiOff,
  XCircle,
  AlertTriangle,
} from 'lucide-react';

interface ConnectionDetailsModalProps {
  connection: PeerConnection | null;
  isOpen: boolean;
  onClose: () => void;
}

export const ConnectionDetailsModal: React.FC<ConnectionDetailsModalProps> = ({
  connection,
  isOpen,
  onClose,
}) => {
  const {
    connectDevice,
    disconnectDevice,
    reconnectDevice,
    sendMessage,
    isLoading,
  } = useConnectionStore();

  const [testPayload, setTestPayload] = useState('Hello from BeamDrop desktop!');
  const [durationString, setDurationString] = useState('00:00:00');

  useEffect(() => {
    if (!connection || !connection.connectedAt) {
      setDurationString('--');
      return;
    }

    const updateTimer = () => {
      const elapsedSec = Math.floor((Date.now() - connection.connectedAt!) / 1000);
      const hrs = Math.floor(elapsedSec / 3600);
      const mins = Math.floor((elapsedSec % 3600) / 60);
      const secs = elapsedSec % 60;
      setDurationString(
        `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
      );
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [connection]);

  if (!connection) return null;

  const isConnected = connection.state === 'connected';

  const handleSendPing = async () => {
    await sendMessage(connection.deviceId, 'PING', {
      customMessage: testPayload,
      sentAt: Date.now(),
    });
  };

  const handleToggleConnect = async () => {
    if (isConnected) {
      await disconnectDevice(connection.deviceId);
    } else {
      await connectDevice({
        id: connection.deviceId,
        name: connection.deviceName,
        platform: connection.platform,
        ipAddress: connection.ipAddress,
        port: connection.port,
      });
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Connection Specifications"
      description="Real-time peer TCP socket telemetry and heartbeat status."
    >
      <div className="space-y-4">
        {/* Device Profile Header */}
        <div className="flex items-center gap-3.5 p-3.5 rounded-xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700">
          <div className="w-11 h-11 rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 flex items-center justify-center text-neutral-800 dark:text-neutral-200 shadow-xs shrink-0">
            <PlatformIcon platform={connection.platform} className="w-6 h-6" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-neutral-900 dark:text-white truncate">
                {connection.deviceName}
              </h4>
              {/* Connection Status Pill */}
              <span
                className={`flex items-center gap-1 text-[11px] font-medium ${
                  isConnected
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : connection.state === 'connecting' || connection.state === 'authenticating'
                    ? 'text-cyan-500'
                    : connection.state === 'reconnecting'
                    ? 'text-amber-500'
                    : 'text-neutral-400'
                }`}
              >
                {isConnected && <CheckCircle2 className="w-3.5 h-3.5" />}
                {connection.state === 'reconnecting' && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                {connection.state.toUpperCase()}
              </span>
            </div>

            <p className="text-xs text-neutral-500 font-mono mt-0.5">
              {connection.ipAddress}:{connection.port}
            </p>
          </div>
        </div>

        {/* Live Metrics Grid */}
        <div className="grid grid-cols-2 gap-2.5 text-xs">
          <div className="p-3 rounded-lg border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900/60">
            <span className="text-neutral-500 block mb-1">Session Duration</span>
            <span className="font-mono font-bold text-sm tabular-nums text-neutral-900 dark:text-white">
              {durationString}
            </span>
          </div>

          <div className="p-3 rounded-lg border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900/60">
            <span className="text-neutral-500 block mb-1">Round-trip Latency</span>
            <span className="font-mono font-bold text-sm tabular-nums text-neutral-900 dark:text-white flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-emerald-500" />
              {connection.latencyMs} ms
            </span>
          </div>

          <div className="p-3 rounded-lg border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900/60">
            <span className="text-neutral-500 block mb-1">Bytes Transferred</span>
            <span className="font-mono font-semibold text-neutral-800 dark:text-neutral-200">
              Tx: {formatBytes(connection.txBytes)} · Rx: {formatBytes(connection.rxBytes)}
            </span>
          </div>

          <div className="p-3 rounded-lg border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900/60">
            <span className="text-neutral-500 block mb-1">Last Heartbeat</span>
            <span className="font-mono text-neutral-700 dark:text-neutral-300">
              {formatRelativeTime(connection.lastHeartbeat)}
            </span>
          </div>
        </div>

        {/* Send Test Control Frame */}
        {isConnected && (
          <div className="p-3.5 rounded-xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900/60 space-y-2">
            <span className="text-xs font-semibold text-neutral-900 dark:text-white block">
              Send Diagnostic Message
            </span>
            <div className="flex gap-2">
              <input
                type="text"
                value={testPayload}
                onChange={(e) => setTestPayload(e.target.value)}
                className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white"
                placeholder="Message payload..."
              />
              <button
                onClick={handleSendPing}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-800 transition-colors"
              >
                <Send className="w-3 h-3" />
                <span>Dispatch</span>
              </button>
            </div>
            <p className="text-[10px] text-neutral-400">
              Dispatches an encrypted AES-256-GCM control frame to the remote peer socket.
            </p>
          </div>
        )}

        {/* Action Controls */}
        <div className="flex items-center justify-between pt-2">
          <button
            onClick={() => reconnectDevice(connection.deviceId)}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors disabled:opacity-50"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Force Reconnect</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3.5 py-1.5 text-xs font-medium rounded-lg text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white"
            >
              Close
            </button>

            <button
              onClick={handleToggleConnect}
              disabled={isLoading}
              className={`px-4 py-1.5 text-xs font-medium rounded-lg transition-colors shadow-xs ${
                isConnected
                  ? 'bg-rose-600 text-white hover:bg-rose-700'
                  : 'bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-800'
              }`}
            >
              {isConnected ? 'Disconnect Socket' : 'Connect Peer'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
