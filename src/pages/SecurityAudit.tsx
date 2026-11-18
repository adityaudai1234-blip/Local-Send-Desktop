import React, { useEffect, useState } from 'react';
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  Key,
  RefreshCw,
  Search,
  Trash2,
  Lock,
  Unlock,
  CheckCircle2,
  XCircle,
  Play,
  AlertTriangle,
  Database,
  Copy,
  Check,
} from 'lucide-react';
import { useSecurityStore } from '../stores/securityStore';
import { formatDateTime, formatRelativeTime } from '../utils/formatters';

export const SecurityAudit: React.FC = () => {
  const {
    posture,
    identity,
    storageStatus,
    activeSessions,
    auditEvents,
    selfTestReport,
    isLoading,
    isRunningSelfTest,
    refreshAll,
    rotateDeviceKeys,
    searchAuditEvents,
    clearAuditLog,
    runSelfTests,
  } = useSecurityStore();

  const [query, setQuery] = useState('');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [copiedFp, setCopiedFp] = useState(false);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    searchAuditEvents({
      query: query.trim() || undefined,
      severity: severityFilter,
      eventType: typeFilter,
      limit: 200,
    });
  }, [query, severityFilter, typeFilter, searchAuditEvents]);

  const handleCopyFingerprint = () => {
    if (!identity?.fingerprint) return;
    navigator.clipboard.writeText(identity.fingerprint).catch(() => undefined);
    setCopiedFp(true);
    setTimeout(() => setCopiedFp(false), 2000);
  };

  const handleConfirmRotate = async () => {
    setConfirmRotate(false);
    await rotateDeviceKeys();
  };

  const handleConfirmClear = async () => {
    setConfirmClear(false);
    await clearAuditLog();
  };

  const eventTypes = [
    'DevicePaired',
    'DeviceUnpaired',
    'DeviceRevoked',
    'DeviceVerified',
    'AuthSuccess',
    'AuthFailed',
    'IdentityChangeDetected',
    'InvalidMessageRejected',
    'ReplayAttemptDetected',
    'TransferIntegrityFailure',
    'SecureSessionEstablished',
    'SecureSessionTerminated',
    'KeyRotated',
    'FilesystemBlocked',
    'PrivacySettingChanged',
    'SecuritySelfTest',
  ];

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-white flex items-center gap-2">
            <Lock className="w-5 h-5 text-emerald-500" />
            <span>Security, Cryptography &amp; Audit Center</span>
          </h2>
          <p className="text-xs text-neutral-500">
            Verify live E2E encryption sessions, Ed25519 identity key custody, anti-replay protections, and redacted local audit events.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => refreshAll()}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>

          <button
            onClick={() => runSelfTests()}
            disabled={isRunningSelfTest}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors shadow-xs disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5" />
            <span>{isRunningSelfTest ? 'Running Checks...' : 'Run Security Self-Test'}</span>
          </button>
        </div>
      </div>

      {/* Secure Keystore Warning Banner (only shown if OS keyring unavailable) */}
      {storageStatus && !storageStatus.available && (
        <div className="p-4 rounded-xl border border-amber-500/40 bg-amber-500/10 flex items-start gap-3 text-xs">
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h4 className="font-semibold text-amber-700 dark:text-amber-300">
              OS Keyring Unavailable ({storageStatus.backendName})
            </h4>
            <p className="text-amber-700/90 dark:text-amber-300/90 leading-relaxed">
              {storageStatus.warning ||
                'Identity private key is held in ephemeral RAM only and is never written in plaintext to disk.'}
            </p>
          </div>
        </div>
      )}

      {/* Posture Summary Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60 space-y-1.5">
          <div className="flex items-center justify-between text-xs text-neutral-500">
            <span>Verified E2E Sessions</span>
            {posture && posture.activeVerifiedSessions > 0 ? (
              <ShieldCheck className="w-4 h-4 text-emerald-500" />
            ) : (
              <Unlock className="w-4 h-4 text-neutral-400" />
            )}
          </div>
          <div className="text-2xl font-semibold text-neutral-900 dark:text-white tabular-nums">
            {posture?.activeVerifiedSessions ?? 0}
          </div>
          <p className="text-[11px] text-neutral-500">
            {posture && posture.activeVerifiedSessions > 0
              ? posture.cipherSuite
              : 'No active authenticated sessions right now'}
          </p>
        </div>

        <div className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60 space-y-1.5">
          <div className="flex items-center justify-between text-xs text-neutral-500">
            <span>Identity Key Version</span>
            <Key className="w-4 h-4 text-cyan-500" />
          </div>
          <div className="text-2xl font-semibold text-neutral-900 dark:text-white tabular-nums">
            v{identity?.keyVersion ?? 1}
          </div>
          <p className="text-[11px] text-neutral-500 font-mono truncate">
            {identity?.algorithm ?? 'Ed25519'} · {identity?.fingerprint ?? '—'}
          </p>
        </div>

        <div className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60 space-y-1.5">
          <div className="flex items-center justify-between text-xs text-neutral-500">
            <span>Key Storage Custody</span>
            <Shield className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="text-sm font-semibold text-neutral-900 dark:text-white truncate pt-1">
            {storageStatus?.available ? storageStatus.backendName : 'Ephemeral RAM Only'}
          </div>
          <p className="text-[11px] text-neutral-500">
            {storageStatus?.available
              ? 'Hardware/OS keyring protected'
              : 'Plaintext disk storage blocked'}
          </p>
        </div>

        <div className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60 space-y-1.5">
          <div className="flex items-center justify-between text-xs text-neutral-500">
            <span>Trust &amp; Alerts</span>
            {posture && posture.unverifiedOrWarnedCount > 0 ? (
              <ShieldAlert className="w-4 h-4 text-rose-500" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            )}
          </div>
          <div className="text-2xl font-semibold text-neutral-900 dark:text-white tabular-nums">
            {posture?.trustedDeviceCount ?? 0}
            <span className="text-xs font-normal text-neutral-500 ml-1.5">
              trusted / {posture?.revokedDeviceCount ?? 0} revoked
            </span>
          </div>
          <p className="text-[11px] text-neutral-500">
            {posture && posture.unverifiedOrWarnedCount > 0
              ? `${posture.unverifiedOrWarnedCount} device warning(s) need attention`
              : 'All paired keys match pinned identities'}
          </p>
        </div>
      </div>

      {/* Identity Key Management + Local Storage Disclosure */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
                Local Cryptographic Identity
              </h3>
              <p className="text-xs text-neutral-500">
                Public key metadata only — private signing material never leaves the backend keyring boundary.
              </p>
            </div>
            <button
              onClick={() => setConfirmRotate(true)}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 transition-colors"
            >
              Rotate Keys
            </button>
          </div>

          {identity && (
            <div className="p-3.5 rounded-lg bg-neutral-50 dark:bg-neutral-950/60 border border-neutral-200/70 dark:border-neutral-800 space-y-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-neutral-500">Fingerprint:</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-semibold text-neutral-900 dark:text-white">
                    {identity.fingerprint}
                  </span>
                  <button
                    onClick={handleCopyFingerprint}
                    className="p-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                    title="Copy fingerprint"
                  >
                    {copiedFp ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-neutral-500">Public Key ({identity.algorithm}):</span>
                <span className="font-mono text-neutral-700 dark:text-neutral-300 truncate max-w-[260px]" title={identity.publicKeyHex}>
                  {identity.publicKeyHex}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-neutral-500">Created / Last Rotated:</span>
                <span className="text-neutral-700 dark:text-neutral-300">
                  {identity.rotatedAt ? formatDateTime(identity.rotatedAt) : formatDateTime(identity.createdAt)}
                </span>
              </div>
            </div>
          )}

          {confirmRotate && (
            <div className="p-3.5 rounded-lg border border-amber-500/40 bg-amber-500/10 text-xs space-y-2">
              <p className="font-semibold text-amber-800 dark:text-amber-300">
                Confirm Identity Key Rotation
              </p>
              <p className="text-amber-700/90 dark:text-amber-300/90">
                Rotating your local Ed25519 key increments your key version and generates a new fingerprint. Existing paired peers will flag a key change until re-verified.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setConfirmRotate(false)}
                  className="px-2.5 py-1 rounded border border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmRotate}
                  className="px-3 py-1 rounded bg-amber-600 text-white font-medium hover:bg-amber-700"
                >
                  Confirm Rotate
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Honest Storage & Protocol Boundaries */}
        <section className="p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60 space-y-3 text-xs">
          <div className="flex items-center gap-2 font-semibold text-sm text-neutral-900 dark:text-white">
            <Database className="w-4 h-4 text-cyan-500" />
            <span>Storage &amp; Protocol Security Architecture</span>
          </div>

          <div className="space-y-2 text-neutral-600 dark:text-neutral-400">
            <p className="leading-relaxed">
              {posture?.localStorageNote ||
                'Private keys live exclusively in OS secure storage inside native Tauri builds. Local SQLite stores public peer certificates, verification status, and redacted audit events.'}
            </p>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <div className="p-2.5 rounded-lg bg-neutral-50 dark:bg-neutral-950/50 border border-neutral-200/60 dark:border-neutral-800">
                <span className="font-medium text-neutral-900 dark:text-white block">Key Agreement</span>
                <span className="font-mono text-[11px]">X25519 + HKDF-SHA256</span>
              </div>
              <div className="p-2.5 rounded-lg bg-neutral-50 dark:bg-neutral-950/50 border border-neutral-200/60 dark:border-neutral-800">
                <span className="font-medium text-neutral-900 dark:text-white block">SQLite DB Encryption</span>
                <span className="font-mono text-[11px]">
                  {posture?.sqliteEncrypted ? 'SQLCipher Active' : 'Standard SQLite (Public Metadata Only)'}
                </span>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Security Self-Test Results */}
      {selfTestReport && (
        <section className="p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-white flex items-center gap-2">
              {selfTestReport.passedAll ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              ) : (
                <XCircle className="w-4 h-4 text-rose-500" />
              )}
              <span>
                On-Device Security Self-Test Results ({selfTestReport.checks.filter((c) => c.passed).length}/
                {selfTestReport.checks.length} Passed)
              </span>
            </h3>
            <span className="text-[11px] text-neutral-500">
              {formatDateTime(selfTestReport.ranAt)}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {selfTestReport.checks.map((c) => (
              <div
                key={c.id}
                className="p-3 rounded-lg border border-neutral-200/80 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-950/40 flex items-start gap-2.5 text-xs"
              >
                {c.passed ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                )}
                <div>
                  <span className="font-medium text-neutral-900 dark:text-white block">{c.name}</span>
                  <span className="text-[11px] text-neutral-500">{c.details}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Active Encrypted Sessions */}
      <section className="p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60 space-y-3">
        <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
          Active Encrypted Peer Sessions ({activeSessions.length})
        </h3>
        {activeSessions.length === 0 ? (
          <p className="text-xs text-neutral-500 py-3">
            No active encrypted peer sessions. Connect to a trusted device to establish an ephemeral X25519 + ChaCha20-Poly1305 channel.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {activeSessions.map((sess) => (
              <div
                key={sess.sessionId}
                className="p-3.5 rounded-lg border border-emerald-500/30 bg-emerald-500/5 space-y-1.5 text-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono font-semibold text-neutral-900 dark:text-white">
                    {sess.peerDeviceId}
                  </span>
                  <span className="font-mono text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                    {sess.cipherSuite}
                  </span>
                </div>
                <div className="flex justify-between text-[11px] text-neutral-500">
                  <span>Peer Fingerprint: <span className="font-mono">{sess.peerFingerprint}</span></span>
                  <span>SAS: <span className="font-mono font-semibold">{sess.sasCode}</span></span>
                </div>
                <div className="flex justify-between text-[11px] text-neutral-500">
                  <span>Control TX/RX: {sess.txMessages} / {sess.rxMessages}</span>
                  <span>Expires: {formatRelativeTime(sess.expiresAt)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Searchable Redacted Security Audit Log */}
      <section className="p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
              Security Audit Log ({auditEvents.length})
            </h3>
            <p className="text-xs text-neutral-500">
              All cryptographic secrets, tokens, and transfer payloads are redacted before persistence.
            </p>
          </div>

          <button
            onClick={() => setConfirmClear(true)}
            disabled={auditEvents.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-rose-500/30 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 transition-colors disabled:opacity-40"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear Audit Log</span>
          </button>
        </div>

        {confirmClear && (
          <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 flex items-center justify-between text-xs">
            <span className="text-rose-700 dark:text-rose-300 font-medium">
              Permanently erase local security audit events?
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setConfirmClear(false)}
                className="px-2.5 py-1 rounded border border-neutral-300 dark:border-neutral-700"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmClear}
                className="px-3 py-1 rounded bg-rose-600 text-white font-medium hover:bg-rose-700"
              >
                Erase Log
              </button>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search device ID, summary, event..."
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white focus:outline-hidden"
            />
          </div>

          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="px-3 py-1.5 text-xs rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white"
          >
            <option value="all">All Severities</option>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="critical">Critical</option>
          </select>

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-3 py-1.5 text-xs rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white"
          >
            <option value="all">All Event Types</option>
            {eventTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        {/* Events List */}
        {auditEvents.length === 0 ? (
          <div className="py-10 text-center text-xs text-neutral-500">
            No matching security audit events found.
          </div>
        ) : (
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800 border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
            {auditEvents.map((ev) => (
              <div
                key={ev.eventId}
                className="p-3.5 bg-white dark:bg-neutral-950/30 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
              >
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold uppercase ${
                        ev.severity === 'critical'
                          ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                          : ev.severity === 'warning'
                            ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                            : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      {ev.severity}
                    </span>
                    <span className="font-mono font-semibold text-neutral-900 dark:text-white">
                      {ev.eventType}
                    </span>
                    {ev.deviceName && (
                      <span className="text-neutral-500">· {ev.deviceName}</span>
                    )}
                  </div>
                  <p className="text-neutral-700 dark:text-neutral-300">{ev.summary}</p>
                  {ev.details && (
                    <p className="font-mono text-[11px] text-neutral-500 truncate">{ev.details}</p>
                  )}
                </div>

                <div className="text-[11px] text-neutral-400 shrink-0 text-right">
                  <div>{formatDateTime(ev.timestamp)}</div>
                  {ev.deviceId && <div className="font-mono">{ev.deviceId}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
