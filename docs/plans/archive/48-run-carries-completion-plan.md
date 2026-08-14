---
status: Completed
source-spec: docs/specs/27-run-carries-archival.md
approved:
  date: 2026-08-14
  baseline: 01ba79a
---
# Run Carries Completion

## Overview

Spec 27 adds one caller, not new lifecycle semantics: when a run's final phase ends with
its gates green, the run applies the plan's ordinary `Approved → Completed` transition
**on the run branch**, before review opens, and — where the chain gate allows — the
source spec's transition rides along on the same branch. The merge of the run's pull
request then lands the work and the record together.

The whole difficulty is *where* the transition is applied. `transitionArtifact`
(`src/app/artifactStatus.ts`) already does everything spec 27 needs — legality, the
`archive/` move, a path-scoped commit of exactly the write-set — but it reads and writes
through the `FileSystem` port, whose Node adapter resolves relative paths against
`process.cwd()`, while its git side is explicitly rooted at `opts.repoRoot`. Run
completion needs both rooted at the final phase **worktree**. Four phases:

1. **phase-01** gives the `FileSystem` port a `rootedAt(root)` method and implements it
   in the Node adapter and the fake. This is the seam: a rooted view of the same
   filesystem, obtained through the port, so `src/app/` never imports `src/infra/`.
2. **phase-02** adds the `completeRunArtifacts` use case — plan first, then the ride-along
   spec, idempotent, chain-gate skip reported rather than raised — running
   `transitionArtifact` unchanged against a rooted `FileSystem` and `repoRoot` set to the
   worktree.
3. **phase-03** adds the `ArtifactCompletionFailed` pause path to the state machine, the
   fifth member of the existing post-gate pause family (handoff, commit, cleanup).
4. **phase-04** wires the step into `executePlan` immediately before the
   `FinalReviewOpened` dispatch, adds the `resumeFromCompletion` re-entry, and reports
   the completions in the run's output.

Terminology note for the reader: spec 27 says "the run branch". In the implementation
that is the **final phase branch** (`<run.branch>--phase-NN`) and its kept-open worktree
— `publishRun` pushes `info.finalPhaseBranch`, so committing in `finalWorktreePath` is
exactly committing on the branch that becomes the pull request.

Scope note: a plan run from a loose path outside `docs/plans/` is not a lifecycle
artifact — `classifyArtifactPath` returns `null` for it and `checkPlanRunnable` already
skips its location check. The completion step skips such runs entirely rather than
inventing an archive location for them.

## Technical arbitrations

