/** A point or a direction in 3D. Mutating methods return `this`, so calls chain. */
export class Vector3 {
  constructor(
    public x = 0,
    public y = 0,
    public z = 0,
  ) {}

  set(x: number, y: number, z: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  copy(v: Vector3): this {
    return this.set(v.x, v.y, v.z);
  }

  clone(): Vector3 {
    return new Vector3(this.x, this.y, this.z);
  }

  add(v: Vector3): this {
    return this.set(this.x + v.x, this.y + v.y, this.z + v.z);
  }

  sub(v: Vector3): this {
    return this.set(this.x - v.x, this.y - v.y, this.z - v.z);
  }

  /** `this` plus `v` times `s`. */
  addScaled(v: Vector3, s: number): this {
    return this.set(this.x + v.x * s, this.y + v.y * s, this.z + v.z * s);
  }

  multiplyScalar(s: number): this {
    return this.set(this.x * s, this.y * s, this.z * s);
  }

  dot(v: Vector3): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  /** `this` = `this` x `v`. */
  cross(v: Vector3): this {
    return this.set(
      this.y * v.z - this.z * v.y,
      this.z * v.x - this.x * v.z,
      this.x * v.y - this.y * v.x,
    );
  }

  length(): number {
    return Math.hypot(this.x, this.y, this.z);
  }

  normalize(): this {
    const l = this.length();
    return l > 0 ? this.multiplyScalar(1 / l) : this;
  }

  distanceTo(v: Vector3): number {
    return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z);
  }

  equals(v: Vector3): boolean {
    return this.x === v.x && this.y === v.y && this.z === v.z;
  }

  /** `this` as a point transformed by `m` (translation applies). */
  applyMatrix4(m: { readonly elements: ArrayLike<number> }): this {
    const e = m.elements;
    const { x, y, z } = this;
    return this.set(
      e[0]! * x + e[4]! * y + e[8]! * z + e[12]!,
      e[1]! * x + e[5]! * y + e[9]! * z + e[13]!,
      e[2]! * x + e[6]! * y + e[10]! * z + e[14]!,
    );
  }

  /** `this` as a direction transformed by `m` (translation does not apply). */
  transformDirection(m: { readonly elements: ArrayLike<number> }): this {
    const e = m.elements;
    const { x, y, z } = this;
    return this.set(
      e[0]! * x + e[4]! * y + e[8]! * z,
      e[1]! * x + e[5]! * y + e[9]! * z,
      e[2]! * x + e[6]! * y + e[10]! * z,
    );
  }

  toArray(): [number, number, number] {
    return [this.x, this.y, this.z];
  }
}
