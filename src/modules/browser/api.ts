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
