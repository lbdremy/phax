# Plan — Resumable handoff failures (don't burn a committed phase on a transient handoff error)

## Overview

A real run (`steme-lab.steme-lab`) reached phase-04, **committed successfully**
(`status.json` state `committed`, `commitHash` present, all gates `exit 0`), and
then died during the post-commit handoff-generation step with a transient API
error — `"API Error: Connection closed mid-response"` →
`claude exited with code 1`. phax collapsed that into a run-level `RunFailed`, so
`run-status.json` shows `state: "failed"` and `resume` refuses outright
(`src/app/resume.ts:92-93`). The only recovery is `reset-phase steme-lab phase-04`,
which **deletes the good commit and worktree** and redoes the entire phase — agent,
gates, commit — purely to regenerate a missing markdown handoff.

That is the wrong cost for the failure. The phase's work is committed and safe on
its branch; only the `phase-handoff.md` artifact is missing. Resume should be able
to re-run just the handoff and continue — no reset, no lost commit, no redone work.

### Root cause — the recoverable path exists but the live path never reaches it

phax already models a recoverable handoff failure, but for an ordering the live
runner does not use:

1. **The handoff machinery assumes handoff-before-commit.** The reducer's
   `HandoffMissing` case (`src/domain/reducer.ts:524-535`) only transitions when the
   phase is `passed`, and it leaves the run `running` (phase → `handoff_failed`).
   `HandoffValidated` is likewise gated on `passed` (`reducer.ts:500-508`).

2. **But the live runner commits first, then generates the handoff.** In
   `executePlan` the order is `commitPhase` (which dispatches `CommitCreated`,
   `src/app/commit.ts:138`) at `executePlan.ts:791-792`, **then**
   `generatePhaseHandoff` at `executePlan.ts:826`. So by the time the handoff runs
   the phase is `committed`, not `passed` — the existing `HandoffMissing` transition
   would be rejected as `unexpected("handoff missing while phase is committed")`.

3. **The live runner never emits a handoff event at all.** `generatePhaseHandoff`
   is called directly at `executePlan.ts:826` with no surrounding catch.
   `HandoffValidationError` is merely listed in the effect's error union
   (`executePlan.ts:156`); a transient `AgentInvocationError` (the steme-lab case)
   is not handled either. Both propagate up to the top-level run handler and become
   `RunFailed`.

4. **The event-adapter recovery wrapper is dead code.** `adaptHandoffGenerate`
   (`src/app/eventAdapter.ts:216-285`) is the only thing that maps a handoff failure
   to a `HandoffMissing` event — and it is referenced nowhere (`grep` finds only its
   definition). Even it only catches `HandoffValidationError`; a transient
   `AgentInvocationError` is re-failed (`eventAdapter.ts:268-283`).

The irony: a transient network blip is *more* recoverable than a bad-output
validation failure (the commit already landed on the branch either way), yet it is
the one treated as terminal.

### Decisions locked in

- **Keep the commit-then-handoff ordering.** The handoff prompt is built from the
  post-commit reconciliation and is written to the gitignored `.phax-context/`
  folder; reordering to handoff-before-commit is a larger change and out of scope.
  The recovery model is therefore "committed phase, handoff outstanding."
- **A post-commit handoff failure pauses the run; it does not fail it.** When the
  handoff step fails after a successful commit, the phase becomes `handoff_failed`
  and the run becomes **`interrupted`** (a resumable state), not `failed`. This
  mirrors how a rate-limit pauses rather than fails a run.
- **`handoff_failed` is reached from `committed`, not only `passed`.** The reducer's
  handoff-failure transition is broadened to accept a `committed` phase (carrying its
  hash) and to move the run to `interrupted`. The existing `passed`-phase path is
  preserved so the (currently unused) event-adapter engine is unaffected.
