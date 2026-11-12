use sha2::{Digest, Sha256};
use std::path::Path;
use tokio::fs::File;
use tokio::io::AsyncReadExt;

pub struct StreamHasher {
    hasher: Sha256,
    bytes_hashed: u64,
}

impl StreamHasher {
    pub fn new() -> Self {
        Self {
            hasher: Sha256::new(),
            bytes_hashed: 0,
        }
    }

    pub fn update(&mut self, chunk: &[u8]) {
        self.hasher.update(chunk);
        self.bytes_hashed += chunk.len() as u64;
    }

    pub fn finalize_hex(self) -> String {
        hex::encode(self.hasher.finalize())
    }

    pub fn bytes_hashed(&self) -> u64 {
        self.bytes_hashed
    }
}

/// Asynchronously calculates SHA-256 checksum of a file without loading entire file into memory
pub async fn calculate_file_sha256(path: &Path) -> Result<String, String> {
    let mut file = File::open(path)
        .await
        .map_err(|e| format!("Failed to open file for hashing {}: {}", path.display(), e))?;

    let mut stream_hasher = StreamHasher::new();
    let mut buffer = [0u8; 65536]; // 64KB streaming read buffer

    loop {
        let bytes_read = file
            .read(&mut buffer)
            .await
            .map_err(|e| format!("Failed to read stream for {}: {}", path.display(), e))?;

        if bytes_read == 0 {
            break;
        }

        stream_hasher.update(&buffer[..bytes_read]);
    }

    Ok(stream_hasher.finalize_hex())
}
