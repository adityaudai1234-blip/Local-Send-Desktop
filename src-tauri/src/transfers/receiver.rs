use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;
use tokio::fs::{File, OpenOptions};
use tokio::io::{AsyncWriteExt, BufWriter};
use tokio::sync::Mutex;

use super::metadata::TransferFileItem;
use super::verification::StreamHasher;
use crate::file_system::filename::resolve_conflict;
use crate::file_system::storage::get_download_directory;
use crate::filesystem_security::{
    apply_restrictive_file_permissions, cleanup_part_file, resolve_safe_destination,
    safe_part_file_path, sanitize_untrusted_filename, secure_finalize_part_file,
};
use crate::io_optimizer::{
    check_available_disk_space, checked_next_offset, ChunkBufferPool,
    BATCHED_FLUSH_INTERVAL_BYTES, WRITE_BUFFER_CAPACITY,
};
use crate::throughput_monitor::ThroughputMonitor;

pub struct ActiveFileReceive {
    pub file_id: String,
    pub download_root: PathBuf,
    pub target_path: PathBuf,
    pub part_path: PathBuf,
    pub writer: BufWriter<File>,
    pub stream_hasher: StreamHasher,
    pub bytes_written: u64,
    pub unflushed_bytes: u64,
    pub expected_size: u64,
}

pub struct FileReceiver {
    pub active_files: Arc<Mutex<HashMap<String, ActiveFileReceive>>>,
    pub buffer_pool: Arc<ChunkBufferPool>,
    pub throughput_monitor: Arc<ThroughputMonitor>,
}

impl FileReceiver {
    pub fn new(buffer_pool: Arc<ChunkBufferPool>, throughput_monitor: Arc<ThroughputMonitor>) -> Self {
        Self {
            active_files: Arc::new(Mutex::new(HashMap::new())),
            buffer_pool,
            throughput_monitor,
        }
    }

    /// Initializes a hardened buffered receiving slot strictly contained inside `download_dir`,
    /// performing preflight disk space verification and enforcing symlink/path containment.
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

        let space = check_available_disk_space(&download_dir, file_item.size);
        if !space.sufficient {
            return Err(space.message);
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

        let raw_file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&part_path)
            .await
            .map_err(|e| format!("Failed to create part file {}: {}", part_path.display(), e))?;

        apply_restrictive_file_permissions(&part_path);
        self.buffer_pool.increment_file_handles();

        let buffered_writer = BufWriter::with_capacity(WRITE_BUFFER_CAPACITY, raw_file);

        let active_receive = ActiveFileReceive {
            file_id: file_item.file_id.clone(),
            download_root: download_dir,
            target_path: target_path.clone(),
            part_path,
            writer: buffered_writer,
            stream_hasher: StreamHasher::new(),
            bytes_written: 0,
            unflushed_bytes: 0,
            expected_size: file_item.size,
        };

        let mut lock = self.active_files.lock().await;
        lock.insert(file_item.file_id.clone(), active_receive);

        Ok(target_path)
    }

    pub async fn write_chunk(
        &self,
        file_id: &str,
        offset: u64,
        chunk_data: &[u8],
    ) -> Result<u64, String> {
        let mut lock = self.active_files.lock().await;
        let active = match lock.get_mut(file_id) {
            Some(a) => a,
            None => return Err(format!("No active reception found for file_id {}", file_id)),
        };

        if offset != active.bytes_written {
            return Err(format!(
                "Out-of-order chunk offset: expected {}, received {}",
                active.bytes_written, offset
            ));
        }

        let next_total = checked_next_offset(active.bytes_written, chunk_data.len())?;
        if active.expected_size > 0 && next_total > active.expected_size {
            return Err(format!(
                "Incoming chunk exceeds declared file size ({} > {})",
                next_total, active.expected_size
            ));
        }

        let start = Instant::now();
        active
            .writer
            .write_all(chunk_data)
            .await
            .map_err(|e| format!("Disk write error on part file: {}", e))?;

        active.stream_hasher.update(chunk_data);
        active.bytes_written = next_total;
        active.unflushed_bytes = active.unflushed_bytes.saturating_add(chunk_data.len() as u64);

        if active.unflushed_bytes >= BATCHED_FLUSH_INTERVAL_BYTES {
            active
                .writer
                .flush()
                .await
                .map_err(|e| format!("Batched flush failed: {}", e))?;
            active.unflushed_bytes = 0;
        }

        let elapsed_us = start.elapsed().as_micros() as u64;
        self.throughput_monitor
            .record_disk_write(chunk_data.len() as u64, elapsed_us);
        self.throughput_monitor
            .record_download(chunk_data.len() as u64);

        Ok(active.bytes_written)
    }

    /// Flushes remaining buffered writes, syncs data to disk, verifies SHA-256 checksum,
    /// enforces strict path containment, atomically moves `.part` to target, and sets `0o600` permissions.
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

        if let Err(e) = active.writer.flush().await {
            drop(active.writer);
            cleanup_part_file(&active.part_path);
            self.buffer_pool.decrement_file_handles();
            return Err(format!("Failed to flush part file before verification: {}", e));
        }

        let inner_file = active.writer.into_inner();
        let _ = inner_file.sync_data().await;
        drop(inner_file);
        self.buffer_pool.decrement_file_handles();

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
            self.buffer_pool.decrement_file_handles();
            cleanup_part_file(&active.part_path);
        }
    }
}
