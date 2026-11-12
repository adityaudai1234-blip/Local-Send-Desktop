import React, { useRef, useState } from 'react';
import {
  UploadCloud,
  File,
  X,
  Send,
  CheckCircle2,
  AlertCircle,
  FileText,
  Film,
  Music,
  Image as ImageIcon,
  Archive,
  Code,
  ShieldCheck,
  Smartphone,
  Laptop,
} from 'lucide-react';
import { useTransferStore } from '../../stores/transferStore';
import { usePairingStore } from '../../stores/pairingStore';
import { useDeviceStore } from '../../stores/deviceStore';
import { formatBytes } from '../../utils/formatters';
import { PlatformIcon } from '../common/PlatformIcon';
import { DiscoveredDevice, Platform } from '../../types/device';

interface SendFilesDropzoneProps {
  onTransferStarted?: () => void;
}

export const SendFilesDropzone: React.FC<SendFilesDropzoneProps> = ({ onTransferStarted }) => {
  const {
    selectedFiles,
    addFiles,
    removeSelectedFile,
    clearSelectedFiles,
    startTransferToDevices,
    isLoading,
  } = useTransferStore();

  const { trustedDevices } = usePairingStore();
  const { discoveredDevices } = useDeviceStore();

  const [isDragging, setIsDragging] = useState(false);
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Filter available devices: merge trusted devices with discovered devices to get live IP/online status
  const availableDevices = trustedDevices.map((trusted) => {
    const live = discoveredDevices.find((d) => d.id === trusted.deviceId);
    return {
      id: trusted.deviceId,
      name: trusted.name,
      platform: trusted.platform,
      deviceModel: trusted.deviceModel,
      ipAddress: live?.ipAddress || trusted.ipAddress,
      port: live?.port || trusted.port,
      isOnline: live !== undefined || trusted.isOnline,
    };
  });

  // Also include online discovered devices even if not yet paired
  discoveredDevices.forEach((discovered) => {
    if (!availableDevices.some((d) => d.id === discovered.id)) {
      availableDevices.push({
        id: discovered.id,
        name: discovered.name,
        platform: discovered.platform,
        deviceModel: discovered.deviceModel,
        ipAddress: discovered.ipAddress,
        port: discovered.port,
        isOnline: true,
      });
    }
  });

  const totalSize = selectedFiles.reduce((acc, f) => acc + f.size, 0);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await addFiles(e.dataTransfer.files);
    }
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await addFiles(e.target.files);
      // Reset input value so same files can be re-selected if needed
      e.target.value = '';
    }
  };

  const toggleDeviceSelection = (deviceId: string) => {
    setSelectedDeviceIds((prev) =>
      prev.includes(deviceId) ? prev.filter((id) => id !== deviceId) : [...prev, deviceId]
    );
  };

  const handleSend = async () => {
    if (selectedFiles.length === 0 || selectedDeviceIds.length === 0) return;

    const targets = availableDevices.filter((d) => selectedDeviceIds.includes(d.id));
    await startTransferToDevices(targets);
    setSelectedDeviceIds([]);
    if (onTransferStarted) {
      onTransferStarted();
    }
  };

  const getFileIcon = (ext: string) => {
    switch (ext.toLowerCase()) {
      case 'jpg':
      case 'jpeg':
      case 'png':
      case 'gif':
      case 'webp':
      case 'svg':
        return <ImageIcon className="w-4 h-4 text-emerald-500" />;
      case 'mp4':
      case 'mov':
      case 'mkv':
        return <Film className="w-4 h-4 text-purple-500" />;
      case 'mp3':
      case 'wav':
      case 'flac':
        return <Music className="w-4 h-4 text-pink-500" />;
      case 'zip':
      case 'tar':
      case 'gz':
        return <Archive className="w-4 h-4 text-amber-500" />;
      case 'ts':
      case 'tsx':
      case 'js':
      case 'rs':
      case 'json':
        return <Code className="w-4 h-4 text-cyan-500" />;
      default:
        return <FileText className="w-4 h-4 text-neutral-400" />;
    }
  };

  return (
    <div className="p-6 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60 space-y-6 shadow-xs">
      {/* Title */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-white flex items-center gap-2">
            <UploadCloud className="w-4 h-4 text-cyan-500" />
            <span>Send Files Over Local Network</span>
          </h3>
          <p className="text-xs text-neutral-500 mt-0.5">
            Select or drop files to stream securely with AES-256-GCM encryption and SHA-256 verification.
          </p>
        </div>

        {selectedFiles.length > 0 && (
          <button
            onClick={() => clearSelectedFiles()}
            className="text-xs text-neutral-500 hover:text-rose-500 transition-colors"
          >
            Clear Selected ({selectedFiles.length})
          </button>
        )}
      </div>

      {/* Drag & Drop Visual Target Zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`cursor-pointer rounded-xl border-2 border-dashed p-8 transition-all flex flex-col items-center justify-center text-center ${
          isDragging
            ? 'border-cyan-500 bg-cyan-500/10 scale-[1.005]'
            : 'border-neutral-300 dark:border-neutral-700 bg-neutral-50/50 dark:bg-neutral-900/30 hover:border-neutral-400 dark:hover:border-neutral-600'
        }`}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileInputChange}
          multiple
          className="hidden"
        />

        <div className="w-12 h-12 rounded-full bg-neutral-200/70 dark:bg-neutral-800 flex items-center justify-center text-neutral-600 dark:text-neutral-300 mb-3">
          <UploadCloud className="w-6 h-6 text-cyan-500" />
        </div>

        <h4 className="text-sm font-semibold text-neutral-900 dark:text-white">
          Drag & drop files here, or <span className="text-cyan-600 dark:text-cyan-400 underline">browse</span>
        </h4>
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 max-w-sm">
          Supports multi-file selection, documents, 4K media, archives, and APKs of any size.
        </p>
      </div>

      {/* Selected Files Tray */}
      {selectedFiles.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-neutral-500">
            <span>
              Selected Files ({selectedFiles.length})
            </span>
            <span className="font-mono font-medium text-neutral-900 dark:text-white">
              Total Size: {formatBytes(totalSize)}
            </span>
          </div>

          <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
            {selectedFiles.map((file) => (
              <div
                key={file.id}
                className="flex items-center justify-between p-2.5 rounded-lg bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-200/60 dark:border-neutral-800 text-xs"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {getFileIcon(file.extension)}
                  <span className="font-medium text-neutral-900 dark:text-white truncate">
                    {file.name}
                  </span>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <span className="font-mono text-neutral-500 text-[11px]">
                    {formatBytes(file.size)}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeSelectedFile(file.id);
                    }}
                    className="p-1 rounded text-neutral-400 hover:text-rose-500 transition-colors"
                    title="Remove file"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Destination Device Selector */}
      <div className="space-y-3 pt-2 border-t border-neutral-100 dark:border-neutral-800">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-neutral-900 dark:text-white">
            Choose Destination Devices ({selectedDeviceIds.length} selected)
          </span>
          <span className="text-neutral-500">
            {availableDevices.length} available on LAN
          </span>
        </div>

        {availableDevices.length === 0 ? (
          <div className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 text-center text-xs text-neutral-500">
            No devices discovered on this Wi-Fi network yet. Open BeamDrop on Android or another desktop to send.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {availableDevices.map((device) => {
              const isSelected = selectedDeviceIds.includes(device.id);

              return (
                <div
                  key={device.id}
                  onClick={() => toggleDeviceSelection(device.id)}
                  className={`cursor-pointer p-3 rounded-xl border transition-all flex items-center justify-between ${
                    isSelected
                      ? 'border-cyan-500 bg-cyan-500/10'
                      : 'border-neutral-200 dark:border-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-700 bg-white dark:bg-neutral-900/40'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-neutral-700 dark:text-neutral-300 shrink-0">
                      <PlatformIcon platform={device.platform as Platform} className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <h5 className="text-xs font-medium text-neutral-900 dark:text-white truncate">
                        {device.name}
                      </h5>
                      <span className="text-[10px] text-neutral-500 font-mono truncate block">
                        {device.ipAddress}
                      </span>
                    </div>
                  </div>

                  <div className="shrink-0 pl-2">
                    <div
                      className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                        isSelected
                          ? 'bg-cyan-500 border-cyan-500 text-white'
                          : 'border-neutral-300 dark:border-neutral-600'
                      }`}
                    >
                      {isSelected && <CheckCircle2 className="w-3.5 h-3.5 stroke-[3]" />}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Action Send Button */}
      <div className="flex items-center justify-between pt-2 border-t border-neutral-100 dark:border-neutral-800">
        <div className="text-xs text-neutral-500">
          {selectedFiles.length > 0 && selectedDeviceIds.length > 0 ? (
            <span>
              Ready to send <span className="font-bold text-neutral-900 dark:text-white">{selectedFiles.length}</span> file(s) ({formatBytes(totalSize)}) to <span className="font-bold text-neutral-900 dark:text-white">{selectedDeviceIds.length}</span> device(s).
            </span>
          ) : (
            <span>Select files and at least one target device to start.</span>
          )}
        </div>

        <button
          onClick={handleSend}
          disabled={selectedFiles.length === 0 || selectedDeviceIds.length === 0 || isLoading}
          className="flex items-center gap-2 px-5 py-2 text-xs font-semibold rounded-xl bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all disabled:opacity-40 shadow-sm"
        >
          <Send className="w-3.5 h-3.5" />
          <span>{isLoading ? 'Sending Request...' : 'Send Files'}</span>
        </button>
      </div>
    </div>
  );
};
