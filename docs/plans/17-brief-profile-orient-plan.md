# Brief Profile Orient

## Overview

Implements `docs/specs/17-brief-profile-orient.md` (Approved): at phase dispatch phax queries a
registered external **orient provider** with the phase's planned files and weaves the returned
**index** into the phase prompt; during a phase the agent pulls a row's body (or an index for an
arbitrary file) on demand via a new `phax orient` command; empty pulls are recorded as
demand-without-supply in the existing telemetry stream. The channel is strictly advisory: a
provider failure or an ignored brief never affects the gate (spec §5.4).

Traceability — spec acceptance criteria land as tests in these phases:

| Acceptance criterion (spec §8)     | Phase    |
| ---------------------------------- | -------- |
| Brief is woven from planned files  | phase-05 |
| Bodies load on demand              | phase-04 |
| Arbitrary-file pull returns index  | phase-04 |
| Brief never gates                  | phase-05 |
| No provider is transparent         | phase-05 |
| Empty pull is recorded             | phase-04 |

## Technical arbitrations

Resolved with the human (2026-07-22), each option framed by its dominant loss:

- **Pull form: `phax orient` CLI command** (over an in-session/MCP tool). Loss accepted: no
  harness-native tool ergonomics — the agent learns the command from the woven prompt section.
  Rejected option abandoned provider-agnosticism (per-harness tool injection for Claude Code,
  Codex, and Vibe) — unacceptable.
- **Allowance: implicit narrow `phax orient` entry** added to the frozen agent-command set when
  an orient provider is configured, recorded in the security posture (over requiring the operator
  to list it in `security.agentCommands`). Loss accepted: the frozen set gains one entry the
  operator did not write — mitigated by its narrowness, its conditionality, and its presence in
  the posture artifact. Rejected option abandoned out-of-the-box workability (a registered
  provider with agents silently unable to pull).
- **Provider protocol (planner-decided; spec marks transport indicative):** one JSON request on
  stdin, one JSON response on stdout. Requests are per-variant explicit — `{"files": [...]}`
  returns `{"rows": [...]}` (index; also serves the arbitrary-file pull), `{"expand": "<id>"}`
  returns `{"row": {...body...}}` or `{"row": null}`. Loss accepted vs a single permissive
  request/response shape: two schemas instead of one — consistent with the repo's
  explicit-over-permissive doctrine.
- **Pull recording (mechanics of the spec §9 resolution):** the `phax orient` process emits
  telemetry through the standard command wiring (global journal always; run trace when enabled).
  Loss accepted: pull events are not guaranteed to land in the same trace file as the dispatch
  events when `--trace` is off — acceptable, the spec pinned the stream, not a per-run artifact.

## Required commands

- pnpm dev schema upgrade

## Required PHAX security configuration changes

This plan requires the following command to be present in `security.agentCommands` in `phax.json`
before running (added 2026-07-22):

- `pnpm dev schema upgrade`

Without this configuration the preflight check will fail before any agent spawns. The command is
needed once, in phase-01, to regenerate `phax.schema.json` / `phax.user.schema.json`. The
allowance is deliberately narrow — it may be degraded to `enforcement: "none"` on providers
without per-command precision (codex, vibe), which is the accepted, recorded mechanism.

## phase-01 — Orient provider config block {#phase-01-orient-config}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

Add the optional `orient` block to the phax config contract so an operator can register one
orient provider (spec §6 registration surface; refs spec §5.5 for the absent case).

### Detailed instructions

- In `src/schemas/phaxConfig.ts`, add `OrientConfigSchema = Schema.Struct({ command: NonEmptyString })`
  and reference it as `orient: Schema.optional(OrientConfigSchema)` in `PhaxConfigSchema`,
  following the `publish` block pattern (dedicated struct + resolver). Surface it on
  `ResolvedConfig` as `orient: OrientConfig | undefined` — absent means no provider registered.
- Mirror the field in `PhaxUserOverlaySchema` (both schemas must stay in sync).
- Keep `onExcessProperty: "error"` semantics intact; no back-compat shim — the field is optional
  because the feature is optional (spec §5.5), not for archival tolerance.
- Regenerate the committed JSON schemas with `pnpm dev schema upgrade` (never hand-edit
  `phax.schema.json` / `phax.user.schema.json`).
- Write schema tests in `tests/unit/schemas/orientConfig.test.ts` (valid block decodes; empty
  command rejected; excess property inside the block rejected; absent block resolves to
  undefined), following `tests/unit/schemas/publishConfig.test.ts` as the template.

### Planned files to create

- `tests/unit/schemas/orientConfig.test.ts`

### Planned files to edit

- `src/schemas/phaxConfig.ts`
- `phax.schema.json`
- `phax.user.schema.json`
- `tests/unit/phaxUserOverlaySchema.test.ts`

