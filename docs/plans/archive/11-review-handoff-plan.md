# Implementation plan — Run review handoff and global file reconciliation

> Run short name: `review-handoff`.
> Deliverable location: `docs/plans/05-review-handoff-plan.md`.
> Format: matches `.skills/phax-planning.md` so `phax extract-plan` can consume
> this file. Each phase carries a `{#phase-NN-...}` anchor for the
> `planMarkdownAnchor` field and declares its planned files.

---

## Context

This plan implements `docs/specs/05-review-handoff.md`: end every successful run
with a deterministic, LLM-free **review handoff** that aggregates per-phase
evidence into a run-level entrypoint, plus a deduplicated **global file
reconciliation** across all phases.

### What already exists (verified against the codebase)

The spec was written assuming several pieces might be missing; they are not. The
plan is scoped to the genuine gap.

1. **The per-phase trio already exists for every phase, including the final
   one.** `src/app/executePlan.ts` calls `generatePhaseHandoff`
   (→ `phase-handoff.md`) and `reconcilePhaseFiles`
   (→ `file-reconciliation.md` **and** `file-reconciliation.json`)
   unconditionally inside the phase loop, before the `isFinal` branch. Spec §3,
   §9 and acceptance criteria **1–3** are already satisfied. `file-reconciliation.json`
   already holds the structured `ReconciliationResult`.
2. **`review-handoff.md` already exists, but as a different document.** Today it
   is a _resume / entry_ doc (worktree path, `claude --resume`, conductor
   handoff, phase status table), produced via the `FinalReviewOpened →
OpenRunReview` effect in `src/app/effectRunner.ts` using
   `buildReviewHandoffMarkdown` (`src/app/reviewHandoff.ts`).
3. **`final-report.md` already exists** — a run-level metadata report (phase
   table with model/effort/commit/duration, a Security section, per-phase
   artifact links), written by `WriteFinalReport` → `writeFinalReport`
   (`src/app/finalReport.ts`).
4. **Reconciliation lives in `src/domain/reconciliation/`** as pure functions:
   `reconcile.ts` (per-phase), `render.ts` (per-phase markdown), `types.ts`.
   There is **no** cross-phase aggregation.

### Decisions encoded in this plan (confirmed with the maintainer)

1. **`review-handoff.md` is repurposed** to the spec's aggregated review
   entrypoint. The existing resume / entry / conductor content is **moved into
   `final-report.md`**. No back-compat shim (per the project rule: persisted
   schemas get required fields, no optional-for-archived shims).
2. **`final-report.md` stays separate** as the metadata / telemetry / security
   report and now also carries the relocated entry/resume block.
   `review-handoff.md` links to it rather than duplicating security data.
3. **`global-file-reconciliation.json` is generated** alongside the `.md`; the
   `.md` and the review handoff render from it.
4. **Justification handling is deterministic and coarse.** For any phase with
   deviations, surface the unplanned/missing files as attention points and point
   to that phase's `phase-handoff.md`. No per-file text matching, no LLM.
5. **Aggregation reads only persisted run-folder artifacts** (`phase-NN/file-reconciliation.json`,
   `phase-NN/phase-handoff.md`, `phase-NN/file-reconciliation.md`,
   `run-status.json`, registry) — never git or a worktree, because non-final
   phase worktrees are cleaned up during the run. Phase id is carried explicitly
   in `file-reconciliation.json` (added in phase-01).
6. **Generation runs automatically before the run flips to `review_open`.** If
   generation fails, the run does not enter `review_open` (spec §13). The
   `phax review-handoff <run-name>` command is a **force/regenerate** path that
   operates only on runs already in `review_open` (archived runs already have
   the files); it is idempotent and supports `--allow-partial`.

### Architecture notes (respect these)

- **Domain stays pure.** `src/domain/reconciliation/global.ts` (phase-02) must
  not import `node:*`, `effect` IO, or any port. `tests/unit/architecturalGuards.test.ts`
  enforces boundaries; keep the aggregation a pure function over in-memory data.
