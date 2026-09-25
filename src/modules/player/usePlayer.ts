import { useCallback, useEffect, useRef, useState } from "react";
import { repeatModes, type Settings } from "../../core/useSettings";
import * as api from "./api";
import { nextTrack, previousTrack } from "./playOrder";

export const maxVolume = 2;
/** Pressing "previous" this far into a track restarts it instead, like every hardware player. */
const restartThresholdSeconds = 3;

export interface CurrentTrack {
  path: string;
  voiceId: number;
}

const idleStatus: api.PlaybackStatus = { state: "idle", voiceId: 0, position: 0, duration: 0, endedVoiceId: 0 };

export function usePlayer(settings: Settings, onAutoAdvance: (path: string) => void) {
  const [status, setStatus] = useState(idleStatus);
  const [track, setTrack] = useState<CurrentTrack | null>(null);
  const [error, setError] = useState<string | null>(null);
  const playlist = useRef<string[]>([]);
  const shufflePlayed = useRef(new Set<string>());
  const handledEnd = useRef(0);
  const latest = useRef({ status, track, settings, onAutoAdvance });
  latest.current = { status, track, settings, onAutoAdvance };

  useEffect(() => {
    const unlisten = api.onPlaybackStatus(setStatus);

    return () => {
      void unlisten.then((stop) => stop());
    };
  }, []);

  useEffect(() => {
    void api.setLooping(settings.repeat === "current");
  }, [settings.repeat]);

  useEffect(() => {
    void api.setVolume(settings.volume);
  }, [settings.volume]);

  /** Plays `path`; `list` becomes the playlist for next/previous and repeat-folder. */
  const playFile = useCallback(async (path: string, list?: string[]) => {
    if (list) {
      playlist.current = list;
    }
    shufflePlayed.current.add(path);
    try {
      const info = await api.play(path);
      setTrack({ path, voiceId: info.voiceId });
      setError(null);
    } catch (playError) {
      setError(String(playError));
    }
  }, []);

  const togglePause = useCallback(() => {
    const { status: current, track: currentTrack } = latest.current;
    if (current.state === "playing") {
      void api.pause();
    } else if (current.state === "paused") {
      void api.resume();
    } else if (currentTrack) {
      void playFile(currentTrack.path);
    }
  }, [playFile]);

  const seekTo = useCallback((seconds: number) => {
    const { duration } = latest.current.status;
    void api.seek(Math.min(Math.max(seconds, 0), duration > 0 ? duration : seconds));
  }, []);

  const seekBy = useCallback((delta: number) => seekTo(latest.current.status.position + delta), [seekTo]);

  const next = useCallback(
    (wrap = true) => {
      const { track: currentTrack, settings: current } = latest.current;
      const path = nextTrack(playlist.current, currentTrack?.path ?? null, current.shuffle, shufflePlayed.current, wrap);
      if (path !== null) {
        void playFile(path);
      }

      return path;
    },
    [playFile],
  );

  const previous = useCallback(() => {
    const { track: currentTrack, status: current } = latest.current;
    if (currentTrack && current.position > restartThresholdSeconds) {
      seekTo(0);
      return;
    }
    const path = previousTrack(playlist.current, currentTrack?.path ?? null);
    if (path !== null) {
      void playFile(path);
    }
  }, [playFile, seekTo]);

  // Repeat-folder continues through the playlist. "off" stops after one file: auditioning a
  // folder of sound effects must not turn into playing all of them.
  useEffect(() => {
    const currentTrack = latest.current.track;
    if (!currentTrack || status.endedVoiceId !== currentTrack.voiceId || handledEnd.current === status.endedVoiceId) {
      return;
    }
    handledEnd.current = status.endedVoiceId;
    if (latest.current.settings.repeat === "folder") {
      const path = next(true);
      if (path !== null) {
        latest.current.onAutoAdvance(path);
      }
    }
  }, [status.endedVoiceId, next]);

  const cycleRepeat = useCallback(() => {
    const { repeat, setRepeat } = latest.current.settings;
    setRepeat(repeatModes[(repeatModes.indexOf(repeat) + 1) % repeatModes.length]);
  }, []);

  const toggleShuffle = useCallback(() => {
    const { shuffle, setShuffle } = latest.current.settings;
    shufflePlayed.current.clear();
    setShuffle(!shuffle);
  }, []);

  const changeVolume = useCallback((delta: number) => {
    const { volume, setVolume } = latest.current.settings;
    // Rounded to whole percents so repeated wheel steps do not drift to 99.99%.
    setVolume(Math.round(Math.min(Math.max(volume + delta, 0), maxVolume) * 100) / 100);
  }, []);

  const prefetchPaths = useCallback((paths: string[]) => api.prefetch(paths), []);

  return {
    status,
    track,
    error,
    playFile,
    togglePause,
    seekTo,
    seekBy,
    next,
    previous,
    cycleRepeat,
    toggleShuffle,
    changeVolume,
    prefetchPaths,
  };
}

export type PlayerController = ReturnType<typeof usePlayer>;