### Optional files that may be edited

- `tests/unit/schemas.test.ts`
- `tests/unit/phaxConfigJsonSchema.test.ts`

### Test strategy

Schema layer → unit tests, written before implementation: decode/reject cases for the new block
in both the main config and the user overlay, plus JSON-schema emission if the existing emission
tests enumerate blocks.

### Implementation order

Schema struct → resolver → user overlay mirror → regenerate JSON schemas → tests green.

### Excluded scope

- Provider invocation, protocol schemas, prompt weaving, CLI (phases 02–05).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact exported names of the orient config schema/type and how `ResolvedConfig` exposes the
  block (field name, absent semantics), so phases 02–05 consume it without re-reading the schema
  file.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(orient): add orient provider config block

### Commit body

Add the optional `orient: { command }` block to phax.json (main config and
user overlay), resolved onto ResolvedConfig, with regenerated JSON schemas
and unit coverage. Registration surface for the orient provider of spec 17;
absent block means the feature is off.

## phase-02 — Provider protocol schemas and query use case {#phase-02-orient-protocol}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

Give phax the ability to talk to the provider: the push query (index for a set of files) and the
two pull queries (expand a row, index an arbitrary file), decoded at the boundary (refs spec
§5.1, §5.2, §5.3).

### Detailed instructions

- Create `src/schemas/orient.ts`: `OrientRowSchema` (`id`, `title`, `severity` as the explicit
  enum `"error" | "warn" | "info"`, `trigger` — all non-empty strings; the four-field minimum is
  the spec §9 resolution), `OrientIndexResponseSchema = { rows: OrientRow[] }`, and
  `OrientExpandResponseSchema = { row: OrientRow & { body: NonEmptyString } | null }`. Export
  decoders following the repo's `decodeX` convention.
- Create `src/app/orient.ts` with two use cases running the configured provider command through
  the `Shell` port (`src/ports/shell.ts`), modelled on `runGates` in `src/app/gates.ts`:
  - `queryOrientIndex(config, files, cwd)` — writes `{"files": [...]}` to the provider's stdin,
    decodes stdout with `OrientIndexResponseSchema`.
  - `expandOrientRow(config, id, cwd)` — writes `{"expand": "<id>"}`, decodes with
    `OrientExpandResponseSchema`.
  - Both return a typed failure (non-zero exit, unparseable stdout) instead of throwing — callers
    decide the advisory handling; neither use case ever fails the surrounding Effect for a
    provider error.
  - If the `Shell` port cannot feed stdin today, extend `ShellOps.run` with an optional `stdin`
    field and implement it in `src/infra/shell.ts` + `src/infra/fakes/shell.ts` (list under
    optional edits).
- Tests first for the stable contract: `tests/unit/schemas/orient.test.ts` (decode/reject: bad
  severity, missing field, null row) and `tests/integration/orient.test.ts` with `makeFakeShell()`
  (index query happy path, expand happy path, provider non-zero exit → typed failure, garbage
  stdout → typed failure), following `tests/integration/gates.test.ts`.

### Planned files to create

