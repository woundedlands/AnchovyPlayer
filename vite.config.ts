import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The port comes from scripts/dev.mjs, which picks a free one and tells Tauri the same address.
// 17420 is the fallback for a plain `npm run tauri dev`, matching devUrl in tauri.conf.json.
const port = Number(process.env.ANCHOVY_DEV_PORT ?? 17420);

// Tauri must not have Rust errors hidden by a screen clear, and needs the exact port (strictPort).
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
