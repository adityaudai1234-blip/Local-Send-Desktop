pub const MIN_ADAPTIVE_CHUNK_SIZE: usize = 64 * 1024; // 64 KB
pub const DEFAULT_ADAPTIVE_CHUNK_SIZE: usize = 256 * 1024; // 256 KB
pub const MAX_ADAPTIVE_CHUNK_SIZE: usize = 4 * 1024 * 1024; // 4 MB
pub const ANDROID_WIRE_SAFE_CAP: usize = 1024 * 1024; // 1 MB default wire envelope cap unless higher negotiated

#[derive(Debug, Clone, Copy)]
pub struct ChunkAdaptationSignals {
    pub rolling_speed_bps: u64,
    pub file_size_bytes: u64,
    pub bytes_remaining: u64,
    pub recent_retries: u32,
    pub disk_write_latency_us: u64,
    pub buffer_memory_pressure_pct: u8,
    pub peer_max_chunk_size: Option<usize>,
    pub adaptive_enabled: bool,
    pub configured_default_bytes: usize,
}

#[derive(Debug, Clone)]
pub struct AdaptiveChunkController {
    current_chunk_bytes: usize,
    last_adjustment_reason: String,
}

impl AdaptiveChunkController {
    pub fn new(initial_bytes: usize) -> Self {
        let clamped = Self::clamp_chunk_size(initial_bytes, None);
        Self {
            current_chunk_bytes: clamped,
            last_adjustment_reason: "Initial default configuration".to_string(),
        }
    }

    pub fn current_chunk_bytes(&self) -> usize {
        self.current_chunk_bytes
    }

    pub fn last_reason(&self) -> &str {
        &self.last_adjustment_reason
    }

    /// Selects a safe, power-of-two aligned chunk size between 64 KB and 4 MB,
    /// strictly honoring any negotiated peer cap (e.g., Android receiver limits).
    pub fn clamp_chunk_size(bytes: usize, peer_cap: Option<usize>) -> usize {
        let max_cap = peer_cap
            .map(|c| c.clamp(MIN_ADAPTIVE_CHUNK_SIZE, MAX_ADAPTIVE_CHUNK_SIZE))
            .unwrap_or(MAX_ADAPTIVE_CHUNK_SIZE);

        let bounded = bytes.clamp(MIN_ADAPTIVE_CHUNK_SIZE, max_cap);
        // Align to 64 KB multiples for clean buffered disk & AEAD frame boundaries
        let unit = MIN_ADAPTIVE_CHUNK_SIZE;
        let aligned = (bounded / unit) * unit;
        aligned.clamp(MIN_ADAPTIVE_CHUNK_SIZE, max_cap)
    }

    /// Computes initial chunk size for a file transfer before streaming begins.
    /// Small files use smaller chunks to start transferring immediately without memory bloat.
    pub fn recommend_for_file(signals: ChunkAdaptationSignals) -> usize {
        if !signals.adaptive_enabled {
            return Self::clamp_chunk_size(
                signals.configured_default_bytes,
                signals.peer_max_chunk_size,
            );
        }

        let target = if signals.file_size_bytes <= 256 * 1024 {
            64 * 1024
        } else if signals.file_size_bytes <= 8 * 1024 * 1024 {
            256 * 1024
        } else if signals.file_size_bytes <= 256 * 1024 * 1024 {
            512 * 1024
        } else {
            1024 * 1024
        };

        Self::clamp_chunk_size(target, signals.peer_max_chunk_size)
    }

    /// Smoothly adapts chunk size between completed chunks/windows.
    /// Never invalidates already-written byte offsets because offsets are tracked explicitly as `u64`.
    pub fn evaluate_next(&mut self, signals: ChunkAdaptationSignals) -> usize {
        if !signals.adaptive_enabled {
            self.current_chunk_bytes = Self::clamp_chunk_size(
                signals.configured_default_bytes,
                signals.peer_max_chunk_size,
            );
            self.last_adjustment_reason = "Manual fixed chunk size active".to_string();
            return self.current_chunk_bytes;
        }

        // Step down immediately on retries, high memory pressure, or slow disk I/O
        if signals.recent_retries > 0 {
            let shrunk = self.current_chunk_bytes / 2;
            self.current_chunk_bytes = Self::clamp_chunk_size(shrunk, signals.peer_max_chunk_size);
            self.last_adjustment_reason =
                "Reduced chunk size after transfer retry to improve recovery granularity"
                    .to_string();
            return self.current_chunk_bytes;
        }

        if signals.buffer_memory_pressure_pct >= 80 {
            let shrunk = self.current_chunk_bytes / 2;
            self.current_chunk_bytes = Self::clamp_chunk_size(shrunk, signals.peer_max_chunk_size);
            self.last_adjustment_reason =
                "Reduced chunk size under buffer pool memory pressure".to_string();
            return self.current_chunk_bytes;
        }

        if signals.disk_write_latency_us > 40_000 {
            let shrunk = (self.current_chunk_bytes * 3) / 4;
            self.current_chunk_bytes = Self::clamp_chunk_size(shrunk, signals.peer_max_chunk_size);
            self.last_adjustment_reason =
                "Reduced chunk size due to elevated disk write latency".to_string();
            return self.current_chunk_bytes;
        }

        // Step up smoothly on high-throughput healthy LAN links
        let desired = if signals.rolling_speed_bps >= 80 * 1024 * 1024 && signals.bytes_remaining > 16 * 1024 * 1024 {
            (self.current_chunk_bytes * 2).min(4 * 1024 * 1024)
        } else if signals.rolling_speed_bps >= 30 * 1024 * 1024 && signals.bytes_remaining > 4 * 1024 * 1024 {
            (self.current_chunk_bytes * 2).min(2 * 1024 * 1024)
        } else if signals.rolling_speed_bps >= 10 * 1024 * 1024 && signals.bytes_remaining > 2 * 1024 * 1024 {
            (self.current_chunk_bytes * 2).min(1024 * 1024)
        } else if signals.rolling_speed_bps > 0 && signals.rolling_speed_bps < 1024 * 1024 {
            // Very slow Wi-Fi / congested link: smaller chunk keeps progress responsive
            (self.current_chunk_bytes / 2).max(MIN_ADAPTIVE_CHUNK_SIZE)
        } else {
            self.current_chunk_bytes
        };

        let next = Self::clamp_chunk_size(desired, signals.peer_max_chunk_size);
        if next > self.current_chunk_bytes {
            self.last_adjustment_reason = "Scaled chunk size up on high-throughput stable link".to_string();
        } else if next < self.current_chunk_bytes {
            self.last_adjustment_reason = "Scaled chunk size down for slower network throughput".to_string();
        }
        self.current_chunk_bytes = next;
        self.current_chunk_bytes
    }
}
