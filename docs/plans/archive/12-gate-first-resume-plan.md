# Plan 12 — Gate-first resume on gate exhaustion

## Problem

When a phase exhausts its fix attempts (`maxFixAttempts` fix invocations all
leave a gate red), `FixAttemptsExhausted` drives the phase to terminal `failed`
and the propagating `GateFailedError` triggers `RunFailed`, so the run lands in
terminal `failed`. `resume.ts` then refuses it outright
(`refusalMessageForRunState` → "failed and cannot be resumed"). This defeats the
human-in-the-loop premise: the operator is _supposed_ to be able to fix the gate
by hand (e.g. the agent lacked shell access to the gate command) and resume.

Even setting the terminal state aside, the resume re-entry is wrong. On resume,
`executePlan` restarts the failed phase from `startIndex` and re-runs the
**entire phase body** — `PhaseStartRequested` → worktree → `backend.runAgent`
(the full implementation agent from scratch) → `runGatesWithFixLoop`. It never
just re-runs the gate to see whether the human already fixed it.

## Desired behavior

Gate exhaustion should **pause the run as resumable** (mirroring the
rate-limit / no-changes paths) in a new, honest phase state `gates_exhausted`,
writing `resume-instructions.md`. On resume of a `gates_exhausted` phase,
`executePlan` skips the implementation agent and re-enters the fix loop, which is
already **gate-first**: it runs the gate before invoking any fix agent. If the
human's manual fix made the gate pass, the phase proceeds to commit with no
agent invocation. If the gate is still red, the fix agent re-engages with a fresh
attempt budget, resuming the **existing** Claude session (its accumulated context
is required for a correct fix).

If the persisted Claude session id is missing, resume **fails loudly** rather
than starting a blind fix session — recovering from a lost session is the job of
the separate `phax reset-phase` command (Plan 13).

## Decisions (settled with the user)

- **Dedicated state.** Introduce `gates_exhausted` rather than overloading
  `gates_failed`; it reads honestly and keeps the phase-state enum explicit.
- **Fresh budget on resume.** Re-entering the gate loop grants a fresh
  `maxFixAttempts` budget (the context changed — a human intervened). Attempt
  _indices_ continue from the persisted attempt so prior `checks-attempt-NN.log`
  / `fix-attempt-NN.jsonl` artifacts are never clobbered.
- **Lost session → fail.** A missing `claudeSessionId` on resume is a hard
  failure pointing at `phax reset-phase`; we never fabricate a fix session
  because the session context matters for a proper fix.

## Affected gate profile

All phases verify against the project's configured `full` gate profile in
`phax.json` (`pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm knip`,
`pnpm test`, `pnpm audit:architecture`, `pnpm build`).

---

## phase-01 — Add `gates_exhausted` phase state {#phase-01-gates-exhausted-state}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Introduce a `gates_exhausted` phase state to the persisted schema and the
hierarchical domain state, so later phases can park an exhausted phase in a
resumable, non-terminal state distinct from `gates_failed` and terminal `failed`.

### Detailed instructions

- In `src/schemas/status.ts`, add `Schema.Literal("gates_exhausted")` to
  `PhaseStateSchema`. Adding a union member is additive — existing on-disk
  status files remain decodable; no optional-for-archived back-compat shim
  (per project convention, new schema surface is required surface, not
  optional-for-old-runs).
- In `src/domain/state.ts`:
  - Add `"gates_exhausted"` to the `PhaseState` union.
  - Add `{ readonly state: "gates_exhausted"; readonly attempt: number }` to the
    `PhaseSubState` union (carries the attempt index at which the budget ran out,
    matching `gates_failed` / `fixing`).
  - Do **not** add `gates_exhausted` to `TERMINAL_PHASE_STATES` — it must stay
    non-terminal so `findNextResumablePhase` selects it on resume.
- Leave the existing `phaseTransition` helper exports untouched; the reducer
  builds these substates inline (phase-02 handles transitions).

