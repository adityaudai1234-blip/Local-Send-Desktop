export type CipherSuite = 'chacha20-poly1305' | 'aes-256-gcm';

export interface SecureStorageStatus {
  available: boolean;
  backendName: string;
  warning?: string | null;
  fallbackPolicy: 'os_keyring' | 'ephemeral_memory_only' | string;
  identityProtected: boolean;
}

export interface DeviceIdentityPublic {
  deviceId: string;
  publicKeyHex: string;
  fingerprint: string;
  keyVersion: number;
  createdAt: number;
  rotatedAt?: number | null;
  algorithm: string;
  storageMode: string;
}

export interface SecurityPostureStatus {
  identityAlgorithm: string;
  fingerprint: string;
  keyVersion: number;
  keyExchange: string;
  cipherSuite: string;
  activeEncryptedSessions: number;
  activeVerifiedSessions: number;
  trustedDeviceCount: number;
  revokedDeviceCount: number;
  unverifiedOrWarnedCount: number;
  secureStorage: SecureStorageStatus;
  sqliteEncrypted: boolean;
  localStorageNote: string;
}

export interface TrustedDeviceSecurityInfo {
  deviceId: string;
  name: string;
  fingerprint: string;
  keyVersion: number;
  verificationStatus: 'verified' | 'unverified' | 'identity_changed' | 'revoked' | string;
  lastAuthAt?: number | null;
  firstPairedAt: number;
  securityWarning?: string | null;
  hasActiveEncryptedSession: boolean;
}

export interface SecureSessionSummary {
  sessionId: string;
  peerDeviceId: string;
  peerFingerprint: string;
  cipherSuite: CipherSuite | string;
  sasCode: string;
  isAuthenticated: boolean;
  establishedAt: number;
  expiresAt: number;
  txMessages: number;
  rxMessages: number;
  txChunks: number;
}

export interface SecurityPrivacySettings {
  hideDeviceName: boolean;
  discoveryEnabled: boolean;
  allowIncomingPairing: boolean;
  requireTransferApproval: boolean;
  autoAcceptFromTrusted: boolean;
  strictIdentityPinning: boolean;
  downloadDirectory: string;
  notificationsEnabled: boolean;
}

export type SecurityEventType =
  | 'DevicePaired'
  | 'DeviceUnpaired'
  | 'DeviceRevoked'
  | 'DeviceVerified'
  | 'AuthSuccess'
  | 'AuthFailed'
  | 'IdentityChangeDetected'
  | 'InvalidMessageRejected'
  | 'ReplayAttemptDetected'
  | 'TransferIntegrityFailure'
  | 'SecureSessionEstablished'
  | 'SecureSessionTerminated'
  | 'KeyRotated'
  | 'FilesystemBlocked'
  | 'PrivacySettingChanged'
  | 'SecuritySelfTest';

export type SecuritySeverity = 'info' | 'warning' | 'critical';

export interface SecurityAuditEvent {
  eventId: string;
  eventType: SecurityEventType;
  severity: SecuritySeverity;
  deviceId?: string | null;
  deviceName?: string | null;
  summary: string;
  details?: string | null;
  timestamp: number;
}

export interface SecurityEventFilter {
  query?: string;
  eventType?: string;
  severity?: string;
  deviceId?: string;
  limit?: number;
}

export interface KeyRotationResult {
  identity: DeviceIdentityPublic;
  previousFingerprint: string;
  rotatedAt: number;
}

export interface SecuritySelfTestCheck {
  id: string;
  name: string;
  passed: boolean;
  details: string;
}

export interface SecuritySelfTestReport {
  passedAll: boolean;
  ranAt: number;
  checks: SecuritySelfTestCheck[];
}
