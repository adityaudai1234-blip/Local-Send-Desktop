import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Modal } from '../common/Modal';
import { usePairingStore } from '../../stores/pairingStore';
import { QrPayload } from '../../types/pairing';
import { Camera, CameraOff, CheckCircle2, ShieldAlert, Sparkles, Terminal } from 'lucide-react';
import { PlatformIcon } from '../common/PlatformIcon';

interface QrScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const QrScannerModal: React.FC<QrScannerModalProps> = ({ isOpen, onClose }) => {
  const { submitPairingRequest, isLoading } = usePairingStore();
  const [activeTab, setActiveTab] = useState<'camera' | 'manual'>('camera');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scannedPayload, setScannedPayload] = useState<QrPayload | null>(null);
  const [manualText, setManualText] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Initialize camera stream when modal opens in camera mode
  useEffect(() => {
    if (!isOpen || activeTab !== 'camera' || scannedPayload) {
      stopCamera();
      return;
    }

    let isMounted = true;

    async function startCamera() {
      setCameraError(null);
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('Camera access API is not supported in this environment');
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
        });

        if (!isMounted) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.setAttribute('playsinline', 'true');
          videoRef.current.play();
          startScanningLoop();
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setCameraError(
          msg.includes('Permission') || msg.includes('NotAllowedError')
            ? 'Camera permission denied. Please grant permission or use manual payload entry.'
            : `Unable to access webcam: ${msg}`
        );
      }
    }

    startCamera();

    return () => {
      isMounted = false;
      stopCamera();
    };
  }, [isOpen, activeTab, scannedPayload]);

  const stopCamera = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const startScanningLoop = () => {
    const scan = () => {
      if (!videoRef.current || !canvasRef.current || scannedPayload) return;

      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');

      if (video.readyState === video.HAVE_ENOUGH_DATA && ctx) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert',
        });

        if (code && code.data) {
          try {
            const parsed = JSON.parse(code.data) as QrPayload;
            if (parsed.protocol === 'beamdrop-pairing' && parsed.sessionId) {
              setScannedPayload(parsed);
              stopCamera();
              return;
            }
          } catch {
            // Not a valid beamdrop QR code yet, continue scanning
          }
        }
      }

      animationFrameRef.current = requestAnimationFrame(scan);
    };

    animationFrameRef.current = requestAnimationFrame(scan);
  };

  const handleManualParse = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);
    try {
      const parsed = JSON.parse(manualText.trim()) as QrPayload;
      if (parsed.protocol !== 'beamdrop-pairing') {
        throw new Error("Invalid protocol in payload, expected 'beamdrop-pairing'");
      }
      if (!parsed.sessionId || !parsed.deviceId) {
        throw new Error('Payload is missing required session or device fields');
      }
      setScannedPayload(parsed);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setValidationError(msg);
    }
  };

  const handleConfirmPairing = async () => {
    if (!scannedPayload) return;
    const req = await submitPairingRequest(JSON.stringify(scannedPayload));
    if (req) {
      onClose();
    }
  };

  const handleReset = () => {
    setScannedPayload(null);
    setManualText('');
    setValidationError(null);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Scan Pairing QR Code"
      description="Point your webcam at the QR code displayed on the peer device."
    >
      <div className="space-y-4">
        {/* If device is scanned, show verification confirmation card */}
        {scannedPayload ? (
          <div className="space-y-4 animate-in fade-in">
            <div className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/60 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 flex items-center justify-center text-neutral-800 dark:text-neutral-200">
                  <PlatformIcon className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-neutral-900 dark:text-white">
                    {scannedPayload.deviceName}
                  </h4>
                  <p className="text-xs text-neutral-500 font-mono">
                    {scannedPayload.ipAddress}:{scannedPayload.port}
                  </p>
                </div>
              </div>

              <div className="pt-2 border-t border-neutral-200/60 dark:border-neutral-700/60 text-xs space-y-1.5 text-neutral-600 dark:text-neutral-300">
                <div className="flex justify-between">
                  <span className="text-neutral-500">Security Fingerprint:</span>
                  <span className="font-mono">{scannedPayload.fingerprint}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-500">Verification Code:</span>
                  <span className="font-mono font-bold text-sm tracking-wider text-neutral-900 dark:text-white bg-white dark:bg-neutral-900 px-2 py-0.5 rounded border border-neutral-200 dark:border-neutral-700">
                    {scannedPayload.verificationCode}
                  </span>
                </div>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>Valid ephemeral session found. Send pairing request?</span>
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={handleReset}
                className="px-3 py-1.5 text-xs font-medium rounded-lg text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white"
              >
                Scan Another
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={handleConfirmPairing}
                  className="px-4 py-1.5 text-xs font-medium rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 shadow-sm disabled:opacity-50"
                >
                  {isLoading ? 'Sending Request...' : 'Send Pairing Request'}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Input Mode Selector */}
            <div className="flex items-center gap-1 p-1 bg-neutral-100 dark:bg-neutral-800 rounded-lg w-fit text-xs">
              <button
                onClick={() => setActiveTab('camera')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-colors ${
                  activeTab === 'camera'
                    ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-xs'
                    : 'text-neutral-600 dark:text-neutral-400'
                }`}
              >
                <Camera className="w-3.5 h-3.5" />
                <span>Camera Scanner</span>
              </button>

              <button
                onClick={() => setActiveTab('manual')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-colors ${
                  activeTab === 'manual'
                    ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-xs'
                    : 'text-neutral-600 dark:text-neutral-400'
                }`}
              >
                <Terminal className="w-3.5 h-3.5" />
                <span>Paste Payload</span>
              </button>
            </div>

            {activeTab === 'camera' ? (
              <div className="space-y-3">
                {cameraError ? (
                  <div className="p-8 rounded-xl border border-dashed border-neutral-300 dark:border-neutral-800 flex flex-col items-center justify-center text-center">
                    <CameraOff className="w-8 h-8 text-neutral-400 mb-2" />
                    <p className="text-xs text-neutral-600 dark:text-neutral-300 font-medium">{cameraError}</p>
                    <button
                      onClick={() => setActiveTab('manual')}
                      className="mt-3 px-3.5 py-1.5 text-xs font-medium rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-800 transition-colors"
                    >
                      Use Manual Input
                    </button>
                  </div>
                ) : (
                  <div className="relative rounded-xl overflow-hidden bg-black aspect-4/3 flex items-center justify-center border border-neutral-800">
                    <video
                      ref={videoRef}
                      className="w-full h-full object-cover"
                      muted
                    />
                    <canvas ref={canvasRef} className="hidden" />

                    {/* Scanner Target Guide Overlay */}
                    <div className="absolute inset-0 border-2 border-cyan-500/40 m-12 rounded-lg pointer-events-none flex items-center justify-center">
                      <div className="w-full h-0.5 bg-cyan-400/80 shadow-[0_0_8px_rgba(34,211,238,0.8)] animate-pulse" />
                    </div>

                    <div className="absolute bottom-3 left-0 right-0 flex justify-center">
                      <span className="px-3 py-1 rounded-full bg-black/70 backdrop-blur-xs text-[11px] text-white">
                        Position QR code inside the box
                      </span>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <form onSubmit={handleManualParse} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                    Pairing Token / JSON Payload
                  </label>
                  <textarea
                    value={manualText}
                    onChange={(e) => {
                      setManualText(e.target.value);
                      setValidationError(null);
                    }}
                    rows={4}
                    placeholder='{"protocol":"beamdrop-pairing","sessionId":"...","publicKey":"..."}'
                    className="w-full p-2.5 text-xs font-mono rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white placeholder:text-neutral-500 focus:outline-hidden focus:ring-1 focus:ring-neutral-400"
                    required
                  />
                  {validationError && (
                    <p className="text-xs text-rose-500 mt-1">{validationError}</p>
                  )}
                </div>

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!manualText.trim()}
                    className="px-4 py-1.5 text-xs font-medium rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 shadow-sm disabled:opacity-50"
                  >
                    Verify Payload
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </Modal>
  );
};
