# Implementation plan — Planned file intent and end-of-phase file reconciliation

> Run short name: `planning-skill-update`.
> Deliverable location: `docs/plans/02-phax-planning-skill-update-plan.md`.
> Format: matches `.skills/phax-planning.md` so `phax extract-plan` can consume
> this file and produce a `phax-plan.json`. Each phase carries a
> `{#phase-NN-...}` anchor for the `planMarkdownAnchor` field and declares its
> planned files. (Until phase-01 of this plan lands, the current extractor does
> not pull the three planned-file arrays — the sections are forward-compatible
> per the skill.)

---

## Context

This plan implements `docs/specs/02-phax-planning-skill-update.md`: give each
phase a declared file intent (`plannedFilesToCreate`, `plannedFilesToEdit`,
`optionalFilesToEdit`) and have phax reconcile that intent against the actual
git diff at the end of every phase, surfacing deviations and carrying them
forward to the next phase.

Today:

- `PhaseSchema` (`src/schemas/phaxPlan.ts`) holds only `id`, `title`, `model`,
  `effort`, `planMarkdownAnchor`, and `commit.{subject,body}`. The same schema
  backs both `ExtractedPhaxPlanSchema` (sent to Claude as JSON Schema) and
  `PhaxPlanSchema` (persisted), so extending `PhaseSchema` automatically flows
  into extraction with no extractor code change.
- `src/app/commit.ts` already runs `git diff HEAD^ HEAD` after each phase commit
  and writes `diff.patch` into the phase folder. The per-phase change set is
  therefore exactly `HEAD^..HEAD` in the phase worktree — the proven range
  reconciliation reuses with `--name-status`.
- `src/app/executePlan.ts` runs each phase as: gates → `generatePhaseHandoff`
  → `commitPhase` → final-review/cleanup. Reconciliation slots in right after a
  successful `commitPhase` (the no-changes path throws `PhaseHadNoChangesError`
  before this point, so reconciliation never runs without a commit).
- `src/app/promptGeneration.ts` already injects the previous phase's
  `phase-handoff.md` (via `readPreviousHandoff` in `handoffInjection.ts`). The
  same mechanism carries the previous phase's reconciliation report forward.
- `.skills/phax-planning.md` is already updated to the target authoring format;
  `.skills/phax-phase-handoff.md` still needs the deviation-explanation note.

### Design

- **Schema fields are required arrays.** `plannedFilesToCreate`,
  `plannedFilesToEdit`, `optionalFilesToEdit` are `Schema.Array(Schema.String)`
  and required (an empty `[]` is valid, but the key must be present). phax
  schemas do not add optional-for-back-compat fields. Because
  `decodePhaxPlan`/`decodeExtractedPlan` use `onExcessProperty: "error"`, every
  in-repo phase fixture and the root `phax-plan.json` sample must gain the three
  keys in the same phase the schema changes, or `pnpm typecheck`/`pnpm test`
  fails.
- **Reconciliation is deterministic and phax-owned.** A pure domain module
  (`src/domain/reconciliation/`) parses `git diff --name-status` output and
  compares it to the planned lists; the agent never authors the report. The
  domain stays pure (no Effect, no infra) and is locked down by extending the
  existing architectural purity guard.
- **Git access via a new port method.** `Git.diffNameStatus(worktree)` returns
  parsed `NameStatusEntry[]`; the Node adapter runs `git diff --name-status
  HEAD^ HEAD` and parses with the pure parser, and the fake lets tests enqueue
  entries.
- **Report first, knobs later.** The report is always written (report-only
  semantics) from the moment it is wired in. The `fileReconciliation.mode`
  config (`report_only` | `warn`) and the warning surface land afterward.
  `fail_*` modes need a new run-state-machine transition (like `handoff_failed`)
  and are explicitly out of scope for this plan.
- **Carry context forward, no aggregation.** The next phase's prompt receives
  the previous phase's `file-reconciliation.md` alongside its handoff. A full
  cumulative `files_*_so_far` aggregate is out of scope.

