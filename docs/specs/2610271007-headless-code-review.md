---
status: Approved
date: 2026-10-27
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
approved:
  date: 2026-10-27
  baseline: ab4381c
---
# Headless code review

## 1. Context

When a run reaches review_open, phax can run two steps on its own, each turned on in phax.json: the compliance review (`review.compliance.enabled`) and the pull request (`publish.auto`). The compliance review runs first. It is a headless agent session under a read-only posture: it reads the worktree, writes only to `.phax-context`, runs only `git`, reaches only the provider, and uses no MCP server. It writes a versioned JSON answer (`version: 1`). phax decodes that answer strictly, refusing any unknown key, and writes `compliance-review.json` to the run folder with `$schema` in place of `version`. If the review fails, the run is not failed: the run stays review_open and the pull request is still written. The PR description then gives the compliance verdict and, under `## Needs your review`, a `### Compliance attention points` list. If no readable review exists, the description says `not reviewed` and leaves the list out. `phax review-compliance <run>` runs the same review by hand on a review_open run. It rewrites the file and does not touch an open pull request: a pull request that `phax publish-pr` reuses keeps its description.

Code review is interactive only. `phax review-code <run>` opens an agent session in the final worktree. The session's prompt carries the reconciliation's flagged files, the compliance findings and the `phax-review` skill (the project's copy on the run's branch, else the bundled one). phax records the session in `code-review-session.json` and resumes it next time unless `--new-session` is given. Its model and effort come from `review.code.model` and `review.code.effort` (claude-opus-5-5 at high by default); `review.code` has no on/off key. The skill defines a finding as where, what, severity (bug, deviation, concern, info), lens (surface, acceptance, boundary, core, edge, tests, architecture, docs), escape (wrong-oracle, same-author, weakened, fake-drift, unexplored-input, omission, untestable), criterion and suggestion.

The compliance review's files never reach the records. A record is one phase folder, committed under `<run-id>/<phase-id>` on `phax/records/v1`. `compliance-review.json` sits at the run folder's root, outside every phase folder.

Ground read:

- `src/app/reviewCompliance.ts` — The end-of-run compliance review: reads the plan, the reconciliation and the handoffs, runs a headless session under the review security policy, decodes its version-1 JSON answer and writes compliance-review.json to the run folder with $schema; every failure returns a result and never throws.
- `src/domain/review/compliancePrompt.ts` — The compliance prompt: ground rules, the closed enum values, and the two answer files the session writes under .phax-context.
- `src/schemas/complianceReview.ts` — The answer contract (version: 1, unknown keys refused) and the persisted file shape ($schema first, then the review).
- `src/domain/security/resolveReviewPolicy.ts` — The review posture: reads the worktree, writes only .phax-context, git is the only command, provider-only network, MCP disabled, fail-closed.
- `src/app/executePlan.ts` — At run end: FinalReviewOpened, then the compliance review when review.compliance.enabled (its failure caught and ignored), then publish when publish.auto.
- `src/app/finalReview.ts` — Opening the final review moves the run to review_open before either review runs.
- `src/app/publishRun.ts` — loadCompliance reads compliance-review.json; an absent or undecodable file reads as not reviewed. A reused pull request keeps its body.
- `src/domain/publish/prBody.ts` — The PR body: the Compliance summary fact, ### Compliance attention points under ## Needs your review only when reviewed, and the cut order deviations, attention points, notes.
- `src/cli/commands/reviewCompliance.ts` — phax review-compliance <run>: refuses unless review.compliance.enabled and the run is review_open; exits 1 naming the failure and the retry command; rewrites compliance-review.json and does not touch the PR.
- `src/schemas/phaxConfig.ts` — review.compliance { enabled, model?, effort? } (default claude-sonnet-5-5 medium); review.code { model?, effort? } (default claude-opus-5-5 high), with no enabled key.
- `src/app/reviewCode.ts` — phax review-code: the interactive session, its prompt (reconciliation worklist, compliance findings, the phax-review skill, project copy first), code-review-session.json, and resume through the final phase's binding provider unless --new-session.
- `src/domain/review/codeReviewPrompt.ts` — The interactive code review prompt and how the skill text is inlined.
- `.claude/skills/phax-review/SKILL.md` — The review doctrine: severities bug|deviation|concern|info, lenses surface|acceptance|boundary|core|edge|tests|architecture|docs, escapes wrong-oracle|same-author|weakened|fake-drift|unexplored-input|omission|untestable, and the finding form.
- `src/app/writeRecord.ts` — A record is one phase folder committed under <run-id>/<phase-id> on phax/records/v1; files at the run folder's root, compliance-review.json among them, are in no record.
- `src/schemas/costLedger.ts` — Cost ledger entries: phase roles plus a compliance entry with phase null.
- `src/schemas/schemaUrl.ts` — Format ids and $schema URLs <base>/<format-id>/<X.Y.Z>.json; a code-review id was anticipated but never added.

