---
id: '0010'
title: The first public demo (M3) has a principled BSDF, textures, lights, a physical camera, AOVs with EXR output and a product viewer beside Cycles
status: accepted
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
| Author        | Written in an agent session for the owner. The owner's review is the approval                                                                                               |
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
- A scene that uses none of the new features keeps its radiance bit for bit. The pull request of a step compares `readRadiance` before and after on each existing differential scene, and 0 floats must differ. Three steps are the exceptions. Step 1.2 changes the picture of an example that uses `PhysicalMaterial`. Step 1.3 changes the weights of the light samples of every scene, and not their expected value. Step 5.5 changes the transform of the screen. Each of the three shows the old and the new picture.
- Every part keeps the six rules of record 0005. A part that needs another operation amends record 0005 first, in its own step.
- The public names follow record 0003, rule 2 for materials and lights, and rule 1 for what three.js has.

### What this record assumes from the records that land before it

Two pieces of work land before this record. Neither is in this worktree. Fact: `main` at 55bde46 has no record 0009 and no record of an analytic sphere. Fact: the analytic sphere record is in progress on another branch. Fact: record 0009, sampling quality, is in draft on the worktree `wt/Q`. The text of both may differ from the assumptions below. When one of them merges, its text replaces the assumption here, and a difference is a deviation of this record.

| Source                 | The part this record assumes                                                                                                                                                                                     | What this record does if the assumption fails                                                                                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Analytic sphere record | A sphere that the kernel meets analytically gives a `Surface` with `ns` equal to `ng`, a `uv`, a `dpdu` and a `dpdv`. This record needs no word of its buffer layout                                             | The white-furnace scene and the glass-sphere scenes use `SphereGeometry` at 64 by 32 segments. They lose only the exact normal     |
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
- **The clearcoat and the layering.** The base lobes are scaled by `1 - clearcoat * Fc(cosThetaO)`. The sheen scales them by `1 - max(sheenColor) * E(cosThetaO, sheenRoughness)`, with `E` from the sheen table. glTF layers the coat by `cosThetaO` only. It layers the sheen by the lower of the two scalings, one for `wo` and one for `wi`.
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

### Part 4: The physical camera

Part 4 gives the camera a focal length, an f-number, a focus distance, an ISO speed and a shutter time. The f-number sets the depth of field. The three exposure values set the exposure. Part 4 needs nothing from the other parts and nothing from the compiler.

**Before.** Fact, from the code at the baseline: `PerspectiveCamera(fov, aspect)` holds the vertical field of view and the aspect. `cameraFrame` in `scene-pack.ts` writes `lens` as `(tanX, tanY, 0, 0)`. Record 0001 reserved `lens.z` for the aperture radius and `lens.w` for the focus distance. The kernel reads neither. The exposure is one number in stops, `PathTracer.exposure`, which `present.view.x` carries to `show`.

**The film.** `PerspectiveCamera` gains the members of three.js that tie the field of view to a focal length. The formulas are three.js's (from memory, and step 4.1 checks them against its source).

- `filmGauge` is the width of the film in millimetres, 35 by default.
- `getFilmHeight()` is `filmGauge / max(aspect, 1)`.
- `getFocalLength()` is `0.5 * getFilmHeight() / tan(fov / 2)`.
- `setFocalLength(f)` sets `fov` to `2 * atan(0.5 * getFilmHeight() / f)`, in degrees.

For an aspect of 1, a focal length of 50 mm gives a `fov` of 38.58 degrees. The constructor and the existing members do not change.

**The physical camera.** `PhysicalCamera` extends `PerspectiveCamera`. The name is three-gpu-pathtracer's, which also has `fStop` and `apertureBlades`.

```ts
class PhysicalCamera extends PerspectiveCamera {
  constructor(fov?: number, aspect?: number, parameters?: PhysicalCameraParameters);
  fStop: number; // 5.6
  focusDistance: number; // 10, in scene units
  iso: number; // 100
  shutterSpeed: number; // 1 / 125, in seconds
  exposureCompensation: number; // 0, in stops
  exposureMode: 'relative' | 'absolute'; // 'relative'
  depthOfField: boolean; // true
  apertureBlades: number; // 0 is a circle. 3 or more is a polygon
  apertureRotation: number; // 0, in radians
  unitsPerMeter: number; // 1
  readonly ev100: number;
  readonly exposureStops: number;
}
```

**The exposure.** The exposure is a number of stops. The renderer adds it to its own `exposure` on the host, so the kernel does not change.

- `ev100` is `log2(fStop^2 / shutterSpeed) - log2(iso / 100)`.
- In the `absolute` mode the exposure scale is `shutterSpeed * iso / (120 * fStop^2)`, which is `1 / (1.2 * 2^ev100)`. It is the saturation-based exposure of Lagarde and de Rousiers (2014), for a scene in cd/m^2. `exposureStops` is `log2(scale) + exposureCompensation`.
- In the `relative` mode the scale is the same ratio divided by its value at the defaults. The default camera then adds 0 stops, and a scene in relative units renders as it did. A doubled ISO, a halved shutter time and an f-number that grows by `sqrt(2)` each change the exposure by one stop.
- The exposure acts on the image on the screen only. The EXR of Part 5 keeps the scene-linear radiance, and records the ISO, the shutter time and the f-number as attributes.

**The thin lens.** The aperture radius is `focalLength * 0.001 / (2 * fStop) * unitsPerMeter`, in scene units. `cameraFrame` writes it in `lens.z` and the focus distance in `lens.w`. It writes `lens.z` as 0 when `depthOfField` is false or the camera is a `PerspectiveCamera`. The kernel then follows the pinhole path, bit for bit.

In `trace`, for each sample, when `lens.z` is above 0:

1. Take the pinhole direction `dir`, the unit vector of `forward + right * x + up * y`, as today.
2. Take the focus point `eye + dir * (focus / dot(dir, forward))`.
3. Take two numbers `l` from `sample2(pixelSeed, index, PAIR_LENS)`.
4. Make a point `(px, py)` of the aperture from `l`.
5. Move the origin to `eye + right * (px * radius) + up * (py * radius)`.
6. Set the direction to the unit vector from that origin to the focus point.

`PAIR_LENS` is 65,536. A bounce takes pairs from 1 up, four to a bounce, so no bounce reaches it. A circle takes the point `sqrt(l.x) * turn(l.y)`. The radius comes from `sqrt` and the angle from `turn`, which keeps record 0005, rule 2. A polygon of `n` blades picks the sector `k = floor(l.x * n)` and remaps `l.x`. It then takes a point that is uniform in the triangle of the centre and the vertices `k` and `k + 1`. The vertices come from `turn(k / n + rotation / (2 * pi))`. The polygon has a circumradius of 1.

**The camera's footprint and the AOVs.** The texture footprint of Part 2 uses the pinhole's spread. The geometry AOVs of Part 5 use the pinhole ray too, so they stay sharp.

### Part 5: AOVs, EXR output and the ACES transform

