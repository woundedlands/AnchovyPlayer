// Flow that crosses modules: what focusing, activating and playing an entry means for the browser,
// the search and the player together. Module stores stay unaware of each other; this file wires them.

import { audioDir } from "@tauri-apps/api/path";
import { launchPath, onOpenPath } from "../modules/browser/api";
import { clampIndex, useBrowser, watchOpenFolder } from "../modules/browser/browserStore";
import { classify, type BrowserEntry } from "../modules/browser/entries";
import { useSearch } from "../modules/browser/searchStore";
import { prefetch } from "../modules/player/api";
import { connectPlayer, usePlayer } from "../modules/player/playerStore";
import { nameOf, parentOf, samePath } from "./paths";
import { useSettings } from "./settingsStore";
import { searchInput, useUi } from "./uiStore";

/** Files on each side of the cursor decoded ahead of time. */
const prefetchRadius = 6;

interface VisibleList {
  entries: BrowserEntry[];
  focusIndex: number;
  searching: boolean;
}

/** The list on screen: search results while a query is typed, otherwise the folder. */
export function visibleList(): VisibleList {
  const search = useSearch.getState();
  const browser = useBrowser.getState();
  const searching = search.active && search.query.trim() !== "";

  return searching
    ? { entries: search.results, focusIndex: search.focusIndex, searching }
    : { entries: browser.entries, focusIndex: browser.focusIndex, searching };
}

/** React-side selector with the same meaning as `visibleList`. */
export function useVisibleList(): VisibleList {
  const searching = useSearch((state) => state.active && state.query.trim() !== "");
  const results = useSearch((state) => state.results);
  const searchFocus = useSearch((state) => state.focusIndex);
  const entries = useBrowser((state) => state.entries);
  const browserFocus = useBrowser((state) => state.focusIndex);

  return searching
    ? { entries: results, focusIndex: searchFocus, searching }
    : { entries, focusIndex: browserFocus, searching };
}

function setVisibleFocus(index: number) {
  if (visibleList().searching) {
    useSearch.getState().setFocus(index);
  } else {
    useBrowser.getState().setFocus(index);
  }
}

export function playEntry(entry: BrowserEntry, from: BrowserEntry[]) {
  if (entry.kind !== "audio") {
    return;
  }
  const playlist = from.filter((item) => item.kind === "audio").map((item) => item.path);
  void usePlayer.getState().playFile(entry.path, playlist);
}

/** Focus moved by the user (click or arrows): this is what "play on focus" reacts to. */
export function focusByUser(index: number, replayIfSame: boolean) {
  const { entries, focusIndex } = visibleList();
  const target = clampIndex(index, entries.length);
  if (target === focusIndex && !replayIfSame) {
    return;
  }
  setVisibleFocus(target);
  const entry = entries[target];
  if (useSettings.getState().playOnFocus && entry?.kind === "audio") {
    playEntry(entry, entries);
  }
}

export function activate(index: number) {
  const { entries } = visibleList();
  const entry = entries[index];
  if (!entry) {
    return;
  }
  if (entry.kind === "parent") {
    useBrowser.getState().goUp();
  } else if (entry.kind === "dir") {
    useSearch.getState().close();
    void useBrowser.getState().open(entry.path);
  } else {
    playEntry(entry, entries);
  }
}

/** The play button of a row: toggles pause on the current track, otherwise plays that row. */
export function playFromRow(index: number) {
  const { entries } = visibleList();
  const entry = entries[index];
  const { track, status, togglePause } = usePlayer.getState();
  if (entry && track && samePath(track.path, entry.path) && status.state !== "idle") {
    togglePause();
    return;
  }
  setVisibleFocus(index);
  activate(index);
}

export function leaveSearch() {
  useSearch.getState().close();
  searchInput.current?.blur();
  useUi.getState().setZone("browser");
}

/** Opens a folder, or an audio file's folder with that file focused and playing. */
export async function openPath(path: string, focusPath?: string) {
  useSearch.getState().close();
  const { open } = useBrowser.getState();
  if (classify(nameOf(path), false) === "audio") {
    const entries = await open(parentOf(path), path);
    const entry = entries?.find((item) => samePath(item.path, path));
    if (entry && entries) {
      playEntry(entry, entries);
    }
    return;
  }
  await open(path, focusPath);
}

function prefetchAroundFocus() {
  const { entries, focusIndex } = visibleList();
  const paths: string[] = [];
  for (let distance = 0; distance <= prefetchRadius; distance++) {
    for (const index of distance === 0 ? [focusIndex] : [focusIndex + distance, focusIndex - distance]) {
      const entry = entries[index];
      if (entry?.kind === "audio") {
        paths.push(entry.path);
      }
    }
  }
  void prefetch(paths);
}

/** Starts everything that lives for the whole session. Returns the cleanup. */
export function startApp(): () => void {
  const stopPlayer = connectPlayer();
  const stopWatching = watchOpenFolder();
  const stopOpenPath = onOpenPath((path) => void openPath(path));

  const stopTrack = usePlayer.subscribe((state, previous) => {
    if (state.track && state.track.path !== previous.track?.path) {
      useBrowser.getState().markPlayed(state.track.path);
    }
    // Next/previous and repeat-folder moved on: keep the cursor on what plays if it is in view.
    if (state.advance && state.advance !== previous.advance) {
      const advancedPath = state.advance.path;
      const index = visibleList().entries.findIndex((entry) => samePath(entry.path, advancedPath));
      if (index >= 0) {
        setVisibleFocus(index);
      }
    }
  });

  const stopBrowserPrefetch = useBrowser.subscribe((state, previous) => {
    if (state.entries !== previous.entries || state.focusIndex !== previous.focusIndex) {
      prefetchAroundFocus();
    }
  });
  const stopSearchPrefetch = useSearch.subscribe((state, previous) => {
    if (state.results !== previous.results || state.focusIndex !== previous.focusIndex) {
      prefetchAroundFocus();
    }
  });

  // Start where the app was pointed ("Open with", a path argument), otherwise in the Music folder.
  void (async () => {
    const launched = await launchPath();
    if (launched) {
      await openPath(launched);
      return;
    }
    const music = await audioDir().catch(() => null);
    const opened = music ? await useBrowser.getState().open(music) : null;
    if (opened === null && useBrowser.getState().dir === null) {
      await useBrowser.getState().open(null);
    }
  })();

  return () => {
    stopPlayer();
    stopTrack();
    stopBrowserPrefetch();
    stopSearchPrefetch();
    void stopWatching.then((stop) => stop());
    void stopOpenPath.then((stop) => stop());
  };
}

// Holds session-wide subscriptions: a hot-swapped copy would run next to the old one (two players
// reacting to every event). Edits to this module reload the page instead.
import.meta.hot?.accept(() => window.location.reload());
