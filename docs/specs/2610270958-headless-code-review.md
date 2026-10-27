---
status: Draft
date: 2026-10-27
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---
# Headless code review

## 1. Context

`phax review-code <run>` opens an interactive, pre-prompted code-review session in the final-phase worktree of a `review_open` run. A run in any other state is refused with exit 1. The prompt carries three things: the worklist of files the global reconciliation flagged, the compliance review's attention points and deviations when the run has one, and the `phax-review` skill (the project's copy at `.claude/skills/phax-review/SKILL.md` in the run's worktree, else the bundled one). phax records the session in the run folder's `code-review-session.json` and resumes it on the next call unless `--new-session` is given. The model and effort come from `--model`/`--effort`, else `review.code.model`/`review.code.effort` in `phax.json`, else `claude-opus-5-5` at `high`. Under `review.code`, `phax.json` has only those two keys.

The `phax-review` skill tells the reviewer to use the change before reading its code and to work outside-in. Each finding states where it is, what is wrong and for whom, a severity (`bug`, `deviation`, `concern`, `info`), a lens (the step it was found in: `surface`, `acceptance`, `boundary`, `core`, `edge`, `tests`, `architecture`, `docs`), an escape (why the tests missed it: `wrong-oracle`, `same-author`, `weakened`, `fake-drift`, `unexplored-input`, `omission`, `untestable`), the acceptance criterion it touches, and a suggestion. That vocabulary exists only as prose today.

The compliance review is the code review's headless sibling. With `review.compliance.enabled`, it runs at the end of a run, once the final phase has committed, the run has applied its run completion and has become `review_open`, and before `publish.auto`. It runs under the read-only review posture: the session writes only under `.phax-context/`, runs git only, reaches only its provider, and fails closed. phax keeps its verdict as `compliance-review.json` in the run folder. A failure there never fails the run.

Headless authoring and `phax artifact decide --verdicts` set the answer pattern reused here. The session returns a versioned JSON answer with `$schema` first, phax checks it, and a refused first answer gets one corrective resume of the same session.

Since 0.28.0, an acceptance criterion has an id read from the source spec's JSON sidecar. `phax plans lint` checks criterion ids only when that sidecar exists.

Ground read:

- `docs/briefs/headless-code-review.md` — The brief, 2026-10-27. It settles the command, the answer, the criterion check, what phax keeps, resuming, the run-end setting and that no migration is needed. It leaves out review plans, append, the loop, outcomes, merged compliance findings, the PR body, phax-decide-review, phax ls and the review map.
- `docs/specs/2609250823-headless-review.md` — The Draft this spec splits from. It stays the source for the later spec. Nothing of its passes, outcomes, review plans or PR body is carried over. Its Q14 decision (check-sidecar, 2026-10-27) is the criterion rule settled here.
- `src/app/reviewCode.ts` — phax review-code builds its prompt from the global file reconciliation (the worklist), compliance-review.json and the phax-review skill (the project copy in the final-phase worktree, else the bundled one). It writes the prompt under .phax-context/ and records { provider, sessionId, worktreePath, createdAt, updatedAt } in the run folder's code-review-session.json. Unless --new-session is given, it resumes that session with no prompt. The provider comes from the final phase's agent binding.
- `src/cli/commands/reviewCode.ts` — It refuses with exit 1 a run that is not review_open, and resolves --model/--effort over review.code.model/effort, else claude-opus-5-5 at high.
- `.claude/skills/phax-review/SKILL.md` — The review skill. It lists the lens ids (surface, acceptance, boundary, core, edge, tests, architecture, docs), the escape ids (wrong-oracle, same-author, weakened, fake-drift, unexplored-input, omission, untestable), the four severities and the finding form. Its first step is to use the change before reading its code. Its 'In the session' section assumes a developer is present.
- `src/app/executePlan.ts` — The run end: run completion on the run branch, then FinalReviewOpened (the run becomes review_open, review-handoff.md is written), then the compliance review when review.compliance.enabled is set (a failure is swallowed), then publish.auto.
- `src/app/reviewCompliance.ts` — The compliance review runs headless under resolveReviewSecurityPolicy and persists compliance-review.json in the run folder, with $schema first.
- `src/domain/security/resolveReviewPolicy.ts` — The read-only review posture: writes only to .phax-context/, network provider-only, MCP disabled, agent commands limited to git, fail closed.
- `src/schemas/phaxConfig.ts` — review.compliance is { enabled (required), model?, effort? }. review.code is { model?, effort? } only.
- `src/schemas/schemaUrl.ts` — Every persisted or read format has a $schema URL <base>/<format-id>/<X.Y.Z>.json. The comment expects code-review to join with this work. Answer formats that phax reads but never writes (first-reading, decide-verdicts) are born with $schema.
- `src/app/authorArtifact.ts` — Headless authoring: a refused first answer gets one corrective resume of the same session. A refused retry fails, naming both refusals.
- `src/app/writeAuthoringRecord.ts` — An authoring record commits the session folder's prompt, accepted document and transcripts (as records.transcript decides) on phax/records/v1. Phase records are keyed <run-id>/<phase-id>.
- `docs/specs/archive/2610231041-test-strategy.md` — A criterion id is the id of one of the source spec's acceptance criteria, read from the spec's JSON sidecar. phax plans lint checks ids only when that sidecar exists.

