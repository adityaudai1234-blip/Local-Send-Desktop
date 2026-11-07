use ed25519_dalek::{SigningKey, VerifyingKey, Signer, Verifier, Signature};
use rand::rngs::OsRng;
use sha2::{Sha256, Digest};
use serde::{Deserialize, Serialize};

#[derive(Clone)]
pub struct KeyManager {
    signing_key: SigningKey,
    verifying_key: VerifyingKey,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicKeyInfo {
    pub public_key_hex: String,
    pub fingerprint: String,
    pub algorithm: String,
}

impl KeyManager {
    pub fn new() -> Self {
        let mut csprng = OsRng;
        let signing_key = SigningKey::generate(&mut csprng);
        let verifying_key = signing_key.verifying_key();
        Self {
            signing_key,
            verifying_key,
        }
    }

    pub fn public_key_info(&self) -> PublicKeyInfo {
        let pub_bytes = self.verifying_key.to_bytes();
        let public_key_hex = hex::encode(pub_bytes);
        let fingerprint = compute_fingerprint(&pub_bytes);

        PublicKeyInfo {
            public_key_hex,
            fingerprint,
            algorithm: "Ed25519".to_string(),
        }
    }

    pub fn sign(&self, message: &[u8]) -> Vec<u8> {
        let signature = self.signing_key.sign(message);
        signature.to_bytes().to_vec()
    }

    pub fn verify(&self, message: &[u8], signature_bytes: &[u8], public_key_hex: &str) -> Result<bool, String> {
        let pub_bytes = hex::decode(public_key_hex).map_err(|e| format!("Invalid public key hex: {}", e))?;
        if pub_bytes.len() != 32 {
            return Err("Invalid public key length, must be 32 bytes".to_string());
        }

        let mut fixed_pub = [0u8; 32];
        fixed_pub.copy_from_slice(&pub_bytes);
        let verifying_key = VerifyingKey::from_bytes(&fixed_pub)
            .map_err(|e| format!("Invalid VerifyingKey: {}", e))?;

        if signature_bytes.len() != 64 {
            return Err("Invalid signature length, must be 64 bytes".to_string());
        }
        let mut fixed_sig = [0u8; 64];
        fixed_sig.copy_from_slice(signature_bytes);
        let signature = Signature::from_bytes(&fixed_sig);

        verifying_key
            .verify(message, &signature)
            .map(|_| true)
            .map_err(|e| format!("Signature verification failed: {}", e))
    }
}

pub fn compute_fingerprint(public_key_bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(public_key_bytes);
    let result = hasher.finalize();
    // Return standard colon-separated 8-byte hex thumbprint, e.g. "E3:4A:9C:12:8F:05:BD:7E"
    result[0..8]
        .iter()
        .map(|b| format!("{:02X}", b))
        .collect::<Vec<String>>()
        .join(":")
}

pub fn generate_verification_code(session_id: &str, client_key: &str, server_key: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(session_id.as_bytes());
    hasher.update(client_key.as_bytes());
    hasher.update(server_key.as_bytes());
    let hash = hasher.finalize();
    // 6-digit numeric verification code for human visual comparison
    let num = u32::from_be_bytes([hash[0], hash[1], hash[2], hash[3]]) % 1_000_000;
    format!("{:06}", num)
}
