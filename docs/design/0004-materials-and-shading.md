---
id: '0004'
title: A material is a 128-byte record and a shared TypeShade library of BSDFs, behind a shading contract that is the grad boundary
status: accepted
milestones: [M2, M3, M5]
touches:
  - packages/radiance/src/materials
  - packages/radiance/src/kernels
  - packages/addons/src/loaders
compiler: ['0006-4']
---

**Document control**

| Field         | Value                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------- |
| Identity      | Design record 0004, status `draft`                                                                |
| Date          | 2026-10-05 (UTC), the date of authorship                                                          |
| Author        | Written in a Claude Code session for the owner. The owner's review is the approval                |
| Applicability | `packages/radiance/src/materials`, `src/kernels/materials.shade.ts`, `src/kernels/trace.shade.ts` |
| Baseline      | `main` at 0f17f5e. The compiler pinned at e923a34                                                 |
| Pull request  | typeshade/radiance#6, the pull request that carries this record and is its review                 |

## What changes

### Before

A material is `kind` (0 diffuse, 1 mirror), a colour and an emission, packed as two `vec4`
(`pack.ts`). The kernel branches on `albedo.w > 0.5` inside `radiance()`. Nothing separates the
BSDF from the path loop, so a second renderer could not reuse it, and `grad` (plan §3.3) has no
function to differentiate.

### After

**The record.** `materials` (record 0001) holds 8 `vec4` per material, 128 bytes:

| Word  | x                   | y                  | z                  | w                    |
| ----- | ------------------- | ------------------ | ------------------ | -------------------- |
| `[0]` | baseColor.r         | baseColor.g        | baseColor.b        | metalness            |
| `[1]` | emissive.r          | emissive.g         | emissive.b         | roughness            |
| `[2]` | ior                 | transmission       | specularIntensity  | bits(type and flags) |
| `[3]` | bits(map)           | bits(normalMap)    | bits(roughnessMap) | bits(metalnessMap)   |
| `[4]` | anisotropy          | anisotropyRotation | clearcoat          | clearcoatRoughness   |
| `[5]` | sheen.r             | sheen.g            | sheen.b            | sheenRoughness       |
| `[6]` | subsurface radius.r | radius.g           | radius.b           | subsurface weight    |
| `[7]` | bits(emissiveMap)   | reserved           | reserved           | reserved             |

- `emissive` is stored already multiplied by `emissiveIntensity`. The kernel reads one colour.
- `type` is the low 8 bits of `[2].w`: 0 diffuse, 1 mirror, 2 physical. The flags above them:
  bit 8 "emits" (any channel of `[1].xyz` above 0, computed by the host so the kernel tests one
  bit), bit 9 "double sided", bit 10 "alpha cutout" (M3).
- A texture id is `0xffffffff` for none, else `(class << 24) | layer` (the texture plan below).
- M2 fills `[0]` to `[3]` with the textures all none, and `[4]` to `[7]` zero with `[7].x` none.
  M3 fills the rest. The stride does not change between.

**The classes.** `Material` keeps `color` and `emissive` and gains `version`, `type`,
`doubleSided` and `name`. `DiffuseMaterial` and `MirrorMaterial` stay as they are.
`EmissiveMaterial` stays: a black diffuse that emits. `PhysicalMaterial`, new, takes
`PhysicalMaterialParameters`: `color`, `metalness` (0), `roughness` (0.5), `ior` (1.5),
`transmission` (0), `specularIntensity` (1), `emissive`, `emissiveIntensity`, and at M3 `map`,
`normalMap`, `roughnessMap`, `metalnessMap` (glTF's one metallic-roughness texture is given to
both), `emissiveMap`, `anisotropy`, `clearcoat`, `sheen`, `subsurface`. The names are three.js's `MeshPhysicalMaterial`'s where the meaning is the same
(record 0003). A setter on any parameter bumps `version`.

**The shading contract.** `src/kernels/materials.shade.ts` exports these, and `trace.shade.ts`
imports them. A later rasterizer (plan §3.7, L6) imports the same file:

```ts
class Surface {
  p: vec3;      // the hit point, in world space, offset along the geometric normal
  ng: vec3;     // the geometric normal, unit, facing the incoming ray
  ns: vec3;     // the shading normal, unit, on the same side as ng
  uv: vec2;
  dpdu: vec3;   // the tangent along u, from the triangle's positions and uvs (not stored)
  material: u32;
  front: bool;  // whether the ray met the front face
}
class BsdfSample {
  wi: vec3;       // the sampled direction, unit, world space
  weight: vec3;   // f * cos / pdf: what the throughput is multiplied by
  pdf: f32;       // the density the direction was sampled with
  specular: bool; // a delta lobe: the next light hit counts, and NEE is skipped
}

export function emission(s: Surface, wo: vec3): vec3;
export function sampleBsdf(s: Surface, wo: vec3, r: vec3): BsdfSample;
export function evalBsdf(s: Surface, wo: vec3, wi: vec3): vec4; // f in xyz, pdf in w
```

- `wo` points away from the surface toward the ray's origin. `wi` away from the surface.
- `sampleBsdf` draws from the material's lobes with `r` (three numbers from the sampler:
  the lobe choice and the two direction numbers). `evalBsdf` returns `f` and the pdf of `wi`
  under the same sampling, for multiple importance sampling (M3).
- A diffuse surface samples the cosine distribution. A mirror returns `specular: true` with
  `weight = color` and `pdf = 1`. The physical material at M3 is the principled BSDF (a
  Disney-style diffuse, a GGX specular with Fresnel from `ior` and `specularIntensity`, a transmission
  lobe, then clearcoat, sheen and anisotropy in M3's own steps).
- `surface(hit, dir)` in `intersect.shade.ts` (record 0001) fills `Surface`. `dpdu` is
  `(dp1 * dv2 - dp2 * dv1) / (du1 * dv2 - du2 * dv1)` from the triangle's edges and uv
  differences, and a fallback frame about `ns` when the determinant is 0.

**The path loop** (`radiance()` in `trace.shade.ts`) becomes: traverse, `surface`, add
`emission` when the last bounce was specular or this is the camera ray, next-event estimation
with `evalBsdf` toward a light from the table, `sampleBsdf` for the next direction, Russian
roulette. Nothing in the loop reads a material word: that is the contract.

**The grad boundary** (plan §3.1 item 2, §3.3). `grad` differentiates `evalBsdf`, `emission`
and the light's contribution with respect to a material's or a light's parameters. It never
sees `nearest`, `surface` or `sampleBsdf`'s lobe choice. So the three exported functions are
written under the compiler's `grad` rules (`SD0118` lists them: `f32` and float-vector
arithmetic, the component-wise builtins, `if`, `switch`, a constant-bounded `for`, calls to
other functions of the module): no `while`, no texture sample, no `bitcast` on a value the
derivative flows through. A texture read happens in `surface` (M3), before the contract, and
its value enters `evalBsdf` as a number. M5's fit package differentiates these functions
through the compiler's `grad` (record 0006, item 7 names how it reaches them).

**The texture plan (M3).** WebGPU binds a `texture_2d_array<f32>` whose layers share one size
and format. The engine keeps four arrays, one per size class (256, 512, 1024 and 2048 pixels
square), each `rgba8unorm` with a full mip chain, and one sampler, within WebGPU's 16 sampled
textures per stage. A texture is resampled to the smallest class not smaller than its longer
side, and its id is `(class << 24) | layer`. The kernel samples with `textureSampleLevel` (a
compute stage has no derivatives) at a level the ray's footprint chooses (ray differentials, plan
§3.2). An HDR environment is its own `texture_2d<f32>` in `rgba16float` with its CDF rows in
`lights`. Uploading a texture needs the runtime's texture write, which does not exist at the
pin (record 0006, item 4): M3's textures wait on it.

## Why

