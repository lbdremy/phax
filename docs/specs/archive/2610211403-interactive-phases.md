---
status: Completed
date: 2026-10-21
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
approved:
  date: 2026-10-24
  baseline: 6a3531f
---
# Interactive phases: a stop where a person corrects the pattern, declared by the plan or held by the operator, with any editor and any agent CLI

## 1. Context

phax runs a plan's phases in order. Each phase gets its own worktree on `<run.branch>--phase-NN`, branched off the previous phase's branch. A headless agent session does the work and the gate runs; a same-session fix loop repairs a red gate. The agent writes `.phax-context/phase-handoff.md` in four sections (What was delivered, Key decisions and why, Exact locations, What the next phase needs to know), which phax validates and copies to `<run>/<phase>/phase-handoff.md`. phax then commits the phase and writes its record when records are configured. For a non-final phase it then runs the cleanup commands, which leave the worktree on disk, and starts the next phase. The next phase's prompt carries only the immediately previous handoff. The last phase runs run completion and stays open in `review_open`, where auto-compliance and auto-publish run.

Runs stay autonomous (decided 2026-10-10). A run stops only on a cause a machine detects: a rate or usage limit (exit 8), an exhausted or refused gate (exit 4), a phase with no change (exit 9), or a failed commit or cleanup. Each pause writes `resume-instructions.md`, and `phase-decision-requests` is parked. Inside a phase worktree, which phax recognises by its `.phax-context/` folder, the phase guard refuses `resume`, `enter-phase`, `shell`, `open`, `run`, `reset-phase` and the artifact transitions.

The interactive-phases spec approved on 2026-10-20 added the one sanctioned exception: a phase the plan declares interactive, where phax runs a read-only first turn, stops in `awaiting_review` with exit 13, and closes the phase on `phax resume`. PR #151 landed its plan-shape part: the required per-phase `mode` key, the `**Mode:** interactive` line, its rendering and lift, and an `interactive` check that refuses every interactive phase as not yet supported. No plan has started its runtime.

A friend runs a fork of phax with a hold mode, which he built with phax and uses daily through his own review UI. With `phax run --hold`, or a phax.json key, every non-final phase stops `held` with exit 0 once it has committed. `phax phase revise` runs the fix loop in the builder's session and commits `fixup! <subject>`, and `phax phase approve` continues. A UI polls an unversioned `phax ls --json` for `state: "held"`. He reviewed our three specs and raised two points. First, a person often learns which phase needs them while reading it, not while planning. Second, an oracle phase's tests define the API before the code exists, so a person should be able to review them, yet oracle-phases §5.11 and §5.12 refuse an interactive phase inside an oracle pair. He wants to fold his hold into our `awaiting_review`, so that his fork carries only a flag.

The code today, re-checked on 2026-10-21:
- RunState and PhaseState have no waiting state, and the reducer has no event that stops a run for a person.
- A phase's record is written right after its commit, before cleanup.
- `phax ls --json` prints a bare array with no `$schema`.
- run-status.json carries several optional keys, and its schema history holds only a pre-schema decoder.
- The codex and vibe session adapters answer `unsupported` for interactive resume.
- `codex resume <id>` was verified on 2026-10-19 to continue a `codex exec --json` session interactively; its first open of a new directory asks the person to trust it, then to review its hooks. `vibe --resume <id>` is unverified.
- Every headless turn (`claude -p`, `codex exec --json`, `vibe -p`) reports its session id in its stream, so phax already holds the builder session of every headless phase.
- Since Claude Code 2.1.280, a `--resume` invocation reports cost cumulatively over the whole session.
- phax has read-only modes for Claude Code (its read-only tool set) and codex (`sandbox_mode="read-only"`), and none for vibe.

The 2026-10-18 spike showed that the stop by itself is the value. Seeded with the executed phases' handoffs and the upcoming phases' intent, an agent in the stopped worktree saw, unprompted, that 'any flaw will spread to all four' later phases. It then turned a review comment into a fix plus a test.

Ground read:

- `docs/specs/2610190947-interactive-phases.md` — The approved spec this one re-authors (Approved 2026-10-20). No plan has started its runtime. Its problem, product goal, nine arbitrations (q-mode-line, q-planned-work, q-person-handoff, q-new-session, q-precedence, q-exit-code, q-unchanged-commit, q-transcript-records, q-count-interactive) and the joint phase-shape decisions J1–J5 are carried over here. Its 2026-10-19 ground read (phaxPlan.ts, planDocument.ts, parsePlanMarkdown.ts, promptGeneration.ts, handoffInjection.ts, resume.ts, resumeInstructions.ts, backend.ts, claude.ts, enterPhase.ts, phaseAgentBinding.ts, codexCli.ts, mistralVibe.ts, decideArtifact.ts, runPreflight.ts, headless-review, assignment-bounds, the review-screen spike) still holds, and this spec relies on it.
- `docs/briefs/interactive-phases-hold.md` — The brief for this re-authoring. It holds the operator's five decisions of 2026-10-21, which are not reopened: the operator may hold a run when it starts, with one state and one exit code; a held phase is the headless phase that just committed; a person may review an oracle phase before its discharge; the three forms of `--hold`; and a stable `$schema` surface for a review UI. It also summarises a friend's fork with a hold mode, for reference only.
- `docs/specs/2610201518-oracle-phases.md` — Approved 2026-10-20. §5.11 refuses an interactive phase strictly between an oracle phase and its discharging phase. §5.12 refuses an interactive phase in an oracle role (q-interactive-role, refuse). §5.19–§5.22 run the oracle step only at the oracle and discharging phases' gates. §5.35 makes the discharge judge the oracle phase's current commit. §5.36 resets the discharge before its oracles. A §10 bullet states that the discharge always judges the oracle phase's own commit, because no person's correction can land between the two phases. Decision 3 of 2026-10-21 revises those rules.
- `docs/plans/2610211221-oracle-phases-plan.md` — oracle-phases' first plan (Draft). It implements the §5.11 and §5.12 findings on the `oracles` check as they stand and leaves `unsupportedInteractiveFindings` and the `interactive` check untouched.
- `src/domain/plan/interactiveCheck.ts` — Landed in PR #151. The `interactive` check reports malformed Mode lines, then `unsupportedInteractiveFindings`, which refuses every interactive phase with 'this phax cannot run an interactive phase yet'. The runtime plans of this spec replace that refusal with the placement and planned-work rules.
- `src/domain/state.ts` — RunState: created, running, failed, review_open, completed, stopped, archived, interrupted, rate_limited. PhaseState: pending, setting_up_worktree, running, gates_failed, gates_exhausted, fixing, failed, passed, committed, cleaning_up, cleaned_up, review_open, handoff_failed, skipped, rate_limited. The flat transition functions are marked deprecated, superseded by the reducer over the hierarchical PhaxState. No state waits on a person.
- `src/domain/reducer.ts` — The reducer interprets events (RunStarted, RunResumeRequested, GatePassed, CommitCreated, CleanupStarted, FinalReviewOpened, RateLimitDetected, PhaseResetRequested and others) against PhaxState. No event stops a run for a person.
- `src/app/executePlan.ts` — Per phase: worktree, work session, gate and fix loop, handoff, commit. When records are on, the phase record is written right after the commit. A non-final phase then runs its cleanup commands, and the next phase branches off its branch through `previousPhaseBranch`. The final phase runs run completion, then FinalReviewOpened (review_open), then auto-compliance and auto-publish. A resume re-enters from the persisted phase state: gates_exhausted, handoff_failed, passed, cleaning_up, or a committed final phase.
- `src/app/cleanup.ts` — Cleanup refuses a dirty worktree and runs the cleanup commands. It does not remove the worktree.
- `src/cli/commands/ls.ts` — `phax ls --json` prints a bare JSON array of rows (namespace, shortName, state, branch, currentPhase, gateProfile, updatedAt, lockState, recordsPending, archivePath, qualifiedName) with no `$schema`. `recordsPending` and `archivePath` are dropped when undefined. The filters are --active, --failed, --review-open and --archived.
- `src/schemas/status.ts` — run-status.json is the `run-status` format: `$schema`, then namespace, shortName, runId, state, createdAt, updatedAt and phasesCount, plus the optional currentPhaseIndex, gateProfileId, stoppedReason, lastError, planRepoRelPath and allowSkillEdits. Unknown keys are ignored. A phase's status.json (`phase-status`) carries an optional claudeSessionId and worktreePath.
- `packages/schemas/history.lock.json` — run-status has only a frozen pre-schema decoder, and phase-status has 0.17.0 and pre-schema decoders. A change to either shape gets a next snapshot and a frozen decoder of the current shape.
- `src/domain/security/phaseGuard.ts` — A phase worktree is a linked worktree whose root holds `.phax-context/`. Inside one, resume, enter-phase, shell, open, run, reset-phase and the artifact transitions are refused, while ls, path and session-info are allowed. A unit test makes every registered command classified.
- `src/domain/session/codex.ts` — Interactive resume and pre-prompted start still answer `unsupported`, naming `codex exec resume <session-id>`. `codex resume <id>` was verified on 2026-10-19 with codex-cli 0.153.4 but is not lifted yet.
- `src/domain/session/mistral.ts` — Interactive resume answers `unsupported`, naming `vibe --resume <session-id>`. It is still unverified.
- `src/app/handoffGeneration.ts` — The headless agent writes `.phax-context/phase-handoff.md` in the worktree, and phax validates it and copies it to `<run>/<phase>/phase-handoff.md`. At a held phase that worktree path already holds the builder's handoff.
- `src/cli/commands/runLayers.ts` — EXIT_CODE_MEANINGS runs from 0 to 12: 1 is a generic failure or bad arguments, 2 plan or config validation, 4 a gate failure or refused step, 11 a security or preflight refusal. 13 is free.
- `phax.usage.kdl` — `phax run [short-name] --plan <path>` has an optional positional short name and no --json. `phax resume <short-name>` has --yes and --provider-priority. `phax session-info` has --debug and no --json.

## 2. Problem

A plan often has one phase that sets a pattern, such as a record shape, a wording, an error policy or a test style, and later phases that repeat it. Today a person first sees that pattern at the final review. By then it has been copied N times and must be corrected N times, and every later phase has read a handoff that described the uncorrected pattern as the one to follow.

The approved spec gave the planner a stop to declare, but a planner cannot always foresee which phase needs a person. The person often learns it while reading the run, and has no sanctioned way to ask for a stop the plan did not declare. Stopping a run by hand (interrupt it, edit the worktree, resume) is unsupported. The edits land in the next phase's commit and read as unplanned deviations, no handoff tells the later phases what changed, and nothing turns the correction into a guard.

Oracle-first plans make this sharper. An oracle phase's tests define the behaviour before any code exists, which is the moment a person should review them, as a spec is reviewed. oracle-phases refuses every review between an oracle phase and its discharge, so the tests that will judge the code are never reviewed before they do.

The fork shows the demand, and why a fork is the wrong home for it. It adds a second waiting state, exits 0 at a stop, runs phax's agent to rewrite code after the person's review, and leaves `fixup!` commits that phax never squashes. A UI can build on it only through an unversioned `phax ls --json`.

## 3. Product goal

A run stops for a person in two ways, with one state (`awaiting_review`) and one exit code (13).

- **Declared stop.** The planner declares a phase interactive. When the run reaches it, phax sets up its worktree, writes a seed and runs one read-only headless first turn that reports the pattern at stake.
- **Held stop.** The operator, when starting the run, asks phax to hold selected headless phases: all of them, the listed ones, or the oracle phases. A held phase does its work, passes its gate, commits and writes its handoff as today, then stops before its cleanup, with its worktree, branch and builder session kept.

At either stop, phax prints the provider's own command to continue the current session and writes a versioned `review-stop` document that `phax ls --json` also carries, so a review UI can read and close the stop without parsing prose. The person corrects in the worktree by hand, in the continued session or with any other agent CLI, and turns each correction into a guard where they can.

`phax resume` closes the stop:
- it runs the gate and returns a red gate to the person;
- it gets an interactive handoff and captures the transcripts;
- it commits the corrections: as the phase's own commit at a declared phase, and as one review commit on top of the unchanged phase commit at a held phase;
- it continues the run.

Every later phase reads the correction under `## Review corrections`, and the gates hold it to the guards. A review inside an oracle pair re-runs the `authored` verdict when it touches an oracle file, and the discharge is judged against the latest commit that passed it.

The plan is never rewritten, no agent ever stops a run to ask, and every input and output of the stop is a file or a phax command, on every provider phax drives.

> A run stops for a person only where its approved plan declares it or the operator asked when starting it; phax gates, commits and hands off the worktree's diff whatever made it, and every input and output of the stop is a file or a phax command.

## 4. Terminology

