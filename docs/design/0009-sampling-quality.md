---
id: '0009'
title: Six quality techniques for the path tracer, one part each
status: draft
milestones: []
touches:
  - packages/radiance/src/kernels/trace.shade.ts
  - packages/radiance/src/kernels/sampler.shade.ts
  - packages/radiance/src/kernels/materials.shade.ts
  - packages/radiance/src/kernels/layout.shade.ts
  - packages/radiance/src/kernels/intersect.shade.ts
  - packages/radiance/src/kernels/determinism-lists.ts
  - packages/radiance/src/accel/bvh.ts
  - packages/radiance/src/renderers/PathTracer.ts
  - packages/radiance/src/renderers/scene-pack.ts
  - scripts/gates.mjs
  - scripts/gates/differential.mjs
  - scripts/oracle.ts
  - scripts/__goldens__
  - docs/benchmarks.md
  - docs/design/0001-scene-data-model.md
  - docs/design/0002-verification.md
  - docs/design/0005-determinism.md
compiler: []
---

**Document control**

| Field         | Value                                                                                                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity      | Design record 0009, status `draft`                                                                                                                                         |
| Date          | 2026-10-06 (UTC), the date of authorship. The owner approved the quality wave on the same date                                                                             |
| Author        | Written in an agent session for the owner. The owner's review is the approval                                                                                              |
| Applicability | The kernels in `packages/radiance/src/kernels`, the host in `packages/radiance/src/accel` and `src/renderers`, and the gates in `scripts/`. No site page, no public export |
| Baseline      | `main` at 55bde46. The compiler pinned at 596c805. Every line number below is a line of that commit                                                                        |
| Source        | The papers survey of 2026-10-06 (Top 12 items 2, 3, 4, 10, 11 and 12, and its "avoid" list). The survey is a working file and is not in the tree                           |
| Pull request  | Not opened yet. The pull request that carries this record is its review                                                                                                    |

## What changes

The owner approved a quality wave on 2026-10-06. Six techniques from the papers survey make the path tracer converge faster or look cleaner at the same sample count. This record writes each one as a part. A part has its own steps, so an agent can implement and merge it alone. The six parts change no public export. Parts 1 to 5 change the kernels' random numbers or estimators, so they change the images.

### Before

These are facts, read at `main` 55bde46.

- **Next-event estimation.** The function `direct` in `packages/radiance/src/kernels/trace.shade.ts` (lines 96 to 143) is the code's next-event estimation. It picks a light by `pickLight` (line 101). It spreads a point evenly over the light's triangle with the weights `b1 = sqrt(r.x) * (1 - r.y)` and `b2 = sqrt(r.x) * r.y` (lines 111 to 113). It returns `le * f * (cosSurface * cosLight * area / (chance * dist2))` (line 142). The `dist2` in the divisor is the source of the noise near a light.
- **The sampler.** `sample2` in `sampler.shade.ts` (lines 71 to 77) shuffles the sample index with `owen(index, key)`, where `key = hash2(pixelSeed, pair)`. It then reads two Sobol dimensions. The first is the identity matrix, written `reverseBits(shuffled)`. The second is `sobol1`, a loop over the bits of the index (lines 48 to 60). Each pair of dimensions has its own shuffle and its own scramble. `radiance` takes four pairs for each bounce (`PAIRS_PER_BOUNCE`, line 74), from pair `1 + bounce * 4`. Pair 0 is the pixel's jitter.
- **The jitter.** `trace` (lines 194 to 222) draws the jitter from `sample2(pixelSeed, index, 0)` (line 211). It adds the jitter to the pixel's corner. So the pixel filter is a box of one pixel.
- **The accumulator.** `accum` is `storage<array<vec4>, "read_write">` (line 66). Each pixel has one `vec4`: the sum of the radiance and the sample count in `w` (`ACCUM_STRIDE` is 1, `layout.shade.ts` line 31). The kernel writes it once for each frame (line 221). `show` (lines 243 to 250) divides the sum by the count and tone-maps it. `PathTracer.#allocate` checks `width * height * 16` bytes against the storage binding limit (`PathTracer.ts` line 343). That limit is 134,217,728 bytes.
- **The traversal.** A node is two `vec4` (`NODE_STRIDE` is 2, `layout.shade.ts` line 19). Word `a` is a child or a first primitive. Word `b` holds the primitive count and the split axis. `nearest` in `intersect.shade.ts` (lines 182 to 257) walks the TLAS and then each instance's BLAS with two stacks of 32 `u32`. It tests the nearer child first. `hitTriangle` returns a miss when `t >= limit` (line 176), so of two triangles at one `t` the first one found wins.
- **The builder.** `buildBlas` in `packages/radiance/src/accel/bvh.ts` builds a binary BVH with 16 bins. A leaf holds at most 4 primitives (`BVH_LEAF_SIZE`, line 32). A node at depth 30 is a leaf (`BVH_MAX_DEPTH`).
- **The gates.** `scripts/gates.mjs` holds `GATE` (16 by 16, 1,024 samples), `GATE_M2` (16 by 16, 256 samples) and `RENDER` (96 by 64, 64 samples). The differential gate (`scripts/gates/differential.mjs`) compares the GPU's mean radiance with the CPU oracle's. Both run the same kernel on the same samples. So the gate measures how far f32 rounding moves the two images apart. It does not measure how far either image is from the true image. The goldens (`scripts/__goldens__`) are 8-bit pictures of the examples.
- **The site's caps.** The site stops an example at 1,024 samples on a desktop and at 256 on a phone (pull request typeshade/radiance#27).

