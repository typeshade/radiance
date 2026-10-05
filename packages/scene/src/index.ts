// === @typeshade/radiance-scene: the host data layer (plan L2) ===
//
// A scene is assembled here as plain data and packed into the buffers the path tracer reads
// (`@typeshade/radiance-kernels`, `trace.shade.ts`, which documents the layout). M1's shapes are
// spheres and parallelograms ("quads"); triangle meshes and the BVH come at M2.
//
// This package imports nothing: it builds numbers, and the renderer hands them to the runtime.

export type Vec3 = readonly [number, number, number];

export interface Material {
  /** The fraction of light reflected, per channel, in [0, 1]. */
  readonly albedo: Vec3;
  /** The light the surface gives off, as radiance. Omitted, none. */
  readonly emission?: Vec3;
  /** How the surface reflects. Omitted, 'diffuse'. */
  readonly kind?: 'diffuse' | 'mirror';
}

export interface Sphere {
  readonly centre: Vec3;
  readonly radius: number;
  /** An index into `Scene.materials`. */
  readonly material: number;
}

/**
 * The parallelogram `corner + a u + b v`, a and b in [0, 1]. Its front face is the side
 * `cross(u, v)` points to; an emissive quad gives off light only there.
 */
export interface Quad {
  readonly corner: Vec3;
  readonly u: Vec3;
  readonly v: Vec3;
  readonly material: number;
}

/** A pinhole camera. */
export interface Camera {
  readonly eye: Vec3;
  readonly target: Vec3;
  /** Which way is up; need not be perpendicular to the view. */
  readonly up: Vec3;
  /** The vertical field of view, in degrees. */
  readonly fovY: number;
}

export interface Scene {
  readonly materials: readonly Material[];
  readonly spheres: readonly Sphere[];
  readonly quads: readonly Quad[];
  readonly camera: Camera;
}

/** The scene as the kernels read it. Every array has at least one element, since WebGPU binds
 *  no empty buffer; `counts` says how many are real. */
export interface PackedScene {
  /** Two vec4 per sphere: centre and radius; material index in x. */
  readonly spheres: Float32Array;
  /** Three vec4 per quad: corner and material index (w); edge u; edge v. */
  readonly quads: Float32Array;
  /** Two vec4 per material: albedo and kind (w: 0 diffuse, 1 mirror); emission. */
  readonly materials: Float32Array;
  /** The index of every quad whose material emits. */
  readonly lights: Uint32Array;
  /** How many spheres, quads and lights. */
  readonly counts: readonly [number, number, number];
}

/** The camera as the kernels read it, for a frame of `width` by `height` pixels. */
export interface CameraParams {
  readonly eye: readonly [number, number, number, number];
  readonly right: readonly [number, number, number, number];
  readonly up: readonly [number, number, number, number];
  readonly forward: readonly [number, number, number, number];
  readonly lens: readonly [number, number, number, number];
}

const emits = (m: Material): boolean => (m.emission ?? [0, 0, 0]).some((c) => c > 0);

/** Packs `scene` into the kernels' buffers. Throws on a material index out of range. */
export function packScene(scene: Scene): PackedScene {
  const check = (m: number, what: string): number => {
    if (!Number.isInteger(m) || m < 0 || m >= scene.materials.length)
      throw new RangeError(`${what}: material ${m} is not in the scene's materials`);
    return m;
  };
  const spheres = new Float32Array(Math.max(1, scene.spheres.length) * 8);
  scene.spheres.forEach((s, i) => {
    spheres.set([...s.centre, s.radius, check(s.material, `sphere ${i}`), 0, 0, 0], i * 8);
  });
  const quads = new Float32Array(Math.max(1, scene.quads.length) * 12);
  const lights: number[] = [];
  scene.quads.forEach((q, i) => {
    const m = check(q.material, `quad ${i}`);
    quads.set([...q.corner, m, ...q.u, 0, ...q.v, 0], i * 12);
    if (emits(scene.materials[m]!)) lights.push(i);
  });
  const materials = new Float32Array(Math.max(1, scene.materials.length) * 8);
  scene.materials.forEach((m, i) => {
    const kind = m.kind === 'mirror' ? 1 : 0;
    materials.set([...m.albedo, kind, ...(m.emission ?? [0, 0, 0]), 0], i * 8);
  });
  return {
    spheres,
    quads,
    materials,
    lights: Uint32Array.from(lights.length > 0 ? lights : [0]),
    counts: [scene.spheres.length, scene.quads.length, lights.length],
  };
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalize = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** The camera's frame: its eye, its unit axes, and the tangents of half its field of view. */
export function cameraParams(camera: Camera, width: number, height: number): CameraParams {
  const forward = normalize(sub(camera.target, camera.eye));
  const right = normalize(cross(forward, camera.up));
  const up = cross(right, forward);
  const tanY = Math.tan((camera.fovY * Math.PI) / 360);
  return {
    eye: [...camera.eye, 0],
    right: [...right, 0],
    up: [...up, 0],
    forward: [...forward, 0],
    lens: [(tanY * width) / height, tanY, 0, 0],
  };
}

/**
 * The Cornell box, M1's scene: a box two units wide, open at the front, with a red wall on the
 * left, a green one on the right, a light in the ceiling, a mirror sphere and a white one.
 */
export function cornellBox(): Scene {
  const WHITE = 0;
  const RED = 1;
  const GREEN = 2;
  const LIGHT = 3;
  const MIRROR = 4;
  return {
    materials: [
      { albedo: [0.73, 0.73, 0.73] },
      { albedo: [0.65, 0.05, 0.05] },
      { albedo: [0.12, 0.45, 0.15] },
      { albedo: [0, 0, 0], emission: [17, 12, 4] },
      { albedo: [0.95, 0.95, 0.95], kind: 'mirror' },
    ],
    spheres: [
      { centre: [-0.45, 0.4, -0.35], radius: 0.4, material: MIRROR },
      { centre: [0.45, 0.4, 0.3], radius: 0.4, material: WHITE },
    ],
    quads: [
      // Floor, ceiling and back wall.
      { corner: [-1, 0, -1], u: [0, 0, 2], v: [2, 0, 0], material: WHITE },
      { corner: [-1, 2, -1], u: [2, 0, 0], v: [0, 0, 2], material: WHITE },
      { corner: [-1, 0, -1], u: [2, 0, 0], v: [0, 2, 0], material: WHITE },
      // Left (red) and right (green) walls.
      { corner: [-1, 0, -1], u: [0, 2, 0], v: [0, 0, 2], material: RED },
      { corner: [1, 0, -1], u: [0, 0, 2], v: [0, 2, 0], material: GREEN },
      // The light, just below the ceiling, facing down.
      { corner: [-0.25, 1.98, -0.2], u: [0.5, 0, 0], v: [0, 0, 0.4], material: LIGHT },
    ],
    camera: { eye: [0, 1, 3.4], target: [0, 1, 0], up: [0, 1, 0], fovY: 40 },
  };
}
