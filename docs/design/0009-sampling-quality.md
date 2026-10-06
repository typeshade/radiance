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
  - packages/radiance/src/accel/wide.ts
  - packages/radiance/src/kernels/gmon.shade.ts
  - packages/radiance/src/internal.ts
  - packages/radiance/__api__
  - packages/radiance/src/renderers/PathTracer.ts
  - packages/radiance/src/renderers/scene-pack.ts
  - scripts/gates.mjs
  - scripts/gates/differential.mjs
  - scripts/gates/determinism.mjs
  - scripts/bench.mjs
  - scripts/oracle.ts
  - scripts/quality.mjs
  - scripts/sz-matrices.ts
  - scripts/__goldens__
  - site/public/stills
  - PRODUCT.md
  - site/src/content/docs/guide/checked-on-the-cpu.mdx
  - docs/benchmarks.md
  - docs/design/0001-scene-data-model.md
  - docs/design/0002-verification.md
  - docs/design/0003-public-api.md
  - docs/design/0005-determinism.md
compiler: []
---

**Document control**

| Field         | Value                                                                                                                                                                                                                                                                                                                                                      |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity      | Design record 0009, status `draft`. Six parts, 21 decisions, 12 amendments owed (A to L). Branch `wt/Q`                                                                                                                                                                                                                                                    |
| Date          | 2026-10-06 (UTC), the date of authorship. The owner approved the quality wave on the same date                                                                                                                                                                                                                                                             |
| Author        | Written in an agent session for the owner. The owner's review is the approval                                                                                                                                                                                                                                                                              |
| Applicability | The kernels in `packages/radiance/src/kernels`, the host in `packages/radiance/src/accel` and `src/renderers`, and the gates in `scripts/`. The stills in `site/public/stills` change with parts 2, 3 and 5, and part 2 may amend two prose lines (`PRODUCT.md` and `checked-on-the-cpu.mdx`). One public member, `PathTracer.fireflyFilter` (decision 11) |
| Baseline      | `main` at 55bde46. The compiler pinned at 596c805. Every line number below is a line of that commit. `main` has since moved to a89aaa1. Of the cited files, only `scripts/gates.mjs` changed between the two                                                                                                                                               |
| Source        | The papers survey of 2026-10-06 (Top 12 items 2, 3, 4, 10, 11 and 12, and its "avoid" list). The survey is a working file and is not in the tree                                                                                                                                                                                                           |
| Pull request  | Not opened yet. The pull request that carries this record is its review. The parts were committed one by one on branch `wt/Q`, from 10677bb                                                                                                                                                                                                                |

## What changes

The owner approved a quality wave on 2026-10-06. Six techniques from the papers survey make the path tracer converge faster or look cleaner at the same sample count. This record writes each one as a part. A part has its own steps, so an agent can implement and merge it alone. Five parts change no public export. Part 4 adds one member to `PathTracer` (decision 11). Parts 1, 2, 3 and 5 change the kernels' random numbers or estimators, so they change the images. Part 4 changes the image on the canvas only when the filter is on. Part 6 changes an image only where a tie in `t` is decided otherwise.

### Before

These are facts, read at `main` 55bde46.

- **Next-event estimation.** The function `direct` in `packages/radiance/src/kernels/trace.shade.ts` (lines 96 to 143) is the code's next-event estimation. It picks a light by `pickLight` (line 101). It spreads a point evenly over the light's triangle with the weights `b1 = sqrt(r.x) * (1 - r.y)` and `b2 = sqrt(r.x) * r.y` (lines 111 to 113). It returns `le * f * (cosSurface * cosLight * area / (chance * dist2))` (line 142). The `dist2` in the divisor is the source of the noise near a light.
- **The sampler.** `sample2` in `sampler.shade.ts` (lines 71 to 77) shuffles the sample index with `owen(index, key)`, where `key = hash2(pixelSeed, pair)`. It then reads two Sobol dimensions. The first is the identity matrix, written `reverseBits(shuffled)`. The second is `sobol1`, a loop over the bits of the index (lines 48 to 60). Each pair of dimensions has its own shuffle and its own scramble. `radiance` takes four pairs for each bounce (`PAIRS_PER_BOUNCE`, line 74), from pair `1 + bounce * 4`. Pair 0 is the pixel's jitter.
- **The jitter.** `trace` (lines 194 to 222) draws the jitter from `sample2(pixelSeed, index, 0)` (line 211). It adds the jitter to the pixel's corner. So the pixel filter is a box of one pixel.
- **The accumulator.** `accum` is `storage<array<vec4>, "read_write">` (line 66). Each pixel has one `vec4`: the sum of the radiance and the sample count in `w` (`ACCUM_STRIDE` is 1, `layout.shade.ts` line 31). The kernel writes it once for each frame (line 221). `show` (lines 243 to 250) divides the sum by the count and tone-maps it. `PathTracer.#allocate` checks `width * height * 16` bytes against the storage binding limit (`PathTracer.ts` line 343). That limit is 134,217,728 bytes.
- **The traversal.** A node is two `vec4` (`NODE_STRIDE` is 2, `layout.shade.ts` line 19). Word `a` is a child or a first primitive. Word `b` holds the primitive count and the split axis. `nearest` in `intersect.shade.ts` (lines 182 to 256) walks the TLAS and then each instance's BLAS with two stacks of 32 `u32`. It tests the nearer child first. `hitTriangle` returns a miss when `at >= limit` (line 170), so of two triangles at one `t` the first one found wins.
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
| 6    | An 8-wide compressed BVH                             | Ylitie et al. 2017         | `bvh.ts`, `layout.shade.ts`, `intersect.shade.ts`  | No, except where a tie in `t` is decided otherwise       |

**The order.** The parts are independent in code. Four couplings set the order of merging.

1. Parts 2 and 5 both change `sampler.shade.ts`. Part 5 builds on part 2's function names, so part 2 merges first.
2. Parts 1, 2, 3 and 5 change the images the goldens hold. Merge each one with its own golden update, and never two in one pull request. Part 6 moves a golden only where a tie in `t` is decided otherwise.
3. Part 6 changes the layout that record 0001 fixes. Merge it last, because it is the largest change. It measures its gain with `bun run bench` (step 6.4), so it does not need the quality instrument.
4. Parts 4 and 5 use different words of `TraceParams.path`: part 4 uses `path.z` and part 5 uses `path.w`. So their order does not change the layout.

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

2. **Step 1.2: the sampler and the new `direct`.** Add `sampleSolidAngle`. Change `direct` as "What changes" says. Three tests. First, take 65,536 values of `r` on a grid and three triangles. Each sampled direction meets its triangle with `b1` and `b2` in `[0, 1]` and `b1 + b2 <= 1`. Second, take a 256 by 256 grid of `r`, one shading point and one BSDF. The estimator's mean equals the area estimator's mean within 1e-3 relative. Third, take a triangle with `omega` of 5e-5 sr. `direct` takes the area branch, and its mean equals the area estimator's mean within 1e-3 relative. Verifies Design 0009.3. Done when the three tests pass on the CPU oracle.

3. **Step 1.3: the numbers.** Run `bun run gate:differential` before and after, and record the `mean`, `largest` and `outOfBounds` of each of the four scenes in the pull request. The bound of each scene stays. Run `bun run gate:determinism`. Run `UPDATE_GOLDENS=1 bun run gate:render` and show each old and new golden. Inference: the goldens of `cornell-box`, `first-scene`, `coloured-lights`, `lights` and `materials` move, because the noise at 64 samples changes. Done when the gates pass at the old bounds, or the bound is amended by record 0002's rule in the same pull request.

4. **Step 1.4: the quality number.** Run `bun run quality` on `cornell` and `lights` with the sample counts 16, 64, 256 and 1,024, before and after. Record the error at each count and the samples to reach `E`. `E` is the error that the old kernel has at 256 samples on that scene. The part's claim is the ratio of the counts. Write the row in `docs/benchmarks.md` under a new heading, "Quality". Done when the pull request shows the table. This record sets no minimum gain, because the survey's number is not read (decision 4).

5. **Step 1.5: Peters's projected solid angle (later, optional).** This step follows steps 1.1 to 1.4. A separate pull request replaces the uniform solid-angle sample by Peters's sample of the cosine-weighted solid angle. This removes the horizon waste. It needs the same `arcTan` and `turn`. It waits for the owner's go-ahead after step 1.4 gives its number (decision 5).

### Prove the instrument (part 1)

An instrument shows that it can fail before it is trusted to pass (record 0002, "prove the instrument"). Part 1 has two.

1. **The quality tool sees a bias.** Plant a fault in a scratch branch. Multiply `omega` by 1.1 in `direct`. Run `bun run quality` on `lights`. The error at 1,024 samples of the faulted kernel must stay at or above half of the floor that step 1.4 measures. The error of the unfaulted kernel must fall below that half. Inference: the direct light is most of `lights`, so a 10 % error in it gives an error floor of about 0.05 relative. Step 1.4 measures the floor and records it.
2. **The uniformity test sees a wrong sampler.** Plant the fault of using `r.x` for both numbers in `sampleSolidAngle`. The mean-equality test of step 1.2 must fail. It is a test of a test: the pull request names the planted fault and the failing message.

## Part 2: SZ sequences in place of the padded Sobol sequence

### What changes (part 2)

`sample2` in `sampler.shade.ts` stops reading two Sobol dimensions. It reads two of the four dimensions of an SZ sequence (Ahmed et al. 2025). The hash-based Owen scrambling and the shuffle of the sample index stay. Only the matrices change, and the way pairs share a shuffle.

**Before.** `sample2(pixelSeed, index, pair)` (lines 71 to 77) makes `key = hash2(pixelSeed, pair)`. It shuffles the index with `owen(index, key)`. The first number is `owen(reverseBits(shuffled), hash(key ^ 1))`. The second is `owen(sobol1(shuffled), hash(key ^ 2))`. Each pair has its own key. So each pair is a Sobol `(0, 2)`-sequence, and two pairs are independent of each other.

