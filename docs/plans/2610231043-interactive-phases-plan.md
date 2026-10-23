---
status: Draft
source-spec: docs/specs/2610211403-interactive-phases.md
completes-spec: false
---
# Held stop and oracle-pair reviews

Plan 2 of 3 for the interactive-phases spec (`docs/specs/2610211403-interactive-phases.md`). It replaces the abandoned first draft (`docs/plans/archive/2610230951-interactive-phases-plan.md`). It keeps that draft's phase split, its persisted-shape analysis and its sound arbitrations, and fixes the ten defects its review found.

After this plan, the operator can hold a run with `phax run --hold`, `--hold phase-02,phase-04` or `--hold oracle`:

- A selected headless phase does its work, passes its gate, commits and validates its handoff, then stops in `awaiting_review` with cause `held`. The stop comes before the phase's record and its cleanup. No agent turn runs, and the run exits 13.
- The person reviews the phase by hand, with any agent, or by continuing the builder session (`phax enter-phase`). `--new-session` starts a fresh read-only look.
- `phax resume` gates the worktree first and returns a red gate to the person. It then takes the person's `.phax-context/correction-handoff.md`, or a read-only closing turn that resumes the builder session. It leaves one review commit with a `Held-Phase:` trailer on top of the unchanged phase commit, or no commit when nothing changed.
- It then writes the phase's record once (the agent's work, naming the phase commit), runs the cleanup, and starts the next phase from the branch tip in the same invocation.
- Every later phase reads the corrections under `## Review corrections`.

A review may now sit inside an oracle pair:

- A stop before the discharge whose corrections change an oracle file re-runs the `authored` verdict as the last step of its closing gate.
- The discharge judges the latest commit of the pair that passed `authored`.
- A held discharge closes on its configured steps only, and warns about each oracle file its corrections changed.