## 2. Problem

Nothing in phax reviews the code until a person sits down and runs `phax review-code`. The compliance review checks the work against the plan and, by design, not the code. A run can therefore open its pull request with nothing on it about what its tests could not see. A person who wants a machine to do the first code-review pass must open an interactive session and wait for it. The findings exist only in that conversation: not in the run folder, not in the pull request, and in no format another tool can read. The Draft `headless-review` spec tried to solve this with review plans, appended runs, a review loop and finding history. That is too much to ship, and the operator set it aside on 2026-10-27.

## 3. Product goal

Give the code review the same opt-in, run-end, headless form the compliance review already has. It follows the `phax-review` skill and returns a versioned list of findings. phax keeps the list as `code-review.json` in the run folder and lists the findings in the pull request. The session it ran in becomes the run's review session, so the person opens it with `phax review-code <run>` and asks for the fixes there. The same review can be run by hand on a review_open run.

> Wherever the compliance review already decides something, the headless code review does the same.

## 4. Terminology

- **headless code review** — A non-interactive agent session that reviews a review_open run's change by following the `phax-review` skill, and whose only output is a code-review answer. It runs at run end when `review.code.enabled` is true, or by hand with `phax review-code <run> --headless`.
- **code-review answer** — The JSON document the headless code review returns: `version: 1` and `findings`. phax checks it before keeping anything.
- **finding** — One problem the review reports, with eight required keys: `severity`, `file`, `line`, `message`, `lens`, `escape`, `criterion`, `suggestion`.
- **closed id sets** — The exact values `severity`, `lens` and `escape` accept: the ids the bundled `phax-review` skill lists, and no others.
- **code-review.json** — The run folder file phax writes from an accepted answer: `$schema` first, then the findings. It is written only when an answer is accepted.
- **run's review session** — The session `code-review-session.json` names, which `phax review-code <run>` resumes unless `--new-session` is given.
- **accepted / refused** — An answer is accepted when it parses and matches the code-review answer contract exactly. Otherwise it is refused, and phax keeps nothing from it.
- **review entry** — A run-level entry on `phax/records/v1`, beside the run's phase records, that carries one review's file: `code-review.json` for the code review, `compliance-review.json` for the compliance review. Both reviews use the same entry shape.

## 5. Functional requirements

### 5.1 The review runs at run end when turned on

WHERE `review.code.enabled` is true THE system SHALL run the headless code review when a run reaches `review_open`, after the compliance review and before the pull request is written.

### 5.2 Off by default

WHEN a run reaches `review_open` with `review.code.enabled` absent or false THE system SHALL run no headless code review.

### 5.3 Model and effort

The headless code review shall run on the model and effort that `review.code.model` and `review.code.effort` resolve to, the same ones `phax review-code` uses.

### 5.4 The session follows the review skill

The headless code review's prompt shall carry the `phax-review` skill (the project's copy on the run's branch, else the bundled one) and the worklist `phax review-code` gives its session: the files the reconciliation flagged and the compliance findings.

### 5.5 The compliance review's posture

The headless code review shall run under the compliance review's posture: it reads the run's worktree, writes nothing but its answer, runs `git` as its only command, reaches no network beyond the provider, and uses no MCP server.

### 5.6 A versioned answer

The headless code review's only output shall be a code-review answer holding `version: 1` and `findings`, each finding with `severity`, `file`, `line`, `message`, `lens`, `escape`, `criterion` and `suggestion`, all required.

### 5.7 Answer checking

