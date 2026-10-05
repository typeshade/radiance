import { Object3D } from '../core/Object3D.ts';

/** The root of what is rendered. */
export class Scene extends Object3D {
  readonly isScene = true;
}
