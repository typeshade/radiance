---
id: '0108'
title: A project is the structure of a game, and the engine builds the game from it and runs it
status: implemented
vision: [D4, D11, D12, D13, D14]
touches:
  - src/engine.ts
  - src/project.ts
  - src/facts.ts
  - src/cli.ts
  - src/index.ts
  - src/page.ts
  - src/test.ts
  - test/
  - examples/factory/
  - examples/dungeon/
  - README.md
compiler: []
---

# 0108. The project is the structure

**Document control**

| Field          | Record                                                                                              |
| -------------- | --------------------------------------------------------------------------------------------------- |
| Identity       | Design record `0108`, `status: implemented`. The front matter holds the identity and the lifecycle. |
| Date           | Written 2026-11-11 by the repository's coding agent, under decision D9 of `docs/vision.md`.         |
| Baseline       | `typeshade/radiance` `main` `d583f83`.                                                              |
| Compiler pin   | `6d6a979`.                                                                                          |
| Pull request   | The pull request that adds this file.                                                               |
| What is a fact | The three steps are implemented. The Record section holds the delivered configuration.              |

## What changes

Decisions D13 and D14 say that Radiance is the framework a game is written on, that the engine
is a class and the runtime, and that the framework manages the project and its files. The
owner then said how (Record): the project itself is the structure, as in Next.js and NestJS,
and the engine builds the game from it.

Today a game opens its device, makes its arrays, builds a simulation, passes each table to
each function and starts a loop by hand.

After this record, a game is a project of a fixed shape. The engine reads the project, writes
the game's class from it, and runs that class as the runtime. This record covers four layers
of D14: the project, the device, the memory and the runtime. The simulation of design records
0102 to 0107 becomes the inside of the engine.

### 1. A project

```text
dungeon/
  radiance.config.ts    the game: the order of a tick, the tick rate, its values
  state/                the game's state. One file is one table.
    actors.shade.ts
    tiles.shade.ts
  scratch/              the tables of a tick that are no state
    wants.shade.ts
  systems/              the steps of a tick. One file is one step.
    plan.shade.ts
    turn.shade.ts
    pickup.shade.ts
  draw/                 the drawing
  input/                host code: an event of the page becomes data
  levels/               the first rows, as data
  tests/
  .radiance/            what the engine writes. A person does not change it.
```

The rules:

1. A directory's name is a layer of the framework. No name is for one kind of game (D13).
2. A file of `state/` or `scratch/` is a `"use typeshade"` file. It exports one class. The
   table's name is the file's name. The file can export constants and functions beside the
   class.
3. A file of `systems/` is a `"use typeshade"` file. It exports one kernel function with the
   file's name.
4. `radiance.config.ts` exports `defineGame({ tick, hz, stepOn, values })`. `tick` lists the
   systems in the order they run.
5. The engine finds the files by their place. A game writes no import that registers a file.
   A `"use typeshade"` file at the root of the project is a module that the tables and the
   systems share. The engine does not read it.
6. `draw/draw.ts` is a host file. It exports `draw(game)`, which draws one frame. A
   `"use typeshade"` file of `draw/` holds the entry it calls.
7. A host file of `input/` exports functions named after the events they take: `pointerdown`,
   `pointermove`, `pointerup`, `keydown`, `keyup`. Each gets the game and the event's data.
8. A file in a place it does not fit, or a name the rules do not know, is an error of
   `radiance check`. The error names the file, the fact and a remedy.

### 2. A table

```ts
// state/actors.shade.ts
"use typeshade";
import { NONE } from "../kinds.shade.ts";

export class Actor {
  kind: u32 = 0;
  x: u32 = 0;
  y: u32 = 0;
  hp: u32 = 0;
  seed: u32 = 0;
  free(): bool {
    return this.kind == NONE;
  }
}
export const slots = 16;
```

1. A table of `state/` is in the dump, the snapshot, the record and a replay. A table of
   `scratch/` is in none of them.
2. A file that exports `slots` is a table with free slots of that size (design record 0107).
   Its class has a method `free(): bool`.
3. A table of `scratch/` has the number of rows of a state table. The config names that table:
   `scratch: { wants: 'actors' }`. A `"use typeshade"` file holds no string, so the name is not
   an export of the file.
