---
status: Abandoned
source-spec: docs/specs/2610211403-interactive-phases.md
completes-spec: false
---
# Declared interactive stop

Plan 1 of 3 for the interactive-phases spec (`docs/specs/2610211403-interactive-phases.md`). After this plan, a phase that the plan declares interactive (`**Mode:** interactive`) runs end to end. The run sets up the phase's worktree, writes the seed and runs one read-only first turn. It then stops in `awaiting_review` with cause `declared` and exit 13, and writes `review-stop.json`. A person works in the worktree with any editor or agent. `phax resume` runs the gate, gets the interactive handoff, commits the corrections with an `Interactive-Phase:` trailer and continues the run. Later phases read the correction under `## Review corrections`. Plan 2 adds the operator's hold (`phax run --hold`), the held stop and the oracle-pair rules. Plan 3 adds the versioned `phax ls --json` run list, transcript capture, and the records, compliance, review handoff and PR body around a stop. Order: the state and persisted shapes first (phase-01, phase-02), then the pure builders (phase-03), then the stop use case (phase-04), then the commands that act on a stopped run (phase-05). Closing comes next, with the `interactive` refusal lifted in the same phase (phase-06), so that no commit lets a plan start a stop it cannot close. The docs and the planning skill come last (phase-07). Until phase-06, the stop's use cases are tested directly and through fixture run folders, because lint and the run preflight still refuse every interactive phase. phase-07 edits `.claude/skills/phax-planning/SKILL.md`, so run this plan with `phax run --allow-skill-edits`. Fixtures are made up: the invoice-export and credit-notes runs, Ada Example and the session ids. Fake providers keep their session stores under a test HOME. Tests never read `~/.phax`, and they assert `$schema` URLs by format id and release pattern, never by the running release's version. No agent prompt this plan writes mentions how to stop a run.

## Required commands

- `pnpm exec tsx`
- `pnpm gen:usage-spec`
- `pnpm docs:cli`

Every command above is already allowed by `security.agentCommands` in `phax.json` (`pnpm exec tsx` regenerates the schema snapshots with `pnpm exec tsx scripts/schemas-check.ts --write`; `pnpm gen:usage-spec` and `pnpm docs:cli` regenerate `phax.usage.kdl` and `docs/cli/`). No configuration change is needed. They are declared so that the preflight confirms the coverage.

## Technical arbitrations

- The oracles check's finding against an interactive phase inside an oracle pair (oracle-phases §5.11, `interactiveRows(...).inside` in `src/domain/plan/oracleCheck.ts`) stays until plan 2. Removing it here would let a declared review change an oracle file with no `authored` re-run, because r-oracle-authored lands with the hold in plan 2. Loss accepted: until plan 2, a planner cannot place a declared review between an oracle phase and its discharge. The `oracles` check is not changed by this plan.
- The stop cause enum is `declared` only, and a session's `origin` is `first-turn | new-session` only. Plan 2 adds `held` and `builder` together with the hold, and this plan adds no `hold` to run-status. So no persisted value is admitted that nothing writes. Loss accepted: plan 2 widens these enums, and if a release is cut between the two plans, they need another snapshot.
- Persisted shapes. run-status (0.17.0), phase-status (0.20.0) and registry (0.17.0) gain the `awaiting_review` state. phase-status also gains the required `mode` and `stop` fields. phase-file-reconciliation (0.17.0) gains a required `reviewCorrections` list, and cost-ledger (0.25.0) gains the `first-turn` and `closing-turn` roles. Each gets a `next` snapshot and a frozen decoder of its current shape under `src/schemas/history/`, recorded in `packages/schemas/history.lock.json`. Older documents are read through those frozen decoders and lifted in memory (a 0.20.0 phase status gets `mode: "headless"` and `stop: null`; a 0.17.0 reconciliation gets `reviewCorrections: []`), never by decoding a new key as optional. In-flight runs written by an older binary therefore keep resuming, and none of them can be in `awaiting_review`. Extraction-cache entries and phax-plan are unchanged, because `mode` landed in PR #151. first-reading, interactive-handoff, interactive-session and review-stop are new formats born with `$schema`.
- Where the stop lives. The phase's `status.json` carries `mode` (copied from the plan) and `stop`: `null` for a phase that never stopped, `{ cause: "declared", status: "waiting" }` while it waits, and `{ cause: "declared", status: "closed", outcome: "corrected" | "unchanged" }` once closed. The sessions and each first turn's outcome live in `<run>/<phase>/interactive-session.json`. An interactive phase writes `model-resolution.json` but no `agent-binding.json`, because `interactive-session.json` is its session record. While a stop is closing, the run is `running` and the phase stays `awaiting_review` until the gate passes.
- Worktree comparison. A snapshot is the tree id of the worktree's tracked files plus its untracked files that are not ignored, excluding `.phax-context/`. It is computed through a temporary index (`GIT_INDEX_FILE`, `git add -A`, `git write-tree`), behind new Git port operations. Two snapshots differ exactly when their tree ids differ, and the changed paths come from diffing the two trees. A first turn's edits are restored by checking the before-tree out over the changed and deleted paths and removing the paths the turn added. Ignored files and `.phax-context/` are never touched. Loss accepted: an edit to an ignored file goes undetected.
- The seed points to `.phax-context/plan.md` (phax already writes it into every phase worktree) instead of embedding the full plan. It embeds the phase's Detailed instructions, every executed phase's handoff and the upcoming phases' plan sections. Its wording and order follow the spec's §6 indicative seed.
- Review corrections reach later phases only through `## Review corrections`. For the phase right after an interactive phase, `## Previous phase handoff` carries the handoff of the nearest earlier headless phase, so the correction is not printed twice.
- Cost. The ledger gains the roles `first-turn` and `closing-turn`, and the turns' streams are `first-turn-NN.jsonl` and `closing-turn-NN.jsonl` in the phase folder. A closing turn is priced from its own stream's assistant messages, never from the result's cumulative `modelUsage`, because a session the person continued has turns the ledger never saw. As today, the ledger records Claude Code invocations only. Loss accepted: a closing turn's entry misses any cost that the result reports but the messages do not.
- Records and the review surfaces. Until plan 3, phax writes no phase record for a declared interactive phase, so `phax records explain` on its commit finds no record rather than one claiming that an agent session wrote the person's correction. review-handoff.md and the PR body already link the phase's `phase-handoff.md`, which for a declared phase is the interactive handoff, so they make no false claim. They gain nothing in this plan. Loss accepted: until plan 3, the records branch has a gap at each declared phase, and the compliance review may read a correction as a deviation.
- Reconciliation. A declared phase's `file-reconciliation.json` lists every changed file under the new `reviewCorrections`, leaves the created and edited lists empty and sets `hasDeviations` false. A headless phase writes `reviewCorrections: []`.
- Exit codes and errors. Reaching a stop fails the run's effect with a tagged `AwaitingReviewStopError`, which `src/cli/commands/runLayers.ts` maps to 13. Each refused close maps to its own tagged error: a red gate to 4, an editing closing turn or a closing answer still invalid after one corrective resume to 5, an invalid person's handoff file to 1, and a limit to 8. EXIT_CODE_MEANINGS gains `13  Awaiting review at an interactive phase (resumable)`, and plan 2 widens the wording to held phases. The preflight check keeps its id `interactive-phases` and its last place in RUN_PREFLIGHT_CHECKS.
- A declared phase reviewed without change gets an empty commit through a new Git port operation, `commitEmpty`, rather than a flag on `commit`, so that no existing caller changes.
- Message and output wording follows the spec's §6 indicative examples. The continue and fresh-start argv per provider are as phase-03 states. Whether the continued session keeps the headless approval policy is open question q-continue-approvals.

## Open questions

### q-turn-shell — phax's own first turn and closing turn run read-only where the provider allows it. On Claude Code, does that read-only turn get a shell for the phase's frozen agent commands, or no shell at all?

