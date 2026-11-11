"use typeshade";
import { hash32, xorshift32 } from "typeshade/random";
import {
  FLOOR,
  MAX_HP,
  MONSTER_DAMAGE,
  NONE,
  ORC,
  ORC_HP,
  PLAYER,
  PLAYER_DAMAGE,
  POTION,
  POTION_HEAL,
  RAT,
  RAT_HP,
  SPAWN_PERIOD,
  STAY,
} from "../rules.shade.ts";
import { Want } from "../scratch/wants.shade.ts";
import { Actor, hostile } from "../state/actors.shade.ts";
import { Tile } from "../state/tiles.shade.ts";

/**
 * The second phase of a turn: what comes of what the actors want. It reads `actors` and `wants`
 * and writes `actorsNext`.
 *
 * An actor that goes at a cell with an enemy attacks it and stays. An actor goes into a cell
 * when the cell is a floor or a potion, no actor was in it, and no actor of a lower row goes
 * at the same cell. An actor with no hit points left becomes a free slot. On a spawn turn the
 * first free slot becomes a monster on the spawn tile (sx, sy). A level with no spawn tile
 * gives `sx` as `width`.
 */
export function turn(
  actorsNext: array<Actor>,
  actors: array<Actor>,
  wants: array<Want>,
  tiles: array<Tile>,
  width: u32,
  tick: u32,
  sx: u32,
  sy: u32,
) {
  for (let i: u32 = 0; i < actorsNext.length; i++) {
    let a: Actor = actors[i];

    if (a.kind == NONE) {
      // A free slot. Does a monster come in here?
      let spawns: bool = tick > 0 && tick % SPAWN_PERIOD == 0 && sx < width;
      for (let j: u32 = 0; j < actors.length; j++) {
        const b: Actor = actors[j];
        if (j < i && b.kind == NONE) { spawns = false; }
        if (b.kind != NONE && b.x == sx && b.y == sy) { spawns = false; }
      }
      if (spawns) {
        // The slot has a seed of its own. The tick makes each monster of the slot differ.
        const word: u32 = hash32(a.seed ^ tick);
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
      const target: i32 = wants[i].target;

      // One pass over the actors: who is in the target cell, who of a lower row goes at it,
      // and who attacks this actor.
      let occupant: i32 = -1;
      let beaten: bool = false;
      let damage: u32 = 0;
      for (let j: u32 = 0; j < actors.length; j++) {
        const b: Actor = actors[j];
        if (b.kind != NONE && j != i) {
          const at: i32 = i32(b.y * width + b.x);
          const goes: i32 = wants[j].target;
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
          const o: Actor = actors[u32(occupant)];
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

    actorsNext[i] = a;
  }
}
