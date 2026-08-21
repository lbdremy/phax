---
status: Draft
source-spec: docs/specs/16-external-gate-steps.md
---
# External Gate Steps — structured diagnostics

> Feed this `plan.md` to `phax extract-plan` to produce `phax-plan.json`, then
> run it with `phax run`. Source spec:
> [`docs/specs/16-external-gate-steps.md`](../specs/16-external-gate-steps.md)
> (re-approved 2026-08-21 against `main` @ `7b64e98`). Planned 2026-08-21
> against `main` @ `3b0d664`.

---

## Required commands

- (none)

Every gate step uses `pnpm` scripts already present in `package.json`; the plan
introduces no new tool, runtime, or CLI. No `## Required PHAX security
configuration changes` section is needed.

---

## Technical arbitrations

Resolved with the human on 2026-08-21; recorded so phases execute without
re-litigating them.

- **A provider error enters the fix loop with the raw log** — a diagnostic step
  that returns no decodable document, or exits non-zero with an empty list, is
  a plain gate failure (command + exit code + log), not a hard abort. Abandons:
  fast failure on a misconfigured auditor (a broken tool burns the fix budget
  before the run stops). Accepted: an auditor most often crashes on the agent's
  own code (a syntax error it cannot parse), which is exactly what the loop
  repairs.
- **Diagnostics ride the `GateFailed` event**, not only the in-memory error and
  the persisted file. Abandons: a wider touch (event type, event adapter, event
  samples test) for a consumer that does not exist yet. Accepted: the event is
  the one place every downstream reader (reducer, telemetry, future status
  projection) already looks; a findings list that is only on disk would have to
  be re-read by each of them.
- **`output` is an optional config key with a closed enum and a decoded
  default** (`"log" | "diagnostics"`, absent → `"log"`). Abandons: the strict
  "new fields are required" reading of the schema policy. Accepted: spec §6 is
  normative that a step opts *in* through a field — absence must keep meaning a
  plain step — and the decoded domain type still always carries `output`, so
  no consumer branches on `undefined`.
- **Diagnostics are decoded from stdout only, the verdict ignores the exit code
  when a non-empty list is present** (spec §9). Abandons: nothing phax relies
  on; auditors conventionally exit 1 on findings.
- **The diagnostics file is persisted only when the step fails** (spec §5.4).
  Abandons: a record of "ran clean" beyond the attribution's `pass`. Accepted:
  the attribution record already says it ran and passed; an empty document adds
  nothing.

## Context

Since v0.10 (spec 15 / plan 44) a gate profile is a list of attributed steps
`{ command, surface, firing }` (`GateStepSchema`, `src/schemas/phaxConfig.ts:53`).
`runGates` (`src/app/gates.ts:52-112`) runs steps in order through the `Shell`
port, appends stdout/stderr to `checks-attempt-NN.log`, records
`{ command, surface, result: "pass" | "fail" }` into `gate-attribution.json`,
and on the first non-zero exit fails with
`GateFailedError { command, exitCode, logPath, stderrExcerpt? }`
(`src/domain/errors.ts:61-67`). `runGatesWithFixLoop` (`src/app/fixLoop.ts`)
catches that error, emits a `GateFailed` event
(`src/domain/events.ts:80-86`: `command, exitCode, logPath, attempt`), reads the
log back and builds the fix prompt with `buildFixPrompt` (`fixLoop.ts:33-57`) —
a raw log block and "fix all issues revealed by the gate output above".

Spec 16 adds one capability on top: a step may declare `output: "diagnostics"`.
For such a step phax decodes a JSON diagnostics document from stdout, takes the
verdict from the document, hands each diagnostic (rule, location, message,
repair pointer) to the fix loop in place of the raw log, and persists the
document next to the attempt log. Everything else (registration, firing,
attribution, cumulative worktree) is unchanged.

### Architecture seams (audited 2026-08-21 against `main` @ `3b0d664`)

