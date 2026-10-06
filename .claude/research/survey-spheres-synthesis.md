# Spheres and shading normals in other renderers: synthesis (2026-10-06)

Sources: survey-spheres-offline.md, survey-spheres-research.md, survey-spheres-realtime.md
(each fact there carries a URL and a read / inferred / not confirmed label).

## 1. Who has an analytic sphere

- Yes: pbrt (v3, v4), Mitsuba 3 ("always preferred over triangle approximations"), Embree
  (RTC_GEOMETRY_TYPE_SPHERE_POINT), OptiX 7.5+, Mantra (quadric), RenderMan RIS (RiSphere, not XPU),
  V-Ray (VRaySphere), Arnold core (`sphere` node, but USD import makes a 10-slice polymesh),
  Cycles only for point clouds (3.1+), Karma only as points "Render Points As: sphere".
- No: three.js, three-gpu-pathtracer, Babylon, Godot, Filament, glTF (triangles only), Unreal and
  Unity hardware ray tracing, DXR and Vulkan core (an intersection shader over an AABB is the way;
  NVIDIA Blackwell adds a vendor sphere primitive).

## 2. What they do with interpolated shading normals on a triangle mesh

Every engine computes the reflection direction from the interpolated shading normal (ns), not the
face normal (ng). The difference is what happens when the result goes under the face:

1. Reject the sample (three-gpu-pathtracer `isDirectionValid`, radiance's old under-ng rule):
   black at grazing angles, energy lost.
2. Fold the direction back above ng (pbrt-v4 FaceForward, Mitsuba 3.7.1 flip_invalid_normals,
   radiance record 0004 Amendment 2): no energy lost, a small bias.
3. Bend the normal so the reflection is valid (Iray / Keller 2017, Cycles ensure_valid_reflection
   "Bump Map Correction", Redshift "Keller"): same goal as 2, done on the normal.
4. Soften the terminator with a shadowing term (Chiang/Li/Burley 2019 in Cycles 2.82 and
   Mitsuba 3.7.1, Estevez/Lecocq/Stein 2019, DreamWorks 2020): fixes the hard shadow edge on
   coarse meshes.
5. Move the shading point or shadow-ray origin onto the implied smooth surface (Mantra smoothP,
   Hanika 2021, Cycles 3.0 "Geometry Offset", Redshift shadow ray biasing): hides the facets in
   shadows, not in reflections.
6. Two-facet microfacet model (Schüssler 2017): symmetric and energy conserving, no production
   renderer documents adopting it.

None of these makes a reflection in a coarse mesh a reflection in a sphere. The position stays on
the facet. Vendors say so: Cycles' Geometry Offset commit recommends subdivision instead, Karma
and Redshift and RenderMan XPU recommend Catmull-Clark at render time, Mitsuba recommends the
analytic sphere.

## 3. Phong tessellation and PN triangles

Smoothing the geometry (not just the normal) exists (Boubekeur/Alexa 2008, Vlachos 2001), and a
2011 paper intersects Phong tessellation analytically. No surveyed path tracer does it. Production
renderers subdivide or displace before building the BVH instead.

## 4. What this means for radiance

- Radiance today = triangles, interpolated ns for reflection, fold rule (0004 Amendment 2, kernel
  step 7 pending). That is the same family as pbrt-v4 and Mitsuba 3.7.1. Not an outlier.
- The Cornell box mirror ball on a 64x32 mesh is what every mesh-based engine shows: smooth
  reflection on a faceted position field. Three.js users see the same.
- A perfect sphere needs an analytic primitive. Every research renderer has one. Production ones
  have one or recommend subdivision. Vendor GPU APIs lack one, so it is a custom intersection in
  the kernel (a quadratic), as pbrt does. The CPU oracle gets the same code.
- Flat shading as an option exists in three.js (`flatShading`), Filament, Godot CSG, Babylon
  (convertToFlatShadedMesh). Nobody uses it for a mirror ball. It is a visual-honesty switch.

## 5. Options, with what the survey says about each

A. Keep the mesh and the fold (current). Standard. Facet artefacts in curved mirrors stay.
B. Add a terminator shadowing term (Chiang 2019) and a shadow-ray offset (Hanika 2021): the
   production fixes for coarse meshes, affects diffuse shading and shadows, not mirror
   reflections. Record 0004 amendment, kernel and oracle.
C. Add an analytic sphere primitive: the research-renderer answer, exact ng = ns, no mismatch.
   Record 0001 (a new primitive kind in the buffers and the BVH leaf), 0004 (ns = ng), the
   oracle, and determinism (a quadratic is deterministic). Plan M6 names SDF; an analytic sphere
   is simpler and can come first.
D. `flatShading` switch: honest facets, cheap, record 0004 one line.
