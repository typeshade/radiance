# Survey: analytic spheres and the shading-normal problem in research and library renderers

Date of survey: 2026-10-06. Sources were read on that date. Each row says whether a claim is
a fact read in a source ("read"), an inference from what was read ("inferred"), or not
confirmed ("not confirmed"). Code was read from the `master` branch of each repository on the
survey date, not from a tagged release, unless a version is named.

## 1. Table

| Renderer / library | Analytic sphere | Default handling of shading normals for reflection | Recommended fix / option | Confidence |
|---|---|---|---|---|
| pbrt-v3 (2016 book, 3rd ed.) | Yes. `Sphere` is a quadric with a closed-form quadratic intersection (book §3.2, `src/shapes/sphere.cpp`). | Classify by the geometric normal, evaluate in the shading frame: `BSDF::f` computes `reflect = Dot(wiW, ng) * Dot(woW, ng) > 0` and evaluates only reflection BxDFs when both directions are on the same geometric side; cosine term uses the shading normal. `Bump()` calls `SetShadingGeometry(..., false)`, so the shading normal is flipped to the geometric normal's side (fold). For importance transport (BDPT) the Veach factor is applied by `CorrectShadingNormal()` (book §16.1.3). | No terminator fix. The book recommends only the geometric-side classification plus the Veach correction for bidirectional methods. | read: `reflection.cpp`, book §16.1.3 |
| pbrt-v4 (2023 book, 4th ed.) | Yes. `Sphere` in `src/pbrt/shapes.h` solves a quadratic in `BasicIntersect`; its geometric and shading normals coincide. Other analytic shapes: `Disk`, `Cylinder`, `BilinearPatch`, `Curve`. | Evaluate in the shading frame only. `BSDF::f` holds only `shadingFrame` and `bxdf`, has no `ng` member and no same-side test; the only test is `wo.z == 0`. `PathIntegrator::SampleLd` multiplies by `AbsDot(wi, intr.shading.n)`. `SurfaceInteraction::SetShadingGeometry` flips the shading normal to the geometric normal's side with `FaceForward` (fold). `NormalMap()` and `BumpMap()` (book §10.5.3, §10.5.4) do no clamping toward the geometric normal. | No terminator fix in the code read. `SpawnRay` offsets the ray origin along the geometric normal (self-intersection only). pbrt-v4 has no BDPT, so no Veach factor was found in `bsdf.h` (inferred: dropped with BDPT; the search for `CorrectShadingNormal` in pbrt-v4 could not run, so this is not confirmed). | read: `bsdf.h`, `interaction.h`, `materials.h`, `shapes.h`, `cpu/integrators.cpp` |
| Mitsuba 3 (v3.7.1, 2025-09-17) | Yes. `sphere` plugin: "a simple sphere intersection primitive. It should always be preferred over sphere approximations modeled using triangles." `sphere.cpp` solves a quadratic (`math::solve_quadratic`) and sets `si.n = si.sh_frame.n`. Other analytic shapes: `rectangle`, `disk`, `cylinder`, `bsplinecurve`, `linearcurve`, `sdfgrid`. | Evaluate in the shading frame only. `diffuse.cpp` uses `Frame3f::cos_theta(si.wi)` and `cos_theta(wo)` and never checks `si.n`. Since v3.7.1 (commit `e32d718`, "Improve bump and normal mapping"), `bumpmap` and `normalmap` have `flip_invalid_normals = true` (fold: flip the perturbed normal to the geometric side, citing Schüssler et al. 2017) and `use_shadowing_function = true` (microfacet-based terminator shadowing from Conty Estevez, Lecocq, Stein 2019, in `src/bsdfs/normalmap_helpers.h`, `eval_shadow_terminator()`). | The two options above, on by default. A "sticky" option or term was not found in the shape docs, the BSDF docs, the release notes or the commit: not confirmed; the term may be a misremembering of the Mitsuba 0.5 `"strictNormals"` integrator flag (not confirmed either, not checked). | read: `plugins_shapes`, `plugins_bsdfs`, release notes, commit `e32d718`, `sphere.cpp`, `diffuse.cpp` |
| Embree (4.x API docs) | Yes, two ways. (a) `RTC_GEOMETRY_TYPE_SPHERE_POINT`: vertex buffer `(x, y, z, r)` in `RTC_FORMAT_FLOAT4`; "a real geometric surface is rendered"; hit returns only `tfar` and the geometric normal, `u = v = 0`. Also `DISC_POINT` (ray-facing disc) and `ORIENTED_DISC_POINT`. (b) `RTC_GEOMETRY_TYPE_USER`: `rtcSetGeometryUserPrimitiveCount`, a bounds callback and intersect/occluded callbacks; the callback fills `tfar`, `u`, `v`, `Ng`, `instID`, `geomID`, `primID`. Curves: `FLAT_*` (ray-facing quads, normal = tangent), `ROUND_*` (cone for linear; sweep surface of a circle for Bezier, B-spline, Hermite, Catmull-Rom; `Ng` = unnormalized surface normal), `NORMAL_ORIENTED_*` (flat band). `RTC_GEOMETRY_TYPE_SUBDIVISION` with displacement. | Not applicable: Embree returns only the geometric normal `Ng`; shading normals are the application's job. | None at this level. For a sphere, use `SPHERE_POINT` or a user geometry so `Ng` is exact and no shading-normal mismatch exists. | read: `RTC_GEOMETRY_TYPE_POINT.md`, `RTC_GEOMETRY_TYPE_USER.md`, `RTC_GEOMETRY_TYPE_CURVE.md`, `rtcSetGeometryIntersectFunction.md` |
| NVIDIA OptiX (7.5.0, June 2022, and later) | Yes. Release notes 7.5.0: "New built-in sphere primitive. A geometry acceleration structure can now contain lists of spheres. Each sphere is specified by its center and radius." Host: `OptixBuildInputSphereArray`; enable with `OPTIX_PRIMITIVE_TYPE_FLAGS_SPHERE`; device: one attribute (the back-face `t` when hit twice), `optixIsFrontFaceHit`, `optixGetSphereData` (needs `OPTIX_BUILD_FLAG_ALLOW_RANDOM_VERTEX_ACCESS`), sample `optixSphere`. The built-in module entry point is `__builtin_intersection__sphere` (from a forum post; the programming guide returned HTTP 503 on the survey date, so this entry name is not confirmed from the guide). Built-in curves exist since 7.1 (round linear/quadratic/cubic B-spline, Catmull-Rom, ribbons; list not confirmed from the guide). | Not applicable: OptiX reports the hit; the application computes the normal from `optixGetSphereData` (center, radius) or its own data. | None at this level. | read: release notes PDF 7.5.0; forum post |
| Falcor (NVIDIA, `master`) | Not found. Falcor's scene is triangle meshes, curves and SDF grids (SDF grids are from memory, not confirmed). No analytic sphere primitive was found. | `ShadingData` carries `faceN` ("Face normal in world space, always on the front-facing side") and `frame` ("Smooth interpolated shading frame ... not automatically flipped for backfacing hits"). `adjustShadingNormal(sd, sf)` in `Scene/Material/ShadingUtils.slang` blends the shading normal toward the oriented geometric normal when `dot(V, Ns) <= 0.1` ("Blend the shading normal towards the geometric normal at grazing angles. This is to avoid the view vector from becoming back-facing." and "Note: This breaks the reciprocity of the BSDF!"). The `PathTracer` option `adjustShadingNormals` defaults to `false` in `PathTracer.h` ("Adjust shading normals on secondary hits"), tooltip: "Enables adjustment of the shading normals to reduce the risk of black pixels due to back-facing vectors. Does not apply to primary hits which is configured in GBuffer." | The blend above (a "bend" of the normal, Iray-style; the Iray link is my inference, no citation in the code). No terminator shadowing function was found. | read: `ShadingData.slang`, `ShadingUtils.slang`, `PathTracer.cpp`, `PathTracer.h` |
| Blender Cycles (2.93, 2021), for comparison | No analytic sphere (from memory, not confirmed). | Offsets the shadow-ray origin to where a smooth surface would be. Options `Shading Offset` and `Geometry Offset` (default 0.1) per object. | `Geometry Offset`: "has little effect on the lighting, making it the preferable method". Commit `9c6a382` "Cycles: reduce shadow terminator artifacts" (June 2021). | read: search snippets of the commit and manual; commit page returned HTTP 403 |

