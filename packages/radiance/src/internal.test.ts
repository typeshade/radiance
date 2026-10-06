// The internal subpath and the names (design record 0003, "What is public" and "Names"). The
// public API is what `index.ts` exports. The pack, the limits and the layout constants are
// exported from `internal.ts`, and no name is in both. `QuadGeometry` is renamed `PlaneGeometry`
// without a shim.

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as internal from './internal.ts';
import * as api from './index.ts';

const manifest = JSON.parse(readFileSync(join(import.meta.dir, '../package.json'), 'utf8')) as {
  exports: Record<string, string>;
};

describe('the internal subpath', () => {
  // Verifies: Design 0003.5
  it('leaves QuadGeometry out of the public API, and keeps PlaneGeometry', () => {
    expect(Object.keys(api)).not.toContain('QuadGeometry');
    expect(typeof api.PlaneGeometry).toBe('function');
  });

  it('is an entry of the exports map, beside "."', () => {
    expect(manifest.exports['.']).toBe('./src/index.ts');
    expect(manifest.exports['./internal']).toBe('./src/internal.ts');
  });

  it('exports the scene pack, the limits and the layout constants', () => {
    for (const name of [
      'ScenePack',
      'SCENE_BUFFERS',
      'cameraFrame',
      'DEFAULT_LIMITS',
      'checkStorageBinding',
      'maxStorageBufferBindingSize',
      'NODE_STRIDE',
      'INSTANCE_STRIDE',
    ])
      expect(Object.keys(internal), name).toContain(name);
  });

  it('shares no name with the public API', () => {
    const publicNames = new Set(Object.keys(api));
    expect(Object.keys(internal).filter((name) => publicNames.has(name))).toEqual([]);
  });
});
