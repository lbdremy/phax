---
status: Approved
source-spec: docs/specs/18-gate-step-scheduling.md
approved:
  date: 2026-09-07
  baseline: 25f09a2
---

# Gate step scheduling

> Feed this `plan.md` to `phax extract-plan` to produce `phax-plan.json`, then
> run it with `phax run`. Source spec:
> [`docs/specs/18-gate-step-scheduling.md`](../specs/18-gate-step-scheduling.md)
> (approved 2026-09-04 against `main` @ `37405b9`). Planned 2026-09-07 against
> `main` @ `3e436e4`.

Implements spec 18. Each diagnostic of a diagnostic step (spec 16 / plan 54)
declares a `class`: an **invariant** fails the step on sight; a **completion**
diagnostic names one or more opaque scope tokens and fails the step only once
every scope it names is **closed** — otherwise it is recorded as **pending** and
does not fail the phase. A registered **scope provider** (`scopes` in
`phax.json`, next to `orient`) answers which scopes are closed from a thin
**plan projection** (ordered phase ids, each with its planned files, and the id
of the gated phase). The terminal phase closes every scope without a query.
`pending` becomes a third attribution result that never verifies a surface;
pending diagnostics are persisted with the attempt and shown to the fix-loop
agent as optional work. No new command.

---

## Required commands

- (none)

Every gate step uses `pnpm` scripts already present in `package.json`; the plan
introduces no new tool, runtime, or CLI. JSON-schema regeneration runs through
`pnpm exec tsx`, already granted in `security.agentCommands`. No
`## Required PHAX security configuration changes` section is needed.

---

## Technical arbitrations

Resolved with the human on 2026-09-07; recorded so phases execute without
re-litigating them.

- **The projection carries `plannedFilesToCreate ∪ plannedFilesToEdit` only,
  never `optionalFilesToEdit`.** Abandons: a scope whose only later toucher is
  an optional file (a barrel, a test factory) is judged closed one phase early,
  so a completion diagnostic can go red before that optional touch. Accepted:
  it matches spec 19's stated derivation and reconciliation's meaning of
  "planned", so the one projection serves both specs verbatim, and optional
  files are rarely where a missing wiring lives.
- **Scope-provider failures and the missing-provider configuration error fail
  the gate through the fix loop**, as `GateFailedError` with the reason in the
  attempt log — exactly plan 54's treatment of a diagnostics provider error.
  Abandons: fast failure on a misconfigured `phax.json`; the fix budget (one
  attempt in this repo) burns before the run stops. Accepted: the provider runs
  in the phase worktree, so a repo-held scope map can be broken by the agent's
  own change, which is what the loop repairs. Consequence: the provider is
  queried **per gate attempt inside `runGates`**, not once per phase.
- **Actual diffs stay out of the projection.** Closure is a statement about
  *later* phases, for which the plan is the only source; the "opened" side is
  already grounded by the auditor running on the real worktree, and spec 18's
  acceptance criterion says stdin carries the planned files "and nothing else".
  Abandons: nothing a closure rule can use.

Decisions taken without a question (one viable option each):

- **Diagnostic shape is a discriminated union on `class`.** The `invariant`
  variant has no `scopes` key; the `completion` variant requires a non-empty
  `scopes` list. A completion diagnostic without scopes (or with an empty list)
  is rejected at decode, as is a diagnostic without `class`. The document
  decoder stays lenient on unknown keys exactly as today, so an invariant
  carrying `scopes` decodes as an invariant with the key ignored.
- **`class` is required, not defaulted** (spec §5.1 "SHALL require"). Existing
  diagnostic providers must add it; `examples/hello-world/audit.mjs` is updated
  in phase-01.
- **Pending rides the error, the events and the outcome as required fields**:
  `GateFailedError.pending`, `GateFailed.pending`, `GatePassed.pending`,
  `GateOutcome.pending` (empty for plain steps) — plan 54's "diagnostics ride
  the event" arbitration extended to the third result.
- **Pending is persisted as `checks-attempt-NN.pending.json`** next to the
  attempt log whenever an attempt has at least one pending diagnostic, on both
  the passing and the failing path, so it rides the run record like the
  diagnostics document.
- **The green-with-pending summary is a `[phax]` stderr line** written by
  `executePlan` after the gate, following the existing orient-warning pattern;
  no new output surface.
- **One projection, two consumers**: `projectPhases(...)` in
  `src/domain/plan/projection.ts` returns the ordered `{ id, files }` list;
  the scopes request adds `phase`. Spec 19 will reuse `projectPhases` unchanged.
- **The provider transport is shared with orient**: the stdin-JSON /
  stdout-JSON / exit-0 runner in `src/app/orient.ts` is extracted to
  `src/app/providerQuery.ts` and parameterised on the error constructor, so
  `scopes` and `orient` cannot drift.

## Context

Since plan 54 (spec 16) a gate step may declare `output: "diagnostics"`;
`runGates` (`src/app/gates.ts:63-215`) decodes the document from stdout with
`decodeGateDiagnosticsDocument` (`src/schemas/gateDiagnostics.ts`), fails the
step on a non-empty list, persists the document via `diagnosticsPathFor`
(`src/domain/gate/diagnosticsPath.ts`), records `{ command, surface, result:
"pass" | "fail" }` in `gate-attribution.json` (`src/schemas/gateAttribution.ts`),
and fails with `GateFailedError { command, exitCode, logPath, diagnostics,
stderrExcerpt? }` (`src/domain/errors.ts:62-70`). `runGatesWithFixLoop`
(`src/app/fixLoop.ts:54-306`) maps that to the `GateFailed` event
(`src/domain/events.ts:82-91`) and builds the prompt with the pure
`buildFixPrompt` (`src/domain/gate/fixPrompt.ts`). `verifiedSurfaces`
(`src/domain/gate/verifiedSurfaces.ts`) counts a surface verified only when
every step of it passed, and feeds the record manifest (`src/app/writeRecord.ts`)
and the final report (`src/app/finalReport.ts`).

