// The demo assets (design record 0010, Part 6, step 6.1). The fetch script checks each file's
// size and SHA-256 against the manifest, refuses a file that differs, and names it. Verifies: Design 0010.30
// (assets fetched at build from pinned URLs, checked by SHA-256). These tests
// use a fake fetch and a temporary folder, so they need no network.

import { describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MANIFEST,
  checkAll,
  fetchAll,
  sha256,
  validateManifest,
  verifyBytes,
} from './fetch-demo-assets.mjs';

type Manifest = {
  version: number;
  source: object;
  assets: {
    id: string;
    files: { path: string; url: string; bytes: number; sha256: string }[];
    licence: { spdx: string[] };
    credit: string[];
  }[];
};
type FileEntry = Manifest['assets'][number]['files'][number];

const payload = new TextEncoder().encode('a demo asset, twelve bytes or so');

function manifestFor(bytes: Uint8Array, path = 'demo/x/one.bin'): Manifest {
  return {
    version: 1,
    source: { repository: 'test', commit: 'test' },
    assets: [
      {
        id: 'one',
        files: [
          {
            path,
            url: 'https://example.invalid/one.bin',
            bytes: bytes.length,
            sha256: sha256(bytes),
          },
        ],
        licence: { spdx: ['CC0-1.0'] },
        credit: ['test'],
      },
    ],
  };
}

describe('the demo assets manifest', () => {
  it('is the file that the script reads, with every field it checks', () => {
    const manifest = validateManifest(
      JSON.parse(readFileSync(MANIFEST, 'utf8')) as never,
    ) as unknown as Manifest;
    const files = manifest.assets.flatMap((a) => a.files);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) expect(file.path.startsWith('demo/')).toBe(true);
  });

  it('refuses a path outside demo/, a path with .., and a URL that is not https', () => {
    const base = manifestFor(payload);
    const with_ = (file: Partial<FileEntry>) => ({
      ...base,
      assets: [{ ...base.assets[0], files: [{ ...base.assets[0].files[0], ...file }] }],
    });
    expect(() => validateManifest(with_({ path: '../etc/passwd' }))).toThrow(/outside demo/);
    expect(() => validateManifest(with_({ path: 'demo/../../x' }))).toThrow(/outside demo/);
    expect(() => validateManifest(with_({ path: '/demo/x' }))).toThrow(/not relative/);
    expect(() => validateManifest(with_({ url: 'http://example.invalid/x' }))).toThrow(/not https/);
  });
});

describe('the SHA-256 check', () => {
  it('accepts the bytes that the manifest records', () => {
    const file: FileEntry = manifestFor(payload).assets[0]!.files[0]!;
    expect(() => verifyBytes(file, payload)).not.toThrow();
  });

  it('refuses a file with one byte changed, and names the file', () => {
    const file: FileEntry = manifestFor(payload).assets[0]!.files[0]!;
    const changed = Uint8Array.from(payload);
    changed[5] ^= 1;
    expect(changed.length).toBe(payload.length);
    expect(() => verifyBytes(file, changed)).toThrow(/demo\/x\/one\.bin: SHA-256 is [0-9a-f]{64}/);
  });

  it('refuses a file of another size, and names the file', () => {
    const file: FileEntry = manifestFor(payload).assets[0]!.files[0]!;
    expect(() => verifyBytes(file, payload.subarray(1))).toThrow(/demo\/x\/one\.bin: \d+ bytes/);
  });
});

describe('fetchAll', () => {
  it('writes each file once, then keeps it without a second download', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-assets-'));
    try {
      const manifest = manifestFor(payload);
      let downloads = 0;
      const fetchBytes = async () => {
        downloads += 1;
        return payload;
      };
      expect(await fetchAll({ manifest, publicDir: dir, fetchBytes })).toEqual([
        { path: 'demo/x/one.bin', status: 'fetched' },
      ]);
      expect(await fetchAll({ manifest, publicDir: dir, fetchBytes })).toEqual([
        { path: 'demo/x/one.bin', status: 'kept' },
      ]);
      expect(downloads).toBe(1);
      expect(readFileSync(join(dir, 'demo/x/one.bin'))).toEqual(Buffer.from(payload));
      expect(checkAll({ manifest, publicDir: dir })).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a download with one byte changed: it names the file and writes nothing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-assets-'));
    try {
      const manifest = manifestFor(payload);
      const tampered = Uint8Array.from(payload);
      tampered[0] ^= 0x80;
      await expect(
        fetchAll({ manifest, publicDir: dir, fetchBytes: async () => tampered }),
      ).rejects.toThrow('demo/x/one.bin: SHA-256 is');
      expect(existsSync(join(dir, 'demo/x/one.bin'))).toBe(false);
      expect(existsSync(join(dir, 'demo/x/one.bin.partial'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fetches again a file on disk that differs from the manifest', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-assets-'));
    try {
      const manifest = manifestFor(payload);
      const target = join(dir, 'demo/x/one.bin');
      mkdirSync(join(dir, 'demo/x'), { recursive: true });
      writeFileSync(target, 'stale bytes that differ in size and content');
      expect(checkAll({ manifest, publicDir: dir })).toHaveLength(1);
      const report = await fetchAll({ manifest, publicDir: dir, fetchBytes: async () => payload });
      expect(report).toEqual([{ path: 'demo/x/one.bin', status: 'fetched' }]);
      expect(checkAll({ manifest, publicDir: dir })).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('check names a missing file and a file with one byte changed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-assets-'));
    try {
      const manifest = manifestFor(payload);
      expect(checkAll({ manifest, publicDir: dir })).toEqual(['demo/x/one.bin: missing']);
      mkdirSync(join(dir, 'demo/x'), { recursive: true });
      const changed = Uint8Array.from(payload);
      changed[1] ^= 1;
      writeFileSync(join(dir, 'demo/x/one.bin'), changed);
      const problems = checkAll({ manifest, publicDir: dir });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('demo/x/one.bin: SHA-256 is');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
