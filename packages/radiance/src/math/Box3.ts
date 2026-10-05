import { Vector3 } from './Vector3.ts';

/** An axis-aligned box, from `min` to `max`. */
export class Box3 {
  constructor(
    public min = new Vector3(-Infinity, -Infinity, -Infinity),
    public max = new Vector3(Infinity, Infinity, Infinity),
  ) {}

  /** `point` moved to the nearest place inside the box. */
  clampPoint(point: Vector3, target = new Vector3()): Vector3 {
    return target.set(
      Math.min(this.max.x, Math.max(this.min.x, point.x)),
      Math.min(this.max.y, Math.max(this.min.y, point.y)),
      Math.min(this.max.z, Math.max(this.min.z, point.z)),
    );
  }

  containsPoint(p: Vector3): boolean {
    return (
      p.x >= this.min.x &&
      p.x <= this.max.x &&
      p.y >= this.min.y &&
      p.y <= this.max.y &&
      p.z >= this.min.z &&
      p.z <= this.max.z
    );
  }
}
