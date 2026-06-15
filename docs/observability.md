# phax Observability

> OpenTelemetry transports and correlates. The system produces the meaning. Snapshots capture the meaning, not the transport.

## Architecture

The observability stack is split into three layers so the semantic record is independent of the transport envelope:

```
src/domain/telemetry/         ← pure semantic types (NO Effect, NO OTel, NO IO)
        │
src/ports/systemTelemetry.ts  ← SystemTelemetry Effect service (the app calls this)
        │
src/infra/telemetry/          ← implementations: in-memory, JSON file, OTel, composite
```

Application code only calls `SystemTelemetry`. The OTel envelope is wired at the composition root (`src/cli/`) and is invisible to the domain and application layers.

## Port surface (`src/ports/systemTelemetry.ts`)

| Method                             | When to call                                                         |
| ---------------------------------- | -------------------------------------------------------------------- |
| `withOperation(name, attrs, eff)`  | Wrap any named unit of work — becomes a span in OTel                 |
| `recordEvent(event)`               | Emit a `SemanticTelemetryEvent` (adapter call, step, gate, artifact) |
| `recordTransition(transition)`     | Shortcut for `state.transition` events from the dispatcher           |
| `recordError(report)`              | Emit a `SystemErrorReport` when an adapter boundary fails            |
| `incrementCounter(name, attrs?)`   | Increment a named metric counter                                     |
| `recordDuration(name, ms, attrs?)` | Record a duration sample                                             |

The error channel of every method is `never` — telemetry must never fail a run.

## Implementations (`src/infra/telemetry/`)

| File               | Purpose                                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------------------- |
| `inMemory.ts`      | Collects events in-process; used in tests via `getSemanticTraceSnapshot()`                                      |
| `jsonFile.ts`      | Appends one JSON line per event to a configurable path; IO errors swallowed                                     |
| `openTelemetry.ts` | Maps semantic events onto OTel spans / events / metrics; the **only** file allowed to import `@opentelemetry/*` |
| `composite.ts`     | Fans out one logical call to multiple implementations; inner failures are swallowed                             |
| `layer.ts`         | Factory (`makeSystemTelemetryLayer`) — called by the CLI to compose the live layer from runtime flags           |

Fake for tests: `src/infra/fakes/systemTelemetry.ts` → `makeFakeSystemTelemetry()`.

## CLI flags and env vars

| Flag / Variable  | Default | Effect                                                               |
| ---------------- | ------- | -------------------------------------------------------------------- |
| `--verbose`      | off     | Prints each semantic event to the terminal as it occurs              |
| `--trace <path>` | off     | Writes one JSON line per semantic event to `<path>` (JSONL format)   |
| `PHAX_OTEL=1`    | off     | Enables the OpenTelemetry adapter; requires a running OTLP collector |

Recommended on-disk trace path: `~/.phax/runs/<short-name>/semantic.jsonl`.

All three can be combined. With no flags set the behaviour is identical to `NoopSystemTelemetryLayer` except for the always-on in-memory side channel used by diagnostic tooling.

## Snapshot rule

Tests assert against the output of `InMemoryTelemetry.getSemanticTraceSnapshot()`, which projects every event through `projectEvent` from `src/domain/telemetry/snapshot.ts`.

**Snapshots must never contain**: `traceId`, `spanId`, `durationMs`, or any 13+ digit Unix timestamp. Only semantic fields survive projection: `type`, `event`, `stateBefore`, `stateAfter`, `dispatcher`, `operationId`, `adapter`, `operation`, `result`, `step`, `gate`, `artifact`, `path`.

The baseline E2E snapshot is at `tests/e2e/__snapshots__/semanticTrace.test.ts.snap`. Future refactors must replay it identically or explicitly promote a new baseline with `pnpm test:e2e:real -- --update`.

Helper for E2E tests: import `withTelemetryCapture` from `tests/e2e/helpers/telemetry.ts`.

## Adapter boundary failures — `SystemErrorReport`

When a Shell, Git, or Claude CLI adapter call fails, the application layer builds a `SystemErrorReport` (not the adapter itself) and calls `telemetry.recordError(report)` before re-throwing. This keeps adapter modules decoupled from telemetry.

Report builders live in `src/app/telemetry/reportBuilders.ts`:

- `reportShellFailure(e, ctx)` — for `ShellError`
- `reportGitFailure(e, ctx)` — for `GitError`
- `reportAgentFailure(e, ctx)` — for `AgentInvocationError`

All builders call `makeSystemErrorReport` from `src/domain/telemetry/errors.ts`, which truncates `stderrExcerpt` to ≤ 4 KB and appends `…<truncated>` so snapshots remain deterministic.

**Example** — a failing gate command produces a report shaped like:

```json
{
  "type": "adapter.command_failed",
  "adapter": "shell",
  "operation": "gate.pnpm-test",
  "runId": "observability-42",
  "exitCode": 1,
  "stderrExcerpt": "Error: 3 tests failed\n…<truncated>"
}
```

## Architectural guards

Four `PHAX_TELEMETRY_*` rules in `tests/unit/architecturalGuards.telemetry.test.ts` enforce the layer split at test time:

| Rule                 | What it checks                                                                           |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `PHAX_TELEMETRY_001` | `src/domain/` has no forbidden imports (port, infra/telemetry, OTel)                     |
| `PHAX_TELEMETRY_002` | Only `src/infra/telemetry/openTelemetry.ts` and its test import `@opentelemetry/*`       |
| `PHAX_TELEMETRY_003` | `src/app/` has no infra/telemetry imports; `src/cli/` has no direct OTel adapter imports |
| `PHAX_TELEMETRY_004` | Snapshot files contain no transport fields or raw Unix timestamps                        |

Each guard failure message includes the rule id and a pointer to `.claude/skills/observability/SKILL.md` for remediation steps.

## Further reading

- Correction guide for agents and reviewers: [`.claude/skills/observability/SKILL.md`](../.claude/skills/observability/SKILL.md)
- Doctrine source: `.context/attachments/rK8ZI3/pasted_text_2026-05-25_14-05-46.txt`
- E2E snapshot baseline: `tests/e2e/__snapshots__/semanticTrace.test.ts.snap`
