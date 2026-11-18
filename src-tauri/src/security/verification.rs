use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum VerificationStatus {
    Verified,
    Unverified,
    IdentityChanged,
    Revoked,
}

impl VerificationStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            VerificationStatus::Verified => "verified",
            VerificationStatus::Unverified => "unverified",
            VerificationStatus::IdentityChanged => "identity_changed",
            VerificationStatus::Revoked => "revoked",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IdentityPinOutcome {
    TrustedMatch,
    IdentityChanged {
        expected_fingerprint: String,
        received_fingerprint: String,
    },
    Revoked,
    NotTrusted,
}

/// Evaluates whether a connecting/pairing device matches the pinned Ed25519 public key
/// stored in TrustedDeviceManager, blocking silent identity swaps.
pub fn check_pinned_identity(
    device_id: &str,
    presented_public_key: &str,
    presented_fingerprint: &str,
    is_revoked: bool,
    stored_public_key: Option<&str>,
    stored_fingerprint: Option<&str>,
    stored_verification_status: Option<&str>,
) -> IdentityPinOutcome {
    if is_revoked || stored_verification_status == Some("revoked") {
        let _ = device_id;
        return IdentityPinOutcome::Revoked;
    }

    match (stored_public_key, stored_fingerprint) {
        (Some(expected_pk), Some(expected_fp)) => {
            if expected_pk == presented_public_key
                && expected_fp.eq_ignore_ascii_case(presented_fingerprint)
            {
                IdentityPinOutcome::TrustedMatch
            } else {
                IdentityPinOutcome::IdentityChanged {
                    expected_fingerprint: expected_fp.to_string(),
                    received_fingerprint: presented_fingerprint.to_string(),
                }
            }
        }
        _ => IdentityPinOutcome::NotTrusted,
    }
}

/// Tracks pairing session nonces/IDs to prevent replaying completed pairing payloads.
pub struct PairingReplayGuard {
    consumed_session_ids: Mutex<HashSet<String>>,
}

impl PairingReplayGuard {
    pub fn new() -> Self {
        Self {
            consumed_session_ids: Mutex::new(HashSet::new()),
        }
    }

    pub fn is_consumed(&self, session_id: &str) -> bool {
        self.consumed_session_ids.lock().unwrap().contains(session_id)
    }

    pub fn mark_consumed(&self, session_id: &str) {
        self.consumed_session_ids
            .lock()
            .unwrap()
            .insert(session_id.to_string());
    }
}
