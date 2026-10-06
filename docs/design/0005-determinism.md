---
id: '0005'
title: The determinism promise is stated once, every kernel is written under six rules, and a test reads the compiler's determinism report against an allowlist
status: accepted
milestones: [M2, M4]
touches:
  - packages/radiance/src/kernels
  - docs/plan.md
  - site/src/content/docs/guide/determinism.mdx
  - site/src/lib/facts.ts
compiler: []
---

**Document control**

| Field         | Value                                                                               |
| ------------- | ----------------------------------------------------------------------------------- |
| Identity      | Design record 0005, status `draft`                                                  |
| Date          | 2026-10-05 (UTC), the date of authorship                                            |
| Author        | Written in a Claude Code session for the owner. The owner's review is the approval  |
| Applicability | Every `.shade.ts` under `packages/radiance/src/kernels`. `docs/plan.md` §3.1 item 4 |
| Baseline      | `main` at 0f17f5e. The compiler pinned at e923a34                                   |
| Pull request  | typeshade/radiance#6, the pull request that carries this record and is its review   |

## What changes

### Before

Plan §3.1 item 4 states the promise. The sampler is integer-exact by design, and `turn()` in
`trace.shade.ts` replaced the GPU's `sin` and `cos` after a measured 3 % divergence
(`docs/typeshade-feedback.md`, 2026-10-05). Both are facts in two files. No rule says a new
kernel must do the same, and no test reads the compiler's determinism report (surface §38).

### After

**The promise**, written for users in the guide and for authors here:

- On one device and one driver, one seed gives one image, bit for bit, every time, when the
  renders have the same split (defined below).
- Across devices and drivers, the image is within the oracle gate's tolerance (record 0002):
  the operations WGSL leaves to the driver may move a path by one sample's share, and the
  gate's `rel` and `mean` bound it.
- The CPU oracle's render is the reference image of a scene and a seed.

**The split.** A frame is one call of `render` on a `PathTracer` that adds samples. It adds the
same number of samples to every pixel. The split of a render is the list of the sample counts of
its frames. Two renders of one seed on one device and one driver are bit-identical when their
splits are the same. The promise says nothing about two renders with different splits.

The condition comes from the kernel. `trace` in `packages/radiance/src/kernels/trace.shade.ts`
adds the samples of one frame to a pixel in index order, starting from zero. It then adds that sum
to the pixel's entry in `accum`. Float addition is not associative. Another split adds the same
samples in another order, so the last bits can differ.

These facts set the split. The code is `render` in
`packages/radiance/src/renderers/PathTracer.ts`:

- The first frame that a renderer draws adds one sample. That frame measures the speed that sizes
  the tiles (record 0001, "Tiles and the watchdog"). `reset()` and a new `seed` do not bring this
  rule back.
- Each later frame adds the value that `samplesPerFrame` has at the start of the frame, rounded
  down and not less than 1.
- When `maxSamples` is finite, the last frame adds no more than the samples left to reach it.
- When the caller sets `targetFrameTime`, `render` changes `samplesPerFrame` after each frame. The
  split then follows the frame times and changes from run to run.
- A frame at a lower resolution (`preview` above 1) adds one sample.
- The tiles of a frame do not change the split. One pixel is one invocation in one dispatch. The
  test "adds the same samples to every pixel whatever the tiles, bit for bit" in
  `packages/radiance/src/kernels/kernels.test.ts` holds this, with the same frames in each render.

With the same `samplesPerFrame` and `maxSamples`, two first renders of two new renderers have the
same split. So do two later renders of one renderer. The first render of a renderer and a later
render of it do not.

**The six rules** every kernel file under `src/kernels` is written under. Each file's header
comment names the rules it leans on.

1. **No `random(seed)`.** The compiler's `random` is the sine hash at the pin (surface §55)
   and is driver-dependent. Every random number comes from `sampler.shade.ts`, which is
   integer arithmetic.
