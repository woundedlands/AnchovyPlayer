//! Audio engine primitives. Which file plays next, repeat and shuffle are decided in TypeScript;
//! this module only makes a given file sound immediately and reports what the device is doing.

mod cache;
mod decode;
mod output;
mod waveform;
mod waveform_store;

pub use waveform::Waveform;
pub use waveform_store::fingerprint;

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::Duration;

use serde::Serialize;

use cache::{FileStamp, StampedCache};
use decode::{CHANNELS, TrackDecoder};
use output::{Clip, Command, Output, PlayState, Voice};
use waveform_store::WaveformStore;

/// Files up to this length are decoded whole and cached; longer ones stream from disk.
const CLIP_MAX_SECONDS: f64 = 60.0;
const CLIP_CACHE_BYTES: usize = 768 * 1024 * 1024;
const WAVEFORM_CACHE_BYTES: usize = 64 * 1024 * 1024;
const STREAM_BUFFER_SECONDS: usize = 2;
const STREAM_REFILL_WAIT: Duration = Duration::from_millis(5);
const PREFETCH_WORKERS: usize = 2;

#[derive(Serialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackStatus {
    pub state: &'static str,
    pub voice_id: u64,
    pub position: f64,
    pub duration: f64,
    pub ended_voice_id: u64,
    /// Loudness since the previous status, 0..1 RMS before volume; drives the visualizer.
    pub level: f32,
}

#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct TrackInfo {
    pub voice_id: u64,
    pub duration: f64,
}

enum TrackSource {
    Clip(Arc<Clip>),
    Stream,
}

struct Track {
    path: PathBuf,
    voice_id: u64,
    duration: f64,
    source: TrackSource,
}

struct Inner {
    output: Output,
    clips: Mutex<StampedCache<Arc<Clip>>>,
    waveforms: Mutex<StampedCache<Arc<Waveform>>>,
    track: Mutex<Option<Track>>,
    next_voice_id: AtomicU64,
    looping: AtomicBool,
    prefetch_queue: Mutex<VecDeque<PathBuf>>,
    prefetch_wake: Condvar,
    /// Waveforms of long files on disk; None when the app has no cache folder.
    waveform_store: Option<WaveformStore>,
}

#[derive(Clone)]
pub struct Engine(Arc<Inner>);

impl Engine {
    pub fn start(waveform_dir: Option<PathBuf>) -> Result<Self, String> {
        let waveform_store = waveform_dir.map(WaveformStore::new);
        let inner = Arc::new(Inner {
            waveform_store,
            output: Output::start()?,
            clips: Mutex::new(StampedCache::new(CLIP_CACHE_BYTES)),
            waveforms: Mutex::new(StampedCache::new(WAVEFORM_CACHE_BYTES)),
            track: Mutex::new(None),
            next_voice_id: AtomicU64::new(1),
            looping: AtomicBool::new(false),
            prefetch_queue: Mutex::new(VecDeque::new()),
            prefetch_wake: Condvar::new(),
        });
        for index in 0..PREFETCH_WORKERS {
            let inner = inner.clone();
            thread::Builder::new()
                .name(format!("audio-prefetch-{index}"))
                .spawn(move || run_prefetch_worker(&inner))
                .map_err(|e| format!("Cannot start prefetch thread: {e}"))?;
        }

        if inner.waveform_store.is_some() {
            let pruner = inner.clone();
            thread::Builder::new()
                .name("waveform-prune".into())
                .spawn(move || {
                    if let Some(store) = &pruner.waveform_store {
                        store.prune();
                    }
                })
                .map_err(|e| format!("Cannot start waveform cleanup: {e}"))?;
        }

        Ok(Self(inner))
    }

    /// Starts `path` at `start_seconds` (resuming a long track starts there, not at 0 then jumps).
    pub fn play(&self, path: &Path, start_seconds: f64) -> Result<TrackInfo, String> {
        let inner = &self.0;
        let voice_id = inner.next_voice_id.fetch_add(1, Ordering::Relaxed);
        let rate = inner.output.status.sample_rate();
        let stamp = FileStamp::of(path)?;

        let cached = inner.clips.lock().expect("clip cache poisoned").get(path, stamp, rate);
        let (source, duration) = match cached {
            Some(clip) => {
                let duration = clip.frames() as f64 / rate as f64;
                (TrackSource::Clip(clip), duration)
            }
            None => {
                let decoder = TrackDecoder::open(path, Some(rate))?;
                match decoder.duration_seconds() {
                    Some(seconds) if seconds <= CLIP_MAX_SECONDS => {
                        let clip = inner.decode_clip(path, stamp, decoder);
                        let duration = clip.frames() as f64 / rate as f64;
                        (TrackSource::Clip(clip), duration)
                    }
                    duration => {
                        let mut decoder = decoder;
                        let start_frame = (start_seconds.max(0.0) * rate as f64) as u64;
                        if start_frame > 0 {
                            decoder.seek(start_seconds)?;
                        }
                        let voice = spawn_stream(decoder, voice_id, start_frame)?;
                        inner.output.send(Command::Play { voice, paused: false });
                        (TrackSource::Stream, duration.unwrap_or(0.0))
                    }
                }
            }
        };
        if let TrackSource::Clip(clip) = &source {
            let position = ((start_seconds.max(0.0) * rate as f64) as usize).min(clip.frames());
            let voice = Voice::Clip { id: voice_id, clip: clip.clone(), position };
            inner.output.send(Command::Play { voice, paused: false });
        }
        *inner.track.lock().expect("track lock poisoned") =
            Some(Track { path: path.to_path_buf(), voice_id, duration, source });

        Ok(TrackInfo { voice_id, duration })
    }