- `src/schemas/orient.ts`
- `src/app/orient.ts`
- `tests/unit/schemas/orient.test.ts`
- `tests/integration/orient.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- `src/ports/shell.ts`
- `src/infra/shell.ts`
- `src/infra/fakes/shell.ts`

### Boundary contracts

app → port: `src/app/orient.ts` (consumer) needs one-shot external command execution with stdin
payload and captured stdout from `Shell` (producer, `src/ports/shell.ts`). Strict on the semantic
need (send request, get stdout/exit code); adaptable on the exact `ShellOps.run` option shape.

### Test strategy

Schemas → unit (decode/reject, before implementation). Use case → integration with fake `Shell`
(before implementation, it is a stable contract). If the port gains `stdin`, cover it in the
adapter's existing integration tests only if they exist for `run` options.

### Implementation order

Row/response schemas → (port `stdin` extension if needed) → use cases → integration tests green.

### Excluded scope

- Telemetry emission (phase-03/04), prompt weaving (phase-05), CLI surface (phase-04).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- Exact module path `src/app/orient.ts` with the two use-case signatures and their typed failure
  shape; exact schema exports of `src/schemas/orient.ts`; whether `ShellOps.run` gained a
  `stdin` option (and its field name) — phases 04 and 05 build directly on these.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(orient): add provider protocol schemas and query use cases

### Commit body

Add boundary schemas for the orient provider protocol (index rows with the
explicit severity enum, per-variant index/expand responses) and app use cases
running the provider through the Shell port with typed, non-throwing failures.
Covered by schema unit tests and fake-shell integration tests.

## phase-03 — Orient telemetry events {#phase-03-orient-telemetry}

**Recommended model:** claude-sonnet-5
**Recommended effort:** low

Define the semantic telemetry events the orient channel records — the fed-forward brief and the
pulls, including demand-without-supply (refs spec §5.6 and the spec §9 recording resolution).

### Detailed instructions

- Add three event structs to `src/domain/telemetry/events.ts` and their schemas to the
  `SemanticTelemetryEventSchema` union in `src/schemas/telemetryEvents.ts`, following the
  `agent.model.resolved` pattern (factory `makeXTelemetryEvent`, `runId` + optional
  `operationId`):
  - `orient.brief.computed` — phase id, file count, row count (records the fed-forward brief).
  - `orient.pull.served` — pull kind (`expand` | `file`), subject (row id or path).
  - `orient.pull.empty` — same fields; the demand-without-supply record of spec §5.6.
- Extend `tests/unit/telemetry/events.test.ts` with encode/decode coverage for the three events;
  touch `tests/unit/telemetry/eventMapping.test.ts` only if the mapping layer enumerates event
  types exhaustively.
- Emission happens in later phases — this phase only defines and tests the vocabulary.

### Planned files to create

- (none)

### Planned files to edit

- `src/domain/telemetry/events.ts`
- `src/schemas/telemetryEvents.ts`
- `tests/unit/telemetry/events.test.ts`

### Optional files that may be edited

- `tests/unit/telemetry/eventMapping.test.ts`

### Test strategy

Domain/schema layer → unit tests, before implementation: each new event round-trips through its
schema and is accepted by the union.

### Implementation order

Domain structs + factories → schema union → tests green.

### Excluded scope

- Emitting the events (phase-04 for pulls, phase-05 for the brief).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The three event type names and factory signatures, so phases 04/05 emit them without
  re-deriving field shapes.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(orient): add orient telemetry events

### Commit body

Add orient.brief.computed, orient.pull.served, and orient.pull.empty to the
semantic telemetry vocabulary (domain structs + schema union), with unit
round-trip coverage. orient.pull.empty is the demand-without-supply record
required by spec 17 §5.6.

## phase-04 — phax orient command and implicit allowance {#phase-04-orient-cli}

**Recommended model:** claude-sonnet-5
**Recommended effort:** high

Give the in-phase agent its pull surface: `phax orient <id>` expands a row, `phax orient --file
<path>` returns an index for an arbitrary file, and the command becomes implicitly runnable by
phase agents when a provider is configured (refs spec §5.3, §5.6; ACs "Bodies load on demand",
"Arbitrary-file pull returns an index", "Empty pull is recorded").

### Detailed instructions

- Create `src/cli/commands/orient.ts` (thin view layer, no business logic): parse `<id>` positional
  or `--file <path>` (exactly one required), load config from `process.cwd()` (the phase worktree
  carries `phax.json`), call the phase-02 use cases, render via `OutputPort`:
  - expand hit → print the row body; file hit → print index lines (`[severity] id — title`).
  - empty result → print a one-line "no orientation" notice and **exit 0** (the channel is
    advisory; a non-zero exit would read as a failure to the agent).
  - no `orient` block in config → actionable error, exit 1.
- Register the command in `src/cli/program.ts` following the existing thin-command style.
- Emit telemetry through the standard command wiring (`src/cli/commands/runLayers.ts`):
  `orient.pull.served` on a hit, `orient.pull.empty` on an empty result (spec §5.6).
- In `src/domain/security/agentCommands.ts`, extend `computeFrozenAgentCommands` with a required
  `orientEnabled: boolean` input; when true, include a narrow `phax orient` entry in the frozen
  set (source-visible in the posture like any entry; narrow-command degradation on codex/vibe is
  the existing, accepted mechanism). Update the call site in `src/app/executePlan.ts` to pass
  `orientEnabled` from the resolved config. Per repo policy the new input is required, not
  optional.
- Tests first: `tests/unit/cli/orient.test.ts` (arg validation, expand/file/empty/no-provider
  renderings and exit codes, following `tests/unit/cli/validate.test.ts` style) and new cases in
  `tests/unit/security/agentCommands.test.ts` (`orientEnabled: true` adds exactly `phax orient`;
  `false` leaves the set unchanged).

### Planned files to create

- `src/cli/commands/orient.ts`
- `tests/unit/cli/orient.test.ts`

### Planned files to edit

- `src/cli/program.ts`
- `src/domain/security/agentCommands.ts`
- `src/app/executePlan.ts`
- `tests/unit/security/agentCommands.test.ts`

### Optional files that may be edited

- `src/cli/commands/runLayers.ts`
- `tests/unit/security/posture.test.ts`
- `tests/integration/cliProgram.test.ts`

### Boundary contracts

cli → app: `src/cli/commands/orient.ts` (consumer) needs the two query use cases from
`src/app/orient.ts` (producer, phase-02 handoff names them). app → domain:
`src/app/executePlan.ts` (consumer) passes `orientEnabled` to `computeFrozenAgentCommands`
(producer, `src/domain/security/agentCommands.ts`). Strict on semantics, adaptable on parameter
spelling.

### Test strategy

CLI → unit tests on the command function with fake ports (before implementation). Security →
unit tests on `computeFrozenAgentCommands` (before implementation — domain invariant). Program
wiring → existing `cliProgram` integration test only if it enumerates commands.

### Implementation order

Security freeze extension (domain) → CLI command + registration → telemetry emission → tests
green.

### Excluded scope

- Dispatch-time weaving and the brief itself (phase-05).
- Any gating behavior on pull results (spec §5.4 — the command never affects the gate).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact invocation forms shipped (`phax orient <id>`, `phax orient --file <path>`), output
  and exit-code behavior per case, and the `computeFrozenAgentCommands` signature change —
  phase-05 must reference the invocation forms verbatim in the woven prompt section.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(orient): add phax orient pull command with implicit allowance

### Commit body

Add the in-phase pull surface of spec 17: phax orient expands a brief row or
returns an index for an arbitrary file, exits 0 on empty results (advisory
channel), records served/empty pulls in telemetry, and is implicitly allowed
to phase agents (narrow `phax orient` frozen-set entry) whenever an orient
provider is configured.

## phase-05 — Weave the brief at dispatch {#phase-05-dispatch-weave}

**Recommended model:** claude-sonnet-5
**Recommended effort:** high

Close the loop: at phase dispatch phax queries the provider with the phase's planned files and
weaves the returned index into the phase prompt — index only, advisory only, transparent when no
provider is registered (refs spec §5.1, §5.2, §5.4, §5.5; ACs "Brief is woven from planned
files", "Brief never gates", "No provider is transparent").

### Detailed instructions

- In `src/app/promptGeneration.ts`, add an optional `orientationIndex` field to
  `BuildPhasePromptOptions`; when present, render a section between `## Current phase` and
  `## Execution rules`:
  - heading `## Orientation for this phase (expand a row before touching its files)` with one
    line per row — `- [severity] id — title` (index only; bodies never inline, spec §5.2);
  - two usage lines naming the phase-04 invocation forms verbatim (`phax orient <id>`,
    `phax orient --file <path>`), including for files the plan did not predict.
  - When absent, the prompt must be byte-identical to today's output (spec §5.5).
