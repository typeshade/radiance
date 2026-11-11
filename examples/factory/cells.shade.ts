"use typeshade";

// The reference game, written on the raw structure: classes, one tick function and nothing of
// the engine (docs/vision.md, D10 and D11). A factory is a grid of cells. A source makes items,
// a belt carries one item to the cell it points at, and a machine takes items and makes goods.

/** What a cell is. */
export const EMPTY: u32 = 0;
export const BELT: u32 = 1;
export const SOURCE: u32 = 2;
export const MACHINE: u32 = 3;

/** How many ticks a source takes to make one item. */
export const SOURCE_PERIOD: u32 = 6;
/** How many ticks an item stays on one belt before it can leave. */
export const BELT_PERIOD: u32 = 2;
/** How many items a machine holds. */
export const MACHINE_STOCK: u32 = 4;
/** How many ticks a machine takes to make one good from one item. */
export const MACHINE_PERIOD: u32 = 10;

/** One cell of the grid. Every field is an integer, so each tier gives the same bits. */
export class Cell {
  /** `EMPTY`, `BELT`, `SOURCE` or `MACHINE`. */
  kind: u32 = 0;
  /** Where a belt or a source sends its item: 0 north, 1 east, 2 south, 3 west. */
  dir: u32 = 0;
  /** 1 when the cell holds an item on a belt or in a source, and 0 when not. */
  item: u32 = 0;
  /** The ticks left before the item is ready, the next item is made or the good is made. */
  wait: u32 = 0;
  /** A machine's items in stock. */
  stock: u32 = 0;
  /** A source's items made, or a machine's goods made. */
  made: u32 = 0;
}

/** The index of the neighbour of (x, y) in a direction, or -1 outside the grid. */
function neighbor(x: u32, y: u32, dir: u32, width: u32, height: u32): i32 {
  if (dir == 0) {
    if (y == 0) { return -1; }
    return i32((y - 1) * width + x);
  }
  if (dir == 1) {
    if (x + 1 >= width) { return -1; }
    return i32(y * width + x + 1);
  }
  if (dir == 2) {
    if (y + 1 >= height) { return -1; }
    return i32((y + 1) * width + x);
  }
  if (x == 0) { return -1; }
  return i32(y * width + x - 1);
}

/** True when the cell has an item that can leave in this tick. */
function ready(c: Cell): bool {
  if (c.kind == BELT) { return c.item != 0 && c.wait == 0; }
  if (c.kind == SOURCE) { return c.item != 0; }
  return false;
}

/** True when the cell can take an item in this tick. */
function accepts(c: Cell): bool {
  if (c.kind == BELT) { return c.item == 0; }
  if (c.kind == MACHINE) { return c.stock < MACHINE_STOCK; }
  return false;
}

/**
 * One tick of the factory. It reads `prev` and writes `next`, so each cell sees the same state
 * and the order of the cells does not matter. The host gives the two arrays in turn.
 *
 * A cell that can take an item takes it from the first ready neighbour that points at it, in
 * the order north, east, south, west. A cell gives its item when its target takes it from
 * this cell and not from another.
 */
export function tick(next: array<Cell>, prev: array<Cell>, width: u32, height: u32) {
  for (let i: u32 = 0; i < next.length; i++) {
    const x: u32 = i % width;
    const y: u32 = i / width;
    let c: Cell = prev[i];

    // Does this cell take an item? Find the first ready neighbour that points here.
    let takes: bool = false;
    if (accepts(c)) {
      for (let d: u32 = 0; d < 4; d++) {
        const n: i32 = neighbor(x, y, d, width, height);
        if (n >= 0 && !takes) {
          const nc: Cell = prev[u32(n)];
          if (ready(nc) && nc.dir == (d + 2) % 4) { takes = true; }
        }
      }
    }

    // Does this cell give its item? Its target must take, and take from this cell.
    let gives: bool = false;
    if (ready(c)) {
      const t: i32 = neighbor(x, y, c.dir, width, height);
      if (t >= 0) {
        const tc: Cell = prev[u32(t)];
        if (accepts(tc)) {
          const tx: u32 = u32(t) % width;
          const ty: u32 = u32(t) / width;
          let first: i32 = -1;
          for (let d: u32 = 0; d < 4; d++) {
            const n: i32 = neighbor(tx, ty, d, width, height);
            if (n >= 0 && first < 0) {
              const nc: Cell = prev[u32(n)];
              if (ready(nc) && nc.dir == (d + 2) % 4) { first = n; }
            }
          }
          gives = first == i32(i);
        }
      }
    }

    if (c.kind == SOURCE) {
      if (gives) { c.item = 0; }
      if (c.item == 0) {
        if (c.wait == 0) {
          c.item = 1;
          c.made = c.made + 1;
          c.wait = SOURCE_PERIOD;
        } else {
          c.wait = c.wait - 1;
        }
      }
    }

    if (c.kind == BELT) {
      if (gives) { c.item = 0; }
      if (takes) {
        c.item = 1;
        c.wait = BELT_PERIOD;
      } else if (c.item != 0 && c.wait > 0) {
        c.wait = c.wait - 1;
      }
    }

    if (c.kind == MACHINE) {
      if (takes) { c.stock = c.stock + 1; }
      if (c.stock > 0) {
        if (c.wait == 0) {
          c.wait = MACHINE_PERIOD;
        } else {
          c.wait = c.wait - 1;
          if (c.wait == 0) {
            c.stock = c.stock - 1;
            c.made = c.made + 1;
          }
        }
      }
    }

    next[i] = c;
  }
}
