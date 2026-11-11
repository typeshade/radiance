"use typeshade";

// The first reference game: a small automation game. A factory is a grid of cells. A source
// makes items, a belt carries one item to the cell it points at, and a machine takes items and
// makes goods. This module holds the kinds of a cell: each is a class with its fields, its
// rules and its colour.

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
export const ITEM: vec3 = vec3(0.95, 0.75, 0.2);

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
  /** The colour of the belt. The layer `items` draws the item of a belt, so the belt has no dot. */
  color(local: vec2): vec3 {
    return sender(vec3(0.26, 0.28, 0.32), this.dir, 0, local);
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