- In `src/app/executePlan.ts`, just before the `buildPhasePrompt` call: when the resolved config
  has an `orient` block, call `queryOrientIndex` with the union of the phase's three planned-file
  lists; on success emit `orient.brief.computed` and pass the rows; on typed provider failure
  (non-zero exit, bad JSON) log a warning through the existing output/telemetry channels and
  dispatch the prompt **unchanged** — a provider failure must never fail, block, or retry the
  phase (spec §5.4).
- Tests first: extend `tests/unit/promptGeneration.test.ts` (section rendered with rows + usage
  lines; absent index → unchanged output) and `tests/integration/executePlan.test.ts` (registered
  provider → prompt.md contains the index and brief.computed is recorded; provider failure →
  phase proceeds, prompt unchanged; no orient block → prompt unchanged and no provider call —
  assert via the fake shell's call log).

### Planned files to create

- (none)

### Planned files to edit

- `src/app/promptGeneration.ts`
- `src/app/executePlan.ts`
- `tests/unit/promptGeneration.test.ts`
- `tests/integration/executePlan.test.ts`

### Optional files that may be edited

- `tests/integration/dispatcher.test.ts`

### Boundary contracts

app internal: `executePlan` (consumer) feeds `orientationIndex` rows to `buildPhasePrompt`
(producer). The row shape is the phase-02 schema type; strict on "index rows only, never
bodies", adaptable on the option field name.

### Test strategy

Prompt builder → unit (before implementation: the woven section and the unchanged-when-absent
invariant are stable contracts). Dispatch behavior → integration with fake shell/backend
(before implementation: covers ACs §5.1, §5.4, §5.5 directly).

### Implementation order

Prompt section (pure) → dispatch query + telemetry + advisory failure handling → integration
tests green.

### Excluded scope

- Any change to gate evaluation or the fix loop (the brief has no gating effect, spec §5.4).
- Provider content or relevance decisions (spec §7 non-goals — provider's concern).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The final woven section shape as it appears in `prompt.md`, the exact `BuildPhasePromptOptions`
  field added, and confirmation (with test names) that the three dispatch ACs are covered.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(orient): weave orientation brief into the phase prompt

### Commit body

Query the registered orient provider at phase dispatch with the phase's
planned files and weave the returned index into the phase prompt — index
rows only, with the phax orient pull instructions. Absent provider leaves
the prompt byte-identical; provider failures warn and dispatch unchanged,
preserving the strictly advisory posture of spec 17.
