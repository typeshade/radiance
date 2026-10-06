// === FlyControls: first-person free movement of a camera ===
//
// | Input                          | Move                                           |
// | ------------------------------ | ---------------------------------------------- |
// | Drag, one-finger drag          | look around: yaw about world up, pitch clamped |
// | W and S                        | forward and back along the view direction      |
// | A and D                        | strafe left and right                          |
// | Q and E                        | down and up along world up                     |
// | Shift (left or right)          | multiplies the speed by 4                      |
//
// The contract is the one of `OrbitControls`: `update(dt)` moves the camera and answers whether it
// moved, `moving` says whether the view is still changing so a path tracer can trace a preview,
// and the events are `start`, `change` and `end`. Movement integrates with `dt`, so it does not
// depend on the frame rate. There is no collision: the camera may pass through a wall. There is no
// pointer lock: a drag on the canvas turns the view, so the page needs no click to capture it.
// The keys are read by `KeyboardEvent.code`, so they do not depend on the keyboard layout.

import { EventDispatcher, Vector3, type Camera } from '@typeshade/radiance';

export type FlyControlsEvents = { start: undefined; change: undefined; end: undefined };

/** The pitch limit, in radians: 89 degrees, so the view never flips over a pole. */
const MAX_PITCH = (89 * Math.PI) / 180;
/** The speed factor while Shift is down. */
const BOOST = 4;

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

export class FlyControls extends EventDispatcher<FlyControlsEvents> {
  enabled = true;
  /** The speed of a key, in scene units a second. */
  movementSpeed = 1;
  /** The turn of a drag, in radians for each pixel. */
  rotationSpeed = 0.0025;

  readonly #camera: Camera;
  readonly #el: HTMLElement;
  #keys = new Set<string>();
  #pointers = new Map<number, { x: number; y: number }>();
  #saved: { position: Vector3; yaw: number; pitch: number } | undefined;
  #reported: string | undefined;
  #listeners: [EventTarget, string, EventListener][] = [];

  constructor(camera: Camera, domElement: HTMLElement) {
    super();
    this.#camera = camera;
    this.#el = domElement;
    this.saveState();
    const doc: EventTarget = domElement.ownerDocument ?? domElement;
    this.#listen(domElement, 'pointerdown', (e) => this.#onPointerDown(e as PointerEvent));
    this.#listen(domElement, 'pointermove', (e) => this.#onPointerMove(e as PointerEvent));
    this.#listen(domElement, 'pointerup', (e) => this.#onPointerUp(e as PointerEvent));
    this.#listen(domElement, 'pointercancel', (e) => this.#onPointerUp(e as PointerEvent));
    this.#listen(domElement, 'contextmenu', (e) => e.preventDefault());
    this.#listen(doc, 'keydown', (e) => this.#onKey(e as KeyboardEvent, true));
    this.#listen(doc, 'keyup', (e) => this.#onKey(e as KeyboardEvent, false));
    this.#listen(domElement, 'blur', () => this.#keys.clear());
    if (domElement.tabIndex < 0) domElement.tabIndex = 0;
    if (domElement.style) domElement.style.touchAction = 'none';
  }

  /** Whether the view is changing: a pointer is down or a movement key is held. */
  get moving(): boolean {
    return this.enabled && (this.#pointers.size > 0 || this.#direction().length() > 0);
  }

  /** Remember the camera's place and look, for `reset()`. */
  saveState(): void {
    this.#saved = {
      position: this.#camera.position.clone(),
      yaw: this.#camera.rotation.y,
      pitch: this.#camera.rotation.x,
    };
  }

  /** Return to the saved view. */
  reset(): void {
    if (this.#saved === undefined) return;
    this.#camera.position.copy(this.#saved.position);
    this.#camera.rotation.set(this.#saved.pitch, this.#saved.yaw, 0);
    this.#keys.clear();
  }

  /**
   * Move the camera for `dt` seconds of the keys held, and answer whether the camera's place or
   * look differs from the last call. The first call answers true.
   */
  update(dt = 1 / 60): boolean {
    const dir = this.#direction();
    if (this.enabled && dir.length() > 0) {
      const boost = this.#keys.has('ShiftLeft') || this.#keys.has('ShiftRight') ? BOOST : 1;
      const step = this.movementSpeed * boost * dt;
      const { forward, right } = this.#axes();
      this.#camera.position
        .addScaled(forward, dir.z * step)
        .addScaled(right, dir.x * step)
        .addScaled(new Vector3(0, 1, 0), dir.y * step);
    }
    const r = this.#camera.rotation;
    r.set(clamp(r.x, -MAX_PITCH, MAX_PITCH), r.y, 0);
    const key = `${this.#camera.position.toArray()}|${r.x},${r.y}`;
    const moved = key !== this.#reported;
    this.#reported = key;
    if (moved) this.dispatchEvent('change', undefined);
    return moved;
  }

  /** Remove every listener. */
  dispose(): void {
    for (const [target, type, fn] of this.#listeners) target.removeEventListener(type, fn);
    this.#listeners = [];
    this.#keys.clear();
    this.#pointers.clear();
  }

  #listen(target: EventTarget, type: string, fn: EventListener): void {
    target.addEventListener(type, fn);
    this.#listeners.push([target, type, fn]);
  }

  /** The view direction and the right-hand direction, from yaw and pitch. */
  #axes(): { forward: Vector3; right: Vector3 } {
    const { x: pitch, y: yaw } = this.#camera.rotation;
    const c = Math.cos(pitch);
    return {
      forward: new Vector3(-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c),
      right: new Vector3(Math.cos(yaw), 0, -Math.sin(yaw)),
    };
  }

  /** The held keys as x (right), y (up) and z (forward), each -1, 0 or 1. */
  #direction(): Vector3 {
    const k = this.#keys;
    const axis = (plus: string, minus: string): number =>
      Number(k.has(plus)) - Number(k.has(minus));
    return new Vector3(axis('KeyD', 'KeyA'), axis('KeyE', 'KeyQ'), axis('KeyW', 'KeyS'));
  }

  #onKey(e: KeyboardEvent, down: boolean): void {
    // A key let go always counts, so a key held while the controls turn off does not stay down.
    if (!this.enabled && down) return;
    const t = e.target as HTMLElement | null;
    if (t !== null && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName ?? '')))
      return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!/^(Key[WASDQE]|Shift(Left|Right))$/.test(e.code)) return;
    if (down) this.#keys.add(e.code);
    else this.#keys.delete(e.code);
    if (e.code.startsWith('Key')) e.preventDefault();
  }

  #onPointerDown(e: PointerEvent): void {
    if (!this.enabled) return;
    this.#el.focus({ preventScroll: true });
    if (this.#pointers.size === 0) this.dispatchEvent('start', undefined);
    this.#pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.#el.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  #onPointerMove(e: PointerEvent): void {
    const p = this.#pointers.get(e.pointerId);
    if (p === undefined || !this.enabled) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    const r = this.#camera.rotation;
    // The world follows the pointer, as under OrbitControls: a drag right turns the view left.
    r.set(
      clamp(r.x + dy * this.rotationSpeed, -MAX_PITCH, MAX_PITCH),
      r.y + dx * this.rotationSpeed,
      0,
    );
  }

  #onPointerUp(e: PointerEvent): void {
    if (!this.#pointers.delete(e.pointerId)) return;
    if (this.#el.hasPointerCapture(e.pointerId)) this.#el.releasePointerCapture(e.pointerId);
    if (this.#pointers.size === 0) this.dispatchEvent('end', undefined);
  }
}
