---
status: Completed
date: 2026-11-06
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
approved:
  date: 2026-11-06
  baseline: 32679f9
---
# Records land on the records remote's tip

## 1. Context

phax writes every record as one commit on the branch `phax/records/v1`. With `records.destination` `{ "kind": "in-repo" }` the commit lands in the source repository and is pushed to `publish.remote`; with `{ "kind": "repo", "remote": <url> }` it lands in a local clone of that remote, kept under the state root, and is pushed to that clone's `origin`. Each record commit's tree holds only that write's files, under the record's `<key>/` folder, so two records conflict only when they share a key.

A record commit's parent is the tip of the local branch `refs/heads/phax/records/v1`, or nothing when that branch does not exist: the first write is an orphan. `phax records sync` clones the remote when no local clone exists and only fetches it otherwise; it never creates or moves the local branch. A clone has `refs/remotes/origin/phax/records/v1` but no local branch of that name unless the records branch is the remote's default branch. The same holds for a fresh clone of a source repository whose in-repo records were already pushed.

When a push is refused, `phax records status` lists the records as pending, and the command that wrote the record prints git's error with `share it with git -C <path> push <remote> phax/records/v1`.

Ground read:

- `src/app/recordsSync.ts` — reconcileRecordsSync clones when the clone path is missing, refuses on an origin mismatch or a clone with no origin, and otherwise only fetches origin; it never touches refs/heads/phax/records/v1. pushRecordsBranch pushes phax/records/v1 to origin (dedicated) or publish.remote (in-repo) and reports a rejected push as `failed` with git's stderr.
- `src/infra/git.ts` — writeTreeCommitEffect parents the record commit on the local branch tip, or writes an orphan when refs/heads/phax/records/v1 does not exist, then update-refs the branch.
- `src/app/recordsStatus.ts` — computeRecordsPending walks the first-parent chain from the local tip until it meets the remote-tracking tip; each record commit's tree holds only that write's own files, under its <key>/ folder. On a diverged branch the walk never meets the remote tip and counts shared history as pending.
- `src/cli/definitions/records.ts` — Current `phax records sync` outputs (`Cloned records into …`, `Fetched records into …`, `Records destination is in-repo; nothing to sync.`), its refusal reasons (origin-mismatch, local-only-history), and the `phax records status` text and JSON shape.
- `src/app/publishRun.ts` — A failed records push prints `Records push to <remote> failed: <git stderr> — records remain pending (see `phax records status`).`
- `src/app/authorArtifact.ts` — Authoring, decision and review records print `… not pushed to <remote> (<stderr>) — it stays pending (…); share it with `git -C <path> push <remote> phax/records/v1``, a remedy that cannot succeed when the branch has diverged.
- `src/app/writeRecord.ts` — A record's key is `<runId>/<phaseId>` (authoring, decision and review records have their own keys); the record commit message carries Run-Id/Phase-Id trailers.

## 2. Problem

Two common situations make the records push fail every time, and nothing tells the operator why or how to fix it.

A fresh clone of a remote that already holds records gets no local records branch. Its first record is an orphan, and every later record sits on top of it. The push is refused as non-fast-forward, and the local branch shares no commit with the remote's, so forcing the push would wipe out every record the remote held. Measured: a remote whose records branch held about 300 records, a fresh `phax records sync`, one run of two phases. Its three records stayed pending on a branch with no common ancestor. The in-repo destination has the same defect after a fresh clone of the source repository.

A clone whose local branch is behind its remote diverges on its next record. This happens whenever another writer pushed since: a second machine, a second project sharing the remote, or an in-repo destination pushing to the same repository. `phax records sync` fetches but never moves the local branch, so the next record parents onto the stale tip.

In both cases the only remedy phax names is a plain `git push`, which cannot succeed. `phax records status` cannot tell "not pushed yet" from "can never be pushed as is". On a diverged branch it also counts records the remote already holds as pending.

## 3. Product goal

A record always lands on top of what the records remote already holds, as far as phax last saw it. `phax records sync` brings the local records branch level with the remote without ever discarding a record. Records already stranded on an orphan or a stale tip are named, and phax gives the command that brings them home. Pushing the records branch then always means a fast-forward.

> Every record reaches the remote, on top of every record already there, and no record on either side is ever lost or force-pushed over.

## 4. Terminology

