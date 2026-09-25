// File operations from the context menu and their shortcuts. They act on the selection when the
// row is part of it, otherwise on the row alone - the same rule as Explorer.

import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  clipboardClear,
  clipboardGetFiles,
  clipboardSetFiles,
  renameEntry,
  transferEntries,
  trashEntries,
} from "../modules/browser/api";
import { useBrowser } from "../modules/browser/browserStore";
import type { BrowserEntry } from "../modules/browser/entries";
import { selectedEntries, useSelection } from "../modules/browser/selectionStore";
import { setVisibleFocus, visibleList } from "./flow";
import { pathKey } from "./paths";
import { t } from "./i18n";
import { useUi } from "./uiStore";

/** What an action on `index` applies to: the selection if the row is in it, else the row. */
export function actionTargets(index: number | null): BrowserEntry[] {
  const { entries } = visibleList();
  const entry = index === null ? undefined : entries[index];
  if (!entry || entry.kind === "parent") {
    return [];
  }
  const { selected } = useSelection.getState();
  if (selected.has(pathKey(entry.path))) {
    return selectedEntries(entries, selected);
  }

  return [entry];
}

/** Right click: a row outside the selection becomes the target on its own, as in Explorer. */
export function openContextMenu(index: number | null, x: number, y: number) {
  if (index !== null) {
    const { entries } = visibleList();
    const entry = entries[index];
    const { selected, clear } = useSelection.getState();
    if (entry && !selected.has(pathKey(entry.path))) {
      clear();
    }
    setVisibleFocus(index);
  }
  useUi.getState().openMenu({ x, y, index });
}

function report(error: unknown) {
  useUi.getState().notify(String(error), true);
}

export async function copyToClipboard(index: number | null, cut: boolean) {
  const targets = actionTargets(index);
  if (targets.length === 0) {
    return;
  }
  try {
    await clipboardSetFiles(
      targets.map((entry) => entry.path),
      cut,
    );
    useUi.getState().notify(cut ? t().noticeCut(targets.length) : t().noticeCopied(targets.length));
  } catch (error) {
    report(error);
  }
}

export async function copyPaths(index: number | null) {
  const targets = actionTargets(index);
  if (targets.length === 0) {
    return;
  }
  await navigator.clipboard.writeText(targets.map((entry) => entry.path).join("\n"));
  useUi.getState().notify(t().noticePathsCopied(targets.length));
}

/** Pastes files from the clipboard (ours or Explorer's) into the open folder. */
export async function pasteIntoFolder() {
  const dir = useBrowser.getState().dir;
  if (dir === null) {
    return;
  }
  try {
    const { paths, cut } = await clipboardGetFiles();
    if (paths.length === 0) {
      return;
    }
    const created = await transferEntries(paths, dir, cut);
    if (cut) {
      await clipboardClear();
    }
    if (created.length > 0) {
      await useBrowser.getState().open(dir, created[0]);
    }
    useUi.getState().notify(cut ? t().noticeMoved(created.length) : t().noticePasted(created.length));
  } catch (error) {
    report(error);
  }
}

/** Sends the targets to the recycle bin and keeps the cursor on the neighbour that remains. */
export async function trashTargets(index: number | null) {
  const targets = actionTargets(index);
  if (targets.length === 0) {
    return;
  }
  const { entries } = visibleList();
  const removed = new Set(targets.map((entry) => pathKey(entry.path)));
  const lastIndex = Math.max(...targets.map((entry) => entries.indexOf(entry)));
  const survivor =
    entries.slice(lastIndex + 1).find((entry) => !removed.has(pathKey(entry.path))) ??
    entries
      .slice(0, lastIndex)
      .reverse()
      .find((entry) => !removed.has(pathKey(entry.path)) && entry.kind !== "parent");
  try {
    await trashEntries(targets.map((entry) => entry.path));
    useSelection.getState().clear();
    const dir = useBrowser.getState().dir;
    await useBrowser.getState().open(dir, survivor?.path);
    useUi.getState().notify(t().noticeTrashed(targets.length));
  } catch (error) {
    report(error);
  }
}

export function startRename(index: number | null) {
  const targets = actionTargets(index);
  // Several files cannot share one new name; renaming works on the row under the cursor.
  const { entries, focusIndex } = visibleList();
  const entry = targets.length === 1 ? targets[0] : entries[index ?? focusIndex];
  if (!entry || entry.kind === "parent") {
    return;
  }
  useUi.getState().setRenaming(pathKey(entry.path));
}

export async function commitRename(entry: BrowserEntry, newName: string) {
  useUi.getState().setRenaming(null);
  if (newName.trim() === "" || newName.trim() === entry.name) {
    return;
  }
  try {
    const renamed = await renameEntry(entry.path, newName);
    await useBrowser.getState().open(useBrowser.getState().dir, renamed);
  } catch (error) {
    report(error);
  }
}

export function revealInExplorer(index: number | null) {
  const target = actionTargets(index)[0];
  const path = target?.path ?? useBrowser.getState().dir;
  if (path) {
    revealItemInDir(path).catch(report);
  }
}

/** The name without the extension, so renaming starts with just that part selected, as in Explorer. */
export function renameSelectionEnd(name: string, isDir: boolean): number {
  const dot = name.lastIndexOf(".");

  return isDir || dot <= 0 ? name.length : dot;
}

