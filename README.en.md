# Clipboard Manager

[中文版](README.md)

Windows clipboard history manager that lives in the system tray, automatically recording text, files, and images from the clipboard. Rebuilt with Tauri + Rust + React for a lighter, more stable experience.

## Features

- **Auto Recording** — Automatically tracks clipboard content (text / files / images)
- **System Tray** — Runs in the background, **Ctrl+F1** to show/hide
- **Multiple Click Modes** — Single click to copy, double-click to copy, auto-close after copy
- **Search** — Quickly search through history entries
- **Theme Switching** — Light / Dark / Follow system
- **Bilingual** — Chinese / English UI
- **QuickLook Preview** — Select a file and press Space to preview (requires [QuickLook](https://github.com/QL-Win/QuickLook))
- **File Operations** — Right-click menu supports opening files and browsing containing folders
- **Text Editing** — Edit text content directly in the preview panel (not saved to the database)
- **Silent Autostart** — Starts with Windows and minimizes to the system tray

## Usage

1. Run `Clipboard Manager.exe` (from the Start menu after installation)
2. The app automatically minimizes to the system tray
3. Press **Ctrl+F1** to show the main window
4. Click a history item to copy its content (text / file / image)
5. Select a file and press **Space** to preview with QuickLook

### Settings

Click the **⚙ Settings** button at the bottom:

| Setting | Description |
|---------|-------------|
| Language | 中文 / English |
| Theme | Light / Dark / System |
| Global Hotkey | Customize the show/hide hotkey |
| Click Behavior | Single copy / Double copy / Copy & close |
| Silent Autostart | Start automatically with Windows |
| QuickLook Preview | Press Space to preview files |

## Download

Download the latest release from [Releases](https://github.com/AUG-Met/clipboard-manager-tauri/releases).

> Clipboard history is stored at `%APPDATA%\com.clipboardmanager.app\clipboard.db`. Please back up important data before uninstalling.

## Development

- **Frontend**: React + TypeScript + Vite
- **Backend**: Rust + Tauri v2
- **Build Tools**: Node.js 20+, Rust 1.77+, MSVC Build Tools

### Local Development

```bash
# Install frontend dependencies
npm install

# Start development mode (hot reload)
npm run tauri dev

# Build for production
npm run tauri build
```

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite
- **Backend**: Rust, Tauri v2
- **Database**: SQLite (rusqlite)
- **Clipboard**: arboard (text/image), clipboard-win (file CF_HDROP)
- **Keyboard**: rdev (global keyboard listener)
- **Theme**: CSS variables + Windows DwmSetWindowAttribute / SetWindowTheme

## Author

- **AUG-Met** — [GitHub](https://github.com/AUG-Met)