- **Mode** — A phase's required `mode` field, placed directly after `optionalFilesToEdit` in a phase of the plan document and of phax-plan.json. Its value is exactly `headless` or `interactive`. Landed in PR #151.
- **Interactive phase** — A phase whose mode is `interactive`. Like any phase, it has its own id, branch, worktree, gate, commit and handoff, and it builds on the previous phase. It plans no file to create or edit, and its optional files may name what the person is expected to touch. Its Detailed instructions say what to review, which pattern is at stake and which later phases repeat it.
- **Headless phase** — A phase whose mode is `headless`: an agent session does its work.
- **Hold** — The operator's request, given to `phax run` with `--hold`, that selected headless phases stop for a person once they have committed. It is resolved against the plan and recorded in run-status.json when the run is named.
- **Hold selection** — The recorded form of the hold. `selection` is exactly `none` (no `--hold`), `all` (`--hold` with no value), `listed` (`--hold phase-02,phase-04`) or `oracle` (`--hold oracle`). Every variant except `none` carries the resolved phases in plan order.
- **Held phase** — A headless phase in the run's hold selection. It is the same phase, with the same id, branch and worktree, and is not a new phase in the plan.
- **Stop** — A run waiting for a person in `awaiting_review`, either at a declared interactive phase or at a held phase. The phase it waits at is the stopped phase.
- **Stop cause** — Why a run stopped: exactly `declared` (a plan-declared interactive phase) or `held` (a phase of the operator's hold).
- **Phase commit** — The commit a held phase made before it stopped, after its gate passed. It is never amended.
- **Review commit** — The one commit that a held phase's corrections leave on its branch, on top of its phase commit, with a `Held-Phase: <phase id>` trailer.
- **Builder session** — The headless agent session that did a held phase's work. phax learned its id from the session's own stream.
- **Pattern** — A choice an executed phase made that later phases are planned to repeat, such as a record shape, a wording, an error policy or a test style.
- **Seed** — The file phax writes at a stop: `.phax-context/interactive-review.md` in the worktree, with an identical copy, `review-seed.md`, in the phase's run folder. It is never committed.
- **First turn** — A headless turn that reads the seed and answers a first-reading document, never changing the worktree. phax runs one at every declared stop, and at any stop on `phax enter-phase --new-session`. It is a new session of the phase's provider, model and effort in the worktree, never a resume of an earlier session.
- **First reading** — The first turn's answer: a versioned `first-reading` document naming the pattern at stake and what each upcoming phase will copy. phax renders it to `first-reading.md` in the phase's run folder.
- **Recorded session** — A session phax knows the id of at a stop, recorded in `interactive-session.json` with its provider, model, effort, id, start time and origin. `origin` is exactly `first-turn`, `new-session` or `builder`. The most recent one is the current session.
- **Interactive resume support** — Whether a provider's own CLI is verified to continue a headless-started session in its interactive UI: exactly `verified` (claude-code, codex) or `unverified` (mistral-vibe).
- **Continue command** — The provider's own command that continues the current session interactively in the worktree: `claude --resume <id>` or `codex resume <id>`, carrying the phase's model, effort and posture flags. phax prints it only for a `verified` provider.
- **Fresh-start command** — The provider's own command that starts a new interactive session in the worktree, with an initial prompt pointing at the seed. phax prints it when there is no current session, or when the provider is `unverified`. phax never learns that session's id.
- **Person** — Whoever works in the stopped phase's worktree. phax knows them only by the git identity of the checkout that closes the stop.
- **Correction** — A change in the stopped phase's worktree: since the previous phase's commit at a declared stop, and since the phase commit at a held stop. It may be made by hand or by any agent.
- **Guard** — A test, lint rule or gate step that fails when a correction is undone or ignored.
- **Interactive handoff** — The handoff a stop produces, with the sections `## What was corrected`, `## The pattern to follow from now on`, `## Guards` and `## What the next phases need to know`. At a declared stop it is the phase's handoff, `<run>/<phase>/phase-handoff.md`. At a held stop it is `<run>/<phase>/correction-handoff.md`, beside the phase's own unchanged handoff.
- **Person's handoff file** — `.phax-context/correction-handoff.md` in the stopped phase's worktree, which the person may write instead of letting a closing turn write the interactive handoff.
- **Closing turn** — The headless turn that writes the interactive handoff at closing. It resumes the current session when there is one, and starts a new session otherwise. It answers a versioned `interactive-handoff` document and must not change the worktree.
- **awaiting_review** — The run state and phase state of a stopped run, whatever the cause. It is resumable and not a failure, and it is distinct from the run's final `review_open`.
- **Closing** — What `phax resume` does to a run in `awaiting_review`: it gates, gets the interactive handoff, captures the transcripts, commits when there is something to commit, and continues the run.
- **Outcome** — How a stop closed: `corrected` when the worktree changed, `unchanged` when the person reviewed and changed nothing.
- **review-stop document** — A versioned `review-stop` document describing the current stop: run, state, cause, stopped phase, worktree, seed, current session and the commands that act on it. phax keeps it as `<run>/review-stop.json` while the run waits.
- **run-list document** — The versioned `run-list` document that `phax ls --json` prints. Its runs each carry a required `stop`: the run's review-stop document, or null.
- **Interactive transcript** — The provider's own record of a recorded session, copied at closing to `interactive-transcripts/<session id>.jsonl` in the phase's run folder.
- **Oracle phase, discharging phase, oracle files, authored and discharged verdicts** — As defined by oracle-phases. An oracle phase writes tests carrying expected-failure markers, and its discharging phase removes the markers and implements the code. An oracles provider judges both gates with an `authored` or `discharged` verdict.

## 5. Functional requirements

### 5.1 The per-phase mode

The system SHALL carry a required `mode` field on every phase of `phax-plan.json` and of the plan document, placed directly after `optionalFilesToEdit`, with a value of exactly `headless` or `interactive`, and SHALL reject a phase that lacks the field or holds any other value.

### 5.2 Reading the mode from plan.md

WHEN phax parses or extracts a plan.md THE system SHALL give `mode: "interactive"` to each phase whose header paragraph carries the `**Mode:** interactive` line, and `mode: "headless"` to every other phase.

### 5.3 Rendering the mode

WHEN phax renders a plan document to plan.md THE system SHALL write the `**Mode:** interactive` line in the header paragraph of each interactive phase, after its `**Recommended model:**`, `**Recommended effort:**` and, when it has one, `**Assignment reason:**` lines, and SHALL write no Mode line on a headless phase.

### 5.4 One lift with assignment-bounds

WHEN `phax artifact migrate-documents` lifts a live plan sidecar stamped at the 0.25.0 plan-document shape or below THE system SHALL give every phase `mode: "headless"` in the same lift that carries `modelReason` over as `assignmentReason` (assignment-bounds), and SHALL add no Mode line to its plan.md.

### 5.5 Lint: where an interactive phase may sit

IF an interactive phase is the plan's first phase or its last phase, or directly follows another interactive phase, THEN `phax plans lint` SHALL report an error on the `interactive` check, naming the phase and the rule it breaks.

### 5.6 Lint: an interactive phase plans no work

IF an interactive phase lists a planned file to create or to edit THEN `phax plans lint` SHALL report an error on the `interactive` check, naming the phase and the file.

### 5.7 An interactive phase is held to the bounds

The system SHALL hold an interactive phase to the assignment bounds like any phase. Its governing bound is the first bound that matches any of its optional files. Its model and effort are checked against that bound, or against the policy default when none governs, with its `**Assignment reason:**` line read as for any phase. Its first turn and closing turn SHALL run at that model and effort.

### 5.8 One interactive check

The system SHALL compute the `interactive` findings (where an interactive phase sits and whether it plans work) in one domain check that `phax plans lint` and the run preflight both call, so that an error lint reports is the error the run preflight refuses on.

### 5.9 The run preflight refuses an ill-placed interactive phase

IF the `interactive` check reports an error when `phax run` or `phax resume` runs its preflight THEN the system SHALL refuse before any phase starts (for `phax run`, before the run is named), print every error of the check naming its phase, leave an existing run's state unchanged, and exit 11.

### 5.10 The planning skill

The phax-planning skill SHALL say to declare an interactive phase directly after the first phase that sets a pattern at least one later phase repeats, and never by default, since the operator can hold any other phase when the run starts. It SHALL give the Mode line, and SHALL say that the phase's Detailed instructions name what to review, the pattern at stake and the later phases that repeat it.

### 5.11 The hold option

The system SHALL accept on `phax run` a `--hold` option in exactly three forms: `--hold` with no value, `--hold oracle`, and `--hold <phase id>[,<phase id>…]` where each phase id matches `phase-NN`.

### 5.12 A malformed hold value is refused

IF the value given to `--hold` is neither exactly `oracle` nor a comma-separated list of distinct phase ids matching `phase-NN` THEN `phax run` SHALL refuse before the run is named, naming the value and the three accepted forms, and exit 1.

### 5.13 Resolving the selection

WHEN `phax run` starts with `--hold` THE system SHALL resolve the selection against the plan, in plan order: with no value, every headless phase except the final phase; with `oracle`, every phase whose `oracle` is not null; with a list, the listed phases.

### 5.14 The hold preflight

IF the hold selection is invalid for the plan (a listed phase is not in the plan, is interactive or is the final phase, or the selection resolves to no phase) THEN the run preflight SHALL refuse on the `hold` check before any phase starts and before the run is named. It SHALL print every error of the check, each naming its phase, and exit 11.

### 5.15 The hold is recorded with the run

WHEN `phax run` names a run THE system SHALL record its hold in `run-status.json` as a required `hold` field. The field's `selection` is exactly `none` (no `--hold`), `all`, `listed` or `oracle`, and every selection except `none` carries the resolved phases in plan order.

### 5.16 The hold is fixed for the run

WHILE a run exists THE system SHALL hold exactly the phases its recorded hold resolved when the run was named, through every `phax resume`, and SHALL accept no `--hold` option on `phax resume`.

### 5.17 The hold comes only from the flag

The system SHALL take a hold only from the `--hold` option of `phax run`, and SHALL reject a hold key in any configuration layer as an unknown key, with exit 2.

### 5.18 Reaching an interactive phase

WHEN a run reaches an interactive phase THE system SHALL create its worktree on its own phase branch, off the previous phase's branch, and run the project's phase setup commands. It SHALL run no work session, no gate and no fix loop for the phase.

### 5.19 The seed at a declared stop

WHEN an interactive phase's worktree is set up THE system SHALL write the seed to `.phax-context/interactive-review.md` in the worktree and to `review-seed.md` in the phase's run folder. The seed SHALL hold what is expected of the person (correct the pattern, add guards, keep the scope), the phase's own Detailed instructions, every executed phase's handoff in plan order, the upcoming phases' plan sections, the path of the full plan, the gate commands and the closing command.

### 5.20 Stopping at a held phase

WHEN a phase of the run's hold has committed and its handoff has been validated THE system SHALL stop the run at that phase, before the phase's record and its cleanup commands. It SHALL keep the phase's worktree at the phase commit, its branch and its builder session, and start no later phase.

### 5.21 No agent turn at a held stop

WHEN a run stops at a held phase THE system SHALL run no agent turn. It SHALL record the phase's builder session as the current session in `interactive-session.json` with origin `builder`, or record no current session when the phase recorded no session id.

### 5.22 The seed at a held stop

WHEN a run stops at a held phase THE system SHALL write the seed to `.phax-context/interactive-review.md` in the worktree and to `review-seed.md` in the phase's run folder. The seed SHALL hold what is expected of the person, the phase's own plan section, its handoff, its file reconciliation, its base and phase commit, every earlier phase's handoff in plan order, the upcoming phases' plan sections, the path of the full plan, the gate commands and the closing command.

### 5.23 The stop's files are never committed

The system SHALL never include the seed, `first-reading.md`, `interactive-session.json`, `review-stop.json`, the person's handoff file or an interactive transcript in any commit of the run's branches.

### 5.24 The first turn

WHEN the seed of a declared stop is written THE system SHALL run the first turn: a new headless session of the phase's provider, model and effort in the worktree, never a resume of an earlier session, whose prompt asks it to read the seed and answer a versioned `first-reading` document.

### 5.25 The first turn is recorded

WHEN a first turn returns a valid first-reading document THE system SHALL record the session's provider, model, effort, session id, start time and origin as the current session in `interactive-session.json` in the phase's run folder, and SHALL write the rendered first reading to `first-reading.md` beside that file.

### 5.26 phax's turns run read-only where they can

The system SHALL run every first turn and every closing turn under the phase's security posture, narrowed to the provider's read-only mode wherever phax has one for that provider: Claude Code's read-only tool set and codex's read-only sandbox.

### 5.27 A first turn that edits is refused

IF the worktree's tracked files, or its untracked files that are not ignored, differ after a first turn from before it, THEN the system SHALL restore them to their state before the turn, record no session for that turn, and treat the turn as a failed first turn, naming the changed files.

### 5.28 A failed first turn still stops

IF the first turn of a declared stop fails (a rate or usage limit, a provider error, or an answer that is still not a valid first-reading document after one corrective resume) THEN the system SHALL still stop at the interactive phase with no current session, name the failure, and print the fresh-start command in place of a continue command.

### 5.29 Awaiting review

WHEN a run stops, at a declared phase once its first turn has ended (whether or not it succeeded) or at a held phase, THE system SHALL move the phase and the run to `awaiting_review` with the stop's cause, exactly `declared` or `held`. It SHALL write `resume-instructions.md` for that kind, release the run lock and exit 13.

### 5.30 The stop's output

WHEN a run stops THE system SHALL print the stop's cause, the stopped phase, the first reading when there is one, the phase commit at a held stop, the worktree path, the seed path, the continue or fresh-start command, `phax enter-phase`, the closing command and the path of the review-stop document.

### 5.31 No terminal, no wait

WHILE phax runs without a terminal THE system SHALL stop at a declared or held phase exactly as it does with one, and SHALL never read stdin or wait for input there.

### 5.32 The only stops for a person

The system SHALL stop a run to wait for a person only at a phase whose `mode` is `interactive` or at a phase of the run's recorded hold.

### 5.33 The review-stop document

WHILE a run is in `awaiting_review` THE system SHALL keep in its run folder a `review-stop.json` document with a required `$schema`. The document SHALL name the run, the state, the cause, the stopped phase, the worktree, the seed, the current session or that there is none, and the commands that continue, enter, close and reset the stop. A declared stop's document SHALL also carry the first reading's path, and a held stop's document the phase commit.

### 5.34 The review-stop document goes with the stop

WHEN a run leaves `awaiting_review` THE system SHALL remove its `review-stop.json`.

### 5.35 phax ls --json is a versioned run list

WHEN `phax ls --json` runs THE system SHALL print one `run-list` document with a required `$schema`. Each of its `runs` SHALL carry the run's state and a required `stop`: the run's review-stop document while it is in `awaiting_review`, and null otherwise.

### 5.36 Interactive resume support per provider

The system SHALL hold each provider's interactive resume support as exactly `verified` or `unverified`: `verified` for claude-code and codex, and `unverified` for mistral-vibe.

### 5.37 The continue command

WHERE the current session's provider has `verified` interactive resume support THE system SHALL print as the continue command that provider's interactive resume of the current session in the worktree (`claude --resume <id>` or `codex resume <id>`), carrying the phase's model and effort and the filesystem and network flags of the phase's security posture.

### 5.38 A provider whose interactive resume is unverified

WHERE the stopped phase's provider has `unverified` interactive resume support THE system SHALL print the fresh-start command, warn that a session started with it will not be captured, and keep the current session for the closing turn.

### 5.39 Visible as waiting, not failed

WHEN `phax ls` or `phax session-info` reads a run in `awaiting_review` THE system SHALL show the `awaiting_review` state, the stop's cause, the stopped phase and its worktree, distinct from failed and interrupted runs. `phax session-info` SHALL also show the current session, or that there is none, and `phax ls --awaiting-review` SHALL list only runs in `awaiting_review`.

### 5.40 The worktree commands target the stopped phase

WHILE a run is in `awaiting_review` THE system SHALL make `phax path`, `phax shell` and `phax open` target the stopped phase's worktree.

### 5.41 enter-phase continues the current session

WHEN `phax enter-phase <run> <phase>` targets the stopped phase of a run in `awaiting_review` THE system SHALL run the continue command when there is a current session and its provider has `verified` interactive resume support, and the fresh-start command otherwise.

### 5.42 enter-phase resumes codex sessions

WHEN `phax enter-phase` targets a headless phase whose recorded agent session is a codex session THE system SHALL resume that session interactively with `codex resume <id>` in the phase's worktree, instead of refusing it as unsupported.

### 5.43 --new-session starts another recorded session

WHEN `phax enter-phase <run> <phase> --new-session` targets the stopped phase of a run in `awaiting_review` THE system SHALL run a new first turn, make it the current session with origin `new-session` and keep the earlier sessions in the history of `interactive-session.json`, then run the continue or fresh-start command.

### 5.44 The worktree diff is the work

The system SHALL gate, commit and reconcile a stop by its worktree's changes, since the previous phase's commit at a declared stop and since the phase commit at a held stop, whatever made them: an editor, a continued session, or an agent phax did not start.

### 5.45 The phase guard holds

IF `phax resume`, `phax enter-phase` or any other command the phase guard refuses runs inside a stopped phase's worktree THEN the system SHALL refuse it, as for any phase worktree.

### 5.46 Closing runs the gate first

WHEN `phax resume <run>` targets a run in `awaiting_review` THE system SHALL run the stopped phase's gate on its worktree as it stands, before any agent turn.

### 5.47 A red gate returns the phase to the person

IF a step of the gate fails or refuses while a stop is closing THEN the system SHALL start no fix attempt and no agent turn, keep the attempt's log, commit nothing, leave the phase and the run in `awaiting_review` and exit 4.

### 5.48 The interactive handoff

The system SHALL accept as an interactive handoff only a document with, in this order, `## What was corrected`, `## The pattern to follow from now on`, `## Guards` and `## What the next phases need to know`, whose `## Guards` holds one entry per `## What was corrected` entry, in the same order, each naming a test, lint rule or gate step, or `no guard:` followed by the reason.

### 5.49 A handoff the person wrote takes precedence

WHERE the person wrote `.phax-context/correction-handoff.md` in the stopped phase's worktree THE system SHALL validate that file as the interactive handoff and use it, running no closing turn.

### 5.50 The closing turn resumes the current session

WHEN the gate passes on a changed worktree, the person wrote no handoff, and there is a current session, THE system SHALL run the closing turn as a headless resume of that session, given the diff of the corrections. It SHALL ask for a versioned `interactive-handoff` document and render the answer as the interactive handoff.

### 5.51 A closing turn without a usable session

IF there is no current session, or resuming it fails for a reason other than a rate or usage limit, THEN the system SHALL run the closing turn as a new headless session of the phase's provider, model and effort, given the seed and the diff of the corrections.

### 5.52 A closing turn that edits is refused

IF the worktree differs after the closing turn from the gated worktree THEN the system SHALL commit nothing, leave the changes in place, keep the phase and the run in `awaiting_review`, name the changed files and exit 5.

### 5.53 An invalid handoff commits nothing

IF the interactive handoff fails validation THEN the system SHALL commit nothing, keep the phase and the run in `awaiting_review` and name what is missing or out of place. It SHALL exit 1 when the handoff is the person's handoff file, and exit 5 when it is a closing turn's answer that is still invalid after one corrective resume.

### 5.54 A limit at closing keeps the stop

IF the closing turn hits a rate or usage limit THEN the system SHALL commit nothing, keep the phase and the run in `awaiting_review`, name the reset time and exit 8.

### 5.55 The transcripts are captured

WHEN a stop closes THE system SHALL copy each of its recorded sessions, including a held phase's builder session, from the provider's own session store into `interactive-transcripts/<session id>.jsonl` in the phase's run folder, after the closing turn and whether or not the person ever continued the session.

### 5.56 A missing transcript never blocks closing

IF a recorded session's transcript cannot be found or read THEN the system SHALL record it as missing, with the reason, and go on closing the stop.

### 5.57 The declared phase's commit

WHEN the gate passes and the handoff is valid on a declared phase whose worktree changed THE system SHALL commit the changes on the phase branch, with the plan's commit subject and body and an `Interactive-Phase: <phase id>` trailer, authored by the checkout's git identity. It SHALL record the phase `committed` with outcome `corrected` and continue with the next phase in the same invocation.

### 5.58 A declared phase reviewed without change

WHEN `phax resume` closes a declared phase whose worktree has no change THE system SHALL run the gate and use the person's handoff, or else a fixed reviewed-without-change handoff, with no closing turn. It SHALL make an empty commit on the phase branch with the plan's subject and the `Interactive-Phase` trailer, record outcome `unchanged`, and never treat the phase as having produced no changes (exit 9).

### 5.59 The review commit of a held phase

WHEN the gate passes and the handoff is valid on a held phase whose worktree changed THE system SHALL commit the corrections as one review commit on the phase branch, on top of the unchanged phase commit, with the plan's commit subject and a `Held-Phase: <phase id>` trailer, authored by the checkout's git identity, and SHALL record outcome `corrected`.

### 5.60 A held phase reviewed without change

WHEN `phax resume` closes a held phase whose worktree has no change THE system SHALL run the gate and use the person's handoff, or else the fixed reviewed-without-change handoff, with no closing turn. It SHALL make no commit, record outcome `unchanged`, and never treat the phase as having produced no changes (exit 9).

### 5.61 A closed held phase continues the run

WHEN a held phase has closed THE system SHALL run the phase's cleanup commands and start the next phase in the same invocation, branched from the phase branch's tip: the review commit, or the phase commit when nothing changed.

### 5.62 A held phase keeps its own handoff

The system SHALL leave a held phase's own handoff unchanged and write its interactive handoff beside it, as `correction-handoff.md` in the phase's run folder.

### 5.63 Later phases read the corrections

WHEN a phase after a closed stop is dispatched THE system SHALL put the interactive handoff of every earlier stop, declared or held, in plan order, in a `## Review corrections` section of its prompt. The section SHALL state that it takes precedence over the earlier phases' handoffs where they disagree, and that the phase's own plan section still binds.

### 5.64 The plan is not rewritten

The system SHALL run the phases after a stop from the plan as it was approved, and a stop SHALL change neither the run's `phax-plan.json` nor its plan.md.

### 5.65 Corrections are not deviations

WHEN phax reconciles a stop's corrections THE system SHALL report every file they changed as a review correction and none as an unplanned edit, and SHALL leave unchanged a held phase's reconciliation of its phase commit.

### 5.66 The compliance review

WHEN the compliance review runs on a run with a closed stop THE system SHALL present each stopped phase to the reviewer with its cause and its interactive handoff, so that its corrections are judged against that handoff and not as deviations from the plan.

### 5.67 The review handoff and the PR body

WHEN phax writes `review-handoff.md` or builds the PR body of a run with a closed stop THE system SHALL show each stop's phase, cause, outcome and the git identity that closed it, and `review-handoff.md` SHALL also show its corrections and their guards.

### 5.68 Records

WHEN records are configured and a stop closes THE system SHALL record the phase's mode, the stop's cause and outcome, the git identity that closed it, its recorded sessions (provider, model and id) or that there were none, and each transcript's sha256 or that it is missing. It SHALL never record an interactive transcript's content, whatever `records.transcript` says: the copy stays in the run folder, and `phax records explain` on the phase's commits SHALL name each transcript by its sha256.

### 5.69 A held phase's record is written at closing

WHEN records are configured and a held phase closes THE system SHALL write the phase's record once, naming its phase commit and its review commit when there is one, and SHALL write no record for the phase while it is held.

### 5.70 The posture is told honestly

The system SHALL record in a stopped phase's security record that the person's work, including a session they continued, ran outside phax's enforcement, and SHALL record the applied posture of each first turn and closing turn phax ran.

### 5.71 Cost of phax's turns

The system SHALL write a cost-ledger entry for each first turn and each closing turn, holding that turn's own cost rather than its session's cumulative cost, and SHALL write none for the turns of a session the person continued or of a session phax did not start.

### 5.72 Estimating an interactive phase

WHEN `phax plans estimate` sizes a plan with an interactive phase THE system SHALL name the phase as interactive, size only its first turn and closing turn, and leave the person's work out of the estimate.

### 5.73 Reset at a stop

WHEN `phax reset-phase` targets the stopped phase of a run in `awaiting_review` THE system SHALL ask for confirmation, naming the uncommitted corrections it would discard. It SHALL then remove the phase's worktree, its branch (a held phase's commit included) and its recorded sessions, so that a later `phax resume` runs the phase again from its start and stops at it again.

