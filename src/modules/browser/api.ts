import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modifiedMs: number;
}

export interface WalkEntry {
  path: string;
  relative: string;
  isDir: boolean;
}

export interface FolderChanged {
  dir: string;
  paths: string[];
}

export const listDir = (path: string) => invoke<DirEntry[]>("list_dir", { path });

export const listRoots = () => invoke<string[]>("list_roots");

export const walk = (root: string, limit: number) => invoke<WalkEntry[]>("walk", { root, limit });

export const watchDir = (path: string) => invoke<void>("watch_dir", { path });

export const launchPath = () => invoke<string | null>("launch_path");

export const dragIconPath = () => invoke<string>("drag_icon_path");

export const onFolderChanged = (handler: (change: FolderChanged) => void): Promise<UnlistenFn> =>
  listen<FolderChanged>("folder-changed", (event) => handler(event.payload));

export const onOpenPath = (handler: (path: string) => void): Promise<UnlistenFn> =>
  listen<string>("open-path", (event) => handler(event.payload));

export interface ClipboardFiles {
  paths: string[];
  /** Cut rather than copied: pasting moves the files. */
  cut: boolean;
}

/** Returns the new path. */
export const renameEntry = (path: string, newName: string) => invoke<string>("rename_entry", { path, newName });

export const trashEntries = (paths: string[]) => invoke<void>("trash_entries", { paths });

/** Copies, or moves when `removeSource`; returns the created paths. */
export const transferEntries = (sources: string[], destDir: string, removeSource: boolean) =>
  invoke<string[]>("transfer_entries", { sources, destDir, removeSource });

export const clipboardSetFiles = (paths: string[], cut: boolean) => invoke<void>("clipboard_set_files", { paths, cut });

export const clipboardGetFiles = () => invoke<ClipboardFiles>("clipboard_get_files");

export const clipboardClear = () => invoke<void>("clipboard_clear");
