# Anchovy Player - project memory

**This file is the memory.** Everything worth remembering about the project goes here or into a module's own `dev.md`. `AGENTS.md` says how to write in these files; this file is what they say.

## The product

A simple, minimalist desktop audio player that is ideal for auditioning sound effects and still pleasant for everyday music. Existing players fail the first case: VLC and similar rebuild the whole pipeline (demux, decode, open device, buffer) per file, so a short SFX finishes before the device wakes up and is never heard. Paid sample browsers solve it but are paid.

The UX bar: large, calm, modern UI; every interaction answers instantly; nothing to configure before it is useful.

### Browsing

- **Integrated file browser** is the main view, not a dialog. Every folder but the drives list starts with a `..` row. The folder is watched live: files added, removed, renamed or rewritten on disk show up without a manual refresh.
- **Path bar works like Windows Explorer**: breadcrumbs, a click on a segment goes there with the folder we came out of focused, a click on the empty space turns it into a raw editable path (Enter goes, Esc cancels, Tab completes a folder name). Leading segments that do not fit collapse into `…`. There is deliberately no shortcut for it.
- **Focus and playback are separate things.** One click or an arrow key moves *focus* to an item. **Play on focus** is a setting (on by default): focusing an audio file plays it - the SFX audition mode. Clicking the focused file again replays it.
- **Each audio row's icon turns into its play button** (cross-fade in the same spot) when the row is hovered, focused or playing - the button sits where the pointer already is.
- **Selection is separate from focus** and forms the *group*. Plain click: focus, selection cleared. Ctrl+click toggles, Shift+click / Shift+arrows select a range from the anchor, Ctrl+A all, Ctrl+Space toggles the focused row, Esc clears. Modifier clicks never play (picking a group must not fire every file). Plain arrow moves keep the selection. A press on an already selected row replaces the selection only on release, so the press can start dragging the whole group (Explorer does the same). The selection belongs to one list: another folder or search clears it, a live reload keeps it (keyed by path).
- **Played files are dimmed** for the whole session, across folders; memory only, never saved.
- **Jump to name**: typed characters accumulate into a prefix for ~1 s and focus the next item starting with it; repeating one letter cycles. Nothing is filtered.
- **Back / forward** like Explorer: buttons left of "up", Alt+Left/Right, the mouse's side buttons. Each step returns to the folder with the item that was under the cursor. Only moving to another folder is recorded - live reloads and the first listing at start are not.
- **Search** is a separate, explicit mode (Ctrl+F or the search field): a fuzzy filter over the current folder and, recursively, its subfolders, shown as paths below the folder. Esc or Left closes it.
- **List info** (selection count, search results) floats as a pill over the list. It must never take layout space: rows jumping under the cursor the moment a selection appears made clicks land on the wrong row.

### Files

- **Context menu** (right click; a row outside the selection becomes the only target, as in Explorer): Play / Open, Cut, Copy, Paste, Copy path, Rename, Delete, Show in Explorer. Actions apply to the selection when the row is in it, else to the row. Right click on empty space: Paste, Show in Explorer.
- Shortcuts: F2 rename (inline, the name without extension preselected), Del to the recycle bin (no confirmation, like Explorer), Ctrl+C / Ctrl+X / Ctrl+V, Ctrl+Shift+C copy paths.
- **Clipboard is the system's, in Explorer's format** (file list + "Preferred DropEffect"): files cut here paste in Explorer and the other way round. Paste into a folder that has the name gives "name (2).ext". A cut is cleared from the clipboard once pasted.
- **Drag and drop out** carries the selection if the dragged row is in it, else the row.
- Results and errors of file operations show as a short notice above the player.

### Playback

