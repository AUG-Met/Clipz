use std::path::PathBuf;
use std::process::Command;

/// Errors that can occur during QuickLook preview.
#[derive(Debug)]
pub enum QuickLookError {
    NotFound,
    PreviewError(String),
}

/// Search for QuickLook.exe in the standard installation paths.
pub fn detect_quicklook() -> Option<PathBuf> {
    let candidates = [
        // %LOCALAPPDATA%\Programs\QuickLook\QuickLook.exe
        PathBuf::from(std::env::var_os("LOCALAPPDATA")?).join("Programs").join("QuickLook").join("QuickLook.exe"),
        // %ProgramFiles%\QuickLook\QuickLook.exe
        PathBuf::from(std::env::var_os("ProgramFiles")?).join("QuickLook").join("QuickLook.exe"),
        // %ProgramFiles(x86)%\QuickLook\QuickLook.exe
        PathBuf::from(std::env::var_os("ProgramFiles(x86)")?).join("QuickLook").join("QuickLook.exe"),
    ];

    for path in &candidates {
        if path.is_file() {
            return Some(path.clone());
        }
    }
    None
}

/// Resolve the QuickLook executable: prefer the user-configured path, then
/// fall back to auto-detection in the standard install locations.
fn find_quicklook(configured: Option<String>) -> Option<PathBuf> {
    if let Some(p) = configured {
        let pb = PathBuf::from(p);
        if pb.is_file() {
            return Some(pb);
        }
    }
    detect_quicklook()
}

/// Launch QuickLook.exe to preview the given file path.
/// Returns `Ok(())` on success, or an appropriate `QuickLookError`.
pub fn preview_file(path: &str, configured_path: Option<String>) -> Result<(), QuickLookError> {
    let ql_path = find_quicklook(configured_path).ok_or(QuickLookError::NotFound)?;

    let mut cmd = Command::new(ql_path);
    cmd.arg(path);

    // Use CREATE_NO_WINDOW (0x08000000) to prevent a console window from flashing.
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    match cmd.spawn() {
        Ok(_) => Ok(()),
        Err(e) => Err(QuickLookError::PreviewError(e.to_string())),
    }
}