// The first reference game, as a project (design record 0108).
import { defineGame } from 'radiance';

export default defineGame({
  name: 'Factory',
  // One system makes a tick: every cell takes and gives in the same step.
  tick: ['tick'],
  values: ['width', 'height'],
  // The page starts with this level. A budget holds the script that the page loads.
  start: { level: 'demo', seed: 1 },
  budget: 300_000,
});
