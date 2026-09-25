//! The always-open output stream and the mixer running inside its callback.
//!
//! The stream is opened once and renders silence when idle; starting a sound is a command to the
//! mixer, never a device open. The callback never allocates, blocks or frees: commands arrive
//! through a wait-free ring buffer and replaced voices are handed back to be dropped elsewhere.

use std::sync::atomic::{AtomicBool, AtomicU8, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::thread;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{ErrorKind, FromSample, SampleFormat, SizedSample, StreamConfig};

use super::decode::CHANNELS;

const FADE_SECONDS: f32 = 0.003;
const VOLUME_RAMP_SECONDS: f32 = 0.02;
const COMMAND_CAPACITY: usize = 64;
const GARBAGE_CAPACITY: usize = 64;
const MIX_BLOCK_FRAMES: usize = 1024;

/// Interleaved stereo PCM at the device rate, fully in memory.
pub struct Clip {
    pub samples: Vec<f32>,
    /// Channel count of the file (1 for mono), so the waveform can show one lane instead of two identical ones.
    pub source_channels: usize,
}

impl Clip {
    pub fn frames(&self) -> usize {
        self.samples.len() / CHANNELS
    }
}

pub enum Voice {
    Clip {
        id: u64,
        clip: Arc<Clip>,
        position: usize,
    },
    Stream {
        id: u64,
        samples: rtrb::Consumer<f32>,
        producer_done: Arc<AtomicBool>,
        start_frame: u64,
        played: u64,
    },
}

impl Voice {
    fn id(&self) -> u64 {
        match self {
            Voice::Clip { id, .. } | Voice::Stream { id, .. } => *id,
        }
    }

    fn position(&self) -> u64 {
        match self {
            Voice::Clip { position, .. } => *position as u64,
            Voice::Stream { start_frame, played, .. } => start_frame + played,
        }
    }

    /// Writes up to `dst.len() / CHANNELS` frames. Returns frames written and whether the voice has ended.
    fn render(&mut self, dst: &mut [f32], looping: bool) -> (usize, bool) {
        let wanted = dst.len() / CHANNELS;
        match self {
            Voice::Clip { clip, position, .. } => {
                let total = clip.frames();
                if total == 0 {
                    return (0, true);
                }
                let mut written = 0;
                while written < wanted {
                    if *position >= total {
                        if !looping {
                            return (written, true);
                        }
                        *position = 0;
                    }
                    let count = (total - *position).min(wanted - written);
                    dst[written * CHANNELS..(written + count) * CHANNELS]
                        .copy_from_slice(&clip.samples[*position * CHANNELS..(*position + count) * CHANNELS]);
                    *position += count;
                    written += count;
                }

                (written, !looping && *position >= total)
            }
            Voice::Stream { samples, producer_done, played, .. } => {
                // Read the flag before the slots, or a final push landing in between would look like the end.
                let done = producer_done.load(Ordering::Acquire);
                let available = samples.slots() - samples.slots() % CHANNELS;
                let count = available.min(wanted * CHANNELS);
                if count > 0 {
                    let chunk = samples.read_chunk(count).expect("count is within available slots");
                    let (first, second) = chunk.as_slices();
                    dst[..first.len()].copy_from_slice(first);
                    dst[first.len()..count].copy_from_slice(second);
                    chunk.commit_all();
                }
                *played += (count / CHANNELS) as u64;
                // An empty ring while the decoder still runs is an underrun, not the end: play silence and wait.
                let ended = done && samples.slots() == 0;

                (count / CHANNELS, ended)
            }
        }
    }
}

pub enum Command {
    /// `paused` keeps a seek during pause paused.
    Play { voice: Voice, paused: bool },
    Pause,
    Resume,
    Stop,
    SetLooping(bool),
    /// Linear gain, 1.0 is unity; above 1.0 boosts and may clip.
    SetVolume(f32),
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum PlayState {
    Idle = 0,
    Playing = 1,
    Paused = 2,
}

/// Written by the callback, read by the control side.
#[derive(Default)]
pub struct Status {
    state: AtomicU8,
    voice_id: AtomicU64,
    position_frames: AtomicU64,
    /// Id of the last voice that played to its natural end.
    ended_voice_id: AtomicU64,
    sample_rate: AtomicU32,
}

impl Status {
    pub fn state(&self) -> PlayState {
        match self.state.load(Ordering::Acquire) {
            1 => PlayState::Playing,
            2 => PlayState::Paused,
            _ => PlayState::Idle,
        }
    }

    pub fn voice_id(&self) -> u64 {
        self.voice_id.load(Ordering::Acquire)
    }

    pub fn position_frames(&self) -> u64 {
        self.position_frames.load(Ordering::Acquire)
    }

    pub fn ended_voice_id(&self) -> u64 {
        self.ended_voice_id.load(Ordering::Acquire)
    }

    pub fn sample_rate(&self) -> u32 {
        self.sample_rate.load(Ordering::Acquire)
    }
}

struct Fade {
    voice: Voice,
    gain: f32,
}

struct Mixer {
    commands: rtrb::Consumer<Command>,
    garbage: rtrb::Producer<Voice>,
    status: Arc<Status>,
    current: Option<Voice>,
    fading: Option<Fade>,
    gain: f32,
    paused: bool,
    looping: bool,
    fade_step: f32,
    volume: f32,
    volume_target: f32,
    volume_step: f32,
    block: Vec<f32>,
    fade_block: Vec<f32>,
}

impl Mixer {
    fn set_sample_rate(&mut self, rate: u32) {
        self.fade_step = 1.0 / (FADE_SECONDS * rate as f32).max(1.0);
        self.volume_step = 1.0 / (VOLUME_RAMP_SECONDS * rate as f32).max(1.0);
        self.status.sample_rate.store(rate, Ordering::Release);
    }

    fn apply_commands(&mut self) {
        while let Ok(command) = self.commands.pop() {
            match command {
                Command::Play { voice, paused } => {
                    self.retire_current();
                    self.status.voice_id.store(voice.id(), Ordering::Release);
                    self.current = Some(voice);
                    // No fade-in: the first samples of a sound effect are its attack.
                    self.gain = if paused { 0.0 } else { 1.0 };
                    self.paused = paused;
                }
                Command::Pause => self.paused = true,
                Command::Resume => self.paused = false,
                Command::Stop => self.retire_current(),
                Command::SetLooping(looping) => self.looping = looping,
                Command::SetVolume(volume) => self.volume_target = volume.max(0.0),
            }
        }
    }

    /// Moves the current voice into the fade-out slot so cutting it does not click.
    fn retire_current(&mut self) {
        if let Some(voice) = self.current.take() {
            if let Some(previous) = self.fading.take() {
                self.dispose(previous.voice);
            }
            self.fading = Some(Fade { voice, gain: self.gain });
        }
    }

    fn dispose(&mut self, voice: Voice) {
        // Freeing a clip here would free megabytes on the audio thread. If the ring is somehow
        // full, dropping in place is the lesser evil compared to leaking.
        if let Err(rtrb::PushError::Full(voice)) = self.garbage.push(voice) {
            drop(voice);
        }
    }

    /// Mixes one block of interleaved stereo into `self.block`.
    fn mix_block(&mut self, frames: usize) {
        // Taken out and put back so voices can be disposed while the block is borrowed; no allocation.
        let mut owned_block = std::mem::take(&mut self.block);
        let mut owned_fade_block = std::mem::take(&mut self.fade_block);
        self.mix_into(&mut owned_block[..frames * CHANNELS], &mut owned_fade_block[..frames * CHANNELS]);
        self.block = owned_block;
        self.fade_block = owned_fade_block;

        self.apply_volume(frames);
        self.publish_status();
    }

    fn mix_into(&mut self, block: &mut [f32], fade_block: &mut [f32]) {
        let frames = block.len() / CHANNELS;
        block.fill(0.0);

        if let Some(voice) = &mut self.current {
            let target = if self.paused { 0.0 } else { 1.0 };
            if !(self.paused && self.gain == 0.0) {
                let (written, ended) = voice.render(block, self.looping);
                for frame in block[..written * CHANNELS].chunks_exact_mut(CHANNELS) {
                    if self.gain != target {
                        self.gain = if target > self.gain {
                            (self.gain + self.fade_step).min(target)
                        } else {
                            (self.gain - self.fade_step).max(target)
                        };
                    }
                    frame.iter_mut().for_each(|s| *s *= self.gain);
                }
                if ended {
                    let id = voice.id();
                    let voice = self.current.take().expect("current voice checked above");
                    self.dispose(voice);
                    self.status.ended_voice_id.store(id, Ordering::Release);
                }
            }
        }

        if let Some(fade) = &mut self.fading {
            fade_block.fill(0.0);
            let (written, _) = fade.voice.render(fade_block, false);
            for (frame, out) in fade_block[..written * CHANNELS]
                .chunks_exact(CHANNELS)
                .zip(block.chunks_exact_mut(CHANNELS))
            {
                fade.gain = (fade.gain - self.fade_step).max(0.0);
                for (sample, mixed) in frame.iter().zip(out.iter_mut()) {
                    *mixed += sample * fade.gain;
                }
            }
            if fade.gain == 0.0 || written < frames {
                let fade = self.fading.take().expect("fading voice checked above");
                self.dispose(fade.voice);
            }
        }
    }

    /// Ramps towards the target so wheel-scrolling the volume does not crackle.
    fn apply_volume(&mut self, frames: usize) {
        for frame in self.block[..frames * CHANNELS].chunks_exact_mut(CHANNELS) {
            if self.volume != self.volume_target {
                self.volume = if self.volume_target > self.volume {
                    (self.volume + self.volume_step).min(self.volume_target)
                } else {
                    (self.volume - self.volume_step).max(self.volume_target)
                };
            }
            for sample in frame {
                // Boost above 100% can exceed full scale; clamp rather than let the device wrap around.
                *sample = (*sample * self.volume).clamp(-1.0, 1.0);
            }
        }
    }

    fn publish_status(&self) {
        let state = match (&self.current, self.paused) {
            (None, _) => PlayState::Idle,
            (Some(_), true) => PlayState::Paused,
            (Some(_), false) => PlayState::Playing,
        };
        if let Some(voice) = &self.current {
            self.status.position_frames.store(voice.position(), Ordering::Release);
        }
        self.status.state.store(state as u8, Ordering::Release);
    }

    fn render<T: SizedSample + FromSample<f32>>(&mut self, data: &mut [T], device_channels: usize) {
        self.apply_commands();
        for out in data.chunks_mut(MIX_BLOCK_FRAMES * device_channels) {
            let frames = out.len() / device_channels;
            self.mix_block(frames);
            for (frame, stereo) in out.chunks_exact_mut(device_channels).zip(self.block.chunks_exact(CHANNELS)) {
                write_frame(frame, stereo);
            }
        }
    }
}

fn write_frame<T: SizedSample + FromSample<f32>>(frame: &mut [T], stereo: &[f32]) {
    if frame.len() == 1 {
        frame[0] = T::from_sample((stereo[0] + stereo[1]) * 0.5);
        return;
    }
    frame[0] = T::from_sample(stereo[0]);
    frame[1] = T::from_sample(stereo[1]);
    for extra in &mut frame[2..] {
        *extra = T::from_sample(0.0f32);
    }
}

/// Handle to the output thread. Commands are pushed from any thread through a mutex that the
/// audio callback never touches - it only sees the consumer end of the ring.
pub struct Output {
    commands: Mutex<rtrb::Producer<Command>>,
    pub status: Arc<Status>,
}

impl Output {
    /// Opens the default output device and keeps it open for the life of the process.
    pub fn start() -> Result<Self, String> {
        let (command_tx, command_rx) = rtrb::RingBuffer::new(COMMAND_CAPACITY);
        let (garbage_tx, garbage_rx) = rtrb::RingBuffer::new(GARBAGE_CAPACITY);
        let status = Arc::new(Status::default());
        let mixer = Mixer {
            commands: command_rx,
            garbage: garbage_tx,
            status: status.clone(),
            current: None,
            fading: None,
            gain: 1.0,
            paused: false,
            looping: false,
            fade_step: 1.0,
            volume: 1.0,
            volume_target: 1.0,
            volume_step: 1.0,
            block: vec![0.0; MIX_BLOCK_FRAMES * CHANNELS],
            fade_block: vec![0.0; MIX_BLOCK_FRAMES * CHANNELS],
        };

        spawn_garbage_collector(garbage_rx);
        let (ready_tx, ready_rx) = mpsc::channel();
        thread::Builder::new()
            .name("audio-output".into())
            .spawn(move || run_output_thread(Arc::new(Mutex::new(mixer)), ready_tx))
            .map_err(|e| format!("Cannot start audio thread: {e}"))?;
        ready_rx
            .recv()
            .map_err(|_| "Audio thread exited before opening the device".to_string())??;

        Ok(Self { commands: Mutex::new(command_tx), status })
    }

    pub fn send(&self, command: Command) {
        let mut commands = self.commands.lock().expect("command producer lock poisoned");
        // The callback drains the ring every few milliseconds; a full ring means the device is stalled.
        let mut command = command;
        for _ in 0..50 {
            match commands.push(command) {
                Ok(()) => return,
                Err(rtrb::PushError::Full(rejected)) => {
                    command = rejected;
                    thread::sleep(Duration::from_millis(2));
                }
            }
        }
        eprintln!("audio: command dropped, output callback is not running");
    }
}

fn spawn_garbage_collector(mut garbage: rtrb::Consumer<Voice>) {
    thread::Builder::new()
        .name("audio-garbage".into())
        .spawn(move || {
            loop {
                while garbage.pop().is_ok() {}
                if garbage.is_abandoned() {
                    return;
                }
                thread::sleep(Duration::from_millis(50));
            }
        })
        .expect("spawning the audio garbage thread");
}

/// Owns the cpal stream (not `Send` on every platform) and rebuilds it when the device goes away,
/// e.g. headphones unplugged or the default device switched.
fn run_output_thread(mixer: Arc<Mutex<Mixer>>, ready: mpsc::Sender<Result<(), String>>) {
    let (rebuild_tx, rebuild_rx) = mpsc::channel::<()>();
    let mut ready = Some(ready);
    loop {
        let stream = open_stream(mixer.clone(), rebuild_tx.clone());
        match (stream, ready.take()) {
            (Ok(stream), ready) => {
                if let Some(ready) = ready {
                    let _ = ready.send(Ok(()));
                }
                // Blocks until the error callback asks for a rebuild; the stream stays alive meanwhile.
                let _ = rebuild_rx.recv();
                drop(stream);
                while rebuild_rx.try_recv().is_ok() {}
            }
            (Err(error), Some(ready)) => {
                let _ = ready.send(Err(error));
                return;
            }
            (Err(error), None) => {
                eprintln!("audio: reopening output failed, retrying: {error}");
                thread::sleep(Duration::from_secs(1));
            }
        }
    }
}

fn open_stream(mixer: Arc<Mutex<Mixer>>, rebuild: mpsc::Sender<()>) -> Result<cpal::Stream, String> {
    let host = cpal::default_host();
    let device = host.default_output_device().ok_or("No audio output device found")?;
    let supported = device
        .default_output_config()
        .map_err(|e| format!("Cannot read output device config: {e}"))?;
    let format = supported.sample_format();
    let config: StreamConfig = supported.into();
    mixer
        .lock()
        .expect("mixer lock poisoned")
        .set_sample_rate(config.sample_rate);

    match format {
        SampleFormat::F32 => build_stream::<f32>(&device, config, mixer, rebuild),
        SampleFormat::I16 => build_stream::<i16>(&device, config, mixer, rebuild),
        SampleFormat::I32 => build_stream::<i32>(&device, config, mixer, rebuild),
        SampleFormat::U16 => build_stream::<u16>(&device, config, mixer, rebuild),
        other => Err(format!("Unsupported output sample format {other}")),
    }
}

fn build_stream<T: SizedSample + FromSample<f32>>(
    device: &cpal::Device,
    config: StreamConfig,
    mixer: Arc<Mutex<Mixer>>,
    rebuild: mpsc::Sender<()>,
) -> Result<cpal::Stream, String> {
    let channels = config.channels as usize;
    let stream = device
        .build_output_stream(
            config,
            move |data: &mut [T], _| {
                // Uncontended except during a device rebuild, when silence for one buffer is correct.
                match mixer.try_lock() {
                    Ok(mut mixer) => mixer.render(data, channels),
                    Err(_) => data.fill(T::EQUILIBRIUM),
                }
            },
            move |error: cpal::Error| {
                eprintln!("audio: output stream error: {error}");
                // A rerouted default device (DeviceChanged) keeps working; only a dead stream is rebuilt.
                if matches!(error.kind(), ErrorKind::DeviceNotAvailable | ErrorKind::StreamInvalidated) {
                    let _ = rebuild.send(());
                }
            },
            None,
        )
        .map_err(|e| format!("Cannot open audio output: {e}"))?;
    stream.play().map_err(|e| format!("Cannot start audio output: {e}"))?;

    Ok(stream)
}