- **Step schema**: `GateStepSchema` (`src/schemas/phaxConfig.ts:53-57`), used by
  `GateProfilesSchema` (`:59-62`) for project config, workspaces and the user
  overlay; decoders set `onExcessProperty: "error"`. `phax.schema.json` /
  `phax.user.schema.json` at the repo root are generated from the Effect
  schemas via `getPhaxConfigJsonSchema` / `getPhaxUserOverlayJsonSchema`
  (`src/app/initProject.ts`) — last regenerated in `7a49568`.
- **Runner**: `runGates` (`src/app/gates.ts:52-112`) is the only place a step
  executes; its two callers are `runGatesWithFixLoop` (`src/app/fixLoop.ts:168`)
  and `adaptGateRun` (`src/app/eventAdapter.ts:144-163`).
- **Error → event**: `GateFailedError` is mapped to the `GateFailed` event in
  `fixLoop.ts:220-227` and `eventAdapter.ts:151-161`; the reducer
  (`src/domain/reducer.ts:353`) and matrix (`src/domain/matrix.ts`) only read
  `type` and `attempt`. `tests/unit/events.test.ts:57-64` holds a sample of
  every event variant and a `fingerprint` switch at `:134`.
  `GateAttemptsExhaustedError` (`errors.ts:69`) copies `command`/`exitCode`/
  `logPath` — unchanged.
- **Fix prompt**: `buildFixPrompt(gateError, logContent, attempt)` is a private
  function in `src/app/fixLoop.ts:33-57`; `tests/integration/fixLoop.test.ts:190`
  asserts on the prompt the fake backend receives.
- **Records**: `assembleRecord` (`src/domain/records/assemble.ts`) carries every
  phase-folder file as a record artifact, so a
  `checks-attempt-NN.diagnostics.json` written into the phase folder rides the
  run record with no records-side change.
- **Tests in place**: `tests/integration/gates.test.ts` (fake shell + fake fs,
  `steps(...)` helper), `tests/integration/fixLoop.test.ts`,
  `tests/integration/eventAdapter.test.ts`, `tests/unit/schemas/gateProfile.test.ts`,
  `tests/unit/phaxConfigJsonSchema.test.ts`.
- **Docs**: README "gate profiles" block (`README.md:129-143`) documents
  `surface` and `firing`; `docs/security.md:135` mentions the frozen command set.

### Design decisions carried into the phases

- The diagnostics document schema is external input and lives in
  `src/schemas/gateDiagnostics.ts`; `location.line` is optional (a file-level
  finding has none) — the only optional field, and it is an *external* shape.
- `GateFailedError` and the `GateFailed` event both gain a **required**
  `diagnostics: readonly GateDiagnostic[]` (empty for a plain step) — no
  optional field, per schema policy.
- The fix prompt builder becomes a pure domain function
  (`src/domain/gate/fixPrompt.ts`) so the diagnostics rendering is unit-tested
  without a fake backend.
- `surface` stays pure attribution; `output` is behavioral only inside the
  runner (how stdout is interpreted) — never in scheduling.

---

## phase-01 — Diagnostic-step schema and diagnostics document {#phase-01-diagnostics-schema}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

Let a gate step declare `output: "diagnostics"` and give phax a schema for the
diagnostics document it will read. Pure schema work, behavior-preserving: no
runner change yet.

### Detailed instructions

- **Step schema** (`src/schemas/phaxConfig.ts`):
  - Add `const GateOutputSchema = Schema.Literal("log", "diagnostics");` and
    `export type GateOutput = Schema.Schema.Type<typeof GateOutputSchema>;`.
  - Extend `GateStepSchema` with
    `output: Schema.optionalWith(GateOutputSchema, { default: () => "log" as const })`
    so the key may be omitted in `phax.json` but the decoded `GateStep` always
    carries `output`. Keep `onExcessProperty: "error"` behaviour: an unknown
    value such as `"json"` is rejected naming the step.
  - Confirm every place that constructs a `GateStep` literal still typechecks
    (tests build steps via helpers — `tests/integration/gates.test.ts:15-21`,
    `fixLoop.test.ts`, `eventAdapter.test.ts`, `executePlan.test.ts`,
    `tests/unit/schemas/gateProfile.test.ts`, `tests/unit/selectGateSteps.test.ts`,
    `src/domain/init/buildConfig.ts`, `src/app/initProject.ts`). Since the
    decoded type now requires `output`, add `output: "log"` to those literal
    builders (or route them through the decoder). Prefer the smallest edit that
    keeps the type honest; do not make `output` optional on the decoded type.
