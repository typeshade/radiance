// The geometries on the host: what each tessellator builds and what BufferGeometry computes.
// three.js is not a dependency, so each number held to three.js's was worked out by hand from the
// algorithm named beside it. A scratch script, kept out of the repository, compared these classes
// with three.js 0.186.1 for 14 parameter sets. Every position, normal, uv and index was equal.
// Design record 0003, decision 5: `QuadGeometry` is renamed `PlaneGeometry` without a shim, so no
// test names `QuadGeometry`. The surface bake (`bun run gate:api`) holds that no export has it.

import { describe, expect, it } from 'bun:test';
import { BoxGeometry } from './BoxGeometry.ts';
import { BufferGeometry } from './BufferGeometry.ts';
import { PlaneGeometry } from './PlaneGeometry.ts';
import { SphereGeometry } from './SphereGeometry.ts';

/** Float32 rounds 0.1 and its kin, so a number held to a literal is held to this many digits. */
const DIGITS = 6;

const close = (actual: ArrayLike<number>, expected: readonly number[]): void => {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) expect(actual[i]).toBeCloseTo(expected[i]!, DIGITS);
};

/** Each triangle's counter-clockwise normal (not unit length) and its centroid. */
function triangles(g: BufferGeometry): { normal: number[]; centroid: number[] }[] {
  const p = g.position;
  const at = (i: number) => [p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!];
  const out = [];
  for (let t = 0; t < g.index.length; t += 3) {
    const [a, b, c] = [at(g.index[t]!), at(g.index[t + 1]!), at(g.index[t + 2]!)] as [
      number[],
      number[],
      number[],
    ];
    const e1 = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
    const e2 = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
    out.push({
      normal: [
        e1[1]! * e2[2]! - e1[2]! * e2[1]!,
        e1[2]! * e2[0]! - e1[0]! * e2[2]!,
        e1[0]! * e2[1]! - e1[1]! * e2[0]!,
      ],
      centroid: [0, 1, 2].map((k) => (a[k]! + b[k]! + c[k]!) / 3),
    });
  }
  return out;
}

const dot = (a: readonly number[], b: readonly number[]): number =>
  a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

/** Every triangle is counter-clockwise seen from outside a shape that holds the origin. */
function expectOutwardWinding(g: BufferGeometry): void {
  for (const { normal, centroid } of triangles(g)) expect(dot(normal, centroid)).toBeGreaterThan(0);
}

/** Every normal has unit length, and points away from the origin where its vertex is. */
function expectOutwardNormals(g: BufferGeometry): void {
  const n = g.normal!;
  const p = g.position;
  expect(n.length).toBe(p.length);
  for (let v = 0; v < p.length; v += 3) {
    expect(Math.hypot(n[v]!, n[v + 1]!, n[v + 2]!)).toBeCloseTo(1, DIGITS);
    expect(dot([n[v]!, n[v + 1]!, n[v + 2]!], [p[v]!, p[v + 1]!, p[v + 2]!])).toBeGreaterThan(0);
  }
}

