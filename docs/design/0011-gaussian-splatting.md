---
id: '0011'
title: Photos or a video become a relightable 2DGS scene, trained by inverse rendering on the compiler's reverse-mode grad and path-traced beside meshes
status: draft
milestones: []
touches:
  - packages/radiance/src/kernels/splat.shade.ts
  - packages/radiance/src/kernels/intersect.shade.ts
  - packages/radiance/src/kernels/layout.shade.ts
  - packages/radiance/src/kernels/trace.shade.ts
  - packages/radiance/src/kernels/determinism-lists.ts
  - packages/radiance/src/geometries
  - packages/radiance/src/objects
  - packages/radiance/src/accel/bvh.ts
  - packages/radiance/src/renderers/scene-pack.ts
  - packages/radiance/src/index.ts
  - packages/radiance/__api__
  - packages/addons/src/loaders
  - packages/addons/src/exporters
  - packages/addons/src/scenes
  - packages/addons/__api__
  - packages/capture
  - scripts/gates.mjs
  - scripts/gates
  - scripts/probes
  - scripts/harness-entry.ts
  - scripts/oracle.ts
  - scripts/scenes.ts
  - scripts/boundary.mjs
  - scripts/__goldens__
  - site/examples
  - site/src/content/docs
  - docs/benchmarks.md
  - docs/design/0001-scene-data-model.md
  - docs/design/0002-verification.md
  - docs/design/0003-public-api.md
  - docs/design/0004-materials-and-shading.md
  - docs/design/0005-determinism.md
  - docs/design/0006-compiler-boundary.md
  - docs/design/0007-webgl2-tier.md
  - docs/design/0008-interaction-controls.md
  - docs/plan.md
compiler: ['0006-1', '0006-5']
---

**Document control**

| Field         | Value                                                                                                                                                                                                                             |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity      | Design record 0011, status `draft`, revision 2. Six parts, 38 decisions, 9 amendments owed (A to I), 8 compiler needs (C1 to C8) and one watch item. Branch `claude/record-0011-gaussians`                                        |
| Date          | 2026-10-09 (UTC), the date of authorship and of revision 2. Revision 2 answers the owner's direction of the same day and the review of the pull request. "What changes" quotes the direction                                      |
| Author        | Written in an agent session for the owner. The owner's review is the approval                                                                                                                                                     |
| Applicability | The kernels and the host of `@typeshade/radiance`. The loaders and exporters of `@typeshade/radiance-addons`. A new package `@typeshade/radiance-capture`. The gates in `scripts/`. Eight needs of the compiler                   |
| Baseline      | `main` at 265f89d, merged into the branch. The compiler pinned at 596c805. Every line number below is a line of 265f89d. Revision 1 named a0106e0. The real merge base of revision 1 was 4c94329                                  |
| Source        | The survey `.claude/research/survey-gaussian-splatting.md`, revised in the same pull request. Every claim about a paper, a model, a licence, a format or a browser rests on it, with its URL. Item numbers below are the survey's |
| Pull request  | typeshade/radiance#67 carries this record and its survey. It is the review                                                                                                                                                        |

## What changes

The owner asked on 2026-10-09 for a plan for 2D and 3D Gaussian splatting. Three owner directions of the same day set the scope:

