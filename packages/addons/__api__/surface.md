# @typeshade/radiance-addons: public API surface

Generated file: `scripts/bake-api-surface.ts` writes it. Do not edit it by hand.

Run `bun run bake:api-surface` to write it again from the TypeScript program. `bun run gate:api` fails when it and the tree disagree.

Each line is one name that `src/index.ts` exports: the name, its kind and its type as TypeScript prints it.
A class line also lists its constructor and its static members. A private member is not listed.
The script sorts the lines by name.

## 11 exports

```
CornellBox  interface  { readonly bounds: Box3; readonly camera: PerspectiveCamera; readonly scene: Scene; readonly target: Vector3 }
DemoScene  interface  { readonly bounds: Box3; readonly camera: PerspectiveCamera; readonly scene: Scene; readonly target: Vector3 }
FlyControls  class  extends EventDispatcher<FlyControlsEvents>; new (camera: Camera, domElement: HTMLElement): FlyControls; { addEventListener: <K extends keyof FlyControlsEvents>(type: K, listener: (event: FlyControlsEvents[K]) => void) => void; dispatchEvent: <K extends keyof FlyControlsEvents>(type: K, event: FlyControlsEvents[K]) => void; dispose: () => void; enabled: boolean; movementSpeed: number; readonly moving: boolean; removeEventListener: <K extends keyof FlyControlsEvents>(type: K, listener: (event: FlyControlsEvents[K]) => void) => void; reset: () => void; rotationSpeed: number; saveState: () => void; update: (dt?: number) => boolean }
FlyControlsEvents  type  { change: undefined; end: undefined; start: undefined }
GLTFLoader  class  new (): GLTFLoader; { load: (url: string, onLoad: (gltf: GLTF) => void, onProgress?: ((event: GLTFProgress) => void) | undefined, onError?: ((error: unknown) => void) | undefined) => void; loadAsync: (url: string, onProgress?: ((event: GLTFProgress) => void) | undefined) => Promise<GLTF>; parse: (data: string | ArrayBuffer | ArrayBufferView, path: string, onLoad: (gltf: GLTF) => void, onError?: ((error: unknown) => void) | undefined) => void; parseAsync: (data: string | ArrayBuffer | ArrayBufferView, path?: string) => Promise<GLTF> }
OrbitControls  class  extends EventDispatcher<OrbitControlsEvents>; new (camera: Camera, domElement: HTMLElement): OrbitControls; { addEventListener: <K extends keyof OrbitControlsEvents>(type: K, listener: (event: OrbitControlsEvents[K]) => void) => void; dampingFactor: number; dispatchEvent: <K extends keyof OrbitControlsEvents>(type: K, event: OrbitControlsEvents[K]) => void; dispose: () => void; enableDamping: boolean; enabled: boolean; getDistance: () => number; maxAzimuthAngle: number; maxDistance: number; maxPolarAngle: number; minAzimuthAngle: number; minDistance: number; minPolarAngle: number; readonly moving: boolean; readonly target: Vector3; removeEventListener: <K extends keyof OrbitControlsEvents>(type: K, listener: (event: OrbitControlsEvents[K]) => void) => void; reset: () => void; rotateSpeed: number; saveState: () => void; targetBounds: Box3; update: (dt?: number) => boolean; zoomSpeed: number }
OrbitControlsEvents  type  { change: undefined; end: undefined; start: undefined }
createCornellBox  function  () => CornellBox
createInstancesScene  function  () => DemoScene
createLightsScene  function  () => DemoScene
createTrianglesScene  function  () => DemoScene
```
