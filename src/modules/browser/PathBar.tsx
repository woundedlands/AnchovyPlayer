import { useLayoutEffect, useRef, useState } from "react";
import { ActionIcon, TextInput, Tooltip, UnstyledButton } from "@mantine/core";
import { IconArrowUp, IconChevronRight, IconDeviceDesktop } from "@tabler/icons-react";
import { useElementSize } from "@mantine/hooks";
import { joinSegments, nameOf, parentOf, separatorOf, splitPath } from "../../core/paths";
import { listDir } from "./api";
import classes from "./PathBar.module.css";

interface PathBarProps {
  dir: string | null;
  onNavigate: (path: string | null) => void;
  onUp: () => void;
  /** Called when editing ends, so keyboard control returns to the list. */
  onDone: () => void;
}

/**
 * Breadcrumbs like Windows Explorer: click a segment to go there, click the empty space to type a raw path.
 * Leading segments that do not fit collapse into "…", so the current folder always stays readable.
 */
export function PathBar({ dir, onNavigate, onUp, onDone }: PathBarProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [hiddenCount, setHiddenCount] = useState(0);
  const { ref: crumbsFrame, width } = useElementSize();
  const crumbs = useRef<HTMLDivElement | null>(null);

  const startEditing = () => {
    setDraft(dir ?? "");
    setEditing(true);
  };

  const finish = (navigateTo?: string) => {
    setEditing(false);
    if (navigateTo !== undefined && navigateTo.trim() !== "") {
      onNavigate(navigateTo.trim());
    }
    onDone();
  };

  const complete = async () => {
    const completed = await completeFolder(draft);
    if (completed !== null) {
      setDraft(completed);
    }
  };

  const segments = dir === null ? [] : splitPath(dir);

  // Re-measure from scratch when the path or the available width changes.
  useLayoutEffect(() => {
    setHiddenCount(0);
  }, [dir, width]);

  // Hide one more leading segment per pass until the rest fits; always keep the current folder.
  useLayoutEffect(() => {
    const element = crumbs.current;
    if (element && element.scrollWidth > element.clientWidth && hiddenCount < segments.length - 1) {
      setHiddenCount(hiddenCount + 1);
    }
  });

  return (
    <div className={classes.root}>
      <Tooltip label="Parent folder · Left">
        <ActionIcon variant="subtle" color="gray" size="lg" radius="md" onClick={onUp} disabled={dir === null}>
          <IconArrowUp size={20} />
        </ActionIcon>
      </Tooltip>

      {editing ? (
        <TextInput
          className={classes.input}
          autoFocus
          value={draft}
          spellCheck={false}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onFocus={(event) => event.currentTarget.select()}
          onBlur={() => finish()}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") {
              finish(draft);
            } else if (event.key === "Escape") {
              finish();
            } else if (event.key === "Tab") {
              event.preventDefault();
              void complete();
            }
          }}
        />
      ) : (
        <div
          ref={(element) => {
            crumbs.current = element;
            crumbsFrame(element);
          }}
          className={classes.crumbs}
          onClick={startEditing}
          title="Click to type a path"
        >
          <UnstyledButton
            className={classes.crumb}
            onClick={(event) => {
              event.stopPropagation();
              onNavigate(null);
            }}
          >
            <IconDeviceDesktop size={18} />
          </UnstyledButton>
          {hiddenCount > 0 && (
            <span className={classes.segment}>
              <IconChevronRight size={14} className={classes.chevron} />
              <span className={classes.crumb}>…</span>
            </span>
          )}
          {segments.map((segment, index) => index >= hiddenCount && (
            <span key={index} className={classes.segment}>
              <IconChevronRight size={14} className={classes.chevron} />
              <UnstyledButton
                className={classes.crumb}
                data-last={index === segments.length - 1 || undefined}
                onClick={(event) => {
                  event.stopPropagation();
                  onNavigate(joinSegments(segments.slice(0, index + 1)));
                }}
              >
                {segment}
              </UnstyledButton>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Completes the last segment to the first folder starting with it, or to the folders' common prefix. */
async function completeFolder(draft: string): Promise<string | null> {
  const endsWithSeparator = /[\\/]$/.test(draft);
  const base = endsWithSeparator ? draft : parentOf(draft);
  if (base === null) {
    return null;
  }
  const typed = endsWithSeparator ? "" : nameOf(draft).toLowerCase();
  try {
    const folders = (await listDir(base))
      .filter((entry) => entry.isDir && entry.name.toLowerCase().startsWith(typed))
      .map((entry) => entry.name);
    if (folders.length === 0) {
      return null;
    }
    const separator = separatorOf(base);
    const prefix = folders.length === 1 ? folders[0] + separator : commonPrefix(folders);
    const trimmedBase = base.replace(/[\\/]+$/, "");

    return `${trimmedBase}${separator}${prefix}`;
  } catch {
    return null;
  }
}

function commonPrefix(names: string[]): string {
  let prefix = names[0];
  for (const name of names) {
    while (!name.toLowerCase().startsWith(prefix.toLowerCase())) {
      prefix = prefix.slice(0, -1);
    }
  }

  return prefix;
}
