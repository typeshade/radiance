import { Camera } from './Camera.ts';

/** A pinhole camera: everything in focus, a vertical field of view and an aspect ratio. */
export class PerspectiveCamera extends Camera {
  constructor(
    /** The vertical field of view, in degrees. */
    public fov = 50,
    /** Width over height; the renderer's frame should have the same. */
    public aspect = 1,
  ) {
    super();
  }
}
