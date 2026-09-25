---
status: Abandoned
date: 2026-09-24
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---
# Review as a plan — headless code review, review-plan, run --append

## 1. Context

`phax review-code <run>` opens an interactive, pre-prompted session in a `review_open` run's final-phase worktree. It resumes the session named in `code-review-session.json` unless `--new-session` is given, and hands the terminal to a developer. It builds its prompt from the global file reconciliation and, when present, `compliance-review.json`. `phax review-compliance <run>` is its non-mutating, structured sibling. An agent writes `compliance-review.md` and `compliance-review.json`, and phax decodes the JSON strictly: `{ version: 1, verdict: conformant | conformant-with-deviations | divergent, summary, perPhase[{ phaseId, verdict, findings[{ dimension, severity: info | deviation | concern, message }] }], attentionPoints, pointers }`. `phax.json` has `review.compliance.{enabled, model, effort}` and only `review.code.{model, effort}`.

Each phase of a run gets its own worktree on `phax/<slug>--phase-NN`, and phases run in sequence. The last phase stays open in `review_open`, where manual fixes land as ordinary commits. The run state machine allows `running → review_open` and `review_open → archived`, but no transition returns a run to `running`. `phax publish-pr` builds the PR body from a fixed header plus the review handoff with the compliance review embedded. The body is capped at 60,000 bytes and truncated from the tail. An existing PR for the branch is reused, not updated.

Headless authoring (0.16.0) set the pattern this spec reuses. A session spawned by phax returns only schema-validated JSON. phax then renders the Markdown deterministically and writes a JSON sidecar. It seeds the extraction cache with the plan projection, so no model re-extracts the plan, and it commits and records. The first consumer is the steme roadmap-1.0 conductor. It drives runs in a loop with no developer at the terminal and allows at most two review passes.

Ground read:

- `docs/ideas/headless-code-review.md` — the idea, revised 2026-09-24: two commands (review-code --headless, review-plan --headless), run --append, review.code.{enabled,append,maxPasses}, per-pass order, no plan on divergent, same PR, PR body opening on the two tables
- `docs/ideas/skills/phax-decide-review.md` — default review doctrine R1–R7 that review-plan loads; severity scale and default treatment; decisions[] for escalations
- `docs/ideas/change-gates-from-the-harness.md` — the oracle-separation lint the review plan must pass once it exists; test-file pairing as the cheap first convention
- `src/schemas/complianceReview.ts` — the structured review shape to mirror: version 1, verdict conformant | conformant-with-deviations | divergent, per-phase findings with severity info | deviation | concern, strict decode
- `src/app/reviewCode.ts` — interactive review-code today: final-phase worktree, code-review-session.json, resume unless --new-session, prompt built from global reconciliation plus compliance-review.json
- `src/app/reviewCompliance.ts` — compliance review: agent writes md + json under .phax-context, phax copies them into the run directory; reads the run's single plan.md
- `src/app/reviewHandoff.ts` — review-handoff.md content: run summary, global reconciliation, attention points, embedded compliance review, phase details
- `src/app/publishRun.ts` — publish-pr: reuses an existing PR for the branch without updating it; builds pr-body.md from the handoff plus compliance review
- `src/domain/publish/body.ts` — PR body = fixed header + handoff, capped at 60,000 bytes, truncated from the tail with a note
- `src/domain/state.ts` — run states; running → review_open and review_open → archived exist, nothing returns a run to running
- `src/app/resolveRunInfo.ts` — phase branches are phax/<slug>--phase-NN; the final phase is the highest-indexed phase folder
- `src/schemas/phaxPlan.ts` — extracted-plan and persisted phax-plan shapes; phase ids phase-NN
- `src/schemas/extractedPlanCacheEntry.ts` — content-addressed extraction cache entry the review plan projection seeds
- `docs/specs/archive/2609230835-headless-authoring.md` — the shipped headless pattern reused here: JSON-only session, plan document, deterministic render, sidecar, cache seed, authoring record, exit families 12/5/8
- `src/schemas/phaxConfig.ts` — review.compliance.{enabled,model,effort} and review.code.{model,effort} today; authoring keys optional at birth
- `phax.usage.kdl` — review-code, review-compliance, publish-pr contracts today
- `NEXT_STEPS.md` — Road to 1.0.0 (additive only) and Spec candidates → three additive specs, item 2 review-as-plan
- `docs/briefs/artifact-decide.md` — sibling spec that ships the phax-decide-* doctrine skills, the decision shape and the machine-vs-human approval distinction this spec relies on

## 2. Problem

A loop has no developer, so it cannot run the only code review phax offers. Two shortcuts both fail. Printing the prompt for an outside agent moves the review out of phax: no run directory, no records, no resumable session, and the findings come back as prose. Resuming the review session with "fix everything" puts changes into the run without going through phases. Those changes get no gate of their own, no handoff and no reconciliation, and the session is free to edit the test that judges it.

Fixes that follow a review must go through the same machinery as the implementation, but a run cannot grow. Once a run is `review_open`, it cannot run another phase. A second run means a second PR and a second records lineage. Nothing bounds or reports the review–fix loop. The PR a human reads first shows diff detail, not whether the run converged or what was deliberately left unfixed. That diff detail is also the part tail truncation removes.

## 3. Product goal

Make the code review a phax artifact and make its consequence a phax plan. A headless review writes structured findings and stops. A separate step turns those findings into a review plan in the phax-plan shape, following a doctrine and a severity threshold that the caller owns. `phax run --append` then executes that plan as more phases of the same run, with the same records and the same PR. A config setting can run this as a bounded loop at the end of a run. The PR then opens on the trajectory: one table of review passes and one table of decisions. Every change is additive to the CLI and to `phax.json`, and the interactive review stays as it is.

