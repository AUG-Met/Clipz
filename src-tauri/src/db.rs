use rusqlite::{Connection, Result, params};
use std::path::Path;

use crate::models::HistoryItem;

/// Initialise the SQLite database, creating tables if they do not exist.
pub fn init_db(db_path: &Path) -> Result<Connection> {
    let conn = Connection::open(db_path)?;

    conn.execute_batch("PRAGMA journal_mode=WAL;")?;
    conn.execute_batch("PRAGMA foreign_keys=ON;")?;

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS history (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            item_type     TEXT    NOT NULL,
            text_value    TEXT,
            image_path    TEXT,
            thumbnail_path TEXT,
            file_paths    TEXT,
            md5_hash      TEXT,
            created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
        );

        CREATE INDEX IF NOT EXISTS idx_history_md5 ON history(md5_hash);
        CREATE INDEX IF NOT EXISTS idx_history_created ON history(created_at DESC);

        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS favorites (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            item_id    INTEGER NOT NULL,
            file_path  TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
            UNIQUE(item_id, file_path)
        );",
    )?;

    Ok(conn)
}

// ---------------------------------------------------------------------------
// History CRUD
// ---------------------------------------------------------------------------

/// Insert a text item and return its new id.
pub fn add_text(conn: &Connection, text: &str, md5_hash: &str) -> Result<i64> {
    conn.execute(
        "INSERT INTO history (item_type, text_value, md5_hash) VALUES (?1, ?2, ?3)",
        params!["text", text, md5_hash],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Insert a text item, deduping by md5_hash: deletes any existing entry with
/// the same hash first, so the item moves to the top with a fresh timestamp.
pub fn upsert_text(conn: &Connection, text: &str, md5_hash: &str) -> Result<i64> {
    conn.execute(
        "DELETE FROM history WHERE md5_hash = ?1 AND item_type = 'text'",
        params![md5_hash],
    )?;
    conn.execute(
        "INSERT INTO history (item_type, text_value, md5_hash) VALUES (?1, ?2, ?3)",
        params!["text", text, md5_hash],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Insert an image item and return its new id.
pub fn add_image(
    conn: &Connection,
    image_path: &str,
    thumbnail_path: &str,
    md5_hash: &str,
) -> Result<i64> {
    conn.execute(
        "INSERT INTO history (item_type, image_path, thumbnail_path, md5_hash) VALUES (?1, ?2, ?3, ?4)",
        params!["image", image_path, thumbnail_path, md5_hash],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Insert a file(s) item and return its new id.
/// `file_paths_json` is a JSON-serialised array of path strings.
pub fn add_file(conn: &Connection, file_paths_json: &str, md5_hash: &str) -> Result<i64> {
    let item_type = if file_paths_json.contains(',') { "files" } else { "file" };
    conn.execute(
        "INSERT INTO history (item_type, text_value, file_paths, md5_hash) VALUES (?1, ?2, ?3, ?4)",
        params![item_type, file_paths_json, file_paths_json, md5_hash],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Insert a file(s) item, deleting any existing entry with the same hash first (dedup + move to top).
pub fn upsert_file(conn: &Connection, file_paths_json: &str, md5_hash: &str) -> Result<i64> {
    conn.execute(
        "DELETE FROM history WHERE md5_hash = ?1 AND (item_type = 'file' OR item_type = 'files')",
        params![md5_hash],
    )?;
    add_file(conn, file_paths_json, md5_hash)
}

/// Return the most recent history items, optionally filtered by search query.
pub fn get_history(conn: &Connection, search_query: Option<&str>) -> Result<Vec<HistoryItem>> {
    let limit = 200;

    let (sql, has_where): (String, bool) = if let Some(q) = search_query {
        if q.is_empty() {
            (format!("SELECT id, item_type, text_value, image_path, thumbnail_path, md5_hash, created_at FROM history ORDER BY id DESC LIMIT {limit}"), false)
        } else {
            (format!("SELECT id, item_type, text_value, image_path, thumbnail_path, md5_hash, created_at FROM history WHERE item_type = 'text' AND text_value LIKE ?1 ORDER BY id DESC LIMIT {limit}"), true)
        }
    } else {
        (format!("SELECT id, item_type, text_value, image_path, thumbnail_path, md5_hash, created_at FROM history ORDER BY id DESC LIMIT {limit}"), false)
    };

    let mut stmt = conn.prepare(&sql)?;

    let items = if has_where {
        let like = format!("%{}%", search_query.as_deref().unwrap_or(""));
        stmt.query_map(params![like], row_to_item)?
    } else {
        stmt.query_map([], row_to_item)?
    };

    let mut result = Vec::new();
    for item in items {
        result.push(item?);
    }
    Ok(result)
}

/// Return a single item by id.
pub fn get_item(conn: &Connection, id: i64) -> Result<Option<HistoryItem>> {
    let sql = "SELECT id, item_type, text_value, image_path, thumbnail_path, md5_hash, created_at FROM history WHERE id = ?1";
    let mut stmt = conn.prepare(sql)?;
    let mut rows = stmt.query_map(params![id], row_to_item)?;
    match rows.next() {
        Some(Ok(item)) => Ok(Some(item)),
        _ => Ok(None),
    }
}

/// Delete a single history item by id.
pub fn delete_item(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM history WHERE id = ?1", params![id])?;
    Ok(())
}

/// Delete all history items, keeping any items that have been favorited.
/// This lets "clear" remove non-favorites while the favorites collection
/// (which references history rows) stays intact.
pub fn clear_history(conn: &Connection) -> Result<()> {
    conn.execute(
        "DELETE FROM history WHERE id NOT IN (SELECT item_id FROM favorites)",
        [],
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/// Read a setting value, returning `default` if the key is absent.
pub fn get_setting(conn: &Connection, key: &str, default: &str) -> String {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        params![key],
        |row| row.get::<_, String>(0),
    )
    .unwrap_or_else(|_| default.to_string())
}

/// Upsert a setting.
pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Favorites
// ---------------------------------------------------------------------------

/// Toggle favorite status for an item (or a specific file within an item).
/// Returns `true` if the item is now favorited, `false` if removed.
pub fn toggle_favorite(
    conn: &Connection,
    item_id: i64,
    file_path: Option<&str>,
) -> Result<bool> {
    let existing: Option<bool> = conn
        .query_row(
            "SELECT 1 FROM favorites WHERE item_id = ?1 AND ((?2 IS NULL AND file_path IS NULL) OR file_path = ?2)",
            params![item_id, file_path],
            |_| Ok(true),
        )
        .ok();

    if existing.is_some() {
        conn.execute(
            "DELETE FROM favorites WHERE item_id = ?1 AND ((?2 IS NULL AND file_path IS NULL) OR file_path = ?2)",
            params![item_id, file_path],
        )?;
        Ok(false)
    } else {
        conn.execute(
            "INSERT INTO favorites (item_id, file_path) VALUES (?1, ?2)",
            params![item_id, file_path],
        )?;
        Ok(true)
    }
}

/// Get all favorites with their file_path info.
pub fn get_all_favorites(conn: &Connection) -> Result<Vec<(i64, Option<String>)>> {
    let mut stmt = conn.prepare("SELECT item_id, file_path FROM favorites ORDER BY id DESC")?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, Option<String>>(1)?))
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn row_to_item(row: &rusqlite::Row) -> rusqlite::Result<HistoryItem> {
    Ok(HistoryItem {
        id: row.get(0)?,
        item_type: row.get(1)?,
        text_value: row.get(2)?,
        image_path: row.get(3)?,
        thumbnail_path: row.get(4)?,
        md5_hash: row.get(5)?,
        created_at: row.get(6)?,
    })
}