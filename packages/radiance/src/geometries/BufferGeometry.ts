import { Box3 } from '../math/Box3.ts';
import { Vector3 } from '../math/Vector3.ts';
import { Geometry } from './Geometry.ts';

/**
 * A triangle mesh as typed arrays, in the mesh's own space. It is what `Geometry` becomes at M2
 * (design record 0001, "The host model"). The setter of each attribute adds 1 to `version`.
 * After an edit in place, add 1 to `version` by hand: the path tracer builds the geometry's BVH
 * again only when `version` moved.
 *
 * Any number of meshes may share one geometry. The path tracer builds its BVH once and draws each
 * mesh as an instance of it.
 */
export class BufferGeometry extends Geometry {
  readonly type: string = 'BufferGeometry';

  /** Incremented by the setter of every attribute, and by the author after an in-place edit. */
  version = 0;

  #position = new Float32Array(0);
  #normal: Float32Array | undefined;
  #uv: Float32Array | undefined;
  #index = new Uint32Array(0);

  /** xyz per vertex. Required. */
  get position(): Float32Array {
    return this.#position;
  }
  set position(value: Float32Array) {
    this.#position = value;
    this.version++;
  }

  /** xyz per vertex, unit length. Computed by `computeVertexNormals()` when absent. */
  get normal(): Float32Array | undefined {
    return this.#normal;
  }
  set normal(value: Float32Array | undefined) {
    this.#normal = value;
    this.version++;
  }

  /**
   * uv per vertex, three.js's layout: v = 1 at the top of a plane and at a sphere's north pole
   * (design record 0001, Amendment 1). Absent: every uv is 0.
   */
  get uv(): Float32Array | undefined {
    return this.#uv;
  }
  set uv(value: Float32Array | undefined) {
    this.#uv = value;
    this.version++;
  }

  /** Three vertex indices per triangle, counter-clockwise seen from the front. Required. */
  get index(): Uint32Array {
    return this.#index;
  }
  set index(value: Uint32Array) {
    this.#index = value;
    this.version++;
  }

  /**
   * Sets `normal` to the area-weighted mean of the normals of the triangles that share each vertex,
   * as three.js does. A vertex that no triangle uses gets (0, 0, 0). Adds 1 to `version`.
   */
  computeVertexNormals(): this {
    const p = this.#position;
    const ix = this.#index;
    const n = new Float32Array(p.length);
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    for (let i = 0; i + 2 < ix.length; i += 3) {
      const ia = ix[i]! * 3;
      const ib = ix[i + 1]! * 3;
      const ic = ix[i + 2]! * 3;
      a.set(p[ia]!, p[ia + 1]!, p[ia + 2]!);
      b.set(p[ib]!, p[ib + 1]!, p[ib + 2]!);
      c.set(p[ic]!, p[ic + 1]!, p[ic + 2]!);
      // (c - b) x (a - b) is (b - a) x (c - a): twice the triangle's area times its normal.
      const face = c.sub(b).cross(a.sub(b));
      for (const at of [ia, ib, ic]) {
        n[at] = n[at]! + face.x;
        n[at + 1] = n[at + 1]! + face.y;
        n[at + 2] = n[at + 2]! + face.z;
      }
    }
    for (let v = 0; v + 2 < n.length; v += 3) {
      const length = Math.hypot(n[v]!, n[v + 1]!, n[v + 2]!);
      if (length > 0) {
        n[v] = n[v]! / length;
        n[v + 1] = n[v + 1]! / length;
        n[v + 2] = n[v + 2]! / length;
      }
    }
    this.normal = n;
    return this;
  }

  /** The box around `position`. A geometry with no vertex gives an empty box: min above max. */
  computeBoundingBox(): Box3 {
    const box = new Box3(
      new Vector3(Infinity, Infinity, Infinity),
      new Vector3(-Infinity, -Infinity, -Infinity),
    );
    const p = this.#position;
    for (let i = 0; i + 2 < p.length; i += 3) {
      box.min.set(
        Math.min(box.min.x, p[i]!),
        Math.min(box.min.y, p[i + 1]!),
        Math.min(box.min.z, p[i + 2]!),
      );
      box.max.set(
        Math.max(box.max.x, p[i]!),
        Math.max(box.max.y, p[i + 1]!),
        Math.max(box.max.z, p[i + 2]!),
      );
    }
    return box;
  }
}
