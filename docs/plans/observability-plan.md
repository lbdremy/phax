# Implementation plan — PHAX observability & telemetry doctrine

> Source doctrine: `.context/attachments/rK8ZI3/pasted_text_2026-05-25_14-05-46.txt`
> ("Observability and Telemetry Doctrine" for STEME systems).
> Deliverable location: `docs/plans/observability-plan.md`.
> Format: matches the phax-planning skill so `phax extract-plan` can consume
> this file and produce a `phax-plan.json`. Each phase carries an HTML anchor
> (`{#phase-NN-...}`) for the `planMarkdownAnchor` field.

---

## Context

PHAX already emits structured trace events through a `Tracer` port
(`src/ports/tracer.ts`) with three implementations
(`NoopTracerLayer`, `makeVerboseTracerLayer`, `makeTraceTracerLayer`) and a
fake under `src/infra/fakes/tracer.ts`. Six call sites in `src/app/` push
events into it (`dispatcher`, `effectRunner`, `executePlan`, `fixLoop`,
`extractPlan`, plus adapters via `eventAdapter`). The current event model is
a single flat union (`TraceEventName`) shaped for CLI output, not for
proof-preserving semantic snapshots.

The doctrine asks for a different separation of concerns:

```txt
1. Semantic system trace      → what the system understands about itself.
2. OpenTelemetry envelope     → how telemetry is correlated, transported, exported.
3. Snapshot projection        → the stable subset used in tests.
```

The work is split into **12 sequential phases**. The first six build the new
`SystemTelemetry` port and all four implementations alongside the existing
`Tracer` so nothing breaks. Phases 07–09 migrate every caller, retire the
legacy `Tracer`, and reroute the CLI flags through the new factory. Phases
10–12 add an end-to-end semantic snapshot test, architectural guards that
freeze the doctrine in code, and the user-facing documentation.

Default execution model is **claude-sonnet-4-6**. **claude-opus-4-7** is
reserved for the OpenTelemetry adapter phase (phase-05), where mapping
semantic events onto OTel spans / events / logs / metrics benefits from
deeper reasoning. Effort is calibrated to surface area, not difficulty.

## Architecture target

```txt
src/domain/telemetry/         ← semantic event types, error report, snapshot
                                 projection. NO Effect, NO OTel, NO IO.

src/ports/systemTelemetry.ts  ← SystemTelemetry Context.Tag (Effect service).

src/infra/telemetry/
  inMemory.ts                 ← InMemoryTelemetry (tests + snapshots).
  jsonFile.ts                 ← JsonFileTelemetry (local debugging).
  openTelemetry.ts            ← OpenTelemetrySystemTelemetry (production envelope).
  composite.ts                ← CompositeTelemetry (fan-out).
  layer.ts                    ← Factory + CLI flag wiring.

src/infra/fakes/systemTelemetry.ts  ← thin fake re-exporting InMemoryTelemetry
                                       for tests, mirroring the FakeTracer pattern.
```

## Cross-phase invariants (apply to every phase)

- **Domain stays pure**: nothing under `src/domain/` may import the
  `SystemTelemetry` port, any OTel package, or any infra/telemetry module.
- **Application talks semantics**: code under `src/app/` only calls
  `SystemTelemetry`. It must not import `@opentelemetry/*` directly and,
  after phase-09, must not import `Tracer` either.
- **Infrastructure owns the envelope**: only modules under
  `src/infra/telemetry/` may import `@opentelemetry/*`.
- **Telemetry must never fail a run**: every implementation swallows its own
  IO/exporter errors (the `Tracer.event` `never` error channel rule carries
  over to `SystemTelemetry.recordEvent` / `recordTransition` /
  `recordError`).
- **Snapshots project semantics, never transport**: tests assert against the
  output of `InMemoryTelemetry.getSemanticTraceSnapshot()`. They never read
  `traceId`, `spanId`, `timestamp`, `durationMs`, or any other OTel field.
- **Run id is the correlation anchor**: every semantic event carries
  `runId` (and `operationId` when applicable); the OTel adapter uses it to
  pick / start the trace.
- **Atomic writes** still apply to JsonFileTelemetry output files.
- **No new `any`** in `domain/` or `app/`. New external boundaries (OTel
  exporter config, env vars) decoded through Effect Schema where applicable.
- After phase-09 every commit must still pass `pnpm typecheck`, `pnpm lint`,
  `pnpm format:check`, `pnpm knip`, `pnpm test`, and `pnpm build`.

---

## Model & effort summary

| #   | Phase                                                          | Model               | Effort |
| --- | -------------------------------------------------------------- | ------------------- | ------ |
| 01  | Semantic telemetry domain types                                | claude-sonnet-4-6   | low    |
| 02  | `SystemTelemetry` application port                             | claude-sonnet-4-6   | low    |
| 03  | `InMemoryTelemetry` adapter + snapshot projection              | claude-sonnet-4-6   | medium |
| 04  | `JsonFileTelemetry` adapter                                    | claude-sonnet-4-6   | low    |
| 05  | `OpenTelemetrySystemTelemetry` adapter                         | **claude-opus-4-7** | high   |
| 06  | `CompositeTelemetry` + layer factory + CLI flag wiring         | claude-sonnet-4-6   | medium |
| 07  | Migrate application orchestration to `SystemTelemetry`         | claude-sonnet-4-6   | medium |
| 08  | Structured `SystemErrorReport` at adapter boundaries           | claude-sonnet-4-6   | medium |
| 09  | Remove legacy `Tracer` port and migrate CLI flags fully        | claude-sonnet-4-6   | medium |
| 10  | Happy-path E2E semantic snapshot test                          | claude-sonnet-4-6   | medium |
| 11  | Architectural guards + `.skills/observability.md`              | claude-sonnet-4-6   | medium |
| 12  | Doctrine docs (`docs/observability.md`, state-machine, README) | claude-sonnet-4-6   | low    |

---

## phase-01 — Semantic telemetry domain types {#phase-01-semantic-domain}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

### Objective

Introduce the pure-domain vocabulary the doctrine specifies — semantic
telemetry events, structured error report, and the stable snapshot
projection — under `src/domain/telemetry/`. No Effect, no OpenTelemetry,
no IO. This vocabulary becomes the source of truth that every later phase
maps to / from.

### Detailed instructions

