// Design: 0108, sections 1 to 4. A game is a project of a fixed shape. This module reads the
// project and writes the game's class from it. It runs when a game is developed and built, and
// never in a shipped game.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { GameConfig } from './config.ts';
import { readFunctions, readSystem, readTable } from './facts.ts';

/** A table of a project. */
export interface ProjectTable {
  readonly name: string;
  readonly kind: 'table' | 'pool' | 'scratch';
  /** The file, from the project's directory. */
  readonly file: string;
  readonly className: string;
  /** The number of rows of a pool. */
  readonly slots: number | undefined;
  /** For a scratch table, the state table whose number of rows it has. */
  readonly like: string | undefined;
  /** True when a system writes the table through its `Next` name. */
  readonly buffered: boolean;
}

/** A system of a project, with what the engine gives each parameter. */
export interface ProjectSystem {
  readonly name: string;
  readonly file: string;
  /** One expression of the game's class for each parameter, in order. */
  readonly args: readonly string[];
}

/** A host function of `input/` that takes an event of the page. */
export interface ProjectInput {
  /** The event, which is also the function's name. */
  readonly event: string;
  readonly file: string;
}

/** A project, read. */
export interface Project {
  readonly dir: string;
  readonly config: GameConfig;
  readonly tables: readonly ProjectTable[];
  readonly systems: readonly ProjectSystem[];
  /** True when the project has `draw/draw.ts`, the host function that draws a frame. */
  readonly draws: boolean;
  readonly inputs: readonly ProjectInput[];
}

const SUFFIX = '.shade.ts';
const ENGINE_VALUES = ['tick', 'seed', 'dt'];
const EVENTS = ['pointerdown', 'pointermove', 'pointerup', 'keydown', 'keyup'];
const DRAW_FILE = join('draw', 'draw.ts');

function shadeFiles(dir: string, sub: string): string[] {
  const path = join(dir, sub);
  if (!existsSync(path)) return [];
  const names = readdirSync(path).sort();
  for (const name of names) {
    if (name.endsWith('.typeshade.ts')) continue;
    if (!name.endsWith(SUFFIX)) {
      throw new TypeError(
        `${join(sub, name)}: a file of ${sub}/ is a "use typeshade" file named <name>${SUFFIX}. Move the file, or give it that name.`,
      );
    }
  }
  return names.filter((name) => name.endsWith(SUFFIX)).map((name) => name.slice(0, -SUFFIX.length));
}

/** Reads a project: its tables, its systems and what each parameter of a system gets. */
export function readProject(dir: string, config: GameConfig): Project {
  if (!Array.isArray(config?.tick) || config.tick.length === 0) {
    throw new TypeError(
      `radiance.config.ts: "tick" lists no system. Give the systems in the order they run, for example { tick: ['move', 'draw'] }.`,
    );
  }
  const read = (file: string) => readFileSync(join(dir, file), 'utf8');
  const tables: { -readonly [K in keyof ProjectTable]: ProjectTable[K] }[] = [];
  for (const name of shadeFiles(dir, 'state')) {
    const file = join('state', name + SUFFIX);
    const facts = readTable(file, read(file));
    tables.push({
      name,
      kind: facts.slots === undefined ? 'table' : 'pool',
      file,
      className: facts.className,
      slots: facts.slots,
      like: undefined,
      buffered: facts.slots !== undefined,
    });
  }
  const state = tables.map((table) => table.name);
  for (const name of shadeFiles(dir, 'scratch')) {
    const file = join('scratch', name + SUFFIX);
    const like = config.scratch?.[name];
    if (like === undefined || !state.includes(like)) {
      throw new TypeError(
        `${file}: the config gives this scratch table no size. Name the state table it follows, for example { scratch: { ${name}: '${state[0] ?? 'actors'}' } }. The state tables are ${state.join(', ')}.`,
      );
    }
    tables.push({
      name,
      kind: 'scratch',
      file,
      className: readTable(file, read(file)).className,
      slots: undefined,
      like,
      buffered: false,
    });
  }
  const names = tables.map((table) => table.name);
  const duplicate = names.find((name, index) => names.indexOf(name) !== index);
  if (duplicate !== undefined) {
    throw new TypeError(
      `The project has two tables named "${duplicate}", in state/ and in scratch/. Give each table its own name.`,
    );
  }

  const found = shadeFiles(dir, 'systems');
  const values = config.values ?? [];
  const systems: ProjectSystem[] = [];
  for (const name of config.tick) {
    if (!found.includes(name)) {
      throw new TypeError(
        `radiance.config.ts: "tick" names the system "${name}", and systems/ has no ${name}${SUFFIX}. The systems are ${found.join(', ')}.`,
      );
    }
    const file = join('systems', name + SUFFIX);
    const args = readSystem(file, read(file), name).params.map((param) => {
      const table = tables.find((t) => t.name === param);
      if (table !== undefined) return `this.tables.${param}.rows`;
      const written = tables.find((t) => `${t.name}Next` === param);
      if (written !== undefined) {
        if (written.kind === 'scratch') {
          throw new TypeError(
            `${file}: the parameter "${param}" asks for a second array of the scratch table "${written.name}". A scratch table has one array: name the parameter "${written.name}".`,
          );
        }
        written.buffered = true;
        return `this.tables.${written.name}.next`;
      }
      if (ENGINE_VALUES.includes(param)) return `this.${param}`;
      if (values.includes(param)) return `this.values.${param}`;
      const known = [...names, ...state.map((t) => `${t}Next`), ...ENGINE_VALUES, ...values];
      throw new TypeError(
        `${file}: the engine knows no value for the parameter "${param}" of "${name}". A parameter is a table, a table with "Next", ${ENGINE_VALUES.join(', ')}, or a value of the config. The names are ${known.join(', ')}.`,
      );
    });
    systems.push({ name, file, args });
  }
  const unused = found.filter((name) => !config.tick.includes(name));
  if (unused.length > 0) {
    throw new TypeError(
      `systems/${unused[0]}${SUFFIX}: the config's "tick" does not name this system. Add "${unused[0]}" to "tick", or remove the file.`,
    );
  }

  // The drawing: one host function `draw(game)` in draw/draw.ts, when the game draws.
  const draws = existsSync(join(dir, DRAW_FILE));
  if (draws && !readFunctions(DRAW_FILE, read(DRAW_FILE)).includes('draw')) {
    throw new TypeError(
      `${DRAW_FILE}: the file exports no function "draw". Export the function that draws one frame: "export function draw(game: Game) { ... }".`,
    );
  }
  // The inputs: each host file of input/ exports functions named as the events they take.
  const inputs: ProjectInput[] = [];
  const inputDir = join(dir, 'input');
  for (const name of existsSync(inputDir) ? readdirSync(inputDir).sort() : []) {
    if (!name.endsWith('.ts')) continue;
    const file = join('input', name);
    for (const event of readFunctions(file, read(file))) {
      if (!EVENTS.includes(event)) {
        throw new TypeError(
          `${file}: the function "${event}" is named after no event. A function of input/ has the name of the event it takes: ${EVENTS.join(', ')}.`,
        );
      }
      const before = inputs.find((input) => input.event === event);
      if (before !== undefined) {
        throw new TypeError(
          `${file}: "${event}" is also in ${before.file}. One function takes each event.`,
        );
      }
      inputs.push({ event, file });
    }
  }
  return { dir, config, tables, systems, draws, inputs };
}

