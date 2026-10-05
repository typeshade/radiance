/** A rotation as three angles in radians, applied in the order X, then Y, then Z. */
export class Euler {
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

  copy(e: Euler): this {
    return this.set(e.x, e.y, e.z);
  }

  equals(e: Euler): boolean {
    return this.x === e.x && this.y === e.y && this.z === e.z;
  }
}