### Constraints that shape the phase boundaries

- **`knip` is a full-profile gate.** `src/**` is in knip's `project` set; a new
  export is "reachable" only once something in an `entry` (e.g. a
  `tests/**/*.test.ts` file) imports it. Each phase that introduces a pure
  module ships it together with the unit test that imports it.
- **`pnpm audit:architecture`** runs `tests/unit/architecturalGuards.test.ts`.
  The new `src/domain/reconciliation/` must be added to the purity guard, and it
  must import no `effect`/`@opentelemetry`/`ports/fs`/`infra` modules.
- **Adding `PhaseSchema` fields changes serialized output.** The phase prompt
  embeds `JSON.stringify(currentPhase)` / `JSON.stringify(planJson)`, so the
  `tests/unit/__snapshots__/promptGeneration.test.ts.snap` snapshot must be
  refreshed in the same phase that adds the fields.
- Each phase is verified by the project's `full` gate profile in `phax.json`:
  `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm knip`, `pnpm test`,
  `pnpm audit:architecture`, `pnpm build`.

The work is split into **5 sequential phases**: 01 extends the schema and fixes
up every fixture; 02 adds the pure reconciliation domain; 03 adds the Git port
method; 04 wires reconciliation into the phase lifecycle; 05 adds the config
mode, warnings, cross-phase prompt injection, and the handoff/skill docs.

---

## phase-01 — Add planned-file fields to the phase schema {#phase-01-schema-fields}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Extend `PhaseSchema` with the three required planned-file arrays so every
extracted and persisted plan carries file intent. This is the foundation every
later phase reads; it has no runtime behavior of its own but ripples into every
phase fixture, the root sample plan, and the prompt snapshot, which must all be
updated in this commit to keep the gates green.

### Detailed instructions

- In `src/schemas/phaxPlan.ts`, add three fields to `PhaseSchema`, after
  `planMarkdownAnchor` and before `commit`:
  - `plannedFilesToCreate: Schema.Array(Schema.String)`
  - `plannedFilesToEdit: Schema.Array(Schema.String)`
  - `optionalFilesToEdit: Schema.Array(Schema.String)`
  All three are required (no `Schema.optional`); an empty array is valid. They
  appear in both `ExtractedPhaxPlanSchema` and `PhaxPlanSchema` because both
  embed `PhaseSchema`, so `getExtractedPlanJsonSchema()` automatically advertises
  them to Claude — no change to `src/app/extractPlan.ts` extraction logic.
- Update the root sample plan `phax-plan.json` so its single phase gains the
  three keys (use realistic values, e.g. the files that phase actually created).
- Update every in-repo phase fixture so the project type-checks and all decode
  calls succeed. Add `plannedFilesToCreate: []`, `plannedFilesToEdit: []`,
  `optionalFilesToEdit: []` (or realistic values) to each phase literal. Run
  `pnpm typecheck` and `pnpm test` and fix every file the compiler/decoder
  flags. Known fixture sites (verify with the type-checker, do not trust this
  list to be exhaustive): `tests/unit/promptGeneration.test.ts`,
  `tests/unit/resume.test.ts`, `tests/integration/executePlan.test.ts`,
  `tests/integration/routing.test.ts`, `tests/integration/rateLimit.test.ts`,
  `tests/integration/stateMachineContract.test.ts`,
  `tests/integration/perPhaseBranch.test.ts`, `tests/integration/resume.test.ts`,
  `tests/integration/setupFailure.test.ts`, `tests/integration/runFolder.test.ts`,
  `tests/integration/finalReview.test.ts`,
  `tests/integration/telemetry/end-to-end.test.ts`,
  `tests/e2e/semanticTrace.test.ts`.
- Refresh the prompt snapshot: the phase JSON is embedded in the generated
  prompt, so the new keys appear in `tests/unit/__snapshots__/promptGeneration.test.ts.snap`.
  Re-run vitest with snapshot update (`pnpm test -- -u` or vitest `--update`) and
  review the diff to confirm only the added keys changed.
