---
name: effect4-schema
description: Effect 3 → 4 migration of schemas — Schema, ParseResult, JSONSchema, SchemaAST. Use in migration phases that follow the schema topic.
---

# effect4-schema

Follows skill: effect4-schema (with effect4-lookup for every symbol)

Resolve every symbol through `effect4-lookup`. Its rules (no compatibility module, no `any` or
silencing `as`, no invented API, no network, no delegated agent) bind here.

## May change

- The Schema symbols listed below, wherever the codemod reports them: any file under
  `src/**`, `tests/**`, `scripts/**`, `site/**` and `packages/schemas/**`, `src/cli/**` and
  `src/domain/**` included.
- `src/schemas/history/`, `src/schemas/refusal/adapter.ts` and `tests/effect4Corpus/subjects.ts`.
- Method calls on schema values the report does not list (`.annotations(` → `.annotate(`): they are
  this phase's work.

Never the corpus case files (`tests/effect4Corpus/cases/**`), the baseline files
(`tests/effect4Corpus/baseline/**`), the corpus tests or any path `phax.json` protects: they stay
byte-identical.

A file mixing areas is migrated by more than one phase; each phase changes only the symbols
listed below. When a leftover says it is blocked by another symbol, migrate the blocker, then
re-run `pnpm codemod:effect4` so the covered uses it held back are rewritten mechanically.

## v3 symbols

Modules: `Schema`, `ParseResult`, `JSONSchema`, `SchemaAST`.

Topic guide under `docs/vendor/effect-migration/effect@4.1.2/migration/`: `schema.md`.

This list matches `scripts/effect4-codemod/owners.ts`, which routes the codemod's leftover
report to this skill.

## Behaviour guards

- Refusal wording stays. Refusal words are built by `src/schemas/refusal/render.ts` from phax's
  refusal model; the corpus compares them with the frozen expectations. This phase ports only
  `src/schemas/refusal/adapter.ts`, from ParseResult issues to SchemaIssue, and changes no
  message. No formatter reads Effect's message text, and none may start to.
- Frozen decoders (`src/schemas/history/`) keep decoding what they decoded. A change to one comes
  with the `history.lock.json` refresh in the same commit, naming the Effect 4 migration.
- JSON Schema equivalence is held by the corpus, not by eye. Create no `next` snapshot.
- Never edit a corpus case or baseline file to turn a gate green.

## Done condition

- `pnpm codemod:effect4 --ratchet` passes.
- The phase's leftovers in `pnpm codemod:effect4 --check` are gone.
