---
id: '0100'
title: A scene of nodes runs as tables on the CPU tier, on a fixed tick, and a test reads its dump with no device
status: accepted
vision: [D4, D9, U1, U2, U3]
touches:
  - package.json
  - bun.lock
  - bunfig.toml
  - tsconfig.json
  - vitest.config.ts
  - .github/workflows/ci.yml
  - src/
  - test/
  - README.md
  - CLAUDE.md
  - docs/vision.md
compiler: []
---

# 0100. The world on the CPU tier

**Document control**

| Field          | Record                                                                                               |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| Identity       | Design record `0100`, `status: accepted`. The front matter holds the identity and the lifecycle.     |
| Date           | Written 2026-11-11 by the repository's coding agent, under decision D9 of `docs/vision.md`.          |
| Baseline       | `typeshade/radiance` `main` `b3907dc`.                                                               |
| Compiler read  | `typeshade/typeshade` `main` `da311c32`. Each claim names a section of its surface document.         |
| Compiler pin   | None yet. Step 1 sets it.                                                                            |
| Pull request   | The pull request that adds this file.                                                                |
| What is a fact | The compiler's documents were read. One probe ran on 2026-11-11 (section 7). No step is implemented. |

## What changes

After this record, an agent writes a scene of nodes, runs it for a number of ticks with no
device, and reads the result as text. The record covers the first three moments of
`docs/vision.md` (section 4) and the dump of the fourth. It draws nothing.

Before: the repository holds documents only. After: it holds one package, a compiler pin, a
world that runs on the CPU tier, and tests.

### 1. The package and the pin

- The repository is one package, named `radiance`, with `"private": true`. Its entry is
  `src/index.ts`. A second entry, `radiance/test`, is `src/test.ts`.
- The compiler is pinned as a source tarball in `devDependencies`, as TypeAudio, TypeNN and
  TypeCV pin it (compiler proposal 0071, decision D6). The first pin is commit `da311c32`.
- The scripts run on Bun's runtime (`bunfig.toml`, `[run] bun = true`), since the tarball holds
  TypeScript sources.
- The tests run on Vitest with the compiler's Vite plugin, `typeshade/vite`. The plugin gives a
  test the host module of each `.shade.ts` it imports (surface §64).

### 2. A node and a scene

A node is a plain description. It runs nothing.

```ts
import { node, scene } from 'radiance';
import { Belt } from './belt.shade.ts';

export const factory = scene(
  node('line-1', node(Belt, { speed: 2 }), node('spare', Belt, { speed: 0 })),
);
```

`node` reads its arguments in this order:

| Position | Argument            | Meaning                                                            |
| -------- | ------------------- | ------------------------------------------------------------------ |
| 1        | a string, optional  | The node's name                                                    |
| 2        | a class, optional   | The node's class: an exported class of a `"use typeshade"` file    |
| 3        | an object, optional | The first values of the class's fields. Allowed only after a class |
| 4 onward | nodes               | The children, in order                                             |

The rules:

1. A node with no class is a group. It has a name and children, and no row in a table.
2. A node with no name takes the name `<Class>#<n>`. `n` counts the earlier siblings of that
   class that have no name, from 0.
3. Two siblings do not have the same name. `scene` throws an error that names both.
4. A field in the object that the class does not declare is an error. The error names the field
   and lists the class's fields.
5. A name does not hold `/`. The path of a node is the names from the root, joined with `/`.
6. `scene(root)` checks rules 3 to 5 for the whole tree and returns a `Scene`. A `Scene` is
   immutable.

### 3. The world, the tables and the tick

```ts
import { createWorld } from 'radiance';

const world = createWorld(factory, { seed: 7 });
world.step(30);
```

- `createWorld(scene, { seed, hz })` builds a `World`. `seed` is a `u32` and is required. `hz` is
  the tick rate, an integer, 60 when it is not given.
- The world visits the tree depth first, parents before children, children in order. For each
  node with a class it builds one instance with `new Class()`, then assigns the node's first
  values to the fields. The compiler's host module builds the instance on the CPU tier, and the
  instance's own enumerable properties are its fields (surface §64).