- **Persisted artifacts are decoded at the boundary** with an Effect `Schema`
  (`src/schemas/`), following the `decodeSecurityPosture` pattern in
  `src/app/finalReport.ts` and `.skills/validation-boundaries.md`.
- **`run-status.json` is written only through the dispatcher/effect-runner**
  (single-writer guard). This feature writes new _artifacts_ (the two global
  files + the rewritten review-handoff); it does not add fields to
  `run-status.json`.

---

## phase-01 — Persist phaseId in per-phase reconciliation {#phase-01-persist-phase-id}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

Make every per-phase `file-reconciliation.json` self-describing by recording the
`phaseId` it belongs to, and add a decode schema for the persisted artifact so
later phases can read it safely at the filesystem boundary.

### Detailed instructions

- Define an Effect `Schema` for the persisted per-phase reconciliation in a new
  `src/schemas/reconciliation.ts`. It must mirror the existing
  `ReconciliationResult` shape (`createdAsPlanned`, `editedAsPlanned`,
  `missingPlannedCreate`, `missingPlannedEdit`, `unplannedCreated`,
  `unplannedEdited`, `optionalTouched`, `deletions`, `renames` as
  `{ from, to }[]`, `hasDeviations`) **plus a required `phaseId: string`
  field**. Follow the `src/schemas/securityPosture.ts` style: export an encode
  helper and a `decode…` function returning `Either`.
- In `src/app/reconcilePhaseFiles.ts`, include `phaseId: opts.phase.id` in the
  object written to `file-reconciliation.json` (write the encoded artifact, not
  the bare `ReconciliationResult`). The `file-reconciliation.md` render is
  unchanged.
- Keep the field **required** (no optional). There is no migration path for
  pre-existing on-disk runs; this is acceptable per the project rule.
- Add `PhaseFileReconciliation` (the persisted interface = `ReconciliationResult`
  - `phaseId`) to `src/domain/reconciliation/types.ts` if a shared TS type is
    convenient; the schema is the source of truth for decoding.

### Planned files to create

- `src/schemas/reconciliation.ts`
- `tests/unit/schemas/reconciliation.test.ts`

### Planned files to edit

- `src/app/reconcilePhaseFiles.ts`
- `src/domain/reconciliation/types.ts`
- `tests/integration/reconciliation.test.ts`

### Optional files that may be edited

- (none)

### Boundary contracts

Producer: `reconcilePhaseFiles` writes `file-reconciliation.json`. Consumer
(phase-03): the global generator reads and decodes it. The stable shape is the
schema in `src/schemas/reconciliation.ts` — every field required, `phaseId`
matching `phase-NN`.

### Test strategy

- Unit (schema): round-trip encode/decode; decode rejects an object missing
  `phaseId`. Write before implementation — this is the persisted contract.
- Integration: extend `tests/integration/reconciliation.test.ts` to assert the
  written `file-reconciliation.json` contains `phaseId` equal to the phase id.

### Implementation order

Schema → wire into `reconcilePhaseFiles` write → tests.

### Excluded scope

- Any cross-phase aggregation (phase-02+).
- Changing `file-reconciliation.md`.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact path `src/schemas/reconciliation.ts` and the names of the
  encode/decode helpers.
- The persisted JSON shape now includes required `phaseId`.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(reconciliation): persist phaseId in per-phase file-reconciliation.json

### Commit body

Add a decode schema for the persisted per-phase reconciliation artifact and
record the owning phaseId in file-reconciliation.json so later global
aggregation can key on it without inferring from the folder name. The phaseId
field is required; persisted schemas get required fields per project policy.
Covered by a schema round-trip unit test and an integration assertion.

---