- **Instant playback**, including files a few milliseconds long. A new sound cuts the previous one with a 3 ms fade-out; the new one has no fade-in, because the first samples of an SFX are its attack.
- **Repeat**: off / current / group, cycled by Ctrl+R. *Off* stops after the file - auditioning SFX must not turn into playing all of them. *Current* replays; *group* plays through the playlist and wraps. Both wait a **pause between tracks** (0-1 s slider, 50 ms steps, 0.5 s default) so 50 ms clips do not become a machine gun; with no pause, *current* loops gaplessly inside the engine (loops, ambiences).
- **The playlist** is the selected audio files when the playing track is one of them, otherwise all audio files of the list. Selecting while something plays re-targets it at once.
- **Shuffle** is a shuffled round, not pure random: the next track is picked at random among those not played yet in this round, never the current one; the round resets when all have played.
- **Volume** 0-200%, always on a 5% grid (a step from 6% goes to 10% or 5%): wheel over the player, Ctrl+wheel or Ctrl+Up/Down anywhere. Above 100% the output is clamped, not wrapped.
- **Waveform**, in the spirit of Unity's audio clip preview: min/max peaks per channel (one lane for mono), click or drag to seek. Files over a minute are split into time segments analysed in parallel, one decoder each, seeked to its segment (a 76-minute AAC: ~14 s in one pass, ~2 s split, in a dev build). GPU would not help: the cost is the codec's sequential entropy decoding, not the min/max. Times use the unit that fits the track: ms below 1 s, tenths below 10 s, m:ss above.
- **Two focus zones, file list and player**, each with its own arrow keys. Tab or a click on the waveform / empty part of the player bar switches. Transport buttons and the volume slider are a remote control and do not take the zone - otherwise pressing Play and then an arrow skipped tracks instead of moving in the list.
  - List: Up/Down/PageUp/PageDown/Home/End move focus (Shift extends the selection), Left/Backspace parent folder, Right/Enter enter a folder or play a file.
  - Player: Left/Right seek 5 s (Shift: 1 s), Up/Down previous/next track (list focus follows), Enter play/pause.
  - Anywhere: Space play/pause, Ctrl+R repeat, Ctrl+F search, Ctrl+Up/Down volume, letters jump to name.
- **Until something plays, the player bar shows the cued file** - the one Play would start - with its name, folder and waveform; a click on that waveform starts it there. The folder under the track name is a link: it shows the track in its folder in the list, focused, without playing.
- With nothing loaded, Space, Enter in the player and the play button start the focused file, or the first audio file when a folder is focused. Opening a folder never starts playback by itself.

### Shell and app life

