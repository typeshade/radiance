"use typeshade";

/** What one actor wants in a turn. It is written first and read by every actor. */
export class Want {
  /** The index of the cell the actor goes at, or -1 when it stays or is a free slot. */
  target: i32 = -1;
}
