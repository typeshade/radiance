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
  QuadGeometry,
  Scene,
  SphereGeometry,
} from '@typeshade/radiance';

const scene = new Scene();
const floor = new Mesh(new QuadGeometry(6, 6), new DiffuseMaterial({ color: 0xbfbfbf }));
floor.rotation.x = -Math.PI / 2;
const lamp = new Mesh(new QuadGeometry(1.2, 1.2), new EmissiveMaterial({ intensity: 10 }));
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

Milestone **M1**: a compute megakernel path tracer renders the Cornell box (spheres and quads,
diffuse and mirror surfaces, an area light) progressively, and CI holds it to M1's acceptance:
two renders of one seed are bit-identical, and a 1024 spp render on WebGPU is within tolerance
of the CPU oracle's render of the same kernel. M2 brings triangle meshes, the BVH and glTF.

## Layout

| Path                         | What it is                                                                                                                                                                                                                 |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vendor/typeshade`           | The compiler, pinned as a git submodule. Every package is built on its public `typeshade/runtime` exports and nothing else.                                                                                                |
| `packages/radiance`          | `@typeshade/radiance`: the engine. The math, the scene graph, cameras, geometries, materials, `Scene`, and the `PathTracer` renderer. Its kernels in TypeShade under `src/kernels` (`trace.shade.ts`, `sampler.shade.ts`). |
| `packages/addons`            | `@typeshade/radiance-addons`: `OrbitControls` and the Cornell box scene.                                                                                                                                                   |
| `site/`                      | radiance.typeshade.dev: Starlight (the guide, the search, the API reference from the packages' JSDoc), the front page and the examples (`site/examples`), built by `bun run site` into `dist/site`.                        |
| `site/public/stills`         | One still per example, the picture a page shows before its canvas runs, with a `.sha256` the build checks. `bun run capture:stills` captures them.                                                                         |
| `scripts/boundary.mjs`       | The check that no package imports past `typeshade/runtime` or calls WebGPU itself.                                                                                                                                         |
| `scripts/gates/api.mjs`      | The api gate. `bun run bake:api-surface` (`scripts/bake-api-surface.ts`) writes the exports of each package to `packages/*/__api__/surface.md`. The gate fails when a fresh bake differs.                                  |
| `scripts/gates.mjs`          | The bounds CI holds the engine to. The site prints the same numbers.                                                                                                                                                       |
| `scripts/harness.mjs`        | The Cornell box in headless Chromium on SwiftShader, held to the oracle, and the site's Cornell box example under the mouse. Writes `.harness/cornell.png` and `.harness/site.png`.                                        |
| `scripts/oracle.ts`          | The path tracer's kernel on the compiler's CPU oracle.                                                                                                                                                                     |
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
bun run check           # format, prose, STE, boundary, API surface, shaders, host views and typecheck, tests
bun run gate:api        # the exports of each package equal packages/*/__api__/surface.md
bun run bake:api-surface # bake the exports again after an intended change to one of them
bun run harness         # the Cornell box on WebGPU and on the oracle, and the site (needs Chromium: npx playwright install chromium)
doorstop -e -F          # the traceability tree (pip install doorstop==3.2 once; reqs/README.md)
bun run site            # the site into dist/site; site:dev serves it while you edit
bun run capture:stills  # the examples' stills, after a change to what an example draws
```

CI (`.github/workflows/ci.yml`) runs the same steps, and on a pull request also what a move of
the compiler pin owes this repository (`compiler-bump`). `check:ste` runs the `asd-ste100` skill's
linter over every document. `traceability (Doorstop)` runs Doorstop over `reqs/`. Every push to `main` deploys the site
(`.github/workflows/deploy.yml`).

## License

Apache-2.0, as the compiler is.
