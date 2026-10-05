---
id: '0001'
title: A scene of triangle meshes, instanced through a two-level BVH, reaches the kernel through seven storage buffers whose layouts are fixed from M2 through M3
status: draft
milestones: [M2, M2a, M3]
touches:
  - packages/radiance/src/core
  - packages/radiance/src/geometries
  - packages/radiance/src/accel
  - packages/radiance/src/renderers
  - packages/radiance/src/kernels
  - packages/addons/src/loaders
  - scripts/oracle.ts
  - scripts/gates.mjs
compiler: ['0006-1', '0006-2', '0006-3']
---

**Document control**

| Field         | Value                                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Identity      | Design record 0001, status `draft`                                                                                             |
| Date          | 2026-10-05 (UTC), the date of authorship                                                                                       |
| Author        | Written in a Claude Code session for the owner (Seungup Noh); the owner's review is the approval, not this attribution         |
| Applicability | `@typeshade/radiance` and `@typeshade/radiance-addons` at 0.0.0; the kernels under `packages/radiance/src/kernels`; `scripts/` |
| Baseline      | `main` at 0f17f5e; the compiler pinned at `vendor/typeshade` e923a34                                                           |
| Pull request  | None assigned at the time of writing; the pull request that carries this record is its review                                  |

## What changes

### Before

M1's scene is analytic. `packScene` (`src/renderers/pack.ts`) walks the scene graph each frame,
writes every sphere and every quad in world space into four small typed arrays, compares them
with the last frame's, and uploads all four when any number differs. The kernel
(`src/kernels/trace.shade.ts`) tests a ray against every sphere and every quad in turn. There is
no acceleration structure, no triangle, no instancing, no change tracking finer than "the whole
scene is the same or not".

### After

The scene reaches the kernel as **seven storage buffers and two uniform blocks**, laid out as
this record states. The layout holds from M2 through M3: M3 adds fields in the room this record
reserves and adds no buffer to the path tracer's pipeline. The host builds a bounding volume
hierarchy for each geometry (a BLAS) and one over the instances each frame (the TLAS); the kernel
traverses both with a stack. Change tracking is per object: a geometry, a material or a
transform that changed re-packs its own part.

The three rules the layout is written under:

1. **Seven storage buffers in the path tracer's pipeline, never eight.** WebGPU's default
   `maxStorageBuffersPerShaderStage` is 8, and the runtime requests no higher limit (record
   0006, item 1). The eighth slot stays free for the compiler's console buffer, which a stage
   that binds eight cannot take (`vendor/typeshade/src/core/passes/console-buffer.ts`,
   `DEFAULT_STORAGE_BUFFERS_PER_STAGE`).
2. **Every buffer is an array of `vec4` or `vec4u`, bound from one typed array.** The runtime
   binds a runtime-sized array of scalars or vectors from a typed array, and an array of
   structs from an array of objects packed one field at a time (Rule 8.21; `runtimeCount` in
   `vendor/typeshade/src/core/host-entry.ts`). A million nodes as objects is a million
   `structuredClone`d objects and a `DataView` write per field, so the hot buffers are vectors.
   A word that is an integer is stored as its bits and read with `bitcast<u32>` (surface §44).
3. **Each buffer stays under 128 MiB.** WebGPU's default `maxStorageBufferBindingSize` is
   134,217,728 bytes and `maxBufferSize` 268,435,456. The host checks each buffer against the
   first before an upload and throws a `RangeError` that names the buffer, its size and the
   limit (section "Limits").

### The host model

The classes follow three.js's shape (plan §12, decision 4). The names below are the ones record
0003 fixes for 0.1.0.

**Geometry** becomes a container of vertex attributes and an index, as three.js's
`BufferGeometry` is:

```ts
class BufferGeometry extends Geometry {
  readonly type = 'BufferGeometry';
  /** xyz per vertex. Required. */
  position: Float32Array;
  /** xyz per vertex, unit length. Computed by computeVertexNormals() when absent. */
  normal: Float32Array | undefined;
  /** uv per vertex, glTF's convention: v = 0 at the top of the image. Absent: every uv is 0. */
  uv: Float32Array | undefined;
  /** Three vertex indices per triangle, counter-clockwise seen from the front. Required. */
  index: Uint32Array;
  /** Incremented by the setter of every attribute, and by the author after an in-place edit. */
  version: number;
  computeVertexNormals(): this;
  computeBoundingBox(): Box3;
}
```

