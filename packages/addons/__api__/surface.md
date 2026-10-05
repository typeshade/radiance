# @typeshade/radiance-addons: public API surface

Generated file: `scripts/bake-api-surface.ts` writes it. Do not edit it by hand.

Run `bun run bake:api-surface` to write it again from the TypeScript program. `bun run gate:api` fails when it and the tree disagree.

Each line is one name that `src/index.ts` exports: the name, its kind and its type as TypeScript prints it.
A class line also lists its constructor and its static members. A private member is not listed.
The script sorts the lines by name.

## 4 exports

```
CornellBox  interface  { readonly bounds: Box3; readonly camera: PerspectiveCamera; readonly scene: Scene; readonly target: Vector3 }
OrbitControls  class  extends EventDispatcher<OrbitControlsEvents>; new (camera: Camera, domElement: HTMLElement): OrbitControls; { addEventListener: <K extends keyof OrbitControlsEvents>(type: K, listener: (event: OrbitControlsEvents[K]) => void) => void; dampingFactor: number; dispatchEvent: <K extends keyof OrbitControlsEvents>(type: K, event: OrbitControlsEvents[K]) => void; dispose: () => void; enableDamping: boolean; enabled: boolean; getDistance: () => number; maxAzimuthAngle: number; maxDistance: number; maxPolarAngle: number; minAzimuthAngle: number; minDistance: number; minPolarAngle: number; readonly moving: boolean; readonly target: Vector3; removeEventListener: <K extends keyof OrbitControlsEvents>(type: K, listener: (event: OrbitControlsEvents[K]) => void) => void; reset: () => void; rotateSpeed: number; saveState: () => void; targetBounds: Box3; update: (dt?: number) => boolean; zoomSpeed: number }
OrbitControlsEvents  type  { change: undefined; end: undefined; start: undefined }
createCornellBox  function  () => CornellBox
```
