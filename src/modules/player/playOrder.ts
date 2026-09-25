import { samePath } from "../../core/paths";

/**
 * Next track in the playlist. Shuffle picks among tracks not yet played in this round, so a folder
 * is heard through before anything repeats. Returns null at the end when not wrapping.
 */
export function nextTrack(
  playlist: string[],
  current: string | null,
  shuffle: boolean,
  played: Set<string>,
  wrap: boolean,
): string | null {
  if (playlist.length === 0) {
    return null;
  }
  if (shuffle) {
    let candidates = playlist.filter((path) => !played.has(path) && (current === null || !samePath(path, current)));
    if (candidates.length === 0) {
      if (!wrap) {
        return null;
      }
      played.clear();
      candidates = playlist.filter((path) => current === null || !samePath(path, current));
    }
    if (candidates.length === 0) {
      return current;
    }

    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  const index = current === null ? -1 : playlist.findIndex((path) => samePath(path, current));
  if (index + 1 < playlist.length) {
    return playlist[index + 1];
  }

  return wrap ? playlist[0] : null;
}

export function previousTrack(playlist: string[], current: string | null): string | null {
  if (playlist.length === 0) {
    return null;
  }
  const index = current === null ? 0 : playlist.findIndex((path) => samePath(path, current));

  return playlist[(Math.max(index, 0) - 1 + playlist.length) % playlist.length];
}
