---
id: '0112'
title: A run saves its state and starts again from it, on the same version of the game and on a later one
status: accepted
vision: [D6, D7, D13, D14, D15, D16]
touches:
  - src/engine.ts
  - src/sim.ts
  - src/save.ts
  - src/page.ts
  - src/build.ts
  - src/project.ts
  - src/config.ts
  - test/
  - examples/factory/
  - README.md
compiler: []
---

# 0112. A save of a run

**Document control**

| Field          | Record                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------ |
| Identity       | Design record `0112`, `status: accepted`. The front matter holds the identity and the lifecycle. |
| Date           | Written 2026-11-11 by the repository's coding agent, under decision D9 of `docs/vision.md`.      |
| Baseline       | `typeshade/radiance` `main` `fce7d0e`.                                                           |
| Compiler pin   | `6d6a979`.                                                                                       |
| Pull request   | The pull request that adds this file.                                                            |
| What is a fact | The state of `main` in "What changes". No step is implemented. No phone was measured.            |

## What changes

Today a run is lost when its page closes. The engine has `snapshot()`, a copy of every table
as plain values, and nothing starts a run from one. A phone closes a page often: a call, another
application, a low battery. A game for a phone must go on where it stopped (D16).

After this record, a run gives a save, and a run starts from a save. The page of a game keeps
the save on the device, with no server (D7). A later version of the game reads a save of an
earlier version, through functions that the game writes.

### 1. What a save is

A save is a plain value. It is JSON, so a person and an agent can read it.

```ts
export interface Save {
  readonly format: 1; // the engine's format of a save
  readonly game: string; // the name of the config
  readonly version: number; // the game's version of its state, from the config
  readonly tick: number;
  readonly seed: number;
  readonly hz: number;
  readonly values: { readonly [name: string]: number };
  readonly tables: readonly { readonly name: string; readonly rows: readonly object[] }[];
}
```

- A save holds every table of `state/`. It holds no scratch table: a tick makes a scratch again.
- A field of a row is in the save under its name. So a save does not depend on the order of the
  fields or on the bytes of a row on a device.
- A number that JSON cannot hold is the text of a dump (design record 0102, rule 5).

### 2. A run gives a save, and a run starts from a save

```ts
const save = await game.save();
const again = await load('examples/factory', { from: save });
```

- `game.save()` reads the tables once and gives the save. It waits for the tick in work.
- `from` starts a run with the tables, the tick, the seed and the values of the save. With
  `from`, a `level` and a `seed` are refused: a save holds both.
- The run from a save goes on as the first run does. The check: 50 ticks, a save, a start from
  it and 50 ticks give the dump of 100 ticks, on the CPU tier and on a GPU tier.
- A start from a save refuses, with the fact and a remedy:
  - a save of another game
  - a save with a `format` that the engine does not know
  - a save with a table or a field that the game does not have, or without one that it has
  - a save of a later `version` than the game's
- An input that waits for the next tick is not in a save. `game.save()` is called between two
  ticks, after the inputs of the last tick.

### 3. The page keeps the save

```ts
export default defineGame({
  name: 'Factory',
  save: { version: 1 },
});
```

A game with `save` in its config keeps one save on the device.

- **When.** The page saves when it goes out of view, and when the game asks with `game.save()`.
  The page does not save on each tick: a save reads every table from the GPU.
- **Where.** The page writes to the browser's database of the page's address (IndexedDB). The
  save's key is the name of the game.
- **Whole or not at all.** The page writes the new save in one transaction, and it keeps the
  save before it as the backup. A page that closes in the middle leaves the old save.
- **At the start.** The page reads the save. With one, the run starts from it, and with none
  it starts from `start` of the config.
- **A save that cannot be read.** The page starts from the backup. With no backup that reads,
  it starts from `start`, keeps the two saves under other keys, and says so on the page. The
  engine does not delete a save that it cannot read.
- **A new run.** `game.restart()` starts from `start` of the config and writes over the save.
- The store is a small interface, `{ read, write }`. A test and a native shell give their own.

