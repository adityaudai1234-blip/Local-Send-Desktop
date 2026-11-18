use std::path::Path;

const WINDOWS_RESERVED_NAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Hardened filename sanitization rejecting traversal tokens, null bytes, control chars,
/// illegal filesystem characters, trailing dots/spaces, and Windows reserved device names.
pub fn sanitize_untrusted_filename(raw: &str) -> Result<String, String> {
    if raw.contains('\0') {
        return Err("Filename contains null byte".to_string());
    }
    if raw.contains('/') || raw.contains('\\') {
        return Err("Filename must not contain directory separators".to_string());
    }

    let cleaned: String = raw
        .chars()
        .filter(|&c| {
            !c.is_control()
                && !matches!(c, ':' | '*' | '?' | '"' | '<' | '>' | '|')
        })
        .collect();

    let trimmed = cleaned.trim().trim_matches('.');
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        return Err("Filename resolves to empty or traversal token".to_string());
    }

    // Check reserved Windows device names (even without extension, e.g., CON.txt)
    let stem = Path::new(trimmed)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(trimmed)
        .to_uppercase();

    let final_name = if WINDOWS_RESERVED_NAMES.contains(&stem.as_str()) {
        format!("_{}", trimmed)
    } else {
        trimmed.to_string()
    };

    // Cap single filename component length safely below OS limits (255 bytes)
    if final_name.len() > 200 {
        let mut truncated = final_name.chars().take(180).collect::<String>();
        truncated.push_str(".bin");
        return Ok(truncated);
    }

    Ok(final_name)
}

/// Sanitizes an untrusted relative path component-by-component, rejecting `..`, drive letters,
/// UNC prefixes, or absolute roots.
pub fn sanitize_untrusted_relative_path(raw_rel: &str) -> Result<Vec<String>, String> {
    if raw_rel.contains('\0') {
        return Err("Relative path contains null byte".to_string());
    }
    if raw_rel.starts_with('/') || raw_rel.starts_with('\\') {
        return Err("Absolute paths are forbidden in incoming transfers".to_string());
    }
    // Reject Windows drive prefixes like C:\ or C:
    if raw_rel.len() >= 2 && raw_rel.as_bytes()[1] == b':' {
        return Err("Drive-letter paths are forbidden in incoming transfers".to_string());
    }

    let mut components = Vec::new();
    for segment in raw_rel.split(&['/', '\\'][..]) {
        if segment.is_empty() || segment == "." {
            continue;
        }
        if segment == ".." {
            return Err("Path traversal ('..') detected in incoming transfer path".to_string());
        }
        let clean = sanitize_untrusted_filename(segment)?;
        components.push(clean);
    }

    if components.is_empty() {
        return Err("Relative path has no valid components".to_string());
    }

    Ok(components)
}