> A review changes code only through phases of the same run: findings in, a plan out, gates in between.

## 4. Terminology

- **Pass** — One review round over a run, numbered from 1. A pass is a compliance review (when enabled), a headless code review, and at most one review plan. Its artifacts live under the run directory.
- **Finding** — One entry of `code-review.json`: `id`, `severity` (`bug` | `deviation` | `concern` | `info`), `file`, `line` (a number or null), `message` and `suggestion`. The latest compliance review's `deviation` findings join a pass's findings under ids phax assigns (`C1`, `C2`, …).
- **Severity order** — `bug` > `deviation` > `concern` > `info`.
- **Threshold** — The lowest severity a pass plans: `bug`, `deviation` or `concern`. `info` is never planned.
- **Review doctrine** — The instructions a review-plan session follows: the default `phax-decide-review` doctrine (principles R1–R7), extended by the caller's `--doctrine` file.
- **Review plan** — The plan a review-plan session emits for one pass. It is a plan document in the phax-plan shape whose phases name the finding ids they address, plus a `decisions[]` block and a handoff note. It is rendered as `review-plan.md` with `review-plan.json` beside it.
- **Escalation** — A finding at or above the threshold that is deliberately not planned. It is recorded as a `decisions[]` entry that cites a doctrine principle (R1–R4) and says why.
- **Appended phase** — A phase executed by `phax run --append`. It is numbered after the run's existing phases, runs under the same run id, and has the origin `from review pass N`.
- **Run footprint** — The union of every file that any plan executed by the run declares (to create, to edit, or optional), plus the files the pass's findings name.
- **Oracle file** — A file that judges the code a phase changes: a test, a fixture, or a disposition matrix. Until the oracle-separation lint exists, oracle files are identified as §9 Q5 decides.
- **Fixed / escalated / open** — Counts per pass. Fixed: findings named by a phase of that pass's review plan that reached committed. Escalated: findings named by its `decisions[]`. Open: findings at or above the threshold that are neither.
- **Machine approval** — An approval of a review plan granted by `review.code.append` rather than by an operator, and recorded as such.
- **Recorded decision** — A decision phax holds as structured data: a decided question in a spec sidecar, a technical arbitration in a plan document, or a `decisions[]` entry in a review plan.

## 5. Functional requirements

### 5.1 Headless code review in the run's session

WHERE `--headless` is given to `phax review-code <run>` THE system SHALL run the code review in the run's review session, in the run's final-phase worktree, without attaching a terminal.

### 5.2 Compliance verdict in the review brief

WHEN a compliance review exists for the run THE system SHALL give its verdict and findings to the headless review session.

### 5.3 JSON-only code-review result

WHEN a headless review session ends THE system SHALL accept as its result only a JSON document valid against the code-review document schema.

### 5.4 An invalid review lands nothing

IF the headless review result is not JSON or fails validation THEN the system SHALL fail as a provider error naming the first violation path and write no `code-review.json`.

### 5.5 Write, record, stop

WHEN the code-review document validates THE system SHALL write it as the current pass's `code-review.json` under the run directory and into the run's records, then stop, leaving the review session resumable and the run `review_open`.

### 5.6 Interactive review-code unchanged

The system SHALL leave `phax review-code <run>` without `--headless` unchanged.

### 5.7 Review-plan session continuity

WHEN `phax review-plan <run>` starts THE system SHALL resume the run's review session if its record exists, and otherwise start a new session from the pass's `code-review.json`.

### 5.8 Default review doctrine

The system SHALL load the default review doctrine into every review-plan session.

### 5.9 Project doctrine extends the default

WHERE `--doctrine <file>` is given THE system SHALL append that file to the default review doctrine.

### 5.10 Threshold resolution

The system SHALL plan only findings at or above the threshold, resolved as `--min-severity`, else `review.code.minSeverity`, else `concern`.

### 5.11 Compliance deviations join the findings

The system SHALL add the latest compliance review's `deviation` findings to the findings a review plan considers.

### 5.12 Info and below-threshold findings go to the handoff note

The system SHALL write `info` findings and findings below the threshold to the review plan's handoff note and never to a phase.

### 5.13 JSON-only review plan

WHEN a review-plan session ends THE system SHALL accept as its result only a JSON document valid against the review-plan document schema, whose projection is the extracted-plan schema.

### 5.14 An invalid review plan lands nothing

IF the review-plan result is not JSON or fails validation THEN the system SHALL fail as a provider error naming the first violation path and write nothing.

### 5.15 Every finding is planned or escalated

The system SHALL reject a review-plan document unless exactly one phase or exactly one `decisions[]` entry citing a doctrine principle names each finding at or above the threshold.

### 5.16 Phases continue the run's numbering

The system SHALL number the review plan's phases consecutively after the run's last phase.

### 5.17 Materialisation

WHEN a review-plan document validates THE system SHALL render `review-plan.md` deterministically, write `review-plan.json` beside it, seed the extraction cache with its projection, persist both under the run directory and in the run's records, and record the session.

### 5.18 No plan on a divergent verdict

IF the run's latest compliance verdict is `divergent` THEN `phax review-plan` SHALL spawn no session, emit no plan, record the pass outcome `blocked-divergent`, and exit 1.

### 5.19 Clean pass

WHEN a pass has no finding at or above the threshold THE system SHALL spawn no session, emit no plan, and record the pass outcome `clean`.

### 5.20 Interactive review-plan

WHERE `--headless` is not given to `phax review-plan <run>` THE system SHALL open the same session interactively, then validate and materialise the document it produces exactly as in headless mode.

### 5.21 The append transition