- Create `src/domain/telemetry/events.ts`:
  - `SemanticTelemetryEvent` discriminated union with these variants from
    doctrine §5, each carrying `runId: RunId` and an optional
    `operationId: string`: - `StateTransitionTelemetryEvent` — `type: "state.transition"`,
    `event: string`, `stateBefore: string`, `stateAfter: string`,
    `dispatcher: string`. - `AdapterCallStartedTelemetryEvent` — `type: "adapter.call.started"`,
    `adapter: string`, `operation: string`. - `AdapterCallSucceededTelemetryEvent` — `type:
"adapter.call.succeeded"`, `adapter: string`, `operation: string`. - `AdapterCallFailedTelemetryEvent` — `type: "adapter.call.failed"`,
    `adapter: string`, `operation: string`, optional `expected`,
    `actual`, `exitCode: number`, `stderrExcerpt: string`. - `StepStartedTelemetryEvent` — `type: "step.started"`, `step: string`. - `StepCompletedTelemetryEvent` — `type: "step.completed"`,
    `step: string`, `result: "success" | "failure"`. - `GateEvaluatedTelemetryEvent` — `type: "gate.evaluated"`,
    `gate: string`, `result: "accepted" | "rejected"`, optional
    `reason: string`. - `ArtifactGeneratedTelemetryEvent` — `type: "artifact.generated"`,
    `artifact: string`, `path: string`.
  - Each variant exposes a `make<VariantName>(...)` smart constructor that
    enforces the required-field set at the type level. Use
    `exactOptionalPropertyTypes` semantics throughout.
- Create `src/domain/telemetry/errors.ts`:
  - `SystemErrorReport` value type matching doctrine §10 fields:
    `type` (string, e.g. `"adapter.command_failed"`,
    `"artifact.generation_failed"`, `"gate.failed"`), `runId`, optional
    `operationId`, `stateBefore`, `event`, `adapter`, `operation`,
    `expected`, `actual`, `exitCode`, `stderrExcerpt`, `cause: unknown`.
  - `makeSystemErrorReport(input)` smart constructor that normalises the
    `stderrExcerpt` to ≤ 4 KB and truncates with an explicit `…<truncated>`
    suffix so snapshots stay deterministic.
- Create `src/domain/telemetry/snapshot.ts`:
  - `SemanticTraceSnapshot = ReadonlyArray<SemanticTraceSnapshotEntry>`
    where `SemanticTraceSnapshotEntry` is the doctrine-§7 projection (only
    semantic fields: `type`, optional `event`, `stateBefore`, `stateAfter`,
    `dispatcher`, `operationId`, `adapter`, `operation`, `result`).
  - Pure `projectEvent(e: SemanticTelemetryEvent): SemanticTraceSnapshotEntry`
    function (no normalisation of unstable fields — those are stripped by
    construction).
- Add a corresponding Effect Schema set in `src/schemas/telemetryEvents.ts`
  for the eventual JSON-file persistence and for parse-then-validate on the
  OTel side. Schemas mirror the discriminated union 1:1.
- Unit tests under `tests/unit/telemetry/`:
  - `events.test.ts` — every smart constructor produces a value the schema
    accepts; type-level negative cases (missing required field) under
    `tests/type/`.
  - `snapshot.test.ts` — `projectEvent` drops every unstable field and is
    pure.
  - `errors.test.ts` — `stderrExcerpt` truncation is deterministic.
- **Do not** import this module from `src/app/` or `src/infra/` yet — the
  port that consumes these types lands in phase-02.

### Included scope

- `src/domain/telemetry/{events,errors,snapshot}.ts`.
- `src/schemas/telemetryEvents.ts`.
- Unit + type tests under `tests/unit/telemetry/` and `tests/type/`.

### Excluded scope

- The `SystemTelemetry` Effect port (phase-02).
- Any adapter implementation (phases 03–05).
- Touching `src/app/` call sites (phase-07).

### Validation expectations

`pnpm typecheck` and `pnpm test:unit` are green. The new types compile under
`strict` + `exactOptionalPropertyTypes`. Type-level tests catch at least one
attempt to construct a variant with a missing required field.

### Commit subject

`ai(phase-01): add semantic telemetry domain types and snapshot projection`

### Commit body

Introduce the pure-domain semantic telemetry vocabulary under `src/domain/telemetry/` — the `SemanticTelemetryEvent` discriminated union, the `SystemErrorReport` value type, and the `SemanticTraceSnapshot` projection — plus matching Effect Schemas. No Effect, OpenTelemetry, or IO; this is the source of truth every later observability phase maps to or from.

### Expected handoff content

- Exact module paths created and the export list of each.
- Names and shapes of every `SemanticTelemetryEvent` variant.
- Snapshot projection function signature and the fields it preserves.
- Schema module path so phase-04 (JSON file) and phase-05 (OTel) can pick it up.
- Confirmation that no `src/app/` or `src/infra/` file imports the new modules yet.

---

## phase-02 — `SystemTelemetry` application port {#phase-02-system-telemetry-port}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

### Objective

Define the `SystemTelemetry` Effect service (Context.Tag) that the
application layer will call. The port covers traces, structured events,
logs, errors, and metrics through one stable interface, matching doctrine
§4. No implementation in this phase — only the port and its types.

### Detailed instructions

- Create `src/ports/systemTelemetry.ts`:
  - `interface SystemTelemetryOps` with the methods from doctrine §4: - `withOperation<A, E, R>(name: string, attrs: TelemetryAttributes,
operation: Effect.Effect<A, E, R>): Effect.Effect<A, E, R>` — wraps
    an operation in a logical span and re-throws unchanged. - `recordEvent(event: SemanticTelemetryEvent):
Effect.Effect<void, never, never>`. - `recordTransition(transition: StateTransitionTelemetryEvent):
Effect.Effect<void, never, never>`. - `recordError(report: SystemErrorReport):
Effect.Effect<void, never, never>`. - `incrementCounter(name: string, attrs?: TelemetryAttributes):
Effect.Effect<void, never, never>`. - `recordDuration(name: string, durationMs: number,
attrs?: TelemetryAttributes): Effect.Effect<void, never, never>`.
  - `type TelemetryAttributes = Readonly<Record<string, string | number |
boolean>>` — restrict to JSON-serialisable scalars so every backend
    can encode them.
  - `class SystemTelemetry extends Context.Tag("phax/SystemTelemetry")
<SystemTelemetry, SystemTelemetryOps>() {}`.
- Provide one helper layer in the same file:
  - `NoopSystemTelemetryLayer: Layer.Layer<SystemTelemetry>` that discards
    every call. Used as the safe default before phase-06's factory and in
    tests that do not care about telemetry. Mirrors the existing
    `NoopTracerLayer` convention.
- **Do not** wire any caller to this port yet — application migration is
  phase-07. The legacy `Tracer` port stays untouched here.
- Add `tests/unit/ports/systemTelemetry.test.ts` covering only the noop
  layer: every method returns `Effect.void` and never throws.
- Add a type-level test under `tests/type/` confirming
  `withOperation` preserves both the success and error channels of the
  wrapped effect (no widening).

### Included scope

- `src/ports/systemTelemetry.ts` with the Context.Tag, `SystemTelemetryOps`
  interface, `TelemetryAttributes` type, and `NoopSystemTelemetryLayer`.
- Unit + type tests for the noop layer and `withOperation` typing.

### Excluded scope

- Concrete adapters (phases 03–05).
- Composite / factory wiring (phase-06).
- Any call from `src/app/` or `src/cli/` to the new port (phase-07).
- Touching or deprecating `src/ports/tracer.ts` (phase-09).