- Extend `tests/unit/schemas.test.ts` with cases for the new fields: a plan whose
  phase omits any of the three arrays decodes to `Left`; a phase with empty
  arrays decodes to `Right`; a phase with populated arrays round-trips.

### Planned files to create
- (none)

### Planned files to edit
- `src/schemas/phaxPlan.ts`
- `phax-plan.json`
- `tests/unit/schemas.test.ts`
- `tests/unit/promptGeneration.test.ts`
- `tests/unit/__snapshots__/promptGeneration.test.ts.snap`
- `tests/unit/resume.test.ts`
- `tests/integration/executePlan.test.ts`
- `tests/integration/routing.test.ts`
- `tests/integration/rateLimit.test.ts`
- `tests/integration/stateMachineContract.test.ts`
- `tests/integration/perPhaseBranch.test.ts`
- `tests/integration/resume.test.ts`
- `tests/integration/setupFailure.test.ts`
- `tests/integration/runFolder.test.ts`
- `tests/integration/finalReview.test.ts`
- `tests/integration/telemetry/end-to-end.test.ts`
- `tests/e2e/semanticTrace.test.ts`

### Optional files that may be edited
- `src/app/extractPlan.ts` (only if you choose to surface the new arrays in
  `buildExtractReport`; not required)
- `docs/extract-plan-model.md`
- `examples/hello-world/plan.md`

### Boundary contracts
None — this phase changes a schema and its fixtures only; it crosses no runtime
architectural boundary.

### Test strategy
Contract/schema tests at the domain-schema layer (`tests/unit/schemas.test.ts`):
write the new failing decode cases first (missing field → `Left`), then add the
fields to make them pass. The wide fixture edit is mechanical; the type-checker
and the existing suite are the safety net.

### Implementation order
1. Add the failing schema test cases for the three required fields.
2. Add the fields to `PhaseSchema`.
3. Update `phax-plan.json` and run `pnpm typecheck`; fix each flagged fixture.
4. Run `pnpm test`; update the prompt snapshot and fix any remaining fixture.
5. Run the full gate profile.

### Excluded scope
- Reconciliation logic, the Git port method, config, and prompt injection
  (phases 02–05).

### Verification
The project's `full` gate profile in `phax.json` (`pnpm typecheck`, `pnpm lint`,
`pnpm format:check`, `pnpm knip`, `pnpm test`, `pnpm audit:architecture`,
`pnpm build`).

### Expected handoff content
- The exact field names and types added to `PhaseSchema`
  (`plannedFilesToCreate`, `plannedFilesToEdit`, `optionalFilesToEdit`:
  `readonly string[]`, required) and confirmation they are exposed by
  `getExtractedPlanJsonSchema()`.
- That all phase fixtures and the prompt snapshot now include the three keys, so
  phase-04 can rely on `PhaxPlanPhase` always carrying them.
- Any deviation from the planned file lists (e.g. a fixture file that did or did
  not need editing), with the reason.

### Commit subject
feat(schema): add planned-file fields to the phase schema

### Commit body
Add required `plannedFilesToCreate`, `plannedFilesToEdit`, and
`optionalFilesToEdit` string arrays to `PhaseSchema`, flowing into both the
extracted and persisted plan schemas. Update the root sample plan, every phase
fixture, the prompt snapshot, and the schema tests so the full gate profile
stays green. No runtime behavior yet — later phases consume these fields.

---

