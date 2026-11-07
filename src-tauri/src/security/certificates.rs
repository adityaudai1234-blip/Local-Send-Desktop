use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerCertificateMetadata {
    pub common_name: String,
    pub sha256_fingerprint: String,
    pub is_valid: bool,
}

impl PeerCertificateMetadata {
    pub fn new(common_name: String, fingerprint: String) -> Self {
        Self {
            common_name,
            sha256_fingerprint: fingerprint,
            is_valid: true,
        }
    }
}
