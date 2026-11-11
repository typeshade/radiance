---
id: '0101'
title: A world takes inputs at a tick, records them, replays them, and gives each node a seed
status: implemented
vision: [D3, D4, U2, U3]
touches:
  - src/world.ts
  - src/input.ts
  - src/seed.ts
  - src/test.ts
  - src/index.ts
  - test/
  - README.md
  - docs/vision.md
compiler: []
---

# 0101. Inputs, the replay and the seed

**Document control**

| Field          | Record                                                                                              |
| -------------- | --------------------------------------------------------------------------------------------------- |
| Identity       | Design record `0101`, `status: implemented`. The front matter holds the identity and the lifecycle. |
| Date           | Written 2026-11-11 by the repository's coding agent, under decision D9 of `docs/vision.md`.         |
| Baseline       | `typeshade/radiance` `main` `8247a9b`.                                                              |
| Compiler pin   | `da311c32`.                                                                                         |
| Pull request   | The pull request that adds this file.                                                               |
| What is a fact | The three steps are implemented. The Record section holds the delivered configuration.              |

> **Changed by design record 0105.** A value of an input can also be an object, for a field
> that holds an object. The object writes only the fields that it names. Design record 0105
> (section 2) has the rules. The text below is the design as this record made it.

## What changes

After this record, a game changes a running world from outside, and the change is data. A run
is its scene, its seed, its tick rate and its inputs. A second world that takes the same four
gives the same dump at each tick. A class that needs random numbers has a seed of its own.

The record covers moment 5 of `docs/vision.md` (section 4) without the command line. It rests
on design record 0100.

### 1. An input

An input is a write of field values to one node. The world applies it between two ticks.

```ts
const world = createWorld(factory, { seed: 7 });
world.input('line-1/Belt#0', { speed: 4 });
world.step(); // the write is applied, then the tick runs
```

The rules:

1. `world.input(path, fields)` checks the input and puts it in a queue. It changes no node.
2. The path names a node with a class. A path of a group or a missing path is an error.
3. Each field is a field of the node's class. An unknown field is an error that lists the
   fields.
4. Each value is a finite number, a boolean, or an array of these. Any other value is an error.
   An input is data that JSON holds, so a record of inputs is a file.
5. At the start of each tick, before any `step`, the world applies the queue in the order of
   the calls and empties it. To apply an input is to assign its values to the instance's fields.
6. The world adds each applied input to its record with the tick at which it was applied. That
   tick is the value of `world.tick` before the tick runs.
7. `step(0)` applies nothing. An input waits for the next tick that runs.

### 2. The record of a run

`world.record()` returns a plain object that `JSON.stringify` accepts.

```json
{
  "version": 1,
  "seed": 7,
  "hz": 60,
  "ticks": 2,
  "inputs": [{ "tick": 0, "path": "line-1/Belt#0", "fields": { "speed": 4 } }]
}
```

- `ticks` is `world.tick` when the record was taken.
- `inputs` holds each applied input, in the order the world applied them. An input still in
  the queue is not in the record.
- The record is a copy. A later input does not change it.

### 3. The replay

`replay(scene, record)`, from `radiance/test`, builds a world from the scene with the record's
`seed` and `hz`. For each tick from 0 to `ticks - 1`, it queues the inputs of that tick in
order and runs one tick. It returns the world.

- A record whose `version` is not 1 is an error.
- An input whose tick is not an integer from 0 to `ticks - 1` is an error.
- The inputs are in the order of their ticks. An input out of order is an error.

The invariant: for a world `w` built from a scene, `replay(scene, w.record()).dump()` equals
`w.dump()`. It holds on one machine, as invariant 1 of record 0100 does.

### 4. The seed of a node

A class that needs random numbers declares a field named `seed`.

```ts
"use typeshade";
import { uniform, xorshift32 } from "typeshade/random";

export class Spark {
  seed: u32 = 0;
  heat: f32 = 0.;
  step(dt: f32) {
    this.seed = xorshift32(this.seed);
    this.heat = uniform(this.seed);
  }
}
```

The rules:

1. When a class has a field named `seed` and the node gives it no first value, the world gives
   it one when it builds the instance.
2. The value is `hash32(world.seed ^ fnv1a(path))`, as an unsigned 32-bit integer. `hash32` is
   the function of the compiler's `typeshade/random` (surface §73). `fnv1a` is the 32-bit
   FNV-1a hash of the path's UTF-16 code units.
3. A value of 0 becomes 1, since a zero state of `xorshift32` stays zero.
4. A node that gives `seed` a first value keeps that value.
5. The world does nothing else with the field. The class advances its own state.

So two nodes of one class have different seeds, and one node has the same seed in each run
with one world seed. A node's seed does not depend on the other nodes of the scene.

The dump and the snapshot show `seed` as any other field.

### 5. The probe