The orient provider (spec 17 / plans 17, 49) is the transport model: `orient:
{ command }` in `phax.json` (`OrientConfigSchema`, `src/schemas/phaxConfig.ts:17-24`),
merged as a scalar override in `src/domain/config/mergeLayers.ts:134-136,240`,
passed through `ResolvedConfig.orient` (`src/app/loadConfig.ts:275`), and
queried by `src/app/orient.ts` (`runOrientQuery`: split on whitespace, no
shell, JSON on stdin, exit 0 + JSON on stdout, typed `OrientProviderError`
otherwise). `executePlan` (`src/app/executePlan.ts:796-812`) builds the orient
request from the phase's planned files. `tests/integration/orient.test.ts` and
`tests/unit/schemas/orientConfig.test.ts` are the test models.

### Architecture seams (audited 2026-09-07 against `main` @ `3e436e4`)

- **Gate selection and terminal-ness**: `selectGateSteps(steps, isTerminal)`
  (`src/domain/gate/selectSteps.ts`) is called at `executePlan.ts:1096` with
  `isFinal = i === plan.phases.length - 1` (`:608`); the same flag decides
  "terminal closes every scope".
- **`runGates` callers**: `runGatesWithFixLoop` (`fixLoop.ts:132`) and
  `adaptGateRun` (`src/app/eventAdapter.ts:144-163`). Every test that builds
  `RunGatesOptions` / `RunGatesWithFixLoopOptions` literals:
  `tests/integration/gates.test.ts`, `fixLoop.test.ts`, `eventAdapter.test.ts`.
- **Event samples**: `tests/unit/events.test.ts:61-70` holds one sample per
  event and a `fingerprint` switch at `:134-150` (`GatePassed` keyed on
  `attempt`, `GateFailed` on `command:exitCode:attempt:diagnostics.length`).
  Reducer (`src/domain/reducer.ts:341-353`) and matrix read only `type` and
  `attempt`.
- **Diagnostic fixtures that will need `class`**:
  `tests/unit/schemas/gateDiagnostics.test.ts`, `tests/unit/fixPrompt.test.ts`
  (3), `tests/integration/gates.test.ts:244-420` ("diagnostics output"),
  `tests/integration/fixLoop.test.ts:196-230`,
  `examples/hello-world/audit.mjs` (checked by
  `tests/integration/exampleProviders.test.ts:87-115`).
- **Generated schemas**: `phax.schema.json` / `phax.user.schema.json` at the
  repo root come from `getPhaxConfigJsonSchema` /
  `getPhaxUserOverlayJsonSchema` (`src/schemas/phaxConfig.ts:211,253`); last
  regenerated in `dce28c8`. `tests/unit/phaxConfigJsonSchema.test.ts` and
  `tests/unit/phaxUserOverlaySchema.test.ts` assert on their content.
- **Plan projection input**: `PhaxPlanPhase` (`src/schemas/phaxPlan.ts:80`)
  with `plannedFilesToCreate` / `plannedFilesToEdit` / `optionalFilesToEdit`
  (`:25-27`). `src/domain/plan/` holds `finalize.ts` and `parsePlanMarkdown.ts`.
- **Records**: `assembleRecord` carries every phase-folder file, so a
  `checks-attempt-NN.pending.json` rides the record with no records-side
  change; `writeRecord.ts:241` decodes the attribution, so the third result
  value flows through the existing decoder.
- **Docs**: README gate-profile block (`README.md:129-154`, `output` bullet at
  `:150`), "Orient provider" subsection (`:158-175`); `src/cli/cliDocs.ts:21`
  (run long help) mentions surfaces; `docs/state-machine.md:143` says
  `GatePassed` "carries `attempt`".

---

## phase-01 — Diagnostic class and scope provider registration {#phase-01-class-and-scopes-config}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

Give every diagnostic a `class` (invariant or completion-with-scopes) and let
`phax.json` register a `scopes` provider. Pure schema and config work,
behaviour-preserving in the runner: a completion diagnostic still fails the
step in this phase.

### Detailed instructions

- **Diagnostic schema** (`src/schemas/gateDiagnostics.ts`):
  - Keep the four existing fields (`rule`, `location { file, line? }`,
    `message`, `repair`) as a shared field set.
  - `InvariantDiagnosticSchema = Schema.Struct({ class: Schema.Literal("invariant"), ...fields })`.
  - `CompletionDiagnosticSchema = Schema.Struct({ class: Schema.Literal("completion"), scopes: Schema.NonEmptyArray(Schema.NonEmptyString), ...fields })`.
  - `GateDiagnosticSchema = Schema.Union(InvariantDiagnosticSchema, CompletionDiagnosticSchema)`.
  - Export `InvariantDiagnostic`, `CompletionDiagnostic` and the (now union)
    `GateDiagnostic` types; keep `GateDiagnosticsDocumentSchema`,
    `decodeGateDiagnosticsDocument`, `encodeGateDiagnosticsDocument` with their
    current names and leniency (no `onExcessProperty` option).
