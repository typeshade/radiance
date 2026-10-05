// === OrbitControls: mouse, touch, pen and keyboard turn a camera about a target ===
//
// | Input                                   | Move                                    |
// | --------------------------------------- | --------------------------------------- |
// | Left drag; one-finger drag              | orbit about the target                  |
// | Right or middle drag; Shift + left drag | pan: the target slides with the pointer |
// | Wheel; trackpad pinch (ctrl + wheel)    | dolly toward or away from the target    |
// | Two-finger pinch and drag               | dolly and pan together                  |
// | Double-click; R or Home                 | back to the saved view                  |
// | Arrows (Shift: pan); + and -            | orbit, pan, dolly by a step             |
//
// The names follow three.js's OrbitControls: `target`, `enableDamping`, `dampingFactor`,
// `minDistance`, `maxDistance`, `minPolarAngle`, `maxPolarAngle`, `minAzimuthAngle`,
// `maxAzimuthAngle`, `update()`, `saveState()`, `reset()`, and the events `start`, `change` and
// `end`. `update(dt)` moves the camera and answers whether it moved; `moving` says whether the
// view is still changing, so a path tracer can trace a preview meanwhile.

import { Box3, EventDispatcher, Vector3, type Camera } from '@typeshade/radiance';

export type OrbitControlsEvents = { start: undefined; change: undefined; end: undefined };

/** How long after the last wheel event the view still counts as moving, in milliseconds. */
const WHEEL_SETTLE_MS = 150;
/** Below this speed, in radians a second, a coasting turn stops. */
const REST_SPEED = 0.01;
const KEY_TURN = 0.08;
const KEY_PAN = 24;
const KEY_ZOOM = 1.15;

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

export class OrbitControls extends EventDispatcher<OrbitControlsEvents> {
  /** What the camera turns about and looks at. */
  readonly target = new Vector3();
  enabled = true;
  /** A released turn keeps going and slows, as a turntable does. */
  enableDamping = true;
  /** The fraction of a coasting turn's speed lost each second. */
  dampingFactor = 0.92;
  /** Radians of turn for a drag across the element's height. */
  rotateSpeed = 2 * Math.PI;
  /** The dolly factor per wheel pixel, as an exponent. */
  zoomSpeed = 0.0015;
  minDistance = 0;
  maxDistance = Infinity;
  /** The angle from straight up, in radians: 0 looks down from above, pi from below. */
  minPolarAngle = 0.01;
  maxPolarAngle = Math.PI - 0.01;
  /** The angle about +y, in radians, from +z; unbounded by default. */
  minAzimuthAngle = -Infinity;
  maxAzimuthAngle = Infinity;
  /** The box the target stays in when panning. */
  targetBounds = new Box3();

  readonly #camera: Camera;
  readonly #el: HTMLElement;
  #radius = 1;
  #polar = Math.PI / 2;
  #azimuth = 0;
  #spin = { azimuth: 0, polar: 0 };
  #lastWheel = -Infinity;
  #pointers = new Map<number, { x: number; y: number; mode: 'orbit' | 'pan' }>();
  #trail: { t: number; azimuth: number; polar: number }[] = [];
  #saved: { target: Vector3; position: Vector3 } | undefined;
  #reported: string | undefined;
  /** Where update() last put the camera and the target, to notice a move made from outside. */
  #placed: { position: Vector3; target: Vector3 } | undefined;
  #listeners: [string, EventListener, AddEventListenerOptions?][] = [];

  constructor(camera: Camera, domElement: HTMLElement) {
    super();
    this.#camera = camera;
    this.#el = domElement;
    this.#readCamera();
    this.saveState();
    this.#listen('pointerdown', (e) => this.#onPointerDown(e as PointerEvent));
    this.#listen('pointermove', (e) => this.#onPointerMove(e as PointerEvent));
    this.#listen('pointerup', (e) => this.#onPointerUp(e as PointerEvent));
    this.#listen('pointercancel', (e) => this.#onPointerUp(e as PointerEvent));
    this.#listen('wheel', (e) => this.#onWheel(e as WheelEvent), { passive: false });
    this.#listen('keydown', (e) => this.#onKeyDown(e as KeyboardEvent));
    this.#listen('contextmenu', (e) => e.preventDefault());
    this.#listen('dblclick', () => this.reset());
    if (domElement.tabIndex < 0) domElement.tabIndex = 0;
    domElement.style.touchAction = 'none';
  }

