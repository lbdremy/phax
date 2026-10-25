---
status: Draft
date: 2026-09-25
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---
# Review as a plan — headless code review, review-plan, run --append

## 1. Context

`phax review-code <run>` opens an interactive, pre-prompted session in a `review_open` run's worktree. It resumes the session recorded in `code-review-session.json` unless `--new-session` is given, and the developer then takes over.

`phax review-compliance <run>` is its non-mutating, structured sibling. The review agent answers `{ version: 1, verdict: conformant | conformant-with-deviations | divergent, summary, perPhase[{ phaseId, verdict, findings[{ dimension, severity: info | deviation | concern, message }] }], attentionPoints, pointers }`, decoded strictly. phax persists it as `compliance-review.json`, `$schema` first and with no `version`, as it persists every format.

`phax.json` has `review.compliance.{enabled, model, effort}`. Under `review.code` it has only `{model, effort}`. The `publish` block is optional. When present, its `auto` key is required, and an absent block resolves to `auto: false`. With `auto` true, the run pushes its final branch and opens its PR once it is `review_open`.

A run lives in the local registry (`~/.phax/runs/`), outside Git. Its committed trace is the records branch `phax/records/v1`. `phax run [short-name] --plan <path>` gives each phase its own worktree on `phax/<slug>--phase-NN`. The last phase stays open in `review_open`, where manual fixes land as ordinary commits. The run states allow `running → review_open` and `review_open → archived`. Nothing returns a run to `running`.

The end of a run is, in order:
1. The final phase commits.
2. The run applies its run completion on the run branch (spec 27). Its plan goes Approved → Completed. Its source spec goes too, when the plan says `completes-spec: true` and the chain gate allows.
3. The run becomes `review_open`.
4. The compliance review runs, when enabled.
5. `publish.auto` publishes, when set.

Plan approval refuses a plan whose source spec is not Approved.

Runs stay autonomous (2026-10-10). A run never stops to wait for a person, and phase decision requests are parked unbuilt. Human input goes to the review notes.

Inside a phase worktree, the phase guard refuses `phax run`, `phax artifact approve`, `phax artifact abandon` and `phax artifact new plan`. Nothing an agent runs there moves a run or approves a plan.

Today's exit families:
- 2: plan or config validation
- 3: unsafe Git state
- 4: gate failure
- 5: agent error or rejected document
- 6: archive blocked by a dirty worktree
- 7: lock conflict
- 8: rate or usage limit
- 9: phase produced no changes
- 10: registry corruption
- 11: security or preflight refusal
- 12: artifact or approval refusal
- 1: anything else

`phax publish-pr` builds the short PR body of `src/domain/publish/prBody.ts` from the run's facts. It holds, in order:
- a summary: run, plan, gate profile, the source spec's outcome, phases passed, verified surfaces and compliance verdict;
- `## Phases`, one line per phase;
- `## Needs your review`: `### Compliance attention points` when the run was reviewed, then `### Unexplained deviations`;
- `## Review notes`, when there are notes;
- `## Full detail`, which points to `review-handoff.md`.

The handoff itself is not in the body. Over 60,000 bytes, the body cuts unexplained deviations, then attention points, then review notes; each cut run becomes one `- …and N more` line. The summary, the phase lines and Full detail are never cut. The body is built only when the PR is created: an existing PR for the branch is reused, not updated. Through `gh`, phax today only creates a PR ready for review. It never opens a draft, never marks a PR ready, and never edits a body. This spec adds those three GitHub operations, plus reading a PR's state (draft, ready, closed or merged): create a draft PR, mark a PR ready for review, and edit a PR's body.

Headless authoring set the pattern reused here. `phax artifact new plan <slug> --headless --brief <file> --spec <spec>` runs a session that returns only a schema-validated plan document. phax then:
- renders the Markdown deterministically;
- writes the document as the plan's JSON sidecar (`$schema` `plan-document`);
- seeds the extraction cache with the plan projection;
- commits with an `Authoring-Id` trailer;
- records the session.

`phax artifact approve`, `artifact status` and `artifact migrate-documents` decode that sidecar. They refuse a plan whose body diverges from its rendering.

The review doctrine landed by hand on 2026-09-25 as the skill `phax-decide-review`, now registered in the skill catalog. It holds principles `R1`–`R7` under the pairs `C1`–`C5` and the ground `E0`. Its headless sections still describe the earlier design: the agent decides within the menu, escalates the rest, and outputs `decisions[]` for the findings it escalates. Reversal is a cost: at equal value, the change that is cheaper to reverse is preferred, and a destructive change stops.

The `artifact-decide` spec (Completed, `docs/specs/archive/2610140742-artifact-decide.md`) shipped `phax artifact decide`, interactive only and Claude Code only. When the operator exits, phax resumes the session headless for the revised document and checks it. It then shows the body diff, and writes nothing unless the operator accepts it. It fixes three shapes this spec reuses:
- the decided verdict `{ kind: decided, chosen, abandoned[], why, advocate, principles[], reversibility: cheap | costly | irreversible, by: { kind: operator, name }, at, revised[] }`, stamped with the committing git identity and the time;
- principle ids, the backticked ids that open a doctrine's list items; a doctrine file that defines none, or redefines a skill id, is refused;
- the approver of `phax artifact approve --by operator | --by machine:<grant>`. The grant is a kebab-case slug, and the approver is recorded as `approvedBy` in the plan's approval record file, `docs/plans/approvals/<plan file stem>.json`. Without a terminal, approve refuses with exit 12 unless `--by` is given.

The first consumer is the steme roadmap-1.0 conductor. It is a loop with no developer at the terminal, and it allows at most two review passes.

Ground read:

- `docs/specs/archive/2609241219-headless-review.md` — The first draft, Abandoned 2026-09-25. I reused its structure. I replaced what the 2026-09-25 decisions change: findings can be dismissed and carry an outcome and a decision history across passes, there are two modes only, the doctrine skill has landed, and reversibility is a cost. I also corrected the `phax run` argument grammar.
- `docs/briefs/headless-review.md` — The brief, revised 2026-09-25. It covers dismissal as a decision, two modes, the landed review doctrine, reversibility as a cost, and the five open questions to arbitrate.
- `docs/ideas/headless-code-review.md` — The idea, revised 2026-09-24. Two commands (review-code --headless, review-plan --headless), run --append, review.code.{enabled,append,maxPasses}, the per-pass order, no plan on divergent, and the same PR (never stacked). Its PR body that opens on a decisions table predates the short body and the dropped decision class.
- `.claude/skills/phax-decide-review/SKILL.md` — The landed review doctrine: R1–R7 under the pairs C1–C5 and the ground E0. Its modes are interactive, headless and headless total (later). Its headless sections still describe propose-and-escalate and a `decisions[]` output for escalated findings, which this spec rewrites (§9 Q8). Reversal is a cost, with destruction as a floor. It is registered in `src/domain/skills/catalog.ts`.
- `docs/specs/archive/2610140742-artifact-decide.md` — Completed. `phax artifact decide` is interactive only and Claude Code only. After the operator exits, the session is resumed headless for the revised document, and the operator accepts the body diff. It defines the decided verdict `{ kind: decided, chosen, abandoned[], why, advocate, principles[], reversibility, by: { kind: operator, name }, at, revised[] }` and principle-id collection. It refuses a doctrine file that defines no principle id or redefines a skill id. It also defines the approver form `--by operator | --by machine:<grant>`. It replaced the Abandoned draft `2609250815-artifact-decide`, whose machine decisions and escalation are gone.
- `docs/ideas/change-gates-from-the-harness.md` — The oracle-separation lint (an agent never edits what judges its work). x.ts / x.test.ts pairing is the cheap first convention, and a declared oracles concept comes later.
- `src/schemas/complianceReview.ts` — The shape to mirror. The agent answers `version: 1`, then a verdict (conformant | conformant-with-deviations | divergent) and perPhase findings { dimension, severity info | deviation | concern, message }, decoded strictly with excess properties rejected. phax persists `compliance-review.json` with `$schema` `compliance-review` and no `version`.
- `src/domain/state.ts` — RunState: created, running, failed, review_open, completed, stopped, archived, interrupted, rate_limited. Existing transitions include running → review_open and review_open | completed → archived. Nothing returns a run to running.
- `src/domain/publish/prBody.ts` — The short PR body (`buildShortPrBody`) holds a summary, `## Phases`, `## Needs your review` (compliance attention points, unexplained deviations), `## Review notes` and `## Full detail`, capped at 60,000 bytes (`PR_BODY_MAX_BYTES`). It cuts unexplained deviations, then attention points, then review notes. The summary, the phase lines and Full detail are never cut.
- `docs/specs/archive/2610100823-pr-description.md` — Completed. §5.1 says the body holds only its five sections; this spec amends it with a `### Review passes` subsection under `## Needs your review` for a run with a review pass.
- `src/app/publishRun.ts` — Reuse-or-create: an existing PR for the branch is reused, and its body is not rebuilt. The body is built only when a PR is created, from `loadReviewHandoffInputs` (global reconciliation, phase handoffs, `source-spec-outcome.md`, review notes) plus `compliance-review.json`.
- `src/app/resolveRunInfo.ts` — The run directory is <stateRoot>/runs/<key>, local and outside Git. It holds run-status.json, phax-plan.json, and one status.json per phase folder. The final phase is the highest-indexed one.
- `src/schemas/phaxConfig.ts` — review.compliance { enabled (required), model?, effort? } and review.code { model?, effort? } only. Effort is low | medium | high. The `publish` block is optional, its `auto` required when present, and `resolvePublishConfig` defaults an absent block to `auto: false`.
- `src/cli/commands/runLayers.ts` — Exit families: 2 plan/config validation, 3 unsafe git state, 4 gate failed, 5 agent error or rejected document, 6 archive blocked by a dirty worktree, 7 lock, 8 rate/usage limit, 9 phase produced no changes, 10 registry corruption, 11 security or preflight refusal, 12 artifact or approval refusal, 1 otherwise.
- `phax.usage.kdl` — `phax run [short-name] --plan <path>`, `review-code <short-name> [--new-session] [--model] [--effort]`, `publish-pr` (create or reuse), and `ls` filters. The registry is under ~/.phax/runs/.
- `NEXT_STEPS.md` — Lists headless-review under the steme experiment specs, after plan-estimate. It names the rework this revision does: the short PR body replaced the body this spec built on, and the decision class was dropped. The oracle-separation lint is what makes review-as-plan safe.
- `src/app/executePlan.ts` — The end of a run: run completion on the run branch (`completeRunArtifacts`), then `review_open`, then the compliance review when enabled (a failure is non-fatal: the run stays `review_open`), then `publish.auto` when set.
- `src/app/completeRunArtifacts.ts` — Run completion (spec 27). The plan goes Approved → Completed, and the source spec goes too when the plan says `completes-spec: true` and the chain gate allows. The chain gate (`findDependentPlans` in `src/app/artifactStatus.ts`) keeps the spec while another plan of it is still Approved. Committed on the run branch.
- `src/domain/security/phaseGuard.ts` — Inside a phase worktree, the guard refuses `run`, `artifact approve`, `artifact abandon`, `artifact new plan` and every other command that moves a run or an artifact.
- `src/domain/plan/lint.ts` — `lineageFindings` errors when a plan's slug differs from its source spec's. `sequenceGapFindings` errors on every id missing from phase-01 up to the highest phase.
- `src/schemas/artifactFrontmatter.ts` — Plan frontmatter has two variants: spec-less (`source-spec: null`), and spec-bound with a required `completes-spec`. Unknown keys are rejected.
- `src/schemas/planDocument.ts` — The plan document (`kind: plan`, `$schema` `plan-document`). Its fields: lineage (`sourceSpec`, `completesSpec`), `run`, a preamble with open and arbitrated questions, and phases with boundary contracts, implementation order, verification and expected handoff. Its projection is the extracted-plan schema.
- `src/schemas/approvedBy.ts` — The approver union: operator, machine (grant `^[a-z0-9]+(-[a-z0-9]+)*$`) and unattributed (records written before approvers were named).
- `src/schemas/schemaUrl.ts` — Every persisted format carries a `$schema` URL `<base>/<format-id>/<X.Y.Z>.json`. `code-review` is expected to join with this spec's plan.

## 2. Problem

A loop has no developer, so it cannot run the only code review phax offers. Two shortcuts both fail:
- Printing the prompt for an outside agent takes the review out of phax. There is no run directory, no records and no resumable session, and the findings come back as prose.
- Resuming the review session with "fix everything" puts changes into the run without phases. Those changes get no gate of their own, no handoff and no reconciliation, and the session is free to edit the test that judges it.

Fixes that follow a review must go through the same machinery as the implementation, but a run cannot grow. Once a run is `review_open` it runs no further phase, and a second run means a second PR and a second records lineage.

A finding the reviewer got wrong has no home either. It is either fixed anyway, which is a wrong change, or left open forever. Nothing records that someone judged it wrong, or why.

Nothing bounds or reports the review–fix loop. The PR body says what needs a person's review. It does not say whether the run converged under review, or what was deliberately left unfixed.

The run also completes its plan and its spec at its final phase, before any review. A plan of fixes written after that has no Approved spec to belong to.

## 3. Product goal

Make the code review a phax artifact, and make its consequence a phax plan.

A headless review writes structured findings and stops. `phax review-plan` turns them into a review plan in the phax-plan shape, following a doctrine and a threshold that the caller owns. Each finding under consideration is either fixed by a phase or decided by the operator: dismissed or left open; one a headless plan does not fix waits, `awaiting`, for that decision. `phax run --append` then executes the plan as more phases of the same run, with the same records and the same PR.