| Item     | Value                                                                                                                                                                               |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date     | 2026-11-11                                                                                                                                                                          |
| Compiler | `da311c32`, the pin                                                                                                                                                                 |
| Result   | A host test imported `hash32`, `xorshift32` and `uniform` from `typeshade/random` and called them. Each call returned at once. `hash32(1)` is `1753845952`, and `hash32(0)` is `0`. |

Not observed: a class of a `.shade.ts` that imports `typeshade/random` and calls it in `step`
on the CPU tier. Step 2 adds that test first.

## Why

- **An input is a field write.** The engine has one kind of state, the fields of the tables. A
  second kind, such as a message or an event object, needs its own dump and its own replay. A
  game's host code turns a key or a touch into a write.
- **Inputs apply between ticks.** A write in the middle of a tick makes the result depend on
  when the host code ran. The first phase of the tick in `docs/vision.md` (section 7) is the
  input phase.
- **The record holds applied inputs only.** A queued input has no tick yet.
- **A seed from the path.** A seed from the row's number changes for each node when one node
  is added before it. A path does not move.
- **A field, not an argument.** `step(dt)` keeps one signature for each class. The seed is
  state, so it belongs in the dump and in the snapshot.
- **The compiler's `hash32`.** It gives the same word on each tier (surface §73), so a later
  GPU tier draws the same numbers.

## What is not in this record

- Adding and removing nodes while the world runs.
- Reads between nodes: the parent, a neighbour, a query.
- A file format on disk and the `radiance replay` command.
- Loading a snapshot.
- Rendering.

## What it touches

| Path                          | Change                                                          |
| ----------------------------- | --------------------------------------------------------------- |
| `src/input.ts`                | New: the check of an input, the type of a record                |
| `src/seed.ts`                 | New: `fnv1a`, `nodeSeed`                                        |
| `src/world.ts`                | `World.input`, `World.record`, the input phase, the seed rule   |
| `src/test.ts`                 | `replay`                                                        |
| `package.json`                | `typeshade` moves to `dependencies`: `src/` imports it          |
| `test/input.test.ts`          | New                                                             |
| `test/seed.test.ts`           | New, with `test/fixtures/spark.shade.ts`                        |
| `README.md`, `docs/vision.md` | The example of an input and a replay. Moment 5 names what runs. |

Tests owed:

| Test                                                                                         | Verifies      |
| -------------------------------------------------------------------------------------------- | ------------- |
| Each rule of section 1, the valid form and the error text                                    | Design 0101.1 |
| The record of a run equals a golden file                                                     | Design 0101.2 |
| `replay(scene, w.record()).dump()` equals `w.dump()`, for a run with inputs at several ticks | Design 0101.3 |
| Each error of section 3                                                                      | Design 0101.3 |
| A class that calls `typeshade/random` in `step` runs on the CPU tier                         | Design 0101.4 |
| Two nodes have different seeds, and two runs give one node the same seed                     | Design 0101.4 |
| The seed of a node equals the formula of section 4, and 0 becomes 1                          | Design 0101.4 |
| A node's seed does not change when another node is added to the scene                        | Design 0101.4 |

## Implementation, in steps

Each step is one pull request. Each commit carries `Design: 0101`.

1. **Inputs, the record and the replay.** Sections 1 to 3 and their tests.
2. **The seed.** Section 4 and its tests, with the probe of a class that calls
   `typeshade/random`.
3. **The documents.** `README.md` and `docs/vision.md`. Set this record to `implemented`.

## Decisions for the owner

The agent made these decisions under D9. The owner can change each one.

1. An input is a write of field values to one node. It is checked when it is given, applied at
   the start of the next tick, and recorded with that tick.
2. A record of a run is the seed, the tick rate, the tick count and the applied inputs, with
   version 1.
3. `replay` gives the same dump as the run that made the record.
4. A class takes random numbers from a field named `seed`. The world fills it from the world's
   seed and the node's path, with the compiler's `hash32`.

## Record

- **Approval.** The owner's rule of 2026-11-11 approves a merge with green checks in advance
  (`CLAUDE.md`, Merging). The merged text is the approved design.
- **Validation.** The delivered configuration, 2026-11-11, compiler pin `da311c32`:

  | Step | Pull request | Commit on `main` | What ran                  |
  | ---- | ------------ | ---------------- | ------------------------- |
  | 1    | #93          | `a306c05`        | `bun run check`, 50 tests |
  | 2    | #94          | `4187703`        | `bun run check`, 60 tests |
  | 3    | this one     | its merge commit | `bun run check`, 61 tests |

  Step 1's golden record was written by hand from section 2 before the code ran, and the code
  gives it byte for byte. Step 2 observed what section 5 did not: a class of a `.shade.ts` that
  calls `typeshade/random` in `step` runs on the CPU tier.

- **Deviations.**
  - `typeshade` moved from `devDependencies` to `dependencies`, as section "What it touches"
    says. `CLAUDE.md` (The compiler pin) still names `devDependencies`. Open: a change to
    `CLAUDE.md` waits for the owner.
