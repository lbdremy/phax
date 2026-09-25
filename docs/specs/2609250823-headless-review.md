---
status: Draft
date: 2026-09-25
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---
# Review as a plan — headless code review, review-plan, run --append

## 1. Context

`phax review-code <run>` opens an interactive, pre-prompted session in a `review_open` run's worktree. It resumes the session recorded in `code-review-session.json` unless `--new-session` is given, and the developer then takes over.

`phax review-compliance <run>` is its non-mutating, structured sibling. phax decodes `compliance-review.json` strictly as `{ version: 1, verdict: conformant | conformant-with-deviations | divergent, summary, perPhase[{ phaseId, verdict, findings[{ dimension, severity: info | deviation | concern, message }] }], attentionPoints, pointers }`.

`phax.json` has `review.compliance.{enabled, model, effort}`. Under `review.code` it has only `{model, effort}`.

A run lives in the local registry (`~/.phax/runs/`), outside Git. Its committed trace is the records branch `phax/records/v1`. `phax run [short-name] --plan <path>` gives each phase its own worktree on `phax/<slug>--phase-NN`. The last phase stays open in `review_open`, where manual fixes land as ordinary commits. The run states allow `running → review_open` and `review_open → archived`. Nothing returns a run to `running`.

Today's exit families:
- 2: plan or config validation
- 3: unsafe Git state
- 4: gate failure
- 5: agent error or rejected document
- 7: lock conflict
- 8: rate or usage limit
- 12: artifact or approval refusal
- 1: anything else

`phax publish-pr` builds the PR body from a fixed header plus the review handoff, with the compliance review embedded. The body is capped at 60,000 bytes and truncated from the tail. An existing PR for the branch is reused, not updated.

Headless authoring (0.16.0) set the pattern reused here. A session that phax spawns returns only schema-validated JSON. phax then renders the Markdown deterministically, writes the JSON beside it, seeds the extraction cache with the plan projection, commits, and records.

The review doctrine landed by hand on 2026-09-25 as the skill `phax-decide-review`. It holds principles `R1`–`R7` under the pairs `C1`–`C5` and the ground `E0`. It names two live modes. In interactive mode the human decides and the agent facilitates. In headless mode the agent decides within the menu and escalates the rest. A third mode, headless total, is marked as later. When the arbiter judges a finding wrong, it proposes and escalates, and the proposal never wins by itself. Reversal is a cost: at equal value the change that is cheaper to reverse is preferred, and a destructive change stops.

The `artifact-decide` spec (Draft, same day) registers the three doctrine skills in the catalog. It also fixes three shapes this spec reuses:
- the decision `{ id, chosen, abandoned[], advocate, why, principles[], reversibility: cheap | costly | irreversible, escalate }`;
- principle ids, which are the backticked ids that open a doctrine's list items;
- the approver `{ kind: machine, grant } | { kind: operator, name }`, declared with `--machine <grant>`.

The first consumer is the steme roadmap-1.0 conductor. It is a loop with no developer at the terminal, and it allows at most two review passes.

Ground read:

- `docs/specs/archive/2609241219-headless-review.md` — The first draft, Abandoned 2026-09-25. I reused its structure. I replaced what the 2026-09-25 decisions change: findings can be dismissed and carry an outcome and a decision history across passes, there are two modes only, the doctrine skill has landed, and reversibility is a cost. I also corrected the `phax run` argument grammar.
- `docs/briefs/headless-review.md` — The brief, revised 2026-09-25. It covers dismissal as a decision, two modes, the landed review doctrine, reversibility as a cost, and the five open questions to arbitrate.
- `docs/ideas/headless-code-review.md` — The idea, revised 2026-09-24. Two commands (review-code --headless, review-plan --headless), run --append, review.code.{enabled,append,maxPasses}, the per-pass order, no plan on divergent, the same PR (never stacked), and a PR body that opens on the passes and decisions tables.
- `.claude/skills/phax-decide-review/SKILL.md` — The landed review doctrine: R1–R7 under the pairs C1–C5 and the ground E0. Modes are interactive, headless, and headless total (later). It defines propose-and-escalate, treats reversal as a cost with destruction as a floor, and outputs review-plan.json with decisions[] in the decide shape.
- `docs/specs/2609250815-artifact-decide.md` — Draft sibling spec. It registers the three doctrine skills in the catalog (§5.47), the project-skill override, principle-id collection, the decision shape { id, chosen, abandoned[], advocate, why, principles[], reversibility, escalate }, and the approver form { kind: machine, grant } | { kind: operator, name } with --machine <grant>. This spec shares that form.
- `docs/ideas/change-gates-from-the-harness.md` — The oracle-separation lint (an agent never edits what judges its work). x.ts / x.test.ts pairing is the cheap first convention, and a declared oracles concept comes later.
- `src/schemas/complianceReview.ts` — The shape to mirror: version 1, verdict conformant | conformant-with-deviations | divergent, perPhase findings { dimension, severity info | deviation | concern, message }, decoded strictly with excess properties rejected.
- `src/domain/state.ts` — RunState: created, running, failed, review_open, completed, stopped, archived, interrupted, rate_limited. Existing transitions include running → review_open and review_open | completed → archived. Nothing returns a run to running.
- `src/domain/publish/body.ts` — The PR body is a fixed header plus the review handoff, capped at 60,000 bytes and truncated from the tail, with a note pointing to review-handoff.md.
- `src/app/publishRun.ts` — Reuse-or-create: an existing PR for the branch is reused and its body is not updated. The body is built from the handoff plus compliance-review.md.
- `src/app/resolveRunInfo.ts` — The run directory is <stateRoot>/runs/<key>, local and outside Git. It holds run-status.json, phax-plan.json, and one status.json per phase folder. The final phase is the highest-indexed one.
- `src/schemas/phaxConfig.ts` — review.compliance { enabled (required), model?, effort? } and review.code { model?, effort? } only. Effort is low | medium | high.
- `src/cli/commands/runLayers.ts` — Exit families: 2 plan/config validation, 3 unsafe git state, 4 gate failed, 5 agent error or rejected authoring document, 7 lock, 8 rate/usage limit, 11 security, 12 artifact or approval refusal (PlanNotApprovedError), 1 otherwise.
- `phax.usage.kdl` — `phax run [short-name] --plan <path>`, `review-code <short-name> [--new-session] [--model] [--effort]`, `publish-pr` (create or reuse), and `ls` filters. The registry is under ~/.phax/runs/.
- `NEXT_STEPS.md` — Road to 1.0.0: this change is additive only. The spec candidates list 'Three additive specs…' item 2 (review-as-plan) for the steme experiment. The oracle-separation lint is what makes review-as-plan safe.

## 2. Problem

A loop has no developer, so it cannot run the only code review phax offers. Two shortcuts both fail:
- Printing the prompt for an outside agent takes the review out of phax. There is no run directory, no records and no resumable session, and the findings come back as prose.
- Resuming the review session with "fix everything" puts changes into the run without phases. Those changes get no gate of their own, no handoff and no reconciliation, and the session is free to edit the test that judges it.

Fixes that follow a review must go through the same machinery as the implementation, but a run cannot grow. Once a run is `review_open` it runs no further phase, and a second run means a second PR and a second records lineage.

A finding the reviewer got wrong has no home either. It is either fixed anyway, which is a wrong change, or left open forever. Nothing records that someone judged it wrong, or why.

Nothing bounds or reports the review–fix loop. The PR a human reads first shows diff detail, which is the part tail truncation removes. It does not show whether the run converged or what was deliberately left unfixed.

## 3. Product goal

Make the code review a phax artifact, and make its consequence a phax plan.

A headless review writes structured findings and stops. `phax review-plan` turns them into a review plan in the phax-plan shape, following a doctrine and a threshold that the caller owns. Each finding under consideration is either fixed by a phase or decided: dismissed, left open, or, when a machine decides, escalated with a proposal that a human must confirm. `phax run --append` then executes the plan as more phases of the same run, with the same records and the same PR.

A config setting runs this as a bounded loop at the end of a run. The PR then opens on the trajectory: one table of review passes and one table of decisions. Every change is additive to the CLI and to `phax.json`, and the interactive review is unchanged.

> A review changes code only through phases of the same run. A machine may fix a finding but never settles one it does not fix. Every finding ends fixed, open, dismissed or escalated, and none is dropped.

