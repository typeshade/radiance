---
id: '0103'
title: The reference game runs in a browser on WebGPU, and a harness holds its cells, its picture and its size
status: accepted
vision: [D4, D10, D11, D12]
touches:
  - examples/factory/
  - vitest.harness.config.ts
  - package.json
  - .github/workflows/ci.yml
  - README.md
compiler: []
---

# 0103. The game in a browser

**Document control**

| Field          | Record                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------ |
| Identity       | Design record `0103`, `status: accepted`. The front matter holds the identity and the lifecycle. |
| Date           | Written 2026-11-11 by the repository's coding agent, under decision D9 of `docs/vision.md`.      |
| Baseline       | `typeshade/radiance` `main` `11fdef9`.                                                           |
| Compiler pin   | `6d6a979`.                                                                                       |
| Pull request   | The pull request that adds this file.                                                            |
| What is a fact | A spike ran before this record was offered (section 5). No step is merged.                       |

## What changes

Each thing the engine has runs in a test, on the CPU tier. Decisions D10 to D12 say what a
shipped game is: the game's code on the compiler's runtime, with its tick on a GPU tier. No
such game was run. This record makes the reference game `examples/factory` that game, written
by hand on the raw structure, and it adds the gate that holds it.

The owner asked for this order on 2026-11-11. The game on a screen shows what is hard in
drawing and in input, and it gives the size of a shipped game its first true number.

### 1. The game in a page

`examples/factory` gains a page: `index.html`, `main.ts` and `draw.shade.ts`.

- **The device.** `createDevice({ prefer: ['webgpu', 'webgl2'] })`. The CPU tier is not in the
  list (D12).
- **The tick.** The cells are two arrays on the device. A frame calls `tick(next, prev, ...)`
  for each tick that is due, and swaps the two. The tick rate is fixed at 30 in a second.
- **The picture.** A fragment entry `draw` reads the cells where they are on the device and
  gives each pixel its colour. Nothing is read back to the host (compiler surface §67).
- **The input.** A drag of the pointer puts belts along its path. The host cannot write one row
  of an array on the device, so a kernel function `place(cells, at, kind, dir)` writes it. The
  page queues each edit and calls `place` at the start of the next tick.
- **The build.** `vite build` with the compiler's plugin makes the page in `examples/factory/dist`.

The page uses nothing of the engine. `main.ts` is the thin loop that D10 leaves in a shipped
game, written by hand.

### 2. The harness

`bun run harness` runs the files `examples/**/*.harness.ts` under Vitest. It is a second test
run, so `bun run test` needs no browser.

The harness of the factory builds the page, opens it in headless Chromium with WebGPU on
SwiftShader, and holds four things:

| Check   | What it holds                                                                                                                                                                                              |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tier    | The page's device opened `webgpu`.                                                                                                                                                                         |
| Cells   | The page runs 50 ticks, puts a belt in one cell and runs 150 more ticks. The cells read from the device equal the cells of the CPU tier's simulation. The simulation gets the same input at the same tick. |
| Picture | In a screenshot of the page, a pixel of a source is green and a pixel of an empty cell is dark.                                                                                                            |
| Size    | The bytes of the built files, and the bytes of the files the page requested, are printed.                                                                                                                  |

The cells check is the gate of D12: the CPU tier is the reference, and a GPU tier is held to
it.

### 3. The size as a number

The harness prints two numbers: the bytes built and the bytes the page loaded. The second is
the size of a shipped game (measurement M7 of `docs/vision.md`).

This record sets no limit. A limit that fails the gate comes with the record that first makes
the number smaller, so that the limit is a result and not a guess.

### 4. CI

The job `harness (headless WebGPU)` gets its steps back: it installs Playwright's Chromium, runs
`bun run harness`, and keeps the screenshot as an artifact. The job has had no steps since pull
request #83.

### 5. The spike

