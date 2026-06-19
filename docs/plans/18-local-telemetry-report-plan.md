# Plan — Local-only telemetry and `phax report`

## Context and rationale

phax has no network egress and is not meant to phone home. Today the OpenTelemetry
adapter (`src/infra/telemetry/openTelemetry.ts`) builds a `BasicTracerProvider` and a
`MeterProvider` **with no exporter or span processor**, so every span and metric it
creates is silently discarded. It is gated behind `PHAX_OTEL=1` (off by default), so in
practice it is dead code that ships ~22 MB of `@opentelemetry/*` packages — of which
`@opentelemetry/semantic-conventions` (12 MB) is imported nowhere in `src/`.

The verification that matters: the semantic events in `src/domain/telemetry/events.ts`
carry only `runId` + an optional `operationId`. They have **no timestamp, no duration,
and no traceId**. The metadata that OTel "adds for free" (wall-clock time, span
durations, parent/child correlation) was produced by the OTel spans — but because there
is no exporter, none of it is ever written to disk. The only sink that actually persists
anything is `src/infra/telemetry/jsonFile.ts`, which appends the raw event JSON to a
per-run file (`<runFolder>/semantic.jsonl`, see `src/cli/commands/run.ts`) **without any
timestamp**.

Conclusion: removing OTel costs no currently-persisted data. The goal is to make the
local JSON-Lines sink the sole, enriched transport (add `ts` + `durationMs`), introduce a
global telemetry switch and a rotating daily journal for non-run commands, and add a
user-triggered `phax report` command that opens a GitHub issue (with a gist for the full
log) on demand.

## Required commands

- (none)

## Phases

1. `phase-01` — Remove the OpenTelemetry adapter and dependencies (pure subtraction).
2. `phase-02` — Enrich the JSON-file telemetry sink with timestamps and durations.
3. `phase-03` — Global telemetry config at `~/.phax/telemetry.json` (default enabled).
4. `phase-04` — Daily global telemetry journal with 7-day rotation.
5. `phase-05` — `phax report`: GitHub issue + gist from local telemetry.

---

## phase-01 — Remove the OpenTelemetry adapter and dependencies {#phase-01-remove-otel}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

Delete the no-op OpenTelemetry transport and its five `@opentelemetry/*` dependencies.
This is pure subtraction: nothing currently persisted depends on OTel, because the
adapter has no exporter. The semantic event model, the in-memory sink, the JSON-file
sink, and the composite sink all stay.

### Detailed instructions

- Delete `src/infra/telemetry/openTelemetry.ts` and `tests/unit/telemetry/openTelemetry.test.ts`.
- In `src/infra/telemetry/layer.ts`: remove the `makeOpenTelemetrySystemTelemetryLayer`
  import, the `otelEnabled` field from `TelemetryFactoryInput`, and the `if
  (input.otelEnabled) { … }` branch that pushes the OTel ops. Update the composition-order
  comment in the doc block so it no longer mentions OTel.
- In `src/cli/commands/runLayers.ts`: remove `otelEnabled: process.env["PHAX_OTEL"] === "1"`
  from `buildSystemTelemetryLayer`'s `TelemetryFactoryInput`.
- In `package.json`: remove `@opentelemetry/api`, `@opentelemetry/resources`,
  `@opentelemetry/sdk-metrics`, `@opentelemetry/sdk-trace-base`, and
  `@opentelemetry/semantic-conventions`. Refresh the lockfile via the configured setup
  command (`pnpm install`).
- In `tests/unit/architecturalGuards.telemetry.test.ts`: drop
  `src/infra/telemetry/openTelemetry.ts` and `tests/unit/telemetry/openTelemetry.test.ts`
  from the `PHAX_TELEMETRY_002` allowlist. Keep the guard itself — it now asserts that
  **no** file imports `@opentelemetry/*`.
- Update `.claude/skills/observability/SKILL.md` and `docs/observability.md`: remove the
  OTel adapter rows/sections, and restate the doctrine as "the JSON-Lines file is the
  transport; OTel is no longer bundled." Leave the three-layer split and the
  port/snapshot rules intact.
- Confirm with a repo-wide search that nothing else references `@opentelemetry`,
  `otelEnabled`, `PHAX_OTEL`, or `makeOpenTelemetrySystemTelemetryLayer`.

### Planned files to create

- (none)

### Planned files to edit

- `src/infra/telemetry/layer.ts`
- `src/cli/commands/runLayers.ts`
- `tests/unit/architecturalGuards.telemetry.test.ts`
- `package.json`
- `.claude/skills/observability/SKILL.md`
- `docs/observability.md`

