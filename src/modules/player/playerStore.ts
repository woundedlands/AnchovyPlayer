import { create } from "zustand";
import { maxVolume, repeatModes, useSettings } from "../../core/settingsStore";
import * as api from "./api";
import { nextTrack, previousTrack } from "./playOrder";

/** Pressing "previous" this far into a track restarts it instead, like every hardware player. */
const restartThresholdSeconds = 3;

export interface CurrentTrack {
  path: string;
  voiceId: number;
}

/** A track change the player made on its own or by next/previous; the list's focus follows these. */
export interface Advance {
  path: string;
  sequence: number;
}

interface PlayerState {
  status: api.PlaybackStatus;
  track: CurrentTrack | null;
  error: string | null;
  advance: Advance | null;
  /** Plays `path`; `playlist` becomes the list for next/previous, repeat-folder and shuffle. */
  playFile: (path: string, playlist?: string[]) => Promise<void>;
  togglePause: () => void;
  seekTo: (seconds: number) => void;
  seekBy: (delta: number) => void;
  next: () => void;
  previous: () => void;
  cycleRepeat: () => void;
  toggleShuffle: () => void;
  changeVolume: (delta: number) => void;
}

const idleStatus: api.PlaybackStatus = { state: "idle", voiceId: 0, position: 0, duration: 0, endedVoiceId: 0 };

let playlist: string[] = [];
const shufflePlayed = new Set<string>();
let handledEnd = 0;
let gapTimer: ReturnType<typeof setTimeout> | undefined;
let advanceSequence = 0;

export const usePlayer = create<PlayerState>()((set, get) => {
  const advanceTo = (path: string | null) => {
    if (path === null) {
      return;
    }
    set({ advance: { path, sequence: ++advanceSequence } });
    void get().playFile(path);
  };

  return {
    status: idleStatus,
    track: null,
    error: null,
    advance: null,

    playFile: async (path, list) => {
      clearTimeout(gapTimer);
      if (list) {
        playlist = list;
      }
      shufflePlayed.add(path);
      try {
        const info = await api.play(path);
        set({ track: { path, voiceId: info.voiceId }, error: null });
        // A 40 ms clip can finish before play() returns; its end event then arrived while the store
        // still held the previous track and was ignored. No further status event follows, so check now.
        handleTrackEnd(get().status);
      } catch (playError) {
        set({ error: String(playError) });
      }
    },

    togglePause: () => {
      const { status, track, playFile } = get();
      if (status.state === "playing") {
        void api.pause();
      } else if (status.state === "paused") {
        void api.resume();
      } else if (track) {
        void playFile(track.path);
      }
    },

    seekTo: (seconds) => {
      const { duration } = get().status;
      void api.seek(Math.min(Math.max(seconds, 0), duration > 0 ? duration : seconds));
    },

    seekBy: (delta) => get().seekTo(get().status.position + delta),

    next: () => {
      const current = get().track?.path ?? null;
      advanceTo(nextTrack(playlist, current, useSettings.getState().shuffle, shufflePlayed, true));
    },

    previous: () => {
      const { track, status } = get();
      if (track && status.position > restartThresholdSeconds) {
        get().seekTo(0);
        return;
      }
      advanceTo(previousTrack(playlist, track?.path ?? null));
    },

    cycleRepeat: () => {
      const { repeat, update } = useSettings.getState();
      update({ repeat: repeatModes[(repeatModes.indexOf(repeat) + 1) % repeatModes.length] });
    },

    toggleShuffle: () => {
      const { shuffle, update } = useSettings.getState();
      shufflePlayed.clear();
      update({ shuffle: !shuffle });
    },

    changeVolume: (delta) => {
      const { volume, update } = useSettings.getState();
      // Rounded to whole percents so repeated wheel steps do not drift to 99.99%.
      update({ volume: Math.round(Math.min(Math.max(volume + delta, 0), maxVolume) * 100) / 100 });
    },
  };
});

/**
 * Connects the store to the engine: status events in, volume and looping out, and what happens when
 * a track ends. Returns the cleanup.
 */
export function connectPlayer(): () => void {
  const applyEngineSettings = () => {
    const { volume, repeat, trackGapMs } = useSettings.getState();
    void api.setVolume(volume);
    // Only a gapless repeat is left to the engine; with a gap the replay is scheduled here.
    void api.setLooping(repeat === "current" && trackGapMs === 0);
  };
  applyEngineSettings();
  const stopSettings = useSettings.subscribe(applyEngineSettings);
  const unlisten = api.onPlaybackStatus((status) => {
    usePlayer.setState({ status });
    handleTrackEnd(status);
  });

  return () => {
    stopSettings();
    void unlisten.then((stop) => stop());
  };
}

/**
 * Off stops after the file - auditioning a folder of sound effects must not turn into playing all
 * of them. Current replays, folder moves on; both wait the configured gap first.
 */
function handleTrackEnd(status: api.PlaybackStatus) {
  const { track, next, playFile } = usePlayer.getState();
  if (!track || status.endedVoiceId !== track.voiceId || handledEnd === status.endedVoiceId) {
    return;
  }
  handledEnd = status.endedVoiceId;
  const { repeat, trackGapMs } = useSettings.getState();
  if (repeat === "off" || (repeat === "current" && trackGapMs === 0)) {
    return;
  }
  clearTimeout(gapTimer);
  gapTimer = setTimeout(() => {
    // Anything the user started meanwhile wins over the scheduled repeat.
    if (usePlayer.getState().track?.voiceId !== track.voiceId) {
      return;
    }
    if (repeat === "current") {
      void playFile(track.path);
    } else {
      next();
    }
  }, trackGapMs);
}

// Holds session-wide subscriptions: a hot-swapped copy would run next to the old one (two players
// reacting to every event). Edits to this module reload the page instead.
import.meta.hot?.accept(() => window.location.reload());
