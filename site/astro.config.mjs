// radiance.typeshade.dev: Starlight for the documentation, the search and the API reference
// (generated from the engine's own JSDoc by starlight-typedoc), and the site's own pages for
// the front page and the examples, with React islands and Ant Design inside them. Every code
// sample on an example page is the file that runs on it, and every number comes from the build
// (src/lib/facts.ts). Tailwind utilities read the tokens of DESIGN.md (src/styles/custom.css).
import { fileURLToPath } from 'node:url';
import react from '@astrojs/react';
import starlight from '@astrojs/starlight';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';
import starlightLlmsTxt from 'starlight-llms-txt';
import starlightTypeDoc, { typeDocSidebarGroup } from 'starlight-typedoc';
import { typeshade } from 'typeshade/vite';
import { verifyStills } from '../scripts/stills.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const repo = 'https://github.com/typeshade/radiance';

export default defineConfig({
  site: 'https://radiance.typeshade.dev',
  output: 'static',
  trailingSlash: 'always',
  outDir: '../dist/site',
  integrations: [
    // The stills under public/stills are captured by scripts/capture-stills.mjs and committed
    // with a .sha256 each; the build checks the hashes instead of running a browser.
    {
      name: 'radiance:stills',
      hooks: {
        'astro:build:start': () => verifyStills(root),
      },
    },
    starlight({
      title: 'Radiance',
      description:
        'A rendering engine for the web written on TypeShade: a scene graph, a progressive path tracer on WebGPU, and the same kernel checked on the CPU.',
      logo: { src: './src/assets/mark.svg', alt: '' },
      favicon: '/favicon.svg',
      social: [{ icon: 'github', label: 'GitHub', href: repo }],
      editLink: { baseUrl: `${repo}/edit/main/site/` },
      customCss: ['./src/styles/custom.css'],
      components: {
        SiteTitle: './src/components/SiteTitle.astro',
        Footer: './src/components/Footer.astro',
        Hero: './src/components/Hero.astro',
      },
      sidebar: [
        { label: 'Guide', items: [{ autogenerate: { directory: 'guide' } }] },
        { label: 'Examples', link: '/examples/' },
        typeDocSidebarGroup,
      ],
      expressiveCode: {
        themes: ['github-light', 'github-dark'],
        styleOverrides: {
          borderRadius: '8px',
          codeFontSize: '0.8125rem',
          codeLineHeight: '1.6',
          codePaddingBlock: '0.75rem',
          codePaddingInline: '1rem',
          frames: { frameBoxShadowCssValue: 'none', shadowColor: 'transparent' },
        },
      },
      plugins: [
        // The API reference, one page per public export, from the two packages' JSDoc. Nothing
        // on those pages is written by hand: a wrong sentence is fixed in the source.
        starlightTypeDoc({
          entryPoints: ['../packages/radiance/src/index.ts', '../packages/addons/src/index.ts'],
          tsconfig: '../tsconfig.typedoc.json',
          output: 'api',
          sidebar: { label: 'API', collapsed: false },
          typeDoc: {
            name: 'Radiance',
            excludePrivate: true,
            excludeProtected: true,
            excludeInternal: true,
            readme: 'none',
            sort: ['kind', 'instance-first', 'alphabetical'],
            githubPages: false,
          },
        }),
        starlightLlmsTxt({ projectName: 'TypeShade Radiance' }),
      ],
    }),
    react(),
  ],
  vite: {
    // The engine's kernels are `*.shade.ts` modules; the compiler's plugin compiles them.
    plugins: [typeshade({ console: 'never' }), tailwindcss()],
    build: { chunkSizeWarningLimit: 2000 },
  },
});