**After.** Four dimensions share one shuffled index. A pair of dimensions is half of a group.

- The group of pair `p` is `p >> 1`. The half is `p & 1`.
- `key = hash2(pixelSeed, p >> 1)`, and `shuffled = owen(index, key)`.
- Dimension `d` of the group is `sz(shuffled, d)`: the XOR of the column words of the matrix of dimension `d` for each set bit of `shuffled`. This is the loop of `sobol1` with a table in place of the recurrence `v ^ (v >> 1)`.
- The pair's first number is `owen(sz(shuffled, 2 * half), hash(key ^ (1 + 2 * half)))`. The second is `owen(sz(shuffled, 2 * half + 1), hash(key ^ (2 + 2 * half)))`. The hash constants are new, so no number equals an old one.

A pair keeps its two-dimensional stratification. Two pairs of one group are stratified together in four dimensions. This is the paper's claim, from the survey: every group of four dimensions and its pairs are "fully multi-stratified".

**The pair numbers move.** `radiance` takes pair `1 + bounce * 4` (line 167). That puts the light's point in the second half of a group and the BSDF's direction in the first half of the next group. The two would not share a shuffle. So the numbering becomes `pair = 2 + bounce * PAIRS_PER_BOUNCE`. Then, for a bounce:

| Pair of the bounce | Group half | Dimensions it holds                                          | Line today |
| ------------------ | ---------- | ------------------------------------------------------------ | ---------- |
| `pair + 0`         | first      | the light's point `r` for `direct`                           | 171        |
| `pair + 1`         | second     | the BSDF's direction (two numbers)                           | 169        |
| `pair + 2`         | first      | the light pick (`choice.x`) and the lobe choice (`choice.y`) | 168        |
| `pair + 3`         | second     | Russian roulette (`.x`). `.y` is spare                       | 183        |

Pair 0 is the pixel's jitter, as now. Pair 1 is free. Inference: the thin lens of milestone M3 (`lens.z` and `lens.w` of `TraceParams`, unused today) takes pair 1. Then the jitter and the lens point share a group. The light point and the BSDF direction of one bounce are in one four-dimensional group. This is the pairing that next-event estimation with multiple importance sampling needs.

**The matrices' storage.** One table holds the four dimensions. It is a module-level constant of `sampler.shade.ts`:

```ts
const SZ: array<u32, 128> = array<u32, 128>(/* 4 dimensions x 32 column words */);
```

- Word `32 * d + k` is column `k` of dimension `d`, as a 32-bit word whose top bit is the first output bit. It is 512 bytes.
- One group's table serves every group, as Burley's padding serves every pair. The shuffle and the scrambles make the groups independent.
- A table in the code needs no buffer, no uniform and no change to record 0001. Fact: the surface document (§12, "Module constants") says that an array constant "carries its value as an expression every backend emits and evaluates". This record has not read the emitted code.
- Inference, from memory of WGSL and not checked here: WGSL may refuse a runtime index into a module-scope `const` array in some implementations. Tint copies it to a `var`. The probe of step 2.2 settles this.

**The fallback if the table does not compile.** Take this path when one output refuses the table or reads another word. The outputs are WGSL, GLSL and the CPU oracle.

1. Open an item in record 0006, "a module constant array indexed by a runtime value", with the failing output as its evidence. A compiler proposal follows by the compiler's procedure.
2. Until that proposal lands, write `szColumn(d, k)` as a `select` tree over the 32 words of the dimension. The tree has no table and no index. The hit on speed is measured at step 2.4.
3. If the tree is too slow, put the 128 words in the uniform block as `array<vec4u, 32>`. That is an amendment of record 0001 (the block grows by 512 bytes). Amendment C of "Amendments owed" is its text.

### Why (part 2)

The Sobol sequence gives `(0, 2)` stratification in each pair and nothing across pairs. A path's light point and BSDF direction are then strata of two separate pairs, and their product is not stratified. The SZ construction gives a four-dimensional group a joint stratification, at the same integer cost. The paper's claim, from the survey: error up to 1.93 times lower than a Sobol sequence of the same size. The survey does not say for which integrands. Inference: the gain on a path tracer is below the best case, because few integrands are smooth in all four dimensions. Step 2.4 measures it. The paper was not re-read for this record, and step 2.1 reads it.

Alternatives. Keep Sobol and pad (the status quo). Use a blue-noise sampler with tables (Heitz et al. 2019): it covers eight dimensions and needs a binding, and no storage binding is free (record 0001, rule 1). Use base-3 sequences (Ostromoukhov et al. 2024): they do not fit the power-of-two caps (survey, "rest").

### What it touches (part 2)

- **Files.** `sampler.shade.ts` (`sample2`, the table, a new `sz`, the header comment). `trace.shade.ts` (`PAIRS_PER_BOUNCE`, `radiance` lines 167 to 183). A new script, `scripts/sz-matrices.ts`, that builds the table.
- **Records.** Record 0005: the header comments only, because rule 1 is unchanged. Record 0001: nothing, unless the last fallback runs (Amendment C). Record 0006: one new item if the table does not compile.
- **Gates.** The differential and determinism gates at their bounds. The render gate's goldens, all of them: every random number changes.
- **Not touched.** `hash`, `hash2`, `laineKarras`, `owen`, `toUnit`. They are exact and they stay.

### Steps (part 2)

1. **Step 2.1: the matrices and the net test.** Read the paper (arXiv 2505.20434) and the construction of its matrices from 2 by 2 block symbols. Write `scripts/sz-matrices.ts`. It prints the 128 words as a TypeScript array literal. Add the literal to `sampler.shade.ts`. State the licence of any code or table taken from the paper in the pull request. Add the test "the first 4^m points of the four dimensions form a net". Take the property exactly as the paper defines it. Test `m` from 1 to 4. For each shape of the elementary intervals, check that each cell holds one point. Test each of the six pairs for `m` up to 12 in base 2. Verifies Design 0009.6. Done when the test passes. The pull request records the number of shapes and cells checked.
2. **Step 2.2: the compile probe.** Compile a probe module with the table and a loop that reads `SZ[32 * d + k]` for a runtime `k`. Compile it for WGSL and for GLSL. Run it on the CPU oracle. Draw 256 values of `(index, d)` from the hash. The three outputs must give the same words. Record the three outputs and the diagnostics in the pull request. Run `bun run check:shaders` and the language service's `getDiagnostics` on `sampler.shade.ts`. Done when the three agree and there is no diagnostic. If they do not, take the fallback above and stop this step.
3. **Step 2.3: `sample2` and the call sites.** Change `sample2` and `radiance` as "What changes" says. Update the comment of `PAIRS_PER_BOUNCE`. Test: for 4,096 indices, the pair `(0, 1)` of the group has the `(0, 2)` property for each aligned block of 2^m indices, `m` up to 10. The test reads the sampler through `compile()` on the CPU oracle and through the language service. Done when it passes and `determinism.test.ts` reports no new row.
4. **Step 2.4: the numbers.** Record `bun run gate:differential` before and after for the four scenes. Run `bun run gate:determinism`. Rewrite the goldens with `UPDATE_GOLDENS=1 bun run gate:render` and show each pair of pictures. Run `bun run quality` on `cornell`, `triangles`, `instances` and `lights` at 16, 64, 256 and 1,024 samples, before and after. Record the samples to reach `E`, as step 1.4 defines it. Run `bun run bench` on `cornell` and add a row before and after, for the sampler's cost in `frame ms`. Done when the pull request shows these numbers.

### Prove the instrument (part 2)

1. **The net test fails on a wrong matrix.** Plant the fault of setting column 3 of dimension 2 to 0. The net test of step 2.1 must fail. The failure message names the shape of the elementary interval and the cell. The pull request names the shape.
2. **The quality tool sees a correlated pair.** Plant the fault of using the first number of a pair as its second. The quality tool on `cornell` must give an error at 1,024 samples above the error of part 1's kernel. Inference: a pair read along its diagonal covers the square badly, so the error rises. Step 2.4 records the numbers.

## Part 3: filter importance sampling with a tent filter

### What changes (part 3)

The pixel jitter in `trace` goes through the inverse cumulative distribution of a tent filter. A sample then lands in a wider area than its own pixel, with a density that falls off linearly. Each pixel's mean stays a plain mean. This is Filter Importance Sampling (Ernst et al. 2006).

**Before.** `trace` (`trace.shade.ts`, lines 211 to 215) draws `jitter = sample2(pixelSeed, index, 0)`. It forms `ndc.x = ((px + jitter.x) / width) * 2 - 1`, and `ndc.y` likewise. The sample lies in the pixel's own square. The filter is a box of one pixel.

**After.** The kernel computes an offset from the same two numbers and adds it to the pixel's centre:

```ts
/** The offset in pixels of a sample drawn from a tent filter of half-width FILTER_RADIUS, for u in [0, 1). */
export function tentOffset(u: f32): f32 {
  const left = sqrt(2. * u) - 1.;
  const right = 1. - sqrt(2. * (1. - u));
  return FILTER_RADIUS * select(left, right, u >= 0.5);
}
```

- `ndc.x = ((f32(px) + 0.5 + tentOffset(jitter.x)) / f32(width)) * 2. - 1.`, and `ndc.y` the same with `jitter.y`.
- `FILTER_RADIUS` is a constant of `trace.shade.ts`, `1.0`, in pixels of the traced frame. The tent is zero at distance 1 pixel and above.
- The filter is separable: one tent in x and one in y, each from its own number.
- The weight of a sample is 1. Fact: a filter that is positive in its whole support has a constant weight `f / pdf`. So the plain mean is the filtered pixel (survey, Top 12, item 4).

**What the constants mean.** These are arithmetic, not measurements. The box filter of one pixel has a variance of 1/12 pixel squared and a standard deviation of 0.289 pixel. The tent of half-width `r` has a variance of `r^2 / 6`. At `r = 1` the standard deviation is 0.408 pixel. So the filter blurs about 1.4 times as much as the box. The default radius is a decision (decision 8).