- `SphereGeometry(radius = 1, widthSegments = 32, heightSegments = 16)` and
  `PlaneGeometry(width = 1, height = 1)` (M1's `QuadGeometry`, renamed; record 0003) and
  `BoxGeometry(width, height, depth)` build a `BufferGeometry`. Their tessellation is
  three.js's: the same vertex order and the same uv layout, so a scene ported from three.js
  looks the same. `PlaneGeometry` faces +z and `SphereGeometry`'s normals point outward.
- **Triangles only.** M1's analytic sphere and quad leave the kernel. One intersection routine,
  one hierarchy, and the glTF path is triangles anyway. The Cornell box gate's spheres become
  tessellated spheres, and the gate's thresholds are re-derived in the same pull request
  (record 0002, step 2).
- A `Geometry` is shared by any number of meshes. Its BLAS is built once per `version` and
  reused by every mesh that holds it: a mesh is an instance.

**Material** gains `version` and the record of record 0004: `type` (0 diffuse, 1 mirror, 2
physical), the colours and the scalar parameters. This record only fixes that a material packs
into `MATERIAL_STRIDE` vec4s.

**Mesh** stays `Mesh(geometry, material)`. A glTF mesh with several primitives loads as a group
of one `Mesh` per primitive, so a mesh has one material and a BLAS has one material per
instance. The instance record carries the material, so two meshes that share one geometry with
two materials are two instances of one BLAS: that is plan §3.1 item 6's material override.

**Object3D** gains nothing visible. `updateMatrixWorld()` keeps composing the matrices; the
packer reads `matrixWorld` as it does today.

**Camera** keeps `PerspectiveCamera(fov, aspect)`. The uniform block reserves two words for M3's
thin lens (aperture, focus distance).

**Lights** at M2 are emissive triangles: every triangle of a mesh whose material's emission is
not black. Analytic lights are M3's; the light table reserves a type word for them.

### The GPU layout

Every stride below is a count of `vec4` (16 bytes). The constants live in
`src/kernels/layout.shade.ts` as module constants, which the host imports through the module's
host face (surface §64, Rule 8.21: an exported constant is a frozen copy). One authority: the
host never keeps a copy of a stride. Until the preload plugin for scripts and tests proves it can
import a constant from a `.shade.ts`, `src/kernels/layout.test.ts` holds the host's copy equal
to the kernel's, and the record names that as the fallback.

| Binding     | Declaration                          | Stride | What one element holds                                                                                                                                                                                                                                                        |
| ----------- | ------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nodes`     | `storage<array<vec4>>`               | 2      | A BVH node, BLAS or TLAS. `[0] = (min.x, min.y, min.z, bits(a))`, `[1] = (max.x, max.y, max.z, bits(b))`. `count = b & 0x3fffffff`, `axis = b >> 30`. `count == 0`: an inner node, `a` the left child, the right child `a + 1`. `count > 0`: a leaf, `a` the first primitive. |
| `triangles` | `storage<array<vec4u>>`              | 1      | `(i0, i1, i2, flags)`. Vertex indices relative to the BLAS's `vertexBase`. `flags` is 0 at M2; M3 may use it for alpha cutout.                                                                                                                                                |
| `vertices`  | `storage<array<vec4>>`               | 2      | `[0] = (p.x, p.y, p.z, u)`, `[1] = (n.x, n.y, n.z, v)`. The position, the shading normal in the geometry's space and the uv.                                                                                                                                                  |
| `instances` | `storage<array<vec4>>`               | 8      | `[0..2]`: the world matrix, rows (`m00 m01 m02 tx`, `m10 m11 m12 ty`, `m20 m21 m22 tz`). `[3..5]`: the inverse, the same way. `[6] = (bits(nodeBase), bits(primBase), bits(vertexBase), bits(material))`. `[7] = (bits(flags), bits(geometryId), 0, 0)`.                      |
| `materials` | `storage<array<vec4>>`               | 8      | Record 0004's material record. M2 fills `[0..3]`; `[4..7]` are reserved for M3.                                                                                                                                                                                               |
| `lights`    | `storage<array<vec4>>`               | 1      | `(bits(type), bits(instance), bits(triangle), cdf)`. `type` 0 is an emissive triangle; `cdf` is the cumulative probability of this light, in `[0, 1]`, the last light's 1. M3 adds types for point, spot, sun and the environment in the same table.                          |
| `accum`     | `storage<array<vec4>, "read_write">` | 1      | A pixel's samples added up: rgb, and how many in w. Unchanged from M1.                                                                                                                                                                                                        |

Indices inside a BLAS are **relative**: a child index is relative to the BLAS's first node, a
leaf's first primitive to its `primBase`, a triangle's vertex indices to its `vertexBase`. The
kernel adds the instance's bases. A BLAS is then position-independent: when the compiler gives
the runtime a partial buffer write (record 0006, item 2), a BLAS moves without a rewrite.

The TLAS lives in `nodes` too, after every BLAS, at `params.scene.x` (`tlasBase`). Its leaves
hold instances: `a` is the first instance's index, `count` how many, 1 in the common case. Its
boxes are the instances' object-space boxes transformed to world space.

The two uniform blocks, which replace M1's `TraceParams`:

```ts
class TraceParams {
  eye: vec4; right: vec4; up: vec4; forward: vec4; // the camera's frame (w unused)
  lens: vec4;   // tan of half the horizontal and vertical fov; aperture radius; focus distance (M3)
  frame: vec4u; // the frame's width and height; the first sample's index; samples to take
  tile: vec4u;  // the tile's x0, y0, width, height, in frame pixels
  scene: vec4u; // tlasBase; the instance count; the light count; the seed
  path: vec4u;  // the bounces a path may take; the bounce roulette starts at; flags; unused
}
class PresentParams { view: vec4; } // unchanged from M1
```

**Sizes under the limits.** At 128 MiB per binding: 4,194,304 nodes, 8,388,608 triangles,
4,194,304 vertices, 1,048,576 instances, 1,048,576 materials, 8,388,608 lights. Sponza (about
262,000 triangles and 190,000 vertices) is 4.2 MB of triangles, 6.1 MB of vertices and, with
leaves of 2 to 4 triangles, about 7 MB of nodes (an inference; step 5 measures it). The engine's limit before record 0006 item 1 lands is therefore the binding
size, not the scene the owner has in mind.

### Traversal

`src/kernels/intersect.shade.ts` holds the geometry tests and the traversal, imported by
`trace.shade.ts`:

- **Ray against box**: the slab test with precomputed `1 / d` per ray, in the space the box is
  in. A division is a `ulp` row of the determinism report; record 0005 admits it.
- **Ray against triangle**: the watertight test of Woop, Benthin and Wald (2013). Its shear
  constants are computed once per ray per space; it leaves no crack along a shared edge, which a
  shadow ray toward a light would otherwise pass through. Its one division is the final `1 / det`.
- **Two-level traversal**: `nearest(origin, dir, limit)` walks the TLAS with a stack of
  `array<u32, 32>`. At an instance leaf it transforms the ray into the instance's space with
  rows `[3..5]` (the direction is not normalised, so `t` stays a world-space parameter), walks
  that BLAS with a second `array<u32, 32>`, and continues the TLAS. The nearer child is walked
  first: the child on the side of `axis` the ray's direction points away from is pushed first.
  A leaf's primitives are tested in order.
- **Occlusion**: `occluded(origin, dir, limit)` is the same walk and returns at the first hit.
  It is a second function, not a flag.
- **Depth**: the builder makes a leaf at depth 30, whatever the surface area heuristic says, so
  32 entries hold any tree.
- **The hit**: `Hit { t, instance, triangle, b1, b2 }`. `surface(hit, dir)` computes the point,
  the geometric normal (`normalize(cross(e1, e2))`, outward for counter-clockwise), the shading
  normal (the vertices' normals interpolated and transformed by the inverse transposed, which is
  rows `[3..5]`'s columns), the uv, and the material index. The front face is the side the
  geometric normal points to; emission leaves the front face only, as M1's quads do.

### The build

`src/accel/bvh.ts`, on the host:

- Binned surface area heuristic: 16 bins on the longest axis of the centroid box, the split
  with the least cost, a leaf when no split beats the leaf cost or the leaf holds at most 4
  primitives, and a forced leaf at depth 30.
- Nodes in depth-first order: an inner node's left child follows it, so the walk reads forward.
- Output: `{ nodes: Float32Array, order: Uint32Array, box: Box3 }`, with `order` the
  primitives' indices in leaf order. The packer writes `triangles` in that order, so a leaf's
  primitives are contiguous and the triangle buffer is permuted once.
- The TLAS uses the same builder over instance boxes, one primitive per instance.
- `bvh.test.ts` holds it: every primitive in exactly one leaf; every box contains its
  primitives' boxes; the root box is the geometry's; a node's children lie in it; the depth
  stays under 31; and, on 1,000 random rays against a random mesh, the traversal on the oracle
  (`compileModuleJs`) finds the same nearest triangle as a brute-force loop in TypeScript.

Build time is the host's. A 262,000-triangle mesh is expected to build in about one second in
JavaScript (an inference from the binned algorithm's cost; measured at step 4). A worker is
plan §7's M1 item, still open; this record does not move it.

### Change tracking and upload

`src/renderers/scene-pack.ts` replaces `pack.ts`. One `ScenePack` per renderer holds:

- a map from `Geometry` to `{ version, nodes, triangles, vertices, box }`, its BLAS and its
  packed arrays, rebuilt when `geometry.version` moved;
- a map from `Material` to `{ version, index }`, re-packed when `material.version` moved;
- the concatenated typed arrays of each buffer, with each BLAS's bases, and one `Resident`
  per buffer;
- the instance array, rebuilt every frame from `scene.traverseVisible` and compared with the
  last frame's, as M1 compares its arrays.

The upload rule, in order, each frame:

1. For each visible mesh, make sure its geometry's BLAS is current. A geometry whose version
   moved, or a geometry seen for the first time, is rebuilt and the concatenated `nodes`,
   `triangles` and `vertices` are written again whole. (The runtime writes a `Resident` whole;
   record 0006 item 2 is the partial write.)
2. Make sure every material is current; a moved version writes `materials` whole.
3. Build the instance array and the TLAS. When the instance array differs from the last
   frame's, write `instances`, append the TLAS to `nodes` and write `nodes`, rebuild `lights`
   and write it.
4. When any buffer was written, or the camera moved, start the accumulation again.

A scene whose geometry and materials do not change uploads them once. A scene whose
transforms change writes the instance array, the TLAS and the light table every frame: for
10,000 instances that is 1.3 MB, 0.3 MB and the light table, which this record accepts for M2
and M2a measures (record 0002, the benchmark).

A geometry removed from the scene keeps its BLAS in the pack until `dispose()` or until the
pack's `release(geometry)` is called. Record 0003 names `dispose()` as the public form.

### Tiles and the watchdog

Plan §3.1 item 1: a dispatch over two seconds loses the device on Windows. The renderer
dispatches the frame in tiles. `tile` says which pixels a dispatch covers; an invocation maps
`gid.x` to `(tile.x + gid.x % tile.z, tile.y + gid.x / tile.z)` and adds its samples to
`accum[py * frame.x + px]`. One pixel is one invocation in one dispatch, so the accumulation
stays free of atomics and the order of a pixel's samples stays fixed (record 0005).

`PathTracerParameters` gains `watchdogBudget` (milliseconds, default 50). The renderer sizes the
tile so that `tile pixels x samplesPerFrame x the last measured nanoseconds per path` stays
under the budget, starting from the whole frame and one sample, and records every dispatch's
time in `info`. A frame is still one `rt.frame()` and one `submit()`; the dispatches inside it
are as many as the tiles.

WebGPU's `maxComputeWorkgroupsPerDimension` is 65,535. With a workgroup of 64 that is 4,194,240
invocations in one dimension, under a 4K frame's 8,294,400 pixels. Tiling covers it: a tile is
never larger than 4,194,240 pixels.

### Limits

`src/renderers/limits.ts` holds the WebGPU default limits the engine assumes, each as a
constant with its name in the WebGPU specification, until record 0006 item 1 gives the runtime
a way to request and report limits. Before each upload the pack checks each buffer's byte
length against `maxStorageBufferBindingSize` and throws
`RangeError: the nodes buffer is 201,326,592 bytes; WebGPU binds at most 134,217,728 in one storage binding`.
The message names the buffer and both numbers.

### The oracle

`scripts/oracle.ts` binds the same typed arrays the renderer uploads (`vec4s` of each) and the
same uniform blocks, from the same `ScenePack`, so the CPU render and the GPU render read one
scene. Nothing in the oracle knows the layout; it knows the pack.

## Why

- **Why seven buffers and vectors.** Section "What changes" gives the two runtime facts. The
  alternative, structs, reads better in the kernel and costs a `DataView` write per field per
  element on every upload. A kernel that reads `instances[i * 8 + 6]` through a named helper
  (`instanceBases(i)`) reads as well as a struct field.
- **Why triangles only.** A second primitive type in the leaves is a second intersection
  routine, a second surface routine and a branch in the hottest loop, for two analytic shapes
  the product's demos do not need: the product viewer is glTF (plan §4). Mitsuba keeps analytic
  shapes for shape fitting, which plan §3.1 item 2 puts out of scope.
- **Why two levels.** Plan §3.1 item 6: a thousand trees share one BLAS. The alternative, one
  flat BVH over every triangle in world space, is rebuilt whole when one transform moves and
  holds no instancing.
- **Why relative indices.** A BLAS that is position-independent moves without a rewrite once a
  partial write exists, and the add it costs is one integer operation per step.
- **Why the whole buffer is re-written on a change.** The runtime has no partial write
  (`vendor/typeshade/src/core/resident.ts`, `bufferFor`: a host write replaces the buffer's
  contents, and a size change makes a new buffer). The honest design is the one the runtime
  supports, with the proposal filed (record 0006, item 2).
- **Why watertight intersection.** A Möller-Trumbore test lets a shadow ray through the shared
  edge of two triangles at some float inputs; the result is a lit speck on a closed mesh. Woop's
  test is a few more operations per triangle and no crack.
- **Why tiles now.** The watchdog is plan §3.1's first constraint and M1 ignores it: a 1080p
  frame at 64 samples is one dispatch. With a BVH each path costs more, and the first user on
  Windows with an integrated GPU loses the device.

Alternatives considered and not taken:

- **A `texture_2d` as the geometry store**, as WebGL path tracers do. WebGPU has storage
  buffers; a texture costs a format and a fetch per field.
- **Absolute indices.** Simpler kernel, a rewrite of every BLAS after the moved one at every
  change; rejected for the reason above.
- **A hand-written WGSL kernel.** Plan §3 and `CLAUDE.md`: GPU code is TypeShade. The surface
  has every construct the traversal needs: a `while` over a stack (§17), a fixed array (§18),
  `bitcast` (§44), a runtime-length array's `length` (§20).

## What it touches

- **Packages.** `packages/radiance/src/geometries/*` (BufferGeometry, the three tessellators),
  `src/accel/bvh.ts`, `src/renderers/scene-pack.ts`, `src/renderers/limits.ts`,
  `src/renderers/PathTracer.ts` (tiles, the new uniforms, the pack), `src/kernels/layout.shade.ts`,
  `src/kernels/intersect.shade.ts`, `src/kernels/trace.shade.ts`, `src/index.ts`;
  `packages/addons/src/loaders/GLTFLoader.ts`.
- **Removed.** `src/renderers/pack.ts`, `QuadGeometry` (renamed), the analytic branches of the
  kernel. `packScene`, `cameraUniforms`, `PackedScene` and `CameraUniforms` leave the public
  surface (record 0003).
- **Scripts.** `scripts/oracle.ts` (the pack), `scripts/gates.mjs` (the Cornell box gate's
  thresholds re-derived), `scripts/harness.mjs` (record 0002 restructures it).
- **Site.** The guide pages that show `QuadGeometry` and the scene-graph table on the front
  page; the examples; `docs/plan.md` §3.2 (triangles only; the buffer set) and §8 (the
  suballocation row points to record 0006 item 2).
- **Tests owed.** `bvh.test.ts` (above); `layout.test.ts` (the strides, the uniform block's
  byte offsets against the manifest's layout); `scene-pack.test.ts` (a change to one
  geometry re-writes three buffers and no other; a moved transform writes instances, nodes
  and lights; an unchanged scene writes nothing; the limit check throws with the sentence
  above); `kernels.test.ts` gains the intersection tests on the oracle (a ray through a
  shared edge hits exactly one of the two triangles; a transformed instance is hit where its
  matrix puts it).

## Implementation, in steps

Each step is one pull request with `Design: 0001` in its commit message. The gates of record
0002 that exist at the time run green on each.

1. **`BufferGeometry` and the tessellators.** `BufferGeometry`, `SphereGeometry`,
   `PlaneGeometry`, `BoxGeometry`, `computeVertexNormals`, `computeBoundingBox`, their tests
   (vertex and index counts, normals unit length and outward, the uv layout against three.js's
   for one sphere). The kernel is untouched: `packScene` tessellates nothing yet, and the
   analytic sphere and quad keep rendering through a temporary adapter from the new classes to
   the old pack, so every example keeps running. Done when `bun run check` and `bun run harness`
   pass and the site's examples render as before.
2. **The BVH builder and the layout module.** `src/accel/bvh.ts` and `bvh.test.ts`;
   `src/kernels/layout.shade.ts` with the strides and the decoders (`nodeBounds(i)`,
   `nodeWords(i)`, `vertexPosition(base, i)`, `instanceBases(i)`, `instanceToObject(i, p)`,
   `instanceToWorld(i, v)`); `layout.test.ts`. No renderer change yet. Done when the builder's
   tests pass and `tshc check` accepts the module.
3. **The kernel on the new layout.** `intersect.shade.ts`, the new `TraceParams`, `trace.shade.ts`
   over triangles, instances and the light table; `scene-pack.ts`, `limits.ts`; `PathTracer`
   on the pack, with tiles; `oracle.ts` on the pack. `pack.ts` and the analytic branches are
   removed. The Cornell box gate runs on tessellated spheres with thresholds re-derived
   (record 0002, step 2). Done when `bun run harness` passes with the new numbers recorded in
   the pull request, and `scene-pack.test.ts` passes.
4. **The glTF loader.** `GLTFLoader` in addons: `.gltf` and `.glb`, the node tree as `Object3D`s,
   each primitive a `Mesh` with a `BufferGeometry` and a `PhysicalMaterial` (record 0004) from
   `pbrMetallicRoughness`'s factors (textures wait for M3). The Stanford bunny renders
   (M2's acceptance), and the build time of its BVH is recorded in the pull request. Done when
   the `bunny` example and its gate (record 0002) pass.
5. **Sponza.** Part of Sponza renders (M2's acceptance); the benchmark row is recorded
   (record 0002, the benchmark). Done when the gate and the benchmark script run.

M2a (animation) and M3 (the reserved fields) are later records that build on this layout; this
record is implemented at step 5.

## Decisions for the owner

1. Triangles only: M1's analytic sphere and quad leave the kernel, and the Cornell box gate
   is re-derived on tessellated spheres.
2. Seven storage buffers in the path tracer's pipeline, with the layouts above, held through
   M3. A change to a layout is an amendment to this record.
3. Vertices carry a position, a normal and a uv in two `vec4`; tangents are derived at the hit
   (record 0004), not stored.
4. Indices inside a BLAS are relative to the BLAS.
5. A geometry change writes the three geometry buffers whole until the compiler gives the
   runtime a partial write.
6. Tiling with a `watchdogBudget` of 50 ms by default.
7. `QuadGeometry` is renamed `PlaneGeometry`, and `BoxGeometry` is added, for three.js parity
   (record 0003 decides names; this record depends on it).

## Record

**Approval and plan record.** This record does not yet apply. Acceptance requires the owner's
review of the decisions above and the merge of this record with `status: accepted`.

**Configuration and validation record.** This record does not yet apply. Implementation will
record the commits of steps 1 to 5, the pin they were built on, the gate numbers of record 0002
at step 3 and the benchmark rows at step 5.
