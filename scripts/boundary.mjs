// === The boundary: every package is written on the public runtime alone ===
//
// `docs/plan.md` (Architecture) sets the rule the compiler's engine journey set first: a package
// above the compiler imports `typeshade/runtime`, its sibling packages and its own files, and
// nothing else, and it calls nothing on a WebGPU object. The runtime makes and records every
// buffer, texture, pipeline and bind group, so a package that reaches past it is a package the
// runtime cannot keep correct. The pattern and the WebGPU list are the compiler's
// (`journeys/_harness.mjs`, `engineOffence`).
//
// Shader sources (`*.shade.ts`) are compiled, not run: they import other shaders by relative
// path, and the rule does not read them. Tests (`*.test.ts`) are not shipped and are not read.
//
// `node scripts/boundary.mjs` exits 1 and names each offence; `bun test` holds the check itself
// to an offence it must see (scripts/boundary.test.ts).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** What a package may import by bare name: the runtime's public subpath, and a sibling. */
const ALLOWED = new Set(['typeshade/runtime']);
const SIBLING = /^@typeshade\/radiance-[a-z-]+(\/|$)/;

/** A WebGPU call or global a package's own code must not reach for. */
const WEBGPU_CALL =
  /\bnavigator\s*\.\s*gpu\b|\bGPU[A-Z]\w*|\.\s*(createBuffer|createTexture|createView|createSampler|createBindGroup|createBindGroupLayout|createPipelineLayout|createShaderModule|createRenderPipeline|createRenderPipelineAsync|createComputePipeline|createComputePipelineAsync|createCommandEncoder|beginRenderPass|beginComputePass|setPipeline|setBindGroup|setVertexBuffer|setIndexBuffer|setScissorRect|setViewport|writeBuffer|writeTexture|queue|raw|mapAsync|getMappedRange)\b/;

/** Why `source` is not on the public runtime alone, or '' when it is. */
export function offence(source) {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  for (const m of code.matchAll(
    /\bimport\s*(?:[^'"]*?\bfrom\s*)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]|\bexport\s*(?:\*|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/g,
  )) {
    const spec = m[1] ?? m[2] ?? m[3];
    if (spec.startsWith('./') || spec.startsWith('../')) continue;
    if (ALLOWED.has(spec) || SIBLING.test(spec)) continue;
    return `imports "${spec}", which is not the runtime's public subpath nor a sibling package`;
  }
  const call = WEBGPU_CALL.exec(code);
  return call ? `calls WebGPU itself: "${call[0].trim()}"` : '';
}

/** Every host source under `dir`: `.ts` files that are neither shaders nor tests. */
export function sources(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) {
        if (name !== 'node_modules' && name !== 'dist') walk(p);
      } else if (p.endsWith('.ts') && !p.endsWith('.shade.ts') && !p.endsWith('.test.ts')) {
        out.push(p);
      }
    }
  };
  walk(dir);
  return out.sort();
}

if (process.argv[1] && import.meta.url.endsWith(relative(process.cwd(), process.argv[1]))) {
  const root = join(process.cwd(), 'packages');
  const offences = [];
  let count = 0;
  for (const pkg of readdirSync(root)) {
    const src = join(root, pkg, 'src');
    let files = [];
    try {
      files = sources(src);
    } catch {
      continue;
    }
    for (const file of files) {
      count++;
      const why = offence(readFileSync(file, 'utf8'));
      if (why) offences.push(`${relative(process.cwd(), file)}: ${why}`);
    }
  }
  if (offences.length > 0) {
    process.stderr.write(
      `${offences.join('\n')}\n\nA package is written on typeshade/runtime's public exports alone (docs/plan.md, Architecture).\n`,
    );
    process.exit(1);
  }
  console.log(`boundary: ${count} source file(s) on the public runtime alone`);
}
