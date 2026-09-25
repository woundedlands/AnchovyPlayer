import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type PlayState = "idle" | "playing" | "paused";

export interface PlaybackStatus {
  state: PlayState;
  voiceId: number;
  position: number;
  duration: number;
  endedVoiceId: number;
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

export const play = (path: string) => invoke<TrackInfo>("play", { path });

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
