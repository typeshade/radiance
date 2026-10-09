// === @typeshade/radiance: the engine ===
//
// Laid out as three.js is: math, a scene graph of Object3D, cameras, geometries, materials and
// meshes, and renderers that draw a Scene through a Camera. The GPU code is TypeShade
// (kernels/*.shade.ts), what TSL is to three.js, and every renderer runs it through the public
// `typeshade/runtime` and nothing else (scripts/boundary.mjs).

export { Box3 } from './math/Box3.ts';
export { Color } from './math/Color.ts';
export { Euler } from './math/Euler.ts';
export { Matrix4 } from './math/Matrix4.ts';
export { Vector3 } from './math/Vector3.ts';

export { Clock } from './core/Clock.ts';
export { EventDispatcher } from './core/EventDispatcher.ts';
export { Object3D } from './core/Object3D.ts';

export { Camera } from './cameras/Camera.ts';
export { PerspectiveCamera } from './cameras/PerspectiveCamera.ts';
export { PhysicalCamera, type PhysicalCameraParameters } from './cameras/PhysicalCamera.ts';

export { BoxGeometry } from './geometries/BoxGeometry.ts';
export { BufferGeometry } from './geometries/BufferGeometry.ts';
export { Geometry } from './geometries/Geometry.ts';
export { PlaneGeometry } from './geometries/PlaneGeometry.ts';
export { SphereGeometry } from './geometries/SphereGeometry.ts';

export { DiffuseMaterial } from './materials/DiffuseMaterial.ts';
export { EmissiveMaterial } from './materials/EmissiveMaterial.ts';
export { Material, type MaterialParameters } from './materials/Material.ts';
export { MirrorMaterial } from './materials/MirrorMaterial.ts';
export { PhysicalMaterial, type PhysicalMaterialParameters } from './materials/PhysicalMaterial.ts';

export { Mesh } from './objects/Mesh.ts';
export { Sphere } from './objects/Sphere.ts';
export { Scene } from './scenes/Scene.ts';

export {
  CANVAS_FORMAT,
  PathTracer,
  TARGET_FORMAT,
  type PathTracerParameters,
} from './renderers/PathTracer.ts';
export { Renderer } from './renderers/Renderer.ts';
