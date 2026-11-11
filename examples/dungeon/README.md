# The second reference game: a roguelike, written on the raw structure

This game is more evidence for the engine's design. It is a small roguelike, written with
classes, three kernel functions of a `"use typeshade"` file and plain host TypeScript. It uses
the engine's simulation and nothing else of the engine.

The first reference game is [`examples/factory`](../factory). This game tests what that game
does not: rows that come and go, random numbers, and a tick of two functions.

## The game

A dungeon is a grid of tiles and a table of actors. One tick is one turn. Every actor acts in
the same turn, from the state the last turn left.

```text
##########
#@..r...!#
#..##..r.#
#r.#S..o.#
#....!...#
##########
```

- `#` is a wall, `.` a floor, `!` a potion and `S` the spawn tile.
- `@` is the player, `r` a rat and `o` an orc.
- The player goes the way its input says. A rat goes a random way. An orc goes at the player.
- An actor that goes at a cell with an enemy attacks it and stays.
- Two actors can go at one cell. The actor of the lower row gets it.
- An actor with no hit points left is removed.
- A monster comes in on the spawn tile on each eighth turn.
- A potion heals the player and becomes a floor.

| File              | Lines | Content                                                                                     |
| ----------------- | ----- | ------------------------------------------------------------------------------------------- |
| `actors.shade.ts` | 230   | The classes `Actor`, `Want` and `Tile`, three helper functions, `plan`, `turn` and `pickup` |
| `level.ts`        | 156   | Host code: a level from text, the dungeon as text, the simulation, a move                   |
| `dungeon.test.ts` | 150   | Nine tests on a device of the CPU tier                                                      |

## What was observed

| Date       | Configuration                                | Result               |
| ---------- | -------------------------------------------- | -------------------- |
| 2026-11-11 | Compiler pin `6d6a979`, Vitest, the CPU tier | The eight tests pass |

Not run: the game on WebGPU. The game has no page.

## What went well

- The two kernel functions compiled on their first check.
- The pictures of five tests were written by hand from the rules before the code ran. The code
  gave them on its first run.
- A tick of two kernel functions runs: the simulation waits for a tick that is a promise.
- A kernel function reads three tables, and a loop in it reads every row of a table.
- A rat's random numbers come from the compiler's `xorshift32`, and a record replays to the
  same dump.

## What was hard

Each row is a place where the author wrote by hand what a tool can write or check.

| Id  | What the author wrote by hand                                                                      | Size in this game                       |
| --- | -------------------------------------------------------------------------------------------------- | --------------------------------------- |
| R1  | Rows that come and go: a fixed number of slots, a kind `NONE` for a free slot, the first free slot | 1 option, 1 refusal, 22 lines of `turn` |
| R2  | The way each actor goes, found for itself and again for each other actor                           | 2 places that must agree, n by n calls  |
| R3  | Who is in a cell: a scan of every actor, in `turn` and again in `pickup`                           | 2 scans                                 |
| R4  | The rule "the player walks onto this tile", in `turn` and again in `pickup`                        | 2 places that must agree                |
| R5  | The seeds: the first seed of each row, and the seed of a monster that comes in                     | 1 import of an engine file, 1 formula   |
| R6  | One class for every kind of actor, with fields that one kind uses                                  | 3 of 7 fields                           |
| R7  | A turn: an input and then one step. The frame loop of `radiance/page` does not fit.                | 2 host lines in each test               |
| R8  | The replay of a run, since `replaySim` needs the tables and the options                            | 7 lines of a test                       |
| R9  | The grid again: the cell one step away, the edge, the casts between `u32` and `i32`                | 20 lines and 14 casts                   |
| R10 | The player is row 0. Nothing checks it.                                                            | A convention in 3 places                |

What each one cost:

- **R1.** A kernel function cannot add a row. So the table has a fixed number of rows, and the
  host chooses the number. A level with more actors is refused. Each free slot scans every row
  to find if it is the first free one. A game with many spawns in one turn needs more than that.
- **R2.** Each actor must know where the other actors go, to find who attacks it and who gets a
  cell. A helper function finds one actor's way, and the loop calls it for each pair. With 12
  actors that is 144 calls in a turn. A table of the ways, written first and read after, needs
  a tick of two phases.
- **R3.** No table says which actor is in a cell. A scan of the actors answers it. On a large
  grid with many actors the scan is the cost of the turn.
- **R4.** `pickup` runs after `turn` and reads the same old state. So it finds again if the
  player walks onto the tile. When the two differ, a potion heals and stays, or goes and does
  not heal. One test stands between the author and that error.
- **R5.** The engine's world gives each node a seed (design record 0101). The simulation gives
  a row none. The game fills each actor's seed by hand, with the engine's `nodeSeed`.
- **R6.** `move` and `kills` are the player's, and `seed` is the rat's. This is P4 of the first
  game. The kinds as classes of design record 0105 fit, and the fields in common stay in
  `Actor`.
- **R7.** The simulation has a tick rate, and this game has none. The page of this game steps
  when the player gives an input.
- **R8.** `createDungeon` holds the tables and the tick. `replaySim` asks for both again. The
  first game's test gives the tables and the tick a second time for this.
- **R9.** `ahead` of this game is `neighbor` of the first game with one more case. The two
  games do not share it.

## Row seeds and a replay from a builder (design record 0106)

The simulation now gives each first row its seed, and `replaySim` takes the function that
builds the game.

