import { createTheme, type CSSVariablesResolver, type MantineThemeOverride } from "@mantine/core";
import { buildPalette } from "./palette";

export interface AppTheme {
  theme: MantineThemeOverride;
  /** App surfaces as `--app-*` variables; components use these instead of raw colours. */
  cssVariablesResolver: CSSVariablesResolver;
}

/** Everything colour-related comes from the one accent the user picked. */
export function buildTheme(accentHex: string): AppTheme {
  const palette = buildPalette(accentHex);
  const theme = createTheme({
    primaryColor: "accent",
    // Dark uses the light pastel shade, light the deeper one; both read well on their surfaces.
    primaryShade: { light: 7, dark: 3 },
    colors: { accent: palette.accent, dark: palette.graphite },
    defaultRadius: "md",
    fontFamily: "'Inter Variable', system-ui, sans-serif",
    fontFamilyMonospace: "'Inter Variable', system-ui, sans-serif",
    headings: { fontFamily: "'Inter Variable', system-ui, sans-serif", fontWeight: "600" },
    focusRing: "never",
    cursorType: "pointer",
  });

  return {
    theme,
    cssVariablesResolver: () => ({ variables: {}, light: palette.light, dark: palette.dark }),
  };
}