- **The worktree root reaches the transition through a port method
  (`FileSystemOps.rootedAt`), not an infra import or a threaded path prefix.** Accepted
  loss: one more method on a port that three files implement, and two `FileSystem`
  services live in one process during completion — code running inside that scope sees
  worktree-relative paths, which is a real footgun if the scope ever widens. Bought: the
  port stays the single seam for "where the filesystem starts"; `transitionArtifact`,
  `approvalRecordStore` and the chain gate need **no** signature change and cannot drift
  from the operator-initiated path; and `src/app/` still imports nothing from
  `src/infra/`. This is also the first half of the path-rooting follow-up already
  recorded in `NEXT_STEPS.md` — the same method later roots the whole CLI at `repoRoot`.
  Rejected: threading a `root` option through `TransitionArtifactOptions` (every future
  artifact reader re-threads it by hand), and doing the global path-rooting fix first (a
  repo-wide refactor riding inside this spec's plan).
- **A failed completion pauses the run, it does not fail it.** Accepted loss: a fifth
  pause path through `events` → `matrix` → `reducer` → `resumeInstructions` → the resume
  ladder, for a failure that should be rare. Bought: symmetry with every other post-gate
  step — handoff, commit and cleanup failures all pause as `interrupted` and resume — and
  a run whose work is done and whose gates are green never ends `failed` over a
  hand-editable frontmatter problem. §5.4's idempotency is what makes the resume safe:
  re-entering completion after a partial success applies nothing twice.
- **The ride-along spec's chain gate is evaluated by `transitionArtifact` itself, not
  re-implemented in the use case.** Accepted loss: the skip is discovered by catching
  `SpecRetirementBlockedError` rather than by asking first, so the "is it legal" question
  is answered by a failure value. Bought: exactly one implementation of the chain gate,
  evaluated against the worktree because the rooted `FileSystem` is what
  `findDependentPlans` lists `docs/plans` through. §5.3's skip report gets its blocking
  plans straight off the error's `dependents`.
- **The completion step runs before the `FinalReviewOpened` dispatch, not after.**
  Accepted loss: none identified — spec §5.1 settles the ordering. Recorded because the
  reason matters to the implementer: `OpenRunReview` generates `review-handoff.md` and
  `final-report.md`, so completing afterwards would produce a handoff describing a branch
  that does not yet carry its own completion.
- **`source-spec` keys of already-terminal dependent plans are left naming the
  pre-archive path.** Accepted loss: the repository carries both spellings. Bought:
  spec 25's write-set discipline — rewriting them would pull files other than the
  transitioning artifact into the transition's commit. Dual resolution is the designed
  reader (spec 27 §7); this plan must not "fix" it.

## Required commands

- (none)

## phase-01 — A rooted view of the FileSystem port {#phase-01-rooted-filesystem}

**Recommended model:** claude-sonnet-5
**Recommended effort:** high

Give the `FileSystem` port a `rootedAt(root)` method returning a view of the same
filesystem whose relative paths resolve against `root`, and implement it in the Node
adapter and the fake, so a caller can run existing repo-relative code against a different
tree without changing that code.

### Detailed instructions

- Add to `FileSystemOps` in `src/ports/fs.ts`:
  `rootedAt(root: string): FileSystemOps`. Document the contract on the interface: a
  **relative** path passed to the returned ops resolves against `root`; an **absolute**
  path passes through unchanged. Both rules matter — callers inside a rooted scope still
  hand absolute run-folder and worktree paths to the same service.
- Implement in `src/infra/fs.ts`. Refactor the existing layer body into a
  `makeNodeFileSystemOps(resolvePath: (p: string) => string)` factory so the base layer
  and every rooted view share one implementation. `NodeFileSystemLayer` keeps **exactly**
  today's behaviour — paths are handed to `node:fs` untouched, so they resolve against
  the process cwd at call time. `rootedAt(root)` returns
  `makeNodeFileSystemOps(p => isAbsolute(p) ? p : join(root, p))`. `rootedAt` on a rooted
  view must compose (rooting a rooted view against a relative root nests).
- Implement on `FakeFileSystemImpl` in `src/infra/fakes/fs.ts`. The view must share the
  **same backing `files`/`dirs` maps** — a write through the rooted view is visible to
  the base fake at the joined key, and vice versa. Return a `FileSystemOps` object (not a
  second `FakeFileSystemImpl`) whose eight methods delegate to the base instance with the
  key mapped by the same relative/absolute rule.
- `src/infra/telemetry/jsonFile.ts` is the third `FileSystemOps` referencer — check
  whether it constructs an ops literal that now needs the method, and add a delegating
  `rootedAt` if so.
- Do not change any call site. Nothing consumes `rootedAt` in this phase; `src/infra/*.ts`
  and `src/app/*.ts` are knip entry points, so an as-yet-unused export is not flagged.

### Planned files to create

- `tests/integration/rootedFileSystem.test.ts`
- `tests/unit/fakeRootedFileSystem.test.ts`

### Planned files to edit

- `src/ports/fs.ts`
- `src/infra/fs.ts`
- `src/infra/fakes/fs.ts`

### Optional files that may be edited

- `src/infra/telemetry/jsonFile.ts`

### Boundary contracts

Consumer (`src/app/`, phase-02) needs: a `FileSystemOps` whose repo-relative paths land
in a chosen directory, obtained **without importing `src/infra/`**. Producer (the port +
its adapters) provides: `rootedAt(root)` on the service already in Effect context, so the
consumer derives the view from the ambient service and re-provides it with
`Effect.provideService`. The stable shape is the `FileSystemOps` interface itself — the
rooted view is the same eight methods, not a new type.

### Test strategy

Adapter behaviour is I/O, so it is tested at the integration layer against a real temp
directory; the fake is a unit. Write both **before** the implementation — the
relative/absolute split is the contract, and it is the part most likely to be
implemented as "join everything".

- `tests/integration/rootedFileSystem.test.ts` (real Node adapter, temp dirs):
  a relative `writeAtomic` under `rootedAt(tmp)` creates the file under `tmp` and not
  under the process cwd; `readText` reads it back; `exists`/`list`/`remove`/`rename`/
  `mkdirp`/`appendLine` all honour the root; an **absolute** path passes through
  unchanged; `rootedAt` composes.
- `tests/unit/fakeRootedFileSystem.test.ts`: a write through the rooted fake view is
  readable from the base fake at the joined key and vice versa; absolute paths bypass the
  join.

### Implementation order

Port interface → Node adapter factory + `rootedAt` → fake → tests green.

### Excluded scope

- Any change to `NodeFileSystemLayer`'s existing resolution behaviour. Rooting the whole
  CLI at `repoRoot` is the separate `NEXT_STEPS.md` follow-up and is **not** in this run.
- Any caller of `rootedAt` (phase-02).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact signature of `rootedAt` as added to `FileSystemOps`, and the relative /
  absolute resolution rule as implemented.
- The name and signature of the `makeNodeFileSystemOps` factory in `src/infra/fs.ts`.
- How the fake's rooted view shares state with the base instance (the exact key-mapping
  rule), since phase-02's tests depend on it.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(fs): add rootedAt to the FileSystem port and its adapters

