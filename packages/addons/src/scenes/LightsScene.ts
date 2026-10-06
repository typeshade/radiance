import {
  Box3,
  BufferGeometry,
  Color,
  DiffuseMaterial,
  EmissiveMaterial,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  Vector3,
} from '@typeshade/radiance';
import type { DemoScene } from './DemoScene.ts';

/**
 * One triangle with its right angle at the origin and legs of `a` along x and `b` along z. It
 * faces -y, so a lamp made of it shines down. Its area is `a * b / 2`.
 */
function triangle(a: number, b: number): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.position = Float32Array.of(0, 0, 0, a, 0, 0, 0, 0, b);
  geometry.index = Uint32Array.of(0, 1, 2);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Three lamps of one triangle each, over a floor, a back wall and a low-polygon sphere. Their
 * areas are 0.045, 0.15 and 0.4, their colours a bright warm one, a blue one and a dim green one,
 * so their powers differ by a factor of three and the light table's cumulative chance picks each
 * lamp in its own share. Each lamp shines from its front face only. It is the `lights` scene of
 * the differential gate (design record 0002).
 */
export function createLightsScene(): DemoScene {
  const scene = new Scene();
  const white = new DiffuseMaterial({ color: new Color(0.73, 0.73, 0.73) });
  const floor = new Mesh(new PlaneGeometry(4, 4), white);
  floor.rotation.x = -Math.PI / 2;
  const back = new Mesh(new PlaneGeometry(4, 3), white);
  back.position.set(0, 1.5, -1.2);
  const ball = new Mesh(new SphereGeometry(0.45, 12, 8), white);
  ball.position.set(0, 0.45, 0);

  const small = new Mesh(
    triangle(0.3, 0.3),
    new EmissiveMaterial({ color: new Color(80, 50, 20) }),
  );
  small.position.set(-1.1, 1.6, -0.2);
  const medium = new Mesh(triangle(0.6, 0.5), new EmissiveMaterial({ color: new Color(4, 8, 16) }));
  medium.position.set(0.1, 1.9, -0.5);
  medium.rotation.z = 0.35;
  const large = new Mesh(triangle(1, 0.8), new EmissiveMaterial({ color: new Color(1, 3, 1.2) }));
  large.position.set(0.5, 1.5, 0.1);
  large.rotation.z = -0.3;

  scene.add(floor, back, ball, small, medium, large);

  const camera = new PerspectiveCamera(40, 1);
  const target = new Vector3(0, 0.6, 0);
  camera.position.set(0, 1.2, 3.2);
  camera.lookAt(target);
  return {
    scene,
    camera,
    target,
    bounds: new Box3(new Vector3(-1, 0.1, -1), new Vector3(1, 1.5, 1)),
  };
}
