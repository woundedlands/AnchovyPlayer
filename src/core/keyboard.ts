import { jumpToName, useBrowser } from "../modules/browser/browserStore";
import { useSearch } from "../modules/browser/searchStore";
import { usePlayer } from "../modules/player/playerStore";
import { useSelection } from "../modules/browser/selectionStore";
import {
  activate,
  extendSelectionTo,
  focusByUser,
  leaveSearch,
  selectAllVisible,
  toggleFocusedInSelection,
  togglePlayback,
  visibleList,
} from "./flow";
import { copyPaths, copyToClipboard, pasteIntoFolder, startRename, trashTargets } from "./fileActions";
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

  // Explorer's history keys; Alt+arrows are taken before the zones see the arrows.
  if ((event.altKey && event.key === "ArrowLeft") || event.key === "BrowserBack") {
    useBrowser.getState().goBack();
    return true;
  }
  if ((event.altKey && event.key === "ArrowRight") || event.key === "BrowserForward") {
    useBrowser.getState().goForward();
    return true;
  }
  if (ctrl && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
    player.stepVolume(event.key === "ArrowUp" ? 1 : -1);
    return true;
  }
  if (ctrl && event.code === "KeyM") {
    player.toggleMute();
    return true;
  }
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
  if (event.key === "Escape" && useSelection.getState().selected.size > 0) {
    useSelection.getState().clear();
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
  if (handleFileKey(event, ctrl)) {
    return true;
  }
  if (ctrl && event.code === "KeyA") {
    setZone("browser");
    selectAllVisible();
    return true;
  }
  if (ctrl && event.key === " ") {
    toggleFocusedInSelection();
    return true;
  }
  if (event.key === "Tab") {
    setZone(zone === "browser" ? "player" : "browser");
    return true;
  }
  if (event.key === " ") {
    togglePlayback();
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
  const target = navigationTarget(event.key, focusIndex, entries.length);
  if (target !== null) {
    // Shift extends the selection; plain moves keep it, so a group survives browsing around it.
    if (event.shiftKey) {
      extendSelectionTo(target);
    } else {
      focusByUser(target, false);
    }
    return true;
  }
  switch (event.key) {
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

/** The mouse's side buttons (3 back, 4 forward) walk the folder history, as in Explorer. */
export function handleMouseButton(event: MouseEvent) {
  // The WebView's own default for these buttons is page history, which would reload the app.
  if (event.button === 3 || event.button === 4) {
    event.preventDefault();
  }
  if (event.type !== "mouseup") {
    return;
  }
  if (event.button === 3) {
    event.preventDefault();
    useBrowser.getState().goBack();
  } else if (event.button === 4) {
    event.preventDefault();
    useBrowser.getState().goForward();
  }
}

/** Explorer's file shortcuts, acting on the selection or the focused row. */
function handleFileKey(event: KeyboardEvent, ctrl: boolean): boolean {
  const { focusIndex } = visibleList();
  if (event.key === "F2") {
    startRename(focusIndex);
    return true;
  }
  if (event.key === "Delete") {
    void trashTargets(focusIndex);
    return true;
  }
  if (!ctrl) {
    return false;
  }
  switch (event.code) {
    case "KeyC":
      if (event.shiftKey) {
        void copyPaths(focusIndex);
      } else {
        void copyToClipboard(focusIndex, false);
      }
      return true;
    case "KeyX":
      void copyToClipboard(focusIndex, true);
      return true;
    case "KeyV":
      void pasteIntoFolder();
      return true;
  }

  return false;
}

function navigationTarget(key: string, focusIndex: number, count: number): number | null {
  switch (key) {
    case "ArrowDown":
      return focusIndex + 1;
    case "ArrowUp":
      return focusIndex - 1;
    case "PageDown":
      return focusIndex + pageSize;
    case "PageUp":
      return focusIndex - pageSize;
    case "Home":
      return 0;
    case "End":
      return count - 1;
  }

  return null;
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
      togglePlayback();
      return true;
  }

  return false;
}
