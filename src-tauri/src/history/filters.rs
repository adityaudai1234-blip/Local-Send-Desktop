use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryFilterOptions {
    pub direction: Option<String>, // "all", "sent", "received"
    pub status: Option<String>,    // "all", "completed", "failed", "cancelled", "active"
    pub search_query: Option<String>,
    pub sort_by: Option<String>,   // "newest", "oldest", "largest", "smallest", "success", "failed"
    pub limit: Option<usize>,
    pub offset: Option<usize>,
}
