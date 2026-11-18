#[cfg(test)]
mod tests {
    use std::path::Path;
    use std::sync::Arc;
    use tempfile_or_std::*;

    mod tempfile_or_std {
        use std::path::PathBuf;
        pub fn unique_temp_dir(label: &str) -> PathBuf {
            let dir = std::env::temp_dir().join(format!(
                "beamdrop_sec_test_{}_{}",
                label,
                uuid::Uuid::new_v4()
            ));
            let _ = std::fs::create_dir_all(&dir);
            dir
        }
    }

    use crate::audit::{SecurityAuditLogger, SecurityEventType, SecurityRepository, SecuritySeverity};
    use crate::filesystem_security::{
        assert_contained_and_no_symlink, resolve_safe_destination, sanitize_untrusted_filename,
        sanitize_untrusted_relative_path,
    };
    use crate::security::encryption::{
        build_deterministic_nonce, decrypt_aead, encrypt_aead, CipherSuite,
    };
    use crate::security::identity::IdentityManager;
    use crate::security::key_derivation::EphemeralKeyExchange;
    use crate::security::replay_protection::{ReplayCheckError, ReplayProtector};
    use crate::security::secure_session::SecureSessionManager;
    use crate::security::verification::{
        check_pinned_identity, IdentityPinOutcome, PairingReplayGuard,
    };

    #[test]
    fn test_01_02_ecdh_and_domain_separated_hkdf_keys() {
        let alice = EphemeralKeyExchange::generate();
        let bob = EphemeralKeyExchange::generate();
        let sid = "sess-ecdh-001";

        let alice_keys = alice
            .derive_keys(&bob.public_key_bytes, sid, true)
            .expect("alice HKDF derivation");
        let bob_keys = bob
            .derive_keys(&alice.public_key_bytes, sid, false)
            .expect("bob HKDF derivation");

        assert_eq!(alice_keys.control_tx_key, bob_keys.control_rx_key);
        assert_eq!(alice_keys.control_rx_key, bob_keys.control_tx_key);
        assert_eq!(alice_keys.file_tx_key, bob_keys.file_rx_key);
        assert_eq!(alice_keys.file_rx_key, bob_keys.file_tx_key);
        assert_ne!(alice_keys.control_tx_key, alice_keys.file_tx_key);
        assert_eq!(alice_keys.sas_code, bob_keys.sas_code);
        assert_eq!(alice_keys.sas_code.len(), 6);
    }

    #[test]
    fn test_03_04_aead_roundtrip_and_tamper_rejection() {
        let key = [42u8; 32];
        let nonce = build_deterministic_nonce(*b"CTRL", 7);
        let aad = b"session-1|msg-7";
        let pt = b"Confidential transfer control command";

        for suite in [CipherSuite::ChaCha20Poly1305, CipherSuite::Aes256Gcm] {
            let mut ct = encrypt_aead(suite, &key, &nonce, pt, aad).expect("encrypt");
            let dec = decrypt_aead(suite, &key, &nonce, &ct, aad).expect("decrypt");
            assert_eq!(dec, pt);

            // Tamper ciphertext byte
            ct[0] ^= 0xFF;
            assert!(decrypt_aead(suite, &key, &nonce, &ct, aad).is_err());

            // Wrong AAD must fail
            let clean_ct = encrypt_aead(suite, &key, &nonce, pt, aad).expect("encrypt");
            assert!(decrypt_aead(suite, &key, &nonce, &clean_ct, b"wrong-aad").is_err());
        }
    }

    #[test]
    fn test_05_06_ed25519_signing_and_invalid_sig_rejected() {
        let repo = Arc::new(SecurityRepository::new_in_memory().unwrap());
        let id = IdentityManager::new("dev-1".to_string(), repo);
        let pub_info = id.get_public_identity();
        let msg = b"BeamDrop challenge transcript";

        let sig = id.sign_payload(msg);
        assert!(IdentityManager::verify_peer_signature(msg, &sig, &pub_info.public_key_hex).is_ok());

        let mut bad_sig = sig.clone();
        bad_sig[10] ^= 0x55;
        assert!(
            IdentityManager::verify_peer_signature(msg, &bad_sig, &pub_info.public_key_hex)
                .is_err()
        );
    }

