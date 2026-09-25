import { useLocalStorage } from "@mantine/hooks";

export type RepeatMode = "off" | "current" | "folder";

export const repeatModes: RepeatMode[] = ["off", "current", "folder"];

/** Preferences survive restarts; the last folder and cursor position deliberately do not. */
export function useSettings() {
  const [playOnFocus, setPlayOnFocus] = useLocalStorage({
    key: "anchovy.playOnFocus",
    defaultValue: true,
    getInitialValueInEffect: false,
  });
  const [repeat, setRepeat] = useLocalStorage<RepeatMode>({
    key: "anchovy.repeat",
    defaultValue: "off",
    getInitialValueInEffect: false,
  });
  const [shuffle, setShuffle] = useLocalStorage({
    key: "anchovy.shuffle",
    defaultValue: false,
    getInitialValueInEffect: false,
  });
  const [volume, setVolume] = useLocalStorage({
    key: "anchovy.volume",
    defaultValue: 1,
    getInitialValueInEffect: false,
  });

  return { playOnFocus, setPlayOnFocus, repeat, setRepeat, shuffle, setShuffle, volume, setVolume };
}

export type Settings = ReturnType<typeof useSettings>;
