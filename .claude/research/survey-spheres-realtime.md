# Survey: spheres and smooth shading normals in real-time / web ray tracing

Date: 2026-10-06. Scope: how real-time and web engines represent a sphere, and what they do with
interpolated (smooth) shading normals on a coarse triangle mesh when a reflection ray is traced.

Legend. **Fact**: read in a source listed under Sources. **Inference**: my reading of a fact; not
stated in the source. **Not confirmed**: I could not reach a source that states it.

Configurations read: three-gpu-pathtracer `main` at commit `5f0ad5154a44224ae4b6c801b65778471dabf367`
(cloned 2026-10-06); glTF-Sample-Viewer `21d581c837db8c51bb84f92e12c4b13f5f5263d4` with
glTF-Sample-Renderer `cc27919cacbb235d2f58a0c0203387efce9375f8`; three.js `dev` branch raw files;
Unity Graphics `master` raw files; Microsoft DirectX-Graphics-Samples `master` raw files.

## Table

| Engine / API | Sphere: analytic or mesh | Smooth shading default | Reflection direction from | Reflected ray under the triangle | Ray origin offset | User-facing flat option |
|---|---|---|---|---|---|---|
| three.js (raster) | Mesh only. `SphereGeometry(radius=1, widthSegments=32, heightSegments=16)`; vertex normal = normalized position (Fact). | Yes: `flatShading` default `false` (Fact). | Not ray traced. Env-map lookup uses the shading normal (`vNormal`), or `cross(dFdx, dFdy)` when `FLAT_SHADED` (Fact). | n/a | n/a | `material.flatShading` (Fact). |
| three-gpu-pathtracer (gkjohnson) | Mesh only, through three-mesh-bvh; no analytic sphere in the GLSL (Fact). Examples tessellate `SphereGeometry(0.49, 64, 32)` and `(0.4, 100, 50)` (Fact). | Yes: it reads the interpolated `ATTR_NORMAL`, unless `material.flatShading` is set, then uses `faceNormal * side` (Fact). | Shading normal. `surf.normalBasis = getBasisFromNormal(surf.normal)`; the GGX half vector is sampled in that basis and `-reflect(wo, halfVector)` is taken there (Fact). | **Reject.** `isDirectionValid(dir, surf.normal, surf.faceNormal)` returns false when the direction is on different sides of the two planes, and the path `break`s (the sample is dropped, black) (Fact). The same test gates NEE light samples (Fact). | `stepRayOrigin(origin, dir, +/-faceNormal, dist)`: `point + offset * (max|point| + 1) * RAY_OFFSET`, `RAY_OFFSET = 1e-4`. The sign follows `dot(scatterDir, faceNormal)` (geometric normal), so a transmitted ray starts on the back side (Fact). Issue #863 (open, 2026-09) reports that the NEE shadow ray then starts behind the surface and loses energy; the proposed fix always offsets the shadow-ray origin toward `faceNormal` (Fact). | `flatShading` from the three.js material is honoured (Fact). |
| Babylon.js | Mesh only. `CreateSphere` default `segments = 32`, diameter 1; vertex normal = position / radius, normalized (Fact). | Yes. `convertToFlatShadedMesh()` duplicates vertices to get one normal per face; `forceSharedVertices()` reverses it (Fact, forum and API text). | No hardware ray tracing in the engine. Reflections: IBL / reflection probes / screen-space SSR ray marching (Fact). Path tracers exist as community projects, not in the engine (Fact). | n/a | n/a | `mesh.convertToFlatShadedMesh()` (Fact). |
| Unreal Engine 5 (hardware RT, Lumen) | Mesh only: the HWRT page lists triangle-based geometry types only; Nanite traces its fallback mesh (Fact). | Yes (smooth normals come from the asset; not a renderer switch). | Lumen reflection rays start from the GBuffer; the GBuffer normal is the shading normal (Inference from the Lumen docs; not stated as such). | Not confirmed. No doc or source text found that says what UE does when the reflected vector goes under the triangle. | `r.RayTracing.NormalBias`, default `0.1`; a blog recommends `0.5` to remove dark spots in Lit mode; a forum describes it as the furthest the ray origin is biased from the surface along the normal (Fact: forum, blog). `r.RayTracing.Translucency.PrimaryRayBias = 0.00001` (Fact: forum). | None in the renderer. The "shadow terminator" fix is to add polygons; Epic's VSM page names the artifact and says "a normal-based bias to the shadow lookup" is the usual workaround (Fact). A `Shadow Terminator` project setting: **not confirmed** (not found). |
| Unity HDRP (DXR) | Mesh only: Mesh Renderers in the acceleration structure; no vertex animation, tessellation, VFX or terrain (Fact). | Yes (asset normals). | GBuffer normal: `DecodeFromNormalBuffer(...)` then `SampleGGXDir(...)` in the normal's frame, or `reflect(-viewWS, normalData.normalWS)` for the transparent path (Fact: `RaytracingReflections.raytrace`). | Not confirmed; no rejection or flip found in the lines read. | `Origin = positionWS + normalData.normalWS * rayBias`, with `rayBias` from `EvaluateRayTracingBias(positionWS)` (Fact). Volume `Ray Tracing Settings`: `Ray Bias` default `0.001`, `Distant Ray Bias` default `0.001`, interpolated by distance (Fact). Note: the offset is along the *shading* normal, not the geometric one (Fact from the code line). | None. `Ray Bias` / `Distant Ray Bias` only (Fact). |
| Godot 4 | Mesh only. `SphereMesh` default `radial_segments = 64`, `rings = 32` (Fact). `CSGSphere3D.smooth_faces` (Fact). | Yes; "primitive shapes are always smooth shaded" (Fact: forum). | No hardware ray tracing shipped: reflections from VoxelGI, SDFGI, ReflectionProbe, SSR (Fact). Vulkan RT plumbing landed in 4.7 dev builds; reflections "a ways away" (Fact: Phoronix). | n/a | n/a | `CSGSphere3D.smooth_faces`; none on `SphereMesh` (Fact). |
| Filament | Mesh only (no primitive library in the renderer; the user supplies vertex buffers). | Material key `interpolation`: `smooth` (default) or `flat` (Fact). | No ray tracing. `reflections: default` = IBL only, `screenspace` = SSR plus IBL (Fact). | n/a | n/a | `interpolation : flat` in the material (Fact). |
| Khronos glTF 2.0 + Sample Viewer | **No sphere primitive.** `mesh.primitive.mode` enum: 0 POINTS … 4 TRIANGLES (default), 5 TRIANGLE_STRIP, 6 TRIANGLE_FAN (Fact: schema). "When normals are not specified, the mesh primitive has implicit flat normals" (Fact: spec). | Yes when `NORMAL` is present: `ng = normalize(v_Normal)`; else `cross(dFdx(v_Position), dFdy(v_Position))` (Fact: `material_info.glsl`). | IBL: `reflect(-v, n)` with the shading normal `n` (Fact: `ibl.glsl`). No ray tracing. | n/a | n/a | None; omit `NORMAL` to get flat normals (Fact). |
| DXR (D3D12) | `D3D12_RAYTRACING_GEOMETRY_TYPE`: `TRIANGLES`, `PROCEDURAL_PRIMITIVE_AABBS`, `OMM_TRIANGLES` (Fact). No built-in sphere; a sphere is an AABB plus an intersection shader (Fact). NVIDIA Blackwell exposes LSS/spheres through NVAPI `NVAPI_D3D12_RAYTRACING_GEOMETRY_LSS_DESC` (Fact: NVAPI docs page title; contents not read). | n/a (the shader decides). | Microsoft sample `D3D12RaytracingProceduralGeometry`: `reflect(WorldRayDirection(), triangleNormal)` for the plane and `reflect(WorldRayDirection(), attr.normal)` for the analytic sphere, `attr.normal = normalize(hit - center)` (Fact). | n/a for the analytic sphere (the normal is exact). | Sample: no origin offset; `TMin` set near zero per comment, and the intersection shader rejects `t < RayTMin()` (Fact). | n/a |
| Vulkan RT | `VkGeometryTypeKHR`: `TRIANGLES_KHR`, `AABBS_KHR`, `INSTANCES_KHR`; plus `VK_GEOMETRY_TYPE_SPHERES_NV` and `LINEAR_SWEPT_SPHERES_NV` from `VK_NV_ray_tracing_linear_swept_spheres` (vendor, Blackwell) (Fact). GLSL `GL_NV_linear_swept_spheres` adds `gl_HitIsSphereNV`, `gl_HitSpherePositionNV`, `gl_HitSphereRadiusNV` (Fact). | n/a | nvpro `vk_raytracing_tutorial_KHR` reflections: interpolated vertex normal `nrm = v0.nrm*b.x + ...`, `rayDir = reflect(gl_WorldRayDirectionEXT, worldNrm)`, `origin = worldPos` (Fact). Sascha Willems: `origin = hitPos + normal * 0.001` (Fact). | Tutorials do nothing about it (Fact: code read). | `0.001` along the (shading) normal, or `tMin` (Fact). | n/a |

