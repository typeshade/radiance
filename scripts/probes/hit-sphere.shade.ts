'use typeshade';
import { hitSphere } from '../../packages/radiance/src/kernels/intersect.shade.ts';

// The hit probe (design record 0002, "The hit probe"): `hitSphere` alone, on the GPU and on the
// oracle, over one stored list of rays. The row `sphere-hit` of the differential gate
// (scripts/gates/differential.mjs) dispatches `probe` on the harness page and runs it on the
// oracle, and `compareHits` holds the two answers to each other.
//
// Determinism (design record 0005, "The six rules"): the probe adds no operation of its own.
// `hitSphere` leans on rule 3.

/** Three vec4 for each ray: `(o.xyz, limit)`, `(d.xyz, 0)` and `(c.xyz, r)`. */
declare const rays: storage<array<vec4>>;
/** One vec4 for each ray: `(t, q.xyz)`, as `hitSphere` returns them. */
declare const hits: storage<array<vec4>, 'read_write'>;

/** Invocation `i` reads ray `i`, calls `hitSphere` and writes hit `i`. 64 workgroups take the
 *  4,096 rays, one each. No binding holds a count. */
@compute([64])
export function probe(@builtin('global_invocation_id') gid: vec3u): void {
  const i = gid.x;
  const o = rays[i * 3];
  const d = rays[i * 3 + 1];
  const c = rays[i * 3 + 2];
  hits[i] = hitSphere(o.xyz, d.xyz, c.xyz, c.w, o.w);
}