WHEN `phax run --append <run> <plan>` is accepted THE system SHALL transition the run from `review_open` to `running` and execute the plan's phases after the run's existing phases.

### 5.22 Worktree lineage

The system SHALL branch each appended phase's worktree from the tip of the preceding phase's branch. The first appended phase branches from the previously final phase's branch, including commits made during review.

### 5.23 Same run identity and records lineage

The system SHALL run appended phases under the run's id and slug and write their records into the run's records lineage.

### 5.24 Final-phase handover

WHEN an append starts THE system SHALL close the previously final phase the way a non-final phase is closed and make the last appended phase the kept-open final phase.

### 5.25 Appended phases are ordinary phases

The system SHALL execute appended phases with the same lifecycle as original phases: gates, fix loop, rate-limit handling, failure and `phax resume`.

### 5.26 Whole-range regeneration

WHEN the appended phases complete THE system SHALL regenerate the global file reconciliation and `review-handoff.md` over every phase of the run and return the run to `review_open`.

### 5.27 Compliance per originating plan

WHEN a compliance review runs on a run with appended phases THE system SHALL judge each phase against the plan that planned it.

### 5.28 Refuse an unapproved plan

IF the review plan is not Approved THEN `phax run --append` SHALL refuse before any phase starts.

### 5.29 Refuse a run that is not review_open

IF the run is not `review_open` THEN `phax run --append` SHALL refuse before any phase starts.

### 5.30 Refuse a stale or foreign plan

IF the plan is not the review plan of the run's latest pass, or its first phase does not follow the run's last phase, THEN `phax run --append` SHALL refuse before any phase starts.

### 5.31 Refuse files outside the run footprint

IF a phase of the review plan plans a file outside the run footprint THEN `phax run --append` SHALL refuse before any phase starts, naming the phase and the file.

### 5.32 Refuse oracle files

IF a phase of the review plan plans an oracle file THEN `phax run --append` SHALL refuse before any phase starts, naming the phase and the file.

### 5.33 Refuse a published run

IF the run already has a recorded pull request THEN `phax run --append` SHALL refuse before any phase starts.

### 5.34 review.code.enabled runs a pass

WHERE `review.code.enabled` is true THE system SHALL run one review pass when a run reaches `review_open` and leave the run `review_open` with the pass's artifacts.

### 5.35 review.code.append loops

WHERE `review.code.append` is true THE system SHALL approve and append each pass's review plan and then run the next pass, until a pass emits no plan.

### 5.36 The pass bound

IF `review.code.maxPasses` appends have run THEN the system SHALL stop appending and leave the last pass's review plan unappended, with the run `review_open`.

### 5.37 Machine approval recorded as such

The system SHALL record an approval granted by `review.code.append` as a machine approval naming that key, distinct from an operator approval.

### 5.38 Defaults keep today's behavior

The system SHALL default `review.code.enabled` and `review.code.append` to false and `review.code.maxPasses` to 1, so that a `phax.json` without these keys loads and behaves as it does today.

### 5.39 Inconsistent review config rejected

IF `review.code.append` is true while `review.code.enabled` is not, or `review.code.maxPasses` is outside 1–5, THEN config loading SHALL fail naming the key.

### 5.40 Per-pass order

The system SHALL run each pass in this order: the compliance review over the whole run when enabled, then the headless code review, then the review plan.

### 5.41 phax ls reports passes

WHEN `phax ls` lists a run with review passes THE system SHALL show its pass count and its latest pass's outcome and compliance verdict.

### 5.42 artifact status reports a review plan

WHEN `phax artifact status` inspects a review plan THE system SHALL report its run, pass, status, appended phases, and its approval with the approver kind.

### 5.43 The PR body opens on the trajectory

WHEN `phax publish-pr` builds the body for a run with a review pass or a recorded decision THE system SHALL place the review-passes table and then the decisions table before the existing handoff.

### 5.44 Review-passes table content

The system SHALL render one review-passes row per pass, giving its findings by severity, its fixed, escalated and open counts, and its compliance verdict.

### 5.45 Decisions table content

The system SHALL render one decisions row for each recorded decision of the run's source spec, each technical arbitration recorded in its plans, and each review escalation, citing the decision's principles.

### 5.46 Truncation spares the tables

IF the body exceeds the size cap THEN the system SHALL truncate only the handoff part and keep both tables whole.

### 5.47 No trajectory, no change

WHILE a run has no review pass and no recorded decision THE system SHALL build the PR body exactly as it does today.

## 6. Surface

### cli: `phax review-code <run> --headless` — normative

before:

    phax review-code usage-cli [--new-session] [--model <model>] [--effort <effort>]
      (opens an interactive, pre-prompted session; the developer takes over)

after:

    phax review-code usage-cli --headless [--new-session] [--model <model>] [--effort <effort>]

    # output layout indicative; the flag name and exit families are normative
    review-code usage-cli — pass 1 — claude-opus-5-5 / high (headless)
    findings  bug 1 · deviation 1 · concern 1 · info 2
    written   <run-dir>/review/pass-01/code-review.json
    session   resumable (code-review-session.json)
    $? = 0

    Exit: 0 written · 1 run not review_open · 5 result not JSON or invalid · 8 rate/usage limit

    ✗ review-code failed: code-review document rejected — findings[2].severity: "style" is not bug | deviation | concern | info
      nothing written
    $? = 5

### file: `code-review.json` — normative

    # at <run-dir>/review/pass-01/code-review.json — file name and keys normative, directory layout indicative
    {
      "version": 1,
      "findings": [
        { "id": "F1", "severity": "bug", "file": "src/app/prune.ts", "line": 42,
          "message": "prune deletes a run whose worktree is still registered",
          "suggestion": "refuse when the registry lists a live worktree" },
        { "id": "F2", "severity": "info", "file": "src/cli/commands/prune.ts", "line": null,
          "message": "help text says 'remove', output says 'prune'",
          "suggestion": "use 'prune' in both" }
      ]
    }
    # severity: bug | deviation | concern | info; line: integer or null; unknown keys rejected