/** The text of `.radiance/game.ts`: the class of the game, as a person could write it. */
export function writeGame(project: Project): string {
  const up = (file: string) => '../' + file.split('\\').join('/');
  const lines = [
    '// Written by "radiance sync" from the project. Do not change this file: change the',
    '// project, and run "radiance sync" again.',
    '',
    "import { Engine } from 'radiance';",
  ];
  for (const table of project.tables) {
    lines.push(`import { ${table.className} } from '${up(table.file)}';`);
  }
  for (const sys of project.systems) {
    lines.push(`import { ${sys.name} } from '${up(sys.file)}';`);
  }
  if (project.draws) lines.push(`import { draw } from '${up(DRAW_FILE)}';`);
  for (const file of new Set(project.inputs.map((item) => item.file))) {
    const events = project.inputs.filter((item) => item.file === file).map((item) => item.event);
    lines.push(`import { ${events.join(', ')} } from '${up(file)}';`);
  }
  lines.push('', 'export class Game extends Engine {');
  if (project.config.stepOn !== undefined) {
    lines.push(`  override readonly stepOn = '${project.config.stepOn}' as const;`, '');
  }
  lines.push('  readonly tables = {');
  const state = project.tables.filter((table) => table.kind !== 'scratch');
  for (const table of state) {
    if (table.kind === 'pool') {
      lines.push(`    ${table.name}: this.pool(${table.className}, { size: ${table.slots} }),`);
    } else {
      lines.push(
        `    ${table.name}: this.table(${table.className}${table.buffered ? ', { buffered: true }' : ''}),`,
      );
    }
  }
  for (const table of project.tables.filter((t) => t.kind === 'scratch')) {
    const like = state.find((t) => t.name === table.like)!;
    const size = like.kind === 'pool' ? `{ size: ${like.slots} }` : `{ like: '${like.name}' }`;
    lines.push(`    ${table.name}: this.scratch(${table.className}, ${size}),`);
  }
  lines.push('  };', '', '  readonly systems = {');
  for (const sys of project.systems) {
    lines.push(`    // ${sys.file.split('\\').join('/')}`);
    lines.push(`    ${sys.name}: () => ${sys.name}(${sys.args.join(', ')}),`);
  }
  lines.push('  };');
  if (project.inputs.length > 0) {
    lines.push('', '  override readonly inputs = {');
    for (const item of project.inputs) {
      const data = item.event.startsWith('key') ? 'KeyInput' : 'PointerInput';
      lines.push(`    // ${item.file.split('\\').join('/')}`);
      lines.push(`    ${item.event}: (data: ${data}) => ${item.event}(this, data),`);
    }
    lines.push('  };');
    const types = [
      ...new Set(
        project.inputs.map((i) => (i.event.startsWith('key') ? 'KeyInput' : 'PointerInput')),
      ),
    ].sort();
    lines[3] = `import { Engine, ${types.map((t) => `type ${t}`).join(', ')} } from 'radiance';`;
  }
  if (project.draws) {
    lines.push(
      '',
      `  // ${DRAW_FILE.split('\\').join('/')}`,
      '  draw() {',
      '    return draw(this);',
      '  }',
    );
  }
  lines.push('}', '');
  return lines.join('\n');
}

/** Where the engine writes the game's class, from the project's directory. */
export const GAME_FILE = join('.radiance', 'game.ts');

/**
 * Writes `.radiance/game.ts` of a project. With `check`, it writes nothing and says if the file
 * is missing or stale. It returns the path of the file and whether the file differed.
 */
export function syncProject(
  dir: string,
  config: GameConfig,
  options: { readonly check?: boolean } = {},
): { readonly path: string; readonly stale: boolean } {
  const text = writeGame(readProject(dir, config));
  const path = join(dir, GAME_FILE);
  const stale = !existsSync(path) || readFileSync(path, 'utf8') !== text;
  if (stale && options.check !== true) {
    mkdirSync(join(dir, '.radiance'), { recursive: true });
    writeFileSync(path, text);
  }
  return { path: relative(process.cwd(), path) || path, stale };
}
