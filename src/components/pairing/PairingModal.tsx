import React, { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Modal } from '../common/Modal';
import { usePairingStore } from '../../stores/pairingStore';
import { QrPayload } from '../../types/pairing';
import { Copy, Check, Clock, ShieldCheck, AlertCircle } from 'lucide-react';

interface PairingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PairingModal: React.FC<PairingModalProps> = ({ isOpen, onClose }) => {
  const { activeSession, createSession, cancelSession, isLoading } = usePairingStore();
  const [timeLeft, setTimeLeft] = useState<number>(300);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isOpen) {
      createSession();
    } else {
      cancelSession();
    }
  }, [isOpen, createSession, cancelSession]);

  useEffect(() => {
    if (!activeSession) return;

    const updateTimer = () => {
      const remainingMs = Math.max(0, activeSession.expiresAt - Date.now());
      const remainingSec = Math.floor(remainingMs / 1000);
      setTimeLeft(remainingSec);
      if (remainingSec <= 0) {
        cancelSession();
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [activeSession, cancelSession]);

  if (!isOpen) return null;

  const qrPayload: QrPayload | null = activeSession
    ? {
        protocol: 'beamdrop-pairing',
        version: '1.0',
        sessionId: activeSession.sessionId,
        deviceId: activeSession.localDeviceId,
        deviceName: activeSession.localDeviceName,
        ipAddress: activeSession.ipAddress,
        port: activeSession.port,
        publicKey: activeSession.publicKey,
        fingerprint: activeSession.fingerprint,
        verificationCode: activeSession.verificationCode,
        expiresAt: activeSession.expiresAt,
      }
    : null;

  const qrString = qrPayload ? JSON.stringify(qrPayload) : '';

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleCopyPayload = () => {
    if (!qrString) return;
    navigator.clipboard.writeText(qrString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Pair New Device"
      description="Scan with the BeamDrop Android app or another desktop client on this Wi-Fi network."
    >
      <div className="space-y-5">
        {/* QR Code Container */}
        <div className="flex flex-col items-center justify-center p-6 rounded-xl bg-white dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800">
          {isLoading || !activeSession ? (
            <div className="w-56 h-56 flex flex-col items-center justify-center text-xs text-neutral-500">
              <div className="w-8 h-8 rounded-full border-2 border-cyan-500 border-t-transparent animate-spin mb-3" />
              <span>Generating ephemeral Ed25519 session...</span>
            </div>
          ) : timeLeft <= 0 ? (
            <div className="w-56 h-56 flex flex-col items-center justify-center text-center p-4">
              <AlertCircle className="w-8 h-8 text-rose-500 mb-2" />
              <p className="text-xs font-semibold text-neutral-900 dark:text-white">Session Expired</p>
              <p className="text-[11px] text-neutral-500 mt-1">For your security, pairing sessions expire after 5 minutes.</p>
              <button
                onClick={() => createSession()}
                className="mt-3 px-3 py-1.5 text-xs font-medium rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-800 transition-colors"
              >
                Regenerate QR
              </button>
            </div>
          ) : (
            <div className="p-3 bg-white rounded-xl shadow-xs">
              <QRCodeSVG
                value={qrString}
                size={220}
                level="M"
                includeMargin={false}
              />
            </div>
          )}

          {activeSession && timeLeft > 0 && (
            <div className="mt-4 flex items-center justify-between w-full max-w-[260px] text-xs">
              <span className="flex items-center gap-1.5 text-neutral-500 dark:text-neutral-400">
                <Clock className="w-3.5 h-3.5 text-cyan-500" />
                <span>Expires in</span>
              </span>
              <span className={`font-mono font-medium tabular-nums ${timeLeft < 30 ? 'text-rose-500' : 'text-neutral-900 dark:text-white'}`}>
                {formatTimer(timeLeft)}
              </span>
            </div>
          )}
        </div>

        {/* Verification Code Box (Human visual Short Authentication String) */}
        {activeSession && (
          <div className="p-3.5 rounded-xl bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-200/80 dark:border-neutral-700/60 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-500" />
                <span className="text-xs font-semibold text-neutral-900 dark:text-white">
                  Visual Verification Code
                </span>
              </div>
              <span className="px-2.5 py-0.5 rounded font-mono font-bold text-sm tracking-widest bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white border border-neutral-200 dark:border-neutral-700 shadow-xs">
                {activeSession.verificationCode}
              </span>
            </div>
            <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
              Ensure this 6-digit number matches the scanner screen before accepting.
            </p>
          </div>
        )}

        {/* Copy Payload & Actions */}
        <div className="flex items-center justify-between pt-1">
          <button
            onClick={handleCopyPayload}
            disabled={!activeSession}
            className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Payload Copied' : 'Copy Pairing Token'}</span>
          </button>

          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-medium rounded-lg text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
          >
            Cancel Session
          </button>
        </div>
      </div>
    </Modal>
  );
};
