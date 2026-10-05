/** The shape of a mesh, in the mesh's own space. The path tracer draws a `BufferGeometry`: a
 *  triangle mesh (design record 0001). */
export abstract class Geometry {
  abstract readonly type: string;
}
