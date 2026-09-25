import { extensionOf } from "../../core/paths";

/** `parent` is the ".." row at the top of every folder except the roots list. */
export type EntryKind = "parent" | "dir" | "audio" | "unsupported";

export interface BrowserEntry {
  name: string;
  path: string;
  kind: EntryKind;
  /** Shown instead of the name in search results: the path below the search root. */
  label: string;
  /** Bytes and modification time; with the path they identify one version of the file. */
  size: number;
  modifiedMs: number;
}

// What the Rust decoder can play. Keep in sync with dev.md "Formats" and with the Explorer
// registration in src-tauri/windows/installer-hooks.nsh.
const playableExtensions = new Set([
  "wav", "wave", "aif", "aiff", "aifc", "caf",
  "mp3", "mp2", "mp1",
  "ogg", "oga", "opus",
  "flac",
  "m4a", "m4b", "mp4", "aac",
  "mka", "webm",
]);

// Audio we recognise but cannot decode: listed and marked, so a library does not look like it is missing files.
const unsupportedAudioExtensions = new Set(["wma", "ape", "wv", "mid", "midi", "ac3", "dts", "amr", "ra", "tta", "mpc"]);

/** Everything that is neither a folder nor audio is not shown at all. */
export function classify(name: string, isDir: boolean): EntryKind | null {
  if (isDir) {
    return "dir";
  }
  const extension = extensionOf(name);
  if (playableExtensions.has(extension)) {
    return "audio";
  }
  if (unsupportedAudioExtensions.has(extension)) {
    return "unsupported";
  }

  return null;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Folders first, then natural order: "kick 2" before "kick 10". */
export function compareEntries(a: BrowserEntry, b: BrowserEntry): number {
  const aIsDir = a.kind === "dir" ? 0 : 1;
  const bIsDir = b.kind === "dir" ? 0 : 1;
  if (aIsDir !== bIsDir) {
    return aIsDir - bIsDir;
  }

  return collator.compare(a.name, b.name);
}

export function toBrowserEntries(
  items: { name: string; path: string; isDir: boolean; size: number; modifiedMs: number }[],
): BrowserEntry[] {
  const entries: BrowserEntry[] = [];
  for (const item of items) {
    const kind = classify(item.name, item.isDir);
    if (kind !== null) {
      entries.push({ name: item.name, path: item.path, kind, label: item.name, size: item.size, modifiedMs: item.modifiedMs });
    }
  }

  return entries.sort(compareEntries);
}
