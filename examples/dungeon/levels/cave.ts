// The level of the long run.
import { parseLevel } from './parse.ts';

export const CAVE = `
  ##########
  #@..r...!#
  #..##..r.#
  #r.#S..o.#
  #....!...#
  ##########
`;

export default parseLevel(CAVE);