### Commit body

Add `rootedAt(root)` to `FileSystemOps`, returning a view of the same filesystem whose
relative paths resolve against `root` while absolute paths pass through unchanged.
Implemented in the Node adapter via a shared ops factory and on the fake by delegating to
the same backing maps. `NodeFileSystemLayer` behaviour is unchanged. This is the seam
that lets run completion apply artifact transitions inside a run worktree without
`src/app/` importing `src/infra/`.

## phase-02 — The run-completion use case {#phase-02-complete-run-artifacts}

**Recommended model:** claude-opus-4-8
**Recommended effort:** high

Add the `completeRunArtifacts` use case: given a run worktree and the plan's
repo-relative path, apply the plan's `Approved → Completed` transition inside that
worktree, then the source spec's transition where the chain gate allows, and return a
structured report of what was completed and what was skipped.

### Detailed instructions

- Create `src/app/completeRunArtifacts.ts` exporting
  `completeRunArtifacts(input): Effect<RunCompletionReport, …, FileSystem | Git>` with
  `input = { worktreePath: string; planRepoRelPath: string; nowIso: string }`.
- Derive the rooted service inside the use case:
  `const fs = yield* FileSystem; const rooted = fs.rootedAt(worktreePath);` and run the
  transition work under `Effect.provideService(FileSystem, rooted)`. Every
  `transitionArtifact` call passes `{ repoRoot: worktreePath, nowIso, commit: true }` so
  the git side and the filesystem side agree on the same tree. Import **nothing** from
  `src/infra/`.
- **Skip non-artifacts.** If `classifyArtifactPath(planRepoRelPath)` is `null` (a loose
  plan outside `docs/plans/`), return an empty report immediately — no transition, no
  commit, no error.
- **Idempotency (§5.4).** Before transitioning, inspect the plan on the branch: if the
  file no longer exists at `planRepoRelPath` but exists at `archivePathFor(...)` with
  status `Completed`, the transition already ran — record it in the report as already
  complete and apply nothing. Apply the same check to the spec before the ride-along.
- **The plan transition.** Call
  `transitionArtifact(planRepoRelPath, "Completed", opts)`. A success carries the
  destination path and the commit; record both. Any failure propagates unchanged —
  phase-04 turns it into the pause.
