// The stills under site/public/stills: one image per example, captured by
// scripts/capture-stills.mjs and committed beside a .sha256 of its bytes. The build (the
// `radiance:stills` hook in site/astro.config.mjs) checks every example has a still whose hash
// matches, so a page never shows an empty frame and a changed still is a deliberate commit.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export const STILL_FORMAT = 'webp';

/** The example ids: every `site/examples/<id>.ts` that is an example, in name order. */
export function exampleIds(siteRoot) {
  return readdirSync(path.join(siteRoot, 'examples'))
    .filter((f) => f.endsWith('.ts') && !['index.ts', 'types.ts'].includes(f))
    .map((f) => f.slice(0, -3))
    .sort();
}

export function stillPath(siteRoot, id) {
  return path.join(siteRoot, 'public/stills', `${id}.${STILL_FORMAT}`);
}

export function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/** Throws when an example has no still, or its still's bytes differ from the committed hash.
 *  STILLS_REBASELINE=1 skips the check, for the build scripts/capture-stills.mjs captures from. */
export function verifyStills(siteRoot) {
  if (process.env.STILLS_REBASELINE === '1') return;
  const problems = [];
  for (const id of exampleIds(siteRoot)) {
    const file = stillPath(siteRoot, id);
    const sum = `${file}.sha256`;
    if (!existsSync(file)) {
      problems.push(`no still for '${id}': run bun run capture:stills`);
      continue;
    }
    if (!existsSync(sum)) {
      problems.push(`no hash for '${id}': run bun run capture:stills and commit the .sha256`);
      continue;
    }
    if (readFileSync(sum, 'utf8').trim() !== sha256(file))
      problems.push(`the still for '${id}' does not match its .sha256: recapture it or restore it`);
  }
  if (problems.length > 0) throw new Error(`[stills]\n${problems.join('\n')}`);
}
