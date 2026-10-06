---
id: '0004'
title: A material is a 128-byte record and a shared TypeShade library of BSDFs, behind a shading contract that is the grad boundary
status: accepted
milestones: [M2, M3, M5]
touches:
  - packages/radiance/src/materials
  - packages/radiance/src/kernels
  - packages/radiance/src/renderers
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
- `type` is the low 8 bits of `[2].w`: 0 diffuse, 1 mirror, 2 physical. The flags above them are these. Bit 8 is "emits": any channel of `[1].xyz` is above 0. The host computes it, so the kernel tests one bit. Bit 9 is "double sided": the material emits from its back face too, as "The rules of the surface and of emission" says. Bit 10 is "alpha cutout" (M3). Bit 11 is "flat shading" (Amendment 3, "Flat shading").
- A texture id is `0xffffffff` for none, else `(class << 24) | layer` (the texture plan below).
- M2 fills `[0]` to `[3]` with the textures all none, and `[4]` to `[7]` zero with `[7].x` none.
  M3 fills the rest. The stride does not change between.
- Six words of the record are integers: `[2].w`, and the five texture ids `[3].x` to `[3].w` and
  `[7].x`. At M2 each one is the bits of an `f32`. "The integer words" below proposes that step 6
  moves them to `materialBits`, a binding of `u32` words.

**The classes.** `Material` keeps `color` and `emissive` and gains `version`, `type`,
`doubleSided` and `name`. `type` replaces M1's `kind` and `kind` is removed, so one number
says which scattering the kernel applies. Diffuse is 0 and mirror is 1, as `kind` had them, and
physical is 2. Each subclass sets `type` from the constants of `materials.shade.ts`
(`MATERIAL_DIFFUSE`, `MATERIAL_MIRROR`, `MATERIAL_PHYSICAL`), and `packMaterial` stores it in
the low 8 bits of `[2].w`. `Material` gains `flatShading` (Amendment 3), default false, as
three.js's `material.flatShading`. `DiffuseMaterial` and `MirrorMaterial` stay as they are.
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
  `weight = color` and `pdf = 1`. Its direction is the reflection of `-wo` about `ns`. When that
  direction goes under `ng`, `sampleBsdf` folds it back across `ng`, as "A direction under the
  surface" says. The physical material at M3 is the principled BSDF (a Disney-style diffuse, a GGX
  specular with Fresnel from `ior` and `specularIntensity`, a transmission lobe, then clearcoat,
  sheen and anisotropy in M3's own steps).
- `surface(hit, dir)` in `intersect.shade.ts` (record 0001) fills `Surface`. `dpdu` is
  `(dp1 * dv2 - dp2 * dv1) / (du1 * dv2 - du2 * dv1)` from the triangle's edges and uv
  differences, and a fallback frame about `ns` when the determinant is 0.

**The rules of the surface and of emission.** These rules state what the code of step 1 does
(`emission` in `materials.shade.ts`, `surfaceAt` in `intersect.shade.ts` and `radiance` in
`trace.shade.ts`). One rule is the exception: the fold of a mirror sample in "A direction under
the surface". The code of step 1 does not fold. Step 7 delivers the fold. That rule applies from
the pull request that implements step 7. The rules follow:

- **Which face emits.** `emission` returns 0 when bit 8 is not set. It returns 0 on the back
  face (`front` is false) when bit 9 is not set. Otherwise it returns `[1].xyz`, the same on both
  faces. `wo` does not change the value at M2. Bit 9 changes nothing else at M2. Record 0001,
  "Traversal", says that emission leaves the front face only. That sentence is the rule for a
  material without bit 9.
- **The hit point.** `surfaceAt` moves the point along `ng` by `OFFSET` times the largest of 1
  and the point's largest absolute coordinate. `OFFSET` is 1e-4 (`intersect.shade.ts`). It keeps a
  new ray from meeting the surface it leaves. `ng` faces the ray, so the point moves to the side
  the ray came from. At M2, every ray that the path loop casts from a surface starts at `p`: the
  next bounce and the shadow ray. Both lobes of step 1 reflect, so each of these rays leaves on
  the side the ray came from. A transmission sample leaves on the other side. Step 2 states the
  origin of a ray that a transmission sample casts. Inference: 1e-4 times a coordinate is at
  least 800 times the spacing of an `f32` at that coordinate.
- **The shading normal.** `ns` is the vertices' normals, interpolated by the barycentric weights,
  moved to world space by the inverse transposed and made unit. `surfaceAt` turns it to the ray's
  side when the ray met the back face. `ns` is `ng` when the vector in world space has length 0.
  `ns` is `ng` too when its dot product with `ng` is 0 or less after the turn. On a `Sphere`
  (record 0001, "The analytic sphere") `ns` is `ng`, the same vector. No interpolated normal
  exists there, so none of these fallbacks applies. On a material with `flatShading`, `ns` is `ng`
  too ("Flat shading").