### Planned files to create

- (none)

### Planned files to edit

- `src/schemas/status.ts`
- `src/domain/state.ts`
- `tests/unit/state.test.ts`

### Optional files that may be edited

- `tests/type/stateTransitions.ts`

### Boundary contracts

Producer: the domain state module and persisted-status schema. Consumer:
`executePlan`, the reducer, and `resume.ts` (later phases) need a non-terminal,
attempt-carrying substate to represent "all fix attempts used, awaiting human or
re-gate". Stable shape: `{ state: "gates_exhausted", attempt: number }` in the
hierarchical view; bare literal `"gates_exhausted"` in `PhaseStatus.state`.

### Test strategy

Domain layer → unit tests. In `tests/unit/state.test.ts`, assert
`gates_exhausted` is not in `TERMINAL_PHASE_STATES` and that `isPhaseTerminal`
returns false for it. Add a `decodePhaseStatus` round-trip for a status carrying
`state: "gates_exhausted"`. Write these before the schema edit so the new literal
is the change that makes them pass.

### Implementation order

Schema literal → domain union members → tests.

### Excluded scope

- Reducer transitions into/out of `gates_exhausted` (phase-02).
- Any resume/executePlan wiring (phases 05–06).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact union member added to `PhaseSubState`
  (`{ state: "gates_exhausted"; attempt: number }`) and the confirmation that
  `gates_exhausted` is **excluded** from `TERMINAL_PHASE_STATES`.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(state): add non-terminal gates_exhausted phase state

### Commit body

Add a gates_exhausted phase state to the persisted status schema and the
hierarchical domain state as a non-terminal, attempt-carrying substate. This is
the parking state for a phase whose fix attempts are exhausted but which a human
can recover and resume. Covered by unit tests asserting non-terminality and
status round-tripping.

---

## phase-02 — Reducer: pause on exhaustion, lift on resume {#phase-02-reducer}

**Recommended model:** claude-opus-4-8
**Recommended effort:** high

Make `FixAttemptsExhausted` pause the run as resumable in `gates_exhausted`
(instead of failing it), and make `RunResumeRequested` lift a resumed
`gates_exhausted` phase back to `running` so the gate loop's existing
transitions apply.

### Detailed instructions

- Extend the `FixAttemptsExhausted` event in `src/domain/events.ts` with the
  fields the pause needs, mirroring `RateLimitDetected` / `PhaseHadNoChanges`:
  `attempt: number`, `phaseId: PhaseId`, `worktreePath: WorktreePath`,
  `sessionId: ClaudeSessionId`, and `command: string` (the failing gate command,
  for `lastError`).
- Extend `ResumeContext` in `src/domain/effects.ts`: add
  `"Gate checks failed"` to the `reason` union and `"gates_exhausted"` to the
  `kind` union.
- In `src/domain/reducer.ts`, rewrite the `FixAttemptsExhausted` arm. From
  `run: "running"` with phase `gates_failed | fixing`, return
  `handled({ run: "interrupted", phase: { state: "gates_exhausted", attempt: event.attempt } }, [...])`
  with effects mirroring the `RateLimitDetected` arm:
  - `PersistState` patch
    `{ run: { stoppedReason: "gates_exhausted", lastError: \`Gate failed: ${event.command}\` } }`.
  - `WriteResumeInstructions` with a `ResumeContext` of
    `reason: "Gate checks failed"`, `kind: "gates_exhausted"`,
    `phaseId`, `worktreePath`, `sessionId`.
  - `EmitTrace` `gate.attempts_exhausted` (status `failed`, boundary `gate`) and
    `EmitTrace` `resume.available` (status `info`,
    `details.resumeCommand = \`phax resume ${event.run}\``).
  - Keep the `unexpected`/`stale` branches for the other run/phase states.
