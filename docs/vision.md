# Radiance: the design of the game engine

> **Status:** design, written 2026-11-11. Nothing in this document is implemented. The owner
> decided D1 to D16 and accepted U1 to U9 on 2026-11-11. Every claim about the compiler names
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
- **The engine is the framework a game is written on.** It owns the device, the memory and the
  runtime, and a game touches none of them. A build gives a small result: it removes each part
  of the framework that the game does not use (D13, which changed D10).
- **The limits are stated.** A shipped game runs on WebGPU, or on WebGL2 where there is no
  WebGPU. The CPU tier runs the tests, and its result is the reference (D12).

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
| D9  | The agent that builds the engine decides what the engine is for and how the engine is built.         |
| D10 | Changed by D13. It said: a shipped game uses nothing at run time past TypeShade's `Device`.          |
| D11 | A game's tick is a function of a `"use typeshade"` file. The compiler joins it at build time.        |
| D12 | A shipped game runs on WebGPU first, and on WebGL2 where there is no WebGPU.                         |
| D13 | Radiance is the framework a game is implemented on. It owns memory, the runtime and the device.      |
| D14 | The engine is a class that a game extends. The framework manages the project and its files.          |
| D15 | The store is the main distribution, and the web is secondary. A later game also ships on Steam.      |
| D16 | The first game is for a phone. The page in a browser is how the owner tries a build on a phone.      |

**D9, in the owner's words (2026-11-11):** "This codebase is yours: what it's for and how it's
built are your call, and you'll keep building on it."

What D9 means for the work:

- The agent decides a design question and does not send it back to the owner as a choice.
- D1 to D8 and U1 to U9 are the design the agent starts from. A change to one is recorded here
  with its reason and its date, and the agent tells the owner.
- The owner's word in the conversation still wins. The owner can take any decision back.
- D9 does not change the session rules. `CLAUDE.md` (Merging) says which pull request waits for
  the owner, and only the owner changes that.

**D10, in the owner's words (2026-11-11):** "엔진은 개발 도구일 뿐 빌드시 엔진의 엄청난 분량의
코드가 포함되지 않잖아요. 그것부터 정해야하지 않나 싶어서요", and "런타임은, typeshade의 device
수준이어도 괜찮지 않나 싶어서요".

D13 changed D10 on 2026-11-11. The framework's runtime is in a shipped game, and the build
makes it small. The list below is what D10 meant before D13. Its last item still holds.

What D10 meant for the work:

- What runs on the player's device is the compiler's runtime: a `Device`, its resources and
  the compiled programs. The engine adds no runtime of its own to a shipped game.
- The engine is what a developer runs: the check of a scene, the tests, the dump, the replay,
  `explain` and the build.
- A thin loop stays in a shipped game: the tick clock, the inputs and the save. The build
  writes it for each game.
- The size of a shipped game is a number in CI. A build that holds an engine tool fails.

**D11, in the owner's words (2026-11-11):** "fuse도 빌드시에 합칠 수 있지 않나요. constexpr
느낌인데", and "fuse 내부 함수를 shade.ts 로 작성하면 되는거 아닌가 싶은데".

What D11 means for the work:

- The author writes the tick as an exported function of a `"use typeshade"` file. Its loops
  call the methods of the classes, in the order the author writes them.
- The compiler joins the tick when it compiles the file. Nothing plans at run time.
- What the build can know, the build computes: the tables of a scene, the index of a node's
  parent, the seed of a node, the shaders.
- A compiler fact, observed at pin `6d6a979`: a tick with two loops over two tables compiles and
  runs. A tick that calls another function with a loop is refused (`TS8099`, Rule 8.6).
  Compiler proposal 0138 (R12) describes that second form.

**D12, in the owner's words (2026-11-11):** "기기 티어는 WebGPU, WebGL2 둘 중 하나이고, 가능하면
WebGPU 우선, WebGL2로 폴백하는걸로 하도록 하나, 실제 앱스토어에서 설치되는 경우는 대부분 WebGPU를
지원하므로, 걱정은 없어보임."

What D12 means for the work:

- A shipped game opens a WebGPU device, and a WebGL2 device where that fails. It does not run
  its tick on the CPU tier.
- The CPU tier is the tier of the tests and of the engine's tools. Its result is the reference
  that a GPU tier is held to.
- D12 changes U2. U2 said that game logic runs on the CPU tier. The row below keeps U2's text
  and names the change.
- The owner's statement on the stores is a planning assumption. No device was measured (M1).