2. **No transcendental decides.** `sin`, `cos`, `exp`, `exp2`, `log`, `log2`, `pow`, `fract`,
   `tan`, `atan`, `atan2`, `asin`, `acos` never feed a comparison, an index, a loop bound or a
   lobe choice. They may produce a radiance value (a BSDF's value, the tone map, a Fresnel
   term). A direction from an angle goes through `turn()` or its kind: sums and products. A
   comparison that selects between two pieces of one continuous curve (the tone map's knee)
   produces a value and is not a decision. The pieces agree at the knee, so a driver's error in
   `exp2` moves the result by that error and not onto another path.
3. **Bounded operations may steer, and the gate admits them.** `sqrt`, `/`, `normalize`,
   `length`, `dot`, `cross`, `inverseSqrt` and `reflect` are bounded or inherited rows and are
   needed in every intersection and bounce. The compiler reports `reflect` as inherited from
   `x - 2 * dot(x, y) * y`. A path they move by one sample's share is what the differential
   gate's `rel` and `mean` are for.
4. **No atomics on the accumulation path.** One pixel is one invocation in one dispatch. A
   pixel's samples are added in index order inside it (record 0001, tiles). The invocation adds
   its sum to the accumulator once in a frame. The bits therefore depend on the split of the
   samples into frames (the split, above).
5. **A reduction has one order.** A sum over many values on the GPU (M5's loss, a histogram)
   is a compiler kernel function (Rule 7.2's tree) or is read back and summed on the host.
6. **No `f16`, no subgroup operation, no `raw` WGSL** in a kernel the gates hold. A faster
   variant that uses one is a separate pipeline, behind an option that names it, and the
   determinism promise is stated for the gated kernel only.

**The lint.** `packages/radiance/src/kernels/determinism.test.ts` (record 0002, step 3)
compiles every kernel file and reads `compile().determinism`. Each row's `op` must be in the
allowlist, and each `absolute`-kind row must have every function in its `where` in the
value-only list:

```ts
/** Operations the kernels may use anywhere (bounded, inherited, or exact on both targets). */
const ALLOWED = ['/', 'sqrt', 'inverseSqrt', 'normalize', 'length', 'dot', 'cross', 'reflect', 'mix', 'fma', 'exp2', 'pow', 'mod'];
/** Operations a function may use only to produce a value: the functions named here. */
const VALUE_ONLY = { tonemap: ['exp2', 'pow'], fresnel: ['pow'] /* M3 adds the BSDF's */ };
```

A row outside both fails the test with the operation, its kind, its accuracy and the functions
it is in. The lists are edited only with this record amended: a pull request that adds a row
cites the rule it keeps. At pin e923a34 the compiler reports `exp2` and `pow` as rows that are
not of kind `absolute`, so `VALUE_ONLY` binds no row yet. The lint keeps the list for a compiler
that reports one.

The block above shows the two lists. They are in `packages/radiance/src/kernels/determinism-lists.ts`,
with `outsideLists`, the rule that reads a report against them. `determinism.test.ts` and
`site/src/lib/facts.ts` import that file, so the lint and the site judge a row by one rule. The
file imports nothing, and `index.ts` does not export it.

**The M4 report.** Plan §4's M4 acceptance is "a kernel set for which the report says zero
driver-dependent operations". The lint is the report's first form: its output, with the
allowlist and the reason for each row, becomes a page of the guide at M4.

The report has a second form since typeshade/radiance#21. The page of the determinism example
prints the rows of `trace.shade.ts` and `sampler.shade.ts`. `kernelDeterminism` in
`site/src/lib/facts.ts` reads them at each build of the site, and the build stops on a row that
`outsideLists` does not admit. The guide's page, `site/src/content/docs/guide/determinism.mdx`, is
written by hand. It states the promise, the split and a check, and it prints no row. M4 still owes
the generated page: the rows of every kernel, each with its reason.

## Why

- The 3 % divergence was found by measurement, after the kernel was written. A rule named in
  the file and a test that reads the report find it at the pull request.
- The sampler is the one place a hash is needed, and it is exact. Nothing else in a path
  tracer needs `random`.
- Rule 3 is honest about what cannot be made exact: an intersection divides. The gate's
  tolerance is written for it, and M1 measured 1.44e-6 under it.
- Rule 5 follows from the compiler's own determinism report (`order` rows) and from plan
  §3.6's FLIP decision (sorted gather, not atomic scatter).

Alternatives considered: making every operation exact by computing in integers or `f64`
(a path tracer at `df64` cost is out of the question for an interactive renderer). No rule
and no lint (the status quo, which caught the divergence late).

## What it touches

- `src/kernels/*.shade.ts` headers. `determinism.test.ts` and `determinism-lists.ts` (new). The
  guide's determinism page, `site/src/content/docs/guide/determinism.mdx`, written by hand, and
  its generated form at M4. The page of the determinism example, which prints the report
  (`site/src/lib/facts.ts`). `docs/plan.md` §3.1 item 4 gains a pointer to this record.

## Implementation, in steps

1. **The lint and the headers**, with record 0002 step 3: the test, the allowlist at the pin's
   rows (measured when the test is written and recorded in the pull request), the header line
   in each kernel file.
2. **The guide page** states the promise, the split and a way to check it. An author writes it
   by hand, and typeshade/radiance#21 delivers it with the determinism example.
3. **The generated report** at M4: a page of the guide, generated from the lint's output, with
   the rows of every kernel and the reason for each row.

## Decisions for the owner

1. The promise as stated, with the cross-device part bounded by the gate, not bit for bit.
2. The six rules.
3. The allowlist as a test, amended only with this record.
4. The promise carries the condition of the split: two renders are bit-identical when their
   splits are the same. This record does not change the kernel to remove the condition.
   Proposal, not made here: the kernel starts each frame's sum from the pixel's entry in `accum`.
5. An author writes the guide's determinism page by hand, and the generated report is M4's.

## Record

**Amendment 1** (2026-10-05, UTC). Record 0002 step 3's lint, written against the compiler at
e923a34, found a row the lists did not admit: `reflect`, which `trace.shade.ts` used at M1 and
which the compiler reports as its own inherited row. Rule 3 and `ALLOWED` gain `reflect`. Rule 2
says that the tone map's knee is a value, not a decision. The note after the lists records that
`VALUE_ONLY` binds no row at this pin.

**Amendment 2** (2026-10-06, UTC). The pull request typeshade/radiance#21 merged the determinism
example at 6ad088d. Its "Deviations" section has seven entries, and entries 1 to 3 differ from
this record. Two more differences are not in that list: the file of the lists, and a finding of
2026-10-06 about the first frame. This amendment writes entries 1 and 2 and the file of the lists
into the record, as "made part of the record". It leaves entry 3 and the finding open. The merge of
the pull request that carries it is the owner's acceptance of each entry marked "made part of the
record". The merge settles no open entry.

- **The split** (deviation 1 of #21). The record promised one image for one seed with no
  condition. The kernel adds each frame's sum to the accumulator. Two renders agree bit for bit
  when their splits are the same, and with other splits they can differ (the numbers are below).
  Proposed: made part of the record. "The promise" states the condition, "The split" states what
  sets it, and Rule 4 says that the invocation adds its sum to the accumulator once in a frame.
  Decision 4 is new. It asks the owner to accept the condition.
- **The guide's page** (deviation 2 of #21). The record put the guide's determinism page at M4,
  generated from the lint's output. The page `site/src/content/docs/guide/determinism.mdx` is
  written by hand. It states the promise, the split and a check. Proposed: made part of the
  record. "The M4 report" and step 2 say that the page is by hand. Step 3 keeps the generated page
  at M4. The rows of the report are already generated, on the page of the example. Decision 5 is
  new.
- **The file of the lists** (a difference that #21 did not list). "The lint" showed the two lists
  in `determinism.test.ts`. The pull request moved them to `determinism-lists.ts`, with
  `outsideLists` and `describeRow`, so that the lint and the site judge a row by one rule.
  Proposed: made part of the record. "The lint" names the file. The rule does not change: the
  lists change only with this record amended.
- **The fourth render** (deviation 3 of #21). The example renders seed 1 once more at the end, so
  that the canvas and the still show seed 1. That is one render in four. This record states no
  rule on the renders of an example, and an example needs no record (`docs/design/README.md`,
  "When a change needs one"). Proposed: open. Question for the owner: keep the fourth render, or
  end the example on seed 1 in three renders? The next entry shows a way that needs no fourth
  render.
- **The first frame and the example** (found on 2026-10-06, not in #21). The first render of a
  renderer has a split of its own, so the first and the second render of the example have
  different splits. At 6ad088d the example counts 5,404 differing floats of 24,576 for seed 1
  against seed 1 again, and not 0. `PathTracer.ts` at adfbb71, the revision that the pull request
  body measured, gave every frame `samplesPerFrame` samples. The commit 9f2cf1a added the
  first-frame rule.
  The sample code of the guide's page has the same fault, by the code: its first render adds 65
  samples and its second adds 64. Proposed: open. Two ways close it, and decision 4 chooses
  between them. The site can give the renders of the example and of the sample the same split.
  Inference: the second and the third render of one renderer have the same split, so an example
  that draws seed 2 first and then seed 1 twice makes its three counts in three renders and ends
  on seed 1. Or the kernel can remove the condition.

**The numbers of Amendment 2.** A page in the render harness (`scripts/gates/_browser.mjs`)
measured these on 2026-10-06 at `main` 6ad088d, pin 596c805, bun 1.3.14, Chromium on SwiftShader.
The page is not in the tree, and no test holds the numbers. One renderer drew the Cornell box
(`scenes.cornell`) at 16 by 16 pixels and 64 samples, with seed 1 unless a line says seed 2. The
reference render is its second render, in 4 frames of 16 samples. Each line counts the floats, of
1,024, that differ from the reference render.

- The third render, with the same split (4 frames of 16): 0.
- A first render of a new renderer (frames of 1, 16, 16, 16 and 15): 287.
- 7 samples a frame (nine frames of 7 and one of 1): 430.
- 1 sample a frame (64 frames): 558.
- Seed 2 with the same split as the reference render: 765.

A scratch change of `trace`, which is not in the tree, started the sum of each frame at the pixel's
entry in `accum` and not at zero. It wrote that sum back with the count raised by the frame's
samples. With it, the first render, the render of 7 samples a frame and the render of 1 sample a
frame each gave 0 differing floats against the reference render. Seed 2 still gave 765. This is an
observed result and not a design. Decision 4 does not choose it.

**Approval and plan record.** Accepted on 2026-10-05 (UTC). The owner approved the merge of typeshade/radiance#6 in the conversation, which merged this record as `draft` at 9e8b479. The owner then said to implement the records with Opus 5.5 and Sonnet 5.5, and that go-ahead is the acceptance. Every entry of "Decisions for the owner" stands as proposed.

**Configuration and validation record.** The pull request typeshade/radiance#15 (cb07747)
delivered step 1. The pull request typeshade/radiance#21 (6ad088d) delivered step 2. The compiler
pin at 6ad088d is 596c805. Step 3 belongs to M4 and is not started. The determinism gate and the
example measured these numbers.

- The gate. `bun run gate:determinism` ran on 2026-10-06 at `main` 6ad088d, pin 596c805, bun
  1.3.14, Chromium on SwiftShader. It renders the Cornell box at 16 by 16 pixels and 1,024
  samples, 64 a frame, with a new renderer for each render, so the three renders have the same
  split. Result: pass. Of 1,024 floats, 0 differ between two renders of seed 1, and 765 differ
  from seed 2.
- The example on 2026-10-05. The pull request body of #21 gives the run at adfbb71 on `main`
  bc99533, pin e923a34, on the analytic kernel, before the first-frame rule. For seed 1 against
  seed 1 again, 0 floats differ. For seed 1 against seed 2, 136,002 floats differ.
- The example on 2026-10-06. The example ran in the render harness at 6ad088d at 96 by 64 pixels,
  64 samples and 16 a frame. For seed 1 against seed 1 again, 5,404 of 24,576 floats differ. For
  seed 1 against seed 2, 14,049 differ. The first count is the finding of Amendment 2.
- Not run. `bun run check`, the other gates of `bun run harness` and the still capture did not
  run for this amendment. It changes documents only.

The report's rows at the pin, which this paragraph first promised, are not recorded here. The
page of the determinism example prints them at each build of the site.
