# Plan — Make the agent actually justify file-plan deviations, and surface the ones it skips

## Context and rationale

When a phase finishes, phax compares the files the agent actually changed against
the phase's planned-file lists and asks the agent to justify any deviation in its
`phase-handoff.md`. In practice the agent often justifies nothing. The root cause
is a sequencing/information bug, not a wording problem:

In `src/app/executePlan.ts` the per-phase order is:

1. `generatePhaseHandoff` (line ~757) — asks the agent to write the handoff and,
   *conditionally*, to "explain each deviation **if** phax reported file-plan
   deviations" (`src/app/handoffGeneration.ts:38`).
2. `commitPhase` (line ~776).
3. `reconcilePhaseFiles` (line ~798) — **this is where deviations are actually
   computed** (`git diff --name-status HEAD^ HEAD`, see `src/infra/git.ts:117`)
   and written to `file-reconciliation.{json,md}`.

So at the moment the agent is asked to justify deviations, the reconciliation has
not run yet: `file-reconciliation.json` does not exist, and the prompt contains no
list of deviating files — not even the artifact path. The agent receives a purely
conditional instruction with no data, concludes there is nothing to justify, and
writes nothing. Improving the prompt wording alone cannot fix this — there is no
deviation data in front of the agent at that point.

Reconciliation must run *after* the commit because it diffs `HEAD^..HEAD`. The fix
is therefore to **reorder** so the commit and reconciliation happen before the
handoff, and to **inject the concrete, named deviation list** into the handoff
prompt so the agent has something specific to justify.

### Decided design

- **Do not fail the run for a missing justification.** The
  `fileReconciliation.mode` knob deliberately has only `report_only` and `warn`
  (`src/app/loadConfig.ts:172`); there is intentionally no `fail` mode. A hard
  gate on justification text would be inconsistent with that and brittle (the
  agent can justify a deviation in equivalent words without echoing the exact
  path → false positives).
- Instead: **detect** which deviating files the handoff did not mention, and
  **surface** that as a non-blocking signal — a warning during the run and an
  explicit "deviations not explained" section in the run review handoff.

Implemented inside-out: first the reorder + prompt injection (so the agent is
actually able to justify), then the detect-and-surface layer on top.

## Required commands

- (none)

## phase-01 — Reorder so reconciliation precedes the handoff and inject deviations into the prompt {#phase-01-reorder-inject}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Reorder the per-phase pipeline to `commit → reconcile → handoff`, thread the
computed `ReconciliationResult` into the handoff step, and render the concrete
list of deviating files into the handoff prompt so the agent has a named,
non-conditional set of files to justify.

### Detailed instructions

- In `src/app/reconcilePhaseFiles.ts`, change `reconcilePhaseFiles` to return the
  computed `ReconciliationResult` (currently `Effect.Effect<void, …>`). Keep all
  existing side effects (writing `file-reconciliation.{json,md}`, the warn-mode
  log, the telemetry event) unchanged; only add the return value.
- In `src/app/executePlan.ts`, reorder the per-phase calls so the order becomes
  `commitPhase` → `reconcilePhaseFiles` → `generatePhaseHandoff`. Capture the
  `ReconciliationResult` from `reconcilePhaseFiles` and pass it into
  `generatePhaseHandoff`. Move the `handoff.generate` telemetry
  `StepStarted`/`StepCompleted` events with the handoff call so they still bracket
  it. Keep `committedPhases.push` and the git `commit.create` telemetry directly
  after `commitPhase`. Place the handoff after reconciliation and **before** the
  `isFinal` / `review_open` block (which currently follows reconciliation), so the
  final phase's review is opened only after its handoff is written.
- `generatePhaseHandoff` has a second caller: `adaptHandoffGenerate`
  (`src/app/eventAdapter.ts:216`) forwards a `GenerateHandoffOptions` straight
  through. Adding a required field to that options type needs no change in
  `eventAdapter.ts` itself, but it breaks the `GenerateHandoffOptions` literal
  built in `tests/integration/eventAdapter.test.ts` (around line 477) — that test
  must be updated to supply the new `reconciliation` field. (Keeping the field
  required, rather than optional, matches this repo's preference for explicit
  options; `GenerateHandoffOptions` is an in-memory type, not a persisted schema.)
- Note the consequence and confirm it is acceptable: if `commitPhase` fails with
  `PhaseHadNoChangesError`, neither reconciliation nor the handoff now runs (today
  a handoff is generated for a no-change phase, then the commit fails). Not
  generating a handoff for an empty phase is the correct behavior.
