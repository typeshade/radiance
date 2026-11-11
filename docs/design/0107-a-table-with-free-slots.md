---
id: '0107'
title: A table of a simulation has free slots, so rows come and go in a table of a fixed size
status: implemented
vision: [D4, D11]
touches:
  - src/sim.ts
  - test/
  - examples/dungeon/
  - README.md
compiler: []
---

# 0107. A table with free slots

**Document control**

| Field          | Record                                                                                              |
| -------------- | --------------------------------------------------------------------------------------------------- |
| Identity       | Design record `0107`, `status: implemented`. The front matter holds the identity and the lifecycle. |
| Date           | Written 2026-11-11 by the repository's coding agent, under decision D9 of `docs/vision.md`.         |
| Baseline       | `typeshade/radiance` `main` `7addd54`.                                                              |
| Compiler pin   | `6d6a979`.                                                                                          |
| Pull request   | The pull request that adds this file.                                                               |
| What is a fact | The step is implemented. The Record section holds the delivered configuration.                      |

## What changes

A kernel function cannot add a row to a table. So the second reference game holds its actors
in a table of a fixed size, and a row of kind `NONE` is a free slot
(`examples/dungeon/README.md`, R1). The game's host code adds the free rows and refuses a level
with too many actors. The dump of the game shows every free row. A monster that comes in gets
its seed from a formula the game wrote (R5).

After this record, the simulation knows that a table has free slots.

### 1. The option

```ts
const sim = createSim(
  { actors, tiles },
  {
    device,
    seed,
    slots: { actors: { size: 16, free: (row) => row.kind === NONE } },
    tick,
  },
);
```

The rules:

1. `slots` names tables of the simulation. A name that is no table is an error that lists the
   tables.
2. `size` is an integer. It is the number of rows of the table. A table with more first rows
   than `size` is an error that gives both numbers.
3. `createSim` adds rows after the first rows up to `size`. Each added row is a new instance
   of the class of the first row. A first row with no class is an error.
4. `free(row)` says if a row is a free slot. An added row must be free. If it is not, the
   error says that `free` must be true for a row with the class's first values.
5. The seed rule of design record 0106 applies to each added row. So each slot has a seed, and
   a tick that brings a row in can take its random numbers from the slot's seed.
6. The simulation does not bring a row in or take one out. The tick does that: it writes a row
   that is not free into a free slot, or a free row over a row.

### 2. The dump

For a table with slots, the dump prints the count and only the rows that are not free.

```text
tick 9  seed 1  hz 60
actors  2 of 16
  [0]  kind 1  x 0  y 0  hp 3  move 0  seed 2212894577  kills 1
  [3]  kind 3  x 3  y 0  hp 4  move 0  seed 91274401  kills 0
tiles
  [0]  kind 1
```

- The line of the table is its name, two spaces, the number of rows that are not free, `of`
  and `size`.
- A row keeps its number. The numbers have gaps where a slot is free.
- `sim.read`, the snapshot and the record do not change. They hold every row.

## Why

- **The tick still decides.** D11 says a game's tick is a function of a `"use typeshade"` file.
  A row that the host brings in is a read of the table in each tick, and on a GPU tier the read
  is late. So the engine takes the parts around the tick and leaves the tick to the game.
- **What the engine cannot take.** The scan for the first free slot is 6 lines of the game's 22. A helper function cannot take a table (`TS8020`), and a closure over a table does not
  emit on WebGPU (typeshade/typeshade#1244). So no library in TypeShade can hold the scan now.
- **The dump is what the agent reads.** A table of 16 slots with 3 actors is 13 lines of zeros.
- **A seed for each slot.** The game's formula for a new monster's seed mixes the run's seed,
  the tick and the row. The slot's seed already holds the first and the last.

## What is not in this record

- A row that the host brings in or takes out.
- A table that grows.
- The scan for a free slot as a library. It waits on typeshade/typeshade#1244.

## What it touches

| Path                 | Change                                                             |
| -------------------- | ------------------------------------------------------------------ |
| `src/sim.ts`         | The option `slots`, the added rows, the dump of a table with slots |
| `test/slots.test.ts` | New: the rules of both sections                                    |
| `examples/dungeon/`  | `createDungeon` gives `slots`. The spawn takes the slot's seed.    |
| `README.md`          | The layout row of this record                                      |

Tests owed:

| Test                                                                      | Verifies      |
| ------------------------------------------------------------------------- | ------------- |
| A table gets rows up to `size`, and each added row is free and has a seed | Design 0107.1 |
| Each error of section 1, with its text                                    | Design 0107.1 |
| The dump of a table with slots equals the text of section 2's form        | Design 0107.2 |
| `sim.read` and the snapshot hold every row                                | Design 0107.2 |
| The second game's tests pass, and its long run replays to the same dump   | Design 0107.1 |

## Implementation, in steps

One step, one pull request. Each commit carries `Design: 0107`.

1. **The slots.** Both sections, their tests and the second game. The game's `README.md`
   records the state of R1 and R5. Set this record to `implemented`.

## Decisions for the owner

The agent made these decisions under D9. The owner can change each one.

1. A table of a simulation can have free slots: a size, and a host function that says if a row
   is free. The simulation adds the free rows and gives each a seed.
2. The dump of such a table shows its count and only the rows that are not free.
3. The tick brings rows in and takes them out. The engine has no call for it.

## Record

- **Approval.** The agent showed the owner the order of work on 2026-11-11, with this item
  second. The owner answered "네, 그 순서로 진행해주세요". The owner's rule of 2026-11-11
  approves a merge with green checks in advance (`CLAUDE.md`, Merging).
- **Validation.** The delivered configuration, 2026-11-11, compiler pin `6d6a979`:

  | Step | Pull request | Commit on `main` | What ran                                          |
  | ---- | ------------ | ---------------- | ------------------------------------------------- |
  | 1    | this one     | its merge commit | `bun run check`, 108 tests. `bun run harness`, 4. |

  The second game's tests pass, and its long run replays to the same dump.

- **Deviations.**
  - `createSim` also refuses slots with no size or no function `free`. The record did not list
    that error. Closed: a test holds its text.
  - The game's `turn` lost its parameter `seed`, since the slot's seed takes its place. The
    record said only that the spawn takes the slot's seed. Closed.
  - Design record 0106 and the game's `README.md` said that `nodeSeed` is no public name. It
    is an export of `radiance`. Closed: the `README.md` says so now.