## 2. Problem

A run's code review needs a person at the terminal. Nothing can review a run that no one is watching, and the review cannot run as part of the run itself.

What an interactive review finds stays in a conversation transcript. It is not a document, it has no ids, and nothing checks it. A finding's lens, escape and criterion, which the skill asks for, never leave the prose. So nothing after the review can tell which acceptance criterion a finding touches, or whether the tests let it through or could never have caught it. A criterion id the reviewer mistyped is never noticed.

A person who wants a machine to do the first pass of a review has no way to keep its findings and then pick up from them. The prompt could be printed for an outside agent, but that takes the review out of phax: no run folder, no records, and no session to resume.

## 3. Product goal

A run's code review can run with no one at the terminal. `phax review-code <run> --headless` reviews the change, following the same `phax-review` skill, without changing it. The session answers only with a versioned document of findings, each giving its severity, place, lens, escape, criterion and suggestion. phax checks the document against the review skill's vocabulary and the source spec's acceptance criteria. It numbers the findings and keeps each review as its own file in the run folder and in the run's records. The headless session becomes the run's recorded review session, so a person who then runs `phax review-code <run>` continues that same session, starting from its findings. An opt-in `phax.json` setting runs the headless review at the end of every run, after the compliance review. If it fails there, phax warns and the run is not failed.

> The headless review only reads and reports: phax keeps what it found, and the person continues in the same session.

## 4. Terminology

- **Headless code review** — One `phax review-code <run> --headless`, or its run-end equivalent. A code-review session runs with no terminal attached, follows the review skill, and ends with a code-review answer.
- **Review skill** — `phax-review`: the project's copy at `.claude/skills/phax-review/SKILL.md` in the run's final-phase worktree when it exists, else the bundled skill. It is chosen the same way as for the interactive command.
- **Code-review answer** — The JSON document a headless code-review session returns as its final message. Its `$schema` names the `code-review-answer` format. phax reads it and never writes it.
- **Finding** — One entry of a code-review answer. It has exactly eight keys, all required: `severity`, `file`, `line`, `message`, `lens`, `escape`, `criterion`, `suggestion`.
- **Lens** — The step of the review skill a finding was found in: `surface`, `acceptance`, `boundary`, `core`, `edge`, `tests`, `architecture` or `docs`. The set is closed and equals the skill's ids.
- **Escape** — Why the run's tests did not catch a finding: `wrong-oracle`, `same-author`, `weakened`, `fake-drift`, `unexplored-input`, `omission` or `untestable`. The set is closed and equals the skill's ids.
- **Criterion** — The `id` of one of the run's source spec's acceptance criteria that a finding touches, or null when it touches none.
- **Findings file** — `code-review-NN.json` in the run folder: one accepted headless code review, as phax keeps it. Its `$schema` names the `code-review` format.
- **Review number** — The `NN` of a findings file. It is the next number not yet used in the run folder, from 01, with at least two digits. It is also the file's `review` field.
- **Finding id** — `F1`, `F2`, … as phax assigns them, in answer order, within one findings file.
- **Recorded review session** — The session that `code-review-session.json` names for the run. `phax review-code` resumes it unless `--new-session` is given.
- **Criterion check** — How a findings file's criteria were checked. `checked`: against the source spec's JSON sidecar. `unchecked`: the source spec has no sidecar, so ids are kept as given. `no-spec`: the run has no source spec, so only null is accepted.

