---
status: Abandoned
date: 2026-10-19
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---
# Interactive phases: a plan-declared stop for a person to correct the pattern

## 1. Context

phax runs a plan's phases in order. Each phase gets its own worktree on `<run.branch>--phase-NN`, branched off the previous phase's branch. A headless agent session does the work, the gate runs, a same-session fix loop repairs a red gate, and phax commits the phase and writes its handoff to `<run>/<phase>/phase-handoff.md`. The next phase's prompt carries the previous phase's handoff alone, in `## Previous phase handoff`. The last phase stays open in `review_open`, and there `phax enter`, `phax shell`, `phax path` and `phax open` target its worktree. `phax enter-phase <run> <phase>` resumes the session a phase recorded.

Runs stay autonomous (2026-10-10). A run stops only on machine-detected causes: a rate or usage limit (exit 8), an exhausted or refused gate (exit 4), a phase with no change (exit 9), a failed commit, cleanup or completion. Each pause writes `resume-instructions.md`. Resuming after an exhausted gate re-runs the gate first, and a green gate commits the phase with no new agent invocation. The parked `phase-decision-requests` spec, which would have let an agent stop mid-phase to ask a person, was dropped from the road.

The phase guard refuses `phax resume`, `enter-phase`, `shell`, `open` and every lifecycle command inside a phase worktree. It recognises the worktree from its `.phax-context/` folder, which is gitignored phax metadata. An agent working there cannot move the run.

Per-phase plan fields are fixed in `phax-plan.json` and in the plan document. The approved `oracle-phases` spec, not yet built, is the precedent for adding one: a field required on every phase, a bold declaration line only on the phases that carry the role, its own lint check, and exit-2 refusals from `run` and `resume`.

The spike of 2026-10-18 stopped an archived seven-phase run after its third phase. It opened a worktree there and seeded an agent with the executed phases' handoffs and the upcoming phases' plan intent. The agent saw that phases 04–07 repeat phase-03's wording, record shape and error policy, and it turned one review comment into a code fix plus a test. All three providers phax drives take an initial prompt as a positional argument.

Ground read:

- `spikes/review-screen/README.md` — The 2026-10-18 spike on the archived run phax.brief-provider, stopped after phase-03 of 7. A worktree at the phase's commit, seeded with the executed phases' handoffs and the upcoming phases' intent, was enough: the agent saw that the later phases copy phase-03's wording, record shape and warn-and-continue policy. It turned a comment into a fix plus a test. claude, codex and vibe all take the initial prompt as a positional argument. Questions it left open: how the phase closes (gates, handoff, commit) and how long the session lives. Its review worktree had no node_modules, so the real stop must run the phase setup.
- `docs/ideas/desktop-app.md` — The review-by-trajectory desktop app. It is the later consumer of the files this stop writes, and it is out of scope here.
- `docs/ideas/decision-queue-and-proof-chain.md` — Review by trajectory and the proof chain: a reviewed correction is evidence the records should carry.
- `docs/ideas/coverage-provider.md` — Reading directions (inside-out, outside-in) for the review screen. Out of scope here.
- `docs/specs/2609281159-oracle-phases.md` — Approved, not built. It is the precedent for a per-phase field: required on every phase in phax-plan.json and the plan document, a bold declaration line only on the phases that carry the role, its own lint check, exit 2 refusals from run and resume, and an interplay rule with reset-phase. This spec mirrors it.
- `docs/specs/2608091526-phase-decision-requests.md` — Approved and parked since 2026-10-10. It had the agent raise a question mid-phase and wait. This spec does not reopen it: the stop is declared by the planner, the agent never raises it, and nothing waits inside a phase session.
- `docs/specs/2609250823-headless-review.md` — Draft. It fixes the end of a run (final commit, run completion, review_open, compliance review, publish), the exit families 0–12 and the short PR body, and it notes that nothing returns a run to running. The interactive phase sits before all of this and does not change it.
- `src/domain/state.ts` — RunState and PhaseState unions plus the hierarchical PhaxState. Its transition functions are deprecated in favour of the reducer in src/domain/reducer.ts, which interprets events against PhaxState. Neither has a state for waiting on a person.
- `src/domain/reducer.ts` — RunResumeRequested from interrupted at gates_exhausted returns the phase to running. src/app/resumeInstructions.ts says why: on resume the gate runs again first, and when it passes the phase commits with no new agent invocation. Closing an interactive phase reuses that motion.
- `src/schemas/phaxPlan.ts` — Per-phase fields: id, title, model, effort, anchor, the three planned-file lists and commit. Decoded with excess properties rejected. There is no mode today.
- `src/schemas/planDocument.ts` — The plan document spreads ExtractedPhaseFields, so a new phase field reaches phax artifact schema plan and the projection to phax-plan.json.
- `src/domain/plan/parsePlanMarkdown.ts` — The deterministic parser reads the bold Recommended model and effort lines from a phase's header paragraph. A Mode line would be read the same way.
- `.claude/skills/phax-planning/SKILL.md` — The per-phase field set and the phase section structure (Detailed instructions, planned files, commit subject and body).
- `src/app/promptGeneration.ts` — A phase prompt carries the preamble, the outline, its own section, and only the previous phase's handoff under '## Previous phase handoff'.
- `src/app/handoffInjection.ts` — Handoffs live at <run>/<phase>/phase-handoff.md. readPreviousHandoff reads only the phase at index i-1, so today a handoff reaches the next phase alone.
- `src/app/handoffGuidance.ts` — The four required handoff sections phax validates: What was delivered, Key decisions and why, Exact locations, What the next phase needs to know.
- `src/domain/security/phaseGuard.ts` — Inside a phase worktree (a linked worktree holding .phax-context/, recognised from the cwd), phax refuses resume, enter-phase, shell, open, run, reset-phase and every artifact transition. It allows path, ls, session-info and the read-only commands.
- `src/app/resume.ts` — Resume picks the first non-terminal phase in plan order and refuses review_open, archived, completed, stopped, created and failed runs, each with its own message.
- `src/app/resumeInstructions.ts` — Every pause writes resume-instructions.md in the run folder, with a body per kind (gates_exhausted, gate_refused, rate limit, commit_failed, cleanup_failed, artifact_completion_failed).
- `src/ports/backend.ts` — The provider-agnostic backend: runAgent, resumeAgentSession, complete and probe (probe is Claude only). The readOnly option is honoured by the Claude provider only.
- `src/schemas/status.ts` — run-status.json and the phase status.json carry the state enums, stoppedReason and lastError.
- `src/cli/commands/runLayers.ts` — The exit table goes 0–12. 8 (rate/usage limit) and 9 (phase produced no changes) are already resumable non-failure codes.
- `phax.usage.kdl` — Two groups of commands. enter, shell, path and open target the final worktree. enter-phase resumes a phase's recorded session, and resume asks for confirmation unless --yes. artifact decide is interactive, then resumes headless for the answer, and is Claude Code only. phax report opens a GitHub issue from telemetry: it is not a status view. The status-like outputs are ls and session-info.