## Techniques seen, with sources

1. **Shading-normal reflection with geometric-normal validity test (reject).** three-gpu-pathtracer
   samples the BSDF in the shading-normal basis and drops any direction that is on opposite sides
   of the shading plane and the geometric plane. Comment in the source: "The discrepancy between
   interpolated surface normal and geometry normal can cause issues when a ray is cast that is on
   the top side of the geometry normal plane but below the surface normal plane. If we find a ray
   like that we ignore it to avoid artifacts." Cost: energy loss at grazing angles; issue #84
   "Black results at glancing angles" lists this as the cause. Sources:
   `src/shader/common/util_functions.glsl.js`, `src/materials/pathtracing/PhysicalPathTracingMaterial.js`
   (line 505), https://github.com/gkjohnson/three-gpu-pathtracer/issues/84.
2. **Origin offset along the geometric normal, scaled by magnitude.** three-gpu-pathtracer
   `stepRayOrigin`: `point + offset * (max|point| + 1) * 1e-4`, offset = +/-`faceNormal`. Unity
   HDRP offsets along the GBuffer (shading) normal by `Ray Bias` (0.001 default). Vulkan tutorials
   use `0.001` along the normal or `tMin`. Unreal uses `r.RayTracing.NormalBias` (0.1). The robust
   form is Wächter and Binder, "A Fast and Robust Method for Avoiding Self-Intersection" (Ray
   Tracing Gems, ch. 6, 2019): offset along the triangle normal by an integer-ulp amount
   proportional to the position magnitude; NVIDIA's DXR blog post repeats it. Sources:
   https://research.nvidia.com/publication/2019-03_fast-and-robust-method-avoiding-self-intersection,
   https://developer.nvidia.com/blog/solving-self-intersection-artifacts-in-directx-raytracing,
   https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/reference-ray-tracing-settings.html,
   https://raw.githubusercontent.com/Unity-Technologies/Graphics/master/Packages/com.unity.render-pipelines.high-definition/Runtime/RenderPipeline/Raytracing/Shaders/Reflections/RaytracingReflections.raytrace,
   https://forums.unrealengine.com/t/ray-tracing-variables-default-values-description-questions/130103,
   https://ddankhazi.com/2024/09/19/correct-ray-traced-and-path-traced-shadows-in-unreal-and-nanite/,
   https://www.saschawillems.de/blog/2019/04/27/vulkan-examples-for-ray-traced-shadows-and-reflections-using-vk_nv_ray_tracing/,
   https://raw.githubusercontent.com/nvpro-samples/vk_raytracing_tutorial_KHR/master/ray_tracing_reflections/shaders/raytrace.rchit.
