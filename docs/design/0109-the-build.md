---
id: '0109'
title: The engine builds a project into a page and holds its size to a budget
status: implemented
vision: [D5, D6, D12, D13, D14]
touches:
  - src/build.ts
  - src/cli.ts
  - src/config.ts
  - src/project.ts
  - test/
  - examples/factory/
  - package.json
  - .github/workflows/ci.yml
  - README.md
compiler:
  - typeshade/typeshade#1259
---

# 0109. The build

**Document control**

| Field          | Record                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------ |
| Identity       | Design record `0109`, `status: accepted`. The front matter holds the identity and the lifecycle. |
| Date           | Written 2026-11-11 by the repository's coding agent, under decision D9 of `docs/vision.md`.      |
| Baseline       | `typeshade/radiance` `main` `eba66a4`.                                                           |
| Compiler pin   | `6d6a979`.                                                                                       |
| Pull request   | The pull request that adds this file.                                                            |
| What is a fact | The measurement of section 1. No step is implemented.                                            |

## What changes

Decision D13 says that a build gives a small result. Decision D14 says that the framework
manages the project, with one command for development and one for the build. Today the first
reference game has its own `vite.config.ts`, `index.html` and `main.ts`, and nothing holds the
size of its page.

After this record, the engine builds a project. A game has no build file, no page file and no
entry file. The size of what the page loads is a number, and a budget holds it.

### 1. The measurement

| Item     | Value                                                                 |
| -------- | --------------------------------------------------------------------- |
| Date     | 2026-11-11                                                            |
| Commits  | `typeshade/radiance` `eba66a4`, compiler pin `6d6a979`                |
| Tools    | Vite 7.3.7, `target: es2022`, the compiler's plugin with its defaults |
| The page | `examples/factory`, as its own `vite.config.ts` builds it             |

The page loads one script: 306,828 bytes, 94,420 with gzip. Its modules, by their size before
the bundler makes them small:

| Owner                                            | Bytes   | Share |
| ------------------------------------------------ | ------- | ----- |
| The compiler's runtime                           | 460,534 | 80%   |
| The game's `"use typeshade"` modules, as emitted | 82,309  | 14%   |
| The engine                                       | 28,243  | 5%    |
| The game's host code                             | 3,803   | 1%    |

With the compiler's option `fuse: false`, the page loads 282,680 bytes, 92,650 with gzip, and
the browser check still passes.

Inference, not measured: about 165,000 bytes of the compiler's runtime serve the CPU tier,
which a page of a shipped game does not open (D12).

So the engine's own part of the size is small. Most of the size is the compiler's, and compiler
issue typeshade/typeshade#1259 asks for the work. This record does what the engine can do, and
it makes the number a check, so that each later change shows its cost.

### 2. The config

`radiance.config.ts` gains four entries.

```ts
export default defineGame({
  name: 'Factory',
  tick: ['tick'],
  values: ['width', 'height'],
  start: { level: 'demo', seed: 1 },
  budget: 300_000,
});
```

1. `name` is the title of the page. The name of the project's directory when not given.
2. `start.level` names the file of `levels/` that the page starts with. A project with no
   `start` builds no page, and `radiance build` says so.
3. `start.seed` is the seed of the run. When it is not given, the page takes a seed from the
   clock at its start.
4. `budget` is the most bytes of script that the page loads at its start, before gzip. A build
   over the budget fails. A project with no budget builds with no such check.
5. `fuse: true` keeps the compiler's records of fusion in the page. They are left out when it
   is not given, since a game that calls no `fuse` does not read them.

### 3. The build

```sh
radiance build examples/factory
```

1. The command runs `radiance sync` for the project.
2. It writes `.radiance/main.ts` and `.radiance/index.html`. The page is one canvas that fills
   the window. `main.ts` sizes the canvas to its place on the page and calls `run` with the
   game's class, the level of `start` and the seed.
3. It builds the page into `<project>/dist` with Vite and the compiler's plugin. The game
   gives no file of Vite.
4. It prints one line for each script it wrote, and one line for the page: the bytes of the
   scripts that the page loads at its start, before and with gzip. It writes the same numbers
   to `dist/size.json`.
5. When the project has a `budget` and the page loads more, the command prints the two
   numbers and ends with exit code 1.
6. `--hook` puts the running game on `globalThis.game`, and makes `?manual` in the address
   stop the loop. A browser check uses it. A build with no `--hook` has neither.

The scripts that the page loads at its start are the entry script and each script it imports
with a static import. A script that the page imports later, such as the WebGL2 runtime, is not
in the number.

### 4. The development server

```sh
radiance dev examples/factory
```

1. The command runs the sync, writes the two files of section 3 and starts Vite's server on
   the project.
