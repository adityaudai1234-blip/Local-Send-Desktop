import { Platform, DeviceType } from '../types/device';

export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export function formatSpeed(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '0 B/s';
  if (bytesPerSec < 1024) return `${Math.round(bytesPerSec)} B/s`;
  const k = 1024;
  const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s', 'TB/s'];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytesPerSec) / Math.log(k)));
  const decimals = i >= 2 ? 1 : 0;
  return `${parseFloat((bytesPerSec / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
}

export function formatEta(seconds?: number | null, reliable = true): string {
  if (!reliable || seconds === undefined || seconds === null || !Number.isFinite(seconds) || seconds < 0) {
    return 'Calculating...';
  }
  if (seconds === 0) return '< 1s';
  const rounded = Math.ceil(seconds);
  if (rounded < 60) return `${rounded}s`;
  const mins = Math.floor(rounded / 60);
  const secs = rounded % 60;
  if (mins < 60) {
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  }
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
}

export function formatChunkSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '256 KB';
  if (bytes >= 1024 * 1024) {
    return `${parseFloat((bytes / (1024 * 1024)).toFixed(1))} MB`;
  }
  return `${Math.round(bytes / 1024)} KB`;
}

export function formatRelativeTime(timestamp: number): string {
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 5) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export function formatDateTime(timestamp: number): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

export function getPlatformLabel(platform: Platform): string {
  switch (platform) {
    case 'macos':
      return 'macOS';
    case 'windows':
      return 'Windows';
    case 'linux':
      return 'Linux';
    case 'android':
      return 'Android';
    case 'ios':
      return 'iOS';
    case 'web':
      return 'Web Browser';
    default:
      return 'Unknown OS';
  }
}

export function getDeviceTypeLabel(type: DeviceType): string {
  switch (type) {
    case 'desktop':
      return 'Desktop';
    case 'mobile':
      return 'Mobile';
    case 'tablet':
      return 'Tablet';
    case 'server':
      return 'Server';
    case 'headless':
      return 'Headless';
    default:
      return 'Device';
  }
}
