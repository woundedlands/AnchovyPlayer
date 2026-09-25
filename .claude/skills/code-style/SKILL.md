---
name: code-style
description: Code style for Anchovy Player (TypeScript/React and Rust). Activate when writing, reviewing, or refactoring any source code in this repository.
---

# Coding Goal

Simple, reliable, readable code. Maintainability > premature optimization - except on the audio path, where latency is the product (see dev.md "Audio engine principles").

# Coding Methods

1. Before writing code, analyze for logical errors. Fix bugs BEFORE presenting code.
2. Extract repeated logic (>2 occurrences and more than 4 lines) into named functions.
3. Names must be self-describing. If a name needs a comment to explain it, rename it instead.
4. Comments only where code cannot speak for itself: business rationale, non-obvious constraints. When code uses a known algorithm, name it and explain the unobvious parts.
5. Never present unverified information as fact. Say explicitly: "I cannot verify this."
6. For technical/API questions: search the web or read the installed package source. If that fails, say so.
7. For product/UX questions: never guess from the web. Ask the user.

# Common

1. Do not truncate syntax: always braces on `if`/loops, no clever one-liners or nested ternaries. Short single-expression arrow functions and getters are fine.
2. One blank line between functions/methods.
3. One blank line before `return` in a function that is not a single line.
4. Prefer named constants over magic numbers and repeated string literals.
5. Files go to their logical place: module code in `src/modules/<Module>/`, app shell and shared code in `src/core/`, backend subsystems in `src-tauri/src/<module>/`.

# TypeScript / React

1. Function components only; named exports (`export function Browser()`), no default exports.
2. Naming: `PascalCase` for components, types and interfaces; `camelCase` for everything else, including constants.
3. One component per file, file named after it (`FileRow.tsx`). Its styles in `FileRow.module.css` next to it.
4. Omit what TypeScript infers; annotate function parameters and exported API.
5. Use Mantine components, hooks and CSS variables before writing custom ones. No inline colour values - take them from the theme.
6. Backend calls go through typed wrappers in the module (`invoke<T>` in one place), not scattered `invoke` strings.

# Rust

1. Standard Rust naming (`snake_case`, `PascalCase` types, `SCREAMING_SNAKE_CASE` consts); `cargo fmt` formatting.
2. Omit default visibility - don't mark things `pub` that are not used outside the module.
3. Errors: propagate with `?`. Errors that reach the frontend carry a message naming the cause (file path, format). `unwrap`/`expect` only for true invariants, with an `expect` message saying which one.
4. The audio callback allocates nothing, never blocks on a lock, does no I/O and never panics.
