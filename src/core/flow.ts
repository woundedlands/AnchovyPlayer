// Flow that crosses modules: what focusing, activating and playing an entry means for the browser,
// the search and the player together. Module stores stay unaware of each other; this file wires them.

import { invoke } from "@tauri-apps/api/core";
import { audioDir } from "@tauri-apps/api/path";
import { launchPath, onOpenPath } from "../modules/browser/api";
import { clampIndex, useBrowser, watchOpenFolder } from "../modules/browser/browserStore";
import { classify, type BrowserEntry } from "../modules/browser/entries";
import { useSearch } from "../modules/browser/searchStore";
import { selectedEntries, useSelection } from "../modules/browser/selectionStore";
import { prefetch, stop } from "../modules/player/api";
import { connectPlayer, usePlayer } from "../modules/player/playerStore";
import { nameOf, parentOf, pathKey, samePath } from "./paths";
import { t } from "./i18n";
import { feedPulse, stopPulse } from "./pulse";
import { connectResume } from "./resume";
import { useSession } from "./sessionStore";
import { useSettings } from "./settingsStore";
import { searchInput, useUi } from "./uiStore";

/** The first folder is opened once per page load; StrictMode's second effect run must not redo it. */
let initialFolderOpened = false;

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

export function setVisibleFocus(index: number) {
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
  void usePlayer.getState().playFile(entry.path, groupPlaylist(from, entry));
}

/**
 * What next/previous, repeat-group and shuffle walk through: the selected audio files when the
 * track is one of them, otherwise every audio file of the list.
 */
function groupPlaylist(entries: BrowserEntry[], playing: BrowserEntry | null): string[] {
  const { selected } = useSelection.getState();
  const group = audioPaths(selectedEntries(entries, selected));
  const inGroup = playing === null || selected.has(pathKey(playing.path));

  return group.length > 0 && inGroup ? group : audioPaths(entries);
}

export interface PressModifiers {
  ctrl: boolean;
  shift: boolean;
}

/**
 * A click on a row. Plain: focus (and play, with play-on-focus), dropping the selection.
 * Ctrl toggles the row in the selection, Shift selects the range from the anchor. Modifier clicks
 * never play: picking a group must not fire every file on the way.
 */
export function pressEntry(index: number, modifiers: PressModifiers) {
  const { entries, focusIndex } = visibleList();
  const selection = useSelection.getState();
  if (modifiers.shift) {
    selection.selectRange(entries, selection.anchor ?? focusIndex, index);
    setVisibleFocus(index);
  } else if (modifiers.ctrl) {
    selection.toggle(entries, index);
    setVisibleFocus(index);
  } else {
    selection.clear();
    focusByUser(index, true);
  }
}

/** Shift+arrows: move the cursor and select from the anchor to it. */
export function extendSelectionTo(index: number) {
  const { entries, focusIndex } = visibleList();
  const target = clampIndex(index, entries.length);
  const selection = useSelection.getState();
  const anchor = selection.anchor ?? focusIndex;
  selection.selectRange(entries, anchor, target);
  setVisibleFocus(target);
}

export function toggleFocusedInSelection() {
  const { entries, focusIndex } = visibleList();
  useSelection.getState().toggle(entries, focusIndex);
}

export function selectAllVisible() {
  useSelection.getState().selectAll(visibleList().entries);
}

/** Files a drag out of the list carries: the whole selection if the row is in it, else the row. */
export function dragPaths(index: number): string[] {
  const { entries } = visibleList();
  const entry = entries[index];
  if (!entry) {
    return [];
  }
  const { selected } = useSelection.getState();
  if (selected.has(pathKey(entry.path))) {
    return selectedEntries(entries, selected).map((item) => item.path);
  }

  return [entry.path];
}

function audioPaths(entries: BrowserEntry[]): string[] {
  return entries.filter((item) => item.kind === "audio").map((item) => item.path);
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

/**
 * Play/pause for the transport button, Space and Enter. With nothing loaded yet it starts the
 * focused file - or the first audio file when a folder is focused - instead of doing nothing.
 */
export function togglePlayback() {
  const player = usePlayer.getState();
  if (player.track) {
    player.togglePause();
    return;
  }
  const { entries } = visibleList();
  const entry = cueTarget();
  if (entry) {
    setVisibleFocus(entries.indexOf(entry));
    playEntry(entry, entries);
  }
}

/** What Play starts when nothing is loaded: the focused audio file, else the first one in the list. */
function cueTarget(): BrowserEntry | undefined {
  const { entries, focusIndex } = visibleList();
  const focused = entries[focusIndex];

  return focused?.kind === "audio" ? focused : entries.find((item) => item.kind === "audio");
}

/** A click on the cued file's waveform: start it at that point. */
export function playCuedAt(seconds: number) {
  const { entries } = visibleList();
  const entry = cueTarget();
  if (entry) {
    setVisibleFocus(entries.indexOf(entry));
    void usePlayer.getState().playFile(entry.path, groupPlaylist(entries, entry), { startAt: seconds });
  }
}

/** The player bar's folder link: show the track in its folder, without playing anything. */
export function showInList(path: string) {
  useSearch.getState().close();
  void useBrowser.getState().open(parentOf(path), path);
  useUi.getState().setZone("browser");
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
      // Opened from Explorer: play it once. Repeat applies again as soon as the user plays anything.
      void usePlayer.getState().playFile(entry.path, audioPaths(entries), { oneShot: true });
    }
    return;
  }
  await open(path, focusPath);
}