Plan 1 (PR #157, `docs/plans/archive/2610220954-interactive-phases-plan.md`) landed the declared stop. This plan extends its code to the held cause: one close, one seed writer and one stop document, never a second copy beside them. Plan 3 adds:

- the versioned `phax ls --json` run list;
- transcript capture;
- the records' review fields;
- the security record, the compliance review, the review handoff and the PR body around a stop;
- the estimate of an interactive phase.

The order runs from the core to the surface:

- phase-01: the hold's grammar and resolution, the `hold` preflight step and the recorded hold;
- phase-02: the held cause in the state machine and in the stop's formats;
- phase-03: reaching a held stop, its failure pause and its re-entry;
- phase-04: the commands on a held run;
- phase-05: closing a held stop, as a use case;
- phase-06: the run loop, the record at closing, later prompts and `phax run --hold`;
- phase-07: reviews inside an oracle pair;
- phase-08: the docs and the planning skill.

`--hold` stays unregistered until phase-06, so no earlier commit lets an operator start a hold that phax cannot close. Until phase-07, the `hold` check refuses every phase of an oracle pair, and the `oracles` check still refuses a declared phase inside a pair, so no review touches an oracle without the `authored` re-run.

phase-08 edits `.claude/skills/phax-planning/SKILL.md`, so run this plan with `phax run --allow-skill-edits`.

Test rules for every phase:

- Fixtures are made up: the invoice-export, credit-notes and payments-fix runs, Ada Example, `./fake-oracles` and the session ids X0, X1, X2 and C2.
- Fake provider CLIs run from a temporary bin directory, and keep their session stores under a test HOME (`tests/helpers/fakeProviderCli.ts`).
- Tests never read `~/.phax`, either through HOME or through a loader. They mock `loadProviderConfig` and its siblings, as the stopped-run suites do.
- Tests assert `$schema` URLs by format id and release pattern.
- A test that starts the phax CLI as a process gives it its own temporary repository as its working directory.

No agent prompt this plan writes mentions how to stop a run.

## Required commands

- `pnpm exec tsx`
- `pnpm gen:usage-spec`
- `pnpm docs:cli`

`security.agentCommands` in `phax.json` already allows each command above, so no configuration change is needed. They are declared so the preflight confirms it: `pnpm exec tsx` regenerates the schema snapshots (`pnpm exec tsx scripts/schemas-check.ts --write`), `pnpm gen:usage-spec` regenerates `phax.usage.kdl`, and `pnpm docs:cli` regenerates `docs/cli/`.

## Technical arbitrations

- Persisted shapes change in place. `package.json` opens 0.26.0, every format concerned still has a `next.schema.json` snapshot, and `packages/schemas/history.lock.json` freezes nothing at 0.26.0, so the release is uncut. So no new frozen decoder is written. `pnpm exec tsx scripts/schemas-check.ts --write` rewrites each `next.schema.json` of run-status, phase-status, review-stop and interactive-session. The 0.17.0 and pre-schema run-status lifts gain `hold: { selection: none }`, both in `src/schemas/persisted.ts` and in `toLatestRunStatus` (`packages/schemas/src/formats/runDirectory.ts`, which splits on whether `hold` is in the value), because no earlier phax could hold a run. A run-status stamped 0.26.0 without `hold`, which only an unreleased development build wrote, is refused, never decoded as optional. Loss accepted: a run started by a development build of 0.26.0 before this plan does not resume.
- Explicit per-variant shapes. (1) run-status `hold` has four structs, one per `selection`: `none` with no other key, and `all`, `listed` and `oracle`, each with a non-empty `phases` in plan order. (2) A phase status's `stop` has six variants, with `null` kept for a phase that never stopped: declared waiting; declared closed `corrected` with `oracleStep`; declared closed `unchanged`; held waiting; held closed `corrected` with `reviewCommit` (a full sha) and `oracleStep`; and held closed `unchanged`. `oracleStep` is exactly `authored | none`: whether the close's gate ended with an `authored` oracle step, which passed, since the close committed. It is the required field from which the discharge reads the pair's latest authored commit without git. phase-07 writes `authored`; until then every close writes `none`. (3) review-stop is a union of two structs. The declared one has `phase.mode: interactive`, `firstReading` and session origin `first-turn | new-session`. The held one has `phase.mode: headless`, `phaseCommit` (a full sha), session origin `builder | new-session`, and no `firstReading`. (4) interactive-session's session and `turnInProgress` origins gain `builder`. A first turn's own origin stays `first-turn | new-session`, because no first turn is the builder.
- The hold grammar. `phax run` registers `--hold [selection]`, so commander gives `true` for a bare `--hold` and a string otherwise. `parseHoldValue` in `src/domain/hold.ts` reads it before the config or the plan is read. `true` means every headless phase but the final one, and exactly `oracle` is the one keyword. Any other value must be a comma-separated list of distinct phase ids, each matching `^phase-\d{2}$` exactly, so `phase-2` and `phase-100` are refused alike. The list has no empty item and never mixes in `oracle`. Any other value exits 1 before the run is named, naming the value and the three accepted forms. When the value is one word that is neither `oracle` nor a phase id, a second line adds `(put the run's name before --hold, or write --hold=<selection>)`. `phax resume` registers no `--hold`, so commander refuses it as an unknown option with exit 1. No configuration layer carries a hold: the existing unknown-key refusal already exits 2, and a test proves it rather than code adding a refusal.
- Where the `hold` check sits. It is not in RUN_PREFLIGHT_CHECKS, because `phax resume` re-runs that set, and the recorded hold was resolved when the run was named. It is a step of `freshRunPreflight` (`src/app/runPreflight.ts`): after the shared set, so after `interactive-phases`, and before the clean-tree check. `FreshRunPreflightStep` gains `hold`. `phax plans lint` never runs it, because a hold belongs to a run, not to a plan. It fails with `HoldPreflightError` (exit 11), printing `Hold preflight failed: N error(s).` and every error with its phase, or `-` for a selection-wide error. Wording follows the spec's §6 examples.
- Where the hold is read at run time. `createRunFolder` gains a trailing `hold` parameter, which defaults in memory to `{ selection: none }`; the field is always written. `executePlan` reads the run's `hold` from `run-status.json` once, at its start. So `phax run` and every `phax resume` hold exactly the recorded phases, and no caller can pass another. `phax run --dry-run` resolves the hold and prints one line: `Hold: none`, or `Hold: listed — phase-02, phase-04`. When the check finds errors, it prints them under that line. The dry run still exits 0 and names no run.
- Where a held phase stops: the hold point. Its gate passes and gate-attribution.json is written, then it commits and reconciles, its handoff is validated and copied, and its pulled briefs are closed. The hold point comes after all of that, and before `writeRecordForPhase`, the agent binding's `completed` patch and the cleanup commands. A phase stops there only when it is in the recorded hold, is not the final phase (the preflight already excludes it), and its status `stop` is still null. No agent turn runs. The builder session is read from the phase's `agent-binding.json` (provider, model, effort, and the session id its headless stream reported). It is recorded as current with origin `builder` and the phase status's `createdAt` as `startedAt`, or as no session when the binding holds no id. The held seed embeds the phase's `file-reconciliation.md`, so the person sees which files were planned and which deviated without opening the run folder. It points to `.phax-context/plan.md` for the full plan, as the declared seed does.
- Reducer events. `ReviewStopReached` carries a review-stop whose `cause` must equal the event's. A declared stop is accepted from running/{running}. A held stop is accepted from running/{committed} and also from running/{handoff_failed}, because no event moves a phase out of `handoff_failed` after a resumed handoff succeeds. `StopCommitted` keeps closing declared stops, with `closure: { outcome: corrected, oracleStep } | { outcome: unchanged }`. The new `HeldStopClosed { phaseId, phaseCommit, closure }` moves running/{awaiting_review, held} to running/{committed, hash: phaseCommit}. Its effects are PersistState and DiscardReviewStop, and no RecordCommitMetadata, so `commitHash` stays the phase commit. The new `HoldPointFailed { phaseId, phaseCommit, worktreePath, reason }` moves running/{committed or handoff_failed} to interrupted/{committed, hash: phaseCommit}, with resume instructions. Every other event keeps plan 1's verdict on awaiting_review for both causes.
- Nothing after a commit or a close fails the run (review finding 3). (1) Any failure of the hold point before `ReviewStopReached` dispatches `HoldPointFailed`, then fails with `HoldPointPausedError`, a resumable pause in `isResumablePauseError`. So the top-level `tapError` neither writes a `failed` record for the committed phase nor dispatches RunFailed. (2) Before `RunResumeRequested`, a held stop's re-entry reads everything its record needs: `agent-binding.json` and the status `commitHash`. It reads none of it after `HeldStopClosed`. (3) The record written after a close uses `failOnRefusal: false`, so a refused destination prints a warning naming its remedy and never fails the run. I/O failures already degrade to a warning. (4) The discharge pre-check (`oracleCommitOf`) is skipped on a stop re-entry and on a closed-stop re-entry, because that phase's gate already ran. Loss accepted: a held phase whose records destination refuses at closing has no record, as on the failed-phase path.
- Interrupts never drop a hold or a record (decided by the operator, 2026-10-23). On resume, a non-final phase of the run's hold whose status `stop` is null re-enters the hold point and stops, with no agent turn, gate or commit, instead of reading as done. That phase is either `committed`, or `handoff_failed` with a `phase-handoff.md` in its run folder that passes the headless handoff check. `findNextResumablePhase` (`src/app/resume.ts`) treats it as resumable. A non-final `committed` phase whose `stop` is closed, of either cause, is resumable too: a close was interrupted between its state event and the cleanup. Its re-entry writes the record it owes, at a held stop only, and only once: it first lists the run's records (`listRecords` with the run id) and writes none when a phase record of that phase id exists. It then runs the cleanup and continues. A declared stop owes no record in this plan.
- One close, two causes. `closeDeclaredStop` in `src/app/closeStop.ts` becomes `closeStop`: one sequence that reads the cause from the parked review-stop document. A held close differs in seven ways. (1) Base: at the first close, HEAD must be the phase commit (status.json `commitHash`), not the phase base. Otherwise the close is refused as `close-error` (`commit`), naming `git -C <worktree> reset --soft <phase commit>`. (2) Gate files go to `<phase folder>/review-gate/`: the attempt log, its siblings and `gate-attribution.json`. So the agent's attempt files and attribution are never touched. (3) The handoff is written to `correction-handoff.md`; `phase-handoff.md` is never written. (4) The diff is saved as `review-diff.patch`; `diff.patch` is never written. (5) A corrected close commits the gated tree with `commitTree` and the plan's subject, with trailers `Run-Id`, `Short-Name`, `Phase-Title`, `Held-Phase`, `Worktree` and `Gate-Log`, and no `Phase-Id`. An unchanged close makes no commit. (6) The reconciliation is written to `correction-reconciliation.json` and `.md`, with every changed path under `reviewCorrections`, against the phase commit; `file-reconciliation.*` stays byte-identical. (7) A close interrupted after its commit is finished when HEAD's parent is `closeBase` and HEAD carries this run's `Run-Id` and `Held-Phase: <phase>`. The closing turn gets the corrections as the diff from HEAD's tree (the phase commit) to the gated tree, cut at plan 1's limit. Every failure returns the run to the stop through `StopCloseRefused`.
- `CloseReport` is a union by cause and outcome, never a nullable commit: `{ cause: declared, outcome, commit }`, `{ cause: held, outcome: corrected, phaseCommit, reviewCommit }` and `{ cause: held, outcome: unchanged, phaseCommit }`. Every variant also carries `handoffSource`, `gateLog`, `gateSteps`, `changedPaths`, `restoredClosingTurn` and `oracleStep`, and the held corrected one carries `unjudgedOracleFiles` from phase-07. Its readers switch on it exhaustively: `ClosedStop` in `src/app/executePlan.ts`, `renderStopClosed` in `src/cli/commands/stopOutput.ts` (which today slices `commit`), and `src/cli/commands/resume.ts`.
- q-held-closing-posture: the closing turn resumes the builder read-only on every provider (decided by the operator, 2026-10-23, against the recommendation of a new read-only codex session). Claude Code resumes it with its reading tools and no shell (q-turn-shell). codex resumes it with `exec resume`, `sandbox_mode=read-only` and `approval_policy=never`. mistral-vibe keeps the phase posture (q-vibe-turns). The worktree comparison and the handoff-file check run after every turn. Loss accepted: codex merges a rollout's persisted permissions on resume, so a builder that ran `workspace-write` may keep it over the `-c` override. The closing turn could then write outside the worktree, where no comparison looks. A test pins the codex resume argv, and the README says that on codex the read-only override is the provider's to honour. A build-posture resume is not an option: it breaks q-turn-shell.
- A held phase's record (§5.69, q-held-record `at-close`) is the record the phase would have written at its commit, written once at closing. Its `sourceSha` is the phase commit (status.json `commitHash`, never HEAD). It names the builder's provider, model, effort and session from `agent-binding.json`, with outcome `committed`. Its artifacts are the phase folder minus the stop's files, by a pure `isStopArtifact` filter in `src/domain/records/stopArtifacts.ts`. No record is written while the phase is held. The review commit carries no `Phase-Id` trailer, so `phax records explain` on it finds no record until plan 3 adds the review fields. So no record claims the agent wrote the review. On mistral-vibe, the record's usage comes from the session's `meta.json`, keyed by session id. A closing turn that resumed the builder session is therefore counted in that usage. Loss accepted until plan 3 separates them: on vibe, a held phase's record overstates the agent's usage by the closing turn. Claude Code and codex read `output.jsonl`, which a closing turn never writes.
- Later prompts and the global reconciliation select stops by their status `stop`, never by `mode` (review finding 7). `## Review corrections` holds every earlier closed stop in plan order, headed `### <phase> (held)` or `### <phase> (interactive)`. A held stop contributes `correction-handoff.md` and the `reviewCorrections` of `correction-reconciliation.json`; a declared stop contributes `phase-handoff.md` and those of `file-reconciliation.json`. A missing file is an error. After a held phase, `## Previous phase handoff` is the held phase's own builder handoff (q-held-handoff `correction-beside`), so the correction reaches the next phase only through `## Review corrections`. The global reconciliation merges a held, closed, corrected phase's `correction-reconciliation.json` into that phase's entry, so its files read as review corrections and never as unplanned. A missing or undecodable correction reconciliation counts as a missing reconciliation, which is an error unless the caller allows partial results.
- Commands at a held stop. `phax ls`, `phax session-info`, `phax path`, `phax shell` and `phax open` work from review-stop.json as at a declared stop; `session-info` names the phase `headless, committed <short sha>`. `phax enter-phase` continues the builder session (q-held-session `builder-default`). `--new-session` runs a read-only first turn whose session becomes current, and refreshes review-stop.json by patching only `session` and `commands.continue`, so the held variant and its `phaseCommit` survive. The `phax reset-phase` preview at a held stop names the phase commit it discards; deleting the phase branch already removes that commit. archive and adjust-plan keep plan 1's refusals.
- Interim refusals keep main honest between phases. Until phase-03, executePlan reads the hold and never stops. From phase-03 until phase-06 wires the close, a resume whose start phase is a headless phase in `awaiting_review` fails before `RunResumeRequested` with `HeldCloseUnavailableError`, which is excluded from RunFailed, and changes nothing. Until phase-07, the `hold` check refuses every phase from an oracle phase through its discharging phase, and the `oracles` check still refuses a declared phase inside a pair. Loss accepted: between phase-06 and phase-07, a bare `--hold` on a plan with an oracle pair is refused rather than holding the other phases.
- The oracle step at a close (phase-07). A stop sits in a pair when its index lies from the pair's oracle phase up to, but not including, the discharging phase. A held discharging phase is never judged again for the pair it discharges (q-held-discharge `no-oracle-step`). Before the gate, the close compares a snapshot of the worktree with HEAD's tree. If the corrections change the oracle files of exactly one pair the stop sits in, it runs the `authored` step as the gate's last step, after every configured step has passed. The request is `{ verdict: authored, phase: <stopped phase>, oraclePhase, base: <the oracle phase's base from its status>, files }`, and the oracle-request format does not change. A gate step that writes an oracle file the pre-gate snapshot did not change is refused as `close-error` (`gate`), naming the file. Corrections that touch two pairs' oracle files are refused the same way, because one gate attempt carries one oracle request. Loss accepted: a person who corrects the oracles of two overlapping pairs at one stop must undo one correction or reset the stop. `phax resume --skip-oracle` on a run awaiting review exits 1, because a close's `authored` step is never skipped. Loss accepted: when the oracles provider is broken, the person undoes the oracle-file correction or resets the stop.
- The pair's latest authored commit is read from status.json facts only. It is the last phase in plan order, from the oracle phase up to the discharge, whose closed stop has `oracleStep: authored`: its `reviewCommit` when held, its `commitHash` when declared. Without one, it is the oracle phase's `commitHash`. A phase whose closed stop ran `authored` is not reset once its pair's discharge has started, like the oracle phase itself. A close finished from a commit that already landed (`finishLandedCommit`) recovers its oracle step from its own attempt files (review finding 2), because git alone cannot tell. The step was `authored` exactly when the landed commit's `Gate-Log` attempt has a sibling oracle request (`oracleRequestPathFor`) that decodes as an `authored` request naming the stopped phase, and the close's gate attribution records the oracle step as passed.
- q-discharge-oracle-edit: flagged (decided by the operator, 2026-10-23). A held discharge's close goes on under the configured gate alone. It prints one warning per oracle file its corrections changed, saying the discharge was judged before the stop and that the oracles provider does not see the change. It records those files in the close's trace and refuses nothing. The trace needs a new semantic event, because `tracedStep` records only a name and a result (review finding 8). `oracle.edits.unjudged { runId, operationId, files }` joins the telemetry events, their schema, the semantic-trace projection and the OpenTelemetry layer. `traceUnjudgedOracleEdits` in `src/app/telemetry/stopTelemetry.ts` emits it. No persisted field is written.
- Telemetry. The held stop and its close reuse `src/app/telemetry/stopTelemetry.ts`: `tracedCloseGate` (which covers the closing oracle step), `tracedReviewCommit`, `tracedTurnCall` and `tracedStep`. The reducer's `review.stop.reached` trace carries `cause: held`. `tests/e2e/semanticTrace.heldStop.test.ts` pins a held stop's trace next to the declared one. Like every e2e suite, it runs only with `PHAX_E2E_RUN=1`, so the standard gate skips it.
- No phase of this plan is an oracle phase, although an `oracles` provider is configured. The code under test is the run loop, the close and the oracle runtime itself, which phase-07 changes. Oracles frozen before that code exists would pin its internal design rather than a surface the spec shows. Every test is in-phase.
- Exit codes: a malformed `--hold` exits 1; `HoldPreflightError` exits 11; `phax resume --hold` exits 1 (commander); `HoldPointPausedError` exits 1, like the cleanup and completion pauses; a refused held close keeps plan 1's `lastClose` exit codes. EXIT_CODE_MEANINGS row 13 becomes `Awaiting review at an interactive or held phase (resumable)` in phase-06, when holds become reachable. Output wording follows the spec's §6 indicative examples for the hold refusals, the held stop, the held close and the reset preview.

---

## phase-01 — The hold's grammar and resolution, the hold preflight step and the recorded hold {#phase-01-hold-grammar}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

Define what an operator may ask with `--hold`, and resolve it against a plan. Refuse a hold the plan cannot honour (exit 11) before a run is named. Record the resolved hold in a required `hold` field of every run's `run-status.json`. `--hold` itself stays unregistered, so every run still records `{ selection: none }`.

### Detailed instructions

- Create `src/domain/hold.ts`, pure and with no I/O. Export `HoldRequest`, `parseHoldValue`, `HoldFinding` and `resolveHold`. `HoldRequest` is `{ kind: 'none' } | { kind: 'all' } | { kind: 'oracle' } | { kind: 'listed'; phases: readonly [string, ...string[]] }`.
- `parseHoldValue(value: true | string): Either<string, HoldRequest>`. `true` gives `all`, and exactly `oracle` gives `oracle`. Otherwise split on `,`: each item must match `^phase-\d{2}$` exactly, no item may be empty, items must be distinct, and `oracle` may not appear in a list. So `phase-2`, `phase-100`, `oracle,phase-02`, `phase-02,,phase-04`, `phase-02,phase-02` and the empty string are refused. The message for a mix with `oracle` is `--hold 'oracle,phase-02' is not a hold selection: oracle stands alone`. Every other refusal reads `--hold '<value>' is not a hold selection: give no value, oracle, or phase ids such as phase-02,phase-04`. When the value is one word that is neither `oracle` nor a phase id, add the line `(put the run's name before --hold, or write --hold=<selection>)`.
- `HoldFinding = { phase: string | null; message: string }`. `resolveHold(request, phases)`, where `phases` are `{ id, mode, oracle }` in plan order, returns `{ hold: RunHold | null; findings: readonly HoldFinding[] }`, with `hold` null whenever there is a finding. `none` gives `{ selection: 'none' }`. `all` gives every `headless` phase except the final phase; when there is none, it reports `(null, '--hold selects no phase: the plan has no headless phase before its final phase')`. `oracle` gives every phase whose `oracle` is not null; when there is none, it reports `(null, '--hold oracle selects no phase: the plan declares no oracle phase')`. `listed` checks each id in the order given. An id absent from the plan reports `is not a phase of this plan`, an interactive one `is interactive: it already stops for review; remove it from --hold`, and the final one `is the final phase: it already stays open in review_open`. The resolved phases are sorted into plan order.
- Add an interim rule to `resolveHold`, with a comment `INTERIM(oracle-pair-hold): removed when reviews inside an oracle pair land`. Every resolved phase whose index lies from a pair's oracle phase through its discharging phase (`oraclePairs` in `src/domain/plan/oraclePairs.ts`) gets the finding `sits in oracle pair <oracle> → <discharging>: this phax does not hold a phase of an oracle pair yet`.
- In `src/schemas/status.ts`, add `RunHoldSchema`, a union of four structs: `{ selection: Literal('none') }`, and `all`, `listed` and `oracle`, each with `phases: NonEmptyArray` of strings matching `^phase-\d{2}$`. Export `RunHold`. Add the required `hold: RunHoldSchema` to `runStatusFields` after `allowSkillEdits`, described as resolved when the run is named and never changed.
- In `src/schemas/persisted.ts`, the `run-status.json` reader lifts a document read through the frozen 0.17.0 decoder or the pre-schema decoder with `hold: { selection: 'none' }`, as the phase-status reader lifts `mode` and `stop`. A document at the current stamp without `hold` stays refused. In `packages/schemas/src/formats/runDirectory.ts`, `toLatestRunStatus` adds the same `hold` to a pre-schema or 0.17.0 value, with a comment saying why: no earlier phax could hold a run.
- Run `pnpm exec tsx scripts/schemas-check.ts --write`, which rewrites `packages/schemas/snapshots/run-status/next.schema.json` in place. Create no frozen module and leave `packages/schemas/history.lock.json` unchanged, because 0.26.0 is uncut. Update the run-status fixture in `tests/unit/schemasPackage/documents.ts`.
- In `src/app/runFolder.ts`, give `createRunFolder` a trailing parameter `hold: RunHold = { selection: 'none' }`, and always write it into the run status.
- In `src/app/runPreflight.ts`, `FreshRunPreflightStep` becomes `'routing-config' | RunPreflightCheck | 'hold' | 'clean-tree'`, and `FreshRunPreflightInput` gains a required `hold: HoldRequest`. After `runPreflights` and before `checkCleanWorkingTree`, run `resolveHold(input.hold, input.plan.phases)`. On findings, fail with `HoldPreflightError`, whose message is `Hold preflight failed: N error(s).` followed by one line per finding, `  <phase or ->  <message>`. On success the result gains `hold: RunHold`. Leave RUN_PREFLIGHT_CHECKS and `runPreflights` unchanged, so `phax resume` never re-runs the hold.
- Add `HoldPreflightError { message, findings }` to `src/domain/errors.ts`, and map it to exit 11 in `exitCodeForError` in `src/cli/commands/runLayers.ts`.
- In `src/cli/commands/run.ts`, pass `hold: { kind: 'none' }` to `freshRunPreflight`, and pass the resolved hold it returns to `createRunFolder`. Do not register `--hold` in `src/cli/program.ts`.
- Create `tests/helpers/runStatusFixture.ts`. It exports `runStatus(fields)`, the in-memory value with `hold: { selection: 'none' }` unless given, and `runStatusFile(fields)`, the same value stamped with `currentSchemaUrl('run-status')`. Use it in every test that writes a current-stamp run status or builds a `RunStatus` literal: `pnpm test:type` names the literals, and failing decodes name the JSON fixtures.
- Create `tests/integration/holdConfigRefused.test.ts`. In a temporary repository whose `phax.json` holds `review: { holdPhases: true }`, `runValidate` exits 2, naming the unknown key. With `node:os`'s `homedir` mocked to a temporary directory whose `.phax/config.json` holds a top-level `hold`, it also exits 2. Change no schema to make these pass; if either is accepted, stop and report it in the handoff.

### Planned files to create

- `src/domain/hold.ts`
- `tests/unit/hold.test.ts`
- `tests/helpers/runStatusFixture.ts`
- `tests/integration/holdPreflight.test.ts`
- `tests/integration/holdConfigRefused.test.ts`

### Planned files to edit

- `src/schemas/status.ts`
- `src/schemas/persisted.ts`
- `packages/schemas/src/formats/runDirectory.ts`
- `packages/schemas/snapshots/run-status/next.schema.json`
- `src/app/runFolder.ts`
- `src/app/runPreflight.ts`
- `src/domain/errors.ts`
- `src/cli/commands/runLayers.ts`
- `src/cli/commands/run.ts`
- `tests/unit/schemasPackage/documents.ts`
- `tests/integration/runPreflightBeforeNaming.test.ts`
- `tests/integration/runFolder.test.ts`
- `tests/unit/persisted.test.ts`

### Optional files that may be edited

- `packages/schemas/src/generated/index.ts`
- `src/schemas/release.ts`
- `src/app/dispatcher.ts`
- `src/app/phaxState.ts`
- `src/app/resume.ts`
- `src/app/resetPhase.ts`
- `src/cli/interruptHandler.ts`
- `src/cli/commands/sessionInfo.ts`
- `tests/helpers/stoppedRunFixture.ts`
- `tests/unit/interruptDuringClose.test.ts`
- `tests/unit/resolveRunInfo.test.ts`
- `tests/integration/archive.test.ts`
- `tests/unit/resume.test.ts`
- `tests/integration/declaredStop.test.ts`
- `tests/integration/resetPhase.test.ts`
- `tests/integration/recordsPush.test.ts`
- `tests/integration/dispatcher.test.ts`
- `tests/unit/awaitingReviewShapes.test.ts`
- `tests/integration/publishRun.test.ts`
- `tests/integration/legacyRunFiles.test.ts`
- `tests/unit/cli/resume.test.ts`
- `tests/unit/schemas.test.ts`
- `tests/unit/runPreflight.test.ts`
- `tests/unit/schemasPackage/runDirectoryFormats.test.ts`
- `tests/unit/schemasPackage/currentShapes.test.ts`
- `tests/unit/schemasPackage/parse.test.ts`
- `tests/integration/persistedProducer.test.ts`
- `tests/integration/registry.test.ts`
- `tests/integration/resumePreflightRechecks.test.ts`

### Boundary contracts

CLI → domain: the run command will hand `parseHoldValue` the raw option value and get back a `HoldRequest` or a message; the grammar knows nothing of plans. Preflight → domain: `freshRunPreflight` hands `resolveHold` the plan's phases and gets the resolved `RunHold` or findings, before any run state exists. Run folder → readers: `run-status.json` always carries `hold`. Every phax reader goes through `src/schemas/persisted.ts`, which lifts older stamps with `none`, and `@lbdremy/phax-schemas` gives the same verdict.

### Test strategy

- `parseHoldValue` accepts `true`, `oracle` and `phase-02,phase-04`, and refuses `phase-2`, `phase-100`, `oracle,phase-02`, `phase-02,,phase-04`, `phase-02,phase-02`, `invoice-export` (with the run-name hint) and the empty string, each naming the three forms — small · table · the expected request or message per value · in-phase · §8 A malformed hold value is refused
- none, all, listed and oracle resolve on the made-up six-phase invoice-export plan (phase-03 interactive) and its four-phase oracle variant to the phases §8 lists, in plan order — small · table · the resolved phases per request · in-phase · §8 The hold is resolved and recorded when the run is named
- phase-09 absent, phase-03 interactive, phase-06 final, `oracle` with no oracle phase, a bare hold on a one-phase plan, and the interim pair rule each give one finding naming its phase or `-` — small · table · the expected findings · in-phase · §8 The hold preflight refuses a selection the plan cannot honour
- each hold refusal fails `freshRunPreflight`, maps to exit 11, prints every error, and creates no run folder, registry entry or branch in a temporary repository — medium · example · exit code, output and the unchanged repository · in-phase · §8 The hold preflight refuses a selection the plan cannot honour
- a new run's run-status.json carries `{ selection: none }`, or a given listed hold verbatim — medium · example · the decoded run-status.json · in-phase
- a 0.17.0 or pre-schema run-status reads lifted with `none` in phax and in `@lbdremy/phax-schemas`, and a current-stamp document without `hold` is refused — small · example · the lifted value and the typed refusal · in-phase
- a hold key in phax.json or in a mocked home's `.phax/config.json` makes `phax validate` exit 2 naming the key — medium · example · exit code and message · in-phase · §8 The hold is fixed for the run and comes only from the flag

### Implementation order

1. `src/domain/hold.ts` and its unit tests
2. `RunHoldSchema`, the persisted lift and the package lift
3. the snapshot regeneration and the package fixture
4. `createRunFolder`'s hold
5. the `hold` step of `freshRunPreflight`, its error and exit code, and run.ts passing `none`
6. the run-status fixture helper and the broken fixtures
7. the configuration-refusal test

### Excluded scope

- Registering `--hold` on `phax run`, and the dry-run line (phase-06)
- Stopping at a held phase (phase-03)
- Lifting the interim oracle-pair rule (phase-07)
- Any change to `phax plans lint`, which never runs the hold check

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

Give the exact exports of `src/domain/hold.ts` (`HoldRequest`, `parseHoldValue`, `HoldFinding`, `resolveHold`) with their messages, and the marker of the interim oracle-pair rule. Give `RunHoldSchema` and `RunHold` as written in `src/schemas/status.ts`, the two lifts that add `none`, `createRunFolder`'s new parameter, the `hold` step's place in `freshRunPreflight`, its result field, and `HoldPreflightError` with its exit code. Say how `tests/helpers/runStatusFixture.ts` is used. Confirm that both configuration layers refuse a hold key with exit 2, and that no schema changed for it. Explain any deviation from the planned file lists, including each optional test that needed a change.

### Commit subject

`feat(hold): resolve and record a run's hold before it is named`

### Commit body

A --hold value is parsed by a pure grammar: no value, oracle, or distinct
phase-NN ids. It is resolved against the plan in plan order. A new hold
step of the fresh-run preflight refuses, with exit 11 before the run is
named, a listed phase that is absent, interactive or final, or a selection
that holds no phase. run-status.json records a required hold, lifted to
none for runs written before it. The option itself is not registered yet,
so every run still records none.

---

## phase-02 — The held cause in the state machine and in the stop's formats {#phase-02-held-cause-state}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** The reducer arms, four event shapes and three persisted formats change together, and the matrix audit must hold for both causes in every cell. That needs more care than the default effort.

Teach the reducer and the stop's persisted formats about a held stop. A committed phase, or one whose resumed handoff just passed, can enter `awaiting_review` with cause `held`. A held stop closes through its own event, which keeps the phase commit and records the review commit. A failed hold point pauses the run as resumable. Every closed stop records whether its gate ran the `authored` oracle step. review-stop.json gains a held variant, and interactive-session.json the `builder` origin.

### Detailed instructions

- In `src/domain/state.ts`, widen `StopCause` to `'declared' | 'held'`.
- In `src/schemas/status.ts`, replace `PhaseStopSchema`'s two variants with six explicit structs inside the existing `Schema.NullOr`. Declared: `{ cause: declared, status: waiting }`; `{ cause: declared, status: closed, outcome: corrected, oracleStep: authored | none }`; `{ cause: declared, status: closed, outcome: unchanged }`. Held: `{ cause: held, status: waiting }`; `{ cause: held, status: closed, outcome: corrected, reviewCommit: FullCommitShaSchema, oracleStep: authored | none }`; `{ cause: held, status: closed, outcome: unchanged }`. Annotate `oracleStep`: whether the close's gate ended with the `authored` oracle step, which passed, since the close committed.
- In `src/schemas/reviewStop.ts`, make `ReviewStopFileSchema` a union of two structs, each decoded with `onExcessProperty: 'error'` so it refuses the other's keys. The declared variant is today's struct, with session origin `first-turn | new-session`. The held variant is `{ $schema, run, state: awaiting_review, cause: held, phase: { id, title, mode: headless, position, of }, phaseCommit: FullCommitShaSchema, worktree, seed, session: { provider, sessionId, origin: builder | new-session, interactiveResume } | null, commands, lastClose, closeBase }`. Export `ReviewStop` (the union, without `$schema`), `DeclaredReviewStop` and `HeldReviewStop`.
- In `src/schemas/interactiveSession.ts`, widen the origin of the session and of `turnInProgress` to `first-turn | new-session | builder`. A first turn's own origin keeps the literal `first-turn | new-session`.
- In `src/domain/events.ts`, `ReviewStopReached` keeps `cause: StopCause`, and its `reviewStop` becomes the union. `StopCommitted` replaces `outcome` with `closure: { outcome: corrected; oracleStep: authored | none } | { outcome: unchanged }`. Add `HeldStopClosed { phaseId, phaseCommit, closure: { outcome: corrected; reviewCommit: string; oracleStep: authored | none } | { outcome: unchanged } }`. Add `HoldPointFailed { phaseId, phaseCommit, worktreePath, reason }`.
- In `src/domain/reducer.ts`, `ReviewStopReached` is `unexpected` when `event.reviewStop.cause` differs from `event.cause`. A declared stop keeps today's arm on running/{running}. A held stop on running/{committed} or running/{handoff_failed} goes to awaiting_review/{awaiting_review, held}. Its effects are PersistState (run `stoppedReason: awaiting_review`; phase state `awaiting_review` and stop `{ cause: held, status: waiting }`), WriteReviewStop, WriteResumeInstructions (kind `awaiting_review`) and EmitTrace `review.stop.reached` with `cause: held`. Any other phase state, for either cause, is `unexpected`, naming the cause and the state.
- Also in the reducer: `StopCommitted` persists the closed declared variant from `closure`, and is `unexpected` on a held stop (`a held stop closes with HeldStopClosed`). `HeldStopClosed` on running/{awaiting_review, held} goes to running/{committed, hash: phaseCommit}, with PersistState (phase `committed`, the closed held stop built from `closure`) and DiscardReviewStop. It emits no RecordCommitMetadata, so `commitHash` stays the phase commit. It is `unexpected` on a declared stop, and its verdicts on the other run states mirror `StopCommitted`'s.
- Also in the reducer: `HoldPointFailed` on running/{committed} or running/{handoff_failed} goes to interrupted/{committed, hash: phaseCommit}. Its effects are PersistState (run `stoppedReason: hold_point_failed` and `lastError: reason`; phase state `committed`), WriteResumeInstructions (kind `hold_point_failed`, the phase and the worktree), EmitTrace `hold.point.failed`, and EmitTrace `resume.available`. Mirror `ArtifactCompletionFailed`'s verdicts on the other run states. Every other event keeps its plan-1 verdict on awaiting_review whatever the cause. Keep `assertNever` in every inner switch.
- In `src/domain/matrix.ts`, add the `HeldStopClosed` and `HoldPointFailed` columns to every row. In `src/app/phaxState.ts`, `stopCauseOf` returns the status stop's `cause` for every variant. If `src/app/resumeInstructions.ts` renders by kind, give `hold_point_failed` a line naming `phax resume <run>`.
- Make the existing callers compile with no behaviour change. `src/app/closeStop.ts` dispatches `StopCommitted` with `closure` (`oracleStep: none` when corrected). `buildDeclaredReviewStop` in `src/domain/interactive/reviewStop.ts` returns `DeclaredReviewStop`. `src/app/stopInfo.ts` widens its `cause` and session `origin`. `src/app/enterPhase.ts` and `src/app/interactiveStop.ts` follow the type changes only.
- Run `pnpm exec tsx scripts/schemas-check.ts --write`, which rewrites the `next.schema.json` of phase-status, review-stop and interactive-session in place; add no frozen module. In `tests/unit/schemasPackage/documents.ts`, add current-shape fixtures for the held review-stop, a `builder` session and each new `stop` variant.

### Planned files to create

- `tests/unit/reducerHeldStop.test.ts`

### Planned files to edit

- `src/domain/state.ts`
- `src/domain/events.ts`
- `src/domain/reducer.ts`
- `src/domain/matrix.ts`
- `src/schemas/status.ts`
- `src/schemas/reviewStop.ts`
- `src/schemas/interactiveSession.ts`
- `src/app/phaxState.ts`
- `src/app/closeStop.ts`
- `src/domain/interactive/reviewStop.ts`
- `src/app/stopInfo.ts`
- `packages/schemas/snapshots/phase-status/next.schema.json`
- `packages/schemas/snapshots/review-stop/next.schema.json`
- `packages/schemas/snapshots/interactive-session/next.schema.json`
- `tests/unit/schemasPackage/documents.ts`
- `tests/unit/reducerAwaitingReview.test.ts`
- `tests/unit/reducer.test.ts`
- `tests/unit/events.test.ts`
- `tests/unit/awaitingReviewShapes.test.ts`
- `tests/unit/schemas/interactiveFormats.test.ts`

### Optional files that may be edited

- `src/app/enterPhase.ts`
- `src/app/interactiveStop.ts`
- `src/app/interactiveFiles.ts`
- `src/app/effectRunner.ts`
- `src/app/dispatcher.ts`
- `src/app/handoffInjection.ts`
- `src/app/resumeInstructions.ts`
- `src/domain/errors.ts`
- `packages/schemas/src/generated/index.ts`
- `tests/integration/declaredStopClose.test.ts`
- `tests/integration/dispatcher.test.ts`
- `tests/integration/declaredStopRun.test.ts`
- `tests/integration/declaredStopProviderArgv.test.ts`
- `tests/integration/reviewCorrectionsPrompt.test.ts`
- `tests/integration/enterPhaseStop.test.ts`
- `tests/integration/stateMachineContract.test.ts`
- `tests/unit/resumeInstructions.test.ts`
- `tests/helpers/phaseStatusFixture.ts`
- `tests/e2e/__snapshots__/semanticTrace.declaredStop.test.ts.snap`

### Boundary contracts

Reducer → effect runner: for a held stop and a failed hold point, the reducer emits only PersistState, WriteReviewStop, WriteResumeInstructions, EmitTrace and DiscardReviewStop, which the effect runner already applies. The dispatcher stays the only writer of status.json and review-stop.json. Persisted formats → review UI: each of review-stop.json's two variants carries exactly its own keys, so a UI tells the causes apart by `cause` alone. They are published in `@lbdremy/phax-schemas`.

### Test strategy

- a held ReviewStopReached moves running/{committed} and running/{handoff_failed} to awaiting_review/held with exactly PersistState, WriteReviewStop, WriteResumeInstructions and EmitTrace — small · table · the expected state and effect list per source state · in-phase · §8 The run stops at a held phase after its commit
- every cell of the HeldStopClosed and HoldPointFailed columns, and of ReviewStopReached for both causes, gives the matrix's disposition — small · table · the reducer matrix · in-phase
- a cause mismatch, a held stop from running/{running}, a declared stop from committed, HeldStopClosed on a declared stop and StopCommitted on a held one are each unexpected — small · table · the unexpected disposition · in-phase
- HeldStopClosed corrected and unchanged persist the closed held stop, keep `commitHash` the phase commit, emit no RecordCommitMetadata and discard review-stop.json — small · example · the effect list · in-phase · §8 The review-stop document describes the stop and goes with it
- HoldPointFailed from committed and from handoff_failed pauses the run interrupted with the phase committed and resume instructions — small · example · state and effects · in-phase
- RunResumeRequested, StopCloseRefused, RunInterruptRequested, PhaseResetRequested, and RunArchiveRequested with and without force keep plan 1's verdicts on a held stop — small · table · plan 1's awaiting_review verdicts · in-phase
- each of the six stop variants round-trips, and a corrected variant without `oracleStep`, or a held corrected one without `reviewCommit`, is refused — small · table · the decode result · in-phase
- the held review-stop decodes and refuses `firstReading`, the declared one refuses `phaseCommit`, and `builder` is refused as a first turn's origin — small · example · the decode result · in-phase · §8 The review-stop document describes the stop and goes with it
- the regenerated next snapshots match the schemas, and the package fixtures decode in phax and in the package alike — small · contract · the schemas-package snapshot and parity suites · in-phase

### Implementation order

1. state.ts and events.ts
2. the reducer arms and their unit tests
3. the matrix columns
4. the status, review-stop and interactive-session schemas
5. the compile fixes in closeStop, reviewStop, stopInfo and the other callers
6. snapshot regeneration and the package fixtures

### Excluded scope

- Building or writing a held review-stop, seed or session at run time (phase-03)
- Dispatching HoldPointFailed (phase-03)
- Closing a held stop (phase-05)
- Writing `oracleStep: authored` (phase-07)
- The run-list format and `phax ls --json` (plan 3)

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

Give the six `stop` variants as written in `src/schemas/status.ts`, the two review-stop variants and their exported types, and the widened origins in `src/schemas/interactiveSession.ts`. Give `HeldStopClosed`, `HoldPointFailed` and `StopCommitted`'s `closure`, with every verdict the reducer gives them. Name the source states a held `ReviewStopReached` accepts. Confirm that `commitHash` is not touched when a held stop closes. List the snapshot files rewritten, and confirm that no frozen module was added. Explain any deviation from the planned file lists.

### Commit subject

`feat(state): let a committed phase stop awaiting review as held`

### Commit body

The reducer moves a committed phase, or one whose resumed handoff just
passed, to awaiting_review with cause held. It closes a held stop with
HeldStopClosed, which keeps the phase commit and records the review commit
beside it, and pauses a failed hold point with HoldPointFailed. A closed
stop records whether its gate ran the authored oracle step. review-stop
gains a held variant naming the phase commit, and interactive-session the
builder origin. The formats change in place in the open 0.26.0 shapes.

---

## phase-03 — Reaching a held stop, its failure pause and its re-entry {#phase-03-held-stop}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** It adds a stop path, its failure pause and its re-entry to executePlan's resume sequence, reusing plan 1's stop code without duplicating it. That needs more care than the default effort.

A run holds the phases recorded in its `run-status.json` hold. After such a phase commits and its handoff is validated, the run writes the held seed, records the builder session as current, and writes review-stop.json's held variant, with no agent turn. It then stops in `awaiting_review` with exit 13. A hold point that fails pauses the run as resumable, never failing it or writing a record. A hold point interrupted before its stop re-enters on resume, as does a held phase that paused on its handoff. `--hold` is still unregistered, so only tests start a held run.

### Detailed instructions

- In `src/domain/interactive/seed.ts`, add `buildHeldSeed(input)`. Its input: `shortName`, `phaseId`, `phaseTitle`, the phase's located plan section, its handoff text, its `file-reconciliation.md` text, `base` and `phaseCommit` (full shas), the earlier phases' handoffs (`{ id, title, text }` in plan order), the upcoming phases' sections, `gateCommands` and `closeCommand`. It returns the markdown of the spec's §6 held seed, in this order. The title is `# Held for review: <phase> of <run>`. Then why the run stopped: started with --hold; the phase is committed `<short commit>` on `<short base>`; the later phases have not started and will build on what is left here. Then the sections `## What is expected of you` (review and correct on top of its commit, a guard per correction, keep the scope, and optionally write `.phax-context/correction-handoff.md` in its four sections), `## The phase (plan, <id>)`, `## What it delivered (its handoff)`, `## Its files (reconciliation)`, `## Earlier phases` and `## Upcoming phases (their plan sections)`. Then `Full plan: .phax-context/plan.md`, then `## Gate`, then `## Close the phase` with the close command, run from the main checkout. It never tells anyone how to stop a run.
- In `src/domain/interactive/reviewStop.ts`, add `buildHeldReviewStop(input)`, which returns a `HeldReviewStop` with `closeBase: null` and `lastClose: null`. Its input: the qualified run, the phase (id, title, position, of), `phaseCommit`, the worktree, the main checkout, the seed, the current session or null, the interactive resume support, the continue command or null, and the fresh-start command. Build `enterPhase`, `close` and `reset` through a helper shared with `buildDeclaredReviewStop`, not a copy. `continue` is null with no session or with an unverified provider.
- In `src/app/interactiveStop.ts`, add `stopAtHeldPhase(input: HeldStopInput)`. Its input: the run identity, run path and main checkout; the plan phases, the phase, its index, its folder and its worktree; the provider, model, effort and provider entry the phase ran with; the policy, frozen agent commands, gate commands and located plan sections; `base` and `phaseCommit`; and `builder: { sessionId, startedAt } | null`. In order, it: (1) reads `phase-handoff.md`, `file-reconciliation.md` and the earlier handoffs (`readExecutedHandoffs`); (2) writes both seed copies with `writeSeed`; (3) writes `interactive-session.json` with `current` set to the builder session (origin `builder`) or null, `history: []`, `firstTurns: []` and `turnInProgress: null`; (4) builds the continue and fresh-start commands with the session adapters, carrying the phase's posture, as `stopAtDeclaredPhase` does; (5) builds the held review-stop and dispatches `ReviewStopReached` with cause `held`. Move step 4 into one helper that both stop functions call. It runs no agent turn and never reads stdin. It returns a `HeldStopReport`.
- In `src/domain/errors.ts`, `DeclaredStopReport` gains `cause: 'declared'`. Add `HeldStopReport { cause: 'held', reviewStop, reviewStopPath, phaseCommit, phaseCommitSubject, handoffPath, unverifiedProvider }`, and make `AwaitingReviewStopError.report` a `StopReport = DeclaredStopReport | HeldStopReport`. Add `HoldPointPausedError { message, phaseId, cause }` and `HeldCloseUnavailableError { message, run, phase }`. `stopAtDeclaredPhase` returns its report with its cause.
- In `src/app/executePlan.ts`, read the run's `hold` from `<runPath>/run-status.json` through the persisted reader once, at the start of `program`; a read or decode failure fails as other run-status reads do. Add the hold point after `closePulledBriefs` and before the records block. It applies to a non-final headless phase whose id is in the hold's `phases` and whose status `stop` is null. It reads the phase's status (`base`, `commitHash`, `createdAt`) and its `agent-binding.json` (provider, model, effort, session id), calls `stopAtHeldPhase`, and fails with `AwaitingReviewStopError` (`Run '<run>' awaits review at <phase> (held: --hold)`).
- Wrap the whole hold point: its reads, `stopAtHeldPhase`, and every failure before `ReviewStopReached` is handled. On any such failure, dispatch `HoldPointFailed` with the phase commit, the worktree and the reason, then fail with `HoldPointPausedError`. Add `isHoldPointPausedError` to `isResumablePauseError`, and pass it through the pipe like the cleanup pause. The top-level `tapError` then writes no `failed` record for the committed phase and dispatches no RunFailed. A failure of the `HoldPointFailed` dispatch itself still ends in `HoldPointPausedError`.
- Re-entry at the hold point. In `src/app/resume.ts`, `findNextResumablePhase` takes the run's hold. A non-final `committed` phase whose id is in the hold and whose status `stop` is null is resumable; every other non-final committed phase keeps today's verdict. In `src/app/handoffGeneration.ts`, export `validateHandoffSections`. In executePlan, before `RunResumeRequested`, set `resumeAtHoldPoint` for a start phase in the hold with `stop` null when it is either `committed`, or `handoff_failed` with a `<phase folder>/phase-handoff.md` that exists and has no missing section. Check its worktree and branch as `interactiveReentry` does. After `RunResumeRequested`, such a phase goes straight to the hold point, with no agent turn, gate, commit or handoff turn. A `handoff_failed` held phase without a valid copied handoff keeps today's handoff re-entry, and stops at the hold point once its handoff passes.
- Until the close is wired (phase-06): a resume whose start phase is a headless phase in `awaiting_review` fails before `RunResumeRequested` with `HeldCloseUnavailableError` (`this phax cannot close a held stop yet`), exit 1. The final `tapError` excludes it from RunFailed, as it does `InteractivePreflightError`, so the run stays `awaiting_review`.
- In `src/cli/commands/stopOutput.ts`, add `renderStop(report)`, which switches on the cause. For a declared stop it returns today's `renderDeclaredStop` lines. For a held stop it prints the spec's §6 layout: `◐ <phase>  <title> — awaiting review (held: --hold)`; `Phase commit: <short> <subject>`; `Handoff:`, `Worktree:` and `Seed:`; `Continue the session that built <phase>:` with the command line, with the codex trust note under a codex command, or else the fresh-start command with the not-captured warning for an unverified provider; `or: phax enter-phase <run> <phase>   (add --new-session for a fresh read-only look)`; `Or work by hand or with any agent. Then, from the main checkout:` and the close command; and `Stop: <review-stop path>`. `src/cli/commands/run.ts` and `src/cli/commands/resume.ts` call `renderStop`.
- Create `tests/helpers/heldRunFixture.ts`. It runs `createRunFolder` with a listed hold, then `executePlan` with the fake backend, on a temporary repository (`tests/helpers/tempGit.ts`), for the made-up six-phase invoice-export plan whose phase-03 is interactive. Mock `loadProviderConfig` and its siblings so no test reads `~/.phax`. Export helpers that later phases reuse: start a held run, read a phase's status, and list the fake backend's calls.

### Planned files to create

- `tests/helpers/heldRunFixture.ts`
- `tests/integration/heldStop.test.ts`
- `tests/integration/heldStopReentry.test.ts`

### Planned files to edit

- `src/domain/interactive/seed.ts`
- `src/domain/interactive/reviewStop.ts`
- `src/app/interactiveStop.ts`
- `src/domain/errors.ts`
- `src/app/executePlan.ts`
- `src/app/resume.ts`
- `src/app/handoffGeneration.ts`
- `src/cli/commands/stopOutput.ts`
- `src/cli/commands/run.ts`
- `src/cli/commands/resume.ts`
- `tests/unit/interactive/seed.test.ts`
- `tests/unit/interactive/reviewStop.test.ts`
- `tests/unit/resume.test.ts`

### Optional files that may be edited

- `src/app/interactiveFiles.ts`
- `src/app/resumeInstructions.ts`
- `src/cli/commands/runLayers.ts`
- `src/cli/interruptHandler.ts`
- `tests/helpers/stoppedRunFixture.ts`
- `tests/helpers/fakeProviderCli.ts`
- `tests/integration/declaredStop.test.ts`
- `tests/integration/declaredStopRun.test.ts`
- `tests/unit/cli/resume.test.ts`

### Boundary contracts

executePlan → stop use case: executePlan only decides when a phase holds (recorded hold, non-final, headless, never stopped) and where it re-enters. `stopAtHeldPhase` does the rest, reaching files and the reducer through ports, and transitions only by dispatching `ReviewStopReached`. executePlan turns any earlier failure into `HoldPointFailed`. Use case → CLI: `AwaitingReviewStopError` carries a `StopReport` that `renderStop` turns into lines. Resume selection → executePlan: `findNextResumablePhase` names the held phase whose stop is still owed, and executePlan re-enters it at the hold point.

### Test strategy

- `buildHeldSeed` holds every §5.22 part in order, and no text about stopping a run — small · example · the expected sections · in-phase · §8 The held seed holds what the person needs
- `buildHeldReviewStop` gives `continue` null with no session and with an unverified provider, and carries the enterPhase, close and reset argv — small · table · the expected document · in-phase
- the invoice-export run with hold `listed: [phase-02]` commits phase-01 (its cleanup marker written), commits phase-02 as C2 with its validated handoff, and stops. phase-02's worktree stays at C2 with no cleanup marker, the backend is called for phase-02 only for its work and its handoff, and phase-03 has no worktree or branch. Run and phase are `awaiting_review` with cause `held`, X0 is current with origin `builder`, resume-instructions.md exists, and the lock is released. The output names C2, the worktree, the seed, `codex resume X0`, `phax enter-phase invoice-export phase-02`, `phax resume invoice-export` and the review-stop path, and the exit code is 13 — medium · example · statuses, files, branches, the backend call log and the output · in-phase · §8 The run stops at a held phase after its commit
- review-stop.json is the held variant, with C2's full sha as `phaseCommit`, no `firstReading`, and a `continue` naming X0 — medium · example · the decoded document · in-phase · §8 The review-stop document describes the stop and goes with it
- both seed copies are identical and hold phase-02's section, its handoff, its reconciliation, phase-01's commit as base, C2, phase-01's `phase-handoff.md`, the sections of phase-03 to phase-06 and the close command — medium · example · the seed text · in-phase · §8 The held seed holds what the person needs
- a phase-02 binding with no session id records no current session and prints the fresh-start command — medium · example · interactive-session.json and the output · in-phase
- with no TTY and a stdin pipe that is never written to, the held run exits 13 at phase-02 and reads nothing — medium · example · exit code and the bytes read from stdin · in-phase · §8 No terminal, no wait
- a held phase-02 whose handoff paused (`handoff_failed`) stops at the hold point once a resume validates its handoff, with no second commit — medium · example · state awaiting_review held and the branch tip C2 · in-phase
- a hold point interrupted before ReviewStopReached (phase-02 committed, stop null, run interrupted) stops on resume with no agent turn, gate or commit — medium · example · state, backend call log and branch tip · in-phase
- a `handoff_failed` held phase whose run-folder handoff is valid re-enters the hold point with no handoff turn — medium · example · the backend call log · in-phase
- a hold point whose seed write fails leaves the run interrupted with phase-02 committed, writes no record, dispatches no RunFailed, and a later resume stops at the hold — medium · example · state, the records branch and the dispatched events · in-phase
- resuming a held stop before the close exists is refused before RunResumeRequested with exit 1, and leaves the run awaiting_review — medium · example · state before and after · in-phase
- `findNextResumablePhase` picks a non-final committed phase in the hold with stop null, and skips one outside the hold or with its stop set — small · table · the expected start phase · in-phase

### Implementation order

1. the held seed and the held review-stop builder, with their unit tests
2. `stopAtHeldPhase` and the shared command helper
3. the `StopReport` union, the two new errors and `renderStop`
4. executePlan's hold read, its hold point and the failure pause
5. the hold-point re-entry in resume.ts and executePlan, and the interim close refusal
6. the fixture and the integration tests

### Excluded scope

- The commands on a held run: session-info, enter-phase, reset-phase and the rest (phase-04)
- Closing a held stop and continuing the run (phase-05, phase-06)
- Registering `--hold` and widening exit 13's meaning (phase-06)
- Any change to the phase guard
- The run-list format and `phax ls --json` (plan 3)

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

Give the signatures of `buildHeldSeed`, `buildHeldReviewStop`, `stopAtHeldPhase` and `renderStop`, the shapes of `HeldStopReport`, `StopReport`, `HoldPointPausedError` and `HeldCloseUnavailableError`, and the shared helper's name and module. Say where executePlan reads the hold, and where the hold point sits relative to the handoff, briefs, records and cleanup. Say how a failure there becomes `HoldPointFailed`. Give the exact re-entry conditions in resume.ts and executePlan, and the interim refusal's text. Name the helpers `tests/helpers/heldRunFixture.ts` exports. Explain any deviation from the planned file lists.

### Commit subject

`feat(interactive): stop a run at a held phase after it commits`

### Commit body

A phase in the run's recorded hold stops once it has committed and its
handoff is validated, before its record and cleanup, with no agent turn.
phax writes the held seed, records the builder session as current, and
moves the run to awaiting_review with cause held, whose effect writes
review-stop.json's held variant; the run exits 13. A hold point that fails
pauses the run without a record, and a resume re-enters a hold point that
was interrupted or that followed a handoff pause. --hold is not registered
yet.

---

## phase-04 — The commands on a held run {#phase-04-held-stop-commands}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

Every command a person uses while a run waits treats a held stop correctly. `phax ls` and `phax session-info` show the held cause, the phase commit and the builder session. `phax path`, `phax shell` and `phax open` target the held worktree. `phax enter-phase` continues the builder session, or with `--new-session` runs a read-only first turn that becomes current. `phax reset-phase` names the phase commit it discards. archive, adjust-plan and the phase guard keep their refusals.

### Detailed instructions

- In `src/app/stopInfo.ts`, a held stop returns `cause: 'held'`, the `phaseCommit` from review-stop.json, and the current session with its origin (`builder` or `new-session`).
- In `src/cli/commands/sessionInfo.ts`, print `Stopped phase:    <id> — <title> (headless, committed <short>, <position>/<of>)` at a held stop, and the session line with its origin, followed by `continue: phax enter-phase <run> <phase>`. Keep the declared stop's lines unchanged. `phax ls` already prints `awaiting_review (<cause>)` and the stopped phase: confirm it with a held run, and leave `phax ls --json` unchanged.
- In `src/app/enterPhase.ts`, the stopped-phase case applies to a held stop, where the builder session is current. The notice reads `Continuing <provider> session <id> (the session that built <phase>) in <worktree>`. A held stop with no current session, or with an unverified provider, runs the fresh-start command, as a declared stop does.
- With `--new-session` at a held stop, the read-only first turn runs under the run lock, as at a declared stop. When it answers, it writes `first-reading.md`, becomes current with origin `new-session`, and moves the builder session into `history`. review-stop.json is refreshed by patching only `session` and `commands.continue` of the live document (`refreshReviewStop` in `src/app/interactiveFiles.ts`), so the held variant and its `phaseCommit` survive. Never rebuild it as a declared stop. A failed or refused new turn sets its edits aside in `refused-turn-NN/`, restores the worktree, and leaves the builder session current and review-stop.json as it was.
- In `src/app/resetPhase.ts`, `previewResetPhase` returns `phaseCommit: string | null`: the stopped phase's status `commitHash` at a held stop, null otherwise. In `src/cli/commands/resetPhase.ts`, at a held stop, print `This discards <phase>'s commit <short> and N uncommitted review corrections in <worktree>:`, then the M/A/D lines, then `phax resume will run <phase> again from its start and hold it again.` The reset itself is unchanged: deleting the phase branch removes the phase commit, `PhaseResetRequested` discards review-stop.json, and the recorded sessions are removed.
- Use `tests/helpers/heldRunFixture.ts` to build a run held at phase-02 with builder session X0, using a fake Session port, a fake shell and a fake editor that record their cwd and arguments. Use a fake codex CLI from `tests/helpers/fakeProviderCli.ts` for the argv checks.

### Planned files to create

- `tests/integration/heldStopCommands.test.ts`

### Planned files to edit

- `src/app/stopInfo.ts`
- `src/cli/commands/sessionInfo.ts`
- `src/app/enterPhase.ts`
- `src/app/resetPhase.ts`
- `src/cli/commands/resetPhase.ts`

### Optional files that may be edited

- `src/app/interactiveFiles.ts`
- `src/app/resolveRunInfo.ts`
- `src/cli/commands/enterPhase.ts`
- `src/cli/commands/ls.ts`
- `tests/helpers/heldRunFixture.ts`
- `tests/helpers/fakeProviderCli.ts`
- `tests/integration/enterPhaseStop.test.ts`
- `tests/integration/stoppedRunCommands.test.ts`
- `tests/integration/sessionInfo.test.ts`
- `tests/integration/resetPhase.test.ts`
- `tests/unit/cli/ls.test.ts`
- `tests/unit/cli/enterPhase.test.ts`

### Boundary contracts

Commands → files: every fact `ls`, `session-info` and `enter-phase` show about a held stop comes from review-stop.json and interactive-session.json, through `src/app/stopInfo.ts` and `src/app/interactiveFiles.ts`. No command recomputes it from git. enter-phase → Session port: the continue and fresh-start commands are the ones the stop recorded, spawned through the port, never re-derived per command.

### Test strategy

- `phax ls` shows `awaiting_review (held)` and `2/6 phase-02` for the held run only, and `--awaiting-review` lists it alongside a declared stop, but not a failed or interrupted run — medium · example · the rendered rows · in-phase · §8 Waiting is visible and filterable
- `phax session-info` on the held run prints the state, the cause, phase-02 with its short commit, its worktree and X0 with origin builder — medium · example · the printed lines · in-phase · §8 Waiting is visible and filterable
- `phax path`, `phax shell` and `phax open` target phase-02's worktree — medium · example · the fake shell's and editor's recorded cwd and path · in-phase · §8 The worktree commands target the stopped phase
- `phax enter-phase invoice-export phase-02` spawns `codex resume X0` interactively in phase-02's worktree, carrying the phase's model, effort and posture flags — medium · example · the fake codex's recorded argv and cwd · in-phase · §8 enter-phase continues the current session, on codex too
- `--new-session` makes X2 current with origin new-session, keeps X0 in history, writes `first-reading.md`, keeps review-stop.json held with its `phaseCommit`, and spawns `codex resume X2` — medium · example · interactive-session.json, review-stop.json and the argv · in-phase · §8 --new-session runs a new first turn at either stop
- a `--new-session` turn that writes a file is set aside in `refused-turn-01/`, restored, and leaves X0 current — medium · example · worktree bytes and interactive-session.json · in-phase
- the reset preview at the held stop names C2 and the two uncommitted files; `--yes` removes the worktree, `<run.branch>--phase-02` with C2, and the session files — medium · example · the printed preview and the git and file state · in-phase · §8 Reset at a held stop runs the phase again and holds it again
- a reset of phase-01 while phase-02 is held is refused, naming phase-02, and changes nothing — medium · example · the message and unchanged state · in-phase · §8 Reset the stopped phase first
- archive without `--force` and `adjust-plan --landed` are refused on the held run, naming awaiting_review; archive with `--force` archives it — medium · example · exit codes and run state · in-phase · §8 adjust-plan and archive treat the stop as unfinished
- `phax resume` and `phax enter-phase` run from inside phase-02's worktree are refused with the phase-guard message, and the run stays awaiting_review — medium · example · the refusal and the state · in-phase · §8 The phase guard holds inside the worktree

### Implementation order

1. stopInfo and session-info at a held stop
2. enter-phase's builder continue and its `--new-session` refresh
3. the reset preview
4. the integration tests for every command

### Excluded scope

- Closing a held stop (phase-05)
- The `phax ls --json` run list (plan 3)
- Any change to the phase guard's classification

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

Give the held lines of `phax session-info` and the enter-phase notice. Say how `--new-session` refreshes a held review-stop, and what a failed new turn leaves. Give the reset preview's wording and `previewResetPhase`'s new field. List which commands needed no change and were only covered by a test. Explain any deviation from the planned file lists.

### Commit subject

`feat(interactive): show and act on a held stop from every command`

### Commit body

session-info names a held phase with its commit and the builder session.
enter-phase continues the builder session, or runs a read-only first turn
with --new-session that becomes current while review-stop.json stays
held. reset-phase's preview names the phase commit it discards. ls,
path, shell, open, archive, adjust-plan and the phase guard are covered
at a held stop.

---

## phase-05 — Closing a held stop: the review commit, the correction handoff and reconciliation, and an honest record {#phase-05-close-held-stop}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high
**Assignment reason:** The phase turns the declared close into one sequence with two causes: a different commit base, a review commit beside an unchanged phase commit, separate gate, diff and reconciliation files, a report union, and a record filter that must not credit the agent with the review. No code in the repository shows that design yet.

Close a held stop with the same use case that closes a declared one. It gates the worktree first and returns a red gate to the person. It takes the person's handoff, or that of a read-only closing turn resuming the builder session, given the corrections' diff against the phase commit. It leaves one review commit with a `Held-Phase:` trailer on top of the unchanged phase commit, or no commit when nothing changed. It writes the correction handoff and reconciliation beside the phase's own. No phase record ever carries the stop's files as the agent's.

### Detailed instructions

- In `src/app/closeStop.ts`, rename `closeDeclaredStop` to `closeStop` and update its caller in `src/app/executePlan.ts` (the rename only; executePlan still refuses a held close until phase-06). It reads the parked review-stop and branches on its `cause` inside the one `closeSteps` sequence. Everything not listed below stays as it is today, every refusal included.
- Make `CloseReport` a union. `{ cause: 'declared'; outcome: 'corrected' | 'unchanged'; commit }`, `{ cause: 'held'; outcome: 'corrected'; phaseCommit; reviewCommit }` and `{ cause: 'held'; outcome: 'unchanged'; phaseCommit }`. Every variant also carries `handoffSource`, `gateLog`, `gateSteps`, `changedPaths`, `restoredClosingTurn` and `oracleStep: 'authored' | 'none'` (`none` until phase-07). Update its readers to switch on it exhaustively: `ClosedStop` in `src/app/executePlan.ts`, `renderStopClosed` in `src/cli/commands/stopOutput.ts`, and `src/cli/commands/resume.ts`. Render a held close as the spec's §6 shows it. When corrected: `<phase> (held): N files changed by review, on <short phase commit>`, then `✓ <phase>  <title>   review commit <short>  on <short phase commit>  (corrected)`. When unchanged: `<phase> (held): no change`, then `✓ <phase>  <title>   <short phase commit>  (unchanged, no commit)`. Both print the gate lines and the handoff source (`→ correction-handoff.md`).
- Step 1, the close base. When `closeBase` is null, HEAD must equal the phase's status `commitHash` (`readPhaseCommit` in `src/app/phaseStatusUpdates.ts`). Otherwise refuse with `close-error` (`commit`), naming the phase commit and the remedy `git -C <worktree> reset --soft <phase commit>`. When `closeBase` is set and HEAD moved, `finishLandedCommit` accepts a commit whose parent is `closeBase` and whose message carries this run's `Run-Id` and `Held-Phase: <phase>`. It then finishes from it, writing `review-diff.patch` and the correction reconciliation, and reports `oracleStep: 'none'` until phase-07.
- Step 2, the gate. A held close writes its gate files under `<phase folder>/review-gate/` (mkdirp): the log is `checks-attempt-NN.log`, with NN from `nextAttemptNumber` over that folder's names, its per-attempt siblings follow the log path, and the attribution is `review-gate/gate-attribution.json`. A red gate is refused as `gate-failed` with that log, exit 4.
- Step 4, the handoff. The order of precedence is unchanged: the person's `.phax-context/correction-handoff.md` first; then the fixed reviewed-without-change text when nothing changed; then a closing turn that resumes the current session (the builder's, by default), given the diff from HEAD's tree to the gated tree, cut by `cutDiff`, and falling back to a new session. Per q-held-closing-posture (decided), the resumed turn uses `readOnly: true` and no agent commands, as a declared closing turn does. On codex that is `exec resume` with `sandbox_mode=read-only` and `approval_policy=never`. On vibe the session adapter keeps the phase posture. The worktree comparison and the handoff-file check run after every turn. A writing turn's edits move byte for byte to `refused-turn-NN/` and are restored.
- Step 6, the commit. Write the handoff to `<phase folder>/correction-handoff.md`; never write `phase-handoff.md`. When the worktree changed, call `commitTree(worktree, gated, <plan subject>, buildHeldReviewCommitBody(...))` and save the diff as `review-diff.patch`, never `diff.patch`. When unchanged, make no commit, write no diff, and never raise `PhaseHadNoChangesError`.
- Step 7, the reconciliation. Give `reconcilePhaseFiles` (`src/app/reconcilePhaseFiles.ts`) an option `output: 'phase' | 'correction'`, defaulting to `phase`. With `correction`, it writes `correction-reconciliation.json` and `correction-reconciliation.md` in the `phase-file-reconciliation` format. A corrected held close calls it with kind `review` and output `correction`, which reads HEAD^..HEAD, the review commit against the phase commit. An unchanged held close writes `reconcileReview([])` to the same two files without running git. A held close never writes `file-reconciliation.*`.
- Step 8, the state. A held close dispatches `HeldStopClosed` with `phaseCommit` and `closure` (`{ outcome: corrected, reviewCommit, oracleStep }` or `{ outcome: unchanged }`); a declared close keeps dispatching `StopCommitted`. Any failure before that dispatches `StopCloseRefused`, never RunFailed, and never resets the person's corrections. Anything the close reads is read inside the close, so a missing file is a close error.
- In `src/app/commit.ts`, add `buildHeldReviewCommitBody({ phase, runId, shortName, worktreePath, gateLogPath })`. Its body is the line `Review corrections to <phase id> (<title>), made by a person at a held stop.`, a blank line and `---`, then the trailers `Run-Id`, `Short-Name`, `Phase-Title`, `Held-Phase: <phase id>`, `Worktree` and `Gate-Log`. It carries no `Phase-Id`, `Model`, `Effort` or `Session-Id`, so no record and no agent is named by the review commit.
- Create `src/domain/records/stopArtifacts.ts` with `isStopArtifact(name)`. It is true for `review-seed.md`, `first-reading.md`, `interactive-session.json`, `correction-handoff.md`, `correction-reconciliation.json`, `correction-reconciliation.md`, `review-diff.patch`, `review-gate`, the parked review-stop file, any `refused-turn-NN`, any `first-turn-NN.jsonl` or `closing-turn-NN.jsonl` and their `-retry` streams, and any kept `<turn label>-correction-handoff.md` copy. `assembleRecord` (`src/domain/records/assemble.ts`) drops those names before selecting artifacts. phase-06 writes the record itself.
- Extend `tests/helpers/fakeProviderCli.ts` only if a held close needs a behaviour it lacks, such as reporting a session as not found on resume, or reporting a cumulative cost on resume.

### Planned files to create

- `src/domain/records/stopArtifacts.ts`
- `tests/integration/heldStopClose.test.ts`
- `tests/unit/records/stopArtifacts.test.ts`

### Planned files to edit

- `src/app/closeStop.ts`
- `src/app/commit.ts`
- `src/app/reconcilePhaseFiles.ts`
- `src/domain/records/assemble.ts`
- `src/app/executePlan.ts`
- `src/cli/commands/stopOutput.ts`
- `tests/integration/declaredStopClose.test.ts`
- `tests/integration/declaredStopProviderArgv.test.ts`
- `tests/unit/recordsAssemble.test.ts`

### Optional files that may be edited

- `src/cli/commands/resume.ts`
- `src/app/interactiveFiles.ts`
- `src/app/interactiveStop.ts`
- `src/app/phaseStatusUpdates.ts`
- `src/domain/errors.ts`
- `src/app/telemetry/stopTelemetry.ts`
- `tests/helpers/fakeProviderCli.ts`
- `tests/helpers/heldRunFixture.ts`
- `tests/integration/declaredStopRun.test.ts`
- `tests/integration/costLedger.test.ts`
- `tests/unit/cli/resume.test.ts`

### Boundary contracts

App → Git port: a held close commits only through `commitTree`, with a tree id it snapshotted, on top of the phase commit. It never amends, squashes or rewrites the phase commit. App → Backend port: the closing turn resumes the current session read-only, or starts a new read-only session. Its answer is decoded at the boundary against the `interactive-handoff` `$schema` that its prompt names by exact URL. App → reducer: a held close transitions only through `StopCloseRefused` and `HeldStopClosed`. Close → readers: the stop's files live beside the phase's own (`correction-handoff.md`, `correction-reconciliation.*`, `review-diff.patch`, `review-gate/`), and the phase's own files stay byte-identical. Records → assembly: `assembleRecord` alone decides what a record carries.

### Test strategy

- `isStopArtifact` recognises every stop file name that `src/app/interactiveFiles.ts`, `src/app/interactiveStop.ts` and `src/app/closeStop.ts` write into a phase folder, and none of `output.jsonl`, `phase-handoff.md`, `diff.patch`, `gate-attribution.json`, `checks-attempt-01.log` or `file-reconciliation.json` — small · table · the expected verdict per name · in-phase
- a record assembled from a folder holding stop files carries none of them — small · example · the assembled artifact list · in-phase
- closing phase-02 held at C2 with corrections and no person's handoff: the gate runs before any turn, with its log in `review-gate/`. The closing turn resumes X0 read-only with the diff against C2, and its answer lands in `correction-handoff.md`, while phase-02's `phase-handoff.md` stays byte-identical. The branch holds C2 and exactly one commit on it, with the plan's subject, `Held-Phase: phase-02`, Ada Example as author, no `Phase-Id` and no path under `.phax-context/`. HeldStopClosed is corrected with that commit as `reviewCommit` — medium · example · files, git log, trailers and the dispatched event · in-phase · §8 Closing a held stop leaves a review commit on the unchanged phase commit
- `review-diff.patch` is written and `diff.patch` is unchanged; `file-reconciliation.json` is byte-identical; and `correction-reconciliation.json` lists the corrections as `reviewCorrections`, with `hasDeviations` false — medium · example · file bytes and the decoded reconciliation · in-phase · §8 Corrections are not deviations
- an unchanged held close makes no commit, writes the fixed handoff to `correction-handoff.md`, runs no turn, leaves the branch at C2, and never raises exit 9 — medium · example · git tip and files · in-phase · §8 A held phase reviewed without change leaves no commit
- with no current session, or when the fake codex reports X0 not found on resume, a new read-only session gets the seed and the diff, and the stop closes corrected — medium · example · the fake's argv and the outcome · in-phase · §8 A closing turn without a usable session starts fresh
- a red gate exits 4 with no fix attempt and no turn, keeps its log, commits nothing, leaves C2 the tip, and restores review-stop.json — medium · example · exit code, files and state · in-phase · §8 A red gate returns the phase to the person
- a person's handoff file is used byte for byte with no turn, and `phase-handoff.md` is unchanged — medium · example · file bytes and the backend call log · in-phase · §8 The person's handoff is used as written
- a person's file without `## Guards`, or with three corrections and two guards, exits 1 naming the defect; a closing answer invalid twice exits 5 after exactly one corrective resume; none commits — medium · table · exit codes, messages and the branch tip · in-phase · §8 An invalid handoff commits nothing
- a closing turn that creates `src/export/labels.ts` exits 5 naming it; the file is set aside in `refused-turn-01/` and restored, and nothing is committed — medium · example · exit code, files and branch tip · in-phase · §8 A closing turn that edits is refused
- a closing turn that reports a usage limit exits 8 naming the reset time and keeps the stop — medium · example · exit code, message and state · in-phase · §8 A limit at closing keeps the stop
- a commit the person made on C2 is refused, naming C2 and the `reset --soft` remedy — medium · example · the refusal and the unchanged branch · in-phase
- a close interrupted after its review commit is finished from the `Held-Phase` commit on the next close — medium · example · the report and the single review commit · in-phase
- corrections written by the test and the same bytes written by a fake continued session give the same review-commit tree and equal correction reconciliations — medium · metamorphic · the two closes' trees and reconciliations · in-phase · §8 Who made the edit does not matter
- neither the review commit nor any branch of the run contains a path under `.phax-context/`, `interactive-session.json`, `review-stop.json` or `first-reading.md` — medium · example · `git ls-tree` of every run branch · in-phase · §8 The stop's files are never committed
- the held closing turn through the fake `claude` and the fake `codex` CLIs resumes X0 with Claude's reading tools and no shell, and with `exec resume`, `sandbox_mode=read-only` and `approval_policy=never` — medium · example · the recorded argv · in-phase
- the cost ledger gains one `closing-turn` entry for phase-02 holding that turn's own increment, while the builder entries stay unchanged — medium · example · the decoded cost-ledger.json · in-phase · §8 Only phax's turns are costed, each by its own increment

### Implementation order

1. `isStopArtifact` and the assembly filter, with their unit tests
2. `buildHeldReviewCommitBody`
3. `reconcilePhaseFiles`' correction output
4. the `CloseReport` union and its readers
5. closeStop's held base, gate folder, handoff file, commit and reconciliation
6. the HeldStopClosed dispatch
7. the held close tests and the argv tests

### Excluded scope

- Calling the held close from executePlan, writing the record, the cleanup and the next phase (phase-06)
- The `authored` oracle step at a close (phase-07)
- Transcript capture and the records' review fields (plan 3)

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

Give the signature of `closeStop` and the `CloseReport` union, with every reader updated. Describe each held-specific step: the base check, the gate folder, the handoff, the commit, the diff and the reconciliation files. Give the exact trailer block of a review commit and `buildHeldReviewCommitBody`'s signature. Say how `finishLandedCommit` recognises a held commit. Give the closing turn's posture per provider, as the argv tests pin it. Give `isStopArtifact`'s list, and the reconciliation option added to `reconcilePhaseFiles`. Confirm that a held close never writes `phase-handoff.md`, `diff.patch`, the phase folder's `gate-attribution.json` or `file-reconciliation.*`. Explain any deviation from the planned file lists.

### Commit subject

`feat(interactive): close a held stop with a review commit on the phase commit`

### Commit body

closeStop now closes both causes with one sequence. At a held stop the
first close requires HEAD to be the phase commit, the gate writes under
review-gate/, and the handoff goes to correction-handoff.md beside the
builder's. A read-only closing turn resumes the builder session when the
person wrote no handoff. The corrections land as one review commit on top
of the unchanged phase commit, with a Held-Phase trailer and the person
as author, or as no commit when nothing changed. They are reconciled
against the phase commit, never as deviations, and a phase record never
carries the stop's files as the agent's.

---

## phase-06 — Run and close held phases end to end, with phax run --hold {#phase-06-hold-end-to-end}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** It adds the held close, the closed-stop re-entry and the record at closing to executePlan's resume sequence, mirroring the declared re-entry block. It also registers --hold and wires the prompts and the global reconciliation. That needs more care than the default effort.

Make the operator's hold real. `phax run --hold`, `--hold phase-02,phase-04` and `--hold oracle` are accepted, refused when malformed (exit 1), and resolved before the run is named. `phax resume` closes a held stop, writes the phase's record once, runs the cleanup and continues in the same invocation. A close interrupted before its cleanup finishes on the next resume. Later phases read every closed stop under `## Review corrections`, and the global reconciliation reads the corrections as review corrections.

### Detailed instructions

- In `src/app/executePlan.ts`, delete the interim `HeldCloseUnavailableError` refusal and the error itself. A resume whose start phase is a headless phase in `awaiting_review` checks its worktree before `RunResumeRequested`, with the existing `stopReentry`. Also before `RunResumeRequested`, it reads what the phase's record needs into `heldRecord`: provider, model, effort and session id from `agent-binding.json`, and `sourceSha` from the status `commitHash`. A failure there fails as the worktree check does, with the run still `awaiting_review`, and nothing is read after the close.
- After `RunResumeRequested`, a held stop calls `closeStop` with the phase's gate steps and its gate request computed inside the close. On success it writes the record once with `writeRecordForPhase`: the `heldRecord` values, outcome `committed`, `sourceSha` set to the phase commit (never HEAD), and `failOnRefusal: false`. It then patches the agent binding to `completed`, runs `cleanupCommittedPhase`, sets `previousPhaseBranch` to the phase branch (whose tip is the review commit, or C2), and continues with the next phase.
- Skip the discharge pre-check (`oracleCommitOf` at the top of the loop) for the start phase of a stop re-entry and of a closed-stop re-entry, because that phase's gate already ran.
- The closed-stop re-entry. In `src/app/resume.ts`, a non-final `committed` phase whose status `stop` is closed, of either cause, is resumable. In executePlan, such a start phase sets `resumeFromClosedStop`. Its worktree, and for a held stop its `heldRecord`, are read before `RunResumeRequested`. After it: a held stop lists the run's records (`listRecords` from `src/app/recordsList.ts` with the run id) and writes the record only when no phase record of that phase id exists; then both causes run the cleanup and continue. A declared stop writes no record. A held-closed phase that paused in cleanup re-enters through today's cleanup re-entry and writes no second record. Check whether that path already skips the record, add a guard on the closed held stop if not, and say which in the handoff.
- `reviewCorrectionsFor(i)` reads the earlier phases' statuses, and returns nothing when none has a closed `stop`, so the prompts of runs without a stop stay byte-identical. In `src/app/handoffInjection.ts`, `readReviewCorrections` walks the earlier phases in plan order and keeps each phase whose status `stop` is closed, whatever its mode. A held stop contributes `correction-handoff.md` and the `reviewCorrections` of `correction-reconciliation.json`; a declared stop contributes `phase-handoff.md` and those of `file-reconciliation.json`. A missing or undecodable file is an error. `ReviewCorrectionStop` gains `cause`. In `src/domain/interactive/reviewCorrections.ts`, each stop's heading reads `### <phase> (held)` or `### <phase> (interactive)`. The opening sentence names the phases where a person reviewed and corrected the run, and keeps the precedence and the binding plan section.
- In `src/app/generateGlobalReconciliation.ts`, replace `phaseIds` with `phases: readonly Pick<PhaseStatus, 'phaseId' | 'phaseIndex' | 'stop'>[]`. Its caller `src/app/reviewHandoff.ts` passes the sorted statuses. For a phase whose `stop` is held, closed and corrected, read `correction-reconciliation.json` and merge its `reviewCorrections` into that phase's entry before aggregating, so a file only the review changed reads as review-corrected and never as unplanned. A missing or undecodable correction reconciliation counts as a missing reconciliation: an error unless `allowPartial`.
- CLI. In `src/cli/program.ts`, register `--hold [selection]` on `run`, described `Stop for review once these headless phases commit: no value for every phase but the final one, oracle, or phase ids such as phase-02,phase-04`. Do not add it to `resume`. In `src/cli/commands/run.ts`, parse it with `parseHoldValue` before loading the config or reading the plan; a defect prints its message and exits 1. Pass the request to `freshRunPreflight`. In `src/app/dryRun.ts`, `buildDryRunReport` and `formatDryRunReport` resolve the hold with `resolveHold` and print `Hold: <selection> — <phases>`, or the hold check's errors under it. The exit code is unchanged.
- In `src/cli/commands/runLayers.ts`, row 13 reads `Awaiting review at an interactive or held phase (resumable)`. Update README.md's exit-code row to match, then run `pnpm gen:usage-spec` and `pnpm docs:cli`.
- Create `tests/e2e/semanticTrace.heldStop.test.ts`, built like `tests/e2e/semanticTrace.declaredStop.test.ts`: gated by `PHAX_E2E_RUN=1`, with real git and a fake backend. A three-phase made-up plan runs with hold `listed: [phase-02]` and stops at phase-02. The test writes a correction, closes the stop with a resume that finishes the run, and snapshots the semantic trace projection of both invocations. Write the snapshot by running the test with `PHAX_E2E_RUN=1` if the session can. Otherwise commit the test without its snapshot, and say so in the handoff so that the operator writes it.

### Planned files to create

- `tests/integration/heldStopRun.test.ts`
- `tests/integration/holdCli.test.ts`
- `tests/e2e/semanticTrace.heldStop.test.ts`

### Planned files to edit

- `src/app/executePlan.ts`
- `src/app/resume.ts`
- `src/domain/errors.ts`
- `src/app/handoffInjection.ts`
- `src/domain/interactive/reviewCorrections.ts`
- `src/app/generateGlobalReconciliation.ts`
- `src/app/reviewHandoff.ts`
- `src/cli/program.ts`
- `src/cli/commands/run.ts`
- `src/app/dryRun.ts`
- `src/cli/commands/runLayers.ts`
- `README.md`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `tests/integration/reviewCorrectionsPrompt.test.ts`
- `tests/unit/interactive/reviewCorrections.test.ts`
- `tests/integration/generateGlobalReconciliation.test.ts`
- `tests/unit/dryRun.test.ts`

### Optional files that may be edited

- `tests/e2e/__snapshots__/semanticTrace.heldStop.test.ts.snap`
- `src/app/promptGeneration.ts`
- `src/app/closeStop.ts`
- `src/app/interactiveStop.ts`
- `src/app/recordsList.ts`
- `src/cli/commands/resume.ts`
- `src/cli/commands/stopOutput.ts`
- `src/cli/cliDocs.ts`
- `src/domain/reconciliation/global.ts`
- `docs/cli/inventory.md`
- `tests/helpers/heldRunFixture.ts`
- `tests/helpers/fakeProviderCli.ts`
- `tests/integration/heldStopReentry.test.ts`
- `tests/unit/resume.test.ts`
- `tests/unit/readmeExitCodes.test.ts`
- `tests/integration/usageSpecDrift.test.ts`
- `tests/unit/cli/run.test.ts`
- `tests/unit/promptGeneration.test.ts`
- `tests/integration/declaredStopRun.test.ts`
- `tests/integration/runPreflightBeforeNaming.test.ts`

### Boundary contracts

CLI → app: `phax run` parses the hold, and the app resolves it and records it with the run. `phax resume` never takes one, and executePlan reads the hold from run-status.json, so the recorded hold is the only one. executePlan → close: executePlan decides only when to close and what to read before `RunResumeRequested`. `closeStop`, then the shared record, cleanup and chaining code, do the rest. Later prompts depend on each closed stop's status `stop`, its interactive handoff file and its reconciliation's `reviewCorrections`. Records: a held phase's record is written once, at closing or at the re-entry that owes it, with the phase commit as `sourceSha`.

### Test strategy

- with no `--hold`, with `--hold`, and with `--hold phase-02,phase-04`, the new runs record `none`, `all` (phase-01, phase-02, phase-04, phase-05) and `listed` (phase-02, phase-04) — medium · example · the decoded run-status.json · in-phase · §8 The hold is resolved and recorded when the run is named
- `--hold phase-2`, `oracle,phase-02`, `phase-02,,phase-04`, `phase-02,phase-02` and `phase-100`, and `phax run --hold invoice-export --plan <plan>` (with the run-name hint), each exit 1 with no run, worktree or branch; `phax run invoice-export --plan <plan> --hold=phase-02` names the run and records `listed` phase-02 — medium · table · exit codes, output and the repository state · in-phase · §8 A malformed hold value is refused
- the five hold-check refusals exit 11 through `runRun` with no run named — medium · table · exit code and registry · in-phase · §8 The hold preflight refuses a selection the plan cannot honour
- `phax resume invoice-export --hold` exits 1 as an unknown option, and `--dry-run` prints the resolved hold — medium · example · exit code and output · in-phase · §8 The hold is fixed for the run and comes only from the flag
- a run held at phase-02 and closed by `phax resume` writes a review commit authored by Ada Example, writes the cleanup marker after the close, creates phase-03's worktree at the review commit in the same invocation, and continues — medium · example · git log, markers and statuses · in-phase · §8 Closing a held stop leaves a review commit on the unchanged phase commit
- an unchanged close creates phase-03's worktree at C2 with no exit 9 — medium · example · the worktree's HEAD and exit code · in-phase · §8 A held phase reviewed without change leaves no commit
- a red closing gate exits 4 and keeps the stop, and a second resume after the fix closes it and continues — medium · example · exit codes and state · in-phase · §8 A red gate returns the phase to the person
- a run started with `--hold phase-04` pauses on a rate limit in phase-02, then stops at the declared phase-03, which is closed. phase-02 commits without stopping, phase-04 stops held and phase-05 does not stop, and run-status `hold` stays byte-identical throughout — medium · example · statuses and run-status bytes · in-phase · §8 The hold is fixed for the run and comes only from the flag
- a plan with no interactive phase, whose phase-02 handoff ends with a question, never stops without `--hold`, and stops only at phase-03 with `--hold phase-03` — medium · example · statuses and exit codes · in-phase · §8 Only a declared or held phase stops
- with records configured, the records branch holds no phase-02 record while it is held, and exactly one after the close. That record names C2 and X0, and `records explain` on C2 finds it — medium · example · the records branch and the explain output · in-phase · §8 A held phase's record is written once, at closing
- a close interrupted after HeldStopClosed and before its cleanup writes the record on the next resume, runs the cleanup, continues, and writes no second record when resumed again — medium · example · the records branch count and the cleanup marker · in-phase
- a held phase-02 that pauses in cleanup after its close re-enters only the cleanup and writes no second record — medium · example · the records branch count · in-phase
- a reset of held phase-02 followed by `phax resume` runs phase-02 headless from phase-01's commit, commits it again, and stops held with exit 13 — medium · example · git log, state and exit code · in-phase · §8 Reset at a held stop runs the phase again and holds it again
- a held phase-02 and a declared phase-03, both corrected, reach the prompts of phase-04 to phase-06 under `## Review corrections`: phase-02's `correction-handoff.md` (held), then phase-03's `phase-handoff.md` (interactive). The section carries the precedence sentence. `## Previous phase handoff` in phase-04's prompt is phase-03's `phase-handoff.md`, and phax-plan.json and plan.md stay byte-identical — medium · example · the built prompts and file bytes · in-phase · §8 Later phases read the corrections
- the same run's plan files are byte-identical before the first stop and after phase-03 commits, and phase-04's prompt carries its approved section unchanged — medium · example · file bytes and the prompt section · in-phase · §8 The plan stays as approved
- the global reconciliation reads a file only phase-02's review changed as review-corrected and never unplanned, and a missing `correction-reconciliation.json` on a held corrected phase is an error — medium · example · the global reconciliation and the typed error · in-phase · §8 Corrections are not deviations
- a plan with no Mode line run without `--hold` keeps its prompts (no `## Review corrections`), states and exit codes, and records `hold: { selection: none }` — medium · example · prompts, statuses and run-status · in-phase · §8 Plans and runs without a stop are unchanged
- the held stop's run and close emit the semantic trace pinned by the snapshot — medium · smoke · the semantic trace snapshot · in-phase

### Implementation order

1. executePlan's held close re-entry, the record at closing and the pre-resume reads
2. the closed-stop re-entry in resume.ts and executePlan, and the skipped discharge pre-check
3. `readReviewCorrections`, the labelled section and the status-based guard
4. the global reconciliation merge and its caller
5. program, run and dry-run for `--hold`
6. exit 13's meaning, then usage and CLI docs regeneration
7. the integration tests and the e2e trace

### Excluded scope

- The oracle-pair rules and lifting the interim pair refusal (phase-07)
- The docs prose, the skill and NEXT_STEPS (phase-08)
- The versioned `phax ls --json`, transcripts and the records' review fields (plan 3)

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

Say where executePlan closes a held stop, what it reads before `RunResumeRequested`, and where it writes the record. Give the closed-stop re-entry's conditions and how it writes the record only once. Say whether the cleanup re-entry needed a record guard. Say how a later prompt reads a held stop, and how the global reconciliation merges corrections. Give the exact `--hold` option text, the parse step's place in `runRun`, the dry-run line and the new exit-13 meaning. Confirm that `phax resume` has no `--hold`, and say whether the e2e snapshot was written. Explain any deviation from the planned file lists.

### Commit subject

`feat(hold): run and close held phases with phax run --hold`

### Commit body

phax run accepts --hold (every headless phase but the final one), --hold
oracle, or a list of phase ids. It refuses a malformed value with exit 1
and records the resolved hold. phax resume closes a held stop, writes the
phase's record once naming the phase commit, runs the cleanup, and starts
the next phase from the branch tip in the same invocation. A close
interrupted before its cleanup finishes on the next resume. Later phases
read every closed stop, held or declared, under Review corrections.

---

## phase-07 — Reviews inside an oracle pair: the authored re-run, the latest authored commit and the held discharge {#phase-07-oracle-pair-reviews}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high
**Assignment reason:** The phase designs the oracle step of a close, its recovery from a landed commit, and the choice of the latest authored commit across the gate, the close, reset and lint. oracle-phases' code does not show that design yet.

Let a person review an oracle phase's tests before their discharge. A declared interactive phase may sit inside an oracle pair, and `--hold oracle` and holds of pair phases are accepted. A stop before the discharge whose corrections change one of the pair's oracle files re-runs the `authored` oracle step as the closing gate's last step, even when the close is finished from a commit that already landed. The discharge judges the latest commit that passed `authored`. A held discharge closes on its configured steps only, and warns about each oracle file it changed. A commit the discharge judges is reset only after the discharge.

### Detailed instructions

- In `src/domain/plan/oracleCheck.ts`, remove the `inside` findings of `interactiveRows` and keep its `role` findings (§5.12 stands). Make the `between` rule skip an interactive phase, so that its optional files may name an oracle file the person may touch. Update the module comment and the rule grouping.
- In `src/domain/hold.ts`, delete the rule marked `INTERIM(oracle-pair-hold)`. `resolveHold` then accepts `oracle` and any phase of a pair.
- In `src/domain/plan/oraclePairs.ts`, add three pure functions. `stopOraclePairs(phases, stopPhaseId)` returns the pairs whose oracle phase index is at most the stop's and whose discharging phase index is greater, so a held discharging phase is never in its own pair's list. `pairsChangedByCorrections(pairs, changedPaths)` returns the pairs whose oracle files intersect the changed paths. `latestAuthoredCommit(pair, phases, statuses)` walks the phases from the pair's oracle phase up to, but not including, the discharge, in plan order. It keeps the last whose status `stop` is closed `corrected` with `oracleStep: authored`, and returns its `reviewCommit` when held or its `commitHash` when declared. Without one, it returns the oracle phase's `commitHash`, or null when that phase noted none.
- In `src/domain/gate/oracleRequest.ts`, add `makeReviewOracleRequest({ pair, phaseId, base })`, returning `{ verdict: 'authored', phase: phaseId, oraclePhase: pair.oraclePhase, base, files }`. `makeOracleRequest` is unchanged.
- In `src/app/closeStop.ts`, `CloseStopInput` gains `phases` and `oracles: { command } | null`. Before the gate, snapshot the worktree and list its changed paths against HEAD's tree, then compute `pairsChangedByCorrections(stopOraclePairs(phases, phase.id), paths)`. With two or more pairs, refuse `close-error` (`gate`), naming both pairs. With one pair and no `oracles`, refuse `close-error` (`gate`), naming the missing provider. With one pair, build the oracle step from `makeReviewOracleRequest`, with `base` read from the oracle phase's status.json, and pass it to `runGates` as its `oracleStep`, which runs after every configured step. After the gate, if the gated tree changes an oracle file of a pair in `stopOraclePairs` that the pre-gate decision did not include, refuse `close-error` (`gate`), naming the file. A failed or refused oracle step is a red gate (`gate-failed`, exit 4). A close whose gate ran the step reports and dispatches `oracleStep: authored`, in `StopCommitted` and in `HeldStopClosed` alike.
- In `finishLandedCommit`, recover the oracle step (review finding 2). Read the landed commit's `Gate-Log` trailer. The step was `authored` when that attempt's `oracleRequestPathFor(<gate log>)` exists and decodes as an `authored` request naming the stopped phase, and the close's gate attribution (`review-gate/gate-attribution.json` at a held stop, the phase folder's at a declared one) records the oracle step as passed. Otherwise it was `none`. Report and dispatch that value.
- q-discharge-oracle-edit (decided: flagged). At a held discharging phase, compute the oracle files of the pair it discharges that the corrections changed. The held corrected `CloseReport` variant gains `unjudgedOracleFiles: readonly string[]`. `renderStopClosed` prints one warning per file: `<file>: an oracle file changed at the discharge; the discharge was judged before the stop, so the oracles provider does not see this change`. The close refuses nothing and writes no persisted field.
- The trace of unjudged oracle edits (review finding 8). Add a semantic event `oracle.edits.unjudged { runId, operationId, files }` to `src/domain/telemetry/events.ts` with its maker, its schema in `src/schemas/telemetryEvents.ts`, its projection in `src/domain/telemetry/snapshot.ts`, and its mapping in `src/infra/telemetry/layer.ts`. Add `traceUnjudgedOracleEdits(ctx, files)` to `src/app/telemetry/stopTelemetry.ts`, which emits it when `files` is non-empty. The held close calls it.
- In `src/app/executePlan.ts`, `oracleCommitOf(pair)` reads the statuses of the pair's phases (status.json facts only, never git) and returns `latestAuthoredCommit`, keeping `OracleCommitMissingError` when that is null. Pass `phases` and the configured oracles command to `closeStop`.
- In `src/app/resetPhase.ts`, extend the discharge rule. A target phase whose closed `stop` has `oracleStep: authored` is refused while its pair's discharging phase is not `pending`, with the message `Cannot reset '<phase>' of run '<run>': its discharging phase '<discharge>' is <state>, and the discharge judges this phase's commit.` Find the pair with `stopOraclePairs`.
- In `src/cli/commands/resume.ts`, refuse `--skip-oracle` with exit 1 when the run is `awaiting_review`: `--skip-oracle: <run> awaits review at <phase>; a close's authored oracle step is never skipped. Undo the oracle-file correction, or reset the stop.`
- Build the oracle fixtures as a made-up `./fake-oracles` script in the test's temporary repository. It records each request on disk and answers a checked report with no finding, or a failing one when told to.

