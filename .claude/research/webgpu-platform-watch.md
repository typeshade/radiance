# WebGPU platform watch (2026-10-09)

This note lists the facts of the WebGPU platform that bear on radiance's design records and plan.
Each entry gives the fact, its source, its status on 2026-10-09 and the item to read again when the
status changes. Every fact was read from its source on 2026-10-09. A fact that could not be read
from a source is not in this list.

The status values:

- **shipped**: on by default in Chrome stable, with no feature request.
- **optional feature**: shipped, but a page must request a `GPUFeatureName` or check a WGSL
  language extension, and an adapter may not have it.
- **experimental**: behind a flag or a command-line switch. A page cannot rely on it.
- **absent**: no specification text and no implementation in Chrome.

The Chrome versions are those of the "What's New in WebGPU" series. Its index is the source of
each version below: https://developer.chrome.com/docs/web-platform/webgpu/news

## The list

| #   | Fact                                                       | Chrome  | Status                                     | Revisit when it changes                                                                              |
| --- | ---------------------------------------------------------- | ------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| 1   | No float atomics in WGSL                                   | to 156  | absent                                     | `docs/plan.md` 3.6 (P2G, "Gather first"). Record 0005 (determinism). Record 0010 Part 5 (`aovAccum`) |
| 2   | Subgroups                                                  | 134     | optional feature (`subgroups`)             | `docs/plan.md` 3.6, 3.7 and 9. Record 0005. Record 0007 (no WebGL2 tier for such an entry)           |
| 3   | WGSL `subgroup_id`                                         | 144     | shipped language extension                 | As fact 2                                                                                            |
| 4   | WGSL `subgroup_uniformity`                                 | 145     | shipped language extension                 | As fact 2                                                                                            |
| 5   | Subgroup size control                                      | 151-152 | optional feature (`subgroup-size-control`) | As fact 2                                                                                            |
| 6   | Immediates (`var<immediate>`, `setImmediates()`)           | 149-150 | shipped language extension                 | Record 0001 (uniform blocks). Record 0006 (what the runtime exposes)                                 |
| 7   | Synchronous buffer mapping in workers (`mapSync()`)        | 145     | experimental                               | `docs/plan.md` 7 (the worker row). `PathTracer.readRadiance()` and `readPixels()`                    |
| 8   | WGSL `buffer_view`                                         | 153-154 | shipped language extension                 | Record 0001 rule 1 (seven storage buffers). Record 0006                                              |
| 9   | WGSL `linear_indexing`                                     | 147-148 | shipped language extension                 | Record 0006. The index arithmetic of the kernels                                                     |
| 10  | `srgb-linear` and `display-p3-linear` canvas colour spaces | 155-156 | shipped                                    | Record 0010 Part 5 (the ACES output transform, an HDR display path). Amendment 1 of record 0010      |
| 11  | `shader-f16` on Linux with NVIDIA drivers                  | 155-156 | optional feature (`shader-f16`)            | `docs/plan.md` 3.6, 3.7 and 9. Record 0007                                                           |
| 12  | `texture-compression-unaligned`                            | 155-156 | optional feature                           | Record 0010 Part 2 ("What waits", KTX2). `docs/plan.md` 7 (compressed textures)                      |
| 13  | Bindless, tier 1: sampling resource tables                 | none    | experimental                               | Record 0010 Part 2 (the arrays). Amendment 1 of record 0010. `docs/plan.md` 3.7. Record 0006         |
| 14  | Bindless, tier 2: heterogeneous resource tables            | none    | absent                                     | Record 0001 rule 1. `docs/plan.md` 3.7. Record 0006                                                  |

## The facts, with their sources

1. **No float atomics.** WGSL's `atomic<T>` takes `u32` or `i32` only. The "What's New in WebGPU"
   index names no float atomic feature up to Chrome 155-156. The plan says this already
   (`docs/plan.md` 3.6). Status: absent.
   - https://gpuweb.github.io/gpuweb/wgsl/#atomic-types (Editor's Draft of 2026-10-08)
   - https://developer.chrome.com/docs/web-platform/webgpu/news
2. **Subgroups.** Chrome 134 shipped the `subgroups` feature. A page requests it on the device and
   writes `enable subgroups;`. Adapters report `subgroupMinSize` and `subgroupMaxSize`. f16 values
   work with subgroups when the device also has `shader-f16`. Status: optional feature.
   - https://developer.chrome.com/blog/new-in-webgpu-134
3. **`subgroup_id`.** Chrome 144 added the WGSL `subgroup_id` extension. Status: shipped language
   extension (it needs `subgroups`).
   - https://developer.chrome.com/docs/web-platform/webgpu/news (Chrome 144)
