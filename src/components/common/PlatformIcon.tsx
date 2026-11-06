import React from 'react';
import { Laptop, Smartphone, Tablet, Server, Globe, Monitor } from 'lucide-react';
import { Platform, DeviceType } from '../../types/device';

interface PlatformIconProps {
  platform?: Platform;
  deviceType?: DeviceType;
  className?: string;
}

export const PlatformIcon: React.FC<PlatformIconProps> = ({
  platform,
  deviceType,
  className = 'w-5 h-5',
}) => {
  // Mobile / Phone
  if (platform === 'android' || platform === 'ios' || deviceType === 'mobile') {
    return <Smartphone className={className} />;
  }

  // Tablet
  if (deviceType === 'tablet') {
    return <Tablet className={className} />;
  }

  // Server
  if (deviceType === 'server' || deviceType === 'headless') {
    return <Server className={className} />;
  }

  // Web Browser
  if (platform === 'web') {
    return <Globe className={className} />;
  }

  // Desktop / Laptop
  if (platform === 'macos' || platform === 'windows' || platform === 'linux') {
    return <Laptop className={className} />;
  }

  return <Monitor className={className} />;
};
