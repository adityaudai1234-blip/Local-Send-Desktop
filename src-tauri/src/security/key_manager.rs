use std::sync::Arc;

use super::identity::{DeviceIdentityPublic, IdentityManager};
use super::keys::KeyManager;
use crate::audit::{SecurityAuditLogger, SecurityRepository};

/// Phase 6 security coordinator facade uniting IdentityManager, audit logs,
/// and legacy Phase 2 KeyManager compatibility helpers.
pub struct SecurityCoordinator {
    pub identity: Arc<IdentityManager>,
    pub audit: Arc<SecurityAuditLogger>,
    pub repository: Arc<SecurityRepository>,
    pub legacy_keys: Arc<KeyManager>,
}

impl SecurityCoordinator {
    pub fn new(
        device_id: String,
        repository: Arc<SecurityRepository>,
        audit: Arc<SecurityAuditLogger>,
        legacy_keys: Arc<KeyManager>,
    ) -> Self {
        let identity = Arc::new(IdentityManager::new(device_id, Arc::clone(&repository)));
        Self {
            identity,
            audit,
            repository,
            legacy_keys,
        }
    }

    pub fn public_identity(&self) -> DeviceIdentityPublic {
        self.identity.get_public_identity()
    }
}
