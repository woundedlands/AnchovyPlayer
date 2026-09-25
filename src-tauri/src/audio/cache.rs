use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// Identity of a file's content as far as the cache is concerned. A re-exported file changes
/// its modification time or size, so a stale entry is never served even if a watcher event is missed.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct FileStamp {
    modified: Option<SystemTime>,
    len: u64,
}

impl FileStamp {
    pub fn of(path: &Path) -> Result<Self, String> {
        let meta = std::fs::metadata(path).map_err(|e| format!("Cannot read {}: {e}", path.display()))?;

        Ok(Self { modified: meta.modified().ok(), len: meta.len() })
    }
}

struct Entry<V> {
    stamp: FileStamp,
    rate: u32,
    value: V,
    bytes: usize,
    last_used: u64,
}

/// LRU cache keyed by path, valid only for the same file stamp and output sample rate.
pub struct StampedCache<V: Clone> {
    entries: HashMap<PathBuf, Entry<V>>,
    budget_bytes: usize,
    used_bytes: usize,
    tick: u64,
}

impl<V: Clone> StampedCache<V> {
    pub fn new(budget_bytes: usize) -> Self {
        Self { entries: HashMap::new(), budget_bytes, used_bytes: 0, tick: 0 }
    }

    pub fn get(&mut self, path: &Path, stamp: FileStamp, rate: u32) -> Option<V> {
        self.tick += 1;
        let tick = self.tick;
        let entry = self.entries.get_mut(path)?;
        if entry.stamp != stamp || entry.rate != rate {
            self.remove(path);
            return None;
        }
        entry.last_used = tick;

        Some(entry.value.clone())
    }

    pub fn insert(&mut self, path: PathBuf, stamp: FileStamp, rate: u32, value: V, bytes: usize) {
        if bytes > self.budget_bytes {
            return;
        }
        self.remove(&path);
        while self.used_bytes + bytes > self.budget_bytes {
            let oldest = self
                .entries
                .iter()
                .min_by_key(|(_, entry)| entry.last_used)
                .map(|(path, _)| path.clone());
            match oldest {
                Some(oldest) => self.remove(&oldest),
                None => break,
            }
        }
        self.tick += 1;
        self.used_bytes += bytes;
        self.entries.insert(path, Entry { stamp, rate, value, bytes, last_used: self.tick });
    }

    pub fn remove(&mut self, path: &Path) {
        if let Some(entry) = self.entries.remove(path) {
            self.used_bytes -= entry.bytes;
        }
    }

    pub fn contains_fresh(&self, path: &Path, stamp: FileStamp, rate: u32) -> bool {
        self.entries
            .get(path)
            .is_some_and(|entry| entry.stamp == stamp && entry.rate == rate)
    }
}