describe('BufferGeometry', () => {
  it('starts empty, with no normal and no uv', () => {
    const g = new BufferGeometry();
    expect(g.type).toBe('BufferGeometry');
    expect(g.position.length).toBe(0);
    expect(g.index.length).toBe(0);
    expect(g.normal).toBeUndefined();
    expect(g.uv).toBeUndefined();
    expect(g.version).toBe(0);
  });

  it('adds 1 to version in the setter of each attribute', () => {
    const g = new BufferGeometry();
    g.position = Float32Array.of(0, 0, 0);
    expect(g.version).toBe(1);
    g.index = Uint32Array.of(0, 0, 0);
    expect(g.version).toBe(2);
    g.normal = Float32Array.of(0, 0, 1);
    expect(g.version).toBe(3);
    g.uv = Float32Array.of(0, 0);
    expect(g.version).toBe(4);
    g.normal = undefined;
    expect(g.version).toBe(5);
    expect(g.normal).toBeUndefined();
  });

  it('leaves version to the author after an edit in place', () => {
    const g = new BufferGeometry();
    g.position = Float32Array.of(0, 0, 0);
    const before = g.version;
    g.position[0] = 1;
    expect(g.version).toBe(before);
    g.version++;
    expect(g.version).toBe(before + 1);
  });

  it('computes the unit normal of a lone triangle, and returns itself', () => {
    const g = new BufferGeometry();
    g.position = Float32Array.of(0, 0, 0, 3, 0, 0, 0, 5, 0);
    g.index = Uint32Array.of(0, 1, 2);
    const before = g.version;
    expect(g.computeVertexNormals()).toBe(g);
    close(g.normal!, [0, 0, 1, 0, 0, 1, 0, 0, 1]);
    expect(g.version).toBe(before + 1);
  });

  it('weights the normals of a shared vertex by triangle area', () => {
    // Vertex 0 is shared. Triangle (0, 1, 2) is in the xy plane with area 2 and faces +z.
    // Triangle (0, 3, 4) is in the xz plane with area 0.5 and faces -y.
    const g = new BufferGeometry();
    g.position = Float32Array.of(0, 0, 0, 2, 0, 0, 0, 2, 0, 1, 0, 0, 0, 0, 1);
    g.index = Uint32Array.of(0, 1, 2, 0, 3, 4);
    g.computeVertexNormals();
    // The sum is 2 * (0, 0, 1) + 0.5 * (0, -1, 0) times 2 (the cross product is twice the area).
    const length = Math.hypot(0.5, 2);
    close(g.normal!.subarray(0, 3), [0, -0.5 / length, 2 / length]);
    close(g.normal!.subarray(3, 6), [0, 0, 1]);
    close(g.normal!.subarray(9, 12), [0, -1, 0]);
  });

  it('gives a vertex that no triangle uses the normal (0, 0, 0)', () => {
    const g = new BufferGeometry();
    g.position = Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 5, 5);
    g.index = Uint32Array.of(0, 1, 2);
    g.computeVertexNormals();
    close(g.normal!.subarray(9, 12), [0, 0, 0]);
  });

  it('recomputes the normals of a sphere that has none, close to the radial direction', () => {
    const g = new SphereGeometry(2, 32, 16);
    const exact = g.normal!;
    g.normal = undefined;
    g.computeVertexNormals();
    const used = new Set(g.index);
    const n = g.normal!;
    for (const v of used) {
      expect(Math.hypot(n[v * 3]!, n[v * 3 + 1]!, n[v * 3 + 2]!)).toBeCloseTo(1, DIGITS);
      const radial = [exact[v * 3]!, exact[v * 3 + 1]!, exact[v * 3 + 2]!];
      expect(dot([n[v * 3]!, n[v * 3 + 1]!, n[v * 3 + 2]!], radial)).toBeGreaterThan(0.99);
    }
  });

  it('computes the box around the positions, and an empty box for none', () => {
    const g = new BufferGeometry();
    const empty = g.computeBoundingBox();
    expect(empty.min.x).toBe(Infinity);
    expect(empty.max.x).toBe(-Infinity);
    g.position = Float32Array.of(1, -2, 3, -4, 5, -6, 0, 0, 0);
    const box = g.computeBoundingBox();
    expect(box.min.toArray()).toEqual([-4, -2, -6]);
    expect(box.max.toArray()).toEqual([1, 5, 3]);
  });
});

