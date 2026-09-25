import { useCallback, useEffect, useRef, useState } from "react";
import { Kbd, Loader, Text, TextInput } from "@mantine/core";
import { IconSearch } from "@tabler/icons-react";
import { audioDir } from "@tauri-apps/api/path";
import { launchPath, onOpenPath } from "../modules/browser/api";
import { classify, type BrowserEntry } from "../modules/browser/entries";
import { FileList } from "../modules/browser/FileList";
import { PathBar } from "../modules/browser/PathBar";
import { clampIndex, useBrowser } from "../modules/browser/useBrowser";
import { useSearch } from "../modules/browser/useSearch";
import { PlayerBar, volumeWheelStep } from "../modules/player/PlayerBar";
import { usePlayer } from "../modules/player/usePlayer";
import { nameOf, parentOf, samePath } from "./paths";
import { SettingsMenu } from "./SettingsMenu";
import { useSettings } from "./useSettings";
import classes from "./App.module.css";

/** Which part of the window the arrow keys drive. */
type Zone = "browser" | "player";

const pageSize = 10;
/** Files on each side of the cursor decoded ahead of time. */
const prefetchRadius = 6;
const seekStepSeconds = 5;
const fineSeekStepSeconds = 1;

export function App() {
  const settings = useSettings();
  const browser = useBrowser();
  const search = useSearch();
  const [zone, setZone] = useState<Zone>("browser");
  const searchInput = useRef<HTMLInputElement>(null);

  const searching = search.active && search.query.trim() !== "";
  const list = searching ? search.results : browser.entries;
  const focusIndex = searching ? search.focusIndex : browser.focusIndex;
  const setListFocus = searching ? search.setFocus : browser.setFocus;
  const listRef = useRef(list);
  listRef.current = list;

  const player = usePlayer(settings, (path) => {
    // Repeat-folder moved on: keep the cursor on what is playing if it is in view.
    const index = listRef.current.findIndex((entry) => samePath(entry.path, path));
    if (index >= 0) {
      setListFocus(index);
    }
  });
  const playing = player.status.state === "playing";
  const { prefetchPaths } = player;

  const playEntry = useCallback(
    (entry: BrowserEntry, from: BrowserEntry[]) => {
      if (entry.kind !== "audio") {
        return;
      }
      const playlist = from.filter((item) => item.kind === "audio").map((item) => item.path);
      void player.playFile(entry.path, playlist);
    },
    [player],
  );

  const openPath = useCallback(
    async (path: string) => {
      search.close();
      if (classify(nameOf(path), false) === "audio") {
        const entries = await browser.open(parentOf(path), path);
        const entry = entries?.find((item) => samePath(item.path, path));
        if (entry && entries) {
          playEntry(entry, entries);
        }
        return;
      }
      await browser.open(path);
    },
    [browser, search, playEntry],
  );

  // Start where the app was pointed ("Open with", a path argument), otherwise in the Music folder.
  const started = useRef(false);
  useEffect(() => {
    const unlisten = onOpenPath((path) => void openPath(path));
    // StrictMode runs effects twice in development; a second start would cancel the first listing.
    if (started.current) {
      return () => {
        void unlisten.then((stop) => stop());
      };
    }
    started.current = true;
    void (async () => {
      const launched = await launchPath();
      if (launched) {
        await openPath(launched);
        return;
      }
      const music = await audioDir().catch(() => null);
      const opened = music ? await browser.open(music) : null;
      if (opened === null) {
        await browser.open(null);
      }
    })();

    return () => {
      void unlisten.then((stop) => stop());
    };
    // Runs once: later "Open with" calls arrive through the event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Decode what the user is likely to play next, nearest first.
  useEffect(() => {
    const paths: string[] = [];
    for (let distance = 0; distance <= prefetchRadius; distance++) {
      for (const index of distance === 0 ? [focusIndex] : [focusIndex + distance, focusIndex - distance]) {
        const entry = list[index];
        if (entry?.kind === "audio") {
          paths.push(entry.path);
        }
      }
    }
    void prefetchPaths(paths);
  }, [list, focusIndex, prefetchPaths]);

  /** Focus moved by the user (click or arrows): this is what "play on focus" reacts to. */
  const focusByUser = useCallback(
    (index: number, replayIfSame: boolean) => {
      const target = clampIndex(index, list.length);
      if (target === focusIndex && !replayIfSame) {
        return;
      }
      setListFocus(target);
      const entry = list[target];
      if (settings.playOnFocus && entry?.kind === "audio") {
        playEntry(entry, list);
      }
    },
    [list, focusIndex, setListFocus, settings.playOnFocus, playEntry],
  );

  const activate = useCallback(
    (index: number) => {
      const entry = list[index];
      if (!entry) {
        return;
      }
      if (entry.kind === "parent") {
        browser.goUp();
      } else if (entry.kind === "dir") {
        search.close();
        void browser.open(entry.path);
      } else {
        playEntry(entry, list);
      }
    },
    [list, search, browser, playEntry],
  );

  const playFromRow = useCallback(
    (index: number) => {
      const entry = list[index];
      if (entry && player.track && samePath(player.track.path, entry.path) && player.status.state !== "idle") {
        player.togglePause();
        return;
      }
      setListFocus(index);
      activate(index);
    },
    [list, player, setListFocus, activate],
  );

  const leaveSearch = useCallback(() => {
    search.close();
    searchInput.current?.blur();
    setZone("browser");
  }, [search]);

  const handleBrowserKey = (event: KeyboardEvent): boolean => {
    switch (event.key) {
      case "ArrowDown":
        focusByUser(focusIndex + 1, false);
        return true;
      case "ArrowUp":
        focusByUser(focusIndex - 1, false);
        return true;
      case "PageDown":
        focusByUser(focusIndex + pageSize, false);
        return true;
      case "PageUp":
        focusByUser(focusIndex - pageSize, false);
        return true;
      case "Home":
        focusByUser(0, false);
        return true;
      case "End":
        focusByUser(list.length - 1, false);
        return true;
      case "ArrowRight":
      case "Enter":
        activate(focusIndex);
        return true;
      case "ArrowLeft":
      case "Backspace":
        if (searching) {
          leaveSearch();
        } else {
          browser.goUp();
        }
        return true;
    }

    return false;
  };

  const handlePlayerKey = (event: KeyboardEvent): boolean => {
    const step = event.shiftKey ? fineSeekStepSeconds : seekStepSeconds;
    switch (event.key) {
      case "ArrowLeft":
        player.seekBy(-step);
        return true;
      case "ArrowRight":
        player.seekBy(step);
        return true;
      case "ArrowUp":
        player.changeVolume(volumeWheelStep);
        return true;
      case "ArrowDown":
        player.changeVolume(-volumeWheelStep);
        return true;
      case "Enter":
        player.togglePause();
        return true;
    }

    return false;
  };

  const handleKey = (event: KeyboardEvent) => {
    const inSearch = event.target === searchInput.current;
    const inOtherInput = !inSearch && event.target instanceof HTMLInputElement;
    if (inOtherInput) {
      return;
    }
    const ctrl = event.ctrlKey || event.metaKey;

    if (ctrl && event.code === "KeyF") {
      searchInput.current?.focus();
      searchInput.current?.select();
    } else if (ctrl && event.code === "KeyR") {
      // Also keeps the webview from reloading, which is Ctrl+R's default.
      player.cycleRepeat();
    } else if (event.key === "Escape" && search.active) {
      leaveSearch();
    } else if (inSearch) {
      // Typing goes into the field; only list navigation keys are taken over.
      const navigation = ["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Enter"];
      if (!navigation.includes(event.key) || !handleBrowserKey(event)) {
        return;
      }
    } else if (event.key === "Tab") {
      setZone(zone === "browser" ? "player" : "browser");
    } else if (event.key === " ") {
      const focused = list[focusIndex];
      if (!player.track && focused?.kind === "audio") {
        playEntry(focused, list);
      } else {
        player.togglePause();
      }
    } else if (zone === "player" && handlePlayerKey(event)) {
      // handled
    } else if (zone === "browser" && handleBrowserKey(event)) {
      // handled
    } else if (event.key.length === 1 && !ctrl && !event.altKey) {
      // Jump to name: letters always drive the file list, whichever zone was active.
      setZone("browser");
      const index = browser.jumpToName(event.key, list, focusIndex);
      if (index !== null) {
        focusByUser(index, false);
      }
    } else {
      return;
    }
    event.preventDefault();
  };
  const keyHandler = useRef(handleKey);
  keyHandler.current = handleKey;

  useEffect(() => {
    const listener = (event: KeyboardEvent) => keyHandler.current(event);
    window.addEventListener("keydown", listener);

    return () => window.removeEventListener("keydown", listener);
  }, []);

  const emptyText = (() => {
    if (browser.error && !searching) {
      return browser.error;
    }
    if (searching) {
      return search.indexing ? "Indexing folder…" : "No matches";
    }

    return "No audio files here";
  })();

  return (
    <div
      className={classes.app}
      onWheel={(event) => {
        // Ctrl+wheel changes volume anywhere; the plain wheel does it over the player bar.
        if (event.ctrlKey) {
          player.changeVolume(event.deltaY < 0 ? volumeWheelStep : -volumeWheelStep);
        }
      }}
    >
      <header className={classes.header}>
        <PathBar
          dir={browser.dir}
          onNavigate={(path) => (path === null ? void browser.open(null) : void openPath(path))}
          onUp={browser.goUp}
          onDone={() => setZone("browser")}
        />
        <TextInput
          ref={searchInput}
          className={classes.search}
          placeholder="Search in folder"
          leftSection={search.indexing ? <Loader size={14} /> : <IconSearch size={16} />}
          rightSection={search.active ? null : <Kbd size="xs">Ctrl F</Kbd>}
          rightSectionWidth={56}
          value={search.query}
          spellCheck={false}
          onChange={(event) => search.setQuery(event.currentTarget.value, browser.dir)}
          onFocus={() => setZone("browser")}
        />
        <SettingsMenu settings={settings} />
      </header>

      <main
        className={classes.browser}
        data-active={zone === "browser" || undefined}
        onPointerDown={() => setZone("browser")}
      >
        {searching && (
          <Text className={classes.searchInfo}>
            {search.results.length} results{search.partial ? " · folder too large, partial results" : ""} · Esc to
            close
          </Text>
        )}
        <FileList
          listKey={searching ? `search:${browser.dir}` : (browser.dir ?? "")}
          entries={list}
          focusIndex={focusIndex}
          zoneActive={zone === "browser"}
          currentPath={player.track?.path ?? null}
          playing={playing}
          emptyText={emptyText}
          onFocus={(index) => focusByUser(index, true)}
          onActivate={(index) => {
            // With play-on-focus the clicks of a double click already played the file.
            if (list[index]?.kind !== "audio" || !settings.playOnFocus) {
              activate(index);
            }
          }}
          onPlay={playFromRow}
        />
      </main>

      <PlayerBar player={player} settings={settings} active={zone === "player"} onActivate={() => setZone("player")} />
    </div>
  );
}
