---
status: Draft
date: 2026-11-22
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---
# A fixed finding finds its commit again after a rewrite

## 1. Context

`phax finding fix <run> <id>… -- <path>…` commits the named paths in the run's final worktree and records each named finding `fixed` on `phax/records/v1`. The commit's last paragraph holds phax's trailers:

    Short-Name: gate-retry
    Finding: F2

There is deliberately no `Run-Id`: release notes fold the commit into its run by `Short-Name`, and they read only `Run-Id` and `Short-Name`. `phax finding fix <run> <id>… --commit <sha>` records an existing commit instead. The commit must be on the run's final-phase branch or on the base branch (`publish.baseBranch`, else `main`, local then remote-tracking), or it is refused.

The fate record's entry holds the commit by its full sha, with `pathClasses`, `by` and `at`. Three readers use that sha as it is. `phax finding list` prints it under the finding (`3fa91c2 (tests)`) and in the finding-list document's `history`. The fate comment on the pull request reads `Fixed by 3fa91c2 (tests)`. `phax finding post` refuses a fixed finding once the pull request is merged or closed.

`phax records explain` already finds a phase commit through its trailers (`Run-Id` with `Phase-Id`), never through its sha. A trailer survives a rebase, an amend and GitHub's Rebase and merge. It also survives a squash when the repository keeps the commit messages in the squashed commit, though not as the last paragraph. A run id is unique to a run. A short name is reused once a run is pruned.

Ground read:

- `docs/briefs/finding-fix-identity.md` — The brief: why a sha does not survive a rebase, an amend, a Rebase and merge or a squash, and the questions this spec settles.
- `src/domain/findings/fixCall.ts` — fixCommitBody writes `Short-Name: <short-name>` then one `Finding: <id>` per id as the last paragraph, and never a `Run-Id`, so release notes fold the commit into its run by its short name.
- `src/app/findingFix.ts` — `phax finding fix` commits the named paths or, with `--commit <sha>`, records an existing commit that must be on the run's final branch or the base branch (`publish.baseBranch`, else `main`, local then remote-tracking); it refuses any other sha.
- `src/schemas/findingFateRecord.ts` — A fixed fate entry holds `commit` (a full sha), `pathClasses`, `by` and `at`; nothing else names the commit.
- `src/app/findingFateRecords.ts` — One fate record is one commit on phax/records/v1 keyed `<runId>/finding/<id>/<NN>`; the latest record decides the fate.
- `src/app/findingPost.ts` — `phax finding post` refuses a fixed finding when the pull request is merged or closed, and pushes the run branch before commenting on an open one.
- `src/domain/findings/fateComment.ts` — A fixed finding's comment reads `Fixed by <sha7> (<classes>)`, the recorded sha as it was.
- `src/cli/definitions/finding.ts` — `phax finding list` prints a detail line per fix, `<sha7> (<classes>)`, and its `--json` is the published finding-list document.
- `src/app/recordsExplain.ts` — `phax records explain` already resolves a phase commit through its `Run-Id`/`Phase-Id` trailers, never its sha.
- `scripts/release-notes.ts` — Release notes read only the `Run-Id` and `Short-Name` trailers; a commit with `Short-Name` and no `Run-Id` folds into a run whose phase commits are in the range.
- `docs/findings.md` — The operator's page on finding ids and fates: listing, fixing, `--commit`, fate comments and which pull request gets them.
- `docs/specs/archive/2611041509-finding-ids-and-fates.md` — The spec that introduced fates, which kept fixing commits free of `Run-Id` as a non-goal.

## 2. Problem

A sha does not survive a rewrite. Rebasing the run's branch during review, amending after a review note, GitHub's Rebase and merge (which recreates every commit even when a fast-forward was possible) and a squash all give the fix a new sha. The recorded sha is then on no branch of the project:

- `phax finding list` shows a commit the base branch does not hold, and nothing says which base commit carries the fix.
- The fate comment links a sha that leads nowhere once the run branch is deleted, and `phax finding post` refuses to post a fixed finding on the merged pull request at all.
- `phax finding fix --commit <sha>` refuses the old sha. The operator must hunt down the new one by hand, without being told one exists.

