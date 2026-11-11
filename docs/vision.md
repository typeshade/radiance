# Radiance: the design of the game engine

> **Status:** design, written 2026-11-11. Nothing in this document is implemented. The owner
> decided D1 to D8 and accepted U1 to U9 on 2026-11-11. Every claim about the compiler names
> a section of its surface document (`docs/use-typeshade-surface.md`, "§"), a rule of its design
> rules (`docs/language-design.md`, "Rule"), or a change proposal (`changes/`, "change NNNN").
> The compiler was read at `typeshade/typeshade` `main` `da311c32`. The names in the sketches are
> not decided.

This document proposes a new product for this repository: a game engine written in TypeShade.
The path tracer that this repository first held was the first model. It tested the compiler's feedback loop, and
the owner does not keep it as the product (section 15).

## 1. The claim

The compiler's developer-experience contract (`docs/dx.md`) says three things. The CPU oracle
is `-O0`, the meaning of the TypeScript the developer wrote. The GPU is `-O3`, the same
computation faster. The developer does not learn the GPU. Radiance adds one sentence.

**An agent makes the game, and each thing the engine does is text the agent can read.**

The developer of a Radiance game is a coding agent. An agent writes text, runs a command and
reads the result. So the engine's first product is the feedback loop: a scene is code, a run
needs no device, a state is a text dump, a failure names a line and a remedy.

What that gives, in one line each:

- **A scene is code.** A scene, a prefab and a setting are TypeScript. There is no binary scene
  file, and no step needs a graphical editor.
- **One class, two sides, the same bits.** A node's behaviour is a class in a
  `"use typeshade"` file. The host tests it with `new` on the CPU tier. The engine runs the
  same method across every instance (Rule 8.29, changes 0109 and 0110).
- **A game is a function of a seed and its inputs.** The simulation runs on a fixed tick. A
  save, a replay and a bug report are the same data.
- **The limits are stated.** Game logic runs on the CPU tier. The GPU draws the frame and
  computes what game logic does not read in the same tick.

## 2. What the owner decided

The owner gave these answers in the conversation of 2026-11-11. They are the constraints of
this design.

| Id  | Decision                                                                                             |
| --- | ---------------------------------------------------------------------------------------------------- |
| D1  | The engine is designed from nothing. It keeps the name Radiance and nothing else of the first model. |
| D2  | The engine supports 2D and 3D games.                                                                 |
| D3  | The first games are offline games of the roguelike kind and the automation kind.                     |
| D4  | Development is fully agent-driven. The bar for developer experience is that of a frontier engine.    |
| D5  | The platform is the web.                                                                             |
| D6  | A game ships as a built application through an application store. An update is a new package.        |
| D7  | A game needs no server.                                                                              |
| D8  | Rigid-body dynamics is not in the first scope. The owner named no game that needs it yet.            |

## 3. What the owner accepted

Each row was a working assumption of the first draft. The owner accepted all nine on 2026-11-11.
The owner's words: "U1~U9 모두 추천대로 진행해주세요". The rest of the document is written on these
decisions. U9 fixes the kind of shell. The choice of the tool waits on M1 and M4 (section 12).

| Id  | Question                 | Decision                                                                      | Section |
| --- | ------------------------ | ----------------------------------------------------------------------------- | ------- |
| U1  | The scene model          | The author writes a tree of nodes. The engine stores and runs tables.         | 6       |
| U2  | Where game logic runs    | The CPU tier is the reference. The GPU draws and computes wide effects.       | 7       |
| U3  | The simulation clock     | A fixed tick, and a deterministic result for one seed and one input record.   | 7       |
| U4  | Physics                  | Phase 1 is collision and queries, written in TypeShade. Phase 2 waits on D8.  | 8       |
| U5  | Assets                   | Procedural first: shapes as distance fields, sound as TypeAudio patches.      | 9       |
| U6  | The first vertical slice | A 2D top-down automation game.                                                | 14      |
| U7  | The first store          | Android first. iOS follows, built on a macOS runner.                          | 10      |
| U8  | The repository           | This repository. The first model's tree stays reachable on a `legacy` branch. | 15      |
| U9  | The native shell         | A WebView shell of the Capacitor kind. No shell is chosen.                    | 10      |

## 4. The moments

Each moment names what the agent writes, what the agent runs and what the agent reads. The code
is a sketch.

**1. The first scene.** A scene is a value. A node is a call.