## phase-02 — Global reconciliation aggregation domain {#phase-02-global-aggregation}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Add the pure, deterministic cross-phase aggregation: given each phase's
`PhaseFileReconciliation`, produce a deduplicated global view keyed by file path,
with the spec's statuses and a review-attention level, plus a markdown renderer.

### Detailed instructions

- Create `src/domain/reconciliation/global.ts`. **Pure module** — no `node:*`,
  no `effect` IO, no ports.
- Define the model:
  - `GlobalFileEntry`: `path`, `plannedInPhases: string[]`,
    `touchedInPhases: string[]`, `expectedActions: ("create"|"edit")[]`,
    `actualActions: ("added"|"modified"|"deleted"|"renamed")[]`, `status`,
    `planned: boolean`, `unplanned: boolean`, `missing: boolean`,
    `extraTouch: boolean`, `attention: "ok" | "review"`.
  - `GlobalFileStatus = "matched" | "missing" | "unplanned" | "extra-touch" |
"partially-matched" | "deleted" | "renamed" | "unknown"`.
  - `GlobalFileReconciliation`: `files: GlobalFileEntry[]` (sorted by path),
    plus convenience slices `unplanned`, `missing`, `attentionPoints`
    (entries with `attention === "review"`).
- `aggregateGlobalReconciliation(perPhase: readonly PhaseFileReconciliation[]):
GlobalFileReconciliation`:
  - Derive, per phase, each file's facts from the persisted fields: - planned (this phase) = `createdAsPlanned ∪ missingPlannedCreate ∪
editedAsPlanned ∪ missingPlannedEdit`. - touched (this phase) = `createdAsPlanned ∪ editedAsPlanned ∪
unplannedCreated ∪ unplannedEdited ∪ optionalTouched ∪ deletions ∪
rename targets`. - expected action: `create` if in a planned-create list, `edit` if in a
    planned-edit list. - actual action: from which set it appears in (added/modified/deleted/
    renamed). Track rename `from → to`.
  - Dedup by `path` across phases into one `GlobalFileEntry`, unioning
    `plannedInPhases`, `touchedInPhases`, `expectedActions`, `actualActions`.
  - Status precedence (document it in a comment and a test):
    `renamed > deleted > unplanned > missing > extra-touch > partially-matched
    > matched > unknown`. Definitions:
    - `unplanned`: touched in ≥1 phase, planned in none.
    - `missing`: planned in ≥1 phase, touched in none.
    - `extra-touch`: planned and touched, but `touchedInPhases ⊋ plannedInPhases`.
    - `partially-matched`: planned in multiple phases, touched in a non-empty
      strict subset of them.
    - `matched`: touched exactly in its planned phases.
    - `deleted` / `renamed`: action-driven, override the above.
    - `unknown`: none apply.
  - `attention`: `"ok"` only for `matched`; `"review"` for every other status.
  - `planned/unplanned/missing/extraTouch` booleans set consistently with the
    status.
- `renderGlobalReconciliationMarkdown(global: GlobalFileReconciliation): string`
  producing the spec §5 table (`| File | Planned in | Touched in | Status |
Notes |`) with deterministic ordering; render `—` for empty phase lists.

### Planned files to create

- `src/domain/reconciliation/global.ts`
- `tests/unit/reconciliation/global.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- `src/domain/reconciliation/types.ts`

### Boundary contracts

Pure domain; crosses no architectural boundary. Consumer (phase-03) calls
`aggregateGlobalReconciliation` with decoded artifacts and renders/persists the
result.

### Test strategy

- Unit tests (domain), written before implementation — this is the core
  deterministic logic:
  - dedup of a file touched in two phases appears once;
  - `extra-touch` (planned phase-01, touched phase-01 + phase-03);
  - `missing` (planned, never touched);
  - `unplanned` (touched, never planned);
  - `partially-matched`, `deleted`, `renamed`, `matched`, `unknown`;
  - status precedence ordering;
  - markdown render snapshot/string assertions.

### Implementation order

