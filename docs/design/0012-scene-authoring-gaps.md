---
id: '0012'
title: After M3, the engine gains the scene-authoring features it lacks, in five parts that merge alone: materials, lights, cameras, output and visibility
status: draft
milestones: []
touches:
  - packages/radiance/src/materials
  - packages/radiance/src/kernels
  - packages/radiance/src/renderers
  - packages/radiance/src/cameras
  - packages/radiance/src/textures
  - packages/radiance/src/lights
  - packages/radiance/src/index.ts
  - packages/radiance/__api__
  - packages/addons/src/loaders
  - packages/addons/src/scenes
  - packages/addons/__api__
  - scripts/gates.mjs
  - scripts/gates
  - scripts/oracle.ts
  - scripts/scenes.ts
  - site/src
  - site/examples
  - docs/design/0001-scene-data-model.md
  - docs/design/0002-verification.md
  - docs/design/0003-public-api.md
  - docs/design/0004-materials-and-shading.md
  - docs/design/0005-determinism.md
  - docs/design/0006-compiler-boundary.md
  - docs/design/0007-webgl2-tier.md
  - docs/design/0010-materials-lights-and-outputs.md
  - docs/plan.md
  - docs/benchmarks.md
compiler: ['0006-4', '0006-1']
---

**Document control**

| Field         | Value                                                                                                                                                                                                             |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity      | Design record 0012, status `draft`                                                                                                                                                                                |
| Date          | 2026-10-09 (UTC), the date of authorship                                                                                                                                                                          |
| Author        | Written in an agent session for the owner. The owner's review is the approval                                                                                                                                     |
| Applicability | `packages/radiance/src` (materials, kernels, cameras, renderers, textures, lights), `packages/addons/src` (loaders), `scripts/gates`, `site/`. It changes no code                                                 |
| Baseline      | `main` at 30daafa. The compiler pinned at 596c805. Every fact below was read on that baseline or in the sources named in `.claude/research/survey-scene-authoring-gaps.md`. No number in this record was measured |
| Survey        | `.claude/research/survey-scene-authoring-gaps.md` holds the full inventory, its sources and its labels. This record states the decisions. The survey states the facts                                             |
| Pull request  | The pull request that carries this record is its review. The record is a draft, so no part of it may be implemented before the owner accepts it                                                                   |

## What changes

Record 0010 makes the engine render a glTF product. It adds a principled BSDF, textures, lights, a physical camera, AOVs, EXR output and an ACES output transform. Record 0010 is accepted. None of its six parts is implemented at 30daafa. The owner states that the engine cannot yet build real scenes. The cause is a set of authoring features that 0010 does not cover. This record states the features that remain missing once 0010 is fully implemented. It states them in five parts. Each part merges alone. Each part names what it waits for.

The inventory has 96 items. The survey lists each one with its source, its label and its part. The five parts of this record own the items that a real scene needs first. Two groups of items are too large for this record. They move to two records that this record proposes (Decision 1). Interaction moves to record 0013, which waits for record 0008. Asset formats move to record 0014, which waits for the compiler's texture write for compressed formats.

### Before

Facts, read at 30daafa and in record 0010:

- The material record holds 8 `vec4`, 128 bytes. Record 0010 Part 1 assigns every word of it. No word is free for a new parameter.
- The path tracer binds 7 storage buffers. Slot 8 is the compiler's console (record 0001 rule 1).
- The light table holds emissive triangles only, with type 0. Record 0010 Part 3 adds types 1 to 4.
- The camera is a pinhole with a field of view. Record 0010 Part 4 adds a thin lens. No orthographic or panoramic camera exists.
- The output transform is Narkowicz's ACES fit (record 0010 Part 5 replaces it with Hill's fit, step 5.5 reads the baseline first).
- An instance holds `[7] = (bits(flags), bits(geometryId), 0, 0)` (record 0001). Record 0010 Part 5 writes the Cryptomatte object index in `[7].z`. Record 0011 writes the splat intensity in `[7].w`. The bits of `flags` above bit 15 are free.
- `GLTFLoader` reads the glTF core material and the emissive strength. It ignores `KHR_texture_transform` with a warning.
- The canvas configuration at the pin 596c805 takes `device`, `format` and `alphaMode` only (fact: `vendor/typeshade/src/core/host-draw.ts`, `GpuCanvasContext.configure`). The runtime cannot set `toneMapping`.

### After

| Part | Delivers                                                                                                                                                                                                              | Needs from the other parts or records                          | Compiler item                                             |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------- |
| 1    | Material extensions: texture transform, specular and clearcoat maps, occlusion, unlit, diffuse roughness, diffuse transmission, iridescence, thickness, alpha BLEND, anisotropic filter. Material record of 16 `vec4` | 0010 Part 1 and Part 2 (steps 2.1 to 2.7)                      | 0006-4                                                    |
| 2    | Area lights (rectangle, disk, ellipse), sun angle, IES profiles, textured emitters, light linking (16 groups), physical sky, loader's punctual and image-based lights                                                 | 0010 Part 3, and Part 1 step 1.3. Part 2 for maps and profiles | 0006-4                                                    |
| 3    | Cameras: orthographic, panoramic (equirectangular, fisheye), lens shift, clip planes, radial lens distortion, shutter for motion blur                                                                                 | 0010 Part 4. M2a for the shutter                               | None                                                      |
| 4    | Output: AgX, Khronos PBR Neutral, white balance, look controls, bloom and glare, and an HDR canvas path with an SDR fallback                                                                                          | 0010 Part 5 step 5.5. Compiler need CN-1 for the HDR canvas    | 0006-1 (device limits) and CN-1 (a new item, Decision 16) |
| 5    | Visibility per ray type, shadow catcher, holdout, and `KHR_materials_variants`                                                                                                                                        | 0010 Part 5 (AOVs). Part 1 for the material words              | None                                                      |

The five parts keep these invariants:

- The path tracer binds 7 storage buffers. No part adds an eighth. Part 1 widens the material record and appends a transform table to the tail of the `materials` buffer. A texture transform uses no slot.
- A scene that uses none of the new features keeps its radiance bit for bit. Each step that moves a picture shows the old and the new picture, and lists each golden and still that changes.
- Every part keeps the six rules of record 0005. A part that needs another operation amends record 0005 first, in its own step.
- The public names follow record 0003, rule 2 for materials and lights, and rule 1 for what three.js names. three.js has no disk light and no panoramic camera. Those names follow Decision 14.

### What this record assumes from the records that land before it