### 5.74 Reset the stopped phase first

IF `phax reset-phase` targets a phase before the stopped phase of a run in `awaiting_review` THEN it SHALL refuse, naming the stopped phase to reset first, and change nothing.

### 5.75 adjust-plan waits for the landing

IF `phax adjust-plan --landed <run>` names a run in `awaiting_review` THEN it SHALL refuse, naming the run's state, and start no session.

### 5.76 Archive treats the stop as unfinished

WHEN `phax archive` targets a run in `awaiting_review` THE system SHALL treat it as unfinished and refuse without `--force`, naming the state.

### 5.77 A review may sit inside an oracle pair

The `oracles` check SHALL report no finding for an interactive phase that sits strictly between an oracle phase and its discharging phase.

### 5.78 A review that changes an oracle file is judged again

WHEN a stop closes before its pair's discharging phase has run, and its corrections change one of that pair's oracle files, THE system SHALL run the oracle step with an `authored` request naming the stopped phase as `phase`, as the closing gate's last step, once every configured step has passed.

### 5.79 The discharge judges the latest authored commit

WHEN a discharging phase's gate runs THE system SHALL name as the `discharged` request's `oracleCommit` the latest commit of the pair that passed the `authored` verdict: the oracle phase's commit, or the commit of a later stop whose closing gate ran it.

### 5.80 A held discharge closes on its configured steps

WHEN a held discharging phase closes THE system SHALL run the gate profile's configured steps, which must all pass as at any phase's closing, and SHALL NOT run the oracle step again, since the discharge was judged before the stop.

### 5.81 Plans and runs without a stop

WHILE a plan declares no interactive phase and its run was started without `--hold` THE system SHALL extract, lint, run, resume and record it with the same prompts, states, findings and exit codes as before this change. The only differences SHALL be `mode: "headless"` on every phase, `hold: { "selection": "none" }` in its run status, and the `run-list` shape of `phax ls --json`.

## 6. Surface

### file: plan.md — interactive phase declaration — indicative

before:

    ## phase-03 — Review the export record  {#phase-03-review-export-record}

    **Recommended model:** gpt-6-luna
    **Recommended effort:** medium
    **Assignment reason:** The person continues this phase's session in codex, the provider of the run's export phases.

after:

    ## phase-03 — Review the export record  {#phase-03-review-export-record}

    **Recommended model:** gpt-6-luna
    **Recommended effort:** medium
    **Assignment reason:** The person continues this phase's session in codex, the provider of the run's export phases.
    **Mode:** interactive

    ### Detailed instructions

    Review the invoice CSV record phase-02 set: the `InvoiceRow` column order, the header wording
    and the skip-and-warn policy on a missing tax id. phase-04 (credit notes) and phase-05
    (payments) repeat all three. Correct them here and add a test for each correction.

    ### Planned files to create

    None.

    ### Planned files to edit

    None.

    ### Optional files that may be edited

    - src/export/invoiceRow.ts
    - tests/export/invoiceRow.test.ts

    ### Commit subject

    fix(export): review corrections to the invoice record

    # Landed in PR #151. normative: the line sits only on an interactive phase, in the header paragraph, after the Recommended model, Recommended effort and (when present) Assignment reason lines; a phase with no line is headless; an interactive phase plans no file to create or edit. Indicative: the line's spelling.

### file: phax-plan.json — per-phase mode — normative

before:

    { "id": "phase-03", "title": "Review the export record", "model": "gpt-6-luna", "effort": "medium",
      "planMarkdownAnchor": "phase-03-review-export-record", "plannedFilesToCreate": [], "plannedFilesToEdit": [],
      "optionalFilesToEdit": ["src/export/invoiceRow.ts"], "commit": { "subject": "fix(export): review corrections to the invoice record", "body": "…" } }

after:

    { "id": "phase-02", …same fields up to optionalFilesToEdit…, "mode": "headless", "commit": { … } }
    { "id": "phase-03", …same fields up to optionalFilesToEdit…, "mode": "interactive", "commit": { … } }

    # Landed in PR #151. `mode` is required on every phase, directly after `optionalFilesToEdit`; any other value, or its absence, is rejected. A held phase stays `"mode": "headless"`: the hold never touches the plan.

### file: plan document (`phax artifact schema plan`) — per-phase mode — normative

before:

    "phases": [{ "id": "phase-03", …, "plannedFilesToCreate": [], "plannedFilesToEdit": [],
      "optionalFilesToEdit": ["src/export/invoiceRow.ts", "tests/export/invoiceRow.test.ts"],
      "boundaryContracts": null, …, "expectedHandoff": "…", "commit": { … },
      "assignmentReason": "…", "model": "gpt-6-luna", "effort": "medium" }]

after:

    "phases": [{ "id": "phase-03", …, "plannedFilesToCreate": [], "plannedFilesToEdit": [],
      "optionalFilesToEdit": ["src/export/invoiceRow.ts", "tests/export/invoiceRow.test.ts"],
      "mode": "interactive",
      "boundaryContracts": null, …, "expectedHandoff": "…", "commit": { … },
      "assignmentReason": "…", "model": "gpt-6-luna", "effort": "medium" }]

    # Landed in PR #151. normative: `mode` directly after `optionalFilesToEdit`, in `properties` and `required`; `assignmentReason`, `model` and `effort` stay the last three keys.

### cli: phax plans lint — `interactive` check — normative

before:

    $ phax plans lint docs/plans/2610191200-invoice-export-plan.md
    …
    error    interactive    phase-03  declared interactive (**Mode:** interactive): this phax cannot run an interactive phase yet; remove the line
    $? = 1

after:

    $ phax plans lint docs/plans/2610191200-invoice-export-plan.md
    docs/plans/2610191200-invoice-export-plan.md: 3 errors, 0 warnings
    error    interactive    phase-06  an interactive phase cannot be the last phase (the final phase is already kept open)
    error    interactive    phase-04  directly follows interactive phase-03
    error    interactive    phase-03  plans src/export/csv.ts to edit; an interactive phase plans no work
    $? = 1

    # The not-yet-supported refusal is gone. normative: the check name `interactive`, severity error, the phase column, exit 1, and the same errors the run preflight refuses on. Indicative: wording.

### cli: phax run / phax resume — the `interactive` preflight — normative

    $ phax run --plan docs/plans/2610191200-invoice-export-plan.md
    Interactive preflight failed: 1 error.
      phase-06  an interactive phase cannot be the last phase (the final phase is already kept open)
    Fix the plan, then check it with `phax plans lint docs/plans/2610191200-invoice-export-plan.md`.
    $? = 11

    $ phax resume invoice-export --yes      # the run folder's plan carries the same defect
    Interactive preflight failed: 1 error.
      phase-06  an interactive phase cannot be the last phase (the final phase is already kept open)
    $? = 11

    # normative: every error of the shared `interactive` check; refused before any phase starts (for `phax run`, before the run is named), an existing run's state unchanged; exit 11. Indicative: wording.

### cli: phax run --hold — normative

before:

    $ phax run [short-name] --plan <path> [--allow-dirty] [--provider-priority <list>] [--dry-run] [--security <mode>] [--refresh] [--allow-skill-edits]
    # no way to ask for a stop: a run stops for a person only at a plan-declared interactive phase

