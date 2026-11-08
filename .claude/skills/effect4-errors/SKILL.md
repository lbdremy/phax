---
name: effect4-errors
description: Effect 3 → 4 migration of error handling — Either/Result, Exit, Cause, Effect.either, catch*, orElse*, sandbox and Data.TaggedError. Use in migration phases that follow the errors topic.
---

# effect4-errors

Follows skill: effect4-errors (with effect4-lookup for every symbol)

Resolve every symbol through `effect4-lookup`. Its rules (no compatibility module, no `any` or
silencing `as`, no invented API, no network, no delegated agent) bind here.

## May change

- Error handling across `src/app/**`, `src/infra/**`, `src/domain/**` and `src/cli/**`
- The tests of those directories under `tests/**`

A file mixing areas is migrated by more than one phase; each phase changes only the symbols
listed below.

## v3 symbols

Modules: `Either`, `Exit`, `Cause`.

Symbols: `Effect.either`, `Effect.catch*` (`Effect.catchAll`, `Effect.catchTag`, …),
`Effect.orElse*`, `Effect.sandbox`, `Data.TaggedError`.

Topic guides under `docs/vendor/effect-migration/effect@4.1.2/migration/`: `error-handling.md`,
`cause.md`.

This list matches `scripts/effect4-codemod/owners.ts`, which routes the codemod's leftover
report to this skill.

## Behaviour guards

- Defect and interruption semantics do not change. Read lines 10003, 10057 and 10189 of
  `docs/vendor/effect-migration/effect@4.1.2/migration/v3-to-v4.md` before rewriting a handler:
  a handler that caught only failures must not start catching defects or interruption.
- Tagged error `_tag` values and the messages users see stay as they are.

## Done condition

- `pnpm codemod:effect4 --ratchet` passes.
- The phase's leftovers in `pnpm codemod:effect4 --check` are gone.
