// Preloaded into every `bun` run and test (bunfig.toml): `*.shade.ts` imports compile to the
// program the runtime loads, as they do in the browser bundle, so a script can import the engine.
import { plugin } from 'bun';
import { shadePlugin } from './shade-plugin.ts';

plugin(shadePlugin());
