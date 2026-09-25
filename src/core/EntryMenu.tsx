import { useEffect, useState } from "react";
import { Menu, Text } from "@mantine/core";
import {
  IconClipboard,
  IconCopy,
  IconCursorText,
  IconFolderOpen,
  IconFolderSearch,
  IconLink,
  IconPlayerPlayFilled,
  IconScissors,
  IconTrash,
} from "@tabler/icons-react";
import { clipboardGetFiles } from "../modules/browser/api";
import {
  actionTargets,
  copyPaths,
  copyToClipboard,
  pasteIntoFolder,
  revealInExplorer,
  startRename,
  trashTargets,
} from "./fileActions";
import { activate, playFromRow } from "./flow";
import { useT } from "./i18n";
import { useUi } from "./uiStore";

/** The right-click menu of the file list, opened at the cursor. */
export function EntryMenu() {
  const menu = useUi((state) => state.menu);
  const closeMenu = useUi((state) => state.closeMenu);
  const [canPaste, setCanPaste] = useState(false);
  const t = useT();

  useEffect(() => {
    if (!menu) {
      return;
    }
    let cancelled = false;
    clipboardGetFiles()
      .then((files) => !cancelled && setCanPaste(files.paths.length > 0))
      .catch(() => !cancelled && setCanPaste(false));

    return () => {
      cancelled = true;
    };
  }, [menu]);

  if (!menu) {
    return null;
  }
  const targets = actionTargets(menu.index);
  const single = targets.length === 1 ? targets[0] : null;
  const index = menu.index;

  return (
    <Menu opened onChange={(opened) => !opened && closeMenu()} position="bottom-start" offset={2} width={230} shadow="md">
      <Menu.Target>
        <div style={{ position: "fixed", left: menu.x, top: menu.y, width: 1, height: 1 }} />
      </Menu.Target>
      <Menu.Dropdown>
        {single?.kind === "audio" && index !== null && (
          <Menu.Item leftSection={<IconPlayerPlayFilled size={16} />} onClick={() => playFromRow(index)}>
            {t.menuPlay}
          </Menu.Item>
        )}
        {single?.kind === "dir" && index !== null && (
          <Menu.Item leftSection={<IconFolderOpen size={16} />} onClick={() => activate(index)}>
            {t.menuOpen}
          </Menu.Item>
        )}
        {targets.length > 0 && (
          <>
            {single && <Menu.Divider />}
            <Menu.Item leftSection={<IconScissors size={16} />} rightSection={<Shortcut keys="Ctrl X" />} onClick={() => void copyToClipboard(index, true)}>
              {t.menuCut}
            </Menu.Item>
            <Menu.Item leftSection={<IconCopy size={16} />} rightSection={<Shortcut keys="Ctrl C" />} onClick={() => void copyToClipboard(index, false)}>
              {t.menuCopy}
            </Menu.Item>
          </>
        )}
        <Menu.Item
          leftSection={<IconClipboard size={16} />}
          rightSection={<Shortcut keys="Ctrl V" />}
          disabled={!canPaste}
          onClick={() => void pasteIntoFolder()}
        >
          {t.menuPaste}
        </Menu.Item>
        {targets.length > 0 && (
          <>
            <Menu.Item leftSection={<IconLink size={16} />} rightSection={<Shortcut keys="Ctrl Shift C" />} onClick={() => void copyPaths(index)}>
              {t.menuCopyPath(targets.length)}
            </Menu.Item>
            <Menu.Divider />
            <Menu.Item leftSection={<IconCursorText size={16} />} rightSection={<Shortcut keys="F2" />} disabled={!single} onClick={() => startRename(index)}>
              {t.menuRename}
            </Menu.Item>
            <Menu.Item leftSection={<IconTrash size={16} />} rightSection={<Shortcut keys="Del" />} color="red" onClick={() => void trashTargets(index)}>
              {t.menuDelete(targets.length)}
            </Menu.Item>
          </>
        )}
        <Menu.Divider />
        <Menu.Item leftSection={<IconFolderSearch size={16} />} onClick={() => revealInExplorer(index)}>
          {t.menuReveal}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

function Shortcut({ keys }: { keys: string }) {
  return (
    <Text size="xs" c="dimmed">
      {keys}
    </Text>
  );
}