| Source                 | The part this record assumes                                                                                                                   | What this record does if the assumption fails                                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Record 0010, Part 1    | The material record of 8 `vec4` and the principled BSDF's lobes                                                                                | Part 1 of this record amends the record of 0010 step 1.1 before its first step     |
| Record 0010, Part 2    | The texture arrays, the mip chain, the ray cone, and the texture id scheme (`1 + class * 256 + layer`)                                         | Parts 1 and 2 wait for it. Each step names the 0010 step it needs                  |
| Record 0010, Part 3    | The light table with its stride, the four `vec4` block for an analytic light, and the environment with importance sampling                     | Part 2 of this record uses the same stride. A change of stride moves its steps     |
| Record 0010, Part 4    | `PhysicalCamera` extends `PerspectiveCamera`, and the ray form is `forward + right * x + up * y`                                               | Part 3 of this record gives the orthographic and panoramic rays their own form     |
| Record 0010, Part 5    | The screen transform is Hill's fit, and the output is `rgba8unorm` in the default colour space                                                 | Part 4 of this record reads the delivered transform at step 4.1                    |
| Record 0009            | The solid-angle density of an emissive triangle, and the sampler pairs                                                                         | As record 0010 states in its assumption table                                      |
| Analytic sphere record | A sphere gives an exact normal and a `uv`                                                                                                      | As record 0010 states                                                              |
| Record 0011            | `[7].w` is the splat intensity, and the flag bits of `[7].x` below bit 16 are the splat and sphere flags. Part 5 uses bits 16 to 21 of `[7].x` | If 0011 takes a bit at 16 or above, Part 5 moves its bits up to the first free bit |

### The rule for these parts

Each step is one pull request. Each step names its test, its number and its probe. A probe is the \"prove the instrument\" step of record 0002. The check runs once wrong on purpose and must report the fault.

Each implementing commit names this record on a line of its own, `Design: 0012`. A test that verifies a decision carries `Verifies: Design 0012.k`.

The numbers that a step must reach are proposals. Each step records the measured value. Where this record gives a bound, the bound is a default. Record 0002 sets it again: a mean at ten times the first measured value, unless the measurement says otherwise.

