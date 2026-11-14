use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderFileEntry {
    pub id: String,
    pub name: String,
    pub relative_path: String,
    pub full_path: Option<String>,
    pub size: u64,
    pub mime_type: String,
    pub is_directory: bool,
    pub last_modified: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderMetadata {
    pub folder_name: String,
    pub root_path: String,
    pub total_files: usize,
    pub total_folders: usize,
    pub total_bytes: u64,
    pub files: Vec<FolderFileEntry>,
}
