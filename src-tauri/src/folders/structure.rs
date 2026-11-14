use std::fs;
use std::path::{Path, PathBuf};

use super::validation::validate_relative_path;

/// Resolves the destination directory for an incoming folder or file entry,
/// ensuring all parent directories exist and no path traversal occurs.
pub fn prepare_incoming_path(
    download_root: &Path,
    relative_path: &str,
    is_directory: bool,
) -> Result<PathBuf, String> {
    let sanitized_rel = validate_relative_path(relative_path)?;
    let target_path = download_root.join(&sanitized_rel);

    if is_directory {
        fs::create_dir_all(&target_path)
            .map_err(|e| format!("Failed to create incoming directory {}: {}", target_path.display(), e))?;
    } else if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create parent directory for {}: {}", target_path.display(), e))?;
    }

    Ok(target_path)
}
