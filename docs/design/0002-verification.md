---
id: '0002'
title: Every milestone is held by gates that can fail, each with a named scene, a named number and a probe that proves the instrument
status: accepted
milestones: [M2, M2a, M3, M4, M5]
touches:
  - scripts
  - .github/workflows/ci.yml
  - packages/radiance/src/kernels
  - docs/benchmarks.md
compiler: ['0006-5', '0006-6']
---

**Document control**

| Field         | Value                                                                              |
| ------------- | ---------------------------------------------------------------------------------- |
| Identity      | Design record 0002, status `draft`                                                 |
| Date          | 2026-10-05 (UTC), the date of authorship                                           |
| Author        | Written in a Claude Code session for the owner. The owner's review is the approval |
| Applicability | `scripts/`, `.github/workflows/ci.yml`, `docs/benchmarks.md`. Every package        |
| Baseline      | `main` at 0f17f5e. The compiler pinned at e923a34                                  |
| Pull request  | typeshade/radiance#6, the pull request that carries this record and is its review  |

## What changes

### Before

Two gates exist. `scripts/harness.mjs` renders the Cornell box at 16 x 16 and 1,024 samples a
pixel on headless WebGPU, holds it to the CPU oracle (`ORACLE` in `scripts/gates.mjs`), checks
that two renders of one seed are bit-identical, checks the tone map, and drives the Cornell box
example's page. `bun run check` runs the format, prose, boundary and shader checks, the type
check and 13 unit tests. The site's stills are hashed. Nothing holds an example's picture to a
golden, nothing records a speed, nothing checks that the public API moved, nothing checks a
package's size, and the site's build was not in CI's `check` job: the deploy of `main` bde32a7
failed on a build CI had passed (pull request #5).

### After

The gates below exist, each in `scripts/gates/<name>.mjs`, each run by `bun run gate:<name>`,
each with a probe that shows it can fail (`AGENTS.md#gate-discipline` in the compiler: "prove
the instrument before believing a zero"). CI's three jobs keep their names, which the `main`
ruleset will name. The gates run as steps inside them.

| Gate           | What it proves                                                                                                                                        | Scene and size                                               | Number                                                                                               | Runs in        |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | -------------- |
| `differential` | The GPU render of a scene is within tolerance of the oracle's render of the same kernel, seed and samples (plan §11)                                  | One scene per feature (below), 16 x 16, 256 to 1,024 spp     | `ORACLE` per scene: `abs`, `rel`, `mean`, re-derived when the scene changes                          | harness        |
| `determinism`  | Two renders of one seed are bit-identical and another seed differs. The kernel's determinism report lists only allowed rows (record 0005)             | Every differential scene. Every `.shade.ts` under `kernels/` | 0 differing floats. 0 rows outside the allowlist                                                     | check, harness |
| `render`       | Each example's picture is the committed golden, within tolerance                                                                                      | Every example, 96 x 64, 64 spp                               | per channel at most 4/255 on 99.9 % of pixels, and a mean absolute difference at most 1/255          | harness        |
| `site`         | The site builds from a clean checkout, with the stills' hashes checked                                                                                | `bun run site`                                               | exit 0                                                                                               | check          |
| `api`          | The public API surface of each package equals its committed bake (record 0003)                                                                        | `packages/*/__api__/surface.md`                              | no diff                                                                                              | check          |
| `bundle`       | Each package, bundled for the browser, minified and gzipped, stays between its floor and its budget                                                   | `scripts/bundle-budget.json`                                 | the budget is the landed size plus a tenth. A rise past it moves the budget in the same pull request | check          |
| `journeys`     | The packed tarballs install into a scratch project, the compiler's tarball beside them, and an example renders there on headless WebGPU (record 0003) | `npm pack` of both packages. The `first-scene` example       | the example's picture within the render gate's tolerance of its golden                               | harness        |
| `bench`        | The speed of a scene is recorded, not held                                                                                                            | The benchmark scenes at 512 x 512 and 1920 x 1080            | paths per second and samples per second, appended to `docs/benchmarks.md` by hand                    | by hand        |

**The differential scenes.** One per feature the kernel gains, each small enough for the oracle
to render in under three minutes on CI, each a function in `packages/addons/src/scenes/` so
the site can show it too:

| Scene       | Feature it holds                                                                 | Added at |
| ----------- | -------------------------------------------------------------------------------- | -------- |
| `cornell`   | Diffuse, mirror, an area light, next-event estimation, Russian roulette          | M1       |
| `triangles` | A low-polygon mesh (a 12 x 8 sphere) with smooth normals, the BVH traversal      | M2       |
| `instances` | Two instances of one geometry, one scaled non-uniformly, two materials           | M2       |
| `lights`    | Three emissive triangles of different areas and colours: the light table's CDF   | M2       |
| `physical`  | The principled BSDF at three roughness values and one transmission (record 0004) | M3       |
| `textures`  | A textured quad under a mip level the kernel chooses (record 0004)               | M3       |
| `hdri`      | An environment map with importance sampling                                      | M3       |

A scene's `ORACLE` thresholds are derived when it is added: the pull request records the
measured `mean` and the largest difference on SwiftShader, and sets `mean` at ten times the
measured value and `abs` and `rel` at M1's (`1e-3` and 5 %), unless the measurement says
otherwise. A threshold moved later is a reviewed change with the new measurement in the pull
request.

**The determinism report lint** is a unit test, `packages/radiance/src/kernels/determinism.test.ts`:
it compiles every kernel module with the compiler (scripts and tests may import it, packages
may not) and holds `compile().determinism`'s rows to the allowlist record 0005 states. A new
row fails the test with the operation, its kind and the functions it is in.

**The render gate's goldens** live in `scripts/__goldens__/<example>.png`. Each is 96 x 64, 64
samples a pixel and seed 1, except one example with its own seed (below). SwiftShader renders each
through `readPixels()`, and the harness's own encoder writes it as PNG. The gate holds one golden
for each example the site lists (`exampleIds` in `scripts/stills.mjs`). It fails an example that
has no golden. It fails a golden that no example owns. It runs each example on a canvas of 96 x 64
CSS pixels. It stops the motion of an animated example. It sets `seed` to 1, `samplesPerFrame` to
16 and `maxSamples` to 64 (`window.runExample` in `scripts/gates/_browser.mjs`).
`UPDATE_GOLDENS=1 bun run gate:render` rewrites the goldens and removes a golden that no example
owns. The pull request that does so shows each old and new picture. The site's stills
(`site/public/stills`) stay what they are: the picture a page shows, captured at 64 samples a pixel
and hashed. They are not goldens.

**The seed of a golden.** An example can set `seed` after the gate does. The `determinism` example
does so in `render()` of `site/examples/determinism.ts`. The gate then holds that example at the
seed of the first render that reaches `RENDER.samples` in `scripts/gates.mjs`, which is 64. The gate
reads the picture at that moment. Each such example has an entry in `OWN_SEED` in
`scripts/gates/render.mjs`. A new example of this kind needs an entry in the same pull request. One
example has an entry: `determinism`. It draws seed 2, then seed 1, then seed 1 again. Its golden is
a seed-2 picture. Record 0005 (Amendment 2, "The first frame and the example") gives the reason. The
entry is a copy of `RENDER.otherSeed` in `site/examples/determinism.ts`. `node`, the runtime of the
gate, cannot import that file. The check of `ran` against `wanted` in `holdExample` compares the
seed the example ran with to its entry. For an example without an entry, `wanted` takes
`RENDER.seed` from `scripts/gates.mjs`. A difference fails the example, and the failure names both
seeds. Every other golden is a seed-1 picture. This rule applies from the pull request that changes
the example.

**The render gate's tolerance** is `RENDER` in `scripts/gates.mjs`, in 8-bit units, and
`comparePictures` in `scripts/gates/render.mjs` applies it. A render and its golden are 8-bit
RGBA pictures. A pixel is within when each of its four channels, alpha included, differs from
the golden by at most `RENDER.channel`, which is 4. A picture passes when both bounds hold:

- **The share.** The pixels that are not within are at most `RENDER.outside` of all pixels,
  which is 0.1 %. At 96 x 64 that is 6 of 6,144 pixels.
- **The mean.** The mean absolute difference over the red, green and blue channels of all
  pixels is at most `RENDER.mean`, which is 1. Alpha is not in the mean.

A picture of another size, or without pixels, fails. The two bounds act together. A shift of
4/255 in the three colour channels of every pixel keeps every pixel within. The share holds,
and the mean of 4/255 breaks the mean bound. The same shift passes when it moves at most a
quarter of the pixels. The mean is then 4/255 times the share of pixels it moves. The gate
admits a render with up to 6 pixels beyond 4/255 at 96 x 64.

**The benchmark** is `scripts/bench.mjs`. It renders each benchmark scene at each size on the device
it finds. The benchmark scenes are `cornell` (the gate's Cornell box) and every site example. Each
render takes a fixed number of samples a pixel, 16 by default. The script prints one row per scene
and size:
`| date | commit | scene | size | spp | triangles | BVH ms | frame ms | paths/s | spp/s | device | browser |`.
`docs/benchmarks.md` (What a row holds) defines each column. The script holds no bound on time or
on speed. Its one limit is a timeout, 1,800 s a render by default, and a render that passes it fails
the run. `docs/benchmarks.md` holds the rows, appended by whoever ran it, with the device named as
the browser reports it. A row from SwiftShader is marked as such and shows a trend only. M2's
acceptance ("spp per second at 1080p recorded") is a row from a real GPU, which the owner's machine
produces by the procedure in that file. The option `--smoke` renders every scene at 32 x 32 and 2
samples a pixel. It shows that every scene renders, and its rows are no measurement. CI is to run
`node scripts/bench.mjs --smoke` on SwiftShader as a smoke test and to record nothing. That step is
not in `.github/workflows/ci.yml` yet.

**The probes.** Each gate's test file runs the gate once wrong on purpose and asserts that the
gate reports it:

- `differential`: the oracle's image shifted by one pixel fails the `mean` bound.
- `determinism`: a render with seed 2 compared with seed 1 fails the bit-identity.
- `render`: a golden with one channel of one pixel moved by 8/255 fails the per-channel rule
  alone. The tolerance admits 6 such pixels at 96 x 64, so the probe sets the share to 0 and
  the mean to no bound (`channelBoundOnly` in `scripts/gates/render.mjs`). The same fault on
  13 pixels fails the whole tolerance. Thirteen is twice the share of 6,144 pixels, rounded up.
  A control comes first: a golden written by the encoder and read by the decoder equals the
  golden byte for byte. The probe reads the golden with the PNG decoder, so the decoder is
  proved too. It needs no browser. `scripts/gates/render.test.ts` runs it on the committed
  goldens, and the harness runs it after the gate.
- `site`: a still with a wrong `.sha256` fails the build (this probe exists: `scripts/stills.mjs`).
- `api`: a surface bake with one line removed is a diff.
- `bundle`: a floor above the measured size fails, so an empty bundle cannot pass.
- `journeys`: a tarball with `src/index.ts` removed fails the import.

**CI.** The `check` job gains the `site`, `api` and `bundle` steps and the determinism lint
(inside `bun run test`). The `harness` job gains the `differential` scenes, `determinism`,
`render` and `journeys`. Job names do not change. Chromium is installed once per job by
`npx playwright install --with-deps chromium`, as today.

**Local.** `bun run check` runs the `check` job's steps. `bun run harness` runs the `harness`
job's. `bun run gate:<name>` runs one gate. `RADIANCE_CHROMIUM` names the browser, as today.

## Why

- **The deploy failure.** Pull request #5: the site's build depended on a file another job had
  generated. A gate that runs the build from a clean state in `check` would have failed the
  pull request that introduced the dependency.
- **A golden per example.** The stills are 64-sample pictures captured from the site, and a
  change that shifts a picture by a bounce shows in the hash and not in the picture. A small
  golden compared within tolerance says what changed. The tolerance absorbs a SwiftShader
  update, and the update procedure shows the owner both pictures.
- **A scene per feature.** M1's one scene holds one kernel. M2 adds traversal, instancing and
  a light table. M3 adds materials, textures and an environment. A feature with no scene in the
  differential is a feature the oracle never checks.
- **The report lint.** Record 0005's rules are prose until a test reads the report. The compiler
  gives the report for every module (`compile().determinism`, surface §38). The test is a
  comparison with a list.
- **Speed as a record, not a gate.** SwiftShader's speed says nothing about a GPU, and a gate on
  a number from a shared runner flakes. A row in a table, with the device named, is what M2's
  acceptance asks for.
- **The tarball journey.** The compiler learned this at its first release (`RELEASING.md`): an
  installed package is not the checked-out tree. The engine will be published. The gate exists
  before the first release, not after the first bad one.

Alternatives considered: holding the stills themselves as goldens (too large, and 64 samples
on SwiftShader take minutes per example). An exact golden comparison as the compiler's
`gate:render` does (the compiler's scene is 48 x 48 of a closed-form SDF, a path tracer's
picture moves by a bounce when the driver regroups an `inherited` operation, so a tolerance is
right). A performance gate with a bound (no real GPU in CI, plan §7 puts a self-hosted runner at
M3).

## What it touches

- `scripts/gates/` (new): `differential.mjs`, `determinism.mjs`, `render.mjs`, `site.mjs`,
  `api.mjs`, `bundle.mjs`, `journeys.mjs`, and `_browser.mjs` (the Chromium launch and the
  page the harness uses today, shared) and `_png.mjs` (the encoder in `harness.mjs` today,
  plus a decoder). `scripts/harness.mjs` becomes the runner of the harness job's gates.
- `scripts/gates.mjs`: `ORACLE` becomes per scene. `GATE` names each scene's size and samples.
  `RENDER` the golden size, samples and tolerance.
- `scripts/harness-entry.ts`: exports `EXAMPLES` from `site/examples/index.ts`, so the page the
  harness serves can run a site example (step 4).
- `scripts/bench.mjs`, `docs/benchmarks.md` (new).
- `scripts/bundle-budget.json` (new), `scripts/bake-api-surface.ts` (record 0003).
- `packages/radiance/src/kernels/determinism.test.ts` (new).
- `packages/addons/src/scenes/`: the differential scenes.
- `.github/workflows/ci.yml`: the steps, and the artifact step of the `harness` job, which names
  `.harness/render-*.png` (step 4). `README.md` (Checks). `docs/plan.md` §11 points here.
- `CLAUDE.md`: "Before pushing" names `bun run check` and `bun run harness` as today. Nothing
  changes there.

## Implementation, in steps

1. **Split the harness.** Move the browser launch, the server and the PNG encoder into
   `scripts/gates/_browser.mjs` and `_png.mjs`. Make `harness.mjs` call `differential` and
   `determinism` as functions. Add the two probes. No new gate yet. Done when `bun run harness`
   passes with the same numbers as before (mean 1.44e-6, largest 2.39e-5 at 0f17f5e).
2. **The site gate and the Cornell re-derivation.** Add `gate:site` to `check` (CI and
   `bun run check`). When record 0001 step 3 lands, re-derive the Cornell box thresholds on
   tessellated spheres by the rule above and record the measurement in that pull request.
3. **The determinism lint.** `determinism.test.ts` with record 0005's allowlist, and its probe
   (a module with a `sin` in a function fails).
4. **The render gate.** One golden for each example (five at 37168ce, six since 6ad088d), the
   decoder, the probe, the update procedure, `gate:render` in the harness job.
5. **The API and bundle gates.** With record 0003's bake: `gate:api`, `gate:bundle` with the
   budgets set at the landed sizes, their probes, both in `check`.
6. **The differential scenes of M2.** `triangles`, `instances`, `lights`, each with its
   thresholds derived and recorded, as record 0001 steps 3 to 5 land.
7. **The benchmark.** `scripts/bench.mjs`, `docs/benchmarks.md` with the procedure and the first
   rows (SwiftShader from a manual run on the build machine, and the owner's GPU).
8. **The journeys gate**, before the first release (record 0003).

## Decisions for the owner

1. CI's job names stay. The gates are steps. (Renaming a job changes the ruleset.)
2. Goldens at 96 x 64 and 64 samples a pixel, compared within tolerance, updated by hand with
   both pictures in the pull request. A test holds the size, the samples and the tolerance. No
   test holds the update by hand. It is a procedure (`README.md`, Checks).
3. Speed is a recorded row, not a gate, until a real GPU runner exists.
4. A scene per feature in the differential, with its thresholds derived by the rule above.
5. The stills stay the site's pictures and are not goldens.

## Record

**Approval and plan record.** Accepted on 2026-10-05 (UTC). The owner approved the merge of typeshade/radiance#6 in the conversation, which merged this record as `draft` at 9e8b479. The owner then said to implement the records with Opus 5.5 and Sonnet 5.5, and that go-ahead is the acceptance. Every entry of "Decisions for the owner" stands as proposed.

**Amendment 1** (2026-10-06, UTC). The stills are captured at 64 samples a pixel, not 256. A still
is the picture a page shows before its canvas runs, hashed and not held to a golden, so 64 samples
are enough. Measured on 2026-10-06 (SwiftShader, 4 cores, pin 596c805): the triangle kernel traces
about 15,000 paths a second, so one still of 718 x 450 pixels took about 45 minutes at 256 samples
and takes about 11 minutes at 64. The three sentences of "What changes" and "Why" that named 256
now name 64. The decisions do not change.

**Amendment 2** (2026-10-06, UTC). Step 4 (typeshade/radiance#20, merged as 37168ce) delivered
the render gate with differences from this record. This amendment settles items 1 to 6 of the
"Deviations" section of that pull request, and the number of goldens. Each entry below gives the
difference, the proposed disposition and the text of this record that holds it. The owner has not
decided any of them. The merge of the pull request that carries this amendment is the owner's
acceptance of each entry marked "made part of the record" or "closed". An entry marked "open"
waits for the owner's answer. This amendment changes the rule text in "The render gate's
goldens", "The probes", "What it touches", step 4 and decision 2. It adds "The render gate's
tolerance". The decisions keep their numbers. The facts below come from `main` at 7521318 and
from the CI runs named in them.

- **The probe and the tolerance** (item 1). This record said that a golden with one channel of
  one pixel moved by 8/255 fails. The tolerance admits 6 such pixels at 96 x 64, so the gate does
  not fail that golden. The probe judges the fault by the per-channel rule alone (`channelBoundOnly`
  and `plant` in `scripts/gates/render.mjs`). It also holds that 13 such pixels fail the whole
  tolerance. Proposed: made part of the record. "The probes" and "The render gate's tolerance"
  now say it. The gate itself admits a render with one such pixel, as the 99.9 % of the tolerance
  says.
- **The share and the mean** (item 2). The table cell "per channel at most 4/255 on 99.9 % of
  pixels, and a mean absolute difference at most 1/255" cannot mean that a shift of 4/255 on
  99.9 % of the pixels passes. That shift has a mean of 4/255 and fails the mean bound. The tests
  hold a shift on a fifth of the pixels (mean 0.8/255, passes) and on every pixel (mean 4/255,
  fails) in `scripts/gates/render.test.ts`, in the group "the tolerance rule". Proposed: made part
  of the record. "The render gate's tolerance" says that both bounds hold together.
- **Alpha** (item 3). This record names no channel for the mean. The mean covers red, green and
  blue (`comparePictures` in `scripts/gates/render.mjs`). The per-channel rule judges all four
  channels, alpha included. Measured on 2026-10-06 by decoding each golden: in each of the six,
  every alpha is 255. A mean over four channels would be lower and would loosen the bound.
  Proposed: made part of the record. "The render gate's tolerance" says it.
- **The files of step 4** (item 4). Step 4 does not list `scripts/harness-entry.ts`. The entry
  of `.github/workflows/ci.yml` in "What it touches" said "the steps" and did not name the
  artifact step. Proposed: made part of the record. "What it touches" now lists both. Open: the
  artifact step uploads no file. In CI runs 37387420208 (head 9a1efdc of #20) and 37398596640 (`main` at 6ad088d), the
  step reported "No files were found with the provided path" and uploaded nothing. Inference:
  `.harness` is a hidden directory, and the step sets `include-hidden-files: false`. The failure
  message of the gate names `.harness/render-<example>.png`, so a failure in CI keeps no picture.
  Next action, after the owner agrees: a pull request that sets `include-hidden-files: true` on
  the step.
- **The procedure of decision 2** (item 5). Decision 2 says "updated by hand with both pictures
  in the pull request". DEC-0202 has `verification: test`, and no test holds that clause.
  `scripts/gates/render.test.ts` holds the size, the samples and the tolerance. Its header
  comment says that the update rule is a procedure. `README.md` (Checks) states the procedure.
  After a rewrite, `scripts/gates/render.mjs` prints "the goldens are rewritten: look at the old
  and the new picture of each one before you commit them". Proposed: made part of the record.
  Decision 2 now says which part a test holds and which part a procedure holds. The review of
  the pull request is then the check of the procedure. This amendment adds no test. If the owner
  wants one, the next action is a test that reads `README.md`.
- **The renderer build** (item 6). The goldens and the tolerance were tested on one SwiftShader
  build, the Chromium that `RADIANCE_CHROMIUM=/opt/pw-browsers/chromium` named in the
  verification of #20. That pull request does not record its version. CI installs its own
  Chromium with `npx playwright install --with-deps chromium`. In run 37387420208 that step
  downloaded Chrome for Testing 153.0.8010.12 (Playwright chromium v1243) and its headless shell
  of the same version. The job `harness (headless WebGPU)` succeeded. Each of the five examples
  matched its golden with a mean of 0.000/255, a worst channel of 0/255 and 0 of 6,144 pixels
  beyond 4/255. In run 37398596640 the six examples matched the same way. In these two runs the
  tolerance absorbed no difference. Proposed: closed. A later build may miss. The numbers of the
  gate (`mean`, `worst`, `outside`) then say by how much. A change to `RENDER` is a change to a
  threshold in `scripts/gates.mjs`, so it needs an amendment to this record
  (`docs/design/README.md`, "When a change needs one").
- **Six examples** (no item of #20). Step 4 named five examples. The gate holds one golden for
  each example the site lists (`exampleIds` in `scripts/stills.mjs`). #21 (6ad088d) added the
  sixth example, `determinism`, with `scripts/__goldens__/determinism.png`.
  `scripts/gates/render.test.ts` fails when an example has no golden or a golden has no example.
  Proposed: made part of the record. Step 4 and "The render gate's goldens" now say "one golden
  for each example".

**Amendment 3** (2026-10-06, UTC). The `determinism` example draws seed 2 first, then seed 1 twice.
Record 0005, Amendment 2, "The first frame and the example" (its fifth bullet), requires that the two
renders of seed 1 share one split. It gives seed 2 first, then seed 1 twice, as an example of how.
A renderer's first frame adds one sample, so the first render has a split of its own. The example
meets the requirement with that order. The gate reads the picture when the samples reach
`RENDER.samples` in `scripts/gates.mjs` (64). That is the end of the first render. So the golden of
this example becomes a seed-2 picture.

This record said that every golden is seed 1 and that the gate sets `seed` to 1. The first statement
is false for this example. The second statement stays true: the gate sets `seed` to 1, and the
example replaces that seed later. This amendment settles the difference before the pull request that
changes the example. It changes "The render gate's goldens" and adds "The seed of a golden". The
decisions keep their numbers and their text. The merge of the pull request that carries this
amendment is the owner's acceptance. The pull request that changes the example merges after it and
names this record on a line of its own, `Design: 0002`.

- **The fact.** Measured on 2026-10-06 at commit 60351f7 (pin 596c805, bun 1.3.14, node v22.22.0).
  That commit is the second commit of the site pull request that changes the example. The first
  commit is 175daa3. The old golden of `determinism` is `scripts/__goldens__/determinism.png` at
  06a1a39. The new golden is the file at 60351f7. They differ by a mean of 4.338/255 and a worst
  channel of 164/255. 2,366 of 6,144 pixels are beyond 4/255. The other five goldens do not change.
  This comparison reads the two files from git and uses no renderer.
  On SwiftShader at 60351f7 the gate line of `determinism` reads `96 x 64 at 64 spp, seed 2`. It
  matches the new golden with a mean of 0.000/255, a worst channel of 0/255 and 0 of 6,144 pixels
  beyond 4/255.
- **The proposal.** The gate takes the golden of an example that sets `seed` after the gate does
  from the first render that reaches `RENDER.samples`. `OWN_SEED` holds the seed of that render, and
  `determinism` is its one entry. Proposed: made part of the record. "The seed of a golden" says it,
  and the comments of `scripts/gates.mjs` and `scripts/gates/render.mjs` say it in the pull request
  that changes the example.
- **Considered and not proposed: a short first render** (inference). The golden stays a seed-1
  picture if the first render is a seed-2 render that stops before 64 samples. That render would
  have fewer samples than the two renders it is compared with, so the example would show a
  different thing.
- **Considered and not proposed: a wait for `data-done`** (inference). The gate could wait for the
  `data-done` mark that the example sets in its panel, as `scripts/capture-stills.mjs` does. The
  gate would then read the last render, which is seed 1. Every golden would stay a seed-1 picture.
  The gate would keep no copy of a seed. This option has two costs. The first cost is a change of
  the stop rule in `window.runExample` in `scripts/gates/_browser.mjs`. That rule stops when
  `r.samples` reaches the samples. The second cost is a run of three renders in place of one for
  this example. The owner can choose this option in place of `OWN_SEED`.

**Amendment 4** (2026-10-06, UTC). Step 7 delivered `scripts/bench.mjs` and `docs/benchmarks.md`
with differences from "The benchmark" and step 7 of this record. This amendment settles the entries
below. The owner has not decided any of them. The merge of the pull request that carries this
amendment is the owner's acceptance of each entry marked "made part of the record" or "proposed".
An entry marked "open" waits for the owner's answer. This amendment changes the text of "The benchmark" and step 7.
The decisions keep their numbers and their text. The pull request that delivers step 7 merges after
this one.

- **The bound of a run.** This record said that the script renders each scene for ten seconds at
  each size. The script stops at a number of samples a pixel instead: 16 by default, set with
  `--samples`. A render that passes `--timeout` (1,800 s by default) fails the run. Fact: a manual
  run on 2026-10-06 (UTC) at commit 85cce4f on the branch of the pull request of step 7 (compiler
  pin 596c805, SwiftShader, 128 x 128, 16 samples a pixel, 11 scenes) traced from 28,689 to 126,039
  paths a second. Step 7 records those rows in `docs/benchmarks.md`. The squash merge of the pull
  request of step 7 gives `main` another hash. One 1080p render of 16 samples is 33,177,600 paths.
  Inference: a time bound gives each device a different number of samples, and the first frame,
  which adds one sample, is then a different share of each row. A fixed number of samples gives
  every device the same work, so `frame ms` and `paths/s` compare. Proposed: made part of the
  record. "The benchmark" now says it.
- **The row.** This record gave the row as eight columns: `date`, `commit`, `scene`, `size`,
  `paths/s`, `spp/s`, `device` and `browser`. The script prints twelve. It adds `spp`, `triangles`,
  `BVH ms` and `frame ms`, and it puts them in the order given in "The benchmark". The added columns
  say how much work a row measured. Record 0007 (section 4, and step 5) expects a later amendment
  of this row that adds the tier. Proposed: made part of the record. "The benchmark" now gives the
  twelve columns, and `docs/benchmarks.md` defines them.
- **The smoke run and the first rows.** This record said that CI runs the script on SwiftShader at
  512 x 512 as a smoke test and records nothing. It also said that the first SwiftShader rows come
  "from CI's smoke run". The two sentences disagree, because a smoke test records nothing. The
  script's `--smoke` is 32 x 32 at 2 samples a pixel. The first SwiftShader rows of
  `docs/benchmarks.md` come from a manual run at 128 x 128 and 16 samples, and one row at 512 x 512
  and 4 samples, on the build machine at pin 596c805. The 1080p run of the default options takes
  over an hour on SwiftShader, so a SwiftShader row may use a size below the two sizes of the `bench`
  gate. Its `size` column says which. Proposed: made part of the record. "The benchmark" and step 7
  now say it. The smoke run is a check that each scene renders, and the size does not matter to it,
  so the small size stands.
- **The smoke step in CI.** The pull request that delivers step 7 adds no step to
  `.github/workflows/ci.yml`. Open. Next action: a pull request that adds
  `node scripts/bench.mjs --smoke` to the `harness` job, after `bun run harness`, with the added
  seconds measured in that pull request. Fact: measured on 2026-10-06 (UTC) at commit 1199690 on the
  branch of the pull request of step 7 (compiler pin 596c805, SwiftShader, node v22.22.0, bun
  1.3.14), the smoke run of all 11 scenes took 12.6 s.
- **The verification of decision 3.** No test carries `Verifies: Design 0002.3`, and DEC-0203 keeps
  `verification: pending`. Proposed: decision 3 is verified by inspection. The script holds no bound,
  and no gate reads `docs/benchmarks.md`. `scripts/bench.test.ts` states this in its header. This
  amendment adds no test.

**Configuration and validation record.** This record does not yet apply. Implementation will
record each gate's first measured numbers, the pin, and the CI run that first ran it.
