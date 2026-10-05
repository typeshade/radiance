# TypeShade Radiance

A reproducible, differentiable path-tracing renderer for the web, written in
[TypeShade](https://typeshade.dev).

A scene is assembled in TypeScript. The same kernels render it on WebGPU and are checked on the
CPU, so an image is the same wherever it is rendered; and the image can be differentiated with
respect to the scene's parameters, so a material, a light or a camera can be fitted to a
photograph in the browser. [`docs/plan.md`](docs/plan.md) is the plan: what the product is, what
it is not, how it is built in layers on the compiler's public runtime, and the milestones with
their acceptance criteria.

## Status

Milestone **M1**: a compute megakernel path tracer renders the Cornell box (spheres and quads,
diffuse and mirror surfaces, an area light) progressively, and CI holds it to M1's acceptance:
two renders of one seed are bit-identical, and a 1024 spp render on WebGPU is within tolerance
of the CPU oracle's render of the same kernel. M2 brings triangle meshes, the BVH and glTF.

Try it: [radiance.typeshade.dev](https://radiance.typeshade.dev/) renders the Cornell box on your
GPU (a browser with WebGPU: Chrome or Edge from version 113).

## Layout

| Path                         | What it is                                                                                                                  |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `vendor/typeshade`           | The compiler, pinned as a git submodule. Every package is built on its public `typeshade/runtime` exports and nothing else. |
| `packages/kernels`           | `@typeshade/radiance-kernels`: the GPU kernels in TypeShade (`trace.shade.ts`, the path tracer; `sampler.shade.ts`).        |
| `packages/scene`             | `@typeshade/radiance-scene`: materials, shapes and the camera, packed into the kernels' buffers; the Cornell box.           |
| `packages/render`            | `@typeshade/radiance-render`: the progressive renderer (frames, accumulation, readback, the displayed image).               |
| `scripts/boundary.mjs`       | The check that no package imports past `typeshade/runtime` or calls WebGPU itself.                                          |
| `scripts/harness.mjs`        | The Cornell box in headless Chromium on SwiftShader, held to the oracle; writes `.harness/cornell.png`.                     |
| `scripts/oracle.ts`          | The path tracer's kernel on the compiler's CPU oracle.                                                                      |
| `site/`                      | The demo page, built by `bun run site` and served at radiance.typeshade.dev (`wrangler.jsonc`, `deploy.yml`).               |
| `scripts/shade-plugin.ts`    | The `*.shade.ts` loader for `bun build` (`scripts/bundle.ts`), from the compiler's Vite plugin.                             |
| `docs/plan.md`               | The plan and the milestones.                                                                                                |
| `docs/typeshade-feedback.md` | Field notes on using TypeShade here, the input for feedback to the language.                                                |
| `compiler-changes.md`        | The compiler proposals this repository has handled when the pin moved.                                                      |

Later milestones add `packages/fit`, `packages/procedural`, `packages/sim` and
`packages/realtime`, as the plan lays out.

## Checks

```sh
bun install
bun run check     # format, prose, boundary, shaders, host views and typecheck, tests
bun run harness   # the Cornell box on WebGPU and on the oracle, and the demo page (needs Chromium: npx playwright install chromium)
bun run site      # the demo page into dist/site
```

CI (`.github/workflows/ci.yml`) runs the same steps, and on a pull request also what a move of
the compiler pin owes this repository (`compiler-bump`). Every push to `main` deploys the demo
page (`.github/workflows/deploy.yml`).

## License

Apache-2.0, as the compiler is.
