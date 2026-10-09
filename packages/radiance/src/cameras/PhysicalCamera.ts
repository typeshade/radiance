import { PerspectiveCamera } from './PerspectiveCamera.ts';

/** The parameters of a `PhysicalCamera`. Each one is also a property of the camera. */
export interface PhysicalCameraParameters {
  /** The f-number. Default 5.6. */
  fStop?: number;
  /** The ISO speed. Default 100. */
  iso?: number;
  /** The shutter time, in seconds. Default 1 / 125. */
  shutterSpeed?: number;
  /** Added to the exposure, in stops. Default 0. */
  exposureCompensation?: number;
  /** `relative`: 0 stops at the defaults. `absolute`: the saturation-based scale. Default `relative`. */
  exposureMode?: 'relative' | 'absolute';
}

const DEFAULT_F_STOP = 5.6;
const DEFAULT_ISO = 100;
const DEFAULT_SHUTTER_SPEED = 1 / 125;

/** EV100 of a camera: `log2(N^2 / t) - log2(ISO / 100)` (design record 0010, Part 4). */
function ev100Of(fStop: number, shutterSpeed: number, iso: number): number {
  return Math.log2((fStop * fStop) / shutterSpeed) - Math.log2(iso / 100);
}

/** The saturation-based exposure scale of Lagarde and de Rousiers (2014): `t * ISO / (120 * N^2)`. */
function absoluteScale(fStop: number, shutterSpeed: number, iso: number): number {
  return (shutterSpeed * iso) / (120 * fStop * fStop);
}

/**
 * A pinhole camera with a physical exposure: an f-number, an ISO speed and a shutter time set the
 * exposure in stops, which the renderer adds to its own (design record 0010, Part 4, decision 21).
 * The lens (depth of field, focus distance, aperture blades) is in later steps of that part.
 * The name is three-gpu-pathtracer's.
 */
export class PhysicalCamera extends PerspectiveCamera {
  /** The f-number. */
  fStop: number;
  /** The ISO speed. */
  iso: number;
  /** The shutter time, in seconds. */
  shutterSpeed: number;
  /** Added to the exposure, in stops. */
  exposureCompensation: number;
  /** `relative` adds 0 stops at the defaults; `absolute` follows Lagarde and de Rousiers. */
  exposureMode: 'relative' | 'absolute';

  constructor(fov?: number, aspect?: number, parameters: PhysicalCameraParameters = {}) {
    super(fov, aspect);
    this.fStop = parameters.fStop ?? DEFAULT_F_STOP;
    this.iso = parameters.iso ?? DEFAULT_ISO;
    this.shutterSpeed = parameters.shutterSpeed ?? DEFAULT_SHUTTER_SPEED;
    this.exposureCompensation = parameters.exposureCompensation ?? 0;
    this.exposureMode = parameters.exposureMode ?? 'relative';
  }

  /** EV100 of the current f-number, shutter time and ISO speed. */
  get ev100(): number {
    return ev100Of(this.fStop, this.shutterSpeed, this.iso);
  }

  /**
   * The exposure in stops, added to the renderer's exposure. `absolute`: `log2(scale)` plus the
   * compensation. `relative`: the same, less its value at the defaults, so the defaults give 0.
   */
  get exposureStops(): number {
    const scale = absoluteScale(this.fStop, this.shutterSpeed, this.iso);
    const compensation = this.exposureCompensation;
    if (this.exposureMode === 'absolute') return Math.log2(scale) + compensation;
    const atDefaults = absoluteScale(DEFAULT_F_STOP, DEFAULT_SHUTTER_SPEED, DEFAULT_ISO);
    return Math.log2(scale) - Math.log2(atDefaults) + compensation;
  }
}
