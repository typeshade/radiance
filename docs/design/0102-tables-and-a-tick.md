---
id: '0102'
title: The engine's tools run tables and a tick function, so a game on the raw structure has a dump, inputs and a replay
status: implemented
vision: [D4, D10, D11]
touches:
  - src/sim.ts
  - src/index.ts
  - test/
  - examples/factory/
  - README.md
compiler: []
---

# 0102. Tables and a tick

**Document control**

| Field          | Record                                                                                              |
| -------------- | --------------------------------------------------------------------------------------------------- |
| Identity       | Design record `0102`, `status: implemented`. The front matter holds the identity and the lifecycle. |
| Date           | Written 2026-11-11 by the repository's coding agent, under decision D9 of `docs/vision.md`.         |
| Baseline       | `typeshade/radiance` `main` `4dc24b1`.                                                              |
| Compiler pin   | `6d6a979`.                                                                                          |
| Pull request   | The pull request that adds this file.                                                               |
| What is a fact | The two steps are implemented. The Record section holds the delivered configuration.                |

> **Changed by design record 0104.** The tables of a simulation now live on a device of the
> compiler's runtime. `device` is a required option, the tick gets the compiler's `Resident`s,
> `sim.rows(name)` is `sim.read(name)` and returns a promise, and `dump` and `snapshot` return
> promises. Design record 0104 (section 5) lists each change. The text below is the design as
> this record delivered it.

## What changes

Decision D11 makes a game's tick a function of a `"use typeshade"` file. The reference game is
written that way, and the engine's tools did not apply to it: `scene`, `dump` and `replay` read
the world of design record 0100, which calls `step` on each instance. The game wrote its own
loop, and it has no input, no record and no replay (`examples/factory/README.md`, P3, P5, P7).

After this record, the engine's tools run a game on the raw structure: named tables and one
tick function. The record takes away P7, the part of P3 that the host writes, and the tools of
P5. The level's parser and its picture as text stay with the game: they are the game's content.

### 1. A simulation

```ts
import { createSim } from 'radiance';
import { Cell, tick } from './cells.shade.ts';

const sim = createSim(
  { cells: level.cells },
  {
    seed: 1,
    buffered: ['cells'],
    tick: (t) => tick(t.cells.write, t.cells.read, level.width, level.height),
  },
);
await sim.step(200);
```

- `createSim(tables, options)` takes the first rows of each table by name. A row is an instance
  of a class of a `"use typeshade"` file. The simulation keeps a copy of the rows.
- `options.seed` is required. `options.hz` is 60 when it is not given. Both are as in design
  record 0100.
- `options.tick(tables, time)` runs one tick. It can return a promise, and the simulation waits
  for it. `time.dt` is `Math.fround(1 / hz)`, and `time.tick` is the number of ticks run.
- `sim.step(n)` returns a promise. It runs `n` ticks, 1 when `n` is not given.

### 2. A buffered table

A tick that reads the state of every row and writes every row needs two arrays, or its result
depends on the order of the rows. `options.buffered` names such tables.

- For a buffered table the tick gets `{ read, write }`: two arrays of the same length. For any
  other table it gets the array of rows.
- After each tick the simulation swaps the two arrays of each buffered table.
- The author does not write the swap, and cannot forget it.

### 3. The rows, the dump and the snapshot

- `sim.rows(name)` returns the rows of a table as they are after the last tick. For a buffered
  table, that is the array the last tick wrote.
- `sim.dump()` returns text: the header of design record 0100, then each table's name on a line
  and each row on a line below it, as `[index]` and each field with its value. The values are
  printed by the rules of design record 0100 (section 4, rules 5 to 8).
- `sim.snapshot()` returns a plain object that JSON holds: `version` 1, `tick`, `seed`, `hz` and
  `tables`, where each table has its `name` and its `rows` as objects of fields.

```text
tick 2  seed 1  hz 60
cells
  [0]  kind 2  dir 1  item 0  wait 5  stock 0  made 1
  [1]  kind 1  dir 1  item 1  wait 2  stock 0  made 0
```

### 4. An input, the record and the replay

These follow design record 0101, with a row named by its table and its index.

- `sim.input(table, index, fields)` checks the input and queues it. The next tick applies the
  queue before it calls `options.tick`, and records each input with its tick.
