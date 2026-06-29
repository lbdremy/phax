# Plan — Resumable post-gate failures (a phase that passed its gate must never burn on commit or cleanup)

## Overview

A real run (`steme-lab.steme-lab`) reached phase-05, **passed its gate** (phase
`status.json` state `passed`, all `full`-profile checks `exit 0`), and then died at
the `git commit` step: the target repo's `lefthook` pre-commit hook ran
`oxfmt --check`/`oxlint` directly on the staged files and rejected them
(unformatted JSON + a `__dirname` lint warning). phax collapsed that into a
run-level `RunFailed`, so `run-status.json` showed `state: "failed"` and `resume`
refused outright (`src/app/resume.ts:92-93`). The only offered recovery was
`reset-phase steme-lab phase-05`, which **deletes the completed agent work and
worktree** and redoes the entire phase — agent, gate, commit — purely because the
final mechanical commit step failed. (The run was recovered by hand: format the
files, commit on the phase branch, and edit the persisted state to `committed` +
`interrupted`.)

That is the wrong cost for the failure. The phase's work is done and gated; only
the post-gate mechanical steps (commit, cleanup) remained. Resume should re-run
just those steps and continue — no reset, no lost work.

This plan generalises the principle already locked in by **plan 32**
(`docs/plans/32-resumable-handoff-failure-plan.md`): *a post-gate failure pauses
the run to `interrupted` rather than failing it, and resume re-runs only the
missing step.* Plan 32 covers the **handoff** step. This plan covers the other two
post-gate steps in the per-phase sequence `commit → handoff → cleanup`
(`src/app/executePlan.ts:791-792`, `:824-835`, `:925`): the **commit** step and
the **cleanup** step.

### Root cause — the pause path exists, but only three failures reach it

`executePlan` already models "pause, don't fail" for three error classes, each
caught *before* the catch-all that emits `RunFailed`:

1. **Rate/usage limit** (`executePlan.ts:964-979`) → dispatches `RateLimitDetected`
   → run `rate_limited` (resumable), worktree/session preserved.
2. **No-changes** (`executePlan.ts:984-988`) → `PhaseHadNoChanges` already
   dispatched inside `commitPhase` (`src/app/commit.ts:100-127`) → run
   `interrupted`, phase `skipped`.
3. **Gate exhaustion** (`executePlan.ts:994-998`) → `FixAttemptsExhausted`
   dispatched inside the fix loop → run `interrupted`, phase `gates_exhausted`.

Every other failure falls through to the top-level `tapError`
(`executePlan.ts:999-1013`), which sets the agent binding to `failed` and
dispatches `RunFailed` → terminal. A commit-step failure (a `GitError`/`ShellError`
from `commitPhase`, *not* `PhaseHadNoChangesError`) and a cleanup-step failure (a
`SetupCommandFailedError`/`ArchiveBlockedByDirtyWorktreeError`/`GitError`/`ShellError`
from `cleanupPhase`) both take this terminal path today.

### The state representations already (mostly) exist

- **Commit failure.** `commitPhase` dispatches `CommitCreated` only *after*
  `git.commit` succeeds (`commit.ts:128-145`). When the commit fails, the phase is
  still `passed` — which is **non-terminal** (`TERMINAL_PHASE_STATES`,
  `src/domain/state.ts:151-156`), so `findNextResumablePhase`
  (`src/app/resume.ts:48-78`) already selects it. The phase needs no new state; we
  only need to (a) pause instead of fail, and (b) teach resume to re-run the
  commit (and the steps after it) for a `passed` phase.
- **Cleanup failure.** `CleanupStarted` (dispatched at the *start* of `cleanupPhase`,
  `src/app/cleanup.ts`) already moves the phase `committed → cleaning_up`
  (`reducer.ts:578-600`). `cleaning_up` is **non-terminal**, so a cleanup failure
  can rest the phase there and resume will select it. The one edge: `cleanupPhase`'s
  initial dirty-worktree guard fails *before* dispatching `CleanupStarted`, so the
  phase is still `committed` (terminal) in that case — the pause transition must
  lift `committed → cleaning_up` as well, so resume can pick it up.

