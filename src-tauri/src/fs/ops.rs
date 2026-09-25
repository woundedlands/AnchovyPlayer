//! File operations behind the context menu: rename, delete to the recycle bin, copy / move.
//! Which files and where is decided in TypeScript; these only carry it out safely.

use std::path::{Path, PathBuf};

/// Characters Windows forbids in a file name; `/` covers the other platforms.
const FORBIDDEN_NAME_CHARS: &[char] = &['/', '\\', ':', '*', '?', '"', '<', '>', '|'];

/// Renames within the same folder. Refuses to replace another file: `std::fs::rename` would
/// silently overwrite it on Windows.
pub fn rename(path: &Path, new_name: &str) -> Result<PathBuf, String> {
    let new_name = new_name.trim();
    if new_name.is_empty() || new_name == "." || new_name == ".." || new_name.contains(FORBIDDEN_NAME_CHARS) {
        return Err(format!("\"{new_name}\" is not a valid name"));
    }
    let parent = path.parent().ok_or_else(|| format!("Cannot rename {}", path.display()))?;
    let target = parent.join(new_name);
    // A case-only rename ("kick.wav" -> "Kick.wav") finds itself on a case-insensitive disk.
    if target.exists() && !same_file(path, &target) {
        return Err(format!("{new_name} already exists"));
    }
    std::fs::rename(path, &target).map_err(|e| format!("Cannot rename {}: {e}", path.display()))?;

    Ok(target)
}

pub fn move_to_trash(paths: &[PathBuf]) -> Result<(), String> {
    trash::delete_all(paths).map_err(|e| format!("Cannot move to the recycle bin: {e}"))
}

/// Copies or moves each source into `dest_dir`. A name already taken there gets a " (2)" suffix,
/// as Explorer does. Moving a file into the folder it is already in does nothing. Returns the new paths.
pub fn transfer(sources: &[PathBuf], dest_dir: &Path, remove_source: bool) -> Result<Vec<PathBuf>, String> {
    if !dest_dir.is_dir() {
        return Err(format!("{} is not a folder", dest_dir.display()));
    }
    let mut created = Vec::new();
    for source in sources {
        let name = source
            .file_name()
            .ok_or_else(|| format!("Cannot copy {}", source.display()))?;
        if remove_source && source.parent() == Some(dest_dir) {
            continue;
        }
        if dest_dir.starts_with(source) {
            return Err(format!("Cannot put {} inside itself", source.display()));
        }
        let target = free_name(dest_dir, Path::new(name));
        if remove_source {
            move_path(source, &target)?;
        } else {
            copy_path(source, &target)?;
        }
        created.push(target);
    }

    Ok(created)
}

fn move_path(source: &Path, target: &Path) -> Result<(), String> {
    if std::fs::rename(source, target).is_ok() {
        return Ok(());
    }
    // rename cannot cross drives; fall back to copy + delete.
    copy_path(source, target)?;
    let removed = if source.is_dir() { std::fs::remove_dir_all(source) } else { std::fs::remove_file(source) };
    removed.map_err(|e| format!("Copied, but cannot remove {}: {e}", source.display()))
}

fn copy_path(source: &Path, target: &Path) -> Result<(), String> {
    if source.is_dir() {
        std::fs::create_dir(target).map_err(|e| format!("Cannot create {}: {e}", target.display()))?;
        let entries = std::fs::read_dir(source).map_err(|e| format!("Cannot read {}: {e}", source.display()))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("Cannot read {}: {e}", source.display()))?;
            copy_path(&entry.path(), &target.join(entry.file_name()))?;
        }
        return Ok(());
    }
    std::fs::copy(source, target)
        .map(|_| ())
        .map_err(|e| format!("Cannot copy {}: {e}", source.display()))
}

/// `dir/name`, or `dir/stem (2).ext`, `(3)`... - the first one that does not exist yet.
fn free_name(dir: &Path, name: &Path) -> PathBuf {
    let candidate = dir.join(name);
    if !candidate.exists() {
        return candidate;
    }
    let stem = name.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let extension = name.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    (2..)
        .map(|n| dir.join(format!("{stem} ({n}){extension}")))
        .find(|path| !path.exists())
        .expect("an unbounded counter finds a free name")
}

fn same_file(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("anchovy-ops-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn copy_into_same_folder_gets_numbered_name() {
        let dir = scratch("copy");
        let file = dir.join("kick.wav");
        std::fs::write(&file, b"x").unwrap();
        let created = transfer(&[file.clone()], &dir, false).unwrap();
        assert_eq!(created, vec![dir.join("kick (2).wav")]);
        let created = transfer(&[file], &dir, false).unwrap();
        assert_eq!(created, vec![dir.join("kick (3).wav")]);
    }

    #[test]
    fn rename_refuses_to_overwrite() {
        let dir = scratch("rename");
        std::fs::write(dir.join("a.wav"), b"a").unwrap();
        std::fs::write(dir.join("b.wav"), b"b").unwrap();
        assert!(rename(&dir.join("a.wav"), "b.wav").is_err());
        assert!(rename(&dir.join("a.wav"), "A.wav").is_ok());
        assert!(rename(&dir.join("b.wav"), "bad:name.wav").is_err());
    }

    #[test]
    fn move_into_own_folder_is_a_no_op() {
        let dir = scratch("move");
        let file = dir.join("snare.wav");
        std::fs::write(&file, b"x").unwrap();
        assert!(transfer(&[file.clone()], &dir, true).unwrap().is_empty());
        assert!(file.exists());
    }
}
