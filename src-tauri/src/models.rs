use serde::{Deserialize, Serialize};

/// A single clipboard history item returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryItem {
    pub id: i64,
    /// "text" | "image" | "file" | "files"
    #[serde(rename = "type")]
    pub item_type: String,
    pub text_value: Option<String>,
    pub image_path: Option<String>,
    pub thumbnail_path: Option<String>,
    pub md5_hash: Option<String>,
    pub created_at: String,
}

/// Application settings persisted to the database.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub language: String,
    pub theme: String,
    pub hotkey_modifier: String,
    pub hotkey_key: String,
    pub click_mode: i32,
    pub autostart: bool,
    pub quicklook: bool,
    pub quicklook_path: Option<String>,
    pub auto_collapse: bool,
}

/// A favorite record: an item, or a specific file within an item.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FavoriteEntry {
    pub item_id: i64,
    pub file_path: Option<String>,
}

/// Payload sent to the frontend via the `clipboard-changed` event.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipboardData {
    pub id: i64,
    #[serde(rename = "type")]
    pub item_type: String,
    pub text_value: Option<String>,
    pub image_path: Option<String>,
    pub thumbnail_path: Option<String>,
    pub md5_hash: Option<String>,
    pub created_at: String,
}

impl From<HistoryItem> for ClipboardData {
    fn from(item: HistoryItem) -> Self {
        Self {
            id: item.id,
            item_type: item.item_type,
            text_value: item.text_value,
            image_path: item.image_path,
            thumbnail_path: item.thumbnail_path,
            md5_hash: item.md5_hash,
            created_at: item.created_at,
        }
    }
}