Before, in `level.ts` and in the test:

```ts
import { nodeSeed } from '../../src/seed.ts';
actors.forEach((actor, i) => (actor.seed = nodeSeed(options.seed, `actors[${i}]`)));

const again = make(CAVE, 12, 7);
for (let t = 0; t < record.ticks; t++) {
  for (const input of record.inputs.filter((i) => i.tick === t)) {
    again.sim.input('actors', input.index, input.fields);
  }
  await again.sim.step(1);
}
```

After, the class says `seed: u32 = 0`, and the test says:

```ts
const again = await replaySim(
  (run) => createDungeon(CAVE, { seed: run.seed, device, slots: 12 }).sim,
  d.sim.record(),
);
```

| Id  | State after design record 0106                                                              |
| --- | ------------------------------------------------------------------------------------------- |
| R5  | The first seeds are closed. The seed of a monster that comes in is still a formula by hand. |
| R8  | Closed: 4 lines, and 7 before. The first game's test went from 9 lines to 4.                |

## A table with free slots (design record 0107)

The simulation now knows that the actors have free slots.

Before, in `level.ts`, with the option and the refusal written by the game:

```ts
if (actors.length > options.slots) {
  throw new RangeError(
    `parseLevel(): the level has ${actors.length} actors, and the table has ${options.slots} slots. Give more slots.`,
  );
}
while (actors.length < options.slots) actors.push(new Actor());
```

After, the game says what a free row is:

```ts
slots: { actors: { size: options.slots ?? 16, free: (actor) => actor.kind === NONE } },
```

The dump of 1 actor in 8 slots, before and after:

| Item                         | Before                                   | After                             |
| ---------------------------- | ---------------------------------------- | --------------------------------- |
| The lines of the actor table | 9                                        | 2: `actors  1 of 8` and the actor |
| The lines of `level.ts`      | 166                                      | 157                               |
| The seed of a new monster    | `hash32(seed ^ (tick * 2654435761) ^ i)` | `hash32(a.seed ^ tick)`           |
| The parameters of `turn`     | 9                                        | 8                                 |

| Id  | State after design record 0107                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| R1  | The host's part is closed. The scan for the first free slot stays in `turn`, 6 lines. It waits on compiler issue typeshade/typeshade#1244. |
| R5  | Closed: each slot has a seed, and a new monster takes its random numbers from it.                                                          |

## A turn of three phases (written by the game)

The game now writes what each actor wants into a table first. The engine did not change: a
tick of the simulation already runs several kernel functions.

Before, `turn` found the way of each other actor again, for each actor:

```ts
const goes: i32 = ahead(b.x, b.y, wish(b, p), width, height);
```

and `pickup` found again if the player walks onto the tile, with a scan of every actor.

After, `plan` runs first and writes one row for each actor:

```ts
export function plan(wants: array<Want>, actors: array<Actor>, width: u32, height: u32) {
  for (let i: u32 = 0; i < wants.length; i++) {
    const a: Actor = actors[i];
    let w: Want = wants[i];
    w.target = -1;
    if (a.kind != NONE) { w.target = ahead(a.x, a.y, wish(a, actors[0]), width, height); }
    wants[i] = w;
  }
}
```

`turn` reads `wants[j].target`. `pickup` runs last and reads the actors that `turn` wrote:

```ts
if (t.kind == POTION && p.kind == PLAYER && p.y * width + p.x == i) { t.kind = FLOOR; }
```

| Item                                       | Before | After                                     |
| ------------------------------------------ | ------ | ----------------------------------------- |
| The calls of `wish` in a turn of 12 actors | 144    | 12                                        |
| The places that find where an actor goes   | 2      | 1                                         |
| The places with the rule of the potion     | 2      | 1 rule, and 1 read of where the player is |
| The lines of `pickup`                      | 22     | 8                                         |
| The scans of every actor                   | 3      | 2                                         |

The nine tests pass with no change to a picture or a count.

| Id  | State                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------- |
| R2  | Closed by the game: `plan` writes the table of wants.                                                   |
| R4  | Closed by the game: `pickup` reads the new actors.                                                      |
| R11 | New. The table of wants is no table of the simulation: 3 host lines, and its size must equal the slots. |

**R11.** What the actors want is no state of the game. As a table of the simulation it is in
the dump, the snapshot and each replay. So the game makes it on the device by hand. Nothing
checks that it has one row for each slot.

## What this game does not test

- **A page.** Nothing draws the dungeon, and no GPU tier ran it.
- **A view the player sees.** Every tile is known. There is no field of view.
- **A path.** An orc goes at the player in a straight line and a wall stops it.
- **Sound and a save.**

## What the engine can take from the author

This is a list of candidates, in the order of the cost above. None is designed.

| Candidate                                           | Takes away | Where it lives                                      |
| --------------------------------------------------- | ---------- | --------------------------------------------------- |
| A table with free slots: a row comes in, a row goes | R1, R10    | A library in TypeShade, and the engine's simulation |
| A table of a tick that is no state of the game      | R11        | The engine's simulation                             |
| A table from a cell to its row                      | R3         | A library in TypeShade                              |
| A seed for each row of a simulation                 | R5         | The engine's simulation                             |
| A replay from the function that builds the game     | R8         | The engine's tools                                  |
| A step for each input                               | R7         | `radiance/page`                                     |
| A grid with neighbour reads                         | R9, P1, P2 | A library in TypeShade, or the compiler             |