Types → `aggregateGlobalReconciliation` → `renderGlobalReconciliationMarkdown`.

### Excluded scope

- Reading files / writing artifacts (phase-03).
- The review-handoff document (phase-04).

### Verification

- The project's configured `full` gate profile in `phax.json` (includes
  `audit:architecture`, which enforces domain purity).

### Expected handoff content

- The exact path `src/domain/reconciliation/global.ts` and the exported
  function signatures (`aggregateGlobalReconciliation`,
  `renderGlobalReconciliationMarkdown`) and the `GlobalFileReconciliation` /
  `GlobalFileEntry` / `GlobalFileStatus` types.
- The documented status precedence.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(reconciliation): add pure cross-phase global aggregation and renderer

### Commit body

Add aggregateGlobalReconciliation and renderGlobalReconciliationMarkdown: a pure
domain function that deduplicates files touched across phases, classifies each
into the spec's status set (matched/missing/unplanned/extra-touch/
partially-matched/deleted/renamed/unknown) with a documented precedence, and
renders the global reconciliation table. No IO; fully unit-tested.

---

## phase-03 — Generate global-file-reconciliation.{md,json} from the run folder {#phase-03-generate-global}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Add the app-layer generator that reads each phase's `file-reconciliation.json`,
aggregates it (phase-02), and writes `global-file-reconciliation.json` and
`global-file-reconciliation.md` into the run folder, with clear missing-artifact
diagnostics and an `allowPartial` mode.

### Detailed instructions

- Create `src/app/generateGlobalReconciliation.ts` exporting
  `generateGlobalReconciliation(opts)` as an Effect over `FileSystem`.
  Inputs: `runPath`, the ordered list of phase ids (from the plan / run status),
  and `allowPartial: boolean`. Output: writes the two global artifacts and
  returns the `GlobalFileReconciliation` model so phase-04 can reuse it without
  re-reading.
- For each phase id, read `phase-NN/file-reconciliation.json` and decode it with
  the phase-01 schema (`Either`). Collect missing/undecodable phases.
- Missing-artifact policy (spec §8):
  - If any required `file-reconciliation.json` is missing/undecodable and
    `allowPartial` is false → fail with a clear, structured error listing the
    offending phases and paths. Define a tagged error
    (`ReviewHandoffArtifactMissingError` in `src/domain/errors.js`, message
    naming the missing files). Do not invent content.
  - If `allowPartial` is true → aggregate over the phases that decoded, and
    prepend a clearly-marked `> PARTIAL — missing reconciliation for: …` banner
    to the rendered markdown. Record the missing phases on the returned model
    (add an optional `partial?: { missingPhases: string[] }` to the rendered
    output / model as needed).
- Write `global-file-reconciliation.json` (the aggregated model, deterministic
  key order) and `global-file-reconciliation.md` (`renderGlobalReconciliationMarkdown`
  - optional partial banner) via `fs.writeAtomic`.
- Emit an `artifact.generated` telemetry event for each written file, matching
  the existing pattern in `reconcilePhaseFiles.ts`
  (`makeArtifactGeneratedTelemetryEvent`).

### Planned files to create

- `src/app/generateGlobalReconciliation.ts`
- `tests/integration/generateGlobalReconciliation.test.ts`

### Planned files to edit

- `src/domain/errors.ts`

### Optional files that may be edited

- `src/domain/reconciliation/global.ts`

### Boundary contracts

Consumer: reads `phase-NN/file-reconciliation.json` (the phase-01 schema).
Producer: writes `global-file-reconciliation.{md,json}`. Filesystem boundary —
decode on read, `writeAtomic` on write. No git, no worktree access.

### Test strategy

- Integration tests with a temp run folder + fake/Node FileSystem:
  - happy path: several phases with overlapping files → correct global `.json`
    and `.md`;
  - missing `file-reconciliation.json` without `allowPartial` → fails with the
    diagnostic naming the phase;
  - missing artifact with `allowPartial` → partial doc with banner, aggregates
    the rest.