## 5. Functional requirements

### 5.1 Headless review

WHERE `--headless` is given to `phax review-code <run>` THE system SHALL run the code review with no terminal attached, in the run's final-phase worktree, with the prompt the interactive command builds, including the review skill.

### 5.2 Only a review_open run

IF the run is not `review_open` THEN `phax review-code <run> --headless` SHALL refuse with exit 1 before any session starts, naming the run's state.

### 5.3 Headless resumes the recorded session

WHEN `phax review-code <run> --headless` runs without `--new-session` on a run with a recorded review session THE system SHALL resume that session for the review, and otherwise SHALL start a new session.

### 5.4 A resume stays on its provider

IF a headless review would resume the recorded review session while the resolved model belongs to a different provider than the one that session ran on THEN the system SHALL refuse with exit 1 before any session starts, naming both providers and `--new-session`.

### 5.5 The review changes nothing

WHILE a headless code-review session runs THE system SHALL let it write no file of the worktree outside `.phax-context/`, and SHALL leave the run `review_open` whatever the review's outcome.

### 5.6 What the reviewer may run

WHILE a headless code-review session runs THE system SHALL let it run git and the commands `security.agentCommands` allows a phase, and no other command (default of question q-review-commands).

### 5.7 The headless prompt carries the answer contract

WHEN a headless code-review session starts THE system SHALL add to the interactive prompt the code-review answer's JSON Schema, an instruction that the answer is the session's only output, and, when the source spec has a JSON sidecar, the id and name of each of its acceptance criteria.

### 5.8 The code-review answer

WHEN a headless code-review session ends THE system SHALL accept as its result only a JSON code-review answer that meets every rule in this list: its `$schema` names the `code-review-answer` format, it holds only `$schema` and `findings`, each finding holds exactly `severity`, `file`, `line`, `message`, `lens`, `escape`, `criterion` and `suggestion`, `severity` is one of `bug`, `deviation`, `concern` or `info`, `lens` is a lens id, `escape` is an escape id, `file` is a path or null, `line` is a positive integer or null and is null whenever `file` is null, and `criterion` is a string or null.

### 5.9 The skill and the schema agree

The system SHALL accept as `lens` and `escape` exactly the ids that the bundled `phax-review` skill lists, and its test suite SHALL fail when the two differ.

### 5.10 A criterion the source spec lacks is refused

IF the run's source spec has a JSON sidecar and a finding's `criterion` is not the id of one of its acceptance criteria THEN the system SHALL refuse the answer, naming `findings[<n>].criterion` and the unknown id.

### 5.11 No source spec, no criterion

IF the run has no source spec and a finding's `criterion` is not null THEN the system SHALL refuse the answer, naming `findings[<n>].criterion`.

### 5.12 A spec without a sidecar keeps ids as given

WHERE the run's source spec has no JSON sidecar THE system SHALL keep each finding's `criterion` as the session gave it and mark the findings file's criterion check `unchecked`.

### 5.13 One corrective resume

WHEN the first code-review answer is refused THE system SHALL resume the same session once, with a prompt naming the refusal, and check its new answer by the same rules.

### 5.14 A refused review keeps nothing

IF the corrective answer is refused too, or the session fails, THEN the system SHALL exit 5 naming each refusal or the failure, SHALL write no findings file and no records entry, and SHALL leave `code-review-session.json` as it was before the command.

### 5.15 Finding ids

WHEN a code-review answer is accepted THE system SHALL give its findings the ids `F1`, `F2`, … in answer order, starting from `F1` in every findings file (default of question q-finding-ids).

### 5.16 Each review is its own file

WHEN a code-review answer is accepted THE system SHALL write it as `code-review-NN.json` in the run folder, under the next unused review number, and SHALL never overwrite an existing findings file.

### 5.17 A clean review is kept

WHEN an accepted code-review answer holds no finding THE system SHALL keep it as a findings file with an empty `findings` list.

### 5.18 The findings join the run's records

WHERE records are enabled THE system SHALL commit each findings file into the run's records as one entry per review number, beside the run's phase records.

### 5.19 The headless session becomes the recorded session

WHEN a code-review answer is accepted THE system SHALL record the session that produced it as the run's recorded review session.

### 5.20 What the command reports

