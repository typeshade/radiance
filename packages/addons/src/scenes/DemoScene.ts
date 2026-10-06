import type { Box3, PerspectiveCamera, Scene, Vector3 } from '@typeshade/radiance';

/**
 * A small scene with the camera that looks at it, as `createCornellBox` gives them. The
 * differential scenes of design record 0002 return this.
 */
export interface DemoScene {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  /** Where the camera looks. */
  readonly target: Vector3;
  /** The box the camera's target should stay in, for controls. */
  readonly bounds: Box3;
}