  /** Whether the view is changing: a pointer is down, the turn coasts, or a wheel just turned. */
  get moving(): boolean {
    return (
      this.#pointers.size > 0 ||
      this.#spin.azimuth !== 0 ||
      this.#spin.polar !== 0 ||
      performance.now() - this.#lastWheel < WHEEL_SETTLE_MS
    );
  }

  /** The distance from the target to the camera. */
  getDistance(): number {
    return this.#radius;
  }

  /** Remember the camera and target, for `reset()`. */
  saveState(): void {
    this.#saved = { target: this.target.clone(), position: this.#camera.position.clone() };
  }

  /** Return to the saved view. */
  reset(): void {
    if (this.#saved === undefined) return;
    this.target.copy(this.#saved.target);
    this.#camera.position.copy(this.#saved.position);
    this.#readCamera();
    this.#placed = { position: this.#camera.position.clone(), target: this.target.clone() };
    this.#spin = { azimuth: 0, polar: 0 };
  }

  /**
   * Advance a coasting turn by `dt` seconds, place the camera, and answer whether it moved since
   * the last call. A change to `target` or the camera's position made by the application is
   * taken in here too.
   */
  update(dt = 1 / 60): boolean {
    if (
      this.#placed !== undefined &&
      (!this.#placed.position.equals(this.#camera.position) ||
        !this.#placed.target.equals(this.target))
    )
      this.#readCamera();
    if (this.#pointers.size === 0 && (this.#spin.azimuth !== 0 || this.#spin.polar !== 0)) {
      this.#turn(this.#spin.azimuth * dt, this.#spin.polar * dt);
      const keep = this.enableDamping ? Math.pow(1 - this.dampingFactor, dt) : 0;
      this.#spin = { azimuth: this.#spin.azimuth * keep, polar: this.#spin.polar * keep };
      if (Math.hypot(this.#spin.azimuth, this.#spin.polar) < REST_SPEED)
        this.#spin = { azimuth: 0, polar: 0 };
    }
    this.#clampState();
    const s = Math.sin(this.#polar);
    this.#camera.position.set(
      this.target.x + this.#radius * s * Math.sin(this.#azimuth),
      this.target.y + this.#radius * Math.cos(this.#polar),
      this.target.z + this.#radius * s * Math.cos(this.#azimuth),
    );
    this.#camera.lookAt(this.target);
    this.#placed = { position: this.#camera.position.clone(), target: this.target.clone() };
    const key = `${this.#camera.position.toArray()}|${this.target.toArray()}`;
    const moved = key !== this.#reported;
    this.#reported = key;
    if (moved) this.dispatchEvent('change', undefined);
    return moved;
  }

  /** Remove every listener from the element. */
  dispose(): void {
    for (const [type, fn, options] of this.#listeners)
      this.#el.removeEventListener(type, fn, options);
    this.#listeners = [];
  }

  #listen(type: string, fn: EventListener, options?: AddEventListenerOptions): void {
    this.#el.addEventListener(type, fn, options);
    this.#listeners.push([type, fn, options]);
  }

  /** Read the camera's place about the target into the spherical state. */
  #readCamera(): void {
    const d = this.#camera.position.clone().sub(this.target);
    this.#radius = Math.max(1e-6, d.length());
    this.#polar = Math.acos(clamp(d.y / this.#radius, -1, 1));
    this.#azimuth = Math.atan2(d.x, d.z);
    this.#clampState();
  }

  #clampState(): void {
    this.#radius = clamp(this.#radius, this.minDistance, this.maxDistance);
    this.#polar = clamp(this.#polar, this.minPolarAngle, this.maxPolarAngle);
    this.#azimuth = clamp(this.#azimuth, this.minAzimuthAngle, this.maxAzimuthAngle);
    this.targetBounds.clampPoint(this.target, this.target);
  }

  #height(): number {
    return Math.max(1, this.#el.clientHeight);
  }

  #turn(dAzimuth: number, dPolar: number): void {
    this.#azimuth += dAzimuth;
    this.#polar += dPolar;
    this.#clampState();
  }

  #dolly(factor: number): void {
    this.#radius *= factor;
    this.#clampState();
  }

  /** Slide the target across the view so a point at its depth follows the pointer. */
  #pan(dx: number, dy: number): void {
    const fov = 'fov' in this.#camera ? (this.#camera.fov as number) : 50;
    const perPixel = (2 * this.#radius * Math.tan((fov * Math.PI) / 360)) / this.#height();
    this.#camera.updateMatrixWorld();
    const e = this.#camera.matrixWorld.elements;
    const right = new Vector3(e[0], e[1], e[2]).normalize();
    const up = new Vector3(e[4], e[5], e[6]).normalize();
    this.target.addScaled(right, -dx * perPixel).addScaled(up, dy * perPixel);
    this.#clampState();
    this.#placed?.target.copy(this.target);
  }

  #onPointerDown(e: PointerEvent): void {
    if (!this.enabled) return;
    this.#el.focus({ preventScroll: true });
    const panning =
      e.button === 1 ||
      e.button === 2 ||
      (e.button === 0 && (e.shiftKey || e.ctrlKey || e.metaKey));
    if (this.#pointers.size === 0) this.dispatchEvent('start', undefined);
    this.#pointers.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY,
      mode: panning ? 'pan' : 'orbit',
    });
    this.#el.setPointerCapture(e.pointerId);
    this.#spin = { azimuth: 0, polar: 0 };
    this.#trail = [];
    e.preventDefault();
  }

  #pinch(): { d: number; x: number; y: number } | undefined {
    if (this.#pointers.size < 2) return undefined;
    const [a, b] = [...this.#pointers.values()];
    return { d: Math.hypot(a!.x - b!.x, a!.y - b!.y), x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
  }

  #onPointerMove(e: PointerEvent): void {
    const p = this.#pointers.get(e.pointerId);
    if (p === undefined) return;
    const before = this.#pinch();
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (before !== undefined) {
      // Two pointers: their spread dollies, their midpoint pans.
      const after = this.#pinch()!;
      if (after.d > 0 && before.d > 0) this.#dolly(before.d / after.d);
      this.#pan(after.x - before.x, after.y - before.y);
      return;
    }
    if (p.mode === 'pan') {
      this.#pan(dx, dy);
      return;
    }
    const k = this.rotateSpeed / this.#height();
    this.#turn(-dx * k, -dy * k);
    const now = performance.now();
    this.#trail.push({ t: now, azimuth: this.#azimuth, polar: this.#polar });
    this.#trail = this.#trail.filter((s) => now - s.t <= 100);
  }

  #onPointerUp(e: PointerEvent): void {
    const p = this.#pointers.get(e.pointerId);
    this.#pointers.delete(e.pointerId);
    if (this.#el.hasPointerCapture(e.pointerId)) this.#el.releasePointerCapture(e.pointerId);
    // A turn let go with speed keeps it: the mean speed over the drag's last 100 ms.
    if (
      this.enableDamping &&
      p?.mode === 'orbit' &&
      this.#pointers.size === 0 &&
      this.#trail.length >= 2
    ) {
      const first = this.#trail[0]!;
      const last = this.#trail[this.#trail.length - 1]!;
      const dt = (last.t - first.t) / 1000;
      if (dt > 0 && performance.now() - last.t < 50)
        this.#spin = {
          azimuth: (last.azimuth - first.azimuth) / dt,
          polar: (last.polar - first.polar) / dt,
        };
    }
    this.#trail = [];
    if (this.#pointers.size === 0) this.dispatchEvent('end', undefined);
  }

  #onWheel(e: WheelEvent): void {
    if (!this.enabled) return;
    e.preventDefault();
    // Lines and pages become pixels; a trackpad pinch arrives as ctrl + wheel.
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.#height() : 1;
    this.#dolly(Math.exp(e.deltaY * unit * (e.ctrlKey ? this.zoomSpeed * 4 : this.zoomSpeed)));
    this.#lastWheel = performance.now();
  }

  #onKeyDown(e: KeyboardEvent): void {
    if (!this.enabled) return;
    const pan = e.shiftKey;
    const moves: Record<string, () => void> = {
      ArrowLeft: () => (pan ? this.#pan(KEY_PAN, 0) : this.#turn(KEY_TURN, 0)),
      ArrowRight: () => (pan ? this.#pan(-KEY_PAN, 0) : this.#turn(-KEY_TURN, 0)),
      ArrowUp: () => (pan ? this.#pan(0, KEY_PAN) : this.#turn(0, KEY_TURN)),
      ArrowDown: () => (pan ? this.#pan(0, -KEY_PAN) : this.#turn(0, -KEY_TURN)),
      '+': () => this.#dolly(1 / KEY_ZOOM),
      '=': () => this.#dolly(1 / KEY_ZOOM),
      '-': () => this.#dolly(KEY_ZOOM),
      _: () => this.#dolly(KEY_ZOOM),
      r: () => this.reset(),
      R: () => this.reset(),
      Home: () => this.reset(),
    };
    const move = moves[e.key];
    if (move === undefined) return;
    move();
    this.#spin = { azimuth: 0, polar: 0 };
    e.preventDefault();
  }
}