### Decisions locked in

- **Gate-pass is the point of no return.** Once a phase's gate passes, a failure in
  any later step (commit, handoff, cleanup) pauses the run to `interrupted`
  (resumable) and surfaces the error in `resume-instructions.md`; it never produces
  a terminal `RunFailed`. The human inspects the error, fixes it (e.g. in the
  worktree), and runs `phax resume`. This mirrors the rate-limit/no-changes pause.
- **Commit failure leaves the phase `passed`.** No new phase state. The pause
  transition is `running`+`passed` → `interrupted`+`passed`. Resume re-runs
  `commit → handoff → cleanup` for that phase.
- **Cleanup failure rests the phase in `cleaning_up`.** The pause transition lifts
  `running`+(`committed`|`cleaning_up`) → `interrupted`+`cleaning_up`. Resume
  re-runs only `cleanup`. (Chosen over "log and continue" so a failing cleanup
  command is not silently swallowed.)
- **Two new explicit events, `CommitFailed` and `CleanupFailed`.** Rather than
  overload an existing event, add explicit events — consistent with phax's
  explicit-per-variant doctrine. Each forces a new column in the disposition matrix
  (`src/domain/matrix.ts`); fill every cell deliberately (`Unexpected`/`Stale`
  away from `running`, `Handled` in `running`).
- **Detection is scoped to the call site, type-based.** Wrap the `commitPhase` and
  `cleanupPhase` calls with a local `Effect.catchIf`/`catchTags` that converts the
  step's own error into the pause dispatch — never a blanket top-level
  `catchAll`. Unrelated `GitError`/`ShellError` raised elsewhere must still go
  terminal. Explicitly exclude `PhaseHadNoChangesError` from the commit catch (it is
  already handled).
- **Clean exit, non-zero code.** After dispatching the pause event, re-raise a
  recognised sentinel so the top-level handler skips `RunFailed` (extend the
  `isNoChangesError || isGateAttemptsExhaustedError` guard at
  `executePlan.ts:999-1001`) while the CLI still exits non-zero — exactly how the
  no-changes and gate-exhaustion pauses behave today.
- **`reset-phase` remains the fallback, unchanged** — for when the user wants to
  redo the phase rather than retry the failed step.
- **Out of scope: handoff failures** (plan 32) and the **final phase's review-open
  step** (a distinct path, `executePlan.ts:858-924`); reordering commit/handoff;
  classifying which errors are "retryable".

## Required commands

- (none)

## phase-01 — Pause (don't fail) the run on a commit-step failure {#phase-01-commit-pause}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** high

When the commit step fails after the phase has passed its gate (a hook rejection,
signing failure, index lock, or any non-"no-changes" `git commit` error),
transition the run to `interrupted` while leaving the phase `passed`, write
`resume-instructions.md`, and end the run as a clean pause — instead of letting the
error reach `RunFailed`. The commit work stays staged in the worktree, intact.

### Detailed instructions

- **Event (`src/domain/events.ts`).** Add a `CommitFailed` event carrying at least
  `{ phaseId, worktreePath, sessionId, reason }` (mirror `PhaseHadNoChanges`'s
  payload, `events.ts` near the `PhaseHadNoChanges` definition). It is produced only
  by the runner when `commitPhase` fails for a reason other than no-changes.
- **Reducer (`src/domain/reducer.ts`).** Add a `CommitFailed` case modelled on
  `PhaseHadNoChanges` (`reducer.ts:625-664`): from `running`+`passed`, return
  `handled({ run: "interrupted", phase: { state: "passed" } })` — phase stays
  `passed`, not `skipped` — with effects: `PersistState`
  (`stoppedReason: "commit_failed"`, `lastError: event.reason`),
  `WriteResumeInstructions` (`kind: "commit_failed"`, `phaseId`, `worktreePath`,
  `sessionId`), and the two `EmitTrace` effects (`commit.failed` on the `commit`
  boundary, `resume.available`). For every non-`running` run state return
  `unexpected`/`stale` exactly as the `PhaseHadNoChanges` case does.
