import { Euler } from '../math/Euler.ts';
import { Matrix4 } from '../math/Matrix4.ts';
import { Vector3 } from '../math/Vector3.ts';

let nextId = 1;

/**
 * Anything placed in a scene: a position, a rotation and a scale relative to its parent, and
 * children placed relative to it. `matrixWorld` is where it ends up, after
 * `updateMatrixWorld()`, which the renderer calls on the scene before every frame.
 */
export class Object3D {
  readonly id = nextId++;
  name = '';
  readonly position = new Vector3();
  readonly rotation = new Euler();
  readonly scale = new Vector3(1, 1, 1);
  readonly matrix = new Matrix4();
  readonly matrixWorld = new Matrix4();
  parent: Object3D | null = null;
  readonly children: Object3D[] = [];
  /** Hidden objects and their children are left out of the render. */
  visible = true;

  add(...objects: Object3D[]): this {
    for (const o of objects) {
      if (o === this) throw new Error('an object cannot be its own child');
      o.parent?.remove(o);
      o.parent = this;
      this.children.push(o);
    }
    return this;
  }

  remove(...objects: Object3D[]): this {
    for (const o of objects) {
      const i = this.children.indexOf(o);
      if (i >= 0) {
        this.children.splice(i, 1);
        o.parent = null;
      }
    }
    return this;
  }

  /** Call `fn` on this object and every descendant, parents first. */
  traverse(fn: (o: Object3D) => void): void {
    fn(this);
    for (const c of this.children) c.traverse(fn);
  }

  /** Like `traverse`, but skipping hidden objects and what is under them. */
  traverseVisible(fn: (o: Object3D) => void): void {
    if (!this.visible) return;
    fn(this);
    for (const c of this.children) c.traverseVisible(fn);
  }

  /** Recompute `matrix` from position, rotation and scale, and `matrixWorld` down the tree. */
  updateMatrixWorld(): void {
    this.matrix.compose(this.position, this.rotation, this.scale);
    if (this.parent === null) this.matrixWorld.copy(this.matrix);
    else this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
    for (const c of this.children) c.updateMatrixWorld();
  }

  /**
   * Turn so that the object's -z axis points at `target` (in its parent's space), with no roll:
   * how a camera is aimed. Straight up or down keeps the current yaw.
   */
  lookAt(target: Vector3): this {
    const d = target.clone().sub(this.position).normalize();
    if (d.length() === 0) return this;
    const pitch = Math.asin(Math.max(-1, Math.min(1, d.y)));
    const yaw = Math.abs(d.y) > 0.999999 ? this.rotation.y : Math.atan2(-d.x, -d.z);
    this.rotation.set(pitch, yaw, 0);
    return this;
  }
}
