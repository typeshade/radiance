// === The WebGPU limits the engine assumes (design record 0001, "Limits") ===
//
// The runtime requests no limit above WebGPU's defaults and reports none, until record 0006, item
// 1 gives it a way to. So the engine assumes the defaults, each named here as the WebGPU
// specification names it, and checks a buffer against them before each upload. A buffer over a
// limit is a `RangeError` that names the buffer and both numbers, not a lost device.

/** The most bytes one storage binding may cover. */
export const maxStorageBufferBindingSize = 134_217_728;
/** The most bytes one buffer may hold. */
export const maxBufferSize = 268_435_456;
/** The most storage buffers one shader stage may bind. The path tracer binds seven, so the
 *  compiler's console buffer has the eighth (record 0001, rule 1). */
export const maxStorageBuffersPerShaderStage = 8;
/** The most workgroups one dispatch may have along one dimension. */
export const maxComputeWorkgroupsPerDimension = 65_535;

/** The limits a scene pack checks its buffers against: WebGPU's defaults unless a caller (a test)
 *  gives others. */
export interface Limits {
  readonly maxStorageBufferBindingSize: number;
}

/** WebGPU's default limits. */
export const DEFAULT_LIMITS: Limits = { maxStorageBufferBindingSize };

/** `n` with a comma between each group of three digits: 134,217,728. */
const grouped = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/**
 * Throws a `RangeError` when a buffer of `bytes` bytes is more than one storage binding covers:
 * "the nodes buffer is 201,326,592 bytes; WebGPU binds at most 134,217,728 in one storage
 * binding".
 */
export function checkStorageBinding(
  name: string,
  bytes: number,
  limits: Limits = DEFAULT_LIMITS,
): void {
  if (bytes > limits.maxStorageBufferBindingSize)
    throw new RangeError(
      `the ${name} buffer is ${grouped(bytes)} bytes; WebGPU binds at most ${grouped(limits.maxStorageBufferBindingSize)} in one storage binding`,
    );
}