### Validation expectations

`pnpm typecheck`, `pnpm test:unit`, `pnpm knip` all pass. The noop layer
absorbs every method call without throwing. The type-level test fails the
build if `withOperation` ever widens the error channel.

### Commit subject

`ai(phase-02): add SystemTelemetry application port and noop layer`

### Commit body

Define the `SystemTelemetry` Context.Tag that covers traces, semantic events, errors, counters, and durations behind one stable interface; ship a `NoopSystemTelemetryLayer` as the safe default. The port lives alongside the existing `Tracer` — no callers are migrated in this phase.

### Expected handoff content

- Exact signatures of every `SystemTelemetryOps` method.
- `TelemetryAttributes` constraint (scalar-only) and the rationale.
- `NoopSystemTelemetryLayer` import path so phase-07 can use it during
  transitional commits.
- Confirmation that no `src/app/` or `src/cli/` file imports the new port
  yet and that `src/ports/tracer.ts` is unchanged.

---

## phase-03 — `InMemoryTelemetry` adapter and snapshot projection {#phase-03-in-memory}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

### Objective

Implement the in-memory `SystemTelemetry` adapter from doctrine §12. It
collects semantic events in order, normalises any remaining unstable
values, and exposes the stable snapshot projection used by tests. Also
ship the fake under `src/infra/fakes/` so future test phases can swap it
in alongside (or in place of) the existing `FakeTracer`.

### Detailed instructions

- Create `src/infra/telemetry/inMemory.ts`:
  - `class InMemoryTelemetry implements SystemTelemetryOps` storing events
    in an internal `SemanticTelemetryEvent[]` and operations in a parallel
    `Array<{ name: string; attrs: TelemetryAttributes }>`.
  - `withOperation` pushes the operation, runs the effect, and pops it on
    both success and failure (using `Effect.acquireUseRelease` or
    `Effect.ensuring` — never lose finalisation).
  - `recordTransition` is a thin alias for `recordEvent` of the transition
    variant.
  - `recordError(report)` appends to a `SystemErrorReport[]` accessor.
  - `incrementCounter` / `recordDuration` accumulate into
    `Map<string, number>` (counter sum) and
    `Map<string, number[]>` (duration samples). Expose via accessors.
  - Public accessors: `events()`, `errors()`, `counters()`, `durations()`.
  - `getSemanticTraceSnapshot(): SemanticTraceSnapshot` that maps each
    event through `projectEvent` from phase-01. No normalisation needed
    because the projection only keeps semantic fields by construction.
- Create `src/infra/fakes/systemTelemetry.ts`:
  - `makeFakeSystemTelemetry()` returns `{ impl, layer }` mirroring the
    existing `makeFakeTracer` shape so tests have a familiar entry point.
- Unit tests under `tests/unit/telemetry/inMemory.test.ts`:
  - Events are stored in insertion order.
  - `withOperation` re-throws unchanged on failure and still records both
    span boundaries.
  - Counters sum across multiple `incrementCounter` calls with the same
    name; attribute differences key separately.
  - Durations preserve sample order.
  - `getSemanticTraceSnapshot()` returns only doctrine §7 fields — a guard
    test enumerates the allowed keys and fails on any new one.
- Integration test under `tests/integration/telemetry/inMemorySnapshot.test.ts`
  that drives a tiny scripted workflow (state transition → adapter call
  started → adapter call succeeded → step completed) and asserts the
  snapshot via `expect(...).toMatchSnapshot()`. The snapshot file lands
  under `tests/integration/__snapshots__/`.

### Included scope

- `src/infra/telemetry/inMemory.ts`.
- `src/infra/fakes/systemTelemetry.ts`.
- Unit and snapshot tests.

### Excluded scope

- JSON file persistence (phase-04).
- OpenTelemetry mapping (phase-05).
- Composite / factory (phase-06).
- Migrating any existing test from `FakeTracer` to the new fake (phase-09).

### Validation expectations

`pnpm typecheck`, `pnpm test:unit`, `pnpm test:integration`, `pnpm knip`
all pass. The snapshot file in `__snapshots__/` is committed alongside
the code. Running the snapshot suite twice yields identical output.

### Commit subject

`ai(phase-03): add InMemoryTelemetry adapter and snapshot projection`

### Commit body

Implement the in-memory `SystemTelemetry` adapter that collects semantic events, counters, and durations in deterministic order and exposes a stable `SemanticTraceSnapshot` projection; ship the matching fake under `src/infra/fakes/systemTelemetry.ts`. A scripted integration test pins the snapshot shape so later phases preserve it.

### Expected handoff content

- Public accessors on `InMemoryTelemetry` and the snapshot projection signature.
- `makeFakeSystemTelemetry()` entry point so phase-07 onwards can build test layers.
- Snapshot file path so phase-10 (E2E semantic snapshot test) can extend the same pattern.
- Confirmation that no production code path imports the new adapter yet.

---

## phase-04 — `JsonFileTelemetry` adapter {#phase-04-json-file}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

### Objective

Implement the JSONL-on-disk `SystemTelemetry` adapter from doctrine §12.
Writes one semantic event per line to a target file, swallows all IO
errors (telemetry must never fail a run), and exposes the same Effect
service interface so it can be composed with the OTel adapter in phase-06.

### Detailed instructions

- Create `src/infra/telemetry/jsonFile.ts`:
  - `makeJsonFileSystemTelemetryLayer(path: string):
Layer.Layer<SystemTelemetry>` returning a layer where each call writes
    a single JSON line to `path`.
  - Use the `FileSystem` port from `src/ports/fs.ts` so the adapter stays
    inside the project's existing IO discipline (no direct
    `node:fs/promises`).
  - On every event: ensure parent directory exists (`mkdirp` once,
    cached), then append `JSON.stringify(event) + "\n"`. Errors are
    caught and dropped — the `never` error channel must be honoured.
  - `withOperation` records two events (`step.started` /
    `step.completed`) wrapping the underlying effect; success status set
    based on Effect.Exit. Failure still re-throws unchanged.
  - `recordError` writes the SystemErrorReport with `type` prefix
    `error.` so it is distinguishable in the JSONL stream.
  - `incrementCounter` and `recordDuration` write `metric.counter` /
    `metric.duration` lines respectively.
- Document the recommended on-disk path:
  `~/.phax/runs/<short-name>/semantic.jsonl` (the dispatcher and
  factory in phase-06 will pass this in).
- Tests under `tests/integration/telemetry/jsonFile.test.ts`:
  - Round-trip — write a handful of events to a temp file, read the file
    back, parse each line, decode through the Effect Schema from
    phase-01. Every line round-trips.
  - IO-failure tolerance — point the layer at a read-only directory and
    confirm the effects still resolve `void`.
  - Order preservation across rapid successive writes.

### Included scope

