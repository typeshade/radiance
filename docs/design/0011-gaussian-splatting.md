---
id: '0011'
title: Photos or a video become a 2DGS scene, trained on the compiler's reverse-mode grad and path-traced beside meshes
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
  - docs/design/0005-determinism.md
  - docs/design/0006-compiler-boundary.md
  - docs/design/0007-webgl2-tier.md
  - docs/design/0008-interaction-controls.md
  - docs/plan.md
compiler: ['0006-1', '0006-5']
---

**Document control**

| Field         | Value                                                                                                                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity      | Design record 0011, status `draft`. Five parts, 26 decisions, 8 amendments owed (A to H), 7 compiler proposals owed (C1 to C7). Branch `claude/record-0011-gaussians`                                                     |
| Date          | 2026-10-09 (UTC), the date of authorship. On that date the owner asked for a plan for 2D and 3D Gaussian splatting. The owner then put training in scope, set the gradients on the compiler, and asked for fallback tiers |
| Author        | Written in an agent session for the owner. The owner's review is the approval                                                                                                                                             |
| Applicability | The kernels and the host of `@typeshade/radiance`. The loaders and exporters of `@typeshade/radiance-addons`. A new package `@typeshade/radiance-capture`. The gates in `scripts/`. Seven proposals to the compiler       |
| Baseline      | `main` at a0106e0. The compiler pinned at 596c805. Every line number below is a line of that commit                                                                                                                       |
| Source        | The survey `.claude/research/survey-gaussian-splatting.md`, written in the same pull request. Every claim about a paper, a model, a format or a viewer rests on it, with its URL. Item numbers below are the survey's     |
| Pull request  | The pull request that carries this record and its survey is its review                                                                                                                                                    |

## What changes

The owner asked on 2026-10-09 for a plan for 2D and 3D Gaussian splatting. Three owner directions of the same day set the scope:

1. **Training is in.** A user gives a video or several photos, and the system produces a 3D scene through 2D Gaussian splatting (2DGS).
2. **Gradients come from the compiler.** TypeShade is to support forward and reverse mode `grad` officially. The training's gradients come from the compiler's reverse mode, not from hand-written backward kernels.
3. **Fallback tiers.** Training and rendering run on WebGPU first. WebGL2 (the compiler's change 0054) and the CPU are fallbacks. A fallback may be slow, and it is better than a failure.

This record writes the whole pipeline as five parts. Each part has its own steps and gates, so an agent can implement it alone. The order of the parts is the order of decision 3.

### The pipeline

| Stage and part | Input                                 | Output                                                                | Runs on                                          | Compiler work it needs                        |
| -------------- | ------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------- |
| Part 1. Render | A `SplatGeometry` (trained or loaded) | Splats in the path tracer's image, beside meshes and spheres          | The path tracer's tiers (record 0007 for WebGL2) | None at the pin. A probe of `unpack2x16float` |
| Part 2. Ingest | A video file, or a set of photos      | 100 to 300 sharp frames, downscaled, with EXIF intrinsics where known | The browser (WebCodecs), the M7 host             | None                                          |
| Part 3. Poses  | The frames and the known intrinsics   | A `CaptureDataset`: intrinsics, a pose for each frame, sparse points  | A server or the M7 host first. The browser later | None                                          |
| Part 4. Train  | A `CaptureDataset`                    | A trained `SplatGeometry` of surfels                                  | WebGPU first, WebGL2 and the CPU as fallbacks    | C1 to C7 (below)                              |
| Part 5. Output | The trained surfels                   | A `Splats` in the scene, a `.ply`, a glTF, and an optional TSDF mesh  | Every tier                                       | None beyond part 4's                          |

**The chosen primitive is the 2D surfel.** A surfel is a flat Gaussian disk. The training rasterizer (part 4) and the path tracer (part 1) meet it with one formula, the ray-plane test of 2DGS (survey item 2). So the trained scene renders by ray tracing much as it was trained (inference, measured by step 4.5). 3D Gaussians (3DGS) stay as a second kind, for imported assets only.

### Before

These are facts, read at `main` a0106e0 and the pin 596c805.

- **No splat.** No file in the tree names a Gaussian splat, except the Gaussian pixel filter that record 0009 (part 3) rejects.
- **The primitives.** Record 0001 states two: the triangle, in a BLAS, and the analytic sphere, a TLAS instance with `flags` bit 0 (Amendment 3). The code has the triangle only. `packages/radiance/src/objects` holds `Mesh.ts` alone.
- **The walk.** `nearest(origin, dir, limit)` in `intersect.shade.ts` (lines 182 to 256) walks the TLAS and each BLAS with two stacks of 32 `u32`. `occluded` (line 260) is the same walk and stops at the first hit. `Hit` (lines 54 to 64) is `{ t, instance, triangle, b1, b2 }`.
- **The path.** `radiance` in `trace.shade.ts` (lines 146 to 191) adds a hit's emission only on the camera ray or after a specular bounce. Next-event estimation covers the rest through the light table.
- **The buffers.** `trace` binds seven storage buffers (record 0001, rule 1). `vertices` is `array<vec4>`, `triangles` is `array<vec4u>`. An instance's word `[7]` is `(bits(flags), bits(geometryId), 0, 0)`.
- **`grad`.** The compiler's `grad(m, fn, param)` is forward mode, a few parameters a call. It passes `if` and constant-bounded `for`, not a runtime-length `while` (plan section 3.1, item 2). The compiler's roadmap lists "Reverse-mode `grad`" after 1.0. It "needs the tape and the memory rules a design issue has to settle" (`vendor/typeshade/docs/roadmap.md`, line 295).
- **Atomics.** The compiler lowers WGSL atomics (`vendor/typeshade/src/compiler/ts/lower/atomics.ts`). WGSL has `atomic<u32>` and `atomic<i32>` only, with no float atomic. Plan section 1 says that compute with atomics is WGSL only, read at e923a34. This record did not read whether the oracle runs an atomic at 596c805.
- **Tiers.** At the pin the runtime runs on WebGPU only. Change 0054 (WebGL2 compute) is accepted on the compiler's `main` and is not at the pin. Change 0042 (a WebAssembly tier, "bit for bit with the oracle") is a `draft` at the pin.
- **`unpack2x16float`** is a builtin at the pin (`vendor/typeshade/src/core/builtins/coredef.ts`, line 649). Its outputs and its determinism row are not checked here.
- **Loaders.** `packages/addons/src/loaders` holds `GLTFLoader.ts` alone. There is no exporter directory and no capture package.

### After

| Contract                | After this record                                                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host model (part 1)     | `SplatGeometry` holds Gaussians of one kind: surfels (kind 1) or 3D Gaussians (kind 0). `Splats` is an `Object3D` that draws one, as `Mesh` draws a `BufferGeometry`            |
| Buffers (part 1)        | No new buffer. A Gaussian is 4 `vec4` in `vertices`. Its higher colour terms are `f16` pairs in `triangles`. Its BLAS is in `nodes`. The TLAS flag is bit 1, `INSTANCE_SPLATS`  |
| Path (part 1)           | A ray accepts each Gaussian it crosses with the chance of its alpha, by a hash. The nearest accepted one ends the path with its radiance. A shadow ray stops at an accepted one |
| Dataset (parts 2 and 3) | `CaptureDataset`: frames, intrinsics, poses, sparse points. Read from a COLMAP sparse model or a `transforms.json`. Made by the ingest and a pose service                       |
| Training (part 4)       | `@typeshade/radiance-capture` trains surfels on the compiler's reverse-mode `grad`. Adjoint sums are fixed point, so they do not depend on the order of their additions         |
| Determinism (part 4)    | A training run is bit-identical on one device and driver for one seed. Across devices and tiers the promise is a quality band, not bits                                         |
| Tiers (all parts)       | WebGPU first. WebGL2 and the CPU as fallbacks. Each result is held to the oracle, with no speed promise                                                                         |
| Output (part 5)         | The trained scene is a `Splats`. `SplatExporter` writes `.ply` and glTF. `extractMesh` gives a `BufferGeometry` by TSDF fusion                                                  |

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
  /** The spherical-harmonic degree, 0 to 3. */
  shDegree: 0 | 1 | 2 | 3;
  /** (shDegree + 1)^2 coefficients per Gaussian, rgb each, coefficient-major. */
  sh: Float32Array;
  /** 'srgb' when the colour is sRGB as captured, 'linear' when it is linear. */
  colorSpace: 'srgb' | 'linear';
  /** True when the asset was trained with the 3D filter of Mip-Splatting. Kept, not applied. */
  antialiased: boolean;
  version: number;
}