## 4. Terminology

- **Pass** — One review round over a run, numbered from 1. A pass opens when a headless code review writes its `code-review.json`. It holds at most one current review plan. Its artifacts live under the run directory and in the run's records.
- **Finding** — One entry of a pass's `code-review.json`. It has one of two variants, by `source`. A review finding (`review`) has `severity`, `file`, `line` and `suggestion`. A compliance finding (`compliance`) is a `deviation` finding of the latest compliance review, with `phase` and `dimension`. Both carry `id`, `message`, `outcome` and `history`.
- **Finding id** — A run-unique id that phax assigns: `F<n>` for review findings and `C<n>` for compliance findings. Numbering continues from pass to pass.
- **Severity order** — `bug` > `deviation` > `concern` > `info`.
- **Threshold** — The lowest severity a pass considers for a fix: `bug`, `deviation` or `concern`. `info` is never considered.
- **Findings under consideration** — In headless mode: the latest pass's findings at or above the threshold whose outcome is `open`. In interactive mode: those findings plus every `escalated` finding of the run.
- **Outcome** — A finding's current state:
  - `fixed`: a phase of an appended review plan names the finding and reached `committed`.
  - `escalated`: its last decision is a machine decision, which always carries a proposal.
  - `dismissed`: its last decision is an operator `dismiss`.
  - `open`: anything else. This covers undecided findings, findings planned but not yet committed, operator `leave-open` decisions, below-threshold findings and `info` findings.
- **Finding decision** — A decision in the `artifact-decide` shape about a finding that no phase fixes. Its menu is `fix` | `dismiss` | `leave-open`. It chooses `dismiss` or `leave-open` and abandons the other two options. A dismissal says why the finding is wrong. Decisions are appended to the finding's `history` and never removed.
- **Review doctrine** — The instructions a review-plan session follows: the `phax-decide-review` skill (a project-scoped skill of the same name replaces it), followed by the caller's doctrine file.
- **Review plan** — The document a review-plan session emits for one pass. Its phases project to the extracted-plan schema and name the finding ids they fix. It also carries `decisions[]` and a handoff note. phax writes it as `review-plan.json`, rendered as `review-plan.md` when it has phases.
- **Pass outcome** — One of:
  - `planned`: the review plan has phases.
  - `no-fix`: every finding under consideration was decided and none was planned.
  - `clean`: nothing was under consideration.
  - `blocked-divergent`: the latest compliance verdict is `divergent`.
- **Appended phase** — A phase executed by `phax run --append`. It is numbered after the run's existing phases, runs under the same run id, and has the origin `from review pass N`.
- **Run footprint** — The union of every file declared by any plan the run executed (to create, to edit, or optional), plus the files named by the findings under consideration.
- **Oracle file** — A file that judges the code a phase changes: a test, a fixture or a disposition matrix. Until the oracle-separation lint exists, oracle files are identified as §9 Q5 decides.
- **Reversibility** — The cost of undoing a change or a decision: `cheap` | `costly` | `irreversible`. A review-plan phase is never `irreversible`, because destructive work stops. A decision rated `irreversible` must escalate.
- **Machine approval** — An approval of a review plan recorded as `{ kind: machine, grant }`. The grant comes from `--machine <grant>`, or is `review.code.append` when the loop approves. An operator approval is `{ kind: operator, name }`.
- **Recorded decision** — A decision phax holds as data. It is one of: a decided question in the source spec's sidecar history, a technical arbitration in a plan document, or a finding decision in a finding's history.

## 5. Functional requirements

### 5.1 Headless code review in the run's session

WHERE `--headless` is given to `phax review-code <run>` THE system SHALL run the code review in the run's review session, in the run's final-phase worktree, without attaching a terminal. It SHALL resume the recorded session unless `--new-session` is given.

### 5.2 The review brief carries compliance and earlier outcomes

WHEN a headless review session starts THE system SHALL give it the run's latest compliance verdict and findings, and every earlier finding of the run with its outcome.

### 5.3 JSON-only code-review result

WHEN a headless review session ends THE system SHALL accept as its result only a JSON code-review document valid against the code-review document schema.

### 5.4 An invalid review opens no pass

IF the headless review result is not JSON or fails validation THEN the system SHALL fail in the agent-error exit family, name the first violation path, and open no pass.

### 5.5 Run-unique finding ids

The system SHALL give every finding a run-unique id, `F<n>` for a review finding and `C<n>` for a compliance finding, continuing the run's numbering from pass to pass.

### 5.6 Compliance deviations join the findings

WHEN the system writes a pass's `code-review.json` THE system SHALL include each `deviation` finding of the run's latest compliance review as a compliance finding.

### 5.7 Write, record, stop

WHEN the code-review document validates THE system SHALL open the next pass and write its `code-review.json`, with every finding at outcome `open`, under the run directory and into the run's records. It SHALL then stop, leaving the review session resumable and the run `review_open`.

### 5.8 Interactive review-code unchanged

The system SHALL leave `phax review-code <run>` without `--headless` unchanged.

### 5.9 Review-plan preconditions

IF the run is not `review_open`, has no pass, or has already appended its latest pass's review plan, or the doctrine file cannot be read, THEN `phax review-plan` SHALL refuse before any session, naming the condition.

### 5.10 Review-plan session continuity

WHEN `phax review-plan <run>` starts THE system SHALL resume the run's review session if its record exists, and otherwise start a new session from the latest pass's `code-review.json`.

### 5.11 Review doctrine skill

The system SHALL load the `phax-decide-review` doctrine skill into every review-plan session. A project-scoped skill of the same name SHALL take the bundled skill's place.

### 5.12 Caller doctrine appended

WHERE a doctrine file is given by `--doctrine`, or else by `review.code.doctrine`, THE system SHALL append its content after the doctrine skill in the session prompt.

### 5.13 Threshold resolution

The system SHALL consider for a fix only findings at or above the threshold. The threshold resolves from `--min-severity`, else `review.code.minSeverity`, else `concern`.

### 5.14 Info and below-threshold findings go to the handoff note

The system SHALL write `info` findings and findings below the threshold to the review plan's handoff note, and never to a phase or a decision.

### 5.15 JSON-only review plan

WHEN a review-plan session ends THE system SHALL accept as its result only a JSON review-plan document valid against the review-plan document schema, whose phase projection is the extracted-plan schema.

### 5.16 Every finding under consideration is fixed or decided once

IF a finding under consideration is named by no phase and no decision, or by more than one, or a phase or decision names a finding not under consideration, THEN the system SHALL reject the review-plan document, naming the finding.

### 5.17 Finding decisions follow the menu and cite the doctrine

IF a decision does not choose `dismiss` or `leave-open`, does not abandon exactly the other two of `fix`, `dismiss` and `leave-open`, or cites no principle id or a principle id that no loaded doctrine defines, THEN the system SHALL reject the review-plan document.

### 5.18 A machine never settles a finding it does not fix

IF a decision in a headless review-plan document carries no escalation THEN the system SHALL reject the document.

### 5.19 Operator decisions do not escalate

IF a decision in an interactive review-plan document carries an escalation THEN the system SHALL reject the document.

### 5.20 Destructive work stops

IF a phase of the review plan is rated `irreversible`, or a decision rated `irreversible` carries no escalation, THEN the system SHALL reject the review-plan document.

### 5.21 An invalid review plan lands nothing

IF the review-plan result is not JSON, fails validation, or is rejected by any check in this section THEN the system SHALL fail in the agent-error exit family and name the first violation path. It SHALL write nothing and change no finding's outcome.

### 5.22 Phases continue the run's numbering

The system SHALL number the review plan's phases consecutively after the run's last phase.

### 5.23 Materialisation

WHEN a review-plan document with at least one phase validates THE system SHALL:
- render `review-plan.md` deterministically as Draft;
- write `review-plan.json` beside it;
- seed the extraction cache with its projection;
- write both under the pass's directory and into the run's records;
- record the session.

### 5.24 Every finding decided, nothing to fix

WHEN a validated review-plan document has no phase THE system SHALL write `review-plan.json`, render no `review-plan.md`, and record the pass outcome `no-fix`.

### 5.25 Decisions set outcomes

WHEN a review-plan document lands THE system SHALL append each decision to its finding's history. It SHALL set the finding's outcome to `escalated` for a machine decision, `dismissed` for an operator `dismiss`, and `open` for an operator `leave-open`.

