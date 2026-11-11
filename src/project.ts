// Design: 0108, sections 1 to 4. A game is a project of a fixed shape. This module reads the
// project and writes the game's class from it. It runs when a game is developed and built, and
// never in a shipped game.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Blend, GameConfig } from './config.ts';
import { readFunctions, readLayer, readSystem, readTable, unusedNames } from './facts.ts';

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

/** A layer of a project (design record 0111, section 2), with what the engine gives each name. */
export interface ProjectLayer {
  readonly name: string;
  readonly file: string;
  /** The name of the `@vertex` entry. */
  readonly vertex: string;
  /** The name of the `@fragment` entry. */
  readonly fragment: string;
  /** The table the layer draws: one instance for each row. */
  readonly table: string;
  /** How the colour of the layer meets the colour under it (section 6). Not given: it covers it. */
  readonly blend: Blend | undefined;
  /** For each `declare const` of the layer, one expression of the game's class. */
  readonly bindings: readonly { readonly name: string; readonly expr: string }[];
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
  /** The layers of the picture, in the order of the config's `draw`. Empty with `draws`. */
  readonly layers: readonly ProjectLayer[];
  readonly inputs: readonly ProjectInput[];
}

const SUFFIX = '.shade.ts';
const ENGINE_VALUES = ['tick', 'seed', 'dt'];
/** The names that only a layer gets: the view, and the time between two ticks (record 0111). */
const LAYER_ONLY = ['view', 'blend'];
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

const LAYER_KINDS = ['storage', 'uniform'];
const BLENDS: readonly Blend[] = ['alpha', 'add'];

/** The name and the blend of each entry of `draw` (design record 0111, section 6). */
function drawEntries(draw: NonNullable<GameConfig['draw']>) {
  const entries: { name: string; blend: Blend | undefined }[] = [];
  for (const entry of draw) {
    const name = typeof entry === 'string' ? entry : entry?.layer;
    if (typeof name !== 'string') {
      throw new TypeError(
        `radiance.config.ts: an entry of "draw" is ${JSON.stringify(entry)}. Give a layer name, or { layer: '<name>', blend: 'alpha' }.`,
      );
    }
    const blend = typeof entry === 'string' ? undefined : entry.blend;
    if (blend !== undefined && !BLENDS.includes(blend)) {
      throw new TypeError(
        `radiance.config.ts: "draw" gives the layer "${name}" the blend ${JSON.stringify(blend)}. The choices are ${BLENDS.map((b) => `'${b}'`).join(' and ')}. Leave "blend" out for a layer that covers what is under it.`,
      );
    }
    entries.push({ name, blend });
  }
  return entries;
}

