// `bun scripts/bundle.ts <entry> <outfile>`: bundles a package for the browser, its shader
// modules compiled by the typeshade loader (scripts/shade-plugin.ts).

import { shadePlugin } from './shade-plugin.ts';

const [entry, outfile] = process.argv.slice(2);
if (entry === undefined || outfile === undefined) {
  console.error('usage: bun scripts/bundle.ts <entry> <outfile>');
  process.exit(2);
}
const result = await Bun.build({
  entrypoints: [entry],
  target: 'browser',
  format: 'esm',
  plugins: [shadePlugin()],
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
await Bun.write(outfile, result.outputs[0]!);
