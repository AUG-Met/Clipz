use std::path::PathBuf;
use std::process::Command;

/// Errors that can occur during QuickLook preview.
#[derive(Debug)]
pub enum QuickLookError {
    NotFound,
    PreviewError(String),
}

/// Search for QuickLook.exe in the standard installation paths.
fn find_quicklook() -> Option<PathBuf> {
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

/// Launch QuickLook.exe to preview the given file path.
/// Returns `Ok(())` on success, or an appropriate `QuickLookError`.
pub fn preview_file(path: &str) -> Result<(), QuickLookError> {
    let ql_path = find_quicklook().ok_or(QuickLookError::NotFound)?;

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