- In the `RunResumeRequested` arm, refine the `interrupted` case: when
  `state.phase.state === "gates_exhausted"`, return
  `handled({ run: "running", phase: { state: "running" } })` so that the gate
  loop's `GatePassed` / `GateFailed` / `FixStarted` transitions (which accept
  `running`/`fixing`) are valid on re-entry. For every other interrupted phase
  substate keep the current behavior (`handled({ run: "running", phase: state.phase })`).

### Planned files to create

- (none)

### Planned files to edit

- `src/domain/events.ts`
- `src/domain/effects.ts`
- `src/domain/reducer.ts`
- `tests/unit/reducer.test.ts`
- `tests/integration/stateMachineContract.test.ts`

### Optional files that may be edited

- `tests/integration/__snapshots__/stateMachineContract.test.ts.snap`

### Boundary contracts

Producer: the reducer emits `WriteResumeInstructions` / `PersistState` /
`EmitTrace` commands. Consumer: the effect runner (phase-03) renders the
`gates_exhausted` `ResumeContext`. Stable shape: `ResumeContext` gains
`reason: "Gate checks failed"` + `kind: "gates_exhausted"`; the
`FixAttemptsExhausted` event gains `attempt`, `phaseId`, `worktreePath`,
`sessionId`, `command`.

### Test strategy

Domain layer → unit tests, written before the reducer change. In
`tests/unit/reducer.test.ts`:

- `FixAttemptsExhausted` from `running/{gates_failed}` and `running/{fixing}`
  yields `Handled` with `{ run: "interrupted", phase: { state: "gates_exhausted", attempt } }`
  and the three effect kinds (assert the `WriteResumeInstructions` ctx
  `kind === "gates_exhausted"` and the `PersistState` `stoppedReason`).
- `RunResumeRequested` from `interrupted` with phase `gates_exhausted` yields
  `{ run: "running", phase: { state: "running" } }`; from `interrupted` with any
  other phase substate it is unchanged.
  Update `tests/integration/stateMachineContract.test.ts` (and regenerate its
  snapshot) to cover the new transitions.

### Implementation order

Event/effect shape → reducer arms → unit tests → contract test + snapshot.

### Excluded scope

- Rendering the resume-instructions text (phase-03).
- Emitting the enriched `FixAttemptsExhausted` event from the loop (phase-04).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The final `FixAttemptsExhausted` event field set and the exact `ResumeContext`
  produced for gate exhaustion.
- The `RunResumeRequested` refinement rule for `interrupted` + `gates_exhausted`
  → `running`, and confirmation other interrupted substates are unchanged.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(reducer): pause run on gate exhaustion and lift it on resume

### Commit body

Rework FixAttemptsExhausted to pause the run as a resumable gates_exhausted
phase (writing resume instructions and emitting traces) instead of failing it,
mirroring the rate-limit path. Lift a resumed gates_exhausted phase back to
running so the gate loop's existing transitions apply. Enrich the
FixAttemptsExhausted event and ResumeContext accordingly. Covered by reducer
unit tests and the state-machine contract test.

---

## phase-03 — Render gate-exhaustion resume instructions {#phase-03-resume-instructions}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Teach the resume-instructions writer and the effect runner that maps
`WriteResumeInstructions` to render the gate-exhaustion case, so the paused run
leaves an accurate `resume-instructions.md`.

### Detailed instructions

- In the effect runner that consumes `WriteResumeInstructions` (the dispatcher /
  `effectRunner.ts` path that builds `ResumeInstructionsInput` from
  `ResumeContext`), handle `kind: "gates_exhausted"`: there is no reset time, so
  pass the gate command / reason through instead of `resetAt`.
- In `src/app/resumeInstructions.ts`, render a gate-exhaustion body that:
  - states the gate failed after exhausting `maxFixAttempts` fix attempts;
  - tells the operator to fix the gate by hand in the worktree, then run
    `phax resume <short-name>` — on resume the gate is re-run first and, if it
    passes, the phase commits with no agent invocation;
  - points at `phax reset-phase <short-name>` (Plan 13) for the case where the
    Claude session was lost.