4. Each first row with `seed` 0 gets a seed (design record 0106).
5. The engine decides which tables have two arrays: each table that a system writes through
   its `Next` name (section 3).

A `"use typeshade"` file can import a `"use typeshade"` module of Radiance and extend a class
of it (probe 3 of section 11). The first such module is not in this record.

### 3. A system

```ts
// systems/turn.shade.ts
"use typeshade";
export function turn(
  actorsNext: array<Actor>,
  actors: array<Actor>,
  wants: array<Want>,
  tiles: array<Tile>,
  width: u32,
  tick: u32,
) { /* ... */ }
```

The engine reads the source of the file and gives each parameter its value by its name.

| The parameter's name             | What the engine gives                                      |
| -------------------------------- | ---------------------------------------------------------- |
| The name of a table              | The table as the systems before this one left it           |
| The name of a table and `Next`   | The array the tick writes. It is the table after the tick. |
| `tick`, `seed`, `dt`             | The ticks run, the run's seed, `1 / hz` as `f32`           |
| A name of `values` in the config | That value. A level or a test can set it at the start.     |

A parameter with any other name is an error that lists the names the engine knows. The game
writes no call of a system.

### 4. What the engine writes

`radiance sync` reads the project and writes `.radiance/game.ts`: one class that extends
`Engine`. It is TypeScript that an agent can read. An error in it names the line of the
author's file.

```ts
// .radiance/game.ts, written by the engine
export class Game extends Engine {
  readonly tables = {
    actors: this.pool(Actor, { size: 16 }),
    tiles: this.table(Tile, { buffered: true }),
    wants: this.scratch(Want, { size: 16 }),
  };

  readonly systems = {
    // systems/plan.shade.ts
    plan: () => plan(this.tables.wants.rows, this.tables.actors.rows, this.values.width, this.values.height),
  };
}
```

The rules of the class:

1. `tables` holds each table of the game by its name. `systems` holds each step of a tick by
   its name, in the order they run. `inputs` holds the function for each event the game takes.
   `draw()` draws a frame.
2. The names of a game are in those three objects. So no table and no system can meet a member
   of the engine, and a table or a system can be named `tick`, `seed` or `pool`.
3. A test and a host file read a table as `game.tables.actors`.

A test and a page load the project and get that class:

```ts
const game = await load('examples/dungeon', { seed: 1, level: 'cave' }); // the CPU tier
```

`Engine` is the runtime. Sections 5 to 7 say what it does. A person can also write a class
that extends `Engine` by hand, and the engine's own tests do.

### 5. The start

```ts
const game = await load('examples/dungeon', { seed: 1, level: 'cave' }); // a test, the CPU tier
const game = await run('examples/dungeon', { seed: 1, level: 'cave', canvas }); // a page
```

The rules:

1. `load(project, options)` of `radiance/test` reads the project, opens a device of the CPU
   tier, makes the game and starts it. It runs no loop.
2. `run(Game, options)` of `radiance/page` takes the class that the engine wrote. It opens a
   device of WebGPU, or of WebGL2 where WebGPU fails (D12), starts the game and runs the loop
   of section 7.
3. `options.seed` is required. `options.level` names a file of `levels/`. A level gives the
   first rows of each table and the `values` of the run.
4. A table with no first rows is an error, except a table with slots and a scratch table.
   Their rows are new rows of the class.
5. The engine owns each array from its first byte. After the start, an input changes a row
   (section 6).
6. `game.dispose()` stops the loop, frees every array of the game and closes the device. A
   call on a game after that is an error.

### 6. What the engine gives

| Member                                         | What it is                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------------- |
| `game.seed`, `game.hz`, `game.tick`, `game.dt` | The run's seed, its tick rate, the ticks run, `1 / hz` as `f32`           |
| `game.tier`                                    | The tier of the device: `cpu`, `webgpu` or `webgl2`                       |
| `await game.step(n)`                           | Runs `n` ticks                                                            |
| `await table.read()`                           | A copy of the rows                                                        |
| `table.input(index, fields)`                   | An input, applied before the next tick and recorded (design record 0105)  |
| `await game.dump()`                            | The state as text: each state table, and no scratch table                 |
| `await game.snapshot()`, `game.record()`       | As design record 0102                                                     |
| `game.memory()`                                | One line of data for each table: its name, its kind, its rows, its arrays |