**What it adds to the code.** One function and one constant. Each draws no new random number. `sqrt` is a rule 3 row. The `select` reads `u >= 0.5`, and `u` comes from `toUnit` of an integer, so the comparison is exact on every device. Rule 2 does not apply, because no transcendental feeds the comparison. A Gaussian filter would need `log` and `cos` (Box-Muller). The survey lists this under "avoid", so this record does not use one.

**The preview.** A frame at a lower resolution (`preview` above 1) traces one pixel for each block (`PathTracer.ts`, `#traced`). The kernel measures the radius in traced pixels. So a preview frame is blurred over its blocks. Inference: this is harmless, because a preview shows a moving camera. It is a decision (decision 9).

**The edge of the frame.** A sample of a border pixel may land up to one pixel outside the frame. The camera ray is still defined there. The estimate at the border is a filter over a wider area. No code clamps it.

### Why (part 3)

A box filter of one pixel lets high frequencies alias into the pixel. A wider filter with a positive, smooth kernel removes the worst of it. The usual cure is to splat each sample into several pixels, which needs atomic adds on floats. WGSL has none (survey, "avoid", and record 0005, rule 4). Filter importance sampling moves the sample instead of the weight. Each pixel stays the only writer of its own accumulator. This is the paper's claim, from the survey: "a better filter than the implicit box costs no splatting and no atomics". The paper gives no number, because the gain is in the look. Inference: the tent removes stair-steps on edges at the price of some softness. The owner judges the look (decision 8).

Alternatives. A tabulated Blackman-Harris or Mitchell inverse CDF in the uniform block. The survey lists it. It needs room in `TraceParams` and a record 0001 amendment. A Gaussian by Box-Muller. It needs `log` and `cos` to set a ray, which rule 2 forbids. A narrower tent with `r = 0.5`. It is sharper, and it gains less against the box.

### What it touches (part 3)

- **Files.** `trace.shade.ts` (`tentOffset`, `FILTER_RADIUS`, lines 211 to 215, the header comment). No other kernel.
- **Records.** Record 0005: nothing. Record 0001: nothing, since no buffer and no layout changes. Record 0002: the goldens, and the reference of this part.
- **Gates.** The render gate: every golden changes, because every image is filtered. Fact: `RENDER` holds a mean difference of 1 in 255 and a channel difference of 4 (`scripts/gates.mjs`, line 74). Inference: a blur of this size moves the pixels at edges by more than 4 levels, so the goldens must be rewritten. The differential and determinism gates stay at their bounds, because the GPU and the oracle run the same kernel.
- **The site.** The stills (`site/public/stills`, `bun run capture:stills`) change with the goldens. No page of the site, the guide or `docs/plan.md` names the jitter or the box filter (a search of `site/src`, `docs` and `README.md` finds none).
- **Not touched.** `sample2` and the pair numbers. The jitter is still pair 0.

### Steps (part 3)

1. **Step 3.1: `tentOffset` and its test.** Add the function and the constant. Tests in the new `trace.test.ts`:
   - The offset of 65,536 stratified `u` values lies in `[-1, 1]`, has a mean of 0 within 1e-4, and a variance of `1 / 6` within 1e-3.
   - The empirical cumulative distribution at 33 points equals the tent's `F(x)` within 1e-3. `F(x) = (1 + x)^2 / 2` for `x` in `[-1, 0]` and `1 - (1 - x)^2 / 2` for `x` in `[0, 1]`.
   - The function is continuous at `u = 0.5`: `tentOffset(0.5)` is 0, and the difference of the two sides at `u = 0.5 -/+ 1e-6` is under 4e-3.
   - The test runs through `compile()` on the oracle and through the language service. Verifies Design 0009.8.
     Done when the tests pass and `determinism.test.ts` reports no new row.
2. **Step 3.2: the kernel and its reference.** Change the jitter in `trace`. Render the new reference of each gate scene at 16,384 samples (the instrument), and keep it beside the old one under `scripts/__goldens__/reference/`. Rewrite the goldens with `UPDATE_GOLDENS=1 bun run gate:render` and show each old and new picture. Done when the render gate passes on the new goldens.
3. **Step 3.3: the numbers.** Record the differential and determinism gates before and after. Run `bun run quality` on the four scenes against the new reference. Record two more numbers. First, the width in pixels of the 10 to 90 percent rise across the edge of the Cornell box's left wall, before and after. Measure it on a 16,384-sample reference. Second, the error against the old reference. This one gives how far the filter moves the image. It is not a gain. Done when the pull request shows the table.
4. **Step 3.4: the stills.** Run `bun run capture:stills` as the README's checks describe. Commit the new stills in the same pull request. Done when `bun run gate:site` passes.

### Prove the instrument (part 3)

1. **The moment test fails on a wrong radius.** Plant the fault `FILTER_RADIUS = 1.1`. The variance test must fail with the measured variance in its message. Plant the fault of dropping the `select`, so the left branch serves all `u`. The distribution test must fail at the first check above 0.5.
2. **The edge-width number moves.** Set `FILTER_RADIUS` to 0, a point filter. The edge width must fall below the box's width. At 1 it must rise above the box's width. The pull request records the widths at 0, 0.5 and 1.

## Part 4: G-MoN firefly removal with k buckets in the accumulator

### What changes (part 4)

The accumulator `accum` holds k buckets for each pixel, in its one buffer. The samples of one frame go to one bucket, chosen by the frame index. The present pass can show the median of the bucket means, blended with the plain mean by the Gini coefficient of the bucket means. This is G-MoN (Buisine et al. 2021). The plain mean stays readable, and it is the default output.

**Before.** `accum` is one `vec4` for each pixel: the sum of the radiance and the sample count in `w` (`trace.shade.ts`, line 66). `trace` writes it once for each frame, with `accum[pixel] += vec4(sum, f32(params.frame.w))` (line 221). `show` reads one `vec4` and divides (lines 243 to 250). `PresentParams` is one `vec4`, `view`, and its `w` is unused (lines 47 to 54). `scene-pack.ts` writes `path: [o.bounces, o.rouletteFrom, 0, 0]` (line 376), so `path.z` and `path.w` are 0. The host clears `accum` at a reset, with `width * height * 4` floats (`PathTracer.ts`, line 234). `readRadiance` divides each cell by its count (lines 298 to 308).

**After.** These are the contract and the code that follows from it.

- **The layout in bytes.** An element of `accum` is still one `vec4` of 16 bytes: `(sum r, sum g, sum b, count)`. The element of bucket `b` of the pixel `p` is at index `b * pixels + p`. Here `pixels` is `params.frame.x * params.frame.y`, the pixels of the traced frame, and `p = py * width + px`. A bucket is one contiguous region, so the adjacent invocations of a tile write adjacent elements, as they do now. Bucket `b` starts at byte `b * pixels * 16`. Each start is 16-byte aligned, because `pixels * 16` is a multiple of 16.
- **The count of buckets, k.** The host sets `k = min(GMON_BUCKETS, floor(134,217,728 / (width * height * 16)))`. `GMON_BUCKETS` is 8 and sits in `layout.shade.ts` beside `ACCUM_STRIDE`. The buffer is `k * width * height * 16` bytes. It never passes the storage binding limit, and the check of `#allocate` (line 343) stays. A frame of more than 8,388,608 pixels still throws, as it does now. Below four buckets the median means too little, so `GMON_MIN_BUCKETS` is 4, and the G-MoN output is then the plain mean. Decision 10 holds these numbers.
- **The cost in memory.** These are arithmetic.

| Frame     | Pixels    | k   | `accum` bytes | `accum` bytes today |
| --------- | --------- | --- | ------------- | ------------------- |
| 1024x1024 | 1,048,576 | 8   | 134,217,728   | 16,777,216          |
| 1280x720  | 921,600   | 8   | 117,964,800   | 14,745,600          |
| 1920x1080 | 2,073,600 | 4   | 132,710,400   | 33,177,600          |
| 3840x2160 | 8,294,400 | 1   | 132,710,400   | 132,710,400         |