- **Diagnostics document schema** — create `src/schemas/gateDiagnostics.ts`:
  - `GateDiagnosticSchema = Schema.Struct({ rule: NonEmptyString,
    location: Schema.Struct({ file: NonEmptyString,
    line: Schema.optionalWith(Schema.Int.pipe(Schema.positive()), { exact: true }) }),
    message: NonEmptyString, repair: NonEmptyString })`.
  - `GateDiagnosticsDocumentSchema = Schema.Struct({ diagnostics:
    Schema.Array(GateDiagnosticSchema) })`.
  - Export the two types, `decodeGateDiagnosticsDocument =
    Schema.decodeUnknownEither(...)`, and `encodeGateDiagnosticsDocument =
    Schema.encodeSync(...)` (mirror `src/schemas/gateAttribution.ts`).
- **Regenerate** `phax.schema.json` and `phax.user.schema.json` from the Effect
  schemas (the same path plan 44 used: `getPhaxConfigJsonSchema` /
  `getPhaxUserOverlayJsonSchema` in `src/app/initProject.ts`). Do not hand-edit
  the generated JSON.
- **Tests**:
  - `tests/unit/schemas/gateProfile.test.ts`: a step without `output` decodes
    with `output: "log"`; a step with `output: "diagnostics"` decodes; a step
    with `output: "json"` is rejected.
  - `tests/unit/phaxConfigJsonSchema.test.ts`: the generated JSON schema lists
    `output` with the enum `["log", "diagnostics"]` and does not require it.
  - New `tests/unit/schemas/gateDiagnostics.test.ts`: a valid document decodes;
    `line` may be absent; a diagnostic missing `repair` is rejected; an empty
    `diagnostics` list decodes.

### Planned files to create

- `src/schemas/gateDiagnostics.ts`
- `tests/unit/schemas/gateDiagnostics.test.ts`

### Planned files to edit

- `src/schemas/phaxConfig.ts`
- `phax.schema.json`
- `phax.user.schema.json`
- `tests/unit/schemas/gateProfile.test.ts`
- `tests/unit/phaxConfigJsonSchema.test.ts`

### Optional files that may be edited

- `tests/integration/gates.test.ts`
- `tests/integration/fixLoop.test.ts`
- `tests/integration/eventAdapter.test.ts`
- `tests/integration/executePlan.test.ts`
- `tests/unit/selectGateSteps.test.ts`
- `tests/unit/gateAttribution.test.ts`
- `tests/unit/buildConfig.test.ts`
- `src/domain/init/buildConfig.ts`
- `src/app/initProject.ts`

### Boundary contracts

- Producer: `src/schemas/phaxConfig.ts` exposes `GateStep` with a required
  decoded `output: GateOutput`. Consumer (phase-02): the runner branches on it.
- Producer: `src/schemas/gateDiagnostics.ts` exposes `GateDiagnostic`,
  `decodeGateDiagnosticsDocument`. Consumers: phase-02 (runner), phase-03
  (prompt builder).

### Test strategy

Unit tests on both schemas, written first. No integration change.

### Implementation order

1. `gateDiagnostics.ts` + its test. 2. `output` on `GateStepSchema` + tests.
3. Fix the literal builders the type change breaks. 4. Regenerate JSON schemas.

### Excluded scope

- Reading stdout as a document (phase-02). Prompt rendering (phase-03).

### Verification