| Item     | Value                                                       |
| -------- | ----------------------------------------------------------- |
| Date     | 2026-11-11                                                  |
| Compiler | `6d6a979`, the pin                                          |
| Browser  | Headless Chromium, Playwright 1.63.0, WebGPU on SwiftShader |
| Result   | The four checks of section 2 passed                         |

Observed:

- The device opened `webgpu`.
- The cells of the GPU equal the cells of the CPU tier after 200 ticks with one input.
- The picture shows the grid, the sources, the belts with their items and the machines.
- The build is 605,905 bytes in three files. The page requested one of them: 278,406 bytes, and
  86,653 bytes with gzip. The other two are the WebGL2 runtime and the planner of `fuse`, which
  the page did not load.
- A copy of the WebGPU canvas into a 2D canvas gave black pixels, so the picture check reads a
  screenshot.

Not observed: a real phone, a WebView, WebGL2 (compiler issue typeshade/typeshade#809), and the
frame time.

## Why

- **By hand first.** The owner asked for the reference game on the raw structure, so that each
  engine feature has a measured reason. Drawing and input are not in the game's list of what
  was hard, since the game did neither.
- **A harness apart from the tests.** A test of the engine must run with no device
  (`docs/vision.md`, section 5). A check that needs a browser is a second run.
- **No limit on the size yet.** The number is the compiler's runtime for the most part. A limit
  set now can only be the number measured now.

## What is not in this record

- An engine feature. The game's `README.md` gains what was hard in the page, as P9 onward.
- The simulation of design record 0102 on a device. The page's loop is written by hand.
- WebGL2, a phone, a store package, sound and a save.

## What it touches

| Path                                  | Change                                                         |
| ------------------------------------- | -------------------------------------------------------------- |
| `examples/factory/cells.shade.ts`     | The kernel function `place`                                    |
| `examples/factory/draw.shade.ts`      | New: the class `View` and the fragment entry `draw`            |
| `examples/factory/main.ts`            | New: the device, the loop, the pointer                         |
| `examples/factory/index.html`         | New: the page                                                  |
| `examples/factory/vite.config.ts`     | New: the build                                                 |
| `examples/factory/level.ts`           | The level of the page, `DEMO`                                  |
| `examples/factory/factory.harness.ts` | New: the four checks                                           |
| `examples/factory/README.md`          | What was hard in the page, counted                             |
| `vitest.harness.config.ts`            | New: the harness run                                           |
| `package.json`, `bun.lock`            | `playwright` 1.63.0, the scripts `harness` and `build:factory` |
| `.github/workflows/ci.yml`            | The steps of the job `harness (headless WebGPU)`               |
| `README.md`                           | The page and the harness                                       |

Tests owed:

| Test                                                 | Verifies      |
| ---------------------------------------------------- | ------------- |
| The four checks of section 2                         | Design 0103.2 |
| `place` on the CPU tier writes one cell and no other | Design 0103.1 |

## Implementation, in steps

Each commit carries `Design: 0103`.

1. **The page and the harness.** Everything of the table above, in one pull request. Set this
   record to `implemented` with the delivered configuration.

## Decisions for the owner

The agent made these decisions under D9. The owner can change each one.

1. The reference game gets a page that runs its tick on a GPU device, draws its cells with one
   fragment entry and takes belts from the pointer. The page uses nothing of the engine.
2. A harness, apart from the tests, opens the page in headless Chromium and holds the tier, the
   cells against the CPU tier, and the picture.
3. The harness prints the size of the shipped game. No limit fails the gate yet.
4. The CI job `harness (headless WebGPU)` runs the harness.

## Record

- **Approval.** The owner's rule of 2026-11-11 approves a merge with green checks in advance
  (`CLAUDE.md`, Merging). The owner asked for this order of work in the conversation on
  2026-11-11: "네, 그 순서로 진행해주세요".
- **Validation.** Does not yet apply: no step is merged.
- **Deviations.** None.