A config setting runs this as a bounded loop at the end of a run, before the run completes its plan and spec and before its PR is ready for review. While a review plan or a finding waits for the operator, the run's PR is a GitHub draft. The PR's `## Needs your review` then opens on the trajectory: the review passes, and the findings that wait for the operator or that the operator dismissed. Every change is additive to the CLI and to `phax.json`, and the interactive review is unchanged.

> A review changes code only through phases of the same run. A machine may fix a finding but never settles one it does not fix. Every finding ends fixed, open, dismissed or awaiting, and none is dropped.

## 4. Terminology

- **Pass** — One review round over a run, numbered from 1. A pass opens when a headless code review writes its `code-review.json`. It holds at most one current review plan. Its `code-review.json` and `pass.json` live under the run directory and in the run's records; its review plan lives under `docs/plans/` on the run branch (§9 Q4).
- **Finding** — One entry of a pass's `code-review.json`. It has one of two variants, by `source`. A review finding (`review`) has `severity`, `file`, `line` and `suggestion`. A compliance finding (`compliance`) is a `deviation` finding of the latest compliance review, with `phase` and `dimension`. Both carry `id`, `message`, `outcome` and `history`.
- **Finding id** — A run-unique id that phax assigns: `F<n>` for review findings and `C<n>` for compliance findings. Numbering continues from pass to pass.
- **Severity order** — `bug` > `deviation` > `concern` > `info`.
- **Threshold** — The lowest severity a pass considers for a fix: `bug`, `deviation` or `concern`. `info` is never considered.
- **Findings under consideration** — In headless mode: the latest pass's findings at or above the threshold whose outcome is `open`. In interactive mode: those findings plus every `awaiting` finding of the run.
- **Outcome** — A finding's current state:
  - `fixed`: a phase of an appended review plan names the finding and reached `committed`.
  - `awaiting`: a headless review plan left it unfixed; it waits for an operator decision. It carries no proposal.
  - `dismissed`: its last decision is an operator `dismiss`.
  - `open`: anything else. This covers undecided findings, findings planned but not yet committed, operator `leave-open` decisions, below-threshold findings and `info` findings.
- **Finding decision** — An operator's decision about a finding that no phase fixes, in the decided-verdict shape of `phax artifact decide` (`revised` is always empty for a finding). Its menu is `fix` | `dismiss` | `leave-open`: it chooses `dismiss` or `leave-open` and abandons the other two. A dismissal says why the finding is wrong. Decisions are made in interactive mode only, appended to the finding's `history`, and never rewritten.
- **Review doctrine** — The instructions a review-plan session follows: the `phax-decide-review` skill (a project-scoped skill of the same name replaces it), followed by the caller's doctrine file.
- **Review plan** — The plan a review-plan session emits for one pass. Its phases project to the extracted-plan schema and name the finding ids they fix. It also carries `decisions[]` (interactive only) and a handoff note. With at least one phase, phax writes it under `docs/plans/` on the run branch, as Markdown plus its sidecar: the plan document's `review-plan` variant. With no phase, phax writes no plan.
- **Pass outcome** — One of:
  - `reviewed`: the headless review wrote the pass's findings, and no review plan has landed yet.
  - `planned`: the review plan has phases.
  - `no-fix`: no finding under consideration was planned (each was decided in interactive mode, or left awaiting in headless mode).
  - `clean`: nothing was under consideration.
  - `blocked-divergent`: the latest compliance verdict is `divergent`.
  - `superseded`: a later pass opened while this pass's review plan was Draft, or Approved and not appended; that plan was abandoned.
  - `failed`: a step of the loop failed in this pass (compliance review, headless review, review plan, loop approval, or the push after an append).
- **Appended phase** — A phase executed by `phax run --append`. It is numbered after the run's existing phases, runs under the same run id, and has the origin `from review pass N`.
- **Run footprint** — The union of every file declared by any plan the run executed (to create, to edit, or optional), plus the files named by the findings under consideration.
- **Oracle file** — A file that judges the code a phase changes: a test, a fixture or a disposition matrix. `--append` does not identify oracle files; until the oracle-separation lint exists, the compliance review alone checks that a fix did not edit one (R4).
- **Reversibility** — The cost of undoing a change or a decision: `cheap` | `costly` | `irreversible`. A review-plan phase is never `irreversible`, because destructive work stops.
- **Machine approval** — An approval of a review plan whose `approvedBy` is `{ kind: machine, grant }`. It is recorded in the review plan's approval record file, `docs/plans/approvals/<plan file stem>.json`, on the run branch. The grant comes from `--by machine:<grant>`, or is `review-code-append` when the loop approves. An operator approval is `{ kind: operator, name }`.
- **Run completion** — The step of spec 27 that moves the run's plan, and its source spec when the plan completes it, to Completed on the run branch. With `review.code.enabled`, it runs when the run's PR becomes ready for review, after the last review pass, instead of at the final phase.
- **Run target** — `--run <run>` on `phax artifact approve`, `artifact status` and `plans lint`. The command reads and writes the plan in that run's final-phase worktree and commits on the run branch, from the checkout. `phax run <run> --append` targets its run by the positional name.
- **Draft PR** — A run's pull request opened as a GitHub draft because a review item is pending. It accepts appends, and after each one phax pushes the branch and rewrites the body, so the PR follows the run. `phax publish-pr` marks it ready for review once nothing is pending. A PR that is ready, closed or merged refuses appends. phax reads a PR's state live, through `gh`, whenever it needs it.
- **Pending review item** — Any of:
  - the latest pass's review plan, while Draft, or Approved and not appended;
  - a finding whose current outcome in its pass's `code-review.json` is `awaiting`;
  - a latest pass whose outcome is `reviewed` or `failed`.

  Only the latest pass's plan counts, because opening a pass supersedes the previous pass's pending plan. Any pending item keeps the run's PR a draft.
- **Loop trigger** — The end of the original `phax run --plan`, or of a `phax resume` of one of its original phases. Only a loop trigger starts review passes and `publish.auto`. An append, or a resume of an appended phase, starts neither.

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

WHEN the code-review document validates THE system SHALL open the next pass. It SHALL write the pass's `code-review.json`, with every finding at outcome `open`, and its `pass.json`, with outcome `reviewed`, mode `none` and threshold null, under the run directory and into the run's records. It SHALL then stop, leaving the review session resumable and the run `review_open`.

### 5.8 A new pass supersedes a pending plan

WHEN a pass opens while the previous pass's review plan is Draft, or Approved and not appended, THE system SHALL abandon that plan on the run branch, as a replaced plan is abandoned, and set the previous pass's outcome to `superseded`. That plan's findings keep their outcomes.

### 5.9 Review sessions write nothing outside .phax-context/

The system SHALL run headless review and review-plan sessions under the read-only review security posture. Their sessions SHALL change no file of the worktree outside `.phax-context/`; phax alone writes the pass documents and the review plan.

### 5.10 Interactive review-code unchanged

The system SHALL leave `phax review-code <run>` without `--headless` unchanged.

### 5.11 No pass on a completed run

IF the run has applied its run completion THEN `phax review-code --headless` SHALL refuse before any session, naming the completion and `review.code.enabled`, the setting that keeps a run open to review passes.

### 5.12 Review-plan preconditions

IF the run is not `review_open`, has no pass, has already appended its latest pass's review plan, or has applied its run completion, or the doctrine file is unreadable, defines no principle id or redefines a skill id, THEN `phax review-plan` SHALL refuse before any session, naming the condition.

### 5.13 review-plan is refused inside a phase worktree

IF `phax review-plan` runs inside a phase worktree THEN the phase guard SHALL refuse it, as it refuses `review-code`: the command moves a run's artifacts, so its class is refused.

### 5.14 Review-plan session continuity

WHEN `phax review-plan <run>` starts THE system SHALL resume the run's review session if its record exists, and otherwise start a new session from the latest pass's `code-review.json`.

### 5.15 Review doctrine skill

The system SHALL load the `phax-decide-review` doctrine skill into every review-plan session. A project-scoped skill of the same name SHALL take the bundled skill's place.

### 5.16 The review doctrine's headless mode plans fixes only

The bundled `phax-decide-review` skill SHALL instruct a headless session to plan fixes only and to leave unnamed every finding under consideration that it does not fix. Its headless sections SHALL carry no escalation, no proposal and no `decisions[]` output.

### 5.17 Caller doctrine appended

WHERE a doctrine file is given by `--doctrine`, or else by `review.code.doctrine`, THE system SHALL append its content after the doctrine skill in the session prompt.

### 5.18 Threshold resolution

The system SHALL consider for a fix only findings at or above the threshold. The threshold resolves from `--min-severity`, else `review.code.minSeverity`, else `concern`.

### 5.19 Info and below-threshold findings go to the handoff note

The system SHALL gather the `info` findings and the below-threshold findings of every pass into one handoff-note list for the run, deduplicated by file and message and tagged with no pass or phase, because the review judges the run's whole change set; it SHALL never put them in a phase or a decision.

### 5.20 JSON-only review plan

WHEN a review-plan session ends THE system SHALL accept as its result only a JSON review-plan document: `version: 1`, then the plan document's `review-plan` variant, whose phase projection is the extracted-plan schema.

### 5.21 Every finding under consideration is fixed or decided once

IF, in an interactive review-plan document, a finding under consideration is named by no phase and no decision, or by more than one; or, in a headless document, a finding is named by more than one phase; or a phase or decision names a finding not under consideration, THEN the system SHALL reject the review-plan document, naming the finding.

### 5.22 Finding decisions follow the menu and cite the doctrine

IF an operator decision does not choose `dismiss` or `leave-open`, does not abandon exactly the other two of `fix`, `dismiss` and `leave-open`, or cites a principle id that no loaded doctrine defines, THEN the system SHALL reject the review-plan document.

### 5.23 A headless plan decides nothing

IF a headless review-plan document carries any decision THEN the system SHALL reject the document: a finding it does not fix is left awaiting the operator.

### 5.24 Destructive work stops

IF a phase of the review plan is rated `irreversible` THEN the system SHALL reject the review-plan document.

### 5.25 An invalid review plan lands nothing

IF the review-plan result is not JSON, fails validation, or is rejected by any check in this section THEN the system SHALL fail in the agent-error exit family and name the first violation path. It SHALL write nothing and change no finding's outcome.

### 5.26 Phases continue the run's numbering

The system SHALL number the review plan's phases consecutively after the run's last phase.

### 5.27 Materialisation

WHEN a review-plan document with at least one phase validates THE system SHALL:
- render the review plan's Markdown deterministically, as Draft, with the review-plan frontmatter;
- write the document beside it as its sidecar, `$schema` `plan-document` first, `version` dropped and the `awaiting` findings added;
- commit both on the run branch, in the run's final-phase worktree;
- seed the extraction cache with its projection;
- record the session in the run's records;
- update the pass's `pass.json`: its outcome, the session's mode (`headless` or `interactive`), the resolved threshold and the plan's path.

### 5.28 Every finding decided, nothing to fix

WHEN a validated review-plan document has no phase THE system SHALL write no plan. It SHALL apply the document's decisions to the findings' histories, keep the session's answer in the run's records, and set the pass's outcome to `no-fix`, with its mode and threshold.

### 5.29 Decisions set outcomes

WHEN a review-plan document lands THE system SHALL set to `awaiting` every finding under consideration that a headless document leaves unnamed, append each operator decision to its finding's history, and set that finding's outcome to `dismissed` for `dismiss` and `open` for `leave-open`.

### 5.30 An unappended plan is replaced

WHEN `phax review-plan` lands a document for a pass that already has an unappended review plan THE system SHALL abandon that plan on the run branch, as `phax artifact abandon` does: moved to `docs/plans/archive/`, and its approval record file removed. It SHALL then land the new plan as Draft.

### 5.31 No plan on a divergent verdict

IF the run's latest compliance verdict is `divergent` THEN `phax review-plan` SHALL spawn no session, emit no plan, set the pass's outcome to `blocked-divergent` with mode `none` and the resolved threshold, and exit 1.

### 5.32 Clean pass

WHEN no finding is under consideration THE system SHALL spawn no session, emit no plan, and set the pass's outcome to `clean`, with mode `none` and the resolved threshold.

### 5.33 Interactive review-plan

WHERE `--headless` is not given to `phax review-plan <run>` THE system SHALL open the session interactively on Claude Code, with the operator deciding and the agent facilitating. When the operator exits, it SHALL, as `phax artifact decide` does:
- resume the session headless for the review-plan document;
- stamp each decision with the committing git identity and the time;
- validate and check the document exactly as in headless mode;
- show the rendered plan and the decisions;
- land nothing unless the operator accepts them.

### 5.34 Interactive review-plan needs a terminal and Claude Code

IF there is no terminal, or the run's review session runs on a provider other than Claude Code, THEN `phax review-plan` without `--headless` SHALL refuse before any session, naming the condition.

### 5.35 Awaiting findings come to the operator

WHEN an interactive review-plan session starts THE system SHALL present, after the latest pass's findings, every `awaiting` finding of the run.

### 5.36 The append transition

WHEN `phax run <run> --append --plan <review-plan.md>` is accepted THE system SHALL transition the run from `review_open` to `running` and execute the plan's phases after the run's existing phases.

### 5.37 Append reads the plan on the run branch

WHEN `phax run <run> --append --plan <path>` runs from the checkout THE system SHALL read the plan at `<path>` in the run's final-phase worktree, not in the checkout, and SHALL commit nothing on the checkout.

### 5.38 Worktree lineage

The system SHALL branch each appended phase's worktree from the tip of the preceding phase's branch. The first appended phase SHALL branch from the previously final phase's branch, including commits made during review.

### 5.39 Same run identity and records lineage

The system SHALL run appended phases under the run's id and slug and write their records into the run's records lineage.

### 5.40 Final-phase handover