The operator's workaround after meeting this break (2026-11-21) was to require a merge commit on every project phax manages. That puts a constraint on phax's users that phax could remove, and the workaround does not hold anyway: a rebase during review or an amend rewrites the sha before any merge. Today the fix commit's trailers also cannot name a fate unambiguously. A short name is reused after a prune, and the commit carries no run id.

## 3. Product goal

A fixed finding stays bound to the commit that carries its fix after that commit's history is rewritten. The fix commit names its fate by a key that survives rewrites, and every reader of a fixed fate reports where the fix landed and how it was found. When the fix cannot be found, the reader says so plainly. A project can then merge its pull requests however it chooses, and its fates still point at real commits.

> A fixed fate names the commit that carries its fix on the branch it landed on, however that commit was rewritten, or it says plainly that it cannot.

## 4. Terminology

- **Fix commit** — The commit a `fixed` fate record names: the one `phax finding fix` made, or the one `--commit` recorded.
- **Recorded commit** — The sha held in the `commit` field of a finding's latest `fixed` fate record.
- **Fate key** — The pair (run id, finding id) of a fixed finding, such as `gate-retry-2026-11-18 F2`. A commit carries the key when one paragraph of its message holds both the run trailer naming that run id and `Finding: <finding id>`. Any paragraph counts, not only the last one, so a squash that keeps the commit messages still carries every key.
- **Run trailer** — The trailer that names a fix commit's run by its run id: `Finding-Run: <run id>` (name settled by question q-key).
- **Base branch** — `publish.baseBranch`, else `main`. The local branch is read when it exists, else the remote-tracking one, as `--commit` reads it today.
- **Search range** — The commits reachable from a branch's tip that were committed at or after the run's start. Every rewrite of a fix commit happens after the run started, and an older identical diff is excluded.
- **Resolution** — The answer for a fixed fate's latest fix. It is `found` (with the commit, the branch and the way it was found: `recorded`, `key` or `patch-id`), `ambiguous` (every matching commit, oldest first) or `not-found` (the branches searched). The recorded commit is always included.
- **Patch id** — `git patch-id --stable` of a commit's diff against its first parent. A rebase that applies cleanly keeps it.

## 5. Functional requirements

### 5.1 The fix commit names its run

WHEN `phax finding fix` makes a fix commit THE system SHALL write the run trailer naming the run's id in the commit's last paragraph, after `Short-Name` and before the `Finding` trailers.

### 5.2 Release notes still fold the fix into its run

The system shall write no `Run-Id` trailer on a fix commit, so release notes fold it into its run by `Short-Name` as they do today.

### 5.3 The recorded commit first

WHEN phax reads a fixed fate whose recorded commit is reachable from the base branch THE system SHALL resolve it as found `recorded` on the base branch.

### 5.4 Found by its key

IF the recorded commit is not reachable from the base branch THEN the system SHALL resolve the fate to the commit of the base branch's search range that carries its fate key, as found `key`.

### 5.5 Found by its diff

IF no commit of the base branch's search range carries the fate key and the repository holds the recorded commit THEN the system SHALL resolve the fate to the commit of that range whose patch id equals the recorded commit's, as found `patch-id`.

### 5.6 The run's branch after the base branch

IF no commit of the base branch is found by the recorded sha, the key or the patch id THEN the system SHALL search the run's branch, when it resolves, the same way and in the same order, and resolve a match as found on the run's branch.

### 5.7 Several matches are listed, none chosen

IF more than one commit matches at the step that first finds a match THEN the system SHALL resolve the fate as `ambiguous`, listing every matching commit oldest first and naming none of them as the fix.

### 5.8 Not found, said plainly

IF no step finds a commit THEN the system SHALL resolve the fate as `not-found`, naming the branches searched and the recorded commit, and the finding's fate SHALL stay `fixed`.

### 5.9 Reading writes nothing

The system shall resolve a fixed fate without writing anything: no fate record, no file and no ref, and it shall not fetch or call GitHub.

### 5.10 The finding-list document carries the resolution

The finding-list document shall carry a required `landed` on every finding: the resolution of the latest fix for a `fixed` finding, and `null` for every other fate.

### 5.11 The text list shows where the fix landed

The text of `phax finding list` shall show, on a fixed finding's latest fix line, the resolution whenever it is not found `recorded` on the base branch.

### 5.12 A fate comment that keeps pointing

