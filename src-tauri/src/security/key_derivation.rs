use hkdf::Hkdf;
use rand::rngs::OsRng;
use sha2::{Digest, Sha256};
use x25519_dalek::{PublicKey as X25519PublicKey, StaticSecret};
use zeroize::{Zeroize, ZeroizeOnDrop};

/// Domain-separated 32-byte symmetric keys derived from X25519 ECDH + HKDF-SHA256.
/// Automatically zeroized from RAM when dropped.
#[derive(Zeroize, ZeroizeOnDrop)]
pub struct DerivedSessionKeys {
    pub control_tx_key: [u8; 32],
    pub control_rx_key: [u8; 32],
    pub file_tx_key: [u8; 32],
    pub file_rx_key: [u8; 32],
    #[zeroize(skip)]
    pub sas_code: String,
    #[zeroize(skip)]
    pub session_key_id: String,
}

pub struct EphemeralKeyExchange {
    secret: StaticSecret,
    pub public_key_bytes: [u8; 32],
}

impl EphemeralKeyExchange {
    pub fn generate() -> Self {
        let secret = StaticSecret::random_from_rng(OsRng);
        let public = X25519PublicKey::from(&secret);
        Self {
            secret,
            public_key_bytes: public.to_bytes(),
        }
    }

    pub fn public_key_hex(&self) -> String {
        hex::encode(self.public_key_bytes)
    }

    pub fn derive_keys(
        &self,
        peer_x25519_pub_bytes: &[u8; 32],
        session_id: &str,
        is_initiator: bool,
    ) -> Result<DerivedSessionKeys, String> {
        let peer_pub = X25519PublicKey::from(*peer_x25519_pub_bytes);
        let shared = self.secret.diffie_hellman(&peer_pub);
        derive_keys_from_shared_secret(shared.as_bytes(), session_id, is_initiator)
    }
}

/// Derives four domain-separated directional keys and a 6-digit SAS code using HKDF-SHA256.
/// Initiator uses `c2s` to encrypt TX and `s2c` to decrypt RX; responder swaps them cleanly.
pub fn derive_keys_from_shared_secret(
    shared_secret: &[u8],
    session_id: &str,
    is_initiator: bool,
) -> Result<DerivedSessionKeys, String> {
    let salt = Sha256::digest(format!("beamdrop-salt-v1:{}", session_id).as_bytes());
    let hk = Hkdf::<Sha256>::new(Some(&salt), shared_secret);

    let mut c2s_ctrl = [0u8; 32];
    let mut s2c_ctrl = [0u8; 32];
    let mut c2s_file = [0u8; 32];
    let mut s2c_file = [0u8; 32];
    let mut sas_bytes = [0u8; 4];

    hk.expand(b"beamdrop/v1/control-c2s", &mut c2s_ctrl)
        .map_err(|_| "HKDF expansion failed for control-c2s")?;
    hk.expand(b"beamdrop/v1/control-s2c", &mut s2c_ctrl)
        .map_err(|_| "HKDF expansion failed for control-s2c")?;
    hk.expand(b"beamdrop/v1/file-c2s", &mut c2s_file)
        .map_err(|_| "HKDF expansion failed for file-c2s")?;
    hk.expand(b"beamdrop/v1/file-s2c", &mut s2c_file)
        .map_err(|_| "HKDF expansion failed for file-s2c")?;
    hk.expand(b"beamdrop/v1/sas", &mut sas_bytes)
        .map_err(|_| "HKDF expansion failed for sas")?;

    let sas_num = u32::from_be_bytes(sas_bytes) % 1_000_000;
    let sas_code = format!("{:06}", sas_num);

    let key_id_digest = Sha256::digest(shared_secret);
    let session_key_id = hex::encode(&key_id_digest[..8]);

    let (control_tx_key, control_rx_key, file_tx_key, file_rx_key) = if is_initiator {
        (c2s_ctrl, s2c_ctrl, c2s_file, s2c_file)
    } else {
        (s2c_ctrl, c2s_ctrl, s2c_file, c2s_file)
    };

    Ok(DerivedSessionKeys {
        control_tx_key,
        control_rx_key,
        file_tx_key,
        file_rx_key,
        sas_code,
        session_key_id,
    })
}
