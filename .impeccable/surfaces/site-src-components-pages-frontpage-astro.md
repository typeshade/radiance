---
version: 1
slug: "site-src-components-pages-frontpage-astro"
primary_target: "site/src/pages/index.astro"
related_targets: ["site/src/styles/custom.css","site/src/components/SiteTitle.astro","site/src/components/Footer.astro","site/src/components/Stage.astro","site/src/islands/ExampleStage.tsx"]
---

# Front page (`/`)

Scope: the front page, and the shell it sets for every other page (header, footer, tokens,
code frames, the docs grid, the example stage). Visitor mode: Persuade. Audience: a
TypeScript developer who renders in the browser or wants to; job: see a rendered image
beside the scene file that drew it, move the camera, install the package. Proof on hand: the
engine's own examples running live, the engine's source, the CI gates (the oracle bound read
from `scripts/gates.mjs`), the pinned compiler commit. Constraints: every string in the
dictionary (`site/src/i18n/en.ts`), every number from `site/src/lib/facts.ts`, no pictures
except renders, pre-release (the npm package is assumed and marked).

## Direction contract

THESIS: A library front page in Vapor UI's language whose showcase is a scene file beside
the image it renders, live: the file on the left and the path tracer drawing on the right
inside one hairline card, the way a reader opens the first example of three.js. It refuses
the demo-app arrangement the first site had (one canvas with settings panels and a camera
cheat sheet) and the category default (a centred name over a row of feature cards).

OWN-WORLD: Vapor UI as DESIGN.md records it: the page on canvas-200 (#f7f7f7), cards on
overlay white with a 1px gray-100 hairline, an 8px radius everywhere, no shadow at rest;
blue-500 (#2a72e5) fills the one primary button and nothing else is blue except links and
the active item; text gray-900 at 14/22 for the interface, 16/24 for prose, the headline at
48/62 weight 800 with -0.4px tracking; Pretendard for text, Inter for numbers, Fira Code for
code; 32px controls with 12px side padding; hover is a gray-900 overlay at 8%, press 16%,
150ms ease; focus is a 2px outline offset 2px. Dark is Vapor's dark ramp (#232323 canvas,
#282828 page, #363636 overlay, #606060 hairline, #fafafa text, #368aed primary). Ant Design
components, themed to those tokens, carry every control inside the React islands.

STORY: A visitor reads one headline and one sentence, sees the scene file beside the picture
it makes, watches the picture sharpen as samples add up and drags it to restart, reads how a
scene is written (the three.js-shaped graph), sees the one claim only this engine makes (the
same kernel on the GPU and the CPU oracle, held in CI), browses four example tiles, and
copies the install command. Primary action: Get started, top and end; Examples beside it.

FIRST VIEWPORT (1440 x 900): the 56px white header with a hairline under it: the mark and
Radiance on the left; Docs, Examples, API; search, a theme switch and GitHub on the right. A
two-column hero in the 1320px shell, 48px apart: left 5/12, the headline at 48/62/800, the
lede at 16/24 in gray-700 capped at 52ch, a primary button (Get started) beside an outline
button (Examples); right 7/12, the showcase card: a 48px head bar with the file name as an
active tab and a status tag, a body split into the code pane (Fira Code 12/18, the real file)
and the canvas (4:3) with the samples count in the corner, a 12px hint caption at the foot.
Under 64rem the columns stack, the card's panes stack, canvas first.

FORM: brief-pinned by the owner (a library site as pixi.js and three.js have one; Vapor UI as
the visual world, provided as DESIGN.md on 2026-10-05). No roll was run: a user-pinned
direction beats the roll. Position 1 of 1.

Signature interaction: dragging the showcase render restarts the accumulation at a coarse
preview and sharpens as soon as the pointer rests, while the samples counter climbs again.
Motion grammar: 150ms ease on hover and press, nothing else moves but the renders.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- The mark: none exists; the header carries a plain tile until the owner picks one.
- Korean: a second dictionary and `/ko/` routes in a later pull request (owner, 2026-10-05).