## 2. Problem

A plan often has one phase that sets a pattern, such as a record shape, a wording, an error policy or a test style, and later phases that repeat it. Today a person first sees that pattern at the final review, by which time it has been copied N times, and they correct it N times. Worse, each later phase has read a handoff that described the uncorrected pattern as the one to follow.

There is no sanctioned place in a run for a person to correct the pattern once, right after the phase that sets it. Stopping the run by hand (interrupting it, editing the worktree, resuming) is unsupported. The edits land in the next phase's commit and look like unplanned deviations. No handoff tells the later phases what changed, and nothing turns the correction into a gate that holds them to it. The one designed channel for a person mid-run, decision requests, was dropped because it let an agent decide when to stop.

## 3. Product goal

A planner can declare a phase interactive in the plan. When the run reaches it, phax sets up the phase's worktree and writes a seed file: what to review, the executed phases' handoffs, the upcoming phases' intent. Then it stops in a state that says it is waiting for a person, and exits. The person corrects the pattern in that worktree with any editor and any agent CLI, or with an agent session phax starts for them, fresh and seeded with the phase's provider. Where they can, they turn each correction into a guard. `phax resume` runs the gate on the corrected worktree and records the phase's handoff, which lists the corrections, the pattern to follow from now on and the guard holding each correction. It then commits the phase and continues. Every later phase reads that handoff, and the gates hold them to the guards. The plan itself is never rewritten. This is the one sanctioned exception to autonomous runs. It works with every provider and needs no phax interface beyond files and CLI commands, so a separate review screen can later read and write the same files.

> A run stops for a person only where its approved plan says so, and everything that stop gives or takes is a file or a phax command.

## 4. Terminology

- **Mode** — A phase's required `mode` field: `headless` (an agent session executes it, as today) or `interactive` (a person reviews and corrects; no agent session is run by the run itself).
- **Interactive phase** — A phase whose mode is `interactive`. It has its own id, branch, worktree, commit and handoff, cumulative on the previous phase, like any phase. It plans no file to create or edit. Its Detailed instructions say what to review, which pattern is at stake and which later phases repeat it.
- **Headless phase** — A phase whose mode is `headless`: every phase that exists today.
- **Pattern** — A choice an executed phase made that later phases are planned to repeat: a record shape, a wording, an error policy, a test style.
- **Seed** — The file phax writes when a run reaches an interactive phase: `.phax-context/interactive-review.md` in the worktree, copied as `review-seed.md` in the phase's run folder. It is never committed.
- **Seeded session** — A fresh interactive agent session that `phax enter-phase` starts in an interactive phase's worktree, with the phase's provider, model and effort and the seed as its initial prompt. It is never a resume of an earlier phase's session.
- **Person** — Whoever works in the interactive phase's worktree. phax knows them only by the git identity of the checkout that closes the phase.
- **Correction** — A change the person makes, directly or through an agent, in the interactive phase's worktree. Every file the phase changes is a correction.
- **Guard** — A test, lint rule or gate step that fails when a correction is undone or ignored, so the gates hold the later phases to it.
- **Interactive handoff** — The interactive phase's handoff, with the sections `## What was corrected`, `## The pattern to follow from now on`, `## Guards` and `## What the next phases need to know`.
- **awaiting_review** — The run state and phase state of a run stopped at an interactive phase. It is resumable and is not a failure. It is distinct from the run's final `review_open`.
- **Closing** — What `phax resume` does to a run in `awaiting_review`: it runs the gate, gets the interactive handoff, commits the phase and continues the run.
- **Outcome** — How an interactive phase closed: `corrected` when the worktree changed, `unchanged` when the person reviewed and changed nothing.

## 5. Functional requirements

### 5.1 The per-phase mode

The system SHALL carry a required `mode` field on every phase of `phax-plan.json` and of the plan document, whose value is exactly `headless` or `interactive`, and SHALL reject a phase that lacks it or holds any other value.

### 5.2 Reading the mode from plan.md

WHEN phax parses or extracts a plan.md THE system SHALL give `mode: "interactive"` to each phase whose header paragraph carries the `**Mode:** interactive` line and `mode: "headless"` to every other phase.

### 5.3 Rendering the mode

WHEN phax renders a plan document to plan.md THE system SHALL write the `**Mode:** interactive` line in the header paragraph of each interactive phase and no Mode line on a headless phase.

### 5.4 Lint: where an interactive phase may sit

IF an interactive phase is the plan's first phase, its last phase, or directly follows another interactive phase THEN `phax plans lint` SHALL report an error on the `interactive` check naming that phase and the rule it breaks.

### 5.5 Lint: an interactive phase plans no work

IF an interactive phase lists a planned file to create or to edit THEN `phax plans lint` SHALL report an error on the `interactive` check naming the phase and the file.

### 5.6 Lint: not inside an oracle pair

IF an interactive phase sits strictly between an oracle phase and its discharging phase THEN `phax plans lint` SHALL report an error on the `interactive` check naming the interactive phase and the oracle phase.

### 5.7 Run, resume and validate refuse an ill-placed interactive phase

IF `phax run`, `phax resume` or `phax validate --plan` is given a plan that an `interactive` lint rule reports as an error THEN it SHALL refuse with exit 2, naming the first such error, before any phase starts and without changing an existing run's state.

### 5.8 The planning skill

The phax-planning skill SHALL state when to declare an interactive phase (directly after the first phase that sets a pattern at least one later phase repeats, and never by default), the Mode line, and what its Detailed instructions say: what to review, the pattern at stake and the later phases that repeat it.

