import React, { useRef, useState } from 'react';
import {
  UploadCloud,
  X,
  Send,
  CheckCircle2,
  FileText,
  Film,
  Music,
  Image as ImageIcon,
  Archive,
  Code,
  Folder,
  FolderPlus,
  ChevronDown,
  ChevronRight,
  Gauge,
} from 'lucide-react';
import { useTransferStore } from '../../stores/transferStore';
import { usePairingStore } from '../../stores/pairingStore';
import { useDeviceStore } from '../../stores/deviceStore';
import { formatBytes } from '../../utils/formatters';
import { PlatformIcon } from '../common/PlatformIcon';
import { Platform } from '../../types/device';
import { FolderFileEntry, FolderMetadata, TransferPriority } from '../../types/transfer';

interface SendFilesDropzoneProps {
  onTransferStarted?: () => void;
}

type WebkitEntry = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
  file?: (cb: (f: File) => void, err?: (e: unknown) => void) => void;
  createReader?: () => {
    readEntries: (cb: (entries: WebkitEntry[]) => void, err?: (e: unknown) => void) => void;
  };
};

async function readDirectoryEntry(
  dirEntry: WebkitEntry,
  parentPrefix: string
): Promise<{ entries: FolderFileEntry[]; dirCount: number; totalBytes: number }> {
  const entries: FolderFileEntry[] = [];
  let dirCount = 1;
  let totalBytes = 0;

  const reader = dirEntry.createReader?.();
  if (!reader) return { entries, dirCount, totalBytes };

  const readBatch = (): Promise<WebkitEntry[]> =>
    new Promise((resolve) => {
      reader.readEntries(
        (batch) => resolve(batch),
        () => resolve([])
      );
    });

  const allChildren: WebkitEntry[] = [];
  while (true) {
    const batch = await readBatch();
    if (!batch || batch.length === 0) break;
    allChildren.push(...batch);
  }

  const currentRel = parentPrefix ? `${parentPrefix}/${dirEntry.name}` : dirEntry.name;

  if (allChildren.length === 0 && parentPrefix) {
    // Preserve empty subfolder
    entries.push({
      id: 'ff-' + Math.random().toString(36).substring(2, 9),
      name: dirEntry.name,
      relativePath: currentRel,
      fullPath: dirEntry.fullPath,
      size: 0,
      mimeType: 'application/x-directory',
      isDirectory: true,
      lastModified: Date.now(),
    });
    return { entries, dirCount, totalBytes };
  }

  for (const child of allChildren) {
    if (child.isDirectory) {
      const sub = await readDirectoryEntry(child, currentRel);
      entries.push(...sub.entries);
      dirCount += sub.dirCount;
      totalBytes += sub.totalBytes;
    } else if (child.isFile && child.file) {
      const fileObj = await new Promise<File | null>((resolve) => {
        child.file?.(
          (f) => resolve(f),
          () => resolve(null)
        );
      });
      if (fileObj) {
        totalBytes += fileObj.size;
        entries.push({
          id: 'ff-' + Math.random().toString(36).substring(2, 9),
          name: fileObj.name,
          relativePath: `${currentRel}/${fileObj.name}`,
          fullPath: (fileObj as File & { path?: string }).path || `${currentRel}/${fileObj.name}`,
          size: fileObj.size,
          mimeType: fileObj.type || 'application/octet-stream',
          isDirectory: false,
          lastModified: fileObj.lastModified || Date.now(),
        });
      }
    }
  }

  return { entries, dirCount, totalBytes };
}

