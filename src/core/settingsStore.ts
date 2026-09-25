import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

export type RepeatMode = "off" | "current" | "folder";
export type ColorSchemeSetting = "auto" | "light" | "dark";

export const repeatModes: RepeatMode[] = ["off", "current", "folder"];
const colorSchemes: ColorSchemeSetting[] = ["auto", "light", "dark"];

/** Pause between repeats and folder advances. Without it 50 ms clips turn into a machine gun. */
export const trackGapOptions = [0, 250, 500, 1000];

export const maxVolume = 2;

/**
 * Everything written to settings.json. Only user preferences belong here - never the last folder
 * or cursor position, which the app deliberately forgets.
 */
export interface Settings {
  playOnFocus: boolean;
  repeat: RepeatMode;
  shuffle: boolean;
  volume: number;
  trackGapMs: number;
  colorScheme: ColorSchemeSetting;
}

/**
 * Bump when a field changes meaning or shape, and handle the old version in `parseSettings`.
 * Adding or removing a field needs no bump: unknown fields are dropped, missing ones get defaults.
 */
const settingsVersion = 1;
const saveDelayMs = 300;

const defaults: Settings = {
  playOnFocus: true,
  repeat: "off",
  shuffle: false,
  volume: 1,
  trackGapMs: 500,
  colorScheme: "auto",
};

interface SettingsState extends Settings {
  update: (changes: Partial<Settings>) => void;
}

export const useSettings = create<SettingsState>()((set) => ({
  ...defaults,
  update: (changes) => set(changes),
}));

/** Reads settings.json before the first render, so the UI never flashes defaults. */
export async function loadSettings(): Promise<void> {
  try {
    const raw = await invoke<string | null>("load_settings");
    if (raw !== null) {
      useSettings.setState(parseSettings(JSON.parse(raw)));
    }
  } catch (error) {
    // A broken file must not keep the app from starting; it is overwritten on the next change.
    console.error(`settings.json ignored: ${error}`);
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  useSettings.subscribe(() => {
    clearTimeout(timer);
    timer = setTimeout(() => void saveSettings(), saveDelayMs);
  });
}

async function saveSettings(): Promise<void> {
  const state = useSettings.getState();
  const file: Settings & { version: number } = {
    version: settingsVersion,
    playOnFocus: state.playOnFocus,
    repeat: state.repeat,
    shuffle: state.shuffle,
    volume: state.volume,
    trackGapMs: state.trackGapMs,
    colorScheme: state.colorScheme,
  };
  try {
    await invoke("save_settings", { contents: JSON.stringify(file, null, 2) });
  } catch (error) {
    console.error(`Saving settings failed: ${error}`);
  }
}

/** Field by field: a wrong or missing value falls back to its default instead of breaking the rest. */
function parseSettings(raw: unknown): Settings {
  const source = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const volume = source.volume;

  return {
    playOnFocus: typeof source.playOnFocus === "boolean" ? source.playOnFocus : defaults.playOnFocus,
    repeat: oneOf(source.repeat, repeatModes, defaults.repeat),
    shuffle: typeof source.shuffle === "boolean" ? source.shuffle : defaults.shuffle,
    volume: typeof volume === "number" && volume >= 0 && volume <= maxVolume ? volume : defaults.volume,
    trackGapMs: oneOf(source.trackGapMs, trackGapOptions, defaults.trackGapMs),
    colorScheme: oneOf(source.colorScheme, colorSchemes, defaults.colorScheme),
  };
}

function oneOf<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

// Holds session-wide subscriptions: a hot-swapped copy would run next to the old one (two players
// reacting to every event). Edits to this module reload the page instead.
import.meta.hot?.accept(() => window.location.reload());
