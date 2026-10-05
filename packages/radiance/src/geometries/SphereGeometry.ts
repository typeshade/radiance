import { BufferGeometry } from './BufferGeometry.ts';

/**
 * A sphere about the origin, with three.js's vertex order and uv layout (three.js's
 * `SphereGeometry` over the whole sphere). The poles are rows of `widthSegments + 1` vertices that
 * share one position. Its normals point outward. `widthSegments` is at least 3 and
 * `heightSegments` at least 2, as in three.js, and both are rounded down.
 *
 * The path tracer draws its triangles, shaded with the vertices' normals, so more segments give a
 * rounder outline.
 */
export class SphereGeometry extends BufferGeometry {
  override readonly type: string = 'SphereGeometry';
  readonly widthSegments: number;
  readonly heightSegments: number;

  constructor(
    readonly radius = 1,
    widthSegments = 32,
    heightSegments = 16,
  ) {
    super();
    const w = Math.max(3, Math.floor(widthSegments));
    const h = Math.max(2, Math.floor(heightSegments));
    this.widthSegments = w;
    this.heightSegments = h;
    const vertices = (w + 1) * (h + 1);
    const position = new Float32Array(vertices * 3);
    const normal = new Float32Array(vertices * 3);
    const uv = new Float32Array(vertices * 2);
    const triangles: number[] = [];

    let vertex = 0;
    for (let iy = 0; iy <= h; iy++) {
      const v = iy / h;
      // The pole rows shift their u by half a segment, so that a texture does not pinch.
      const uOffset = iy === 0 ? 0.5 / w : iy === h ? -0.5 / w : 0;
      const y = radius * Math.cos(v * Math.PI);
      // The radius of the ring this row lies on. It is exactly 0 at a pole, as in three.js.
      const ring = Math.sqrt(radius * radius - y * y);
      for (let ix = 0; ix <= w; ix++, vertex++) {
        const u = ix / w;
        const phi = u * Math.PI * 2;
        const x = -ring * Math.cos(phi);
        const z = ring * Math.sin(phi);
        position.set([x, y, z], vertex * 3);
        const length = Math.hypot(x, y, z);
        normal.set(length > 0 ? [x / length, y / length, z / length] : [0, 0, 0], vertex * 3);
        uv.set([u + uOffset, 1 - v], vertex * 2);
      }
    }

    // Two triangles for each cell, except one in each cell of the first and of the last row:
    // that one would have two vertices at a pole.
    for (let iy = 0; iy < h; iy++) {
      for (let ix = 0; ix < w; ix++) {
        const a = iy * (w + 1) + ix + 1;
        const b = iy * (w + 1) + ix;
        const c = (iy + 1) * (w + 1) + ix;
        const d = (iy + 1) * (w + 1) + ix + 1;
        if (iy !== 0) triangles.push(a, b, d);
        if (iy !== h - 1) triangles.push(b, c, d);
      }
    }

    this.position = position;
    this.normal = normal;
    this.uv = uv;
    this.index = Uint32Array.from(triangles);
  }
}
