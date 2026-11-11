---
id: '0104'
title: A simulation runs on a device, so a test on the CPU tier and a page on a GPU tier run the same code
status: implemented
vision: [D4, D10, D11, D12]
touches:
  - src/sim.ts
  - src/page.ts
  - src/test.ts
  - src/index.ts
  - test/
  - examples/factory/
  - README.md
  - docs/design/0102-tables-and-a-tick.md
compiler: []
---

# 0104. The simulation on a device

**Document control**

| Field          | Record                                                                                              |
| -------------- | --------------------------------------------------------------------------------------------------- |
| Identity       | Design record `0104`, `status: implemented`. The front matter holds the identity and the lifecycle. |
| Date           | Written 2026-11-11 by the repository's coding agent, under decision D9 of `docs/vision.md`.         |
| Baseline       | `typeshade/radiance` `main` `c7f0156`.                                                              |
| Compiler pin   | `6d6a979`.                                                                                          |
| Pull request   | The pull request that adds this file.                                                               |
| What is a fact | The two steps are implemented. The Record section holds the delivered configuration.                |

## What changes

The simulation of design record 0102 holds its tables as arrays of the host. So it runs in a
test and not in a page. The reference game's page wrote its loop, the swap of its two arrays
and its input by hand, and it has no record and no replay (`examples/factory/README.md`, P9,
P10 and P13). The harness gives one input to the CPU tier as field values and to the device as
a call of the game's own function, and nothing says that the two are the same input.

After this record, a simulation holds its tables on a device of the compiler's runtime. A test
gives it a device of the CPU tier. A page gives it a device of a GPU tier. The game's code is
the same in both.

This record changes the interface of design record 0102. Section 5 lists each change.

### 1. A device

```ts
import { createDevice } from 'typeshade/runtime';
import { createSim } from 'radiance';

const device = await createDevice({ prefer: ['cpu'] }); // a test
// const device = await createDevice({ prefer: ['webgpu', 'webgl2'] }); // a page

const sim = createSim(
  { cells },
  {
    device,
    seed: 1,
    buffered: ['cells'],
    tick: (t) => tick(t.cells.write, t.cells.read, width, height),
  },
);
```

- `options.device` is required. The simulation puts a copy of each table's first rows on it,
  as the compiler's `Resident` (surface §65).
- The tick gets a `Resident` for each table, and `{ read, write }` of two for a buffered table.
  A kernel function takes a `Resident` where it takes an array.
- The simulation makes no device and disposes none. The host owns the device.

### 2. The step

`sim.step(n)` returns a promise. For each tick it applies the queued inputs, calls the tick
function, waits for what the call returns, swaps the two handles of each buffered table and
adds 1 to `tick`.

On a GPU tier a kernel call is queued and returns at once. So `step` resolves when its ticks
are queued, and not when the GPU has run them. `sim.wait()` resolves when the device has run
every call made so far.

### 3. Reading

A table lives on the device, so each read is a promise.

| Member            | Result                                                                |
| ----------------- | --------------------------------------------------------------------- |
| `sim.table(name)` | The table's `Resident` as it is after the last tick. A draw takes it. |
| `sim.read(name)`  | A promise of the table's rows, read from the device                   |
| `sim.dump()`      | A promise of the text of design record 0102                           |
| `sim.snapshot()`  | A promise of the object of design record 0102                         |

A read from a GPU tier waits for the device. A game's frame does not call it. The picture reads
the table on the device through `sim.table(name)`.

### 4. An input

`sim.input(table, index, fields)` is as in design record 0102: checked at once, applied at the
start of the next tick, recorded with that tick. It is one thing on each tier.

To apply the inputs of a tick, the simulation reads each table that has an input, writes the
field values into the rows, and writes the rows back. On a GPU tier that is one read of the
table from the device for each tick that has an input. A tick with no input reads nothing.

The check of an input needs the fields of a row. The simulation keeps them from the first rows.

### 5. What changes in design record 0102

| Design record 0102                       | This record                                              |
| ---------------------------------------- | -------------------------------------------------------- |
| No `device` option                       | `device` is required                                     |
| The tick gets arrays of rows             | The tick gets `Resident`s                                |
| `sim.rows(name)` returns the rows        | Removed. `sim.read(name)` returns a promise of the rows. |
| `sim.dump()` and `sim.snapshot()` return | Each returns a promise                                   |
| No way to hand a table to a draw         | `sim.table(name)`                                        |
| No `sim.wait()`                          | `sim.wait()`                                             |

The record, the replay, the errors and the text of the dump do not change. `replaySim` takes the
`device` in its options.

### 6. The frames of a page

`radiance/page` is a new entry with one function.

```ts
import { frames } from 'radiance/page';

frames(sim, () => draw(canvas, { cells: sim.table('cells'), view }));
```

`frames(sim, draw, options)` runs the simulation in a page. In each animation frame it runs the
ticks that are due at the simulation's tick rate, at most `options.maxTicks` of them (8 when
not given), then calls `draw`. A frame does not start while the frame before it still applies
inputs. It returns a function that stops the loop.

`radiance/page` reads the clock of the page. It is the one file under `src/` that does, and the
scan of design record 0100 (invariant 3) excludes it by name.

### 7. The probe

| Item     | Value                                                                                                                                                                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date     | 2026-11-11                                                                                                                                                                                                                                              |
| Compiler | `6d6a979`, the pin                                                                                                                                                                                                                                      |
| Place    | A Vitest test in Node, with no browser                                                                                                                                                                                                                  |
| Result   | `createDevice({ prefer: ['cpu'] })` opened the CPU tier. Two kernel functions ran on `Resident`s made with `device.array(rows)`. `read()` returned instances of the rows' class. `write(rows)` replaced the handle's rows, and the next call read them. |