- **The ride-along spec (§5.3).** Read the plan's `source-spec` with `readSourceSpec`
  from `src/domain/artifact/lineage.js` **against the pre-transition plan content** (read
  the markdown before the plan moves). Resolve it to its actual location on the branch —
  export the existing private `resolveDeclaredSpec` from `src/app/artifactStatus.ts`
  rather than writing a second resolver; it already accepts the declared path or its
  archive counterpart. If there is no declaration, or the spec resolves to nothing, or
  the spec is not `Approved`, record nothing and return. Otherwise call
  `transitionArtifact(specPath, "Completed", opts)` and catch **only**
  `SpecRetirementBlockedError`, turning it into a skip entry carrying `specPath` and the
  error's `dependents` (path + status). Every other error propagates.
- **Report shape.** Return
  `{ transitions: readonly { kind: "plan" | "spec"; path: string; commit?: { hash; subject }; alreadyComplete: boolean }[]; skippedSpec?: { path: string; blockedBy: readonly { path: string; status: string }[] } }`.
  Keep it a plain data structure — phase-04's CLI rendering must not need to re-derive
  anything.
- Order is fixed and load-bearing: **plan first, then spec**. The chain gate only clears
  once the plan itself is terminal.
- Do not rewrite any dependent plan's `source-spec` key (spec 27 §7). The write-set of
  each transition stays exactly what `transitionWriteSet` computes.

### Planned files to create

- `src/app/completeRunArtifacts.ts`
- `tests/integration/completeRunArtifacts.test.ts`

### Planned files to edit

- `src/app/artifactStatus.ts`

### Optional files that may be edited

- `src/domain/artifact/document.ts`

### Boundary contracts

Consumer (`executePlan`, phase-04) needs: "complete this run's artifacts in this
worktree, and tell me what happened" as a single call whose result is directly
renderable. Producer (this use case) provides: `completeRunArtifacts` returning
`RunCompletionReport`, with the chain-gate skip as **data** and every other failure as an
Effect error. Downwards, the use case consumes `transitionArtifact` unchanged — no
parallel transition path exists, and none may be introduced.

### Test strategy

This is an application use case over the real `FileSystem` and `Git` ports, so it is
tested at the integration layer against a real git repository in a temp directory
(follow `tests/integration/artifactStatus.test.ts` for the fixture shape). Write these
**before** the implementation — they are spec 27's acceptance criteria, minus the ones
that need a full run.

- Plan completes on the branch: status reads `Completed`, the file lives under
  `docs/plans/archive/`, and a commit exists whose diff is exactly the transition
  write-set (the plan path, its archive counterpart, `docs/plans/approvals.json`).
- Ride-along: an `Approved` spec with this plan as its only non-terminal dependent is
  completed too, in a **second, separate** commit, and both appear in the report.
- Sibling: a second `Approved` plan declaring the same spec leaves the spec's status and
  location untouched, and the report's `skippedSpec.blockedBy` names that plan.
- Idempotency: running the use case twice creates no second commit and the second report
  marks both artifacts `alreadyComplete`.
- Illegal transition: a plan hand-edited to `Draft` on the branch fails with
  `InvalidArtifactTransitionError` and leaves no commit.
- Loose plan: a plan outside `docs/plans/` yields an empty report and no commit.
- Isolation: the repository the test process runs in is untouched — assert the transition
  landed only under the temp worktree. (This is the regression test for the rooting.)

### Implementation order

Export `resolveDeclaredSpec` → tests → the use case core (plan transition under the
rooted service) → idempotency → ride-along and skip → report shape.

### Excluded scope

- Any call from the run flow (phase-04).
- Any state-machine, event, or resume surface (phase-03).
- Any change to `transitionArtifact`'s semantics. Exporting `resolveDeclaredSpec` is the
  only edit permitted in `src/app/artifactStatus.ts`.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact exported signature of `completeRunArtifacts` and the full `RunCompletionReport`
  type, field by field — phase-04 renders it and must not guess.
- The exact error union the use case can fail with, so phase-04's catch site is precise.
- Confirmation that `resolveDeclaredSpec` is now exported from `src/app/artifactStatus.ts`.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(run): add the completeRunArtifacts use case

### Commit body