- **Resume re-runs only the handoff.** On resume into a `handoff_failed` phase, the
  runner reuses the existing worktree/branch/session (exactly as resume-from-gate
  does today, `executePlan.ts:401-...`), **skips the agent, the gate loop, and the
  commit**, and re-runs `generatePhaseHandoff` against the already-persisted
  `file-reconciliation.json`. No new agent run for the body of the phase.
- **`reset-phase` remains the fallback,** unchanged — for the case where the user
  *wants* to redo the phase (e.g. to fix a content deviation). This plan only adds a
  cheaper default path; it does not remove the existing one.
- **Both transient (`AgentInvocationError`) and validation (`HandoffValidationError`)
  handoff failures are recoverable.** The commit is on a branch in both cases, so
  resume-and-retry is always safe. We do not try to classify "retryable" vs not.

## Required commands

- (none)

## phase-01 — Pause (don't fail) the run on a post-commit handoff failure {#phase-01-pause-on-handoff-failure}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** high

When `generatePhaseHandoff` fails after the phase has committed, transition the
phase to `handoff_failed` and the run to `interrupted` (resumable) instead of
letting the error propagate to `RunFailed`. Stop the run cleanly with resume
guidance, leaving the commit and worktree intact.

### Detailed instructions

- **Reducer (`src/domain/reducer.ts`).** Broaden the `HandoffMissing` case
  (`reducer.ts:524-535`): in addition to the existing `running` + `passed` →
  `handoff_failed` (run stays `running`) transition, handle `running` + `committed`
  → phase `handoff_failed`, **run `interrupted`**. The `committed` substate carries
  `{ hash }` (`src/domain/state.ts:44`); preserve nothing else is needed in
  `handoff_failed` beyond `missing` (keep `missing: event.missingSections`, which
  will be `[]` for a transient invocation failure). Do not change the `passed`
  branch. Confirm the resulting `PhaxState` (`run: "interrupted"; phase:
  handoff_failed`) is already representable (`state.ts:55-64` — `interrupted` admits
  any `PhaseSubState`).
- Verify the state matrix (`src/domain/matrix.ts`) allows `HandoffMissing` in the
  `running` run-state block, and that `interrupted` + `RunResumeRequested` is
  `Handled` (so the paused run is resumable). Adjust the matrix only if a cell is
  currently `Rejected`/missing for these events — do not loosen unrelated cells.
- **Runner (`src/app/executePlan.ts`).** Wrap the `generatePhaseHandoff` call
  (`executePlan.ts:826-835`) so that a `HandoffValidationError` **or** an
  `AgentInvocationError` is caught (use `Effect.catchTags`/`catchIf`, not a blanket
  `catchAll` — other failures must still propagate). On catch:
  - dispatch a `HandoffMissing` event (`missingSections` = the validation error's
    `missingSections` when present, else `[]`) through the same `ctx`/dispatcher
    used for `CommitCreated`, so the phase status on disk becomes `handoff_failed`
    and the run becomes `interrupted`;
  - record a `handoff.generate` step-failed telemetry event (mirror the
    success event at `executePlan.ts:836-843`);
  - **break out of the phase loop cleanly** — return from the run as a paused/
    interrupted run (the same clean-exit shape used for the rate-limit pause path,
    `executePlan.ts:977-1012`), rather than `Effect.fail`. The run must end in
    `interrupted`, not `failed`.
- Do **not** write `agent-error.log` suppression or otherwise interfere with
  plan 31's durable error log — if that has landed, the transient stderr will still
  be captured; this phase only changes the *control-flow* classification.
- Remove the dead `adaptHandoffGenerate` (`src/app/eventAdapter.ts:216-285`) **only
  if** knip already flags it and removing it does not perturb the matrix/event
  imports; otherwise leave it and note it in the handoff. (It is not on the live
  path either way.)

### Planned files to create

- `tests/unit/reducerHandoffPause.test.ts`

### Planned files to edit

- `src/domain/reducer.ts`
- `src/app/executePlan.ts`

### Optional files that may be edited

