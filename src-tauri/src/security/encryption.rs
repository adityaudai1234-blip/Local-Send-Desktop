use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce as AesNonce,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chacha20poly1305::{ChaCha20Poly1305, Nonce as ChaChaNonce};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum CipherSuite {
    ChaCha20Poly1305,
    Aes256Gcm,
}

impl CipherSuite {
    pub fn as_str(&self) -> &'static str {
        match self {
            CipherSuite::ChaCha20Poly1305 => "chacha20-poly1305",
            CipherSuite::Aes256Gcm => "aes-256-gcm",
        }
    }
}

/// Wire-compatible encrypted file chunk frame shared between Desktop & Android.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptedChunkFrame {
    pub transfer_id: String,
    pub file_id: String,
    pub chunk_sequence: u64,
    pub offset: u64,
    pub nonce_hex: String,
    pub cipher_suite: CipherSuite,
    pub ciphertext_b64: String,
}

/// Wire-compatible encrypted control envelope.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptedControlEnvelope {
    pub session_id: String,
    pub message_id: String,
    pub sequence: u64,
    pub timestamp: i64,
    pub nonce_hex: String,
    pub cipher_suite: CipherSuite,
    pub ciphertext_b64: String,
}

/// Deterministic 96-bit AEAD nonce:
/// [ 4-byte channel/direction tag || 8-byte strictly monotonic big-endian sequence ]
/// Guarantees zero nonce collision within any session as long as sequences never repeat.
pub fn build_deterministic_nonce(channel_tag: [u8; 4], sequence: u64) -> [u8; 12] {
    let mut nonce = [0u8; 12];
    nonce[0..4].copy_from_slice(&channel_tag);
    nonce[4..12].copy_from_slice(&sequence.to_be_bytes());
    nonce
}

pub fn encrypt_aead(
    suite: CipherSuite,
    key: &[u8; 32],
    nonce: &[u8; 12],
    plaintext: &[u8],
    aad: &[u8],
) -> Result<Vec<u8>, String> {
    let payload = Payload {
        msg: plaintext,
        aad,
    };
    match suite {
        CipherSuite::ChaCha20Poly1305 => {
            let cipher = ChaCha20Poly1305::new_from_slice(key)
                .map_err(|_| "Invalid ChaCha20-Poly1305 key".to_string())?;
            let n = ChaChaNonce::from_slice(nonce);
            cipher
                .encrypt(n, payload)
                .map_err(|e| format!("ChaCha20-Poly1305 encryption failed: {}", e))
        }
        CipherSuite::Aes256Gcm => {
            let cipher = Aes256Gcm::new_from_slice(key)
                .map_err(|_| "Invalid AES-256-GCM key".to_string())?;
            let n = AesNonce::from_slice(nonce);
            cipher
                .encrypt(n, payload)
                .map_err(|e| format!("AES-256-GCM encryption failed: {}", e))
        }
    }
}

pub fn decrypt_aead(
    suite: CipherSuite,
    key: &[u8; 32],
    nonce: &[u8; 12],
    ciphertext: &[u8],
    aad: &[u8],
) -> Result<Vec<u8>, String> {
    let payload = Payload {
        msg: ciphertext,
        aad,
    };
    match suite {
        CipherSuite::ChaCha20Poly1305 => {
            let cipher = ChaCha20Poly1305::new_from_slice(key)
                .map_err(|_| "Invalid ChaCha20-Poly1305 key".to_string())?;
            let n = ChaChaNonce::from_slice(nonce);
            cipher
                .decrypt(n, payload)
                .map_err(|_| "AEAD authentication tag mismatch (tampered or wrong key)".to_string())
        }
        CipherSuite::Aes256Gcm => {
            let cipher = Aes256Gcm::new_from_slice(key)
                .map_err(|_| "Invalid AES-256-GCM key".to_string())?;
            let n = AesNonce::from_slice(nonce);
            cipher
                .decrypt(n, payload)
                .map_err(|_| "AEAD authentication tag mismatch (tampered or wrong key)".to_string())
        }
    }
}

pub fn encode_b64(data: &[u8]) -> String {
    BASE64.encode(data)
}

pub fn decode_b64(encoded: &str) -> Result<Vec<u8>, String> {
    BASE64
        .decode(encoded)
        .map_err(|e| format!("Invalid Base64 ciphertext: {}", e))
}