## phase-02 — Pure reconciliation domain and name-status parser {#phase-02-reconciliation-domain}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Add a pure `src/domain/reconciliation/` module that parses `git diff
--name-status` output and compares it against a phase's planned file lists,
plus a Markdown renderer for the report. No Effect, no infra — this is total,
testable logic locked down by the architectural purity guard. Later phases feed
it real git output and write its output to disk.

### Detailed instructions

- Create `src/domain/reconciliation/types.ts`:
  - `ChangeStatus = "added" | "modified" | "deleted" | "renamed"`.
  - `NameStatusEntry { status: ChangeStatus; path: string; oldPath?: string }`
    (for `renamed`, `path` is the new path and `oldPath` the previous one).
  - `PlannedFiles { create: readonly string[]; edit: readonly string[]; optional: readonly string[] }`.
  - `ReconciliationResult` with: `createdAsPlanned`, `editedAsPlanned`,
    `missingPlannedCreate`, `missingPlannedEdit`, `unplannedCreated`,
    `unplannedEdited`, `optionalTouched` (all `readonly string[]`),
    `deletions: readonly string[]`, `renames: readonly { from: string; to: string }[]`,
    and `hasDeviations: boolean`.
- Create `src/domain/reconciliation/parseNameStatus.ts` exporting
  `parseNameStatus(stdout: string): readonly NameStatusEntry[]`:
  - Split on newlines, ignore blank lines. Each line is tab-separated.
  - `A\t<path>` → added; `M\t<path>` → modified; `D\t<path>` → deleted.
  - Rename/copy codes carry a similarity score: `R<score>\t<old>\t<new>` →
    renamed (`path=<new>`, `oldPath=<old>`); treat `C<score>` (copy) as `added`
    at `<new>`. Match the leading letter, not the exact code.
  - Be tolerant of trailing whitespace; do not throw on unknown codes — skip
    them (a later phase can decide policy).
- Create `src/domain/reconciliation/reconcile.ts` exporting
  `reconcile(planned: PlannedFiles, entries: readonly NameStatusEntry[]): ReconciliationResult`:
  - Derive sets: `created` (added), `edited` (modified), `deleted`, renames.
  - `createdAsPlanned = planned.create ∩ created`;
    `missingPlannedCreate = planned.create − created`.
  - `editedAsPlanned = planned.edit ∩ edited`;
    `missingPlannedEdit = planned.edit − edited`.
  - `planSet = create ∪ edit ∪ optional`;
    `unplannedCreated = created − planSet`; `unplannedEdited = edited − planSet`.
  - `optionalTouched = optional ∩ (created ∪ edited)`.
  - `deletions = deleted`; `renames` mapped from rename entries.
  - `hasDeviations = true` if any of `missingPlannedCreate`,
    `missingPlannedEdit`, `unplannedCreated`, `unplannedEdited`, `deletions`,
    `renames` is non-empty. Keep ordering stable (input order) for deterministic
    output.
- Create `src/domain/reconciliation/render.ts` exporting
  `renderReconciliationMarkdown(result: ReconciliationResult, planned: PlannedFiles): string`
  producing the `## PHAX File Reconciliation` report from the spec
  (checkbox lists for planned create/edit, optional touched, unplanned
  created/edited with a "Deviation — agent must explain in `phase-handoff.md`"
  note, and a one-line summary). Pure string building only.
- Add unit tests under `tests/unit/reconciliation/` (this is what makes the
  exports reachable for knip): `parseNameStatus.test.ts` (each status, renames,
  blank/again-whitespace lines, unknown code skipped), `reconcile.test.ts`
  (planned-as-expected, missing planned, unplanned, optional touched never
  deviates, deletions/renames flag deviations, `hasDeviations` correctness),
  and `render.test.ts` (a representative result renders the expected headings
  and the deviation note).

### Planned files to create
- `src/domain/reconciliation/types.ts`
- `src/domain/reconciliation/parseNameStatus.ts`
- `src/domain/reconciliation/reconcile.ts`
- `src/domain/reconciliation/render.ts`
- `tests/unit/reconciliation/parseNameStatus.test.ts`
- `tests/unit/reconciliation/reconcile.test.ts`
- `tests/unit/reconciliation/render.test.ts`

### Planned files to edit
- `tests/unit/architecturalGuards.test.ts`

### Optional files that may be edited
- (none)

### Boundary contracts
None crossed at runtime. The contract this phase establishes for later consumers
(phase-03 and phase-04) is the producer surface of `src/domain/reconciliation/`:
`parseNameStatus`, `reconcile`, `renderReconciliationMarkdown`, and the exported
types. Be strict on these signatures; consumers depend on them.