WHEN a code-review answer is accepted THE system SHALL print the finding count per severity, the range of finding ids, the findings file's path and the command that continues the session, and SHALL exit 0.

### 5.21 The person continues the headless session

WHEN `phax review-code <run>` runs without `--headless` and without `--new-session` on a run whose recorded review session came from a headless review THE system SHALL open that session interactively, on the provider it ran on.

### 5.22 The interactive review stays a conversation

The system SHALL write no findings file and no records entry for `phax review-code <run>` without `--headless`.

### 5.23 Headless review at run end

WHERE `review.code.enabled` is true THE system SHALL run a headless code review at the end of every run, with `review.code.model` and `review.code.effort`, after the compliance review when it is enabled and before `publish.auto`.

### 5.24 A run-end review failure only warns

IF the run-end headless code review fails or is refused THEN the system SHALL still end the run `review_open` with the exit code it would have had without the review, and SHALL print a warning naming the failure and `phax review-code <run> --headless`.

### 5.25 Off by default

The system SHALL treat an absent `review.code.enabled` as false, so a `phax.json` without the key runs no headless review at run end.

## 6. Surface

### cli: phax review-code <run> --headless — normative

Summary: You can have a run's code reviewed with no one at the terminal, and phax keeps the findings with the run.

before:

    $ phax review-code usage-cli
    Starting code review session in <worktree>
    (an interactive session prompted to review the run; you take over)

after:

    $ phax review-code usage-cli --headless
    review-code usage-cli — headless — claude-opus-5-5 / high (new session)
    findings  bug 1 · deviation 1 · concern 2 · info 1   (F1–F5)
    kept      <run folder>/code-review-01.json   (records: written)
    continue  phax review-code usage-cli

    $ phax review-code usage-cli --headless
    ✗ review-code failed: the code-review answer was refused twice
      findings[0].criterion: "ac-prune-typo" is not an acceptance criterion of docs/specs/2610270900-usage-cli.md
      nothing kept
    $ echo $?
    5

    Exit codes: 0 kept · 1 the run is not review_open, or its session cannot be resumed · 5 the answer was refused twice, or the session failed · 8 a rate or usage limit · 11 the read-only sandbox is unavailable

### file: code-review answer — normative

Summary: A headless review answers with one versioned list of findings. Each finding says where it is, how severe it is, which review step found it, why the tests missed it and which acceptance criterion it touches.

    {
      "$schema": "https://docs.phax.run/schemas/code-review-answer/0.29.0.json",
      "findings": [
        { "severity": "bug", "file": "src/app/prune.ts", "line": 42,
          "message": "prune deletes a run whose worktree is still registered",
          "lens": "edge", "escape": "omission", "criterion": "ac-prune-live-worktree",
          "suggestion": "refuse when the registry lists a live worktree" },
        { "severity": "info", "file": null, "line": null,
          "message": "help says 'remove', the output says 'prune'",
          "lens": "surface", "escape": "untestable", "criterion": null,
          "suggestion": "say 'prune' in both" }
      ]
    }

### file: <run folder>/code-review-NN.json — normative

Summary: Each headless review leaves its own numbered findings file in the run folder, with an id on every finding, ready to read or script against.

    # <run folder>/code-review-01.json; the next review writes code-review-02.json
    {
      "$schema": "https://docs.phax.run/schemas/code-review/0.29.0.json",
      "review": 1,
      "reviewedAt": "2026-10-28T09:14:03Z",
      "model": "claude-opus-5-5",
      "effort": "high",
      "skill": "bundled",
      "criterionCheck": "checked",
      "findings": [
        { "id": "F1", "severity": "bug", "file": "src/app/prune.ts", "line": 42,
          "message": "prune deletes a run whose worktree is still registered",
          "lens": "edge", "escape": "omission", "criterion": "ac-prune-live-worktree",
          "suggestion": "refuse when the registry lists a live worktree" }
      ]
    }
    # skill: bundled | project · criterionCheck: checked | unchecked | no-spec

### file: the run's records — indicative

Summary: With records on, each headless review's findings are committed to the run's records beside its phases.

before:

    phax/records/v1
      <run-id>/phase-01/…
      <run-id>/phase-02/…

after:

    phax/records/v1
      <run-id>/phase-01/…
      <run-id>/phase-02/…
      <run-id>/code-review-01/code-review.json
      <run-id>/code-review-01/prompt.md
      <run-id>/code-review-01/transcript.jsonl   (as records.transcript says)

