import type { MantineColorSchemeManager } from "@mantine/core";
import { useSettings } from "./settingsStore";

/** Keeps the theme in settings.json with the other preferences instead of Mantine's own localStorage key. */
export const colorSchemeManager: MantineColorSchemeManager = {
  get: () => useSettings.getState().colorScheme,
  set: (colorScheme) => useSettings.getState().update({ colorScheme }),
  subscribe: () => {},
  unsubscribe: () => {},
  clear: () => {},
};
