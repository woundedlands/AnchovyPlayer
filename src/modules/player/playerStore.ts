import { create } from "zustand";
import { maxVolume, repeatModes, useSettings, volumeStep } from "../../core/settingsStore";
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
  /**
   * Where a seek is going, shown as the position until the engine gets there. Dragging across the
   * waveform then moves the playhead at display rate however slow the actual seeks are.
   */
  seekTarget: number | null;
  /**
   * With nothing played yet: the file Play would start, shown in the player bar (name, path,
   * waveform) so the bar is not empty. Set by the app from the list's focus.
   */
  cued: string | null;
  setCued: (path: string | null) => void;
  track: CurrentTrack | null;
  error: string | null;
  advance: Advance | null;
  /**
   * Plays `path`; `playlist` becomes the list for next/previous, repeat-group and shuffle.
   * `oneShot` plays it once whatever the repeat mode - for files opened from Explorer, where a
   * sound suddenly looping or the whole folder starting would be alarming.
   */
  playFile: (path: string, playlist?: string[], options?: { oneShot?: boolean; startAt?: number }) => Promise<void>;
  /** Replaces the playlist without touching playback, e.g. when the selection changes mid-track. */
  setPlaylist: (paths: string[]) => void;
  togglePause: () => void;
  seekTo: (seconds: number) => void;
  seekBy: (delta: number) => void;
  next: () => void;
  previous: () => void;
  cycleRepeat: () => void;
  toggleShuffle: () => void;
  /** One 5% step up or down, landing on the 5% grid. */
  stepVolume: (direction: 1 | -1) => void;
}

const idleStatus: api.PlaybackStatus = { state: "idle", voiceId: 0, position: 0, duration: 0, endedVoiceId: 0 };

let playlist: string[] = [];
const shufflePlayed = new Set<string>();
let handledEnd = 0;
let gapTimer: ReturnType<typeof setTimeout> | undefined;
let advanceSequence = 0;
/** Latest-wins seeking: one seek in flight at a time; newer requests replace the waiting one. */
let seekRunning = false;
let pendingSeek: number | null = null;
let seekSettledAt = 0;
/** After the last seek resolves, the engine reports the new position within a buffer or two. */
const seekSettleMs = 400;
const seekArrivedSeconds = 0.3;
/** The current track was opened from Explorer: no repeat until the user starts playback themselves. */
let oneShot = false;
/** Where a track starts (resume); set by the app so the player need not know how positions are kept. */
let startResolver: ((path: string) => Promise<number | null>) | null = null;

export function setStartResolver(resolver: ((path: string) => Promise<number | null>) | null) {
  startResolver = resolver;
}

/** Gapless repeat-current is looped by the engine; everything else is scheduled here. */
function engineLooping(): boolean {
  const { repeat, trackGapMs } = useSettings.getState();

  return !oneShot && repeat === "current" && trackGapMs === 0;
}

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
    seekTarget: null,
    cued: null,

    setCued: (cued) => {
      if (get().cued !== cued) {
        set({ cued });
      }
    },

    playFile: async (path, list, options) => {
      clearTimeout(gapTimer);
      oneShot = options?.oneShot ?? false;
      pendingSeek = null;
      set({ seekTarget: null });
      if (list) {
        playlist = list;
      }
      shufflePlayed.add(path);
      try {
        // Awaited first: a 40 ms clip would otherwise loop once before a late "no looping" arrives.
        await api.setLooping(engineLooping());
        const startAt = options?.startAt ?? (startResolver ? await startResolver(path).catch(() => null) : null);
        const info = await api.play(path, startAt ?? undefined);
        set({ track: { path, voiceId: info.voiceId }, error: null });
        // A 40 ms clip can finish before play() returns; its end event then arrived while the store
        // still held the previous track and was ignored. No further status event follows, so check now.
        handleTrackEnd(get().status);
      } catch (playError) {
        set({ error: String(playError) });
      }
    },

    setPlaylist: (paths) => {
      playlist = paths;
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
      const target = Math.min(Math.max(seconds, 0), duration > 0 ? duration : seconds);
      set({ seekTarget: target });
      pendingSeek = target;
      if (!seekRunning) {
        void runSeeks();
      }
    },

    seekBy: (delta) => {
      const { seekTarget, status, seekTo } = get();
      seekTo((seekTarget ?? status.position) + delta);
    },

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

    stepVolume: (direction) => {
      const { volume, update } = useSettings.getState();
      // From an off-grid value (dragged to 6%) the first step snaps to the neighbour: up to 10%, down to 5%.
      // The epsilon keeps floating-point noise (0.15000001) from skipping a step.
      const steps = volume / volumeStep;
      const target = direction > 0 ? Math.floor(steps + 1e-6) + 1 : Math.ceil(steps - 1e-6) - 1;
      const next = Math.min(Math.max(target * volumeStep, 0), maxVolume);
      update({ volume: Math.round(next * 100) / 100 });
    },
  };
});

/**
 * Connects the store to the engine: status events in, volume and looping out, and what happens when
 * a track ends. Returns the cleanup.
 */
export function connectPlayer(): () => void {
  const applyEngineSettings = () => {
    void api.setVolume(useSettings.getState().volume);
    void api.setLooping(engineLooping());
  };
  applyEngineSettings();
  const stopSettings = useSettings.subscribe(applyEngineSettings);
  const unlisten = api.onPlaybackStatus((status) => {
    usePlayer.setState({ status });
    releaseSeekTarget(status);
    handleTrackEnd(status);
  });

  return () => {
    stopSettings();
    void unlisten.then((stop) => stop());
  };
}

/**
 * Seeks one at a time, always to the newest requested position. A drag produces hundreds of
 * positions per second and a seek in a long stream reopens the file: sending them all queued up
 * seconds of stale seeks behind the cursor.
 */
async function runSeeks() {
  seekRunning = true;
  while (pendingSeek !== null) {
    const target = pendingSeek;
    pendingSeek = null;
    try {
      await api.seek(target);
    } catch (seekError) {
      usePlayer.setState({ error: String(seekError) });
    }
  }
  seekRunning = false;
  seekSettledAt = performance.now();
}

/** Hands the playhead back to the engine once it has caught up with the last seek. */
function releaseSeekTarget(status: api.PlaybackStatus) {
  const { seekTarget } = usePlayer.getState();
  if (seekTarget === null || seekRunning || pendingSeek !== null) {
    return;
  }
  const arrived = Math.abs(status.position - seekTarget) < seekArrivedSeconds;
  if (arrived || performance.now() - seekSettledAt > seekSettleMs) {
    usePlayer.setState({ seekTarget: null });
  }
}

/**
 * Off stops after the file - auditioning a folder of sound effects must not turn into playing all
 * of them. Current replays, group moves on through the playlist; both wait the configured gap first.
 */
function handleTrackEnd(status: api.PlaybackStatus) {
  const { track, next, playFile } = usePlayer.getState();
  if (!track || status.endedVoiceId !== track.voiceId || handledEnd === status.endedVoiceId) {
    return;
  }
  handledEnd = status.endedVoiceId;
  const { repeat, trackGapMs } = useSettings.getState();
  if (oneShot || repeat === "off" || engineLooping()) {
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
