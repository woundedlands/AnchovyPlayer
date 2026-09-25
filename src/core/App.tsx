import { useEffect } from "react";
import { Kbd, Loader, Text, TextInput } from "@mantine/core";
import { IconSearch } from "@tabler/icons-react";
import { useBrowser } from "../modules/browser/browserStore";
import { FileList } from "../modules/browser/FileList";
import { PathBar } from "../modules/browser/PathBar";
import { useSearch } from "../modules/browser/searchStore";
import { PlayerBar, volumeWheelStep } from "../modules/player/PlayerBar";
import { usePlayer } from "../modules/player/playerStore";
import { activate, focusByUser, openPath, playFromRow, startApp, togglePlayback, useVisibleList } from "./flow";
import { handleKey } from "./keyboard";
import { SettingsMenu } from "./SettingsMenu";
import { useSettings } from "./settingsStore";
import { searchInput, useUi } from "./uiStore";
import classes from "./App.module.css";

export function App() {
  const zone = useUi((state) => state.zone);
  const setZone = useUi((state) => state.setZone);
  const dir = useBrowser((state) => state.dir);
  const error = useBrowser((state) => state.error);
  const played = useBrowser((state) => state.played);
  const search = useSearch();
  const currentPath = usePlayer((state) => state.track?.path ?? null);
  const playing = usePlayer((state) => state.status.state === "playing");
  const playOnFocus = useSettings((state) => state.playOnFocus);
  const { entries, focusIndex, searching } = useVisibleList();

  useEffect(() => startApp(), []);

  useEffect(() => {
    window.addEventListener("keydown", handleKey);

    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  const emptyText = (() => {
    if (error && !searching) {
      return error;
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
          usePlayer.getState().changeVolume(event.deltaY < 0 ? volumeWheelStep : -volumeWheelStep);
        }
      }}
    >
      <header className={classes.header}>
        <PathBar
          dir={dir}
          onNavigate={(path, focusPath) =>
            path === null ? void useBrowser.getState().open(null, focusPath) : void openPath(path, focusPath)
          }
          onUp={() => useBrowser.getState().goUp()}
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
          onChange={(event) => search.setQuery(event.currentTarget.value, dir)}
          onFocus={() => setZone("browser")}
        />
        <SettingsMenu />
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
          listKey={searching ? `search:${dir}` : (dir ?? "")}
          entries={entries}
          focusIndex={focusIndex}
          zoneActive={zone === "browser"}
          currentPath={currentPath}
          playing={playing}
          played={played}
          emptyText={emptyText}
          onFocus={(index) => focusByUser(index, true)}
          onActivate={(index) => {
            // With play-on-focus the clicks of a double click already played the file.
            if (entries[index]?.kind !== "audio" || !playOnFocus) {
              activate(index);
            }
          }}
          onPlay={playFromRow}
        />
      </main>

      <PlayerBar active={zone === "player"} onActivate={() => setZone("player")} onTogglePlay={togglePlayback} />
    </div>
  );
}