### 5.26 An unappended plan is replaced

WHEN `phax review-plan` lands a document for a pass that already has an unappended review plan THE system SHALL replace that plan and clear its approval, keeping the replaced plan in the run's records.

### 5.27 No plan on a divergent verdict

IF the run's latest compliance verdict is `divergent` THEN `phax review-plan` SHALL spawn no session, emit no plan, record the pass outcome `blocked-divergent`, and exit 1.

### 5.28 Clean pass

WHEN no finding is under consideration THE system SHALL spawn no session, emit no plan, and record the pass outcome `clean`.

### 5.29 Interactive review-plan

WHERE `--headless` is not given to `phax review-plan <run>` THE system SHALL open the session interactively, with the operator deciding and the agent facilitating. It SHALL then validate and land the resulting document exactly as in headless mode.

### 5.30 Escalations wait for an operator

WHEN an interactive review-plan session starts THE system SHALL present, after the latest pass's findings, every escalated finding of the run with its proposal.

### 5.31 The append transition

WHEN `phax run <run> --append --plan <review-plan.md>` is accepted THE system SHALL transition the run from `review_open` to `running` and execute the plan's phases after the run's existing phases.

### 5.32 Worktree lineage

The system SHALL branch each appended phase's worktree from the tip of the preceding phase's branch. The first appended phase SHALL branch from the previously final phase's branch, including commits made during review.

### 5.33 Same run identity and records lineage

The system SHALL run appended phases under the run's id and slug and write their records into the run's records lineage.

### 5.34 Final-phase handover

WHEN an append starts THE system SHALL close the previously final phase the way a non-final phase is closed, and make the last appended phase the kept-open final phase.

### 5.35 Appended phases are ordinary phases

The system SHALL execute appended phases with the same lifecycle as any phase: gates, fix loop, rate-limit handling, failure and `phax resume`.

### 5.36 Fixed means committed by an appended phase

WHEN an appended phase reaches `committed` THE system SHALL set the outcome of every finding it names to `fixed`.

### 5.37 Whole-range regeneration

WHEN the appended phases complete THE system SHALL regenerate the global file reconciliation and `review-handoff.md` over every phase of the run and return the run to `review_open`.

### 5.38 Compliance per originating plan

WHEN a compliance review runs on a run with appended phases THE system SHALL judge each phase against the plan that planned it.

### 5.39 Refuse an unapproved plan

IF the review plan is not Approved THEN `phax run --append` SHALL refuse in the approval-refusal exit family before any phase starts, creating nothing and leaving the run's state unchanged.

### 5.40 Refuse a run that is not review_open

IF the run is not `review_open` THEN `phax run --append` SHALL refuse before any phase starts, creating nothing and leaving the run's state unchanged.

### 5.41 Refuse a published run

IF the run already has a recorded pull request THEN `phax run --append` SHALL refuse before any phase starts, creating nothing and leaving the run's state unchanged.

### 5.42 Refuse a stale or foreign plan

IF the plan is not the current review plan of the run's latest pass, or its first phase does not follow the run's last phase, THEN `phax run --append` SHALL refuse in the plan-validation exit family before any phase starts.

### 5.43 Refuse files outside the run footprint

IF a phase of the review plan plans a file outside the run footprint THEN `phax run --append` SHALL refuse in the plan-validation exit family before any phase starts, naming the phase, the file and `R2`.

### 5.44 Refuse oracle files

IF a phase of the review plan plans an oracle file THEN `phax run --append` SHALL refuse in the plan-validation exit family before any phase starts, naming the phase, the file and `R4`.

### 5.45 Review-plan approval stays with the run

WHEN a review plan is approved THE system SHALL record the approval and its approver in the pass record, not in `docs/plans/approvals.json`. The approver is a machine with its grant when `--machine <grant>` is given, and otherwise the operator, named by the committing Git identity.

### 5.46 Escalations do not block the fixes

The system SHALL allow a review plan whose decisions escalate to be approved and appended, reporting its escalations rather than blocking on them.

### 5.47 review.code.enabled runs a pass

WHERE `review.code.enabled` is true THE system SHALL run one review pass when a run reaches `review_open`, and leave the run `review_open` with the pass's artifacts.

### 5.48 review.code.append loops

WHERE `review.code.append` is true THE system SHALL approve each pass's review plan as a machine approval with the grant `review.code.append`, append it, and then run the next pass.

### 5.49 The loop stops early

WHEN a pass's outcome is `clean`, `no-fix` or `blocked-divergent`, or an append leaves the run in a state other than `review_open`, THE system SHALL run no further pass.

### 5.50 The pass bound

IF the loop has appended `review.code.maxPasses` review plans THEN the system SHALL run one final pass, leave that pass's review plan Draft and unappended, and leave the run `review_open`.

### 5.51 Defaults keep today's behavior

The system SHALL default `review.code.enabled` and `review.code.append` to false and `review.code.maxPasses` to 1, so that a `phax.json` without these keys loads and behaves as it does today.

### 5.52 Inconsistent review config rejected

IF `review.code.append` is true while `review.code.enabled` is not, or `review.code.maxPasses` is outside 1–5, THEN config loading SHALL fail in the config-validation exit family, naming the key.

### 5.53 Per-pass order

The system SHALL run each automatic pass in this order: the compliance review over the whole run when it is enabled, then the headless code review, then the review plan.

### 5.54 phax ls reports passes

WHEN `phax ls` lists a run with review passes THE system SHALL show:
- its pass count;
- its latest pass's outcome and compliance verdict;
- its findings' fixed, escalated, dismissed and open counts.

### 5.55 artifact status reports a review plan

WHEN `phax artifact status` inspects a review plan THE system SHALL report its run, pass, status, approver kind and identity, appended phases, and the outcome counts of the findings it considered.

### 5.56 The PR body opens on the trajectory

WHEN `phax publish-pr` builds the body for a run with a review pass or a recorded decision THE system SHALL place the review-passes table and then the decisions table before the existing handoff.

### 5.57 Review-passes table content

The system SHALL render one review-passes row per pass, giving its findings by severity, its fixed, escalated, dismissed and open counts, and its compliance verdict.

### 5.58 Decisions table content

The system SHALL render one decisions row for each decided question of the run's source spec, each technical arbitration of the run's plans, and each finding with a decision history. Each row SHALL name its arbiter and cited principles.

### 5.59 Truncation spares the tables

IF the body exceeds the size cap THEN the system SHALL truncate only the handoff and keep both tables whole.

### 5.60 No trajectory, no change

WHILE a run has no review pass and no recorded decision THE system SHALL build the PR body exactly as it does today.

## 6. Surface

### cli: phax review-code <run> --headless — normative

before:

    phax review-code usage-cli [--new-session] [--model <model>] [--effort <effort>]
      (opens an interactive, pre-prompted session; the developer takes over)

after:

    phax review-code usage-cli --headless [--new-session] [--model <model>] [--effort <effort>]

    # normative: the flag name and the exit families. Indicative: output layout and wording.
    review-code usage-cli — pass 1 — claude-opus-5-5 / high (headless, new session)
    brief     compliance conformant-with-deviations (1 deviation)
    findings  bug 1 · deviation 1 · concern 1 · info 1 + compliance deviation 1   (F1–F4, C1)
    written   <run-dir>/review/pass-01/code-review.json   (records: committed)
    session   resumable (code-review-session.json)
    $? = 0

    ✗ review-code failed: code-review document rejected — findings[2].severity: "style" is not bug | deviation | concern | info
      nothing written; no pass opened
    $? = 5

    Exit: 0 written · 1 run not review_open · 5 result not JSON or rejected · 8 rate/usage limit

### file: code-review document (the headless review session's final message) — normative

    {
      "version": 1,
      "findings": [
        { "severity": "bug", "file": "src/app/prune.ts", "line": 42,
          "message": "prune deletes a run whose worktree is still registered",
          "suggestion": "refuse when the registry lists a live worktree" },
        { "severity": "info", "file": "src/cli/commands/prune.ts", "line": null,
          "message": "help text says 'remove', output says 'prune'",
          "suggestion": "use 'prune' in both" }
      ]
    }
    # every key required; unknown keys rejected
    # severity: bug | deviation | concern | info; line: an integer >= 1, or null
    # the agent emits no ids and no outcome: phax assigns both