### cli: phax review-code <run> — indicative

Summary: Running `phax review-code <run>` after a headless review opens that review's session, so you start from its findings.

before:

    $ phax review-code usage-cli
    Resuming code review session in <worktree>
    (the session of your last interactive review)

after:

    $ phax review-code usage-cli --headless
    …
    kept      <run folder>/code-review-01.json

    $ phax review-code usage-cli
    Resuming code review session in <worktree>
    (the session opens on the headless review and its findings: ask about F2, or ask for a fix)

### config: phax.json review.code.enabled — normative

Summary: You can have every run review its own code headless when it ends, right after the compliance review.

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

### cli: phax run (run end) — indicative

Summary: A run with `review.code.enabled` ends with its code reviewed, and a failed review only warns, naming the command to retry it.

    $ phax run usage-cli --plan docs/plans/2610270930-usage-cli-plan.md
    …
    compliance   conformant
    code review  bug 1 · concern 2 (F1–F3) — <run folder>/code-review-01.json
    usage-cli is review_open

    ⚠ code review failed at run end: the code-review answer was refused twice
      usage-cli is review_open; retry with: phax review-code usage-cli --headless
    $ echo $?
    0

## 7. Non-goals

- Review plans, `phax review-plan`, and any plan of fixes built from findings.
- `phax run --append`, and any phase added to a run after `review_open`.
- Any review loop, any repeated pass at run end, and any bound on passes.
- Finding outcomes (fixed, dismissed, awaiting, open), finding history, and decisions about findings.
- Copying the compliance review's findings into a findings file: the compliance review keeps its own file.
- Any change to the PR body, to `phax publish-pr` or to `publish.auto`, beyond running before it.
- Any change to `phax-decide-review`.
- Any change to the text of the `phax-review` skill: the headless rules travel in the prompt, so a project's own copy works unchanged.
- New `phax ls` columns, and the review map (`review-map`).
- Finding ids that span reviews, or matching a finding across findings files.
- A findings document from an interactive session: the interactive review stays a conversation, and a later `--headless` resumes it to keep what it found.
- Migration: no findings file exists yet, so the format starts in this shape.

## 8. Acceptance criteria

### A headless review keeps its findings

Given a review_open run whose source spec has a JSON sidecar, and a review session that answers a valid code-review answer with three findings, when `phax review-code <run> --headless` runs with no terminal attached, then it exits 0, prints the counts per severity, `F1–F3`, the findings file's path and `phax review-code <run>`, and the run folder holds `code-review-01.json` whose findings are `F1`, `F2` and `F3` in answer order, each with its eight keys as answered and `criterionCheck` `checked`; the run is still review_open. (refs §5.1, §5.15, §5.16, §5.20)

### A second review never overwrites the first

Given a run folder that already holds `code-review-01.json`, when a second headless review is accepted, then `code-review-02.json` is written with `review` 2 and findings starting at `F1`, and `code-review-01.json` is byte-for-byte unchanged. (refs §5.16, §5.15)

### Only a review_open run is reviewed

Given a run in state `running`, when `phax review-code <run> --headless` runs, then it exits 1 naming the state `running`, and no session starts. (refs §5.2)

### The session changes no tracked file

Given a headless review session that tries to write a tracked source file of the worktree and a file under `.phax-context/`, when the review ends, then the tracked file is unchanged, the worktree outside `.phax-context/` shows the same `git status` as before the command, the file under `.phax-context/` exists, and the run is review_open. (refs §5.5)

### The reviewer runs git and the allowed commands only

Given a `phax.json` whose `security.agentCommands` allows `pnpm`, and a headless review session, when the session runs `git log`, `pnpm test` and `curl`, then `git log` and `pnpm test` run, and `curl` is refused. (refs §5.6)

### The prompt carries the contract and the criteria

Given a run whose source spec's sidecar lists the criteria `ac-a` and `ac-b`, when a headless review session starts, then its prompt holds the review skill, the code-review answer's JSON Schema, the instruction that the answer is its only output, and `ac-a` and `ac-b` with their names; for a run whose spec has no sidecar, the prompt lists no criterion. (refs §5.7)

### An answer outside the schema keeps nothing