describe('SphereGeometry', () => {
  // three.js's SphereGeometry: (widthSegments + 1) * (heightSegments + 1) vertices, and two
  // triangles for each cell except one in each cell of the first and of the last row.
  it('has three.js counts for the default 32 by 16 segments', () => {
    const g = new SphereGeometry();
    expect(g.type).toBe('SphereGeometry');
    expect(g.radius).toBe(1);
    expect(g.position.length / 3).toBe(33 * 17);
    expect(g.normal!.length / 3).toBe(33 * 17);
    expect(g.uv!.length / 2).toBe(33 * 17);
    expect(g.index.length / 3).toBe(2 * 32 * 16 - 2 * 32);
  });

  it('has three.js counts for another number of segments', () => {
    const g = new SphereGeometry(1, 4, 2);
    expect(g.position.length / 3).toBe(15);
    expect(g.index.length / 3).toBe(8);
  });

  it('clamps the segments to three.js bounds and rounds them down', () => {
    const small = new SphereGeometry(1, 1, 1);
    expect([small.widthSegments, small.heightSegments]).toEqual([3, 2]);
    expect(small.position.length / 3).toBe(4 * 3);
    const fractional = new SphereGeometry(1, 4.9, 2.9);
    expect(fractional.position).toEqual(new SphereGeometry(1, 4, 2).position);
  });

  it('puts its normals out, at unit length, along the radius', () => {
    const g = new SphereGeometry(2.5, 32, 16);
    expectOutwardNormals(g);
    for (let v = 0; v < g.position.length; v += 3) {
      expect(Math.hypot(g.position[v]!, g.position[v + 1]!, g.position[v + 2]!)).toBeCloseTo(
        2.5,
        DIGITS,
      );
      for (let k = 0; k < 3; k++)
        expect(g.normal![v + k]).toBeCloseTo(g.position[v + k]! / 2.5, DIGITS);
    }
  });

  it('winds every triangle counter-clockwise seen from outside', () => {
    expectOutwardWinding(new SphereGeometry(1, 32, 16));
    expectOutwardWinding(new SphereGeometry(1, 3, 2));
  });

  // Worked from three.js's algorithm for SphereGeometry(1, 4, 2), the whole sphere:
  //   for iy in 0..2 and ix in 0..4: u = ix / 4, v = iy / 2, phi = u * 2 * pi, y = cos(v * pi),
  //   ring = sqrt(1 - y * y), position = (-ring cos(phi), y, ring sin(phi)),
  //   uv = (u + uOffset, 1 - v), where uOffset is +0.5 / 4 in row 0, -0.5 / 4 in row 2, else 0.
  //   For each cell (a, b, c, d) = (g[iy][ix + 1], g[iy][ix], g[iy + 1][ix], g[iy + 1][ix + 1]):
  //   triangle (a, b, d) unless iy is 0, and triangle (b, c, d) unless iy is the last row.
  describe('with 4 by 2 segments, against three.js', () => {
    const g = new SphereGeometry(1, 4, 2);

    it('lays out the uv as three.js does, with the poles shifted by half a segment', () => {
      close(
        g.uv!,
        [
          // iy = 0, the top pole: u + 0.125, v = 1
          0.125, 1, 0.375, 1, 0.625, 1, 0.875, 1, 1.125, 1,
          // iy = 1, the equator: u, v = 0.5
          0, 0.5, 0.25, 0.5, 0.5, 0.5, 0.75, 0.5, 1, 0.5,
          // iy = 2, the bottom pole: u - 0.125, v = 0
          -0.125, 0, 0.125, 0, 0.375, 0, 0.625, 0, 0.875, 0,
        ],
      );
    });

    it('lists the vertices in three.js order', () => {
      close(
        g.position,
        [
          // the top pole, five times
          0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
          // the equator, from -x through +z, +x and -z back to -x
          -1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, -1, -1, 0, 0,
          // the bottom pole, five times
          0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
        ],
      );
    });

    it('lists the triangles in three.js order', () => {
      expect(Array.from(g.index)).toEqual([
        // row 0: (b, c, d) only
        0, 5, 6, 1, 6, 7, 2, 7, 8, 3, 8, 9,
        // row 1: (a, b, d) only
        6, 5, 11, 7, 6, 12, 8, 7, 13, 9, 8, 14,
      ]);
    });
  });

  it('has three.js uv at the corners of the default sphere', () => {
    const g = new SphereGeometry();
    const uvAt = (iy: number, ix: number) =>
      Array.from(g.uv!.subarray((iy * 33 + ix) * 2).slice(0, 2));
    // The first vertex: u = 0 plus half a segment (0.5 / 32), v = 1.
    expect(uvAt(0, 0)).toEqual([0.015625, 1]);
    // A quarter around and a quarter down: u = 8 / 32, v = 1 - 4 / 16.
    expect(uvAt(4, 8)).toEqual([0.25, 0.75]);
    // The last vertex: u = 1 minus half a segment, v = 0.
    expect(uvAt(16, 32)).toEqual([0.984375, 0]);
  });

  it('has a bounding box of plus and minus the radius', () => {
    for (const radius of [1, 2.5, 0.25]) {
      const box = new SphereGeometry(radius).computeBoundingBox();
      for (const k of [0, 1, 2]) {
        expect(box.min.toArray()[k]).toBeCloseTo(-radius, DIGITS);
        expect(box.max.toArray()[k]).toBeCloseTo(radius, DIGITS);
      }
    }
  });
});

