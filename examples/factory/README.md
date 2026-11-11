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

| File              | Lines | Content                                                                 |
| ----------------- | ----- | ----------------------------------------------------------------------- |
| `cells.shade.ts`  | 158   | The class `Cell`, three helper functions and `tick`                     |
| `level.ts`        | 105   | Host code: a level from text, the factory as text, the loop, the counts |
| `factory.test.ts` | 89    | Six tests on the CPU tier                                               |

## What was observed

| Date       | Configuration                                          | Result                                                                    |
| ---------- | ------------------------------------------------------ | ------------------------------------------------------------------------- |
| 2026-11-11 | Compiler pin `6d6a979`, Vitest, the CPU tier           | The six tests pass                                                        |
| 2026-11-11 | Headless Chromium on SwiftShader, `prefer: ['webgpu']` | 200 ticks of a 8 by 5 level. The cells equal the CPU tier's, bit for bit. |
| 2026-11-11 | The same, `prefer: ['webgl2']`                         | Refused: the loop writes an array whose element is a class                |

The browser run is not in CI. It ran once from a scratch directory.

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

## What this game does not test

- **Adding and removing rows.** An item lives in its cell, so no row is added or removed. A game
  with items that are rows of their own needs that, and it is the hardest part to write in a
  parallel loop.
- **Drawing, input and sound.** The game shows text only.
- **A save.** The cells are data, and nothing writes them to storage.
- **Random numbers.** The rules have none.
- **A level setting.** The periods are constants of the module. A level cannot change one.

## What the engine can take from the author

This is a list of candidates, in the order of the cost above. None is designed.

| Candidate                                          | Takes away | Where it lives                                       |
| -------------------------------------------------- | ---------- | ---------------------------------------------------- |
| A grid with neighbour reads                        | P1, P2     | A library in TypeShade, or a request to the compiler |
| A table that is read and written by one name       | P3         | The build, or a request to the compiler              |
| Kinds as classes on one grid                       | P4         | The build                                            |
| A scene, a dump and a replay for the raw structure | P5         | The engine's tools                                   |
| A count that the tick keeps                        | P6         | A library in TypeShade                               |
| The thin loop                                      | P7         | The build                                            |
| A tick of several functions                        | P8         | The compiler (proposal 0138, R12)                    |