- **Scopes config** (`src/schemas/phaxConfig.ts`):
  - `export const ScopesConfigSchema = Schema.Struct({ command: Schema.NonEmptyString.annotations({ description }) })`
    right after `OrientConfigSchema`, with a description in the same voice as
    the orient one: split on whitespace, no shell; phax writes the plan
    projection `{"phase", "phases": [{"id", "files"}]}` on stdin before each
    non-terminal phase gate that has a diagnostic step and expects exit 0 and
    `{"closed": ["<scope>", ...]}` on stdout; a completion diagnostic fails
    the step only when every scope it names is closed, otherwise it is pending;
    the terminal phase closes every scope without a query. Export `ScopesConfig`.
  - Add `scopes: Schema.optional(ScopesConfigSchema)` to `PhaxConfigSchema`
    and `PhaxUserOverlaySchema` immediately after `orient`; add
    `readonly scopes?: ScopesConfig` to `ResolvedConfig` after `orient`.
  - Extend `GATE_OUTPUT_DESCRIPTION` so the documented document shape reads
    `{"diagnostics": [{"rule", "class": "invariant"|"completion", "scopes"?: [...], "location": {"file", "line"?}, "message", "repair"}]}`
    and add one sentence: a completion diagnostic names ≥ 1 scope and is
    pending until every scope is closed by the `scopes` provider.
- **Layer merge** (`src/domain/config/mergeLayers.ts`): mirror the orient
  scalar override (`:134-136`, `:240`) for `scopes` — local user > global
  user > project, `command` required when the block is present.
- **Resolution** (`src/app/loadConfig.ts:275`): pass `scopes` through next to
  `orient`.
- **Runner text only** (`src/app/gates.ts:22-23`): update
  `DIAGNOSTICS_EXPECTED_SHAPE` to the new shape string. No logic change.
- **Regenerate** `phax.schema.json` and `phax.user.schema.json` from the Effect
  schemas with a `pnpm exec tsx` one-liner calling `getPhaxConfigJsonSchema()`
  / `getPhaxUserOverlayJsonSchema()` and writing `JSON.stringify(schema, null, 2) + "\n"`.
  Do not hand-edit the generated JSON; confirm `pnpm format:check` is clean.
- **Example provider**: add `class: "invariant"` to the diagnostic emitted by
  `examples/hello-world/audit.mjs`.
- **Tests**:
  - `tests/unit/schemas/gateDiagnostics.test.ts`: an invariant decodes; a
    completion with `scopes: ["core"]` decodes with `class === "completion"`;
    a completion with no `scopes` is rejected; a completion with `scopes: []`
    is rejected; a diagnostic with no `class` is rejected; a diagnostic with
    `class: "advisory"` is rejected; encode round-trips both variants.
  - New `tests/unit/schemas/scopesConfig.test.ts` mirroring
    `orientConfig.test.ts`: valid block decodes; empty command rejected;
    unknown key rejected; `decodePhaxConfig` and `decodePhaxUserOverlay`
    accept `scopes` next to `orient`.
  - `tests/unit/phaxConfigJsonSchema.test.ts`,
    `tests/unit/phaxUserOverlaySchema.test.ts`: `scopes.command` is present,
    not required, and carries a description naming `closed`.
  - `tests/unit/mergeLayers.test.ts`: a user-layer `scopes.command` overrides
    the project one; absent everywhere → absent.
  - Add `class: "invariant"` to every existing diagnostic fixture listed in
    the seams audit so the suite compiles and passes unchanged.

### Planned files to create

- `tests/unit/schemas/scopesConfig.test.ts`

### Planned files to edit

- `src/schemas/gateDiagnostics.ts`
- `src/schemas/phaxConfig.ts`
- `src/domain/config/mergeLayers.ts`
- `src/app/loadConfig.ts`
- `src/app/gates.ts`
- `phax.schema.json`
- `phax.user.schema.json`
- `examples/hello-world/audit.mjs`
- `tests/unit/schemas/gateDiagnostics.test.ts`
- `tests/unit/phaxConfigJsonSchema.test.ts`
- `tests/unit/phaxUserOverlaySchema.test.ts`
- `tests/unit/mergeLayers.test.ts`
- `tests/unit/fixPrompt.test.ts`
- `tests/integration/gates.test.ts`
- `tests/integration/fixLoop.test.ts`

### Optional files that may be edited

- `tests/unit/loadConfig.test.ts`
- `tests/integration/exampleProviders.test.ts`
- `tests/unit/schemas/orientConfig.test.ts`
- `src/app/initProject.ts`

### Boundary contracts

- Producer: `src/schemas/gateDiagnostics.ts` exposes `GateDiagnostic` as a
  union discriminated on `class`, plus `CompletionDiagnostic`. Consumers:
  phase-02 (scheduling rule), phase-03 (runner), phase-04 (prompt).
- Producer: `src/schemas/phaxConfig.ts` exposes `ScopesConfig` and
  `ResolvedConfig.scopes?`. Consumers: phase-02 (query), phase-03 (runner
  wiring in `executePlan`).

### Test strategy

Unit tests on both schemas and the merge rule, written first. Fixture updates
are mechanical. No behaviour change to verify at integration level.

### Implementation order

1. Diagnostic union + its test, then fix the fixtures the type change breaks.
2. `ScopesConfigSchema`, config/overlay keys, `ResolvedConfig`, merge, load.
3. `GATE_OUTPUT_DESCRIPTION` and `DIAGNOSTICS_EXPECTED_SHAPE` strings.
4. Regenerate JSON schemas; JSON-schema tests. 5. Example provider.

