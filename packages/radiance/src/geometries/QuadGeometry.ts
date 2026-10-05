import { Geometry } from './Geometry.ts';

/**
 * A rectangle in the xy plane, centred on the origin, `width` along x and `height` along y. Its
 * front faces +z; an emissive material gives off light from the front only.
 */
export class QuadGeometry extends Geometry {
  readonly type = 'QuadGeometry';
  constructor(
    public width = 1,
    public height = 1,
  ) {
    super();
  }
}