**D13, in the owner's words (2026-11-11):** "Radiance는 지금 구현을 위한 하나의 큰
프레임워크입니다. 빌드하면 작은게 나오는거고요. 메모리 관리부터 기타 런타임 및 디바이스 관리, 등을
모두 전담할겁니다. 그 위에서 구현되는게 게임이고요. 근데 지금 보니까 하나의 특정 장르를 위한 엔진이
되어버리는 느낌입니다."

The agent then showed two readings. In reading A the framework works at build time only, and
the build writes the code a game needs (D10 as it was). In reading B the framework's runtime
is in a shipped game, and the build removes what the game does not use. The owner answered
"B".

What D13 means for the work:

- A game does not open a device, make an array on a device or free one. The framework does.
- The framework has layers, and each layer is for every kind of game: the device, the memory,
  the runtime (the loop, the inputs, a pause), the drawing, the assets, the tools and the build.
- The framework's runtime is in a shipped game. The build removes each part that the game
  does not use. The size of a shipped game stays a number in CI.
- A feature comes from a layer of the framework. A reference game tests a layer. It is not
  the source of a feature.
- D3 names the first games. It does not name the shape of the framework.
- The work up to design record 0107 took its features from two reference games. A later
  record places each one in a layer, or removes it.

**D14, in the owner's words (2026-11-11):** "그냥 엔진이 클래스면요? 잘 알려진 게임엔진이 런타임겸
같이 실행되도록하는 방식, 다만 구현 자체는 데코레이터 등 구현 자체는 편하게 가능하도록 하고싶어요".
Then: "저 shade.ts 파일 관리까지 가능할 것 같은데 언리얼이나, 유니티 보면 관리가 체계적이잖아요". Then:
"vite 같은 성격으로 만들면 좋을 것 같네요. 좀 더 예를 들자면, nextjs, nestjs 느낌이려나요".

What D14 means for the work:

- **The engine is a class.** A game is a class that extends it. The class says the game's
  state, its systems, its inputs and its drawing. The engine is also the runtime: it runs with
  the game, in a test and in a shipped game (D13).
- **Writing a game is easy.** A declaration is a field, a decorator or a list. The game writes
  no code that opens a device, makes a buffer, passes a table to a function or runs a loop.
- **The framework manages the project.** A project has a fixed shape. It says where an entity,
  a system, a drawing, a level and a test are. The framework finds each `.shade.ts` file by its
  place. It writes the files that a tool can write, calls the compiler and builds the package.
  A file that the framework writes is in one directory, and a person does not change it.
- **One tool.** The framework has the character of Vite: one configuration file, one command
  for development with a fast loop, one command for the build. It has the conventions of
  Next.js, where a file's place says what it is. It has the classes and decorators of NestJS.
- **The layers.** Each one is for every kind of game (D13):

  | Layer            | What the framework owns                                                   |
  | ---------------- | ------------------------------------------------------------------------- |
  | Device           | Opening, WebGPU first and WebGL2 after (D12), loss and recovery           |
  | Memory           | Each table, scratch buffer and texture: its size, its release, its budget |
  | Runtime          | The start, the fixed tick, the frames, a pause, the inputs as data        |
  | Drawing          | The passes, the cameras, 2D and 3D (D2)                                   |
  | Assets and saves | Assets from code and from files (U5, D15), sound, a save and a load       |
  | Tools            | The dump, the replay, the tests, `explain`                                |
  | Project          | The shape of a project, the files it writes, the compiler, the build      |

- **The compiler's work stays the compiler's.** The framework places, writes and compiles
  `.shade.ts` files. It does not change the language. GPU code is still a function or a class
  of a `"use typeshade"` file (D11).
- D14 changes U1. The tree of nodes is no longer what the author writes first. Section 6 keeps
  its text and names the change.

**D15, in the owner's words (2026-11-11):** "3D 에셋이 큰건 알지만, 어차피 앱스토어나 플레이스토어에
게임 배포때 같이 배포되니까 괜찮지 않을까". Then: "네, 스토어가 주된 배포이고 웹은 부차입니다, 나중에는
스팀과 같은곳에도 넣을 예정이예요. 다른 게임 만들어서".

What D15 means for the work:

- **The store package is the main product.** A game ships in the App Store and in Google Play
  (D6). The page in a browser is secondary: a tool of development, or a small trial.
- **A large asset is in the package.** The bytes of the package are no reason to refuse a model
  or an image. The asset layer takes files as an ordinary path, and it builds them into the
  package. Assets from code stay a path too.
