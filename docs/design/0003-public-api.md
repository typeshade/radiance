---
id: '0003'
title: The public API is a baked surface with three.js's names, versioned by SemVer with the minor as the breaking position, and released through gates
status: accepted
milestones: [M2, 0.1.0]
touches:
  - packages/radiance/src/index.ts
  - packages/radiance/package.json
  - packages/addons/src/index.ts
  - packages/addons/package.json
  - packages/*/__api__
  - scripts/bake-api-surface.ts
  - CHANGELOG.md
  - RELEASING.md
  - docs/compatibility.md
  - .github/workflows/publish.yml
compiler: []
---

**Document control**

| Field         | Value                                                                                                                              |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Identity      | Design record 0003, status `draft`                                                                                                 |
| Date          | 2026-10-05 (UTC), the date of authorship                                                                                           |
| Author        | Written in a Claude Code session for the owner. The owner's review is the approval                                                 |
| Applicability | `@typeshade/radiance` and `@typeshade/radiance-addons`, 0.0.0 today, 0.1.0 as the first release. The release version is unassigned |
| Baseline      | `main` at 0f17f5e. The compiler pinned at e923a34                                                                                  |
| Pull request  | typeshade/radiance#6, the pull request that carries this record and is its review                                                  |

## What changes

### Before

`packages/radiance/src/index.ts` exports 29 names, types included, among them `packScene`, `cameraUniforms`,
`PackedScene` and `CameraUniforms`, which are the renderer's internals that `scripts/oracle.ts`
reaches through the package. Nothing records the surface, so a removed export is found by a
consumer. The version is 0.0.0, nothing is published, and the site's install section says so.
There is no changelog, no release procedure and no statement of which compiler a version runs
on.

### After

**What is public.** The `.` subpath of each package is the public API, and nothing else is: a
name that `src/index.ts` exports. The renderer's internals that scripts need (`ScenePack`, the
layout constants, `limits`) are exported from a second subpath, `@typeshade/radiance/internal`,
which the surface bake leaves out and which carries no stability promise, as the compiler's
`typeshade/runtime/internal` does. `scripts/oracle.ts` imports it.

**The surface bake.** `bun run bake:api-surface` writes `packages/radiance/__api__/surface.md`
and `packages/addons/__api__/surface.md`: one line per exported name with its kind and its
type as TypeScript prints it, generated from the TypeScript program, never edited by hand.
`scripts/gates/api.mjs` (record 0002) fails when the bake and the tree disagree. A pull request
that changes the surface commits the re-bake, and the diff is the review.

**Names.** The rule, for every public name:

1. A thing three.js has takes three.js's name and parameter order: the math (`Vector3`,
   `Matrix4`, `Euler`, `Box3`, `Color`), the scene graph (`Object3D`, `Scene`, `Mesh`,
   `Group`), the cameras (`PerspectiveCamera(fov, aspect)`), the geometries
   (`BufferGeometry`, `SphereGeometry(radius, widthSegments, heightSegments)`,
   `PlaneGeometry(width, height)`, `BoxGeometry(width, height, depth)`), the loader
   (`GLTFLoader`), the controls (`OrbitControls`), the renderer's shape
   (`setSize`, `setPixelRatio`, `setAnimationLoop`, `render(scene, camera)`, `dispose`).
2. A material or a light takes the physically based renderer's word, Cycles' or Mitsuba's,
   because that is the product: `DiffuseMaterial`, `MirrorMaterial`, `EmissiveMaterial`,
   `PhysicalMaterial` (record 0004), later `PointLight`, `SpotLight`, `SunLight`,
   `Environment`. Its parameters take three.js's names where the meaning is the same:
   `color`, `emissive`, `emissiveIntensity`, `roughness`, `metalness`, `ior`, `transmission`,
   `map`, `normalMap`, `roughnessMap`, `metalnessMap`, `emissiveMap`, `specularIntensity`.
3. A thing neither has takes the name the plan uses: `PathTracer`, `samplesPerFrame`,
   `maxSamples`, `watchdogBudget`, `readRadiance`. Amendment 1 adds `Sphere`, the analytic
   sphere, because three.js has no such object.

So `QuadGeometry` becomes `PlaneGeometry` (record 0001), and nothing else is renamed at 0.1.0.

**Constructor shapes.** A geometry and a camera take positional numbers with defaults, as
three.js's do. A material and a renderer take one parameters object with defaults. A class
exposes `version` where record 0001 needs it, and nothing is a getter that allocates.

**Versions.** Both packages share one version and move together. Semantic Versioning 2.0.0 with
the minor as the breaking position before 1.0.0, as the compiler's Rule 13.9 has it: a breaking
change ships only in a new `0.N.0`, and a `0.N.P` only fixes and adds. A change is breaking
when a program that worked stops working or renders differently: an export removed or
reshaped, a default that moves, a kernel change that moves a picture outside the render gate's
tolerance. A faster render of the same picture is not breaking.

**Deprecation.** A public name that will go carries `@deprecated` in its JSDoc for one minor,
naming its replacement, and logs one `console.warn` at its first use in a session. The next
minor removes it. Before 1.0.0 a removal takes that one minor. From 1.0.0 it takes a major.

**The changelog.** `CHANGELOG.md` in the Keep a Changelog form the compiler uses, with
`## [Unreleased]` on top and `### Added`, `### Changed`, `### Fixed`, `### Removed`. A
breaking entry names the edit a user makes. `scripts/changelog.test.ts` holds the headings and
the rule that a release with a `Changed` or `Removed` entry bumps the minor.

**The compiler.** `peerDependencies.typeshade` names the published range the engine is written
against, `^0.N` where `N` is the minor of the version the pin corresponds to. Until the
compiler's first release the pin is a commit and the peer range is `*`, as today.
`docs/compatibility.md` is one table: engine version, compiler version, pin commit, the date.
A pin that moves across a compiler minor is a row and an engine minor.

**The release.** `RELEASING.md` is the compiler's procedure with the engine's names: a version
bump and a changelog entry in one pull request. The gates locally. The tag `v<version>`. A
GitHub release, whose `publish.yml` runs `ci.yml`'s jobs, builds, packs both tarballs, installs
them into a scratch project beside the compiler's tarball, renders `first-scene` there on
headless WebGPU (record 0002, `journeys`), and publishes both with provenance. The
`NPM_ACCESS_TOKEN` organisation secret the owner named is the credential. Trusted publishing
does not authenticate a repository created after 2026-07-15 (`vendor/typeshade/RELEASING.md`,
section 0), and this one was created in October 2026.

**What ships.** `src/` as written, with the `.shade.ts` modules and their host views, so the
consumer's Vite plugin compiles the kernels as the site does. A consumer without the plugin gets
the sentence the compiler gives (surface §64). Whether to ship compiled manifests beside the
sources is open (decisions, item 6).

**What is true before 0.1.0.** M2 is implemented (record 0001, step 5), the surface is baked,
the five gates of record 0002 steps 1 to 5 run in CI, the site's install section shows the
real command, and the first benchmark row exists.

## Why

- Nothing holds the surface today, and the engine is about to grow a loader, a material model
  and a benchmark. The compiler's `src/__api__/surface.md` and `api-surface.test.ts` are the
  pattern, and they caught the drift the engine will otherwise ship.
- three.js's names are the owner's decision (plan §12, item 4) and the reason a user can read
  an example without the guide. The one place the rule bends, materials, is the one place the
  product differs from three.js on purpose.
- The compiler's version rules are written and tested. The engine on a pre-1.0 compiler needs
  the same rules, and a reader of both should meet one set.
- A version with no compatibility table is a version a user cannot install against the right
  compiler.

Alternatives considered: one package instead of two (addons would carry the loader's and the
controls' code into every bundle). Independent versions for the two packages (a consumer
would pin two numbers that must agree). A wider peer range than one minor (the compiler is
pre-1.0 and its minor is the breaking position).

## What it touches

- `packages/radiance/src/index.ts` (the export list below), `packages/radiance/src/internal.ts`
  (new), both `package.json` files (`exports`, `version`, `peerDependencies`, `files`).
- `scripts/bake-api-surface.ts` (new), `packages/*/__api__/surface.md` (generated).
- `CHANGELOG.md`, `RELEASING.md`, `docs/compatibility.md` (new), `scripts/changelog.test.ts`.
- `.github/workflows/publish.yml` (new). `README.md` (Checks, Install). The site's install
  section (`site/src/i18n/en.ts`) and the guide's getting-started page.
- Record 0001 (the renames), record 0002 (`api`, `bundle`, `journeys`).

**The public surface at 0.1.0**, `@typeshade/radiance`:

- math: `Vector3`, `Color`, `Euler`, `Matrix4`, `Box3`.
- core: `Object3D`, `Group` (new: an `Object3D` with nothing added, as three.js has it), `EventDispatcher`, `Clock`.
- cameras: `Camera`, `PerspectiveCamera`.
- geometries: `Geometry`, `BufferGeometry`, `SphereGeometry`, `PlaneGeometry`, `BoxGeometry`.
- materials: `Material` (with `flatShading`, Amendment 1), `MaterialParameters` (with `flatShading`), `DiffuseMaterial`, `MirrorMaterial`,
  `EmissiveMaterial`, `PhysicalMaterial`, `PhysicalMaterialParameters`.
- objects: `Mesh`, `Sphere(radius, material)` (Amendment 1), `Scene`.
- renderers: `Renderer`, `PathTracer`, `PathTracerParameters`, `TARGET_FORMAT`, `CANVAS_FORMAT`.

`@typeshade/radiance-addons`: `OrbitControls`, `OrbitControlsEvents`, `GLTFLoader`,
`createCornellBox`, `CornellBox`, and the differential scenes of record 0002.

Removed from the surface: `packScene`, `cameraUniforms`, `PackedScene`, `CameraUniforms`
(to `internal`), `QuadGeometry` (renamed).

## Implementation, in steps

1. **The bake and the gate.** `scripts/bake-api-surface.ts`, the two `surface.md` files,
   `scripts/gates/api.mjs` with its probe, in `check`. Done when the bake matches the tree and
   the probe fails.
2. **The internal subpath and the names.** `internal.ts`, the `exports` map, `oracle.ts` on
   `internal`. `QuadGeometry` to `PlaneGeometry` with the deprecation shim for one minor
   (it is 0.0.0, so the shim may be skipped, the owner decides, item 5). Done when the surface
   bake shows the list above minus what M2 adds.
3. **The changelog and the compatibility table.** `CHANGELOG.md` with the entries since M1,
   `scripts/changelog.test.ts`, `docs/compatibility.md` with the one row (0.0.0, pin e923a34).
4. **The release pipeline.** `RELEASING.md`, `publish.yml` with a dry run, the `journeys` gate
   (record 0002, step 8). Done when a dry run of the workflow passes on `main`.
5. **0.1.0.** After record 0001 step 5: the version bump, the changelog, the tag, the release,
   the install section on the site.

## Decisions for the owner

1. Two packages, one version, moving together.
2. The naming rule: three.js for what three.js has, the physically based renderer's word for
   materials and lights, with three.js's parameter names.
3. SemVer with the minor as the breaking position before 1.0.0, as the compiler has it.
4. The peer range is one compiler minor. The compatibility table is one row per pin.
5. `QuadGeometry` is renamed without a shim, since nothing is published.
6. Open: whether 0.1.0 ships compiled manifests beside the `.shade.ts` sources, so a consumer
   without the Vite plugin can still load the kernels. The plugin is the compiler's documented
   path. Shipping manifests doubles what the package carries. The record proposes sources only
   at 0.1.0 and a manifest subpath when a consumer asks.

## Record

**Approval and plan record.** Accepted on 2026-10-05 (UTC). The owner approved the merge of typeshade/radiance#6 in the conversation, which merged this record as `draft` at 9e8b479. The owner then said to implement the records with Opus 5.5 and Sonnet 5.5, and that go-ahead is the acceptance. Every entry of "Decisions for the owner" stands as proposed. Entry 6 stays open: the record's proposal, sources only at 0.1.0, applies until the owner decides.

**Amendment 1** (2026-10-06, UTC). Record 0001, Amendment 3, adds one object class, the analytic
sphere `Sphere`. Record 0004, Amendment 3, adds one member of `Material`, `flatShading`. A new export
or a new member is a change to this surface (`docs/design/README.md`, the criterion "exports"), so
this record lists both. The merge of the pull request that carries this amendment is the owner's
acceptance. It changes three places: the naming rule 3, the list of objects, and the list of
materials under "The public surface at 0.1.0". The decisions keep their numbers and their text.

- **The name.** The owner's decision of 2026-10-06: `Sphere`, as pbrt and Mitsuba name the shape.
  Rule 1 does not apply to the object, because three.js has no analytic sphere object. Rule 3
  applies. Fact: three.js has a class `Sphere` too, a bounding sphere in its math. This package
  exports no such class, and its math list is `Vector3`, `Color`, `Euler`, `Matrix4` and `Box3`. A
  program ported from three.js that imports `Sphere` for a bounding sphere finds a different
  class. Inference: the name is rare in a scene. The record does not rename it.
- **The shape.** Decided by default: `new Sphere(radius, material)` extends `Object3D`, as `Mesh`
  does, with `radius` and `material` as plain properties and `isSphere` true. Rule "Constructor
  shapes" says a geometry takes positional numbers and a material takes a parameters object. A
  `Sphere` is an object and not a geometry, and it takes its two parts positionally, as `Mesh`
  does. The class has no `version`. Record 0001, "The analytic sphere", states the rest.
- **The flag.** Decided by default: `Material.flatShading` is a boolean accessor, default false,
  and `MaterialParameters.flatShading` is an optional boolean. The name is three.js's. Record 0004
  states the rest.
- **The surface bake.** The pull request of record 0001, step 7, commits the bake with `Sphere`
  added. The pull request of step 9 commits it with the two members of `flatShading` added.
  `gate:api` fails on any other change.

**Configuration and validation record.** This record does not yet apply. Implementation will
record the bake's first commit, the dry run's workflow run id, and the 0.1.0 release's tag,
tarball sizes and registry record.