- **records branch** — `phax/records/v1`, the branch every record commit is written to.
- **local tip (L)** — The commit `refs/heads/phax/records/v1` points to in the repository records are written to: the dedicated clone, or the source repository for an in-repo destination. It can be missing.
- **remote tip (R)** — The commit the remote-tracking ref `refs/remotes/<remote>/phax/records/v1` points to in that repository, where `<remote>` is `origin` for a dedicated clone and `publish.remote` for in-repo. It is what phax last fetched and can be missing. It is never the live remote, which phax reads only when it fetches.
- **branch state** — One of exactly seven values that compare L and R. `in-sync`: L equals R. `ahead`: R is a strict ancestor of L. `behind`: L is a strict ancestor of R. `diverged`: L and R share a commit but neither is an ancestor of the other. `unrelated`: L and R share no commit. `no-local-branch`: R exists and L does not. `no-remote-branch`: L exists and R does not. When both are missing, the state is `in-sync`.
- **local-only record** — A record commit reachable from L but not from R.
- **replay** — Rewriting each local-only record, oldest first, as a new commit on top of R. The new commit has the same tree and message as the original, so the record's content is unchanged. The local branch then moves to the last new commit.

## 5. Functional requirements

### 5.1 Parent on the local tip when it holds the remote

WHEN phax writes a record and the branch state is `in-sync`, `ahead` or `no-remote-branch` THE system SHALL parent the record commit on the local tip.

### 5.2 Parent on the remote tip when the local branch is missing or behind

WHEN phax writes a record and the branch state is `no-local-branch` or `behind` THE system SHALL first move the local branch to the remote tip and then parent the record commit on it, for both the dedicated and the in-repo destination.

### 5.3 A diverged branch still keeps the record

IF phax writes a record while the branch state is `diverged` or `unrelated` THEN the system SHALL parent the record commit on the local tip, so the record is kept, and report the branch state with its remedy.

### 5.4 Sync creates the missing local branch

WHEN `phax records sync` has fetched a dedicated clone and the branch state is `no-local-branch` THE system SHALL create the local records branch at the remote tip.

### 5.5 Sync fast-forwards a branch that is behind

WHEN `phax records sync` has fetched a dedicated clone and the branch state is `behind` THE system SHALL fast-forward the local records branch to the remote tip.

### 5.6 Sync refuses a diverged branch

IF `phax records sync` finds the branch state `diverged` or `unrelated` and `--replay` was not given THEN the system SHALL exit 1 and leave the local branch untouched. The refusal SHALL name the branch state, both tips, the number of local-only records and `phax records sync --replay` as the remedy.

### 5.7 Replay brings stranded records home

WHERE `phax records sync --replay` is run and the branch state is `diverged` or `unrelated` THE system SHALL replay every local-only record onto the remote tip. It SHALL then print the number of records replayed, the new local tip and the previous local tip.

### 5.8 Replay never duplicates a key

IF a local-only record has the same key as a record reachable from the remote tip THEN `phax records sync --replay` SHALL exit 1 naming that key and both commits, and leave the local branch untouched.

### 5.9 Status reports the branch state

`phax records status` SHALL report the branch state together with the local tip and the remote tip, and the remedy for any state other than `in-sync` and `no-remote-branch`.

### 5.10 Pending counts only local-only records

`phax records status` SHALL count as pending only local-only records, whatever the branch state.

### 5.11 A refused push says why and what to run

WHEN a push of the records branch is refused THE command that wrote the record SHALL name the branch state. It SHALL name `phax records sync` when the state is `behind`, and `phax records sync --replay` when it is `diverged` or `unrelated`, in place of the plain `git push` remedy.

### 5.12 Never forced

The system SHALL never push the records branch with force. It SHALL never move the local records branch to a commit that leaves any record of the previous local tip without an identical record (same key, tree and message) on the new tip.

## 6. Surface

### cli: phax records sync — indicative

Summary: Running `phax records sync` now also creates or fast-forwards the local records branch, so the next record lands on top of the remote's records.

before:

    $ phax records sync
    Cloned records into ~/.phax/records/acme

    $ phax records sync
    Fetched records into ~/.phax/records/acme

after:

    $ phax records sync
    Cloned records into ~/.phax/records/acme
    Records branch created at origin's tip 3f2a9c1 (312 records)

    $ phax records sync
    Fetched records into ~/.phax/records/acme
    Records branch fast-forwarded 8d0e4b7 → 3f2a9c1

    $ phax records sync
    Fetched records into ~/.phax/records/acme
    Records branch is ahead of origin: 2 record(s) pending

