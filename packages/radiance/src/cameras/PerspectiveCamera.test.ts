// The film of a PerspectiveCamera: the focal length and the field of view it gives (design record
// 0010, Part 4, step 4.1). Verifies: Design 0010.21 (the film members of PerspectiveCamera).

import { describe, expect, it } from 'bun:test';
import { PerspectiveCamera } from './PerspectiveCamera.ts';

describe('PerspectiveCamera film', () => {
  it('has a 35 mm film gauge by default', () => {
    expect(new PerspectiveCamera().filmGauge).toBe(35);
  });

  it('gives a 50 mm focal length the field of view of 38.5808 degrees at aspect 1', () => {
    const camera = new PerspectiveCamera(50, 1);
    camera.setFocalLength(50);
    expect(Math.abs(camera.fov - 38.5808)).toBeLessThan(1e-3);
  });

  it('returns the focal length that was set, within 1e-9', () => {
    const camera = new PerspectiveCamera(50, 1);
    camera.setFocalLength(50);
    expect(Math.abs(camera.getFocalLength() - 50)).toBeLessThan(1e-9);
  });

  it('round-trips a focal length at a wide aspect, where the film height is the gauge over the aspect', () => {
    const camera = new PerspectiveCamera(50, 2);
    expect(camera.getFilmHeight()).toBe(35 / 2);
    camera.setFocalLength(24);
    expect(Math.abs(camera.getFocalLength() - 24)).toBeLessThan(1e-9);
  });

  it('keeps the film height at the gauge for an aspect below 1', () => {
    expect(new PerspectiveCamera(50, 0.5).getFilmHeight()).toBe(35);
  });
});