## 2. Techniques for the shading-normal mismatch, with sources

Vocabulary used below: `ng` geometric normal, `ns` shading normal, `wi` light direction,
`wo` view direction.

1. **Veach 1997, thesis chapter 5 "The Sources of Non-Symmetric Scattering"** (§5.3 shading
   normals). Fact (read in the pbrt-v3 book §16.1.3 and in Hanika 2021 §4.2): a shading normal
   acts as the factor `|wi . ns| / |wi . ng|` multiplied into the BSDF; it depends on `wi` only, so
   the BSDF is no longer symmetric. The adjoint BSDF for importance transport needs the
   correction `(|ns . wo| |ng . wi|) / (|ng . wo| |ns . wi|)`. Known weakness (read in the ompf2
   thread and the Schüssler paper's search snippet): the factor is unbounded at grazing angles.
   Inference: a unidirectional path tracer with `TransportMode::Radiance` never needs it.
   - Thesis: https://graphics.stanford.edu/papers/veach_thesis/ (chapter 5:
     http://graphics.stanford.edu/papers/veach_thesis/chapter5.ps, full text
     http://graphics.stanford.edu/papers/veach_thesis/thesis.pdf)
   - pbrt-v3 §16.1.3 "Non-symmetry Due to Shading Normals":
     https://pbr-book.org/3ed-2018/Light_Transport_III_Bidirectional_Methods/The_Path-Space_Measurement_Equation
   - Reading notes: https://www.reedbeta.com/blog/reading-veach-thesis/
   - Veach's web page on non-symmetric scattering: https://graphics.stanford.edu/papers/non-symmetric/

2. **Reject / classify by the geometric normal (pbrt-v3).** `BSDF::f` evaluates reflection lobes
   only when `wi` and `wo` lie on the same side of `ng`, otherwise transmission lobes. With a
   purely reflective material a direction below the geometric horizon gives zero. Fact (read).
   - https://github.com/mmp/pbrt-v3/blob/master/src/core/reflection.cpp

3. **Fold (flip) the shading normal to the geometric side.** pbrt-v3 and pbrt-v4
   `SetShadingGeometry` (`FaceForward`), Mitsuba 3 `flip_invalid_normals` (which cites Schüssler
   et al. 2017 for the flipping rule applied to the perturbed normal). Fact (read). Inference:
   this keeps the hemispheres consistent in orientation but does not remove the terminator
   discontinuity.
   - https://github.com/mmp/pbrt-v4/blob/master/src/pbrt/interaction.h
   - https://mitsuba.readthedocs.io/en/latest/src/generated/plugins_bsdfs.html
   - https://github.com/mitsuba-renderer/mitsuba3/commit/e32d71807

4. **Bend (blend) the shading normal toward `ng` at grazing view angles (Falcor
   `adjustShadingNormal`, Iray).** Falcor: linear blend when `dot(V, Ns) <= 0.1`; off by default
   on secondary hits; breaks reciprocity (fact, read in the code). The Iray paper describes the
   same idea ("bend the shading normal ... such that the perfect reflection does not extend
   below the geometric tangent plane": from a search snippet of arXiv 1705.01263, not read in
   full).
   - https://github.com/NVIDIAGameWorks/Falcor/blob/master/Source/Falcor/Scene/Material/ShadingUtils.slang
   - https://github.com/NVIDIAGameWorks/Falcor/blob/master/Source/RenderPasses/PathTracer/PathTracer.h
   - Iray: https://arxiv.org/pdf/1705.01263

5. **Microfacet-based normal mapping (Schüssler, Heitz, Hanika, Dachsbacher, SIGGRAPH Asia
   2017, TOG 36(6), DOI 10.1145/3130800.3130806).** Fact (read in the abstract and in the
   related-work sections of Chiang 2019 and Hanika 2021): build a two-facet microsurface per
   shading point, the perturbed facet plus a tangent facet perpendicular to the geometric
   surface, so the average normal equals `ng`; the model is symmetric, energy conserving and
   works with any BRDF and with bidirectional methods; it needs a random walk for inter-facet
   scattering, and without it the extra facet over-darkens (Chiang 2019 Fig. 4).
   - Paper: https://cg.ivd.kit.edu/publications/2017/normalmaps/normalmap.pdf
   - Unity blog: https://unity.com/blog/technology/microfacet-based-normal-mapping-for-robust-monte-carlo-path-tracing

6. **Microfacet-based shadowing function for the bump terminator (Conty Estevez, Lecocq, Stein,
   Ray Tracing Gems 2019, chapter 12).** Fact (read in Chiang 2019 §2 and Hanika 2021 §4.2): an
   added GGX-style shadowing factor whose roughness is estimated from the deviation between
   `ns` and `ng`. Implemented in Mitsuba 3 (`use_shadowing_function`, on by default since
   v3.7.1). Note on the request's citation: "Estevez and Kulla 2019, A Robust Shadow Terminator"
   was not found; the matching 2019 work is this chapter (Estevez, Lecocq, Stein). Not
   confirmed that any paper with that exact title exists. The chapter text itself was not read
   (SpringerLink redirect); the formula is in the Mitsuba 3 header.
   - Chapter: https://link.springer.com/chapter/10.1007/978-1-4842-4427-2_12
   - Free book PDF: http://raytracinggems.com/unofficial_RayTracingGems_v1.9.pdf
   - NVIDIA talk video: https://developer.nvidia.com/siggraph/2019/video/sig933-vid
   - Mitsuba 3 implementation: https://github.com/mitsuba-renderer/mitsuba3/blob/master/src/bsdfs/normalmap_helpers.h

7. **"Taming the Shadow Terminator" (Chiang, Li, Burley, SIGGRAPH 2019 Talks, DOI
   10.1145/3306307.3328172).** Fact (read in the PDF): add a facet perpendicular to the primary
   (shading) facet; shadowing `G = min(1, <ng,wi> / (<ns,wi> <ng,ns>))`, then smoothed with
   `G' = -G^3 + G^2 + G`; `G = 1` whenever the light is on the geometric side of `ns`, so the
   look away from the terminator is unchanged; "production proven" at Disney. Compared against
   Estevez et al.: softer terminator.
   - https://media.disneyanimation.com/technology/publications/2019/TamingtheShadowTerminator.pdf

8. **"Hacking the Shadow Terminator" (Hanika, Ray Tracing Gems II, 2021, chapter 4).** Fact
   (read in the PDF): move only the shadow-ray origin onto a cheap surface built from the
   vertex normals, "closely related to quadratic Bezier surfaces but cheaper and more robust";
   the geometry and the material evaluation stay unchanged; not reciprocal; transmitted rays
   may need the offset flipped; creases from face-varying normals break the offset; "We only
   discussed shadow rays"; the bump terminator "persists even when using smooth base geometry"
   and still needs a microfacet-type fix. Hanika's §4.2 states that Conty et al.'s shadowing
   term "does not help on the diffuse surface" in his coarse-sphere test.
   - https://jo.dreggn.org/2021_terminator.pdf
   - Book: https://link.springer.com/book/10.1007/978-1-4842-7185-8

9. **"Predictable and Targeted Softening of the Shadow Terminator" (Deshmukh, Green,
   DreamWorks, SIGGRAPH 2020 Talks, DOI 10.1145/3388767.3407371).** Builds on the two above.
   Only the title and abstract were seen (search snippet); not read.
   - https://research.dreamworks.com/wp-content/uploads/2020/08/talk_shadow_terminator.pdf

10. **Smooth the geometry, not the normal: PN triangles and Phong tessellation.**
    - Curved PN triangles (Vlachos, Peters, Boyd, Mitchell, I3D 2001, pp. 159-166): one cubic
      Bezier patch per triangle from vertex positions and normals. Fact (read in search
      snippets). No PDF link was confirmed.
    - Phong tessellation (Boubekeur, Alexa, SIGGRAPH Asia 2008, DOI 10.1145/1409060.1409094):
      Phong normal interpolation applied to positions; quadratic, cheaper than PN triangles.
      https://perso.telecom-paristech.fr/boubek/papers/PhongTessellation/PhongTessellation.pdf
    - Direct ray tracing of Phong tessellation (Ogaki, Tokuyoshi, Square Enix, Computer Graphics
      Forum 2011, DOI 10.1111/j.1467-8659.2011.01993.x): "analytic solutions exist for the
      ray-Phong Tessellation intersection"; AABB overlap test, SAH kd-tree, normal smoothing.
      https://diglib.eg.org/items/1b1a00f1-d2c5-4f7a-88c2-dab96ddf29cc (returned HTTP 403 on
      the survey date; citation from search snippets).
    - Use in path tracers: no path tracer in this survey (pbrt, Mitsuba 3, Falcor, Cycles)
      was found to intersect Phong-tessellated or PN surfaces directly. Not confirmed for
      Arnold, RenderMan or other production renderers. Observed related practice: production
      renderers subdivide and displace before building the BVH (Arnold paper, search snippet;
      Embree subdivision geometry), Hanika 2021 moves only the shadow-ray origin onto a
      Bezier-like surface, and Cycles' Geometry Offset does the same (inference from the
      manual text "offsetting rays from the flat surface to match where they would be for a
      smooth surface").
    - Arnold paper: https://dl.acm.org/doi/fullHtml/10.1145/3182160
    - Embree subdivision: https://www.embree.org/api.html (section RTC_GEOMETRY_TYPE_SUBDIVISION)