- **A direction under the surface.** This rule holds for a reflection lobe, the only kind at M2. The
  reflection of `-wo` about `ns` can go under `ng`. For a mirror sample, let
  `wi = reflect(-wo, ns)`. When `dot(wi, ng)` is less than 0, `sampleBsdf` returns
  `wi - ng * (2 * dot(wi, ng))`. Otherwise it returns `wi`. Its `weight`, its `pdf` and `specular`
  do not change. The fold puts a direction under `ng` above `ng`. After the BSDF sample, `radiance`
  ends the path in two cases, for every sample. The `pdf` of the sample is 0 or less. Or the dot
  product of `wi` and `ng` is 0 or less. A shading normal can give such a direction to a sample that
  is not specular. After the fold, a mirror sample meets the second case only when `wi` lies exactly
  in the surface. The end of the path follows next-event estimation, so the light sample of that
  bounce still counts. `direct` adds nothing for a light sample whose direction has a dot product
  with `ng` of 0 or less.
  Inference: for a sample that is not specular, the second case acts only where `ns` differs from
  `ng`. The light that such a path would carry is lost. The loss of a sample that is not specular is
  not measured. The investigations recorded in Amendment 2 measured the loss of a mirror sample,
  before the fold, on `main` 2f06d0e with the pin 596c805. The mirror was the sphere of the
  Cornell box (`SphereGeometry`, 32 by 16 segments). The rule ended the path for 0.416 % of the
  area that the sphere covers. All of it lay within about 5 degrees of the silhouette. On that
  configuration the band was about 0.2 % of the radius. At 256 pixels, the rim pixels were 6.4 %
  darker. At 768 pixels, and in the committed still `cornell-box.webp` at eafc2e1, the band was a
  line of 1 to 2 pixels, about 42 % dark. Inference: a perfect mirror on a closed
  convex surface always reflects into the half-space of the viewer. So the band comes from the
  shading normal and not from physics. A transmission sample goes under `ng` on purpose, so this
  rule does not hold for it. Step 2 states the end rule for a transmission sample.
- **The fold on a `Sphere`.** The fold does nothing there. On a `Sphere` `ns` is `ng`, and `ng`
  faces the ray, so `dot(wo, ng)` is above 0. For `wi = reflect(-wo, ng)`, the value
  `dot(wi, ng)` equals `dot(wo, ng)` in exact arithmetic. So it is above 0, and no reflection goes
  under `ng`. The band of Amendment 2 needs an `ns` that differs from `ng`, so a sphere has no
  band. Fact: a throwaway script took 4,000,000 points spread evenly over the disc that a sphere
  covers from far away. Each point gave one mirror reflection in `f32`. It gave 0 reflections with
  `dot(wi, ng)` of 0 or less. The end rule of the path loop stays as it is. Inference: it can end
  a path only where `dot(wo, ng)` is within the rounding of 0, at the exact silhouette.
- **The texture coordinates of a `Sphere`.** The uv is the spherical parameterisation of three.js's
  `SphereGeometry`, in the sphere's own space. That space is the world space turned by the rows
  `[3]` to `[5]` of its instance (record 0001, "The analytic sphere"). The texture turns and
  mirrors with the sphere. The point `q` is the unit vector from the centre, in the sphere's own
  space, and `rho` is `sqrt(q.x * q.x + q.z * q.z)`:
  - `phi = atan2(q.z, -q.x)`, from -pi to pi. `u` is `phi / (2 * pi)`, plus 1 when that is
    below 0. The seam is the half-axis of -x, where `u` is 0 and 1. `u` is 0 at a pole.
  - `theta = atan2(rho, q.y)`, from 0 to pi. `v` is `1 - theta / pi`. `v` is 1 at the north pole
    (+y), as in three.js.
  - `dpdu` is the radius times `2 * pi * (q.z, 0, -q.x)`, moved from the sphere's space to world
    space as a direction. It is 0 at a pole, and the fallback frame about `ns` then applies. `dpdv` is not
    stored. Step 3 states the footprint of a texture read, and it may need `dpdv`.

  The kernel computes the two angles with `sphereUv` in `intersect.shade.ts`. It calls neither
  `atan2` nor `acos` of the language, because their error on a GPU is large (record 0005 gives the
  numbers). `sphereUv` calls `atan2p`, which uses `+`, `-`, `*`, `/`, `sqrt` and comparisons only:

  ```ts
  function atan2p(y: f32, x: f32): f32 {
    const ay = abs(y);
    const ax = abs(x);
    const big = max(ay, ax);
    if (big === 0) return 0;
    const r = min(ay, ax) / big; // from 0 to 1
    const r1 = r / (1 + sqrt(1 + r * r)); // the angle halved
    const h = r1 / (1 + sqrt(1 + r1 * r1)); // halved again: at most 0.1989
    const h2 = h * h;
    const s = h * (1 + h2 * (-1 / 3 + h2 * (1 / 5 + h2 * (-1 / 7 + h2 * (1 / 9 + h2 * (-1 / 11 + h2 * (1 / 13 - h2 / 15)))))));
    let a = 4 * s;
    if (ay > ax) a = PI / 2 - a;
    if (x < 0) a = PI - a;
    return y < 0 ? -a : a;
  }
  ```

  The comparisons choose between pieces of one continuous curve, as record 0005, rule 2, allows.
  Fact: a throwaway script computed this form with every operation rounded to `f32`, at 300,000
  points. Against `atan2` and `acos` in `f64`, the worst angle error was 3.81e-7 rad. The worst
  error of `u` was 8.93e-8 and of `v` was 1.23e-7. Inference: `sphereUv` costs about 4 `sqrt`, 6
  `/` and 60 other operations for each sphere hit. Step 6 of record 0001 measures the frame time
  of `cornell`. If `sphereUv` raises it by more than 3 %, the kernel computes the uv only for a
  material with a texture id, which M3 adds.

