---
status: Draft
date: 2026-10-19
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---
# Interactive phases: a plan-declared stop where a person corrects the pattern, with any editor and any agent CLI

## 1. Context

phax runs a plan's phases in order. Each phase gets its own worktree on `<run.branch>--phase-NN`, branched off the previous phase's branch. A headless agent session does the work, the gate runs, and a same-session fix loop repairs a red gate. phax then commits the phase and writes its handoff to `<run>/<phase>/phase-handoff.md`, in four sections: What was delivered, Key decisions and why, Exact locations, What the next phase needs to know. The next phase's prompt carries only the immediately previous handoff, under `## Previous phase handoff`. The last phase stays open in `review_open`.

Runs stay autonomous (decided 2026-10-10). A run stops only on a cause a machine detects: a rate or usage limit (exit 8), an exhausted or refused gate (exit 4), a phase with no change (exit 9), or a failed commit or cleanup. Each pause writes `resume-instructions.md`. Resuming after an exhausted gate runs the gate again first, and a green gate commits with no new agent invocation. The `phase-decision-requests` spec, which let an agent stop mid-phase to ask a person, is parked. Inside a phase worktree, which phax recognises by its gitignored `.phax-context/` folder, the phase guard refuses `resume`, `enter-phase`, `shell`, `open`, `run`, `reset-phase` and the artifact transitions. `phax report` opens a GitHub issue from telemetry; it is not a status view. The status views are `phax ls` and `phax session-info`.

Interactive re-entry today is `phax enter-phase <run> <phase>`. For Claude Code it runs `claude --resume <id>`. The codex and mistral-vibe adapters answer "interactive resume unsupported" and name a manual command instead. `phax artifact decide` resumes its interactive session headless for a structured answer and writes the transcript beside the artifact. It is Claude Code only, because it starts the session with `claude --session-id`, the only way phax can know an interactive session's id in advance. A headless turn (`claude -p`, `codex exec --json`, `vibe -p`) reports its session id in its output stream, on every provider.

Verified on 2026-10-19 with codex-cli 0.153.4:
- A session started by `codex exec --json` resumes in the interactive UI with `codex resume <id>` and shows the headless turn.
- Afterwards, `codex exec resume <id>` sees the interactive turns.
- The whole session is one file, `~/.codex/sessions/YYYY/MM/DD/rollout-*-<id>.jsonl`.
- The first interactive open of a new directory asks the person to trust it, then to review its hooks.

Not verified: whether a `vibe -p` session resumes interactively with `vibe --resume <id>`, because the local install is outdated. Claude Code keeps each session as `~/.claude/projects/<cwd slug>/<id>.jsonl`. Vibe keeps a session directory, which phax already finds to read usage.

Phase sessions run under a security posture:
- Claude Code: its permission flags.
- codex: a `workspace-write` sandbox, with writable roots and network access set.
- vibe: `--workdir` and `--add-dir`, with no per-command or network restriction.

phax already has a read-only mode for Claude Code (its read-only tool set) and for codex (`sandbox_mode="read-only"`). It uses none for vibe. Since Claude Code 2.1.280, a `--resume` invocation reports cost cumulatively over the whole session.

The 2026-10-18 spike showed that the stop by itself is the value. Seeded with the executed phases' handoffs and the upcoming phases' intent, an agent in the stopped worktree saw, unprompted, that "any flaw will spread to all four" later phases. It then turned a review comment into a fix plus a test.

Ground read:

- `docs/specs/archive/2610190918-interactive-phases.md` — The first draft, Abandoned on 2026-10-19. This spec keeps its structure and what the 2026-10-19 decisions leave alone: the per-phase `mode`, where lint sits, review-only phases, `awaiting_review`, exit 13, gate first then handoff then commit, the four-section handoff, `## Review corrections` for every later phase, the empty commit when nothing changed, and the reset, adjust-plan and archive rules. It was dropped because its optional seeded session, started interactively by `phax enter-phase`, had an id phax could not learn on codex or vibe. Its ground read (oracle-phases, phase-decision-requests, phaxPlan.ts, planDocument.ts, parsePlanMarkdown.ts, promptGeneration.ts, handoffInjection.ts, handoffGuidance.ts, phaseGuard.ts, resume.ts, resumeInstructions.ts, backend.ts, status.ts, the phax-planning skill) was done the same day, and this spec relies on it.
- `spikes/review-screen/README.md` — The 2026-10-18 spike on the archived run phax.brief-provider, stopped after phase-03 of 7. A seeded agent in the stopped worktree saw on its own that the later phases copy phase-03's pattern, and it turned a comment into a fix plus a test. The spike left two questions for this spec: how the phase closes (gates, handoff, commit) and how long the session lives. Its worktree had no node_modules, so the real stop must run the phase setup.
- `src/domain/session/claude.ts` — Claude Code's interactive resume is `claude --resume <id>`. A pre-prompted start uses `--session-id <id>`, which is the only way phax can know an interactive session's id up front. `buildDecideInvocation` is Claude-only.
- `src/domain/session/codex.ts` — Both interactive resume and a pre-prompted start answer `unsupported` and name `codex exec resume <session-id>` for a manual resume. This spec lifts interactive resume for codex, now that it has been verified.
- `src/domain/session/mistral.ts` — Both interactive resume and a pre-prompted start answer `unsupported` and name `vibe --resume <session-id>`. Vibe's interactive resume stays unverified.
- `src/cli/commands/enterPhase.ts` — enter-phase reads the phase's agent binding and runs the adapter's resume invocation. It fails with the adapter's `unsupported` message for codex and mistral-vibe.
- `src/schemas/phaseAgentBinding.ts` — The per-phase agent binding: provider, adapter, model, effort, a nullable sessionId, the worktree and a status enum that already contains `awaiting_manual_review`.
- `src/domain/state.ts` — RunState: created, running, failed, review_open, completed, stopped, archived, interrupted, rate_limited. PhaseState and the hierarchical PhaxState have no state for waiting on a person.
- `src/infra/providers/codexCli.ts` — A phase session runs codex under `sandbox_mode="workspace-write"`, with its writable roots and network access set and approval set to never. Completions run under `sandbox_mode="read-only"`, so codex has a read-only mode phax already uses.
- `src/infra/providers/mistralVibe.ts` — The secure vibe flags are `--workdir` and `--add-dir`, with no per-command or network restriction. The model is passed through the `VIBE_ACTIVE_MODEL` environment variable, and phax uses no read-only mode for vibe.
- `src/app/decideArtifact.ts` — After decide's interactive session, phax resumes that session headless for a structured answer. A refused answer gets one corrective resume, and each resume's transcript is written to the artifact's folder. Closing an interactive phase follows the same pattern.
- `src/cli/commands/runLayers.ts` — EXIT_CODE_MEANINGS runs from 0 to 12, and a test keeps the README table in step with it. 8 (rate or usage limit) and 9 (no changes) are resumable codes, and 13 is free.
- `docs/specs/2609250823-headless-review.md` — Approved. It covers `review-code` and `--new-session`, `review_open`, and `phax run --append`, which takes a run from review_open back to running. The interactive phase sits before all of this and changes none of it.

## 2. Problem

A plan often has one phase that sets a pattern, such as a record shape, a wording, an error policy or a test style, and later phases that repeat it. Today a person first sees that pattern at the final review. By then it has been copied N times, and they correct it N times. Worse, every later phase read a handoff that described the uncorrected pattern as the one to follow.

A run has no sanctioned place for a person to correct the pattern once, right after the phase that sets it. Stopping a run by hand (interrupt it, edit the worktree, resume) is unsupported. The edits land in the next phase's commit and read as unplanned deviations, no handoff tells the later phases what changed, and nothing turns the correction into a gate that holds them to it.

The first draft of this spec let the person start an optional seeded interactive session. phax could not learn that session's id on codex or vibe, so it could not reuse the session to write the closing handoff and could not capture its transcript. The design worked fully for one provider out of three.

## 3. Product goal

A planner can declare a phase interactive in the plan. When the run reaches that phase, phax sets up its worktree and writes a seed: what to review, the executed phases' handoffs and the upcoming phases' intent. It then runs one headless first turn of the phase's provider, which reads the seed, changes nothing and reports the pattern at stake. phax records that session's id, prints the first reading and the provider's own command to continue the session interactively, stops in `awaiting_review` and exits.

The person corrects the pattern in the worktree, by hand, in the continued session or with any other agent CLI. Where they can, they turn each correction into a guard. `phax resume` runs the gate on the corrected worktree. It gets the interactive handoff by resuming the recorded session headless, or from a fresh session when there is none. It captures the session's transcript into the run folder, commits the phase as the person's and continues. Every later phase reads that handoff, and the gates hold them to its guards.

The plan itself is never rewritten. This is the one sanctioned exception to autonomous runs. It works on every provider phax drives, and every input and output of the stop is a file or a phax command, so a separate review screen can read and write the same files later.

> A run stops for a person only where its approved plan says so; phax gates, commits and hands off the worktree's diff whatever made it, and every input and output of the stop is a file or a phax command.

## 4. Terminology