WHEN an append starts THE system SHALL close the previously final phase the way a non-final phase is closed, and make the last appended phase the kept-open final phase.

### 5.41 Appended phases are ordinary phases

The system SHALL execute appended phases with the same lifecycle as any phase: gates, fix loop, rate-limit handling, failure and `phax resume`.

### 5.42 Fixed means committed by an appended phase

WHEN an appended phase reaches `committed` THE system SHALL set the outcome of every finding it names to `fixed`. It SHALL add the phase to the pass's `appendedPhases` in `pass.json`.

### 5.43 Whole-range regeneration

WHEN the appended phases complete THE system SHALL regenerate the global file reconciliation and `review-handoff.md` over every phase of the run and return the run to `review_open`.

### 5.44 Compliance per originating plan

WHEN a compliance review runs on a run with appended phases THE system SHALL judge each phase against the plan that planned it.

### 5.45 Refuse an unapproved plan

IF the review plan is not Approved on the run branch THEN `phax run --append` SHALL refuse in the approval-refusal exit family before any phase starts, creating nothing and leaving the run's state unchanged.

### 5.46 Refuse a run that is not review_open

IF the run is not `review_open` THEN `phax run --append` SHALL refuse with exit 1 before any phase starts, creating nothing and leaving the run's state unchanged.

### 5.47 Refuse a run whose PR is not a draft

IF the run's pull request is ready for review, closed or merged THEN `phax run --append` SHALL refuse with exit 1 before any phase starts, naming the PR's state, creating nothing and leaving the run's state unchanged. A draft PR SHALL NOT refuse the append.

### 5.48 A draft PR follows the append

WHEN an append ends on a run whose pull request is a draft THE system SHALL push the run's final branch and rewrite the draft PR's body, so the PR shows the appended phases and the current review passes.

### 5.49 An append triggers no loop

The system SHALL start no review pass and no `publish.auto` at the end of an append, or of a `phax resume` of an appended phase. Only a loop trigger starts them.

### 5.50 Refuse a stale or foreign plan

IF the plan is not the current review plan of the run's latest pass, or its first phase does not follow the run's last phase, THEN `phax run --append` SHALL refuse in the plan-validation exit family before any phase starts.

### 5.51 Refuse files outside the run footprint

IF a phase of the review plan plans a file outside the run footprint THEN `phax run --append` SHALL refuse in the plan-validation exit family before any phase starts, naming the phase, the file and `R2`.

### 5.52 The review plan is a plan of the run branch

WHEN a review-plan session lands a plan with phases THE system SHALL name it `<YYMMDDHHMM>-<slug>-review-NN-plan.md`. The slug is the run's source spec's, or the run's short name for a run with no source spec, and NN is the pass. The system SHALL write the plan and its sidecar under `docs/plans/` in the run's final-phase worktree and commit them on the run branch.

### 5.53 The review-plan frontmatter variant

The system SHALL give a review plan a review-plan frontmatter, in one of two shapes:
- spec-bound: `status`, `source-spec` (the run's source spec), `completes-spec: false`, `review-run` (the run's short name) and `review-pass` (the pass number);
- spec-less, for a run with no source spec: `status`, `source-spec: null`, `review-run` and `review-pass`, with no `completes-spec` key.

Every listed key is required in its shape, and unknown keys are rejected. The sidecar's `completesSpec` is `false` beside a `sourceSpec` path and null beside null.

### 5.54 Lint accepts a review plan's name and numbering

WHEN `phax plans lint` reads a plan with the review-plan frontmatter THE system SHALL accept two departures, and apply every other check unchanged:
- a slug equal to the source spec's slug (or the run's short name), followed by `-review-NN` with NN its `review-pass`;
- a first phase numbered above `phase-01`, provided the phases are consecutive from it.

### 5.55 Review-plan approval targets the run

WHEN `phax artifact approve <review plan> --run <run> --by …` runs from the checkout THE system SHALL approve the plan in the run's final-phase worktree, through the ordinary plan approval. It SHALL write the approval record file `docs/plans/approvals/<plan file stem>.json` there, with `approvedBy` `{ kind: machine, grant }` for `--by machine:<grant>` or the operator for `--by operator`. It SHALL commit on the run branch and never on the checkout. The same `--run` target SHALL apply to `phax artifact status` and `phax plans lint`, which read the plan and its working tree in the run's final-phase worktree. The phase guard is unchanged: these commands still refuse inside a phase worktree.

### 5.56 A review plan is reached only through its run

IF `--run` names no run, a run that is not `review_open`, or a run of which the path is not a review plan, or IF a review plan's path is given to `phax artifact approve`, `artifact status` or `plans lint` without `--run`, THEN the command SHALL refuse before anything is written, naming `--run <run>` when it is missing. approve and status refuse in the approval-refusal exit family (12), and lint exits 1.

### 5.57 An awaiting finding blocks the review plan

IF a finding the review plan considered has the current outcome `awaiting` in its pass's `code-review.json` THEN `phax artifact approve --run <run>` SHALL refuse the plan in the approval-refusal exit family (12), naming the awaiting findings and the interactive `phax review-plan <run>` that decides them, and `phax run --append` SHALL refuse it as unapproved. The current outcome decides, not the sidecar's `awaiting` list.

### 5.58 review.code.enabled runs a pass

WHERE `review.code.enabled` is true THE system SHALL run one review pass at a loop trigger, once the run is `review_open` and before `publish.auto`, and leave the run `review_open` with the pass's artifacts.

### 5.59 review.code.append loops

WHERE `review.code.append` is true THE system SHALL approve each pass's review plan as a machine approval with the grant `review-code-append`, append it, and then run the next pass.

### 5.60 The loop stops early

WHEN a pass's outcome is `clean`, `no-fix` or `blocked-divergent`, or its review plan leaves a finding awaiting, or an append leaves the run in a state other than `review_open`, THE system SHALL run no further pass; a plan that leaves a finding awaiting stays Draft and unappended, and the run stays `review_open`.

### 5.61 The pass bound

IF the run has `review.code.maxPasses` appended review plans, counting the passes of the run whether by hand or by the loop, THEN the loop SHALL run one final pass, leave that pass's review plan Draft and unappended, and leave the run `review_open`.

### 5.62 Defaults keep today's behavior

The system SHALL default `review.code.enabled` and `review.code.append` to false and `review.code.maxPasses` to 1, so that a `phax.json` without these keys loads and behaves as it does today.

### 5.63 Inconsistent review config rejected

IF `review.code.append` is true while `review.code.enabled` is not, or `review.code.maxPasses` is outside 1–5, THEN config loading SHALL fail in the config-validation exit family, naming the key.

### 5.64 End-of-run order

WHERE `review.code.enabled` is true THE system SHALL end a run, at a loop trigger, in this order:
1. the compliance review, when it is enabled;
2. the review passes;
3. `publish.auto`, when it is set: with nothing pending, the run completion and then a PR ready for review; otherwise a draft PR, and no completion.

With `publish.auto` unset, the run applies no completion until `phax publish-pr` makes its PR ready.

