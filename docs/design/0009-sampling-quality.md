---
id: '0009'
title: Six quality techniques for the path tracer, each its own part (solid-angle light sampling, SZ sequences, filter importance sampling, G-MoN, blue-noise diffusion, an 8-wide BVH)
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
- **The site's caps.** The site stops an example at 1,024 samples on a desktop and at 256 on a phone (record 0002 and the pull request typeshade/radiance#27).

### After

Each part below gives the contract before and after. The table lists the parts, the file each one changes first, and what each one does to the images.

| Part | Technique                                            | Paper                      | Main change                                        | Does the expected image change?                            |
| ---- | ---------------------------------------------------- | -------------------------- | -------------------------------------------------- | ---------------------------------------------------------- |
| 1    | Solid-angle sampling of the chosen emissive triangle | Arvo 1995, Peters 2021     | `direct` in `trace.shade.ts`                       | No. The estimator stays unbiased                           |
| 2    | SZ sequences in place of the padded Sobol            | Ahmed et al. 2025          | `sampler.shade.ts`                                 | No. The estimator stays unbiased                           |
| 3    | Filter importance sampling with a tent filter        | Ernst et al. 2006          | The jitter in `trace`                              | Yes. The image is filtered, so it is softer                |
| 4    | G-MoN firefly removal                                | Buisine et al. 2021        | `accum`, `trace`, `show`, `PathTracer.ts`          | In the displayed mode only. The plain mean does not change |
| 5    | Blue-noise diffusion by hierarchical pixel ordering  | Ahmed et al. 2020 (ZSobol) | The sample index in `sampler.shade.ts` and `trace` | No. Only the error's pattern changes                       |
| 6    | An 8-wide compressed BVH                             | Ylitie et al. 2017         | `bvh.ts`, `layout.shade.ts`, `intersect.shade.ts`  | No. The nearest hit stays the same                         |

**The order.** The parts are independent in code. Three couplings set the order of merging.

1. Parts 2 and 5 both change `sampler.shade.ts`. Part 5 builds on part 2's function names, so part 2 merges first.
2. Parts 3 and 4 change the images the goldens hold. Merge each one with its own golden update, and never two in one pull request.
3. Part 6 changes the layout that record 0001 fixes. Merge it last, because it is the largest change and it needs the instrument of "The instrument" to show a gain.

The default order is 1, 2, 3, 5, 4, 6. Decision 1 asks the owner to confirm it.

### The instrument

This record needs one measure that the repository does not have. The differential gate cannot show a gain in quality (see "Before"). The benchmark rows of `docs/benchmarks.md` measure speed and not error. So each part below names one of these numbers, and the first step of the first part to merge builds the tool.

- **Rounding agreement.** The differential gate's `mean`, `abs` and `rel` for the four scenes of `scripts/gates/differential.mjs`, at the bounds in `scripts/gates.mjs`. Each part records the measured numbers before and after. A part passes when the new numbers stay under the bounds. A part that cannot stay under the bounds amends the bound in the same pull request, by record 0002's rule, with the new measurement.
- **Error against a reference.** The relative root-mean-square error of a render's mean radiance against a reference image of the same scene. Define it per pixel on the luminance, `(L - Lref) / max(Lref, 0.001)`. Take the root of the mean of its square over the frame. The tool is a new script, `scripts/quality.mjs` (`bun run quality`). It renders a scene at a list of sample counts, compares each render with the reference, and prints one row for each count.
- **The reference.** One reference for each scene, rendered by the GPU pipeline at the baseline commit with 16,384 samples a pixel and stored under `scripts/__goldens__/reference/` as raw `f32` files. A reference of an unbiased part is valid for that part. Parts 3 and 4 change the expected image, so each one renders its own reference at its own merge (see the parts).
- **Samples to reach an error.** For a target error `E`, the smallest count in the list whose error is at most `E`. A part reports `E` and the counts before and after. The gain is the ratio of the counts.

Facts and inferences about the instrument:

- **Fact.** The oracle takes 20 to 38 seconds for a 16 by 16 render at 256 samples on four cores (`scripts/gates.mjs`, comment on `GATE_M2`). A reference at 16,384 samples on the oracle would take about 64 times that, so the reference runs on the GPU.
- **Inference.** On SwiftShader, 16,384 samples of a 16 by 16 frame is 4.2 million paths. At the measured 28,000 paths a second (`docs/benchmarks.md`, `cornell` at 128 by 128) that is about 150 seconds. This is not measured at 16 by 16.
- **Proposal.** The error is measured on the gate's scenes: `cornell` (the Cornell box), `triangles`, `instances` and `lights`, at 16 by 16. The sizes are those that CI renders already.

Step 0 of this record builds the tool. It is shared, so it is a step of its own, in its own pull request, before part 1.
