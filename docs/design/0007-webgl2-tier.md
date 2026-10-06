---
id: '0007'
title: The engine runs on the WebGL2 tier with the same kernels and no WebGL call, and its gates hold both tiers to the oracle
status: draft
milestones: [M8]
touches:
  - packages/radiance/src/renderers
  - packages/radiance/src/kernels
  - packages/radiance/__api__
  - scripts/boundary.mjs
  - scripts/gates
  - scripts/gates.mjs
  - scripts/harness.mjs
  - scripts/oracle.ts
  - .github/workflows/ci.yml
  - site
  - README.md
  - PRODUCT.md
  - docs/plan.md
  - compiler-changes.md
compiler: []
---

**Document control**

| Field         | Value                                                                                                                                                                                                                                                                                                                             |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity      | Design record 0007, status `draft`                                                                                                                                                                                                                                                                                                |
| Date          | 2026-10-06 (UTC), the date of authorship                                                                                                                                                                                                                                                                                          |
| Author        | Written in a Claude Code session for the owner, who owns the compiler too. The owner's review is the approval                                                                                                                                                                                                                     |
| Applicability | The compiler's change 0054, which `vendor/typeshade` does not carry yet. `packages/radiance/src/renderers`, `packages/radiance/src/kernels`, `scripts/gates`, `site/`                                                                                                                                                             |
| Baseline      | `main` at 5df5042. The compiler pinned at 596c805. Change 0054 accepted at a5dcbe7c and amended at 146b162c. The compiler's `main` at 45e939a9 when this record was last revised, and at 1c2d6406 when it was first written. The measurements come from 7521318, and its code equals the code of 5df5042 ("What was measured")    |
| Pull request  | Not opened yet. The pull request that carries this record is its review. This record serves milestone M8, which the plan pull request proposes (`docs/plan.md`, section 4, head 1b6038a, no number yet). That pull request merges first. If this record merges first, `milestones` is `[]` until the plan pull request assigns M8 |

## What changes