The system shall word a fixed finding's pull request comment with the resolved commit, the branch it was found on and the fate key.

### 5.13 Posting on a merged pull request

WHEN `phax finding post` names fixed findings of a run whose pull request is merged and every one resolves as found on the base branch THE system SHALL post their comments without pushing the run branch.

### 5.14 Posting a fix that cannot be found is refused

IF `phax finding post` names a fixed finding of a merged pull request whose resolution is not found on the base branch THEN the system SHALL refuse before any comment, naming the finding, its resolution and the `phax finding fix <run> <id> --commit <sha>` retry.

### 5.15 `--commit` follows a rewrite

WHEN `phax finding fix --commit <sha>` names a commit that is on neither the run's branch nor the base branch, or that the repository does not hold, THE system SHALL resolve the named findings on the base branch, by their fate keys and then by the named commit's patch id, and record the single commit found, naming both the named commit and the recorded one.

### 5.16 `--commit` refuses an unfollowable rewrite

IF that resolution finds no commit, finds several, or resolves the named findings to different commits THEN `phax finding fix --commit` SHALL refuse before writing any record, naming each candidate commit it found.

## 6. Surface

### file: fix commit message — indicative

Summary: A fix commit now names its run by id, so phax can find it again after a rebase, an amend or a squash that keeps the messages.

before:

    fix(review): F2 of gate-retry

    Short-Name: gate-retry
    Finding: F2

after:

    fix(review): F2 of gate-retry

    Short-Name: gate-retry
    Finding-Run: gate-retry-2026-11-18
    Finding: F2

### cli: phax finding list — indicative

Summary: Running `phax finding list` shows which base-branch commit carries a fix after its commit was rewritten, or says it cannot find one.

before:

    $ phax finding list gate-retry
    gate-retry (review_open) — 3 findings: 3 fixed

    F1  bug      fixed  src/app/retry.ts:41    The retry count is never reset after a pass
                   8c1d2e4 (code, tests)
    F2  concern  fixed  tests/gate.test.ts:12  The gate drops the exit code
                   3fa91c2 (tests)
    F5  bug      fixed  src/app/gate.ts:40     The retry loses stderr
                   9f8e7d6 (code)

after:

    $ phax finding list gate-retry
    gate-retry (review_open) — 3 findings: 3 fixed

    F1  bug      fixed  src/app/retry.ts:41    The retry count is never reset after a pass
                   8c1d2e4 (code, tests)
    F2  concern  fixed  tests/gate.test.ts:12  The gate drops the exit code
                   3fa91c2 (tests) → 8b04d6e on main, by key
    F5  bug      fixed  src/app/gate.ts:40     The retry loses stderr
                   9f8e7d6 (code) → not found on main or phax/gate-retry

### file: finding-list document (phax finding list --json) — normative

Summary: A script reading `phax finding list --json` gets, for each fixed finding, the commit that carries the fix now, how it was found, or that it was not.

before:

    "fate": "fixed",
    "history": [
      { "fate": "fixed", "commit": "3fa91c2…", "pathClasses": ["tests"], "by": { "kind": "operator", "name": "Ada Lovelace" }, "at": "2026-11-18T10:00:00.000Z" }
    ]

after:

    "fate": "fixed",
    "history": [ … unchanged … ],
    "landed": { "status": "found", "by": "key", "commit": "8b04d6e…", "branch": "main", "recorded": "3fa91c2…" }

    other values of landed:
    { "status": "found", "by": "recorded" | "patch-id", "commit": "…", "branch": "…", "recorded": "…" }
    { "status": "ambiguous", "commits": ["8b04d6e…", "c11a0f3…"], "branch": "main", "recorded": "3fa91c2…" }
    { "status": "not-found", "branches": ["main", "phax/gate-retry"], "recorded": "9f8e7d6…" }
    null   (open, dismissed, deferred, unrecorded)

### file: fixed finding's pull request comment — indicative

Summary: A fixed finding's comment on the pull request names the commit where the fix now lives and the finding's run and id, which stay valid after a merge.

before:

    F2 fixed — tests/gate.test.ts:12 — The gate drops the exit code
    Fixed by 3fa91c2 (tests)

after:

    F2 fixed — tests/gate.test.ts:12 — The gate drops the exit code
    Fixed by 8b04d6e on main (tests) · gate-retry-2026-11-18 F2

