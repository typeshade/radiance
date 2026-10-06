---
id: '0001'
title: Triangle meshes and analytic spheres, instanced through a two-level BVH, reach the kernel through seven storage buffers with layouts fixed from M2 through M3
status: accepted
milestones: [M2, M2a, M3]
touches:
  - packages/radiance/src/core
  - packages/radiance/src/geometries
  - packages/radiance/src/accel
  - packages/radiance/src/renderers
  - packages/radiance/src/kernels
  - packages/addons/src/loaders
  - packages/addons/src/scenes
  - site/examples
  - scripts/oracle.ts
  - scripts/gates.mjs
compiler: ['0006-1', '0006-2', '0006-3']
---

**Document control**

| Field         | Value                                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Identity      | Design record 0001, status `draft`                                                                                             |
| Date          | 2026-10-05 (UTC), the date of authorship                                                                                       |
| Author        | Written in a Claude Code session for the owner (Seungup Noh). The owner's review is the approval, not this attribution         |
| Applicability | `@typeshade/radiance` and `@typeshade/radiance-addons` at 0.0.0. The kernels under `packages/radiance/src/kernels`. `scripts/` |
| Baseline      | `main` at 0f17f5e. The compiler pinned at `vendor/typeshade` e923a34                                                           |
| Pull request  | typeshade/radiance#6, the pull request that carries this record and is its review                                              |

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
hierarchy for each geometry (a BLAS) and one over the instances each frame (the TLAS). The kernel
traverses both with a stack. Change tracking is per object: a geometry, a material or a
transform that changed re-packs its own part.

Amendment 3 adds one primitive beside the triangle: the analytic sphere ("The analytic sphere").
It is an instance with a flag. It adds no buffer and changes no stride.

The three rules the layout is written under:

1. **Seven storage buffers in the path tracer's pipeline, never eight.** WebGPU's default
   `maxStorageBuffersPerShaderStage` is 8, and the runtime requests no higher limit (record
   0006, item 1). The eighth slot stays free for the compiler's console buffer, which a stage
   that binds eight cannot take (`vendor/typeshade/src/core/passes/console-buffer.ts`,
   `DEFAULT_STORAGE_BUFFERS_PER_STAGE`).
