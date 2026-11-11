"use typeshade";
import { xorshift32 } from "typeshade/random";
import { NONE, ORC, PLAYER, RAT, STAY } from "../rules.shade.ts";

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
  /** True when the row is a free slot. */
  free(): bool {
    return this.kind == NONE;
  }
}

/** The actors are a table with free slots. A monster comes in on a free row. */
export const slots = 16;

/** The way an actor wants to go in this turn. `p` is the player's row. */
export function wish(a: Actor, p: Actor): u32 {
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
export function hostile(a: u32, b: u32): bool {
  if (a == NONE || b == NONE) { return false; }
  return (a == PLAYER) != (b == PLAYER);
}