### Optional files that may be edited

- `pnpm-lock.yaml`
- `tests/unit/telemetry/factory.test.ts`

### Boundary contracts

The `SystemTelemetry` port (`src/ports/systemTelemetry.ts`) is unchanged — only one of
its infra implementations is removed. Consumers in `app/` and `cli/` keep talking to the
port exactly as before; `makeSystemTelemetryLayer` keeps the same signature minus the
`otelEnabled` input field.

### Test strategy

- `knip` (in the `full` gate) confirms the five dependencies are gone and unreferenced.
- `audit:architecture` plus the telemetry architectural guard confirm no `@opentelemetry/*`
  import remains.
- Adjust `tests/unit/telemetry/factory.test.ts` only if it asserts on the OTel branch.
- No new behavioral tests — this phase removes behavior that produced no observable output.

### Implementation order

Delete the adapter and its test, then prune `layer.ts`/`runLayers.ts`, then the guard
allowlist, then `package.json` + lockfile, then docs.

### Excluded scope

- Any change to the JSON-file sink format (phase-02).
- Global config or rotation (phase-03/04).

### Verification

- The project's configured `full` gate profile in `phax.json` (notably `knip`,
  `audit:architecture`, and the telemetry guard test).

### Expected handoff content

- Confirmation that `makeSystemTelemetryLayer`'s `TelemetryFactoryInput` no longer has an
  `otelEnabled` field, and that `buildSystemTelemetryLayer` no longer reads `PHAX_OTEL`.
- The final state of the `PHAX_TELEMETRY_002` allowlist.
- Any deviation from the planned file lists, with the reason.

### Commit subject

refactor(telemetry): remove the no-op OpenTelemetry transport

### Commit body