- `sim.record()` returns `version` 1, `seed`, `hz`, `ticks` and `inputs`. An input is `tick`,
  `table`, `index` and `fields`.
- `replaySim(tables, options, record)`, from `radiance/test`, builds a simulation from the same
  first rows and options, with the record's `seed` and `hz`. It gives each input at its tick and
  runs the record's ticks. It returns a promise of the simulation.
- The invariant: a replay gives the same dump as the run that made the record.

### 5. The errors

Each error is a fact and a remedy, as in design records 0100 and 0101: a table the simulation
does not hold, an index outside a table, a field the class does not declare, a value JSON
cannot hold, a buffered name that is no table, and a record this engine cannot run.

## Why

- **Tables by name.** The tick function's parameters are tables. A name for each one is what the
  dump, the input and the tick share.
- **The swap belongs to the tool (P3).** The rule "read one array, write the other, then swap"
  has no check when the host writes it.
- **A promise.** A kernel function called with plain arrays returns a promise (compiler surface
  §65). A simulation that hides the promise cannot run on a GPU tier later.
- **The world of record 0100 stays.** It runs classes that have a `step` method, with no tick
  function, and its tests hold its contract. This record adds the second way and removes
  nothing. A later record joins a scene of nodes to tables.

## What is not in this record

- A scene of nodes that makes the tables, and the index of a node's parent.
- A simulation on a GPU device. The tick runs where the kernel function runs: the CPU tier in a
  test.
- A seed for a row.
- The build of a shipped game and its thin loop.
- A grid (P1, P2). It waits on compiler issue typeshade/typeshade#1244.

## What it touches

| Path                | Change                                                                      |
| ------------------- | --------------------------------------------------------------------------- |
| `src/sim.ts`        | New: `createSim`, `Sim`, the types                                          |
| `src/test.ts`       | `replaySim`                                                                 |
| `src/index.ts`      | The exports                                                                 |
| `test/sim.test.ts`  | New                                                                         |
| `examples/factory/` | The game uses `createSim`. Its `README.md` shows the code before and after. |
| `README.md`         | The simulation in "What runs today"                                         |

Tests owed:

| Test                                                                                  | Verifies      |
| ------------------------------------------------------------------------------------- | ------------- |
| A simulation keeps a copy of the first rows, and `step` waits for the tick            | Design 0102.1 |
| A buffered table gives `read` and `write`, and the two swap after each tick           | Design 0102.2 |
| The dump and the snapshot of a fixed simulation equal golden files                    | Design 0102.3 |
| An input applies before the tick, and a record replays to the same dump               | Design 0102.4 |
| Each error of section 5, with its text                                                | Design 0102.5 |
| The reference game gives the same twelve frames with `createSim` as with its own loop | Design 0102.1 |

## Implementation, in steps

Each step is one pull request. Each commit carries `Design: 0102`.

1. **The simulation.** `src/sim.ts`, `replaySim` and their tests.
2. **The reference game.** `examples/factory` uses `createSim`. Its `README.md` shows the host
   code before and after, with the lines counted, and says what is still hard. `README.md` of
   the repository names the simulation. Set this record to `implemented`.

## Decisions for the owner

The agent made these decisions under D9. The owner can change each one.

1. A simulation is named tables and one tick function. `step` returns a promise.
2. A buffered table has two arrays, and the simulation swaps them after each tick.
3. The dump and the snapshot print each table by name and each row by index.
4. An input names a row by its table and its index. A record replays to the same dump.
5. Each error is a fact and a remedy.

## Record

- **Approval.** The owner's rule of 2026-11-11 approves a merge with green checks in advance
  (`CLAUDE.md`, Merging). The owner asked for this order of work in the conversation on
  2026-11-11: "네, 그 순서로 진행해주세요".
- **Validation.** The delivered configuration, 2026-11-11, compiler pin `6d6a979`:

  | Step | Pull request | Commit on `main` | What ran                  |
  | ---- | ------------ | ---------------- | ------------------------- |
  | 1    | #100         | `5422ad6`        | `bun run check`, 77 tests |
  | 2    | this one     | its merge commit | `bun run check`, 80 tests |

  The reference game gives the same twelve frames on the simulation as on its own loop.

- **Deviations.**
  - The record said that the game's host code shows its lines before and after. The lines did
    not go down: `level.ts` went from 105 to 121. `examples/factory/README.md` says so and says
    what the gain is. Closed.