3. **Shadow-terminator geometry offset (move the origin onto the implied smooth surface).**
   Blender Cycles "Geometry Offset" (default 0.1): "offsets rays from the flat surface to match
   where they would be for a smooth surface as specified by the normals"; "Shading Offset" bends
   the terminator instead and is not energy conserving. Hanika, "Hacking the Shadow Terminator"
   (Ray Tracing Gems II, ch. 4, 2021) analyses the same hack. Disney's "Taming the Shadow
   Terminator" (2019) and DreamWorks' "Predictable and Targeted Softening of the Shadow
   Terminator" (2020) add a shadowing function instead of moving rays. Sources:
   https://developer.blender.org/rB9c6a382, https://docs.blender.org/manual/en/latest/render/cycles/object_settings/object_data.html (page not read; cited by title),
   https://link.springer.com/chapter/10.1007/978-1-4842-7185-8_4,
   https://media.disneyanimation.com/technology/publications/2019/TamingtheShadowTerminator.pdf,
   https://research.dreamworks.com/wp-content/uploads/2020/08/talk_shadow_terminator.pdf.
4. **Microfacet-based normal mapping (make the shading normal physically consistent).**
   Schüssler, Heitz, Hanika, Dachsbacher 2017: two facets per shading point whose average equals
   the geometric normal; symmetric and energy conserving. Source:
   https://cg.ivd.kit.edu/publications/2017/normalmaps/normalmap.pdf.
