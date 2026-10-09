// === The demo assets: fetched at build from pinned URLs, checked by SHA-256, never committed ===
//
// `node scripts/fetch-demo-assets.mjs` reads `site/demo-assets.json` and writes each file under
// `site/public/demo/`. It downloads a file only when the file is absent or its bytes differ from
// the manifest. A download is checked before it is written: its size and its SHA-256 must match
// the manifest, or the script stops and names the file, and nothing is written for that file.
//
// `--check` reads the files that are already present and checks each one. It makes no network
// request, and it fails when a file is missing or differs.
//
// The assets are the glTF Sample Assets of record 0010, Part 6, the Poly Haven HDRI, and their
// licences and credits. The manifest holds them. `site/public/demo/` is in `.gitignore`, so no
// asset is committed. The script uses no library: only `node:` modules and `fetch`.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MANIFEST = fileURLToPath(new URL('../site/demo-assets.json', import.meta.url));
/** The folder that the site serves. A manifest path is relative to it, and starts with `demo/`. */
export const PUBLIC_DIR = fileURLToPath(new URL('../site/public/', import.meta.url));

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Throws when the manifest is not the shape this script reads. Names the field that is wrong. */
export function validateManifest(manifest) {
  if (manifest?.version !== 1) throw new Error('the manifest version is not 1');
  if (!Array.isArray(manifest.assets) || manifest.assets.length === 0) {
    throw new Error('the manifest has no assets');
  }
  for (const asset of manifest.assets) {
    if (!asset.id || !Array.isArray(asset.files) || asset.files.length === 0) {
      throw new Error(`asset ${asset.id ?? '(no id)'} has no files`);
    }
    if (!asset.licence?.spdx?.length) throw new Error(`asset ${asset.id} has no licence`);
    if (!asset.credit?.length) throw new Error(`asset ${asset.id} has no credit`);
    for (const file of asset.files) {
      const where = `${asset.id}: ${file.path ?? '(no path)'}`;
      if (typeof file.path !== 'string' || isAbsolute(file.path)) {
        throw new Error(`${where}: the path is not relative`);
      }
      const path = normalize(file.path).replaceAll('\\', '/');
      if (!path.startsWith('demo/') || path.split('/').includes('..')) {
        throw new Error(`${where}: the path is outside demo/`);
      }
      if (!/^https:\/\//.test(file.url ?? '')) throw new Error(`${where}: the URL is not https`);
      if (!Number.isInteger(file.bytes) || file.bytes <= 0) {
        throw new Error(`${where}: the size is not a positive integer`);
      }
      if (!/^[0-9a-f]{64}$/.test(file.sha256 ?? '')) throw new Error(`${where}: no SHA-256`);
    }
  }
  return manifest;
}

/** Throws, naming the file, when `bytes` differ from the manifest entry in size or SHA-256. */
export function verifyBytes(file, bytes) {
  if (bytes.length !== file.bytes) {
    throw new Error(`${file.path}: ${bytes.length} bytes, the manifest says ${file.bytes}`);
  }
  const sum = sha256(bytes);
  if (sum !== file.sha256) {
    throw new Error(`${file.path}: SHA-256 is ${sum}, the manifest says ${file.sha256}`);
  }
}

/** The file of a manifest entry, under `publicDir`. */
export const targetOf = (file, publicDir = PUBLIC_DIR) => join(publicDir, file.path);

async function defaultFetch(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Makes every file of the manifest present and verified. Returns one line per file:
 * `{ path, status }`, where status is `kept` (already present and verified) or `fetched`.
 * Throws at the first file that does not verify. That file is not written.
 */
export async function fetchAll({ manifest, publicDir = PUBLIC_DIR, fetchBytes = defaultFetch }) {
  validateManifest(manifest);
  const report = [];
  for (const asset of manifest.assets) {
    for (const file of asset.files) {
      const target = targetOf(file, publicDir);
      if (existsSync(target)) {
        try {
          verifyBytes(file, readFileSync(target));
          report.push({ path: file.path, status: 'kept' });
          continue;
        } catch {
          // The file on disk differs from the manifest. Fetch it again.
        }
      }
      const bytes = await fetchBytes(file.url);
      verifyBytes(file, bytes);
      mkdirSync(dirname(target), { recursive: true });
      const partial = `${target}.partial`;
      writeFileSync(partial, bytes);
      renameSync(partial, target);
      report.push({ path: file.path, status: 'fetched' });
    }
  }
  return report;
}

/** Checks the files already present. Returns the paths that are missing or differ. */
export function checkAll({ manifest, publicDir = PUBLIC_DIR }) {
  validateManifest(manifest);
  const problems = [];
  for (const asset of manifest.assets) {
    for (const file of asset.files) {
      const target = targetOf(file, publicDir);
      try {
        if (!existsSync(target)) throw new Error(`${file.path}: missing`);
        verifyBytes(file, readFileSync(target));
      } catch (error) {
        problems.push(error.message);
      }
    }
  }
  return problems;
}

if (import.meta.main) {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  if (process.argv.includes('--check')) {
    const problems = checkAll({ manifest });
    if (problems.length > 0) {
      for (const problem of problems) console.error(problem);
      process.exit(1);
    }
    console.log(`every demo asset matches the manifest (${manifest.assets.length} assets)`);
  } else {
    try {
      for (const { path, status } of await fetchAll({ manifest })) {
        console.log(`${status.padEnd(7)} ${path}`);
      }
    } catch (error) {
      console.error(error.message);
      process.exit(1);
    }
  }
}
