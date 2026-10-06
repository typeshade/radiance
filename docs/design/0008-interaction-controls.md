---
id: '0008'
title: A host ray cast picks objects, controls with four modes (orbit, select, translate, rotate) move them, and a material inspector edits their materials
status: accepted
milestones: []
touches:
  - packages/radiance/src/index.ts
  - packages/radiance/src/accel
  - packages/radiance/src/core
  - packages/radiance/src/math
  - packages/radiance/src/materials
  - packages/radiance/src/renderers/scene-pack.ts
  - packages/radiance/src/renderers/scene-pack.test.ts
  - packages/radiance/__api__
  - packages/addons/src/index.ts
  - packages/addons/src/controls
  - packages/addons/src/loaders/GLTFLoader.ts
  - packages/addons/src/loaders/GLTFLoader.test.ts
  - packages/addons/src/scenes/CornellBox.ts
  - packages/addons/__api__
  - site/examples
  - site/src
  - scripts/harness.mjs
  - scripts/material-panel.test.ts
  - docs/design/0003-public-api.md
  - docs/plan.md
  - README.md
compiler: []
---

**Document control**

| Field         | Value                                                                                                                                                                                               |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity      | Design record 0008, status `draft`                                                                                                                                                                  |
| Date          | 2026-10-06 (UTC), the date of authorship                                                                                                                                                            |
| Author        | Written in a Claude Code session for the owner. The owner's review is the approval                                                                                                                  |
| Applicability | `packages/radiance/src` (the ray cast), `packages/addons/src/controls`, `site/` (the stage and the examples), `scripts/harness.mjs`. No kernel, no storage buffer and no gate scene                 |
| Baseline      | `main` at eafc2e1. The compiler pinned at 596c805. The measurements ran on this baseline with bun 1.3.14                                                                                            |
| Pull request  | Not opened yet. The pull request that carries this record is its review. The record serves no milestone of `docs/plan.md` section 4, so `milestones` is empty until the owner decides (decision 20) |

## What changes

On 2026-10-06 the owner asked, in Korean, for a controller that can move and rotate real objects. The owner asked for modes: a select mode, move, rotate and the plain orbit control. The owner also said that the orbit limits of the examples make inspection hard. A separate change loosens those limits. This record does not carry it.

### Before

- `OrbitControls` (`packages/addons/src/controls/OrbitControls.ts`) is the only control. It moves the camera and the target and never touches the scene. It listens on the canvas for `pointerdown`, `pointermove`, `pointerup`, `pointercancel`, `wheel`, `keydown`, `contextmenu` and `dblclick`. It sets `touch-action: none` on the canvas. A double click calls `reset()`.
- The keys of `OrbitControls` are the arrows, `+`, `-`, `=`, `_`, `r`, `R` and `Home`. `OrbitControls` matches `KeyboardEvent.key`, and among the letters it uses only `r` and `R`. So the key codes `KeyQ`, `KeyW`, `KeyE` and `KeyO` are free.
- Nothing picks. `docs/plan.md` section 7 assigns "picking (`examples/id-pick`'s way)" to M1. A search of `packages/*/src`, `site/examples` and `site/src` finds no function that casts a ray on the host. The names that contain `pick` in the code belong to the kernels. `pick(v, k)` in `intersect.shade.ts` selects a vector component. `pickLight` in `trace.shade.ts` chooses a light.
- `vendor/typeshade/examples/id-pick.shade.ts` at the pin 596c805 is an example of an integer varying. Its blurb says that a `u32` at a `@location` needs `@interpolate(flat)`. It does not pick from a scene.
- `Object3D` (`packages/radiance/src/core/Object3D.ts`) holds `position`, `rotation` (an `Euler`, applied X then Y then Z), `scale`, `matrix` and `matrixWorld`. It has no `version` and no quaternion. `Matrix4` has no inverse. `Euler` cannot read a matrix.
- A transform change reaches the kernel through `ScenePack.update` (`packages/radiance/src/renderers/scene-pack.ts`). The pack builds the instance list on every call and compares it bit for bit with the last one (`sameBits`). When it differs, the pack builds the TLAS again. It then writes `nodes`, `instances` and `lights`, and reports the buffers it wrote. `PathTracer.render` marks the accumulation dirty when the pack wrote any buffer. The accumulation restarts, as it does for a camera move.
- The host cost of that path, measured on 2026-10-06 at `main` eafc2e1 by a throwaway script that this record does not keep. The script times `ScenePack.update` after one 0.01 move of one mesh, with no device. The mean is over 100 calls after 5 warm-up calls. The Cornell box (8 instances, 1,093 nodes) takes 0.50 ms. An unchanged Cornell box takes 0.32 ms. The bunny (1 instance, 69,451 triangles, 40,528 nodes) takes 1.03 ms. An unchanged bunny takes 0.015 ms. Each move writes `nodes` whole: 34,976 bytes for the Cornell box and 1,296,896 bytes for the bunny. The first update takes 37.3 ms for the Cornell box and 213.3 ms for the bunny. `buildBlas` for the bunny alone takes 140.1 ms (mean of 5). The device write is not in these numbers. Step 6 measures it.
- The stage (`site/src/islands/ExampleStage.tsx`) has a toolbar `[data-stage-toolbar]` with the attributes `data-samples`, `data-status` and `data-animated`. Its buttons are Pause, Reset the view, Save as PNG and Full screen. `ExampleRun` (`site/examples/types.ts`) has `renderer`, `controls?`, `playing?`, `panel?` and `dispose`. It has no scene and no camera.
- Eight examples run `renderer.preview = controls.moving ? 4 : 1` in their loop. They are `bunny`, `coloured-lights`, `cornell-box`, `first-scene`, `geometries`, `instances`, `lights` and `materials`. `scene-graph.ts` runs `controls.moving ? 2 : 1`. `determinism.ts` has no controls.
- The harness site step (`scripts/harness.mjs`, section 6) drags the Cornell box canvas, waits for the status `Preview`, releases, and waits for a new view. Its last message says "a new view after it".
- `createCornellBox` (`packages/addons/src/scenes/CornellBox.ts`) names none of its meshes. `GLTFLoader` makes a `Mesh` for a node of one primitive. For a node of several primitives it makes an `Object3D` with one `Mesh` child for each primitive. That `Object3D` also receives the node's child nodes, and so does the `Object3D` of a node with no mesh. Record 0003 lists `Group` for 0.1.0, and `packages/radiance/src/index.ts` does not export it.

### After

The engine gains one class that casts a ray on the host. The addons gain two classes: `TransformControls`, which moves one attached object, and `InteractionControls`, which picks, holds the mode and owns a `TransformControls`. The stage gains a mode switch. No kernel, no buffer layout and no gate scene changes.

**The modes.** One mode is active at a time. The default is `orbit`.

| Mode        | A click on an object                                 | A left drag that starts off a handle | The handles                                | What changes in the scene             |
| ----------- | ---------------------------------------------------- | ------------------------------------ | ------------------------------------------ | ------------------------------------- |
| `orbit`     | Nothing                                              | Orbits the camera                    | None                                       | Nothing, ever                         |
| `select`    | Selects the object. A click on empty space clears it | Orbits the camera                    | None                                       | Nothing                               |
| `translate` | As in `select`                                       | Orbits the camera                    | Three axis arrows and a disc at the object | The `position` of the selected object |
| `rotate`    | As in `select`                                       | Orbits the camera                    | Three rings at the object                  | The `rotation` of the selected object |

- A click is a press and a release of the primary button. The pointer moves 4 CSS pixels or less between them. No modifier key is down, and no second pointer is down.
- A drag that starts on a handle moves the object. The camera does not move during it.
- The right drag, the middle drag, Shift and drag, the wheel, the pinch and the arrow keys move the camera in every mode. `OrbitControls` stays enabled and stays unchanged.
- The selection persists across mode changes. In `orbit` mode the selection outline stays and no handle shows. The outline is not part of the scene.
- No mode changes `scale`, the camera or a material.

**The keys.** They act when the canvas has focus. They ignore a press with Ctrl, Alt or Meta. A mode key matches `KeyboardEvent.code`, so Shift, caps lock and the keyboard layout do not change the result. `Escape` matches `KeyboardEvent.key`.

| Key      | `code`   | Action                                                                        |
| -------- | -------- | ----------------------------------------------------------------------------- |
| `O`      | `KeyO`   | Mode `orbit`                                                                  |
| `Q`      | `KeyQ`   | Mode `select`                                                                 |
| `W`      | `KeyW`   | Mode `translate`                                                              |
| `E`      | `KeyE`   | Mode `rotate`                                                                 |
| `Escape` | (by key) | Cancels a drag and restores the object. With no drag, it clears the selection |

The tooltips name the letters. On a layout that moves the letters, the keys stay at their QWERTY positions. A Korean layout then works, where `KeyboardEvent.key` would read a Hangul letter.

**The focus.** A press on a handle calls `focus({ preventScroll: true })` on the canvas, as `OrbitControls` does for its own press. So `Escape` reaches a drag that started on a handle. A click on a mode button of the toolbar gives the focus back to the canvas.

`W` and `E` are three.js's keys for translate and rotate. This is an inference from memory of its TransformControls example. Step 3 checks it against the three.js documentation. `R`, `Home`, the arrows, `+` and `-` stay with `OrbitControls`.

