use rusqlite::{Connection, Result as SqlResult};

pub fn init_database(conn: &Connection) -> SqlResult<()> {
    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
        
        CREATE TABLE IF NOT EXISTS transfers (
            transfer_id TEXT PRIMARY KEY,
            direction TEXT NOT NULL,
            sender_id TEXT NOT NULL,
            sender_name TEXT NOT NULL,
            recipient_id TEXT NOT NULL,
            recipient_name TEXT NOT NULL,
            recipient_ip TEXT,
            total_bytes INTEGER NOT NULL,
            bytes_transferred INTEGER NOT NULL,
            speed_bps INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL,
            priority INTEGER NOT NULL DEFAULT 2,
            is_folder INTEGER NOT NULL DEFAULT 0,
            root_name TEXT NOT NULL,
            file_count INTEGER NOT NULL DEFAULT 1,
            started_at INTEGER NOT NULL,
            completed_at INTEGER,
            error_message TEXT,
            destination_directory TEXT
        );

        CREATE TABLE IF NOT EXISTS transfer_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            transfer_id TEXT NOT NULL,
            file_id TEXT NOT NULL,
            file_name TEXT NOT NULL,
            relative_path TEXT,
            file_size INTEGER NOT NULL,
            mime_type TEXT NOT NULL,
            bytes_transferred INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL,
            sha256_checksum TEXT,
            is_verified INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (transfer_id) REFERENCES transfers(transfer_id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_transfers_started_at ON transfers(started_at DESC);
        CREATE INDEX IF NOT EXISTS idx_transfers_status ON transfers(status);
        CREATE INDEX IF NOT EXISTS idx_transfers_direction ON transfers(direction);
        CREATE INDEX IF NOT EXISTS idx_transfer_files_tx ON transfer_files(transfer_id);"
    )?;

    Ok(())
}