- `src/infra/telemetry/jsonFile.ts`.
- Integration tests against a temp directory.

### Excluded scope

- Path resolution from CLI flags (phase-06).
- Composing with other adapters (phase-06).
- Removing the legacy file-based trace from `src/infra/tracer.ts`
  (phase-09).

### Validation expectations

`pnpm typecheck`, `pnpm test:integration`, `pnpm knip` pass. Pointing the
layer at `/dev/full` (or equivalent) does not throw or fail the test
effect — IO errors stay inside the adapter.

### Commit subject

`ai(phase-04): add JsonFileTelemetry adapter for local semantic traces`

### Commit body

Add a `SystemTelemetry` implementation that appends one JSON line per semantic event to a configurable path through the existing `FileSystem` port. All IO failures are swallowed inside the adapter so telemetry never fails a run, and the on-disk format round-trips through the phase-01 Effect Schemas.

### Expected handoff content

- Factory signature (`makeJsonFileSystemTelemetryLayer`) and its `FileSystem` requirement.
- Recommended on-disk path so phase-06 wires the right default.
- Confirmation that IO errors are swallowed and tested.

---

## phase-05 — `OpenTelemetrySystemTelemetry` adapter {#phase-05-opentelemetry}

**Recommended model:** **claude-opus-4-7**
**Recommended effort:** high

### Objective

Implement the OpenTelemetry-backed `SystemTelemetry` adapter from doctrine
§6 and §12. This is the standard envelope: each `runId` becomes a trace,
each `withOperation` becomes a span, semantic events become span events
or structured logs, errors set span status, and counters/durations are
exported through OTel metrics. This is the only phase that may import
`@opentelemetry/*`. Opus is used because mapping the semantic union onto
OTel concepts and validating it via an in-memory exporter benefits from
deeper reasoning.

### Detailed instructions

- Add runtime dependencies (pinned, current LTS minor at implementation
  time):
  - `@opentelemetry/api`
  - `@opentelemetry/sdk-trace-base`
  - `@opentelemetry/sdk-metrics`
  - `@opentelemetry/resources`
  - `@opentelemetry/semantic-conventions`
    Use the corresponding `@opentelemetry/exporter-*-otlp-http` exporters
    only behind opt-in env vars; do not start them automatically.
- Create `src/infra/telemetry/openTelemetry.ts`:
  - `interface OpenTelemetryAdapterOptions { tracerName: string;
meterName: string; resourceAttributes: TelemetryAttributes }`.
  - `makeOpenTelemetrySystemTelemetryLayer(opts):
Layer.Layer<SystemTelemetry>`.
  - Mapping rules (doctrine §6):
    - `runId` is encoded as a span attribute `phax.run.id` on every span
      and as a baggage entry kept inside the run's root span context.
    - `withOperation(name, attrs, eff)` opens a span named `name`,
      attaches `attrs` as span attributes (only scalar values), runs `eff`
      with the new context as active, sets span status `OK` on success
      and `ERROR` on failure (with `recordException` on the cause).
    - `recordEvent(event)` adds a span event whose name is the
      discriminated `event.type` and whose attributes are the remaining
      event fields (omit `cause`).
    - `recordTransition` is a thin call on top of `recordEvent`.
    - `recordError(report)` records a span event named `error` with the
      structured report attributes, then sets the current span's status
      to `ERROR` and calls `recordException` with `report.cause`.
    - `incrementCounter(name, attrs)` resolves a cached `Counter` and
      increments it by 1.
    - `recordDuration(name, ms, attrs)` resolves a cached `Histogram`
      and records the sample.
  - Helper `withRunContext(runId): Layer.Layer<SystemTelemetry>` is
    **out of scope** — the run-id correlation is per-event via attributes
    and per-operation via active span; no implicit context propagation
    layer is added in this phase.
- Tests under `tests/unit/telemetry/openTelemetry.test.ts`:
  - Use `@opentelemetry/sdk-trace-base`'s `InMemorySpanExporter` and
    `BasicTracerProvider`, plus `@opentelemetry/sdk-metrics`'s
    `InMemoryMetricExporter` / `PeriodicExportingMetricReader` (or
    `MetricReader` shim) to assert that:
    - A `withOperation` produces exactly one span whose attributes
      include `phax.run.id`.
    - A nested `withOperation` is a child span of the outer one.
    - A `recordEvent` inside an operation produces exactly one span
      event whose name matches the event `type`.
    - A failing inner effect sets the outer span status to `ERROR` and
      records the exception with the right message.
    - A counter incremented `n` times exports a metric sample of value
      `n`.
  - **Critical**: these tests assert against OTel exporter state directly
    — they are the only tests allowed to do so. They are explicitly not
    a snapshot of OTel data; they assert structural properties. The
    architectural guard in phase-11 forbids any other test from importing
    `@opentelemetry/*`.

### Included scope

- `src/infra/telemetry/openTelemetry.ts`.
- OTel runtime deps (pinned, declared in `dependencies`).
- Unit tests using in-memory OTel exporters.

### Excluded scope

- Exporter selection / OTLP transport (deferred; envelope mapping only).
- Composite / factory wiring (phase-06).
- Migrating application call sites (phase-07).
- Removing legacy `Tracer` (phase-09).

### Validation expectations

`pnpm typecheck`, `pnpm test:unit`, `pnpm knip`, `pnpm build` all pass.
`@opentelemetry/*` is imported only from `src/infra/telemetry/openTelemetry.ts`
and the matching test file (verified manually here; enforced by the
architectural guard in phase-11). The in-memory exporter assertions show
correct span/event/metric mapping per the rules above.

### Commit subject

`ai(phase-05): add OpenTelemetry SystemTelemetry adapter (envelope)`

### Commit body

Implement the `OpenTelemetrySystemTelemetry` adapter that maps `runId` to traces, `withOperation` to spans, semantic events to span events, structured errors to span status + recorded exceptions, and counters/durations to OTel metrics, per doctrine §6. OTel imports are confined to this single infrastructure module; unit tests exercise the mapping through in-memory exporters.

### Expected handoff content

- Factory signature, its options, and the OTel deps now in `dependencies`.
- The single file allowed to import `@opentelemetry/*` (phase-11 guard input).
- The exact mapping rules implemented (so phase-06's factory and phase-11's docs match).
- Confirmation that exporter transport (OTLP / HTTP) is deferred.

---

## phase-06 — `CompositeTelemetry` + layer factory + CLI flag wiring {#phase-06-composite-and-factory}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

### Objective

Add the composite adapter that fans out one logical call to many
underlying implementations (doctrine §12) and the factory that the CLI
uses to assemble a `SystemTelemetry` layer from runtime flags / env vars.
This phase makes the four implementations from phases 02–05 usable
together — but still does not change any application call site.

### Detailed instructions