- **Flat shading.** The owner decided on 2026-10-06 that the material record gains a flag
  `flatShading`, default false, as three.js's `material.flatShading`. The rules follow:
  - The flag is bit 11 of the type and flags word `[2].w` (`MATERIAL_FLAT_SHADING`, 0x800). That
    word is bytes 44 to 47 of the record, little-endian. So the flag is bit 3 of byte 45, mask
    0x08.
  - The default is false. The bit is 0 in the record of a new material, and `Material.flatShading`
    is false. A setter adds 1 to `version`, as every setter of `Material` does.
  - The kernel branch is in `surfaceAt` (`intersect.shade.ts`). It reads the flag of the hit's
    material through `materialFlat(m)` in `materials.shade.ts`. When the flag is set, `ns` is `ng`
    for every triangle of the material, whatever its vertex normals are. The uv, `dpdu` and the
    other fields do not change.
  - The oracle branch is the same source. The oracle runs `surfaceAt` through `compileModuleJs`, so
    it takes the branch that the kernel takes. No second copy exists.
  - The flag changes the shading only. It changes no geometry, no BVH node and no hit.
  - With `ns` equal to `ng`, the fold of "A direction under the surface" does nothing, as on a
    `Sphere`.
  - The flag belongs to the material. Two meshes that share one geometry may differ, one flat and
    one smooth, as in three.js. A mesh keeps smooth vertex normals by default, and a glTF mesh
    keeps the normals of its file. Both are the owner's decisions of 2026-10-06.

**The path loop** (`radiance()` in `trace.shade.ts`) becomes these steps for each bounce:

1. Traverse the scene. End the path when the ray meets nothing.
2. Fill the `Surface` with `surface`.
3. Add `emission` when the last bounce was specular or this is the camera ray.
4. End the path when this is the last bounce, the one that `params.path.x` sets.
5. Draw the next direction with `sampleBsdf`.
6. Add next-event estimation with `evalBsdf` toward a light from the table, unless the sample is
   specular.
7. End the path as "A direction under the surface" states.
8. Apply Russian roulette from the bounce that `params.path.y` sets.

The loop draws the BSDF sample first because a specular sample skips next-event estimation. The
two use their own sampler dimensions, so the order changes no number. Next-event estimation cannot
connect through a delta lobe, so only BSDF sampling finds light that reaches a diffuse surface by
way of a mirror. That light converges as sparse bright samples, it is unbiased, and no kernel
clamps it. Proposals, not decisions: a later record may add one of these techniques. They are path
guiding, a caustic photon map, light tracing, bidirectional path tracing or an opt-in roughening of
delta lobes after a diffuse bounce. Nothing in the loop reads a material word: that is the
contract.

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

**The integer words (step 6).** Step 1 stores six words of the record as the bits of an `f32`:
`[2].w` and the five texture ids. This record proposes that step 6 moves them to `materialBits`,
a new binding of `u32` words. The owner confirms it in decision 8. The facts and inferences first:

- Fact: `0xffffffff`, the id of no texture, is the bits of a NaN. The runtime writes an `f32` lane
  with `DataView.setFloat32` and a `u32` lane with `setUint32` (`writeNumber` in
  `vendor/typeshade/src/core/host-entry.ts`, at the pin 596c805). Measured in bun 1.3.14 on
  2026-10-05 (`docs/typeshade-feedback.md`, at the pin e923a34) and on 2026-10-06 with a
  `DataView` outside the runtime: an `f32` lane turns `0xffffffff` into `0x7fc00000`.
- Fact: change 0045 of the compiler (`vendor/typeshade/changes/0045-bitcast-nan-subnormal-words.md`,
  `status: implemented`) says that a NaN or subnormal bit pattern in an `f32` has no portable
  `bitcast`. It says that an integer word belongs in a `storage<array<u32>>` binding.
- Fact: change 0045 names `storage<array<vec4u>>` beside `storage<array<u32>>` (its Deviations),
  because the compiler's typeshade/typeshade#485 (52d1bd0a) made it exact on GLSL ES 3.00. That
  commit is in the pin 596c805. `triangles` is already a `storage<array<vec4u>>`
  (`layout.shade.ts`).
- Fact: the type-and-flags word is below `0x800`, so its bits are 0 or a subnormal `f32`. The
  kernel reads it at M2 (`flagsOf` in `materials.shade.ts`). Change 0045 measured Chromium on
  SwiftShader, which keeps the bits. It did not measure a hardware GPU.
- Inference: a GPU that flushes a subnormal reads the type-and-flags word as 0, and every
  material is then a diffuse that does not emit.
