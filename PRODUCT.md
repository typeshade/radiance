# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

The engine is a bun workspace of TypeScript packages on the pinned compiler
(`vendor/typeshade`). The site is new, and the owner decided its stack on 2026-10-05: Astro,
as typeshade.dev is built, with React islands for the parts that run (the rendered view, its
controls, the search), Ant Design components inside those islands, and Tailwind utilities on the
tokens of `DESIGN.md`. The site is served from Cloudflare Workers at `radiance.typeshade.dev`
(`wrangler.jsonc`, `.github/workflows/deploy.yml`), the way typeshade.dev is.

## Users

Primary: a TypeScript developer who already renders in the browser, or wants to, and arrives
from typeshade.dev, GitHub or a search for a WebGPU path tracer. They want to know within one
screen what Radiance draws, how a scene is written, and how to install it. The job the front
page has for them: see a rendered image beside the code that drew it, then run the first
scene themselves.

Secondary, confirmed by the owner: the owner's own next products. Radiance is where TypeShade
gets used for real, and `docs/typeshade-feedback.md` carries what that is like back to the
compiler. The owner intends to build games on the engine later (2026-10-05), after the
path tracer; the real-time tier in `docs/plan.md` is the road there.

## Product Purpose

TypeShade Radiance is a rendering engine for the web, written on TypeShade. A scene is
assembled in TypeScript with a scene graph laid out as three.js's is (objects, cameras,
geometries, materials, meshes, renderers), and a renderer draws it on WebGPU through the
compiler's public program runtime, `typeshade/runtime`, and nothing else. The first renderer is
a progressive path tracer; the plan (`docs/plan.md`) adds triangle meshes and glTF, the
principled BSDF, volumes, denoising, differentiable rendering, procedural kernels, physics
solvers and a real-time tier, in that order of milestones.

Success for the site: a visitor understands what Radiance is in one screen, opens an example
and moves the camera, installs the package, and comes back to the docs for the API.

## Positioning

The claim a neighbouring engine cannot truthfully copy: the GPU code is TypeShade, TypeScript
syntax checked by TypeScript tooling, and the same kernel that renders on the GPU runs on the
compiler's CPU oracle. CI renders the Cornell box both ways and holds the two images to each
other (`scripts/harness.mjs`: the mean relative difference measured on SwiftShader is 1.4e-6,
and the gate admits 1e-4), and two renders of one seed are bit-identical. three.js has TSL for
the first half and nothing for the second; a WGSL engine has neither.

The second claim: the engine reaches WebGPU only through `typeshade/runtime`. No package calls
a WebGPU object (`scripts/boundary.mjs` holds this in CI), so the runtime, and the compiler
behind it, are what Radiance tests.

## Operating Context

- Repository `typeshade/radiance`, public since 2026-10-05, Apache-2.0. Packages
  `@typeshade/radiance` (the engine: math, core, cameras, geometries, materials, objects,
  scenes, renderers, kernels) and `@typeshade/radiance-addons` (OrbitControls, ready-made
  scenes). The compiler is pinned as a git submodule, `vendor/typeshade`, at commit 596c805;
  moving the pin is its own pull request with its own checks (`CLAUDE.md`).
- The kernels are `*.shade.ts` files compiled by the compiler and run through the runtime. What
  the runtime cannot do yet becomes a proposal in the compiler's `changes/`.
- CI (`.github/workflows/ci.yml`): the checks (`bun run check`), the harness (headless Chromium
  on SwiftShader: determinism, the oracle gate, the display gate, the demo page), and on a pull
  request the compiler bump impact. Every milestone in `docs/plan.md` is done by an image and a
  number held in CI.
- `main` is protected by a ruleset: a pull request, a Code Owner review and the required checks.
- The site's examples are the engine's own: TypeScript files under `site/examples/`, each one a
  scene set up on a canvas, run on the page and linked to its source on GitHub.

## Capabilities and Constraints

- Today (milestone M1): spheres and parallelograms, diffuse, mirror and emissive materials, area
  lights with next-event estimation, Russian roulette, an Owen-scrambled Sobol sampler,
  progressive accumulation with a lower-resolution preview while the camera moves, exposure and
  a filmic display transform, `OrbitControls` for mouse, touch, pen and keyboard, and four
  examples (the Cornell box, materials, coloured lights, a moving scene graph).
