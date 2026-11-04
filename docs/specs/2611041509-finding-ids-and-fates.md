---
status: Draft
date: 2026-11-04
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---
# Finding ids and fates

## 1. Context

phax records two kinds of review of a run. The headless code review (`phax review-code --headless`) writes `code-review.json` into the run folder and records it on `phax/records/v1` under `<runId>/code-review`. Each finding has `severity` (bug, deviation, concern, info), `file`, `line`, `message`, `lens`, `escape`, `criterion` and `suggestion`. The compliance review (`phax review-compliance`) writes `compliance-review.json` and records it under `<runId>/compliance-review`. Its findings sit in `perPhase[].findings[]`, each with `dimension`, `severity` (info, deviation, concern) and `message`. Both files are strict, `$schema`-stamped documents, and each is the session's answer as it came. Neither finding carries an id. A second review of the same run replaces the file in the run folder, and the records branch keeps the earlier one in its history.

In the phax repository on 2026-11-04 the records held 10 headless code reviews with 51 findings (bug 4, deviation 9, concern 25, info 13; escapes: untestable 19, omission 12, unexplored-input 9, fake-drift 5, same-author 5, weakened 1) and 10 compliance reviews. Since September, 68 review-fix commits on `main` carry `Short-Name: <run>` and no `Run-Id`. Their bodies are free bullets, and nothing links a commit to the finding it addresses.

The operator's flow today: the review runs while the run is `review_open`. The operator addresses the findings by hand in the run's final worktree (`phax enter`) and lands them all in one commit.

phax already writes and reads the trailers `Run-Id`, `Phase-Id`, `Short-Name`, `Decision-Id` and `Authoring-Id`. Artifact transitions (`phax artifact approve` and the others) make a path-scoped commit of exactly what they wrote, with a clean-file precondition. `phax artifact decide` stamps a decided verdict: chosen, abandoned, why, advocate, principles, reversibility, by, at, revised.

The Draft headless-review spec (2026-09-25) already defines a **Finding id**: run-unique, assigned by phax, `F<n>` for review findings and `C<n>` for compliance findings, numbering continued across passes. It also defines finding **outcomes** (fixed, open, dismissed, awaiting) with an append-only history in the decided-verdict shape. Only its headless code review has shipped. This spec takes the id and the fate on their own, without `review-plan` or `run --append`.

Ground read:

- `docs/briefs/finding-ids-and-fates.md` — The brief: why (knowledge index use 3), what the records hold today (51 code-review findings, compliance findings, 68 review-fix commits, none linked), the eight settled decisions and the five open questions.
- `docs/briefs/knowledge-index.md` — Use 3, escapes: join a finding's lens and escape to its fate; the data gap is a finding id and a disposition.
- `src/schemas/codeReview.ts` — The code-review answer and file are one strict shape, `{ $schema, findings }`, each finding with severity, file, line, message, lens, escape, criterion, suggestion; no id. A rerun of the review overwrites the run folder's file.
- `src/schemas/complianceReview.ts` — perPhase[].findings[] carry dimension, severity (info, deviation, concern) and message; no id. Answer and file are one strict shape.
- `src/schemas/reviewRecord.ts` — A review record is keyed `<runId>/<review>` on phax/records/v1 and carries the review's file byte for byte plus a manifest.
- `src/app/writeReviewRecord.ts` — How a review record is committed to phax/records/v1 (trailers Run-Id, Review) and how a failed record write degrades to a warning naming a retry.
- `src/app/reviewCode.ts` — The headless code review writes code-review.json into the run folder, replacing any earlier one, then records it.
- `src/schemas/questions.ts` — The decided-verdict shape: kind, chosen, abandoned, why, advocate, principles, reversibility, by (operator), at, revised.
- `src/schemas/decisionRecord.ts` — The decision record manifest beside phase, authoring and review records; its id is the Decision-Id trailer.
- `src/app/commit.ts` — Phase and review-fix commits carry the Short-Name trailer; release notes fold Short-Name commits into their run.
- `src/domain/state.ts` — A run waiting for human review is in `review_open`.
- `docs/specs/2609250823-headless-review.md` — Draft. §4 defines Finding id (`F<n>` review, `C<n>` compliance, run-unique, assigned by phax, numbering continued across passes) and outcomes fixed, open, dismissed, awaiting with an append-only decision history in the decided-verdict shape.
- `docs/specs/2611031738-command-contracts.md` — `--json` writes the command's versioned output contract on stdout, `$schema` first, and message lines on stderr.
- `.claude/skills/phax-decide-review/SKILL.md` — The severity threshold: `info` is never planned and goes to the handoff note.

## 2. Problem

A review finding is a line in a JSON file that nobody follows up. It has no stable name, so no commit, record or person can point at it. Its fate (fixed, and by which change; judged wrong, and by whom and why; handed to later work; or simply left) lives only in the operator's memory. The 68 review-fix commits cannot be joined to the 51 findings they answered.