```ts
import { scene, node, run } from 'radiance';
import { Belt } from './belt.shade.ts';

export const factory = scene(
  node('line-1', { position: [0, 0] },
    node(Belt, { speed: 2 }),
    node(Belt, { speed: 2, position: [1, 0] }),
  ),
);

run(factory, { canvas });
```

Never written: a device, a buffer, a pipeline, a frame loop, a render pass. The setup is the
compiler's own: the Vite plugin line, two `tsconfig` lines and `tshc sync` (§64).

**2. The first behaviour.** A behaviour is a class with typed state.

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

The engine calls `step` on every `Belt` once in each tick. Never written: the loop across the
instances, the storage of the instances, the order of the calls.

**3. A test is a run.** A test needs no device and no browser.

```ts
import { simulate } from 'radiance/test';
import { factory } from './factory.ts';

test('a belt wraps after one unit', () => {
  const world = simulate(factory, { ticks: 30, seed: 7 });
  expect(world.find('line-1').children(Belt)[0].offset).toBeCloseTo(0);
});
```

`simulate` runs the same classes on the CPU tier. A thousand ticks of a small scene is a unit
test, not an integration test.

**4. A state is text.** One command prints the world, and one command compares two ticks.

```text
radiance dump factory --tick 30

line-1            position (0, 0)
  Belt #0         speed 2  offset 0
  Belt #1         speed 2  offset 0  position (1, 0)
```

```text
radiance diff factory --from 29 --to 30

Belt #0   offset  0.9667 -> 0
Belt #1   offset  0.9667 -> 0
```

The same data is available as JSON. An agent that cannot see the screen reads the dump.

**5. A replay is a seed and an input record.** A run writes its seed and each input with its
tick. `radiance replay bug-0041.json` gives the same world at each tick. A bug report is that
file. A save is a snapshot of the tables with a schema version.

**6. A picture is a file.** `radiance shot factory --tick 30 --out shot.png` renders one frame
in a headless browser. A test compares the file with a golden image. The agent reads the image
when the layout or the colour is the question.

**7. Explain.** One door, and it speaks the source language (`docs/dx.md`, principle 2).

```text
radiance explain factory

Belt.step        CPU tier, 2 instances, 0.01 ms per tick
Spark.step       GPU, one dispatch, 40,000 instances
                 game logic does not read Spark, so no result returns to the CPU
frame            3 passes, 1.9 ms on this device
tick             0.2 ms of 16.6 ms
```

The rows are a sketch. The compiler-level `explain(f)` is a roadmap goal and is not shipped
(`docs/dx.md`, "The two layers"). The engine builds its report from the `fuse` report (§71)
first.

**8. Build.** `radiance build android` writes a store package. The package holds the code, the
compiled shaders and the assets. The compiler is not in the package: the shaders are compiled
at build time, and `typeshade/runtime` runs them (change 0025).

**A failure.** Each failure has the shape of a compiler diagnostic (Rule 12.5): the first
sentence is the fact, and the second is the remedy.

```text
belt.shade.ts:9  Belt.step reads another Belt through `this.next`.
A method reads other nodes through `neighbors()` or a query. Declare the read there.
```

## 5. The principles, each with the reviewer's question

The compiler's eight principles (`docs/dx.md`) are inherited whole. These are the engine's own.

| Principle                                              | The reviewer asks of a new API                                                  |
| ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Each thing the engine does is text an agent can read   | Can an agent learn the result from a command's output, with no screen?          |
| A scene is code                                        | Does any step need a binary file or a graphical tool?                           |
| A test is a run without a device                       | Does the test suite need a GPU or a browser?                                    |
| Behaviour belongs to a class, not to an instance       | Can one node run code that the other nodes of its class do not run?             |
| A game is a function of a seed and its inputs          | Does any API read the wall clock, an unseeded random number or the frame rate?  |
| Where a class runs is said by `explain`                | Can the agent learn a class's tier, cost and reason without the generated code? |
| Every failure names the author's line and the remedy   | Does any failure name generated text?                                           |
| The same game without WebGPU                           | Does game logic give another result on a device with WebGL2 only?               |
| Engine vocabulary in the library, none in the language | The question of `docs/dx.md` principle 7, unchanged                             |

## 6. The scene model: written as nodes, run as tables

Two questions are separate. What does the author write? How does the engine store and run it?

**The author writes a tree.** A node has a name, a parent, children and properties. A prefab is
a function that returns a node. A lookup by name or by class works as it does in Godot. Agents
have read much code of this shape, so they write it with few errors.

**The engine runs tables.** The engine keeps every node of one class in one table. A method of
the class runs across the table. The tree is a `parent` column.

