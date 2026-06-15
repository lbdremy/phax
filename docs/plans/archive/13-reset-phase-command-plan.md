# Plan 13 — `phax reset-phase` command

## Problem

Some failures are not recoverable by a gate-first resume (Plan 12). The clearest
case: a phase paused in `gates_exhausted` whose Claude session was lost — there is
no session context to drive a correct fix, so Plan 12 deliberately fails resume.
There is also the genuinely terminal `failed` run, which `resume.ts` refuses
outright. In both cases the operator's only option today is to start a brand-new
run, discarding every committed earlier phase.

## Desired behavior

A `phax reset-phase <short-name> [phase-id]` command that **resets a single
phase** so that `phax resume` re-executes it from scratch, branched off the last
completed phase. Concretely it: archives the phase's existing artifacts (logs,
prompt, jsonl) so nothing is silently lost, removes the phase worktree, deletes
the phase branch, drops the phase's on-disk status, and flips the run back to a
resumable state. The next `phax resume` then sees the phase as "not started"
(`findNextResumablePhase` returns it with no worktree), re-creates its branch off
the previous phase's branch, and runs the implementation agent fresh.

This is the escape hatch Plan 12's lost-session and terminal-`failed` paths point
at. It complements Plan 12: gate-first resume handles "human fixed the gate";
reset-phase handles "this phase must be redone from zero".

## Scope decisions

- **Target selection.** With no `phase-id`, reset the run's current
  non-`committed`/`cleaned_up` phase (the failed/exhausted one). An explicit
  `phase-id` resets that phase; it must be the latest non-completed phase (we do
  not support resetting a phase behind an already-committed later phase, which
  would orphan commits).
- **Resettable states.** Allow reset from `failed`, `gates_exhausted`,
  `handoff_failed`, and `gates_failed`. Refuse `committed` / `cleaned_up` /
  `passed` / `skipped` (nothing to redo) and in-flight `running` / `fixing`
  (stop the run first).
- **Preserve artifacts.** Archive the phase folder to
  `<phaseId>.reset-<timestamp>/` rather than deleting it, so prompts and logs
  survive for inspection.
- **Confirmation.** Destructive (removes a worktree + branch); require `--yes`
  or an interactive confirmation, matching `resume`'s `--yes` convention.

## Affected gate profile

All phases verify against the project's configured `full` gate profile in
`phax.json`.

---

## phase-01 — Git port: delete branch {#phase-01-git-delete-branch}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

Add a `deleteBranch` capability to the Git port so the reset command can remove a
phase branch after its worktree is gone. The port currently exposes
`removeWorktree` but no branch deletion.

### Detailed instructions

- In `src/ports/git.ts`, add
  `deleteBranch(name: BranchName, force: boolean, repo: string): Effect.Effect<void, GitError>`.
- Implement it in `src/infra/git.ts` as `git branch -D/-d <name>` (force selects
  `-D`) run in `repo`, mapping failures to `GitError` consistently with
  `removeWorktree`.
- Implement it in `src/infra/fakes/git.ts`: record the deleted branch in the
  fake's state so app-layer tests can assert on it.

### Planned files to create

- (none)

### Planned files to edit

- `src/ports/git.ts`
- `src/infra/git.ts`
- `src/infra/fakes/git.ts`
- `tests/integration/gitDiffNameStatus.test.ts`

### Optional files that may be edited

- (none)

### Boundary contracts

Producer: the Git adapter provides branch deletion. Consumer: `resetPhase`
(phase-03) deletes the phase branch after removing the worktree. Stable shape:
`deleteBranch(name, force, repo) → Effect<void, GitError>`, force ⇒ `-D`.

### Test strategy

Ports / adapters → an integration test against a temp git repo: create a branch,
`deleteBranch(force=true)`, assert it is gone; assert a `GitError` on a missing
branch with `force=false`. (Reuse the existing git integration test module.)

### Implementation order

Port signature → real adapter → fake → tests.

### Excluded scope

- Any reset orchestration (phase-03) and CLI wiring (phase-04).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact `deleteBranch` signature and the fake's recorded-deletions accessor
  used by later tests.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(git): add deleteBranch to the Git port and adapters

### Commit body

Add a deleteBranch capability to the Git port with real and fake adapter
implementations so phase reset can remove a phase branch after its worktree is
gone. Covered by a git integration test.

---