1. **Training is in.** A user gives a video or several photos, and the system produces a 3D scene through 2D Gaussian splatting (2DGS).
2. **Gradients come from the compiler.** TypeShade is to support forward and reverse mode `grad` officially. The training's gradients come from the compiler's reverse mode, not from hand-written backward kernels.
3. **Fallback tiers.** Training and rendering run on WebGPU first. WebGL2 (the compiler's change 0054) and the CPU are fallbacks. A fallback may be slow, and it is better than a failure.

A fourth direction followed on the same day: "A half-way implementation is meaningless. If we do it, do it properly." The product goal follows. A user uploads a video or photos. The user gets a 3D scene that lives inside radiance's physically based path tracer. So revision 2 sets these targets:

- **The target is a relightable surfel.** Each trained surfel carries the material words of record 0010's principled BSDF and its own normal. A ray that meets it gets a surface. The surface goes through `sampleBsdf` and next-event estimation as a mesh's surface does.
- **Training is inverse rendering.** It recovers the geometry, the materials, an environment and the camera poses together. Baked radiance is an interim stage, the fallback, and the mode of imported 3DGS assets.
- **Each reduced scope has a path to the full result.** Its milestone and its gate are named. This holds for the poses, the capacity, the CPU budget and the mesh export.

This record writes the whole pipeline as six parts. Each part has its own steps and gates, so an agent can implement it alone. The order of the parts is the order of decision 3.

### The pipeline

| Stage and part | Input                                 | Output                                                                                                                               | Runs on                                                                               | Compiler work it needs                        |
| -------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | --------------------------------------------- |
| Part 1. Render | A `SplatGeometry` (trained or loaded) | Physical surfels that the scene's lights and meshes light and shadow. Baked splats for assets without materials                      | The path tracer's tiers (record 0007 for WebGL2)                                      | None at the pin. A probe of `unpack2x16float` |
| Part 2. Ingest | A video file, or a set of photos      | 100 to 300 sharp frames, downscaled, with EXIF intrinsics where known                                                                | The browser (WebCodecs), the M7 host                                                  | None                                          |
| Part 3. Poses  | The frames and the known intrinsics   | A `CaptureDataset`: intrinsics, a pose for each frame, sparse points                                                                 | A server or the M7 host first (P1). The browser at M5p (P2). Refined in training (P3) | None for P1. C1 for P3                        |
| Part 4. Train  | A `CaptureDataset`                    | Surfels with geometry, baked radiance and materials, an `Environment`, refined poses                                                 | WebGPU first, WebGL2 and the CPU as fallbacks                                         | C1 to C8 (below)                              |
| Part 5. Output | The trained result                    | A `Splats` in the scene, a `.ply`, a glTF of splats, and a glTF mesh with baked base-colour, roughness-metalness and normal textures | Every tier                                                                            | None beyond part 4's                          |
| Part 6. Scale  | A scene of 0.2 to 6 million Gaussians | The same pipeline at the scene's size: limits, compact training state, level of detail, paging                                       | WebGPU with raised limits, the M7 host                                                | C5. C4 for speed                              |

**The chosen primitive is the 2D surfel.** A surfel is a flat Gaussian disk with a normal. The training rasterizer (part 4) and the path tracer (part 1) meet it with one formula, the ray-plane test of 2DGS (survey item 2). Its normal is the shading normal of its BSDF. 3D Gaussians (3DGS) stay as a second kind, for imported assets only, with baked radiance.

### Before

These are facts, read at `main` 265f89d and the pin 596c805.

- **No splat.** No file in the tree names a Gaussian splat, except the Gaussian pixel filter that record 0009 (part 3) rejects.
- **The primitives.** Record 0001 states two: the triangle, in a BLAS, and the analytic sphere, a TLAS instance with `flags` bit 0 (Amendment 3). The code has both since fd1c0ce (#66). `packages/radiance/src/objects` holds `Mesh.ts` alone.
- **The walk.** `nearest(origin, dir, limit)` in `intersect.shade.ts` (lines 245 to 327) walks the TLAS and each BLAS. It tests a sphere instance by `INSTANCE_SPHERE` (line 280). `occluded` (lines 331 to 405) is the same walk and stops at the first hit. `Hit` (lines 69 to 83) is `{ t, instance, triangle, b1, b2, q }`.
- **The path.** `radiance` in `trace.shade.ts` (lines 146 to 190) adds a hit's emission only on the camera ray or after a specular bounce. Next-event estimation runs at a bounce whose sample is not specular. Record 0010 part 1 replaces this with multiple importance sampling (MIS).
- **The surface.** `Surface` in `materials.shade.ts` (lines 69 to 83) holds `p`, `ng`, `ns`, `uv`, `dpdu`, `material` and `front`. Record 0010 (its amendment of record 0004, "The shading contract") adds `pb` and the tints `baseTint`, `mrTint`, `emissiveTint` and `normalTint`. They are 1 until a texture is read.
- **The buffers.** `trace` binds seven storage buffers (record 0001, rule 1). `vertices` is `array<vec4>`, `triangles` is `array<vec4u>`. An instance's word `[6]` is `(bits(nodeBase), bits(primBase), bits(vertexBase), bits(material))`. Its word `[7]` is `(bits(flags), bits(geometryId), 0, 0)` (`layout.shade.ts`, lines 43 to 46).
- **`grad`.** The compiler's `grad(m, fn, param)` is forward mode, a few parameters a call. It passes `if` and constant-bounded `for`, not a runtime-length `while` (plan section 3.1, item 2). The compiler's roadmap lists "Reverse-mode `grad`" after 1.0. It "needs the tape and the memory rules a design issue has to settle" (`vendor/typeshade/docs/roadmap.md`, line 295).
- **Atomics.** The compiler lowers WGSL atomics (`vendor/typeshade/src/compiler/ts/lower/atomics.ts`). WGSL has `atomic<u32>` and `atomic<i32>` only, with no float atomic. This record did not read whether the oracle runs an atomic at 596c805.
- **Tiers.** At the pin the runtime runs on WebGPU only. Change 0054 (WebGL2 compute) is accepted on the compiler's `main` and is not at the pin. Change 0042 (a WebAssembly tier, "bit for bit with the oracle") is a `draft` at the pin.
- **`unpack2x16float`** is a builtin at the pin (`vendor/typeshade/src/core/builtins/coredef.ts`, line 649). Its outputs and its determinism row are not checked here.
- **Loaders.** `packages/addons/src/loaders` holds `GLTFLoader.ts` alone. There is no exporter directory and no capture package.
- **Compiler issues.** typeshade/typeshade#535 (reverse-mode `grad`), #536 (subgroups and immediates) and #537 (bindless, a watch item) are open. `docs/typeshade-feedback.md` at 265f89d links them.

### After

| Contract                | After this record                                                                                                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host model (part 1)     | `SplatGeometry` holds Gaussians of one kind, surfels or 3D Gaussians, with optional material arrays. `Splats` is an `Object3D` that draws one, with a `PhysicalMaterial` and a shading mode, `'physical'` or `'baked'`                |
| Buffers (part 1)        | No new buffer. A Gaussian is 4 `vec4` in `vertices` in the baked form, or 6 in the physical form. Its higher colour terms are `f16` pairs in `triangles`. Its BLAS is in `nodes`. The TLAS flag is bit 1, `INSTANCE_SPLATS`           |
| Path (part 1)           | A ray accepts each Gaussian it crosses with the chance of its alpha, by a hash. At the nearest accepted physical surfel, the path continues through the principled BSDF, next-event estimation and MIS. A baked hit ends the path     |
| Dataset (parts 2 and 3) | `CaptureDataset`: frames, intrinsics, poses, sparse points. Read from a COLMAP sparse model or a `transforms.json`. Made by a pose service (P1) or in the browser (P2), and refined in training (P3)                                  |
| Training (part 4)       | `@typeshade/radiance-capture` trains in two stages. Stage A gives geometry, baked radiance and refined poses. Stage B gives the materials and an environment by inverse rendering with record 0010's BSDF. The gradients come from C1 |
| Determinism (part 4)    | A training run is bit-identical on one device and driver for one seed. Across devices and tiers the promise is a quality band, not bits. Adjoint sums are fixed point, so they do not depend on the order of their additions          |
| Tiers (all parts)       | WebGPU first. WebGL2 and the CPU as fallbacks. Each result is held to the oracle, with no speed promise. The CPU keeps the full-quality budget available                                                                              |
| Output (part 5)         | The trained scene is a `Splats` and an `Environment`. `SplatExporter` writes `.ply` and glTF. `extractMesh` gives a `Mesh` with baked PBR textures, and `GLTFExporter` writes it                                                      |
| Scale (part 6)          | Target sizes from 0.2 to 6 million Gaussians. Device limits, a compact training state, level of detail, paging and block training reach them                                                                                          |

## Part 1: splats in the path tracer

### The host model

Two new classes in `@typeshade/radiance`, in three.js's shape (plan section 12, decision 4):

```ts
/** A set of Gaussians in the object's own space. Shared by any number of Splats. */
class SplatGeometry extends Geometry {
  readonly type = 'SplatGeometry';
  /** 1 for a 2D surfel (2DGS), 0 for a 3D Gaussian (3DGS). */
  kernel: 0 | 1;
  count: number;
  /** xyz per Gaussian: the centre. */
  center: Float32Array;
  /** wxyz per Gaussian: the rotation, a unit quaternion. For a surfel, local z is the normal. */
  rotation: Float32Array;
  /** xyz per Gaussian: the standard deviation along each local axis. z is 0 for a surfel. */
  scale: Float32Array;
  /** One per Gaussian: the opacity in [0, 1]. */
  opacity: Float32Array;
  /** The spherical-harmonic degree of the baked radiance, 0 to 3. */
  shDegree: 0 | 1 | 2 | 3;
  /** (shDegree + 1)^2 coefficients per Gaussian, rgb each, coefficient-major. */
  sh: Float32Array;
  /** 'srgb' when the baked colour is sRGB as captured, 'linear' when it is linear. */
  colorSpace: 'srgb' | 'linear';
  /** rgb per Gaussian: the base colour, linear. Null for an asset without materials. */
  baseColor: Float32Array | null;
  /** One per Gaussian each: the roughness and the metalness in [0, 1]. Null without materials. */
  roughness: Float32Array | null;
  metalness: Float32Array | null;
  /** rgb per Gaussian: the emitted radiance, linear. Null without materials. */
  emissive: Float32Array | null;
  /** True when the host stores a merged Gaussian for each inner node of the BLAS (part 6). */
  levelOfDetail: boolean;
  /** True when the asset was trained with the 3D filter of Mip-Splatting. Kept, not applied. */
  antialiased: boolean;
  version: number;
}

/** An object that draws one SplatGeometry. */
class Splats extends Object3D {
  readonly isSplats = true;
  geometry: SplatGeometry;
  /** Its factors multiply each surfel's words. White, roughness 1, metalness 1 by default. */
  material: PhysicalMaterial;
  /** 'physical' needs a surfel geometry with materials. 'baked' is the default otherwise. */
  shading: 'physical' | 'baked';
  /** A factor on the baked radiance. 1 by default. */
  intensity: number;
  constructor(geometry: SplatGeometry, material?: PhysicalMaterial);
}
```

- **Physical values.** The classes hold the scale, the opacity and the colour after their activation functions. A loader or the trainer converts a file's log scale and logit.
- **Any affine transform.** The kernel tests a Gaussian in the object's space, as it tests a triangle. A non-uniform scale is admitted.
- **The shading.** `shading = 'physical'` with a geometry of kind 0 or without materials is a `TypeError` that names the cause. A geometry with materials has `shading = 'physical'` by default.
- **The material.** `Splats.material` is a `PhysicalMaterial` (record 0010). Its `color`, `roughness`, `metalness` and `emissive` factors multiply the surfel's words, as glTF multiplies a texture by its factor. Its other members (`ior`, `specularIntensity`, `clearcoat`, `sheen`) apply to every surfel. `transmission` must be 0, and a value above 0 is a `TypeError`.

### The GPU layout

This layout is final for both forms. Amendment A writes it into record 0001 once. A trained relightable scene, an imported 3DGS asset and the level of detail of part 6 all use it. No later step changes the stride.

**The instance.** A `Splats` is one element of `instances`, 8 `vec4`, as a mesh is. `[0]` to `[5]` are the matrix and its inverse, as for a mesh. `[6]` is `(bits(nodeBase), bits(primBase), bits(vertexBase), bits(material))`, as for a mesh. `[7]` is `(bits(INSTANCE_SPLATS), bits(geometryId), bits(info), intensity)`. `INSTANCE_SPLATS` is 2, bit 1 of `flags`. Bit 0 stays the sphere's.

| Bits of `info` | Name           | Meaning                                                                       |
| -------------- | -------------- | ----------------------------------------------------------------------------- |
| 0 to 1         | `shDegree`     | The degree of the baked radiance, 0 to 3                                      |
| 2              | `SPLAT_SURFEL` | 1 for a surfel, 0 for a 3D Gaussian                                           |
| 3              | `SPLAT_PBR`    | The geometry has material words. The stride is 6 `vec4`, else 4               |
| 4              | `SPLAT_SHADE`  | The instance shades its surfels by the BSDF. Needs bits 2 and 3               |
| 5              | `SPLAT_SRGB`   | The baked colour is sRGB                                                      |
| 6              | `SPLAT_LOD`    | The geometry holds a merged Gaussian for each inner node of its BLAS (part 6) |
| 7 to 31        | none           | 0                                                                             |

**The geometry words.** Gaussian `i` takes `stride` elements of `vertices` from `vertexBase + stride * i`. `stride` is `SPLAT_STRIDE_BAKED` (4) or `SPLAT_STRIDE_PBR` (6), by `SPLAT_PBR`.

| Element | Words                             | Content                                                                          | Form          |
| ------- | --------------------------------- | -------------------------------------------------------------------------------- | ------------- |
| `[0]`   | `(cx, cy, cz, opacity)`           | The centre in object space, and the opacity                                      | Both          |
| `[1]`   | `(m00, m01, m02, c0r)`            | Row 0 of `M`, and the red SH coefficient of degree 0                             | Both          |
| `[2]`   | `(m10, m11, m12, c0g)`            | Row 1 of `M`, and the green coefficient of degree 0                              | Both          |
| `[3]`   | `(m20, m21, m22, c0b)`            | Row 2 of `M`, and the blue coefficient of degree 0                               | Both          |
| `[4]`   | `(base.r, base.g, base.b, metal)` | The base colour, linear, and the metalness. As record 0010's material word `[0]` | Physical only |
| `[5]`   | `(emit.r, emit.g, emit.b, rough)` | The emitted radiance, linear, and the roughness. As record 0010's word `[1]`     | Physical only |

`M` maps object space to the Gaussian's unit space. For a surfel, rows 0 and 1 are the two tangent axes divided by their scales, and row 2 is the unit normal. For a 3D Gaussian, `M = S^-1 R^T`. The host computes `M` in `f64` and rounds each word to `f32`. Words `[4]` and `[5]` keep the order of record 0010's material words `[0]` and `[1]`, so one decoder reads both.

**The colour words.** The coefficients above degree 0 take `SH_WORDS[shDegree]` elements of `triangles`, from `primBase + SH_WORDS[shDegree] * i`. Each `u32` holds two `f16` values, the even value in the low half. The values run coefficient by coefficient, red, green and blue inside each. The kernel reads a pair with `unpack2x16float`.

| `shDegree` | Values above degree 0 | `u32` words | `SH_WORDS` (`vec4u`) | Bytes, baked form | Bytes, physical form |
| ---------- | --------------------- | ----------- | -------------------- | ----------------- | -------------------- |
| 0          | 0                     | 0           | 0                    | 64                | 96                   |
| 1          | 9                     | 5           | 2                    | 96                | 128                  |
| 2          | 24                    | 12          | 3                    | 112               | 144                  |
| 3          | 45                    | 23          | 6                    | 160               | 192                  |

**The `f32` fallback** (decision 23). If the probe of step 1.1 fails, the colour words hold `f32` bits in `triangles`, not `f16` pairs. `SH_WORDS` becomes 3, 6 and 12 at degrees 1, 2 and 3. At degree 3 a Gaussian then takes 192 bytes of `triangles`, beside its 64 or 96 bytes of `vertices`. The layout of `vertices` does not change.

**The level-of-detail words** (part 6). When `SPLAT_LOD` is set, the geometry holds `count + inner` Gaussians. `inner` is the count of inner nodes of its BLAS. The merged Gaussian of inner node `n` (relative to `nodeBase`) is Gaussian `count + n`, in the same stride and with the same colour words. No node word changes.

**The BLAS.** Record 0001's nodes, from `nodeBase`. A leaf's `a` is its first Gaussian, relative to the geometry, with at most 4 in a leaf. The box of a Gaussian is its ellipse or ellipsoid at three standard deviations. Along axis `j` the half-extent is `3 * sqrt(sum over k of (R[j][k] * s[k])^2)`. The host rounds the lower corner down and the upper corner up to `f32`.

**Sizes at the default limits** (arithmetic). At 128 MiB a binding, `vertices` holds 2,097,152 baked or 1,398,101 physical Gaussians, less the meshes. At degree 3 with `f16` pairs, `triangles` holds 1,398,101 Gaussians. With the `f32` fallback it holds 699,050. Part 6 raises these.

### The kernel

`splat.shade.ts` is a new kernel file. It uses `+`, `-`, `*`, `/`, `dot`, `sqrt`, `select`, comparisons and `unpack2x16float`, and `pow` for a value only. The training package imports the same file (part 4), so one formula serves both.

| Function                                    | What it does                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `falloff(q)`                                | `exp(-q / 2)` for `q` in `[0, Q_MAX]`, from a polynomial and products. 0 above `Q_MAX`            |
| `hitSurfel(og, dg)`                         | `t = -og.z / dg.z`, and `q` the sum of the squares of `(og + dg * t).xy`. It returns `vec2(t, q)` |
| `hitGaussian(og, dg)`                       | `t = -dot(og, dg) / dot(dg, dg)`, and `q` the squared length of `og + dg * t`                     |
| `accept(alpha, key, instance, i)`           | True when `toUnit(hash2(hash2(key, instance), i))` is below `alpha`                               |
| `shColor(instance, i, dir)`                 | The SH sum for the unit direction `dir` in object space, plus 0.5, clamped at 0                   |
| `splatRadiance(instance, i, dir)`           | `shColor`, made linear when `SPLAT_SRGB` is set, times `intensity`                                |
| `splatSurface(instance, i, t, origin, dir)` | The `Surface` of a physical surfel hit, below                                                     |

Here `og = M (o - c)` and `dg = M d`, in the object's space. The direction is not normalised, so `t` stays a world-space parameter. A test misses when its divisor is 0, when `t` is not above 0, when `t` is not below the limit, or when `q` is above `Q_MAX`. `alpha = min(opacity * falloff(q), ALPHA_MAX)`, and an `alpha` below `ALPHA_MIN` is not met. `Q_MAX = 9`, `ALPHA_MIN = 1 / 255` and `ALPHA_MAX = 0.99` follow the 3DGS reference renderer.

**The stochastic choice** (survey items 7 and 10). Each Gaussian that a ray crosses is accepted when `accept` returns true. The nearest accepted one is the hit. Each Gaussian has its own hash, so it is accepted with the chance `alpha`, independently. The chance that the `k`-th Gaussian is the hit is `alpha_k` times the product of `1 - alpha_j` over the nearer ones. That is the weight of front-to-back compositing. The result does not depend on the order of the visits, so the walk needs no k-buffer and no sort.

**The instance in the hash.** Two `Splats` can share one `SplatGeometry`. Without the instance, Gaussian `i` of both would take the same decision on one ray, and their choices would correlate. `hash2(key, instance)` makes the choices independent.

**The falloff** meets `exp(-q / 2)` within 1e-6 absolute on `[0, 9]`. Step 1.1 chooses the form: a polynomial in `q`, or a polynomial in `q / 16` squared three times. No `exp` decides (record 0005, rule 2).

**The surface of a physical surfel.** `splatSurface` gives a `Surface` that the BSDF reads as a mesh's:

- `p` is `origin + dir * t`, offset along `ng` by `OFFSET`. `pb` is the same point offset along `-ng`.
- `ng` is row 2 of `M`, taken to world space by the inverse rows as a mesh's normal, made unit. It turns to face the ray, so a surfel has two faces. `ns` is `ng`. `front` is true.
- `dpdu` is row 0 of `M`, taken to world space and made unit. `dpdv` is `cross(ng, dpdu)`. `uv` is `(0, 0)`.
- `material` is `[6].w` of the instance, the `Splats.material`.
- `baseTint` is `(base, 1)`. `mrTint` is `(1, rough, metal, 1)`, green for roughness and blue for metalness as record 0010 part 2 reads them. `emissiveTint` is `emit`. `normalTint` stays 1.

So the BSDF multiplies the material's factors by the surfel's words. `sampleBsdf`, `evalBsdf` and `emission` do not change (Amendment I). The AOVs of record 0010 read the base colour and the normal of the surfel.

### The walk and the path

- **The walk.** `nearest(origin, dir, limit, key)` and `occluded(origin, dir, limit, key)` gain `key`. An instance with `INSTANCE_SPLATS` walks its BLAS. A leaf calls `hitSurfel` or `hitGaussian` by `SPLAT_SURFEL`. It keeps a Gaussian when `t` is below `hit.t` and `accept` is true.
- **The hit.** A splat hit sets `triangle` to the Gaussian's index relative to its geometry, `b1` to `q`, `b2` to 0 and `q` to 0. The instance's `flags` tell it apart.
- **A physical hit.** `surface(hit, dir)` calls `splatSurface` when `SPLAT_SHADE` is set. The path then runs as at a mesh. It takes the emission by record 0010's MIS rule and the next-event estimation of the lights and the environment. A BSDF sample and Russian roulette follow. A surfel's emission has no row in the light table, so a BSDF sample counts it in full (its light density is 0).
- **A baked hit.** `radiance` adds `throughput * splatRadiance(...)`, and the path ends. No light-table row samples a splat, so nothing counts its light twice.
- **The shadow ray.** `occluded` returns true at the first accepted Gaussian. The mean is the transmittance through the splats. A physical surfel and a baked splat block light the same way.
- **The key.** `radiance` passes `hash2(hash2(pixelSeed, index), 2 * bounce)` to `nearest`, and the same with `2 * bounce + 1` to `occluded`.
- **Scenes without splats** give the same bits as before. Step 1.3 checks every golden and every differential number.

| Effect                                             | Physical surfels                                | Baked splats                                   |
| -------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------- |
| A mirror or glass mesh shows the splats            | Yes                                             | Yes                                            |
| A mesh receives the light and the shadow of splats | Yes. Their emission by BSDF sampling, with MIS  | Yes. The light by BSDF sampling only           |
| The splats receive the shadow and light of a mesh  | Yes. Next-event estimation and indirect bounces | No. Their radiance is the light of the capture |
| A light of the scene relights the splats           | Yes                                             | No                                             |
| Depth of field and any camera ray of record 0010   | Yes                                             | Yes                                            |
| The white furnace holds                            | Yes, gate `surfel-furnace`                      | Not applicable                                 |

**Self-intersection.** A bounce leaves from `p`, offset along `ng`. A neighbouring surfel of the same surface can lie within that offset (inference). The `surfel-furnace` gate measures the energy that such hits lose. Step 1.3 sets `SPLAT_T_MIN`, a lower bound on `t` relative to the surfel's smaller scale, if the gate shows a loss.

### Loaders and the rules of part 1

- **`SplatLoader`** in addons reads the INRIA `.ply` (3D), the 2DGS `.ply` (`scale_0..1`), `.splat`, and `.spz` versions 2 and 3 (gzip through `DecompressionStream`). `GLTFLoader` reads `KHR_gaussian_splatting`. A loaded asset has no material arrays unless its file holds the properties `base_0..2`, `roughness`, `metalness` and `emit_0..2` that `SplatExporter` writes. `.spz` version 4 (ZSTD), SOG (WebP), the compressed `.ply` and `.ksplat` wait (decision 6).
- **Rules.** Every random number is `hash2` and `toUnit` (rule 1). `falloff` is a polynomial (rule 2). `pow` makes a value and is in `ALLOWED` of `determinism-lists.ts`. No atomic (rule 4).
- **`unpack2x16float` and rule 6.** Rule 6 forbids `f16` in a gated kernel. The kernel declares no `f16` value and enables no `f16` extension. `unpack2x16float` takes a `u32` and returns `f32` values. Every finite `f16` value is exactly an `f32` value, so the widening rounds nothing. The host writes no `f16` subnormal, infinity or NaN. So no device can choose another result, and rule 6 guards against exactly that choice. Amendment D writes this reading into rule 6. Step 1.1's probe checks all 65,536 codes on every tier.
- **The pack across browsers.** ECMAScript leaves the accuracy of `Math.exp` to the engine. So a loaded file may give other words in another browser. The gate scenes write their words directly.

## Part 2: ingest

`@typeshade/radiance-capture` (decision 4) reads a video or photos into frames.

- **Video.** A minimal ISO BMFF (MP4 and MOV) reader in the package finds the video track's samples. `VideoDecoder` (WebCodecs) decodes them. The browser's codecs set what plays. Decision 7 asks whether to write the reader or admit one dependency.
- **Photos.** `createImageBitmap` decodes JPEG, PNG and WebP. An EXIF reader in the package reads `Orientation`, `FocalLength` and `FocalLengthIn35mmFilm`. The 35 mm equivalent refers to a frame of 36 by 24 mm. So `fx = f35 / 36 * longSide`, with `longSide` the image's long side in pixels after the orientation, and `fy = fx`. Without EXIF, the pose stage estimates the focal length.
- **Selection.** A compute kernel, `sharpness.shade.ts`, computes the variance of the Laplacian of each frame's luminance, with one fixed-order reduction (record 0005, rule 5). From a video, the ingest keeps the sharpest frame of each window of `k` frames. `k` makes the count near the target, 200 by default. It drops a frame whose sharpness is under half the median.
- **Size.** Each frame is scaled to at most 1,600 pixels on its long side, the 3DGS convention. Frames stay on the host as `ImageBitmap`s. Training uploads one frame a step.

## Part 3: poses and the sparse start

**The contract.** A `CaptureDataset` holds, for each frame, the image, a pinhole intrinsic `(fx, fy, cx, cy)` and a pose (camera to world). It holds sparse points with colours. It is read from a COLMAP sparse model (`cameras`, `images`, `points3D`, binary or text) or a nerfstudio `transforms.json`. A non-pinhole COLMAP model is refused with a `TypeError` that names it.

**Three stages, one contract.** Part 3 fixes the contract, not a model. The field changes monthly (survey items 21 to 25 and 36 to 38). The poses reach the full result in three stages:

| Stage                      | What runs                                                                                                                   | Milestone | Gate                                                                  |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------- |
| P1. Server or host         | GLOMAP with COLMAP's features, or VGGT-1B-Commercial, outside the browser, by the guide's recipe. The M7 host runs the same | M5c       | None in CI (native code). The training gates use the engine's renders |
| P2. In the browser         | Depth Anything 3 Small (DA3-SMALL) as TypeShade kernels, from the frames and the EXIF intrinsics                            | M5p       | `posenet-reference` and `poses-browser-ci`                            |
| P3. Refinement in training | A pose correction for each frame and a focal correction for each camera, trained with the surfels (part 4)                  | M5c       | `pose-refine-ci`                                                      |

**The pose sources and their licences** (survey items 21 to 25 and 36 to 38):

| Source                       | What runs                                                    | Licence                                                                                                   | Where                          |
| ---------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------ |
| GLOMAP, with COLMAP features | Global SfM. COLMAP's sparse model out                        | BSD-3-Clause                                                                                              | P1: a server, or the M7 host   |
| VGGT-1B-Commercial           | Feed-forward cameras and points, for a few photos            | `vggt-aup-license`: commercial use permitted, with the exception of military applications. Gated download | P1: a server with a GPU        |
| DA3-SMALL (Depth Anything 3) | Feed-forward depth and camera poses, 0.08 billion parameters | Apache-2.0, by its model card                                                                             | P2: the browser. Also a server |
| DUSt3R, MASt3R, MASt3R-SfM   | Feed-forward point maps and SfM                              | CC BY-NC-SA 4.0                                                                                           | Not used (decision 9)          |
| Pi3 and Pi3X                 | Feed-forward cameras and point maps                          | Code BSD-3-Clause. Weights CC BY-NC 4.0                                                                   | Not used (decision 9)          |
| The user's own               | A COLMAP folder, a `transforms.json`, or poses from a phone  | The user's                                                                                                | Anywhere                       |
| The engine's own renders     | The path tracer renders known views of a known scene         | Apache-2.0                                                                                                | Every tier. The gates use it   |

- **P1, the first stage.** The service is not part of the engine's packages. The guide documents a recipe: GLOMAP's command line on the frames, and the COLMAP model back. The M7 host runs the same command when M7 lands. The browser sends the frames and receives a `CaptureDataset` (decision 8).
- **P2, poses in the browser.** DA3-SMALL is a plain vision transformer (survey item 36). Its weights are about 0.16 GB at 16 bits a weight (inference from 0.08 billion parameters). The engine runs it as TypeShade kernels on the runtime: matrix products, layer normalisation, attention and the heads. So P2 adds no dependency past the boundary. The weights are not in an npm package. The application gives a URL, and the package checks the file's SHA-256 before use. The EXIF focal length conditions the model where the frames have one.
- **P2, the alternative.** A COLMAP port runs in a browser through WebAssembly and WebGPU (survey item 37, September 2026). Its own code has separate terms, so the engine cannot use it. It shows that a WebAssembly build of COLMAP or GLOMAP, from their BSD source, can run in a page. Decision 33 keeps that build as the second choice for P2.
- **P3, the refinement.** Feed-forward poses are rough. Joint refinement in training makes them right (survey items 25 and 41). Part 4 trains it in every run, not only for P2's poses.
- **Initialisation.** The host turns each sparse point into a surfel. The centre is the point. The two scales are the mean distance to its three nearest points, through a uniform grid, in `f64`. The normal faces the mean of the cameras that see the point. The opacity is 0.1. The SH degree-0 term comes from the point's colour. The base colour starts at the point's colour made linear, the roughness at 0.5, the metalness at 0 and the emission at 0. P2 gives dense point maps. The host samples them on a voxel grid of 1/512 of the scene's box to keep the count near the target.

## Part 4: training

### The model

A surfel has 66 parameters at degree 3:

| Group          | Count | Activation                     | Stage |
| -------------- | ----- | ------------------------------ | ----- |
| Centre         | 3     | none                           | A, B  |
| Rotation       | 4     | normalised quaternion          | A, B  |
| Scales         | 2     | `exp` of a log scale           | A, B  |
| Opacity        | 1     | sigmoid of a logit             | A, B  |
| Baked radiance | 48    | SH, degree rising to 3         | A, B  |
| Base colour    | 3     | sigmoid                        | B     |
| Roughness      | 1     | sigmoid, mapped to `[0.02, 1]` | B     |
| Metalness      | 1     | sigmoid                        | B     |
| Emission       | 3     | `exp` of a log value           | B     |

Each frame adds a pose correction (6 parameters, a twist in the Lie algebra of rigid motions). Each camera adds a focal correction (1, a log factor). The scene adds the environment: an equirectangular image of 128 by 64 texels, rgb, as log radiance (24,576 parameters). The activations use `exp` for a value only. Training kernels are exempt from rule 2 (Amendment D), and these uses decide nothing.

### Stage A: geometry, baked radiance and poses

Stage A is 2DGS (survey items 2 and 26) with joint pose refinement. Its loss is `(1 - lambda) * L1 + lambda * D-SSIM` with `lambda = 0.2`, plus the depth-distortion term and the normal-consistency term at the paper's weights. Step 4.1 reads the weights from the paper and writes them here.

**One step.**

1. Pick the frame: a permutation of the frames by the seed, a new one each epoch.
2. Apply the frame's pose correction and the camera's focal correction to its camera.
3. Project: one invocation for each surfel computes its screen bounds and its depth.
4. Bin: make one key for each (tile, surfel) pair from the tile index and the depth. Sort the keys with a stable radix sort (C2).
5. Render: one workgroup for each 16 by 16 tile. Each pixel walks its tile's list and meets each surfel with `hitSurfel`.
6. Store each pixel's colour, depth terms, final transmittance and count of contributors.
7. Loss: a kernel computes the loss image and its sum, in one order.
8. Backward: the compiler's reverse mode gives the adjoints of steps 2, 3, 5 and 7 (C1).
9. Adam: one invocation for each parameter updates the value and both moments.
10. Densify: every 100 steps until step 15,000, clone, split and prune surfels by the 3DGS rules.

**The pose refinement** (decision 32). The pose corrections start at zero and have their own learning rate. They stay frozen for the first 1,000 steps, so the surfels settle first. The first frame's correction stays zero. It fixes the gauge, so the scene cannot drift as a whole. A frame whose correction passes 5 degrees or 5 % of the scene's box diagonal is reported.

The defaults are 30,000 steps, with a preview at 7,000. The SH degree rises by one each 1,000 steps, up to 3. The render of step 5 meets each surfel with the formula of part 1. The order differs: training sorts by the depth of the centre, and the path tracer takes the nearest accepted `t`.

### Stage B: materials and light by inverse rendering

Stage B starts from stage A's result (decision 29). It keeps the geometry, the poses and the baked radiance trainable at a lower rate. It trains the material words and the environment. The method follows the relightable Gaussian work of survey items 29 to 35: R3DG, GS-IR, IRGS, RadioGS (ICLR 2026) and Spec-Gloss Surfels (WACV 2026).

**The render of one pixel.**

1. The tile rasterizer of stage A gives the pixel's blended depth, normal, base colour, roughness, metalness and emission, with the blend weights of 2DGS. This is deferred shading, as GS-IR and Spec-Gloss Surfels do.
2. At the blended point, the kernel calls record 0010's `evalBsdf` and `sampleBsdf`, through a `Surface` made from the blended words.
3. Direct light: the kernel samples the environment by record 0010's importance sampling. Part 1's `occluded` gives the visibility through the current surfels.
4. The host rebuilds the sampling tables from the current environment every 100 steps, with a prefix sum in one order (rule 5).
5. Indirect light: the kernel takes a BSDF sample and traces it with part 1's `nearest`, in the baked mode. The hit surfel's baked radiance is the incident radiance.
6. A miss reads the environment. This is the radiance cache of IRGS and RadioGS.
7. MIS combines the two samples by record 0010's power heuristic. The defaults are two light samples and two BSDF samples a pixel a step.

**The losses.**

- The photometric loss of stage A on the shaded pixel.
- **Radiometric consistency** (RadioGS, survey item 33). For random surfels and random directions, observed or not, the baked radiance must equal the shaded radiance. This trains the cache for views that no frame saw.
- The baked loss of stage A on the same pixel, so the baked radiance stays a valid fallback.
- Priors: an edge-aware smoothness of the base colour and the roughness, weighted by the image gradient (GS-IR, R3DG). A weak pull of the metalness toward 0 or 1.

**What is differentiated.** The adjoints reach the material words, the normal, the environment texels, the baked radiance, the geometry and the poses. They pass through `evalBsdf`: GGX, the Smith term, Burley's diffuse, the Fresnel terms and the read of record 0010's albedo tables (C1). The sample directions and the visibility carry no derivative. A sample drawn from a fixed density gives an unbiased gradient of the value it estimates. Visibility is a discontinuity, and plan section 3.3 treats it the same way.

**The scale of albedo and light** (decision 36). A brighter environment and a darker base colour give the same pictures. A prior fixes the scale: the 99th percentile of the base colour's luminance is held at 0.9. The user can instead mark a grey card of known reflectance in one frame. The gates measure the base colour after a least-squares scale for each channel.

### When the decomposition fails

Stage B can fail: the light and the materials may not separate (decision 31). The trainer checks three things at the end of stage B, on 8 held-out frames:

| Check               | It fails when                                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Reproduction        | The PSNR of the shaded render is more than 3 dB below the PSNR of the baked render                                   |
| Degenerate material | More than 50 % of the visible surfels hold a roughness or a base-colour channel within 0.01 of a bound               |
| Implausible light   | The environment's mean luminance is outside 1/16 to 16 times the mean luminance of the frames, after the scale prior |

On a failure the result keeps the material words, sets `shading = 'baked'` on the `Splats`, and reports the failed check and its numbers. The scene then renders with its baked radiance, as an imported asset does. The user can still set `shading = 'physical'` by hand. A mix of physical and baked surfels in one instance is not proposed, because it is not physically consistent.

### Where the gradients come from

**The recommendation is the compiler's reverse-mode `grad`** (decision 10). The owner's direction is that TypeShade supports forward and reverse mode officially. Training needs the gradient of one scalar loss with respect to millions of parameters. Forward mode gives a few parameters a render, so it cannot train. Part 4 therefore waits on C1, filed as typeshade/typeshade#535, which asks to pull reverse mode before 1.0.

**What C1 must settle for this use.** These are requirements, written as this engine needs them. The compiler's procedure and its owner decide the design. The numbers in the first column are the items of #535.

| Item of #535                | The need                                                                                                                                                                                                                                                               |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. The tape                 | Store, recompute or checkpoint. A pixel meets up to thousands of surfels, so a stored tape of every step does not fit. The reference trainers store the final transmittance and the count, and walk back by division by `1 - alpha`                                    |
| 1. The tape, continued      | C1 must allow that walk: by checkpoints with a declared bound, or by an inverse of the loop state that the author declares                                                                                                                                             |
| 2. Runtime-length loops     | The per-pixel loop over the sorted list has a runtime length. Reverse mode must pass a `while` whose count the forward pass records. Forward mode does not pass one today                                                                                              |
| 3. A gather's adjoint       | The forward pass reads a surfel's parameters in many pixels. The adjoint adds into them from many pixels, a scatter. WGSL has no float atomic. The sum must be deterministic, and the oracle must define the same result                                               |
| 4. The API                  | A backward entry made from a `@compute` entry, the bindings to differentiate and the adjoint of the outputs. Or `vjp` of a kernel function, with the loop and the scatter written by the author, as a smaller first step                                               |
| 5. Bindings                 | An adjoint buffer for each differentiated binding raises the count. A training entry stays under eight storage buffers (record 0001, rule 1, and record 0006, item 9). C1 must let adjoints share a buffer, or report the count                                        |
| 6. The gradient check       | The oracle runs the backward entry. A compiler test holds it to central finite differences in `f64` and to forward-mode `grad` on the same parameters (the compiler's roadmap item 20)                                                                                 |
| 7. The tiers                | A backward entry runs on the WebGL2 tier too, or falls to the CPU tier with the reason reported, as the compiler's #138 says                                                                                                                                           |
| 7. The WebGL2 cost          | In change 0054 each atomic operation ends a phase. A backward loop that adds into an adjoint at each step takes one phase a step. A backward entry that holds its sums in registers and adds at the end of the loop keeps few phases. #535 states this as an inference |
| 8. Discontinuities          | The discontinuous builtins (`floor`, `step`, `sign`, `round`) keep a zero derivative in reverse mode, as in forward mode. The fixed-point `round` of the adjoint sum relies on it                                                                                      |
| 9. Determinism              | The compiler's determinism report lists the backward entry's rows, as it lists a forward entry's                                                                                                                                                                       |
| Not in #535: the BSDF       | Reverse mode passes record 0010's `evalBsdf`. It has `sqrt`, `/`, `select` and the products of GGX, Smith, Burley and Fresnel. It reads a sized array of a uniform block with bilinear weights. The adjoint of a table read flows to the weights, not to the table     |
| Not in #535: a storage read | The environment is a storage array in training. The adjoint of a read at a computed index is a scatter into an adjoint array, by the same fixed-point sum                                                                                                              |
| Not in #535: the poses      | The projection depends on the pose correction through the exponential of a twist. Its adjoint flows to the 6 parameters of a frame from every pixel, a scatter of the same kind                                                                                        |

The three rows "Not in #535" are to add to #535 by a comment. The owner adds them, or tells an agent to.

**The fixed-point sum.** Part 4 asks C1 for one result on every tier. Fact: WebGPU and WGSL have no float atomic. Chrome's "What's New in WebGPU" series up to Chrome 155-156 adds none (https://developer.chrome.com/docs/web-platform/webgpu/news, read on 2026-10-09). The 155-156 post adds the `fragment_depth` extension, `texture-compression-unaligned` and a bindless preview. So the accumulation is integer atomics on scaled gradients:

- **The integer.** Each contribution `g` to an adjoint becomes `c = i32(round(g * 2^F))`. `F` is the scale of its parameter group. The product by `2^F` is exact. `round` is round half to even in WGSL and on the oracle. A `g * 2^F` outside `[-2^31 + 1, 2^31 - 1]` is clamped to that range, and the step counts it.
- **The two-word form, by default.** Each adjoint is a 64-bit two's-complement integer in two `atomic<u32>` words, `lo` and `hi`. A contribution adds in four operations, in `u32` arithmetic that wraps. First, `old = atomicAdd(&lo, bitcast<u32>(c))`. Second, `carry = select(0u, 1u, old + bitcast<u32>(c) < old)`. Third, `ext = select(0u, 0xffffffffu, c < 0)`, the sign extension of `c` into the high word. Fourth, `atomicAdd(&hi, ext + carry)`.
- **Why the order does not matter.** Each `atomicAdd` on `lo` adds a value below `2^32`. Its carry is 1 exactly when that addition wraps. The count of wraps over all additions is the high part of the unsigned sum, in any order. `ext` adds `2^32 - 1`, which is `-1` modulo `2^32`, for each negative `c`. So `hi:lo` is the exact 64-bit sum of all `c`, in any order. Nothing reads the words before the dispatch ends.
- **The running sum.** A contribution is at most `2^31` in size. A step makes fewer than `2^32` contributions to one adjoint, because a frame has fewer than `2^32` pixels. So the 64-bit sum stays below `2^63` in size, and the two-word form cannot overflow.
- **The one-word form.** A group may use one `atomic<i32>` word when step 4.1 proves a bound. The bound is this: the count of contributions a step, times the largest `c`, is below `2^31`. Intermediate sums may wrap. The final sum is exact modulo `2^32`, so it is right whenever the true sum fits `i32`. No group uses this form without the proof.
- **The value.** The adjoint is `(f32(bitcast<i32>(hi)) * 2^32 + f32(lo)) / 2^F`, in that order. Each operation rounds once, in a fixed order, so every device gives the same bits from the same words.
- **The other tiers.** WebGL2 and the CPU add the same integers by a sorted gather or a plain loop. So every tier gives the same sum from the same contributions.

**Subgroup pre-reduction, an optional speed path.** A subgroup adds its lanes' integers with `subgroupAdd` before one lane calls `atomicAdd`. This cuts the atomic traffic. An integer sum is exact, so the bits stay the same. In the two-word form the subgroup adds 64-bit pairs with the same carry rule. Fact: Chrome ships subgroups (Chrome 134), `subgroup_id` (144), `subgroup_uniformity` (145) and `@subgroup_size` (151 and 152). TypeShade defers subgroups to after 1.0 (plan section 9), so this path waits on C8, filed as typeshade/typeshade#536. Rule 6 of record 0005 forbids subgroup operations in a gated kernel. Amendment D admits exact integer subgroup sums in training kernels.

**The interim alternative: hand-written backward kernels.** The engine writes the adjoint of each training kernel by hand. gsplat, Brush and the 3DGS code do the same. Forward-mode `grad` and finite differences on the oracle check it. It does not wait on the compiler. Its cost: each backward kernel is about as large as its forward kernel, and stage B adds the adjoint of the whole BSDF. Every change to a forward kernel needs its twin, and each pair needs its own gradient check. This record does not take it by default.

### Determinism in training

- **The promise** (decision 11). On one device and one driver, one `CaptureDataset`, one seed and one step count give one trained scene, bit for bit. Across devices and tiers, there is no bit promise. The PSNR of the trained scene on held-out frames stays in a band of the WebGPU run, which step 4.7 measures.
- **Why no bits across devices.** An optimisation amplifies a one-ulp difference over thousands of steps (inference). So rule 2 of record 0005 buys nothing across devices for a training kernel. Amendment D exempts the training kernels from rule 2 and keeps rules 1, 3 and 5.
- **Rules 4 and 6.** Rule 4 forbids atomics on the accumulation path. Amendment D admits integer atomics whose sum does not depend on the order, in training kernels only. Rule 6 forbids subgroups. Amendment D admits exact integer subgroup sums in training kernels only.
- **Quantisation.** Each quantised value of part 6 is made by integer arithmetic on the bits of the `f32`, with round half to even. The oracle does the same. No hardware conversion to `f16` decides a stored bit.
- **One mode.** The record proposes one mode, the deterministic one. A fast mode with float compare-and-swap or float subgroup sums is not proposed. If the measured speed needs one, a later record adds it behind an option that names it (rule 6).

### Budgets

- **Memory, full form.** A surfel at degree 3 has 66 parameters. Each has a value (4 bytes), a two-word adjoint (8) and two moments (8), so a surfel takes 1,320 bytes (arithmetic). Part 6 gives the compact form.
- **Capacity.** The training scene has a fixed capacity, allocated once. Densification stops at the capacity. Pruning frees slots by a prefix sum. Part 6 gives the capacity of each configuration.
- **Time.** No step ran here. Fact from the survey: 3DGS takes about 6 minutes for 30,000 steps on a desktop CUDA GPU (survey item 6). Brush trains in a browser (item 27). Inference: a browser run is several times slower, and stage B adds the shading samples. Step 4.7 records the steps a second and the time to the preview. The record sets no minimum (decision 25).

## The tiers

The engine runs on WebGPU first. WebGL2 and the CPU are fallbacks. The oracle holds the result of a fallback. The plan promises no speed on a fallback (decision 12). Each cost below is an inference, an order of magnitude, from no measurement of this work.

| Tier   | Render (part 1)               | Train: forward | Train: reverse                   | Sort                                                      | Adjoint sum                                  | Cost against WebGPU (inference) | What the gates check                                      |
| ------ | ----------------------------- | -------------- | -------------------------------- | --------------------------------------------------------- | -------------------------------------------- | ------------------------------- | --------------------------------------------------------- |
| WebGPU | Yes                           | Yes            | Yes, when C1 lands               | Radix sort with integer atomics                           | Fixed point by integer atomics               | 1                               | Every gate of this record                                 |
| WebGL2 | Yes, when record 0007 lands   | Yes            | If C1 covers change 0054         | Radix sort if change 0054 runs atomics, else a merge sort | The same fixed-point sum, by a sorted gather | 3 to 30 times slower            | The differential and determinism gates against the oracle |
| CPU    | Yes, the reference mode of M4 | Yes            | Yes, the oracle's backward entry | A plain sort on the host                                  | The same fixed-point sum, in one loop        | 100 to 10,000 times slower      | It is the reference, and the gradient check runs on it    |

- **The CPU tier** is the compiler's oracle. When change 0042 lands, it may be the WebAssembly tier, which that change states is "bit for bit with the oracle".
- **One sum on every tier.** The adjoint sum is an integer sum, so each tier gives the same sum from the same contributions. The contributions themselves differ by rounding between tiers.
- **The choice.** The renderer and the trainer take WebGPU when the browser has it, else WebGL2 when the runtime gives it, else the CPU. The result names the tier that ran.
- **The CPU as a training path** (decision 13). The oracle took 20 to 38 seconds for a 16 by 16 render at 256 samples (record 0009, citing `scripts/gates.mjs`). Inference: a training step at 1,600 pixels on the CPU takes many seconds.
- **The CPU's budgets.** The CPU keeps the full-quality budget: the same frame size, surfel count, steps and stage B as WebGPU. Its default is a reduced budget: frames at 400 pixels, 50,000 surfels, 7,000 steps of stage A and 2,000 of stage B. The user chooses either. The trainer states the expected time of the chosen budget before it starts, and the user may stop it.

## Part 5: output

- **Into the scene.** `capture.result()` gives a `CaptureResult`: a `SplatGeometry` of surfels with materials, an `Environment` (record 0010), the refined `CaptureDataset` and the report of stage B. A `Splats` of the geometry goes into a `Scene` with meshes, lights and the camera of record 0010. Part 1 renders it. The environment is optional in the scene, and the user may light the surfels with another one.
- **Export of splats.** `SplatExporter` in addons writes the 2DGS `.ply` layout and a glTF with `KHR_gaussian_splatting`. The `.ply` adds the properties `base_0..2`, `roughness`, `metalness` and `emit_0..2`, which `SplatLoader` reads back. The extension's `ellipse` kernel is a 3D Gaussian, so a surfel is written with a third scale of 0. A 3DGS viewer then draws it with its EWA projection, which distorts a flat disk.
- **The mesh** (decision 20). `extractMesh(result, { voxel, textureSize })` gives a `Mesh` with a `PhysicalMaterial` and four textures. Its steps follow this list.
- **Mesh export.** `GLTFExporter` in addons writes the `Mesh` as a glTF with `pbrMetallicRoughness`, `normalTexture` and `emissiveTexture`. Record 0010's `GLTFLoader` reads it back.
- **Uses of the mesh.** A game engine or a DCC tool, an occluder for record 0008's cast, and a shadow catcher (plan section 7). The grid is dense, 256 cubed by default (64 MB of `f32`). Part 6 gives a sparse grid for large scenes.

The steps of `extractMesh`:

1. Render the median depth of each training frame.
2. Fuse the depths into a TSDF grid, with one invocation for each voxel and a gather over the frames, so no atomics.
3. Run marching cubes with a prefix sum.
4. Cut the mesh into charts by normal clusters, flatten each chart, and pack the charts into a square atlas. The package writes this code (the boundary).
5. For each texel, trace a ray from the texel's point along the normal, both ways, with part 1's `nearest` in the physical mode. Read the met surfel's words.
6. Write the base colour into `map` (sRGB) and the roughness and the metalness into one image (green and blue, glTF's layout).
7. Write the surfel normal into `normalMap` (tangent space) and the emission into `emissiveMap`.

## Part 6: scale

**The target sizes.** Fact (survey, "What a Gaussian splat is"): a scene of a room or an object has 0.2 to 6 million Gaussians.

| Scene         | Gaussians        | Where it trains and renders                                   |
| ------------- | ---------------- | ------------------------------------------------------------- |
| An object     | 0.2 to 1 million | The browser on WebGPU, default limits and the compact state   |
| A room        | 1 to 3 million   | The browser on WebGPU with raised limits (C5), or the M7 host |
| A large scene | 3 to 6 million   | The M7 host, or the browser with paging and block training    |

**How the sizes are reached.**

- **Device limits (C5).** The runtime requests the adapter's `maxStorageBufferBindingSize` and `maxBufferSize`, not the defaults. At 1 GiB a binding, `vertices` holds 11,184,810 physical surfels (arithmetic). Record 0006 item 1 is this need.
- **The compact training state.** The moments are stored as 16-bit values with a scale for each group, quantised by integer arithmetic (Amendment D). The value stays `f32` and the adjoint stays two words. A surfel then takes 66 times 16 bytes, 1,056 bytes (arithmetic). The full form stays an option.
- **Level of detail.** The host builds a merged Gaussian for each inner node of the BLAS (survey items 39 and 40). It matches the moments of the node's children, in `f64`. The walk stops its descent at a node whose box is smaller than the ray cone's width there (record 0010 part 2). It then tests the merged Gaussian. The test uses `+`, `*` and comparisons, so it stays under rule 3.
- **Paging.** The host keeps every surfel in host memory or in the origin private file system. The device holds pages of 65,536 surfels, chosen for the camera by the frustum and the level of detail. A page uploads through a partial buffer write (record 0006, item 2). A walk that meets an absent page tests that page's merged Gaussian.
- **Block training.** A scene above the device's capacity trains in blocks of the scene's box, with an overlap of 10 % (survey item 39). The blocks train one at a time, in a fixed order. Each block sees the frames that see it. The host merges the blocks and drops the surfels of each overlap that the other block owns.

| Configuration                          | Training capacity (surfels)          | Render capacity at degree 3 (surfels) |
| -------------------------------------- | ------------------------------------ | ------------------------------------- |
| Browser, default limits, full state    | 500,000 (660 MB of state)            | 1,398,101                             |
| Browser, default limits, compact state | 1,000,000 (1,056 MB)                 | 1,398,101                             |
| Browser, 1 GiB bindings, compact state | The device's memory over 1,056 bytes | 11,184,810                            |
| M7 host, compact state                 | 6,000,000 (6.3 GB)                   | Set by the device                     |
| Paging and block training              | The scene's size                     | The scene's size                      |

The capacities are arithmetic from the bytes above. No run measured them. Step 6.4 records the largest scene of each configuration in `docs/benchmarks.md`.

## The gates

These follow record 0002. Amendment B owes the text. Every bound below is a proposal that its step measures, and may amend by record 0002's rule.

**The synthetic capture.** The path tracer renders a known scene from known poses. So the frames, the poses, the true surface and the true materials are known. No external dataset and no pose service run in CI. The scene `capture-synthetic` holds two objects of record 0010 on a floor: a textured dielectric with a roughness map, and a metal of roughness 0.3. An environment of known texels and one point light light it. A gate with the suffix `-ci` runs it at a reduced size in the `harness` job. Each one fits in 10 minutes there, and its step measures the time.

| Gate or test                    | What it proves                                                                                  | Scene and size                                                                                                                       | Number                                                                                                                                            | Runs in        |
| ------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `differential`, scene `splats`  | The GPU's render of physical and baked splats beside meshes is within tolerance of the oracle's | `splats`, 16 by 16, 256 samples                                                                                                      | `ORACLE` by record 0002's rule: `mean` at ten times the measured value, `abs` 1e-3, `rel` 5 %                                                     | harness        |
| `differential`, row `splat-hit` | `hitSurfel`, `hitGaussian`, `alpha` and `splatSurface` agree on the GPU and the oracle          | 4,096 rays from `mulberry32` with seed 2                                                                                             | 0 rays outside: `t` within `16 * ulp(S)`, `alpha` within 1e-6, the normal within 1e-6                                                             | harness        |
| `determinism`, scene `splats`   | Two renders of one seed are bit-identical, and another seed differs                             | `splats`                                                                                                                             | 0 differing floats                                                                                                                                | check, harness |
| `render`                        | The example's picture is its golden                                                             | `splats` example, 96 by 64, 64 samples                                                                                               | record 0002's tolerance                                                                                                                           | harness        |
| `surfel-furnace`                | A physical surfel keeps the energy through the BSDF, the stochastic choice and the walk         | A closed sphere of surfels in a constant environment of 1, 16 by 16, 1,024 samples                                                   | Each pixel within the furnace bound of record 0010 step 1.4. Rows: metalness 0 and 1, roughness 0.2, 0.6 and 1, opacity 0.5 and 0.99              | harness        |
| `splat.test.ts`                 | `falloff`, the two tests, `shColor`, `splatSurface` and the compositing law, against `f64`      | the oracle                                                                                                                           | `falloff` within 1e-6. The composite within 4 standard errors over 65,536 keys                                                                    | check          |
| `gradcheck`                     | The backward entry's adjoints equal finite differences and forward-mode `grad`                  | 16 surfels, 16 by 16, one frame, the oracle, both stages                                                                             | Relative 1e-3 against `f64` central differences where the gradient is above 1e-4. 1e-5 against forward mode                                       | check          |
| `bsdf-gradcheck`                | The adjoint of `evalBsdf` with respect to each material word and the normal                     | 4,096 random `(wo, wi, material)` triples on the oracle                                                                              | Relative 1e-3 against `f64` central differences, away from each lobe's kink                                                                       | check          |
| `train-differential`            | One GPU step's adjoints are within tolerance of the oracle's                                    | 256 surfels, 32 by 32, one step of each stage                                                                                        | The relative error of the adjoint vector at most 1e-4, in the 2-norm                                                                              | harness        |
| `train-determinism`             | Two training runs of one seed are bit-identical, and another seed differs                       | 256 surfels, 32 by 32, 200 steps of each stage                                                                                       | 0 differing words in the parameter buffer                                                                                                         | harness        |
| `train-converge-ci`             | Stage A recovers the synthetic capture                                                          | 24 views at 64 by 64, 4,000 surfels, 2,000 steps                                                                                     | PSNR on 4 held-out views at least 25 dB                                                                                                           | harness        |
| `material-ci`                   | Stage B recovers the true materials                                                             | As `train-converge-ci`, then 1,000 steps of stage B                                                                                  | Base colour RMSE at most 0.06 after a scale for each channel. Roughness mean absolute error at most 0.12. Metalness right on 90 % of surfels      | harness        |
| `relight-ci`                    | The trained surfels relight in the path tracer                                                  | The result of `material-ci` under a new environment and a point light, with a mesh that casts a shadow. 4 held-out views, 64 samples | PSNR against the true scene's render at least 22 dB. Mean radiance in the mesh's shadow at most 0.6 times the lit region's                        | harness        |
| `pose-refine-ci`                | Joint refinement makes wrong poses right                                                        | As `train-converge-ci`, with poses perturbed by 2 degrees and 2 % of the diagonal                                                    | After training: rotation error at most 0.2 degrees, translation error at most 0.2 %. PSNR within 1 dB of the true-pose run                        | harness        |
| `fallback-ci`                   | A failed decomposition falls back to baked shading and reports it                               | As `material-ci`, with the environment's learning rate at 0                                                                          | The result has `shading = 'baked'` and names the failed check                                                                                     | harness        |
| `bake-ci`                       | The mesh's baked textures render as the surfels do                                              | The result of `material-ci`, a grid of 64 cubed, textures of 256 by 256                                                              | PSNR of the textured mesh against the relit surfels at least 26 dB. The texels within the bounds of `material-ci` plus 0.02                       | harness        |
| `posenet-reference`             | The TypeShade kernels of DA3-SMALL match the reference network                                  | 2 frames at the model's smallest input, a fixture of the reference outputs                                                           | Poses and depths within 1e-3 relative                                                                                                             | harness        |
| `poses-browser-ci`              | P2 and P3 give poses good enough to train                                                       | 8 frames of the synthetic capture                                                                                                    | After a similarity alignment and refinement: rotation error at most 0.5 degrees, translation at most 1 %. PSNR within 1.5 dB of the true-pose run | harness        |
| `lod-ci`                        | The level of detail is close to the full set at a distance                                      | 100,000 surfels, a view where most nodes stop early                                                                                  | PSNR against the full set at least 35 dB                                                                                                          | harness        |
| `blocks-ci`                     | Block training matches whole training                                                           | As `train-converge-ci`, in 2 blocks                                                                                                  | PSNR within 0.5 dB of the whole run                                                                                                               | harness        |
| `train-converge`                | The full-size result, recorded                                                                  | 64 views at 256 by 256 of the synthetic capture, 30,000 and 10,000 steps                                                             | PSNR at least 28 dB. Chamfer distance of the mesh at most 1 % of the box diagonal. Relight PSNR at least 26 dB                                    | by hand        |
| `ingest`                        | The demuxer, the EXIF reader and the selection                                                  | fixtures                                                                                                                             | A synthetic video with 10 blurred frames keeps none of them. Each fixture gives its fields, `fx` from the long side                               | check          |
| `bench`                         | The speed and the size, recorded and not held                                                   | a real capture                                                                                                                       | Steps a second, the time to 7,000 steps, the peak memory, the PSNR at 7,000 and 30,000 steps, the largest scene a tier holds                      | by hand        |

**The acceptance of each milestone is in CI** (decision 25).

- M3g is done when `differential` `splats`, `splat-hit`, `determinism`, `render` and `surfel-furnace` pass in the `harness` job.
- M5c is done when `gradcheck`, `bsdf-gradcheck`, `train-differential`, `train-determinism`, `train-converge-ci`, `material-ci`, `relight-ci`, `pose-refine-ci`, `fallback-ci` and `bake-ci` pass.
- M5p is done when `posenet-reference` and `poses-browser-ci` pass. M5h is done when `lod-ci` and `blocks-ci` pass.
- `train-converge` and `bench` run by hand. They record numbers in `docs/benchmarks.md` and hold no acceptance criterion.

**The scene `splats`.** 512 physical surfels and 64 3D Gaussians on a ring, with opacities from 0.2 to 0.95 and degree 1. A diffuse floor, an emissive quad, a point light and a mirror quad that shows the ring. A box mesh casts a shadow onto the surfels. The words are written directly, with no file and no `exp`.

**Prove the instrument.** Each instrument shows that it can fail before it is trusted to pass (record 0002).

1. The compositing test fails when `accept` ignores `i`, and when it ignores `instance` on two instances of one geometry.
2. The render gate fails when every scale grows by 1 %. If 1 % passes, step 1.5 records the smallest growth that fails.
3. `surfel-furnace` fails when `splatSurface` drops the multiple-scattering factor of record 0010, or when `occluded` ignores `alpha`.
4. `gradcheck` and `bsdf-gradcheck` fail when one adjoint's sign is changed in a scratch branch.
5. `train-differential` fails when one pixel's contribution is dropped in the GPU's sum, and when `ext` is left out of the two-word form.
6. `train-converge-ci` fails when the learning rate of the centres is 0.
7. `material-ci` fails when the roughness's learning rate is 0. `relight-ci` fails when the shading of stage B takes the visibility as 1.
8. `pose-refine-ci` fails when the pose learning rate is 0.
9. `bake-ci` fails when the green channel of the normal map is flipped.
10. `train-determinism` fails when a float compare-and-swap loop replaces the fixed-point sum on WebGPU. If SwiftShader does not show it, the step records that and proves the gate with a changed order of the frames.

## Why

**The evidence.** The survey ranks the options. Its sources are cited there.

- 2DGS gives surfels with exact depth and normals by a ray-plane test (item 2). The same test serves training and ray tracing. A surfel's normal is a shading normal, so a surfel is a surface for a BSDF.
- Relightable Gaussians are established (items 29 to 35). R3DG and GS-IR decompose BRDF parameters and light from photographs. IRGS and RadioGS use 2D Gaussian ray tracing for visibility and inter-reflection. Spec-Gloss Surfels puts a microfacet BRDF on 2DGS with deferred shading.
- Ray-traced Gaussians and mixed mesh scenes are established (items 3, 6, 9, 17). A stochastic choice makes ray tracing of transparent Gaussians sorting-free and unbiased (items 7, 10).
- Training on WebGPU-class hardware in a browser works (Brush, item 27). SfM in a browser works (item 37).
- Raster viewers on the web are many. None trains from a video, relights the result in a path tracer, checks against a CPU reference or promises bits.

**Why relightable and not baked as the target.** A baked splat holds the light of the capture. In a path tracer it is an emitter that blocks light. A mesh cannot shadow it, and a new light does not change it. The product goal is a scene inside the path tracer, so the surfels must take the path tracer's light. Baked radiance stays as stage A, the fallback and the mode of imported assets.

**Why record 0010's BSDF and not a simpler BRDF.** With one BSDF in training and in rendering, the path tracer shows what training fits. A simplified BRDF in training would give materials that render differently (inference). The cost is the adjoint of the full BSDF in C1.

**Alternatives.**

- **Render only, no training.** The first draft of revision 1. The owner put training in scope.
- **Baked radiance as the final result.** Revision 1. The owner's direction of 2026-10-09 rejects it.
- **3DGS training.** The trained scene would not render by ray tracing as it was trained, and a 3D Gaussian has no defined normal. Rejected for the capture path. 3DGS assets stay loadable, baked.
- **Forward shading of each surfel in stage B.** It matches the path tracer's stochastic choice exactly. It shades every crossed surfel, so its cost grows with the depth of the list. GUS-IR compares the two forms (survey item 35). Deferred shading, as GS-IR and Spec-Gloss Surfels do, is the default. `relight-ci` measures the difference that matters.
- **Diffusion priors for normals and base colour** (Spec-Gloss Surfels). A diffusion network is a dependency much larger than DA3-SMALL. Not proposed. A later record may add one.
- **Hand-written backward kernels.** The interim alternative of part 4. Not the default, by the owner's direction.
- **Float atomics by compare-and-swap.** The sum depends on the order, so a training run is not reproducible. Rejected.
- **A k-buffer in the path tracer**, as 3DGRT does. It needs a sorted array for each ray, a second loop of runtime length, and an `exp` that decides. Rejected for the stochastic choice.
- **An eighth storage buffer for splats.** It breaks record 0001's rule 1. Rejected.
- **ONNX Runtime Web for P2.** It is a dependency past the boundary. The engine's own kernels run DA3-SMALL. Rejected unless the owner admits the dependency.
- **A raster viewer in the real-time tier** (option A of the survey). It competes on others' ground. The training rasterizer gives a preview of a trained scene anyway (inference).

## What it touches

- **`@typeshade/radiance`.** `splat.shade.ts` (new), `intersect.shade.ts`, `trace.shade.ts`, `layout.shade.ts`, `SplatGeometry.ts` and `Splats.ts` (new), `bvh.ts` (`buildBoxes`, the merged Gaussians), `scene-pack.ts`, `index.ts`, `__api__`. `materials.shade.ts` does not change.
- **`@typeshade/radiance-addons`.** `SplatLoader.ts` (new), `GLTFLoader.ts`, `src/exporters/SplatExporter.ts` and `src/exporters/GLTFExporter.ts` (new), `src/scenes` (the gate scenes), `__api__`.
- **`@typeshade/radiance-capture`** (new, `packages/capture`). Ingest (`mp4.ts`, `exif.ts`, `sharpness.shade.ts`), `CaptureDataset` and its readers, the DA3-SMALL kernels and the initialisation. The training kernels of both stages, Adam, densification and the pose refinement. The TSDF, marching cubes, the atlas, the bake and block training. `scripts/boundary.mjs` admits the new package as a sibling.
- **Gates.** `scripts/gates.mjs`, `scripts/gates/*`, `scripts/probes/hit-splat.shade.ts`, `scripts/harness-entry.ts`, `scripts/scenes.ts`, the goldens, the fixture of `posenet-reference`.
- **Records.** Amendments A to I.
- **Site.** The `splats` example and a capture example that runs on the visitor's GPU. Guide pages for what a splat does in a path tracer, for relighting a capture, and for the tiers.
- **Not touched.** `accum`, `TraceParams`, the sampler's sequences, the code of the BSDF.

## Compiler needs

These are needs that typeshade/typeshade's issues and `changes/` would carry. This pull request opens none. Amendment E lists each one in record 0006.

| Need                                           | Filed                   | Blocks                             |
| ---------------------------------------------- | ----------------------- | ---------------------------------- |
| C1. Reverse-mode `grad` before 1.0             | typeshade/typeshade#535 | Part 4                             |
| C2. A sort                                     | Not filed. To file      | Part 4                             |
| C3. Atomics on the oracle and on WebGL2        | Not filed. To file      | The fixed-point sum on those tiers |
| C4. Indirect dispatch                          | Not filed. To file      | Nothing. Speed of part 4           |
| C5. Device limits                              | Not filed. To file      | Part 6 above the default limits    |
| C6. GPU time                                   | Not filed. To file      | Nothing. The budgets               |
| C7. The cost of many dispatches                | Not filed. To file      | Nothing. Speed of part 4           |
| C8. Subgroups, `@subgroup_size` and immediates | typeshade/typeshade#536 | Nothing. Speed of part 4           |
| Watch. Bindless resource tables                | typeshade/typeshade#537 | Nothing                            |

- **C1. Reverse-mode `grad` before 1.0** (#535). Part 4's table lists the needs: items 1 to 9 of #535. It adds three that #535 does not state yet: the BSDF, a storage read and the poses.
- **C2. A sort.** A stable radix sort of `u32` keys with values, as a kernel package or a runtime primitive, on every tier. Plan section 9 already expects it for M6s.
- **C3. Atomics on the oracle and on WebGL2.** Two forms, each with the result of a sequential sum. First, `atomicAdd` on `atomic<i32>`, for the one-word form. Second, `atomicAdd` on `atomic<u32>` that returns the old value, for the two-word form. The oracle returns the old value in the order it defines, and the final words equal the 64-bit sum. On WebGL2, a form or a reported refusal. #535 item 3 and the compiler's #138 cover part of it.
- **C4. Indirect dispatch.** `dispatchWorkgroupsIndirect`, so that a step's dispatch follows the live surfel count. It was not found in `vendor/typeshade/src/runtime/` at the pin. Until it lands, every dispatch covers the capacity.
- **C5. Device limits** (record 0006, item 1). The runtime requests the adapter's limits. Part 6 needs bindings above 128 MiB.
- **C6. GPU time** (record 0006, item 5). The budgets need it.
- **C7. The cost of many dispatches** (plan section 9). A step is about ten dispatches, and a run is 40,000 steps.
- **C8. Subgroups and immediates** (#536). `subgroupAdd` and the other subgroup builtins, `@subgroup_size` (`subgroup_size_control`), and immediates, the small per-dispatch values that Chrome ships in 149 and 150. #536 proposes a subgroup of size 1 on WebGL2 and on the oracle.
- **Watch. Bindless** (#537). Storage-buffer tables would lift the limit of eight storage buffers per stage for the training entries and for paging. Texture tables would let the bake's textures keep their own sizes. Nothing in this record waits on it.

## Amendments owed

Each amendment goes into its record in its own pull request, before the step that needs it (decision 26).

- **A. Record 0001.** A section "Gaussian splats". It holds the instance words and `info`, both strides, the geometry and colour words and the `f32` fallback. It holds the level-of-detail words, the BLAS, the limits, the walk's branch and the `Hit` fields. Before step 1.2.
- **B. Record 0002.** The scenes, rows, tests, training gates, bounds and probes of "The gates", and the acceptance of M3g, M5c, M5p and M5h in CI. Before step 1.3.
- **C. Record 0003.** The exports `SplatGeometry`, `Splats`, `SplatLoader`, `SplatExporter` and `GLTFExporter`, and the package `@typeshade/radiance-capture` with its exports. Before step 1.2.
- **D. Record 0005.** "The splats' arithmetic" for part 1, with `unpack2x16float` read as an exact widening under rule 6. For part 4: the training promise and the exemption of training kernels from rule 2. Also order-independent integer atomics under rule 4, exact integer subgroup sums under rule 6, and integer quantisation. Before steps 1.1 and 4.1.
- **E. Record 0006.** Items C1 to C8 as new rows, with the filed issue of each, and the watch item. Before part 4.
- **F. Record 0007.** The WebGL2 rows of the tiers table. When record 0007 is accepted.
- **G. Record 0008.** The cast meets a `Splats` at its nearest Gaussian whose `alpha` at the hit is at least 0.5. Before step 1.5.
- **H. `docs/plan.md`.** Milestones M3g, M5c, M5p and M5h, and the order of decision 3. The package in section 3. C1 in section 9. Section 3.3's scope ("not a neural field", "forward mode only") read against training. After acceptance, as its own pull request.
- **I. Record 0004.** "The shading contract": the tints of `Surface` may come from a physical surfel's words, as from a texture. Before step 1.3.

## Implementation, in steps

Each step is one pull request. Each commit names `Design: 0011` on a line of its own.

**Part 1, milestone M3g.** It needs record 0010 parts 1 and 3 (the BSDF, MIS and the environment).

1. **Step 1.1.** Add `splat.shade.ts` and `splat.test.ts`. Probe `unpack2x16float` on WGSL, GLSL and the oracle over all 65,536 codes. Done when the tests pass and the lint adds no row.
2. **Step 1.2.** Add `SplatGeometry`, `Splats`, `buildBoxes` and the pack's branch for both forms, with tests of the words and the errors. Done when `bun run gate:api` shows only the new names.
3. **Step 1.3.** Change the walk and the path, and add `splatSurface`. Add the scene `splats`, the row `splat-hit`, `surfel-furnace` and their probes. Done when every existing golden and number stays the same and the new rows pass.
4. **Step 1.4.** Add `SplatLoader` and the glTF extension, with fixtures. Done when each fixture gives its words.
5. **Step 1.5.** Add the `splats` example, its golden and probe, and the cast of Amendment G. Done when the render gate and its probe pass and fail as they must.

**Parts 2 to 5, milestone M5c.** Part 4 starts when the pin carries C1 and C2.

6. **Step 2.1.** Create `@typeshade/radiance-capture`. Add the MP4 reader, the EXIF reader and the sharpness kernel, with the `ingest` tests.
7. **Step 3.1.** Add `CaptureDataset`, the COLMAP and `transforms.json` readers, and the initialisation. Write the P1 recipe in the guide.
8. **Step 4.1.** Write the forward entries of stage A, the loss and Adam. Read the 2DGS loss weights. Set `F` and the form of each group. Run `gradcheck` on the oracle.
9. **Step 4.2.** Add the backward entry from C1, the fixed-point sum, densification and the pose refinement. Run `train-differential`, `train-determinism` and `pose-refine-ci`.
10. **Step 4.3.** Add the synthetic capture and `train-converge-ci`.
11. **Step 4.4.** Add stage B: the shading, the environment, the losses, the scale prior. Run `bsdf-gradcheck`, `material-ci` and `relight-ci`.
12. **Step 4.5.** Add the checks of a failed decomposition and the fallback. Run `fallback-ci`.
13. **Step 4.6.** Add the tier choice and both CPU budgets. Run the gate sizes on WebGL2 and the CPU where the pin allows.
14. **Step 4.7.** Run `train-converge` and `bench` on a real capture. Record the numbers, the cross-tier PSNR band and the agreement of the two renders.
15. **Step 5.1.** Add `SplatExporter`, with a round-trip test.
16. **Step 5.2.** Add `extractMesh`, the atlas, the bake and `GLTFExporter`. Run `bake-ci` and the Chamfer check.
17. **Step 5.3.** Add the capture example to the site.

**Part 3 P2, milestone M5p.**

18. **Step 3.2.** Write the DA3-SMALL kernels and the weight loader. Commit the reference fixture. Run `posenet-reference`.
19. **Step 3.3.** Connect P2 to the dataset and to P3. Run `poses-browser-ci`.

**Part 6, milestone M5h.**

20. **Step 6.1.** Request the adapter's limits when C5 lands. Add the compact training state.
21. **Step 6.2.** Add the merged Gaussians and the walk's stop. Run `lod-ci`.
22. **Step 6.3.** Add paging, block training and the sparse TSDF grid. Run `blocks-ci`.
23. **Step 6.4.** Record the largest scene of each configuration. Set the record to `implemented` with the configuration and the numbers.

**At M4, M7 and M8.** M4's reference mode adds the CPU tier to the M3g and M5c gates. M7 runs P1 on the host and trains the large configuration. M8 adds the WebGL2 rows. Each is a step of that milestone, not of M5c.

## Decisions for the owner

1. The engine trains relightable 2DGS from a video or photos, and also renders imported 3DGS assets with baked radiance. Proposed: yes. This asks the owner, because it sets the scope.
2. The trained primitive is the 2D surfel with principled material words. 3D Gaussians are a second kind, for imported assets only, baked. Proposed: surfels. This asks the owner, because it sets the scope.
3. The order: M3g after M3, M5c after M5, M5p after M5c, and M5h after M5p. The CPU tier joins at M4, the host at M7 and WebGL2 at M8, each as an acceptance item of that milestone. The plan's order becomes M3, M3g, M3v, M3s, M5, M5c, M5p, M5h, M6, and the rest as today. The alternative moves M4 and M7 before M5c. Proposed: the first order. This asks the owner, because it changes the order.
4. The training, ingest, pose and mesh code is a new package, `@typeshade/radiance-capture`, in layer L4 beside `@typeshade/radiance-fit`. Proposed: yes. This asks the owner, because it adds a package.
5. Splats are a ray-traced primitive of the path tracer: a TLAS instance with flag bit 1, and no new buffer. A raster viewer is not in this record. Proposed: yes. This asks the owner, because it changes a layout of record 0001.
6. The read formats are the INRIA `.ply`, the 2DGS `.ply` with the material properties, `.splat`, `.spz` versions 2 and 3, and `KHR_gaussian_splatting`. The written formats are the 2DGS `.ply` and the glTF extension. `.spz` version 4, SOG, the compressed `.ply` and `.ksplat` wait. Proposed: yes. This asks the owner, because it sets the scope.
7. The ingest reads MP4 and MOV with a reader written in the package, and decodes with WebCodecs. The alternative is one dependency, mp4box.js, which needs a change of the boundary. Proposed: the package's own reader. This asks the owner, because the other answer changes the boundary.
8. Poses come in three stages. P1 runs on a server or the M7 host first. P2 runs in the browser at M5p. P3 is joint refinement in every training run. Proposed: yes. This asks the owner, because it decides where the product runs.
9. The pose sources are GLOMAP with COLMAP's features (BSD-3-Clause) and VGGT-1B-Commercial (`vggt-aup-license`, commercial use except military) for P1, and DA3-SMALL (Apache-2.0) for P2. DUSt3R, MASt3R and the Pi3 weights are not used, because their licences are non-commercial. User-supplied COLMAP and `transforms.json` data is always accepted. Proposed: yes. This asks the owner, because it sets the dependencies.
10. The gradient method is the compiler's reverse-mode `grad` (C1, typeshade/typeshade#535), pulled before 1.0, with record 0010's BSDF in its scope. Hand-written backward kernels are an interim path only if C1 is late. Proposed: compiler reverse mode. This asks the owner, because it sets the compiler's roadmap and the start of part 4.
11. Training has one mode. It is bit-identical on one device and driver for one seed, and in a PSNR band across devices and tiers. Training kernels are exempt from rule 2 (Amendment D). No fast mode now. Proposed: yes. This asks the owner, because it changes the scope of record 0005.
12. The tiers are WebGPU first, then WebGL2, then the CPU. The oracle holds the result of a fallback. The plan promises no speed on a fallback. Proposed: yes. This asks the owner, because it adds a promise.
13. The CPU is a supported training fallback that keeps the full-quality budget available. Its default is the reduced budget: 400-pixel frames, 50,000 surfels, 7,000 and 2,000 steps. It states the expected time before it starts. Proposed: yes. This asks the owner, because it decides what the product supports.
14. Adjoints accumulate as fixed-point integers: two `u32` words with sign extension by default, one `i32` word where a bound is proven. Other tiers add the same integers by a sorted gather or a loop. Subgroup pre-reduction is an optional speed path after C8. Proposed: yes. This asks the owner, because it amends rules 2, 4 and 6 of record 0005.
15. The training defaults are 30,000 steps of stage A with a preview at 7,000, and 10,000 steps of stage B. The 2DGS loss is at the paper's weights. The SH degree rises each 1,000 steps to 3. Densification runs every 100 steps until 15,000. Proposed: yes. This is a default.
16. The training capacity is fixed and allocated once. Its defaults are those of part 6 for each configuration: 500,000 surfels in a browser at the default limits, 6,000,000 on the M7 host. Proposed: yes. This asks the owner, because it bounds the scene size.
17. Frames are at most 1,600 pixels on the long side, 200 frames by default from a video. They stay on the host, and one is uploaded a step. Proposed: yes. This is a default.
18. The path tracer's splat rules follow. A ray accepts each Gaussian with the chance of its alpha. The hash takes the ray's key, the instance and the Gaussian. The falloff is a polynomial within 1e-6 of `exp(-q / 2)`. `Q_MAX` is 9, `ALPHA_MIN` is 1/255, `ALPHA_MAX` is 0.99. Proposed: yes. This is a default.
19. A physical surfel hit is a surface: it goes through `sampleBsdf`, next-event estimation and MIS, and receives the scene's lights and mesh shadows. A baked hit adds its radiance and ends the path. A shadow ray stops at an accepted Gaussian of either mode. Proposed: yes. This asks the owner, because it fixes what a splat can show.
20. `extractMesh` belongs to part 5 and is optional for the user. Its mesh carries baked textures: base colour, roughness and metalness, normal and emission. Its grid is dense, 256 cubed by default, and sparse in part 6. Proposed: yes. This asks the owner, because it sets the scope of the export.
21. The baked colour of a loaded splat is sRGB as the file's camera saw it, unless its file says linear. The kernel makes it linear at the hit. Training stores the baked colour, the base colour and the emission in linear light. Proposed: yes. This is a default.
22. The public names: `SplatGeometry` and `Splats` in `@typeshade/radiance`. `SplatLoader`, `SplatExporter` and `GLTFExporter` in the addons. `capture`, `CaptureDataset`, `CaptureResult` and `extractMesh` in `@typeshade/radiance-capture`. Proposed: yes. This asks the owner, because it adds exports.
23. The baked colour above degree 0 is stored as `f16` pairs. If the probe of step 1.1 fails, it is `f32` bits in `triangles`, 192 bytes a Gaussian at degree 3, and a binding holds 699,050 Gaussians. Proposed: `f16` pairs. This is a default.
24. Record 0008's cast meets a `Splats` at its nearest Gaussian whose `alpha` at the hit is at least 0.5. The AOVs of record 0010 give the depth `t` and the surfel's normal. The albedo is the base colour of a physical surfel, or the linear baked colour. Proposed: yes. This is a default.
25. The gates and their numbers are those of "The gates". Every acceptance criterion of M3g, M5c, M5p and M5h is a CI gate. `train-converge` and `bench` run by hand and only record numbers. No speed has a minimum. Proposed: yes. This asks the owner, because it defines when the milestones are done.
26. Each amendment of "Amendments owed" goes into its record in its own pull request, before the step that needs it. The owner's "merge" is its approval. Proposed: yes. This is a default from `CLAUDE.md`.
27. A physical surfel's material words are base colour, metalness, emission and roughness, in words `[4]` and `[5]`. Their order is that of record 0010's material words `[0]` and `[1]`. They reach the BSDF through record 0010's tints. The factors of `Splats.material` multiply them. Proposed: yes. This asks the owner, because it sets a layout.
28. The layout has two forms, fixed now by Amendment A. The stride is 4 `vec4` for baked splats and 6 for physical surfels. `SPLAT_PBR` chooses it for each geometry. The level of detail adds Gaussians, not words. Proposed: yes. This asks the owner, because it sets a layout of record 0001.
29. Training is inverse rendering in two stages. Stage A trains geometry, baked radiance and poses. Stage B trains materials and an environment with record 0010's BSDF, part 1's visibility, indirect light from the baked radiance, and radiometric consistency. Proposed: yes. This asks the owner, because it sets the scope.
30. The estimated environment is an equirectangular image of 128 by 64 texels in training. The result gives it as a record 0010 `Environment`. Proposed: yes. This is a default.
31. A decomposition can fail one of the three checks. The result then keeps the materials, uses baked shading for the whole geometry, and reports the check. The user may override. A mix of physical and baked surfels in one instance is not proposed. Proposed: yes. This asks the owner, because it decides what a user gets on a failure.
32. Joint pose refinement runs in every training run. It trains a correction for each frame and a focal correction for each camera. They stay frozen for 1,000 steps, and the first frame stays fixed. Proposed: yes. This asks the owner, because it sets the scope.
33. P2 runs DA3-SMALL as TypeShade kernels, with no dependency past the boundary. Its weights load from a URL that the application gives, checked by SHA-256. A WebAssembly build of GLOMAP from its BSD source is the second choice. Proposed: DA3-SMALL in kernels. This asks the owner, because it decides a dependency and a download.
34. The target sizes are 0.2 to 6 million Gaussians. Milestone M5h reaches them by device limits (C5), a compact training state, level of detail in the BLAS, paging and block training. Proposed: yes. This asks the owner, because it sets the scope and a milestone.
35. Every quantisation in a kernel is integer arithmetic on the bits of an `f32`, and the oracle does the same. `unpack2x16float` is admitted under rule 6 as an exact widening (Amendment D). Proposed: yes. This asks the owner, because it amends record 0005.
36. A prior fixes the scale between albedo and light. It holds the 99th percentile of the base colour's luminance at 0.9. A grey card that the user marks can replace it. The gates measure the base colour after a scale for each channel. Proposed: the prior by default. This is a default.
37. Stage B shades the blended surface of each pixel (deferred shading). Forward shading of each surfel is not the default. Proposed: deferred shading. This is a default.
38. C1 is #535 and C8 is #536. Bindless is a watch item, #537. C2 to C7 are not filed. The owner files each, or tells an agent to, before the step that needs it. The three needs of C1 that #535 does not state go to #535 as a comment. Proposed: yes. This asks the owner, because the owner files the compiler's issues.

## Record

**Approval and plan record.** This record does not yet apply. It is `draft`. The owner asked for a plan on 2026-10-09 (UTC). On the same date the owner put training in scope, set the gradients on the compiler's reverse mode, and asked for fallback tiers. The owner then directed a full implementation, relightable inside the path tracer. Revision 2 follows that direction and the review of the pull request. The owner has not yet said to merge it. The owner's answer to the decisions will be the acceptance.

**Configuration and validation record.** This record does not yet apply. Implementation will record the commits of each step, the pin, each gate's result and the numbers. This record is documentation only. It ran no gate, no test and no benchmark. The documentation checks of the authoring session are in the pull request.

**Status of the requests at authorship.**

- The survey: done, revised, `.claude/research/survey-gaussian-splatting.md`.
- The plan: this record, `draft`, revision 2.
- Training in scope, gradients from the compiler, the tiers: written into this record.
- Relightable surfels in the path tracer, and a path to the full result for each reduced scope: written into this record (revision 2).
- The compiler needs: C1, C8 and the watch item filed as #535 to #537 (recorded at 265f89d). C2 to C7 not filed, by the owner's instruction.
- The implementation of every step: not started.

**Open items at authorship.**

- **Reverse mode.** Part 4 waits on C1, which the compiler's roadmap places after 1.0. Disposition: open. Next action: the owner answers decision 10, and the compiler schedules #535.
- **The three needs of C1 that #535 does not state.** Disposition: open. Next action: the owner comments on #535, or tells an agent to.
- **The speed.** No ray test of a Gaussian and no training step ran here. Disposition: open. Next action: steps 1.5, 4.7 and 6.4.
- **The bounds of the training gates.** Each number is a proposal from no run. Disposition: open. Next action: steps 4.3 to 5.2 and 6.2 to 6.3 measure them and amend record 0002 by its rule.
- **`unpack2x16float` and atomics on the oracle.** Not checked at the pin. Disposition: open. Next action: step 1.1 and C3.
- **The papers and models.** The claims come from the survey, which read abstracts, project pages, model cards and readmes. Disposition: open. Next action: steps 1.1, 3.1, 3.2, 4.1 and 4.4 read 2DGS, 3DGRT, GLOMAP, DA3, GS-IR, IRGS and RadioGS, and amend this record where they differ.
- **The DA3-SMALL weights.** The model card says Apache-2.0. The size of about 0.16 GB is an inference. Disposition: open. Next action: step 3.2 reads the licence file of the weights and measures the size.
- **The WebGL2 rows.** Change 0054 is not at the pin, and this record did not read whether it runs atomics. The cost figures of the tiers are inferences. Disposition: open. Next action: Amendment F with record 0007.
- **The licence of the reference code.** The 2DGS, 3DGS and several relightable reference codes are non-commercial. The engine writes its own code from the papers. Disposition: open. Next action: each step's pull request states what it read.
- **The pack across browsers.** `Math.exp` may differ between JavaScript engines. Disposition: open. Next action: none in this record.
- **Not proposed.** Gaussians as a scattering medium for M3v. EVER. A raster viewer. A fast training mode. Diffusion priors. A mix of physical and baked surfels in one instance. Disposition: deferred, and none is in a step.
