use chrono::Utc;
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use rand::rngs::OsRng;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use zeroize::Zeroize;

use super::key_store::{SecureKeyStore, SecureStorageStatus};
use super::keys::compute_fingerprint;
use crate::audit::{IdentityMetadataRecord, SecurityRepository};

/// Public-only identity projection safe to expose to React / peers.
/// NEVER contains private key bytes or seeds.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceIdentityPublic {
    pub device_id: String,
    pub public_key_hex: String,
    pub fingerprint: String,
    pub key_version: u32,
    pub created_at: i64,
    pub rotated_at: Option<i64>,
    pub algorithm: String,
    pub storage_mode: String,
}

struct IdentitySecretState {
    signing_key: SigningKey,
    public_info: DeviceIdentityPublic,
    storage_status: SecureStorageStatus,
}

impl Drop for IdentitySecretState {
    fn drop(&mut self) {
        // Note: SigningKey zeroizes internal scalars if compiled with zeroize feature,
        // and we avoid duplicating raw seed buffers outside SigningKey.
    }
}

pub struct IdentityManager {
    state: Mutex<IdentitySecretState>,
    repo: Arc<SecurityRepository>,
}

impl IdentityManager {
    pub fn new(device_id: String, repo: Arc<SecurityRepository>) -> Self {
        let existing_meta = repo.load_identity_metadata().ok().flatten();
        let mut storage_error: Option<String> = None;
        let mut ephemeral_mode = false;

        let mut seed_opt = match SecureKeyStore::load_identity_seed() {
            Ok(opt) => opt,
            Err(err) => {
                ephemeral_mode = true;
                storage_error = Some(err);
                None
            }
        };

        let mut created_at = existing_meta
            .as_ref()
            .map(|m| m.created_at)
            .unwrap_or_else(|| Utc::now().timestamp_millis());
        let mut rotated_at = existing_meta.as_ref().and_then(|m| m.rotated_at);
        let mut key_version = existing_meta.as_ref().map(|m| m.key_version).unwrap_or(1);

        let signing_key = if let Some(mut seed) = seed_opt.take() {
            let sk = SigningKey::from_bytes(&seed);
            seed.zeroize();
            sk
        } else {
            let mut new_seed = [0u8; 32];
            OsRng.fill_bytes(&mut new_seed);
            if !ephemeral_mode {
                if let Err(err) = SecureKeyStore::store_identity_seed(&new_seed) {
                    ephemeral_mode = true;
                    storage_error = Some(err);
                }
            }
            if existing_meta.is_some() {
                // Fresh seed created -> increment version & timestamp
                key_version = existing_meta.as_ref().map(|m| m.key_version + 1).unwrap_or(1);
                rotated_at = Some(Utc::now().timestamp_millis());
            } else {
                created_at = Utc::now().timestamp_millis();
            }
            let sk = SigningKey::from_bytes(&new_seed);
            new_seed.zeroize();
            sk
        };

        let pub_bytes = signing_key.verifying_key().to_bytes();
        let public_key_hex = hex::encode(pub_bytes);
        let fingerprint = compute_fingerprint(&pub_bytes);
        let storage_status = SecureKeyStore::probe_status(ephemeral_mode, storage_error.as_deref());

        let public_info = DeviceIdentityPublic {
            device_id: existing_meta
                .as_ref()
                .map(|m| m.device_id.clone())
                .unwrap_or(device_id),
            public_key_hex: public_key_hex.clone(),
            fingerprint: fingerprint.clone(),
            key_version,
            created_at,
            rotated_at,
            algorithm: "Ed25519".to_string(),
            storage_mode: storage_status.fallback_policy.clone(),
        };

        // Persist ONLY public identity metadata in SQLite (never private keys)
        let _ = repo.save_identity_metadata(&IdentityMetadataRecord {
            device_id: public_info.device_id.clone(),
            public_key_hex,
            fingerprint,
            key_version,
            created_at,
            rotated_at,
            algorithm: public_info.algorithm.clone(),
            storage_mode: public_info.storage_mode.clone(),
        });

        Self {
            state: Mutex::new(IdentitySecretState {
                signing_key,
                public_info,
                storage_status,
            }),
            repo,
        }
    }

    pub fn get_public_identity(&self) -> DeviceIdentityPublic {
        self.state.lock().unwrap().public_info.clone()
    }

    pub fn get_storage_status(&self) -> SecureStorageStatus {
        self.state.lock().unwrap().storage_status.clone()
    }

    pub fn sign_payload(&self, message: &[u8]) -> Vec<u8> {
        let guard = self.state.lock().unwrap();
        guard.signing_key.sign(message).to_bytes().to_vec()
    }

    pub fn verify_peer_signature(
        message: &[u8],
        signature_bytes: &[u8],
        peer_public_key_hex: &str,
    ) -> Result<bool, String> {
        let pub_bytes = hex::decode(peer_public_key_hex)
            .map_err(|e| format!("Invalid peer public key hex: {}", e))?;
        if pub_bytes.len() != 32 {
            return Err("Peer Ed25519 public key must be 32 bytes".to_string());
        }
        let mut fixed_pub = [0u8; 32];
        fixed_pub.copy_from_slice(&pub_bytes);
        let vk = VerifyingKey::from_bytes(&fixed_pub)
            .map_err(|e| format!("Invalid Ed25519 VerifyingKey: {}", e))?;

        if signature_bytes.len() != 64 {
            return Err("Invalid Ed25519 signature length (expected 64 bytes)".to_string());
        }
        let mut fixed_sig = [0u8; 64];
        fixed_sig.copy_from_slice(signature_bytes);
        let sig = Signature::from_bytes(&fixed_sig);

        vk.verify(message, &sig)
            .map(|_| true)
            .map_err(|_| "Ed25519 signature verification failed".to_string())
    }

    pub fn replace_signing_key(&self) -> Result<(DeviceIdentityPublic, String), String> {
        let mut new_seed = [0u8; 32];
        OsRng.fill_bytes(&mut new_seed);

        let mut ephemeral_mode = false;
        let mut err_msg: Option<String> = None;
        if let Err(err) = SecureKeyStore::store_identity_seed(&new_seed) {
            ephemeral_mode = true;
            err_msg = Some(err);
        }

        let new_signing = SigningKey::from_bytes(&new_seed);
        new_seed.zeroize();

        let pub_bytes = new_signing.verifying_key().to_bytes();
        let new_hex = hex::encode(pub_bytes);
        let new_fp = compute_fingerprint(&pub_bytes);
        let now = Utc::now().timestamp_millis();

        let mut guard = self.state.lock().unwrap();
        let previous_fp = guard.public_info.fingerprint.clone();
        guard.signing_key = new_signing;
        guard.storage_status = SecureKeyStore::probe_status(ephemeral_mode, err_msg.as_deref());
        guard.public_info.public_key_hex = new_hex.clone();
        guard.public_info.fingerprint = new_fp.clone();
        guard.public_info.key_version += 1;
        guard.public_info.rotated_at = Some(now);
        guard.public_info.storage_mode = guard.storage_status.fallback_policy.clone();

        let updated = guard.public_info.clone();
        drop(guard);

        self.repo.save_identity_metadata(&IdentityMetadataRecord {
            device_id: updated.device_id.clone(),
            public_key_hex: new_hex,
            fingerprint: new_fp,
            key_version: updated.key_version,
            created_at: updated.created_at,
            rotated_at: updated.rotated_at,
            algorithm: updated.algorithm.clone(),
            storage_mode: updated.storage_mode.clone(),
        })?;

        Ok((updated, previous_fp))
    }
}
