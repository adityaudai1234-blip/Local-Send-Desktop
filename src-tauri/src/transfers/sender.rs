use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::fs::File;
use tokio::io::AsyncReadExt;
use tokio::time::{sleep, Duration};

use super::metadata::{TransferFileItem, TransferSession, TransferStatus};
use super::progress::{SpeedCalculator, TransferProgressEvent};
use super::queue::DEFAULT_CHUNK_SIZE;
use super::verification::StreamHasher;
use crate::networking::ConnectionManager;
use crate::protocol::messages::{
    FileItemPayload, FileVerificationPayload, MessageType, ProtocolMessage,
    TransferProgressPayload, TransferRequestPayload,
};

pub struct FileSender {
    pub connection_manager: Arc<ConnectionManager>,
}

impl FileSender {
    pub fn new(connection_manager: Arc<ConnectionManager>) -> Self {
        Self { connection_manager }
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
            })
            .collect();

        let payload = TransferRequestPayload {
            transfer_id: session.transfer_id.clone(),
            file_count: session.files.len(),
            total_bytes: session.total_bytes,
            files: files_payload,
            expires_at: chrono::Utc::now().timestamp_millis() + 60000,
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

    /// Streams all files in the transfer session chunk-by-chunk over authenticated channel
    pub async fn stream_session_files<F>(
        &self,
        session: &mut TransferSession,
        is_cancelled: Arc<AtomicBool>,
        is_paused: Arc<AtomicBool>,
        mut on_progress: F,
    ) -> Result<(), String>
    where
        F: FnMut(TransferProgressEvent) + Send + 'static,
    {
        let mut speed_calc = SpeedCalculator::new();
        let total_files = session.files.len();

        for (file_idx, file_item) in session.files.iter_mut().enumerate() {
            if is_cancelled.load(Ordering::SeqCst) {
                return Err("Transfer was cancelled by sender".to_string());
            }

            let file_path_str = match &file_item.path {
                Some(p) => p.clone(),
                None => return Err(format!("File path missing for {}", file_item.name)),
            };

            let file_path = Path::new(&file_path_str);
            if !file_path.exists() {
                return Err(format!("File not found on disk: {}", file_path_str));
            }

            let mut async_file = File::open(file_path)
                .await
                .map_err(|e| format!("Failed to open file {}: {}", file_item.name, e))?;

            let mut stream_hasher = StreamHasher::new();
            let mut buffer = vec![0u8; DEFAULT_CHUNK_SIZE];
            let mut file_bytes_transferred: u64 = 0;

            loop {
                // Check cancellation
                if is_cancelled.load(Ordering::SeqCst) {
                    return Err("Transfer was cancelled by sender".to_string());
                }

                // Check paused state
                while is_paused.load(Ordering::SeqCst) {
                    sleep(Duration::from_millis(200)).await;
                    if is_cancelled.load(Ordering::SeqCst) {
                        return Err("Transfer was cancelled while paused".to_string());
                    }
                }

                let bytes_read = async_file
                    .read(&mut buffer)
                    .await
                    .map_err(|e| format!("Error reading file chunk: {}", e))?;

                if bytes_read == 0 {
                    // EOF reached for current file
                    break;
                }

                let chunk_slice = &buffer[..bytes_read];
                stream_hasher.update(chunk_slice);

                file_bytes_transferred += bytes_read as u64;
                session.bytes_transferred += bytes_read as u64;

                speed_calc.record_progress(session.bytes_transferred);

                // Send chunk envelope to receiver
                let chunk_base64 = hex::encode(chunk_slice);
                let chunk_msg = ProtocolMessage::new(
                    session.sender_device_id.clone(),
                    session.recipient_device_id.clone(),
                    MessageType::FileChunk,
                    serde_json::json!({
                        "transferId": session.transfer_id,
                        "fileId": file_item.file_id,
                        "offset": file_bytes_transferred - bytes_read as u64,
                        "chunkLength": bytes_read,
                        "dataHex": chunk_base64
                    }),
                );

                let _ = self
                    .connection_manager
                    .send_protocol_message(&session.recipient_device_id, &chunk_msg)
                    .await;

                // Rate-limited progress notification to UI
                if speed_calc.should_emit_update() || session.bytes_transferred >= session.total_bytes {
                    let speed = speed_calc.current_speed();
                    let remaining = session.total_bytes.saturating_sub(session.bytes_transferred);
                    let eta = speed_calc.estimate_eta(remaining);

                    session.speed_bytes_per_sec = speed;
                    session.estimated_seconds_remaining = eta;

                    on_progress(TransferProgressEvent {
                        transfer_id: session.transfer_id.clone(),
                        file_id: file_item.file_id.clone(),
                        file_name: file_item.name.clone(),
                        current_file_index: file_idx + 1,
                        total_files,
                        bytes_transferred: session.bytes_transferred,
                        total_bytes: session.total_bytes,
                        percentage: session.progress_percentage(),
                        speed_bytes_per_sec: speed,
                        estimated_seconds_remaining: eta,
                        status: TransferStatus::Transferring,
                    });
                }
            }

            // File completed: send verification checksum
            let computed_checksum = stream_hasher.finalize_hex();
            file_item.sha256_checksum = Some(computed_checksum.clone());
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

        // Notify complete batch transmission
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
