# Working in this repository with Claude Code

Read `README.md` for the layout and the checks, and `docs/plan.md` for the plan: the product, the
layers, the milestones and their acceptance criteria. This file adds the rules for a session.

## The language of the conversation

Answer the owner in Korean, every reply, from the first to the last of a session: a status
report, a question, a summary after a merge. What goes into the repository stays in English:
code, comments, commit messages, pull request titles and bodies, and every document in the tree.

## Writing and configuration management

Every reply to the owner and every task follows two disciplines from aircraft maintenance
practice. The writing follows ASD-STE100, Simplified Technical English. The work follows the
configuration management functions of SAE EIA-649 and ISO 10007. Both are local conventions, and
they claim no compliance or certification.

**Writing.** The `asd-ste100` skill (`.agents/skills/asd-ste100/SKILL.md`, pinned by
`skills-lock.json`) is the rule book. Read it before you write a document, and apply it in two
modes:

- Strict mode for `CLAUDE.md`, a procedure, a numbered step, a check's message and the rules of a
  design record. A wrong reading there has a cost.
- STE-flavored mode for `README.md`, `docs/plan.md`, `docs/typeshade-feedback.md`, the site's
  guide pages and the descriptive text of a design record. The structural rules apply in full.
  The lexical rules are a direction.

The structural rules, in short:

- Keep descriptive text and procedures apart. Write a procedure as numbered steps in the
  imperative, with one action in each step.
- Give each sentence one topic. Keep a step to 20 words and a descriptive sentence to 25. Give
  each paragraph one topic and at most six sentences.
- Use one term for one thing. Use the exact identifier of each file, symbol, check and command.
- Use the active voice when the actor is known. Do not invent an actor.
- Do not write a semicolon. Split the sentence instead.
- Keep each hedge as written. "May fail" does not become "fails".
- Put a warning before the step it applies to. Name an action that cannot be undone (a merge, a
  force push, a deletion) before it is done.
- Keep facts, inferences, proposals, decisions and observed results apart. Label each one when
  the difference matters.

`bun run check:ste` (`scripts/check-ste.mjs`) runs the skill's linter over every document and
fails on a hard violation. It runs before every `git commit` and in CI. A reply in Korean applies
the same principles in Korean. ASD-STE100's dictionary is English and governs only English text.

**Configuration management.**

- Identification. Name each configuration item by its identifier: a repository, a branch, a
  commit, a pull request, a design record, a decision (`Design 0001.3`), the submodule pin or a
  required check. "The latest" is no identifier. A commit hash is one.
- Baselines. `main` at a commit is this repository's baseline. The pin `vendor/typeshade` is its
  baseline of the compiler. An accepted design record is the approved design of its part.
- Change control. Change a baseline only through a pull request. A change to a contract needs an
  accepted design record first (below). The approval is a review or the owner's go-ahead in the
  conversation (Merging). A pull request does only what its description says. One pull request
  carries one change, so two unrelated changes are two pull requests.
- Status accounting. Record the status of each request and each change: not started, in progress
  or done, and for a record its lifecycle state. A status report names each one with its
  identifiers. List each open item with its reason and its next action.
- Verification and audit. Support a claim of completion with the checks that actually ran: the
  command or check, the date, the configuration (commit, pin, tool versions) and the result.
  Functional verification (`bun run check`, `bun run harness`) and the document audit (the
  documents and `reqs/` match the delivered configuration) are separate. One does not replace
  the other. Report a check that did not run as not run.
- Traceability. `reqs/` is the Doorstop tree of the design records and their decisions
  (`reqs/README.md`). `bun run reqs:sync` derives it. A record changed without a review of its
  decisions fails CI's `traceability (Doorstop)` job.
- Deviations. Record each difference between the record and the delivered work on the pull
  request and in the record's "Record" section, with its disposition: closed, made part of the
  record by an amendment, or open.
- Decisions by default. Decide a trivial open item by default. Record the decision on the pull
  request. Ask the owner only when the scope, the cost, the order or a contract changes, or when
  two readings lead to different work and no record decides.

Each task runs in the order of a maintenance task card:

1. Identify the request, the configuration items it touches and their baselines.
2. Find the design record that authorizes the change, or open one.
3. Make the change inside what that record declares.
4. Run the functional checks and the document audit on the change.
5. Record what was done, on which configuration, what was verified and what remains open.
6. Report the status of every request to the owner.

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

## A contract changes in a design record first

`docs/design/` holds the agreed shape of each part the engine is built on: the kernel's buffers
and their layouts (0001), the gates (0002), the public API (0003), the material record and the
shading contract (0004), the determinism rules (0005) and the proposals the engine owes the
compiler (0006). `docs/design/README.md` says which changes need a record and the lifecycle.

- Before implementing a change to one of those, find its accepted record. If there is none, or
  the change reaches past what the record declares, write or amend the record first, as its own
  pull request, and do not implement until it is merged as accepted.
- Each implementing commit names its record on a line of its own: `Design: 0001`. A test that
  verifies a decision carries `Verifies: Design 0001.3` in a comment.
- A record is written for an agent that has not read the conversation: files, names, layouts in
  bytes, tests and the numbers that prove each step.
- After you edit a record, run `bun run reqs:sync`, then `doorstop -e -F`, and work through what
  it flags as `reqs/README.md` says. Install Doorstop once with `pip install doorstop==3.2`.

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

Run `bun run check` and `bun run harness`, then `doorstop -e -F`: together they are CI's jobs, so
a push that passes them locally passes there. `.claude/settings.json` runs the fast half
(prettier, the prose check, the STE check, the boundary and `reqs:check`) before every
`git commit` and blocks the commit while one fails.

## Merging

`main` is to be protected by a GitHub ruleset the owner sets, as the sibling repositories are: a
pull request, a Code Owner review and the required checks (the `name:` of each job in
`.github/workflows/ci.yml`). Until then the rule is the same by convention:

- Merge only when every check is green on the pull request's current head. A red check is fixed,
  never bypassed.
- Bypass only the review requirement. Bypass it only when the owner has said in the conversation
  to merge that pull request, or when the pull request is of a kind the owner approved in advance
  (below).
- Approved in advance. Merge a pull request of these two kinds as soon as an independent agent
  review approves it. Every check must be green on its current head, with no conflict and no
  review thread open:
  - a pull request that implements an accepted design record, within what the record declares
    (its commits carry the record's `Design` line)
  - a bug fix that needs no design record
- Everything else waits for the owner to say "merge" in the conversation:
  - a new or amended design record
  - a change to the plan (`docs/plan.md`)
  - a change to a public export
  - a layout or a contract that no accepted design record covers
  - a move of the pin `vendor/typeshade`
  - a change to `CLAUDE.md` itself
- After a merge, report it to the owner.
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
