# Observability doctrine

> Core principle: OpenTelemetry transports and correlates. The system produces the meaning. Snapshots capture the meaning, not the transport.

## Three-layer split

```
src/domain/telemetry/   ← pure semantic types, NO Effect, NO OTel, NO IO
src/ports/systemTelemetry.ts  ← Effect service (Context.Tag) — the app talks here
src/infra/telemetry/    ← implementations (OTel, file, in-memory, composite)
```

| Layer              | Rule                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `domain/`          | May not import SystemTelemetry port, infra/telemetry, or @opentelemetry/\*                                               |
| `app/`             | Calls SystemTelemetry only; must not import infra/telemetry/_ or @opentelemetry/_                                        |
| `cli/`             | May use the factory (`layer.ts`) at the composition root; must not import the OTel adapter or @opentelemetry/\* directly |
| `infra/telemetry/` | Only module that may import @opentelemetry/\*                                                                            |

## SystemTelemetry port (`src/ports/systemTelemetry.ts`)

| Method                             | When to call                                                         |
| ---------------------------------- | -------------------------------------------------------------------- |
| `withOperation(name, attrs, eff)`  | Wrap any named unit of work — becomes a span in OTel                 |
| `recordEvent(event)`               | Emit a `SemanticTelemetryEvent` (adapter call, step, gate, artifact) |
| `recordTransition(transition)`     | Shortcut for `state.transition` events from the dispatcher           |
| `recordError(report)`              | Emit a `SystemErrorReport` when an adapter boundary fails            |
| `incrementCounter(name, attrs?)`   | Increment a named metric counter                                     |
| `recordDuration(name, ms, attrs?)` | Record a duration sample                                             |

Never call `@opentelemetry/*` APIs from `src/app/` or `src/cli/`.

## Implementations (`src/infra/telemetry/`)

| File               | Purpose                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| `inMemory.ts`      | Collects events in-process; used in tests via `getSemanticTraceSnapshot()`                         |
| `jsonFile.ts`      | Appends one JSON line per event to a configurable path; IO errors swallowed                        |
| `openTelemetry.ts` | Maps semantic events onto OTel spans/events/metrics; **only** file that imports `@opentelemetry/*` |
| `composite.ts`     | Fans out one logical call to multiple implementations; inner failures swallowed                    |
| `layer.ts`         | Factory (`makeSystemTelemetryLayer`) — called by `src/cli/` to build the live layer                |

Fake for tests: `src/infra/fakes/systemTelemetry.ts` → `makeFakeSystemTelemetry()`.

## Snapshot rule

Tests assert against `InMemoryTelemetry.getSemanticTraceSnapshot()`, which projects events through `projectEvent` from `src/domain/telemetry/snapshot.ts`.

**Snapshots must never contain**: `traceId`, `spanId`, `durationMs`, or any 13+ digit Unix timestamp. Only semantic fields survive projection: `type`, `event`, `stateBefore`, `stateAfter`, `dispatcher`, `operationId`, `adapter`, `operation`, `result`, `step`, `gate`, `artifact`, `path`.

E2E helper: import `withTelemetryCapture` from `tests/e2e/helpers/telemetry.ts`.

## SystemErrorReport contract

Built at the application layer (not inside infra adapters) using `makeSystemErrorReport` from `src/domain/telemetry/errors.ts`. Report builders live in `src/app/telemetry/reportBuilders.ts`:

- `reportShellFailure(e, ctx)` — Shell adapter failures
- `reportGitFailure(e, ctx)` — Git adapter failures
- `reportClaudeFailure(e, ctx)` — Claude CLI adapter failures

`stderrExcerpt` is always truncated to ≤ 4 KB by `makeSystemErrorReport`.

## Architectural guards (`tests/unit/architecturalGuards.telemetry.test.ts`)

| Rule                 | What it checks                                                                           |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `PHAX_TELEMETRY_001` | `src/domain/` has no forbidden imports (port, infra, OTel)                               |
| `PHAX_TELEMETRY_002` | Only `src/infra/telemetry/openTelemetry.ts` and its unit test import `@opentelemetry/*`  |
| `PHAX_TELEMETRY_003` | `src/app/` has no infra/telemetry imports; `src/cli/` has no direct OTel adapter imports |
| `PHAX_TELEMETRY_004` | Snapshot files contain no transport fields or raw Unix timestamps                        |

## How to fix a violation

**PHAX_TELEMETRY_001**: The domain file is importing a port or adapter. Move the type it needs into `src/domain/telemetry/` or pass it as a plain value parameter.

**PHAX_TELEMETRY_002**: An unexpected file imports OTel. Route telemetry through `SystemTelemetry` port instead. If this is a new OTel adapter, it belongs in `src/infra/telemetry/` and must be added to the guard allowlist.

**PHAX_TELEMETRY_003**: An app file is importing a concrete adapter. Use the `SystemTelemetry` port via Effect DI. A CLI file importing the OTel adapter directly must go through `makeSystemTelemetryLayer` instead.

**PHAX_TELEMETRY_004**: A snapshot was captured before `getSemanticTraceSnapshot()` was applied, or a new unstable field leaked into the projection. Always snapshot the projection output, never the raw event or OTel span.

## Further reading

- Doctrine source: `.context/attachments/rK8ZI3/pasted_text_2026-05-25_14-05-46.txt`
- Architecture docs: `docs/observability.md` (added in phase-12)
- Snapshot baseline: `tests/e2e/__snapshots__/semanticTrace.test.ts.snap`
