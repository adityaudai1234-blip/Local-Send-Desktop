use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

/// Coordinates bounded concurrency limits across simultaneous file operations,
/// chunk pipelines, and transfer sessions without unbounded task spawning.
pub struct ConcurrencyCoordinator {
    file_ops_sem: Arc<tokio::sync::RwLock<Arc<Semaphore>>>,
    chunk_ops_sem: Arc<tokio::sync::RwLock<Arc<Semaphore>>>,
    max_file_ops: AtomicUsize,
    max_chunk_ops: AtomicUsize,
    active_file_ops: Arc<AtomicUsize>,
    active_chunk_ops: Arc<AtomicUsize>,
}

impl ConcurrencyCoordinator {
    pub fn new(max_file_ops: usize, max_chunk_ops: usize) -> Self {
        let f_cap = max_file_ops.clamp(1, 16);
        let c_cap = max_chunk_ops.clamp(1, 16);
        Self {
            file_ops_sem: Arc::new(tokio::sync::RwLock::new(Arc::new(Semaphore::new(f_cap)))),
            chunk_ops_sem: Arc::new(tokio::sync::RwLock::new(Arc::new(Semaphore::new(c_cap)))),
            max_file_ops: AtomicUsize::new(f_cap),
            max_chunk_ops: AtomicUsize::new(c_cap),
            active_file_ops: Arc::new(AtomicUsize::new(0)),
            active_chunk_ops: Arc::new(AtomicUsize::new(0)),
        }
    }

    pub async fn reconfigure(&self, max_file_ops: usize, max_chunk_ops: usize) {
        let f_cap = max_file_ops.clamp(1, 16);
        let c_cap = max_chunk_ops.clamp(1, 16);
        self.max_file_ops.store(f_cap, Ordering::Relaxed);
        self.max_chunk_ops.store(c_cap, Ordering::Relaxed);
        *self.file_ops_sem.write().await = Arc::new(Semaphore::new(f_cap));
        *self.chunk_ops_sem.write().await = Arc::new(Semaphore::new(c_cap));
    }

    pub async fn acquire_file_op(&self) -> Option<FileOpGuard> {
        let sem = self.file_ops_sem.read().await.clone();
        let permit = sem.acquire_owned().await.ok()?;
        self.active_file_ops.fetch_add(1, Ordering::Relaxed);
        Some(FileOpGuard {
            _permit: permit,
            counter: Arc::clone(&self.active_file_ops),
        })
    }

    pub async fn acquire_chunk_op(&self) -> Option<ChunkOpGuard> {
        let sem = self.chunk_ops_sem.read().await.clone();
        let permit = sem.acquire_owned().await.ok()?;
        self.active_chunk_ops.fetch_add(1, Ordering::Relaxed);
        Some(ChunkOpGuard {
            _permit: permit,
            counter: Arc::clone(&self.active_chunk_ops),
        })
    }

    pub fn snapshot(&self) -> (usize, usize, usize, usize) {
        (
            self.active_file_ops.load(Ordering::Relaxed),
            self.max_file_ops.load(Ordering::Relaxed),
            self.active_chunk_ops.load(Ordering::Relaxed),
            self.max_chunk_ops.load(Ordering::Relaxed),
        )
    }
}

pub struct FileOpGuard {
    _permit: OwnedSemaphorePermit,
    counter: Arc<AtomicUsize>,
}

impl Drop for FileOpGuard {
    fn drop(&mut self) {
        let _ = self.counter.fetch_update(Ordering::Relaxed, Ordering::Relaxed, |v| {
            Some(v.saturating_sub(1))
        });
    }
}

pub struct ChunkOpGuard {
    _permit: OwnedSemaphorePermit,
    counter: Arc<AtomicUsize>,
}

impl Drop for ChunkOpGuard {
    fn drop(&mut self) {
        let _ = self.counter.fetch_update(Ordering::Relaxed, Ordering::Relaxed, |v| {
            Some(v.saturating_sub(1))
        });
    }
}