Part 5 adds the outputs a compositor wants. They are the albedo, normal, depth, object id and light groups of a render, and an EXR file that holds them. It also adds an ACES output transform for the screen. The light groups need Part 1 (the `lightGroup` word of a material) and Part 3 (the light classes). The rest needs neither.

**Before.** Fact, from the code at the baseline: `accum` holds one `vec4` for each pixel, the sum of the samples and their count. `PathTracer.readRadiance()` reads it back and `readPixels()` reads the image on the screen. `tonemap` is a function of `trace.shade.ts` that applies the exposure, a per-channel fit of the ACES curve and the sRGB curve. No file writes EXR and no decoder reads it. The record 0008 decision 20 names an owner-approved change to the "output transform" on 2026-10-06. Fact: no file of the baseline says whether it changed `tonemap`. Step 5.5 reads `tonemap` first.

**The AOVs.** Each AOV is defined at the first hit of the camera ray, after any delta bounces.

| AOV    | Value                                                                         | Miss                   | Channels                        |
| ------ | ----------------------------------------------------------------------------- | ---------------------- | ------------------------------- |
| albedo | `baseColor` times the map, at the first hit that has a lobe that is not delta | the background colour  | `Albedo.R`, `.G`, `.B`          |
| normal | the shading normal `ns` at the same hit, in world space, unit length          | (0, 0, 0)              | `Normal.X`, `.Y`, `.Z`          |
| depth  | the distance along the camera's forward axis to the first hit                 | 1e10, as Cycles has it | `Depth.Z`                       |
| id     | the object of the first hit, kept as coverage by id (Cryptomatte, below)      | none                   | `CryptoObject00.R` and the rest |
| groups | the radiance of the lights of one group, for each group                       | 0                      | `Group<k>.R`, `.G`, `.B`        |

A delta bounce is a mirror or a smooth refraction. The albedo of a hit that follows delta bounces takes the product of their weights. The AOVs use the pinhole ray, whatever the lens (Part 4). The names of the channels are the proposal of step 5.6, which opens the file in Blender and records the names that the compositor lists.

**Where the AOVs accumulate.** Record 0001 rule 1 allows seven storage buffers in the `trace` pipeline. Part 5 keeps it.

- **The geometry AOVs** have their own entry, `aov`, in `trace.shade.ts`. It binds `nodes`, `triangles`, `vertices`, `instances`, `materials` and a new buffer, `aovAccum`. That is six storage buffers. The entry traces the same pixel samples as `trace`, with the same jitter of pair 0, so the edges agree. It follows delta bounces and stops at the first hit that has a lobe that is not delta.
- **The record of a pixel in `aovAccum`** is four `vec4`. Word 0 holds the albedo sum and the count of hits. Word 1 holds the normal sum and the depth sum. Words 2 and 3 hold four pairs `(id, count)`. The host reads the sample count of the whole frame from the renderer. Each pixel is one invocation, so the entry reads and writes its own record with no atomic.
- **The light groups** go into `accum`. `ACCUM_STRIDE` becomes a runtime value, `params.path.w`. Slot 0 of a pixel is the beauty. With `G` groups above 1, slots 1 to `G` hold the group sums. Record 0009 may widen slot 0 into `K` slots for the median of means. Part 5 uses `K` equal to 1 until then.
- **The cost.** A buffer of `pixels * stride * 16` bytes must stay under the binding limit. At 1,024 by 1,024 pixels each slot is 16,777,216 bytes, so a stride of 8 fits 128 MiB. At 1920 by 1080 each slot is 33,177,600 bytes and a stride of 4 fits. The pack throws a `RangeError` that names the buffer and the limit, as record 0001 has it.
- **The group of a light.** A triangle light takes it from `[7].w` of its material. A point, spot or sun light takes it from `[1].w` of its block. The environment takes it from `Environment.group`. The default is group 0. `radiance` adds each contribution to the sum of its light's group and to the total.

**The renderer.** `PathTracerParameters` gains `aovs` (a list of `'albedo'`, `'normal'`, `'depth'` and `'id'`, empty by default) and `lightGroups` (1 by default). A renderer with no AOV allocates no `aovAccum` and dispatches no `aov` entry. `PathTracer` gains `readAov(name)`, `readLightGroup(k)` and `readCryptomatte()`. `readAov` returns the mean for albedo, the normalised sum for normal, the mean over the hits for depth and the share of hits as `coverage`.

**Object ids and Cryptomatte.** Each instance takes an object index from the name of its mesh. The index is the value of an `f32` in `[7].z` of its instance (a word that record 0001 left at 0). The pack numbers the distinct names in order of first use, with `mesh.name`, or `object<n>` for an unnamed one. The entry keeps up to four `(index, count)` pairs for each pixel. When a fifth appears, it drops the pair of the lowest count. A hash must not pass through an `f32` lane, because the runtime changes a NaN there (record 0004, "The integer words"). So the kernel carries the index, and the host makes the hash.

- **The hash.** The host hashes the UTF-8 bytes of the name with MurmurHash3, 32 bits, seed 0. It turns the result into a float32 by the Cryptomatte rule. The bits are kept, and bit 23 is flipped when the exponent is 0 or 255. This is from memory of the specification (version 1.2.0), and step 5.4 reads it.
- **The layers.** `CryptoObject00` holds in `R` the first id, in `G` its coverage, in `B` the second id and in `A` its coverage. `CryptoObject01` holds the third and fourth. The pairs are in order of falling coverage. Coverage is the count over the number of samples.
- **The metadata.** The EXR header holds `cryptomatte/<key>/name`, `/hash` (`MurmurHash3_32`), `/conversion` (`uint32_to_float32`) and `/manifest`. The manifest is a JSON object from each name to the eight hex digits of its float. `<key>` is the first seven hex digits of the hash of the layer name.

**The EXR file.** `@typeshade/radiance-addons` gains `EXRExporter` (three.js has a class of this name) and `EXRLoader`. Both are written in the package. The boundary allows no library.

```ts
interface ExrImage {
  width: number;
  height: number;
  channels: { name: string; data: Float32Array }[]; // row 0 is the top row
  attributes?: Record<string, number | string | number[]>;
}
class EXRExporter {
  parse(image: ExrImage, options?: { compression?: 'none' | 'zip'; type?: 'half' | 'float' }): Promise<Uint8Array>;
  fromRenderer(renderer: PathTracer, options?: ExrOptions): Promise<Uint8Array>;
}
class EXRLoader {
  parse(bytes: Uint8Array): Promise<ExrImage>;
}
```