IF the answer does not parse, lacks a key, carries an unknown key, or holds a `severity`, `lens` or `escape` outside its closed set THEN the system SHALL refuse it and write no `code-review.json`.

### 5.8 The schema and the skill agree

The closed sets of `severity`, `lens` and `escape` shall equal the ids the bundled `phax-review` skill lists.

### 5.9 References recorded as given

The system shall record a finding's `criterion` (an acceptance-criterion id or null), `file` and `line` exactly as the answer gives them, without checking them against the spec or the worktree.

### 5.10 code-review.json

WHEN an answer is accepted THE system SHALL write `code-review.json` in the run folder, `$schema` first, then the findings in the answer's order.

### 5.11 The run's review session

WHEN an answer is accepted THE system SHALL record the headless session in `code-review-session.json` as the run's review session, with the provider that ran it.

### 5.12 Fixing in the resumed session

WHEN `phax review-code <run>` runs without `--new-session` on a run whose review session is a headless one THE system SHALL resume that session interactively, on the provider that ran it.

### 5.13 A failed review never fails the run

IF the headless code review's session fails or its answer is refused at run end THEN the system SHALL leave the run in `review_open`, still write the pull request, and leave `code-review.json` and `code-review-session.json` as they were.

### 5.14 Findings in the pull request

WHERE the run folder holds a readable `code-review.json` when the pull request description is written THE system SHALL list its findings under `### Code review findings`, right before `### Unexplained deviations` (after `### Compliance attention points` when it is shown), one line per finding with its severity, `file:line` and message.

### 5.15 No review, no heading

WHEN the run folder holds no readable `code-review.json` as the pull request description is written THE system SHALL leave out the `### Code review findings` heading.

### 5.16 Cut order

WHEN the pull request description exceeds its size cap THE system SHALL cut code review findings after the compliance attention points and before the review notes, and close the list with a line counting the cut findings.

### 5.17 By hand

WHEN `phax review-code <run> --headless` runs on a `review_open` run THE system SHALL run the headless code review in a new session, whether or not `review.code.enabled` is true.

### 5.18 By hand: review_open only

IF `phax review-code <run> --headless` runs on a run that is not `review_open` THEN the system SHALL exit 1 naming the run's state.

### 5.19 By hand: accepted

WHEN a by-hand answer is accepted THE system SHALL replace `code-review.json` and `code-review-session.json`, print the finding count by severity and the command that resumes the session, and exit 0.

### 5.20 By hand: failed

IF a by-hand review's session fails or its answer is refused THEN the system SHALL exit 1 naming the reason and the retry command, and leave `code-review.json` and `code-review-session.json` as they were.

### 5.21 By hand: the pull request is left alone

`phax review-code <run> --headless` shall leave an open pull request's description as it is.

### 5.22 Its cost is in the ledger

WHEN a headless code review's session ends THE system SHALL enter its cost in the run's cost ledger as a `code-review` entry, as it enters the compliance review's cost.

### 5.23 The code review reaches the records

WHERE records are enabled THE system SHALL commit each accepted `code-review.json` to the run's records as a review entry, beside the run's phase records, so that a later accepted review replaces the entry's file and the earlier one stays in the records branch's history.

### 5.24 The compliance review reaches the records

WHERE records are enabled THE system SHALL commit each generated `compliance-review.json` to the run's records as a review entry, beside the run's phase records.

### 5.25 One entry shape for both reviews

The code review's entry and the compliance review's entry shall have the same shape, differing only in the review they carry.

### 5.26 A records failure never fails a review

IF committing a review entry to the records fails THEN the system SHALL keep the review's file in the run folder, leave the run in `review_open`, and report the failure as `phax records status` reports a pending push.

## 6. Surface

### config: review.code.enabled — normative

Summary: Setting `review.code.enabled` to true in phax.json runs a code review on its own each time a run reaches review, after the compliance review and before the pull request.

before:

    "review": {
      "compliance": { "enabled": true },
      "code": { "model": "claude-opus-5-5", "effort": "high" }
    }

after:

    "review": {
      "compliance": { "enabled": true },
      "code": { "enabled": true, "model": "claude-opus-5-5", "effort": "high" }
    }

### file: <run folder>/code-review.json — normative

