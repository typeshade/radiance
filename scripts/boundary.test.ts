// The boundary check must see an offence before it is trusted to see none (the compiler's
// AGENTS.md, "prove the instrument").
import { describe, expect, test } from 'bun:test';
import { offence, sources } from './boundary.mjs';

describe('boundary', () => {
  test('the runtime and a sibling are allowed', () => {
    expect(offence(`import { createRuntime } from 'typeshade/runtime';`)).toBe('');
    expect(offence(`import { bvh } from '@typeshade/radiance-scene';`)).toBe('');
    expect(offence(`import { x } from './x.js';\nexport * from '../y.js';`)).toBe('');
  });
  test('another compiler subpath is an offence', () => {
    expect(offence(`import { compile } from 'typeshade';`)).toMatch(/imports "typeshade"/);
    expect(offence(`export { packModule } from 'typeshade/emit';`)).toMatch(/typeshade\/emit/);
  });
  test('a WebGPU call is an offence, outside comments', () => {
    expect(offence(`const d = await navigator.gpu.requestAdapter();`)).toMatch(/calls WebGPU/);
    expect(offence(`device.createBuffer({ size: 16, usage: 0 });`)).toMatch(/createBuffer/);
    expect(offence(`// device.createBuffer is the runtime's\nconst a = 1;`)).toBe('');
  });
  test('the package sources are read, shaders and tests left out', () => {
    const files = sources('packages/render/src');
    expect(files.some((f: string) => f.endsWith('index.ts'))).toBe(true);
    expect(files.some((f: string) => f.endsWith('.test.ts'))).toBe(false);
  });
});