- no-shell — Claude Code's reading tools only (Read, Grep, Glob), with no Bash, and codex's read-only sandbox as it is — abandons: A first reading or closing handoff that has run anything: on Claude Code the turn cannot run the gate or a test to confirm the pattern it reports, and codex, whose read-only sandbox still runs commands, behaves differently.
- phase-commands — Claude Code's reading tools plus Bash for exactly the phase's frozen agent commands (as headless plan authoring grants `phax architecture`) — abandons: A turn that cannot run code. The frozen set includes this repository's `node`, `pnpm exec tsx` and `pnpm format`, so the turn can run arbitrary code with the user's rights outside any write sandbox (claude's read-only flags carry none). It can write to the worktree, which the before/after comparison then restores, and to any path outside the worktree, which nothing checks.

Recommendation: no-shell — These turns only read and report. The person is about to work in the worktree and can run the gate themselves, and the closing gate already runs it. Granting the phase's commands would turn a read-only turn into code execution outside any sandbox. The before/after comparison only sees the worktree, so it cannot catch an edit made elsewhere.

### q-vibe-turns — mistral-vibe has no read-only mode. How do phax's first turn and closing turn run on a vibe phase?

- phase-posture — Run them under the phase's own security posture, with the before/after worktree comparison as the guard (spec §5.26, §5.27, §5.52) — abandons: A narrowed turn on vibe. During the turn, vibe can do anything a headless vibe phase can. An edit the comparison does not see, such as an ignored file, `.phax-context/` or a writable root outside the worktree, goes unrefused.
- refuse-vibe — The run preflight refuses a declared interactive phase routed to mistral-vibe until vibe gains a read-only mode — abandons: Interactive phases on vibe entirely. A vibe user gets no declared stop, which departs from the spec's first turn on every provider (§5.24) and from its acceptance criterion that a vibe first turn which edits is refused.

Recommendation: phase-posture — A vibe turn under the phase posture can do no more than the headless vibe phase it reviews already did. The comparison then refuses and restores what it can see, and the spec's own criterion runs exactly this case. Refusing vibe would break the spec's provider-agnostic promise and protect against no capability the phase itself did not already have.

### q-continue-approvals — The printed continue and fresh-start commands carry the phase's filesystem and network posture (§5.37). Do they also carry the headless approval policy, so that the continued interactive session can never step outside it?

- provider-prompts — Carry the sandbox, writable roots, network and allowed-command flags, but leave each provider's interactive approval prompts on (no codex `approval_policy="never"`; Claude Code keeps asking before any command outside the allowlist) — abandons: The guarantee that a continued session stays inside the phase's sandbox. One approval by the person lets the agent run a command with network access, or one that writes outside the worktree.
- sealed — Also carry the headless approval policy (codex `approval_policy="never"`, and Claude Code without a prompt for commands outside the allowlist), so that the session cannot leave the posture even with the person's approval — abandons: A person approving a one-off command through the agent. They must run it in another shell. On Claude Code this also depends on an interactive no-prompt mode that phax has not verified.

Recommendation: provider-prompts — At a stop the person is present and is the approver. §5.70 already records that the person's work, including a continued session, ran outside phax's enforcement. A sealed command would promise a boundary the person can drop by editing the printed command. With prompts on, every step outside the posture still needs the person's explicit yes.

---

## phase-01 — The awaiting_review state and the run, phase and registry shapes {#phase-01-awaiting-review-state}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high
**Assignment reason:** The phase designs a new state machine arm, awaiting_review with its close-in-progress and refused-close transitions, across the reducer and three persisted shapes: no code in the repository shows this yet.

Give phax a real state for a run that waits for a person. The run and the phase can enter `awaiting_review` with cause `declared` through the reducer only, and run-status.json, a phase's status.json and the registry persist it in new shapes. Frozen decoders keep every run written by the previous release readable.

### Detailed instructions

- In `src/domain/state.ts`, add `awaiting_review` to `RunState` and `PhaseState`. Add the `PhaseSubState` variant `{ state: "awaiting_review"; cause: StopCause }` and the `PhaxState` variant `{ run: "awaiting_review"; phase: { state: "awaiting_review"; cause: StopCause } }`, with `export type StopCause = "declared"` (plan 2 adds `held`). `awaiting_review` is not in `TERMINAL_PHASE_STATES`. Add no deprecated flat transition function.
- In `src/domain/events.ts`, add four events. `ReviewStopReached { phaseId, cause, worktreePath }`. `StopCloseGatePassed { phaseId }`. `StopCloseRefused { phaseId, result: "gate-failed" | "closing-turn-edited" | "handoff-invalid" | "limit", reason }`. `StopClosed { phaseId, outcome: "corrected" | "unchanged" }`.
- In `src/domain/reducer.ts`, interpret the new events. `ReviewStopReached`: running/{running} → awaiting_review/{awaiting_review, cause}, with the effects PersistState (run `stoppedReason: "awaiting_review"`; phase state `awaiting_review` and `stop: { cause, status: "waiting" }`), WriteResumeInstructions with the new kind `awaiting_review`, EmitTrace `review.stop.reached` and EmitTrace `resume.available`. `RunResumeRequested` on awaiting_review: running, with the phase still {awaiting_review, cause} (the close is in progress). `StopCloseGatePassed`: running/{awaiting_review} → running/{passed}. `StopCloseRefused`: from running/{awaiting_review} or running/{passed} → awaiting_review/{awaiting_review, cause}, with PersistState (`lastError` naming the result and the reason) and WriteResumeInstructions `awaiting_review`. `StopClosed`: handled on running/{passed} and on running/{committed}, keeping the state, with PersistState phase `stop: { cause, status: "closed", outcome }`.
- Interpret the existing events on the new run state. `RunArchiveRequested`: awaiting_review is archived with `force`, and otherwise rejected with `run is awaiting_review, not finished; pass --force to archive it anyway`. `PhaseResetRequested`: awaiting_review → interrupted/{pending}, with the same PersistState as today's reset. `RunInterruptRequested`: ignored (`nothing is running while the run awaits review`). `RunStarted`, `RunFailed`, `RunCompleted`, `PhaseStartRequested` and `FinalReviewOpened` are rejected. Every agent, gate, fix, handoff, commit, cleanup, rate-limit and completion event is `stale`. Keep the `assertNever` default in every inner switch, so the compiler proves every arm is handled.
- Extend the WriteResumeInstructions context in `src/domain/effects.ts` with the kind `awaiting_review` (phaseId, worktreePath). Render it in `src/app/resumeInstructions.ts`: the run waits for a person at the phase. The text names the worktree, `phax enter-phase <run> <phase>`, `phax resume <run>` run from the main checkout, and `phax reset-phase <run> <phase>`. Make the dispatcher and effect runner (`src/app/dispatcher.ts`, `src/app/effectRunner.ts`) persist the phase `stop` patch.
- In `src/app/phaxState.ts`, compose awaiting_review from the run status and the stopped phase's status (cause from `stop.cause`). In `src/app/resume.ts`, make `findNextResumablePhase` return a phase in `awaiting_review`, and give awaiting_review no refusal message, since RunResumeRequested is handled.
- In `src/schemas/status.ts`, add `awaiting_review` to both state unions. Add the required phase-status fields `mode` (the `PhaseModeSchema` of `src/schemas/phaxPlan.ts`) and `stop`: `Schema.NullOr` of a union of `{ cause: Literal("declared"), status: Literal("waiting") }` and `{ cause: Literal("declared"), status: Literal("closed"), outcome: Literal("corrected", "unchanged") }`. Add `awaiting_review` to `src/schemas/registry.ts`'s run state. Add no `hold` field.
- Write `mode` and `stop: null` wherever a phase status is first written (`src/app/phaseFolder.ts`, from the plan phase's `mode`), and keep both through every other writer (`src/app/phaseStatusUpdates.ts`, `src/infra/providers/sessionWriter.ts`, `src/app/effectRunner.ts`).
- Freeze the current shapes. Create `src/schemas/history/run-status/0.17.0.ts`, `src/schemas/history/phase-status/0.20.0.ts` and `src/schemas/history/registry/0.17.0.ts`, each a self-contained copy of today's schema, written like the existing frozen modules beside them. In `src/schemas/persisted.ts`, read a document stamped at that release through its frozen decoder. Lift it in memory (a 0.20.0 phase status gets `mode: "headless"` and `stop: null`; run-status and registry are lifted unchanged). Keep refusing a phase status without `base`. Register the frozen shapes in `packages/schemas/src/formats/runDirectory.ts` (`releases` and the upgrade to latest).
- Run `pnpm exec tsx scripts/schemas-check.ts --write`. It writes `packages/schemas/snapshots/{run-status,phase-status,registry}/next.schema.json` and updates `packages/schemas/src/generated/index.ts` and `src/schemas/release.ts`. Then record the three new frozen modules in `packages/schemas/history.lock.json` with the hashes the frozen-history test expects. Update the current-shape fixtures in `tests/unit/schemasPackage/documents.ts`.

### Planned files to create

- `src/schemas/history/run-status/0.17.0.ts`
- `src/schemas/history/phase-status/0.20.0.ts`
- `src/schemas/history/registry/0.17.0.ts`
- `packages/schemas/snapshots/run-status/next.schema.json`
- `packages/schemas/snapshots/phase-status/next.schema.json`
- `packages/schemas/snapshots/registry/next.schema.json`
- `tests/unit/reducerAwaitingReview.test.ts`
- `tests/unit/awaitingReviewShapes.test.ts`

### Planned files to edit

- `src/domain/state.ts`
- `src/domain/reducer.ts`
- `src/domain/events.ts`
- `src/domain/effects.ts`
- `src/app/resumeInstructions.ts`
- `src/app/phaxState.ts`
- `src/app/resume.ts`
- `src/app/phaseFolder.ts`
- `src/schemas/status.ts`
- `src/schemas/registry.ts`
- `src/schemas/persisted.ts`
- `src/schemas/release.ts`
- `packages/schemas/src/formats/runDirectory.ts`
- `packages/schemas/src/generated/index.ts`
- `packages/schemas/history.lock.json`
- `tests/unit/schemasPackage/documents.ts`

### Optional files that may be edited

- `src/app/dispatcher.ts`
- `src/app/effectRunner.ts`
- `src/app/phaseStatusUpdates.ts`
- `src/infra/providers/sessionWriter.ts`
- `src/app/resolveRunInfo.ts`
- `src/cli/commands/ls.ts`
- `src/cli/commands/sessionInfo.ts`
- `src/cli/interruptHandler.ts`
- `src/app/registry.ts`
- `tests/unit/reducer.test.ts`
- `tests/unit/state.test.ts`
- `tests/integration/stateMachineContract.test.ts`
- `tests/unit/schemasPackage/runDirectoryFormats.test.ts`
- `tests/unit/schemasPackage/currentShapes.test.ts`
- `packages/schemas/src/index.ts`
- `tests/type/schemasPackage.ts`

### Boundary contracts

Reducer → effect runner: the reducer only emits PersistState and WriteResumeInstructions effects for the new transitions, and the dispatcher and effect runner are the only writers of run-status.json and status.json. Persisted shapes → readers: every reader decodes through `src/schemas/persisted.ts`, which routes a document by its `$schema` release to the current decoder or a frozen one, and returns the latest in-memory shape. Package → consumers: `@lbdremy/phax-schemas` parses the new and frozen shapes with the same verdicts as phax.

### Test strategy

Write the reducer tests first in `tests/unit/reducerAwaitingReview.test.ts`. Cover every new transition and effect list, a refused close returning to awaiting_review from both awaiting_review and passed, archive with and without force, reset, interrupt ignored, and stale agent events. Write `tests/unit/awaitingReviewShapes.test.ts` for the readers: a 0.20.0 phase status decodes lifted (`mode: "headless"`, `stop: null`), a 0.17.0 run-status and registry still decode, a current status with `awaiting_review` and each `stop` variant round-trips, a `stop` with an unknown cause or a missing `mode` is refused, and a phase status without `base` stays refused. The schemas-package snapshot, frozen-history and current-shapes tests check the snapshots and the lock.

### Implementation order

1. state.ts types and the events
2. reducer arms and their unit tests
3. effects kind and resumeInstructions rendering
4. status, registry schemas and the writers of mode and stop
5. frozen decoders, persisted readers and the package formats
6. snapshot regeneration and history lock

### Excluded scope

- Any code that reaches or closes a stop (phase-04, phase-06)
- The four new stop formats, the reconciliation and cost-ledger shapes (phase-02)
- The `hold` field, the `held` cause and the `builder` origin (plan 2)
- `phax ls`, `phax session-info` output for the new state (phase-05)

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

Name the exact new types and events: `StopCause`, and `ReviewStopReached`, `StopCloseGatePassed`, `StopCloseRefused` and `StopClosed` with their fields, from `src/domain/state.ts` and `src/domain/events.ts`. Give the persisted `stop` variants as written in `src/schemas/status.ts`, and the resume-instructions kind. List the frozen decoder modules and the snapshot files created. Note any exhaustive switch outside the planned files that had to handle the new state, and explain any deviation from the planned file lists.

### Commit subject

`feat(state): add the awaiting_review run and phase state`

### Commit body

A run can now wait for a person: the reducer moves a run and its phase to
awaiting_review with cause `declared`, returns a refused close there, and
lets resume, reset and a forced archive leave it. run-status, phase-status
and the registry gain the state; a phase status records its required
`mode` and `stop`. The current shapes are frozen and read lifted, with
next snapshots for the three formats.

---

## phase-02 — The stop's formats, review corrections in the reconciliation and turn roles in the cost ledger {#phase-02-stop-formats}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

Define every document a declared stop reads or writes: the first-reading and interactive-handoff answers, interactive-session.json and review-stop.json, each born with `$schema`. Give the file reconciliation its `reviewCorrections` list and the cost ledger its `first-turn` and `closing-turn` roles. All are versioned and published through `@lbdremy/phax-schemas`.

### Detailed instructions

- Create `src/schemas/firstReading.ts`: `{ $schema, pattern: NonEmptyArray<NonEmptyString>, copiedBy: Array<{ phase: phase-NN, what: NonEmptyString }>, toCheck: Array<NonEmptyString> }`, refusing unknown keys. Export the file schema, the decoder and the in-memory type without `$schema`.
- Create `src/schemas/interactiveHandoff.ts`: `{ $schema, corrections: NonEmptyArray<{ what, guard }>, patternFromNowOn: Array<NonEmptyString>, nextPhasesNeedToKnow: Array<NonEmptyString> }`. `guard` is exactly `{ kind: "test" | "lint" | "gate-step", ref: NonEmptyString }` or `{ kind: "none", reason: NonEmptyString }`. Refuse unknown keys.
- Create `src/schemas/interactiveSession.ts`: `{ $schema, phaseId, interactiveResume: "verified" | "unverified", current: Session | null, history: Session[], firstTurns: Array<{ origin: "first-turn" | "new-session", outcome: "answered" | "failed" | "refused-change" }> }`. Session is `{ provider (the ProviderId schema), model, effort, sessionId, startedAt (ISO instant), origin: "first-turn" | "new-session" }`.
- Create `src/schemas/reviewStop.ts`, the declared variant only: `{ $schema, run (qualified name), state: "awaiting_review", cause: "declared", phase: { id, title, mode: "interactive", position, of }, firstReading: string | null, worktree, seed, session: { provider, sessionId, origin, interactiveResume } | null, commands: { continue: Command | null, freshStart: Command, enterPhase: Command, close: Command, reset: Command }, lastClose: null | { at, result: "gate-failed" | "closing-turn-edited" | "handoff-invalid" | "limit", exitCode, log: string | null } }`. Command is `{ cwd, argv: NonEmptyArray<string>, env: Record<string, string> }`. Refuse unknown keys, and refuse a `phaseCommit` key on the declared variant.
- Append `first-reading`, `interactive-handoff`, `interactive-session` and `review-stop` to `FORMAT_IDS` and `SCHEMA_BORN_FORMAT_IDS` in `src/schemas/schemaUrl.ts`, updating the doc comments. Add readers to `src/schemas/persisted.ts` for interactive-session.json and review-stop.json, and answer decoders for first-reading and interactive-handoff. An answer with no `$schema`, or with an unknown release, is refused with a message naming the format.
- Publish them: create `packages/schemas/src/formats/interactive.ts` with one `defineFormat` per format, written like `packages/schemas/src/formats/oracleRequest.ts` (`preSchema: null`, `releases: []`). Register them in `packages/schemas/src/index.ts` and `packages/schemas/build/jsonSchemas.ts`, and add a row per format to README.md §Persisted formats (`parseFirstReading`, `parseInteractiveHandoff`, `parseInteractiveSession`, `parseReviewStop`).
- Reconciliation: add a required `reviewCorrections: readonly string[]` to `ReconciliationResult` in `src/domain/reconciliation/types.ts`. `src/domain/reconciliation/reconcile.ts` returns `[]` for it, and `src/app/reconcilePhaseFiles.ts` writes it. Make the field required in `src/schemas/reconciliation.ts`. Create the frozen `src/schemas/history/phase-file-reconciliation/0.17.0.ts`, read a 0.17.0 document lifted with `reviewCorrections: []`, and register the frozen shape in `packages/schemas/src/formats/recordTimeline.ts`. Every other literal `ReconciliationResult` in src gains `reviewCorrections: []`, including executePlan's fallback.
- Cost ledger: add `first-turn` and `closing-turn` to the phase entry roles in `src/schemas/costLedger.ts` and to `InvocationRole` in `src/domain/cost/ledger.ts`. A `closing-turn` entry is priced from its own stream's assistant messages, through the existing per-message pricing, and never from the result's cumulative `modelUsage`. Make the backfill stream scanner in `src/domain/cost/ledger.ts` pick up `first-turn-NN.jsonl` and `closing-turn-NN.jsonl` in a phase folder. Create the frozen `src/schemas/history/cost-ledger/0.25.0.ts`, read lifted unchanged, and register it in `packages/schemas/src/formats/runDirectory.ts`.
- Run `pnpm exec tsx scripts/schemas-check.ts --write`. It writes the `next.schema.json` snapshots of the four new formats, phase-file-reconciliation and cost-ledger, and updates `packages/schemas/src/generated/index.ts` and `src/schemas/release.ts`. Record the two new frozen modules in `packages/schemas/history.lock.json`, and add current-shape fixtures for every new or changed format to `tests/unit/schemasPackage/documents.ts`.

### Planned files to create

- `src/schemas/firstReading.ts`
- `src/schemas/interactiveHandoff.ts`
- `src/schemas/interactiveSession.ts`
- `src/schemas/reviewStop.ts`
- `src/schemas/history/phase-file-reconciliation/0.17.0.ts`
- `src/schemas/history/cost-ledger/0.25.0.ts`
- `packages/schemas/src/formats/interactive.ts`
- `packages/schemas/snapshots/first-reading/next.schema.json`
- `packages/schemas/snapshots/interactive-handoff/next.schema.json`
- `packages/schemas/snapshots/interactive-session/next.schema.json`
- `packages/schemas/snapshots/review-stop/next.schema.json`
- `packages/schemas/snapshots/phase-file-reconciliation/next.schema.json`
- `packages/schemas/snapshots/cost-ledger/next.schema.json`
- `tests/unit/schemas/interactiveFormats.test.ts`
- `tests/unit/costLedgerTurnRoles.test.ts`

### Planned files to edit

- `src/schemas/schemaUrl.ts`
- `src/schemas/persisted.ts`
- `src/schemas/release.ts`
- `src/schemas/reconciliation.ts`
- `src/schemas/costLedger.ts`
- `src/domain/cost/ledger.ts`
- `src/domain/reconciliation/types.ts`
- `src/domain/reconciliation/reconcile.ts`
- `src/app/reconcilePhaseFiles.ts`
- `packages/schemas/src/index.ts`
- `packages/schemas/build/jsonSchemas.ts`
- `packages/schemas/src/generated/index.ts`
- `packages/schemas/src/formats/recordTimeline.ts`
- `packages/schemas/src/formats/runDirectory.ts`
- `packages/schemas/history.lock.json`
- `tests/unit/schemasPackage/documents.ts`
- `README.md`

### Optional files that may be edited

- `src/app/executePlan.ts`
- `src/domain/reconciliation/global.ts`
- `src/schemas/globalReconciliation.ts`
- `src/domain/reconciliation/render.ts`
- `src/domain/cost/history.ts`
- `src/app/costBackfill.ts`
- `src/app/costLedger.ts`
- `tests/unit/schemaUrl.test.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/jsonSchemas.test.ts`
- `tests/unit/schemasPackage/currentShapes.test.ts`
- `tests/type/schemasPackage.ts`
- `tests/integration/reconciliation.test.ts`
- `tests/integration/costLedger.test.ts`
- `tests/integration/persistedProducer.test.ts`
- `packages/schemas/README.md`

### Boundary contracts

Provider → phax: the first and closing turns answer a first-reading or interactive-handoff document in their final message, and phax decodes it at the boundary, refusing a missing or unknown `$schema`. phax → review UI: review-stop.json and interactive-session.json are files a UI reads without running phax, so their shapes are versioned and published in `@lbdremy/phax-schemas`. Reconciliation → records: file-reconciliation.json keeps every existing key and adds `reviewCorrections`.

### Test strategy

Write `tests/unit/schemas/interactiveFormats.test.ts` first. For each new format: a valid document decodes; a missing `$schema`, an unknown release, an unknown key or a value outside each enum is refused; a guard of kind `none` without `reason` is refused; a review-stop with `phaseCommit` is refused. Write `tests/unit/costLedgerTurnRoles.test.ts`: a closing-turn stream whose result reports a cumulative $1.40, with assistant messages pricing $0.30, gives an entry of $0.30, and a first-turn entry is priced as a complete entry. Extend the reconciliation and frozen-history tests: a 0.17.0 reconciliation and a 0.25.0 ledger read lifted. The schemas-package tests check the snapshots, parity and README rows.

### Implementation order

1. the four schemas and their decoders, with tests
2. FORMAT_IDS, readers and package formats
3. reconciliation field and its frozen decoder
4. cost-ledger roles, pricing and frozen decoder
5. snapshot regeneration, history lock, fixtures and README rows

### Excluded scope

- Building or writing any of these documents at runtime (phase-03, phase-04, phase-06)
- The run-list format and `phax ls --json` (plan 3)
- The `held` cause, the `builder` origin and a held review-stop variant (plan 2)

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

List the exported schema, type and decoder names of each new module in `src/schemas/`, and the reader names in `src/schemas/persisted.ts`. Give the exact `reviewCorrections` field, the new cost-ledger roles, and the function that prices a closing turn from its own messages. Name the stream file names the backfill scanner reads, and explain any deviation from the planned file lists.

### Commit subject

`feat(schemas): add the declared stop's formats and turn roles`

### Commit body

first-reading, interactive-handoff, interactive-session and review-stop are
born with $schema and published in @lbdremy/phax-schemas. The file
reconciliation gains a required reviewCorrections list, and the cost ledger
the first-turn and closing-turn roles; a closing turn is priced from its own
messages, never from a session's cumulative cost. Both older shapes are
frozen and read lifted.

---

## phase-03 — Pure builders for the seed, the handoff, the review-stop document and the continue commands {#phase-03-stop-builders}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** The phase writes several new builders whose output other parts consume as contracts, and per-provider argv that must match each CLI exactly, so it needs more care than the default effort.

Provide the pure domain logic of a declared stop: the seed text, the first and closing turns' prompts, the interactive handoff's validation and rendering, the review-stop document, the `## Review corrections` section and the worktree-change verdict. Also provide each provider's interactive resume support with its continue and fresh-start commands, including codex's interactive resume of a headless phase.

### Detailed instructions

- Create `src/domain/interactive/seed.ts` with `buildDeclaredSeed(input)`. Input: run short name, phase id and title, the phase's plan section, executed phases' handoffs in plan order (`{ id, title, text }`), upcoming phases' plan sections in plan order, the gate commands and the close command. It returns the markdown of the spec's §6 declared seed: a title; why the run stopped, naming the later phases from the phase's Detailed instructions; `## What is expected of you` (correct the pattern, add a guard per correction, keep the scope, optionally write `.phax-context/correction-handoff.md` in the four sections); `## What to review`; `## Executed phases`; `## Upcoming phases`; `Full plan: .phax-context/plan.md`; `## Gate`; and `## Close the phase` with the close command, run from the main checkout. It never tells an agent how to stop a run.
- Create `src/domain/interactive/firstReading.ts`. `firstTurnPrompt({ seedPath, schemaJson })` asks the session to read the seed, change nothing, and answer only a first-reading document valid against the given schema. `renderFirstReading(doc)` returns the markdown of `first-reading.md` (pattern at stake, what each upcoming phase copies, what to check). Also export the corrective prompt used for one corrective resume after an invalid answer.
- Create `src/domain/interactive/handoff.ts`. `INTERACTIVE_HANDOFF_SECTIONS` is `## What was corrected`, `## The pattern to follow from now on`, `## Guards` and `## What the next phases need to know`. `validateInteractiveHandoff(markdown)` returns either the validated handoff or a list of defects: a missing section, one out of order, or a count mismatch (`## Guards` must hold exactly one list entry per `## What was corrected` entry, in order, each naming a ref or starting `no guard:`). `renderInteractiveHandoff(answer)` renders an interactive-handoff document in those sections (a `none` guard as `no guard: <reason>`). `REVIEWED_WITHOUT_CHANGE_HANDOFF` is the fixed text for an unchanged stop, which itself passes validation. `closingTurnPrompt({ diff, seedPath | null, schemaJson })` asks for the handoff of the given corrections, changing nothing.
- Create `src/domain/interactive/worktreeChange.ts` with `worktreeChangeVerdict({ before, after, changed })`, where `before` and `after` are snapshot tree ids and `changed` is the name-status list between them. It returns `{ kind: "unchanged" }` or `{ kind: "changed", paths }` with sorted paths, never listing a path under `.phax-context/`.
- Create `src/domain/interactive/reviewStop.ts` with `buildDeclaredReviewStop(input)`, which returns the in-memory review-stop value (the shape of `src/schemas/reviewStop.ts` without `$schema`). It takes the qualified run name, the phase, the worktree, the seed path, the first-reading path or null, the current session or null, the interactive resume support, the continue command or null, the fresh-start command and `lastClose`. `enterPhase` is `phax enter-phase <run> <phase>`, `close` is `phax resume <run>` and `reset` is `phax reset-phase <run> <phase>`, all with the main checkout as cwd. `continue` is null when there is no current session or the provider is unverified.
- Create `src/domain/interactive/reviewCorrections.ts` with `renderReviewCorrectionsSection(stops)`, where stops are `{ phaseId, cause: "declared", handoff }` in plan order. It returns null when there are none. Otherwise it returns `## Review corrections`, a sentence that a person reviewed and corrected the run at the listed phases, that this section wins where it disagrees with an earlier handoff, and that the phase's own plan section still binds, then `### <phase> (interactive)` with each handoff verbatim.
- Session adapters, in `src/domain/session/types.ts`: add `interactiveResume: "verified" | "unverified"`, `buildContinueCommand(opts)` and `buildFreshStartCommand(opts)` to `SessionAdapter`. Both return `{ executable, args, cwd, env }`, and `ResumeInvocation`'s executable variant gains `env`. opts carry cwd, session id (continue only), model, effort, the phase's `SecurityPolicy`, its frozen agent commands and, for a fresh start, the initial prompt.
- Claude Code (`src/domain/session/claude.ts`): verified. Continue is `claude --resume <id> --model <model> --effort <effort> <claudePermissionFlags of the phase policy> --`, with nothing after `--` for a resume. Fresh start is the same without `--resume`, ending `-- <prompt>`. Apply the operator's decision on q-continue-approvals: with `provider-prompts`, under a secure policy use `--permission-mode default` in place of `acceptEdits` and keep the rest. With `sealed`, keep the headless flags.
- codex (`src/domain/session/codex.ts`): verified. Move the secure-mode flag builder from `src/infra/providers/codexCli.ts` into a new pure `src/domain/session/codexPostureFlags.ts`, and make codexCli import it with its argv unchanged. Continue is `codex resume <id> -m <model> -c model_reasoning_effort="<effort>"`, followed by the posture flags. Following q-continue-approvals, drop `approval_policy="never"` for `provider-prompts` and keep it for `sealed`. Fresh start is `codex -m … <posture flags> "<prompt>"`. `buildResumeInvocation(binding)` now returns `codex resume <sessionId>` with the binding's model and effort in the binding's worktree (spec §5.42), and an unsupported answer only when no session id is recorded.
- mistral-vibe (`src/domain/session/mistral.ts`): unverified. Continue is never built. Fresh start is `vibe --workdir <cwd> "<prompt>"` with `env: { VIBE_ACTIVE_MODEL: <model> }`. `buildResumeInvocation` keeps its unsupported answer.
- Export a domain helper `freshStartPrompt(phaseId)`, returning `Read .phax-context/interactive-review.md, then review <phase> with me.`

### Planned files to create

- `src/domain/interactive/seed.ts`
- `src/domain/interactive/firstReading.ts`
- `src/domain/interactive/handoff.ts`
- `src/domain/interactive/worktreeChange.ts`
- `src/domain/interactive/reviewStop.ts`
- `src/domain/interactive/reviewCorrections.ts`
- `src/domain/session/codexPostureFlags.ts`
- `tests/unit/interactive/seed.test.ts`
- `tests/unit/interactive/handoff.test.ts`
- `tests/unit/interactive/reviewStop.test.ts`
- `tests/unit/interactive/reviewCorrections.test.ts`
- `tests/unit/interactive/worktreeChange.test.ts`
- `tests/unit/interactive/firstReading.test.ts`
- `tests/unit/continueCommands.test.ts`

### Planned files to edit

- `src/domain/session/types.ts`
- `src/domain/session/claude.ts`
- `src/domain/session/codex.ts`
- `src/domain/session/mistral.ts`
- `src/infra/providers/codexCli.ts`
- `tests/unit/sessionAdapters.test.ts`

### Optional files that may be edited

- `src/domain/session/index.ts`
- `src/domain/session/claudePermissionFlags.ts`
- `src/infra/session.ts`
- `src/ports/session.ts`
- `src/infra/fakes/session.ts`
- `src/cli/commands/enterPhase.ts`

### Boundary contracts

Domain → app: every builder is pure and takes plain values, and the app supplies the handoff texts, plan sections, snapshots and policies read through ports. Domain → provider CLIs: each adapter's argv is the provider's own CLI form, verified for `claude --resume` and `codex resume` and never built for vibe's interactive resume. Infra codexCli → domain posture flags: the headless argv must stay byte-identical after the move.

### Test strategy

Unit tests only, written before the builders. Seed: every section the spec lists, in order, with the made-up invoice-export plan; no text about stopping a run. Handoff: each defect (missing `## Guards`, sections out of order, three corrections with two guards) and a valid one; the rendered answer and the fixed text both validate. Review-stop: `continue` is null with no session and with an unverified provider, and the enterPhase, close and reset argv. Review corrections: none gives null, two stops keep plan order, and the precedence sentence is present. Worktree verdict: unchanged, changed, and `.phax-context/` filtered. Continue commands (`tests/unit/continueCommands.test.ts`): claude and codex argv carry model, effort and posture flags, vibe's fresh start carries the env and prompt, and codex resumes a headless binding. The existing codex argv tests must still pass unchanged.

### Implementation order

1. handoff validation and rendering
2. seed, first-reading and closing prompts
3. worktree verdict and review-stop builder
4. review corrections section
5. codex posture flags move
6. session adapters and their argv tests

### Excluded scope

- Writing any file, spawning any session or running git (phase-04, phase-05, phase-06)
- The held seed, the builder origin and correction-handoff beside a builder's handoff (plan 2)
- Transcript capture and its session-store lookup (plan 3)

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

List every exported function and constant with its module path under `src/domain/interactive/` and `src/domain/session/`, and the new `SessionAdapter` members with their option and return shapes. Say which q-continue-approvals verdict the argv implements and give the exact argv per provider. Confirm that codexCli's headless argv is unchanged, and explain any deviation from the planned file lists.

### Commit subject

`feat(interactive): add the declared stop's pure builders and continue commands`

### Commit body

The seed, the first and closing turn prompts, the interactive handoff's
validation and rendering, the review-stop document, the Review corrections
section and the worktree-change verdict are pure domain functions. Each
provider declares its interactive resume support and builds its own continue
and fresh-start commands; codex now resumes a session interactively with
`codex resume <id>`.

---

## phase-04 — Reaching a declared stop: seed, read-only first turn, review-stop document and exit 13 {#phase-04-declared-stop}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high
**Assignment reason:** The phase adds new adapter capabilities (worktree snapshots and restore through a temporary index, codex read-only turns) and a use case that crosses git, the backend, files and the reducer, which no existing code shows.

Add the use case that stops a run at a declared interactive phase. It writes the seed and runs one read-only first turn that never edits the worktree, records the session and the first reading, writes review-stop.json and moves the run to `awaiting_review`. Its caller exits 13. It is tested at the use-case level; executePlan does not call it yet, because lint and the run preflight still refuse interactive phases.

### Detailed instructions

- Git port (`src/ports/git.ts`), Node adapter (`src/infra/git.ts`) and fake (`src/infra/fakes/git.ts`) gain four operations. `snapshotWorktree(path)` returns the tree id of the tracked files plus the untracked files that are not ignored, excluding `.phax-context/`, built in a temporary index file (`GIT_INDEX_FILE` in a temp dir, `git add -A -- . ':(exclude).phax-context'`, `git write-tree`) and never touching the real index. `changedPathsBetween(path, fromTree, toTree)` returns name-status entries (`git diff-tree -r --name-status`). `restoreWorktree(path, tree)` makes the worktree's non-ignored files outside `.phax-context/` match `tree`: it checks out the changed and deleted paths from the tree and removes the paths the tree lacks. `commitEmpty(repo, subject, body)` runs `git commit --allow-empty`.
- codex read-only (`src/infra/providers/codexCli.ts`): when `AgentRunOptions.readOnly` is true, both `exec` and `exec resume` use `-c sandbox_mode="read-only"` and `-c approval_policy="never"`, with no writable roots and no network override, whatever the policy. Claude Code already honours `readOnly` with `claudeReadOnlyFlags`. Apply the operator's decision on q-turn-shell: with `no-shell`, phax's first turn passes no agent commands, so Claude keeps only Read, Grep and Glob. With `phase-commands`, it passes the phase's frozen agent commands. Apply q-vibe-turns: with `phase-posture`, a vibe turn runs under the phase posture, and the comparison is its guard. With `refuse-vibe`, add a run preflight refusal for an interactive phase resolved to mistral-vibe in `src/app/runPreflight.ts`, under the existing `interactive-phases` check.
- Create `src/app/interactiveFiles.ts`, which reads and writes through the FileSystem port. `interactive-session.json` and `first-reading.md` live in the phase folder. `review-stop.json` lives in the run folder: it is written stamped with `withSchemaUrl`, read through the readers in `src/schemas/persisted.ts`, and removed. Seed paths are `.phax-context/interactive-review.md` in the worktree and `review-seed.md` in the phase folder.
- Create `src/app/interactiveStop.ts`. `runFirstTurn(input)` resolves the phase's provider, model and effort with `resolveModel` and the phase's security policy, and writes `model-resolution.json`. It snapshots the worktree, then runs `Backend.runAgent` with `readOnly: true`, the `firstTurnPrompt` of `src/domain/interactive/firstReading.ts` and output `first-turn-NN.jsonl` in the phase folder, wrapped in `withInvocationCost` with role `first-turn`. It decodes the answer with one corrective `resumeAgentSession` on an invalid answer, then snapshots again. A changed verdict is restored with `restoreWorktree`, records outcome `refused-change` naming the paths, and keeps no session. A rate or usage limit, a provider error or a still-invalid answer records `failed` with its reason and keeps no session. `answered` makes the session current (origin `first-turn` or, given `origin`, `new-session`, pushing the previous current into `history`) and writes `first-reading.md`. The session id always comes from the turn's stream (`AgentRunResult.sessionId`).
- `stopAtDeclaredPhase(input)`, given a phase whose worktree, setup commands and `.phax-context/plan.md` are already in place: builds the seed with `buildDeclaredSeed` (executed handoffs read from `<run>/<phase>/phase-handoff.md`, plan sections from the located plan sections) and writes both copies. It runs `runFirstTurn`, then builds the continue command (current session and verified provider) and the fresh-start command with the adapters of `src/domain/session/`, and writes `review-stop.json` with `buildDeclaredReviewStop`. It dispatches `ReviewStopReached` (cause `declared`) and returns a stop report: the review-stop value, the first-reading markdown or null, and the first-turn failure reason or null. It never reads stdin.
- Add `AwaitingReviewStopError` (run, phase, review-stop path, the stop report) to `src/domain/errors.ts`. Map it to exit 13 in `src/cli/commands/runLayers.ts`, and add `{ code: 13, meaning: "Awaiting review at an interactive phase (resumable)" }` to `EXIT_CODE_MEANINGS`. Add row 13 to README.md §Exit codes, then run `pnpm gen:usage-spec` and `pnpm docs:cli` so the drift tests stay green.
- Do not call `stopAtDeclaredPhase` from `src/app/executePlan.ts`, and do not change the `interactive` lint check or the run preflight's refusal of interactive phases.

### Planned files to create

- `src/app/interactiveFiles.ts`
- `src/app/interactiveStop.ts`
- `tests/integration/gitWorktreeSnapshot.test.ts`
- `tests/integration/declaredStop.test.ts`
- `tests/unit/codexReadOnlyArgs.test.ts`

### Planned files to edit

- `src/ports/git.ts`
- `src/infra/git.ts`
- `src/infra/fakes/git.ts`
- `src/infra/providers/codexCli.ts`
- `src/domain/errors.ts`
- `src/cli/commands/runLayers.ts`
- `README.md`
- `phax.usage.kdl`
- `docs/cli/reference.md`

### Optional files that may be edited

- `src/infra/fakes/backend.ts`
- `src/infra/providers/mistralVibe.ts`
- `src/infra/providers/claudeCode.ts`
- `src/app/runPreflight.ts`
- `src/app/costLedger.ts`
- `src/app/handoffInjection.ts`
- `src/app/modelResolution.ts`
- `docs/cli/inventory.md`
- `tests/unit/readmeExitCodes.test.ts`
- `tests/unit/runPreflight.test.ts`

### Boundary contracts

App → Git port: the snapshot, diff, restore and empty-commit operations are the only way the stop compares, restores or commits a worktree. App → Backend port: a first turn is `runAgent` with `readOnly: true` and its session id from the stream, never `--session-id`, and a read-only mode narrows the turn but the before/after comparison always guards it. App → reducer: the stop transitions only by dispatching `ReviewStopReached`. Use case → CLI: `AwaitingReviewStopError` carries the stop report that the run and resume commands will render (phase-06).

### Test strategy

Write `tests/integration/gitWorktreeSnapshot.test.ts` first against a temp repository (tests/helpers/tempGit.ts). The snapshot ignores `.phax-context/` and ignored files; a modified, an added and a deleted file each change the tree; restore brings back the before state and leaves ignored files and `.phax-context/` alone; `commitEmpty` lands an empty commit. `tests/unit/codexReadOnlyArgs.test.ts` covers read-only exec and exec resume argv. `tests/integration/declaredStop.test.ts` drives `stopAtDeclaredPhase` with the fake backend on a temp repo and the made-up invoice-export plan. Cases: a valid first turn (session current with origin `first-turn`, `first-reading.md` written, both seed copies identical, review-stop with a continue command, run and phase `awaiting_review` with cause `declared`, `resume-instructions.md` written, `readOnly` passed); a turn that edits a file (restored, `refused-change`, no session, fresh start only); a rate limit, a provider error and two answers without `$schema` (each `failed`, no session, exactly one corrective resume in the last case); and no stdin read. Add a runLayers test that the error maps to 13.

### Implementation order

1. git port operations with integration tests
2. codex read-only argv
3. interactiveFiles
4. runFirstTurn
5. stopAtDeclaredPhase
6. error, exit code 13, README row and usage regeneration

### Excluded scope

- Wiring the stop into executePlan or lifting the interactive refusal (phase-06)
- Rendering the stop's output in `phax run` and `phax resume` (phase-06)
- enter-phase, ls, session-info, reset-phase, archive and adjust-plan at a stop (phase-05)
- The held stop (plan 2) and transcripts, posture records and estimates (plan 3)

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

Give the exact signatures of `snapshotWorktree`, `changedPathsBetween`, `restoreWorktree` and `commitEmpty`; of `runFirstTurn` and `stopAtDeclaredPhase` in `src/app/interactiveStop.ts`; and of the file helpers in `src/app/interactiveFiles.ts`. Give the shape of the stop report and of `AwaitingReviewStopError`. Say how the q-turn-shell and q-vibe-turns decisions were applied. Explain any deviation from the planned file lists.

### Commit subject

`feat(interactive): stop a run at a declared phase after a read-only first turn`

### Commit body

stopAtDeclaredPhase writes the seed, runs one read-only first turn that is
restored and refused if it edits the worktree, records its session and first
reading, writes review-stop.json and moves the run to awaiting_review.
Worktree snapshots go through a temporary index behind the Git port; codex
honours read-only turns. Exit 13 joins the exit table. Not wired into runs
yet: the interactive refusal stays.

---

## phase-05 — Commands on a stopped run: enter-phase, ls, session-info, path, reset, archive and adjust-plan {#phase-05-commands-while-stopped}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** The phase reworks eight commands around a new state, and moves enter-phase's logic into a use case that reuses the first turn, so it needs more care than the default effort.

Make a run in `awaiting_review` visible and workable from the CLI. `phax ls` and `phax session-info` show it as waiting, with its cause and stopped phase, and `phax ls --awaiting-review` filters it. path, shell and open target the stopped worktree. `phax enter-phase` continues the current session or starts a fresh one, `--new-session` runs a new first turn, and codex headless phases resume interactively. reset-phase, archive and adjust-plan treat the stop correctly.

### Detailed instructions

- Create `src/app/enterPhase.ts` with the enter-phase use case, and make `src/cli/commands/enterPhase.ts` a thin caller that renders its result through the OutputPort. When the run is in `awaiting_review` and the phase is the stopped phase (read `review-stop.json` and `interactive-session.json` with `src/app/interactiveFiles.ts`): with `newSession`, call `runFirstTurn` from `src/app/interactiveStop.ts` with origin `new-session`, then rewrite `first-reading.md` and `review-stop.json`. Then run the continue command when there is a current session and the provider is `verified`, and the fresh-start command otherwise (warning for an unverified provider that its session will not be captured). Spawn through the Session port, with the command's env. For any other phase, keep today's binding resume, which now resumes codex (`codex resume <id>`) through the adapter. `--new-session` on a phase that is not stopped is refused with exit 1, naming the phase's state.
- Add `--new-session` to `enter-phase` and `--awaiting-review` to `ls` in `src/cli/program.ts`, and describe both in `src/cli/cliDocs.ts`.
- `src/cli/commands/ls.ts`: `--awaiting-review` lists only runs in `awaiting_review`. In the text table, a waiting run's state reads `awaiting_review (declared)`, and its PHASE column appends the stopped phase id (for example `3/6 phase-03`), both read from the run's `review-stop.json` through an app helper. Leave `phax ls --json` as it is today (plan 3 versions it).
- `src/cli/commands/sessionInfo.ts`: for a run in `awaiting_review`, print the state with its cause, the stopped phase (mode interactive), its worktree, the seed path, and the current session (provider, id, origin) with `phax enter-phase <run> <phase>`, or `none`.
- path, shell and open already target the highest-index phase's worktree (`src/app/resolveRunInfo.ts`), which is the stopped phase. Add tests proving it with a fake shell and a fake editor, and change code only if a test fails.
- `src/app/resetPhase.ts` and `src/cli/commands/resetPhase.ts`: when the target is the stopped phase of a run in `awaiting_review`, the confirmation names every uncommitted correction (`snapshotWorktree` against the HEAD tree via `changedPathsBetween`, shown as `M`/`A`/`D` lines) and says that resume sets the phase up again and stops there. On confirmation, remove the worktree, the phase branch, `interactive-session.json`, `first-reading.md`, `review-seed.md` and `review-stop.json`, then dispatch `PhaseResetRequested`. When the target comes before the stopped phase, refuse, naming the stopped phase to reset first, and change nothing.
- `src/app/archive.ts` / `src/cli/commands/archive.ts`: a run in `awaiting_review` is unfinished. Without `--force`, the refusal names the state and the flag. With `--force` the run is archived and `review-stop.json` goes with the run folder.
- `src/app/adjustPlan.ts`: `--landed` on a run in `awaiting_review` is refused before any session starts, naming the run's state.
- The phase guard (`src/domain/security/phaseGuard.ts`) is unchanged. Add a test that `phax resume` and `phax enter-phase` run inside a stopped phase's worktree are refused with the phase-guard message, and that the run stays `awaiting_review`.
- Regenerate `phax.usage.kdl` with `pnpm gen:usage-spec` and the CLI docs with `pnpm docs:cli`.
- Build test fixtures for a stopped run either by calling `stopAtDeclaredPhase` (src/app/interactiveStop.ts) with the fake backend on a temp repository, or by writing the run folder's files through the schemas. Use the made-up invoice-export (stopped) and credit-notes runs.

### Planned files to create

- `src/app/enterPhase.ts`
- `tests/integration/stoppedRunCommands.test.ts`

### Planned files to edit

- `src/cli/commands/enterPhase.ts`
- `src/cli/program.ts`
- `src/cli/cliDocs.ts`
- `src/cli/commands/ls.ts`
- `src/cli/commands/sessionInfo.ts`
- `src/app/resetPhase.ts`
- `src/cli/commands/resetPhase.ts`
- `src/app/archive.ts`
- `src/app/adjustPlan.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `tests/integration/enterPhase.test.ts`
- `tests/integration/sessionInfo.test.ts`
- `tests/integration/resetPhase.test.ts`
- `tests/integration/archive.test.ts`
- `tests/integration/adjustPlan.test.ts`
- `tests/unit/cli/ls.test.ts`

### Optional files that may be edited

- `src/cli/commands/archive.ts`
- `src/cli/commands/adjustPlan.ts`
- `src/cli/commands/path.ts`
- `src/cli/commands/shell.ts`
- `src/cli/commands/open.ts`
- `src/app/resolveRunInfo.ts`
- `src/app/interactiveFiles.ts`
- `src/infra/session.ts`
- `src/ports/session.ts`
- `src/infra/fakes/session.ts`
- `docs/cli/inventory.md`
- `src/cli/cliCompleters.ts`

### Boundary contracts

CLI → app: each command parses its arguments, calls one use case and renders its result through the OutputPort, so enter-phase's logic moves into `src/app/enterPhase.ts`. App → Session port: an interactive continue or fresh start is spawned through the Session port with the command's cwd, argv and env, and phax never parses its output. App → files: the stop's facts come from `review-stop.json` and `interactive-session.json` through `src/app/interactiveFiles.ts`.

### Test strategy

Integration tests with a fake session spawner, a fake shell and a fake editor that record cwd and argv. enter-phase spawns `codex resume X1` in phase-03's worktree for a stop with a current codex session, the fresh-start command for a stop whose first turn failed, and `codex resume X9` for a committed headless codex phase-01. None refuses as unsupported. `--new-session` runs a new read-only first turn and makes X2 current with origin `new-session`, keeping X1 in history. ls lists the waiting run with `awaiting_review (declared)` and `phase-03`, `--awaiting-review` lists it alone, and a failed and an interrupted run are not shown as waiting. session-info prints state, cause, phase, worktree and session. path, shell and open target phase-03's worktree. reset at the stop names three uncommitted files and removes the worktree, branch and session files, and reset of phase-02 is refused naming phase-03. archive without `--force` is refused, and with it the run is archived. adjust-plan `--landed` is refused, naming awaiting_review, and starts no session. The phase guard refuses resume and enter-phase inside the worktree.

### Implementation order

1. enterPhase use case and the thin CLI command
2. program flags, cliDocs and usage regeneration
3. ls and session-info views
4. reset-phase at a stop
5. archive and adjust-plan refusals
6. path/shell/open and phase-guard tests

### Excluded scope

- Closing the stop through `phax resume` (phase-06)
- The versioned `phax ls --json` run list and its `stop` field (plan 3)
- Reset of a held phase's commit (plan 2)

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

Give the `src/app/enterPhase.ts` signature and its result variants, and the helper ls uses to read a run's stop. Give the exact text of the new refusals (reset before the stop, archive without force, adjust-plan, `--new-session` on a phase that is not stopped). State whether path, shell or open needed a code change, and explain any deviation from the planned file lists.

### Commit subject

`feat(interactive): act on a run awaiting review from the CLI`

### Commit body

phax ls and session-info show a run awaiting review with its cause and
stopped phase, and ls --awaiting-review filters it. enter-phase continues the
stop's current session or starts a fresh one, runs a new read-only first turn
with --new-session, and resumes codex sessions interactively. reset-phase
resets the stopped phase first, archive needs --force, and adjust-plan waits
for the run to land.

---

## phase-06 — Closing a declared stop through phax resume, with the interactive refusal lifted {#phase-06-closing-and-lift}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high
**Assignment reason:** Closing adds a new re-entry path to executePlan's resume sequence and reorders gate, handoff and commit for a phase no agent built. It crosses the run loop, the gate, git and the prompts, which no existing code shows.

Make a plan-declared interactive phase run end to end. `phax run` stops at it with exit 13 and prints the stop. `phax resume` gates the worktree first, takes the person's handoff or a read-only closing turn's, and commits the corrections (or an empty commit) with an `Interactive-Phase:` trailer. It then continues the run, and later phases read the correction under `## Review corrections`. Lint and the run preflight replace the not-yet-supported refusal with the placement and planned-work rules.

### Detailed instructions

- Create `src/app/closeStop.ts` with `closeDeclaredStop(input)`, called after `RunResumeRequested` has moved the run to running with the phase still awaiting_review. (1) Snapshot the worktree (`snapshotWorktree`), then run the phase's gate profile once with `runGates` from `src/app/gates.ts`, on the non-terminal steps, with no fix loop. A red or refused step dispatches `StopCloseRefused` (result `gate-failed`), writes `lastClose` into `review-stop.json` with the attempt's log, and fails with a tagged error mapped to exit 4. Nothing is committed. (2) On green, dispatch `StopCloseGatePassed`. (3) Compare the snapshot with the HEAD tree. With no change, the handoff is `.phax-context/correction-handoff.md` when present and valid, else `REVIEWED_WITHOUT_CHANGE_HANDOFF`, and no closing turn runs. (4) With a change: a person's file present is validated with `validateInteractiveHandoff`, and if invalid the close is refused (result `handoff-invalid`, exit 1, naming the defects). Otherwise the closing turn runs: a read-only `resumeAgentSession` of the current session with `closingTurnPrompt` and the corrections diff, or, with no current session or a resume failure other than a limit, a new read-only session given the seed and the diff. Its output is `closing-turn-NN.jsonl`, wrapped in `withInvocationCost` with role `closing-turn`. The answer is decoded with one corrective resume (still invalid: refused, exit 5). A limit is refused (result `limit`, exit 8, naming the reset time). Snapshot again: if it differs from the gated snapshot, refuse (result `closing-turn-edited`, exit 5, naming the files, leaving them in place). The q-turn-shell and q-vibe-turns decisions apply as they do to first turns. (5) Write the interactive handoff to `<run>/<phase>/phase-handoff.md`.
- (6) Commit on the phase branch, excluding `.phax-context/`: with a change, the plan's subject and body plus an `Interactive-Phase: <phase id>` trailer, authored by the checkout's git identity (git's default). With no change, `commitEmpty` with the same subject and trailer. Never raise `PhaseHadNoChangesError`. Extend `src/app/commit.ts` with an interactive option rather than duplicating it. Dispatch `CommitCreated` and `StopClosed` with outcome `corrected` or `unchanged`. (7) Reconcile with every changed file listed under `reviewCorrections`, the created and edited lists empty and `hasDeviations` false. (8) Remove `review-stop.json`. The run's `phax-plan.json` and plan.md are never written.
- Wire `src/app/executePlan.ts`. On reaching a phase whose `mode` is `interactive` (not a resume re-entry), create its branch, folder, worktree and setup, and write `.phax-context/plan.md`, as for any phase. Then call `stopAtDeclaredPhase` from `src/app/interactiveStop.ts` and fail with `AwaitingReviewStopError`, running no work session, gate or fix loop. On resume, when the start phase's status is `awaiting_review`, call `closeDeclaredStop` and then continue with the cleanup commands and the next phase in the same invocation. Write no phase record for an interactive phase. Map the close's tagged errors so that the top-level guard never dispatches RunFailed for them.
- Prompts: in `src/app/handoffInjection.ts`, add a reader that collects, in plan order, the `phase-handoff.md` of every earlier interactive phase whose status `stop` is closed. Make `readPreviousHandoff` skip back over interactive phases to the nearest earlier headless phase. In `src/app/promptGeneration.ts`, append the `renderReviewCorrectionsSection` output of `src/domain/interactive/reviewCorrections.ts` after `## Previous phase handoff` when it is not null, and only then, so prompts of plans without a stop are unchanged.
- Lint: in `src/domain/plan/interactiveCheck.ts`, delete `unsupportedInteractiveFindings`. `interactiveFindings({ headers, phases })` reports the malformed Mode lines, then the placement rule (an interactive phase that is the first phase, the last phase, or directly follows another interactive phase; messages as in spec §6), then the planned-work rule (one error per planned file to create or edit, naming the file), which reports nothing when `phases` is null. Pass the parsed phases from `src/app/lintPlan.ts` and the plan's phases from `src/app/runPreflight.ts` (check id `interactive-phases`, refusal heading `Interactive preflight failed: N error(s).`, exit 11). The `oracles` check stays untouched.
- Create `src/cli/commands/stopOutput.ts`, the view that renders a stop report as in the spec's §6 declared-stop example: cause, first reading or the failure, worktree, seed, continue or fresh-start command, `phax enter-phase`, `phax resume`, and the review-stop path. Use it in `src/cli/commands/run.ts` and `src/cli/commands/resume.ts` on `AwaitingReviewStopError`, exiting 13. Render each refused close with its reason and the phase staying awaiting review. On a successful close, print the gate lines, the handoff source and `committed <hash> (corrected|unchanged)`.
- Update the tests that assert the old refusal (`tests/unit/interactiveCheck.test.ts`, `tests/unit/runPreflight.test.ts`, `tests/integration/lintPlan.test.ts`, `tests/integration/runPreflightBeforeNaming.test.ts`, `tests/integration/resumePreflightRechecks.test.ts`) to the new rules. The interrupted-run case keeps its state and last error when its plan's last phase is interactive.

### Planned files to create

- `src/app/closeStop.ts`
- `src/cli/commands/stopOutput.ts`
- `tests/integration/declaredStopRun.test.ts`
- `tests/integration/declaredStopClose.test.ts`

### Planned files to edit

- `src/app/executePlan.ts`
- `src/app/commit.ts`
- `src/app/handoffInjection.ts`
- `src/app/promptGeneration.ts`
- `src/domain/plan/interactiveCheck.ts`
- `src/app/lintPlan.ts`
- `src/app/runPreflight.ts`
- `src/cli/commands/run.ts`
- `src/cli/commands/resume.ts`
- `src/domain/errors.ts`
- `src/cli/commands/runLayers.ts`
- `tests/unit/interactiveCheck.test.ts`
- `tests/unit/runPreflight.test.ts`
- `tests/integration/lintPlan.test.ts`
- `tests/integration/runPreflightBeforeNaming.test.ts`
- `tests/integration/resumePreflightRechecks.test.ts`
- `tests/unit/promptGeneration.test.ts`

### Optional files that may be edited

- `src/app/gates.ts`
- `src/app/reconcilePhaseFiles.ts`
- `src/app/interactiveStop.ts`
- `src/app/interactiveFiles.ts`
- `src/app/cleanup.ts`
- `src/app/resume.ts`
- `src/app/phaseFolder.ts`
- `tests/unit/__snapshots__/promptGeneration.test.ts.snap`
- `src/infra/fakes/backend.ts`
- `src/infra/fakes/git.ts`

### Boundary contracts

executePlan → stop use cases: executePlan only decides when to stop (mode interactive) and when to close (status awaiting_review). Everything else goes through `stopAtDeclaredPhase` and `closeDeclaredStop`, which talk to git, the backend and files through ports and to the state only through the reducer. Lint and the preflight share one domain check, so a lint error is the preflight's refusal. Later phases' prompts depend on the closed stop's `phase-handoff.md` and its status `stop.status`.

### Test strategy

Write the check tests first in `tests/unit/interactiveCheck.test.ts`: first, last and directly-following placements; a planned edit naming its file; an optional file reporting nothing; malformed Mode lines unchanged; and no row saying the phase cannot run yet. Integration tests through executePlan with the fake backend on temp repositories. `tests/integration/declaredStopRun.test.ts`: a six-phase made-up invoice-export plan whose phase-03 is interactive. phase-01 and phase-02 commit; phase-03's worktree sits on phase-02's commit with the setup marker; the fake is spawned once for phase-03, read-only and headless, and no gate runs; the run ends awaiting_review with exit 13. A run with no TTY and an idle stdin pipe never reads stdin, and a plan with no interactive phase never stops and keeps its prompts. `tests/integration/declaredStopClose.test.ts` covers closing. The gate runs before any turn. A closing turn resumes X1 with the diff; the commit carries the subject, the body and `Interactive-Phase: phase-03`, with no `.phax-context/` path; phase-04 starts in the same invocation, and its prompt carries `## Review corrections`, while phax-plan.json and plan.md stay byte-identical. A person's handoff file is used byte for byte with no turn. With no change, an empty commit lands and the exit is never 9. With no session, or X0 missing, a fresh session starts. A red gate exits 4 and commits nothing, then closes once fixed. An invalid person's file exits 1. A closing answer invalid twice exits 5 after one corrective resume. A closing turn that writes a file exits 5 and leaves it in place. A usage limit exits 8. In every refused case the run stays awaiting_review, and the reconciliation lists the review corrections with no unplanned edit. Run, resume and lint print the same `interactive` error for a plan whose last phase is interactive.

### Implementation order

1. interactiveCheck placement and planned-work rules, with lint and preflight
2. closeDeclaredStop with its refusals and commit
3. executePlan wiring for stop and close, and the skipped record
4. review corrections in later prompts
5. stop output and exit mapping in run and resume
6. integration tests and updated refusal tests

### Excluded scope

- The hold, held stops, review commits and the oracle-pair changes (plan 2)
- Transcript capture, records, posture records, compliance presentation, review-handoff and PR-body stop lines, and estimates (plan 3)
- Removing the oracles check's finding against an interactive phase inside a pair (plan 2)

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

Give the `closeDeclaredStop` signature, its tagged errors with their exit codes, and where executePlan calls the stop and the close. Give the exact `interactive` messages and the new `interactiveFindings` input. Say how review corrections reach a later prompt and which phase `## Previous phase handoff` reads after an interactive phase. Confirm that no record is written for an interactive phase, and explain any deviation from the planned file lists.

### Commit subject

`feat(interactive): run and close a declared interactive phase`

### Commit body

A plan may now declare an interactive phase. The run stops there after a
read-only first turn with exit 13; phax resume gates the worktree first,
takes the person's handoff or a read-only closing turn's, commits the
corrections with an Interactive-Phase trailer (an empty commit when nothing
changed) and continues. Later phases read them under Review corrections.
Lint and the run preflight now place interactive phases instead of refusing
them.

---

## phase-07 — Docs and the planning skill for the declared stop {#phase-07-docs-and-skill}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

Tell planners, operators and review-UI authors how a declared interactive stop works. The README gains an Interactive phases section, the phax-planning skill gains an interactive-phase section and loses the not-yet-supported wording, the CLI help describes the new behaviour, and NEXT_STEPS records plan 1 of 3 as in flight.

### Detailed instructions

- README.md: add `### Interactive phases` under `## Run a plan`, after `### When a run stops`, for the declared stop only. Cover: when a plan declares one, with the `**Mode:** interactive` line; what the run does at it (worktree, seed, read-only first turn, exit 13, `awaiting_review`); the continue or fresh-start command; `phax enter-phase` and `--new-session`; `phax ls --awaiting-review`; closing with `phax resume` from the main checkout (gate first, a red gate returns the phase, the person's `.phax-context/correction-handoff.md` or a read-only closing turn, the commit with `Interactive-Phase:`, an empty commit when nothing changed); later phases reading `## Review corrections`; `phax reset-phase` at a stop; and `review-stop.json` for a UI. Use the made-up invoice-export example. Say that the hold, transcripts and records of a stop are not part of this release. Update `### When a run stops` to mention exit 13.
- `.claude/skills/phax-planning/SKILL.md`: add an `## Interactive phases` section after `## Oracle phases`. It gives the `**Mode:** interactive` line and where it sits (after the model, effort and Assignment reason lines). The rule: declare one directly after the first phase that sets a pattern at least one later phase repeats, and never by default. The operator will be able to hold any other phase with `phax run --hold` once plan 2 ships. An interactive phase plans no file to create or edit, and its optional files name what the person may touch; its Detailed instructions name what to review, the pattern at stake and the later phases that repeat it. It is never the first or last phase and never directly follows another interactive phase. It is held to the assignment bounds through its optional files. It may not sit inside an oracle pair in this release, and it never takes an oracle role.
- In the same skill, replace every statement that an interactive phase is refused or that a plan writes no Mode line, including the `mode` table row, the Lint section, the headless-authoring `mode` bullet and the `mode`/`oracle` paragraph. Say that headless authoring writes `mode: "interactive"` only for a phase meant for review, and `mode: "headless"` everywhere else.
- `src/cli/cliDocs.ts`: update the long help of `run` and `resume` (stopping at and closing an interactive phase, exit 13), `enter-phase` (`--new-session`, continue command), `ls` (`--awaiting-review`), `session-info`, `reset-phase` and `archive` (a run awaiting review). Regenerate `phax.usage.kdl` with `pnpm gen:usage-spec` and the CLI docs with `pnpm docs:cli`.
- NEXT_STEPS.md: move `interactive-phases` from Approved, not yet planned to In flight. Record plan 1 of 3 (the declared stop) as landing with this run, plan 2 (the hold and the oracle-pair rules) and plan 3 (the run list, transcripts and records around a stop) as next, and the interim gaps: no record for a declared phase, and no review inside an oracle pair until plan 2.
- This phase writes a `.claude/skills/` file, so the run needs `phax run --allow-skill-edits`.

### Planned files to create

- (none)

### Planned files to edit

- `README.md`
- `.claude/skills/phax-planning/SKILL.md`
- `src/cli/cliDocs.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `NEXT_STEPS.md`

### Optional files that may be edited

- `docs/cli/inventory.md`
- `docs/security.md`
- `tests/unit/skills.test.ts`
- `tests/unit/authoringPrompt.test.ts`

### Test strategy

No new behaviour. The usage-spec drift, CLI-docs drift, README exit-code and skills tests check that the generated files and docs match the CLI. Read the README section against the behaviour that `tests/integration/declaredStopRun.test.ts` and `tests/integration/declaredStopClose.test.ts` cover, and change no test expectation to fit the prose.

### Implementation order

1. cliDocs long help and regeneration
2. README section
3. phax-planning skill section and stale-wording sweep
4. NEXT_STEPS

### Excluded scope

- docs/upgrading.md for `phax ls --json` (plan 3)
- Documenting `--hold`, held stops or the run list as available (plans 2 and 3)
- Any code change

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

List the README and skill sections added or changed, and every stale not-yet-supported statement removed, with its location. Confirm that the usage spec and CLI docs were regenerated, and explain any deviation from the planned file lists.

### Commit subject

`docs(interactive): document declared interactive phases`

### Commit body

The README explains a declared interactive stop from the plan line to
phax resume, the phax-planning skill says when and how to declare one and
no longer calls it refused, the CLI help covers exit 13, enter-phase
--new-session and ls --awaiting-review, and NEXT_STEPS records plan 1 of 3
as in flight.