A scratch table is in `game.memory()` and in nothing else. Each first row with `seed` 0 gets a
seed (design record 0106). The path of a row is the field's name and the row's number.

`replay(Game, options, record)` of `radiance/test` builds the game with the record's seed and
tick rate on the CPU tier, gives it each input at its tick and returns the game.

### 7. The loop

`run` runs the loop in a page.

1. In each animation frame the engine runs the ticks that are due, at most 8, then calls
   `game.draw()` when the class has that method.
2. A game whose field `stepOn` is `'input'` runs one tick for each frame that has an input in
   the queue, and no tick in any other frame. A game with turns uses it.
3. The loop stops while the page is hidden. It does not run the ticks of that time after.
4. A function of the game's `inputs` is called for each event of its name on the canvas:
   `pointerdown`, `pointermove`, `pointerup`, `keydown`, `keyup`. It gets the event's data: the
   place in the canvas from 0 to 1, or the key. It calls `table.input`, so the record of the
   run holds the event.

### 8. What moves

| Before                                | After                                              |
| ------------------------------------- | -------------------------------------------------- |
| `createDevice` in a game              | Inside `load` and `run`                            |
| `createSim` and its options           | The inside of `Engine`. The export ends at step 3. |
| `frames` of `radiance/page`           | The inside of `run`. The export ends at step 3.    |
| `device.array` for the table of wants | `this.scratch`                                     |
| `replaySim(build, record)`            | `replay(Game, options, record)`                    |

The world of nodes (design records 0100 and 0101) does not change in this record (section 10, rule 4).

### 9. The errors

Each error names the class and the field, the fact and a remedy. The tests hold the texts.

- A table with no first rows at the start.
- `table.fill` after the start, and `table.fill` with more rows than a pool's size.
- A read of `next` of a table that is not buffered.
- A game with no system, and a value of `tables` that is no table.
- A call on a game after `dispose`.
- `run` in a place with no canvas.

### 10. What keeps this clean over time

The owner's condition for this record, given on 2026-11-11: the code is clean, and it gives no
problem over a long time. These rules answer it.

1. **One reader of the language.** The compiler reads a `"use typeshade"` file. The engine does
   not read the language a second time. The engine needs two facts of a system: the names of
   its parameters, and which arrays it writes. Compiler issue typeshade/typeshade#1253 asks
   for both as a report.
2. **The workaround has one place and an end.** Until the pin has that report, one module,
   `src/facts.ts`, gets the two facts. It reads the parameter names from the function's
   signature, and it takes `Next` in a name as "the tick writes this array". No other module
   reads source. When the pin has the report, `src/facts.ts` reads the report, the `Next` rule
   ends, and nothing else changes.
3. **One way to write a game.** When the two reference games are projects (step 3),
   `createSim`, `replaySim` and `frames` leave the public exports in the same pull request.
   They stay as the inside of `Engine`.
4. **No second model.** The world of nodes (design records 0100 and 0101) is no longer the way
   to write a game (D14). A record of its own decides, before any new work on it, if it stays
   as the way to write a hierarchy or is removed.
5. **What the engine writes is never committed.** `.radiance/` is in `.gitignore`.
   `radiance sync` writes it, as `tshc sync` writes a host view, and `radiance sync --check`
   fails when it is stale.
6. **One name for one thing.** A table's name is its file's name, in the config, in a system's
   parameter, in the dump and in a test. The engine makes no second name.
7. **A layer has one module.** `src/engine.ts` is the runtime, `src/project.ts` the project,
   `src/facts.ts` the facts of a system, `src/page.ts` the page. A module of a layer imports no
   module of a layer above it.

### 11. The probes

| Item     | Value                                                                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date     | 2026-11-11                                                                                                                                              |
| Tools    | TypeScript 5.6.3, Vitest 5.0.5 on Bun, compiler pin `6d6a979`                                                                                           |
| Result 1 | Standard decorators on a field and a method of a host class ran, and `tsc` accepted them.                                                               |
| Result 2 | A compiled kernel function does not give the names of its parameters at run time. So the engine reads the source.                                       |
| Result 3 | A class of a `"use typeshade"` file extended a class of another `"use typeshade"` module. The methods it took ran in a kernel function on the CPU tier. |
| Result 4 | The compiler refuses a decorator of a library in a `"use typeshade"` file (`TS8028`), and an import of a host file there (`TS8072`).                    |

