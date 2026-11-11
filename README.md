# TypeShade Radiance

A game engine written in [TypeShade](https://typeshade.dev), made for development by a coding
agent.

**Status: early.** Design records 0100 to 0105 are implemented. A scene of nodes runs as tables
on the CPU tier, on a fixed tick. A test reads its dump with no device. A world takes inputs,
records them and replays them. A simulation runs a game's tick on a device, in a test and in a
page. The engine draws nothing yet. [`docs/vision.md`](docs/vision.md) is the design: the claim, the owner's decisions, what an
agent writes and reads, the scene model, the tick, and what is not promised.

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

A game can also write its whole tick as one function of a `"use typeshade"` file (`docs/vision.md`,
D11). The simulation runs such a game from its tables and its tick, with the same dump, inputs
and replay. Its tables live on a device of the compiler's runtime:

```ts
import { createDevice } from 'typeshade/runtime';
import { createSim } from 'radiance';
import { tick } from './cells.shade.ts';

const device = await createDevice({ prefer: ['cpu'] });
const sim = createSim(
  { cells },
  {
    device,
    seed: 1,
    buffered: ['cells'],
    tick: (t) => tick(t.cells.write, t.cells.read, width, height),
  },
);
await sim.step(200);
console.log(await sim.dump());
```

A test gives a device of the CPU tier. A page gives a device of a GPU tier and runs the same
simulation in its frames:

```ts
import { frames } from 'radiance/page';

frames(sim, () => draw(canvas, { cells: sim.table('cells'), view }));
```

[`examples/factory`](examples/factory) is a small automation game written this way. Its
`README.md` lists what is still hard to write, with counts.

The same game runs in a browser, on the same simulation. Its tick runs on a WebGPU device, one
fragment entry draws its cells, and the pointer puts belts:

```sh
bun run build:factory   # the page, in examples/factory/dist
bun run harness         # the page in headless Chromium, held to the CPU tier
```

## The design in short

- An agent makes the game. Each thing the engine does is text the agent can read.
- A scene is TypeScript code. A node's behaviour is a class in a `"use typeshade"` file.
- The author writes a tree of nodes. The engine stores and runs tables.
- The simulation runs on a fixed tick. A game is a function of a seed and its inputs.
- Game logic runs on the CPU tier. The GPU draws the frame and computes wide effects.
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

| Path                    | Content                                                          |
| ----------------------- | ---------------------------------------------------------------- |
| `docs/vision.md`        | The design                                                       |
| `docs/design/README.md` | What a design record is, and when a change needs one             |
| `docs/design/0100-*.md` | Design record 0100: the world on the CPU tier                    |
| `docs/design/0101-*.md` | Design record 0101: inputs, the replay and the seed              |
| `docs/design/0102-*.md` | Design record 0102: tables and a tick                            |
| `docs/design/0103-*.md` | Design record 0103: the game in a browser                        |
| `docs/design/0104-*.md` | Design record 0104: the simulation on a device                   |
| `docs/design/0105-*.md` | Design record 0105: kinds as classes                             |
| `examples/factory/`     | The reference game, and what was hard to write in it             |
| `src/`                  | The engine: `node`, `scene`, the world, the simulation, `frames` |
| `scripts/`              | The prose checks and the commit gate                             |
| `test/`                 | The tests, and the `.shade.ts` fixtures they import              |
| `CLAUDE.md`             | The rules for a session with a coding agent                      |
| `.agents/`, `.claude/`  | The installed skills, pinned by `skills-lock.json`, and the hook |

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