Each pass SHALL run the compliance review over the whole run when it is enabled (the first pass reuses the run's), then the headless code review, then the review plan, then, under `review.code.append`, its approval and append.

### 5.65 A failed loop step leaves the PR a draft

IF a step of the loop fails (a headless review or a review plan failing with exit 5 or 8, a loop approval refused, or the push after an append failing) THEN the system SHALL:
- run no further pass;
- set the pass's outcome to `failed`, naming the step and its exit;
- open the PR as a draft under `publish.auto`, with no completion;
- exit `phax run` in that failure's exit family.

A failed compliance review stays non-fatal, as today, and `phax run` exits 0. With `review.code.enabled`, it still sets the pass's outcome to `failed`: the run's PR never becomes ready on an unreviewed run. A `blocked-divergent` pass ends the loop with `phax run` exiting 0. It is not pending, and its verdict shows in the review passes.

### 5.66 A failed step is cleared by rerunning it

WHEN the step a `failed` pass names succeeds by hand THE system SHALL replace the pass's outcome:
- `phax review-compliance` or `phax review-code --headless`, which reopens that pass number, for a failed compliance review or headless review;
- `phax review-plan` for a failed review plan;
- `phax artifact approve --run` for a refused approval;
- `phax publish-pr` for a failed push.

### 5.67 Run completion waits for the review

WHERE `review.code.enabled` is true THE system SHALL defer the run completion from the final phase to the moment the run's PR becomes ready for review, so the plan and its source spec stay Approved while a pass can append. Only the step that makes the PR ready applies the completion, on the run branch, before the push and before the body is built: `publish.auto` with nothing pending, or `phax publish-pr`. A run whose PR never becomes ready keeps its plan and spec Approved, and so does a run stopped mid-loop.

### 5.68 Completion moves the review plans first

WHEN the run completion runs on a run with appended review plans THE system SHALL move to Completed, on the run branch:
1. each appended review plan of the run;
2. the run's plan;
3. the source spec, when the plan completes it.

The chain gate then finds no Approved plan of the spec left by the run. A review plan abandoned by replacement or supersession stays Abandoned.

### 5.69 A pending review item opens a draft PR

IF a review item is pending at the end of the loop and `publish.auto` is set THEN the system SHALL open the run's PR as a GitHub draft without applying the run completion, or, when the PR already is a draft, rewrite its body. The run SHALL stay `review_open`, and the body's `### Review passes` SHALL name each pending item.

### 5.70 Nothing pending, a ready PR

WHEN the loop ends with no pending review item and `publish.auto` is set THE system SHALL apply the run completion and then open the PR ready for review, as before this change. When the PR already is a draft, it SHALL apply the completion, push, rewrite the body and mark the PR ready.

### 5.71 publish-pr opens a draft while an item is pending

WHEN `phax publish-pr <run>` runs on a run with no pull request and a pending review item THE system SHALL open the PR as a draft without applying the run completion, as `publish.auto` does. With nothing pending, it SHALL apply the completion when it is deferred, and otherwise behave as today.

### 5.72 publish-pr keeps a draft while an item is pending

IF `phax publish-pr <run>` runs on a run whose pull request is a draft while a review item is pending THEN it SHALL refuse with exit 12, naming each pending item, and change nothing.

### 5.73 publish-pr marks a draft ready

WHEN `phax publish-pr <run>` runs on a run whose pull request is a draft, or ready for review with its run completion still deferred, and no review item is pending, THE system SHALL, in order:
1. apply the run completion on the run branch;
2. push the final branch;
3. rewrite the PR body, so the review passes are current;
4. mark the PR ready for review, when it is a draft.

A PR an operator marked ready by hand is thus completed and brought up to date.

### 5.74 publish-pr resumes where it stopped

IF a step of `phax publish-pr` (completion, push, body edit, mark-ready) fails THEN the command SHALL exit in that failure's exit family and leave the run `review_open`. Every step SHALL be idempotent, so a rerun skips what is done and resumes at the first step not done.

### 5.75 A closed or merged PR is refused

IF the run's pull request is closed or merged THEN `phax publish-pr` and `publish.auto` SHALL refuse with exit 12, naming the PR's state and the remedies: complete the artifacts by hand with `phax artifact complete`, or reopen the PR.

### 5.76 PR state is read live

The system SHALL read a run's PR state (draft, ready for review, closed, merged) from GitHub through `gh` each time it needs it: in append, publish-pr, publish.auto, `phax ls` and `artifact status`. It SHALL persist no PR state in run-status.

### 5.77 phax ls reports passes

WHEN `phax ls` lists a run with review passes THE system SHALL show:
- its pass count;
- its latest pass's outcome and compliance verdict;
- its findings' fixed, awaiting, dismissed and open counts.
- its PR's state, read at call time, and, for a draft, the pending review items that keep it so.

### 5.78 artifact status reports a review plan

WHEN `phax artifact status <review plan> --run <run>` inspects a review plan THE system SHALL report its run, pass, status, approver kind and identity, appended phases, and the outcome counts of the findings it considered. When the run's PR is a draft, it SHALL say so and name the pending review items that keep it so.

### 5.79 The review passes open what needs review

WHEN `phax publish-pr` builds the body for a run with at least one review pass THE system SHALL open `## Needs your review` with a `### Review passes` subsection, before the compliance attention points.

### 5.80 Review-passes subsection content

The `### Review passes` subsection SHALL hold one table row per pass, then one line per finding that is `awaiting` or `dismissed`. A row gives the pass's findings by severity, its fixed, awaiting, dismissed and open counts, and its compliance verdict. A finding line gives the finding's id, severity, location and message, and for a dismissed finding its arbiter and why. While the PR is a draft, the subsection SHALL open with one line saying that it is a draft and naming each pending review item.

### 5.81 The cut spares the review passes

IF the body exceeds the size cap THEN the system SHALL never cut the `### Review passes` subsection. It SHALL cut only the lists it cuts today, in today's order.

### 5.82 No pass, no change

WHILE a run has no review pass THE system SHALL build the PR body exactly as it does today.

## 6. Surface

### cli: phax review-code <run> --headless — normative

Summary: You can review a finished run's code without driving a session: phax prints the findings and keeps them with the run.

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

    Exit: 0 written · 1 run not review_open, or its run completion applied · 5 result not JSON or rejected · 8 rate/usage limit

### file: code-review document (the headless review session's final message) — normative

Summary: A headless review session answers with one versioned list of findings, each with a severity, a place and a suggestion, and phax refuses any other answer.

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
    # the session's answer carries `version: 1`, as every session answer does; the persisted code-review.json carries `$schema` instead
    # every key required; unknown keys rejected
    # severity: bug | deviation | concern | info; line: an integer >= 1, or null
    # the agent emits no ids and no outcome: phax assigns both

### file: code-review.json — normative

Summary: Each review pass leaves a findings file you can read or script against, giving each finding's id, severity and what became of it.

    # at <run-dir>/review/pass-01/code-review.json, also committed to the run's records
    # normative: file name, keys and enums. Indicative: directory layout.
    {
      "$schema": "https://docs.phax.run/schemas/code-review/<X.Y.Z>.json",
      "pass": 1,
      "findings": [
        { "id": "F1", "source": "review", "severity": "bug", "file": "src/app/prune.ts", "line": 42,
          "message": "…", "suggestion": "…", "outcome": "fixed", "history": [] },
        { "id": "F2", "source": "review", "severity": "deviation", "file": "src/app/prune.ts", "line": 88,
          "message": "a registry entry without a worktree is kept", "suggestion": "…", "outcome": "awaiting", "history": [] },
        { "id": "F4", "source": "review", "severity": "info", "file": "src/cli/commands/prune.ts", "line": null,
          "message": "…", "suggestion": "…", "outcome": "open", "history": [] },
        { "id": "C1", "source": "compliance", "severity": "deviation", "phase": "phase-02", "dimension": "tests",
          "message": "phase-02 planned a registry test it did not write", "outcome": "fixed", "history": [] }
      ]
    }
    # source: review | compliance, with per-variant keys: a compliance finding has phase and dimension, and no file, line or suggestion
    # outcome: fixed | open | dismissed | awaiting. It is written as open and updated only by phax (review-plan, append).
    # history: append-only operator decisions in the decided-verdict shape of `phax artifact decide`
    #   ({ kind: decided, chosen, abandoned, why, advocate, principles, reversibility, by: { kind: operator, name }, at, revised: [] })
    # $schema: the `code-review` format, registered and snapshotted like every persisted format
    # ids: run-unique F<n> and C<n>, with numbering continuing across passes

### cli: phax review-plan <run> — normative

Summary: You can turn a review's findings into a plan of fix phases, either headless or deciding each finding yourself with the agent.

    phax review-plan usage-cli --headless [--doctrine <file>] [--min-severity bug|deviation|concern] [--model <model>] [--effort <effort>]
    phax review-plan usage-cli [--doctrine <file>] [--min-severity …] [--model …] [--effort …]
      # interactive, Claude Code only: the operator decides, the agent facilitates; phax then resumes the
      # session headless for the document and lands it only when the operator accepts the rendered plan

    # normative: the command, the flags, the --min-severity values and the exit families. Indicative: output layout and wording.
    review-plan usage-cli — pass 1 — headless, resumed review session — claude-opus-5-5 / high
    doctrine   phax-decide-review (bundled) + docs/review-doctrine.md · threshold concern
    planned    F1, C1 → phase-04 (cheap) · F3 → phase-05 (cheap)
    awaiting   F2 — not fixed by this plan; decide it with `phax review-plan usage-cli`
    handoff    F4 (info)
    awaiting   1 of 4 under consideration — approval waits for it
    plan       docs/plans/2609251010-usage-cli-review-01-plan.md (Draft, on phax/usage-cli--phase-03)
    $? = 0

    review-plan usage-cli — pass 2 — clean: no open finding at or above concern
    $? = 0

    review-plan usage-cli — pass 1 — no-fix: nothing planned (awaiting 2)
    $? = 0

    ✗ review-plan refused: latest compliance verdict is divergent — no plan emitted (R1)
    $? = 1

    ✗ review-plan refused: run usage-cli has completed its plan and spec — set review.code.enabled to review before completion
    $? = 1

    ✗ review-plan failed: review-plan document rejected — decisions[0]: a headless review plan decides nothing (F2)
      nothing written; outcomes unchanged
    $? = 5

    Exit: 0 planned, no-fix or clean · 1 refused (run not review_open, no pass, latest plan already appended, run completion applied, divergent verdict, a doctrine file unreadable or defining no principle id or redefining a skill id, interactive without a terminal or on a provider other than Claude Code) · 5 result not JSON or rejected · 8 rate/usage limit

### file: review-plan document and the review plan's sidecar — normative

Summary: A review plan says which findings each fix phase addresses, which ones await your decision, and how cheap each fix is to undo.

    # the session's answer: `version: 1`, then the plan document's `review-plan` variant
    # phax writes it as the sidecar docs/plans/2609251010-usage-cli-review-01-plan.json on the run branch:
    #   `$schema` (the `plan-document` format) first, `version` dropped, `awaiting` added
    # normative: the variant's own keys (kind, review.*, phases[].findings, phases[].reversibility, decisions[], awaiting, handoffNote)
    #   and that every other key is the plan document's; the phase projection IS the extracted-plan schema
    # awaiting is a rendering of the outcomes when the plan landed; approval judges the findings' current outcomes
    # indicative: the prose fields' spelling
    {
      "version": 1,
      "kind": "review-plan",
      "sourceSpec": "docs/specs/2609240900-usage-cli.md",
      "completesSpec": false,
      "review": { "run": "usage-cli", "pass": 1, "minSeverity": "concern", "mode": "headless",
                  "doctrine": ["phax-decide-review", "docs/review-doctrine.md"] },
      "run": { "shortName": "usage-cli", "title": "usage-cli — review pass 1", "requiredCommands": [] },
      "preamble": { "summary": "…", "requiredCommandsNote": "…", "technicalArbitrations": [],
                    "openQuestions": [], "arbitratedQuestions": [] },
      "phases": [
        { "id": "phase-04", "title": "Guard prune against live worktrees", "findings": ["F1", "C1"],
          "reversibility": "cheap",
          "model": "claude-opus-5-5", "effort": "high", "planMarkdownAnchor": "#phase-04-guard-prune",
          "plannedFilesToCreate": [], "plannedFilesToEdit": ["src/app/prune.ts"], "optionalFilesToEdit": [],
          "commit": { "subject": "fix(prune): refuse a run with a live worktree", "body": "Addresses F1, C1." },
          "objective": "…", "detailedInstructions": ["…"], "boundaryContracts": null, "testStrategy": "…",
          "implementationOrder": ["…"], "excludedScope": ["…"], "verification": "…", "expectedHandoff": "…" }
      ],
      "decisions": [],
      "handoffNote": [ { "finding": "F4", "file": "src/cli/commands/prune.ts",
                         "message": "help text says 'remove', output says 'prune'" } ]
    }
    # kind: plan | review-plan — the plan document's two variants, decoded by the one plan-document decoder, so
    #   approve, status, the sync check and migrate-documents read a review plan's sidecar as any plan's
    # completesSpec: false beside a sourceSpec; sourceSpec null and completesSpec null for a run with no source spec,
    #   whose frontmatter then carries no completes-spec key
    # decisions: interactive only, exactly one per finding under consideration that no phase names; empty in a headless document
    #   each in the decided-verdict shape plus { finding }; chosen: dismiss | leave-open; abandoned: the other two of fix | dismiss | leave-open
    #   phax stamps by and at; the session emits neither
    # review: no run-directory path: the sidecar is committed to the repository, and the run and pass name the pass's documents
    # awaiting: absent from the answer; in the sidecar, [{ finding, severity, location, message }] for each finding a headless document leaves unnamed
    # phases[].reversibility: cheap | costly (irreversible is rejected: destructive work stops)
    # handoffNote: one entry per info or below-threshold finding of the run, deduplicated by file and message, no pass tag (Q1)
    # phases may be empty: pass outcome no-fix, and no plan is written

### file: the review plan's Markdown — indicative

Summary: You read a review plan like any other plan, with the findings it addresses and the ones awaiting you listed at the top.

    # docs/plans/2609251010-usage-cli-review-01-plan.md on the run branch, rendered from the sidecar and never written by the agent
    ---
    status: Draft
    source-spec: docs/specs/2609240900-usage-cli.md
    completes-spec: false
    review-run: usage-cli
    review-pass: 1
    ---
    # usage-cli — review pass 1

    …the phax-planning preamble…

    ## Review pass

    ### Findings addressed
    - phase-04: F1 (bug) src/app/prune.ts:42, C1 (deviation) phase-02 tests · reversibility cheap

    ### Findings awaiting the operator
    - F2 (deviation) — src/app/prune.ts:88 — not fixed by this plan; decide it with `phax review-plan usage-cli`

    ### Handoff note
    - F4 (info) src/cli/commands/prune.ts — help text says 'remove', output says 'prune'

    ## phase-04 — Guard prune against live worktrees {#phase-04-guard-prune}
    …the phax-planning phase fields…

    # normative: the frontmatter variant; the review sections sit in the preamble, before the first phase, so the
    # deterministic parser reads the phases unchanged; the file passes `phax plans lint --run usage-cli` with no
    # structure error and `phax artifact status --run usage-cli` reports its sidecar in sync. Indicative: section names and wording.

### file: pass.json — normative

Summary: Each review pass records how it ended (clean, planned, nothing to fix, blocked or failed) and which phases it appended.

    # <run-dir>/review/pass-01/pass.json, also committed to the run's records
    # normative: the keys, the outcome and mode kinds, and who writes what. Indicative: the layout.
    {
      "$schema": "https://docs.phax.run/schemas/review-pass/<X.Y.Z>.json",
      "pass": 1,
      "mode": "headless",
      "threshold": "concern",
      "complianceVerdict": "conformant-with-deviations",
      "outcome": "planned",
      "plan": "docs/plans/2609251010-usage-cli-review-01-plan.md",
      "appendedPhases": ["phase-04", "phase-05"],
      "failure": null
    }
    # outcome: reviewed | planned | no-fix | clean | blocked-divergent | superseded | failed
    # mode: headless | interactive (the review-plan session that landed the current plan) | none (no review-plan session yet, or none was spawned)
    # threshold: bug | deviation | concern, resolved by review-plan, also for clean and blocked-divergent; null while reviewed or failed before review-plan
    # complianceVerdict: a compliance verdict, or null when compliance is disabled or failed
    # plan: the review plan's path on the run branch (under docs/plans/archive/ once abandoned), or null when the pass planned no phase;
    #   its approval lives in docs/plans/approvals/<plan file stem>.json on the run branch
    # appendedPhases: [] until appended
    # failure: { step: compliance | review | review-plan | approval | push, exit } beside outcome failed; null otherwise
    #
    # lifecycle:
    #   review-code --headless   writes it: outcome reviewed, mode none, threshold null, plan null
    #   review-plan              outcome planned | no-fix | clean | blocked-divergent, mode, threshold, plan
    #   run --append             adds each committed appended phase to appendedPhases
    #   the next pass opening    outcome superseded, when this pass's plan was still pending
    #   a failed loop step       outcome failed with failure; replaced when that step succeeds by hand
    # $schema: the `review-pass` format, registered and snapshotted like every persisted format

### cli: phax run <run> --append --plan <review plan> — normative

Summary: You can add a review plan's fix phases to the end of a finished run, which then runs again from its last phase.

before:

    phax run [short-name] --plan <path> [--allow-dirty] [--security <mode>] [--refresh] …
      (always creates a new run; a run ends review_open and no command returns it to running)

after:

    phax run usage-cli --append --plan docs/plans/2609251010-usage-cli-review-01-plan.md

    # run from the checkout; the plan path is read in the run's final-phase worktree, and nothing is committed on the checkout
    # normative: the flag, the argument form (the existing run grammar), the state transition and the exit families.
    # indicative: output layout and wording.
    append usage-cli — review pass 1 — phase-04..phase-05 after phase-03
    phase-04  from review pass 1 (F1, C1)  phax/usage-cli--phase-04 ← phax/usage-cli--phase-03
    phase-05  from review pass 1 (F3)      phax/usage-cli--phase-05 ← phax/usage-cli--phase-04
    fixed     F1, C1, F3
    usage-cli review_open — handoff and reconciliation regenerated over phase-01..phase-05
    $? = 0

    State: review_open → running → review_open (failed / rate_limited / interrupted exactly as for any phase)

    A draft PR accepts the append; at its end phax pushes phax/usage-cli--phase-05 and rewrites the draft's body:
    pushed    phax/usage-cli--phase-05 → draft PR https://github.com/o/r/pull/12 (body rewritten)
    An append starts no review pass and no publish.auto.

    Refusals happen before any phase starts. Nothing is created and the run state is unchanged. (wording indicative)
    ✗ append refused: review plan is Draft, not Approved                                     $? = 12
    ✗ append refused: run usage-cli is failed, not review_open                                $? = 1
    ✗ append refused: pull request https://github.com/o/r/pull/12 of run usage-cli is ready for review (only a draft accepts an append)    $? = 1
    ✗ append refused: the plan is pass 1's, but the run's latest pass is 2                    $? = 2
    ✗ append refused: plan starts at phase-04 but the run's last phase is phase-05             $? = 2
    ✗ append refused: phase-04 plans src/app/other.ts, outside the run footprint (R2)          $? = 2
    Other exits are as for `phax run`: 3 unsafe git state · 4 gate failure · 5 agent error · 7 lock conflict · 8 rate/usage limit

### config: phax.json review.code.{enabled,append,maxPasses} — normative

Summary: You can have every run review its own code when it reaches review, then append and re-review the fixes up to a set number of passes.

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
        "append": true,      // machine-approve (grant review-code-append) and append each pass's review plan…
        "maxPasses": 2,      // …at most this many times, re-reviewing after each (1–5, default 1)
        "model": "claude-opus-5-5", "effort": "high"
      }
    }
    // all keys optional; enabled and append default to false; append requires enabled (else exit 2)
    // with enabled: the passes run before publish.auto, and the run completes its plan and spec when its PR becomes ready;
    // a pending review plan or an awaiting finding makes publish.auto open a draft PR, with no completion

### config: phax.json review.code.{doctrine,minSeverity} — indicative

Summary: You can set the review doctrine and the lowest severity worth fixing once in phax.json, instead of on every command.

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

