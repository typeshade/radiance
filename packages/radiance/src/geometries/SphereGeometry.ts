import { Geometry } from './Geometry.ts';

/** A sphere about the origin. A non-uniform scale is not supported: the largest one applies. */
export class SphereGeometry extends Geometry {
  readonly type = 'SphereGeometry';
  constructor(public radius = 1) {
    super();
  }
}