### cli: phax records sync (diverged refusal) — normative

Summary: When the local records branch has split from the remote's, `phax records sync` stops, shows both tips and gives the command that brings the records home.

    $ phax records sync
    Fetched records into ~/.phax/records/acme
    ✗ records branch is unrelated to origin's: local tip a41c0de, origin tip 3f2a9c1, 3 local-only record(s)
      replay them onto origin's tip with `phax records sync --replay`
    $? = 1

    --json error fields: { "reason": "diverged" | "unrelated", "localTip": "a41c0de…", "remoteTip": "3f2a9c1…", "localOnly": 3, "remedy": "phax records sync --replay" }

### cli: phax records sync --replay — indicative

Summary: Running `phax records sync --replay` puts records written on an orphan or stale branch on top of the remote's, ready to push, without losing any.

    $ phax records sync --replay
    Fetched records into ~/.phax/records/acme
    Replayed 3 record(s) onto origin's tip 3f2a9c1 → new tip 9b77e20 (previous tip a41c0de)
    Push them with the next record, or `git -C ~/.phax/records/acme push origin phax/records/v1`

    $ phax records sync --replay
    ✗ record r-7f3a/phase-02 exists on both sides (local 5c1d2e0, origin 77ab310); nothing replayed
    $? = 1

### cli: phax records status — indicative

Summary: `phax records status` now says whether the records branch is ahead, behind, diverged or unrelated to the remote, and what to run.

before:

    Records destination: repo "git@github.com:acme/records.git" (local clone: ~/.phax/records/acme)
    Pending: 3 record(s) across 1 run(s)
      add-billing (phase-01, phase-02)

after:

    Records destination: repo "git@github.com:acme/records.git" (local clone: ~/.phax/records/acme)
    Records branch: unrelated to origin (local a41c0de, origin 3f2a9c1) — run `phax records sync --replay`
    Pending: 3 record(s) across 1 run(s)
      add-billing (phase-01, phase-02)

### cli: phax records status --json — normative

Summary: Tools reading `phax records status --json` get the records branch state and both tips.

before:

    { "kind": "status", "destination": { "kind": "repo", "remote": "…" }, "localPath": "…", "remote": "origin", "pending": 3, "runs": [ … ] }

after:

    { "kind": "status", "destination": { "kind": "repo", "remote": "…" }, "localPath": "…", "remote": "origin",
      "branch": { "state": "in-sync" | "ahead" | "behind" | "diverged" | "unrelated" | "no-local-branch" | "no-remote-branch",
                  "localTip": "a41c0de…" | null, "remoteTip": "3f2a9c1…" | null },
      "pending": 3, "runs": [ … ] }

### cli: records push refused (phax publish, phax run, authoring, decision and review records) — indicative

Summary: When a records push is refused, the command says whether the branch is behind, diverged or unrelated and names the `phax records sync` command that fixes it.

before:

    Records push to origin failed: ! [rejected] phax/records/v1 -> phax/records/v1 (non-fast-forward) — records remain pending (see `phax records status`).

after:

    Records push to origin refused: the records branch is unrelated to origin's (local a41c0de, origin 3f2a9c1) — records remain pending; run `phax records sync --replay`, then push.

## 7. Non-goals

- Moving records between remotes, or choosing a project's records remote.
- The records' contents, their transcripts, and what they withhold.
- Any change to a record's layout, manifest or version: records keep their current persisted format.
- Fetching the remote before every record write or retrying a refused push automatically: a record parents on the remote tip as phax last fetched it.
- Merging the records branch: phax never creates a merge commit on it.
- Pushing from `phax records sync`: sync prepares a fast-forward, and the existing push points share it.
- Recovering records lost by a force-push someone already made.

## 8. Acceptance criteria

### A fresh clone writes on top of the remote's records

Given a records remote whose `phax/records/v1` holds records, and no local clone, when `phax records sync` runs and a run then writes two phase records and pushes, then `phax records sync` reports the branch created at origin's tip. Both records' commits descend from that tip, the push is a fast-forward that succeeds, and `phax records status` reports `in-sync` with nothing pending. (refs §5.4, §5.1)

### A missing local branch is created at write time

Given a dedicated clone or an in-repo source repository with `refs/remotes/<remote>/phax/records/v1` and no local `phax/records/v1`, when a record is written, then the record commit's parent is the remote tip, not an orphan. (refs §5.2)

