// The exposure of a PhysicalCamera: EV100, the stops of the camera, and the relative and absolute
// modes (design record 0010, Part 4, step 4.1). Verifies: Design 0010.21 (the exposure from ISO,
// shutter and f-number, and the stop sum of the renderer).

import { describe, expect, it } from 'bun:test';
import { PerspectiveCamera } from './PerspectiveCamera.ts';
import { PhysicalCamera } from './PhysicalCamera.ts';

describe('PhysicalCamera', () => {
  it('extends PerspectiveCamera and keeps its field of view', () => {
    const camera = new PhysicalCamera(40, 1);
    expect(camera).toBeInstanceOf(PerspectiveCamera);
    expect(camera.fov).toBe(40);
  });

  it('takes its defaults: f/5.6, ISO 100, 1/125 s, relative mode', () => {
    const camera = new PhysicalCamera();
    expect(camera.fStop).toBe(5.6);
    expect(camera.iso).toBe(100);
    expect(camera.shutterSpeed).toBe(1 / 125);
    expect(camera.exposureCompensation).toBe(0);
    expect(camera.exposureMode).toBe('relative');
  });

  it('takes its parameters from the third argument', () => {
    const camera = new PhysicalCamera(40, 1, { fStop: 2, iso: 400, shutterSpeed: 1 / 60 });
    expect(camera.fStop).toBe(2);
    expect(camera.iso).toBe(400);
    expect(camera.shutterSpeed).toBe(1 / 60);
  });

  it('has an EV100 of 14.644 within 1e-3 at f/16, 1/100 s and ISO 100', () => {
    const camera = new PhysicalCamera(40, 1, { fStop: 16, shutterSpeed: 1 / 100, iso: 100 });
    expect(Math.abs(camera.ev100 - 14.644)).toBeLessThan(1e-3);
  });

  it('adds exactly one stop when the ISO doubles, in both modes', () => {
    for (const exposureMode of ['relative', 'absolute'] as const) {
      const base = new PhysicalCamera(40, 1, {
        fStop: 16,
        shutterSpeed: 1 / 100,
        iso: 100,
        exposureMode,
      });
      const doubled = new PhysicalCamera(40, 1, {
        fStop: 16,
        shutterSpeed: 1 / 100,
        iso: 200,
        exposureMode,
      });
      expect(doubled.exposureStops - base.exposureStops).toBeCloseTo(1, 12);
    }
  });

  it('adds one stop for each doubling of the shutter time, and one less for each sqrt(2) of f-number', () => {
    const base = new PhysicalCamera(40, 1, { fStop: 8, shutterSpeed: 1 / 100 });
    const longer = new PhysicalCamera(40, 1, { fStop: 8, shutterSpeed: 2 / 100 });
    const wider = new PhysicalCamera(40, 1, { fStop: 8 / Math.SQRT2, shutterSpeed: 1 / 100 });
    expect(longer.exposureStops - base.exposureStops).toBeCloseTo(1, 12);
    expect(wider.exposureStops - base.exposureStops).toBeCloseTo(1, 12);
  });

  it('adds 0 stops at the defaults in relative mode', () => {
    expect(new PhysicalCamera().exposureStops).toBe(0);
    expect(new PhysicalCamera(50, 1, { exposureMode: 'relative' }).exposureStops).toBe(0);
  });

  it('adds the exposure compensation, in stops, in both modes', () => {
    for (const exposureMode of ['relative', 'absolute'] as const) {
      const plain = new PhysicalCamera(40, 1, { exposureMode });
      const compensated = new PhysicalCamera(40, 1, { exposureMode, exposureCompensation: 1.5 });
      expect(compensated.exposureStops - plain.exposureStops).toBeCloseTo(1.5, 12);
    }
  });

  it('follows Lagarde and de Rousiers in absolute mode: log2(t * ISO / (120 * N^2))', () => {
    const camera = new PhysicalCamera(40, 1, {
      fStop: 16,
      shutterSpeed: 1 / 100,
      iso: 100,
      exposureMode: 'absolute',
    });
    const expected = Math.log2(((1 / 100) * 100) / (120 * 16 * 16));
    expect(camera.exposureStops).toBeCloseTo(expected, 12);
    // The absolute scale is 1 / (1.2 * 2^EV100), so the stops are -EV100 - log2(1.2).
    expect(camera.exposureStops).toBeCloseTo(-camera.ev100 - Math.log2(1.2), 12);
  });

  it('keeps the exposure of the EV100 in stops in relative mode, against the defaults', () => {
    const camera = new PhysicalCamera(40, 1, { fStop: 16, shutterSpeed: 1 / 100, iso: 100 });
    const atDefaults = new PhysicalCamera();
    expect(camera.exposureStops).toBeCloseTo(atDefaults.ev100 - camera.ev100, 12);
  });
});