### Test strategy
Domain layer → unit tests, written test-first since this is stable, critical
logic. Cover parser edge cases (renames, unknown codes, whitespace) and the
reconcile set algebra exhaustively, including the invariant that touching an
optional file is never a deviation.

### Implementation order
1. Write `types.ts`.
2. Write failing parser tests, then `parseNameStatus.ts`.
3. Write failing reconcile tests, then `reconcile.ts`.
4. Write failing render tests, then `render.ts`.
5. Extend the architectural purity guard to cover the new domain dir; run the
   full gate profile.

### Excluded scope
- Any git invocation or file I/O (phase-03/04).
- Reading planned lists off a `PhaxPlanPhase` (phase-04 maps phase → `PlannedFiles`).

### Verification
The project's `full` gate profile in `phax.json`. `pnpm audit:architecture` must
prove `src/domain/reconciliation/` imports no `effect`, `@opentelemetry`,
`ports/fs`, or `infra` modules.

### Expected handoff content
- The exact module paths and exported signatures (`parseNameStatus`,
  `reconcile`, `renderReconciliationMarkdown`) and the `NameStatusEntry` /
  `PlannedFiles` / `ReconciliationResult` shapes, so phase-03 can import the
  parser/type and phase-04 can call `reconcile`/render.
- How the purity guard was extended (the pattern list it reuses).
- Any deviation from the planned file lists, with the reason.

### Commit subject
feat(reconciliation): add pure file-reconciliation domain

### Commit body
Add `src/domain/reconciliation/` with a name-status parser, a pure `reconcile`
comparing planned file lists against actual changes, and a Markdown renderer for
the reconciliation report. The module is pure (guarded by the architectural
purity test) and its unit tests make the exports reachable for knip. Nothing
calls it yet.

---

## phase-03 — Git port `diffNameStatus` method {#phase-03-git-diff-name-status}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Add a `diffNameStatus` method to the `Git` port that returns the parsed
name-status entries for a phase's commit (`HEAD^..HEAD`), so phase-04 can obtain
the actual change set without shelling out from the app layer. Implement it in
the Node adapter and the fake.

### Detailed instructions

- In `src/ports/git.ts`, add to `GitOps`:
  `diffNameStatus(path: WorktreePath): Effect.Effect<readonly NameStatusEntry[], GitError>`
  and import `NameStatusEntry` from `../domain/reconciliation/types.js`.
- In `src/infra/git.ts` (`NodeGitLayer`), implement it by running
  `gitRun(["diff", "--name-status", "HEAD^", "HEAD"], path)` and parsing the
  stdout with `parseNameStatus` from `src/domain/reconciliation/parseNameStatus.ts`
  (infra may import domain). Use the exact range `commit.ts` already uses, so the
  result matches `diff.patch` for the same phase.
- In `src/infra/fakes/git.ts`:
  - Add `{ method: "diffNameStatus"; path: string }` to the `GitCall` union.
  - Add a queue field (e.g. `diffNameStatusQueue: Map<string, NameStatusEntry[]>`)
    and an `enqueueDiffNameStatus(path: string, entries: NameStatusEntry[])`
    helper, mirroring `enqueueWorktreeIsClean`.
  - Implement `diffNameStatus` to record the call and return the queued entries
    for that path (default `[]`).
- Add an integration test `tests/integration/gitDiffNameStatus.test.ts` that
  initializes a real temporary git repo (as `tests/e2e/realFlow.test.ts` does
  for real git), makes two commits, and asserts `NodeGitLayer.diffNameStatus`
  returns the expected added/modified/deleted entries for `HEAD^..HEAD`. This
  exercises the real `git` invocation and the parser wiring end to end and keeps
  the new export reachable.

### Planned files to create
- `tests/integration/gitDiffNameStatus.test.ts`

### Planned files to edit
- `src/ports/git.ts`
- `src/infra/git.ts`
- `src/infra/fakes/git.ts`

### Optional files that may be edited
- (none)

### Boundary contracts