Each part names the WebGPU feature it uses, and its WebGL2 lowering or CPU fallback. Part 4 has the table of these features (\"WebGPU features and their lowerings\").

## Why

### The gaps that a real scene needs first

A product scene, a room and an exterior need four things that 0010 leaves out. They are: a material that reads the common glTF extensions (Part 1). They are also area and sun lights with real shapes (Part 2). A camera that frames a shot (Part 3) is needed. An output transform for a grading pipeline (Part 4) is needed. Per-object control of visibility and shadows (Part 5) is needed. Each part is the smallest set that removes one class of failure. The survey gives the sources.

Fact: `KHR_materials_diffuse_transmission` is at Release Candidate and `KHR_materials_subsurface` is at Initial Draft in the glTF registry (survey S1). Part 1 takes diffuse transmission, because it is at Release Candidate. It leaves subsurface to M3s, as plan section 4 already does.

Fact: Blender 4.5 lists a Principled BSDF with diffuse roughness, anisotropic rotation, thin film and layered sheen (survey S6). The Cycles features that glTF cannot carry are not in the set. The set is the features that a glTF asset can carry, plus the Blender inputs that a Blender-authored asset uses in practice. The owner's reference for the image is Cycles (plan decision 3).

Fact: Blender 4.5 lists the area shapes square, rectangle, disk and ellipse, a sun with an angle, and a spot with a blend (survey S7). Part 2 takes the same shapes. Blender's Normalize option is a choice about power, and it is Decision 11.

Fact: Blender 4.5 lists the view transforms Standard, Khronos PBR Neutral, AgX, Filmic (deprecated), Filmic Log, False Color and Raw. It also lists white balance by temperature and tint (survey S8). Part 4 takes AgX, PBR Neutral and white balance. Filmic is deprecated in Blender 4.5, so it stays out (Decision 15).

Fact: Blender 4.5 lists ray visibility for camera, diffuse, glossy, transmission, volume scatter and shadow, a shadow catcher, and culling (survey S9). Part 5 takes the first five and the shadow catcher. Volume scatter waits for M3v.

Fact: the WebGPU canvas takes a `toneMapping` mode, `standard` or `extended` (survey S15). Mode `extended` allows colour above 1 on an HDR screen. Chrome shipped it (S16). Safari reports the mode but may not show it (S17). The runtime at the pin cannot set it (see Before).

Fact: the glTF registry lists `EXT_lights_ies` and `EXT_lights_image_based` as multi-vendor, not ratified (survey S1, S4, S5). The engine follows the multi-vendor text, which names the same two files that Babylon.js and Adobe use. This record does not claim that a Khronos standard covers them.

Inference: the owner's statement that the engine \"cannot build real scenes\" is consistent with the inventory. The survey finds no gap that is a rare case. Each gap in Parts 1 to 5 appears in a common asset or a common shot.

### The alternatives considered

- **One record for all gaps.** Rejected. The inventory has 96 items, and this record would reach 100,000 bytes, more than record 0010. Record 0010 has six parts, and each part merges alone. This record has five parts. The interaction work and the asset formats stay out, because each waits for another record (Decision 1).
- **A new storage buffer for the material extensions.** Rejected. The pipeline binds 7 buffers, and slot 8 is the console's. A new buffer would take the console's slot. Record 0001 rule 1 forbids it.
- **A second material record for each extension.** Rejected. A material that uses two extensions would read two records, and the kernel would branch on the extension set. The widened record gives one read per hit.
- **A light tree for the area lights.** Deferred, as record 0010 decision 18 defers it. A measured scene of thousands of emitters must exist first.
- **Portals as a sampling strategy.** Deferred to a follow-on record (Decision 7). A portal changes the environment sampler's distribution, and it needs a gate of its own.
- **The denoiser before this record.** Decision 2 proposes it. The survey gives the reason. The denoiser reads the AOVs of M3, and the denoiser's goldens do not depend on these parts.

## What it touches

- **Engine kernels.** `packages/radiance/src/kernels/materials.shade.ts` gains the lobes of Part 1. `trace.shade.ts` gains the BLEND pair, the area light sampling of Part 2, the visibility tests of Part 5 and the view transforms of Part 4. `sampler.shade.ts` gains the pairs that the new samplers take, from named constants. `layout.shade.ts` gains the record's words.
- **Engine host.** `materials/PhysicalMaterial.ts` gains its parameters. `renderers/scene-pack.ts` writes the widened record and the transform table at the tail of `materials`. `renderers/PathTracer.ts` gains the output transform, the HDR path and the visibility of each instance. `cameras/` gains `OrthographicCamera` and `PanoramicCamera`. `lights/` gains `RectAreaLight`, `DiskLight` and `IESSpotLight`.
- **Addons.** `loaders/GLTFLoader.ts` maps each extension of the tables in Parts 1, 2 and 5. `scenes/` gains one scene for each gate of this record.
- **Scripts.** `scripts/gates.mjs` gains the gates of Decision 10. `scripts/scenes.ts` lists the scenes. `scripts/oracle.ts` binds the new block and reads the new record. `scripts/bake-tables.ts` (from record 0010) bakes the IES and the sky tables.
- **Site.** The examples of the sample pages that show a material or a light change their text. Each example runs its code. No page shows an old shape of a record.
- **Records.** Each record of the list \"Amendments owed\" changes in its own pull request, before the step that depends on it.
- **Plan.** `docs/plan.md` changes its section 4 order and its section 7 rows, as Decision 1 proposes. Those changes are the owner's merge.

## Amendments owed

Each amendment is text to paste into the named record. Each merges before the step that needs it.

### Amendments to record 0001

- Amendment A (Part 1, step 1.1). The material record grows from 8 `vec4` to 16 `vec4`, 256 bytes. The words `[0]` to `[7]` keep their table of record 0010. The words `[8]` to `[15]` are the table of Part 1 below. Rule 1 of record 0001 keeps seven storage buffers.
- Amendment B (Part 1, step 1.2). The `materials` buffer gains a tail. The tail holds one transform for each texture id, three `vec4` each. Its offset is a field of the `params` uniform block.
- Amendment C (Part 2, step 2.1). The light table gains types 5 (rectangle), 6 (disk) and 7 (ellipse). Each takes the four `vec4` block that record 0010 decision 16 reserves for an analytic light.
- Amendment D (Part 5, step 5.1). The instance word `[7].x` holds the visibility bits in bits 16 to 21 of `flags`. Part 5 defines them below. The bits of `flags` below 16 keep their meaning of record 0001 and record 0011.

### Amendments to record 0002

- Amendment E. Six gates join `scripts/gates.mjs`: `lights` (Part 2), `camera` (Part 3), `output` (Part 4), `hdr` (Part 4), `visibility` (Part 5) and `linking` (Part 2). Each has a scene, a golden or a bound, and a probe. Record 0002 decides the gate's threshold, as it does for every gate.

### Amendments to record 0003

- Amendment F. The public surface gains `RectAreaLight`, `DiskLight`, `IESSpotLight`, `OrthographicCamera`, `PanoramicCamera`, and the members of `PhysicalMaterial`, `PhysicalCamera` and the view transform. Each name follows Decision 14.

### Amendments to record 0004

- Amendment G. The material table of record 0010 (\"The material record\") is replaced by the table of Part 1 below. Decision 5 of record 0010 (the integer words as values, seven buffers) stands.

### Amendments to record 0005

- Amendment H (Part 3, step 3.3). Rule 2 of record 0005 forbids a transcendental that decides. A direction from an angle uses `sin` and `cos` of an angle that `turn()` gives. The amendment states that rule 2 admits these, because the value is a direction and no index depends on it. The owner decides this (Decision 12).

### Amendments to record 0006

- Amendment I. A new item 7 is added: the canvas configuration takes a `toneMapping` mode (CN-1). Its text is in \"Compiler needs\" below. The item waits for the owner's decision on filing (Decision 16).
- Amendment J. Item 1 of record 0006 (device limits) is read again for the material stride and the storage size of the transform table (Part 1).

### Amendments to record 0007

- Amendment K. Each new feature of this record states its WebGL2 lowering or its CPU fallback. The table \"WebGPU features and their lowerings\" in Part 4 is the text to paste.

### Amendments to record 0010

- Amendment L. Part 1 of record 0010 keeps its 8-`vec4` record until this record's Amendment A merges. Part 5 of record 0010 keeps `[7].z` for the Cryptomatte index. Part 5 of this record uses bits 16 to 21 of `flags` in `[7].x`.

### The plan, `docs/plan.md`

- Amendment M (Decision 1). Section 4 gains the milestones M3a, M3b and M3c, and the order of Decision 1. Section 7 moves the rows of this record's inventory to those milestones. Section 9 gains the compiler need CN-1. The owner merges this text.

## Implementation, in steps

Each part is a sequence of steps. A step is one pull request. Each part merges alone, in order of its steps. A part waits for the step that its \"Needs\" column names.

### Part 1: Material extensions (milestone M3a)

The WebGPU features of Parts 1 to 3, and their lowerings. Part 4 has its own table.

| Feature                                                                                 | Used by       | WebGL2 lowering                                                                                                   | CPU fallback                                    |
| --------------------------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Anisotropic taps by `textureLoad`, with no sampler as decision 10 of record 0010 states | 1.9           | The same taps, with no sampler and no WebGL2 extension                                                            | The same taps, in the oracle                    |
| Texture `rgba32float` and `r32float` sampling by `textureLoad`                          | 2.3, 2.5, 2.6 | `texelFetch` on RGBA32F, where the WebGL2 float render target is present, else RGBA16F with the bound of step 2.6 | The oracle reads the same `Float32Array` values |
| Texture arrays by size class                                                            | 1.2, 1.3, 2.3 | Texture arrays (`TEXTURE_2D_ARRAY`), as record 0010 Part 2 lowers them                                            | The oracle reads the same arrays                |
| Storage buffers and compute                                                             | all           | Passes over textures, as change 0054 of the compiler lowers them (record 0007)                                    | The oracle runs the kernel on the CPU           |

**1.1 The widened record.**

- Delivers: `packMaterial` writes the 16-`vec4` record of Amendment A and the table below. The kernel reads the words and ignores the new ones. No lobe changes.
- Test: `scene-pack.test.ts` writes each word with each parameter set and reads it back. `materials.test.ts` stores every texture id from 0 to 16,777,215, and every flag mask below 0x2000, and reads each back.
- Number: no golden changes. `gate:determinism` reports 0 of 1,024 floats that differ. `readRadiance` of each existing differential scene is equal before and after, with 0 floats that differ.
- Probe: the same test stores 16,777,217 and must read 16,777,216.

The table of the record, in words, after Amendment G:

| Word   | x                       | y                     | z                       | w                           |
| ------ | ----------------------- | --------------------- | ----------------------- | --------------------------- |
| `[8]`  | diffuseTransmission.r   | diffuseTransmission.g | diffuseTransmission.b   | diffuseTransmissionFactor   |
| `[9]`  | specularColor.r         | specularColor.g       | specularColor.b         | specularFactor              |
| `[10]` | iridescenceFactor       | iridescenceIor        | iridescenceThicknessMin | iridescenceThicknessMax     |
| `[11]` | thickness               | diffuseRoughness      | occlusionStrength       | 0                           |
| `[12]` | id diffuseTransmission  | id specular           | id specularColor        | id iridescence              |
| `[13]` | id iridescenceThickness | id thickness          | id occlusion            | id transmission             |
| `[14]` | id clearcoat            | id clearcoatRoughness | id clearcoatNormal      | id sheenColor               |
| `[15]` | id sheenRoughness       | id anisotropy         | 0                       | linkMask (Part 2, step 2.4) |

Every id is `0` for none, else `1 + class * 256 + layer` (record 0010 decision 5). The words `[3]` and `[7]` keep their meaning of record 0010.

**1.2 The texture transform.**

- Delivers: `KHR_texture_transform` gives a 3 by 3 affine matrix for each texture id, with `offset`, `rotation`, `scale` and `texCoord`. The matrices are the tail of `materials` (Amendment B). The kernel applies the matrix to the `uv` of a hit before the lookup. `GLTFLoader` maps the extension and no longer warns.
- Needs: 0010 Part 2 step 2.5 (the texture lookup).
- Test: a textured quad with a transform of offset (0.5, 0), rotation pi/2 and scale (2, 1). Each of its four corners reads the texel that the matrix gives. Test name `texture-transform`.
- Number: the four corners' texel coordinates equal the analytic ones to 1e-6.
- Probe: the same test with the transform set to identity and the expected texel moved by one texel must fail.

**1.3 Specular, clearcoat and sheen maps, and `specularColorFactor`.**

- Delivers: the maps of `KHR_materials_specular` (`specularTexture`, `specularColorTexture`), of `KHR_materials_clearcoat` (`clearcoatTexture`, `clearcoatRoughnessTexture`, `clearcoatNormalTexture`) and of `KHR_materials_sheen` (`sheenColorTexture`, `sheenRoughnessTexture`). The factors of `specularColorFactor` enter the reflection lobe of record 0010 Part 1.
- Needs: 0010 Part 2 (the texture arrays), 0010 Part 1 step 1.5 (the lobes).
- Test: a scene with a specular map of 0 and of 1 gives the reflection of a dielectric. The reflection is the exact Fresnel of the specular factor times the map. Test name `specular-map`.
- Number: the mean of the lobe's value at a normal incidence equals the analytic value, to 1e-4.
- Probe: the test with the map read as the wrong channel must fail.

**1.4 Unlit, occlusion and diffuse roughness.**

- Delivers: `KHR_materials_unlit` makes the material emit its base colour with no lighting, as a `DiffuseMaterial` of unit weight, and it writes no shading term. `occlusionTexture` multiplies the diffuse and the reflection lobes at bounces after the first (Decision 4). Diffuse roughness (the Oren-Nayar term) replaces the Lambert lobe, when the record's `diffuseRoughness` is above 0. The Oren-Nayar formula is read from its source at this step, and it is labelled \"read\" in the step's commit.
- Needs: 0010 Part 1 steps 1.2 and 1.4.
- Test: a Lambert and an Oren-Nayar lobe with roughness 0 give the same value, to 1e-6. A furnace scene with unlit gives the base colour exactly. Test name `unlit-occlusion-roughness`.
- Number: the host measures the directional albedo of the Oren-Nayar lobe at roughness 1 in f64. It must not exceed the Lambert albedo.
- Probe: the test with `occlusionTexture` applied to the first bounce must fail, because the first bounce must not change.

**1.5 Diffuse transmission.**

- Delivers: `KHR_materials_diffuse_transmission` adds a lobe of transmission with a cosine density. It takes the factor and the colour factor of words `[8]`, and its map id of `[12].x`. Its sample and its density join the lobe selection of record 0010 Part 1, step 1.4. The lobe takes the weight that record 0010 gives the diffuse lobe, reduced by the transmission.
- Needs: 0010 Part 1 steps 1.2 to 1.4.
- Test: a slab of diffuse transmission, with factor 1 and colour 1, transmits the radiance of a Lambert plane. The Lambert plane has the same albedo. Test name `diffuse-transmission`.
- Number: the furnace value of a slab equals the analytic one to 1e-3.
- Probe: the test with the transmitted direction on the same side must fail.

**1.6 Iridescence (thin film).**

- Delivers: a thin-film Fresnel term on the reflection lobe, with `iridescenceFactor`, `iridescenceIor`, the thickness range of word `[10]` and the thickness map id of `[13].x`. The formula is read from its source at this step (the thin-film model of Belcour and Barla, 2017, read at the step and labelled \"read\"). The film's phase uses `cos`. The phase gives a radiance value only, so rule 2 of record 0005 admits it (survey, \"From memory\").
- Needs: 0010 Part 1 step 1.2 (the reflection lobe).
- Test: a film of thickness 0 gives the Fresnel of the substrate. A film of 400 nm on an IOR 1.5 substrate gives the colour that the host computes in f64 at three angles. Test name `iridescence`.
- Number: the three angles agree to 1e-3 of the host value.
- Probe: a film with the thickness of the wrong unit must fail.

**1.7 The volume thickness texture.**

- Delivers: `KHR_materials_volume` `thicknessTexture` multiplies the `thickness` of word `[11].x` at each hit. `attenuationDistance` and `attenuationColor` keep their record 0010 meaning (Part 1, \"Absorption\").
- Needs: 0010 Part 1 step 1.6 (absorption).
- Test: a sphere with constant absorption and a thickness map of 0.5 matches a sphere of thickness 0.5. The second sphere has no map. Test name `thickness-map`.
- Number: the two radiances are equal to 1e-6.
- Probe: the map read as the wrong channel must fail.

**1.8 Alpha BLEND by stochastic transparency.**

- Delivers: `alphaMode: BLEND` gives a material the alpha of `baseColor` as a probability of passing the ray. At a hit, a new pair (named `PAIR_BLEND` in `sampler.shade.ts`) decides whether the ray passes or stops. No sort, no second pass.
- Needs: 0010 Part 1 (the alpha of `[6].w`) and record 0009 (the pair constants).
- Test: a plane of alpha 0.5 stands in front of a diffuse plane. Over 4,096 samples, the mean is the mean of the two radiances. The bound is that of record 0002. Test name `alpha-blend`.
- Number: the mean error against the analytic mean is 0.5 percent or less, at 4,096 samples per pixel. Record 0002 sets the bound again after the first measurement.
- Probe: the test with alpha 0 or 1 must give the exact plane colour or the exact background.

**1.9 Nearest magnification and anisotropic filtering.**

- Delivers: the sampler table of record 0010 Part 2 gains `NEAREST` and an anisotropic mode. The anisotropic mode takes up to 16 taps along the major axis of the ray cone, with the taps' weights from a fixed table. The nearest mode reads the texel without interpolation.
- Needs: 0010 Part 2 step 2.6 (the ray cone) and 2.5 (the lookup).
- Test: a striped texture seen at a grazing angle gives a mean within the bound of the analytic mean, at each level. Test name `anisotropic`.
- Number: the grazing stripe's mean error is 2 percent or less. The probe reads an isotropic level with an error above 10 percent.
- Probe: the test with one tap must fail the bound.

**1.10 The loader and the demo page for the material extensions.**

- Delivers: `GLTFLoader` maps every extension of Part 1 to the record. The page `/materials/` of the site shows one material for each extension, rendered and written in the text of its example.
- Needs: steps 1.1 to 1.9.
- Test: `GLTFLoader.test.ts` loads one glTF with each extension and reads each record word. The site's gate `gate:site` builds the page.
- Number: the glTF sample assets of each extension load with no warning, in the test log.
- Probe: a glTF with an unknown extension warns once, and the test checks the warning.

### Part 2: Lights (milestone M3a)

**2.1 Area light shapes.**

- Delivers: `RectAreaLight` (type 5, a parallelogram from a corner and two edges, with its power). `DiskLight` (type 6) takes a centre, a normal and a radius. The ellipse (type 7) is a disk with two radii. Each takes the four `vec4` block of record 0010 decision 16. A shape is invisible to rays (record 0010 decision 17). An emitter that a ray must see is an emissive mesh.
- Needs: 0010 Part 3 step 3.1 (the table) and 0010 Part 1 step 1.3 (the solid-angle density).
- Test: each shape gives the irradiance at a point that the analytic form gives, within the bound of record 0002. The rectangle, the disk and the ellipse have the same test scene. Test name `area-lights`.
- Number: the irradiance error is 1 percent or less at 4,096 samples.
- Probe: a disk of radius 0 gives no light. A disk of radius 1 at a large distance gives the value of record 0010 step 3.2's point light.

**2.2 The sun with an angle.**

- Delivers: a sun with `angle` is sampled over the cone of its angular diameter, not as a delta. The default is record 0010 decision 17's 0.00918 radian. The density is the solid angle of the cone.
- Needs: 2.1.
- Test: a sun of angle 0 gives the delta result of record 0010 step 3.2. A sun of 0.5 degrees gives the penumbra of a disk. Test name `sun-angle`.
- Number: the penumbra's mean error is 1 percent or less.
- Probe: the sun with the cone's density at the wrong solid angle must fail.

**2.3 IES profiles.**

- Delivers: `EXT_lights_ies` gives a point light a distribution of intensity by a 2D table. Types B and C are required. Type A is optional and is not in this step. The profile is a texture, stored in record 0010 Part 2's texture arrays. The next event picks a direction from the table's marginal and conditional distributions. The host builds those in f64.
- Needs: 0010 Part 2 and 0050 (the texture write), and 0010 Part 3 step 3.2.
- Test: a profile of a uniform distribution gives the point light's value. A profile of a known cosine lobe gives its analytic integral. Test name `ies`.
- Number: the integral of the table and of the analytic lobe agree to 1e-3.
- Probe: the profile read as the wrong axis must fail.

**2.4 Light linking with 16 groups.**

- Delivers: a 16-bit link mask for each material (word `[15].w`, Amendment A) and for each analytic light (`[1].w` of its block). A surface of a material with bit `b` set is lit by a light with the same bit. The test is one integer and bitwise `and`, which the kernel's integer words admit.
- Reduced scope (Decision 5): 16 groups, not one mask for each object. The path to the full result is the per-object table of Decision 5, in M3c's follow-on.
- Needs: step 2.1 and 1.1.
- Test: two lights of different groups light two materials of different groups, and neither leaks. Test name `linking`.
- Number: the leak is 0 floats of the `readRadiance` above 0, over 1,024 samples.
- Probe: a mask of the wrong bit must leak, and the test must fail.

**2.5 Textured emitters.**

- Delivers: a map on an emissive material (`[7].x`) multiplies the emission. An emitter with a map has a distribution of its map, built by the host in f64, and next-event estimation samples it. A map of an area light is sampled by its distribution.
- Needs: 0010 Part 2 and 1.3.
- Test: an emitter with a map of uniform value gives the same radiance as an emitter with no map. A map of two halves gives the analytic average. Test name `textured-emitter`.
- Number: the average error is 1 percent or less.
- Probe: a map that is not sampled must give a higher variance, and the test checks the variance bound.

**2.6 The physical sky.**

- Delivers: the sky is a host-built environment of record 0010 Part 3 (an `Environment` of an equirectangular `rgba32float` image). The sky model is the Nishita model, read from its source at this step (labelled \"read\"). The sun of the sky is a sun light of step 2.2, with the sky's angle.
- Needs: 0010 Part 3 step 3.5 (the environment) and 2.2.
- Test: a clear sky at noon gives the sun's direction and the zenith radiance of the model's table, to 1 percent. Test name `physical-sky`.
- Number: the zenith radiance error is 1 percent or less, against the table in f64.
- Probe: the sky at the sun's direction must give the sun's table value and not the zenith's.

**2.7 The image-based lights of the loader.**

- Delivers: `EXT_lights_image_based` gives an `Environment`. The specular cube faces are resampled to the equirectangular image of record 0010 Part 3, at load. The spherical harmonic irradiance is not used, because the path tracer samples the environment (Decision 9).
- Needs: 0010 Part 3 step 3.5 and 2.6.
- Test: a glTF with a cube of uniform value gives the uniform environment. Test name `ibl-loader`.
- Number: the resampled image equals the uniform value to 1e-6.
- Probe: a cube with the faces in the wrong order must fail.

**2.8 The punctual lights of the loader, and the photometric units.**

- Delivers: `KHR_lights_punctual` maps the spot cone angles and `range`. Its `intensity` maps to the engine's radiometric units by the rule of Decision 11.
- Needs: 0010 Part 3 step 3.2.
- Test: a glTF with a point light, a spot and a sun loads, and the three values match the rule. Test name `punctual-loader`.
- Number: the three values match to 1e-6.
- Probe: a spot with the wrong cone angle must fail.

### Part 3: Cameras (milestone M3b)

**3.1 The orthographic camera.**

- Delivers: `OrthographicCamera` with `left`, `right`, `top`, `bottom`, `near` and `far`. The ray has a fixed direction and an origin on the view plane. A flag of `params` selects the ray form. The form of the pinhole ray (record 0010 Part 4) is unchanged.
- Needs: 0010 Part 4 step 4.1 (the ray form).
- Test: a ruler of 1 metre, seen from the camera, measures 1 metre on the image. Test name `orthographic`.
- Number: the measured length is within one pixel.
- Probe: a ruler of 2 metres must measure 2 metres, and the test fails when it measures 1.

**3.2 Lens shift, the view offset and the clip planes.**

- Delivers: `PhysicalCamera` and `PerspectiveCamera` take `shiftX` and `shiftY` (a fraction of the film), `setViewOffset`, and the `near` and `far` planes as ray `tmin` and `tmax`.
- Needs: 0010 Part 4.
- Test: a shift of 0.5 moves a box's image by half the frame. An object at the near plane is clipped. Test name `shift-clip`.
- Number: the position of the box's image is within one pixel.
- Probe: a shift of the wrong sign must fail.

**3.3 Panoramic cameras.**

- Delivers: `PanoramicCamera` with `mapping` of `equirectangular`, `fisheye-equidistant` or `fisheye-equisolid`, and a field of view. The direction of the ray comes from two angles. The angles come from `turn()` of the pixel's position. The `sin` and `cos` of the angles give the direction (Amendment H, Decision 12).
- Needs: 3.1 and the amendment of record 0005 (Decision 12).
- Test: a panoramic image of a sphere with a known colour map, read back, equals the map to 1 percent in each mapping. Test name `panoramic`.
- Number: the error is 1 percent or less at 512 by 256.
- Probe: a mapping with the poles swapped must fail.

**3.4 Radial lens distortion.**

- Delivers: a radial polynomial warp of the ray direction, with `k1` and `k2` on `PhysicalCamera`. Reduced scope (Decision 13): the warp is radial only, with `k1` and `k2`. Tangential terms and `k3` are the full result, in a follow-on step of M3b with the same gate.
- Needs: 3.1.
- Test: a grid of known points, distorted and undistorted, gives the polynomial's values. Test name `distortion`.
- Number: the position error is 1 pixel or less at the frame's edge.
- Probe: a sign error in `k1` must fail.

**3.5 The shutter for motion blur.**

- Delivers: a `PhysicalCamera` shutter of `shutterOpen` and `shutterClose` in frames, with a shutter curve of one point. The ray takes a time from a new pair (`PAIR_TIME`). The instances take their transforms at that time, from M2a's interpolation.
- Needs: M2a (the time-sampled BVH and the transform interpolation) and 3.1.
- Test: a moving box of a known path gives the known blur length. Test name `camera-shutter`.
- Number: the blur length is within one pixel of the analytic one.
- Probe: a shutter of 0 must give a sharp image.

**3.6 The stereo, cube and array cameras.**

- Decision 14 defers `StereoCamera`, `ArrayCamera` and `CubeCamera` to a later record.

### Part 4: Output (milestone M3b)

**4.1 The view transform set.**

- Delivers: a view transform is a field of `PresentParams`. Its modes are `aces-hill` (record 0010 Part 5, the baseline), `agx`, and `pbr-neutral`. The AgX and PBR Neutral curves are read from their sources at this step (labelled \"read\"), and the step names the source and its version.
- Needs: 0010 Part 5 step 5.5 (the baseline transform).
- Test: each mode gives the golden of its still. The modes are checked on a grey ramp, and the output is monotone. Test name `view-transforms`.
- Number: each mode is monotone on the ramp. The error against its source's table is 0.5 percent or less.
- Probe: a mode with a swapped channel must fail the monotone test.

**4.2 White balance.**

- Delivers: `PresentParams` gains a temperature (in kelvin) and a tint. The host builds a 3 by 3 matrix in f64, with a chromatic adaptation (Bradford, from memory, read at the step). The kernel applies the matrix to the beauty.
- Needs: 4.1.
- Test: a temperature of 6,500 K and a tint of 0 leave the image unchanged. A temperature of 3,200 K shifts a grey ramp to the matrix's value. Test name `white-balance`.
- Number: the shift is within 0.5 percent of the matrix's value.
- Probe: the matrix inverted must fail.

**4.3 Look controls.**

- Delivers: gamma, contrast and saturation on the screen, after the view transform. Contrast is a pivot at 0.18. Saturation is a mix with luminance. Each has a default that changes nothing.
- Needs: 4.1.
- Test: each control at its default gives the image of step 4.1. Test name `look`.
- Number: the difference is 0 floats.
- Probe: a contrast of 2 must change the image.

**4.4 Bloom and glare.**

- Delivers: a post pass on the HDR beauty: a threshold, a radius and an intensity. The blur is separable, with a fixed kernel of a set radius. It adds to the beauty before the view transform. It is off by default.
- Needs: 0010 Part 5 (the HDR beauty as `rgba32float`).
- Test: a bright point on a dark field gives the analytic blur of its kernel. Test name `bloom`.
- Number: the blur's error is 1 percent or less of the peak.
- Probe: a bloom with the threshold set above the point must add nothing.

**4.5 The HDR canvas path, and its fallback.**

- Delivers: `toneMapping: { mode: 'extended' }` on the canvas, with an `rgba16float` format. The screen transform maps scene-linear values to the extended range of the screen. Its peak is set by `hdrPeak` (Decision 16). Without `extended`, the path takes the SDR fallback. The fallback is the standard clamp and the sRGB curve. Its output equals step 4.1's `aces-hill` mode.
- Needs: CN-1 (the runtime's canvas configuration, Decision 16) and 4.1.
- WebGPU features and their lowerings: see the table below. This step uses the canvas `toneMapping`, and its lowering is the SDR fallback.
- Test: a browser whose `getConfiguration()` reports `extended` gives the readback of values above 1 (the `hdr` gate reads the `rgba16float` texture, not the screen). A browser that reports `standard`, and the forced SDR route of the runtime, gives the golden of step 4.1. Test name `hdr`.
- Number: the readback has a maximum above 1 for the test scene, and the SDR golden matches 4.1 with 0 floats different.
- Probe: a configuration that reports `extended` with the SDR route forced must fail the readback test.

**The WebGPU features of Part 4 and their lowerings.**

| Feature                                          | Used by  | WebGL2 lowering                                                                                  | CPU fallback                                              |
| ------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| Canvas `toneMapping: extended`                   | 4.5      | No HDR canvas. The SDR fallback of 4.5 (the clamp and the sRGB curve, as in 4.1)                 | The same SDR fallback, in the oracle                      |
| Canvas format `rgba16float`                      | 4.5      | RGBA8, the SDR fallback. Where the browser offers float16 render targets, the texture is RGBA16F | The oracle writes `Float32Array` values, read by the gate |
| `textureLoad` on `rgba16float` and `rgba32float` | 4.4, 4.5 | `texelFetch` on RGBA16F or RGBA32F, as record 0007 lowers the textures                           | The oracle reads the same values                          |
| Storage buffers and compute                      | all      | Passes over textures, as change 0054 of the compiler lowers them (record 0007)                   | The oracle runs the kernel on the CPU                     |

### Part 5: Visibility, shadow catcher and holdout (milestone M3c)

**5.1 The visibility bits.**

- Delivers: bits 16 to 21 of the `flags` word in `[7].x` hold the bits of the ray types. Bit 16 is camera, bit 17 diffuse, bit 18 glossy, bit 19 transmission, bit 20 shadow, and bit 21 the volume scatter (for M3v). The values stay below 2^24, so the word is exact (record 0010 decision 5). The default of every instance is all bits set. `trace.shade.ts` tests the bit of each ray type before it accepts a hit.
- Needs: 0010 Part 5 (the Cryptomatte word `[7].z`, which the bits do not touch) and record 0011 (`[7].w`, which the bits do not touch).
- Test: an instance with each bit clear is not hit by the ray type of that bit. The instance is hit by the other ray types. Test name `visibility`.
- Number: the test's count of hits is 0 for the cleared bit, and the count for the others equals the scene's count.
- Probe: the test with the wrong bit must fail.

**5.2 The shadow catcher.**

- Delivers: an instance with the catcher flag receives shadows and indirect light from the other instances. It is invisible to the camera in the beauty. The output has a shadow-catcher pass. The pass is the ratio of the beauty to a second beauty. The second beauty has the catcher replaced by the background. It accumulates in a light group slot of `accum` (Decision 6).
- Needs: 5.1 and 0010 Part 5 (the light groups and the slot count `K`).
- Test: a catcher plane under a sphere gives a shadow ratio. The ratio matches the analytic occlusion of the sphere, within the bound of record 0002. Test name `shadow-catcher`.
- Number: the ratio's error is 2 percent or less, at 1,024 samples.
- Probe: a catcher with no catcher flag gives a ratio of 1 everywhere, and the test fails.

**5.3 Holdout.**

- Delivers: an instance with the holdout flag is invisible to every ray, and its pixels take alpha 0 in the beauty. The holdout is bit 22 of the instance `flags` word in `[7].x`, after the visibility bits of step 5.1.
- Needs: 5.1.
- Test: a holdout plane in front of a lit background gives alpha 0 and the background's colour under it. Test name `holdout`.
- Number: the alpha is 0 for the holdout pixels, and 1 for the others.
- Probe: a holdout with the flag cleared must show the plane.

**5.4 Variants.**

- Delivers: `KHR_materials_variants`. The addons' scene holds a set of material assignments per variant. Switching the variant changes the `materials` index of each primitive, and re-packs only the instance words.
- Needs: 5.1 (the instance words).
- Test: a glTF with two variants renders the two materials, in turn, with the goldens of each. Test name `variants`.
- Number: the two goldens differ, and each equals its golden with 0 floats different.
- Probe: a variant that does not switch must fail the golden.

## Decisions for the owner

1. **Where the gap parts go in `docs/plan.md`.** This record splits into 0012 (Parts 1 to 5). It also proposes 0013 (interaction, waiting for record 0008) and 0014 (asset formats). Record 0014 covers KTX2, Basis Universal, Draco, meshopt, `EXT_mesh_gpu_instancing`, `EXT_texture_webp` and `KHR_node_visibility`. The milestones are M3a (Parts 1 and 2), M3b (Parts 3 and 4) and M3c (Part 5). The order is M3, M4, M3a, M3b, M3c, M3v, M3s, M5, M6, M6p, R1, R2, R3, R3v, M6s, R6, M7, R4, R5 and M8. Proposed: yes. The alternative keeps M4 after M6s, as the plan has it now.
2. **Denoising directly after M3.** Proposed: yes. The denoiser is the largest gain at 64 to 256 samples per pixel (plan section 6), and it reads the AOVs of M3. Its goldens are not affected by Parts 1 to 5 once it is measured. The cost: Parts 1 to 5 change pictures after the denoiser's goldens exist. The owner accepts that cost with this order.
3. **The material tail for texture transforms.** Transforms go to the tail of the `materials` buffer, one for each texture id. Proposed: yes. The alternatives are a uniform array (fixed size) or an eighth buffer (rejected by record 0001 rule 1).
4. **Occlusion on the first bounce.** `occlusionTexture` multiplies the diffuse and reflection lobes at bounces after the first, and never at the first bounce. Proposed: yes. glTF defines occlusion as a modulation of indirect light, and the first bounce of a path tracer is direct light. The alternative reads it nowhere, as record 0010 decision 7 does.
5. **Light linking with 16 groups (reduced scope).** The full result is a link mask for each object, in a table. The path to it is a follow-on step in M3c, with the gate `linking`. The table's words go to record 0014 if they need an asset format. Proposed: 16 groups now, and the full table as M3c's follow-on. The alternative waits for the full table. A scene that uses light linking waits with it.
6. **The shadow catcher's second beauty in a light-group slot.** It costs a second accumulation in the same dispatch. Proposed: yes. The alternative is two traces, which doubles the time. The cost is a stride of two slots of `accum` for each pixel when the catcher is used.
7. **Portals deferred.** Portals change the environment sampler's distribution through a window. Proposed: a follow-on record (0015, with the gate `portal`). A portal needs a gate of its own. Record 0010 decision 18 defers the light tree, and portals wait with it.
8. **Rectangle and disk lights are invisible to rays.** Proposed: yes, as record 0010 decision 17 for point lights. A light that a ray must see is an emissive mesh. The alternative makes each shape visible. That needs an analytic intersection of a disk and a rectangle in the kernel. It is a second change of record 0001.
9. **The environment's spherical harmonics are not used.** The path tracer samples the environment, so the irradiance of `EXT_lights_image_based` is not needed. Proposed: yes. The alternative stores the nine coefficients and uses them as a diffuse-only fallback, which the path tracer does not need.
10. **The gates.** Six gates join `scripts/gates.mjs`: `lights`, `camera`, `output`, `hdr`, `visibility` and `linking` (Amendment E). Each is in CI as a required check. Proposed: yes. Each gate's threshold is set by record 0002's rule after its first measurement.
11. **Photometric units.** `KHR_lights_punctual` gives candela and lux. The engine uses the radiometric units of record 0010 decision 17. Proposed: the loader keeps the number with no conversion. A loader option `photometric` converts with 683 lumens per watt, for a point light and for a sun. The default is no conversion. The owner decides the default.
12. **Trigonometry for panoramic directions.** Amendment H of record 0005 admits `sin` and `cos` of an angle from `turn()` when the value is a direction. Proposed: yes. The alternative keeps the rule and uses a polynomial of the same angle, which is less accurate near the poles.
13. **Radial distortion only.** The full model is the Brown-Conrady model with `k1`, `k2`, `k3`, `p1` and `p2`. Proposed: radial `k1` and `k2` now, and the full model as a follow-on step with the same gate. The reason: tangential terms and `k3` are rarely set in a product shot.
14. **Names for what three.js does not name.** `DiskLight`, `PanoramicCamera` and the `mapping` values follow record 0003 rule 1 where three.js has a name. Proposed: the names of this record. The owner decides whether `DiskLight` is `DiskAreaLight`.
15. **The view transforms.** The set is `aces-hill` (record 0010), `agx`, `pbr-neutral` and white balance. Filmic stays out, because Blender 4.5 deprecates it and AgX replaces it. Proposed: this set.
16. **The HDR canvas and the compiler's item CN-1.** The canvas `toneMapping` needs the runtime to accept it. Proposed: the owner decides whether to file CN-1 with typeshade/typeshade now. CLAUDE.md says a missing feature becomes an issue without asking first, so this record files the issue on the owner's go-ahead in the conversation. The HDR peak `hdrPeak` has the proposed default of 4.0 in units of diffuse white. That default is not measured, and step 4.5 measures it on the owner's screen. The owner's screen check is labelled as a review and is not a CI criterion.
17. **Bloom off by default.** Proposed: yes. The alternative is on, which changes every still of M3.
18. **The reference image set.** Each new gate of this record uses a scene that the record names. Each scene's golden is a PNG of the scene's own render. No Cycles render is a criterion of this record. Proposed: yes. The Cycles comparison of record 0010 Part 6 stays the owner's demo criterion.

## Compiler needs

These are the needs that the inventory finds, which the compiler or its runtime must answer. Each needs a proposal in `typeshade/typeshade` before the step that uses it. No issue is filed by this record. CLAUDE.md requires the issue on typeshade/typeshade for a missing feature, and that issue is filed before step 4.5 starts.

- **CN-1, a canvas `toneMapping` mode.** The configuration of the canvas takes `toneMapping: { mode: 'standard' | 'extended' }`, and `getConfiguration()` reports it. Needed by step 4.5. WebGL2 lowering: the SDR fallback. CPU: the same fallback.
- **CN-2, compressed block formats in the texture write.** BC, ETC2 and ASTC, each as an optional feature, with an RGBA8 fallback. Needed by record 0014 (KTX2). It depends on 0050.
- **CN-3, `textureLoad` on `rgba16float` and `rgba32float`.** Needed by 4.4 and 4.5. Record 0010 decision 10 assumes it. The pin must check it.
- **CN-4, the device's storage buffer size limit.** Needed by the material tail of Part 1 and the transform table. Record 0006 item 1 covers it.
- **CN-5, reverse mode over storage reads** (typeshade/typeshade#535, change 0056). Needed for the differentiable parts of M5. It is not new here.

## Record

**Approval and plan record.** None yet. The record is a draft and awaits the owner's review. Its status changes to `accepted` when the owner merges the pull request that carries it, or when the owner states the approval in the conversation.

**Configuration and validation record.** This record does not yet apply. No step is started. The record has five parts, 32 steps, 18 decisions and 13 amendments. It was written on `main` at 30daafa with the compiler pinned at 596c805. The checks that ran on this draft are listed in the pull request's description, with their dates.

**What the draft read.** The reading is split into what the worktree holds, what the network gave, and what was measured.

- Read in the worktree: `CLAUDE.md`, `README.md`, `docs/plan.md` (sections 3, 4, 6, 7, 9, 10 and 12) and `docs/design/README.md`. Also records 0001 to 0011 (their headers, decisions and deferrals), `docs/typeshade-feedback.md`, `compiler-changes.md` and `reqs/README.md`. Also `.claude/handoff/2026-10-06.md`, `.claude/research/webgpu-platform-watch.md`, `GLTFLoader.ts` (its header and extension table), `OrbitControls.ts` (its header and pinch), `packages/radiance/src/cameras`, and `vendor/typeshade/src/core/host-draw.ts` (the canvas configuration at the pin).
- Read through the network on 2026-10-09: the Khronos glTF extension registry (`extensions/README.md` at `main`). Also the Khronos READMEs of `KHR_materials_diffuse_transmission`, `KHR_texture_basisu`, `EXT_lights_ies` and `EXT_lights_image_based`. Also the Blender 4.5 manual pages (Principled BSDF, light objects, color management, object visibility). Also the three.js docs (`MeshPhysicalMaterial`, the index of cameras and loaders). Also the Mitsuba 3 integrators page. Also the MDN and Chrome pages on the canvas `toneMapping` mode. The Blender and three.js pages were partial reads. The survey labels each one.
- Measured: nothing. No number in this record was measured.

**What came from memory.** Each step that uses one reads its source first. The steps name the source. The items are these. The Oren-Nayar and the Belcour-Barla thin-film models. The Nishita sky model. The AgX and PBR Neutral curves. Bradford adaptation. The Brown-Conrady distortion model. The Blender ray visibility details, and the Cycles shadow catcher details.

**Open items at authorship.**

- **The split into records 0013 and 0014.** Neither exists. Next action: the owner accepts Decision 1, and each record is opened as its own draft.
- **The plan's order.** `docs/plan.md` is unchanged in this pull request. Next action: the owner accepts Decision 1, and the plan's text follows as Amendment M.
- **CN-1 and the other compiler needs.** No issue is filed. Next action: the owner decides Decision 16.
- **The Cycles comparison of the new features.** No Cycles render is in this record. Next action: the owner decides Decision 18.
- **The owner's HDR screen.** The HDR appearance is a review, not a CI criterion. Next action: the owner runs step 4.5's review on the owner's screen.

**Deferred, and not proposed.** None of these is in a step.

- The light tree (record 0010 decision 18).
- Portals (Decision 7, a follow-on record).
- Subsurface scattering (M3s) and the hair model.
- Dispersion and spectral transmission. They need a spectral record that does not exist.
- The stereo, cube and array cameras (Part 3, step 3.6).
- Filmic (Decision 15).
- The full light-linking table (Decision 5, a follow-on in M3c).
- Tangential lens distortion and `k3` (Decision 13, a follow-on in M3b).
- Draco, KTX2, Basis Universal, meshopt, `EXT_mesh_gpu_instancing`, `EXT_texture_webp` and `KHR_node_visibility` (record 0014).
- Picking, `TransformControls`, `MapControls`, `TrackballControls`, `ArcballControls`, `DragControls`, and touch picking (record 0013).
- The denoiser, adaptive sampling and the determinism report (M4, Decision 2).
- OBJ and MTL (the next plan, as plan section 7 states).

**Deviations.** None. No work has been delivered, so this text and the work cannot differ.

**Status of the owner's request of 2026-10-09.** The record is written and not accepted. Its five parts are written and not implemented. Records 0013 and 0014 are proposed and not written. The survey is written at `.claude/research/survey-scene-authoring-gaps.md`.