- **Resume-instructions kind (`src/domain/effects.ts:13`).** Extend the
  `ResumeInstructionsCtx` `kind` union to add `"commit_failed"`. Update the resume
  instructions renderer (wherever `kind` is switched, the adapter that consumes
  `WriteResumeInstructions`) so `commit_failed` produces guidance: the commit step
  failed after the gate passed; inspect the error, fix the worktree at
  `<worktreePath>`, then `phax resume <short-name>`.
- **Matrix (`src/domain/matrix.ts`).** Add the `CommitFailed` column to every
  run-state row. `Handled` under `running`; `Unexpected` under `created`/`review_open`;
  `Stale` under `failed`/`completed`/`stopped`/`archived`/`interrupted`/`rate_limited`
  — matching the disposition kinds the new reducer case returns for the
  representative state.
- **Runner (`src/app/executePlan.ts`).** Wrap the `commitPhase` call
  (`executePlan.ts:791-792`) with `Effect.catchIf` that fires on the commit step's
  own errors (`GitError`/`ShellError`/`FsError`) **but not** `PhaseHadNoChangesError`
  (let that propagate to its existing handler). On catch: dispatch `CommitFailed`
  (reason = the error's message) through the same `ctx`/dispatcher already used for
  `CommitCreated`, record a `commit.create` step-failed telemetry event (mirror the
  success event at `executePlan.ts:805-815`), then re-raise the original error.
- **Top-level guard (`executePlan.ts:999-1001`).** Extend the predicate that skips
  the `RunFailed` `tapError` so it also returns `Effect.void` for a commit-step
  pause — introduce an `isCommitPausedError` predicate (or reuse a tagged sentinel)
  so the paused commit error re-raises for a non-zero exit code without dispatching
  `RunFailed`. Do not patch the agent binding to `failed` for this case.

### Planned files to create

- `tests/unit/reducerCommitPause.test.ts`

### Planned files to edit

- `src/domain/events.ts`
- `src/domain/reducer.ts`
- `src/domain/matrix.ts`
- `src/domain/effects.ts`
- `src/app/executePlan.ts`

### Optional files that may be edited

- the resume-instructions renderer adapter (wherever `ResumeInstructionsCtx.kind` is switched)

### Boundary contracts

Producer: `executePlan`, which alone knows the commit step failed after a passed
gate. Consumer: the reducer, which turns `CommitFailed` into persisted phase state
`passed` (unchanged) + run state `interrupted`. The stable contract is "a commit
failure on a passed phase leaves the phase `passed` and the run `interrupted`,
resumable"; phase-02 depends on exactly that on-disk shape.

### Test strategy

Domain first (write the test before the reducer change): `CommitFailed` from
`{ run: running, phase: { passed } }` yields `{ run: interrupted, phase: { passed } }`
with the `PersistState`/`WriteResumeInstructions`/`EmitTrace` effects; `CommitFailed`
from other phase/run states stays `unexpected`/`stale`. Matrix audit test passes
with the new column. The runner clean-exit branch is exercised by the phase-02
integration test (resume needs a paused run); a standalone runner unit test would
need a full fake agent and is deferred there.

### Implementation order

Event + reducer case + its unit test first (defines the on-disk contract), then the
matrix column and effects kind, then the `executePlan` catch-and-pause and the
top-level guard.

### Excluded scope

- Re-running the commit on resume (phase-02).
- Cleanup-step failures (phase-03).
- Handoff failures (plan 32).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact `CommitFailed` reducer transition added (`running`+`passed` →
  `interrupted`+`passed`) and confirmation no other phase/run cell changed.
- The persisted on-disk shape after a paused commit: phase `status.json` state
  `passed` (with `worktreePath`, `claudeSessionId` retained, no `commitHash`) and
  `run-status.json` state `interrupted`, `stoppedReason: "commit_failed"`.
- The predicate/sentinel name used to skip `RunFailed` for the commit pause.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(run): pause instead of failing the run on a commit-step failure

### Commit body

When a phase's commit step fails after the gate has passed (e.g. a pre-commit hook
rejection), the run now transitions to interrupted (resumable) with the phase left
passed, instead of collapsing to RunFailed. Adds a CommitFailed event and reducer
transition (running+passed → interrupted+passed) with resume instructions, fills
the disposition matrix, and wraps the commitPhase call to dispatch the pause and
end the run cleanly while excluding the existing no-changes path. Covered by a
reducer unit test.

