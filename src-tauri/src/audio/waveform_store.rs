//! Waveforms of long files kept on disk, so an hour-long mix is analysed once, not on every play.
//!
//! Keyed by the file's content, not its path: a renamed or moved file still hits, a re-exported one
//! misses. Eviction is LRU by file modification time - every hit touches the file - with an age
//! limit and a size cap, applied once per app start in the background.

use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use super::waveform::Waveform;

/// Bump when the file layout or the peak computation changes; old files then simply age out.
const FORMAT_VERSION: u32 = 1;
const MAGIC: &[u8; 4] = b"AWF1";
const EXTENSION: &str = "awf";
/// Not used for this long: gone.
const MAX_AGE: Duration = Duration::from_secs(30 * 24 * 60 * 60);
/// Above this the least recently used go first. At ~32 KB per waveform that is thousands of tracks.
const MAX_BYTES: u64 = 256 * 1024 * 1024;
/// Content samples for the fingerprint: spread over the whole file, cheap even for 100 MB.
const FINGERPRINT_SAMPLES: u64 = 16;
const FINGERPRINT_SAMPLE_BYTES: usize = 16 * 1024;

pub struct WaveformStore {
    dir: PathBuf,
}

impl WaveformStore {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    pub fn load(&self, key: &str) -> Option<Waveform> {
        let path = self.entry_path(key);
        let bytes = fs::read(&path).ok()?;
        let waveform = decode(&bytes)?;
        // Touching marks it as recently used for the LRU cleanup; failing to is harmless.
        if let Ok(file) = File::options().write(true).open(&path) {
            let _ = file.set_modified(SystemTime::now());
        }

        Some(waveform)
    }

    /// Best effort: a waveform that cannot be written is recomputed next time.
    pub fn save(&self, key: &str, waveform: &Waveform) {
        if fs::create_dir_all(&self.dir).is_err() {
            return;
        }
        let path = self.entry_path(key);
        let temporary = path.with_extension("tmp");
        if fs::write(&temporary, encode(waveform)).is_ok() {
            let _ = fs::rename(&temporary, &path);
        }
    }

    /// Drops entries unused for `MAX_AGE`, then the least recently used until under `MAX_BYTES`.
    pub fn prune(&self) {
        let Ok(entries) = fs::read_dir(&self.dir) else {
            return;
        };
        let now = SystemTime::now();
        let mut kept: Vec<(SystemTime, u64, PathBuf)> = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(meta) = entry.metadata() else {
                continue;
            };
            let used = meta.modified().unwrap_or(now);
            let stale = now.duration_since(used).is_ok_and(|age| age > MAX_AGE);
            let ours = path.extension().is_some_and(|e| e == EXTENSION);
            // Leftover temporaries from an interrupted save go too.
            if stale || !ours {
                let _ = fs::remove_file(&path);
            } else {
                kept.push((used, meta.len(), path));
            }
        }
        let mut total: u64 = kept.iter().map(|(_, size, _)| size).sum();
        kept.sort_by_key(|(used, _, _)| *used);
        for (_, size, path) in kept {
            if total <= MAX_BYTES {
                break;
            }
            if fs::remove_file(&path).is_ok() {
                total -= size;
            }
        }
    }

    fn entry_path(&self, key: &str) -> PathBuf {
        self.dir.join(format!("{key}.{EXTENSION}"))
    }
}

/// Content fingerprint: size plus evenly spread samples, hashed with FNV-1a (stable across Rust
/// versions, unlike `DefaultHasher`). Reads ~256 KB whatever the file size.
pub fn fingerprint(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|e| format!("Cannot open {}: {e}", path.display()))?;
    let size = file.metadata().map_err(|e| format!("Cannot read {}: {e}", path.display()))?.len();
    let mut hash = Fnv1a::new();
    hash.write(&size.to_le_bytes());
    let mut buffer = vec![0u8; FINGERPRINT_SAMPLE_BYTES];
    for index in 0..FINGERPRINT_SAMPLES {
        let offset = size.saturating_sub(FINGERPRINT_SAMPLE_BYTES as u64) * index / (FINGERPRINT_SAMPLES - 1);
        file.seek(SeekFrom::Start(offset)).map_err(|e| format!("Cannot read {}: {e}", path.display()))?;
        let read = file.read(&mut buffer).map_err(|e| format!("Cannot read {}: {e}", path.display()))?;
        hash.write(&buffer[..read]);
    }

    Ok(format!("v{FORMAT_VERSION}-{size:x}-{:016x}", hash.finish()))
}