- Do not introduce a `resetAt` for this kind; keep the existing rate-limit
  rendering untouched.

### Planned files to create

- (none)

### Planned files to edit

- `src/app/resumeInstructions.ts`
- `src/app/effectRunner.ts`
- `tests/unit/resume.test.ts`

### Optional files that may be edited

- `src/app/eventAdapter.ts`

### Boundary contracts

Consumer: the effect runner needs a `ResumeInstructionsInput` shaped for the
`gates_exhausted` `ResumeContext`. Producer: `resumeInstructions.ts` provides the
rendered markdown. Stable shape: `ResumeInstructionsInput.reason` carries the
gate-exhaustion reason; `resetAt` is absent for this kind.

### Test strategy

Application layer → unit tests. Add a `buildResumeInstructions` case asserting
the gate-exhaustion body mentions re-running the gate, `phax resume`, and
`phax reset-phase`, and that it omits a reset time. Wire it through the effect
runner mapping in an existing resume unit test.

### Implementation order

Effect-runner mapping → instructions renderer → tests.

### Excluded scope

- The loop emitting the event (phase-04) and the executePlan re-entry (phase-05).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact `ResumeInstructionsInput` mapping for `kind: "gates_exhausted"` and a
  sample of the rendered body.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(resume): render resume instructions for gate exhaustion

### Commit body

Map the gates_exhausted ResumeContext through the effect runner and render a
resume-instructions body that explains the gate-first resume, the manual-fix
workflow, and the reset-phase escape hatch. Covered by a resume unit test.

---

## phase-04 — Gate loop: start attempt, fresh budget, exhaustion error {#phase-04-fix-loop}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** high

Make `runGatesWithFixLoop` resumable: accept a starting attempt index so resume
never clobbers prior artifacts, grant a fresh fix budget per invocation, emit the
enriched `FixAttemptsExhausted` event, and fail with a dedicated
`GateAttemptsExhaustedError` so `executePlan` can pause (not fail) the run.

### Detailed instructions

- Add `GateAttemptsExhaustedError` to `src/domain/errors.ts` carrying `command`,
  `exitCode`, `logPath`, `attempt`. It signals "fix budget spent" distinctly from
  a transient `GateFailedError`.
- In `src/app/fixLoop.ts`:
  - Add `startAttempt: number` (default 1) and `worktreePath: string` to
    `RunGatesWithFixLoopOptions`; start the internal `loop` at `startAttempt`.
  - Decouple the fix budget from the absolute attempt index: track fixes used
    since this invocation and invoke the fix agent while
    `fixesUsed < maxFixAttempts`, so a resume that starts at `attempt = N` still
    gets a full `maxFixAttempts` budget while log/jsonl files continue numbering
    from `N` (`checks-attempt-NN.log`, `fix-attempt-NN.jsonl`). Verify the
    `startAttempt = 1` path preserves today's exact behavior (one gate run then
    `maxFixAttempts` fixes).
  - On exhaustion, build and `dispatch` `FixAttemptsExhausted` populated with
    `attempt`, `phaseId`, `worktreePath`, `sessionId` (the current session), and
    `command` (the failing gate). Then `Effect.fail` with
    `GateAttemptsExhaustedError` rather than the bare `GateFailedError`.
  - Add `GateAttemptsExhaustedError` to the function's error channel union.

### Planned files to create

- (none)

### Planned files to edit

- `src/domain/errors.ts`
- `src/app/fixLoop.ts`
- `tests/integration/fixLoop.test.ts`

### Optional files that may be edited

- `src/app/executePlan.ts`

### Boundary contracts

Producer: the loop dispatches `FixAttemptsExhausted` (now carrying session +
worktree + command) and fails with `GateAttemptsExhaustedError`. Consumer:
`executePlan` (phase-05) catches `GateAttemptsExhaustedError` to pause the run,
and passes `startAttempt` / `worktreePath` on resume. Stable shape: new option
fields `startAttempt` (default 1) and `worktreePath`.

