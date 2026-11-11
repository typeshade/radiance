---
id: '0106'
title: A simulation gives each row a seed, and a record replays from the function that builds the game
status: implemented
vision: [D3, D4, U2]
touches:
  - src/sim.ts
  - src/test.ts
  - test/
  - examples/dungeon/
  - examples/factory/
  - README.md
compiler: []
---

# 0106. Row seeds and a replay from a builder

**Document control**

| Field          | Record                                                                                              |
| -------------- | --------------------------------------------------------------------------------------------------- |
| Identity       | Design record `0106`, `status: implemented`. The front matter holds the identity and the lifecycle. |
| Date           | Written 2026-11-11 by the repository's coding agent, under decision D9 of `docs/vision.md`.         |
| Baseline       | `typeshade/radiance` `main` `cc57980`.                                                              |
| Compiler pin   | `6d6a979`.                                                                                          |
| Pull request   | The pull request that adds this file.                                                               |
| What is a fact | The step is implemented. The Record section holds the delivered configuration.                      |

## What changes

The second reference game wrote two things by hand that the engine can do
(`examples/dungeon/README.md`, R5 and R8).

- The simulation gives a row no seed. The game imports `nodeSeed` from `src/seed.ts`, which is
  no public name, and fills the seed of each actor.
- `replaySim` asks for the tables and the tick. The function that builds the game holds both.
  So one game's test wrote the replay by hand, and the other gave the tables a second time.

After this record, the simulation fills the seeds, and a record replays from the function
that builds the game.

### 1. The seed of a row

A class of a table that needs random numbers declares a field named `seed` with the value 0.

```ts
export class Actor {
  kind: u32 = 0;
  seed: u32 = 0;
}
```

The rules:

1. When a row of the first rows has a field named `seed` and its value is 0, `createSim` gives
   it a value.
2. The value is `hash32(sim.seed ^ fnv1a(path))` as an unsigned 32-bit integer, and 0 becomes
   1. The path is the table's name and the row's number, for example `actors[3]`. It is the
      formula of design record 0101 (section 4).
3. A row whose `seed` is not 0 keeps its value.
4. The simulation does nothing else with the field. The tick advances it.
5. The rule reads the fields of the row and no field of a class in the row.

So two rows have different seeds, and one row has the same seed in each run with one seed of
the simulation. The dump and the record show the seed as any other field.

A row that comes in while the game runs gets no seed from the simulation. The tick that
brings it in gives it one. This record does not change that.

### 2. The replay from a builder

`replaySim` takes the function that builds the simulation.

```ts
const again = await replaySim(
  (run) => createDungeon(CAVE, { seed: run.seed, device, slots: 12 }).sim,
  record,
);
expect(await again.dump()).toBe(await sim.dump());
```

The rules:

1. `replaySim(build, record)` checks the record as before. It calls `build` once with
   `{ seed, hz }` of the record.
2. `build` returns a simulation at tick 0. A simulation whose tick is not 0 is an error.
3. The simulation's `seed` and `hz` equal the record's. A difference is an error that names
   the two values.
4. `replaySim` gives the simulation each input at the input's tick, runs the record's ticks
   and returns the simulation.
5. The form `replaySim(tables, options, record)` of design record 0102 stays.

## Why

- **The same formula as a node.** A game that moves from the world to a simulation keeps its
  random numbers, and the engine has one rule to explain.
- **0 means not given.** A row is a plain value, so the simulation cannot see if the author
  gave a field. A zero state of `xorshift32` stays zero, so 0 is no useful seed.
- **A builder, not the tables.** The game already has one function that builds it for a test
  and for a page (design record 0104). The replay is a third use of it.
- **The check of the seed.** A builder that ignores `run.seed` replays another game. The check
  says so at once.

## What is not in this record

- A seed for a row that comes in while the game runs. It is part of the table with free slots.
- A file format and a command for a replay.

## What it touches

| Path                | Change                                                      |
| ------------------- | ----------------------------------------------------------- |
| `src/sim.ts`        | The seed rule of section 1                                  |
| `src/test.ts`       | `replaySim(build, record)`                                  |
| `test/sim.test.ts`  | The tests of both sections                                  |
| `examples/dungeon/` | No import of `nodeSeed`. The test replays with the builder. |
| `examples/factory/` | The test replays with the builder                           |
| `README.md`         | The layout row of this record                               |

Tests owed:

| Test                                                                   | Verifies      |
| ---------------------------------------------------------------------- | ------------- |
| A row with `seed` 0 gets the value of the formula, and 0 becomes 1     | Design 0106.1 |
| A row with a seed keeps it, and a row with no field `seed` gets none   | Design 0106.1 |
| Two rows have different seeds, and two runs give one row the same seed | Design 0106.1 |
| A record replays from a builder to the same dump                       | Design 0106.2 |
| Each error of section 2, with its text                                 | Design 0106.2 |
| The two games' tests pass with no change to a picture or a count       | Design 0106.1 |

## Implementation, in steps

One step, one pull request. Each commit carries `Design: 0106`.

1. **The seed and the replay.** Both sections, their tests and the two games. The games'
   `README.md` files record the state of R5 and R8. Set this record to `implemented`.

## Decisions for the owner

The agent made these decisions under D9. The owner can change each one.

1. A row of a simulation with `seed` 0 gets a seed from the simulation's seed and the row's
   path, by the formula of a node.
2. `replaySim` also takes the function that builds the simulation, and checks its seed and its
   tick rate against the record.

## Record

- **Approval.** The agent showed the owner the order of work on 2026-11-11, with this item
  first. The owner answered "네, 그 순서로 진행해주세요". The owner's rule of 2026-11-11
  approves a merge with green checks in advance (`CLAUDE.md`, Merging).
- **Validation.** The delivered configuration, 2026-11-11, compiler pin `6d6a979`:

  | Step | Pull request | Commit on `main` | What ran                                          |
  | ---- | ------------ | ---------------- | ------------------------------------------------- |
  | 1    | this one     | its merge commit | `bun run check`, 103 tests. `bun run harness`, 4. |

  The two games' tests pass with no change to a picture or a count. The second game's rats
  have the seeds they had: the formula and the paths are the same.

- **Deviations.**
  - `replaySim` also refuses a builder that returns no simulation. The record did not list
    that error. Closed: a test holds its text.
