import { useEffect, useRef } from "react";
import { Text } from "@mantine/core";
import { useVirtualizer } from "@tanstack/react-virtual";
import { pathKey, samePath } from "../../core/paths";
import type { BrowserEntry } from "./entries";
import { FileRow } from "./FileRow";
import classes from "./FileList.module.css";

const rowHeight = 46;

interface FileListProps {
  /** Identity of what is listed (folder or search); a new one starts scrolled to the top. */
  listKey: string;
  entries: BrowserEntry[];
  focusIndex: number;
  zoneActive: boolean;
  currentPath: string | null;
  playing: boolean;
  /** `pathKey`s of files played this session; shown slightly dimmed. */
  played: ReadonlySet<string>;
  /** `pathKey`s of the selection (the group). */
  selected: ReadonlySet<string>;
  emptyText: string;
  onPress: (index: number, modifiers: { ctrl: boolean; shift: boolean }) => void;
  getDragPaths: (index: number) => string[];
  /** `index` is null for the empty space around the rows. */
  onContextMenu: (index: number | null, x: number, y: number) => void;
  /** `pathKey` of the row being renamed in place. */
  renamingKey: string | null;
  onRenameDone: (index: number, newName: string | null) => void;
  onActivate: (index: number) => void;
  onPlay: (index: number) => void;
}

export function FileList({
  listKey,
  entries,
  focusIndex,
  zoneActive,
  currentPath,
  playing,
  played,
  selected,
  emptyText,
  onPress,
  getDragPaths,
  onContextMenu,
  renamingKey,
  onRenameDone,
  onActivate,
  onPlay,
}: FileListProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => rowHeight,
    overscan: 12,
  });

  const shownKey = useRef(listKey);
  useEffect(() => {
    // A live reload of the same folder keeps the scroll position; another folder starts at the top.
    if (shownKey.current !== listKey) {
      shownKey.current = listKey;
      virtualizer.scrollToOffset(0);
    }
    if (entries.length > 0) {
      virtualizer.scrollToIndex(focusIndex, { align: "auto" });
    }
  }, [listKey, focusIndex, entries, virtualizer]);

  if (entries.length === 0) {
    return (
      <div
        className={classes.empty}
        onContextMenu={(event) => {
          event.preventDefault();
          onContextMenu(null, event.clientX, event.clientY);
        }}
      >
        <Text c="dimmed">{emptyText}</Text>
      </div>
    );
  }

  return (
    <div
      ref={scroller}
      className={classes.scroller}
      onContextMenu={(event) => {
        event.preventDefault();
        onContextMenu(null, event.clientX, event.clientY);
      }}
    >
      <div className={classes.content} style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const entry = entries[item.index];
          const current = currentPath !== null && samePath(entry.path, currentPath);
          const key = pathKey(entry.path);

          return (
            <div
              key={entry.path}
              className={classes.item}
              style={{ height: item.size, transform: `translateY(${item.start}px)` }}
            >
              <FileRow
                entry={entry}
                focused={item.index === focusIndex}
                zoneActive={zoneActive}
                current={current}
                playing={current && playing}
                played={played.has(key)}
                selected={selected.has(key)}
                onPress={(modifiers) => onPress(item.index, modifiers)}
                getDragPaths={() => getDragPaths(item.index)}
                onContextMenu={(x, y) => onContextMenu(item.index, x, y)}
                renaming={renamingKey === key}
                onRenameDone={(newName) => onRenameDone(item.index, newName)}
                onActivate={() => onActivate(item.index)}
                onPlay={() => onPlay(item.index)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