function currentListIdentity(): string {
  const search = useSearch.getState();
  const searching = search.active && search.query.trim() !== "";

  return searching ? `search:${search.query}` : `dir:${useBrowser.getState().dir ?? ""}`;
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
  const stopResume = connectResume();

  // The tray menu is native; its labels follow the UI language.
  const applyTrayLabels = () => void invoke("set_tray_labels", { show: t().trayShow, quit: t().trayQuit });
  applyTrayLabels();
  const stopLanguage = useSettings.subscribe((state, previous) => {
    if (state.language !== previous.language) {
      applyTrayLabels();
    }
  });
  const stopWatching = watchOpenFolder();
  const stopOpenPath = onOpenPath((path) => {
    // The native window is brought forward by Rust; the page needs focus too, or arrows do nothing.
    window.focus();
    void openPath(path);
  });

  const stopVisualizer = usePlayer.subscribe((state, previous) => {
    if (state.status === previous.status) {
      return;
    }
    const { rowPulseIntensity, waveformPulseIntensity } = useSettings.getState();
    if (state.status.state === "playing" && (rowPulseIntensity > 0 || waveformPulseIntensity > 0)) {
      feedPulse(state.status.level);
    } else {
      stopPulse();
    }
  });

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

  // A selection belongs to one list: another folder or another search starts without one.
  // A live reload keeps it (same folder, selection is keyed by path).
  let listIdentity = currentListIdentity();
  const onListChange = () => {
    const identity = currentListIdentity();
    if (identity !== listIdentity) {
      listIdentity = identity;
      useSelection.getState().clear();
    }
  };
  const stopBrowserIdentity = useBrowser.subscribe(onListChange);
  const stopSearchIdentity = useSearch.subscribe(onListChange);

  // Selecting while something plays re-targets repeat-group and next/previous at once.
  const stopSelection = useSelection.subscribe((state, previous) => {
    const track = usePlayer.getState().track;
    if (state.selected === previous.selected || !track) {
      return;
    }
    const { entries } = visibleList();
    const playing = entries.find((entry) => samePath(entry.path, track.path));
    if (playing) {
      usePlayer.getState().setPlaylist(groupPlaylist(entries, playing));
    }
  });

  // Until something plays, the player bar previews what Play would start.
  const updateCue = () => {
    const player = usePlayer.getState();
    player.setCued(player.track ? null : (cueTarget()?.path ?? null));
  };
  const stopBrowserCue = useBrowser.subscribe(updateCue);
  const stopSearchCue = useSearch.subscribe(updateCue);

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
  // Done once: a second concurrent start would supersede the first listing, which then looks
  // failed and falls back to the drives list.
  void (async () => {
    if (initialFolderOpened) {
      return;
    }
    initialFolderOpened = true;
    // A reloaded page starts with an empty player; a voice left in the engine would play on unseen.
    await stop();
    // Read before anything opens: opening a folder overwrites the remembered one.
    const { lastFolder, lastFocus } = useSession.getState();
    const launched = await launchPath();
    if (launched) {
      await openPath(launched);
      return;
    }
    if (useSettings.getState().reopenLastFolder && lastFolder) {
      const reopened = await useBrowser.getState().open(lastFolder, lastFocus ?? undefined);
      if (reopened !== null) {
        return;
      }
    }
    const music = await audioDir().catch(() => null);
    const opened = music ? await useBrowser.getState().open(music) : null;
    if (opened === null && useBrowser.getState().dir === null) {
      await useBrowser.getState().open(null);
    }
  })();

  return () => {
    stopPlayer();
    stopResume();
    stopLanguage();
    stopVisualizer();
    stopTrack();
    stopBrowserPrefetch();
    stopSearchPrefetch();
    stopBrowserIdentity();
    stopBrowserCue();
    stopSearchCue();
    stopSearchIdentity();
    stopSelection();
    void stopWatching.then((stop) => stop());
    void stopOpenPath.then((stop) => stop());
  };
}

// Holds session-wide subscriptions: a hot-swapped copy would run next to the old one (two players
// reacting to every event). Edits to this module reload the page instead.
import.meta.hot?.accept(() => window.location.reload());