4. **`subgroup_uniformity`.** Chrome 145 moved the uniformity analysis of subgroup and quad
   built-ins to the subgroup scope. More values become subgroup-uniform. Status: shipped language
   extension.
   - https://developer.chrome.com/blog/new-in-webgpu-145
5. **Subgroup size control.** Chrome 151-152 added the `subgroup-size-control` feature and the
   `@subgroup_size` attribute of a compute entry point. The size is a power of 2 between
   `subgroupMinSize` and `subgroupMaxSize`. Since Chrome 153-154, `enable subgroup_size_control;`
   also enables `subgroups`. Status: optional feature.
   - https://developer.chrome.com/blog/new-in-webgpu-151-152
   - https://developer.chrome.com/blog/new-in-webgpu-153-154
6. **Immediates.** Chrome 149-150 added the `immediate` address space and `setImmediates()` on a
   pass encoder (push constants). The WGSL language extension is `immediate_address_space`. In
   Chrome 151-152 a bad `dataOffset` or `size` throws an `OperationError`. Status: shipped language
   extension.
   - https://developer.chrome.com/blog/new-in-webgpu-149-150
   - https://developer.chrome.com/blog/new-in-webgpu-151-152
7. **Synchronous buffer mapping in workers.** Chrome 145 prototyped `GPUBuffer.mapSync()` in
   workers only, behind `--enable-features=WebGPUMapSyncOnWorkers`. The Chrome team has not
   proposed it for standardization. Status: experimental.
   - https://developer.chrome.com/blog/new-in-webgpu-145
8. **`buffer_view`.** Chrome 153-154 added the WGSL `buffer_view` extension. One uniform, storage
   or workgroup variable can be read as several types through `bufferView<T>()`,
   `bufferArrayView<T>()` and `bufferLength()`. Status: shipped language extension.
   - https://developer.chrome.com/blog/new-in-webgpu-153-154
9. **`linear_indexing`.** Chrome 147-148 added the built-ins `global_invocation_index` and
   `workgroup_index`. Status: shipped language extension.
   - https://developer.chrome.com/blog/new-in-webgpu-147-148
10. **Linear canvas colour spaces.** Chrome 155-156 added the `srgb-linear` and
    `display-p3-linear` predefined colour spaces to the canvas context. The example configures
    `rgba16float` with `colorSpace: 'display-p3-linear'`. The values are linear in luminance and
    have an extended range for wide-gamut displays. Status: shipped.
    - https://developer.chrome.com/blog/new-in-webgpu-155-156
11. **`shader-f16` on Linux with NVIDIA.** Chrome 155-156 supports `shader-f16` on Linux for recent
    NVIDIA drivers. Status: optional feature.
    - https://developer.chrome.com/blog/new-in-webgpu-155-156
12. **`texture-compression-unaligned`.** Chrome 155-156 added the feature. A compressed texture
    (BC, ETC2, ASTC) may have a size that is not a multiple of the block size. Status: optional
    feature.
    - https://developer.chrome.com/blog/new-in-webgpu-155-156
13. **Sampling resource tables (bindless textures).** A `GPUResourceTable` holds sampled texture
    views and samplers. A shader reads an entry with `getResource<T>(index)` under
    `enable resource_table;`. Chrome exposes it as `chromium-experimental-sampling-resource-table`
    behind the "Unsafe WebGPU Support" flag, on Windows, Linux and Android. macOS support is
    announced as "coming soon". Out of experiment, the feature name is `sampling-resource-table`.
    The proposal's status is Draft. The blog post uses a `texture_2d_array` as its fallback, and
    notes that WebGPU guarantees only 256 layers and one size for each array. Status:
    experimental.
    - https://toji.dev/2026/10/06/webgpu-bindless.html
    - https://github.com/gpuweb/gpuweb/blob/main/proposals/bindless.md
14. **Heterogeneous resource tables.** This tier allows every resource type except uniform buffers
    (storage buffers included). Chrome does not implement it yet. It may not be available on some
    Android hardware when it ships. The proposal's `getResource` note says that storage buffer
    views come later. Status: absent.
    - https://toji.dev/2026/10/06/webgpu-bindless.html
    - https://github.com/gpuweb/gpuweb/blob/main/proposals/bindless.md

## What this note does not decide

This note records facts. It changes no record and no plan item. A record that adopts a feature
does so in its own amendment or in a new record. Amendment 1 of record 0010 records facts 10 and
13 against Parts 2 and 5. Every feature above also needs TypeShade and its runtime to expose it
before a package can use it (`CLAUDE.md`, "Every package is written on the public runtime
alone").

Dropped as not verifiable: none.