Given a session whose answers, first and corrective, contain a finding with `"lens": "security"`, or a finding without `escape`, or an unknown key, or no `$schema`, or `file` null with `line` 12, when `phax review-code <run> --headless` runs, then it exits 5 naming the offending path, no `code-review-NN.json` and no records entry exist, and `code-review-session.json` is as it was before the command. (refs §5.8, §5.14)

### One corrective resume

Given a session whose first answer is not JSON and whose corrective answer is valid, when `phax review-code <run> --headless` runs, then the same session is resumed exactly once with a prompt naming the refusal, the corrective answer is kept as `code-review-01.json`, and the command exits 0. (refs §5.13)

### The skill and the schema stay equal

Given the bundled `phax-review` skill and the code-review answer schema, when the test suite runs, then a test asserts that the skill's lens ids equal the schema's `lens` literals and that its escape ids equal the `escape` literals, and it fails when either side has an id the other lacks. (refs §5.9)

### An unknown criterion is refused

Given a source spec whose sidecar has no criterion `ac-prune-typo`, and a session that answers it twice as `findings[0].criterion`, when `phax review-code <run> --headless` runs, then it exits 5 naming `findings[0].criterion` and `ac-prune-typo`, and nothing is kept. (refs §5.10)

### No source spec takes null only

Given a run with no source spec, when a headless review answers a finding with `"criterion": "ac-x"`, then, in another review, only null criteria, then the first is refused, naming `findings[0].criterion`, and the second is kept with `criterionCheck` `no-spec`. (refs §5.11)

### A spec without a sidecar keeps ids as given

Given a run whose source spec has no JSON sidecar, when a headless review answers `"criterion": "ac-anything"`, then the findings file keeps `ac-anything` and has `criterionCheck` `unchecked`. (refs §5.12)

### A clean review is kept

Given a session that answers `"findings": []`, when `phax review-code <run> --headless` runs, then it exits 0, reports no findings, and `code-review-01.json` exists with an empty `findings` list. (refs §5.17)

### The findings reach the records

Given records enabled, when a headless review is accepted as review 1, then the run's records gain one entry for `code-review-01` carrying the findings file, beside the run's phase records; with records disabled, only the run folder holds the file. (refs §5.18)

### Headless resumes the recorded session

Given a run whose recorded review session was started by an interactive `phax review-code <run>`, when `phax review-code <run> --headless` runs without `--new-session`, and later with `--new-session`, then the first resumes the recorded session id and keeps that id as the recorded session; the second starts a new session, and once its answer is accepted, `code-review-session.json` names the new session. (refs §5.3, §5.19)

### A resume across providers is refused

Given a recorded review session that ran on Claude Code, when `phax review-code <run> --headless --model <a model of another provider>` runs without `--new-session`, then it exits 1 naming both providers and `--new-session`, and no session starts. (refs §5.4)

### The person continues the headless session

Given an accepted headless review that started a new session, when `phax review-code <run>` runs without `--headless`, then it opens, interactively, the session whose id the headless review recorded, on that session's provider, and when the person exits, no new findings file and no records entry exist. (refs §5.21, §5.22)

### The run ends reviewed

Given `review.code.enabled` and `review.compliance.enabled` true, `publish.auto` true, and `review.code.model` `claude-opus-5-5` at `high`, when a run's final phase commits, then the compliance review runs, then a headless code review with `claude-opus-5-5` at `high` writes `code-review-01.json`, then the run is published; `phax run` exits 0 and the run is review_open. (refs §5.23)

### A failed run-end review only warns

Given `review.code.enabled` true and a review session whose two answers are refused (or that hits a usage limit), when a run's final phase commits, then `phax run` exits 0 as it would without the review, the run is review_open, no findings file exists, and a warning names the failure and `phax review-code <run> --headless`. (refs §5.24)

### Off unless enabled

Given a `phax.json` whose `review.code` holds only `model` and `effort`, when a run's final phase commits, then no headless code review runs and the run folder holds no `code-review-NN.json`. (refs §5.25)

## 9. Open questions

### q-review-commands — What may the headless reviewer run, besides reading files?

- git-only — git only, as the compliance review does — abandons: the review skill's first step: the reviewer cannot run the change before reading it, so the surface lens works from code and docs alone and misses what only running shows (output, error wording, exit codes)
- agent-commands — git plus the commands `security.agentCommands` allows a phase, under the same write jail and provider-only network — abandons: the compliance review's minimal posture: the reviewer can run whatever project commands read, and a command that must write outside `.phax-context/` (a build, a cache) fails inside the session