- **D15 changes U5.** U5 said: procedural assets first. Now neither path is first.
- **Memory and loading stay costs.** The bytes of a download and the memory of the GPU are
  different numbers. The framework owns both budgets (D13), and M1 to M7 still apply.
- **A desktop store comes later.** A later game ships on a store such as Steam. No work for it
  is in scope now. A design record must not make it impossible: the build names its target.
- D5 and D6 keep their text. D15 says which one leads.

**D16, in the owner's words (2026-11-11):** "근데 처음은 모바일용으로 시작하고싶어요. 웹은 아무래도 제가
밖에 나가서 핸드폰으로 직접 열어서 바로 해볼 수 있으니까 좋은 것 같고요".

What D16 means for the work:

- **The phone is the first target.** The first game is made for a phone: touch input, a small
  screen in either orientation, and the memory and heat of a phone.
- **The page has a job.** The owner opens the page of a build in a phone's browser and plays it
  at once. So a build of `main` must be reachable at an address, with no store and no cable.
- **The page is the first measurement.** What the owner sees on a phone is a result on a
  device. The page shows its device tier and its frame time, so that a report has numbers.
- **A phone with no WebGPU matters now.** D12 gives such a phone WebGL2. The compiler refuses
  that path for a table of classes today (`typeshade/typeshade` issue #1249).
- D16 does not change D15. The store package is still the main product.

The names in this sketch are not decided. A design record decides them.

```ts
export class Dungeon extends Engine {
  actors = pool(Actor, 16);
  tiles = grid(Tile);
  systems = [plan, turn, pickup];
}
```

## 3. What the owner accepted

Each row was a working assumption of the first draft. The owner accepted all nine on 2026-11-11.
The owner's words: "U1~U9 모두 추천대로 진행해주세요". The rest of the document is written on these
decisions. U9 fixes the kind of shell. The choice of the tool waits on M1 and M4 (section 12).

| Id  | Question                 | Decision                                                                          | Section |
| --- | ------------------------ | --------------------------------------------------------------------------------- | ------- |
| U1  | The scene model          | Changed by D14: a game is a class that extends the engine, and it runs as tables. | 6       |
| U2  | Where game logic runs    | Changed by D12: on the GPU tier. The CPU tier is the reference of the tests.      | 7       |
| U3  | The simulation clock     | A fixed tick, and a deterministic result for one seed and one input record.       | 7       |
| U4  | Physics                  | Phase 1 is collision and queries, written in TypeShade. Phase 2 waits on D8.      | 8       |
| U5  | Assets                   | Changed by D15: assets from code and assets from files, and neither is first.     | 9       |
| U6  | The first vertical slice | A 2D top-down automation game.                                                    | 14      |
| U7  | The first store          | Android first. iOS follows, built on a macOS runner.                              | 10      |
| U8  | The repository           | This repository. The first model's tree stays reachable on a `legacy` branch.     | 15      |
| U9  | The native shell         | A WebView shell of the Capacitor kind. No shell is chosen.                        | 10      |

## 4. The moments

Each moment names what the agent writes, what the agent runs and what the agent reads. Moments
1 to 5 run today, as design records 0100 and 0101 implement them, and their code is the
engine's. The code of moments 6 to 8 is a sketch.

**1. The first scene.** A scene is a value. A node is a call.

```ts
import { node, scene } from 'radiance';
import { Belt } from './belt.shade.ts';

export const factory = scene(
  node('line-1', node(Belt, { speed: 2 }), node('spare', Belt, { speed: 0 })),
);
```

Never written: a device, a buffer, a pipeline, a frame loop, a render pass. The setup is the
compiler's own: the Vite plugin line, two `tsconfig` lines and `tshc sync` (§64). A scene draws
nothing yet. A later record adds the frame.

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
import { Belt } from './belt.shade.ts';
import { factory } from './factory.ts';

test('a belt wraps after one unit', () => {
  const world = simulate(factory, { ticks: 32, seed: 7, hz: 64 });
  expect(world.find<Belt>('line-1/Belt#0')?.offset).toBe(0);
});
```

`simulate` runs the same classes on the CPU tier. A thousand ticks of a small scene is a unit
test, not an integration test. The test asks for 64 ticks in a second because `f32` holds
`1 / 64` exactly. At 60, thirty steps of `2 * dt` do not sum to exactly 1.

**4. A state is text.** `world.dump()` returns the world as text.

```text
tick 30  seed 7  hz 60
line-1
  Belt#0  speed 2  offset 3.5762787e-7
  spare  Belt  speed 0  offset 0
```

`world.snapshot()` returns the same data as an object that JSON holds. An agent that cannot see
the screen reads the dump. A command that prints the dump and a command that compares two ticks
are a later record.

**5. A replay is a seed and an input record.** An input is a write of field values to one
node. The world applies it at the start of the next tick and records it with that tick.

```ts
import { createWorld } from 'radiance';
import { replay } from 'radiance/test';

const world = createWorld(factory, { seed: 7 });
world.input('line-1/Belt#0', { speed: 4 });
world.step(2);

const record = world.record(); // the seed, the tick rate, the tick count and the inputs
replay(factory, record).dump() === world.dump(); // true
```

A record is data that JSON holds, so a bug report is that file. A class that needs random
numbers declares a field named `seed`. The world fills it from the world's seed and the node's
path, so the same record gives the same random numbers. A save is a snapshot of the tables
with a schema version. A command that replays a file is a later record.

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

> **Changed by D14 (2026-11-11).** A game is a class that extends the engine. Its state is
> tables, and its rules are systems. The tree of nodes below stays as a way to write the parts
> of a game that have a hierarchy. The text below is the design as U1 made it.

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

**The tick is one function (D11).** The author writes the tick in a `"use typeshade"` file.
Its loops run the tables in the order the author writes them, and a loop reads another table
by an index. The compiler joins the loops at build time.

**Where the tick runs (D12).** A shipped game runs the tick on WebGPU, or on WebGL2 where there
is no WebGPU. A test runs the same tick on the CPU tier, with no device. The CPU tier's result
is the reference. The same tick gives the same bits on each tier, with the rows of §38
excepted.

**What the host reads.** A browser returns a GPU result asynchronously. So the host does not
read a table in the tick that wrote it. Game logic that decides on a table's values is part
of the tick function. The host writes inputs, and it reads a table for the screen and for a
save, one frame or more after the write.

**One writer.** Each column has one writer in each tick. A body's position belongs to physics.
Game logic writes a velocity, a force or an impulse. A dynamic body below a moving parent keeps
world coordinates.

**Randomness.** A random number comes from `typeshade/random` with a seed and an index (§73).
The same word is the same number on every tier. A map generator and a loot roll use nothing
else.

**A read by the host arrives late.** The type of the read says so. The design of that type is
open.

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
The engine also imports glTF files and images.

> **Changed by D15 (2026-11-11).** The file path was not the first path. Now neither path is
> first. A large asset is in the store package, and the framework holds its memory to a budget.

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
- A read of a table by host code in the tick that wrote it (D12).
- A shipped game that runs with neither WebGPU nor WebGL2.
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
| M1  | Does WebGPU run in Android System WebView and in `WKWebView` on the target phones?   | D12 assumes that it does on most installs      |
| M2  | How many instances does a tick hold on each GPU tier of a mid-range phone?           | It sizes an automation game                    |
| M3  | Is a WebView's storage kept across updates and under low disk space?                 | A lost save is the worst failure of D3's games |
| M4  | Does `SharedArrayBuffer` work at a WebView's local address?                          | TypeAudio's real-time path uses it             |
| M5  | How long is the first frame after a cold start, with shaders compiled at build time? | A phone game is judged in its first seconds    |
| M6  | How much heat and battery does a steady 60 Hz frame cost?                            | A long session is the normal session for D3    |
| M7  | How many bytes is a shipped game, and how long does it take to start?                | D13 keeps the size a number in CI              |

Two builds were measured on 2026-11-11 at compiler pin `6d6a979`, with Vite 7.3.7. Each is a
scene of two nodes. A build on the engine's world of design record 0100 is 145.5 kB, and 89% of
it is the compiler's CPU runtime. A build that runs one kernel function through a `Device` is
661.3 kB in three files, and the largest file is the planner of `fuse`. Neither build is the
build of D11 and D13, which holds no CPU runtime and no planner. That build is not measured.

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
- Decisions D1 to D16 are the owner's. D13 changed D10, D14 changed U1 and D15 changed U5 on
  2026-11-11. The owner accepted U1 to U9 on 2026-11-11. D12 changed
  U2 on the same day.
- Design records 0100 and 0101 are implemented. Their world runs on the CPU tier. Since D12 it
  is the reference and the tool of the tests, and it is not what a shipped game runs.
- Nothing in this document is implemented. No measurement of section 12 has run.
