---
id: '0010'
title: The first public demo (M3) has a principled BSDF, textures, lights, a physical camera, AOVs with EXR output and a product viewer beside Cycles
status: draft
milestones: [M3]
touches:
  - packages/radiance/src/materials
  - packages/radiance/src/kernels
  - packages/radiance/src/renderers
  - packages/radiance/src/cameras
  - packages/radiance/src/textures
  - packages/radiance/src/lights
  - packages/radiance/src/scenes
  - packages/radiance/src/index.ts
  - packages/radiance/__api__
  - packages/addons/src/loaders
  - packages/addons/src/exporters
  - packages/addons/src/scenes
  - packages/addons/__api__
  - scripts/gates.mjs
  - scripts/gates
  - scripts/oracle.ts
  - scripts/scenes.ts
  - scripts/cycles
  - site/src
  - site/examples
  - docs/design/0001-scene-data-model.md
  - docs/design/0002-verification.md
  - docs/design/0003-public-api.md
  - docs/design/0004-materials-and-shading.md
  - docs/design/0005-determinism.md
  - docs/design/0006-compiler-boundary.md
  - docs/design/0007-webgl2-tier.md
  - docs/benchmarks.md
  - docs/plan.md
compiler: ['0006-4']
---

**Document control**

| Field         | Value                                                                                                                                                                       |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity      | Design record 0010, status `draft`                                                                                                                                          |
| Date          | 2026-10-06 (UTC), the date of authorship                                                                                                                                    |
| Author        | Written in a Claude Code session for the owner. The owner's review is the approval                                                                                          |
| Applicability | `packages/radiance/src` (materials, kernels, cameras, renderers, textures, lights), `packages/addons/src` (loaders, exporters), `scripts/gates`, `scripts/cycles`, `site/`  |
| Baseline      | `main` at 55bde46. The compiler pinned at 596c805. Every fact below was read on that baseline on 2026-10-06. No number in this record was measured, unless the text says so |
| Pull request  | Not opened yet. The pull request that carries this record is its review. The record is a draft, so no part of it may be implemented before the owner accepts it             |

## What changes

Milestone M3 of `docs/plan.md` (section 4) is the first public demo. A visitor drops a glTF file on a page. The picture converges under HDRI lighting. Beside it sits the same scene, rendered in Blender Cycles. The demo scenes are glTF Sample Assets' DamagedHelmet and FlightHelmet, and one glass object.

This record is the design of that milestone. It has six parts. Each part is its own sequence of pull-request-sized steps, so each part merges alone. A part names the amendments it needs to records 0001 to 0007, as text to paste.

### Before

- A material renders as a diffuse or a mirror. `PhysicalMaterial` stores `metalness`, `roughness`, `ior`, `transmission` and `specularIntensity`, and `sampleBsdf` ignores them (`packages/radiance/src/kernels/materials.shade.ts`, record 0004 step 1).
- The material record has 8 `vec4`, 128 bytes. Words `[4]` to `[7]` are reserved and hold 0, and every texture id is none (`packMaterial` in `scene-pack.ts`).
- `radiance()` in `trace.shade.ts` does no multiple importance sampling (Veach 1995). It adds a light met by a BSDF sample only after a specular bounce or on the camera ray. It adds next-event estimation only at a bounce whose sample is not specular. So each light technique counts alone at each bounce, and no weight combines them.
- The light table holds emissive triangles only. A light is one `vec4`: `(bits(type), bits(instance), bits(triangle), cdf)`. A ray that leaves the scene returns black. There is no environment, no point light, no spot light and no sun.
- The camera is a pinhole. `lens` in `TraceParams` holds the tangents of half the field of view in `x` and `y`. `lens.z` and `lens.w` are 0 and unused. The exposure is one number in stops, `PresentParams.view.x`.
- The tone map is `tonemap` in `trace.shade.ts`: Narkowicz's fit of the ACES curve per channel, then the sRGB curve with `pow`. The accumulator `accum` holds one `vec4` for each pixel: the sum of the samples, and their count in `w`. No other output exists.
- The pipeline binds 7 storage buffers: `nodes`, `triangles`, `vertices`, `instances`, `materials`, `lights` and `accum`. Record 0001 rule 1 keeps the eighth slot free for the compiler's console buffer. The `trace` entry binds one uniform block, `params`.
- The runtime has no texture write at the pin 596c805 (record 0006, item 4). The compiler's change proposal 0050 is that write. It is a draft on the compiler's `main`, and the folder `vendor/typeshade/changes/` at the pin ends at 0047.
- `GLTFLoader` reads `pbrMetallicRoughness` factors, `emissiveFactor` and `KHR_materials_emissive_strength`. It does not load an image or a light.
- No file writes EXR. No decoder reads an HDR file. The site has no viewer page.
- The sampler (`sampler.shade.ts`) gives `sample2(pixelSeed, index, pair)`. Pair 0 is the pixel's jitter. Each bounce takes four pairs from pair 1 (`PAIRS_PER_BOUNCE` is 4).

### After

