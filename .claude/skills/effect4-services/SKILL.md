---
name: effect4-services
description: Effect 3 → 4 migration of services and layers — Context, Layer, ManagedRuntime, Runtime, FiberRef, Scope, Effect.Service and the provide* family. Use in migration phases that follow the services topic.
---

# effect4-services

Follows skill: effect4-services (with effect4-lookup for every symbol)

Resolve every symbol through `effect4-lookup`. Its rules (no compatibility module, no `any` or
silencing `as`, no invented API, no network, no delegated agent) bind here.

## May change

- The service and layer symbols listed below, wherever the codemod reports them: any file under
  `src/**`, `tests/**`, `scripts/**`, `site/**` and `packages/schemas/**`.
- Test layers and fakes under `tests/**`.

Never the corpus case files (`tests/effect4Corpus/cases/**`), the baseline files
(`tests/effect4Corpus/baseline/**`), the corpus tests or any path `phax.json` protects: they stay
byte-identical.

A file mixing areas is migrated by more than one phase; each phase changes only the symbols
listed below. When a leftover says it is blocked by another symbol, migrate the blocker, then
re-run `pnpm codemod:effect4` so the covered uses it held back are rewritten mechanically.

## v3 symbols

Modules: `Context`, `Layer`, `ManagedRuntime`, `Runtime`, `FiberRef`, `Scope`.

Symbols: `Effect.Service`, `Effect.Tag`, `Effect.provide*`.

Topic guides under `docs/vendor/effect-migration/effect@4.1.2/migration/`: `services.md`,
`runtime.md`, `fiberref.md`, `scope.md`, `layer-memoization.md`.

This list matches `scripts/effect4-codemod/owners.ts`, which routes the codemod's leftover
report to this skill.

## Behaviour guards

- Ports keep their names and shapes: no phase renames or reshapes a `src/ports/*` interface.
- The four-layer rule stays: no side effect leaves `src/infra/`.
- Layer memoization differs in v4; read `layer-memoization.md` before changing how a layer is
  shared.

## Done condition

- `pnpm codemod:effect4 --ratchet` passes.
- The phase's leftovers in `pnpm codemod:effect4 --check` are gone.
