# Working in this repository with Claude Code

Read `README.md` for the layout and the checks. Read `docs/vision.md` for the design: the claim,
the owner's decisions, the scene model, the tick and what is not promised. This file adds the
rules for a session.

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
- STE-flavored mode for `README.md`, `docs/vision.md` and the descriptive text of a design
  record. The structural rules apply in full. The lexical rules are a direction.

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
  commit, a pull request, a design record, a decision (`D3`, `U1`, `Design 0100.3`), the compiler
  pin or a required check. "The latest" is no identifier. A commit hash is one.
- Baselines. `main` at a commit is this repository's baseline. `docs/vision.md` at a commit is
  the design baseline. An accepted design record is the approved design of its part. The
  compiler pin, when the first code sets one, is this repository's baseline of the compiler.
- Change control. Change a baseline only through a pull request. A change to a contract needs an
  accepted design record first (below). The approval is a review or the owner's go-ahead in the
  conversation (Merging). A pull request does only what its description says. One pull request
  carries one change, so two unrelated changes are two pull requests.
- Status accounting. Record the status of each request and each change: not started, in progress
  or done, and for a record its lifecycle state. A status report names each one with its
  identifiers. List each open item with its reason and its next action.
- Verification and audit. Support a claim of completion with the checks that actually ran: the
  command or check, the date, the configuration (commit, pin, tool versions, device) and the
  result. Functional verification and the document audit are separate. One does not replace the
  other. Report a check that did not run as not run.
- Deviations. Record each difference between the record and the delivered work on the pull
  request and in the record's "Record" section, with its disposition: closed, made part of the
  record by an amendment, or open.
- Decisions by default. Decide a trivial open item by default. Record the decision on the pull
  request. Ask the owner only in these two cases:
  - The scope, the cost, the order or a contract changes.
  - Two readings lead to different work, and no record decides.

Each task runs in the order of a maintenance task card:

1. Identify the request, the configuration items it touches and their baselines.
2. Find the design record that authorizes the change, or open one.
3. Make the change inside what that record declares.
4. Run the functional checks and the document audit on the change.
5. Record what was done, on which configuration, what was verified and what remains open.
6. Report the status of every request to the owner.

## Delegating to a sub-agent

The owner's rule, given on 2026-10-06: call a sub-agent with the model `opus` or `sonnet` only.
Never let a sub-agent inherit the session's own model. The session's model is too costly for
delegated work. Opus reviews. Sonnet implements and researches. This applies to the Agent tool
and to each `agent()` call of a workflow.

The owner's rules, given on 2026-10-13, for every session:

- Run at most three sub-agents at the same time. Start the next one only when one has finished.
- Stop a sub-agent as soon as its report is in. A sub-agent stops every server and background
  process that it started before it reports.
- Give every task its pull request first. Push the first commit early and open a draft pull
  request at once. Push each later commit to the same branch, so that no work stays only in the
  container.

## The design is `docs/vision.md`

`docs/vision.md` holds the owner's decisions (D1 to D8) and the items the owner accepted (U1 to
U9). Each is a constraint, not one option among others.

- Never propose a design that reverses a decision, unless the owner asks for that in the
  conversation.
- Before you recommend anything, check it against the decisions, and cite the ones it rests on.
- A measurement or a review finding that a decision makes costly is a cost of the decision. Show
  the cost to the owner. Only the owner changes a decision.
- When the owner states a new decision about the engine, record it in `docs/vision.md`, in the
  owner's words with the date, in a pull request of its own.
- Before the owner decides on a design or a merge, show what changes: one example before and
  after, and the options with their costs.

## The engine is written on the compiler's public runtime

The compiler decided (`typeshade/typeshade` issue #335) that an engine lives in its own
repository and is built only on the public program runtime. This repository is that engine.

- GPU code is TypeShade: `*.shade.ts` files, compiled by the compiler and run through
  `typeshade/runtime`. Engine code calls nothing on a WebGPU or WebGL object.
- A need this engine has of the compiler is an issue on `typeshade/typeshade` that asks for
  compiler work. Write the workaround here first, and measure it on devices. The compiler side
  decides how to meet the need. A language change is the last resort.
- Nothing engine-shaped is asked of the language. A scene, a node, a tick and a body are library
  names (compiler `docs/dx.md`, principle 7).
- A TypeShade bug, a missing feature or a confusing diagnostic becomes an issue on
  `typeshade/typeshade`, without asking first. Search the open and closed issues first. Tell the
  owner what was filed.

The engine has no compiler pin yet. The first design record decides how the engine pins the
compiler, and this file then gains the procedure to move the pin.

## A contract changes in a design record first

`docs/design/README.md` says which changes need a record, the lifecycle and the shape of a
record.

- Before implementing a change to a contract, find its accepted record. If there is none, or the
  change reaches past what the record declares, write or amend the record first, as its own pull
  request. Do not implement until it is merged as accepted.
- Each implementing commit names its record on a line of its own: `Design: 0100`. A test that
  verifies a decision carries `Verifies: Design 0100.3` in a comment.
- A record is written for an agent that did not read the conversation: files, names, layouts,
  tests and the numbers that prove each step.

## A claim about a device is a measurement

`docs/vision.md` (section 12) lists what must be measured before it is promised. A statement
about a phone, a WebView or a store is a fact only with a record: the device, the system
version, the commit, the date and the number. Without a record, label it an inference.

## Before pushing

Run `bun run check`. It is CI's working job: the format check and the two prose checks.
`.claude/settings.json` runs the same checks before every `git commit` and blocks the commit
while one fails. The first code adds its type check and its tests to `bun run check`.

## Merging

`main` is to be protected by a GitHub ruleset the owner sets, as the sibling repositories are: a
pull request, a Code Owner review and the required checks (the `name:` of each job in
`.github/workflows/ci.yml`). Until then the rule is the same by convention:

- Merge only when every check is green on the pull request's current head. A red check is fixed,
  never bypassed.
- Approved in advance. The owner's rule, given on 2026-11-11: "초록이면 병합해도 됩니다". Merge a
  pull request of this repository when every check is green on its current head, with no conflict
  and no review thread open. Do not wait for the owner's review.
- A merged design record is accepted. Set its `status` to `accepted` before the merge.
- These three kinds still wait for the owner to say "merge" in the conversation:
  - a change to `CLAUDE.md` itself
  - a change to a decision D1 to D9 of `docs/vision.md`
  - a pull request that deletes work that a revert does not restore
- After a merge, report it to the owner: the pull request, the commit, what changed and what was
  verified.
- Never push to `main` directly, and never force-push it.
- The ruleset, the secrets and every other repository setting are the owner's to change. When one
  must change, write the owner a script for the GitHub CLI (`gh auth login`, then `gh api`), in
  PowerShell, since the owner works on Windows. Never ask for a token in the conversation.
- Renaming or removing a CI job leaves every pull request waiting on a check that never reports,
  so the ruleset changes in the same step. Three jobs of `ci.yml` keep the first model's names
  for this reason, and they run nothing yet.

## Waiting on a pull request

- Mark a draft pull request ready for review as soon as its checks are green, not at merge time.
- Waiting on a check is not work. End the turn, and let the pull request's events wake the
  session.
- A pull request that is green and waits only on the owner needs no check-in.

## Tracking requests

Keep a list of every distinct request the owner makes in a session. Before a batch of merges,
and whenever asked, report each one as done, in progress or not started. Merge and CI
housekeeping never takes the place of an unfinished request.