- Create `src/infra/telemetry/composite.ts`:
  - `makeCompositeSystemTelemetryLayer(layers:
ReadonlyArray<Layer.Layer<SystemTelemetry>>):
Layer.Layer<SystemTelemetry>`.
  - Each method (`recordEvent`, `recordTransition`, `recordError`,
    `incrementCounter`, `recordDuration`) fans out to every inner
    implementation; any inner failure is caught — outer must still resolve
    `void`.
  - `withOperation` is the tricky one: it must wrap the underlying effect
    in the outer-most layer first, so that nested spans / scopes are
    correctly ordered. Use an inner-to-outer reduce so the leftmost layer
    in `layers` wraps last (becomes the outer scope).
- Create `src/infra/telemetry/layer.ts`:
  - `interface TelemetryFactoryInput {
  output: OutputPort;
  verbose: boolean;
  tracePath?: string;
  otelEnabled: boolean;
  runId: RunId;
}`.
  - `makeSystemTelemetryLayer(input): Layer.Layer<SystemTelemetry>` that
    composes:
    - `InMemoryTelemetry` always last (so tests / diagnostics can attach
      via a side channel; not exposed by default).
    - `JsonFileTelemetry` when `input.tracePath !== undefined`.
    - A new tiny `VerboseRendererTelemetry` (defined here) that prints
      each semantic event through `OutputPort` when `input.verbose` is
      true. This replaces the verbose-mode behaviour of
      `makeVerboseTracerLayer` without depending on the legacy `Tracer`
      port.
    - `OpenTelemetrySystemTelemetry` when `input.otelEnabled` is true.
- Map CLI flags / env to factory input — but do **not** rewire the run
  command yet. The current call sites still go through `Tracer`; the
  factory is built and unit-tested only.
- Tests under `tests/unit/telemetry/composite.test.ts`:
  - Two-layer composite: every method reaches both layers; one failing
    inner layer does not block the other.
  - `withOperation` nests scopes in the documented order — verify by
    composing two `InMemoryTelemetry` instances and inspecting their
    operation stacks.
- Tests under `tests/unit/telemetry/factory.test.ts`:
  - `verbose: true, tracePath: undefined, otelEnabled: false` yields a
    layer that prints to `OutputPort` and writes nothing to disk.
  - All flags false → behaviour identical to `NoopSystemTelemetryLayer`
    (apart from the always-on in-memory side channel).
  - `tracePath` set → writes to the file; reading it back yields the
    semantic events emitted.

### Included scope

- `src/infra/telemetry/composite.ts`.
- `src/infra/telemetry/layer.ts` with `VerboseRendererTelemetry`.
- Unit tests for composition and factory selection.

### Excluded scope

- CLI command rewiring (phase-09).
- Removing `src/infra/tracer.ts` (phase-09).
- Any change to `src/app/` (phase-07).

### Validation expectations

`pnpm typecheck`, `pnpm test:unit`, `pnpm test:integration`, `pnpm knip`,
`pnpm build` all pass. `pnpm knip` does not flag the new factory as
unused (the unit test imports it) — phase-09 will plug it into the CLI.

### Commit subject

`ai(phase-06): add CompositeTelemetry and SystemTelemetry layer factory`

### Commit body

Add `CompositeTelemetry` so multiple `SystemTelemetry` implementations can run in lockstep, plus a `makeSystemTelemetryLayer` factory that composes in-memory / verbose-renderer / JSON-file / OpenTelemetry layers from a single options record. Application call sites are untouched; the legacy `Tracer` still serves the CLI flags.

### Expected handoff content

- `TelemetryFactoryInput` fields and the composition rules.
- `VerboseRendererTelemetry` location and its `OutputPort` dependency.
- Note that CLI rewiring is intentionally deferred to phase-09.

---

## phase-07 — Migrate application orchestration to `SystemTelemetry` {#phase-07-app-migration}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

### Objective

Switch every call site in `src/app/` from the legacy `Tracer` port to the
new `SystemTelemetry` port. Dispatcher transitions become
`recordTransition`; adapter calls in the application layer become
`withOperation`. The legacy `Tracer` port stays present and is wired to a
no-op layer so any remaining caller (CLI flag wiring) still compiles —
the actual removal happens in phase-09.

### Detailed instructions

- Inventory the call sites (already known): `src/app/dispatcher.ts`,
  `src/app/effectRunner.ts`, `src/app/executePlan.ts`,
  `src/app/fixLoop.ts`, `src/app/extractPlan.ts`,
  `src/app/eventAdapter.ts` (Tracer requirement in return types).
- In each call site:
  - Replace `Tracer` import with `SystemTelemetry`.
  - Replace `tracer.event({...})` with the matching
    `telemetry.recordTransition` (for `event.handled` paths in the
    dispatcher) or `telemetry.recordEvent` (for `event.ignored`,
    `event.stale`, `event.rejected`, `event.unexpected`).
  - Map each existing `TraceEventName` to a `SemanticTelemetryEvent`
    variant: - `config.discovered`, `config.validated`, `contract.validated`,
    `contract.invalid` → `step.started` / `step.completed` with
    `step: "config.discover"` / `"config.validate"` /
    `"contract.validate"` and `result` matching the outcome. - `git.worktree.created`, `git.commit.created` →
    `adapter.call.succeeded` with `adapter: "git"`,
    `operation: "worktree.create"` / `"commit.create"`. - `agent.invocation.*` → `adapter.call.*` with `adapter:
"claude-code-cli"`. - `agent.session.captured` → `artifact.generated` with
    `artifact: "claude-session-id"`. - `gate.started`, `gate.completed`, `gate.failed` →
    `step.started` / `step.completed` and `gate.evaluated`. - `fix.started`, `fix.completed` → `step.started` / `step.completed`
    with `step: "fix-loop"`. - `handoff.requested`, `handoff.validated` → `step.*`. - `rate_limit.detected` → `adapter.call.failed` with `adapter:
"claude-code-cli"` and `actual: "rate_limited"`. - `resume.available`, `archive.completed` → `step.completed`.
- Wrap each adapter call in the orchestration code with
  `telemetry.withOperation(name, attrs, eff)`. Names use the
  `phax.<adapter>.<operation>` convention.
- Update layer wiring in `src/cli/commands/runLayers.ts` (and
  equivalents) to provide **both** `Tracer` (noop) and `SystemTelemetry`
  (also noop at this stage — the factory from phase-06 is not yet
  plugged in; that is phase-09). The duplicate wiring is intentional and
  short-lived.
- Update existing integration tests that depend on `FakeTracer` only
  insofar as they still need to compile — switch their `Tracer`
  expectations to also assert on `InMemoryTelemetry.events()`. Do **not**
  delete the `Tracer` assertions yet; the parallel coverage is the safety
  net for phase-09.
- New unit test `tests/unit/telemetry/eventMapping.test.ts` enumerates
  every legacy `TraceEventName` and confirms the new semantic event the
  application emits for it.

### Included scope

- Edits to every file under `src/app/` that currently imports `Tracer`.
- Updates to `src/cli/commands/runLayers.ts` and any other layer-wiring
  file to provide both ports.