### After

Each part below gives the contract before and after. The table lists the parts and what each one does to the images.

| Part | Technique                                            | Paper                      | Main change                                        | Does the expected image change?                          |
| ---- | ---------------------------------------------------- | -------------------------- | -------------------------------------------------- | -------------------------------------------------------- |
| 1    | Solid-angle sampling of the chosen emissive triangle | Arvo 1995, Peters 2021     | `direct` in `trace.shade.ts`                       | No. The estimator stays unbiased                         |
| 2    | SZ sequences in place of the padded Sobol            | Ahmed et al. 2025          | `sampler.shade.ts`                                 | No. The estimator stays unbiased                         |
| 3    | Filter importance sampling with a tent filter        | Ernst et al. 2006          | The jitter in `trace`                              | Yes. The image is filtered, so it is softer              |
| 4    | G-MoN firefly removal                                | Buisine et al. 2021        | `accum`, `trace`, `show`, `PathTracer.ts`          | In the G-MoN output only. The plain mean does not change |
| 5    | Blue-noise diffusion by hierarchical pixel ordering  | Ahmed et al. 2020 (ZSobol) | The sample index in `sampler.shade.ts` and `trace` | No. Only the error's pattern changes                     |
| 6    | An 8-wide compressed BVH                             | Ylitie et al. 2017         | `bvh.ts`, `layout.shade.ts`, `intersect.shade.ts`  | No. The nearest hit stays the same                       |

**The order.** The parts are independent in code. Three couplings set the order of merging.

1. Parts 2 and 5 both change `sampler.shade.ts`. Part 5 builds on part 2's function names, so part 2 merges first.
2. Parts 3 and 4 change the images the goldens hold. Merge each one with its own golden update, and never two in one pull request.
3. Part 6 changes the layout that record 0001 fixes. Merge it last, because it is the largest change. It also needs the instrument of "The instrument" to measure its gain.

The default order is 1, 2, 3, 5, 4, 6. Decision 1 asks the owner to approve it.

### The instrument

This record needs one measure that the repository does not have. The differential gate cannot measure a gain in quality (see "Before"). The benchmark rows of `docs/benchmarks.md` measure speed and not error. So each part below names one of these numbers, and the first step of the first part to merge builds the tool.