The knowledge index needs this join for its third use: teaching phax's agents the doctrine so they stop repeating errors ("last time a test like this missed, what did the better test look like?"). It can already read why the tests missed a finding (`lens`, `escape`). It cannot read what became of the finding. Without that, a recurring escape cannot be told apart from one that was fixed by a better test, and steme has no signal to promote a pattern into a guarantee. No public dataset pairs review findings with their outcome either: 68% of rejected agent PRs carry no stated reason.

Recording a fate by hand would not survive. A trailer the operator must type is a trailer that is forgotten. So the fate has to be a by-product of how the operator already works.

## 3. Product goal

Every finding phax records gets a stable, run-unique id that phax assigns, and always has a fate from a closed set. phax writes each fate as a record on the records branch. The operator's fix becomes one phax command: the operator names the finding ids and the changed paths, and phax composes the commit (trailers, default subject) and the fate record, so the history builds itself while the operator works. The fates of a run's findings can be read through the CLI, in text for the operator and as a versioned `--json` answer for the knowledge index, and the run's PR lists them. Git stays the source of truth: every fate can be rebuilt from the run branch, `main` and `phax/records/v1`.

> No finding is dropped: phax names it, the operator or a machine settles it through a phax command, and Git remembers how.

## 4. Terminology

- **Finding** — One entry of a run's review: a code-review finding (in `code-review.json`) or a compliance finding (in `perPhase[].findings[]` of `compliance-review.json`, any severity). Findings the operator raises by hand are not findings in this slice.
- **Finding id** — As in the headless-review spec: a run-unique id that phax assigns when it persists a review. `F<n>` for a code-review finding and `C<n>` for a compliance finding, with n from 1. A later review of the same run continues the numbering, and an id is never reused within a run. The review session never writes an id. With the run's short name, it names a finding across the repository.
- **Fate** — A finding's current state, one of a closed set: `open`, `fixed`, `dismissed`, `deferred`, `unrecorded`. It is what the headless-review spec calls the finding's outcome. That spec's `awaiting` is not part of this set and stays that spec's addition.
- **open** — The fate of a finding whose review carries ids and that has no fate record yet. A new finding is `open`.
- **fixed** — The finding's latest fate record is a fix. A fix names the commit that fixed the finding and that commit's path classes. A finding may be fixed by several commits over time.
- **dismissed** — The finding's latest fate record is a dismissal: the operator judged it wrong or not worth acting on, and gave a reason. Only an operator dismisses.
- **deferred** — The finding's latest fate record is a deferral: the operator handed it to later work and named the brief, spec or `NEXT_STEPS.md` that takes it over. Only an operator defers.
- **unrecorded** — The fate of a finding whose review was persisted before finding ids existed and that has no fate record yet. Such a finding gets its id lifted by position (`F1`… or `C1`… in document order). phax never guesses its fate. The same commands can set one later.
- **Fate record** — One entry on `phax/records/v1` that sets a finding's fate (fix, dismissal or deferral), stamped with by and at. Fate records are append-only, and the latest one decides the fate. All of a finding's fate records, oldest first, are its history.
- **Path class** — The kind of each path a fixing commit changes, from the closed set `tests`, `gate-config`, `docs`, `code`. phax derives it deterministically from the path alone, never with a model. A fix records the set of classes its commit touched, which is "how it was fixed".
- **Run's final worktree** — The worktree of the run's last phase, the one `phax enter` opens and `phax path` prints, where the operator works while the run is `review_open`.

## 5. Functional requirements

### 5.1 phax assigns finding ids when it persists a review

WHEN the system persists a code review or a compliance review of a run THE system SHALL give each of its findings a finding id, `F<n>` for a code-review finding and `C<n>` for a compliance finding, numbered after the highest id of that kind the run has already been given.

### 5.2 The review session never names an id

IF a code-review or compliance-review session's answer carries an `id` on a finding THEN the system SHALL refuse the answer as it refuses any unknown key, naming the offending path.

### 5.3 Ids are written into the review files

The system shall write each finding's id into `code-review.json` and `compliance-review.json` under a new `$schema` stamp, and record those files on `phax/records/v1` as it does today.

### 5.4 Older reviews get ids by position and the unrecorded fate

WHEN the system reads a review persisted before finding ids existed THE system SHALL give its findings ids by position in document order (`F1`… for code-review findings; `C1`… across `perPhase` in order for compliance findings) and the fate `unrecorded` unless a fate record sets one, without rewriting the stored file.

### 5.5 Every finding has a fate from the closed set

The system shall give every finding of a run exactly one fate from `open`, `fixed`, `dismissed`, `deferred`, `unrecorded`: the fate of its latest fate record, else `open` for a finding persisted with its id and `unrecorded` for a finding whose id was lifted.

