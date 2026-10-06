# Design records

A design record is the agreed shape of one part of the engine before its code is written. It
is this repository's form of the compiler's change proposals (`vendor/typeshade/changes/README.md`):
the record names what changes, why, what it touches, and the steps that implement it, and the
implementation is held to it.

The records exist because the engine is built on a pre-1.0 runtime by more than one agent and
more than one model. A contract that lives only in one session's memory is rewritten by the
next session. A contract that lives here is implemented as written, or amended here first.

## When a change needs one

A diff needs a record when it does any of the following:

| Criterion   | What counts                                                                                                |
| ----------- | ---------------------------------------------------------------------------------------------------------- |
| contract    | Changes the set of buffers a kernel binds, the layout of one, or the uniform blocks (record 0001)          |
| exports     | Adds, removes or reshapes an export of `@typeshade/radiance` or `@typeshade/radiance-addons` (record 0003) |
| gates       | Adds, removes or changes a gate, a gate scene or a threshold in `scripts/gates.mjs` (record 0002)          |
| determinism | Changes a rule a kernel is written under, or the determinism allowlist (record 0005)                       |
| materials   | Changes the material record, the shading contract or the texture plan (record 0004)                        |
| compiler    | Opens, withdraws or changes a proposal this repository owes the compiler (record 0006)                     |

A change outside these needs no record: a bug fix inside a contract, a test, an example, a page
of the site, a performance change that moves no layout.

## The lifecycle

1. **Draft.** The author copies the shape below into `docs/design/NNNN-short-name.md` with the
   next free number, and opens it as its own pull request with `status: draft`.
2. **Accepted.** The owner's review or go-ahead in the conversation merges it with
   `status: accepted`. The merged text is the approved design.
3. **Implementation.** Each implementing pull request names the record on a line of its own in
   the commit message: `Design: 0001`. A test that verifies a decision carries
   `Verifies: Design 0001.3` in a comment. A pull request that reaches past what the record
   declares amends the record first, in its own pull request.
4. **Implemented.** The pull request that finishes the record's steps sets
   `status: implemented` and records the delivered configuration: the commits, the pin, the
   gates that ran and their numbers.
5. **Superseded** when a later record replaces it, naming the later one.

A record is written to be implemented by an agent that has not read this conversation. It
names files, types, layouts in bytes, tests and acceptance numbers, and it labels a fact, an
inference, a proposal and a decision as what each is.

## The shape of a record

```yaml
---
id: '0001'
title: One line saying what the engine can do after this change
status: draft # draft | accepted | implemented | superseded
milestones: [M2] # the milestones of docs/plan.md the record serves
touches: [] # directories and files the implementation changes
compiler: [] # the items of record 0006 the implementation depends on, if any
---
```

Then a document-control table (the date and what it means, the baseline commit and pin, the
pull request), and these sections:

- **What changes.** The contract, before and after. Layouts, names, invariants.
- **Why.** The evidence, measured where it was measured, and the alternatives considered.
- **What it touches.** Files, tests owed, gates, and the site pages that describe the old shape.
- **Implementation, in steps.** Numbered pull-request-sized steps, each with what it delivers
  and what proves it.
- **Decisions for the owner.** Each choice the record makes that the owner may want changed, as
  a numbered list. `bun run reqs:sync` makes each entry a Doorstop item (`reqs/README.md`).
- **Record.** The approval and validation records. For a draft, both say they do not yet apply.

## The records

| Id                                           | Title                                                                                                                                       | Status   | Milestones  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------- |
| [0001](0001-scene-data-model.md)             | The scene data model: from the scene graph to the kernel's buffers                                                                          | accepted | M2, M2a, M3 |
| [0002](0002-verification.md)                 | Verification: the gates, their scenes, their numbers, and the instrument they prove                                                         | accepted | M2 onward   |
| [0003](0003-public-api.md)                   | The public API: what is public, its names, its versions, and the first release                                                              | accepted | M2, 0.1.0   |
| [0004](0004-materials-and-shading.md)        | Materials and shading: the material record, the shading contract, and the texture plan                                                      | accepted | M2, M3      |
| [0005](0005-determinism.md)                  | Determinism: the promise, the kernel rules, and the lint that holds them                                                                    | accepted | M2, M4      |
| [0006](0006-compiler-boundary.md)            | The compiler boundary: what the engine needs from the runtime, as proposals                                                                 | accepted | M2 to M5    |
| [0007](0007-webgl2-tier.md)                  | The WebGL2 tier: the same kernels, no WebGL call in the engine, and gates for both tiers                                                    | draft    | M8          |
| [0008](0008-interaction-controls.md)         | Interaction controls: a host ray cast, four modes (orbit, select, translate, rotate) and a material inspector                               | accepted | none        |
| [0010](0010-materials-lights-and-outputs.md) | The first public demo (M3): a principled BSDF, textures, lights, a physical camera, AOVs with EXR output and a product viewer beside Cycles | draft    | M3          |

The order of implementation is 0001 and 0002 first, in parallel, because M2 is written on them.
0003 is done before the first npm release. 0004 and 0005 are needed before M3. 0006 is a list
of proposals the compiler's owner schedules. Each record names the item it waits on.
0007 waits for the compiler's change 0054 and the pin that carries it. It serves milestone M8, which the plan pull request proposes, and merges after that pull request.
0010 serves M3. It has six parts, and each part merges alone. It waits for the analytic sphere record and for record 0009 (sampling quality), which merge before it. Its texture parts wait for the compiler's change 0050.
0008 serves no milestone of the plan. It is a change to the engine's core (the ray cast), to the addons (the controls) and to the site. The record is accepted, and its implementation runs in the steps the record lists, after the Sponza example (decision 20).