## 3. Open items (not confirmed)

- Mitsuba 3 "sticky" shadow terminator: no such term found in docs, source headers read, or
  release notes. Next action: grep the Mitsuba 3 source tree locally for `sticky`.
- "Estevez and Kulla 2019, A Robust Shadow Terminator": no such paper found. The 2019 work by
  Conty Estevez is the Ray Tracing Gems chapter 12 with Lecocq and Stein.
- pbrt-v4 Veach correction: `bsdf.h` has none; whether `CorrectShadingNormal` survives anywhere
  else in pbrt-v4 was not checked (GitHub code search was unavailable in this session).
- OptiX programming guide text on spheres and curves: HTTP 503 twice; only the 7.5.0 release
  notes were read.
- Falcor analytic sphere: none found in the files read; the full scene code was not searched.
- Estevez 2019 chapter and Schüssler 2017 paper: read through secondary sources (Chiang 2019,
  Hanika 2021, Mitsuba 3 docs), not from the primary PDFs.

## 4. Other sources used

- Embree point geometry man page: https://man.archlinux.org/man/RTC_GEOMETRY_TYPE_POINT.4embree4.en
- Embree docs in the repository: https://github.com/RenderKit/embree/tree/master/doc/src/api
- OptiX 7.5 release thread: https://forums.developer.nvidia.com/t/optix-7-5-release/218032
- OptiX 7.5.0 release notes: https://developer.nvidia.com/optix/downloads/7.5.0/releasenotes
- Mitsuba 3 shapes: https://mitsuba.readthedocs.io/en/latest/src/generated/plugins_shapes.html
- Mitsuba 3 releases: https://github.com/mitsuba-renderer/mitsuba3/releases
- Mitsuba 3 sphere: https://github.com/mitsuba-renderer/mitsuba3/blob/master/src/shapes/sphere.cpp
- pbrt-v4 BSDF: https://github.com/mmp/pbrt-v4/blob/master/src/pbrt/bsdf.h
- pbrt-v4 shapes: https://github.com/mmp/pbrt-v4/blob/master/src/pbrt/shapes.h
- pbrt-v4 materials: https://github.com/mmp/pbrt-v4/blob/master/src/pbrt/materials.h
- pbrt-v4 normal and bump mapping, §10.5.3 and §10.5.4:
  https://pbr-book.org/4ed/Textures_and_Materials/Material_Interface_and_Implementations
- pbrt-v3 bump mapping §9.3: https://pbr-book.org/3ed-2018/Materials/Bump_Mapping
- ompf2 thread on the adjoint correction factor:
  https://c0de517e.com/EXTERNAL/ompf2/d61b18faca4da1177179c5802adde09fed86d450cb2ab378e8830b0fbd01ca9c.htm
- Cycles commit: https://lists.blender.org/pipermail/bf-blender-cvs/2021-June/159919.html