### 5.6 A later review drops no finding

WHEN a later review of the same run replaces the review file in the run folder THE system SHALL keep every earlier finding of that run, with its id, its fate and its fate records, readable through `phax finding list`.

### 5.7 List a run's findings with their fates

WHEN `phax finding list <run>` runs THE system SHALL print every finding of the run with its id, source, severity, location, message and current fate, and for a `fixed` finding its fixing commits, for a `dismissed` finding its reason, and for a `deferred` finding its pointer.

### 5.8 The list is a versioned answer

WHERE `--json` is given to a `phax finding` command THE system SHALL write its output contract as a `$schema`-stamped document per the command-contracts spec, carrying for each finding its fields, its current fate and its full history of fate records.

### 5.9 The fix command composes exactly one commit

WHEN `phax finding fix <run> <id>… -- <path>…` runs THE system SHALL make one commit on the run branch in the run's final worktree, holding exactly the changes of the named paths, with one `Short-Name: <short-name>` trailer and one `Finding: <id>` trailer per id named, and leave every other staged or unstaged change in place.

### 5.10 A fix writes its fate records

WHEN the fix command has made its commit THE system SHALL commit to `phax/records/v1` one fate record per id named, setting the fate `fixed` with that commit's sha, its path classes, `by` and `at`.

### 5.11 The fix command refuses an incomplete call

IF the fix command names no path, names a path with no change, or names an id the run does not have THEN the system SHALL make no commit and no record, and exit non-zero naming the missing path, the unchanged path or the unknown id.

### 5.12 Fixes ride the run while it is open for review

IF the fix command targets a run that is not `review_open` THEN the system SHALL refuse it, naming the run's state, and make no commit and no record.

### 5.13 How it was fixed is derived from paths

The system shall classify each path of a fixing commit into exactly one of `tests`, `gate-config`, `docs`, `code` by a deterministic rule on the path, and record the set of classes the commit touched with the fix.

### 5.14 An operator dismisses with a reason

WHEN `phax finding dismiss <run> <id>… --why <reason>` runs THE system SHALL commit to `phax/records/v1` one fate record per id setting the fate `dismissed`, carrying a decided verdict that chooses `dismiss`, abandons `fix` and `defer`, gives the reason as `why`, and is stamped with the operator's name and the time.

### 5.15 An operator defers to named later work

WHEN `phax finding defer <run> <id>… --to <path> --why <reason>` runs THE system SHALL commit to `phax/records/v1` one fate record per id setting the fate `deferred`, carrying the pointer, the reason, and the operator's name and the time.

### 5.16 Dismissal and deferral refuse an incomplete call

IF a dismiss or defer call lacks a reason, a deferral's `--to` names no file tracked at the checkout's HEAD, or an id is unknown to the run THEN the system SHALL write no record and exit non-zero naming what is missing or unknown.

### 5.17 A machine fixes but never dismisses or defers

IF `phax finding dismiss` or `phax finding defer` is given `--by machine:<grant>` THEN the system SHALL refuse the call, naming that only an operator settles a finding without fixing it.

### 5.18 Who set a fate is stamped

The system shall stamp every fate record with `by`, either `{ kind: operator, name }` from the committing Git identity or `{ kind: machine, grant }` from `--by machine:<grant>` on `fix`, and with `at`, an ISO-8601 UTC timestamp. Without a terminal, `--by` is required, as on `phax artifact approve`.

### 5.19 A fate needs the records branch

IF records are off for the project THEN `phax finding fix`, `dismiss` and `defer` SHALL refuse before any commit, naming the records configuration.

### 5.20 A fate record that fails to commit is reported

IF a fate record cannot be committed to `phax/records/v1` THEN the system SHALL exit non-zero and state that the fate is not recorded. For a fix, it SHALL also keep the fixing commit and name the command that records the fate for that commit.

### 5.21 The run's PR lists findings by fate

WHEN the system builds the body of a run's pull request THE system SHALL include a findings section that names each `open` and `deferred` finding (id, severity, location, message, and the pointer for a deferred one) and counts the `fixed` and `dismissed` ones.

### 5.22 Findings never block

The system shall not refuse or delay a run's completion, publication or merge because of a finding's fate.

## 6. Surface

### file: code-review.json — normative

Summary: Each code-review finding now carries a stable `id` such as `F3` that commits, records and people can point at.

before:

    {
      "$schema": "https://docs.phax.run/schemas/code-review/0.32.0.json",
      "findings": [
        { "severity": "bug", "file": "src/app/gate.ts", "line": 42,
          "message": "retry loses the gate's exit code",
          "lens": "core", "escape": "omission", "criterion": "AC-retry",
          "suggestion": "carry the exit code through the retry" }
      ]
    }