The OpenTelemetry adapter built spans and metrics with no exporter, so all of it was
discarded at runtime while shipping ~22 MB of @opentelemetry/* packages (semantic-conventions
alone, 12 MB, was imported nowhere). Delete the adapter, its test, the otelEnabled/PHAX_OTEL
wiring, and the five dependencies. The SystemTelemetry port and the in-memory, JSON-file,
and composite sinks are unchanged. Guard test and observability docs updated.

---

## phase-02 — Enrich the JSON-file telemetry sink with timestamps and durations {#phase-02-enrich-sink}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

Make the JSON-Lines sink carry the metadata OTel used to fabricate but never persisted:
a wall-clock timestamp on every record, and an operation duration on completion.
Correlation is already covered by `runId` + `operationId` in the event payloads.

### Detailed instructions

- In `src/infra/telemetry/jsonFile.ts`, inject a clock to keep the adapter testable:
  add an optional `now: () => number` parameter to `makeJsonFileTelemetryOps` /
  `makeOps`, defaulting to `() => Date.now()` (the infra edge may read the clock
  directly, consistent with `src/infra/lock.ts`).
- Stamp every appended record with an ISO-8601 `ts` field derived from `now()`. The
  stamping happens in `appendJson` so it applies uniformly to events, transitions,
  errors, counters, and durations.
- In `withOperation`, capture `now()` at acquire and at release; write `durationMs` (an
  integer) onto the `step.completed` record alongside the existing `result`.
- Do not change the `SemanticTelemetryEvent` domain types — `ts`/`durationMs` are
  transport metadata added at the infra edge, not domain fields. This keeps the snapshot
  projection (`src/domain/telemetry/snapshot.ts`) and its "no timestamps/durations"
  invariant untouched.
- Add/extend a unit test for the sink using an injected deterministic clock and a fake
  `FileSystem`, asserting that each emitted line has a stable `ts` and that
  `step.completed` carries `durationMs`.

### Planned files to create

- `tests/unit/telemetry/jsonFile.test.ts`

### Planned files to edit

- `src/infra/telemetry/jsonFile.ts`

### Optional files that may be edited

- `src/infra/telemetry/layer.ts`
- `docs/observability.md`

### Boundary contracts

The sink keeps implementing `SystemTelemetryOps`. The on-disk JSON-Lines record gains two
optional transport fields (`ts` always; `durationMs` on `step.completed`). Downstream
consumers (phase-05 report builder) must treat `ts`/`durationMs` as the canonical time
source for a record.

### Test strategy

- Adapter-level unit test (`tests/unit/telemetry/jsonFile.test.ts`) with a fake
  `FileSystem` and an injected `now`, written **before** the implementation change so the
  contract (every line stamped, completion carries duration) is pinned first.
- The snapshot/projection tests must remain green, proving domain snapshots are unaffected.

### Implementation order

Add the clock parameter, then stamp in `appendJson`, then measure in `withOperation`,
then the test.

### Excluded scope

- Where the file lives or how it rotates (phase-03/04).
- Any change to the in-memory or composite sinks.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact record shape written by the sink after this phase (field names and types for
  `ts` and `durationMs`).
- The `makeJsonFileTelemetryOps` signature including the new `now` parameter default.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(telemetry): stamp JSON-Lines sink records with timestamp and duration

### Commit body

The JSON-file sink is now the sole telemetry transport, so give it the metadata OTel used
to fabricate but never persisted: an ISO-8601 `ts` on every record and `durationMs` on
step.completed. A clock is injected (default Date.now) for deterministic tests. Domain
event types and the snapshot projection are unchanged — these are transport-only fields.

---

## phase-03 — Global telemetry config at `~/.phax/telemetry.json` {#phase-03-global-config}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Introduce phax's first global (non-project) config file: `~/.phax/telemetry.json`,
holding a single required `enabled` boolean, defaulting to enabled. When telemetry is
disabled, the run/resume/extract-plan commands use the existing
`NoopSystemTelemetryLayer` instead of building a live sink.

### Detailed instructions

- Add an Effect Schema `src/schemas/telemetryConfig.ts` decoding `{ "enabled": boolean }`.
  Follow the project rule: `enabled` is **required**, no optional-for-back-compat shim.
- Add `src/app/loadTelemetryConfig.ts` mirroring the bootstrap pattern of
  `src/app/loadConfig.ts` (synchronous read + schema decode, returning an `Either`):
  - Resolve the path as `join(homedir(), ".phax", "telemetry.json")`.
  - If the file is absent, return `enabled: true` and scaffold the file with
    `{ "enabled": true }` without overwriting an existing one (mirror how
    `src/cli/commands/agent.ts` scaffolds `~/.phax/*.json`).
  - If the file is present but invalid, return a `ConfigValidationError` so the CLI can
    report it via the existing config-error path.
- Wire the flag into the three commands that build a live telemetry layer
  (`run.ts`, `resume.ts`, `extractPlan.ts`): when `enabled` is false, provide
  `NoopSystemTelemetryLayer` instead of `buildSystemTelemetryLayer(...)`. Keep the wiring
  in the CLI command files (composition root); do not push config reads into `app/` use
  cases.
- Add unit tests for the loader (absent → enabled + scaffolded, present-valid → decoded,
  present-invalid → error) using a fake/temp home, and a type-level test for the schema if
  the repo has a `tests/type` convention for schemas.

### Planned files to create

- `src/schemas/telemetryConfig.ts`
- `src/app/loadTelemetryConfig.ts`
- `tests/unit/loadTelemetryConfig.test.ts`

### Planned files to edit

- `src/cli/commands/run.ts`
- `src/cli/commands/resume.ts`
- `src/cli/commands/extractPlan.ts`

### Optional files that may be edited

- `tests/type/telemetryConfig.test-d.ts`
- `docs/observability.md`

### Boundary contracts

External input (the `~/.phax/telemetry.json` file) is decoded through an Effect Schema
before any value enters the system — consistent with the validation-boundaries rule. The
loader's consumer contract: it returns either a `{ enabled: boolean }` value or a
`ConfigValidationError`; callers in `cli/` decide between the live layer and the noop
layer.

### Test strategy

- Application/bootstrap unit tests for `loadTelemetryConfig` (the three cases above),
  written before implementation.
- Schema decode tested via a type test if the convention exists; otherwise covered by the
  loader unit test.

### Implementation order

Schema → loader → CLI wiring → tests.

### Excluded scope

- The daily journal and rotation (phase-04) — this phase only gates the existing per-run
  sink on the `enabled` flag.
- Any `phax config`-style command to toggle the flag (out of scope; users edit the file).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact path and shape of `~/.phax/telemetry.json` and the `loadTelemetryConfig`
  signature/return type.
- The scaffold-on-absence behavior (never overwrites).
- Which CLI commands now consult the flag, and that disabling yields
  `NoopSystemTelemetryLayer`.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(telemetry): add global ~/.phax/telemetry.json enable switch

### Commit body

Introduce phax's first global config file: ~/.phax/telemetry.json with a required
`enabled` boolean (default true), decoded through an Effect Schema and scaffolded on first
use without overwriting. run/resume/extract-plan now provide NoopSystemTelemetryLayer when
telemetry is disabled. Covered by loader unit tests.

---

## phase-04 — Daily global telemetry journal with 7-day rotation {#phase-04-daily-journal}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Heavy runs already get their own per-run `semantic.jsonl`. Give every other (small)
command a shared, low-volume sink: a daily file `~/.phax/telemetry-YYYY-MM-DD.jsonl`,
retaining one week and pruning older days. Rotation is by day, not by size — the small
commands never produce much.

### Detailed instructions

- Add pure date logic in `src/domain/telemetry/journal.ts` (no I/O):
  - `dailyJournalFileName(date: Date): string` → `telemetry-YYYY-MM-DD.jsonl` (UTC).
  - `journalFilesToPrune(existingNames: readonly string[], today: Date, retentionDays: number): readonly string[]`
    — parse the date out of each matching filename and return those older than the
    retention window; ignore non-matching names.
- Add a directory-listing capability to the filesystem port, since none exists today:
  `list(path: string): Effect.Effect<readonly string[], FsError>` on
  `src/ports/fs.ts`, implemented in `src/infra/fs.ts` and the fakes used by tests.
- Add `src/app/globalTelemetryJournal.ts`:
  - Build a `SystemTelemetry` layer whose sink is the (phase-02) JSON-file adapter
    pointed at `~/.phax/<dailyJournalFileName(now)>`, composed with the always-on
    in-memory sink — gated by the phase-03 `enabled` flag (disabled → noop).
  - On construction, `mkdirp(~/.phax)`, then `list` the directory and `remove` every file
    returned by `journalFilesToPrune(..., retentionDays = 7)`. Swallow prune I/O errors
    (telemetry must never break a command).
- Wire this global journal into commands that currently use `NoopSystemTelemetryLayer` or
  provide no telemetry layer (e.g. `archive`, `ls`, `open`, `path`, `reviewHandoff`,
  `resetPhase`, `security`, `agent`). Leave `run`/`resume`/`extract-plan` on their per-run
  sink (the heavy files) — do not double-write them into the daily journal.
- Tests: unit-test the pure date logic (`dailyJournalFileName`, `journalFilesToPrune`
  including non-matching names and boundary dates); integration-test the journal layer's
  prune against a fake `FileSystem` listing.

### Planned files to create

- `src/domain/telemetry/journal.ts`
- `src/app/globalTelemetryJournal.ts`
- `tests/unit/telemetry/journal.test.ts`
- `tests/integration/globalTelemetryJournal.test.ts`

### Planned files to edit

- `src/ports/fs.ts`
- `src/infra/fs.ts`

### Optional files that may be edited

- `src/infra/fakes/fs.ts`
- `src/cli/commands/archive.ts`
- `src/cli/commands/ls.ts`
- `src/cli/commands/open.ts`
- `src/cli/commands/path.ts`
- `src/cli/commands/reviewHandoff.ts`
- `src/cli/commands/resetPhase.ts`
- `src/cli/commands/security.ts`
- `src/cli/commands/agent.ts`
- `tests/type/fs.test-d.ts`
- `docs/observability.md`

### Boundary contracts

- Producer: `src/domain/telemetry/journal.ts` exposes pure, I/O-free filename/prune logic.
- The `FileSystem` port gains a `list` operation; every adapter and fake that implements
  the port must provide it (the architecture audit will flag any that does not).
- Consumer: CLI commands obtain a `SystemTelemetry` layer from
  `globalTelemetryJournal` instead of `NoopSystemTelemetryLayer` when telemetry is enabled.

### Test strategy

- Domain unit tests for the date/prune functions, written first — these encode the
  retention contract.
- Integration test for the journal layer using a fake `FileSystem` to assert that
  out-of-window files are removed and in-window files are kept, and that prune errors are
  swallowed.

### Implementation order

Pure date logic → `fs.list` port + adapter + fakes → journal layer + prune → CLI wiring →
tests alongside each step.

### Excluded scope

- The `phax report` command (phase-05).
- Size-based rotation or compression — retention is strictly day-count based.

### Verification

- The project's configured `full` gate profile in `phax.json` (including
  `audit:architecture` for the new port method).

### Expected handoff content

- The daily filename format and the exact retention window (7 days).
- The `FileSystem.list` signature and which adapters/fakes implement it.
- The list of CLI commands rewired to the global journal, and confirmation that
  run/resume/extract-plan were intentionally left on their per-run sink.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(telemetry): add rotating daily global telemetry journal

### Commit body

Small commands now append to ~/.phax/telemetry-YYYY-MM-DD.jsonl, retained for 7 days with
day-based pruning; heavy runs keep their per-run semantic.jsonl. Adds pure filename/prune
logic in domain, a FileSystem.list port method, and a gated journal layer that prunes on
construction. Covered by domain unit tests and a journal integration test.

---

## phase-05 — `phax report`: GitHub issue + gist from local telemetry {#phase-05-report-command}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Add a user-triggered `phax report` command that turns local telemetry into a GitHub issue.
The issue body carries a structured summary (always within GitHub's ~64 KB body limit);
the full log goes to a secret gist that the body links to. This is the only network
action in the feature — explicit, on demand, via the already-present `gh` CLI.

### Detailed instructions

- Extend the GitHub port (`src/ports/github.ts`) with:
  - `createIssue(input: { repo: string; title: string; bodyFile: string }): Effect.Effect<string, GitHubError>`
    (returns the issue URL).
  - `createGist(input: { description: string; file: string; public: boolean }): Effect.Effect<string, GitHubError>`
    (returns the gist URL).
  Implement both in `src/infra/github.ts` via `gh issue create` / `gh gist create`,
  following the existing `ghRun` pattern. Decode the URL from stdout defensively.
- Add pure report-assembly logic in `src/domain/telemetry/report.ts`:
  - Build the issue body from environment metadata (phax version, `process.version`,
    `process.platform`/`arch`, the command being reported), any `SystemErrorReport`s, and
    a tail of the most recent N semantic events.
  - Decide gist-vs-inline: if the full log exceeds a safe body threshold (well under
    64 KB), emit the summary inline and reference the gist URL; otherwise inline the log.
  - Keep this function I/O-free; it takes already-read records + metadata and returns
    `{ title, body, fullLog }`.
- Add `src/app/report.ts` orchestrating: resolve which telemetry file to read (a specific
  run's `semantic.jsonl` by short-name/run-id argument, or the latest daily journal for
  the global case), read it via the `FileSystem` port, build the body via the domain
  function, optionally create a secret gist for the full log, then create the issue
  against the phax repository, and return the issue URL via the `OutputPort`.
- Add the CLI command `src/cli/commands/report.ts` (thin: parse args, call the use case,
  render) and register it in `src/cli/main.ts`. Support an optional positional
  short-name/run-id (omit ⇒ global/latest) and a `--no-gist` flag to force inline-only.
- Reuse `src/app/telemetry/reportBuilders.ts` for `SystemErrorReport` shaping where
  applicable.
- Tests: unit-test the domain report builder (metadata header present, gist-vs-inline
  threshold honored, error reports surfaced); integration-test `src/app/report.ts` with a
  fake `GitHub` port and a fake `FileSystem` (asserting issue creation and gist fallback,
  and a clear error when `gh` is unavailable/unauthenticated).

### Planned files to create

- `src/domain/telemetry/report.ts`
- `src/app/report.ts`
- `src/cli/commands/report.ts`
- `tests/unit/telemetry/report.test.ts`
- `tests/integration/report.test.ts`

### Planned files to edit

- `src/ports/github.ts`
- `src/infra/github.ts`
- `src/cli/main.ts`

### Optional files that may be edited

- `tests/type/github.test-d.ts`
- `src/app/telemetry/reportBuilders.ts`
- `docs/observability.md`
- `README.md`

### Boundary contracts

- Producer: `src/domain/telemetry/report.ts` returns a pure `{ title, body, fullLog }`
  shape from records + metadata.
- The `GitHub` port gains `createIssue`/`createGist`; the infra adapter is the only place
  `gh` is invoked. The app use case depends on the port, never on `gh` directly.
- Consumer: the CLI command renders the returned issue URL via `OutputPort`.

### Test strategy

- Domain unit tests for the body builder (threshold, metadata, error inclusion), written
  first.
- Application integration tests with fake `GitHub` + `FileSystem` ports for the
  issue/gist/error paths.
- A port type/contract test for the two new methods if the `tests/type` convention exists.

### Implementation order

Domain report builder → GitHub port methods + adapter → app use case → CLI command +
registration → tests at each step.

### Excluded scope

- Any background or automatic reporting — `phax report` is strictly user-invoked.
- Redaction/scrubbing of log contents beyond the existing `stderrExcerpt` truncation
  (note as a follow-up if relevant).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The final `createIssue`/`createGist` signatures and the `gh` subcommands used.
- The report body structure and the gist-vs-inline threshold value.
- How the target telemetry file is selected (run-id argument vs. latest daily journal).
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(cli): add phax report to open a GitHub issue from local telemetry

### Commit body

Add a user-triggered `phax report` command that assembles a structured issue body
(version/OS/command metadata, error reports, recent events) from a run's semantic.jsonl or
the latest daily journal, attaches the full log as a secret gist when it exceeds the issue
body limit, and opens an issue via the gh CLI. Adds createIssue/createGist to the GitHub
port and a pure domain body builder. Covered by domain unit tests and app integration
tests with fake ports.
