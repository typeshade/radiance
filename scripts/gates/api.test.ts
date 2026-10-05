// The api gate must see a fault before it is trusted to see none (record 0002, "The probes":
// a surface bake with one line removed is a diff). These tests run in `bun run test`, with no
// browser. This test verifies none of the decisions for the owner in record 0003, so it carries
// no tag for one: the bake is step 1 of that record, and no decision is about the bake.
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  ROOT,
  SCRIPT,
  bakeSurfaces,
  exportsOfEntry,
  publicPackages,
  surfaceFile,
  writeSurfaces,
} from '../bake-api-surface.ts';
import { diffSurface, probe, run } from './api.mjs';

/** A bake reads the whole TypeScript program, so a test may take longer than bun's default. */
const SLOW = 60_000;

const scratch = mkdtempSync(join(tmpdir(), 'radiance-api-test-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A tree with one package, `demo`, whose entry is `src/index.ts`. */
function demoTree(name: string, files: Record<string, string>): string {
  const root = join(scratch, name);
  const put = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  put(
    'packages/demo/package.json',
    JSON.stringify({ name: '@demo/demo', exports: { '.': './src/index.ts' } }),
  );
  for (const [path, text] of Object.entries(files)) put(`packages/demo/${path}`, text);
  return root;
}

const lineOf = (text: string, name: string): string =>
  text.split('\n').find((l) => l.startsWith(`${name}  `)) ?? '';

describe('diffSurface', () => {
  const head = 'header\n```\n';
  const tail = '```\n';
  const a = 'A  class  new (x: number): A; { x: number }';
  const b = 'B  const  4';

  test('equal texts have no difference', () => {
    expect(diffSurface(`${head}${a}\n${b}\n${tail}`, `${head}${a}\n${b}\n${tail}`)).toEqual([]);
  });
  test('a removed line is a difference', () => {
    expect(diffSurface(`${head}${a}\n${b}\n${tail}`, `${head}${a}\n${tail}`)).toEqual([`- ${b}`]);
  });
  test('an added line is a difference', () => {
    expect(diffSurface(`${head}${a}\n${tail}`, `${head}${a}\n${b}\n${tail}`)).toEqual([`+ ${b}`]);
  });
  test('a name with another type is one change, with the place it moved', () => {
    const moved = 'A  class  new (x: string): A; { x: string }';
    const report = diffSurface(`${head}${a}\n${tail}`, `${head}${moved}\n${tail}`);
    expect(report[0]).toBe('~ A');
    expect(report[1]).toContain('committed:');
    expect(report[1]).toContain('x: number');
    expect(report[2]).toContain('x: string');
  });
  test('the same lines in another order are a difference', () => {
    expect(diffSurface(`${head}${a}\n${b}\n${tail}`, `${head}${b}\n${a}\n${tail}`)).toEqual([
      'the same lines, in another order',
    ]);
  });
});

describe('the reader', () => {
  const root = demoTree('reader', {
    'src/index.ts': [
      `export { Shape as Renamed, type Options } from './shape.ts';`,
      `export { Base, Mode, LIMIT, add, Palette } from './more.ts';`,
    ].join('\n'),
    'src/shape.ts': `
      export class Shape<T extends object = object> {
        static readonly unit: number = 1;
        static make(): Shape { return new Shape(0); }
        readonly size: number;
        label?: string | number;
        #secret = 1;
        private hidden = 2;
        protected guarded = 3;
        constructor(size: number, label?: string) { this.size = size; this.label = label; }
        get area(): number { return this.size; }
        scale(by: number): this { return this; }
      }
      export interface Options { a?: number; b: 'x' | 'y' | 'a' }
    `,
    'src/more.ts': `
      export abstract class Base { abstract readonly kind: number; }
      export type Mode = 'z' | 'b' | 'a';
      export const LIMIT = 4;
      export function add(a: number, b = 1): number { return a + b; }
      export enum Palette { Red, Green = 5 }
    `,
  });
  const [surface] = bakeSurfaces(root);

  test(
    'one line for each name, sorted by name',
    () => {
      const names = surface!.exports.map((e) => e.name);
      expect(names).toEqual(['Base', 'LIMIT', 'Mode', 'Options', 'Palette', 'Renamed', 'add']);
      expect(surface!.text).toContain('## 7 exports');
    },
    SLOW,
  );

  test(
    'a class line has its constructor, its statics and its members',
    () => {
      const line = lineOf(surface!.text, 'Renamed');
      expect(line).toContain('Renamed  class  <T extends object = object>; ');
      expect(line).toContain(
        'new <T extends object = object>(size: number, label?: string | undefined): Shape<T>',
      );
      expect(line).toContain('static { make: () => Shape<object>; readonly unit: number }');
      expect(line).toContain('readonly area: number');
      expect(line).toContain('label?: number | string');
      expect(line).toContain('scale: (by: number) => this');
      expect(line).toContain('protected guarded: number');
    },
    SLOW,
  );

  test(
    'a private member is not listed',
    () => {
      const line = lineOf(surface!.text, 'Renamed');
      expect(line).not.toContain('secret');
      expect(line).not.toContain('hidden');
    },
    SLOW,
  );

  test(
    'an abstract class, a union, a constant, a function and an enum',
    () => {
      expect(lineOf(surface!.text, 'Base')).toBe(
        'Base  abstract class  new (): Base; { abstract readonly kind: number }',
      );
      expect(lineOf(surface!.text, 'Mode')).toBe('Mode  type  "a" | "b" | "z"');
      expect(lineOf(surface!.text, 'Options')).toBe(
        'Options  interface  { a?: number; b: "a" | "x" | "y" }',
      );
      expect(lineOf(surface!.text, 'LIMIT')).toBe('LIMIT  const  4');
      expect(lineOf(surface!.text, 'add')).toBe('add  function  (a: number, b?: number) => number');
      expect(lineOf(surface!.text, 'Palette')).toBe('Palette  enum  { Red = 0; Green = 5 }');
    },
    SLOW,
  );

  test(
    'a package that exports nothing is a failure of the reader',
    () => {
      const empty = demoTree('empty', { 'src/index.ts': 'export {};\n' });
      expect(() => bakeSurfaces(empty)).toThrow(/found no exports/);
    },
    SLOW,
  );

  test(
    'an entry that does not exist is a failure of the reader',
    () => {
      expect(() => exportsOfEntry(join(scratch, 'nowhere', 'index.ts'))).toThrow(/no such file/);
    },
    SLOW,
  );
});

describe('the gate on a tree', () => {
  test(
    'a changed constructor parameter is a difference',
    async () => {
      const source = (type: string) =>
        `export class A { constructor(readonly size: ${type}) {} }\n`;
      const root = demoTree('gate', { 'src/index.ts': source('number') });
      writeSurfaces(bakeSurfaces(root), root);
      const same = await run({ root });
      expect(same.ok).toBe(true);
      writeFileSync(join(root, 'packages/demo/src/index.ts'), source('string'));
      const changed = await run({ root });
      expect(changed.ok).toBe(false);
      expect(changed.numbers.differing).toBe(1);
      expect(changed.message).toContain('~ A');
      expect(changed.message).toContain('bun run bake:api-surface');
    },
    SLOW,
  );

  test(
    'a missing bake is a difference',
    async () => {
      const root = demoTree('missing', { 'src/index.ts': 'export const x = 1;\n' });
      const result = await run({ root });
      expect(result.ok).toBe(false);
      expect(result.message).toContain('packages/demo/__api__/surface.md is missing');
    },
    SLOW,
  );
});

describe('the committed bake', () => {
  test(
    'equals a fresh bake of this tree',
    async () => {
      const result = await run();
      expect(result.message).toStartWith('api: the committed bake equals a fresh bake');
      expect(result.ok).toBe(true);
      expect(result.numbers.differing).toBe(0);
    },
    SLOW,
  );

  test('the reader sees a plausible number of exports in each package', async () => {
    // The floors are well under the real counts, so a removal fails in the bake's diff, which
    // names the line. These floors fail only when the reader itself is broken.
    const floor: Record<string, number> = { 'packages/radiance': 20, 'packages/addons': 3 };
    for (const pkg of publicPackages()) {
      const count = readFileSync(join(ROOT, surfaceFile(pkg.dir)), 'utf8').match(
        /^## (\d+) exports$/m,
      );
      expect(Number(count?.[1])).toBeGreaterThanOrEqual(floor[pkg.dir] ?? 1);
    }
    expect(publicPackages().map((p) => p.dir)).toEqual(['packages/addons', 'packages/radiance']);
  });

  test('each file names its generator and lists its names sorted', () => {
    for (const pkg of publicPackages()) {
      const text = readFileSync(join(ROOT, surfaceFile(pkg.dir)), 'utf8');
      expect(text).toContain(`Generated file: \`${SCRIPT}\` writes it`);
      const lines = text.split('\n');
      const open = lines.indexOf('```');
      const body = lines.slice(open + 1, lines.indexOf('```', open + 1));
      const names = body.map((l) => l.split('  ')[0]!);
      expect(names.length).toBeGreaterThan(0);
      expect(names).toEqual([...names].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)));
      for (const l of body) expect(l.split('  ').length).toBeGreaterThanOrEqual(3);
      expect(text).not.toContain('import("');
    }
  });
});

describe('the probe', () => {
  test(
    'the gate fails when one export line of the committed bake is removed',
    async () => {
      await probe();
    },
    SLOW,
  );
});
