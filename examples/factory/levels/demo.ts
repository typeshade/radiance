// The level of the page and of the browser check.
import { parseLevel } from '../cells.ts';

export const DEMO = `
  E>>>v....S
  ....v....v
  M<<<<....v
  ..........
  N..M<<<<<<
  ^.........
`;

export default parseLevel(DEMO);
