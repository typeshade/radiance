# TypeShade Radiance

A game engine written in [TypeShade](https://typeshade.dev), made for development by a coding
agent.

**Status: early.** Design records 0100 to 0110 are implemented, and 0111 is in progress. A game
is a project of a fixed shape. The engine reads the project, writes the game's class and runs
it: it opens the device, owns each array and runs the loop. A test loads the same project on the
CPU tier. A game draws in layers, on WebGPU. [`docs/vision.md`](docs/vision.md) is the design: the
claim, the owner's decisions, what an agent writes and reads, the tick, and what is not
promised.

## What runs today

A behaviour is a class in a `"use typeshade"` file:

```ts
"use typeshade";

export class Belt {
  speed: f32 = 1.;
  offset: f32 = 0.;
  step(dt: f32) {
    this.offset = fract(this.offset + this.speed * dt);
  }
}
```

A scene is a tree of nodes. A test runs it and reads the result as text:

```ts
import { node, scene } from 'radiance';
import { simulate } from 'radiance/test';
import { Belt } from './belt.shade.ts';

const factory = scene(node('line-1', node(Belt, { speed: 2 }), node('spare', Belt, { speed: 0 })));
const world = simulate(factory, { ticks: 30, seed: 7 });
console.log(world.dump());
```

```text
tick 30  seed 7  hz 60
line-1
  Belt#0  speed 2  offset 3.5762787e-7
  spare  Belt  speed 0  offset 0
```

The run needs no GPU and no browser. Two runs with one seed give the same text.

A game changes a running world with an input. The world records each input, and a record
replays to the same text:

```ts
import { createWorld } from 'radiance';
import { replay } from 'radiance/test';

const world = createWorld(factory, { seed: 7 });
world.input('line-1/Belt#0', { speed: 4 });
world.step(2);

replay(factory, world.record()).dump() === world.dump(); // true
```

A class that needs random numbers declares a field named `seed`, and the world fills it.

A game is a project (design record 0108). A file's place says what it is. The engine reads the
files and writes the game's class. The game opens no device, makes no array and passes no
table to a function.

[`examples/factory`](examples/factory) is a small automation game, and
[`examples/dungeon`](examples/dungeon) is a small roguelike with rows that come and go and with
random numbers. The `README.md` of each lists what is still hard to write, with counts.

```text
examples/dungeon/
  radiance.config.ts       defineGame({ tick: ['plan', 'turn', 'pickup'], ... })
  state/actors.shade.ts    one file is one table
  scratch/wants.shade.ts   a table of a tick that is no state
  systems/plan.shade.ts    one file is one step of a tick
```

```ts
import { load } from 'radiance/test';

const game = await load('examples/dungeon', { seed: 7, level: 'cave' });
await game.step(1);
console.log(await game.dump());
await game.dispose();
```

`bun bin/radiance.ts sync examples/dungeon` writes `.radiance/game.ts`, the class of the game.
A table of the game is `game.tables.actors`.

The factory also runs in a browser. `run` of `radiance/page` opens a device, runs the loop,
gives the pointer to the functions of the project's `input/` and draws each frame. A game with
layers draws its layers (next section). A game with a `draw/draw.ts` and no `draw` in its
config calls that function for each frame:

```ts
import { run } from 'radiance/page';
import { Game } from './.radiance/game.ts';

const game = await run(Game, { seed: 1, canvas, rows: level.rows, values: level.values });
```

```sh
bun run build:factory   # the page, in examples/factory/dist
bun bin/radiance.ts build --readout examples/factory   # the same, with the tier, the times and the commit on the page
bun run harness         # the page in headless Chromium, held to the CPU tier
```

## A layer

A game draws in layers (design record 0111). A layer is a file of `draw/`. It draws one square
for each row of one table, and the table stays on the device. The game writes no host code for
drawing. The config gives the order of the layers and the view:

```ts
export default defineGame({
  tick: ['tick'],
  values: ['width', 'height'],
  draw: ['cells', { layer: 'items', blend: 'alpha' }],
  view: { fit: [10, 6], clear: [0.03, 0.03, 0.04] },
});
```

- `draw` lists the layers from the back to the front. An entry is a name, a file
  `draw/<name>.shade.ts`, or `{ layer, blend }`.
- `blend` says how the colour of a layer meets the colour under it. Without it, the layer covers
  what is under it. `'alpha'` draws the colour over it by the layer's alpha. `'add'` adds the
  colour, by the layer's alpha, to it. `radiance sync` refuses any other word and gives the
  choices.
- `view.fit` is a rectangle of the world, `[width, height]`, with its first corner at the
  origin. The x axis goes right, and the y axis goes down.
- The engine gives the layers a `view` matrix. The whole rectangle is on the screen, in the
  middle, as large as it can be. One unit has the same length on both axes.
- `view.clear` is the colour of the part of the screen that the rectangle does not cover.
- `game.toWorld({ x, y })` turns a place of the screen, from 0 to 1 as the pointer gives it,
  into a place of the world. A drag in `input/` uses it.

A layer exports one `@vertex` entry and one `@fragment` entry. The vertex entry runs six times
for each row, for the two triangles of a square. The engine binds each `declare const` of the
layer by its name:

| Name                             | What the engine gives                                        |
| -------------------------------- | ------------------------------------------------------------ |
| The name of a table or a scratch | The table on the device. A layer names exactly one table.    |
| `view`                           | `uniform<mat4x4>`: a place of the world to a place on screen |
| `blend`                          | `uniform<f32>`: the time between two ticks, from 0 to 1      |
| `tick`, `seed`, `dt`             | The engine's values, as a system gets them                   |
| A name of the config's `values`  | That value                                                   |

`radiance sync` refuses any other name, and it names the names that the engine knows. It also
refuses a name that the layer's file never uses, because the compiler refuses it at the first
frame. A layer changes no table. A replay does not run it. A layer runs on WebGPU only at this compiler pin.
A browser with no WebGPU gets an error that names the layer and the compiler issues. The CPU
tier runs the ticks and draws nothing.

`blend` is how far the frame is from the last tick to the tick after it. A game with a clock
gets the part of a tick that the loop still owes. A game with `stepOn: 'input'` gets 0 after a
tick, and 1 one tick later. A layer uses it to place what moves. A tick does not read it, and
`load` of `radiance/test` gives 0. `game.blend` is the value of the loop.
`game.drawLayers({ blend })` draws one frame with a given `blend`.

## A save and a start from it

A run gives a save, and a run starts from a save (design record 0112). A
save is JSON. It holds each table of the game's state by the names of its fields. It holds no
scratch table, because a tick makes a scratch table again.

```ts
import { load } from 'radiance/test';

const game = await load('examples/factory', { seed: 1, level: 'demo' });
await game.step(50);
const save = await game.save();
await game.dispose();

const again = await load('examples/factory', { from: save });
await again.step(50); // The dump equals the dump of one run of 100 ticks.
```

- `game.save()` waits for the tick in work. Then it reads each table once. It gives a `Save`.
  `JSON.parse(JSON.stringify(save))` equals the save.
- A number that JSON cannot hold is the text that a dump uses: `"NaN"`, `"Infinity"`,
  `"-Infinity"` and `"-0"`. A start from the save reads the text as the number.
- A save holds the `format` (1), the `game` (the name of the config, or the name of the
  project's directory), the `version`, the `tick`, the `seed`, the `hz`, the `values` and the
  `tables`. Until step 3, the `version` is always 1.
- A start from a save needs no level and no seed. A save holds each one of them. `load` and `run`
  refuse `from` together with a `seed`, a `level` (the `rows` and the `values`) or another `hz`.
- A start from a save goes on as a run that never stopped. The check is: 50 ticks, a save, a
  start from it and 50 ticks give the dump of 100 ticks. It runs on both reference games on the
  CPU tier, and on the factory in the browser on WebGPU.
- A start from a save refuses a save of another game, a `format` that the engine does not know,
  a table or a field that the game does not have, a table or a field that the game has and the
  save lacks, and a `version` later than the game's. Each message gives the fact and a remedy.
- An input that waits for the next tick is not in a save. Call `game.save()` after the inputs
  of the last tick.
- The record of a run that started from a save has a `from`: the tick of the save. A record
  with `from` replays only with the same save, as `replayGame(Game, { from: save }, record)`.

### The page keeps the save

A game with `save` in its config keeps its save on the device (design record 0112, section 3):

```ts
export default defineGame({
  name: 'Factory',
  save: { version: 1 },
});
```

- `save.version` is an integer from 1. `radiance sync` refuses another value.
- The entry file that `radiance build` writes gives `run` a store of the browser (`browserStore()`
  of `radiance/page`, over IndexedDB) and the version. A game with no `save` gets no store.
- A store is `{ read(key), write(key, text) }`. `read` gives `undefined` for a key with no
  text. A test, a native shell or a store package gives its own, as the `store` option of `run`.
  `run` needs the `game` option with a store, because the name of the game is the key.
- **The keys.** The latest save is under the name of the game, for example `Factory`. The save
  before it is under `Factory.backup`.
- **When.** The page saves when it goes out of view: on `visibilitychange` when the document is
  hidden, and on `pagehide`. It saves when the game calls `game.save()`. In a page with a
  store, `game.save()` also writes. The page does not save on each tick.
- **The order of the two writes.** One save is two writes:
  1. Write the latest good save that the page knows under the backup key.
  2. Write the new save under the name of the game.

  A write is whole or it fails. After write 1, both keys hold the latest good save. After write
  2, the name holds the new save and the backup holds the one before. A failed write, or a page
  that closes between the two writes, leaves a good save to read. The first save of a game has
  no save before it, so it is one write. A browser's write is one IndexedDB transaction.

- **At the start.** `run` reads the latest save. With one that the game reads, the run starts
  from it. With none, the run starts from `start` of the config, as it did.
- **A save that cannot be read.** A text that is not JSON, or that the start refuses, is not
  read. `run` then tries the backup. With no backup that reads, `run` starts from `start`.
  Each text that was not read is copied under `Factory.unreadable` or
  `Factory.backup.unreadable`. When that key holds another text, the copy goes under the key
  with `.2`, `.3` and so on. The engine never deletes a save. When a copy fails, or the store
  cannot be read, the page writes no save in that run.
- **What the page says.** `run` calls `onNotice(message)` with one sentence about a save that
  was not read, and about a write that failed in a page that went out of view. The loop goes on.
  The page of a build with `--readout` shows the sentence before the numbers. Without
  `--readout`, the page writes it to the console.
- **A new run.** `game.restart()` starts a new run on the same device, from the first rows, the
  values and the seed that the page started with (the config's `start`). It writes the new
  state over the save, and the run before becomes the backup. The picture and the loop go on.
  The arrays of the run before stay on the device until the game is disposed.
- **The readout.** The line shows `at tick N`: the tick the game is at. A page that was opened
  again shows the tick of its save.

## The design in short

- An agent makes the game. Each thing the engine does is text the agent can read.
- A scene is TypeScript code. A node's behaviour is a class in a `"use typeshade"` file.
- A game is a class that extends the engine. The framework manages the project and its files.
- The simulation runs on a fixed tick. A game is a function of a seed and its inputs.
- The engine is the framework a game is written on. It owns the device, the memory and the
  runtime. A build gives a small result.
- A shipped game runs its tick on a GPU tier. The CPU tier runs the tests.
- The platform is the web. A game ships as a store package and needs no server.
- The first games are offline games of the roguelike kind and the automation kind.

## The first model

This repository first held a path-tracing renderer of the same name. It tested the compiler's
feedback loop. The owner decided on 2026-11-11 to design the engine again from nothing and to
keep the name.

The first model is on the branch `legacy`, at commit `3e4efb3f`: its packages, its design
records 0001 to 0011, its plan and its site. Compiler proposals that cite the first model cite
its commits, and those commits stay reachable.

## Layout

| Path                    | Content                                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| `docs/vision.md`        | The design                                                                                         |
| `docs/design/README.md` | What a design record is, and when a change needs one                                               |
| `docs/design/0100-*.md` | Design record 0100: the world on the CPU tier                                                      |
| `docs/design/0101-*.md` | Design record 0101: inputs, the replay and the seed                                                |
| `docs/design/0102-*.md` | Design record 0102: tables and a tick                                                              |
| `docs/design/0103-*.md` | Design record 0103: the game in a browser                                                          |
| `docs/design/0104-*.md` | Design record 0104: the simulation on a device                                                     |
| `docs/design/0105-*.md` | Design record 0105: kinds as classes                                                               |
| `docs/design/0106-*.md` | Design record 0106: row seeds and a replay from a builder                                          |
| `docs/design/0107-*.md` | Design record 0107: a table with free slots                                                        |
| `docs/design/0108-*.md` | Design record 0108: the project is the structure                                                   |
| `docs/design/0109-*.md` | Design record 0109: the build                                                                      |
| `docs/design/0110-*.md` | Design record 0110: a build the owner opens on a phone                                             |
| `docs/design/0111-*.md` | Design record 0111: layers drawn from tables                                                       |
| `docs/design/0112-*.md` | Design record 0112: a save of a run                                                                |
| `examples/factory/`     | The reference game, and what was hard to write in it                                               |
| `examples/dungeon/`     | The second reference game, a roguelike, and what was hard in it                                    |
| `src/`                  | The engine: the runtime `Engine`, the project reader, the simulation inside it, the world of nodes |
| `scripts/`              | The prose checks and the commit gate                                                               |
| `test/`                 | The tests, and the `.shade.ts` fixtures they import                                                |
| `CLAUDE.md`             | The rules for a session with a coding agent                                                        |
| `.agents/`, `.claude/`  | The installed skills, pinned by `skills-lock.json`, and the hook                                   |

## Checks

`bun run check` runs five checks, and CI runs the same five:

| Script         | What it checks                                                                    |
| -------------- | --------------------------------------------------------------------------------- |
| `format:check` | The format, with Prettier                                                         |
| `check:prose`  | No em dash in a document                                                          |
| `check:ste`    | The structural rules of Simplified Technical English in each document             |
| `typecheck`    | The shader files with `tshc check`, the host views, and the host files with `tsc` |
| `test`         | The tests, with Vitest on the CPU tier. No device and no browser.                 |

`bun run harness` is a second run, for the checks that need a browser with a GPU (design record
0103). It builds the reference game's page, opens it in headless Chromium with WebGPU, and holds
the cells the GPU computed to the CPU tier. CI runs it in the job `harness (headless WebGPU)`.

`bun install` runs `tshc sync`, which writes the host view of each `.shade.ts`.

## The compiler pin

The compiler is pinned as a source tarball: the `typeshade` entry of `dependencies` in
`package.json`. The pin is commit `6d6a979`. Design record 0100 (section 1) holds the decision.

## Licence

Apache-2.0. See [`LICENSE`](LICENSE).
