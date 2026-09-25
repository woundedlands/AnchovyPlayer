//! Waveform peaks: min/max per bin per channel, for the player's waveform view.

use std::path::Path;
use std::thread;

use serde::{Deserialize, Serialize};

use super::decode::{CHANNELS, TrackDecoder};

pub const WAVEFORM_BINS: usize = 2048;
/// Shorter files are not worth the extra decoders: one pass is already fast.
const PARALLEL_MIN_SECONDS: f64 = 60.0;
/// Each worker gets at least this much audio, so seeking overhead stays small next to decoding.
const MIN_SEGMENT_SECONDS: f64 = 30.0;
const MAX_WORKERS: usize = 16;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Waveform {
    pub channels: usize,
    pub duration: f64,
    /// Per channel, `bins` pairs of (min, max), channel after channel.
    pub peaks: Vec<f32>,
    pub bins: usize,
}

/// From audio already decoded in memory (interleaved stereo).
pub fn from_samples(samples: &[f32], source_channels: usize, duration: f64) -> Waveform {
    let mut reducer = PeakReducer::new();
    reducer.push(samples);

    reducer.finish(source_channels, duration, WAVEFORM_BINS)
}

/// Decodes the file at its own rate. Long files are split into time segments decoded in parallel,
/// each by its own decoder seeked to the segment start; the segments' bins are concatenated.
pub fn from_file(path: &Path) -> Result<Waveform, String> {
    let decoder = TrackDecoder::open(path, None)?;
    let rate = decoder.output_rate();
    match decoder.duration_seconds() {
        Some(duration) if duration >= PARALLEL_MIN_SECONDS && rate > 0 => {
            let workers = thread::available_parallelism()
                .map_or(1, |n| n.get())
                .min(MAX_WORKERS)
                .min((duration / MIN_SEGMENT_SECONDS) as usize)
                .max(1);
            // Anything a segment cannot do (a format that will not seek) falls back to one pass.
            parallel(path, duration, rate, decoder.source_channels(), workers).or_else(|_| sequential(path))
        }
        _ => sequential(path),
    }
}

fn sequential(path: &Path) -> Result<Waveform, String> {
    let mut decoder = TrackDecoder::open(path, None)?;
    let mut reducer = PeakReducer::new();
    let mut chunk = Vec::new();
    while decoder.next_chunk(&mut chunk) {
        reducer.push(&chunk);
        chunk.clear();
    }
    let duration = reducer.frames as f64 / decoder.output_rate().max(1) as f64;

    Ok(reducer.finish(decoder.source_channels(), duration, WAVEFORM_BINS))
}

fn parallel(path: &Path, duration: f64, rate: u32, source_channels: usize, workers: usize) -> Result<Waveform, String> {
    let total_frames = (duration * rate as f64) as u64;
    let segments: Vec<Result<Waveform, String>> = thread::scope(|scope| {
        let handles: Vec<_> = (0..workers)
            .map(|index| {
                let start_frame = total_frames * index as u64 / workers as u64;
                let end_frame = total_frames * (index as u64 + 1) / workers as u64;
                // Split the bins the same way, so the segments add up to exactly WAVEFORM_BINS.
                let bins = WAVEFORM_BINS * (index + 1) / workers - WAVEFORM_BINS * index / workers;
                scope.spawn(move || segment(path, rate, start_frame, end_frame, bins, source_channels))
            })
            .collect();
        handles
            .into_iter()
            .map(|handle| handle.join().unwrap_or_else(|_| Err("Waveform worker panicked".into())))
            .collect()
    });
    let segments = segments.into_iter().collect::<Result<Vec<_>, _>>()?;

    let channels = source_channels.clamp(1, CHANNELS);
    let mut peaks = Vec::with_capacity(channels * WAVEFORM_BINS * 2);
    for channel in 0..channels {
        for segment in &segments {
            let lane = segment.bins * 2;
            peaks.extend_from_slice(&segment.peaks[channel * lane..(channel + 1) * lane]);
        }
    }
    let bins = segments.iter().map(|s| s.bins).sum();

    Ok(Waveform { channels, duration, peaks, bins })
}

fn segment(
    path: &Path,
    rate: u32,
    start_frame: u64,
    end_frame: u64,
    bins: usize,
    source_channels: usize,
) -> Result<Waveform, String> {
    let mut decoder = TrackDecoder::open(path, None)?;
    if start_frame > 0 {
        decoder.seek(start_frame as f64 / rate as f64)?;
    }
    let mut remaining = (end_frame - start_frame) as usize;
    let mut reducer = PeakReducer::new();
    let mut chunk = Vec::new();
    while remaining > 0 && decoder.next_chunk(&mut chunk) {
        let frames = (chunk.len() / CHANNELS).min(remaining);
        reducer.push(&chunk[..frames * CHANNELS]);
        remaining -= frames;
        chunk.clear();
    }
    let duration = (end_frame - start_frame) as f64 / rate as f64;

    Ok(reducer.finish(source_channels, duration, bins))
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
        let merged: Vec<[f32; 4]> = self.blocks.chunks(2).map(merge_peaks).collect();
        self.blocks = merged;
        self.block_frames *= 2;
    }

    /// Reduces to `bins` bins (fewer if there is less audio than that).
    fn finish(mut self, source_channels: usize, duration: f64, bins: usize) -> Waveform {
        if self.in_block > 0 {
            self.blocks.push(self.current);
        }
        let channels = source_channels.clamp(1, CHANNELS);
        let bins = bins.min(self.blocks.len()).max(1);
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    /// Manual benchmark: `WAVEFORM_PROBE=<long file> cargo test --lib waveform_speed -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn waveform_speed() {
        let path = std::env::var("WAVEFORM_PROBE").expect("set WAVEFORM_PROBE to a long audio file");
        let path = Path::new(&path);
        let started = Instant::now();
        let one = sequential(path).unwrap();
        let sequential_time = started.elapsed();
        let started = Instant::now();
        let many = from_file(path).unwrap();
        let parallel_time = started.elapsed();
        println!(
            "duration {:.0} s: sequential {:.2?}, parallel {:.2?} ({} bins vs {})",
            one.duration, sequential_time, parallel_time, one.bins, many.bins
        );
        // Same file, same shape: the loudest peak must agree closely.
        let loudest = |w: &Waveform| w.peaks.iter().fold(0.0f32, |m, v| m.max(v.abs()));
        assert!((loudest(&one) - loudest(&many)).abs() < 0.05);
    }
}
