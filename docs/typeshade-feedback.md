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

### 2026-10-05 · runtime · M0: a frame with an empty pass, read back as floats

Pin e923a34. The M0 renderer draws a pass that only clears a `rgba16float` target and reads it
with `readFloats()`. Nothing in the runtime's docs says whether a pass with no draw is allowed;
the compiler's own harness does it (its "later" frame), so it is relied on here. If a later
runtime refuses it, M0's harness is the test that says so.