- **Mode** — A phase's required `mode` field. Its value is exactly `headless` (an agent session executes the phase, as today) or `interactive` (a person reviews and corrects; the run starts no work session for it).
- **Interactive phase** — A phase whose mode is `interactive`. Like any phase, it has its own id, branch, worktree, gate, commit and handoff, and builds on the previous phase. It plans no file to create or edit. Its Detailed instructions say what to review, which pattern is at stake and which later phases repeat it.
- **Headless phase** — A phase whose mode is `headless`. Every phase that exists today is one.
- **Pattern** — A choice an executed phase made that later phases are planned to repeat, such as a record shape, a wording, an error policy or a test style.
- **Seed** — The file phax writes when a run reaches an interactive phase: `.phax-context/interactive-review.md` in the worktree, with an identical copy, `review-seed.md`, in the phase's run folder. It is never committed.
- **First turn** — The one headless turn phax runs at the stop: a new session of the phase's provider, model and effort in the worktree, never a resume of an earlier phase's session. It reads the seed and answers a first-reading document. It must not change the worktree.
- **First reading** — The first turn's answer, a versioned `first-reading` document that names the pattern at stake and what each upcoming phase will copy. phax prints it and writes it, rendered, to `first-reading.md` in the phase's run folder.
- **Recorded session** — A session phax started for the interactive phase, by the first turn at the stop or by `phax enter-phase --new-session`, and recorded in `interactive-session.json` with its provider, model, effort, id and start time. The most recent one is the current session.
- **Interactive resume support** — Whether a provider's own CLI is verified to continue a headless-started session in its interactive UI. The value is exactly `verified` (claude-code, codex) or `unverified` (mistral-vibe).
- **Continue command** — The provider's own command that continues the current session interactively in the worktree: `claude --resume <id>` or `codex resume <id>`, with the phase's model, effort and posture flags. phax prints it only for a provider whose interactive resume support is `verified`.
- **Fresh-start command** — The provider's own command that starts a new interactive session in the worktree, with the phase's model and posture flags and an initial prompt pointing at the seed. phax prints it when there is no current session, or when the provider's interactive resume support is `unverified`. phax never learns that session's id.
- **Person** — Whoever works in the interactive phase's worktree. phax knows them only by the git identity of the checkout that closes the phase.
- **Correction** — A change in the interactive phase's worktree since the previous phase's commit, made by hand or by any agent. Every file the phase changes is a correction.
- **Guard** — A test, lint rule or gate step that fails when a correction is undone or ignored, so that the gates hold the later phases to it.
- **Interactive handoff** — The interactive phase's handoff, with the sections `## What was corrected`, `## The pattern to follow from now on`, `## Guards` and `## What the next phases need to know`.
- **Closing turn** — The headless turn that writes the interactive handoff at closing. It resumes the current session when there is one and is a new session otherwise. Its answer is a versioned `interactive-handoff` document, and it must not change the worktree.
- **awaiting_review** — The run state and phase state of a run stopped at an interactive phase. It is resumable and not a failure, and it is distinct from the run's final `review_open`.
- **Closing** — What `phax resume` does to a run in `awaiting_review`. It runs the gate, gets the interactive handoff, captures the transcripts, commits the phase and continues the run.
- **Outcome** — How an interactive phase closed: `corrected` when the worktree changed, `unchanged` when the person reviewed and changed nothing.
- **Interactive transcript** — The provider's own record of a recorded session, copied at closing to `interactive-transcripts/<session id>.jsonl` in the phase's run folder.

## 5. Functional requirements

### 5.1 The per-phase mode

The system SHALL carry a required `mode` field on every phase of `phax-plan.json` and of the plan document, with a value of exactly `headless` or `interactive`. It SHALL reject a phase that lacks the field or holds any other value.

### 5.2 Reading the mode from plan.md

WHEN phax parses or extracts a plan.md THE system SHALL give `mode: "interactive"` to each phase whose header paragraph carries the `**Mode:** interactive` line, and `mode: "headless"` to every other phase.

### 5.3 Rendering the mode

WHEN phax renders a plan document to plan.md THE system SHALL write the `**Mode:** interactive` line in the header paragraph of each interactive phase, and no Mode line on a headless phase.

### 5.4 Lint: where an interactive phase may sit

IF an interactive phase is the plan's first phase or its last phase, or directly follows another interactive phase, THEN `phax plans lint` SHALL report an error on the `interactive` check, naming the phase and the rule it breaks.

### 5.5 Lint: an interactive phase plans no work

IF an interactive phase lists a planned file to create or to edit THEN `phax plans lint` SHALL report an error on the `interactive` check, naming the phase and the file.

### 5.6 Lint: not inside an oracle pair

IF an interactive phase sits strictly between an oracle phase and the phase that discharges it THEN `phax plans lint` SHALL report an error on the `interactive` check, naming the interactive phase and the oracle phase.

### 5.7 Run, resume and validate refuse an ill-placed interactive phase

IF `phax run`, `phax resume` or `phax validate --plan` is given a plan in which an `interactive` lint rule reports an error THEN it SHALL refuse with exit 2, naming the first such error, before any phase starts and without changing an existing run's state.

### 5.8 The planning skill

The phax-planning skill SHALL state when to declare an interactive phase: directly after the first phase that sets a pattern at least one later phase repeats, and never by default. It SHALL give the Mode line, and SHALL say that the phase's Detailed instructions name what to review, the pattern at stake and the later phases that repeat it.

### 5.9 Reaching an interactive phase

WHEN a run reaches an interactive phase THE system SHALL create its worktree on its own phase branch, off the previous phase's branch, and run the project's phase setup commands. It SHALL run no work session, no gate and no fix loop for the phase.

### 5.10 The seed

WHEN an interactive phase's worktree is set up THE system SHALL write the seed to `.phax-context/interactive-review.md` in the worktree and to `review-seed.md` in the phase's run folder. The seed SHALL hold what is expected of the person (correct the pattern, add guards, keep the scope), the phase's own Detailed instructions, every executed phase's handoff in plan order, the upcoming phases' plan sections, the path of the full plan, the gate commands and the closing command.

### 5.11 The seed is never committed

The system SHALL never include the seed, `first-reading.md`, `interactive-session.json` or an interactive transcript in any commit of the run's branches.

### 5.12 The first turn

WHEN the seed is written THE system SHALL run the first turn: a new headless session of the phase's provider, model and effort in the worktree, never a resume of an earlier phase's session. The turn's prompt SHALL ask it to read the seed and answer a versioned `first-reading` document.

### 5.13 The first turn is recorded

WHEN the first turn returns a valid first-reading document THE system SHALL record the session's provider, model, effort, session id and start time as the current session in `interactive-session.json` in the phase's run folder. It SHALL write the rendered first reading to `first-reading.md` beside that file.

### 5.14 phax's turns run read-only where they can

The system SHALL run every first turn and every closing turn under the phase's security posture, narrowed to the provider's read-only mode wherever phax has one for that provider: Claude Code's read-only tool set and codex's read-only sandbox.

### 5.15 A first turn that edits is refused

IF the worktree's tracked files, or its untracked files that are not ignored, differ after a first turn from before it, THEN the system SHALL restore them to their state before the turn, record no session for that turn, and treat the turn as a failed first turn, naming the changed files.

### 5.16 A failed first turn still stops

IF the first turn fails, through a rate or usage limit, a provider error, or an answer that is still not a valid first-reading document after one corrective resume, THEN the system SHALL still stop at the interactive phase, with no current session. It SHALL name the failure and print the fresh-start command in place of a continue command.

### 5.17 Awaiting review

WHEN the first turn has ended, whether or not it succeeded, THE system SHALL move the phase and the run to `awaiting_review`, write `resume-instructions.md` for that kind, and release the run lock. It SHALL print the first reading when there is one, the worktree path, the seed path, the continue or fresh-start command, `phax enter-phase` and the closing command, and then exit 13.

### 5.18 No terminal, no wait

WHILE phax runs without a terminal THE system SHALL stop at an interactive phase exactly as it does with one, and SHALL never read stdin or wait for input there.

### 5.19 The only planned stop

The system SHALL stop a run to wait for a person only at a phase whose `mode` is `interactive`.

### 5.20 Interactive resume support per provider

The system SHALL hold each provider's interactive resume support as exactly `verified` or `unverified`: `verified` for claude-code and codex, and `unverified` for mistral-vibe.

### 5.21 The continue command

WHERE the current session's provider has `verified` interactive resume support THE system SHALL print as the continue command that provider's interactive resume of the current session in the worktree (`claude --resume <id>` or `codex resume <id>`). The command SHALL carry the phase's model and effort and the filesystem and network flags of the phase's security posture.

### 5.22 A provider whose interactive resume is unverified

WHERE the phase's provider has `unverified` interactive resume support THE system SHALL print the fresh-start command, warn that a session started with it will not be captured, and keep the current session for the closing turn.

### 5.23 Visible as waiting, not failed

