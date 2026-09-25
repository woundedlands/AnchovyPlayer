//! File decoding into interleaved stereo f32, optionally resampled to the output device rate.

use std::fs::File;
use std::path::Path;
use std::sync::LazyLock;

use rubato::audioadapter_buffers::direct::{InterleavedSlice, SequentialSliceOfVecs};
use rubato::{Fft, FixedSync, Indexing, Resampler};
use symphonia::core::codecs::audio::{AudioDecoder, AudioDecoderOptions};
use symphonia::core::codecs::registry::CodecRegistry;
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, FormatReader, SeekMode, SeekTo, TrackType};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::units::Time;
use symphonia_adapter_libopus::OpusDecoder;

/// Everything past decoding is stereo: mono is duplicated, channels beyond the first two are dropped.
pub const CHANNELS: usize = 2;

const RESAMPLE_CHUNK_FRAMES: usize = 1024;

static CODECS: LazyLock<CodecRegistry> = LazyLock::new(|| {
    let mut registry = CodecRegistry::new();
    symphonia::default::register_enabled_codecs(&mut registry);
    registry.register_audio_decoder::<OpusDecoder>();
    registry
});

pub struct TrackDecoder {
    format: Box<dyn FormatReader>,
    decoder: Box<dyn AudioDecoder>,
    track_id: u32,
    /// `None` keeps the source rate (waveform analysis).
    target_rate: Option<u32>,
    source_rate: u32,
    source_channels: usize,
    source_frames: Option<u64>,
    resampler: Option<ChunkResampler>,
    planes: Vec<Vec<f32>>,
    /// Frames to drop after an accurate seek: the decoder restarts at a packet boundary before the target.
    skip_frames: u64,
    finished: bool,
}

impl TrackDecoder {
    pub fn open(path: &Path, target_rate: Option<u32>) -> Result<Self, String> {
        let file = File::open(path).map_err(|e| format!("Cannot open {}: {e}", path.display()))?;
        let stream = MediaSourceStream::new(Box::new(file), Default::default());
        let mut hint = Hint::new();
        if let Some(extension) = path.extension().and_then(|e| e.to_str()) {
            hint.with_extension(extension);
        }

        let format = symphonia::default::get_probe()
            .probe(&hint, stream, FormatOptions::default(), MetadataOptions::default())
            .map_err(|e| format!("Unsupported format {}: {e}", path.display()))?;
        let track = format
            .default_track(TrackType::Audio)
            .ok_or_else(|| format!("No audio track in {}", path.display()))?;
        let params = track
            .codec_params
            .as_ref()
            .and_then(|p| p.audio())
            .ok_or_else(|| format!("No audio codec parameters in {}", path.display()))?;
        let decoder = CODECS
            .make_audio_decoder(params, &AudioDecoderOptions::default())
            .map_err(|e| format!("Unsupported codec in {}: {e}", path.display()))?;

        let source_rate = params.sample_rate.unwrap_or(0);
        let source_channels = params.channels.as_ref().map(|c| c.count()).unwrap_or(0);
        let track_id = track.id;
        let source_frames = track.num_frames;

        Ok(Self {
            format,
            decoder,
            track_id,
            target_rate,
            source_rate,
            source_channels,
            source_frames,
            resampler: None,
            planes: Vec::new(),
            skip_frames: 0,
            finished: false,
        })
    }

    pub fn output_rate(&self) -> u32 {
        self.target_rate.unwrap_or(self.source_rate)
    }

    /// Channel count of the file itself (1 for mono), before the stereo conversion.
    pub fn source_channels(&self) -> usize {
        self.source_channels
    }

    pub fn duration_seconds(&self) -> Option<f64> {
        match (self.source_frames, self.source_rate) {
            (Some(frames), rate) if rate > 0 => Some(frames as f64 / rate as f64),
            _ => None,
        }
    }

    pub fn seek(&mut self, seconds: f64) -> Result<(), String> {
        let whole = seconds.max(0.0).floor();
        let nanos = ((seconds.max(0.0) - whole) * 1e9) as u32;
        let time = Time::try_new(whole as i64, nanos).ok_or("Seek position out of range")?;
        let seeked = self
            .format
            .seek(SeekMode::Accurate, SeekTo::Time { time, track_id: Some(self.track_id) })
            .map_err(|e| format!("Seek failed: {e}"))?;
        self.decoder.reset();
        self.skip_frames = (seeked.required_ts.get() - seeked.actual_ts.get()).max(0) as u64;
        if let Some(resampler) = &mut self.resampler {
            resampler.reset();
        }
        self.finished = false;

        Ok(())
    }

