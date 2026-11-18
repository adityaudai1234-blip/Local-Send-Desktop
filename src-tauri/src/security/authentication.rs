use chrono::Utc;
use rand::rngs::OsRng;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::identity::IdentityManager;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthChallenge {
    pub session_id: String,
    pub challenger_device_id: String,
    pub nonce_hex: String,
    pub ephemeral_x25519_pub_hex: String,
    pub timestamp: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthProof {
    pub session_id: String,
    pub responder_device_id: String,
    pub responder_public_key_hex: String,
    pub responder_fingerprint: String,
    pub responder_key_version: u32,
    pub ephemeral_x25519_pub_hex: String,
    pub nonce_hex: String,
    pub signature_hex: String,
    pub timestamp: i64,
}

impl AuthChallenge {
    pub fn new(session_id: String, challenger_device_id: String, ephemeral_x25519_pub_hex: String) -> Self {
        let mut nonce = [0u8; 32];
        OsRng.fill_bytes(&mut nonce);
        Self {
            session_id,
            challenger_device_id,
            nonce_hex: hex::encode(nonce),
            ephemeral_x25519_pub_hex,
            timestamp: Utc::now().timestamp_millis(),
        }
    }
}

/// Computes canonical authentication transcript signed by Ed25519 identity key.
/// Binds both peers' ephemeral X25519 keys, session ID, and challenge nonce to prevent MitM.
pub fn build_auth_transcript(
    session_id: &str,
    challenger_nonce_hex: &str,
    challenger_x25519_hex: &str,
    responder_x25519_hex: &str,
    responder_device_id: &str,
) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(b"beamdrop-auth-v1|");
    hasher.update(session_id.as_bytes());
    hasher.update(b"|");
    hasher.update(challenger_nonce_hex.as_bytes());
    hasher.update(b"|");
    hasher.update(challenger_x25519_hex.as_bytes());
    hasher.update(b"|");
    hasher.update(responder_x25519_hex.as_bytes());
    hasher.update(b"|");
    hasher.update(responder_device_id.as_bytes());
    hasher.finalize().to_vec()
}

pub fn create_auth_proof(
    identity: &IdentityManager,
    challenge: &AuthChallenge,
    responder_x25519_pub_hex: &str,
) -> AuthProof {
    let pub_id = identity.get_public_identity();
    let transcript = build_auth_transcript(
        &challenge.session_id,
        &challenge.nonce_hex,
        &challenge.ephemeral_x25519_pub_hex,
        responder_x25519_pub_hex,
        &pub_id.device_id,
    );
    let sig_bytes = identity.sign_payload(&transcript);

    AuthProof {
        session_id: challenge.session_id.clone(),
        responder_device_id: pub_id.device_id,
        responder_public_key_hex: pub_id.public_key_hex,
        responder_fingerprint: pub_id.fingerprint,
        responder_key_version: pub_id.key_version,
        ephemeral_x25519_pub_hex: responder_x25519_pub_hex.to_string(),
        nonce_hex: challenge.nonce_hex.clone(),
        signature_hex: hex::encode(sig_bytes),
        timestamp: Utc::now().timestamp_millis(),
    }
}

pub fn verify_auth_proof(challenge: &AuthChallenge, proof: &AuthProof) -> Result<bool, String> {
    if proof.session_id != challenge.session_id {
        return Err("Authentication proof session mismatch".to_string());
    }
    if proof.nonce_hex != challenge.nonce_hex {
        return Err("Authentication proof challenge nonce mismatch".to_string());
    }
    let now = Utc::now().timestamp_millis();
    if (now - proof.timestamp).abs() > 120_000 {
        return Err("Authentication proof timestamp outside +-120s window".to_string());
    }

    let sig_bytes = hex::decode(&proof.signature_hex)
        .map_err(|_| "Invalid signature hex in auth proof".to_string())?;
    let transcript = build_auth_transcript(
        &challenge.session_id,
        &challenge.nonce_hex,
        &challenge.ephemeral_x25519_pub_hex,
        &proof.ephemeral_x25519_pub_hex,
        &proof.responder_device_id,
    );

    IdentityManager::verify_peer_signature(&transcript, &sig_bytes, &proof.responder_public_key_hex)
}
