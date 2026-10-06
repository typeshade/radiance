// swapControls, held to the four facts the KeyF swap promises: the mode and the active controls
// flip, `enabled` follows the mode, the camera keeps its place and look across fly to orbit, and
// `dispose()` leaves no listener on the document. The canvas is a bare event target.
// Verifies: Design 0008 Amendment 2, step "KeyF swaps the controls".

import { describe, expect, it } from 'bun:test';
import { PerspectiveCamera } from '@typeshade/radiance';
import { FlyControls, OrbitControls } from '@typeshade/radiance-addons';
import { swapControls } from '../site/src/lib/swap-controls.ts';

class FakeDocument extends EventTarget {
  count = 0;
  override addEventListener(...a: Parameters<EventTarget['addEventListener']>): void {
    this.count++;
    super.addEventListener(...a);
  }
  override removeEventListener(...a: Parameters<EventTarget['removeEventListener']>): void {
    this.count--;
    super.removeEventListener(...a);
  }
}

class FakeCanvas extends EventTarget {
  tabIndex = -1;
  style = { touchAction: '' };
  clientWidth = 800;
  clientHeight = 600;
  ownerDocument = new FakeDocument();
  focus(): void {}
  setPointerCapture(): void {}
  releasePointerCapture(): void {}
  hasPointerCapture(): boolean {
    return false;
  }
  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return { left: 0, top: 0, width: 800, height: 600 };
  }
}

function key(canvas: FakeCanvas, type: 'keydown' | 'keyup', code: string): void {
  canvas.ownerDocument.dispatchEvent(
    Object.assign(new Event(type, { cancelable: true }), { code, repeat: false }),
  );
}

function setup() {
  const camera = new PerspectiveCamera(70);
  camera.position.set(-6.8, 5.8, 0.4);
  const canvas = new FakeCanvas();
  const orbit = new OrbitControls(camera, canvas as unknown as HTMLElement);
  orbit.target.set(2, 4.2, 0);
  orbit.update();
  const fly = new FlyControls(camera, canvas as unknown as HTMLElement);
  fly.movementSpeed = 3;
  const swap = swapControls(camera, canvas as unknown as HTMLElement, fly, orbit, 'fly');
  return { camera, canvas, fly, orbit, swap };
}

describe('swapControls', () => {
  it('flips mode and active on KeyF', () => {
    const { canvas, fly, orbit, swap } = setup();
    expect(swap.mode).toBe('fly');
    expect(swap.active).toBe(fly);
    key(canvas, 'keydown', 'KeyF');
    expect(swap.mode).toBe('orbit');
    expect(swap.active).toBe(orbit);
    key(canvas, 'keydown', 'KeyF');
    expect(swap.mode).toBe('fly');
    expect(swap.active).toBe(fly);
  });

  it('sets enabled on fly and orbit', () => {
    const { canvas, fly, orbit } = setup();
    expect([fly.enabled, orbit.enabled]).toEqual([true, false]);
    key(canvas, 'keydown', 'KeyF');
    expect([fly.enabled, orbit.enabled]).toEqual([false, true]);
    key(canvas, 'keydown', 'KeyF');
    expect([fly.enabled, orbit.enabled]).toEqual([true, false]);
  });

  it('keeps the camera position to 1e-6 and the rotation to 1e-12 across fly to orbit', () => {
    const { camera, canvas, fly, swap } = setup();
    key(canvas, 'keydown', 'KeyW');
    for (let i = 0; i < 30; i++) fly.update(1 / 60);
    key(canvas, 'keyup', 'KeyW');
    swap.update(0);
    const position = camera.position.clone();
    const rotation = [camera.rotation.x, camera.rotation.y, camera.rotation.z];
    key(canvas, 'keydown', 'KeyF');
    expect(swap.mode).toBe('orbit');
    expect(camera.position.distanceTo(position)).toBeLessThan(1e-6);
    // The orbit aims the camera again with `lookAt`, so the angles may differ by rounding, 2e-16.
    const now = [camera.rotation.x, camera.rotation.y, camera.rotation.z];
    for (let i = 0; i < 3; i++) expect(Math.abs(now[i]! - rotation[i]!)).toBeLessThan(1e-12);
  });

  it('leaves no listener on the document after dispose()', () => {
    const { canvas, swap } = setup();
    expect(canvas.ownerDocument.count).toBeGreaterThan(0);
    swap.dispose();
    expect(canvas.ownerDocument.count).toBe(0);
  });
});
