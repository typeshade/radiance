// === @typeshade/radiance/internal: what the engine's own scripts reach ===
//
// The renderer's internals that a script needs: the scene pack, the limits it checks against, the
// numbers of the buffer layout and the BVH builder (design record 0003, "What is public"). The CPU
// oracle (scripts/oracle.ts) binds the pack the renderer uploads from, so the CPU and the GPU read
// one scene. The benchmark (scripts/bench.mjs) times `buildBlas`.
//
// This subpath carries no stability promise. A name here may move or go in any release, and
// `bun run bake:api-surface` leaves it out of `__api__/surface.md`. Only `index.ts` is the public
// API. Nothing in `index.ts` re-exports a name from this file.

export { buildBlas } from './accel/bvh.ts';

export {
  SCENE_BUFFERS,
  ScenePack,
  cameraFrame,
  packMaterial,
  sameCameraFrame,
  type CameraFrame,
  type SceneArrays,
  type SceneBuffer,
  type SceneCounts,
  type TraceParamsValue,
} from './renderers/scene-pack.ts';

export {
  DEFAULT_LIMITS,
  checkStorageBinding,
  maxBufferSize,
  maxComputeWorkgroupsPerDimension,
  maxStorageBufferBindingSize,
  maxStorageBuffersPerShaderStage,
  type Limits,
} from './renderers/limits.ts';

// The layout constants: the strides, the bit fields and the offsets of record 0001's table, as
// `kernels/layout.shade.ts` defines them.
export {
  ACCUM_STRIDE,
  INSTANCE_BASES,
  INSTANCE_FLAGS,
  INSTANCE_INVERSE,
  INSTANCE_MATRIX,
  INSTANCE_STRIDE,
  LIGHT_STRIDE,
  LIGHT_TRIANGLE,
  MATERIAL_STRIDE,
  NODE_AXIS_SHIFT,
  NODE_COUNT_MASK,
  NODE_STRIDE,
  TRIANGLE_STRIDE,
  VERTEX_STRIDE,
} from './kernels/layout.shade.ts';