Summary: A run's code review findings are kept in `code-review.json` in its run folder, one entry per finding with its severity, place, lens, escape, criterion and suggestion.

    {
      "$schema": "https://docs.phax.run/schemas/code-review/0.29.0.json",
      "findings": [
        {
          "severity": "bug",
          "file": "src/cli/greet.ts",
          "line": 42,
          "message": "An empty --name prints `Hello, !` instead of being refused.",
          "lens": "surface",
          "escape": "unexplored-input",
          "criterion": "ac-empty-name",
          "suggestion": "Refuse an empty --name with exit 2 and add an example test for it."
        }
      ]
    }

### internal: the headless code review's answer — normative

Summary: The headless code review session answers with a versioned list of findings, and phax refuses an answer with an unknown key or a severity, lens or escape the review skill does not list.

    {
      "version": 1,
      "findings": [
        {
          "severity": "bug | deviation | concern | info",
          "file": "<path in the worktree>",
          "line": 42,
          "message": "<what is wrong, for whom>",
          "lens": "surface | acceptance | boundary | core | edge | tests | architecture | docs",
          "escape": "wrong-oracle | same-author | weakened | fake-drift | unexplored-input | omission | untestable",
          "criterion": "<acceptance-criterion id> | null",
          "suggestion": "<what would fix it>"
        }
      ]
    }

### cli: phax review-code --headless — normative

Summary: Running `phax review-code <run> --headless` runs the code review without a person on a run in review, writes its findings to the run folder, and leaves the session ready to resume.

before:

    $ phax review-code greet-cli
    Starting code review session in ~/.phax/worktrees/acme.greet-cli/phase-03

after:

    $ phax review-code greet-cli --headless
    Code review: 2 findings (1 bug, 1 concern)
    Findings: ~/.phax/runs/acme.greet-cli/code-review.json
    Fix them in the session: phax review-code greet-cli

    $ phax review-code greet-cli --headless
    Code review failed: answer refused: findings[0].lens: "security" is not a lens. To retry, run: phax review-code greet-cli --headless
    $? = 1

### cli: phax review-code — indicative

Summary: After a run's headless code review, `phax review-code <run>` reopens that review's session, so you can ask it to fix what it found.

before:

    $ phax review-code greet-cli
    Starting code review session in ~/.phax/worktrees/acme.greet-cli/phase-03

after:

    $ phax review-code greet-cli
    Resuming code review session in ~/.phax/worktrees/acme.greet-cli/phase-03

### file: the pull request description — normative

Summary: A run's pull request lists each code review finding, with its severity, file and line, next to the compliance attention points.

before:

    ## Needs your review

    ### Compliance attention points

    - Phase 02 renamed the --name flag without a plan note.

    ### Unexplained deviations

    None.

after:

    ## Needs your review

    ### Compliance attention points

    - Phase 02 renamed the --name flag without a plan note.

    ### Code review findings

    - **bug** `src/cli/greet.ts:42` — An empty --name prints `Hello, !` instead of being refused.
    - **concern** `tests/greet.test.ts:18` — The greeting test restates the code's output instead of ac-greet.

    ### Unexplained deviations

    None.

### file: <run folder>/cost-ledger.json — indicative

Summary: A run's cost ledger counts its headless code review, as it counts its compliance review.

before:

    { "role": "compliance", "phase": null, "completeness": "complete", "provider": "claude-code", "costUsd": 0.41, … }

after:

    { "role": "compliance", "phase": null, "completeness": "complete", "provider": "claude-code", "costUsd": 0.41, … }
    { "role": "code-review", "phase": null, "completeness": "complete", "provider": "claude-code", "costUsd": 1.87, … }

### file: the run's records on phax/records/v1 — indicative

Summary: With records on, each run's code review and compliance review are kept in its records beside its phases, so they outlive the run folder.

before:

    phax/records/v1
      acme.greet-cli-3f2a/01-parser/
      acme.greet-cli-3f2a/02-cli/
      acme.greet-cli-3f2a/03-docs/

after:

    phax/records/v1
      acme.greet-cli-3f2a/01-parser/
      acme.greet-cli-3f2a/02-cli/
      acme.greet-cli-3f2a/03-docs/
      acme.greet-cli-3f2a/compliance-review/compliance-review.json
      acme.greet-cli-3f2a/code-review/code-review.json