- **The uniform words.** `path.z` is the bucket the dispatch writes. `path.w` stays free for part 5. Both words were "flags (0), unused". `TraceParams` keeps its 144 bytes. `PresentParams` gains `accum: vec4u = (k, mode, pixels, 0)`, and it grows from 16 to 32 bytes. The field `view` stays at byte 0. The field `accum` is at byte 16. The block has an alignment of 16 bytes and a size of 32 bytes, with no padding. Mode 0 shows the plain mean. Mode 1 shows the G-MoN output. Decision 14 holds this choice.
- **The write.** `trace` writes `accum[params.path.z * pixels + pixel] += vec4(sum, f32(params.frame.w))`. It is still one write for each pixel in each frame, outside the sample loop. No two invocations write one element. Rule 4 of record 0005 holds.
- **The bucket.** The host counts the frames since the last reset, in a new private field `#frames` of `PathTracer`. The bucket of a frame is `#frames % k`. The first render of a renderer takes one sample, while `#nsPerPath` is undefined (`PathTracer.ts`, lines 242 to 244). That is a warm-up. A restart does not repeat it, and `#frames` is 0 again after a restart. On a fresh renderer, the warm-up frame is frame 0 and goes to bucket 0. Decision 12 holds this choice.
- **The clear.** The reset clear grows. Line 234 of `PathTracer.ts` writes `width * height * 4` floats today. After this part it writes `k * width * height * 4` floats, so it covers every bucket.
- **The plain mean.** `show` in mode 0 adds the `k` elements of the pixel in bucket order, then divides. `readRadiance` adds them in bucket order in f64 and then divides. Both give the same value as today up to the order of float additions. The goldens and the differential gate read the plain mean. Inference: no golden changes, because a difference of one unit in the last place does not move an 8-bit value except by chance. Step 4.4 measures it.
- **The G-MoN output.** `show` in mode 1 reads the `k` elements. It skips a bucket whose count is 0. Let `m` be the count of the other buckets. When `m` is under `GMON_MIN_BUCKETS`, the output is the plain mean. Otherwise it is `mix(plain, median, w)`, where `median` is the median of the `m` bucket means, channel by channel, and `w` is the blend weight. The median of an even count is the mean of the two middle values.
- **The contract of the blend.** The weight `w` is in `[0, 1]`. These four properties hold for the output, and the test of step 4.1 holds them. P1: when the `m` means are equal, the output is the plain mean, bit for bit. P2: when one mean has at least 10 times the luminance of each other mean, the output is the median of the means. P3: the output is continuous in the means. P4: each channel of the output lies between the smallest and the largest bucket mean.
- **The default formula.** Fact: the survey says that G-MoN blends the plain mean and the median of the bucket means (Top 12, item 10). The weight comes from the Gini coefficient of the buckets. The survey gives no formula. Proposal: `gn = G * m / (m - 1)`. Here `G` is the Gini coefficient of the luminances of the `m` means. Sort them upward, then `G = sum((2 i - m - 1) x_i) / (m * sum(x_i))`. When the sum is 0, `G` is 0. Then `t = clamp((gn - GMON_G_LOW) / (GMON_G_HIGH - GMON_G_LOW), 0., 1.)` and `w = t * t * (3. - 2. * t)`, with `GMON_G_LOW` 0.25 and `GMON_G_HIGH` 0.5. This is a smoothstep written out. The code does not call `smoothstep`. The compiler at pin 596c805 reports `smoothstep` as an inherited row (`vendor/typeshade/src/core/passes/determinism.ts`, line 258). `ALLOWED` and `VALUE_ONLY` in `determinism-lists.ts` (lines 20 to 40) do not admit it, and `determinism.test.ts` lints every `*.shade.ts`. The written-out form adds only `/`, which rule 3 of record 0005 admits. So Amendment E admits no new row. Arithmetic: seven means of 1 and one of 10 give `gn` of 0.53, so `t` and `w` are 1. Seven means of 1 and one of 3 give `gn` of 0.2, so `t` and `w` are 0. Decision 13 holds this choice, and step 4.1 reads the paper and replaces the formula where the paper differs.
- **The sort.** The median and `G` need the means in order. A fixed network of 19 compare and exchange steps sorts eight values with `min` and `max`. A bucket that does not count takes the value 3.0e38, so it sorts last. The median and `G` read the sorted values by `select`, as `pick` does in `intersect.shade.ts`. No loop bound and no index depends on a float. Rule 2 of record 0005 holds.
- **The public member.** `PathTracer` gains `fireflyFilter: boolean`, default `false`. It sets the mode of `PresentParams`. It changes no kernel and no accumulation. Record 0003 owes an amendment for the new member (Amendment F), and `gate:api` changes its bake. Decision 11 holds this choice.
- **The split.** Rule 4 says that the bits of the plain mean depend on the split of the samples into frames. The G-MoN output depends on the split more. A different split puts different samples into each bucket, so the median moves by more than a rounding. Fact: the same seed, device and split give the same output. Inference: two splits of one seed give two outputs that agree only within the noise of the buckets.
- **The oracle.** The oracle renders all samples as one frame (`oracle.ts`, lines 68 to 75). It writes bucket 0 only, and it needs `width * height` cells as now. The G-MoN output has no oracle image. The pure function of step 4.1 has an oracle test instead.

### Why (part 4)

One sample of very large radiance, a firefly, sits in the mean for the rest of the render. The mean of the bucket that holds it is large, and the median of the bucket means ignores it. The paper's claim, from the survey: the filter removes the fireflies before any denoiser sees them. It needs no atomics, and a converged pixel keeps its unbiased mean. The survey also says that the median is biased for a finite count of samples. So the plain mean stays the default, and fitting (milestone M5) reads the plain mean. This record has not read the paper's numbers. Step 4.1 reads it.

Alternatives. Clamp each sample's radiance: simple, and it adds bias at every pixel. Reweight firefly samples (Zirr et al. 2018): the survey lists it as a candidate to compare. This record does not compare. Add a second buffer for the buckets: no storage binding is free (record 0001, rule 1). Choose the bucket by the sample index: it needs one write for each sample and breaks rule 4.

### What it touches (part 4)

- **Files.** `layout.shade.ts` (`GMON_BUCKETS`, `GMON_MIN_BUCKETS`, the thresholds). `trace.shade.ts` (`PresentParams`, the write at line 221, `show`). A new `gmon.shade.ts` for the sort, the median and the weight. `PathTracer.ts` (`#allocate`, `#frames`, `render`, `readRadiance`, `#present`, the member). `scene-pack.ts` (the `path` word). `internal.ts` (the new constants).
- **Records.** Record 0001: the layout of `accum` and of `PresentParams` (Amendment D). Record 0005: rule 4 and the split (Amendment E). Record 0003: the new member (Amendment F). Record 0002: the new determinism check and the gate's reading of the plain mean (Amendment G).
- **Gates.** `gate:render`, `gate:differential` and `gate:determinism` read the plain mean and keep their bounds. `gate:api` changes its bake. The determinism gate gains one check (step 4.3).
- **Tests.** `layout.test.ts` (the 32 bytes of `PresentParams`, the constants). A new `gmon.test.ts`. A new test of the buckets in `kernels.test.ts`.
- **Not touched.** The goldens. The sampler. The traversal.

### Steps (part 4)

1. **Step 4.1: the pure function and its test.** Read Buisine et al. (2021). Write `gmon.shade.ts`: the sort, the median, the weight and the blend. Write the paper's formula into its comments if it differs from the default. Test through `compile()` on the oracle and through the language service (`getDiagnostics`):
   - P1 to P4 on the cases above, and on 4,096 means drawn from the hash.
   - The two cases of arithmetic: `gn` of 0.53 gives `w` of 1, and `gn` of 0.2 gives `w` of 0.
   - A bucket with count 0 changes no output. Verifies Design 0009.13.
     Done when the tests pass and `determinism.test.ts` reports no new row. The weight uses `clamp` and arithmetic and not `smoothstep`, so no row is new.
2. **Step 4.2: the layout and the host.** Add the constants, change the write in `trace`, and add `#frames`, `k` and the sums to `PathTracer`. Change `PresentParams`. Keep mode 0 as the only mode in use. Tests:
   - Render once as a warm-up, then restart. After 16 frames of 4 samples with `k` of 8, each bucket holds 2 frames. Each count is 8. On a fresh renderer, the first frame has 1 sample, so bucket 0 counts 5 and the others count 8. Verifies Design 0009.12.
   - After a restart with `k` of 8, every cell of every bucket is 0. The clear covers `k * width * height * 4` floats.
   - `readRadiance` with `k` of 8 and with `k` of 1 agree within 1e-5 relative, on the same seed and split. Verifies Design 0009.10.
   - A frame of 2,073,600 pixels gets `k` of 4, and a frame of 8,294,400 gets 1. Done when the tests pass.
3. **Step 4.3: the present pass and the member.** Add mode 1 to `show` and the member `fireflyFilter`. Bake the API surface with `bun run gate:api`. Add the check to the determinism gate: two renders with the filter on, one seed and one split, give the same `readPixels` bits. Done when `bun run gate:determinism` passes.
4. **Step 4.4: the numbers.** Run `bun run gate:differential` before and after. Record `mean`, `largest` and `outOfBounds` of each scene. Run `bun run gate:render` with no golden rewritten. Run `bun run quality` on `cornell` and `lights` with the plain mean and with the filter at 16, 64, 256 and 1,024 samples. Record two more numbers. First, the share of pixels whose luminance is over 10 times the reference at 64 samples, for both outputs. Second, the mean relative difference of the two outputs at 1,024 samples, which is the bias. Done when the pull request shows the table.

### Prove the instrument (part 4)

1. **The test sees a wrong median.** Plant the fault of reading the same sorted value for both middle values. P1 must pass and P2 must fail with the case named. Plant the fault of writing every frame to bucket 0. The count test of step 4.2 must fail with the counts in its message.
2. **The quality tool sees a firefly.** Plant a fault in a scratch branch. Add 10,000 to the radiance of a path whose hash is under 1 in 4,096. The plain mean's error at 256 samples must rise above the unfaulted error. The filter's error must stay under the plain mean's error. The pull request records the three numbers. Inference: the fault's share of the radiance is large enough to show at 16 by 16 pixels. Step 4.4 measures it.
3. **The gates stay blind to the filter.** The render gate leaves the filter off, so it cannot run with the filter on. Plant a fault in a scratch branch: the gate's render sets `fireflyFilter` to `true`, so it reads mode 1. `bun run gate:render` must fail on the golden of a scene with a bright, rare path, with the pixel count in its message. Remove the fault, and the gate passes. The pull request shows both runs.

## Part 5: blue-noise error diffusion by a scrambled Morton index (ZSobol)

### What changes (part 5)

Today each pixel reads its own random scramble of the sequence, so the errors of two neighbours are independent. After this part all pixels of a block read one scrambled sequence. A pixel takes its share of it by the sample index `zIndex(code, i)`, a scrambled Morton index of (pixel, sample). The errors of neighbours then become anti-correlated, which is blue noise in screen space (Ahmed et al. 2020, ZSobol). Part 5 builds on part 2's `sample2`, so part 2 merges first.

**Before.** These are facts at `main` 55bde46. `trace` makes `pixelSeed = hash2(pixel, params.scene.w)` for each pixel (`trace.shade.ts`, line 207). `sample2` takes `key = hash2(pixelSeed, pair)` and shuffles the sample index with `owen(index, key)` (`sampler.shade.ts`, lines 72 and 73). Both depend on the pixel, so every pixel has its own scramble and its own order. The error is white noise across pixels. The index is a whole `u32`, and `frame.z + s` counts up from 0 for the whole render (line 210). Nothing reads a budget of samples.

