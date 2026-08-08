use std::sync::{Arc, Mutex};

use md5::{Digest, Md5};
use rusqlite::Connection;
use tauri::{AppHandle, State, Window};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::GlobalShortcutExt;

use crate::db;
use crate::models::{FavoriteEntry, HistoryItem, Settings};
use crate::quicklook;
use crate::ThemeSetting;
use crate::CurrentShortcut;

/// Append a line to a debug log file under the temp dir, so `open_folder`
/// diagnostics are visible even though a release build has no console.
fn debug_log(line: &str) {
    if let Some(path) = std::env::temp_dir()
        .join("clipz-debug.log")
        .to_str()
        .map(String::from)
    {
        let _ = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .and_then(|mut f| {
                use std::io::Write;
                writeln!(f, "{}", line)
            });
    }
}

// ---------------------------------------------------------------------------
// History commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_history(
    db: State<'_, Arc<Mutex<Connection>>>,
    search_query: Option<String>,
) -> Result<Vec<HistoryItem>, String> {
    println!("[clipz] get_history called, search_query: {:?}", search_query);
    let conn = db.lock().map_err(|e| e.to_string())?;
    let result = db::get_history(&conn, search_query.as_deref()).map_err(|e| e.to_string());
    if let Ok(ref items) = result {
        println!("[clipz] get_history returning {} items", items.len());
    }
    result
}

