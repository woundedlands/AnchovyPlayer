import { useEffect, useRef } from "react";
import { ActionIcon } from "@mantine/core";
import {
  IconArrowBackUp,
  IconFileAlert,
  IconFolderFilled,
  IconMusic,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
} from "@tabler/icons-react";
import { startDrag } from "@crabnebula/tauri-plugin-drag";
import { extensionOf } from "../../core/paths";
import { useT } from "../../core/i18n";
import { dragIconPath } from "./api";
import type { BrowserEntry } from "./entries";
import classes from "./FileRow.module.css";

/** Pointer travel before a press becomes a drag-out, so a slightly shaky click still clicks. */
const dragThresholdPx = 6;

let dragIcon: Promise<string> | null = null;

interface FileRowProps {
  entry: BrowserEntry;
  focused: boolean;
  zoneActive: boolean;
  current: boolean;
  playing: boolean;
  played: boolean;
  selected: boolean;
  onPress: (modifiers: { ctrl: boolean; shift: boolean }) => void;
  /** Files a drag starting on this row carries: the selection if the row is in it. */
  getDragPaths: () => string[];
  onContextMenu: (x: number, y: number) => void;
  /** Shows an inline name editor instead of the name. */
  renaming: boolean;
  onRenameDone: (newName: string | null) => void;
  onActivate: () => void;
  onPlay: () => void;
}

export function FileRow({
  entry,
  focused,
  zoneActive,
  current,
  playing,
  played,
  selected,
  onPress,
  getDragPaths,
  onContextMenu,
  renaming,
  onRenameDone,
  onActivate,
  onPlay,
}: FileRowProps) {
  const t = useT();
  const press = useRef<{ x: number; y: number; deferred: boolean } | null>(null);

  const beginDragOut = () => {
    const paths = getDragPaths();
    dragIcon ??= dragIconPath();
    void dragIcon.then((icon) => startDrag({ item: paths, icon }));
  };

  return (
    <div
      className={classes.row}
      data-focused={focused || undefined}
      data-zone-active={zoneActive || undefined}
      data-current={current || undefined}
      data-played={played || undefined}
      data-selected={selected || undefined}
      data-kind={entry.kind}
      onPointerDown={(event) => {
        if (event.button !== 0) {
          return;
        }
        const modifiers = { ctrl: event.ctrlKey || event.metaKey, shift: event.shiftKey };
        // A plain press on a selected row may be the start of dragging the whole selection, so the
        // selection is only replaced on release - as in Explorer.
        const deferred = selected && !modifiers.ctrl && !modifiers.shift;
        press.current = { x: event.clientX, y: event.clientY, deferred };
        if (!deferred) {
          onPress(modifiers);
        }
      }}
      onPointerMove={(event) => {
        const start = press.current;
        if (!start || entry.kind === "parent") {
          return;
        }
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > dragThresholdPx) {
          press.current = null;
          beginDragOut();
        }
      }}
      onPointerUp={() => {
        if (press.current?.deferred) {
          onPress({ ctrl: false, shift: false });
        }
        press.current = null;
      }}
      onDoubleClick={onActivate}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onContextMenu(event.clientX, event.clientY);
      }}
    >
      {/* The file icon turns into the play button in the same spot when the row is hovered,
          focused or playing - where the pointer already is, without a second column. */}
      <span className={classes.lead}>
        <span className={classes.icon}>
          <EntryIcon entry={entry} />
        </span>
        {entry.kind === "audio" && (
          <ActionIcon
            className={classes.play}
            variant={current ? "filled" : "subtle"}
            radius="xl"
            size="md"
            aria-label={t.playFile(entry.name)}
            onPointerDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onClick={onPlay}
          >
            {current && playing ? <IconPlayerPauseFilled size={14} /> : <IconPlayerPlayFilled size={14} />}
          </ActionIcon>
        )}
      </span>
      {renaming ? (
        <RenameInput entry={entry} onDone={onRenameDone} />
      ) : (
        <span className={classes.name}>{entry.label}</span>
      )}
      {entry.kind === "audio" && <span className={classes.extension}>{extensionOf(entry.name)}</span>}
      {entry.kind === "unsupported" && <span className={classes.extension}>{t.notSupported}</span>}
    </div>
  );
}

/** Explorer-style: the name without its extension starts selected; Enter or leaving commits, Esc cancels. */
function RenameInput({ entry, onDone }: { entry: BrowserEntry; onDone: (newName: string | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const finished = useRef(false);

  useEffect(() => {
    const element = input.current;
    if (!element) {
      return;
    }
    element.focus();
    const dot = entry.name.lastIndexOf(".");
    element.setSelectionRange(0, entry.kind === "dir" || dot <= 0 ? entry.name.length : dot);
  }, [entry]);

  const finish = (newName: string | null) => {
    if (!finished.current) {
      finished.current = true;
      onDone(newName);
    }
  };

  return (
    <input
      ref={input}
      className={classes.renameInput}
      defaultValue={entry.name}
      spellCheck={false}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          finish(event.currentTarget.value);
        } else if (event.key === "Escape") {
          finish(null);
        }
      }}
      onBlur={(event) => finish(event.currentTarget.value)}
    />
  );
}

function EntryIcon({ entry }: { entry: BrowserEntry }) {
  if (entry.kind === "parent") {
    return <IconArrowBackUp size={20} />;
  }
  if (entry.kind === "dir") {
    return <IconFolderFilled size={20} />;
  }
  if (entry.kind === "unsupported") {
    return <IconFileAlert size={20} />;
  }

  return <IconMusic size={20} />;
}