### 5.9 Reaching an interactive phase

WHEN a run reaches an interactive phase THE system SHALL create its worktree on its own phase branch off the previous phase's branch and run the project's phase setup commands, and SHALL run no agent session and no gate for it.

### 5.10 The seed

WHEN an interactive phase's worktree is set up THE system SHALL write the seed to `.phax-context/interactive-review.md` in the worktree and to `review-seed.md` in the phase's run folder. The seed SHALL hold what is expected of the person, the phase's own Detailed instructions, every executed phase's handoff in plan order, the upcoming phases' plan sections, the path of the full plan in the worktree, the gate commands and the closing command.

### 5.11 The seed is never committed

The system SHALL never include the seed in any commit.

### 5.12 Awaiting review

WHEN the seed is written THE system SHALL move the phase and the run to `awaiting_review`, write `resume-instructions.md` for that kind, release the run lock, print the worktree path, the seed path and the closing command, and exit 13.

### 5.13 No terminal

WHILE phax runs without a terminal THE system SHALL stop at an interactive phase exactly as with one, and SHALL never read stdin or wait for input there.

### 5.14 The only planned stop

The system SHALL stop a run to wait for a person only at a phase whose `mode` is `interactive`.

### 5.15 Visible as waiting, not failed

WHEN `phax ls` or `phax session-info` reads a run in `awaiting_review` THE system SHALL show the `awaiting_review` state, the interactive phase and its worktree, distinct from failed and interrupted runs, and `phax ls --awaiting-review` SHALL list only such runs.

### 5.16 The worktree commands target the interactive phase

WHILE a run is in `awaiting_review` THE system SHALL make `phax path`, `phax shell` and `phax open` target the interactive phase's worktree.

### 5.17 A fresh, seeded session on request

WHEN `phax enter-phase <run> <phase>` targets an interactive phase in `awaiting_review` that has no recorded seeded session, or is given `--new-session`, THE system SHALL start a new interactive session in its worktree with the phase's provider, model and effort, under the run's security posture, with the seed as its initial prompt.

### 5.18 The seeded session is recorded

WHEN phax starts a seeded session THE system SHALL record its provider, model, effort, start time and, when the provider reports one, its session id in `review-session.json` in the phase's run folder.

### 5.19 Re-entering resumes

WHEN `phax enter-phase` targets an interactive phase whose `review-session.json` holds a session id, without `--new-session`, THE system SHALL resume that session in the worktree.

### 5.20 The worktree diff is the work

The system SHALL gate, commit and reconcile an interactive phase by its worktree's changes since the previous phase's commit, whatever made them: an editor, a seeded session, or an agent phax did not start.

### 5.21 The phase guard holds

IF `phax resume`, `phax enter-phase` or any other command the phase guard refuses runs inside an interactive phase's worktree THEN the system SHALL refuse it as for any phase worktree.

### 5.22 Closing runs the gate first

WHEN `phax resume <run>` targets a run in `awaiting_review` THE system SHALL run the interactive phase's gate on its worktree as it stands, with no agent session before it.

### 5.23 A red gate returns the phase to the person

IF the gate fails while closing an interactive phase THEN the system SHALL start no fix attempt, keep the attempt's log, return the phase and the run to `awaiting_review`, commit nothing and exit 4.

### 5.24 The interactive handoff

The system SHALL accept as an interactive phase's handoff only a document with, in order, `## What was corrected`, `## The pattern to follow from now on`, `## Guards` and `## What the next phases need to know`, where `## Guards` names, for each correction, the test, lint rule or gate step that holds it, or `no guard:` followed by the reason.

### 5.25 A handoff the person wrote

WHERE the person wrote `.phax-context/phase-handoff.md` in the interactive phase's worktree THE system SHALL validate it as the interactive handoff and use it, spawning no session.

### 5.26 A handoff written for the person

WHEN the gate passes on a changed worktree and the person wrote no handoff THE system SHALL run one headless session of the phase's provider and model, given the seed and the diff of the corrections, and SHALL take its final message as the handoff. The session SHALL resume the recorded seeded session when `review-session.json` holds an id, and start a new session otherwise.

### 5.27 An invalid handoff commits nothing

IF the handoff fails validation (a person's file, or a session's answer after one corrective resume) THEN the system SHALL commit nothing, keep the phase and the run in `awaiting_review`, name the missing or misplaced sections, and exit 1 for a person's file or 5 for a session's answer.

### 5.28 The phase commit

WHEN the gate passes and the handoff is valid THE system SHALL commit the worktree's changes on the phase branch with the plan's commit subject and body and an `Interactive-Phase: <phase id>` trailer, authored by the checkout's git identity. It SHALL then record the phase `committed` with outcome `corrected` and continue with the next phase in the same invocation.

### 5.29 Reviewed without change

WHEN `phax resume` closes an interactive phase whose worktree has no change THE system SHALL run the gate and use the person's handoff, or else a fixed reviewed-without-change handoff, without spawning a session. It SHALL make an empty commit on the phase branch with the plan's subject, record outcome `unchanged`, and never treat the phase as having produced no changes (exit 9).

### 5.30 Later phases read the corrections

WHEN a phase after an interactive phase is dispatched THE system SHALL put the handoff of every earlier interactive phase, in plan order, in a `## Review corrections` section of its prompt. The section SHALL state that it takes precedence over the earlier phases' handoffs where they disagree, and that the phase's own plan section still binds.

### 5.31 The plan is not rewritten

The system SHALL run the phases after an interactive phase from the plan as it was approved: an interactive phase changes neither the run's `phax-plan.json` nor its plan.md.

### 5.32 Corrections are not deviations

WHEN phax reconciles the files of an interactive phase THE system SHALL report every file it changed as a review correction and none as an unplanned edit.

### 5.33 The compliance review

WHEN the compliance review runs on a run with an interactive phase THE system SHALL present that phase to the reviewer as interactive, with its handoff, so that its corrections are judged against that handoff and not as deviations from the plan.

### 5.34 The review handoff and the PR body

WHEN phax writes `review-handoff.md` or builds the PR body of a run with an interactive phase THE system SHALL show for each interactive phase its outcome and its committer, and in the review handoff also its corrections and their guards.