## phase-02 — Resume re-runs commit → handoff → cleanup for a passed phase {#phase-02-resume-from-commit}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** high

Teach `executePlan`'s resume entry to recognise a phase persisted as `passed`,
reuse its existing worktree/branch/session, skip the agent and the gate loop, and
re-run the post-gate sequence (`commitPhase`, then handoff, then cleanup) before
continuing to the next phase.

### Detailed instructions

- **Resume detection (`executePlan.ts:341-356`).** Alongside the existing
  `gates_exhausted` → `resumeFromGate` branch, add a `passed` → `resumeFromCommit`
  branch that captures `resumeSessionId`/`resumeWorktreePath` from the persisted
  `phaseStatus` (same fields read today). Thread a `resumeFromCommit` flag to an
  `isResumeFromCommit = i === startIndex && resumeFromCommit` local mirroring
  `isResumeFromGate` (`executePlan.ts:380`).
- **Phase setup reuse.** Extend the resume-reuse setup branch
  (`executePlan.ts:401-...`, currently guarded by `isResumeFromGate`) to also apply
  when `isResumeFromCommit`: reuse the existing worktree/branch/prompt/session;
  create no fresh worktree or branch. Reconstruct `agentOptions` from the persisted
  `agent-binding.json` exactly as the resume-from-gate path does (so subsequent
  steps that read it still work), even though the agent itself is not invoked.
- **Skip body, run post-gate steps.** When `isResumeFromCommit`, skip the agent
  invocation and skip `runGatesWithFixLoop` (`executePlan.ts:776-789`) — the phase
  already passed its gate. Do **not** dispatch `GatePassed` again (the phase is
  already `passed`). Fall straight into the existing `commitPhase`
  (`executePlan.ts:791-792`) → handoff (`:823-843`) → cleanup (`:925`) path, which
  runs unchanged. `commitPhase` re-checks `worktreeIsClean` (`commit.ts:100`): the
  staged changes are still present, so it commits normally; if the worktree is
  unexpectedly clean (e.g. the user committed by hand during recovery) it raises
  `PhaseHadNoChangesError`, which keeps its existing meaning — document this edge in
  the handoff.
- **Resume guard (`src/app/resume.ts`).** `findNextResumablePhase`
  (`resume.ts:48-78`) already returns the first non-terminal phase; `passed` is not
  in `TERMINAL_PHASE_STATES` (`state.ts:151-156`), so the paused phase is selected
  automatically — confirm and add no special case. Confirm the `interrupted` run
  state passes the refusal guard (`resume.ts:80-97` has no `interrupted` refusal).
- **Lift to running.** Confirm the `RunResumeRequested` dispatch
  (`executePlan.ts:363-366`) lifts `interrupted`+`passed` → `running`+`passed` (the
  reducer's `RunResumeRequested`/`interrupted` case preserves the phase substate,
  `reducer.ts:66-70`) so the post-gate steps run under a `running` run.
- **CLI guidance.** Ensure a commit-paused run's next-step guidance points to
  `phax resume <short-name>` (not `reset-phase`). Reuse the existing
  rate-limit/interrupt resume-hint rendering; do not add a bespoke message format.

### Planned files to create

- `tests/integration/resumeFromCommit.test.ts`

### Planned files to edit

- `src/app/executePlan.ts`

### Optional files that may be edited

- `src/app/resume.ts`

### Boundary contracts

Consumer: resume reads a phase persisted as `passed` on an `interrupted` run and
must re-enter the post-gate sequence without re-invoking the agent. Producer:
phase-01's pause writes exactly that shape. The stable contract is the on-disk
`passed`/`interrupted` pair plus the retained `worktreePath`/`claudeSessionId`.