5. **Analytic sphere by intersection shader (DXR / Vulkan AABB geometry).** Microsoft
   `D3D12RaytracingProceduralGeometry`: quadratic solve, `normal = normalize(hit - center)`,
   `reflect(WorldRayDirection(), attr.normal)`, hits with `t < RayTMin()` rejected. KDAB
   "hello_sphere_rt" is the same pattern on Vulkan. Sources:
   https://raw.githubusercontent.com/microsoft/DirectX-Graphics-Samples/master/Samples/Desktop/D3D12Raytracing/src/D3D12RaytracingProceduralGeometry/AnalyticPrimitives.hlsli,
   https://raw.githubusercontent.com/microsoft/DirectX-Graphics-Samples/master/Samples/Desktop/D3D12Raytracing/src/D3D12RaytracingProceduralGeometry/Raytracing.hlsl,
   https://docs.kdab.com/kdgpu/unstable/hello_sphere_rt.html,
   https://learn.microsoft.com/en-us/windows/win32/api/d3d12/ne-d3d12-d3d12_raytracing_geometry_type,
   https://microsoft.github.io/DirectX-Specs/d3d/Raytracing.html.
6. **Built-in hardware sphere primitive (vendor only).** `VK_NV_ray_tracing_linear_swept_spheres`
   (Blackwell) adds `VK_GEOMETRY_TYPE_SPHERES_NV`; D3D12 gets it through NVAPI. Not in core DXR 1.1/1.2
   or KHR Vulkan RT. Sources:
   https://github.khronos.org/Vulkan-Site/features/latest/features/proposals/VK_NV_ray_tracing_linear_swept_spheres.html,
   https://raw.githubusercontent.com/KhronosGroup/Vulkan-Docs/main/chapters/accelstructures.adoc,
   https://raw.githubusercontent.com/KhronosGroup/GLSL/main/extensions/nv/GLSL_NV_linear_swept_spheres.txt,
   https://developer.nvidia.com/blog/render-path-traced-hair-in-real-time-with-nvidia-geforce-rtx-50-series-gpus,
   https://docs.nvidia.com/nvapi/struct__NVAPI__D3D12__RAYTRACING__GEOMETRY__LSS__DESC.html.