- The world keeps one table for each class. A table's rows are the instances in visit order.
  The tables are in the order in which the visit first meets each class. That order is the
  schedule.
- `world.step(n)` runs `n` ticks, 1 when `n` is not given. One tick does this, in order:
  1. For each table in schedule order, for each row in order, call `row.step(dt)` when the
     class declares `step`.
  2. Add 1 to `world.tick`.
- `dt` is `1 / hz`, rounded to `f32` with `Math.fround`. It is the same number in every tick.
- A class with no `step` method has a table and no call.
- The world calls nothing else. It reads no clock and no random source.

The world's read interface:

| Member                   | Result                                                                     |
| ------------------------ | -------------------------------------------------------------------------- |
| `world.tick`             | The number of ticks run, an integer from 0                                 |
| `world.seed`, `world.hz` | The values the world was built with                                        |
| `world.table(Class)`     | The rows of the class's table, a read-only array. An unknown class throws. |
| `world.find(path)`       | The instance at a path, or `undefined` for a group or a missing path       |
| `world.dump()`           | The text of section 4                                                      |
| `world.snapshot()`       | The object of section 5                                                    |

`simulate(scene, { ticks, seed, hz })`, from `radiance/test`, is `createWorld` then
`step(ticks)`, and returns the world.

### 4. The dump

`world.dump()` returns text. Each node is one line, in visit order, indented two spaces for each
level. The first line is the header.

```text
tick 30  seed 7  hz 60
line-1
  Belt#0  speed 2  offset 3.5762787e-7
  spare  Belt  speed 0  offset 0
```

The rules:

1. The header is `tick <n>  seed <n>  hz <n>`.
2. A group's line is its name.
3. A class node's line is its name, then the class's name when the name was given by the
   author, then each field as `<field> <value>`. Two spaces separate the parts.
4. The fields are in the order of the instance's own enumerable properties.
5. A number that is an integer is printed in full, with no exponent. `-0` prints as `-0`. Any
   other number is printed as the shortest decimal text that `Math.fround` reads back to the
   same `f32`. `NaN` and the infinities print as `NaN`, `Infinity` and `-Infinity`.
6. A boolean prints as `true` or `false`.
7. A vector or an array of numbers prints as `(a, b, c)`.
8. A field that holds an object prints as `{field value, field value}`, by these same rules.
9. Lines end with `\n`, and the text ends with one `\n`. No line has a trailing space.

The example's `offset` is not 0. Thirty steps of `2 * dt` in `f32` do not sum to exactly 1, and
the dump shows the value the class computed. A test that wants 0 uses a tick rate that `f32`
holds exactly, such as 64.

Rules 5 to 8 follow what the probe of section 7 observed. Rule 5 prints an integer in full
because the host gives a `u32` and an `f32` as the same kind of number. The shortest `f32` text
of a large `u32` is not that integer.

### 5. The snapshot

`world.snapshot()` returns a plain object that `JSON.stringify` accepts.

```json
{
  "version": 1,
  "tick": 30,
  "seed": 7,
  "hz": 60,
  "tables": [
    {
      "class": "Belt",
      "rows": [
        { "path": "line-1/Belt#0", "fields": { "speed": 2, "offset": 3.5762786865234375e-7 } },
        { "path": "line-1/spare", "fields": { "speed": 0, "offset": 0 } }
      ]
    }
  ]
}
```

- `version` is the version of this shape. This record defines version 1.
- A number is the host's number, in full. A number that JSON cannot hold (`NaN`, an infinity,
  `-0`) is the string of dump rule 5.
- Two worlds with equal snapshots give equal dumps.

The snapshot is the base of a save. Loading a snapshot into a world is not in this record.

### 6. The invariants

1. **A replay is exact.** Two worlds built from one scene with one seed and one `hz` give the
   same dump after the same number of ticks, on one machine.
2. **No device.** No file under `src/` that this record adds imports a browser interface or
   asks for a GPU device. The tests run under Vitest in Node or Bun.
3. **No hidden input.** No file under `src/` reads `Date`, `performance`, `Math.random` or a
   timer.