Summary: You approve and inspect a review plan from your checkout although it lives on the run's branch, and status names the run and pass it belongs to.

before:

    phax artifact status docs/plans/2609240900-usage-cli-plan.md
    Path:              docs/plans/2609240900-usage-cli-plan.md
    Kind:              plan
    Status:            Approved

after:

    phax artifact approve docs/plans/2609251010-usage-cli-review-01-plan.md --run usage-cli --by operator | --by machine:<grant>
    Status:   Approved
    Approver: operator (Ada Lovelace)
    Record:   docs/plans/approvals/2609251010-usage-cli-review-01-plan.json (run branch phax/usage-cli--phase-03)

    phax artifact status docs/plans/2609251010-usage-cli-review-01-plan.md --run usage-cli
    Path:     docs/plans/2609251010-usage-cli-review-01-plan.md (run usage-cli, phax/usage-cli--phase-03)
    Kind:     review-plan (run usage-cli, pass 1)
    Authored: headless — sidecar …-review-01-plan.json (in sync)
    Status:   Approved
    Approved: 2026-09-25 by machine (review-code-append)      # or: by operator (Ada Lovelace)
    Appended: phase-04..phase-05                               # or: not appended
    Findings: 4 considered — fixed 3 · awaiting 1 (F2) · dismissed 0 · open 0
    PR:       draft https://github.com/o/r/pull/12 — pending: F2 awaiting   # or: ready for review, or: none

    phax plans lint docs/plans/2609251010-usage-cli-review-01-plan.md --run usage-cli   # lints in the run's final worktree

    ✗ approve refused: docs/plans/2609251010-usage-cli-review-01-plan.md is a review plan — name its run with --run usage-cli   $? = 12

    # normative: --run, that approve accepts a review plan, the `--by` values (per artifact-decide), and the approver kind and identity in status
    # indicative: layout and wording

### cli: phax ls review-pass report — indicative

Summary: phax ls shows each run's review passes, and how many findings were fixed, await you, were dismissed or are still open.

before:

    phax ls --review-open
    usage-cli   review_open   …today's columns…

after:

    phax ls --review-open
    usage-cli   review_open   5 phases   passes 2 (last: clean, conformant) · fixed 3 · awaiting 0 · dismissed 1 · open 0
    lint-fix    review_open   4 phases   passes 1 (last: planned, conformant) · fixed 0 · awaiting 1 · dismissed 0 · open 0 · PR draft: F7 awaiting

    phax ls --json   # each run gains:
    "reviewPasses": [
      { "pass": 1, "outcome": "planned", "complianceVerdict": "conformant-with-deviations",
        "findings": { "bug": 1, "deviation": 2, "concern": 1, "info": 1 },
        "outcomes": { "fixed": 3, "awaiting": 0, "dismissed": 1, "open": 0 } },
      { "pass": 2, "outcome": "clean", "complianceVerdict": "conformant",
        "findings": { "bug": 0, "deviation": 0, "concern": 0, "info": 1 },
        "outcomes": { "fixed": 0, "awaiting": 0, "dismissed": 0, "open": 0 } }
    ]
    #   and, for a run whose PR is a draft: "pullRequest": { "url": "…", "draft": true, "pending": ["F7"] }
    # the PR state is read through gh at call time; no PR state is stored
    # open counts only non-info findings

### file: pr-body.md (the pull request description) — normative

Summary: The pull request shows each review pass's findings and their outcomes, and while it is a draft it says what it is waiting for.

before:

    **Run** `acme.usage-cli` · **Plan** `docs/plans/2609240900-usage-cli-plan.md` · **Gate profile** `standard`
    **Phases** 3/3 passed · **Verified surfaces** local, structural
    **Compliance** conformant-with-deviations

    ## Phases
    …

    ## Needs your review

    ### Compliance attention points
    …

    ### Unexplained deviations
    …

    ## Full detail
    …

after:

    **Run** `acme.usage-cli` · **Plan** `docs/plans/2609240900-usage-cli-plan.md` · **Gate profile** `standard`
    **Spec** `docs/specs/2609240900-usage-cli.md` completed
    **Phases** 5/5 passed · **Verified surfaces** local, structural
    **Compliance** conformant

    ## Phases
    …

    ## Needs your review

    ### Review passes

    (while the PR is a draft:)
    **Draft** — waiting for the operator: review plan `docs/plans/2609251010-usage-cli-review-03-plan.md` (Draft) · F9 awaiting

    | Pass | bug | deviation | concern | info | Fixed | Awaiting | Dismissed | Open | Compliance |
    |---|---|---|---|---|---|---|---|---|---|
    | 1 | 1 | 2 | 1 | 1 | 3 | 0 | 1 | 0 | conformant-with-deviations |
    | 2 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | conformant |

    - F2 (deviation) src/app/prune.ts:88 — a registry entry without a worktree is kept — dismissed by operator (Ada Lovelace): spec §5.3 allows it

    ### Compliance attention points
    …

    ### Unexplained deviations
    …

    ## Full detail
    …

    # normative: `### Review passes` heads `## Needs your review` for a run with a pass; the column set and order;
    # one line per awaiting or dismissed finding; open counts only non-info findings; the subsection is never cut
    # and the cut order of the other lists is today's; no decisions table
    # indicative: cell and line wording
    # the draft line, while the PR is a draft; `phax publish-pr` rewrites the body when it marks the PR ready
    # a run with no pass gets a body identical to today's

### cli: phax publish-pr <run> with review passes — normative

Summary: While a review item awaits you, the pull request opens as a draft; phax completes the run and marks it ready only once nothing is pending.

before:

    phax publish-pr usage-cli
      (pushes the final branch and creates a PR ready for review, or reuses an existing PR without touching it)

after:

    phax publish-pr usage-cli

    # a run with no PR and a pending review item: a draft PR, no completion
    draft     https://github.com/o/r/pull/12 — pending: review plan …-review-02-plan.md (Draft) · F7 awaiting
    $? = 0

    # a run whose PR is a draft, with an item still pending: refused, nothing changed
    ✗ publish-pr refused: pull request https://github.com/o/r/pull/12 stays a draft — pending: F7 awaiting; decide it with `phax review-plan usage-cli`
    $? = 12

    # a run whose PR is a draft, nothing pending: completion, push, body rewritten, marked ready
    completed docs/plans/2609240900-usage-cli-plan.md · docs/specs/2609240900-usage-cli.md (run branch)
    pushed    phax/usage-cli--phase-05
    ready     https://github.com/o/r/pull/12 (body rewritten)
    $? = 0

    # a run whose PR an operator marked ready by hand, completion still deferred: completion, push, body rewritten
    completed docs/plans/2609240900-usage-cli-plan.md · docs/specs/2609240900-usage-cli.md (run branch)
    ready     https://github.com/o/r/pull/12 (already ready; body rewritten)
    $? = 0

    # a closed or merged PR: refused
    ✗ publish-pr refused: pull request https://github.com/o/r/pull/12 is merged — complete the artifacts with `phax artifact complete`, or reopen the PR
    $? = 12

    # a failed step exits in its family; a rerun skips the steps done and resumes
    completed (already) · pushed (already) · ready https://github.com/o/r/pull/12
    $? = 0

    # normative: the draft/refuse/ready behavior, exit 12, the step order and their idempotence. Indicative: layout and wording.
    # the PR's state is read live through gh; completion moves each appended review plan, then the plan, then the spec
    # GitHub operations this adds, through `gh`: create a draft PR, mark a PR ready for review, edit a PR's body

## 7. Non-goals

- Stacked pull requests. The correction ships in the run's one PR. A second PR based on the first is set aside until a team must approve corrections separately.
- A `coverage` provider or any new review provider. The review uses the run's provider through the existing review session.
- The cockpit UI or any trajectory screen. This spec supplies the data a UI would render (pass records, finding outcomes, the review-passes subsection), and nothing more.
- Headless total mode. A machine never dismisses or leaves open a finding on its own: a finding it does not fix waits, `awaiting`, for an operator. The doctrines defer this mode.
- Appending an arbitrary plan. `--append` accepts only the current review plan of the run's latest pass.
- Appending to a run whose PR is ready for review, and editing the body of a PR that is ready. A draft PR accepts appends, and its body is rewritten when `phax publish-pr` marks it ready.
- The oracle-separation `plans lint` rule and a per-phase diff budget. Until that lint exists, `--append` refuses no oracle file and the compliance review alone checks R4 (§9 Q5).
- Changing the `phax-decide-spec` and `phax-decide-plan` skills, the skill catalog, or `phax artifact decide`. Of the doctrine skills, only the headless sections of `phax-decide-review` change here.
- Re-reviewing inside `review-plan`. The report is the judge, and the plan is its consequence.
- Verifying a fix with a model. `fixed` means committed by an appended phase, and a recurrence is a new finding in a later pass (§9 Q7).
- Detecting destructive changes at run time. The destructive floor applies to what the review plan declares.
- Any change to the interactive `review-code`, to the compliance review's document schema, or to `review-compliance` beyond judging appended phases against their own plan.
- Retrying a failed appended phase automatically. The loop stops, and a human resumes with `phax resume` and runs any later pass by hand.
- Autopilot beyond the bounded passes: no roadmap, no supervisor, and no budget other than `maxPasses`.
- A stability promise for `code-review.json`, `pass.json` and the review plan's sidecar beyond schemas-package's: they carry `$schema` and stay readable in every shape, like every persisted format.
- A decisions table in the PR body. Document arbitrations stay in the spec and plan, and finding decisions show in the review-passes subsection.
- Phase decision requests. Runs stay autonomous: nothing in an appended phase stops to wait for a person.
- Approving or appending from inside a run's worktree. The phase guard is unchanged, and the commands reach the run from the checkout. The new `review-plan` command joins the refused class: it is refused inside a phase worktree, as `review-code` is.
- Storing a PR's state. phax reads it live through `gh`, and run-status gains no field.

## 8. Acceptance criteria

### Headless review writes findings and stops

Given A `review_open` run `usage-cli` with no pass. Its compliance review has verdict `conformant-with-deviations` and one `deviation` finding on `phase-02`., when `phax review-code usage-cli --headless` runs, and the session returns a valid code-review document with two findings., then The provider was invoked without a terminal. The pass-1 `code-review.json` holds `F1` and `F2` (source `review`) and `C1` (source `compliance`, phase `phase-02`), all at outcome `open` with empty history. Its `pass.json` has outcome `reviewed`, mode `none` and threshold null. The run's records carry both files. No worktree file outside `.phax-context/` changed, and the run is still `review_open`. `code-review-session.json` names the session, and a later `phax review-code usage-cli` resumes it. The exit code is 0. (refs §5.1, §5.7, §5.5, §5.6, §5.9)

### The review brief carries compliance and earlier outcomes

Given A run whose pass 1 ended with `F1` fixed, `F2` awaiting and `F3` open, and whose latest compliance verdict is `conformant`., when `phax review-code <run> --headless` runs, and the session returns one finding., then The recorded session prompt contains the verdict `conformant` and lists `F1` fixed, `F2` awaiting and `F3` open. The new finding is numbered `F4`, and it sits in the pass-2 `code-review.json`. (refs §5.2, §5.5)

### Invalid review opens no pass

Given A headless review session that returns prose, and another that returns a finding with severity `style`., when Each session ends., then Each command exits 5. The second names `findings[0].severity`. No `code-review.json` exists for a new pass, and the run's pass count is unchanged. (refs §5.3, §5.4)

### Interactive review unchanged

Given A `review_open` run., when `phax review-code <run>` runs without `--headless`., then The prompt file, the session record and the interactive provider invocation are identical to those produced before this change, and no pass is opened. (refs §5.10)

### Review plan from the report

Given A pass whose `code-review.json` holds `F1` (bug), `F2` (concern) and `F3` (info). The run has no review session record. A doctrine file `d.md` has a list item that opens with `X1`., when `phax review-plan <run> --headless --doctrine d.md --min-severity concern` runs, and the session returns a document where `phase-04` names `F1` and no phase names `F2`., then A new session was started. Its prompt contains the pass's `code-review.json`, then the `phax-decide-review` skill text, then `d.md`. A Draft review plan and its sidecar are committed under `docs/plans/` on the run branch, and nothing is committed on the checkout. `F3` appears only in the handoff note. `F2`'s outcome is `awaiting`, with no history entry. `F1` stays `open`. The exit code is 0. (refs §5.14, §5.15, §5.17, §5.18, §5.19, §5.23, §5.27, §5.29, §5.52)

### The review session is resumed

Given A run whose review session record names session `S`., when `phax review-plan <run> --headless` runs., then The provider invocation resumes session `S` and starts no new session. (refs §5.14)

### A project skill replaces the default

Given A project-scoped `phax-decide-review` skill whose text differs from the bundled one, and `review.code.doctrine` set to `docs/review-doctrine.md`., when `phax review-plan <run> --headless` runs without `--doctrine`., then The session prompt contains the project skill's text followed by `docs/review-doctrine.md`, and it does not contain the bundled skill's text. (refs §5.15, §5.17)

### Review-plan refusals

Given In turn: a run in state `failed`; a `review_open` run with no pass; a run whose latest pass's review plan is already appended; a run whose run completion has landed; a `--doctrine` path that does not exist; and a doctrine file that defines no principle id., when `phax review-plan <run> --headless` runs on each., then Each run exits 1 naming the condition, and no provider session is spawned. (refs §5.12)

### Threshold resolution

Given A pass with one `bug`, one `deviation` and one `concern` finding., when `phax review-plan <run> --headless` runs three times: with `--min-severity deviation`; with no flag and `review.code.minSeverity: "bug"`; and with neither., then The findings under consideration are {bug, deviation}, then {bug}, then all three. Every other finding appears in the handoff note and stays `open`. A below-threshold finding raised again by a later pass on the same file with the same message appears once. (refs §5.18, §5.19)

