/** The shape of a mesh, in the mesh's own space. M1 has analytic shapes; triangles come at M2. */
export abstract class Geometry {
  abstract readonly type: string;
}