after:

    $ phax run --plan docs/plans/2610191200-invoice-export-plan.md --hold                     # every headless phase but the final one
    $ phax run --plan docs/plans/2610191200-invoice-export-plan.md --hold phase-02,phase-04   # the listed phases
    $ phax run --plan docs/plans/2610191200-invoice-export-plan.md --hold oracle              # every oracle phase
    $ phax run invoice-export --plan docs/plans/2610191200-invoice-export-plan.md --hold=phase-02

    $ phax run --hold invoice-export --plan docs/plans/2610191200-invoice-export-plan.md
    ✗ --hold "invoice-export" is not a hold selection: give no value, `oracle`, or phase ids such as phase-02,phase-04
      (put the run's name before --hold, or write --hold=<selection>)
    $? = 1

    $ phax run --plan … --hold oracle,phase-02
    ✗ --hold "oracle,phase-02" is not a hold selection: `oracle` stands alone
    $? = 1

    $ phax resume invoice-export --hold
    error: unknown option '--hold'
    $? = 1

    # normative: the option name and its three forms; `oracle` is the one keyword; a phase id matches phase-NN, so the keyword and an id never collide; a mixed, empty, repeated or malformed value is refused with exit 1 before the run is named; `phax resume` has no `--hold`. Indicative: wording.

### cli: phax run — the `hold` preflight — normative

    $ phax run --plan docs/plans/2610191200-invoice-export-plan.md --hold phase-03,phase-06,phase-09
    Hold preflight failed: 3 errors.
      phase-03  is interactive: it already stops for review; remove it from --hold
      phase-06  is the final phase: it already stays open in review_open
      phase-09  is not a phase of this plan
    $? = 11

    $ phax run --plan docs/plans/2610191200-invoice-export-plan.md --hold oracle
    Hold preflight failed: 1 error.
      -         --hold oracle selects no phase: the plan declares no oracle phase
    $? = 11

    # normative: the check name `hold`, every error printed with its phase, refused before any phase starts and before the run is named, no worktree or branch created, exit 11. Indicative: wording.

### file: <run>/run-status.json — the recorded hold — normative

before:

    { "$schema": "…/run-status/<release>.json", "namespace": "acme", "shortName": "invoice-export", "runId": "…",
      "state": "running", "createdAt": "…", "updatedAt": "…", "phasesCount": 6, "currentPhaseIndex": 1,
      "gateProfileId": "standard", "planRepoRelPath": "docs/plans/2610191200-invoice-export-plan.md", "allowSkillEdits": false }

after:

    { "$schema": "…/run-status/<release>.json", …same fields…, "state": "awaiting_review",
      "hold": { "selection": "listed", "phases": ["phase-02", "phase-04"] } }

    "hold": { "selection": "none" }
    "hold": { "selection": "all", "phases": ["phase-01", "phase-02", "phase-04", "phase-05"] }
    "hold": { "selection": "oracle", "phases": ["phase-02"] }

    # normative: `hold` required on every run; `selection` exactly none | all | listed | oracle; `phases` on every variant but none, resolved when the run is named, in plan order, never changed afterwards. A new run-status shape, with a frozen decoder of the current one.

### cli: phax run — stopping at a declared interactive phase — normative

    $ phax run --plan docs/plans/2610191200-invoice-export-plan.md
    ✓ phase-01  Export port              committed  1a2b3c4
    ✓ phase-02  Invoice CSV record       committed  5d6e7f8
    ◐ phase-03  Review the export record — awaiting review (declared: interactive phase)

      First reading (codex gpt-6-luna, session 019a2f6e…):
        Pattern at stake: the InvoiceRow column order, the header wording `invoice_no`,
        skip-and-warn on a missing tax id.
        phase-04 and phase-05 copy all three; phase-06 reuses the header wording.

      Worktree:  ~/.phax/worktrees/invoice-export/phase-03
      Seed:      .phax-context/interactive-review.md
      Continue the session phax started:
        cd ~/.phax/worktrees/invoice-export/phase-03 && codex resume 019a2f6e-… -m gpt-6-luna -c model_reasoning_effort="medium" -c sandbox_mode="workspace-write" …
        or: phax enter-phase invoice-export phase-03
      Or work by hand or with any agent. Then, from the main checkout:
        phax resume invoice-export
      Stop: ~/.phax/runs/invoice-export/review-stop.json
    $? = 13

    # first turn failed (no current session):
      First reading: none — codex stopped: rate limit hit (resets 14:20)
      Start a session:
        cd ~/.phax/worktrees/invoice-export/phase-03 && codex -m gpt-6-luna … "Read .phax-context/interactive-review.md, then review phase-03 with me."
    $? = 13

    # normative: state `awaiting_review`, cause `declared`, exit 13 whether or not the first turn succeeded, no prompt and no stdin read, a continue or fresh-start command printed. Indicative: layout and wording.

### cli: phax run — stopping at a held phase — normative

    $ phax run --plan docs/plans/2610191200-invoice-export-plan.md --hold phase-02,phase-04
    ✓ phase-01  Export port              committed  1a2b3c4
    ✓ phase-02  Invoice CSV record       committed  5d6e7f8
    ◐ phase-02  Invoice CSV record — awaiting review (held: --hold)

      Phase commit: 5d6e7f8 feat(export): invoice CSV record
      Handoff:   ~/.phax/runs/invoice-export/phase-02/phase-handoff.md
      Worktree:  ~/.phax/worktrees/invoice-export/phase-02
      Seed:      .phax-context/interactive-review.md
      Continue the session that built phase-02:
        cd ~/.phax/worktrees/invoice-export/phase-02 && codex resume 018f9c3a-… -m gpt-6-luna -c model_reasoning_effort="medium" -c sandbox_mode="workspace-write" …
        or: phax enter-phase invoice-export phase-02   (add --new-session for a fresh read-only look)
      Or work by hand or with any agent. Then, from the main checkout:
        phax resume invoice-export
      Stop: ~/.phax/runs/invoice-export/review-stop.json
    $? = 13

    # normative: the phase is committed and its handoff validated before the stop; no agent turn after the commit; state `awaiting_review`, cause `held`, exit 13, no stdin read. Indicative: layout and wording.

### cli: continue and fresh-start commands per provider — indicative

before:

    $ phax enter-phase invoice-export phase-02     # a codex phase
    codex-cli does not support interactive resume via phax. To resume manually, run: codex exec resume <session-id> from the bound worktree.
    $? = 1

after:

    claude-code (verified):
      cd <worktree> && claude --resume <id> --model claude-sonnet-5-5 --effort medium <phase permission flags>
    codex (verified):
      cd <worktree> && codex resume <id> -m gpt-6-luna -c model_reasoning_effort="medium" -c sandbox_mode="workspace-write" -c sandbox_workspace_write.writable_roots=[…] -c sandbox_workspace_write.network_access=false
      (the first open of the worktree asks you to trust the directory, then to review its hooks)
    mistral-vibe (unverified, fresh start; this session's transcript will not be captured):
      cd <worktree> && VIBE_ACTIVE_MODEL=phax-mistral-medium-3.5-medium vibe --workdir <worktree> "Read .phax-context/interactive-review.md, then review phase-03 with me."

    # normative: the executable and its resume form (`claude --resume <id>`, `codex resume <id>`); a fresh start for an unverified provider; model, effort and posture flags carried. Indicative: flag spelling and order.

### file: .phax-context/interactive-review.md at a declared stop (identical copy at <run>/phase-03/review-seed.md) — indicative

    # Interactive review: phase-03 of invoice-export

    The run stopped here because its plan declares this phase interactive. phase-04 and
    phase-05 repeat the pattern phase-02 set: correct it once, here.

    ## What is expected of you
    - Correct the pattern in this worktree: the later phases start from this code.
    - Turn each correction into a guard where you can: a test, a lint rule or a gate step.
    - Keep the scope: correct what was done; do not do the later phases' work.
    - Optional: write .phax-context/correction-handoff.md yourself (sections below);
      otherwise phax writes the handoff when you resume.

    ## What to review (plan, phase-03)
    <phase-03 Detailed instructions>

    ## Executed phases
    ### phase-01 — Export port — handoff
    …
    ### phase-02 — Invoice CSV record — handoff
    …

    ## Upcoming phases (their plan sections)
    ### phase-04 — Credit-note CSV record
    …

    Full plan: .phax-context/plan.md

    ## Gate
    pnpm typecheck
    pnpm test:unit

    ## Close the phase
    From the main checkout, not from this worktree:
      phax resume invoice-export

    # normative: the two locations and the contents the seed requirement lists; never committed. Indicative: wording and order.

### file: .phax-context/interactive-review.md at a held stop (identical copy at <run>/phase-02/review-seed.md) — indicative

    # Held for review: phase-02 of invoice-export

    The run stopped here because it was started with --hold. phase-02 is committed
    (5d6e7f8, on 1a2b3c4); the later phases have not started and will build on what you leave here.

    ## What is expected of you
    - Review phase-02's work; correct it in this worktree, on top of its commit.
    - Turn each correction into a guard where you can.
    - Keep the scope: correct what was done; do not do the later phases' work.
    - Optional: write .phax-context/correction-handoff.md yourself; otherwise phax writes it when you resume.

    ## The phase (plan, phase-02)
    <phase-02 plan section>

    ## What it delivered (its handoff)
    <phase-02 phase-handoff.md>

    ## Its files (reconciliation)
    <phase-02 file reconciliation>

    ## Earlier phases
    ### phase-01 — Export port — handoff
    …

    ## Upcoming phases (their plan sections)
    ### phase-03 — Review the export record
    …

    Full plan: .phax-context/plan.md

    ## Gate
    pnpm typecheck
    pnpm test:unit

    ## Close the phase
    From the main checkout, not from this worktree:
      phax resume invoice-export

    # normative: the two locations and the contents the held-seed requirement lists; never committed. Indicative: wording and order.

### api: first-reading answer (the first turn's final message) — indicative

    { "$schema": "…/first-reading/<release>.json",
      "pattern": ["InvoiceRow column order", "header wording `invoice_no`", "skip-and-warn on a missing tax id"],
      "copiedBy": [
        { "phase": "phase-04", "what": "all three" },
        { "phase": "phase-05", "what": "all three" },
        { "phase": "phase-06", "what": "the header wording" } ],
      "toCheck": ["Is skipping a row acceptable to the accountant, or must the export fail?"] }

    # normative: a required `$schema`; an answer without one, or of an unknown version, is refused. Indicative: the fields.

### file: <run>/<phase>/interactive-session.json — indicative

    # declared stop
    { "$schema": "…/interactive-session/<release>.json",
      "phaseId": "phase-03",
      "interactiveResume": "verified",
      "current": { "provider": "codex", "model": "gpt-6-luna", "effort": "medium",
                   "sessionId": "019a2f6e-…", "startedAt": "2026-10-21T09:12:04Z", "origin": "first-turn" },
      "history": [],
      "firstTurns": [ { "origin": "first-turn", "outcome": "answered" } ] }

    # held stop
    { "$schema": "…/interactive-session/<release>.json",
      "phaseId": "phase-02",
      "interactiveResume": "verified",
      "current": { "provider": "codex", "model": "gpt-6-luna", "effort": "medium",
                   "sessionId": "018f9c3a-…", "startedAt": "2026-10-21T08:40:11Z", "origin": "builder" },
      "history": [],
      "firstTurns": [] }

    # `current` is null when there is no current session; `origin` is exactly first-turn | new-session | builder; a first turn's `outcome` is exactly answered | failed | refused-change.

### file: <run>/review-stop.json — normative

    # held stop
    { "$schema": "…/review-stop/<release>.json",
      "run": "acme.invoice-export",
      "state": "awaiting_review",
      "cause": "held",
      "phase": { "id": "phase-02", "title": "Invoice CSV record", "mode": "headless", "position": 2, "of": 6 },
      "phaseCommit": "5d6e7f8c0a91b2e4f6d8a0c2e4f6a8b0c2d4e6f8",
      "worktree": "/Users/ada/.phax/worktrees/invoice-export/phase-02",
      "seed": "/Users/ada/.phax/worktrees/invoice-export/phase-02/.phax-context/interactive-review.md",
      "session": { "provider": "codex", "sessionId": "018f9c3a-…", "origin": "builder", "interactiveResume": "verified" },
      "commands": {
        "continue":   { "cwd": "<worktree>", "argv": ["codex", "resume", "018f9c3a-…", "-m", "gpt-6-luna", "…"] },
        "freshStart": { "cwd": "<worktree>", "argv": ["codex", "-m", "gpt-6-luna", "…", "Read .phax-context/interactive-review.md, then review phase-02 with me."] },
        "enterPhase": { "cwd": "<main checkout>", "argv": ["phax", "enter-phase", "invoice-export", "phase-02"] },
        "close":      { "cwd": "<main checkout>", "argv": ["phax", "resume", "invoice-export"] },
        "reset":      { "cwd": "<main checkout>", "argv": ["phax", "reset-phase", "invoice-export", "phase-02"] } },
      "lastClose": null }

    # declared stop: "cause": "declared", "firstReading": "<run>/phase-03/first-reading.md" (or null), and no "phaseCommit"
    # after a refused close: "lastClose": { "at": "…", "result": "gate-failed", "exitCode": 4, "log": "<run>/phase-02/checks-attempt-02.log" }

    # normative: a required `$schema`; `state`; `cause` exactly declared | held, with exactly its variant's keys (`firstReading` on declared, `phaseCommit` on held); `phase.id`; `worktree`; `session` (null when none); `commands` with `continue` null when there is no current session or the provider is unverified, and `close` always present; the file exists exactly while the run is in `awaiting_review`. Indicative: the other fields, `lastClose` and its `result` values.

### cli: phax ls --json — normative

before:

    $ phax ls --json
    [
      {
        "namespace": "acme",
        "shortName": "invoice-export",
        "state": "running",
        "branch": "phax/invoice-export",
        "currentPhase": "3/6",
        "gateProfile": "standard",
        "updatedAt": "2026-10-21 09:12",
        "lockState": "active",
        "qualifiedName": "acme.invoice-export"
      }
    ]
    # no $schema; recordsPending and archivePath are dropped when undefined

after:

    $ phax ls --json
    {
      "$schema": "…/run-list/<release>.json",
      "runs": [
        { "qualifiedName": "acme.invoice-export", "namespace": "acme", "shortName": "invoice-export",
          "state": "awaiting_review", "branch": "phax/invoice-export", "currentPhase": "2/6",
          "gateProfile": "standard", "updatedAt": "2026-10-21 09:40", "lockState": "none",
          "recordsPending": null, "archivePath": null,
          "stop": { "$schema": "…/review-stop/<release>.json", "cause": "held", "phase": { "id": "phase-02", … }, … } },
        { "qualifiedName": "acme.payments-fix", …, "state": "failed", …, "stop": null } ] }

    $ phax ls --awaiting-review --json      # only runs in awaiting_review

    # normative: one document with a required `$schema` and `runs`; each run's `qualifiedName`, `state` and `stop` (the run's review-stop document, byte-equal in content to review-stop.json, or null); every row key required, null when unknown. Indicative: the other row keys' spelling. A breaking change for scripts reading the bare array (docs/upgrading.md).

### cli: phax ls / phax session-info on a waiting run — indicative

before:

    $ phax ls
    NAME            STATE     BRANCH  PHASE  …
    invoice-export  running   …       3/6

after:

    $ phax ls
    NAME            STATE                      BRANCH  PHASE  …
    invoice-export  awaiting_review (held)     …       2/6 phase-02
    credit-notes    awaiting_review (declared) …       3/6 phase-03
    payments-fix    failed                     …       2/4

    $ phax ls --awaiting-review
    invoice-export  awaiting_review (held)     …       2/6 phase-02
    credit-notes    awaiting_review (declared) …       3/6 phase-03

    $ phax session-info invoice-export
    state:     awaiting_review (held)
    phase:     phase-02 (headless, committed 5d6e7f8)
    worktree:  ~/.phax/worktrees/invoice-export/phase-02
    seed:      ~/.phax/worktrees/invoice-export/phase-02/.phax-context/interactive-review.md
    session:   codex 018f9c3a-… (builder; continue: phax enter-phase invoice-export phase-02)

    # normative: the state name `awaiting_review` and the flag `--awaiting-review`. Indicative: layout.

### cli: phax enter-phase — normative

before:

    $ phax enter-phase invoice-export phase-02
    # resumes phase-02's recorded session on claude-code; refuses on codex and mistral-vibe

after:

    $ phax enter-phase invoice-export phase-03         # declared stop
    Continuing codex session 019a2f6e-… in ~/.phax/worktrees/invoice-export/phase-03

    $ phax enter-phase invoice-export phase-02         # held stop
    Continuing codex session 018f9c3a-… (the session that built phase-02) in ~/.phax/worktrees/invoice-export/phase-02

    $ phax enter-phase invoice-export phase-02 --new-session
    First turn: new codex session 7d0e41b2-… (gpt-6-luna, medium) — first reading written
    Continuing codex session 7d0e41b2-… in ~/.phax/worktrees/invoice-export/phase-02

    $ phax enter-phase invoice-export phase-01         # a committed headless codex phase
    Continuing codex session 018e11d0-… in ~/.phax/worktrees/invoice-export/phase-01

    # normative: the continue command when a session is current on a verified provider, the fresh-start command otherwise; at a held stop the builder session is current; `--new-session` runs a new first turn at either stop; codex phases resume interactively. Indicative: wording.

### api: interactive-handoff answer (the closing turn's final message) — indicative

    { "$schema": "…/interactive-handoff/<release>.json",
      "corrections": [
        { "what": "The header row reads `Invoice number`, not `invoice_no`.",
          "guard": { "kind": "test", "ref": "tests/export/invoiceRow.test.ts › header uses EXPORT_LABELS" } },
        { "what": "A missing tax id fails the export with the row number instead of skipping the row.",
          "guard": { "kind": "test", "ref": "tests/export/invoiceRow.test.ts › missing tax id fails with row number" } },
        { "what": "The column order is kept as the plan states it.",
          "guard": { "kind": "none", "reason": "the order is the accountant's, stated in the plan, not checkable here" } } ],
      "patternFromNowOn": ["Header labels come from `EXPORT_LABELS`.", "A missing required field fails the export; nothing is skipped."],
      "nextPhasesNeedToKnow": ["phase-04 and phase-05 add their labels to `EXPORT_LABELS`."] }

    # normative: a required `$schema`; `guard.kind` exactly test | lint | gate-step | none, with `ref` for the first three and `reason` for none. Indicative: field names.

### file: the interactive handoff (<run>/phase-03/phase-handoff.md at a declared stop; <run>/phase-02/correction-handoff.md at a held stop) — indicative

before:

    ## What was delivered
    ## Key decisions and why
    ## Exact locations (file paths and exported names)
    ## What the next phase needs to know

after:

    ## What was corrected
    - The header row reads `Invoice number`, not `invoice_no`.
    - A missing tax id fails the export with the row number instead of skipping the row.
    - The column order is kept as the plan states it.

    ## The pattern to follow from now on
    - Header labels come from `EXPORT_LABELS`.
    - A missing required field fails the export; nothing is skipped.

    ## Guards
    - tests/export/invoiceRow.test.ts › header uses EXPORT_LABELS
    - tests/export/invoiceRow.test.ts › missing tax id fails with row number
    - no guard: the order is the accountant's, stated in the plan, not checkable here

    ## What the next phases need to know
    - phase-04 and phase-05 add their labels to `EXPORT_LABELS`.

    # normative: the four sections in this order; one Guards entry per correction; the same shape required of the person's `.phax-context/correction-handoff.md`; at a held stop, phase-handoff.md (the builder's) is left unchanged. Indicative: the section titles' exact spelling and the file names.

### cli: phax resume — closing a declared stop — normative

before:

    $ phax resume invoice-export
    Resume run "invoice-export" from phase-03? [y/N]

after:

    $ phax resume invoice-export --yes
    phase-03 (declared): 3 files changed by review
      gate  pnpm typecheck   pass
      gate  pnpm test:unit   pass
      handoff     closing turn: resumed codex session 019a2f6e-…
      transcript  interactive-transcripts/019a2f6e-….jsonl
    ✓ phase-03  Review the export record   committed  9a8b7c6  (corrected)
    ▶ phase-04  Credit-note CSV record …

    $ phax resume invoice-export --yes      # gate red
    phase-03 (declared): 3 files changed by review
      gate  pnpm test:unit   fail  (~/.phax/runs/invoice-export/phase-03/checks-attempt-01.log)
    ✗ phase-03 stays awaiting review: fix the worktree, then resume again
    $? = 4

    $ phax resume invoice-export --yes      # closing turn edited the worktree
    ✗ phase-03 stays awaiting review: the closing turn changed src/export/labels.ts; review the change, then resume again
    $? = 5

    # normative: gate first; on red no fix attempt, exit 4 and `awaiting_review`; exit 5 when the closing turn edits; exit 1 (person's file) or 5 (closing turn's answer) on an invalid handoff; exit 8 on a limit, still `awaiting_review`; on green commit, then continue. Indicative: layout.

### cli: phax resume — closing a held stop — normative

    $ phax resume invoice-export --yes
    phase-02 (held): 2 files changed by review, on 5d6e7f8
      gate  pnpm typecheck   pass
      gate  pnpm test:unit   pass
      handoff     closing turn: resumed codex session 018f9c3a-… → correction-handoff.md
      transcript  interactive-transcripts/018f9c3a-….jsonl
    ✓ phase-02  Invoice CSV record   review commit  c0ffee1  on 5d6e7f8  (corrected)
    ▶ phase-03  Review the export record …

    $ phax resume invoice-export --yes      # nothing changed
    phase-02 (held): no change
      gate  pnpm typecheck   pass
      gate  pnpm test:unit   pass
    ✓ phase-02  Invoice CSV record   5d6e7f8  (unchanged, no commit)
    ▶ phase-03  Review the export record …

    # normative: the same closing rules and exit codes as a declared stop; a review commit on top of the unchanged phase commit when the worktree changed, no commit when it did not; never exit 9; cleanup, then the next phase in the same invocation. Indicative: layout.

### file: a held phase's branch — normative

    $ git log --format='%h %an %s%n%(trailers:only)' phax/invoice-export--phase-02
    c0ffee1 Ada Example feat(export): invoice CSV record
    Held-Phase: phase-02

    5d6e7f8 … feat(export): invoice CSV record
    1a2b3c4 … feat(export): export port

    # normative: the phase commit unchanged; at most one review commit on top of it, with the plan's subject, a `Held-Phase: <phase id>` trailer and the checkout's git identity as author; no `fixup!` subject, no amend, no squash. The declared phase's commit keeps its `Interactive-Phase: <phase id>` trailer.

### file: <run>/<phase>/interactive-transcripts/ — normative

    ~/.phax/runs/invoice-export/phase-02/            # held stop
      phase-handoff.md          # the builder's, unchanged
      review-seed.md
      interactive-session.json
      correction-handoff.md
      interactive-transcripts/
        018f9c3a-….jsonl      # the builder session, copied from ~/.codex/sessions/2026/10/21/rollout-…-018f9c3a-….jsonl

    ~/.phax/runs/invoice-export/phase-03/            # declared stop
      review-seed.md
      first-reading.md
      interactive-session.json
      interactive-transcripts/
        019a2f6e-….jsonl
      phase-handoff.md          # the interactive handoff

    # normative: one file per recorded session, named by session id, copied at closing, even for a session the person never continued; a missing one is recorded as missing and never blocks closing. Indicative: the other file names.

### file: <run>/<phase>/status.json — normative

before:

    { "phaseId": "phase-02", "phaseIndex": 1, "state": "committed", "model": "gpt-6-luna", "effort": "medium", … }

after:

    { "phaseId": "phase-02", "phaseIndex": 1, "state": "awaiting_review", "mode": "headless", "stop": { "cause": "held" }, … }
    { "phaseId": "phase-02", "phaseIndex": 1, "state": "cleaned_up", "mode": "headless", "stop": { "cause": "held", "outcome": "corrected", "reviewCommit": "c0ffee1…" }, … }
    { "phaseId": "phase-03", "phaseIndex": 2, "state": "awaiting_review", "mode": "interactive", "stop": { "cause": "declared" }, … }
    { "phaseId": "phase-01", "phaseIndex": 0, "state": "cleaned_up", "mode": "headless", "stop": null, … }

    # run-status.json carries "state": "awaiting_review" while stopped. normative: the state, `mode`, and the cause and outcome enums (declared | held, corrected | unchanged). Indicative: the field spelling of `stop`, `outcome` and `reviewCommit`.

### cli: exit code table (`phax --usage`, README) — normative

before:

    12  Artifact lifecycle refusal

after:

    12  Artifact lifecycle refusal
    13  Awaiting review at an interactive or held phase (resumable)

### file: <run>/review-handoff.md — stops — indicative

    ## Reviewed phases

    | Phase    | Stop     | Outcome   | Closed by   | Corrections | Guards         |
    | -------- | -------- | --------- | ----------- | ----------- | -------------- |
    | phase-02 | held     | corrected | Ada Example | 2           | 2              |
    | phase-03 | declared | corrected | Ada Example | 3           | 2 (1 no guard) |
    | phase-04 | held     | unchanged | Ada Example | 0           | —              |

    <each stop's What was corrected and Guards sections>

    # Omitted when the run had no stop.

### file: pr-body.md — phase line — indicative

before:

    - phase-02 Invoice CSV record — committed
    - phase-03 Review the export record — committed

after:

    - phase-02 Invoice CSV record — held, corrected by Ada Example (2 guards)
    - phase-03 Review the export record — interactive, corrected by Ada Example (2 guards)
    - phase-04 Credit-note CSV record — held, reviewed without change by Ada Example

### cli: phax records explain — indicative

before:

    phase-02  committed  surfaces: local

after:

    phase-02  committed  surfaces: local
      held: corrected by Ada Example — phase commit 5d6e7f8, review commit c0ffee1
      sessions: codex gpt-6-luna 018f9c3a-… (builder; transcript sha256 3f9a…)

### file: cost-ledger.json — stop entries — indicative

    { "phaseId": "phase-03", "kind": "first-turn",   "provider": "codex", "model": "gpt-6-luna", … }
    { "phaseId": "phase-03", "kind": "closing-turn", "provider": "codex", "model": "gpt-6-luna", … }
    { "phaseId": "phase-02", "kind": "closing-turn", "provider": "codex", "model": "gpt-6-luna", … }

    # Each entry holds its own turn's cost, never the session's cumulative cost. A held phase's builder entries are unchanged. No entry for the person's turns.

### internal: later phase prompt — review corrections section — indicative

before:

    ## Previous phase handoff

    <phase-03 handoff>

after:

    ## Previous phase handoff

    <phase-03 handoff>

    ## Review corrections

    A person reviewed and corrected the run at phase-02 and phase-03. Where this section disagrees with an
    earlier phase's handoff, this section wins. Your own plan section still binds.

    ### phase-02 (held)
    <phase-02 correction-handoff.md>

    ### phase-03 (interactive)
    <phase-03 interactive handoff>

### cli: phax reset-phase on a waiting run — indicative

    $ phax reset-phase invoice-export phase-01
    ✗ Cannot reset "phase-01" of run "invoice-export": phase "phase-02" is awaiting review (held) — reset phase-02 first.
    $? = 1

    $ phax reset-phase invoice-export phase-02
    This discards phase-02's commit 5d6e7f8 and 2 uncommitted review corrections in ~/.phax/worktrees/invoice-export/phase-02:
      M src/export/invoiceRow.ts
      A src/export/labels.ts
    phax resume will run phase-02 again from its start and hold it again.
    Proceed? [y/N]

### api: oracle request at a stop's closing (oracle-phases' `oracle-request`, values under this spec's rule) — indicative

before:

    { "$schema": "…/oracle-request/<release>.json", "verdict": "discharged", "phase": "phase-04", "oraclePhase": "phase-02",
      "base": "<phase-01 full commit>", "oracleCommit": "<phase-02's own commit>", "files": ["tests/export/invoiceRow.test.ts"] }

after:

    # closing interactive phase-03, whose corrections changed tests/export/invoiceRow.test.ts
    { "$schema": "…/oracle-request/<release>.json", "verdict": "authored", "phase": "phase-03", "oraclePhase": "phase-02",
      "base": "<phase-01 full commit>", "files": ["tests/export/invoiceRow.test.ts"] }

    # then at phase-04's gate
    { "$schema": "…/oracle-request/<release>.json", "verdict": "discharged", "phase": "phase-04", "oraclePhase": "phase-02",
      "base": "<phase-01 full commit>", "oracleCommit": "<phase-03's commit, the latest that passed authored>", "files": ["tests/export/invoiceRow.test.ts"] }

    # The request shape is oracle-phases'; this spec changes which phase may send `authored` and which commit `oracleCommit` names.

## 7. Non-goals

- The review UI itself: a diff viewer, comments, a terminal pane, reading directions. It is a separate app or plugin that reads and writes the run folder and the documents this spec pins.
- Comments anchored on lines, and structured replies per comment (a reply file, or the Agent Client Protocol).
- A stop requested by an agent. No agent ever stops a run to ask, and `phase-decision-requests` stays parked.
- A `phase revise` / `phase approve` command pair, as in the fork. Closing is `phax resume`, at both stops.
- Squashing, amending or rebasing a phase commit, or any `fixup!` commit.
- Rewriting the approved plan mid-run, amending later phases' sections from a stop, or adding a phase for a hold.
- Changing today's kept-open final phase, `review_open`, `phax enter`, `phax review-code`, `phax run --append` or the end-of-run order.
- Lifting `unverified` interactive resume for mistral-vibe. That waits until `vibe --resume <id>` is verified to continue a `vibe -p` session interactively.
- Capturing, costing or recording the content of a session phax did not start, and costing the person's interactive turns.
- A timeout, reminder or notification while a run awaits review. The run waits indefinitely, like every resumable stop.
- Sizing a hold in `phax plans estimate`. The estimate sizes a plan, and a hold belongs to a run.
- Changing `phax report`, which is a telemetry issue reporter and not a status view.
- `phax review-plan` declaring interactive phases in a review plan.
- The Prover or any outside verifier.
- The oracle runtime itself, which belongs to oracle-phases' plans. Here only the rules it must follow change.
- Network access for the phax CLI, or any Claude Code feature the other providers lack.

## 8. Acceptance criteria

### The mode is extracted

Given a six-phase plan whose phase-03 header carries `**Mode:** interactive`, with no Mode line on any other phase, when `phax run --plan <plan> --dry-run` extracts it, then phax-plan.json gives phase-03 `"mode": "interactive"` and every other phase `"mode": "headless"`. (refs §5.1, §5.2)

### The plan document carries the mode

Given a plan document whose phase-03 has `"mode": "interactive"` and an `assignmentReason`, and whose other phases have `"mode": "headless"`, plus two variants, one with no `mode` on phase-02 and one with `"mode": "review"`, when the document is rendered and linted, and both variants are decoded against `phax artifact schema plan`, then `phax artifact schema plan` places `mode` directly after `optionalFilesToEdit` and keeps `assignmentReason`, `model` and `effort` last. The rendered plan.md carries the Mode line on phase-03 only, after its Recommended model, Recommended effort and Assignment reason lines. The projected extraction matches the document's mode on every phase, and both variants are rejected. (refs §5.1, §5.3)

### One lift gives every phase its mode

Given a live plan sidecar stamped at the 0.25.0 plan-document shape, whose phase-02 carries a `modelReason`, and its plan.md, when `phax artifact migrate-documents` runs, then the sidecar is rewritten at the current shape, with `mode: "headless"` on every phase and phase-02's reason as its `assignmentReason`. The plan.md gains no Mode line, and both files are committed. (refs §5.4)

### Lint places interactive phases

Given in turn, a plan whose phase-01 is interactive, a plan whose last phase is interactive, and a plan whose phase-03 and phase-04 are both interactive, when `phax plans lint` runs on each, then each exits 1 with an `error` row on the `interactive` check, naming phase-01, the last phase and phase-04 respectively, and no row says the phase cannot run yet. (refs §5.5)

### Lint refuses planned work in an interactive phase

Given an interactive phase-03 that lists src/export/csv.ts as a planned file to edit, and the same plan with src/export/csv.ts listed only as optional, when `phax plans lint` runs on each, then the first exits 1 with an `interactive` error naming phase-03 and src/export/csv.ts, and the second reports no `interactive` finding. (refs §5.6)

### A bound governs an interactive phase through its optional files

Given `phax.json` declaring one globs bound, `assignments[0]`, on `src/export/**` at `claude-opus-5-5` from `medium` to `high`; an interactive phase-03 whose only files are the optional src/export/invoiceRow.ts and tests/export/invoiceRow.test.ts, at `gpt-6-luna` `medium` with no `**Assignment reason:**` line; and the same plan with phase-03 at `claude-opus-5-5` `high`, when `phax plans lint` runs on each, and the second is run to phase-03 and closed on a changed worktree with a fake claude-code CLI that records its argv, then the first reports a `models` error for phase-03 naming `assignments[0]`. The second reports no `models` finding for phase-03, and its first turn and closing turn each run `claude-opus-5-5` at `high`. (refs §5.7)

### Lint and the run preflight report the same error

Given a plan whose last phase is interactive, and an interrupted run whose phax-plan.json and plan.md carry the same defect, when `phax plans lint <plan>`, `phax run --plan <plan>` and `phax resume <run> --yes` run, then lint exits 1 with an `interactive` error naming the last phase, and run and resume each exit 11 printing that same error. No run, worktree or phase branch is created, and the interrupted run's state and last error are unchanged. (refs §5.8, §5.9)

### The planning skill says when and how

Given the phax-planning skill as shipped, when its interactive-phase section is read, then it gives the `**Mode:** interactive` line and the rule: declare one directly after the first phase that sets a pattern at least one later phase repeats, and never by default. It says the operator can hold any other phase with `phax run --hold`, and that the Detailed instructions name what to review, the pattern and the later phases that repeat it. (refs §5.10)

### The hold is resolved and recorded when the run is named

Given the six-phase invoice-export plan whose phase-03 is interactive, and a four-phase variant whose phase-02 carries `**Oracle phase:** yes` with an `oracles` provider configured, both routed to fake providers, when `phax run --plan <plan>` runs with no `--hold`, with `--hold`, and with `--hold phase-02,phase-04`, and `phax run --plan <variant> --hold oracle` runs, then the new runs' `run-status.json` carry, in that order, `"hold": { "selection": "none" }`, `{ "selection": "all", "phases": ["phase-01", "phase-02", "phase-04", "phase-05"] }`, `{ "selection": "listed", "phases": ["phase-02", "phase-04"] }` and `{ "selection": "oracle", "phases": ["phase-02"] }`. (refs §5.11, §5.13, §5.15)

### A malformed hold value is refused

Given the invoice-export plan, when `phax run --plan <plan>` runs with `--hold phase-2`, `--hold oracle,phase-02`, `--hold phase-02,,phase-04` and `--hold phase-02,phase-02`, then `phax run --hold invoice-export --plan <plan>`, then `phax run invoice-export --plan <plan> --hold=phase-02`, then each of the first five exits 1, naming the value and the three accepted forms, and creates no run, worktree or branch. The last names the run invoice-export and records `"selection": "listed"` with phase-02. (refs §5.12, §5.11)

### The hold preflight refuses a selection the plan cannot honour

Given the invoice-export plan, which declares no oracle phase, and a one-phase plan, when `phax run --plan <plan>` runs with `--hold phase-09`, `--hold phase-03`, `--hold phase-06` and `--hold oracle`, and `phax run --plan <one-phase plan> --hold` runs, then each exits 11 with an error on the `hold` check: naming phase-09 as absent, phase-03 as interactive and phase-06 as final, then that the plan declares no oracle phase, then that the selection holds no phase. No run is named and no worktree or branch is created. (refs §5.14)

### The hold is fixed for the run and comes only from the flag

Given a run of the invoice-export plan started with `--hold phase-04` that paused on a rate limit in phase-02, when `phax resume invoice-export --yes` runs and the declared stop at phase-03 is later closed, then `phax resume invoice-export --hold` runs, then `phax validate` runs with `"review": { "holdPhases": true }` in phax.json and, separately, with a `hold` key in `~/.phax/config.json`, then phase-02 commits without stopping, phase-04 stops with cause `held`, phase-05 does not stop, and `run-status.json`'s `hold` is byte-identical throughout. `phax resume invoice-export --hold` exits 1 as an unknown option, and each `phax validate` exits 2 naming the unknown key. (refs §5.16, §5.17)

### The run stops at the interactive phase after a first turn

Given a six-phase plan whose phase-03 is interactive and routed to a fake codex CLI that records its argv and cwd, reports session id S1 and answers a valid first-reading document, and a setup command that writes a marker file, when `phax run --plan <plan>` runs, then phase-01 and phase-02 commit. phase-03's worktree exists on `<run.branch>--phase-03` at phase-02's commit, with the marker present. The fake is spawned exactly once for phase-03, headless, as a new session in that worktree with the phase's model and effort, and no gate runs. `interactive-session.json` records codex, the model, the effort and S1 as current with origin `first-turn`, and `first-reading.md` holds the rendered answer. The run and phase-03 are `awaiting_review` with cause `declared`, `resume-instructions.md` exists and the lock is released. The output names the cause and holds the first reading, the worktree, the seed, a `codex resume S1` continue command, `phax enter-phase invoice-export phase-03`, `phax resume invoice-export` and the review-stop path, and the exit code is 13. (refs §5.18, §5.24, §5.25, §5.29, §5.30)

### The declared seed holds what the person needs

Given that stopped run, when the seed files are read, then `.phax-context/interactive-review.md` in the worktree and `review-seed.md` in phase-03's run folder are identical. They contain the expectations, phase-03's Detailed instructions, the handoffs of phase-01 and phase-02 in that order, the plan sections of phase-04 to phase-06, the full plan's path, the gate commands and `phax resume invoice-export`. (refs §5.19)

### The run stops at a held phase after its commit

Given the invoice-export plan run with `phax run --plan <plan> --hold phase-02`, phase-02 routed to a fake codex that records argv and reports session X0, and a cleanup command that writes a marker, when the run runs, then phase-01 commits and its cleanup marker is written. phase-02 commits on `<run.branch>--phase-02` as commit C2, with its validated handoff at `<run>/phase-02/phase-handoff.md`. phase-02's worktree exists at C2 with no cleanup marker, and the fake was spawned for phase-02 only for its work and its handoff, never after C2. phase-03 has no worktree and no branch. The run and phase-02 are `awaiting_review` with cause `held`. `interactive-session.json` holds X0 as current with origin `builder`, `resume-instructions.md` exists and the lock is released. The output names the cause, C2, the worktree, the seed, a `codex resume X0` continue command, `phax enter-phase invoice-export phase-02`, `phax resume invoice-export` and the review-stop path, and the exit code is 13. (refs §5.20, §5.21, §5.29, §5.30)

### The held seed holds what the person needs

Given that held run, when the seed files are read, then `.phax-context/interactive-review.md` in phase-02's worktree and `<run>/phase-02/review-seed.md` are identical. They contain the expectations, phase-02's plan section, its handoff, its file reconciliation, its base (phase-01's commit) and C2, phase-01's handoff, the plan sections of phase-03 to phase-06, the full plan's path, the gate commands and `phax resume invoice-export`. (refs §5.22)

### The stop's files are never committed

Given the held stop at phase-02 and the declared stop at phase-03, after the person edited src/export/invoiceRow.ts and wrote `.phax-context/correction-handoff.md` at each, when both stops are closed and every commit on the run's branches is listed, then phase-02's review commit and phase-03's commit each contain src/export/invoiceRow.ts and no path under `.phax-context/`. No commit on any of the run's branches contains `first-reading.md`, `interactive-session.json`, `review-stop.json` or an interactive transcript. (refs §5.23)

### phax's turns run read-only where the provider allows

Given phase-03 routed in turn to a fake claude-code CLI and to a fake codex CLI, each recording its argv, when the run stops at phase-03 and later closes it on a changed worktree, then for claude-code, the first turn and the closing turn each carry Claude's read-only tool set, and for codex both carry `sandbox_mode="read-only"`. Both turns also carry the phase's security posture. (refs §5.26)

### A first turn that edits is refused

Given phase-03 routed to a fake mistral-vibe CLI whose first turn answers a valid first-reading document and also writes src/export/invoiceRow.ts, when the run reaches phase-03, then after the turn, src/export/invoiceRow.ts is back at phase-02's content. `interactive-session.json` has no current session and records the first turn as `refused-change`. The output names src/export/invoiceRow.ts and prints the fresh-start command, the run is `awaiting_review` and the exit code is 13. (refs §5.27)

### A failed first turn still stops

Given in turn, a fake codex first turn that reports a rate limit, one that exits with a provider error, and one that answers twice without `$schema`, when the run reaches phase-03 in each case, then each run is `awaiting_review`, exits 13 and has no current session. The output names the failure (the reset time for the rate limit) and prints the fresh-start command and no continue command, and the third case had exactly one corrective resume. (refs §5.28, §5.29)

### No terminal, no wait

Given the invoice-export plan run with no TTY and a stdin pipe that is never written to, once without `--hold` and once with `--hold phase-02`, when each run reaches its first stop, then the first exits 13 at phase-03 and the second at phase-02, each with the run `awaiting_review`, and neither read anything from stdin. (refs §5.31)

### Only a declared or held phase stops

Given a plan with no interactive phase, whose phase-02 fake agent ends its handoff with a question to a person, run without `--hold`, and the same plan run with `--hold phase-03`, when each run runs, then in the first, no phase and no run is ever `awaiting_review`, and the run ends `review_open` with the same exit code as before this change. In the second, the only stop is at phase-03, with cause `held`. (refs §5.32)

### The review-stop document describes the stop and goes with it

Given the held stop at phase-02 with current session X0, and in a second run the declared stop at phase-03 with current session X1, when each run folder's `review-stop.json` is read, and then each stop is closed, then the first document's `$schema` names the `review-stop` format (asserted by format id and release pattern). It carries state `awaiting_review`, cause `held`, phase-02, C2's full sha as `phaseCommit` and no `firstReading` key. The second carries cause `declared`, phase-03 and the path of `first-reading.md`, and no `phaseCommit` key. Both name the worktree, the seed and the current session, a `continue` command naming the session, and the `enterPhase`, `close` and `reset` commands. After each stop closes, its `review-stop.json` no longer exists. (refs §5.33, §5.34)

### phax ls --json is a versioned run list

Given three runs: invoice-export held at phase-02, credit-notes stopped at declared phase-03, and payments-fix failed, when `phax ls --json` and `phax ls --awaiting-review --json` run, then each prints one JSON document whose `$schema` names the `run-list` format (asserted by format id and release pattern). In the first, invoice-export and credit-notes carry `state` `awaiting_review` and a `stop` equal to their `review-stop.json`, while payments-fix carries `state` `failed` and `stop` null. The second lists only invoice-export and credit-notes. (refs §5.35)

### The continue command is the provider's own

Given two fresh declared stops at phase-03 whose first turns succeeded, one on fake claude-code with session C1 and one on fake codex with session X1, when the stop output is read, then the claude-code stop prints `claude --resume C1` and the codex stop prints `codex resume X1`, each to run in phase-03's worktree, each carrying the phase's model, effort and posture flags. (refs §5.37, §5.36)

### An unverified provider gets a fresh start and keeps its session for closing

Given a declared stop at phase-03 on fake mistral-vibe whose first turn succeeded with session V1, when the stop output is read, and the phase is later closed on a changed worktree with no person's handoff file, then the output prints a fresh-start `vibe` command pointing at the seed, warns that its session will not be captured, and prints no `vibe --resume` command. The closing turn is a headless resume of V1. (refs §5.38, §5.36)

### Waiting is visible and filterable

Given one run held at phase-02 with builder session X0, one run at declared phase-03 with current session X1, one failed run and one interrupted run, when `phax ls`, `phax ls --awaiting-review` and `phax session-info` on each waiting run run, then `phax ls` shows `awaiting_review` with the cause (`held`, `declared`) and the stopped phase for the two waiting runs only, and the filter lists those two alone. Each `session-info` prints the state, the cause, the stopped phase, its worktree and X0 or X1. (refs §5.39)

### The worktree commands target the stopped phase

Given a run held at phase-02, with a fake shell and a fake editor that record their cwd and arguments, when `phax path invoice-export`, `phax shell invoice-export` and `phax open invoice-export` run, then `path` prints phase-02's worktree, the fake shell starts there, and the fake editor receives that path. (refs §5.40)

### enter-phase continues the current session, on codex too

Given phase-03 in `awaiting_review` with current codex session X1, a declared stop whose first turn failed, phase-02 held with builder codex session X0, and a committed headless codex phase-01 whose agent binding holds session X9, with a fake codex recording argv and cwd, when `phax enter-phase` runs on each of the three stops, and `phax enter-phase invoice-export phase-01` runs, then the first spawns `codex resume X1` interactively in phase-03's worktree. The second spawns the fresh-start command. The third spawns `codex resume X0` in phase-02's worktree, and the fourth `codex resume X9` in phase-01's worktree. None of them refuses as unsupported. (refs §5.41, §5.42)

### --new-session runs a new first turn at either stop

Given phase-03 at a declared stop with current session X1, phase-02 held with builder session X0, and a fake codex that reports X2 on its next headless start, when `phax enter-phase invoice-export phase-03 --new-session` and `phax enter-phase invoice-export phase-02 --new-session` run, then each runs a new read-only headless first turn, writes `first-reading.md` and makes X2 current with origin `new-session`, keeping X1 (and X0 respectively) in the history, and each spawns `codex resume X2` interactively. (refs §5.43)

### Who made the edit does not matter

Given two identical stops at phase-03 and two identical held stops at phase-02. In one of each pair, the test writes the corrections directly; in the other, a fake continued session writes the same bytes., when each is closed with `phax resume invoice-export --yes` and the same person's handoff file, then the two commits of each pair have the same tree and the two reconciliations of each pair are equal, the held ones computed against C2. (refs §5.44)

### The phase guard holds inside the worktree

Given a shell whose cwd is phase-02's worktree, with the run held there, when `phax resume invoice-export` and `phax enter-phase invoice-export phase-02` run there, then both are refused with the phase-guard message, and the run stays `awaiting_review`. (refs §5.45)

### Closing a declared stop gates, resumes the session for the handoff, commits and continues

Given phase-03 in `awaiting_review` with current codex session X1, a corrected src/export/invoiceRow.ts, a new test and no person's handoff file, when `phax resume invoice-export --yes` runs from the main checkout, then the gate runs before any agent turn. The closing turn is a headless resume of X1 given the corrections diff, its valid `interactive-handoff` answer is rendered to `<run>/phase-03/phase-handoff.md`, and no new session starts. The phase commits on `<run.branch>--phase-03` with the plan's subject and body, an `Interactive-Phase: phase-03` trailer and the checkout's git identity as author. phase-03 is `committed` with outcome `corrected`, and phase-04 starts in the same invocation. (refs §5.46, §5.50, §5.57)

### Closing a held stop leaves a review commit on the unchanged phase commit

Given phase-02 held at C2 with builder session X0, a cleanup command that writes a marker, a checkout whose git identity is Ada Example, corrections to src/export/invoiceRow.ts plus a new test, and no person's handoff file, when `phax resume invoice-export --yes` runs from the main checkout, then the gate runs before any agent turn. The closing turn is a headless read-only resume of X0 given the corrections diff, and its answer is rendered to `<run>/phase-02/correction-handoff.md`, while `<run>/phase-02/phase-handoff.md` is byte-identical to before. `<run.branch>--phase-02` holds C2 unchanged and exactly one commit on top of it, with the plan's subject, a `Held-Phase: phase-02` trailer and Ada Example as author. `interactive-transcripts/X0.jsonl` exists and the cleanup marker is then written. phase-02's outcome is `corrected`, and phase-03's worktree is created at the review commit in the same invocation. (refs §5.59, §5.61, §5.62, §5.50, §5.46)

### A held phase reviewed without change leaves no commit

Given phase-02 held at C2 with no change in its worktree and no person's handoff file, when `phax resume invoice-export --yes` runs, then the gate runs and no closing turn runs. `correction-handoff.md` holds the fixed reviewed-without-change text, `<run.branch>--phase-02` still ends at C2, and phase-02's outcome is `unchanged`. The exit code is never 9, and phase-03's worktree is created at C2. (refs §5.60, §5.61)

### A closing turn without a usable session starts fresh

Given in turn, phase-03 with no current session, and phase-02 held whose builder session X0 the fake codex reports as not found on resume, each with a changed worktree and no person's handoff file, when `phax resume invoice-export --yes` runs on each, then each closing turn is a new headless codex session given the seed and the corrections diff, and each stop closes with outcome `corrected`. (refs §5.51)

### A red gate returns the phase to the person

Given corrections at declared phase-03 that break the unit-test gate step, and in a second run, corrections at held phase-02 that break it, when `phax resume invoice-export --yes` runs on each, and runs again after the test is fixed, then each first resume exits 4 with no fix attempt and no agent turn, keeps its `checks-attempt-NN.log`, commits nothing, and leaves the run and the phase `awaiting_review`, with C2 still phase-02's tip. Each second resume closes the stop and continues. (refs §5.47)

### The person's handoff is used as written

Given phase-02 held with builder session X0 and a `.phax-context/correction-handoff.md` holding the four interactive sections and one Guards entry per correction, when `phax resume invoice-export --yes` runs, then no closing turn runs, `<run>/phase-02/correction-handoff.md` equals the person's file byte for byte, and `<run>/phase-02/phase-handoff.md` is unchanged. (refs §5.49, §5.48)

### An invalid handoff commits nothing

Given in turn, a person's handoff file without `## Guards`, a person's handoff file with three corrections and two Guards entries, and a fake closing turn that answers twice with no `corrections`, when `phax resume invoice-export --yes` runs on each, then the first two exit 1, naming the missing section or the uncovered correction, and the third exits 5 after exactly one corrective resume. None commits, and the run stays `awaiting_review`. (refs §5.48, §5.53)

### A closing turn that edits is refused

Given a stop with a green gate, no person's handoff file, and a fake closing turn that answers a valid handoff and also creates src/export/labels.ts, when `phax resume invoice-export --yes` runs, then it exits 5 naming src/export/labels.ts. The file is still in the worktree, nothing is committed and the run stays `awaiting_review`. (refs §5.52)

### A limit at closing keeps the stop

Given a stop with a green gate and a fake closing turn that reports a usage limit with a reset time, when `phax resume invoice-export --yes` runs, then it exits 8 naming the reset time, commits nothing, and leaves the run and the phase `awaiting_review`. (refs §5.54)

### The transcripts are captured, even of a session never continued

Given a test HOME in which the fake codex keeps rollout files under `.codex/sessions/2026/10/21/` for X1 (a declared stop's first turn, never continued), X2 (from `--new-session`, continued) and X0 (a held phase's builder session), when the declared stop and the held stop close, then `interactive-transcripts/X1.jsonl` and `interactive-transcripts/X2.jsonl` exist in phase-03's run folder, `interactive-transcripts/X0.jsonl` exists in phase-02's, and X2's copy includes the closing turn. (refs §5.55)

### A missing transcript never blocks closing

Given phase-03 with current session X1 whose rollout file was deleted, when `phax resume invoice-export --yes` runs, then phase-03 commits and the run continues, and phase-03's record names X1's transcript as missing, with its reason. (refs §5.56)

### A declared phase reviewed without change

Given phase-03 in `awaiting_review` with current session X1, no change in its worktree and no person's handoff file, when `phax resume invoice-export --yes` runs, then the gate runs and no closing turn runs. The handoff is the fixed reviewed-without-change text, and an empty commit with the plan's subject and the `Interactive-Phase` trailer lands on `<run.branch>--phase-03`. The outcome is `unchanged`, X1's transcript is copied, the exit code is never 9, and phase-04 starts. (refs §5.58)

### Later phases read the corrections

Given a run of the invoice-export plan started with `--hold phase-02`, whose held phase-02 and declared phase-03 have both closed corrected, and a second plan whose phase-03 and phase-05 are both interactive, when the prompts of phase-04 to phase-06 are built, then in the first run, each prompt carries a `## Review corrections` section holding phase-02's `correction-handoff.md` and then phase-03's handoff verbatim, with the precedence sentence and the statement that its own plan section binds. In the second plan, phase-06's section holds phase-03's handoff, then phase-05's. (refs §5.63)

### The plan stays as approved

Given a run started with `--hold phase-02`, before its first stop and after phase-03 has committed, when phax-plan.json and the run's plan.md are compared, and phase-04's prompt is built, then both files are byte-identical across both stops, and phase-04's prompt carries its approved plan section unchanged. (refs §5.64)

### Corrections are not deviations

Given a declared phase-03 that changed src/export/invoiceRow.ts and created tests/export/invoiceRow.test.ts and src/export/labels.ts, and a held phase-02 whose phase commit planned src/export/invoiceRow.ts and whose corrections changed it and created src/export/labels.ts, when their files are reconciled and the compliance review's prompt is built, then `file-reconciliation.json` lists phase-03's three files as review corrections and none as an unplanned edit. phase-02's reconciliation of C2 is byte-identical to the one written before the stop, and its two corrections are listed as review corrections against C2. The compliance prompt presents phase-03 as declared and phase-02 as held, each with its interactive handoff. (refs §5.65, §5.66, §5.44)

### The review handoff and the PR show the review

Given a run that reaches `review_open` with held phase-02 corrected, declared phase-03 corrected and held phase-04 unchanged, each closed by the git identity Ada Example, when `review-handoff.md` and the PR body are built, then the review handoff lists the three phases with their causes, outcomes, Ada Example, and phase-02's and phase-03's corrections and guards. The PR body's lines mark phase-02 held and corrected, phase-03 interactive and corrected, and phase-04 held and reviewed without change, each by Ada Example. (refs §5.67)

### Records and the security record name the review honestly

Given records configured, and two closed runs, one whose phase-03 recorded session X1 with its transcript and one whose first turn failed, when `phax records explain` is given each run's phase-03 commit, and each phase-03 security record is read, then each names phase-03 as interactive with cause `declared`, its outcome and Ada Example. The first names codex, the model, X1 and the transcript's sha256, and the second names no session. With `records.transcript` true or false, neither records branch contains X1's transcript content, and the first run's folder keeps `interactive-transcripts/X1.jsonl`. Both security records state that the person's work ran outside phax's enforcement, and record the applied posture of every first turn and closing turn that ran. (refs §5.68, §5.70)

### A held phase's record is written once, at closing

Given records configured and phase-02 held at C2 with builder session X0, when the records branch is read while phase-02 is held, and again after it closes corrected with review commit R2, and `phax records explain` is given C2 and then R2, then while held, the records branch holds no record for phase-02. After closing it holds exactly one, naming C2 and R2, cause `held`, outcome `corrected`, Ada Example, and X0 with its transcript's sha256. Both `records explain` calls name that record. (refs §5.69, §5.68)

### Only phax's turns are costed, each by its own increment

Given a closed run whose phase-03 had a first turn of fake claude-code session C1, which the person continued, then a closing turn resuming C1 whose stream reports a cumulative cost of $1.40 over a turn whose own cost is $0.30; a held phase-02 closed by a turn resuming its builder session; and kept runs with interactive phases, when `cost-ledger.json` is read and `phax plans estimate <plan> --no-probe --json` runs, then the ledger holds exactly one `first-turn` and one `closing-turn` entry for phase-03, and the closing-turn entry holds $0.30, not $1.40. phase-02's builder entries are unchanged, and it gains one `closing-turn` entry, holding that turn's own increment. No entry covers the person's turns. The estimate names phase-03 as interactive and sizes only its first and closing turns. (refs §5.71, §5.72)

### Reset at a declared stop sets it up again

Given phase-03 in `awaiting_review` with three uncommitted corrections and current session X1, when `phax reset-phase invoice-export phase-03` runs and is confirmed, then `phax resume invoice-export --yes` runs, then the confirmation names the three files. The worktree, the branch and the recorded sessions are removed. The resume recreates phase-03 at phase-02's commit, rewrites the seed, runs a new first turn and exits 13. (refs §5.73)

### Reset at a held stop runs the phase again and holds it again

Given phase-02 held at C2 with two uncommitted corrections, and separately a run held at phase-04, when `phax reset-phase invoice-export phase-02` runs and is confirmed and `phax resume invoice-export --yes` follows, and `phax reset-phase <second run> phase-02 --yes` runs, then the confirmation names C2 and the two files. The worktree, `<run.branch>--phase-02` with C2, and the recorded sessions are removed. The resume runs phase-02 headless from phase-01's commit, commits it again and stops there with cause `held` and exit 13. The second reset refuses, naming phase-04, and changes no worktree, branch or state. (refs §5.73, §5.74)

### Reset the stopped phase first

Given phase-03 in `awaiting_review`, when `phax reset-phase invoice-export phase-02 --yes` runs, then it refuses, naming phase-03, and changes no worktree, branch or state. (refs §5.74)

### adjust-plan and archive treat the stop as unfinished

Given a run in `awaiting_review`, when `phax adjust-plan <plan> --landed invoice-export`, `phax archive invoice-export` and `phax archive invoice-export --force` run, then adjust-plan refuses, naming `awaiting_review`, and starts no session. Archive without `--force` refuses, naming the state and the flag, and archive with `--force` archives the run. (refs §5.75, §5.76)

### A held oracle phase is judged again when its review changes an oracle file

Given a four-phase invoice-export variant whose phase-02 is an oracle phase with oracle file tests/export/invoiceRow.test.ts, discharged by phase-03, and an `oracles` provider `./fake-oracles` that records each request and answers a checked report with no finding, run with `--hold oracle`, when the run stops at phase-02, the person changes an assertion in tests/export/invoiceRow.test.ts, the stop is closed and the run continues to phase-03's gate; and, in a second run, the correction changes only src/export/invoiceRow.ts, then in the first run, the closing gate's last step is the oracle step, with an `authored` request whose `phase` and `oraclePhase` are phase-02 and whose `base` is phase-01's full commit. The review commit lands, and phase-03's `discharged` request names it as `oracleCommit`. In the second run, no oracle step runs at closing, and phase-03's `oracleCommit` is phase-02's phase commit. (refs §5.78, §5.79)

### A declared review between the pair is allowed and moves the oracle commit

Given a five-phase variant whose phase-02 is an oracle phase discharged by phase-04 and whose phase-03 carries `**Mode:** interactive` and plans no file, with `./fake-oracles` configured, when `phax plans lint` runs, and the run stops at phase-03, where the person changes an assertion in tests/export/invoiceRow.test.ts and closes the stop, then lint reports no `oracles` finding. phase-03's closing gate ends with an `authored` request whose `phase` is phase-03 and whose `oraclePhase` is phase-02, and phase-04's `discharged` request names phase-03's commit as `oracleCommit`. (refs §5.77, §5.78, §5.79)

### A held discharge closes on its configured steps

Given the four-phase variant run with `--hold phase-03`, whose discharging phase-03 passed its gate, including a `discharged` verdict naming `oracleCommit` C2, with `./fake-oracles` recording each request it receives, when the person changes nothing and closes the stop; and, in a second run, the person changes `toBe(120)` to `toBe(100)` in the oracle file and closes the stop; and, in a third, the person's change makes a configured step fail, then the first closing gate runs only the configured steps, `./fake-oracles` receives no request, and the phase closes `unchanged`. In the second, the configured steps pass, no oracle request is sent, and the review commit carries the changed assertion. In the third, the red configured step returns the phase to the person: no fix attempt runs, nothing is committed, the run stays `awaiting_review` and the exit code is 4. (refs §5.80, §5.47)

### Plans and runs without a stop are unchanged

Given a plan with no Mode line, run without `--hold` once with the binary before this change and once with the binary after it, when `phax plans lint`, `phax run` and `phax records explain` run, then both binaries produce the same lint findings, prompts (with no `## Review corrections` section), states and exit codes. The new run's phax-plan.json carries `"mode": "headless"` on every phase, and its `run-status.json` carries `"hold": { "selection": "none" }`. (refs §5.81)

## 9. Open questions

None.

## 9b. Arbitrated questions

### q-hold-config — Can a configuration layer ask for the hold, as well as `phax run --hold`?

- flag-only — Only `phax run --hold` asks for the hold, and no configuration key exists — abandons: A standing default for someone who holds every run: they type the flag each time, or their review UI passes it.
- config-key — A `hold` key in phax.json and the user overlays sets a default, which the flag overrides — abandons: Knowing from the command line whether a run will stop. A user overlay that nobody else sees turns an unattended `phax run` (a conductor loop, a teammate's machine) into one that exits 13 at every phase.

Recommendation: flag-only — A hold is a decision about one run, made by the person who will be there to review it. A config default would make an unattended invocation stop for a person nobody asked, which is what runs-stay-autonomous guards against. The fork's daily user loses only the typing: their UI, or their fork, passes the flag. Adding a key later is cheap. Removing one later would be a breaking schema change.

Decision: flag-only — by operator (Rémy Loubradou), 2026-10-21
Why: Decided by the operator on 2026-10-21, as recommended: A hold is a decision about one run, made by the person who will be there to review it. A config default would make an unattended invocation stop for a person nobody asked, which is what runs-stay-autonomous guards against. The fork's daily user loses only the typing: their UI, or their fork, passes the flag. Adding a key later is cheap. Removing one later would be a breaking schema change. Advocate: A standing default spares the daily hold user the flag on every run, and their UI or fork the work of passing it. Principles: none. Reversibility: cheap. Revised: none.

### q-hold-resume — Is the hold fixed when the run is named, or can `phax resume` change it?

- fixed — Resolved and recorded by `phax run`, with no `--hold` on `phax resume` — abandons: Adding a stop mid-run. A person who sees at phase-03 that phase-05 needs them too cannot add it, short of having held every phase from the start.
- replace-on-resume — `phax resume --hold <selection>` replaces the selection for the phases not yet started, recorded in run-status.json — abandons: One selection per run. run-status, the records and the review handoff carry a history of selections, and a conductor loop resuming with a stale flag can silently drop a stop the operator asked for.

Recommendation: fixed — `--hold` with no value already covers 'I will know when I read it'. Its cost is closing the stops one does not need, which takes a gate run each and leaves no commit when nothing changed. A fixed selection keeps run-status a single fact that a UI and the records can trust. `phax resume --hold` can be added later without changing the recorded shape.

Decision: fixed — by operator (Rémy Loubradou), 2026-10-21
Why: Decided by the operator on 2026-10-21, as recommended: `--hold` with no value already covers 'I will know when I read it'. Its cost is closing the stops one does not need, which takes a gate run each and leaves no commit when nothing changed. A fixed selection keeps run-status a single fact that a UI and the records can trust. `phax resume --hold` can be added later without changing the recorded shape. Advocate: A person who learns at phase-03 that phase-05 needs them could add the stop without having held every phase from the start. Principles: none. Reversibility: cheap. Revised: none.

### q-final-hold — Can the final phase be held, given that it already reaches `review_open`?

- final-excluded — `--hold` never selects the final phase, and listing it is refused — abandons: A review of the final phase before auto-compliance and auto-publish run: with `publish.auto` on, the PR opens before a person has looked, as it does today.
- final-holdable — The final phase can hold, stopping in `awaiting_review` before run completion, review_open, compliance and publish — abandons: One end of the run. The final phase gets two stops in a row, review_open's order (completion, review handoff, compliance, publish) gains a step, and the stop's purpose, that later phases read the correction, has no later phase.

Recommendation: final-excluded — review_open already is the final phase's kept-open review, with `phax enter`, `review-code` and `--append`. `publish.auto` is the setting that decides whether a PR opens before a person looks. A declared stop already cannot be last (r-lint-place), so the two stops follow one rule.

Decision: final-excluded — by operator (Rémy Loubradou), 2026-10-21
Why: Decided by the operator on 2026-10-21, as recommended: review_open already is the final phase's kept-open review, with `phax enter`, `review-code` and `--append`. `publish.auto` is the setting that decides whether a PR opens before a person looks. A declared stop already cannot be last (r-lint-place), so the two stops follow one rule. Advocate: With publish.auto on, a person could review the final phase before compliance runs and the PR opens. Principles: none. Reversibility: cheap. Revised: none.

### q-held-session — Which session continues a held phase, and so what does `phax enter-phase` open there?

- builder-default — The builder session is current: `phax enter-phase` continues it, and `--new-session` starts a read-only first turn on request — abandons: An independent first reading at the stop. By default the person meets the session that wrote the code, with its blind spots, and the stop prints the phase's own handoff rather than a fresh reading of what later phases will copy.
- first-turn — Like a declared stop, every held stop runs a read-only first turn, which becomes the current session — abandons: The builder's context, and one turn per held phase. With `--hold` and no value, every phase spends a headless turn before the person looks, even at the stops they close at once.
- builder-only — The builder session, with no `--new-session` at a held phase — abandons: A fresh look when the builder session is the problem: the person must start an uncaptured session by hand.

Recommendation: builder-default — At a held stop the person is the fresh look. The builder session already knows why each choice was made, and resuming it costs nothing until the person types. q-new-session's `--new-session` stays available at both stops for an independent reading. A first turn at every held stop would make `--hold` with no value expensive for exactly the case it exists for.

Decision: builder-default — by operator (Rémy Loubradou), 2026-10-21
Why: Decided by the operator on 2026-10-21, as recommended: At a held stop the person is the fresh look. The builder session already knows why each choice was made, and resuming it costs nothing until the person types. q-new-session's `--new-session` stays available at both stops for an independent reading. A first turn at every held stop would make `--hold` with no value expensive for exactly the case it exists for. Advocate: A fresh read-only first turn at every held stop would give an independent reading free of the builder's blind spots. Principles: none. Reversibility: cheap. Revised: none.

### q-close-red-gate — What does closing do when the gate is red, at either stop?

- return-to-person — No fix loop: the phase stays in `awaiting_review` and the command exits 4 (the current rule, applied at both stops) — abandons: Autonomous repair at closing: the person, or an agent they run, fixes every red step, including a format or lint nit their own edit introduced.
- builder-fix-loop — The fork's way: the usual fix loop runs in the builder session until the gate is green — abandons: Authorship of the reviewed code. phax's agent rewrites code after the person's review, the review commit carries changes the person never saw under their name, phax's own turns stop being read-only, and a changed file no longer reads as the person's correction.

Recommendation: return-to-person — By definition, the person is present at a stop. A fix they did not see would land in a commit attributed to them, which breaks the claim that every changed file is a correction. The repair stays one command away: continue the session and ask it to make the gate green, which keeps the person the author.

Decision: return-to-person — by operator (Rémy Loubradou), 2026-10-21
Why: Decided by the operator on 2026-10-21, as recommended: By definition, the person is present at a stop. A fix they did not see would land in a commit attributed to them, which breaks the claim that every changed file is a correction. The repair stays one command away: continue the session and ask it to make the gate green, which keeps the person the author. Advocate: A format or lint nit the person's own edit introduced would be repaired without them, as the fork does in the builder session. Principles: none. Reversibility: cheap. Revised: none.

### q-review-commit — What do a held phase's corrections leave on its branch?

- review-commit — One more commit on the phase branch, on top of the unchanged phase commit, with a `Held-Phase: <phase id>` trailer and the person as author — abandons: One commit per phase: a held phase spans two commits, and its reconciliation, record and PR line cover a range.
- amend — The phase commit is amended to include the corrections — abandons: The split between the agent's work and the person's correction. It becomes one commit with one author, and the commit the phase's gate passed and its handoff described no longer exists on any branch.
- fixup — A `fixup! <subject>` commit, as in the fork — abandons: A history that stands as merged. A `fixup!` subject asks for a squash phax never performs, so it either lands on main as is or is squashed by hand, rewriting the commits the records name.

Recommendation: review-commit — It keeps both facts: what the agent delivered and passed its gate on, and what the person changed. Records, attribution and `git log` already work per commit. The range costs only a record that names two commits (q-held-record) and a reconciliation of the corrections against the phase commit.

Decision: review-commit — by operator (Rémy Loubradou), 2026-10-21
Why: Decided by the operator on 2026-10-21, as recommended: It keeps both facts: what the agent delivered and passed its gate on, and what the person changed. Records, attribution and `git log` already work per commit. The range costs only a record that names two commits (q-held-record) and a reconciliation of the corrections against the phase commit. Advocate: One commit per phase keeps every record, reconciliation and PR line about a single commit, as today. Principles: none. Reversibility: cheap. Revised: none.

### q-held-handoff — Which handoff does a held phase's review produce?

- correction-beside — An interactive handoff in four sections, beside the phase's own unchanged handoff, which later phases read under `## Review corrections` — abandons: One handoff per phase: the next phase reads the builder's handoff and the correction separately, and relies on q-precedence to rank them.
- rewrite-own — The phase's own four-section handoff is rewritten to describe the corrected state — abandons: The correction as its own guarded fact. There is no Guards section and no `## Review corrections` for the later phases, and the builder's account of its own choices is overwritten.

Recommendation: correction-beside — A declared stop and a held stop then produce the same handoff, read in the same section and validated by the same rule, so a UI and the later phases see one shape. q-precedence already settles the ranking: the correction wins where the two disagree, and the plan still binds.

Decision: correction-beside — by operator (Rémy Loubradou), 2026-10-21
Why: Decided by the operator on 2026-10-21, as recommended: A declared stop and a held stop then produce the same handoff, read in the same section and validated by the same rule, so a UI and the later phases see one shape. q-precedence already settles the ranking: the correction wins where the two disagree, and the plan still binds. Advocate: One handoff per phase, rewritten to the corrected state, gives the next phase a single account to read. Principles: none. Reversibility: cheap. Revised: none.

### q-held-unchanged — What does a held phase reviewed without change leave on its branch?

- no-commit — Nothing: the branch ends at the phase commit, and outcome `unchanged` is recorded in the phase status, the record, the review handoff and the PR body — abandons: The review as git history: `git log` shows no trace that a person confirmed the phase; only phax's records and handoffs do.
- empty-commit — An empty commit with the `Held-Phase` trailer, as q-unchanged-commit decided for a declared phase — abandons: A clean history under `--hold`. With no value the flag selects every phase, and a run whose phases all pass review untouched adds one empty commit per phase to the PR.

Recommendation: no-commit — A declared phase needs its empty commit because it has no other commit to carry the review. A held phase already has its commit, and its record, written at closing, names the confirmation. q-unchanged-commit keeps binding the declared stop.

Decision: no-commit — by operator (Rémy Loubradou), 2026-10-21
Why: Decided by the operator on 2026-10-21, as recommended: A declared phase needs its empty commit because it has no other commit to carry the review. A held phase already has its commit, and its record, written at closing, names the confirmation. q-unchanged-commit keeps binding the declared stop. Advocate: An empty commit would leave the review in git history, where `git log` shows that a person confirmed the phase. Principles: none. Reversibility: cheap. Revised: none.

### q-stop-format — Which machine-readable format carries the stop, and which commands print it?

- review-stop-and-run-list — Two new versioned formats: `review-stop`, kept as `<run>/review-stop.json` while the run waits, and `run-list`, the document `phax ls --json` prints, whose runs embed it as `stop` — abandons: Today's `phax ls --json` shape: its bare array becomes an object with `$schema` and `runs`, and every script reading it changes once.
- extend-run-status — run-status.json gains a required `stop` block with the cause, phase and commands, and `phax ls --json` prints each run's run-status — abandons: run-status as phax's own state. Command lines and paths meant for a UI enter a persisted state file, and every change phax needs in its state becomes a breaking change for the UI.
- ls-only — Only `phax ls --json` becomes a versioned `run-list`, with the stop inline and no file — abandons: A stop a UI can read without running phax: it must poll a command that reconciles every registry entry and lock, rather than read or watch one file in the run folder.

Recommendation: review-stop-and-run-list — One document describes the stop, and both carriers hold it unchanged. A UI can watch a single file for one run, or poll `phax ls --json` for all of them. run-status stays phax's internal state. The break of ls --json is paid once, in docs/upgrading.md, which is the price of putting a `$schema` on a bare array.

Decision: review-stop-and-run-list — by operator (Rémy Loubradou), 2026-10-21
Why: Decided by the operator on 2026-10-21, as recommended: One document describes the stop, and both carriers hold it unchanged. A UI can watch a single file for one run, or poll `phax ls --json` for all of them. run-status stays phax's internal state. The break of ls --json is paid once, in docs/upgrading.md, which is the price of putting a `$schema` on a bare array. Advocate: Leaving `phax ls --json` a bare array spares every script that reads it a one-time change. Principles: none. Reversibility: costly. Revised: none.

### q-held-discharge — Does a held discharging phase's closing gate run the `discharged` verdict again?

- rerun-discharged — Yes, against the same `oracleCommit`, at every close — abandons: A person correcting an oracle at the discharge. A changed assertion is refused there, and the person resets back to the oracle phase or reviews the oracles at an earlier stop.
- no-oracle-step — No: the discharge was judged before the stop, and the closing gate runs only the configured steps — abandons: The proof that the oracles judging the code are the ones reviewed: a person's correction could weaken an assertion after its verdict, inside the discharging phase, and the provider would never see it.

Recommendation: rerun-discharged — The closing gate is the phase's own gate, and oracle-phases' doctrine is that the discharge changes oracle files only by removing markers. A person who disagrees with an oracle is disagreeing with the spec. The place for that is before the discharge, which `--hold oracle` now makes possible.

Decision: no-oracle-step — by operator (Rémy Loubradou), 2026-10-21
Why: Decided by the operator on 2026-10-21, against the recommendation (rerun-discharged): a held discharging phase's closing gate runs no oracle step, and its configured gate steps must pass as at any phase's closing. The discharge was judged before the stop. A person who corrects an oracle file at the discharge does so under the configured gate, as at any phase. Advocate: The closing gate would prove that the oracles judging the code are still the ones reviewed: a correction that weakens an assertion after its verdict would be refused by the provider. Principles: none. Reversibility: cheap. Revised: §5.80, §8, §10.

### q-held-record — When is a held phase's record written?

- at-close — Once, at closing, naming the phase commit and the review commit — abandons: A record of a held phase whose stop is never closed: a run archived with `--force` at a hold leaves the phase's committed agent work unrecorded.
- at-commit-and-close — At the phase commit, as today, then a second record of the review at closing — abandons: One record per phase: `phax records explain` on the phase commit names a record that predates the review, and two records describe one phase.

Recommendation: at-close — A held phase is not finished until its stop closes, as a declared phase is not. One record that names both commits answers `records explain` on either commit the same way. A run abandoned at a hold is unfinished work, which phax already leaves unrecorded.

Decision: at-close — by operator (Rémy Loubradou), 2026-10-21
Why: Decided by the operator on 2026-10-21, as recommended: A held phase is not finished until its stop closes, as a declared phase is not. One record that names both commits answers `records explain` on either commit the same way. A run abandoned at a hold is unfinished work, which phax already leaves unrecorded. Advocate: A record written at the phase commit records the agent's work even when the stop is never closed. Principles: none. Reversibility: cheap. Revised: none.

## 10. Implementation-planning note

Settled:

- Carried over unchanged from 2026-10-20 (the previous spec's §9b), not reopened: q-mode-line `interactive-only`, q-planned-work `review-only`, q-person-handoff `person-first`, q-new-session `new-first-turn`, q-precedence `over-handoffs`, q-exit-code `new-13`, q-unchanged-commit `empty-commit`, q-count-interactive `never`. The joint phase-shape decisions J1–J4 stand. J5's handover to oracle-phases is revised by decision 3 of 2026-10-21 (below).
- q-transcript-records `full` is narrowed by the operator on 2026-10-24: a stop's record names each recorded session and its transcript's sha256, but an interactive transcript's content never reaches the records branch, whatever `records.transcript` says. A session the person continued ran outside phax's enforcement and may hold secrets they typed or files outside the worktree; a dedicated records repository faces no visibility check. The copy stays in the run folder.
- The hold narrows two of those verdicts without reopening them. q-unchanged-commit binds the declared stop, and q-held-unchanged asks the held one. q-person-handoff's file moves from `.phax-context/phase-handoff.md` to `.phax-context/correction-handoff.md` at both stops, because at a held phase the old path holds the builder's handoff. q-new-session applies at both stops, and q-exit-code's 13 now covers both causes (decision 1).
- Already landed in PR #151, not to be redone: r-mode, r-mode-parse, r-mode-render and r-mode-lift (the `mode` key, the Mode line, its rendering and lift), and the not-yet-supported refusal. The runtime plans replace `unsupportedInteractiveFindings` with r-lint-place and r-lint-work, and verify the landed requirements against their criteria rather than re-implementing them.
- Decided by the operator on 2026-10-21, not to reopen. (1) The operator may hold a run when it starts. There is one state, `awaiting_review`, and one exit code, 13, and no agent ever stops a run. (2) A held phase is the headless phase that just committed: same id, branch and worktree, with the plan not rewritten. (3) A person may review an oracle phase before its discharge, and an interactive phase still takes no oracle role (q-interactive-role). (4) The three forms of `--hold`: a plan-declared interactive phase never holds, and a listed phase that does not exist or is interactive is refused before the run starts. (5) A normative `$schema` surface for a review UI.
- How a phase id and the `oracle` keyword are told apart: a phase id matches `phase-NN` (`phase-` followed by two or more digits), and `oracle` is the one keyword. A value is exactly `oracle`, or a comma-separated list of distinct phase ids, never a mix. Because `phax run` takes an optional positional short name, `phax run --hold invoice-export --plan …` reads `invoice-export` as the selection and refuses it with exit 1, telling the operator to put the name before `--hold` or write `--hold=<selection>`.
- The hold check is a run preflight check named `hold`, refusing with exit 11 like the other plan checks (J4). `phax plans lint` does not run it, because a hold belongs to a run, not to a plan. A malformed value is a bad argument (exit 1), refused before the plan is read.
- A held phase stops after its commit, its validated handoff and its gate attribution, and before its record and its cleanup commands. Cleanup leaves the worktree on disk, and the next phase already branches off the phase branch's tip, so a review commit is picked up with no change to how phases chain.
- oracle-phases changes that its plans must follow (decision 3):
  - §5.11 is dropped: an interactive phase may sit strictly between an oracle phase and its discharging phase (r-oracle-review). Its criterion 'Lint rejects an interactive phase inside the pair' is inverted, and its first plan's §5.11 finding is removed by this spec's runtime plan, as `unsupportedInteractiveFindings` is.
  - §5.19 and §5.21 are extended: the `authored` oracle step also runs as the closing gate's last step of a stop before the discharge whose corrections change an oracle file (r-oracle-authored).
  - §5.20 stands: a held discharging phase's closing gate runs only the configured steps, which must pass as at any closing, and no oracle step (r-oracle-held-discharge, q-held-discharge).
  - §5.22's `phase` may name that stopped phase.
  - §5.35 is replaced: the discharge names as `oracleCommit` the latest commit that passed `authored` (r-oracle-commit).
  - §5.36 is extended: a commit that is the pair's current `oracleCommit` is reset only after the discharge.
  - The §10 bullet 'The rule against an interactive phase inside a pair settles … the discharge always judges the oracle phase's own commit' is withdrawn.
  - §5.12 and q-interactive-role stand.
  Whichever runtime lands second, this spec's or oracle-phases', implements r-oracle-authored and r-oracle-commit. r-oracle-held-discharge asks only that the closing gate add no oracle step.
- The review UI reads and acts only through files and phax commands: `review-stop.json`, `phax ls --json`, the seed, the person's handoff file and `phax resume` / `phax reset-phase` / `phax enter-phase`. phax gains no server and no network.
- Decided by the operator on 2026-10-21 (§9b): q-hold-config `flag-only`, q-hold-resume `fixed`, q-final-hold `final-excluded`, q-held-session `builder-default`, q-close-red-gate `return-to-person`, q-review-commit `review-commit`, q-held-handoff `correction-beside`, q-held-unchanged `no-commit`, q-stop-format `review-stop-and-run-list`, and q-held-record `at-close`, all as recommended. q-held-discharge was decided `no-oracle-step`, against the recommendation: a held discharge's closing gate runs only the configured steps, which must pass as at any closing.

Left open:

- The spelling of the lint, preflight and refusal messages and the run, resume, ls, session-info and enter-phase output (all indicative), and whether `phax run --dry-run`, which returns before the preflight, prints the resolved hold.
- The exact flags of each continue and fresh-start command, and how the codex trust and hook prompts are told to the person.
- The seed's exact wording and order at each stop, and whether it embeds the full plan or points to the plan file in the worktree.
- The first-reading, interactive-handoff, interactive-session, review-stop and run-list document shapes behind their required `$schema`, beyond the keys §6 marks normative, and `lastClose`'s variants.
- How the worktree is compared before and after a turn (tracked files plus untracked files that are not ignored, leaving out `.phax-context/`), and how a first turn's edits are restored.
- Where `stop`, `outcome`, the review commit, the recorded sessions and the transcript digests live in the persisted phase status and the phase record, under the no-shims rule (required, with explicit variants for phases that never stopped).
- How each provider's session store is located for transcript capture (Claude's project folder, codex's dated rollout file, vibe's session directory), behind a port.
- The text of the reviewed-without-change handoff, and whether the next phase also keeps the interactive handoff in `## Previous phase handoff` or only in `## Review corrections`.
- How in-flight runs and extraction-cache entries written by an older binary are treated. run-status, phase-status and phax-plan each change shape, and each gets a frozen decoder of its current shape.
- Where the `interactive` and `hold` checks sit in RUN_PREFLIGHT_CHECKS.

Constraints:

- No back-compat shims in persisted schemas. `mode` is required on every phase, `hold` on every run-status, and the stop block on every phase status (null for a phase that never stopped). Older documents are read through frozen decoders of their own shapes, never by decoding a new key as optional. The run-list row keys are required, null when unknown, never dropped.
- Explicit per-variant enums:
  - `mode`: headless | interactive.
  - `hold.selection`: none | all | listed | oracle, with `phases` on every variant but none.
  - stop cause: declared | held.
  - outcome: corrected | unchanged.
  - session origin: first-turn | new-session | builder.
  - interactive resume support: verified | unverified.
  - first-turn outcome: answered | failed | refused-change.
  - guard kind: test | lint | gate-step | none.
  - review-stop: one variant per cause, each with exactly its keys.
  `awaiting_review` is a new run state and a new phase state, never `interrupted` with a free-text reason.
- State transitions go only through `src/domain/state.ts` and the reducer that interprets events against PhaxState. The new transitions:
  - running → awaiting_review at a declared stop;
  - running, with the phase committed, → awaiting_review at a held stop;
  - awaiting_review → running on closing;
  - back to awaiting_review on a red gate, an editing closing turn, an invalid handoff or a limit;
  - awaiting_review → archived with `--force`.
  A reset follows today's reset-phase rules, extended to a held phase's commit.
- Every provider answer and every new format carries a required `$schema`, and an answer with none, or of an unknown version, is refused. `review-stop`, `run-list`, `first-reading`, `interactive-handoff` and `interactive-session` are born with it and join FORMAT_IDS and SCHEMA_BORN_FORMAT_IDS. run-status and phase-status get next snapshots, all published through `@lbdremy/phax-schemas`.
- Respect the layers. The hold grammar and resolution, the seed, the worktree comparison verdict, the handoff validation, the review-stop document and the prompt section are pure domain or app logic. Every file write, git operation, provider spawn and session-store read goes through its port.
- The phax CLI gains no network access. The first turn and the closing turn are provider sessions spawned through the Backend port, and a continued session is the provider's own CLI, which phax only prints or execs.
- Provider-agnostic: nothing may depend on a Claude Code feature the other providers lack. Session ids come from the headless turn's stream (a held phase's builder session included), never from `--session-id`. A read-only mode is a narrowing used where it exists, never the only guard.
- The cost ledger takes each resumed turn's own increment, never a session's cumulative cost (Claude Code 2.1.280 and later report cumulative cost on `--resume`).
- The phase guard's classification is unchanged: resume, enter-phase, shell and open stay refused inside a phase worktree, a held phase's included.
- Fixtures and examples are made up (the invoice-export, credit-notes and payments-fix runs, Ada Example, `./fake-oracles`, the session ids), and fake provider CLIs keep their session stores under a test HOME. Tests hold across a release cut: `$schema` URLs are asserted by format id and release pattern, never by the running release's version.
- Update `phax --usage` (run --hold, resume, enter-phase, ls --json and --awaiting-review, session-info, path, shell, open, reset-phase, adjust-plan, archive, and the exit table), README §Run and §Resume, docs/upgrading.md (the `phax ls --json` shape change, and `hold` in run-status) and the phax-planning skill. Generated docs follow from phax.usage.kdl.

## 11. Docs page

Page: README §Interactive phases and holds (under §Run, after §Resume), docs/upgrading.md for the `phax ls --json` change, plus an interactive-phase section in the phax-planning skill

Reader: Three readers: a planner who sees that one phase sets a pattern later phases repeat; an operator who wants to review phases they could not pick at planning time, or an oracle phase's tests before their discharge; and the author of a review UI who reads `review-stop.json` and `phax ls --json`.

Example: `phax run --plan docs/plans/2610191200-invoice-export-plan.md --hold phase-02` commits phase-01, then runs phase-02 headless, gates and commits it (5d6e7f8) and stops. It exits 13 with `awaiting_review (held)`, the worktree, `.phax-context/interactive-review.md`, `codex resume <builder session id>` and `~/.phax/runs/invoice-export/review-stop.json`. Ada continues the builder session, changes the header wording to `Invoice number`, adds a test for it, and runs `phax resume invoice-export` from the main checkout. The gate runs, and phax resumes the session headless for `correction-handoff.md` (What was corrected, The pattern to follow from now on, Guards, What the next phases need to know). phax then commits one review commit on 5d6e7f8 with `Held-Phase: phase-02` and Ada as author, and starts phase-03, the plan's declared interactive phase. There a short read-only codex turn reports what phase-04 and phase-05 will copy, and the run stops again. Every later phase reads both corrections under `## Review corrections`. With `--hold oracle`, the same stop lets a person review an oracle phase's tests before the discharge, and an edit to them is judged `authored` again before the discharge runs.

## 12. Decision log

- 2026-10-21 q-hold-config decided flag-only — operator (Rémy Loubradou)
- 2026-10-21 q-hold-resume decided fixed — operator (Rémy Loubradou)
- 2026-10-21 q-final-hold decided final-excluded — operator (Rémy Loubradou)
- 2026-10-21 q-held-session decided builder-default — operator (Rémy Loubradou)
- 2026-10-21 q-close-red-gate decided return-to-person — operator (Rémy Loubradou)
- 2026-10-21 q-review-commit decided review-commit — operator (Rémy Loubradou)
- 2026-10-21 q-held-handoff decided correction-beside — operator (Rémy Loubradou)
- 2026-10-21 q-held-unchanged decided no-commit — operator (Rémy Loubradou)
- 2026-10-21 q-stop-format decided review-stop-and-run-list — operator (Rémy Loubradou)
- 2026-10-21 q-held-discharge decided no-oracle-step — operator (Rémy Loubradou) — revised 3 sections
- 2026-10-21 q-held-record decided at-close — operator (Rémy Loubradou)