    /// Appends the next decoded block to `out`. Returns false once the stream is exhausted and flushed.
    pub fn next_chunk(&mut self, out: &mut Vec<f32>) -> bool {
        if self.finished {
            return false;
        }

        loop {
            let packet = match self.format.next_packet() {
                Ok(Some(packet)) => packet,
                // End of stream, a chained stream we do not follow, or a truncated file: all mean "done".
                Ok(None) | Err(_) => {
                    self.finish(out);

                    return !out.is_empty();
                }
            };
            if packet.track_id != self.track_id {
                continue;
            }

            let decoded = match self.decoder.decode(&packet) {
                Ok(decoded) => decoded,
                Err(SymphoniaError::DecodeError(_)) | Err(SymphoniaError::IoError(_)) => continue,
                Err(_) => {
                    self.finish(out);

                    return !out.is_empty();
                }
            };
            if decoded.frames() == 0 {
                continue;
            }
            if self.source_rate == 0 {
                self.source_rate = decoded.spec().rate();
            }
            if self.source_channels == 0 {
                self.source_channels = decoded.spec().channels().count();
            }
            decoded.copy_to_vecs_planar(&mut self.planes);
            self.push_planes(out);

            return true;
        }
    }

    fn push_planes(&mut self, out: &mut Vec<f32>) {
        let frames = self.planes.first().map_or(0, |p| p.len());
        let skip = (self.skip_frames as usize).min(frames);
        self.skip_frames -= skip as u64;
        if skip == frames {
            return;
        }

        let left = &self.planes[0][skip..];
        let right = match self.planes.get(1) {
            Some(plane) => &plane[skip..],
            None => left,
        };

        match self.target_rate {
            Some(target) if target != self.source_rate => {
                let source_rate = self.source_rate;
                let resampler = self.resampler.get_or_insert_with(|| {
                    ChunkResampler::new(source_rate, target).expect("sample rates are non-zero")
                });
                resampler.push(left, right, out);
            }
            _ => {
                out.reserve(left.len() * CHANNELS);
                for (l, r) in left.iter().zip(right) {
                    out.push(*l);
                    out.push(*r);
                }
            }
        }
    }

    fn finish(&mut self, out: &mut Vec<f32>) {
        self.finished = true;
        if let Some(resampler) = &mut self.resampler {
            resampler.finish(out);
        }
    }
}

/// Streams arbitrary-sized stereo blocks through rubato's fixed-input FFT resampler.
/// Trims the resampler's startup delay and pads the tail, so output length is exactly
/// `input * ratio` and aligned with the input - a short SFX must not gain leading silence.
struct ChunkResampler {
    fft: Fft<f32>,
    pending: Vec<Vec<f32>>,
    scratch: Vec<f32>,
    ratio: f64,
    delay_left: usize,
    input_total: u64,
    output_total: u64,
    output_limit: Option<u64>,
}

impl ChunkResampler {
    fn new(from: u32, to: u32) -> Result<Self, String> {
        let fft = Fft::<f32>::new(from as usize, to as usize, RESAMPLE_CHUNK_FRAMES, CHANNELS, FixedSync::Input)
            .map_err(|e| format!("Cannot resample {from} Hz to {to} Hz: {e}"))?;
        let scratch = vec![0.0; fft.output_frames_max() * CHANNELS];
        let delay_left = fft.output_delay();

        Ok(Self {
            fft,
            pending: vec![Vec::new(), Vec::new()],
            scratch,
            ratio: to as f64 / from as f64,
            delay_left,
            input_total: 0,
            output_total: 0,
            output_limit: None,
        })
    }

    fn reset(&mut self) {
        self.fft.reset();
        self.pending.iter_mut().for_each(Vec::clear);
        self.delay_left = self.fft.output_delay();
        self.input_total = 0;
        self.output_total = 0;
        self.output_limit = None;
    }

    fn push(&mut self, left: &[f32], right: &[f32], out: &mut Vec<f32>) {
        self.pending[0].extend_from_slice(left);
        self.pending[1].extend_from_slice(right);
        self.input_total += left.len() as u64;

        let mut offset = 0;
        loop {
            let needed = self.fft.input_frames_next();
            if self.pending[0].len() - offset < needed {
                break;
            }
            self.process(offset, None, out);
            offset += needed;
        }
        self.pending.iter_mut().for_each(|plane| {
            plane.drain(..offset);
        });
    }