4. **The class is the author's.** The world adds no property to an instance and changes no
   prototype.

### 7. The probe

One probe ran before this record was offered, so that the record does not rest on documents
alone.

| Item     | Value                                                                             |
| -------- | --------------------------------------------------------------------------------- |
| Date     | 2026-11-11                                                                        |
| Compiler | `typeshade/typeshade` `da311c32`, installed as a source tarball                   |
| Tools    | Bun's runtime, `typescript` 5.6.3, `vite` 7.3.7, `vitest` 5.0.5, `typeshade/vite` |
| Place    | A scratch directory outside the repository. Step 1 adds the probe as a test.      |
| Result   | The test passed                                                                   |

The probe imported a class with six fields from a `.shade.ts`, built it with `new`, and called
`step(dt)` thirty times. Observed:

- `Object.keys(instance)` gives the fields in the order the class declares them.
- An `f32`, an `i32` and a `u32` field are each a JavaScript number. A `bool` field is a boolean.
- A `vec2` field is a plain array of two numbers.
- A field whose type is another class is an object of that class's fields.
- `step` is a method of the prototype. The call changes the instance's fields in place.
- With `speed` 2 and `dt` `Math.fround(1 / 60)`, `offset` after thirty steps is
  `3.5762786865234375e-7`. The same arithmetic in JavaScript with `Math.fround` gives the same
  number.

Not observed: a matrix field, an array field, a field of an emulated `f64`, and a class that
extends another. Step 1 adds each one to the probe before step 4 relies on it.

## Why

- **The CPU tier is the reference (U2).** The compiler states the same order for a class: "the
  host method is the reference, and the kernel is the fast path" (surface §64). So the first
  world calls the host method, and a later record adds the kernel for a wide table.
- **Tables by class (U1).** One array for each class makes the dump, the snapshot and a later
  kernel loop over `array<Class>` (surface §65) read the same rows in the same order.
- **A schedule from the scene.** The order of first appearance needs no second list to keep in
  step with the scene. A scene that needs another order gets an explicit schedule in a later
  record. Alternative considered: alphabetical order of class names. It is stable, but a rename
  then changes behaviour.
- **A fixed `dt` (U3).** A `dt` measured from a clock makes a replay differ. A constant makes
  the tick a pure function of the tables.
- **`seed` is required.** A default seed hides the fact that a run has one. This record stores
  the seed and gives it to nothing yet. Random numbers for a class are a later record.
- **Text first (D4).** The dump is the agent's view of the game. It comes before any picture.
- **A source tarball for the pin.** It is what the three sibling libraries use, and it needs no
  submodule. The first model's submodule added a second repository to each checkout and each CI job.

## What is not in this record

Each item is a later record. None is implemented by a step below.

- Rendering, a camera, a transform and its hierarchy.
- Input, the input record and a replay from a file.
- Random numbers for a class.
- Adding and removing nodes while the world runs.
- Reads between nodes: the parent, a neighbour, a query.
- A table on a GPU tier, and `explain`.
- Loading a snapshot, and the migration of a save.
- The `radiance` command line (`dump`, `diff`, `shot`, `build`).
- A Doorstop tree for the records. The CI job `traceability (Doorstop)` stays empty.

## What it touches

| Path                          | Change                                                                            |
| ----------------------------- | --------------------------------------------------------------------------------- |
| `package.json`, `bun.lock`    | The pin, `typescript`, `vite`, `vitest`, the scripts `typecheck` and `test`       |
| `bunfig.toml`                 | New: `[run] bun = true`                                                           |
| `tsconfig.json`               | New: the host project of surface §64, with `moduleSuffixes`                       |
| `vitest.config.ts`            | New: the plugin `typeshade/vite`                                                  |
| `src/node.ts`                 | New: `node`, `scene`, the checks                                                  |
| `src/world.ts`                | New: `createWorld`, the tables, the tick                                          |
| `src/dump.ts`                 | New: the dump and the snapshot                                                    |
| `src/index.ts`, `src/test.ts` | New: the two entries                                                              |
| `test/`                       | New: the tests below, with `test/fixtures/*.shade.ts`                             |
| `.github/workflows/ci.yml`    | The job `format + boundary + typecheck + test` gains the type check and the tests |
| `README.md`, `CLAUDE.md`      | The status, the layout, the checks, and the procedure to move the pin             |
| `docs/vision.md`              | Section 4's sketches take the names of this record                                |