- New `eventMapping.test.ts` plus targeted updates to existing tests in
  `tests/integration/dispatcher.test.ts`, `tracer.test.ts`,
  `executePlan.test.ts`, `fixLoop.test.ts`, `eventAdapter.test.ts` so
  they assert on both ports.

### Excluded scope

- Adapter-boundary error reports (phase-08).
- Removing the legacy `Tracer` port (phase-09).
- CLI flag rewiring (phase-09).
- Touching `src/infra/` adapters other than telemetry (phase-08).

### Validation expectations

`pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm knip`, `pnpm
test`, `pnpm build` all pass. Every existing tracer-based test still
asserts the same events. The new `eventMapping.test.ts` documents the
1:1 translation and fails if any application file emits an unmapped
event.

### Commit subject

`ai(phase-07): migrate application orchestration to SystemTelemetry`

### Commit body

Switch every call site in `src/app/` from `Tracer` to `SystemTelemetry`: dispatcher transitions use `recordTransition`, adapter calls use `withOperation`, and the legacy event names are mapped 1:1 to `SemanticTelemetryEvent` variants. The `Tracer` port stays present (wired to a noop) so CLI flag handling still compiles; phase-09 removes it. Existing tests now assert on both ports as a transitional safety net.

### Expected handoff content

- Mapping table from legacy `TraceEventName` to semantic event variant.
- Files still importing `Tracer` after this phase (CLI flag wiring) so phase-09 knows what is left.
- Note that both ports are wired to noop layers in CLI — production output is still off until phase-09.
- Location of `eventMapping.test.ts`.

---

## phase-08 — Structured `SystemErrorReport` at adapter boundaries {#phase-08-error-reports}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

### Objective

Surface the failures that happen at adapter boundaries through
`SystemErrorReport` as doctrine §10 prescribes. The reports answer where
the contract broke (adapter, operation, expected, actual, exit code,
stderr excerpt) and correlate to the current run / operation. Reports
flow from `src/infra/*` adapters into `SystemTelemetry.recordError`, are
attached to the active span by the OTel adapter, written to the JSONL by
the JSON-file adapter, and captured by the in-memory adapter for tests.

### Detailed instructions

- Decide the emission point: adapters report through the application
  layer, **not** by importing `SystemTelemetry` directly. The rule is
  "ports throw typed errors with enough structure; application catches
  them, builds the `SystemErrorReport`, calls `recordError`, and
  re-throws". This keeps `src/infra/` decoupled from telemetry.
- Extend the typed errors where they currently lack structure:
  - `ShellError` (in `src/ports/shell.ts`) — add `exitCode`, `argv`,
    `stderrExcerpt`, `expected?` fields if absent.
  - `GitError` — add `command`, `args`, `stderrExcerpt`, `expected?`.
  - `ClaudeInvocationError` — add `argv`, `exitCode`, `stderrExcerpt`,
    `expected?`.
  - Re-export the schema additions; update existing error constructors
    and call sites.
- In `src/app/eventAdapter.ts` (and any orchestration code that catches
  these errors), build a `SystemErrorReport` and call
  `telemetry.recordError(report)` before re-throwing. The report
  populates `adapter`, `operation`, `expected`, `actual`, `exitCode`,
  `stderrExcerpt`, `runId`, `operationId` (the current operation name
  from `withOperation`), `cause: e`.
- Add `src/app/telemetry/reportBuilders.ts` with focused helpers:
  `reportShellFailure(e, ctx)`, `reportGitFailure(e, ctx)`,
  `reportClaudeFailure(e, ctx)`. Each helper returns a
  `SystemErrorReport` and is unit-tested.
- Tests:
  - Unit tests for each builder under
    `tests/unit/telemetry/reportBuilders.test.ts`.
  - Integration tests under `tests/integration/telemetry/` that drive a
    failing shell command / git command / claude invocation through a
    `FakeShell` / `FakeGit` / `FakeBackend` configured to fail, then
    assert the resulting `InMemoryTelemetry.errors()` entry contains the
    expected fields.
  - Update `tests/integration/fixLoop.test.ts` to assert the failure of
    the first gate attempt produces a `SystemErrorReport` with
    `adapter: "shell"`, `operation: "gate.<command-name>"`, and a
    non-empty `stderrExcerpt`.
- The `stderrExcerpt` always goes through `makeSystemErrorReport` (from
  phase-01) so truncation is consistent.

### Included scope

- Typed-error structural additions in `src/ports/shell.ts`,
  `src/ports/git.ts`, `src/ports/backend.ts`.
- `src/app/telemetry/reportBuilders.ts`.
- Calls to `recordError` in `src/app/eventAdapter.ts` and any other
  orchestration file that catches adapter failures.
- New unit and integration tests.

### Excluded scope

- Removing the legacy `Tracer` port (phase-09).
- E2E semantic snapshot test (phase-10).
- Documentation (phase-12).

### Validation expectations

`pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm knip`, `pnpm
test`, `pnpm build` all pass. The new integration tests demonstrate that
every adapter failure produces a `SystemErrorReport` whose fields point
the reader at the broken contract (per doctrine §9).

### Commit subject

`ai(phase-08): emit SystemErrorReport for adapter boundary failures`

### Commit body

Enrich the typed errors raised by Shell, Git, and Claude-CLI adapters with the contract fields (argv, exit code, stderr excerpt, expected) the doctrine requires, then build `SystemErrorReport` values in the application layer and emit them through `SystemTelemetry.recordError`. Adapter modules stay decoupled from telemetry — reports are constructed where the operation context is known.

### Expected handoff content

- New fields added to each typed error and the report builder signatures.
- Where `recordError` is called (orchestration files touched).
- Integration test names that pin the failure-mode contract.
- Note that adapters do not import `SystemTelemetry`.

---

## phase-09 — Remove legacy `Tracer` port and migrate CLI flags fully {#phase-09-remove-tracer}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

### Objective

Delete the legacy `Tracer` port and all its implementations, fold the
verbose / trace CLI flags onto the `SystemTelemetry` factory from
phase-06, and migrate every remaining test from `FakeTracer` to
`InMemoryTelemetry`. After this phase the codebase has exactly one
observability port.

### Detailed instructions

- In `src/cli/commands/runLayers.ts` (and any other layer-wiring
  module): build a `TelemetryFactoryInput` from the CLI flags and call
  `makeSystemTelemetryLayer` from `src/infra/telemetry/layer.ts`. Pass
  the resolved `runId` and the trace file path
  (`~/.phax/runs/<short-name>/semantic.jsonl`).
- Decide on the OTel default: keep it **off by default**. Enable when the
  user sets `PHAX_OTEL=1` (or `--otel` if added). Document the choice in
  phase-12.
- Delete:
  - `src/ports/tracer.ts`
  - `src/infra/tracer.ts`
  - `src/infra/fakes/tracer.ts`
  - The `Tracer` export from `src/infra/fakes/index.ts`.
