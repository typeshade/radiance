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

/** The colour of an item on a belt or in a source. */
const ITEM: vec3 = vec3(0.95, 0.75, 0.2);

/**
 * The colour of a cell that sends its item in `dir`: a light mark on that side, and a dot for
 * the item. `local` is the place of the pixel in its cell, from -1 to 1.
 */
function sender(base: vec3, dir: u32, item: u32, local: vec2): vec3 {
  let ahead: f32 = -local.y;
  if (dir == 1) { ahead = local.x; }
  if (dir == 2) { ahead = local.y; }
  if (dir == 3) { ahead = -local.x; }
  let color: vec3 = base;
  if (ahead > 0.6) { color = color + vec3(0.12, 0.12, 0.12); }
  if (item != 0 && length(local) < 0.45) { color = ITEM; }
  return color;
}

/** A belt carries one item to the cell it points at. */
export class Belt {
  /** Where the belt sends its item: 0 north, 1 east, 2 south, 3 west. */
  dir: u32 = 0;
  /** 1 when the belt holds an item, and 0 when not. */
  item: u32 = 0;
  /** The ticks left before the item can leave. */
  wait: u32 = 0;
  ready(): bool {
    return this.item != 0 && this.wait == 0;
  }
  accepts(): bool {
    return this.item == 0;
  }
  step(takes: bool, gives: bool) {
    if (gives) { this.item = 0; }
    if (takes) {
      this.item = 1;
      this.wait = BELT_PERIOD;
    } else if (this.item != 0 && this.wait > 0) {
      this.wait = this.wait - 1;
    }
  }
  color(local: vec2): vec3 {
    return sender(vec3(0.26, 0.28, 0.32), this.dir, this.item, local);
  }
}

/** A source makes an item and sends it one way. */
export class Source {
  /** Where the source sends its item: 0 north, 1 east, 2 south, 3 west. */
  dir: u32 = 0;
  /** 1 when the source holds an item, and 0 when not. */
  item: u32 = 0;
  /** The ticks left before the next item is made. */
  wait: u32 = 0;
  /** The items made. */
  made: u32 = 0;
  ready(): bool {
    return this.item != 0;
  }
  step(gives: bool) {
    if (gives) { this.item = 0; }
    if (this.item == 0) {
      if (this.wait == 0) {
        this.item = 1;
        this.made = this.made + 1;
        this.wait = SOURCE_PERIOD;
      } else {
        this.wait = this.wait - 1;
      }
    }
  }
  color(local: vec2): vec3 {
    return sender(vec3(0.16, 0.45, 0.25), this.dir, this.item, local);
  }
}

/** A machine takes items and makes goods. */
export class Machine {
  /** The items in stock. */
  stock: u32 = 0;
  /** The ticks left before the next good is made. */
  wait: u32 = 0;
  /** The goods made. */
  made: u32 = 0;
  accepts(): bool {
    return this.stock < MACHINE_STOCK;
  }
  step(takes: bool) {
    if (takes) { this.stock = this.stock + 1; }
    if (this.stock > 0) {
      if (this.wait == 0) {
        this.wait = MACHINE_PERIOD;
      } else {
        this.wait = this.wait - 1;
        if (this.wait == 0) {
          this.stock = this.stock - 1;
          this.made = this.made + 1;
        }
      }
    }
  }
  color(): vec3 {
    return vec3(0.18, 0.3, 0.6) + vec3(0.1, 0.1, 0.1) * f32(this.stock);
  }
}

/**
 * One cell of the grid: a tag and one field for each kind. The cell chooses by the tag. Every
 * field is an integer, so each tier gives the same bits.
 */
export class Cell {
  /** `EMPTY`, `BELT`, `SOURCE` or `MACHINE`. */
  kind: u32 = 0;
  belt: Belt = new Belt();
  source: Source = new Source();
  machine: Machine = new Machine();
  /** True when the cell has an item that can leave in this tick. */
  ready(): bool {
    if (this.kind == BELT) { return this.belt.ready(); }
    if (this.kind == SOURCE) { return this.source.ready(); }
    return false;
  }
  /** True when the cell can take an item in this tick. */
  accepts(): bool {
    if (this.kind == BELT) { return this.belt.accepts(); }
    if (this.kind == MACHINE) { return this.machine.accepts(); }
    return false;
  }
  /** Where the cell sends its item. */
  out(): u32 {
    if (this.kind == SOURCE) { return this.source.dir; }
    return this.belt.dir;
  }
  /** One tick of the cell's kind. */
  step(takes: bool, gives: bool) {
    if (this.kind == BELT) { this.belt.step(takes, gives); }
    if (this.kind == SOURCE) { this.source.step(gives); }
    if (this.kind == MACHINE) { this.machine.step(takes); }
  }
  /** The colour of a pixel of the cell. `local` is its place in the cell, from -1 to 1. */
  color(local: vec2): vec3 {
    if (this.kind == BELT) { return this.belt.color(local); }
    if (this.kind == SOURCE) { return this.source.color(local); }
    if (this.kind == MACHINE) { return this.machine.color(); }
    return vec3(0.07, 0.08, 0.1);
  }
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
    if (c.accepts()) {
      for (let d: u32 = 0; d < 4; d++) {
        const n: i32 = neighbor(x, y, d, width, height);
        if (n >= 0 && !takes) {
          const nc: Cell = prev[u32(n)];
          if (nc.ready() && nc.out() == (d + 2) % 4) { takes = true; }
        }
      }
    }

    // Does this cell give its item? Its target must take, and take from this cell.
    let gives: bool = false;
    if (c.ready()) {
      const t: i32 = neighbor(x, y, c.out(), width, height);
      if (t >= 0) {
        const tc: Cell = prev[u32(t)];
        if (tc.accepts()) {
          const tx: u32 = u32(t) % width;
          const ty: u32 = u32(t) / width;
          let first: i32 = -1;
          for (let d: u32 = 0; d < 4; d++) {
            const n: i32 = neighbor(tx, ty, d, width, height);
            if (n >= 0 && first < 0) {
              const nc: Cell = prev[u32(n)];
              if (nc.ready() && nc.out() == (d + 2) % 4) { first = n; }
            }
          }
          gives = first == i32(i);
        }
      }
    }

    c.step(takes, gives);
    next[i] = c;
  }
}
