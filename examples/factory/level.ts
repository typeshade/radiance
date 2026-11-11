// The host side of the reference game: a level from text and the factory as text. The engine's
// simulation (design record 0102) runs the ticks, and gives the game its dump, its inputs and
// its replay.

import type { Device } from 'typeshade/runtime';
import { createSim, type Sim } from '../../src/index.ts';
import { BELT, Cell, EMPTY, MACHINE, SOURCE, tick } from './cells.shade.ts';

/** A level: its grid size and its first cells, row by row. */
export interface Level {
  readonly width: number;
  readonly height: number;
  readonly cells: Cell[];
}

/** A factory that runs: a level's size and the simulation of its cells. */
export interface Factory {
  readonly width: number;
  readonly height: number;
  readonly sim: Sim<{ cells: Cell[] }, 'cells'>;
}

/** The level of the page and of the browser check. */
export const DEMO = `
  E>>>v....S
  ....v....v
  M<<<<....v
  ..........
  N..M<<<<<<
  ^.........
`;

const DIRS = '^>v<'; // north, east, south, west: a belt
const SOURCES = 'NESW'; // a source that sends its items north, east, south or west

/**
 * Reads a level. Each line is a row and each character a cell: `.` empty, `^ > v <` a belt,
 * `N E S W` a source that sends its items that way, `M` a machine.
 */
export function parseLevel(text: string): Level {
  const rows = text
    .split('\n')
    .map((row) => row.trim())
    .filter((row) => row.length > 0);
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const cells: Cell[] = [];
  rows.forEach((row, y) => {
    if (row.length !== width) {
      throw new TypeError(
        `parseLevel(): row ${y} has ${row.length} cells, and row 0 has ${width}. Give each row the same length.`,
      );
    }
    for (const ch of row) {
      const cell = new Cell();
      if (ch === '.') cell.kind = EMPTY;
      else if (DIRS.includes(ch)) {
        cell.kind = BELT;
        cell.dir = DIRS.indexOf(ch);
      } else if (SOURCES.includes(ch)) {
        cell.kind = SOURCE;
        cell.dir = SOURCES.indexOf(ch);
      } else if (ch === 'M') cell.kind = MACHINE;
      else {
        throw new TypeError(
          `parseLevel(): row ${y} holds ${JSON.stringify(ch)}. A cell is one of . ^ > v < N E S W M.`,
        );
      }
      cells.push(cell);
    }
  });
  return { width, height, cells };
}

/**
 * The factory as text, one line for each row. A belt with an item is `o`, a source that holds
 * an item is its letter in lower case, and a machine is the digit of its stock.
 */
export function render(
  factory: { readonly width: number; readonly height: number },
  cells: readonly Cell[],
): string {
  const lines: string[] = [];
  for (let y = 0; y < factory.height; y++) {
    let line = '';
    for (let x = 0; x < factory.width; x++) {
      const c = cells[y * factory.width + x];
      if (c.kind === BELT) line += c.item !== 0 ? 'o' : DIRS[c.dir];
      else if (c.kind === SOURCE)
        line += c.item !== 0 ? SOURCES[c.dir].toLowerCase() : SOURCES[c.dir];
      else if (c.kind === MACHINE) line += String(c.stock);
      else line += '.';
    }
    lines.push(line);
  }
  return lines.join('\n') + '\n';
}

/**
 * Builds the factory of a level on a device: the CPU tier in a test, a GPU tier in a page. The
 * cells are one buffered table: each tick reads the cells as the last tick left them and writes
 * the next cells, and the simulation swaps the two.
 */
export function createFactory(
  text: string,
  options: { readonly seed: number; readonly device: Device },
): Factory {
  const { width, height, cells } = parseLevel(text);
  const sim = createSim(
    { cells },
    {
      device: options.device,
      seed: options.seed,
      buffered: ['cells'],
      tick: (t) => tick(t.cells.write, t.cells.read, width, height),
    },
  );
  return { width, height, sim };
}

/** The counts a test and a score read. */
export function totals(cells: readonly Cell[]) {
  let made = 0;
  let goods = 0;
  let onBelts = 0;
  let inSources = 0;
  let inStock = 0;
  for (const c of cells) {
    if (c.kind === SOURCE) {
      made += c.made;
      inSources += c.item;
    } else if (c.kind === BELT) onBelts += c.item;
    else if (c.kind === MACHINE) {
      goods += c.made;
      inStock += c.stock;
    }
  }
  return { made, goods, onBelts, inSources, inStock };
}
