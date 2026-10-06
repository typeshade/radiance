import {
  Box3,
  BufferGeometry,
  Color,
  DiffuseMaterial,
  EmissiveMaterial,
  Mesh,
  MirrorMaterial,
  PerspectiveCamera,
  QuadGeometry,
  Scene,
  Vector3,
} from '@typeshade/radiance';
import type { DemoScene } from './DemoScene.ts';

/**
 * A lopsided octahedron: a square ring of four vertices with an apex above it, leaning to +x,
 * and one below. It has 8 triangles on 6 vertices, smooth normals, and no mirror symmetry, so a
 * mirrored instance of it differs from the original.
 */
function gem(): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.position = Float32Array.of(
    ...[0.4, 0, 0], // 0: +x
    ...[0, 0, 0.4], // 1: +z
    ...[-0.4, 0, 0], // 2: -x
    ...[0, 0, -0.4], // 3: -z
    ...[0.3, 0.5, 0], // 4: the apex, leaning to +x
    ...[0, -0.4, 0], // 5: the bottom
  );
  geometry.index = Uint32Array.of(
    ...[4, 1, 0, 4, 2, 1, 4, 3, 2, 4, 0, 3], // the upper four, counter-clockwise from above
    ...[5, 0, 1, 5, 1, 2, 5, 2, 3, 5, 3, 0], // the lower four
  );
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * One geometry, `gem()`, in four instances that share its BVH, and a floor, a back wall and a
 * lamp. The first instance is placed as it is. The second is scaled by (1.6, 0.7, 1) under a
 * turn, so its world matrix has columns of different lengths that stay at right angles (a
 * non-uniform scale, and no shear). The third is scaled by -1 along x, so its matrix has a
 * negative determinant and it must still shade outward. The fourth is a mirror. It is the
 * `instances` scene of the differential gate (design record 0002).
 */
export function createInstancesScene(): DemoScene {
  const scene = new Scene();
  const white = new DiffuseMaterial({ color: new Color(0.73, 0.73, 0.73) });
  const red = new DiffuseMaterial({ color: new Color(0.7, 0.1, 0.08) });
  const green = new DiffuseMaterial({ color: new Color(0.12, 0.5, 0.18) });
  const light = new EmissiveMaterial({ color: new Color(14, 13, 10) });
  const shape = gem();

  const floor = new Mesh(new QuadGeometry(4, 4), white);
  floor.rotation.x = -Math.PI / 2;
  const back = new Mesh(new QuadGeometry(4, 3), white);
  back.position.set(0, 1.5, -1.2);
  const lamp = new Mesh(new QuadGeometry(0.8, 0.5), light);
  lamp.position.set(0, 1.9, 0.2);
  lamp.rotation.x = Math.PI / 2;

  const plain = new Mesh(shape, white);
  plain.position.set(-1, 0.4, 0);
  const stretched = new Mesh(shape, red);
  stretched.position.set(-0.15, 0.28, 0.45);
  stretched.rotation.y = 0.6;
  stretched.scale.set(1.6, 0.7, 1);
  const mirrored = new Mesh(shape, green);
  mirrored.position.set(0.85, 0.4, 0.05);
  mirrored.scale.set(-1, 1, 1);
  const shiny = new Mesh(shape, new MirrorMaterial());
  shiny.position.set(0.1, 0.48, -0.6);
  shiny.rotation.y = -0.4;
  shiny.scale.set(1.2, 1.2, 1.2);

  scene.add(floor, back, lamp, plain, stretched, mirrored, shiny);

  const camera = new PerspectiveCamera(40, 1);
  const target = new Vector3(0, 0.5, 0);
  camera.position.set(0, 1.3, 3.9);
  camera.lookAt(target);
  return {
    scene,
    camera,
    target,
    bounds: new Box3(new Vector3(-1.2, 0.1, -1), new Vector3(1.2, 1.5, 1)),
  };
}