**The ray cast.** `Raycaster` joins the engine's public classes. It follows three.js's shape, with three differences that the next list states.

```ts
interface Intersection {
  /** World distance from the ray's origin to the point. The ray's direction is a unit vector. */
  distance: number;
  point: Vector3;
  /** The mesh that was met. */
  object: Mesh;
  /** The triangle's index in `object.geometry.index`: triangle t is index[3t] to index[3t + 2]. */
  faceIndex: number;
  /** The unit geometric normal in world space. It follows the triangle's winding in object space. */
  normal: Vector3;
}

class Raycaster {
  readonly ray: { readonly origin: Vector3; readonly direction: Vector3 };
  near: number; // default 0
  far: number; // default Infinity
  constructor(origin?: Vector3, direction?: Vector3, near?: number, far?: number);
  set(origin: Vector3, direction: Vector3): void;
  /** `coords` is in normalized device coordinates: x and y in -1 to 1, with +y up. */
  setFromCamera(coords: { x: number; y: number }, camera: Camera): void;
  intersectObject(object: Object3D, recursive?: boolean): Intersection[]; // recursive: default true
  intersectObjects(objects: Object3D[], recursive?: boolean): Intersection[]; // recursive: default true
}
```

- **One entry for each mesh.** The list holds the nearest hit of each mesh the ray meets, nearest first. three.js lists every triangle the ray crosses. A list of one entry for each mesh serves picking and a pick behind the first hit.
- **`normal` replaces `face.normal`.** three.js's `face.normal` is in object space. This `normal` is in world space, so a mirrored instance keeps its outside. The name differs because the meaning differs.
- **No instance slot.** The kernel's instance slot is the index of an instance in the TLAS leaf order. The order changes at every TLAS build, so the slot is not public. An internal function `castRay` in `packages/radiance/src/accel/cast.ts` returns the slot, and the tests use it.
- **The camera.** `setFromCamera` calls `camera.updateMatrixWorld()`. It reads the frame through `cameraFrame` (`scene-pack.ts`), the function that makes the kernel's frame. The ray is the kernel's primary ray without the pixel jitter. `trace.shade.ts` forms it as `forward + right * (ndc.x * lens.x) + up * (ndc.y * lens.y)` with `ndc.y = 1 - 2 py / height`.
- **The direction.** The constructor and `set` copy `origin` and `direction`, and they normalize the copy of `direction`. A zero direction throws a `RangeError`. So `ray.direction` is a unit vector, and `distance` equals the ray parameter `t`. A caller changes the ray with `set`. A cast also normalizes `ray.direction` again, so a write to `ray.direction.x` cannot break the rule. `near` and `far` bound `distance`.
- **The recursive flag.** It defaults to `true`, as in three.js. With `true`, the cast takes `object` and every descendant. With `false`, it takes `object` alone, and it finds nothing when `object` is not a `Mesh`. `intersectObjects` applies the flag to each object. A mesh that two objects reach is listed once.
- **Visibility.** A mesh counts when it and every ancestor up to the root are `visible`. The test reaches above `object`. So a hidden ancestor of `object` hides it.
- **What the cast skips.** It skips a mesh whose `matrixWorld` has no inverse. It skips a mesh whose geometry has an empty index, because `buildBlas` throws a `RangeError` on one. `ScenePack` skips both. The cast throws a `TypeError` for a mesh whose geometry is not a `BufferGeometry`, as `ScenePack` does. When no mesh remains, the cast returns `[]` and builds no TLAS.
- **The scene.** `intersectObject` finds the root of `object` and calls `updateMatrixWorld()` on it. It then casts against the meshes that the three rules above admit. It changes no geometry. In particular it does not compute normals.

The cast uses the engine's own data structures, and it uses no GPU and no DOM.

1. For each geometry, take its BLAS from a cache keyed by the geometry and its `version`. A miss calls `buildBlas` (`packages/radiance/src/accel/bvh.ts`). The cache is a `WeakMap`.
2. For each mesh, move the BLAS's root box to world space by the mesh's `matrixWorld`, as `#instanceList` does. Call `buildTlas` over those boxes. The TLAS is the same builder with the same leaf rule as the kernel's TLAS.
3. Walk the TLAS and then each BLAS with the two stacks of `nearest` in `intersect.shade.ts`. The bounds differ, because `nearest` returns one hit and the list holds one hit for each mesh. The TLAS walk prunes a box by `far` and not by a hit. Each BLAS walk prunes by the `t` of that mesh's nearest hit so far, or by `far` before it has one. A triangle hit with a `t` under `near` is dropped, and it does not tighten that bound. The node words are the layout of `layout.shade.ts`: `[0] = (min, bits(a))` and `[1] = (max, bits(b))`, with `b = count | axis << 30`.
4. Move the ray into the instance's space with the inverse of the affine matrix. Keep the direction unnormalized there, so `t` stays a world parameter.
5. Test each triangle with the watertight test of Woop, Benthin and Wald, on either face, as `hitTriangle` does. The host test runs in f64 and the kernel's in f32.
6. Map the leaf slot to the geometry's own triangle index through `Bvh.order`. Compute `normal` as the unit of the inverse transpose of the matrix, applied to the cross product of the triangle's edges in object space.

A mirrored instance is a mesh whose `matrixWorld` has a negative determinant, such as a child of the `right` group of `site/examples/instances.ts` (`scale.x = -1`). The cast finds it where the picture shows it, because the ray goes through the same inverse. A glTF node of several primitives is several meshes, so a ray returns the primitive's `Mesh` and not the node. The selection rule below maps it to the node's primitives.

**The selection of a mesh.** `InteractionControls` turns a picked mesh into the object it selects. The rule is the nearest ancestor that is a `Group`, else the mesh itself.

- `GLTFLoader` makes a `Group` for the primitives of a node that has two or more primitives, and for nothing else. The `Group` holds only those meshes, and its transform is the identity. It takes the name of the glTF mesh, so `data-selected` shows that name. The node stays an `Object3D` and keeps its child nodes beside the `Group`.
- A click on one primitive selects the `Group`, so all primitives of that node move together. Its child nodes stay where they are.
- A click on the mesh of a child node selects that mesh, because no `Group` lies above it. A node with no mesh or with one primitive keeps its type.
- An `Object3D` that an author made keeps each child selectable alone, as in `instances.ts`. An author who adds a `Group` above a mesh makes that `Group` the selection unit.

`Group` is an `Object3D` with nothing added. Record 0003 already lists it for 0.1.0. Step 1 exports it.

**The gizmo.** The path tracer draws the accumulated mean to the canvas through the fragment function `show`. It has no raster pass over the scene, so no handle can be drawn into the canvas. The handles are an SVG overlay above the canvas.

- The page owns the `SVGSVGElement`. It positions the element over the canvas, and it passes the element to the constructor. The controls set the `viewBox` to the canvas's `clientWidth` by `clientHeight`, so one SVG unit is one CSS pixel. They add, change and remove the children of that element. They never attach the element to the document.
- The root has `pointer-events: none`, so a click on empty space reaches the canvas. A handle has `pointer-events: stroke`, or `all` for a filled shape, with a hit width of 16 CSS pixels. A handle is a child of the overlay and not of the canvas, so `OrbitControls` never sees a press on it.
- Each handle has a `data-handle` attribute: `translate-x`, `translate-y`, `translate-z`, `translate-screen`, `rotate-x`, `rotate-y` and `rotate-z`. The harness reads them.
- The controls write presentation attributes for a default look: x red, y green, z blue, the outline dashed. The page's CSS overrides them, so the dark theme needs no code.
- The gizmo sits at the object's origin, the translation of its `matrixWorld`. It does not sit at the centre of its bounding box.
- The size is constant on the screen: `handleLength` CSS pixels, 96 by default. The world length of a handle is `handleLength * 2 * z * tanY / height`, with `z` the object's depth along the camera's forward axis.
- An axis arrow is hidden when its axis lies within about 8 degrees of the view ray (`|axis . v| > 0.99`). Here `v` is the unit vector from the eye to the gizmo's origin. A gizmo whose origin is behind the camera, with `z` at or below 0.01, is hidden.
- The selection outline is the projected oriented box of a `Mesh` that has no mesh below it. For any other object it is the projected world box of its meshes. It reads `geometry.computeBoundingBox()` and each `matrixWorld`.
- `update()` writes the attributes again from the current matrices. A page calls it after the camera or the object moved. The stage calls it on every animation frame while an object is selected. It reuses its elements and allocates none.

The engine and the addons import nothing from the DOM beyond events, `HTMLElement`, `SVGSVGElement` and the canvas's client size. `OrbitControls` already uses the same. `scripts/boundary.mjs` reads imports and WebGPU calls, and it finds neither here. `Raycaster` uses no DOM name.

**The drag mathematics.** All numbers are `number`, which is f64. Units are world units for a position and radians for an angle. A `fov` is in degrees. Let `E` be the camera's eye. Let `F`, `R` and `U` be its unit forward, right and up axes, as `cameraFrame` makes them. Let `lens` be the `lens` that `cameraFrame` makes. Let `tanY = lens.y` and `A = lens.x / lens.y`.

`tanY` is `tan(fov * PI / 360)`, with `fov` in degrees as `PerspectiveCamera` holds it. `A` is the camera's `aspect`. The map reads `A` from the camera and never computes W / H itself. An example sets `aspect` from the canvas in its `resize`, as `cornell-box.ts` does. For a camera that is not a `PerspectiveCamera`, `cameraFrame` uses a `fov` of 50 and an `aspect` of 1.