This is the split Godot makes between a node and its servers. It is what the dump, the
comparison of two ticks, the save and the kernel loop (§65) need.

Three rules hold the split:

1. Behaviour belongs to a class. A node that needs other behaviour has another class.
2. The schedule orders the classes. The tree's order does not order the calls.
3. A method reads other nodes only through the ways the engine declares: the parent, the
   neighbours of a grid cell and a query.

**The cost.** The model has less freedom than "attach a script to a node". An entity with one
instance, such as the player or a boss, has a class of its own.

**The limit of dynamic behaviour.** TypeShade has no pointer and no virtual call (§26). A closed
set of kinds in one table is a `kind` tag and a `switch`. An open set is more classes. Logic
that is not data-parallel, such as a menu or a quest script, is ordinary TypeScript on the host.

## 7. The tick, and who owns a value

**The tick.** The simulation advances in fixed steps. One tick has four phases in this order:
input, game logic, physics, events. Rendering interpolates between two ticks. A game with no
physics has an empty physics phase.

**The reference is the CPU tier.** Game logic reads its results in the same tick. A browser
returns a GPU result asynchronously, so a GPU result arrives in a later frame. A game for a
phone also runs on a device with WebGL2 only (D5, D6). So game logic and physics run on the CPU
tier, and their result is the reference.

**What the GPU does.** The GPU draws the frame. The GPU also runs a class that game logic does
not read: particles, fluids, lighting, crowds of visual instances. `explain` names each such
class. The same class gives the same bits on both tiers, with the rows of §38 excepted.

**One writer.** Each column has one writer in each tick. A body's position belongs to physics.
Game logic writes a velocity, a force or an impulse. A dynamic body below a moving parent keeps
world coordinates.

**Randomness.** A random number comes from `typeshade/random` with a seed and an index (§73).
The same word is the same number on every tier. A map generator and a loot roll use nothing
else.

**Wide data that the CPU reads.** A read of GPU-resident data arrives one frame late. The type
of the read says so. The design of that type is open.

## 8. Physics

Physics is planned, and the scene model above is the one a physics engine needs. Four places
are held for it now: the physics phase of the tick, the one-writer rule, `Body` and `Collider`
as node classes, and contacts as a table that a system reads. A contact is not a callback.

| Phase | Content                                                          | Status                      |
| ----- | ---------------------------------------------------------------- | --------------------------- |
| 1     | A grid broad phase, shape overlap, ray casts, kinematic movement | In the first scope          |
| 2     | Rigid-body dynamics: stacks, joints, friction                    | Not in the first scope (D8) |

Phase 1 is written in TypeShade, so its state is in the tables. A top-down roguelike and an
automation game need phase 1 only, as far as this document can tell. Phase 2 has two paths: write
the solver in TypeShade, or integrate a WebAssembly engine. The second path keeps a second
world outside the tables. The owner decides when a game needs phase 2, with phase 1's
measurements.

## 9. Rendering and assets

**One renderer.** A 2D game is the same renderer with an orthographic camera (D2). The first
renderer is a raster renderer with an open list of passes. A material is a TypeShade function.

**Procedural first.** An agent writes code and does not paint. So the first path to an asset is
code:

- A shape is a signed distance field in a fragment entry, as TypePlot draws its marks.
- A sound is a TypeAudio patch.
- A texture is a function of a coordinate and a seed.

A procedural asset is a few hundred bytes of source, which keeps a store package small (D6).
The engine also imports glTF files and images. That path is supported, and it is not the first
path.

**Text.** A game needs text on the screen. TypePlot renders text with TypeShade shaders. Whether
Radiance shares that code is open.

## 10. Distribution: a store package and no server

A game is a web application inside a native shell (D5, D6, D7).

- The package holds the code, the compiled shaders and the assets. The game uses no network
  while it runs.
- An update is a new package from the store. The engine has no code that downloads an asset.
- The application version, the assets and the save schema are one package, so they cannot
  disagree. A save carries its schema version, and a migration function reads an older save.
- The same build opens in a desktop browser. The agent's loop runs there and in a headless
  browser.

The costs:

- A WebView is not the browser. WebGPU support in Android System WebView and in `WKWebView` is
  measured separately (section 12).
- An iOS package is built on macOS. The owner works on Windows, so that build runs on a macOS
  CI runner.
- The store accounts, the signing keys and the reviews are the owner's. A signing key is never
  written in a conversation.

## 11. What is not promised

