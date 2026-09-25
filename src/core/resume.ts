// What survives a restart: the last folder and where long tracks were stopped. Positions are keyed
// by a content fingerprint, not a path, so session.json holds no names of what was listened to.

import { useBrowser } from "../modules/browser/browserStore";
import { useSearch } from "../modules/browser/searchStore";
import { fileFingerprint } from "../modules/player/api";
import { setStartResolver, usePlayer } from "../modules/player/playerStore";
import { pathKey } from "./paths";
import {
  forgetAllPositions,
  forgetPosition,
  hasPositions,
  positionFor,
  rememberFolder,
  rememberPosition,
} from "./sessionStore";
import { useSettings } from "./settingsStore";

const saveEveryMs = 5000;
/** Stopped this close to the end counts as finished: next time the track starts over. */
const endMarginSeconds = 5;
/** Barely started is not worth resuming. */
const startMarginSeconds = 3;

/**
 * Fingerprints by file version (path + size + modification time), so replaying a file costs no
 * disk read; a re-exported file gets a new version and a new fingerprint.
 */
const fingerprints = new Map<string, Promise<string>>();

function fingerprintOf(path: string): Promise<string> {
  const key = pathKey(path);
  const entry = [...useBrowser.getState().entries, ...useSearch.getState().results].find(
    (item) => pathKey(item.path) === key,
  );
  const version = entry ? `${key}|${entry.size}|${entry.modifiedMs}` : key;
  let fingerprint = fingerprints.get(version);
  if (!fingerprint) {
    fingerprint = fileFingerprint(path);
    fingerprints.set(version, fingerprint);
    // A failed read must not stay cached as a rejection.
    fingerprint.catch(() => fingerprints.delete(version));
  }

  return fingerprint;
}

/** Where a track should start. Nothing saved yet means no fingerprint read at all. */
async function startPosition(path: string): Promise<number | null> {
  const minDuration = useSettings.getState().resumeMinSeconds;
  if (minDuration === 0 || !hasPositions()) {
    return null;
  }

  return positionFor(await fingerprintOf(path), minDuration);
}

function savePosition(path: string, position: number, duration: number) {
  void fingerprintOf(path)
    .then((key) => {
      if (position < startMarginSeconds || position > duration - endMarginSeconds) {
        forgetPosition(key);
      } else {
        rememberPosition(key, position, duration);
      }
    })
    .catch(() => {});
}

/** Wires remembering into the stores for the session. Returns the cleanup. */
export function connectResume(): () => void {
  setStartResolver(startPosition);

  const stopFolder = useBrowser.subscribe((state, previous) => {
    if (!useSettings.getState().reopenLastFolder) {
      return;
    }
    if (state.dir !== previous.dir || state.focusIndex !== previous.focusIndex || state.entries !== previous.entries) {
      rememberFolder(state.dir, state.entries[state.focusIndex]?.path ?? null);
    }
  });

  // Turning a feature off also forgets what it kept.
  const stopSettings = useSettings.subscribe((state, previous) => {
    if (!state.reopenLastFolder && previous.reopenLastFolder) {
      rememberFolder(null, null);
    }
    if (state.resumeMinSeconds === 0 && previous.resumeMinSeconds !== 0) {
      forgetAllPositions();
    }
  });

  let lastSavedAt = 0;
  const stopPlayer = usePlayer.subscribe((state, previous) => {
    const minDuration = useSettings.getState().resumeMinSeconds;
    if (minDuration === 0) {
      return;
    }
    // Switching tracks: keep where the previous one was left, unless it played to its end.
    const before = previous.track;
    if (before && before.path !== state.track?.path && previous.status.voiceId === before.voiceId) {
      const finished = previous.status.endedVoiceId === before.voiceId;
      if (previous.status.duration >= minDuration && !finished) {
        savePosition(before.path, previous.status.position, previous.status.duration);
      }
    }

    const { track, status } = state;
    if (!track || status.voiceId !== track.voiceId || status.duration < minDuration) {
      return;
    }
    if (status.endedVoiceId === track.voiceId) {
      savePosition(track.path, status.duration, status.duration);
      return;
    }
    const now = performance.now();
    if (status.state === "playing" && now - lastSavedAt < saveEveryMs) {
      return;
    }
    lastSavedAt = now;
    savePosition(track.path, status.position, status.duration);
  });

  return () => {
    setStartResolver(null);
    stopFolder();
    stopSettings();
    stopPlayer();
  };
}