### file: code-review.json — normative

    # at <run-dir>/review/pass-01/code-review.json, also committed to the run's records
    # normative: file name, keys and enums. Indicative: directory layout and the nested spellings in history entries.
    {
      "version": 1,
      "pass": 1,
      "findings": [
        { "id": "F1", "source": "review", "severity": "bug", "file": "src/app/prune.ts", "line": 42,
          "message": "…", "suggestion": "…", "outcome": "fixed", "history": [] },
        { "id": "F2", "source": "review", "severity": "deviation", "file": "src/app/prune.ts", "line": 88,
          "message": "a registry entry without a worktree is kept", "suggestion": "…", "outcome": "escalated",
          "history": [
            { "kind": "decided", "at": "2026-09-25T10:04:00Z", "pass": 1,
              "by": { "kind": "machine", "doctrine": ["phax-decide-review", "docs/review-doctrine.md"],
                      "provider": "claude", "model": "claude-opus-5-5", "effort": "high" },
              "chosen": "dismiss", "abandoned": ["fix", "leave-open"], "advocate": "…",
              "why": "not a deviation: spec §5.3 allows a registry entry without a worktree",
              "principles": ["R3", "C1"], "reversibility": "cheap",
              "escalate": "Proposal: dismiss F2. A human must confirm the spec reading." } ] },
        { "id": "F4", "source": "review", "severity": "info", "file": "src/cli/commands/prune.ts", "line": null,
          "message": "…", "suggestion": "…", "outcome": "open", "history": [] },
        { "id": "C1", "source": "compliance", "severity": "deviation", "phase": "phase-02", "dimension": "tests",
          "message": "phase-02 planned a registry test it did not write", "outcome": "fixed", "history": [] }
      ]
    }
    # source: review | compliance, with per-variant keys: a compliance finding has phase and dimension, and no file, line or suggestion
    # outcome: fixed | open | dismissed | escalated. It is written as open and updated only by phax (review-plan, append).
    # history: append-only decision entries; by: { kind: machine, … } | { kind: operator, name }
    # ids: run-unique F<n> and C<n>, with numbering continuing across passes

### cli: phax review-plan <run> — normative

    phax review-plan usage-cli --headless [--doctrine <file>] [--min-severity bug|deviation|concern] [--model <model>] [--effort <effort>]
    phax review-plan usage-cli [--doctrine <file>] [--min-severity …] [--model …] [--effort …]   # interactive: the operator decides, the agent facilitates

    # normative: the command, the flags, the --min-severity values and the exit families. Indicative: output layout and wording.
    review-plan usage-cli — pass 1 — headless, resumed review session — claude-opus-5-5 / high
    doctrine   phax-decide-review (bundled) + docs/review-doctrine.md · threshold concern
    planned    F1, C1 → phase-04 (cheap) · F3 → phase-05 (cheap)
    escalated  F2 — proposal: dismiss, "not a deviation: spec §5.3 allows it" (R3, C1)
    handoff    F4 (info)
    escalated  1 of 4 under consideration
    plan       <run-dir>/review/pass-01/review-plan.md (Draft)
    $? = 0

    review-plan usage-cli — pass 2 — clean: no open finding at or above concern
    $? = 0

    review-plan usage-cli — pass 1 — no-fix: every finding decided (escalated 2, dismissed 0, left open 0)
    $? = 0

    ✗ review-plan refused: latest compliance verdict is divergent — no plan emitted (R1)
    $? = 1

    ✗ review-plan failed: review-plan document rejected — decisions[0].escalate: a headless decision must escalate (F2)
      nothing written; outcomes unchanged
    $? = 5

    Exit: 0 planned, no-fix or clean · 1 refused (run not review_open, no pass, latest plan already appended, divergent verdict, unreadable doctrine file) · 5 result not JSON or rejected · 8 rate/usage limit

### file: review-plan document / review-plan.json — normative

    # the session's final message; phax writes it as <run-dir>/review/pass-01/review-plan.json
    # normative: the phase projection (run, and phases[].{id, model, effort, planMarkdownAnchor, plannedFilesToCreate,
    # plannedFilesToEdit, optionalFilesToEdit, commit}) IS the extracted-plan schema; also phases[].findings,
    # phases[].reversibility, decisions[] (the artifact-decide decision shape), handoffNote and review.*
    # indicative: the prose fields' spelling
    {
      "version": 1,
      "kind": "review-plan",
      "sourceSpec": "docs/specs/2609240900-usage-cli.md",
      "review": { "run": "usage-cli", "pass": 1, "ground": "review/pass-01/code-review.json",
                  "minSeverity": "concern", "mode": "headless",
                  "doctrine": ["phax-decide-review", "docs/review-doctrine.md"] },
      "run": { "shortName": "usage-cli", "title": "usage-cli — review pass 1", "requiredCommands": [] },
      "preamble": { "summary": "…", "requiredCommandsNote": "…", "technicalArbitrations": [] },
      "phases": [
        { "id": "phase-04", "title": "Guard prune against live worktrees", "findings": ["F1", "C1"],
          "reversibility": "cheap",
          "model": "claude-opus-5-5", "effort": "high", "planMarkdownAnchor": "#phase-04-guard-prune",
          "plannedFilesToCreate": [], "plannedFilesToEdit": ["src/app/prune.ts"], "optionalFilesToEdit": [],
          "commit": { "subject": "fix(prune): refuse a run with a live worktree", "body": "Addresses F1, C1." },
          "objective": "…", "detailedInstructions": ["…"], "testStrategy": "…", "excludedScope": ["…"] }
      ],
      "decisions": [
        { "id": "F2", "chosen": "dismiss", "abandoned": ["fix", "leave-open"],
          "advocate": "The strongest case for fix: …",
          "why": "not a deviation: spec §5.3 allows a registry entry without a worktree",
          "principles": ["R3", "C1"], "reversibility": "cheap",
          "escalate": "Proposal: dismiss F2. A human must confirm the spec reading." }
      ],
      "handoffNote": [ { "finding": "F4", "firstPass": 1, "file": "src/cli/commands/prune.ts",
                         "message": "help text says 'remove', output says 'prune'" } ]
    }
    # decisions: exactly one per finding under consideration that no phase names
    # chosen: dismiss | leave-open; abandoned: the other two of fix | dismiss | leave-open
    # headless: every decision carries an escalate proposal; interactive: escalate is null
    # phases[].reversibility: cheap | costly (irreversible is rejected: destructive work stops)
    # decisions[].reversibility: cheap | costly | irreversible (irreversible only with escalate)
    # phases may be empty: pass outcome no-fix, review-plan.json written, no review-plan.md

### file: review-plan.md — indicative

    # <run-dir>/review/pass-01/review-plan.md, rendered from review-plan.json and never written by the agent
    ---
    status: Draft
    …the phax-planning frontmatter and preamble…
    ---
    ## phase-04 — Guard prune against live worktrees
    Findings addressed: F1, C1 · Reversibility: cheap
    …the phax-planning phase fields…

    ## Findings decided
    - F2 (deviation) — escalated: dismiss, provisionally — machine (phax-decide-review + docs/review-doctrine.md). Principles: R3, C1.
      Proposal: dismiss F2. A human must confirm the spec reading.

    ## Handoff note
    - F4 (info, first raised in pass 1) src/cli/commands/prune.ts — help text says 'remove', output says 'prune'

    # normative: the file passes `phax plans lint` with no structure error and parses on the deterministic path
    # to the projection in review-plan.json. Indicative: section names and wording.

### file: pass.json — normative

    # <run-dir>/review/pass-01/pass.json, also committed to the run's records
    # normative: the outcome, mode and approvedBy kinds. Indicative: the other keys and the layout.
    {
      "version": 1,
      "pass": 1,
      "mode": "headless",
      "threshold": "concern",
      "complianceVerdict": "conformant-with-deviations",
      "outcome": "planned",
      "approvedBy": { "kind": "machine", "grant": "review.code.append" },
      "approvedAt": "2026-09-25T10:12:00Z",
      "appendedPhases": ["phase-04", "phase-05"]
    }
    # mode: headless | interactive (of the review-plan session that landed the current plan)
    # complianceVerdict: a compliance verdict, or null when compliance is disabled
    # outcome: planned | no-fix | clean | blocked-divergent
    # approvedBy: null until approved, then { kind: machine, grant } | { kind: operator, name } (the artifact-decide form)
    # appendedPhases: [] until appended

