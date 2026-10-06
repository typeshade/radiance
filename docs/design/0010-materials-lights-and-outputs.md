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

| Source                 | The part this record assumes                                                                                                                                                                                     | What this record does if the assumption fails                                                                                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Analytic sphere record | A sphere that the kernel meets analytically gives a `Surface` with `ns` equal to `ng`, a `uv` and a `dpdu`. This record needs no word of its buffer layout                                                       | The white-furnace scene and the glass-sphere scenes use `SphereGeometry` at 64 by 32 segments. They lose only the exact normal     |
| Record 0009, light     | The solid-angle sampling of an emissive triangle. A function gives the density in solid angle of a chosen point on a chosen light. Part 1, step 1.3 calls that function for the multiple-importance weight       | Part 1, step 1.3 keeps the area density of `direct` and converts it to solid angle with `dist2 / cosLight`, as `direct` does today |
| Record 0009, sampler   | `sample2(pixelSeed, index, pair)` keeps its signature and takes any `u32` pair. The sequences change, and the pairs do not                                                                                       | Each part that adds a pair takes it from a named constant. A change of the signature is a change of that constant's users          |
| Record 0009, filter    | The pixel jitter keeps pair 0, and the filter is applied after the draw. The camera ray keeps the form `forward + right * x + up * y`                                                                            | Part 4 changes the origin of the ray, and the direction stays what the jitter gives                                                |
| Record 0009, G-MoN     | The accumulator may hold `K` slots of beauty for each pixel instead of one. Part 5 writes the slot count as `K`, with `K` equal to 1 until that part of 0009 lands. Whichever lands second reconciles the stride | Part 5 uses `K` equal to 1                                                                                                         |
| Record 0008            | The panel and the controls change no kernel. This record changes `PhysicalMaterial`, so the panel gains the controls that "After the inspector" of record 0008 defers until record 0004 step 2 lands             | The panel keeps its four controls                                                                                                  |

The owner approved an image-quality change on 2026-10-06 that record 0008, decision 20, calls "the output transform". Fact: no file of the baseline says whether `tonemap` changed. Part 5 step 5.5 reads `tonemap` at its baseline first, and takes the delivered curve as its starting point.

### The rule for these parts

Each step is one pull request. Each step names its test, its number and its probe. A probe is the "prove the instrument" step of the compiler's gate discipline: the check runs once wrong on purpose and must report the fault. Each implementing commit names this record on a line of its own, `Design: 0010`. A test that verifies a decision carries `Verifies: Design 0010.k`.

A step that moves a picture lists each golden and each still that changes. It shows the old and the new picture, as step 7 of record 0004 does.

The figures that a step must reach are proposals. Each step records the measured value. Where this record gives a bound, the bound is a default. The rule of record 0002 sets it again: `mean` at ten times the first measured value, unless the measurement says otherwise.

### Part 1: The principled BSDF

Part 1 replaces the diffuse stand-in of `PhysicalMaterial` with the principled BSDF. It writes out steps 2 and 4 of record 0004. It needs nothing from the compiler and nothing from the other parts.

**The model.** The model is Burley's Disney BRDF (2012), extended to a BSDF (Burley 2015). Its parameters are glTF's metallic-roughness parameters (glTF 2.0, Appendix B). It has five lobes. The chance of each lobe depends on the material and on `wo` alone, so `sampleBsdf` and `evalBsdf` agree on the density.

| Lobe         | Value                                                                                        | Direction sampling                                                | What the sample carries                               |
| ------------ | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------- |
| Diffuse      | Burley's retro-reflective diffuse, with the energy factor of Lagarde and de Rousiers (2014)  | Cosine, as today                                                  | `baseColor` times the two retro-reflection terms      |
| Reflection   | GGX with height-correlated Smith masking (Heitz 2014). Anisotropic when `anisotropy` is set  | The visible normals of the spherical cap (Dupuy and Benyoub 2023) | `F * G2 / G1`                                         |
| Transmission | GGX refraction (Walter et al. 2007), with the dielectric Fresnel term, tinted by `baseColor` | The same visible normals, then Snell's law                        | `(1 - F) * G2 / G1` times the tint, times `1 / eta^2` |
| Clearcoat    | Isotropic GGX, fixed `F0` of 0.04, weighted by `clearcoat`                                   | The same visible normals                                          | `clearcoat * Fc * G2 / G1`                            |
| Sheen        | Charlie distribution with Neubelt's visibility (Estevez and Kulla 2017)                      | Cosine                                                            | `f * cos / pdf` of the cosine density                 |

The rules of the lobes follow.

- **Roughness.** `alpha` is `roughness * roughness`. A reflection or transmission lobe with `alpha` under `DELTA_ALPHA` (0.001) is a delta lobe. Its direction is the mirror reflection or the refraction of `-wo` about `ns`. Its sample has `specular: true`.
- **The reflection lobe and Fresnel.** A dielectric takes the exact unpolarized Fresnel term with `ior`, times `specularIntensity`. Below, `F` is that product. The term uses `sqrt` and `/` only. A metal takes Schlick's term with `F0 = baseColor`. Schlick's `(1 - c)^5` is written as three products, so no `pow` enters the Fresnel term (record 0005, rule 2). The lobe's Fresnel term is `(1 - metalness)` times the dielectric term, plus `metalness` times the metal term.
- **The diffuse lobe.** Its weight is `(1 - metalness) * (1 - transmission)`. The dielectric reflection above it takes `1 - F` of the energy at `wo`, as glTF layers it.
- **The transmission lobe.** Its weight is `(1 - metalness) * transmission * (1 - F)`. When `thickness` is 0 the surface is thin-walled. The sample then goes straight through, `wi = -wo`, with a delta lobe. The reflectance of a thin slab is `2R / (1 + R)`, with `R` the single interface reflectance.
- **The clearcoat and the layering.** The base lobes are scaled by `1 - clearcoat * Fc(cosThetaO)`. The sheen scales them by `1 - max(sheenColor) * E(cosThetaO, sheenRoughness)`, with `E` from the sheen table. glTF layers them this way, with `cosThetaO` only.
- **The choice of lobe.** The weight `w_i` of a lobe is an estimate of its albedo at `wo`. The estimate is the luminance of the lobe's colour times its Fresnel term at `cos(theta_o)`. The chance of lobe `i` is `w_i / sum(w)`. A lobe has chance 0 only when its value is 0 for every `wi`.
- **The density.** `evalBsdf` returns, in `w`, the sum over the lobes that are not delta of `chance_i * pdf_i(wi)`. A delta lobe adds no density. `sampleBsdf` returns the same sum as `pdf` for a sample that is not delta.
- **The weight.** For a sample that is not delta, `weight` is the value of all lobes that are not delta, times `cos`, over that sum. This is one-sample importance sampling of a mixture, so it needs no second weight.
- **A transmission sample.** It leaves on the other side of the surface. Its ray starts at `Surface.pb`, the hit point offset along `-ng` by the same distance as `p`. The path ends when the side of the sample does not match its lobe. `dot(wi, ng)` must be above 0 for a reflection lobe and below 0 for a transmission lobe. A transmission sample sets `specular: true`. That field now means that the next light hit counts in full.

**Multiple scattering.** The single-scattering GGX lobe loses energy as `alpha` grows. Fact, measured on 2026-10-06 in f64: the directional albedo at `r = 1` is 0.307 at normal incidence. At `cos(theta_o) = 0.5` it is 0.451. A throwaway host script gave both numbers (Python 3.11.15, numpy 2.4.6), and this record does not keep it. The quadrature is a midpoint rule on 1,024 by 2,048 cells, with height-correlated Smith masking, `F` equal to 1 and `alpha = r * r`. Part 1 compensates with Turquin's method (2019). The reflection lobe is multiplied by `1 + F0 * (1 / Ess(cosThetaO, r) - 1)`. `Ess` comes from a table of 32 by 32 values, with `r` on one axis and `cosThetaO` on the other. `F0` is the lobe's Fresnel term at normal incidence. For an anisotropic lobe, `r` is the fourth root of `alphaX * alphaY`. The factor depends on `wo` alone, so it changes no density. The flag `MATERIAL_NO_MS` (bit 12 of the type-and-flags word) turns it off. `PhysicalMaterial.multipleScattering` sets it, and the default is `true`.

**Where the tables live.** Record 0001 rule 1 leaves no free storage slot. The tables go into a new uniform block, `AlbedoTables`, in `layout.shade.ts`:

```ts
class AlbedoTables {
  /** Ess(cosThetaO, r): row j is r = (j + 0.5) / 32, four cosThetaO values to each vec4. */
  ggx: array<vec4, 256>;
  /** E(cosThetaO, r) of the Charlie sheen, the same layout. */
  sheen: array<vec4, 256>;
}
```

A uniform array has a 16-byte stride, so 256 `vec4` hold 1,024 floats exactly (`docs/use-typeshade-surface.md`, section 51). A bare `uniform<array<vec4, 256>>` is refused, so the arrays sit in a class. The block is 8,192 bytes. Inference: the pin accepts a sized array in a uniform class, from section 51. Step 1.4 compiles the block first. `scripts/bake-tables.ts` computes both tables in f64 and writes `packages/radiance/src/kernels/tables.ts`. The renderer uploads that file's arrays once. The kernel reads four neighbours and interpolates them with products, so the read is exact on every device.

