import type { Euler } from './Euler.ts';
import { Vector3 } from './Vector3.ts';

/** A 4x4 matrix, column-major as WebGPU reads one. */
export class Matrix4 {
  readonly elements = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

  identity(): this {
    this.elements.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    return this;
  }

  copy(m: Matrix4): this {
    this.elements.set(m.elements);
    return this;
  }

  clone(): Matrix4 {
    return new Matrix4().copy(this);
  }

  /** `this` = `a` * `b`. */
  multiplyMatrices(a: Matrix4, b: Matrix4): this {
    const ae = a.elements;
    const be = b.elements;
    const out = new Float64Array(16);
    for (let c = 0; c < 4; c++)
      for (let r = 0; r < 4; r++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += ae[k * 4 + r]! * be[c * 4 + k]!;
        out[c * 4 + r] = s;
      }
    this.elements.set(out);
    return this;
  }

  /** Translation, then the rotation (X, then Y, then Z), then the scale, as one matrix. */
  compose(position: Vector3, rotation: Euler, scale: Vector3): this {
    const [cx, sx] = [Math.cos(rotation.x), Math.sin(rotation.x)];
    const [cy, sy] = [Math.cos(rotation.y), Math.sin(rotation.y)];
    const [cz, sz] = [Math.cos(rotation.z), Math.sin(rotation.z)];
    // R = Rz * Ry * Rx: X is applied first.
    const r00 = cz * cy;
    const r01 = cz * sy * sx - sz * cx;
    const r02 = cz * sy * cx + sz * sx;
    const r10 = sz * cy;
    const r11 = sz * sy * sx + cz * cx;
    const r12 = sz * sy * cx - cz * sx;
    const r20 = -sy;
    const r21 = cy * sx;
    const r22 = cy * cx;
    const { x: kx, y: ky, z: kz } = scale;
    // prettier-ignore
    this.elements.set([
      r00 * kx, r10 * kx, r20 * kx, 0,
      r01 * ky, r11 * ky, r21 * ky, 0,
      r02 * kz, r12 * kz, r22 * kz, 0,
      position.x, position.y, position.z, 1,
    ]);
    return this;
  }

  /** The largest factor by which the matrix stretches any direction's length, for a radius. */
  maxScale(): number {
    const e = this.elements;
    return Math.max(
      Math.hypot(e[0]!, e[1]!, e[2]!),
      Math.hypot(e[4]!, e[5]!, e[6]!),
      Math.hypot(e[8]!, e[9]!, e[10]!),
    );
  }

  /** The translation part. */
  getPosition(target = new Vector3()): Vector3 {
    return target.set(this.elements[12]!, this.elements[13]!, this.elements[14]!);
  }

  equals(m: Matrix4): boolean {
    return this.elements.every((v, i) => v === m.elements[i]);
  }
}