    pub fn pause(&self) {
        self.0.output.send(Command::Pause);
    }

    pub fn resume(&self) {
        self.0.output.send(Command::Resume);
    }

    pub fn stop(&self) {
        self.0.output.send(Command::Stop);
        *self.0.track.lock().expect("track lock poisoned") = None;
    }

    pub fn set_looping(&self, looping: bool) {
        self.0.looping.store(looping, Ordering::Relaxed);
        self.0.output.send(Command::SetLooping(looping));
    }

    pub fn set_volume(&self, volume: f32) {
        self.0.output.send(Command::SetVolume(volume));
    }

    /// Jumps within the current track. Replacing the voice crossfades, so seeking never clicks.
    pub fn seek(&self, seconds: f64) -> Result<(), String> {
        let inner = &self.0;
        let track = inner.track.lock().expect("track lock poisoned");
        let Some(track) = track.as_ref() else {
            return Ok(());
        };
        let status = &inner.output.status;
        let paused = status.state() == PlayState::Paused;
        let rate = status.sample_rate();
        let frame = (seconds.max(0.0) * rate as f64) as u64;
        let voice = match &track.source {
            TrackSource::Clip(clip) => {
                let position = (frame as usize).min(clip.frames());
                Voice::Clip { id: track.voice_id, clip: clip.clone(), position }
            }
            TrackSource::Stream => {
                let mut decoder = TrackDecoder::open(&track.path, Some(rate))?;
                decoder.seek(seconds)?;
                spawn_stream(decoder, track.voice_id, frame)?
            }
        };
        inner.output.send(Command::Play { voice, paused });

        Ok(())
    }

    /// Replaces the prefetch queue: the first path is the most wanted.
    pub fn prefetch(&self, paths: Vec<PathBuf>) {
        let mut queue = self.0.prefetch_queue.lock().expect("prefetch queue poisoned");
        queue.clear();
        queue.extend(paths);
        self.0.prefetch_wake.notify_all();
    }

    pub fn invalidate(&self, path: &Path) {
        self.0.clips.lock().expect("clip cache poisoned").remove(path);
        self.0.waveforms.lock().expect("waveform cache poisoned").remove(path);
    }

    /// Sleeps until the player is told to do something or `timeout` passes; true when woken.
    pub fn wait_for_activity(&self, timeout: Duration) -> bool {
        self.0.output.wait_for_activity(timeout)
    }

    /// Takes the level hold (see `Status::take_level`): one reader only, the status emitter.
    pub fn status(&self) -> PlaybackStatus {
        let inner = &self.0;
        let status = &inner.output.status;
        let rate = status.sample_rate().max(1) as f64;
        let track = inner.track.lock().expect("track lock poisoned");
        let duration = track.as_ref().map_or(0.0, |t| t.duration);
        let state = match status.state() {
            PlayState::Idle => "idle",
            PlayState::Playing => "playing",
            PlayState::Paused => "paused",
        };

        PlaybackStatus {
            state,
            voice_id: status.voice_id(),
            position: status.position_frames() as f64 / rate,
            duration,
            ended_voice_id: status.ended_voice_id(),
            level: status.take_level(),
        }
    }

    /// Restarts a looping stream that reached its end; clips loop gaplessly inside the mixer.
    pub fn restart_ended_stream_if_looping(&self) {
        let inner = &self.0;
        if !inner.looping.load(Ordering::Relaxed) {
            return;
        }
        let is_ended_stream = {
            let track = inner.track.lock().expect("track lock poisoned");
            track.as_ref().is_some_and(|t| {
                matches!(t.source, TrackSource::Stream) && inner.output.status.ended_voice_id() == t.voice_id
            })
        };
        if is_ended_stream && inner.output.status.state() == PlayState::Idle {
            if let Err(error) = self.seek(0.0) {
                eprintln!("audio: restarting looped stream failed: {error}");
            }
        }
    }