## Why

- **One code path.** The CPU tier is the reference, and a GPU tier is held to it (D12). That
  gate is true only when both run the same code with the same inputs.
- **The compiler's device, not a second store.** The compiler has a device of the CPU tier.
  A simulation with a store of its own for tests is a second implementation to keep equal.
- **Promises for reads.** A browser returns a GPU result asynchronously. A read that looks
  immediate on the CPU tier and is not on a GPU tier is the error this record removes.
- **An input by a read and a write.** The compiler has no write of one row of a `Resident`
  (its proposal 0048 is a draft). A read and a whole write is correct on each tier. Its cost is
  one read for each tick with an input, which is the rate of a person's hand. The harness
  measures it.

## The cost against decision D10

D10 says that the engine adds no runtime of its own to a shipped game, and that the build
writes the thin loop. This record puts `createSim` and `frames` in the page. That is engine
code in a shipped game: the loop, the inputs, and also the dump, the snapshot and the record,
which a shipped game does not use.

The record takes this cost for now, since no build exists that writes the loop. Step 2
measures the bytes the page gains, and the game's `README.md` records the number. The build
that removes the tools from a shipped game is a later record.

## What is not in this record

- The build that writes the thin loop and removes the tools.
- A write of one row on the device. It waits on the compiler's proposal 0048.
- A grid, the kinds as classes, a save.

## What it touches

| Path                                    | Change                                                         |
| --------------------------------------- | -------------------------------------------------------------- |
| `src/sim.ts`                            | The tables on a device. The interface of section 5.            |
| `src/page.ts`                           | New: `frames`                                                  |
| `src/test.ts`                           | `replaySim` takes the `device`                                 |
| `package.json`                          | The entry `radiance/page`                                      |
| `test/sim.test.ts`                      | The tests run on a device of the CPU tier                      |
| `test/dump.test.ts`                     | The scan excludes `src/page.ts`                                |
| `examples/factory/`                     | `createFactory` takes a device. The page uses it and `frames`. |
| `docs/design/0102-tables-and-a-tick.md` | A note that this record changes its interface                  |
| `README.md`                             | The example of a simulation                                    |

Tests owed:

| Test                                                                                                                    | Verifies      |
| ----------------------------------------------------------------------------------------------------------------------- | ------------- |
| Each test of design record 0102, on a device of the CPU tier                                                            | Design 0104.1 |
| `step` waits for the tick, and `wait` for the device                                                                    | Design 0104.2 |
| `table` gives the handle the last tick wrote, for a buffered table too                                                  | Design 0104.3 |
| A tick with no input reads no table                                                                                     | Design 0104.4 |
| The harness: the page and the test build the factory with one function, and their cells are equal after the same inputs | Design 0104.1 |
| `frames` runs the ticks that are due and no more than `maxTicks`, with a clock the test gives                           | Design 0104.6 |

## Implementation, in steps

Each step is one pull request. Each commit carries `Design: 0104`.

1. **The simulation on a device.** `src/sim.ts`, `replaySim` and the tests. The reference game's
   tests move to a device of the CPU tier in the same pull request, since the interface changes.
2. **The page.** `src/page.ts`. The reference game's page uses `createFactory` and `frames`. The
   harness builds the factory with the same function on each tier. The game's `README.md` shows
   `main.ts` before and after, with the lines and the bytes. Set this record to `implemented`.

## Decisions for the owner

The agent made these decisions under D9. The owner can change each one.

1. A simulation holds its tables on a device that the host gives it. A test gives a device of
   the CPU tier, and a page a device of a GPU tier.
2. `step` resolves when its ticks are queued. `wait` resolves when the device has run them.
3. Each read of a table is a promise. `table` gives the handle for a draw.
4. An input is applied by a read of its table and a whole write.
5. The interface of design record 0102 changes as section 5 lists.
6. `radiance/page` has `frames`, the loop of a page. It is the one file that reads a clock.
7. The page of a game holds engine code until a build writes the thin loop. The bytes are
   measured.

## Record

- **Approval.** The owner's rule of 2026-11-11 approves a merge with green checks in advance
  (`CLAUDE.md`, Merging). The owner asked for this order of work in the conversation on
  2026-11-11: "네, 그 순서로 진행해주세요".
- **Validation.** The delivered configuration, 2026-11-11, compiler pin `6d6a979`:

  | Step | Pull request | Commit on `main` | What ran                                         |
  | ---- | ------------ | ---------------- | ------------------------------------------------ |
  | 1    | #105         | `89f4ec1`        | `bun run check`, 82 tests. `bun run harness`, 4. |
  | 2    | this one     | its merge commit | `bun run check`, 87 tests. `bun run harness`, 4. |

  The harness ran in headless Chromium (Playwright 1.63.0) with WebGPU on SwiftShader. After
  200 ticks with one belt put at tick 50, the cells of the GPU device equal the cells of the
  CPU device. One function builds the factory on each tier, and one function gives the input.

  The bytes of step 2, as the section on D10 asks: the page loaded 278,406 bytes before and
  276,081 after. With gzip it loaded 86,653 before and 87,984 after. `main.ts` went from 115
  lines to 82. `examples/factory/README.md` holds the table.

- **Deviations.**
  - `createSim` refuses a table with no row, since a device holds no empty array. The record
    did not say so. Closed: the refusal names the table and the remedy, and a test holds it.
  - The reference game's kernel function `place` and its test are removed. The record said
    only that the page uses `createFactory`. Closed: `putCell` of `level.ts` takes its place.
  - No device was measured other than headless Chromium on SwiftShader. Open: the
    measurements M1 to M6 of `docs/vision.md` wait for a phone.