- `src/domain/matrix.ts`
- `src/app/eventAdapter.ts`

### Boundary contracts

Producer: `executePlan`, which alone knows the handoff step failed after a
successful commit. Consumer: the reducer, which turns the `HandoffMissing` event
into the persisted phase state `handoff_failed` + run state `interrupted`. The
stable contract is "a post-commit handoff failure leaves a committed phase marked
`handoff_failed` and a resumable `interrupted` run"; phase-02 (resume) depends on
exactly that on-disk shape.

### Test strategy

Domain: unit-test the reducer (write first) — `HandoffMissing` from
`{ run: running, phase: { committed, hash } }` yields
`{ run: interrupted, phase: { handoff_failed, missing: [] } }`; the existing
`passed`-phase path is unchanged; `HandoffMissing` from other phase states stays
`unexpected`. The runner's clean-exit branch is exercised by the phase-02
integration test (resume needs a paused run to resume from); a standalone runner
test here would require a full fake agent and is deferred to that integration test.

### Implementation order

Reducer transition + its unit test first (this defines the on-disk contract
phase-02 reads), then the matrix check, then the `executePlan` catch-and-pause.

### Excluded scope

- Re-running the handoff on resume (phase-02).
- Any change to commit-then-handoff ordering.
- Classifying which agent errors are "retryable".

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact reducer transition added (`running`+`committed` → `interrupted`+
  `handoff_failed`) and confirmation the `passed` path is untouched.
- The persisted on-disk shape after a paused handoff: phase `status.json` state
  `handoff_failed` (with `commitHash`, `worktreePath`, `claudeSessionId` retained)
  and `run-status.json` state `interrupted`.
- Whether `adaptHandoffGenerate` was removed or left, with the reason.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(run): pause instead of failing the run on a post-commit handoff error

### Commit body

When phase handoff generation fails after the phase has already committed, the run
now transitions the phase to handoff_failed and the run to interrupted (resumable)
instead of collapsing to RunFailed. The reducer's HandoffMissing transition is
broadened to accept a committed phase and move the run to interrupted; executePlan
catches the handoff validation/invocation error and ends the run as a clean pause
with the commit and worktree intact. Covered by a reducer unit test.

## phase-02 — Resume re-runs only the handoff for a handoff_failed phase {#phase-02-resume-handoff-only}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** high

Teach `executePlan`'s resume entry to recognise a phase persisted as
`handoff_failed`, reuse its existing worktree/branch/session, skip the agent, gate
loop, and commit, and re-run only `generatePhaseHandoff` before continuing to the
next phase.

### Detailed instructions

- **Resume detection (`executePlan.ts:341-356`).** Alongside the existing
  `gates_exhausted` → `resumeFromGate` branch, add a `handoff_failed` →
  `resumeFromHandoff` branch that captures `resumeSessionId`/`resumeWorktreePath`
  from the persisted `phaseStatus` (same fields read today). Thread a
  `resumeFromHandoff` flag to an `isResumeFromHandoff = i === startIndex &&
  resumeFromHandoff` local mirroring `isResumeFromGate` (`executePlan.ts:380`).