### Excluded scope

- Any scheduling logic, projection, provider query, or `pending` result
  (phases 02–04).

### Verification

- The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The exported names and exact decoded shapes from
  `src/schemas/gateDiagnostics.ts` (both variants) and `ScopesConfig`.
- Which fixtures needed `class` added.
- The one-liner used to regenerate the JSON schemas.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(gate): classify diagnostics and register a scopes provider

### Commit body

Every diagnostic now declares `class: "invariant" | "completion"`; a completion
diagnostic must name at least one scope token and is rejected at decode without
one. `phax.json` (and the user overlay) may register a `scopes: { command }`
provider next to `orient`, merged and resolved the same way. Behaviour-
preserving: the runner still fails a step on any diagnostic. JSON schemas
regenerated; the hello-world audit example declares its diagnostic invariant.

---

## phase-02 — Plan projection, scope provider query and scheduling rule {#phase-02-projection-query-rule}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

Build the pieces the runner will compose, each testable on its own: the plan
projection shared with spec 19, the scope provider query on the orient
transport, the pure invariant / completion / pending rule, the `pending`
attribution value, and the pending document schema. Nothing is wired into
`runGates` yet.

### Detailed instructions

- **Projection** — create `src/domain/plan/projection.ts`:
  - `export interface ProjectedPhase { readonly id: string; readonly files: readonly string[] }`.
  - `export function projectPhases(phases: ReadonlyArray<Pick<PhaxPlanPhase, "id" | "plannedFilesToCreate" | "plannedFilesToEdit">>): readonly ProjectedPhase[]`
    — order preserved; `files` = create then edit, deduplicated, order
    preserved; `optionalFilesToEdit` is not read (arbitration).
  - `export interface ScopesRequest { readonly phase: string; readonly phases: readonly ProjectedPhase[] }`
    and `export function makeScopesRequest(phases, gatedPhaseId: string): ScopesRequest`.
    Nothing else from the plan crosses (no model, effort, anchors, commit).
- **Response schema** — create `src/schemas/scopes.ts`:
  `ScopesResponseSchema = Schema.Struct({ closed: Schema.Array(Schema.NonEmptyString) })`,
  `ScopesResponse` type, `decodeScopesResponse = Schema.decodeUnknownEither(...)`.
- **Shared transport** — create `src/app/providerQuery.ts` by extracting
  `runOrientQuery` and `excerpt` from `src/app/orient.ts`:
  `runProviderQuery<T, E>(command: string, cwd: string, requestBody: unknown, decode, makeError: (failure: { message: string; exitCode?: number; stderrExcerpt?: string }) => E): Effect<Either<T, E>, never, Shell>`
  keeping the exact failure taxonomy (empty command, shell error, non-zero
  exit with bounded stderr excerpt, invalid JSON, schema mismatch via
  `formatParseError`). Rewire `orient.ts` onto it so `queryOrientIndex` /
  `expandOrientRow` keep their signatures and messages byte-for-byte
  (`tests/integration/orient.test.ts` must pass untouched). Keep `excerpt`
  importable from wherever `executePlan.ts:84` and the tests already import it
  (re-export from `orient.ts` if you move it) so `pnpm knip` stays clean.
- **Error** (`src/domain/errors.ts`): `ScopesProviderError` tagged error with
  `message`, `exitCode?`, `stderrExcerpt?`, next to `OrientProviderError`.
- **Query** — create `src/app/scopes.ts`:
  `queryClosedScopes(config: ScopesConfig, request: ScopesRequest, cwd: string): Effect<Either<ScopesResponse, ScopesProviderError>, never, Shell>`
  built on `runProviderQuery`, messages prefixed `Scope provider …`.
- **Scheduling rule** — create `src/domain/gate/scheduleDiagnostics.ts`:
  - `export type ScopeClosure = { kind: "all" } | { kind: "closed"; closed: ReadonlySet<string> } | { kind: "unavailable" }`
    (`all` = terminal phase; `unavailable` = no provider registered).
  - `export interface PendingDiagnostic { readonly diagnostic: CompletionDiagnostic; readonly openScopes: readonly string[] }`.
  - `export type ScheduleResult = { kind: "scheduled"; failing: readonly GateDiagnostic[]; pending: readonly PendingDiagnostic[] } | { kind: "missing-provider"; completion: readonly CompletionDiagnostic[] }`.
  - `export function scheduleDiagnostics(diagnostics: readonly GateDiagnostic[], closure: ScopeClosure): ScheduleResult`:
    every invariant → `failing`; a completion with closure `all`, or whose
    scopes are all in `closed` → `failing`; otherwise → `pending` with
    `openScopes` = the scopes not in `closed`, in declaration order; closure
    `unavailable` with at least one completion → `missing-provider` listing
    them (invariants present in the same document are irrelevant to the
    verdict: the step fails either way). Input order preserved within each
    list.
- **Attribution** (`src/schemas/gateAttribution.ts`): `result:
  Schema.Literal("pass", "fail", "pending")`. `verifiedSurfaces` already
  counts only `"pass"`; add a unit test proving a `pending` step keeps its
  surface unverified.
- **Pending document** — create `src/schemas/gatePending.ts`:
  `GatePendingDocumentSchema = Schema.Struct({ closed: Schema.Array(Schema.NonEmptyString), steps: Schema.Array(Schema.Struct({ command: Schema.NonEmptyString, pending: Schema.NonEmptyArray(Schema.Struct({ diagnostic: CompletionDiagnosticSchema, openScopes: Schema.NonEmptyArray(Schema.NonEmptyString) })) })) })`
  with `decodeGatePendingDocument` / `encodeGatePendingDocument`.
