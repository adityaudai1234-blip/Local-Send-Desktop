use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

static DOWNLOAD_DIRECTORY: Mutex<Option<PathBuf>> = Mutex::new(None);

/// Retrieves current configured download directory or system default (~/Downloads/BeamDrop)
pub fn get_download_directory() -> PathBuf {
    let lock = DOWNLOAD_DIRECTORY.lock().unwrap();
    if let Some(ref dir) = *lock {
        return dir.clone();
    }
    drop(lock);

    let default_dir = get_default_download_directory();
    let _ = fs::create_dir_all(&default_dir);
    default_dir
}

/// Updates the active download directory
pub fn set_download_directory(path: PathBuf) -> Result<PathBuf, String> {
    if !path.exists() {
        fs::create_dir_all(&path).map_err(|e| format!("Failed to create download directory: {}", e))?;
    }
    let mut lock = DOWNLOAD_DIRECTORY.lock().unwrap();
    *lock = Some(path.clone());
    Ok(path)
}

/// Computes the default download directory: $HOME/Downloads/BeamDrop
pub fn get_default_download_directory() -> PathBuf {
    let base = if let Ok(home) = std::env::var("HOME") {
        PathBuf::from(home).join("Downloads")
    } else if let Ok(userprofile) = std::env::var("USERPROFILE") {
        PathBuf::from(userprofile).join("Downloads")
    } else {
        std::env::temp_dir().join("Downloads")
    };

    base.join("BeamDrop")
}

/// Ensures the directory exists
pub fn ensure_directory_exists(dir: &Path) -> std::io::Result<()> {
    if !dir.exists() {
        fs::create_dir_all(dir)?;
    }
    Ok(())
}

/// Creates a temporary `.part` file path alongside target destination
pub fn get_part_file_path(target_file: &Path, transfer_id: &str) -> PathBuf {
    let mut part_name = target_file
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("transfer")
        .to_string();
    part_name.push_str(&format!(".{}.part", &transfer_id[..transfer_id.len().min(8)]));

    target_file.with_file_name(part_name)
}

/// Safely and atomically finalizes a .part file by renaming it to the final target filename
pub fn atomic_finalize_part_file(part_file: &Path, target_file: &Path) -> std::io::Result<()> {
    if !part_file.exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "Temporary part file does not exist",
        ));
    }

    // Atomic move
    fs::rename(part_file, target_file)
}

/// Removes incomplete temporary file on cancellation or failure
pub fn clean_incomplete_file(part_file: &Path) {
    if part_file.exists() {
        let _ = fs::remove_file(part_file);
    }
}
