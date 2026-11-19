use std::collections::VecDeque;
use std::path::Path;
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

pub const WRITE_BUFFER_CAPACITY: usize = 256 * 1024; // 256 KB buffered async writer
pub const BATCHED_FLUSH_INTERVAL_BYTES: u64 = 4 * 1024 * 1024; // Flush explicitly every 4 MB
pub const MAX_POOL_BUFFERS: usize = 24;
pub const MAX_POOL_MEMORY_BYTES: usize = 48 * 1024 * 1024; // 48 MB total buffer cap

#[derive(Debug, Clone)]
pub struct SourceFileSnapshot {
    pub expected_size: u64,
    pub modified_secs: Option<u64>,
}

impl SourceFileSnapshot {
    pub fn capture(path: &Path) -> Result<Self, String> {
        let meta = std::fs::metadata(path)
            .map_err(|e| format!("Failed to inspect source file '{}': {}", path.display(), e))?;
        let modified_secs = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
            .map(|d| d.as_secs());

        Ok(Self {
            expected_size: meta.len(),
            modified_secs,
        })
    }

    pub fn verify_unchanged(&self, path: &Path) -> Result<(), String> {
        let meta = std::fs::metadata(path)
            .map_err(|e| format!("Source file '{}' became inaccessible: {}", path.display(), e))?;
        if meta.len() != self.expected_size {
            return Err(format!(
                "Source file '{}' changed size mid-transfer ({} -> {} bytes)",
                path.display(),
                self.expected_size,
                meta.len()
            ));
        }
        let current_mod = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
            .map(|d| d.as_secs());
        if self.modified_secs.is_some() && current_mod != self.modified_secs {
            return Err(format!(
                "Source file '{}' was modified during transfer; aborted to prevent corruption",
                path.display()
            ));
        }
        Ok(())
    }
}

/// Checked 64-bit file offset arithmetic preventing overflow on multi-GB files
pub fn checked_next_offset(current_offset: u64, chunk_len: usize) -> Result<u64, String> {
    current_offset
        .checked_add(chunk_len as u64)
        .ok_or_else(|| "64-bit file offset overflow detected".to_string())
}

#[derive(Debug, Clone)]
pub struct DiskSpaceCheckResult {
    pub available_bytes: Option<u64>,
    pub required_bytes: u64,
    pub sufficient: bool,
    pub message: String,
}

pub fn evaluate_disk_space(available_bytes: Option<u64>, required_bytes: u64) -> DiskSpaceCheckResult {
    match available_bytes {
        None => DiskSpaceCheckResult {
            available_bytes: None,
            required_bytes,
            sufficient: true,
            message: "Free disk space check unavailable on this filesystem; proceeding cautiously"
                .to_string(),
        },
        Some(avail) => {
            // Require incoming bytes + small safety headroom (10 MB or 2%)
            let headroom = (required_bytes / 50).max(10 * 1024 * 1024);
            let total_needed = required_bytes.saturating_add(headroom);
            if avail < total_needed {
                DiskSpaceCheckResult {
                    available_bytes: Some(avail),
                    required_bytes,
                    sufficient: false,
                    message: format!(
                        "Insufficient disk space: need ~{} bytes ({} + safety headroom), only {} bytes available",
                        total_needed, required_bytes, avail
                    ),
                }
            } else {
                DiskSpaceCheckResult {
                    available_bytes: Some(avail),
                    required_bytes,
                    sufficient: true,
                    message: format!("Disk space verified ({} bytes available)", avail),
                }
            }
        }
    }
}

/// Queries available free bytes on the filesystem containing `target_dir`.
/// Uses safe OS utilities without unstable FFI struct layouts; returns `None` cleanly if unavailable.
pub fn query_available_disk_bytes(target_dir: &Path) -> Option<u64> {
    let check_path = if target_dir.exists() {
        target_dir.to_path_buf()
    } else {
        target_dir.parent().unwrap_or_else(|| Path::new(".")).to_path_buf()
    };

    #[cfg(unix)]
    {
        let output = Command::new("df")
            .arg("-Pk")
            .arg(&check_path)
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let stdout = String::from_utf8_lossy(&output.stdout);
        let line = stdout.lines().nth(1)?;
        let cols: Vec<&str> = line.split_whitespace().collect();
        // POSIX `df -Pk`: Filesystem 1024-blocks Used Available Capacity Mounted-on
        if cols.len() >= 4 {
            if let Ok(avail_kb) = cols[3].parse::<u64>() {
                return Some(avail_kb.saturating_mul(1024));
            }
        }
        None
    }

    #[cfg(not(unix))]
    {
        let _ = check_path;
        None
    }
}

