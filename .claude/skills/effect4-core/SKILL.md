---
name: effect4-core
description: Effect 3 → 4 migration of every v3 symbol that no other effect4 topic skill owns. Use in migration phases that follow the core topic.
---

# effect4-core

Follows skill: effect4-core (with effect4-lookup for every symbol)

Resolve every symbol through `effect4-lookup`. Its rules (no compatibility module, no `any` or
silencing `as`, no invented API, no network, no delegated agent) bind here.

## May change

- Any file in `src/**`, `tests/**` or `scripts/**` whose remaining v3 symbols are not owned by
  `effect4-services`, `effect4-errors` or `effect4-schema`.
- Never the corpus case files, the baseline files or the codemod's ratchet and counts.

A file mixing areas is migrated by more than one phase; each phase changes only the symbols
listed below.

## v3 symbols

Every module and symbol that `scripts/effect4-codemod/owners.ts` does not route elsewhere: the
rest of `Effect` (all but the symbols owned by services and errors), `Option`, `Data`, `Stream`,
`Fiber`, `Duration`, the platform modules and the like.

Topic guides under `docs/vendor/effect-migration/effect@4.1.2/migration/`: `generators.md`,
`forking.md`, `yieldable.md`, `equality.md`, `fiber-keep-alive.md`.

## Behaviour guards

- What users see (output, exit codes, files written) stays as it is.
- A symbol that belongs to another topic is left for that topic's phase.

## Done condition

- `pnpm codemod:effect4 --ratchet` passes.
- The phase's leftovers in `pnpm codemod:effect4 --check` are gone.
