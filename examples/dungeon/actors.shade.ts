"use typeshade";
import { hash32, xorshift32 } from "typeshade/random";

// The second reference game, written on the raw structure: a small roguelike. A dungeon is a
// grid of tiles and a table of actors. One tick is one turn. Every actor acts in the same turn,
// from the state the last turn left.

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

/** One actor, or a free slot. Every field is an integer, so each tier gives the same bits. */
export class Actor {
  /** `NONE`, `PLAYER`, `RAT` or `ORC`. */
  kind: u32 = 0;
  x: u32 = 0;
  y: u32 = 0;
  hp: u32 = 0;
  /** The player's next move, from an input: `STAY` or a way. The turn sets it back to `STAY`. */
  move: u32 = 0;
  /** The state of the actor's random numbers. The simulation gives each first row its seed. */
  seed: u32 = 0;
  /** The monsters the player removed. */
  kills: u32 = 0;
}

/** One tile of the grid. */
export class Tile {
  kind: u32 = 0;
}

/** The index of the cell one step from (x, y) in a way, or -1 for `STAY` and outside the grid. */
function ahead(x: u32, y: u32, way: u32, width: u32, height: u32): i32 {
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

/** The way an actor wants to go in this turn. `p` is the player's row. */
function wish(a: Actor, p: Actor): u32 {
  if (a.kind == PLAYER) { return a.move; }
  if (a.kind == RAT) { return xorshift32(a.seed) % 5; }
  if (a.kind == ORC) {
    if (p.kind != PLAYER) { return STAY; }
    const dx: i32 = i32(p.x) - i32(a.x);
    const dy: i32 = i32(p.y) - i32(a.y);
    let ax: i32 = dx;
    if (ax < 0) { ax = -ax; }
    let ay: i32 = dy;
    if (ay < 0) { ay = -ay; }
    if (ax >= ay) {
      if (dx > 0) { return 2; }
      if (dx < 0) { return 4; }
      return STAY;
    }
    if (dy > 0) { return 3; }
    return 1;
  }
  return STAY;
}

/** True when one of the two is the player and the other is a monster. */
function hostile(a: u32, b: u32): bool {
  if (a == NONE || b == NONE) { return false; }
  return (a == PLAYER) != (b == PLAYER);
}

/**
 * One turn of the actors. It reads `prev` and writes `next`.
 *
 * An actor that goes at a cell with an enemy attacks it and stays. An actor goes into a cell
 * when the cell is a floor or a potion, no actor was in it, and no actor of a lower row goes
 * at the same cell. An actor with no hit points left becomes a free slot. On a spawn turn the
 * first free slot becomes a monster on the spawn tile (sx, sy). A level with no spawn tile
 * gives `sx` as `width`.
 */
export function turn(
  next: array<Actor>,
  prev: array<Actor>,
  tiles: array<Tile>,
  width: u32,
  height: u32,
  tick: u32,
  seed: u32,
  sx: u32,
  sy: u32,
) {
  for (let i: u32 = 0; i < next.length; i++) {
    let a: Actor = prev[i];
    const p: Actor = prev[0];

    if (a.kind == NONE) {
      // A free slot. Does a monster come in here?
      let spawns: bool = tick > 0 && tick % SPAWN_PERIOD == 0 && sx < width;
      for (let j: u32 = 0; j < prev.length; j++) {
        const b: Actor = prev[j];
        if (j < i && b.kind == NONE) { spawns = false; }
        if (b.kind != NONE && b.x == sx && b.y == sy) { spawns = false; }
      }
      if (spawns) {
        const word: u32 = hash32(seed ^ (tick * 2654435761) ^ i);
        a.kind = RAT;
        a.hp = RAT_HP;
        if ((word & 1) == 1) {
          a.kind = ORC;
          a.hp = ORC_HP;
        }
        a.x = sx;
        a.y = sy;
        a.move = STAY;
        a.seed = word | 1;
        a.kills = 0;
      }
    } else {
      const here: i32 = i32(a.y * width + a.x);
      const way: u32 = wish(a, p);
      const target: i32 = ahead(a.x, a.y, way, width, height);

      // One pass over the actors: who is in the target cell, who of a lower row goes at it,
      // and who attacks this actor.
      let occupant: i32 = -1;
      let beaten: bool = false;
      let damage: u32 = 0;
      for (let j: u32 = 0; j < prev.length; j++) {
        const b: Actor = prev[j];
        if (b.kind != NONE && j != i) {
          const at: i32 = i32(b.y * width + b.x);
          const goes: i32 = ahead(b.x, b.y, wish(b, p), width, height);
          if (at == target) { occupant = i32(j); }
          if (j < i && goes == target) { beaten = true; }
          if (goes == here && hostile(a.kind, b.kind)) {
            if (b.kind == PLAYER) {
              damage = damage + PLAYER_DAMAGE;
            } else {
              damage = damage + MONSTER_DAMAGE;
            }
          }
        }
      }

      if (target >= 0) {
        if (occupant >= 0) {
          const o: Actor = prev[u32(occupant)];
          if (a.kind == PLAYER && hostile(a.kind, o.kind) && o.hp <= PLAYER_DAMAGE) {
            a.kills = a.kills + 1;
          }
        } else {
          const t: u32 = tiles[u32(target)].kind;
          if ((t == FLOOR || t == POTION) && !beaten) {
            a.x = u32(target) % width;
            a.y = u32(target) / width;
            if (a.kind == PLAYER && t == POTION) { a.hp = min(a.hp + POTION_HEAL, MAX_HP); }
          }
        }
      }

      a.move = STAY;
      if (a.kind == RAT) { a.seed = xorshift32(a.seed); }
      if (a.hp <= damage) {
        a.kind = NONE;
        a.hp = 0;
      } else {
        a.hp = a.hp - damage;
      }
    }

    next[i] = a;
  }
}

/** One turn of the tiles: a potion that the player walks onto in this turn becomes a floor. */
export function pickup(
  next: array<Tile>,
  prev: array<Tile>,
  actors: array<Actor>,
  width: u32,
  height: u32,
) {
  for (let i: u32 = 0; i < next.length; i++) {
    let t: Tile = prev[i];
    const p: Actor = actors[0];
    if (t.kind == POTION && p.kind == PLAYER) {
      let taken: bool = ahead(p.x, p.y, p.move, width, height) == i32(i);
      for (let j: u32 = 0; j < actors.length; j++) {
        const b: Actor = actors[j];
        if (b.kind != NONE && b.y * width + b.x == i) { taken = false; }
      }
      if (taken) { t.kind = FLOOR; }
    }
    next[i] = t;
  }
}