### Planned files to create

- `tests/integration/oraclePairReview.test.ts`

### Planned files to edit

- `src/domain/plan/oracleCheck.ts`
- `src/domain/hold.ts`
- `src/domain/plan/oraclePairs.ts`
- `src/domain/gate/oracleRequest.ts`
- `src/app/closeStop.ts`
- `src/app/executePlan.ts`
- `src/app/resetPhase.ts`
- `src/cli/commands/resume.ts`
- `src/cli/commands/stopOutput.ts`
- `src/app/telemetry/stopTelemetry.ts`
- `src/domain/telemetry/events.ts`
- `src/domain/telemetry/snapshot.ts`
- `src/schemas/telemetryEvents.ts`
- `src/infra/telemetry/layer.ts`
- `tests/unit/oracleCheck.test.ts`
- `tests/unit/oraclePairs.test.ts`
- `tests/unit/oracleRequest.test.ts`
- `tests/unit/hold.test.ts`
- `tests/integration/holdPreflight.test.ts`
- `tests/integration/resetPhase.test.ts`
- `tests/integration/holdCli.test.ts`

### Optional files that may be edited

- `src/app/gates.ts`
- `src/domain/errors.ts`
- `src/schemas/oracleRequest.ts`
- `packages/schemas/snapshots/oracle-request/next.schema.json`
- `tests/unit/cli/resume.test.ts`
- `tests/integration/oraclePhases.test.ts`
- `tests/integration/lintPlan.test.ts`
- `tests/integration/heldStopClose.test.ts`
- `tests/helpers/heldRunFixture.ts`
- `tests/unit/planningSkillOracles.test.ts`

