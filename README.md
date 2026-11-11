# TypeShade Radiance

A game engine written in [TypeShade](https://typeshade.dev), made for development by a coding
agent.

**Status: early.** Design records 0100 to 0108 are implemented. A game is a project of a fixed
shape. The engine reads the project, writes the game's class and runs it: it opens the device,
owns each array and runs the loop. A test loads the same project on the CPU tier. The engine
has no drawing layer of its own yet. [`docs/vision.md`](docs/vision.md) is the design: the
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

The factory also runs in a browser. `run` of `radiance/page` opens a WebGPU device, runs the
loop, gives the pointer to the functions of the project's `input/` and calls its `draw/draw.ts`
for each frame:

```ts
import { run } from 'radiance/page';
import { Game } from './.radiance/game.ts';

const game = await run(Game, { seed: 1, canvas, rows: level.rows, values: level.values });
```

```sh
bun run build:factory   # the page, in examples/factory/dist
bun run harness         # the page in headless Chromium, held to the CPU tier
```

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
