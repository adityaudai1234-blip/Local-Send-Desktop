use std::fs;
use std::path::{Path, PathBuf};

use super::filename_sanitizer::{sanitize_untrusted_filename, sanitize_untrusted_relative_path};

/// Verifies that no existing ancestor or target component along `candidate` is a symbolic link
/// and that canonicalized ancestors remain strictly contained within canonicalized `root_dir`.
pub fn assert_contained_and_no_symlink(root_dir: &Path, candidate: &Path) -> Result<(), String> {
    if !root_dir.exists() {
        fs::create_dir_all(root_dir)
            .map_err(|e| format!("Failed to prepare root directory: {}", e))?;
    }

    let canonical_root = fs::canonicalize(root_dir)
        .map_err(|e| format!("Failed to canonicalize root directory: {}", e))?;

    // Check every existing ancestor component from root down to candidate for symlinks
    let rel = candidate
        .strip_prefix(root_dir)
        .map_err(|_| "Target path escapes configured download directory".to_string())?;

    let mut current = root_dir.to_path_buf();
    for comp in rel.components() {
        current.push(comp);
        if let Ok(meta) = fs::symlink_metadata(&current) {
            if meta.file_type().is_symlink() {
                return Err(format!(
                    "Symlink detected in destination path: {}",
                    current.display()
                ));
            }
        }
    }

    // Also verify nearest existing ancestor resolves inside canonical_root
    let mut ancestor = candidate.to_path_buf();
    while !ancestor.exists() {
        match ancestor.parent() {
            Some(p) => ancestor = p.to_path_buf(),
            None => return Err("Invalid destination path".to_string()),
        }
    }

    let canonical_ancestor = fs::canonicalize(&ancestor)
        .map_err(|e| format!("Failed to canonicalize target ancestor: {}", e))?;

    if !canonical_ancestor.starts_with(&canonical_root) {
        return Err("Security violation: resolved path escapes download directory".to_string());
    }

    Ok(())
}

/// Safely resolves a target path strictly contained inside `download_root`.
pub fn resolve_safe_destination(
    download_root: &Path,
    file_name: &str,
    relative_path: Option<&str>,
    is_directory: bool,
) -> Result<PathBuf, String> {
    let mut target = download_root.to_path_buf();

    if let Some(rel) = relative_path {
        let components = sanitize_untrusted_relative_path(rel)?;
        for part in components {
            target.push(part);
        }
    } else {
        let safe_name = sanitize_untrusted_filename(file_name)?;
        target.push(safe_name);
    }

    assert_contained_and_no_symlink(download_root, &target)?;

    if is_directory {
        fs::create_dir_all(&target)
            .map_err(|e| format!("Failed to create target directory: {}", e))?;
        super::permissions::apply_restrictive_dir_permissions(&target);
    } else if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create parent directory: {}", e))?;
        super::permissions::apply_restrictive_dir_permissions(parent);
    }

    Ok(target)
}