### cli: phax finding post — indicative

Summary: Running `phax finding post` on a merged pull request now posts a fixed finding whose commit is found on the base branch, without pushing.

before:

    $ phax finding post gate-retry F2
    ✗ https://github.com/acme/app/pull/41 is merged: phax pushes nothing to it and posts no fixed comment on it (F2 is fixed); nothing was pushed or commented

after:

    $ phax finding post gate-retry F2
    ✓ F2: 8b04d6e on main (by key)
    ✓ commented F2 on https://github.com/acme/app/pull/41 (nothing pushed: the pull request is merged)

    $ phax finding post gate-retry F5
    ✗ F5 of gate-retry is fixed by 9f8e7d6, found on neither main nor phax/gate-retry: nothing was commented. Record the commit that carries the fix with: phax finding fix gate-retry F5 --commit <sha>

### cli: phax finding fix --commit — indicative

Summary: Running `phax finding fix --commit` with a fix's old sha records the rewritten commit on the base branch instead of refusing.

before:

    $ phax finding fix gate-retry F2 --commit 3fa91c2 --by operator
    ✗ --commit 3fa91c2 is on neither phax/gate-retry nor main: name a commit of the run branch or of the base branch (publish.baseBranch names it when it is not main)

after:

    $ phax finding fix gate-retry F2 --commit 3fa91c2 --by operator
    ✓ 3fa91c2 is on neither phax/gate-retry nor main; its rewrite 8b04d6e on main carries gate-retry-2026-11-18 F2 (by key)
    ✓ recorded F2 fixed by 8b04d6e (tests) on phax/records/v1

    $ phax finding fix gate-retry F2 --commit 3fa91c2 --by operator
    ✗ 3fa91c2 is on neither phax/gate-retry nor main, and 2 commits of main carry gate-retry-2026-11-18 F2: 8b04d6e, c11a0f3. Name one with --commit

## 7. Non-goals

