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

## What it touches

### Part 1: The principled BSDF

- **Engine kernels.** `packages/radiance/src/kernels/materials.shade.ts` changes `sampleBsdf` and `evalBsdf`. It gains the helpers `lobeChances`, `ggxD`, `smithG2`, `sampleVndf`, `fresnelDielectric`, `schlick5`, `msFactor`, `expNeg` and `absorb`. `trace.shade.ts` changes `radiance` and `direct`, and gains `lightIndex` and `lightPdf`. `layout.shade.ts` gains `AlbedoTables` and the offsets `MATERIAL_VOLUME` and `MATERIAL_EXTRA`. `kernels/tables.ts` is new and baked. `determinism-lists.ts` gains one row (Amendments owed).
- **Engine host.** `materials/PhysicalMaterial.ts` gains its parameters. `renderers/scene-pack.ts` changes `packMaterial`. `renderers/PathTracer.ts` uploads the tables. `index.ts` and `__api__/surface.md` change with the new parameter types.
- **Addons.** `loaders/GLTFLoader.ts` maps the extensions of the table above. `scenes/` gains `PhysicalScene` (the `physical` scene), `MisScene`, `FurnaceScene` and `GlassScene`.
- **Scripts.** `scripts/bake-tables.ts` is new. `scripts/oracle.ts` binds the new block. `scripts/scenes.ts` lists the scenes. `scripts/gates.mjs` gains the `ORACLE` bounds of each scene. `scripts/gates/furnace.mjs` is the new gate.
- **Tests owed.** `materials.test.ts` grows by one group for each lobe. The density integrates to 1. The sample weight equals the quadrature of `f * cos`. The lobe is reciprocal. `scene-pack.test.ts` holds the record's words. `tables.test.ts` holds the baked file against a fresh bake. `trace.test.ts` (new) holds the three estimators of `mis` against each other. `GLTFLoader.test.ts` holds each extension.
- **Gates.** `gate:differential` runs `physical`, `mis` and `glass`. `gate:determinism` runs the same scenes. `gate:furnace` is new. `gate:render` changes the goldens of any example that uses `PhysicalMaterial`. `gate:api` re-bakes.
- **Site.** The guide's page on materials describes the lobes and the parameters. The API reference follows the JSDoc.

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
- Number: the mean over the pixels of the sphere lies within 0.03 of 1 for the metal rows. The dielectric rows get the bound that the step measures, because Burley's diffuse does not conserve energy exactly.
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

## Record

**Approval and plan record.** This record is a draft. No approval applies yet.

**Configuration and validation record.** This record does not yet apply. No step is started. This draft has Part 1 written. Parts 2 to 6 are not written yet.