- Remove every remaining `Tracer` import from `src/app/`, `src/cli/`,
  and tests. The `Effect<…, …, Tracer | …>` signatures in
  `src/app/eventAdapter.ts` and `src/app/dispatcher.ts` collapse to
  `Effect<…, …, SystemTelemetry | …>`.
- Migrate tests:
  - `tests/integration/tracer.test.ts` → rename to
    `tests/integration/telemetry/end-to-end.test.ts` and rewrite to use
    `InMemoryTelemetry`.
  - `tests/unit/tracer.test.ts` → equivalent coverage already lives
    under `tests/unit/telemetry/`; delete after confirming nothing
    unique is lost (port the formatter assertions to the verbose
    renderer if needed).
  - All other integration tests that asserted on `FakeTracer` swap to
    `InMemoryTelemetry`. The parallel assertions added in phase-07 make
    this mechanical: drop the `FakeTracer` half.
- Verify with `pnpm knip` that no dead exports remain. Update
  `knip.json` only if a legitimate runtime-only entry needs to be
  declared.
- Update `phax.json` only if the gate profile needs adjustment (it
  should not — the same scripts still run).

### Included scope

- Deletion of the three legacy `Tracer` modules.
- CLI flag wiring through `makeSystemTelemetryLayer`.
- Test migration to `InMemoryTelemetry`.
- Cleanup of `Tracer` symbols across the codebase.

### Excluded scope

- E2E semantic snapshot test (phase-10).
- Architectural guards that prevent reintroduction (phase-11).
- Documentation update (phase-12).
- Adding OTLP exporter wiring (out of scope; deferred).

### Validation expectations

`pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm knip`, `pnpm
test`, `pnpm build` all pass. `grep -R "from \"\.\./ports/tracer\""
src tests` returns nothing. Running `phax run --verbose` produces
verbose semantic-event output through the new renderer; running with
`--trace <path>` writes a JSONL file with semantic events; both still
work in the absence of `PHAX_OTEL`.

### Commit subject

`ai(phase-09): remove legacy Tracer port and unify on SystemTelemetry`

### Commit body

Delete `src/ports/tracer.ts` and its three implementations, fold the verbose / trace CLI flags onto the `SystemTelemetry` factory, and migrate every remaining test from `FakeTracer` to `InMemoryTelemetry`. The codebase now has a single observability port; `@opentelemetry/*` stays opt-in via `PHAX_OTEL` and is the doctrine's standard envelope.

### Expected handoff content

- The default OTel-off decision and the enable env var.
- The single `runLayers.ts` (or equivalent) call site that builds the layer.
- Confirmation that `knip`, `lint`, and `format:check` are clean after the deletion.
- Pointer to the renamed integration test file.

---

## phase-10 — Happy-path E2E semantic snapshot test {#phase-10-e2e-snapshot}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

### Objective

Add the reality-probe test the doctrine describes in §8 and §15: drive
the happy path end-to-end with real adapters (or the existing
`tests/e2e/` harness), capture the semantic trace through
`InMemoryTelemetry`, and snapshot the projection. The snapshot is the
proof artifact that the system still walks the desired path; future
refactors must replay it identically.

### Detailed instructions

- Extend `tests/e2e/realFlow.test.ts` (or add
  `tests/e2e/semanticTrace.test.ts` if it keeps the existing test
  focused): wire `InMemoryTelemetry` as part of the
  `CompositeTelemetry` so the real flow continues to emit to its normal
  outputs while the test also captures every semantic event.
- After the happy path completes, call
  `inMemoryTelemetry.getSemanticTraceSnapshot()` and assert via
  `expect(snapshot).toMatchSnapshot()`. Snapshot file lives under
  `tests/e2e/__snapshots__/`.
- The snapshot must not contain any unstable field — the projection from
  phase-01 already strips them, but add an explicit guard in the test
  that re-asserts no `timestamp`, `traceId`, `spanId`, `durationMs`, or
  absolute-path key appears in the serialised JSON.
- Add helper `tests/e2e/helpers/telemetry.ts` that builds the layer (so
  future E2E tests can opt into the same pattern with one import).
- Document the loop in a short comment block in the test file (doctrine
  §15 proof-preserving iteration). Reference `docs/observability.md`
  (delivered in phase-12) by name even though the doc lands later — the
  link is one-way and won't break.

### Included scope

- E2E test that asserts the semantic trace snapshot.
- Snapshot file under `tests/e2e/__snapshots__/`.
- E2E helper layer for `InMemoryTelemetry` composition.

### Excluded scope

- Snapshot promotion tooling (out of scope; rely on Vitest's
  `--update`).
- New domain events (phase-01 / phase-07 fix everything before this).
- Documentation page (phase-12).

### Validation expectations

`pnpm test:e2e:real` (the existing script) passes. Running the snapshot
update flow on a no-change branch produces no diff. Re-running on a
deliberately broken branch (e.g. dispatcher skipping a transition) fails
with a clear diff at the snapshot boundary.

### Commit subject

`ai(phase-10): pin happy-path semantic trace via snapshot test`

### Commit body

Add an end-to-end test that drives the real happy path while capturing semantic events through `InMemoryTelemetry`, then asserts the `SemanticTraceSnapshot` projection. The snapshot is the proof artifact the doctrine prescribes — future refactors must replay it identically or explicitly promote a new baseline.

### Expected handoff content

- E2E test file and snapshot file paths.
- Helper module other E2E tests should import to opt into telemetry capture.
- The exact set of unstable-field names guarded against in the test.

---

## phase-11 — Architectural guards + `.skills/observability.md` {#phase-11-guards-and-skill}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

### Objective

Freeze the doctrine in code through architectural guard tests in the
same style as `tests/unit/architecturalGuards.test.ts`, and ship the
correction-guide skill the guards point reviewers / agents to.

### Detailed instructions

- Extend `tests/unit/architecturalGuards.test.ts` (or add a sibling
  `architecturalGuards.telemetry.test.ts` for clarity) with four guards:
  - `PHAX_TELEMETRY_001` — no file under `src/domain/` may import
    `../ports/systemTelemetry.js`, anything under `src/infra/telemetry/`,
    or any `@opentelemetry/*` package.
  - `PHAX_TELEMETRY_002` — only files under `src/infra/telemetry/` (and
    the matching unit-test file from phase-05) may import
    `@opentelemetry/*`.
  - `PHAX_TELEMETRY_003` — files under `src/app/` and `src/cli/` import
    `SystemTelemetry` only — they must not import `@opentelemetry/*` or
    any `src/infra/telemetry/*` module directly.
  - `PHAX_TELEMETRY_004` — snapshot files in `tests/**/__snapshots__/`
    must not contain the substrings `traceId`, `spanId`, `durationMs`,
    or any 13+ digit Unix timestamp pattern (regex `\b\d{13,}\b`). This
    enforces "snapshot the projection, not the envelope".
