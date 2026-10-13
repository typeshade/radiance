# Survey: scene-authoring gaps after record 0010 (M3)

Date: 2026-10-09 (UTC). Baseline: `main` at 30daafa. Compiler pin 596c805. This survey feeds
design record 0012 (`docs/design/0012-scene-authoring-gaps.md`). It holds the inventory, the
sources and the labels. The record holds the decisions.

## Labels

- **Fact**: read in the worktree or in a primary source on 2026-10-09. The source is named.
- **From memory**: not read on 2026-10-09. Each such item is re-read at its step.
- **Inference**: a conclusion drawn from facts. It is labelled where it matters.
- **Proposal**: a choice this survey makes for the owner to accept or change.

## Baseline (fact, the worktree at 30daafa)

- Materials: `DiffuseMaterial`, `MirrorMaterial`, `EmissiveMaterial`, `PhysicalMaterial`
  (renders as diffuse until record 0010 Part 1).
- Lights: emissive triangles only, with next-event estimation (NEE) and no multiple importance
  sampling (MIS) (record 0010, \"Before\").
- Camera: `PerspectiveCamera` only (pinhole).
- Tone map: Narkowicz's ACES fit per channel, with exposure in stops.
- Controls: `OrbitControls`, `FlyControls`. Picking is assigned to M1 (plan section 7) and
  specified by record 0008 (accepted; not implemented at 30daafa).
- Geometry: `BoxGeometry`, `PlaneGeometry`, `SphereGeometry`, `BufferGeometry`, `Sphere`
  (analytic record in progress on another branch).
- Loader: `GLTFLoader` reads `pbrMetallicRoughness` factors, `emissiveFactor` and
  `KHR_materials_emissive_strength`. It knows `KHR_mesh_quantization` and
  `KHR_texture_transform` and ignores the latter with a warning (record 0010, \"Before\" and
  \"What waits\").
- Material record: 8 `vec4` (128 bytes) after record 0010. Words `[6]` (absorption, Part 1) and
  `[7]` (emissive map, normal scale, alpha cutoff, light group) are assigned. **No word is free.**
  (Fact, record 0010 Part 1 step 1.1 and decision 6.)
- Storage buffers in the path tracer: 7 of the 8 slots. Slot 8 is reserved for the compiler's
  console (record 0001 rule 1).
- Instance record: `[7].z` is the object index for Cryptomatte (record 0010 Part 5, decision 26).
  Visibility flags have no word yet.

## Sources read (2026-10-09)

| Id  | Source                                                                                                                                                                                                                            | What was read                                                                                                                                                                                                                                                     | Status              |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| S1  | Khronos glTF extension registry, `extensions/README.md` at `main`                                                                                                                                                                 | Ratified KHR list, multi-vendor list (EXT_lights_ies, EXT_lights_image_based, EXT_mesh_manifold), in-progress list (KHR_materials_diffuse_transmission at Release Candidate, KHR_materials_subsurface at Initial Draft, KHR_texture_procedurals at Initial Draft) | Fact                |
| S2  | Khronos `KHR_materials_diffuse_transmission` README                                                                                                                                                                               | `diffuseTransmissionFactor`, `diffuseTransmissionTexture`, `diffuseTransmissionColorFactor`                                                                                                                                                                       | Fact (partial page) |
| S3  | Khronos `KHR_texture_basisu` README                                                                                                                                                                                               | KTX2 with Basis Universal supercompression, `source` in the extension, fallback to PNG or JPEG, transcode at runtime                                                                                                                                              | Fact (partial page) |
| S4  | Khronos `EXT_lights_ies` README                                                                                                                                                                                                   | `uri` or `bufferView` with `application/x-ies-lm-63`, a node-level light, `multiplier`, `color`, types B and C required, type A optional, standards LM-63-95, -02, -19                                                                                            | Fact                |
| S5  | Khronos `EXT_lights_image_based` README                                                                                                                                                                                           | Cube-face specular mips, SH irradiance (9x3), RGBD PNG, one IBL per scene                                                                                                                                                                                         | Fact                |
| S6  | Blender 4.5 LTS manual, Principled BSDF                                                                                                                                                                                           | Layers (base, coat, sheen, emission), Metallic, IOR, Alpha, Normal, Diffuse roughness (Cycles only), Subsurface method, Anisotropic and Anisotropic Rotation (Cycles only), Thin Film (Cycles only, dielectric only)                                              | Fact (partial page) |
| S7  | Blender 4.5 LTS manual, Light objects                                                                                                                                                                                             | Point (radius, soft falloff), spot (size, blend), area (square, rectangle, disk, ellipse), sun (strength, angle), Normalize, Exposure, Temperature, Color; power units per light type                                                                             | Fact                |
| S8  | Blender 4.5 LTS manual, Color management                                                                                                                                                                                          | View transforms: Standard, Khronos PBR Neutral, AgX, Filmic (deprecated, superseded by AgX), Filmic Log, False Color, Raw. Look, Exposure, Gamma, Sequencer, HDR display (macOS only in 4.5), white balance (temperature, tint). `view_as_render`. OCIO config    | Fact                |
| S9  | Blender 4.5 LTS manual, Object visibility                                                                                                                                                                                         | Ray visibility: Camera, Diffuse, Glossy, Transmission, Volume scatter, Shadow. Shadow catcher (receives shadows, interacts with indirect light, Shadow Catcher pass). Culling                                                                                     | Fact                |
| S10 | three.js docs, `MeshPhysicalMaterial`                                                                                                                                                                                             | Anisotropy (map, rotation), clearcoat, iridescence, transmission, attenuation colour and distance, sheen, retroreflection, specular                                                                                                                               | Fact (partial page) |
| S11 | three.js docs, cameras and loaders index                                                                                                                                                                                          | `OrthographicCamera`, `PerspectiveCamera`, `StereoCamera`, `ArrayCamera`, `CubeCamera`, `IESSpotLight`, `ProjectorLight`, `RectAreaLight`, `SpotLightShadow`; `GLTFLoader`                                                                                        | Fact (index only)   |
| S12 | three.js docs, controls                                                                                                                                                                                                           | Not read in full. `OrbitControls`, `TrackballControls`, `ArcballControls`, `MapControls`, `TransformControls`, `DragControls` are from memory                                                                                                                     | From memory         |
| S13 | Mitsuba 3 docs, integrators                                                                                                                                                                                                       | `direct` with MIS; `path` with `max_depth`, `rr_depth`; `aov` with nested integrators; `ptracer`                                                                                                                                                                  | Fact (partial page) |
| S14 | WebGPU specification (W3C), introduction and security sections                                                                                                                                                                    | Canvas configuration is in the spec; the page truncated before section 3                                                                                                                                                                                          | Fact (partial)      |
| S15 | MDN `GPUCanvasContext.configure()` and Chrome \"What's New in WebGPU\" 129 and 131                                                                                                                                                | `toneMapping: { mode: \"standard\" \| \"extended\" }`; `extended` with `rgba16float`; `getConfiguration()` reports the mode. The Chrome 131 page says a user still needs an HDR display                                                                           | Fact                |
| S16 | Blink intent to ship, WebGPU extended range                                                                                                                                                                                       | The extended mode is shipped; WebGL's HDR canvas is planned, not shipped                                                                                                                                                                                          | Fact                |
| S17 | WebKit bug 272702                                                                                                                                                                                                                 | Safari reports `extended` in `getConfiguration()` and may still show SDR                                                                                                                                                                                          | Fact                |
| S18 | `.claude/research/webgpu-platform-watch.md` (worktree)                                                                                                                                                                            | Facts 1 to 14 of the platform, with status on 2026-10-09                                                                                                                                                                                                          | Fact (worktree)     |
| S19 | Worktree: `docs/plan.md`, records 0001 to 0011, `GLTFLoader.ts`, `OrbitControls.ts`, `CLAUDE.md`, `docs/design/README.md`, `reqs/README.md`, `.claude/handoff/2026-10-06.md`, `compiler-changes.md`, `docs/typeshade-feedback.md` | The baseline and the plan                                                                                                                                                                                                                                         | Fact                |

Not read in full, and so labelled \"from memory\" where used: Blender's AgX definition (its OCIO
config, a pinned version), Khronos PBR Neutral's formula, Nishita's sky model, the Basis
Universal transcoder, Draco and meshopt decoders, glTF `KHR_materials_iridescence`,
`KHR_materials_dispersion`, `KHR_materials_volume` and `KHR_materials_specular` in full, the
Cycles render settings for adaptive sampling and light linking, Mitsuba's `prb` and `prbvolpath`
integrators, OpenPBR's thin-film model. Each is read at the step that uses it. Record 0012
owes a re-read to each part before its first step.

## Inventory

The table gives each gap, its source, the part of record 0012 that owns it and what it waits for.
\"Part\" means a part of record 0012. \"0010 step\" means a step of record 0010, which is accepted
and not implemented. Items marked **DEFER** have no part in this record, and the record says why.

### Materials and textures

| #   | Gap                                                                                                            | Source                                     | Part                                                              | Waits for                                                                      |
| --- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| M1  | `KHR_texture_transform` (offset, rotation, scale, texCoord)                                                    | S1, 0010 decision 14                       | 1                                                                 | 0010 Part 2 step 2.5 (textures); 0012 Part 1 step 1.2 (material record stride) |
| M2  | Texture maps of `KHR_materials_specular` (`specularTexture`, `specularColorTexture`) and `specularColorFactor` | S1, S10, 0010 decision 7                   | 1                                                                 | 0010 Part 2 (texture arrays)                                                   |
| M3  | `occlusionTexture` read as ambient occlusion                                                                   | glTF core, 0010 decision 7 says never read | 1                                                                 | 0010 Part 2                                                                    |
| M4  | `KHR_materials_unlit`                                                                                          | S1                                         | 1                                                                 | 0010 Part 1 step 1.1                                                           |
| M5  | `KHR_materials_diffuse_transmission` (factor, texture, colour factor)                                          | S1, S2 (RC)                                | 1                                                                 | 0010 Part 1 (lobes); 0012 Part 1 step 1.2                                      |
| M6  | `KHR_materials_iridescence` (thin film) and the Blender Thin Film input                                        | S1, S6                                     | 1                                                                 | 0010 Part 1 (reflection lobe); 0012 Part 1 step 1.2                            |
| M7  | `KHR_materials_dispersion`                                                                                     | S1, 0010 decision 7                        | DEFER (no record 0012 decision; a spectral record is not written) | a spectral record (not written)                                                |
| M8  | `KHR_materials_volume` thickness texture; `attenuationDistance` inside a medium                                | S1, 0010 Part 1                            | 1                                                                 | 0010 Part 1 (thin walls, absorption)                                           |
| M9  | Alpha BLEND (`alphaMode: BLEND`)                                                                               | glTF core, 0010 decision 14                | 1                                                                 | stochastic transparency in the path tracer; no sort (Decision 6)               |
| M10 | Anisotropic filtering and the nearest magnification filter                                                     | 0010 decision 14                           | 1                                                                 | 0010 Part 2 step 2.6 (ray cones)                                               |
| M11 | `KHR_materials_subsurface` (Initial Draft)                                                                     | S1                                         | DEFER                                                             | M3s of plan.md, which owns the SSS model                                       |
| M12 | Diffuse roughness (Oren-Nayar, Blender \"Diffuse Roughness\")                                                  | S6 (Cycles only)                           | 1 (Decision 5)                                                    | 0010 Part 1 (diffuse lobe)                                                     |
| M13 | Principled Subsurface with a Christensen-Burley method                                                         | S6                                         | DEFER                                                             | M3s                                                                            |
| M14 | Retroreflection                                                                                                | S10                                        | DEFER                                                             | a layered record; no glTF source                                               |
| M15 | `KHR_materials_variants` (switch material sets)                                                                | S1                                         | 5                                                                 | the scene's material table (addons only)                                       |

### Lights

| #   | Gap                                                                           | Source                                               | Part           | Waits for                                                    |
| --- | ----------------------------------------------------------------------------- | ---------------------------------------------------- | -------------- | ------------------------------------------------------------ |
| L1  | Rectangle and disk area lights, with a radius for a point light               | S7, 0010 decision 16/17                              | 2              | 0010 Part 3 step 3.1 (light table)                           |
| L2  | Ellipse and square shapes                                                     | S7                                                   | 2              | L1                                                           |
| L3  | IES profiles (types B and C; type A optional), `EXT_lights_ies`               | S1, S4                                               | 2              | 0010 Part 3; compiler need C-LT-2 (a 2D table texture, 0050) |
| L4  | Textured emitter sampling (a map on an area light or on an emissive triangle) | 0010 decision 14                                     | 2              | 0010 Part 2 and Part 3; a 2D distribution per map            |
| L5  | Light linking (per-light include and exclude sets)                            | S8 (Blender's light linking is from memory); S7      | 2              | a light mask word (Decision 8)                               |
| L6  | Portals (sampling the environment through a window)                           | plan.md section 7 (\"after M3\")                     | 2              | 0010 Part 3 step 3.4 (environment sampling)                  |
| L7  | Light tree                                                                    | 0010 decision 18                                     | DEFER          | a measured scene of thousands of emitters                    |
| L8  | Colour temperature (blackbody to RGB)                                         | S7, S8                                               | 2              | none; a host table                                           |
| L9  | Photometric units (`lm`, `cd`, `lx`) on `KHR_lights_punctual` light values    | S7 (watts per square metre for a sun with Normalize) | 2 (Decision 3) | 0010 Part 3                                                  |
| L10 | `KHR_lights_punctual` loader (spot cone angles, range)                        | glTF core                                            | 2              | 0010 Part 3                                                  |
| L11 | `EXT_lights_image_based` (IBL as scene light, RGBD PNG, SH irradiance)        | S5                                                   | 2              | 0010 Part 3 step 3.5 (environment); Decision 4               |
| L12 | Projector light (texture as a spot)                                           | S11 (three.js `ProjectorLight`)                      | 2              | L4                                                           |
| L13 | Physical sky (Nishita, the Blender \"Sky Texture\")                           | plan.md section 7 (\"after M3\")                     | 2              | 0010 Part 3 step 3.5 (environment) and a sun light           |
| L14 | Sun light Angle (a disk, not a delta)                                         | 0010 decision 17 default                             | 2              | 0010 Part 3 step 3.2                                         |

### Cameras

| #   | Gap                                                                                | Source                                                                                           | Part  | Waits for                                                       |
| --- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----- | --------------------------------------------------------------- |
| C1  | `OrthographicCamera`                                                               | S11                                                                                              | 3     | 0010 Part 4 step 4.1 (the ray form)                             |
| C2  | Panoramic cameras: equirectangular, fisheye equidistant and equisolid, mirror ball | S13 (Mitsuba's `thinlens`/`perspective` are from memory); Blender's Panoramic type (from memory) | 3     | 0010 Part 4                                                     |
| C3  | Lens shift (`shift_x`, `shift_y`) and `setViewOffset`                              | S11 (three.js); Blender from memory                                                              | 3     | 0010 Part 4                                                     |
| C4  | Motion blur from the camera shutter (open, close, a shutter curve)                 | S9 (object motion blur, \"Steps\"); the camera case is from memory                               | 3     | M2a (vertex motion blur, time in BVH)                           |
| C5  | Radial lens distortion (a ray-direction warp)                                      | from memory (not in Cycles)                                                                      | 3     | 0010 Part 4                                                     |
| C6  | Clip planes (ray `tmin`, `tmax`)                                                   | three.js `near`, `far`                                                                           | 3     | 0010 Part 4                                                     |
| C7  | `StereoCamera`, `ArrayCamera`, `CubeCamera`                                        | S11                                                                                              | DEFER | a stereo record; a cube map output is a single panoramic output |

### Controls and interaction

| #   | Gap                                                                | Source                                        | Part                     | Waits for                                 |
| --- | ------------------------------------------------------------------ | --------------------------------------------- | ------------------------ | ----------------------------------------- |
| I1  | Picking (a ray cast on the host)                                   | plan.md section 7, record 0008                | 0008 (not a gap of 0012) | record 0008 steps 1 and 2, accepted       |
| I2  | `TransformControls` (translate, rotate, scale)                     | record 0008                                   | 0008 (not a gap of 0012) | record 0008 step 3                        |
| I3  | `MapControls`, `TrackballControls`, `ArcballControls`              | S12 (from memory)                             | 0013                     | I1 for the pick used by a centre of orbit |
| I4  | `DragControls` and `PointerLockControls`                           | S12 (from memory)                             | 0013                     | I1                                        |
| I5  | Touch: a long-press pick and a gesture set for `TransformControls` | `OrbitControls` already has pinch (fact, S19) | 0013                     | I2                                        |
| I6  | Damping in `OrbitControls`                                         | fact: `enableDamping` exists (S19)            | done                     | none                                      |

### Output

| #   | Gap                                                                                 | Source                                                                         | Part                             | Waits for                                                            |
| --- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------- | -------------------------------------------------------------------- |
| O1  | AgX view transform                                                                  | S8                                                                             | 4                                | 0010 Part 5 step 5.5 (the output transform), read the baseline first |
| O2  | Khronos PBR Neutral view transform                                                  | S8                                                                             | 4                                | 0010 Part 5 step 5.5                                                 |
| O3  | Filmic                                                                              | S8 (deprecated in Blender 4.5)                                                 | DEFER (record 0012, Decision 15) | none                                                                 |
| O4  | `Standard` (clamp and sRGB curve)                                                   | S8                                                                             | 4                                | 0010 Part 5                                                          |
| O5  | Look, gamma, contrast, saturation (artistic grading)                                | S8 (exposure, gamma)                                                           | 4                                | 0010 Part 5                                                          |
| O6  | White balance (temperature and tint, Bradford)                                      | S8                                                                             | 4                                | 0010 Part 5                                                          |
| O7  | RGB curves before the view                                                          | S8                                                                             | DEFER                            | a 256-entry table per channel; no owner demand                       |
| O8  | False colour and the luminance heat map                                             | S8                                                                             | 4                                | the `show` kernel only                                               |
| O9  | HDR display output through a WebGPU canvas (`toneMapping: extended`, `rgba16float`) | S15, S16, S17, S18 item 10                                                     | 4                                | 0010 Part 5 step 5.5 and the Amendment 1 of 0010                     |
| O10 | Bloom and glare (streaks, ghosts)                                                   | plan.md section 7 (\"post\") lists bloom under R1; a film bloom is from memory | 4                                | 0010 Part 5 (the HDR beauty)                                         |
| O11 | Denoiser (a-trous, guided by AOVs)                                                  | plan.md section 4 (M4)                                                         | outside 0012 (M4, Decision 2)    | 0010 Part 5 (AOVs); 0009 Part 4                                      |
| O12 | Adaptive sampling and the stopping rule                                             | plan.md section 7 (M1, M4)                                                     | outside 0012 (M4)                | 0009 Part 4 (G-MoN buckets give a variance)                          |
| O13 | Russian roulette and firefly clamping                                               | plan.md section 7                                                              | outside 0012 (M4)                | 0009 Part 4                                                          |
| O14 | White balance of the EXR                                                            | S8                                                                             | DEFER                            | the beauty is scene-linear by 0010 Part 5                            |
| O15 | Render layers and passes (Blender's Render Layers)                                  | S9                                                                             | outside 0012 (M4)                | 0010 Part 5 (AOVs and light groups)                                  |

### Shadow catcher, holdout and visibility

| #   | Gap                                                                                      | Source                              | Part      | Waits for                                                           |
| --- | ---------------------------------------------------------------------------------------- | ----------------------------------- | --------- | ------------------------------------------------------------------- |
| V1  | Ray visibility per object: camera, diffuse, glossy, transmission, volume scatter, shadow | S9                                  | 5         | bits 16 to 21 of `flags` in `[7].x` (record 0012, Part 5, step 5.1) |
| V2  | Shadow catcher (receives shadows, the Shadow Catcher pass)                               | S9                                  | 5         | V1; 0010 Part 5 (the AOV pass)                                      |
| V3  | Holdout (matte: alpha 0 where the object is hit)                                         | S9 (Blender's Holdout, from memory) | 5         | V1                                                                  |
| V4  | Thin film in the principled BSDF                                                         | S6 (Cycles only, dielectric only)   | 1 (as M6) | M6                                                                  |

### Asset formats

| #   | Gap                                                                      | Source                                                           | Part                     | Waits for                                              |
| --- | ------------------------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------ | ------------------------------------------------------ |
| A1  | `KHR_mesh_quantization` (decoded at load)                                | S1; loader knows it                                              | done (verify)            | none                                                   |
| A2  | `KHR_texture_basisu` (KTX2, Basis Universal)                             | S1, S3                                                           | 0014                     | 0050 (texture write, compressed formats); a transcoder |
| A3  | `KHR_draco_mesh_compression`                                             | S1                                                               | DEFER (Decision 12)      | a decoder; the boundary admits no library              |
| A4  | `EXT_meshopt_compression`                                                | S1                                                               | 0014                     | none (CPU decoder in addons)                           |
| A5  | `EXT_mesh_gpu_instancing`                                                | S1                                                               | 0014                     | the instance record                                    |
| A6  | `EXT_texture_webp`                                                       | S1                                                               | 0014                     | the browser decodes (`createImageBitmap`)              |
| A7  | `KHR_animation_pointer`                                                  | S1                                                               | M2a                      | M2a                                                    |
| A8  | `KHR_node_visibility`, `KHR_node_selectability`, `KHR_node_hoverability` | S1                                                               | 0014                     | the scene graph                                        |
| A9  | OBJ and MTL                                                              | plan.md section 7 (\"USD, Alembic and OBJ are the next plan's\") | DEFER                    | the next plan                                          |
| A10 | `KHR_xmp_json_ld`                                                        | S1                                                               | DEFER                    | metadata only, no render effect                        |
| A11 | HDR and EXR decoding in the browser                                      | plan.md section 7 (M3)                                           | 0010 Part 5 (the reader) | 0010 Part 5                                            |

### Differentiable rendering (Mitsuba 3 as the reference)

| #   | Gap                                                        | Source                                               | Part  | Waits for                                                 |
| --- | ---------------------------------------------------------- | ---------------------------------------------------- | ----- | --------------------------------------------------------- |
| D1  | Gradients of material parameters                           | plan.md section 3.3, M5                              | DEFER | M5; compiler change 0056 (in progress)                    |
| D2  | Gradients of light intensity and colour                    | Mitsuba 3 (`direct`, `path` with `prb`, from memory) | DEFER | M5                                                        |
| D3  | Gradients of texture pixels (an adjoint of a storage read) | plan.md section 9, record 0011                       | DEFER | the compiler's C1 needs (typeshade/typeshade#535 comment) |
| D4  | Gradients of camera pose and focal length                  | Mitsuba 3 (from memory)                              | DEFER | M5                                                        |
| D5  | Gradients of vertex positions (discontinuous visibility)   | plan.md section 10 (out until reverse mode)          | DEFER | a later plan                                              |

## Compiler needs (from this survey)

These are the needs the inventory finds that the compiler or its runtime must answer. Record 0012
owes each one to typeshade/typeshade before the step that needs it. No issue is filed by this
survey (see the record's Decision 16).

- **CN-1: a canvas configuration for extended range.** The runtime's `configure` call does not
  take `toneMapping` at the pin (fact: `vendor/typeshade` at 596c805 is read through the runtime
  surface in `docs/design/0006`; the item is not listed there). Needed by Part 5 (O9). WebGL2 and
  CPU lowering: the SDR path (record 0012, Part 4, step 4.5).
- **CN-2: compressed block formats in texture write.** Needed by A2. Depends on 0050. The
  proposal names BC (`texture-compression-bc`, an optional feature), ETC2 and ASTC, with an RGBA8
  fallback for an adapter without one.
- **CN-3: a sampler-free `textureLoad` on `rgba16float` and `rgba32float`.** Needed by Part 5 (the
  HDR beauty) and Part 2 (the IES table). Record 0010 decision 10 assumes it. Confirm at the pin.
- **CN-4: a device limit read.** The material stride of Part 1 and the instance word of record 0012, Part 5
  need the storage buffer size limit (`maxStorageBufferBindingSize`). Record 0006 item 1 covers it.
- **CN-5: reverse mode over storage reads** (C1, typeshade/typeshade#535; change 0056). Needed by D1
  to D5. Not new here.
- **CN-6: a `pow` and `log2` determinism rule for AgX.** The AgX curve uses `log2` and a
  polynomial. Record 0005 rule 2 bans trigonometry that decides an index. The record states the
  check (Part 5, step 5.2).

## Proposed order (for the owner)

plan.md section 4 orders M3, M3v, M3s, M5, M6, M6p, R1 to R3, R3v, M6s, M4, R6, M7, R4, R5 and M8.
This survey proposes that M4 (denoising, adaptive sampling, reference mode, the determinism
report) moves directly after M3, before M3v. Its reason: the denoiser is the largest visible
gain for the path tracer at 64 to 256 spp (plan section 6), and it reads the AOVs that M3 builds.
The gap parts of record 0012 follow M4. Record 0012 proposes them as milestones M3a to M3c (see
the record's Decision 1).

## Limits of this survey

- Several sources were read as partial pages (S2, S3, S6, S10, S13, S14). The labels say so.
- No gap was verified in a running browser. Each claim about a feature is a claim about its source.
- No number is measured. Each record step names the measurement it owes.
