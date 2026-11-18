use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::fs::{File, OpenOptions};
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;

use super::metadata::TransferFileItem;
use super::verification::StreamHasher;
use crate::file_system::filename::resolve_conflict;
use crate::file_system::storage::get_download_directory;
use crate::filesystem_security::{
    apply_restrictive_file_permissions, cleanup_part_file, resolve_safe_destination,
    safe_part_file_path, sanitize_untrusted_filename, secure_finalize_part_file,
};

pub struct ActiveFileReceive {
    pub file_id: String,
    pub download_root: PathBuf,
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

    /// Initializes a hardened receiving slot strictly contained inside `download_dir`,
    /// blocking traversal, symlinks, reserved device filenames, and execute bits.
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
            return resolve_safe_destination(&download_dir, &file_item.name, Some(rel), true);
        }

        let prepared = resolve_safe_destination(
            &download_dir,
            &file_item.name,
            file_item.relative_path.as_deref(),
            false,
        )?;

        let target_path = if prepared.exists() {
            let safe_leaf = sanitize_untrusted_filename(&file_item.name)?;
            if let Some(parent) = prepared.parent() {
                resolve_conflict(parent, &safe_leaf)
            } else {
                resolve_conflict(&download_dir, &safe_leaf)
            }
        } else {
            prepared
        };

        let part_path = safe_part_file_path(&download_dir, &target_path, transfer_id)?;

        let writer = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&part_path)
            .await
            .map_err(|e| format!("Failed to create part file {}: {}", part_path.display(), e))?;

        apply_restrictive_file_permissions(&part_path);

        let active_receive = ActiveFileReceive {
            file_id: file_item.file_id.clone(),
            download_root: download_dir,
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

    /// Verifies SHA-256 checksum, enforces strict path containment, atomically moves `.part` to target,
    /// and sets restrictive owner-only permissions (`0o600` on Unix).
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

        active
            .writer
            .flush()
            .await
            .map_err(|e| format!("Failed to flush part file: {}", e))?;
        drop(active.writer);

        let receiver_sha256 = active.stream_hasher.finalize_hex();
        if !receiver_sha256.eq_ignore_ascii_case(sender_sha256) {
            cleanup_part_file(&active.part_path);
            return Err(format!(
                "Integrity verification failed! Sender: {}, Receiver: {}",
                sender_sha256, receiver_sha256
            ));
        }

        secure_finalize_part_file(&active.download_root, &active.part_path, &active.target_path)?;

        Ok(active.target_path)
    }

    pub async fn cancel_file_reception(&self, file_id: &str) {
        let mut lock = self.active_files.lock().await;
        if let Some(active) = lock.remove(file_id) {
            drop(active.writer);
            cleanup_part_file(&active.part_path);
        }
    }
}