- **Path helper** (`src/domain/gate/diagnosticsPath.ts`): add
  `pendingPathFor(attemptLogPath)` → `checks-attempt-01.pending.json`, same
  `.log`-stripping rule as `diagnosticsPathFor`.
- **Tests** (all written first):
  - New `tests/unit/planProjection.test.ts`: order, create-then-edit,
    dedup, optional files excluded, `makeScopesRequest` shape has exactly
    `phase` and `phases` and each phase exactly `id` and `files`
    (`Object.keys` assertions — spec AC "Provider receives the projection").
  - New `tests/unit/scheduleDiagnostics.test.ts`: invariant fails under every
    closure kind; completion `["core","adapters"]` with `closed {core}` →
    pending with `openScopes ["adapters"]`; with `closed {core, adapters}` →
    failing; with `all` → failing; `unavailable` + completion →
    `missing-provider`; `unavailable` + invariants only → scheduled failing;
    mixed document splits correctly.
  - New `tests/unit/schemas/scopes.test.ts`, `tests/unit/schemas/gatePending.test.ts`.
  - `tests/unit/diagnosticsPath.test.ts`: `pendingPathFor` cases.
  - `tests/unit/gateAttribution.test.ts`: `pending` decodes; `"skipped"` is
    rejected. `tests/unit/verifiedSurfaces.test.ts`: pending never verifies.
  - New `tests/integration/scopes.test.ts` mirroring `orient.test.ts`: happy
    path asserts `calls[0].stdin === JSON.stringify(request)` and the decoded
    `closed`; non-zero exit → `ScopesProviderError` with `exitCode` and
    excerpt; invalid JSON; schema mismatch (`closed: [1]`); whitespace-only
    command.

### Planned files to create

- `src/domain/plan/projection.ts`
- `src/schemas/scopes.ts`
- `src/schemas/gatePending.ts`
- `src/app/providerQuery.ts`
- `src/app/scopes.ts`
- `src/domain/gate/scheduleDiagnostics.ts`
- `tests/unit/planProjection.test.ts`
- `tests/unit/scheduleDiagnostics.test.ts`
- `tests/unit/schemas/scopes.test.ts`
- `tests/unit/schemas/gatePending.test.ts`
- `tests/integration/scopes.test.ts`

### Planned files to edit

- `src/app/orient.ts`
- `src/domain/errors.ts`
- `src/schemas/gateAttribution.ts`
- `src/domain/gate/diagnosticsPath.ts`
- `tests/unit/diagnosticsPath.test.ts`
- `tests/unit/gateAttribution.test.ts`
- `tests/unit/verifiedSurfaces.test.ts`

### Optional files that may be edited

- `src/app/executePlan.ts`
- `tests/integration/orient.test.ts`
- `tests/unit/gateAttribution.reader.test.ts`
- `src/domain/gate/verifiedSurfaces.ts`

### Boundary contracts

- Producer: `src/domain/plan/projection.ts` — `projectPhases`,
  `makeScopesRequest`. Consumers: phase-03 (`executePlan` builds the request),
  spec 19 later (`projectPhases` only).
- Producer: `src/app/scopes.ts` — `queryClosedScopes` over the `Shell` port,
  never failing (Either). Consumer: phase-03 runner.
- Producer: `src/domain/gate/scheduleDiagnostics.ts` — `ScopeClosure`,
  `scheduleDiagnostics`, `PendingDiagnostic`. Consumers: phase-03 runner,
  phase-04 prompt.
- Producer: `src/schemas/gatePending.ts` + `pendingPathFor`. Consumers:
  phase-03 (writer), records (already carry every phase-folder file).

### Test strategy

Domain: unit tests on projection, rule, path helper, schemas. Application:
integration test on the query with the fake shell. Write every test before its
implementation; the orient integration test is the regression guard for the
transport extraction.

### Implementation order

1. Projection + test. 2. Scheduling rule + test. 3. Attribution / pending
schemas + path helper + tests. 4. Transport extraction, orient rewired, orient
tests green. 5. `ScopesProviderError`, `queryClosedScopes` + integration test.

### Excluded scope

- Calling any of this from `runGates`, the fix loop or `executePlan`
  (phase-03).
- Prompt rendering and docs (phase-04).

### Verification

- The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The exported names and signatures of every new module, with paths.
- The exact `ScopesRequest` JSON emitted for a three-phase sample.
- Where `excerpt` now lives and what re-exports it.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(gate): add the plan projection, scopes query and scheduling rule

### Commit body

Introduce the pieces gate scheduling composes: `projectPhases` /
`makeScopesRequest` (ordered phase ids with their planned create+edit files
and the gated phase — the projection spec 19 will share), a `scopes` provider
query on the transport extracted from orient (`runProviderQuery`), the pure
`scheduleDiagnostics` rule (invariant always fails; completion fails when every
named scope is closed or at the terminal phase, otherwise pending; no provider
plus a completion diagnostic is a missing-provider outcome), `pending` as a
third attribution result that never verifies a surface, and the persisted
pending-document schema with its `checks-attempt-NN.pending.json` path.
Nothing is wired into the runner yet. Covered by unit and integration tests.

---

## phase-03 — Schedule diagnostics in the runner {#phase-03-runner-scheduling}

**Recommended model:** claude-opus-4-8
**Recommended effort:** medium