    pub fn waveform(&self, path: &Path) -> Result<Arc<Waveform>, String> {
        let inner = &self.0;
        let stamp = FileStamp::of(path)?;
        if let Some(waveform) = inner.waveforms.lock().expect("waveform cache poisoned").get(path, stamp, 0) {
            return Ok(waveform);
        }

        let rate = inner.output.status.sample_rate();
        let cached_clip = inner.clips.lock().expect("clip cache poisoned").get(path, stamp, rate);
        let waveform = match cached_clip {
            Some(clip) => waveform::from_samples(&clip.samples, clip.source_channels, clip.frames() as f64 / rate as f64),
            None => inner.waveform_from_file(path)?,
        };
        let waveform = Arc::new(waveform);
        let bytes = waveform.peaks.len() * size_of::<f32>();
        inner
            .waveforms
            .lock()
            .expect("waveform cache poisoned")
            .insert(path.to_path_buf(), stamp, 0, waveform.clone(), bytes);

        Ok(waveform)
    }
}

impl Inner {
    /// Long files are expensive to analyse, so their waveforms go through the disk store.
    /// Short ones are cheap and would only fill it with thousands of tiny entries.
    fn waveform_from_file(&self, path: &Path) -> Result<Waveform, String> {
        let Some(store) = &self.waveform_store else {
            return waveform::from_file(path);
        };
        let key = waveform_store::fingerprint(path)?;
        if let Some(stored) = store.load(&key) {
            return Ok(stored);
        }
        let computed = waveform::from_file(path)?;
        if computed.duration > CLIP_MAX_SECONDS {
            store.save(&key, &computed);
        }

        Ok(computed)
    }

    fn decode_clip(&self, path: &Path, stamp: FileStamp, mut decoder: TrackDecoder) -> Arc<Clip> {
        let rate = decoder.output_rate();
        let mut samples = Vec::new();
        if let Some(seconds) = decoder.duration_seconds() {
            samples.reserve((seconds * rate as f64) as usize * CHANNELS);
        }
        while decoder.next_chunk(&mut samples) {}
        samples.shrink_to_fit();
        let clip = Arc::new(Clip { samples, source_channels: decoder.source_channels() });
        let bytes = clip.samples.len() * size_of::<f32>();
        self.clips
            .lock()
            .expect("clip cache poisoned")
            .insert(path.to_path_buf(), stamp, rate, clip.clone(), bytes);

        clip
    }
}

/// Decodes ahead into a ring buffer on its own thread. The thread ends when the file is done
/// or when the mixer drops the voice (the ring reports itself abandoned).
fn spawn_stream(mut decoder: TrackDecoder, voice_id: u64, start_frame: u64) -> Result<Voice, String> {
    let capacity = decoder.output_rate() as usize * CHANNELS * STREAM_BUFFER_SECONDS;
    let (mut producer, consumer) = rtrb::RingBuffer::new(capacity);
    let producer_done = Arc::new(AtomicBool::new(false));
    let done = producer_done.clone();
    thread::Builder::new()
        .name("audio-stream".into())
        .spawn(move || {
            let mut chunk = Vec::new();
            'decode: while decoder.next_chunk(&mut chunk) {
                let mut offset = 0;
                while offset < chunk.len() {
                    if producer.is_abandoned() {
                        break 'decode;
                    }
                    let free = producer.slots() - producer.slots() % CHANNELS;
                    let count = free.min(chunk.len() - offset);
                    if count == 0 {
                        thread::sleep(STREAM_REFILL_WAIT);
                        continue;
                    }
                    let mut slot = producer.write_chunk(count).expect("count is within free slots");
                    let (first, second) = slot.as_mut_slices();
                    let split = first.len();
                    first.copy_from_slice(&chunk[offset..offset + split]);
                    second.copy_from_slice(&chunk[offset + split..offset + count]);
                    slot.commit_all();
                    offset += count;
                }
                chunk.clear();
            }
            done.store(true, Ordering::Release);
        })
        .map_err(|e| format!("Cannot start stream thread: {e}"))?;

    Ok(Voice::Stream { id: voice_id, samples: consumer, producer_done, start_frame, played: 0 })
}

fn run_prefetch_worker(inner: &Inner) {
    loop {
        let path = {
            let mut queue = inner.prefetch_queue.lock().expect("prefetch queue poisoned");
            loop {
                if let Some(path) = queue.pop_front() {
                    break path;
                }
                queue = inner.prefetch_wake.wait(queue).expect("prefetch queue poisoned");
            }
        };
        // Prefetch failures are expected (unsupported or half-written files); playing reports them.
        let Ok(stamp) = FileStamp::of(&path) else {
            continue;
        };
        let rate = inner.output.status.sample_rate();
        if inner.clips.lock().expect("clip cache poisoned").contains_fresh(&path, stamp, rate) {
            continue;
        }
        let Ok(decoder) = TrackDecoder::open(&path, Some(rate)) else {
            continue;
        };
        if decoder.duration_seconds().is_some_and(|seconds| seconds <= CLIP_MAX_SECONDS) {
            inner.decode_clip(&path, stamp, decoder);
        }
    }
}