### cli: `phax review-plan <run>` — normative

    phax review-plan usage-cli --headless [--doctrine <file>] [--min-severity bug|deviation|concern] [--model <model>] [--effort <effort>]
    phax review-plan usage-cli            # interactive: the same session, the human chooses what to address

    # output layout indicative; command, flags, allowed --min-severity values and exit families normative
    review-plan usage-cli — pass 1 — resumed review session
    planned   F1, C1 → phase-04 · F3 → phase-05
    escalated F4 (R4: the finding says the test is wrong)
    handoff   F2, F5 (info)
    plan      <run-dir>/review/pass-01/review-plan.md (Draft)
    $? = 0

    review-plan usage-cli — pass 2 — clean: no finding at or above concern
    $? = 0

    ✗ review-plan refused: latest compliance verdict is divergent — no plan emitted (R1)
    $? = 1

    Exit: 0 plan emitted or pass clean · 1 refused (run not review_open, divergent verdict, no code-review.json for the pass) · 5 result not JSON or invalid · 8 rate/usage limit

### file: `review-plan.json` / `review-plan.md` — normative

    # at <run-dir>/review/pass-01/ — the extracted-plan projection (version, run.{shortName,title,requiredCommands},
    # phases[].{id,model,effort,planMarkdownAnchor,plannedFilesToCreate,plannedFilesToEdit,optionalFilesToEdit,commit})
    # is normative and IS the extracted-plan schema; phases[].findings, decisions[], handoffNote and review.pass normative;
    # decisions[] nested fields follow the artifact-decide decision shape (indicative here)
    {
      "version": 1,
      "kind": "plan",
      "sourceSpec": "docs/specs/2609240900-usage-cli.md",
      "review": { "pass": 1, "ground": "review/pass-01/code-review.json", "minSeverity": "concern",
                  "doctrine": ["phax-decide-review", "docs/review-doctrine.md"] },
      "run": { "shortName": "usage-cli", "title": "usage-cli — review pass 1", "requiredCommands": [] },
      "preamble": { "summary": "…", "requiredCommandsNote": "…", "technicalArbitrations": [] },
      "phases": [
        { "id": "phase-04", "title": "Guard prune against live worktrees", "findings": ["F1", "C1"],
          "model": "claude-opus-5-5", "effort": "high", "planMarkdownAnchor": "#phase-04-guard-prune",
          "plannedFilesToCreate": [], "plannedFilesToEdit": ["src/app/prune.ts"], "optionalFilesToEdit": [],
          "commit": { "subject": "fix(prune): refuse a run with a live worktree", "body": "Addresses F1, C1." },
          "objective": "…", "detailedInstructions": ["…"], "testStrategy": "…", "excludedScope": ["…"] }
      ],
      "decisions": [
        { "id": "F4", "chosen": "escalate", "abandoned": ["fix in this run"], "why": "the finding says tests/prune.test.ts is wrong",
          "principles": ["R4"], "reversibility": "reversible", "escalate": true }
      ],
      "handoffNote": [ { "finding": "F2", "severity": "info", "message": "help text says 'remove', output says 'prune'" } ]
    }

    review-plan.md: the phax-planning shape rendered from this document (Draft frontmatter), plus a
    "Findings addressed" line per phase, an "Escalations" section and a "Handoff note" section;
    passes `phax plans lint` with no structure error and parses on the deterministic path.

### file: pass record `pass.json` — normative

    # at <run-dir>/review/pass-01/pass.json — `outcome` values and `mode` values normative; other keys and layout indicative
    {
      "version": 1,
      "pass": 1,
      "mode": "headless",
      "complianceVerdict": "conformant-with-deviations",
      "outcome": "planned",
      "appendedPhases": ["phase-04", "phase-05"],
      "approval": { "by": "machine", "grant": "review.code.append", "at": "2026-09-25T10:12:00Z" }
    }
    # mode: headless | interactive; complianceVerdict: a compliance verdict or null (compliance disabled)
    # outcome: planned | clean | blocked-divergent; approval: null until approved, by: machine | operator

### cli: `phax run --append <run> <plan>` — normative

before:

    phax run <plan.md>
      (a run ends review_open; no command returns it to running)

after:

    phax run --append usage-cli <run-dir>/review/pass-01/review-plan.md

    # output layout indicative; flag, arguments, state transition and exit families normative
    append usage-cli — review pass 1 — phase-04..phase-05 after phase-03
    phase-04  from review pass 1   phax/usage-cli--phase-04 ← phax/usage-cli--phase-03
    phase-05  from review pass 1   phax/usage-cli--phase-05 ← phax/usage-cli--phase-04
    usage-cli review_open — handoff and reconciliation regenerated over phase-01..phase-05
    $? = 0

    State: review_open → running → review_open (failed / rate_limited / interrupted exactly as for any phase)

    Refusals — exit 1, nothing created, run state unchanged (wording indicative):
    ✗ append refused: review plan is Draft, not Approved
    ✗ append refused: run usage-cli is failed, not review_open
    ✗ append refused: plan is for pass 1 but the run's latest pass is 2
    ✗ append refused: plan starts at phase-04 but the run's last phase is phase-05
    ✗ append refused: phase-04 plans src/app/other.ts, outside the run footprint (R2)
    ✗ append refused: phase-04 plans tests/prune.test.ts, an oracle file (R4)
    ✗ append refused: run usage-cli already has pull request https://github.com/o/r/pull/12
    Other exits as `phax run`: 2 gate failure · 3 lock conflict · 4 dirty final worktree · 5 agent error · 8 rate/usage limit

