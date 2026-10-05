import { PlaneGeometry } from './PlaneGeometry.ts';

/**
 * A rectangle in the xy plane, centred on the origin, `width` along x and `height` along y. Its
 * front faces +z. An emissive material gives off light from the front only.
 *
 * `PlaneGeometry` is this class's name from 0.1.0 (design record 0001, decision 7, and record
 * 0003). Until then it is a `PlaneGeometry` with M1's name and constructor.
 */
export class QuadGeometry extends PlaneGeometry {
  override readonly type: string = 'QuadGeometry';
}