### Sync fast-forwards a branch behind the remote

Given a dedicated clone whose local records branch is a strict ancestor of the remote's after another writer pushed, when `phax records sync` runs, then the local branch points to the remote tip, the output names both tips, and the next record's parent is that tip. (refs §5.5)

### A branch behind at write time catches up first

Given a clone whose fetched remote tip is ahead of its local records branch, when a record is written without running sync first, then the record's parent is the remote tip, and the commit that the local branch pointed to before the write is an ancestor of the new tip. (refs §5.2)

### A record written on a diverged branch is kept and reported

Given a dedicated clone whose local records branch is unrelated to the remote's, when `phax run` writes a record, then the record commit's parent is the local tip, and the command's output names the state `unrelated` and `phax records sync --replay`. (refs §5.3, §5.11)

### Sync refuses a diverged branch without --replay

Given a dedicated clone whose local records branch is `unrelated` (or `diverged`) to the remote's, with 3 local-only records, when `phax records sync` runs, then it exits 1 and the local branch ref is unchanged. The `--json` error carries `reason`, `localTip`, `remoteTip`, `localOnly: 3` and `remedy: "phax records sync --replay"`. (refs §5.6)

### Replay puts stranded records on the remote tip

Given the clone of the previous criterion, when `phax records sync --replay` runs, then the local branch descends from the remote tip and holds exactly 3 new commits, whose trees and messages equal the 3 local-only records'. The output names the previous tip, `phax records status` reports `ahead` with 3 pending, and a plain push succeeds as a fast-forward. (refs §5.7, §5.12)

### Replay refuses a key already on the remote

Given a diverged clone where one local-only record has the same key as a record on the remote branch, when `phax records sync --replay` runs, then it exits 1 naming that key and both commits, and the local branch ref is unchanged. (refs §5.8)

### Status reports each branch state

Given seven clones, each in one branch state, when `phax records status --json` runs in each, then `branch.state` is that state, `branch.localTip` and `branch.remoteTip` are the full shas or null, and the text output names the remedy for `behind`, `diverged`, `unrelated` and `no-local-branch`. (refs §5.9)

### Pending excludes records the remote holds

Given a diverged clone sharing 300 records with the remote and holding 2 local-only records, when `phax records status --json` runs, then `pending` is 2. (refs §5.10)

### A refused push names the fix

Given a clone whose push of `phax/records/v1` is refused as non-fast-forward because another writer pushed since the last fetch, when `phax publish` (or an authoring, decision or review record) attempts the push, then the message names the branch state and `phax records sync` or `phax records sync --replay`, and does not suggest a plain `git push`. (refs §5.11)

### No path forces the records branch

Given every records push and every records branch update phax makes, exercised across the criteria above, when the git invocations are observed, then none passes `--force`, `--force-with-lease` or a `+` refspec, and every update of the local branch either fast-forwards it or is a replay. (refs §5.12)

## 9. Open questions

None.

## 9b. Arbitrated questions

### q-replay — How should records already written on an orphan or stale tip be brought home?

- replay-flag — `phax records sync --replay` replays them onto the remote tip on request; plain sync refuses and names it — abandons: zero-touch recovery: the operator has to run one more command after reading the refusal
- replay-auto — `phax records sync` replays automatically whenever the branch has diverged — abandons: the operator's chance to look before phax rewrites local commits; a sync that was expected to only fetch rewrites history
- report-only — phax only reports the divergence and prints the git commands (commit-tree per record) that do the replay — abandons: a supported recovery: each operator hand-runs plumbing that is easy to get wrong, at the moment records are most at risk

Recommendation: replay-flag — A replay cannot conflict except on a shared key, which phax detects, so phax can do it safely. What remains is consent: one explicit flag keeps the history rewrite visible and costs a single command that the refusal already names.

Decision: replay-flag — by operator (Rémy Loubradou), 2026-11-06
Why: A replay cannot conflict except on a shared key, which phax detects, so phax can do it safely. What remains is consent: one explicit flag keeps the history rewrite visible and costs a single command that the refusal already names. Advocate: The strongest case for replay-auto: the refusal already names the one command that fixes it, so asking the operator to type it adds a step with no information, and a records push that never needs attention is the goal. Principles: S1, S7, E0. Reversibility: cheap. Revised: none.

### q-two-writers — Does phax support two writers on one records branch of one remote (two machines, two projects, or an in-repo and a dedicated destination)?