WHEN `phax ls` or `phax session-info` reads a run in `awaiting_review` THE system SHALL show the `awaiting_review` state, the interactive phase and its worktree, distinct from failed and interrupted runs. `phax session-info` SHALL also show the current session, or that there is none. `phax ls --awaiting-review` SHALL list only runs in `awaiting_review`.

### 5.24 The worktree commands target the interactive phase

WHILE a run is in `awaiting_review` THE system SHALL make `phax path`, `phax shell` and `phax open` target the interactive phase's worktree.

### 5.25 enter-phase continues the session phax started

WHEN `phax enter-phase <run> <phase>` targets an interactive phase in `awaiting_review` THE system SHALL run the continue command when there is a current session and its provider has `verified` interactive resume support, and the fresh-start command otherwise.

### 5.26 enter-phase resumes codex sessions

WHEN `phax enter-phase` targets a headless phase whose recorded agent session is a codex session THE system SHALL resume that session interactively with `codex resume <id>` in the phase's worktree, instead of refusing it as unsupported.

### 5.27 --new-session starts another recorded session

WHEN `phax enter-phase <run> <phase> --new-session` targets an interactive phase in `awaiting_review` THE system SHALL run a new first turn as at the stop and make it the current session, keeping the earlier sessions in the history of `interactive-session.json`. It SHALL then run the continue or fresh-start command.

### 5.28 The worktree diff is the work

The system SHALL gate, commit and reconcile an interactive phase by its worktree's changes since the previous phase's commit, whatever made them: an editor, a continued session, or an agent phax did not start.

### 5.29 The phase guard holds

IF `phax resume`, `phax enter-phase` or any other command the phase guard refuses runs inside an interactive phase's worktree THEN the system SHALL refuse it, as for any phase worktree.

### 5.30 Closing runs the gate first

WHEN `phax resume <run>` targets a run in `awaiting_review` THE system SHALL run the interactive phase's gate on its worktree as it stands, before any agent turn.

### 5.31 A red gate returns the phase to the person

IF the gate fails while an interactive phase is closing THEN the system SHALL start no fix attempt and no agent turn, keep the attempt's log, commit nothing, leave the phase and the run in `awaiting_review` and exit 4.

### 5.32 The interactive handoff

The system SHALL accept as an interactive phase's handoff only a document with, in this order, `## What was corrected`, `## The pattern to follow from now on`, `## Guards` and `## What the next phases need to know`. `## Guards` SHALL hold one entry per `## What was corrected` entry, in the same order, each naming a test, lint rule or gate step, or `no guard:` followed by the reason.

### 5.33 A handoff the person wrote takes precedence

WHERE the person wrote `.phax-context/phase-handoff.md` in the interactive phase's worktree THE system SHALL validate that file as the interactive handoff and use it, running no closing turn.

### 5.34 The closing turn resumes the current session

WHEN the gate passes on a changed worktree, the person wrote no handoff, and there is a current session, THE system SHALL run the closing turn as a headless resume of that session, given the diff of the corrections. It SHALL ask for a versioned `interactive-handoff` document and render it as the interactive handoff.

### 5.35 A closing turn without a usable session

IF there is no current session, or resuming it fails for a reason other than a rate or usage limit, THEN the system SHALL run the closing turn as a new headless session of the phase's provider, model and effort, given the seed and the diff of the corrections.

### 5.36 A closing turn that edits is refused

IF the worktree differs after the closing turn from the gated worktree THEN the system SHALL commit nothing, leave the changes in place, keep the phase and the run in `awaiting_review`, name the changed files and exit 5.

### 5.37 An invalid handoff commits nothing

IF the handoff fails validation THEN the system SHALL commit nothing, keep the phase and the run in `awaiting_review` and name what is missing or out of place. It SHALL exit 1 when the handoff is a file the person wrote, and exit 5 when it is a closing turn's answer that is still invalid after one corrective resume.

### 5.38 A limit at closing keeps the stop

IF the closing turn hits a rate or usage limit THEN the system SHALL commit nothing, keep the phase and the run in `awaiting_review`, name the reset time and exit 8.

### 5.39 The transcripts are captured

WHEN an interactive phase closes THE system SHALL copy each of its recorded sessions from the provider's own session store into `interactive-transcripts/<session id>.jsonl` in the phase's run folder. It SHALL do so after the closing turn, whether or not the person ever continued the session.

### 5.40 A missing transcript never blocks closing

IF a recorded session's transcript cannot be found or read THEN the system SHALL record it as missing, with the reason, and go on closing the phase.

### 5.41 The phase commit

WHEN the gate passes and the handoff is valid on a changed worktree THE system SHALL commit the worktree's changes on the phase branch, with the plan's commit subject and body and an `Interactive-Phase: <phase id>` trailer, authored by the checkout's git identity. It SHALL record the phase `committed` with outcome `corrected` and continue with the next phase in the same invocation.

### 5.42 Reviewed without change

WHEN `phax resume` closes an interactive phase whose worktree has no change THE system SHALL run the gate and use the person's handoff, or else a fixed reviewed-without-change handoff, with no closing turn. It SHALL make an empty commit on the phase branch with the plan's subject and the `Interactive-Phase` trailer and record outcome `unchanged`. It SHALL never treat the phase as having produced no changes (exit 9).

### 5.43 Later phases read the corrections

WHEN a phase after an interactive phase is dispatched THE system SHALL put the handoff of every earlier interactive phase, in plan order, in a `## Review corrections` section of its prompt. The section SHALL state that it takes precedence over the earlier phases' handoffs where they disagree, and that the phase's own plan section still binds.

### 5.44 The plan is not rewritten

The system SHALL run the phases after an interactive phase from the plan as it was approved. An interactive phase SHALL change neither the run's `phax-plan.json` nor its plan.md.

### 5.45 Corrections are not deviations

WHEN phax reconciles the files of an interactive phase THE system SHALL report every file the phase changed as a review correction, and none as an unplanned edit.

### 5.46 The compliance review

WHEN the compliance review runs on a run with an interactive phase THE system SHALL present that phase to the reviewer as interactive, with its handoff, so that its corrections are judged against that handoff and not as deviations from the plan.

### 5.47 The review handoff and the PR body

WHEN phax writes `review-handoff.md` or builds the PR body of a run with an interactive phase THE system SHALL show each interactive phase's outcome and committer. `review-handoff.md` SHALL also show its corrections and their guards.

### 5.48 Records

WHEN records are configured and an interactive phase commits THE system SHALL record its mode, its outcome, its committer, its recorded sessions (provider, model and id) or that there were none, and each transcript's sha256 or that it is missing, and never the transcript's content. `phax records explain` on the phase's commit SHALL name them.

### 5.49 The posture is told honestly

The system SHALL record in an interactive phase's security record that the person's work, including a session they continued, ran outside phax's enforcement. It SHALL also record the applied posture of each first turn and closing turn phax ran.

### 5.50 Cost of phax's turns

The system SHALL write a cost-ledger entry for each first turn and each closing turn, holding that turn's own cost rather than its session's cumulative cost. It SHALL write none for the turns of a session the person continued, or for a session phax did not start.

### 5.51 Estimating an interactive phase

WHEN `phax plans estimate` sizes a plan with an interactive phase THE system SHALL name the phase as interactive, size only its first turn and closing turn, and leave the person's work out of the estimate.

### 5.52 Reset at an interactive phase

WHEN `phax reset-phase` targets an interactive phase in `awaiting_review` THE system SHALL ask for confirmation, naming the uncommitted corrections it would discard, and then remove the phase's worktree, its branch and its recorded sessions. A later `phax resume` SHALL set the phase up again, run a new first turn and stop again.

### 5.53 Reset the interactive phase first

IF `phax reset-phase` targets a phase before an interactive phase that is in `awaiting_review` THEN it SHALL refuse, naming the interactive phase to reset first, and change nothing.

### 5.54 adjust-plan waits for the landing

IF `phax adjust-plan --landed <run>` names a run in `awaiting_review` THEN it SHALL refuse, naming the run's state, and start no session.

### 5.55 Archive treats the stop as unfinished

WHEN `phax archive` targets a run in `awaiting_review` THE system SHALL treat it as unfinished: it SHALL refuse without `--force`, naming the state.

### 5.56 Plans without an interactive phase

WHILE a plan declares no interactive phase THE system SHALL extract, lint, run, resume and record it with the same prompts, states, findings and exit codes as before this change, apart from `mode: "headless"` on every phase.

## 6. Surface

### file: plan.md — interactive phase declaration — indicative

before:

    ## phase-03 — Review the export record  {#phase-03-review-export-record}

    **Recommended model:** gpt-5.5-codex
    **Recommended effort:** medium

after:

    ## phase-03 — Review the export record  {#phase-03-review-export-record}

    **Recommended model:** gpt-5.5-codex
    **Recommended effort:** medium
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

    # normative: the line sits only on an interactive phase, in the header paragraph; a phase with no line is headless; an interactive phase plans no file to create or edit. Indicative: the line's spelling.

### file: phax-plan.json — per-phase mode — normative