### 4. A later version reads an earlier save

The game's state changes with the game: a new field, a table with another name. The config's
`save.version` is the version of the state, an integer from 1.

```ts
// saves/1-to-2.ts
import type { Save } from 'radiance';

/** Version 2 gives each cell a level. A cell of an old save has level 1. */
export function migrate(save: Save): Save {
  return {
    ...save,
    tables: save.tables.map((table) =>
      table.name === 'cells'
        ? { ...table, rows: table.rows.map((row) => ({ ...row, level: 1 })) }
        : table,
    ),
  };
}
```

- A project with `save.version: N` has a file `saves/K-to-K+1.ts` for each K from 1 to N-1.
  `radiance sync` refuses a missing one.
- At a start, the engine runs the functions in order, from the save's version to the game's.
  Then it checks the result as section 2 says.
- **The check that the version was raised.** `radiance sync` writes the names and the types of
  the fields of each table of `state/` into `saves/shape.json`, by version. The file is in the
  repository. When the fields differ from the entry of the config's version, `radiance sync
--check` fails. The remedy is to raise `save.version` and to write the function.
- **Old saves are tests.** A project keeps one save of each version it shipped under
  `tests/saves/`. A test starts the game from each one.

### 5. What the engine does not do

- It does not make a save smaller. A save is JSON. A table of 65,536 cells is some megabytes.
  The size becomes a number of the build when a game has such a table.
- It does not save in the middle of a tick, and it does not hold the record of a run in a
  save. A record of a run that started from a save says so, and `replayGame` needs the save.
- It does not send a save to a server or to another device (D7).

## Why

- **The names of the fields, not the bytes.** The bytes of a row differ between a device and
  the CPU tier, and they change with the compiler. A name stays.
- **JSON.** A bug report with a save is a file that an agent reads (D4). A function that
  moves a save to a later version is ordinary TypeScript over plain values.
- **The version in the config, and a check that it was raised.** A changed field with the old
  version is a save that loads wrong, with no error. The check turns it into a failed build.
- **Old saves as tests.** The worst failure of an offline game is a lost save (`docs/vision.md`,
  M3). A test with the real file of each shipped version holds every later change to it.
- **Never delete.** A save that cannot be read today can be read after a fix.
- **A store of two functions.** The store of a browser is not the store of a store package
  (D15). The engine must not know which one it has.

## The cost

- A save reads every table from the GPU. On a phone that takes time when the page goes out of
  view, and the browser gives little. M3 and the time of a save are measurements to take.
- A browser can delete the database of a page under low disk space. A store package can keep
  the save in the application's own files. That choice waits on the shell (U9) and on M3.
- JSON is larger than the bytes of the tables.

## What is not in this record

- A choice of saves, and a save that the player names.
- A save in the cloud, and a save of a store's service.
- The game's rules of a run that an update meets in the middle. A game decides whether it ends
  the old run or goes on. The engine gives it the save's version.

## What it touches

| Path                          | Change                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------- |
| `src/save.ts`                 | New: `Save`, the checks of a save against a game, the order of the functions |
| `src/sim.ts`, `src/engine.ts` | `save()`, a start from a save, `restart()`                                   |
| `src/page.ts`                 | The store of a browser, the save when the page goes out of view, the start   |
| `src/build.ts`                | The entry file gives the store to `run` for a game with `save`               |
| `src/project.ts`              | `saves/`, `saves/shape.json`, the two checks of `radiance sync`              |
| `src/config.ts`               | `save`                                                                       |
| `examples/factory/`           | `save: { version: 1 }`, one save under `tests/saves/`                        |
| `README.md`                   | A save, the config's entry, a function between two versions                  |

Tests owed:

| Test                                                                                | Verifies      |
| ----------------------------------------------------------------------------------- | ------------- |
| 50 ticks, a save, a start from it and 50 ticks give the dump of 100 ticks           | Design 0112.2 |
| A save is JSON: it is equal to itself after `JSON.parse(JSON.stringify(save))`      | Design 0112.1 |
| Each refusal of section 2, with its text                                            | Design 0112.2 |
| A store that fails in the middle of a write leaves the save before it               | Design 0112.3 |
| A save that cannot be read starts from the backup, and nothing is deleted           | Design 0112.3 |
| The harness: a page that is opened again goes on from its tick, with the same cells | Design 0112.3 |
| The functions run in order from the save's version to the game's                    | Design 0112.4 |
| `radiance sync --check` fails when a field changes and the version does not         | Design 0112.4 |
| The game starts from each save of `tests/saves/`                                    | Design 0112.4 |

## Implementation, in steps

Each step is one pull request. Each commit carries `Design: 0112`.

1. **A save and a start from it.** Sections 1 and 2, on the CPU tier and in the harness.
2. **The page keeps the save.** Section 3. The owner closes the page on a phone and opens it
   again, and the device record goes into `docs/vision.md`.
3. **Versions.** Section 4, with a second version of the factory's state as the example.

## Decisions for the owner

The agent made these decisions under D9. The owner can change each one.

1. A save is JSON with the names of the fields.
2. The page saves when it goes out of view, not on a clock.
3. The engine never deletes a save that it cannot read.
4. A game raises a version by hand, and a check fails the build when it forgets.

## Record

- **Approval.** The agent told the owner on 2026-11-11 that the save layer was the next work
  after the drawing layer. The owner did not ask for another order. The owner's rule of
  2026-11-11 approves a merge with green checks in advance (`CLAUDE.md`, Merging).
- **Validation.**
  - Step 1, 2026-11-11, `main` `9b314ce` plus the step 1 commit, compiler pin `6d6a979`, Bun with
    Vitest 5.0.5, the CPU tier. `bun run check`: 162 tests pass (151 before the step). The new
    tests are 7 in `test/save.test.ts`, 2 in `examples/factory/tests/factory.test.ts`, 1 in
    `examples/dungeon/tests/dungeon.test.ts` and 1 in `test/docs.test.ts`.
  - Step 1, `bun run harness`: headless Chromium on SwiftShader, WebGPU. 16 checks pass (15
    before the step). The new check saves in the page, starts a second run from the save in the
    same page, and holds the cells of both runs and of the CPU tier equal.
  - The check "50 ticks, a save, a start from it and 50 ticks give the dump of 100 ticks" held
    at the first run for each case: a game written by hand (a pool, row seeds, a buffered
    table), the factory with a belt put after the start, the dungeon with an input in each
    tick on both sides, and the factory on WebGPU. The save needed nothing beyond section 1.
  - Step 2, 2026-11-11, `main` `9b314ce` plus the step 1 and step 2 commits, compiler pin
    `6d6a979`, Bun with Vitest 5.0.5. `bun run check`: 179 tests pass (162 after step 1). The new
    tests are 15 in `test/store.test.ts`, one in `test/project.test.ts` and one in
    `test/build.test.ts`.
  - Step 2, `bun run harness`: headless Chromium on SwiftShader, WebGPU. 19 checks pass (16
    after step 1). The new checks are "a page that is opened again goes on from its tick, with
    the same cells", "a second, fresh browser context starts from the level" and "a save that
    cannot be read starts the page from the level, says so on the readout and stays in the
    store". The first one drives the page's `pagehide` event, and not `visibilitychange`.
  - Step 2, `bun bin/radiance.ts build examples/factory`: the page loads 318,007 bytes of script
    at its start, and it loaded 313,326 after step 1 and 306,357 before step 1. The `budget` is
    320,000, as step 1 set it.
  - No phone was measured. Step 3 is not done, and the `status` stays `accepted`.
- **Deviations.** Each one is open until the owner decides.
  1. `StartOptions` gains `from`, `game` and `version`, and `seed` is optional. A start from a
     save takes no seed. A start with no seed and no save still gets the text of `createSim()`.
     Proposed disposition: made part of section 2 by an amendment.
  2. The engine gets the name of the game from `StartOptions.game`, because it does not read the
     config. `load` and the entry file of the page give it. The entry file gives it to each game,
     also to a game that has no `save`, as a minified class name is no name. Proposed
     disposition: made part of section 1 by an amendment.
  3. `Sim.step` and `Sim.snapshot` now run one after the other. This is how `game.save()` waits
     for the tick in work. A tick that is called while another runs waits for it. Proposed
     disposition: made part of section 2 by an amendment.
  4. A record of a run from a save has a field `from`, the tick of the save. `replaySim` and
     `replayGame` read it, and `replayGame` needs `{ from: save }`. Section 5 says only that the
     record says so. Proposed disposition: made part of section 5 by an amendment.
  5. The check of a save refuses more than section 2 lists: a tick, a seed, an `hz`, a list of
     values or a list of tables of the wrong kind, a table twice, and a value of a field that has
     another shape than the class's. A start from a save refuses an `hz` that is not the save's.
     Proposed disposition: made part of section 2 by an amendment.
  6. The hook of a browser check (`radiance build --hook`) also puts `runFrom(save)` on
     `globalThis`. It starts a second run from a save on a canvas of its own. The harness uses
     it. A page with no hook does not have it. Proposed disposition: closed, as it is a test
     tool.
  7. The page of the factory loads 313,326 bytes of script, and it loaded 306,357 before the
     step. The `budget` of `examples/factory/radiance.config.ts` went from 310,000 to 320,000.
     Proposed disposition: closed.
  8. Changed expectation: the exact text of the entry file in `test/build.test.ts` has the line
     `game: "Factory",`.
  9. The record says the page writes the new save in one transaction. The store is two functions
     over one key each, so one save is two writes, in two transactions of a browser. The order
     makes up for it: write 1 puts the latest good save under the backup key, and write 2 puts
     the new save under the name of the game. One good save is readable at every point
     (`README.md`, The page keeps the save, and the test "the order of the two writes keeps one
     good save readable at every point"). Proposed disposition: made part of section 3 by an
     amendment.
  10. `game.restart()` starts a new run in place, on the same game object and the same device.
      It does not make a new game and a new device. It uses the first rows, the values and the
      seed that the game started with, and in a page these are the config's `start`. The seed is
      the page's seed, so a game with a seed from the clock restarts with the seed of its page.
      The arrays of the run before stay on the device until it closes, as the runtime has no
      free of one array. A game that started from a save in a test has no first rows, and
      `restart()` refuses it with the fact and a remedy. Proposed disposition: made part of
      section 3 by an amendment.
  11. `game.save()` in a page with a store also writes, and it rejects with the store's error
      when a write fails. The page that goes out of view catches that error and says it by
      `onNotice`. `run` gets three options for this: `store`, `onNotice` and `leaving`. The
      engine takes the writer by an internal function. Proposed disposition: made part of
      section 3 by an amendment.
  12. A text that is there and is refused is copied under `<name>.unreadable` or
      `<name>.backup.unreadable`, or under the same key with `.2`, `.3` and so on, so that a
      second unread save does not overwrite the first copy. A backup that is refused while the
      latest save reads is copied too, because the next save would overwrite it. When a copy
      fails, or the store cannot be read, the page writes no save in that run. Section 3 names
      none of these. Proposed disposition: made part of section 3 by an amendment.
  13. The line of the readout has a new part, `at tick N`, after the tier. `FrameStats` has a
      new field `at`. This changed five expectations of `readout` and `onFrame` in
      `test/run.test.ts`, and the pattern of the readout check in the harness. The owner reads
      the line on a phone, and the part shows that a page goes on from its tick. Proposed
      disposition: closed.
  14. The entry file of a game with `save` also gives `run` the `onNotice` function. The entry
      of a game with no `save` is as it was in step 1. The entry gives `game` to each game.
      Proposed disposition: closed.
  15. Not measured: a write that the browser starts on `pagehide` may not end before the page is
      gone. `visibilitychange` gives more time. The harness drives `pagehide` and waits for the
      key. M3 and the time of a save on a phone are still to measure.
