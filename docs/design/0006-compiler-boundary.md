---
id: '0006'
title: What the engine needs from the runtime and the compiler, as proposals with evidence, each with the engine's way around it until it lands
status: accepted
milestones: [M2, M2a, M3, M5]
touches:
  - docs/plan.md
  - docs/typeshade-feedback.md
  - compiler-changes.md
compiler: []
---

**Document control**

| Field         | Value                                                                                                          |
| ------------- | -------------------------------------------------------------------------------------------------------------- |
| Identity      | Design record 0006, status `draft`                                                                             |
| Date          | 2026-10-05 (UTC), the date of authorship                                                                       |
| Author        | Written in a Claude Code session for the owner, who owns the compiler too. The owner's review is the approval  |
| Applicability | The compiler at e923a34 (`vendor/typeshade`): `src/runtime/`, `src/core/resident.ts`, `src/core/host-entry.ts` |
| Baseline      | `main` at 0f17f5e. The compiler pinned at e923a34                                                              |
| Pull request  | typeshade/radiance#6, the pull request that carries this record and is its review                              |

## What changes

The engine is written on `typeshade/runtime` alone (`CLAUDE.md`). What the runtime cannot do
becomes a proposal in the compiler's `changes/`, not a reach past the boundary. Reading the
runtime at the pin for records 0001 to 0004 found the items below. Each names its evidence in
the compiler's tree, the record that needs it, the milestone it blocks, and what the engine
does until it lands. The proposals are opened in the compiler's repository by its procedure
(`vendor/typeshade/changes/README.md`), one pull request each, in the order of the milestones.