### 5.35 Records

WHEN records are configured and an interactive phase commits THE system SHALL record its mode, outcome, committer and seeded session (or that there was none), and `phax records explain` on its commit SHALL name them.

### 5.36 The posture is told honestly

The system SHALL record in an interactive phase's security record that the person's work ran outside phax's enforcement, and the applied posture of the seeded session when phax started one.

### 5.37 Cost

The system SHALL write a cost-ledger entry for the interactive phase's handoff session and none for a seeded session or for a session phax did not start. `phax plans estimate` SHALL name each interactive phase, leave it out of the run total, and never size one into its calibration history.

### 5.38 Reset at an interactive phase

WHEN `phax reset-phase` targets an interactive phase in `awaiting_review` THE system SHALL ask for confirmation naming the uncommitted corrections it would discard, then remove the phase's worktree and branch. A later `phax resume` SHALL set the phase up again and stop again.

### 5.39 Reset the interactive phase first

IF `phax reset-phase` targets a phase before an interactive phase that is in `awaiting_review` THEN it SHALL refuse, naming the interactive phase to reset first, and change nothing.

### 5.40 adjust-plan waits for the landing

IF `phax adjust-plan --landed <run>` names a run in `awaiting_review` THEN it SHALL refuse, naming the run's state, and start no session.

### 5.41 Archive treats the stop as unfinished

WHEN `phax archive` targets a run in `awaiting_review` THE system SHALL treat it as unfinished, refusing without `--force` and naming the state.

### 5.42 Plans without an interactive phase

WHILE a plan declares no interactive phase THE system SHALL extract, lint, run, resume and record it with the same prompts, states, findings and exit codes as before this change, apart from `mode: "headless"` on every phase.

## 6. Surface

### file: plan.md — interactive phase declaration — indicative

before:

    ## phase-03 — Review the export record  {#phase-03-review-export-record}

    **Recommended model:** claude-sonnet-5-5
    **Recommended effort:** medium

after:

    ## phase-03 — Review the export record  {#phase-03-review-export-record}

    **Recommended model:** claude-sonnet-5-5
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

    # normative: the line sits only on an interactive phase, in the header paragraph; no line reads as headless; an interactive phase plans no file to create or edit. Indicative: the line's spelling.

### file: phax-plan.json — per-phase mode — normative

