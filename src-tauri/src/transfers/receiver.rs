use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::fs::{File, OpenOptions};
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;

use super::metadata::TransferFileItem;
use super::verification::StreamHasher;
use crate::file_system::filename::resolve_conflict;
use crate::file_system::storage::{atomic_finalize_part_file, clean_incomplete_file, get_download_directory, get_part_file_path};
use crate::folders::structure::prepare_incoming_path;

pub struct ActiveFileReceive {
    pub file_id: String,
    pub target_path: PathBuf,
    pub part_path: PathBuf,
    pub writer: File,
    pub stream_hasher: StreamHasher,
    pub bytes_written: u64,
    pub expected_size: u64,
}

pub struct FileReceiver {
    pub active_files: Arc<Mutex<HashMap<String, ActiveFileReceive>>>,
}

impl FileReceiver {
    pub fn new() -> Self {
        Self {
            active_files: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Initializes a receiving slot for an incoming file or directory, preserving safe folder structure
    pub async fn prepare_file_reception(
        &self,
        transfer_id: &str,
        file_item: &TransferFileItem,
    ) -> Result<PathBuf, String> {
        let download_dir = get_download_directory();

        if file_item.is_directory {
            let rel = file_item
                .relative_path
                .as_deref()
                .unwrap_or(&file_item.name);
            return prepare_incoming_path(&download_dir, rel, true);
        }

        let target_path = if let Some(ref rel_path) = file_item.relative_path {
            let prepared = prepare_incoming_path(&download_dir, rel_path, false)?;
            if prepared.exists() {
                if let Some(parent) = prepared.parent() {
                    resolve_conflict(parent, &file_item.name)
                } else {
                    resolve_conflict(&download_dir, &file_item.name)
                }
            } else {
                prepared
            }
        } else {
            resolve_conflict(&download_dir, &file_item.name)
        };

        let part_path = get_part_file_path(&target_path, transfer_id);

        let writer = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&part_path)
            .await
            .map_err(|e| format!("Failed to create part file {}: {}", part_path.display(), e))?;

        let active_receive = ActiveFileReceive {
            file_id: file_item.file_id.clone(),
            target_path: target_path.clone(),
            part_path,
            writer,
            stream_hasher: StreamHasher::new(),
            bytes_written: 0,
            expected_size: file_item.size,
        };

        let mut lock = self.active_files.lock().await;
        lock.insert(file_item.file_id.clone(), active_receive);

        Ok(target_path)
    }

    /// Writes an incoming chunk to the `.part` file and updates the streaming SHA-256
    pub async fn write_chunk(
        &self,
        file_id: &str,
        _offset: u64,
        chunk_data: &[u8],
    ) -> Result<u64, String> {
        let mut lock = self.active_files.lock().await;
        let active = match lock.get_mut(file_id) {
            Some(a) => a,
            None => return Err(format!("No active reception found for file_id {}", file_id)),
        };

        active
            .writer
            .write_all(chunk_data)
            .await
            .map_err(|e| format!("Failed to write chunk data: {}", e))?;

        active.stream_hasher.update(chunk_data);
        active.bytes_written += chunk_data.len() as u64;

        Ok(active.bytes_written)
    }

    /// Finalizes reception: verifies SHA-256 and atomically renames `.part` to target path
    pub async fn finalize_file_reception(
        &self,
        file_id: &str,
        sender_sha256: &str,
    ) -> Result<PathBuf, String> {
        let mut active = {
            let mut lock = self.active_files.lock().await;
            lock.remove(file_id)
                .ok_or_else(|| format!("Active reception not found for file {}", file_id))?
        };

        // Flush writer and close file handle
        active
            .writer
            .flush()
            .await
            .map_err(|e| format!("Failed to flush part file: {}", e))?;
        drop(active.writer);

        // Verify SHA-256
        let receiver_sha256 = active.stream_hasher.finalize_hex();
        if !receiver_sha256.eq_ignore_ascii_case(sender_sha256) {
            // Delete corrupted part file
            clean_incomplete_file(&active.part_path);
            return Err(format!(
                "Integrity verification failed! Sender: {}, Receiver: {}",
                sender_sha256, receiver_sha256
            ));
        }

        // Atomically rename .part to final destination
        atomic_finalize_part_file(&active.part_path, &active.target_path)
            .map_err(|e| format!("Failed to atomically finalize file: {}", e))?;

        Ok(active.target_path)
    }

    /// Cleans up any open part files for a cancelled or failed transfer
    pub async fn cancel_file_reception(&self, file_id: &str) {
        let mut lock = self.active_files.lock().await;
        if let Some(active) = lock.remove(file_id) {
            drop(active.writer);
            clean_incomplete_file(&active.part_path);
        }
    }
}
