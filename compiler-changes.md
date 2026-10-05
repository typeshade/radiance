# Compiler changes this repository has handled

A change to the compiler that changes what these packages or the docs describe is agreed first as
a proposal in the compiler's `changes/` directory (the compiler's `changes/README.md` explains
the process). Each proposal lists, under `downstream`, the work it will owe this repository.

When a pull request moves the compiler pin (`vendor/typeshade`) past a proposal that names
`radiance`, `scripts/downstream-impact.ts` fails the pull request until the proposal's work is
done on that branch and its id is recorded below. Record one list item per proposal: the id
first, then the pull request that did the work.

None yet: the pin is fd39ba3, and no proposal names this repository.
