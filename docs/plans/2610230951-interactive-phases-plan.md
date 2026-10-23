---
status: Draft
source-spec: docs/specs/2610211403-interactive-phases.md
completes-spec: false
---
# Held stop and oracle-pair reviews

Plan 2 of 3 for the interactive-phases spec (`docs/specs/2610211403-interactive-phases.md`).

After this plan, the operator can hold a run with `phax run --hold`, `--hold phase-02,phase-04` or `--hold oracle`:
- Each selected headless phase stops in `awaiting_review` with cause `held`, once it has committed and its handoff is validated. The stop comes before the phase's record and its cleanup, and no agent turn runs.
- The person reviews the phase in the builder's own session, by hand, or with any agent.
- `phax resume` gates the worktree first. It takes the person's `.phax-context/correction-handoff.md`, or the handoff of a read-only closing turn, and leaves one review commit with a `Held-Phase:` trailer on top of the unchanged phase commit (no commit when nothing changed).
- It then writes the phase's record once, runs the cleanup and continues.

A review may now sit inside an oracle pair:
- A stop before the discharge whose corrections change an oracle file re-runs the `authored` verdict as the last step of its closing gate.
- The discharge judges the latest commit of the pair that passed `authored`.
- A held discharge closes on its configured steps only.

Plan 1 (PR #157, `docs/plans/archive/2610220954-interactive-phases-plan.md`) landed the declared stop. This plan extends its code to the held cause: one close, one seed writer and one stop document, never a second copy beside them. Plan 3 adds:
- the versioned `phax ls --json` run list;
- transcript capture;
- the records' review fields;
- the compliance review, the review handoff and the PR body around a stop.

The order runs from the core to the surface:
- phase-01: the hold's grammar and resolution, the `hold` preflight step and the recorded hold;
- phase-02: the held cause in the state machine and in the stop's formats;
- phase-03: reaching a held stop, and the commands on a held run;
- phase-04: closing a held stop, as a use case;
- phase-05: the run loop, later prompts, the record at closing and `phax run --hold`;
- phase-06: reviews inside an oracle pair;
- phase-07: the docs and the planning skill.

`--hold` stays unregistered until phase-05, so no earlier commit lets an operator start a hold that phax cannot close. Until phase-06:
- the `hold` check refuses any phase of an oracle pair;
- the `oracles` check still refuses a declared phase inside a pair.
So no review touches an oracle without the `authored` re-run.

phase-07 edits `.claude/skills/phax-planning/SKILL.md`, so run this plan with `phax run --allow-skill-edits`.

Test rules:
- Fixtures are made up: the invoice-export, credit-notes and payments-fix runs, Ada Example, `./fake-oracles` and the session ids.
- Fake provider CLIs run from a temporary bin directory under a test HOME (`tests/helpers/fakeProviderCli.ts`).
- Tests never read `~/.phax`, through HOME or through a loader. They mock `loadProviderConfig` and its siblings, as the stopped-run suites do.
- Tests assert `$schema` URLs by format id and release pattern.

No agent prompt this plan writes mentions how to stop a run.

## Required commands

- `pnpm exec tsx`
- `pnpm gen:usage-spec`
- `pnpm docs:cli`

`security.agentCommands` in `phax.json` already allows every command above, so no configuration change is needed. They are declared so the preflight confirms it.
- `pnpm exec tsx` regenerates the schema snapshots (`pnpm exec tsx scripts/schemas-check.ts --write`).
- `pnpm gen:usage-spec` regenerates `phax.usage.kdl`.
- `pnpm docs:cli` regenerates `docs/cli/`.

## Technical arbitrations

- Persisted shapes change in place. 0.26.0 is uncut: `src/schemas/release.ts` stamps run-status, phase-status, review-stop and interactive-session at `0.26.0` with `next` snapshots, and `packages/schemas/history.lock.json` freezes none of them at 0.26.0. So:
  - no new frozen decoder is written;
  - `pnpm exec tsx scripts/schemas-check.ts --write` rewrites each `next.schema.json`;
  - the 0.17.0 and pre-schema run-status lifts, in `src/schemas/persisted.ts` and in `toLatestRunStatus` (`packages/schemas/src/formats/runDirectory.ts`), gain `hold: { selection: "none" }`, because no earlier phax could hold a run;
  - a run-status stamped 0.26.0 without `hold`, which only an unreleased development build wrote, is refused, never decoded as optional.
  Loss accepted: a run started by a development build of 0.26.0 before this plan does not resume.
- Explicit per-variant shapes:
  - run-status `hold` has four variants, one struct per `selection`: `none` with no other key, and `all`, `listed` and `oracle`, each with `phases` (non-empty, in plan order).
  - A phase status's `stop` has six variants. `null` stays for a phase that never stopped.
    - declared waiting;
    - declared closed `corrected`, with `oracleStep`;
    - declared closed `unchanged`;
    - held waiting;
    - held closed `corrected`, with `reviewCommit` (a full sha) and `oracleStep`;
    - held closed `unchanged`.
    `oracleStep` is exactly `authored | none`: whether the close's gate ended with an `authored` oracle step, which then passed, since the close committed. phase-06 writes `authored`; until then every close writes `none`.
  - review-stop is a union of two variants:
    - declared: `phase.mode: "interactive"`, `firstReading`, session origin `first-turn | new-session`;
    - held: `phase.mode: "headless"`, `phaseCommit` (full sha), session origin `builder | new-session`, and no `firstReading`.
  - interactive-session's `Session` and `turnInProgress` origins gain `builder`. A first turn's origin stays `first-turn | new-session`, because no first turn is the builder.
- The hold grammar. `phax run` registers `--hold [selection]`, so commander gives `true` for a bare `--hold` and a string otherwise. `parseHoldValue` in `src/domain/hold.ts` reads it before the config or the plan is read. Its rules:
  - `true` means every headless phase but the final one;
  - exactly `oracle` is the one keyword;
  - otherwise the value is a comma-separated list of distinct phase ids, each `phase-` followed by two or more digits, with no empty item and never mixed with `oracle`.
  Any other value exits 1 before the run is named, naming the value and the three accepted forms. When the value is one word that is neither `oracle` nor a phase id, a second line adds `(put the run's name before --hold, or write --hold=<selection>)`. That word is a run name commander read as the selection (`phax run --hold invoice-export --plan …`).
  `phax resume` registers no `--hold`, so commander refuses it as an unknown option with exit 1.
  No configuration layer carries a hold. The existing unknown-key refusal (`onExcessProperty: "error"` on phax.json and the user overlays) already exits 2; a test proves it rather than code adding a refusal.
- Where the `hold` check sits. It is not in RUN_PREFLIGHT_CHECKS, because `phax resume` re-runs that set and the recorded hold was resolved when the run was named. It is a step of `freshRunPreflight` (`src/app/runPreflight.ts`): after the shared set, so after `interactive-phases`, and before the clean-tree check. `FreshRunPreflightStep` gains `hold`. `phax plans lint` never runs it, because a hold belongs to a run, not a plan.
  It fails with `HoldPreflightError` (exit 11), printing `Hold preflight failed: N error(s).` and every error, each with its phase, or `-` for a selection-wide error. Message wording follows the spec's §6 examples.
- Where the hold is read at run time. `createRunFolder` gains a trailing `hold` parameter, which defaults in memory to `{ selection: "none" }`; the field is always written. `executePlan` reads the run's `hold` from `run-status.json`, through `readRunStatusFile`, once at its start. So `phax run` and every `phax resume` hold exactly the recorded phases, and no caller can pass another.
  `phax run --dry-run` resolves the hold and prints one line: `Hold: none`, `Hold: all — phase-01, phase-02, …`, and so on. When the `hold` check reports errors, it prints them under that line. The dry run still exits 0 and names no run, as it does for the other checks it skips.
- Where a held phase stops. Its gate passes (gate-attribution.json is written), then it commits and reconciles. Its handoff is validated and copied, and the pulled briefs are closed. The stop comes after all of that, and before `writeRecordForPhase`, the agent binding's `completed` patch and the cleanup commands.
  The stop happens only when:
  - the phase is in the recorded hold;
  - it is not the final phase, which the preflight already excludes;
  - its status `stop` is still `null`, so a re-entry after the stop has closed never stops again.
  A held phase that pauses earlier (rate limit, gate, handoff or commit) resumes through today's re-entry paths and stops when it reaches this point.
  No agent turn runs at a held stop. The builder session is read from the phase's `agent-binding.json`: provider, model, effort and the session id the headless stream reported. It is recorded as current with origin `builder` and with the phase status's `createdAt` as `startedAt`, or as no session when the binding holds no id.
- Reducer events:
  - `ReviewStopReached` carries a review-stop value whose `cause` must equal the event's. A `declared` stop is accepted only from running/{running} and a `held` stop only from running/{committed}; any mismatch is `unexpected`.
  - `StopCommitted` keeps closing declared stops. Its `outcome` becomes `closure: { outcome: "corrected", oracleStep } | { outcome: "unchanged" }`. It is `unexpected` on a held stop.
  - The new event `HeldStopClosed { phaseId, phaseCommit, closure: { outcome: "corrected", reviewCommit, oracleStep } | { outcome: "unchanged" } }` moves running/{awaiting_review, held} to running/{committed, hash: phaseCommit}. Its effects are PersistState (state `committed` and the closed held `stop`) and DiscardReviewStop.
  There is no RecordCommitMetadata: `commitHash` stays the phase commit, and the review commit lives only in `stop.reviewCommit`. Every other event keeps plan 1's verdict on awaiting_review for both causes.
- One close, two causes. `closeDeclaredStop` in `src/app/closeStop.ts` becomes `closeStop`, one sequence that reads the cause from the parked review-stop document. A held close differs in seven ways:
  - **Base.** At the first close, HEAD must be the phase commit (status.json `commitHash`), not the phase base. Otherwise the close is refused as `close-error` (`commit`), naming `git -C <worktree> reset --soft <phase commit>`.
  - **Gate files.** The gate's files go to `<phase folder>/review-gate/`: `checks-attempt-NN.log` numbered within that folder, its per-attempt siblings, and `gate-attribution.json`. So the agent's attempt files and attribution are never touched.
  - **Handoff.** It is written to `correction-handoff.md`; `phase-handoff.md` is never written.
  - **Diff.** It is saved as `review-diff.patch`; `diff.patch` is never written.
  - **Commit.** A corrected close commits the gated tree with `commitTree`, using the plan's subject. Its body ends with the trailers `Run-Id`, `Short-Name`, `Phase-Title`, `Held-Phase: <phase id>`, `Worktree` and `Gate-Log`. An unchanged close makes no commit.
  - **Reconciliation.** It is written to `correction-reconciliation.json` and `.md`, in the `phase-file-reconciliation` format, with every changed path under `reviewCorrections` (reviewed against the phase commit). `file-reconciliation.json` stays byte-identical. An unchanged close writes the empty review reconciliation without running git.
  - **Re-entry.** A close interrupted after its commit is finished when HEAD's parent is the phase commit and HEAD carries this run's `Run-Id` and `Held-Phase: <phase>`.
  The closing turn gets the corrections as `diffTrees(<phase commit tree>, <gated tree>)`, cut at plan 1's 200 000-byte limit. Every failure returns the run to the stop through `StopCloseRefused`, as at a declared close.
- The held seed embeds the phase's `file-reconciliation.md`, so the person sees which files were planned and which deviated without opening the run folder. It points to `.phax-context/plan.md` for the full plan, as the declared seed does.
- Later prompts. `## Review corrections` holds every earlier closed stop, declared or held, in plan order:
  - each stop's heading reads `### <phase> (held)` or `### <phase> (interactive)`;
  - a held stop contributes its `correction-handoff.md` and its `correction-reconciliation.json`'s `reviewCorrections`;
  - a declared stop contributes its `phase-handoff.md` and its `file-reconciliation.json`'s.
  `readReviewCorrections` selects stops by their status `stop`, not by `mode`.
  After a held phase, `## Previous phase handoff` is the held phase's own builder handoff, because a held phase is headless (q-held-handoff `correction-beside`). The correction reaches the next phase only through `## Review corrections`. The global reconciliation merges a held phase's correction reconciliation into that phase's entry, so its files read `review-corrected` and are never unplanned.
- Commands at a held stop:
  - `phax ls`, `phax session-info`, `phax path`, `phax shell` and `phax open` work from review-stop.json as at a declared stop. `session-info` names the phase `headless, committed <short sha>`.
  - `phax enter-phase` continues the builder session (q-held-session `builder-default`). `--new-session` runs a read-only first turn whose session becomes current. It refreshes review-stop.json by patching only `session` and `commands.continue` of the document as it stands, so the held variant and its `phaseCommit` survive.
  - `phax reset-phase`'s preview at a held stop names the phase commit it discards; deleting the phase branch already removes that commit.
  - archive and adjust-plan keep plan 1's refusals.
- Interim refusals keep main honest between phases:
  - Until phase-03 wires the stop, executePlan reads the hold and never stops.
  - Until phase-05 wires the close, `--hold` is unregistered. A test-built run that reaches a held stop and is resumed fails before `RunResumeRequested`, naming that this phax cannot close a held stop yet, and changes nothing.
  - Until phase-06, the `hold` check refuses every phase that lies from an oracle phase through its discharging phase, so `--hold oracle` is always refused, and the `oracles` check still refuses a declared phase inside a pair.
  Loss accepted: between phase-05 and phase-06, a bare `--hold` on a plan with an oracle pair is refused rather than holding the other phases.
- The oracle step at a close (phase-06):
  - **Which pairs.** A stop sits in a pair when its index lies from the pair's oracle phase up to, but not including, its discharging phase. A held discharging phase is never judged again for the pair it discharges (q-held-discharge `no-oracle-step`).
  - **When it runs.** The close decides from a snapshot taken before the gate, compared with HEAD's tree. It runs the `authored` step, as the gate's last step after every configured step has passed, for the one pair whose oracle files that snapshot changes. The request is `{ verdict: "authored", phase: <stopped phase>, oraclePhase, base: <oracle phase's base from its status>, files }`; the oracle-request format does not change.
  - **A gate step that writes an oracle file.** If the gated tree changes an oracle file the pre-gate snapshot did not, the close is refused as `close-error` (`gate`), naming the file. The next close sees it and judges it.
  - **Two pairs.** If one stop's corrections change the oracle files of two pairs, the close is refused as `close-error` (`gate`), naming both pairs, because one gate attempt carries one oracle request. Loss accepted: a person who corrects the oracles of two overlapping pairs at one stop must undo one of the corrections, or reset the stop.
  - **The discharge's commit.** The discharge's `oracleCommit` is `latestAuthoredCommit`, read from status.json facts only. It is the last phase in plan order, from the oracle phase up to the discharge, whose closed stop has `oracleStep: "authored"`: its `reviewCommit` when held, its `commitHash` when declared. Without one, it is the oracle phase's `commitHash`.
  - **Reset.** A phase whose closed stop has `oracleStep: "authored"` is not reset while its pair's discharge has started, like the oracle phase itself.
  - **`--skip-oracle`.** `phax resume --skip-oracle` on a run awaiting review is refused with exit 1, because a close's `authored` step is never skipped. Loss accepted: when the oracles provider is broken, the person undoes the oracle-file correction or resets the stop.
- Exit codes:
  - a malformed `--hold`: 1;
  - `HoldPreflightError`: 11;
  - `phax resume --hold`: 1 (commander);
  - a refused held close: plan 1's lastClose exit codes, unchanged.
  EXIT_CODE_MEANINGS row 13 becomes `Awaiting review at an interactive or held phase (resumable)` in phase-05, when holds become reachable. The README row and the generated docs follow.
- Telemetry. The held stop and its close reuse `src/app/telemetry/stopTelemetry.ts`: `tracedCloseGate` (which covers the closing oracle step), `tracedReviewCommit`, `tracedTurnCall` and `tracedStep`. The reducer's `review.stop.reached` trace carries `cause: held`.
  `tests/e2e/semanticTrace.heldStop.test.ts` pins a held stop's trace next to the declared one. Like every e2e suite, it runs only with `PHAX_E2E_RUN=1`, so the standard gate skips it. Its snapshot is written by one run with that variable set.
- Output wording follows the spec's §6 indicative examples for the hold refusals, the held stop, the held close and the reset preview.

## Open questions

### q-held-closing-posture — At a held stop, the closing turn resumes the builder session, the agent that wrote the phase with write access and its frozen agent commands (spec §5.50). Which posture does that resumed turn carry on each provider?

- read-only-resume — Resume the builder under the declared closing turn's posture. Claude Code gets its reading tools with no shell (q-turn-shell `no-shell`). codex gets `exec resume` with `sandbox_mode="read-only"` and `approval_policy="never"`. mistral-vibe keeps the phase posture (q-vibe-turns `phase-posture`). The worktree comparison and the handoff-file check run after every turn. — abandons: Certainty on codex. phax has verified read-only `exec resume` only for sessions that started read-only. If a rollout started with `workspace-write` keeps its own sandbox over the `-c` override, the resumed builder could write outside the worktree, where no comparison looks, during the closing turn. On vibe, the resumed builder has the same write and network reach it had while building, and phax refuses only edits that reach the worktree or the person's handoff file.
- build-posture-resume — Resume the builder under its own build posture: the phase's permission flags and frozen agent commands, as the fork's `phase revise` does, still guarded by the comparison. — abandons: A closing turn that cannot run code. On Claude Code the turn gets Bash for this repository's `node`, `pnpm exec tsx` and `pnpm test:integration`, so it can run any script with the user's rights. It can write outside the worktree and reach the network. It does so inside a turn whose only job is to describe the person's corrections.

Recommendation: read-only-resume — The closing turn only describes corrections a person made, so it needs no writes and no shell. read-only-resume keeps one rule for every phax turn at a stop and follows plan 1's decided verdicts, and the comparison refuses any edit that reaches the commit. phase-04 pins the codex resume argv in a test, so the open point is narrowed to codex's own handling of the override. build-posture-resume would make the turn as powerful as the builder, for no gain in the handoff.

### q-held-record — A held phase's record is written once, at closing (spec §5.69, q-held-record `at-close`), while plan 3 adds the record's review fields. By then the phase folder also holds the stop's files: the seed, interactive-session.json, correction-handoff.md, the closing turns' streams, `refused-turn-NN/`, `review-gate/`, review-diff.patch and the correction reconciliation. A record carries every file of its folder. What does this plan's record at closing carry, so that no record claims the agent wrote the review?

- agent-record-only — Write the record the phase would have written at its commit. Its `sourceSha` is the phase commit (status `commitHash`, never HEAD), with the builder's provider, model, effort and session, and outcome `committed`. Its artifacts are the phase folder minus the stop's files, by a pure `isStopArtifact` filter. The review commit carries no `Phase-Id` trailer, so `phax records explain` on it finds no record until plan 3. — abandons: The review on the records branch until plan 3. No record holds the correction handoff, the closing gate or the review commit, and `phax records explain <review commit>` answers that it found no record. §5.69's `records explain` on the review commit lands only with plan 3.
- whole-folder — Write the record from the folder as it stands at closing, and give the review commit a `Phase-Id` trailer so that `records explain` finds the record from either commit. — abandons: An honest and private record. The closing turns' streams, which hold the corrections' diff and the turn's session content, land on the records branch even when `records.transcript` is false. The correction handoff and the closing gate's logs sit under a manifest naming the builder session's provider and model. `records explain <review commit>` shows the agent's record as that commit's record.
- defer — Write no record for a held phase until plan 3, as plan 1 did for a declared phase. — abandons: §5.69 in this release. The records branch has a gap at every held phase between plans 2 and 3, so the agent's committed work there is unrecorded, although an agent session wrote it.

Recommendation: agent-record-only — The record describes exactly what the agent did, and the commit it names is the one the agent's gate passed. The stop's files and the review commit reach no record until plan 3 gives them fields of their own. whole-folder breaks the `records.transcript` toggle and credits the agent with the review. defer leaves the agent's own work unrecorded, though the spec asks for its record.

### q-discharge-oracle-edit — At a held discharging phase, the closing gate runs only the configured steps (q-held-discharge `no-oracle-step`). A correction there that weakens an oracle assertion is never seen by the oracles provider, whereas the same correction at a stop before the discharge is judged `authored` again. Does a held discharge's close say so when its corrections change an oracle file?

- flagged — The close goes on under the configured gate alone. It prints one warning per oracle file the corrections changed, saying the discharge was judged before the stop and the change is not judged again, and the close's trace records those files. — abandons: A quiet close. Every deliberate correction of an oracle at a discharge prints a warning the person already knows about, and nothing blocks it.
- silent — The close goes on under the configured gate alone, with no message beyond the usual close lines. — abandons: Telling the person that the provider did not see the change. A weakened assertion at a held discharge lands with nothing in the output or the trace to set it apart from any other correction, though the same edit one stop earlier would have been judged again.

Recommendation: flagged — The operator chose to let the configured gate alone close a held discharge. A warning keeps that choice and makes the one asymmetry with earlier stops visible at the moment it applies. It refuses nothing and writes no persisted field.

---

## phase-01 — The hold's grammar and resolution, the hold preflight step and the recorded hold {#phase-01-hold-grammar}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

Define what an operator may ask with `--hold`, resolve it against a plan, and refuse a hold the plan cannot honour before a run is named (exit 11). A run's `run-status.json` records its hold in a required `hold` field. `--hold` itself stays unregistered, so every run still records `{ selection: "none" }`.

### Detailed instructions

- Create `src/domain/hold.ts`. It is pure and has no I/O. It holds four exports.
- `HoldRequest`, what the operator asked: `{ kind: "none" } | { kind: "all" } | { kind: "oracle" } | { kind: "listed"; phases: readonly [string, ...string[]] }`.
- `parseHoldValue(value: true | string): Either<string, HoldRequest>`:
  - `true` gives `all`;
  - exactly `oracle` gives `oracle`;
  - otherwise split on `,`. Each item must match `^phase-\d{2,}$`, no item may be empty, items must be distinct, and `oracle` may not appear in a list.
  On the left, a message naming the value and the three accepted forms:
  - for a mix with `oracle`: `--hold "oracle,phase-02" is not a hold selection: `oracle` stands alone`;
  - otherwise: `--hold "<value>" is not a hold selection: give no value, `oracle`, or phase ids such as phase-02,phase-04`.
  When the value is one word that is neither `oracle` nor a phase id, add a second line: `(put the run's name before --hold, or write --hold=<selection>)`.
- `HoldFinding = { phase: string | null; message: string }`.
- `resolveHold(request, phases)`, where `phases` are `{ id, mode, oracle }` in plan order. It returns `{ hold: RunHold | null; findings: readonly HoldFinding[] }`, with `hold` null whenever there is a finding.
  - `none` → `{ selection: "none" }`.
  - `all` → every phase whose `mode` is `headless` except the final phase. When that is empty: finding `(null, "--hold selects no phase: the plan has no headless phase before its final phase")`.
  - `oracle` → every phase whose `oracle` is not null. When that is empty: `(null, "--hold oracle selects no phase: the plan declares no oracle phase")`.
  - `listed` → for each id, in the order given:
    - absent from the plan → `is not a phase of this plan`;
    - interactive → `is interactive: it already stops for review; remove it from --hold`;
    - final → `is the final phase: it already stays open in review_open`.
    The resolved phases are sorted into plan order.
  - Interim rule, removed by a later phase of this plan: every resolved phase whose index lies from a pair's oracle phase through its discharging phase (`oraclePairs` in `src/domain/plan/oraclePairs.ts`) gets `sits in oracle pair <oracle> → <discharging>: this phax does not hold a phase of an oracle pair yet`. Mark this rule with a comment naming it as interim.
- In `src/schemas/status.ts`, add `RunHoldSchema`, a union of four structs:
  - `{ selection: Literal("none") }`;
  - `{ selection: Literal("all"), phases: NonEmptyArray(phase id) }`;
  - `{ selection: Literal("listed"), phases: … }`;
  - `{ selection: Literal("oracle"), phases: … }`.
  The phase id pattern is `^phase-\d{2}$`. Export `RunHold`. Add the required `hold: RunHoldSchema` to `runStatusFields`, after `allowSkillEdits`, with a description saying it is resolved when the run is named and never changed.
- In `src/schemas/persisted.ts`, the reader of `run-status.json` lifts a document read through the frozen 0.17.0 decoder or the pre-schema decoder with `hold: { selection: "none" }`, the way the phase-status reader lifts `mode` and `stop`. A document at the current stamp without `hold` stays refused.
- In `packages/schemas/src/formats/runDirectory.ts`, `toLatestRunStatus` adds `hold: { selection: "none" }` to a pre-schema or 0.17.0 value, and its comment says why: no phax before this one could hold a run. Run `pnpm exec tsx scripts/schemas-check.ts --write`. It rewrites `packages/schemas/snapshots/run-status/next.schema.json` in place. Create no frozen module, and leave `packages/schemas/history.lock.json` unchanged, because 0.26.0 is uncut. Update the run-status fixture in `tests/unit/schemasPackage/documents.ts`.
- In `src/app/runFolder.ts`, give `createRunFolder` a trailing parameter `hold: RunHold = { selection: "none" }` and always write it into the run status.
- In `src/app/runPreflight.ts`:
  - `FreshRunPreflightStep` becomes `"routing-config" | RunPreflightCheck | "hold" | "clean-tree"`;
  - `FreshRunPreflightInput` gains a required `hold: HoldRequest`;
  - after `runPreflights` and before `checkCleanWorkingTree`, run `resolveHold(input.hold, input.plan.phases)`. On findings, fail with `HoldPreflightError`, whose message is `Hold preflight failed: N error(s).` followed by one line per finding, `  <phase or ->  <message>`;
  - on success, the result gains `hold: RunHold`.
  Leave RUN_PREFLIGHT_CHECKS and `runPreflights` unchanged, so `phax resume` never re-runs the hold.
- Add `HoldPreflightError { message, findings }` to `src/domain/errors.ts`, and map it to exit 11 in `exitCodeForError` in `src/cli/commands/runLayers.ts`.
- In `src/cli/commands/run.ts`, pass `hold: { kind: "none" }` to `freshRunPreflight`, and pass the resolved hold it returns to `createRunFolder`. Do not register `--hold` in `src/cli/program.ts`.
- Create `tests/helpers/runStatusFixture.ts`. It exports:
  - `runStatus(fields)`, the in-memory value with `hold: { selection: "none" }` unless given;
  - `runStatusFile(fields)`, the same value stamped with `currentSchemaUrl("run-status")`.
  Use it in every test that writes a run status at the current stamp or builds a `RunStatus` literal. `pnpm test:type` names the literals; a failing decode names the JSON fixtures.
- Prove that no configuration layer carries a hold. Create `tests/integration/holdConfigRefused.test.ts`:
  - In a temporary repository whose `phax.json` holds `"review": { "holdPhases": true }`, `runValidate` exits 2, naming the unknown key.
  - With `node:os`'s `homedir` mocked to a temporary directory whose `.phax/config.json` holds a top-level `hold`, it also exits 2.
  Change no schema to make these pass. If either is accepted, stop and report it in the handoff.

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
- `tests/unit/persisted.test.ts`
- `tests/unit/cli/resume.test.ts`
- `tests/unit/schemas.test.ts`

### Optional files that may be edited

- `packages/schemas/src/generated/index.ts`
- `src/schemas/release.ts`
- `src/app/dispatcher.ts`
- `src/app/phaxState.ts`
- `src/app/resume.ts`
- `src/app/resetPhase.ts`
- `src/cli/interruptHandler.ts`
- `src/cli/commands/sessionInfo.ts`
- `tests/unit/runPreflight.test.ts`
- `tests/unit/schemasPackage/runDirectoryFormats.test.ts`
- `tests/unit/schemasPackage/currentShapes.test.ts`
- `tests/unit/schemasPackage/parse.test.ts`
- `tests/type/schemasPackage.ts`
- `tests/integration/persistedProducer.test.ts`
- `tests/integration/registry.test.ts`
- `tests/integration/resumePreflightRechecks.test.ts`

### Boundary contracts

CLI → domain: the run command will hand `parseHoldValue` the raw option value and get a `HoldRequest` or a message; the grammar knows nothing of plans. Preflight → domain: `freshRunPreflight` hands `resolveHold` the plan's phases and gets the resolved `RunHold` or findings, before any run state exists. Run folder → readers: `run-status.json` always carries `hold`. Every reader goes through `src/schemas/persisted.ts`, which lifts older stamps with `none`, and `@lbdremy/phax-schemas` gives the same verdict.

### Test strategy

Write `tests/unit/hold.test.ts` first.
- The grammar: `true`, `oracle`, `phase-02,phase-04`, `phase-100` and `--hold=phase-02`'s value are accepted. Each of the following is refused with the three forms named: `phase-2`, `oracle,phase-02`, `phase-02,,phase-04`, `phase-02,phase-02`, `invoice-export` (with the run-name hint) and the empty string.
- Resolution on the made-up six-phase invoice-export plan whose phase-03 is interactive: none, all (`phase-01, phase-02, phase-04, phase-05`), listed (sorted into plan order) and oracle on a variant with an oracle phase.
- Every finding: phase-09 absent, phase-03 interactive, phase-06 final, oracle with no oracle phase, all on a one-phase plan, and the interim pair rule.
`tests/integration/holdPreflight.test.ts` drives `freshRunPreflight` with mocked loaders. It checks:
- each refusal exits 11 through `exitCodeForError`, prints every error with its phase, and writes nothing (no run folder, registry entry or branch);
- a valid request yields the resolved hold.
Add the `hold` row to the step-keyed guard table in `tests/integration/runPreflightBeforeNaming.test.ts`.
Other tests:
- `tests/integration/runFolder.test.ts`: a new run's `run-status.json` carries `{ "selection": "none" }`, and a given listed hold verbatim;
- `tests/unit/persisted.test.ts`: 0.17.0 and pre-schema run statuses read lifted with `none`, and a current-stamp document without `hold` is refused;
- the schemas-package tests check the snapshot and the package lift.

### Implementation order

1. `src/domain/hold.ts` and its unit tests
2. `RunHoldSchema`, the persisted lift and the package lift
3. the snapshot regeneration and the package fixture
4. `createRunFolder`'s hold
5. the `hold` step of `freshRunPreflight`, its error and exit code, and run.ts passing `none`
6. the run-status fixture helper and the broken fixtures
7. the configuration-refusal test

### Excluded scope

- Registering `--hold` on `phax run`, and the dry-run line (phase-05)
- Stopping at a held phase (phase-03)
- Lifting the interim oracle-pair rule (phase-06)
- Any change to `phax plans lint`, which never runs the hold check

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

Give the exact exports of `src/domain/hold.ts`: `HoldRequest`, `parseHoldValue`, `HoldFinding` and `resolveHold`, with their messages, and mark the interim oracle-pair rule. Give `RunHoldSchema`/`RunHold` as written in `src/schemas/status.ts`, the lifts that add `none`, `createRunFolder`'s new parameter, the `hold` step's place in `freshRunPreflight`, its result field, `HoldPreflightError` and its exit code. Say how `tests/helpers/runStatusFixture.ts` is used. Confirm that both configuration layers refuse a hold key with exit 2 and that no schema changed for it. Explain any deviation from the planned file lists, including any listed test that needed no change.

### Commit subject

`feat(hold): resolve and record a run's hold before it is named`

### Commit body

A --hold value is parsed by a pure grammar (no value, oracle, or distinct
phase-NN ids) and resolved against the plan in plan order. A new hold step
of the fresh-run preflight refuses a listed phase that is absent,
interactive or final, or a selection that holds no phase, with exit 11
before the run is named. run-status.json records a required hold, lifted
to none for runs written before it. The option itself is not registered
yet, so every run still records none.

---

## phase-02 — The held cause in the state machine and in the stop's formats {#phase-02-held-cause-state}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** The reducer arms, the event shapes and three persisted formats change together, and the matrix audit must hold for both causes in every cell, so the phase needs more care than the default effort.

Teach the reducer and the stop's persisted formats about a held stop:
- a committed phase can enter `awaiting_review` with cause `held`;
- a held stop closes through its own event, which keeps the phase commit and records the review commit;
- every closed stop records whether its gate ran the `authored` oracle step;
- review-stop.json gains a held variant, and interactive-session.json the `builder` origin.

### Detailed instructions

- In `src/domain/state.ts`, widen `StopCause` to `"declared" | "held"`.
- In `src/schemas/status.ts`, replace `PhaseStopSchema`'s two variants with six explicit structs inside the existing `Schema.NullOr`:
  - `{ cause: "declared", status: "waiting" }`;
  - `{ cause: "declared", status: "closed", outcome: "corrected", oracleStep: "authored" | "none" }`;
  - `{ cause: "declared", status: "closed", outcome: "unchanged" }`;
  - `{ cause: "held", status: "waiting" }`;
  - `{ cause: "held", status: "closed", outcome: "corrected", reviewCommit: FullCommitShaSchema, oracleStep: "authored" | "none" }`;
  - `{ cause: "held", status: "closed", outcome: "unchanged" }`.
  Annotate `oracleStep`: whether the close's gate ended with the `authored` oracle step, which passed since the close committed.
- In `src/schemas/reviewStop.ts`, make `ReviewStopFileSchema` a union of two structs. Both are decoded with `onExcessProperty: "error"`, so each refuses the other's keys.
  - **Declared variant: today's struct**, its session origin `first-turn | new-session`.
  - **Held variant**: `{ $schema, run, state: "awaiting_review", cause: "held", phase: { id, title, mode: "headless", position, of }, phaseCommit: FullCommitShaSchema, worktree, seed, session: { provider, sessionId, origin: "builder" | "new-session", interactiveResume } | null, commands, lastClose, closeBase }`.
  Export `ReviewStop` as the union of the two values without `$schema`, plus `DeclaredReviewStop` and `HeldReviewStop`.
- In `src/schemas/interactiveSession.ts`, widen the origin of `SessionSchema` and of `TurnInProgressSchema` to `first-turn | new-session | builder`. Keep a first turn's origin `first-turn | new-session`, with its own literal.
- In `src/domain/events.ts`:
  - `ReviewStopReached` keeps `cause: StopCause`, and its `reviewStop` is the union.
  - `StopCommitted` replaces `outcome` with `closure: { outcome: "corrected"; oracleStep: "authored" | "none" } | { outcome: "unchanged" }`.
  - Add `HeldStopClosed { phaseId, phaseCommit, closure: { outcome: "corrected"; reviewCommit: string; oracleStep: "authored" | "none" } | { outcome: "unchanged" } }`.
- In `src/domain/reducer.ts`:
  - `ReviewStopReached`: when `event.reviewStop.cause` differs from `event.cause` → `unexpected`.
    - `declared` on running/{running}: today's arm.
    - `held` on running/{committed} → awaiting_review/{awaiting_review, held}. Effects: PersistState (run `stoppedReason: "awaiting_review"`; phase state `awaiting_review` and `stop: { cause: "held", status: "waiting" }`), WriteReviewStop, WriteResumeInstructions (kind `awaiting_review`), and EmitTrace `review.stop.reached` with `cause: held`.
    - Any other phase state for either cause → `unexpected`, naming the cause and the state.
  - `StopCommitted`: persist the closed declared variant from `closure`. On a phase whose cause is `held` → `unexpected` (`a held stop closes with HeldStopClosed`).
  - `HeldStopClosed`, on running/{awaiting_review, held} → running/{committed, hash: phaseCommit}. Effects: PersistState (phase `state: "committed"` and the closed held `stop` built from `closure`) and DiscardReviewStop. Emit no RecordCommitMetadata, so `commitHash` stays the phase commit. On a declared stop → `unexpected`. Its verdicts on the other run states mirror `StopCommitted`'s.
  - Every other event keeps its plan-1 verdict on awaiting_review whatever the cause. Keep `assertNever` in every inner switch.
- In `src/domain/matrix.ts`, add the `HeldStopClosed` column to every row. In `src/app/phaxState.ts`, `stopCauseOf` returns the status stop's `cause` for either variant.
- Make the existing callers compile, with no behaviour change:
  - `src/app/closeStop.ts` dispatches `StopCommitted` with `closure` (`oracleStep: "none"` on corrected);
  - `buildDeclaredReviewStop` in `src/domain/interactive/reviewStop.ts` returns `DeclaredReviewStop`;
  - `src/app/stopInfo.ts`'s `cause` and session `origin` widen to the new unions;
  - `src/app/enterPhase.ts` and `src/app/interactiveStop.ts` follow the type changes only.
- Run `pnpm exec tsx scripts/schemas-check.ts --write`. It rewrites `next.schema.json` of phase-status, review-stop and interactive-session in place. Add no frozen module, because 0.26.0 is uncut. In `tests/unit/schemasPackage/documents.ts`, add current-shape fixtures for:
  - the held review-stop;
  - a `builder` session;
  - each new `stop` variant.

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
- `tests/integration/declaredStopClose.test.ts`
- `tests/integration/dispatcher.test.ts`

### Optional files that may be edited

- `src/app/enterPhase.ts`
- `src/app/interactiveStop.ts`
- `src/app/interactiveFiles.ts`
- `src/app/effectRunner.ts`
- `src/app/dispatcher.ts`
- `src/app/handoffInjection.ts`
- `src/domain/errors.ts`
- `packages/schemas/src/generated/index.ts`
- `tests/integration/declaredStopRun.test.ts`
- `tests/integration/declaredStopProviderArgv.test.ts`
- `tests/integration/reviewCorrectionsPrompt.test.ts`
- `tests/integration/enterPhaseStop.test.ts`
- `tests/integration/stateMachineContract.test.ts`
- `tests/helpers/phaseStatusFixture.ts`
- `tests/e2e/__snapshots__/semanticTrace.declaredStop.test.ts.snap`

### Boundary contracts

Reducer → effect runner: for a held stop, the reducer emits only PersistState, WriteReviewStop, WriteResumeInstructions, EmitTrace and DiscardReviewStop, which the effect runner already applies. The dispatcher stays the only writer of status.json and review-stop.json. Persisted formats → review UI: review-stop.json's two variants each carry exactly their keys, so a UI tells the causes apart by `cause` alone. They are published in `@lbdremy/phax-schemas`.

### Test strategy

Write `tests/unit/reducerHeldStop.test.ts` first. It covers:
- ReviewStopReached held from running/{committed}, with its exact effect list;
- held from running/{running}, declared from committed, and a cause mismatch, each `unexpected`;
- HeldStopClosed corrected (`stop.reviewCommit`, no RecordCommitMetadata, DiscardReviewStop) and unchanged;
- HeldStopClosed on a declared stop, and StopCommitted on a held one, each `unexpected`;
- RunResumeRequested, StopCloseRefused, RunInterruptRequested, PhaseResetRequested and RunArchiveRequested with and without force, on a held stop, each with plan 1's verdict.
Update `tests/unit/reducerAwaitingReview.test.ts` and `tests/unit/events.test.ts` for `closure`. The matrix audit in `tests/unit/reducer.test.ts` covers the new column.
In `tests/unit/awaitingReviewShapes.test.ts`:
- each of the six `stop` variants round-trips;
- a corrected variant without `oracleStep`, or a held corrected one without `reviewCommit`, is refused.
In `tests/unit/schemas/interactiveFormats.test.ts`:
- the held review-stop decodes;
- it refuses `firstReading`, and the declared variant refuses `phaseCommit`;
- a `builder` origin is refused on a declared session;
- a first turn with origin `builder` is refused.
The schemas-package tests check the regenerated snapshots.

### Implementation order

1. state.ts and events.ts
2. the reducer arms and their unit tests
3. the matrix column
4. the status, review-stop and interactive-session schemas
5. the compile fixes in closeStop, reviewStop, stopInfo and the other callers
6. snapshot regeneration and the package fixtures

### Excluded scope

- Building or writing a held review-stop, seed or session at run time (phase-03)
- Closing a held stop (phase-04)
- Writing `oracleStep: "authored"` (phase-06)
- The run-list format and `phax ls --json` (plan 3)

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

Give:
- the six `stop` variants as written in `src/schemas/status.ts`;
- the two review-stop variants and their exported types;
- the widened origins in `src/schemas/interactiveSession.ts`;
- the new event `HeldStopClosed` and the new `closure` field of `StopCommitted`, with every verdict the reducer gives them.
Confirm that `commitHash` is not touched when a held stop closes. List the snapshot files rewritten, and confirm that no frozen module was added. Explain any deviation from the planned file lists, including any listed test that needed no change.

### Commit subject

`feat(state): let a committed phase stop awaiting review as held`

### Commit body

The reducer moves a committed phase to awaiting_review with cause held,
and closes a held stop with HeldStopClosed, which keeps the phase commit
and records the review commit beside it. A closed stop records whether
its gate ran the authored oracle step. review-stop gains a held variant
naming the phase commit, and interactive-session the builder origin. The
formats change in place in the open 0.26.0 shapes.

---

## phase-03 — Reaching a held stop, and the commands on a held run {#phase-03-held-stop}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** The phase adds a stop path to executePlan and reworks seven commands around the held cause, reusing plan 1's stop code without duplicating it, so it needs more care than the default effort.

A run holds the phases recorded in its `run-status.json` hold:
- after such a phase commits and its handoff is validated, the run writes the held seed and records the builder session as current, with no agent turn;
- it writes review-stop.json's held variant and stops with exit 13;
- `phax ls`, `phax session-info`, `phax path`, `phax shell`, `phax open`, `phax enter-phase`, `phax reset-phase`, `phax archive` and `phax adjust-plan` treat a held stop correctly.
`--hold` is still unregistered, so only tests start a held run.

### Detailed instructions

- In `src/domain/interactive/seed.ts`, add `buildHeldSeed(input)`. Its input:
  - `shortName`, `phaseId`, `phaseTitle`;
  - the phase's located plan section;
  - its handoff text and its `file-reconciliation.md` text;
  - `base` and `phaseCommit` (full shas);
  - the earlier phases' handoffs (`{ id, title, text }`, in plan order);
  - the upcoming phases' sections;
  - `gateCommands` and `closeCommand`.
  It returns the markdown of the spec's §6 held seed:
  - `# Held for review: <phase> of <run>`;
  - why the run stopped (started with --hold; the phase is committed `<short commit>` on `<short base>`; later phases have not started and will build on what is left here);
  - `## What is expected of you`: review and correct on top of its commit, a guard per correction, keep the scope, and optionally write `.phax-context/correction-handoff.md` in its four sections;
  - `## The phase (plan, <id>)`, `## What it delivered (its handoff)`, `## Its files (reconciliation)`, `## Earlier phases`, `## Upcoming phases (their plan sections)`;
  - `Full plan: .phax-context/plan.md`;
  - `## Gate`;
  - `## Close the phase`, with the close command, run from the main checkout.
  It never tells an agent how to stop a run.
- In `src/domain/interactive/reviewStop.ts`, add `buildHeldReviewStop(input)`. It returns a `HeldReviewStop` with `closeBase: null` and `lastClose: null`.
  - Its input: the qualified run, the phase (id, title, position, of), `phaseCommit`, the worktree, the main checkout, the seed, the current session or null, the interactive resume support, the continue command or null, and the fresh-start command.
  - `enterPhase`, `close` and `reset` are built as in `buildDeclaredReviewStop`; share a helper rather than copying it.
  - `continue` is null with no session or with an unverified provider.
- In `src/app/interactiveStop.ts`, add `stopAtHeldPhase(input: HeldStopInput)`. Its input:
  - the run identity, run path and main checkout;
  - the plan phases, the phase, its index, its folder and its worktree;
  - the provider, model and effort the phase ran with, and the provider entry;
  - the policy, the frozen agent commands, the gate commands and the located plan sections;
  - `base` and `phaseCommit` (read from the phase's status.json);
  - `builder: { sessionId, startedAt } | null`.
  In order:
  1. Read `phase-handoff.md`, `file-reconciliation.md` and the earlier handoffs (`readExecutedHandoffs`).
  2. Write both seed copies with `writeSeed`.
  3. Write `interactive-session.json`: `current` is the builder session (origin `builder`) or null, with `history: []`, `firstTurns: []` and `turnInProgress: null`.
  4. Build the continue command (when a session is current and the provider is verified) and the fresh-start command with the session adapters, carrying the phase's posture, exactly as `stopAtDeclaredPhase` does. Extract the shared command building into one helper used by both functions.
  5. Build the held review-stop and dispatch `ReviewStopReached` with cause `held`.
  It runs no agent turn and never reads stdin. It returns a `HeldStopReport`: `{ cause: "held", reviewStop, reviewStopPath, phaseCommit, handoffPath, unverifiedProvider }`.
- In `src/domain/errors.ts`:
  - `DeclaredStopReport` gains `cause: "declared"`;
  - add `HeldStopReport`;
  - `AwaitingReviewStopError.report` becomes `StopReport = DeclaredStopReport | HeldStopReport`.
  `stopAtDeclaredPhase` returns the declared report with its cause.
- In `src/app/executePlan.ts`:
  - At the start of `program`, read the run's `hold` from `<runPath>/run-status.json` through `readRunStatusFile`. A read or decode failure fails as other run-status reads do.
  - Add the hold point. For a non-final headless phase whose id is in the hold's `phases`, whose status `stop` is null:
    - its place is after `closePulledBriefs` and before the records block, so before the agent binding's `completed` patch and the cleanup;
    - read its status (`base`, `commitHash`, `createdAt`) and its `agent-binding.json` (provider, model, effort, session id);
    - call `stopAtHeldPhase`;
    - fail with `AwaitingReviewStopError` (`Run "<run>" awaits review at <phase> (held: --hold)`).
  - Until the close is wired (phase-05): a resume whose start phase is a headless phase in `awaiting_review` fails before `RunResumeRequested`, naming that this phax cannot close a held stop yet, and changes nothing.
- In `src/cli/commands/stopOutput.ts`, add `renderStop(report)`, which dispatches on the cause.
  - For a declared stop it returns today's `renderDeclaredStop` lines.
  - For a held stop, the layout is the spec's §6 held stop:
    - `◐ <phase>  <title> — awaiting review (held: --hold)`;
    - `Phase commit: <short> <subject>`, `Handoff:`, `Worktree:` and `Seed:`;
    - `Continue the session that built <phase>:` with the command line, the codex trust note under a codex command, or the fresh-start command with the not-captured warning for an unverified provider;
    - `or: phax enter-phase <run> <phase>   (add --new-session for a fresh read-only look)`;
    - `Or work by hand or with any agent. Then, from the main checkout:` and the close command;
    - `Stop: <review-stop path>`.
  `src/cli/commands/run.ts` and `src/cli/commands/resume.ts` call `renderStop`.
- At a held stop, `src/app/stopInfo.ts` returns `cause: "held"` and the `phaseCommit`. `src/cli/commands/sessionInfo.ts` prints:
  - `Stopped phase:    <id> — <title> (headless, committed <short>, <position>/<of>)`;
  - the session line with its origin (`builder` or `new-session`).
  `phax ls` already prints `awaiting_review (<cause>)` and the stopped phase. Leave `phax ls --json` unchanged.
- In `src/app/enterPhase.ts`:
  - The stopped-phase case applies to a held stop: the builder session is current. The notice reads `Continuing <provider> session <id> (the session that built <phase>) in <worktree>`.
  - With `--new-session`, the read-only first turn runs under the run lock as today. When it answers, review-stop.json is refreshed by patching only `session` and `commands.continue` of the live document, through `refreshReviewStop`, so the held variant and its `phaseCommit` survive. Never rebuild it as a declared stop.
  - A failed or refused new turn leaves the builder session current and review-stop.json as it was.
- Reset at a held stop:
  - `previewResetPhase` (`src/app/resetPhase.ts`) returns `phaseCommit: string | null`: the stopped phase's status `commitHash` at a held stop, null otherwise.
  - `src/cli/commands/resetPhase.ts` prints `This discards <phase>'s commit <short> and N uncommitted review corrections in <worktree>:`, then the M/A/D lines, then `phax resume will run <phase> again from its start and hold it again.`
  The reset itself is unchanged: deleting the phase branch removes the phase commit, and `PhaseResetRequested` discards review-stop.json.
- Build held-run fixtures in `tests/helpers/heldRunFixture.ts`. It runs `createRunFolder` with a listed hold and `executePlan` with the fake backend, on a temporary repository (`tests/helpers/tempGit.ts`), for the made-up six-phase invoice-export plan. Mock `loadProviderConfig` and its siblings so no test reads `~/.phax`.

### Planned files to create

- `tests/helpers/heldRunFixture.ts`
- `tests/integration/heldStop.test.ts`
- `tests/integration/heldStopCommands.test.ts`

### Planned files to edit

- `src/domain/interactive/seed.ts`
- `src/domain/interactive/reviewStop.ts`
- `src/app/interactiveStop.ts`
- `src/domain/errors.ts`
- `src/app/executePlan.ts`
- `src/cli/commands/stopOutput.ts`
- `src/cli/commands/run.ts`
- `src/cli/commands/resume.ts`
- `src/app/stopInfo.ts`
- `src/cli/commands/sessionInfo.ts`
- `src/app/enterPhase.ts`
- `src/app/resetPhase.ts`
- `src/cli/commands/resetPhase.ts`
- `tests/unit/interactive/seed.test.ts`
- `tests/unit/interactive/reviewStop.test.ts`

### Optional files that may be edited

- `src/app/interactiveFiles.ts`
- `src/app/resumeInstructions.ts`
- `src/cli/commands/ls.ts`
- `src/cli/commands/enterPhase.ts`
- `src/app/resolveRunInfo.ts`
- `tests/helpers/stoppedRunFixture.ts`
- `tests/helpers/fakeProviderCli.ts`
- `tests/integration/enterPhaseStop.test.ts`
- `tests/integration/stoppedRunCommands.test.ts`
- `tests/integration/declaredStop.test.ts`
- `tests/unit/cli/ls.test.ts`
- `tests/integration/sessionInfo.test.ts`

### Boundary contracts

executePlan → stop use case: executePlan only decides when a phase holds (recorded hold, non-final, headless, never stopped). Everything else goes through `stopAtHeldPhase`, which reaches files and the reducer through ports and transitions only by dispatching `ReviewStopReached`. Use case → CLI: `AwaitingReviewStopError` carries a `StopReport` that `renderStop` turns into lines. Commands → files: every fact `ls`, `session-info` and `enter-phase` show about a held stop comes from review-stop.json and interactive-session.json, through `src/app/stopInfo.ts` and `src/app/interactiveFiles.ts`.

### Test strategy

Unit tests first:
- `buildHeldSeed` holds every §5.22 part in order and no text about stopping a run;
- `buildHeldReviewStop` gives `continue` null with no session and with an unverified provider, and carries the enterPhase, close and reset argv.
`tests/integration/heldStop.test.ts` runs the invoice-export plan with hold `listed: [phase-02]`. phase-02 is routed to the fake backend reporting session X0, and a cleanup command writes a marker. It checks:
- phase-01 commits and writes its cleanup marker;
- phase-02 commits C2 with its validated handoff, and its worktree stays at C2 with no cleanup marker;
- the backend was called for phase-02 only for its work and its handoff, never after C2;
- phase-03 has no worktree and no branch;
- run and phase-02 are `awaiting_review` with cause `held`;
- `interactive-session.json` holds X0 as current with origin `builder`;
- `resume-instructions.md` exists;
- review-stop.json is the held variant: C2's full sha as `phaseCommit`, no `firstReading` key, a `continue` naming X0, and the enterPhase, close and reset commands;
- both seed copies are identical and hold the §5.22 parts (phase-01's commit as base, C2, the reconciliation);
- `renderStop` prints the §5.30 lines;
- no stdin is read;
- a run whose phase-02 binding has no session id records no current session and prints the fresh-start command.
`tests/integration/heldStopCommands.test.ts` uses a fake Session port, a fake shell and a fake editor:
- `ls` shows `awaiting_review (held)` and `2/6 phase-02`, and `--awaiting-review` lists it;
- `session-info` prints the state, the cause, the phase, its worktree and X0;
- `path`, `shell` and `open` target phase-02's worktree;
- `enter-phase` spawns the continue command naming X0 in phase-02's worktree;
- `--new-session` makes X2 current with origin `new-session`, keeps X0 in history, writes `first-reading.md`, and keeps review-stop.json held with its `phaseCommit`;
- the reset preview names C2 and two files; `--yes` removes the worktree, the branch with C2 and the session files;
- a reset of phase-01 is refused, naming phase-02;
- archive needs `--force`, and adjust-plan `--landed` is refused, naming awaiting_review;
- the phase guard refuses `resume` and `enter-phase` inside the worktree.

### Implementation order

1. the held seed and the held review-stop builder, with their unit tests
2. stopAtHeldPhase and the shared command helper
3. the StopReport union and renderStop
4. executePlan's hold read, its hold point and the interim resume refusal
5. stopInfo, session-info and enter-phase at a held stop
6. the reset preview
7. the fixture and the integration tests

### Excluded scope

- Closing a held stop and continuing the run (phase-04, phase-05)
- Registering `--hold` and widening exit 13's meaning (phase-05)
- Any change to the phase guard, which stays as it is
- The run-list format and `phax ls --json` (plan 3)

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

Give the signatures of `buildHeldSeed`, `buildHeldReviewStop`, `stopAtHeldPhase` and `renderStop`, the shapes of `HeldStopReport` and `StopReport`, and the shared helper's name and module. Say where executePlan reads the hold and where the hold point sits, relative to the handoff, briefs, records and cleanup, and give the interim refusal's text. Say how `--new-session` refreshes a held review-stop. Give the reset preview's wording. Name the fixture helpers in `tests/helpers/heldRunFixture.ts`. Explain any deviation from the planned file lists.

### Commit subject

`feat(interactive): stop a run at a held phase after it commits`

### Commit body

A phase in the run's recorded hold stops once it has committed and its
handoff is validated, before its record and cleanup, with no agent turn:
phax writes the held seed, records the builder session as current and
moves the run to awaiting_review with cause held, whose effect writes
review-stop.json's held variant; the run exits 13. ls, session-info,
enter-phase (continuing the builder session, or a new read-only first
turn) and reset-phase handle a held stop. --hold is not registered yet.

---

## phase-04 — Closing a held stop: the review commit, the correction handoff and reconciliation, and an honest record {#phase-04-close-held-stop}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high
**Assignment reason:** The phase turns the declared close into one sequence with two causes: a different commit base, a review commit beside an unchanged phase commit, separate gate, diff and reconciliation files, and a record that must not credit the agent with the review. No code in the repository shows that design yet.

Close a held stop with the same use case that closes a declared one. It gates the worktree first and returns a red gate to the person. It takes the person's handoff or a read-only closing turn's, given the corrections' diff against the phase commit. It leaves one review commit with a `Held-Phase:` trailer on top of the unchanged phase commit, or no commit when nothing changed. It writes the correction handoff and reconciliation beside the phase's own. The phase records stay honest: no record ever carries the stop's files as the agent's.

### Detailed instructions

- In `src/app/closeStop.ts`, rename `closeDeclaredStop` to `closeStop` and update its callers. It reads the parked review-stop and branches on its `cause`, inside one sequence; keep one `closeSteps`. The held cause differs as follows; everything else stays as today, every refusal included.
- Step 1, the close base. When `closeBase` is null, HEAD must equal the phase's status `commitHash`, read through `readPhaseCommit` in `src/app/phaseStatusUpdates.ts`. Otherwise refuse with `close-error` (`commit`), naming the commit and the remedy `git -C <worktree> reset --soft <phase commit>`. When `closeBase` is set and HEAD moved, `finishLandedCommit` accepts a commit whose parent is `closeBase` and whose message carries this run's `Run-Id` and `Held-Phase: <phase>`. It then finishes from it, writing `review-diff.patch` and the correction reconciliation.
- Step 2, the gate. Its files go to `<phase folder>/review-gate/` (mkdirp):
  - the log is `checks-attempt-NN.log`, with NN from `nextAttemptNumber` over that folder's names;
  - its per-attempt siblings follow the log path;
  - the attribution is `review-gate/gate-attribution.json`.
  A red gate is refused as `gate-failed` with that log path, exit 4.
- Step 4, the handoff. The precedence is unchanged:
  1. the person's `.phax-context/correction-handoff.md`;
  2. the fixed reviewed-without-change text when nothing changed;
  3. a closing turn that resumes the current session (the builder's by default) with `diffTrees(<HEAD tree>, <gated tree>)` cut by `cutDiff`, falling back to a new session.
  Apply q-held-closing-posture:
  - `read-only-resume`: the resumed turn uses `readOnly: true` and no agent commands, as a declared closing turn does;
  - `build-posture-resume`: `readOnly: false` with the phase's frozen agent commands.
  The comparison and the handoff-file check run after the turn either way.
- Step 6, the commit:
  - Write the handoff to `<phase folder>/correction-handoff.md`, and never write `phase-handoff.md`.
  - When changed, call `commitTree(worktree, gated, <plan subject>, buildHeldReviewCommitBody(…))` and save the diff as `review-diff.patch`, never `diff.patch`.
  - When unchanged, make no commit and write no diff. Never raise `PhaseHadNoChangesError`.
- Step 7, the reconciliation. Give `reconcilePhaseFiles` (`src/app/reconcilePhaseFiles.ts`) an option `output: "phase" | "correction"`, default `phase`. With `correction`, it writes `correction-reconciliation.json` and `correction-reconciliation.md`. A held close:
  - when corrected, calls it with kind `review` and output `correction`, which reads HEAD^..HEAD, the review commit against the phase commit;
  - when unchanged, writes `reconcileReview([])` to the same two files without running git.
  `file-reconciliation.json` and `.md` are never written by a held close.
- Step 8, the state. A held close dispatches `HeldStopClosed` with `phaseCommit` and `closure`: `{ outcome: "corrected", reviewCommit, oracleStep: "none" }` or `{ outcome: "unchanged" }`. A declared close keeps dispatching `StopCommitted`. `CloseReport` gains `cause`, and for a held close `phaseCommit`. `commit` becomes `string | null`: null for an unchanged held close.
- In `src/app/commit.ts`, add `buildHeldReviewCommitBody({ phase, runId, shortName, worktreePath, gateLogPath })`:
  - the line `Review corrections to <phase id> (<title>), made by a person at a held stop.`;
  - a blank line and `---`;
  - the trailers `Run-Id`, `Short-Name`, `Phase-Title`, `Held-Phase: <phase id>`, `Worktree` and `Gate-Log`.
  It carries no `Model`, `Effort` or `Session-Id`. Apply q-held-record:
  - `agent-record-only` or `defer`: no `Phase-Id` trailer;
  - `whole-folder`: add `Phase-Id`.
- The record's artifacts, per q-held-record:
  - `agent-record-only`: create `src/domain/records/stopArtifacts.ts` with `isStopArtifact(name)`. It is true for: `review-seed.md`, `first-reading.md`, `interactive-session.json`, `correction-handoff.md`, `correction-reconciliation.json`, `correction-reconciliation.md`, `review-diff.patch`, `review-stop.closing.json`, `review-gate`, any `refused-turn-NN`, any `first-turn-NN.jsonl` or `closing-turn-NN.jsonl` and their `-retry` streams, and any `<turn label>-correction-handoff.md` copy. `assembleRecord` (`src/domain/records/assemble.ts`) drops those names before selecting artifacts.
  - `whole-folder` or `defer`: make no change to the record's artifacts.
  phase-05 writes the record itself.
- The closing turn and every failure keep plan 1's rules:
  - the turn is recorded in progress before it starts;
  - a writing turn's edits are moved to `refused-turn-NN/` and restored;
  - a failure before the state event dispatches `StopCloseRefused`, never `RunFailed`, and never restores or resets the person's corrections;
  - anything the close reads is computed inside the close, so a missing file is a close error.
- Extend `tests/helpers/fakeProviderCli.ts` only if a held close needs a behaviour it lacks, such as reporting a session as not found on resume.

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
- `tests/integration/declaredStopClose.test.ts`
- `tests/integration/declaredStopProviderArgv.test.ts`
- `tests/unit/recordsAssemble.test.ts`

### Optional files that may be edited

- `src/app/interactiveFiles.ts`
- `src/app/interactiveStop.ts`
- `src/app/phaseStatusUpdates.ts`
- `src/domain/errors.ts`
- `src/app/telemetry/stopTelemetry.ts`
- `tests/helpers/fakeProviderCli.ts`
- `tests/helpers/heldRunFixture.ts`
- `tests/e2e/semanticTrace.declaredStop.test.ts`

### Boundary contracts

App → Git port: a held close commits only through `commitTree`, with a tree id it snapshotted on top of the phase commit, and never amends, squashes or rewrites the phase commit. App → Backend port: the closing turn resumes the current session, or starts a new session, under the posture q-held-closing-posture decides. Its answer is decoded at the boundary against the `interactive-handoff` `$schema`. App → reducer: a held close transitions only through `StopCloseRefused` and `HeldStopClosed`. Close → readers: the stop's files live beside the phase's own (`correction-handoff.md`, `correction-reconciliation.*`, `review-diff.patch`, `review-gate/`), and the phase's own files stay byte-identical. Records → assembly: `assembleRecord` decides what a record carries; the writer adds no selection of its own.

### Test strategy

Write `tests/unit/records/stopArtifacts.test.ts` first: every stop file name is recognised, and `output.jsonl`, `phase-handoff.md`, `diff.patch`, `gate-attribution.json`, `checks-attempt-01.log` and `file-reconciliation.json` are not. Extend `tests/unit/recordsAssemble.test.ts` for the filter (under `agent-record-only`).
`tests/integration/heldStopClose.test.ts` drives `closeStop` on held stops built with `tests/helpers/heldRunFixture.ts`. The checkout's git identity is Ada Example. It checks:
- the gate runs before any turn, and its log lands in `review-gate/`;
- the closing turn resumes X0 with the posture of the decided option, given the corrections' diff against C2;
- the answer lands in `correction-handoff.md`, and `phase-handoff.md` is byte-identical;
- the phase branch holds C2 unchanged and exactly one commit on it, with the plan's subject, `Held-Phase: phase-02`, Ada Example as author, no `Session-Id`, and no path under `.phax-context/`;
- `review-diff.patch` exists and `diff.patch` is unchanged;
- `file-reconciliation.json` is byte-identical, and `correction-reconciliation.json` lists the corrections as `reviewCorrections` with `hasDeviations` false;
- the dispatched closure is `corrected` with `reviewCommit`.
Refusals and other outcomes:
- with no change: no commit, the fixed handoff in `correction-handoff.md`, the branch still at C2, outcome `unchanged`, never exit 9;
- a person's handoff file is used byte for byte with no turn;
- an invalid person's file exits 1, naming the defect;
- a closing answer invalid twice exits 5 after exactly one corrective resume;
- a closing turn that writes a file exits 5, with the file set aside and restored;
- a red gate exits 4, keeps its log, commits nothing and leaves C2 the tip;
- a usage limit exits 8;
- a commit the person made on C2 is refused, naming C2 and the `reset --soft` remedy;
- a close interrupted after its review commit is finished from the `Held-Phase` commit;
- with no session, or when X0 is reported not found, a new session gets the seed and the diff.
In every refused case the run stays `awaiting_review` with review-stop.json back. §5.44: a correction written by the test and one written by a fake continued session give the same tree and equal correction reconciliations. `tests/integration/declaredStopProviderArgv.test.ts` gains the held closing turn through the fake `claude` and `codex` CLIs: a resume of the builder session whose argv carries the decided posture (on codex, `sandbox_mode="read-only"` under `read-only-resume`). `tests/integration/declaredStopClose.test.ts` follows the rename and still passes unchanged otherwise.

### Implementation order

1. isStopArtifact and the assembly filter, with their unit tests
2. buildHeldReviewCommitBody
3. reconcilePhaseFiles' correction output
4. closeStop's held base, gate folder, handoff file, commit and reconciliation
5. HeldStopClosed dispatch and the report
6. the held close tests and the argv tests

### Excluded scope

- Calling the held close from executePlan, writing the record, the cleanup and the next phase (phase-05)
- Rendering a held close in `phax resume` (phase-05)
- The `authored` oracle step at a close (phase-06)
- Transcript capture and the records' review fields (plan 3)

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

Give:
- the signature of `closeStop` and the new shape of `CloseReport`;
- each held-specific step: base check, gate folder, handoff, commit, diff and reconciliation files;
- the exact trailer block of a review commit, and `buildHeldReviewCommitBody`'s signature;
- how `finishLandedCommit` recognises a held commit;
- which q-held-closing-posture and q-held-record options were applied and how;
- `isStopArtifact`'s list, when it applies;
- the reconciliation option added to `reconcilePhaseFiles`.
Confirm that `phase-handoff.md`, `diff.patch`, `gate-attribution.json` and `file-reconciliation.*` are never written by a held close. Explain any deviation from the planned file lists.

### Commit subject

`feat(interactive): close a held stop with a review commit on the phase commit`

### Commit body

closeStop now closes both causes with one sequence. At a held stop the
first close requires HEAD to be the phase commit, the gate writes under
review-gate/, and the handoff goes to correction-handoff.md beside the
builder's. The corrections land as one review commit on top of the
unchanged phase commit, with a Held-Phase trailer and the person as
author, or no commit when nothing changed. They are reconciled in
correction-reconciliation.json against the phase commit, never as
deviations, and a phase record never carries the stop's files as the
agent's.

---

## phase-05 — Run and close held phases end to end, with phax run --hold {#phase-05-hold-end-to-end}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high
**Assignment reason:** It adds a held re-entry and a record-at-close path to executePlan's resume sequence, registers --hold, and wires prompts and the global reconciliation. No existing code shows these together.

Make the operator's hold real:
- `phax run --hold`, `--hold phase-02,phase-04` and `--hold oracle` are accepted, refused when malformed (exit 1) and resolved before the run is named;
- `phax resume` closes a held stop, writes the phase's record once, runs the cleanup and continues in the same invocation;
- later phases read every closed stop under `## Review corrections`, and the global reconciliation counts the corrections as review corrections.

### Detailed instructions

- In `src/app/executePlan.ts`, replace the interim refusal of a held re-entry. A resume whose start phase is in `awaiting_review`, whatever its mode, checks its worktree before `RunResumeRequested`, with the existing `stopReentry`. For a headless phase:
  1. Call `closeStop` with the phase's gate steps and its gate request computed inside the close.
  2. When records are enabled, write the phase record once, as q-held-record decides.
  3. Patch the agent binding to `completed`.
  4. Run `cleanupCommittedPhase`.
  5. Set `previousPhaseBranch` to the phase branch, whose tip is the review commit or the phase commit, and continue with the next phase.
- Write the record as q-held-record decides:
  - `agent-record-only`: `writeRecordForPhase` with the builder's provider, model, effort and session id from `agent-binding.json`, outcome `committed`, and `sourceSha` set to the phase's status `commitHash`, never HEAD;
  - `whole-folder`: the same call, with `sourceSha` set to the phase commit;
  - `defer`: no call.
- A held-closed phase whose cleanup failed pauses as `cleaning_up`. Its re-entry runs only the cleanup and continues. It writes no record, because the close wrote it: skip the records block for a phase whose status `stop` is a closed held stop.
- Add a held close to the pause errors only through `StopCloseRefusedError`, which is already a pause.
- `reviewCorrectionsFor(i)` reads the earlier phases' statuses. It returns nothing when none has a closed `stop`, so the prompts of runs without a stop stay byte-identical.
- In `src/app/handoffInjection.ts`, `readReviewCorrections` walks the earlier phases in plan order and keeps each phase whose status `stop` is closed, whatever its mode.
  - A held stop contributes `correction-handoff.md` and the `reviewCorrections` of `correction-reconciliation.json`.
  - A declared stop contributes `phase-handoff.md` and those of `file-reconciliation.json`.
  `ReviewCorrectionStop` gains `cause`. In `src/domain/interactive/reviewCorrections.ts`:
  - each stop's heading reads `### <phase> (held)` or `### <phase> (interactive)`;
  - the sentence names the phases where a person reviewed and corrected the run, and keeps the precedence and the binding plan section.
- In `src/app/generateGlobalReconciliation.ts`, for a phase folder holding `correction-reconciliation.json`, merge its `reviewCorrections` into that phase's result before building the global reconciliation, so a file only the review changed reads `review-corrected`. A missing file is not an error.
- CLI:
  - In `src/cli/program.ts`, register on `run` the option `--hold [selection]`, described `Stop for review once these headless phases commit: no value for every phase but the final one, oracle, or phase ids such as phase-02,phase-04`. Do not add it to `resume`.
  - In `src/cli/commands/run.ts`, before loading the config or reading the plan, parse it with `parseHoldValue`. A defect prints its message and exits 1. Pass the request to `freshRunPreflight`.
  - `buildDryRunReport` and `formatDryRunReport` (`src/app/dryRun.ts`) gain the hold: the request resolved with `resolveHold`, printed as `Hold: <selection> — <phases>`, or followed by the hold check's errors. The exit code is unchanged.
- In `src/cli/commands/stopOutput.ts`, `renderStopClosed` renders a held close:
  - changed: `<phase> (held): N files changed by review, on <short phase commit>`, then `✓ <phase>  <title>   review commit <short>  on <short phase commit>  (corrected)`;
  - unchanged: `<phase> (held): no change`, then `✓ <phase>  <title>   <short phase commit>  (unchanged, no commit)`.
  In both cases print the gate lines and the handoff source (`→ correction-handoff.md`). `src/cli/commands/resume.ts` uses it.
- In `src/cli/commands/runLayers.ts`, row 13 reads `Awaiting review at an interactive or held phase (resumable)`. Update README.md's exit-code row to match, then run `pnpm gen:usage-spec` and `pnpm docs:cli`.
- Create `tests/e2e/semanticTrace.heldStop.test.ts`, built like `tests/e2e/semanticTrace.declaredStop.test.ts`, gated by `PHAX_E2E_RUN=1`, with real git and a fake backend. A three-phase made-up plan is run with hold `listed: [phase-02]` and stops at phase-02. The test writes a correction, closes the stop with a resume that finishes the run, and snapshots both invocations' semantic trace projection. Write its snapshot by running the test with `PHAX_E2E_RUN=1`. If the session cannot set the variable, commit the test without its snapshot and say so in the handoff.

### Planned files to create

- `tests/integration/heldStopRun.test.ts`
- `tests/integration/holdCli.test.ts`
- `tests/e2e/semanticTrace.heldStop.test.ts`

### Planned files to edit

- `src/app/executePlan.ts`
- `src/app/handoffInjection.ts`
- `src/domain/interactive/reviewCorrections.ts`
- `src/app/generateGlobalReconciliation.ts`
- `src/cli/program.ts`
- `src/cli/commands/run.ts`
- `src/app/dryRun.ts`
- `src/cli/commands/stopOutput.ts`
- `src/cli/commands/resume.ts`
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
- `src/app/resume.ts`
- `src/cli/cliDocs.ts`
- `src/domain/reconciliation/global.ts`
- `docs/cli/inventory.md`
- `tests/helpers/heldRunFixture.ts`
- `tests/helpers/fakeProviderCli.ts`
- `tests/unit/readmeExitCodes.test.ts`
- `tests/integration/usageSpecDrift.test.ts`
- `tests/unit/cli/run.test.ts`
- `tests/unit/promptGeneration.test.ts`
- `tests/integration/declaredStopRun.test.ts`
- `tests/integration/runPreflightBeforeNaming.test.ts`

### Boundary contracts

CLI → app: `phax run` parses the hold, and the app resolves it and records it with the run. `phax resume` never takes one. executePlan reads the hold from run-status.json, so the recorded hold is the only one. executePlan → close: executePlan decides only when to close (start phase awaiting_review). Everything else goes through `closeStop`, then the shared record, cleanup and chaining code. Later prompts depend on each closed stop's status `stop`, its interactive handoff file and its reconciliation's `reviewCorrections`. Records: the phase record of a held phase is written once, at closing, per q-held-record.

### Test strategy

`tests/integration/holdCli.test.ts` drives `runRun` with mocked loaders and a cached extraction, following `tests/integration/runPreflightBeforeNaming.test.ts`.
- With no `--hold`, with `--hold`, and with `--hold phase-02,phase-04`, the new runs record `none`, `all` (phase-01, phase-02, phase-04, phase-05) and `listed` (phase-02, phase-04).
- `--hold phase-2`, `oracle,phase-02`, `phase-02,,phase-04` and `phase-02,phase-02` each exit 1, naming the value and the three forms, with no run, worktree or branch.
- `phax run --hold invoice-export --plan <plan>` exits 1 with the run-name hint.
- `phax run invoice-export --plan <plan> --hold=phase-02` names the run invoice-export and records `listed` phase-02.
- The five hold-check refusals exit 11 with no run named.
- `phax resume invoice-export --hold` exits 1 as an unknown option.
- `--dry-run` prints the resolved hold.
`tests/integration/heldStopRun.test.ts` runs executePlan and the resume path with the fake backend. It checks:
- `--hold phase-02`: the run stops with exit 13. The resume closes it with a review commit and Ada Example as author, writes the cleanup marker after the close, creates phase-03's worktree at the review commit in the same invocation, and continues to review.
- An unchanged close creates phase-03 at C2 with no exit 9.
- A red closing gate exits 4, leaves the stop, and a second resume closes it.
- The hold is fixed: a run started with `--hold phase-04` pauses on a rate limit in phase-02, then stops at the declared phase-03 and closes it. phase-02 commits without stopping, phase-04 stops `held`, phase-05 does not stop, and run-status `hold` stays byte-identical.
- With no TTY and an idle stdin pipe, the run exits 13 at phase-02 and reads nothing.
- A plan with no interactive phase, whose phase-02 handoff ends with a question, stops only at phase-03 under `--hold phase-03`.
- With records configured: the records branch holds no phase-02 record while it is held, and exactly one after the close, naming C2 and the builder session, per the decided q-held-record option.
- Cleanup re-entry after a held close writes no second record.
- A held phase-02 and a declared phase-03, both corrected, reach phase-04's prompt as phase-02's `correction-handoff.md`, then phase-03's handoff, under `## Review corrections`, with `(held)` and `(interactive)`. `## Previous phase handoff` is phase-03's previous headless phase's handoff, and phax-plan.json and plan.md stay byte-identical.
- The cost ledger holds one `closing-turn` entry for phase-02, with its own increment, and phase-02's builder entries unchanged.
- A run without `--hold` keeps its prompts, states and exit codes.
Other tests:
- `tests/integration/generateGlobalReconciliation.test.ts`: a held correction reads `review-corrected` and never unplanned;
- `tests/unit/interactive/reviewCorrections.test.ts`: the two labels.

### Implementation order

1. executePlan's held re-entry, the record at closing and the cleanup re-entry
2. readReviewCorrections, the labelled section and the status-based guard
3. the global reconciliation merge
4. program, run and dry-run for --hold
5. the held close output and exit 13's meaning, then usage and CLI docs regeneration
6. the integration tests and the e2e trace

### Excluded scope

- The oracle-pair rules and lifting the interim pair refusal (phase-06)
- The docs, the skill and NEXT_STEPS (phase-07)
- The versioned `phax ls --json`, transcripts and the records' review fields (plan 3)

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

Say:
- where executePlan closes a held stop, and where it writes the record;
- how the cleanup re-entry skips the record;
- how a later prompt reads a held stop;
- how the global reconciliation merges corrections.
Give the exact `--hold` option text, the parse step's place in `runRun`, the dry-run line and the new exit-13 meaning. Confirm that `phax resume` has no `--hold`. Say whether the e2e snapshot was written. Explain any deviation from the planned file lists.

### Commit subject

`feat(hold): run and close held phases with phax run --hold`

### Commit body

phax run accepts --hold (every headless phase but the final one),
--hold oracle or a list of phase ids, refuses a malformed value with exit
1 and records the resolved hold. phax resume closes a held stop, writes
the phase's record once, naming the phase commit, runs the cleanup and
starts the next phase from the branch tip in the same invocation. Later
phases read every closed stop, held or declared, under Review corrections.

---

## phase-06 — Reviews inside an oracle pair: the authored re-run, the latest authored commit and the held discharge {#phase-06-oracle-pair-reviews}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high
**Assignment reason:** The phase designs the oracle step of a close and the choice of the latest authored commit across the gate, the close, reset and lint. oracle-phases' code does not show that design yet.

Let a person review an oracle phase's tests before their discharge.
- A declared interactive phase may sit inside an oracle pair.
- `--hold oracle` and holds of pair phases are accepted.
- A stop before the discharge whose corrections change one of the pair's oracle files re-runs the `authored` oracle step as the closing gate's last step.
- The discharge judges the latest commit that passed `authored`.
- A held discharge closes on its configured steps only.
- A commit the discharge judges is reset only after the discharge.

### Detailed instructions

- In `src/domain/plan/oracleCheck.ts`:
  - remove the `inside` findings of `interactiveRows`, keeping the `role` findings (§5.12 stands);
  - make the `between` rule skip an interactive phase, so its optional files may name an oracle file the person may touch.
  Update the module's comment and the rule grouping.
- In `src/domain/hold.ts`, delete the interim oracle-pair rule. `resolveHold` then accepts `oracle` and any pair phase.
- In `src/domain/plan/oraclePairs.ts`, add three pure functions:
  - `stopOraclePairs(phases, stopPhaseId)`: the pairs whose oracle phase index is at most the stop's, and whose discharging phase index is greater than it. A held discharging phase is thus never in its own pair's list.
  - `pairsChangedByCorrections(pairs, changedPaths)`: the pairs whose oracle files intersect the changed paths.
  - `latestAuthoredCommit(pair, phases, statuses)`. It walks the phases from the pair's oracle phase up to, but not including, the discharge, in plan order, and keeps the last whose status `stop` is closed `corrected` with `oracleStep: "authored"`. That stop's commit is its `reviewCommit` when held and its `commitHash` when declared. Without one, it is the oracle phase's `commitHash`, or null when that phase noted none.
- In `src/domain/gate/oracleRequest.ts`, add `makeReviewOracleRequest({ pair, phaseId, base })`. It returns `{ verdict: "authored", phase: phaseId, oraclePhase: pair.oraclePhase, base, files }`. `makeOracleRequest` is unchanged.
- In `src/app/closeStop.ts`, `CloseStopInput` gains `phases` and `oraclesCommand: string | null`. Before the gate:
  1. Snapshot the worktree and list its changed paths against HEAD's tree.
  2. Compute `pairsChangedByCorrections(stopOraclePairs(phases, phase.id), paths)`.
  - With two or more pairs, refuse `close-error` (`gate`), naming both pairs.
  - With one, build the oracle step from `makeReviewOracleRequest`, with `base` read from the oracle phase's status.json, and pass it to `runGates` as its `oracleStep`, which runs after every configured step.
  - With one pair and no `oraclesCommand`, refuse `close-error` (`gate`), naming the missing provider.
  After the gate, if the gated tree changes an oracle file of a pair in `stopOraclePairs` that the pre-gate decision did not include, refuse `close-error` (`gate`), naming the file. A failed or refused oracle step is a red gate (`gate-failed`, exit 4). A close whose gate ran the step commits with `oracleStep: "authored"`, both in `StopCommitted` and in `HeldStopClosed`.
- Apply q-discharge-oracle-edit at a held discharging phase:
  - `flagged`: the close report gains `unjudgedOracleFiles`, the oracle files of the pair it discharges that its corrections changed. `renderStopClosed` prints one warning per file: `<file>: an oracle file changed at the discharge; the discharge was judged before the stop, so the oracles provider does not see this change`. The close's trace records the files through `tracedStep`.
  - `silent`: none of this.
- In `src/app/executePlan.ts`:
  - `oracleCommitOf(pair)` reads the statuses of the pair's phases (status.json facts only, never git) and returns `latestAuthoredCommit`. Keep `OracleCommitMissingError` when it returns null.
  - Pass `phases` and the configured oracles command to `closeStop`.
  - A held discharging phase's close gets no oracle step for its own pair, because `stopOraclePairs` already excludes it.
- In `src/app/resetPhase.ts`, extend the discharge rule. A target phase whose closed `stop` has `oracleStep: "authored"` is refused while its pair's discharging phase is not `pending`, with the oracle phase's message pattern: `Cannot reset "<phase>" of run "<run>": its discharging phase "<discharge>" is <state>, and the discharge judges this phase's commit.` Find the pair with `stopOraclePairs`.
- In `src/cli/commands/resume.ts`, refuse `--skip-oracle` when the run is `awaiting_review`, with exit 1: `--skip-oracle: <run> awaits review at <phase>; a close's authored oracle step is never skipped. Undo the oracle-file correction, or reset the stop.`

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
- `tests/unit/oracleCheck.test.ts`
- `tests/unit/oraclePairs.test.ts`
- `tests/unit/oracleRequest.test.ts`
- `tests/unit/hold.test.ts`
- `tests/integration/holdPreflight.test.ts`
- `tests/integration/resetPhase.test.ts`
- `tests/integration/holdCli.test.ts`

### Optional files that may be edited

- `src/app/gates.ts`
- `src/app/telemetry/stopTelemetry.ts`
- `src/domain/errors.ts`
- `src/schemas/oracleRequest.ts`
- `packages/schemas/snapshots/oracle-request/next.schema.json`
- `tests/unit/cli/resume.test.ts`
- `tests/integration/oraclePhases.test.ts`
- `tests/integration/lintPlan.test.ts`
- `tests/integration/heldStopClose.test.ts`
- `tests/helpers/heldRunFixture.ts`

### Boundary contracts

Close → oracles provider: a close sends at most one `authored` request, in oracle-phases' unchanged `oracle-request` format, naming the stopped phase as `phase`. It goes out only after every configured step passed, and a failed verdict returns the stop to the person. Status facts → discharge: the discharge's `oracleCommit` comes only from status.json (`stop.oracleStep`, `stop.reviewCommit`, `commitHash`), never from git. Lint → plan authors: an interactive phase may sit inside a pair and name an oracle file among its optional files, and it still takes no oracle role.

### Test strategy

Unit tests first:
- `oracleCheck`: an interactive phase between a pair, even with an oracle file among its optional files, reports no `oracles` finding, while an interactive phase in an oracle role still does. Invert oracle-phases' 'Lint rejects an interactive phase inside the pair' case.
- `oraclePairs`: `stopOraclePairs` at the oracle phase, strictly between, and at the discharge (excluded); `pairsChangedByCorrections`; `latestAuthoredCommit` with no stop, a declared authored stop, a held authored stop after it (wins), and an unchanged stop (ignored).
- `makeReviewOracleRequest`.
- `hold`: `oracle` and pair phases now resolve.
`tests/integration/oraclePairReview.test.ts` uses `./fake-oracles`, which records each request and answers a checked report with no finding (or a failing one when told). It covers four scenarios.
1. A four-phase variant whose phase-02 is an oracle phase (oracle file `tests/export/invoiceRow.test.ts`), discharged by phase-03, run with `--hold oracle`. The run records `{ selection: oracle, phases: [phase-02] }`.
   - When the person changes an assertion in the oracle file, the close's last step is `authored` with `phase` and `oraclePhase` phase-02 and phase-01's full commit as `base`; the review commit lands, and phase-03's `discharged` request names it as `oracleCommit`.
   - When the correction changes only `src/export/invoiceRow.ts`, no oracle step runs and phase-03's `oracleCommit` is C2.
2. A five-phase variant whose phase-02 is discharged by phase-04 and whose phase-03 is a declared interactive phase planning no file. Lint reports no `oracles` finding, phase-03's close ends with an `authored` request naming phase-03, and phase-04's `oracleCommit` is phase-03's commit.
3. The four-phase variant run with `--hold phase-03`, the discharging phase:
   - unchanged: no oracle request is sent and the phase closes `unchanged`;
   - `toBe(120)` changed to `toBe(100)`: the configured steps pass, no request is sent, the review commit carries the change, and with `flagged` the warning is printed;
   - a correction that breaks a configured step: exit 4, no fix attempt and nothing committed.
4. A failing `authored` verdict at a close exits 4 and keeps the stop.
Other tests:
- `tests/integration/resetPhase.test.ts`: a declared phase-03 that ran `authored` is not reset once phase-04 has started;
- `tests/integration/holdCli.test.ts`: `--hold oracle` is recorded;
- a test proves `phax resume --skip-oracle` is refused at a stop.

### Implementation order

1. the oracles check change and the hold rule removal, with their unit tests
2. the pure pair helpers and the review request
3. closeStop's pre-gate decision, its oracle step and its refusals
4. executePlan's latest authored commit and the close wiring
5. the q-discharge-oracle-edit outcome
6. the reset extension and the --skip-oracle refusal
7. the integration tests

### Excluded scope

- Changing the `oracle-request` or `gate-report` formats
- An interactive phase taking an oracle role (§5.12 stands)
- Docs and the planning skill (phase-07)

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

Give:
- the removed and changed rules in `src/domain/plan/oracleCheck.ts`;
- the signatures of `stopOraclePairs`, `pairsChangedByCorrections`, `latestAuthoredCommit` and `makeReviewOracleRequest`;
- where the close decides on the oracle step, with its three refusals and their messages;
- how `oracleStep: "authored"` reaches status.json;
- how executePlan picks `oracleCommit`;
- the reset extension's message and the `--skip-oracle` refusal;
- which q-discharge-oracle-edit option was applied.
Explain any deviation from the planned file lists.

### Commit subject

`feat(oracles): judge a review inside an oracle pair before its discharge`

### Commit body

An interactive phase may now sit inside an oracle pair, and --hold oracle
holds oracle phases. A stop before the discharge whose corrections change
an oracle file re-runs the authored oracle step as its closing gate's last
step, naming the stopped phase. The discharge judges the latest commit
that passed it, read from status.json. A held discharge closes on its
configured steps only, and a commit the discharge judges is reset only
after the discharge.

---

## phase-07 — Docs and the planning skill for the hold and oracle-pair reviews {#phase-07-docs-and-skill}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

Tell operators, planners and review-UI authors how a held stop works:
- the README covers `--hold`, the held stop and its close, and reviews inside an oracle pair, and drops its not-in-this-release wording;
- the oracle guide covers the review inside a pair;
- the planning skill allows an interactive phase inside a pair and names `--hold`;
- the CLI help, the upgrade notes and NEXT_STEPS follow.

### Detailed instructions

- In README.md `### Interactive phases`, add the hold after the declared stop, with the made-up invoice-export example. Cover:
  - `phax run --hold`, `--hold phase-02,phase-04` and `--hold oracle`, and when to prefer each over declaring a phase;
  - the hold is fixed for the run, and no configuration key sets it;
  - the final phase never holds;
  - what the run does at a held phase: commit, validated handoff, no agent turn, `awaiting_review (held)`, exit 13, no waiting for input;
  - the builder session as the default continue, and `--new-session`;
  - closing with `phax resume`: the gate first, `correction-handoff.md` beside the phase's handoff, one review commit on the phase commit with `Held-Phase:` and the person as author, no commit when nothing changed;
  - a commit of your own is refused with `reset --soft <phase commit>`;
  - `phax reset-phase` discarding the phase commit and holding the phase again;
  - reviews inside an oracle pair: the `authored` re-run, the latest authored commit, and the held discharge closing on its configured steps (with the warning, if q-discharge-oracle-edit chose `flagged`).
  Remove 'This release does not allow one between the two phases of an oracle pair'. Rewrite the 'Not part of this release' paragraph to name only plan 3's items: the versioned `phax ls --json`, captured transcripts, and the records' review fields, the compliance review and the PR body of a stop.
- In README.md `### Oracle provider` (§Oracle phases), replace the '`--hold oracle`, coming with interactive phases' wording with the shipped behaviour.
- In `docs/oracle-phases.md`, replace 'no interactive phase sits in between' with the new rule: an interactive phase may sit in between and takes no role. Add a section `## Reviewing oracles before the discharge`, covering:
  - `--hold oracle` and a declared review inside a pair;
  - the `authored` request naming the stopped phase;
  - `oracleCommit` as the latest commit that passed `authored`;
  - the held discharge closing on its configured steps only;
  - the reset rule;
  - `--skip-oracle` refused at a stop.
- In `.claude/skills/phax-planning/SKILL.md`:
  - In `## Interactive phases`, replace 'In this release it may not sit inside an oracle pair, and it never takes an oracle role' with: it may sit inside an oracle pair (a person reviews the oracles before their discharge, and phax re-judges them), and it never takes an oracle role.
  - Add, per spec §5.10: declare one directly after the first phase that sets a pattern, never by default, since the operator can hold any other phase with `phax run --hold`.
  - In `## Oracle phases`, replace 'no interactive phase sits in between or takes an oracle role' with 'an interactive phase may sit in between, and never takes an oracle role'.
  - Update the Lint section's `interactive` and `oracles` summary to match.
  This edit needs `phax run --allow-skill-edits`.
- In `src/cli/cliDocs.ts`, update the long help of:
  - `run`: `--hold`, its three forms, the `hold` preflight (exit 11), a malformed value (exit 1) and the dry-run line;
  - `resume`: closing a held stop, and `--skip-oracle` refused at a stop;
  - `enter-phase`: the builder session at a held stop;
  - `session-info` and `ls`: a held stop;
  - `reset-phase`: discarding a held phase's commit, and the authored-commit rule.
  Then run `pnpm gen:usage-spec` and `pnpm docs:cli`.
- In `docs/upgrading.md` under `### 0.26.0`, add a bullet. `run-status.json` gains a required `hold`. Scripts that read it find `{ "selection": "none" }` on every run not started with `--hold`, and runs written by older releases read as `none`. Nothing to run.
- In NEXT_STEPS.md, under `interactive-phases`, record plan 2 of 3 (`phax run --hold`, the held stop and the oracle-pair reviews) as landing with this run, and name its plan file. Keep plan 3 as next. Update the gaps:
  - held and declared stops have no review fields in their records until plan 3;
  - `records explain` on a review commit finds no record until plan 3, if q-held-record chose `agent-record-only`;
  - the cost ledger still covers Claude Code turns only.

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

No new behaviour. The usage-spec drift, CLI-docs drift, README exit-code and skills tests check that the generated files and the docs match the CLI. Read the README and the oracle guide against the behaviour that `tests/integration/heldStopRun.test.ts`, `tests/integration/holdCli.test.ts` and `tests/integration/oraclePairReview.test.ts` cover. Change no test expectation to fit the prose.

### Implementation order

1. cliDocs long help and regeneration
2. the README sections and the stale-wording sweep
3. docs/oracle-phases.md
4. the planning skill
5. docs/upgrading.md and NEXT_STEPS

### Excluded scope

- docs/upgrading.md for `phax ls --json` (plan 3)
- Documenting the run list, transcripts or the records' review fields as available (plan 3)
- Any code change

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

List each README, oracle-guide and skill section added or changed, and every stale statement removed, with its location. Confirm that the usage spec and the CLI docs were regenerated, that the skill now mentions `phax run --hold` and allows an interactive phase inside an oracle pair, and that the README's not-in-this-release paragraph names only plan 3's items. Explain any deviation from the planned file lists.

### Commit subject

`docs(interactive): document held stops and reviews inside an oracle pair`

### Commit body

The README explains phax run --hold, a held stop and its close with a
review commit on the phase commit, and reviews inside an oracle pair. The
oracle guide covers the authored re-run and the latest authored commit.
The phax-planning skill allows an interactive phase inside a pair and
points at --hold. The CLI help, the 0.26.0 upgrade notes and NEXT_STEPS
follow.
