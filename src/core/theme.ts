import {
  Checkbox,
  createTheme,
  SegmentedControl,
  Slider,
  type CSSVariablesResolver,
  type MantineThemeOverride,
} from "@mantine/core";
import { buildPalette } from "./palette";
import { CheckboxMark } from "./CheckboxMark";
import controls from "./controls.module.css";

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
    fontFamily: "'Nunito Variable', system-ui, sans-serif",
    fontFamilyMonospace: "'Nunito Variable', system-ui, sans-serif",
    headings: { fontFamily: "'Nunito Variable', system-ui, sans-serif", fontWeight: "600" },
    focusRing: "never",
    cursorType: "pointer",
    components: {
      Checkbox: Checkbox.extend({
        defaultProps: { size: "md", radius: "sm", icon: CheckboxMark },
        classNames: { input: controls.checkboxInput },
        vars: () => ({ root: { "--checkbox-icon-color": "var(--app-on-accent)" } }),
      }),
      Slider: Slider.extend({
        defaultProps: { size: "md", thumbSize: 22 },
        classNames: { track: controls.sliderTrack, bar: controls.sliderBar, thumb: controls.sliderThumb },
      }),
      SegmentedControl: SegmentedControl.extend({
        classNames: {
          root: controls.segmentedRoot,
          indicator: controls.segmentedIndicator,
          label: controls.segmentedLabel,
        },
      }),
    },
  });

  return {
    theme,
    cssVariablesResolver: () => ({ variables: {}, light: palette.light, dark: palette.dark }),
  };
}