- **Rounding agreement.** The differential gate's `mean`, `abs` and `rel` for the four scenes of `scripts/gates/differential.mjs`, at the bounds in `scripts/gates.mjs`. Each part records the measured numbers before and after. A part passes when the new numbers stay under the bounds. A part that cannot stay under the bounds amends the bound in the same pull request, by record 0002's rule, with the new measurement.
- **Error against a reference.** The relative root-mean-square error of a render's mean radiance against a reference image of the same scene. Define it per pixel on the luminance, `(L - Lref) / max(Lref, 0.001)`. Take the root of the mean of its square over the frame. The tool is a new script, `scripts/quality.mjs` (`bun run quality`). It renders a scene at a list of sample counts, compares each render with the reference, and prints one row for each count.
- **The reference.** One reference for each scene. The GPU pipeline renders it at the baseline commit with 16,384 samples a pixel. It is stored under `scripts/__goldens__/reference/` as raw `f32` files. One reference serves every unbiased part. Parts 3 and 4 change the expected image. Each of them renders its own reference at its own merge.
- **Samples to reach an error.** For a target error `E`, the smallest count in the list whose error is at most `E`. A part reports `E` and the counts before and after. The gain is the ratio of the counts.

Facts and inferences about the instrument:

- **Fact.** The oracle takes 20 to 38 seconds for a 16 by 16 render at 256 samples on four cores (`scripts/gates.mjs`, comment on `GATE_M2`). A reference at 16,384 samples on the oracle would take about 64 times that, so the reference runs on the GPU.
- **Inference.** On SwiftShader, 16,384 samples of a 16 by 16 frame is 4.2 million paths. At the measured 28,000 paths a second (`docs/benchmarks.md`, `cornell` at 128 by 128) that is about 150 seconds. This is not measured at 16 by 16.
- **Proposal.** The error is measured on the gate's scenes: `cornell` (the Cornell box), `triangles`, `instances` and `lights`, at 16 by 16. The sizes are those that CI renders already.

Step 0 of this record builds the tool. It is shared, so it is a step of its own, in its own pull request, before part 1.

## Part 1: solid-angle sampling of the chosen emissive triangle

### What changes (part 1)

`direct` in `trace.shade.ts` stops spreading the shading point's light sample evenly over the chosen triangle. It spreads the sample evenly over the solid angle that the triangle covers as seen from the shading point `s.p`. This is the spherical triangle sampling of Arvo (1995). A later step in this part moves to Peters (2021), which spreads the sample over the projected solid angle.

**Before.** The sample is a point on the triangle. Its density in area is `chance / area`. The estimator turns this into a density in solid angle with the factor `dist2 / cosLight` (lines 139 to 142). When the shading point is near the light, `dist2` is small and `cosLight` can be small. The weight then varies widely between samples. This is the noise near the Cornell box's ceiling light.

**After.** The sample is a direction `wi`. Its density in solid angle is `chance / omega`, where `omega` is the solid angle of the triangle. The estimator is `le * f * cosSurface * omega / chance`. It has no `dist2` and no `cosLight`. The weight depends on the BSDF and on `cosSurface` only. These are the new and changed functions:

| Function                              | File                 | What it does                                                                                                                     |
| ------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `arcTan(y, x)`                        | `materials.shade.ts` | The angle of the point `(x, y)` in radians, from products, sums and one division. It sits beside `turn`, and it replaces `atan2` |
| `solidAngle(a, b, c)`                 | `trace.shade.ts`     | The solid angle of the spherical triangle of the unit vectors `a`, `b` and `c`, by the formula of Van Oosterom and Strackee      |
| `sampleSolidAngle(a, b, c, omega, r)` | `trace.shade.ts`     | A unit direction inside the spherical triangle for `r` in `[0, 1)` squared, by Arvo's two steps. It returns the direction        |
| `direct`                              | `trace.shade.ts`     | Calls the two functions above. It finds the point on the triangle that the direction meets, and it keeps its other checks        |