    #[test]
    fn test_07_08_09_10_replay_protection() {
        let now = 1_700_000_000_000i64;
        let mut guard = ReplayProtector::new("sess-1".to_string(), now + 600_000);

        // First valid packet
        assert!(guard.validate_incoming_at("sess-1", "m1", 0, now, now).is_ok());
        // Duplicate message_id
        assert_eq!(
            guard.validate_incoming_at("sess-1", "m1", 1, now, now),
            Err(ReplayCheckError::DuplicateMessageId)
        );
        // Non-monotonic sequence
        assert!(matches!(
            guard.validate_incoming_at("sess-1", "m2", 0, now, now),
            Err(ReplayCheckError::NonMonotonicSequence { .. })
        ));
        // Stale timestamp (>120s)
        assert_eq!(
            guard.validate_incoming_at("sess-1", "m3", 1, now - 200_000, now),
            Err(ReplayCheckError::TimestampOutOfWindow)
        );
        // Expired session
        assert_eq!(
            guard.validate_incoming_at("sess-1", "m4", 1, now + 700_000, now + 700_000),
            Err(ReplayCheckError::SessionExpired)
        );
    }

    #[test]
    fn test_11_pairing_replay_guard() {
        let guard = PairingReplayGuard::new();
        assert!(!guard.is_consumed("pair-123"));
        guard.mark_consumed("pair-123");
        assert!(guard.is_consumed("pair-123"));
    }

    #[test]
    fn test_12_identity_change_detected_and_13_revocation_blocks() {
        let outcome = check_pinned_identity(
            "peer-1",
            "new_pk",
            "AA:BB:CC:DD",
            false,
            Some("old_pk"),
            Some("11:22:33:44"),
            Some("verified"),
        );
        assert!(matches!(outcome, IdentityPinOutcome::IdentityChanged { .. }));

        let revoked = check_pinned_identity(
            "peer-1",
            "old_pk",
            "11:22:33:44",
            true,
            Some("old_pk"),
            Some("11:22:33:44"),
            Some("revoked"),
        );
        assert_eq!(revoked, IdentityPinOutcome::Revoked);
    }

    #[test]
    fn test_14_key_rotation_increments_version() {
        let repo = Arc::new(SecurityRepository::new_in_memory().unwrap());
        let id = IdentityManager::new("dev-rot".to_string(), repo);
        let initial = id.get_public_identity();
        let (rotated, prev_fp) = id.replace_signing_key().expect("rotate");
        assert_eq!(prev_fp, initial.fingerprint);
        assert_eq!(rotated.key_version, initial.key_version + 1);
        assert_ne!(rotated.public_key_hex, initial.public_key_hex);
    }

    #[test]
    fn test_15_16_17_filesystem_traversal_reserved_and_symlink() {
        assert!(sanitize_untrusted_relative_path("../etc/passwd").is_err());
        assert!(sanitize_untrusted_relative_path("/etc/shadow").is_err());
        assert!(sanitize_untrusted_relative_path("C:\\Windows\\System32").is_err());

        let reserved = sanitize_untrusted_filename("CON.txt").unwrap();
        assert!(reserved.starts_with('_'));

        let root = unique_temp_dir("fs");
        let safe = resolve_safe_destination(&root, "report.pdf", Some("docs/report.pdf"), false)
            .expect("safe containment");
        assert!(safe.starts_with(&root));
        assert!(assert_contained_and_no_symlink(&root, Path::new("/tmp/outside")).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn test_18_audit_log_redacts_secrets() {
        let repo = Arc::new(SecurityRepository::new_in_memory().unwrap());
        let audit = SecurityAuditLogger::new(Arc::clone(&repo));
        audit.log_event(
            SecurityEventType::AuthFailed,
            SecuritySeverity::Warning,
            Some("peer-x"),
            Some("Device X"),
            "Auth failure private_key=super_secret_seed_value",
            Some("auth_token=should_never_appear"),
            None,
        );
        let events = audit.get_logs(10).unwrap();
        assert_eq!(events.len(), 1);
        assert!(!events[0].summary.contains("super_secret_seed_value"));
        assert!(!events[0].details.as_deref().unwrap_or("").contains("should_never_appear"));
    }

    #[test]
    fn test_19_encrypted_chunk_tamper_rejected_and_session_revocation() {
        let repo = Arc::new(SecurityRepository::new_in_memory().unwrap());
        let audit = Arc::new(SecurityAuditLogger::new(repo));
        let mgr = SecureSessionManager::new(audit);

        mgr.establish_session(
            "sess-tx".to_string(),
            "peer-a".to_string(),
            Some("Peer A"),
            "AA:BB".to_string(),
            &[9u8; 32],
            true,
            CipherSuite::ChaCha20Poly1305,
            None,
        )
        .unwrap();

        let mut frame = mgr
            .encrypt_chunk_for_peer("peer-a", "tx-1", "f-1", 0, b"hello encrypted file")
            .unwrap();

        // Responder perspective with opposite direction won't match TX key,
        // and tampering fails immediately:
        frame.ciphertext_b64 = "AAAA".to_string();
        assert!(mgr.decrypt_chunk_from_peer("peer-a", &frame).is_err());

        // Revoking terminates session cleanly
        assert!(mgr.terminate_session("peer-a", "revoked", None));
        assert!(!mgr.has_verified_session("peer-a"));
    }
}
