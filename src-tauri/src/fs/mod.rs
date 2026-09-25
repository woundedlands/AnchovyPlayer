//! Filesystem primitives. Classification by extension, sorting, filtering and matching are TypeScript.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, UNIX_EPOCH};

use notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{DebounceEventResult, Debouncer, new_debouncer};
use serde::Serialize;

const WATCH_DEBOUNCE: Duration = Duration::from_millis(150);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified_ms: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WalkEntry {
    pub path: String,
    /// Path below the walk root, with `/` separators on every platform.
    pub relative: String,
    pub is_dir: bool,
}

pub fn list_dir(path: &Path) -> Result<Vec<DirEntry>, String> {
    let entries = std::fs::read_dir(path).map_err(|e| format!("Cannot open folder {}: {e}", path.display()))?;
    let mut listed = Vec::new();
    for entry in entries.flatten() {
        // Entries that vanish or deny access mid-listing are skipped; the folder itself did open.
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if is_hidden(&entry.path(), &meta) {
            continue;
        }
        let modified_ms = meta
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map_or(0.0, |since| since.as_millis() as f64);
        listed.push(DirEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: entry.path().to_string_lossy().into_owned(),
            is_dir: meta.is_dir(),
            size: meta.len(),
            modified_ms,
        });
    }

    Ok(listed)
}

/// Recursive listing for search. Stops at `limit` entries so a search started at a drive root
/// cannot run away; the TypeScript side says the result is partial when it hits the limit.
pub fn walk(root: &Path, limit: usize) -> Result<Vec<WalkEntry>, String> {
    let mut found = Vec::new();
    let mut pending = vec![root.to_path_buf()];
    std::fs::read_dir(root).map_err(|e| format!("Cannot open folder {}: {e}", root.display()))?;
    while let Some(dir) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(meta) = entry.metadata() else {
                continue;
            };
            let path = entry.path();
            if is_hidden(&path, &meta) {
                continue;
            }
            let relative = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .components()
                .map(|c| c.as_os_str().to_string_lossy())
                .collect::<Vec<_>>()
                .join("/");
            if meta.is_dir() {
                pending.push(path.clone());
            }
            found.push(WalkEntry { path: path.to_string_lossy().into_owned(), relative, is_dir: meta.is_dir() });
            if found.len() >= limit {
                return Ok(found);
            }
        }
    }

    Ok(found)
}

/// Top-level locations for the path bar: drives on Windows, `/` elsewhere.
pub fn list_roots() -> Vec<String> {
    #[cfg(windows)]
    {
        (b'A'..=b'Z')
            .map(|letter| format!("{}:\\", letter as char))
            .filter(|root| Path::new(root).exists())
            .collect()
    }
    #[cfg(not(windows))]
    {
        vec!["/".to_string()]
    }
}

fn is_hidden(path: &Path, meta: &std::fs::Metadata) -> bool {
    let dotted = path
        .file_name()
        .is_some_and(|name| name.to_string_lossy().starts_with('.'));
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
        const FILE_ATTRIBUTE_SYSTEM: u32 = 0x4;
        dotted || meta.file_attributes() & (FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM) != 0
    }
    #[cfg(not(windows))]
    {
        let _ = meta;
        dotted
    }
}

/// Watches one folder (not recursively) at a time; watching another replaces it.
#[derive(Default)]
pub struct FolderWatcher {
    current: Mutex<Option<Debouncer<RecommendedWatcher>>>,
}

impl FolderWatcher {
    pub fn watch(
        &self,
        dir: &Path,
        on_change: impl Fn(Vec<PathBuf>) + Send + 'static,
    ) -> Result<(), String> {
        let mut current = self.current.lock().expect("watcher lock poisoned");
        // Drop the old watcher first so its late events cannot arrive after the new folder's listing.
        *current = None;
        let mut debouncer = new_debouncer(WATCH_DEBOUNCE, move |result: DebounceEventResult| {
            match result {
                Ok(events) => on_change(events.into_iter().map(|event| event.path).collect()),
                Err(error) => eprintln!("fs: watch error: {error}"),
            }
        })
        .map_err(|e| format!("Cannot watch {}: {e}", dir.display()))?;
        debouncer
            .watcher()
            .watch(dir, RecursiveMode::NonRecursive)
            .map_err(|e| format!("Cannot watch {}: {e}", dir.display()))?;
        *current = Some(debouncer);

        Ok(())
    }
}
