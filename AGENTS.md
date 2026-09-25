Anchovy Player - a minimalist desktop audio player built around an integrated file browser. Its reason to exist is instant response: open a folder of short SFX, walk it with the keyboard and hear each file the moment it is selected. Regular music listening must work well too, but never at the cost of that.

1. Tauri 2 (Rust) + React 19 + TypeScript + Vite + Mantine 9. Windows is the primary target, but a Linux port must stay cheap: platform-specific code (shell integration, installer hooks) lives in its own module behind `cfg(windows)` / `cfg(target_os = ...)`, and nothing else assumes Windows paths, drive letters or `\` separators. Check the installed version before assuming an API exists - Mantine and Tauri both broke APIs between majors, and most examples online are for older ones.

# Project Structure

1. `src/` - frontend (React). `src/main.tsx` is the entry point only.
2. `src/core/` - the app shell and what every module relies on: providers, theme, settings, i18n, shared helpers. Its shell files (`App.tsx`, `flow.ts` for cross-module flow, `keyboard.ts`, `fileActions.ts` and `EntryMenu.tsx` for file operations) are the only core code that imports modules.
3. `src/modules/<Module>/` - one folder per module (browser, player...). Store, components, styles and backend call wrappers of a module live together. Modules never import each other; what connects them lives in `core/flow.ts`.
4. `src-tauri/src/` - backend (Rust). One module per subsystem (`audio/`, `fs/`...). Tauri commands are thin wrappers that call into modules; logic does not live in command handlers.
5. **Domain logic and all flow live in TypeScript.** Rust provides only primitives TypeScript cannot do or should not own: the audio engine (decode, play, seek, loop, cache, prefetch, waveform peaks), filesystem primitives (list, watch, recursive walk), drag-out and shell integration. Navigation, focus, playback order, repeat/shuffle, search matching, format classification and sorting are TypeScript. When unsure where something goes, it goes to TypeScript.
6. Audio is decoded and played **only in Rust**. The WebView never touches audio data except for waveform peaks already reduced by the backend.

# Documenting into dev.md

0. dev.md is your (LLM) notes, written for a future you starting a fresh conversation with no context. A human may read it, so keep it dense and free of session gossip. Root dev.md is in the project root - read it every time you work on the project.
1. Root dev.md holds what crosses modules: product decisions, conventions, pitfalls. A folder can have its own dev.md for its details. Put detail in the module file and a pointer in the root one - never the same thing in both.
2. **Write decisions as statements about how things are.** "The output stream is never closed" can be checked and deleted when it stops being true. "We decided to keep the stream open" cannot. No dates, no chronicle.
3. **Problems you hit are the most valuable content.** Write what breaks, how it presents and why - as a property of the system, not an episode. Especially the ones that lie: a symptom pointing at the wrong subsystem, a silent failure.
4. **If code can enforce it, write code, not a doc line.**
5. When something changes, rewrite the sentence that is now wrong instead of appending a newer one. Remove what no longer makes sense.
6. Anything you delete or rename that a dev.md mentions - grep the dev.md files in the same change.
7. All docs and comments are English only. UI text is never written inline: it goes through `core/i18n.ts` (English reference + Russian), and TypeScript rejects a language missing a key.

# Skills

1. Project skills are in `.claude/skills`. `code-style` applies to every source change.

# How to work

1. Find out the user's actual intent - the best solution may differ from the literal request.
2. Don't commit unless asked. Commit messages short, 1-10 words. No AI attribution in commits or PRs.
3. Comment in chat from time to time on what you are doing, so it doesn't look stuck.
4. Avoid overengineering. A small helper belongs next to the code that uses it, not in a shared util someone has to go find.
5. Required things are not optional: if something expected is missing, fail loudly with an error naming the cause. No warning-and-continue, no silent null. The exception is user content - an unreadable or unsupported file is normal and must be shown as such in the UI, never crash or stall navigation.
6. Tokens are not infinite. Avoid microfix->screenshot loops and giantfix->no test.
7. Latency and feel are judged by a person using the app, not by green tests. Run checks as a smoke test and let the user verify.
8. Checks before handing off: `npm run typecheck`, `cargo check` and `cargo test --lib` (in `src-tauri`). Run the app with `npm run dev` (picks a free port for the dev server; see dev.md).
9. **Never drive the real mouse or keyboard** (SendKeys, synthetic clicks) to test the app: the desktop is shared with the user and the input lands in whatever they are doing. Observe passively - window screenshots, logs, page console forwarded to the Vite log - and ask the user to try interactions.

# Libs installed

Reach for these before adding a dependency or writing your own.

1. Mantine (`@mantine/core`, `@mantine/hooks`) - the UI kit. Use its components and hooks (`useHotkeys`, `useMediaQuery`...) before writing custom ones. Styling via CSS modules + Mantine CSS variables; no other styling library.
2. Tabler icons (`@tabler/icons-react`) - the only icon set.
3. cpal - audio output.
4. symphonia + symphonia-adapter-libopus - decoding. Formats and what is not covered are in dev.md.
5. trash - moving files to the recycle bin. clipboard-win (Windows only) - files on the system clipboard, Explorer-compatible. tauri-plugin-opener - "Show in Explorer".
6. zustand - app state. One store per module (`<module>Store.ts`) plus `core/settingsStore.ts`. Components select only what they render; non-React code uses `getState()`. No `persist` middleware: see settings below.

# Persistent data

1. Preferences live in `settings.json` in the app config folder, written by `core/settingsStore.ts` through the `load_settings` / `save_settings` commands. Nothing persistent goes to localStorage.
2. Keep the file **flat**: one key per preference, each with its own default. Parsing is field by field - an invalid or missing value falls back to its default without touching the rest, unknown keys are dropped. Bump the file `version` only when a key changes meaning.
