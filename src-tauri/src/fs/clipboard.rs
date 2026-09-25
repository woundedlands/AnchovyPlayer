//! Files on the system clipboard, interoperable with Explorer: files copied or cut here paste in
//! Explorer and the other way round. Windows only for now; other platforms report it clearly.

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardFiles {
    pub paths: Vec<String>,
    /// Cut rather than copied: pasting moves the files.
    pub cut: bool,
}

#[cfg(windows)]
mod platform {
    use clipboard_win::{Clipboard, raw};

    use super::ClipboardFiles;

    /// Registered clipboard format Explorer uses to tell cut from copy (a DWORD drop effect).
    const DROP_EFFECT_FORMAT: &str = "Preferred DropEffect";
    const DROPEFFECT_COPY: u32 = 1;
    const DROPEFFECT_MOVE: u32 = 2;
    const OPEN_ATTEMPTS: usize = 10;

    pub fn set_files(paths: &[String], cut: bool) -> Result<(), String> {
        let _clipboard = Clipboard::new_attempts(OPEN_ATTEMPTS).map_err(|e| format!("Clipboard is busy: {e}"))?;
        raw::empty().map_err(|e| format!("Cannot clear the clipboard: {e}"))?;
        raw::set_file_list(paths).map_err(|e| format!("Cannot put files on the clipboard: {e}"))?;
        let format = raw::register_format(DROP_EFFECT_FORMAT).ok_or("Cannot register the drop effect format")?;
        let effect = if cut { DROPEFFECT_MOVE } else { DROPEFFECT_COPY };
        raw::set_without_clear(format.get(), &effect.to_le_bytes())
            .map_err(|e| format!("Cannot mark the clipboard as cut: {e}"))
    }

    pub fn get_files() -> Result<ClipboardFiles, String> {
        let _clipboard = Clipboard::new_attempts(OPEN_ATTEMPTS).map_err(|e| format!("Clipboard is busy: {e}"))?;
        let mut paths = Vec::new();
        // No file list on the clipboard is not an error: there is simply nothing to paste.
        if raw::get_file_list(&mut paths).is_err() {
            return Ok(ClipboardFiles { paths: Vec::new(), cut: false });
        }
        let cut = raw::register_format(DROP_EFFECT_FORMAT)
            .filter(|format| raw::is_format_avail(format.get()))
            .and_then(|format| {
                let mut bytes = Vec::new();
                raw::get_vec(format.get(), &mut bytes).ok()?;
                let effect = u32::from_le_bytes(bytes.get(..4)?.try_into().ok()?);
                Some(effect & DROPEFFECT_MOVE != 0)
            })
            .unwrap_or(false);

        Ok(ClipboardFiles { paths, cut })
    }

    /// After a cut is pasted the files are gone from their old place; Explorer clears the clipboard too.
    pub fn clear() -> Result<(), String> {
        let _clipboard = Clipboard::new_attempts(OPEN_ATTEMPTS).map_err(|e| format!("Clipboard is busy: {e}"))?;
        raw::empty().map_err(|e| format!("Cannot clear the clipboard: {e}"))
    }
}

#[cfg(not(windows))]
mod platform {
    use super::ClipboardFiles;

    const UNSUPPORTED: &str = "Copying files to the clipboard is not supported on this platform yet";

    pub fn set_files(_paths: &[String], _cut: bool) -> Result<(), String> {
        Err(UNSUPPORTED.into())
    }

    pub fn get_files() -> Result<ClipboardFiles, String> {
        Err(UNSUPPORTED.into())
    }

    pub fn clear() -> Result<(), String> {
        Err(UNSUPPORTED.into())
    }
}

pub use platform::{clear, get_files, set_files};