## 7. Non-goals

- Review plans, `phax review-plan`, `phax run --append`, or any review loop.
- Finding outcomes, finding history, or numbered reviews: `code-review.json` holds the latest accepted review and nothing else; earlier ones live only in the records branch's history.
- Merging the compliance findings into `code-review.json`: each review keeps its own file.
- Updating an open pull request's description after a by-hand review.
- A code review fact in the PR summary line, or a code review section in `review-handoff.md`.
- Running the change during the headless review: under the compliance posture, its only command is `git`.
- `phax ls` columns, changes to `phax-decide-review`, and the review map.
- A cost estimate for the code review in `phax plans estimate`.
- Migration: the setting and the file are new, and no review entry is written for runs that finished before this change.
- Session transcripts of the reviews in the records: a review entry carries the review's file only.

## 8. Acceptance criteria

### The review runs between compliance and the pull request

Given phax.json with `review.compliance.enabled`, `review.code.enabled` and `publish.auto` all true, when a run reaches `review_open`, then the headless code review's session starts after the compliance review has written `compliance-review.json` and before the pull request is created, `code-review.json` exists in the run folder, and the pull request description holds `### Code review findings`. (refs §5.1, §5.10, §5.14)

### Off by default

Given phax.json whose `review.code` holds only `model` and `effort`, and `publish.auto` true, when a run reaches `review_open`, then no code review session runs, the run folder holds no `code-review.json`, and the pull request description has no `### Code review findings` heading. (refs §5.2, §5.15)

### review.code picks the model

Given `review.code` with `enabled: true`, `model: "claude-sonnet-5-5"` and `effort: "medium"`, when the headless code review runs, then its session runs on claude-sonnet-5-5 at medium effort. (refs §5.3)

### The project's skill wins

Given a run whose branch carries `.claude/skills/phax-review/SKILL.md` and a run without one, when the headless code review runs on each, then the first prompt carries the project copy's text and the second the bundled skill's, and both carry the files the reconciliation flagged and the compliance findings. (refs §5.4)

### Read-only

Given a headless code review session, when it tries to write a tracked file or run a command other than `git`, then the attempt is refused and the worktree's tracked files are unchanged. (refs §5.5)

### An accepted answer becomes code-review.json

Given an answer with `version: 1` and one finding carrying all eight keys, `criterion` null, when phax checks it, then `code-review.json` holds `"$schema": "https://docs.phax.run/schemas/code-review/0.29.0.json"` followed by that finding, with no `version` key. (refs §5.6, §5.10)

### A refused answer leaves no file and does not fail the run

Given in four runs, an answer with `"lens": "security"`, one missing `suggestion`, one carrying an unknown key `confidence`, and one that is not JSON, when each run reaches `review_open` with `review.code.enabled` and `publish.auto` true, then no `code-review.json` exists, the run is `review_open`, and the pull request opens without `### Code review findings`. (refs §5.7, §5.13, §5.15)

### Skill and schema stay equal

Given the bundled `phax-review` skill and the code-review answer contract, when a severity, lens or escape id is in one but not the other, then a test fails naming the id. (refs §5.8)

### References are not checked

Given an answer whose finding names `"criterion": "ac-nope"`, which no acceptance criterion bears, and a `file` absent from the worktree, when phax checks it, then it is accepted and `code-review.json` holds both values as given. (refs §5.9)

### The person fixes in the review's own session

Given a run whose run-end code review was accepted, when `phax review-code <run>` runs, then it prints `Resuming code review session`, opens interactively the session id that `code-review-session.json` records, on the provider that ran the review; with `--new-session` it starts a new session. (refs §5.11, §5.12)

### A failed session does not fail the run

Given a run with no `code-review-session.json` whose run-end code review session exits with an error, when the run end goes on, then the run is `review_open`, the pull request is written, and neither `code-review.json` nor `code-review-session.json` exists. (refs §5.13)

### One line per finding

Given `code-review.json` with a `bug` at `src/cli/greet.ts` line 42 and a `concern` at `tests/greet.test.ts` line 18, when the pull request description is written, then `### Code review findings` follows `### Compliance attention points` and precedes `### Unexplained deviations` and lists `- **bug** \`src/cli/greet.ts:42\` — <message>` then the concern's line, in the file's order. (refs §5.14)

