// The first reference game, as a project (design record 0108).
import { defineGame } from 'radiance';

export default defineGame({
  // One system makes a tick: every cell takes and gives in the same step.
  tick: ['flow'],
  values: ['width', 'height'],
});
