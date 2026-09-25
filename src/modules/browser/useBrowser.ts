import { useCallback, useEffect, useRef, useState } from "react";
import { parentOf, samePath } from "../../core/paths";
import { listDir, listRoots, onFolderChanged, watchDir } from "./api";
import { toBrowserEntries, type BrowserEntry } from "./entries";

const parentLabel = "..";

/** Typed characters within this window extend the jump-to-name prefix; after it a new prefix starts. */
const jumpWindowMs = 1000;

export interface BrowserController {
  /** Current folder, or null for the list of drives / roots. */
  dir: string | null;
  entries: BrowserEntry[];
  focusIndex: number;
  error: string | null;
  /** Resolves to the new listing, or null if it failed or a newer navigation superseded it. */
  open: (path: string | null, focusPath?: string) => Promise<BrowserEntry[] | null>;
  goUp: () => void;
  setFocus: (index: number) => void;
  /** Index in `list` that the typed character jumps to, or null when nothing matches. */
  jumpToName: (char: string, list: BrowserEntry[], focusIndex: number) => number | null;
}

export function useBrowser(): BrowserController {
  const [dir, setDir] = useState<string | null>(null);
  const [entries, setEntries] = useState<BrowserEntry[]>([]);
  const [focusIndex, setFocusIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const latestRequest = useRef(0);
  const state = useRef({ dir, entries, focusIndex });
  state.current = { dir, entries, focusIndex };
  const jump = useRef({ prefix: "", at: 0 });

  const open = useCallback(async (path: string | null, focusPath?: string): Promise<BrowserEntry[] | null> => {
    const request = ++latestRequest.current;
    try {
      const items =
        path === null
          ? (await listRoots()).map((root) => ({ name: root, path: root, isDir: true }))
          : await listDir(path);
      // A slow listing must not overwrite the folder the user has already moved on to.
      if (request !== latestRequest.current) {
        return null;
      }
      const next = toBrowserEntries(items);
      if (path !== null) {
        next.unshift({ name: parentLabel, path: parentOf(path) ?? "", kind: "parent", label: parentLabel });
      }
      const focused = focusPath === undefined ? -1 : next.findIndex((entry) => samePath(entry.path, focusPath));
      // Without a remembered item, start on the first real entry rather than on "..".
      const firstReal = next.length > 1 && next[0].kind === "parent" ? 1 : 0;
      setDir(path);
      setEntries(next);
      setFocusIndex(focused >= 0 && next[focused].kind !== "parent" ? focused : firstReal);
      setError(null);
      if (path !== null) {
        watchDir(path).catch((watchError) => console.warn(`Live reload is off for ${path}: ${watchError}`));
      }

      return next;
    } catch (openError) {
      if (request === latestRequest.current) {
        setError(String(openError));
      }

      return null;
    }
  }, []);

  const goUp = useCallback(() => {
    const current = state.current.dir;
    if (current === null) {
      return;
    }
    // Land on the folder we came out of, like every file manager does.
    void open(parentOf(current), current);
  }, [open]);

  const setFocus = useCallback((index: number) => {
    const count = state.current.entries.length;
    setFocusIndex(clampIndex(index, count));
  }, []);

  // Live reload: re-list the folder when something in it changes, keeping the cursor on the same item.
  useEffect(() => {
    const unlisten = onFolderChanged((change) => {
      const { dir: current, entries: currentEntries, focusIndex: currentFocus } = state.current;
      if (current !== null && samePath(change.dir, current)) {
        void open(current, currentEntries[currentFocus]?.path);
      }
    });

    return () => {
      void unlisten.then((stop) => stop());
    };
  }, [open]);

  const jumpToName = useCallback((char: string, list: BrowserEntry[], focusIndex: number): number | null => {
    const now = Date.now();
    const typed = char.toLowerCase();
    const expired = now - jump.current.at > jumpWindowMs;
    const prefix = expired ? typed : jump.current.prefix + typed;
    jump.current = { prefix, at: now };
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
  }, []);

  return { dir, entries, focusIndex, error, open, goUp, setFocus, jumpToName };
}

export function clampIndex(index: number, count: number): number {
  return count === 0 ? 0 : Math.min(Math.max(index, 0), count - 1);
}
