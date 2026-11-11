---
id: '0108'
title: The engine is a class that a game extends, and it owns the device, the memory and the loop
status: accepted
vision: [D4, D11, D12, D13, D14]
touches:
  - src/engine.ts
  - src/index.ts
  - src/page.ts
  - src/test.ts
  - test/
  - examples/factory/
  - examples/dungeon/
  - README.md
compiler: []
---

# 0108. The engine is a class

**Document control**

| Field          | Record                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------ |
| Identity       | Design record `0108`, `status: accepted`. The front matter holds the identity and the lifecycle. |
| Date           | Written 2026-11-11 by the repository's coding agent, under decision D9 of `docs/vision.md`.      |
| Baseline       | `typeshade/radiance` `main` `d583f83`.                                                           |
| Compiler pin   | `6d6a979`.                                                                                       |
| Pull request   | The pull request that adds this file.                                                            |
| What is a fact | The two probes of section 7. No step is implemented.                                             |

## What changes

Decisions D13 and D14 say that the engine is a class, that a game extends it, and that the
engine owns the device, the memory and the runtime. Today a game opens its device, makes its
arrays, builds a simulation and starts a loop by hand.

After this record, a game is one class. This record covers three layers of D14: the device,
the memory and the runtime. The project layer (the place of each file, the files a tool
writes, one command) is the next record. The simulation of design records 0102 to 0107 becomes
the inside of the engine.

### 1. A game is a class

```ts
import { Engine, system } from 'radiance';
import { Actor, NONE, Tile, Want, pickup, plan, turn } from './actors.shade.ts';

export class Dungeon extends Engine {
  readonly actors = this.pool(Actor, { size: 16, free: (a) => a.kind === NONE });
  readonly tiles = this.table(Tile, { buffered: true });
  readonly wants = this.scratch(Want, { like: this.actors });

  @system() plan() {
    return plan(this.wants.rows, this.actors.rows, this.width, this.height);
  }
  @system() turn() {
    return turn(this.actors.next, this.actors.rows, this.wants.rows, this.tiles.rows, this.width, this.tick);
  }
  @system() pickup() {
    return pickup(this.tiles.next, this.tiles.rows, this.actors.next, this.width);
  }
}
```

The rules:

1. A game is a class that extends `Engine`. It has no constructor of its own.
2. A field declares memory. `this.table(Class, options)` is a table of the game's state.
   `this.pool(Class, options)` is a table with free slots (design record 0107), and it is
   buffered. `this.scratch(Class, options)` is a table that is no state.
3. A method with `@system()` is one step of a tick. The systems run in the order the class
   declares them. A system can return a promise, and the engine waits for it.
4. A system reads a table through `table.rows`, the handle of the device. It writes a buffered
   table through `table.next`. After the last system the engine makes each `next` the `rows`.
5. A table that is not buffered has no `next`. A read of `next` is an error that names the
   option.
6. The game writes no call that opens a device, makes an array, frees one or runs a loop.

### 2. The start

```ts
const game = await Dungeon.test({ seed: 1, setup: (g) => g.load(CAVE) }); // the CPU tier
const game = await Dungeon.run({ seed: 1, canvas, setup: (g) => g.load(CAVE) }); // a GPU tier
```

The rules:

1. `Game.test(options)` opens a device of the CPU tier, makes the game and starts it. It runs
   no loop. `Game.run(options)` opens a device of WebGPU, or of WebGL2 where WebGPU fails
   (D12), starts the game and runs the loop of section 4.
2. `options.seed` is required. `options.hz` is 60 when not given.
3. `options.setup(game)` runs before the engine makes any array. It gives the tables their
   first rows with `table.fill(rows)`, and it sets the game's own fields.
4. A table with no first rows is an error, except a pool and a scratch table. Their rows are
   new rows of the class.
5. After the start, `table.fill` is an error. An input changes a row (section 3).
6. `game.dispose()` stops the loop, frees every array of the game and closes the device. A
   call on a game after that is an error.

### 3. What the engine gives

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

### 4. The loop

`Game.run` runs the loop in a page.

1. In each animation frame the engine runs the ticks that are due, at most 8, then calls
   `game.draw()` when the class has that method.
2. A game whose field `stepOn` is `'input'` runs one tick for each frame that has an input in
   the queue, and no tick in any other frame. A game with turns uses it.
3. The loop stops while the page is hidden. It does not run the ticks of that time after.
4. A method with `@input(event)` is called for each event of that name on the canvas:
   `pointerdown`, `pointermove`, `pointerup`, `keydown`, `keyup`. The method gets the event's
   data: the place in the canvas from 0 to 1, or the key. The method calls `table.input`.

### 5. What moves

| Before                                | After                                                       |
| ------------------------------------- | ----------------------------------------------------------- |
| `createDevice` in a game              | Inside `Game.test` and `Game.run`                           |
| `createSim` and its options           | The inside of `Engine`. The export stays for this record.   |
| `frames` of `radiance/page`           | The inside of `Game.run`. The export stays for this record. |
| `device.array` for the table of wants | `this.scratch`                                              |
| `replaySim(build, record)`            | `replay(Game, options, record)`                             |