### config: `phax.json` `review.code.{enabled,append,maxPasses}` — normative

before:

    "review": {
      "compliance": { "enabled": true },
      "code": { "model": "claude-opus-5-5", "effort": "high" }
    }

after:

    "review": {
      "compliance": { "enabled": true },
      "code": {
        "enabled": true,     // one headless pass when the run reaches review_open; the run stays review_open
        "append": true,      // machine-approve and append each pass's review plan…
        "maxPasses": 2,      // …at most this many times, re-reviewing after each (1–5, default 1)
        "model": "claude-opus-5-5", "effort": "high"
      }
    }
    // all optional; enabled and append default false; append requires enabled

### config: `phax.json` `review.code.{doctrine,minSeverity}` — indicative

before:

    "code": { "model": "claude-opus-5-5", "effort": "high" }

after:

    "code": {
      "enabled": true,
      "doctrine": "docs/review-doctrine.md",   // default for --doctrine (the project extension)
      "minSeverity": "concern",                 // default for --min-severity: bug | deviation | concern
      "model": "claude-opus-5-5", "effort": "high"
    }

### cli: `phax artifact approve|status` on a review plan — indicative

before:

    phax artifact status docs/plans/2609240900-usage-cli-plan.md
    Path:              docs/plans/2609240900-usage-cli-plan.md
    Kind:              plan
    Status:            Approved

after:

    phax artifact approve <run-dir>/review/pass-01/review-plan.md

    phax artifact status <run-dir>/review/pass-01/review-plan.md
    Path:              <run-dir>/review/pass-01/review-plan.md
    Kind:              review-plan (run usage-cli, pass 1)
    Status:            Approved
    Approved:          2026-09-25 by machine (review.code.append)      # or: by operator
    Appended:          phase-04..phase-05                               # or: not appended

### cli: `phax ls` review-pass report — indicative

    phax ls --review-open
    usage-cli   review_open   5 phases   passes 2 (last: clean, conformant)

    phax ls --json   # each run gains:
    "reviewPasses": [
      { "pass": 1, "outcome": "planned", "complianceVerdict": "conformant-with-deviations",
        "findings": { "bug": 1, "deviation": 1, "concern": 1, "info": 2 } },
      { "pass": 2, "outcome": "clean", "complianceVerdict": "conformant",
        "findings": { "bug": 0, "deviation": 0, "concern": 0, "info": 1 } }
    ]

### file: `pr-body.md` (the pull request description) — normative

before:

    # PHAX Run Review Handoff

    Generated by PHAX.

    # Run Review Handoff
    ## Run summary
    …
    ## Plan compliance review
    …
    ## Phase details
    …
    (the whole body truncated from the tail past 60,000 bytes)

after:

    # PHAX Run Review Handoff

    Generated by PHAX.

    ## Review passes

    | Pass | bug | deviation | concern | info | Fixed | Escalated | Open | Compliance |
    |---|---|---|---|---|---|---|---|---|
    | 1 | 1 | 1 | 1 | 2 | 2 | 1 | 0 | conformant-with-deviations |
    | 2 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | conformant |

    ## Decisions

    | Source | Subject | Chosen | Abandoned | Why (principles) | Reversibility | Escalated |
    |---|---|---|---|---|---|---|
    | spec §9 Q1 | pruning manual or automatic | manual | auto | records keep the trajectory (S3) | reversible | no |
    | plan arbitration | lock scope | per run | global lock | … | — | no |
    | review pass 1 · F4 | tests/prune.test.ts is wrong | escalate | fix in this run | an oracle is not a fix target (R4) | reversible | yes |

    # Run Review Handoff
    … (unchanged; the only part truncated past 60,000 bytes)

    # headings, column set and order normative; cell wording indicative; both tables omitted, and the body
    # byte-identical to today's, when the run has no pass and no recorded decision

## 7. Non-goals

- Stacked pull requests: the correction ships in the run's one PR. A second PR based on the first is set aside until a team must approve corrections separately (multi-human decision queue).
- A `coverage` provider or any new review provider. The review uses the run's provider through the existing review session.
- The cockpit UI and any trajectory screen. This spec supplies the data (pass records, tables) a UI would render, and nothing more.
- Appending an arbitrary plan: `--append` accepts only the review plan of the run's latest pass.
- Appending to a published run, and updating an existing pull request's body.
- The oracle-separation `plans lint` rule and the per-phase diff-budget gate. The append refusal uses the §9 Q5 identification until that lint exists.
- Answering a spec's or plan's open questions, and shipping the doctrine skills. Both belong to the `artifact-decide` spec. This spec only reads recorded decisions and loads `phax-decide-review`.
- Re-reviewing inside `review-plan`: the report is the judge, and the plan is its consequence.
- Any change to the interactive `review-code`, to the compliance review's document schema, or to `review-compliance` beyond judging appended phases against their own plan.
- Retrying a failed appended phase automatically. The loop stops, and a human resumes with `phax resume`.
- Autopilot beyond the bounded passes: no roadmap, no supervisor, no budget other than `maxPasses`.

## 8. Acceptance criteria

### Headless review writes findings and stops

Given a `review_open` run `usage-cli` with no review pass, when `phax review-code usage-cli --headless` runs and the session returns a valid code-review document, then `review/pass-01/code-review.json` holds exactly the returned findings; the run's records carry it; no worktree file outside `.phax-context/` changed; the run is still `review_open`; `code-review-session.json` names the session; a later `phax review-code usage-cli` resumes that session id; and the exit code is 0. (refs §5.1, §5.5)