- The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The exported names from `src/schemas/gateDiagnostics.ts` and the exact
  decoded shape of `GateStep.output`.
- Which literal builders needed `output: "log"` added.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(gate): add the diagnostic-step flag and diagnostics document schema

### Commit body

A gate step may now declare `output: "diagnostics"` (absent decodes to `"log"`,
the closed enum rejects anything else). Add the schema for the diagnostics
document such a step emits — rule, location (file, optional line), message,
repair pointer — decoded at the boundary like every other external input.
Behavior-preserving: the runner does not read the flag yet. JSON schemas
regenerated.

---

## phase-02 — Verdict from the diagnostics document {#phase-02-runner-verdict}

**Recommended model:** claude-opus-4-8
**Recommended effort:** medium

Make `runGates` honour `output: "diagnostics"`: decode stdout, take the verdict
from the document, persist it on failure, carry the diagnostics on
`GateFailedError` and the `GateFailed` event, and treat a missing document or a
non-zero exit with no findings as a provider error that still enters the fix
loop with the raw log.

### Detailed instructions

- **Error and event shape** (required fields, empty for plain steps):
  - `GateFailedError` (`src/domain/errors.ts:61-67`): add
    `diagnostics: readonly GateDiagnostic[]` (`import type` from
    `src/schemas/gateDiagnostics.js`).
  - `GateFailed` event (`src/domain/events.ts:80-86`): add
    `diagnostics: readonly GateDiagnostic[]`.
  - Update the constructors: `runGates` (`src/app/gates.ts`), the event mapping
    in `fixLoop.ts:220-227` and `eventAdapter.ts:151-161`, and the sample in
    `tests/unit/events.test.ts:57-64` (fingerprint at `:134` may append the
    diagnostics count). Reducer and matrix need no change.
- **Runner** (`src/app/gates.ts`, inside the step loop):
  - For `step.output === "log"`: unchanged.
  - For `step.output === "diagnostics"`:
    - Log the command and the raw stdout/stderr into `logLines` as today, so
      the attempt log stays a faithful transcript.
    - Parse `result.stdout` as JSON and decode with
      `decodeGateDiagnosticsDocument`.
    - **Decode failure** (invalid JSON or schema mismatch): append a line to
      the log naming the failure
      (`provider error: step declared diagnostics output but returned none:
      <decode message>`), record attribution `fail`, write the log and
      attribution, and fail with `GateFailedError` carrying `diagnostics: []`
      and a `message` of the form
      `Gate step "<command>" declared diagnostics output but returned none:
      <reason>`; `exitCode` is the real exit code.
    - **Non-zero exit with an empty list**: same provider-error path, message
      `Gate step "<command>" exited <code> with no diagnostics`.
    - **Non-empty list** (any exit code): record attribution `fail`; write the
      document to `<attemptLogPath without .log>.diagnostics.json`
      (i.e. `checks-attempt-01.diagnostics.json` next to the log) via
      `encodeGateDiagnosticsDocument` and `fs.writeAtomic`; write log and
      attribution; fail with `GateFailedError` carrying the decoded
      `diagnostics`, `exitCode` as returned, `stderrExcerpt` as today.
    - **Exit 0 with an empty list**: record attribution `pass`; continue.
  - Keep the "stop at first failing step" behaviour.
  - Add a small pure helper `diagnosticsPathFor(attemptLogPath)` in
    `src/domain/gate/` (e.g. `src/domain/gate/diagnosticsPath.ts`) so phase-03
    and tests share the naming; unit-test it.
- **Telemetry**: in `fixLoop.ts` the `gate.failed` error report and the
  `makeGateEvaluatedTelemetryEvent` reason may stay as they are (command +
  exit code). Do not add diagnostics to telemetry payloads in this phase.