- Fact: the kernel reads no texture id at M2. No picture moves on a measured target until M3
  reads one.
- Fact: record 0001 stores the integer words of `nodes`, `instances` and `lights` as `f32` bits
  too. This record does not decide them.

The rule from step 6:

1. `materialBits` is a `storage<array<vec4u>>` binding with 2 `vec4u` for each material, in the
   order of `materials`. Material `m` has the elements `2 * m` and `2 * m + 1`.
2. Its 8 words are the type and flags, then `map`, `normalMap`, `roughnessMap`, `metalnessMap` and
   `emissiveMap`, then two reserved words of 0. Element `2 * m` holds the first four, from `x` to
   `w`. Element `2 * m + 1` holds the rest.
3. The six lanes of `materials` that held these words become reserved and hold 0. The record
   stays 128 bytes, and no float word moves.
4. The host writes `materialBits` from one `Uint32Array`, as it writes `triangles`. `flagsOf` reads
   it with no `bitcast`.
5. A texture id keeps its form: `0xffffffff` for none, else `(class << 24) | layer`.
6. Step 6 moves no picture. The kernel reads no texture id before M3, and the type and flags
   keep their values.

The cost: `materialBits` is the eighth storage buffer of the trace stage. Record 0001 holds the
count at seven (rule 1 and decision 0001.2). Its rule 1 keeps the eighth slot for the compiler's
console buffer. So the owner decides before step 6 starts.

The binding keeps record 0001, rule 2: it is an array of `vec4u`, bound from one typed array, as
`triangles` is. A `storage<array<u32>>` binding would break rule 2 too. So the conflict is with
rule 1 alone.

The alternative keeps seven buffers. The host stores each integer word as the value of an `f32`,
not as its bits. Inference: an integer below 2^24 is exact in an `f32`, and the kernel converts it
with `u32()`. This needs no new binding. The form of a texture id then changes to fit 24 bits, with
`0` for none, and this record has to state the new form.

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
- Amendment 3 adds `src/kernels/intersect.shade.ts` (`sphereSurfaceAt` and `sphereUv`, record
  0001, step 6) and a test in `materials.test.ts`. The test takes a mirror sample at the hit of
  100,000 primary rays across the silhouette of a `Sphere`. None has `dot(wi, ng)` of 0 or less:
  the count is 0 of 100,000. It also adds `Material.flatShading`, `MATERIAL_FLAT_SHADING` and
  `materialFlat` in `materials.shade.ts`, the flag bit in `packMaterial` and the branch in
  `surfaceAt` (step 8).