describe('PlaneGeometry', () => {
  // three.js's PlaneGeometry(width, height) with one segment each way: four vertices from the top
  // left, row by row, and the triangles (a, b, d) and (b, c, d) with a = 0, b = 2, c = 3, d = 1.
  it('has two triangles on four vertices, as three.js has', () => {
    const g = new PlaneGeometry();
    expect(g.type).toBe('PlaneGeometry');
    expect([g.width, g.height]).toEqual([1, 1]);
    expect(g.position.length / 3).toBe(4);
    expect(g.index.length / 3).toBe(2);
  });

  // Verifies: Design 0001.7
  it('lists the vertices, normals, uv and triangles in three.js order', () => {
    const g = new PlaneGeometry(2, 4);
    close(g.position, [-1, 2, 0, 1, 2, 0, -1, -2, 0, 1, -2, 0]);
    close(g.normal!, [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
    close(g.uv!, [0, 1, 1, 1, 0, 0, 1, 0]);
    expect(Array.from(g.index)).toEqual([0, 2, 1, 2, 3, 1]);
  });

  it('faces +z, at unit length, with both triangles counter-clockwise seen from +z', () => {
    const g = new PlaneGeometry(3, 5);
    for (const { normal } of triangles(g)) {
      expect(normal[0]).toBeCloseTo(0, DIGITS);
      expect(normal[1]).toBeCloseTo(0, DIGITS);
      expect(normal[2]).toBeGreaterThan(0);
    }
    for (let v = 0; v < 12; v += 3) close(g.normal!.subarray(v, v + 3), [0, 0, 1]);
  });

  it('has a bounding box of half the width and half the height', () => {
    const box = new PlaneGeometry(3, 5).computeBoundingBox();
    expect(box.min.toArray()).toEqual([-1.5, -2.5, 0]);
    expect(box.max.toArray()).toEqual([1.5, 2.5, 0]);
  });
});

describe('BoxGeometry', () => {
  // Verifies: Design 0001.7
  it('has 24 vertices and 12 triangles, as three.js has', () => {
    const g = new BoxGeometry();
    expect(g.type).toBe('BoxGeometry');
    expect([g.width, g.height, g.depth]).toEqual([1, 1, 1]);
    expect(g.position.length / 3).toBe(24);
    expect(g.normal!.length / 3).toBe(24);
    expect(g.uv!.length / 2).toBe(24);
    expect(g.index.length / 3).toBe(12);
  });

  it('puts its normals out, at unit length, flat on each face', () => {
    const g = new BoxGeometry(2, 4, 6);
    expectOutwardNormals(g);
    const n = g.normal!;
    for (let face = 0; face < 6; face++)
      for (let k = 1; k < 4; k++)
        expect(Array.from(n.subarray((face * 4 + k) * 3, (face * 4 + k) * 3 + 3))).toEqual(
          Array.from(n.subarray(face * 12, face * 12 + 3)),
        );
  });

  it('winds every triangle counter-clockwise seen from outside', () => {
    expectOutwardWinding(new BoxGeometry(2, 4, 6));
  });

  // Worked from three.js's BoxGeometry(2, 4, 6) with one segment each way. It builds six faces in
  // the order +x, -x, +y, -y, +z, -z with buildPlane(u, v, w, udir, vdir, ...). A face has its
  // four corners from the top left, row by row, and the uv (0, 1), (1, 1), (0, 0), (1, 0).
  describe('with width 2, height 4 and depth 6, against three.js', () => {
    const g = new BoxGeometry(2, 4, 6);

    it('lists the vertices in three.js order', () => {
      close(
        g.position,
        [
          // +x: buildPlane('z', 'y', 'x', -1, -1)
          1, 2, 3, 1, 2, -3, 1, -2, 3, 1, -2, -3,
          // -x: buildPlane('z', 'y', 'x', 1, -1)
          -1, 2, -3, -1, 2, 3, -1, -2, -3, -1, -2, 3,
          // +y: buildPlane('x', 'z', 'y', 1, 1)
          -1, 2, -3, 1, 2, -3, -1, 2, 3, 1, 2, 3,
          // -y: buildPlane('x', 'z', 'y', 1, -1)
          -1, -2, 3, 1, -2, 3, -1, -2, -3, 1, -2, -3,
          // +z: buildPlane('x', 'y', 'z', 1, -1)
          -1, 2, 3, 1, 2, 3, -1, -2, 3, 1, -2, 3,
          // -z: buildPlane('x', 'y', 'z', -1, -1)
          1, 2, -3, -1, 2, -3, 1, -2, -3, -1, -2, -3,
        ],
      );
    });

    it('gives each face the normal of its axis, in three.js order', () => {
      const faces = [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1],
      ];
      close(
        g.normal!,
        faces.flatMap((n) => [...n, ...n, ...n, ...n]),
      );
    });

    it('lays out the same uv on each face', () => {
      const face = [0, 1, 1, 1, 0, 0, 1, 0];
      close(g.uv!, [...face, ...face, ...face, ...face, ...face, ...face]);
    });

    it('lists the triangles of each face as (a, b, d) and (b, c, d)', () => {
      const expected = [0, 1, 2, 3, 4, 5].flatMap((f) => [0, 2, 1, 2, 3, 1].map((i) => i + 4 * f));
      expect(Array.from(g.index)).toEqual(expected);
    });

    it('has a bounding box of half each size', () => {
      const box = g.computeBoundingBox();
      expect(box.min.toArray()).toEqual([-1, -2, -3]);
      expect(box.max.toArray()).toEqual([1, 2, 3]);
    });
  });
});