Not observed: decorators in the page that Vite builds, and result 3 on WebGPU.

The owner decided on 2026-11-11 that the language is to accept a decorator that a library
declares (`typeshade/typeshade`, `docs/owner-decisions.md`, OD-8). This record marks a table and
a system by the file's place and its exports, which works at the pin. When the compiler has
the decorators and the pin moves, an amendment of this record gives the decorated form.

## Why

- **The project is the structure, as the owner decided.** An agent does not choose where a
  thing goes. The place of a file says what it is, and one check says what is wrong.
- **The engine writes the class.** The engine reads the source, so it knows each parameter's
  name (result 2). The game writes no call that passes a table.
- **`Next` in the name.** The engine cannot see which array a function writes. The name says
  it, and the engine then gives the table two arrays.
- **What the engine writes can be read.** `.radiance/game.ts` is a class that a person could
  write by hand. An agent can read it when a run goes wrong.
- **Place and exports now, decorators after.** Result 4 says why. The record does not wait on
  the compiler.
- **`stepOn`.** A game with turns has no clock (R7 of the second reference game).

## What is not in this record

- The commands `radiance dev` and `radiance build`, and the package for a store.
- A `"use typeshade"` module of Radiance with base classes.
- The decorated form in a `"use typeshade"` file. It waits on the compiler (OD-8).
- The recovery of a lost device.
- Drawing, assets, sound, a save.
- The future of the world of nodes. A record of its own decides it.

## What it touches

| Path                                          | Change                                                             |
| --------------------------------------------- | ------------------------------------------------------------------ |
| `src/engine.ts`                               | New: `Engine`, the table handles, the types of an input            |
| `src/project.ts`                              | New: the reader of a project and the writer of `.radiance/game.ts` |
| `src/facts.ts`                                | New: the facts of a system. The one module that reads source.      |
| `src/cli.ts`                                  | New: `radiance sync` and `radiance check`                          |
| `src/test.ts`                                 | `load(project, options)`, `replay`                                 |
| `src/page.ts`                                 | `run(Game, options)`, the loop with `stepOn` and the pause         |
| `test/engine.test.ts`, `test/project.test.ts` | New                                                                |
| `examples/dungeon/`                           | The game as a project                                              |
| `examples/factory/`                           | The game as a project, and its page on `run`                       |
| `README.md`                                   | The example of a game                                              |

Tests owed:

| Test                                                                                                             | Verifies       |
| ---------------------------------------------------------------------------------------------------------------- | -------------- |
| A project of each valid form gives the class of section 4, as text                                               | Design 0108.4  |
| Each error of a project: a file in a wrong place, an unknown parameter, a missing class                          | Design 0108.1  |
| A table of `scratch/` is in no dump, and a table with `slots` has free rows                                      | Design 0108.2  |
| A parameter gets its value by its name, and a `Next` name gives a table two arrays                               | Design 0108.3  |
| The systems run in the order of the config                                                                       | Design 0108.1  |
| `load`, the first rows of a level, `dispose`, and a call after it                                                | Design 0108.5  |
| `memory()` has each table, and a record replays to the same dump                                                 | Design 0108.6  |
| The loop with a clock the test gives: the ticks that are due, `stepOn`, the pause                                | Design 0108.7  |
| Each error of section 9, with its text                                                                           | Design 0108.9  |
| No module but `src/facts.ts` reads the source of a `.shade.ts` file, and no layer imports a layer above it       | Design 0108.10 |
| The two games' tests pass with no change to a picture or a count                                                 | Design 0108.8  |
| The harness: the factory's page runs on `run`, and the cells of the GPU device equal the cells of the CPU device | Design 0108.7  |

## Implementation, in steps

Each step is one pull request. Each commit carries `Design: 0108`.

1. **The runtime.** `Engine` on the CPU tier: sections 5, 6 and 9, with a class written by hand
   in the engine's tests.
2. **The project.** Sections 1 to 4: `src/facts.ts`, the reader, the writer, `radiance sync`,
   `radiance check` and `load`. The second reference game becomes a project, and its tests use
   `load`.