- In `src/app/handoffGeneration.ts`:
  - Add a `reconciliation: ReconciliationResult` field to
    `GenerateHandoffOptions` and pass it through.
  - Change `buildHandoffPrompt` to accept the reconciliation result and, **only
    when `result.hasDeviations` is true**, render an explicit block listing the
    deviating files by category, e.g.:
    - "phax compared the files you changed against this phase's plan and found
      these deviations. Justify each one under `## What the next phase needs to
      know`:"
    - `Unplanned files created: …`
    - `Unplanned files edited: …`
    - `Planned to create but not created: …` (from `missingPlannedCreate`)
    - `Planned to edit but not edited: …` (from `missingPlannedEdit`)
    - Omit any category whose list is empty.
  - Replace the current conditional line (`handoffGeneration.ts:38`) with this
    explicit, data-backed instruction. When there are no deviations, render an
    explicit "phax found no file-plan deviations for this phase" line (or omit the
    block) — never the old vague conditional.
- If `src/app/handoffGuidance.ts` repeats the conditional deviation phrasing
  ("If phax flagged file-plan deviations, explain each one here.",
  `handoffGuidance.ts:26`), align it with the new explicit instruction so the two
  do not contradict each other.

### Planned files to create

- (none)

### Planned files to edit

- `src/app/reconcilePhaseFiles.ts`
- `src/app/executePlan.ts`
- `src/app/handoffGeneration.ts`
- `src/app/handoffGuidance.ts`
- `tests/integration/executePlan.test.ts`
- `tests/integration/reconciliation.test.ts`
- `tests/integration/eventAdapter.test.ts`

### Optional files that may be edited

- `tests/unit/handoffGuidance.test.ts`
- `tests/integration/perPhaseBranch.test.ts`

### Boundary contracts

`reconcilePhaseFiles` (app) becomes the producer of the in-memory
`ReconciliationResult` (the existing domain type in
`src/domain/reconciliation/types.ts`); `generatePhaseHandoff` (app) becomes its
consumer, with `executePlan` orchestrating the hand-off between them. The stable
shape passed between them is `ReconciliationResult` — do not invent a new DTO.

### Test strategy

- Application/integration layer with fake ports. Update
  `tests/integration/executePlan.test.ts`: the agent-session resume for the
  handoff now happens **after** `commitPhase` and `reconcilePhaseFiles`; adjust
  any ordering assertions and the fake `git.worktreeIsClean`/`diffNameStatus`
  call sequencing accordingly (the dirty-then-clean sequence is preserved because
  the handoff step does not call `worktreeIsClean`).
- Add/extend an integration test asserting that, when the git diff diverges from
  the planned lists, the handoff prompt passed to the backend contains the named
  deviating files (write the assertion against the captured resume prompt). Write
  this assertion before wiring the prompt change.
- Update `tests/integration/reconciliation.test.ts` for the new return value if it
  asserts on `reconcilePhaseFiles`.
- Update the `GenerateHandoffOptions` literal in
  `tests/integration/eventAdapter.test.ts` to include the new `reconciliation`
  field (use a no-deviation `ReconciliationResult` so existing assertions hold).

### Implementation order

Domain type is unchanged; start at the app core: change `reconcilePhaseFiles`'s
return, then `handoffGeneration`'s prompt/options, then rewire `executePlan`, then
fix the tests outside-in.

### Excluded scope

- Detecting or surfacing *unexplained* deviations — that is phase-02.
- Any change to how deviations are computed or to the `file-reconciliation`
  artifacts' content/shape.
- Adding a `fail` reconciliation mode.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The new per-phase order in `executePlan.ts` (`commit → reconcile → handoff`) and
  why reconciliation must precede the handoff but follow the commit.
- The updated `generatePhaseHandoff` / `buildHandoffPrompt` signatures and the
  exact `GenerateHandoffOptions` field added (`reconciliation`).
- That `reconcilePhaseFiles` now returns `ReconciliationResult`.
- Any deviation from the planned file lists, with the reason.

### Commit subject

fix(handoff): inject computed deviations into the handoff prompt

### Commit body

Reorder the per-phase pipeline to commit -> reconcile -> handoff so the file
reconciliation is computed before the handoff prompt is built, and render the
concrete list of deviating files into that prompt. Previously the handoff ran
before reconciliation, so the agent was asked to justify deviations that had not
been computed yet and routinely justified nothing. reconcilePhaseFiles now returns
the ReconciliationResult for the handoff step to consume.

