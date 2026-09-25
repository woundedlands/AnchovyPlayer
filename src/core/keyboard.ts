import { jumpToName, useBrowser } from "../modules/browser/browserStore";
import { useSearch } from "../modules/browser/searchStore";
import { usePlayer } from "../modules/player/playerStore";
import { activate, focusByUser, leaveSearch, playEntry, visibleList } from "./flow";
import { searchInput, useUi } from "./uiStore";

const pageSize = 10;
const seekStepSeconds = 5;
const fineSeekStepSeconds = 1;

/** One handler for the whole window; the active zone decides what the arrow keys do. */
export function handleKey(event: KeyboardEvent) {
  const inSearch = event.target === searchInput.current;
  // The path bar and other fields own their keys.
  if (!inSearch && event.target instanceof HTMLInputElement) {
    return;
  }
  if (handleGlobalKey(event, inSearch)) {
    event.preventDefault();
  }
}

function handleGlobalKey(event: KeyboardEvent, inSearch: boolean): boolean {
  const ctrl = event.ctrlKey || event.metaKey;
  const { zone, setZone } = useUi.getState();
  const player = usePlayer.getState();

  if (ctrl && event.code === "KeyF") {
    searchInput.current?.focus();
    searchInput.current?.select();
    return true;
  }
  if (ctrl && event.code === "KeyR") {
    // Also keeps the webview from reloading, which is Ctrl+R's default.
    player.cycleRepeat();
    return true;
  }
  if (event.key === "Escape" && useSearch.getState().active) {
    leaveSearch();
    return true;
  }
  if (inSearch) {
    // Typing goes into the field; only list navigation keys are taken over.
    const navigation = ["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Enter"];
    return navigation.includes(event.key) && handleBrowserKey(event);
  }
  if (event.key === "Tab") {
    setZone(zone === "browser" ? "player" : "browser");
    return true;
  }
  if (event.key === " ") {
    const { entries, focusIndex } = visibleList();
    const focused = entries[focusIndex];
    if (!player.track && focused?.kind === "audio") {
      playEntry(focused, entries);
    } else {
      player.togglePause();
    }
    return true;
  }
  if (zone === "player" && handlePlayerKey(event)) {
    return true;
  }
  if (zone === "browser" && handleBrowserKey(event)) {
    return true;
  }
  if (event.key.length === 1 && !ctrl && !event.altKey) {
    // Jump to name: letters always drive the file list, whichever zone was active.
    setZone("browser");
    const { entries, focusIndex } = visibleList();
    const index = jumpToName(event.key, entries, focusIndex);
    if (index !== null) {
      focusByUser(index, false);
    }
    return true;
  }

  return false;
}

function handleBrowserKey(event: KeyboardEvent): boolean {
  const { entries, focusIndex, searching } = visibleList();
  switch (event.key) {
    case "ArrowDown":
      focusByUser(focusIndex + 1, false);
      return true;
    case "ArrowUp":
      focusByUser(focusIndex - 1, false);
      return true;
    case "PageDown":
      focusByUser(focusIndex + pageSize, false);
      return true;
    case "PageUp":
      focusByUser(focusIndex - pageSize, false);
      return true;
    case "Home":
      focusByUser(0, false);
      return true;
    case "End":
      focusByUser(entries.length - 1, false);
      return true;
    case "ArrowRight":
    case "Enter":
      activate(focusIndex);
      return true;
    case "ArrowLeft":
    case "Backspace":
      if (searching) {
        leaveSearch();
      } else {
        useBrowser.getState().goUp();
      }
      return true;
  }

  return false;
}

function handlePlayerKey(event: KeyboardEvent): boolean {
  const player = usePlayer.getState();
  const step = event.shiftKey ? fineSeekStepSeconds : seekStepSeconds;
  switch (event.key) {
    case "ArrowLeft":
      player.seekBy(-step);
      return true;
    case "ArrowRight":
      player.seekBy(step);
      return true;
    case "ArrowUp":
      player.previous();
      return true;
    case "ArrowDown":
      player.next();
      return true;
    case "Enter":
      player.togglePause();
      return true;
  }

  return false;
}
