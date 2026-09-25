# Anchovy Player - project memory

**This file is the memory.** Everything worth remembering about the project goes here or into a module's own `dev.md`. `AGENTS.md` says how to write in these files; this file is what they say.

## The product

A simple, minimalist desktop audio player that is ideal for auditioning sound effects and still pleasant for everyday music. Existing players fail the first case: VLC and similar rebuild the whole pipeline (demux, decode, open device, buffer) per file, so a short SFX finishes before the device wakes up and is never heard. Paid sample browsers solve it but are paid.

The UX bar: large, calm, modern UI; every interaction answers instantly; nothing to configure before it is useful.

### Core features

- **Integrated file browser** is the main view, not a dialog. Every folder but the drives list starts with a `..` row. The folder is watched live: files added, removed, renamed or rewritten on disk show up without a manual refresh.
- **Path bar works like Windows Explorer**: breadcrumbs, a click on a segment goes there with the folder we came out of focused, a click on the empty space turns it into a raw editable path (Enter goes, Esc cancels, Tab completes a folder name). Leading segments that do not fit collapse into `…`. There is deliberately no shortcut for it.
- **Focus and playback are separate things.** One click or an arrow key moves *focus* to an item. Each track row also has a classic play button. **Play on focus** is a setting (on by default): focusing an audio file plays it - this is the SFX audition mode. Clicking the focused file again replays it.
- **Two focus zones, file list and player**, each with its own arrow keys. Clicking a zone or Tab switches. The active zone shows an accent edge.
  - List: Up/Down/PageUp/PageDown/Home/End move focus, Left/Backspace go to the parent folder, Right/Enter enter a folder or play a file.
  - Player: Left/Right seek 5 s (Shift: 1 s), Up/Down previous/next track (the list focus follows), Enter toggles pause. Volume is the wheel.
  - Anywhere: Space toggles pause. With nothing loaded yet, Space, Enter in the player zone and the play button start the focused file, or the first audio file when a folder is focused - opening a folder never starts playback by itself, Ctrl+R cycles repeat, Ctrl+F searches, letters jump to name and switch to the list zone.
