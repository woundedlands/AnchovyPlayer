import { useMemo, type ReactNode } from "react";
import { MantineProvider } from "@mantine/core";
import { colorSchemeManager } from "./colorSchemeManager";
import { useSettings } from "./settingsStore";
import { buildTheme } from "./theme";

/** Mantine with a theme rebuilt whenever the accent colour changes. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const accentColor = useSettings((state) => state.accentColor);
  const { theme, cssVariablesResolver } = useMemo(() => buildTheme(accentColor), [accentColor]);

  return (
    <MantineProvider
      theme={theme}
      cssVariablesResolver={cssVariablesResolver}
      colorSchemeManager={colorSchemeManager}
      defaultColorScheme="auto"
    >
      {children}
    </MantineProvider>
  );
}