- **Explorer integration** (like VS Code's "Open with Code"): "Open with Anchovy Player" on audio files whatever their default app is, on folders and on a folder's empty space; also listed under "Open with" without taking over the default. Optional in the installer (checkbox on the welcome page, on by default; passive/silent installs keep it on); the uninstaller removes it. On Windows 11 it sits under "Show more options".
- Opening a file shows its folder with the file focused and plays it **once, ignoring repeat** - a file suddenly looping or a whole folder starting is alarming; repeat applies again as soon as the user starts anything.
- **Tray**: closing the window hides it (setting "Keep running in the tray", on by default); left click on the tray icon shows it, right click has Show / Quit. A second launch ("Open with" while running) forwards its path and shows the window. No autostart.
- **Reopen last folder** (setting, on): the next start opens the folder and focuses the file where the last session ended; otherwise the Music folder. A path passed on launch ("Open with") wins.
- **Resume where you left off** (setting: off / 10 s+ / 30 s+ / 1 min+ / 5 min+ / 10 min+, default 30 s+): tracks at least that long start where they were stopped. The engine starts there directly (`play` takes a start position), no jump from 0. Positions are saved every 5 s while playing, on pause and on switching tracks; within 3 s of the start or 5 s of the end the track is forgotten (starts over). session.json keeps them by content fingerprint only (same as the waveform store), at most 1000, none older than 180 days; the resume lookup is skipped entirely while none are saved, and fingerprints are cached per file version so replays read nothing. Turning either setting off erases what it kept.
- **A reloaded page stops the engine first.** Otherwise a voice from before the reload keeps playing with no track in the UI to stop it.
- **UI language**: English and Russian, "System" by default (Russian if the system is, else English). Rust error messages stay English.

## Audio engine principles

These are what makes "instant" true; any change that breaks one of them breaks the product.

1. **The output stream is opened once and kept.** Playing means swapping the source in the mixer, not opening a device. Only a dead stream (device unplugged, stream invalidated) is rebuilt; a rerouted default device keeps working on its own.
2. **After 5 minutes with nothing playing the stream is paused**, and the next command resumes it. An open stream counts as audio in use and keeps Windows from sleeping - unacceptable for an app living in the tray. The suspend cannot lose a command: the output thread sets the "suspended" flag first, then checks under the mixer lock that nothing plays and the command ring is empty; senders push first and check the flag after, sending a wake-up if it is set.
3. **Files up to 60 s are fully decoded to PCM in memory** and kept in an LRU cache. Longer ones stream from disk through a ring buffer; seeking a stream starts a new decode at the target.
4. **Neighbours of the focused item are pre-decoded** in the background (±6 around focus, nearest first).
5. Resampling to the device rate happens at decode time (rubato FFT, delay trimmed so timing and length are exact), never in the audio callback. The callback does no allocation, no blocking lock, no I/O, and hands replaced voices to another thread to be freed.
6. **Status polling adapts**: every 16 ms while playing, 250 ms while idle or paused; every player command wakes the poller and keeps it fast for 500 ms, so the new state is reported at once.

## Caching

**Waveforms of files over 60 s are kept on disk** (`<app cache>/waveforms`, ~32 KB each), keyed by a content fingerprint - size plus 16 evenly spread 16 KB samples, FNV-1a - so a moved or renamed file still hits and a re-exported one misses. Every hit touches the file's modification time; at each app start a background pass deletes entries unused for 30 days, then the least recently used until the store is under 256 MB. Short files are not stored: their waveform comes from the decoded clip already in memory, instantly.


**Every cache entry is keyed by path plus modification time and size** (and output sample rate for PCM), checked on every lookup, so a re-exported file is never served stale even if a watcher event is missed. The folder watcher also evicts changed paths. The search index (a recursive walk) is reused for 10 s while typing, then rebuilt.

## Formats

- symphonia 0.6 with `all` decodes wav, aiff, caf, mp3 (mp1/mp2), ogg vorbis, flac, aac and alac in mp4/m4a, mkv/webm, adpcm.
- Opus comes from `symphonia-adapter-libopus`, which builds Xiph's libopus from source and links it statically.
- Not covered: WMA, APE. Rare in SFX libraries; not planned.
- ffmpeg was rejected: tens of MB of DLLs, LGPL shipping obligations, painful Windows build, for formats nobody here needs.
- Playable extensions are listed in `src/modules/browser/entries.ts`; keep them in sync with the decoder and the installer hooks.

## Distribution

The user installs one NSIS `.exe` (a few MB) and nothing else.

- The MSVC runtime is linked statically (`src-tauri/.cargo/config.toml`, `+crt-static`). Without it the exe imports `VCRUNTIME140.dll` and fails to start on a clean Windows. Check with `dumpbin /dependents` after touching build flags: only system DLLs are allowed. `api-ms-win-crt-*` imports are fine - that is the Universal CRT, part of Windows 10 and later; `VCRUNTIME140.dll` or `MSVCP140.dll` are not.
- libopus is a static `opus.lib`; there is no `opus.dll` to ship.
- WebView2 is not bundled: nearly every Windows 10/11 machine has it, and Tauri's default bootstrapper downloads it during setup on the rare one that does not. Bundling the offline installer made the setup ~210 MB for a ~7 MB app.
- Bundle what a normal machine may lack, not what the OS already ships. Repo size is cheaper than setup steps.
- **Explorer registration lives in `src-tauri/windows/installer-hooks.nsh`**, written to `SHCTX` so it follows the install mode. Its extension list must match `playableExtensions` in `src/modules/browser/entries.ts` (minus video containers). Tauri includes the hooks file before any page is declared, which is why a `MUI_PAGE_CUSTOMFUNCTION_SHOW`/`LEAVE` defined there attaches to the welcome page - and why `MUI_BGCOLOR` is not defined yet at that point.

## Build environment

Prerequisites are Rust (with the MSVC toolchain) and Node only. `npm install` runs `scripts/setup-tools.mjs`, which downloads CMake and Ninja into `tools/` (gitignored), each pinned by the vendor's SHA-256. `src-tauri/.cargo/config.toml` points cargo at them. Release build: `npm run tauri build`; the installer lands in `src-tauri/target/release/bundle/nsis/`.

- **libopus is built with CMake + Ninja, never a Visual Studio generator.** VS generators pick an instance through vswhere and fail on an incomplete or newer-than-CMake install (`could not find any instance of Visual Studio`, `Could not create named generator Visual Studio 18 2026`) - it looks like a broken VS and is not. With Ninja the cmake crate passes the same `cl.exe` and environment cargo already uses.
- CMake does not look for `ninja.exe` next to itself; `.cargo/toolchain.cmake` sets `CMAKE_MAKE_PROGRAM`.
- **libopus picks its CRT from its own `OPUS_STATIC_RUNTIME` option** and overwrites `CMAKE_MSVC_RUNTIME_LIBRARY`; the `/MT` the cmake crate passes is overridden too. Without the option the build succeeds with only linker warnings (`LNK4098 defaultlib 'MSVCRT' conflicts`, `LNK4217`) while two CRTs are mixed. Set in `.cargo/toolchain.cmake`.
- Changing the generator or toolchain file needs a clean libopus build (`Does not match the generator used previously` otherwise): delete `src-tauri/target/*/build/opusic-sys-*`.
- **The dev server port is picked at launch.** `npm run dev` (scripts/dev.mjs) takes 17420 if free, else any free port, and gives it to Vite (`ANCHOVY_DEV_PORT`) and Tauri (`--config` devUrl). A fixed port collided with other projects' dev servers, and a leftover Vite from a crashed run keeps its port: Tauri then fails with "beforeDevCommand terminated", which reads like a build error. Plain `npm run tauri dev` still works on 17420. The built app uses no port at all.
- Tauri commands are all `async`: a sync command runs on the main thread and would freeze the window while a file decodes.

## Look and feel

- Two themes, dark and light, both first-class: soft, low-contrast surfaces, one pastel accent - never neon - and no pure black or pure white. Target feel is a premium hardware player, not a developer tool. Follows the system theme by default.
- **The whole palette is derived from one accent colour** (`core/palette.ts`, OKLCH): the accent's hue and, clamped to a pastel range, its chroma give the ten Mantine accent shades, the near-neutral graphite of the dark theme and the tinted porcelain of the light one. Presets: Apricot (default), Blush, Lavender, Sky, Mint, Matcha, Sand; any colour works via the picker. Components use the `--app-*` CSS variables, never raw colours.
- Icons: Tabler only. UI font: Inter (bundled via fontsource, no network).
- Big hit targets and generous spacing; the list row is the main surface and must stay readable at a glance.

## Frontend pitfalls

- **An inline ref callback on an element measured with Mantine's `useElementSize` re-renders every frame.** Each render re-attaches the ref, the hook starts a new `ResizeObserver`, its first report sets state, which renders again. It showed up as ~20% of a core in the WebView renderer while the app was idle and even minimized, with nothing visible happening. Use a stable ref (`useMergedRef`).
- **A clip can end before `play()` returns.** A 40 ms file finishes within the IPC round trip, so its end event arrives while the player store still holds the previous track and is ignored; no later status event follows, and repeat silently stops after a few files. `playFile` re-checks the end right after storing the new track.
- **Stores with session-wide subscriptions reload the page on edit** (`import.meta.hot.accept(() => location.reload())`). Hot-swapping them leaves the old copy subscribed next to the new one: two players react to every event, the list focus and the player bar disagree, and it looks like a playback bug.
- **Seeking is latest-wins with an optimistic playhead.** A drag across the waveform fires a seek per frame, and a seek in a long stream reopens the file; sent one by one they queued up behind the cursor and the playhead crawled at a few fps. Now one seek is in flight at a time, only the newest waiting position is kept, and `seekTarget` shows the requested position until the engine reports it (or 400 ms pass).
- Assigning a canvas `width`/`height` reallocates it even with the same value; the waveform redraws every frame while playing, so it only resizes on a real change.
- In development React StrictMode runs effects twice; one-shot startup work is guarded, or the second run cancels the first folder listing.
- Mantine popovers inside a `Menu` (the colour picker in settings) must not use a portal, or clicking them counts as a click outside and closes the menu.
