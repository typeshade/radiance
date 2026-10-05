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

Milestone **M0**: the repository, the compiler pin, the boundary check, and a harness that draws
one frame on a real WebGPU device in CI and holds it to a golden. Nothing is rendered yet; M1 is
the first path tracer (a Cornell box).

## Layout

| Path                         | What it is                                                                                                                  |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `vendor/typeshade`           | The compiler, pinned as a git submodule. Every package is built on its public `typeshade/runtime` exports and nothing else. |
| `packages/render`            | `@typeshade/radiance-render`: the progressive renderer (frames, accumulation, readback).                                    |
| `scripts/boundary.mjs`       | The check that no package imports past `typeshade/runtime` or calls WebGPU itself.                                          |
| `scripts/harness.mjs`        | One frame in headless Chromium on SwiftShader, held to a golden.                                                            |
| `docs/plan.md`               | The plan and the milestones.                                                                                                |
| `docs/typeshade-feedback.md` | Field notes on using TypeShade here, the input for feedback to the language.                                                |
| `compiler-changes.md`        | The compiler proposals this repository has handled when the pin moved.                                                      |

Later milestones add `packages/kernels` (the `.shade.ts` kernels), `packages/scene`,
`packages/fit`, `packages/procedural`, `packages/sim` and `packages/realtime`, as the plan lays
out.

## Checks

```sh
bun install
bun run check     # format, prose, boundary, typecheck, tests
bun run harness   # one frame on WebGPU (needs Chromium: npx playwright install chromium)
```

CI (`.github/workflows/ci.yml`) runs the same steps, and on a pull request also what a move of
the compiler pin owes this repository (`compiler-bump`).

## License

Apache-2.0, as the compiler is.
