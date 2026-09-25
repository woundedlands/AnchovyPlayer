// Downloads build tools the Rust side needs into tools/, so a fresh clone builds after `npm install`.
// Every archive is pinned by SHA-256 taken from the vendor's official checksum file.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync, renameSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const toolsDir = join(import.meta.dirname, "..", "tools");

const cmake = {
  name: "cmake",
  version: "4.4.3",
  url: "https://github.com/Kitware/CMake/releases/download/v4.4.3/cmake-4.4.3-windows-x86_64.zip",
  sha256: "4d52ebab7193a698651639ed80d8d04fd903358843572cf44c7fd234cb7c26ab",
  archiveRoot: "cmake-4.4.3-windows-x86_64",
  check: join("bin", "cmake.exe"),
};

// Ninja is the CMake generator (see .cargo/config.toml). It goes next to cmake.exe, where CMake finds it
// without PATH changes. VS generators depend on which Visual Studio instances exist and are complete.
const ninja = {
  name: "ninja",
  version: "1.13.2",
  url: "https://github.com/ninja-build/ninja/releases/download/v1.13.2/ninja-win.zip",
  sha256: "07fc8261b42b20e71d1720b39068c2e14ffcee6396b76fb7a795fb460b78dc65",
  installTo: join("cmake", "bin"),
  check: "ninja.exe",
};

async function install(tool) {
  const target = join(toolsDir, tool.installTo ?? tool.name);
  const stamp = join(target, `.${tool.name}-version`);
  if (existsSync(join(target, tool.check)) && existsSync(stamp)) {
    return;
  }

  console.log(`[setup-tools] downloading ${tool.name} ${tool.version}`);
  const response = await fetch(tool.url);
  if (!response.ok) {
    throw new Error(`[setup-tools] ${tool.name}: download failed with HTTP ${response.status} from ${tool.url}`);
  }
  const data = Buffer.from(await response.arrayBuffer());
  const hash = createHash("sha256").update(data).digest("hex");
  if (hash !== tool.sha256) {
    throw new Error(`[setup-tools] ${tool.name}: SHA-256 mismatch, expected ${tool.sha256}, got ${hash}. Refusing to use it.`);
  }

  mkdirSync(toolsDir, { recursive: true });
  const archive = join(toolsDir, `${tool.name}.zip`);
  const staging = join(toolsDir, `${tool.name}.staging`);
  writeFileSync(archive, data);
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging);
  // The Windows built-in bsdtar reads zip; a tar from Git Bash on PATH would not.
  execFileSync(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), ["-xf", archive, "-C", staging]);
  if (tool.archiveRoot) {
    rmSync(target, { recursive: true, force: true });
    renameSync(join(staging, tool.archiveRoot), target);
  } else {
    renameSync(join(staging, tool.check), join(target, tool.check));
  }
  rmSync(staging, { recursive: true, force: true });
  rmSync(archive);
  writeFileSync(stamp, tool.version);
  console.log(`[setup-tools] ${tool.name} ready in ${target}`);
}

if (process.platform !== "win32") {
  console.log("[setup-tools] not Windows, expecting build tools from the system");
} else {
  await install(cmake);
  await install(ninja);
}