after:

    {
      "$schema": "https://docs.phax.run/schemas/code-review/0.33.0.json",
      "findings": [
        { "id": "F1", "severity": "bug", "file": "src/app/gate.ts", "line": 42,
          "message": "retry loses the gate's exit code",
          "lens": "core", "escape": "omission", "criterion": "AC-retry",
          "suggestion": "carry the exit code through the retry" }
      ]
    }

### file: compliance-review.json — normative

Summary: Each compliance finding now carries a stable `id` such as `C2`, numbered across phases in document order.

before:

    "perPhase": [
      { "phaseId": "phase-02", "verdict": "conformant-with-deviations",
        "findings": [
          { "dimension": "files", "severity": "deviation",
            "message": "edited src/cli/ls.ts, not in the plan" } ] }
    ]

after:

    "perPhase": [
      { "phaseId": "phase-02", "verdict": "conformant-with-deviations",
        "findings": [
          { "id": "C1", "dimension": "files", "severity": "deviation",
            "message": "edited src/cli/ls.ts, not in the plan" } ] }
    ]

### cli: phax finding list — indicative

Summary: Running `phax finding list <run>` shows every finding of a run with its id and fate, so you can pick the ids to fix, dismiss or defer.

    $ phax finding list gate-retry
    gate-retry (review_open) — 6 findings: 3 open, 1 fixed, 1 dismissed, 1 deferred

    F1  bug        fixed      src/app/gate.ts:42         retry loses the gate's exit code
                              a1b2c3d (code, tests)
    F2  concern    open       tests/gate.test.ts:88      asserts the message, not the exit code
    F3  concern    dismissed  src/cli/run.ts:17          duplicate flag check
                              Rémy Loubradou: the second check guards --resume
    F4  info       open       src/app/gate.ts:12         name reads oddly
    F5  concern    deferred   docs/gates.md:30           retry budget undocumented
                              → docs/briefs/gate-retry-docs.md
    C1  deviation  open       phase-02 files             edited src/cli/ls.ts, not in the plan

### cli: phax finding list --json — indicative

Summary: The knowledge index and scripts read a run's findings and their full fate history as one versioned JSON document.

    {
      "$schema": "https://docs.phax.run/schemas/finding-list/0.33.0.json",
      "run": { "shortName": "gate-retry", "runId": "2611041402-gate-retry", "state": "review_open" },
      "findings": [
        { "id": "F1", "source": "code-review", "severity": "bug",
          "file": "src/app/gate.ts", "line": 42, "message": "retry loses the gate's exit code",
          "lens": "core", "escape": "omission", "criterion": "AC-retry",
          "fate": "fixed",
          "history": [
            { "fate": "fixed", "commit": "a1b2c3d4…", "pathClasses": ["code", "tests"],
              "by": { "kind": "operator", "name": "Rémy Loubradou" }, "at": "2026-11-04T15:02:11Z" } ] },
        { "id": "C1", "source": "compliance-review", "severity": "deviation",
          "phaseId": "phase-02", "dimension": "files", "message": "edited src/cli/ls.ts, not in the plan",
          "fate": "open", "history": [] }
      ]
    }

### cli: phax finding fix — normative

Summary: After changing files for a finding, `phax finding fix <run> F2 -- <paths>` commits exactly those paths with the finding trailers and records the finding as fixed, with no trailer typed by hand.

before:

    $ git add tests/gate.test.ts src/app/gate.ts
    $ git commit -m "fix review findings

    - assert the exit code
    - …

    Short-Name: gate-retry"

after:

    $ phax finding fix gate-retry F2 -- tests/gate.test.ts
    ✓ committed 9f8e7d6 fix(review): F2 of gate-retry
      paths: tests/gate.test.ts (tests)
    ✓ recorded F2 fixed on phax/records/v1

    $ git log -1 --format=%B
    fix(review): F2 of gate-retry

    Short-Name: gate-retry
    Finding: F2

    $ phax finding fix gate-retry F7 -- src/app/gate.ts
    ✗ fix refused: gate-retry has no finding F7
    $ phax finding fix gate-retry F2 -- docs/gates.md
    ✗ fix refused: docs/gates.md has no change

### cli: phax finding dismiss — normative

Summary: An operator can mark one or more findings dismissed with a required reason, stamped with their name and the time.

    $ phax finding dismiss gate-retry F3 --why "the second check guards --resume"
    ✓ recorded F3 dismissed on phax/records/v1 (by Rémy Loubradou)

    $ phax finding dismiss gate-retry F3 --by machine:review-bot --why "…"
    ✗ dismiss refused: only an operator dismisses a finding

### cli: phax finding defer — normative