#### app/executePlan (future consumer) → Git port (producer)
- Consumer (phase-04): the phase lifecycle, which needs the actual change set
  for a committed phase.
- Producer: the `Git` port.
- Semantic need: "give me the files this phase's commit changed, classified."
- Contract: `Git.diffNameStatus(worktree): Effect<readonly NameStatusEntry[], GitError>`,
  computed over `HEAD^..HEAD` in the worktree.

#### Git port → Node git adapter (producer)
- The adapter shells out via the existing `gitRun` helper and parses with the
  phase-02 parser; the fake returns queued entries. Both satisfy the same port
  signature.

### Test strategy
Adapter/integration: a real-git integration test for the Node layer (side
effects + parsing), since the pure parser is already unit-tested in phase-02.
The fake's behavior is exercised by phase-04's integration test.

### Implementation order
1. Add the method to the `GitOps` interface.
2. Implement it in the fake (+ `GitCall` + enqueue helper).
3. Implement it in `NodeGitLayer`.
4. Write the real-git integration test; run the full gate profile.

### Excluded scope
- Calling `diffNameStatus` from the lifecycle and writing the report (phase-04).

### Verification
The project's `full` gate profile in `phax.json`.

### Expected handoff content
- The exact `diffNameStatus` signature and the `HEAD^..HEAD` range it uses.
- The fake's `enqueueDiffNameStatus(path, entries)` helper name and semantics,
  so phase-04's integration test can drive it.
- Any deviation from the planned file lists, with the reason.

### Commit subject
feat(git): add diffNameStatus to the Git port

### Commit body
Add `Git.diffNameStatus(worktree)` returning the parsed name-status entries for
`HEAD^..HEAD`, the same range `commit.ts` uses for `diff.patch`. Implement it in
the Node adapter (runs `git diff --name-status` and parses via the reconciliation
domain) and in the fake (queue + `enqueueDiffNameStatus` helper), with a real-git
integration test. No lifecycle wiring yet.

---

## phase-04 — Wire reconciliation into the phase lifecycle {#phase-04-lifecycle-wiring}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

After every successful phase commit, compute the reconciliation and write
`file-reconciliation.json` and `file-reconciliation.md` into the phase folder
(alongside `diff.patch`). This makes the planned-vs-actual comparison a durable
per-phase artifact. Report-only: it never fails the phase.

### Detailed instructions

- Create `src/app/reconcilePhaseFiles.ts` exporting an Effect that, given the
  phase, the worktree path, and the phase folder path:
  - maps `PhaxPlanPhase` → `PlannedFiles` (`create`/`edit`/`optional` from the
    three schema arrays);
  - calls `Git.diffNameStatus(worktree)`;
  - calls `reconcile(planned, entries)` and `renderReconciliationMarkdown(...)`;
  - writes `file-reconciliation.json` (`JSON.stringify(result, null, 2)`) and
    `file-reconciliation.md` into the phase folder via `FileSystem.writeAtomic`;
  - emits an `ArtifactGenerated` telemetry event for the report, reusing
    `makeArtifactGeneratedTelemetryEvent` (match the pattern around
    `model-resolution.json` in `executePlan.ts`).
  Requirements: `Git | FileSystem | SystemTelemetry`. Error channel:
  `GitError | FsError`. Keep it a thin app wrapper, like `commit.ts`/`cleanup.ts`.
- In `src/app/executePlan.ts`, call `reconcilePhaseFiles(...)` immediately after
  the successful `commitPhase(...)` (and after the `CommitCreated`
  telemetry), before the `isFinal` branch. It runs only on the committed path —
  the no-changes case has already thrown `PhaseHadNoChangesError`. Add its error
  types to the existing `ExecutePlanError` union if not already covered.
- Add an integration test (extend `tests/integration/executePlan.test.ts` or add
  `tests/integration/reconciliation.test.ts`) that drives a phase with known
  planned lists, enqueues a known name-status set on the fake Git
  (`enqueueDiffNameStatus`), runs the phase, and asserts that
  `file-reconciliation.json`/`.md` exist in the phase folder with the expected
  created/missing/unplanned classification.