**How `direct` finds the point.** `surfaceAt(light.instance, light.triangle, b1, b2, wi)` needs the barycentric weights `b1` and `b2` of the point that `wi` meets (line 127). The plane of the triangle gives them. With the normal `n = cross(e1, e2)`, the distance is `t = dot(n, p0 - s.p) / dot(n, wi)`. The point is `s.p + wi * t`. The weights follow from two dot products with `e1` and `e2`. The shadow ray then uses `dist = t` (line 136 uses `dist`).

**The tiny triangle.** When `omega` is under `OMEGA_MIN`, `direct` keeps the area sampling of lines 110 to 113 and the estimator of line 142. A far light has a small `omega`, and the formulas of `solidAngle` lose digits when the three vectors are almost equal. `OMEGA_MIN` is a constant of `trace.shade.ts`. This record sets it at 1e-4 sr as a default (decision 3). Both branches are unbiased. The branch reads a value that comes from `dot`, `cross`, `sqrt` and `/`, which rule 3 of record 0005 admits.

**The horizon.** A part of the spherical triangle can lie below the surface of the shading point. A direction there fails the test `dot(wi, s.ng) <= 0.` (line 124) and contributes 0. This is unbiased. It wastes samples when a light is half below the horizon. Peters's step (step 1.5) removes the waste.

### Rule 2 of record 0005, and how part 1 stays under it

Rule 2 forbids `atan` and `acos` in a comparison, an index, a loop bound or a lobe choice. It also says that a direction from an angle goes through `turn()` or its kind (sums and products). Arvo's sampler needs two angles. One is the solid angle `omega`, an `atan` of a ratio. The other is the scaled angle `xi * omega`, whose sine and cosine set the sampled direction. These are the facts and the inference:

- **Fact.** A direction set by `omega` steers a path. The 3 % divergence of 2026-10-05 came from `sin` and `cos` that were loose by 2^-11 (`turn` in `materials.shade.ts`, lines 106 to 131, and record 0005, "Before"). WGSL also lets a GPU's `atan` be loose by a few thousand ulp (inference from the same table, not read in the specification for this record).
- **Inference.** An error in `omega` moves the sampled direction. So `omega` must come from an exact function, and the rule's sense says the same as for `turn`.
- **Proposal, default.** `arcTan` is written from products, sums and one division. It reduces the argument to `[0, 1]` by `select`, then it applies an odd polynomial of the ratio. The reduction compares `abs(y)` with `abs(x)`. Both are plain values. The function adds no row to the compiler's determinism report except `/`. The sine and cosine of `xi * omega` come from `turn(xi * omega / TWO_PI)`, which is the rule's own tool. So part 1 needs no change to rule 2 and no change to `determinism-lists.ts`.
- **Fallback.** If a polynomial of degree 15 cannot reach an error of 2e-7 in step 1.1, the owner decides between two ways. First, a longer polynomial. Second, Amendment B of "Amendments owed", which admits `atan2` for `omega` alone. The record does not take the second way by default (decision 2).

### Why (part 1)

Area sampling puts the density on the light and turns it into a density in angle with a factor that grows near the light. Sampling the solid angle puts the density where the estimator needs it, so the factor disappears. This is the paper's claim, as the survey states it. The survey says solid-angle sampling "removes the 1/r^2 noise of area sampling near the Cornell box's ceiling light" (Top 12, item 2). The survey gives no factor for the gain. This record has not read the paper's numbers. Step 1.1 reads the paper and writes its number here as a labelled claim. The gain on `cornell` is an inference until step 1.4 measures it.

Alternatives. Keep area sampling and clamp the weight: this adds bias. Sample the light by a spherical rectangle: the Cornell light is two triangles, and the scene format is triangles. The projected solid angle first, as Peters does: it needs a warp of a bilinear function on the sphere and is the larger change. It stays as step 1.5.

### What it touches (part 1)

- **Files.** `trace.shade.ts` (`direct`, two new functions, one constant). `materials.shade.ts` (`arcTan`). The header comments of both files, which name the rules they lean on.
- **Records.** Record 0005: the header lines only, if the polynomial route works. Amendment B only on the fallback. Record 0001: nothing, since no buffer and no layout changes. Record 0002: the numbers of the new test (step 1.3) and the goldens it moves.
- **Gates.** The differential gate and the determinism gate, both at the bounds of `scripts/gates.mjs`. The render gate's goldens of the examples with an emissive triangle.
- **Not touched.** The light table `lights`, `pickLight` and the `chance` of each light.

