use std::path::{Path, PathBuf};

/// Sanitizes a filename from remote sources to prevent path traversal and illegal character exploits.
/// Strips directory separators, relative traversal sequences (".."), leading dots, and illegal characters.
pub fn sanitize_filename(input: &str) -> String {
    // 1. Remove path separators, null bytes, and control characters
    let mut cleaned: String = input
        .chars()
        .filter(|&c| {
            c != '/'
                && c != '\\'
                && c != '\0'
                && c != ':'
                && c != '*'
                && c != '?'
                && c != '"'
                && c != '<'
                && c != '>'
                && c != '|'
                && !c.is_control()
        })
        .collect();

    // 2. Prevent relative parent traversal or hidden dots
    while cleaned.starts_with('.') {
        cleaned.remove(0);
    }

    cleaned = cleaned.trim().to_string();

    // Fallback if empty or completely stripped
    if cleaned.is_empty() {
        return "received_file.bin".to_string();
    }

    cleaned
}

/// Resolves file name collision by generating "filename (1).ext", "filename (2).ext", etc.
/// Never silently overwrites an existing file.
pub fn resolve_conflict(dir: &Path, file_name: &str) -> PathBuf {
    let sanitized = sanitize_filename(file_name);
    let target = dir.join(&sanitized);

    if !target.exists() {
        return target;
    }

    let p = Path::new(&sanitized);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");

    let mut counter = 1;
    loop {
        let candidate_name = if ext.is_empty() {
            format!("{} ({})", stem, counter)
        } else {
            format!("{} ({}).{}", stem, counter, ext)
        };

        let candidate_path = dir.join(&candidate_name);
        if !candidate_path.exists() {
            return candidate_path;
        }

        counter += 1;
    }
}

/// Simple MIME type lookup based on file extension
pub fn detect_mime_type(file_name: &str) -> String {
    let ext = Path::new(file_name)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "pdf" => "application/pdf",
        "zip" => "application/zip",
        "tar" => "application/x-tar",
        "gz" => "application/gzip",
        "mp4" => "video/mp4",
        "mkv" => "video/x-matroska",
        "mov" => "video/quicktime",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "flac" => "audio/flac",
        "txt" => "text/plain",
        "json" => "application/json",
        "rs" => "text/x-rust",
        "ts" | "tsx" => "text/typescript",
        "js" | "jsx" => "text/javascript",
        "apk" => "application/vnd.android.package-archive",
        "dmg" => "application/x-apple-diskimage",
        "exe" => "application/x-msdownload",
        _ => "application/octet-stream",
    }
    .to_string()
}
