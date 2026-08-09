use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use md5::{Digest, Md5};
use rusqlite::Connection;
use tauri::{AppHandle, Emitter, Manager};

use crate::db;

/// Result of a single clipboard poll cycle.
enum ClipboardContent {
    Text(String, String),                        // (text, md5_hash)
    Image{width: usize, height: usize, bytes: Vec<u8>, md5: String},
    Files(Vec<String>, String),                  // (paths, md5_hash)
    Unchanged,
}

/// Check if the given hash matches what the app itself just copied. If so,
/// consume the suppression token and return true so the caller skips it.
fn check_suppressed(suppressed: &Arc<Mutex<Option<String>>>, hash: &str) -> bool {
    let mut s = suppressed.lock().unwrap();
    if s.as_deref() == Some(hash) {
        *s = None;
        true
    } else {
        false
    }
}

/// Spawn a background thread that polls the clipboard every 500 ms.
///
/// When a new item is detected it is saved to the database and a
/// `clipboard-changed` event is emitted to the frontend.
///
/// `suppressed_hash` holds the md5 of content the app itself just copied to
/// the clipboard, so the monitor can skip it and avoid creating a duplicate.
pub fn start_clipboard_monitor(
    db: Arc<Mutex<Connection>>,
    app_handle: AppHandle,
    suppressed_hash: Arc<Mutex<Option<String>>>,
) {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let images_dir = app_data_dir.join("images");
    let thumbnails_dir = app_data_dir.join("thumbnails");

    let _ = std::fs::create_dir_all(&images_dir);
    let _ = std::fs::create_dir_all(&thumbnails_dir);

    thread::spawn(move || {
        let mut last_text_hash = String::new();
        let mut last_image_hash = String::new();
        let mut last_files_hash = String::new();
        #[cfg(target_os = "windows")]
        let mut last_seq = clipboard_win::raw::seq_num().map(|s| s.get()).unwrap_or(0);

        loop {
            thread::sleep(Duration::from_millis(200));

            // On Windows, use the clipboard sequence number to detect any
            // clipboard change, even when the content is the same (e.g. user
            // copies the same text again).  On other platforms fall back to
            // hash-based change detection inside poll_clipboard.
            #[cfg(target_os = "windows")]
            {
                let seq = clipboard_win::raw::seq_num().map(|s| s.get()).unwrap_or(0);
                if seq == last_seq {
                    continue;
                }
                last_seq = seq;
            }

            let content = poll_clipboard(
                &mut last_text_hash,
                &mut last_image_hash,
                &mut last_files_hash,
            );

            match content {
                ClipboardContent::Text(text, hash) => {
                    // If the app itself just copied this, skip it so we don't
                    // create a duplicate / reorder the list.
                    if check_suppressed(&suppressed_hash, &hash) {
                        continue;
                    }

                    println!("  [monitor] text detected: \"{}\" hash={}", text.chars().take(40).collect::<String>(), hash);
                    match db.lock() {
                        Ok(conn) => {
                            match db::upsert_text(&conn, &text, &hash) {
                                Ok(id) => {
                                    println!("  [monitor] text saved as id={}", id);
                                    if let Ok(Some(item)) = db::get_item(&conn, id) {
                                        let _ = app_handle.emit("clipboard-changed", &item);
                                    }
                                }
                                Err(e) => println!("  [monitor] upsert_text error: {}", e),
                            }
                        }
                        Err(e) => println!("  [monitor] db.lock error: {}", e),
                    }
                    }
                ClipboardContent::Image{width, height, bytes, md5} => {
                    if check_suppressed(&suppressed_hash, &md5) {
                        continue;
                    }

                    let filename = format!("{}.png", md5);
                    let image_path = images_dir.join(&filename);
                    let thumb_path = thumbnails_dir.join(&filename);

                    // Save full-size image
                    if let Some(img) = image::RgbaImage::from_raw(
                        width as u32,
                        height as u32,
                        bytes.clone(),
                    ) {
                        let _ = img.save(&image_path);
                    }

                    // Create thumbnail (200x200)
                    if let Ok(pix) = image::load_from_memory(
                        &std::fs::read(&image_path).unwrap_or_default(),
                    ) {
                        let thumb = pix.thumbnail(200, 200);
                        let _ = thumb.save(&thumb_path);
                    }

                    if let Ok(conn) = db.lock() {
                        if let Ok(id) = db::add_image(
                            &conn,
                            &image_path.to_string_lossy(),
                            &thumb_path.to_string_lossy(),
                            &md5,
                        ) {
                            if let Ok(Some(item)) = db::get_item(&conn, id) {
                                let _ = app_handle.emit("clipboard-changed", &item);
                            }
                        }
                    }
                }
                ClipboardContent::Files(paths, hash) => {
                    if check_suppressed(&suppressed_hash, &hash) {
                        continue;
                    }

                    let paths_json = serde_json::to_string(&paths).unwrap_or_default();
                    if let Ok(conn) = db.lock() {
                        if let Ok(id) = db::upsert_file(&conn, &paths_json, &hash) {
                            if let Ok(Some(item)) = db::get_item(&conn, id) {
                                let _ = app_handle.emit("clipboard-changed", &item);
                            }
                        }
                    }
                }
                ClipboardContent::Unchanged => {}
            }
        }
    });
}

