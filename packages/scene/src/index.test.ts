import { describe, expect, it } from 'bun:test';
import { cameraParams, cornellBox, packScene, type Scene } from './index.ts';

describe('packScene', () => {
  it('lays the Cornell box out as trace.shade.ts reads it', () => {
    const box = cornellBox();
    const p = packScene(box);
    expect(p.counts).toEqual([2, 6, 1]);
    expect(p.spheres.length).toBe(16);
    expect(Array.from(p.spheres.slice(0, 5))).toEqual([-0.45, 0.4, -0.35, 0.4, 4].map(Math.fround));
    expect(p.quads.length).toBe(72);
    expect(Array.from(p.lights)).toEqual([5]);
    // The light's material emits, and its front face points down, into the box.
    const light = p.quads.slice(60, 72);
    expect(light[3]).toBe(3);
    const [ux, uy, uz, , vx, vy, vz] = [...light.slice(4, 7), 0, ...light.slice(8, 11)];
    expect([uy! * vz! - uz! * vy!, uz! * vx! - ux! * vz!, ux! * vy! - uy! * vx!][1]).toBeLessThan(
      0,
    );
    // The mirror's kind is 1, a diffuse material's 0.
    expect(p.materials[4 * 8 + 3]).toBe(1);
    expect(p.materials[3]).toBe(0);
  });

  it('pads empty lists to one element, since WebGPU binds no empty buffer', () => {
    const empty: Scene = { ...cornellBox(), spheres: [], quads: [] };
    const p = packScene(empty);
    expect(p.counts).toEqual([0, 0, 0]);
    expect(p.spheres.length).toBe(8);
    expect(p.quads.length).toBe(12);
    expect(p.lights.length).toBe(1);
  });

  it('refuses a material index the scene does not have', () => {
    const bad: Scene = {
      ...cornellBox(),
      spheres: [{ centre: [0, 0, 0], radius: 1, material: 9 }],
    };
    expect(() => packScene(bad)).toThrow('sphere 0: material 9');
  });
});

describe('cameraParams', () => {
  it('gives an orthonormal frame and the field of view as tangents', () => {
    const c = cameraParams(cornellBox().camera, 200, 100);
    const dot = (a: readonly number[], b: readonly number[]) =>
      a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
    expect(dot(c.forward, c.forward)).toBeCloseTo(1, 12);
    expect(dot(c.right, c.right)).toBeCloseTo(1, 12);
    expect(dot(c.up, c.up)).toBeCloseTo(1, 12);
    expect(dot(c.forward, c.right)).toBeCloseTo(0, 12);
    expect(dot(c.forward, c.up)).toBeCloseTo(0, 12);
    expect(c.lens[1]).toBeCloseTo(Math.tan((40 * Math.PI) / 360), 12);
    expect(c.lens[0]).toBeCloseTo(2 * c.lens[1], 12);
    // Looking down -z with y up, right is +x.
    expect(c.right[0]).toBeCloseTo(1, 12);
  });
});
