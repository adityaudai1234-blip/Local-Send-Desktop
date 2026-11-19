use std::sync::atomic::{AtomicUsize, Ordering};

pub const MAX_CONCURRENT_TRANSFERS: usize = 3;
pub const MAX_QUEUED_TRANSFERS: usize = 250;
pub const DEFAULT_CHUNK_SIZE: usize = 262_144; // 256 KB Phase 7 baseline

pub struct TransferQueue {
    active_count: AtomicUsize,
    max_concurrent: AtomicUsize,
}

impl TransferQueue {
    pub fn new() -> Self {
        Self {
            active_count: AtomicUsize::new(0),
            max_concurrent: AtomicUsize::new(MAX_CONCURRENT_TRANSFERS),
        }
    }

    pub fn set_max_concurrent(&self, limit: usize) {
        self.max_concurrent
            .store(limit.clamp(1, 16), Ordering::SeqCst);
    }

    pub fn max_concurrent(&self) -> usize {
        self.max_concurrent.load(Ordering::SeqCst)
    }

    pub fn can_start_transfer(&self) -> bool {
        self.active_count.load(Ordering::SeqCst) < self.max_concurrent.load(Ordering::SeqCst)
    }

    pub fn acquire_slot(&self) -> bool {
        let mut current = self.active_count.load(Ordering::SeqCst);
        let limit = self.max_concurrent.load(Ordering::SeqCst);
        loop {
            if current >= limit {
                return false;
            }
            match self.active_count.compare_exchange_weak(
                current,
                current + 1,
                Ordering::SeqCst,
                Ordering::SeqCst,
            ) {
                Ok(_) => return true,
                Err(val) => current = val,
            }
        }
    }

    pub fn release_slot(&self) {
        let _ = self.active_count.fetch_update(Ordering::SeqCst, Ordering::SeqCst, |val| {
            Some(val.saturating_sub(1))
        });
    }

    pub fn active_count(&self) -> usize {
        self.active_count.load(Ordering::SeqCst)
    }
}
