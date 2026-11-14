use std::fs;
use std::path::Path;
use uuid::Uuid;

use super::metadata::{FolderFileEntry, FolderMetadata};
use crate::file_system::filename::detect_mime_type;

pub fn scan_directory(dir_path: &Path) -> Result<FolderMetadata, String> {
    if !dir_path.exists() {
        return Err(format!("Directory does not exist: {}", dir_path.display()));
    }
    if !dir_path.is_dir() {
        return Err(format!("Path is not a directory: {}", dir_path.display()));
    }

    let folder_name = dir_path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("Shared_Folder")
        .to_string();

    let mut entries: Vec<FolderFileEntry> = Vec::new();
    let mut total_bytes: u64 = 0;
    let mut total_files: usize = 0;
    let mut total_folders: usize = 0;

    let parent_of_root = dir_path.parent().unwrap_or(dir_path);

    // Recursive traversal helper
    let mut stack = vec![dir_path.to_path_buf()];

    while let Some(current_dir) = stack.pop() {
        let read_dir = match fs::read_dir(&current_dir) {
            Ok(rd) => rd,
            Err(_) => continue, // Skip unreadable directory
        };

        let mut has_children = false;

        for entry_res in read_dir {
            let entry = match entry_res {
                Ok(e) => e,
                Err(_) => continue,
            };

            let path = entry.path();
            let ft = match entry.file_type() {
                Ok(f) => f,
                Err(_) => continue,
            };

            // Do not follow symlinks by default to prevent loops and escaping directory bounds
            if ft.is_symlink() {
                continue;
            }

            has_children = true;

            // Calculate relative path from parent of root directory
            let rel_path = match path.strip_prefix(parent_of_root) {
                Ok(r) => r.to_string_lossy().replace('\\', "/"),
                Err(_) => continue,
            };

            let name = path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();

            if ft.is_dir() {
                total_folders += 1;
                stack.push(path.clone());
            } else if ft.is_file() {
                let metadata = match fs::metadata(&path) {
                    Ok(m) => m,
                    Err(_) => continue,
                };

                let size = metadata.len();
                let mime = detect_mime_type(&name);
                let last_mod = metadata
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or_else(|| chrono::Utc::now().timestamp_millis());

                total_files += 1;
                total_bytes += size;

                entries.push(FolderFileEntry {
                    id: Uuid::new_v4().to_string(),
                    name,
                    relative_path: rel_path,
                    full_path: Some(path.to_string_lossy().to_string()),
                    size,
                    mime_type: mime,
                    is_directory: false,
                    last_modified: last_mod,
                });
            }
        }

        // If directory has no children, record it as an empty directory entry
        if !has_children && current_dir != dir_path {
            if let Ok(rel_path) = current_dir.strip_prefix(parent_of_root) {
                let name = current_dir
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_string();

                entries.push(FolderFileEntry {
                    id: Uuid::new_v4().to_string(),
                    name,
                    relative_path: rel_path.to_string_lossy().replace('\\', "/"),
                    full_path: Some(current_dir.to_string_lossy().to_string()),
                    size: 0,
                    mime_type: "application/x-directory".to_string(),
                    is_directory: true,
                    last_modified: chrono::Utc::now().timestamp_millis(),
                });
            }
        }
    }

    Ok(FolderMetadata {
        folder_name,
        root_path: dir_path.to_string_lossy().to_string(),
        total_files,
        total_folders,
        total_bytes,
        files: entries,
    })
}