/** An object that draws one SplatGeometry. */
class Splats extends Object3D {
  readonly isSplats = true;
  geometry: SplatGeometry;
  /** A factor on the radiance of every Gaussian. 1 by default. */
  intensity: number;
  constructor(geometry: SplatGeometry);
}
```

- **Physical values.** The classes hold the scale, the opacity and the colour after their activation functions. A loader or the trainer converts a file's log scale and logit.
- **Any affine transform.** The kernel tests a Gaussian in the object's space, as it tests a triangle. A non-uniform scale is admitted.
- **No material.** The radiance is the SH colour times `intensity`.

### The GPU layout

**The instance.** A `Splats` is one element of `instances`, 8 `vec4`, as a mesh is. `[0]` to `[5]` are the matrix and its inverse, as for a mesh. `[6]` is `(bits(nodeBase), bits(primBase), bits(vertexBase), intensity)`. `[7]` is `(bits(INSTANCE_SPLATS), bits(geometryId), bits(shDegree), bits(kernel))`. `INSTANCE_SPLATS` is 2, bit 1 of `flags`. Bit 0 stays the sphere's.

**The geometry words.** Gaussian `i` takes `SPLAT_STRIDE` = 4 elements of `vertices`, from `vertexBase + 4 * i`:

| Element | Words                   | Content                                              |
| ------- | ----------------------- | ---------------------------------------------------- |
| `[0]`   | `(cx, cy, cz, opacity)` | The centre in object space, and the opacity          |
| `[1]`   | `(m00, m01, m02, c0r)`  | Row 0 of `M`, and the red SH coefficient of degree 0 |
| `[2]`   | `(m10, m11, m12, c0g)`  | Row 1 of `M`, and the green coefficient of degree 0  |
| `[3]`   | `(m20, m21, m22, c0b)`  | Row 2 of `M`, and the blue coefficient of degree 0   |

`M` maps object space to the Gaussian's unit space. For a surfel, rows 0 and 1 are the two tangent axes divided by their scales, and row 2 is the unit normal. For a 3D Gaussian, `M = S^-1 R^T`. The host computes `M` in `f64` and rounds each word to `f32`.

**The colour words.** The coefficients above degree 0 take `SH_WORDS[shDegree]` elements of `triangles`, from `primBase + SH_WORDS[shDegree] * i`. Each `u32` holds two `f16` values, the even value in the low half. The values run coefficient by coefficient, red, green and blue inside each.

| `shDegree` | Values above degree 0 | `u32` words | `SH_WORDS` (`vec4u`) | Bytes a Gaussian, both buffers |
| ---------- | --------------------- | ----------- | -------------------- | ------------------------------ |
| 0          | 0                     | 0           | 0                    | 64                             |
| 1          | 9                     | 5           | 2                    | 96                             |
| 2          | 24                    | 12          | 3                    | 112                            |
| 3          | 45                    | 23          | 6                    | 160                            |

**The BLAS.** Record 0001's nodes, from `nodeBase`. A leaf's `a` is its first Gaussian, relative to the geometry, with at most 4 in a leaf. The box of a Gaussian is its ellipse or ellipsoid at three standard deviations. Along axis `j` the half-extent is `3 * sqrt(sum over k of (R[j][k] * s[k])^2)`. The host rounds the lower corner down and the upper corner up to `f32`.

**Sizes.** At 128 MiB a binding, `vertices` holds 2,097,152 Gaussians at 64 bytes, less the meshes. At degree 3, `triangles` holds 1,398,101 Gaussians. These are arithmetic. Record 0006 item 1 (device limits) raises them.

### The kernel

`splat.shade.ts` is a new kernel file. It uses `+`, `-`, `*`, `/`, `dot`, `sqrt`, `select` and comparisons, and `pow` for a value only. The training package imports the same file (part 4), so one formula serves both.

| Function                          | What it does                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------------- |
| `falloff(q)`                      | `exp(-q / 2)` for `q` in `[0, Q_MAX]`, from a polynomial and products. 0 above `Q_MAX`            |
| `hitSurfel(og, dg)`               | `t = -og.z / dg.z`, and `q` the sum of the squares of `(og + dg * t).xy`. It returns `vec2(t, q)` |
| `hitGaussian(og, dg)`             | `t = -dot(og, dg) / dot(dg, dg)`, and `q` the squared length of `og + dg * t`                     |
| `accept(alpha, key, slot, i)`     | True when `toUnit(hash2(hash2(key, slot), i))` is below `alpha`                                   |
| `shColor(i, instance, dir)`       | The SH sum for the unit direction `dir` in object space, plus 0.5, clamped at 0                   |
| `splatRadiance(i, instance, dir)` | `shColor`, made linear when the geometry is sRGB, times `intensity`                               |

Here `og = M (o - c)` and `dg = M d`, in the object's space. The direction is not normalised, so `t` stays a world-space parameter. A test misses when its divisor is 0, when `t` is not above 0, when `t` is not below the limit, or when `q` is above `Q_MAX`. `alpha = min(opacity * falloff(q), ALPHA_MAX)`, and an `alpha` below `ALPHA_MIN` is not met. `Q_MAX = 9`, `ALPHA_MIN = 1 / 255` and `ALPHA_MAX = 0.99` follow the 3DGS reference renderer.

**The stochastic choice** (survey items 7 and 10). Each Gaussian that a ray crosses is accepted when `accept` returns true. The nearest accepted one is the hit. Each Gaussian has its own hash, so it is accepted with the chance `alpha`, independently. The chance that the `k`-th Gaussian is the hit is `alpha_k` times the product of `1 - alpha_j` over the nearer ones. That is the weight of front-to-back compositing. The result does not depend on the order of the visits, so the walk needs no k-buffer and no sort.

**The falloff** meets `exp(-q / 2)` within 1e-6 absolute on `[0, 9]`. Step 1.1 chooses the form: a polynomial in `q`, or a polynomial in `q / 16` squared three times. No `exp` decides (record 0005, rule 2).

### The walk and the path

- **The walk.** `nearest(origin, dir, limit, key)` and `occluded(origin, dir, limit, key)` gain `key`. An instance with `INSTANCE_SPLATS` walks its BLAS. A leaf calls `hitSurfel` or `hitGaussian` by `[7].w`. It keeps a Gaussian when `t` is below `hit.t` and `accept` is true.
- **The hit.** A splat hit sets `triangle` to the Gaussian's index relative to its geometry, `b1` to `q` and `b2` to 0. The instance's `flags` tell it apart.
- **The path.** `radiance` adds `throughput * splatRadiance(...)` at a splat hit after any bounce, and the path ends. No light-table row samples a splat, so nothing counts its light twice.
- **The shadow ray.** `occluded` returns true at the first accepted Gaussian. The mean is the transmittance through the splats.
- **The key.** `radiance` passes `hash2(hash2(pixelSeed, index), 2 * bounce)` to `nearest`, and the same with `2 * bounce + 1` to `occluded`.
- **Scenes without splats** give the same bits as before. Step 1.3 checks every golden and every differential number.

| Effect                                             | After part 1                                   |
| -------------------------------------------------- | ---------------------------------------------- |
| A mirror or glass mesh shows the splats            | Yes                                            |
| A mesh receives the light and the shadow of splats | Yes. The light by BSDF sampling only           |
| The splats receive the shadow or light of a mesh   | No. Their radiance is the light of the capture |
| A light of the scene relights the splats           | No. A later record, with a material per surfel |
| Depth of field and any camera ray of record 0010   | Yes                                            |

### Loaders and the rules of part 1

- **`SplatLoader`** in addons reads the INRIA `.ply` (3D), the 2DGS `.ply` (`scale_0..1`), `.splat`, and `.spz` versions 2 and 3 (gzip through `DecompressionStream`). `GLTFLoader` reads `KHR_gaussian_splatting`. `.spz` version 4 (ZSTD), SOG (WebP), the compressed `.ply` and `.ksplat` wait (decision 6). A package imports nothing outside the runtime and its siblings (`CLAUDE.md`).
- **Rules.** Every random number is `hash2` and `toUnit` (rule 1). `falloff` is a polynomial (rule 2). `pow` makes a value and is in `ALLOWED` of `determinism-lists.ts`. No atomic (rule 4).
- **The pack across browsers.** ECMAScript leaves the accuracy of `Math.exp` to the engine. So a loaded file may give other words in another browser. The gate scenes write their words directly.

## Part 2: ingest

`@typeshade/radiance-capture` (decision 4) reads a video or photos into frames.

- **Video.** A minimal ISO BMFF (MP4 and MOV) reader in the package finds the video track's samples. `VideoDecoder` (WebCodecs) decodes them. The browser's codecs set what plays. Decision 7 asks whether to write the reader or admit one dependency.
- **Photos.** `createImageBitmap` decodes JPEG, PNG and WebP. An EXIF reader in the package reads `Orientation`, `FocalLength` and `FocalLengthIn35mmFilm`. With the last, `fx = f35 / 36 * width`. Without EXIF, the pose stage estimates the focal length.
- **Selection.** A compute kernel, `sharpness.shade.ts`, computes the variance of the Laplacian of each frame's luminance, with one fixed-order reduction (record 0005, rule 5). From a video, the ingest keeps the sharpest frame of each window of `k` frames. `k` makes the count near the target, 200 by default. It drops a frame whose sharpness is under half the median.
- **Size.** Each frame is scaled to at most 1,600 pixels on its long side, the 3DGS convention. Frames stay on the host as `ImageBitmap`s. Training uploads one frame a step.

## Part 3: poses and the sparse start

**The contract.** A `CaptureDataset` holds, for each frame, the image, a pinhole intrinsic `(fx, fy, cx, cy)` and a pose (camera to world). It holds sparse points with colours. It is read from a COLMAP sparse model (`cameras`, `images`, `points3D`, binary or text) or a nerfstudio `transforms.json`. A non-pinhole COLMAP model is refused with a `TypeError` that names it.

**The pose service.** Part 3 fixes the contract, not a model. The field changes monthly (survey items 21 to 25).

| Path                         | What runs                                                   | Licence                      | Where                        |
| ---------------------------- | ----------------------------------------------------------- | ---------------------------- | ---------------------------- |
| GLOMAP, with COLMAP features | Global SfM. COLMAP's sparse model out                       | BSD                          | A server, or the M7 host     |
| VGGT-1B-Commercial           | Feed-forward cameras and points, for a few photos           | Commercial use since 2025-07 | A server with a GPU          |
| DUSt3R, MASt3R, MASt3R-SfM   | Feed-forward point maps and SfM                             | CC BY-NC-SA 4.0              | Not used (decision 9)        |
| The user's own               | A COLMAP folder, a `transforms.json`, or poses from a phone | The user's                   | Anywhere                     |
| The engine's own renders     | The path tracer renders known views of a known scene        | Apache-2.0                   | Every tier. The gates use it |

- **The browser.** No supported WebAssembly build of COLMAP or GLOMAP is known (survey item 21). VGGT's `fp16` weights are about 2.4 GB, and ONNX Runtime Web caps WebAssembly memory at 4 GB (inference, survey item 23). So the browser sends the frames to a pose service and receives a `CaptureDataset` (decision 8).
- **The service** is not part of the engine's packages. The guide documents a recipe: GLOMAP's command line on the frames, and the COLMAP model back. The M7 host may run the same command.
- **Initialisation.** The host turns each sparse point into a surfel. The centre is the point. The two scales are the mean distance to its three nearest points, through a uniform grid, in `f64`. The normal faces the mean of the cameras that see the point. The opacity is 0.1. The SH degree-0 term comes from the point's colour.

## Part 4: training

### The model and the loss

A surfel has 58 parameters at degree 3. They are the centre (3), the rotation (4), the two log scales (2), the opacity logit (1) and the SH coefficients (48). The loss of one step, for one frame, follows 2DGS (survey item 2). It is `(1 - lambda) * L1 + lambda * D-SSIM` with `lambda = 0.2`, plus the depth-distortion term and the normal-consistency term at the paper's weights. Step 4.1 reads the weights from the paper and writes them here.

**One step.**

1. Pick the frame: a permutation of the frames by the seed, a new one each epoch.
2. Project: one invocation for each surfel computes its screen bounds and its depth.
3. Bin: make one key for each (tile, surfel) pair from the tile index and the depth. Sort the keys with a stable radix sort.
4. Render: one workgroup for each 16 by 16 tile. Each pixel walks its tile's list and meets each surfel with `hitSurfel`.
5. Store each pixel's colour, depth terms, final transmittance and count of contributors.
6. Loss: a kernel computes the loss image and its sum, in one order.
7. Backward: the compiler's reverse mode gives the adjoints of steps 2, 4 and 6.
8. Adam: one invocation for each parameter updates the value and both moments.
9. Densify: every 100 steps until step 15,000, clone, split and prune surfels by the 3DGS rules.

The defaults are 30,000 steps, with a preview at 7,000. The SH degree rises by one each 1,000 steps, up to 3. The render of step 4 meets each surfel with the formula of part 1. The order differs: training sorts by the depth of the centre, and the path tracer takes the nearest accepted `t`.

### Where the gradients come from

**The recommendation is the compiler's reverse-mode `grad`** (decision 10). The owner's direction is that TypeShade supports forward and reverse mode officially. Training needs the gradient of one scalar loss with respect to millions of parameters. Forward mode gives a few parameters a render, so it cannot train. Part 4 therefore waits on a compiler change, C1, and this record proposes to pull reverse mode before 1.0.

**What C1 must settle for this use.** These are requirements, written as this engine needs them. The compiler's procedure and its owner decide the design.

| Item                        | The need                                                                                                                                                                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The tape                    | Store, recompute or checkpoint. A pixel meets up to thousands of surfels, so a stored tape of every step does not fit. The reference trainers store the final transmittance and the count, and walk back by division by `1 - alpha` |
| The tape, continued         | C1 must allow that walk: by checkpoints with a declared bound, or by an inverse of the loop state that the author declares                                                                                                          |
| Runtime-length loops        | The per-pixel loop over the sorted list has a runtime length. Reverse mode must pass a `while` whose count the forward pass records. Forward mode does not pass one today                                                           |
| A gather's adjoint          | The forward pass reads a surfel's parameters in many pixels. The adjoint adds into them from many pixels, a scatter. WGSL has no float atomic. The sum must be deterministic, and the oracle must define the same result            |
| The API                     | A backward entry made from a `@compute` entry, the bindings to differentiate and the adjoint of the outputs. Or `vjp` of a kernel function, with the loop and the scatter written by the author, as a smaller first step            |
| Bindings                    | An adjoint buffer for each differentiated binding raises the count. A training entry stays under eight storage buffers (record 0001, rule 1, and record 0006, item 9). C1 must let adjoints share a buffer, or report the count     |
| The oracle's gradient check | The oracle runs the backward entry. A compiler test holds it to central finite differences in `f64` and to forward-mode `grad` on the same parameters (the compiler's roadmap item 20)                                              |
| WebGL2 (change 0054)        | A backward entry runs on the WebGL2 tier too, or is reported as outside it with a reason, as change 0054 reports `f16` and subgroups                                                                                                |
| Determinism                 | The compiler's determinism report lists the backward entry's rows, as it lists a forward entry's                                                                                                                                    |

**The fixed-point sum.** Part 4 asks C1 for one result on every tier. Each contribution `g` to an adjoint becomes the integer `round(g * 2^F)`, where `F` is the scale of its parameter group. The integers add in 64 bits, as two `u32` words. The carry goes to the high word when the low word wraps. Integer addition is associative, so the sum is the same in any order. WebGPU adds by atomics. WebGL2 and the CPU add by a sorted gather or a plain loop. The adjoint is that sum divided by `2^F`. Step 4.1 sets `F` for each group from the gradients of the gate scene. A contribution outside the range is clamped and counted, and each step reports the count.

**The interim alternative: hand-written backward kernels.** The engine writes the adjoint of steps 2, 4 and 6 by hand. gsplat, Brush and the 3DGS code do the same. Forward-mode `grad` and finite differences on the oracle check it. It does not wait on the compiler. Its cost: each backward kernel is about as large as its forward kernel. Every change to a forward kernel needs its twin, and each pair needs its own gradient check. This record does not take it by default.

### Determinism in training

- **The promise** (decision 11). On one device and one driver, one `CaptureDataset`, one seed and one step count give one trained scene, bit for bit. Across devices and tiers, there is no bit promise. The PSNR of the trained scene on held-out frames stays in a band of the WebGPU run, which step 4.5 measures.
- **Why no bits across devices.** An optimisation amplifies a one-ulp difference over thousands of steps (inference). So rule 2 of record 0005 buys nothing across devices for a training kernel. Amendment D exempts the training kernels from rule 2 and keeps rules 1, 3, 5 and 6. Rule 4 becomes: an accumulation is integer, so its order does not matter.
- **One mode.** The record proposes one mode, the deterministic one. A fast mode with float compare-and-swap or subgroups is not proposed. If the measured speed needs one, a later record adds it behind an option that names it (rule 6).

### Budgets

- **Memory.** A surfel at degree 3 has 58 parameters. Each has a value (4 bytes), a fixed-point adjoint (8) and two moments (8), so a surfel takes 1,160 bytes (arithmetic). The training scene has a fixed capacity, allocated once. The default cap is 500,000 surfels in a browser on WebGPU (580 MB) and 2,000,000 on the M7 host. Densification stops at the cap. Pruning frees slots by a prefix sum.
- **Time.** No step ran here. Fact from the survey: 3DGS takes about 6 minutes for 30,000 steps on a desktop CUDA GPU (survey item 6). Brush trains in a browser (item 27). Inference: a browser run is several times slower. Step 4.5 records the steps a second and the time to the preview. The record sets no minimum (decision 25).

## The tiers

The engine runs on WebGPU first. WebGL2 and the CPU are fallbacks. The oracle holds the result of a fallback. The plan promises no speed on a fallback (decision 12). Each cost below is an inference, an order of magnitude, from no measurement of this work.

| Tier   | Render (part 1)               | Train: forward | Train: reverse                   | Sort                                                      | Adjoint sum                                  | Cost against WebGPU (inference) | What the gates check                                      |
| ------ | ----------------------------- | -------------- | -------------------------------- | --------------------------------------------------------- | -------------------------------------------- | ------------------------------- | --------------------------------------------------------- |
| WebGPU | Yes                           | Yes            | Yes, when C1 lands               | Radix sort with integer atomics                           | Fixed point by `u32` atomics                 | 1                               | Every gate of this record                                 |
| WebGL2 | Yes, when record 0007 lands   | Yes            | If C1 covers change 0054         | Radix sort if change 0054 runs atomics, else a merge sort | The same fixed-point sum, by a sorted gather | 3 to 30 times slower            | The differential and determinism gates against the oracle |
| CPU    | Yes, the reference mode of M4 | Yes            | Yes, the oracle's backward entry | A plain sort on the host                                  | The same fixed-point sum, in one loop        | 100 to 10,000 times slower      | It is the reference, and the gradient check runs on it    |

- **The CPU tier** is the compiler's oracle. When change 0042 lands, it may be the WebAssembly tier, which that change states is "bit for bit with the oracle".
- **One sum on every tier.** The adjoint sum is an integer sum, so each tier gives the same sum from the same contributions. The contributions themselves differ by rounding between tiers.
- **The choice.** The renderer and the trainer take WebGPU when the browser has it, else WebGL2 when the runtime gives it, else the CPU. The result names the tier that ran.
- **The CPU as a training path** (decision 13). The oracle took 20 to 38 seconds for a 16 by 16 render at 256 samples (record 0009, citing `scripts/gates.mjs`). Inference: a training step at 1,600 pixels on the CPU takes many seconds. The record proposes the CPU as a supported fallback with a reduced default budget: frames at 400 pixels, 50,000 surfels, 7,000 steps. It states the expected time before it starts, and the user may stop it.

## Part 5: output

- **Into the scene.** `capture.result()` gives a `SplatGeometry` of surfels. A `Splats` of it goes into a `Scene` with meshes, lights and the camera of record 0010. Part 1 renders it.
- **Export.** `SplatExporter` in addons writes the 2DGS `.ply` layout and a glTF with `KHR_gaussian_splatting`. The extension's `ellipse` kernel is a 3D Gaussian, so a surfel is written with a third scale of 0. A 3DGS viewer then draws it with its EWA projection, which distorts a flat disk.
- **Mesh** (decision 20). `extractMesh(capture, { voxel })` renders the median depth of each training frame. It fuses the depths into a TSDF grid, with one invocation for each voxel and a gather over the frames, so no atomics. It runs marching cubes with a prefix sum. It gives a `BufferGeometry` without colours.
- **Uses of the mesh.** Export, an occluder for record 0008's cast, and a later shadow catcher (plan section 7). The grid is dense, 256 cubed by default (64 MB of `f32`).

## The gates

These follow record 0002. Amendment B owes the text. Every bound below is a proposal that its step measures, and may amend by record 0002's rule.

| Gate or test                    | What it proves                                                                            | Scene and size                                       | Number                                                                                                      | Runs in        |
| ------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------- |
| `differential`, scene `splats`  | The GPU's render of splats beside meshes is within tolerance of the oracle's              | `splats`, 16 by 16, 256 samples                      | `ORACLE` by record 0002's rule: `mean` at ten times the measured value, `abs` 1e-3, `rel` 5 %               | harness        |
| `differential`, row `splat-hit` | `hitSurfel`, `hitGaussian` and `alpha` agree on the GPU and the oracle, one ray at a time | 4,096 rays from `mulberry32` with seed 2             | 0 rays outside: `t` within `16 * ulp(S)`, `alpha` within 1e-6                                               | harness        |
| `determinism`, scene `splats`   | Two renders of one seed are bit-identical, and another seed differs                       | `splats`                                             | 0 differing floats                                                                                          | check, harness |
| `render`                        | The example's picture is its golden                                                       | `splats` example, 96 by 64, 64 samples               | record 0002's tolerance                                                                                     | harness        |
| `splat.test.ts`                 | `falloff`, the two tests, `shColor` and the compositing law, against `f64`                | the oracle                                           | `falloff` within 1e-6. The composite within 4 standard errors over 65,536 keys                              | check          |
| `gradcheck`                     | The backward entry's adjoints equal finite differences and forward-mode `grad`            | 16 surfels, 16 by 16, one frame, the oracle          | Relative 1e-3 against `f64` central differences where the gradient is above 1e-4. 1e-5 against forward mode | check          |
| `train-differential`            | One GPU step's adjoints are within tolerance of the oracle's                              | 256 surfels, 32 by 32, one step                      | The relative error of the adjoint vector at most 1e-4, in the 2-norm                                        | harness        |
| `train-determinism`             | Two training runs of one seed are bit-identical, and another seed differs                 | 256 surfels, 32 by 32, 200 steps                     | 0 differing words in the parameter buffer                                                                   | harness        |
| `train-converge`                | Training recovers a scene that the path tracer rendered                                   | 64 views at 128 by 128 of a known scene, 3,000 steps | PSNR on 8 held-out views at least 28 dB. Chamfer distance of the TSDF mesh at most 1 % of the box diagonal  | by hand        |
| `ingest`                        | The demuxer, the EXIF reader and the selection                                            | fixtures                                             | A synthetic video with 10 blurred frames keeps none of them. Each fixture gives its fields                  | check          |
| `bench`                         | The speed, recorded and not held                                                          | a real capture                                       | Steps a second, the time to 7,000 steps, the peak memory, the PSNR at 7,000 and 30,000 steps                | by hand        |

**The scene `splats`.** 512 surfels and 64 3D Gaussians on a ring, with opacities from 0.2 to 0.95 and degree 1. A diffuse floor, an emissive quad and a mirror quad that shows the ring. The words are written directly, with no file and no `exp`.

**The converge scene.** The path tracer renders it from known poses. So the data, the poses and the true surface are known, and no external dataset and no pose service run in CI. The scene is a textured object of record 0010 on a floor, under a fixed light. `train-converge` moves into the harness when its time fits CI.

**Prove the instrument.** Each instrument shows that it can fail before it is trusted to pass (record 0002).

1. The compositing test fails when `accept` ignores `i`.
2. The render gate fails when every scale grows by 1 %. If 1 % passes, step 1.5 records the smallest growth that fails.
3. `gradcheck` fails when one adjoint's sign is changed in a scratch branch.
4. `train-differential` fails when one pixel's contribution is dropped in the GPU's sum.
5. `train-converge` fails when the learning rate of the centres is 0.
6. `train-determinism` fails when a float compare-and-swap loop replaces the fixed-point sum on WebGPU. If SwiftShader does not show it, the step records that and proves the gate with a changed order of the frames.

## Why

**The evidence.** The survey ranks the options. Its sources are cited there.

- 2DGS gives surfels with exact depth and normals by a ray-plane test (item 2). The same test serves training and ray tracing. 3DGS's EWA projection does not serve both.
- Ray-traced Gaussians and mixed mesh scenes are established (items 3, 6, 9, 17). A stochastic choice makes ray tracing of transparent Gaussians sorting-free and unbiased (items 7, 10).
- Training on WebGPU-class hardware in a browser works (Brush, item 27).
- Raster viewers on the web are many (antimatter15, gsplat.js, GaussianSplats3D, Spark, PlayCanvas). None trains from a video, path-traces meshes beside the result, checks against a CPU reference or promises bits.

**Alternatives.**

- **Render only, no training.** The first draft of this record. The owner put training in scope.
- **3DGS training.** More assets and tools exist. But the trained scene would not render by ray tracing as it was trained. Rejected for the capture path. 3DGS assets stay loadable (part 1).
- **Hand-written backward kernels.** The interim alternative of part 4. Not the default, by the owner's direction.
- **Float atomics by compare-and-swap.** The sum depends on the order, so a training run is not reproducible. Rejected.
- **A k-buffer in the path tracer**, as 3DGRT does. It needs a sorted array for each ray, a second loop of runtime length, and an `exp` that decides. Rejected for the stochastic choice.
- **An eighth storage buffer for splats.** It breaks record 0001's rule 1. Rejected.
- **Poses in the browser now.** No supported WebAssembly SfM is known, and the feed-forward models are too large for a default (part 3). Later, when one fits.
- **A raster viewer in the real-time tier** (option A of the survey). It competes on others' ground. The training rasterizer gives a preview of a trained scene anyway (inference).

## What it touches

- **`@typeshade/radiance`.** `splat.shade.ts` (new), `intersect.shade.ts`, `trace.shade.ts`, `layout.shade.ts`, `SplatGeometry.ts` and `Splats.ts` (new), `bvh.ts` (`buildBoxes`), `scene-pack.ts`, `index.ts`, `__api__`.
- **`@typeshade/radiance-addons`.** `SplatLoader.ts` (new), `GLTFLoader.ts`, `src/exporters/SplatExporter.ts` (new), `src/scenes` (the gate scenes), `__api__`.
- **`@typeshade/radiance-capture`** (new, `packages/capture`). Ingest (`mp4.ts`, `exif.ts`, `sharpness.shade.ts`), `CaptureDataset` and its readers, initialisation, the training kernels, Adam, densification, the TSDF and marching cubes. `scripts/boundary.mjs` admits the new package as a sibling.
- **Gates.** `scripts/gates.mjs`, `scripts/gates/*`, `scripts/probes/hit-splat.shade.ts`, `scripts/harness-entry.ts`, `scripts/scenes.ts`, the goldens.
- **Records.** Amendments A to H.
- **Site.** The `splats` example and a capture example that runs on the visitor's GPU. Guide pages for what a splat does in a path tracer, and for the tiers.
- **Not touched.** `materials`, `lights`, `accum`, `TraceParams`, the sampler's sequences.

## Compiler proposals owed

These are needs that typeshade/typeshade's `changes/` would carry. This record opens none of them. The owner opens each by the compiler's procedure. Amendment E lists each one in record 0006.

- **C1. Reverse-mode `grad` before 1.0.** Part 4's table lists the needs. They are the tape, runtime-length loops, a gather's adjoint, the API, the bindings, the gradient check, WebGL2 and the report. It blocks part 4.
- **C2. A sort.** A stable radix sort of `u32` keys with values, as a kernel package or a runtime primitive, on every tier. Plan section 9 already expects it for M6s. It blocks part 4.
- **C3. Atomics on the oracle and on WebGL2.** `atomicAdd` on `u32` on the CPU, with the result of a sequential sum. On WebGL2, a form or a reported refusal. It blocks the fixed-point sum on those tiers.
- **C4. Indirect dispatch.** `dispatchWorkgroupsIndirect`, so that a step's dispatch follows the live surfel count. It was not found in `vendor/typeshade/src/runtime/` at the pin. Until it lands, every dispatch covers the capacity.
- **C5. Device limits** (record 0006, item 1). Training buffers pass 128 MiB.
- **C6. GPU time** (record 0006, item 5). The budgets need it.
- **C7. The cost of many dispatches** (plan section 9). A step is about ten dispatches, and a run is 30,000 steps.

## Amendments owed

Each amendment goes into its record in its own pull request, before the step that needs it (decision 26).

- **A. Record 0001.** A section "Gaussian splats": the instance words, the geometry and colour words, the BLAS, the limits, the walk's branch and the `Hit` fields. Before step 1.2.
- **B. Record 0002.** The scenes, rows, tests, training gates, bounds and probes of "The gates". Before step 1.3.
- **C. Record 0003.** The exports `SplatGeometry`, `Splats`, `SplatLoader` and `SplatExporter`, and the package `@typeshade/radiance-capture` with its exports. Before step 1.2.
- **D. Record 0005.** "The splats' arithmetic" for part 1. For part 4: the training promise, the exemption of training kernels from rule 2, and integer accumulation under rule 4. Before steps 1.1 and 4.1.
- **E. Record 0006.** Items C1 to C7 as new rows. Before part 4.
- **F. Record 0007.** The WebGL2 rows of the tiers table. When record 0007 is accepted.
- **G. Record 0008.** The cast meets a `Splats` at its nearest Gaussian whose `alpha` at the hit is at least 0.5. Before step 1.5.
- **H. `docs/plan.md`.** Milestones M3g and M5c, the package in section 3, C1 in section 9, and section 3.3's scope ("not a neural field") read against training. After acceptance, as its own pull request.

## Implementation, in steps

Each step is one pull request. Each commit names `Design: 0011` on a line of its own.

**Part 1, milestone M3g.**

1. **Step 1.1.** Add `splat.shade.ts` and `splat.test.ts`. Probe `unpack2x16float` on WGSL, GLSL and the oracle over all 65,536 codes. Done when the tests pass and the lint adds no row.
2. **Step 1.2.** Add `SplatGeometry`, `Splats`, `buildBoxes` and the pack's branch, with tests of the words and the errors. Done when `bun run gate:api` shows only the new names.
3. **Step 1.3.** Change the walk and the path. Add the scene `splats`, the row `splat-hit` and its probe. Done when every existing golden and number stays the same and the new rows pass.
4. **Step 1.4.** Add `SplatLoader` and the glTF extension, with fixtures. Done when each fixture gives its words.
5. **Step 1.5.** Add the `splats` example, its golden and probe, and the cast of Amendment G. Done when the render gate and its probe pass and fail as they must.

**Parts 2 to 5, milestone M5c.** Part 4 starts when the pin carries C1 and C2.

6. **Step 2.1.** Create `@typeshade/radiance-capture`. Add the MP4 reader, the EXIF reader and the sharpness kernel, with the `ingest` tests.
7. **Step 3.1.** Add `CaptureDataset`, the COLMAP and `transforms.json` readers, and the initialisation. Write the pose-service recipe in the guide.
8. **Step 4.1.** Write the forward entries, the loss and Adam. Read the 2DGS loss weights. Set `F` for each group. Run `gradcheck` on the oracle.
9. **Step 4.2.** Add the backward entry from C1, the fixed-point sum and densification. Run `train-differential` and `train-determinism`.
10. **Step 4.3.** Add the converge scene and `train-converge`. Record the PSNR and the Chamfer distance.
11. **Step 4.4.** Add the tier choice and the CPU budget. Run the gate sizes on WebGL2 and the CPU where the pin allows.
12. **Step 4.5.** Run `bench` on a real capture. Record the numbers, the cross-tier PSNR band and the agreement of the path tracer's render with the training render.
13. **Step 5.1.** Add `SplatExporter` and `extractMesh`, with a round-trip test and the Chamfer check.
14. **Step 5.2.** Add the capture example to the site. Set the record to `implemented` with the configuration and the numbers.

## Decisions for the owner

1. The engine trains 2DGS from a video or photos, and also renders imported 3DGS assets. Proposed: yes. This asks the owner, because it sets the scope.
2. The trained primitive is the 2D surfel. 3D Gaussians are a second kind, for imported assets only. Proposed: surfels. This asks the owner, because it sets the scope.
3. The order: part 1 is milestone M3g after M3. Parts 2 to 5 are milestone M5c after M5, when the pin carries C1 and C2. Amendment H changes the plan. Proposed: yes. This asks the owner, because it changes the order.
4. The training, ingest and mesh code is a new package, `@typeshade/radiance-capture`, in layer L4 beside `@typeshade/radiance-fit`. Proposed: yes. This asks the owner, because it adds a package.
5. Splats are a ray-traced primitive of the path tracer: a TLAS instance with flag bit 1, and no new buffer. A raster viewer is not in this record. Proposed: yes. This asks the owner, because it changes a layout of record 0001.
6. The read formats are the INRIA `.ply`, the 2DGS `.ply`, `.splat`, `.spz` versions 2 and 3, and `KHR_gaussian_splatting`. The written formats are the 2DGS `.ply` and the glTF extension. `.spz` version 4, SOG, the compressed `.ply` and `.ksplat` wait. Proposed: yes. This asks the owner, because it sets the scope.
7. The ingest reads MP4 and MOV with a reader written in the package, and decodes with WebCodecs. The alternative is one dependency, mp4box.js, which needs a change of the boundary. Proposed: the package's own reader. This asks the owner, because the other answer changes the boundary.
8. Poses come first from a pose service outside the browser: a server or the M7 host. The browser sends frames and receives a `CaptureDataset`. Browser-only poses are a later record. Proposed: server-assisted first. This asks the owner, because it decides where the product runs.
9. The SfM path is GLOMAP with COLMAP's features as the reference, and VGGT-1B-Commercial for a few photos. DUSt3R and MASt3R are not used, because their licence is non-commercial. User-supplied COLMAP and `transforms.json` data is always accepted. Proposed: yes. This asks the owner, because it sets the dependencies of the service.
10. The gradient method is the compiler's reverse-mode `grad` (C1), pulled before 1.0. Hand-written backward kernels are an interim path only if C1 is late, at the cost that part 4 states. Proposed: compiler reverse mode. This asks the owner, because it sets the compiler's roadmap and the start of part 4.
11. Training has one mode. It is bit-identical on one device and driver for one seed, and in a PSNR band across devices and tiers. Training kernels are exempt from rule 2 and use integer accumulation (Amendment D). No fast mode now. Proposed: yes. This asks the owner, because it changes the scope of record 0005.
12. The tiers are WebGPU first, then WebGL2, then the CPU. The oracle holds the result of a fallback. The plan promises no speed on a fallback. Proposed: yes. This asks the owner, because it adds a promise.
13. The CPU is a supported training fallback with a reduced default budget: 400-pixel frames, 50,000 surfels, 7,000 steps. It states the expected time before it starts. It is also the reference for every gate. Proposed: a supported fallback with the reduced budget. This asks the owner, because it decides what the product supports.
14. Adjoint sums are 64-bit fixed point in two `u32` words: atomics on WebGPU, a sorted gather or a loop elsewhere. A clamped contribution is counted and reported. Proposed: yes. This is a default.
15. The training defaults are 30,000 steps with a preview at 7,000, and the 2DGS loss at the paper's weights. The SH degree rises each 1,000 steps to 3. Densification runs every 100 steps until 15,000. Proposed: yes. This is a default.
16. The capacity is fixed and allocated once: 500,000 surfels in a browser on WebGPU, 2,000,000 on the M7 host. Proposed: yes. This asks the owner, because it bounds the scene size.
17. Frames are at most 1,600 pixels on the long side, 200 frames by default from a video. They stay on the host, and one is uploaded a step. Proposed: yes. This is a default.
18. The path tracer's splat rules: a ray accepts each Gaussian by a hash with the chance of its alpha. The falloff is a polynomial within 1e-6 of `exp(-q / 2)`. `Q_MAX` is 9, `ALPHA_MIN` is 1/255, `ALPHA_MAX` is 0.99. Proposed: yes. This is a default.
19. A splat hit adds its radiance after any bounce and ends the path. The scene's lights do not light splats. A shadow ray stops at an accepted Gaussian. Proposed: yes. This asks the owner, because it fixes what a splat can show.
20. `extractMesh` belongs to part 5 and is optional for the user. Its grid is dense, 256 cubed by default. Its mesh has no colours. Proposed: yes. This is a default.
21. The colour of a loaded splat is sRGB as the file's camera saw it, unless its file says linear. The kernel makes it linear at the hit. Training stores the colour in linear light. Proposed: yes. This is a default.
22. The public names: `SplatGeometry` and `Splats` in `@typeshade/radiance`, `SplatLoader` and `SplatExporter` in the addons, and `capture`, `CaptureDataset` and `extractMesh` in `@typeshade/radiance-capture`. Proposed: yes. This asks the owner, because it adds exports.
23. The colour above degree 0 is stored as `f16` pairs. If the probe of step 1.1 fails, all colour is `f32`, and a degree-3 scene holds at most 524,288 Gaussians. Proposed: `f16` pairs. This is a default.
24. Record 0008's cast meets a `Splats` at its nearest Gaussian whose `alpha` at the hit is at least 0.5. The AOVs of record 0010 give the depth `t`, the linear colour as the albedo, and the surfel's normal. Proposed: yes. This is a default.
25. The gates and their numbers are those of "The gates". No speed has a minimum. Step 4.5 records the speed, and the owner judges it. Proposed: yes. This asks the owner, because the speed is not known.
26. Each amendment of "Amendments owed" goes into its record in its own pull request, before the step that needs it. The owner's "merge" is its approval. Proposed: yes. This is a default from `CLAUDE.md`.

## Record

**Approval and plan record.** This record does not yet apply. It is `draft`. The owner asked for a plan on 2026-10-09 (UTC). On the same date the owner put training in scope, set the gradients on the compiler's reverse mode, and asked for fallback tiers. The owner has not yet said to merge it. The owner's answer to the decisions will be the acceptance.

**Configuration and validation record.** This record does not yet apply. Implementation will record the commits of each step, the pin, each gate's result and the numbers. This record is documentation only. It ran no gate, no test and no benchmark. The documentation checks of the authoring session are in the pull request.

**Status of the requests at authorship.**

- The survey: done, `.claude/research/survey-gaussian-splatting.md`.
- The plan: this record, `draft`.
- Training in scope, gradients from the compiler, the tiers: written into this record.
- The compiler proposals C1 to C7: not opened, by the owner's instruction. The owner opens them.
- The implementation of every step: not started.

**Open items at authorship.**

- **Reverse mode.** Part 4 waits on C1, which the compiler's roadmap places after 1.0. Disposition: open. Next action: the owner answers decision 10 and schedules C1.
- **The speed.** No ray test of a Gaussian and no training step ran here. Disposition: open. Next action: steps 1.5 and 4.5.
- **The sphere first.** Part 1's flagged instance follows record 0001's sphere, which is not on `main` at a0106e0. Disposition: open. Next action: step 1.3 starts after the sphere's kernel step merges.
- **`unpack2x16float` and atomics on the oracle.** Not checked at the pin. Disposition: open. Next action: step 1.1 and C3.
- **The papers and models.** The claims come from the survey, which read abstracts, project pages and readmes. Disposition: open. Next action: steps 1.1, 3.1 and 4.1 read 2DGS, 3DGRT, GLOMAP and VGGT, and amend this record where they differ.
- **The WebGL2 rows.** Change 0054 is not at the pin, and this record did not read whether it runs atomics. The cost figures of the tiers are inferences. Disposition: open. Next action: Amendment F with record 0007.
- **The licence of the reference code.** The 2DGS and 3DGS reference code is non-commercial. The engine writes its own code from the papers. Disposition: open. Next action: each step's pull request states what it read.
- **The pack across browsers.** `Math.exp` may differ between JavaScript engines. Disposition: open. Next action: none in this record.
- **Not proposed.** Relighting with a material per surfel. Gaussians as a scattering medium for M3v. EVER. Pose refinement in training. A raster viewer. A fast training mode. Disposition: deferred, and none is in a step.
