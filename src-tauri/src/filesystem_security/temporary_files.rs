use std::fs;
use std::path::{Path, PathBuf};

use super::path_validation::assert_contained_and_no_symlink;
use super::permissions::apply_restrictive_file_permissions;

/// Computes an isolated temporary `.part` file path verified to reside within `download_root`.
pub fn safe_part_file_path(
    download_root: &Path,
    target_file: &Path,
    transfer_id: &str,
) -> Result<PathBuf, String> {
    let prefix = target_file
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("transfer");
    let short_id = &transfer_id[..transfer_id.len().min(8)];
    let part_path = target_file.with_file_name(format!("{}.{}.part", prefix, short_id));
    assert_contained_and_no_symlink(download_root, &part_path)?;
    Ok(part_path)
}

/// Atomically moves verified `.part` file to final destination and locks permissions (`0o600`).
pub fn secure_finalize_part_file(
    download_root: &Path,
    part_file: &Path,
    target_file: &Path,
) -> Result<(), String> {
    assert_contained_and_no_symlink(download_root, part_file)?;
    assert_contained_and_no_symlink(download_root, target_file)?;

    if !part_file.exists() {
        return Err("Temporary .part file missing during finalization".to_string());
    }

    fs::rename(part_file, target_file)
        .map_err(|e| format!("Failed atomic .part finalization: {}", e))?;

    apply_restrictive_file_permissions(target_file);
    Ok(())
}

/// Best-effort cleanup of corrupted or aborted `.part` files.
pub fn cleanup_part_file(part_file: &Path) {
    if part_file.exists() {
        let _ = fs::remove_file(part_file);
    }
}