Add `completeRunArtifacts`, which applies a plan's `Approved → Completed` transition
inside a run worktree and then rides the source spec's transition along when the chain
gate allows, reporting a blocked spec as a skip rather than a failure. Transitions go
through the existing `transitionArtifact` against a `rootedAt` view of the FileSystem
port, so legality, the archive move and the path-scoped commit stay identical to
`phax artifact complete`. Idempotent, and a no-op for plans outside `docs/plans/`.

## phase-03 — The artifact-completion pause path {#phase-03-completion-pause}

**Recommended model:** claude-sonnet-5
**Recommended effort:** high

Add `ArtifactCompletionFailed` to the state machine as the fifth post-gate pause: run
`running` + final phase `committed` → run `interrupted`, phase stays `committed`, with
resume instructions written — so a completion failure can never be mistaken for a clean
review.

### Detailed instructions

- Model this phase on the existing `CleanupFailed` path and change nothing about its
  shape. Read `src/domain/events.ts`, `src/domain/reducer.ts` (the `CleanupFailed` case),
  `src/domain/matrix.ts`, `src/domain/effects.ts`, `src/app/resumeInstructions.ts` and
  `tests/unit/reducerCleanupPause.test.ts` first; the new path is the same five edits.
- `src/domain/events.ts`: add
  `ArtifactCompletionFailed extends PhaxEventBase { type; phaseId: PhaseId; worktreePath: WorktreePath; reason: string }`
  with the same comment convention as its siblings, and add it to the `PhaxEvent` union.
- `src/domain/errors.ts`: add `ArtifactCompletionPausedError` with the
  `{ message; phaseId; cause }` shape used by `HandoffPausedError`/`CommitPausedError`/
  `CleanupPausedError`.
- `src/domain/effects.ts`: add `"artifact_completion_failed"` to the
  `WriteResumeInstructions` `kind` union.
- `src/domain/reducer.ts`: handle `ArtifactCompletionFailed`. On run `running` with phase
  `committed`, return `handled({ run: "interrupted", phase: { state: "committed" } }, …)`
  emitting `PersistState` (`stoppedReason: "artifact_completion_failed"`, `lastError:
  event.reason`), `WriteResumeInstructions`, and the two `EmitTrace` effects
  (`artifact.completion.failed` on an `artifact-completion` boundary, then
  `resume.available`). Any other phase state under `running` is `unexpected`; the other
  run states follow the `CleanupFailed` case exactly (`stale` for `rate_limited`,
  `interrupted`, `failed`, `completed`, `stopped`, `archived`; `unexpected` for `created`
  and `review_open`).
- `src/domain/matrix.ts`: add an `ArtifactCompletionFailed` entry to **every** state block
  — the matrix is exhaustive and the compiler will name any block you miss. Values must
  agree with the reducer.
- `src/app/resumeInstructions.ts`: add the `artifact_completion_failed` branch with a
  builder in the style of `buildCleanupFailedInstructions`. The text must say what failed
  (the plan or spec transition on the run branch), that the run's gates already passed,
  that the fix is usually a hand-edit of the artifact's frontmatter or clearing the dirty
  write-set in the worktree, and that `phax resume <run>` re-runs only the completion
  step.
- `docs/state-machine.md`: add the event to the "Cross-cutting" vocabulary section and
  the event-disposition matrix, matching the surrounding format.

### Planned files to create

- `tests/unit/reducerArtifactCompletionPause.test.ts`

### Planned files to edit

- `src/domain/events.ts`
- `src/domain/errors.ts`
- `src/domain/effects.ts`
- `src/domain/reducer.ts`
- `src/domain/matrix.ts`
- `src/app/resumeInstructions.ts`
- `docs/state-machine.md`

### Optional files that may be edited

- `tests/unit/events.test.ts`
- `tests/unit/reducer.test.ts`

### Boundary contracts

Consumer (`executePlan`, phase-04) needs: a dispatchable event that pauses the run
resumably after a completion failure, and a distinguishable error to re-raise so the CLI
exits non-zero without the top-level guard marking the run `failed`. Producer (the
domain) provides: `ArtifactCompletionFailed` + `ArtifactCompletionPausedError`, with the
final phase left in `committed` — the state phase-04's resume derivation reads to choose
its re-entry point.