### cli: phax run <run> --append --plan <review-plan.md> — normative

before:

    phax run [short-name] --plan <path> [--allow-dirty] [--security <mode>] [--refresh] …
      (always creates a new run; a run ends review_open and no command returns it to running)

after:

    phax run usage-cli --append --plan <run-dir>/review/pass-01/review-plan.md

    # normative: the flag, the argument form (the existing run grammar), the state transition and the exit families.
    # indicative: output layout and wording.
    append usage-cli — review pass 1 — phase-04..phase-05 after phase-03
    phase-04  from review pass 1 (F1, C1)  phax/usage-cli--phase-04 ← phax/usage-cli--phase-03
    phase-05  from review pass 1 (F3)      phax/usage-cli--phase-05 ← phax/usage-cli--phase-04
    fixed     F1, C1, F3
    usage-cli review_open — handoff and reconciliation regenerated over phase-01..phase-05
    $? = 0

    State: review_open → running → review_open (failed / rate_limited / interrupted exactly as for any phase)

    Refusals happen before any phase starts. Nothing is created and the run state is unchanged. (wording indicative)
    ✗ append refused: review plan is Draft, not Approved                                     $? = 12
    ✗ append refused: run usage-cli is failed, not review_open                                $? = 1
    ✗ append refused: run usage-cli already has pull request https://github.com/o/r/pull/12    $? = 1
    ✗ append refused: the plan is pass 1's, but the run's latest pass is 2                    $? = 2
    ✗ append refused: plan starts at phase-04 but the run's last phase is phase-05             $? = 2
    ✗ append refused: phase-04 plans src/app/other.ts, outside the run footprint (R2)          $? = 2
    ✗ append refused: phase-04 plans tests/prune.test.ts, an oracle file (R4)                  $? = 2
    Other exits are as for `phax run`: 3 unsafe git state · 4 gate failure · 5 agent error · 7 lock conflict · 8 rate/usage limit

### config: phax.json review.code.{enabled,append,maxPasses} — normative

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
        "append": true,      // machine-approve (grant review.code.append) and append each pass's review plan…
        "maxPasses": 2,      // …at most this many times, re-reviewing after each (1–5, default 1)
        "model": "claude-opus-5-5", "effort": "high"
      }
    }
    // all keys optional; enabled and append default to false; append requires enabled (else exit 2)

### config: phax.json review.code.{doctrine,minSeverity} — indicative

before:

    "code": { "model": "claude-opus-5-5", "effort": "high" }

after:

    "code": {
      "enabled": true,
      "doctrine": "docs/review-doctrine.md",   // default for --doctrine, appended after phax-decide-review
      "minSeverity": "concern",                 // default for --min-severity: bug | deviation | concern
      "model": "claude-opus-5-5", "effort": "high"
    }

### cli: phax artifact approve|status on a review plan — indicative

before:

    phax artifact status docs/plans/2609240900-usage-cli-plan.md
    Path:              docs/plans/2609240900-usage-cli-plan.md
    Kind:              plan
    Status:            Approved

after:

    phax artifact approve <run-dir>/review/pass-01/review-plan.md [--machine <grant>]
    Status:   Approved
    Approver: operator (Ada Lovelace)
    Record:   <run-dir>/review/pass-01/pass.json

    phax artifact status <run-dir>/review/pass-01/review-plan.md
    Path:     <run-dir>/review/pass-01/review-plan.md
    Kind:     review-plan (run usage-cli, pass 1)
    Status:   Approved
    Approved: 2026-09-25 by machine (review.code.append)      # or: by operator (Ada Lovelace)
    Appended: phase-04..phase-05                               # or: not appended
    Findings: 4 considered — fixed 3 · escalated 1 (F2) · dismissed 0 · open 0

    # normative: that approve accepts a review plan, the --machine grant (per artifact-decide), and the approver kind and identity in status
    # indicative: layout and wording

### cli: phax ls review-pass report — indicative

before:

    phax ls --review-open
    usage-cli   review_open   …today's columns…

after:

    phax ls --review-open
    usage-cli   review_open   5 phases   passes 2 (last: clean, conformant) · fixed 3 · escalated 1 · dismissed 0 · open 0

    phax ls --json   # each run gains:
    "reviewPasses": [
      { "pass": 1, "outcome": "planned", "complianceVerdict": "conformant-with-deviations",
        "findings": { "bug": 1, "deviation": 2, "concern": 1, "info": 1 },
        "outcomes": { "fixed": 3, "escalated": 1, "dismissed": 0, "open": 0 } },
      { "pass": 2, "outcome": "clean", "complianceVerdict": "conformant",
        "findings": { "bug": 0, "deviation": 0, "concern": 0, "info": 1 },
        "outcomes": { "fixed": 0, "escalated": 0, "dismissed": 0, "open": 0 } }
    ]
    # open counts only non-info findings

### file: pr-body.md (the pull request description) — normative

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
    (the whole body is truncated from the tail past 60,000 bytes)

after:

    # PHAX Run Review Handoff

    Generated by PHAX.

    ## Review passes

    | Pass | bug | deviation | concern | info | Fixed | Escalated | Dismissed | Open | Compliance |
    |---|---|---|---|---|---|---|---|---|---|
    | 1 | 1 | 2 | 1 | 1 | 3 | 1 | 0 | 0 | conformant-with-deviations |
    | 2 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | conformant |

    ## Decisions

    | Source | Subject | Chosen | Abandoned | Why (principles) | Reversibility | Arbiter | Escalated |
    |---|---|---|---|---|---|---|---|
    | spec §9 Q1 | pruning manual or automatic | manual | auto | records keep the trajectory (S1, C4) | cheap | machine | no |
    | plan arbitration | per-run lock, not a global lock | — | — | — | — | — | no |
    | review pass 1 · F2 | registry entry without a worktree | dismiss (proposed) | fix, leave-open | not a deviation: spec §5.3 allows it (R3, C1) | cheap | machine | yes |

    # Run Review Handoff
    … (unchanged; the only part truncated past 60,000 bytes)

    # normative: the headings, the column sets and their order, and that open counts only non-info findings
    # indicative: cell wording
    # when the run has no pass and no recorded decision, both tables are omitted and the body is byte-identical to today's

## 7. Non-goals

- Stacked pull requests. The correction ships in the run's one PR. A second PR based on the first is set aside until a team must approve corrections separately.
- A `coverage` provider or any new review provider. The review uses the run's provider through the existing review session.
- The cockpit UI or any trajectory screen. This spec supplies the data a UI would render (pass records, finding outcomes, the two tables), and nothing more.
- Headless total mode. A machine never dismisses or leaves open a finding on its own: its proposal waits for an operator. The doctrines defer this mode.
- Appending an arbitrary plan. `--append` accepts only the current review plan of the run's latest pass.
- Appending to a published run, and updating an existing pull request's body.
- The oracle-separation `plans lint` rule and a per-phase diff budget. The append refusal uses the §9 Q5 identification until that lint exists.
- Writing or changing the doctrine skills' text, registering them in the skill catalog, and answering a spec's or plan's open questions. All three belong to the `artifact-decide` spec.
- Re-reviewing inside `review-plan`. The report is the judge, and the plan is its consequence.
- Verifying a fix with a model. `fixed` means committed by an appended phase, and a recurrence is a new finding in a later pass (§9 Q7).
- Detecting destructive changes at run time. The destructive floor applies to what the review plan declares.
- Any change to the interactive `review-code`, to the compliance review's document schema, or to `review-compliance` beyond judging appended phases against their own plan.
- Retrying a failed appended phase automatically. The loop stops, and a human resumes with `phax resume` and runs any later pass by hand.
- Autopilot beyond the bounded passes: no roadmap, no supervisor, and no budget other than `maxPasses`.
- Stability of `code-review.json`, `pass.json` and the review-plan document. They ship experimental, like the headless-authoring documents.

## 8. Acceptance criteria

### Headless review writes findings and stops

