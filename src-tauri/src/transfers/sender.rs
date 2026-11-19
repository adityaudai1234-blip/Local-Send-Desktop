use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::fs::File;
use tokio::io::{AsyncReadExt, BufReader};
use tokio::time::{sleep, Duration};

use super::metadata::{TransferSession, TransferStatus};
use super::progress::{SpeedCalculator, TransferProgressEvent};
use crate::adaptive_chunking::{
    AdaptiveChunkController, ChunkAdaptationSignals, ANDROID_WIRE_SAFE_CAP,
};
use crate::io_optimizer::{
    checked_next_offset, ChunkBufferPool, SourceFileSnapshot, WRITE_BUFFER_CAPACITY,
};
use crate::networking::ConnectionManager;
use crate::performance::settings::TransferOptimizationSettings;
use crate::protocol::messages::{
    FileItemPayload, FileVerificationPayload, MessageType, ProtocolMessage,
    TransferRequestPayload,
};
use crate::throughput_monitor::{PerTransferSpeedRecord, ThroughputMonitor};
use crate::transfer_optimizer::ConcurrencyCoordinator;

pub struct FileSender {
    pub connection_manager: Arc<ConnectionManager>,
    pub buffer_pool: Arc<ChunkBufferPool>,
    pub throughput_monitor: Arc<ThroughputMonitor>,
    pub concurrency: Arc<ConcurrencyCoordinator>,
}

impl FileSender {
    pub fn new(
        connection_manager: Arc<ConnectionManager>,
        buffer_pool: Arc<ChunkBufferPool>,
        throughput_monitor: Arc<ThroughputMonitor>,
        concurrency: Arc<ConcurrencyCoordinator>,
    ) -> Self {
        Self {
            connection_manager,
            buffer_pool,
            throughput_monitor,
            concurrency,
        }
    }

    /// Sends the initial transfer proposal (TRANSFER_REQUEST) to peer
    pub async fn send_transfer_request(
        &self,
        session: &TransferSession,
    ) -> Result<bool, String> {
        let files_payload: Vec<FileItemPayload> = session
            .files
            .iter()
            .map(|f| FileItemPayload {
                file_id: f.file_id.clone(),
                file_name: f.name.clone(),
                file_size: f.size,
                mime_type: f.mime_type.clone(),
                sha256_checksum: f.sha256_checksum.clone(),
                relative_path: f.relative_path.clone(),
                is_directory: Some(f.is_directory),
            })
            .collect();

        let priority_str = match session.priority {
            super::priority::TransferPriority::High => "high",
            super::priority::TransferPriority::Low => "low",
            super::priority::TransferPriority::Normal => "normal",
        };

        let payload = TransferRequestPayload {
            transfer_id: session.transfer_id.clone(),
            file_count: session.files.len(),
            total_bytes: session.total_bytes,
            files: files_payload,
            expires_at: chrono::Utc::now().timestamp_millis() + 60000,
            is_folder: Some(session.is_folder),
            root_folder_name: session.root_folder_name.clone(),
            priority: Some(priority_str.to_string()),
        };

        let msg = ProtocolMessage::new(
            session.sender_device_id.clone(),
            session.recipient_device_id.clone(),
            MessageType::TransferRequest,
            serde_json::to_value(payload).map_err(|e| e.to_string())?,
        );

        self.connection_manager
            .send_protocol_message(&session.recipient_device_id, &msg)
            .await
    }

