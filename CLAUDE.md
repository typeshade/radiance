# Working in this repository with Claude Code

Read `README.md` for the layout and the checks, and `docs/plan.md` for the plan: the product, the
layers, the milestones and their acceptance criteria. This file adds the rules for a session.

## The language of the conversation

Answer the owner in Korean, every reply, from the first to the last of a session: a status
report, a question, a summary after a merge. What goes into the repository stays in English:
code, comments, commit messages, pull request titles and bodies, and every document in the tree.

## Every package is written on the public runtime alone

`vendor/typeshade` is the compiler, pinned as a git submodule. The compiler decided (#335) that
an engine lives in its own repository and is built only on the public program runtime, and this
repository is that engine:

- A package under `packages/` imports `typeshade/runtime`, a sibling package and its own files,
  and nothing else. It calls nothing on a WebGPU object: the runtime makes and records every
  buffer, texture, pipeline and bind group. `scripts/boundary.mjs` holds this before every commit
  and in CI.
- GPU code is TypeShade: `*.shade.ts` files, compiled by the compiler and run through the
  runtime. Write WGSL by hand only for what TypeShade cannot express yet, and then open an issue
  on typeshade/typeshade naming the gap.
- What the runtime cannot do yet becomes a proposal in the compiler's `changes/`, not a reach
  past the boundary. `docs/plan.md` ("What goes back to the compiler") lists the ones expected.

## The packages and the docs follow the pinned compiler

Moving the pin is a step with checks, not a memory:

- When a change moves the pin, run
  `bun vendor/typeshade/scripts/downstream-impact.ts --repo radiance --submodule vendor/typeshade`
  and fix every line it lists. It also lists every compiler change proposal the new pin
  implements that names this repository and that `compiler-changes.md` does not record yet: do
  the work the proposal lists, then add its id to that file.
- When you edit inside a `LINT.IfChange` block, edit its `LINT.ThenChange` targets in the same
  commit. `TYPESHADE_DOCS_ROOT=$PWD bun vendor/typeshade/scripts/ifchange.ts` checks this.
- `.claude/settings.json` runs both checks before every `git commit` and blocks the commit while
  one fails. A line of its own in the message, `NO_IFTTT=<reason>`, waives an unmet
  `LINT.ThenChange` and nothing else. Write it only after reading the target.
- Moving the pin is its own pull request, with `bun run check` and `bun run harness` green on
  the new pin.

## Report what using TypeShade is like

- `docs/typeshade-feedback.md` is the log of what working in TypeShade is like here: friction,
  surprises, diagnostics that did not help, gaps in the docs, things that were hard, and things
  that went well. Add an entry when it happens, not at the end of a session.
- A TypeShade bug, a missing feature or a confusing diagnostic becomes an issue on
  typeshade/typeshade, without asking first: search the open and closed issues, write it as the
  owner's issues are written (what happens, what was expected, the tests owed, the pinned
  commit), and link it from the log entry. Tell the owner what was filed.

## A milestone is done by its image and its number

`docs/plan.md` gives every milestone an acceptance criterion: a named demo and a CI gate, an
image held to a golden and a number recorded. A milestone whose criterion is not in CI is not
done. The gates follow the compiler's: `gate:render` (a pixel golden), `gate:differential` (the
GPU held to the CPU oracle), and "prove the instrument" (a gate shows it can fail before it is
trusted to pass).

## Before pushing

Run `bun run check` and `bun run harness`: together they are CI's jobs, so a push that passes
them locally passes there. `.claude/settings.json` runs the fast half (prettier, the prose check,
the boundary) before every `git commit` and blocks the commit while one fails.

## Merging

`main` is to be protected by a GitHub ruleset the owner sets, as the sibling repositories are: a
pull request, a Code Owner review and the required checks (the `name:` of each job in
`.github/workflows/ci.yml`). Until then the rule is the same by convention:

- Merge only when every check is green on the pull request's current head. A red check is fixed,
  never bypassed.
- Bypass only the review requirement, and only when the owner has said in the conversation to
  merge that pull request.
- Never push to `main` directly after the initial commit, and never force-push it.
- The ruleset, the secrets and every other repository setting are the owner's to change. When one
  must change, write the owner a script for the GitHub CLI (`gh auth login`, then `gh api`), in
  PowerShell, since the owner works on Windows. Never ask for a token in the conversation.
- Renaming or removing a CI job leaves every pull request waiting on a check that never reports,
  so the ruleset changes in the same step.

## Tracking requests

Keep a list of every distinct request the owner makes in a session. Before a batch of merges,
and whenever asked, report each one as done, in progress or not started. Merge and CI
housekeeping never takes the place of an unfinished request.