```ts
// A pixel (px, py) in a W by H canvas, in CSS pixels, to a ray.
ndc = (2 * px / W - 1, 1 - 2 * py / H)
dir = normalize(F + R * (ndc.x * tanY * A) + U * (ndc.y * tanY))

// A world point P to a pixel. z is the depth along F.
c = P - E
z = dot(c, F)
px = (dot(c, R) / (z * tanY * A) + 1) / 2 * W
py = (1 - dot(c, U) / (z * tanY)) / 2 * H

// The world length of one CSS pixel at depth z.
k = 2 * z * tanY / H
```

Each drag keeps a snapshot from the press. The snapshot holds the object's local position, its local rotation matrix and its parent's world matrix. It also holds `O0` (the world position of its origin) and `v` (the unit vector from `E` to `O0`). Each move computes from the snapshot and never from the last move. So no error adds up. `Escape` restores the snapshot.

- **An axis arrow.** Let `a` be the world axis, as a unit vector. Let `(E, u)` be the pointer's ray. Let `w0 = O0 - E`, `b = dot(a, u)`, `d = dot(a, w0)` and `e = dot(u, w0)`. The point of the axis line that is nearest to the ray is at `t = (b * e - d) / (1 - b * b)` along the axis from `O0`. The offset is `t` at the move minus `t` at the press. The new world position is `O0 + a * offset`. The press point on the arrow does not matter, so the object does not jump. If `1 - b * b` is under 1e-4 at the press, the drag does not start. If it is under 1e-4 at a move, that move keeps the last offset. The hide rule above is about the picture only and does not guard the drag.
- **The disc.** The disc drags in the screen plane. The plane passes through `O0` with the normal `F` taken at the press. The pointer's ray meets it at `E + u * s`, with `s = dot(O0 - E, F) / dot(u, F)`. The offset is the point at the move minus the point at the press. The new world position is `O0` plus the offset.
- **A ring about the axis `a`.** The ring is a circle in the plane through `O0` with the normal `a`. Its world radius is `rw = 0.85 * handleLength * k`, with `k` taken at the depth of `O0`. The angle comes from one of two regimes, and the press chooses the regime for the whole drag, so the angle never jumps.
- **Regime A, the plane faces the view enough.** It applies when `|dot(a, v)| >= 0.25`. Find the plane point of the press and of the move as for the disc, but with the normal `a`. Let `v0` and `v1` be the vectors from `O0` to those points. The angle is `atan2(dot(a, cross(v0, v1)), dot(v0, v1))`. A positive angle is anticlockwise seen from the tip of `a`.
  - Let `s = dot(O0 - E, a) / dot(u, a)` be the distance along the pointer's ray to the plane.
  - If `|dot(u, a)|` is under 1e-6 or `s` is 0 or less at the press, the drag does not start.
  - If either holds at a move, that move keeps the last angle.
- **Regime B, the plane is nearly edge-on.** It applies when `|dot(a, v)| < 0.25`. The ring looks like a line, and the pointer follows it.
  - Let `h` be the world axis (x, y or z) with the smallest `|dot(h, a)|`. Let `e1` be the unit vector of `h - a * dot(h, a)`. Let `e2 = cross(a, e1)`.
  - The ring point at the angle `phi` is `O0 + rw * (cos(phi) * e1 + sin(phi) * e2)`. Let `q(phi)` be its pixel. A positive `phi` is anticlockwise seen from the tip of `a`, so it is regime A's positive angle.
  - The press finds the `phi0` whose `q(phi0)` is nearest to the pointer among 360 equal steps of `phi`.
  - The screen tangent is `tau = (q(phi0 + 0.01) - q(phi0 - 0.01)) / 0.02`, in pixels for each radian. Let `delta` be the pointer's move in pixels since the press.
  - The angle is `dot(delta, tau) / dot(tau, tau)`.
- **Snapping.** `translationSnap` rounds the offset of an axis arrow to a multiple of itself. For the disc it rounds each world component of the new position. `rotationSnap` rounds the angle to a multiple of itself. Both are `null` by default, and they have no key. A snap of `null` means a free drag.
- **To the local transform.** Let `Pw` be the parent's world matrix. The new local position is `Pw` inverse applied to the new world position. For a rotation, let `Pr` be the linear part of `Pw` and `Rot` the world rotation of the drag. The new local rotation matrix is `Pr` inverse times `Rot` times `Pr` times the old local rotation matrix. The controls refuse a rotation when `Pr` is not a similarity. A similarity has orthogonal columns of one length, and it may mirror. Let `g` be the squared length of the first column of `Pr`. The test holds when each entry of `Pr` transposed times `Pr` minus `g * I` is within 1e-6 times `g`. A parent with a non-uniform scale and a turn fails it, because the product would shear. The arrows then stay and the rings are hidden. A translation needs only an invertible `Pw`.
- **To an `Euler`.** The engine's rotation is `Rz * Ry * Rx` (`Matrix4.compose`). So `y = asin(-r20)`, `x = atan2(r21, r22)` and `z = atan2(r10, r00)`. When `|r20|` is within 1e-9 of 1, the controls set `z = 0` and `x = atan2(-r12, r11)`. The result is the same orientation and may show other angles than the start, which is the same rotation in another branch.

**What the engine does.** A moved object changes the instance array, so the pack builds the TLAS again and writes `nodes`, `instances` and `lights`. `PathTracer.render` then restarts the accumulation, as it does for a camera move. This record adds no field to `Object3D`, no version and no event. The stage sets `run.editing` while a drag is on. The loops of the examples read it, so the frame is a preview during the drag. The status reads `Preview`. After the release the frame traces at full size, and the tracer stops at the cap of the stage (`MAX_SAMPLES`). A transform change costs the host numbers in "Before" plus three device writes (`instances`, `lights` and `nodes`). Step 6 measures the device writes.

**The public API.** The bake of each package gains these exports. Record 0003's list "The public surface at 0.1.0" gains the same names, except `Group`, which the list has already (see "What it touches").

| Package                      | Export                                                                | Kind         | Added by |
| ---------------------------- | --------------------------------------------------------------------- | ------------ | -------- |
| `@typeshade/radiance`        | `Raycaster`                                                           | class        | Step 1   |
| `@typeshade/radiance`        | `Intersection`                                                        | interface    | Step 1   |
| `@typeshade/radiance`        | `Group`                                                               | class        | Step 1   |
| `@typeshade/radiance-addons` | `TransformControls`, `TransformMode`, `TransformControlsEvents`       | class, types | Step 3   |
| `@typeshade/radiance-addons` | `InteractionControls`, `InteractionMode`, `InteractionControlsEvents` | class, types | Step 4   |

The engine's bake goes from 29 exports to 32, and the addons' bake from 5 to 11.

```ts
type TransformMode = 'translate' | 'rotate';
type TransformControlsEvents = {
  change: undefined;
  objectChange: undefined;
  'dragging-changed': boolean;
};

class TransformControls extends EventDispatcher<TransformControlsEvents> {
  constructor(camera: Camera, domElement: HTMLElement, overlay: SVGSVGElement);
  enabled: boolean; // default true
  readonly object: Object3D | undefined;
  readonly mode: TransformMode; // default 'translate'
  readonly dragging: boolean;
  translationSnap: number | null; // world units, default null
  rotationSnap: number | null; // radians, default null
  handleLength: number; // CSS pixels, default 96
  attach(object: Object3D): this;
  detach(): this;
  setMode(mode: TransformMode): void;
  update(): void;
  dispose(): void;
}

type InteractionMode = 'orbit' | 'select' | 'translate' | 'rotate';
type InteractionControlsEvents = {
  'mode-changed': InteractionMode;
  'selection-changed': Object3D | null;
  'dragging-changed': boolean;
  objectChange: undefined; // read `selected` for the object
};

class InteractionControls extends EventDispatcher<InteractionControlsEvents> {
  constructor(scene: Scene, camera: Camera, domElement: HTMLElement, overlay: SVGSVGElement);
  enabled: boolean; // default true
  readonly mode: InteractionMode; // default 'orbit'
  readonly selected: Object3D | null;
  readonly dragging: boolean;
  readonly transform: TransformControls;
  /** Which meshes a click may pick. Default: all. */
  filter: (mesh: Mesh) => boolean;
  setMode(mode: InteractionMode): void;
  select(object: Object3D | null): void;
  update(): void;
  dispose(): void;
}
```

`TransformControls` is three.js's class name. Its members `attach`, `detach`, `setMode`, `mode`, `enabled`, `dragging`, `object`, `translationSnap`, `rotationSnap`, `dispose` and the events `change`, `dragging-changed` and `objectChange` follow three.js's. This is an inference from memory. Step 3 checks each name against the three.js documentation, and an amendment of this record fixes any difference. `handleLength` is not three.js's `size`, because `size` there is a world scale and this is CSS pixels. `InteractionControls` has no three.js counterpart. Record 0003, rule 3 takes the plan's name for a thing that three.js lacks. The plan has no name for it yet, so this record proposes `InteractionControls`. Step 7 adds it to the plan. A page that wants only the gizmo uses `TransformControls` alone and does its own picking with `Raycaster`.