- **The format.** It is a single-part scanline file. The magic is `76 2f 31 01`. The version word is 2 with no flags. The header holds `channels`, `compression`, `dataWindow`, `displayWindow`, `lineOrder` (increasing y), `pixelAspectRatio`, `screenWindowCenter` and `screenWindowWidth`. The channels are in alphabetical order, each with a pixel type (half 1, float 2). The offset table holds one 64-bit offset for each block. A block holds a y, a size and the data. One scanline is a block for `none`, and 16 scanlines are a block for `zip`. This is from memory of the OpenEXR file layout, and step 5.3 reads the specification.
- **The `zip` form.** The bytes of a block are reordered: the even bytes first, then the odd ones. A predictor stores each byte as its difference from the byte before, plus 128. Then `CompressionStream('deflate')` makes a zlib stream. `EXRLoader` reverses it with `DecompressionStream`. `none` needs neither. A file with another compression (PIZ, DWA) is refused, and the error names it.
- **The pixel type.** The default is `float`. A half float is a bit operation with round to nearest even, written in the package.
- **The attributes.** The exporter writes `chromaticities` for the Rec. 709 primaries, and the standard attributes `expTime`, `isoSpeed`, `aperture`, `focus` and `focalLength` of a `PhysicalCamera`. This is from memory of the standard attribute names, and step 5.3 checks them.
- **The content.** The beauty is scene-linear in Rec. 709 primaries, with no exposure and no output transform, in `R`, `G`, `B` and `A` (the share of hits). The EXR is for a compositor, which applies its own view transform.

**The ACES output transform.** The screen shows the beauty through an output transform. The transform is Hill's fit of the ACES RRT and ODT (Stephen Hill, 2016). It has a matrix into the AP1 space, a rational curve for each channel, a matrix back, a clamp and the sRGB curve. It uses products and divisions.

```
v' = M_in * (exposure * v)
c  = (v' * (v' + 0.0245786) - 0.000090537) / (v' * (0.983729 * v' + 0.4329510) + 0.238081)
out = clamp(M_out * c, 0, 1), then the sRGB curve
```

`M_in` has the rows `(0.59719, 0.35458, 0.04823)`, `(0.07600, 0.90834, 0.01566)` and `(0.02840, 0.13383, 0.83777)`. `M_out` has the rows `(1.60475, -0.53108, -0.07367)`, `(-0.10208, 1.10813, -0.00605)` and `(-0.00327, -0.07276, 1.07602)`. This is from memory of the published fit, and step 5.5 compares each number with the source. The sRGB curve keeps its `pow`, as record 0005 allows for a value (`tonemap` is in `VALUE_ONLY`). The curve changes the picture of every example, so the pull request of step 5.5 lists every golden.

### Part 6: The demo

Part 6 builds the first public demo of the plan. It has a product-viewer page, three scenes, and a side-by-side with Blender Cycles. The side-by-side has a procedure and a number. Part 6 needs Parts 1 to 5. It needs change 0050 through Part 2.

**The page.** `site/src/pages/viewer/index.astro` and the island `site/src/islands/Viewer.tsx` make the page `/viewer/`. The page holds one canvas, a drop zone and a panel.

- **The drop.** A visitor drops a `.glb`, a `.gltf` with its files, or a folder. A file input does the same for a browser that cannot drop. `GLTFLoader` gains the option `resolve(uri)`, which gives the bytes of a file that the visitor dropped. Without it, the loader fetches `path + uri`, as it does today.
- **The light.** The page loads one HDRI, a `.hdr` file, as the environment and as the background. The visitor may drop another `.hdr`.
- **The controls.** The panel has the exposure in stops, and the f-number and the focus distance of a `PhysicalCamera`. It has the choice of AOV to look at: beauty, albedo, normal, depth or id. It has a button `Save EXR`. The existing `OrbitControls` turns the camera.
- **The readout.** The toolbar shows the sample count and the status `Preview` while the camera moves, as the examples do.
- **The side-by-side.** For each demo scene, the page can show the Cycles still in a split view with a divider. Another panel shows the numbers of the comparison. The build reads them from `docs/cycles-comparison.md`. `src/lib/facts.ts` reads the other numbers of the site in the same way.

**The scenes.** Each scene has a camera, a lighting setup and an asset. Facts, read on 2026-10-06 from the repository `KhronosGroup/glTF-Sample-Assets` (its `main`, whose commit this record does not know, because the GitHub API refused the read):

