import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { LanguageSetting } from "./i18n";
import { defaultAccent } from "./palette";

/** `group` repeats the selection, or the whole folder when nothing is selected. */
export type RepeatMode = "off" | "current" | "group";
export type ColorSchemeSetting = "auto" | "light" | "dark";

export const repeatModes: RepeatMode[] = ["off", "current", "group"];
const colorSchemes: ColorSchemeSetting[] = ["auto", "light", "dark"];
const languageSettings: LanguageSetting[] = ["auto", "en", "ru"];

/** Pause between repeats and folder advances. Without it 50 ms clips turn into a machine gun. */
export const maxTrackGapMs = 1000;
export const trackGapStepMs = 50;

export const maxVolume = 2;

export const pulseIntensityStep = 0.05;

/** Tracks at least this long continue where they were stopped; 0 turns resuming off. */
export const resumeThresholds = [0, 10, 30, 60, 300, 600];

/**
 * Everything written to settings.json: user preferences only. State the app keeps between runs
 * (last folder, resume positions) lives in session.json (sessionStore.ts).
 */
export interface Settings {
  playOnFocus: boolean;
  repeat: RepeatMode;
  shuffle: boolean;
  volume: number;
  trackGapMs: number;
  colorScheme: ColorSchemeSetting;
  /** The window's close button hides to the tray instead of quitting. */
  closeToTray: boolean;
  /** Hex colour the whole palette is derived from (see palette.ts). */
  accentColor: string;
  /** "auto" follows the system language, falling back to English. */
  language: LanguageSetting;
  /** Start in the folder (and on the file) where the last run ended. */
  reopenLastFolder: boolean;
  /** Tracks at least this long continue where they were stopped; 0 is off. One of `resumeThresholds`. */
  resumeMinSeconds: number;
  /** Visualizer strength 0..1 (0 is off): the playing row in the list glows with the music. */
  rowPulseIntensity: number;
  /** Visualizer strength 0..1 (0 is off): the waveform brightens with the music, most at the playhead. */
  waveformPulseIntensity: number;
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
  closeToTray: true,
  accentColor: defaultAccent,
  language: "auto",
  reopenLastFolder: true,
  resumeMinSeconds: 30,
  rowPulseIntensity: 0.75,
  waveformPulseIntensity: 0.75,
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

  // The close button is handled natively, so Rust needs to know the preference.
  const applyCloseToTray = () => void invoke("set_close_to_tray", { enabled: useSettings.getState().closeToTray });
  applyCloseToTray();

  let timer: ReturnType<typeof setTimeout> | undefined;
  useSettings.subscribe((state, previous) => {
    if (state.closeToTray !== previous.closeToTray) {
      applyCloseToTray();
    }
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
    closeToTray: state.closeToTray,
    accentColor: state.accentColor,
    language: state.language,
    reopenLastFolder: state.reopenLastFolder,
    resumeMinSeconds: state.resumeMinSeconds,
    rowPulseIntensity: state.rowPulseIntensity,
    waveformPulseIntensity: state.waveformPulseIntensity,
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
    // "folder" is what "group" was called before selections existed; same meaning.
    repeat: oneOf(source.repeat === "folder" ? "group" : source.repeat, repeatModes, defaults.repeat),
    shuffle: typeof source.shuffle === "boolean" ? source.shuffle : defaults.shuffle,
    volume: typeof volume === "number" && volume >= 0 && volume <= maxVolume ? volume : defaults.volume,
    trackGapMs: onGrid(source.trackGapMs, maxTrackGapMs, trackGapStepMs, defaults.trackGapMs),
    colorScheme: oneOf(source.colorScheme, colorSchemes, defaults.colorScheme),
    closeToTray: typeof source.closeToTray === "boolean" ? source.closeToTray : defaults.closeToTray,
    accentColor:
      typeof source.accentColor === "string" && /^#[0-9a-f]{6}$/i.test(source.accentColor)
        ? source.accentColor.toLowerCase()
        : defaults.accentColor,
    language: oneOf(source.language, languageSettings, defaults.language),
    reopenLastFolder: typeof source.reopenLastFolder === "boolean" ? source.reopenLastFolder : defaults.reopenLastFolder,
    resumeMinSeconds: oneOf(source.resumeMinSeconds, resumeThresholds, defaults.resumeMinSeconds),
    rowPulseIntensity: onGrid(source.rowPulseIntensity, 1, pulseIntensityStep, defaults.rowPulseIntensity),
    waveformPulseIntensity: onGrid(
      source.waveformPulseIntensity,
      1,
      pulseIntensityStep,
      defaults.waveformPulseIntensity,
    ),
  };
}

function onGrid(value: unknown, max: number, step: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max) {
    return fallback;
  }

  return Math.round(value / step) * step;
}

function oneOf<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

// Holds session-wide subscriptions: a hot-swapped copy would run next to the old one (two players
// reacting to every event). Edits to this module reload the page instead.
import.meta.hot?.accept(() => window.location.reload());