    /// Streams all files in the transfer session chunk-by-chunk over authenticated channel using
    /// buffered async I/O, pooled reusable buffers, 64-bit offsets, and adaptive chunk sizing.
    pub async fn stream_session_files<F>(
        &self,
        session: &mut TransferSession,
        opt_settings: TransferOptimizationSettings,
        peer_max_chunk_size: Option<usize>,
        retry_attempts: u32,
        is_cancelled: Arc<AtomicBool>,
        is_paused: Arc<AtomicBool>,
        mut on_progress: F,
    ) -> Result<(), String>
    where
        F: FnMut(TransferProgressEvent) + Send + 'static,
    {
        let mut speed_calc = SpeedCalculator::new();
        speed_calc.reset(session.bytes_transferred);

        let total_files = session.files.len();
        let peer_cap = peer_max_chunk_size.or(Some(ANDROID_WIRE_SAFE_CAP));

        for (file_idx, file_item) in session.files.iter_mut().enumerate() {
            if is_cancelled.load(Ordering::SeqCst) {
                return Err("Transfer was cancelled by sender".to_string());
            }

            if file_item.is_directory {
                let dir_msg = ProtocolMessage::new(
                    session.sender_device_id.clone(),
                    session.recipient_device_id.clone(),
                    MessageType::FileMetadata,
                    serde_json::json!({
                        "transferId": session.transfer_id,
                        "fileId": file_item.file_id,
                        "fileName": file_item.name,
                        "relativePath": file_item.relative_path,
                        "isDirectory": true,
                        "fileSize": 0
                    }),
                );
                let _ = self
                    .connection_manager
                    .send_protocol_message(&session.recipient_device_id, &dir_msg)
                    .await;
                file_item.is_verified = true;
                file_item.status = TransferStatus::Completed;
                continue;
            }

            let file_path_str = match &file_item.path {
                Some(p) => p.clone(),
                None => return Err(format!("File path missing for {}", file_item.name)),
            };

            let file_path = Path::new(&file_path_str);
            if !file_path.exists() {
                return Err(format!("File not found on disk: {}", file_path_str));
            }

            let _file_op_guard = self.concurrency.acquire_file_op().await;
            let snapshot = SourceFileSnapshot::capture(file_path)?;

            let async_file = File::open(file_path)
                .await
                .map_err(|e| format!("Failed to open file {}: {}", file_item.name, e))?;
            self.buffer_pool.increment_file_handles();

            let mut reader = BufReader::with_capacity(WRITE_BUFFER_CAPACITY, async_file);
            let mut stream_hasher = super::verification::StreamHasher::new();

            let initial_signals = ChunkAdaptationSignals {
                rolling_speed_bps: speed_calc.current_speed(),
                file_size_bytes: file_item.size,
                bytes_remaining: session.total_bytes.saturating_sub(session.bytes_transferred),
                recent_retries: retry_attempts,
                disk_write_latency_us: self.throughput_monitor.average_write_latency_us(),
                buffer_memory_pressure_pct: self.buffer_pool.memory_pressure_pct(),
                peer_max_chunk_size: peer_cap,
                adaptive_enabled: opt_settings.adaptive_chunking_enabled,
                configured_default_bytes: opt_settings.default_chunk_bytes(),
            };
            let initial_chunk_size = AdaptiveChunkController::recommend_for_file(initial_signals);
            let mut chunk_ctrl = AdaptiveChunkController::new(initial_chunk_size);
            self.throughput_monitor
                .set_current_chunk_size(chunk_ctrl.current_chunk_bytes());

            let max_alloc = peer_cap.unwrap_or(ANDROID_WIRE_SAFE_CAP);
            let mut pooled_buf = self.buffer_pool.acquire(max_alloc);

            let mut file_bytes_transferred: u64 = 0;
            let mut chunk_counter: u64 = 0;

            let loop_res: Result<(), String> = async {
                loop {
                    if is_cancelled.load(Ordering::SeqCst) {
                        return Err("Transfer was cancelled by sender".to_string());
                    }

                    while is_paused.load(Ordering::SeqCst) {
                        sleep(Duration::from_millis(200)).await;
                        if is_cancelled.load(Ordering::SeqCst) {
                            return Err("Transfer was cancelled while paused".to_string());
                        }
                    }

                    // Periodically verify source file was not modified externally mid-transfer
                    if chunk_counter % 16 == 0 {
                        snapshot.verify_unchanged(file_path)?;
                    }

                    let active_chunk_len = chunk_ctrl.current_chunk_bytes().min(max_alloc);
                    let slice = pooled_buf.as_mut_slice(active_chunk_len);

                    let _chunk_guard = self.concurrency.acquire_chunk_op().await;
                    let bytes_read = reader
                        .read(slice)
                        .await
                        .map_err(|e| format!("Error reading file chunk: {}", e))?;

                    if bytes_read == 0 {
                        break;
                    }

                    let current_offset = file_bytes_transferred;
                    file_bytes_transferred = checked_next_offset(file_bytes_transferred, bytes_read)?;
                    session.bytes_transferred =
                        checked_next_offset(session.bytes_transferred, bytes_read)?;

                    let chunk_slice = &slice[..bytes_read];
                    stream_hasher.update(chunk_slice);

                    self.throughput_monitor.record_disk_read(bytes_read as u64);
                    self.throughput_monitor.record_upload(bytes_read as u64);
                    speed_calc.record_progress(session.bytes_transferred);

                    let chunk_hex = hex::encode(chunk_slice);
                    let chunk_msg = ProtocolMessage::new(
                        session.sender_device_id.clone(),
                        session.recipient_device_id.clone(),
                        MessageType::FileChunk,
                        serde_json::json!({
                            "transferId": session.transfer_id,
                            "fileId": file_item.file_id,
                            "offset": current_offset,
                            "chunkLength": bytes_read,
                            "dataHex": chunk_hex
                        }),
                    );

                    self.connection_manager
                        .send_protocol_message(&session.recipient_device_id, &chunk_msg)
                        .await?;

                    chunk_counter += 1;

                    // Re-evaluate adaptive chunk size cleanly between chunks (every 4 chunks)
                    if chunk_counter % 4 == 0 {
                        let next_signals = ChunkAdaptationSignals {
                            rolling_speed_bps: speed_calc.current_speed(),
                            file_size_bytes: file_item.size,
                            bytes_remaining: session
                                .total_bytes
                                .saturating_sub(session.bytes_transferred),
                            recent_retries: retry_attempts,
                            disk_write_latency_us: self.throughput_monitor.average_write_latency_us(),
                            buffer_memory_pressure_pct: self.buffer_pool.memory_pressure_pct(),
                            peer_max_chunk_size: peer_cap,
                            adaptive_enabled: opt_settings.adaptive_chunking_enabled,
                            configured_default_bytes: opt_settings.default_chunk_bytes(),
                        };
                        let next_size = chunk_ctrl.evaluate_next(next_signals);
                        self.throughput_monitor.set_current_chunk_size(next_size);
                    }

                    // Throttled progress updates to prevent IPC flooding
                    if speed_calc.should_emit_update()
                        || session.bytes_transferred >= session.total_bytes
                    {
                        let current_speed = speed_calc.current_speed();
                        let average_speed = speed_calc.average_speed();
                        let peak_speed = speed_calc.peak_speed();
                        let remaining = session.total_bytes.saturating_sub(session.bytes_transferred);
                        let eta = speed_calc.estimate_eta_reliable(remaining, session.total_bytes);

                        session.speed_bytes_per_sec = current_speed;
                        session.estimated_seconds_remaining = eta;

                        self.throughput_monitor.update_transfer_speed(
                            &session.transfer_id,
                            PerTransferSpeedRecord {
                                current_speed_bps: current_speed,
                                average_speed_bps: average_speed,
                                peak_speed_bps: peak_speed,
                                recent_samples_bps: speed_calc.recent_samples(),
                                chunk_size_bytes: chunk_ctrl.current_chunk_bytes(),
                                retry_attempts,
                                reliable_eta: eta.is_some(),
                            },
                        );

                        on_progress(TransferProgressEvent {
                            transfer_id: session.transfer_id.clone(),
                            file_id: file_item.file_id.clone(),
                            file_name: file_item.name.clone(),
                            current_file_index: file_idx + 1,
                            total_files,
                            bytes_transferred: session.bytes_transferred,
                            total_bytes: session.total_bytes,
                            percentage: session.progress_percentage(),
                            speed_bytes_per_sec: current_speed,
                            average_speed_bps: average_speed,
                            peak_speed_bps: peak_speed,
                            remaining_bytes: remaining,
                            estimated_seconds_remaining: eta,
                            reliable_eta: eta.is_some(),
                            chunk_size_bytes: chunk_ctrl.current_chunk_bytes(),
                            status: TransferStatus::Transferring,
                        });
                    }
                }

                snapshot.verify_unchanged(file_path)?;
                Ok(())
            }
            .await;

            drop(pooled_buf);
            drop(reader);
            self.buffer_pool.decrement_file_handles();

            loop_res?;

            let computed_checksum = stream_hasher.finalize_hex();
            file_item.sha256_checksum = Some(computed_checksum.clone());
            file_item.bytes_transferred = file_bytes_transferred;
            file_item.is_verified = true;
            file_item.status = TransferStatus::Completed;

            let verif_payload = FileVerificationPayload {
                transfer_id: session.transfer_id.clone(),
                file_id: file_item.file_id.clone(),
                sender_sha256: computed_checksum,
                total_bytes_sent: file_bytes_transferred,
            };

            let verif_msg = ProtocolMessage::new(
                session.sender_device_id.clone(),
                session.recipient_device_id.clone(),
                MessageType::FileVerification,
                serde_json::to_value(verif_payload).unwrap(),
            );

            let _ = self
                .connection_manager
                .send_protocol_message(&session.recipient_device_id, &verif_msg)
                .await;
        }

        let complete_msg = ProtocolMessage::new(
            session.sender_device_id.clone(),
            session.recipient_device_id.clone(),
            MessageType::TransferCompleted,
            serde_json::json!({
                "transferId": session.transfer_id,
                "totalBytes": session.total_bytes,
                "filesTransferred": total_files
            }),
        );

        let _ = self
            .connection_manager
            .send_protocol_message(&session.recipient_device_id, &complete_msg)
            .await;

        Ok(())
    }
}
