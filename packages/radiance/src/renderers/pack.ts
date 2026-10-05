// The scene as the path tracer's kernel reads it (kernels/trace.shade.ts documents the layout):
// every visible mesh in world space, its material's index, and the camera's frame. A renderer
// compares what this returns frame to frame, so any change to the scene or the camera starts
// the accumulation again without the application saying so.

import type { Camera } from '../cameras/Camera.ts';
import { PerspectiveCamera } from '../cameras/PerspectiveCamera.ts';
import { QuadGeometry } from '../geometries/QuadGeometry.ts';
import { SphereGeometry } from '../geometries/SphereGeometry.ts';
import type { Material } from '../materials/Material.ts';
import { Vector3 } from '../math/Vector3.ts';
import { Mesh } from '../objects/Mesh.ts';
import type { Scene } from '../scenes/Scene.ts';

/** The kernel's scene buffers. Each has at least one element (WebGPU binds no empty buffer);
 *  `counts` says how many are real. */
export interface PackedScene {
  /** Two vec4 per sphere: centre and radius; material index in x. */
  readonly spheres: Float32Array;
  /** Three vec4 per quad: corner and material index (w); edge u; edge v. */
  readonly quads: Float32Array;
  /** Two vec4 per material: albedo and kind (w); emission. */
  readonly materials: Float32Array;
  /** The index of every quad whose material emits. */
  readonly lights: Uint32Array;
  /** How many spheres, quads and lights. */
  readonly counts: readonly [number, number, number];
}

/** The camera's frame as the kernel reads it. */
export interface CameraUniforms {
  readonly eye: [number, number, number, number];
  readonly right: [number, number, number, number];
  readonly up: [number, number, number, number];
  readonly forward: [number, number, number, number];
  readonly lens: [number, number, number, number];
}

const emits = (m: Material): boolean => m.emissive.r > 0 || m.emissive.g > 0 || m.emissive.b > 0;

/** `scene`, in world space, packed for the kernel. Call `scene.updateMatrixWorld()` first. */
export function packScene(scene: Scene): PackedScene {
  const spheres: number[] = [];
  const quads: number[] = [];
  const lights: number[] = [];
  const materials: Material[] = [];
  const index = new Map<Material, number>();
  const materialOf = (m: Material): number => {
    let i = index.get(m);
    if (i === undefined) {
      i = materials.length;
      index.set(m, i);
      materials.push(m);
    }
    return i;
  };
  scene.traverseVisible((o) => {
    if (!(o instanceof Mesh)) return;
    const m = materialOf(o.material);
    const g = o.geometry;
    const w = o.matrixWorld;
    if (g instanceof SphereGeometry) {
      const c = new Vector3().applyMatrix4(w);
      spheres.push(c.x, c.y, c.z, g.radius * w.maxScale(), m, 0, 0, 0);
    } else if (g instanceof QuadGeometry) {
      const corner = new Vector3(-g.width / 2, -g.height / 2, 0).applyMatrix4(w);
      const u = new Vector3(g.width, 0, 0).transformDirection(w);
      const v = new Vector3(0, g.height, 0).transformDirection(w);
      if (emits(o.material)) lights.push(quads.length / 12);
      quads.push(corner.x, corner.y, corner.z, m, u.x, u.y, u.z, 0, v.x, v.y, v.z, 0);
    } else {
      throw new Error(`the path tracer cannot draw a ${g.type} yet`);
    }
  });
  const table: number[] = [];
  for (const m of materials) table.push(...m.color.toArray(), m.kind, ...m.emissive.toArray(), 0);
  const atLeast = (a: number[], width: number): Float32Array =>
    new Float32Array(a.length > 0 ? a : new Array(width).fill(0));
  return {
    spheres: atLeast(spheres, 8),
    quads: atLeast(quads, 12),
    materials: atLeast(table, 8),
    lights: Uint32Array.from(lights.length > 0 ? lights : [0]),
    counts: [spheres.length / 8, quads.length / 12, lights.length],
  };
}

/** The camera's world frame and lens. Call `camera.updateMatrixWorld()` first. */
export function cameraUniforms(camera: Camera): CameraUniforms {
  const e = camera.matrixWorld.elements;
  const right = new Vector3(e[0], e[1], e[2]).normalize();
  const up = new Vector3(e[4], e[5], e[6]).normalize();
  const forward = new Vector3(-e[8]!, -e[9]!, -e[10]!).normalize();
  const fov = camera instanceof PerspectiveCamera ? camera.fov : 50;
  const aspect = camera instanceof PerspectiveCamera ? camera.aspect : 1;
  const tanY = Math.tan((fov * Math.PI) / 360);
  return {
    eye: [e[12]!, e[13]!, e[14]!, 0],
    right: [...right.toArray(), 0],
    up: [...up.toArray(), 0],
    forward: [...forward.toArray(), 0],
    lens: [tanY * aspect, tanY, 0, 0],
  };
}

const sameNumbers = (a: ArrayLike<number>, b: ArrayLike<number>): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

export function sameScene(a: PackedScene, b: PackedScene): boolean {
  return (
    sameNumbers(a.spheres, b.spheres) &&
    sameNumbers(a.quads, b.quads) &&
    sameNumbers(a.materials, b.materials) &&
    sameNumbers(a.lights, b.lights)
  );
}

export function sameCamera(a: CameraUniforms, b: CameraUniforms): boolean {
  return (['eye', 'right', 'up', 'forward', 'lens'] as const).every((k) => sameNumbers(a[k], b[k]));
}
