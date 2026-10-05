// === The determinism gate: one seed renders one image, bit for bit ===
//
// Two renders of one seed are bit-identical and another seed differs, on every scene of the
// differential gate (docs/design/0002-verification.md). The renderer promises the same image for
// the same seed (docs/design/0005-determinism.md). Run it alone with `bun run gate:determinism`.
//
// `run(options)` renders `options.scene` (the Cornell box when none is named) at its gated size,
// twice with its seed and once with the next, and answers `{ ok, numbers, message }`. `numbers`:
//
//   floats              the floats of one render (four a pixel).
//   differing           the floats that differ between the two renders of one seed. It is 0.
//   otherSeedDiffering  the floats that differ between the first seed and the next.
//
// `probe()` compares a render of seed 2 with one of seed 1 as if they were two renders of one
// seed, and throws when the gate does not fail.
//
// Options: `scene` names a key of `SCENES` in ./differential.mjs. `session` is an open render
// page (`openRenderPage` in ./_browser.mjs). Without one, the gate opens its own.

import { withRenderPage } from './_browser.mjs';
import { gatedScene } from './differential.mjs';

/** How many floats of `a` and `b` differ, and the index of the first. A float is the same as
 *  another when `Object.is` says so, so a NaN equals a NaN and 0 differs from -0. */
export function bitwiseDifference(a, b) {
  let differing = 0;
  let first = -1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (Object.is(a[i], b[i])) continue;
    if (first < 0) first = i;
    differing++;
  }
  return { differing, first };
}

/** Holds three renders (`first` and `again` of one seed, `other` of the next) to the gate:
 *  `first` and `again` are bit-identical, `other` differs, and every pixel has the gated
 *  samples. Each render is the array of RGBA floats `readRadiance()` gives. */
export function judge({ first, again, other }, gate) {
  const floats = gate.size[0] * gate.size[1] * 4;
  const problems = [];
  if (first.length !== floats) problems.push(`read ${first.length} floats, expected ${floats}`);
  const repeat = bitwiseDifference(first, again);
  if (repeat.differing > 0)
    problems.push(
      `two renders of seed ${gate.seed} differ at float ${repeat.first}: ${first[repeat.first]} and ${again[repeat.first]}`,
    );
  const changed = bitwiseDifference(first, other);
  if (changed.differing === 0)
    problems.push(`seeds ${gate.seed} and ${gate.seed + 1} render the same image`);
  for (let p = 0; p < floats / 4; p++)
    if (first[p * 4 + 3] !== gate.samples) {
      problems.push(`pixel ${p} has ${first[p * 4 + 3]} samples, expected ${gate.samples}`);
      break;
    }
  const summary = `determinism: ${floats} floats, ${repeat.differing} differ between two renders of seed ${gate.seed}, ${changed.differing} differ from seed ${gate.seed + 1}`;
  return {
    ok: problems.length === 0,
    numbers: { floats, differing: repeat.differing, otherSeedDiffering: changed.differing },
    message: [summary, ...problems].join('\n'),
  };
}

/** Renders the scene twice with its seed and once with the next, and judges the three. */
export async function run(options = {}) {
  const name = options.scene ?? 'cornell';
  const { gate } = gatedScene(name);
  return withRenderPage(options, async (session) => {
    const render = async (seed) => (await session.render({ ...gate, scene: name, seed })).radiance;
    const first = await render(gate.seed);
    const again = await render(gate.seed);
    const other = await render(gate.seed + 1);
    return judge({ first, again, other }, gate);
  });
}

/** Judges a render of seed 2 as the second render of seed 1, which must fail. Throws when it
 *  does not. Answers `{ ok: true, numbers, message }` of the failure it saw. */
export async function probe(options = {}) {
  const name = options.scene ?? 'cornell';
  const { gate } = gatedScene(name);
  return withRenderPage(options, async (session) => {
    const render = async (seed) => (await session.render({ ...gate, scene: name, seed })).radiance;
    const first = await render(gate.seed);
    const wrong = await render(gate.seed + 1);
    const result = judge({ first, again: wrong, other: wrong }, gate);
    if (result.ok || result.numbers.differing === 0)
      throw new Error(
        `the determinism gate does not fail the bit-identity of a render of seed ${gate.seed + 1} against one of seed ${gate.seed}, so it cannot see two renders that differ`,
      );
    return {
      ok: true,
      numbers: result.numbers,
      message: `a render of seed ${gate.seed + 1} judged as a second render of seed ${gate.seed} fails the bit-identity, as it must: ${result.numbers.differing} of ${result.numbers.floats} floats differ`,
    };
  });
}

if (import.meta.main) {
  const result = await run();
  (result.ok ? console.log : console.error)(result.message);
  process.exit(result.ok ? 0 : 1);
}
