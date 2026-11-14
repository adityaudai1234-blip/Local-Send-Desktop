use std::path::{Component, Path};

/// Validates that an incoming relative path from a peer is completely safe:
/// - Rejects parent directory traversal (`..`)
/// - Rejects absolute paths (`/` or `\`)
/// - Rejects Windows drive letters (e.g. `C:`)
/// - Rejects null bytes and illegal control characters
/// Returns normalized relative path with standard forward slashes.
pub fn validate_relative_path(input: &str) -> Result<String, String> {
    if input.is_empty() {
        return Err("Relative path cannot be empty".to_string());
    }

    if input.contains('\0') {
        return Err("Relative path contains null byte".to_string());
    }

    let p = Path::new(input);

    let mut normalized_parts: Vec<String> = Vec::new();

    for component in p.components() {
        match component {
            Component::Normal(part) => {
                let part_str = part.to_string_lossy();
                // Reject invalid chars in single component
                if part_str == "." || part_str == ".." {
                    return Err("Illegal directory traversal sequence detected".to_string());
                }
                // Strip invalid control chars
                let sanitized: String = part_str
                    .chars()
                    .filter(|&c| c != ':' && c != '*' && c != '?' && c != '"' && c != '<' && c != '>' && c != '|' && !c.is_control())
                    .collect();

                if sanitized.is_empty() {
                    return Err("Component became empty after sanitation".to_string());
                }
                normalized_parts.push(sanitized);
            }
            Component::ParentDir => {
                return Err("Parent directory traversal (..) is strictly prohibited".to_string());
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err("Absolute path components are prohibited in folder transfers".to_string());
            }
            Component::CurDir => {
                // Ignore '.'
            }
        }
    }

    if normalized_parts.is_empty() {
        return Err("Invalid relative path".to_string());
    }

    Ok(normalized_parts.join("/"))
}