7. **Flat shading as a user switch.** three.js `flatShading` (raster: `cross(dFdx, dFdy)`;
   path tracer: `faceNormal * side`); Babylon `convertToFlatShadedMesh()`; Filament
   `interpolation: flat`; Godot `CSGSphere3D.smooth_faces`; glTF: omit `NORMAL`. Sources:
   https://raw.githubusercontent.com/mrdoob/three.js/dev/src/renderers/shaders/ShaderChunk/normal_fragment_begin.glsl.js,
   https://raw.githubusercontent.com/mrdoob/three.js/dev/src/materials/MeshStandardMaterial.js,
   https://raw.githubusercontent.com/mrdoob/three.js/dev/src/geometries/SphereGeometry.js,
   three-gpu-pathtracer `src/materials/pathtracing/glsl/get_surface_record_function.glsl.js` (line 124),
   https://forum.babylonjs.com/t/reverse-flatshadedmesh/1566,
   https://app.unpkg.com/@babylonjs/core@8.12.1/files/Meshes/Builders/sphereBuilder.js,
   https://google.github.io/filament/Materials.md.html,
   https://raw.githubusercontent.com/godotengine/godot/master/doc/classes/SphereMesh.xml,
   https://forum.godotengine.org/t/flat-shading-godot-4/54272,
   https://raw.githubusercontent.com/KhronosGroup/glTF/main/specification/2.0/schema/mesh.primitive.schema.json,
   https://raw.githubusercontent.com/KhronosGroup/glTF/main/specification/2.0/Specification.adoc,
   glTF-Sample-Renderer `source/Renderer/shaders/material_info.glsl`, `ibl.glsl`.
8. **Add polygons.** Epic's Virtual Shadow Maps page: "The best way to address this is to
   increase the polygon count in affected geometry"; the same advice recurs in Houdini, Blender
   and Unreal forum threads. Sources:
   https://dev.epicgames.com/documentation/unreal-engine/virtual-shadow-maps-in-unreal-engine,
   https://www.sidefx.com/forum/topic/31385/.

## Engine notes and open points

- three-gpu-pathtracer, geometry: `trace_scene_function.glsl.js` calls `bvhIntersectFirstHit`
  and fills `faceNormal`, `barycoord`, `side`, `dist`; the only non-mesh hit is a fog volume
  particle, whose `faceNormal = -ray.direction` (Fact). There is no analytic sphere.
- three-gpu-pathtracer, side handling: `normal *= surfaceHit.side` flips the shading normal for
  back hits; `isTransmissiveRay = dot(dir, faceNormal * side) < 0` (Fact).
- three-gpu-pathtracer, open issue #863 (2026-09): the NEE shadow ray origin follows the scatter
  sample's side, so it starts behind the surface for dielectrics; the proposed fix always offsets
  the light-sample origin to the front side. Reported error 15-26 % down to 5-6 % (Fact: issue text).
- Unreal: `r.RayTracing.NormalBias` is confirmed by a forum listing of cvar defaults and a 2024
  blog; the official 4.26/4.27 settings page returned HTTP 403 and was not read. A UE "Shadow
  Terminator" project setting was **not found**; the term appears in Epic's VSM page as the name
  of the artifact. UE source was not read (private GitHub access not enabled in this session).
- Unity HDRP: the geometry-support list comes from a Unity forum answer, not the manual (Fact
  as forum text).
- Lumen: whether hit-lighting reflection rays use the Surface Cache normal or the material's
  shading normal at the hit: **not confirmed**.
- Babylon docs site (`doc.babylonjs.com`) was unreachable from this session (DNS); the API text
  for `convertToFlatShadedMesh` comes from forum quotes of it.
- Blender manual page for Cycles object settings returned only a table of contents; the Geometry
  Offset text is from the commit message `9c6a382`.
- "Hacking the Shadow Terminator" PDF is behind a Springer redirect; only the abstract page was read.

## What this means for a browser path tracer on a three.js-like scene graph (inference)

- Every surveyed web engine ships spheres as triangle meshes with smooth normals; none has an
  analytic sphere. A path tracer that reflects off the shading normal matches what three.js,
  the glTF viewer and HDRP do for the direction.
- The one web path tracer with the same scene graph (three-gpu-pathtracer) offsets the origin
  along the **geometric** normal (sign from the scatter direction) and **rejects** a direction
  that the two normals disagree on. HDRP instead offsets along the **shading** normal and does
  not reject. Both leave the shadow terminator on coarse meshes; only the Cycles "Geometry
  Offset" / Hanika hack moves the origin onto the implied smooth surface.
- `flatShading` is the only user switch any of them expose; it maps to "use `faceNormal`" in the
  path tracer.