- A graphical editor. The first tool for a person is an inspector that shows a running game.
- Game logic on the GPU. A class that game logic reads in the same tick runs on the CPU tier.
- Rigid-body dynamics in the first scope (D8).
- A multiplayer mode, a server and a download of assets (D7).
- A native build with no WebView.
- The same bits across two devices where a class calls `sin`, `cos`, `exp` or another operation
  of §38's list. A save and a replay on one device are exact. Where a game needs the same bits
  on every device, it uses a table or a polynomial, and the engine says which is which.
- The feature count of Unreal, Unity or Godot. The engine is measured by the games of D3.

## 12. What must be measured before it is promised

| Id  | Question                                                                             | Why it matters                                 |
| --- | ------------------------------------------------------------------------------------ | ---------------------------------------------- |
| M1  | Does WebGPU run in Android System WebView and in `WKWebView` on the target phones?   | It decides how much rests on the WebGL2 tier   |
| M2  | How many instances does a tick hold on the CPU tier of a mid-range phone?            | It sizes an automation game                    |
| M3  | Is a WebView's storage kept across updates and under low disk space?                 | A lost save is the worst failure of D3's games |
| M4  | Does `SharedArrayBuffer` work at a WebView's local address?                          | TypeAudio's real-time path uses it             |
| M5  | How long is the first frame after a cold start, with shaders compiled at build time? | A phone game is judged in its first seconds    |
| M6  | How much heat and battery does a steady 60 Hz frame cost?                            | A long session is the normal session for D3    |

A compiler fact that bears on M2: change 0042 (a WebAssembly tier between WebGL2 and the
JavaScript CPU tier) is accepted and is not yet implemented.

## 13. The compiler loop

The engine follows the loop TypeAudio and TypeCV follow.

1. Write the workaround in this repository first.
2. Measure it on devices and keep the records.
3. Raise the general part as an issue on `typeshade/typeshade` that asks for compiler work.
4. Let the compiler side decide how to meet it.
5. Ask for a language change only as the last resort.
6. When the work is implemented, move the pin and retire the workaround.

Nothing engine-shaped is asked of the language (`docs/dx.md`, principle 7). A scene, a node, a
tick and a body are library names.

## 14. The bar and the first slice

Each line becomes a check in CI once the thing it measures exists.

| Bar                                                            | How it is checked                                               |
| -------------------------------------------------------------- | --------------------------------------------------------------- |
| A fresh project reaches a moving scene with one install        | A journey from a packed tarball, as the compiler's journeys run |
| No GPU vocabulary in a game file                               | A scan of the examples for device, buffer and pipeline names    |
| Every test of a game runs with no device                       | The test job has no GPU and no browser                          |
| A replay gives the same dump at every tick                     | A gate that runs each example twice and compares the dumps      |
| A class gives the same bits on every tier, §38's rows excepted | The compiler's differential gate, across the engine's classes   |
| Every failure names the author's line                          | A diagnostic-span check                                         |
| Every documentation snippet runs in CI                         | The compiler's `doc-snippets.test.ts` pattern                   |
| An edit reaches the running game in one second                 | Measured in `vite dev`                                          |

**The first slice (U6).** One small 2D top-down automation game, made by an agent from an empty
directory to an Android package. It exercises tables with many instances, the tick, the dump,
the replay, procedural assets and the build. The slice is done when the game is on a phone and
every bar above that it can reach is in CI.

## 15. The first model and this repository

The path tracer that this repository first held, its design records 0001 to 0011 and its plan
are the first model. The owner's words of 2026-11-11: "Radiance는 초기모델입니다", "굳이 유지할 이유는
없어요", "아예 처음부터 제대로 설계해보고 싶어서요".

- The compiler work that the first model asked for stays in the compiler (changes 0044 to
  0050). The new engine uses it.
- Compiler proposals cite commits of this repository by address. So the engine keeps
  this repository and its history (U8).
- The first model is on the branch `legacy`, at commit `3e4efb3f`. The owner approved the move
  on 2026-11-11, and `main` no longer holds the first model's tree.
- The compiler's documents name Radiance as the reference engine and as a downstream
  repository. They follow in their own pull request in `typeshade/typeshade`.

## 16. Status and baselines

- Draft written 2026-11-11 in a Claude Code session with the owner, in Korean.
- Baselines read: `typeshade/radiance` `main` `3e4efb3f`. `typeshade/typeshade` `main`
  `da311c32`. TypeAudio's `docs/vision.md` is the model for this document's shape.
- Decisions D1 to D8 are the owner's. The owner accepted U1 to U9 on 2026-11-11.
- Nothing in this document is implemented. No measurement of section 12 has run.