before:

    { "id": "phase-03", "title": "Review the export record", "model": "gpt-5.5-codex", "effort": "medium",
      "planMarkdownAnchor": "phase-03-review-export-record", "plannedFilesToCreate": [], "plannedFilesToEdit": [],
      "optionalFilesToEdit": ["src/export/invoiceRow.ts"], "commit": { "subject": "fix(export): review corrections to the invoice record", "body": "…" } }

after:

    { "id": "phase-02", …same fields…, "mode": "headless" }
    { "id": "phase-03", …same fields…, "mode": "interactive" }

    # `mode` is required on every phase; any other value, or its absence, is rejected.

### file: plan document (`phax artifact schema plan`) — per-phase mode — normative

before:

    "phases": [{ "id": "phase-03", "model": …, "plannedFilesToCreate": [], …, "expectedHandoff": "…" }]

after:

    "phases": [{ "id": "phase-03", "model": …, "plannedFilesToCreate": [], …, "mode": "interactive", "expectedHandoff": "…" }]

    # Same field and values as phax-plan.json; it renders to the plan.md Mode line and projects to phax-plan.json unchanged.

### cli: phax plans lint — `interactive` check — normative

before:

    docs/plans/2610191200-invoice-export-plan.md: 0 errors, 0 warnings

after:

    $ phax plans lint docs/plans/2610191200-invoice-export-plan.md
    docs/plans/2610191200-invoice-export-plan.md: 4 errors, 0 warnings
    error    interactive    phase-06  an interactive phase cannot be the last phase (the final phase is already kept open)
    error    interactive    phase-04  directly follows interactive phase-03
    error    interactive    phase-03  plans src/export/csv.ts to edit; an interactive phase plans no work
    error    interactive    phase-03  sits between oracle phase-02 and its discharging phase-04
    $? = 1

    # normative: the check name `interactive`, severity error, the phase column, exit 1. Indicative: wording.

### cli: phax run — stopping at an interactive phase — normative

    $ phax run --plan docs/plans/2610191200-invoice-export-plan.md
    ✓ phase-01  Export port              committed  1a2b3c4
    ✓ phase-02  Invoice CSV record       committed  5d6e7f8
    ◐ phase-03  Review the export record — awaiting review (interactive phase)

      First reading (codex gpt-5.5-codex, session 019a2f6e…):
        Pattern at stake: the InvoiceRow column order, the header wording `invoice_no`,
        skip-and-warn on a missing tax id.
        phase-04 and phase-05 copy all three; phase-06 reuses the header wording.

      Worktree:  ~/.phax/worktrees/invoice-export/phase-03
      Seed:      .phax-context/interactive-review.md
      Continue the session phax started:
        cd ~/.phax/worktrees/invoice-export/phase-03 && codex resume 019a2f6e-… -m gpt-5.5-codex -c model_reasoning_effort="medium" -c sandbox_mode="workspace-write" …
        or: phax enter-phase invoice-export phase-03
      Or work by hand or with any agent. Then, from the main checkout:
        phax resume invoice-export
    $? = 13

    # first turn failed (no current session):
      First reading: none — codex stopped: rate limit hit (resets 14:20)
      Start a session:
        cd ~/.phax/worktrees/invoice-export/phase-03 && codex -m gpt-5.5-codex … "Read .phax-context/interactive-review.md, then review phase-03 with me."
    $? = 13

    # normative: state `awaiting_review`, exit 13 whether or not the first turn succeeded, no prompt and no stdin read with or without a terminal, the first reading and a continue or fresh-start command printed. Indicative: layout and wording.

### cli: continue and fresh-start commands per provider — indicative

before:

    $ phax enter-phase invoice-export phase-02     # a codex phase
    codex-cli does not support interactive resume via phax. To resume manually, run: codex exec resume <session-id> from the bound worktree.
    $? = 1

