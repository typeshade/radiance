// The first reference game, as a project (design record 0108).
import { defineGame } from 'radiance';

export default defineGame({
  name: 'Factory',
  // One system makes a tick: every cell takes and gives in the same step.
  tick: ['tick'],
  values: ['width', 'height'],
  // One layer draws the cells. The view shows the whole 10 by 6 rectangle of the level on any screen.
  draw: ['cells'],
  view: { fit: [10, 6], clear: [0.03, 0.03, 0.04] },
  // The page starts with this level. A budget holds the script that the page loads.
  start: { level: 'demo', seed: 1 },
  budget: 300_000,
});