Tests owed, each with its `Verifies` tag:

| Test                                                                                         | Verifies      |
| -------------------------------------------------------------------------------------------- | ------------- |
| A class of a `.shade.ts` is built with `new` in a test and its method gives the `f32` result | Design 0100.2 |
| Each rule of `node` and `scene`, the valid form and the error text                           | Design 0100.3 |
| The table order and the row order of a scene with three classes                              | Design 0100.4 |
| `step` runs each row once in each tick, in schedule order                                    | Design 0100.4 |
| `dt` equals `Math.fround(1 / hz)` in each call                                               | Design 0100.5 |
| The dump of a fixed scene equals a golden file, for each rule of section 4                   | Design 0100.6 |
| The snapshot of a fixed scene equals a golden file                                           | Design 0100.6 |
| Two runs of one scene give the same dump at tick 0, 1 and 1000                               | Design 0100.7 |
| A scan of `src/` finds no name of invariants 2 and 3                                         | Design 0100.7 |

## Implementation, in steps

Each step is one pull request. Each commit carries `Design: 0100`.

1. **The pin and the instrument.** Add the pin at `da311c32`, `bunfig.toml`, `tsconfig.json`,
   `vitest.config.ts` and the scripts. Add the probe of section 7 as the first test of the
   table above, with a matrix field, an array field and a class that extends another. Add the
   type check and the tests to the CI job. Proof: the test passes
   in CI, and it fails when the fixture's formula is changed.
2. **The node and the scene.** Add `src/node.ts` and its tests. Proof: the tests of rules 1 to
   6 pass.
3. **The world.** Add `src/world.ts`, `simulate` and their tests. Proof: the table, tick and
   `dt` tests pass.
4. **The dump and the snapshot.** Add `src/dump.ts`, the golden files and the replay test.
   Proof: the golden tests and the replay test pass, and the scan of invariants 2 and 3 passes.
5. **The documents.** Update `README.md`, `CLAUDE.md` and `docs/vision.md`. Set this record to
   `implemented` with the delivered configuration.

A step that finds a fact against this record stops. The record is amended first, in its own
pull request.

## Decisions for the owner

The agent made these decisions under D9. The owner can change each one.

1. The repository is one package named `radiance`, private for now. A published name is decided
   before the first release.
2. The compiler is pinned as a source tarball, first at `da311c32`. The tests import a class of
   a `.shade.ts` through the plugin `typeshade/vite`.
3. `node` takes a name, a class, the first field values and the children, in that order. `scene`
   checks the tree and returns an immutable value.
4. A world keeps one table for each class, in the order the scene first meets each class. That
   order is the schedule. A row's order is the visit order.
5. A tick calls `step(dt)` on each row. `dt` is `Math.fround(1 / hz)`, and `hz` is 60 unless
   given.
6. The dump and the snapshot have the shapes of sections 4 and 5. The snapshot's version is 1.
7. A replay on one machine is exact, and `src/` reads no clock, no random source and no device.
8. The seed is required and is stored. This record gives it to no class.
9. This record adds no Doorstop tree. A test carries its `Verifies` tag, and a later record
   decides the tool.

## Record

- **Approval.** The owner approved the merge in the conversation on 2026-11-11: "#85 병합하고 계속
  진행해주세요". The merged text is the approved design.
- **Validation.**
  - Step 1, 2026-11-11, compiler pin `da311c32`: `test/probe.test.ts` passes on the CPU tier, and
    it fails when the fixture's formula is changed. The test also observed what section 7 did not:
    a matrix field and an array field are plain arrays, a matrix lists its components column by
    column, and a class that extends another is an instance of both. A field whose type is a
    class holds an instance of that class. An emulated `f64` field is still not observed.
- **Deviations.** None.