- Choosing a merge policy for a project, or enforcing one on GitHub (repository settings, rulesets).
- Rewriting history on the operator's behalf, or fetching the base branch: phax reads the local or remote-tracking branch as it stands.
- Changing what `dismiss` and `defer` record, or how their comments read.
- Rewriting existing fate records or existing fix commits. Fix commits made before this change carry no run trailer, so they resolve only by the recorded sha or by patch id, and `--commit` re-records the rest.
- Making `phax records explain` explain a fix commit.
- Other records held by sha (the `baseline` of spec and plan approvals, phase commit shas in a run's state). Phase commits already resolve through their trailers in `phax records explain`. Approval baselines are named here as a follow-up for their own brief.
- Posting a fixed finding on a pull request that was closed without merging: it stays refused, as today.

## 8. Acceptance criteria

### The fix commit carries the run trailer and no Run-Id

Given a run `gate-retry` with run id `gate-retry-2026-11-18`, open for review, with a changed path, when `phax finding fix gate-retry F2 F5 -- tests/gate.test.ts` runs, then the commit's last paragraph is exactly `Short-Name: gate-retry`, `Finding-Run: gate-retry-2026-11-18`, `Finding: F2`, `Finding: F5`, in that order, and the message holds no `Run-Id` line. (refs §5.1, §5.2)

### Release notes fold the fix commit into its run

Given a release range holding the run's phase commits and a fix commit carrying `Short-Name` and the run trailer, when the release notes are built, then the fix commit is folded into its run, as a fix commit without the run trailer is today, and is not listed as a commit without a run. (refs §5.2)

### An unrewritten fix resolves as recorded

Given a fixed finding whose recorded commit was merged into `main` with a merge commit, when `phax finding list gate-retry --json` runs, then its `landed` is `{ "status": "found", "by": "recorded", "branch": "main" }` with `commit` equal to `recorded`, and the text form's fix line is unchanged. (refs §5.3, §5.10, §5.11)

### Rebase and merge resolves by key

Given a fix commit made by `phax finding fix` and then recreated on `main` by a Rebase and merge, with the run branch deleted, when `phax finding list gate-retry --json` runs, then the finding's `landed` has `"status": "found"`, `"by": "key"` and `"branch": "main"`, `commit` is the new sha and `recorded` is the old one, and the text form shows `→ <new sha7> on main, by key`. (refs §5.4, §5.10, §5.11)

### A squash that keeps the messages resolves every finding to it

Given two fix commits of one run fixing F2 and F5, squashed into one `main` commit whose message keeps both commits' messages, when `phax finding list gate-retry --json` runs, then F2 and F5 are both found `key` on `main`, each with that squashed commit as its `commit`, and each keeps its own fate record. (refs §5.4)

### A fix recorded with --commit resolves by patch id

Given a commit with no phax trailers recorded with `--commit` while on the run branch, then rebased onto `main` without conflict, with the repository still holding the old commit, when `phax finding list gate-retry --json` runs, then the finding's `landed` is found `patch-id` on `main` with the rebased commit's sha. (refs §5.5)

### An older identical diff is not a match

Given a fixed finding whose recorded commit is on no branch, and a `main` commit with the same patch id committed before the run started, when `phax finding list gate-retry --json` runs, then that older commit is not reported, and the finding's `landed` is `not-found`. (refs §5.5, §5.8)

### A rebased run branch before merge resolves on the run's branch

Given a run whose branch was rebased onto `main` during review after a fix was recorded, and not yet merged, when `phax finding list gate-retry --json` runs, then the finding's `landed` is found `key` with `branch` naming the run's branch and the rebased commit as `commit`. (refs §5.6)

### Two commits carrying the key are both listed

Given two `main` commits in the search range, both carrying the fate key `gate-retry-2026-11-18 F2`, and a recorded commit on no branch, when `phax finding list gate-retry --json` runs, then F2's `landed` is `{ "status": "ambiguous", "branch": "main" }` with both shas in `commits`, oldest first, and no `commit` field. (refs §5.7)

### A squash with the description only is not found, plainly

Given a fix commit squashed into `main` with the pull request's description only and the run branch deleted, when `phax finding list gate-retry` runs, then F5 is still `fixed`, its fix line reads `→ not found on main or phax/gate-retry`, and the `--json` `landed` is `not-found` naming the branches searched and the recorded sha. (refs §5.8, §5.11, §5.10)

### Resolving writes and fetches nothing

Given a fixed finding that resolves by key, when `phax finding list gate-retry` runs, then the `phax/records/v1` tip, the run folder and every ref are unchanged, and no network call is made. (refs §5.9)

### Non-fixed findings carry a null landed

Given a run with an open, a dismissed and a deferred finding, when `phax finding list gate-retry --json` runs, then each of the three carries `"landed": null`. (refs §5.10)

### The comment names the resolved commit and the key

Given a fixed finding F2 that resolves by key to `8b04d6e` on `main`, when its fate comment is rendered, then its second line reads `Fixed by 8b04d6e on main (tests) · gate-retry-2026-11-18 F2`. (refs §5.12)

### Posting on a merged pull request after a Rebase and merge

Given a run whose pull request was merged by Rebase and merge and whose fixed finding F2 resolves by key on `main`, when `phax finding post gate-retry F2` runs, then one comment naming the new sha and the fate key is posted on the pull request, the run branch is not pushed, and the exit code is 0. (refs §5.13, §5.12)

### Posting an unfound fix on a merged pull request is refused

Given a merged pull request and a fixed finding F5 whose resolution is `not-found`, when `phax finding post gate-retry F5` runs, then it exits non-zero naming F5, the branches searched and the retry `phax finding fix gate-retry F5 --commit <sha>`, and posts no comment. (refs §5.14)

### --commit with the old sha records the rewrite

Given F2 fixed by `3fa91c2`, which Rebase and merge recreated on `main` as `8b04d6e`, when `phax finding fix gate-retry F2 --commit 3fa91c2 --by operator` runs, then a new fixed fate record for F2 names `8b04d6e`, and the output names both `3fa91c2` and `8b04d6e` and says it was found by key. (refs §5.15)

### --commit follows a sha the repository no longer holds

Given F2's old fix sha, no longer held after the run branch was deleted and pruned, and a `main` commit carrying F2's fate key, when `phax finding fix gate-retry F2 --commit <old sha> --by operator` runs, then F2 is recorded fixed by the `main` commit carrying the key. (refs §5.15)

### --commit refuses when the rewrite is not single

Given an old sha on no branch, and either no `main` commit carrying the named finding's key or patch id, or two such commits, or F2 and F5 resolving to different commits, when `phax finding fix gate-retry F2 F5 --commit <old sha> --by operator` runs, then it exits non-zero naming each candidate commit found, and `phax/records/v1` is unchanged. (refs §5.16)

## 9. Open questions

### q-phase-commits — Does this spec also cover other records phax holds by sha?

- follow-up — No: phase commits already resolve through their trailers, and approval baselines are named as a follow-up — abandons: one fix for every sha phax stores: an approval baseline taken on a branch that is later rewritten still breaks until its own brief lands
- cover-baselines — Yes: approval baselines resolve the same way here — abandons: a bounded spec: approvals have no fate key or trailer of their own, so this spec would grow a second identity scheme

Recommendation: follow-up — Approval baselines need their own identity, and folding them in would push this spec past its bounds. The non-goal names them so the follow-up is not lost.

## 9b. Arbitrated questions

### q-key — What makes the fate key unique on the fix commit?

- finding-run — A new run trailer `Finding-Run: <run id>` beside `Short-Name` and the `Finding` trailers — abandons: a single run-id trailer name across phax's commits: readers learn one more trailer
- run-id — `Run-Id: <run id>` on the fix commit, lifting the earlier non-goal — abandons: release notes' current reading: a fix commit alone would register its run, so a late fix in a later release warns as a run with no completed plan, and every `Run-Id` reader must learn to tell a fix commit from a phase commit
- short-name-window — No new trailer: `Short-Name` plus `Finding`, accepted only on commits within the run's dates — abandons: an unambiguous key: two runs sharing a short name after a prune, with overlapping windows, collide silently

Recommendation: finding-run — A dedicated trailer makes the key exact and leaves every current `Run-Id` reader (release notes, `records explain`, close recovery) untouched. Learning one more trailer name is the cheapest of the three losses.

Decision: finding-run — by operator (Rémy Loubradou), 2026-11-22
Why: A dedicated trailer makes the key exact and leaves every current `Run-Id` reader (release notes, `records explain`, close recovery) untouched. Learning one more trailer name is the cheapest of the three losses. Advocate: The strongest case for run-id: phax would use one trailer name for a run's identity everywhere, so every reader and every `git log --grep` finds a run's commits the same way, with no second trailer to learn. Principles: S1, S2. Reversibility: costly. Revised: none.

### q-store — Is a resolution only computed when a fate is read, or is it also written back?

- read-time — Resolve on every read, within the search range, and write nothing; `--commit` re-records explicitly — abandons: a records history that shows the rewrite without the operator asking, and each read pays a bounded log walk
- write-back — Write a new fixed fate record with the new sha the first time a read resolves it — abandons: read-only readers: `finding list` would commit to `phax/records/v1`, under a `by` that names nobody who decided anything
- cache — Cache resolutions in a local file beside the run — abandons: a single source of truth: a second, machine-local answer that goes stale when the base branch moves and is missing on another clone

Recommendation: read-time — Readers stay readers. The search range keeps the cost at one bounded walk per run, and the operator who wants the rewrite in the history has `--commit` with the old sha to record it.

Decision: read-time — by operator (Rémy Loubradou), 2026-11-22
Why: Readers stay readers. The search range keeps the cost at one bounded walk per run, and the operator who wants the rewrite in the history has `--commit` with the old sha to record it. Advocate: The strongest case for write-back: the first read that finds the rewrite would record it once, so later reads are direct, the history shows the rewrite, and no read repeats the log walk. Principles: S1, S4. Reversibility: cheap. Revised: none.

### q-ambiguous — What does phax answer when several commits match the same fate?

- list-all — Answer `ambiguous`, listing every match oldest first, and name none as the fix — abandons: a single link in the comment and a post on a merged pull request until the operator picks one with `--commit`
- latest — Pick the match nearest the tip — abandons: the signal that the fix was reverted and re-applied or cherry-picked: phax would silently name a commit that may not be the one carrying the fix
- refuse — Fail the read — abandons: `phax finding list` for the whole run over one finding's ambiguity

Recommendation: list-all — Ambiguity is rare (a cherry-pick, a revert then a re-apply), and the operator is the one who can settle it. Listing every match keeps the list usable, and a single `--commit` call ends it.

Decision: list-all — by operator (Rémy Loubradou), 2026-11-22
Why: Ambiguity is rare (a cherry-pick, a revert then a re-apply), and the operator is the one who can settle it. Listing every match keeps the list usable, and a single `--commit` call ends it. Advocate: The strongest case for latest: the commit nearest the tip is usually the one that carries the fix now, and the comment and the post on a merged pull request get a single link without the operator doing anything. Principles: S1, S5, S6. Reversibility: cheap. Revised: none.

### q-squash-description — What happens when the pull request was squashed with its description only, so the trailers are gone and no patch id matches?

- hint — Answer `not-found`, naming the branches searched; post's refusal names the `--commit <sha>` retry, which already accepts a base-branch commit — abandons: an automatic pointer in that squash setting: the operator supplies the squash sha once
- github-merge-commit — Ask GitHub for the pull request's merge commit and resolve to it, in `finding post` only — abandons: one resolution for every reader: `finding list` stays local and answers `not-found` while `post` answers a commit, and a squash commit is claimed to fix a finding by inference, not evidence

Recommendation: hint — A commit claimed by inference is the false confidence this spec exists to remove. The squash sha is one copy away, and `--commit` records it as evidence.

Decision: hint — by operator (Rémy Loubradou), 2026-11-22
Why: A commit claimed by inference is the false confidence this spec exists to remove. The squash sha is one copy away, and `--commit` records it as evidence. Advocate: The strongest case for github-merge-commit: GitHub knows which commit the pull request became, so `finding post` would work after a description-only squash without the operator hunting for a sha. Principles: S1, S3, S10. Reversibility: cheap. Revised: none.

## 10. Implementation-planning note

Settled:

- The fate key is (run id, finding id). A commit carries it when one paragraph of its message holds both the run trailer and `Finding: <id>`; the paragraph need not be the last.
- Order: on the base branch, the recorded sha, then the key, then the patch id; then the same three on the run's branch when it resolves. Several matches at the first step that matches give `ambiguous`; no match gives `not-found`.
- The search range starts at the run's start: only commits committed at or after it are considered.
- Only the latest fixed fate entry of a finding is resolved; `history` is unchanged.
- The finding-list document gains a required `landed` (a published format, so a new `$schema` release); no optional field, no shim.
- Fix commits keep `Short-Name` and carry no `Run-Id`.
- `dismiss`, `defer` and their comments are unchanged; a closed, unmerged pull request still refuses a fixed comment.

Left open:

- Where the run's start time is read from for a live run and for an archived one.
- Whether one log walk per branch per run serves every fixed finding of the run, or each finding is resolved on its own.
- How the run trailer's final name lands if q-key is decided otherwise.

Constraints:

- `phax finding list` stays local: no fetch, no GitHub call. `phax finding post` makes no GitHub call beyond the ones it makes today.
- All git access, patch ids included, goes through the Git port; nothing in `app/`, `domain/` or `cli/` shells out.
- The base branch is read as `--commit` reads it today: `publish.baseBranch`, else `main`, the local branch, else the remote-tracking one.
- The resolution writes nothing; only `phax finding fix --commit` writes a record, and only after every refusal check.
- Release notes code is not changed by this spec; the acceptance criterion on release notes checks that their behavior is unchanged.

## 11. Docs page

Page: docs/findings.md, a new section "When the fix commit is rewritten" after "Recording an earlier commit"

Reader: An operator whose project merges by Rebase and merge or squash, or who rebases or amends a run branch during review, and wants to know what `finding list`, `finding post` and `--commit` show afterwards.

Example: $ phax finding list gate-retry
F2  concern  fixed  tests/gate.test.ts:12  The gate drops the exit code
               3fa91c2 (tests) → 8b04d6e on main, by key

$ phax finding fix gate-retry F2 --commit 3fa91c2 --by operator
✓ 3fa91c2 is on neither phax/gate-retry nor main; its rewrite 8b04d6e on main carries gate-retry-2026-11-18 F2 (by key)

## 12. Decision log

- 2026-11-22 q-key decided finding-run — operator (Rémy Loubradou)
- 2026-11-22 q-store decided read-time — operator (Rémy Loubradou)
- 2026-11-22 q-ambiguous decided list-all — operator (Rémy Loubradou)
- 2026-11-22 q-squash-description decided hint — operator (Rémy Loubradou)