Recommendation: agent-commands — The skill puts 'use it before you read it' first, and the surface lens is where a review with no person finds what no test asserts. The write jail, not the command list, is what keeps the review read-only, so allowing the phase's commands gives up no guarantee. A command that fails on a refused write is a limit on the review, not a change to the worktree.

### q-finding-ids — Do finding ids restart at F1 in each findings file, or continue across a run's reviews?

- per-review — Each findings file numbers its findings from F1 — abandons: an id that names a finding across the run on its own: F3 of review 2 and F3 of review 1 are different findings, and the later spec must qualify ids by review number
- run-wide — Numbering continues from the run's earlier findings files — abandons: self-contained files: a review's ids depend on reading every earlier findings file, so an unreadable earlier file blocks or skews the next review, and a fresh review of an unchanged run gives the same findings new ids

Recommendation: per-review — A run-wide number does not say that F7 is F2 seen again. Identity across reviews belongs with the outcomes and history that the later spec designs anyway. Until then, a file that stands alone is the simpler thing to keep, and the review number already qualifies its ids.

## 9b. Arbitrated questions

None.

## 10. Implementation-planning note

Settled:

- The answer and the kept file are two formats, both born with `$schema` at 0.29.0. `code-review-answer` is the session's answer, which phax reads and never writes. `code-review` is the findings file, which phax writes. Neither has a pre-schema shape.
- The findings file holds `$schema`, `review`, `reviewedAt`, `model`, `effort`, `skill` (`bundled` or `project`), `criterionCheck` (`checked`, `unchecked` or `no-spec`) and `findings`. Each finding is `id` followed by the eight answer keys, unchanged.
- The headless prompt is the interactive prompt (worklist, compliance block, review skill), plus the answer contract and, when the sidecar exists, the source spec's criteria. The skill's text does not change.
- The criterion check reads the same acceptance-criterion ids from the source spec's JSON sidecar that `phax plans lint` reads for test lines.
- `code-review-session.json` changes only when an answer is accepted. A refused or failed review leaves it as it was, so a retry after a failed run-end review starts a new session.
- The run-end review runs where the compliance review runs today. The run is already `review_open` there: the brief's 'before the run becomes review_open' is read as before `phax run` returns and before `publish.auto`. The headless command's own precondition is `review_open`, and moving both reviews ahead of the transition would change compliance wiring that this spec leaves alone.
- The run-end review takes its model and effort from `review.code` only. It has no CLI override, and it always starts a new session, because a run that has just ended has no recorded review session.
- `review.code.enabled` is optional and defaults to false, like the existing optional `review.code` keys. No other `review.code` key is added.

Left open:

- The records entry: its key under the run (indicative `<run-id>/code-review-NN`), its manifest format, and which session files it carries beside the findings file.
- Whether the headless review's usage joins the run's cost ledger, as the compliance review's stream does.
- The exact wording of the command's output and of the run-end warning (§6 marks them indicative).
- How the headless invocation is built for each provider, and which providers support it. A provider without a headless code-review invocation is refused before any session, as the interactive command refuses an unsupported provider.

Constraints:

- The lens and escape literals have one source in the answer schema, and a test keeps them equal to the ids the bundled `phax-review` skill lists.
- A findings file is never overwritten, even when two headless reviews of the same run race for the same review number.
- The read-only guarantee is the review posture's filesystem jail (writes only under `.phax-context/`, fail closed), as for the compliance review. It is not the command allowlist.
- The headless session runs on a provider whose sessions the interactive command can resume, and `code-review-session.json` names that provider.
- The corrective resume follows the headless-authoring pattern: one resume of the same session, and a second refusal names both.
- Every external input (the answer, the source spec's sidecar, `code-review-session.json`) is decoded through a schema at the boundary, and all I/O goes through ports.
- No migration and no back-compat shim: the formats are new and every field is required.

## 11. Docs page

Page: docs/code-review.md

Reader: An operator who wants a run's code reviewed without driving the session, and then wants to pick up from its findings in that same session.

Example: `phax review-code usage-cli --headless` prints the finding counts and keeps `code-review-01.json`. The page shows that file. Then `phax review-code usage-cli` reopens the session on those findings, and `review.code.enabled` makes every run end that way.