### Test strategy

Pure domain, so pure unit tests, written **before** the reducer case — the disposition
table is an invariant, not an implementation detail.

- `tests/unit/reducerArtifactCompletionPause.test.ts`, mirroring
  `tests/unit/reducerCleanupPause.test.ts`: the handled transition from
  `running`/`committed` produces the expected next state and the exact effect list; a
  non-`committed` phase under `running` is `unexpected`; terminal run states are `stale`.
- The existing exhaustiveness tests over the matrix and the event union cover the rest;
  extend them only if they enumerate event names by hand.

### Implementation order

Event + error + effect kind → reducer case → matrix rows → resume instructions → docs.

### Excluded scope

- Dispatching the event or catching the error (phase-04).
- Any new `RunState` or `PhaseState` value — this path reuses `interrupted` and
  `committed`.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact `ArtifactCompletionFailed` field list and the `ArtifactCompletionPausedError`
  shape, so phase-04's dispatch and catch sites compile first try.
- The precise `(run, phase)` precondition the reducer accepts, and the resulting state.
- The `stoppedReason` string written by `PersistState`.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(state): add the ArtifactCompletionFailed pause path

### Commit body

Add `ArtifactCompletionFailed` as the fifth post-gate pause alongside handoff, commit and
cleanup: on a `running` run whose final phase is `committed`, it pauses the run as
`interrupted` with the phase left `committed`, persists the stop reason and writes resume
instructions. Adds the matching `ArtifactCompletionPausedError`, the
`artifact_completion_failed` resume-instruction kind, exhaustive matrix rows and the
state-machine documentation. Nothing dispatches the event yet.

## phase-04 — Run completion applies the transitions {#phase-04-wire-run-completion}

**Recommended model:** claude-opus-4-8
**Recommended effort:** high

Call the completion step from the run's final phase, immediately before review opens;
pause the run resumably when it fails; re-enter it on resume; and report each completed
artifact with its commit in the run's output.

### Detailed instructions

- **Thread the plan path.** Add `readonly planRepoRelPath: string` to
  `ExecutePlanOptions` in `src/app/executePlan.ts` and pass it from
  `src/cli/commands/run.ts`, which already computes `planRepoRel` (`relative(config.repoRoot,
  planMdPath)`, POSIX-normalised) for the staleness gate. Do not recompute it in `app/`.
- **Call the step.** Inside the `isFinal` block, **after** the phase's handoff and
  **before** the `FinalReviewOpened` dispatch, call
  `completeRunArtifacts({ worktreePath, planRepoRelPath, nowIso })` with `worktreePath`
  being the final phase's worktree — the branch `publishRun` pushes. Keep the report in a
  local for the result. Nothing about the compliance-review or auto-publish blocks moves;
  they already run after `FinalReviewOpened`.
- **Fail loudly (§5.6).** Wrap the call in a catch that dispatches
  `ArtifactCompletionFailed` (phase-03) with the phase id, worktree path and the error's
  message as `reason`, then fails with `ArtifactCompletionPausedError`. Follow the
  `CleanupFailed` catch site in the same file as the model. Add the matching
  `isArtifactCompletionPausedError` re-raise to the `Effect.catchIf` chain at the bottom
  of `executePlan` **and** to the `Effect.tapError` predicate list, so the top-level guard
  does not additionally mark the run `failed`. Add the error to the `ExecutePlanError`
  union.
- **Resume re-entry.** In the resume-flag derivation (~line 400), add a
  `resumeFromCompletion` branch for `phaseStatus?.state === "committed"`, guarded by the
  phase being the plan's **last** phase — `committed` is transient for non-final phases,
  which pause as `cleaning_up` instead. Capture the session id and worktree path as the
  sibling branches do. In the phase loop, `isResumeFromCompletion` must take the existing
  resume path that reuses the recorded worktree/branch/session, then skip agent
  invocation, gates, commit, handoff and cleanup and go straight to the completion step.
  Phase-02's idempotency makes a re-entry that partially succeeded safe.