Summary: An operator can hand a finding to later work by naming the brief, spec or NEXT_STEPS.md that takes it over.

    $ phax finding defer gate-retry F5 --to docs/briefs/gate-retry-docs.md --why "docs pass after the gate rework"
    ✓ recorded F5 deferred → docs/briefs/gate-retry-docs.md on phax/records/v1

    $ phax finding defer gate-retry F5 --to docs/briefs/nope.md --why "…"
    ✗ defer refused: docs/briefs/nope.md is not a tracked file

### file: phax/records/v1 <runId>/finding/<id>/<NN>/record.json — indicative

Summary: Each fate of a finding is a record on the records branch, so the history of every finding can be rebuilt from Git alone.

    // <runId>/finding/F3/01/record.json
    {
      "$schema": "https://docs.phax.run/schemas/finding-fate-record-manifest/0.33.0.json",
      "kind": "finding-fate",
      "runId": "2611041402-gate-retry",
      "finding": "F3",
      "fate": "dismissed",
      "verdict": { "kind": "decided", "chosen": "dismiss", "abandoned": ["fix", "defer"],
        "why": "the second check guards --resume",
        "advocate": "drop the duplicate flag check", "principles": [], "reversibility": "cheap",
        "by": { "kind": "operator", "name": "Rémy Loubradou" }, "at": "2026-11-04T15:10:40Z",
        "revised": [] }
    }

    // <runId>/finding/F2/01/record.json (a fix)
    { "$schema": "…", "kind": "finding-fate", "runId": "2611041402-gate-retry", "finding": "F2",
      "fate": "fixed", "commit": "9f8e7d6…", "pathClasses": ["tests"],
      "by": { "kind": "operator", "name": "Rémy Loubradou" }, "at": "2026-11-04T15:02:11Z" }

### internal: Finding trailer — normative

Summary: A fixing commit names the findings it fixes in `Finding:` trailers beside `Short-Name`, so a commit joins to its findings from Git alone.

before:

    Short-Name: gate-retry

after:

    Short-Name: gate-retry
    Finding: F2
    Finding: F5

### api: run pull request body — findings section — indicative

Summary: A run's pull request names the findings still open or deferred and counts the fixed and dismissed ones.

    ## Review findings

    Open (2)
    - F4 info — src/app/gate.ts:12 — name reads oddly
    - C1 deviation — phase-02 files — edited src/cli/ls.ts, not in the plan

    Deferred (1)
    - F5 concern — docs/gates.md:30 — retry budget undocumented → docs/briefs/gate-retry-docs.md

    Fixed: 2 · Dismissed: 1

## 7. Non-goals

- `phax review-plan`, `phax run --append`, review loops, and the `awaiting` fate: these stay in the headless-review spec, which reuses this spec's ids, fates and fate records instead of redefining them.
- The knowledge index itself, its queries, and steme guarantees.
- Classifying a fix with a model: path classes are derived from paths alone.
- Blocking or delaying a run's completion, publication or merge on open findings.
- Findings the operator raises by hand (follow-up `phax review add`).
- Guessing the fate of findings reviewed before this change from existing commit messages: they are `unrecorded` until a command sets them.
- Rewriting stored review files or records of earlier runs: older reviews get their ids when phax reads them, with no migration step.
- Fixing a finding after the run is merged, on `main` (follow-up; see the open question on where the commands run).
- A `Run-Id` trailer on fixing commits: they keep `Short-Name` only, so release notes fold them into their run as today.

## 8. Acceptance criteria

### A new code review gets F ids

Given a run with no earlier code review, when `phax review-code <run> --headless` persists an answer of three findings, then `code-review.json` carries the new `$schema` stamp and the findings have `id` `F1`, `F2`, `F3` in answer order, and the review record on `phax/records/v1` holds the same file. (refs §5.1, §5.3)

### Compliance findings get C ids across phases

Given a compliance answer with one finding in phase-01 and two in phase-02, when `phax review-compliance <run>` persists it, then the findings have `id` `C1` (phase-01), `C2` and `C3` (phase-02) in `compliance-review.json`. (refs §5.1, §5.3)

### A session that writes ids is refused

Given a code-review session whose answer has `"id": "F1"` on a finding, when phax reads the answer, then the answer is refused naming `findings[0].id` as an unexpected key, and no `code-review.json` is written. (refs §5.2)

### A second review continues the numbering and drops nothing

Given a run whose first code review gave F1–F3 and where F2 is recorded `fixed`, when a second headless code review of the run persists two findings, then they get `F4` and `F5`, and `phax finding list <run>` lists F1–F5 with F2 still `fixed` and F1, F3, F4, F5 `open`. (refs §5.1, §5.6, §5.5)

### An older review lists as unrecorded

Given a run whose `code-review.json` and `compliance-review.json` were persisted before finding ids existed, when `phax finding list <run>` runs, then its code-review findings list as `F1`… and its compliance findings as `C1`… in document order, each with fate `unrecorded`, and neither stored file has changed. (refs §5.4, §5.5)