#[tauri::command]
pub fn get_item(
    db: State<'_, Arc<Mutex<Connection>>>,
    id: i64,
) -> Result<Option<HistoryItem>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    db::get_item(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_item(
    db: State<'_, Arc<Mutex<Connection>>>,
    id: i64,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    db::delete_item(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_history(
    db: State<'_, Arc<Mutex<Connection>>>,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    db::clear_history(&conn).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Settings commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_settings(
    db: State<'_, Arc<Mutex<Connection>>>,
) -> Result<Settings, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    Ok(Settings {
        language: db::get_setting(&conn, "language", "zh"),
        theme: db::get_setting(&conn, "theme", "system"),
        hotkey_modifier: db::get_setting(&conn, "hotkey_modifier", "ctrl"),
        hotkey_key: db::get_setting(&conn, "hotkey_key", "F1"),
        click_mode: db::get_setting(&conn, "click_mode", "1")
            .parse()
            .unwrap_or(1),
        autostart: db::get_setting(&conn, "autostart", "false") == "true",
        quicklook: db::get_setting(&conn, "quicklook", "false") == "true",
        quicklook_path: {
            let p = db::get_setting(&conn, "quicklook_path", "");
            if p.is_empty() { None } else { Some(p) }
        },
        auto_collapse: db::get_setting(&conn, "auto_collapse", "true") == "true",
    })
}

#[tauri::command]
pub fn save_settings(
    db: State<'_, Arc<Mutex<Connection>>>,
    app: AppHandle,
    settings: Settings,
    current_shortcut: State<'_, CurrentShortcut>,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    db::set_setting(&conn, "language", &settings.language).map_err(|e| e.to_string())?;
    db::set_setting(&conn, "theme", &settings.theme).map_err(|e| e.to_string())?;
    db::set_setting(&conn, "hotkey_modifier", &settings.hotkey_modifier)
        .map_err(|e| e.to_string())?;
    db::set_setting(&conn, "hotkey_key", &settings.hotkey_key).map_err(|e| e.to_string())?;
    db::set_setting(&conn, "click_mode", &settings.click_mode.to_string())
        .map_err(|e| e.to_string())?;
    db::set_setting(&conn, "autostart", &settings.autostart.to_string())
        .map_err(|e| e.to_string())?;
    db::set_setting(&conn, "quicklook", &settings.quicklook.to_string())
        .map_err(|e| e.to_string())?;
    db::set_setting(
        &conn,
        "quicklook_path",
        settings.quicklook_path.as_deref().unwrap_or(""),
    )
    .map_err(|e| e.to_string())?;
    db::set_setting(&conn, "auto_collapse", &settings.auto_collapse.to_string())
        .map_err(|e| e.to_string())?;
    drop(conn);

    // Re-register the global hotkey with the new modifier/key.
    let new_shortcut = crate::build_shortcut_str(&settings.hotkey_modifier, &settings.hotkey_key);
    let mut old = current_shortcut.0.lock().map_err(|e| e.to_string())?;
    if *old != new_shortcut {
        let _ = app.global_shortcut().unregister(old.as_str());
        app.global_shortcut().on_shortcut(new_shortcut.as_str(), |app_handle, _, event| {
            if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                crate::toggle_main_window(app_handle);
            }
        }).map_err(|e| e.to_string())?;
        *old = new_shortcut;
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Window control commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn hide_window(window: Window) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn show_window(window: Window) -> Result<(), String> {
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Copy command
// ---------------------------------------------------------------------------

/// Copy text to the system clipboard via the app, marking its hash as
/// "suppressed" so the monitor does not create a duplicate history entry.
#[tauri::command]
pub fn copy_text(
    suppressed_hash: State<'_, Arc<Mutex<Option<String>>>>,
    window: Window,
    text: String,
) -> Result<(), String> {
    let hash = format!("{:x}", Md5::digest(text.as_bytes()));
    *suppressed_hash.lock().map_err(|e| e.to_string())? = Some(hash);

    let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    cb.set_text(text).map_err(|e| e.to_string())?;

    window.set_focus().map_err(|e| e.to_string())
}

/// Copy a list of file paths to the system clipboard (CF_HDROP), marking its
/// hash as "suppressed" so the monitor does not create a duplicate entry.
#[tauri::command]
pub fn copy_files(
    suppressed_hash: State<'_, Arc<Mutex<Option<String>>>>,
    window: Window,
    paths: Vec<String>,
) -> Result<(), String> {
    let paths_json = serde_json::to_string(&paths).map_err(|e| e.to_string())?;
    let hash = format!("{:x}", Md5::digest(paths_json.as_bytes()));
    *suppressed_hash.lock().map_err(|e| e.to_string())? = Some(hash);

    #[cfg(target_os = "windows")]
    {
        use clipboard_win::raw;
        raw::open().map_err(|e| e.to_string())?;
        let set_result = (|| {
            raw::empty().map_err(|e| e.to_string())?;
            raw::set_file_list(&paths).map_err(|e| e.to_string())?;
            Ok::<(), String>(())
        })();
        let _ = raw::close();
        set_result?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
        cb.set_text(paths.join("\n")).map_err(|e| e.to_string())?;
    }

    window.set_focus().map_err(|e| e.to_string())
}

/// Copy a list of file paths to the system clipboard WITHOUT suppressing the
/// monitor, so the clipboard monitor detects the change and creates a new
/// history entry. Used when "copy as new" is requested from the UI.
#[tauri::command]
pub fn copy_file_as_new(
    window: Window,
    paths: Vec<String>,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use clipboard_win::raw;
        raw::open().map_err(|e| e.to_string())?;
        let set_result = (|| {
            raw::empty().map_err(|e| e.to_string())?;
            raw::set_file_list(&paths).map_err(|e| e.to_string())?;
            Ok::<(), String>(())
        })();
        let _ = raw::close();
        set_result?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
        cb.set_text(paths.join("\n")).map_err(|e| e.to_string())?;
    }

    window.set_focus().map_err(|e| e.to_string())
}

/// Copy an image file to the system clipboard, marking its hash as
/// "suppressed" so the monitor does not create a duplicate entry.
#[tauri::command]
pub fn copy_image(
    suppressed_hash: State<'_, Arc<Mutex<Option<String>>>>,
    window: Window,
    path: String,
) -> Result<(), String> {
    let img = image::open(&path).map_err(|e| e.to_string())?;
    let rgba = img.to_rgba8();
    let (width, height) = rgba.dimensions();
    let bytes = rgba.into_raw();

    let hash = format!("{:x}", Md5::digest(&bytes));
    *suppressed_hash.lock().map_err(|e| e.to_string())? = Some(hash);

    let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    let img_data = arboard::ImageData {
        width: width as usize,
        height: height as usize,
        bytes: bytes.into(),
    };
    cb.set_image(img_data).map_err(|e| e.to_string())?;

    window.set_focus().map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Theme command
// ---------------------------------------------------------------------------

/// Apply the theme to the Windows title bar (dark/light).
#[tauri::command]
pub fn set_theme(
    window: tauri::WebviewWindow,
    theme: String,
    theme_setting: State<'_, ThemeSetting>,
) -> Result<(), String> {
    *theme_setting.0.lock().map_err(|e| e.to_string())? = theme.clone();
    crate::set_dark_title_bar(&window, theme == "dark");
    Ok(())
}

// ---------------------------------------------------------------------------
// Autostart command
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    if enabled {
        app.autolaunch().enable().map_err(|e| e.to_string())
    } else {
        app.autolaunch().disable().map_err(|e| e.to_string())
    }
}

// ---------------------------------------------------------------------------
// System theme command
// ---------------------------------------------------------------------------

/// Detect the Windows system theme (light/dark) by reading the registry.
#[cfg(target_os = "windows")]
pub fn read_system_theme() -> String {
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::System::Registry::*;
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;

    const KEY_PATH: &[u16] = &[
        'S' as u16, 'o' as u16, 'f' as u16, 't' as u16, 'w' as u16, 'a' as u16, 'r' as u16, 'e' as u16,
        '\\' as u16, 'M' as u16, 'i' as u16, 'c' as u16, 'r' as u16, 'o' as u16, 's' as u16, 'o' as u16,
        'f' as u16, 't' as u16, '\\' as u16, 'W' as u16, 'i' as u16, 'n' as u16, 'd' as u16, 'o' as u16,
        'w' as u16, 's' as u16, '\\' as u16, 'C' as u16, 'u' as u16, 'r' as u16, 'r' as u16, 'e' as u16,
        'n' as u16, 't' as u16, 'V' as u16, 'e' as u16, 'r' as u16, 's' as u16, 'i' as u16, 'o' as u16,
        'n' as u16, '\\' as u16, 'T' as u16, 'h' as u16, 'e' as u16, 'm' as u16, 'e' as u16, 's' as u16,
        '\\' as u16, 'P' as u16, 'e' as u16, 'r' as u16, 's' as u16, 'o' as u16, 'n' as u16, 'a' as u16,
        'l' as u16, 'i' as u16, 'z' as u16, 'e' as u16, 0,
    ];
    const VALUE_NAME: &[u16] = &['A' as u16, 'p' as u16, 'p' as u16, 's' as u16, 'U' as u16, 's' as u16,
        'e' as u16, 'L' as u16, 'i' as u16, 'g' as u16, 'h' as u16, 't' as u16, 'T' as u16, 'h' as u16,
        'e' as u16, 'm' as u16, 'e' as u16, 0];

    unsafe {
        let mut hkey: HKEY = std::ptr::null_mut();
        if RegOpenKeyExW(HKEY_CURRENT_USER, KEY_PATH.as_ptr(), 0, KEY_READ, &mut hkey) == ERROR_SUCCESS {
            let mut value: u32 = 0;
            let mut size: u32 = std::mem::size_of::<u32>() as u32;
            let result = RegQueryValueExW(
                hkey,
                VALUE_NAME.as_ptr(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                &mut value as *mut u32 as *mut u8,
                &mut size,
            );
            RegCloseKey(hkey);
            if result == ERROR_SUCCESS {
                return if value == 0 { "dark".to_string() } else { "light".to_string() };
            }
        }
    }
    "light".to_string()
}

#[cfg(not(target_os = "windows"))]
fn read_system_theme() -> String {
    "light".to_string()
}

#[tauri::command]
pub fn get_system_theme() -> String {
    read_system_theme()
}

// ---------------------------------------------------------------------------
// QuickLook command
// ---------------------------------------------------------------------------

/// Auto-detect the QuickLook executable path, returning the full path or
/// an empty string if not found.
#[tauri::command]
pub fn find_quicklook_path() -> String {
    quicklook::detect_quicklook()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default()
}

/// Launch QuickLook to preview a file. Returns a status string so the
/// frontend can show an appropriate message without throwing an error.
#[tauri::command]
pub fn quicklook_preview(
    db: State<'_, Arc<Mutex<Connection>>>,
    path: String,
) -> Result<String, String> {
    let configured_path = db.lock().ok().and_then(|conn| {
        let p = db::get_setting(&conn, "quicklook_path", "");
        if p.is_empty() { None } else { Some(p) }
    });
    match quicklook::preview_file(&path, configured_path) {
        Ok(()) => Ok("ok".to_string()),
        Err(quicklook::QuickLookError::NotFound) => Ok("not_found".to_string()),
        Err(quicklook::QuickLookError::PreviewError(_)) => Ok("preview_error".to_string()),
    }
}

// ---------------------------------------------------------------------------
// Favorites commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn toggle_favorite(
    db: State<'_, Arc<Mutex<Connection>>>,
    item_id: i64,
    file_path: Option<String>,
) -> Result<bool, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    db::toggle_favorite(&conn, item_id, file_path.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_favorites(db: State<'_, Arc<Mutex<Connection>>>) -> Result<Vec<FavoriteEntry>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let favs = db::get_all_favorites(&conn).map_err(|e| e.to_string())?;
    Ok(favs
        .into_iter()
        .map(|(item_id, file_path)| FavoriteEntry { item_id, file_path })
        .collect())
}

// ---------------------------------------------------------------------------
// File open commands
// ---------------------------------------------------------------------------

/// Open each file path with its default application.
#[tauri::command]
pub fn open_paths(paths: Vec<String>) -> Result<(), String> {
    for p in &paths {
        let mut cmd = std::process::Command::new("cmd");
        cmd.args(["/C", "start", "", p]);
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        cmd.spawn().map_err(|e| format!("打开失败: {}", e))?;
    }
    Ok(())
}

/// Open the folder containing the given file, selecting it in Explorer.
#[tauri::command]
pub fn open_folder(path: String) -> Result<(), String> {
    debug_log(&format!("open_folder called with path: {:?}", path));
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::UI::Shell::ShellExecuteW;

        // Route through ShellExecuteW so the Windows shell performs its own
        // command-line parsing. This correctly handles paths with spaces and
        // non-ASCII characters.
        let params: Vec<u16> = format!("/select,\"{}\"\0", path).encode_utf16().collect();
        let exe: Vec<u16> = "explorer\0".encode_utf16().collect();
        let verb: Vec<u16> = "open\0".encode_utf16().collect();

        let result = unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                verb.as_ptr(),
                exe.as_ptr(),
                params.as_ptr(),
                std::ptr::null_mut(),
                1, // SW_SHOWNORMAL
            )
        } as isize;
        // ShellExecuteW returns a value > 32 on success.
        if result <= 32 {
            debug_log(&format!("open_folder ShellExecuteW failed, code: {}", result));
        } else {
            debug_log("open_folder ShellExecuteW succeeded");
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = path;
    }
    Ok(())
}