import { Platform } from './device';

export interface PairingSession {
  sessionId: string;
  localDeviceId: string;
  localDeviceName: string;
  ipAddress: string;
  port: number;
  publicKey: string;
  fingerprint: string;
  verificationCode: string;
  createdAt: number;
  expiresAt: number;
  isActive: boolean;
}

export interface QrPayload {
  protocol: string;
  version: string;
  sessionId: string;
  deviceId: string;
  deviceName: string;
  ipAddress: string;
  port: number;
  publicKey: string;
  fingerprint: string;
  verificationCode: string;
  expiresAt: number;
}

export interface PairingRequest {
  requestId: string;
  sessionId: string;
  fromDeviceId: string;
  fromDeviceName: string;
  fromPlatform: Platform;
  fromDeviceModel: string;
  fromIpAddress: string;
  fromPort: number;
  fromPublicKey: string;
  fromFingerprint: string;
  verificationCode: string;
  timestamp: number;
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
  keyVersion?: number;
  identityWarning?: string | null;
}

export interface PairingResponse {
  success: boolean;
  requestId: string;
  authToken?: string;
  message: string;
}

export interface TrustedDevice {
  deviceId: string;
  name: string;
  platform: Platform;
  deviceModel: string;
  ipAddress: string;
  port: number;
  publicKey: string;
  fingerprint: string;
  authTokenHash: string;
  firstPairedAt: number;
  lastConnectedAt: number;
  isOnline: boolean;
  trustStatus: 'trusted' | 'pending' | 'revoked';
  keyVersion?: number;
  lastAuthAt?: number | null;
  verificationStatus?: 'verified' | 'unverified' | 'identity_changed' | 'revoked' | string;
  securityWarning?: string | null;
}