### An unrecorded finding can be settled later

Given an older run whose finding F2 is `unrecorded`, when `phax finding dismiss <run> F2 --why "superseded by the gate rework"` runs, then `phax finding list <run>` shows F2 `dismissed` with that reason. (refs §5.4, §5.14)

### The list names fates and their details

Given a run with an open, a fixed, a dismissed and a deferred finding, when `phax finding list <run>` runs, then each finding prints with its id, severity, location, message and fate; the fixed one shows its commit and path classes, the dismissed one its reason, and the deferred one its pointer. (refs §5.7)

### The list answers a versioned document

Given the same run, when `phax finding list <run> --json` runs, then stdout is one document with `$schema` first whose `findings[]` carry `id`, `source`, `fate` and `history`, the history holding every fate record oldest first, and stderr holds only message lines. (refs §5.8)

### Fix commits exactly the named paths with trailers

Given a `review_open` run whose final worktree has changes in `tests/gate.test.ts` and `src/app/gate.ts`, and an unrelated staged change in `README.md`, when `phax finding fix <run> F2 F5 -- tests/gate.test.ts` runs, then HEAD of the run branch is one new commit changing only `tests/gate.test.ts`, its message carries `Short-Name: <short-name>`, `Finding: F2` and `Finding: F5`, and `src/app/gate.ts` and the staged `README.md` change are still uncommitted. (refs §5.9)

### Fix records the fate with path classes

Given the fix above succeeded, when `phax finding list <run> --json` runs, then F2 and F5 are `fixed`, each with a fate record naming the new commit, `pathClasses` `["tests"]`, `by` the operator and an `at` timestamp. (refs §5.10, §5.13, §5.18)

### Path classes are deterministic

Given a fixing commit that changes a test file, a source file and a Markdown file under `docs/`, when its fix is recorded, then `pathClasses` is exactly `["code", "docs", "tests"]`, and recording the same commit again yields the same set. (refs §5.13)

### Fix refuses a call that names no change

Given a `review_open` run with finding F2 and a clean `docs/gates.md`, when `phax finding fix <run> F2` (no path), `phax finding fix <run> F2 -- docs/gates.md`, and `phax finding fix <run> F9 -- src/app/gate.ts` run, then each exits non-zero naming respectively that no path was given, `docs/gates.md` as unchanged, and `F9` as unknown, and the run branch and `phax/records/v1` have no new commit. (refs §5.11)

### Fix refuses a run that is not open for review

Given a run in state `running`, when `phax finding fix <run> F1 -- src/app/gate.ts` runs, then it exits non-zero naming the state `running`, and nothing is committed. (refs §5.12)

### A machine may fix

Given a non-interactive caller and a `review_open` run with a change in `src/app/gate.ts`, when `phax finding fix <run> F1 --by machine:review-bot -- src/app/gate.ts` runs, then the fate record of F1 has `by` `{ kind: machine, grant: review-bot }`; the same call without `--by` and without a terminal is refused. (refs §5.18, §5.10)

### Dismissal is a stamped decided verdict

Given a run with open finding F3, when `phax finding dismiss <run> F3 --why "the second check guards --resume"` runs, then a fate record on `phax/records/v1` sets F3 `dismissed` with a decided verdict choosing `dismiss`, abandoning `fix` and `defer`, `why` equal to the reason, `revised` empty, and `by` the operator with an `at` timestamp. (refs §5.14, §5.18)

### Deferral names its successor

Given a run with open finding F5 and a tracked `docs/briefs/gate-retry-docs.md`, when `phax finding defer <run> F5 --to docs/briefs/gate-retry-docs.md --why "docs pass after the gate rework"` runs, then F5 is `deferred` with that pointer and reason, stamped by the operator. (refs §5.15, §5.18)

### Dismiss and defer refuse incomplete calls

Given a run with finding F5, when `phax finding dismiss <run> F5` without `--why`, `phax finding defer <run> F5 --to docs/briefs/nope.md --why x` where the file is untracked, and `phax finding dismiss <run> F9 --why x` run, then each exits non-zero naming the missing reason, the untracked pointer, or the unknown id, and no fate record is written. (refs §5.16)

### A machine cannot dismiss or defer

Given a run with open finding F3, when `phax finding dismiss <run> F3 --by machine:review-bot --why x` runs, then it exits non-zero saying only an operator dismisses a finding, and F3 stays `open`. (refs §5.17)

### Fate commands need records

Given a project with records off, when `phax finding fix`, `dismiss` or `defer` runs, then each exits non-zero naming the records configuration, before any commit. (refs §5.19)

### A failed fate record is reported, the fix kept

Given a `review_open` run where committing to `phax/records/v1` fails, when `phax finding fix <run> F2 -- tests/gate.test.ts` runs, then the fixing commit exists on the run branch, the command exits non-zero saying F2's fate is not recorded and naming the command that records it for that commit. (refs §5.20)

