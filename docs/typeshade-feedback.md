# Using TypeShade: field notes

This renderer is where TypeShade gets used for real, as `stepinside` is, so this file records
what that is like: friction, surprises, gaps in the docs, things that were hard, and things that
went well. It is written as the work happens, not afterwards, and it is the input for a round of
feedback to the language. A problem that is a bug or a missing feature also becomes an issue on
typeshade/typeshade, linked here. A note does not wait for one.

Add an entry at the top of the log. Keep it concrete: what was being built, what happened, what
was expected, what it cost, and what was done instead. Say which TypeShade commit it was (the
pin in `vendor/typeshade`, unless noted).

Areas: **language** (what an author can write), **diagnostics**, **runtime** (`typeshade/runtime`),
**host** (the Vite plugin, host views, CPU calls), **tooling** (`tshc`, the MCP server, the
editor), **docs**.

## Log

### 2026-10-09 · runtime · Record 0011: compiler needs C2 to C7 filed, and C1's three missing needs

Pin 596c805. Compiler `main` read at 6e8c7fd. Draft record 0011 (typeshade/radiance#67) lists
eight compiler needs. C1 and C8 were filed as #535 and #536 (the entry below). Its decision 38
says the rest go to typeshade/typeshade before the step that needs them. Each issue below has a
section "WebGL2 and CPU" under the owner's requirement (#130, #138), and its lowerings are
proposals. Each need was searched for first among open and closed issues.

- C1, reverse-mode `grad`. The three needs #535 did not state (the differentiable BSDF of record
  0010, the adjoint of a storage read, and pose gradients) are a comment on it
  (https://github.com/typeshade/typeshade/issues/535#issuecomment-6065114178). The compiler's
  change 0056 (reverse mode before 1.0) has been accepted on its `main` since #535 was filed. As
  read, it covers the storage read. Whether it covers the BSDF's uniform table and the poses was
  not checked.
- C2, a stable sort of `u32` keys with values on every tier. Training sorts the (tile, surfel)
  keys each step. A stable sort's output is unique, so each tier may use its own algorithm.
  Filed as typeshade/typeshade#539 (https://github.com/typeshade/typeshade/issues/539).
- C3, atomics on the oracle and on WebGL2, for the two-word fixed-point sum. No new issue: it
  belongs to #138. Change 0054 (atomics on WebGL2, the oracle in the phased order) may meet it
  on the compiler's `main`. That was read, not run. The need and its tests are a comment on #138
  (https://github.com/typeshade/typeshade/issues/138#issuecomment-6065114790).
- C4, indirect dispatch, so a step follows the live surfel count. Filed as
  typeshade/typeshade#540 (https://github.com/typeshade/typeshade/issues/540).
- C5, device limits above 128 MiB for part 6. The compiler's change 0051 (draft, #489) is this
  need on WebGPU. The issue asks for it, and for `rt.limits` on the WebGL2 tier, which 0051
  predates. Filed as typeshade/typeshade#541 (https://github.com/typeshade/typeshade/issues/541).
- C6, GPU time through `timestamp-query` (record 0006, item 5, not filed until now). Filed as
  typeshade/typeshade#542 (https://github.com/typeshade/typeshade/issues/542).
- C7, the cost of about 400,000 dispatches a run (an estimate: ten a step, 40,000 steps). A
  measurement first, then a sequence recorded once if it matters. Filed as
  typeshade/typeshade#543 (https://github.com/typeshade/typeshade/issues/543).

### 2026-10-09 · language · Records 0010 and 0011: three compiler needs filed as issues

Pin 596c805. Draft record 0011 (2DGS capture and training, typeshade/radiance#67) and record
0010 (M3 textures) need three things the compiler does not have. Each is now an issue on
typeshade/typeshade. Each issue has a section "WebGL2 and CPU". There, the owner's requirement
is that a WebGPU extension the engine uses stays usable on WebGL2 by a lowering, or falls back
observably to the CPU tier (#130, #138). The lowerings in the issues are proposals.

- Reverse-mode `grad` before 1.0 (record 0011, need C1). Forward mode needs one pass for each
  parameter, so it cannot train a scene of many thousands of splats. The issue lists the tape,
  runtime-length loops, a deterministic fixed-point sum for the scatter, the API, the gradient
  check and the tiers. Filed as typeshade/typeshade#535
  (https://github.com/typeshade/typeshade/issues/535).
- Subgroups, `@subgroup_size` and immediates (record 0011, need C8). They are a speed path for
  the adjoint sum, and they block nothing. The issue proposes a subgroup of size 1 on WebGL2 and
  on the oracle, and plain uniforms for immediates on GLSL. Filed as typeshade/typeshade#536
  (https://github.com/typeshade/typeshade/issues/536).
- Bindless resource tables, marked "watch and design", since Chrome has them as an experiment
  only. A table would let the path tracer sample any texture after any hit. Records 0004 and
  0010 use four texture arrays by size class instead. Filed as typeshade/typeshade#537
  (https://github.com/typeshade/typeshade/issues/537).

### 2026-10-06 · tooling · Change 0054 answers #468, and the direction changed

Pin 596c805. The entry of 2026-10-05, "a warning on every compute module", called this renderer
WebGPU-only by design and filed typeshade/typeshade#468. The owner then set the direction that
WebGL2 is a target too (`docs/plan.md`, section 12, decision 7). The compiler's change 0054
(accepted at a5dcbe7, amended at 146b162) answers #468. It will run every `@compute` entry on
WebGL2, so the `TS8015` warning is not permanent. The pin is before 0054, so `tshc check` still
warns on the kernels. The engine's code does not change until the pin moves. The plan proposes
milestone M8 for the work.

### 2026-10-05 · runtime · Record 0001 step 3: a NaN bit pattern does not survive the upload either

Pin e923a34. Record 0004 stores "no texture" as the word 0xffffffff, the bits of a NaN. The
runtime packs a `Float32Array` binding one number at a time through `DataView.setFloat32`
(`pack` in `src/core/host-entry.ts`). Measured in bun 1.3.14: the word 0xffffffff comes out as
0x7fc00000. So the GPU reads another texture id than the host wrote, as the oracle does
(typeshade/typeshade#479). M2 reads no texture id, so no picture moves today. M3's textures will
read them. No new issue is owed: typeshade/typeshade#479 and the compiler's change 0045 (PR
#483, implemented on `main` after the pin) cover it. Change 0045 says to keep an integer word
in a `storage<array<u32>>` binding. Measured in bun 1.3.14 at the pin: the runtime's `pack`
keeps 0xffffffff on a `u32` lane (`setUint32`) and gives 0x7fc00000 on an `f32` lane. So the
five texture ids and the type-and-flags word belong in a `u32` binding, uploaded from a
`Uint32Array`. That is an amendment to record 0004, open for the owner.

### 2026-10-05 · language · Record 0001 step 3: the compiler and the editor disagree on an unset array

Pin e923a34. The traversal's stack is `let stack: array<u32, 32>;`, as WGSL writes a zeroed
array. `compile()` accepts it and emits `var stack: array<u32, 32>;`. `tshc check` refuses it
with TypeScript's `TS2454` ("used before being assigned") at each `stack[i] = ...`. The call form
`array<u32, 32>()` is refused too (`TS8019`: it expects 32 elements). So each walk writes 32 zeros
out. Rule 12.7 makes the two halves one vocabulary, and here they disagreed at the pin. Change
0043 (PR #473, merged as 46f6b84 after the pin) closes that: at `main` fd39ba3, both halves
refuse the first spelling with `TS8075`. The zero-value call stays refused at both commits.
Filed as typeshade/typeshade#495 (https://github.com/typeshade/typeshade/issues/495). Since pin
596c805 carries change 0047, the stacks of `nearest` and `occluded` in `intersect.shade.ts` use
`array<u32, 32>()`.

### 2026-10-05 · host · Record 0001 step 3: the oracle pays for every aggregate it copies

Pin e923a34. The two-level walk made the Cornell box's oracle render about five times slower
than M1's. M1 took 35 s for 16 x 16 at 1,024 samples on one process, and the walk took about
175 s. A profile showed most of the time in `cloneValue` and `Array.prototype.map`. The generated
code copies every `const` of a struct or a vector, and it runs vector arithmetic through `map`.
Three changes in the kernel's style brought it to about 120 s, with no change to its arithmetic:
the slab and triangle tests in scalars, a node's box passed straight to the test, and the
instance's ray passed as a parameter. The oracle script now splits the frame over four processes.
That gives about 55 s alone, and 75 s beside the harness's GPU render. A cheaper copy, or none
for a `const` the function never writes, would help every oracle user.

### 2026-10-05 · runtime · Record 0006 step 1: the four proposals the engine needs first are open

Pin e923a34. Record 0006 lists what the engine needs from the runtime, with the evidence at the
pin. Items 1 to 4 are open on typeshade/typeshade as draft change proposals, one pull request
each, written in the compiler's own procedure and reviewed against its tree. Their numbers moved
from 0043 to 0046 to 0047 to 0050, because the compiler's `main` took 0043 to 0045 and its
pull request #486 took 0046 while the drafts were written. Then its `main` took 0047 for the
array zero value (#496), so item 1 moved to 0051 on 2026-10-06.

- Item 1, device limits: proposal 0051 (first 0047), typeshade/typeshade#489
  (https://github.com/typeshade/typeshade/pull/489).
- Item 2, a partial buffer write: proposal 0048, typeshade/typeshade#493
  (https://github.com/typeshade/typeshade/pull/493).
- Item 3, raw bytes as a storage host value: proposal 0049, typeshade/typeshade#494
  (https://github.com/typeshade/typeshade/pull/494).
- Item 4, a texture write: proposal 0050, typeshade/typeshade#490
  (https://github.com/typeshade/typeshade/pull/490).

Each proposal ends with the decisions the owner makes before acceptance. Items 5, 6 and 9 are
issues (item 6 is typeshade/typeshade#467). Items 7, 8 and 10 wait for their milestones.

### 2026-10-05 · language · Record 0001 step 2: `bitcast` takes a scalar only

Pin e923a34. `layout.shade.ts` reads the four integer words of an instance from one `vec4`.
WGSL's `bitcast<vec4<u32>>(v)` reads them in one call. TypeShade refuses `bitcast<vec4u>(v)` with
`TS8003`, which names the two scalar forms it has. So `instanceBases` writes four scalar
`bitcast<u32>` calls in a `vec4u` constructor. The diagnostic was clear, and the workaround cost
a minute. Filed as typeshade/typeshade#478 (https://github.com/typeshade/typeshade/issues/478).

### 2026-10-05 · docs · Record 0001 step 2: the authoring guide shows no storage declaration

Pin e923a34. The task said to declare the storage bindings as `AUTHORING.md` shows. Its "Storage
buffers" section shows only the builder API, `storageBuffer(name, type, options)`. The
`"use typeshade"` form, `declare const nodes: storage<array<vec4>>`, is in the surface reference
(§1) and in `trace.shade.ts`. A reader who starts from the guide finds no example of it. Filed as
typeshade/typeshade#480 (https://github.com/typeshade/typeshade/issues/480).

### 2026-10-05 · host · Record 0001 step 2: a NaN bit pattern does not survive the oracle

Pin e923a34. Record 0001 stores an integer word as the bits of an f32. On the oracle, a binding
value is a JavaScript number, and `bitcastU32` writes it through a `DataView`. Measured in bun
1.3.14: the words 0x7fc00001, 0x7fffffff and 0xffc00005 come back as 0x7fc00000. A GPU load and
a `bitcast` keep the bits (an inference from WGSL, not measured here). No word inside record
0001's limits has a NaN pattern, so the layout is safe today. A flags word with its high bits set
would read differently on the two sides. Filed as typeshade/typeshade#479
(https://github.com/typeshade/typeshade/issues/479).

### 2026-10-05 · host · Record 0001 step 2: the host imports a constant from a shader module

Pin e923a34. `src/accel/bvh.ts` imports `NODE_STRIDE` and the node word constants from
`layout.shade.ts`. Under `bun test`, the preload plugin (`scripts/preload.ts`) gives the module's
frozen copies, and `tsc` reads them from the host view. So the host keeps no copy of a stride.
Record 0001's fallback, a host copy that a test holds equal to the kernel's, is not necessary.

### 2026-10-05 · host · The library site: the Vite plugin inside Astro and Starlight

Pin e923a34. The site (Astro 7, Starlight, React islands) imports the engine, whose kernels are
`*.shade.ts` modules, and `typeshade/vite` compiled them inside Astro's Vite with no change:
the examples run the same kernels the harness gates. Two notes. Bun prints `moduleSuffixes is
not supported yet` for every tsconfig that sets the host views' suffix, on every `bun run`. It
is harmless but looks like an error in a build log. And the engine became classes in three.js's
shape on `typeshade/runtime` (`PathTracer` owns the runtime, the program and the textures), and
the public runtime was enough for all of it: nothing reaches past it (`scripts/boundary.mjs`).

### 2026-10-05 · language · M1: what went well

Pin e923a34. The path tracer is about 300 lines of TypeShade: classes for the uniform blocks and
the hit record, a struct returned from a function, loops over runtime-length storage arrays,
`reverseBits` and hexadecimal `u32` constants for the sampler, and a second shader module
imported by relative path. `tshc check` passed it on the second try (the first called a class
as a constructor, `Hit(...)`. An object literal is the spelling). The CPU oracle ran the same
module unchanged, and its integer arithmetic matched `Math.imul` exactly, so the sampler draws
the same numbers on both sides.

### 2026-10-05 · runtime · M1: GPU `sin` and `cos` steer paths away from the oracle's

Pin e923a34. With `cos` and `sin` choosing each bounce's direction, about 5% of the pixels at
1 spp took another path on SwiftShader than on the f32 oracle, and the 1024 spp images differed
by 3% on average. The oracle at f32 and at f64 agreed on every pixel, so the GPU was the one
apart: WGSL allows `sin` and `cos` an absolute error of 2^-11, and that turns a ray past another
edge. Replacing them with a polynomial of sums and products (`turn` in trace.shade.ts), which
WGSL rounds correctly, brought the mean difference to 1.4e-6. This is the plan's constraint 4
(the determinism report) seen from a renderer: any transcendental that steers control flow
should not be the GPU's own. Not a bug. A note for the determinism report's documentation.

### 2026-10-05 · host · M1: the oracle's `dispatch` is 45 times slower than its `fns`

Pin e923a34. `compileModuleJs(m).dispatch` runs every entry on the interpreter, so the path
tracer took 6.7 ms a path through it and 0.15 ms through `fns.trace` called once per invocation,
with the same result. `scripts/oracle.ts` calls `fns`. Filed as typeshade/typeshade#467. A
smaller thing on the same path: `CpuValue` types no array of vectors (`number[][]`) and no
readonly tuple, though the oracle takes both, so the runner casts its storage bindings.

### 2026-10-05 · tooling · M1: a warning on every compute module

Pin e923a34. `tshc check` warns `TS8015` (no GLSL: storage, compute) on line 1 of every compute
module, and this renderer is WebGPU-only by design, so the warning is permanent noise. Filed as
typeshade/typeshade#468.

### 2026-10-05 · host · M1: importing a shader module outside Vite

Pin e923a34. The compiler ships a Vite plugin and no bun loader, so `scripts/shade-plugin.ts`
wraps the Vite plugin's `transform` in a bun plugin. It worked unchanged. Two things took a
while to find. A sibling package's shader, imported by a package `exports` subpath, does not get
the `moduleSuffixes` host view, so `@typeshade/radiance-kernels` names each view under a `types`
condition. And `bun install` sets the executable bit on the pinned compiler's `src/cli/bin.ts`,
which shows as a change to the submodule. `chmod 644` puts it back.

### 2026-10-05 · runtime · M0: a frame with an empty pass, read back as floats

Pin e923a34. The M0 renderer draws a pass that only clears a `rgba16float` target and reads it
with `readFloats()`. Nothing in the runtime's docs says whether a pass with no draw is allowed.
the compiler's own harness does it (its "later" frame), so it is relied on here. If a later
runtime refuses it, M0's harness is the test that says so.