**After.** After part 2, `sample2` shuffles with `shuffled = owen(index, key)`. Part 5 replaces that one line and gives `sample2` one more parameter. These are the definitions.

- **The budget.** `L = params.path.w` is the log2 of the sample budget. The host sets it (decision 15). A budget of `2^L` samples is one epoch. The sample `index` is in epoch `e = index >> L`, and `i = index & (2^L - 1)` is its place in the epoch.
- **The block.** Let `bits(n)` be the smallest `m` with `2^m >= n`. The block side is `2^m`, with `m = min(bits(max(width, height)), (32 - L) / 2)`. The block of a pixel is `(px >> m, py >> m)`. A frame of at most `2^m` pixels on each side is one block. At `L` of 10, `m` is at most 11, and a block is at most 2,048 by 2,048 pixels.
- **The seeds.** `trace` makes `pixelSeed = hash2(hash2(bx, by), params.scene.w)`. It is the same for each pixel of a block. A block of the frame has its own seed, so two blocks are independent. `sample2` makes `blockKey = hash2(pixelSeed, e)`, and `key = hash2(blockKey, group)`. Each epoch is a new sequence, so a render past the budget restarts the blue noise, as the survey says it must.
- **The code.** `trace` makes `code = morton2(px & (2^m - 1), py & (2^m - 1))`. It interleaves the bits of x and y, and it has `2m` bits. It is the same for each sample of the pixel.
- **The index.** `zIndex(code, i, key, L)` is the number `n = (code << L) | i`, which has `2m + L` bits. Its digits in base 4 sit at the bit shifts `s = (L & 1), (L & 1) + 2, ...`. They are permuted from the top. For the digit at shift `s`, let `higher = n >> (s + 2)`. The permutation is number `hash2(higher, key ^ s) % 24` of the 24 permutations of `{0, 1, 2, 3}`. The digit is replaced by its image. When `L` is odd, the lowest bit is a digit in base 2. It is flipped when a bit of `hash2(n >> 1, key)` is set. A digit above it stays in base 4, so the digits keep their place.
- **The result.** `shuffled = zIndex(code, i, key, L)`. The rest of `sample2` is part 2's: the SZ dimensions of `shuffled`, each with its own Owen scramble from `key`. The scrambles are the same for each pixel of the block. A pixel differs only by its index.
- **The new signature.** `sample2(pixelSeed, code, index, pair)`. `radiance` takes `code` after `pixelSeed`. `direct`, `sampleBsdf` and `emission` do not change.
- **The table.** `PERM4` is a module constant `array<u32, 24>`. Entry `p` packs the permutation `p`: the image of digit `d` is `(PERM4[p] >> (2 * d)) & 3`. It is 96 bytes. It needs no buffer, so record 0001 gains nothing from it. If step 2.2's probe shows that a runtime index into a module constant array fails, the permutation comes from arithmetic. Decode `p` with `p / 6`, `(p / 2) % 3` and `p % 2`, and place the digit by `select`. This needs no table. Decision 16 holds this choice.
- **The host.** `PathTracer` sets `L` when the accumulation restarts. It is `ceil(log2(max(1, maxSamples)))`, kept at most 16. When `maxSamples` is infinite, `L` is 10. A change of `maxSamples` after a restart changes nothing until the next restart. The site's caps give `L` of 10 for 1,024 samples and 8 for 256. Both are even.
- **The tiles.** `code` and the block come from the absolute `px` and `py`, so a tile changes no image. The test "adds the same samples to every pixel whatever the tiles, bit for bit" in `kernels.test.ts` keeps its meaning.
- **The oracle.** `oracle.ts` sets `L` as the host does, from its `samples`.

**What the property needs.** Fact: the survey says that the blue-noise property needs the sample budget in advance. A frame that takes `n` samples with `n` a power of two up to `2^L` has the property in full. Inference: a count between two powers of two has it in part. The warm-up frame of a fresh renderer takes one sample (`PathTracer.ts`, lines 242 to 244). It shifts the later frames of that first render by one index. A restart does not repeat it. Inference: this loses part of the stratification of each frame of a bucket in part 4. Step 5.3 measures the whole effect.

**The cost.** Inference, from arithmetic: `zIndex` loops over `(2m + L) / 2` digits, and each digit takes two hashes and a table read. A 1,280 by 720 frame at `L` of 10 has `m` of 11, so 16 digits. One path calls `sample2` up to 33 times: 4 for each of 8 bounces, and 1 for the jitter. Each call runs `zIndex`. At about 25 integer operations for a digit, that is about 13,000 operations for a path. The cost may be a visible share of the frame. Step 5.3 measures it, and step 5.4 caches the digits of the pixel if it is over 10 % of the frame.

### Why (part 5)

A low-discrepancy sequence makes the error of one pixel small. It says nothing about the error of the next pixel, which is independent. The eye sees independent errors as grain. If the errors of neighbours are anti-correlated, a blur removes more of them, and a denoiser removes them more easily. The paper's claim, from the survey: a scrambled Morton index turns low-sample error into blue noise. It needs integer operations only and no buffer. The site's preview at 256 and 1,024 samples would look cleaner. This record has not read the paper's numbers. Step 5.1 reads it.

Alternatives. Heitz et al. (2019): it needs tables and a binding, and no binding is free (record 0001, rule 1). ART-Owen (Ahmed et al. 2023): the survey says it needs a bound table, and it is less proven.

### What it touches (part 5)

- **Files.** `sampler.shade.ts` (`morton2`, `zIndex`, `PERM4`, `sample2`, the header comment). `trace.shade.ts` (`trace`, `radiance`). `PathTracer.ts` (`L` at a restart). `scene-pack.ts` (the `path` word). `scripts/oracle.ts` (`L`). `scripts/quality.mjs` (the blur column).
- **Records.** Record 0001: the meaning of `path.w` (Amendment H). Record 0005: the seeds, the epoch and the promise's condition (Amendment I). Record 0002: the goldens, and the numbers of the new tests.
- **Gates.** The differential and determinism gates at their bounds. Every golden changes, because every random number changes.
- **The site.** The stills change with the goldens. The guide page `checked-on-the-cpu.mdx` (line 42) and `PRODUCT.md` (line 77) say "an Owen-scrambled Sobol sequence". Part 2 makes that line stale. Part 5 does not make it more so.
- **Not touched.** Parts 1 and 3 and the kernels' other files.

### Steps (part 5)

1. **Step 5.1: `morton2`, `zIndex` and their tests.** Read Ahmed et al. (2020). Add the three functions and `PERM4`. Write the paper's rule into the comments where it differs from this record. Tests in `sampler.test.ts`, through `compile()` on the oracle and through the language service:
   - `zIndex` is a bijection on `[0, 2^(2m + L))` for `m` of 2 and `L` of 3, and for `m` of 3 and `L` of 4. This holds for 8 keys. The case `L` of 3 tests the base-2 digit. Verifies Design 0009.16.
   - Take an aligned square of `2^k` by `2^k` pixels, `k` up to 3. The indices of its pixels and of the samples `0` to `2^L - 1` form one aligned range of `4^k * 2^L` integers. Verifies Design 0009.16.
   - `morton2` of the 16 by 16 pixels is a bijection on `[0, 256)`.
     Done when the tests pass and `determinism.test.ts` reports no new row.
2. **Step 5.2: the probe and the kernel.** Run step 2.2's probe on `PERM4`. Change `sample2`, `trace` and `radiance` as "What changes" says. Add `L` to `PathTracer` and the oracle. Tests:
   - For 3 pixels and 1,024 values of `i`, the pair `sample2(.., 2^L + i, ..)` differs from `sample2(.., i, ..)`. Verifies Design 0009.15.
   - `L` is 10 for an infinite `maxSamples`, 10 for 1,024 and 8 for 256. A change of `maxSamples` after a restart does not change `L`. Verifies Design 0009.15.
   - A frame of 3,000 by 1,000 pixels has `m` of 11 at `L` of 10. Pixels 2,048 apart in x have different seeds.
     Done when the tests pass and `bun run check:shaders` reports no diagnostic.
3. **Step 5.3: the numbers.** Record `bun run gate:differential` before and after for the four scenes. Run `bun run gate:determinism`. Rewrite the goldens with `UPDATE_GOLDENS=1 bun run gate:render` and show each pair of pictures. Run `bun run quality` on `cornell` at 1, 4, 16, 64, 256 and 1,024 samples, at 64 by 64 pixels, before and after. The tool prints the error and the blur ratio. Run `bun run bench` on `cornell` and add a row before and after. Done when the pull request shows these numbers.
4. **Step 5.4: the cache.** Do this step only when step 5.3 shows a cost over 10 % of `frame ms`. Compute the digits of the pixel once for each group, and keep them in a local array. Run step 5.3's numbers again. Done when the cost is under 10 %, or the owner accepts it.

**The blur ratio.** This is a number that `bun run quality` gains in this part. Blur the render and the reference with a box of 3 by 3 pixels. The ratio is the error of the blurred render over the error of the render, both against the reference. Arithmetic: errors that are independent between pixels fall by a factor of 3 in the blur, so the ratio is 1/3. Anti-correlated errors fall more, so the ratio is under 1/3. The reference for this part is 64 by 64 pixels at 4,096 samples. Inference: it is 16,777,216 paths, and at 28,000 paths a second it takes about 10 minutes. This is not measured at that size.

### Prove the instrument (part 5)

1. **The tests see a wrong permutation.** Plant the fault of setting entry 5 of `PERM4` to `(0, 0, 1, 2)`. The bijection test must fail with the first repeated index in its message. Plant the fault of taking `higher` from `i` alone. One of the two tests of step 5.1 must fail. The pull request names which.
2. **The quality tool sees white noise.** Plant the fault of using `hash(px, py)` in place of the Morton code. The blur ratio at 4 samples must rise to about 1/3, and the unfaulted ratio must be under it. Inference: the ratio of the faulted kernel falls between 0.28 and 0.38 on a frame of 64 by 64 pixels. Step 5.3 measures it. If it does not, the tool does not measure what it names.