struct Fnv1a(u64);

impl Fnv1a {
    fn new() -> Self {
        Self(0xcbf2_9ce4_8422_2325)
    }

    fn write(&mut self, bytes: &[u8]) {
        for byte in bytes {
            self.0 ^= u64::from(*byte);
            self.0 = self.0.wrapping_mul(0x0000_0100_0000_01b3);
        }
    }

    fn finish(&self) -> u64 {
        self.0
    }
}

// Layout: magic, version u32, channels u32, bins u32, duration f64, then peaks as f32, little endian.
fn encode(waveform: &Waveform) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(24 + waveform.peaks.len() * 4);
    bytes.extend_from_slice(MAGIC);
    bytes.extend_from_slice(&FORMAT_VERSION.to_le_bytes());
    bytes.extend_from_slice(&(waveform.channels as u32).to_le_bytes());
    bytes.extend_from_slice(&(waveform.bins as u32).to_le_bytes());
    bytes.extend_from_slice(&waveform.duration.to_le_bytes());
    for peak in &waveform.peaks {
        bytes.extend_from_slice(&peak.to_le_bytes());
    }

    bytes
}

/// None for anything malformed or from another version: it is then recomputed and overwritten.
fn decode(bytes: &[u8]) -> Option<Waveform> {
    if bytes.len() < 24 || &bytes[..4] != MAGIC {
        return None;
    }
    let u32_at = |at: usize| u32::from_le_bytes(bytes[at..at + 4].try_into().expect("4 bytes"));
    if u32_at(4) != FORMAT_VERSION {
        return None;
    }
    let channels = u32_at(8) as usize;
    let bins = u32_at(12) as usize;
    let duration = f64::from_le_bytes(bytes[16..24].try_into().expect("8 bytes"));
    let peak_count = channels * bins * 2;
    if bytes.len() != 24 + peak_count * 4 {
        return None;
    }
    let peaks = bytes[24..]
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes(chunk.try_into().expect("4 bytes")))
        .collect();

    Some(Waveform { channels, duration, peaks, bins })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_and_rejects_garbage() {
        let waveform = Waveform { channels: 2, duration: 12.5, peaks: vec![-0.5, 0.5, -0.25, 0.75], bins: 1 };
        let decoded = decode(&encode(&waveform)).unwrap();
        assert_eq!(decoded.peaks, waveform.peaks);
        assert_eq!(decoded.duration, 12.5);
        assert!(decode(b"not a waveform file at all").is_none());
        let mut truncated = encode(&waveform);
        truncated.pop();
        assert!(decode(&truncated).is_none());
    }

    #[test]
    fn prune_removes_stale_and_foreign_files() {
        let dir = std::env::temp_dir().join(format!("anchovy-store-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let store = WaveformStore::new(dir.clone());
        let waveform = Waveform { channels: 1, duration: 1.0, peaks: vec![0.0, 1.0], bins: 1 };
        store.save("fresh", &waveform);
        store.save("old", &waveform);
        fs::write(dir.join("leftover.tmp"), b"x").unwrap();
        let old = File::options().write(true).open(dir.join("old.awf")).unwrap();
        old.set_modified(SystemTime::now() - MAX_AGE - Duration::from_secs(60)).unwrap();
        drop(old);
        store.prune();
        assert!(store.load("fresh").is_some());
        assert!(store.load("old").is_none());
        assert!(!dir.join("leftover.tmp").exists());
    }
}