### Every finding under consideration is fixed or decided once

Given A session that returns a review plan in which finding `F1` (bug) is named by neither a phase nor a decision. Other sessions name it in two phases, or in a phase and a decision., when Each session ends., then Each command exits 5 naming `F1`. No review plan exists for the pass, and no finding's outcome or history changed. (refs §5.21, §5.20, §5.25)

### A headless plan decides nothing

Given Three review-plan documents: a headless one carrying a decision that dismisses `F2`; an interactive one whose decision cites `R9`, which no loaded doctrine defines; an interactive one whose decision lists `abandoned: ["fix"]`., when Each session ends., then Each exits 5, naming the violating path, and writes nothing. (refs §5.23, §5.22, §5.25)

### Destructive work stops

Given A review-plan document with a phase rated `irreversible`., when Each session ends., then It exits 5 naming `phases[0].reversibility`, and nothing is written. (refs §5.24)

### Phases continue the run's numbering

Given A run with phases `phase-01` to `phase-03`., when `phax review-plan <run> --headless` emits a two-phase plan., then The plan's phases are `phase-04` and `phase-05`. (refs §5.26)

### The review plan is never re-extracted

Given A review plan with phases `phase-04` and `phase-05` that has just been materialised for pass 1 of run `usage-cli`., when `phax plans lint <plan> --run usage-cli` reads it, `phax artifact status <plan> --run usage-cli` inspects it, and `phax run usage-cli --append --plan <plan>` reads it., then Lint reports no structure error: it accepts the `-review-01` slug and a first phase `phase-04`. Status reports the sidecar in sync. Rendering the sidecar twice yields identical Markdown. The structured plan equals the sidecar's projection, and no extraction session is spawned. The run's records carry the session record. (refs §5.27, §5.20, §5.53, §5.54)

### Every finding decided, nothing to fix

Given A pass with two `bug` findings., when The headless review-plan session returns a document with no phase., then No review plan is written, and the session's answer is in the run's records. `pass.json` records outcome `no-fix`, both findings are `awaiting`, and the exit code is 0. (refs §5.28, §5.29)

### An unappended plan is replaced

Given A pass whose Approved review plan has not been appended., when `phax review-plan <run>` lands a new document for the same pass., then The earlier plan is Abandoned under `docs/plans/archive/` on the run branch, and its approval record file is gone from `docs/plans/approvals/`. A new Draft review plan for the same pass sits under `docs/plans/`. Every finding's earlier history entries are kept. (refs §5.30)

### No plan on a divergent verdict

Given A run whose latest compliance verdict is `divergent`., when `phax review-plan <run> --headless` runs., then No provider session is spawned and no review plan exists for the pass. The outcome in `pass.json` is `blocked-divergent`, and the exit code is 1. (refs §5.31)

### Clean pass emits no plan

Given A pass whose findings are all `info`., when `phax review-plan <run> --headless` runs., then No session is spawned and no review plan exists. The outcome in `pass.json` is `clean`, and the exit code is 0. (refs §5.32)

### Interactive review-plan decides awaiting findings

Given A run whose pass-1 `F2` is `awaiting`, and whose pass 2 has `F5` (bug), open., when `phax review-plan <run>` runs without `--headless`, and the operator dismisses `F2` and plans `F5`., then The interactive Claude Code session resumed the review session. It presented `F5` first, then `F2`. When the operator exited, phax resumed the session headless for the document, showed the rendered plan and the decisions, and landed them on acceptance. `F2`'s outcome in the pass-1 `code-review.json` is `dismissed`. Its latest history entry is a decided verdict naming the operator by git identity. `F5` is named by a phase. `pass.json` records mode `interactive`. (refs §5.33, §5.35, §5.29)

### Append continues the same run

Given A `review_open` run `usage-cli` with `phase-01`..`phase-03`, a commit added on `phax/usage-cli--phase-03` during review, and an Approved pass-1 review plan with `phase-04` and `phase-05`., when `phax run usage-cli --append --plan <review plan>` runs from the checkout to completion., then The run state goes `review_open` → `running` → `review_open`. `phax/usage-cli--phase-04` descends from the tip of `phax/usage-cli--phase-03`, including the review commit, and `phase-05` descends from `phase-04`. The run id is unchanged, and the records for `phase-04` and `phase-05` sit under that id. `phase-03` is no longer `review_open`, and `phase-05` is the kept-open final phase. No commit was made on the checkout. (refs §5.36, §5.38, §5.39, §5.40, §5.37)

### Appended phases are ordinary phases

Given An appended phase whose gate stays red after the fix loop., when `phax run <run> --append --plan <review-plan.md>` runs., then It exits 4 and the run is `failed`. The findings that phase names stay `open`. `phax resume <run>` resumes at that appended phase. (refs §5.41, §5.42)

### Fixed means committed

Given An Approved pass-1 plan whose `phase-04` names `F1` and `C1` and whose `phase-05` names `F3`., when The append completes both phases., then `F1`, `C1` and `F3` have outcome `fixed` in the pass-1 `code-review.json`, and `pass.json` lists `phase-04` and `phase-05` as appended. (refs §5.42)

### The whole run is regenerated and judged

Given A run after a completed append of `phase-04`..`phase-05`., when The append finishes, and then `phax review-compliance <run>` runs., then `review-handoff.md` and the global file reconciliation cover `phase-01`..`phase-05` and the files of both plans. The compliance review judges `phase-04` and `phase-05` against the review plan, and `phase-01`..`phase-03` against the original plan. (refs §5.43, §5.44)

### Append refusals

Given In turn: a review plan in Draft; a run in state `failed`; a run whose pull request is ready for review; the pass-1 plan when pass 2 exists; and a plan starting at `phase-04` on a run whose last phase is `phase-05`., when `phax run <run> --append --plan <plan>` runs on each., then The runs exit 12, 1, 1, 2 and 2 respectively, each naming the condition; the third names the PR's state. No worktree or branch is created, and the run's state is unchanged. (refs §5.45, §5.46, §5.47, §5.50)

### Footprint refusal

Given An Approved review plan whose `phase-04` plans `src/app/other.ts`, named by no finding and by no plan of the run., when `phax run <run> --append --plan <plan>` runs., then It exits 2, naming `phase-04`, the file and `R2`. No worktree is created, and the run stays `review_open`. (refs §5.51)

### Approval targets the run and names its approver

Given A Draft pass-1 review plan on the branch of run `usage-cli`., when These commands run from the checkout, each on a fresh copy:
- `phax artifact approve <plan> --run usage-cli --by machine:steme-conductor`;
- `phax artifact approve <plan> --run usage-cli --by operator`;
- `phax artifact approve <plan>` without `--run`.

Then approve runs once more from inside the run's final worktree., then The approval record file `docs/plans/approvals/<plan file stem>.json` on the run's final branch records `approvedBy` as `{ kind: machine, grant: steme-conductor }`, then as the operator by git identity. Each approval commit is on the run branch, and no commit is made on the checkout. Without `--run`, approve exits 12 naming `--run usage-cli`. Inside the final worktree, the phase guard refuses it. (refs §5.55, §5.56, §5.52)

### An awaiting finding blocks the review plan

Given A headless review plan with one phase that leaves `F2` awaiting., when `phax artifact approve <plan> --run <run>` runs on it, and then `phax run <run> --append --plan <plan>` runs., then `phax artifact approve` exits 12 naming `F2` and `phax review-plan <run>`; `phax run --append` then exits 12 as for a Draft plan. After an interactive `review-plan` decides `F2`, approve and append succeed. (refs §5.57)

### Enabled review leaves the pass for a human

Given `review.code.enabled: true` with `review.code.append` absent, compliance enabled, `publish.auto: true`, and a plan with `completes-spec: true` whose run produces a `bug` finding., when `phax run <plan>` completes its phases., then The run is `review_open`. Pass 1 has `code-review.json` and `pass.json`, and a Draft review plan with its sidecar sits on the run branch. No phase was appended. The recorded timestamps show the compliance review before the code review, and the code review before the review plan. The run's plan and source spec are still Approved on the run branch. The run's pull request was opened as a draft, and its `### Review passes` names the pending review plan. (refs §5.58, §5.64, §5.69)

### Bounded automatic passes

Given `review.code.enabled: true`, `append: true`, `maxPasses: 2`, `publish.auto: false`, and a review that reports a `bug` on every pass., when `phax run <plan>` runs., then The plans of passes 1 and 2 are appended. Pass 3 is reviewed, and its plan is left Draft and unappended. The run ends `review_open`, with its plan and source spec Approved. No pull request was opened, because `publish.auto` is not set. Each pass ran the compliance review, then the code review, then the review plan. The approvals of passes 1 and 2 are recorded as `{ kind: machine, grant: review-code-append }`. (refs §5.59, §5.61, §5.64)

### The loop stops early

Given `review.code.enabled: true`, `append: true`, `maxPasses: 2` and `publish.auto: false`., when In separate runs, pass 1 reports only `info` findings; pass 1's compliance verdict is `divergent`; pass 1's plan has no phase; pass 1's plan has a phase and leaves a finding awaiting; or pass 1's appended phase fails its gates., then No further pass runs in any case. The first four runs end `review_open`: pass-1 outcome `clean`, `blocked-divergent`, `no-fix`, and `planned` with the plan left Draft and unappended. The fifth run is `failed`. In every case, the run's plan and source spec are still Approved on the run branch, and no completion commit exists. The `blocked-divergent` run exits 0. (refs §5.60, §5.67)

### Config defaults and validation

Given In turn: a `phax.json` without `review.code.enabled`, `append` or `maxPasses`; one with `append: true` and no `enabled`; and one with `maxPasses: 0`., when `phax run` loads each., then The first behaves as before this change and produces no pass. The second and third fail config loading with exit 2, naming `review.code.append` and `review.code.maxPasses` respectively. (refs §5.62, §5.63)

### Passes are visible

Given A run with two passes, the last `clean` with compliance `conformant`. Pass 1's plan was machine-approved and appended as `phase-04`..`phase-05`, fixing 3 findings, with 1 left awaiting and later dismissed by the operator., when `phax ls`, `phax ls --json` and `phax artifact status <pass-1 review plan> --run <run>` run., then `phax ls` shows 2 passes, `clean` and `conformant` for the last one, and fixed 3, awaiting 0, dismissed 1 and open 0. `phax ls --json` carries one `reviewPasses` entry per pass. `artifact status` reports the run, pass 1, Approved, approver `machine (review-code-append)`, `phase-04`..`phase-05`, and the outcome counts. (refs §5.77, §5.78)

### The PR opens what needs review on the trajectory

Given A `review_open` run with two passes, one awaiting finding and one dismissed finding., when `phax publish-pr <run>` creates the pull request., then `## Needs your review` in `pr-body.md` opens with `### Review passes`. It holds a two-row table whose counts equal those derived from the pass documents, including the Awaiting and Dismissed columns. A line follows for the awaiting finding, and one for the dismissed finding, which names its operator and why. `### Compliance attention points` and `### Unexplained deviations` follow. The body has no decisions table. (refs §5.79, §5.80)

### The cut spares the review passes

Given The same run, whose unexplained deviations, attention points and review notes take the body past 60,000 bytes., when `phax publish-pr <run>` builds the body., then The body is at most 60,000 bytes and holds `### Review passes` whole. The cuts fall on unexplained deviations, then attention points, then review notes, as today. (refs §5.81)

### No pass, no change

Given A run with no review pass., when `phax publish-pr <run>` builds the body., then `pr-body.md` is byte-identical to the body `buildShortPrBody` built before this change. (refs §5.82)

### A completed run takes no pass

Given A run with `review.code.enabled` false that reached `review_open`, its run completion landed., when `phax review-code <run> --headless` runs, and then `phax review-plan <run> --headless` runs., then Each exits 1, naming the applied run completion and `review.code.enabled`. No session is spawned, and no pass is opened. (refs §5.11, §5.12)

### The review doctrine plans fixes only in headless mode

Given The bundled `phax-decide-review` skill., when Its text is read., then Its headless section instructs a session to plan fixes only and to leave unnamed every finding it does not fix. It contains no escalation, no proposal and no `decisions[]` instruction for headless mode. (refs §5.16)

### Interactive review-plan needs a terminal and Claude Code

Given A run whose review session runs on Codex, and separately a run whose session runs on Claude Code., when `phax review-plan <run>` runs without `--headless` on the first, and then on the second with no terminal., then Each exits 1 naming the condition, and no session is spawned. (refs §5.34)

### Completion waits for the review, then a ready PR

Given `review.code.enabled: true`, `append: true`, `maxPasses: 1`, `publish.auto: true`, compliance enabled, and a plan with `completes-spec: true`. Pass 1 reports a `bug` that an appended phase fixes, and pass 2 is clean., when `phax run <plan>` runs., then The end of the run went, in order: compliance; pass 1 (code review, review plan, machine approval, append); pass 2; run completion; a PR ready for review. During the passes, the plan and its source spec were Approved on the run branch, and the review plan's approval was accepted against that spec. The run-completion commit follows the appended phase's commits, and the PR was opened afterwards, ready for review. With `review.code.enabled` false, the completion lands at the final phase as before. (refs §5.67, §5.70, §5.64, §5.58)

### The review-plan frontmatter is checked

Given Three review plans: one without `review-pass`, one with `completes-spec: true`, and one with an extra key., when `phax plans lint <plan> --run <run>` reads each., then Each reports a structure error naming the key. (refs §5.53, §5.54)

### An awaiting finding opens a draft PR