### Findings are cut before the notes

Given a description that is still over its cap after cutting every unexplained deviation and every compliance attention point, when the description is written, then code review findings are cut, a line `- …and N more code review findings` closes their list, and review notes are cut only if cutting every finding was not enough. (refs §5.16)

### By hand, without the setting

Given a `review_open` run, with `review.code.enabled` absent, whose run end ran no code review, when `phax review-code <run> --headless` runs and its answer, holding one `bug` and one `concern`, is accepted, then it writes `code-review.json` and `code-review-session.json`, prints `Code review: 2 findings (1 bug, 1 concern)` and `Fix them in the session: phax review-code <run>`, and exits 0. (refs §5.17, §5.19)

### By hand, again

Given a run with an accepted `code-review.json` and a recorded review session, when `phax review-code <run> --headless` runs and its new answer is accepted, then `code-review.json` holds only the new findings and `code-review-session.json` names the new session. (refs §5.17, §5.19)

### By hand, only in review

Given a run in state `running`, when `phax review-code <run> --headless` runs, then it exits 1 naming the state `running` and no session starts. (refs §5.18)

### By hand, refused

Given a run with an accepted `code-review.json` and a recorded review session, when `phax review-code <run> --headless` runs and its answer is refused, then it exits 1 naming the refusal and `phax review-code <run> --headless`, and both files are byte-identical to before. (refs §5.20)

### By hand, the pull request is untouched

Given a run with an open pull request, when `phax review-code <run> --headless` runs and its answer is accepted, then the pull request's description is unchanged. (refs §5.21)

### Cost entry

Given a headless code review run on claude-code, when its session ends, then the run's `cost-ledger.json` gains one entry with `"role": "code-review"` and `"phase": null`. (refs §5.22)

### The code review is kept in the records

Given records enabled and a run whose headless code review was accepted, when the review is accepted, then the run's records hold a review entry carrying that `code-review.json`, beside the run's phase records; after a by-hand review is accepted, the entry carries the new file and the earlier file is still in the records branch's history; with records disabled, only the run folder holds the file. (refs §5.23)

### The compliance review is kept in the records

Given records enabled and a run whose compliance review generated `compliance-review.json`, when the review is generated, then the run's records hold a review entry carrying that `compliance-review.json`, beside the run's phase records. (refs §5.24)

### Both entries read alike

Given a run whose records hold a code review entry and a compliance review entry, when the two entries are compared, then they have the same shape and differ only in the review they name and carry. (refs §5.25)

### A records failure keeps the review

Given records enabled, a review that was accepted, and a records commit that fails, when the review ends, then the review's file is in the run folder, the run is `review_open`, and the failure is reported as a pending records write. (refs §5.26)

## 9. Open questions

None.

## 9b. Arbitrated questions

### q-records — The brief settles that phax writes `code-review.json` "into the records, as it does `compliance-review.json`". But `compliance-review.json` reaches no record: a record is one phase folder, and the file sits at the run folder's root. Which half of that decision holds?

- run-folder — Write `code-review.json` to the run folder only, where `compliance-review.json` lives today — abandons: keeping the findings past the run folder: `phax prune` deletes them, and `phax/records/v1` holds no copy
- records-entry — Also commit `code-review.json` to `phax/records/v1` as a new run-level entry — abandons: the mirror and the small size: it needs a records key and manifest that the compliance review lacks, which is where the abandoned spec started growing

Recommendation: run-folder — The guiding rule is to do what the compliance review does, and the compliance review keeps its file in the run folder only. Both reviews should reach the records together, in one later spec, not one of them by itself here.

Decision: records-entry — by operator (Rémy Loubradou), 2026-10-27
Why: The operator wants both reviews in the records: compliance-review.json is missing from them only because records did not exist when the compliance review was built. code-review.json is committed to phax/records/v1 as a run-level entry, and compliance-review.json joins it through the same entry shape, designed once for both reviews. The compliance review's entry ships in its own plan of this spec, separate from the headless code review's plan. Advocate: The strongest case for run-folder: it keeps this spec small and mirrors the compliance review exactly, and the records entry needs a key and a manifest nothing has yet, which is where the abandoned headless-review spec began to grow. Principles: S2, S4. Reversibility: costly. Revised: requirements, surface, acceptanceCriteria, nonGoals, terminology, planningNote.
Earlier decision: run-folder — by operator (Rémy Loubradou), 2026-10-27