### Compliance verdict reaches the review

Given a run whose `compliance-review.json` has verdict `conformant-with-deviations` and one `deviation` finding, when `phax review-code <run> --headless` runs, then the recorded prompt of the session contains that verdict and that finding's message. (refs §5.2)

### Invalid review lands nothing

Given a headless review session that returns prose, or a finding with severity `style`, when the session ends, then the command exits 5 naming the violation path (e.g. `findings[0].severity`), and no `code-review.json` exists for the pass. (refs §5.3, §5.4)

### Interactive review unchanged

Given a `review_open` run, when `phax review-code <run>` runs without `--headless`, then the prompt file, the session record and the interactive provider invocation are identical to those produced before this change. (refs §5.6)

### Review plan from the report

Given a pass whose `code-review.json` holds `F1` (bug), `F2` (concern) and `F3` (info), a run with no review session record, and a doctrine file `d.md`, when `phax review-plan <run> --headless --doctrine d.md --min-severity concern` runs and the session returns a valid document, then a new session was started whose prompt contains `code-review.json`, the default review doctrine and `d.md`; `review-plan.json` and `review-plan.md` exist for the pass; a phase or a decision names each of `F1` and `F2`; `F3` appears only in the handoff note; and the exit code is 0. (refs §5.7, §5.8, §5.9, §5.12, §5.17)

### The review session is resumed

Given a run whose review session record names session `S`, when `phax review-plan <run> --headless` runs, then the provider invocation resumes session `S` and starts no new session. (refs §5.7)

### Threshold resolution

Given a pass with one `bug`, one `deviation` and one `concern` finding, when `phax review-plan <run> --headless` runs three times: with `--min-severity deviation`; with no flag and `review.code.minSeverity: "bug"`; and with neither, then the set of planned or escalated findings is {bug, deviation}, then {bug}, then all three, and every other finding appears in the handoff note. (refs §5.10, §5.12)

### Compliance deviations are planned too

Given a pass whose latest compliance review has a `deviation` finding on `phase-02` and whose code review has none, when `phax review-plan <run> --headless` runs with the default threshold, then the review plan names that finding as `C1`, either in a phase or in `decisions[]`. (refs §5.11, §5.15)

### Every finding is planned or escalated

Given a session that returns a review plan in which finding `F1` (bug) is named by neither a phase nor a decision, or is named by two phases, when the session ends, then the command exits 5 naming `F1`, and neither `review-plan.json` nor `review-plan.md` exists for the pass. (refs §5.13, §5.14, §5.15)

### Phases continue the run's numbering

Given a run with phases `phase-01` to `phase-03`, when `phax review-plan <run> --headless` emits a two-phase plan, then the plan's phases are `phase-04` and `phase-05`. (refs §5.16)

### The review plan is never re-extracted

Given a review plan that was just materialised, when `phax plans lint` and then `phax run --append` read `review-plan.md`, then lint reports no structure error; rendering the same document twice yields identical Markdown; the structured plan equals the projection in `review-plan.json`; no extraction session is spawned; and the run's records carry `review-plan.json`, `review-plan.md` and the session record. (refs §5.13, §5.17)

### No plan on a divergent verdict

Given a run whose latest compliance verdict is `divergent`, when `phax review-plan <run> --headless` runs, then no provider session is spawned, no review plan exists for the pass, the outcome in `pass.json` is `blocked-divergent`, and the exit code is 1. (refs §5.18)

### Clean pass emits no plan

Given a pass whose findings are all `info`, when `phax review-plan <run> --headless` runs, then no session is spawned, no review plan exists, the outcome in `pass.json` is `clean`, and the exit code is 0. (refs §5.19)

### Interactive review-plan

Given a run whose pass 1 was reviewed headless, when `phax review-plan <run>` runs without `--headless`, the agent produces a document, and the human ends the session, then the interactive invocation resumed the review session; the document is validated and materialised as `review-plan.json` and `review-plan.md` exactly as a headless one would be; and `pass.json` records mode `interactive`. (refs §5.20)

### Append continues the same run

Given a `review_open` run `usage-cli` with `phase-01`..`phase-03`, a commit added on `phax/usage-cli--phase-03` during review, and an Approved pass-1 review plan with `phase-04` and `phase-05`, when `phax run --append usage-cli <review-plan.md>` runs to completion, then the run state goes `review_open` → `running` → `review_open`; `phax/usage-cli--phase-04` descends from the tip of `phax/usage-cli--phase-03`, including the review commit, and `phase-05` descends from `phase-04`; the run id is unchanged; the records for `phase-04` and `phase-05` sit under the same run id; `phase-03` is no longer `review_open`; and `phase-05` is the kept-open final phase. (refs §5.21, §5.22, §5.23, §5.24)

### Appended phases are ordinary phases

Given an appended phase whose gate stays red after the fix loop, when `phax run --append` runs, then it exits 2, the run is `failed`, and `phax resume <run>` resumes at that appended phase. (refs §5.25)

### The whole run is regenerated and judged

Given a run after a completed append of `phase-04`..`phase-05`, when the append finishes and `phax review-compliance <run>` runs, then `review-handoff.md` and the global file reconciliation cover `phase-01`..`phase-05` and the files of both plans; the compliance review judges `phase-04` and `phase-05` against the review plan and `phase-01`..`phase-03` against the original plan. (refs §5.26, §5.27)

### Append refusals

Given in turn: a review plan in Draft; a run in state `failed`; the pass-1 plan when pass 2 exists; a plan starting at `phase-04` on a run whose last phase is `phase-05`; and a run with a recorded pull request, when `phax run --append <run> <plan>` runs, then it exits 1 naming the condition, no worktree or branch is created, and the run's state is unchanged. (refs §5.28, §5.29, §5.30, §5.33)