### Planned files to create
- `src/app/reconcilePhaseFiles.ts`
- `tests/integration/reconciliation.test.ts`

### Planned files to edit
- `src/app/executePlan.ts`
- `tests/integration/executePlan.test.ts`

### Optional files that may be edited
- `src/domain/telemetry/events.ts` (only if a dedicated event helper is
  preferable to reusing `makeArtifactGeneratedTelemetryEvent`)

### Boundary contracts

#### app/executePlan (consumer) → reconcile domain + Git port (producers)
- Consumer: `reconcilePhaseFiles`, needing "the report for this committed phase."
- Producers: `Git.diffNameStatus` (actual changes) and
  `reconcile`/`renderReconciliationMarkdown` (the comparison + rendering).
- Contract: phase + worktree + folder in → `file-reconciliation.{json,md}`
  written + telemetry event out. No failure on deviation (report-only).

### Test strategy
Application/integration with the fake Git and a real (temp) FileSystem: assert
the artifacts are written with correct content for a representative planned-vs-
actual mismatch. The pure comparison is already covered in phase-02.

### Implementation order
1. Write `reconcilePhaseFiles.ts` (map phase → planned, call port + domain,
   write artifacts, emit telemetry).
2. Wire the call into `executePlan.ts` after `commitPhase`.
3. Write the integration test driving the fake Git; run the full gate profile.

### Excluded scope
- The `fileReconciliation.mode` config and warn surfacing (phase-05).
- Injecting the report into the next phase's prompt (phase-05).

### Verification
The project's `full` gate profile in `phax.json`.

### Expected handoff content
- The artifact filenames (`file-reconciliation.json`, `file-reconciliation.md`)
  and their location (the phase folder), so phase-05's reader can find them.
- The `reconcilePhaseFiles` signature and exactly where it is invoked in
  `executePlan.ts`.
- Any deviation from the planned file lists, with the reason.

### Commit subject
feat(run): write a file-reconciliation report per phase

### Commit body
After each successful phase commit, compute the planned-vs-actual file
reconciliation from `git diff --name-status HEAD^ HEAD` and write
`file-reconciliation.json` and `file-reconciliation.md` into the phase folder,
emitting an artifact telemetry event. Report-only — deviations are recorded, the
phase never fails. Covered by an integration test using the fake Git.

---

## phase-05 — Reconciliation mode, warnings, and cross-phase context {#phase-05-mode-and-injection}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Add the `fileReconciliation.mode` config knob, surface a warning when
`warn` mode sees deviations, inject the previous phase's reconciliation report
into the next phase's prompt, and instruct the executing agent (in both the
prompt and the handoff skill) to explain file-plan deviations.

### Detailed instructions

- Config: in `src/schemas/phaxConfig.ts` add an optional top-level
  `fileReconciliation: Schema.optional(Schema.Struct({ mode: Schema.Literal("report_only", "warn") }))`.
  In `src/app/loadConfig.ts` resolve it onto `ResolvedConfig` as
  `fileReconciliationMode: "report_only" | "warn"` defaulting to `"report_only"`.
- Warn surface: in `reconcilePhaseFiles` (or `executePlan`), when the resolved
  mode is `"warn"` and `result.hasDeviations`, emit a warning (a telemetry
  event/log line) summarizing the deviations. Do **not** fail the phase — the
  `fail_*` modes are out of scope.
- Cross-phase injection: add `readPreviousReconciliation(runPath, phases,
  currentPhaseIndex)` to `src/app/handoffInjection.ts`, mirroring
  `readPreviousHandoff`, reading `phase-(N-1)/file-reconciliation.md` (returns
  `undefined` for phase index 0 or when absent). In `src/app/promptGeneration.ts`
  add an optional `previousReconciliation` field to `BuildPhasePromptOptions` and
  render a `## Previous phase file reconciliation` section after the previous
  handoff. Pass it through from `executePlan.ts`. Update the prompt snapshot.
