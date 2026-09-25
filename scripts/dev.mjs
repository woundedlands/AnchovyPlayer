// `npm run dev`: runs the app in development on a free port. Vite and Tauri must agree on the dev
// server's address, and a fixed port collides with whatever else runs on the machine. The port is
// only a development concern: the built app loads its page without any server.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Unusual enough to be free on most machines; any free port is taken when it is not. */
const preferredPort = 17420;

function tryListen(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(null));
    server.listen(port, "localhost", () => {
      const { port: bound } = server.address();
      server.close(() => resolve(bound));
    });
  });
}

const port = (await tryListen(preferredPort)) ?? (await tryListen(0));
if (port === null) {
  throw new Error("[dev] no free port for the dev server");
}

const configPath = join(tmpdir(), `anchovy-dev-${process.pid}.json`);
writeFileSync(configPath, JSON.stringify({ build: { devUrl: `http://localhost:${port}` } }));
console.log(`[dev] dev server on port ${port}`);

// Vite reads the port from the environment (vite.config.ts); Tauri's beforeDevCommand inherits it.
const child = spawn("npx", ["tauri", "dev", "--config", `"${configPath}"`], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, ANCHOVY_DEV_PORT: String(port) },
});
child.on("exit", (code) => process.exit(code ?? 0));