### Test strategy

Integration (application command with fake ports): seed a run paused after a commit
failure (phase `passed`, run `interrupted`, worktree present), run resume, and
assert the agent is not invoked, the gate loop does not run, `commitPhase` runs and
the phase advances to `committed` → `cleaned_up`, and the run proceeds to the next
phase. Cover the clean-worktree edge (resume after a manual commit) yields the
existing no-changes pause.

### Implementation order

Resume detection + setup-reuse first, then the skip-body wiring, then the
integration test green; confirm the resume guard needs no change last.

### Excluded scope

- Cleanup-step failures and their resume (phase-03).
- Any change to commit-then-handoff ordering.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The `resumeFromCommit` detection + `isResumeFromCommit` wiring, and confirmation
  the agent and gate loop are skipped while `commitPhase`/handoff/cleanup run.
- How `agentOptions` is reconstructed on a resume-from-commit phase.
- The clean-worktree edge behaviour (manual commit during recovery → no-changes
  pause) and whether any guard was added.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(run): resume re-runs the post-gate steps for a commit-paused phase

### Commit body

Teach executePlan's resume entry to recognise a phase persisted as passed on an
interrupted run, reuse its worktree/branch/session, skip the agent and gate loop,
and re-run commitPhase then handoff then cleanup before continuing. findNextResumablePhase
already selects the passed phase; the RunResumeRequested dispatch lifts the run to
running with the phase substate preserved. Covered by a resume integration test
including the manual-commit clean-worktree edge.

## phase-03 — Pause and resume on a cleanup-step failure {#phase-03-cleanup-pause-resume}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** high

When the cleanup step fails after the phase has committed, rest the phase in
`cleaning_up` and the run in `interrupted` instead of failing the run, and teach
resume to re-run only cleanup for a `cleaning_up` phase.

### Detailed instructions

- **Event (`src/domain/events.ts`).** Add a `CleanupFailed` event carrying
  `{ phaseId, worktreePath, reason }` (no session needed; cleanup runs no agent).
- **Reducer (`src/domain/reducer.ts`).** Add a `CleanupFailed` case: from `running`
  with phase `committed` **or** `cleaning_up`, return
  `handled({ run: "interrupted", phase: { state: "cleaning_up" } })` with effects
  `PersistState` (`stoppedReason: "cleanup_failed"`, `lastError: event.reason`),
  `WriteResumeInstructions` (`kind: "cleanup_failed"`), and the `EmitTrace` pair
  (`cleanup.failed` on the `cleanup` boundary, `resume.available`). Accepting both
  `committed` and `cleaning_up` covers the dirty-worktree guard that fails before
  `CleanupStarted` (phase still `committed`) and a cleanup-command failure after it
  (phase `cleaning_up`). Non-`running` run states return `unexpected`/`stale` as the
  sibling cases do.
- **Resume-instructions kind (`src/domain/effects.ts:13`).** Add `"cleanup_failed"`
  to the `kind` union and render guidance (cleanup failed after the commit landed;
  the commit is safe on its branch; fix the cause, then `phax resume`).
- **Matrix (`src/domain/matrix.ts`).** Add the `CleanupFailed` column to every
  run-state row, `Handled` under `running` and `Unexpected`/`Stale` elsewhere to
  match the reducer.
- **Runner — pause (`src/app/executePlan.ts`).** Wrap the `cleanupPhase` call
  (`executePlan.ts:925`) with `Effect.catchIf` on its own error set
  (`SetupCommandFailedError`/`ArchiveBlockedByDirtyWorktreeError`/`GitError`/`ShellError`/`FsError`).
  On catch: dispatch `CleanupFailed` (reason = the error message), record a
  `cleanup` step-failed telemetry event, then re-raise as the recognised pause
  sentinel. Extend the top-level guard (`executePlan.ts:999-1001`) so a cleanup
  pause skips `RunFailed` and does not patch the binding to `failed`.
