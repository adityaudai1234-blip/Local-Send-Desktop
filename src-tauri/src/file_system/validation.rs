use std::path::Path;

/// Validates that a filename does not contain path traversal vectors
pub fn is_safe_filename(name: &str) -> bool {
    if name.is_empty() || name.len() > 255 {
        return false;
    }

    if name.contains('/') || name.contains('\\') || name.contains('\0') {
        return false;
    }

    if name == "." || name == ".." || name.starts_with("../") || name.starts_with("..\\") {
        return false;
    }

    true
}

/// Validates that target path is safely within the target directory boundary
pub fn is_within_directory(dir: &Path, file_path: &Path) -> bool {
    let canonical_dir = match dir.canonicalize() {
        Ok(p) => p,
        Err(_) => return false,
    };

    let canonical_target = match file_path.canonicalize() {
        Ok(p) => p,
        Err(_) => {
            // For files not created yet, check parent
            if let Some(parent) = file_path.parent() {
                match parent.canonicalize() {
                    Ok(p) => p,
                    Err(_) => return false,
                }
            } else {
                return false;
            }
        }
    };

    canonical_target.starts_with(canonical_dir)
}