## phase-02 — Domain: PhaseResetRequested event {#phase-02-reset-event}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Add a `PhaseResetRequested` event and reducer arm that flips a stuck run back to
a resumable state, so the reset is expressed through the same reducer the rest of
the lifecycle uses rather than an out-of-band status poke.

### Detailed instructions

- Add `PhaseResetRequested` to `src/domain/events.ts` with `phaseId: PhaseId`.
- In `src/domain/reducer.ts`, handle it:
  - From `run: "failed"` → `handled({ run: "interrupted", phase: { state: "pending" } }, [PersistState clearing stoppedReason/lastError and setting stoppedReason: "phase_reset"])`.
  - From `run: "running"` with phase in a resettable substate
    (`gates_exhausted` | `gates_failed` | `handoff_failed`) → same
    `interrupted` / `pending` result.
  - From `run: "interrupted"` with phase `gates_exhausted` → same result (covers
    Plan 12's lost-session case, where the run is already paused).
  - Reject from `committed` / `cleaned_up` / `passed` / `running`(+fixing) and
    from terminal run states `completed` / `archived` / `stopped`.
- The reset transitions the phase to `pending`; the actual on-disk folder removal
  happens in the app command (phase-03), after which `findNextResumablePhase`
  sees "no status" and treats the phase as not-started.

### Planned files to create

- (none)

### Planned files to edit

- `src/domain/events.ts`
- `src/domain/reducer.ts`
- `tests/unit/reducer.test.ts`
- `tests/integration/stateMachineContract.test.ts`

### Optional files that may be edited

- `tests/integration/__snapshots__/stateMachineContract.test.ts.snap`

### Boundary contracts

Producer: the reducer turns `PhaseResetRequested` into an `interrupted`/`pending`
state + `PersistState`. Consumer: `resetPhase` (phase-03) dispatches the event
and relies on the resulting resumable run state. Stable shape:
`PhaseResetRequested { phaseId }` → run `interrupted`, phase `pending`.

### Test strategy

Domain → unit tests in `tests/unit/reducer.test.ts`: each resettable origin
(`failed`, `running/gates_exhausted`, `running/handoff_failed`,
`interrupted/gates_exhausted`) yields `interrupted` + `pending` with the
`PersistState` patch; each non-resettable origin (`committed`, `passed`,
`completed`, `archived`) is `Rejected`. Extend the contract test + snapshot.

### Implementation order

Event → reducer arm → unit tests → contract test/snapshot.

### Excluded scope

- The filesystem/worktree/branch side effects (phase-03).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The `PhaseResetRequested` shape, the full set of resettable origin states, and
  the resulting state + `PersistState` patch.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(reducer): add PhaseResetRequested to make a stuck run resumable

### Commit body

Add a PhaseResetRequested event and reducer arm that flips a failed or stuck
phase back to an interrupted/pending resumable state, rejecting reset from
committed or completed states. Covered by reducer unit tests and the
state-machine contract test.

---

## phase-03 — App command: resetPhase {#phase-03-reset-phase-command}

**Recommended model:** claude-opus-4-8
**Recommended effort:** high

Implement the `resetPhase` application command: validate the target phase,
archive its folder, remove its worktree, delete its branch, and dispatch
`PhaseResetRequested` so the run becomes resumable and the phase re-runs fresh.

### Detailed instructions

- Add `src/app/resetPhase.ts` exporting `resetPhase(opts)` over the
  `Git | FileSystem | …` services, returning a small result describing what was
  reset (phase id, archived path).
- Resolve the run via `resolveRunByShortName`; pick the target phase: explicit
  `phaseId` if given, else `findCurrentPhase`. Fail with a clear error if the
  phase is absent, if it is behind an already-`committed`/`cleaned_up` later
  phase, or if its state is not resettable (delegate the state check to the
  reducer's disposition for `PhaseResetRequested` so the rule lives in one place).
- Effects, in order, each tolerant of already-absent resources:
  1. Archive the phase folder to `<runPath>/<phaseId>.reset-<ISO-ish-timestamp>/`
     (rename, not copy).
  2. `removeWorktree(worktreePath, force=true, repo)` if a worktree path is
     recorded.
  3. `deleteBranch(branchName, force=true, repo)` for the phase branch.
  4. `dispatch(PhaseResetRequested)` to flip the run to `interrupted` and persist
     the cleared error state.
- On resume, `executePlan` recomputes `previousPhaseBranch` from the last
  completed phase and `preparePhaseBranch` recreates the phase branch off it, so
  the reset phase re-runs from the correct base. Document this expectation in the
  handoff (no code change needed if it already holds — verify).

### Planned files to create

- `src/app/resetPhase.ts`
- `tests/integration/resetPhase.test.ts`

### Planned files to edit

- `src/app/index.ts`

### Optional files that may be edited

- `src/app/resolveRunInfo.ts`
- `src/app/phaseFolder.ts`

### Boundary contracts

Consumer: `resetPhase` needs run/phase status (`resolveRunByShortName`,
`findCurrentPhase`), worktree removal + branch deletion (Git port), folder
archiving (FileSystem), and the reducer disposition for the state-legality check.
Producer: the CLI layer (phase-04) invokes `resetPhase` and renders its result.
Stable shape: `resetPhase({ shortName, phaseId?, stateRoot, repoRoot, force }) →
Effect<ResetPhaseResult, …>`.

### Test strategy

Application command with fake ports → integration tests in
`tests/integration/resetPhase.test.ts`:

- Reset of a `failed` phase archives the folder, calls `removeWorktree` and
  `deleteBranch` (assert on the fakes), and leaves the run `interrupted` with the
  phase folder gone from its original path.
- Reset of a non-resettable phase (`committed`) is rejected with no side effects.
- Idempotent-ish: a missing worktree/branch does not abort the reset.

### Implementation order

Resolve + legality check → archive → worktree remove → branch delete → dispatch
→ tests.

### Excluded scope

- CLI registration and the e2e (phase-04).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The `resetPhase` signature and `ResetPhaseResult` shape.
- The ordered side-effect list and how state legality is delegated to the reducer.
- Confirmation (with the file:line) that resume re-bases a reset phase off the
  last completed phase's branch.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(app): add resetPhase command to redo a stuck phase

### Commit body

Add resetPhase: validate the target phase, archive its folder, remove its
worktree, delete its branch, and dispatch PhaseResetRequested so the run becomes
resumable and the phase re-runs fresh off the last completed phase. Covered by
integration tests for the reset, rejection, and missing-resource paths.

---

## phase-04 — CLI wiring and end-to-end {#phase-04-cli-e2e}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Expose `phax reset-phase <short-name> [phase-id]` and lock the
reset-then-resume flow with an e2e test.

### Detailed instructions

- Add `src/cli/commands/resetPhase.ts` (`runResetPhase`) that loads config,
  invokes the `resetPhase` app command, prints what was reset, and returns an
  exit code; require `--yes` (or interactive confirm) given it removes a worktree
  and branch. Mirror the structure of `resume.ts` / `resumeRegister.ts`.
- Add `src/cli/commands/resetPhaseRegister.ts` registering
  `reset-phase <short-name> [phase-id]` with `-y, --yes`, `--verbose`,
  `--trace`, and wire it in `src/cli/main.ts`.
- Add an e2e test: drive a run to a `failed`/`gates_exhausted` phase, run
  `reset-phase --yes`, assert the worktree/branch are gone and the folder is
  archived, then `resume` and assert the phase re-executes from scratch
  (fresh agent invocation) off the previous phase's branch.

### Planned files to create

- `src/cli/commands/resetPhase.ts`
- `src/cli/commands/resetPhaseRegister.ts`
- `tests/e2e/resetPhase.test.ts`

### Planned files to edit

- `src/cli/main.ts`

### Optional files that may be edited

- `src/cli/commands/runLayers.ts`
- `tests/e2e/helpers`

### Boundary contracts

Consumer: the CLI `reset-phase` command needs the `resetPhase` app command and
the shared service layer. Producer: `main.ts` registers the command. Stable
shape: `phax reset-phase <short-name> [phase-id] [--yes]`.

### Test strategy

CLI / end-to-end → an e2e test for the full reset-then-resume path; the CLI
registration is exercised by the e2e rather than a separate unit test.

### Implementation order

Command handler → register + main wiring → e2e.

### Excluded scope

- Any change to gate-first resume behavior (Plan 12).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The final command surface and flags, and the e2e scenario covering
  reset → resume → fresh re-execution.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(cli): add phax reset-phase command

### Commit body

Expose phax reset-phase <short-name> [phase-id] to reset a stuck phase and make
the run resumable, requiring --yes for the destructive worktree/branch removal.
Covered by an e2e test driving reset through resume to a fresh re-execution.
