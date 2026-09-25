import React from "react";
import ReactDOM from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import "@fontsource-variable/inter";
import "@mantine/core/styles.css";
import "./core/global.css";
import { cssVariablesResolver, theme } from "./core/theme";
import { App } from "./core/App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <MantineProvider theme={theme} cssVariablesResolver={cssVariablesResolver} defaultColorScheme="auto">
      <App />
    </MantineProvider>
  </React.StrictMode>,
);
