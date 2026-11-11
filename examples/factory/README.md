# The reference game: a factory, written on the raw structure

This game is the evidence for the engine's design. It is a small automation game, written with
classes, one tick function of a `"use typeshade"` file and plain host TypeScript. It uses
nothing of the engine. `docs/vision.md` (D10, D11 and D12) gives the structure.

Each engine feature that makes a game easier to write shows this game's code before and after.
This file lists what was hard to write, with counts, so that each feature has a measured
reason.

## The game

A factory is a grid of cells. A source makes an item. A belt carries one item to the cell it
points at. A machine takes items and makes goods.

```text
E>>>v
....v
0<<<<
```

- `E` is a source that sends its items east. `> v <` are belts. The digit is a machine and its
  stock.
- A belt with an item shows `o`. A source that holds an item shows its letter in lower case.
- Two belts can point at one cell. The cell takes from the first ready neighbour in the order
  north, east, south, west.

| File                 | Lines | Content                                                                            |
| -------------------- | ----- | ---------------------------------------------------------------------------------- |
| `cells.shade.ts`     | 239   | The classes `Belt`, `Source`, `Machine` and `Cell`, one helper function and `tick` |
| `level.ts`           | 156   | Host code: a level from text, the factory as text, an input, the counts            |
| `factory.test.ts`    | 150   | Eight tests on a device of the CPU tier                                            |
| `draw.shade.ts`      | 35    | The fragment entry that draws the cells                                            |
| `main.ts`            | 82    | The page: the device, the picture, the pointer                                     |
| `factory.harness.ts` | 117   | Four checks in a browser                                                           |

## What was observed

| Date       | Configuration                                          | Result                                                                    |
| ---------- | ------------------------------------------------------ | ------------------------------------------------------------------------- |
| 2026-11-11 | Compiler pin `6d6a979`, Vitest, the CPU tier           | The eight tests pass                                                      |
| 2026-11-11 | Headless Chromium on SwiftShader, `prefer: ['webgpu']` | 200 ticks of a 8 by 5 level. The cells equal the CPU tier's, bit for bit. |
| 2026-11-11 | The same, `prefer: ['webgl2']`                         | Refused: the loop writes an array whose element is a class                |

That browser run was from a scratch directory. The harness of design record 0103 now runs the
page in CI.

## What went well

- The tick compiled on its first check, and the compiler refused nothing in it.
- Twelve frames of the first level were written by hand from the rules before the code ran. The
  code gave them on its first run.
- Every field is an integer, so the CPU tier and WebGPU agree on each bit.
- The refusals that did come are clear. Each names the line, the fact and a remedy.

## What was hard

Each row is a place where the author wrote by hand what a tool can write or check.

| Id  | What the author wrote by hand                                                                   | Size in this game                       |
| --- | ----------------------------------------------------------------------------------------------- | --------------------------------------- |
| P1  | The grid: the index of a neighbour, the edge of the grid, and the casts between `u32` and `i32` | 16 lines and 10 casts                   |
| P2  | The scan of the four neighbours, written twice: once to take and once to give                   | 2 blocks of 9 lines that must agree     |
| P3  | Two arrays, one read and one written, and the swap of the two in the host loop                  | A parameter, 4 host lines, a convention |
| P4  | One class for every kind of cell, with a `kind` tag and fields that mean other things by kind   | 6 fields, 2 with two meanings           |
| P5  | The level: a parser from text and a printer to text                                             | 34 and 16 lines of host code            |
| P6  | The counts for a score: a host loop over every cell after a read                                | 18 lines                                |
| P7  | The loop: `await` in each tick, the device, the arrays on it, the read                          | 9 lines, and it differs by tier         |
| P8  | The rules in one function of 81 lines, since a function with a loop cannot call another         | 1 function                              |

What each one cost:

- **P1.** A wrong edge test reads the cell on the other side of the grid and gives no error.
- **P2.** A cell gives when its target takes from it. The author writes the target's choice a
  second time. When the two copies differ, an item is lost or made from nothing. The test of
  conservation caught no such error here, but only that test stands between the author and it.
- **P3.** A tick that writes the array it reads gives a result that depends on the order of the
  cells. Nothing checks that the host swaps the arrays.
- **P4.** `wait` is the time to the next item for a source, the time on a belt for a belt and
  the time to the next good for a machine. `made` counts items for a source and goods for a
  machine. A separate class for each kind needs a table for each kind, and the grid then needs
  an index from a cell to its row.
- **P5.** The engine's `scene`, `dump` and `replay` (design records 0100 and 0101) do not apply:
  they read the engine's world, and this game has none.
