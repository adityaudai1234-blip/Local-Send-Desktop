use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce
};
use rand::rngs::OsRng;
use rand::RngCore;
use sha2::{Digest, Sha256};

pub struct EncryptedSession {
    cipher: Aes256Gcm,
}

impl EncryptedSession {
    pub fn from_shared_secret(shared_secret: &str) -> Self {
        // Derive 32-byte AES key using SHA-256
        let mut hasher = Sha256::new();
        hasher.update(shared_secret.as_bytes());
        let key_bytes = hasher.finalize();

        let cipher = Aes256Gcm::new_from_slice(&key_bytes)
            .expect("Valid 32-byte key for AES-256-GCM");

        Self { cipher }
    }

    pub fn encrypt(&self, plaintext: &[u8]) -> Result<Vec<u8>, String> {
        let mut nonce_bytes = [0u8; 12];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext = self.cipher
            .encrypt(nonce, plaintext)
            .map_err(|e| format!("Encryption failure: {}", e))?;

        // Format: [12-byte Nonce || Ciphertext + Tag]
        let mut output = Vec::with_capacity(12 + ciphertext.len());
        output.extend_from_slice(&nonce_bytes);
        output.extend_from_slice(&ciphertext);

        Ok(output)
    }

    pub fn decrypt(&self, payload: &[u8]) -> Result<Vec<u8>, String> {
        if payload.len() < 12 {
            return Err("Encrypted payload too short (missing 12-byte nonce)".to_string());
        }

        let (nonce_bytes, ciphertext) = payload.split_at(12);
        let nonce = Nonce::from_slice(nonce_bytes);

        self.cipher
            .decrypt(nonce, ciphertext)
            .map_err(|e| format!("Decryption authentication failure: {}", e))
    }
}
