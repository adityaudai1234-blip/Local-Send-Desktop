use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityPrivacySettings {
    /// Mask real hostname/device name during unauthenticated discovery broadcasts
    pub hide_device_name: bool,
    /// Enable/disable mDNS LAN presence advertising and scanning
    pub discovery_enabled: bool,
    /// Accept or block new incoming pairing requests from peers
    pub allow_incoming_pairing: bool,
    /// Require explicit manual user approval before saving any incoming transfer
    pub require_transfer_approval: bool,
    /// Opt-in convenience toggle: only honored if require_transfer_approval is false AND peer is verified trusted
    pub auto_accept_from_trusted: bool,
    /// Block connections silently if peer Ed25519 identity key changed unexpectedly
    pub strict_identity_pinning: bool,
    /// Custom download destination folder
    pub download_directory: String,
    /// Enable desktop security & transfer notifications
    pub notifications_enabled: bool,
}

impl Default for SecurityPrivacySettings {
    fn default() -> Self {
        Self {
            hide_device_name: false,
            discovery_enabled: true,
            allow_incoming_pairing: true,
            require_transfer_approval: true,
            auto_accept_from_trusted: false,
            strict_identity_pinning: true,
            download_directory: crate::file_system::storage::get_download_directory()
                .to_string_lossy()
                .to_string(),
            notifications_enabled: true,
        }
    }
}