2. **Every buffer is an array of `vec4` or `vec4u`, bound from one typed array.** The runtime
   binds a runtime-sized array of scalars or vectors from a typed array, and an array of
   structs from an array of objects packed one field at a time (Rule 8.21, `runtimeCount` in
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
  /** uv per vertex, three.js's layout: v = 1 at the top of a plane and at a sphere's north pole. */
  // The glTF loader (step 4) stores glTF's values as they are. The texture upload (record 0004,
  // M3) sets each image's orientation, as three.js does with flipY. Absent: every uv is 0.
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
  `PlaneGeometry(width = 1, height = 1)` (M1's `QuadGeometry`, renamed, record 0003) and
  `BoxGeometry(width, height, depth)` build a `BufferGeometry`. Their tessellation is
  three.js's: the same vertex order and the same uv layout, so a scene ported from three.js
  looks the same. `PlaneGeometry` faces +z and `SphereGeometry`'s normals point outward.
- **Triangles, and one analytic sphere.** M1's analytic sphere and quad left the kernel at step 3.
  A mesh is triangles. A quad is a `PlaneGeometry` of two triangles. Amendment 3 brings the sphere
  back in a new form, as an instance with a flag ("The analytic sphere"). The Cornell box gate's
  spheres became tessellated spheres at step 3, and its thresholds were re-derived in the same
  pull request (record 0002, step 2). They become analytic spheres at step 9.
- A `Geometry` is shared by any number of meshes. Its BLAS is built once per `version` and
  reused by every mesh that holds it: a mesh is an instance.

**Material** gains `version` and the record of record 0004: `type` (0 diffuse, 1 mirror, 2
physical), the colours and the scalar parameters. This record only fixes that a material packs
into `MATERIAL_STRIDE` vec4s.

**Mesh** stays `Mesh(geometry, material)`. A glTF mesh with several primitives loads as a group
of one `Mesh` per primitive, so a mesh has one material and a BLAS has one material per
instance. The instance record carries the material, so two meshes that share one geometry with
two materials are two instances of one BLAS: that is plan §3.1 item 6's material override.

**Object3D** gains nothing visible. `updateMatrixWorld()` keeps composing the matrices. The
packer reads `matrixWorld` as it does today.

**Camera** keeps `PerspectiveCamera(fov, aspect)`. The uniform block reserves two words for M3's
thin lens (aperture, focus distance).

**Lights** at M2 are emissive triangles: every triangle of a mesh whose material's emission is
not black. Analytic lights are M3's. The light table reserves a type word for them.

### The GPU layout

Every stride below is a count of `vec4` (16 bytes). The constants live in
`src/kernels/layout.shade.ts` as module constants, which the host imports through the module's
host face (surface §64, Rule 8.21: an exported constant is a frozen copy). One authority: the
host never keeps a copy of a stride. Until the preload plugin for scripts and tests proves it can
import a constant from a `.shade.ts`, `src/kernels/layout.test.ts` holds the host's copy equal
to the kernel's, and the record names that as the fallback.

| Binding     | Declaration                          | Stride | What one element holds                                                                                                                                                                                                                                                                                                                |
| ----------- | ------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nodes`     | `storage<array<vec4>>`               | 2      | A BVH node, BLAS or TLAS. `[0] = (min.x, min.y, min.z, bits(a))`, `[1] = (max.x, max.y, max.z, bits(b))`. `count = b & 0x3fffffff`, `axis = b >> 30`. `count == 0`: an inner node, `a` the left child, the right child `a + 1`. `count > 0`: a leaf, `a` the first primitive.                                                         |
| `triangles` | `storage<array<vec4u>>`              | 1      | `(i0, i1, i2, flags)`. Vertex indices relative to the BLAS's `vertexBase`. `flags` is 0 at M2. M3 may use it for alpha cutout.                                                                                                                                                                                                        |
| `vertices`  | `storage<array<vec4>>`               | 2      | `[0] = (p.x, p.y, p.z, u)`, `[1] = (n.x, n.y, n.z, v)`. The position, the shading normal in the geometry's space and the uv.                                                                                                                                                                                                          |
| `instances` | `storage<array<vec4>>`               | 8      | `[0..2]`: the world matrix, rows (`m00 m01 m02 tx`, `m10 m11 m12 ty`, `m20 m21 m22 tz`). `[3..5]`: the inverse, the same way. `[6] = (bits(nodeBase), bits(primBase), bits(vertexBase), bits(material))`. `[7] = (bits(flags), bits(geometryId), 0, 0)`. `flags` is 0 for a mesh. Bit 0 (`INSTANCE_SPHERE`) marks an analytic sphere. |
| `materials` | `storage<array<vec4>>`               | 8      | Record 0004's material record. M2 fills `[0..3]`. `[4..7]` are reserved for M3.                                                                                                                                                                                                                                                       |
| `lights`    | `storage<array<vec4>>`               | 1      | `(bits(type), bits(instance), bits(triangle), cdf)`. `type` 0 is an emissive triangle. `triangle` is absolute. `cdf` is the cumulative chance of this light, in `[0, 1]`, the last light's 1. M3 adds types for point, spot, sun and the environment in the same table.                                                               |
| `accum`     | `storage<array<vec4>, "read_write">` | 1      | A pixel's samples added up: rgb, and how many in w. Unchanged from M1.                                                                                                                                                                                                                                                                |

Indices inside a BLAS are **relative**: a child index is relative to the BLAS's first node, a
leaf's first primitive to its `primBase`, a triangle's vertex indices to its `vertexBase`. The
kernel adds the instance's bases. A BLAS is then position-independent: when the compiler gives
the runtime a partial buffer write (record 0006, item 2), a BLAS moves without a rewrite.

A triangle's index outside a BLAS is absolute. `Hit.triangle` and the light table's
`bits(triangle)` index `triangles` as a whole: the instance's `primBase` plus the triangle's
relative index. `nearest` adds `primBase` to a leaf's relative index (`intersect.shade.ts`). The
host adds it when it writes the light table (`#lightTable` in `scene-pack.ts`).
`triangleWords(i)` in `layout.shade.ts` takes such an index. Decision 4 stands, because an index
stored inside a BLAS stays relative. The pack builds `lights` again when a geometry changed, so a
light never names a triangle of a BLAS that moved.

The TLAS lives in `nodes` too, after every BLAS, at `params.scene.x` (`tlasBase`). Its leaves
hold instances: `a` is the first instance's slot in the TLAS's leaf order, `count` how many, up
to the leaf size of 4. The packer writes `instances` in that order, so a slot is the index into
`instances`, and `Hit.instance` and the light table's `bits(instance)` name the same index. Its
boxes are the instances' object-space boxes transformed to world space.

**The light table.** `#lightTable` in `scene-pack.ts` builds it, as follows:

- One light for each triangle of each instance whose material's emissive colour has a mean above
  zero. A triangle whose area in world space is zero is not a light.
- A light's power is its area in world space times that mean. The mean is over the three
  channels of the emissive colour, which record 0004 stores multiplied by `emissiveIntensity`.
  The "double sided" flag does not change it.
- A light's chance is its share of the emitted power: its power over the sum of the power of
  every light.
- The rows are in slot order, then in the order of `triangles`.
- A row's `cdf` is its chance plus the chance of every row before it. The last row's `cdf` is
  exactly 1.
- The kernel finds a light with a search over `cdf` (`pickLight` in `trace.shade.ts`). It takes
  that light's chance as its `cdf` less the `cdf` of the row before (`direct`).

The chance of the types that M3 adds belongs to the record that adds them.

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
leaves of 2 to 4 triangles, about 7 MB of nodes (an inference, step 5 measures it). The engine's limit before record 0006 item 1 lands is therefore the binding
size, not the scene the owner has in mind.

### Traversal

`src/kernels/intersect.shade.ts` holds the geometry tests and the traversal, imported by
`trace.shade.ts`:

- **Ray against box**: the slab test with precomputed `1 / d` per ray, in the space the box is
  in. A division is a `ulp` row of the determinism report. Record 0005 admits it. `prepare`
  computes `inv`, the slab test's `1 / d`, with each component of `d` whose absolute value is
  below 1e-20 taken as +1e-20 (`TINY`). The ray keeps `d` as it is for the triangle test and the
  walk. A component of -1e-30 gives `inv` of about +1e20, and `d` keeps the component as -1e-30.
  No infinity then enters the test. `prepare` runs for the world ray and, through `rayIn`, for
  each instance-space ray, so it computes `inv` the same way in both spaces. The kernel multiplies
  the far distance by 1.0000004 (`SLAB_SLACK` in `enters`). This keeps the rounding of the test
  from culling a hit on a box's face.
- **Ray against triangle**: the watertight test of Woop, Benthin and Wald (2013). Its shear
  constants are computed once per ray per space. It leaves no crack along a shared edge, which a
  shadow ray toward a light would otherwise pass through. Its one division is the final `1 / det`.
- **Two-level traversal**: `nearest(origin, dir, limit)` walks the TLAS with a stack of
  `array<u32, 32>`. At an instance leaf it transforms the ray into the instance's space with
  rows `[3..5]` (the direction is not normalised, so `t` stays a world-space parameter), walks
  that BLAS with a second `array<u32, 32>`, and continues the TLAS. The nearer child is walked
  first: the farther child, on the side of `axis` the ray's direction points toward, is pushed
  first, so the stack pops the nearer one first. A leaf's primitives are tested in order. An
  instance whose `flags` bit 0 is set is an analytic sphere. `nearest` tests it as "The analytic
  sphere" states, and walks no BLAS for it.
- **Occlusion**: `occluded(origin, dir, limit)` is the same walk and returns at the first hit.
  It is a second function, not a flag.
- **Depth**: the builder makes a leaf at depth 30, whatever the surface area heuristic says, so
  32 entries hold any tree.
- **The hit**: `Hit { t, instance, triangle, b1, b2, q }`. `q` is for an analytic sphere and is 0
  for a triangle. `instance` is a slot in `instances`.
  `triangle` is an absolute index ("The GPU layout"). `b1` and `b2` are the weights of the
  triangle's second and third vertex. `surface(hit, dir)` computes the point, the geometric
  normal, the shading normal, the uv, and the material index.
- **The surface of a point**: `surfaceAt(instance, triangle, b1, b2, dir)` gives the same
  `Surface` as `surface` for the point that its instance, triangle and weights name. A ray along
  `dir` meets that point. `surface` calls it for a hit. Next-event estimation calls it for the point it samples on a
  light (`direct` in `trace.shade.ts`), with the direction from the shaded point to that point.
- **The normals**: the outward normal is `cross(p1 - p0, p2 - p0)` in the geometry's space. For a
  counter-clockwise triangle it points out of the surface. The kernel moves it to world space by
  the inverse transposed (`instanceNormalToWorld`) and then normalises it. A mirrored instance,
  whose world matrix has a negative determinant, keeps its outside. The shading normal is the
  vertices' normals interpolated, and transformed by the inverse transposed, which is rows
  `[3..5]`'s columns. The front face is the side the outward normal points to. `Surface.ng` of
  record 0004 is the outward normal turned toward the ray: `surfaceAt` negates it when the ray
  meets the back face.
- **Emission**: a material emits from its front face. It emits from its back face too when its
  "double sided" flag is on (bit 9 of `[2].w` in the material record of record 0004). Both
  faces emit the same colour (`emission` in `materials.shade.ts`).

### The analytic sphere

Amendment 3 adds one primitive beside the triangle: the analytic sphere. The kernel meets it by the quadratic. The hit point is exact to the rounding of `f32`. The geometric normal is the shading normal (`ng = ns`). A mirror ball then reflects as a sphere and not as a faceted mesh with interpolated normals. `SphereGeometry` stays a mesh. The two exist side by side. Record 0004 states the shading rules, and record 0005 states the arithmetic rules.

The facts come from a survey of other renderers on 2026-10-06. Its notes are not in the tree. pbrt, Mitsuba 3, Embree, Mantra, RenderMan RIS and V-Ray intersect a sphere analytically. three.js, Unreal and Unity hardware ray tracing, and glTF have no such primitive. Every mesh renderer shows the facets of a coarse mirror ball.

**What stores it.** One analytic sphere is one instance and nothing else. It adds no node to a BLAS, no triangle and no vertex. The instance is the 8 `vec4` of "The GPU layout" (128 bytes), with these words:

| Words      | Content for an analytic sphere                                                                                                      |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `[0]..[2]` | The rows of `M`, the world matrix of the mesh times `scale(radius)`. The translation column is the centre in world space            |
| `[3]..[5]` | The rows of the inverse of `M`                                                                                                      |
| `[6]`      | `(0, 0, 0, bits(material))`. The three bases are unused                                                                             |
| `[7]`      | `(bits(INSTANCE_SPHERE), bits(0xffffffff), 0, 0)`. Bit 0 of `flags` marks the sphere. The `geometryId` is `NONE`, which no BLAS has |

The packer computes `M` and its inverse in `f64` and rounds each word to `f32`, as it does for a mesh. Object space is the unit sphere about the origin. The radius lives in the matrix and not in a word of its own. So one kernel routine serves every radius.

**A non-uniform scale.** The kernel does not refuse it. The image of the unit sphere under any invertible affine map is an ellipsoid. The traversal already moves the ray into object space for every instance (`rayIn` in `intersect.shade.ts`). The kernel then intersects the unit sphere there. The direction is not normalised, so `t` stays a world-space parameter, as for a triangle. A matrix with no inverse drops the instance, as it does for a mesh. This is decided by default.

**How the BVH holds it.** The sphere is a leaf of the TLAS, as every instance is. A TLAS leaf whose instance has `flags` bit 0 set runs the sphere test and walks no BLAS. The TLAS box of the instance is the exact box of the ellipsoid. Its centre is the translation column. Its half extent along axis `k` is the length of row `k` of the 3 by 3 part of `M`. The packer computes it in `f64` and rounds the lower corner down and the upper corner up to `f32`. The record compares three ways to hold a sphere:

| Option                         | Bytes per sphere  | Nodes added | Cost in the hot loop                                                 | Non-uniform scale | Buffer change     |
| ------------------------------ | ----------------- | ----------- | -------------------------------------------------------------------- | ----------------- | ----------------- |
| A. A flagged instance (chosen) | 128               | 0           | One flag read for each instance leaf. No cost inside a BLAS          | Yes, as ellipsoid | None              |
| B. A leaf kind inside a BLAS   | 16 (centre and r) | 0           | One flag test for each primitive of every BLAS, for triangles too    | No, world space   | A bit of word `b` |
| C. A list tested after the BVH | 16                | 0           | One sphere test for each sphere for each ray: linear, and no culling | No                | An eighth buffer  |

Option A is decided by default. It keeps seven buffers (rule 1) and every stride. It adds no branch to the loop that tests triangles. The TLAS culls spheres by their boxes. Its cost is 128 bytes for each sphere, so the instance limit of "Limits" (1,048,576) is also the sphere limit. Inference: a scene of 10^6 spheres, such as particles, fits the limit exactly. If such a scene arrives, option B is the amendment to write. Option C is rejected: it breaks rule 1, and its cost grows with the sphere count.

**The ray and the sphere.** `hitSphere(o, d, limit)` in `intersect.shade.ts` takes the ray in object space and returns `(t, q)`, with `t` below 0 for a miss. All arithmetic is `f32`. The operations are `+`, `-`, `*`, `/`, `sqrt`, `dot`, `normalize` and comparisons. The order below is part of the record:

```ts
const a = dot(d, d);
const b = dot(o, d);
const f = o - d * (b / a); // the point of the line nearest the centre
const disc = a * (1 - dot(f, f)); // b * b - a * c, without the cancellation
// miss when a is 0, or disc is below 0
const k = -(b + select(-sqrt(disc), sqrt(disc), b >= 0));
const c = dot(o, o) - 1;
const t1 = k / a;
const t2 = c / k; // miss when k is 0
// t is the smaller of t1 and t2 that is above 0, else the larger that is above 0, else a miss
// miss when t is not below limit
const q = normalize(o + d * t); // the hit point put back on the unit sphere
```

The form of `disc` and `k` is the one of Haines, "Precision Improvements for Ray/Sphere Intersection" (Ray Tracing Gems, 2019). It computes the discriminant from the distance of the line to the centre. The textbook form `b * b - a * c` cancels when the origin is far from the sphere. `k` takes the sign of `b`, so no subtraction of near equal numbers feeds `t1`. `t2` is the other root by the product of the roots, `c / a`.

**The precision rule.** A throwaway script measured the form above, with every operation rounded to `f32` and none fused, against `f64` on the same inputs. Its rays aimed at the unit ball from distances of 1.0001 to 10^5 radii, with directions of length 10^-3 to 10^3. The script is not in the tree. The unit measure is `ulp(S)`, the spacing of `f32` at `S = max(1, the largest |o_k|)`. The rule:

1. For a ray whose impact parameter is at most 0.999, `|t - t_ref| * |d| <= 16 * ulp(S)`. The measured worst case was 9.68 over 1,200,000 rays. The textbook form measured 13,711.
2. `abs(length(q) - 1)` is at most 4e-7. The measured worst case was 1.54e-7.
3. A ray that leaves a point 1e-4 outside the sphere, away from it, never meets it. The measure was 0 hits in 200,000 rays.
4. A ray whose impact parameter lies within 1e-4 of 1 has no bound. The measure was 127 missed hits and 131 false hits in 190,366 hits. The differential gate admits such rays by its `rel` and `mean` bounds.

The implementing step measures the kernel itself on the oracle and records the numbers. If a measure passes a bound, the step amends this rule before it merges.

**The hit record.** `Hit` gains `q: vec3`, the object-space point of a sphere hit, which is a unit vector. A triangle hit leaves `q` at zero. A sphere hit sets `triangle` to `NONE`, and sets `b1` and `b2` to 0. The test for a miss stays `instance === NONE`. `surface(hit, dir)` calls `sphereSurfaceAt(instance, q, dir)` when `hit.triangle === NONE`. The `Surface` is as follows:

- `p`: `instanceToWorld(instance, (q, 1))`, moved along `ng` by `OFFSET` times the largest of 1 and the point's largest absolute coordinate, as record 0004 states.
- `ng`: the outward normal `normalize(instanceNormalToWorld(instance, q))`, turned toward the ray. For the unit sphere the normal at `q` is `q`. The inverse transposed moves it to world space. A mirrored instance (a negative determinant) keeps its outside, as for a triangle.
- `ns`: equal to `ng`. Record 0004 states the rule.
- `uv`: the spherical parameterisation of three.js's `SphereGeometry`. Record 0004 states it.
- `dpdu`: `instanceToWorld(instance, (2 * pi * (q.z, 0, -q.x), 0))`. Both factors are sums and products. At a pole the vector is 0, and the fallback frame about `ns` applies.
- `material` and `front`: as for a triangle.

`nearest` and `occluded` take the same branch. `occluded` returns true for any `t` above 0 and below `limit`.

**The host model.** A new geometry class, in `src/geometries/AnalyticSphereGeometry.ts`:

```ts
class AnalyticSphereGeometry extends Geometry {
  readonly type = 'AnalyticSphereGeometry';
  /** The radius, above 0 and finite. The constructor throws a RangeError otherwise. */
  readonly radius: number;
  constructor(radius = 1);
}
```

A mesh holds it as it holds any geometry: `new Mesh(new AnalyticSphereGeometry(0.4), material)`. The mesh's position is the centre, and its scale and rotation shape the ellipsoid. The class has no `version`, because the radius cannot change. To change a radius, the author sets the mesh's scale or makes a new geometry. Decided by default, for three reasons:

1. A flag on `SphereGeometry` would make one class hold two layouts. `SphereGeometry` is a `BufferGeometry`, which requires `position` and `index`.
2. A `Sphere` object would add a second drawable class, and a second filter in every traversal of the scene.
3. A `Mesh` already carries the material, the transform and the visibility. The pack already reads them.

`ScenePack.update` accepts a `BufferGeometry` or an `AnalyticSphereGeometry`. For any other geometry it throws the `TypeError` it throws now. Record 0003 lists the new export.

**Emission.** The light table lists triangles. A sphere that emits would meet only camera rays and mirror paths. Next-event estimation could not sample it, so the light would be lost from every diffuse path. `ScenePack.update` therefore throws `TypeError: an analytic sphere does not emit: the light table lists triangles only` for a sphere whose material emits. M3's analytic lights may add a sphere type to the light table, and its type word is reserved. Decided by default.

**Change tracking and upload.** A sphere uses the instance rule of "Change tracking and upload" and no other. A moved or scaled mesh writes `instances`, and `nodes` with the new TLAS. It never writes `triangles` or `vertices`, so `pack.arrays.triangles` stays the same array object. A scene of spheres alone has `tlasBase` 0, and `nodes` holds the TLAS only. `triangles` and `vertices` hold one zero element each, the pack's minimum. A mesh whose geometry changes between a sphere and a `BufferGeometry` changes its `flags` word, so the instances differ and the pack writes them.

**Limits.** The instance limit of "The GPU layout" (1,048,576) bounds the spheres. The precision rule of this section holds for an origin up to 10^5 radii from the centre. The `OFFSET` of record 0004 is 1e-4 times the largest of 1 and the point's largest absolute coordinate. For a sphere whose radius is under 1e-3 of that factor, the offset passes a tenth of the radius. The record does not refuse such a sphere. Inference: its contact shadows and reflections move by about the offset.

**The oracle.** `scripts/oracle.ts` needs no change. It binds the arrays of the pack and runs `trace.shade.ts`, so the sphere test runs there too. This has a cost. The GPU and the oracle read one pack and run one formula. So the differential gate cannot see a wrong radius in the packer or a wrong term in the formula. Record 0002 adds checks that do not share them: a test against an independent `f64` reference, and the render gate's goldens.

**Note on M6.** The SDF item of milestone M6 (`docs/plan.md`, the milestone table) will reference this primitive as the first analytic shape. This amendment does not change `docs/plan.md`. A plan change is its own pull request.

### The build

`src/accel/bvh.ts`, on the host:

- Binned surface area heuristic: 16 bins on the longest axis of the centroid box, the split
  with the least cost, a leaf when no split beats the leaf cost or the leaf holds at most 4
  primitives, and a forced leaf at depth 30.
- Nodes in depth-first order: each child pair is written after its parent, the left child at
  `a` and the right at `a + 1`, so every child's index is larger than its parent's and the walk
  reads forward.
- Output: `{ nodes: Float32Array, order: Uint32Array, box: Box3 }`, with `order` the
  primitives' indices in leaf order. The packer writes `triangles` in that order, so a leaf's
  primitives are contiguous and the triangle buffer is permuted once.
- The TLAS uses the same builder over instance boxes, one primitive per instance, with the
  same leaf size, so a TLAS of 4 or fewer instances is one leaf. It differs in one rule: no TLAS
  leaf holds more than 4 instances, so it splits every node of more than 4 (`buildTlas` in
  `bvh.ts`). It splits such a node as follows:

1. Bin the instances on the longest axis of their centroid box, as for a BLAS. Find the split
   of least cost. The leaf's cost does not count.
2. Take that split when its larger side can reach leaves of 4 by depth 30. A side of m
   instances can when the child's depth, plus the halvings from m down to 4 or fewer, is at
   most 30. Each halving rounds up.
3. Otherwise split at the median. Do the same when the centroids lie at one point, or when no
   bin split separates the instances.
4. The median split sorts the node's instances by centroid on the longest axis, ties by
   instance index. The first half, rounded down, goes to the left child. A median split halves
   the count, so the depth stays at 30 or under.

- `bvh.test.ts` holds it: every primitive in exactly one leaf. Every box contains its
  primitives' boxes. The root box is the geometry's. A node's children lie in it. The depth
  stays under 31. And, on 1,000 random rays against a random mesh, the traversal on the oracle
  (`compileModuleJs`) finds the same nearest triangle as a brute-force loop in TypeScript. For the
  TLAS it also holds, on the boxes of its tests, that no leaf holds more than 4 instances and
  that the depth stays at 30 or under.

Build time is the host's. A 262,000-triangle mesh is expected to build in about one second in
JavaScript (an inference from the binned algorithm's cost, measured at step 4). A worker is
plan §7's M1 item, still open. This record does not move it.

### Change tracking and upload

`src/renderers/scene-pack.ts` replaces `pack.ts`. One `ScenePack` per renderer holds:

- a map from `Geometry` to `{ version, nodes, triangles, vertices, box }`, its BLAS and its
  packed arrays, rebuilt when `geometry.version` moved.
- a map from `Material` to `{ version, index }`, re-packed when `material.version` moved.
- the concatenated typed arrays of each buffer, with each BLAS's bases, and one `Resident`
  per buffer.
- the instance array, rebuilt every frame from `scene.traverseVisible` and compared with the
  last frame's, as M1 compares its arrays.

The upload rule, in order, each frame:

1. For each visible mesh, make sure its geometry's BLAS is current. A geometry whose version
   moved, or a geometry seen for the first time, is rebuilt and the concatenated `nodes`,
   `triangles` and `vertices` are written again whole. (The runtime writes a `Resident` whole,
   record 0006 item 2 is the partial write.)
2. Make sure every material is current. A moved version writes `materials` whole.
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

A mesh whose geometry has an empty index draws nothing. When the pack held a BLAS for that
geometry, it drops the BLAS and writes the three geometry buffers again (`#update` in
`scene-pack.ts`).

### Tiles and the watchdog

Plan §3.1 item 1: a dispatch over two seconds loses the device on Windows. The renderer
dispatches the frame in tiles. `tile` says which pixels a dispatch covers. An invocation maps
`gid.x` to `(tile.x + gid.x % tile.z, tile.y + gid.x / tile.z)` and adds its samples to
`accum[py * frame.x + px]`. One pixel is one invocation in one dispatch, so the accumulation
stays free of atomics and the order of a pixel's samples stays fixed (record 0005).

`PathTracerParameters` gains `watchdogBudget` (milliseconds, default 50). The renderer sizes the
tile so that `tile pixels x the frame's samples x the last frame's nanoseconds per path` stays
under the budget (`tileFrame` in `tiles.ts`). The last frame's nanoseconds per path is its
`frameTime` over the paths it traced. A frame is still one `rt.frame()` and one `submit()`. The
dispatches inside it are as many as the tiles.

**What `info` holds.** `info` holds `frameTime` (the last frame's time in milliseconds),
`pathsPerSecond` and `frames` (the count of frames traced). It also holds `dispatches` (the last
frame's count of tiles), `tilePixels` (the pixels of the last frame's largest tile) and
`dispatchTime`. `dispatchTime` is
`frameTime` over `dispatches`, a mean. It is not the measured time of one dispatch. The runtime
submits the dispatches of a frame together and reports no time for one (record 0006, item 5).

**The first frame and the smallest tile.** The nominal tile is the pixel count that `tileFrame`
computes from the budget, before it forms rows. Decision 9 sets the smallest nominal tile at 4,096
pixels. The rules below follow it.

1. The first frame, which the renderer traces before it measures a speed, takes one sample. Its
   nominal tile is 4,096 pixels.
2. The nominal tile of any frame is never under 4,096 pixels.
3. A tile is whole rows when a row fits in it, and part of one row when it does not. A tile that
   whole rows or the frame's edge make smaller may hold fewer pixels than the nominal tile.
4. A tile of the smallest size may pass the budget at the last measured speed and the frame's
   samples. The tile then keeps its size, and the dispatch passes the budget.

At `main` 6ad088d, `tileFrame` follows rule 3, and the first frame already takes one sample. It
does not follow the size of 4,096 pixels in rules 1, 2 and 4. When `nsPerPath` is undefined,
`tileFrame` makes one tile of the whole frame, cut to `MAX_TILE_PIXELS` (4,194,240 pixels). A 4K
frame (3840 by 2160, 8,294,400 pixels) then takes 2 tiles. The smallest tile is `WORKGROUP`, 64
pixels. A 4K frame at that size takes 129,600 dispatches.

A nominal tile of 4,096 pixels covers a 4K frame in 2,025 tiles (8,294,400 over 4,096). Whole
rows and edges change that count. At one sample, such a tile takes 50 ms or less at 81,920 paths a
second or more. It takes 2 s or less, the watchdog's limit, at 2,048 paths a second or more. These
numbers are arithmetic. No device gave them.

No measure of the host time of one dispatch exists. Inference: 2,025 dispatches take less host time
than 129,600 dispatches.

The tile rules do not change `samplesPerFrame`. Only `targetFrameTime` changes it, in `render` in
`PathTracer.ts`. With `targetFrameTime` set, `render` changes it after each full-resolution
frame. In `render`, `n` is the samples of the frame. The new `samplesPerFrame` is `n` times
`targetFrameTime` over the frame's time, rounded and kept from 1 to `maxSamplesPerFrame`. In the same
function, `maxSamples` caps `n` at the samples that remain. Without `targetFrameTime`,
`samplesPerFrame` stays as the author sets it.

Open question for the owner: a tile of 4,096 pixels may pass the budget. Does the renderer then
take fewer samples in that frame, down to 1? Two answers exist. First, the renderer lowers `n` for
that frame only, and `samplesPerFrame` keeps its value. Second, the renderer lowers
`samplesPerFrame` itself, as `targetFrameTime` does. With the second answer, the budget and
`targetFrameTime` both set `samplesPerFrame`, so the record must say which one wins. This
amendment does not decide it.

Owed: a later pull request with `Design: 0001` changes `tileFrame` and `tiles.test.ts` to these
rules. The tests "is one tile of the whole frame before any frame is measured" and "never makes a
tile smaller than a workgroup or larger than one dispatch" change with it.

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
scene. Nothing in the oracle knows the layout. It knows the pack.

## Why

- **Why seven buffers and vectors.** Section "What changes" gives the two runtime facts. The
  alternative, structs, reads better in the kernel and costs a `DataView` write per field per
  element on every upload. A kernel that reads `instances[i * 8 + 6]` through a named helper
  (`instanceBases(i)`) reads as well as a struct field.
- **Why triangles, and one analytic sphere.** The first text said "triangles only". A second
  primitive type in the leaves is a second intersection routine, a second surface routine and a
  branch in the hottest loop. The product viewer is glTF (plan §4), which is triangles. Fact: on
  2026-10-06 the owner decided that the engine gains an analytic sphere, after a survey of other
  renderers ("The analytic sphere"). The sphere is an instance with a flag, so it adds no branch
  to a loop that tests triangles and no second hierarchy. A coarse mirror ball is where a mesh
  shows its facets, and a sphere is the one shape the demos draw that a triangle cannot give.
  Mitsuba, pbrt and Embree keep it for the same reason. Quads stay triangles.
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
  edge of two triangles at some float inputs. The result is a lit speck on a closed mesh. Woop's
  test is a few more operations per triangle and no crack.
- **Why tiles now.** The watchdog is plan §3.1's first constraint and M1 ignores it: a 1080p
  frame at 64 samples is one dispatch. With a BVH each path costs more, and the first user on
  Windows with an integrated GPU loses the device.
- **Why the chance of a light follows its power.** A light of more power gives more of the
  image's light. A chance that follows the power picks it more often. Inference: the same chance
  for every light picks a small dim triangle as often as a large bright one, which adds noise.
  This record does not measure the difference.
- **Why a smallest tile.** Each dispatch has a cost on the host that this record has not
  measured. A tile of 64 pixels makes 129,600 dispatches on a 4K frame. A first tile of 4,096
  pixels takes 2 s or less, the watchdog's limit, at 2,048 paths a second or more: arithmetic, in
  "Tiles and the watchdog".

Alternatives considered and not taken:

- **A `texture_2d` as the geometry store**, as WebGL path tracers do. WebGPU has storage
  buffers. A texture costs a format and a fetch per field.
- **Absolute indices.** Simpler kernel, a rewrite of every BLAS after the moved one at every
  change. Rejected for the reason above.
- **A hand-written WGSL kernel.** Plan §3 and `CLAUDE.md`: GPU code is TypeShade. The surface
  has every construct the traversal needs: a `while` over a stack (§17), a fixed array (§18),
  `bitcast` (§44), a runtime-length array's `length` (§20).

## What it touches

- **Packages.** `packages/radiance/src/geometries/*` (BufferGeometry, the three tessellators),
  `src/accel/bvh.ts`, `src/renderers/scene-pack.ts`, `src/renderers/limits.ts`,
  `src/renderers/PathTracer.ts` (tiles, the new uniforms, the pack), `src/kernels/layout.shade.ts`,
  `src/kernels/intersect.shade.ts`, `src/kernels/trace.shade.ts`, `src/index.ts`.
  `packages/addons/src/loaders/GLTFLoader.ts`. Amendment 3 adds
  `src/geometries/AnalyticSphereGeometry.ts`, `src/kernels/layout.shade.ts` (`INSTANCE_SPHERE`
  and `instanceFlags`), `src/kernels/intersect.shade.ts` (`hitSphere`, `sphereSurfaceAt`,
  `sphereUv`, `Hit.q`), `src/renderers/scene-pack.ts` (the sphere's words, its box, the refusal of
  emission) and `packages/addons/src/scenes/SpheresScene.ts` and `CornellBox.ts`.
- **Removed.** `src/renderers/pack.ts`, `QuadGeometry` (renamed), the analytic branches of the
  kernel. `packScene`, `cameraUniforms`, `PackedScene` and `CameraUniforms` leave the public
  surface (record 0003).
- **Scripts.** `scripts/oracle.ts` (the pack), `scripts/gates.mjs` (the Cornell box gate's
  thresholds re-derived), `scripts/harness.mjs` (record 0002 restructures it).
- **Site.** The guide pages that show `QuadGeometry` and the scene-graph table on the front
  page. The examples. `docs/plan.md` §3.2 (triangles only, the buffer set) and §8 (the
  suballocation row points to record 0006 item 2).
- **Tests owed.** `bvh.test.ts` (above). `layout.test.ts` (the strides, the uniform block's
  byte offsets against the manifest's layout). `scene-pack.test.ts` (a change to one
  geometry re-writes three buffers and no other. A moved transform writes instances, nodes
  and lights. An unchanged scene writes nothing. The limit check throws with the sentence
  above). `intersect.test.ts`, next to the module it tests, holds the intersection tests on the
  oracle (a ray through a shared edge meets at least one of the two triangles. A transformed
  instance is hit where its matrix puts it). `kernels.test.ts` keeps the tests of the sampler, of
  `trace.shade.ts`, of the seven bindings and of the tiles. Amendment 3 owes the tests that steps
  6 and 7 list, and the scene test of step 8 and step 9.
- **Scripts and the site, from Amendment 3.** `scripts/scenes.ts`, `scripts/scenes.test.ts`,
  `scripts/gates.mjs` (`ORACLE`, and `ORACLE_SPHERES`), `scripts/gates/differential.mjs`
  (`SCENES`). The goldens and stills of the three examples that call `createCornellBox`:
  `cornell-box`, `determinism` and `scene-graph`. `site/examples/scene-graph.ts`, whose test
  `child.geometry instanceof SphereGeometry` no longer finds the Cornell box's spheres.
  `site/examples/geometries.ts`, `site/src/content/docs/guide/scene-graph.mdx` (its geometry
  table) and `docs/benchmarks.md`.
- **Other records.** Records 0002, 0003, 0004 and 0005 carry an amendment of the same date. Record
  0008 does not. Its cast throws a `TypeError` for a geometry that is not a `BufferGeometry`
  (record 0008, "What the cast skips"), so it throws for an analytic sphere until record 0008 is
  amended. Open: the amendment of record 0008 is owed before its step 1 starts. Record 0007
  needs none: the added kernel code uses `f32` arithmetic, `sqrt` and `normalize`, and no new
  binding.
- **Not touched.** `docs/plan.md`. Its section 3.2 says "triangles only" and the M6 row names the
  SDF. A plan change is its own pull request.

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
2. **The BVH builder and the layout module.** `src/accel/bvh.ts` and `bvh.test.ts`.
   `src/kernels/layout.shade.ts` with the strides and the decoders (`nodeBounds(i)`,
   `nodeWords(i)`, `vertexPosition(base, i)`, `instanceBases(i)`, `instanceToObject(i, p)`,
   `instanceToWorld(i, v)`). `layout.test.ts`. No renderer change yet. Done when the builder's
   tests pass and `tshc check` accepts the module.
3. **The kernel on the new layout.** `intersect.shade.ts`, the new `TraceParams`, `trace.shade.ts`
   over triangles, instances and the light table. `scene-pack.ts`, `limits.ts`. `PathTracer`
   on the pack, with tiles. `oracle.ts` on the pack. `pack.ts` and the analytic branches are
   removed. The Cornell box gate runs on tessellated spheres with thresholds re-derived
   (record 0002, step 2). Done when `bun run harness` passes with the new numbers recorded in
   the pull request, and `scene-pack.test.ts` passes.
4. **The glTF loader.** `GLTFLoader` in addons: `.gltf` and `.glb`, the node tree as `Object3D`s,
   each primitive a `Mesh` with a `BufferGeometry` and a `PhysicalMaterial` (record 0004) from
   `pbrMetallicRoughness`'s factors (textures wait for M3). The Stanford bunny renders
   (M2's acceptance), and the build time of its BVH is recorded in the pull request. Done when
   the `bunny` example and its gate (record 0002) pass.
5. **Sponza.** Part of Sponza renders (M2's acceptance). The benchmark row is recorded
   (record 0002, the benchmark). Done when the gate and the benchmark script run.
6. **The host class** (Amendment 3). Add `AnalyticSphereGeometry` in `src/geometries/` and export it
   from `src/index.ts`. Run `bun run bake:api-surface`. The pack still refuses the class, with
   the `TypeError` it throws now for a geometry that is not a `BufferGeometry`. Tests:
   - `geometries.test.ts`: `new AnalyticSphereGeometry().radius` is 1, and
     `new AnalyticSphereGeometry(0.5).radius` is 0.5. The constructor throws a `RangeError` for
     0, -1, `NaN` and `Infinity`: four cases.
   - `scene-pack.test.ts`: a mesh that holds one makes `update` throw a `TypeError` whose message
     names `AnalyticSphereGeometry`.

   Done when `bun run check` passes and `gate:api` shows one added class and no other line
   changed. The commit names `Design: 0001` and `Design: 0003`.

7. **The kernel and the pack** (Amendment 3). In `layout.shade.ts`, add `INSTANCE_SPHERE` (1)
   and `instanceFlags(i)`. In `intersect.shade.ts`, add `hitSphere`, `sphereSurfaceAt`, `sphereUv`
   and `Hit.q`. Branch `nearest`, `occluded` and `surface` on the flag. In `scene-pack.ts`, write
   the sphere's instance words and its box, skip it in the light table, and refuse an emissive
   one. Tests, each with its number:
   - `layout.test.ts`: `INSTANCE_SPHERE` is 1, and the strides do not change.
   - `scene-pack.test.ts`: one sphere with centre (1, 2, 3) and radius 2 gives these counts:
     1 instance, 1 node, 0 triangles, 0 vertices and 0 lights. Its matrix rows are
     `[2, 0, 0, 1]`, `[0, 2, 0, 2]` and `[0, 0, 2, 3]`. Its inverse rows are
     `[0.5, 0, 0, -0.5]`, `[0, 0.5, 0, -1]` and `[0, 0, 0.5, -1.5]`. Its `flags` bits are 1 and
     its `geometryId` bits are `0xffffffff`. Its node box is (-1, 0, 1) to (3, 4, 5), widened by
     at most 1e-6 on each side. A scene with the same mesh moved by 0.1 writes `instances` and
     `nodes`, and `pack.arrays.triangles` is the same array object. A sphere with an emissive
     material makes `update` throw the `TypeError` of "The analytic sphere". Two instances of a
     non-uniform scale (1, 2, 3) under a turn have the ellipsoid's exact box: the length of each
     row of the 3 by 3 part.
   - `intersect.test.ts`, on the oracle. First, 100,000 random rays of the classes of the
     precision rule give a worst case of at most 16 units of `ulp(S)`, and `abs(length(q) - 1)`
     of at most 4e-7. Second, 256 by 256 rays through the plane at unit distance, over the square
     from -0.2 to 0.2, from an eye 3.4 from a sphere of radius 0.4, hit 18,072 times within 0.5 %
     of 18,060 (the area of the silhouette, in cells). Third, the probe of the instrument: the
     same rays at radius 0.404 count 18,440 in `f64`, 2.1 % above 18,060, so the tolerance
     rejects a radius 1 % too large. Fourth, `occluded` agrees with `nearest` on 10,000 rays.
     Fifth, 100,000 rays from a point 1e-4 outside the sphere, away from it, hit it 0 times.
     Sixth, an ellipsoid (scale (1, 2, 3), turned 0.5 rad about y) gives `t` within the rule of
     the `f64` ellipsoid on 10,000 rays. `ng` and `ns` are bit for bit equal. `ng` is
     perpendicular to `dpdu` within 1e-6. A mirrored instance (scale (-1, 1, 1)) keeps `ng`
     pointing out. A ray from the centre meets the far side and reports `front` false. Seventh,
     `sphereUv` against `atan2` and `acos` in `f64` at 100,000 points: `u` within 2e-7 (a
     throwaway script measured 8.9e-8) and `v` within 2e-7 (it measured 1.2e-7). `u` is compared
     on the circle, because 0 and 1 are one point. Eighth, a scene of one sphere and one mesh box
     gives the nearer of the two on 1,000 rays, as a brute force in `f64` does.
   - `materials.test.ts`: a mirror sample taken at the hit of 100,000 primary rays across the
     silhouette of a sphere never has `dot(wi, ng)` of 0 or less: 0 of 100,000. Record 0004
     measured 0.416 % of the area of a mesh sphere under `ng` before its fold.
   - `determinism.test.ts`: it passes with `ALLOWED` and `VALUE_ONLY` unchanged. The report has 0
     rows outside the lists. The row `sqrt` names `hitSphere` among its functions (record 0005).

   Done when these numbers hold and `bun run check` passes. No example uses a sphere yet, so the
   render gate passes with no golden changed. The differential gate passes on its four scenes
   with `ORACLE` unchanged. The pull request records the `bench` rows of `cornell` before and
   after, on SwiftShader. The change adds one `vec4` read for each TLAS leaf instance.
   Inference: the frame time moves by under 5 %. The rows are recorded and not held. The commit
   names `Design: 0001`, `Design: 0004` and `Design: 0005`.

8. **The `spheres` scene** (Amendment 3, record 0002). Add `createSpheresScene` in
   `packages/addons/src/scenes/SpheresScene.ts`, an entry in `scripts/scenes.ts` and in `SCENES`
   in `differential.mjs`, and `ORACLE_SPHERES` in `scripts/gates.mjs`. The scene has these
   instances: a floor that is a sphere of radius 1000 with its top at y = 0, a mirror ball of
   radius 0.5, a diffuse ellipsoid (scale (1, 1.6, 0.8), turned), a diffuse ball mirrored by a
   scale of (-1, 1, 1), a back wall of two triangles and a lamp of two triangles. `scenes.test.ts`
   holds these counts: 6 instances, 4 triangles, 8 vertices, 2 lights. `ORACLE_SPHERES` follows
   record 0002's rule: ten times the measured mean, rounded up, with `abs` and `rel` at M1's.
   Done when the differential gate and the determinism gate pass on the scene. The determinism
   gate shows 0 differing floats for one seed. The oracle renders the scene in under 3 minutes.
   The pull request records the measured mean and the largest difference. The commit names
   `Design: 0001` and `Design: 0002`.
9. **The Cornell box on analytic spheres** (Amendment 3, record 0002). In `CornellBox.ts`, make
   the mirror ball and the white ball `AnalyticSphereGeometry(0.4)`, and change the comment
   that says every shape is triangles. `scenes.test.ts` holds these counts for the box: 8
   instances, 4 triangles, 8 vertices, 2 lights and 7 nodes. The nodes are 2 for the two plane
   BLASes and 5 for the TLAS. The 5 is from a throwaway script on the exact ellipsoid boxes, and
   the sum is an inference until the test runs. Today the same scene counts 1,924 triangles, 1,130
   vertices and 1,093 nodes (Amendment 2). Re-derive `ORACLE.mean` by record 0002's rule. The pull
   request records the old value, the measured mean and the largest difference, and the new
   value. Rewrite the goldens with `UPDATE_GOLDENS=1 bun run gate:render`, and commit only the
   goldens that change. The candidates are `cornell-box`, `determinism` and `scene-graph`, the
   three examples that call `createCornellBox`. Show each old and new picture in the pull request.
   Recapture the stills of the same three with `bun run capture:stills`, and commit their
   `.sha256` files. Change the test in `site/examples/scene-graph.ts` so that it also removes a
   mesh whose geometry is an `AnalyticSphereGeometry`. Done when four things hold. The counts are
   as above. The differential gate passes on the new `ORACLE.mean`. The render gate passes on the
   committed goldens. The pull request shows a crop of the mirror ball at 768 pixels, before and
   after. It sets no number on the brightness of the rim, because the open front of the box also
   darkens a reflection there (inference). The count of record 0004 holds instead (step 7 of
   this record). The step starts after the scene pull request that holds the 64 by 32 sphere
   tessellation and the two-sided lamp has merged. If that pull request merges first, this step
   replaces its two sphere meshes and keeps its lamp. The commit names `Design: 0001`,
   `Design: 0002` and `Design: 0004`.
10. **The site and the docs** (Amendment 3). Add one `AnalyticSphereGeometry` to the `geometries`
    example, beside its mesh sphere, and label both in the panel. Add a row for
    `AnalyticSphereGeometry(radius)` to the geometry table of `scene-graph.mdx`. Name the cost of
    each sphere in one sentence of the guide. Append a `cornell` row to `docs/benchmarks.md` for
    the analytic box. Rewrite the golden and the still of `geometries` only. Done when
    `gate:site`, `gate:api` and `gate:render` pass, and the `geometries` golden differs from the
    old one only where the added sphere is. The pull request shows both pictures. A plan change
    stays out: `docs/plan.md` (section 3.2 and the M6 row) is its own pull request. The commit
    names `Design: 0001`.

M2a (animation) and M3 (the reserved fields) are later records that build on this layout. This
record is implemented at step 10.

## Decisions for the owner

1. Triangles, and one analytic primitive, the sphere (decision 10). M1's quad leaves the kernel for
   good. M1's sphere left at step 3, and Amendment 3 brings it back in a new form. The Cornell box
   gate was re-derived on tessellated spheres at step 3, and step 9 re-derives it on analytic
   spheres.
2. Seven storage buffers in the path tracer's pipeline, with the layouts above, held through
   M3. A change to a layout is an amendment to this record.
3. Vertices carry a position, a normal and a uv in two `vec4`. Tangents are derived at the hit
   (record 0004), not stored.
4. Indices inside a BLAS are relative to the BLAS.
5. A geometry change writes the three geometry buffers whole until the compiler gives the
   runtime a partial write.
6. Tiling with a `watchdogBudget` of 50 ms by default.
7. `QuadGeometry` is renamed `PlaneGeometry`, and `BoxGeometry` is added, for three.js parity
   (record 0003 decides names, this record depends on it).
8. A light's chance is its share of the emitted power. A light's power is its area in world
   space times the mean of its emissive colour. Its chance is its power over the sum of the power
   of every light ("The GPU layout", the light table). Amendment 2 adds this decision.
9. The first frame, traced before the renderer measures a speed, takes one sample. The smallest
   nominal tile is 4,096 pixels ("Tiles and the watchdog"). Amendment 2 adds this decision.
10. An analytic sphere is an instance whose `flags` bit 0 is set. Its object space is the unit sphere, and its matrix holds the centre and the radius. A non-uniform scale gives an ellipsoid and the kernel does not refuse it. The BVH holds it as a TLAS leaf, with no node in a BLAS ("The analytic sphere"). Decided by default. Amendment 3 adds this decision.
11. The host class is `AnalyticSphereGeometry(radius = 1)` on a `Mesh`, with a `readonly` radius. It is not a flag on `SphereGeometry` and not an object of its own. Decided by default. Amendment 3 adds this decision.
12. A sphere whose material emits is refused with a `TypeError` until M3's analytic lights bring a sphere type to the light table. Decided by default. Amendment 3 adds this decision.
13. The intersection is the form of "The ray and the sphere", under the precision rule of that section. The implementing step measures the kernel and amends the rule when a measure passes a bound. Decided by default. Amendment 3 adds this decision.
14. The Cornell box uses two analytic spheres. The `geometries` example keeps its mesh sphere, and it gains one analytic sphere beside it. The first part is the owner's decision of 2026-10-06. The second part is decided by default. Amendment 3 adds this decision.

## Record

**Amendment 1** (2026-10-05, UTC). Steps 1 and 2 (pull requests to follow) found four places
where the record contradicted itself or left a step-3 contract unstated, and the branches follow
the byte contract. The `uv` comment follows three.js's layout, as the tessellators do. The node
order says that each child pair follows its parent. The traversal says that the farther child is
pushed first. A TLAS leaf holds up to 4 instances, and `a` is a slot in the TLAS's leaf order
that the packer makes the index into `instances`.

**Amendment 2** (2026-10-06, UTC). Step 3 is on `main` as 9f2cf1a (typeshade/radiance#18). Its
pull request listed deviations from this record. This record's own list, "Deviations of step 3"
below, listed more. Most rules below were in the code and not in the record. This amendment
states each one in the section it belongs to. Where the code has no rule, it states one as the
record's new text.

The merge of the pull request that carries this amendment is the owner's acceptance of every
disposition. "Made part of the record" means that the section named states the rule as the code at
`main` 6ad088d has it. "The record's new text" means that the section states a rule that the code
at `main` 6ad088d does not follow. The merge accepts the rule, and a later pull request makes the
code follow it. The numbers: `ScenePack.counts` of `createCornellBox()` at `main` 6ad088d holds 8
instances, 1,924 triangles, 1,130 vertices, 1,093 nodes (5 of them the TLAS) and 2 lights.
`render` in `PathTracer.ts` and `scripts/oracle.ts` call `scene.updateMatrixWorld()` before
`ScenePack.update`, and these counts follow that call. The measurement ran on 2026-10-06 with the
pin 596c805 and bun 1.3.14. A pack built without that call has every instance at the identity
matrix. It holds 1,091 nodes, 3 of them the TLAS. A 4K frame takes 2 tiles in its first frame and
129,600 tiles at the smallest tile.

1. **TLAS leaves.** Made part of the record. "The build" states how the TLAS splits a node of
   more than 4 instances (`buildTlas` and `build` in `bvh.ts`).
2. **The triangle index of a hit and of a light.** Made part of the record. "The GPU layout"
   states that `Hit.triangle` and `bits(triangle)` are absolute indices into `triangles`. Decision 4
   stands.
3. **A light's chance.** Made part of the record, with decision 8 for the owner. "The GPU layout"
   states the light table (`#lightTable` in `scene-pack.ts`). A light's chance is its power over
   the sum of the power of every light. The rows are in slot order then triangle order, and no
   triangle of area 0 is a light.
4. **The outward normal in world space.** Made part of the record. "Traversal" states that the
   kernel moves the cross product to world space by the inverse transposed (`surfaceAt` in
   `intersect.shade.ts`).
5. **Double-sided emission.** Made part of the record. "Traversal" names bit 9 of the type and
   flags word (`MATERIAL_DOUBLE_SIDED` and `emission` in `materials.shade.ts`). Record 0004 defines
   the bit.
6. **The surface of a point on a light.** Made part of the record. "Traversal" names `surfaceAt`
   beside `surface`, and the call in `direct` (`trace.shade.ts`).
7. **The slab test's edge cases.** Made part of the record. "Traversal" states that `inv` takes a
   component of the direction below 1e-20 as +1e-20, and that the ray keeps the direction. It also
   states the factor 1.0000004 on the far distance (`TINY` and `SLAB_SLACK` in
   `intersect.shade.ts`).
8. **The first frame and the count of tiles.** The record's new text, accepted by the merge.
   "Tiles and the watchdog" states rules 1 to 4, and decision 9 holds the number. The first frame
   takes one sample in nominal tiles of 4,096 pixels, and no nominal tile is smaller. The code does
   not follow them yet. `tileFrame` in `tiles.ts` and `tiles.test.ts` must follow them in a later
   pull request with `Design: 0001`. The old text said that the first frame takes one tile of the
   whole frame. That is true only for a frame of 4,194,240 pixels or fewer. Open: when a tile of
   4,096 pixels passes the budget, does the renderer take fewer samples in that frame, down to 1?
   No rule answers it yet. The answer must say how it fits `targetFrameTime`, which already
   changes `samplesPerFrame` in `render` (`PathTracer.ts`).
9. **The time of a dispatch.** Made part of the record. "Tiles and the watchdog" states what
   `info` holds, and that `dispatchTime` is `frameTime` over `dispatches` (`PathTracer.ts`). A
   measured time for each dispatch waits on record 0006, item 5.
10. **The file of the intersection tests.** Made part of the record. "What it touches" names
    `intersect.test.ts`. The same sentence said that a ray through a shared edge hits exactly one
    triangle. The test holds "at least one", because a ray that meets the edge where an edge
    function is exactly 0 meets both. The sentence now says "at least one".
11. **An emptied geometry.** Closed at 7b4494f, a commit of the pull request's branch. "Change
    tracking and upload" now states the rule that the fix made.

This amendment also changes two entries below. "Deviations of step 3" names a disposition for each
open entry. "Configuration and validation record" names the merged pull request of step 3.

**Amendment 3** (2026-10-06, UTC). The owner decided on 2026-10-06, after a survey of other
renderers, that the engine gains an analytic sphere primitive. This record said "triangles only"
(decision 1). This amendment adds the primitive. It settles how the sphere is stored, held by the
BVH, intersected, packed, tracked and bounded. It changes these places:

1. The title and `touches`.
2. "After": one paragraph that points to the new section.
3. "The host model": the bullet that said "Triangles only".
4. "The GPU layout": the `instances` row, which gives bit 0 of `flags` a meaning.
5. "Traversal": the two-level traversal and the hit.
6. A new section, "The analytic sphere".
7. "Why": the bullet "Why triangles only".
8. "What it touches".
9. Steps 6 to 10, and the closing sentence of the steps.
10. Decision 1, and decisions 10 to 14.

The merge of the pull request that carries it is the owner's acceptance of the primitive and of
each decision marked "decided by default". Records 0002, 0003, 0004 and 0005 carry amendments
of the same date for their own parts. The pull requests of steps 6 to 10 merge after it, each with
`Design: 0001`. The numbers of the amendments follow `main` at 55bde46. A pull request that merges
first and adds an amendment moves these numbers.

The configuration is `main` at 55bde46, the compiler pinned at 596c805, bun 1.3.14 and node
v22.22.0, on 2026-10-06. The measures below come from throwaway scripts in a scratch directory.
This pull request does not keep them, and no test holds them. Each one is an observed result:

- **The precision of the form.** A script rounded every operation of "The ray and the sphere" to
  `f32`, fused none, and compared the result with the same formula in `f64` on the same inputs.
  The worst case was 9.68 units of `ulp(S)` over 1,200,000 rays whose impact parameter was at
  most 0.999. The textbook form measured 13,711. Near the silhouette (an impact parameter within
  1e-4 of 1), the form missed 127 of 190,366 hits and reported 131 false hits. The worst
  `abs(length(q) - 1)` was 1.54e-7. A ray from 1e-4 outside the sphere, away from it, hit it 0
  times in 200,000.
- **The uv.** A script built `sphereUv` of record 0004 from `+`, `-`, `*`, `/` and `sqrt`, with
  every operation rounded to `f32`. Against `atan2` and `acos` in `f64` at 300,000 points, the
  worst angle error was 3.81e-7 rad. The worst error of `u` was 8.93e-8 and of `v` was 1.23e-7.
- **The silhouette.** In `f64`, 256 by 256 rays over the square from -0.2 to 0.2 at unit distance,
  from 3.4 from a sphere of radius 0.4, hit 18,072 times. The area of the silhouette is 18,060
  cells. A radius of 0.404 gave 18,440 and a radius of 0.396 gave 17,708.
- **The fold.** A script took 4,000,000 points spread evenly over the disc that a sphere covers
  from far away. Each point gave one mirror reflection about `ng`, in `f32`. It gave 0 reflections
  with `dot(wi, ng)` of 0 or less.
- **The box counts.** `ScenePack.counts` of the Cornell box at 55bde46 is as Amendment 2 states:
  1,924 triangles, 1,130 vertices and 1,093 nodes. A script built the TLAS over the same eight
  boxes, with the spheres' boxes exact. It gave 5 nodes, the same as the mesh boxes give.

Two inferences follow. First, the differential gate cannot see a wrong radius in the packer or a
wrong term in the formula, because the GPU and the oracle read one pack and run one formula.
Second, one sphere costs 128 bytes, so 1,048,576 spheres fill the instance limit exactly. The
dispositions:

- **The primitive.** Decided by default: an analytic sphere, intersected by the quadratic, with
  `ng = ns`. A mesh sphere stays. Decisions 1 and 10 hold it.
- **How it is stored and held.** Decided by default: one instance with `flags` bit 0, the unit
  sphere in object space, centre and radius in the matrix, a TLAS leaf for the BVH, and no
  node, triangle or vertex. "The analytic sphere" gives the three options and their costs. Decision
  10 holds it.
- **A non-uniform scale.** Decided by default: not refused. The kernel moves the ray to object
  space and intersects the unit sphere. The result is an ellipsoid.
- **The host model.** Decided by default: `AnalyticSphereGeometry(radius = 1)` on a `Mesh`.
  Record 0003 lists the export. Decision 11 holds it.
- **Emission.** Decided by default: refused with a `TypeError` until M3's analytic lights.
  Decision 12 holds it.
- **The precision rule.** Proposed numbers: 16 units of `ulp(S)` and 4e-7. They are measured on
  an emulation and not on the kernel. Step 7 measures the kernel, and amends the rule when a
  measure passes a bound. Decision 13 holds it.
- **The `geometries` example.** Decided by default: it keeps its mesh sphere and gains one
  analytic sphere. The owner may drop the second part. Decision 14 holds it.
- **Open: record 0008.** The cast of record 0008 throws a `TypeError` for an analytic sphere.
  Next action: an amendment of record 0008, before its step 1 starts, that adds the sphere test
  in `f64` and a parity test with the kernel.
- **Open: `docs/plan.md`.** Section 3.2 says "triangles only", and the M6 row names the SDF. This
  amendment does not touch the plan. Next action: a plan pull request, which waits for the owner's
  "merge".
- **Open: the scene pull request.** The pull request that holds the 64 by 32 tessellation and the
  two-sided lamp changes the spheres that step 9 replaces. Next action: step 9 starts after it
  merges, or replaces its sphere meshes.

**Approval and plan record.** Accepted on 2026-10-05 (UTC). The owner approved the merge of typeshade/radiance#6 in the conversation, which merged this record as `draft` at 9e8b479. The owner then said to implement the records with Opus 5.5 and Sonnet 5.5, and that go-ahead is the acceptance. Every entry of "Decisions for the owner" stands as proposed.

**Deviations of step 3** (2026-10-05, UTC). Step 3 is on `main` as 9f2cf1a
(typeshade/radiance#18). Each entry gives a difference between the record before Amendment 2 and
the code, and its disposition. Amendment 2 (2026-10-06, UTC) gives a disposition to each entry
that was open.

- **TLAS leaves.** The builder made one TLAS leaf of any size when no split beat the leaf's
  cost. The Cornell box's TLAS was one leaf of 8 instances, against Amendment 1. Closed at
  0c3c0aa: `buildTlas` splits every node of more than 4 instances. The record does not say how.
  The builder takes the least-cost split while the larger side can reach leaves of 4 by depth
  30, else the median of the centroids. Made part of the record by Amendment 2, item 1.
- **An emptied geometry.** A geometry whose index was set to an empty array kept its old BLAS,
  and its mesh still drew the old triangles. Closed at 7b4494f: the geometry leaves the pack, as
  `release()` makes it, and the update writes the buffers again. Amendment 2, item 11, states
  the rule.
- **The triangle index of a hit and of a light.** `Hit.triangle` is the index into `triangles`,
  with the instance's `primBase` added. The light table's `bits(triangle)` is the same index.
  The record names both fields and does not say relative or absolute. Decision 0001.2 makes a
  layout change an amendment. Made part of the record by Amendment 2, item 2.
- **A light's chance.** The record says that `cdf` is the cumulative probability of a light, and
  not what the probability follows. A light's power is its world-space area times the mean of
  its emitted colour. Its chance is its power over the sum of the power of every light. The table
  is in slot order, then in triangle order, and holds no triangle of area 0. Made part of the record by Amendment 2,
  item 3.
- **The outward normal in world space.** The record gives `normalize(cross(e1, e2))` and does
  not say in which space. The kernel moves the cross product to world space by the inverse
  transposed, as it moves the shading normal. A mirrored instance then keeps its outside. Made
  part of the record by Amendment 2, item 4.
- **Double-sided emission.** "Traversal" says that emission leaves the front face only, as M1's
  quads do. `emission` also lets a material emit from its back face when the "double sided" bit
  of record 0004 is set. Made part of the record by Amendment 2, item 5.
- **The surface of a point on a light.** `intersect.shade.ts` exports
  `surfaceAt(instance, triangle, b1, b2, dir)`. `surface(hit, dir)` calls it, and next-event
  estimation calls it for the point it samples on a light. The record names `surface` alone.
  Made part of the record by Amendment 2, item 6.
- **The slab test's edge cases.** `inv` takes a component of the direction whose absolute value is
  below 1e-20 as +1e-20, so no infinity enters the test. The ray keeps the direction. The far
  distance is multiplied by 1.0000004, so the rounding of a box culls no hit on its face. The record says neither. Made
  part of the record by Amendment 2, item 7.
- **The first frame.** The first frame traces one sample over one tile of the whole frame, as
  "Tiles and the watchdog" says. No speed is known before it, so the budget does not size that
  tile. Inference: on a slow device, that first dispatch can pass the watchdog. Amendment 2, item
  8, states a new rule, and the merge accepts it. The code does not follow it yet.
- **The time of a dispatch.** The record says that the renderer records the time of every
  dispatch in `info`. The runtime submits the dispatches of a frame together and gives no time
  for one. `info.dispatchTime` is the frame's time over its dispatches, a mean. Made part of the
  record by Amendment 2, item 9. A time for each dispatch needs a timer in the runtime.
- **The count of tiles.** No limit holds the count of tiles. Tiles of 64 pixels make 129,600
  tiles on a 4K frame, each one dispatch. Inference: a slow device at many samples a frame issues
  that many dispatches a frame. Amendment 2, item 8, states a new rule, and the merge accepts it.
  The code does not follow it yet.
- **The file of the intersection tests.** "What it touches" names `kernels.test.ts` for the
  intersection tests on the oracle. They are in `src/kernels/intersect.test.ts`, next to the
  module they test. Made part of the record by Amendment 2, item 10.

**Configuration and validation record.** Steps 1 and 2 are delivered, at the compiler pin
e923a34. Step 1 is d9b4d2f (typeshade/radiance#9) and step 2 is a1ea798 (typeshade/radiance#10),
both on `main`. Step 3 is delivered as 9f2cf1a (typeshade/radiance#18), on `main`. The pin of
9f2cf1a is fd39ba3, because typeshade/radiance#22 (632c661) moved the pin before #18 merged. The
branch of step 3 was verified at 23cbc51, on `main` bc99533, with the pin e923a34, as the
Verification of #18 says. The gate numbers below come from that run on the branch.
At step 3, the Cornell box gate of record 0002 runs on spheres of 960 triangles. On SwiftShader,
at 16 by 16 pixels and 1,024 samples, the mean relative difference to the oracle is 3.27e-7.
The largest is 2.86e-6. `ORACLE.mean` is 3.3e-6, ten times the mean, rounded up, and `abs` and
`rel` stay 1e-3 and 5 %. Steps 4 and 5 are not started. Steps 6 to 10 (Amendment 3) are not started.