export const SendFilesDropzone: React.FC<SendFilesDropzoneProps> = ({ onTransferStarted }) => {
  const {
    selectedFiles,
    selectedFolders,
    selectedPriority,
    setSelectedPriority,
    addFiles,
    addFolderFromFileList,
    addScannedFolder,
    removeSelectedFile,
    removeSelectedFolder,
    clearSelectedFiles,
    clearSelectedFolders,
    startTransferToDevices,
    isLoading,
  } = useTransferStore();

  const { trustedDevices } = usePairingStore();
  const { discoveredDevices } = useDeviceStore();

  const [isDragging, setIsDragging] = useState(false);
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

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

  const filesTotalBytes = selectedFiles.reduce((acc, f) => acc + f.size, 0);
  const foldersTotalBytes = selectedFolders.reduce((acc, f) => acc + f.totalBytes, 0);
  const foldersTotalFileCount = selectedFolders.reduce((acc, f) => acc + f.totalFiles, 0);
  const grandTotalSize = filesTotalBytes + foldersTotalBytes;
  const hasPayload = selectedFiles.length > 0 || selectedFolders.length > 0;

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

    const items = e.dataTransfer.items;
    if (items && items.length > 0) {
      const regularFiles: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i] as DataTransferItem & { webkitGetAsEntry?: () => WebkitEntry | null };
        const entry = item.webkitGetAsEntry?.();
        if (entry && entry.isDirectory) {
          const scanned = await readDirectoryEntry(entry, '');
          const folderMeta: FolderMetadata = {
            folderName: entry.name,
            rootPath: `drop://${entry.name}`,
            totalFiles: scanned.entries.filter((f) => !f.isDirectory).length,
            totalFolders: scanned.dirCount,
            totalBytes: scanned.totalBytes,
            files: scanned.entries,
          };
          await addScannedFolder(folderMeta);
        } else {
          const f = item.getAsFile();
          if (f) regularFiles.push(f);
        }
      }
      if (regularFiles.length > 0) {
        await addFiles(regularFiles);
      }
      return;
    }

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await addFiles(e.dataTransfer.files);
    }
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await addFiles(e.target.files);
      e.target.value = '';
    }
  };

  const handleFolderInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await addFolderFromFileList(e.target.files);
      e.target.value = '';
    }
  };

  const toggleDeviceSelection = (deviceId: string) => {
    setSelectedDeviceIds((prev) =>
      prev.includes(deviceId) ? prev.filter((id) => id !== deviceId) : [...prev, deviceId]
    );
  };

  const handleSend = async () => {
    if (!hasPayload || selectedDeviceIds.length === 0) return;

    const targets = availableDevices.filter((d) => selectedDeviceIds.includes(d.id));
    await startTransferToDevices(targets);
    setSelectedDeviceIds([]);
    if (onTransferStarted) {
      onTransferStarted();
    }
  };

  const handleClearAll = async () => {
    await clearSelectedFiles();
    await clearSelectedFolders();
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
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-white flex items-center gap-2">
            <UploadCloud className="w-4 h-4 text-cyan-500" />
            <span>Send Files & Folders Over Local Network</span>
          </h3>
          <p className="text-xs text-neutral-500 mt-0.5">
            Drop files or entire folder hierarchies. Preserves nested paths &amp; empty directories with SHA-256 verification.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => folderInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors"
          >
            <FolderPlus className="w-3.5 h-3.5 text-amber-500" />
            <span>Select Folder</span>
          </button>

          {hasPayload && (
            <button
              type="button"
              onClick={handleClearAll}
              className="text-xs text-neutral-500 hover:text-rose-500 px-2 py-1 transition-colors"
            >
              Clear All
            </button>
          )}
        </div>
      </div>

      {/* Drag & Drop Target Zone */}
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
        <input
          type="file"
          ref={folderInputRef}
          onChange={handleFolderInputChange}
          multiple
          {...({ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>)}
          className="hidden"
        />

        <div className="w-12 h-12 rounded-full bg-neutral-200/70 dark:bg-neutral-800 flex items-center justify-center text-neutral-600 dark:text-neutral-300 mb-3">
          <UploadCloud className="w-6 h-6 text-cyan-500" />
        </div>

        <h4 className="text-sm font-semibold text-neutral-900 dark:text-white">
          Drag &amp; drop files or folders here, or <span className="text-cyan-600 dark:text-cyan-400 underline">browse files</span>
        </h4>
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 max-w-md">
          Supports recursive directory structures, empty subfolders, multi-file batches, and streaming large archives without memory bloat.
        </p>
      </div>

      {/* Selected Folders Tray */}
      {selectedFolders.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-neutral-500">
            <span className="font-medium text-neutral-700 dark:text-neutral-300">
              Selected Folders ({selectedFolders.length} · {foldersTotalFileCount} files)
            </span>
            <span className="font-mono font-medium text-neutral-900 dark:text-white">
              Folders Size: {formatBytes(foldersTotalBytes)}
            </span>
          </div>

          <div className="space-y-2">
            {selectedFolders.map((folder) => {
              const isExpanded = Boolean(expandedFolders[folder.rootPath]);
              return (
                <div
                  key={folder.rootPath}
                  className="rounded-xl bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-200/70 dark:border-neutral-800 overflow-hidden"
                >
                  <div className="flex items-center justify-between p-3 text-xs">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedFolders((prev) => ({
                          ...prev,
                          [folder.rootPath]: !prev[folder.rootPath],
                        }))
                      }
                      className="flex items-center gap-2.5 min-w-0 text-left"
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                      )}
                      <Folder className="w-4 h-4 text-amber-500 shrink-0" />
                      <div className="min-w-0">
                        <span className="font-semibold text-neutral-900 dark:text-white truncate block">
                          {folder.folderName}/
                        </span>
                        <span className="text-[11px] text-neutral-500">
                          {folder.totalFiles} file(s) · {folder.totalFolders} folder(s)
                        </span>
                      </div>
                    </button>

                    <div className="flex items-center gap-3 shrink-0">
                      <span className="font-mono text-neutral-600 dark:text-neutral-300 text-[11px]">
                        {formatBytes(folder.totalBytes)}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeSelectedFolder(folder.rootPath)}
                        className="p-1 rounded text-neutral-400 hover:text-rose-500 transition-colors"
                        title="Remove folder"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="max-h-36 overflow-y-auto border-t border-neutral-200/60 dark:border-neutral-700/60 bg-white/60 dark:bg-neutral-900/40 px-4 py-2 space-y-1 text-[11px] font-mono">
                      {folder.files.slice(0, 30).map((entry) => (
                        <div key={entry.id} className="flex items-center justify-between text-neutral-600 dark:text-neutral-400">
                          <span className="truncate pr-3">
                            {entry.isDirectory ? `📁 ${entry.relativePath}/` : entry.relativePath}
                          </span>
                          <span className="shrink-0 text-neutral-400">
                            {entry.isDirectory ? 'dir' : formatBytes(entry.size)}
                          </span>
                        </div>
                      ))}
                      {folder.files.length > 30 && (
                        <p className="text-neutral-400 pt-1">
                          + {folder.files.length - 30} more entries in directory tree
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Selected Files Tray */}
      {selectedFiles.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-neutral-500">
            <span>Selected Files ({selectedFiles.length})</span>
            <span className="font-mono font-medium text-neutral-900 dark:text-white">
              Files Size: {formatBytes(filesTotalBytes)}
            </span>
          </div>

          <div className="max-h-44 overflow-y-auto space-y-1.5 pr-1">
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
                    type="button"
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

      {/* Destination Device Selector & Priority */}
      <div className="space-y-4 pt-2 border-t border-neutral-100 dark:border-neutral-800">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
          <span className="font-semibold text-neutral-900 dark:text-white">
            Choose Destination Devices ({selectedDeviceIds.length} selected)
          </span>

          <div className="flex items-center gap-2">
            <span className="text-neutral-500 flex items-center gap-1">
              <Gauge className="w-3.5 h-3.5" />
              Queue Priority:
            </span>
            <div className="inline-flex rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/70 p-0.5">
              {(['low', 'normal', 'high'] as TransferPriority[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setSelectedPriority(p)}
                  className={`px-2.5 py-1 rounded-md capitalize text-[11px] font-medium transition-colors ${
                    selectedPriority === p
                      ? 'bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900'
                      : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
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
          {hasPayload && selectedDeviceIds.length > 0 ? (
            <span>
              Ready to send{' '}
              {selectedFiles.length > 0 && (
                <>
                  <span className="font-bold text-neutral-900 dark:text-white">{selectedFiles.length}</span> file(s)
                </>
              )}
              {selectedFiles.length > 0 && selectedFolders.length > 0 && ' + '}
              {selectedFolders.length > 0 && (
                <>
                  <span className="font-bold text-neutral-900 dark:text-white">{selectedFolders.length}</span> folder(s)
                </>
              )}{' '}
              ({formatBytes(grandTotalSize)}) to{' '}
              <span className="font-bold text-neutral-900 dark:text-white">{selectedDeviceIds.length}</span> device(s).
            </span>
          ) : (
            <span>Select files or folders and at least one target device to start.</span>
          )}
        </div>

        <button
          type="button"
          onClick={handleSend}
          disabled={!hasPayload || selectedDeviceIds.length === 0 || isLoading}
          className="flex items-center gap-2 px-5 py-2 text-xs font-semibold rounded-xl bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all disabled:opacity-40 shadow-sm"
        >
          <Send className="w-3.5 h-3.5" />
          <span>
            {isLoading
              ? 'Sending Request...'
              : selectedFolders.length > 0 && selectedFiles.length === 0
                ? 'Send Folders'
                : 'Send Now'}
          </span>
        </button>
      </div>
    </div>
  );
};
