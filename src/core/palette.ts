// The whole UI palette derived from one accent colour. Works in OKLCH, where equal lightness steps
// look equal and hue stays put while lightness changes. The chosen colour contributes its hue and,
// within pastel limits, its chroma - any pick stays soft, never neon.

import type { MantineColorsTuple } from "@mantine/core";

/** Chroma range the accent is clamped to: below looks grey, above looks acid. */
const minAccentChroma = 0.05;
const maxAccentChroma = 0.13;

// Lightness of the ten accent shades (Mantine's 0..9); dark theme uses 3, light uses 7.
const accentLightness = [0.97, 0.93, 0.87, 0.8, 0.745, 0.7, 0.655, 0.605, 0.54, 0.47];
// Chroma relative to the accent's: near-white and near-black shades carry less colour.
const accentChromaScale = [0.25, 0.45, 0.75, 0.95, 1, 1.05, 1.1, 1.15, 1.1, 1];

// Graphite for the dark theme (Mantine's "dark" 0..9, 7 is the body): almost neutral, a hint of the hue.
const graphiteLightness = [0.94, 0.83, 0.66, 0.49, 0.35, 0.28, 0.238, 0.206, 0.176, 0.14];
const graphiteChroma = 0.004;

/** Hand-picked pastels offered as swatches; any other colour works through the picker. */
export const accentPresets = [
  { name: "Apricot", color: "#e8a97f" },
  { name: "Blush", color: "#e8a3c0" },
  { name: "Lavender", color: "#b3a2e8" },
  { name: "Sky", color: "#8fb8e8" },
  { name: "Mint", color: "#8ccbb0" },
  { name: "Matcha", color: "#a9c98a" },
  { name: "Sand", color: "#e3c77f" },
];

export const defaultAccent = accentPresets[0].color;

export interface Palette {
  accent: MantineColorsTuple;
  graphite: MantineColorsTuple;
  light: Record<string, string>;
  dark: Record<string, string>;
}

export function buildPalette(accentHex: string): Palette {
  const [, inputChroma, hue] = hexToOklch(accentHex);
  const chroma = Math.min(Math.max(inputChroma, minAccentChroma), maxAccentChroma);
  const accent = accentLightness.map((l, i) => oklchToHex(l, chroma * accentChromaScale[i], hue));
  const graphite = graphiteLightness.map((l) => oklchToHex(l, graphiteChroma, hue));
  const tinted = (l: number, c: number) => oklchToHex(l, c, hue);

  return {
    accent: accent as unknown as MantineColorsTuple,
    graphite: graphite as unknown as MantineColorsTuple,
    light: {
      "--app-bg": tinted(0.96, 0.008),
      "--app-surface": tinted(0.982, 0.005),
      "--app-raised": tinted(0.93, 0.012),
      "--app-border": withAlpha(tinted(0.3, 0.03), 0.08),
      "--app-text": tinted(0.25, 0.01),
      "--app-text-dim": tinted(0.55, 0.015),
      "--app-focus": withAlpha(accent[7], 0.1),
      "--app-focus-strong": withAlpha(accent[7], 0.18),
      "--app-accent": accent[7],
      "--app-accent-soft": accent[3],
      "--app-wave": withAlpha(tinted(0.25, 0.01), 0.2),
      "--app-wave-played": accent[5],
      // Shades of the one accent, four steps apart: clearly a gradient, never a second colour.
      "--app-accent-gradient": `linear-gradient(135deg, ${accent[4]} 0%, ${accent[8]} 100%)`,
      "--app-wave-played-start": accent[3],
      "--app-wave-played-end": accent[8],
      "--app-shadow": `0 1px 2px ${withAlpha(tinted(0.3, 0.03), 0.06)}, 0 8px 24px ${withAlpha(tinted(0.3, 0.03), 0.07)}`,
    },
    dark: {
      "--app-bg": graphite[8],
      "--app-surface": graphite[7],
      "--app-raised": graphite[6],
      "--app-border": withAlpha(tinted(0.97, 0.01), 0.06),
      "--app-text": graphite[0],
      "--app-text-dim": graphite[2],
      "--app-focus": withAlpha(accent[3], 0.1),
      "--app-focus-strong": withAlpha(accent[3], 0.18),
      "--app-accent": accent[3],
      "--app-accent-soft": accent[7],
      "--app-wave": withAlpha(graphite[0], 0.18),
      "--app-wave-played": accent[3],
      "--app-accent-gradient": `linear-gradient(135deg, ${accent[1]} 0%, ${accent[5]} 100%)`,
      "--app-wave-played-start": accent[1],
      "--app-wave-played-end": accent[6],
      "--app-shadow": "0 1px 2px rgba(0, 0, 0, 0.35), 0 8px 24px rgba(0, 0, 0, 0.3)",
    },
  };
}

function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex).map((v) => Math.round(v * 255));

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// --- Colour space conversion: sRGB <-> OKLab (Björn Ottosson's matrices) <-> OKLCH ---

function hexToRgb(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);

  return [(value >> 16) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255];
}

function toLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function fromLinear(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

function hexToOklch(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  return [lightness, Math.hypot(a, bb), Math.atan2(bb, a)];
}

function oklchToLinearRgb(lightness: number, chroma: number, hue: number): [number, number, number] {
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** Colours outside sRGB lose chroma (binary search) rather than shift hue or lightness. */
function oklchToHex(lightness: number, chroma: number, hue: number): string {
  const inGamut = (c: number) => oklchToLinearRgb(lightness, c, hue).every((v) => v >= -1e-4 && v <= 1 + 1e-4);
  let fitted = chroma;
  if (!inGamut(fitted)) {
    let low = 0;
    let high = chroma;
    for (let step = 0; step < 20; step++) {
      const mid = (low + high) / 2;
      if (inGamut(mid)) {
        low = mid;
      } else {
        high = mid;
      }
    }
    fitted = low;
  }
  const rgb = oklchToLinearRgb(lightness, fitted, hue).map((v) => Math.round(Math.min(Math.max(fromLinear(v), 0), 1) * 255));

  return `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
