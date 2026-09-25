import { create } from "zustand";
import { walk } from "./api";
import { clampIndex } from "./browserStore";
import { classify, type BrowserEntry } from "./entries";
import { fuzzyScore } from "./fuzzy";

/** A drive root can hold millions of files; the walk stops here and the UI says results are partial. */
const walkLimit = 200_000;
const resultLimit = 500;
/** A walk is reused while typing; after this it is redone so new files show up. */
const indexTtlMs = 10_000;

interface SearchIndex {
  root: string;
  builtAt: number;
  entries: BrowserEntry[];
  partial: boolean;
}

interface SearchState {
  active: boolean;
  query: string;
  results: BrowserEntry[];
  focusIndex: number;
  indexing: boolean;
  partial: boolean;
  setQuery: (query: string, root: string | null) => void;
  setFocus: (index: number) => void;
  close: () => void;
}

let index: SearchIndex | null = null;
let latestQuery = "";

export const useSearch = create<SearchState>()((set, get) => {
  const ensureIndex = async (root: string): Promise<SearchIndex> => {
    if (index && index.root === root && Date.now() - index.builtAt < indexTtlMs) {
      return index;
    }
    set({ indexing: true });
    try {
      const walked = await walk(root, walkLimit);
      const entries: BrowserEntry[] = [];
      for (const item of walked) {
        const name = item.relative.slice(item.relative.lastIndexOf("/") + 1);
        const kind = classify(name, item.isDir);
        if (kind !== null) {
          entries.push({ name, path: item.path, kind, label: item.relative, size: item.size, modifiedMs: item.modifiedMs });
        }
      }
      index = { root, builtAt: Date.now(), entries, partial: walked.length >= walkLimit };

      return index;
    } finally {
      set({ indexing: false });
    }
  };

  return {
    active: false,
    query: "",
    results: [],
    focusIndex: 0,
    indexing: false,
    partial: false,

    setQuery: (query, root) => {
      latestQuery = query;
      set({ query, active: true, focusIndex: 0 });
      if (query.trim() === "" || root === null) {
        set({ results: [] });
        return;
      }
      void ensureIndex(root).then((built) => {
        if (latestQuery !== query) {
          return;
        }
        const scored: { entry: BrowserEntry; score: number }[] = [];
        for (const entry of built.entries) {
          const score = fuzzyScore(query, entry.label);
          if (score !== null) {
            scored.push({ entry, score });
          }
        }
        scored.sort((a, b) => b.score - a.score);
        set({ results: scored.slice(0, resultLimit).map((item) => item.entry), partial: built.partial });
      });
    },

    setFocus: (next) => set({ focusIndex: clampIndex(next, get().results.length) }),

    close: () => {
      latestQuery = "";
      set({ active: false, query: "", results: [] });
    },
  };
});

// Holds session-wide subscriptions: a hot-swapped copy would run next to the old one (two players
// reacting to every event). Edits to this module reload the page instead.
import.meta.hot?.accept(() => window.location.reload());
