Write the phax plan "Held stop and oracle-pair reviews" for the approved spec `docs/specs/2610211403-interactive-phases.md`. It is the second of that spec's three plans, so it carries `completes-spec: false`. Plan 3 adds the review UI's run list and the records around a stop.

Read the spec in full. These are settled; do not reopen them:
- every verdict in §9b, q-held-discharge's `no-oracle-step` included;
- the carried-over verdicts and the operator's decisions of 2026-10-21 in §10;
- the joint phase-shape decisions J1–J4;
- plan 1's operator verdicts (q-turn-shell `no-shell`, q-vibe-turns `phase-posture`, q-enter-phase-posture `carry-posture`, q-continue-approvals `provider-prompts`), in `docs/plans/archive/2610220954-interactive-phases-plan.md`. They bind the held stop's turns and continue commands too.

Already landed, do not redo:
- **phase-shape (PR #151):** the `mode` key, the `**Mode:** interactive` line, its rendering and lift.
- **oracle-phases (PRs #154–#156):** the oracle step in the gate loop, the `oracles` check, `phax resume --skip-oracle`, `reset-phase`'s discharge rule, and the Vitest provider in `examples/vitest-oracles/`.
- **interactive-phases plan 1, the declared stop (PR #157):** read its plan, then the code it landed, before planning:
  - the `awaiting_review` run and phase states, exit 13, the reducer events (`ReviewStopReached`, `StopCloseRefused`, `StopCommitted`) and the matrix;
  - `src/app/interactiveStop.ts` (seed, first turn, leftover turns), `src/app/closeStop.ts` (the close), `src/app/interactiveFiles.ts`, `src/app/telemetry/stopTelemetry.ts`;
  - the first-reading, interactive-handoff, interactive-session and review-stop formats; the `stop` block on phase-status; `reviewCorrections` on the reconciliations; the `first-turn` and `closing-turn` cost roles;
  - `phax enter-phase` (continue, `--new-session`), `session-info`, `ls --awaiting-review`, `path`/`shell`/`open`, `reset-phase` and `archive --force` at a stop;
  - the `## Review corrections` prompt section;
  - `tests/e2e/semanticTrace.declaredStop.test.ts`, which pins the declared stop's trace.

  Extend that code to the held cause. Do not build a second close, seed writer or stop document beside it.

In scope: the operator's hold, end to end, and the oracle-pair rules. A run started with `phax run --hold …` stops at each selected headless phase after it commits, a person reviews it, and `phax resume` closes the stop and continues. By section:
- **The hold option** (§5.11–§5.17): the three forms of `--hold` and the malformed-value refusal (exit 1, before the run is named); resolving the selection against the plan; the `hold` preflight check (exit 11, before the run is named, `phax plans lint` does not run it); the required `hold` on run-status, fixed for the run; no `--hold` on `phax resume`; no hold key in any configuration layer (exit 2 through the existing unknown-key refusal: verify it).
- **The held stop** (§5.20–§5.22, and §5.29, §5.30, §5.33, §5.34 for cause `held`): stopping after the commit, the validated handoff and the gate attribution, before the record and the cleanup; no agent turn; the builder session recorded as current with origin `builder`, or none; the held seed; `awaiting_review` with cause `held`; the stop's output; the review-stop document's held variant.
- **While held** (§5.39–§5.45 at a held stop): `ls`, `session-info`, path/shell/open, `enter-phase` continuing the builder session (q-held-session `builder-default`), `--new-session` running a read-only first turn that becomes current, the phase guard.
- **Closing a held stop** (§5.46–§5.54 at a held stop, §5.59–§5.63, §5.65): the gate first and a red gate returned to the person; the person's `correction-handoff.md`, else a read-only closing turn resuming the current session (the builder's by default); the review commit on top of the unchanged phase commit with `Held-Phase: <phase id>`, authored by the checkout's identity; no commit when nothing changed, never exit 9; the interactive handoff written as `<run>/<phase>/correction-handoff.md` beside the unchanged `phase-handoff.md`; cleanup, then the next phase from the branch tip, in the same invocation; later phases read the corrections; corrections reconciled against the phase commit, never as deviations.
- **Record, cost, other commands** (§5.69, §5.71, §5.73–§5.76): a held phase writes no record while held and writes it once at closing; the closing turn and any `--new-session` turn are costed; `reset-phase` at a held stop removes the phase commit and runs the phase again, holding it again; reset the stopped phase first; adjust-plan waits; archive treats the stop as unfinished.
- **Oracle pairs** (§5.77–§5.80, and the oracle-phases changes in §10):
  - remove the `oracles` check's finding against an interactive phase strictly between a pair (r-oracle-review), and invert its criterion; §5.12 (no oracle role) stands;
  - a stop before the discharge whose corrections change one of the pair's oracle files runs the `authored` oracle step as the closing gate's last step, naming the stopped phase (r-oracle-authored), at a declared or a held stop;
  - the discharge names as `oracleCommit` the latest commit of the pair that passed `authored` (r-oracle-commit);
  - a held discharging phase's closing gate runs its configured steps only, no oracle step (r-oracle-held-discharge);
  - `reset-phase` resets a commit that is the pair's current `oracleCommit` only after the discharge (oracle-phases §5.36 extended).
- **Persisted shapes needed by the above:**
  - run-status `hold` (`none | all | listed | oracle`, `phases` on every variant but none);
  - the phase-status `stop` and the review-stop document gain cause `held`, each variant with exactly its keys (a held stop names its phase commit, a declared one does not);
  - interactive-session's session origin gains `builder`;
  - whatever records the latest authored commit of a pair (see "Left to planning").

  Check `packages/schemas/history.lock.json` and `docs/release.md` first. If 0.26.0 is still uncut, these formats are already at their 0.26.0 `next` shape and change in place, with no new frozen decoder. If it was cut, freeze the 0.26.0 shapes and lift them (`hold: { selection: "none" }` for an older run-status: no older run was held).

Out of scope, for plan 3. Leave each as it is today, and keep main honest in between:
- the versioned `phax ls --json` run list (§5.35, the run-list format), and docs/upgrading.md for it;
- transcript capture (§5.55, §5.56);
- the records' stop fields, the security record, the compliance review, the review handoff and the PR body around a stop (§5.66–§5.68, §5.70);
- estimating an interactive phase (§5.72).

§5.69 is in scope, but the record's review fields are plan 3's. State in Technical arbitrations the minimum this plan writes at closing so that no record claims the agent wrote the review commit: for example, the existing phase record of the agent's work, written at closing and naming the phase commit only, with the review commit added by plan 3. Raise an open question if keeping it honest needs more than that.

Ground to read, besides plan 1's code above:
- `src/cli/program.ts` and `src/cli/commands/run.ts` (option parsing; the optional positional short name before `--hold`), `src/app/runPreflight.ts` and RUN_PREFLIGHT_CHECKS;
- `src/app/executePlan.ts`: the headless phase's commit, handoff, gate attribution, `writeRecordForPhase`, cleanup and the hand-over to the next phase; `oracleStepFor` and `oracleCommitOf`;
- `src/domain/plan/oracleCheck.ts` (`interactiveRows`), `src/domain/oracle/*`, and `docs/oracle-phases.md`;
- `src/app/resetPhase.ts` (the discharge rule and the stop rules plan 1 added);
- the config schemas and their unknown-key refusal (`phax validate`);
- `src/schemas/status.ts`, `src/schemas/reviewStop.ts`, `src/schemas/interactiveSession.ts`, `src/schemas/persisted.ts`, `packages/schemas`.

Points the spec leaves to planning (§10 "Left open"). Settle each in Technical arbitrations:
- message and output spelling, and whether `phax run --dry-run` prints the resolved hold;
- the held seed's wording, and whether it embeds the reconciliation or points to it;
- where the `hold` check sits in RUN_PREFLIGHT_CHECKS;
- where the latest authored commit of a pair is recorded so the discharge reads it without git (oracle-phases builds its requests from status.json facts only): a required field, never decoded as optional;
- how a held phase's closing turn reads its corrections: the diff against the phase commit;
- which reconciliation a held phase keeps: its own, against its base, unchanged, plus the review corrections against the phase commit.

Lessons from plan 1's review (#157). Its run left nine plan defects; plan for these from the start:
1. **Every failure after the stop is parked returns to the stop.** Check the stopped worktree before `RunResumeRequested`, and compute anything the close reads inside the close, so a missing file is a close error, never a failed run.
2. **A person's own commit is refused with its remedy.** At a held stop, HEAD at the first close must be the phase commit (status.json `commitHash`), as it is the phase base at a declared stop.
3. **A refused turn's edits are set aside and restored** (moved byte for byte to `refused-turn-NN/`), at both stops.
4. **Turn prompts name the exact `$schema` URL** of the answer they ask for.
5. **Effects are traced.** Use `src/app/telemetry/stopTelemetry.ts` for the held close, the oracle step at closing included, and pin a held stop's trace in an e2e semantic trace snapshot next to the declared one.
6. **Tests never read `~/.phax`**, through HOME or through a loader: mock `loadProviderConfig` and its siblings as the stopped-run suites do.
7. **Every in-scope §8 criterion has a test**, including: the hold recorded for each form; the five malformed values; the preflight's five refusals with no run named; the hold fixed through a rate-limit pause and a declared stop; the held stop's output and exit 13 with no agent turn after the commit; the held seed; the review commit and its trailer and author; the unchanged close with no commit and no exit 9; reset at a held stop; both oracle-pair runs and the held discharge's three cases.

Raise an open question for any arbitration whose options differ in a security or autonomy loss, for example:
- the closing turn of a held stop resuming a builder session that ran with write access: say which posture the resume carries on each provider;
- a review that weakens an oracle assertion at a stop before the discharge, which `authored` re-judges, against one at a held discharge, which q-held-discharge lets through under the configured gate only.

Constraints:
- **Layers** as in CLAUDE.md. The hold grammar and resolution, the held seed, the review-stop document and the oracle-commit choice are pure domain or app logic. Every file write, git operation and provider spawn goes through its port.
- **State transitions** only through `src/domain/state.ts` and the reducer. The held stop enters `awaiting_review` from a committed phase; there is no `held` state.
- **No back-compat shims, explicit per-variant enums**: hold selection, stop cause (`declared | held`), session origin (`first-turn | new-session | builder`), review-stop one variant per cause.
- **Provider-agnostic.** The builder session id comes from the phase's headless stream, as today.
- **No network.** phax prints or execs a provider's own CLI.
- **Autonomy:** only a plan-declared interactive phase or a phase the operator held stops; no agent prompt mentions how to stop a run; a run with no terminal stops and exits 13 without waiting.
- **Fixtures** are made up (the invoice-export run, Ada Example, `./fake-oracles`, the session ids). Fake provider CLIs keep their session stores under a test HOME. Tests assert `$schema` URLs by format id and release pattern.
- **Gates:** every phase is verified by the `standard` gate profile, and every command it runs must be allowed by `phax.json`.
- **Skill edits:** if the phax-planning skill changes (the oracle-pair rule now lets an interactive phase sit inside a pair), the plan says `phax run --allow-skill-edits`.
- **Models:** follow the phax-planning skill's model policy, with `assignmentReason`. This repository declares no assignment bounds.
- **Lint:** the plan must pass `phax plans lint`.

Docs:
- `phax --usage` for `run --hold` and every command whose behaviour changes at a held stop, regenerated with the usage spec and the CLI reference;
- README §Interactive phases: the hold, the held stop and its close, and the oracle-pair review; remove "This release does not allow one between the two phases of an oracle pair" and the "`--hold oracle`, coming with interactive phases" wording in §Oracle phases;
- `docs/oracle-phases.md`: the review inside a pair, the `authored` re-run, the latest authored commit and the held discharge;
- docs/upgrading.md: `hold` in run-status, if the release notes need it;
- `NEXT_STEPS.md`: interactive-phases, plan 2 of 3.

Phase shape: as few phases as the gates allow, from the core outwards, with every commit green. Keep `--hold` refused, or unregistered, until the phase that can close a held stop, so that no commit lets a run stop where it cannot close. A likely order:
1. the persisted shapes, the hold grammar and resolution, and the preflight;
2. the held stop: stopping after the commit, the seed, the review-stop variant, exit 13, and the commands while held;
3. closing a held stop, with the review commit, the record at closing and the next phase; `--hold` enabled;
4. the oracle-pair rules, with the §5.11 finding removed;
5. the docs and the skill.

A first draft of this plan (`docs/plans/archive/2610230951-interactive-phases-plan.md`, abandoned) was reviewed against the code. Read it: its phase split, its persisted-shape analysis (0.26.0 is uncut, so the formats change in place with no frozen decoder; `toLatestRunStatus` in `packages/schemas/src/formats/runDirectory.ts` splits on `"hold" in value`), keeping `--hold` unregistered until the close works, placing the `hold` step in `freshRunPreflight`, the held close's parity with plan 1's fixes, `isStopArtifact`, and its Technical arbitrations were sound, so keep what holds. Fix what the review found:
1. **A held phase that paused on its handoff must still stop.** The draft accepted `ReviewStopReached` with cause `held` only from running/{committed}. No event moves a phase out of `handoff_failed` after a resumed handoff succeeds (`src/app/handoffGeneration.ts` dispatches only `HandoffMissing`; `RunResumeRequested` keeps the phase state; `CleanupStarted` and `FinalReviewOpened` accept `handoff_failed` for that reason). Accept it from {committed, handoff_failed}, and test a hold kept through a handoff pause.
2. **A close finished from a commit that already landed keeps its oracle step.** `finishLandedCommit` rebuilds the report from git alone. Recover whether that close ran `authored` (for example from the landed commit's `Gate-Log` and the attempt's oracle request and attribution), so the latest authored commit is never skipped. Test an authored close interrupted after its commit.
3. **No read or failure after a commit or a close fails the run.**
   - Read what the held phase's record needs (`agent-binding.json` and the rest) inside the close or before `RunResumeRequested`, never after `HeldStopClosed`.
   - The hold point runs after the phase commit with the provider set, so a `stopAtHeldPhase` failure reaches the `tapError` in `executePlan` that writes a `failed` record for a committed phase. Keep that path from writing a record, and keep the run at the stop or resumable.
   - Skip the discharge pre-check (`oracleCommitOf`) on a stop re-entry, or run it before `RunResumeRequested`.
4. **The held phase's record is a Technical arbitration, not a question.** Decided: the record the phase would have written at its commit, written at closing, with `sourceSha` the phase commit (status.json `commitHash`, never HEAD), the builder's provider, model, effort and session, and the phase folder minus the stop's files (`isStopArtifact`). The review commit carries no `Phase-Id` trailer, and `records explain` on it finds no record until plan 3. Write no record while held. State that on mistral-vibe, where usage is read from the session's `meta.json` by session id, a closing turn that resumed the builder's session is counted in the agent's usage, or exclude it.
5. **`CloseReport` stays per variant.** A held unchanged close has no commit. Model the report as a union by cause and outcome rather than a nullable `commit`, and list `src/cli/commands/stopOutput.ts` (it slices the commit) and every other reader.
6. **The hold grammar is `phase-NN`.** §5.12 and the run-status shape say `phase-NN`: `--hold phase-100` exits 1, like `phase-2`.
7. **The global reconciliation selects corrections by the phase's `stop`** (held, closed, corrected) and treats a missing correction reconciliation as an error, as `readReviewCorrections` does.
8. **The oracle-edit warning's trace** needs an extension of `src/app/telemetry/stopTelemetry.ts` (its `tracedStep` records only a name and a result): plan it.
9. **Phase sizes:** the held-stop phase (seed, review-stop builder, stop, `executePlan`, output, the five commands, fixtures, suites) is too large for one phase; split the commands while held into their own. The end-to-end phase mirrors the declared re-entry block and fits sonnet at high unless a reason says otherwise.
10. **Test wording:** name files exactly, for example "phase-02's `phase-handoff.md`", not "phase-03's previous headless phase's handoff".

Decided by the operator on 2026-10-23, from that review. Record each in Technical arbitrations with the loss it accepts; do not raise them again:
- **q-held-closing-posture: read-only resume of the builder on every provider.** Claude Code resumes it with its reading tools and no shell (q-turn-shell). codex resumes it with `exec resume` and `sandbox_mode="read-only"`, `approval_policy="never"`. mistral-vibe keeps the phase posture (q-vibe-turns). The worktree comparison and the handoff-file check run after every turn. Loss accepted, against the recommendation of a new read-only codex session: codex merges a rollout's persisted permissions on resume, so a builder that ran `workspace-write` may keep it over the `-c` override, and the closing turn could then write outside the worktree, where no comparison looks. Pin the codex resume argv in a test, and say in the README that on codex the read-only override is the provider's to honour. A build-posture resume is not an option: it breaks q-turn-shell.
- **Interrupts never drop a hold or a record: resumable.** On resume, a non-final phase of the run's hold that is `committed` (or `handoff_failed` with its handoff now valid) with `stop` null re-enters the hold point and stops, instead of reading as done (`resume.ts` treats a non-final committed phase as terminal today). A close interrupted between `HeldStopClosed` (or the declared stop's commit) and the cleanup writes the record it owes on the next resume, once. Test both: a hold point interrupted before `ReviewStopReached`, and a close interrupted before its cleanup.
- **q-discharge-oracle-edit: flagged.** A held discharge's close goes on under the configured gate alone, prints one warning per oracle file the corrections changed (the discharge was judged before the stop and the change is not judged again), and records those files in the close's trace. It refuses nothing and writes no persisted field.

Output: your final message is the plan document JSON and nothing else — no sentence before or after it, no code fence.