- **Jump to name** (like every OS file browser): typed characters accumulate into a prefix for ~1 s after the last key and focus the next item starting with it. Repeating one letter cycles through items starting with that letter. Nothing is filtered or hidden.
- **Search** is a separate, explicit mode (Ctrl+F or the search field): a fuzzy filter over the current folder and, recursively, its subfolders, shown as paths below the folder. Esc or Left closes it.
- **Instant playback**, including files a few milliseconds long. A new sound cuts the previous one with a 3 ms fade-out; the new one has no fade-in, because the first samples of an SFX are its attack.
- **Repeat**: off / current / folder, cycled by Ctrl+R. *Off* stops after the file - auditioning a folder of SFX must not turn into playing all of them. *Current* replays, *folder* plays through the playlist and wraps; both wait a **pause between tracks** first (setting, 0.5 s by default) so 50 ms clips do not become a machine gun. With the pause set to none, *current* loops gaplessly inside the engine (for loops and ambiences). **Shuffle** plays every file of the playlist once before any repeats. The playlist is the audio files of the list the track was started from.
- **Volume** 0-200% on the mouse wheel over the player (Ctrl+wheel anywhere), 5% per notch. Above 100% the output is clamped, not wrapped.
- **Waveform** of the current file, in the spirit of Unity's audio clip preview: min/max peaks per channel (one lane for mono), click or drag to seek, played part in the accent colour. Times use the unit that fits the track: ms below 1 s, tenths below 10 s, m:ss above.
- **Drag and drop out**: drag a file from the list into a DAW, engine, explorer or messenger.
- **Explorer integration** (like VS Code's "Open with Code"): "Open with Anchovy Player" in the context menu of audio files whatever their default app is, of folders and of a folder's empty space; the app is also listed under "Open with" for audio types without taking over the default. Optional in the installer (checkbox on the welcome page, on by default; passive/silent installs keep it on); the uninstaller removes it. Opening a file shows its folder with the file focused and plays it **once, ignoring repeat** - a file suddenly looping or a whole folder starting is alarming; repeat applies again as soon as the user starts anything. Opening a folder plays nothing; a second launch forwards its path to the running window. On Windows 11 the entry sits under "Show more options", like VS Code's.
- **Formats**: wav, mp3, ogg (vorbis, opus), m4a (aac, alac), flac, aiff. Recognised-but-unsupported audio (wma, ape...) is listed and marked; other files are not shown.
- **Played files are dimmed** in the list while the folder stays open (live reloads keep the marks); opening another folder clears them.
- The app does not remember the last folder or cursor positions between runs; it starts in the Music folder. Preferences (play on focus, repeat, shuffle, volume, pause between tracks, theme) are remembered in settings.json.

## Audio engine principles

These are what makes "instant" true; any change that breaks one of them breaks the product.

1. **The output stream is opened once and never closed** while the app runs. It renders silence when idle. Playing means swapping the source in the mixer, not opening a device. Only a dead stream (device unplugged, stream invalidated) is rebuilt; a rerouted default device keeps working on its own.
2. **Files up to 60 s are fully decoded to PCM in memory** and kept in an LRU cache. Longer ones stream from disk through a ring buffer; seeking a stream starts a new decode at the target.
3. **Neighbours of the focused item are pre-decoded** in the background (±6 around focus, nearest first), so the file is already in memory when it is played.
4. Resampling to the device rate happens at decode time (rubato FFT, delay trimmed so timing and length are exact), never in the audio callback. The callback does no allocation, no blocking lock, no I/O, and hands replaced voices to another thread to be freed.

## Caching

**Every cache entry is keyed by path plus modification time and size** (and output sample rate for PCM), checked on every lookup, so a re-exported file is never served stale even if a watcher event is missed. The folder watcher also evicts changed paths. The search index (a recursive walk) is reused for 10 s while typing, then rebuilt.

## Formats

- symphonia 0.6 with `all` decodes wav, aiff, caf, mp3 (mp1/mp2), ogg vorbis, flac, aac and alac in mp4/m4a, mkv/webm, adpcm.
- Opus comes from `symphonia-adapter-libopus`, which builds Xiph's libopus from source and links it statically.
- Not covered: WMA, APE. Rare in SFX libraries; not planned.
- ffmpeg was rejected: tens of MB of DLLs, LGPL shipping obligations, painful Windows build, for formats nobody here needs.
- Playable extensions are listed in `src/modules/browser/entries.ts`; keep them in sync with the decoder.

## Distribution

The user installs one NSIS `.exe` and nothing else - no redistributables, no runtime downloads.

- The MSVC runtime is linked statically (`src-tauri/.cargo/config.toml`, `+crt-static`). Without it the exe imports `VCRUNTIME140.dll` and fails to start on a clean Windows. Check with `dumpbin /dependents` after touching build flags: only system DLLs are allowed. `api-ms-win-crt-*` imports are fine - that is the Universal CRT, part of Windows 10 and later; `VCRUNTIME140.dll` or `MSVCP140.dll` are not.
- libopus is a static `opus.lib`; there is no `opus.dll` to ship.
- WebView2 is not bundled: nearly every Windows 10/11 machine has it, and Tauri's default bootstrapper downloads it during setup on the rare one that does not. Bundling the offline installer made the setup ~210 MB for a ~7 MB app.
- Prefer bundling over asking the user or developer to install things that a normal machine may lack. Repo size is cheaper than setup steps.
- **Explorer registration lives in `src-tauri/windows/installer-hooks.nsh`**, written to `SHCTX` so it follows the install mode. Its extension list must match `playableExtensions` in `src/modules/browser/entries.ts` (minus video containers). Tauri includes the hooks file before any page is declared, which is why a `MUI_PAGE_CUSTOMFUNCTION_SHOW`/`LEAVE` defined there attaches to the welcome page - and why `MUI_BGCOLOR` is not defined yet at that point.

## Build environment

Prerequisites are Rust (with the MSVC toolchain) and Node only. `npm install` runs `scripts/setup-tools.mjs`, which downloads CMake and Ninja into `tools/` (gitignored), each pinned by the vendor's SHA-256. `src-tauri/.cargo/config.toml` points cargo at them.

- **libopus is built with CMake + Ninja, never a Visual Studio generator.** VS generators pick an instance through vswhere and fail on an incomplete or newer-than-CMake install (`could not find any instance of Visual Studio`, `Could not create named generator Visual Studio 18 2026`) - it looks like a broken VS and is not. With Ninja the cmake crate passes the same `cl.exe` and environment cargo already uses.
- CMake does not look for `ninja.exe` next to itself; `.cargo/toolchain.cmake` sets `CMAKE_MAKE_PROGRAM`.
- **libopus picks its CRT from its own `OPUS_STATIC_RUNTIME` option** and overwrites `CMAKE_MSVC_RUNTIME_LIBRARY`; the `/MT` the cmake crate passes is overridden too. Without the option the build succeeds with only linker warnings (`LNK4098 defaultlib 'MSVCRT' conflicts`, `LNK4217`) while two CRTs are mixed. Set in `.cargo/toolchain.cmake`.
- Changing the generator or toolchain file needs a clean libopus build (`Does not match the generator used previously` otherwise): delete `src-tauri/target/*/build/opusic-sys-*`.
- Tauri commands are all `async`: a sync command runs on the main thread and would freeze the window while a file decodes.

## Look and feel

- Two themes, dark and light, both first-class: soft, low-contrast surfaces, one pastel orange (apricot) accent - soft, never neon - and no pure black or pure white. Dark: peach on neutral warm graphite. Light: muted terracotta on warm porcelain. Target feel is a premium hardware player, not a developer tool. Follows the system theme by default.
- Mantine is themed centrally in `src/core/theme.ts`; app surfaces are the `--app-*` CSS variables defined there, components do not hardcode colours.
- Icons: Tabler only. UI font: Inter (bundled via fontsource, no network).
- Big hit targets and generous spacing; the list row is the main surface and must stay readable at a glance.
- **A clip can end before `play()` returns.** A 40 ms file finishes within the IPC round trip, so its end event arrives while the player store still holds the previous track and is ignored; no later status event follows, and repeat-folder silently stops after a few files. `playFile` re-checks the end right after storing the new track.
- **Stores with session-wide subscriptions reload the page on edit** (`import.meta.hot.accept(() => location.reload())`). Hot-swapping them leaves the old copy subscribed next to the new one: two players react to every event, the list focus and the player bar disagree, and it looks like a playback bug.
- In development React StrictMode runs effects twice; one-shot startup work is guarded, or the second run cancels the first folder listing.
