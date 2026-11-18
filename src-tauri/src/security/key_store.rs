use serde::{Deserialize, Serialize};
use zeroize::Zeroize;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecureStorageStatus {
    pub available: bool,
    pub backend_name: String,
    pub warning: Option<String>,
    /// Policy string: "os_keyring" | "ephemeral_memory_only" (never plaintext disk)
    pub fallback_policy: String,
    pub identity_protected: bool,
}

const KEYRING_SERVICE: &str = "beamdrop";
const KEYRING_ACCOUNT: &str = "device_identity_seed_v1";

/// Interfaces strictly with the OS secure credential store (macOS Keychain,
/// Windows Credential Manager, Linux Secret Service).
/// NEVER silently falls back to plaintext files on disk.
pub struct SecureKeyStore;

impl SecureKeyStore {
    pub fn backend_name() -> String {
        #[cfg(target_os = "macos")]
        return "macOS Keychain".to_string();
        #[cfg(target_os = "windows")]
        return "Windows Credential Manager".to_string();
        #[cfg(target_os = "linux")]
        return "Linux Secret Service (libsecret)".to_string();
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        return "Platform Secure Store".to_string();
    }

    pub fn load_identity_seed() -> Result<Option<[u8; 32]>, String> {
        let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
            .map_err(|e| format!("Secure storage unavailable: {}", e))?;

        match entry.get_password() {
            Ok(hex_seed) => {
                let mut bytes = hex::decode(hex_seed.trim())
                    .map_err(|_| "Corrupted identity seed format in OS keyring".to_string())?;
                if bytes.len() != 32 {
                    bytes.zeroize();
                    return Err("Invalid identity seed length in OS keyring".to_string());
                }
                let mut seed = [0u8; 32];
                seed.copy_from_slice(&bytes);
                bytes.zeroize();
                Ok(Some(seed))
            }
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(format!("OS keyring read failed: {}", e)),
        }
    }

    pub fn store_identity_seed(seed: &[u8; 32]) -> Result<(), String> {
        let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
            .map_err(|e| format!("Secure storage unavailable: {}", e))?;

        let mut encoded = hex::encode(seed);
        let res = entry
            .set_password(&encoded)
            .map_err(|e| format!("Failed to persist key in OS keyring: {}", e));
        encoded.zeroize();
        res
    }

    pub fn probe_status(using_ephemeral_fallback: bool, last_error: Option<&str>) -> SecureStorageStatus {
        if !using_ephemeral_fallback {
            SecureStorageStatus {
                available: true,
                backend_name: Self::backend_name(),
                warning: None,
                fallback_policy: "os_keyring".to_string(),
                identity_protected: true,
            }
        } else {
            SecureStorageStatus {
                available: false,
                backend_name: Self::backend_name(),
                warning: Some(format!(
                    "OS secure storage is unavailable ({}). Running in non-persisted ephemeral key mode; private key is never written in plaintext to disk.",
                    last_error.unwrap_or("keyring service unreachable")
                )),
                fallback_policy: "ephemeral_memory_only".to_string(),
                identity_protected: false,
            }
        }
    }
}
