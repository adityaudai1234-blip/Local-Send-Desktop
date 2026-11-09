use std::time::Duration;
use rand::Rng;

pub const MAX_RECONNECT_ATTEMPTS: u32 = 5;
pub const MAX_BACKOFF_SECONDS: u64 = 30;

pub fn calculate_backoff(attempt: u32) -> Duration {
    let base = 2u64.saturating_pow(attempt).min(MAX_BACKOFF_SECONDS);
    let jitter_ms = rand::thread_rng().gen_range(100..500);
    Duration::from_millis((base * 1000) + jitter_ms)
}