### Test strategy

Application command with fake ports → integration tests in
`tests/integration/fixLoop.test.ts`:

- `startAttempt > 1`, gate passes on the first re-run → returns success, **no**
  fix agent invoked, no clobber of `checks-attempt-01.log`.
- gate keeps failing → exactly `maxFixAttempts` fixes, then `FixAttemptsExhausted`
  dispatched with the populated fields and the effect fails with
  `GateAttemptsExhaustedError`.
- regression: `startAttempt = 1` matches today's attempt/log numbering.

### Implementation order

Error type → option plumbing + budget decoupling → exhaustion event/error →
tests.

### Excluded scope

- Catching `GateAttemptsExhaustedError` in `executePlan` and the resume re-entry
  branch (phase-05).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The `runGatesWithFixLoop` option additions (`startAttempt`, `worktreePath`),
  the budget-vs-attempt-index decoupling rule, and the `GateAttemptsExhaustedError`
  shape.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(fix-loop): resumable gate loop with start attempt and fresh budget

### Commit body

Add a startAttempt index and a per-invocation fix budget to runGatesWithFixLoop
so resume re-runs the gate first without clobbering prior attempt artifacts and
gets a fresh maxFixAttempts budget. Emit an enriched FixAttemptsExhausted event
and fail with a dedicated GateAttemptsExhaustedError so the caller can pause the
run. Covered by fix-loop integration tests including a startAttempt=1 regression.

---

## phase-05 — executePlan: skip agent on resume, pause on exhaustion {#phase-05-execute-plan}

**Recommended model:** claude-opus-4-8
**Recommended effort:** high

Re-enter a resumed `gates_exhausted` phase directly at the gate loop (skipping
the implementation agent), failing loudly if the session was lost; and catch
`GateAttemptsExhaustedError` so a fresh exhaustion pauses the run instead of
failing it.

### Detailed instructions

- Before the per-phase loop, read the on-disk `PhaseStatus` for
  `plan.phases[startIndex]` (via `resolveRunByShortName` / the phase-folder
  status read). Capture whether the resumed phase is `gates_exhausted` and its
  `attempt`, `claudeSessionId`, and `worktreePath` — capture this **before** the
  `RunResumeRequested` dispatch lifts the substate to `running`.
- In the loop iteration for that phase (`i === startIndex` and the captured flag
  is set), take a resume-from-gate branch:
  - Skip `PhaseStartRequested`, `createPhaseWorktree`, the model-resolution /
    security-posture writes, and `backend.runAgent`.
  - If the captured `claudeSessionId` is absent, `Effect.fail` with a clear error
    (reuse/extend `AgentSessionIdMissingError`) whose message directs the
    operator to `phax reset-phase <short-name>` (Plan 13). Do not start a blind
    fix session.
  - Reuse the captured `worktreePath` (assert it still exists) and call
    `runGatesWithFixLoop` with `sessionId` = captured session,
    `startAttempt` = captured `attempt + 1`, and `worktreePath`. Then fall
    through to the existing handoff → commit → cleanup tail unchanged.
- Add `Effect.catchIf(isGateAttemptsExhaustedError, …)` to the program pipe,
  mirroring the rate-limit handler: the `FixAttemptsExhausted` event was already
  dispatched inside the loop (which performed the pause transition + resume
  instructions), so just re-raise to set a non-zero exit code. Ensure the
  `tapError` `RunFailed` fallback **excludes** `GateAttemptsExhaustedError`
  (alongside the existing rate-limit / no-changes exclusions) so the run is not
  driven to terminal `failed`.

### Planned files to create

- (none)

### Planned files to edit

- `src/app/executePlan.ts`
- `tests/integration/executePlan.test.ts`

### Optional files that may be edited

- `src/app/resolveRunInfo.ts`
- `src/domain/errors.ts`

### Boundary contracts