- Tests: `materials.test.ts` on the oracle (a diffuse sample's weight equals its colour, a mirror
  sample is the reflection above `ng`. `evalBsdf`'s pdf integrates to 1 over the hemisphere, within
  2 % by a 4,096-sample estimate. `emission` is zero on the back face). `scene-pack.test.ts` (the
  record's words). The `physical` differential scene (record 0002).
- The site's guide page on materials. The API reference follows the JSDoc.
- Step 6 touches the files below. It waits for an amendment of record 0001 if the owner chooses
  the eighth buffer.
  - `src/kernels/materials.shade.ts`: `flagsOf`, the binding and the header, which names the one
    `bitcast`.
  - `src/kernels/layout.shade.ts`: the header, which says that a `vec4` holds an integer word as
    the bits of an `f32`.
  - `src/kernels/layout.test.ts` and `src/kernels/kernels.test.ts`: the first asserts the exact set
    of storage bindings. The second asserts that the trace binds seven.
  - `src/renderers/scene-pack.ts`: `packMaterial`, `SCENE_BUFFERS`, `SceneArrays` and the header,
    which counts six buffers.
  - `src/renderers/PathTracer.ts`: the two comments that count the storage buffers. It binds the
    pack's buffers through `pack.residents()`.
  - `scripts/oracle.ts`, at the repository root: it binds each buffer of `SCENE_BUFFERS` through
    `vec4s`.
  - `scene-pack.test.ts` and `materials.test.ts`.
  - This record's table and bullets in "The record": they put the type and flags in `[2].w`
    and the texture ids in `[3]` and `[7].x`, the lanes that rule 3 makes reserved.

## Implementation, in steps

1. **The record and the contract at M2.** `materials.shade.ts` with diffuse and mirror behind
   the contract, the 128-byte record, `PhysicalMaterial` with the M2 fields (`metalness`,
   `roughness`, `ior`, `transmission` and `specularIntensity` stored, and rendered as a diffuse until
   step 2, with the sentence in its JSDoc). Lands with record 0001 step 3. Done when the
   Cornell box gate passes on the contract with no change to its numbers beyond the
   tessellation's.
2. **The principled BSDF (M3).** The diffuse and GGX lobes with Fresnel, transmission, the
   `physical` differential scene, multiple importance sampling in the path loop. The rules of
   "The rules of the surface and of emission" for the origin of a ray and for the end of a path
   hold for a reflection lobe only. Before this step casts a transmission ray, an amendment of
   this record states the origin of that ray and the end rule for a transmission sample.
3. **Textures (M3)**, after record 0006 item 4 lands: the size classes, the ids, the loader's
   images, `surface`'s reads, the `textures` differential scene.
4. **Clearcoat, sheen, anisotropy (M3)**, each its own pull request with its oracle test.
5. **The `grad` test**, with M5: `grad` accepts the three functions.
6. **The integer words in `materialBits`**, before step 3 reads a texture id, and only after
   the owner confirms decision 8. It delivers `materialBits` as "The integer words" states.
   Done when a test sends `0xffffffff` through the oracle's binding and reads it back, the
   Cornell box gate and the render gate pass with no change of a number, and the determinism
   lint passes.
7. **The fold of a mirror sample.** `sampleBsdf` in `materials.shade.ts` folds a mirror direction under `ng` back across `ng`. "A direction under the surface" states the rule. `radiance` in
   `trace.shade.ts` does not change. A test in `materials.test.ts` calls `sampleBsdf` with a grazing
   `wo` and an `ns` tilted away from `ng`. It asserts that `dot(wi, ng)` is above 0. A second
   assertion covers a mirror sample whose reflection is above `ng`. That sample keeps
   `reflect(-wo, ns)`. The test carries `Verifies: Design 0004.6`. The pull request measures the fold at the edge of the band. The mirror ball is a `SphereGeometry` of radius 0.4 and 32 by 16 segments, in a Cornell box that the test builds. After record 0001, step 8, the shipped
   Cornell box has `Sphere` objects and no band. The measure is at 256 and 768 pixels. It shows
   that the radiance has no step there. It measures the alternative too, which reflects about `ng`
   in that case. If it delivers the alternative, it amends this record first. The golden of an
   example whose mirror is a mesh can change. After step 8 of record 0001, `cornell-box` and
   `determinism` are not candidates, because their mirror is analytic. The pull request finds the candidates by running the render gate. It lists each golden that changes, with the old and the new picture. `UPDATE_GOLDENS=1 bun run gate:render` rewrites every golden, so the pull
   request commits only the goldens that change. `bun run capture:stills` recaptures the stills of
   every example, so the pull request commits only the stills whose picture changes. The pull
   request commits the `.sha256` file of each changed still too. The pull request measures the floor caustic again on the same test scene. It compares the result with the ratio of Amendment 2. It
   names this record on a line of its own, `Design: 0004`. Done when four things hold. The test
   passes. The render gate passes on the goldens that the pull request commits. The differential
   gate passes. The stills match their hashes.
8. **Flat shading** (Amendment 3), delivered with record 0001, step 9. Add `Material.flatShading`
   and `MaterialParameters.flatShading`. Add `MATERIAL_FLAT_SHADING` and `materialFlat` to
   `materials.shade.ts`. Set the bit in `packMaterial`. Branch `surfaceAt`. Each test below carries
   `Verifies: Design 0004.10`, with its number:
   - `scene-pack.test.ts`: a new `DiffuseMaterial`, `MirrorMaterial` and `PhysicalMaterial` each
     have `flatShading` false and bit 11 of `[2].w` clear: 3 of 3. With `flatShading` true,
     `packMaterial` gives a record that differs from the default's in 1 byte of 128, byte 45, which
     holds 0x08. The setter adds 1 to `version`.
   - `intersect.test.ts`, on the oracle: 1,000 rays at a `SphereGeometry(1, 12, 8)` mesh. With the
     flag set, `ns` equals `ng` bit for bit on 1,000 of 1,000 hits. With the flag clear, the same
     rays give `dot(ns, ng)` below 0.99999 on at least 950 of the 1,000. The 950 is an inference,
     and the pull request records the count.
   - `materials.test.ts`: a mirror sample at the hit of 100,000 primary rays across the silhouette
     of that flat mesh sphere never has `dot(wi, ng)` of 0 or less: 0 of 100,000.
   - `GLTFLoader.test.ts`: a material that the loader makes has `flatShading` false: 1 of 1. The
     loader keeps the normals of the file.
   - The GPU half is the `spheres` scene of record 0002, step 9. Its middle ball has `flatShading`,
     and the differential gate holds the GPU to the oracle on it.

   Done when these numbers hold, `bun run check` passes and `gate:api` shows the added member of
   `Material` and of `MaterialParameters` and no other line changed. No example sets the flag yet,
   so the render gate passes with no golden changed. The commit names `Design: 0004`.

## Decisions for the owner

1. The 128-byte record with the words above, fixed through M3.
2. The contract: `emission`, `sampleBsdf`, `evalBsdf` over `Surface`, and a path loop that
   reads no material word.
3. The `grad` boundary is these three functions.
4. Four texture size classes as `texture_2d_array`, one sampler, `textureSampleLevel`.
5. Tangents derived at the hit, not stored.
6. The rules that Amendment 1 writes for the surface and for emission: a back face emits only
   for a material with bit 9, `Surface.p` is offset by `OFFSET` times the largest of 1 and the
   point's largest absolute coordinate, and `ns` falls back to `ng`. For a reflection lobe, the
   path loop casts each ray from `p`. It ends a path whose sample is not specular and goes under or
   into `ng`. Amendment 2 folds a mirror sample under `ng` back across `ng`. Of the mirror samples,
   only one whose direction lies exactly in the surface still ends the path. Step 2 states the
   origin of a ray and the end rule for a transmission sample.
7. `Material.type` replaces `Material.kind`, and no `kind` stays (Amendment 1).
8. At step 6, the six integer words of the material record move to `materialBits`, a
   `storage<array<vec4u>>` binding with 2 `vec4u` for each material. That changes six words of
   decision 1's record. It is also an eighth storage buffer, against record 0001, rule 1. It keeps
   rule 2 of record 0001. The owner chooses: amend record 0001 rule 1 first, or keep seven buffers
   and store each word as the value of an `f32`.
9. On a `Sphere` `ns` is `ng`, and the fold of decision 6 does nothing. The uv is three.js's spherical layout, computed by `sphereUv` from sums, products, divisions and square roots. Decided by default. Amendment 3 adds this decision.
10. A material has a `flatShading` flag, default false, in bit 11 of `[2].w` (byte 45, mask 0x08). When it is true, the kernel and the oracle shade with `ns` equal to `ng`, as three.js's `material.flatShading` does. This is the owner's decision of 2026-10-06 (final). Amendment 3 adds this decision.

## Record

**Approval and plan record.** Accepted on 2026-10-05 (UTC). The owner approved the merge of typeshade/radiance#6 in the conversation, which merged this record as `draft` at 9e8b479. The owner then said to implement the records with Opus 5.5 and Sonnet 5.5, and that go-ahead is the acceptance. Every entry of "Decisions for the owner" stands as proposed.

**Amendment 1** (2026-10-06, UTC). Pull request typeshade/radiance#18 delivered step 1 and
merged as 9f2cf1a. "Deviations of step 1" lists what differs from this record. The owner has not
decided any of it. This amendment proposes one disposition for each entry. It writes the rules
into "What changes" as the delivered code has them. The code is the same on `main` at 6ad088d.
The merge of the pull request that carries this amendment is the owner's acceptance of every
disposition below. A disposition that the owner refuses stays open, and a later pull request
changes the code or this record. The dispositions:

- **The back face of a light.** Proposed: made part of the record. "The rules of the surface and
  of emission" says that bit 9 lets the back face emit the same colour. It says that record
  0001, "Traversal", is the rule for a material without the bit.
- **The offset of the hit point.** Proposed: made part of the record. The distance is `OFFSET`
  times the largest of 1 and the point's largest absolute coordinate.
- **The side of the shading normal.** Proposed: made part of the record. `ns` is `ng` when the
  interpolated normal, in world space, has length 0 or faces away.
- **A direction under the surface.** Proposed: made part of the record, for a reflection lobe.
  The path loop ends such a path. The rule loses the light that the path would carry, so the
  owner may ask for another policy. Step 2 states the rule for a transmission sample. Decision 6
  holds this one.
- **`Material.kind`.** Proposed: made part of the record. `type` replaces `kind`, and "The
  classes" says so. The package is at version 0.0.0 with no release, so record 0003,
  "Deprecation", has no released name to protect. Decision 7 holds it.
- **The integer words.** Proposed: a rule for a later step. "The integer words (step 6)" moves
  six words to `materialBits`. The proposal is open until the owner confirms decision 8,
  because it needs an eighth storage buffer, against record 0001, rule 1. It keeps rule 2. This
  pull request changes no code.
- **The order of `sampleBsdf` and next-event estimation.** Found while reading the code, and not
  in the list of #18. The loop draws the BSDF sample first, so that a specular sample skips
  next-event estimation. Proposed: made part of the record. "The path loop" now has that order.

**Amendment 2** (2026-10-06, UTC). Two investigations of the mirror sphere in the Cornell box
measured the loss that "A direction under the surface" left unmeasured. The loss is a dark line at
the silhouette of the sphere. This amendment changes the rule for a mirror sample and records the
numbers. It changes these seven places:

1. The rule itself.
2. The mirror bullet of "The shading contract".
3. The introduction of "The rules of the surface and of emission".
4. "The path loop".
5. The Tests bullet of "What it touches".
6. Decision 6.
7. The deviation "A direction under the surface".

In "The path loop", it adds two sentences of facts and two of proposals. It adds step 7. It changes
no code. The merge of the pull request that carries it is the owner's acceptance of the new rule.
Decision 6 is re-stated, and the merge accepts that text. The pull request that implements step 7
merges after it and carries a line of its own, `Design: 0004`. The fold is the smallest change that
closes the band. The amendment proposes it, and step 7 states how the implementing pull request
measures it.

The configuration is `main` at 2f06d0e, the compiler pinned at 596c805, on 2026-10-06. This pull
request carries no program that measured the numbers, and no test holds them. Each one is an
observed result:

- **The loss of the rule.** On the mirror sphere of the Cornell box (`SphereGeometry`, 32 by 16
  segments), 0.416 % of the area that the sphere covers reflects under `ng`. For each angle from
  the silhouette, the share of the area that reflects under `ng` is as follows. It is 95 % at 0
  degrees, 60 % at 1 degree and 49 % at 2 degrees. It is 27 % at 3 degrees, 9 % at 4 degrees and
  1.6 % at 5 degrees. It is 0 % at 6 degrees. An independent model
  (orthographic, 400,000 rays) gave 0.467 % at 0.9906 of the radius or more.
- **What a reader saw.** On the configuration above, the band was about 0.2 % of the radius. At
  256 pixels it was under one pixel, and the rim pixels were 6.4 % darker (ratio 0.936). At 768
  pixels it was a line of 1 to 2 pixels, about 42 % dark. The committed still
  `site/public/stills/cornell-box.webp` at eafc2e1 showed the same line.
- **The tessellation.** The investigations give the dark area at 256 pixels in pixel equivalents,
  the area measured in pixels. It is 18.8 at 32 by 16 segments, 5.56 at 64 by 32 and 0.94 at 128
  by 64.
- **The floor caustic.** The rule does not remove it in a measurable way. The ratio is 1.0042
  between the two seed-matched renders, with and without the rule, over 8,294 caustic pixels (128
  by 128 pixels, 256 samples a pixel, 2 bounces). This record does not give the direction of the
  ratio. The scratch data of the investigation records it.
- **The path of a caustic.** Next-event estimation cannot connect through a delta lobe, because the
  shadow ray meets the sphere. So only BSDF sampling finds the light that reaches a diffuse surface
  by way of a mirror. At 256 samples a pixel, 78 % of the caustic pixels get no caustic sample. The
  estimate is unbiased: it is within 2 to 3 % of an independent photon estimate. No kernel clamps
  it. The only clamps on a throughput or a radiance value are the survival bound of Russian
  roulette, [0.05, 0.95], and the output tone map. Multiple importance sampling at step 2 does not
  change this.
- **The size of the caustic.** The caustic of a convex mirror is faint and broad. The mirror adds
  15 to 21 % over a black sphere, about as much as a white diffuse sphere does. A focused caustic
  needs transmission (step 2, M3).

Two inferences follow. First, a perfect mirror on a closed convex surface always reflects into the
half-space of the viewer. So the band comes from the approximation of the shading normal. Second,
the fold equals the reflection where the reflection is above `ng`. So it is continuous at the edge
of the band. Step 7 measures that edge. The dispositions:

- **The mirror sample under `ng`.** Proposed: the rule changes for a mirror sample, from "the path
  ends" to "the direction folds across `ng`". The text is in "A direction under the surface".
- **The end rule.** Proposed: the end rule stays and `trace.shade.ts` does not change. Its loss for
  a sample that is not specular is not measured.
- **The caustic through a delta lobe.** Proposed: made part of the record as a statement of fact in
  "The path loop". The techniques it names are proposals. No decision adds one.

**Amendment 3** (2026-10-06, UTC). The owner decided on 2026-10-06 that the engine gains an
analytic sphere, the `Sphere` kind (record 0001, Amendment 3). The owner also decided that the
material gains a flag `flatShading`. This amendment states what the two mean for shading. On a
`Sphere` `ns` is `ng`, so the fold of Amendment 2 does nothing there. It states the texture
coordinates of the sphere. It states the flag, its byte, its default, its branch and its test. It
changes these places:

1. "The record": the flags bullet and the paragraph on the classes.
2. "The shading normal", in "The rules of the surface and of emission".
3. Three rules after "A direction under the surface": "The fold on a `Sphere`", "The texture
   coordinates of a `Sphere`" and "Flat shading".
4. "What it touches".
5. Step 7, which no longer measures on the shipped Cornell box, and a new step 8.
6. Decisions 9 and 10.

The merge of the pull request that carries it is the owner's acceptance of each rule and of
decision 9. Decision 10 is the owner's own. The code is not changed here. Record 0001, step 6,
delivers `sphereSurfaceAt` and `sphereUv`. Step 8 here, with record 0001, step 9, delivers the
flag. The configuration is `main` at 13b9e88, the compiler pinned at 596c805, bun 1.3.14 and node
v22.22.0, on 2026-10-06. The numbers come from throwaway scripts that this pull request does not
keep. Each is an observed result:

- **The fold.** A script took 4,000,000 points spread evenly over the disc that a sphere covers
  from far away. Each gave one mirror reflection about `ng` in `f32`. It gave 0 with `dot(wi, ng)`
  of 0 or less. Amendment 2 measured 0.416 % of the area for a mesh sphere of 32 by 16 segments.
- **The uv.** The error of `sphereUv` against `f64` at 300,000 points was at most 3.81e-7 rad in an angle. It was at most 8.93e-8 in `u` and 1.23e-7 in `v`.
- **The cost.** The record gives no measure of the cost of `sphereUv`. It gives an estimate and a
  rule for the case that the estimate is wrong.
- **The flag's bit.** Fact: bits 8, 9 and 10 of `[2].w` hold "emits", "double sided" and "alpha
  cutout". Bit 11 was free. Bit 3 of byte 45 is bit 11 of the little-endian word at bytes 44 to 47.

The dispositions:

- **The shading normal.** Decided by default: `ns` is `ng` on a `Sphere`, the same vector.
- **The fold.** Decided by default: the fold stays in `sampleBsdf` for every mesh. It does
  nothing on a `Sphere` or on a flat-shaded mesh. The record adds no code for either.
- **The uv.** Decided by default: three.js's layout, with `u` from `phi` and `v` from `theta`, and
  `sphereUv` built from `+`, `-`, `*`, `/` and `sqrt`. The sphere's own space is the world space
  turned by the rows of its instance. The footprint of a texture read, and `dpdv`, stay with step 3.
- **Flat shading.** The owner's decision: a flag `flatShading`, default false, with `ns = ng`
  when it is true. Decision 10 holds it. The owner's other two decisions leave this record
  unchanged: `SphereGeometry` keeps smooth vertex normals, and a glTF mesh keeps its normals.
- **Step 7.** Proposed: the fold is measured on a mesh sphere that the test builds. The shipped Cornell box no longer has one after record 0001, step 8. The step's goldens are the
  examples whose mirror is a mesh.
- **Open: the measure of the fold on a mesh.** Amendment 2's numbers hold for a mesh sphere only.
  Next action: step 7, as before.
- **Open: the kernel half of the flag on a GPU.** The unit tests run on the oracle. The GPU half
  is the `spheres` scene of record 0002, step 9, which comes after the flag. Next action: record
  0001, step 10.

**Deviations of step 1** (2026-10-05, UTC). Step 1 is typeshade/radiance#18 with record 0001
step 3, merged as 9f2cf1a. Each entry gives the difference and its disposition. Amendment 1
adds the fifth and the seventh entries and proposes a disposition for each entry.

- **The back face of a light.** "The record" defines the "double sided" bit and does not say
  what it does. `emission` is zero on the back face unless the bit is set. With the bit, the
  back face emits the same colour. Disposition: made part of the record by Amendment 1, with
  record 0001's "Traversal" as the rule for a material without the bit.
- **The offset of the hit point.** `Surface.p` is offset along the geometric normal, and the
  record gives no distance. The distance is `OFFSET` (1e-4) times the largest of 1 and the
  point's largest absolute coordinate. Disposition: made part of the record by Amendment 1.
- **The side of the shading normal.** The record says that `ns` is on the same side as `ng`.
  When the interpolated normal is of length 0, or on the other side of `ng`, `ns` is `ng`.
  Disposition: made part of the record by Amendment 1.
- **A direction under the surface.** The path loop ends a path when `sampleBsdf` gives a
  direction on the other side of `ng`, which a shading normal can give. The record's path loop
  is silent on it. Disposition: made part of the record by Amendment 1, for a reflection lobe.
  Amendment 2 measures the loss of a mirror sample and changes the rule for that sample.
- **The type of a material.** Step 1 removes M1's `Material.kind` and adds `Material.type` in
  its place. The list in #18 names it, and this record's list did not. Disposition: made part
  of the record by Amendment 1.
- **The integer words of the record.** The record stores the five texture ids and the
  type-and-flags word as the bits of an `f32`. The compiler's change 0045 says an integer word
  belongs in a `storage<array<u32>>` binding. Measured in bun 1.3.14 at the pin e923a34: the
  runtime's `pack` turns 0xffffffff into 0x7fc00000 on an `f32` lane and keeps it on a `u32`
  lane. No picture moves until M3 reads a texture id. Disposition: Amendment 1 proposes step 6
  to move those words to `materialBits` (`docs/typeshade-feedback.md`, the step 3 entry on the
  upload). It stays open until the owner confirms decision 8.
- **The order of `sampleBsdf` and next-event estimation.** Amendment 1 found this one, and #18 did
  not list it. This record's path loop put next-event estimation before `sampleBsdf`. The code
  draws the BSDF sample first, so that a specular sample skips next-event estimation.
  Disposition: made part of the record by Amendment 1.

**Configuration and validation record.** Step 1 is delivered with record 0001 step 3 as
typeshade/radiance#18, merged as 9f2cf1a. The verification of #18 ran at the compiler pin
e923a34, in a worktree at 23cbc51 on `main` bc99533 (#18, Verification). #18 merged onto 632c661,
which had already moved the pin, so 9f2cf1a pins the compiler at fd39ba3. The oracle tests in
`src/kernels/materials.test.ts` pass. A diffuse sample's weight is its colour, and a mirror
sample is the reflection. `evalBsdf`'s pdf integrates to 1 within 2 % by 4,096 samples. A
single-sided light is dark from behind. The Cornell box gate passes on the contract with the
numbers in record 0001's record. Steps 2 to 7 are not started.

**Open item.** Decisions 0004.6 and 0004.7 carry no `Verifies:` tag, so DEC-0406 and DEC-0407 have
no reference. Tests of some of their rules exist. `materials.test.ts` ('is zero on the back face
of a single-sided light') tests the back face of decision 6. `intersect.test.ts` ('meets the
instance where its matrix puts it') tests the offset of decision 6. `scene-pack.test.ts` ('writes
the type of each material class') tests the type word of decision 7. A later pull request adds the
tags.
