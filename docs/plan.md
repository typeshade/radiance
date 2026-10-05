# TypeShade Radiance: the plan

The product, what it is not, how it is built on the compiler, and the milestones with their
acceptance criteria. Decided with the owner on 2026-10-05 against the compiler's `main` at
e923a34; the Korean conversation that produced it is summarised here in English, as every
document in the tree is.

## 1. Context

The owner wants an engine on the TypeShade language that renders at photographic quality and
reaches, if not Houdini's breadth, something of its kind. Four decisions frame everything below:

- **Platform:** the browser (WebGPU) first, the desktop second. The core is WebGPU throughout;
  only the host differs.
- **First axis:** a progressive path tracer.
- **User:** developers. An npm library; a scene is assembled in code, with no UI.
- **Differentiator:** differentiable rendering on `grad()` (inverse rendering) is the core.

What the compiler is today, as read at e923a34:

- One IR, three outputs: WGSL, GLSL ES 3.00 and an f64 CPU oracle. Compute (atomics, workgroup
  memory, barriers) is WGSL only. A `for` or `while` may run over a runtime-length buffer
  (surface §17), so a BVH traversal can be written. `random(seed)` is a deterministic function
  (§55).
- `typeshade/runtime` (change 0025): `createRuntime`, `load(program).render()/compute()`,
  `frame()/pass()/draw()/dispatch()/submit()`, `resident()`, `texture().read()/readFloats()`. It
  ships without the compiler and runs on WebGPU only. It has **no scene, camera, light or
  material**, by decision (#335, decision 3): the reference engine lives in its own repository,
  built only on the public runtime. `journeys/engine/` is the gate for that shape, and this
  repository is that engine.
- `grad(m, fn, param)` is **forward mode**, a few parameters at a time; it differentiates through
  `if` and constant-bounded `for`, and the discontinuous builtins have a zero derivative. Reverse
  mode is after 1.0. So differentiable rendering here means **fitting a few parameters** (material
  constants, a light's intensity or position, a camera pose), not a neural field.
- Path tracing exists only as an example (`examples/path-tracer.shade.ts`, four spheres, a
  fragment shader); accumulating across frames is host work, and #204 is its design.
- The runtime has run only in Playwright's headless Chromium (`journeys/_harness.mjs`). A Node
  plus Dawn host has never been tried: the first risk of the desktop milestone.
- Roadmap 0.6 (the CPU/GPU boundary) and 0.8 (the frozen surface, the first release) are open.
  This engine stands on a pre-1.0 runtime, so what it finds goes back to the compiler as proposals
  in `changes/`.
- `typeshade/stepinside` (private, 5ab5e1d) is a separate product, a photo lifted into 3D on
  TypeShade, whose roadmap step 10 is a photoreal path trace of the shot. Its first pass exists:
  `src/shaders/trace.shade.ts` (a compute path tracer with frame accumulation) and
  `src/trace/bvh.ts` (a CPU BVH, split at the middle of the longest side, 430,000 triangles in
  0.9 s), 65 ms a sample at 1280 x 800 on an RTX 2080. Its design informs M1 and M2 here, but no
  code comes from it (section 12, decision 2). stepinside is Radiance's first consumer: what its
  roadmap wants next (next event estimation, materials, a thin-lens camera, tiling, a denoiser)
  is M3 here.

## 2. The product

**In one line:** a reproducible, differentiable physically based path-tracing renderer that runs
in the browser. A scene is assembled in TypeScript; the same kernels render it on WebGPU and are
verified on the CPU; the image can be differentiated with respect to the scene's parameters.

Three things only TypeShade can give are the product's axes:

1. **Reproducibility.** The CPU oracle and the determinism report say "this image is the same
   wherever it is rendered". Reference images, regression tests and render-farm consistency
   become features.
2. **Differentiability.** `grad()` differentiates the render with respect to its parameters, so
   fitting a material, a light or a camera runs in the browser (what Mitsuba 3 does on the
   desktop). `random(seed)` is deterministic, so path replay is natural.
3. **Procedurality.** Loops that become kernels, and npm shader packages, let an ordinary
   TypeScript `for` take the place of a Houdini VEX wrangle. Geometry and simulation nodes ship as
   packages.

**What it is not**, explicitly, for the first milestones: a node-graph UI or a DCC application
(last, and a separate product); a real-time raster game engine (head-on with three.js and short
of photoreal); the whole of Houdini's SOPs and DOPs (a few solvers as kernel packages first);
WebGL2 (no compute, so no path tracer).

## 3. Architecture: one repository, each layer on the public API of the layer below

This repository, `typeshade/radiance`, a monorepo with the npm scope `@typeshade/radiance*`. The
engine is one package of classes, `@typeshade/radiance`, as three.js is one: TypeShade is to it
what TSL is to three.js, the language its GPU code is written in. The compiler is a git
submodule (`vendor/typeshade`), as `vscode-typeshade` and `typeshade.github.io` pin it, and
`downstream-impact.ts` checks every move of the pin.

| Layer | Package                               | Contents                                                                                                                                                                                                                                                     | Language       |
| ----- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| L0    | `typeshade`, `typeshade/runtime`      | The dependency: compile, runtime, `grad`                                                                                                                                                                                                                     | (pinned)       |
| L1    | `@typeshade/radiance` (`src/kernels`) | `.shade.ts` kernels: ray generation, BVH traversal and triangle intersection, the principled BSDF, light sampling and MIS, accumulation, tone mapping, denoising. Shipped inside the engine package; later also as npm shader packages (X6)                  | TypeShade      |
| L2    | `@typeshade/radiance`                 | The engine's classes, shaped as three.js's are: the math, `Object3D` and the scene graph, cameras, geometries, materials, `Mesh`, `Scene`; packing into `resident` and storage buffers; later Light, Environment (HDRI), the BVH builder and the glTF loader | TS             |
| L3    | `@typeshade/radiance`                 | The renderers: `PathTracer`, progressive (the frame loop, sample accumulation, restart when the scene or the camera changes, `readFloats()` readback); a reference mode (the same kernels on the CPU oracle)                                                 | TS             |
| L3    | `@typeshade/radiance-addons`          | What sits beside the engine, as three.js's addons do: `OrbitControls`, the Cornell box scene, later the loaders                                                                                                                                              | TS             |
| L4    | `@typeshade/radiance-fit`             | Differentiable rendering: `fit({ scene, params, target, loss })`; `grad(m, fn, param)` over the kernels, path replay, loss and gradient descent on the host                                                                                                  | TS             |
| L5    | `@typeshade/radiance-procedural`      | SDF, displacement, particle steps, noise: the wrangle kernels, shipped as L1 is                                                                                                                                                                              | TypeShade      |
| L5    | `@typeshade/radiance-sim`             | Physics solvers, in the order the owner set: Pyro (smoke, fire, explosions; Eulerian), FLIP liquid, ocean (FFT), XPBD cloth, MPM, rigid bodies. One npm shader package per solver                                                                            | TypeShade + TS |
| L6    | `@typeshade/radiance-realtime`        | The real-time tier, in Lumen's direction: deferred PBR raster, mesh and global SDF, DDGI. Measured against the path tracer (L3) as the ground truth. Shares L1's BSDF, materials and denoiser and L5's SDF kernels                                           | TypeShade + TS |
| host  | (the renderer), later `-node`         | A renderer takes the canvas it draws on, as three.js's do; the Node plus Dawn host comes later. The core does not know its host                                                                                                                              | TS             |

The discipline of `journeys/engine/journey.mjs` holds: everything above L0 imports only
`typeshade/runtime`'s public exports and touches no WebGPU object. `scripts/boundary.mjs` checks
it in CI.

### 3.1 Constraints that shape the design (assumed from the start)

Found in the owner's review of what was missing. Each is cheap at M1 or M2 and a rewrite later.

1. **The GPU watchdog (TDR).** Windows kills a dispatch over two seconds. A frame of the path
   tracer is several dispatches of tiles times sample batches, and the watchdog budget (say
   50 ms) is a renderer option.
2. **`grad()` does not pass a runtime-length `while`** (roadmap 18: `if` and constant-bounded
   `for` only), and BVH traversal is that `while`. So differentiable rendering is designed as
   "traversal is not differentiated, shading is": traversal produces a hit record (position,
   normal, material id, UV) and `grad` differentiates the shading function after it. A parameter
   that is a shape (vertex positions) is out of scope.
3. **WebGPU binding limits.** Eight storage buffers per stage, four bind groups, 128 MB per
   buffer binding by default. The scene is packed into a few buffers (nodes, triangles, vertex
   attributes, materials, instances, lights), laid out at M2; what diagnostic the runtime gives
   past a limit is checked at M0. Limits are raised through `requestDevice`'s `limits`.
4. **The exact determinism promise.** Transcendental functions (`sin`, `exp`, `pow`) may differ
   by vendor, and the determinism report lists exactly those. The promise is "bit-identical on
   the same device and driver; identical across vendors within the operations the report lists
   as deterministic". Any farm-consistency claim is written to that scope. Design record 0005
   (`docs/design/0005-determinism.md`) states the promise and the rules a kernel is written under.
5. **Sampler quality.** A `random(seed)` hash alone converges slowly. A Sobol plus Owen-scrambled
   low-discrepancy sampler and a blue-noise mask are a module of the kernels package, used
   from M1.
6. **Instancing and a two-level BVH (TLAS/BLAS)** from M2, so that a scene of a thousand trees
   fits; instance transforms and material overrides live in TLAS nodes. Animation (M2a) is a
   BLAS refit and a TLAS rebuild.
7. **A scene graph.** Parent-child transforms, instances and LOD live in the scene package: the
   glTF node tree is taken as it is, not flattened.

### 3.2 The path tracer

- Compute kernels, not a fragment shader. The accumulation buffer is
  `storage<array<vec4f>, "read_write">`; the sample count is a uniform. A megakernel first (ray
  generation, traversal, shading, accumulation); a wavefront split when performance says so,
  with atomics for the queues.
- BVH: the host builds with SAH and flattens the nodes into a storage buffer; traversal is a
  stack loop (`while`) over that runtime-length buffer. WebGPU has no hardware ray tracing, so
  this is the only path (three-gpu-pathtracer proved it). Design record 0001
  (`docs/design/0001-scene-data-model.md`) fixes the buffers, their layouts and the two-level
  traversal from M2: triangles only, seven storage buffers, relative indices inside a BLAS.
- Materials: one principled BSDF (base colour, metallic, roughness, IOR, transmission,
  emission), later anisotropy, clearcoat and sheen. Textures are `texture_2d_array`s, one per
  size class, plus an index per material. Design record 0004
  (`docs/design/0004-materials-and-shading.md`) fixes the material record, the shading
  contract and the texture plan.
- Lights: emissive triangles, HDRI (the host computes the importance-sampling CDF), MIS; then
  point, spot and sun.
- Denoising: a simple à-trous or bilateral filter first; SVGF later.
- Large world coordinates: camera-relative coordinates first; the emulated `f64` (df64) is
  available but costly.

### 3.3 Differentiable rendering

- Traversal is not differentiated; shading is (3.1, item 2).
- Forward mode only, so the `fit` API starts with a parameter bundle of about one `vec4`: one
  render gives four partial derivatives, and the host runs Adam.
- `random(seed)` is deterministic, so the base render and the differentiated render walk the same
  paths under the same seed (path replay). Discontinuities (visibility) have a zero derivative,
  and the docs say so. Edge sampling is out of scope.
- The loss is on the host: two images through `readFloats()`, L2. The first demos are "recover
  material constants from a reference image" and "recover a light's intensity and colour".
- Roadmap 20 (the oracle's gradient check against finite differences) becomes a test as soon as
  it lands.

### 3.4 Volume rendering (M3v): the half that puts smoke, fire and clouds on screen

Imitating a phenomenon is a solver and a renderer, and smoke, fire and explosions are volumes,
not meshes, so the renderer's half is the dearer one. Added to the path tracer at M3v:

- Heterogeneous media: a density grid (a 3D storage buffer; a sparse tiled grid later) sampled by
  delta or ratio tracking; scattering (a Henyey-Greenstein phase function), absorption and
  multiple scattering come out of the path tracer by themselves.
- Emission: a temperature grid to a blackbody colour, one kernel function. Fire lighting its
  surroundings comes out by itself.
- An input that needs no solver: a noise density field for clouds and fog. M3v alone puts them
  into the product-viewer demo.
- The real-time tier approximates the same grid with froxel ray marching and temporal
  accumulation (R3v, after R3).
- A sparse grid (VDB-style tiles) is its own host-side design item. A dense grid in the browser
  is realistically 128³ to 256³; sparsity multiplies the effective resolution. Houdini Pyro's
  1000³ is out of scope.

### 3.5 The Pyro solver (M6p, the first solver): smoke, fire, explosions

An Eulerian grid with density, temperature, fuel and velocity fields. One step is advection
(semi-Lagrangian or MacCormack), buoyancy, combustion (fuel above its ignition temperature burns
into density and heat, and its expansion is a divergence source), vorticity confinement, and the
pressure solve (PCG). An explosion is the same solver with strong initial conditions and
expansion; the shock feel comes from the divergence source and a velocity impulse. The pressure
solver and the grid utilities are inherited by FLIP (M6s). Acceptance: a smoke column, a flame
and an explosion run in the browser, rendered through M3v, with two runs of the same seed
bit-identical. Long sequences need the desktop host (M7) to export frame caches to files
(determinism also allows replay without a cache).

Where the other phenomena sit: clouds and fog (M3v, no solver); wave foam and spray (FLIP
secondary particles); sand, snow and lava (MPM plus temperature); cloth and flags (XPBD); hair
(XPBD plus curve intersection in the renderer); wind on vegetation (vertex animation, no
solver); lightning, sparks and rain (procedural plus particles, M6); destruction (pre-fractured
pieces plus rigid bodies, last).

### 3.6 Physics simulation (`@typeshade/radiance-sim`; FLIP after Pyro)

Simulation is where TypeShade's strengths show more than in rendering: the whole of compute
(atomics, workgroup memory, barriers), loops that become kernels (the VEX wrangle's place),
determinism (replay without a cache), `grad()` (differentiable physics), and the CPU oracle
(solvers verified in f64).

One FLIP step is five kernel groups:

1. Particle to grid (P2G): scatter velocity and mass into cells. **WGSL has no float atomics**
   (`atomic<u32>` and `atomic<i32>` only). Either accumulate with fixed-point integer atomics or
   sort particles by cell and gather. For determinism, gather is right: atomic accumulation sums
   in driver order and breaks bit-identity. Gather first.
2. Grid forces and boundaries: gravity, solid boundaries through an SDF, free-surface marking.
3. The pressure solve: incompressibility. PCG first (a few dispatches per iteration), multigrid
   later. Tens to hundreds of dispatches a frame, so the cost of the runtime's `frame()` and
   `dispatch()` is measured at M1.
4. Grid to particle (G2P) and advection: the FLIP/PIC blend, position update, cell
   reclassification.
5. Surface reconstruction: particles to an SDF grid (anisotropic kernel) to a marching-cubes
   mesh, or the path tracer ray-marches the SDF grid directly. The mesh path changes nothing in
   the renderer, so it comes first.

Water's material is M3's principled BSDF with transmission and IOR. Scale: hundreds of thousands
to a few million particles in the browser; Houdini's tens of millions are out of scope and rise
on the desktop host (M7). f16 and subgroup operations are after 1.0, so grid solvers run under
f32 and memory bandwidth until then.

Solver order after Pyro and FLIP: ocean (Tessendorf FFT, a heightmap mesh, the cheapest and most
visible), XPBD cloth and soft bodies, SPH, MPM, rigid bodies.

### 3.7 The real-time tier (`@typeshade/radiance-realtime`; Lumen's direction, DDGI as the first goal)

Lumen is "the ground truth approximated in real time", and its software mode (SDF tracing) is
what runs without hardware ray tracing. WebGPU has no hardware ray tracing, so that is the path,
and all of it is compute. The path tracer (M3) comes first because determinism and the CPU
oracle let "how far is this real-time GI from the truth" be a number per scene, and `grad()` can
fit the approximation's parameters (probe spacing, filter strength) to the truth. Real-time GI
built before the truth cannot be known to be right.

| Stage | Contents                                                                                             | Note                                                            |
| ----- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| R1    | Deferred PBR raster: G-buffer, cascaded shadow maps, TAA                                             | The #335 reference engine itself; `journeys/engine` is the seed |
| R2    | Mesh SDF baking (compute) plus a global SDF; SDF soft shadows and AO                                 | Reuses M6's SDF kernels                                         |
| R3    | DDGI: a world probe grid filled by SDF traces, temporally accumulated. **The end of the first goal** | Most of Lumen's impression at a small cost                      |
| R4    | Surface cache (cards) plus screen-probe gather                                                       | Lumen's body; when the error gate says it is needed             |
| R5    | Reflections (SSR plus SDF traces plus denoise), a radiance cache, upscaling                          | After R4                                                        |
| R6    | The error gate against the path tracer                                                               | In CI from R3; R4 and R5 are defined as lowering its number     |

Limits to write down: no bindless (texture arrays instead), f16 and subgroups after 1.0, no mesh
shaders. Lumen spends 4 to 8 ms on a console; the target here is a desktop GPU at 1080p with
fewer probes, and mobile is out of scope. Virtual shadow maps are replaced by cascaded shadow
maps plus SDF contact shadows.

## 4. Milestones and acceptance criteria

Every milestone is done by an **image** and a **number**: a named demo and a CI gate.

| Milestone | Contents                                                                                                                                                                                                                                                                                                                       | Acceptance                                                                                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0        | The repository, the monorepo, the compiler submodule pin, the boundary check in CI, a Playwright headless WebGPU harness modelled on the compiler's `journeys/_harness.mjs`                                                                                                                                                    | CI green; one cleared frame read through `readFloats()` and held to a golden                                                                                                    |
| M1        | A compute megakernel path tracer, a Cornell box of spheres and quads, frame accumulation, tone mapping                                                                                                                                                                                                                         | A 1024 spp Cornell box within tolerance of the CPU oracle's render; two runs of one seed bit-identical                                                                          |
| M2        | Triangle meshes, SAH BVH (two-level), the glTF loader, normal and UV interpolation                                                                                                                                                                                                                                             | The Stanford bunny and part of Sponza render; spp per second at 1080p recorded                                                                                                  |
| M2a       | Animation: glTF animation (TRS tracks), skeletal skinning and morph targets (compute), BLAS refit plus TLAS rebuild, vertex motion blur (BVH time interpolation, shutter sampling)                                                                                                                                             | A walking character and a spinning propeller render with motion blur, comparable to Cycles                                                                                      |
| M3        | The principled BSDF (with anisotropy, clearcoat, sheen), texture arrays with mipmaps and ray differentials, normal maps, alpha cutout, HDRI plus MIS, area, point, spot and sun lights, a physical camera (exposure, bokeh), **AOVs (albedo, normal, depth, cryptomatte, light groups), EXR output, an ACES output transform** | A side-by-side with Blender Cycles on the same scene; the EXR opens in a compositor. "Photoreal" is judged here                                                                 |
| M3v       | Volume rendering: density and temperature grids, delta tracking, blackbody emission, NanoVDB reading                                                                                                                                                                                                                           | A noise cloud and a VDB sample file beside Cycles' volume render                                                                                                                |
| M3s       | Random-walk subsurface scattering in the principled BSDF                                                                                                                                                                                                                                                                       | Skin, wax and marble shader balls beside Cycles' random-walk SSS. A hair BSDF is outside this plan                                                                              |
| M4        | Denoising, the reference mode, the determinism report integrated                                                                                                                                                                                                                                                               | A kernel set for which the report says "zero driver-dependent operations"                                                                                                       |
| M5        | `@typeshade/radiance-fit`: material and light fitting demos                                                                                                                                                                                                                                                                    | Albedo, roughness and a light's intensity recovered from a reference image, converging in the browser                                                                           |
| M6        | The first procedural kernels (SDF, displacement, particle steps), published to npm                                                                                                                                                                                                                                             | A journey in which an external project installs them from npm and plugs them into a scene                                                                                       |
| M6p       | Pyro: advection, buoyancy, combustion, vorticity confinement, pressure PCG                                                                                                                                                                                                                                                     | A smoke column, a flame and an explosion rendered through M3v; two runs of one seed bit-identical                                                                               |
| M6s       | FLIP liquid: P2G by sorted gather, pressure PCG, G2P, surface reconstruction to a mesh, rendered by the path tracer                                                                                                                                                                                                            | A dam break runs in the browser; frame 100 of two runs of one seed bit-identical; within tolerance of a low-resolution CPU oracle run; particle count and ms per frame recorded |
| M7        | The Node plus Dawn host, an offline render CLI, simulation cache export                                                                                                                                                                                                                                                        | The same scene renders to PNG from the CLI, bit-identical to the browser                                                                                                        |

The real-time tier (R1 to R3) comes after M3 and shares M6's SDF kernels. The whole order:

M0, M1, M2, M2a, M3 (the product-viewer demo; AOVs, EXR, ACES), M3v (volumes, clouds and fog,
VDB), M3s (SSS), M5 (the fitting demo), M6 (procedural kernels, SDF), M6p (Pyro), R1, R2, R3
(DDGI), R3v (froxel volumes), M6s (FLIP), M4 (denoising, determinism), R6 (the error gate), M7
(the desktop, cache export), then R4, R5 and the further solvers.

R1 to R3 acceptance: Sponza at 1080p on a desktop GPU within 16 ms a frame; the error against the
path tracer on the same scene (RMSE and the FLIP metric) recorded by the R6 gate, and R4 and R5
defined as lowering it.

**The first public demo (the owner's decision): a glTF product viewer.** Drop a glTF and it
converges progressively under HDRI lighting; M3 is the completion point, with the same scene
rendered in Blender Cycles beside it. The demo scenes are glTF Sample Assets' DamagedHelmet and
FlightHelmet, plus one glass object for transmission.

## 5. What this plan makes possible

- The renderer itself (M1 to M3): a product viewer or configurator in the browser,
  architectural and interior visualisation, a material preview tool, a lighting studio, a
  reference renderer for teaching and papers.
- Reproducibility (M4): 3D render regression tests, a mixed browser-and-Node render farm, an audit
  of driver-dependent operations.
- `grad()` (M5): material recovery from a photograph, lighting estimation, camera calibration,
  procedural texture fitting, an inverse lighting tool, derivative visualisation for teaching.
- Procedural kernels (M6): an npm wrangle ecosystem, procedural asset generators, simulation
  previews, batch rendering for motion graphics.
- Later (M7 and after): an offline render CLI, a web DCC application, three.js and React
  adapters.
- Not possible with this plan: 60 fps game rendering, hardware ray-tracing speed, reverse-mode
  differentiation of whole shapes, Houdini's breadth of solvers.

## 6. The image quality to expect

Path tracing is unbiased, so within the materials it covers the ceiling is the assets' quality.

| Tier            | Compared with                                       | Reaches                                                                                                         | Falls short of                                                               |
| --------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Path tracer, M3 | Cycles                                              | Product shots, architecture and interiors, jewellery, glass, car paint. Hard to tell from Cycles once converged | Hair, layered and spectral materials, dispersion, caustics (no path guiding) |
| M3v, M3s        | Cycles volumes and SSS                              | Clouds, fog, smoke, fire; skin, wax, marble                                                                     | The detail limit of a 128³ to 256³ grid                                      |
| Real-time, R3   | UE4 plus RTXGI; Lumen at "medium"                   | Dynamic GI, soft shadows, AO                                                                                    | Sharp reflections (R5), near-field indirect bleeding (R4)                    |
| Simulation      | Houdini of the early 2010s in scale, modern solvers | Smoke, fire, explosions and water as photoreal renders                                                          | Tens of millions of particles, 1000³ grids                                   |

Time: a software BVH is 3 to 10 times slower than Cycles with OptiX on the same GPU. A desktop
GPU at 1080p and 1024 spp takes tens of seconds to a few minutes; with denoising, 64 to 256 spp
gives a showable image in seconds. The remaining gap to film (candidates for the next plan): a
hair BSDF and curve intersection, layered and spectral materials, path guiding, a neural denoiser
(ONNX on WebGPU), sparse volumes and texture streaming.

## 7. Gaps assigned to milestones

Formats (the owner's decision): glTF plus the engine's own format (scene files; simulation
caches as the engine's own binary) plus NanoVDB reading (M3v). USD, Alembic and OBJ are the next
plan's.

| Item                                                                                                                                                                                                                             | Milestone                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Viewport interaction: restart on camera move, a low-resolution preview, picking (`examples/id-pick`'s way)                                                                                                                       | M1                                                               |
| Russian roulette, firefly clamping, adaptive sampling                                                                                                                                                                            | M1, M4                                                           |
| A physical sky model (Nishita), IES profiles, light linking, portals                                                                                                                                                             | after M3                                                         |
| Shadow catcher, holdout, thin-film interference                                                                                                                                                                                  | after M3                                                         |
| True displacement (compute tessellation into a BLAS)                                                                                                                                                                             | M6                                                               |
| Compressed textures, UDIM, HDR and EXR decoding in the browser, a texture memory budget                                                                                                                                          | M3                                                               |
| GPU BVH build (LBVH) and refit                                                                                                                                                                                                   | M2a (refit); LBVH before M6s                                     |
| Geometry operations: Catmull-Clark subdivision, normal and UV generation, curves and point clouds                                                                                                                                | M6                                                               |
| Simulation: collision with moving meshes (an SDF per frame), time-step policy (substeps, CFL), emitters and forces (wind, turbulence fields), boundary conditions, cache format and timeline scrubbing, coupling between solvers | M6p, M6s; coupling in the next plan                              |
| Real time: clustered lighting, frustum and occlusion culling, LOD, transparency sorting, skinning (shared with M2a), atmosphere and sky, volumetric fog, post (bloom, motion blur, colour grading), reverse-Z depth              | R1 (reverse-Z, clustered, culling, post), R3v (fog), the rest R5 |
| Device loss and out-of-memory handling; a notice for browsers without WebGPU (no WebGL2 fallback)                                                                                                                                | M0                                                               |
| A worker plus OffscreenCanvas, so simulation and rendering leave the main thread                                                                                                                                                 | M1                                                               |
| Resource lifetime (`destroy`) and memory accounting; a bundle-size gate per package (the compiler's `gate:boundary` way)                                                                                                         | M0                                                               |
| CI: SwiftShader is slow, so gates use tiny scenes and low spp; a performance gate needs a real GPU runner (self-hosted)                                                                                                          | M0; the runner at M3                                             |
| Image comparison policy: tolerance by vendor, the FLIP metric, the determinism promise written down                                                                                                                              | M1                                                               |
| A docs site and examples (the typeshade.github.io pattern), an API reference, the Playground                                                                                                                                     | with the M3 demo                                                 |
| Demo asset licences (glTF Sample Assets; Sponza is CC-BY), the repository's licence, release and version policy with a compiler-pin compatibility table                                                                          | M0                                                               |

## 8. Low-level infrastructure: what exists, what is needed when

What `typeshade/runtime` already does: a buffer pool by size and usage (returned once the queue
has run the frame), bind-group, layout and pipeline caches, `resident.write()` uploads through
`queue.writeBuffer`, readback through a staging buffer from the pool and `mapAsync`. What WebGPU
makes unnecessary: a uniform ring buffer (the queue stages), resource state transitions, fences,
explicit memory heaps.

| Item                                                                  | Milestone                                                                 | Why                                                                                                        |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| A cap on frames in flight (2 to 3)                                    | M1                                                                        | A progressive loop that only submits grows the queue; `await submit()` every frame makes it 1              |
| Scene buffer suballocation (bump plus free list inside large buffers) | after record 0006 item 2 (a partial buffer write)                         | The binding limits put all geometry into a few buffers; until then a changed geometry re-writes them whole |
| A ring for large per-frame CPU-to-GPU uploads                         | not before M6s                                                            | Until M3 the data lives on the GPU and animation matrices are small uniforms; cache playback needs it      |
| A readback ring (several staging buffers mapped at once)              | M5                                                                        | The fitting loop reads back every iteration; the pool plus sequential `mapAsync` first                     |
| GPU timestamp queries                                                 | M1 coarse (`performance.now()`); `timestamp-query` as a compiler proposal | Tuning the watchdog budget                                                                                 |
| Memory accounting; size classes in the pool                           | M3                                                                        | The pool keys by exact size, so many sizes mean many buffers; with the texture budget                      |
| Asynchronous pipeline creation warm-up                                | R1                                                                        | The first-frame hitch of the real-time tier                                                                |

## 9. What goes back to the compiler (expected)

This engine stands on a pre-1.0 runtime, so these are likely to become proposals in
`typeshade/typeshade`'s `changes/`, opened in the order the engine finds them. Design record
0006 (`docs/design/0006-compiler-boundary.md`) is the list with the evidence read at e923a34,
the milestone each blocks and the engine's way around each until it lands; it adds device
limits, a partial buffer write, raw bytes as a host value, a texture write, a layer read and the
console's slot to the items below:

- How the runtime helps frame accumulation (#204). Solved on the host at M1, and the need
  written down.
- How the runtime exposes `timestamp-query` (GPU time per frame and pass). Coarse measurement
  at M1, and the need written down.
- The runtime overhead of hundreds of dispatches a frame (FLIP's PCG): measure the bind cache and
  command recording cost; propose a "the same kernel N times" API if needed. M6s.
- A convention for a radix sort as a shader package, shared by P2G gather and the GPU BVH build.
  M6s.
- `grad` over several parameters of one kernel at once (vectorised forward mode), then reverse
  mode. M5.
- The Node host: what differs when `createRuntime({ device })` is handed a Dawn device. M7.
- Performance: subgroup operations and f16 (both after 1.0), needed at the wavefront stage.
- A convention for a shader package exporting texture-array bindings as a struct (an extension of
  X6). M3 and M6.

## 10. Risks

- Performance: a WebGPU compute path tracer is a fraction of native ray tracing. "Photoreal" is
  reached by progressive accumulation; real time is not promised. Denoising decides the feel.
- The scope of differentiation: forward mode plus zero at discontinuities. Neural fields and shape
  optimisation are out until reverse mode. The docs say "fitting a few parameters" from the
  start.
- An unfrozen runtime surface: the API moves until 0.8. The submodule pin and
  `downstream-impact.ts` absorb it.
- The desktop: the Dawn host is unverified. Deferred to M7; the core stays host-agnostic.
- Scope creep: Houdini's node UI stays a separate product even after M6.
- FLIP's determinism: atomic scatter sums in driver order. Sorted gather by design; if too slow,
  a "deterministic" and a "fast" mode, told apart by the determinism report.
- Simulation scale: hundreds of thousands to a few million particles in the browser. Houdini's
  scale is not promised.

## 11. Verification

Design record 0002 (`docs/design/0002-verification.md`) is the set of gates, their scenes, their
numbers and the probe each proves itself with. In short:

- Every milestone's image golden follows the compiler's `gate:render`: render in headless
  Chromium, `readFloats()`, compare within tolerance.
- The CPU oracle's render against the GPU's (the compiler's `gate:differential` way) is in CI from
  M1, at a small resolution and low spp to bound the time.
- Determinism: two renders of one seed are bit-identical, from M1.
- The boundary: no import past `typeshade/runtime`, no WebGPU call, from M0.
- Moving the pin:
  `bun vendor/typeshade/scripts/downstream-impact.ts --repo radiance --submodule vendor/typeshade`.

## 12. Decisions taken

1. The name is `radiance`. It shares a name with the classic renderer Radiance (LBNL, 1990s), so
   the documents say "TypeShade Radiance".
2. `stepinside` is a separate product and Radiance's first consumer. It is private and
   proprietary, and this repository is Apache-2.0, so Radiance takes no code from it: its path
   tracer is read for its design only, and Radiance is written here. stepinside uses Radiance
   later, not the other way round (the owner, 2026-10-05).
3. M3's references are Blender Cycles and Mitsuba 3 (the owner, 2026-10-05). Cycles is the
   reference for the image: the same scene rendered in Cycles beside Radiance's, as section 4's
   first public demo sets out. Mitsuba 3 is the reference for derivatives: `@typeshade/radiance-fit`'s
   gradients (L4, M5) are compared with Mitsuba 3's on the same scene and parameters.
4. The engine is class-based, in three.js's shape: `Scene`, `Mesh`, `PerspectiveCamera` and a
   renderer with `render(scene, camera)`, on `typeshade/runtime`. The kernels, the scene and the
   renderer are one package (`@typeshade/radiance`); controls and sample scenes are
   `@typeshade/radiance-addons`. Path tracing comes first; games are a later goal (L6).
5. The site, radiance.typeshade.dev, is a library site: Starlight for the guide, the search and
   the API reference (generated from the engine's JSDoc), a front page, and an example per page
   that runs the code it shows.
6. A change to a contract the engine is built on (the kernel's buffers and layouts, a public
   export, a gate, a determinism rule, the material record, a proposal to the compiler) starts
   as a design record in `docs/design/`, merged as accepted before its code is written, and
   each implementing commit names it (`Design: NNNN`). `docs/design/README.md` is the
   procedure (the owner, 2026-10-05).