2. When a file of `state/`, `scratch/`, `systems/`, `draw/` or `input/` is added or removed,
   the command runs the sync again.
3. A change to `radiance.config.ts` needs a new start of the command. The command says so
   when the file changes.

### 5. What the project loses

The first reference game loses `vite.config.ts`, `index.html` and `main.ts`. Its browser check
builds the project with the engine's build and `--hook`, and drives the page as a player does:
a drag of the pointer puts the belt.

## Why

- **The game has no build file.** D14: the framework manages the project. A file that each
  game copies is a file that each game can get wrong.
- **The number is a check.** D13 keeps the size a number in CI. A budget in the project fails
  the build at the change that passes it, with the two numbers.
- **What the page loads at its start, not what is built.** A script that most players never
  load is no cost to them. The WebGL2 runtime is already such a script.
- **`fuse` off unless asked.** The measurement gives 24,148 bytes for a game that fuses nothing.
- **The hook is an option.** A shipped game has no handle on `globalThis` and no switch in its
  address.
- **The engine does not work around the compiler's size.** A copy of the runtime without the
  CPU tier would drift from the compiler. The size is recorded as a cost of D13 until the
  compiler has the work of issue #1259.

## The cost against decision D13

At this record's baseline the page of the first reference game loads 306,828 bytes. With this
record it is expected to load about 283,000. The engine cannot take the next step: about 80%
of the script is the compiler's runtime. When the pin has the work of compiler issue #1259,
the budget of the reference game goes down in the pull request that moves the pin.

## What is not in this record

- A package for a store (D6) and its shell (U9).
- A page file that a game writes itself.
- A split of the engine's tools (the dump, the snapshot, the record) from a shipped page. They
  are 5% of the script with the rest of the engine.
- A restart of the server on a change of the config.

## What it touches

| Path                       | Change                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| `src/build.ts`             | New: the page's two files, the build, the sizes, the budget, the server                    |
| `src/cli.ts`               | `radiance build` and `radiance dev`                                                        |
| `src/config.ts`            | `name`, `start`, `budget`, `fuse`                                                          |
| `test/build.test.ts`       | New                                                                                        |
| `examples/factory/`        | No `vite.config.ts`, no `index.html`, no `main.ts`. The config gains `start` and `budget`. |
| `package.json`             | `build:factory` calls `radiance build`. `vite` moves to `dependencies`.                    |
| `.github/workflows/ci.yml` | The harness job keeps its name. It builds with the engine's build.                         |
| `README.md`                | The two commands                                                                           |

Tests owed:

| Test                                                                            | Verifies      |
| ------------------------------------------------------------------------------- | ------------- |
| The two files that the build writes, as text, with and without `--hook`         | Design 0109.3 |
| A project with no `start` is refused with the fact and a remedy                 | Design 0109.2 |
| The size of a page counts the entry and its static imports, and no later import | Design 0109.3 |
| A build over its budget fails and names the two numbers                         | Design 0109.3 |
| The harness: the built page runs on WebGPU, and a drag puts a belt              | Design 0109.5 |
| The harness: the cells of the GPU device equal the cells of the CPU device      | Design 0109.5 |
| The harness: the development server serves the page                             | Design 0109.4 |
| The runtime imports no module of the build                                      | Design 0109.3 |

## Implementation, in steps

Each step is one pull request. Each commit carries `Design: 0109`.

1. **The build.** Sections 2, 3 and 5 with their tests. The first reference game moves to it,
   and its `README.md` records the bytes before and after.
2. **The server.** Section 4 and its check. Set this record to `implemented`.

## Decisions for the owner

The agent made these decisions under D9. The owner can change each one.

1. The engine builds the page. A game has no `vite.config.ts`, no `index.html` and no entry
   file.
2. The config names the level and the seed that the page starts with.
3. The budget is in bytes of script that the page loads at its start, before gzip.
4. The compiler's records of fusion are left out unless the config asks for them.
5. The engine does not remove the compiler's CPU tier itself. Compiler issue #1259 asks for it.

## Record

- **Approval.** The agent showed the owner the measurement and this scope on 2026-11-11. The
  owner answered: "네, 그 범위로 진행해주세요". The owner's rule of 2026-11-11 approves a merge
  with green checks in advance (`CLAUDE.md`, Merging).
- **Validation.** Step 1, on 2026-11-11, compiler pin `6d6a979`: `bun run check` passed with
  124 tests. `bun run harness` passed with 4 checks in headless Chromium, WebGPU on SwiftShader.
  The page of the factory loads 282,641 bytes, 92,580 with gzip. It loaded 306,828 bytes before.
  Step 2, on 2026-11-11, same pin: `bun run harness` passed with 5 checks. The fifth opens the
  page of the development server, and adds and removes a file of `input/`.
- **Deviations.** None.