### The latest fate record decides, history keeps all

Given a finding F3 first dismissed, then fixed by a commit, when `phax finding list <run> --json` runs, then F3's `fate` is `fixed` and its `history` holds the dismissal then the fix, oldest first. (refs §5.5, §5.8)

### The PR names open and deferred findings

Given a run with findings open F4 and C1, deferred F5, fixed F1 and F2, dismissed F3, when the run's pull request body is built, then its findings section names F4, C1 under Open and F5 with its pointer under Deferred, and reads `Fixed: 2 · Dismissed: 1`. (refs §5.21)

### Open findings do not block

Given a run with open findings of severity `bug`, when the run is completed and published, then completion and publication proceed as with no findings. (refs §5.22)

## 9. Open questions

### q-fix-paths — Which changes does `phax finding fix` commit?

- named-paths — Exactly the paths named after `--`; refuse when none is named or a named one has no change — abandons: the one-word call: the operator types the paths even when the worktree holds only this fix
- all-uncommitted — Every uncommitted change in the run's final worktree — abandons: one finding per commit: whatever else was edited or staged rides along and is attributed to the named findings
- staged — Whatever is staged in the run's final worktree — abandons: phax composing the commit: the operator stages by hand again, and a stale stage is swept in silently

Recommendation: named-paths — A precise join between a finding and the change that fixed it is the whole point. A commit that sweeps in unrelated edits corrupts the path classes and the knowledge index's lesson. Typing paths is cheap, and shell completion can offer the changed ones.

### q-where — Where and when does `phax finding fix` run?

- review-open — In the run's final worktree while the run is `review_open`, in this slice; dismiss and defer run on any run whose records exist — abandons: recording a fix made on `main` after the merge, which waits for a follow-up
- also-main — Also on `main` after the merge, committing there with the run's trailers — abandons: a bounded slice: a second commit target, its own preconditions, and fixes outside the run's PR

Recommendation: review-open — The final worktree is where the operator fixes today, and the fix rides the run's PR. Dismissal and deferral write only a record, so older and merged runs, `unrecorded` ones included, can still be settled.

### q-family — Which command family carries list, fix, dismiss and defer?

- finding-group — A `phax finding list|fix|dismiss|defer <run> <id>…` group — abandons: grouping by workflow next to `review-code` and `review-compliance`: one more top-level noun
- review-verbs — Verbs under `review` (`phax review fix …`) — abandons: the noun the index and the doctrine use; `review` today names sessions that produce findings, not what becomes of them
- records-verbs — Verbs under `records` (`phax records finding …`) — abandons: the operator's flow: `records` reads and syncs what phax wrote, while `fix` makes a code commit on the run branch

Recommendation: finding-group — `finding` is the noun every reader of this data uses. It keeps code-changing `fix` out of `records`, and `--json` comes with each command under command-contracts.

### q-subject — What commit subject does `phax finding fix` write?

- default-override — phax writes `fix(review): F2, F5 of <short-name>`, `-m` overrides the subject and an optional body follows; trailers and the record are always phax's — abandons: a descriptive subject by default: `git log --oneline` reads as ids until the operator passes `-m`
- message-required — `-m <subject>` is required — abandons: the one-step call: every fix needs a written subject, and agents invent filler
- generated — phax derives a subject from the findings' messages — abandons: a deterministic, short subject: finding messages are long and phrased as problems, not changes

Recommendation: default-override — The operator decided that phax composes everything but the change. A default subject keeps the call one step, and `-m` is there when the operator wants the log to read well. Trailers stay out of the operator's hands either way.

### q-rereview — How does a later review of the same run keep earlier findings readable?

- records-history — The run folder's file holds the latest review only; `phax finding list` reads earlier reviews from the records branch's history of the review's key — abandons: one file a reader can open to see every finding of the run; earlier findings need the records branch
- accumulate — The review file accumulates: a later review appends its findings after the earlier ones — abandons: the file as one review's answer: a compliance file would carry a verdict beside findings from an older review it no longer stands behind

Recommendation: records-history — Git is the source of truth, and fate commands already need the records branch. Keeping each file as one review's answer preserves what the compliance verdict means. Re-reviews of one run are rare.

### q-backfill — Can `phax finding fix` record a commit that already exists (for `unrecorded` findings and for a fate record that failed to commit)?

- commit-flag — `phax finding fix <run> <id>… --commit <sha>` records an existing commit reachable from the run branch or `main`, with its path classes, and makes no new commit — abandons: one shape of fixing commit: a backfilled commit has no `Finding:` trailer and may hold several fixes, so its path classes are coarser
- no-backfill — No: only a commit phax makes can fix a finding — abandons: settling the 51 existing findings as fixed, and retrying a failed fate record: they can only be dismissed, deferred or left `unrecorded`

