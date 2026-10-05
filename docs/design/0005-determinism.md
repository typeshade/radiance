---
id: '0005'
title: The determinism promise is stated once, every kernel is written under six rules, and a test reads the compiler's determinism report against an allowlist
status: draft
milestones: [M2, M4]
touches:
  - packages/radiance/src/kernels
  - docs/plan.md
compiler: []
---

**Document control**

| Field         | Value                                                                               |
| ------------- | ----------------------------------------------------------------------------------- |
| Identity      | Design record 0005, status `draft`                                                  |
| Date          | 2026-10-05 (UTC), the date of authorship                                            |
| Author        | Written in a Claude Code session for the owner; the owner's review is the approval  |
| Applicability | Every `.shade.ts` under `packages/radiance/src/kernels`; `docs/plan.md` §3.1 item 4 |
| Baseline      | `main` at 0f17f5e; the compiler pinned at e923a34                                   |
| Pull request  | typeshade/radiance#6, the pull request that carries this record and is its review   |

## What changes

### Before

Plan §3.1 item 4 states the promise. The sampler is integer-exact by design, and `turn()` in
`trace.shade.ts` replaced the GPU's `sin` and `cos` after a measured 3 % divergence
(`docs/typeshade-feedback.md`, 2026-10-05). Both are facts in two files; no rule says a new
kernel must do the same, and no test reads the compiler's determinism report (surface §38).

### After

**The promise**, written for users in the guide and for authors here:

- On one device and one driver, one seed gives one image, bit for bit, every time.
- Across devices and drivers, the image is within the oracle gate's tolerance (record 0002):
  the operations WGSL leaves to the driver may move a path by one sample's share, and the
  gate's `rel` and `mean` bound it.
- The CPU oracle's render is the reference image of a scene and a seed.

**The six rules** every kernel file under `src/kernels` is written under. Each file's header
comment names the rules it leans on.

1. **No `random(seed)`.** The compiler's `random` is the sine hash at the pin (surface §55)
   and is driver-dependent. Every random number comes from `sampler.shade.ts`, which is
   integer arithmetic.
2. **No transcendental decides.** `sin`, `cos`, `exp`, `exp2`, `log`, `log2`, `pow`, `fract`,
   `tan`, `atan`, `atan2`, `asin`, `acos` never feed a comparison, an index, a loop bound or a
   lobe choice. They may produce a radiance value (a BSDF's value, the tone map, a Fresnel
   term). A direction from an angle goes through `turn()` or its kind: sums and products.
3. **Bounded operations may steer, and the gate admits them.** `sqrt`, `/`, `normalize`,
   `length`, `dot`, `cross` and `inverseSqrt` are bounded or inherited rows and are needed
   in every intersection. A path they move by one sample's share is what the differential
   gate's `rel` and `mean` are for.
4. **No atomics on the accumulation path.** One pixel is one invocation in one dispatch; a
   pixel's samples are added in index order inside it (record 0001, tiles).
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
const ALLOWED = ['/', 'sqrt', 'inverseSqrt', 'normalize', 'length', 'dot', 'cross', 'mix', 'fma', 'exp2', 'pow', 'mod'];
/** Operations a function may use only to produce a value: the functions named here. */
const VALUE_ONLY = { tonemap: ['exp2', 'pow'], fresnel: ['pow'] /* M3 adds the BSDF's */ };
```

A row outside both fails the test with the operation, its kind, its accuracy and the functions
it is in. The lists are edited only with this record amended: a pull request that adds a row
cites the rule it keeps.

**The M4 report.** Plan §4's M4 acceptance is "a kernel set for which the report says zero
driver-dependent operations". The lint is the report's first form: its output, with the
allowlist and the reason for each row, becomes a page of the guide at M4.

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
(a path tracer at `df64` cost is out of the question for an interactive renderer); no rule
and no lint (the status quo, which caught the divergence late).

## What it touches

- `src/kernels/*.shade.ts` headers; `determinism.test.ts` (new); the guide's determinism
  page (M4); `docs/plan.md` §3.1 item 4 gains a pointer to this record.

## Implementation, in steps

1. **The lint and the headers**, with record 0002 step 3: the test, the allowlist at the pin's
   rows (measured when the test is written and recorded in the pull request), the header line
   in each kernel file.
2. **The guide page** at M4, generated from the lint's output.

## Decisions for the owner

1. The promise as stated, with the cross-device part bounded by the gate, not bit for bit.
2. The six rules.
3. The allowlist as a test, amended only with this record.

## Record

**Approval and plan record.** This record does not yet apply.

**Configuration and validation record.** This record does not yet apply. Implementation will
record the report's rows at the pin when the lint was written.