Given `review.code.enabled: true`, `append: true`, `maxPasses: 2`, `publish.auto: true`, and a plan with `completes-spec: true`. Pass 1's headless review plan fixes `F1` and leaves `F2` awaiting., when `phax run <plan>` runs., then No further pass runs, and the pass-1 plan stays Draft and unappended. The run ends `review_open`, with its PR opened as a GitHub draft. The run's plan and source spec are still Approved on the run branch, and no completion commit exists. The body's `### Review passes` opens with the draft line naming the pending plan and `F2`. `phax ls` and `phax artifact status <plan> --run <run>` show the draft PR and name `F2`. (refs §5.69, §5.60, §5.80, §5.77, §5.78)

### A draft PR accepts an append and follows it

Given The run above, after an interactive `phax review-plan <run>` dismisses `F2` and lands a plan for the pass, which an operator approves with `--run`., when `phax run <run> --append --plan <plan>` runs from the checkout., then The append runs, and the run returns to `review_open`. phax pushes the final branch and rewrites the draft's body, and the draft PR's head is that branch's tip. The PR is still a draft. No review pass runs, and `publish.auto` does not run. (refs §5.47, §5.48, §5.37, §5.49)

### publish-pr keeps a draft until nothing is pending, then marks it ready

Given A run whose PR is a draft and whose `F2` is awaiting., when `phax publish-pr <run>` runs. Then an interactive `phax review-plan <run>` decides `F2`, and `phax publish-pr <run>` runs again., then The first run exits 12 naming `F2` and changes nothing: no commit, no push, and the PR is still a draft. The second applies the run completion on the run branch: the plan is Completed, and so is the spec, which the plan completes. It then pushes, rewrites the body with the review passes current and no draft line, marks the PR ready for review, and exits 0. An append on the run is then refused. (refs §5.72, §5.73, §5.67, §5.47)

### publish-pr opens a draft while an item is pending

Given A run with no PR, `publish.auto` not set, and a Draft review plan for its latest pass., when `phax publish-pr <run>` runs., then The PR is opened as a draft, and the body names the pending plan. No completion commit exists, and the exit code is 0. (refs §5.71)

### Completion moves the review plans, then the plan, then the spec

Given A run whose plan has `completes-spec: true`, with two appended review plans bound to the same spec, and nothing pending. Its PR is a draft., when `phax publish-pr <run>` runs., then On the run branch, the two review plans move to Completed, then the run's plan, then the spec, in that order. The chain gate does not block the spec, and the body's summary says the spec was completed. (refs §5.68, §5.73)

### A new pass supersedes the previous pass's pending plan

Given A run whose pass-1 review plan is Approved and not appended., when `phax review-code <run> --headless` opens pass 2., then The pass-1 plan is Abandoned under `docs/plans/archive/` on the run branch, and its approval record file is removed. Pass 1's outcome is `superseded`, and its findings keep their outcomes. The run's pending items are pass 2's, not pass 1's plan. (refs §5.8)

### A failed loop step leaves a draft PR and exits in its family

Given `review.code.enabled: true`, `append: true`, `publish.auto: true`. In separate runs: the headless review returns prose; the review-plan session hits a usage limit; the push after an append fails; and the compliance review fails., when `phax run <plan>` runs., then In every case, no further pass runs, the pass's `pass.json` has outcome `failed` naming the step, the PR opens as a draft, and no completion commit exists. `phax run` exits 5, 8, and that push failure's exit in the first three runs, and 0 in the fourth. Rerunning the failed step by hand replaces the `failed` outcome. (refs §5.65, §5.66, §5.69)

### Only the original run triggers the loop

Given `review.code.enabled: true`, `append: true`, `publish.auto: true`, and a run whose appended phase failed its gates., when `phax resume <run>` completes the appended phase., then No review pass runs and nothing is published. The run is `review_open`, and its PR state is unchanged. (refs §5.49)

### publish-pr follows the PR's live state

Given In turn: a run whose draft PR an operator marked ready by hand, with completion deferred and nothing pending; a run whose PR was merged; a run whose `publish-pr` failed at the push after its completion., when `phax publish-pr <run>` runs on each., then The first applies the completion, pushes and rewrites the body, and exits 0. The second exits 12, naming `merged`, `phax artifact complete` and reopening the PR. The third, rerun, skips the completion already applied, then pushes, rewrites the body and marks the PR ready. `phax ls` reports each PR's state as GitHub has it at the call. (refs §5.73, §5.75, §5.74, §5.76)

### A review plan is reached only through its run

Given A Draft review plan of run `usage-cli`., when In turn: `phax artifact approve <plan>`, `phax artifact status <plan>` and `phax plans lint <plan>` without `--run`; `--run nope`; `--run` naming a run in state `failed`; and `--run other`, a run of which the path is not a review plan., then approve and status exit 12, and lint exits 1, each naming the condition (`--run usage-cli` when it is missing). Nothing is written. (refs §5.56)

### review-plan is refused inside a phase worktree

Given A shell inside a phase worktree., when `phax review-plan <run>` runs., then The phase guard refuses it, and no session is spawned. (refs §5.13)

## 9. Open questions

None.

## 9b. Arbitrated questions

### Q1 — Do `info` findings accumulate across passes in the handoff note?

- per-pass — Each pass lists its own info findings in its own handoff note — abandons: A single list the human reads once: the same style note repeats on every pass
- dedupe — One handoff note, deduplicated by file and message across passes, each entry tagged with the first pass that raised it (doctrine R7) — abandons: Seeing directly that a later pass still raised the note
- last-only — Only the last pass's info findings — abandons: Earlier passes' style notes, which vanish silently, against R6 and R7
- whole-change — One list over the run's whole change set, deduplicated by file and message, with no pass or phase tag — abandons: Knowing which pass raised a note: the review judges the whole change set, so a note's pass of origin tells the reader nothing they need

Recommendation: whole-change — Decided by the author on 2026-09-28, off the previous menu. The code review covers the run's whole change set, not a pass or a phase, so the handoff note is one deduplicated list and needs no pass of origin.

Decision: whole-change — lifted, unattributed, 2026-09-28

### Q3 — May `review-plan` run interactively on a run whose review was headless?

- resume — Yes, resuming the headless review session in a terminal — abandons: A machine-only transcript for a session the loop started: the records mix machine and human turns
- fresh — Yes, in a fresh session given `code-review.json` — abandons: The review's memory of why each finding was raised, which is exactly what deciding an awaiting finding needs
- no — No — abandons: The only way an operator decides an awaiting finding or takes over a pass the loop left unappended

Recommendation: resume — Decided by the author on 2026-09-28, as recommended. Interactive review-plan is where awaiting findings get decided and where a human takes over after the bound. Both need the review's memory. `pass.json` records `mode: interactive`, and each decision names its arbiter, so the mixed transcript stays attributable (E0).

Decision: resume — lifted, unattributed, 2026-09-28

### Q4 — Where is a review plan's approval recorded, and how is a machine approval marked?

- pass-record — `phax artifact approve` accepts the review plan in the run directory. `approvedBy` is recorded in `pass.json` in the artifact-decide form: `{ kind: machine, grant }` from `--by machine:<grant>`, or grant `review-code-append` for the loop, or `{ kind: operator, name }` — abandons: A single approvals ledger in the repository: review-plan approvals live with the run and its records, not in `docs/plans/approvals/`
- plans-ledger — Commit the review plan under `docs/plans/` on the run branch and approve it like any plan — abandons: A run branch that carries only the work: every pass adds bookkeeping to the PR, and the approval commit must land on the run branch rather than the checkout
- implicit — No separate approval: invoking `run --append` is the approval — abandons: The 'plan not Approved' refusal, and a machine approval that can be told apart from an operator's

Recommendation: plans-ledger — Decided by the author on 2026-09-28, against the previous recommendation (the pass record). A review plan is a plan like any other: it lives under `docs/plans/`, is approved in the one ledger, and reads in the PR. The cost is accepted: each pass adds its plan and approval commits to the run branch.

Decision: plans-ledger — lifted, unattributed, 2026-09-28

### Q5 — How does `--append` identify oracle files before the oracle-separation lint exists?

- convention — A built-in convention (`*.test.*`, `*.spec.*`, files under `tests/` or `__fixtures__/`), replaced by the lint when it lands — abandons: Oracles outside the convention (matrices, fixtures elsewhere), which only compliance guards until the lint lands
- none — No refusal until the lint exists; compliance alone checks R4 — abandons: The mechanical guarantee that a fix never edits what judges it, which the first consumer relies on from its first pass
- config — A declared glob list in `phax.json` (`review.code.oracles`) — abandons: Zero configuration: it adds one more config key right before the 1.0 freeze, which the lint would then duplicate

Recommendation: none — Decided by the author on 2026-09-28, against the previous recommendation (a path convention). No convention is built only to be replaced: the compliance review checks R4 until the oracle-separation lint lands. The cost is accepted: no mechanical guarantee in the meantime.

Decision: none — lifted, unattributed, 2026-09-28

### Q6 — Does a finding left awaiting block approval and append of the review plan that carries it?

- no-block — No: the plan is approved and appended, and the awaiting finding is reported in the output, `phax ls`, `artifact status` and the PR's review passes — abandons: An operator deciding each unfixed finding before the pass's fixes land
- block — Yes: approval, append and the loop wait until an interactive review-plan decides it — abandons: An unattended loop: a single unfixed finding stalls every fix of its pass until an operator decides it

Recommendation: block — Decided by the author on 2026-09-28 for escalated findings, and restated on 2026-09-29 when machine decisions went (artifact-decide Q14): a finding a headless plan leaves unfixed is `awaiting` and blocks approval, append and the loop. Reworded on 2026-10-19 without escalation, which no longer exists.

Decision: block — lifted, unattributed, 2026-09-28

### Q7 — When is a finding `fixed`?

- committed — When an appended phase naming it reaches `committed`. The next pass's brief lists it as fixed, and a recurrence is a new finding — abandons: Verified-fix semantics: a `fixed` count can include a fix that the next review would re-raise as a new finding
- confirmed — Only when the next pass's review does not re-raise it — abandons: Determinism and the last pass: the outcome depends on a model's re-judgement, and after the bound a fix is never confirmed

Recommendation: committed — Decided by the author on 2026-09-28, as recommended. `committed` is a condition phax verifies itself (C4), with no model call. The next pass sees prior outcomes in its brief and reports what still fails as a new finding, so a false `fixed` stays visible in the review-passes table instead of being hidden.

Decision: committed — lifted, unattributed, 2026-09-28

### Q8 — Does a headless review plan decide the findings it does not fix?

- awaiting — No: it only plans fixes; an unfixed finding becomes `awaiting` and is decided in interactive mode — abandons: an unattended loop that classifies findings
- machine-escalates — Machine decisions that always escalate (the previous design) — abandons: one decision model across decide and review-plan

Recommendation: awaiting — Decided by the author on 2026-09-29, the same logic as artifact-decide: a machine writes the fixes, the operator decides.

Decision: awaiting — lifted, unattributed, 2026-09-29

### Q9 — Where does the review-passes table go in the short PR body?

- needs-review — A `### Review passes` subsection at the head of `## Needs your review`, never cut, with the awaiting and dismissed findings — abandons: A PR that opens on the passes: they come after the summary and the phase lines
- own-section — A `## Review passes` section between `## Phases` and `## Needs your review` — abandons: `## Needs your review` as the one place for what asks a person to act
- summary-line — One `**Review**` line in the summary with the pass and outcome counts — abandons: Seeing the awaiting findings in the PR without opening the handoff

Recommendation: needs-review — The short body already gathers what needs a person under `## Needs your review`. The passes and the findings that wait for the operator belong there, and pr-description §5.1 is amended by one subsection rather than a sixth section.

Decision: needs-review — by operator (Rémy Loubradou), 2026-10-19
Why: Decided by the operator on 2026-10-19, as recommended. The passes and the awaiting findings are what a reviewer must act on, so they lead the section that already says so. Advocate: A separate section would read before the attention points, and keep `## Needs your review` to the run's own deviations. Principles: none. Reversibility: cheap. Revised: §1, §5.79, §5.80, §5.81, §5.82, §6, §8.

### Q10 — What becomes of the decisions table, now that runs make no decision?

- drop — Drop it: dismissed and awaiting findings show in the review passes, and document arbitrations stay in the spec and plan — abandons: A view, in the PR, of the arbitrations of the run's documents
- all-sources — Keep it with spec verdicts, plan arbitrations and finding decisions, allowing rows with no arbiter or principles — abandons: The guarantee that every row names its arbiter and the principles it cites

Recommendation: drop — Lifted verdicts and technical arbitrations name no arbiter, and no run-time decision exists any more. The only decisions a run makes are the operator's finding decisions, which the review passes already list.

Decision: drop — by operator (Rémy Loubradou), 2026-10-19
Why: Decided by the operator on 2026-10-19, as recommended. The table's sources are gone or unattributed. Finding decisions show beside their findings, and document arbitrations stay where they were decided. Advocate: Keeping it would let a reviewer see in one place every choice the run rests on, including the spec's. Principles: none. Reversibility: cheap. Revised: §3, §4, §5.80, §6, §7, §8.

### Q11 — The run completes its plan and spec before `review_open`; how does a review plan keep its lineage?

- defer-completion — Complete after the review: with `review.code.enabled`, the run applies its completion when its PR becomes ready for review, after its last pass, so the spec stays Approved during the passes — abandons: Completion at the final phase: a run stopped mid-loop, or whose PR never becomes ready for review, leaves its plan and spec Approved
- spec-less — Review plans carry `source-spec: null` — abandons: Tying the fix phases to the spec, in the lineage and in the compliance review
- completed-spec — Let a review plan bind to a Completed spec, as an exception to the approval check — abandons: The rule that only an Approved spec is planned

