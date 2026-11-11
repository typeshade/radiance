// The second reference game, as a project (design record 0108).
import { defineGame } from 'radiance';

export default defineGame({
  // One tick is one turn. `plan` writes what each actor wants, `turn` reads it for every
  // actor, and `pickup` reads the actors that `turn` wrote.
  tick: ['plan', 'turn', 'pickup'],
  // A game with turns: a tick runs when the player gives an input.
  stepOn: 'input',
  values: ['width', 'height', 'sx', 'sy'],
  scratch: { wants: 'actors' },
});
