// Design: 0108, section 4, and 0109. The command of the engine. `radiance sync [--check]`
// writes the class of each project. `radiance check` reads each project and writes nothing.
// `radiance build` builds its page, and `radiance dev` starts its development server.

import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { GameConfig } from './config.ts';
import { buildProject, commitOf, devProject } from './build.ts';
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
  const commands = ['sync', 'check', 'build', 'dev'];
  if (!commands.includes(command ?? '') || dirs.length === 0) {
    console.error(
      [
        'Usage: radiance sync [--check] <project>...',
        '       radiance check <project>...',
        '       radiance build [--hook] [--readout] <project>...',
        '       radiance dev <project>',
      ].join('\n'),
    );
    return 2;
  }
  let failed = false;
  for (const arg of dirs) {
    const dir = resolve(arg);
    try {
      const config = await loadConfig(dir);
      if (command === 'dev') {
        const server = await devProject(dir, config);
        server.printUrls();
        // The server runs until the command is stopped.
        await new Promise(() => {});
      }
      if (command === 'build') {
        const readout = rest.includes('--readout');
        const result = await buildProject(dir, config, {
          hook: rest.includes('--hook'),
          readout,
          ...(readout ? { commit: commitOf(dir) } : {}),
        });
        for (const script of result.scripts) {
          console.log(
            `${arg}/dist/${script.file}: ${script.bytes} bytes, ${script.gzip} with gzip`,
          );
        }
        const { bytes, gzip } = result.loaded;
        console.log(
          `${arg}: the page loads ${bytes} bytes of script at its start, ${gzip} with gzip.`,
        );
        if (result.over) {
          console.error(
            `${arg}: the page loads ${bytes} bytes, and the budget is ${result.budget}. Make the page smaller, or change "budget" in radiance.config.ts.`,
          );
          failed = true;
        }
        continue;
      }
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
