use std::sync::atomic::{AtomicUsize, Ordering};

pub const MAX_CONCURRENT_TRANSFERS: usize = 3;
pub const DEFAULT_CHUNK_SIZE: usize = 65536; // 64 KB

pub struct TransferQueue {
    active_count: AtomicUsize,
    max_concurrent: usize,
}

impl TransferQueue {
    pub fn new() -> Self {
        Self {
            active_count: AtomicUsize::new(0),
            max_concurrent: MAX_CONCURRENT_TRANSFERS,
        }
    }

    pub fn can_start_transfer(&self) -> bool {
        self.active_count.load(Ordering::SeqCst) < self.max_concurrent
    }

    pub fn acquire_slot(&self) -> bool {
        let mut current = self.active_count.load(Ordering::SeqCst);
        loop {
            if current >= self.max_concurrent {
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