## Part 6: an 8-wide compressed BVH for the BLAS

### What changes (part 6)

The host collapses each geometry's binary BVH into a BVH with up to 8 children in a node. It stores each node in 80 bytes, with child boxes quantized to 8 bits (Ylitie et al. 2017). The kernel walks it with `countOneBits` and `firstLeadingBit`. The TLAS stays binary. The nearest hit stays the same, and a tie in `t` breaks by primitive index.

**Before.** These are facts at `main` 55bde46.

- **The node.** A node is two `vec4`, 32 bytes (`NODE_STRIDE` is 2, `layout.shade.ts` line 19). `nodeBounds(i)` and `nodeWords(i)` read at `i * NODE_STRIDE` (lines 116 to 127). The BLAS and the TLAS share this layout.
- **The walk.** `nearest` (`intersect.shade.ts`, lines 182 to 256) holds two stacks of 32 `u32` (lines 191 and 192). One is for the TLAS and one is for the BLAS being walked. It tests the box of each popped node with `enters` (lines 197 and 223). It pushes the farther child first.
- **The leaf.** A leaf holds at most 4 triangles (`BVH_LEAF_SIZE`, `bvh.ts` line 32). The loop of lines 238 to 251 tests them in order. `hitTriangle` returns a miss when `at >= limit` (line 170), so the first of two triangles at one `t` wins.
- **The bases.** An instance holds `nodeBase` in nodes (`instances[6].x`). `tlasBase` is the count of the BLAS nodes (`scene-pack.ts`, lines 565 and 625). `params.scene.x` holds it.
- **The sizes.** `nodes` holds at most 4,194,304 nodes under the 134,217,728 byte binding limit (record 0001, "Sizes under the limits"). The tile rules (record 0001, "Tiles and the watchdog") size a tile by the last frame's nanoseconds for each path. A 4K frame takes 2,160 tiles at the slowest speed (`tiles.ts`, line 12).

**After.** These are the contract and the code that follows from it.

- **The node in bytes.** A wide node is 5 `vec4`, 80 bytes, and `WIDE_STRIDE` is 5. Its alignment is 16 bytes, and it has no padding. The words are:
  - `[0] = (p.x, p.y, p.z, bits(e.x | e.y << 8 | e.z << 16 | imask << 24))`. `p` is the lower corner of the node's box. `e` holds three exponents biased by 127. `imask` has bit `i` set when slot `i` is an inner node.
  - `[1] = (bits(childBase), bits(triBase), bits(meta0..3), bits(meta4..7))`. `childBase` is the first inner child, in nodes, relative to the BLAS's first node. `triBase` is the first triangle of the node's leaves, relative to `primBase`. Each `meta` is one byte.
  - `[2] = (qlox0..3, qlox4..7, qhix0..3, qhix4..7)`, one byte for each child and bound. `[3]` holds the same for y and `[4]` for z.
- **The binding.** `nodes` becomes `storage<array<vec4u>>` in `layout.shade.ts`, for the BLAS and the TLAS alike. A float lane is read with `bitcast<f32>`: the corner `p`, and the bounds of a TLAS node. This is rule 4 of record 0007, applied to `nodes` in this part. The reason is a fact. The packed words are the `e` and `imask` word, the meta words and the six `qlo` and `qhi` words. Many have NaN or subnormal patterns, for example a `qhi` of 255 in the top byte with 128 or more in the next. Compiler change 0045 says such a pattern has no fixed answer (`vendor/typeshade/src/core/passes/determinism.ts`, lines 143 to 153). Fact, measured in bun: `Array.from` on a `Float32Array` turns the NaN `0xffc0ff00` into `0x7fc00000`, so the oracle's loader `vec4s` (`scripts/oracle.ts`, line 39) would decode other boxes than the GPU. The packer writes `nodes` as a `Uint32Array`, and `vec4s` takes it unchanged. The alternative is a packing that avoids every NaN and subnormal pattern. It costs bits, so this record does not use it.
- **The meta byte.** 0 is an empty slot. An inner child has the top 3 bits `001` and the low 5 bits `24 + r`, where `r` is the rank of the child among the inner children. A leaf child has its triangle count in the top 3 bits, as `001`, `011` or `111` for 1, 2 or 3 triangles. Its low 5 bits are the offset of its first triangle from `triBase`, 0 to 23. This is the paper's format, which this record has not read. Step 6.2 reads it and amends the bytes where they differ.
- **The box.** The scale of axis `k` is `2^(e_k - 127)`. The exponent `e_k` is the least integer with `255 * 2^(e_k - 127) >= extent_k`, clamped to the range 1 to 254. An axis of zero extent gets `e_k` of 1, because a byte of 0 decodes as 0 or a subnormal and 255 decodes as infinity. The scale is exact in f32, and the kernel makes it with `bitcast<f32>`. The bounds of child `i` are `p + q * scale`. A child's `qlo` is the floor and its `qhi` is the ceiling of its true bound in units of the scale.
- **The conservative rule.** The decode `p + q * scale` rounds once in f32. So the host decodes each bound with `Math.fround`, and it widens the quantized bound by one unit until the decoded box holds the child's box. When a widened bound passes 255, the host raises `e_k` by one and quantizes the node again. A test holds the rule (step 6.2). The slab test keeps `SLAB_SLACK`.
- **The collapse.** `collapse(bvh)` is a new function in `accel/wide.ts`. It takes a binary BVH from `buildBlas` and gives a wide one. It chooses the children of each node by a dynamic program over the binary tree, for the least cost with at most 8 children. The cost is `bvh.ts`'s: `TRAVERSAL_COST` and the count of primitives for a leaf. This is the paper's method, as the survey describes it, and step 6.2 reads it.
- **The leaf.** A leaf of a wide node holds at most 3 triangles. The collapse splits a binary leaf of 4 triangles into two leaves of 2. The binary builder and `BVH_LEAF_SIZE` do not change, because the TLAS needs them. Decision 18 holds this choice.
- **The order of triangles.** The collapse writes its own `order`. The triangles of the leaf children of one node are consecutive, in slot order. The packer writes `triangles` in that order, as it does now.
- **The slots.** The host assigns the children to the 8 slots. Bit `k` of a child's slot is 1 when its centroid is above the node's centroid on axis `k`. Two children for one slot: the later one takes the free slot of least Hamming distance, ties by lower slot. A ray of octant `o` then visits the slots in the order of `s ^ o`. The build uses no random number, so it gives one tree for one input.
- **The traversal.** The BLAS loop of `nearest` and of `occluded` follows the paper. It tests the 8 children of a node and makes a bit field of the hits. `firstLeadingBit` takes the nearest set bit. `countOneBits` of `imask` below the slot gives the child's rank. A stack entry is two words: the child base and the pending hit field. The BLAS stack holds 32 entries, which is 64 `u32`. The depth is at most 31. A wide level covers at least one binary level, and the collapse adds one for a leaf of 4. Step 6.3 writes the code. The TLAS loop does not change.
- **The bases.** `nodeBase` and `tlasBase` count `vec4`, not nodes. The wide node `k` of a BLAS is at `nodeBase + k * WIDE_STRIDE`. The TLAS node `k` is at `tlasBase + k * NODE_STRIDE`. `nodeBounds` and `nodeWords` take a `vec4` offset. The offset of the TLAS may be odd, so the packer adds no padding.
- **The ties.** `nearest` accepts a triangle when `t < hit.t`, or when `t == hit.t` and its pair (instance slot, triangle index) is less than the held pair. The triangle index of the pair is the absolute index `bases.y + v.a + j`, the same value that `Hit.triangle` holds. So `hitTriangle` returns a miss when `at > limit`. The shadow ray in `occluded` takes any hit and has no tie. The rule makes the hit independent of the visit order. Rule 3 of record 0005 holds, and Amendment K adds the tie rule. Decision 19 holds this choice.
- **The sizes.** A wide node is 80 bytes, so `nodes` holds at most 1,677,721 wide nodes in 134,217,728 bytes. Inference: the wide tree has fewer nodes than the binary tree, and each node is 2.5 times larger. Step 6.4 measures the bytes of `nodes` for each triangle on `bunny` and `materials`, before and after.
- **The tiles.** The tile rules depend on the pixel count and on `nsPerPath`. The new walk changes `nsPerPath` only. The floor of 4,096 pixels and the count of 2,160 tiles for a 4K frame at that floor do not change. A faster walk raises the nominal tile and lowers the count. A slower walk on one device could lengthen the first frame's dispatch. Step 6.4 records `info.dispatches`, `info.tilePixels` and `info.dispatchTime` before and after.

### Why (part 6)

Inference: the walk is a large share of the cost of a path. No profile in this record shows the share. A wide node tests 8 boxes with one read of 80 bytes. The quantized boxes make the node small, so more of the tree stays in cache. The paper's claim, from the survey: it is the best software traversal without ray tracing cores. It is about 2 times faster on incoherent secondary rays. That buys about 2 times the samples at equal time. This record has not read the paper's numbers. The gain on SwiftShader, a CPU, is not the gain on a GPU. Step 6.4 records the SwiftShader rows, and the owner's GPU row stays open until the owner measures it (decision 20).

Alternatives. Keep the binary BVH and add a short stack (Vaidyanathan et al. 2019): the survey says to do it right after this part. A wide TLAS: the TLAS holds few nodes, so the gain is small. A second buffer for the wide nodes: no storage binding is free (record 0001, rule 1).

### What it touches (part 6)