**The site.** The stage gains a mode switch and a readout.

- The stage reads `scene` and `camera` from the `ExampleRun` that an example returns. `ExampleRun` gains `scene?`, `camera?` and `editing?`. An example without `scene` or `camera` gets no modes. That is the opt-out. `determinism.ts` returns neither, so it opts out, because a moved object would break the comparison it shows.
- The other ten examples return both and read `run.editing` in their loop. Nine of them run `renderer.preview = controls.moving || run.editing ? 4 : 1`. `scene-graph.ts` keeps its 2 and runs `controls.moving || run.editing ? 2 : 1`. The front page's compact stage has no toolbar and creates no controls.
- The stage creates the SVG overlay in the holder, over the canvas, and an `InteractionControls` for it. It disposes both with the example.
- The toolbar gains a group of four icon buttons: `Orbit`, `MousePointer2`, `Move3d` and `Rotate3d` of `lucide-react`. Each has an `aria-label`, an `aria-pressed` state and a tooltip that names its key. The group sits left of Pause. A button group exists only when the example opted in.
- The toolbar gains the attributes `data-mode`, `data-selected` (the object's `name`, or empty), `data-selection` (`none` or `object`) and `data-position`. `data-position` is the local `position` as `x,y,z`, each number in the full `Number#toString` form, or empty. A readout in the toolbar shows the name and the position with two decimals.
- A drag of an object sets `run.editing`. If the example defines `playing`, the stage sets it to false for the drag. The Pause effect of the stage writes `playing` as `!paused && !offscreen && !dragging`, so the drag wins over it. At the release the stage writes `!paused && !offscreen`. So the turning group in `scene-graph.ts` stays still while a hand moves it.
- `createCornellBox` names its meshes: `floor`, `ceiling`, `back`, `left`, `right`, `lamp`, `mirror` and `ball`. A name changes no pixel.
- `canvasLabel` in `site/src/i18n/en.ts` says how to select. The guide gets one page, `site/src/content/docs/guide/object-controls.mdx`. It follows `controls.mdx` in the sidebar.

**What does not change.** The render gate and the determinism check call an example's function on a canvas. They never create the stage's controls. The capture loads the page, so the stage creates its controls there. The capture sends no pointer event and takes a screenshot of the canvas element. Playwright captures the page area of that element, overlay included. The overlay holds no child until an object is selected, so the picture shows the canvas alone. So no golden and no still changes. The kernels, the seven buffers and the pack's rules stay as record 0001 has them. `OrbitControls` keeps its code and its surface line.

### The material inspector

On 2026-10-06 the owner made a second request. In English it reads: "I would like to change materials directly at run time and watch how the render changes." This section answers it. The stage gains a panel. The panel edits the material of the selected mesh, and the path tracer shows the result.

#### Before the inspector

- `Mesh.material` is a plain field. `Material` (`packages/radiance/src/materials/Material.ts`) keeps `color`, `emissive` and `doubleSided` behind getters and setters. Nothing on the stage calls them.
- Each setter adds 1 to `version`. `version` is a public number field that starts at 0. A setter adds 1 even when the new value equals the old one. The getter of `color` returns the live `Color`, so `material.color.r = 0.1` adds nothing.
- The pack does not rely on `version` alone. `ScenePack.update` packs the record of each visible mesh's material on every call (`scene-pack.ts`, `#update`, part 2). It compares the 32 words of the record with the last ones (`sameBits`), and it compares `version`. So an edit in place reaches the next frame too.
- `DiffuseMaterial` holds `color`, `emissive` and `doubleSided`. Its constructor takes `emissiveIntensity` and multiplies it into `emissive`. The class stores no intensity.
- `MirrorMaterial` holds `color`, and its constructor takes no emission. `EmissiveMaterial` is a black diffuse. Its constructor takes `color` and `intensity`, and the class stores their product in `emissive`.
- `PhysicalMaterial` exists at the pin. It holds `color`, `emissive`, `emissiveIntensity`, `doubleSided`, `metalness`, `roughness`, `ior`, `transmission` and `specularIntensity`.
- The path tracer stores the last five of those and renders the material as a diffuse of its colour (record 0004, step 1). The principled BSDF is step 2 of record 0004, at M3. Textures are step 3.
- `Color` is linear RGB, and its components are not clamped. An emission may exceed 1: the Cornell box lamp is (17, 12, 4). `Color.setHex` decodes sRGB. No `Color` function encodes to a hex number.
- An edit of `color`, `emissive` or `doubleSided` writes the `materials` buffer. It also writes `lights` when the words of the light table change. The tests "writes the materials alone when a colour changes in place" and "writes the materials and the lights when an emission changes" hold this.
- The TLAS builds only when the instance array or a geometry changes (`#update`, part 3). So a field edit builds no TLAS. `PathTracer.render` restarts the accumulation when the pack wrote any buffer.
- A mesh that takes a new material instance changes the instance array, because each instance holds the index of its material. The pack then builds the TLAS again and writes `instances`, `lights`, `materials` and `nodes`. The test "writes the materials and the instances when a mesh takes another material" holds this.
- The pack never frees a table index. A material that no mesh holds stays in `materials` until the pack forgets its state. Each replaced instance leaves 128 bytes. This is a reading of `scene-pack.ts`, and no run measured it.
- `createCornellBox` gives one `DiffuseMaterial`, `white`, to `floor`, `ceiling`, `back` and `ball`. So four meshes share it. The red wall, the green wall, the lamp and the mirror ball have one mesh each.

#### After the inspector

The stage gains a panel, `[data-material-panel]`. The panel is DOM that the page owns, as the page owns the overlay of the gizmo. The engine and the addons gain nothing: no class, no event and no export. The panel is not a mode. So the rule "No mode changes `scale`, the camera or a material" stays true. Only a viewer's input in the panel changes a material.

**When the panel shows.**

- The panel shows when the mode is `select`, `selected` is a `Mesh` and the example returned `scene` and `camera`. In every other case the panel is not in the DOM.
- A `Group` or an `Object3D` as the selection shows no panel. A later record can list the meshes of a `Group`.
- `determinism.ts` returns no `scene`, so it has no modes and no panel. The front page's compact stage has none. The render gate and the capture create no panel, because the capture sends no pointer event and the selection stays empty.
- The panel sits over the top right of the canvas. It takes no row of the stage grid, so the canvas keeps its size. It is 224 CSS pixels wide.
- On a stage under 560 CSS pixels wide the panel starts collapsed to one header line. The header button (`aria-expanded`) opens it.

**What the panel holds.** A header names the mesh (its `name`) and the type of its material. A line "Shared by N meshes" shows when N is above 1. A `<select>` holds the type. One control follows for each yes of this table. A column names a control. It does not always name a field of the class.

| Class              | `color` | `emissive` | `emissiveIntensity` | `doubleSided` |
| ------------------ | ------- | ---------- | ------------------- | ------------- |
| `DiffuseMaterial`  | yes     | yes        | yes                 | yes           |
| `MirrorMaterial`   | yes     | no         | no                  | no            |
| `EmissiveMaterial` | no      | yes        | yes                 | yes           |
| `PhysicalMaterial` | yes     | yes        | yes                 | yes           |

- `color` and `emissive` are `<input type="color">`. `emissiveIntensity` is `<input type="number">` with `min` 0, `max` 1000 and `step` 0.1. `doubleSided` is `<input type="checkbox">`.
- The constructor of `MirrorMaterial` sets no emission, so the panel shows no emission control and no `doubleSided` control for it. The flag changes only the emission of a back face (`materials.shade.ts`). The constructor of `EmissiveMaterial` sets `color` to black, so the panel shows no `color` control for it.
- These are rules of the panel and not of the classes. Both classes inherit the three accessors of `Material`, and `packMaterial` packs them for every type. A value that an example sets by code on a hidden field is rendered. The panel hides its control and shows nothing for it. A type change carries a hidden field into the new instance too. The panel of the new class may then hide a field that is still rendered.
- `PhysicalMaterial`'s `metalness`, `roughness`, `ior`, `transmission` and `specularIntensity` get number inputs when step 2 of record 0004 lands. Before that, an edit would change no pixel. Textures get no control until step 3.
- A colour input holds sRGB `#rrggbb`. A write decodes it with `Color.setHex`. A read encodes the linear value with the sRGB transfer function and rounds to 8 bits. So a `#rrggbb` value round-trips. A channel of `color` above 1 shows as 255. The `emissive` input shows a hue, whose channels do not exceed 1.
- The panel splits the radiance `r` of a surface into an intensity and a hue. Here `r` is `emissive`, times `emissiveIntensity` for a `PhysicalMaterial`. The intensity is the largest channel of `r`. The hue is `r` over the intensity, by channel.
- When the emission is zero, the intensity is 0 and the hue input shows `#ffffff`, the hue (1, 1, 1). This is the shown hue. In every other case the shown hue is the hue of the split.
- A hue write sets `emissive` to the new hue, scaled to a largest channel of 1, times the intensity. When the intensity is 0, it uses 1 in place of the intensity. A black hue sets `emissive` to (0, 0, 0).
- An intensity write of `I` sets `emissive` to the shown hue times `I`. So on a zero emission, an intensity write of `I` sets `emissive` to (`I`, `I`, `I`). A write of 0 sets `emissive` to (0, 0, 0), and the shown hue is then (1, 1, 1) again.
- For a `PhysicalMaterial`, both writes also set `emissiveIntensity` to 1, because the pack stores the product.
- For every class, the `emissive` input and its `data-value` hold the hue. The `emissiveIntensity` input and its `data-value` hold the intensity of the split. The panel derives the intensity. `DiffuseMaterial` and `EmissiveMaterial` store no such field. The input of `PhysicalMaterial` shows the split of `r`, so it can differ from the field of that name. The Cornell lamp, with `emissive` (17, 12, 4), splits into the intensity 17 and the linear hue (1, 0.706, 0.235). The hue input shows the sRGB encoding of that hue, `#ffdb85`. A `PhysicalMaterial` with `emissive` (0.5, 0, 0) and `emissiveIntensity` 4 splits into the intensity 2 and the hue (1, 0, 0).
- Each input has `data-field`: `type`, `color`, `emissive`, `emissiveIntensity` or `doubleSided`. It also has `data-value`, the value that its input shows: `#rrggbb`, `Number#toString`, `true` or `false`, or a class name. For `emissive` and `emissiveIntensity` it is the hue and the split intensity, and not a field of the material.
- The root has `data-material-type`, `data-shared` and `data-version`. `data-material-type` is one of the four class names. The panel finds it with `instanceof`, because a minified build can rename a class. `data-version` is `material.version`.

**The path of a field edit.**

1. The viewer changes one input, and the browser sends an `input` event.
2. The panel clamps a number to the `min` and `max` of its input. A value that is not finite ends the path.
3. The panel assigns a new value through the setter of the material. It assigns a new `Color`, and it never changes a `Color` in place. Each setter adds 1 to `version`. A hue or intensity write on a `PhysicalMaterial` calls two setters, so `version` rises by 2.
4. At the next frame, `ScenePack.update` sees the new words. It writes `materials`, and `lights` when the light table's words change. It builds no TLAS and writes no `nodes`.
5. `PathTracer.render` restarts the accumulation, because the pack wrote a buffer. It sets the count of samples to 0 before it awaits `f.submit()` (`PathTracer.ts`). It adds the frame's `n` samples after the submit. The stage polls `t.samples` every 200 ms. So `data-samples` can read 0 while the submit is in flight, and it reads the frame's samples after it.
6. The panel reads every field again from the material. It writes `data-value` and `data-version`, and it writes each input that has no focus.

The panel reads from the material and never from the input. So a value that the material changed, or that an example changed in a frame, shows at once. The panel reads the material again at every animation frame while it shows.

**The path of a type change.**

- The `<select>` lists `DiffuseMaterial`, `MirrorMaterial` and `EmissiveMaterial`. `PhysicalMaterial` is not an option until step 2 of record 0004 lands, because it would render as a diffuse. A mesh that holds one gets a disabled `PhysicalMaterial` option, which the select shows as its value.
- The panel builds one instance of the chosen class. It takes `name` from the old instance.
- The source of a value is one rule. The new instance takes every field that the old instance holds, hidden by the panel or not. Only a parameter that the old class does not hold takes the default of the new constructor.
- Every class holds `color`, `emissive` and `doubleSided`, so no pair of the three options has such a parameter. The five parameters of `PhysicalMaterial` are the first (record 0004, step 2).
- The row of the new class in the table above decides which controls the panel shows. It does not decide which fields the new instance holds. The new instance omits a field that its class lacks, and a change back does not restore it.
- The panel sets the fields in this order, each through its setter: `color`, then `emissive`, then `doubleSided` when the old value is true. The `color` and `emissive` setters each get a copy of the old `Color`. A constructor cannot take all three values. `MirrorMaterial` sets no emission, and `EmissiveMaterial` sets `color` to black.
- Example: `EmissiveMaterial` to `DiffuseMaterial`. The old instance holds `color` (0, 0, 0). The new `DiffuseMaterial` takes that value, so its `color` is black and not the constructor's white. It also takes the `emissive` and the `doubleSided` of the old instance. The viewer sets the colour after the change.
- The new instance has `version` 2, or 3 when `doubleSided` is true. The panel assigns it to `mesh.material` of every mesh that held the old one. So the meshes keep sharing one instance.
- Example: `DiffuseMaterial` with `color` (1, 1, 1) to `EmissiveMaterial`. The constructor sets `color` to (0, 0, 0). The `color` setter then assigns (1, 1, 1). The `emissive` setter copies the old emission. The panel shows no `color` control, and the surface renders as before, because both classes have the type `MATERIAL_DIFFUSE`.
- Example: `DiffuseMaterial` with `emissive` (2, 1, 0) to `MirrorMaterial`. The constructor sets (0, 0, 0). The `emissive` setter then assigns (2, 1, 0). The new instance renders that emission, and the panel shows no emission control.
- `ScenePack.update` finds an instance it does not know. It gives the instance the next table index and writes `materials`. The instance array changes, so it builds the TLAS again from the same boxes. It writes `nodes`, `instances` and `lights` too. It builds no BLAS.
- This is the code path of a transform change in "Before". Inference: the host cost has the same size. That is 0.50 ms for the Cornell box and 1.03 ms for the bunny. Each writes `nodes` whole, with 34,976 and 1,296,896 bytes, plus four device writes (`instances`, `lights`, `materials` and `nodes`). Step 8 measures both.

**Shared materials.**

- Proposed: an edit applies to the material instance, so it applies to every mesh that holds the instance. The panel counts those meshes in `ExampleRun.scene`, visible or not. It shows N and sets `data-shared` to N.
- In the Cornell box, an edit of the white ball's colour also changes `floor`, `ceiling` and `back`. The scene graph says so, because the four meshes are one material. The panel says so too, so the change does not surprise.
- The alternative is to clone on edit. The first edit of a shared material gives the selected mesh its own copy, and the other meshes keep the old one. It matches what the viewer clicked. It costs the path of a type change once, and it ends the sharing for that mesh. Decision 25 asks the owner.

**Edits and the other parts.**

- The panel does not set `run.editing`. Each edit restarts the accumulation at the full frame size. A slow device may call for a preview during an edit, so step 8 measures the restart (decision 26).
- In an example that does not define `playing`, Pause sets `renderer.paused`. While it is on, an edit restarts the accumulation and the paused tracer dispatches nothing (`PathTracer.ts`, `render`). The canvas keeps the stale frame until the viewer turns Pause off: `#drawn` stays true, so nothing draws again, and `data-samples` reads 0. `cornell-box.ts` is one of the nine examples of this kind. This is the open item on Pause in "Record".
- `scene-graph.ts` defines `playing`. There Pause stops only its motion (`ExampleStage.tsx`, the Pause effect). So an edit restarts the accumulation and the tracer traces.
- A key press in the panel's inputs does not reach the canvas, because the handlers of the modes and of `OrbitControls` listen on the canvas. A press of `w` in a number input does not change the mode.
- A wheel turn over the panel does not dolly the camera. A click on the panel does not clear the selection.

Alternatives considered for the inspector:

- **A class in the addons.** The addons import events, `HTMLElement` and `SVGSVGElement`, and no widgets. A panel needs labels, styles and a theme. Those belong to the page. Rejected.
- **Ant Design controls.** Ant Design has no native colour input. The harness fills native inputs. Rejected for the fields. The page's other controls stay Ant Design.
- **A panel in the grid row of `ExampleRun.panel`.** The row would resize the canvas when it shows, and a resize restarts the accumulation. Rejected for the overlay.

## Why

- **Why a host cast.** The path tracer traces only inside `render`. A pick through the GPU needs a kernel for primary ray ids, a dispatch and a read-back, on each tier. A host cast needs none of them. It runs in `bun test` with no device, before `init()` and after a device loss. It is the same on the WebGPU and the WebGL2 tier (record 0007).
- **Why the same builder and layout.** A pick must match the picture. The cast uses `buildBlas`, `buildTlas`, the node words, the double-sided watertight test and the world-parameter `t` that the kernel uses. Step 1 holds the match with a test against the oracle's `nearest` on 1,000 random rays.
- **Why the engine and not the addons.** `buildBlas` and `buildTlas` are not public, and the addons build on the engine's public classes alone (`packages/addons/src/index.ts`). three.js keeps `Raycaster` in its core, and a physics step or a hover reader needs it too.
- **Why an SVG overlay.** There is no raster layer to draw handles into. An overlay needs no kernel and no change to a golden. It styles with CSS, takes pointer events natively, and reads well on a touch screen. A page that is not the stage can pass its own element.
- **Why the closest point for an axis.** A drag by pixel delta along the projected axis is exact only near the origin. Under perspective it drifts. The closest point between two lines is exact, and it has no unit that depends on the view.
- **Why two regimes for a ring.** The plane intersection makes the ring follow the pointer exactly. It fails when the plane is edge-on, because the ray meets it at a grazing angle. The tangent method works there. A regime fixed at the press never jumps.
- **Why `Euler` from a matrix and a refusal.** The engine keeps an `Euler` and no quaternion. A world rotation must become a local `Euler`. A parent that stretches along a skew axis makes a local rotation that needs a shear, and `Object3D` cannot hold one. So the rings are hidden there, and the owner sees why in decision 17.
- **Why orbit stays on in the edit modes.** A viewer that must switch modes to turn the camera stops many times. A drag off a handle is not a drag of an object, so it can orbit. The right drag and the wheel keep working too.
- **Why no scale mode now.** The request names selection, move, rotate and orbit. A scale of a mesh changes its world box and the light table, and it needs a rule for a parent that mirrors. It can be added as a mode later without changing the rest.

Alternatives considered:

- **A GPU id pass.** `docs/plan.md` section 7 reads "`examples/id-pick`'s way". That example is about an integer varying and has no scene. A pass would need a new kernel, a new gate and a second path for WebGL2. Rejected, and the plan's row changes in step 7.
- **A brute-force cast in the addons.** One ray against 69,451 triangles needs no tree. It shares nothing with the kernel, so no test could tie a pick to a picture. It also leaves every other consumer without a cast. Rejected. Step 1 measures its cost as the reference for the tests.
- **One class for the gizmo and the modes.** It saves a name. It also makes the three.js name carry engine-specific picking. Two classes keep `TransformControls` close to what a three.js user expects.
- **Handles drawn into the canvas later.** It needs a raster layer or a kernel that composes an overlay. It is a different record. The overlay stays a DOM element until then (decision 11).
- **`Quaternion`, `Matrix4.invert` and `Euler.setFromRotationMatrix` in the engine.** They are the natural homes of the math. Each is a new public name with a meaning to define: the engine's `Euler` order is `Rz * Ry * Rx`, which three.js calls `ZYX`. The addons keep private functions in `transform-math.ts` now (decision 18).

## What it touches

- **Engine.** `packages/radiance/src/core/Raycaster.ts` (new), `src/core/Group.ts` (new), `src/accel/cast.ts` (new), `src/index.ts`. `scene-pack.ts` exports `cameraFrame` already. Step 1 moves `inverseAffine` from it into `src/math/affine.ts` (new), unchanged, so the pack and the cast share it.
- **Addons.** `packages/addons/src/controls/TransformControls.ts`, `InteractionControls.ts` and `transform-math.ts` (new), `src/index.ts`, `src/loaders/GLTFLoader.ts` and its test (a `Group` for the primitives of a node of two or more), `src/scenes/CornellBox.ts` (names).
- **Record 0003.** This record amends it. Its list "The public surface at 0.1.0" gains eight names: `Raycaster`, `Intersection` and the six names of the addons rows of the table above. The list has `Group` already, and step 1 only exports it. Steps 1, 3 and 4 each add their names to that list in the pull request that re-bakes the surface (`bun run bake:api-surface`). If 0.1.0 is tagged before a step merges, that step's names belong to the list of the release that carries them. The Amendment entry says which. `scripts/gates/api.mjs` fails when a bake and the tree differ. Record 0003's Record section gains an Amendment entry that cites this record.
- **Site.** `site/src/islands/ExampleStage.tsx`, `site/examples/types.ts`, the ten examples that have controls, `site/src/i18n/en.ts`, `site/src/styles/custom.css` (the gizmo's colours and cursors), `site/src/content/docs/guide/object-controls.mdx` (new).
- **Scripts.** `scripts/harness.mjs` (the interaction check of section 6).
- **Material inspector.** `site/src/islands/MaterialPanel.tsx` and `site/src/lib/material-fields.ts` (new). The second file holds pure functions: the fields of a class, the reads and writes, the type change, the sharing count and the sRGB encode. `site/src/islands/ExampleStage.tsx` mounts the panel. `site/src/i18n/en.ts`, `site/src/styles/custom.css` and the guide page `object-controls.mdx` gain the labels, the styles and one section. `packages/radiance` gains tests and no code. No export appears, so `bun run bake:api-surface` changes nothing.
- **Documents.** `docs/plan.md` changes three rows. They are the L3 row and the L2 row of section 3 (the addons and the engine's classes), and the picking row of section 7. `README.md`: its row of `packages/addons` (it names `OrbitControls`, `GLTFLoader` and the Cornell box scene) gains `TransformControls` and `InteractionControls`. Its row of `packages/radiance` gains the ray cast.
- **Tests owed.**
  - `src/accel/cast.test.ts` and `src/core/Raycaster.test.ts`. A ray along -z from the camera (0, 1, 3.4) meets `back` at 4.4. A ray from the camera at the white ball's centre (0.45, 0.4, 0.3) meets the ball. The distance lies from 2.7894 to 2.7933. The ideal sphere gives 2.78944. A face of 32 by 16 segments lies at most 0.0039 below it. The mirror ball's centre (-0.45, 0.4, -0.35) gives 3.4243 to 3.4282 the same way. A mirrored instance with a non-uniform scale returns a normal that faces the ray. 1,000 random rays give the same nearest mesh and triangle as the oracle's `nearest`, and a distance within 1e-5. A ray from the camera (0, 1, 3.4) through the centre of the white ball returns two entries, in this order. The first is `ball`, at a distance from 2.7894 to 2.7933. The second is `back`, at 4.52694 (the plane z = -1) within 1e-5. The test asserts the length of the list as 2. The parity test compares the slots. The cast lists the meshes in the pack's order, with the pack's skip rules. It builds its TLAS from the same f64 boxes by the same code. So `tlas.order` and the slots agree. The test asserts that the two orders are equal before it compares. A hidden mesh, a mesh under a hidden ancestor and an instance with no inverse meet nothing. A mesh with an emptied geometry meets nothing and throws nothing. `near` and `far` cut the list. With `far` at 3, that ray lists `ball` alone. With `near` at 3, it lists `back` alone. A `direction` of length 3 gives the same `distance` as the unit one. So does a write of length 3 to `ray.direction` after `set`. `recursive` set to `false` skips the descendants.
  - `packages/addons/src/controls/picking.test.ts`: a glTF built by hand with one mesh of two primitives. The node also has a child node with one mesh, and another child node with no mesh and a child mesh. A ray at the second primitive returns its `Mesh`, and the selection rule gives the `Group`. A ray at the child's mesh returns that mesh, and the rule gives the mesh. The same holds for the mesh under the node with no mesh.
  - `packages/addons/src/controls/transform-math.test.ts`: the pixel to ray and world to pixel maps invert each other within 1e-9 pixel. Another test fixes their scale. The Cornell box camera is at (0, 1, 3.4) and aimed at (0, 1, 0). Its `fov` is 40 and its `aspect` is 1. The canvas is 512 by 512. The centre of the white ball (0.45, 0.4, 0.3) projects to the pixel (358.0998, 392.1331) within 0.001. The pixel to ray map at that pixel gives the unit vector from the eye to the centre within 1e-6. The test also forms the kernel's primary ray from `cameraFrame`'s `lens` by the formula of `trace.shade.ts` (lines 212 to 218). It compares that ray with the map within 1e-12. An axis drag returns the exact offset for a pointer that moves along the axis line, and 0 for a pointer that does not move. A disc drag keeps the depth. A ring drag in each regime returns the angle that a pointer on the ring has turned, within 1e-9 in regime A. A pointer ray may be parallel to a ring's plane, or it may meet the plane behind the eye. In regime A it then starts no drag, and a move keeps the last angle. A ring at the regime boundary, with `|dot(a, v)|` near 0.25, gives angles of one sign in both regimes for the same pointer turn. A pointer ray parallel to the axis starts no drag, even where the axis is 25 degrees off `F`. `Euler` from a matrix round-trips 1,000 random rotations within 1e-12, and the gimbal lock case. The local transform of an object under a mirrored parent puts its world position where the drag asked. A parent that shears refuses a rotation.
  - `scripts/harness.mjs`: the interaction check of step 6.
  - The repository has no DOM library (`package.json`). So the harness check holds the pointer and key handlers, and `bun test` does not. `bun test` holds the pure functions that the handlers call.
  - `packages/radiance/src/materials/Material.test.ts` (new). Each setter of `Material` and of `PhysicalMaterial` adds 1 to `version`. A setter adds 1 for an equal value. A write to `color.r` adds 0.
  - `packages/radiance/src/renderers/scene-pack.test.ts`. After a setter edit of `color`, `emissive` or `doubleSided`, `update` writes `materials` and writes none of `nodes`, `instances`, `triangles` and `vertices`. It writes `lights` only when the words of the light table change. `pack.arrays.nodes` is the same array object before and after, so no TLAS built. After `mesh.material = new MirrorMaterial()`, `update` writes `instances`, `lights`, `materials` and `nodes`, and `pack.counts.materials` is one more.
  - `scripts/material-panel.test.ts` (new), on the pure functions of `site/src/lib/material-fields.ts`. The fields of each class match the table of "The material inspector". A `#rrggbb` value round-trips for each of the 256 levels of a channel. The intensity and hue split, and the two writes, give the radiance that the rules state for `DiffuseMaterial`, `EmissiveMaterial` and `PhysicalMaterial`. A type change carries the fields that the rules name. The sharing count of the Cornell box is 4 for `white` and 1 for `red`, and it counts a hidden mesh.
  - `scripts/harness.mjs`: the material check of step 8.
- **Gates.** `bun run gate:api`, `bun run gate:site`, `bun run gate:render` (no golden changes), `bun run check:boundary`, `bun run check:ste`, `bun run check:prose` and `bun run harness`.

## Implementation, in steps

Each step is one pull request with `Design: 0008` in its commit message. Each test of a decision carries `Verifies: Design 0008.k`.

1. **The ray cast.** Add `Raycaster`, `Intersection`, `Group`, `src/accel/cast.ts` and `src/math/affine.ts`. Re-bake the engine's surface. Add `Raycaster` and `Intersection` to record 0003's list. `Group` is there already. Check the names of `Raycaster` and `Intersection` against the three.js documentation, and amend this record for each difference. The tests are those of "Tests owed" for `cast.test.ts` and `Raycaster.test.ts`. Record these costs in the pull request, in microseconds. They are one cast for the Cornell box and one for the bunny. They also cover the first cast for the bunny (the BLAS build) and a brute-force cast over its 69,451 triangles. Step 1 measures them. Done when `bun run check` passes, the parity test passes on 1,000 rays and the two-entry test passes.
2. **The drag mathematics.** Add `transform-math.ts` and its test in the addons. It holds the maps, the three drags, the snapping and `Euler` from a matrix. It also holds the local transform, the similarity test, the outline and the handle geometry. It touches no DOM name. Done when `bun test packages/addons` passes with the tolerances of "Tests owed".
3. **`TransformControls`.** Add the class and the overlay writer on `transform-math.ts`. Check each three.js name that "The public API" lists, and amend this record for any difference. Re-bake the addons' surface and add the names to record 0003's list. A page that passes a `<svg>` and an object sees handles and moves the object. Done when `bun run gate:api` passes. Step 6 holds the pointer handlers.
4. **`InteractionControls`, the `Group` and the names.** Add the class, its click rule and its key map. Add `GLTFLoader`'s `Group` for the primitives of a node of two or more, and change its test. Add the names in `createCornellBox`. Re-bake the addons' surface again. Add `picking.test.ts` and a test of the pure key map. Done when `bun run check` passes.
5. **The site.** Change the stage, `ExampleRun`, the ten examples, the copy, the CSS and the guide page. Record in the pull request the toolbar's width and height at 1440 and at 390 CSS pixels, before and after. Record the count of its buttons. Done when `bun run gate:site` and `bun run gate:render` pass and no golden and no still changed.
6. **The harness check.** Add an interaction check to the site step of `scripts/harness.mjs`, on the Cornell box page. It runs these actions.
   1. Press `w` with the canvas focused. Read `data-mode` as `translate`.
   2. Press `Shift+q`. Read `data-mode` as `select`.
   3. Press `Shift+w`. Read `data-mode` as `translate`.
   4. Press `Home`. `OrbitControls` resets the view, which the earlier steps of the site check turned.
   5. Take the camera at (0, 1, 3.4), aimed at the look point (0, 1, 0), with `fov` 40.
   6. Compute the pixel of the white ball's centre with the map of "The drag mathematics" and the canvas's client size.
   7. Click that pixel. Read `data-selection` as `object` and `data-selected` as `ball`. Read `data-position`.
   8. Drag the `translate-x` handle by 50 CSS pixels along its screen direction. Read the status `Preview` during the drag.
   9. Release. Read `data-position`. Read that `x` rose. Read that `y` and `z` moved by 1e-6 or less. Read that the samples fell below their earlier count.
   10. Drag the `translate-x` handle again by 50 CSS pixels. Press `Escape` before the release. Read that `data-position` equals the string of action 9.
   11. Press `q`, then press `o`. Read `data-mode` as `orbit`.
   12. Compute the pixel of the mirror ball's centre (-0.45, 0.4, -0.35) in the same way. Click it. Read that `data-selected` is still `ball`.

   The ball's parent is the scene, and the scene has no transform. So the local `position` is the world position in this check.

   Record the cost of the restart on SwiftShader, labelled as such. SwiftShader is not a hardware GPU, and the record holds no hardware number. Done when `bun run harness` passes in CI.

7. **Documents and close.** Change `docs/plan.md` as "What it touches" says. This pull request waits for the owner's "merge" in the conversation. A change to the plan waits for it even inside an accepted record (`CLAUDE.md`, Merging). Change the row of section 7 to read "picking by a host ray cast (`Raycaster`, record 0008)". The old text was "picking (`examples/id-pick`'s way)". The rest of the row stays. Its milestone cell stays `M1`. The `L3` row of the addons gains `TransformControls` and `InteractionControls`. The `L2` row of the engine gains `Raycaster`. Change `README.md` as "What it touches" says. This step follows step 8. Set `status: implemented`. Record the commits, the pin, each gate's result and the numbers of steps 1, 5, 6 and 8.

8. **The material inspector.** Add `MaterialPanel` and `site/src/lib/material-fields.ts`. Mount the panel in the stage. Add the guide section and the tests of "Tests owed". Add the material check to the site step of `scripts/harness.mjs`. It follows the check of step 6 and runs these actions.

   Step 8 stands apart from step 5, which already carries the stage, the ten examples and the guide page. It needs steps 4 and 5 and follows step 6. Step 7 sets `status: implemented` only after step 8 merges.

   The check of step 6 ends in mode `orbit` with `ball` selected. Action 1 relies on both.

   1. Press `q`. Read `data-mode` as `select`. Read `data-selected` as `ball`.
   2. Read `data-material-type` as `DiffuseMaterial`. Read `data-shared` as 4. Read `data-version` as `v`.
   3. Wait for `data-samples` to read 4 or more. Read it as `s0`. Take a screenshot of the canvas.
   4. Fill the `color` input with `#ff0000`.
   5. Wait for `data-version` to read `v + 1`, or for `data-samples` to read less than `s0` at any poll. A read of 0 counts. Do not wait for a count under 4. `cornell-box.ts` sets `targetFrameTime` 30, and `samplesPerFrame` adapts up to 64. So the first frame after the restart can take 4 samples or more. The 200 ms poll can also miss a short low count.
   6. Read `data-value` of the `color` field as `#ff0000`. Read `data-version` as `v + 1`.
   7. Wait for `data-samples` to read 2 or more. Then wait up to 10 s for the canvas to differ from the screenshot of action 3. `data-samples` can still hold the count from before the edit. Read that the canvas differs.
   8. Fill the `emissive` input with `#00ff00`.
   9. Read `data-value` of `emissive` as `#00ff00`. Read `data-value` of `emissiveIntensity` as 1.
   10. Click the centre of the canvas. The ray meets `back`. Read `data-selected` as `back` and `data-shared` as 4.
   11. Read `data-value` of `color` as `#ff0000`. The edit of the ball reached the wall that shares its material.
   12. Click the pixel of the mirror ball's centre. Read `data-material-type` as `MirrorMaterial`. Read `data-shared` as 1.
   13. Read `data-value` of `color` as the string `c`.
   14. Select `DiffuseMaterial` in the `type` field.
   15. Read `data-material-type` as `DiffuseMaterial`. Read `data-value` of `color` as `c`.

   If the owner chooses to clone on edit (decision 25), three reads change. After action 4, `data-shared` of `ball` reads 1. Action 10 reads `data-shared` as 3. Action 11 reads `data-value` of `color` as the colour of `white` before the edit.

   Record the cost of the restart after a field edit and after a type change on SwiftShader, labelled as such. Record the host time and the written bytes of both, from the pack with no device. Record the panel's width and height at 1440 and at 390 CSS pixels, open and collapsed. Done when `bun run check` and `bun run harness` pass in CI, `bun run gate:site` and `bun run gate:render` pass, no golden changed and `bun run gate:api` shows no new export.

## Decisions for the owner

1. The controls have four modes, `orbit`, `select`, `translate` and `rotate`. One is active. `orbit` is the default and never changes the scene. Proposed: yes.
2. The keys are `O`, `Q`, `W` and `E` for the four modes, and `Escape` cancels a drag or clears the selection. A mode key matches the key code, so Shift and the layout do not matter. `W` and `E` are three.js's. Proposed: yes.
3. A click picks in `select`, `translate` and `rotate`. A left drag off a handle orbits in every mode. The right drag and the wheel always move the camera. Proposed: yes.
4. The ray cast is `Raycaster` in `@typeshade/radiance`, built on the engine's BLAS and TLAS builder, with no GPU pass. Proposed: yes.
5. `Raycaster` and its type `Intersection` are public names of `@typeshade/radiance`. `Raycaster` keeps three.js's members `ray`, `near`, `far`, `set`, `setFromCamera`, `intersectObject` and `intersectObjects`. Proposed: yes.
6. `Group` is exported by `@typeshade/radiance`, as record 0003 already lists. Proposed: yes.
7. `TransformControls`, `TransformMode` and `TransformControlsEvents` are public names of `@typeshade/radiance-addons`. The members follow three.js's, except `handleLength`, which is in CSS pixels where three.js's `size` is a world scale. Proposed: yes.
8. `InteractionControls`, `InteractionMode` and `InteractionControlsEvents` are public names of `@typeshade/radiance-addons`. three.js has no counterpart. Record 0003, rule 3 takes the plan's name, and the plan has none yet, so this record proposes the names. Step 7 adds `InteractionControls` to the plan. Proposed: yes.
9. The field `normal` of an `Intersection` is the unit geometric normal in world space. three.js's `face.normal` is in object space. Step 1 checks whether three.js's `Intersection` has a `normal` with another meaning. If it has, an amendment renames the field `faceNormal`. Proposed: yes.
10. `intersectObjects` lists one entry for each mesh, nearest first. `Intersection` has `distance`, `point`, `object`, `faceIndex` and `normal`, and no instance slot. Proposed: yes.
11. The gizmo is an SVG overlay that the page owns. Drawing it into the canvas needs a raster layer and is a later record. Proposed: yes.
12. An axis arrow drags by the closest point between the pointer's ray and the axis. The disc drags in the screen plane. A ring drags by the plane angle, or by the tangent when the plane is nearly edge-on. Proposed: yes.
13. Snapping is off by default. `translationSnap` is in world units and `rotationSnap` in radians. The page sets them, and no key does. Proposed: yes.
14. Scale is not a mode now. Proposed: not now.
15. The selection persists across mode changes, including `orbit`. A click on empty space and `Escape` clear it. Proposed: yes.
16. A click on a mesh selects its nearest `Group` ancestor, else the mesh. `GLTFLoader` makes a `Group` for the primitives of a node of two or more, and the node keeps its child nodes beside it. Proposed: yes.
17. The controls refuse a rotation when the parent's linear part is not a similarity, and they hide the rings. A translation works under any invertible parent. Proposed: yes.
18. The math lives in the addons as private functions of `transform-math.ts`. The engine gains no `Quaternion`, no `Matrix4.invert` and no `Euler` reader now. Proposed: yes.
19. Every example that returns `scene` and `camera` gets the modes. `determinism` opts out. The front page's compact stage gets none. `scene-graph` stays in, and its motion pauses during a drag. Proposed: yes.
20. The record serves no milestone, so `milestones` is empty. It is a change to the engine's core (the ray cast), the addons and the site. `docs/plan.md` section 4 has no item for it, so the owner sets its place in the order. Proposed: after the Sponza example, and before the image-quality changes that the owner approved on 2026-10-06 (the output transform, the sampler and the sphere tessellation).
21. The material inspector is a panel of the page, in the DOM over the top right of the canvas. It shows in `select` mode for a selected `Mesh`. It adds no export. Proposed: yes.
22. The panel lists these controls by class: `color`, `emissive`, `emissiveIntensity` and `doubleSided`. The `emissive` control shows the hue of the emission and the `emissiveIntensity` control shows its intensity. The panel derives both from the radiance, and only `PhysicalMaterial` has a field `emissiveIntensity`. `PhysicalMaterial`'s five parameters wait for step 2 of record 0004, and textures for step 3. Proposed: yes.
23. A field edit assigns through the setters of the material, and each adds 1 to `version`. The pack then writes `materials`, and `lights` when its words change, and builds no TLAS. The panel reads each value back from the material. Proposed: yes.
24. A type change replaces `mesh.material` with a new instance of the chosen class. The instance takes `name`, `color`, the emission and `doubleSided` from the old instance, hidden fields too, and omits the fields that its class lacks. The path costs as a transform change does, and the old table entry stays. `PhysicalMaterial` is no option before step 2 of record 0004. Proposed: yes.
25. An edit applies to every mesh that shares the material instance, and the panel shows how many. The alternative is a clone on the first edit, for the selected mesh alone. Proposed: share.
26. The panel does not set `run.editing`. Each edit restarts the accumulation at the full frame size. Step 8 measures the restart. Proposed: yes.

## Record

**Approval and plan record.** Accepted on 2026-10-06 (UTC). The owner pre-approved the merge of typeshade/radiance#46 in the conversation, which merged this record as `draft` at 06b2928. The owner then answered the decisions with "as recommended" (2026-10-06), and that answer is the acceptance. Every entry of "Decisions for the owner" stands as proposed.

**Configuration and validation record.** This record does not yet apply. Implementation will record the commits of the eight steps, the pin and each gate's result. It will also record the numbers that "Before" and the steps label as measured later.

**Open items at authorship.**

- **The request's premise.** The request to this session said that a transform change bumps an `Object3D` version. `Object3D` has no version. The pack compares the instance array bit for bit ("Before"). This record states the code's behaviour. Disposition: closed.
- **Plan section 7's wording.** The row says "picking (`examples/id-pick`'s way)". That example does not pick ("Before"). Disposition: open. Next action: the owner accepts the host cast, and step 7 changes the row.
- **three.js's names.** Every claim about three.js in this record comes from memory. That includes the keys and the members of `TransformControls`. No three.js source was read for it. Disposition: open. Next action: step 3 checks the names and amends this record for each difference.
- **Pause and a moved object.** `PathTracer.render` clears the accumulation when the scene changes. With `paused` true it then traces nothing (`working` is false). In an example that does not define `playing`, Pause sets `renderer.paused`. That is nine of the ten examples that have controls. By that code, a drag in such an example while Pause is on leaves the stale frame on the canvas. It stays until the viewer turns Pause off, as it does for a camera drag now. The restart sets the accumulation and the count of samples to 0. `working` is false, so nothing dispatches. `#drawn` stays true. `scene-graph.ts` defines `playing`. There Pause stops only its motion, so a drag restarts the accumulation and the tracer traces (`ExampleStage.tsx`, the Pause effect). Not run in a browser. Disposition: open. Next action: step 5 reads this in a browser, and the owner chooses between leaving it and disabling the modes while paused.
- **A click also orbits.** `OrbitControls` starts an orbit on every primary press and stays unchanged. A click that moves 1 to 4 pixels in `select`, `translate` or `rotate` mode also turns the camera by that move and restarts the accumulation. With damping on, the release can leave a small coast. Disposition: open. Next action: step 5 measures the turn of a 4 pixel click. The owner then accepts it or asks for a suppress rule in a later record.
- **three.js's `Intersection`.** three.js's mesh intersection may have a `normal` field with the meaning of an interpolated normal. This comes from memory. Decision 9 gives the next action. Disposition: open. Next action: step 1 checks the name.
- **Double click.** `OrbitControls` resets the view on a double click. In `select` mode, two quick clicks on an object also reset the view. Disposition: open. Next action: the owner decides whether the edit modes turn the reset off.
- **Wheel over a handle.** A handle is above the canvas, so a wheel turn over it does not reach `OrbitControls`. Disposition: open. Next action: step 3 forwards `wheel` from a handle to the canvas, or the owner accepts it.
- **Listener order.** `InteractionControls` and `OrbitControls` both listen for `pointerdown` on the canvas. This design depends on neither stopping the other. `OrbitControls` calls `preventDefault` and `setPointerCapture` and does not stop propagation. Disposition: closed by reading `#onPointerDown`. Step 6 holds it.
- **Not measured.** The cost of one cast, the toolbar's size, and the device write of a transform change. Steps 1, 5 and 6 measure them. A hardware GPU number does not exist.
- **Not measured, inspector.** Step 8 measures four numbers. They are the host time and bytes of a field edit and of a type change, the restart on SwiftShader and the panel's size. The type change numbers in "The material inspector" are an inference.
- **Deferred, and not proposed.** Keyboard nudging of the selection, a numeric field for a position, undo, and a world-or-local space switch. None is in a step.
- **The second request.** The owner asked on 2026-10-06 to change materials at run time and watch the render. "The material inspector" and step 8 answer it. Status: not started. Disposition: open. Next action: the owner reviews decisions 21 to 26.
- **Shared materials.** In the Cornell box, `white` serves four meshes, so an edit of the ball also changes three walls. Decision 25 proposes this and names the clone on edit as the alternative. Disposition: open. Next action: the owner chooses.
- **Table growth.** The pack never frees an index of `materials`. Each type change leaves 128 bytes. Disposition: open. Next action: the owner accepts it, or a later record makes the pack reuse the indexes.
- **Deferred by the inspector, and not proposed.** Some items wait for later records. The first is `PhysicalMaterial`'s five parameters (record 0004, step 2). Then come textures (step 3), a panel for the meshes of a `Group`, undo and the controls of a light. None is in a step.

**Amendment 1** (2026-10-06, UTC). The Sponza example is a tenth example that has controls. This record counts nine. The count is true at `main` eafc2e1, the baseline of "Before". It is false in the pull request that adds `site/examples/sponza.ts`. That example returns `renderer`, `controls` and `dispose`. It has no `playing`. Its loop runs `renderer.preview = controls.moving ? 4 : 1`. This amendment changes six sentences and nothing else. It changes no code, no step and no decision. The decisions keep their numbers and their text.

1. "The other nine examples return both ... Eight of them run" in "The material inspector" becomes "The other ten examples ... Nine of them run".
2. "one of the eight examples of this kind" in "Pause" becomes "one of the nine examples of this kind".
3. "the nine examples that have controls" in "What it touches" becomes "the ten examples that have controls".
4. "the nine examples" in step 5 becomes "the ten examples".
5. "the nine examples" in the note on step 8 becomes "the ten examples".
6. In the open item "Pause and a moved object", "eight of the nine examples that have controls" becomes "nine of the ten".

The sentence of "Before" that lists eight examples stays. It states the baseline, and `sponza` is not in it. Sponza joins the nine in step 5. That step reads `run.editing` in the loop of each example, and it covers `sponza` as it covers `bunny`. The merge of the pull request that carries this amendment is the owner's acceptance. The pull request that adds the Sponza example merges after it.

- **The fact.** Measured on 2026-10-06 at `main` 8f52997, by a search of `site/examples/*.ts` for `controls`. Nine examples create controls: `bunny`, `coloured-lights`, `cornell-box`, `first-scene`, `geometries`, `instances`, `lights`, `materials` and `scene-graph`. `determinism.ts` creates none. Only `scene-graph.ts` defines `playing`.
- **Not run.** No browser check ran for this amendment. The open item "Pause and a moved object" keeps its disposition: open.