### Footprint and oracle refusals

Given an Approved review plan whose `phase-04` plans either `src/app/other.ts` (named by no finding and by no plan of the run) or `tests/prune.test.ts`, when `phax run --append <run> <plan>` runs, then it exits 1 naming `phase-04`, the file, and R2 or R4; no worktree is created; and the run stays `review_open`. (refs §5.31, §5.32)

### Enabled review leaves the pass for a human

Given `review.code.enabled: true` with `review.code.append` absent, compliance enabled, and a plan whose run produces a `bug` finding, when `phax run <plan>` completes its phases, then the run is `review_open` with pass 1's `compliance-review.json`, `code-review.json`, `review-plan.json` and `review-plan.md` (Draft); no phase was appended; and the recorded pass shows compliance ran before the code review and the code review before the review plan. (refs §5.34, §5.40)

### Bounded automatic passes

Given `review.code.enabled: true`, `append: true`, `maxPasses: 2`, and a review that reports a `bug` on every pass, when `phax run <plan>` runs, then the plans of passes 1 and 2 are appended; pass 3 is reviewed and its plan left unappended in Draft; the run ends `review_open`; each pass ran the compliance review, the code review, then the review plan, in that order; and the approvals of passes 1 and 2 are recorded as machine approvals naming `review.code.append`. (refs §5.35, §5.36, §5.37, §5.40)

### The loop stops early

Given `review.code.enabled: true`, `append: true` and `maxPasses: 2`, when pass 1's review reports only `info` findings, or pass 1's compliance verdict is `divergent`, then no phase is appended, the run is `review_open`, and pass 1's outcome is `clean` or `blocked-divergent` respectively. (refs §5.35, §5.18, §5.19)

### Config defaults and validation

Given in turn: a `phax.json` without `review.code.enabled`, `append` or `maxPasses`; one with `append: true` and no `enabled`; and one with `maxPasses: 0`, when `phax run` loads it, then the first behaves as it did before this change and produces no review pass; the second and third fail config loading with exit 1, naming `review.code.append` and `review.code.maxPasses` respectively. (refs §5.38, §5.39)

### Passes are visible

Given a run with two passes, the last `clean` with compliance `conformant`, and pass 1's plan machine-approved and appended as `phase-04`..`phase-05`, when `phax ls`, `phax ls --json` and `phax artifact status <pass-1 review-plan.md>` run, then `phax ls` shows 2 passes with `clean` and `conformant` for the last one; `phax ls --json` carries one `reviewPasses` entry per pass; and `artifact status` reports the run, pass 1, Approved, `phase-04`..`phase-05`, and approver kind machine. (refs §5.41, §5.42, §5.37)

### The PR opens on the trajectory

Given a `review_open` run with two passes and one escalation, whose source spec has one recorded decision, when `phax publish-pr <run>` creates the pull request, then `pr-body.md` puts `## Review passes` (two rows, counts equal to those in the pass documents) and then `## Decisions` (one spec row and one review-escalation row citing its principle) before the run review handoff. (refs §5.43, §5.44, §5.45)

### Truncation spares the tables

Given the same run with a handoff larger than 60,000 bytes, when `phax publish-pr <run>` builds the body, then the body is at most 60,000 bytes, contains both tables whole, and carries the truncation note after the truncated handoff. (refs §5.46)

### No trajectory, no change

Given a run with no review pass and no recorded decision, when `phax publish-pr <run>` builds the body, then `pr-body.md` is byte-identical to the body built before this change. (refs §5.47)

## 9. Open questions for implementation planning

### Q1 — Do `info` findings accumulate across passes in the handoff note?

- each pass lists its own info findings under that pass — abandons: a single list the human reads once; the same style note repeats on every pass
- one handoff note, deduplicated by file and message across passes, each entry tagged with the first pass that raised it (doctrine R7) — abandons: seeing directly that a later pass still raised a style note
- only the last pass's info findings — abandons: earlier passes' style notes, which vanish silently (against R6)

Recommendation: one handoff note, deduplicated by file and message across passes, each entry tagged with the first pass that raised it (doctrine R7) — R7 already states it, and a human reads style notes once. The per-pass count stays in the review-passes table, so nothing is hidden.

### Q2 — How is a decision request raised inside an appended phase attributed?

- like any phase: run id plus phase id; the pass and findings are derived from the pass records — abandons: reading the pass and finding ids in the request itself, without a lookup
- add the pass and finding ids to the decision-request record — abandons: an unchanged spec 23 record: a persisted format gains a required field
- attribute it to the review plan as an artifact-level question — abandons: answering the request in its phase's context and resuming the phase from it

Recommendation: like any phase: run id plus phase id; the pass and findings are derived from the pass records — Phase ids are unique within a run, and `pass.json` maps appended phases to their pass, so the attribution can be derived without touching a persisted format.

### Q3 — May `review-plan` run interactively on a run whose review was headless?

- yes, resuming the headless review session in a terminal — abandons: a machine-only transcript for a session the loop started; the records mix human and machine turns
- yes, in a fresh session given `code-review.json` — abandons: the review's memory of why each finding was raised
- no — abandons: a human taking over a pass the loop left unappended (after the bound, or on an escalation)

Recommendation: yes, resuming the headless review session in a terminal — Taking over after the bound is the main human use. `pass.json` records `mode: interactive`, so the mixed transcript stays attributable.

### Q4 — Where is a review plan approved and recorded?

