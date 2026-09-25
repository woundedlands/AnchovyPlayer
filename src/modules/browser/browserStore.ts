import { create } from "zustand";
import { parentOf, pathKey, samePath } from "../../core/paths";
import { listDir, listRoots, onFolderChanged, watchDir } from "./api";
import { toBrowserEntries, type BrowserEntry } from "./entries";

/** Typed characters within this window extend the jump-to-name prefix; after it a new prefix starts. */
const jumpWindowMs = 1000;
const parentLabel = "..";

interface BrowserState {
  /** Current folder, or null for the list of drives / roots. */
  dir: string | null;
  entries: BrowserEntry[];
  focusIndex: number;
  error: string | null;
  /** `pathKey`s of files played this session; shown dimmed. Kept in memory only, never saved. */
  played: ReadonlySet<string>;
  /** Explorer-style history: folders left behind, and those left by going back. */
  back: HistoryPlace[];
  forward: HistoryPlace[];
  /**
   * Resolves to the new listing, or null if it failed or a newer navigation superseded it.
   * Moving to another folder records the one left in the back history; `fromHistory` is for
   * back/forward themselves.
   */
  open: (path: string | null, focusPath?: string, fromHistory?: boolean) => Promise<BrowserEntry[] | null>;
  goUp: () => void;
  goBack: () => void;
  goForward: () => void;
  setFocus: (index: number) => void;
  markPlayed: (path: string) => void;
}

/** A folder and the item that was under the cursor, so going back lands on it. */
export interface HistoryPlace {
  dir: string | null;
  focus: string | null;
}

/** Enough to wander around a sample library; the oldest are dropped beyond it. */
const historyLimit = 100;

let latestRequest = 0;
let jump = { prefix: "", at: 0 };
/** The first listing (app start) is not a move away from anywhere. */
let openedOnce = false;

export const useBrowser = create<BrowserState>()((set, get) => ({
  dir: null,
  entries: [],
  focusIndex: 0,
  error: null,
  played: new Set(),
  back: [],
  forward: [],

  open: async (path, focusPath, fromHistory = false) => {
    const left = currentPlace(get());
    const request = ++latestRequest;
    try {
      const items =
        path === null
          ? (await listRoots()).map((root) => ({ name: root, path: root, isDir: true, size: 0, modifiedMs: 0 }))
          : await listDir(path);
      // A slow listing must not overwrite the folder the user has already moved on to.
      if (request !== latestRequest) {
        return null;
      }
      const next = toBrowserEntries(items);
      if (path !== null) {
        next.unshift({ name: parentLabel, path: parentOf(path) ?? "", kind: "parent", label: parentLabel, size: 0, modifiedMs: 0 });
      }
      const focused = focusPath === undefined ? -1 : next.findIndex((entry) => samePath(entry.path, focusPath));
      // Without a remembered item, start on the first real entry rather than on "..".
      const firstReal = next.length > 1 && next[0].kind === "parent" ? 1 : 0;
      // A live reload of the same folder is not a move; neither is a step through the history.
      const moved = openedOnce && !fromHistory && !sameDir(left.dir, path);
      openedOnce = true;
      set({
        dir: path,
        entries: next,
        focusIndex: focused >= 0 && next[focused].kind !== "parent" ? focused : firstReal,
        error: null,
        ...(moved ? { back: [...get().back, left].slice(-historyLimit), forward: [] } : {}),
      });
      if (path !== null) {
        watchDir(path).catch((watchError) => console.warn(`Live reload is off for ${path}: ${watchError}`));
      }

      return next;
    } catch (openError) {
      if (request === latestRequest) {
        set({ error: String(openError) });
      }

      return null;
    }
  },

  goUp: () => {
    const current = get().dir;
    if (current === null) {
      return;
    }
    // Land on the folder we came out of, like every file manager does.
    void get().open(parentOf(current), current);
  },

  goBack: () => {
    const { back, forward } = get();
    const target = back[back.length - 1];
    if (!target) {
      return;
    }
    const here = currentPlace(get());
    set({ back: back.slice(0, -1), forward: [...forward, here] });
    void get().open(target.dir, target.focus ?? undefined, true);
  },

  goForward: () => {
    const { back, forward } = get();
    const target = forward[forward.length - 1];
    if (!target) {
      return;
    }
    const here = currentPlace(get());
    set({ forward: forward.slice(0, -1), back: [...back, here] });
    void get().open(target.dir, target.focus ?? undefined, true);
  },

  setFocus: (index) => set({ focusIndex: clampIndex(index, get().entries.length) }),

  markPlayed: (path) => {
    const played = get().played;
    const key = pathKey(path);
    if (!played.has(key)) {
      set({ played: new Set(played).add(key) });
    }
  },
}));

/** Live reload: re-lists the open folder when something in it changes, keeping the cursor on the same item. */
export function watchOpenFolder(): Promise<() => void> {
  return onFolderChanged((change) => {
    const { dir, entries, focusIndex, open } = useBrowser.getState();
    if (dir !== null && samePath(change.dir, dir)) {
      void open(dir, entries[focusIndex]?.path);
    }
  });
}

/** Index in `list` that a typed character jumps to, or null when nothing matches. */
export function jumpToName(char: string, list: BrowserEntry[], focusIndex: number): number | null {
  const now = Date.now();
  const typed = char.toLowerCase();
  const prefix = now - jump.at > jumpWindowMs ? typed : jump.prefix + typed;
  jump = { prefix, at: now };
  if (list.length === 0) {
    return null;
  }

  // "aaa" cycles through items starting with "a"; "abc" narrows to items starting with "abc".
  const cycling = [...prefix].every((c) => c === prefix[0]);
  const needle = cycling ? prefix[0] : prefix;
  const start = cycling ? focusIndex + 1 : focusIndex;
  for (let step = 0; step < list.length; step++) {
    const index = (start + step) % list.length;
    if (list[index].label.toLowerCase().startsWith(needle)) {
      return index;
    }
  }

  return null;
}

function currentPlace(state: { dir: string | null; entries: BrowserEntry[]; focusIndex: number }): HistoryPlace {
  return { dir: state.dir, focus: state.entries[state.focusIndex]?.path ?? null };
}

function sameDir(a: string | null, b: string | null): boolean {
  return a === null || b === null ? a === b : samePath(a, b);
}

export function clampIndex(index: number, count: number): number {
  return count === 0 ? 0 : Math.min(Math.max(index, 0), count - 1);
}

// Holds session-wide subscriptions: a hot-swapped copy would run next to the old one (two players
// reacting to every event). Edits to this module reload the page instead.
import.meta.hot?.accept(() => window.location.reload());