3. **The page.** Section 7 and `run`, in two pull requests. The first adds `run`, the inputs and
   the loop, with a clock and a canvas that a test gives. In the second, the first reference
   game becomes a project, and its page uses `run`. The harness runs it, and the game's `README.md` records the lines and the bytes.
   `createSim`, `replaySim` and `frames` leave the public exports (section 10, rule 3). Set
   this record to `implemented`.

## Decisions for the owner

The agent made these decisions under D9. The owner can change each one.

1. A game is a project. The directories are `state`, `scratch`, `systems`, `draw`, `input`,
   `levels` and `tests`, and the engine writes into `.radiance`.
2. A file's place and its exports mark a table and a system. `slots`, `like` and `free()` are
   the names for a table.
3. A system's parameter gets its value by its name. `Next` after a table's name is the array
   the tick writes.
4. The engine writes one class that extends `Engine`, and `Engine` is the runtime. A game's
   names are in `tables`, `systems` and `inputs`, apart from the engine's members.
5. `stepOn: 'input'` makes a game with turns.
6. `createSim`, `replaySim` and `frames` leave the public exports when the games are projects.
7. The engine reads source in one module only, and that module moves to the compiler's report
   when the pin has it.

## Record

- **Approval.** The owner decided D13 and D14 on 2026-11-11. The agent first wrote this record
  around a class that the game extends by hand. The owner then said: "nextjs, nestjs, 같이
  프로젝트 자체가 구조가 되는 방식은? 게임 엔진이 이걸 가지고 빌드해주는 느낌이 더 적절할 것 같기도
  해서". The record was written again around the project. The agent showed the owner this shape.
  The owner answered on 2026-11-11: "보기에 코드가 깔끔하고, 장기간 처리시에도 문제가 없으면
  허가함". Section 10 holds what the agent changed in the record to meet that condition.
- **Validation.** The delivered configuration, 2026-11-11, compiler pin `6d6a979`:

  | Step           | Pull request | Commit on `main` | What ran                                          |
  | -------------- | ------------ | ---------------- | ------------------------------------------------- |
  | 1              | #119         | `f6d86c6`        | `bun run check`, 113 tests                        |
  | 2              | #120         | `209510f`        | `bun run check`, 118 tests                        |
  | 3, first part  | #121         | `0118236`        | `bun run check`, 124 tests                        |
  | 3, second part | this one     | its merge commit | `bun run check`, 118 tests. `bun run harness`, 4. |

  Step 2: the second reference game is a project. Its nine tests give the pictures and the
  counts they gave before, and its long run replays to the same dump.

  Step 3: the first reference game is a project, and its page runs on `run`. Its eight tests
  give the pictures and the counts they gave before. The harness ran in headless Chromium
  (Playwright 1.63.0) with WebGPU on SwiftShader: after 200 ticks with one input, the cells of
  the GPU device equal the cells of the CPU device. The page loads one file of 306,828 bytes,
  94,420 with gzip. The count of tests fell from 124 to 118: the five tests of `frames` and one
  test of a `README.md` example went with what they tested.

- **Deviations.**
  - Step 1 added `start(Game, options)` of `radiance/test`, which `load` is built on. Closed.
  - The replay of a game is `replayGame`, since `replay` is the name of the world's replay.
    Open: the record of the world of nodes decides the one name (section 10, rule 4).
  - The first reference game and the removal of the old exports moved from step 2 to step 3,
    so that its page and its harness change once. The steps above say so. Closed.
  - The runtime names no canvas, so that it reads no interface of a browser (design record
    0100, invariant 2). A game reads what it draws to as `game.surface`, and `run` of
    `radiance/page` takes the canvas. Closed.
  - A game's names are in `tables`, `systems` and `inputs` of its class, and the decorators
    `@system()` and `@input(event)` of the first steps are removed. A system named `tick` met
    the engine's `tick`. The agent showed the owner the two ways on 2026-11-11, and the owner
    answered: "대안 쪽으로 고쳐서 계속 진행해주세요". Sections 4 and 7 say so. Closed.
  - The page of the first reference game no longer empties a cell on a double click, since the
    engine's events have no `dblclick`. Open: a later record adds the event when a game needs
    it.
  - A scratch table's size is in the config and not an export `like`, since a
    `"use typeshade"` file holds no string. Section 2 says so. Closed.