### Implementation order

Error type → reader/decoder → aggregation call → writers + telemetry.

### Excluded scope

- The `review-handoff.md` document and entry-content relocation (phase-04).
- Wiring into the state machine (phase-05) and the CLI (phase-06).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact path `src/app/generateGlobalReconciliation.ts` and the
  `generateGlobalReconciliation` signature (inputs, returned model, Effect
  requirements/errors).
- The name and shape of `ReviewHandoffArtifactMissingError`.
- The partial-mode banner format.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(review): generate global file reconciliation artifacts from run folder

### Commit body

Add generateGlobalReconciliation: reads each phase's file-reconciliation.json,
decodes it at the boundary, aggregates via the pure domain function, and writes
global-file-reconciliation.{md,json}. Missing artifacts fail with a clear
diagnostic unless allowPartial is set, in which case a clearly-marked partial
document is produced. Covered by integration tests for happy, failing, and
partial paths.

---

## phase-04 — Review-handoff aggregation and entry-content relocation {#phase-04-review-handoff-builder}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Rebuild `review-handoff.md` into the spec's aggregated review entrypoint, move
the existing resume/entry/conductor content into `final-report.md`, and provide
a single `generateReviewHandoff` orchestrator that phase-05 and phase-06 reuse.

### Detailed instructions