- Deviation instruction: add a short "File-plan deviations" instruction to the
  phase prompt (in `promptGeneration.ts`, near the handoff requirements) and/or
  the handoff prompt (`src/app/handoffGeneration.ts` `buildHandoffPrompt`):
  the agent must explain, under `## What the next phase needs to know`, any
  planned file it did not touch and any unplanned (non-optional) file it did.
- Update `.skills/phax-phase-handoff.md` to note that file-plan deviations
  flagged by phax must be explained under "What the next phase needs to know."
- Tests: extend `tests/unit/schemas.test.ts` (config accepts a valid
  `fileReconciliation`, rejects an unknown mode), `tests/unit/loadConfig.test.ts`
  (default `report_only`, override to `warn`), and
  `tests/unit/promptGeneration.test.ts` + snapshot (the reconciliation section
  and the deviation instruction render). If `tests/unit/skills.test.ts` asserts
  handoff-skill content, keep it green.

### Planned files to create
- (none)

### Planned files to edit
- `src/schemas/phaxConfig.ts`
- `src/app/loadConfig.ts`
- `src/app/reconcilePhaseFiles.ts`
- `src/app/handoffInjection.ts`
- `src/app/promptGeneration.ts`
- `src/app/handoffGeneration.ts`
- `src/app/executePlan.ts`
- `.skills/phax-phase-handoff.md`
- `tests/unit/schemas.test.ts`
- `tests/unit/loadConfig.test.ts`
- `tests/unit/promptGeneration.test.ts`
- `tests/unit/__snapshots__/promptGeneration.test.ts.snap`

### Optional files that may be edited
- `tests/unit/skills.test.ts`
- `docs/extract-plan-model.md`
- `phax.json` (only to add a sample `fileReconciliation` block for dogfooding)

### Boundary contracts

#### phax.json (producer) → loadConfig → executePlan (consumer)
- The config supplies the mode; `ResolvedConfig.fileReconciliationMode` is the
  stable in-memory shape consumers read. Default `report_only` when absent.

#### promptGeneration (consumer) → previous phase reconciliation artifact (producer)
- Consumer: the next phase's prompt builder, needing "what the previous phase
  planned vs. actually changed."
- Producer: `phase-(N-1)/file-reconciliation.md` (written in phase-04).
- Contract: `readPreviousReconciliation(...) : Effect<string | undefined, …>`,
  rendered as a dedicated prompt section.

### Test strategy
Config → schema/contract tests; loadConfig → unit tests for default/override;
prompt → snapshot test that the new sections render. Behavior is additive and
report-only, so no new failure-path tests are needed.

### Implementation order
1. Add the config field + schema tests, then resolve it in `loadConfig` (+ test).
2. Add `readPreviousReconciliation` and the prompt section; thread
   `previousReconciliation` through `executePlan`; update the snapshot.
3. Add the warn surface in `reconcilePhaseFiles`.
4. Add the deviation instruction to the prompt/handoff and update the handoff
   skill; run the full gate profile.

### Excluded scope
- `fail_on_missing_required_created_files` / `fail_on_unexplained_deviation`
  modes and any new run-state-machine transition.
- Cumulative cross-phase aggregation (`files_*_so_far`).

### Verification
The project's `full` gate profile in `phax.json`.

### Expected handoff content
- The final `fileReconciliation.mode` config shape and the
  `ResolvedConfig.fileReconciliationMode` default.
- That the next phase's prompt now carries the previous phase's reconciliation
  report and a deviation-explanation instruction.
- Any deviation from the planned file lists, with the reason.

### Commit subject
feat(run): add reconciliation mode, warnings, and cross-phase context

### Commit body
Add an optional `fileReconciliation.mode` (`report_only` | `warn`) to phax.json,
resolve it onto ResolvedConfig (default `report_only`), warn on deviations in
`warn` mode without failing the phase, inject the previous phase's
`file-reconciliation.md` into the next phase's prompt, and instruct the agent —
in the prompt and the handoff skill — to explain file-plan deviations. Covered by
config, loadConfig, and prompt-snapshot tests.
