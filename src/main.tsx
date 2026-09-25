import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter";
import "@mantine/core/styles.css";
import "./core/global.css";
import { App } from "./core/App";
import { loadSession } from "./core/sessionStore";
import { loadSettings } from "./core/settingsStore";
import { ThemeProvider } from "./core/ThemeProvider";

void Promise.all([loadSettings(), loadSession()]).then(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </React.StrictMode>,
  );
});
