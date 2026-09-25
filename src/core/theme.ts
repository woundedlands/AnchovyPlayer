import { createTheme, type CSSVariablesResolver, type MantineColorsTuple } from "@mantine/core";

// Pastel apricot: warm and soft, never neon. Dark uses the light peach (3), light the muted terracotta (7).
const anchovy: MantineColorsTuple = [
  "#fdf3ec",
  "#f8e3d4",
  "#f0c7ab",
  "#e8a97f",
  "#e2935f",
  "#dc8448",
  "#d27a3d",
  "#b96831",
  "#a55b29",
  "#8f4d20",
];

// Neutral graphite with a hint of warmth so the peach accent does not fight it; dark[7] is the body colour.
const graphite: MantineColorsTuple = [
  "#ecebea",
  "#c9c7c4",
  "#94918d",
  "#64615d",
  "#3d3b39",
  "#2a2927",
  "#201f1e",
  "#181716",
  "#111110",
  "#0a0a09",
];

export const theme = createTheme({
  primaryColor: "anchovy",
  primaryShade: { light: 7, dark: 3 },
  colors: { anchovy, dark: graphite },
  defaultRadius: "md",
  fontFamily: "'Inter Variable', system-ui, sans-serif",
  fontFamilyMonospace: "'Inter Variable', system-ui, sans-serif",
  headings: { fontFamily: "'Inter Variable', system-ui, sans-serif", fontWeight: "600" },
  focusRing: "never",
  cursorType: "pointer",
});

/** App surfaces. Components use these instead of raw colours so both themes stay in one place. */
export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  light: {
    "--app-bg": "#f4f1ec",
    "--app-surface": "#faf8f5",
    "--app-raised": "#ece7e0",
    "--app-border": "rgba(60, 40, 20, 0.08)",
    "--app-text": "#26211d",
    "--app-text-dim": "#7a7169",
    "--app-focus": "rgba(185, 104, 49, 0.1)",
    "--app-focus-strong": "rgba(185, 104, 49, 0.18)",
    "--app-accent": "#b96831",
    "--app-accent-soft": "#e8a97f",
    "--app-wave": "rgba(38, 33, 29, 0.2)",
    "--app-wave-played": "#d9885a",
    "--app-shadow": "0 1px 2px rgba(60, 40, 20, 0.06), 0 8px 24px rgba(60, 40, 20, 0.07)",
  },
  dark: {
    "--app-bg": "#111110",
    "--app-surface": "#181716",
    "--app-raised": "#201f1e",
    "--app-border": "rgba(255, 240, 225, 0.06)",
    "--app-text": "#ecebea",
    "--app-text-dim": "#94918d",
    "--app-focus": "rgba(232, 169, 127, 0.1)",
    "--app-focus-strong": "rgba(232, 169, 127, 0.18)",
    "--app-accent": "#e8a97f",
    "--app-accent-soft": "#b96831",
    "--app-wave": "rgba(236, 235, 234, 0.18)",
    "--app-wave-played": "#e8a97f",
    "--app-shadow": "0 1px 2px rgba(0, 0, 0, 0.35), 0 8px 24px rgba(0, 0, 0, 0.3)",
  },
});