/** Reads the layers of the config's `draw`, checks their names and says what each name gets. */
function readLayers(
  dir: string,
  config: GameConfig,
  tables: readonly ProjectTable[],
  engineNames: readonly string[],
  draws: boolean,
  read: (file: string) => string,
): ProjectLayer[] {
  const { draw, view } = config;
  if (draw === undefined) {
    if (view !== undefined) {
      throw new TypeError(
        `radiance.config.ts: the config has "view" and no "draw". A view is for layers. Add "draw: ['<layer>']" with a file of draw/, or remove "view".`,
      );
    }
    return [];
  }
  if (draws) {
    throw new TypeError(
      `radiance.config.ts: the config has "draw", so the game draws in layers, and the project has draw/draw.ts, the host function of the older way. Remove draw/draw.ts, or remove "draw" from the config.`,
    );
  }
  if (!Array.isArray(draw) || draw.length === 0) {
    throw new TypeError(
      `radiance.config.ts: "draw" lists no layer. Give the layers from the back to the front, for example { draw: ['cells'] }.`,
    );
  }
  const fit = view?.fit;
  if (
    view === undefined ||
    !Array.isArray(fit) ||
    fit.length !== 2 ||
    !fit.every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0)
  ) {
    throw new TypeError(
      view === undefined
        ? `radiance.config.ts: the config has "draw" and no "view". Give the rectangle of the world that the screen shows, for example { view: { fit: [10, 6] } }.`
        : `radiance.config.ts: "view.fit" is ${JSON.stringify(fit)}. Give the width and the height of the rectangle of the world, two numbers above 0, for example { fit: [10, 6] }.`,
    );
  }
  const clear = view.clear;
  if (
    clear !== undefined &&
    (!Array.isArray(clear) ||
      clear.length !== 3 ||
      !clear.every((n) => typeof n === 'number' && n >= 0 && n <= 1))
  ) {
    throw new TypeError(
      `radiance.config.ts: "view.clear" is ${JSON.stringify(clear)}. Give a colour, three numbers from 0 to 1, for example { clear: [0.07, 0.07, 0.09] }.`,
    );
  }
  const entries = drawEntries(draw);
  const order = entries.map((entry) => entry.name);
  const found = shadeFiles(dir, 'draw');
  for (const name of order) {
    if (!found.includes(name)) {
      throw new TypeError(
        `radiance.config.ts: "draw" names the layer "${name}", and draw/ has no ${name}${SUFFIX}. The layers are ${found.join(', ')}.`,
      );
    }
  }
  const unused = found.filter((name) => !order.includes(name));
  if (unused.length > 0) {
    throw new TypeError(
      `draw/${unused[0]}${SUFFIX}: the config's "draw" does not name this layer. Add "${unused[0]}" to "draw", or remove the file.`,
    );
  }
  const names = tables.map((table) => table.name);
  const layers: ProjectLayer[] = [];
  for (const { name, blend } of entries.filter((e, i) => order.indexOf(e.name) === i)) {
    const file = join('draw', name + SUFFIX);
    const facts = readLayer(file, read(file));
    const shown = file.split('\\').join('/');
    for (const [entry, list] of [
      ['@vertex', facts.vertex],
      ['@fragment', facts.fragment],
    ] as const) {
      if (list.length === 1) continue;
      throw new TypeError(
        list.length === 0
          ? `${shown}: the layer "${name}" has no ${entry} entry. A layer exports one @vertex entry and one @fragment entry, for example "${entry} export function ${entry === '@vertex' ? 'place' : 'paint'}(...)".`
          : `${shown}: the layer "${name}" has ${list.length} ${entry} entries (${list.join(', ')}). A layer exports one @vertex entry and one @fragment entry.`,
      );
    }
    const bindings: { name: string; expr: string }[] = [];
    const drawn: string[] = [];
    for (const { name: binding, kind } of facts.declares) {
      const table = tables.find((t) => t.name === binding);
      const wanted = table !== undefined ? 'storage' : 'uniform';
      if (table === undefined && !LAYER_ONLY.includes(binding) && !engineNames.includes(binding)) {
        const known = [...names, ...LAYER_ONLY, ...engineNames];
        throw new TypeError(
          `${shown}: the engine knows no value for the name "${binding}" of the layer "${name}". A name is a table, a scratch table, ${LAYER_ONLY.join(', ')}, ${ENGINE_VALUES.join(', ')}, or a value of the config. The names are ${known.join(', ')}.`,
        );
      }
      if (!LAYER_KINDS.includes(kind) || kind !== wanted) {
        throw new TypeError(
          `${shown}: the name "${binding}" of the layer "${name}" is a ${kind} binding. The engine gives ${table !== undefined ? 'a table' : binding === 'view' ? 'the view' : binding === 'blend' ? 'the blend' : 'a value'} as a ${wanted} binding, for example "declare const ${binding}: ${wanted}<${table !== undefined ? 'array<Row>' : binding === 'view' ? 'mat4x4' : binding === 'blend' ? 'f32' : 'u32'}>;".`,
        );
      }
      if (table !== undefined) {
        drawn.push(binding);
        bindings.push({ name: binding, expr: `this.tables.${binding}.rows` });
      } else if (binding === 'view' || binding === 'blend') {
        bindings.push({ name: binding, expr: binding });
      } else if (ENGINE_VALUES.includes(binding))
        bindings.push({ name: binding, expr: `this.${binding}` });
      else bindings.push({ name: binding, expr: `this.values.${binding}` });
    }
    if (drawn.length !== 1) {
      throw new TypeError(
        drawn.length === 0
          ? `${shown}: the layer "${name}" names no table. A layer draws one instance for each row of one table. Declare it, for example "declare const ${names[0] ?? 'cells'}: storage<array<Row>>;". The tables are ${names.join(', ')}.`
          : `${shown}: the layer "${name}" names ${drawn.length} tables (${drawn.join(', ')}). A layer draws the rows of one table. Name one table, and make one layer for each table.`,
      );
    }
    // The compiler refuses a name that no entry reaches, and it does so at the first frame.
    const idle = unusedNames(file, read(file));
    if (idle.length > 0) {
      throw new TypeError(
        `${shown}: the layer "${name}" declares "${idle[0]}", and its file never uses it. The compiler refuses a name that no entry reaches, at the first frame. Remove "declare const ${idle[0]}", or use it in an entry.`,
      );
    }
    layers.push({
      name,
      file,
      vertex: facts.vertex[0],
      fragment: facts.fragment[0],
      table: drawn[0],
      blend,
      bindings,
    });
  }
  return layers;
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

  // The drawing: layers in draw/, when the config has "draw" (design record 0111), or one host
  // function `draw(game)` in draw/draw.ts, when the game draws as it did before.
  const draws = existsSync(join(dir, DRAW_FILE));
  const layers = readLayers(dir, config, tables, ENGINE_VALUES.concat(values), draws, read);
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
  return { dir, config, tables, systems, draws, layers, inputs };
}

/** The name that `.radiance/game.ts` gives a layer's program. No other name has the prefix. */
const layerName = (layer: ProjectLayer) => `layer_${layer.name.replace(/\W/g, '_')}`;

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
  for (const layer of project.layers) {
    lines.push(`import ${layerName(layer)} from '${up(layer.file)}';`);
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
  if (project.layers.length > 0) {
    const { fit, clear } = project.config.view!;
    lines.push('', '  override readonly layers = [');
    for (const layer of project.layers) {
      const bound = layer.bindings.map((b) =>
        b.name === b.expr ? b.name : `${b.name}: ${b.expr}`,
      );
      const params = layer.bindings.some((b) => b.name === 'blend')
        ? 'view: readonly number[], blend: number'
        : 'view: readonly number[]';
      lines.push(
        `    // ${layer.file.split('\\').join('/')}`,
        '    {',
        `      name: '${layer.name}',`,
        `      program: ${layerName(layer)},`,
        `      vertex: '${layer.vertex}',`,
        `      fragment: '${layer.fragment}',`,
        `      rows: this.tables.${layer.table},`,
        ...(layer.blend === undefined ? [] : [`      blend: '${layer.blend}' as const,`]),
        `      bind: (${params}) => ({ ${bound.join(', ')} }),`,
        '    },',
      );
    }
    lines.push('  ];', '');
    const colour = clear === undefined ? '' : `, clear: [${clear.join(', ')}]`;
    lines.push(`  override readonly view = { fit: [${fit.join(', ')}]${colour} } as const;`);
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
