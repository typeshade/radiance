import { BufferGeometry } from './BufferGeometry.ts';

/**
 * A rectangle in the xy plane, centred on the origin, `width` along x and `height` along y. Its
 * front faces +z. It is two triangles with three.js's vertex order and uv layout (three.js's
 * `PlaneGeometry` with one segment each way). An emissive material gives off light from the
 * front only.
 */
export class PlaneGeometry extends BufferGeometry {
  override readonly type: string = 'PlaneGeometry';

  constructor(
    readonly width = 1,
    readonly height = 1,
  ) {
    super();
    const x = width / 2;
    const y = height / 2;
    // Top left, top right, bottom left, bottom right, as three.js lists them.
    this.position = Float32Array.of(-x, y, 0, x, y, 0, -x, -y, 0, x, -y, 0);
    this.normal = Float32Array.of(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1);
    this.uv = Float32Array.of(0, 1, 1, 1, 0, 0, 1, 0);
    this.index = Uint32Array.of(0, 2, 1, 2, 3, 1);
  }
}