Make `runGates` honour the class of each diagnostic: query the scope provider
per attempt when a non-terminal gate has a diagnostic step, split findings into
failing and pending, record `pending` in the attribution, persist the pending
document, and carry pending on the error, the events and the outcome. Wire the
scheduling inputs from `executePlan` through the fix loop.

### Detailed instructions

- **Scheduling input** (`src/app/gates.ts`): add to `RunGatesOptions` a
  required
  `readonly scheduling: { readonly isTerminal: boolean; readonly scopesProvider: ScopesConfig | undefined; readonly request: ScopesRequest }`.
  Export the type as `GateScheduling`.
- **Closure resolution**, once per `runGates` call, before the step loop:
  - `isTerminal` → `{ kind: "all" }` (provider never consulted).
  - no step with `output === "diagnostics"` among `steps` → skip entirely
    (closure is never read).
  - `scopesProvider === undefined` → `{ kind: "unavailable" }`.
  - otherwise call `queryClosedScopes(scopesProvider, request, cwd)`. Append to
    `logLines`: `$ <provider command>` and `stdin: <request JSON>`, then the
    response or the failure line, then a blank line — the attempt log stays a
    faithful transcript. On `Left`: write the log and an attribution with the
    empty step list, then fail with
    `GateFailedError { message: "Scope provider \"<command>\" failed: <reason>", command: <provider command>, exitCode: error.exitCode ?? 1, logPath, diagnostics: [], pending: [], stderrExcerpt? }`
    (arbitration: through the fix loop). On `Right`: closure
    `{ kind: "closed", closed: new Set(response.closed) }`.