- **Phase setup reuse.** In the `isResumeFromGate` setup branch
  (`executePlan.ts:401-...`) the worktree/branch/prompt/session are reused rather
  than recreated — extend that same branch to also apply when
  `isResumeFromHandoff` (i.e. "this phase already has a live worktree + commit, do
  not recreate it"). Confirm no fresh worktree/branch is created for a
  resume-from-handoff phase.
- **Skip body, run handoff.** When `isResumeFromHandoff`, skip the agent invocation,
  skip `runGatesWithFixLoop` (`executePlan.ts:776-789`), and skip `commitPhase`
  (`executePlan.ts:791-792`) — the commit already exists. Jump to the handoff step
  (`executePlan.ts:823-843`). Reconstruct the `reconciliation` argument from the
  already-persisted `file-reconciliation.json` in the phase folder rather than
  recomputing it from a fresh diff (the diff/reconciliation were written on the
  original attempt; read and decode them through the existing schema/port). If
  reading the persisted reconciliation is impractical, recompute it from the
  committed diff — but document which path was taken.
- On successful handoff, dispatch `HandoffValidated` so the phase returns to a
  terminal committed/handed-off state, lift the run back to `running` for the
  remainder of the loop (the `RunResumeRequested` dispatch at
  `executePlan.ts:363-366` already lifts `interrupted` → `running`; confirm it
  applies for a `handoff_failed` resumed phase), and fall through to the normal
  `isFinal`/next-phase flow.
- **Resume guard (`src/app/resume.ts`).** `findNextResumablePhase`
  (`resume.ts:48-78`) returns the first non-terminal phase; `handoff_failed` is not
  in `TERMINAL_PHASE_STATES` (`src/domain/state.ts:151-156`), so the
  `handoff_failed` phase is selected automatically — confirm this and add no
  special-case. Confirm the `interrupted` run state is accepted by the resume
  refusal guard (`resume.ts:80-97` has no `interrupted` refusal, so it passes).
- **CLI guidance.** Where the run command prints next-step guidance after a pause,
  ensure a handoff-paused run tells the user to `phax resume <short-name>` (not
  `reset-phase`). Reuse the existing rate-limit/interrupt resume-hint rendering if
  present; do not add a bespoke message format.

### Planned files to create

- `tests/integration/resumeHandoff.test.ts`

### Planned files to edit

- `src/app/executePlan.ts`

### Optional files that may be edited

- `src/app/resume.ts`
- `src/cli/commands/run.ts`
- `src/cli/commands/resume.ts`

### Boundary contracts

Producer: phase-01's on-disk shape — a `handoff_failed` phase status (with
`commitHash`, `worktreePath`, `claudeSessionId`) under an `interrupted` run.
Consumer: `executePlan`'s resume entry, which must reuse that worktree/session and
re-run only the handoff. The stable contract is "a `handoff_failed` phase is resumed
by re-running `generatePhaseHandoff` against its persisted reconciliation, without a
new agent body run or a second commit."

### Test strategy

Application command, integration test (write first): construct a run folder where
phase-01 is `committed`+`handoff_failed` (status.json with `commitHash`,
`worktreePath`, `claudeSessionId`, plus a `file-reconciliation.json`) under an
`interrupted` run, with a live worktree and a fake agent whose handoff call now
succeeds. Assert `phax resume` re-runs the handoff (writes `phase-handoff.md`),
creates **no** second commit on the phase branch, does **not** re-invoke the agent
for the phase body, transitions the phase out of `handoff_failed`, and proceeds to
the next phase. Add a focused assertion that resume-from-gate behaviour is
unchanged.

### Implementation order

Write the failing integration test reproducing steme-lab (paused handoff → resume),
then add the `resumeFromHandoff` detection and skip-to-handoff branch, then the CLI
guidance.

### Excluded scope

- The pause/classification itself (phase-01).
- `reset-phase` behaviour (unchanged; remains the redo-the-whole-phase fallback).
- Retrying the handoff automatically in-process without an explicit `resume`.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- How `reconciliation` is reconstructed on resume (persisted
  `file-reconciliation.json` vs recomputed), and the decode path used.
- Confirmation that resume-from-handoff creates no second commit and no fresh
  worktree, and that resume-from-gate is unaffected.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(resume): re-run only the handoff for a handoff_failed phase

### Commit body

phax resume now recognises a phase paused in handoff_failed, reuses its existing
worktree, branch, session, and commit, and re-runs only generatePhaseHandoff against
the persisted reconciliation before continuing to the next phase. A transient
handoff failure no longer requires reset-phase (which deletes the good commit and
redoes the whole phase); resume recovers it cheaply. Covered by an integration test
that asserts no second commit and no fresh agent body run.