- A fixed 128-byte record is the one way M3 adds parameters without changing the kernel's
  layout (record 0001's rule that the layout holds through M3). Materials number in the
  hundreds. The room costs nothing.
- The contract is what makes the BSDF a library: the path tracer, the rasterizer's G-buffer
  shading and the fitter read the same functions, and the oracle tests them one at a time
  (`kernels.test.ts` already tests `aboutNormal` and `tonemap` that way).
- The `grad` boundary is drawn in code, not in prose: three functions with the rules in their
  header comment and a test that `grad` accepts each (record 0002's determinism lint can carry
  it: `grad(module, 'evalBsdf', 'params')` compiles).
- Size classes, not one atlas: an atlas needs its own uv mapping and wraps badly. An array
  per class wastes at most the padding to the next class. Four bindings are well inside the
  limit.

Alternatives considered: a struct array for materials (record 0001 rule 2: typed arrays bind
from one `Float32Array`, structs from objects). Storing tangents per vertex (glTF makes them
optional and `dpdu` from the triangle is exact for a triangle). Texture atlases (above).

## What it touches

- `packages/radiance/src/materials/{Material,PhysicalMaterial}.ts`, `index.ts`.
- `src/kernels/materials.shade.ts` (new), `trace.shade.ts`, `intersect.shade.ts` (`surface`).
- `src/renderers/scene-pack.ts` (the record's packer).
- `packages/addons/src/loaders/GLTFLoader.ts` (`pbrMetallicRoughness` to `PhysicalMaterial`).
- Tests: `materials.test.ts` on the oracle (a diffuse sample's weight equals its colour, a
  mirror sample is the reflection. `evalBsdf`'s pdf integrates to 1 over the hemisphere within
  2 % by a 4,096-sample estimate. `emission` is zero on the back face). `scene-pack.test.ts`
  (the record's words). The `physical` differential scene (record 0002).
- The site's guide page on materials. The API reference follows the JSDoc.

## Implementation, in steps

1. **The record and the contract at M2.** `materials.shade.ts` with diffuse and mirror behind
   the contract, the 128-byte record, `PhysicalMaterial` with the M2 fields (`metalness`,
   `roughness`, `ior`, `transmission` and `specularIntensity` stored, and rendered as a diffuse until
   step 2, with the sentence in its JSDoc). Lands with record 0001 step 3. Done when the
   Cornell box gate passes on the contract with no change to its numbers beyond the
   tessellation's.
2. **The principled BSDF (M3).** The diffuse and GGX lobes with Fresnel, transmission, the
   `physical` differential scene, multiple importance sampling in the path loop.
3. **Textures (M3)**, after record 0006 item 4 lands: the size classes, the ids, the loader's
   images, `surface`'s reads, the `textures` differential scene.
4. **Clearcoat, sheen, anisotropy (M3)**, each its own pull request with its oracle test.
5. **The `grad` test**, with M5: `grad` accepts the three functions.

## Decisions for the owner

1. The 128-byte record with the words above, fixed through M3.
2. The contract: `emission`, `sampleBsdf`, `evalBsdf` over `Surface`, and a path loop that
   reads no material word.
3. The `grad` boundary is these three functions.
4. Four texture size classes as `texture_2d_array`, one sampler, `textureSampleLevel`.
5. Tangents derived at the hit, not stored.

## Record

**Approval and plan record.** Accepted on 2026-10-05 (UTC). The owner approved the merge of typeshade/radiance#6 in the conversation, which merged this record as `draft` at 9e8b479. The owner then said to implement the records with Opus 5.5 and Sonnet 5.5, and that go-ahead is the acceptance. Every entry of "Decisions for the owner" stands as proposed.

**Deviations of step 1** (2026-10-05, UTC). Step 1 is on the branch `wt/W1` from bc99533 with
record 0001 step 3, and its pull request is to follow. Each entry gives the difference and its
disposition.

- **The back face of a light.** "The record" defines the "double sided" bit and does not say
  what it does. `emission` is zero on the back face unless the bit is set. With the bit, the
  back face emits the same colour. Open: an amendment states it, with record 0001's "Traversal".
- **The offset of the hit point.** `Surface.p` is offset along the geometric normal, and the
  record gives no distance. The distance is `OFFSET` (1e-4) times the largest of 1 and the
  point's largest absolute coordinate. Open.
- **The side of the shading normal.** The record says that `ns` is on the same side as `ng`.
  When the interpolated normal is of length 0, or on the other side of `ng`, `ns` is `ng`. Open.
- **A direction under the surface.** The path loop ends a path when `sampleBsdf` gives a
  direction on the other side of `ng`, which a shading normal can give. The record's path loop
  is silent on it. Open.

**Configuration and validation record.** Step 1 is delivered with record 0001 step 3, on the
branch `wt/W1` from bc99533, at the compiler pin e923a34. The oracle tests in
`src/kernels/materials.test.ts` pass. A diffuse sample's weight is its colour, and a mirror
sample is the reflection. `evalBsdf`'s pdf integrates to 1 within 2 % by 4,096 samples. A
single-sided light is dark from behind. The Cornell box gate passes on the contract with the
numbers in record 0001's record. Steps 2 to 5 are not started.