The world of nodes (design records 0100 and 0101) does not change.

### 6. The errors

Each error names the class and the field, the fact and a remedy. The tests hold the texts.

- A table with no first rows at the start.
- `table.fill` after the start, and `table.fill` with more rows than a pool's size.
- A read of `next` of a table that is not buffered.
- A class with no system.
- A call on a game after `dispose`.
- `Game.run` in a place with no canvas.

### 7. The probes

| Item     | Value                                                                                                                                                    |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date     | 2026-11-11                                                                                                                                               |
| Tools    | TypeScript 5.6.3, Vitest 5.0.5 on Bun, compiler pin `6d6a979`                                                                                            |
| Result 1 | Standard decorators on a field and a method of a class ran, and `tsc` accepted them. A method decorator saw the methods in the order of the class.       |
| Result 2 | A compiled kernel function does not give the names of its parameters at run time. So the engine cannot pass tables to a function by name without a tool. |

Not observed: decorators in the page that Vite builds. Step 2 observes it and measures the
bytes.

## Why

- **A class, as the owner decided (D14).** An agent reads one class and knows the state, the
  order of a tick and the inputs of a game.
- **Fields for memory, decorators for behaviour.** A field has a type, so `this.actors.rows`
  is checked by `tsc`. A decorator marks a method and keeps the order of the class.
- **`rows` and `next`, written by the game for now.** Result 2 says why. The project layer
  reads the source of a `.shade.ts` file, and it can then pass the tables. That is the next
  record.
- **`setup` before the arrays.** The engine owns each array from its first byte. A game never
  holds rows that the device also holds.
- **`stepOn`.** A game with turns has no clock (R7 of the second reference game).

## What is not in this record

- The project layer: the shape of a project, the files a tool writes, one command.
- A system with no call written by the game.
- The recovery of a lost device.
- Drawing, assets, sound, a save.
- The removal of `createSim` and `frames` as exports.

## What it touches

| Path                  | Change                                              |
| --------------------- | --------------------------------------------------- |
| `src/engine.ts`       | New: `Engine`, `system`, `input`, the table handles |
| `src/index.ts`        | The new exports                                     |
| `src/test.ts`         | `replay(Game, options, record)`                     |
| `src/page.ts`         | The loop takes `stepOn` and the pause               |
| `test/engine.test.ts` | New                                                 |
| `examples/dungeon/`   | The game as a class                                 |
| `examples/factory/`   | The game as a class, and its page on `Factory.run`  |
| `README.md`           | The example of a game                               |

Tests owed:

| Test                                                                                                                     | Verifies      |
| ------------------------------------------------------------------------------------------------------------------------ | ------------- |
| The systems run in the order of the class, and a buffered table swaps                                                    | Design 0108.1 |
| `setup`, `fill` and the first rows of a pool and a scratch table                                                         | Design 0108.2 |
| `dispose` frees each array, and a later call is an error                                                                 | Design 0108.2 |
| The dump has no scratch table, and `memory()` has each table                                                             | Design 0108.3 |
| A record replays to the same dump with `replay`                                                                          | Design 0108.3 |
| The loop with a clock the test gives: the ticks that are due, `stepOn`, the pause                                        | Design 0108.4 |
| Each error of section 6, with its text                                                                                   | Design 0108.6 |
| The two games' tests pass with no change to a picture or a count                                                         | Design 0108.5 |
| The harness: the factory's page runs on `Factory.run`, and the cells of the GPU device equal the cells of the CPU device | Design 0108.4 |

## Implementation, in steps

Each step is one pull request. Each commit carries `Design: 0108`.

1. **The class in a test.** Sections 1 to 3, 5 and 6 on the CPU tier. The two games become
   classes, and their tests use `Game.test`.
2. **The class in a page.** Section 4. The factory's page uses `Factory.run`. The harness runs
   it, and the game's `README.md` records the lines and the bytes. Set this record to
   `implemented`.

## Decisions for the owner

The agent made these decisions under D9. The owner can change each one.

1. A game extends `Engine`. A field declares a table, a pool or a scratch table. A method with
   `@system()` is a step of a tick, in the order of the class.
2. `Game.test` and `Game.run` open the device and start the game. `setup` gives the first rows.
3. The game still writes the call of each kernel function, with `rows` and `next`. The project
   layer takes that call later.
4. `stepOn: 'input'` makes a game with turns.
5. `createSim` and `frames` stay as exports until a later record.

## Record

- **Approval.** The owner decided D13 and D14 on 2026-11-11, and agreed in the conversation
  that a design record comes next. The agent shows the owner the shape of this record before
  the merge, and this entry then records the owner's answer.
- **Validation.** Does not yet apply: no step is implemented.
- **Deviations.** None.