Consumer: `executePlan` needs the resumed phase's persisted `claudeSessionId`,
`worktreePath`, and `attempt` to re-enter the gate loop. Producer:
`resolveRunByShortName` / phase-status read supplies them. Stable shape: the
re-entry reads `PhaseStatus.{state, attempt-equivalent, claudeSessionId, worktreePath}`;
missing session → hard failure pointing at `phax reset-phase`.

### Test strategy

Application command with fake ports → integration tests in
`tests/integration/executePlan.test.ts`:

- Resume of a `gates_exhausted` phase whose gate now passes → commits with **no**
  `backend.runAgent` call (assert via the fake backend) and starts the gate loop
  at `attempt + 1`.
- Resume whose gate still fails and re-exhausts → run ends in `interrupted` /
  phase `gates_exhausted` (resumable), **not** terminal `failed`.
- Resume with a missing `claudeSessionId` → fails with the reset-phase-directing
  error.

### Implementation order

Status read + captured resume context → resume-from-gate branch → exhaustion
catch + RunFailed exclusion → tests.

### Excluded scope

- `resume.ts` selection wording and the e2e (phase-06).
- The `phax reset-phase` command itself (Plan 13).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact branch condition for resume-from-gate, where the persisted
  session/worktree/attempt are read, and the missing-session failure path.
- The `GateAttemptsExhaustedError` handling added to the program pipe and the
  `RunFailed` exclusion.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(execute-plan): gate-first resume for exhausted phases

### Commit body

On resume of a gates_exhausted phase, skip the implementation agent and re-enter
the gate loop at the next attempt index using the persisted Claude session,
failing loudly toward reset-phase when the session is lost. Catch
GateAttemptsExhaustedError to pause the run as resumable instead of failing it.
Covered by executePlan integration tests for the pass, re-exhaust, and
lost-session cases.

---

## phase-06 — Resume selection wording and end-to-end {#phase-06-resume-e2e}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Confirm resume selection accepts the paused state end to end and tidy the
operator-facing wording, then lock the behavior with an e2e test.

### Detailed instructions

- In `src/app/resume.ts`, verify a run paused in `interrupted` with a
  `gates_exhausted` phase resolves via `inspectResume` (it should: `interrupted`
  is resumable and `gates_exhausted` is non-terminal, so `findNextResumablePhase`
  selects it). Update `refusalMessageForRunState`'s `failed` arm to mention that
  a genuinely failed run can be recovered with `phax reset-phase <short-name>`
  (Plan 13) before creating a new run.
- Add an e2e test that drives a run to gate exhaustion with a fake/stub gate that
  fails until a "human fix" flips it green, asserts the run pauses in
  `gates_exhausted` with `resume-instructions.md` present, then resumes and
  observes the gate-first pass committing the phase **without** a fresh agent
  invocation.

### Planned files to create

- `tests/e2e/gateExhaustionResume.test.ts`

### Planned files to edit

- `src/app/resume.ts`
- `tests/unit/resume.test.ts`

### Optional files that may be edited

- `tests/e2e/helpers`

### Boundary contracts

This phase crosses no new architectural boundary; it validates the
already-defined resume contract end to end.

### Test strategy

CLI / end-to-end → e2e test for the full pause-then-gate-first-resume path; a
resume unit-test assertion for the updated `failed` refusal wording.

### Implementation order

Resume selection check + wording → e2e harness → assertions.

### Excluded scope

- The `phax reset-phase` command (Plan 13).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- Confirmation that `inspectResume` selects an `interrupted` + `gates_exhausted`
  run, and the final `failed`-state refusal wording.
- The e2e scenario and where the "human fix" is injected.
- Any deviation from the planned file lists, with the reason.

### Commit subject

test(resume): end-to-end gate-first resume after exhaustion

### Commit body

Confirm resume selection accepts an interrupted run parked in gates_exhausted and
update the failed-run refusal to point at phax reset-phase. Add an e2e test
covering pause-on-exhaustion through gate-first resume committing without a fresh
agent invocation.
