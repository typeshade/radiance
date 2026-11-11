// The first reference game, as a project (design record 0108).
import { defineGame } from 'radiance';

export default defineGame({
  name: 'Factory',
  // One system makes a tick: every cell takes and gives in the same step.
  tick: ['tick'],
  values: ['width', 'height'],
  // The layer `cells` draws the cells. The layer `items` draws the items of the belts over it with
  // an alpha blend. The view shows the whole 10 by 6 rectangle of the level on any screen.
  draw: ['cells', { layer: 'items', blend: 'alpha' }],
  view: { fit: [10, 6], clear: [0.03, 0.03, 0.04] },
  // The page starts with this level. A budget holds the script that the page loads.
  start: { level: 'demo', seed: 1 },
  // The page keeps one save of the run on the device (design record 0112). The version is the
  // version of the state that the save holds.
  save: { version: 1 },
  budget: 320_000,
});