| Item | Proposal                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Evidence at e923a34                                                                                                                                                                                                                    | Needed by                       | Until it lands                                                                                                                                         |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | **Device limits.** `createRuntime({ limits })` requests `requiredLimits`, or the runtime derives them from `programs`: the manifest knows how many storage buffers each entry binds. `rt.limits` reports the device's. A program that needs more than the device has is refused with the limit named.                                                                                                                                                             | `src/runtime/runtime.ts` line 436: `requestDevice({ requiredFeatures })` and nothing else. `src/core/passes/console-buffer.ts`: `DEFAULT_STORAGE_BUFFERS_PER_STAGE = 8`.                                                               | 0001 (M3 headroom), M3v         | Seven storage buffers per pipeline. 128 MiB per buffer, checked by the host against constants in `limits.ts`.                                          |
| 2    | **A partial buffer write.** `Resident.write(value, { offset })`, or `writeRange(byteOffset, bytes)`, that uploads a sub-range of an existing buffer without replacing it.                                                                                                                                                                                                                                                                                         | `src/core/resident.ts`, `bufferFor`: a host write uploads the whole value. A size change destroys and makes a new buffer.                                                                                                              | 0001 (M2a animation at scale)   | A changed geometry re-writes `nodes`, `triangles` and `vertices` whole. Indices inside a BLAS are relative so a BLAS can move later without a rewrite. |
| 3    | **Raw bytes as a storage host value.** A `Uint8Array` or an `ArrayBuffer` bound to any storage binding, taken as the bytes. The runtime checks only that the length is a multiple of the element stride. Or: a typed array for an array of structs.                                                                                                                                                                                                               | `src/core/resident.ts`, `notHostValue`: a `Uint8Array` is "a Uint8Array, which no binding holds". `src/core/host-entry.ts`, `flatWidth` and `runtimeCount`: an array of structs takes an array of objects, packed one field at a time. | 0001 (readability), M2a         | Every hot buffer is `array<vec4>` or `array<vec4u>` from one typed array, with `bitcast` for integer words (record 0001, rule 2).                      |
| 4    | **A texture write.** `rt.texture(options).write(source, { layer, level })` taking an `ImageBitmap`, an `ImageData` or bytes, and `generateMipmaps()`. `TextureOptions.mipLevelCount`. An array texture's layers written one at a time.                                                                                                                                                                                                                            | `src/runtime/resources.ts`: `Texture` has `resize`, `read`, `readFloats`, `destroy` and no write. Only the call layer uploads an image, at a call (Rule 8.21).                                                                         | 0004 (M3 textures, HDRI)        | None: M3's textured materials and the environment map wait on it. This item is on M3's critical path.                                                  |
| 5    | **GPU time.** The runtime exposes `timestamp-query`: a frame's dispatches and passes report their GPU duration when the feature is present.                                                                                                                                                                                                                                                                                                                       | No `timestamp` in `src/runtime/`. Plan §9 lists it.                                                                                                                                                                                    | 0002 (bench), 0001 (watchdog)   | `performance.now()` around `submit()`, which measures the wall clock of the whole frame.                                                               |
| 6    | **The oracle's `dispatch` speed** (typeshade/typeshade#467) and `CpuValue` typing an array of vectors and a readonly tuple.                                                                                                                                                                                                                                                                                                                                       | `docs/typeshade-feedback.md`, 2026-10-05: 45 times slower through `dispatch` than through `fns`.                                                                                                                                       | 0002 (every differential scene) | `scripts/oracle.ts` calls `fns.trace` once per invocation and casts its bindings.                                                                      |
| 7    | **`grad` reachable from a package.** A package may import only `typeshade/runtime`. `grad` is exported from the root (`src/index.ts` line 112, `grad(m, fn, param, opts)`) over a module's IR. The fitter needs the derivative of `evalBsdf` as a program it can run. Two routes: the Vite plugin emits a derivative module at build time (roadmap X5, `grad(f, 'k')` on an imported function), or `typeshade/emit` gains `grad` over the manifest's portable IR. | `src/core/passes/grad.ts`. Roadmap items 18, 20 and X5. `scripts/boundary.mjs` allows `typeshade/runtime` alone.                                                                                                                       | M5 (record 0004's boundary)     | M5 is not started. The fit package's design record names the route this proposal takes.                                                                |
| 8    | **Reading a texture array's layer.** `readFloats({ layer })` and `read({ layer })`.                                                                                                                                                                                                                                                                                                                                                                               | `src/runtime/resources.ts`: `read()` gives the first layer or slice.                                                                                                                                                                   | M3 (AOVs in layers)             | One texture per AOV.                                                                                                                                   |
| 9    | **The console at eight bindings.** A compute entry that binds eight storage buffers cannot record its console. The warning says so (`TS8071`). A placement of the console buffer in a second bind group would free the slot.                                                                                                                                                                                                                                      | `src/core/passes/console-buffer.ts`.                                                                                                                                                                                                   | 0001 (headroom)                 | Seven buffers, so the eighth stays free for the console in `vite dev`. The site builds with `console: 'never'`.                                        |
| 10   | **Binding placement across programs.** A bind group shared by every pipeline (the scene buffers) needs host-placed bindings in a fixed group. 0025 names this "#335 principle 2 and its own proposal".                                                                                                                                                                                                                                                            | `changes/0025-program-runtime.md`, section 2, "Pipelines".                                                                                                                                                                             | M2a (refit kernels), wavefront  | Each program binds the buffers by name. The runtime caches bind groups by identity, so the cost is a lookup per dispatch, not a creation.              |

Items 1 to 4 are the ones with a measured cost today. The engine opens them first, in that
order. Items 5, 6 and 9 are quality of life. Items 7, 8 and 10 wait for their milestone.

**What the engine does not ask for.** A scene, a camera, a material or a light in the runtime
(#335, decision 3). A typed wrapper over WebGPU objects (0025's decision 1).

**What the engine waits on and does not open.** WebGL2 compute and a WebGL2 tier of the program
runtime. The compiler's change 0054 is accepted and is not implemented at the pin. It will
provide both, so this record opens no proposal for them. The engine waits on 0054 for milestone
M8 (plan §4 and §9).

## Why

Each row's evidence is a line in the compiler's tree, read for records 0001 to 0004. Without a
record of them, each would be found again at the milestone that needs it, as the console
buffer's slot and the oracle's `dispatch` were found at M1. With the record, the owner, who
owns the compiler, schedules them. The engine's records name the item they wait on in their
front matter (`compiler: ['0006-4']`), so an implementer sees the dependency before starting.

## What it touches

- `docs/plan.md` §9 ("What goes back to the compiler") points to this record and lists items
  1 to 4 and 8 to 10, which it does not have.
- `docs/typeshade-feedback.md`: one entry per item when it is opened, with the proposal's
  number, as `CLAUDE.md` asks.
- `compiler-changes.md`: the record of each proposal when the pin moves past it.

## Implementation, in steps

1. **Open items 1 to 4** in `typeshade/typeshade` as draft proposals by the compiler's
   procedure, one pull request each, each citing this record and its row's evidence. Record
   each number in `docs/typeshade-feedback.md`.
2. **Open items 5, 6 and 9** as issues, since each is small. Item 6 exists (#467).
3. **Open 7, 8 and 10** at their milestones.
4. When a pin moves past a proposal, do the work it lists and record its id in
   `compiler-changes.md` (`CLAUDE.md`, "The packages and the docs follow the pinned compiler").

## Decisions for the owner

1. The order: 1, 2, 3, 4 first.
2. Item 4 is on M3's critical path: textures cannot ship without it.
3. Item 7 decides M5's shape. Its route is chosen in M5's own record.

## Record

**Amendment 1** (2026-10-06, UTC). Plan §12, decision 7 made WebGL2 a target of the engine. "What
the engine does not ask for" cited plan §2 for "WebGL2 (no compute, no path tracer)", and plan §2
no longer says so. The citation is out of that paragraph. A new paragraph says that change 0054
covers WebGL2 and that the engine waits on it. No table row, decision or step changed.
Disposition: closed.

**Approval and plan record.** Accepted on 2026-10-05 (UTC). The owner approved the merge of typeshade/radiance#6 in the conversation, which merged this record as `draft` at 9e8b479. The owner then said to implement the records with Opus 5.5 and Sonnet 5.5, and that go-ahead is the acceptance. Every entry of "Decisions for the owner" stands as proposed.

**Configuration and validation record.** Step 1 is done on 2026-10-05 (UTC). Items 1 to 4 are
open as draft proposals on typeshade/typeshade: item 1 is 0051 (pull request #489), item 2 is 0048
(#493), item 3 is 0049 (#494), and item 4 is 0050 (#490). Each is written in the compiler's
procedure and reviewed against its tree at 3f6f46b. Item 1 was first numbered 0047. The
compiler's `main` took 0047 for the array zero value (its pull request #496, 2026-10-05), so
the draft moved to 0051 on 2026-10-06 (#489 at 56a46578). Their acceptance, their
implementation and the pin at which the engine takes each up are not recorded yet.