pub fn check_available_disk_space(target_dir: &Path, required_bytes: u64) -> DiskSpaceCheckResult {
    let avail = query_available_disk_bytes(target_dir);
    evaluate_disk_space(avail, required_bytes)
}

/// Bounded pooled buffer allocator so streaming multi-GB files does not allocate/drop megabytes per chunk.
pub struct ChunkBufferPool {
    pool: Mutex<VecDeque<Vec<u8>>>,
    active_buffers: AtomicUsize,
    active_bytes: AtomicUsize,
    peak_bytes: AtomicUsize,
    active_file_handles: AtomicUsize,
}

impl ChunkBufferPool {
    pub fn new() -> Self {
        Self {
            pool: Mutex::new(VecDeque::with_capacity(MAX_POOL_BUFFERS)),
            active_buffers: AtomicUsize::new(0),
            active_bytes: AtomicUsize::new(0),
            peak_bytes: AtomicUsize::new(0),
            active_file_handles: AtomicUsize::new(0),
        }
    }

    pub fn acquire(self: &Arc<Self>, min_capacity: usize) -> PooledChunkBuffer {
        let mut buf = {
            let mut guard = self.pool.lock().unwrap();
            let pos = guard.iter().position(|b| b.capacity() >= min_capacity);
            match pos {
                Some(idx) => guard.remove(idx).unwrap(),
                None => guard.pop_front().unwrap_or_else(|| Vec::with_capacity(min_capacity)),
            }
        };

        if buf.len() < min_capacity {
            buf.resize(min_capacity, 0);
        }

        self.active_buffers.fetch_add(1, Ordering::Relaxed);
        let new_bytes = self
            .active_bytes
            .fetch_add(buf.capacity(), Ordering::Relaxed)
            + buf.capacity();

        let mut prev_peak = self.peak_bytes.load(Ordering::Relaxed);
        while new_bytes > prev_peak {
            match self.peak_bytes.compare_exchange_weak(
                prev_peak,
                new_bytes,
                Ordering::Relaxed,
                Ordering::Relaxed,
            ) {
                Ok(_) => break,
                Err(v) => prev_peak = v,
            }
        }

        PooledChunkBuffer {
            buffer: Some(buf),
            pool: Arc::clone(self),
        }
    }

    pub fn increment_file_handles(&self) {
        self.active_file_handles.fetch_add(1, Ordering::Relaxed);
    }

    pub fn decrement_file_handles(&self) {
        let _ = self
            .active_file_handles
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |v| {
                Some(v.saturating_sub(1))
            });
    }

    pub fn snapshot(&self) -> (usize, usize, usize, usize, usize) {
        let pooled_count = self.pool.lock().map(|g| g.len()).unwrap_or(0);
        (
            self.active_file_handles.load(Ordering::Relaxed),
            self.active_buffers.load(Ordering::Relaxed),
            pooled_count,
            self.active_bytes.load(Ordering::Relaxed),
            self.peak_bytes.load(Ordering::Relaxed),
        )
    }

    pub fn memory_pressure_pct(&self) -> u8 {
        let active = self.active_bytes.load(Ordering::Relaxed);
        ((active.saturating_mul(100)) / MAX_POOL_MEMORY_BYTES).min(100) as u8
    }

    fn release_raw(&self, mut buf: Vec<u8>) {
        let cap = buf.capacity();
        let _ = self
            .active_buffers
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |v| {
                Some(v.saturating_sub(1))
            });
        let _ = self
            .active_bytes
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |v| {
                Some(v.saturating_sub(cap))
            });

        // Zeroize sensitive buffer bytes briefly only up to current length and keep pool bounded
        buf.clear();
        if let Ok(mut guard) = self.pool.lock() {
            let pooled_total: usize = guard.iter().map(|b| b.capacity()).sum();
            if guard.len() < MAX_POOL_BUFFERS && pooled_total + cap <= MAX_POOL_MEMORY_BYTES {
                guard.push_back(buf);
            }
        }
    }
}

pub struct PooledChunkBuffer {
    buffer: Option<Vec<u8>>,
    pool: Arc<ChunkBufferPool>,
}

impl PooledChunkBuffer {
    pub fn as_mut_slice(&mut self, len: usize) -> &mut [u8] {
        let vec = self.buffer.as_mut().expect("buffer released");
        if vec.len() < len {
            vec.resize(len, 0);
        }
        &mut vec[..len]
    }
}

impl Drop for PooledChunkBuffer {
    fn drop(&mut self) {
        if let Some(buf) = self.buffer.take() {
            self.pool.release_raw(buf);
        }
    }
}