Recommendation: defer-completion — A review plan is a plan of the run's spec, and the approval check wants that spec Approved. Deferring the completion keeps both true. A PR ready for review is the point after which no pass can append (§5.47), so that is where the run is done.

Decision: defer-completion — by operator (Rémy Loubradou), 2026-10-19
Why: Decided by the operator on 2026-10-19, as recommended, with the moment confirmed: the run's PR becoming ready for review, not merely opened. The completion is applied then, by `publish.auto` when nothing is pending or by `phax publish-pr` when it marks a draft ready. A run with `review.code.enabled` false completes at its final phase as before, and takes no pass. Advocate: Completing at the final phase keeps spec 27's single moment, and a branch merged by hand still carries its completion. Principles: none. Reversibility: costly. Revised: §1, §2, §4, §5.11, §5.12, §5.53, §5.64, §5.67, §5.68, §5.70, §5.73, §6, §8, §11.

### Q12 — The phase guard refuses `artifact approve` and `run` in a run's worktree; how does a person approve and append a review plan?

- run-target — From the checkout, the commands target the run: `phax artifact approve <plan> --run <run>`, `artifact status --run`, `plans lint --run`, and `phax run <run> --append --plan <plan>` act in the run's final worktree — abandons: The uniform rule that an artifact command acts on the repository it is run in
- final-worktree — Let the guard allow these commands in the final worktree of a `review_open` run — abandons: A guard with no exception: an agent in that worktree could approve its own plan
- pass-record — Re-decide Q4: the review plan lives in the run folder, approved in `pass.json`, outside `docs/plans/` — abandons: Review plans linted, inspected by `artifact status` and versioned like every plan

Recommendation: run-target — The review plan lives on the run branch (Q4), which the checkout does not see, and the guard must stay whole. A `--run` target lets a person reach the plan from where they stand, and only when they name the run.

Decision: run-target — by operator (Rémy Loubradou), 2026-10-19
Why: Decided by the operator on 2026-10-19, as recommended. The guard stays as it is. The commands name their run with `--run`, and act and commit in its final worktree. Advocate: Allowing the commands in the final worktree needs no new flag, and works where the reviewer is already reading the plan. Principles: none. Reversibility: cheap. Revised: §4, §5.37, §5.55, §5.56, §5.57, §5.78, §6, §7, §8, §11.

### Q13 — When the loop leaves a review plan pending or a finding awaiting, what pull request does the run open?

- hold — Hold: no PR until the operator resolves every pending item — abandons: A PR that always exists at the end of an auto-published run
- draft — Open the PR as a GitHub draft, naming the pending plan and the awaiting findings under `### Review passes`; it accepts appends, and `phax publish-pr` marks it ready once nothing is pending — abandons: A run's PR that is either absent or final: a draft can still change under its reader as appended phases are pushed, and readers must check its state
- ready — Open the PR ready for review regardless — abandons: Appending that plan: a run whose PR is ready refuses `--append`, so the pending fixes can never land in it

Recommendation: hold — A reviewer should never read a PR that may still change under them. Holding keeps the PR absent until the operator has decided every pending item, and then the run publishes once.

Decision: draft — by operator (Rémy Loubradou), 2026-10-19
Why: Decided by the operator on 2026-10-19, against the recommendation (hold). An auto-published run always ends with a PR, which shows where the run stands, and GitHub's draft state says it is not final. A draft accepts appends, and phax pushes after each so the PR follows. `phax publish-pr` refuses (exit 12) while an item is pending on a draft, and otherwise completes, pushes, rewrites the body and marks it ready. On a run with no PR, `phax publish-pr` also opens a draft under the same pending conditions rather than refusing, for symmetry with `publish.auto`: the same state yields the same PR whichever path publishes it. Advocate: Holding keeps a run's PR either absent or final, so no reviewer spends attention on a PR whose content can still change, and phax needs no draft, mark-ready or body-edit operation. Principles: none. Reversibility: cheap. Revised: §1, §3, §4, §5.47, §5.48, §5.64, §5.65, §5.69, §5.70, §5.71, §5.72, §5.73, §5.75, §5.76, §5.77, §5.78, §5.80, §6, §7, §8, §10, §11.

## 10. Implementation-planning note

Settled:

- The end of a run with `review.code.enabled` is: compliance, then the passes (each: compliance, code review, review plan, then approval and append under `append`). With nothing pending, the run completion then a PR ready for review follow. With a pending review item, `publish.auto` opens a draft PR and the completion waits for `phax publish-pr` to mark it ready (Q11, Q13).
- Two modes only, interactive and headless. Headless total is out.
- `review-code --headless` writes findings and stops. It is the same session as the interactive command, and the interactive `review-code` is untouched.
- `review-plan` (headless or interactive) turns a pass's findings into a review plan under `phax-decide-review` plus the caller's doctrine file.
- phax assigns finding ids (run-unique `F<n>` / `C<n>`), outcomes and history. The agent emits neither.
- Compliance `deviation` findings join a pass's `code-review.json` as their own variant.
- Each finding under consideration is named by exactly one phase or one decision. A decision chooses `dismiss` or `leave-open`.
- A headless review plan decides nothing: a finding it does not fix is `awaiting`; decisions are the operator's, in interactive mode (Q8).
- Outcomes are `fixed` | `open` | `dismissed` | `awaiting`, and decision history is append-only.
- Reversibility: phases are `cheap` or `costly` and never `irreversible`.
- No session on a `divergent` verdict (exit 1, `blocked-divergent`) or on a clean pass (exit 0, `clean`). A plan with no phase is `no-fix`.
- `--append` is a flag on the existing `phax run [short-name] --plan <path>` grammar, not the brief's positional sketch. It is the new transition `review_open → running`: appended phases are numbered after the run, worktrees chain from the previous tip, the run id and records lineage stay the same, the previous final phase is closed, the whole run is regenerated, and there is one PR.
- `--append` has six pre-start refusals with named exit families.
- `review.code.enabled` / `append` / `maxPasses` default to false / false / 1. `maxPasses` is 1–5 and `append` requires `enabled`. The loop stops on `clean`, `no-fix`, `blocked-divergent`, a failed append, or the bound.
- The PR body's `## Needs your review` opens with `### Review passes` for a run with a pass: the table, then the awaiting and dismissed findings. It is never cut, and a run with no pass gets today's body. There is no decisions table (Q9, Q10).
- §9 decided by the author on 2026-09-28: one deduplicated info list over the run (Q1); interactive review-plan resumes the headless session (Q3); review plans under `docs/plans/` on the run branch, approved like any plan and named `<stamp>-<slug>-review-NN-plan.md` (Q4); no oracle refusal in `--append`, compliance checks R4 (Q5); a finding left awaiting blocks approval, append and the loop (Q6, Q8); `fixed` at `committed` (Q7). Q2 is dropped with the decision class.
- Decided by the operator on 2026-10-19: the review passes head `## Needs your review` (Q9); no decisions table (Q10); run completion waits until the PR is ready for review (Q11); approval, status, lint and append reach the run with `--run` from the checkout (Q12); a pending review item opens the PR as a draft, against the recommendation to hold it, and `phax publish-pr` opens a draft too under the same conditions (Q13).
- Revised on 2026-10-19 to match main. Approvals are one record file per plan under `docs/plans/approvals/`. The loop's grant is `review-code-append` (kebab-case). Persisted documents carry `$schema` (`code-review`, `review-pass`), and session answers carry `version: 1`. Finding decisions use decide's verdict shape. Interactive review-plan is Claude Code only and hands its document back as decide does. The headless sections of `phax-decide-review` are rewritten. Q2 is dropped, and Q6 is reworded without escalation.
- The review plan's sidecar is a variant of the plan document (`kind: review-plan`), not a format of its own. It sits in the sidecar slot, beside a Markdown under `docs/plans/`. approve, status, the sync check and `migrate-documents` already decode that slot through the one plan-document decoder, so a union on `kind` keeps them working. A separate format there would be refused as an invalid sidecar.
- Settled in review on 2026-10-19, following Q4, Q11 and Q13:
  - Completion moves the run's appended review plans, then its plan, then its spec, past the chain gate.
  - Only the step that makes the PR ready applies the completion.
  - A new pass supersedes the previous pass's pending plan.
  - A failed loop step, including a failed compliance review, is pending and leaves a draft PR; `phax run` exits in that step's family (0 for compliance).
  - Only the original run, or a resume of its original phases, triggers the loop.
  - The PR's state is read live through `gh`, and a closed or merged PR is refused.
  - `pass.json` has a defined lifecycle.
  - The publish-pr steps are idempotent.

Left open:

- Cell and line wording of the review-passes subsection, output layouts, the run-directory layout (`review/pass-NN/`), and the spelling of the indicative `doctrine` / `minSeverity` keys.
- The steme protocol (§3.2, §5.6, §5.7, §6, §12.3) and steme-lab's `phax.schema.json` could not be read in the authoring session (permission denied). The review config shape was taken from `src/schemas/phaxConfig.ts`. A reviewer should check the pass order, the bound semantics (appends ≤ `maxPasses`, then one final review) and the exit families against protocol §5.6/§5.7.

Constraints:

- Compose the headless-authoring machinery of `phax artifact new plan --headless`: the JSON-only session, boundary decoding, the deterministic renderer, the sidecar, the cache seed, the commit trailer, the session record and the records writer. Do not fork it. Its target is the run's final-phase worktree instead of the checkout, its skill the review doctrine instead of `phax-planning`, and its document the plan document's `review-plan` variant. The variant's phase projection must be the extracted-plan schema itself.
- Add the `review_open → running` transition through the state reducer, and name and test it there. Appended phases reuse the existing phase lifecycle unchanged.
- Existing run-status and phase-status persisted formats gain no field. Pass data lives in new `$schema` documents (`code-review.json` as `code-review`, `pass.json` as `review-pass`), every field required, registered in `FORMAT_IDS` and snapshotted like every persisted format. A phase's origin is derived from them.
- The new `review.code` keys are optional at birth, so an existing config keeps loading. This is the same deliberate exception as the `authoring` keys, not a shim.
- The plan frontmatter gains a third variant for review plans, and the plan document a `review-plan` variant. Both are explicit per-variant shapes, not optional keys on the plan's.
- artifact-decide has landed. Adopt its verdict shape, principle-id collection, doctrine-file refusals, project-skill override and approver form unchanged. Rewrite the headless sections of `phax-decide-review` in the same plan that changes the decision checks, so the checks accept exactly what the revised skill instructs.
- When the oracle-separation lint lands, it adds the oracle refusal to the append (Q5).
- The review-passes subsection is rendered from the pass documents only, with no model call. This spec amends pr-description §5.1: the short body keeps its five sections, and `## Needs your review` gains `### Review passes` at its head for a run with a pass.
- Run completion moves only for a run with `review.code.enabled`, to the moment its PR becomes ready for review. Spec 27's completion, its chain gate and `source-spec-outcome.md` are otherwise unchanged, and the body's summary reads the outcome once the completion has been applied.
- The docs page `docs/review-as-plan.md` gets its entry in `site/pages.ts`.
- The GitHub edge gains four operations, driven through `gh`: create a draft PR, mark a PR ready for review, edit a PR's body, and read a PR's state (draft, ready, closed, merged). The plan designs how they reach the GitHub port, and where a run records that its PR is a draft.
- The phase guard's table gains `review-plan` as refused, and `plans lint` gains `--run`.

## 11. Docs page

Page: docs/review-as-plan.md

Reader: An operator or loop author who wants phax to review its own run and fix what the review finds, through phases, before the run completes its spec and opens its PR. They also need to see what a machine declined to fix, and why.

Example: Automatic: in `phax.json`, set "review": { "compliance": { "enabled": true }, "code": { "enabled": true, "append": true, "maxPasses": 2 } }. `phax run --plan <plan>` then runs at most two fix passes before it completes its plan and spec and opens its PR ready for review. A pending review plan or an awaiting finding opens the PR as a draft instead. `phax ls` shows fixed / awaiting / dismissed / open counts, and the PR's `## Needs your review` opens on the review passes.

By hand, with "code": { "enabled": true }, pass 1 runs and its plan is left Draft on the run branch:
1. Read the plan on the run branch, then `phax artifact approve docs/plans/2609251010-usage-cli-review-01-plan.md --run usage-cli --by operator`.
2. `phax run usage-cli --append --plan docs/plans/2609251010-usage-cli-review-01-plan.md`.
3. For the next pass: `phax review-code usage-cli --headless`, then `phax review-plan usage-cli --headless --min-severity concern`.
4. `phax review-plan usage-cli` (interactive, Claude Code) to decide awaiting findings.
5. `phax publish-pr usage-cli`. While something is pending, it opens a draft PR, or refuses on an existing draft. Once nothing is pending, it completes the plan and spec on the run branch, pushes, rewrites the body and marks the PR ready for review.

## 12. Decision log

- 2026-09-28 Q1 lifted whole-change — unattributed
- 2026-09-28 Q3 lifted resume — unattributed
- 2026-09-28 Q4 lifted plans-ledger — unattributed
- 2026-09-28 Q5 lifted none — unattributed
- 2026-09-28 Q6 lifted block — unattributed
- 2026-09-28 Q7 lifted committed — unattributed
- 2026-09-29 Q8 lifted awaiting — unattributed
- 2026-10-19 Q9 decided needs-review — operator (Rémy Loubradou) — revised 7 sections
- 2026-10-19 Q10 decided drop — operator (Rémy Loubradou) — revised 6 sections
- 2026-10-19 Q11 decided defer-completion — operator (Rémy Loubradou) — revised 14 sections
- 2026-10-19 Q12 decided run-target — operator (Rémy Loubradou) — revised 10 sections
- 2026-10-19 Q13 decided draft — operator (Rémy Loubradou) — revised 22 sections
