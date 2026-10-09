import { Camera } from './Camera.ts';

/** A pinhole camera: everything in focus, a vertical field of view and an aspect ratio. */
export class PerspectiveCamera extends Camera {
  /** The width of the film, in millimetres. 35 by default, as three.js has it. */
  filmGauge = 35;

  constructor(
    /** The vertical field of view, in degrees. */
    public fov = 50,
    /** Width over height; the renderer's frame should have the same. */
    public aspect = 1,
  ) {
    super();
  }

  /** The height of the film, in millimetres: `filmGauge / max(aspect, 1)` (design record 0010, Part 4). */
  getFilmHeight(): number {
    return this.filmGauge / Math.max(this.aspect, 1);
  }

  /** The focal length, in millimetres, that `fov` and the film give. */
  getFocalLength(): number {
    return (0.5 * this.getFilmHeight()) / Math.tan((this.fov * Math.PI) / 360);
  }

  /** Sets `fov`, in degrees, so that the film gives focal length `focalLength`, in millimetres. */
  setFocalLength(focalLength: number): void {
    this.fov = (2 * Math.atan((0.5 * this.getFilmHeight()) / focalLength) * 180) / Math.PI;
  }
}