## 10. Implementation-planning note

Settled:

- Placement and failure behaviour follow the compliance review: the step runs after it and before publish, and any failure is caught, so the run stays review_open and publish still runs.
- Answer checking follows the compliance review: the answer carries `version: 1` and is decoded with unknown keys refused; the persisted file replaces `version` with `$schema`. `code-review` is a new format id, born with `$schema` at 0.29.0, with no pre-schema shape.
- The answer has no Markdown companion, unlike compliance-review.md. A missing or refused answer therefore counts as a failed review, not as a review with an unknown verdict.
- `review.code.enabled` is optional and false when absent: `review.code` already exists with only `model` and `effort`, so making the key required would break every phax.json that sets them. It governs the run end only.
- `phax review-code <run> --headless` does not require `review.code.enabled`. The interactive `phax review-code` has never needed a switch, and a by-hand review exists for runs that ended without one. This differs from `phax review-compliance`, which refuses when its switch is off.
- Only an accepted answer writes anything. `code-review.json` and `code-review-session.json` are replaced together or left as they were, so the file always matches the session that produced it.
- A by-hand review always starts a new session and never updates the pull request, as `phax review-compliance` does not. A pull request that `phax publish-pr` reuses keeps its description.
- `file` is a non-empty path and `line` a positive integer, neither nullable. A finding about a surface (output, docs, wording) names the file that produces it. `criterion` is an id string or null. None of the three is checked.
- The closed sets come from the bundled skill. A project's own skill copy cannot widen them, and the prompt lists the allowed ids, as the compliance prompt lists its enums.
- Findings appear in the PR in the answer's order (the skill asks for most severe first). With zero findings, the heading shows `None.`, as other empty lists do.
- The cost ledger gains a `code-review` role with `phase: null`, which is a new cost-ledger shape at 0.29.0. Ledgers written earlier still read.
- Both reviews reach the records (q-records, operator verdict of 2026-10-27): `code-review.json` and `compliance-review.json` are each committed as a run-level review entry on `phax/records/v1`, through one entry shape designed once for both. The compliance review lacked an entry only because records did not exist when it was built.

Left open:

- The exact wording of the by-hand output lines and of the PR finding line, beyond the normative heading and the severity, `file:line` and message it carries.
- The review entry's key under the run, its manifest format and its `$schema` (indicative in the surface: `<run-id>/code-review` and `<run-id>/compliance-review`), to be fixed once for both reviews.

Constraints:

- Resume must use the provider recorded for the review session. Today's resume path takes the provider from the final phase's binding, which can differ from the provider `review.code.model` resolves to.
- The headless prompt must replace the skill's in-session steps (wait for the developer, apply a fix once confirmed): the headless session applies no fix and writes only its answer.
- Reuse the compliance review's security policy unchanged. The skill's "use it before you read it" step becomes a read of the surface (help text, docs, examples, tests), because the session cannot run the change.
- A test reads the bundled `phax-review` SKILL.md and asserts that its severity, lens and escape ids equal the answer contract's literals.
- The review entry shape is designed once, for both reviews. Its plan is the first of this spec's plans; the compliance review's entry ships in its own plan of this spec, separate from the headless code review's plan, so the code review's plan builds on the entry shape and does not carry the compliance entry.
- A review entry commits like a phase record: on `phax/records/v1`, without touching the working tree or index, and best-effort, so a failed commit never fails a review.

## 11. Docs page

Page: README.md — Review and land

Reader: An operator who wants a machine to do a code review pass each time a run reaches review, then fix the findings with it

Example: Set `"review": { "code": { "enabled": true } }`. When the run's pull request opens, read `### Code review findings` and run `phax review-code <run>` to resume the session that found them and ask for the fixes. To review a run that ended without the setting, use `phax review-code <run> --headless`.

## 12. Decision log

- 2026-10-27 q-records decided run-folder — operator (Rémy Loubradou)
- 2026-10-27 q-records decided records-entry — operator (Rémy Loubradou) — revised 6 sections
