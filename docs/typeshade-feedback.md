# Using TypeShade: field notes

This renderer is where TypeShade gets used for real, as `stepinside` is, so this file records
what that is like: friction, surprises, gaps in the docs, things that were hard, and things that
went well. It is written as the work happens, not afterwards, and it is the input for a round of
feedback to the language. A problem that is a bug or a missing feature also becomes an issue on
typeshade/typeshade, linked here; a note does not wait for one.

Add an entry at the top of the log. Keep it concrete: what was being built, what happened, what
was expected, what it cost, and what was done instead. Say which TypeShade commit it was (the
pin in `vendor/typeshade`, unless noted).

Areas: **language** (what an author can write), **diagnostics**, **runtime** (`typeshade/runtime`),
**host** (the Vite plugin, host views, CPU calls), **tooling** (`tshc`, the MCP server, the
editor), **docs**.

## Log

### 2026-10-05 · host · The library site: the Vite plugin inside Astro and Starlight

Pin e923a34. The site (Astro 7, Starlight, React islands) imports the engine, whose kernels are
`*.shade.ts` modules, and `typeshade/vite` compiled them inside Astro's Vite with no change:
the examples run the same kernels the harness gates. Two notes. Bun prints `moduleSuffixes is
not supported yet` for every tsconfig that sets the host views' suffix, on every `bun run`; it
is harmless but looks like an error in a build log. And the engine became classes in three.js's
shape on `typeshade/runtime` (`PathTracer` owns the runtime, the program and the textures), and
the public runtime was enough for all of it: nothing reaches past it (`scripts/boundary.mjs`).

### 2026-10-05 · language · M1: what went well

Pin e923a34. The path tracer is about 300 lines of TypeShade: classes for the uniform blocks and
the hit record, a struct returned from a function, loops over runtime-length storage arrays,
`reverseBits` and hexadecimal `u32` constants for the sampler, and a second shader module
imported by relative path. `tshc check` passed it on the second try (the first called a class
as a constructor, `Hit(...)`; an object literal is the spelling). The CPU oracle ran the same
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
should not be the GPU's own. Not a bug; a note for the determinism report's documentation.

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
wraps the Vite plugin's `transform` in a bun plugin; it worked unchanged. Two things took a
while to find. A sibling package's shader, imported by a package `exports` subpath, does not get
the `moduleSuffixes` host view, so `@typeshade/radiance-kernels` names each view under a `types`
condition. And `bun install` sets the executable bit on the pinned compiler's `src/cli/bin.ts`,
which shows as a change to the submodule; `chmod 644` puts it back.

### 2026-10-05 · runtime · M0: a frame with an empty pass, read back as floats

Pin e923a34. The M0 renderer draws a pass that only clears a `rgba16float` target and reads it
with `readFloats()`. Nothing in the runtime's docs says whether a pass with no draw is allowed;
the compiler's own harness does it (its "later" frame), so it is relied on here. If a later
runtime refuses it, M0's harness is the test that says so.
