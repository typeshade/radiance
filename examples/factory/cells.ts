// The host side of the factory's cells: a level from text, the factory as text, the input that
// puts a cell and the counts of a score. A test and the page use the same functions.

import type { Game } from './.radiance/game.ts';
import { BELT, EMPTY, MACHINE, SOURCE } from './kinds.shade.ts';
import { Cell } from './state/cells.shade.ts';

/** A level of the factory: its first cells, row by row, and the size of its grid. */
export interface FactoryLevel {
  readonly rows: { readonly cells: Cell[] };
  readonly values: { readonly width: number; readonly height: number };
}

const DIRS = '^>v<'; // north, east, south, west: a belt
const SOURCES = 'NESW'; // a source that sends its items north, east, south or west

/**
 * Reads a level. Each line is a row and each character a cell: `.` empty, `^ > v <` a belt,
 * `N E S W` a source that sends its items that way, `M` a machine.
 */
export function parseLevel(text: string): FactoryLevel {
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
        cell.belt.dir = DIRS.indexOf(ch);
      } else if (SOURCES.includes(ch)) {
        cell.kind = SOURCE;
        cell.source.dir = SOURCES.indexOf(ch);
      } else if (ch === 'M') cell.kind = MACHINE;
      else {
        throw new TypeError(
          `parseLevel(): row ${y} holds ${JSON.stringify(ch)}. A cell is one of . ^ > v < N E S W M.`,
        );
      }
      cells.push(cell);
    }
  });
  return { rows: { cells }, values: { width, height } };
}

/**
 * The factory as text, one line for each row. A belt with an item is `o`, a source that holds
 * an item is its letter in lower case, and a machine is the digit of its stock.
 */
export function render(width: number, height: number, cells: readonly Cell[]): string {
  const lines: string[] = [];
  for (let y = 0; y < height; y++) {
    let line = '';
    for (let x = 0; x < width; x++) {
      const c = cells[y * width + x];
      if (c.kind === BELT) line += c.belt.item !== 0 ? 'o' : DIRS[c.belt.dir];
      else if (c.kind === SOURCE) {
        const letter = SOURCES[c.source.dir];
        line += c.source.item !== 0 ? letter.toLowerCase() : letter;
      } else if (c.kind === MACHINE) line += String(c.machine.stock);
      else line += '.';
    }
    lines.push(line);
  }
  return lines.join('\n') + '\n';
}

/**
 * Puts a belt, a source, a machine or nothing in the cell (x, y). It is an input of the
 * simulation, so it is the same call in a test and in a page. A cell outside the grid is left.
 */
export function putCell(game: Game, x: number, y: number, kind: number, dir: number): void {
  const { width, height } = game.values;
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const index = y * width + x;
  // The input writes the tag and the fields of the new kind. The other kinds keep theirs.
  if (kind === BELT) game.tables.cells.input(index, { kind, belt: { dir, item: 0, wait: 0 } });
  else if (kind === SOURCE)
    game.tables.cells.input(index, { kind, source: { dir, item: 0, wait: 0 } });
  else if (kind === MACHINE)
    game.tables.cells.input(index, { kind, machine: { stock: 0, wait: 0 } });
  else game.tables.cells.input(index, { kind });
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
      made += c.source.made;
      inSources += c.source.item;
    } else if (c.kind === BELT) onBelts += c.belt.item;
    else if (c.kind === MACHINE) {
      goods += c.machine.made;
      inStock += c.machine.stock;
    }
  }
  return { made, goods, onBelts, inSources, inStock };
}