- **Files.** `accel/wide.ts` (new). `layout.shade.ts` (`WIDE_STRIDE`, the decoders, the meaning of the bases). `intersect.shade.ts` (`nearest`, `occluded`, `enters`, `hitTriangle`). `scene-pack.ts` (the wide BLAS, `WIDTH.nodes`, `#concatenateGeometry`, `#placeInstances`). `internal.ts`. The header comments of the kernel files.
- **Records.** Record 0001: the node layout, the bases, the limits, the stacks (Amendment J). Record 0005: the tie rule (Amendment K). Record 0002: the bench rows (Amendment L).
- **Tests.** `layout.test.ts` (the stride and the 80 bytes). `bvh.test.ts` and a new `wide.test.ts`. `intersect.test.ts`.
- **Gates.** The differential and determinism gates at their bounds. The render gate with no golden rewritten, except where a tie moves a pixel. `bun run bench` rows.
- **The site.** The guide page `scene-graph.mdx` (line 51) says that a BVH is built once for each geometry. That stays true.
- **Not touched.** The sampler, the materials and the TLAS builder.

### Steps (part 6)

1. **Step 6.1: the tie rule on the binary BVH.** Change `hitTriangle` and `nearest` as "The ties" says. Test on a scene of 64 coincident triangles in different leaves, with rays from both sides. The hit is the least pair whatever the visit order. Verifies Design 0009.19. Done when the test passes. List each golden that changes.
2. **Step 6.2: `collapse`, the encoder and their tests.** Read Ylitie et al. (2017). Write `accel/wide.ts` and the layout constants. Write the paper's format into the comments where it differs. Tests in `wide.test.ts`:
   - Every triangle is in exactly one leaf. A node has at most 8 children, and a leaf at most 3 triangles. The depth is at most 31.
   - The decoded f32 box of every child holds the child's true box, for 5 random meshes of 1,000 triangles and for the gate scenes. Verifies Design 0009.18.
   - A node is 80 bytes. `imask` has one bit for each inner child. The triangle ranges partition the node's triangles.
   - A flat node, with one axis of zero extent, has `e_k` of 1 on that axis. A node with an extent within one unit of `255 * scale` keeps every quantized bound at or under 255. Verifies Design 0009.18.
   - The words of a node, loaded through the oracle's `vec4s`, equal the packed `Uint32Array` bit for bit. Use a node with a `qhi` of 255 over a `qhi` of 128 in its next byte, so the word is the NaN `0xffc0ff00`. Verifies Design 0009.17.
     Done when the tests pass.
3. **Step 6.3: the kernel.** Change the BLAS loop, the decoders, the bases and the packer. Tests through `compile()` on the oracle and through the language service:
   - 100,000 pairs of a ray and a box: the wide test passes whenever the exact test passes. Verifies Design 0009.18.
   - 10,000 random rays on 3 meshes: the wide walk finds the triangle of a brute-force loop with the tie rule. Verifies Design 0009.17.
   - A small kernel reads every word of a packed `nodes` through `compile()` on the oracle and returns it as a `u32`. The result equals the packed bits, including each NaN word. Verifies Design 0009.17.
   - `determinism.test.ts` reports no new row. `bun run check:shaders` reports no diagnostic.
     Done when the tests pass.
4. **Step 6.4: the numbers.** Run `bun run gate:differential` and `bun run gate:determinism` before and after. Run `bun run gate:render` and list any golden that changes. Run `bun run bench --scene cornell,bunny,materials` before and after, three runs each. Record `BVH ms`, `frame ms`, `paths/s`, the bytes of `nodes` for each triangle and the three `info` numbers of "The tiles". `scripts/bench.mjs` prints none of the last four today, so this step adds them as columns. Add the rows to `docs/benchmarks.md`. Done when the pull request shows the table.

### Prove the instrument (part 6)

1. **The containment test fails on a wrong rounding.** Plant the fault of rounding each bound to the nearest unit. The test of step 6.2 must fail with the node, the child and the axis in its message.
2. **The tie test fails without the rule.** Remove the pair comparison, so that the first triangle found wins. The test of step 6.1 must fail for at least one ray of the scene.
3. **The equality test sees a wrong child.** Plant the fault of adding 1 to `childBase` of every node. The brute-force test of step 6.3 must fail, and `bun run gate:differential` must fail its `mean` bound on `triangles`. The pull request records both.
4. **The bench sees a traversal change.** Plant the fault of setting the octant to 0, so the order of the slots ignores the ray. The `paths/s` of `bunny` must differ from the unfaulted row by more than the spread of the three runs. If it does not, the bench cannot show the gain of this part.

## Amendments owed

Each amendment below is text to paste into a record's "Record" section. The implementer pastes it in its own pull request, before the part that needs it (decision 21). Replace `N` with the next free number of that record and `DATE` with the date of the merge. The text is the record's own voice, and it stays under the STE caps.

| Part | Record 0001       | Record 0002 | Record 0003 | Record 0005       |
| ---- | ----------------- | ----------- | ----------- | ----------------- |
| 0    | none              | A           | none        | none              |
| 1    | none              | A           | none        | B (fallback only) |
| 2    | C (fallback only) | A           | none        | none              |
| 3    | none              | A           | none        | none              |
| 4    | D                 | G           | F           | E                 |
| 5    | H                 | A           | none        | I                 |
| 6    | J                 | L           | none        | K                 |

Parts 1 to 3 owe no other text. Their changes to the header comments of the kernel files are not amendments.

**Amendment A (record 0002, step 0).** Paste this before part 1.

> **Amendment N** (DATE, UTC). Record 0009 adds a measure of error against a reference. The tool is `bun run quality` (`scripts/quality.mjs`). It renders a scene on the GPU at a list of sample counts. It prints the relative root-mean-square error of each render against the reference. It also prints the samples that reach a target error. The references are raw f32 files in `scripts/__goldens__/reference/`. They hold 16,384 samples a pixel for the four differential scenes at 16 by 16. The table of gates gains the row `quality`: a recorded number, held by no bound, run by hand. A pull request that changes the expected image renders its own reference. Each part that rewrites a golden shows the old and the new picture of each golden in its pull request.

**Amendment B (record 0005, part 1, fallback only).** Paste this only when decision 2 admits `atan2`.

> **Amendment N** (DATE, UTC). Rule 2 admits `atan2` in one function: `solidAngle` in `trace.shade.ts`. The result is the solid angle of a light's triangle. It sets the sampled direction by its value. It feeds no comparison, no index and no loop bound. `VALUE_ONLY` in `determinism-lists.ts` gains `solidAngle: ['atan2']`. The differential gate's `rel` and `mean` bound the result.

**Amendment C (record 0001, part 2, fallback only).** Paste this only when the last fallback of part 2 runs.

> **Amendment N** (DATE, UTC). `TraceParams` gains `sz: array<vec4u, 32>` after `path`. It holds the 128 column words of the SZ matrices, 512 bytes. The block grows from 144 to 656 bytes. `scene-pack.ts` fills it from the table that `scripts/sz-matrices.ts` prints. `layout.test.ts` holds the new size.

**Amendment D (record 0001, part 4).** Paste this before part 4.

> **Amendment N** (DATE, UTC). `accum` holds `k` buckets for each pixel. An element is one `vec4`: the sum of the radiance in `xyz` and the count in `w`. The element of bucket `b` of pixel `p` is at `b * pixels + p`. Bucket `b` starts at byte `b * pixels * 16`, 16-byte aligned. `pixels` is the width times the height of the traced frame. `k` is `min(8, floor(134,217,728 / (width * height * 16)))`. The buffer is `k * width * height * 16` bytes. `path.z` of `TraceParams` is the bucket of the dispatch. `PresentParams` gains `accum: vec4u = (k, mode, pixels, 0)` and grows from 16 to 32 bytes. `view` is at byte 0 and `accum` is at byte 16. The block has an alignment of 16 bytes and a size of 32 bytes. Mode 0 is the plain mean and mode 1 is the G-MoN output. The table row of `accum` and the sentence "Unchanged from M1" change with this text.

**Amendment E (record 0005, part 4).** Paste this before part 4.

> **Amendment N** (DATE, UTC). Rule 4 holds for the buckets. An invocation adds its sum to one bucket of its pixel, once in a frame. The bucket is the number of the frame since the last restart, modulo `k`. The bits of the plain mean depend on the split. The G-MoN output depends on it more, because bucket `b` holds the frames `b`, `b + k` and so on. The promise holds for the G-MoN output of one seed, one device, one driver, one split and one `k`. `k` follows the frame's size.

**Amendment F (record 0003, part 4).** Paste this before part 4.

> **Amendment N** (DATE, UTC). `PathTracer` gains the member `fireflyFilter: boolean`, default `false`. When it is `true`, the canvas and `readPixels()` show the G-MoN output. `readRadiance()` always returns the plain mean. The name takes the plan's word "firefly" (rule 3). The bake of `packages/radiance/__api__/surface.md` changes with this text.

**Amendment G (record 0002, part 4).** Paste this before part 4.

> **Amendment N** (DATE, UTC). The render, differential and determinism gates read the plain mean. The render gate leaves `fireflyFilter` off. The determinism gate gains one check. Two renders with the filter on, one seed and one split, give the same bits in `readPixels()`. `gmon.test.ts` holds the function of the G-MoN output.

**Amendment H (record 0001, part 5).** Paste this before part 5.

> **Amendment N** (DATE, UTC). `path.w` of `TraceParams` is `L`, the log2 of the sample budget. The host sets it at each restart of the accumulation. The word was unused. The block keeps its 144 bytes.

**Amendment I (record 0005, part 5).** Paste this before part 5.

> **Amendment N** (DATE, UTC). Rule 1 holds. The sampler is still the only source of random numbers. `pixelSeed` is the seed of a block of pixels and not of one pixel. The sample index of a pixel is a scrambled Morton index of its code and its place in the epoch. The promise gains two conditions. The image depends on `L`, so on `maxSamples` at the last restart. It also depends on the size of the frame, through the side of the block.

**Amendment J (record 0001, part 6).** Paste this before part 6.

