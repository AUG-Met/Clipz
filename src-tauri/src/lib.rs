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

/// Managed state: the currently registered global shortcut string.
/// Used by `save_settings` to unregister the old shortcut before registering
/// the new one.
pub struct CurrentShortcut(pub Arc<Mutex<String>>);

/// Managed state: the HWND of the app window that was in the foreground when
/// Clipz was shown (0 if none, e.g. opened from the desktop or when the
/// foreground window is the desktop shell). The auto-paste flow uses this to
/// decide whether there is a valid paste target (non-zero = paste & close).
pub struct PreviousAppWindow(pub Arc<Mutex<isize>>);

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
        .plugin(tauri_plugin_dialog::init())
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
            commands::paste_to_previous_window,
            commands::export_backup,
            commands::import_backup,
            commands::inspect_backup,
            commands::copy_text,
            commands::copy_files,
            commands::copy_file_as_new,
            commands::copy_image,
            commands::set_theme,
            commands::set_autostart,
            commands::get_system_theme,
            commands::quicklook_preview,
            commands::open_paths,
            commands::open_folder,
            commands::find_quicklook_path,
            commands::restart_app,
            commands::toggle_favorite,
            commands::get_favorites,
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
    let db = app.state::<Arc<Mutex<rusqlite::Connection>>>();
    let conn = db.lock().unwrap();
    let modifier = db::get_setting(&conn, "hotkey_modifier", "ctrl");
    let key = db::get_setting(&conn, "hotkey_key", "F1");
    let shortcut_str = build_shortcut_str(&modifier, &key);
    drop(conn);

    app.global_shortcut().on_shortcut(shortcut_str.as_str(), |app_handle, _, event| {
        if event.state() == ShortcutState::Pressed {
            toggle_main_window(app_handle);
        }
    })?;

    app.manage(CurrentShortcut(Arc::new(Mutex::new(shortcut_str))));
            app.manage(PreviousAppWindow(Arc::new(Mutex::new(0))));

    Ok(())
}

/// Map a stored modifier string (e.g. "ctrl", "alt", "win", "ctrl_shift",
/// "ctrl_win") plus a key into a Tauri global-shortcut accelerator.
/// The Windows/Command key is spelled "Super" in the plugin's syntax.
pub fn build_shortcut_str(modifier: &str, key: &str) -> String {
    let mapped: Vec<String> = modifier
        .split('_')
        .map(|m| match m {
            "ctrl" => "Ctrl".to_string(),
            "alt" => "Alt".to_string(),
            "shift" => "Shift".to_string(),
            "win" => "Super".to_string(),
            _ => m.to_string(),
        })
        .collect();
    format!("{}+{}", mapped.join("+"), key)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Show the window if hidden, hide it if visible.
///
/// When showing, we capture the current foreground window (the app the user
/// was in) so the auto-paste flow can paste directly into the right window.
/// The Clipz window is shown always-on-top and then focus is handed back to
/// the original app, so it floats over the user's work without stealing input.
fn toggle_main_window(handle: &AppHandle) {
    if let Some(window) = handle.get_webview_window("main") {
        let minimized = window.is_minimized().unwrap_or(false);
        let visible = window.is_visible().unwrap_or(false);

        // Minimized → restore directly from the taskbar (no tray hop).
        if minimized {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_always_on_top(true);
            let _ = window.set_focus();
            return;
        }
        // Visible but not minimized → hide to tray
        if visible {
            let _ = window.set_always_on_top(false);
            let _ = window.hide();
            return;
        }
        // Hidden → show, capture previous window, float on top
        let prev = {
            #[cfg(target_os = "windows")]
            {
                use windows_sys::Win32::UI::WindowsAndMessaging::{
                    GetForegroundWindow, GetShellWindow,
                };
                let fg = unsafe { GetForegroundWindow() };
                let shell = unsafe { GetShellWindow() };
                // Only treat it as a valid paste target if the foreground
                // window is a real application window, not the desktop.
                if fg != std::ptr::null_mut() && fg != shell { fg as isize } else { 0 }
            }
            #[cfg(not(target_os = "windows"))]
            0
        };
        if let Some(state) = handle.try_state::<PreviousAppWindow>() {
            *state.0.lock().unwrap() = prev;
        }

        let _ = window.show();
        let _ = window.set_always_on_top(true);
        // Hand focus back to the app the user was in, so Clipz floats on
        // top without grabbing keyboard focus. Spawn a short-lived thread
        // so the calling thread is no longer the "foreground thread" when
        // SetForegroundWindow runs, which bypasses the Windows foreground
        // lock.
        #[cfg(target_os = "windows")]
        if prev != 0 {
            let prev_raw = prev; // isize is Send
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(50));
                unsafe {
                    use windows_sys::Win32::UI::WindowsAndMessaging::SetForegroundWindow;
                    SetForegroundWindow(prev_raw as *mut core::ffi::c_void);
                }
            });
        }
    }
}