### Boundary contracts

Close → oracles provider: a close sends at most one `authored` request, in oracle-phases' unchanged `oracle-request` format, naming the stopped phase as `phase`. It goes out only after every configured step passed, and a failed verdict returns the stop to the person. The oracles command runs only from phax, and is in no grant, frozen command set or prompt. Status facts → discharge: the discharge's `oracleCommit` comes only from status.json (`stop.oracleStep`, `stop.reviewCommit`, `commitHash`), never from git. Lint → plan authors: an interactive phase may sit inside a pair and name an oracle file among its optional files, and still takes no oracle role. Close → telemetry: an unjudged oracle edit at a held discharge is one `oracle.edits.unjudged` event naming the files.

### Test strategy

- an interactive phase between a pair, even with an oracle file among its optional files, gets no `oracles` finding, while one in an oracle role still does; oracle-phases' case 'Lint rejects an interactive phase inside the pair' is inverted — small · table · the expected findings · in-phase · §8 A declared review between the pair is allowed and moves the oracle commit
- `stopOraclePairs` includes a stop at the oracle phase or strictly between, and excludes one at the discharge; `pairsChangedByCorrections` keeps only intersecting pairs — small · table · the expected pairs · in-phase
- `latestAuthoredCommit` gives the oracle commit with no stop, a declared authored stop's commit, and a later held authored stop's review commit over it, and ignores an unchanged or `none` stop — small · table · the expected commit per status set · in-phase
- `makeReviewOracleRequest` builds the authored request naming the stopped phase — small · example · the expected request · in-phase
- `--hold oracle` on the four-phase variant records `{ selection: oracle, phases: [phase-02] }`, and pair phases now resolve with no finding — medium · example · run-status and findings · in-phase · §8 The hold is resolved and recorded when the run is named
- held oracle phase-02 whose correction changes an assertion in tests/export/invoiceRow.test.ts ends its closing gate with an authored request (phase and oraclePhase phase-02, base phase-01's full commit), and phase-03's discharged request names the review commit as `oracleCommit` — medium · example · the requests `./fake-oracles` recorded · in-phase · §8 A held oracle phase is judged again when its review changes an oracle file
- the same run whose correction changes only src/export/invoiceRow.ts sends no request at closing, and phase-03's `oracleCommit` is C2 — medium · example · the recorded requests · in-phase · §8 A held oracle phase is judged again when its review changes an oracle file
- the five-phase variant with declared phase-03 between oracle phase-02 and discharge phase-04 lints clean. phase-03's close ends with an authored request naming phase-03, and phase-04's `oracleCommit` is phase-03's commit — medium · example · lint output and the recorded requests · in-phase · §8 A declared review between the pair is allowed and moves the oracle commit
- the held discharge phase-03: unchanged sends no request and closes unchanged; `toBe(120)` changed to `toBe(100)` sends no request, commits the change and prints the unjudged warning with its trace event; a correction that breaks a configured step exits 4 with no fix attempt and nothing committed — medium · table · requests, output, trace and exit code per case · in-phase · §8 A held discharge closes on its configured steps
- a failing authored verdict at a close exits 4 and keeps the stop — medium · example · exit code and state · in-phase
- an authored close interrupted after its review commit, finished by the next close, still reports `oracleStep: authored`, and the discharge names that commit — medium · example · status.json stop and the discharged request · in-phase
- corrections touching two pairs' oracle files, and a gate step that writes an oracle file, are each refused as close-error gate naming the pairs or the file — medium · example · the refusal · in-phase
- a declared phase-03 that ran authored is not reset once phase-04 has started, and `phax resume --skip-oracle` on a run awaiting review exits 1 — medium · example · refusal messages and unchanged state · in-phase

### Implementation order

1. the oracles check change and the hold rule removal, with their unit tests
2. the pure pair helpers and the review request
3. closeStop's pre-gate decision, its oracle step and its refusals
4. finishLandedCommit's recovery of the oracle step
5. executePlan's latest authored commit and the close wiring
6. the unjudged-edit warning and its telemetry event
7. the reset extension and the --skip-oracle refusal
8. the integration tests

### Excluded scope

- Changing the `oracle-request` or `gate-report` formats
- An interactive phase taking an oracle role (§5.12 stands)
- Docs and the planning skill (phase-08)

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

Give the removed and changed rules in `src/domain/plan/oracleCheck.ts`, and the signatures of `stopOraclePairs`, `pairsChangedByCorrections`, `latestAuthoredCommit` and `makeReviewOracleRequest`. Say where the close decides on the oracle step, and give its three refusals with their messages. Say how `oracleStep: authored` reaches status.json, including from `finishLandedCommit`. Say how executePlan picks `oracleCommit`. Give the unjudged-edit warning and the `oracle.edits.unjudged` event's shape, the reset extension's message and the `--skip-oracle` refusal. Explain any deviation from the planned file lists.

### Commit subject

`feat(oracles): judge a review inside an oracle pair before its discharge`

### Commit body

An interactive phase may now sit inside an oracle pair, and --hold oracle
holds oracle phases. A stop before the discharge whose corrections change
an oracle file re-runs the authored oracle step as its closing gate's last
step, naming the stopped phase, even when the close finishes from a landed
commit. The discharge judges the latest commit that passed it, read from
status.json. A held discharge closes on its configured steps only and
warns about each oracle file it changed, and a commit the discharge
judges is reset only after the discharge.

---

## phase-08 — Docs and the planning skill for the hold and oracle-pair reviews {#phase-08-docs-and-skill}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

Tell operators, planners and review-UI authors how a held stop works. The README covers `--hold`, the held stop and its close, and reviews inside an oracle pair, and drops its not-in-this-release wording. The oracle guide covers the review inside a pair. The planning skill allows an interactive phase inside a pair and names `--hold`. The CLI help, the upgrade notes and NEXT_STEPS follow.

### Detailed instructions

- In README.md `### Interactive phases`, add the hold after the declared stop, with the made-up invoice-export example. Cover: `phax run --hold`, `--hold phase-02,phase-04` and `--hold oracle`, and when to prefer each over declaring a phase; that the hold is fixed for the run and no configuration key sets it; that the final phase never holds; what the run does at a held phase (commit, validated handoff, no agent turn, `awaiting_review (held)`, exit 13, no waiting for input); the builder session as the default continue, and `--new-session`; and closing with `phax resume`. For the close, cover the gate first, `correction-handoff.md` beside the phase's handoff, one review commit on the phase commit with `Held-Phase:` and the person as author, and no commit when nothing changed.
- In the same section, also cover: a commit of your own is refused with `reset --soft <phase commit>`; the closing turn resumes the builder read-only, and on codex the read-only override is the provider's to honour, because codex may keep a rollout's own sandbox on resume; `phax reset-phase` discards the phase commit and holds the phase again; the phase's record is written at closing, names the phase commit, and does not cover the review commit until the records' review fields land; and a resume finishes a hold or a close that was interrupted. Then cover reviews inside an oracle pair: the `authored` re-run, the latest authored commit, and the held discharge closing on its configured steps with its warning.
- In README.md, remove 'This release does not allow one between the two phases of an oracle pair.' Rewrite the 'Not part of this release' paragraph to name only plan 3's items: the versioned `phax ls --json` run list, captured transcripts, and the records, compliance review and PR body of a stop. Keep the statement about the cost ledger. In README.md `### Oracle provider`, replace the '`--hold oracle`, coming with interactive phases' wording with the shipped behaviour.
- In `docs/oracle-phases.md`, replace 'no interactive phase sits in between or takes a role' with the new rule: an interactive phase may sit in between, and takes no role. Add a section `## Reviewing oracles before the discharge`. Cover `--hold oracle` and a declared review inside a pair; the `authored` request naming the stopped phase; `oracleCommit` as the latest commit that passed `authored`; the held discharge closing on its configured steps only, with its warning; the reset rule; and `--skip-oracle` refused at a stop.
- In `.claude/skills/phax-planning/SKILL.md`, `## Interactive phases`: replace 'In this release it may not sit inside an oracle pair, and it never takes an oracle role' with: it may sit inside an oracle pair, where a person reviews the oracles before their discharge and phax judges them again, and it never takes an oracle role. Extend the declaration rule, per spec §5.10: declare one directly after the first phase that sets a pattern, never by default, since the operator can hold any other phase with `phax run --hold`. In `## Oracle phases`, replace 'no interactive phase sits in between or takes an oracle role' with 'an interactive phase may sit in between, and never takes an oracle role'. Update the Lint section's summary of the `interactive` and `oracles` checks to match. This edit needs `phax run --allow-skill-edits`.
- In `src/cli/cliDocs.ts`, update the long help. `run`: `--hold`, its three forms, the `hold` preflight (exit 11), a malformed value (exit 1) and the dry-run line. `resume`: closing a held stop, the finish of an interrupted hold or close, and `--skip-oracle` refused at a stop. `enter-phase`: the builder session at a held stop. `session-info` and `ls`: a held stop. `reset-phase`: discarding a held phase's commit, and the authored-commit rule. Then run `pnpm gen:usage-spec` and `pnpm docs:cli`.
- In `docs/upgrading.md`, under `### 0.26.0`, add one bullet: `run-status.json` gains a required `hold`. Scripts that read it find `{ selection: none }` on every run not started with `--hold`, and runs written by older releases read as `none`. Nothing to run.
- In `NEXT_STEPS.md`, under `interactive-phases`, record plan 2 of 3 (`phax run --hold`, the held stop and the oracle-pair reviews) as landing with this run, naming its plan file, and keep plan 3 as next. Update the gaps: stops have no review fields in their records until plan 3; `records explain` on a review commit finds no record until plan 3; on vibe, a held phase's record counts the closing turn in its usage; and the cost ledger still covers Claude Code turns only.

### Planned files to create

- (none)

### Planned files to edit

- `README.md`
- `docs/oracle-phases.md`
- `.claude/skills/phax-planning/SKILL.md`
- `src/cli/cliDocs.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `docs/upgrading.md`
- `NEXT_STEPS.md`

### Optional files that may be edited

- `docs/cli/inventory.md`
- `docs/security.md`
- `tests/unit/skills.test.ts`
- `tests/unit/planningSkillOracles.test.ts`
- `tests/unit/authoringPrompt.test.ts`

### Test strategy

- the generated usage spec and CLI reference match the CLI's options and long help — medium · contract · the usage-spec and CLI-docs drift suites · in-phase
- the README's exit-code table matches EXIT_CODE_MEANINGS — small · example · the README exit-code test · in-phase
- the planning skill allows an interactive phase inside an oracle pair, names `phax run --hold`, and still forbids an oracle role — small · example · the skills and planning-skill tests · in-phase · §8 The planning skill says when and how

### Implementation order

1. cliDocs long help and regeneration
2. the README sections and the stale-wording sweep
3. docs/oracle-phases.md
4. the planning skill
5. docs/upgrading.md and NEXT_STEPS

### Excluded scope

- docs/upgrading.md for `phax ls --json` (plan 3)
- Documenting the run list, transcripts or the records' review fields as available (plan 3)
- Any code change other than `src/cli/cliDocs.ts`

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

List each README, oracle-guide and skill section added or changed, and every stale statement removed, with its location. Confirm that the usage spec and the CLI docs were regenerated, and that the skill now mentions `phax run --hold` and allows an interactive phase inside an oracle pair. Confirm that the README's not-in-this-release paragraph names only plan 3's items, and that it states the codex read-only caveat. Explain any deviation from the planned file lists.

### Commit subject

`docs(interactive): document held stops and reviews inside an oracle pair`

### Commit body

The README explains phax run --hold, a held stop and its close with a
review commit on the phase commit, the codex read-only caveat, and reviews
inside an oracle pair. The oracle guide covers the authored re-run, the
latest authored commit and the held discharge. The phax-planning skill
allows an interactive phase inside a pair and points at --hold. The CLI
help, the 0.26.0 upgrade notes and NEXT_STEPS follow.