/// Send a Ctrl+V key combination to the focused window via SendInput.
#[cfg(target_os = "windows")]
pub(crate) fn send_paste() {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::*;

    const VK_V: u16 = 0x56; // 'V'

    let inputs = [
        INPUT { r#type: INPUT_KEYBOARD, Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VK_CONTROL, wScan: 0, dwFlags: 0, time: 0, dwExtraInfo: 0 } } },
        INPUT { r#type: INPUT_KEYBOARD, Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VK_V, wScan: 0, dwFlags: 0, time: 0, dwExtraInfo: 0 } } },
        INPUT { r#type: INPUT_KEYBOARD, Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VK_V, wScan: 0, dwFlags: KEYEVENTF_KEYUP, time: 0, dwExtraInfo: 0 } } },
        INPUT { r#type: INPUT_KEYBOARD, Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VK_CONTROL, wScan: 0, dwFlags: KEYEVENTF_KEYUP, time: 0, dwExtraInfo: 0 } } },
    ];
    unsafe {
        SendInput(4, inputs.as_ptr(), std::mem::size_of::<INPUT>() as i32);
    }
}

/// Check the system clipboard and return what changed (if anything).
///
/// On Windows, the caller already filtered by sequence number, so we always
/// return content when we can read it.  On other platforms we fall back to
/// hash-based change detection (the `_hash` parameters).
fn poll_clipboard(
    last_text_hash: &mut String,
    last_image_hash: &mut String,
    last_files_hash: &mut String,
) -> ClipboardContent {
    // 1) Check files first (Windows) so that copied files aren't
    //    misinterpreted as text (Explorer also puts the path as text).
    #[cfg(target_os = "windows")]
    {
        let files: Vec<String> = clipboard_win::get_clipboard(clipboard_win::formats::FileList).unwrap_or_default();
        if !files.is_empty() {
            let paths_str = serde_json::to_string(&files).unwrap_or_default();
            let hash = format!("{:x}", Md5::digest(paths_str.as_bytes()));
            *last_files_hash = hash.clone();
            return ClipboardContent::Files(files, hash);
        }
    }

    // 2) Check text
    if let Ok(mut cb) = arboard::Clipboard::new() {
        if let Ok(text) = cb.get_text() {
            if !text.is_empty() {
                let hash = format!("{:x}", Md5::digest(text.as_bytes()));

                // On non-Windows, hash-based change detection
                #[cfg(not(target_os = "windows"))]
                if hash == *last_text_hash {
                    drop(cb);
                    return ClipboardContent::Unchanged;
                }

                *last_text_hash = hash.clone();
                return ClipboardContent::Text(text, hash);
            }
        }
        drop(cb);
    }

    // 3) Check image
    if let Ok(mut cb) = arboard::Clipboard::new() {
        if let Ok(img) = cb.get_image() {
            let hash = format!("{:x}", Md5::digest(&img.bytes));

            #[cfg(not(target_os = "windows"))]
            if hash == *last_image_hash {
                return ClipboardContent::Unchanged;
            }

            *last_image_hash = hash.clone();
            return ClipboardContent::Image{width: img.width, height: img.height, bytes: img.bytes.to_vec(), md5: hash};
        }
    }

    ClipboardContent::Unchanged
}