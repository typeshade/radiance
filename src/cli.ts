// Design: 0108, section 4. The command of the engine: `radiance sync [--check] <project>...`
// writes the class of each project, and `radiance check <project>...` reads each project and
// writes nothing.

import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { GameConfig } from './config.ts';
import { readProject, syncProject } from './project.ts';

/** Loads the config of a project. */
export async function loadConfig(dir: string): Promise<GameConfig> {
  const module = (await import(pathToFileURL(join(dir, 'radiance.config.ts')).href)) as {
    default?: GameConfig;
  };
  if (module.default === undefined) {
    throw new TypeError(
      `${join(dir, 'radiance.config.ts')}: the file has no default export. Write "export default defineGame({ tick: [...] });".`,
    );
  }
  return module.default;
}

/** Runs the command and returns its exit code. */
export async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  const check = rest.includes('--check');
  const dirs = rest.filter((arg) => !arg.startsWith('--'));
  if ((command !== 'sync' && command !== 'check') || dirs.length === 0) {
    console.error(
      'Usage: radiance sync [--check] <project>...\n       radiance check <project>...',
    );
    return 2;
  }
  let failed = false;
  for (const arg of dirs) {
    const dir = resolve(arg);
    try {
      const config = await loadConfig(dir);
      if (command === 'check') {
        readProject(dir, config);
        console.log(`${arg}: the project is valid.`);
        continue;
      }
      const { path, stale } = syncProject(dir, config, { check });
      if (check && stale) {
        console.error(`${path} is missing or stale. Run "radiance sync ${arg}".`);
        failed = true;
      } else {
        console.log(`${path}: ${stale ? 'written' : 'up to date'}.`);
      }
    } catch (error) {
      console.error(`${arg}: ${error instanceof Error ? error.message : String(error)}`);
      failed = true;
    }
  }
  return failed ? 1 : 0;
}
