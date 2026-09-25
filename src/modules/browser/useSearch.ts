import { useCallback, useRef, useState } from "react";
import { walk } from "./api";
import { classify, type BrowserEntry } from "./entries";
import { fuzzyScore } from "./fuzzy";
import { clampIndex } from "./useBrowser";

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

export interface SearchController {
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

export function useSearch(): SearchController {
  const [query, setQueryState] = useState("");
  const [active, setActive] = useState(false);
  const [results, setResults] = useState<BrowserEntry[]>([]);
  const [focusIndex, setFocusIndex] = useState(0);
  const [indexing, setIndexing] = useState(false);
  const [partial, setPartial] = useState(false);
  const index = useRef<SearchIndex | null>(null);
  const latestQuery = useRef("");

  const ensureIndex = useCallback(async (root: string): Promise<SearchIndex> => {
    const cached = index.current;
    if (cached && cached.root === root && Date.now() - cached.builtAt < indexTtlMs) {
      return cached;
    }
    setIndexing(true);
    try {
      const walked = await walk(root, walkLimit);
      const entries: BrowserEntry[] = [];
      for (const item of walked) {
        const name = item.relative.slice(item.relative.lastIndexOf("/") + 1);
        const kind = classify(name, item.isDir);
        if (kind !== null) {
          entries.push({ name, path: item.path, kind, label: item.relative });
        }
      }
      index.current = { root, builtAt: Date.now(), entries, partial: walked.length >= walkLimit };

      return index.current;
    } finally {
      setIndexing(false);
    }
  }, []);

  const setQuery = useCallback(
    (next: string, root: string | null) => {
      latestQuery.current = next;
      setQueryState(next);
      setActive(true);
      setFocusIndex(0);
      if (next.trim() === "" || root === null) {
        setResults([]);
        return;
      }
      void ensureIndex(root).then((built) => {
        if (latestQuery.current !== next) {
          return;
        }
        const scored: { entry: BrowserEntry; score: number }[] = [];
        for (const entry of built.entries) {
          const score = fuzzyScore(next, entry.label);
          if (score !== null) {
            scored.push({ entry, score });
          }
        }
        scored.sort((a, b) => b.score - a.score);
        setResults(scored.slice(0, resultLimit).map((item) => item.entry));
        setPartial(built.partial);
      });
    },
    [ensureIndex],
  );

  const resultsCount = useRef(0);
  resultsCount.current = results.length;
  const setFocus = useCallback((next: number) => setFocusIndex(clampIndex(next, resultsCount.current)), []);

  const close = useCallback(() => {
    latestQuery.current = "";
    setActive(false);
    setQueryState("");
    setResults([]);
  }, []);

  return { active, query, results, focusIndex, indexing, partial, setQuery, setFocus, close };
}
