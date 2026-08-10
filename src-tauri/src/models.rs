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
    pub auto_paste: bool,
    pub auto_paste_close: bool,
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

// ---------------------------------------------------------------------------
// Backup / Import models
// ---------------------------------------------------------------------------

/// A history row as stored in the DB (file_paths column included), used when
/// importing a backup so the raw row can be re-inserted verbatim.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportedHistoryRow {
    pub id: i64,
    pub item_type: String,
    pub text_value: Option<String>,
    pub image_path: Option<String>,
    pub thumbnail_path: Option<String>,
    pub file_paths: Option<String>,
    pub md5_hash: Option<String>,
    pub created_at: String,
}

/// A favorite row for import.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportedFavoriteRow {
    pub item_id: i64,
    pub file_path: Option<String>,
}

/// The JSON file written by export and read by import.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupFile {
    pub version: String,
    pub exported_at: String,
    pub app: String,
    pub data: BackupData,
}

/// Information about which sections exist in a backup file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupSectionInfo {
    pub history: bool,
    pub favorites: bool,
    pub settings: bool,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct BackupData {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub history: Vec<ImportedHistoryRow>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub favorites: Vec<ImportedFavoriteRow>,
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub settings: std::collections::BTreeMap<String, String>,
}