**Multiple importance sampling.** The file `trace.shade.ts` has none today. Fact, from `radiance` at the baseline: a light that a BSDF sample meets adds its emission after a specular bounce or on the camera ray only. Next-event estimation runs only for a sample that is not specular. So at a bounce that is not specular, only the light sample counts. The BSDF sample's own hit counts for nothing. Veach (1995) combines the two with the power heuristic. This part changes the loop in five ways.

- **The light sample.** `direct` weights its contribution by `pL^2 / (pL^2 + pB^2)`. `pL` is the density of the sampled point in solid angle, `chance * dist2 / (area * cosLight)`. `pB` is the `w` of `evalBsdf`. The function computes `pL / (pL^2 + pB^2)` directly.
- **The BSDF sample's light hit.** When a sample that is not specular meets an emitter, `radiance` adds `throughput * emission * pB^2 / (pB^2 + pL^2)`. `pB` is the previous sample's `pdf`. `pL` is the light density from the previous point to the hit point. A new function `lightPdf(instance, triangle, origin, hit)` returns it. It finds the row of the hit triangle with `lightIndex`, a binary search over the `instance` and `triangle` words of the table. The table is sorted by both.
- **Next-event estimation at every bounce.** The guard `if (!bsdf.specular)` goes. A surface can have a delta lobe and a lobe that is not delta. It needs the light sample at each bounce. The lobe that the BSDF sample picked does not matter. A pure mirror has `evalBsdf` equal to 0, so `direct` returns early.
- **A delta sample and a transmission sample.** Their next light hit counts in full, because no light sample can reach it.
- **The density from record 0009.** Record 0009 gives the density in solid angle of a chosen point on a chosen light. The assumption table above lists it. Step 1.3 calls that function when it exists. If it does not exist, `lightPdf` uses the area form.