- **Tests**:
  - `tests/integration/gates.test.ts` (fake shell returning crafted stdout):
    - diagnostics step, exit 1, one diagnostic → `GateFailedError.diagnostics`
      has that diagnostic, attribution `fail`,
      `checks-attempt-01.diagnostics.json` written with the encoded document;
    - diagnostics step, exit 0, empty list → passes, attribution `pass`, no
      diagnostics file;
    - diagnostics step, exit 2, empty list → `GateFailedError` with
      `diagnostics: []`, message names the step and exit code (spec AC
      "Non-zero exit without findings is a provider error");
    - diagnostics step, exit 0, non-JSON stdout → provider error naming the
      step and the decode failure (spec AC "Missing document is a provider
      error"), attribution `fail`;
    - plain step behaviour unchanged (existing tests keep passing and
      `diagnostics` is `[]`).
  - `tests/integration/eventAdapter.test.ts`: `GateFailed` event carries
    `diagnostics`.
  - New `tests/unit/diagnosticsPath.test.ts` for the helper.

### Planned files to create

- `src/domain/gate/diagnosticsPath.ts`
- `tests/unit/diagnosticsPath.test.ts`

### Planned files to edit

- `src/app/gates.ts`
- `src/app/fixLoop.ts`
- `src/app/eventAdapter.ts`
- `src/domain/errors.ts`
- `src/domain/events.ts`
- `tests/integration/gates.test.ts`
- `tests/integration/eventAdapter.test.ts`
- `tests/unit/events.test.ts`

### Optional files that may be edited

- `tests/integration/fixLoop.test.ts`
- `tests/integration/dispatcher.test.ts`
- `tests/integration/stateMachineContract.test.ts`
- `tests/unit/reducer.test.ts`
- `src/app/executePlan.ts`

### Boundary contracts

- Producer: `runGates` fails with `GateFailedError { …, diagnostics }` and the
  event adapter / fix loop map it to `GateFailed { …, diagnostics }`. Consumer
  (phase-03): the fix prompt builder reads `error.diagnostics`.
- Producer: `diagnosticsPathFor(attemptLogPath)` names the persisted file.
  Consumer: records (already carry every phase-folder file); phase-03 may
  reference the path in the prompt.

### Test strategy

Integration tests on `runGates` with the fake shell and fake fs — write the
four diagnostics cases first, then implement. Unit test for the path helper.

### Implementation order

1. Error/event fields + sample test. 2. Path helper + test. 3. Runner branch
with its four cases. 4. Event adapter / fix-loop constructors.

### Excluded scope

- Prompt rendering of diagnostics (phase-03) — the fix loop still sends the raw
  log in this phase; it merely carries the diagnostics on the error.
- Any scheduling (`class`, `scopes`, `pending`) — spec 18.

### Verification

- The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The final `GateFailedError` and `GateFailed` field lists.
- The exact persisted filename pattern and the helper's module path.
- The provider-error message formats as implemented.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(gate): take the verdict of a diagnostic step from its document

### Commit body

For a step declaring `output: "diagnostics"`, decode a diagnostics document
from stdout: a non-empty list fails the step whatever the exit code, exit 0
with an empty list passes, and a missing document or a non-zero exit with no
findings is a provider error that fails the step with the raw log. Failing
documents are persisted as `checks-attempt-NN.diagnostics.json` next to the
attempt log (so they ride the run record). `GateFailedError` and the
`GateFailed` event carry the decoded diagnostics (empty for plain steps).
Attribution is unchanged. Covered by integration tests on the runner.

---

## phase-03 — Diagnostics in the fix prompt and docs {#phase-03-fix-prompt}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

Replace the raw-log block with the list of diagnostics when the failing step is
a diagnostic step, instruct the agent to read each repair pointer first, and
document the feature.

### Detailed instructions

- **Pure prompt builder** — create `src/domain/gate/fixPrompt.ts` exporting
  `buildFixPrompt(input: { command: string; exitCode: number; attempt: number;
  logContent: string; diagnostics: readonly GateDiagnostic[] }): string`.
  Move the body of the private `buildFixPrompt` in `src/app/fixLoop.ts:33-57`
  here, keeping the existing wording for the `diagnostics.length === 0` branch
  byte-for-byte (`tests/integration/fixLoop.test.ts:190` and the reducer/resume
  tests match on "Gate checks failed").
  - When `diagnostics` is non-empty, render (spec §6, wording indicative):
    ```
    # Gate checks failed — fix required

    Gate run (attempt N) failed.

    **Failed step:** `<command>` (<k> diagnostic(s))

    ## Diagnostics

    - <rule> at <file>[:<line>] — <message>
      repair guide: <repair>

    ## Required action

    Read each repair guide above before changing code, then fix every
    diagnostic. Make the minimum changes required to pass the gate.
    Do not change unrelated code or introduce new features.

    Make sure to run the failed command after your changes to verify the gate
    now passes. The gate run will be re-attempted automatically after your
    changes.
    ```
    Omit the raw log block in this branch (the log is still on disk at
    `logPath`; mention it in one line: `Full output: <logPath>`).
- **Wire it** in `src/app/fixLoop.ts`: delete the private builder, import the
  domain one, pass `error.diagnostics`. Read the log content only when needed
  (both branches may keep reading it — simplest is to keep the read and pass it
  through).
- **Tests**:
  - New `tests/unit/fixPrompt.test.ts`: empty diagnostics reproduces the
    current prompt (snapshot the header lines and the "## Gate output" block);
    one diagnostic with line renders `file:line`; one without line renders
    `file` only; the prompt contains "repair guide:" and the read-first
    instruction; the raw log block is absent.
  - `tests/integration/fixLoop.test.ts`: a failing diagnostics step produces a
    prompt to the fake backend containing the rule id and the repair pointer
    and not containing "## Gate output" (spec AC "Diagnostics feed the fix
    loop"); the existing plain-step assertion is unchanged.
- **Docs**:
  - `README.md` gate-profile section (`:129-143`): add the `output` key to the
    field list, one example step with `"output": "diagnostics"`, a short
    description of the document shape (four fields), and the three verdict
    rules (non-empty fails, exit 0 + empty passes, missing document / non-zero
    + empty is a provider error).
  - `docs/specs/16-external-gate-steps.md` is **not** edited — it is spent
    fuel; completion is recorded via `phax artifact complete` after the run.

### Planned files to create

- `src/domain/gate/fixPrompt.ts`
- `tests/unit/fixPrompt.test.ts`

### Planned files to edit

- `src/app/fixLoop.ts`
- `tests/integration/fixLoop.test.ts`
- `README.md`

### Optional files that may be edited

- `docs/security.md`
- `tests/unit/reducer.test.ts`
- `tests/unit/resume.test.ts`

### Boundary contracts

- Consumer: `src/app/fixLoop.ts` needs a prompt string from a
  `GateFailedError`, a log and an attempt. Producer:
  `src/domain/gate/fixPrompt.ts` — pure, no ports.

### Test strategy

Unit test the builder first (both branches), then the integration test through
the fake backend. Docs have no test; `pnpm format:check` covers formatting.

### Implementation order

1. Builder + unit test (plain branch identical). 2. Diagnostics branch + tests.
3. Wire in `fixLoop.ts`. 4. README.

### Excluded scope

- Inlining repair guides into the prompt (spec non-goal).
- Optional/pending diagnostics (spec 18).

### Verification

- The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The final prompt layout for the diagnostics branch (paste it).
- Confirmation that the plain-step prompt is unchanged.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(gate): feed diagnostics into the fix prompt instead of the raw log

### Commit body

When the failing step emitted a diagnostics document, the fix prompt lists each
diagnostic — rule, location, message, repair guide — and tells the agent to
read every repair guide before changing code; the raw log block is replaced by
a pointer to the log on disk. Plain steps keep today's prompt byte-for-byte.
The builder is now a pure domain function with unit tests; the fix-loop
integration test covers the diagnostics path. README documents the `output`
key, the document shape and the verdict rules.