- `phax artifact approve` accepts the review plan in the run directory; the approval is recorded in the pass record (by operator or machine), not in `docs/plans/approvals.json` — abandons: a single approvals ledger in the repository
- the review plan is committed under `docs/plans/` on the run branch and approved like any plan — abandons: a run branch that carries only the work: every pass adds bookkeeping to the PR, and the approval commit must land on the run branch, not on the checkout
- no separate approval: invoking `run --append` is the approval — abandons: the "plan not Approved" refusal, and a machine approval that can be told apart from an operator's

Recommendation: `phax artifact approve` accepts the review plan in the run directory; the approval is recorded in the pass record (by operator or machine), not in `docs/plans/approvals.json` — The review plan is the run's own consequence and is consumed only by `--append` on that run. Keeping its approval with the run keeps the repository ledger for plans a human authored, and the transition verb stays the same.

### Q5 — How does `--append` identify oracle files before the oracle-separation lint exists?

- a built-in convention (`*.test.*`, `*.spec.*`, files under `tests/` or `__fixtures__/`), replaced by the lint when it lands — abandons: oracles outside the convention (matrices, fixtures elsewhere), which only compliance guards until then
- no refusal until the lint exists; compliance alone checks R4 — abandons: the mechanical "never edits what judges it" guarantee the first consumer relies on from the first pass
- a declared glob list in `phax.json` (`review.code.oracles`) — abandons: zero configuration, and it adds one more config key right before the 1.0 freeze

Recommendation: a built-in convention (`*.test.*`, `*.spec.*`, files under `tests/` or `__fixtures__/`), replaced by the lint when it lands — The convention covers the common case mechanically today, compliance catches the rest, and the lint replaces the convention without any change to the surface.

## 10. Implementation-planning note

Settled:

- Two headless commands (`review-code --headless` writes findings and stops; `review-plan` turns them into a plan) plus an interactive `review-plan`; the interactive `review-code` is untouched.
- `code-review.json` keys and severity enum; the review plan is a plan document whose projection is the extracted-plan schema, plus `phases[].findings`, `decisions[]`, `handoffNote` and `review.pass`.
- Every finding at or above the threshold appears in exactly one phase or one decision; `info` and below-threshold findings go to the handoff note; compliance `deviation` findings join as `C<n>`.
- No session and no plan on a `divergent` verdict (exit 1, `blocked-divergent`) or on a clean pass (exit 0, `clean`).
- `run --append` is the new transition `review_open → running` with appended phases numbered after the run, worktrees chained from the previous tip, the same run id and records lineage, the previous final phase closed, handoff and reconciliation regenerated over the whole run, and one PR. It has seven refusals (six before any phase starts, plus dirty worktree via exit 4).
- `review.code.enabled` / `append` / `maxPasses` (default false/false/1, `maxPasses` 1–5, `append` requires `enabled`); machine approval recorded with the granting key.
- Pass order: compliance, then code review, then review plan. The loop stops on a clean pass, a divergent verdict, or the bound.
- PR body: the review-passes table and the decisions table come first and are never truncated; the body is unchanged for runs with no pass and no recorded decision.

Left open:

- Q1–Q5 carry recommended defaults; they must be decided before approval.
- Cell wording of both tables, output layouts, the run-directory layout (`review/pass-NN/`), and the spelling of the indicative `doctrine` / `minSeverity` keys.
- How the interactive `review-plan` session hands its document back to phax (a file under `.phax-context/`, as compliance does, is the obvious route).
- The steme protocol (§3.2, §5.6, §5.7, §6, §12.3) and steme-lab's `phax.schema.json` could not be read in the authoring session. The review config shape was taken from `src/schemas/phaxConfig.ts`. A reviewer should check §5.6/§5.7 against the pass order and bound given here.

Constraints:

- Compose the headless-authoring machinery (JSON-only session, plan document schema, deterministic renderer, cache seed, session record); do not fork it. The review plan's projection must be the extracted-plan schema itself.
- Add the `review_open → running` transition through the state reducer and name it and test it there; appended phases reuse the existing phase lifecycle unchanged.
- Existing run-status and phase-status persisted formats gain no field. Pass data lives in new versioned documents (`code-review.json`, `pass.json`) with required fields only, and a phase's origin is derived from them.
- The new `review.code` keys are optional at birth so a `version: 1` config keeps loading. This is the same deliberate exception as the `authoring` keys, not a shim.
- `code-review.json`, `pass.json` and the review-plan document ship experimental (README "Experimental formats"), like the headless-authoring documents.
- The headless review and review-plan sessions run under the read-only review security posture and write nothing to the worktree outside `.phax-context/`.
- The default doctrine is the `phax-decide-review` skill, with its content taken unchanged from `docs/ideas/skills/phax-decide-review.md`. The `artifact-decide` spec owns its packaging. If this spec lands first, ship it the way `phax-spec` ships.
- The machine-versus-operator approval form must match the one the `artifact-decide` spec defines; whichever spec lands second adopts the first's form.
- When the oracle-separation lint lands, it replaces the Q5 convention in the append refusal.
- Both PR tables are rendered from persisted data only, with no model call.

## 11. Docs page

Page: docs/review-as-plan.md

Reader: an operator or loop author who wants phax to review its own run and fix what the review finds, through phases, before the PR is opened

Example: Automatic: in `phax.json` set "review": { "compliance": { "enabled": true }, "code": { "enabled": true, "append": true, "maxPasses": 2 } }; `phax run <plan>` then ends `review_open` after at most two fix passes, and `phax publish-pr usage-cli` opens with the review-passes and decisions tables. By hand: `phax review-compliance usage-cli` → `phax review-code usage-cli --headless` → `phax review-plan usage-cli --headless --min-severity concern` → read and `phax artifact approve <run-dir>/review/pass-01/review-plan.md` → `phax run --append usage-cli <run-dir>/review/pass-01/review-plan.md` → repeat, or `phax publish-pr usage-cli`.