> **Amendment N** (DATE, UTC). A BLAS node is a wide node of 5 `vec4`, 80 bytes, with up to 8 children. Each child box has 8-bit bounds in the scale `2^(e - 127)` of its node. The TLAS node is still 2 `vec4`. The two share `nodes`. `nodes` becomes `storage<array<vec4u>>`, and a float lane is read with `bitcast<f32>`, because the packed words have NaN patterns. `nodeBase` and `tlasBase` count `vec4`. `nodes` holds at most 1,677,721 wide nodes. `collapse` in `accel/wide.ts` makes the wide tree from the binary one. A BLAS stack has 32 entries of two words. The sections "Traversal" and "The build" change with this text.

**Amendment K (record 0005, part 6).** Paste this before part 6.

> **Amendment N** (DATE, UTC). `nearest` breaks a tie in `t` by the pair (instance slot, triangle index), the least first. So the nearest hit does not depend on the visit order. `hitTriangle` accepts a `t` equal to its limit. The determinism report gains no row, because `countOneBits` and `firstLeadingBit` are integer operations.

**Amendment L (record 0002, part 6).** Paste this before part 6.

> **Amendment N** (DATE, UTC). Part 6 adds the `bench` rows for `cornell`, `bunny` and `materials`, before and after, to `docs/benchmarks.md`. The differential gate keeps its bounds. A pull request that cannot keep a bound re-derives it by this record's rule and shows the measurement. The render gate lists each golden that a tie moves.

## Implementation, in steps

Each step is one pull request or more. Each implementing commit carries the line `Design: 0009`. A test that verifies a decision carries `Verifies: Design 0009.k` in a comment. The numbers of each part are in the part's own steps.

1. **Merge this record.** The owner merges it as `draft`, then answers the decisions. That answer is the acceptance.
2. **Step 0: the instrument.** Paste Amendment A. Write `scripts/quality.mjs`, the four references and the "Quality" heading of `docs/benchmarks.md`.
3. **Part 1.** Steps 1.1 to 1.4. Amendment B only if decision 2 admits `atan2`. Step 1.5 waits for decision 5.
4. **Part 2.** Steps 2.1 to 2.4. Amendment C only if the last fallback runs.
5. **Part 3.** Steps 3.1 to 3.4. The pull request carries the new stills.
6. **Part 5.** Paste Amendments H and I. Then steps 5.1 to 5.4.
7. **Part 4.** Paste Amendments D, E, F and G. Then steps 4.1 to 4.4.
8. **Part 6.** Paste Amendments J, K and L. Then steps 6.1 to 6.4.
9. **Close the record.** Set `status: implemented`. Write the commits, the pin, each gate's result and each part's numbers in "Record".

Three rules hold for every step:

- A part merges alone. Two parts never share a pull request.
- A part that rewrites goldens carries its own goldens and its own stills.
- A part that reaches past this record amends the record first, in its own pull request.

## Decisions for the owner

1. The parts merge in the order 1, 2, 3, 5, 4, 6. Part 2 comes before part 5, and part 6 comes last. Proposed: yes. This asks the owner, because the order changes.
2. Part 1 writes `arcTan` from sums, products and one division, and it does not change rule 2. The fallback is a longer polynomial. Admitting `atan2` for `omega` (Amendment B) needs the owner's go-ahead. Proposed: the polynomial. This is a default.
3. `OMEGA_MIN` is 1e-4 sr. Under it, `direct` samples the light by area. Proposed: yes. This is a default.
4. No part has a minimum gain. Each part shows its measured numbers in its pull request, and the owner judges them. Part 6 has its own condition (decision 20). Proposed: yes. This is a default.
5. Peters's projected solid angle (step 1.5) waits for the owner's go-ahead after step 1.4 gives its number. Proposed: wait. This asks the owner.
6. Part 2 uses SZ groups of four dimensions, the pair numbering `2 + bounce * 4`, and a table of 128 words in `sampler.shade.ts`. The fallbacks are a `select` tree, then the uniform block (Amendment C). Proposed: yes. This is a default.
7. Part 3 replaces the box filter with a tent filter. The image becomes softer, so the owner judges the look. A tabulated filter and a Gaussian are not used. Proposed: tent. This asks the owner.
8. `FILTER_RADIUS` is 1.0 pixel. The alternative is 0.5 pixel, which is sharper and gains less. Proposed: 1.0. This is a default.
9. A preview frame, traced at a lower resolution, is blurred over its blocks. Proposed: accept. This is a default.
10. The accumulator has at most 8 buckets. The G-MoN output needs at least 4. A frame over 2,097,152 pixels has fewer than 4 buckets, so it gets the plain mean only. A frame over 1,048,576 pixels gets fewer than 8. Proposed: yes. This asks the owner, because it costs memory.
11. `PathTracer` gains the public member `fireflyFilter`, default `false`. Amendment F amends record 0003, and the bake of the API changes. Proposed: yes. This asks the owner, because it adds an export.
12. The bucket of a frame is its number since the last restart, modulo `k`. The warm-up frame of one sample keeps the place that record 0005 gives it. The alternative is the bucket with the fewest samples. Proposed: modulo `k`. This is a default.
13. The blend of the G-MoN output has the four properties P1 to P4. The default weight is the normalized Gini coefficient through a smoothstep from 0.25 to 0.5. It is written as `clamp` and arithmetic, so no `smoothstep` row enters the determinism report. Step 4.1 may replace the formula by the paper's. Proposed: yes. This is a default.
14. Part 4 uses `path.z` for the bucket, and part 5 uses `path.w` for `L`. `PresentParams` grows from 16 to 32 bytes, and `TraceParams` keeps 144 bytes. The alternative is a new `vec4u`, which adds 16 bytes. Proposed: the words. This is a default.
15. The sample budget `L` is `ceil(log2(maxSamples))`, at most 16, and 10 when `maxSamples` is infinite. A render past the budget starts a new epoch. A frame wider than a block uses independent blocks. Proposed: yes. This is a default.
16. Part 5 permutes the base-4 digits with a table of 24 entries, 96 bytes. The fallback is arithmetic on the factorial number system. The hash includes the shift of the digit. Proposed: yes. This is a default.
17. Part 6 collapses the BLAS only. The TLAS stays binary, the two kinds of node share `nodes`, and the bases count `vec4`. `nodes` becomes `storage<array<vec4u>>`, so the packed words keep every bit on the GPU and in the oracle. Proposed: yes. This asks the owner, because it changes a layout.
18. A wide leaf holds at most 3 triangles. A child box has 8-bit bounds, widened until the f32 decode holds the true box. Proposed: yes. This is a default.
19. A tie in `t` breaks by the pair (instance slot, triangle index), and `hitTriangle` accepts a `t` equal to its limit. A golden that a tie moves is listed. Proposed: yes. This is a default.
20. Part 6 merges when its tests and gates pass and its SwiftShader rows are recorded. The owner's GPU row stays open. It has no minimum gain on SwiftShader. Proposed: yes. This asks the owner, because SwiftShader may not show the gain.
21. Each amendment of "Amendments owed" goes into its record in its own pull request, before the part that needs it. The owner's "merge" is its approval. Proposed: yes. This is a default from `CLAUDE.md`.

## Record

**Approval and plan record.** This record does not yet apply. It is `draft`. The owner approved a quality wave of six techniques on 2026-10-06 (UTC), in the conversation, and asked for this record. The owner has not yet said to merge it. The owner's answer to the decisions will be the acceptance.

**Configuration and validation record.** This record does not yet apply. Implementation will record the commits of each part, the pin, each gate's result and each part's numbers. This record is documentation only. It ran no gate, no test and no benchmark. The documentation checks of the authoring session are in the pull request.

**Status of the requests at authorship.** The request was a record of six parts. All six are written. The status of the record is `draft`. The status of each part's implementation is not started.

**Open items at authorship.**

- **The papers.** No paper was read for this record. Every claim about a paper comes from the papers survey of 2026-10-06, and each is labelled so. Disposition: open. Next action: the first step of each part reads its paper and amends this record where the paper differs.
- **The numbers.** No gain is measured. The cost of the new sampler, of the buckets and of the wide node is arithmetic or inference. Disposition: open. Next action: the steps called "the numbers" measure them.
- **The blend formula.** The default weight of part 4 is a proposal. The survey gives no formula. Disposition: open. Next action: step 4.1.
- **The buckets and the memory.** A frame over 1,048,576 pixels has fewer than 8 buckets, and a 4K frame has 1. Disposition: open. Next action: the owner answers decision 10.
- **The first frame.** The first render of a renderer takes one sample, which shifts its later frames by one index. A restart does not repeat it. This lowers the stratification that parts 4 and 5 rely on. Disposition: open. Next action: step 5.3 measures it. A change of the split needs an amendment of record 0005.
- **The public export.** The overview said "no public export". Part 4 adds one member. The text of the overview is changed. Disposition: open. Next action: the owner answers decision 11.
- **The table in the sampler.** Part 2 and part 5 read a module constant array with a runtime index. This is not checked in any of the three outputs. Disposition: open. Next action: step 2.2.
- **The line numbers.** They are lines of `main` 55bde46. Between 55bde46 and a89aaa1, the only cited file that changed is `scripts/gates.mjs`. In it, `RENDER` moved from line 74 to line 84, and the `ORACLE` mean bound moved from 3.3e-6 to 2e-5 after the two-sided lamp (#54). The kernel and host files that the record cites did not change. Disposition: closed. Next action: none.
- **Stale prose.** Part 2 makes the phrase "an Owen-scrambled Sobol sequence" in `PRODUCT.md` (line 77) and in `checked-on-the-cpu.mdx` (line 42) less exact. Disposition: open. Next action: part 2's pull request reads both and amends them.
- **Not proposed.** EARS (Rath et al. 2022), the reweighting of firefly samples (Zirr et al. 2018), the short stack (Vaidyanathan et al. 2019), ART-Owen (Ahmed et al. 2023) and the denoisers of the survey. Disposition: deferred, and none is in a step.