- **Runner — resume (`executePlan.ts:341-356`, `:401-...`).** Add a `cleaning_up` →
  `resumeFromCleanup` detection branch and `isResumeFromCleanup` local. Reuse the
  existing worktree/branch (the commit and handoff already exist). When
  `isResumeFromCleanup`, skip the agent, gate loop, `commitPhase`, **and** the
  handoff step (`executePlan.ts:823-843`) — only `cleanupPhase` remains. On resume,
  `cleanupPhase` re-dispatches `CleanupStarted`; confirm the reducer accepts
  `CleanupStarted` from a `cleaning_up` phase after `RunResumeRequested` lifts the
  run to `running` (it lifts `interrupted`+`cleaning_up` → `running`+`cleaning_up`,
  and `CleanupStarted` currently requires `committed`). If `CleanupStarted` is
  rejected from `cleaning_up`, broaden that reducer case to treat `cleaning_up` as
  idempotent (`Handled`/`Ignored`), or skip re-dispatching `CleanupStarted` on the
  resume path — pick one and document it.
- **Resume guard (`src/app/resume.ts`).** `cleaning_up` is non-terminal
  (`state.ts:151-156`) so it is selected automatically — confirm, no special case.

### Planned files to create

- `tests/unit/reducerCleanupPause.test.ts`
- `tests/integration/resumeFromCleanup.test.ts`

### Planned files to edit

- `src/domain/events.ts`
- `src/domain/reducer.ts`
- `src/domain/matrix.ts`
- `src/domain/effects.ts`
- `src/app/executePlan.ts`

### Optional files that may be edited

- `src/app/resume.ts`
- the resume-instructions renderer adapter

### Boundary contracts

Producer: `executePlan`, which knows cleanup failed on a committed phase. Consumer:
the reducer, which marks the phase `cleaning_up` + run `interrupted`. The stable
contract is "a cleanup failure leaves a committed phase in `cleaning_up` and a
resumable `interrupted` run"; the resume path depends on that shape and on the
commit/handoff artifacts already being present.

### Test strategy

Domain first: `CleanupFailed` from `{ running, committed }` and `{ running,
cleaning_up }` both yield `{ interrupted, cleaning_up }` with the expected effects;
other states stay `unexpected`/`stale`; matrix audit passes with the new column.
Integration: seed a run paused after a cleanup failure (phase `cleaning_up`, commit
+ handoff present), resume, and assert only cleanup runs (no agent, no gate, no
re-commit, no re-handoff), the phase reaches `cleaned_up`, and the run continues.

### Implementation order

Event + reducer case + unit test, then matrix and effects kind, then the runner
pause catch, then the resume-from-cleanup path and its integration test; resolve
the `CleanupStarted`-from-`cleaning_up` idempotency question while wiring resume.

### Excluded scope

- Commit-step failures (phase-01/02) and handoff failures (plan 32).
- The final phase's review-open step.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The `CleanupFailed` reducer transition (both `committed` and `cleaning_up`
  sources → `interrupted`+`cleaning_up`) and the matrix column added.
- How the resume path avoids re-running commit/handoff, and the resolution of the
  `CleanupStarted`-from-`cleaning_up` idempotency question (broadened reducer case
  vs. skip re-dispatch), with the reason.
- The persisted on-disk shape after a paused cleanup: phase `status.json` state
  `cleaning_up` (with `commitHash` retained) and `run-status.json` `interrupted`,
  `stoppedReason: "cleanup_failed"`.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(run): pause and resume on a cleanup-step failure instead of failing the run

### Commit body

When a phase's cleanup step fails after the commit landed, the run now rests the
phase in cleaning_up and the run in interrupted (resumable) instead of RunFailed,
and resume re-runs only cleanup. Adds a CleanupFailed event and reducer transition
(running+committed|cleaning_up → interrupted+cleaning_up) with resume instructions,
fills the disposition matrix, wraps the cleanupPhase call to pause cleanly, and adds
a resume-from-cleanup path that skips agent, gate, commit, and handoff. Covered by
reducer unit tests and a resume integration test.
