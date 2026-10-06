// KeyF swaps a camera between fly and orbit controls. Both objects stay alive on the canvas. The
// inactive one has `enabled = false`, so it ignores input, and `dispose()` removes both. The
// camera keeps its place and look across a swap: to orbit, the target goes one orbit radius ahead
// of the camera along its view direction, and to fly, the camera is already where it looks from.

import type { Camera } from '@typeshade/radiance';
import { Vector3 } from '@typeshade/radiance';
import type { FlyControls, OrbitControls } from '@typeshade/radiance-addons';

export type ControlMode = 'fly' | 'orbit';

export interface ControlSwap {
  /** The controls that take input now. */
  readonly active: FlyControls | OrbitControls;
  readonly mode: ControlMode;
  /** Whether the active controls are changing the view. */
  readonly moving: boolean;
  /** Advance the active controls and answer whether the camera moved. */
  update(dt: number): boolean;
  /** Swap to the other mode, as KeyF does. */
  toggle(): void;
  dispose(): void;
}

export function swapControls(
  camera: Camera,
  canvas: HTMLElement,
  fly: FlyControls,
  orbit: OrbitControls,
  start: ControlMode,
  /** Called with the new mode after each swap, so a caller can follow the active control kind. */
  onSwap?: (mode: ControlMode) => void,
): ControlSwap {
  let mode: ControlMode = start;
  const apply = (): void => {
    fly.enabled = mode === 'fly';
    orbit.enabled = mode === 'orbit';
  };
  apply();

  const toggle = (): void => {
    if (mode === 'fly') {
      const { x: pitch, y: yaw } = camera.rotation;
      const c = Math.cos(pitch);
      const ahead = new Vector3(-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c);
      orbit.target.copy(camera.position).addScaled(ahead, Math.max(orbit.getDistance(), 0.05));
      mode = 'orbit';
      apply();
      orbit.update(0);
    } else {
      mode = 'fly';
      apply();
    }
    onSwap?.(mode);
  };

  const onKey = (e: Event): void => {
    const k = e as KeyboardEvent;
    const t = k.target as HTMLElement | null;
    if (k.code !== 'KeyF' || k.repeat || k.ctrlKey || k.metaKey || k.altKey) return;
    if (t !== null && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName ?? '')))
      return;
    toggle();
  };
  const doc = canvas.ownerDocument;
  doc.addEventListener('keydown', onKey);

  return {
    get active() {
      return mode === 'fly' ? fly : orbit;
    },
    get mode() {
      return mode;
    },
    get moving() {
      return (mode === 'fly' ? fly : orbit).moving;
    },
    update: (dt) => (mode === 'fly' ? fly : orbit).update(dt),
    toggle,
    dispose() {
      doc.removeEventListener('keydown', onKey);
      fly.dispose();
      orbit.dispose();
    },
  };
}