- **Report (§5.7).** Add `readonly artifactCompletions?: RunCompletionReport` to
  `ExecutePlanResult`, populate it, and render it in `src/cli/commands/run.ts` next to the
  existing `Run "…" reached review` line, using the shapes in spec 27 §6 — a `✓ completed
  <path> — <short hash>` line per transition and, when a spec was skipped, a `○ spec
  <path> kept: non-terminal dependent plans remain` line followed by the blocking plans
  and their statuses. Presence of the per-artifact lines with commit hashes is normative;
  the wording is not. Rendering only — no logic in the command file.
- **Do not touch `publishRun`, `phax publish-pr`, or any CLI flag or option.** Spec 27
  adds no surface.

### Planned files to create

- `tests/integration/runCarriesCompletion.test.ts`
- `tests/integration/resumeFromCompletion.test.ts`

### Planned files to edit

- `src/app/executePlan.ts`
- `src/cli/commands/run.ts`
- `tests/unit/cli/run.test.ts`

### Optional files that may be edited

- `tests/integration/executePlan.test.ts`
- `docs/state-machine.md`

### Boundary contracts

Consumer (`src/cli/commands/run.ts`) needs: the completion outcome as renderable data on
`ExecutePlanResult`. Producer (`executePlan`) provides: `artifactCompletions`, the
phase-02 report passed through untouched. Upwards, `run.ts` supplies `planRepoRelPath`;
`executePlan` never derives a repo-relative path itself.

### Test strategy

The run flow is exercised at the integration layer with fake ports, following
`tests/integration/executePlan.test.ts` and `tests/integration/resumeFromCleanup.test.ts`
for the fixture shape; the output rendering is a unit test on the command.

- `tests/integration/runCarriesCompletion.test.ts`: after a run whose final phase's gates
  pass, the final worktree's branch carries the plan's completion commit and the plan
  reads `Completed` under `docs/plans/archive/` there, while the origin repository's
  `docs/plans/` is untouched (spec 27 §5.5 — this is the "unpublished run leaves reality
  honest" criterion); the completion commits precede `review-handoff.md` generation; and
  the result's `artifactCompletions` carries both transitions.
- `tests/integration/resumeFromCompletion.test.ts`: seed a run interrupted with its final
  phase `committed` and assert `phax resume` re-enters at the completion step, spawns no
  agent, and re-runs no gate; and that resuming a run whose plan is already `Completed`
  creates no second commit.
- Failure: a plan hand-edited to `Draft` on the branch leaves the run `interrupted`, not
  `review_open`, with resume instructions written and a non-zero exit.
- `tests/unit/cli/run.test.ts`: the completion and skip lines render with the commit
  hashes, and nothing renders when the report is empty.

### Implementation order

Thread `planRepoRelPath` → call the step and surface the report → catch site and the two
re-raise lists → resume derivation and re-entry → CLI rendering → tests green.

### Excluded scope

- Any change to `publishRun`, `phax publish-pr`, or the publication artifacts.
- Batch execution (spec 24). Which member of a stacked batch carries a shared spec's
  completion is settled when batch is implemented; nothing here may preclude that being
  the last-merging member, so keep the step keyed on the run's own plan path only.
- Post-merge automation of any kind, and any reading of "has a merged PR" as a status.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- Where exactly the completion step sits relative to `FinalReviewOpened`, the compliance
  review and auto-publish, with line references.
- The `resumeFromCompletion` predicate as implemented, including how it distinguishes the
  final phase from a non-final phase in `committed`.
- The rendered output for both the completed and the chain-gate-skipped case, verbatim.
- Confirmation that `publishRun` and the publish CLI surface were not touched.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(run): carry artifact completion on the run branch

### Commit body

Apply the plan's `Approved → Completed` transition on the run branch when the final
phase's gates are green, before review opens, and ride the source spec's transition along
when the chain gate allows. The reviewer sees the completion in the branch they review
and the merge lands work and record together; an unpublished or rejected run completes
nothing on `main`. A failed transition pauses the run as `interrupted` with the final
phase `committed`, resumable at the completion step. Completed artifacts and their
commits are reported in the run's output. `phax publish-pr` is unchanged and no CLI
surface is added.