| Scene  | Asset                  | Triangles   | Textures                | Extension in use                           | Licence of the model files              |
| ------ | ---------------------- | ----------- | ----------------------- | ------------------------------------------ | --------------------------------------- |
| helmet | DamagedHelmet          | 15,452      | 5 of 2048 by 2048, JPEG | none                                       | CC-BY-4.0 and CC-BY-NC-4.0, both listed |
| flight | FlightHelmet           | 94,722      | 15 of 2048 by 2048, PNG | `KHR_materials_transmission` on its lenses | CC0-1.0                                 |
| glass  | a goblet built in code | about 5,000 | none                    | none (the engine's own `PhysicalMaterial`) | the repository's licence                |

DragonAttenuation (134,995 triangles, `KHR_materials_transmission` and `KHR_materials_volume`) is the Khronos asset for glass. Its `LICENSE.md` lists the Stanford Graphics Library licence for the model files and CC0 for the rest. That licence allows free use with credit, and it forbids a commercial use and a place in a product for sale. The site is free, and the engine is Apache-2.0. Whether a demo of an Apache-2.0 library meets the terms is a question for the owner (decision 31). Until the owner decides, the glass scene is a goblet that the addons build in code. It needs `LatheGeometry`, which follows three.js's constructor `LatheGeometry(points, segments)`.

**The assets stay out of the repository.** `scripts/fetch-demo-assets.mjs` downloads each file from a URL that names a commit. It checks the SHA-256 of each file against `site/demo-assets.json`. That file also holds each asset's licence and credit. The deploy workflow runs the script before the site build. `site/public/demo/` is in `.gitignore`. The HDRI is a CC0 file from Poly Haven, chosen at step 6.1. Its licence is read and recorded there.

**The Cycles procedure.** `scripts/cycles/` holds `README.md` (the procedure), `scene.py` (a Blender Python script) and `compare.mjs`. The procedure is a numbered list in the README, one action in each step. It sets these values.

| Setting           | Value                                                                                                    |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| Blender           | 4.5 LTS. Step 6.4 records the exact version that `blender --version` prints                              |
| Device, seed      | CPU, seed 0. A second render uses seed 1 for the noise floor                                             |
| Samples           | 1,024, adaptive sampling off, denoising off                                                              |
| Pixel filter      | `BOX`, width 1.0, which is the engine's one-pixel jitter. Record 0009 may change the engine's filter     |
| Bounces           | total 8, diffuse 8, glossy 8, transmission 8, volume 0                                                   |
| Clamps, caustics  | direct and indirect clamp 0, reflective and refractive caustics on, glossy blur 0                        |
| Colour management | view transform `Standard`, look `None`, exposure 0, gamma 1                                              |
| Output            | 512 by 512, an EXR of full floats in the scene-linear working space, and a PNG of the `Standard` view    |
| World             | an Environment Texture node with the same `.hdr`, strength 1, linear interpolation, a rotation about Z   |
| Camera            | perspective, sensor fit vertical, the engine camera's field of view and position, in Blender's Z-up axes |
| Materials         | the glTF importer's Principled BSDF, and the goblet's Principled BSDF with the engine's parameters       |

Step 6.4 checks each setting name against the Python API of the pinned Blender. The rotation of the world about Z has no value yet. Step 6.4 renders a mirror sphere in both renderers and measures the angle that aligns them. The glTF importer turns the Y-up axes of the file into Z-up axes. The script applies the same turn to the camera.

**The differences that remain.** These differences are known before any number is measured. Each one adds to the distance between the two images, and the procedure lists them beside the numbers.

- Cycles' Principled BSDF layers its lobes in its own way, which differs from glTF's layering.
- Cycles' metal uses a Fresnel term with a tint at 82 degrees. The engine's metal uses Schlick's term.
- Cycles' multiple scattering follows its own model. The engine's is Turquin's approximation. Step 6.4 reads which model the pinned Blender version uses.
- Cycles reads an image at its first level, with no mip chain (from memory, and step 6.4 checks it). The engine reads a mip level from the footprint.
- The importer's treatment of a thin transmission (the lenses of FlightHelmet) may differ from the engine's thin-walled surface.

**How close is close.** Two numbers measure the distance. Both read the 512 by 512 renders, after the exposure of the scene is the same.

- **RMSE.** The root mean square of the difference of the two `Standard` PNGs, in 8-bit units, over the colour channels.
- **FLIP.** The mean of the LDR-FLIP error map (Andersson et al. 2020), computed by NVIDIA's `flip` tool at its default pixels per degree. The share of pixels above 0.2 is recorded too.
- **The noise floor.** The same two numbers for Cycles at seed 0 against Cycles at seed 1. A number of the engine means something only beside this floor.
- **The bound.** Step 6.5 records the first measured values. The bound of `gate:cycles` is 1.5 times the engine's measured value, rounded up. Record 0002's rule is ten times for a mean, and that rule is too loose for a number that has a noise floor.

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

### Part 4: The physical camera

- **The acceptance names a physical camera.** Plan section 4 lists exposure and bokeh for M3. A product shot uses a shallow depth of field.
- **Why the exposure is on the host.** The tone map already takes `exposure` in stops. A sum of stops on the host changes no kernel, no golden and no determinism row.
- **Why a relative mode.** Every scene so far is in relative units, where a light has a radiance of 17 and no unit. In the absolute mode, a default camera would scale such a scene by about 2e-4 and show black. The relative mode keeps the default at 0 stops and keeps the stop arithmetic of a real camera.
- **Why `turn` and `sqrt`.** The polar map of a disc needs an angle and a radius. `turn` and `sqrt` are the operations that record 0005 admits. A concentric map (Shirley and Chiu 1997) keeps the neighbours of the Sobol pair closer together. Step 4.2 may measure it, and the polar map is the first choice because it is the simpler one.
- **Why the geometry AOVs ignore the lens.** A denoiser wants a first hit that has no noise. A blurred depth or normal carries a blur that the beauty pass already shows.

Alternatives considered:

- **A lens model with several elements.** It gives cat-eye bokeh and vignetting. It needs a lens prescription and a ray trace through it. It is out of M3.
- **Autofocus by a ray cast.** Record 0008's `Raycaster` could set `focusDistance` from a click. The viewer of Part 6 may do it when that record has merged. The camera itself needs no ray cast.

### Part 5: AOVs, EXR output and the ACES transform

- **The acceptance names them.** Plan section 4 lists AOVs (albedo, normal, depth, cryptomatte, light groups), EXR output and an ACES output transform. The EXR must open in a compositor.
- **Why a second entry for the geometry AOVs.** The albedo, normal, depth and id of the first hit need one ray, not a path. A separate entry costs one traversal a sample, and a renderer with no AOV pays nothing. The buffer for them stays out of the `trace` pipeline, so that pipeline keeps its seven storage buffers.
- **Why the light groups ride in `accum`.** A group needs the paths that the beauty traces. Its sum is a part of the beauty. A second render for each group would multiply the time by the number of groups.
- **Why the index and not the hash in the kernel.** The runtime writes an `f32` lane through a `DataView`. A NaN pattern does not survive it (record 0004, "The integer words"). A hash has an exponent of 255 for 1 id in 256. An index below 2^24 is exact.
- **Why a writer in the package.** The boundary allows no library. A scanline EXR with two compressions is about 300 lines.
- **Why float by default.** The geometry AOVs carry data. A half float rounds a depth of 1,000 to 0.5. The beauty may use half, and the option says so.
- **Why the beauty has no exposure and no transform.** A compositor applies its own. An EXR that carried the screen's exposure would not be scene-referred.
- **Why Hill's fit.** It keeps the ACES look, the hue shifts included. It is products and divisions, so it adds no row to the determinism lint. Narkowicz's fit works per channel and has no matrices.

Alternatives considered:

- **All AOVs in `trace`.** It needs more storage slots than the `trace` pipeline has, or a larger `accum` for every render.
- **A multi-part EXR.** It is cleaner for layers. Blender reads both. A single-part file is simpler to write and to read.
- **PIZ compression.** It compresses image data better than ZIP. It needs a wavelet and a Huffman coder, which is far more code.
- **OCIO and a full ACES view.** It needs a library and a config. The fit is enough for the screen, and the EXR carries the scene-linear data.

### Part 6: The demo

- **The plan decides it.** Section 4 of `docs/plan.md` makes a glTF product viewer the first public demo. M3 is done when the same scene renders beside Cycles and the EXR opens in a compositor. Decision 3 of section 12 makes Cycles the reference for the image.
- **Why these assets.** DamagedHelmet has five textures and no extension. FlightHelmet has fifteen textures and a transmissive lens. Together they test the textures, the normal map, the metallic-roughness map and a thin transmission. The goblet tests glass, absorption and the environment's reflection.
- **Why the assets stay out of the repository.** One of the 15 PNG files of FlightHelmet has 3,594,300 bytes. The set may reach 54 MB, and no run measured the sum. A repository that holds them is slow to clone. A script with a hash gives the same bytes at every build.
- **Why a goblet in code.** The one Khronos asset for glass with absorption is DragonAttenuation. Its model files carry the Stanford licence, which forbids a commercial use. The goblet has no such term. The owner may still choose the dragon (decision 31).
- **Why 512 by 512 for the numbers.** A render at 1,024 by 1,024 has 4 times the pixels of one at 512 by 512. It takes about 4 times as long. The two numbers need no more detail than 512 by 512 gives.
- **Why two renders of Cycles.** Cycles is noisy at 1,024 samples too. The distance between two Cycles seeds is the least distance that any renderer can reach. A number without this floor does not say how close the images are.
- **Why 1.5 times for the bound.** The rule of record 0002 sets a mean at ten times its measured value. That rule suits a number that has no floor and no noise. A comparison with another renderer has both. A bound of 1.5 times catches a regression that is larger than the noise of the comparison itself.

Alternatives considered:

- **Mitsuba 3 as the image reference.** Plan decision 3 keeps Mitsuba for the derivatives of M5.
- **A browser-only comparison with a stored PNG.** It tests the page and not the numbers. The EXR comparison needs the float data.
- **Running Blender in CI.** It needs Blender and a long CPU render on each pull request. The self-hosted GPU runner of `capture-stills.yml` runs the check on request instead.

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

### Part 4: The physical camera

- **Engine host.** `cameras/PerspectiveCamera.ts` gains the film members. `cameras/PhysicalCamera.ts` is new. `renderers/scene-pack.ts` changes `cameraFrame`. `renderers/PathTracer.ts` adds the camera's exposure in `#present`. `index.ts` and `__api__/surface.md` change.
- **Engine kernels.** `trace.shade.ts` changes the `trace` entry: the lens sample before `radiance`. `materials.shade.ts` holds `turn`, which the lens uses. `sampler.shade.ts` is unchanged.
- **Scripts.** `scripts/scenes.ts` lists the scene `lens`. `scripts/gates.mjs` gains its bound.
- **Tests owed.** `PhysicalCamera.test.ts`, `aperture.test.ts` (new, on the oracle) and `lens.test.ts` (new, on the oracle, for the blur radius).
- **Gates.** `gate:differential` runs `lens`. `gate:determinism` runs it too. `gate:render` changes no golden, because no example uses a `PhysicalCamera`.
- **Site.** The guide gains a page on the camera.

### Part 5: AOVs, EXR output and the ACES transform

- **Engine host.** `renderers/PathTracer.ts` gains `aovs`, `lightGroups`, `readAov`, `readLightGroup` and `readCryptomatte`. `renderers/scene-pack.ts` writes `[7].z` of an instance and the group words. `lights/` and `materials/` gain `group` and `lightGroup`. `renderers/limits.ts` checks the stride.
- **Engine kernels.** `trace.shade.ts` changes `radiance` (group sums), `trace` (the stride) and `tonemap` (the transform), and gains the entry `aov`. `layout.shade.ts` makes `ACCUM_STRIDE` a parameter and declares `aovAccum`.
- **Addons.** `exporters/EXRExporter.ts`, `exporters/half.ts` and `loaders/EXRLoader.ts` are new. `exporters/cryptomatte.ts` holds the hash. `scenes/` gains `AovScene`.
- **Scripts.** `scripts/gates/aov.mjs` is new. `scripts/gates.mjs` gains the `AOV` tolerances. `scripts/__goldens__/aov/` holds the goldens. `scripts/oracle.ts` binds `aovAccum`.
- **Tests owed.** `exr.test.ts`, `half.test.ts`, `cryptomatte.test.ts`, `aov.test.ts` (new, on the oracle) and `tonemap` tests in `kernels.test.ts`.
- **Gates.** `gate:aov` is new. `gate:render` changes every golden at step 5.5. `gate:determinism` runs the `aov` scene.
- **Site.** The guide gains a page on outputs. The site's stills are captured again after step 5.5.

### Part 6: The demo

- **Site.** `site/src/pages/viewer/index.astro`, `site/src/islands/Viewer.tsx`, `site/demo-assets.json`, the split-view component and the guide page of the procedure are new. `site/src/lib/facts.ts` reads `docs/cycles-comparison.md`. `site/src/i18n/en.ts` gains the labels.
- **Addons.** `loaders/GLTFLoader.ts` gains the option `resolve`. `scenes/GobletScene.ts` and `geometries/LatheGeometry.ts` are new. `LatheGeometry` is also an engine export, in `packages/radiance/src/geometries/`.
- **Scripts.** `scripts/fetch-demo-assets.mjs`, `scripts/cycles/README.md`, `scripts/cycles/scene.py`, `scripts/cycles/compare.mjs` and `scripts/gates/cycles.mjs` are new. `scripts/cycles/reference/` holds the reference EXR and PNG of each scene.
- **Workflow.** `.github/workflows/cycles.yml` runs `gate:cycles` on request on the self-hosted GPU runner. It is not a required check.
- **Documents.** `docs/cycles-comparison.md` is new and holds the first measured values. `docs/plan.md` changes (Amendments owed). `README.md` names the page.
- **Tests owed.** `fetch-demo-assets.test.ts`, `Viewer` checks in `scripts/harness.mjs`, `LatheGeometry.test.ts`, `compare.test.ts` and `GLTFLoader.test.ts` for `resolve`.
- **Gates.** `gate:site` builds the page. `gate:api` re-bakes. `gate:cycles` is new and runs by hand.

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

> `VALUE_ONLY` gains `sheenD: ['pow']`. `ALLOWED` admits `pow` today, so the entry matters when the compiler reports an `absolute` row.

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

### Part 4: The physical camera

**Record 0001.** Two places change.

> The sentence "The uniform block reserves two words for M3's thin lens (aperture, focus distance)" reads as follows. "`lens.z` is the aperture radius in scene units. `lens.w` is the focus distance. `lens.z` is 0 for a pinhole. The thin lens takes its two numbers from the sampler pair `PAIR_LENS`, 65,536."

> "Camera" gains: "`PhysicalCamera` extends `PerspectiveCamera` with an f-number, a focus distance, an ISO speed and a shutter time (record 0010, Part 4)."

**Record 0002.** Two places change.

> The table of differential scenes gains `lens`: "Three small emissive spheres at 0.5, 1 and 2 times the focus distance, under a thin lens".

> The probe list gains: "`lens`: an aperture radius of twice the right one fails the blur radius test."

**Record 0003.** One place changes.

> "The public surface at 0.1.0" gains `PhysicalCamera` and the members `filmGauge`, `getFilmHeight`, `getFocalLength` and `setFocalLength` of `PerspectiveCamera`.

**Record 0005.** One place changes.

> Rule 2 gains: "The aperture point of a thin lens is made from `sqrt` and `turn`."

### Part 5: AOVs, EXR output and the ACES transform

**Record 0001.** Four places change.

> The table of buffers gains: "The `aov` entry binds `nodes`, `triangles`, `vertices`, `instances`, `materials` and `aovAccum`, a `storage<array<vec4>, "read_write">` of four `vec4` for each pixel (record 0010, Part 5). The `trace` pipeline keeps seven."

> The `accum` row reads: "A pixel's samples added up: rgb, and how many in w. With `G` light groups above 1, a pixel has `1 + G` consecutive elements. `ACCUM_STRIDE` is `params.path.w`."

> The `instances` row reads: "`[7] = (bits(flags), bits(geometryId), objectId, 0)`. `objectId` is the value of an `f32`."

> "Limits" gains: "The pack checks `pixels * stride * 16` bytes of `accum`, and the bytes of `aovAccum`, against the binding limit."

**Record 0002.** Three places change.

> The gate table gains a row for `aov`. What it proves: each AOV of a render equals its golden within its tolerance, and the EXR round trip loses nothing. Scene: `aov`, 96 x 64, 64 spp. Number: per AOV, as record 0010 step 5.6 derives. It runs in the `harness` job.

> The probe list gains: "`aov`: a golden with one channel moved by twice its tolerance fails. A file with a wrong magic fails to load."

> "The render gate's goldens" gains this sentence. "Step 5.5 of record 0010 changes the tone map. Every golden and every still changes in that pull request."

**Record 0003.** One place changes.

> "The public surface at 0.1.0" gains `EXRExporter`, `EXRLoader` and `ExrImage`. It gains the renderer parameters `aovs` and `lightGroups`, and the methods `readAov`, `readLightGroup` and `readCryptomatte`. It gains the parameter `group` of the lights and the parameter `lightGroup` of the materials.

**Record 0005.** Two places change.

> `VALUE_ONLY` keeps `tonemap: ['exp2', 'pow']`. The output transform adds only products and divisions.

> The rules gain: "The EXR hash and the half-float conversion run on the host. No kernel reads either."

**Record 0006.** One place changes.

> Item 8, "Reading a texture array's layer", reads: "Needed by: not M3. Record 0010, Part 5 reads each AOV from a storage buffer."

**Record 0007.** One place changes.

> "Limits" gains: "A frame with AOVs or light groups needs `pixels * stride * 16` bytes in one binding. At 16 MiB, a WebGL2 binding holds 1,048,576 pixels at a stride of 1. AOVs and light groups wait for a larger limit (record 0010, Part 5)."

### Part 6: The demo

**Record 0002.** Two places change.

> The gate table gains a row for `cycles`. What it proves: the engine's render of each demo scene stays within the bounds of its first measured distance to a Cycles render. Scene: `helmet`, `flight` and `goblet`, 512 x 512, 1,024 spp. Number: 1.5 times the first measured RMSE and FLIP, from `docs/cycles-comparison.md`. It runs on request on the self-hosted runner.

> The probe list gains: "`cycles`: the engine's image shifted by 2 pixels must fail both bounds."

**Record 0003.** One place changes.

> "The public surface at 0.1.0" gains `LatheGeometry` and the loader option `resolve`.

**Plan (`docs/plan.md`).** Three places change. A change to the plan waits for the owner's "merge".

> Section 7, the row "Compressed textures, UDIM, HDR and EXR decoding in the browser, a texture memory budget" splits. The row "HDR and EXR decoding in the browser, a texture memory budget" keeps M3. The row "Compressed textures, UDIM" reads "after M3".

> Section 9, the last bullet, "A convention for a shader package exporting texture-array bindings as a struct", reads: "Not needed by M3. Record 0010 binds four arrays by name."

> Section 4, "The first public demo", gains: "The demo scenes are DamagedHelmet, FlightHelmet and a goblet that the addons build. Record 0010, Part 6 gives the Cycles procedure and the numbers."

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
- Number: `sheenD` adds a `pow` row, which `ALLOWED` admits. The lint reports no other new row.
- Probe: the lint runs once on a copy of `materials.shade.ts` with one `sin` call added. It must report the row.

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

### Part 4: The physical camera

Part 4 has no dependency. Each step is one pull request.

**4.1 The film and the exposure.**

- Delivers: the film members of `PerspectiveCamera`, `PhysicalCamera` with its exposure, and the sum of stops in `PathTracer`. The kernel does not change.
- Test: `setFocalLength(50)` at an aspect of 1 gives a `fov` of 38.5808 degrees within 1e-3, and `getFocalLength()` returns 50 within 1e-9. `ev100` is 14.644 within 1e-3 for f/16, 1/100 s and ISO 100. A doubled ISO adds one stop exactly. The `relative` mode adds 0 stops at the defaults.
- Number: `gate:determinism` reports 0 of 1,024 floats that differ. No golden changes.
- Probe: the stop test runs once with `fStop^2` replaced by `fStop`. It must fail.

**4.2 The thin lens.**

- Delivers: `PAIR_LENS`, the lens sample in `trace`, the polar map of the disc, the lens fields of `cameraFrame`, and the `lens` scene.
- Test: take an emissive sphere of radius 1e-3 at twice the focus distance, with a focal length of 50 mm and f/2. Its blur radius, projected onto the focal plane, matches `R * abs(s - d) / d` within 5 %. Here `R` is the aperture radius, `s` the focus distance and `d` the distance of the sphere. The radius comes from the second moment of the image, `sqrt(2 * m2)`. At the focus distance the radius equals the pinhole's within 5 %. With `lens.z` equal to 0 the image equals the pinhole render bit for bit.
- Number: `gate:differential` holds `lens` within a bound that the step derives by the rule of record 0002.
- Probe: the blur test runs once with an aperture radius of twice the right one. It must fail. It runs once with an f-number of 4, which must halve the radius.

**4.3 The aperture blades.**

- Delivers: the polygon map and `apertureBlades` and `apertureRotation` in `cameraFrame`.
- Test: 10^6 points of a hexagon lie inside it. Each of the six sectors holds one sixth of them within 5 standard deviations. The second moment agrees with a host quadrature within 1 %.
- Number: the step records the area of the hexagon against the circle of the same circumradius, which is 0.827.
- Probe: the sector test runs once with the sector chosen by `floor(l.y * n)` where `l.y` is also the angle. It must fail the uniformity bound.

Part 4 is done when step 4.3 has merged.

### Part 5: AOVs, EXR output and the ACES transform

Steps 5.2 to 5.6 do not need a compiler change. Step 5.1 needs steps 1.1 and 3.1. Each step is one pull request.

**5.1 The accumulator stride and the light groups.**

- Delivers: `params.path.w` as the stride, `group` on the lights and `lightGroup` on the materials, the group sums in `radiance`, `lightGroups` and `readLightGroup`. The step checks the form of `radiance` for registers.
- Test: the group images add up to the beauty within 1e-5 of each float. A scene has two lamps in two groups. The image of the first group has the same mean as a render with that lamp alone, within 3 standard errors. A stride that passes the binding limit throws a `RangeError` that names `accum`.
- Number: a render with one group costs at most 5 % more frame time than the baseline on `physical`, labelled SwiftShader. If it costs more, the entry splits and the step says so.
- Probe: the per-group test runs once with a lamp in the wrong group. It must fail.

**5.2 The geometry AOVs.**

- Delivers: the entry `aov`, `aovAccum`, `aovs`, `readAov` and the `aov` scene of a sphere, a plane and a glass sphere.
- Test: at the centre of a sphere the normal is `(0, 0, 1)` and the depth is the distance to its surface, within 1e-4. The albedo equals its colour. A pixel on the glass shows the albedo of the surface behind it, times the delta weight. A miss reads depth 1e10, normal 0 and the background colour. An edge pixel has a coverage that equals its geometric share within 0.02 at 256 samples.
- Number: the step records the frame time of `aov` against `trace` on `cornell`.
- Probe: the normal test runs once with the normal negated. It must fail.

**5.3 The EXR writer and reader.**

- Delivers: `EXRExporter`, `EXRLoader` and `half.ts`, with the `none` and `zip` compressions and the half and float types.
- Test: every half code, read as a float and written back, returns itself. 10^6 random floats convert to the half that a reference rounding gives. A float image of 10^6 values returns bit for bit. The magic, the channel order, the offset table and the file size agree with the layout above. When `exrheader` is on the PATH the test runs it and compares the channel list. If it is not, the test reports not run.
- Number: the step records the size of a 1,024 by 1,024 file of four float channels, for `none` and `zip`.
- Probe: a file with one byte of the magic changed must be refused. A truncated file must be refused with the length named.

**5.4 Object ids and Cryptomatte.**

- Delivers: `[7].z` of the instances, the pairs in `aovAccum`, `readCryptomatte`, `cryptomatte.ts` and the layers with their metadata in the exporter.
- Test: the 32-bit MurmurHash3 of the empty name is 0. Two test vectors come from memory: `hello` gives 0x248bfa47 and `The quick brown fox jumps over the lazy dog` gives 0x2e4ff723. The step checks both against an independent implementation. The float rule flips bit 23 for a hash with exponent 0 or 255. Three named meshes have coverage within 0.02 of their geometric shares. Two instances of one name share an id. A pixel with five ids keeps the four of the highest coverage.
- Number: the step records the manifest of the `aov` scene.
- Probe: the coverage test runs once with two meshes' ids swapped. It must fail.

**5.5 The ACES output transform.**

- Delivers: the transform in `tonemap`. The step reads `tonemap` first. If it is a per-channel fit, the step replaces it. If an earlier change delivered another ACES form, the step keeps that form, lists its matrices and adds the tests only.
- Test: the kernel equals a host reference of the same published numbers, in f64, within 1e-5 for 1,000 random inputs. The output lies in 0 to 1, rises with each channel of a grey ramp from 0 to 1,000, and is 0 for input 0. The step records the output for a grey of 0.18 and of 1.
- Number: the pull request lists every golden and every still that changes. It shows the old and the new picture and the mean change of each.
- Probe: the reference test runs once with `M_in` transposed. It must fail.

**5.6 The AOV gate and the compositor.**

- Delivers: `gate:aov`, the `aov` goldens, and a page `docs/aov-compositor.md` with the procedure to open the EXR in Blender.
- Test: each AOV of the `aov` scene equals its golden. The albedo is within 2/255 of each channel. The normal is within 0.02 of each component. The depth is within 1e-3 relative on the hit pixels. The id is equal where the coverage passes 0.999. A light group is within the rule of the render gate. The step derives each tolerance by the rule of record 0002 and records it.
- Number: the compositor check opens the EXR in Blender 4.5 LTS and records the channel names that the Image node lists. If a name differs from the table of Part 5, an amendment fixes the table.
- Probe: each AOV runs once with a channel moved by twice its tolerance. The gate must fail each one.

Part 5 is done when step 5.6 has merged.

### Part 6: The demo

Part 6 starts when Parts 1 to 5 are merged, except step 6.1, which has no dependency. Each step is one pull request.

**6.1 The assets and their licences.**

- Delivers: `scripts/fetch-demo-assets.mjs`, `site/demo-assets.json`, the credits, and the choice of the HDRI. The step records the commit of `KhronosGroup/glTF-Sample-Assets` that it pins, and reads each `LICENSE.md` again.
- Test: the script checks the SHA-256 of every file. A file with one byte changed is refused, with the file named.
- Number: the step records the sizes of the three scenes' files, and the licence of the HDRI.
- Probe: the check runs once on a file with one byte changed. It must fail.

**6.2 The goblet.**

- Delivers: `LatheGeometry`, `GobletScene` and the engine export. The scene has a goblet of glass, a plane and a metal ball.
- Test: `LatheGeometry` follows three.js's vertex order for a profile of three points and 4 segments. Its normals point outward, and the volume that it closes is positive.
- Number: the goblet has a closed mesh of about 5,000 triangles. The step records the exact count.
- Probe: the closed-mesh test runs once on a profile that is not closed. It must fail.

**6.3 The page.**

- Delivers: the page `/viewer/`, `Viewer.tsx`, the drop zone, the loader option `resolve`, the panel and `Save EXR`.
- Test: the harness site step loads a glb that it builds by hand, through the file input. It reads the sample count, sets the f-number, saves the EXR and reads it back with `EXRLoader`. The channel `R` equals `readRadiance` within 1e-6.
- Number: the step records the load time of each scene on SwiftShader, labelled as such. No hardware device ran.
- Probe: the harness check runs once with a glb that has no mesh. The page must show an error and not a blank canvas.

**6.4 The Cycles procedure.**

- Delivers: `scripts/cycles/README.md`, `scene.py`, `compare.mjs` and the three reference renders of Cycles (EXR and PNG). The step records the exact Blender version, and the angle of the world's rotation that aligns the two renderers.
- Test: the step renders a mirror sphere in both renderers and finds the angle at which the two images of the environment agree most. It renders each scene at seed 0 and seed 1. `compare.mjs` reads two EXR files and gives the RMSE.
- Number: the step records the angle, the version and the render time of Cycles for each scene.
- Probe: `compare.mjs` runs once on an image and the same image shifted by 2 pixels. Its RMSE must be above 0.

**6.5 The first measured values.**

- Delivers: `docs/cycles-comparison.md` with a table for each scene: RMSE, FLIP mean and the share of FLIP above 0.2. One row is the engine against Cycles. One row is Cycles at seed 0 against seed 1.
- Test: the engine renders each scene at 512 by 512 and 1,024 samples a pixel on the owner's GPU or the self-hosted runner. `compare.mjs` and the `flip` tool read the results. The step lists each known difference of "The differences that remain" that the images show.
- Number: the step records every value of the table. A value that SwiftShader gave is labelled so.
- Probe: the table has a row of the engine against itself at seeds 0 and 1. It gives the engine's own noise floor and must lie under the engine-against-Cycles row.

**6.6 The side-by-side on the page.**

- Delivers: the split view, the panel of numbers, `facts.ts` reading `docs/cycles-comparison.md`, and the stills. `bun run capture:stills` captures them again.
- Test: `gate:site` builds the page, and the stills match their hashes. A number on the page equals the number in the table of step 6.5.
- Number: the page's weight at 1440 and 390 CSS pixels. The step records both.
- Probe: a still with a wrong hash fails the build. This probe exists already.

**6.7 `gate:cycles`.**

- Delivers: `scripts/gates/cycles.mjs`, `.github/workflows/cycles.yml` and the bounds of 1.5 times the values of step 6.5.
- Test: the gate renders each scene and compares it with its reference. The run is by hand or on request.
- Number: the gate reports each distance and its bound.
- Probe: the gate runs once on the engine's image shifted by 2 pixels. It must fail both bounds.

Part 6 is done when step 6.7 has merged and the owner has seen the page. M3's acceptance needs both.

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
21. Default. `PhysicalCamera` extends `PerspectiveCamera`. The exposure is a number of stops, added on the host. Its default `relative` mode adds 0 stops at the defaults, and the `absolute` mode follows Lagarde and de Rousiers. Proposed: yes.
22. Default. The aperture is a disc, or a polygon of 3 or more blades. The thin lens takes its numbers from the sampler pair 65,536. The geometry AOVs use the pinhole ray. Proposed: yes.
23. Default. The AOVs are albedo, normal, depth, the object id and the light groups. They take the pinhole ray and the first hit that has a lobe that is not delta. Proposed: yes.
24. For the owner. The geometry AOVs have an entry, `aov`, and a buffer, `aovAccum`, with six storage bindings. The light groups use a larger `accum` stride. The `trace` pipeline keeps seven. At 1920 by 1080 the stride is at most 4. Proposed: yes.
25. Default. The package has an EXR writer and a reader of its own. The compressions are `none` and `zip`, and the default type is `float`. The beauty is scene-linear in Rec. 709 primaries with no exposure. Proposed: yes.
26. Default. Cryptomatte is object-level, with two layers of two pairs. The kernel keeps an object index in `[7].z` of an instance, and the host makes the hash. Proposed: yes.
27. For the owner. The screen's output transform is Hill's fit of the ACES RRT and ODT. It changes every golden and every still. The owner approved an output-transform change on 2026-10-06, and step 5.5 reads what that change delivered. Proposed: yes.
28. Default. The `aov` gate holds each AOV to a golden in an uncompressed EXR. Its tolerances are derived by the rule of record 0002. Proposed: yes.
29. Default. The demo is a page, `/viewer/`, with a drop zone, one HDRI, a `PhysicalCamera` panel, an AOV selector and `Save EXR`. Proposed: yes.
30. Default. The assets are fetched at build from pinned URLs and checked by SHA-256, and no asset is committed. The HDRI is a CC0 file from Poly Haven. Proposed: yes.
31. For the owner. The glass scene is a goblet that the addons build, until the owner decides whether the demo may use DragonAttenuation. Its dragon carries the Stanford Graphics Library licence, which forbids a commercial use. DamagedHelmet lists CC-BY-4.0 and CC-BY-NC-4.0 for its files. Proposed: the goblet.
32. Default. The Cycles procedure is Blender 4.5 LTS on the CPU, at 512 by 512 and 1,024 samples, with a box filter of width 1. The distance is the RMSE and the LDR-FLIP of the `Standard` view, beside the Cycles noise floor. Proposed: yes.
33. Default. The bound of `gate:cycles` is 1.5 times the first measured value. The gate runs on request on the self-hosted runner and is not a required check. Proposed: yes.

## Record

**Approval and plan record.** Accepted on 2026-10-09. typeshade/radiance#59 merged this record as `draft` at a0106e0. The owner then approved the record in the conversation and answered the decisions as proposed (2026-10-09), and that answer is the acceptance. Every entry of "Decisions for the owner" stands as proposed. Each part changes a design rule, a public export or a layout.

**Configuration and validation record.** This record does not yet apply. No step is started. The draft has six parts, 35 steps and 33 decisions. It was written on `main` at 55bde46 with the compiler pinned at 596c805. The commits are 9feacc4 (skeleton), 47be68e (Part 1), 1a8e624 (Part 2), b8bcd8a (Part 3), 981db8a (Part 4) and 44e581d (Part 5). The commit that carries Part 6 follows them.

Checks that ran on this draft, on 2026-10-06 (UTC), in the worktree of the branch `wt/M3`:

- `bun run check:ste` (exit 0, no hard violation), `bun run check:prose` (exit 0) and `prettier --check` on `docs/design` (exit 0).
- `bun run reqs:sync`, then `doorstop -e -F` (exit 0) and `bun run reqs:check` (exit 0). Each commit reviewed `REC-0010` and cleared its decisions after reading them.

Checks that did not run: `bun run check` as a whole, `bun run harness`, every gate and every test of a step. This record changes documents only, and no step is implemented.

**What the draft read.** The reading is split into what the worktree holds, what the network gave, and what was measured.

- Read in the worktree: `docs/plan.md` (sections 3.1, 3.2, 4, 7, 9 and 12) and records 0001 to 0008. Also `docs/design/README.md`, the kernels `trace.shade.ts`, `materials.shade.ts`, `sampler.shade.ts`, `layout.shade.ts` and `intersect.shade.ts` (`surfaceAt`), and `scene-pack.ts` (`packMaterial`, `cameraFrame`).
- Read in the worktree, continued: `PathTracer.ts`, `PhysicalMaterial.ts`, the header of `GLTFLoader.ts`, `determinism-lists.ts`, `scripts/gates.mjs`, the header of `scripts/oracle.ts`, and the compiler's `AUTHORING.md`, `docs/use-typeshade-surface.md` and `changes/` folder.
- Read through the network on 2026-10-06: the compiler's changes 0050 and 0053 on its `main`. Also, from the repository `KhronosGroup/glTF-Sample-Assets`, the model index, the glTF files of three models and three `LICENSE.md` files. This record does not know the commit of that repository.
- Measured: the directional albedo of the single-scattering GGX lobe (Part 1), by a host script in f64. Nothing else in this record was measured. Each figure of a step is a proposal.

**What came from memory.** No source was read for these items. Each step that uses one reads the source first.

- The glTF 2.0 Appendix B formulas, Burley's and Lagarde's diffuse terms, Dupuy and Benyoub's sampling, Turquin's factor and the pbrt-v4 scale of a footprint.
- three.js's film members and its equirectangular map. The OpenEXR file layout and attribute names. The Cryptomatte specification. Hill's ACES constants. The two MurmurHash3 test vectors.
- Blender's Python setting names and its multiple-scattering model.

**Open items at authorship.**

- **Compiler change 0050.** It is a draft on the compiler's `main`, and the pin does not carry it. Steps 2.2 to 2.7, step 3.3 and Part 6 wait for it. Next action: the owner schedules the pin move (decision 11).
- **Record 0009 and the analytic sphere record.** Neither is on `main` at 55bde46. Next action: when each merges, compare its text with the table "What this record assumes". A difference is a deviation.
- **Decision 8 of record 0004.** Decision 5 of this record answers it with the second alternative. Next action: the owner approves it.
- **Record 0007.** Its rule 4 would make `materials` and `lights` arrays of `vec4u`. Next action: the amendment text for record 0007 in Parts 1 and 2 applies if that rule merges first.
- **The owner-approved output transform.** No file of the baseline says whether it changed `tonemap`. Next action: step 5.5 reads it.
- **The licence of DragonAttenuation and of DamagedHelmet.** Next action: the owner answers decision 31.
- **No hardware measurement.** Every number that a step records on SwiftShader carries that label. Next action: the owner's GPU or the self-hosted runner runs steps 5.1, 6.3 and 6.5.
- **An issue for the compiler.** It asks for CPU-tier texture reads (Part 2, the amendment of record 0006). Status: not started. Next action: open it when step 2.2 starts.

**Deferred, and not proposed.** None of these is in a step.

- The light tree (Part 3).
- Compressed textures, UDIM and streaming.
- `KHR_texture_transform`, alpha BLEND, the texture maps of the other `KHR_materials` extensions, diffuse transmission, dispersion and iridescence.
- Subsurface scattering (M3s) and a hair BSDF.
- A multi-part EXR, the PIZ and DWA compressions and OCIO.
- WebGL2 support for the AOVs and the light groups (record 0007).

**Deviations.** None. No work has been delivered yet, so this text and the work cannot differ.

**Status of the owner's request of 2026-10-06.** Part 1 is written and not implemented. Part 2 is written and not implemented. Part 3 is written and not implemented. Part 4 is written and not implemented. Part 5 is written and not implemented. Part 6 is written and not implemented. The record is a draft.
