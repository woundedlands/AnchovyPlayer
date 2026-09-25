//! Audio engine primitives. Which file plays next, repeat and shuffle are decided in TypeScript;
//! this module only makes a given file sound immediately and reports what the device is doing.

mod cache;
mod decode;
mod output;

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

/// Files up to this length are decoded whole and cached; longer ones stream from disk.
const CLIP_MAX_SECONDS: f64 = 60.0;
const CLIP_CACHE_BYTES: usize = 768 * 1024 * 1024;
const WAVEFORM_CACHE_BYTES: usize = 64 * 1024 * 1024;
const STREAM_BUFFER_SECONDS: usize = 2;
const STREAM_REFILL_WAIT: Duration = Duration::from_millis(5);
const PREFETCH_WORKERS: usize = 2;
const WAVEFORM_BINS: usize = 2048;

#[derive(Serialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackStatus {
    pub state: &'static str,
    pub voice_id: u64,
    pub position: f64,
    pub duration: f64,
    pub ended_voice_id: u64,
}

#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct TrackInfo {
    pub voice_id: u64,
    pub duration: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Waveform {
    pub channels: usize,
    pub duration: f64,
    /// Per channel, `bins` pairs of (min, max), channel after channel.
    pub peaks: Vec<f32>,
    pub bins: usize,
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
}

#[derive(Clone)]
pub struct Engine(Arc<Inner>);

impl Engine {
    pub fn start() -> Result<Self, String> {
        let inner = Arc::new(Inner {
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

        Ok(Self(inner))
    }

    pub fn play(&self, path: &Path) -> Result<TrackInfo, String> {
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
                        let voice = spawn_stream(decoder, voice_id, 0)?;
                        inner.output.send(Command::Play { voice, paused: false });
                        (TrackSource::Stream, duration.unwrap_or(0.0))
                    }
                }
            }
        };
        if let TrackSource::Clip(clip) = &source {
            let voice = Voice::Clip { id: voice_id, clip: clip.clone(), position: 0 };
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
            Some(clip) => {
                let mut reducer = PeakReducer::new();
                reducer.push(&clip.samples);
                reducer.finish(clip.source_channels, clip.frames() as f64 / rate as f64)
            }
            None => {
                // Source rate, no resampling: the shape is all that matters and this is much faster.
                let mut decoder = TrackDecoder::open(path, None)?;
                let mut reducer = PeakReducer::new();
                let mut chunk = Vec::new();
                while decoder.next_chunk(&mut chunk) {
                    reducer.push(&chunk);
                    chunk.clear();
                }
                let duration = reducer.frames as f64 / decoder.output_rate().max(1) as f64;
                reducer.finish(decoder.source_channels(), duration)
            }
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

/// Min/max peaks for a stream of unknown length. Blocks start one frame long; whenever there are
/// twice as many as needed, neighbours are merged and the block length doubles. A 40 ms click keeps
/// per-sample detail, an hour-long mix stays at a few thousand blocks.
struct PeakReducer {
    blocks: Vec<[f32; 4]>,
    block_frames: usize,
    current: [f32; 4],
    in_block: usize,
    frames: u64,
}

impl PeakReducer {
    fn new() -> Self {
        Self { blocks: Vec::new(), block_frames: 1, current: EMPTY_PEAK, in_block: 0, frames: 0 }
    }

    fn push(&mut self, interleaved: &[f32]) {
        for frame in interleaved.chunks_exact(CHANNELS) {
            let peak = &mut self.current;
            peak[0] = peak[0].min(frame[0]);
            peak[1] = peak[1].max(frame[0]);
            peak[2] = peak[2].min(frame[1]);
            peak[3] = peak[3].max(frame[1]);
            self.in_block += 1;
            if self.in_block == self.block_frames {
                self.blocks.push(self.current);
                self.current = EMPTY_PEAK;
                self.in_block = 0;
                if self.blocks.len() == WAVEFORM_BINS * 2 {
                    self.halve();
                }
            }
        }
        self.frames += (interleaved.len() / CHANNELS) as u64;
    }

    fn halve(&mut self) {
        let merged: Vec<[f32; 4]> = self.blocks.chunks(2).map(|pair| merge_peaks(pair)).collect();
        self.blocks = merged;
        self.block_frames *= 2;
    }

    fn finish(mut self, source_channels: usize, duration: f64) -> Waveform {
        if self.in_block > 0 {
            self.blocks.push(self.current);
        }
        let channels = source_channels.clamp(1, CHANNELS);
        let bins = WAVEFORM_BINS.min(self.blocks.len()).max(1);
        let mut peaks = vec![0.0; channels * bins * 2];
        for bin in 0..bins {
            let from = bin * self.blocks.len() / bins;
            let to = ((bin + 1) * self.blocks.len() / bins).max(from + 1).min(self.blocks.len());
            let mut merged = merge_peaks(&self.blocks[from.min(to)..to]);
            if merged[0] > merged[1] {
                merged = [0.0; 4];
            }
            for channel in 0..channels {
                let at = (channel * bins + bin) * 2;
                peaks[at] = merged[channel * 2];
                peaks[at + 1] = merged[channel * 2 + 1];
            }
        }

        Waveform { channels, duration, peaks, bins }
    }
}

const EMPTY_PEAK: [f32; 4] = [f32::MAX, f32::MIN, f32::MAX, f32::MIN];

fn merge_peaks(blocks: &[[f32; 4]]) -> [f32; 4] {
    blocks.iter().fold(EMPTY_PEAK, |merged, block| {
        [merged[0].min(block[0]), merged[1].max(block[1]), merged[2].min(block[2]), merged[3].max(block[3])]
    })
}