| Part | Delivers                                                                                                        | Needs from the other parts                    | Compiler item |
| ---- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------- |
| 1    | The principled BSDF, multiple importance sampling, multiple-scattering compensation, and the white-furnace gate | None                                          | None          |
| 2    | Texture arrays with mipmaps, ray differentials, sRGB decoding, and the sampler rules                            | Part 1, step 1.1                              | 0006-4        |
| 3    | Point, spot and sun lights, the environment with importance sampling, and the power table                       | Part 1, step 1.3. Part 2 for the HDRI texture | 0006-4        |
| 4    | The physical camera: exposure from ISO, shutter and f-number, and thin-lens depth of field                      | None                                          | None          |
| 5    | AOVs, the EXR writer, the ACES output transform, and the gate that holds each AOV to a golden                   | Parts 1 and 3 for light groups                | None          |
| 6    | The product-viewer page, the Cycles procedure, and the numbers that say how close the two images are            | Parts 1 to 5                                  | 0006-4        |

The six parts keep these invariants:

- The path tracer's pipeline binds 7 storage buffers. No part adds an eighth. The data that needs room goes into uniform blocks, into the region of an existing buffer, or into textures.
- A scene that uses none of the new features renders the same bits as before the part. Each part names the gate that proves it: the determinism gate on the existing differential scenes.
- Every part keeps the six rules of record 0005. A part that needs another operation amends record 0005 first, in its own step.
- The public names follow record 0003, rule 2 for materials and lights, and rule 1 for what three.js has.

### What this record assumes from the records that land before it

Two pieces of work land before this record. Neither is in this worktree. Fact: `main` at 55bde46 has no record 0009 and no record of an analytic sphere. Fact: the analytic sphere record is in progress on another branch. Fact: record 0009, sampling quality, is in draft on the worktree `wt/Q`. The text of both may differ from the assumptions below. When one of them merges, its text replaces the assumption here, and a difference is a deviation of this record.

| Source                 | The part this record assumes                                                                                                                                                                                     | What this record does if the assumption fails                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Analytic sphere record | A sphere that the kernel meets analytically gives a `Surface` with `ns` equal to `ng`, a `uv` and a `dpdu`. This record needs no word of its buffer layout                                                       | The white-furnace scene and the glass-sphere scenes use `SphereGeometry` at 64 by 32 segments. They lose only the exact normal    |
| Record 0009, light     | The solid-angle sampling of an emissive triangle. A function gives the density in solid angle of a chosen point on a chosen light. Part 3 calls that function for the multiple-importance weight                 | Part 3 step 3.4 keeps the area density of `direct` and converts it to solid angle with `dist2 / cosLight`, as `direct` does today |
| Record 0009, sampler   | `sample2(pixelSeed, index, pair)` keeps its signature and takes any `u32` pair. The sequences change, and the pairs do not                                                                                       | Each part that adds a pair takes it from a named constant. A change of the signature is a change of that constant's users         |
| Record 0009, filter    | The pixel jitter keeps pair 0, and the filter is applied after the draw. The camera ray keeps the form `forward + right * x + up * y`                                                                            | Part 4 changes the origin of the ray, and the direction stays what the jitter gives                                               |
| Record 0009, G-MoN     | The accumulator may hold `K` slots of beauty for each pixel instead of one. Part 5 writes the slot count as `K`, with `K` equal to 1 until that part of 0009 lands. Whichever lands second reconciles the stride | Part 5 uses `K` equal to 1                                                                                                        |
| Record 0008            | The panel and the controls change no kernel. This record changes `PhysicalMaterial`, so the panel gains the controls that "After the inspector" of record 0008 defers until record 0004 step 2 lands             | The panel keeps its four controls                                                                                                 |

The owner approved an image-quality change on 2026-10-06 that record 0008, decision 20, calls "the output transform". Fact: no file of the baseline says whether `tonemap` changed. Part 5 step 5.5 reads `tonemap` at its baseline first, and takes the delivered curve as its starting point.

### The rule for these parts

Each step is one pull request. Each step names its test, its number and its probe. A probe is the "prove the instrument" step of the compiler's gate discipline: the check runs once wrong on purpose and must report the fault. Each implementing commit names this record on a line of its own, `Design: 0010`. A test that verifies a decision carries `Verifies: Design 0010.k`.

A step that moves a picture lists each golden and each still that changes. It shows the old and the new picture, as step 7 of record 0004 does.

The figures that a step must reach are proposals. Each step records the measured value. Where this record gives a bound, the bound is a default. The rule of record 0002 sets it again: `mean` at ten times the first measured value, unless the measurement says otherwise.

## Why

(Written in the later commits of this draft.)

## What it touches

(Written in the later commits of this draft.)

## Implementation, in steps

(Written in the later commits of this draft.)

## Decisions for the owner

1. The decisions of this record are written in a later commit of this draft. Until then this entry holds the place of the list.

## Record

**Approval and plan record.** This record is a draft. No approval applies yet.

**Configuration and validation record.** This record does not yet apply. No step is started.
