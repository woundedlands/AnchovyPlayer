import { useRef } from "react";
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
  onFocus: () => void;
  onActivate: () => void;
  onPlay: () => void;
}

export function FileRow({
  entry,
  focused,
  zoneActive,
  current,
  playing,
  onFocus,
  onActivate,
  onPlay,
}: FileRowProps) {
  const press = useRef<{ x: number; y: number } | null>(null);

  const beginDragOut = () => {
    dragIcon ??= dragIconPath();
    void dragIcon.then((icon) => startDrag({ item: [entry.path], icon }));
  };

  return (
    <div
      className={classes.row}
      data-focused={focused || undefined}
      data-zone-active={zoneActive || undefined}
      data-current={current || undefined}
      data-kind={entry.kind}
      onPointerDown={(event) => {
        if (event.button !== 0) {
          return;
        }
        press.current = { x: event.clientX, y: event.clientY };
        onFocus();
      }}
      onPointerMove={(event) => {
        const start = press.current;
        if (!start || entry.kind === "unsupported" || entry.kind === "parent") {
          return;
        }
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > dragThresholdPx) {
          press.current = null;
          beginDragOut();
        }
      }}
      onPointerUp={() => {
        press.current = null;
      }}
      onDoubleClick={onActivate}
    >
      <span className={classes.icon}>
        <EntryIcon entry={entry} />
      </span>
      <span className={classes.name}>{entry.label}</span>
      {entry.kind === "audio" && (
        <>
          <span className={classes.extension}>{extensionOf(entry.name)}</span>
          <ActionIcon
            className={classes.play}
            variant={current ? "filled" : "subtle"}
            radius="xl"
            size="md"
            aria-label={`Play ${entry.name}`}
            onPointerDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onClick={onPlay}
          >
            {current && playing ? <IconPlayerPauseFilled size={14} /> : <IconPlayerPlayFilled size={14} />}
          </ActionIcon>
        </>
      )}
      {entry.kind === "unsupported" && <span className={classes.extension}>not supported</span>}
    </div>
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
