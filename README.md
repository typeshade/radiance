# TypeShade Radiance

A reproducible, differentiable path-tracing renderer for the web, written in
[TypeShade](https://typeshade.dev).

A scene is assembled in TypeScript. The same kernels render it on WebGPU and are checked on the
CPU, so an image is the same wherever it is rendered. And the image can be differentiated with
respect to the scene's parameters, so a material, a light or a camera can be fitted to a
photograph in the browser. [`docs/plan.md`](docs/plan.md) is the plan: what the product is, what
it is not, how it is built in layers on the compiler's public runtime, and the milestones with
their acceptance criteria.

## Use it

```ts
import {
  DiffuseMaterial,
  EmissiveMaterial,
  Mesh,
  PathTracer,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SphereGeometry,
} from '@typeshade/radiance';

const scene = new Scene();
const floor = new Mesh(new PlaneGeometry(6, 6), new DiffuseMaterial({ color: 0xbfbfbf }));
floor.rotation.x = -Math.PI / 2;
const lamp = new Mesh(new PlaneGeometry(1.2, 1.2), new EmissiveMaterial({ intensity: 10 }));
lamp.position.set(0, 2.2, 0);
lamp.rotation.x = Math.PI / 2;
const ball = new Mesh(new SphereGeometry(0.5), new DiffuseMaterial({ color: 0xe8703a }));
ball.position.set(0, 0.5, 0);
scene.add(floor, lamp, ball);

const camera = new PerspectiveCamera(40, canvas.clientWidth / canvas.clientHeight);
camera.position.set(0, 1.4, 3.6);
camera.lookAt(ball.position);

const renderer = await new PathTracer({ canvas }).init();
renderer.setSize(canvas.clientWidth, canvas.clientHeight);
renderer.setAnimationLoop(() => renderer.render(scene, camera));
```

The engine is a set of classes in three.js's shape, on the compiler's public program runtime
(`typeshade/runtime`). Its GPU code is TypeShade, as three.js's is TSL. The site,
[radiance.typeshade.dev](https://radiance.typeshade.dev/), has the guide, the examples (each
runs the code it shows, on your GPU: a browser with WebGPU) and the API reference.

The packages are not published yet: build them from this repository until the first release.

## Status

Milestone **M1** is done: a compute megakernel path tracer renders the Cornell box
progressively, and CI holds it to M1's acceptance. Two renders of one seed are bit-identical,
and a 1024 spp render on WebGPU is within tolerance of the CPU oracle's render of the same
kernel. Milestone **M2** is in progress. The kernel draws triangle meshes through a two-level
BVH, behind the material record and the shading contract (design records 0001 and 0004). The
`GLTFLoader` reads `.gltf` and `.glb` files, and the `bunny` example draws the Stanford bunny from
one. The `sponza` example draws the Sponza atrium without its textures. `bun run bench` measures the
speed of each scene, and `docs/benchmarks.md` holds the rows.

## Layout

| Path                         | What it is                                                                                                                                                                                                                 |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vendor/typeshade`           | The compiler, pinned as a git submodule. Every package is built on its public `typeshade/runtime` exports and nothing else.                                                                                                |
| `packages/radiance`          | `@typeshade/radiance`: the engine. The math, the scene graph, cameras, geometries, materials, `Scene`, and the `PathTracer` renderer. Its kernels in TypeShade under `src/kernels` (`trace.shade.ts`, `sampler.shade.ts`). |
| `packages/addons`            | `@typeshade/radiance-addons`: `OrbitControls`, `GLTFLoader`, the Cornell box scene and the differential scenes.                                                                                                            |
| `site/`                      | radiance.typeshade.dev: Starlight (the guide, the search, the API reference from the packages' JSDoc), the front page and the examples (`site/examples`), built by `bun run site` into `dist/site`.                        |
| `site/public/stills`         | One still per example, the picture a page shows before its canvas runs, with a `.sha256` the build checks. `bun run capture:stills` captures them.                                                                         |
| `scripts/boundary.mjs`       | The check that no package imports past `typeshade/runtime` or calls WebGPU itself.                                                                                                                                         |
| `scripts/gates/api.mjs`      | The api gate. `bun run bake:api-surface` (`scripts/bake-api-surface.ts`) writes the exports of each package to `packages/*/__api__/surface.md`. The gate fails when a fresh bake differs.                                  |
| `scripts/gates/site.mjs`     | The site gate. `bun run gate:site` builds the site from the tree with `bun run site`, so the build checks the hash of each still. It fails when the build exits with a code other than 0.                                  |
| `scripts/gates.mjs`          | The bounds CI holds the engine to. The site prints the same numbers.                                                                                                                                                       |
| `scripts/harness.mjs`        | The differential scenes and every example in headless Chromium on SwiftShader, held to their gates and probes. The site's Cornell box example runs under the mouse. Writes `.harness/cornell.png` and `.harness/site.png`. |
| `scripts/bench.mjs`          | The benchmark. It prints a row of triangles, BVH time, frame time and paths a second for each scene. `docs/benchmarks.md` holds the rows.                                                                                  |
| `scripts/gates/`             | One module for each gate: `differential.mjs`, `determinism.mjs` and `render.mjs`. Each exports `run()` and `probe()`. `_browser.mjs` and `_png.mjs` are shared by the gates and the harness.                               |
| `scripts/__goldens__`        | One PNG for each example, 96 x 64 at 64 samples a pixel. The render gate holds the example's picture to it. `UPDATE_GOLDENS=1 bun run gate:render` rewrites them.                                                          |
| `site/public/assets`         | The assets the examples load, such as `bunny.glb` and `sponza.glb`. `LICENSES.md` lists the source, the licence and the SHA-256 of each one.                                                                               |
| `scripts/assets`             | One script for each asset. The script builds the file again from its public source (`node scripts/assets/bunny.mjs --check`).                                                                                              |
| `scripts/scenes.ts`          | The scene table. The harness page and the oracle build each scene from it. It holds the Cornell box and the scenes `triangles`, `instances` and `lights`.                                                                  |
| `scripts/oracle.ts`          | The path tracer's kernel on the compiler's CPU oracle, over the same scene pack the renderer uploads. It splits the frame over up to four processes (`RADIANCE_ORACLE_JOBS`).                                              |
| `scripts/shade-plugin.ts`    | The `*.shade.ts` loader for `bun build` and `bun test`, from the compiler's Vite plugin.                                                                                                                                   |
| `DESIGN.md`, `PRODUCT.md`    | The site's design system (Vapor UI's tokens) and its product brief, read by the design skills under `.claude/skills`.                                                                                                      |
| `docs/plan.md`               | The plan and the milestones.                                                                                                                                                                                               |
| `docs/design/`               | The design records: the scene data model, the gates, the public API, materials, determinism and what the engine asks of the compiler. A change to one of those starts there (`docs/design/README.md`).                     |
| `reqs/`                      | The Doorstop traceability tree of the design records and their decisions, derived by `bun run reqs:sync` (`reqs/README.md`).                                                                                               |
| `.agents/skills/asd-ste100`  | The ASD-STE100 writing skill the documents follow (`CLAUDE.md`, Writing and configuration management). `scripts/check-ste.mjs` runs its linter.                                                                            |
| `docs/typeshade-feedback.md` | Field notes on using TypeShade here, the input for feedback to the language.                                                                                                                                               |
| `compiler-changes.md`        | The compiler proposals this repository has handled when the pin moved.                                                                                                                                                     |

Later milestones add `packages/fit`, `packages/procedural`, `packages/sim` and
`packages/realtime`, as the plan lays out.

## Checks

```sh
bun install
bun run check           # format, prose, STE, boundary, API surface, site build, shaders, host views and typecheck, tests
bun run gate:api        # the exports of each package equal packages/*/__api__/surface.md
bun run gate:site       # the site builds from the tree into dist/site, with the hash of each still checked
bun run bake:api-surface # bake the exports again after an intended change to one of them
bun run harness         # the gates and their probes on WebGPU, and the site (needs Chromium: npx playwright install chromium)
bun run bench           # the speed of each scene, one row each, for docs/benchmarks.md (no bound)
bun run gate:differential  # one gate alone: the Cornell box on WebGPU and on the oracle (add `-- <scene>` for another scene)
bun run gate:determinism   # one gate alone: two renders of one seed are bit-identical
bun run gate:render        # one gate alone: each example's picture is within tolerance of its golden
UPDATE_GOLDENS=1 bun run gate:render  # rewrite the goldens after an intended change to a picture
doorstop -e -F          # the traceability tree (pip install doorstop==3.2 once; reqs/README.md)
bun run site            # the site into dist/site; site:dev serves it while you edit
bun run capture:stills  # the examples' stills, after a change to what an example draws
RADIANCE_GPU=1 bun run capture:stills  # the same on this machine's GPU instead of SwiftShader
```

A gate shows that it can fail before it is trusted to pass: the harness runs each gate's `probe()`.
The probes of `gate:api` and `gate:site` need no browser, so `bun run test` runs them.

The goldens change only on purpose. Run `UPDATE_GOLDENS=1 bun run gate:render`, look at each old and new picture, and commit the PNGs. The pull request shows both pictures of each one.

A still of the triangle kernel takes about 45 minutes on SwiftShader and seconds on a GPU. The
workflow `capture stills` (`.github/workflows/capture-stills.yml`) captures them on a self-hosted
runner with the label `gpu`, on request from the Actions tab, and pushes the changed stills to the
branch it ran on. It is not a required check. Its `examples` input names the example ids to
capture, and an empty input captures every one.

CI (`.github/workflows/ci.yml`) runs the same steps, and on a pull request also what a move of
the compiler pin owes this repository (`compiler-bump`). `check:ste` runs the `asd-ste100` skill's
linter over every document. `traceability (Doorstop)` runs Doorstop over `reqs/`. Every push to `main` deploys the site
(`.github/workflows/deploy.yml`).

## License

Apache-2.0, as the compiler is.