Given A `review_open` run `usage-cli` with no pass. Its compliance review has verdict `conformant-with-deviations` and one `deviation` finding on `phase-02`., when `phax review-code usage-cli --headless` runs, and the session returns a valid code-review document with two findings., then The provider was invoked without a terminal. The pass-1 `code-review.json` holds `F1` and `F2` (source `review`) and `C1` (source `compliance`, phase `phase-02`), all at outcome `open` with empty history. The run's records carry the file. No worktree file outside `.phax-context/` changed, and the run is still `review_open`. `code-review-session.json` names the session, and a later `phax review-code usage-cli` resumes it. The exit code is 0. (refs §5.1, §5.7, §5.5, §5.6)

### The review brief carries compliance and earlier outcomes

Given A run whose pass 1 ended with `F1` fixed, `F2` escalated and `F3` open, and whose latest compliance verdict is `conformant`., when `phax review-code <run> --headless` runs, and the session returns one finding., then The recorded session prompt contains the verdict `conformant` and lists `F1` fixed, `F2` escalated and `F3` open. The new finding is numbered `F4`, and it sits in the pass-2 `code-review.json`. (refs §5.2, §5.5)

### Invalid review opens no pass

Given A headless review session that returns prose, and another that returns a finding with severity `style`., when Each session ends., then Each command exits 5. The second names `findings[0].severity`. No `code-review.json` exists for a new pass, and the run's pass count is unchanged. (refs §5.3, §5.4)

### Interactive review unchanged

Given A `review_open` run., when `phax review-code <run>` runs without `--headless`., then The prompt file, the session record and the interactive provider invocation are identical to those produced before this change, and no pass is opened. (refs §5.8)

### Review plan from the report

Given A pass whose `code-review.json` holds `F1` (bug), `F2` (concern) and `F3` (info). The run has no review session record. A doctrine file `d.md` has a list item that opens with `X1`., when `phax review-plan <run> --headless --doctrine d.md --min-severity concern` runs, and the session returns a document where `phase-04` names `F1` and a decision dismisses `F2`, citing `X1` and carrying an escalation., then A new session was started. Its prompt contains the pass's `code-review.json`, then the `phax-decide-review` skill text, then `d.md`. `review-plan.json` and a Draft `review-plan.md` exist for the pass. `F3` appears only in the handoff note. `F2`'s history holds the machine decision and its outcome is `escalated`, not `dismissed`. `F1` stays `open`. The exit code is 0. (refs §5.10, §5.11, §5.12, §5.14, §5.23, §5.25, §5.17)

### The review session is resumed

Given A run whose review session record names session `S`., when `phax review-plan <run> --headless` runs., then The provider invocation resumes session `S` and starts no new session. (refs §5.10)

### A project skill replaces the default

Given A project-scoped `phax-decide-review` skill whose text differs from the bundled one, and `review.code.doctrine` set to `docs/review-doctrine.md`., when `phax review-plan <run> --headless` runs without `--doctrine`., then The session prompt contains the project skill's text followed by `docs/review-doctrine.md`, and it does not contain the bundled skill's text. (refs §5.11, §5.12)

### Review-plan refusals

Given In turn: a run in state `failed`; a `review_open` run with no pass; a run whose latest pass's review plan is already appended; and a `--doctrine` path that does not exist., when `phax review-plan <run> --headless` runs on each., then Each run exits 1 naming the condition, and no provider session is spawned. (refs §5.9)

### Threshold resolution

Given A pass with one `bug`, one `deviation` and one `concern` finding., when `phax review-plan <run> --headless` runs three times: with `--min-severity deviation`; with no flag and `review.code.minSeverity: "bug"`; and with neither., then The findings under consideration are {bug, deviation}, then {bug}, then all three. Every other finding appears in the handoff note and stays `open`. (refs §5.13, §5.14)

### Every finding under consideration is fixed or decided once

Given A session that returns a review plan in which finding `F1` (bug) is named by neither a phase nor a decision. Other sessions name it in two phases, or in a phase and a decision., when Each session ends., then Each command exits 5 naming `F1`. No `review-plan.json` or `review-plan.md` exists for the pass, and no finding's outcome or history changed. (refs §5.16, §5.15, §5.21)

### A machine never settles a finding it does not fix

Given Four headless review-plan documents: one with a decision `dismiss` whose `escalate` is null; one whose decision cites `R9`, which no loaded doctrine defines; one whose decision lists `abandoned: ["fix"]`; and one whose decision escalates a dismissal of `F2`., when Each session ends., then The first three exit 5, naming the violating path, and write nothing. The fourth lands with `F2` at outcome `escalated`. (refs §5.18, §5.17, §5.21)

### Destructive work stops

Given A review-plan document with a phase rated `irreversible`, and another with a decision rated `irreversible` that carries an escalation., when Each session ends., then The first exits 5 naming `phases[0].reversibility`, and nothing is written. The second lands, with its finding `escalated`. (refs §5.20)

### Phases continue the run's numbering

Given A run with phases `phase-01` to `phase-03`., when `phax review-plan <run> --headless` emits a two-phase plan., then The plan's phases are `phase-04` and `phase-05`. (refs §5.22)

### The review plan is never re-extracted

Given A review plan that has just been materialised., when `phax plans lint` reads `review-plan.md`, and then `phax run <run> --append --plan <review-plan.md>` reads it., then Lint reports no structure error. Rendering the same document twice yields identical Markdown. The structured plan equals the projection in `review-plan.json`. No extraction session is spawned. The run's records carry `review-plan.json`, `review-plan.md` and the session record. (refs §5.23, §5.15)

### Every finding decided, nothing to fix

Given A pass with two `bug` findings., when The headless review-plan session returns a document with no phase and an escalated decision for each finding., then `review-plan.json` exists for the pass and `review-plan.md` does not. `pass.json` records outcome `no-fix`, both findings are `escalated`, and the exit code is 0. (refs §5.24, §5.25)

### An unappended plan is replaced

Given A pass whose Approved review plan has not been appended., when `phax review-plan <run>` lands a new document for the same pass., then `review-plan.md` and `review-plan.json` hold the new plan as Draft. The approval in `pass.json` is null. The replaced plan remains in the run's records, and every finding's earlier history entries are kept. (refs §5.26)

### No plan on a divergent verdict

Given A run whose latest compliance verdict is `divergent`., when `phax review-plan <run> --headless` runs., then No provider session is spawned and no review plan exists for the pass. The outcome in `pass.json` is `blocked-divergent`, and the exit code is 1. (refs §5.27)

### Clean pass emits no plan

Given A pass whose findings are all `info`., when `phax review-plan <run> --headless` runs., then No session is spawned and no review plan exists. The outcome in `pass.json` is `clean`, and the exit code is 0. (refs §5.28)

### Interactive review-plan settles an escalation

Given A run whose pass-1 `F2` is escalated with a dismissal proposal, and whose pass 2 has `F5` (bug), open., when `phax review-plan <run>` runs without `--headless`, and the operator confirms dismissing `F2` and plans `F5`. Separately, an interactive document carrying an escalation is returned., then The interactive session resumed the review session. It presented `F5` first, then `F2` with its proposal. `F2`'s outcome in the pass-1 `code-review.json` is `dismissed`, and its latest history entry names the operator by Git identity. `F5` is named by a phase. `pass.json` records mode `interactive`. The document carrying an escalation is rejected with exit 5. (refs §5.29, §5.30, §5.25, §5.19)

### Append continues the same run

Given A `review_open` run `usage-cli` with `phase-01`..`phase-03`, a commit added on `phax/usage-cli--phase-03` during review, and an Approved pass-1 review plan with `phase-04` and `phase-05`., when `phax run usage-cli --append --plan <review-plan.md>` runs to completion., then The run state goes `review_open` → `running` → `review_open`. `phax/usage-cli--phase-04` descends from the tip of `phax/usage-cli--phase-03`, including the review commit, and `phase-05` descends from `phase-04`. The run id is unchanged, and the records for `phase-04` and `phase-05` sit under that id. `phase-03` is no longer `review_open`, and `phase-05` is the kept-open final phase. (refs §5.31, §5.32, §5.33, §5.34)

### Appended phases are ordinary phases

Given An appended phase whose gate stays red after the fix loop., when `phax run <run> --append --plan <review-plan.md>` runs., then It exits 4 and the run is `failed`. The findings that phase names stay `open`. `phax resume <run>` resumes at that appended phase. (refs §5.35, §5.36)

### Fixed means committed

