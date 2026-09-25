import { create } from "zustand";
import { parentOf, samePath } from "../../core/paths";
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
  /** Files played since this folder was opened; shown dimmed. Reset when another folder opens. */
  played: ReadonlySet<string>;
  /** Resolves to the new listing, or null if it failed or a newer navigation superseded it. */
  open: (path: string | null, focusPath?: string) => Promise<BrowserEntry[] | null>;
  goUp: () => void;
  setFocus: (index: number) => void;
  markPlayed: (path: string) => void;
}

let latestRequest = 0;
let jump = { prefix: "", at: 0 };

export const useBrowser = create<BrowserState>()((set, get) => ({
  dir: null,
  entries: [],
  focusIndex: 0,
  error: null,
  played: new Set(),

  open: async (path, focusPath) => {
    const request = ++latestRequest;
    try {
      const items =
        path === null
          ? (await listRoots()).map((root) => ({ name: root, path: root, isDir: true }))
          : await listDir(path);
      // A slow listing must not overwrite the folder the user has already moved on to.
      if (request !== latestRequest) {
        return null;
      }
      const next = toBrowserEntries(items);
      if (path !== null) {
        next.unshift({ name: parentLabel, path: parentOf(path) ?? "", kind: "parent", label: parentLabel });
      }
      const focused = focusPath === undefined ? -1 : next.findIndex((entry) => samePath(entry.path, focusPath));
      // Without a remembered item, start on the first real entry rather than on "..".
      const firstReal = next.length > 1 && next[0].kind === "parent" ? 1 : 0;
      const current = get().dir;
      const sameFolder = current !== null && path !== null && samePath(current, path);
      set({
        dir: path,
        entries: next,
        focusIndex: focused >= 0 && next[focused].kind !== "parent" ? focused : firstReal,
        error: null,
        played: sameFolder ? get().played : new Set(),
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

  setFocus: (index) => set({ focusIndex: clampIndex(index, get().entries.length) }),

  markPlayed: (path) => {
    const played = get().played;
    if (!played.has(path)) {
      set({ played: new Set(played).add(path) });
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

export function clampIndex(index: number, count: number): number {
  return count === 0 ? 0 : Math.min(Math.max(index, 0), count - 1);
}

// Holds session-wide subscriptions: a hot-swapped copy would run next to the old one (two players
// reacting to every event). Edits to this module reload the page instead.
import.meta.hot?.accept(() => window.location.reload());