## phase-02 — Detect and surface deviations left unexplained in the handoff {#phase-02-surface-unexplained}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Add a non-blocking signal that flags any deviating file the handoff failed to
mention: a warning while the run executes, and an explicit section in the run
review handoff. The run never fails on this.

### Detailed instructions

- Add a pure domain module `src/domain/reconciliation/explained.ts`:
  - `deviationPaths(result: ReconciliationResult): string[]` — the union of
    `unplannedCreated`, `unplannedEdited`, `missingPlannedCreate`, and
    `missingPlannedEdit` (deduplicated, stable order).
  - `findUnexplainedDeviations(paths: readonly string[], handoffMarkdown: string):
    string[]` — the subset of `paths` not present in the handoff text. Use a
    simple, lenient `handoffMarkdown.includes(path)` substring check: this is a
    hint, not a gate, so a false "explained" is acceptable and a false "missing"
    must be cheap to ignore. No I/O — pure functions only.
- In `src/app/handoffGeneration.ts`, after the handoff is written and its required
  sections validate, compute `findUnexplainedDeviations(deviationPaths(result),
  content)`. When the list is non-empty, emit `Effect.logWarning` in the same
  style as the existing warn-mode message in `reconcilePhaseFiles.ts:57` (e.g.
  `[phax] Handoff for <phaseId> did not explain file-plan deviations: <paths>`).
  Do **not** fail; do not block; do not re-prompt the agent.
- In `src/app/reviewHandoff.ts`, add a "Deviations not explained in any handoff"
  section to the generated `review-handoff.md`. Derive it from data already in
  scope: for each entry in `global.unplanned` and `global.missing`, check whether
  the entry's `path` appears in the `phaseHandoffMd` of its relevant phase(s)
  (`touchedInPhases` for unplanned, `plannedInPhases` for missing) among the
  `phaseContents` already read in this function. List the paths whose handoff(s)
  do not mention them; render `_None._` when empty. Reuse the
  `includes`-based check from `explained.ts` rather than duplicating it.

### Planned files to create

- `src/domain/reconciliation/explained.ts`
- `tests/unit/reconciliation/explained.test.ts`

### Planned files to edit

- `src/app/handoffGeneration.ts`
- `src/app/reviewHandoff.ts`
- `tests/integration/reviewHandoff.test.ts`

### Optional files that may be edited

- `tests/integration/executePlan.test.ts`

### Boundary contracts

`explained.ts` is a pure domain module consumed by two app-layer call sites
(`handoffGeneration` for the live warning, `reviewHandoff` for the reviewer
surface). The contract is `(deviation paths, handoff text) -> unexplained paths`
with no I/O — keep all filesystem access in the app layer.

### Test strategy

- Domain: unit-test `deviationPaths` and `findUnexplainedDeviations` directly
  (explained vs. unexplained, empty inputs, a path mentioned only inside a longer
  string). Write these before the implementation.
- Application/integration: extend `tests/integration/reviewHandoff.test.ts` to
  assert the new section lists an unexplained deviating file and omits a file the
  handoff does mention. Optionally assert the warning fires in
  `tests/integration/executePlan.test.ts`.

### Implementation order

Domain helper and its unit tests first, then the `handoffGeneration` warning, then
the `reviewHandoff` surface and its integration test.

### Excluded scope

- Any blocking/gating behavior or a new `fileReconciliation.mode` value.
- New persisted artifacts or schema changes — the surface is recomputed at review
  time from existing artifacts (`file-reconciliation.json` via the global
  aggregate, and `phase-handoff.md`).
- A dedicated telemetry event type — a warning log is sufficient for this signal.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The `explained.ts` path and the exact signatures of `deviationPaths` and
  `findUnexplainedDeviations`.
- Where the live warning is emitted in `handoffGeneration.ts` and the exact
  section heading added to `review-handoff.md` in `reviewHandoff.ts`.
- Confirmation that no schema or persisted-artifact shape changed.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(handoff): surface file-plan deviations left unexplained

### Commit body

Add a pure domain helper that finds deviating files a handoff did not mention, and
surface them non-blockingly: a warning while the run executes and a "Deviations
not explained in any handoff" section in the run review handoff. The run never
fails on a missing justification, consistent with fileReconciliation having no
fail mode.
