import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type PlayState = "idle" | "playing" | "paused";

export interface PlaybackStatus {
  state: PlayState;
  voiceId: number;
  position: number;
  duration: number;
  endedVoiceId: number;
  /** Loudness since the previous status: RMS before volume, 0..1. */
  level: number;
}

export interface TrackInfo {
  voiceId: number;
  duration: number;
}

export interface Waveform {
  channels: number;
  duration: number;
  /** Per channel, `bins` pairs of (min, max), channel after channel. */
  peaks: number[];
  bins: number;
}

/** `startSeconds` starts the track there directly (resume), with no jump from the start. */
export const play = (path: string, startSeconds?: number) => invoke<TrackInfo>("play", { path, startSeconds });

/** Anonymous content identity, shared with the waveform cache: keys resume positions. */
export const fileFingerprint = (path: string) => invoke<string>("file_fingerprint", { path });

export const pause = () => invoke<void>("pause");

export const resume = () => invoke<void>("resume");

export const stop = () => invoke<void>("stop");

export const seek = (seconds: number) => invoke<void>("seek", { seconds });

export const setLooping = (looping: boolean) => invoke<void>("set_looping", { looping });

export const setVolume = (volume: number) => invoke<void>("set_volume", { volume });

export const prefetch = (paths: string[]) => invoke<void>("prefetch", { paths });

export const loadWaveform = (path: string) => invoke<Waveform>("waveform", { path });

export const onPlaybackStatus = (handler: (status: PlaybackStatus) => void): Promise<UnlistenFn> =>
  listen<PlaybackStatus>("player-status", (event) => handler(event.payload));
