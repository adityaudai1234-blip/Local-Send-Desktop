use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::adaptive_chunking::{
    AdaptiveChunkController, ChunkAdaptationSignals, ANDROID_WIRE_SAFE_CAP,
    MAX_ADAPTIVE_CHUNK_SIZE, MIN_ADAPTIVE_CHUNK_SIZE,
};
use crate::io_optimizer::{checked_next_offset, evaluate_disk_space, ChunkBufferPool};
use crate::performance::settings::{
    load_optimization_settings, save_optimization_settings, TransferOptimizationSettings,
};
use crate::audit::SecurityRepository;
use crate::transfers::metadata::{
    TransferDirection, TransferFileItem, TransferSession, TransferStatus,
};
use crate::transfers::priority::TransferPriority;
use crate::transfers::progress::SpeedCalculator;
use crate::transfers::queue::TransferQueue;
use crate::transfers::recovery::RecoveryManager;
use crate::transfers::scheduler::{QueueEntry, TransferScheduler};
use crate::trusted_devices::storage::TrustedDevice;

#[test]
fn test_rolling_speed_average_peak_and_reliable_eta() {
    let mut calc = SpeedCalculator::new();
    let t0 = Instant::now();
    calc.record_progress_at(t0, 0);

    // Small file (<256KB): ETA must stay None to prevent noisy estimation
    assert_eq!(
        calc.estimate_eta_at(t0 + Duration::from_secs(2), 100_000, 128_000),
        None
    );

    // Simulate steady ~10 MB/s upload over 3 seconds for a large 100 MB file
    calc.record_progress_at(t0 + Duration::from_secs(1), 10 * 1024 * 1024);
    calc.record_progress_at(t0 + Duration::from_secs(2), 20 * 1024 * 1024);
    calc.record_progress_at(t0 + Duration::from_secs(3), 30 * 1024 * 1024);

    let speed = calc.current_speed();
    assert!(speed > 5 * 1024 * 1024 && speed <= 15 * 1024 * 1024);
    assert!(calc.peak_speed() >= speed);
    assert!(calc.average_speed() > 0);
    assert!(calc.recent_samples().len() >= 3);

    let eta = calc.estimate_eta_at(
        t0 + Duration::from_secs(3),
        70 * 1024 * 1024,
        100 * 1024 * 1024,
    );
    assert!(eta.is_some());

    // Reset clears speed, peak, and history cleanly
    calc.reset(0);
    assert_eq!(calc.current_speed(), 0);
    assert_eq!(calc.peak_speed(), 0);
    assert!(calc.recent_samples().is_empty());
}

#[test]
fn test_adaptive_chunk_sizing_scaling_and_caps() {
    // Tiny files start at 64 KB
    let small_size = AdaptiveChunkController::recommend_for_file(ChunkAdaptationSignals {
        rolling_speed_bps: 0,
        file_size_bytes: 64 * 1024,
        bytes_remaining: 64 * 1024,
        recent_retries: 0,
        disk_write_latency_us: 500,
        buffer_memory_pressure_pct: 5,
        peer_max_chunk_size: None,
        adaptive_enabled: true,
        configured_default_bytes: 256 * 1024,
    });
    assert_eq!(small_size, MIN_ADAPTIVE_CHUNK_SIZE);

    let mut ctrl = AdaptiveChunkController::new(256 * 1024);
    // High LAN throughput ramps chunk size smoothly up while respecting peer cap
    let ramped = ctrl.evaluate_next(ChunkAdaptationSignals {
        rolling_speed_bps: 95 * 1024 * 1024,
        file_size_bytes: 2 * 1024 * 1024 * 1024,
        bytes_remaining: 1024 * 1024 * 1024,
        recent_retries: 0,
        disk_write_latency_us: 1200,
        buffer_memory_pressure_pct: 15,
        peer_max_chunk_size: Some(ANDROID_WIRE_SAFE_CAP),
        adaptive_enabled: true,
        configured_default_bytes: 256 * 1024,
    });
    assert!(ramped > 256 * 1024 && ramped <= ANDROID_WIRE_SAFE_CAP);

    // Retry steps chunk size down cleanly without exceeding bounds
    let stepped_down = ctrl.evaluate_next(ChunkAdaptationSignals {
        rolling_speed_bps: 50 * 1024 * 1024,
        file_size_bytes: 2 * 1024 * 1024 * 1024,
        bytes_remaining: 1024 * 1024 * 1024,
        recent_retries: 2,
        disk_write_latency_us: 1200,
        buffer_memory_pressure_pct: 15,
        peer_max_chunk_size: Some(MAX_ADAPTIVE_CHUNK_SIZE),
        adaptive_enabled: true,
        configured_default_bytes: 256 * 1024,
    });
    assert!(stepped_down < ramped);
    assert!(stepped_down >= MIN_ADAPTIVE_CHUNK_SIZE);
}

#[test]
fn test_anti_starvation_scheduler_and_bounded_queue() {
    let now = 1_700_000_200_000i64;
    let mut entries = vec![
        QueueEntry {
            transfer_id: "new-high".to_string(),
            priority: TransferPriority::High,
            total_bytes: 10 * 1024 * 1024,
            enqueued_at: now - 1_000,
            dedup_key: "p1::big".to_string(),
        },
        QueueEntry {
            transfer_id: "aged-low".to_string(),
            priority: TransferPriority::Low,
            total_bytes: 50 * 1024 * 1024,
            enqueued_at: now - 240_000, // Waiting 4 minutes -> +250 aging bonus = 350 > High(300)
            dedup_key: "p1::aged".to_string(),
        },
    ];

    let boosts = TransferScheduler::sort_entries_with_aging(&mut entries, now);
    assert!(boosts >= 1);
    assert_eq!(entries[0].transfer_id, "aged-low");

    // Verify bounded queue slot acquisition & release
    let queue = TransferQueue::new();
    queue.set_max_concurrent(2);
    assert!(queue.acquire_slot());
    assert!(queue.acquire_slot());
    assert!(!queue.acquire_slot());
    queue.release_slot();
    assert!(queue.acquire_slot());
}

