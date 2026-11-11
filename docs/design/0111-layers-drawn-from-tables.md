---
id: '0111'
title: A game draws in layers, each layer draws the rows of a table as instances, and a view keeps the shape of the world
status: accepted
vision: [D2, D11, D12, D13, D14, D16]
touches:
  - src/draw.ts
  - src/show.shade.ts
  - src/engine.ts
  - src/page.ts
  - src/project.ts
  - src/facts.ts
  - src/config.ts
  - test/
  - examples/factory/
  - README.md
compiler:
  - typeshade/typeshade#1249
  - typeshade/typeshade#1263
  - typeshade/typeshade#637
---

# 0111. Layers drawn from tables

**Document control**

| Field          | Record                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------ |
| Identity       | Design record `0111`, `status: accepted`. The front matter holds the identity and the lifecycle. |
| Date           | Written 2026-11-11 by the repository's coding agent, under decision D9 of `docs/vision.md`.      |
| Baseline       | `typeshade/radiance` `main` `711de9f`.                                                           |
| Compiler pin   | `6d6a979`.                                                                                       |
| Pull request   | The pull request that adds this file.                                                            |
| What is a fact | Section 1, the probes. No step is implemented.                                                   |

## What changes

Today a game draws with one host function, `draw/draw.ts`. It calls one fragment entry that
fills the canvas and finds its cell for each pixel. The picture takes the shape of the canvas:
on an upright phone a cell of the first reference game is taller than it is wide (record 0110,
an open deviation).

After this record, a game draws in layers. A layer is one file of `draw/`. It draws one
instance for each row of one table, where the table is on the device. The engine gives each
layer a view, and the view keeps the shape of the world on every screen. The game writes no
host code for drawing.

### 1. What was probed

Two sub-agents ran probes on 2026-11-11 at compiler pin `6d6a979`, in headless Chromium with
WebGPU on SwiftShader. The files are not in the repository. The results:

| Question                                                                                   | WebGPU                           | WebGL2                               |
| ------------------------------------------------------------------------------------------ | -------------------------------- | ------------------------------------ |
| A draw reads the table that a kernel function wrote, with no read of the table to the host | Yes                              | Only for a table of `f32` and `vec2` |
| The element is a class, or a class with a class in a field                                 | Yes                              | No: `TS8015` (compiler issue #1249)  |
| The picture reaches the canvas with no call on a GPU object                                | Yes, through a full-screen entry | No                                   |
| Alpha blending, a depth test, several passes with `load`                                   | Yes                              | Yes, into a texture                  |

Three conditions hold on WebGPU. Each one fails with no error when it is not met.

1. The program runtime exists first, and the device is made from it: `createRuntime`, then
   `createDevice({ runtime })`.
2. The target of the layers is a texture of the device: `device.texture()`.
3. The first call of a kernel function is followed by `device.wait()` before the first draw.

The times are of SwiftShader, and they are no numbers of a device. One frame of a tick, a draw
and the full-screen entry took 25.7 ms for 1,000 instances and 184.3 ms for 10,000. The
full-screen entry alone took 4.6 ms.

### 2. A layer

A layer is a file `draw/<name>.shade.ts`. It exports one `@vertex` entry and one `@fragment`
entry. The names of the two entries are the author's.

```ts
// draw/cells.shade.ts
"use typeshade";
import { Cell } from "../state/cells.shade.ts";

declare const cells: storage<array<Cell>>;
declare const view: uniform<mat4x4>;
declare const width: uniform<u32>;

interface Corner {
  at: builtin<"position">;
  local: location<0, vec2>;
  row: location<1, u32>;
}
interface Color {
  color: location<0, vec4>;
}

@vertex
export function place(corner: builtin<"vertex_index">, row: builtin<"instance_index">): Corner {
  // The two triangles of a square: the corners 0, 1, 2 and 2, 1, 3.
  let k: u32 = corner;
  if (corner == 3) { k = 2; }
  if (corner == 4) { k = 1; }
  if (corner == 5) { k = 3; }
  const unit: vec2 = vec2(f32(k % 2), f32(k / 2));
  const cell: vec2 = vec2(f32(row % width), f32(row / width));
  return { at: view * vec4(cell + unit, 0., 1.), local: unit * 2. - 1., row };
}

@fragment
export function paint(corner: Corner): Color {
  return { color: vec4(cells[corner.row].color(corner.local), 1.) };
}
```

The engine binds each `declare const` of a layer by its name, as it binds the parameters of a
system (design record 0108, section 4).

| Name                             | What the engine gives                                                       |
| -------------------------------- | --------------------------------------------------------------------------- |
| The name of a table or a scratch | The table where it is on the device, after the ticks of the frame           |
| `view`                           | The matrix of section 3, from a place in the world to a place on the screen |
| `tick`, `seed`, `dt`             | The engine's values, as a system gets them                                  |
| A name of the config's `values`  | That value                                                                  |

- A layer names exactly one table as a `storage` binding. The layer draws six vertices for each
  row of that table: two triangles.
- A layer of a pool draws every slot. Its `@vertex` entry puts a free slot outside the view.
- Any other name is refused at `radiance sync`, with the names the engine knows.
- A layer changes no table. A layer is not a part of a tick, and a replay does not run it.

### 3. The config: the order and the view

```ts
export default defineGame({
  tick: ['tick'],
  values: { width: 10, height: 6 },
  draw: ['cells'],
  view: { fit: [10, 6], clear: [0.07, 0.07, 0.09] },
});
```

- `draw` is the order of the layers, from the back to the front. Each name is a file of `draw/`.
- `view.fit` is a rectangle of the world, `[width, height]`, with its first corner at the
  origin. The x axis goes right, and the y axis goes down.
- The engine makes `view` so that the whole rectangle is on the screen, in the middle, as large
  as it can be. One unit of the world has the same length on the two axes.
- `view.clear` is the colour of the part of the screen that the rectangle does not cover.
- A game with a `draw` in its config has no `draw/draw.ts`. A game with a `draw/draw.ts` and no
  `draw` in its config draws as it does today. A project with both is refused.

### 4. What the engine does each frame

1. It runs the ticks that are due.
2. It waits for the device once, after the first tick of the run.
3. It draws each layer of `draw`, in order, into one texture of the device. The texture has the
   size of the canvas. The first layer starts from `view.clear`.
4. It shows the texture on the canvas with a full-screen entry of its own, `src/show.shade.ts`.

The engine makes the texture again when the canvas changes its size. The engine calls nothing
on a GPU object (design record 0108, section 10): the layers go through `typeshade/runtime`, and
the canvas through the compiler's call of a `@fragment` entry.

### 5. The tiers

| Tier    | What a game with layers does                                                                         |
| ------- | ---------------------------------------------------------------------------------------------------- |
| WebGPU  | It draws its layers.                                                                                 |
| WebGL2  | It does not start. The error names the layer and compiler issues #1249 and #1263.                    |
| The CPU | `load` of `radiance/test` runs the ticks and draws nothing, as today. The harness holds the picture. |

`run` opens WebGPU for a game with layers, and it does not try WebGL2 for it. A game with a
`draw/draw.ts` keeps both tiers.

### 6. What comes after the first step

- **Events.** A pool of events is a table. A layer that draws it is an effect. The layer's
  targets blend with alpha. A layer says so in the config: `draw: ['cells', { layer: 'sparks', blend: 'alpha' }]`.
- **Between two ticks.** The engine gives `blend`, the part of a tick that has passed, and the
  table of the tick before under the name `<table>Before`. A layer mixes the two places.
- **Three dimensions.** `view` becomes a perspective, a layer has a depth test, and a layer
  draws a mesh in place of the square. This part gets its own record.

## Why

- **A row is an instance.** The table is already on the device (D11). A draw that reads it there
  moves no data, and the count of instances is the size of the table.
- **One model for 2D and 3D (D2).** A layer, a table and a `view` are the same in both. Only the
  matrix and the depth change.
- **The view is the engine's.** Each screen has its own shape (D16). A game that fits the world
  to the screen by hand gets it wrong on the next phone.
- **No host code for drawing (D14).** A file's place says what it is. The engine owns the passes
  and the texture (D13).
- **A layer is outside the tick.** The result of a game does not depend on its picture, so a
  replay and a test need no GPU for it.

## The cost

- **WebGL2.** A game with layers does not run on the WebGL2 tier at this pin. D12 gives such a
  phone WebGL2, so this is a cost against D12 until the compiler has the work of issues #1249
  and #1263. The owner's phone opened WebGPU (`docs/vision.md`, section 12).
- **One more pass.** The full-screen entry costs a texture of the canvas's size and a pass on
  each frame. It goes away with the work of compiler issue #1263.
- **The square is written by hand.** Each layer writes the six corners. A mesh of the engine
  removes that with the record of three dimensions.
- **A free slot is still a vertex.** A pool draws all of its slots.
- **No image.** A layer has no texture of an image until the compiler has the work of proposal
  0050 (issue #637). A layer draws shapes from code.

## What is not in this record

- Text on the screen, and a user interface.
- Sound.
- A camera that moves, zooms or follows. `view.fit` is fixed for a run in the first step.
- A picture on the CPU tier.

## What it touches

| Path                | Change                                                                              |
| ------------------- | ----------------------------------------------------------------------------------- |
| `src/draw.ts`       | New: the view's matrix, the pipelines of the layers, the frame                      |
| `src/show.shade.ts` | New: the full-screen entry that shows the texture                                   |
| `src/page.ts`       | `run` makes the program runtime first, and the device from it                       |
| `src/engine.ts`     | The engine holds its layers, and it waits once after the first tick                 |
| `src/facts.ts`      | Reads a layer: its two entries and its `declare const` names                        |
| `src/project.ts`    | Reads `draw/`, checks the names, writes the layers into `.radiance/game.ts`         |
| `src/config.ts`     | `draw` and `view`                                                                   |
| `examples/factory/` | One layer, `draw/cells.shade.ts`. No `draw/draw.ts` and no `draw/picture.shade.ts`. |
| `README.md`         | A layer, the config's two entries                                                   |

Tests owed:

| Test                                                                                     | Verifies      |
| ---------------------------------------------------------------------------------------- | ------------- |
| The view's matrix puts the rectangle in the middle of a wide and of an upright screen    | Design 0111.3 |
| One unit of the world has the same length on the two axes of the screen                  | Design 0111.3 |
| A layer with an unknown name, two tables, or no `@vertex` entry is refused with a remedy | Design 0111.2 |
| A project with a `draw` in its config and a `draw/draw.ts` is refused                    | Design 0111.3 |
| The harness: the cells of the factory are squares on a wide and on an upright screen     | Design 0111.3 |
| The harness: the picture shows the table after a tick, with no read of the table         | Design 0111.4 |
| The harness: the cells of the GPU device still equal the cells of the CPU device         | Design 0111.2 |
| The harness: a browser with no WebGPU gets the error of section 5                        | Design 0111.5 |
| The runtime still imports no module of the project layer                                 | Design 0111.4 |

## Implementation, in steps

Each step is one pull request. Each commit carries `Design: 0111`.

1. **Layers and the view.** Sections 2 to 5 with their tests. The first reference game moves to
   one layer. The owner looks at it on a phone, and the device record goes into
   `docs/vision.md`.
2. **Events and the time between two ticks.** Section 6, the first two items.
3. **Three dimensions.** Its own record first.

## Compiler work this record waits on

| Need                                                                     | Where                      |
| ------------------------------------------------------------------------ | -------------------------- |
| A storage array of a class with a class in a field, on WebGL2            | Issue #1249                |
| A canvas as the target of a pass, on both tiers                          | Issue #1263                |
| An image in a texture                                                    | Proposal 0050, issue #637  |
| An error in place of an empty picture, in the three cases of section 1   | To be filed after a search |
| A table of a class with `f32` and `u32` fields, read by a draw on WebGL2 | To be filed after a search |
| The first call of a kernel function in order before a later draw         | To be filed after a search |

## Decisions for the owner

The agent made these decisions under D9. The owner saw the sketch on 2026-11-11 and can change
each one.

1. A layer is a file of `draw/`, and the config gives the order.
2. The engine gives the view. A game does not fit the world to the screen.
3. A game with layers runs on WebGPU only, until the compiler has the work above.
4. The y axis of the world goes down, as the rows of a grid do.

## Record

- **Approval.** The agent showed the owner the probes and the sketch on 2026-11-11. The owner
  answered: "네". The owner's rule of 2026-11-11 approves a merge with green checks in advance
  (`CLAUDE.md`, Merging).
- **Validation.** Does not yet apply: no step is implemented.
- **Deviations.** None.