On 2026-10-06 the owner decided that the engine should support WebGL2 in the end, and not WebGPU only. The owner opened change 0054 on the compiler's side for it (pull request typeshade/typeshade#506). It makes every `@compute` entry run on WebGL2 and lets the program runtime take a WebGL2 context. Its implementation is only in part on the compiler's `main`. Step 1a has merged (typeshade/typeshade#510, 1c2d6406, the oracle's phased atomic order). Step 1b has merged too (typeshade/typeshade#512, 45e939a9, the phase splitter and a CPU executor of the WebGL2 passes). The body of #512 says that moving the oracle to the phased order across workgroups (decision 3a) is the next step. So step 1 is not complete (inference). Steps 2 to 4 have not merged. The engine's pin is before all of it. So the engine cannot run on WebGL2 today. This record decides how it runs there once the pin moves.

### Before

- `PathTracer.init()` (`packages/radiance/src/renderers/PathTracer.ts`, lines 164 to 186) calls `createRuntime`, which needs WebGPU at the pin. It then calls `getContext('webgpu')` and `configure` with `rt.device` on the canvas.
- `bun run check:shaders` on 7521318 at the pin, run on 2026-10-06, reports `TS8015` on `trace.shade.ts` ("missing capabilities: storageBuffer, compute"): 0 errors, 1 warning.
- `scripts/boundary.mjs` lists WebGPU calls. It lists no WebGL name and no `getContext`. A grep of `packages/*/src`, `site/examples` and `site/src` finds no WebGL name. Its one `getContext('webgpu')` is in `PathTracer.ts` line 175. Its two `getContext('2d')` are in site files.
- Every gate runs on one tier. `launchBrowser()` in `scripts/gates/_browser.mjs` opens Chromium with a WebGPU adapter.
- The stage (`site/src/islands/ExampleStage.tsx`, line 152) tests `'gpu' in navigator`. Measured on 2026-10-06 in Chromium 141 headless with no WebGPU flag: `navigator.gpu` exists and `requestAdapter()` resolves to `null`. The test passes where the device is missing.
- `docs/plan.md` says "WebGPU only" at §1 line 27 and "no WebGL2" at §2 line 72 and §7 line 341. `PRODUCT.md` (line 81) and record 0006 (line 50) say the same. A separate plan pull request changes them, and it has no number yet. This record does not.

### After

One renderer runs on two tiers. The kernels (`*.shade.ts`) keep their algorithms. The seven storage buffers keep their layouts in bytes. The tile loop stays as it is. The public API gains three members and no export (the table below). The runtime picks the tier (0054, decision 2) and the engine reads it. The engine calls no WebGL function. The engine promises the same image on both tiers within the oracle's tolerance. It does not promise the same speed.

**The three public members.** Each member sits in an export that `packages/radiance/src/index.ts` already has. The bake `packages/radiance/__api__/surface.md` holds the members.

| Export                 | Kind           | Member                   | Type                               | Added by                                        |
| ---------------------- | -------------- | ------------------------ | ---------------------------------- | ----------------------------------------------- |
| `PathTracer`           | class          | `readonly tier`          | `'webgpu'` or `'webgl2'`           | Step 4                                          |
| `Renderer`             | abstract class | `abstract readonly tier` | `'webgpu'` or `'webgl2'`           | Step 4                                          |
| `PathTracerParameters` | interface      | `tier?`                  | `'auto'`, `'webgpu'` or `'webgl2'` | No step yet. It follows item 0007-1 (section 1) |

Record 0003 needs no amendment. Its list "The public surface at 0.1.0" names these three exports and none of their members. Its rule says that a pull request that changes the surface commits the re-bake (`bun run bake:api-surface`). The "exports" criterion of `docs/design/README.md` asks for a record, and this record is that record. A class outside the package that extends `Renderer` stops compiling once `tier` is abstract. The package is at version 0.0.0 (`packages/radiance/package.json`), so no release exists. If 0.1.0 ships before step 4, step 4 ships in a new `0.N.0` (record 0003, "Versions").

**What this record takes from change 0054.** Each row is a claim of the accepted text. Sections 1 to 6 name the rows they use.

| Id  | The claim                                                                                                                                                                         | Where in 0054                                                                          |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| C1  | `compile()` emits GLSL for a module with a `@compute` entry. `TS8015` stays only for what no WebGL2 context can do.                                                               | "What changes", table row 1. Rule 10.3                                                 |
| C2  | The runtime takes a WebGL2 context, or makes one, when there is no WebGPU. Its calls keep their signatures. `Runtime` reports the tier. The shape of `RuntimeOptions` is not set. | Decisions at acceptance, decision 2                                                    |
| C3  | A dispatch is a sequence of passes. A storage buffer is a texture. A write goes to a log, then a scatter pass writes it to the next texture of a ping-pong pair.                  | "The execution model", items 1 and 2                                                   |
| C4  | A phase ends at a barrier, an atomic operation or a full log. An entry with none of them is one pass and one scatter.                                                             | "The execution model", items 3 and 6                                                   |
| C5  | A 4-byte lane is an `R32UI` texel. With `EXT_color_buffer_float` an `f32` buffer may use `R32F` or `RGBA32F`. Both "store the same bits".                                         | "The execution model", the paragraph after item 6. Decision 5                          |
| C6  | The write log holds 4 entries of 4 lanes for each invocation in each pass.                                                                                                        | Decision 4                                                                             |
| C7  | A buffer past `MAX_TEXTURE_SIZE` squared texels is reported with a reason and runs on the CPU tier.                                                                               | "What stays outside"                                                                   |
| C8  | A program whose result WGSL defines gives one result on WebGPU, WebGL2 and the oracle. An operation the report lists as `target` may differ.                                      | The section headed What "the same results" means. Decision 3 (a). The amendment of §23 |
| C9  | The required evidence has two parts for this repository. `tshc check` reports no `TS8015` for `trace.shade.ts`. Its Cornell box on WebGL2 and SwiftShader is held to the oracle.  | "What it touches", required functional evidence                                        |
| C10 | `trace.shade.ts` needs no change. The plan's "no WebGL2 fallback" is the engine's own decision.                                                                                   | "What it owes downstream", radiance                                                    |

**Four rules the tier is written under.**

1. **No WebGL call in the engine.** `scripts/boundary.mjs` reads WebGL names too (step 1).
2. **No tier branch in a kernel.** A `*.shade.ts` file runs unchanged on both tiers.
3. **No cut in a megakernel entry.** A kernel entry the tiers run is one phase (C4). It has no barrier and no atomic operation. On each path it writes storage at most 4 times, the log of C6. No write sits in a loop. It has no workgroup variable, since a write to one is a log entry too. A stage that needs a cut gets its own record.
4. **No integer word in an `f32` lane.** A buffer that holds an integer word is declared `array<vec4u>` (section 2, step 3).

Rule 3 follows the compiler's splitter. Fact: `splitPhases` (`src/core/passes/phase-split.ts`, typeshade/typeshade#512, 45e939a9) cuts an entry in three places. It cuts at a barrier. It cuts before an atomic operation. It cuts before a write that would make more than 4 log entries since the pass began. It counts on every path, so a write in a loop counts at each iteration and gets a cut. One assignment to storage or to a workgroup variable is one entry. Fact, 0054, "The execution model", item 3: a loop that contains a cut runs as a pass for each iteration. The `trace` entry holds a loop of samples and a loop of bounces, so a write inside them would cost a pass for each iteration.

### 1. How `PathTracer` takes a WebGL2 context

0054 names no option (C2). The steps below use the runtime as it is today and name each guess.

1. `init()` calls `createRuntime` with the host's `device` when `PathTracerParameters.device` is set. Otherwise it passes no device, no context and no canvas. The runtime picks its tier.
2. `init()` reads the tier the runtime reports. `PathTracer` exposes it as `readonly tier: 'webgpu' | 'webgl2'`. `Renderer.ts` declares it abstract, since every renderer runs on one tier.
3. `init()` loads `trace` and builds `tracer` and `show` as today. The runtime keeps these signatures (C2).
4. `init()` sets up the canvas by the tier, as the table says.

| Tier   | Until item 0007-1 lands                                                                                                                                                         | After item 0007-1                                                                     |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| webgpu | Unchanged: `getContext('webgpu')`, `configure` and `rt.device`. This is the one place the engine touches a WebGPU object, and the boundary check does not see it.               | `createRuntime({ canvas })` makes the context. The engine calls `getContext` nowhere. |
| webgl2 | `render()` draws `show` into a target texture, reads it with `readFloats()`, and puts the 8-bit picture on the canvas through `getContext('2d')`. The 2D context is no GPU API. | The same as webgpu: the runtime presents.                                             |

Three facts bound the webgl2 row.

- A canvas holds one context type, so the engine takes `getContext('2d')` only after it reads the tier.
- The target of `readPixels()` is `rgba16float` (`TARGET_FORMAT`). WebGL2 renders to it only with `EXT_color_buffer_float` or `EXT_color_buffer_half_float`. SwiftShader has the first, so no gate runs on a context with neither extension.
- `readFloats()` returns 16 bytes a pixel, which is 5.2 MB at the stage's 718 x 450. An `rgba16float` texel is 8 bytes on the GPU, so the readback from the GPU is 2.6 MB. Step 4 records the time of the present.

Proposal, a guess to check at acceptance: the webgl2 row draws `show` into an `rgba8unorm` target (`CANVAS_FORMAT`) and reads that target. It needs neither extension, and the picture on the canvas has 8 bits a channel in both cases. The GPU then holds 4 bytes a pixel, which is 1.3 MB at 718 x 450.

The parameters change by one member. `PathTracerParameters.device` stays WebGPU only. A `tier` option arrives with item 0007-1, since it needs an option of the runtime. Its values are `'auto'` (the default), `'webgpu'` and `'webgl2'`. Before then the gates choose the tier by the browser's launch (section 4).

The frame loop needs one more fact from the runtime. `await f.submit()` must resolve after the GPU has run the frame, on both tiers. `#nsPerPath` and the tile sizes rest on it (`PathTracer.render`). Nothing has measured it on WebGL2 (inference). Step 4 holds it with a test that has a bound and no result yet.

A frame costs a fixed part F and a part k for each sample. The test reads `info.frameTime`. It runs from before the dispatches to the end of `await f.submit()`, and the present follows as a second frame (`PathTracer.render`). So the present is not in F. The copy that C3 puts before each scatter is in F. It grows with the pixel count (inference). A frame of 4 samples then takes (F + 4k) / (F + 2k) times as long as a frame of 2 samples. That ratio lies between 1 and 2. If `submit()` resolves before the GPU runs the frame, the ratio is near 1. The bound 1.5 holds while F is at most 2k. On SwiftShader the shader runs on the CPU, so k is large against F (inference, not measured). The bound 2.5 leaves room for noise, since a ratio over 2 shows noise or a cost that grows faster than the samples.

### 2. What the kernels satisfy under the phased model

Measured by `grep` on 7521318 on 2026-10-06, and read against C3 to C6.

| What `trace.shade.ts` has                                                                                                                                                                           | Under 0054                                                                                                                                                                                       | To measure once the pin moves                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| 0 uses of `atomic*`, `workgroupBarrier`, `storageBarrier` and `var<workgroup>` in every `*.shade.ts`. Rule 4 of record 0005 names the first.                                                        | No phase ends inside the entry (C4).                                                                                                                                                             | The emitted WGSL of each entry has 0 of each, at most 4 storage writes and none in a loop (step 2). |
| One storage write: `accum[pixel] += vec4(sum, f32(params.frame.w))`. Its index is `pixel`, not `gid.x`. It writes 4 lanes.                                                                          | One pass and one scatter (C4). The write fits the log of C6 (inference: a 4-lane write takes one entry). It is not the portable-kernel path, which needs `gid.x`.                                | The draw calls of one tile dispatch. Step 4 records the count.                                      |
| Loops: the sample loop, the bounce loop, the leaf loops, and the `while` loops of `pickLight`, `nearest`, `occluded` and the sampler. None holds a barrier, an atomic operation or a storage write. | Each loop stays inside the one pass (C4).                                                                                                                                                        | The size of `compile().glsl`, and the time ANGLE takes to link it.                                  |
| Four stacks of `array<u32, 32>`: `nearest` and `occluded` have two each, written as a literal of 32 entries.                                                                                        | A stack is saved to a state texture only at a cut. `trace` has none (C3, C4).                                                                                                                    | The size of the GLSL with the literal and with `array<u32, 32>()` (0047, at pin).                   |
| Seven storage bindings (six read-only, `accum` read-write). The `trace` entry binds one uniform block, `params`, of 9 `vec4`. The file declares a second, `present`, which `show` reads.            | A texture each, and a ping-pong pair for `accum` (C3). Inference: 7 texture units on the read side, against the 16 that OpenGL ES 3.0 guarantees (read again at acceptance). SwiftShader has 32. | The pipeline links with 0 errors.                                                                   |
| Integer words in `f32` lanes: 10 `bitcast<u32>` reads in `layout.shade.ts` and `materials.shade.ts`.                                                                                                | See the next paragraph.                                                                                                                                                                          | A hardware check by hand (step 3).                                                                  |

**Integer words.** Record 0001 rule 2 stores an integer word as the bits of an `f32` in a `storage<array<vec4>>`. A node holds two such words, an instance six and a light three. A material holds its type and texture words. `triangles` is `array<vec4u>` already.

- Fact: a small integer is a subnormal `f32` pattern. GLSL ES 3.00 §2.1.1 lets a driver flush it.
- Fact: change 0045 says to keep integer words in an integer binding.
- Fact: the pin says that the `R32F` route can lose integer words. The comment on the storage-to-data-texture pass (`src/core/backends/glsl.ts`, line 1367) says "a bitcast lane may legally lose them". The comments on `storageBuffer` (`src/core/sot.ts`, line 1070) and on `storageFetchU32` (`src/core/intrinsics.ts`, line 983) say "can legally lose values". Change 0045 (line 126) quotes the second.
- Fact: SwiftShader has `EXT_color_buffer_float`, so C5 picks `R32F` or `RGBA32F` for an `f32` buffer there.
- Fact: SwiftShader keeps every subnormal (0045). No gate of this repository can see a loss.
- Inference: the read of such a texel gives an `f32`, which the shader then bitcasts. C5's "same bits" holds for the stored texel and not for the read.
- Inference: an `array<vec4u>` binding maps to `R32UI` (typeshade/typeshade#484, `src/core/backends/glsl.ts`, line 1368). Change 0046 covers a struct array with an integer field, which is another case.
- Proposal, rule 4: `nodes`, `instances`, `materials` and `lights` become `storage<array<vec4u>>`. Their float lanes are read with `bitcast<f32>`. `vertices` keeps `array<vec4>`, since it holds no integer word. The bytes do not change.

**Limits.** Fact: SwiftShader reports `MAX_TEXTURE_SIZE` 8192, `MAX_DRAW_BUFFERS` 6 and `MAX_COLOR_ATTACHMENTS` 6. 0054 uses the guaranteed 4. The table counts elements at one lane in each `R32UI` texel, so a buffer holds `MAX_TEXTURE_SIZE` squared times 4 bytes. 0054 does not fix the texel layout. A `vec4` in each texel makes every count 4 times larger.

| Buffer (element)      | WebGPU default, 128 MiB | WebGL2 at 2048 (16 MiB) | SwiftShader at 8192 (256 MiB) |
| --------------------- | ----------------------- | ----------------------- | ----------------------------- |
| `nodes` (32 B)        | 4,194,304               | 524,288                 | 8,388,608                     |
| `triangles` (16 B)    | 8,388,608               | 1,048,576               | 16,777,216                    |
| `vertices` (32 B)     | 4,194,304               | 524,288                 | 8,388,608                     |
| `instances` (128 B)   | 1,048,576               | 131,072                 | 2,097,152                     |
| `materials` (128 B)   | 1,048,576               | 131,072                 | 2,097,152                     |
| `lights` (16 B)       | 8,388,608               | 1,048,576               | 16,777,216                    |
| `accum` pixels (16 B) | 8,388,608               | 1,048,576               | 16,777,216                    |

A 1920 x 1080 frame is 2,073,600 pixels. Its `accum` does not fit at 2048 and fits at 4096. So `limits.ts` takes the tier's limit and names it in its `RangeError`. Until item 0007-2 reports the limit, the WebGL2 tier uses 16,777,216 bytes.

`PathTracer` throws that `RangeError` from `init()` and from `setSize()` (`#allocate`), as it does for WebGPU today. It does not shrink the frame. A host that draws 1920 x 1080 on WebGL2 lowers the size or `setPixelRatio`. `preview` does not help, since `accum` keeps its full size. The stage shows the message of a `RangeError` (section 5).

A tile is at most 1,048,576 pixels on WebGL2. That is the number of pixels `accum` holds at 2048, so at that limit no frame is larger and the cap never binds. Step 4 fixes `limitsFor('webgl2')` at 16,777,216 bytes until item 0007-2 lands, whatever `MAX_TEXTURE_SIZE` the context reports. So the cap cannot bind before item 0007-2. It binds when the limit is larger. Inference: the write log of such a tile is at most 4 attachments x 16 B x 1,048,576 = 64 MiB, for the lanes alone.

### 3. Determinism across tiers

Measured on 2026-10-06 with `compile()` at the pin: the report of `trace.shade.ts` has 9 rows. `/` (21 uses) and `exp2` (1) are `ulp`. `dot`, `normalize`, `cross`, `sqrt`, `reflect`, `length` and `pow` are `inherited`. No row is `target`.

Inference: C8 covers every operation of the kernel outside the 9 rows. The 9 rows are operations that WGSL leaves to the driver on every tier. A new tier adds no new kind of difference. Record 0005's promise stays, with the tier named.

| Scope                                 | What the engine promises                                                                                                                    | What the gate measures                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| One tier, one device, one driver      | One seed gives one image, bit for bit, when the renders have the same split (record 0005, "The promise" and "The split")                    | `determinism`, on each tier: 0 of 1,024 floats differ                               |
| Two tiers, two devices or two drivers | The image is within the oracle's tolerance. It is not bit for bit                                                                           | `differential`, on each tier: `ORACLE` (section 4)                                  |
| The sampler (`sampler.shade.ts`)      | The two words of `sample2` before `toUnit` are one answer on every tier (C8, record 0005, rule 1). Its floats are measured and not promised | The sampler probe: 0 of 131,072 floats differ between the oracle, WebGPU and WebGL2 |
| The CPU oracle                        | The reference image of a scene and a seed                                                                                                   | Unchanged                                                                           |

The sampler probe draws `sample2` for pixels 0 to 255, indexes 0 to 15 and dimension pairs 0 to 15 (65,536 triples, 2 floats each).

- Fact: `sample2` forms two `u32` words with integer operations only. WGSL defines each of them, so C8 gives one answer on every tier.
- Fact: `toUnit` turns each word into a float with `f32(x >> 8) / 16777216`. The compiler's report of `sampler.shade.ts` lists that `/` as one `ulp` row, "2.5 ULP" (run on 2026-10-06 at the pin: 1 row). So C8 does not promise the float.
- Inference: the dividend is an integer below 2^24, which `f32` holds exactly. The divisor is a power of two. The exact quotient then fits in an `f32`, and a correctly rounded division returns it. WGSL allows 2.5 ULP, and the inference is that no driver uses that room here.

The sampler probe measures this inference. It does not test C8. A difference means a driver's division is not exact for these inputs. It does not break C8, and it is no tolerance to widen. The owner then decides how `toUnit` changes.

### 4. The gates

**The launch.** Measured on 2026-10-06 with Playwright 1.63.0 and Chromium 141.0.7390.37 on SwiftShader, on a page at `http://127.0.0.1`, which is a secure context:

| Launch           | Flags                                                                                                                          | `navigator.gpu` | `requestAdapter()` | WebGL2 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------- | ------------------ | ------ |
| `webgpu` (today) | `--enable-unsafe-webgpu --enable-unsafe-swiftshader --use-angle=swiftshader --use-vulkan=swiftshader --enable-features=Vulkan` | present         | an adapter         | yes    |
| `webgl2`         | `--enable-unsafe-swiftshader --use-angle=swiftshader`                                                                          | present         | `null`             | yes    |
| no flag          | none                                                                                                                           | present         | `null`             | yes    |

`--disable-features=WebGPU` also gives a `null` adapter. The renderer string is the same in every launch: "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)". `EXT_color_buffer_float` is present, so the arm tests the `R32F` path. In `_browser.mjs`, `launchBrowser({ tier })` drops three flags for `webgl2`: `--enable-unsafe-webgpu`, `--use-vulkan=swiftshader` and `--enable-features=Vulkan`. `openRenderPage({ tier })` opens one session for each tier, and `window.run` returns the tier the renderer reports.

**The arms.** The oracle renders each scene once. Each tier's render is held to that image.

| Gate                  | The WebGL2 arm                                                                                            | The numbers that make it pass                                                                               |
| --------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `differential`        | `cornell`, 16 x 16, 1,024 spp, seed 1                                                                     | `ORACLE`: `abs` 1e-3, `rel` 5 %, `mean` 3.3e-6, 0 channels out of bounds                                    |
| `determinism`         | Two renders of seed 1 and one of seed 2. Each render has a new renderer, so the three have the same split | 0 of 1,024 floats differ. Seed 2 differs. Each pixel has 1,024 samples                                      |
| `render`              | `first-scene` and `cornell-box` (two of six), 96 x 64, 64 spp, held to the goldens of WebGPU              | `RENDER` (record 0002): at most 6 of 6,144 pixels beyond 4/255, and a mean of at most 1/255 over R, G and B |
| `sampler` (new)       | The sampler probe of section 3                                                                            | 0 of 131,072 floats differ                                                                                  |
| The harness site step | The Cornell box page on the `webgl2` launch                                                               | The stage reaches 2 samples and shows no notice                                                             |

Two numbers are recorded and not held: the mean relative difference between the two tiers' images, and each arm's paths a second. Suppose the measured WebGL2 `mean` is over 3.3e-6. Then the pull request sets the tier's bound at ten times the measurement, by the rule of record 0002.

**The probes.** An arm that ran on the wrong tier passes for nothing. So each arm fails when the tier the page reports differs from the tier asked. The tier probe runs an arm on a `webgpu` session and expects that failure.

Two probes of record 0002 take a browser session (`probe({ scene, session })`), so they run on the session of each tier. The `differential` probe shifts the oracle's image by one pixel and expects `mean` to fail. The `determinism` probe judges a render of seed 2 as one of seed 1 and expects the bit identity to fail. The `render` probe moves one channel of one golden pixel by 8/255. It expects the per-channel rule alone to fail (`channelBoundOnly` in `scripts/gates/render.mjs`). It expects the same fault on 13 pixels to fail the whole tolerance (record 0002, "The probes"). It reads goldens and no browser, so it runs once, and its decoder proof runs once with it. This record does not change the other probes of record 0002 (`site`, `api`, `bundle`, `journeys`). The new `sampler` gate has a probe of its own (step 5): one float of the WebGL2 result moved by one ulp makes it fail.

**CI.** The arm is a step of the job `harness (headless WebGPU)`. The name stays, since a rename changes the ruleset (record 0002, decision 1). Measured: the `bun run harness` step took 491 s in run 37405684271 (7521318, 2026-10-06), and the job's `timeout-minutes` is 20. The arm may add at most 400 s, which keeps the step under 15 minutes. If it adds more, step 5 raises the timeout to twice the measured time or runs fewer examples.

### 5. The site

| File                                                   | Change                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `site/src/islands/ExampleStage.tsx`                    | Remove the `'gpu' in navigator` guard (line 152). Rename the field `noWebgpu` to `noGpu` (lines 36 and 153). Catch the error of `init()`. Show `copy.noGpu` for the runtime's error that no tier exists. Show the error's own message for every other error, a `RangeError` included (section 2). Show the tier in the toolbar as a tag, with `data-tier`, on WebGL2 only. |
| `site/src/i18n/en.ts`                                  | Line 83: `noWebgpu` becomes `noGpu`, "This browser has neither WebGPU nor WebGL2." Lines 11 and 20 say WebGPU, and WebGL2 where WebGPU is missing.                                                                                                                                                                                                                         |
| `site/astro.config.mjs`                                | Line 36: the Starlight description. It carries the sentence of `en.ts` line 11, "a progressive path tracer on WebGPU", and changes the same way.                                                                                                                                                                                                                           |
| `site/src/content/docs/guide/getting-started.mdx`      | Lines 3, 11 and 17: a browser with WebGPU (Chrome and Edge from 113) or with WebGL2. Line 78: the runtime picks the tier.                                                                                                                                                                                                                                                  |
| `site/src/content/docs/guide/path-tracer.mdx`          | Line 3, and a section "Tiers": what each tier is, `tier`, and the speed difference once measured.                                                                                                                                                                                                                                                                          |
| `site/src/content/docs/guide/checked-on-the-cpu.mdx`   | Line 20: the gate runs on each tier. Line 47: no package calls a WebGPU or WebGL object.                                                                                                                                                                                                                                                                                   |
| `site/src/pages/examples/[id].astro` and `Stage.astro` | `[id].astro` line 29: "in the browser". `Stage.astro` line 5: "a browser with no GPU API". `ExampleStage.tsx` line 4 changes the same way.                                                                                                                                                                                                                                 |
| `site/src/lib/facts.ts`                                | Print the WebGL2 arm's measured `mean`, only after the gate has measured it.                                                                                                                                                                                                                                                                                               |
| `README.md`                                            | Lines 6, 49, 57, 71, 100 and 101.                                                                                                                                                                                                                                                                                                                                          |

`PRODUCT.md`, `docs/plan.md` and record 0006 change in the plan pull request, which merges before this record. That pull request says that WebGL2 is a target and that the engine runs on WebGPU only today. The shipped tier makes some of its lines false, and step 6 changes them. The next table lists them. The numbers are the lines at the head 1b6038a of the plan pull request. They move when that pull request changes, so the quoted text is the identifier.

| File           | Lines    | The text                                                                                       | Step 6 makes it say                                                                  |
| -------------- | -------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `PRODUCT.md`   | 53 to 54 | "No package calls a WebGPU object"                                                             | A WebGPU or WebGL object. The check of step 1 reads both                             |
| `PRODUCT.md`   | 81 to 85 | "WebGPU only today, and WebGL2 by direction" and "Today a browser without WebGPU sees a still" | WebGPU and WebGL2, the browsers that have each, and what a browser with neither sees |
| `PRODUCT.md`   | 86 to 88 | "Not yet: ... the WebGL2 tier (M8)."                                                           | The same list without the WebGL2 tier                                                |
| `docs/plan.md` | 14 to 15 | "the engine runs on WebGPU today and will run on WebGL2 too"                                   | The engine runs on WebGPU and on WebGL2                                              |
| `docs/plan.md` | 28       | "`typeshade/runtime` ... runs on WebGPU only"                                                  | The runtime runs on WebGPU and on WebGL2                                             |
| `docs/plan.md` | 58 to 59 | "render it on WebGPU, will render it on WebGL2"                                                | The same kernels render it on WebGPU and on WebGL2                                   |
| `docs/plan.md` | 78 to 82 | "The engine runs on WebGPU only today" (the paragraph "WebGL2 is a target")                    | The engine runs on both tiers. The reference to decision 7 stays                     |
| `docs/plan.md` | 409      | "(until M8 adds WebGL2)" in the device loss row                                                | A notice for a browser with neither WebGPU nor WebGL2                                |

Decision 7 of section 12 (lines 528 to 541) quotes the old text on purpose, as history. Step 6 does not change it. The stills stay captured on the `webgpu` launch (`scripts/capture-stills.mjs`), hashed and not recaptured. A visitor on WebGL2 sees the same still until the first frame.

### 6. What the engine owes the compiler

Each row is an item in the form of record 0006. When its proposal opens, the row moves to record 0006's table as item 11, 12 or 13, in a pull request of its own. The front matter field `compiler` lists items of record 0006, so it stays empty until then and gains `0006-11` to `0006-13`. The dependency of this record is the compiler's change 0054, which the document control table names.

| Item   | Proposal                                                                                                                                                                                  | Evidence                                                                                                                                                                                                 | Needed by | Until it lands                                                            |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------- |
| 0007-1 | **A canvas and a tier as runtime options.** `createRuntime({ canvas })` makes the canvas's context for its tier. A pass takes the canvas as its `target`. A `tier` option picks the tier. | 0054, decision 2, leaves `RuntimeOptions` open. At the pin, a pass target is a canvas context the host configured (`src/runtime/runtime.ts`, lines 72 and 404 to 410). `PathTracer.ts` lines 175 to 179. | Step 4    | Section 1: WebGPU unchanged. WebGL2 presents through a 2D canvas.         |
| 0007-2 | **The tier's limits, by name.** `rt.limits` reports on WebGL2 the bytes one storage binding covers, the bindings one pipeline binds, and the invocations one dispatch runs.               | 0051 (draft) keys `rt.limits` by WebGPU's names. 0054, "What stays outside", names the texture limit with no number.                                                                                     | Step 4    | `limits.ts` holds 16,777,216 bytes a binding and 1,048,576 pixels a tile. |
| 0007-3 | **An integer word survives a float target.** A binding the program bitcasts between `f32` and `u32` is stored as `R32UI` whatever `EXT_color_buffer_float` says. Open it as an issue.     | 0045, table, row 4. The pin's comments at `src/core/backends/glsl.ts` line 1367 and `src/core/sot.ts` line 1070. 0054, decision 5 and C5.                                                                | Step 3    | Rule 4: the engine declares integer words as `vec4u`.                     |

## Why

- **The direction.** The owner's direction of 2026-10-06 and change 0054, accepted at a5dcbe7c, make WebGL2 a tier of the program runtime. The path tracer is the case that proposal names (typeshade/typeshade#468).
- **The record waits for the pin.** 0054 leaves three things to its implementing pull request. They are the shape of `RuntimeOptions`, the texel layout and the name of the tier report. This draft guesses each one and labels it. The owner accepts it when the pin carries 0054's steps 1 to 4. Acceptance then checks each guess against code.
- **Section 2's rule 4 costs little.** The bytes do not change. The WebGPU tier reads the same words. A bitcast reinterprets bits and is expected to cost nothing (inference). A loss on a hardware driver is the one defect the gates cannot see.

**What was measured.** Date: 2026-10-06. Configuration: 7521318 (the code of 5df5042 is the same, see "Open items"), pin 596c805, compiler `main` 45e939a9, bun 1.3.14, Chromium 141.0.7390.37. Results: the `TS8015` warning, the 9 report rows of `trace.shade.ts` and the 1 report row of `sampler.shade.ts`. Also the three browser launches, the SwiftShader limits, the 491 s harness step and the state of 0054's pull requests. Sections 2 to 4 hold each number.

Alternatives considered:

- **A second renderer in fragment shaders for WebGL2.** Two codebases, and no oracle holds the second. Plan §2's reason, "no compute", no longer holds after 0054.
- **The engine makes the WebGL2 context and passes it.** It puts a WebGL call in the engine. The boundary check could not hold that rule.
- **The CPU oracle as the fallback.** The oracle takes about a minute for the 16 x 16 gate scene (`scripts/gates/differential.mjs`). It cannot draw a frame.
- **WebGPU only.** It contradicts the owner's direction.

## What it touches

- `packages/radiance/src/renderers/PathTracer.ts`, `Renderer.ts`, `limits.ts`, `tiles.ts`, `scene-pack.ts`, and `packages/radiance/__api__/surface.md` (the `tier` members of `PathTracer` and `Renderer`).
- `packages/radiance/src/kernels`: `layout.shade.ts`, `materials.shade.ts`, the header of `trace.shade.ts`, and `kernels.test.ts`, `layout.test.ts`.
- `scripts/boundary.mjs`, `scripts/boundary.test.ts`, `scripts/oracle.ts`, `scripts/gates.mjs`, `scripts/harness.mjs`, and `scripts/gates/` (`_browser.mjs`, `differential.mjs`, `determinism.mjs`, `render.mjs`, `sampler.mjs`, `sampler.shade.ts`).
- `.github/workflows/ci.yml` (the harness step's timeout, if needed), `README.md`, `PRODUCT.md` and `docs/plan.md` (step 6), the site files of section 5, `compiler-changes.md`.
- Record 0001 changes in its own pull request. It changes rule 2 and the declarations of the table (step 3). It changes rule 3 with "Sizes under the limits" and "Limits" (the limit of a WebGL2 binding). It changes "Tiles and the watchdog" (`MAX_TILE_PIXELS` on WebGL2). Record 0002 changes in its own pull request, before step 5. Its gate table gains the `sampler` row and the WebGL2 arm of the `differential`, `determinism` and `render` rows. Its probe list gains the tier probe and the `sampler` probe. Record 0006 gains items 11 to 13 when their proposals open. Record 0003 needs no amendment ("After").

## Implementation, in steps

Step 0 is not engine work. The compiler ships 0054 steps 1 to 4. Steps 1a and 1b have merged. Step 1 has one piece left (inference from the body of #512). Steps 2 to 4 have not merged. The pin then moves in its own pull request. That pull request runs `downstream-impact.ts` and adds `0054` to `compiler-changes.md`. `bun run check:shaders` then reports 0 warnings. Acceptance follows (decision 8).

1. **The boundary check reads WebGL.** `scripts/boundary.mjs` gains a `WEBGL_CALL` pattern next to `WEBGPU_CALL`. It matches `getContext` with the argument `'webgl'`, `'webgl2'` or `'experimental-webgl'`. It matches the names `\bWebGL2?[A-Z]\w*`. It matches these program calls after a dot: `createProgram`, `createShader`, `shaderSource`, `compileShader`, `attachShader`, `linkProgram`, `useProgram` and `getExtension`. It matches these texture and framebuffer calls: `createFramebuffer`, `bindFramebuffer`, `framebufferTexture2D`, `bindTexture`, `texImage2D`, `texSubImage2D` and `texStorage2D`. It matches these draw calls: `drawArrays`, `drawElements`, `drawArraysInstanced` and `drawElementsInstanced`. It leaves out `draw` and `readPixels`, since `pass.draw(` and `readPixels()` are legal. It leaves out `createTexture`, since `WEBGPU_CALL` has it. Tests: 3 new probe sources are offences (a `drawArrays` call, a `getContext('webgl2')` call, a `WebGL2RenderingContext` type). A source with `pass.draw(`, `readPixels()` and `getContext('2d')` gives 0 offences. The engine's sources give 0 offences. `getContext('webgpu')` joins the check when item 0007-1 lands.
2. **The kernel rule.** `kernels.test.ts` reads the emitted WGSL of every kernel entry: 0 `atomic`, 0 `workgroupBarrier`, 0 `storageBarrier`, 0 `var<workgroup>`. It finds each write to a `var<storage, read_write>` binding. It expects at most 4, and 0 inside a `for`, `while` or `loop` body. Measured on 7521318: 1 write (`accum`, `trace.shade.ts` line 221), outside every loop. It has three probes. Each is a module, and each gives 1 match. One has an `atomicAdd`. One has a storage write inside a `for`. One has 5 storage writes. The header of `trace.shade.ts` already names record 0005's "Rule 4: no atomics" (line 40). It gains a block for record 0007's rule 3 after that block. The block is two comment lines: `// Tiers (design record 0007, "Four rules the tier is written under"). This file leans on:` and `//   Rule 3: no cut in a megakernel entry. No barrier, no atomic operation, at most 4 storage writes, none in a loop.` The plan of `trace` is not read yet. `plan.cuts.size` of `splitPhases` is 0 for a one-phase entry, as the compiler's `phased.test.ts` expects for such a program. At 45e939a9 no entry point of the compiler names `splitPhases` (read in `src/index.ts`, `src/debug.ts`, `src/compute.ts`, `src/dev.ts`, `src/emit.ts`, `src/runtime.ts` and `src/runtime-internal.ts`). So this measurement waits for a public way to read the plan. The draw-call count of step 4 is the measure until then. When the way exists, the test expects `plan.cuts.size` 0 for `trace`.
3. **Integer words exact.** Record 0001 is amended first. Then four buffers become `array<vec4u>` in `layout.shade.ts` and `materials.shade.ts`. `scene-pack.ts` binds `Uint32Array` views of the same bytes, and `scripts/oracle.ts` binds the same arrays. Tests: `layout.test.ts` holds the declared type of the four buffers. The `scene-pack` tests pass unchanged. The WebGPU `readRadiance()` array has the same SHA-256 before and after. The header of `trace.shade.ts` gains the line `//   Rule 4: no integer word in an f32 lane. A buffer of integer words is array<vec4u>.` under the block of step 2. The owner runs a hand check on a hardware GPU: small integer words in an `array<vec4>` on the WebGL2 tier, read back. The result goes in the record.
4. **`PathTracer` takes the WebGL2 tier.** Section 1, `limitsFor(tier)`, the tile cap, `tier`, and the re-baked API surface (`bun run bake:api-surface`). Tests: `limitsFor('webgl2')` is 16,777,216. `tileFrame` gives no tile over 1,048,576 pixels on WebGL2. The `RangeError` names the tier and both numbers. A 16 x 16 render on the `webgl2` launch ends with `tier === 'webgl2'` and 1,024 samples a pixel. Three numbers are recorded. The first is the draw calls of one tile dispatch. A wrapper of the page's context counts them, since the page is outside `packages/`. The count is the same for frames of 2 and of 4 samples, since a loop with no cut stays inside one pass (C4). A count that grows with the samples shows a cut in a loop (rule 3). The second is the present's time at 718 x 450. The third is the time of the copy that C3 puts before each scatter. Frame test: on each launch, read `info.frameTime` of 5 frames of 4 samples and of 5 frames of 2 samples at 64 x 64. The median of the first is 1.5 to 2.5 times the median of the second. Record both medians. `info.frameTime` stops before the present. If a launch gives under 1.5, double both sample counts and keep the bound. A larger frame would raise F as it raises k (section 1). `getContext('webgpu')` joins the boundary check when item 0007-1 lands.
5. **The gates' WebGL2 arm.** Record 0002 is amended first, in its own pull request. Section 4 gives the parts. They are `launchBrowser({ tier })`, the two sessions and the four arms. They are also the tier probe, the sampler probe, a probe that makes the `sampler` gate fail and the harness step's time. Numbers: the table of section 4. The harness step stays under 891 s, which is 491 s and the 400 s of section 4.
6. **The site and the documents.** The two tables of section 5. Tests: `bun run gate:site` exits 0. The harness site step on the `webgl2` launch reaches 2 samples. The grep below finds 0 matches in `README.md`, `PRODUCT.md` and `site/`. In `docs/plan.md` it finds matches only in decision 7 of section 12, which keeps the old text as history. Records 0006 and 0007 are outside the grep. The tables are the list, and the grep finds a line they miss. The grep: `grep -rnE 'noWebgpu|WebGPU only today|WebGPU only, by decision|runs on WebGPU only|no WebGL2 fallback|WebGL2 by direction|until M8|will run on WebGL2' README.md PRODUCT.md docs/plan.md site/src site/examples site/astro.config.mjs`.
7. **Close the record.** Set `status: implemented`. Record the commits, the pin, each arm's numbers, the hardware check and the harness time. Tag the test of each decision with `Verifies: Design 0007.k`.

## Decisions for the owner

1. The WebGL2 tier is one renderer with the same kernels, buffers and API, and the engine promises the image on both tiers, not the speed. Proposed: yes.
2. `PathTracer` and `Renderer` gain `tier` at step 4. `PathTracerParameters` gains a `tier` option after item 0007-1. The runtime tries WebGPU first. Proposed: yes.
3. Four buffers (`nodes`, `instances`, `materials`, `lights`) become `array<vec4u>` before the tier ships, by an amendment of record 0001. Proposed: yes.
4. Until item 0007-1 lands, the WebGL2 tier presents through a 2D canvas readback and the engine calls no WebGL function. Proposed: yes.
5. The WebGL2 arm holds the same `ORACLE` bounds, and widens them only by measurement under record 0002's rule. Proposed: yes.
6. The arm runs inside the job `harness (headless WebGPU)`. Its name stays. The render gate runs two of six examples on WebGL2. Record 0002 is amended in its own pull request before step 5, as record 0001 is before step 3. Proposed: yes.
7. The stills stay captured on WebGPU, and the stage names the tier it runs on. Proposed: yes.
8. The owner accepts this record only after the pin carries 0054's steps 1 to 4. Proposed: yes.

## Record

**Approval and plan record.** This record is a draft and does not yet apply. The owner's direction of 2026-10-06 prompted it. It is not an approval. The record is accepted when the owner's review or go-ahead merges it with `status: accepted`, after the pin carries 0054's steps 1 to 4.

**Configuration and validation record.** This record does not yet apply. Implementation will record each arm's first numbers, the pin and the CI run that first ran them.

**Open items at authorship.**

- The compiler's `main` at 45e939a9 holds 0054 steps 1a (typeshade/typeshade#510, 1c2d6406) and 1b (typeshade/typeshade#512, 45e939a9). Step 1b opened at 03:00 UTC and merged at 03:09 UTC on 2026-10-06. The body of #512 says that moving the oracle to the phased order across workgroups (decision 3a) is the next step. This record reads that as one piece of step 1 that has not merged (inference). The first draft of this record read 1c2d6406 and named step 1a only. No pull request for steps 2 to 4 is open. The one open pull request, typeshade/typeshade#419, is not 0054's. Read with `gh api` at 03:11 UTC. Disposition: open until the pin carries steps 1 to 4 (decision 8).
- Pull request typeshade/typeshade#509 amended 0054 (surface §23). It merged at 146b162c on 2026-10-06 (02:23 UTC), so this record reads the amended text.
- 0054 says `trace.shade.ts` needs no change (C10). Rule 4 and step 3 change its declarations. Disposition: open, for the owner (decision 3).
- Not measured: a hardware GPU, the WebGL2 executor's speed, the texel layout and the shape of `RuntimeOptions`. These wait for the compiler's code.
- Not read again: the OpenGL ES 3.0 minimums that section 2 names. Acceptance reads them again.
- The baseline moved from 7521318 to 5df5042 while this record was in review. The three pull requests between them (typeshade/radiance#28, #30 and #31) changed documents and `reqs/` only (`git diff --stat 7521318 5df5042` lists no other path). So each measurement of this record holds at 5df5042. The citations of records 0002 and 0005 were read again at 5df5042 and fixed (section 3, section 4). Disposition: closed.
- The front matter said `milestones: [M2]`. M2 is the milestone of triangle meshes, the BVH and glTF, and this record serves none of that work. The field is `[M8]`, the milestone that the plan pull request proposes. Disposition: open until the plan pull request merges, and closed then. If this record merges first, the field is `[]` (document control).
- The `tier` option of `PathTracerParameters` has no numbered step, because its name and values wait for `RuntimeOptions` (C2) and item 0007-1. Disposition: open. Next action: when item 0007-1 lands, amend this record to add the step before the pull request.
- Owed under `CLAUDE.md` ("Report what using TypeShade is like"): the issue for item 0007-3 on typeshade/typeshade and the entry in `docs/typeshade-feedback.md`. The drafting task barred both, so neither is done. Disposition: open. Next action: file the issue without asking, and add the entry.