Given An Approved pass-1 plan whose `phase-04` names `F1` and `C1` and whose `phase-05` names `F3`., when The append completes both phases., then `F1`, `C1` and `F3` have outcome `fixed` in the pass-1 `code-review.json`, and `pass.json` lists `phase-04` and `phase-05` as appended. (refs §5.36)

### The whole run is regenerated and judged

Given A run after a completed append of `phase-04`..`phase-05`., when The append finishes, and then `phax review-compliance <run>` runs., then `review-handoff.md` and the global file reconciliation cover `phase-01`..`phase-05` and the files of both plans. The compliance review judges `phase-04` and `phase-05` against the review plan, and `phase-01`..`phase-03` against the original plan. (refs §5.37, §5.38)

### Append refusals

Given In turn: a review plan in Draft; a run in state `failed`; a run with a recorded pull request; the pass-1 plan when pass 2 exists; and a plan starting at `phase-04` on a run whose last phase is `phase-05`., when `phax run <run> --append --plan <plan>` runs on each., then The runs exit 12, 1, 1, 2 and 2 respectively, each naming the condition. No worktree or branch is created, and the run's state is unchanged. (refs §5.39, §5.40, §5.41, §5.42)

### Footprint and oracle refusals

Given An Approved review plan whose `phase-04` plans either `src/app/other.ts` (named by no finding and by no plan of the run) or `tests/prune.test.ts`., when `phax run <run> --append --plan <plan>` runs., then It exits 2, naming `phase-04`, the file, and `R2` or `R4`. No worktree is created, and the run stays `review_open`. (refs §5.43, §5.44)

### Approval names its approver and stays with the run

Given A Draft pass-1 review plan., when `phax artifact approve <review-plan.md> --machine steme-conductor` runs, and separately the same command runs without `--machine` on a fresh copy., then `pass.json` records `approvedBy` as `{ kind: machine, grant: steme-conductor }` in the first case and as `{ kind: operator, name: <git user.name> }` in the second. `docs/plans/approvals.json` is unchanged, and no commit is made on the checkout. (refs §5.45)

### Escalations do not block the fixes

Given A review plan with one phase and one escalated decision., when `phax artifact approve` runs on it, and then `phax run <run> --append --plan <plan>` runs., then Both succeed. The escalated finding stays `escalated`, and the append output names it. (refs §5.46)

### Enabled review leaves the pass for a human

Given `review.code.enabled: true` with `review.code.append` absent, compliance enabled, and a plan whose run produces a `bug` finding., when `phax run <plan>` completes its phases., then The run is `review_open`. Pass 1 has `compliance-review.json`, `code-review.json`, `review-plan.json` and a Draft `review-plan.md`. No phase was appended. The recorded timestamps show the compliance review before the code review, and the code review before the review plan. (refs §5.47, §5.53)

### Bounded automatic passes

Given `review.code.enabled: true`, `append: true`, `maxPasses: 2`, and a review that reports a `bug` on every pass., when `phax run <plan>` runs., then The plans of passes 1 and 2 are appended. Pass 3 is reviewed, and its plan is left Draft and unappended. The run ends `review_open`. Each pass ran the compliance review, then the code review, then the review plan. The approvals of passes 1 and 2 are recorded as `{ kind: machine, grant: review.code.append }`. (refs §5.48, §5.50, §5.53)

### The loop stops early

Given `review.code.enabled: true`, `append: true` and `maxPasses: 2`., when In separate runs, pass 1 reports only `info` findings; pass 1's compliance verdict is `divergent`; every pass-1 finding is escalated; or pass 1's appended phase fails its gates., then No further pass runs in any case. The first three runs end `review_open` with pass-1 outcome `clean`, `blocked-divergent` and `no-fix` respectively. The fourth run is `failed`. (refs §5.49)

### Config defaults and validation

Given In turn: a `phax.json` without `review.code.enabled`, `append` or `maxPasses`; one with `append: true` and no `enabled`; and one with `maxPasses: 0`., when `phax run` loads each., then The first behaves as before this change and produces no pass. The second and third fail config loading with exit 2, naming `review.code.append` and `review.code.maxPasses` respectively. (refs §5.51, §5.52)

### Passes are visible

Given A run with two passes, the last `clean` with compliance `conformant`. Pass 1's plan was machine-approved and appended as `phase-04`..`phase-05`, fixing 3 findings, with 1 escalated., when `phax ls`, `phax ls --json` and `phax artifact status <pass-1 review-plan.md>` run., then `phax ls` shows 2 passes, `clean` and `conformant` for the last one, and fixed 3, escalated 1, dismissed 0 and open 0. `phax ls --json` carries one `reviewPasses` entry per pass. `artifact status` reports the run, pass 1, Approved, approver `machine (review.code.append)`, `phase-04`..`phase-05`, and the outcome counts. (refs §5.54, §5.55)

### The PR opens on the trajectory

Given A `review_open` run with two passes, one escalated finding and one dismissed finding, whose source spec has one decided question., when `phax publish-pr <run>` creates the pull request., then `pr-body.md` puts `## Review passes` before the run review handoff, with two rows whose counts equal those derived from the pass documents, including the Dismissed column. It then puts `## Decisions`, with one spec row and two review rows, each naming its arbiter and principles. (refs §5.56, §5.57, §5.58)

### Truncation spares the tables

Given The same run, with a handoff larger than 60,000 bytes., when `phax publish-pr <run>` builds the body., then The body is at most 60,000 bytes and contains both tables whole. The truncation note follows the truncated handoff. (refs §5.59)

### No trajectory, no change

Given A run with no pass and no recorded decision., when `phax publish-pr <run>` builds the body., then `pr-body.md` is byte-identical to the body built before this change. (refs §5.60)

## 9. Open questions for implementation planning

### Q1 — Do `info` findings accumulate across passes in the handoff note?

- Each pass lists its own info findings in its own handoff note — abandons: A single list the human reads once: the same style note repeats on every pass
- One handoff note, deduplicated by file and message across passes, each entry tagged with the first pass that raised it (doctrine R7) — abandons: Seeing directly that a later pass still raised the note
- Only the last pass's info findings — abandons: Earlier passes' style notes, which vanish silently, against R6 and R7

Recommendation: One handoff note, deduplicated by file and message across passes, each entry tagged with the first pass that raised it (doctrine R7) — R7 already states this, and a human reads style notes once (C5: minimal where a human reads). The per-pass info count stays in the review-passes table, so nothing is hidden (E0).

### Q2 — How is a decision request raised inside an appended phase attributed?

- Like any phase: by run id plus phase id. The pass and finding ids are derived from `pass.json` and the phase's `findings` — abandons: Reading the pass and finding ids in the request itself, without a lookup
- Add the pass and finding ids to the decision-request record — abandons: An unchanged spec 23 record: a persisted format gains a required field
- Attribute it to the review plan as an artifact-level question — abandons: Answering the request in its phase's context and resuming the phase from it

Recommendation: Like any phase: by run id plus phase id. The pass and finding ids are derived from `pass.json` and the phase's `findings` — Phase ids are unique within a run, and `pass.json` plus the review plan map every appended phase to its pass and findings. The attribution can therefore be derived without touching a persisted format (C1: the existing record before a new one).

### Q3 — May `review-plan` run interactively on a run whose review was headless?

- Yes, resuming the headless review session in a terminal — abandons: A machine-only transcript for a session the loop started: the records mix machine and human turns
- Yes, in a fresh session given `code-review.json` — abandons: The review's memory of why each finding was raised, which is exactly what settling an escalation needs
- No — abandons: The only way an operator settles an escalated finding or takes over a pass the loop left unappended

Recommendation: Yes, resuming the headless review session in a terminal — Interactive review-plan is where escalations get settled and where a human takes over after the bound. Both need the review's memory. `pass.json` records `mode: interactive`, and each decision names its arbiter, so the mixed transcript stays attributable (E0).

### Q4 — Where is a review plan's approval recorded, and how is a machine approval marked?

- `phax artifact approve` accepts the review plan in the run directory. `approvedBy` is recorded in `pass.json` in the artifact-decide form: `{ kind: machine, grant }` from `--machine`, or grant `review.code.append` for the loop, or `{ kind: operator, name }` — abandons: A single approvals ledger in the repository: review-plan approvals live with the run and its records, not in `docs/plans/approvals.json`
- Commit the review plan under `docs/plans/` on the run branch and approve it like any plan — abandons: A run branch that carries only the work: every pass adds bookkeeping to the PR, and the approval commit must land on the run branch rather than the checkout
- No separate approval: invoking `run --append` is the approval — abandons: The 'plan not Approved' refusal, and a machine approval that can be told apart from an operator's

