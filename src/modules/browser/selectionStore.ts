import { create } from "zustand";
import { pathKey } from "../../core/paths";
import type { BrowserEntry } from "./entries";

/**
 * Multi-selection in the visible list, separate from the focus (the cursor). Keys are `pathKey`s,
 * so a live reload that rebuilds the entries keeps the selection.
 */
interface SelectionState {
  selected: ReadonlySet<string>;
  /** Where a Shift range starts: the last item clicked or toggled without Shift. */
  anchor: number | null;
  clear: () => void;
  toggle: (entries: BrowserEntry[], index: number) => void;
  selectRange: (entries: BrowserEntry[], from: number, to: number) => void;
  selectAll: (entries: BrowserEntry[]) => void;
}

export const useSelection = create<SelectionState>()((set, get) => ({
  selected: new Set(),
  anchor: null,

  clear: () => {
    if (get().selected.size > 0 || get().anchor !== null) {
      set({ selected: new Set(), anchor: null });
    }
  },

  toggle: (entries, index) => {
    const entry = entries[index];
    if (!entry || !selectable(entry)) {
      return;
    }
    const selected = new Set(get().selected);
    const key = pathKey(entry.path);
    if (selected.has(key)) {
      selected.delete(key);
    } else {
      selected.add(key);
    }
    set({ selected, anchor: index });
  },

  selectRange: (entries, from, to) => {
    const selected = new Set<string>();
    for (let index = Math.min(from, to); index <= Math.max(from, to); index++) {
      const entry = entries[index];
      if (entry && selectable(entry)) {
        selected.add(pathKey(entry.path));
      }
    }
    set({ selected, anchor: from });
  },

  selectAll: (entries) => {
    set({ selected: new Set(entries.filter(selectable).map((entry) => pathKey(entry.path))), anchor: null });
  },
}));

/** The ".." row is navigation, not a file: it is never part of a selection. */
function selectable(entry: BrowserEntry): boolean {
  return entry.kind !== "parent";
}

/** Selected entries in list order; entries that vanished from the list are skipped. */
export function selectedEntries(entries: BrowserEntry[], selected: ReadonlySet<string>): BrowserEntry[] {
  return entries.filter((entry) => selected.has(pathKey(entry.path)));
}