    fn finish(&mut self, out: &mut Vec<f32>) {
        let limit = (self.input_total as f64 * self.ratio).round() as u64;
        self.output_limit = Some(limit);
        let remaining = self.pending[0].len();
        if remaining > 0 {
            self.process(0, Some(remaining), out);
            self.pending.iter_mut().for_each(Vec::clear);
        }

        // Silence pushes out what the resampler still holds; the delay bounds how many rounds it takes.
        let max_rounds = self.fft.output_delay() / RESAMPLE_CHUNK_FRAMES.max(1) + 2;
        for _ in 0..max_rounds {
            if self.output_total >= limit {
                break;
            }
            self.process(0, Some(0), out);
        }
    }

    fn process(&mut self, input_offset: usize, partial_len: Option<usize>, out: &mut Vec<f32>) {
        let available = self.pending[0].len().max(input_offset + self.fft.input_frames_next());
        // A partial final chunk may be shorter than what the resampler asks for; pad the planes so the adapter fits.
        for plane in &mut self.pending {
            plane.resize(available, 0.0);
        }
        let input = SequentialSliceOfVecs::new(&self.pending, CHANNELS, available).expect("planes sized above");
        let output_frames = self.fft.output_frames_max();
        let mut output =
            InterleavedSlice::new_mut(&mut self.scratch, CHANNELS, output_frames).expect("scratch sized from resampler");
        let indexing = Indexing { input_offset, output_offset: 0, partial_len, active_channels_mask: None };
        let (_, written) = self
            .fft
            .process_into_buffer(&input, &mut output, Some(&indexing))
            .expect("resampler buffers are sized from its own limits");

        let skipped = self.delay_left.min(written);
        self.delay_left -= skipped;
        let mut frames = written - skipped;
        if let Some(limit) = self.output_limit {
            frames = frames.min(limit.saturating_sub(self.output_total) as usize);
        }
        out.extend_from_slice(&self.scratch[skipped * CHANNELS..(skipped + frames) * CHANNELS]);
        self.output_total += frames as u64;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn resample_length(from: u32, to: u32, input_frames: usize, block: usize) -> usize {
        let mut resampler = ChunkResampler::new(from, to).unwrap();
        let signal: Vec<f32> = (0..input_frames).map(|i| (i as f32 * 0.01).sin()).collect();
        let mut out = Vec::new();
        for piece in signal.chunks(block) {
            resampler.push(piece, piece, &mut out);
        }
        resampler.finish(&mut out);

        out.len() / CHANNELS
    }

    /// Manual probe: `AUDIO_PROBE=<file> cargo test probe_file -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn probe_file() {
        let path = std::env::var("AUDIO_PROBE").expect("set AUDIO_PROBE to a file path");
        let mut decoder = TrackDecoder::open(Path::new(&path), Some(48_000)).unwrap();
        let reported = decoder.duration_seconds();
        let mut samples = Vec::new();
        while decoder.next_chunk(&mut samples) {}
        let decoded = samples.len() as f64 / CHANNELS as f64 / 48_000.0;
        println!("reported {reported:?} s, decoded {decoded:.4} s, channels {}", decoder.source_channels());
    }

    #[test]
    fn output_length_matches_ratio() {
        assert_eq!(resample_length(44_100, 48_000, 44_100, 577), 48_000);
        assert_eq!(resample_length(96_000, 48_000, 10_000, 4096), 5_000);
    }

    #[test]
    fn tiny_clip_survives_resampling() {
        // A 2 ms click must come out, not vanish inside the resampler delay.
        assert_eq!(resample_length(44_100, 48_000, 88, 88), 96);
    }

    #[test]
    fn resampling_keeps_timing() {
        // An impulse must come out where it went in, scaled by the ratio: no added latency.
        let mut resampler = ChunkResampler::new(44_100, 48_000).unwrap();
        let mut impulse = vec![0.0f32; 4410];
        impulse[1000] = 1.0;
        let mut out = Vec::new();
        resampler.push(&impulse, &impulse, &mut out);
        resampler.finish(&mut out);
        let peak = out
            .chunks_exact(CHANNELS)
            .enumerate()
            .max_by(|a, b| a.1[0].abs().total_cmp(&b.1[0].abs()))
            .map(|(frame, _)| frame)
            .unwrap();
        let expected = (1000.0 * 48_000.0 / 44_100.0) as usize;
        assert!(peak.abs_diff(expected) <= 1, "peak at {peak}, expected {expected}");
    }
}
