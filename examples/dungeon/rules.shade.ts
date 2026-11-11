"use typeshade";

// The second reference game: a small roguelike. This module holds what the tables and the
// systems share: the kinds, the numbers of the rules and the step on the grid.

/** What an actor is. A row of kind `NONE` is a free slot. */
export const NONE: u32 = 0;
export const PLAYER: u32 = 1;
export const RAT: u32 = 2;
export const ORC: u32 = 3;

/** What a tile is. */
export const WALL: u32 = 0;
export const FLOOR: u32 = 1;
export const POTION: u32 = 2;
/** New monsters come in on this tile. No actor walks onto it. */
export const SPAWN: u32 = 3;

/** A way to go: `STAY`, or north, east, south, west. */
export const STAY: u32 = 0;

export const PLAYER_DAMAGE: u32 = 2;
export const MONSTER_DAMAGE: u32 = 1;
export const POTION_HEAL: u32 = 3;
export const MAX_HP: u32 = 9;
export const RAT_HP: u32 = 2;
export const ORC_HP: u32 = 4;
/** A monster comes in on each turn whose number is a multiple of this, from turn 1. */
export const SPAWN_PERIOD: u32 = 8;

/** The index of the cell one step from (x, y) in a way, or -1 for `STAY` and outside the grid. */
export function ahead(x: u32, y: u32, way: u32, width: u32, height: u32): i32 {
  if (way == 1) {
    if (y == 0) { return -1; }
    return i32((y - 1) * width + x);
  }
  if (way == 2) {
    if (x + 1 >= width) { return -1; }
    return i32(y * width + x + 1);
  }
  if (way == 3) {
    if (y + 1 >= height) { return -1; }
    return i32((y + 1) * width + x);
  }
  if (way == 4) {
    if (x == 0) { return -1; }
    return i32(y * width + x - 1);
  }
  return -1;
}