- **Diagnostic step with a non-empty document** (replace the "non-empty list
  fails" branch at `gates.ts:185-194`): run `scheduleDiagnostics(document.diagnostics, closure)`.
  - `missing-provider` → log
    `configuration error: gate step "<command>" returned a completion diagnostic but no "scopes" provider is registered in phax.json`,
    attribution `fail`, persist the diagnostics document, fail with
    `diagnostics: []`, `pending: []` and a `message` equal to that line
    (spec §6 wording) — the raw-log prompt path, like a provider error.
  - `failing.length > 0` → attribution `fail`, persist the document, add this
    step's `pending` to the attempt's pending list, fail with
    `diagnostics: failing` and `pending: <attempt's pending list>`.
  - `failing.length === 0` (so `pending.length > 0`) → attribution `pending`,
    add to the attempt's pending list, **continue** to the next step; no
    diagnostics document is written for this step.
  - Empty document and plain steps: unchanged (still `pending: []`).
- **Pending persistence**: whenever the attempt's pending list is non-empty,
  write `pendingPathFor(attemptLogPath)` with
  `encodeGatePendingDocument({ closed: [...closure.closed].toSorted(), steps })`
  on both the success path (before returning) and inside `failGate`.
- **Outcome / error / events** (required fields, empty for plain steps):
  - `GateOutcome.pending: readonly PendingStep[]` where
    `PendingStep = { command: string; pending: readonly PendingDiagnostic[] }`
    (define next to `GateOutcome`).
  - `GateFailedError.pending: readonly PendingStep[]` (`src/domain/errors.ts`).
  - `GatePassed.pending` and `GateFailed.pending: readonly PendingStep[]`
    (`src/domain/events.ts`); update the sample and fingerprint in
    `tests/unit/events.test.ts` (`GatePassed` → `${type}:${attempt}:${pending.length}`,
    `GateFailed` appends `:${pending.length}`). Reducer and matrix need no
    change.
- **Callers**:
  - `runGatesWithFixLoop` (`src/app/fixLoop.ts`): add `scheduling` to
    `RunGatesWithFixLoopOptions`, pass it to `runGates`, put
    `gateResult.right.pending` on `GatePassed` and `error.pending` on
    `GateFailed`. `buildFixPrompt` input is unchanged in this phase.
  - `adaptGateRun` (`src/app/eventAdapter.ts:144`): add a `scheduling`
    parameter after `attemptLogPath`, forward it, map `pending` onto both
    events.
  - `executePlan` (`src/app/executePlan.ts:1096-1110`): pass
    `scheduling: { isTerminal: isFinal, scopesProvider: config.scopes, request: makeScopesRequest(plan.phases, phase.id) }`.
- **Tests**:
  - `tests/integration/gates.test.ts`: add a `scheduling(...)` helper
    (defaults: non-terminal, no provider, request for the single fake phase)
    and a `describe("scheduling")` block, each case with the fake shell
    answering the provider command from `fakeShell.impl.setResponse`:
    - invariant fails whatever the provider answers (AC "Invariant fails at
      every phase");
    - completion `["core","adapters"]` + provider `{"closed":["core"]}` →
      no error, attribution `pending`, `outcome.pending[0].pending[0].openScopes` is
      `["adapters"]`, `checks-attempt-01.pending.json` written with
      `closed: ["core"]`, no diagnostics file (AC "Completion is pending while
      a scope is open");
    - provider `{"closed":["core","adapters"]}` → `GateFailedError` with that
      diagnostic in `diagnostics` and `pending: []` (AC "Completion fails once
      all its scopes are closed");
    - `isTerminal: true` → fails, and `fakeShell.impl.calls` contains no
      provider call (AC "Terminal phase closes every scope");
    - the provider call's `stdin` equals `JSON.stringify(request)` and the
      call precedes every step (AC "Provider receives the projection", runner
      side);
    - no provider + completion → `GateFailedError` whose message names
      `"scopes"` and `phax.json`, attribution `fail` (AC "Missing provider is
      a configuration error");
    - provider exits 1 → `GateFailedError` naming the provider command, no
      step ran, attribution has no steps;
    - provider prints non-JSON → same, message says invalid JSON;
    - one invariant + one open completion in one document →
      `error.diagnostics` has the invariant only, `error.pending` the
      completion (AC "Mixed findings split", data side);
    - pending step followed by a failing plain step → the error carries the
      earlier pending and the pending file is written;
    - existing plain-step tests keep passing with `pending` empty.
  - `tests/integration/eventAdapter.test.ts`: `GatePassed` / `GateFailed`
    carry `pending`.
  - `tests/integration/fixLoop.test.ts`: pass `scheduling` in the options
    helper; existing assertions unchanged.
  - `tests/integration/executePlan.test.ts`: existing configs have no
    `scopes`, so behaviour is unchanged; only compile fixes if any.

### Planned files to create

- (none)

### Planned files to edit

- `src/app/gates.ts`
- `src/app/fixLoop.ts`
- `src/app/eventAdapter.ts`
- `src/app/executePlan.ts`
- `src/domain/errors.ts`
- `src/domain/events.ts`
- `tests/integration/gates.test.ts`
- `tests/integration/eventAdapter.test.ts`
- `tests/integration/fixLoop.test.ts`
- `tests/unit/events.test.ts`

### Optional files that may be edited

- `tests/integration/executePlan.test.ts`
- `tests/integration/orientBriefArtifact.test.ts`
- `tests/integration/dispatcher.test.ts`
- `tests/integration/stateMachineContract.test.ts`
- `tests/unit/reducer.test.ts`
- `docs/state-machine.md`

### Boundary contracts

- Consumer: `runGates` needs, per attempt, whether the phase is terminal, the
  registered provider (if any) and the projection request. Producer:
  `executePlan` builds `GateScheduling` from `isFinal`, `config.scopes` and
  `makeScopesRequest(plan.phases, phase.id)`, threaded through
  `runGatesWithFixLoop`.
- Producer: `runGates` fails with `GateFailedError { …, diagnostics: failing, pending }`
  and succeeds with `GateOutcome { attemptLogPath, pending }`. Consumers:
  phase-04 (prompt renders `pending`; `executePlan` prints the summary).

### Test strategy

Integration tests on `runGates` with the fake shell and fake fs, written before
the runner change (the twelve cases above). Event sample test for the new
fields. No end-to-end test yet (phase-04).

### Implementation order

1. Error / event / outcome fields + samples test. 2. `GateScheduling` option
and caller threading (compile-green with the old verdict). 3. Closure
resolution + provider-error path + tests. 4. Scheduling branch + pending
attribution + pending file + tests.

### Excluded scope

- Rendering pending diagnostics in the fix prompt, the green-with-pending
  summary line, docs and the example provider (phase-04).

### Verification

- The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The final `RunGatesOptions`, `GateOutcome`, `GateFailedError`, `GatePassed`
  and `GateFailed` field lists.
- The exact log lines written for the provider query and for each failure
  kind, and the exact `pending.json` layout as written.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(gate): schedule completion diagnostics against closed scopes

### Commit body

Before a non-terminal gate that has a diagnostic step, `runGates` asks the
registered `scopes` provider which scopes are closed (the plan projection on
stdin) and splits each diagnostics document: invariants and completion
diagnostics whose scopes are all closed fail the step; the rest are pending.
A step with only pending diagnostics records `pending` in the attribution and
does not fail the phase; pending findings are persisted as
`checks-attempt-NN.pending.json`. The terminal phase closes every scope without
a query. A provider failure, or a completion diagnostic with no provider
registered, fails the gate through the fix loop with the reason in the attempt
log. `GateFailedError`, `GatePassed`, `GateFailed` and the gate outcome carry
the pending list. Covered by integration tests on the runner.

---

## phase-04 — Pending in the fix prompt, run summary, docs and example {#phase-04-prompt-summary-docs}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

Show pending diagnostics to the fix-loop agent as optional work, print the
green-with-pending summary after a phase gate, prove the projection end to end
through `executePlan`, and document the feature with a working example
provider.

### Detailed instructions

- **Prompt** (`src/domain/gate/fixPrompt.ts`): add
  `readonly pending: readonly PendingStep[]` to `BuildFixPromptInput`. When
  the flattened pending list is non-empty, append — in **both** branches,
  before `## Required action` — a section (wording indicative, presence and
  the optional / not-required statement normative):

  ```
  ## Pending (optional — not required to pass this gate)

  These completion diagnostics name scopes a later phase is planned to close.
  You may address them now if it is cheap; the gate does not require it.

  - <rule> at <file>[:<line>] — <message> (scopes still open: <a>, <b>)
    repair guide: <repair>
  ```

  and, in the diagnostics branch, change the required-action sentence to
  "Read each repair guide above before changing code, then fix every
  diagnostic listed under **Diagnostics**." When `pending` is empty both
  branches stay byte-for-byte what they are today.
- **Fix loop** (`src/app/fixLoop.ts`): pass `pending: error.pending`.
- **Summary line** (`src/app/executePlan.ts`, right after
  `runGatesWithFixLoop` returns): when `outcome.pending` is non-empty write
  `[phax] phase "<id>" gate: green — <n> completion diagnostic(s) pending (scopes still open: <sorted, deduplicated open scopes>)\n`
  to `process.stderr`, following the orient-warning pattern at `:833`.
- **End-to-end projection test** — create
  `tests/integration/scopesScheduling.test.ts` modelled on
  `tests/integration/orientBriefArtifact.test.ts`: a three-phase plan
  (`phase-01` creates `src/core/billing/port.ts`, `phase-02` edits
  `src/core/billing/invoice.ts` with an optional `src/index.ts`, `phase-03`
  creates `src/adapters/billing/stripe.ts`), a config with
  `scopes: { command: "scopes-provider" }` and a `standard` profile holding
  one `output: "diagnostics"` step; the fake shell answers the diagnostics
  step with an empty document and the provider with `{"closed": []}`. Assert:
  - the provider was called exactly twice (phases 01 and 02, never 03);
  - the phase-02 call's `stdin` parses to exactly
    `{ phase: "phase-02", phases: [{ id: "phase-01", files: ["src/core/billing/port.ts"] }, { id: "phase-02", files: ["src/core/billing/invoice.ts"] }, { id: "phase-03", files: ["src/adapters/billing/stripe.ts"] }] }`
    — `Object.keys` deep-equal, optional file absent (AC "Provider receives
    the projection");
  - the run completes.
- **Prompt tests**: `tests/unit/fixPrompt.test.ts` — empty `pending`
  reproduces today's prompts in both branches; one pending renders the
  section with the open scopes and the repair guide; the diagnostics branch
  keeps the invariant under `## Diagnostics` only.
  `tests/integration/fixLoop.test.ts`: a document with one invariant and one
  open completion produces a prompt to the fake backend that lists the
  invariant under `## Diagnostics`, the completion under `## Pending`, and
  contains "not required to pass" (AC "Mixed findings split"). The green path
  with a pending-only step dispatches `GatePassed` and the fix loop is not
  entered.
- **Example** (`examples/hello-world/`): add `scopes.mjs` — reads the request
  from stdin, maps each file to a scope token by its first path segment under
  `src/` (`src/greet.ts` → `greet`), answers
  `{ "closed": [<scopes touched by phases up to and including the gated one that no later phase touches>] }`,
  exits 0. Add `"scopes": { "command": "node ./scopes.mjs" }` to
  `examples/hello-world/phax.json`. Extend
  `tests/integration/exampleProviders.test.ts`: the provider decodes with
  `decodeScopesResponse` on a two-phase request and closes the right scope;
  `phax.json` decodes with `scopes` present.
- **README**:
  - Gate-profile `output` bullet (`:150`): document `class`, `scopes`, the
    invariant / completion / pending rules, `checks-attempt-NN.pending.json`,
    and that `pending` never verifies a surface (`:154` sentence).
  - New "Scope provider" subsection after "Orient provider": the config block,
    the request (`phase`, `phases[].id`, `phases[].files` = planned create+edit
    files), the response (`closed`), the terminal rule, the missing-provider
    configuration error, and the provider-error behaviour (fails the gate,
    fix loop, attempt log).
- Do **not** edit `docs/specs/18-gate-step-scheduling.md`; completion is
  recorded with `phax artifact complete` after the run.

### Planned files to create

- `tests/integration/scopesScheduling.test.ts`
- `examples/hello-world/scopes.mjs`

### Planned files to edit

- `src/domain/gate/fixPrompt.ts`
- `src/app/fixLoop.ts`
- `src/app/executePlan.ts`
- `tests/unit/fixPrompt.test.ts`
- `tests/integration/fixLoop.test.ts`
- `tests/integration/exampleProviders.test.ts`
- `examples/hello-world/phax.json`
- `README.md`

### Optional files that may be edited

- `src/cli/cliDocs.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `docs/state-machine.md`
- `examples/hello-world/plan.md`
- `examples/hello-world/audit.mjs`

If `src/cli/cliDocs.ts` is touched (one sentence on pending in the `run` long
help), regenerate with `pnpm gen:usage-spec` and `pnpm docs:cli` in the same
commit; the drift tests fail otherwise.

### Boundary contracts

- Consumer: `src/app/fixLoop.ts` needs a prompt from a `GateFailedError` that
  now carries `pending`. Producer: `src/domain/gate/fixPrompt.ts`, pure.
- Consumer: the operator reading the run output needs to know a green gate
  left pending work. Producer: the `[phax]` stderr line in `executePlan`.

### Test strategy

Unit-test the prompt builder first (both branches, with and without pending),
then the fix-loop integration test through the fake backend, then the
end-to-end projection test through `executePlan`. Example provider covered by
the existing example-providers integration test. Docs have no test beyond
`pnpm format:check`.

### Implementation order

1. Prompt builder + unit tests. 2. Fix-loop wiring + integration test.
3. Summary line. 4. End-to-end projection test. 5. Example provider + test.
6. README.

### Excluded scope

- A plan-time auditor or advisory (spec 19).
- Deferring a scope to a future run (spec non-goal).
- Any change to the records CLI rendering of attribution results.

### Verification

- The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The final prompt layouts with pending (paste both branches).
- The exact summary line format.
- The provider stdin captured by the end-to-end test (paste it).
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(gate): surface pending diagnostics as optional work and document scopes

### Commit body

The fix prompt lists pending completion diagnostics under a "Pending" section
marked optional and not required to pass, and asks the agent to fix only the
diagnostics listed as failing; prompts without pending are unchanged. After a
green gate that left pending work, phax prints a one-line summary naming the
open scopes. An end-to-end test proves the scope provider receives exactly the
ordered phases with their planned create+edit files and the gated phase id,
and is not consulted at the terminal phase. The hello-world example gains a
`scopes.mjs` provider; the README documents the diagnostic classes, the
pending rules and the scope provider contract.