- Rewrite `src/app/reviewHandoff.ts`:
  - Replace `buildReviewHandoffMarkdown` (resume/entry doc) with a builder that
    produces the spec §6 structure: `# Run Review Handoff`, `## Run summary`,
    `## Global file reconciliation` (embed the rendered global table),
    `## Global unplanned changes`, `## Global missing planned changes`,
    `## Global review attention points` (list each attention entry and point to
    the owning phase's `phase-handoff.md`), then `## Phase details` with, per
    phase, `### Phase NN — <title>`, `#### File reconciliation` (the phase's
    `file-reconciliation.md` content) and `#### Phase handoff` (the phase's
    `phase-handoff.md` content). Concatenate the existing per-phase markdown
    verbatim — **never** rewrite handoffs with an LLM (spec §6, §7).
  - Add `generateReviewHandoff(info, { allowPartial }): Effect<…, FileSystem>`
    that: (1) calls `generateGlobalReconciliation` (phase-03), (2) reads each
    phase's `file-reconciliation.md` and `phase-handoff.md` from the run folder,
    (3) renders and `writeAtomic`s `review-handoff.md`, (4) writes
    `final-report.md` (see below). Missing `phase-handoff.md` follows the same
    `allowPartial` policy: fail clearly, or include a marked placeholder.
- Move the relocated entry content into `src/app/finalReport.ts`: add an
  `## Entry & Resume` section to `final-report.md` containing the worktree path,
  `phax enter/shell/path/open` commands, the manual `claude --resume` snippet,
  and the conductor handoff block (the content currently in the old
  `buildReviewHandoffMarkdown`). `review-handoff.md` links to `final-report.md`
  for security and entry details rather than duplicating them.
- The `RunReviewInfo` passed to these builders already carries `runPath`,
  `stateRoot`, `phaseStatuses`, `planPhases`, branch/worktree/session fields —
  reuse it; do not add new ports.

### Planned files to create

- `tests/integration/reviewHandoff.test.ts`

### Planned files to edit

- `src/app/reviewHandoff.ts`
- `src/app/finalReport.ts`
- `tests/integration/finalReview.test.ts`

### Optional files that may be edited

- `tests/integration/__snapshots__/finalReview.test.ts.snap`

### Boundary contracts

Consumer: reads `global-file-reconciliation` (phase-03), per-phase
`file-reconciliation.md` and `phase-handoff.md`. Producer: writes
`review-handoff.md` and `final-report.md`. The `generateReviewHandoff` Effect is
the shared entrypoint reused by the state-machine wiring (phase-05) and the CLI
command (phase-06).

### Test strategy

- Integration: a temp run with two phases (overlapping files, one deviation) →
  `review-handoff.md` contains run summary, the global table, an attention point
  referencing the deviating phase's handoff, and both phases' concatenated
  reconciliation + handoff text; assert the handoff text is byte-identical to
  the per-phase files (no rewriting).
- Update `tests/integration/finalReview.test.ts` (+ snapshot) for the new
  `review-handoff.md` content and the relocated `final-report.md` entry section.

### Implementation order

`generateGlobalReconciliation` integration → review-handoff renderer →
`final-report.md` entry section → `generateReviewHandoff` orchestrator.

### Excluded scope

- State-machine wiring / ordering before `review_open` (phase-05).
- The CLI command (phase-06).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact path `src/app/reviewHandoff.ts` and the `generateReviewHandoff`
  signature; note that the old `buildReviewHandoffMarkdown` export is gone and
  what replaced it.
- Where the entry/resume/conductor content now lives in `final-report.md`.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(review): aggregate review-handoff.md and move entry content to final-report

### Commit body

Rebuild review-handoff.md into the deterministic aggregated review entrypoint
(run summary, global file reconciliation, global unplanned/missing/attention,
and per-phase concatenated file-reconciliation.md + phase-handoff.md) and add a
generateReviewHandoff orchestrator. Relocate the previous resume/entry/conductor
content into final-report.md. Handoffs are concatenated verbatim — no LLM.
Covered by a new integration test and updated finalReview snapshots.

---

## phase-05 — Generate the handoff before the run enters review_open {#phase-05-wire-final-review}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Wire `generateReviewHandoff` into the `FinalReviewOpened` path so the global
reconciliation and the new `review-handoff.md` are produced **before** the
registry flips to `review_open`; if generation fails, the run does not enter
`review_open`.

### Detailed instructions

- In `src/app/effectRunner.ts`, rewrite the `OpenRunReview` handler so it:
  1. runs `generateReviewHandoff(cmd.info, { allowPartial: false })` (which
     writes `global-file-reconciliation.{md,json}`, `review-handoff.md`, and
     `final-report.md`),
  2. **then** calls `setRunStatus(stateRoot, shortName, { state: "review_open" })`.
     The status flip must be the last side effect on the success path.
- Remove the now-redundant `WriteFinalReport` effect (final-report is written by
  `generateReviewHandoff`): drop it from the emitted effects in
  `src/domain/reducer.ts` (`FinalReviewOpened` case), from the union in
  `src/domain/effects.ts`, and the `case "WriteFinalReport"` in
  `effectRunner.ts`. The reducer now emits a single `OpenRunReview` effect for
  `FinalReviewOpened`.
- Keep `OpenRunReview`'s payload (`RunReviewInfo`) unchanged.
- Confirm no other call site depends on `WriteFinalReport` or
  `buildReviewHandoffMarkdown` before removing them.
- Update the doc comment in `src/app/finalReview.ts` to describe the new
  single-effect ordering.

### Planned files to create

- (none)

### Planned files to edit

- `src/app/effectRunner.ts`
- `src/domain/reducer.ts`
- `src/domain/effects.ts`
- `tests/integration/finalReview.test.ts`
- `tests/integration/__snapshots__/stateMachineContract.test.ts.snap`

### Optional files that may be edited

- `src/app/finalReview.ts`
- `tests/integration/executePlan.test.ts`
- `tests/integration/__snapshots__/finalReview.test.ts.snap`

### Boundary contracts

State machine → effect runner: `FinalReviewOpened` now reduces to a single
`OpenRunReview` effect whose handler must complete all artifact generation
before the `review_open` status write. Failure leaves the run in its prior
state (no `review_open`).

### Test strategy

- Integration (`finalReview.test.ts`): on `FinalReviewOpened`, all three
  artifacts exist and the registry state is `review_open`; ordering is such that
  a forced generation failure leaves the run **not** in `review_open`.
- Update the `stateMachineContract` snapshot for the reduced effect set
  (`WriteFinalReport` removed). Review the diff to confirm it is exactly the
  effect-set change.

### Implementation order

Rewrite `OpenRunReview` handler → remove `WriteFinalReport` (reducer → effects →
runner) → update tests/snapshots.

### Excluded scope

- The `phax review-handoff` CLI command (phase-06).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- Confirmation that `FinalReviewOpened` emits only `OpenRunReview`, and that the
  handler generates all artifacts before the `review_open` status write.
- That `WriteFinalReport` and `buildReviewHandoffMarkdown` no longer exist and
  why.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(review): generate review handoff before entering review_open

### Commit body

Rewrite the OpenRunReview effect to run generateReviewHandoff (global
reconciliation + review-handoff.md + final-report.md) before flipping the
registry to review_open, so a generation failure prevents a run from claiming
review readiness. Remove the redundant WriteFinalReport effect now that
final-report is produced by the orchestrator. Snapshots and finalReview
integration tests updated.

---

## phase-06 — `phax review-handoff` command {#phase-06-cli-command}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

Add the user-facing `phax review-handoff <short-name>` command to force
regeneration of the global reconciliation and review handoff for a run in
`review_open`, idempotently, with `--allow-partial`.

### Detailed instructions

- Create `src/cli/commands/reviewHandoff.ts` exporting `runReviewHandoff(shortName,
opts, output)` following the existing command-handler style (see
  `src/cli/commands/archive.ts`). It must:
  - resolve the run via the registry (`resolveRunByShortName`);
  - require the run state to be `review_open` — otherwise print a clear
    diagnostic and return a non-zero exit (archived runs already have the files;
    other states have not reached review readiness);
  - call `generateReviewHandoff(info, { allowPartial: opts.allowPartial ?? false })`;
  - on a missing-artifact failure without `--allow-partial`, surface the
    diagnostic and exit non-zero; with `--allow-partial`, generate the marked
    partial document and exit zero;
  - be safe to run repeatedly (idempotent regeneration).
- Register the command in `src/cli/main.ts`:
  `phax review-handoff <short-name>` with `--allow-partial`, mirroring the
  registration style of `archive`. Wire `globalTraceOpts()` like the other
  commands.

### Planned files to create

- `src/cli/commands/reviewHandoff.ts`
- `tests/integration/reviewHandoffCommand.test.ts`

### Planned files to edit

- `src/cli/main.ts`

### Optional files that may be edited

- `README.md`
- `tests/e2e/realFlow.test.ts`

### Boundary contracts

CLI surface → app: the command is a thin adapter over `generateReviewHandoff`
(phase-04). It owns argument parsing, run resolution, the `review_open` state
guard, exit codes, and human-readable diagnostics; it adds no generation logic.

### Test strategy

- Integration: a temp `review_open` run → command regenerates both global
  artifacts + `review-handoff.md` idempotently (running twice yields identical
  output); a non-`review_open` run → clear diagnostic + non-zero exit; missing
  artifact without `--allow-partial` → failure, with `--allow-partial` → partial
  doc + zero exit.

### Implementation order

Command handler (resolve → guard → generate) → register in `main.ts` → tests.

### Excluded scope

- Any change to automatic generation timing (phase-05 owns that).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact command name/flags and the path `src/cli/commands/reviewHandoff.ts`.
- The `review_open`-only guard and exit-code behavior.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(cli): add phax review-handoff command to regenerate the review handoff

### Commit body

Add `phax review-handoff <short-name>` (with --allow-partial) that resolves a
run in review_open and idempotently regenerates global-file-reconciliation.{md,
json} and review-handoff.md via generateReviewHandoff. Runs in other states get
a clear diagnostic and a non-zero exit. Covered by integration tests for the
happy, wrong-state, and partial paths.