- Each guard surfaces violations as a structured failure message with
  the rule id, the offending file, the offending import / substring,
  and a pointer to the new skill file.
- Create `.skills/observability.md` summarising the doctrine for
  agents and reviewers:
  - The three-layer split (domain pure / app semantic / infra OTel).
  - The `SystemTelemetry` API and when to call which method.
  - The four implementations and how the factory composes them.
  - The snapshot-the-projection rule.
  - The `SystemErrorReport` contract.
  - Cross-links to `docs/observability.md` (phase-12) and the doctrine
    source under `.context/attachments/`.
- Optional, low-cost: also fail the build (in the same guard test) if
  any file under `src/app/` or `src/cli/` imports
  `src/infra/telemetry/openTelemetry.ts` directly — that path must
  always go through the factory.

### Included scope

- Architectural guard tests for the four `PHAX_TELEMETRY_*` rules.
- `.skills/observability.md`.

### Excluded scope

- Building an Oxc-based audit engine (the project uses Vitest guards;
  do not introduce a new audit framework here).
- Doctrine documentation page (phase-12).

### Validation expectations

`pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm knip`, `pnpm
test`, `pnpm build` all pass. Introducing a forbidden import (e.g. a
domain file importing the port) fails the relevant guard with the rule
id and skill pointer.

### Commit subject

`ai(phase-11): add telemetry doctrine guards and observability skill`

### Commit body

Add four `PHAX_TELEMETRY_*` architectural guard tests that freeze the doctrine in code — domain isolation, OTel confinement, application port-only access, and snapshot-projection purity — and ship `.skills/observability.md` so agents and reviewers have a single correction guide when a guard fires.

### Expected handoff content

- Rule ids and their exact assertion logic.
- Skill file location and the sections it covers.
- Confirmation that every existing snapshot file passes the new
  unstable-field guard.

---

## phase-12 — Doctrine docs (`docs/observability.md`, state-machine, README) {#phase-12-docs}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

### Objective

Make the doctrine discoverable from the user-facing docs: a dedicated
`docs/observability.md` page that summarises the architecture and the
flags, plus updates to `docs/state-machine.md` and `README.md` so every
reader sees `SystemTelemetry` (not the legacy `Tracer`) as the canonical
observability surface.

### Detailed instructions

- Create `docs/observability.md`:
  - One-paragraph summary of the doctrine ("OpenTelemetry transports
    and correlates. The system produces the meaning. Snapshots capture
    the meaning, not the transport.").
  - Architecture diagram (ASCII) of the three-layer split.
  - Section "Port surface" — the `SystemTelemetry` methods with
    one-line descriptions.
  - Section "Implementations" — the four adapters and when to use each.
  - Section "CLI flags and env vars" — `--verbose`, `--trace <path>`,
    `PHAX_OTEL=1`, default value of each, and what they produce.
  - Section "Snapshot rule" — what tests must / must not assert, with
    a pointer to `tests/e2e/__snapshots__/`.
  - Section "Adapter boundary failures" — the `SystemErrorReport`
    contract, with one worked example (a failing shell command).
  - Section "Architectural guards" — list of `PHAX_TELEMETRY_*` rules
    and a pointer to `.skills/observability.md`.
  - Final "Further reading" pointing to the doctrine source under
    `.context/attachments/`.
- Update `docs/state-machine.md`:
  - Replace any mention of `Tracer` / `TraceEvent` with
    `SystemTelemetry` / `SemanticTelemetryEvent`.
  - Update the architecture diagram if it shows the Tracer arrow.
  - Cross-link to `docs/observability.md`.
- Update `README.md`:
  - Add a short "Observability" section under the feature list with the
    three CLI flags / env vars and a link to `docs/observability.md`.
- Update `docs/acceptance-coverage.md` if it exists with the new
  coverage rows (`Doctrine §4–§10` → phases 01–12 of this plan).
- No code changes in this phase.

### Included scope

- `docs/observability.md`.
- Edits to `docs/state-machine.md` and `README.md`.
- Optional edits to `docs/acceptance-coverage.md`.

### Excluded scope

- New code, tests, or guards.
- Marketing material.

### Validation expectations

`pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm knip`, `pnpm
test`, `pnpm build` all pass (docs-only commit; gates should be a
formality). The new page renders cleanly in a Markdown viewer and every
internal link resolves to a real path in the repository.

### Commit subject

`ai(phase-12): document the observability doctrine and SystemTelemetry`

### Commit body

Ship `docs/observability.md` summarising the doctrine, the `SystemTelemetry` port, the four implementations, the CLI flags / env vars, the snapshot rule, the adapter-boundary failure contract, and the `PHAX_TELEMETRY_*` guards; update `docs/state-machine.md` and `README.md` to point at `SystemTelemetry` as the canonical observability surface. Documentation-only commit.

### Expected handoff content

- Final path of `docs/observability.md` and its section headings.
- List of every doc file edited.
- Confirmation that every internal link resolves.

---

## Appendix A — Doctrine-section to phase mapping

| Doctrine section                             | Phase(s)       |
| -------------------------------------------- | -------------- |
| §1 Core principle (three-layer split)        | 01, 02, 05, 11 |
| §2 Vocabulary (trace, span, event, log, …)   | 01, 12         |
| §3 Architecture (domain / app / infra)       | 01, 02, 11     |
| §4 `SystemTelemetry` port                    | 02             |
| §5 Semantic events                           | 01             |
| §6 OpenTelemetry as envelope                 | 05             |
| §7 Snapshot strategy                         | 01, 03, 10, 11 |
| §8 Happy path E2E tests                      | 10             |
| §9 Adapter boundary failures                 | 08             |
| §10 Error reporting                          | 08             |
| §11 Metrics                                  | 03, 05, 06     |
| §12 Recommended implementations              | 03, 04, 05, 06 |
| §13 Placement in a STEME-compatible codebase | 01, 02, 11     |
| §14 Effect integration strategy              | 02, 07         |
| §15 Proof-preserving iteration               | 03, 10         |
| §16 Practical rule of thumb                  | 11, 12         |
| §17 Summary                                  | 12             |

## Appendix B — End-to-end verification

After all 12 phases land:

1. `pnpm typecheck && pnpm lint && pnpm format:check && pnpm knip && pnpm test && pnpm build` — full gate profile is green.
2. `pnpm test:e2e:real` — the happy-path semantic trace snapshot replays identically.
3. `PHAX_OTEL=1 pnpm dev run …` against a local OTLP collector emits a trace whose root span carries `phax.run.id` and whose nested spans match the operation hierarchy in the snapshot.
4. `phax run --trace ~/.phax/runs/<short>/semantic.jsonl …` produces a JSONL file whose lines round-trip through the phase-01 schemas.
5. Introducing a domain-layer import of `SystemTelemetry` fails the build with `PHAX_TELEMETRY_001` and a pointer to `.skills/observability.md`.
