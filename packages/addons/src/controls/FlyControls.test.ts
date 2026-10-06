// FlyControls, held to a fixed key state and a fixed dt. The element is a bare event target, so
// the test needs no DOM. Keys arrive as events with a `code`, as the browser sends them.

import { describe, expect, it } from 'bun:test';
import { PerspectiveCamera, Vector3 } from '@typeshade/radiance';
import { FlyControls } from './FlyControls.ts';

class FakeElement extends EventTarget {
  tabIndex = -1;
  style = { touchAction: '' };
  ownerDocument = new EventTarget();
  focus(): void {}
  setPointerCapture(): void {}
  releasePointerCapture(): void {}
  hasPointerCapture(): boolean {
    return false;
  }
}

function key(el: FakeElement, type: 'keydown' | 'keyup', code: string): void {
  // A key event on the canvas bubbles to its document, where the controls listen.
  el.ownerDocument.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { code }));
}

function pointer(el: FakeElement, type: string, x: number, y: number): void {
  el.dispatchEvent(
    Object.assign(new Event(type, { cancelable: true }), { pointerId: 1, clientX: x, clientY: y }),
  );
}

function setup(): { camera: PerspectiveCamera; el: FakeElement; controls: FlyControls } {
  const camera = new PerspectiveCamera(70);
  const el = new FakeElement();
  const controls = new FlyControls(camera, el as unknown as HTMLElement);
  return { camera, el, controls };
}

describe('FlyControls', () => {
  it('moves 3 units along the view direction after 1 s of KeyW at speed 3', () => {
    const { camera, el, controls } = setup();
    camera.position.set(1, 2, 3);
    camera.lookAt(new Vector3(4, 4, -3));
    const dir = new Vector3(4, 4, -3).sub(new Vector3(1, 2, 3)).normalize();
    controls.saveState();
    controls.movementSpeed = 3;
    key(el, 'keydown', 'KeyW');
    expect(controls.moving).toBe(true);
    for (let i = 0; i < 60; i++) controls.update(1 / 60);
    const moved = camera.position.clone().sub(new Vector3(1, 2, 3));
    expect(moved.distanceTo(dir.multiplyScalar(3))).toBeLessThan(1e-6);
  });

  it('does not depend on the frame rate', () => {
    const a = setup();
    const b = setup();
    for (const c of [a, b]) {
      c.controls.movementSpeed = 3;
      key(c.el, 'keydown', 'KeyD');
      key(c.el, 'keydown', 'KeyE');
    }
    for (let i = 0; i < 60; i++) a.controls.update(1 / 60);
    for (let i = 0; i < 10; i++) b.controls.update(0.1);
    expect(a.camera.position.distanceTo(b.camera.position)).toBeLessThan(1e-9);
    expect(a.camera.position.x).toBeCloseTo(3, 9);
    expect(a.camera.position.y).toBeCloseTo(3, 9);
  });

  it('strafes, goes down and boosts with Shift', () => {
    const { camera, el, controls } = setup();
    key(el, 'keydown', 'KeyA');
    key(el, 'keydown', 'KeyQ');
    key(el, 'keydown', 'ShiftLeft');
    controls.update(1);
    const [x, y, z] = camera.position.toArray();
    expect([x, y, Math.abs(z)]).toEqual([-4, -4, 0]);
    key(el, 'keyup', 'KeyA');
    key(el, 'keyup', 'KeyQ');
    key(el, 'keyup', 'ShiftLeft');
    expect(controls.moving).toBe(false);
  });

  it('clamps the pitch to 89 degrees and keeps no roll', () => {
    const { camera, el, controls } = setup();
    pointer(el, 'pointerdown', 0, 0);
    pointer(el, 'pointermove', 40, 100000);
    expect(controls.moving).toBe(true);
    controls.update(0);
    expect(camera.rotation.x).toBeCloseTo((89 * Math.PI) / 180, 12);
    pointer(el, 'pointermove', 40, -200000);
    controls.update(0);
    expect(camera.rotation.x).toBeCloseTo(-(89 * Math.PI) / 180, 12);
    expect(camera.rotation.z).toBe(0);
    pointer(el, 'pointerup', 0, 0);
    expect(controls.moving).toBe(false);
  });

  it('answers whether it moved, and fires change, start and end', () => {
    const { el, controls } = setup();
    const seen: string[] = [];
    for (const t of ['start', 'change', 'end'] as const)
      controls.addEventListener(t, () => seen.push(t));
    expect(controls.update(0)).toBe(true);
    expect(controls.update(0)).toBe(false);
    pointer(el, 'pointerdown', 0, 0);
    pointer(el, 'pointermove', 10, 0);
    expect(controls.update(0)).toBe(true);
    pointer(el, 'pointerup', 0, 0);
    expect(seen).toEqual(['change', 'start', 'change', 'end']);
  });

  it('resets to the saved view, and dispose removes every listener', () => {
    const { camera, el, controls } = setup();
    camera.position.set(0, 1, 0);
    controls.saveState();
    key(el, 'keydown', 'KeyW');
    controls.update(1);
    controls.reset();
    expect(camera.position.distanceTo(new Vector3(0, 1, 0))).toBe(0);
    controls.dispose();
    key(el, 'keydown', 'KeyW');
    expect(controls.moving).toBe(false);
    pointer(el, 'pointerdown', 0, 0);
    expect(controls.moving).toBe(false);
  });
});