before:

    { "id": "phase-03", "title": "Review the export record", "model": "claude-sonnet-5-5", "effort": "medium",
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

    # Same field and values as phax-plan.json; it renders to the plan.md Mode line and projects unchanged.

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

      Worktree:  ~/.phax/worktrees/invoice-export/phase-03
      Seed:      .phax-context/interactive-review.md
      Agent (optional):  phax enter-phase invoice-export phase-03
      When done, from the main checkout:  phax resume invoice-export
    $? = 13

    # normative: state `awaiting_review`, exit 13, no prompt and no stdin read with or without a terminal. Indicative: layout and wording.

### file: .phax-context/interactive-review.md (the seed; also <run>/phase-03/review-seed.md) — indicative

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

    # normative: the two locations, the listed contents (r-seed), never committed. Indicative: wording and order.

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
    session:   none (phax enter-phase invoice-export phase-03)

    # normative: the state name `awaiting_review` and the flag `--awaiting-review`. Indicative: layout.

### cli: phax enter-phase on an interactive phase — normative

before:

    $ phax enter-phase invoice-export phase-02
    # resumes phase-02's recorded session

after:

    $ phax enter-phase invoice-export phase-03
    Starting a new seeded codex session (gpt-5.5-codex, medium) in ~/.phax/worktrees/invoice-export/phase-03

    $ phax enter-phase invoice-export phase-03
    Resuming the seeded session 9f1c… in ~/.phax/worktrees/invoice-export/phase-03

    $ phax enter-phase invoice-export phase-03 --new-session
    Starting a new seeded codex session (gpt-5.5-codex, medium) in ~/.phax/worktrees/invoice-export/phase-03

    # normative: a fresh seeded session with the phase's provider, model and effort when none is recorded; resume of the recorded one otherwise; `--new-session`. Indicative: wording.

### file: <run>/phase-03/review-session.json — indicative

    { "$schema": "…/review-session/<release>.json",
      "provider": "codex", "model": "gpt-5.5-codex", "effort": "medium",
      "startedAt": "2026-10-19T09:12:04Z", "sessionId": "9f1c2d3e-…" }

    # sessionId is null when the provider reports none at start; then the handoff session starts fresh.

### file: the interactive handoff (<run>/phase-03/phase-handoff.md) — indicative

before:

    ## What was delivered
    ## Key decisions and why
    ## Exact locations (file paths and exported names)
    ## What the next phase needs to know

after:

    ## What was corrected
    - The header row reads `Invoice number`, not `invoice_no`.
    - A missing tax id now fails the export instead of skipping the row.

    ## The pattern to follow from now on
    - Header labels are sentence case words, taken from `EXPORT_LABELS`.
    - A missing required field fails the export with the row number; nothing is skipped.

    ## Guards
    - Header wording: tests/export/invoiceRow.test.ts › "header uses EXPORT_LABELS"
    - Fail on missing field: tests/export/invoiceRow.test.ts › "missing tax id fails with row number"
    - Column order: no guard: the order is the accountant's, stated in the plan, not checkable here

    ## What the next phases need to know
    - phase-04 and phase-05 reuse `EXPORT_LABELS`; add their labels there.

    # normative: the four sections in this order, and one Guards entry per correction naming a guard or `no guard:` with a reason. Indicative: the section titles' exact spelling.

### cli: phax resume — closing an interactive phase — normative

before:

    $ phax resume invoice-export
    Resume run "invoice-export" from phase-03? [y/N]

after:

    $ phax resume invoice-export --yes
    phase-03 (interactive): 3 files changed by review
      gate  pnpm typecheck   pass
      gate  pnpm test:unit   pass
      handoff  written by a headless codex session (resumed 9f1c…)
    ✓ phase-03  Review the export record   committed  9a8b7c6  (corrected)
    ▶ phase-04  Credit-note CSV record …

    $ phax resume invoice-export --yes      # gate red
    phase-03 (interactive): 3 files changed by review
      gate  pnpm test:unit   fail  (~/.phax/runs/invoice-export/phase-03/checks-attempt-01.log)
    ✗ phase-03 stays awaiting review: fix the worktree, then resume again
    $? = 4

    # normative: gate first, no fix attempt, exit 4 and `awaiting_review` on red; exit 1 (person's handoff) or 5 (session's answer) on an invalid handoff; commit then continue on green. Indicative: layout.

### file: <run>/phase-03/status.json — normative

before:

    { "phaseId": "phase-03", "phaseIndex": 2, "state": "running", "model": "claude-sonnet-5-5", "effort": "medium", … }

after:

    { "phaseId": "phase-03", "phaseIndex": 2, "state": "awaiting_review", "mode": "interactive", … }
    { "phaseId": "phase-03", "phaseIndex": 2, "state": "committed", "mode": "interactive", "outcome": "corrected", … }

    # run-status.json carries "state": "awaiting_review" while stopped. Field spelling of `outcome` (corrected | unchanged) indicative; the states and the mode are normative.

### cli: exit code table (`phax --usage`, README) — normative

before:

    12  Artifact lifecycle refusal

after:

    12  Artifact lifecycle refusal
    13  Awaiting review at an interactive phase (resumable)

### file: <run>/review-handoff.md — interactive phases — indicative

    ## Interactive phases

    | Phase    | Outcome   | Committed by | Corrections | Guards |
    | -------- | --------- | ------------ | ----------- | ------ |
    | phase-03 | corrected | Ada Example  | 2           | 2 (1 no guard) |

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
      interactive: corrected by Ada Example — seeded session codex gpt-5.5-codex 9f1c…

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

- The review screen: a diff viewer, comments, a terminal pane and reading directions. It is a later spec, for a separate desktop app reading and writing the run folder.
- Comments anchored on lines and structured replies per comment (a reply file, or the Agent Client Protocol).
- Stopping a run at a phase the plan did not declare interactive: no `phax run` flag, no agent-raised stop. `phase-decision-requests` stays parked.
- Rewriting the approved plan mid-run, or amending later phases' sections from the interactive phase.
- An agent fix loop at an interactive phase's gate. Only the person, or an agent the person started, repairs a red gate there.
- Changing today's kept-open final phase, `review_open`, `phax enter`, or the end-of-run order.
- An interactive phase inside an oracle pair. Lint refuses it until a later spec defines which commit the discharge judges after a person's correction.
- Counting the person's time, or a seeded or self-started interactive session, in the cost ledger or in `phax plans estimate`.
- A timeout, reminder or notification while a run awaits review. It waits indefinitely, like every resumable stop.
- Network access for the phax CLI, or any Claude Code feature the other providers lack.

## 8. Acceptance criteria

### The mode is extracted

Given a six-phase plan whose phase-03 header carries `**Mode:** interactive` and no other phase carries a Mode line, when `phax run --plan <plan> --dry-run` extracts it, then phax-plan.json gives phase-03 `"mode": "interactive"` and every other phase `"mode": "headless"`. (refs §5.1, §5.2)

### The plan document carries the mode

Given a plan document whose phase-03 has `"mode": "interactive"` and whose other phases have `"mode": "headless"`, when it is rendered and then linted, and two variants are decoded against `phax artifact schema plan`: one missing `mode` on phase-02, and one with `"mode": "review"`, then the rendered plan.md carries the Mode line on phase-03 only, the projected extraction equals the document's mode field phase by phase, and both variants are rejected. (refs §5.1, §5.3)

### Lint places interactive phases

Given in turn, a plan whose phase-01 is interactive, one whose last phase is interactive, and one whose phase-03 and phase-04 are both interactive, when `phax plans lint` runs on each, then each exits 1 with an `error` row on the `interactive` check naming, respectively, phase-01, the last phase and phase-04. (refs §5.4)

### Lint refuses planned work in an interactive phase

Given an interactive phase-03 that lists src/export/csv.ts as a planned file to edit, and the same plan with src/export/csv.ts listed only as optional, when `phax plans lint` runs on each, then the first exits 1 with an `interactive` error naming phase-03 and src/export/csv.ts, and the second reports no `interactive` finding. (refs §5.5)

### Lint refuses an interactive phase inside an oracle pair

Given a plan where phase-02 is an oracle phase discharged by phase-04 and phase-03 is interactive, and the same plan with the interactive phase moved after phase-04, when `phax plans lint` runs on each, then the first exits 1 with an `interactive` error naming phase-03 and phase-02, and the second reports no `interactive` finding. (refs §5.6)

### Run, resume and validate refuse before any phase

Given a plan whose last phase is interactive, its phax-plan.json, and an interrupted run whose phax-plan.json carries the same defect, when `phax run --plan <plan>`, `phax validate --plan <phax-plan.json>` and `phax resume <run> --yes` run, then each exits 2 naming the `interactive` error; no run, worktree or phase branch is created, and the interrupted run's state and last error are unchanged. (refs §5.7)

### The planning skill says when and how

Given the phax-planning skill as shipped, when its interactive-phase section is read, then it gives the `**Mode:** interactive` line and the rule to declare one directly after the first phase that sets a pattern at least one later phase repeats and never by default, and it says the Detailed instructions name what to review, the pattern and the later phases that repeat it. (refs §5.8)

### The run stops at the interactive phase

Given a six-phase plan whose phase-03 is interactive, run with fake agents and a setup command that writes a marker file, when `phax run --plan <plan>` runs, then phase-01 and phase-02 commit. phase-03's worktree exists on `<run.branch>--phase-03` at phase-02's commit with the marker present. No agent is invoked and no gate runs for phase-03. The run and phase-03 are `awaiting_review`, `resume-instructions.md` exists and the lock is released. The output names the worktree, the seed and `phax resume invoice-export`, and the exit code is 13. (refs §5.9, §5.12)

### The seed holds what the person needs

Given that stopped run, when the seed files are read, then `.phax-context/interactive-review.md` in the worktree and `review-seed.md` in phase-03's run folder are identical and contain the expectations, phase-03's Detailed instructions, the handoffs of phase-01 and phase-02 in that order, the plan sections of phase-04 to phase-06, the full plan's path, the gate commands and `phax resume invoice-export`. (refs §5.10)

### The seed is never committed

Given the stopped run after the person edited src/export/invoiceRow.ts, when the phase is closed and phase-03's commit is listed, then the commit contains src/export/invoiceRow.ts and no path under `.phax-context/`. (refs §5.11)

### No terminal, no wait

Given the same plan run with no TTY and a stdin pipe that is never written to, when the run reaches phase-03, then the process exits 13 with the run `awaiting_review`, having read nothing from stdin. (refs §5.13)

### Only a declared phase stops

Given a plan with no interactive phase, whose phase-02 fake agent ends its handoff with a question to a person, when the run runs, then no phase and no run state is ever `awaiting_review`, and the run ends `review_open` with the same exit code as before this change. (refs §5.14)

### Waiting is visible and filterable

Given one run in `awaiting_review` at phase-03, one failed run and one interrupted run, when `phax ls`, `phax ls --awaiting-review` and `phax session-info invoice-export` run, then `phax ls` shows `awaiting_review` and phase-03 for the first run only, the filter lists that run alone, and `session-info` prints the state, phase-03 and its worktree. (refs §5.15)

### The worktree commands target the interactive phase

Given a run in `awaiting_review` at phase-03, with a fake shell and a fake editor that record their cwd and arguments, when `phax path invoice-export`, `phax shell invoice-export` and `phax open invoice-export` run, then `path` prints phase-03's worktree, the fake shell starts there, and the fake editor receives that path. (refs §5.16)

### enter-phase starts a seeded session with the phase's provider

Given phase-03 in `awaiting_review`, routed in turn to fake claude-code, codex and mistral-vibe CLIs that each record argv, cwd and a reported session id, when `phax enter-phase invoice-export phase-03` runs once per provider, each from a fresh stop, then each fake is spawned once, interactively, in phase-03's worktree with the phase's model and effort and the seed as its initial prompt, and `review-session.json` records the provider, model, effort, start time and reported session id. (refs §5.17, §5.18)

### Re-entering resumes, --new-session starts fresh

Given phase-03 with `review-session.json` holding session id S1, and a fake provider that reports S2 on start, when `phax enter-phase invoice-export phase-03` runs, then again with `--new-session`, then the first resumes S1; the second starts a new seeded session and `review-session.json` holds S2. (refs §5.19, §5.17)

### Who made the edit does not matter

Given two identical stops at phase-03, one where the test writes the corrections directly and one where a fake seeded session writes the same bytes, when each is closed with `phax resume invoice-export --yes` and the same person-written handoff, then the two phase-03 commits have the same tree and the two file reconciliations are equal. (refs §5.20)

### The phase guard holds inside the worktree

Given a shell whose cwd is phase-03's worktree, with the run `awaiting_review`, when `phax resume invoice-export` and `phax enter-phase invoice-export phase-03` run there, then both are refused with the phase-guard message and the run stays `awaiting_review`. (refs §5.21)

### Closing gates, writes the handoff, commits and continues

Given phase-03 in `awaiting_review` with a corrected src/export/invoiceRow.ts, a new test, no person-written handoff and no recorded seeded session, when `phax resume invoice-export --yes` runs from the main checkout, then the gate runs before any agent session, one new headless session of the phase's provider and model receives the seed and the corrections diff, and its answer becomes `<run>/phase-03/phase-handoff.md`. The phase commits on `<run.branch>--phase-03` with the plan's subject and body, an `Interactive-Phase: phase-03` trailer and the checkout's git identity as author. phase-03 is `committed` with outcome `corrected`, and phase-04 starts in the same invocation. (refs §5.22, §5.26, §5.28)

### The handoff session resumes the seeded session

Given phase-03 with `review-session.json` holding session id S1 and a changed worktree, with no person-written handoff, when `phax resume invoice-export --yes` runs, then the handoff session is a headless resume of S1 given the seed and the diff, and no new session is started. (refs §5.26)

### A red gate returns the phase to the person

Given phase-03 corrections that break the unit-test gate step, when `phax resume invoice-export --yes` runs, then again after the test is fixed, then the first exits 4 with no fix attempt and no agent session, keeps `checks-attempt-01.log`, commits nothing and leaves the run and phase-03 `awaiting_review`; the second commits phase-03 and continues. (refs §5.23)

### The person's handoff is used as written

Given phase-03 with a `.phax-context/phase-handoff.md` holding the four interactive sections and one Guards entry per correction, when `phax resume invoice-export --yes` runs, then no agent session is spawned and `<run>/phase-03/phase-handoff.md` equals the person's file byte for byte. (refs §5.25, §5.24)

### An invalid handoff commits nothing

Given in turn, a person-written handoff without `## Guards`, one whose Guards section omits a correction, and a fake handoff session that answers twice without `## Guards`, when `phax resume invoice-export --yes` runs on each, then the first two exit 1 naming the missing section or uncovered correction. The third exits 5 after exactly one corrective resume. None commits, and the run stays `awaiting_review`. (refs §5.24, §5.27)

### Reviewed without change

Given phase-03 in `awaiting_review` with no change in its worktree and no person-written handoff, when `phax resume invoice-export --yes` runs, then the gate runs and no agent session is spawned. The handoff is the fixed reviewed-without-change text, an empty commit with the plan's subject lands on `<run.branch>--phase-03`, the outcome is `unchanged`, the exit code is never 9, and phase-04 starts. (refs §5.29)

### Later phases read the corrections

Given a run whose phase-03 is interactive and committed, and a second plan whose phase-03 and phase-05 are both interactive, when the prompts of phase-04 to phase-06 are built, then each prompt carries a `## Review corrections` section with phase-03's handoff verbatim, the precedence sentence and the statement that its own plan section binds. In the second plan, phase-06's section holds phase-03's then phase-05's handoff. (refs §5.30)

### The plan stays as approved

Given the run before the stop and after phase-03 committed, when phax-plan.json and the run's plan.md are compared, and phase-04's prompt is built, then both files are byte-identical across the stop, and phase-04's prompt carries its approved plan section unchanged. (refs §5.31)

### Corrections are not deviations

Given phase-03 changed src/export/invoiceRow.ts and created tests/export/invoiceRow.test.ts and src/export/labels.ts, when its files are reconciled and the compliance review's prompt is built, then `file-reconciliation.json` lists the three files as review corrections and no unplanned edit, and the compliance prompt presents phase-03 as interactive with its handoff. (refs §5.32, §5.33)

### The review handoff and the PR show the review

Given the run reaches `review_open` with phase-03 corrected by the git identity Ada Example, when `review-handoff.md` and the PR body are built, then the review handoff lists phase-03 with outcome `corrected`, Ada Example, its corrections and its guards, and the PR body's phase-03 line marks it interactive and corrected by Ada Example. (refs §5.34)

### Records name the review

Given records configured, and two closed runs: one with a seeded session S1 and one with none, when `phax records explain` is given each run's phase-03 commit, then each names phase-03 as interactive with its outcome and committer, the first naming the seeded session's provider, model and S1, the second naming no seeded session. (refs §5.35)

### The security record is honest

Given the same two closed runs, when phase-03's security record is read in each, then both state that the person's work ran outside phax's enforcement, and the first also records the seeded session's applied posture. (refs §5.36)

### Only the handoff session is costed

Given a closed run with a seeded session and a headless handoff session at phase-03, and kept runs whose interactive phases have no ledger entry of their own, when `cost-ledger.json` is read and `phax plans estimate <plan> --no-probe --json` runs, then the ledger holds one handoff-generation entry for phase-03 and none for the seeded session. The estimate names phase-03 as interactive and not estimated, leaves it out of the run total, and counts no interactive phase among its sized phases. (refs §5.37)

### Reset at the interactive phase sets it up again

Given phase-03 in `awaiting_review` with three uncommitted corrections, when `phax reset-phase invoice-export phase-03` runs and is confirmed, then `phax resume invoice-export --yes`, then the confirmation names the three files, the worktree and branch are removed, and the resume recreates phase-03 at phase-02's commit, rewrites the seed and exits 13. (refs §5.38)

### Reset the interactive phase first

Given phase-03 in `awaiting_review`, when `phax reset-phase invoice-export phase-02 --yes` runs, then it refuses naming phase-03 and changes no worktree, branch or state. (refs §5.39)

### adjust-plan and archive treat the stop as unfinished

Given a run in `awaiting_review`, when `phax adjust-plan <plan> --landed invoice-export`, `phax archive invoice-export` and `phax archive invoice-export --force` run, then adjust-plan refuses naming `awaiting_review` and starts no session, archive without `--force` refuses naming the state and the flag, and archive with `--force` archives the run. (refs §5.40, §5.41)

### Plans without an interactive phase are unchanged

Given a plan with no Mode line, run with the binary before and after this change, when `phax plans lint`, `phax run` and `phax records explain` run, then both produce the same lint findings, prompts (no `## Review corrections` section), states and exit codes, and the new run's phax-plan.json carries `"mode": "headless"` on every phase. (refs §5.42)

## 9. Open questions

### q-mode-line — Does every phase of a plan.md carry a Mode line, or only an interactive one?

- interactive-only — Only an interactive phase carries `**Mode:** interactive`; a phase with no line reads as headless — abandons: A one-to-one match between the JSON field and a plan.md line: a headless phase's mode is read from the line's absence
- every-phase — Every phase carries `**Mode:** headless` or `**Mode:** interactive` — abandons: Every existing plan.md: each one, Approved ones included, fails the structure check until it is edited and re-approved

Recommendation: interactive-only — It follows the approved oracle-phases precedent. The persisted formats (phax-plan.json, the plan document) stay explicit and required on every phase. plan.md is an authored grammar, not a persisted schema, so reading absence as headless is not a back-compat shim, and existing plans keep linting.

### q-planned-work — May an interactive phase also carry planned work?

- review-only — No planned file to create or edit; optional files may name what the person is expected to touch — abandons: A phase where the person also does foreseen work by hand, such as writing a guard the planner already knew was needed. That work goes into an ordinary phase before or after.
- planned-work-allowed — Planned files are allowed; the person does them along with the review — abandons: The file plan as a contract: reconciliation cannot tell a correction from planned work, and a person who only reviewed leaves the phase's planned files untouched

Recommendation: review-only — Work the planner can foresee belongs to an agent phase, under the gate and fix loop. The interactive phase exists for what the planner could not foresee. Keeping it review-only is also what lets every changed file count as a correction rather than a deviation.

### q-handoff-writer — Who writes the interactive phase's handoff?

- file-else-session — The person's `.phax-context/phase-handoff.md` when present; otherwise a headless session of the phase's provider over the seed and the diff, resuming the seeded session when one was recorded — abandons: A single path: two writers to build and test, and a person's file is held to the same sections with no help
- session-only — Always a headless session over the diff and the seeded session — abandons: A close with no agent at all: every close spends a provider session, even when the person knows exactly what to write
- person-only — The person writes it; phax only validates it — abandons: The low-effort close: a person who only edited code must write a structured document before the run continues, and the guard list depends on their diligence

Recommendation: file-else-session — The default close costs the person nothing: the session reads the same diff phax commits, and the seeded session when phax recorded one, as `artifact decide` does after its interactive session. A person who prefers to write the handoff, or wants no agent, is not forced through one. Both paths meet the same validation, so the later phases always read the same shape. It works for every provider, because it uses only runAgent and resumeAgentSession.

### q-precedence — Is the review-corrections section marked as taking precedence over earlier handoffs?

- over-handoffs — Marked as taking precedence over the earlier phases' handoffs where they disagree; the phase's own plan section still binds — abandons: A neutral prompt: phax tells the agent how to weigh its inputs, and a careless correction handoff can override a sound earlier fact
- no-precedence — Included as one more handoff, unmarked — abandons: The point of the stop: the earlier handoffs describe the uncorrected pattern, and an agent that weighs them equally may copy it again
- over-plan-too — Takes precedence over the later phases' plan sections as well — abandons: The decided rule that the approved plan is not rewritten mid-run: a handoff would amend an approved plan without an approval

Recommendation: over-handoffs — The earlier handoffs were written before the correction, and the correction handoff is the only text that knows about both, so it must win where they conflict. The guards back it, so a careless handoff is still checked by the gate. The plan stays authoritative because it was approved and the handoff was not.

### q-exit-code — Which exit code does `phax run` (or `phax resume`) return when it stops at an interactive phase?

- new-13 — A new code, 13: awaiting review at an interactive phase (resumable) — abandons: Exit 0 for a stop that is not a failure: a shell with `set -e`, or a loop that treats any non-zero code as failure, must learn 13
- zero — Exit 0 — abandons: Telling a stop from a finished run by exit code: a loop such as the steme conductor would read a run that waits for a person as done and move on to publish or the next plan

Recommendation: new-13 — 8 and 9 already make resumable stops non-zero, so a loop's exit-code handling already has the right shape. A loop that mistakes a waiting run for a finished one is the costlier error, because it publishes work the plan said a person must review first.

### q-unchanged-commit — What does an interactive phase reviewed without change leave on its branch?

- empty-commit — An empty commit with the plan's subject and the `Interactive-Phase` trailer — abandons: A history without empty commits: a review that changed nothing still adds a commit to the PR
- no-commit — No commit; the phase branch points at the previous phase's commit — abandons: The review as evidence: `phax records explain`, `git log` and the PR show no trace that a person reviewed and confirmed the pattern

Recommendation: empty-commit — Confirming a pattern is a review outcome worth recording. The commit is where records, attribution and the PR already look, and one empty commit per declared stop is a small cost.

## 9b. Arbitrated questions

None.

## 10. Implementation-planning note

Settled:

- The stop is declared only in the plan, by the planner, through a required per-phase `mode` enum (`headless | interactive`) in phax-plan.json and the plan document. It is the one sanctioned exception to autonomous runs, and `phase-decision-requests` stays parked.
- An interactive phase is a phase of its own: id, branch, worktree, setup, gate, commit and handoff, cumulative on the previous phase. It runs no agent session of the run's own and no fix loop.
- The person works with any editor and any agent CLI. `phax enter-phase` optionally starts a fresh seeded session with the phase's provider, model and effort, never a resume of an earlier phase's session. Everything the stop writes or reads is a file in the worktree or the run folder, or a phax command.
- Closing is `phax resume <run>` from the main checkout. The phase guard keeps refusing it inside the worktree, so no agent there can close the phase. The order is gate first, then handoff, then commit, then the next phase in the same invocation, reusing the gates_exhausted re-gate-then-commit motion.
- A red gate at closing returns the phase to `awaiting_review` with exit 4 and no fix attempt.
- The interactive handoff has its own four sections, with a guard (or `no guard:` with a reason) for each correction. Every later phase reads it in a `## Review corrections` prompt section, not only the next phase. Today only the immediately previous handoff reaches a phase.
- The approved plan is never rewritten mid-run. `adjust-plan --landed` refuses a run awaiting review.
- The §9 recommendations: a Mode line only on interactive phases, review-only interactive phases, a person's handoff file or else a headless session, precedence over earlier handoffs but not over the plan, exit 13, and an empty commit when nothing changed.

Left open:

- The spelling of the plan.md Mode line, the lint and refusal messages, and the run, resume, ls and session-info output (all indicative).
- The seed's exact wording and order, and whether the seed embeds the full plan or points to the plan file already written into the worktree.
- How the reviewed-without-change handoff text reads, and whether the immediately next phase also keeps the interactive handoff in `## Previous phase handoff` or only in `## Review corrections`.
- How the headless handoff session is kept from writing to the worktree on providers without a read-only tool set (for example, its answer is taken from its final message and any worktree change it makes is refused), so the gated tree is the committed tree.
- Where the `outcome` and the seeded-session reference live in the persisted phase status and the phase record, under the no-shims rule (required, with explicit variants for headless phases).
- The `$schema` id and shape of `review-session.json`.

Constraints:

- No back-compat shims in persisted schemas: `mode` is required on every phase of phax-plan.json and the plan document. The plan must say how extraction-cache entries, plan sidecars and in-flight runs written by an older binary are treated, as oracle-phases must.
- Explicit per-variant enums: `mode` is exactly `headless | interactive`, the outcome is exactly `corrected | unchanged`, and `awaiting_review` is a new run state and a new phase state, never `interrupted` with a free-text reason.
- State transitions go only through the state discipline: the PhaxState types in src/domain/state.ts and the reducer in src/domain/reducer.ts that superseded its deprecated transition functions. The new transitions are running → awaiting_review, awaiting_review → running on resume, running → awaiting_review on a red closing gate, and awaiting_review → archived with --force.
- Respect the layers: the seed, the handoff validation and the prompt section are pure domain or app logic, and every file write, git operation and provider spawn goes through its port.
- The phax CLI gains no network access. The seeded session and the handoff session are provider sessions spawned through the Backend port, as every phase's are.
- Provider-agnostic: the seeded session uses each adapter's interactive start with an initial prompt (the spike showed claude, codex and vibe all accept one), and the handoff session uses runAgent and resumeAgentSession only. Nothing may depend on Claude Code's read-only tool set, which only the Claude provider honours.
- The phase guard classification is unchanged: resume, enter-phase, shell and open stay refused inside a phase worktree.
- Fixtures and examples are made up (the invoice-export run, Ada Example). Tests hold across a release cut: no assertion on the running release's version string or on a `$schema` URL tied to it.
- Update `phax --usage` (run, resume, enter-phase, ls, path, shell, open, reset-phase, adjust-plan, archive and the exit table), README §Run and §Resume, and the phax-planning skill. Generated docs follow from phax.usage.kdl.

## 11. Docs page

Page: README §Interactive phases (under §Run, after §Resume), plus an interactive-phase section in the phax-planning skill

Reader: A planner who sees that one phase sets a pattern later phases repeat, and the person who is asked to review it when the run stops

Example: In plan.md, phase-03 carries `**Mode:** interactive` and plans no file, and its Detailed instructions name phase-02's record shape and the phases that copy it. `phax run --plan …` commits phase-01 and phase-02, then stops with exit 13 and prints the phase-03 worktree and `.phax-context/interactive-review.md`. The person opens the worktree in their editor and optionally runs `phax enter-phase invoice-export phase-03` for a seeded agent session. They fix the record, add a test for it, and run `phax resume invoice-export` from the main checkout. The gate runs, phax writes the handoff (What was corrected, The pattern to follow from now on, Guards, What the next phases need to know), commits phase-03, and phase-04 starts with that handoff under `## Review corrections`.
