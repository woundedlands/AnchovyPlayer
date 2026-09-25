import React from "react";
import ReactDOM from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import "@fontsource-variable/inter";
import "@mantine/core/styles.css";
import "./core/global.css";
import { colorSchemeManager } from "./core/colorSchemeManager";
import { loadSettings } from "./core/settingsStore";
import { cssVariablesResolver, theme } from "./core/theme";
import { App } from "./core/App";

void loadSettings().then(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <MantineProvider
        theme={theme}
        cssVariablesResolver={cssVariablesResolver}
        colorSchemeManager={colorSchemeManager}
        defaultColorScheme="auto"
      >
        <App />
      </MantineProvider>
    </React.StrictMode>,
  );
});