Recommendation: `phax artifact approve` accepts the review plan in the run directory. `approvedBy` is recorded in `pass.json` in the artifact-decide form: `{ kind: machine, grant }` from `--machine`, or grant `review.code.append` for the loop, or `{ kind: operator, name }` — The review plan is the run's own consequence, and only `--append` on that run consumes it. Keeping its approval with the run leaves the repository ledger for plans a human authored. The approve verb and the approver form stay those of `artifact-decide` (C1), so a machine approval is always marked (E0).

### Q5 — How does `--append` identify oracle files before the oracle-separation lint exists?

- A built-in convention (`*.test.*`, `*.spec.*`, files under `tests/` or `__fixtures__/`), replaced by the lint when it lands — abandons: Oracles outside the convention (matrices, fixtures elsewhere), which only compliance guards until the lint lands
- No refusal until the lint exists; compliance alone checks R4 — abandons: The mechanical guarantee that a fix never edits what judges it, which the first consumer relies on from its first pass
- A declared glob list in `phax.json` (`review.code.oracles`) — abandons: Zero configuration: it adds one more config key right before the 1.0 freeze, which the lint would then duplicate

Recommendation: A built-in convention (`*.test.*`, `*.spec.*`, files under `tests/` or `__fixtures__/`), replaced by the lint when it lands — The convention covers the common case mechanically today (C4: a condition the system verifies), and compliance catches the rest. The lint replaces the convention without any change to the surface.

### Q6 — Does an escalated finding block approval and append of the review plan that carries it?

- No: the plan is approved and appended, and the escalation is reported in the output, `phax ls`, `artifact status` and the PR's decisions table — abandons: A human seeing each escalation before the pass's fixes land
- Yes, as `artifact-decide` blocks approval of an artifact with escalated questions — abandons: An unattended loop: a single escalated finding stalls every fix of its pass until a human answers

Recommendation: No: the plan is approved and appended, and the escalation is reported in the output, `phax ls`, `artifact status` and the PR's decisions table — An escalated question in a spec blocks approval because the artifact's content depends on the answer. A review plan's phases do not depend on the findings it does not fix: R5 groups by cause, and each fix stands alone. The escalations stay visible and counted (R6), and the human who approves the PR reads them first.

### Q7 — When is a finding `fixed`?

- When an appended phase naming it reaches `committed`. The next pass's brief lists it as fixed, and a recurrence is a new finding — abandons: Verified-fix semantics: a `fixed` count can include a fix that the next review would re-raise as a new finding
- Only when the next pass's review does not re-raise it — abandons: Determinism and the last pass: the outcome depends on a model's re-judgement, and after the bound a fix is never confirmed

Recommendation: When an appended phase naming it reaches `committed`. The next pass's brief lists it as fixed, and a recurrence is a new finding — `committed` is a condition phax verifies itself (C4), with no model call. The next pass sees prior outcomes in its brief and reports what still fails as a new finding, so a false `fixed` stays visible in the review-passes table instead of being hidden.

## 10. Implementation-planning note

Settled:

- Two modes only, interactive and headless. Headless total is out.
- `review-code --headless` writes findings and stops. It is the same session as the interactive command, and the interactive `review-code` is untouched.
- `review-plan` (headless or interactive) turns a pass's findings into a review plan under `phax-decide-review` plus the caller's doctrine file.
- phax assigns finding ids (run-unique `F<n>` / `C<n>`), outcomes and history. The agent emits neither.
- Compliance `deviation` findings join a pass's `code-review.json` as their own variant.
- Each finding under consideration is named by exactly one phase or one decision. A decision chooses `dismiss` or `leave-open`.
- A headless decision always escalates, so a machine never settles a finding it does not fix. An operator decision never escalates.
- Outcomes are `fixed` | `open` | `dismissed` | `escalated`, and decision history is append-only.
- Reversibility: phases are `cheap` or `costly` and never `irreversible`. An `irreversible` decision must escalate.
- No session on a `divergent` verdict (exit 1, `blocked-divergent`) or on a clean pass (exit 0, `clean`). A plan with no phase is `no-fix`.
- `--append` is a flag on the existing `phax run [short-name] --plan <path>` grammar, not the brief's positional sketch. It is the new transition `review_open → running`: appended phases are numbered after the run, worktrees chain from the previous tip, the run id and records lineage stay the same, the previous final phase is closed, the whole run is regenerated, and there is one PR.
- `--append` has six pre-start refusals with named exit families.
- `review.code.enabled` / `append` / `maxPasses` default to false / false / 1. `maxPasses` is 1–5 and `append` requires `enabled`. The loop stops on `clean`, `no-fix`, `blocked-divergent`, a failed append, or the bound.
- The pass order is compliance, then code review, then review plan.
- The PR body puts the review-passes table and then the decisions table first. They are never truncated, and the body is unchanged for a run with no pass and no recorded decision.

Left open:

- Q1–Q7 carry recommended defaults. Arbitrate them before approval.
- Cell wording of both tables, output layouts, the run-directory layout (`review/pass-NN/`), the spelling of the indicative `doctrine` / `minSeverity` keys, and the nested spellings of history entries.
- How the interactive `review-plan` session hands its document back to phax. A phax-named file under `.phax-context/`, as compliance does, is the obvious route, and it must match whatever `artifact-decide` chooses for its interactive decisions.
- The steme protocol (§3.2, §5.6, §5.7, §6, §12.3) and steme-lab's `phax.schema.json` could not be read in the authoring session (permission denied). The review config shape was taken from `src/schemas/phaxConfig.ts`. A reviewer should check the pass order, the bound semantics (appends ≤ `maxPasses`, then one final review) and the exit families against protocol §5.6/§5.7.

Constraints:

- Compose the headless-authoring machinery: the JSON-only session, boundary decoding, the deterministic renderer, the cache seed, the session record and the records writer. Do not fork it. The review plan's phase projection must be the extracted-plan schema itself.
- Add the `review_open → running` transition through the state reducer, and name and test it there. Appended phases reuse the existing phase lifecycle unchanged.
- Existing run-status and phase-status persisted formats gain no field. Pass data lives in new versioned documents (`code-review.json`, `pass.json`, `review-plan.json`) whose fields are all required, and a phase's origin is derived from them.
- The new `review.code` keys are optional at birth, so a `version: 1` config keeps loading. This is the same deliberate exception as the `authoring` keys, not a shim.
- `code-review.json`, `pass.json` and the review-plan document ship experimental, like the headless-authoring documents.
- Headless review and review-plan sessions run under the read-only review security posture and write nothing to the worktree outside `.phax-context/`.
- This spec depends on `artifact-decide` for the catalog registration of `phax-decide-review`, the project-skill override, principle-id collection, the decision shape and the approver form. Land it after that spec, or adopt that spec's forms unchanged. The decision checks here must accept exactly what the landed skill instructs, so change the schema and never the skill text.
- When the oracle-separation lint lands, it replaces the Q5 convention in the append refusal.
- Both PR tables are rendered from persisted data only (pass documents, spec sidecar histories, plan documents), with no model call.

## 11. Docs page

Page: docs/review-as-plan.md

Reader: An operator or loop author who wants phax to review its own run and fix what the review finds, through phases, before the PR is opened. They also need to see what a machine declined to fix, and why.

Example: Automatic: in `phax.json`, set "review": { "compliance": { "enabled": true }, "code": { "enabled": true, "append": true, "maxPasses": 2 } }. `phax run --plan <plan>` then ends `review_open` after at most two fix passes. `phax ls` shows fixed / escalated / dismissed / open counts, and `phax publish-pr usage-cli` opens on the review-passes and decisions tables. By hand:
1. `phax review-compliance usage-cli`
2. `phax review-code usage-cli --headless`
3. `phax review-plan usage-cli --headless --min-severity concern`
4. Read the plan, then `phax artifact approve <run-dir>/review/pass-01/review-plan.md`
5. `phax run usage-cli --append --plan <run-dir>/review/pass-01/review-plan.md`
6. `phax review-plan usage-cli` (interactive) to settle escalations, then repeat or `phax publish-pr usage-cli`.
