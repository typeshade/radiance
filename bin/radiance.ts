// The command `radiance`. Design record 0108, section 4.
import { main } from '../src/cli.ts';

process.exit(await main(process.argv.slice(2)));