- WebGPU only today, and WebGL2 by direction. The owner decided on 2026-10-06 that WebGL2 is a
  target (`docs/plan.md`, section 12, decision 7). The compiler's change 0054 will run every
  compute entry on WebGL2. The engine will take the tier at milestone M8, after the pin moves to
  a compiler that carries it. Chrome and Edge from version 113 have WebGPU. Today a browser
  without WebGPU sees a still of the example and a notice.
- Not yet: triangle meshes, a BVH and glTF (M2), textures and the principled BSDF (M3), a
  denoiser (M4), differentiable rendering (M5), the real-time tier (R1 to R3), the WebGL2 tier
  (M8).
- Installation: the packages are not on npm at 2026-10-05. The owner decided (2026-10-05) that
  the site assumes publication of `@typeshade/radiance` 0.0.1 and shows `npm install
@typeshade/radiance`, with a pre-release note until the package is published.
- Languages: English first (the owner's decision, 2026-10-05). The copy lives in dictionaries
  typed the way typeshade.dev's are, so Korean is a second dictionary and a `/ko/` route set in
  a later pull request, with no change to the pages.
- Undecided product facts: the release date of 0.0.1; whether M3's reference comparison is
  Blender Cycles alone or Mitsuba 3 as well; the first game the owner builds on the engine.

## Brand Commitments

- Name: TypeShade Radiance. The short name is Radiance; a document says "TypeShade Radiance"
  where the classic renderer Radiance (LBNL) could be meant (`docs/plan.md`, Decisions taken).
  No mark exists yet.
- Voice: plain sentences from the maintainer to other developers, the voice typeshade.dev
  writes in. Say what the engine does. No praise words, no "X, not Y" contrasts, no em dashes,
  no all-caps emphasis. Headings are short nouns. `scripts/check-style.mjs` enforces the
  checkable parts.
- Visual language, pinned by the owner on 2026-10-05: the Vapor UI design language as the
  provided `DESIGN.md` records it (its tokens, its type ramp, its 8px radius, its hairline cards
  with no shadow at rest, its hover overlays), applied with Ant Design components themed to
  those tokens and Tailwind utilities on them. Vapor's own name stays out of the interface and
  appears once, as attribution in the footer, as that document asks.
- The site's shape, asked for by the owner on 2026-10-05: a library site as pixi.js and
  three.js have one, with a front page that shows how the engine is used, documentation, an
  examples section and an API reference. An example page shows the running example and either
  its source as three.js shows it or a link to the file on GitHub.
- Imagery: the engine's own renders, live on the page or captured at build time, are the site's
  only pictures. No stock photography, no illustration.

## Evidence on Hand

- Real code: the four examples under `site/examples/` and the engine's source, with JSDoc on
  every public class and member.
- Real images: the Cornell box rendered by the engine (a 256 by 256 frame at 1024 samples a
  pixel took 124 s on SwiftShader; a real GPU is faster, and that number is not measured).
- Real numbers from CI: the oracle gate (mean relative difference 1.44e-6, largest 2.39e-5,
  on SwiftShader, 16 by 16 at 1024 samples a pixel), the determinism gate, the test count, the
  pinned compiler commit.
- Absent, do not fabricate: users, testimonials, benchmarks on a hardware GPU, npm download
  counts, a release date, a comparison image against Blender Cycles (M3).

## Product Principles

1. Show the render before the sentence. The image is the proof; the prose explains it.
2. Every number on the site is measured, by CI's harness or by the build. A number nobody
   measured is not on the page.
3. An example is the documentation's proof: it runs on the page, and its source is one click
   away.
4. The scene graph does not know its renderer. The path tracer draws it today; the real-time
   tier draws the same scene later, and a game built on the engine draws it too.
5. The engine stays on `typeshade/runtime`. What it cannot do goes back to the compiler as a
   proposal.

## Accessibility & Inclusion

- Every live canvas has a still underneath it and an accessible name that says what is drawn,
  so no visitor sees an empty frame.
- `prefers-reduced-motion` holds the frame loop to the samples it has.
- Dark and light follow the system, with a switch in the header.
