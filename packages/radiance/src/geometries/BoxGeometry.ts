import { BufferGeometry } from './BufferGeometry.ts';

/** One face of the box, as three.js builds it: the axes it runs along and the signs of its steps. */
interface Face {
  /** The axes (0 is x, 1 is y, 2 is z) of the face's columns, of its rows and of its normal. */
  readonly u: number;
  readonly v: number;
  readonly w: number;
  /** The sign of a step along `u` and of a step along `v`. */
  readonly udir: number;
  readonly vdir: number;
  /** The sign of the face's normal, and of its offset from the centre along `w`. */
  readonly sign: number;
}

/** The six faces in three.js's order: +x, -x, +y, -y, +z, -z. */
const FACES: readonly Face[] = [
  { u: 2, v: 1, w: 0, udir: -1, vdir: -1, sign: 1 },
  { u: 2, v: 1, w: 0, udir: 1, vdir: -1, sign: -1 },
  { u: 0, v: 2, w: 1, udir: 1, vdir: 1, sign: 1 },
  { u: 0, v: 2, w: 1, udir: 1, vdir: -1, sign: -1 },
  { u: 0, v: 1, w: 2, udir: 1, vdir: -1, sign: 1 },
  { u: 0, v: 1, w: 2, udir: -1, vdir: -1, sign: -1 },
];

/**
 * A box about the origin, `width` along x, `height` along y and `depth` along z. It is 12
 * triangles on 24 vertices, four for each face. It follows three.js's `BoxGeometry` with one
 * segment each way: the same vertex order and the same uv layout. A face has its own vertices, so
 * its normals are flat.
 */
export class BoxGeometry extends BufferGeometry {
  override readonly type: string = 'BoxGeometry';

  constructor(
    readonly width = 1,
    readonly height = 1,
    readonly depth = 1,
  ) {
    super();
    const extent = [width, height, depth] as const;
    const position = new Float32Array(24 * 3);
    const normal = new Float32Array(24 * 3);
    const uv = new Float32Array(24 * 2);
    const index = new Uint32Array(12 * 3);
    FACES.forEach((face, f) => {
      const columns = extent[face.u];
      const rows = extent[face.v];
      const offset = extent[face.w] * face.sign;
      // Four corners: top left, top right, bottom left, bottom right, as three.js lists them.
      for (let k = 0; k < 4; k++) {
        const ix = k % 2;
        const iy = k >> 1;
        const vertex = f * 4 + k;
        position[vertex * 3 + face.u] = (ix * columns - columns / 2) * face.udir;
        position[vertex * 3 + face.v] = (iy * rows - rows / 2) * face.vdir;
        position[vertex * 3 + face.w] = offset / 2;
        normal[vertex * 3 + face.w] = face.sign;
        uv[vertex * 2] = ix;
        uv[vertex * 2 + 1] = 1 - iy;
      }
      index.set(
        [0, 2, 1, 2, 3, 1].map((i) => i + f * 4),
        f * 6,
      );
    });
    this.position = position;
    this.normal = normal;
    this.uv = uv;
    this.index = index;
  }
}