- **P6.** On a GPU tier, a score needs a read of the whole table, and the read arrives late.
- **P7.** The loop is the thin loop that D10 leaves in a shipped game. Here it is written by
  hand.
- **P8.** The compiler refuses a function with a loop that another function calls (`TS8099`,
  Rule 8.6). A helper function cannot take a table either (`TS8020`): a probe on 2026-11-11
  observed it. So the scan of P2 cannot move into a helper.

## The first feature: the simulation (design record 0102)

The engine's simulation now runs the game's ticks. It took the host's loop (P7), the swap of
the two arrays (the host's part of P3) and the tools of P5.

Before, the game's own loop, with the swap written by hand:

```ts
export async function run(factory: Factory, ticks: number): Promise<void> {
  let prev = factory.cells;
  let next = factory.cells.map(() => new Cell());
  for (let t = 0; t < ticks; t++) {
    await tick(next, prev, factory.width, factory.height);
    [prev, next] = [next, prev];
  }
  factory.cells = prev;
}
```

After, the game says what its table is and what a tick is:

```ts
const sim = createSim(
  { cells },
  {
    seed: options.seed,
    buffered: ['cells'],
    tick: (t) => tick(t.cells.write, t.cells.read, width, height),
  },
);
```

What changed, measured:

| Item                             | Before                       | After                                           |
| -------------------------------- | ---------------------------- | ----------------------------------------------- |
| The loop and the swap            | 9 lines, written by the game | None. The simulation runs and swaps.            |
| The lines of `level.ts`          | 105                          | 121                                             |
| An input from the player         | None                         | `sim.input('cells', 2, { kind: BELT, dir: 1 })` |
| A record of a run and its replay | None                         | `sim.record()`, `replaySim(...)`                |
| A dump of every field            | None                         | `sim.dump()`                                    |
| The tests                        | 6                            | 8                                               |

The host code did not get shorter. It got 16 lines longer, since the factory now holds a
simulation and the types say so. The gain is in what the author can no longer get wrong and in
what the game can now do. The new test builds a belt with an input while the game runs, and
replays the run from its record.

The state of each item:

| Id  | State after design record 0102                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------- |
| P1  | Open. It waits on compiler issue typeshade/typeshade#1244.                                                             |
| P2  | Open. The same.                                                                                                        |
| P3  | The host's part is closed: the simulation swaps. The tick still takes two arrays.                                      |
| P4  | Open.                                                                                                                  |
| P5  | The tools are closed: the dump, the input and the replay apply. The parser and the picture as text stay with the game. |
| P6  | Open.                                                                                                                  |
| P7  | Closed for a test. The loop of a shipped game is the build's, and no record has it yet.                                |
| P8  | Open. It is the compiler's (proposal 0138, R12).                                                                       |

## The game in a browser (design record 0103)

The game has a page. Its tick runs on a GPU device, one fragment entry draws the cells, and a
drag of the pointer puts belts. In this record `main.ts` was the thin loop that D10 leaves in
a shipped game, written by hand, and the page used nothing of the engine. Design record 0104
changed that (below).

```sh
bun run build:factory   # the page, in examples/factory/dist
bun run harness         # the page in headless Chromium, held to the CPU tier
```

What the harness observed on 2026-11-11 (compiler pin `6d6a979`, headless Chromium, Playwright
1.63.0, WebGPU on SwiftShader):

| Check   | Result                                                                                    |
| ------- | ----------------------------------------------------------------------------------------- |
| Tier    | The device opened `webgpu`.                                                               |
| Cells   | After 200 ticks with one belt put at tick 50, the GPU's cells equal the CPU tier's.       |
| Picture | A source is green and an empty cell is dark in a screenshot.                              |
| Size    | 605,905 bytes built in three files. The page loaded one: 278,406 bytes, 86,653 with gzip. |

The two files the page did not load are the WebGL2 runtime and the planner of `fuse`.

### What was hard in the page

| Id  | What the author wrote by hand                                                                   | Size in this game                   |
| --- | ----------------------------------------------------------------------------------------------- | ----------------------------------- |
| P9  | An input on the device: a kernel function that visits every cell to write one, and a queue      | 13 lines of TypeShade, 5 host lines |
| P10 | The frame loop: a fixed tick from a clock, the ticks that are due, the swap of the two arrays   | 23 lines                            |
| P11 | The picture: the cell of a pixel, a colour for each kind, the size of the canvas as a uniform   | 48 lines of TypeShade               |
| P12 | The pointer: a pixel to a cell, a drag to a direction                                           | 13 lines                            |
| P13 | The same input, said two ways: `place` on the device and `sim.input` with five fields in a test | 2 places that must agree            |
| P14 | The picture in a test: a copy of the WebGPU canvas is black, so the test decodes a screenshot   | 12 lines of the harness             |

What each one cost:

- **P9.** The host cannot write one row of an array on the device. The compiler's proposal 0048
  (a host replaces part of a `Resident`) is a draft. So `place` runs over every cell to change
  one.
- **P10.** The simulation of design record 0102 does not run on a device, so the loop and the
  swap of P3 are written by hand again. The page has no record and no replay.
- **P11.** The picture has the same `kind` tag as the tick (P4), in a second file. A new kind of
  cell is a change in both.
- **P13.** The harness holds the GPU to the CPU tier. To do so, the test gives the CPU tier the
  input as five field values, and the page gives the device the input as a call. Nothing says
  that the two are the same input.

## The simulation on a device (design record 0104)

The engine's simulation now holds its tables on a device. A test gives it a device of the CPU
tier, and the page gives it a device of a GPU tier. `createFactory` and `putCell` of `level.ts`
are the same code in both. `frames`, from `radiance/page`, runs the page's loop.

Before, the page had its own arrays, its own loop and its own input:

```ts
let prev = device.array(level.cells);
let next = device.array(level.cells);
const queue: Put[] = [];
async function advance(n: number) {
  for (let i = 0; i < n; i++) {
    for (const put of queue.splice(0)) {
      await place(next, prev, put.x, put.y, put.kind, put.dir, width);
      [prev, next] = [next, prev];
    }
    await tick(next, prev, width, height);
    [prev, next] = [next, prev];
  }
}
// ...and 23 lines of a frame loop with a clock
```

After, the page builds the factory as a test does:

```ts
const device = await createDevice({ prefer: ['webgpu', 'webgl2'] });
const factory = createFactory(DEMO, { seed: 1, device });
const paint = () => draw(canvas, { cells: factory.sim.table('cells'), view });
canvas.addEventListener('pointermove', (event) => {
  // ...
  putCell(factory, last.x, last.y, BELT, dir);
});
frames(factory.sim, paint);
```

What changed, measured on 2026-11-11 (compiler pin `6d6a979`, headless Chromium, Playwright
1.63.0, WebGPU on SwiftShader):

| Item                            | Before                                   | After                               |
| ------------------------------- | ---------------------------------------- | ----------------------------------- |
| The lines of `main.ts`          | 115                                      | 82                                  |
| The kernel function `place`     | 13 lines of TypeShade, and a test        | None                                |
| The frame loop                  | 23 lines, written by the game            | `frames(sim, paint)`                |
| An input in the page and a test | A call of `place`, and five field values | `putCell(factory, x, y, kind, dir)` |
| A record of the page's run      | None                                     | `sim.record()`                      |
| The bytes the page loads        | 278,406                                  | 276,081                             |
| The same, with gzip             | 86,653                                   | 87,984                              |
| The bytes built, in three files | 605,905                                  | 603,580                             |

The cost against D10: the page now holds the engine's simulation, with its dump, its snapshot
and its record. The file the page loads lost 2,325 bytes, since the game's own loop and `place`
left it. With gzip it gained 1,331 bytes. A build that removes the tools from a shipped game is
a later record.

A cost that stays: an input reads the whole table from the device, changes one row and writes
the whole table. A tick with no input reads nothing. A write of one row waits on the compiler's
proposal 0048.

| Id  | State after design record 0104                                                                    |
| --- | ------------------------------------------------------------------------------------------------- |
| P3  | Closed for the host on each tier. The tick still takes two arrays.                                |
| P7  | Closed for a test and for a page. The engine's loop is in the page until a build writes one.      |
| P9  | The game's part is closed: no `place`, no queue. The whole read and write stay inside the engine. |
| P10 | Closed: `frames`.                                                                                 |
| P11 | Open.                                                                                             |
| P12 | Open.                                                                                             |
| P13 | Closed: one function gives the input on each tier.                                                |
| P14 | Open.                                                                                             |

## Kinds as classes (design record 0105)

Each kind of cell is now a class with its own fields, its rules as methods and its colour as a
method. `Cell` is a tag and one field for each kind, written by hand. The engine adds no code
for this. Its one change is that an input can write a field that holds a class.

Before, one class for every kind, and the rules as blocks of the tick function:

```ts
export class Cell {
  kind: u32 = 0;
  dir: u32 = 0;
  item: u32 = 0;
  wait: u32 = 0; // three meanings, by kind
  stock: u32 = 0;
  made: u32 = 0; // two meanings, by kind
}

// in tick:
if (c.kind == BELT) {
  if (gives) { c.item = 0; }
  if (takes) {
    c.item = 1;
    c.wait = BELT_PERIOD;
  } else if (c.item != 0 && c.wait > 0) {
    c.wait = c.wait - 1;
  }
}
```

After, the belt is one class, and the tick function calls `c.step(takes, gives)`:

```ts
export class Belt {
  dir: u32 = 0;
  item: u32 = 0;
  wait: u32 = 0;
  ready(): bool {
    return this.item != 0 && this.wait == 0;
  }
  step(takes: bool, gives: bool) {
    if (gives) { this.item = 0; }
    if (takes) {
      this.item = 1;
      this.wait = BELT_PERIOD;
    } else if (this.item != 0 && this.wait > 0) {
      this.wait = this.wait - 1;
    }
  }
  color(local: vec2): vec3 {
    return sender(vec3(0.26, 0.28, 0.32), this.dir, this.item, local);
  }
}
```

What changed, measured on 2026-11-11 (compiler pin `6d6a979`, headless Chromium, Playwright
1.63.0, WebGPU on SwiftShader):

| Item                                  | Before  | After                                |
| ------------------------------------- | ------- | ------------------------------------ |
| The lines of the tick function        | 81      | 44                                   |
| The lines of `cells.shade.ts`         | 158     | 239                                  |
| The lines of `draw.shade.ts`          | 48      | 35                                   |
| The files a new kind changes          | 2       | 1, and the host's parser and printer |
| The fields with two or three meanings | 2       | 0                                    |
| The words of one cell                 | 6       | 11                                   |
| The bytes the page loads              | 276,081 | 297,630                              |
| The same, with gzip                   | 87,984  | 91,262                               |

The tests give the same pictures and the same counts as before. The harness passed: the cells
of the GPU device equal the cells of the CPU device.

The costs:

- The game got longer by 76 lines in all. Each kind says its fields and its rules in full.
- A cell holds the fields of every kind, so a cell is 44 bytes and was 24.
- The page loads 21,549 bytes more.

What is hard now:

| Id  | What the author wrote by hand                                                          | Size in this game                       |
| --- | -------------------------------------------------------------------------------------- | --------------------------------------- |
| P15 | The choice by the tag: each method of `Cell` asks the kind and calls the kind's method | 5 methods, 11 lines with `if`           |
| P16 | The dump of a cell shows the fields of every kind, and only one kind is in use         | 3 objects in each line                  |
| P17 | An input that puts a cell names the fields of the new kind, one form for each kind     | 6 lines, and 1 before                   |
| P18 | On WebGL2 the picture does not emit: the cells hold a class in a class                 | Compiler issue typeshade/typeshade#1249 |

| Id  | State after design record 0105                                                           |
| --- | ---------------------------------------------------------------------------------------- |
| P4  | Closed for the meaning of the fields. The tag and the choice by the tag stay (P15).      |
| P8  | Part closed: the rules of a kind left the tick function, as methods. The two scans stay. |
| P11 | Closed: the colour of a kind is a method of its class.                                   |

## What this game does not test

- **Adding and removing rows.** An item lives in its cell, so no row is added or removed. A game
  with items that are rows of their own needs that, and it is the hardest part to write in a
  parallel loop.
- **Sound.** The game has none.
- **A save.** The cells are data, and nothing writes them to storage.
- **Random numbers.** The rules have none.
- **A level setting.** The periods are constants of the module. A level cannot change one.

## What the engine can take from the author

This is a list of candidates, in the order of the cost above. None is designed.

| Candidate                                          | Takes away | Where it lives                                                  |
| -------------------------------------------------- | ---------- | --------------------------------------------------------------- |
| A grid with neighbour reads                        | P1, P2     | A library in TypeShade, or a request to the compiler            |
| A table that is read and written by one name       | P3         | The build, or a request to the compiler                         |
| Kinds as classes on one grid                       | P4         | The build                                                       |
| A scene, a dump and a replay for the raw structure | P5         | The engine's tools                                              |
| A count that the tick keeps                        | P6         | A library in TypeShade                                          |
| The thin loop                                      | P7         | The build                                                       |
| A tick of several functions                        | P8         | The compiler (proposal 0138, R12)                               |
| An input that is one thing on each tier            | P9, P13    | The engine's simulation on a device, and compiler proposal 0048 |
| The frame loop                                     | P10        | The build                                                       |
| A picture from the kinds                           | P11        | The build, or a library in TypeShade                            |
| The pointer on a grid                              | P12        | A small host library                                            |
