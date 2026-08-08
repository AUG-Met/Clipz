use std::sync::{Arc, Mutex};
use std::fs;

use tauri::{AppHandle, Manager, State, WebviewWindow};
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

mod clipboard;
mod commands;
mod db;
mod models;
mod quicklook;

/// Managed state: the raw theme setting ("light" / "dark" / "system").
/// Updated whenever the user saves settings or the frontend requests a theme
/// change, so that `on_window_event` can re-apply it without a DB read.
pub struct ThemeSetting(pub Arc<Mutex<String>>);

#[cfg(target_os = "windows")]
#[link(name = "uxtheme")]
extern "system" {
    fn SetWindowTheme(hwnd: windows_sys::Win32::Foundation::HWND, pszSubAppName: *const u16, pszSubIdList: *const u16) -> i32;
}

/// Set the Windows title bar to dark or light mode.
#[cfg(target_os = "windows")]
pub(crate) fn set_dark_title_bar(window: &WebviewWindow, dark: bool) {
    use std::ffi::c_void;
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::Graphics::Dwm::DwmSetWindowAttribute;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetAncestor, SetWindowPos, GA_ROOT, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE,
        SWP_NOSIZE, SWP_NOZORDER,
    };

    if let Ok(hwnd) = window.hwnd() {
        // Ensure we target the top-level window, not a child webview handle.
        let parent: HWND = unsafe { GetAncestor(hwnd.0, GA_ROOT) };
        let raw = if parent != std::ptr::null_mut() { parent } else { hwnd.0 };

        let value: i32 = if dark { 1 } else { 0 };
        unsafe {
            // DwmSetWindowAttribute — DWMWA_USE_IMMERSIVE_DARK_MODE (20 & 19)
            DwmSetWindowAttribute(
                raw,
                20,
                &value as *const i32 as *const c_void,
                std::mem::size_of::<i32>() as u32,
            );
            DwmSetWindowAttribute(
                raw,
                19,
                &value as *const i32 as *const c_void,
                std::mem::size_of::<i32>() as u32,
            );
            // SetWindowTheme from uxtheme — more reliable than Dwm alone.
            let theme_name: Vec<u16> = if dark {
                "DarkMode_Explorer\0".encode_utf16().collect()
            } else {
                "LightMode_Explorer\0".encode_utf16().collect()
            };
            SetWindowTheme(raw, theme_name.as_ptr(), std::ptr::null());
        }
        // Force the frame to repaint immediately.
        unsafe {
            SetWindowPos(
                raw,
                std::ptr::null_mut(),
                0,
                0,
                0,
                0,
                SWP_FRAMECHANGED | SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER,
            );
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn set_dark_title_bar(_window: &WebviewWindow, _dark: bool) {}

/// Application entry point from `main.rs`.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--silent"]),
        ))
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // A second instance was launched — show the existing window.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .on_window_event(|window, event| {
            // Closing the window (X button) hides to the system tray instead
            // of terminating the app.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
            // Re-apply the forced theme whenever the window gains focus, so an
            // OS theme change cannot leave the title bar wrong for long.
            if let tauri::WindowEvent::Focused(true) = event {
                if window.label() == "main" {
                    if let Some(state) = window.app_handle().try_state::<ThemeSetting>() {
                        let theme = state.0.lock().unwrap().clone();
                        if let Some(wv) = window.app_handle().get_webview_window("main") {
                            set_dark_title_bar(&wv, theme == "dark");
                        }
                    }
                }
            }
        })
        .setup(|app| {
            // ---- database ----
            let app_data_dir = app.path().app_data_dir()?;
            fs::create_dir_all(&app_data_dir)?;
            let db_path = app_data_dir.join("clipboard.db");
            let conn = db::init_db(&db_path)?;
            let db: Arc<Mutex<rusqlite::Connection>> = Arc::new(Mutex::new(conn));
            app.manage(db.clone());

            // Apply stored theme to the Windows title bar.
            let theme = {
                let conn = db.lock().unwrap();
                db::get_setting(&conn, "theme", "system")
            };
            app.manage(ThemeSetting(Arc::new(Mutex::new(theme.clone()))));
            if let Some(window) = app.get_webview_window("main") {
                let is_dark = if theme == "system" {
                    commands::read_system_theme() == "dark"
                } else {
                    theme == "dark"
                };
                set_dark_title_bar(&window, is_dark);
            }

            // ---- system tray ----
            setup_tray(app)?;

            // Start hidden when launched via autostart ("--silent" arg).
            if std::env::args().any(|a| a == "--silent") {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }

            // ---- global hotkey ----
            register_hotkey(app)?;

            // ---- clipboard monitor ----
            let suppressed_hash: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
            app.manage(suppressed_hash.clone());

            let app_handle = app.handle().clone();
            clipboard::start_clipboard_monitor(db, app_handle, suppressed_hash);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_history,
            commands::get_item,
            commands::delete_item,
            commands::clear_history,
            commands::get_settings,
            commands::save_settings,
            commands::hide_window,
            commands::show_window,
            commands::copy_text,
            commands::copy_files,
            commands::copy_image,
            commands::set_theme,
            commands::set_autostart,
            commands::get_system_theme,
            commands::quicklook_preview,
            commands::open_paths,
            commands::open_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// ---------------------------------------------------------------------------
// System tray
// ---------------------------------------------------------------------------

fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let show_hide = MenuItemBuilder::with_id("show_hide", "显示/隐藏")
        .build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "退出")
        .build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&show_hide)
        .separator()
        .item(&quit)
        .build()?;

    // Load the tray icon from the embedded app icon bytes.
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png"))
        .unwrap_or_else(|_| {
            // If the icon fails to load, fall back to a 1x1 transparent pixel.
            tauri::image::Image::new_owned(vec![0u8, 0, 0, 0], 1, 1)
        });

    TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .tooltip("Clipz")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show_hide" => toggle_main_window(app),
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Global hotkey
// ---------------------------------------------------------------------------

fn register_hotkey(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let shortcut_str = "Ctrl+F1";
    app.global_shortcut().on_shortcut(shortcut_str, |app_handle, _, event| {
        if event.state() == ShortcutState::Pressed {
            toggle_main_window(app_handle);
        }
    })?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Show the window if hidden, hide it if visible.
fn toggle_main_window(handle: &AppHandle) {
    if let Some(window) = handle.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}