- support — Support it: writers converge through the parent rule, sync and replay; nothing is refused — abandons: a guarantee that a push never meets a moved remote: a concurrent writer can still cause a refused push, which then needs a sync
- refuse-detectable — Support it, but refuse the one pairing phax can detect: a dedicated destination whose remote is the project's own publish remote — abandons: a legitimate layout where records share the code's repository yet live in a separate clone, refused for a risk the parent rule already handles
- refuse-all — Declare one writer per records branch and refuse whatever phax can detect — abandons: the second machine: one operator on two machines is two writers, and phax cannot tell them from two projects

Recommendation: support — Two machines are already two writers, and that case has to work. Once a refused push is self-explaining and recoverable, refusing other pairings protects nothing that the parent rule and replay do not already protect.

Decision: support — by operator (Rémy Loubradou), 2026-11-06
Why: Two machines are already two writers, and that case has to work. Once a refused push is self-explaining and recoverable, refusing other pairings protects nothing that the parent rule and replay do not already protect. Advocate: The strongest case for refuse-detectable: a dedicated clone of the project's own publish remote is the one pairing phax can see, and refusing it removes a source of refused pushes before it starts, which is what a strict refusal is for. Principles: S1, S8. Reversibility: cheap. Revised: none.

### q-in-repo-sync — The in-repo destination has the same missing-branch defect after a fresh clone. Should `phax records sync` also create, fast-forward and replay the in-repo records branch against `publish.remote`?

- sync-in-repo — Yes: for in-repo, sync fetches `publish.remote`'s records branch and applies the same create, fast-forward, refuse and replay rules — abandons: today's `nothing to sync` answer for in-repo: sync starts fetching from the source repository's remote
- write-time-only — No: in-repo gets only the write-time parent rule, status and messages; its divergence remedy is printed as git commands — abandons: one remedy for both destinations: an in-repo operator with a diverged branch gets plumbing instructions instead of a command

Recommendation: sync-in-repo — The defect is the same, so the remedy should be the same. Keeping in-repo sync a no-op would leave the in-repo operator as stranded as the dedicated one is today.

Decision: sync-in-repo — by operator (Rémy Loubradou), 2026-11-06
Why: The defect is the same, so the remedy should be the same. Keeping in-repo sync a no-op would leave the in-repo operator as stranded as the dedicated one is today. Advocate: The strongest case for write-time-only: in-repo sync is a no-op today, and making it fetch from the source repository's remote changes what a command does for every in-repo project, including those that never had the defect. Principles: S1, S4, S5. Reversibility: costly. Revised: none.

## 10. Implementation-planning note

Settled:

- The branch state is derived from git alone (L, R and their ancestry), with no state file, just as pending is today.
- The parent rule applies to both destinations; the in-repo destination is shown to have the same defect after a fresh clone of the source repository.
- A replayed record keeps its tree and message byte for byte; only its parent and commit sha change.
- `phax records sync` never pushes; the existing push points share the result.

Left open:

- The answers to q-replay, q-two-writers and q-in-repo-sync.
- The exact text of the sync, status and refused-push lines (indicative); the `--json` shapes of the status `branch` field and of the sync refusal are normative.
- Whether the previous local tip after a replay is also kept under a named ref, beyond being printed.

Constraints:

- No path pushes `phax/records/v1` with force or a `+` refspec, and none resets it to a commit that drops a record.
- No persisted format bump: record layout, manifests and their versions stay as they are.
- The CLI output schemas for `phax records sync` and `phax records status` gain the new variants and fields as required, not optional.
- All git reads and ref updates go through the Git port; the branch-state classification is pure domain logic.
- phax names no project in its messages: the words are phax's own.

## 11. Docs page

Page: guide/records — a section "When the records branch and its remote disagree"

Reader: an operator whose records stay pending after a fresh clone or a second machine

Example: `phax records status` shows `Records branch: unrelated to origin (local a41c0de, origin 3f2a9c1)`. The operator runs `phax records sync --replay`, sees `Replayed 3 record(s) onto origin's tip`, and the next push succeeds.

## 12. Decision log

- 2026-11-06 q-replay decided replay-flag — operator (Rémy Loubradou)
- 2026-11-06 q-two-writers decided support — operator (Rémy Loubradou)
- 2026-11-06 q-in-repo-sync decided sync-in-repo — operator (Rémy Loubradou)