### Steps (part 1)

1. **Step 1.1: `arcTan`, `solidAngle` and their tests.** Add `arcTan` to `materials.shade.ts` and `solidAngle` to `trace.shade.ts`. Read Arvo (1995), Van Oosterom and Strackee (1983) and Peters (2021) first, and write the formulas that `sampleSolidAngle` uses into the code's comments. Tests in `materials.test.ts` and a new `trace.test.ts`:
   - `arcTan` against `Math.atan2` in f64 on a grid of 4,096 angles, with a bound of 2e-7 rad. Verifies Design 0009.2.
   - `solidAngle` of the octant triangle `(x, y, z)` against `pi / 2`, with a bound of 1e-6. A triangle that fills a hemisphere, in the limit, against `2 pi` with a bound of 1e-4.
   - Both through `compile()` and through the language service (`getDiagnostics`), as `CLAUDE.md` asks, with no diagnostic.
     Done when the tests pass and `determinism.test.ts` reports no new row.

2. **Step 1.2: the sampler and the new `direct`.** Add `sampleSolidAngle`. Change `direct` as "What changes" says. Two tests. First, take 65,536 values of `r` on a grid and three triangles. Each sampled direction meets its triangle with `b1` and `b2` in `[0, 1]` and `b1 + b2 <= 1`. Second, take a 256 by 256 grid of `r`, one shading point and one BSDF. The estimator's mean equals the area estimator's mean within 1e-3 relative. Verifies Design 0009.3. Done when both tests pass on the CPU oracle.

3. **Step 1.3: the numbers.** Run `bun run gate:differential` before and after, and record the `mean`, `largest` and `outOfBounds` of each of the four scenes in the pull request. The bound of each scene stays. Run `bun run gate:determinism`. Run `UPDATE_GOLDENS=1 bun run gate:render` and show each old and new golden. Inference: the goldens of `cornell-box`, `first-scene`, `coloured-lights`, `lights` and `materials` move, because the noise at 64 samples changes. Done when the gates pass at the old bounds, or the bound is amended by record 0002's rule in the same pull request.

4. **Step 1.4: the quality number.** Run `bun run quality` on `cornell` and `lights` with the sample counts 16, 64, 256 and 1,024, before and after. Record the error at each count and the samples to reach `E`. `E` is the error that the old kernel has at 256 samples on that scene. The part's claim is the ratio of the counts. Write the row in `docs/benchmarks.md` under a new heading, "Quality". Done when the pull request shows the table. This record sets no minimum gain, because the survey's number is not read (decision 4).

5. **Step 1.5: Peters's projected solid angle (later, optional).** This step follows steps 1.1 to 1.4. A separate pull request replaces the uniform solid-angle sample by Peters's sample of the cosine-weighted solid angle. This removes the horizon waste. It needs the same `arcTan` and `turn`. It waits for the owner's go-ahead after step 1.4 gives its number (decision 5).

### Prove the instrument (part 1)

An instrument shows that it can fail before it is trusted to pass (record 0002, "prove the instrument"). Part 1 has two.

1. **The quality tool sees a bias.** Plant a fault in a scratch branch. Multiply `omega` by 1.1 in `direct`. Run `bun run quality` on `lights`. The error at 1,024 samples of the faulted kernel must stay at or above half of the floor that step 1.4 measures. The error of the unfaulted kernel must fall below that half. Inference: the direct light is most of `lights`, so a 10 % error in it gives an error floor of about 0.05 relative. Step 1.4 measures the floor and records it. Verifies Design 0009.4.
2. **The uniformity test sees a wrong sampler.** Plant the fault of using `r.x` for both numbers in `sampleSolidAngle`. The mean-equality test of step 1.2 must fail. It is a test of a test: the pull request names the planted fault and the failing message.
