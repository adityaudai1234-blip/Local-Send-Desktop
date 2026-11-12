use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use uuid::Uuid;

use super::filename::detect_mime_type;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectedFile {
    pub id: String,
    pub name: String,
    pub extension: String,
    pub size: u64,
    pub mime_type: String,
    pub path: String,
    pub last_modified: i64,
}

impl SelectedFile {
    pub fn from_path(path_str: &str) -> Result<Self, String> {
        let path = Path::new(path_str);
        if !path.exists() {
            return Err(format!("File does not exist: {}", path_str));
        }
        if !path.is_file() {
            return Err(format!("Selected path is not a file: {}", path_str));
        }

        let metadata = fs::metadata(path)
            .map_err(|e| format!("Failed to read metadata for {}: {}", path_str, e))?;

        let name = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("unnamed_file")
            .to_string();

        let extension = path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();

        let mime_type = detect_mime_type(&name);

        let last_modified = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or_else(|| chrono::Utc::now().timestamp_millis());

        Ok(Self {
            id: Uuid::new_v4().to_string(),
            name,
            extension,
            size: metadata.len(),
            mime_type,
            path: path.to_string_lossy().to_string(),
            last_modified,
        })
    }
}