after:

    claude-code (verified):
      cd <worktree> && claude --resume <id> --model claude-sonnet-5-5 --effort medium <phase permission flags>
    codex (verified):
      cd <worktree> && codex resume <id> -m gpt-5.5-codex -c model_reasoning_effort="medium" -c sandbox_mode="workspace-write" -c sandbox_workspace_write.writable_roots=[…] -c sandbox_workspace_write.network_access=false
      (the first open of the worktree asks you to trust the directory, then to review its hooks)
    mistral-vibe (unverified, fresh start; this session's transcript will not be captured):
      cd <worktree> && VIBE_ACTIVE_MODEL=devstral-2 vibe --workdir <worktree> "Read .phax-context/interactive-review.md, then review phase-03 with me."

    # normative: the executable and its resume form (`claude --resume <id>`, `codex resume <id>`); a fresh start for an unverified provider; model, effort and posture flags carried. Indicative: the exact flag spelling and order.

### file: .phax-context/interactive-review.md (the seed; identical copy at <run>/phase-03/review-seed.md) — indicative

    # Interactive review: phase-03 of invoice-export

    The run stopped here because its plan declares this phase interactive. phase-04 and
    phase-05 repeat the pattern phase-02 set: correct it once, here.

    ## What is expected of you
    - Correct the pattern in this worktree: the later phases start from this code.
    - Turn each correction into a guard where you can: a test, a lint rule or a gate step.
    - Keep the scope: correct what was done; do not do the later phases' work.
    - Optional: write .phax-context/phase-handoff.md yourself (sections below);
      otherwise phax writes it when you resume.

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

    # normative: the two locations, the contents listed in the seed requirement, never committed. Indicative: wording and order.

### api: first-reading answer (the first turn's final message) — indicative

    { "$schema": "…/first-reading/<release>.json",
      "pattern": ["InvoiceRow column order", "header wording `invoice_no`", "skip-and-warn on a missing tax id"],
      "copiedBy": [
        { "phase": "phase-04", "what": "all three" },
        { "phase": "phase-05", "what": "all three" },
        { "phase": "phase-06", "what": "the header wording" } ],
      "toCheck": ["Is skipping a row acceptable to the accountant, or must the export fail?"] }

    # normative: a required `$schema`; an answer without one, or of an unknown version, is refused. Indicative: the fields.

### file: <run>/phase-03/interactive-session.json — indicative

    { "$schema": "…/interactive-session/<release>.json",
      "phaseId": "phase-03",
      "interactiveResume": "verified",
      "current": { "provider": "codex", "model": "gpt-5.5-codex", "effort": "medium",
                   "sessionId": "019a2f6e-…", "startedAt": "2026-10-19T09:12:04Z", "origin": "stop" },
      "history": [],
      "firstTurns": [ { "origin": "stop", "outcome": "answered" } ] }

    # `current` is null when the first turn failed; `outcome` is exactly answered | failed | refused-change; `origin` is exactly stop | new-session.

### cli: phax ls / phax session-info on a waiting run — indicative

before:

    $ phax ls
    invoice-export    running        phase-03 (3/6)

after:

    $ phax ls
    invoice-export    awaiting_review   interactive phase-03 (3/6)
    payments-fix      failed            phase-02 (2/4)

    $ phax ls --awaiting-review
    invoice-export    awaiting_review   interactive phase-03 (3/6)

    $ phax session-info invoice-export
    state:     awaiting_review
    phase:     phase-03 (interactive)
    worktree:  ~/.phax/worktrees/invoice-export/phase-03
    seed:      ~/.phax/worktrees/invoice-export/phase-03/.phax-context/interactive-review.md
    session:   codex 019a2f6e-… (continue: phax enter-phase invoice-export phase-03)

    # normative: the state name `awaiting_review` and the flag `--awaiting-review`. Indicative: layout.

### cli: phax enter-phase — normative

before:

    $ phax enter-phase invoice-export phase-02
    # resumes phase-02's recorded session on claude-code; refuses on codex and mistral-vibe

after:

    $ phax enter-phase invoice-export phase-03
    Continuing codex session 019a2f6e-… in ~/.phax/worktrees/invoice-export/phase-03

    $ phax enter-phase invoice-export phase-03 --new-session
    First turn: new codex session 7d0e41b2-… (gpt-5.5-codex, medium) — first reading written
    Continuing codex session 7d0e41b2-… in ~/.phax/worktrees/invoice-export/phase-03

    $ phax enter-phase invoice-export phase-02     # a headless codex phase
    Continuing codex session 018f9c3a-… in ~/.phax/worktrees/invoice-export/phase-02

    # normative: the continue command when a session is current on a verified provider, the fresh-start command otherwise; `--new-session` runs a new first turn; codex phases resume interactively. Indicative: wording.

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

    # normative: a required `$schema`; `guard.kind` is exactly test | lint | gate-step | none, with `ref` for the first three and `reason` for none. Indicative: field names.

### file: the interactive handoff (<run>/phase-03/phase-handoff.md) — indicative

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

    # normative: the four sections in this order; one Guards entry per correction, in the same order, naming a guard or `no guard:` with a reason. The same shape is required of a person-written `.phax-context/phase-handoff.md`. Indicative: the section titles' exact spelling.

### cli: phax resume — closing an interactive phase — normative

before:

    $ phax resume invoice-export
    Resume run "invoice-export" from phase-03? [y/N]

after:

    $ phax resume invoice-export --yes
    phase-03 (interactive): 3 files changed by review
      gate  pnpm typecheck   pass
      gate  pnpm test:unit   pass
      handoff     closing turn: resumed codex session 019a2f6e-…
      transcript  interactive-transcripts/019a2f6e-….jsonl
    ✓ phase-03  Review the export record   committed  9a8b7c6  (corrected)
    ▶ phase-04  Credit-note CSV record …

    $ phax resume invoice-export --yes      # gate red
    phase-03 (interactive): 3 files changed by review
      gate  pnpm test:unit   fail  (~/.phax/runs/invoice-export/phase-03/checks-attempt-01.log)
    ✗ phase-03 stays awaiting review: fix the worktree, then resume again
    $? = 4

    $ phax resume invoice-export --yes      # closing turn edited the worktree
    ✗ phase-03 stays awaiting review: the closing turn changed src/export/labels.ts; review the change, then resume again
    $? = 5

    # normative: gate first; on red no fix attempt, exit 4 and `awaiting_review`; exit 5 when the closing turn edits the worktree; exit 1 (person's handoff) or 5 (closing turn's answer) on an invalid handoff; exit 8 on a limit, still `awaiting_review`; on green commit, then continue. Indicative: layout.

### file: <run>/phase-03/interactive-transcripts/ — normative

    ~/.phax/runs/invoice-export/phase-03/
      review-seed.md
      first-reading.md
      interactive-session.json
      interactive-transcripts/
        019a2f6e-….jsonl      # copied from ~/.codex/sessions/2026/10/19/rollout-…-019a2f6e-….jsonl
      phase-handoff.md

    # normative: one file per recorded session, named by session id, copied at closing, even for a session the person never continued; a missing one is recorded as missing and never blocks closing. Indicative: the other file names.

### file: <run>/phase-03/status.json — normative

before:

    { "phaseId": "phase-03", "phaseIndex": 2, "state": "running", "model": "gpt-5.5-codex", "effort": "medium", … }

after:

    { "phaseId": "phase-03", "phaseIndex": 2, "state": "awaiting_review", "mode": "interactive", … }
    { "phaseId": "phase-03", "phaseIndex": 2, "state": "committed", "mode": "interactive", "outcome": "corrected", … }

    # run-status.json carries "state": "awaiting_review" while stopped. The states and `mode` are normative; the field spelling of `outcome` (corrected | unchanged) is indicative.

### cli: exit code table (`phax --usage`, README) — normative

before:

    12  Artifact lifecycle refusal

after:

    12  Artifact lifecycle refusal
    13  Awaiting review at an interactive phase (resumable)

### file: <run>/review-handoff.md — interactive phases — indicative

    ## Interactive phases

    | Phase    | Outcome   | Committed by | Corrections | Guards         |
    | -------- | --------- | ------------ | ----------- | -------------- |
    | phase-03 | corrected | Ada Example  | 3           | 2 (1 no guard) |

    <phase-03's What was corrected and Guards sections>

    # Omitted when the plan declares no interactive phase.

### file: pr-body.md — phase line — indicative

before:

    - phase-03 Review the export record — committed

after:

    - phase-03 Review the export record — interactive, corrected by Ada Example (2 guards)

### cli: phax records explain — indicative

before:

    phase-03  committed  surfaces: local

after:

    phase-03  committed  surfaces: local
      interactive: corrected by Ada Example
      sessions: codex gpt-5.5-codex 019a2f6e-… (transcript sha256 3f9a…)

### file: cost-ledger.json — interactive phase entries — indicative

    { "phaseId": "phase-03", "kind": "first-turn",   "provider": "codex", "model": "gpt-5.5-codex", … }
    { "phaseId": "phase-03", "kind": "closing-turn", "provider": "codex", "model": "gpt-5.5-codex", … }

    # Each entry holds its own turn's cost, never the session's cumulative cost. No entry for the person's interactive turns.

### internal: later phase prompt — review corrections section — indicative

before:

    ## Previous phase handoff

    <phase-04 handoff>

after:

    ## Previous phase handoff

    <phase-04 handoff>

    ## Review corrections

    A person reviewed and corrected the run at phase-03. Where this section disagrees with an
    earlier phase's handoff, this section wins. Your own plan section still binds.

    ### phase-03
    <phase-03 interactive handoff>

### cli: phax reset-phase on a waiting run — indicative

    $ phax reset-phase invoice-export phase-02
    ✗ Cannot reset "phase-02" of run "invoice-export": interactive phase "phase-03" is awaiting review — reset phase-03 first.
    $? = 1

    $ phax reset-phase invoice-export phase-03
    This discards 3 uncommitted review corrections in ~/.phax/worktrees/invoice-export/phase-03:
      M src/export/invoiceRow.ts
      M tests/export/invoiceRow.test.ts
      A src/export/labels.ts
    Proceed? [y/N]

## 7. Non-goals

- The review screen: a diff viewer, comments, a terminal pane and reading directions. It is a later spec, for a separate desktop app that reads and writes the run folder.
- Comments anchored on lines, and structured replies per comment (a reply file, or the Agent Client Protocol).
- Stopping a run at a phase the plan did not declare interactive: no `phax run` flag, no stop raised by an agent. `phase-decision-requests` stays parked.
- Rewriting the approved plan mid-run, or amending later phases' sections from the interactive phase.
- An agent fix loop at an interactive phase's gate. Only the person, or an agent the person runs, repairs a red gate there.
- Changing today's kept-open final phase, `review_open`, `phax enter`, `phax review-code` or the end-of-run order.
- Lifting `unverified` interactive resume for mistral-vibe. That waits until `vibe --resume <id>` is verified to continue a `vibe -p` session interactively.
- Capturing, costing or recording the content of a session phax did not start, or the person's interactive turns.
- An interactive phase inside an oracle pair. Lint refuses it until a later spec defines which commit the discharge judges after a person's correction.
- A timeout, reminder or notification while a run awaits review. The run waits indefinitely, like every resumable stop.
- Changing `phax report`, which is a telemetry issue reporter and not a status view.
- `phax review-plan` declaring interactive phases in a review plan.
- Network access for the phax CLI, or any Claude Code feature the other providers lack.

## 8. Acceptance criteria

### The mode is extracted

Given a six-phase plan whose phase-03 header carries `**Mode:** interactive`, with no Mode line on any other phase, when `phax run --plan <plan> --dry-run` extracts it, then phax-plan.json gives phase-03 `"mode": "interactive"` and every other phase `"mode": "headless"`. (refs §5.1, §5.2)

### The plan document carries the mode

Given a plan document whose phase-03 has `"mode": "interactive"` and whose other phases have `"mode": "headless"`, plus two variants, one with no `mode` on phase-02 and one with `"mode": "review"`, when the document is rendered and linted, and both variants are decoded against `phax artifact schema plan`, then the rendered plan.md carries the Mode line on phase-03 only, the projected extraction matches the document's mode field on every phase, and both variants are rejected. (refs §5.1, §5.3)

### Lint places interactive phases

Given in turn, a plan whose phase-01 is interactive, a plan whose last phase is interactive, and a plan whose phase-03 and phase-04 are both interactive, when `phax plans lint` runs on each, then each exits 1 with an `error` row on the `interactive` check, naming phase-01, the last phase and phase-04 respectively. (refs §5.4)

### Lint refuses planned work in an interactive phase

Given an interactive phase-03 that lists src/export/csv.ts as a planned file to edit, and the same plan with src/export/csv.ts listed only as optional, when `phax plans lint` runs on each, then the first exits 1 with an `interactive` error naming phase-03 and src/export/csv.ts, and the second reports no `interactive` finding. (refs §5.5)

### Lint refuses an interactive phase inside an oracle pair

Given a plan in which phase-02 is an oracle phase discharged by phase-04 and phase-03 is interactive, and the same plan with the interactive phase moved after phase-04, when `phax plans lint` runs on each, then the first exits 1 with an `interactive` error naming phase-03 and phase-02, and the second reports no `interactive` finding. (refs §5.6)

### Run, resume and validate refuse before any phase

Given a plan whose last phase is interactive, its phax-plan.json, and an interrupted run whose phax-plan.json carries the same defect, when `phax run --plan <plan>`, `phax validate --plan <phax-plan.json>` and `phax resume <run> --yes` run, then each exits 2 naming the `interactive` error; no run, worktree or phase branch is created, and the interrupted run's state and last error are unchanged. (refs §5.7)

### The planning skill says when and how

Given the phax-planning skill as shipped, when its interactive-phase section is read, then it gives the `**Mode:** interactive` line and the rule to declare one directly after the first phase that sets a pattern at least one later phase repeats, and never by default; it also says the Detailed instructions name what to review, the pattern and the later phases that repeat it. (refs §5.8)

### The run stops at the interactive phase after a first turn

Given a six-phase plan whose phase-03 is interactive and routed to a fake codex CLI that records its argv and cwd, reports session id S1 and answers a valid first-reading document, and a setup command that writes a marker file, when `phax run --plan <plan>` runs, then phase-01 and phase-02 commit. phase-03's worktree exists on `<run.branch>--phase-03` at phase-02's commit, with the marker present. The fake is spawned exactly once for phase-03, headless, as a new session in that worktree with the phase's model and effort, and no gate runs. `interactive-session.json` records codex, the model, the effort and S1 as current, and `first-reading.md` holds the rendered answer. The run and phase-03 are `awaiting_review`, `resume-instructions.md` exists and the lock is released. The output holds the first reading, the worktree, the seed, a `codex resume S1` continue command, `phax enter-phase invoice-export phase-03` and `phax resume invoice-export`, and the exit code is 13. (refs §5.9, §5.12, §5.13, §5.17)

### The seed holds what the person needs

Given that stopped run, when the seed files are read, then `.phax-context/interactive-review.md` in the worktree and `review-seed.md` in phase-03's run folder are identical. They contain the expectations, phase-03's Detailed instructions, the handoffs of phase-01 and phase-02 in that order, the plan sections of phase-04 to phase-06, the full plan's path, the gate commands and `phax resume invoice-export`. (refs §5.10)

### The stop's files are never committed

Given the stopped run, after the person edited src/export/invoiceRow.ts, when the phase is closed and phase-03's commit is listed, then the commit contains src/export/invoiceRow.ts and no path under `.phax-context/`, and no commit on any of the run's branches contains `first-reading.md`, `interactive-session.json` or an interactive transcript. (refs §5.11)

### phax's turns run read-only where the provider allows

Given phase-03 routed in turn to a fake claude-code CLI and to a fake codex CLI, each recording its argv, when the run stops at phase-03, and later closes it on a changed worktree, then for claude-code, the first turn and the closing turn each carry Claude's read-only tool set. For codex, both carry `sandbox_mode="read-only"`. Both turns also carry the phase's security posture. (refs §5.14)

### A first turn that edits is refused

Given phase-03 routed to a fake mistral-vibe CLI whose first turn answers a valid first-reading document and also writes src/export/invoiceRow.ts, when the run reaches phase-03, then after the turn, src/export/invoiceRow.ts is back at phase-02's content. `interactive-session.json` has no current session and records the first turn as `refused-change`. The output names src/export/invoiceRow.ts and prints the fresh-start command. The run is `awaiting_review` and the exit code is 13. (refs §5.15)

### A failed first turn still stops

Given in turn, a fake codex first turn that reports a rate limit, one that exits with a provider error, and one that answers twice without `$schema`, when the run reaches phase-03 in each case, then each run is `awaiting_review` with exit 13 and no current session. The output names the failure (the reset time for the rate limit) and prints the fresh-start command and no continue command, and the third case had exactly one corrective resume. (refs §5.16, §5.17)

### No terminal, no wait

Given the same plan run with no TTY and a stdin pipe that is never written to, when the run reaches phase-03, then the process exits 13 with the run `awaiting_review`, having read nothing from stdin. (refs §5.18)

### Only a declared phase stops

Given a plan with no interactive phase, whose phase-02 fake agent ends its handoff with a question to a person, when the run runs, then no phase and no run is ever `awaiting_review`, and the run ends `review_open` with the same exit code as before this change. (refs §5.19)

### The continue command is the provider's own

Given two fresh stops at phase-03 whose first turns succeeded, one on fake claude-code with session C1 and one on fake codex with session X1, when the stop output is read, then the claude-code stop prints `claude --resume C1` and the codex stop prints `codex resume X1`, each to run in phase-03's worktree, each carrying the phase's model, effort and posture flags. (refs §5.21, §5.20)

### An unverified provider gets a fresh start and keeps its session for closing

Given a stop at phase-03 on fake mistral-vibe whose first turn succeeded with session V1, when the stop output is read, and the phase is later closed on a changed worktree with no person-written handoff, then the output prints a fresh-start `vibe` command pointing at the seed, warns that its session will not be captured, and prints no `vibe --resume` command. The closing turn is a headless resume of V1. (refs §5.22, §5.20)

### Waiting is visible and filterable

Given one run in `awaiting_review` at phase-03 with current session X1, one failed run and one interrupted run, when `phax ls`, `phax ls --awaiting-review` and `phax session-info invoice-export` run, then `phax ls` shows `awaiting_review` and phase-03 for the first run only, and the filter lists that run alone. `session-info` prints the state, phase-03, its worktree and X1. (refs §5.23)

### The worktree commands target the interactive phase

Given a run in `awaiting_review` at phase-03, with a fake shell and a fake editor that record their cwd and arguments, when `phax path invoice-export`, `phax shell invoice-export` and `phax open invoice-export` run, then `path` prints phase-03's worktree, the fake shell starts there, and the fake editor receives that path. (refs §5.24)

### enter-phase continues the session phax started, on codex too

Given phase-03 in `awaiting_review` with current codex session X1, a stop whose first turn failed, and a committed headless codex phase-02 whose agent binding holds session X0, with a fake codex recording argv and cwd, when `phax enter-phase invoice-export phase-03` runs on each stop, and `phax enter-phase invoice-export phase-02` runs, then the first spawns `codex resume X1` interactively in phase-03's worktree. The second spawns the fresh-start command. The third spawns `codex resume X0` in phase-02's worktree, and none of them refuses as unsupported. (refs §5.25, §5.26)

### --new-session runs a new first turn

Given phase-03 with current session X1, and a fake codex that reports X2 on its next headless start, when `phax enter-phase invoice-export phase-03 --new-session` runs, then a new headless first turn runs and `first-reading.md` is rewritten. `interactive-session.json` holds X2 as current, with origin `new-session`, and X1 in its history, and `codex resume X2` is spawned interactively. (refs §5.27)

### Who made the edit does not matter

Given two identical stops at phase-03; in one the test writes the corrections directly, in the other a fake continued session writes the same bytes, when each is closed with `phax resume invoice-export --yes` and the same person-written handoff, then the two phase-03 commits have the same tree, and the two file reconciliations are equal. (refs §5.28)

### The phase guard holds inside the worktree

Given a shell whose cwd is phase-03's worktree, with the run `awaiting_review`, when `phax resume invoice-export` and `phax enter-phase invoice-export phase-03` run there, then both are refused with the phase-guard message, and the run stays `awaiting_review`. (refs §5.29)

### Closing gates, resumes the session for the handoff, commits and continues

Given phase-03 in `awaiting_review`, with current codex session X1, a corrected src/export/invoiceRow.ts, a new test and no person-written handoff, when `phax resume invoice-export --yes` runs from the main checkout, then the gate runs before any agent turn. The closing turn is a headless resume of X1 given the corrections diff, its valid `interactive-handoff` answer is rendered to `<run>/phase-03/phase-handoff.md`, and no new session starts. The phase commits on `<run.branch>--phase-03` with the plan's subject and body, an `Interactive-Phase: phase-03` trailer and the checkout's git identity as author. phase-03 is `committed` with outcome `corrected`, and phase-04 starts in the same invocation. (refs §5.30, §5.34, §5.41)

### A closing turn without a usable session starts fresh

Given in turn, phase-03 with no current session, and phase-03 whose current session X1 the fake codex reports as not found on resume, each with a changed worktree and no person-written handoff, when `phax resume invoice-export --yes` runs on each, then each closing turn is a new headless codex session given the seed and the corrections diff, and each phase commits with outcome `corrected`. (refs §5.35)

### A red gate returns the phase to the person

Given phase-03 corrections that break the unit-test gate step, when `phax resume invoice-export --yes` runs, and runs again after the test is fixed, then the first exits 4 with no fix attempt and no agent turn, keeps `checks-attempt-01.log`, commits nothing and leaves the run and phase-03 `awaiting_review`; the second commits phase-03 and continues. (refs §5.31)

### The person's handoff is used as written

Given phase-03 with current session X1 and a `.phax-context/phase-handoff.md` holding the four interactive sections and one Guards entry per correction, when `phax resume invoice-export --yes` runs, then no closing turn runs and `<run>/phase-03/phase-handoff.md` equals the person's file byte for byte. (refs §5.33, §5.32)

### An invalid handoff commits nothing

Given in turn, a person-written handoff without `## Guards`, a person-written handoff with three corrections and two Guards entries, and a fake closing turn that answers twice with no `corrections`, when `phax resume invoice-export --yes` runs on each, then the first two exit 1, naming the missing section or the uncovered correction. The third exits 5 after exactly one corrective resume. None commits, and the run stays `awaiting_review`. (refs §5.32, §5.37)

### A closing turn that edits is refused

Given phase-03 with a green gate, no person-written handoff, and a fake closing turn that answers a valid handoff and also creates src/export/labels.ts, when `phax resume invoice-export --yes` runs, then it exits 5 naming src/export/labels.ts, the file is still in the worktree, nothing is committed and the run stays `awaiting_review`. (refs §5.36)

### A limit at closing keeps the stop

Given phase-03 with a green gate and a fake closing turn that reports a usage limit with a reset time, when `phax resume invoice-export --yes` runs, then it exits 8 naming the reset time, commits nothing, and leaves the run and phase-03 `awaiting_review`. (refs §5.38)

### The transcripts are captured, even of a session never continued

Given a test HOME in which the fake codex keeps sessions X1 (the stop's first turn, never continued) and X2 (from `--new-session`, continued) as rollout files under `.codex/sessions/2026/10/19/`, when phase-03 closes, then `interactive-transcripts/X1.jsonl` and `interactive-transcripts/X2.jsonl` exist in phase-03's run folder, and X2's copy includes the closing turn. (refs §5.39)

### A missing transcript never blocks closing

Given phase-03 with current session X1 whose rollout file was deleted, when `phax resume invoice-export --yes` runs, then phase-03 commits and the run continues, and phase-03's record names X1's transcript as missing with its reason. (refs §5.40)

### Reviewed without change

Given phase-03 in `awaiting_review` with current session X1, no change in its worktree and no person-written handoff, when `phax resume invoice-export --yes` runs, then the gate runs and no closing turn runs. The handoff is the fixed reviewed-without-change text, and an empty commit with the plan's subject and the `Interactive-Phase` trailer lands on `<run.branch>--phase-03`. The outcome is `unchanged`, X1's transcript is copied, the exit code is never 9, and phase-04 starts. (refs §5.42)

### Later phases read the corrections

Given a run whose interactive phase-03 has committed, and a second plan whose phase-03 and phase-05 are both interactive, when the prompts of phase-04 to phase-06 are built, then each prompt carries a `## Review corrections` section with phase-03's handoff verbatim, the precedence sentence and the statement that its own plan section binds. In the second plan, phase-06's section holds phase-03's handoff, then phase-05's. (refs §5.43)

### The plan stays as approved

Given the run before the stop and after phase-03 has committed, when phax-plan.json and the run's plan.md are compared, and phase-04's prompt is built, then both files are byte-identical across the stop, and phase-04's prompt carries its approved plan section unchanged. (refs §5.44)

### Corrections are not deviations

Given a phase-03 that changed src/export/invoiceRow.ts and created tests/export/invoiceRow.test.ts and src/export/labels.ts, when its files are reconciled and the compliance review's prompt is built, then `file-reconciliation.json` lists the three files as review corrections and none as an unplanned edit, and the compliance prompt presents phase-03 as interactive, with its handoff. (refs §5.45, §5.46)

### The review handoff and the PR show the review

Given a run that reaches `review_open` with phase-03 corrected by the git identity Ada Example, when `review-handoff.md` and the PR body are built, then the review handoff lists phase-03 with outcome `corrected`, Ada Example, its corrections and its guards, and the PR body's phase-03 line marks it interactive and corrected by Ada Example. (refs §5.47)

### Records and the security record name the review honestly

Given records configured, and two closed runs, one whose phase-03 recorded session X1 with its transcript and one whose first turn failed, when `phax records explain` is given each run's phase-03 commit, and each phase-03 security record is read, then each names phase-03 as interactive, with its outcome and committer. The first names codex, the model, X1 and the transcript's sha256, and the second names no session. Neither records branch contains transcript content. Both security records state that the person's work ran outside phax's enforcement, and they record the applied posture of every first turn and closing turn that ran. (refs §5.48, §5.49)

### Only phax's turns are costed, each by its own increment

Given a closed run whose phase-03 had a first turn of fake claude-code session C1, which the person continued, then a closing turn resuming C1 whose stream reports a cumulative cost of $1.40 over a turn whose own cost is $0.30, and kept runs with interactive phases, when `cost-ledger.json` is read and `phax plans estimate <plan> --no-probe --json` runs, then the ledger holds exactly one `first-turn` and one `closing-turn` entry for phase-03; the closing-turn entry holds $0.30, not $1.40, and no entry covers the person's turns. The estimate names phase-03 as interactive and sizes only its first and closing turns. (refs §5.50, §5.51)

### Reset at the interactive phase sets it up again

Given phase-03 in `awaiting_review` with three uncommitted corrections and current session X1, when `phax reset-phase invoice-export phase-03` runs and is confirmed, then `phax resume invoice-export --yes` runs, then the confirmation names the three files. The worktree, the branch and the recorded sessions are removed. The resume recreates phase-03 at phase-02's commit, rewrites the seed, runs a new first turn and exits 13. (refs §5.52)

### Reset the interactive phase first

Given phase-03 in `awaiting_review`, when `phax reset-phase invoice-export phase-02 --yes` runs, then it refuses, naming phase-03, and changes no worktree, branch or state. (refs §5.53)

### adjust-plan and archive treat the stop as unfinished

Given a run in `awaiting_review`, when `phax adjust-plan <plan> --landed invoice-export`, `phax archive invoice-export` and `phax archive invoice-export --force` run, then adjust-plan refuses naming `awaiting_review` and starts no session; archive without `--force` refuses, naming the state and the flag; archive with `--force` archives the run. (refs §5.54, §5.55)

### Plans without an interactive phase are unchanged

Given a plan with no Mode line, run once with the binary before this change and once with the binary after it, when `phax plans lint`, `phax run` and `phax records explain` run, then both binaries produce the same lint findings, prompts (with no `## Review corrections` section), states and exit codes, and the new run's phax-plan.json carries `"mode": "headless"` on every phase. (refs §5.56)

## 9. Open questions

### q-mode-line — Does every phase of a plan.md carry a Mode line, or only an interactive one?

- interactive-only — Only an interactive phase carries `**Mode:** interactive`; a phase with no line reads as headless — abandons: A one-to-one match between the JSON field and a plan.md line: a headless phase's mode is read from the absence of the line
- every-phase — Every phase carries `**Mode:** headless` or `**Mode:** interactive` — abandons: Every existing plan.md: each one, Approved ones included, fails the structure check until it is edited and re-approved

Recommendation: interactive-only — It follows the approved oracle-phases precedent. The persisted formats (phax-plan.json and the plan document) stay explicit and required on every phase. plan.md is an authored grammar, not a persisted schema, so reading absence as headless is not a back-compat shim, and existing plans keep linting.

### q-planned-work — May an interactive phase also carry planned work?

- review-only — No planned file to create or edit; optional files may name what the person is expected to touch — abandons: A phase where the person also does work the planner foresaw, such as a guard the planner already knew was needed; that work moves to an ordinary phase before or after
- planned-work-allowed — Planned files are allowed; the person does them along with the review — abandons: The file plan as a contract: reconciliation can no longer tell a correction from planned work, and a person who only reviewed leaves the phase's planned files untouched

Recommendation: review-only — Work the planner can foresee belongs to an agent phase, under the gate and the fix loop. The interactive phase exists for what the planner could not foresee. Keeping it review-only is also what lets every changed file count as a correction rather than a deviation.

### q-person-handoff — Does a handoff file the person wrote take precedence over the closing turn?

- person-first — A valid `.phax-context/phase-handoff.md` is used as written and no closing turn runs — abandons: One writer for every interactive handoff: a person's file meets the same validation but gets no agent's help, and its guard list depends on the person's diligence
- session-always — The closing turn always writes the handoff; a person's file is passed to it as input — abandons: A close with no agent at all: every changed close spends a provider turn, and the person's own words are rewritten by a model before the later phases read them

Recommendation: person-first — The person is the authority on what they corrected. A person who wrote the handoff, or wants no agent involved, should not have their text paraphrased by one. Both paths meet the same validation, so the later phases always read the same shape, and the default close (no file) still costs the person nothing.

### q-new-session — What does `phax enter-phase --new-session` do at an interactive phase?

- new-first-turn — Runs a new headless first turn, records it as the current session, then continues it interactively — abandons: A quick fresh start: each new session spends one headless first turn before the person can type
- print-fresh-start — Only runs the provider's fresh-start command; the closing turn keeps the earlier recorded session — abandons: Capture of the new session: phax never learns its id, so the closing turn resumes a session that missed the person's latest work, and the transcript of that work is lost

Recommendation: new-first-turn — Starting headless is the only provider-agnostic way phax learns a session's id, and the id is what lets the closing turn see the person's work and lets phax capture the transcript. A short read-only turn is a small cost next to losing both. A person who wants an uncaptured session can still start one themselves.

### q-precedence — Is the review-corrections section marked as taking precedence over earlier handoffs?

- over-handoffs — It takes precedence over the earlier phases' handoffs where they disagree; the phase's own plan section still binds — abandons: A neutral prompt: phax tells the agent how to weigh its inputs, and a careless correction handoff can override a sound earlier fact
- no-precedence — It is included as one more handoff, with no marking — abandons: The point of the stop: the earlier handoffs describe the uncorrected pattern, and an agent that weighs them equally may copy that pattern again
- over-plan-too — It also takes precedence over the later phases' plan sections — abandons: The decided rule that the approved plan is not rewritten mid-run: a handoff would amend an approved plan without an approval

Recommendation: over-handoffs — The earlier handoffs were written before the correction, and the correction handoff is the only text that knows about both, so it must win where they conflict. The guards back it, so the gate still checks a careless handoff. The plan stays authoritative because it was approved and the handoff was not.

### q-exit-code — Which exit code does `phax run` (or `phax resume`) return when it stops at an interactive phase?

- new-13 — A new code, 13: awaiting review at an interactive phase (resumable) — abandons: Exit 0 for a stop that is not a failure: a shell with `set -e`, or a loop that treats any non-zero code as a failure, must learn 13
- zero — Exit 0 — abandons: Telling a stop from a finished run by its exit code: a loop such as the steme conductor would read a run waiting for a person as done, and move on to publish or the next plan

Recommendation: new-13 — Exits 8 and 9 already make resumable stops non-zero, so a loop's exit-code handling already has the right shape. A loop that mistakes a waiting run for a finished one makes the costlier error: it publishes work the plan said a person must review first.

### q-unchanged-commit — What does an interactive phase reviewed without change leave on its branch?

- empty-commit — An empty commit with the plan's subject and the `Interactive-Phase` trailer — abandons: A history without empty commits: a review that changed nothing still adds a commit to the PR
- no-commit — No commit; the phase branch points at the previous phase's commit — abandons: The review as evidence: `phax records explain`, `git log` and the PR show no trace that a person reviewed and confirmed the pattern

Recommendation: empty-commit — Confirming a pattern is a review outcome worth recording. The commit is where records, attribution and the PR already look, and one empty commit per declared stop is a small cost.

### q-transcript-records — Does the interactive transcript go into the run's records?

- digest-only — Records carry each recorded session's provider, model, id and the transcript's sha256; the content stays in the run folder — abandons: The proof chain's reasoning: a records reader sees that a session took place and can match a kept copy against its digest, but cannot read the conversation behind the corrections
- full — Records carry the transcript content, under the records transcript setting, like a phase's `output.jsonl` — abandons: The person's privacy: their free-form conversation, including anything they pasted, is committed to `phax/records/v1` and travels wherever the records are pushed
- none — Records carry nothing about the sessions — abandons: Any link from the commit to the session that shaped it: `phax records explain` cannot say whether an agent was involved

Recommendation: digest-only — Agent transcripts are phax's own output, but an interactive transcript is mostly a person's words, so publishing it should be an explicit choice rather than a side effect of a records setting. The digest keeps the proof chain verifiable against the run folder's copy. The handoff already carries what was corrected and why.

### q-count-interactive — Are the person's interactive turns in a recorded session counted in the cost ledger from its transcript?

- never — Never; the ledger counts only the first turn and the closing turn, each by its own increment — abandons: Seeing the review's real spend: a long continued session draws on the subscription window with no ledger trace, and window calibration samples that overlap it read high
- from-transcript — Counted as `interactive-turns` entries computed from the copied transcript, and excluded from estimate calibration — abandons: Ledger entries read only from phax's own versioned streams: costs are parsed from three provider-internal transcript formats that phax does not version, and are priced at whatever model the person switched to mid-session

Recommendation: never — The ledger records what phax ran. The person's continued session is the person's own use of their CLI, like any session outside phax. Parsing unversioned provider transcripts for cost would bring a fragile source into a ledger that `phax plans estimate` relies on. The window calibration already has to tolerate spend outside phax.

## 9b. Arbitrated questions

None.

## 10. Implementation-planning note

Settled:

- The stop is declared only in the plan, by the planner, through a required per-phase `mode` enum (`headless | interactive`) in phax-plan.json and in the plan document. It is the one sanctioned exception to autonomous runs, and `phase-decision-requests` stays parked.
- An interactive phase is a phase of its own: id, branch, worktree, setup, gate, commit and handoff, building on the previous phase. It runs no work session and no fix loop.
- At the stop, phax runs one headless first turn of the phase's provider, model and effort: a new session, read-only where the provider allows, with any edit refused by comparing the worktree before and after the turn. phax records the session's id, prints the first reading and the provider's own continue command, and exits 13 in `awaiting_review`. A failed first turn still stops, with the fresh-start command instead.
- Interactive resume support is an explicit per-provider value: `verified` for claude-code and codex (codex verified on 2026-10-19 with codex-cli 0.153.4), `unverified` for mistral-vibe. For an unverified provider phax prints a fresh-start command, and only that session's transcript is lost. The codex session adapter's interactive resume is lifted for every phase.
- The person works with any editor and any agent CLI. phax gates, commits and reconciles the worktree's diff whatever made it.
- Closing is `phax resume <run>` from the main checkout, and the phase guard still refuses it inside the worktree. The order is gate first, then the handoff (the person's file, else a closing turn resuming the current session, else a fresh session), then transcript capture, then the commit, then the next phase in the same invocation. A red gate, an edit by the closing turn, an invalid handoff or a limit all leave the phase in `awaiting_review` and commit nothing.
- The interactive handoff has its own four sections, with one guard (or `no guard:` and a reason) per correction. Every later phase reads it in a `## Review corrections` prompt section, not only the next phase.
- The approved plan is never rewritten mid-run, and `adjust-plan --landed` refuses a run awaiting review.

Left open:

- The spelling of the plan.md Mode line, the lint and refusal messages, and the run, resume, ls, session-info and enter-phase output (all indicative).
- The exact flags of each continue and fresh-start command, so that they carry the phase's model, effort and filesystem and network posture with the provider's interactive approval left to the person, and how the codex trust and hook prompts are told to the person.
- The seed's exact wording and order, and whether it embeds the full plan or points to the plan file in the worktree.
- The first-reading and interactive-handoff document shapes behind their required `$schema`, and the shape and `$schema` of `interactive-session.json`.
- How the worktree is compared before and after a turn (tracked files plus untracked files that are not ignored, leaving out `.phax-context/`), and how a first turn's edits are restored.
- Where `outcome`, the recorded sessions and the transcript digests live in the persisted phase status and the phase record, under the no-shims rule (required, with explicit variants for headless phases).
- How each provider's session store is located for transcript capture (Claude's project folder, codex's dated rollout file, vibe's session directory), behind a port.
- The text of the reviewed-without-change handoff, and whether the next phase also keeps the interactive handoff in `## Previous phase handoff` or only in `## Review corrections`.

Constraints:

- No back-compat shims in persisted schemas. `mode` is required on every phase of phax-plan.json and the plan document. The plan must say how extraction-cache entries, plan sidecars and in-flight runs written by an older binary are treated.
- Explicit per-variant enums: `mode` is `headless | interactive`, the outcome is `corrected | unchanged`, interactive resume support is `verified | unverified`, the first-turn outcome is `answered | failed | refused-change`, and the guard kind is `test | lint | gate-step | none`. `awaiting_review` is a new run state and a new phase state, never `interrupted` with a free-text reason.
- State transitions go only through `src/domain/state.ts` and the reducer that interprets events against PhaxState. The new transitions are: running → awaiting_review at the stop; awaiting_review → running on closing; back to awaiting_review on a red gate, an editing closing turn, an invalid handoff or a limit; and awaiting_review → archived with --force. A reset follows today's reset-phase rules.
- Every provider answer carries a required `$schema`, and an answer with none, or of an unknown version, is refused.
- Respect the layers. The seed, the worktree comparison verdict, the handoff validation and the prompt section are pure domain or app logic, and every file write, git operation, provider spawn and session-store read goes through its port.
- The phax CLI gains no network access. The first turn and the closing turn are provider sessions spawned through the Backend port, as every phase's are. The continued session is the provider's own CLI, which phax only prints or execs.
- Provider-agnostic: nothing may depend on a Claude Code feature the other providers lack. Learning a session's id comes from the headless turn's stream, never from `--session-id`, and a read-only mode is a narrowing used where it exists, never the only guard.
- The cost ledger takes each resumed turn's own increment, never a session's cumulative cost (Claude Code 2.1.280 and later report cumulative cost on `--resume`).
- The phase guard's classification is unchanged: resume, enter-phase, shell and open stay refused inside a phase worktree.
- Fixtures and examples are made up (the invoice-export run, Ada Example, the session ids), and fake provider CLIs keep their session stores under a test HOME. Tests hold across a release cut: no assertion on the running release's version string or on a `$schema` URL tied to it.
- Update `phax --usage` (run, resume, enter-phase, ls, session-info, path, shell, open, reset-phase, adjust-plan, archive and the exit table), README §Run and §Resume, and the phax-planning skill. Generated docs follow from phax.usage.kdl.

## 11. Docs page

Page: README §Interactive phases (under §Run, after §Resume), plus an interactive-phase section in the phax-planning skill

Reader: A planner who sees that one phase sets a pattern later phases repeat, and the person asked to review that pattern when the run stops

Example: In plan.md, phase-03 carries `**Mode:** interactive` and plans no file, and its Detailed instructions name phase-02's record shape and the phases that copy it. `phax run --plan …` commits phase-01 and phase-02, then runs a short read-only codex turn that reports what phase-04 and phase-05 will copy. It stops with exit 13, printing the worktree, `.phax-context/interactive-review.md` and `codex resume <id>`. The person continues that session (or edits by hand, or uses any agent), fixes the record, adds a test for it, and runs `phax resume invoice-export` from the main checkout. The gate runs, phax resumes the session headless for the handoff (What was corrected, The pattern to follow from now on, Guards, What the next phases need to know), copies the transcript into the run folder and commits phase-03. phase-04 starts with that handoff under `## Review corrections`.
