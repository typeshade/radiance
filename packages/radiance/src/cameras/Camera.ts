import { Object3D } from '../core/Object3D.ts';

/** What a renderer looks through. It looks down its own -z axis, with +y up. */
export abstract class Camera extends Object3D {
  readonly isCamera = true;
}
