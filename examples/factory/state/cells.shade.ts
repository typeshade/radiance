"use typeshade";
import { BELT, Belt, MACHINE, Machine, SOURCE, Source } from "../kinds.shade.ts";

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