**Absorption.** A material with `attenuationColor` and `attenuationDistance` absorbs light between its interfaces. The host stores `sigma = -ln(attenuationColor) / attenuationDistance`, per channel and per scene unit, in `[6].xyz`. When a ray meets a back face of such a material, `radiance` multiplies `throughput` by `expNeg(sigma * hit.t)`. The ray travelled inside the object it meets from inside. The rule has one limit: a closed object, with outward normals, in empty space. Media do not nest. `expNeg(x)` is `exp(-x)` from a short series on `x / 256` and eight squarings. It uses sums and products only, so a device cannot move it. Fact, from the glTF Sample Assets (read on 2026-10-06 from the repository's `main`): `DragonAttenuation` holds `KHR_materials_volume` with a `thicknessTexture`. The kernel ignores `thicknessFactor` beyond "above 0", because a path tracer finds the real thickness.

**The material record.** This part fills the words that record 0004 reserved. The table below is the amendment text of record 0004, "The record". The record stays 128 bytes.

| Word  | x           | y                  | z                 | w                          |
| ----- | ----------- | ------------------ | ----------------- | -------------------------- |
| `[0]` | baseColor.r | baseColor.g        | baseColor.b       | metalness                  |
| `[1]` | emissive.r  | emissive.g         | emissive.b        | roughness                  |
| `[2]` | ior         | transmission       | specularIntensity | type and flags (a value)   |
| `[3]` | map         | normalMap          | roughnessMap      | metalnessMap (texture ids) |
| `[4]` | anisotropy  | anisotropyRotation | clearcoat         | clearcoatRoughness         |
| `[5]` | sheen.r     | sheen.g            | sheen.b           | sheenRoughness             |
| `[6]` | sigma.r     | sigma.g            | sigma.b           | baseColor alpha            |
| `[7]` | emissiveMap | normalScale        | alphaCutoff       | lightGroup                 |

- **The integer words become values.** The type-and-flags word, the five texture ids and `lightGroup` hold an integer below 2^24 as the `f32` of that number. The kernel reads each with `u32()`. This keeps seven storage buffers, the second alternative of record 0004, decision 8. A texture id is `0` for none, else `1 + class * 256 + layer`, with `class` from 0 to 3 and `layer` from 0 to 255.
- **New flags.** Bit 11 is "thin walled", set when `thickness` is 0. Bit 12 is `MATERIAL_NO_MS`. Bits 8 to 10 keep their meaning. The largest flag is 0x1fff, so the word is exact.
- **The slot `[6]`.** Record 0004 reserved `[6]` for the subsurface radius and weight (M3s). This part uses `[6].xyz` for the absorption coefficient of a medium and `[6].w` for the alpha of `baseColor`. M3s reads a radius as a medium coefficient too. It amends the record when it needs a weight.
- **`PhysicalMaterial`.** It gains the parameters `anisotropy`, `anisotropyRotation`, `clearcoat`, `clearcoatRoughness`, `sheen`, `sheenColor`, `sheenRoughness`, `thickness`, `attenuationColor`, `attenuationDistance` and `multipleScattering`. The names are three.js's `MeshPhysicalMaterial` names where it has them. `thickness` defaults to 0, as in three.js and glTF.

**The glTF extensions.** The loader maps these. Fact: `GLTFLoader` reads `pbrMetallicRoughness`, `emissiveFactor` and `KHR_materials_emissive_strength` at the baseline. Fact, from the glTF Sample Assets (read on 2026-10-06): DamagedHelmet uses the core model with five textures and no extension. FlightHelmet declares `KHR_materials_transmission` for its lenses and has 15 textures.

| glTF                                                                | Engine                                                 | M3                                                                  |
| ------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------- |
| `KHR_materials_ior`                                                 | `ior`                                                  | Takes it                                                            |
| `KHR_materials_transmission`                                        | `transmission`                                         | Takes the factor. The texture waits (Part 2)                        |
| `KHR_materials_volume`                                              | `attenuationColor`, `attenuationDistance`, `thickness` | Takes the three factors. `thicknessTexture` is ignored              |
| `KHR_materials_clearcoat`                                           | `clearcoat`, `clearcoatRoughness`                      | Takes the factors. Textures and the clearcoat normal wait           |
| `KHR_materials_sheen`                                               | `sheenColor`, `sheenRoughness`                         | Takes the factors. Textures wait                                    |
| `KHR_materials_anisotropy`                                          | `anisotropy`, `anisotropyRotation`                     | Takes the factors. The texture waits                                |
| `KHR_materials_specular`                                            | `specularIntensity`                                    | Takes `specularFactor`. `specularColorFactor` and the textures wait |
| `KHR_materials_diffuse_transmission`, `_dispersion`, `_iridescence` | none                                                   | Waits. The loader warns and ignores them                            |
| `occlusionTexture`                                                  | none                                                   | Never read. A path tracer finds occlusion by tracing                |

**The sampler pairs.** The pairs of a bounce stay four. The lobe choice comes from `r.x`, the first number of the BSDF's triple. Reflection, transmission and clearcoat are separate lobes, so none needs a second choice.

### Part 2: Textures

Part 2 gives the material record its textures: texture arrays with mipmaps, a footprint for the mip level, sRGB decoding and filtering rules. It needs step 1.1 of Part 1 (the words of the record). Its upload needs the compiler's change 0050.

**The compiler item.** Fact: record 0006 item 4 is the compiler's change 0050. It lets a host write an image or bytes into one layer and one level of a program runtime's `Texture`. Its status is `draft`. The folder `vendor/typeshade/changes/` at the pin 596c805 ends at 0047, so 0050 is not at the pin. Fact: the compiler's `main` holds the draft (read on 2026-10-06 through the GitHub API). This part uses four of its members: `Texture.write(bytes, { layer, level })`, `TextureOptions.mipLevelCount`, `Texture.layers` and `Texture.mipLevelCount`. It does not use `generateMipmaps()`. The draft's filter averages the stored codes of an unorm format, which is wrong for sRGB colour. The host builds the mip chain itself. This part opens no new item for the upload. Step 2.2 and the steps after it wait for the pin that carries 0050. Step 2.1 does not wait.

**The public classes.** `Texture` joins the engine's names (record 0003, rule 1). `DataTexture` follows it.

```ts
class Texture {
  image: TextureImage | undefined; // { width, height, data: Uint8Array | Uint8ClampedArray }, RGBA, 8 bits
  name: string;
  colorSpace: '' | 'srgb'; // advisory: the slot of the material decides how the texels are read
  flipY: boolean; // default true, as three.js. The glTF loader sets false.
  wrapS: 'repeat' | 'clamp' | 'mirror'; // default 'clamp'
  wrapT: 'repeat' | 'clamp' | 'mirror';
  version: number; // the setter of `image` adds 1
}
class DataTexture extends Texture {
  constructor(data: Uint8Array, width: number, height: number);
}
```

`Material` gains `map`, `normalMap`, `roughnessMap`, `metalnessMap` and `emissiveMap` (record 0003, rule 2), and `PhysicalMaterial` gains `normalScale`. An `ImageBitmap` is not an image of a `Texture`. The glTF loader decodes each file with `createImageBitmap` and reads its 8-bit RGBA bytes through an `OffscreenCanvas`. The oracle and the tests build a `DataTexture` from bytes and need no decoder.

**The arrays.** The engine keeps four texture arrays, one for each size class. Each array is `rgba8unorm` with a full mip chain. A texture goes to the smallest class that is not smaller than its longer side. The loader's option `maxTextureSize` sets a cap, 2048 by default. The host resamples a texture that is not square or not of a class size. It uses a box filter in linear light.

| Class | Size | Bytes of one layer with its mips |
| ----- | ---- | -------------------------------- |
| 0     | 256  | 349,525                          |
| 1     | 512  | 1,398,101                        |
| 2     | 1024 | 5,592,405                        |
| 3     | 2048 | 22,369,621                       |

WebGPU allows 256 layers in an array by default, so a class holds 256 textures. Fact, from the glTF Sample Assets (read on 2026-10-06): DamagedHelmet has five JPEG images of 2048 by 2048 texels. FlightHelmet has fifteen PNG images of the same size. At class 3 the helmet takes 111.8 MB and FlightHelmet takes 335.5 MB. At `maxTextureSize` 1024, FlightHelmet takes 83.9 MB. This is arithmetic from the table, and no run measured it. The renderer parameter `textureBudget` (bytes, default 536,870,912) makes the pack throw a `RangeError` that names the largest textures when the layers pass it. `info.textureBytes` reports the sum.

**The id.** A texture id is the value of an `f32` below 2^24 (Part 1). Part 2 fills its form: `id = (1 + class * 256 + layer) + 2048 * wrap`, with `wrap = wrapS + 3 * wrapT` and the wrap modes numbered `repeat` 0, `clamp` 1 and `mirror` 2. An id of 0 is no texture. Part 1 stores the id without its wrap term, and step 2.1 adds it.

**No sampler.** The kernel filters by itself. Fact: the compiler's reflection gives a texture that a program only loads the sample type `unfilterable-float` (`AUTHORING.md`, reflection of bindings), so no sampler is bound. The kernel reads texels with `textureLoad`. It applies the wrap mode with integer arithmetic, and it weights four texels in each of two levels with products. A hardware sampler's filtering is not exact across vendors, and the kernel's is. The one step that a device decides is the conversion of an 8-bit code to `f32` by `textureLoad`. Fact: no run measured it at the pin. Step 2.2 reads all 256 codes of a texture and compares each with `fround(code / 255)`.

**sRGB.** Base colour and emission are sRGB-encoded. The other maps are data. The kernel decodes an sRGB code with a table of 256 floats, which joins `AlbedoTables` as `srgb: array<vec4, 64>`. The host builds a mip level by decoding, averaging four texels in f64 and encoding. The encode is a binary search over 255 baked thresholds, so no `pow` of the host's engine decides a code. A checker of codes 0 and 255 gives code 188 at the next level, and not 128.

**The footprint.** The kernel picks the mip level from a ray cone (Akenine-Moller et al. 2021). A cone is a ray differential reduced to one width and one spread angle. A path carries `(width0, spread)`. The width at distance `t` is `width0 + spread * t`.

- **The camera ray.** `width0` is 0. `spread` is `scale * 2 * tanY / height`, with `scale` the renderer's `footprintScale` (default 0.25, after pbrt-v4, which shrinks a differential by `1 / sqrt(spp)` with 0.125 as its floor).
- **A hit.** The footprint on the surface has a major axis of `width / abs(dot(dir, ng))`. The level is `log2(major * N / sqrt(length(cross(dpdu, dpdv))))`, with `N` the size of the class.
- **A bounce.** The new cone starts at the hit, `width0` equal to the width there. A delta lobe keeps `spread`. A glossy lobe adds `2 * alpha`. A diffuse lobe adds 1.
- **The reference.** The camera ray's cone equals Igehy's ray differential in its major axis for a pinhole camera. Step 2.4 holds the kernel's level against a host implementation of Igehy's differentials, as pbrt-v4 computes them.

`log2` is a transcendental function, and a level only blends two images, but a level also picks the pair of images. So the kernel computes it from the exponent bits of the `f32` and a polynomial in the mantissa. It uses sums and products, so record 0005, rule 2 holds.

**The kernel files.** The reads of a texel are in one file, `fetch.shade.ts`. It declares `texels0` to `texels3` as `texture_2d_array<f32>` and has `fetchTexel(class, layer, level, x, y)`. All filtering is in `filter.shade.ts`. Fact: the compiler's CPU tier throws on `textureLoad` (`AUTHORING.md`, "Calls with no CPU meaning"), so the oracle cannot run `fetch.shade.ts`. The oracle's `compile` call takes a `readDocument` hook. For the import of `fetch.shade.ts` the hook returns `scripts/oracle-fetch.shade.ts`, which reads a `storage<array<vec4>>` that the oracle fills. The two files have a `LINT.IfChange` pair. The filter code is the same on both sides. A scene without textures binds four textures of 1 by 1 texel.

**The surface.** `surface` and `surfaceAt` gain the footprint as a parameter and fill the fields of Part 1. `Surface` gains `dpdv`, the tangent along v, and the sign of the uv frame. The tints are `baseTint` (the `map` texel, with alpha), `mrTint` (green for roughness, blue for metalness), `emissiveTint` and `normalTint`. The shading normal turns by the normal map as follows. `T` is `dpdu` made orthogonal to `ns` and made unit. `B` is `cross(ns, T)` with the sign of the uv frame. The decoded texel `(x, y, z)` is `2 * texel - 1`, and `ns` becomes `normalize(T * x * normalScale + B * y * normalScale + ns * z)`. The existing rule applies: `ns` falls back to `ng` when its dot product with `ng` is 0 or less.

**Alpha cutout.** A material with bit 10 of its flags tests alpha during traversal. `nearest` and `occluded` call `alphaPasses(instance, triangle, b1, b2)` at a triangle hit. The function reads `map` at level 0 and returns false when `alpha * [6].w` is under `[7].y`. The traversal then goes on. The glTF `alphaMode` MASK maps to this. BLEND is not modelled: the loader warns and treats it as OPAQUE.

**What waits.** The loader knows `KHR_texture_transform` and ignores it with a warning. The record has no room for a transform for each texture. Compressed textures (KTX2) and UDIM wait. Each needs a decoder, and the boundary allows no import past the runtime. Streaming and an anisotropic filter wait too. The light table uses the emissive factor alone, so a textured emitter is sampled by its factor and not by its map.

### Part 3: Lights

Part 3 adds the point, spot and sun lights, the environment with importance sampling, and the table of light power that chooses among them. It needs step 1.3 of Part 1 (multiple importance sampling). The HDRI texture needs steps 2.2 and later of Part 2, so it needs change 0050 too.

**The light table.** Record 0001 gives the table one `vec4` for each light: `(bits(type), bits(instance), bits(triangle), cdf)`. Part 3 keeps the stride and adds four types.

| Type | Light       | `y` word                   | `z` word             | `cdf`      |
| ---- | ----------- | -------------------------- | -------------------- | ---------- |
| 0    | Triangle    | bits of the instance       | bits of the triangle | as before  |
| 1    | Point       | the index `k` of its block | 0                    | its chance |
| 2    | Spot        | the index `k` of its block | 0                    | its chance |
| 3    | Sun         | the index `k` of its block | 0                    | its chance |
| 4    | Environment | 0                          | 0                    | its chance |

The type word of a new row is the value of an `f32`, not its bits. A value of 1 as bits is a subnormal number. A device may flush it to 0, and the row would then read as a triangle. The kernel reads the type with `u32()`. A type of 0 is 0 in both forms, so a triangle row does not change. The `y` word of a new row is a value too. The words of a triangle row keep the form of record 0001.

The rows come in this order: triangles, then points, spots and suns, then the environment. The `cdf` of the last row is exactly 1. Four `vec4` follow the rows for each point, spot or sun light. They are its block, and the block `k` starts at row `rows + 4 * k`. `TraceParams` gains `lights: vec4u`, which holds the number of triangle rows, the number of blocks, a flag for the environment and one reserved word. The sun's direction and the spot's axis are unit vectors.

| Word  | x                      | y                   | z                   | w                            |
| ----- | ---------------------- | ------------------- | ------------------- | ---------------------------- |
| `[0]` | position (point, spot) | position            | position            | radius, or `cosMax` of a sun |
| `[1]` | intensity r            | intensity g         | intensity b         | light group                  |
| `[2]` | axis or direction x    | axis or direction y | axis or direction z | `cosOuter` of a spot         |
| `[3]` | spot angle scale       | spot angle offset   | 0                   | 0                            |

A sun's direction is the direction toward the sun. A spot's angle scale is `1 / max(0.001, cosInner - cosOuter)`, and its offset is `-cosOuter * scale`, as `KHR_lights_punctual` defines them. The host computes both, so the kernel uses no trigonometry. The spot's attenuation is `saturate(cos * scale + offset)` squared.

**The classes.** Record 0003 names `PointLight`, `SpotLight`, `SunLight` and `Environment`. Each light is an `Object3D` that takes one parameters object.

```ts
new PointLight({ color, intensity, radius, group }); // radius 0: a point
new SpotLight({ color, intensity, radius, angle, penumbra, group }); // axis: -z of matrixWorld
new SunLight({ color, intensity, angle, group }); // shines along -z of matrixWorld
new Environment({ texture, color, intensity, rotation, compensation, group });
scene.environment = environment; // lights the scene
scene.background = environment; // or a Color, or null for black
```

`intensity` of a point or spot light is a radiant intensity. A sun's `intensity` is an irradiance, measured across the direction. Both are in the engine's units, where an emissive colour is a radiance. The loader copies the candela and lux of `KHR_lights_punctual` without a factor, as three.js does. `angle` of a sun is the angular diameter in radians, 0.00918 by default (0.526 degrees). `angle` of a spot is the outer half angle, and `penumbra` is the share of it that falls off, as in three.js. `rotation` of an environment turns it about +y.

**The lights see no ray.** A point, spot or sun light has no geometry. No camera ray and no BSDF sample meets it. Only next-event estimation reaches it, so it needs no multiple importance sampling. A light with a radius is a sphere that emits, and the kernel samples the cone that it subtends (Shirley and Wang 1994). For a sphere above the horizon, its irradiance on a plane equals a point's: `I * cos / d^2`. A sun is sampled the same way over its disc.

**The power table.** A light's chance is its share of the emitted flux. The flux is a number that only sets the chance, so an estimate is enough. The host computes these:

| Light       | Flux                                                                 |
| ----------- | -------------------------------------------------------------------- |
| Triangle    | `pi * area * mean(emissive)` (record 0001 has the area and the mean) |
| Point       | `4 * pi * mean(intensity)`                                           |
| Spot        | `2 * pi * (1 - (cosInner + cosOuter) / 2) * mean(intensity)`         |
| Sun         | `pi * R^2 * mean(intensity)`                                         |
| Environment | `4 * pi^2 * R^2 * mean(radiance)`                                    |

`R` is the radius of the sphere that bounds the TLAS's root box. A sun or an environment sends its flux through the disc or the sphere of that radius. A one-sided emitter sends `pi * L` through each unit of its area, which explains the factors. The pack builds the table again when a light, a material or the bounds change. The record 0001 rule "the pack builds `lights` again when a geometry changed" holds.

**The light tree is deferred.** Conty Estevez and Kulla (2018) sample many lights by a tree. The power table ignores the position of a light, so a scene of thousands of emissive triangles has more variance than a tree gives. The demo scenes hold one environment, a few analytic lights and no more than a handful of emitters. So Part 3 builds the table only. The tree would live in `nodes`, after the TLAS, and the rows of `lights` would become its leaves. A later record decides it, with the variance of a real scene.

**The environment.** An environment holds an equirectangular image, a colour, or both. The colour alone is a constant radiance. The image is a `DataTexture` of `Float32Array` data, four floats a texel.

- **The direction and the image.** `u = atan2(z, x) / (2 * pi) + 0.5` and `v = acos(y) / pi`, with `v` measured from the top row. This is three.js's equirectangular map (from memory, and step 3.3 reads the three.js source). The direction is first turned by `-rotation` about +y.
- **No trigonometry that decides.** `atan2` and `acos` feed a texel index, which record 0005, rule 2 forbids. The kernel uses `atan2Approx`, a rational polynomial of sums, products and one division. `acos(y)` is `atan2Approx(sqrt(1 - y * y), y)`. The direction from `(u, v)` goes through `turn`: `turn(v / 2)` is `(cos(pi * v), sin(pi * v))`.
- **The radiance.** The kernel reads four texels of a 32-bit float image with `textureLoad` and weights them with products. It wraps in `u` and clamps in `v`. It multiplies the result by `intensity`.
- **The image.** The image is `rgba32float`. A half-float image would clamp a sun texel at 65,504, which a sunny HDRI exceeds. The loader resamples an image wider than 2,048 texels with a box filter (option `maxEnvironmentWidth`). A 2,048 by 1,024 image takes 33,554,432 bytes.
- **The distribution.** The host builds a table at most 1,024 texels wide, from the luminance of each texel times `sin(theta)` of its row, in f64. `envDist` is `rg32float`: its `x` is the inclusive CDF along the row and its `y` is the density over the unit square. `envMarg` is `r32float` with one column: the inclusive CDF down the rows. The kernel reads both with `textureLoad`.
- **The sample.** Two numbers pick the row by a binary search of `envMarg`, then the texel by a binary search of its row. A remap then places the point in the texel. The density in solid angle is `q / (2 * pi^2 * sin(theta))`. The same function gives it for a direction, so the BSDF side of the weight and the light side agree.
- **The choice.** The environment row has a chance in the power table. A sample of the table that picks it uses the two numbers of `pair` and the choice number.
- **The escape.** A ray that meets nothing adds `throughput * environment(dir)`, weighted by `pB^2 / (pB^2 + pL^2)` when the last sample was not specular. `pL` is the row's chance times the density of the direction. A camera ray adds the background in full.
- **The background.** A `Color` shows as itself. An `Environment` shows its image, turned and scaled as for light. `null` shows black. A camera ray shows the background and never the lighting.

**MIS compensation (option).** Karlik et al. (2019) lower the density of the light technique where the BSDF technique is the better one. For an environment, the host subtracts `compensation * mean` from each texel's weight and clips at 0. It builds the table from the result. `compensation` is from 0 to 1 and is 0 by default. BSDF samples alone reach a texel with a density of 0 and a radiance above 0. They count in full there, so the estimate stays unbiased. The tables are the only change.

## Why

### Part 1: The principled BSDF

- **The demo needs it.** The M3 acceptance names DamagedHelmet, FlightHelmet and one glass object. At the baseline `PhysicalMaterial` renders as a diffuse of its colour (record 0004, step 1), so none of the three can look right.
- **Why Burley and glTF.** The demo's assets are glTF files, so their parameters are metallic-roughness. Cycles' Principled BSDF has the same lineage. A model that shares the parameters and the lobes keeps the side-by-side honest. Part 6 lists the differences that remain.
- **Why the visible normals of a spherical cap.** Dupuy and Benyoub (2023) sample the same density as Heitz's visible normals (2018). Their method needs no rejection and no branch on the view angle. It uses sums, products and `sqrt`, so it keeps record 0005 rule 2. The angle comes from `turn`.
- **Why exact Fresnel for a dielectric.** Glass must conserve energy, and Schlick's term does not. The exact term needs `sqrt` and `/`, which rule 3 admits. Cycles uses the exact term for a dielectric too.
- **Why Turquin's compensation.** Kulla and Conty's method adds a lobe with its own sampling and a second table. Heitz's random walk needs a loop for each sample (Heitz et al. 2016). Turquin's factor scales the lobe, so it adds no lobe and no density. It needs one 2D table.
- **Why a uniform block for the tables.** Record 0001 rule 1 leaves no storage slot. A texture needs the compiler's change 0050, and Part 1 should not wait for it. A header in `materials` would shift every material index. A uniform block of 8,192 bytes costs no dependency. OpenGL ES 3.0 guarantees 16,384 bytes for a block, so the block fits on WebGL2 too (record 0007).
- **Why multiple importance sampling.** A large light seen by a glossy surface has too much variance for the light sample alone. A small light seen by a glossy surface has too much for the BSDF sample alone. Veach's weights keep the better of the two at each direction. Part 3 needs the same code for the environment.
- **Why next-event estimation at every bounce.** A surface can have a delta lobe beside a lobe that is not delta. The guard on the sampled lobe then drops a share of the direct light. That share is the chance of the delta lobe.

Alternatives considered:

- **Lambert and Blinn-Phong.** They are cheaper and they cannot match a glTF asset.
- **Cycles' own Principled BSDF v2.** Its layering is newer than glTF's. The assets are authored against glTF's layering, so the engine follows glTF and lists the difference.
- **Schlick for every Fresnel term.** It avoids `sqrt`. It breaks the furnace test for glass.
- **A table baked at run time on the GPU.** It adds a pass and a dependency on first use. The baked file is data that a test can read.

### Part 2: Textures

- **The assets are textured.** DamagedHelmet has five textures and FlightHelmet has fifteen. Without textures the demo shows flat colours.
- **Why arrays by size class.** Record 0004, decision 4 stands. An atlas needs its own uv mapping and wraps badly. A binding for each texture hits the limit of 16 sampled textures. Four arrays use four of the 16.
- **Why the kernel filters.** WebGPU lets a sampler differ in precision from one vendor to the next. The oracle cannot run a sampler at all. If the kernel filters with `textureLoad`, the oracle runs the same filter code and only the fetch differs. Inference: this makes the `textures` differential scene as tight as the others. The cost is eight loads for one lookup, where a sampler needs one. Step 2.5 records the cost.
- **Why the host builds the mips.** The draft change 0050 averages the stored codes of an unorm format. For an sRGB image this averages in gamma space and darkens the result. The host averages in linear light and keeps the choice in `mip.ts`, where a test holds it.
- **Why a table for sRGB.** A 256-entry table is exact and needs no `pow`. The hardware's sRGB conversion is a second step that a device decides.
- **Why a ray cone.** Full ray differentials carry two direction vectors and two origin vectors along a path. The cone carries two floats. The camera ray's cone matches the differential in its major axis. Step 2.4 measures the difference against a host implementation of Igehy's method.
- **Why the footprint scale.** A progressive renderer averages many samples in a pixel. A level that covers the whole pixel blurs the result twice. pbrt-v4 scales the footprint down with the sample count. Step 2.6 measures the scale against the level 0 image.

Alternatives considered:

- **`textureSampleLevel` with a sampler** (record 0004's plan). It is faster and shorter. It has the three faults above, so the record changes the plan.
- **One atlas texture.** It needs a uv remap in the kernel and bleeds across tiles at the mip levels.
- **Hardware mipmaps through 0050's `generateMipmaps()`.** It averages codes. It is right for data textures only.
- **A proposal to the compiler for CPU texture reads.** It would remove `oracle-fetch.shade.ts`. It is an issue to open, and nothing blocks on it.

### Part 3: Lights

- **The demo is lit by an HDRI.** The M3 acceptance names HDRI, point, spot and sun lights. A product shot needs an environment and a key light.
- **Why the lights see no ray.** A point or a sun has no surface. If no ray can meet it, only next-event estimation reaches it, and no weight is needed. A glossy surface still shows the light through its lobe, because the lobe's value at the light's direction is large.
- **Why a power table first.** The table is the form that record 0001 already has. A light tree is a second structure with its own traversal and its own bugs. The demos hold few lights, so the tree has little to gain. Part 3 records the tree as deferred, with the place it would live.
- **Why importance sampling of the environment.** A sunny HDRI holds most of its energy in a few texels. Uniform sampling of the sphere sends almost every shadow ray to a dark sky. Step 3.3 records the variance ratio against uniform sampling.
- **Why a table of 1,024 texels.** The search has 10 steps along a row and 9 down the rows. The distribution may be coarser than the image. The weight of a sample uses the density of the table and the radiance of the image. A coarse table changes the variance and not the mean.
- **Why `rgba32float`.** A sun texel can pass 65,504, which a half float clips. The cost is 16 bytes a texel.
- **Why compensation is an option.** Karlik et al. report gains for some scenes. The gain depends on the scene, so the default is off until step 3.4 measures it.

Alternatives considered:

- **An alias table.** It samples in constant time. Its map from a number to a texel is not monotone, so it breaks the stratification of the Sobol pairs. The CDF map is monotone.
- **A hierarchical warp (Clarberg et al. 2005).** It also keeps the stratification and needs no search. It needs a mip pyramid and more code. The binary search is shorter.
- **An octahedral map.** It needs no `atan2`. The assets are equirectangular, so the host would resample every image. A resample loses detail at the poles.
- **A sun as a bright texel.** A sun of 0.5 degrees is a fraction of one texel in a 2,048 wide image. A light of its own is exact and cheap.

## What it touches

### Part 1: The principled BSDF

- **Engine kernels.** `packages/radiance/src/kernels/materials.shade.ts` changes `sampleBsdf` and `evalBsdf`. It gains the helpers `lobeChances`, `ggxD`, `smithG2`, `sampleVndf`, `fresnelDielectric`, `schlick5`, `msFactor`, `expNeg` and `absorb`. `trace.shade.ts` changes `radiance` and `direct`, and gains `lightIndex` and `lightPdf`. `layout.shade.ts` gains `AlbedoTables` and the offsets `MATERIAL_VOLUME` and `MATERIAL_EXTRA`. `kernels/tables.ts` is new and baked. `determinism-lists.ts` gains one row (Amendments owed).
- **Engine host.** `materials/PhysicalMaterial.ts` gains its parameters. `renderers/scene-pack.ts` changes `packMaterial`. `renderers/PathTracer.ts` uploads the tables. `index.ts` and `__api__/surface.md` change with the new parameter types.
- **Addons.** `loaders/GLTFLoader.ts` maps the extensions of the table above. `scenes/` gains `PhysicalScene` (the `physical` scene), `MisScene`, `FurnaceScene` and `GlassScene`.
- **Scripts.** `scripts/bake-tables.ts` is new. `scripts/oracle.ts` binds the new block. `scripts/scenes.ts` lists the scenes. `scripts/gates.mjs` gains the `ORACLE` bounds of each scene. `scripts/gates/furnace.mjs` is the new gate.
- **Tests owed.** `materials.test.ts` grows by one group for each lobe. The density integrates to 1. The sample weight equals the quadrature of `f * cos`. The lobe is reciprocal. `scene-pack.test.ts` holds the record's words. `tables.test.ts` holds the baked file against a fresh bake. `trace.test.ts` (new) holds the three estimators of `mis` against each other. `GLTFLoader.test.ts` holds each extension.
- **Gates.** `gate:differential` runs `physical`, `mis` and `glass`. `gate:determinism` runs the same scenes. `gate:furnace` is new. `gate:render` changes the goldens of any example that uses `PhysicalMaterial`. `gate:api` re-bakes.
- **Site.** The guide's page on materials describes the lobes and the parameters. The API reference follows the JSDoc.

### Part 2: Textures

- **Engine host.** `textures/Texture.ts`, `textures/DataTexture.ts`, `textures/TexturePool.ts` and `textures/mip.ts` are new. `materials/Material.ts` and `PhysicalMaterial.ts` gain the map parameters. `renderers/scene-pack.ts` changes `packMaterial` and `cameraFrame`. `renderers/PathTracer.ts` binds the four arrays and gains `textureBudget`, `footprintScale` and `info.textureBytes`. `index.ts` and `__api__/surface.md` change.
- **Engine kernels.** `fetch.shade.ts`, `filter.shade.ts` and `alpha.shade.ts` are new. `intersect.shade.ts` changes `surface`, `surfaceAt`, `nearest` and `occluded`. `materials.shade.ts` reads the tints. `trace.shade.ts` carries the cone in `radiance` and passes it to `direct`. `layout.shade.ts` gains `AlbedoTables.srgb` and `TraceParams.foot`.
- **Addons.** `loaders/GLTFLoader.ts` reads images, samplers, `normalTexture.scale` and `alphaMode`. Its option `decode` is new. `scenes/` gains `TexturedScene` (the `textures` scene).
- **Scripts.** `scripts/oracle-fetch.shade.ts` and `scripts/raydiff.ts` are new. `scripts/oracle.ts` binds the substitute. `scripts/bake-tables.ts` bakes the sRGB tables. `scripts/gates.mjs` gains the `ORACLE` bound of `textures`.
- **Tests owed.** `mip.test.ts`, `TexturePool.test.ts`, `filter.test.ts` (new, on the oracle), `footprint.test.ts` (new, against `raydiff.ts`), `alpha.test.ts` and the loader's tests.
- **Gates.** `gate:differential` runs `textures`. `gate:determinism` runs it too. `gate:render` changes the golden of any example that loads a texture. None does at the baseline.
- **Site.** The guide gains a page on textures. The API reference follows the JSDoc.

### Part 3: Lights

- **Engine host.** `lights/PointLight.ts`, `SpotLight.ts`, `SunLight.ts` and `Environment.ts` are new. `lights/environment-table.ts` builds the distribution tables. `scenes/Scene.ts` gains `environment` and `background`. `renderers/scene-pack.ts` changes `#lightTable`, writes the blocks and makes the environment textures. `renderers/PathTracer.ts` binds them. `index.ts` and `__api__/surface.md` change.
- **Engine kernels.** `trace.shade.ts` changes `pickLight`, `direct` and `radiance`, and gains `lightPdfEnvironment`. `layout.shade.ts` gains `TraceParams.lights`, `env` and `background`, the type constants and the block offsets. `fetch.shade.ts` gains the three reads of the environment. `environment.shade.ts` is new: `atan2Approx`, the mapping, the radiance read and the sample.
- **Addons.** `loaders/RGBELoader.ts` is new. `loaders/GLTFLoader.ts` reads `KHR_lights_punctual`. `scenes/` gains `AnalyticScene` and `HdriScene`.
- **Scripts.** `scripts/oracle-fetch.shade.ts` gains the three reads. `scripts/oracle.ts` binds the tables. `scripts/gates.mjs` gains the bounds of `analytic` and `hdri`.
- **Tests owed.** `lights.test.ts` (new, on the oracle), `environment-table.test.ts`, `environment.test.ts` (new, on the oracle), `RGBELoader.test.ts` and the loader's test for `KHR_lights_punctual`. `scene-pack.test.ts` holds the rows and the blocks.
- **Gates.** `gate:differential` runs `analytic` and `hdri`. `gate:determinism` runs them too. `gate:furnace` gains the environment row. `gate:render` changes no golden at the baseline.
- **Site.** The guide gains a page on lights and environments.

## Amendments owed

### Part 1: The principled BSDF

**Record 0001.** Three places change.

> Rule 2 gains this sentence at its end: "The `materials` buffer is the exception. It stores an integer word below 2^24 as the value of an `f32` and reads it with `u32()` (record 0010, Part 1)."

> The `materials` row of the table of buffers reads: "Record 0004's material record, with the words of record 0010, Part 1. Its integer words are values."

> The sentence "The two uniform blocks, which replace M1's `TraceParams`" reads "The uniform blocks": `TraceParams`, `PresentParams` and `AlbedoTables`. `AlbedoTables` holds two arrays of 256 `vec4`, the tables of multiple scattering and of sheen (record 0010, Part 1)."

**Record 0002.** Two places change.

> The gate table gains a row for `furnace`. What it proves: a white object in an enclosure that emits 1 reads 1 in each pixel that it covers. Scene: `furnace`, 16 x 16, 1,024 spp. Number: for each row, the bound that record 0010 step 1.4 measures. It runs in the `harness` job.

> The table of differential scenes gains the rows `mis` (the power heuristic against each technique alone), `furnace` (the enclosure) and `glass` (transmission and absorption). All three are added at M3.

**Record 0003.** One place changes.

> "The public surface at 0.1.0" gains the parameters of `PhysicalMaterialParameters` and the accessors of `PhysicalMaterial`. They are `anisotropy`, `anisotropyRotation`, `clearcoat`, `clearcoatRoughness`, `sheen`, `sheenColor`, `sheenRoughness`, `thickness`, `attenuationColor`, `attenuationDistance` and `multipleScattering`.

**Record 0004.** Seven places change.

> "The record" table is the table of Part 1, "The material record". Two bullets of that section change: "M2 fills `[0]` to `[3]`" and "Six words of the record are integers". The three bullets of Part 1 replace them. They start with "The integer words become values".

> Decision 8 stands as follows: "At M3 the integer words are values and the engine keeps seven storage buffers. Step 6 and the binding `materialBits` are not built unless a later record asks for them."

> "The shading contract" gains these fields. `Surface.pb` is the hit point offset along `-ng`. `Surface.baseTint`, `Surface.mrTint`, `Surface.emissiveTint` and `Surface.normalTint` hold what the textures give (Part 2). They are 1 until a texture is read. The sentence on `BsdfSample.specular` reads: "A delta lobe or a transmission sample: the next light hit counts in full."

> "A direction under the surface" gains this text. "A transmission sample starts its ray at `Surface.pb`. The path ends when `dot(wi, ng)` is not above 0 for a reflection lobe. It ends too when `dot(wi, ng)` is not below 0 for a transmission lobe." Step 2 of this record asks for this amendment.

> "The path loop" is the loop of Part 1, "Multiple importance sampling". Step 3 adds the weight of a light hit. Step 6 loses its guard on the sampled lobe.

> Step 2 and step 4 read: "Delivered by record 0010, steps 1.2 to 1.8."

> The `physical` bullet of "What it touches" names the scenes `physical`, `mis`, `furnace` and `glass`.

**Record 0005.** Two places change.

> Rule 2 gains: "A BSDF value may use `pow` or `exp2` when it names its function in `VALUE_ONLY`. Russian roulette reads the throughput, which carries such a value. The differential gate bounds a roulette decision that a driver moves. The Fresnel term and `expNeg` use products, so they use no such row."

> `VALUE_ONLY` gains `sheenD: ['pow']`.

**Record 0007.** One place changes.

> Rule 4 of the tier's integer words gains: "`materials` is the exception while record 0010, Part 1 stores its integer words as values. If this rule makes `materials` an `array<vec4u>`, that part moves its integer words back to bits."

### Part 2: Textures

**Record 0001.** Two places change.

> `TraceParams` gains the field `foot: vec4`. Its first word is the footprint scale times the pixel's spread angle. Three words are reserved. The `trace` entry then binds four sampled textures, `texels0` to `texels3`. It binds seven storage buffers beside them.

> "Limits" gains: "The `trace` entry samples 4 textures of the 16 that WebGPU allows each stage. The array of a class holds 256 layers (record 0010, Part 2)."

**Record 0002.** Two places change.

> The `textures` scene row reads: "A quad with a checker and a normal map, and a plane that runs to the horizon. The kernel chooses the mip level".

> The probe list gains: "`textures`: the oracle's fetch shifted by one texel fails the `mean` bound. The device's conversion of the 256 codes of an 8-bit texture equals `fround(code / 255)`".

**Record 0003.** One place changes.

> "The public surface at 0.1.0" gains `Texture`, `DataTexture` and `TextureImage`. It gains the material parameters `map`, `normalMap`, `roughnessMap`, `metalnessMap`, `emissiveMap` and `normalScale`. It gains the renderer parameters `textureBudget` and `footprintScale`, and the loader option `decode`.

**Record 0004.** Four places change.

> "The texture plan (M3)" reads: "The engine keeps four `texture_2d_array<f32>`, one for each size class (256, 512, 1024 and 2048). Each is `rgba8unorm` with a full mip chain. The kernel reads them with `textureLoad` and filters them itself. No sampler is bound. A texture id is `(1 + class * 256 + layer) + 2048 * wrap`. The kernel chooses the level from a ray cone."

> "The shading contract" gains the fields `Surface.dpdv` and `Surface.bsign`, and the parameter of `surface` and `surfaceAt` that carries the footprint.

> Step 3 reads: "Delivered by record 0010, steps 2.1 to 2.7."

> The sentence "A texture read happens in `surface` (M3), before the contract" stands.

**Record 0005.** Two places change.

> The rules gain Rule 7: "A texture is read by `textureLoad` and filtered in the kernel by sums and products. The conversion of an 8-bit code to `f32` is the one step a device decides. A probe measures it."

> Rule 2 gains: "A mip level is computed from the exponent bits of an `f32` and a polynomial. It does not use `log2`."

**Record 0006.** Two places change.

> The paragraph on item 4 gains: "Record 0010, Part 2 uses `Texture.write(bytes, { layer, level })`, `mipLevelCount` and `layers` of change 0050. It does not use `generateMipmaps()`."

> The table gains an item: "CPU-tier texture reads. `compileModuleJs` evaluates `textureLoad` and `textureNumLayers` over an image that the host sets. Needed by: record 0010, Part 2. Until it lands: `scripts/oracle-fetch.shade.ts`." The engine opens it as an issue.

**Record 0007.** One place changes.

> "The execution model" gains: "The `trace` entry reads 4 texture arrays with `textureLoad` and no sampler. On WebGL2 each read is a `texelFetch`. Each array holds at most 256 layers, the OpenGL ES 3.0 minimum of `MAX_ARRAY_TEXTURE_LAYERS`."

### Part 3: Lights

**Record 0001.** Three places change.

> "The light table" gains: "The rows come in this order: triangles, points, spots, suns, the environment. The type word of a row that is not a triangle is the value of an `f32`. Four `vec4` follow the rows for each point, spot or sun. The chance of each type is its share of the flux that record 0010, Part 3 gives."

> The `lights` row of the table of buffers reads: "`(type, instance, triangle, cdf)`. Types 0 to 4 are a triangle, a point, a spot, a sun and an environment. The blocks of the analytic lights follow the rows."

> `TraceParams` gains `lights: vec4u`, `env: vec4` and `background: vec4`. `lights` holds the triangle rows, the blocks, a flag for the environment and one reserved word. `env` holds the intensity, the cosine and the sine of the rotation, and the compensation. `background` holds a colour and a mode (0 black, 1 environment, 2 colour).

**Record 0002.** Two places change.

> The table of differential scenes gains two rows. `analytic` is a plane under a point, a spot, a sun and a sphere light, held to closed forms. `hdri` is a floor and a sphere under an environment with one very bright texel. The `furnace` gate gains two rows: a white diffuse sphere in a constant environment, and one in an image of 1.

> The probe list gains: "`analytic`: an intensity of 1.01 times the right one fails the closed form."

**Record 0003.** One place changes.

> "The public surface at 0.1.0" gains `PointLight`, `SpotLight`, `SunLight`, `Environment`, `Scene.environment`, `Scene.background` and `RGBELoader`. `TextureImage` gains the data type `Float32Array`.

**Record 0004.** One place changes.

> "The path loop" step 1 reads: "Traverse the scene. When the ray meets nothing, add the environment and end the path."

**Record 0005.** Two places change.

> Rule 2 gains: "A direction that selects a texel uses `atan2Approx`, which is a rational function of sums, products and one division. A direction from an angle uses `turn`."

> The allowlist note gains: "`atan2Approx` adds one `/` row, which rule 3 admits."

**Record 0006.** One place changes.

> The paragraph on item 4 gains: "Record 0010, Part 3 writes the environment with `Texture.write` as a `Float32Array` into `rgba32float`, `rg32float` and `r32float` textures."

**Record 0007.** One place changes.

> "The execution model" gains: "The `trace` entry also reads three environment textures of 32-bit floats with `textureLoad`. WebGL2 renders to such a texture only with `EXT_color_buffer_float`. The extension is present on SwiftShader."

## Implementation, in steps

### Part 1: The principled BSDF

Each step is one pull request. The figures are proposals, and each step records its measured value. Steps 1.2 to 1.8 each add the loader's mapping for the extension they bring.

**1.1 The words of the record.**

- Delivers: `packMaterial` writes the table of Part 1. `flagsOf` reads `u32(word.w)`. `PhysicalMaterial` gains its parameters and the kernel ignores them. No lobe changes.
- Test: `scene-pack.test.ts` reads each word of a material with every parameter set. `materials.test.ts` stores every texture id from 0 to 1,024 and every flag mask below 0x2000, and reads each back.
- Number: no golden changes. `gate:determinism` reports 0 of 1,024 floats that differ.
- Probe: the same test stores 16,777,217 and must read 16,777,216. It shows that the exactness test can fail.

**1.2 The diffuse and reflection lobes.**

- Delivers: Burley's diffuse and the GGX reflection lobe with the visible normals of a spherical cap. It also delivers the exact dielectric Fresnel term, Schlick's term as products, `lobeChances`, `Surface.pb` and the tint fields at 1. The `physical` scene has three spheres at roughness 0.1, 0.5 and 1, and one metal sphere.
- Test: the density of `evalBsdf` integrates to 1 within 2 % by 4,096 samples, at roughness 0.1, 0.5 and 1. The mean `weight` of 65,536 `sampleBsdf` samples equals the quadrature of `f * cos` within 2 %. The reflection lobe is reciprocal within 1e-5.
- Number: the `ORACLE` bound of `physical` is derived by the rule of record 0002. The pull request lists each golden that moves, with the old and the new picture.
- Probe: the test runs once with a density that `evalBsdf` multiplies by 1.1. It must fail.

**1.3 Multiple importance sampling.**

- Delivers: `lightIndex`, `lightPdf`, the weights in `direct` and in `radiance`, and next-event estimation at every bounce. Two internal flags in `params.path.z` turn off the light sample or the BSDF hit. The `mis` scene has four plates of roughness 0.01, 0.1, 0.3 and 0.7 under four spherical lights of radius 0.02, 0.1, 0.3 and 0.9.
- Test: on each plate the mean of the combined estimator lies within 3 standard errors of the mean of each technique alone. The standard errors come from 16 independent seeds.
- Number: the variance of the combined estimator is at most 1.5 times the smaller of the two single-technique variances on every plate. The step records the ratios.
- Probe: weights that sum to 1.1, such as `pL / (pL + pB)` and `pB / (pB + 0.5 * pL)`, must move the mean of a plate by more than 3 standard errors.

**1.4 Multiple scattering and the furnace.**

- Delivers: `scripts/bake-tables.ts`, `tables.ts`, the `AlbedoTables` block, its upload and its oracle binding, `msFactor`, `MATERIAL_NO_MS`, `PhysicalMaterial.multipleScattering`, and `gate:furnace`. The `furnace` scene is a sphere of radius 20 whose inner face emits 1 and reflects nothing, and a white sphere at its centre. The camera sits inside it.
- Test: the table agrees with a Monte Carlo estimate of the kernel's own lobe within 1.5 % at eight grid points. The baked file agrees with a fresh bake within 2e-6. The gate holds a white metal sphere at roughness 0.25, 0.5 and 1, and a white dielectric sphere at 0.5 and 1.
- Number: the mean over the pixels of the sphere lies within 0.03 of 1 for the metal rows. The dielectric rows take the bound that the step measures, because Burley's diffuse does not conserve energy exactly.
- Probe: the metal row at roughness 1 runs with `MATERIAL_NO_MS` set. The gate must fail. The step records the mean it reports, which the quadrature above puts well under 0.8.

**1.5 Transmission, absorption and thin walls.**

- Delivers: the transmission lobe, `expNeg`, `absorb`, the thin-walled flag and the end rule for a transmission sample. The `glass` scene has a smooth sphere, a rough sphere, an index-matched box with absorption and a thin sheet.
- Test: a refracted direction follows Snell's law within 1e-6. The Fresnel term at normal incidence is 0.04 for `ior` 1.5 within 1e-6. `expNeg` has a relative error of at most 3e-5 over 0 to 32. The index-matched box reads its `attenuationColor` within 1e-3.
- Number: the smooth glass sphere reads 1 within 0.02 in the furnace at 16 bounces. The rough glass sphere loses energy, and the step records its mean as the row's bound.
- Probe: the test runs once without the factor `1 / eta^2` on the exit. The smooth sphere must read more than 0.05 away from 1.

**1.6 Anisotropy.**

- Delivers: the anisotropic GGX lobe, the tangent from `Surface.dpdu` turned by `anisotropyRotation`, and the loader's `KHR_materials_anisotropy`.
- Test: with `anisotropy` 0 the result equals the isotropic result bit for bit. A histogram of the sampled normals matches the visible-normal density within 5 sigma per bin. The widths of a highlight on a disc have the ratio `alphaX / alphaY` within 10 %.
- Number: the anisotropic metal row of the furnace reads within 0.03 of 1.
- Probe: the histogram test runs once with `alphaX` and `alphaY` swapped. It must fail.

**1.7 Clearcoat.**

- Delivers: the clearcoat lobe, the scaling of the base lobes, and the loader's `KHR_materials_clearcoat`.
- Test: the density integrates to 1. A white diffuse sphere with `clearcoat` 1 reads at most 1.02 in the furnace.
- Number: the step records the furnace mean of the coated sphere. It is the bound of its row.
- Probe: the test runs once without the scaling of the base lobes. The coated sphere must read above 1.02.

**1.8 Sheen.**

- Delivers: the Charlie lobe, the sheen table in `AlbedoTables`, the base scaling, and the loader's `KHR_materials_sheen`.
- Test: the sheen table agrees with a Monte Carlo estimate within 1.5 % at eight grid points. A sheen sphere on a black base reads at most 1.02 in the furnace.
- Number: `sheenD` is the one row that the determinism lint admits for `pow`. The lint reports no other new row.
- Probe: the lint runs once with `sheenD` removed from `VALUE_ONLY`. It must report the row.

Part 1 is done when step 1.8 has merged. At that point `bun run check` and `bun run harness` pass, and record 0004 steps 2 and 4 read "delivered".

### Part 2: Textures

Step 2.1 does not wait for the compiler. Steps 2.2 to 2.7 wait for the pin that carries change 0050. Each step is one pull request.

**2.1 The classes, the ids and the mip chain.**

- Delivers: `Texture`, `DataTexture` and the map parameters. `TexturePool` gives the class of a texture, the resample, the mip chain and the ids with their wrap term. It also delivers the sRGB tables in `bake-tables.ts` and `textureBudget`. A scene without textures binds four textures of 1 by 1 texel. No kernel reads a texel.
- Test: a constant image stays constant through every level. A checker of codes 0 and 255 gives code 188 at the next level. Each sRGB code decodes and encodes back to itself. Each id from every class, layer and wrap survives an `f32`. The budget error names the largest texture.
- Number: no golden changes. `gate:determinism` reports 0 of 1,024 floats that differ.
- Probe: the checker test runs once with a gamma of 2.0 in the encode. It must read 180 and fail.

**2.2 The fetch, the filter and the oracle substitute.**

- Delivers: `fetch.shade.ts`, `filter.shade.ts`, the upload through `Texture.write`, `oracle-fetch.shade.ts` and its binding, and the `textures` scene with a checker quad at level 0.
- Test: a lookup at a texel centre returns the texel. A lookup between two texels returns their mean. Each wrap mode agrees with a host reference within 1e-6 at 1,000 random coordinates. The probe of the 256 codes compares the device's conversion with `fround(code / 255)`.
- Number: 0 of 256 codes differ on SwiftShader. No hardware device ran, and the step says so. The `ORACLE` bound of `textures` is derived by the rule of record 0002.
- Probe: the oracle's fetch runs once shifted by one texel. The differential gate must fail its `mean` bound.

**2.3 The colour maps.**

- Delivers: `AlbedoTables.srgb`, the reads of `map` and `emissiveMap` in `surface`, the loader's images and samplers, its option `decode`, and `alphaMode` read as a warning.
- Test: a glTF built by hand with a 2 by 2 image loads through a stub decoder. A texel of code 128 decodes to 0.2158 within 1e-4. Five 2048 by 2048 images take 111,848,105 bytes in the pool.
- Number: no golden changes, because no example loads a texture.
- Probe: the decode test runs once with the table of the linear maps. It must fail.

**2.4 The normal map and the metallic-roughness map.**

- Delivers: `Surface.dpdv` and `Surface.bsign`, `normalScale`, the normal map in `surface`, and the metallic-roughness tints. The `textures` scene gains a normal-mapped plane.
- Test: a flat texel `(0.5, 0.5, 1)` leaves `ns` as it was within 1e-6. A texel tilted by 30 degrees turns `ns` by 30 degrees within 1e-4 on a flat quad. Roughness comes from green and metalness from blue within 1e-6.
- Number: the `ORACLE` bound of `textures` is derived again with the new plane.
- Probe: the test runs once with the sign of the uv frame inverted. The 30 degree test must fail.

**2.5 The footprint.**

- Delivers: the cone in `radiance`, `log2Approx`, the level choice, trilinear filtering, `TraceParams.foot` and `scripts/raydiff.ts`. The `textures` scene gains a checker plane that runs to the horizon.
- Test: `log2Approx` has an absolute error of at most 1e-3 over 2^-20 to 2^20. The level of the kernel differs from Igehy's differentials by at most 0.5. The tilts are 0, 30, 60 and 80 degrees. The pixels lie at the centre and at the corner of a 60 degree field.
- Number: the step records the cost of a lookup as frame milliseconds on `textures`, labelled SwiftShader. It records the far-field standard deviation at 4 samples a pixel, with and without mips.
- Probe: the far-field test runs once with the level forced to 0. Its standard deviation must be more than twice the standard deviation with mips.

**2.6 The footprint scale.**

- Delivers: the measurement of `footprintScale` at 0, 0.125, 0.25, 0.5 and 1, and a default that follows from it.
- Test: each scale renders `textures` at 1,024 samples a pixel, 16 by 16 pixels. The RMSE against the scale 0 image is recorded in linear light.
- Number: the default is the largest scale whose RMSE is at most 2 times the noise floor. The floor is the RMSE between two seeds of the scale 0 render. If 0.25 meets this, it stays.
- Probe: the floor measurement runs on two renders of one seed. It must read 0.

**2.7 Alpha cutout.**

- Delivers: `alpha.shade.ts`, the hooks in `nearest` and `occluded`, bit 10 of the flags, and the loader's `alphaMode` MASK with `alphaCutoff`.
- Test: a quad with a checker of alpha 0 and 1 covers 0.5 of its pixels within 0.02 in a converged render. A shadow ray passes through a hole. `nearest` and `occluded` agree on 1,000 random rays.
- Number: a scene with no cutout material loses at most 3 % of its speed on the bunny at 512 by 512. The step records the figure.
- Probe: the coverage test runs once with `alphaCutoff` 0. It must fail.

Part 2 is done when step 2.7 has merged. At that point record 0004 step 3 reads "delivered".

### Part 3: Lights

Steps 3.1, 3.2 and 3.4 do not need the pin of change 0050. Step 3.3 does, and it needs step 2.2 of Part 2. Each step is one pull request.

**3.1 Point, spot and sun lights.**

- Delivers: the three classes, the power table, the rows and the blocks, the branches of `direct`, the `lights` word of `TraceParams`, and the loader's `KHR_lights_punctual`. The `analytic` scene has a diffuse plane and one light of each kind.
- Test: `radiance` on the oracle for one ray equals the closed form `rho / pi * I * cos / d^2` within 1e-5 for the point, the spot and the delta sun. The sphere light and the sun with an angle agree with it within 1 % over 4,096 samples. The chances of the table sum to 1 within 1e-6, and each equals its share of the flux.
- Number: `gate:determinism` reports 0 floats that differ on `analytic`. The `ORACLE` bound is derived by the rule of record 0002.
- Probe: the closed-form test runs once with an intensity 1.01 times the right one. The sphere light runs once with its radiance divided by 4. Both must fail.

**3.2 The constant environment and the background.**

- Delivers: `Environment` with a colour, `Scene.environment` and `Scene.background`, and the `env` and `background` words. It also delivers the escape in `radiance`, the row of type 4 and uniform sphere sampling with the density `1 / (4 * pi)`.
- Test: a white diffuse sphere in a constant environment of 1 reads 1 within 0.02 over its pixels at 1,024 samples. The light sample alone, the BSDF sample alone and their combination agree within 3 standard errors.
- Number: the pixels of the background read 1 exactly. The step records the variance ratio of the combination against each technique alone.
- Probe: the escape weight runs once with the density `1 / (2 * pi)`. The three estimators must disagree.

**3.3 The HDRI.**

- Delivers: `RGBELoader`, `environment-table.ts`, the three textures and their reads, `atan2Approx`, the sample, the density, the radiance read, the rotation, and the `hdri` scene. The scene's image is built in code, 64 by 32 texels, with one texel 10,000 times the sky.
- Test: the density of the table sums to 1 within 1e-6. A histogram of 2^20 samples matches the table within 5 standard deviations a bin. The density of a sampled direction equals the density that the direction gives, within 1e-5 relative. `atan2Approx` has an error of at most 1e-5 radian over a grid of 10^6 directions. `RGBELoader` decodes a file of 4 by 2 texels, written by hand, to the exact floats.
- Number: the variance of the importance-sampled estimate is at most a quarter of the uniform estimate on the floor of `hdri`. The step records the ratio. A constant image of 1 passes the furnace row within 0.02.
- Probe: the sample runs once with the table and the weight of uniform sampling. Its mean must differ from the uniform estimate by more than 3 standard errors.

**3.4 MIS compensation.**

- Delivers: `Environment.compensation` and its use in `environment-table.ts`. Nothing in the kernel changes.
- Test: the means at `compensation` 0, 0.25, 0.5 and 1 agree within 3 standard errors on `hdri`. A constant image with `compensation` 1 gives an empty table, and the host falls back to uniform sampling.
- Number: the default stays 0 unless one value meets two bounds. It lowers the variance on the floor of `hdri` by 10 %. It raises the variance by under 5 % on every other `hdri` pixel. The step records the table of ratios.
- Probe: the bias test runs once with a table built from the compensated weights and the density of the uncompensated table. It must fail.

Part 3 is done when step 3.4 has merged. The light tree has no step. A later record owns it.

## Decisions for the owner

1. Default. Part 1 models the physical material on Burley's Disney BRDF (2012) and BSDF (2015), with glTF's metallic-roughness parameters and glTF's layering. It has five lobes: diffuse, reflection, transmission, clearcoat and sheen. Proposed: yes.
2. Default. A dielectric takes the exact Fresnel term. A metal and the clearcoat take Schlick's term, written as products. Proposed: yes.
3. For the owner. Multiple scattering is compensated by Turquin's method, with a 32 by 32 table in a new uniform block, `AlbedoTables`, of 8,192 bytes. Record 0001 gains a third uniform block and keeps seven storage buffers. `PhysicalMaterial.multipleScattering` is a public parameter, `true` by default. Proposed: yes.
4. Default. The weights of multiple importance sampling are the power heuristic. Next-event estimation runs at every bounce. `BsdfSample.specular` means that the next light hit counts in full. Proposed: yes.
5. For the owner. The integer words of `materials` are the values of `f32` numbers below 2^24, and the engine keeps seven storage buffers. Decision 8 of record 0004 left this choice to the owner, between this and an eighth buffer. A texture id is `0` for none, else `1 + class * 256 + layer`. Proposed: this choice.
6. Default. `[6].xyz` holds the absorption coefficient of a medium and `[6].w` the alpha of `baseColor`. `[7]` holds `emissiveMap`, `normalScale`, `alphaCutoff` and `lightGroup`. M3s amends the record when it needs a subsurface weight. Proposed: yes.
7. For the owner. M3 takes `KHR_materials_ior`, `_transmission`, `_volume`, `_clearcoat`, `_sheen`, `_anisotropy` and `_specular` by their factors. Their textures, `specularColorFactor`, `_diffuse_transmission`, `_dispersion` and `_iridescence` wait. `occlusionTexture` is never read. Proposed: this scope.
8. Default. A back face absorbs light along the ray's length, from `attenuationColor` and `attenuationDistance`. Media do not nest. A material with `thickness` 0 is thin walled. Proposed: yes.
9. Default. Record 0002 gains the `furnace` gate and the scenes `mis`, `furnace` and `glass`. A furnace row holds a bound that its step measures. Proposed: yes.
10. Default. The kernel filters textures itself with `textureLoad` and binds no sampler. The host builds the mip chain in linear light. sRGB decodes through a table. Proposed: yes.
11. For the owner. Steps 2.2 to 2.7 wait for the pin that carries the compiler's change 0050, which is a draft. The owner chooses when the pin moves. Record 0006, decision 2 already puts item 4 on M3's critical path. Proposed: yes.
12. Default. The mip level comes from a ray cone, not from full ray differentials. The default `footprintScale` is 0.25 until step 2.6 measures it. The alternative is full differentials for the camera ray, which costs four more vectors a path. Proposed: the cone.
13. Default. The oracle reads textures through `scripts/oracle-fetch.shade.ts`. The engine opens an issue for CPU texture reads on the compiler's repository. Proposed: yes.
14. For the owner. These wait: `KHR_texture_transform`, KTX2, UDIM, alpha BLEND, a nearest magnification filter, an anisotropic filter, and the sampling of a textured emitter by its map. Proposed: this scope.
15. Default. A scene may hold 536,870,912 bytes of texture layers, and the loader keeps images up to 2048 texels. Past the budget the pack throws a `RangeError`. Proposed: yes.
16. Default. The light table keeps its stride. Types 0 to 4 are a triangle, a point, a spot, a sun and an environment. The type word of a new row is a value, and four `vec4` of block follow the rows for each analytic light. Proposed: yes.
17. Default. A point, spot or sun light is invisible to rays and is reached by next-event estimation only. `intensity` is in the engine's radiometric units, with no conversion from candela or lux. A sun's default angle is 0.00918 radian. Proposed: yes.
18. For the owner. The power table is the first step and the light tree is deferred. The demo scenes hold few lights. The tree waits for a record that has a scene of thousands of emitters to measure. Proposed: this order.
19. Default. An environment is an equirectangular `rgba32float` image of at most 2,048 texels across. Its distribution is at most 1,024 across. The rotation is about +y only. `scene.background` takes a `Color`, an `Environment` or `null`. Proposed: yes.
20. Default. MIS compensation is an option, `compensation`, with 0 as the default until step 3.4 measures a gain. Proposed: yes.

## Record

**Approval and plan record.** This record is a draft. No approval applies yet.

**Configuration and validation record.** This record does not yet apply. No step is started. This draft has Parts 1 to 3 written. Parts 4 to 6 are not written yet.
