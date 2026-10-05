---
version: 1
slug: "site-src-components-pages-examplepage-astro"
primary_target: "site/src/pages/examples/[id].astro"
related_targets: ["site/src/pages/examples/index.astro","site/src/components/Stage.astro","site/src/islands/ExampleStage.tsx"]
---

# Examples (`/examples/`, `/examples/<id>/`)

Scope: the examples gallery and one example's page. Visitor mode: Experience on the page,
Read on the gallery. Audience: a developer who wants to see what the engine draws and how an
example is written. Proof: the example itself, running; its source; its still from the build.

## Direction contract

THESIS: An example page is the example. The stage takes the content column at 16:10, one
40px toolbar sits under it (a status tag, samples per pixel and frame time in Inter; pause,
reset the view, save a PNG, full screen), and the source follows in a code frame with a link
to the file on GitHub, the way three.js puts "view source" under a running example. The
gallery is tiles with build-time stills grouped by category, as three.js's examples index
is. It refuses the dashboard of settings cards and the camera cheat sheet.

OWN-WORLD: the front page's world: Vapor UI tokens, hairline cards, 8px radius, Ant Design
controls in the island, the stage on #000 inside the card with the still underneath.

STORY: a visitor picks a tile, the example starts on the stage, they drag it and watch it
sharpen, press full screen, then read the file that made it and open it on GitHub.

FIRST VIEWPORT (1440 x 900): the header; the docs-style title (heading1) and one sentence;
the stage card filling the 1320px shell's content column, toolbar under the stage inside
the card; the code frame begins below the fold. On a phone the stage is the viewport's width
at 4:3 and the toolbar wraps to two rows.

FORM: brief-pinned by the owner (three.js and pixi.js as the references). No roll was run.
Position 1 of 1.

Signature interaction: dragging the stage restarts the render at a coarse preview that
sharpens when the camera rests; full screen keeps the toolbar as an overlay.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