#[test]
fn test_64bit_large_file_offsets_and_disk_space_validation() {
    // Offset > 4 GB boundary (u32::MAX + chunk)
    let large_offset: u64 = (u32::MAX as u64) + 1024;
    let next = checked_next_offset(large_offset, 262_144).expect("64-bit offset ok");
    assert_eq!(next, large_offset + 262_144);
    assert!(checked_next_offset(u64::MAX - 10, 64).is_err());

    let low_disk = evaluate_disk_space(Some(500 * 1024 * 1024), 2 * 1024 * 1024 * 1024);
    assert!(!low_disk.sufficient);

    let enough_disk = evaluate_disk_space(Some(20 * 1024 * 1024 * 1024), 2 * 1024 * 1024 * 1024);
    assert!(enough_disk.sufficient);
}

#[test]
fn test_buffer_pool_reuse_and_cleanup() {
    let pool = Arc::new(ChunkBufferPool::new());
    {
        let mut buf1 = pool.acquire(256 * 1024);
        buf1.as_mut_slice(1024)[0] = 0xAA;
        let (_, active, _, mem, _) = pool.snapshot();
        assert_eq!(active, 1);
        assert!(mem >= 256 * 1024);
    }
    // Dropped buffer returns to pool cleanly with active_bytes == 0
    let (_, active_after, pooled, mem_after, _) = pool.snapshot();
    assert_eq!(active_after, 0);
    assert_eq!(mem_after, 0);
    assert_eq!(pooled, 1);
}

#[test]
fn test_optimization_settings_sanitization_and_sqlite_roundtrip() {
    let repo = SecurityRepository::new_in_memory().expect("sqlite in-memory");
    let dirty = TransferOptimizationSettings {
        max_concurrent_transfers: 99,
        max_concurrent_file_ops: 0,
        max_concurrent_connections: 200,
        max_concurrent_chunk_ops: 0,
        adaptive_chunking_enabled: true,
        default_chunk_size_kb: 16,
        performance_graph_enabled: false,
        auto_retry_enabled: true,
        max_retries: 99,
        default_priority: TransferPriority::High,
        continue_in_background: false,
    };

    let saved = save_optimization_settings(&repo, dirty).expect("save settings");
    assert_eq!(saved.max_concurrent_transfers, 16);
    assert_eq!(saved.max_concurrent_file_ops, 1);
    assert_eq!(saved.max_concurrent_connections, 32);
    assert_eq!(saved.default_chunk_size_kb, 64);
    assert_eq!(saved.max_retries, 10);

    let loaded = load_optimization_settings(&repo);
    assert_eq!(loaded, saved);
}

#[test]
fn test_recovery_rejects_revoked_and_missing_part() {
    let session = TransferSession {
        transfer_id: "tx-rec-001".to_string(),
        direction: TransferDirection::Incoming,
        sender_device_id: "peer-revoked".to_string(),
        sender_device_name: "Untrusted Phone".to_string(),
        sender_platform: "android".to_string(),
        recipient_device_id: "local".to_string(),
        recipient_device_name: "Desktop".to_string(),
        recipient_ip: "192.168.1.50".to_string(),
        recipient_port: 53317,
        files: vec![TransferFileItem {
            file_id: "f1".to_string(),
            name: "video.mp4".to_string(),
            size: 1024 * 1024,
            mime_type: "video/mp4".to_string(),
            path: None,
            relative_path: None,
            is_directory: false,
            sha256_checksum: None,
            is_verified: false,
            bytes_transferred: 512 * 1024,
            status: TransferStatus::Paused,
        }],
        total_bytes: 1024 * 1024,
        bytes_transferred: 512 * 1024,
        speed_bytes_per_sec: 0,
        estimated_seconds_remaining: None,
        status: TransferStatus::Paused,
        priority: TransferPriority::Normal,
        is_folder: false,
        root_folder_name: None,
        error_message: None,
        started_at: 1_700_000_000_000,
        completed_at: None,
        destination_directory: None,
    };

    let trusted = vec![TrustedDevice {
        device_id: "peer-revoked".to_string(),
        name: "Phone".to_string(),
        platform: "android".to_string(),
        device_model: "Pixel".to_string(),
        ip_address: "192.168.1.50".to_string(),
        port: 53317,
        public_key: "abc".to_string(),
        fingerprint: "AA:BB".to_string(),
        auth_token_hash: "tok".to_string(),
        first_paired_at: 0,
        last_connected_at: 0,
        is_online: true,
        trust_status: "trusted".to_string(),
        key_version: 1,
        verification_status: "verified".to_string(),
        last_auth_at: None,
        security_warning: None,
    }];

    let (info_revoked, _) =
        RecoveryManager::evaluate_session_strict(&session, &PathBuf::from("/tmp"), &trusted, true);
    assert!(!info_revoked.can_resume);

    let (info_missing_part, _) = RecoveryManager::evaluate_session_strict(
        &session,
        &PathBuf::from("/tmp/nonexistent-beamdrop-dir"),
        &trusted,
        false,
    );
    assert!(!info_missing_part.can_resume);
    let _ = HashMap::<String, TransferSession>::new();
}