Recommendation: commit-flag — The brief requires `unrecorded` findings to be settable later with the same commands, and most of the existing ones were fixed by one of the 68 review-fix commits. The operator names the commit, so phax still guesses nothing. The same flag is the retry for a fix whose record failed.

### q-pr-refresh — When does the PR's findings section follow fates set after the PR was opened?

- publish-refresh — Re-running `phax publish-pr <run>` pushes the branch and rewrites the findings section of an existing PR, leaving the rest of the body — abandons: a PR that is always current: it is stale until the operator publishes again
- each-command — Each fate command updates the PR when one is open — abandons: fate commands that stay local: each needs the network and `gh`, and fails or warns offline

Recommendation: publish-refresh — Fixes are pushed at publish time anyway. Keeping fate commands local keeps them fast, makes them work offline, and spares an agent calling them a network dependency.

### q-plans — How is the spec split into plans?

- three-plans — (1) ids: the review file shape cut, lifting older reviews to `unrecorded`, and `finding list`; (2) the fate commands and their records; (3) the PR findings section — abandons: one end-to-end run: the operator gets `finding list` before being able to set a fate
- two-plans — (1) ids and list; (2) fate commands and the PR section together — abandons: a small final plan: the PR body change rides with the largest plan and its review

Recommendation: three-plans — Each plan ships something the operator can use and review on its own. Ids and the list come first because every later plan reads them.

## 9b. Arbitrated questions

None.

## 10. Implementation-planning note

Settled:

- phax assigns ids when it persists a review; the session never writes one. `F<n>` for code-review findings and `C<n>` for compliance findings (every severity), unique within the run and never reused.
- Fates are exactly `open`, `fixed`, `dismissed`, `deferred`, `unrecorded`. A new finding is `open`. A finding from a review persisted before ids existed is `unrecorded`, with its id lifted by position.
- Every fate is written by a command, as a fate record on `phax/records/v1` stamped with by and at. The latest record decides the fate, and records are append-only.
- A machine may fix (`--by machine:<grant>`) but never dismisses or defers.
- A dismissal carries a decided verdict (chosen `dismiss`, abandoned `fix` and `defer`, `revised` empty).
- The fix command composes the commit: `Short-Name` plus one `Finding:` trailer per id, the named paths only, one commit per call.
- Path classes are `tests`, `gate-config`, `docs`, `code`, derived deterministically from the path.
- The PR names open and deferred findings and counts fixed and dismissed ones. Nothing blocks.
- The headless-review spec, when revived, reuses this spec's Finding id, fate set and fate records as its outcomes and history, adding only `awaiting`; its per-finding `outcome`/`history` fields in `code-review.json` are replaced by fate records.

Left open:

- The exact path-class rule (which globs are `tests`, which files are `gate-config`: `phax.json` and the gate tools' config files); it must give each path exactly one class and live in one place.
- The fate record's key layout and manifest name on `phax/records/v1` (indicative `<runId>/finding/<id>/<NN>`, kind `finding-fate`), and whether one fix call writes its per-id records in one records commit.
- For a dismissal's decided verdict: `advocate` (indicative: the finding's `suggestion`, its message for a compliance finding, as the strongest case for `fix`), `principles` (indicative: empty) and `reversibility` (indicative: `cheap`, since a later fate record can supersede it).
- Exit codes of the refusals, within the existing families and declared per command-contracts.
- How `phax finding fix` resolves paths: relative to the run's final worktree root, or to the current directory when it is inside that worktree.

Constraints:

- No back-compat shims: the review files' new shape requires `id`. Older files stay readable through the schema history readers and get their ids at read time, with no migration step and no rewrite of stored files.
- Every new document (`finding-list` answer, fate record manifest, new review file stamps) is born with `$schema`.
- All I/O through ports; the fix commit follows the artifact-transition pattern (path-scoped, `-o <paths>` semantics, never sweeping other staged changes).
- Fate commands honor command-contracts: `--json` on each, message lines on stderr, refusal before any write.
- Release notes keep folding fixing commits into their run by `Short-Name`; fixing commits carry no `Run-Id`.

## 11. Docs page

Page: docs/findings.md — Review findings: ids and fates

Reader: An operator who has run a code or compliance review on a `review_open` run and now wants to address its findings: fix some, dismiss or defer others, and see what is left before publishing.

Example: Run `phax finding list gate-retry`. Fix the test, then run `phax finding fix gate-retry F2 -- tests/gate.test.ts`. Dismiss the duplicate-check finding with `phax finding dismiss gate-retry F3 --why "the second check guards --resume"`, defer the docs gap to a brief with `phax finding defer gate-retry F5 --to docs/briefs/gate-retry-docs.md --why …`, then `phax publish-pr gate-retry` and see the PR's Review findings section.
