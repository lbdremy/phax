---
status: Completed
source-spec: docs/specs/2611061447-records-branch-tip.md
completes-spec: true
approved:
  date: 2026-11-06
  baseline: 0977ed7
---
# Records land on the records remote's tip

Make every record commit land on top of what the records remote already holds, as phax last fetched it, and give stranded records a supported way home. The work goes inside-out. Phase-01 adds the pure classification of the records branch: seven states from the local tip L, the remote tip R and their merge base. It also adds the parent rule, the sync action, the remedies, the record keys and the replay key collision. Phase-02 adds the Git port reads and compare-and-swap ref updates the rule needs, with the adapter, the fake and a contract suite run against both. Phase-03 applies the parent rule at write time, for every record writer and both destinations, and reports a record kept on a diverged branch. Phase-04 writes the frozen acceptance tests of `phax records sync`. Phase-05 passes them: it creates, fast-forwards, refuses and replays, for the dedicated clone and for in-repo against `publish.remote`. Phase-06 adds the branch state to `phax records status`, counts pending as local-only records, and makes every refused push name its fix. Phase-07 writes the docs. No persisted record format changes. No path pushes with force or a `+` refspec. Every ref update is a compare-and-swap that either fast-forwards or replays.

Release context: 0.34.0 is installed and 0.35.0 is open. The run that implements this plan writes its own records with the installed 0.34.0, so its records are not evidence for or against this change.

## Required commands

- (none)

No new command: every phase uses the pnpm scripts and git the repository already allows. The gate profile `standard` in phax.json verifies every phase. Phase-05 regenerates the usage spec with the existing `pnpm gen:usage-spec` script.

## Technical arbitrations

- Where the parent rule lives: in the app, not the Git adapter. A new `src/app/recordsBranch.ts` reads L, R and their merge base through the port. The pure `recordParentFor` (src/domain/records/branchState.ts) picks the parent and the expected tip. `commitRecordTree` passes both to `writeTreeCommit`, which now takes an explicit `parent` and `expectedTip` and moves the branch with one compare-and-swap. So a behind or missing branch is caught up and written in a single ref update, and both destinations share the rule because both go through `commitRecordTree`. Loss accepted: `writeTreeCommit` no longer finds its own parent, so its signature changes for its one caller and for the fake, and a record write costs a short bounded loop: when the compare-and-swap finds the branch moved by a concurrent writer in the same repository, `commitRecordTree` reads the branch again, recomputes the parent and recommits, up to three attempts, and only then fails with the stale-tip error (operator decision 2026-11-06: today the last `update-ref` silently drops the other writer's record; with the loop neither record is lost).
- How a replay is written: the local-only commits are listed oldest first (`git log --reverse <L> ^<R>`). Each one is recommitted with `commit-tree` onto the previous new commit, starting from R. It keeps its tree, its message bytes (passed on stdin, no cleanup) and its author name, email and date. Only the parent, the committer and the sha change. Every new commit is written before the branch moves, and the branch then moves once, by compare-and-swap from the old L to the last new commit. Loss accepted: the committer of a replayed record is whoever ran the replay, not the original writer.
- How a record's key is read for §5.8: from the commit's tree. Every record writer puts its manifest at `<key>/record.json`, so a commit's keys are the paths ending in `/record.json` with that suffix removed. The keys on the remote side are read from every commit reachable from R in one `git log --name-only` call. The commit trailers are not used, because authoring, decision and review records carry no Run-Id/Phase-Id trailers. Loss accepted: a replay reads the file list of the whole remote history once, in one git process, rather than looking up only the keys it needs.
- Whether the previous tip is kept under a named ref after a replay: no. It is printed, and git's reflog keeps it. §5.12 guarantees that every record of the old tip has an identical record on the new tip, so the old tip holds nothing unique. Loss accepted: an operator who lost the printed sha relies on the reflog to see the old branch.
- How the branch state is computed: from git alone, with `resolveRef` for L and R and a new port `mergeBase`, which returns null when the two share no commit. The pure `classifyRecordsBranch` maps (L, R, merge base) to one of the seven states. With both tips missing the state is in-sync; with L == R it is in-sync; a missing merge base means unrelated; a merge base equal to R means ahead, equal to L means behind, anything else diverged. Pending is the set of commits from L excluding R (`git log <L> ^<R>`, or every commit of L when R is missing), which replaces the first-parent walk. On a diverged or unrelated branch it therefore counts only local-only records. Loss accepted: the record branch must stay merge-free for 'ancestor' to mean what the states say, which phax already guarantees because it never merges it.
- How `phax records sync` fetches the in-repo records branch: a new port `fetchBranch(repo, remote, branch)` first asks `git ls-remote --exit-code --heads -- <remote> refs/heads/phax/records/v1`. When the branch exists, it runs `git fetch -- <remote> refs/heads/phax/records/v1:refs/remotes/<remote>/phax/records/v1` (no `+`), and it answers `absent` when the remote has no records branch. That fetch writes only that one remote-tracking ref. The local branch then moves with `update-ref`, which never touches the working tree, the index or the checked-out branch. Loss accepted: a records branch someone force-pushed on the remote makes the in-repo fetch fail with git's own error instead of following the rewrite. Recovering from such a force-push is a non-goal of the spec.
- What a refused push reports: after a failed push, `pushRecordsBranch` fetches only the records branch (dedicated: `fetchBranch` on origin; in-repo: on `publish.remote`), then classifies. That fetch happens only on a failure, never before a write. If the fetch fails, the state is computed against the stale R. When the state is behind, diverged or unrelated, the message names it and `phax records sync` or `phax records sync --replay`, never a plain `git push`. Otherwise the failure is not a branch disagreement (no network, no rights), and the message gives git's error with the existing `git push` remedy. Loss accepted: a refused push costs one more network round trip, and it moves the remote-tracking ref, so `phax records status` afterwards shows the remote as the push attempt last saw it.
- What sync does in each state: no-local-branch creates L at R; behind fast-forwards L to R; ahead, in-sync and no-remote-branch leave L alone and report; diverged and unrelated refuse without `--replay` and replay with it. `--replay` in any other state does what plain sync does and says nothing was replayed. Init keeps calling the existing `reconcileRecordsSync`, so `phax records init` still clones or fetches only, and the branch alignment runs only in `phax records sync`. Loss accepted: right after `phax records init` on a remote that already holds records, the local branch is still missing. The write-time parent rule then catches it up at the first record write.

---

## phase-01 — Records branch state classification {#phase-01-branch-state}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

Add the pure domain logic that compares the local and remote records tips. It classifies them into the seven branch states and gives, for each state, the record parent, the sync action and the remedy. It also reads a record commit's keys and finds a replay key collision. No I/O: later phases feed it what git reports.

### Detailed instructions

- Create `src/domain/records/branchState.ts`, pure: no imports from ports, infra or app.
- Export `RECORDS_BRANCH_STATES` as a readonly tuple of the seven literals, in this order: `in-sync`, `ahead`, `behind`, `diverged`, `unrelated`, `no-local-branch`, `no-remote-branch`. Export `type RecordsBranchState` derived from it.
- Export `interface RecordsBranchReading { readonly state: RecordsBranchState; readonly localTip: string | null; readonly remoteTip: string | null }`.
- Export `classifyRecordsBranch(input: { localTip: string | null; remoteTip: string | null; mergeBase: string | null }): RecordsBranchState`. Both tips null gives in-sync. Only L null gives no-local-branch. Only R null gives no-remote-branch. L === R gives in-sync. A null merge base (with both tips present) gives unrelated. A merge base equal to R gives ahead. A merge base equal to L gives behind. Any other merge base gives diverged.
- Export `recordParentFor(reading: RecordsBranchReading): { readonly parent: string | null; readonly expectedTip: string | null }`. The expected tip is always the current L (null when missing). The parent is R for no-local-branch and behind (§5.2). For every other state it is L, which is null for in-sync with both missing (the orphan first write), and it stays L for diverged and unrelated (§5.3).
- Export `type RecordsSyncAction = 'create' | 'fast-forward' | 'none' | 'refuse' | 'replay'` and `recordsSyncActionFor(state, replay: boolean)`. no-local-branch gives create; behind gives fast-forward; diverged and unrelated give replay when `replay` is true and refuse when false; every other state gives none.
- Export `recordsBranchRemedy(state, { localPath, remote }): string | null`. behind and no-local-branch give `phax records sync`. diverged and unrelated give `phax records sync --replay`. ahead gives ``git -C <localPath> push <remote> phax/records/v1``. in-sync and no-remote-branch give null (§5.9).
- Export `recordsBranchPhrase(state, remote): string`, the words the messages use: `in sync with <remote>`, `ahead of <remote>`, `behind <remote>`, `diverged from <remote>'s`, `unrelated to <remote>'s`, `missing locally (<remote> has one)` and `not on <remote> yet`. The texts are phax's own words and name no project.
- Export `recordKeysOf(paths: readonly string[]): readonly string[]`: for every path ending in `/record.json`, the path without that suffix, deduplicated, in first-seen order. Other paths are ignored.
- Export `findReplayCollision(localOnly: readonly { sha: string; keys: readonly string[] }[], remote: readonly { sha: string; keys: readonly string[] }[]): { key: string; localCommit: string; remoteCommit: string } | null`. Return the first local-only key, oldest local commit first, that some remote commit also holds, or null.
- Write `tests/unit/domain/records/branchState.test.ts`. Use a table over every (L, R, merge base) shape, with one row per state plus the both-missing row, and a table for the parent, the sync action and the remedy of each state.

### Planned files to create

- `src/domain/records/branchState.ts`
- `tests/unit/domain/records/branchState.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- (none)

### Test strategy

- every (local tip, remote tip, merge base) shape classifies to exactly the state §4 defines, both-missing included — small · table · the §4 terminology table · in-phase · ac-status-states
- each state yields the parent §5.1–§5.3 name and an expected tip equal to the current local tip — small · table · §5.1, §5.2 and §5.3 per state · in-phase
- each state with and without --replay yields the sync action §5.4–§5.7 name, and the remedy §5.9 names — small · table · §5.4–§5.9 per state · in-phase
- record keys are read from the <key>/record.json paths of a commit, and a shared key yields the oldest local commit and the remote commit holding it — small · example · expected keys and collision triple · in-phase

### Implementation order

1. State tuple, reading type and classifyRecordsBranch with its table test
2. recordParentFor and recordsSyncActionFor
3. recordsBranchRemedy and recordsBranchPhrase
4. recordKeysOf and findReplayCollision

### Excluded scope

- Any git call, port method or adapter (phase-02).
- Wiring the rule into record writes (phase-03), sync (phase-05) or status (phase-06).

### Verification

The configured `standard` gate profile in phax.json.

### Expected handoff content

The module path `src/domain/records/branchState.ts` and the exact exported names and signatures: RECORDS_BRANCH_STATES, RecordsBranchState, RecordsBranchReading, classifyRecordsBranch, recordParentFor, RecordsSyncAction, recordsSyncActionFor, recordsBranchRemedy, recordsBranchPhrase, recordKeysOf and findReplayCollision. The exact phrase and remedy strings. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(records): classify the records branch against its remote tip`

### Commit body

Add the pure classification of phax/records/v1. It maps the local tip, the remote tip and their merge base to one of seven branch states, then gives each state its record parent, its sync action and its remedy. It also reads a record commit's keys from its <key>/record.json paths and finds a replay key collision. Table tests cover every state.

---

## phase-02 — Git port reads and guarded ref updates for the records branch {#phase-02-git-port}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

Give the Git port what the records branch rule needs: the merge base, the files of each commit in a range, a recommit onto a new parent, a compare-and-swap ref update and a fetch of one branch. It also gives `writeTreeCommit` an explicit parent and expected tip. The real adapter and the fake implement them, and one contract suite runs against both.

### Detailed instructions

- In `src/ports/git.ts` add to GitOps, with doc comments. `mergeBase(repo, a, b): Effect<string | null, GitError>` is null when the two commits share none. `listCommitFiles(repo, tip, exclude: string | null): Effect<readonly { sha: string; paths: readonly string[] }[], GitError>` gives every commit reachable from `tip` and not from `exclude`, oldest first, each with the paths of its own tree. `recommit(repo, commit, parent): Effect<string, GitError>` makes a new commit with `commit`'s tree, its message bytes and its author name, email and date, parented on `parent`. `updateRef(repo, ref, newSha, expectedOld: string | null): Effect<void, GitError>` is a compare-and-swap: it fails when the ref is not at `expectedOld`, or already exists when `expectedOld` is null. `fetchBranch(repo, remote, branch: BranchName): Effect<'fetched' | 'absent', GitError>`.
- Change `WriteTreeCommitInput` to require `parent: string | null` and `expectedTip: string | null`. The doc comment now says the commit is parented on `parent` (an orphan when null) and the branch moves only when it is still at `expectedTip`.
- In `src/infra/git.ts`: `mergeBase` runs `git merge-base --end-of-options a b`, and exit 1 gives null. `listCommitFiles` runs `git log --reverse --no-renames --format=<marker>%H --name-only <tip> [^<exclude>]` and parses it; the records branch has no merges, but parse a commit with no paths too. `recommit` reads `git cat-file commit <sha>`, takes the tree, the author line and the raw message after the first blank line, and runs `git commit-tree <tree> -p <parent> -F -` with the message bytes on stdin and GIT_AUTHOR_NAME, GIT_AUTHOR_EMAIL and GIT_AUTHOR_DATE set from the author line. `updateRef` uses `git update-ref --stdin` with a `create <ref> <new>` or `update <ref> <new> <old>` line, so no zero-oid literal is needed. `fetchBranch` runs `git ls-remote --exit-code --heads -- <remote> refs/heads/<branch>` (exit 2 gives `absent`), then `git fetch -- <remote> refs/heads/<branch>:refs/remotes/<remote>/<branch>` with no `+`.
- Rewrite `writeTreeCommitEffect` to use `input.parent` instead of its own `resolveRefEffect` lookup, and to move the branch through the same create/update `--stdin` compare-and-swap against `input.expectedTip`. No invocation anywhere passes `--force`, `--force-with-lease` or a `+` refspec.
- In `src/app/recordPlumbing.ts` `commitRecordTree`, keep today's behaviour for now: resolve `refs/heads/phax/records/v1` and pass it as both `parent` and `expectedTip`. Phase-03 replaces this with the parent rule.
- In `src/infra/fakes/git.ts` model a small commit graph: a commit has a sha, a parent, a tree's paths and a message. Make `writeTreeCommit`, `resolveRef`, `mergeBase`, `listCommitFiles`, `recommit`, `updateRef` and `fetchBranch` agree with the real adapter, logging each call in `calls` like the existing methods. Keep every existing fake behaviour the current tests rely on.
- Create `tests/integration/gitRecordsBranchContract.test.ts`: one suite, parameterised over the real adapter (temporary repositories, a bare remote and clones, isolated with the existing `tests/helpers/isolateGit.js`) and the fake. It covers the merge base for ancestor, diverged and unrelated tips; `listCommitFiles` order and exclusion; a recommit keeping tree, message bytes and author; `updateRef` accepting the expected tip and refusing a stale one or an existing ref on create; and `fetchBranch` answering absent and fetched.
- Update the existing writeTreeCommit tests (for example `tests/integration/gitObjectPlumbing.test.ts`) to the new input, without weakening what they check.

### Planned files to create

- `tests/integration/gitRecordsBranchContract.test.ts`

### Planned files to edit

- `src/ports/git.ts`
- `src/infra/git.ts`
- `src/infra/fakes/git.ts`
- `src/app/recordPlumbing.ts`

### Optional files that may be edited

- `tests/integration/gitObjectPlumbing.test.ts`
- `tests/integration/writeRecord.test.ts`
- `tests/helpers/tempGit.ts`

### Boundary contracts

app → Git port. The records use cases need, from the port, the merge base of two commits (or none), the files of each commit between two tips oldest first, a recommit that keeps tree, message and author, a ref move that happens only from an expected value, and a one-branch fetch that tells absent from fetched. The port provides these as plain shas, path lists and a two-value answer, and git stays in the adapter.

### Test strategy

- the fake and the real adapter agree on merge base, commit listing, recommit, guarded ref update and one-branch fetch — medium · contract · shared suite over both adapters · in-phase
- a recommitted record keeps its tree, message bytes and author, only parent and sha change — medium · example · git cat-file of both commits · in-phase · ac-replay
- a ref update from a stale expected tip is refused and leaves the ref where it was — medium · example · ref value before and after, typed GitError · in-phase · ac-never-forced
- writeTreeCommit parents on the given parent and moves the branch only from the expected tip — medium · example · git rev-parse of the commit's parent and the branch · in-phase

### Implementation order

1. Port signatures in src/ports/git.ts
2. Real adapter methods and the writeTreeCommit rewrite in src/infra/git.ts
3. commitRecordTree keeping today's parent
4. Fake commit graph
5. Contract suite and updated writeTreeCommit tests

### Excluded scope

- Choosing the parent by branch state (phase-03).
- Sync, replay or status logic (phase-05, phase-06).

### Verification

The configured `standard` gate profile in phax.json.

### Expected handoff content

The exact port signatures added to `src/ports/git.ts` and the new `WriteTreeCommitInput` fields. The git invocations each adapter method runs. How the fake models commits, and which fake helpers set up a remote-tracking ref or a remote branch for tests. Confirm that no invocation uses --force, --force-with-lease or a `+` refspec. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(git): add merge-base, commit listing, recommit and guarded ref updates`

### Commit body

Extend the Git port with mergeBase, listCommitFiles, recommit, updateRef (compare-and-swap through update-ref --stdin) and fetchBranch (one branch, no + refspec). writeTreeCommit now takes an explicit parent and expected tip. The real adapter and the fake implement them, and a contract suite runs the same cases against both. Record writes keep parenting on the local tip for now.

---

## phase-03 — Write-time parent rule for every record writer {#phase-03-write-parent-rule}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** One rule threads through four record writers, their five callers and both destinations, so a missed caller or destination means a record silently parented on the wrong tip; higher effort buys the care of tracing every path.

Make every record write, phase, authoring, decision and review, for both destinations, parent on the remote tip when the local branch is missing or behind, and on the local tip otherwise. A record written on a diverged or unrelated branch is kept and reported with its remedy.

### Detailed instructions

- Create `src/app/recordsBranch.ts`. Add `recordsBranchLocation(input: { records: ResolvedRecordsConfig; repoRoot: string; publishRemote: string; recordsClonePath?: string }): { repo: string; remote: string }`: the source repository and `publishRemote` for in-repo, the clone and `origin` for a dedicated repo. Add `readRecordsBranch(repo, remote): Effect<RecordsBranchReading, GitError, Git>`, which resolves `refs/heads/phax/records/v1` and `refs/remotes/<remote>/phax/records/v1`, asks `mergeBase` when both exist, and classifies with `classifyRecordsBranch` from `src/domain/records/branchState.ts`.
- In the same module add `describeRecordWriteBranch(reading, { localPath, remote }): string | null`. It is null unless the state is diverged or unrelated; then it gives a sentence naming the state with `recordsBranchPhrase`, both tips shortened to 7 characters, and the remedy from `recordsBranchRemedy`. For example: `record kept on the local records branch, which is unrelated to origin's (local a41c0de, origin 3f2a9c1); run \`phax records sync --replay\`, then push`.
- In `src/app/recordPlumbing.ts`, `CommitRecordTreeInput` gains a required `remote`. `commitRecordTree` reads the branch with `readRecordsBranch`, takes the parent and expected tip from `recordParentFor`, passes both to `writeTreeCommit`, and returns the reading beside `commitSha`, `branch` and `fileCount`. When `writeTreeCommit` refuses because the branch is no longer at the expected tip, `commitRecordTree` reads the branch again, recomputes the parent and expected tip, and retries, at most three attempts in all; the third refusal fails with the stale-tip `GitError`. Any other error is not retried. `resolveRecordDestination` gains a required `publishRemote` input and returns `{ kind: 'write', repo, remote }`, the remote taken from `recordsBranchLocation`.
- The `written` variant of `RecordWriteResult` gains a required `branchState: RecordsBranchReading` (the reading taken before the write). Thread `publishRemote` and the reading through `writeRecord.ts`, `writeAuthoringRecord.ts`, `writeDecisionRecord.ts` and `writeReviewRecord.ts`, and through their callers: `executePlan.ts`, `authorArtifact.ts`, `decideArtifact.ts`, `decideVerdicts.ts` and `reviewEntry.ts`, which pass `config.publish.remote`.
- `executePlan.ts`: when a phase record is written and `describeRecordWriteBranch` returns a sentence, print it with `output.warn` as `[phax] Warning: phase "<id>" — <sentence>.`. The run goes on. The authoring, decision and review callers add the same sentence to the notes they already print about their record.
- Write `tests/integration/recordsWriteParent.test.ts` against real git (a bare remote and clones), with one named test per criterion: `ac-missing-at-write`, for a dedicated clone and an in-repo repository with a remote-tracking ref and no local branch (the record's parent is the remote tip); `ac-behind-at-write` (the parent is the remote tip, and the old local tip is an ancestor of the new tip); `ac-diverged-write` (the parent is the local tip, and the written result's reading is unrelated with the --replay remedy). Add a small FakeGit test in the same file that the executePlan warning names `unrelated` and `phax records sync --replay`, or put it in the existing executePlan records test if one covers record writes.
- Update the existing writer tests for the new required inputs, without weakening them.

### Planned files to create

- `src/app/recordsBranch.ts`
- `tests/integration/recordsWriteParent.test.ts`

### Planned files to edit

- `src/app/recordPlumbing.ts`
- `src/app/writeRecord.ts`
- `src/app/writeAuthoringRecord.ts`
- `src/app/writeDecisionRecord.ts`
- `src/app/writeReviewRecord.ts`
- `src/app/executePlan.ts`
- `src/app/authorArtifact.ts`
- `src/app/decideArtifact.ts`
- `src/app/decideVerdicts.ts`
- `src/app/reviewEntry.ts`

### Optional files that may be edited

- `tests/integration/writeRecord.test.ts`
- `tests/integration/writeAuthoringRecord.test.ts`
- `tests/integration/writeDecisionRecord.test.ts`
- `tests/integration/writeReviewRecord.test.ts`
- `src/infra/fakes/git.ts`
- `src/cli/commands/runLayers.ts`

### Boundary contracts

app record writers → domain branch state → Git port. A writer needs to know which commit to parent on and which tip it may move from. The domain's `recordParentFor` decides from a reading, and `readRecordsBranch` produces that reading through the port. The callers (run, authoring, decide, review) need the state of the branch they wrote on, and they get it in the written result as a `RecordsBranchReading`.

### Test strategy

- a record written with a remote-tracking ref and no local branch parents on the remote tip, for a dedicated clone and an in-repo repository — medium · example · git rev-parse <record>^ equals the remote tip · in-phase · ac-missing-at-write
- a record written while the local branch is behind parents on the remote tip and keeps the old local tip as an ancestor — medium · example · parent sha and git merge-base --is-ancestor · in-phase · ac-behind-at-write
- a record written on an unrelated branch parents on the local tip, and the run's warning names unrelated and phax records sync --replay — medium · example · parent sha and the warning text · in-phase · ac-diverged-write
- records written in-sync, ahead or with no remote branch keep parenting on the local tip — medium · example · git rev-parse <record>^ equals the previous local tip · in-phase
- a record whose branch moves between the read and the compare-and-swap is rewritten on the new tip, so both writers' records are on the branch; a branch that keeps moving fails after three attempts — small · example · FakeGit refusing the first update, then both commits reachable from the tip; the attempt count · in-phase

### Implementation order

1. recordsBranchLocation, readRecordsBranch and describeRecordWriteBranch
2. commitRecordTree applying recordParentFor
3. resolveRecordDestination and the four writers
4. Callers passing publish.remote and printing the diverged sentence
5. Tests

### Excluded scope

- `phax records sync` changes (phase-05).
- `phax records status` and refused-push messages (phase-06).
- Fetching before a write: a record parents on R as last fetched (spec §7).

### Verification

The configured `standard` gate profile in phax.json.

### Expected handoff content

The exported names and signatures of `src/app/recordsBranch.ts` (recordsBranchLocation, readRecordsBranch, describeRecordWriteBranch). The new required `publishRemote` / `remote` inputs and the `branchState` field of the written result. The exact warning text executePlan prints. Which caller prints what for authoring, decision and review records. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(records): parent each record on the remote tip when the local branch lags`

### Commit body

Every record writer now reads the records branch state before writing. A missing or behind local branch is caught up to the remote tip in the same compare-and-swap that adds the record, for both the dedicated clone and the in-repo destination. A record on a diverged or unrelated branch is kept on the local tip, and the run warns with the state and `phax records sync --replay`.

---

## phase-04 — Acceptance tests for records sync, replay and no forcing {#phase-04-sync-acceptance}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** These tests are frozen once committed and the passing phase cannot adjust them, so a wrong fixture or oracle pauses the run; higher effort for building seven git states correctly and checking each test is red for the stated reason.
**Acceptance phase:** passed by phase-05
**Acceptance test files:** `tests/fixtures/records/branchTipRepos.ts`, `tests/integration/recordsBranchSync.acceptance.test.ts`

Freeze the acceptance tests that `phax records sync` and `--replay` must pass, through their use case and their command, on real git repositories. Add the stubs they compile and load against.

### Detailed instructions

- Create `src/app/recordsBranchSync.ts` with the use case's stable surface, implemented as stubs that throw `new Error('not implemented: syncRecordsBranch')`. `syncRecordsBranch(input: { records: ResolvedRecordsConfig; stateRoot: string; namespace: string; repoRoot: string; publishRemote: string; replay: boolean }): Effect<RecordsBranchSyncResult, GitError | FsError, Git | FileSystem>`. The result type `RecordsBranchSyncResult` has this shape. Done: `{ kind: 'cloned' | 'fetched'; path; remote; branch: RecordsBranchOutcome }`. Refused (the existing origin refusals): `{ kind: 'refused'; reason: 'origin-mismatch' | 'local-only-history'; path; remote; message; remedy }`. Diverged: `{ kind: 'diverged'; reason: 'diverged' | 'unrelated'; path; remote; localTip; remoteTip; localOnly: number; remedy: 'phax records sync --replay' }`. Collision: `{ kind: 'replay-collision'; path; remote; key; localCommit; remoteCommit }`. `RecordsBranchOutcome` is one of `{ kind: 'created'; tip; records: number }`, `{ kind: 'fast-forwarded'; from; to }`, `{ kind: 'replayed'; count; previousTip; newTip; remoteTip }` and `{ kind: 'unchanged'; state: RecordsBranchState; pending: number }`. Export the types, so the passing phase implements them unchanged.
- Create `tests/fixtures/records/branchTipRepos.ts`. It builds, in a temporary directory with git isolated (`tests/helpers/isolateGit.js`), a bare remote holding N records, a dedicated clone at `<stateRoot>/records/<namespace>`, and an in-repo source repository. It has helpers to put the clone in each branch state: no local branch; behind (another clone pushes); ahead; diverged; unrelated (an orphan with K local-only records); and a local-only record whose key already exists on the remote. Records are written as the real writers write them: one commit whose tree holds `<key>/record.json` and the files, through the real `commitRecordTree` or raw plumbing. It also has a helper that runs a callback with GIT_TRACE pointed at a file and returns the traced git command lines.
- Create `tests/integration/recordsBranchSync.acceptance.test.ts`, every test marked `it.fails`, one named test per criterion. `ac-fresh-clone`: no clone, then `syncRecordsBranch` answers cloned with a `created` outcome at origin's tip; two `writeRecord` phase records then descend from it; `pushRecordsBranch` pushes; `readRecordsBranch` is in-sync and `computeRecordsPending` is empty. `ac-behind`: the outcome is `fast-forwarded` from the old tip to the remote tip, the local ref equals the remote tip, and the next record's parent is that tip. `ac-sync-refuse`: an unrelated clone with 3 local-only records, then the result is `diverged` with reason, both full tips, `localOnly: 3` and the --replay remedy, and the local ref is unchanged; repeat for diverged. Also spawn `tsx src/cli/main.ts records sync --json` in the fixture (as `tests/integration/recordsJsonContracts.test.ts` does, with `phaxHomeEnv`): it exits 1, and its error line carries `reason`, `localTip`, `remoteTip`, `localOnly: 3` and `remedy: 'phax records sync --replay'`. `ac-replay`: `replay: true` gives `replayed` with count 3 and previousTip equal to the old L; L descends from R with exactly 3 new commits whose trees and messages equal the 3 originals'; the state is ahead with 3 pending; a plain `git push` fast-forwards. `ac-replay-collision`: the result is `replay-collision` naming the key and both commits, and the local ref is unchanged. `ac-never-forced`: run the fresh-clone, behind, write-time, replay and push scenarios under the GIT_TRACE helper, and assert that no traced git command has `--force`, `--force-with-lease` or a refspec starting with `+`, and that every update of `refs/heads/phax/records/v1` either fast-forwards it (the old tip is an ancestor of the new one) or is the replay. Also run the fresh-clone and behind cases for an in-repo source repository with `publish.remote` as remote.
- Each test must fail on an assertion or on the stub's not-implemented error, never on a missing module, export or type: run the file and check every test is red for that reason before marking it. Fix the fixture seeds and names so every run builds the same repositories.
- Do not implement sync, change `src/cli/definitions/records.ts`, or touch `reconcileRecordsSync`.

### Planned files to create

- `src/app/recordsBranchSync.ts`
- `tests/fixtures/records/branchTipRepos.ts`
- `tests/integration/recordsBranchSync.acceptance.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- `tests/helpers/isolateGit.ts`

### Boundary contracts

acceptance tests → app use case `syncRecordsBranch` (src/app/recordsBranchSync.ts) and the `phax records sync --json` command. The tests need a sync result that says what happened to the local branch (created, fast-forwarded, replayed, unchanged) or why it refused (diverged/unrelated with both tips and the local-only count, or a replay key collision). The use case provides it as the exported `RecordsBranchSyncResult` union; the command provides the §6 normative `--json` error fields.

### Test strategy

- after a fresh sync, two phase records descend from origin's tip, their push fast-forwards, and the branch is in-sync with nothing pending — medium · example · created outcome, git ancestry, push exit 0, readRecordsBranch and computeRecordsPending · acceptance · ac-fresh-clone
- sync fast-forwards a behind branch to the remote tip, names both tips, and the next record parents on it — medium · example · fast-forwarded outcome and ref values · acceptance · ac-behind
- sync without --replay on an unrelated or diverged branch exits 1 with the normative --json fields and leaves the ref unchanged — medium · example · spec §6 normative refusal fields and ref before and after · acceptance · ac-sync-refuse
- replay puts exactly the local-only records on the remote tip with identical trees and messages, then the branch is ahead and pushes as a fast-forward — medium · example · git cat-file trees and messages of originals and replays, push exit 0 · acceptance · ac-replay
- replay refuses a key already on the remote, naming the key and both commits, and moves nothing — medium · example · replay-collision result and ref before and after · acceptance · ac-replay-collision
- no traced git command forces the records branch, and every local branch update fast-forwards or replays — medium · example · GIT_TRACE command lines and git ancestry of each update · acceptance · ac-never-forced

### Implementation order

1. Stub module and exported result types
2. Fixture builders for each branch state and the GIT_TRACE helper
3. One it.fails test per criterion, checked red for the right reason

### Excluded scope

- Implementing sync, replay or the CLI changes (phase-05).
- Status and refused-push messages (phase-06).

### Verification

The configured `standard` gate profile in phax.json, with the acceptance provider judging the marked tests.

### Expected handoff content

The stub module path and its exported types verbatim. The fixture builders and what state each builds. The test names per criterion, and for each test the reason it is red now (an assertion or the not-implemented stub). Any deviation from the planned file lists, with the reason.

### Commit subject

`test(records): acceptance tests for records sync and replay`

### Commit body

Freeze the acceptance tests of phax records sync on real git repositories: creating the missing branch on a fresh clone, fast-forwarding a behind branch, refusing a diverged or unrelated branch with the normative --json fields, replaying stranded records, refusing a key collision, and never forcing the records branch. Each is marked it.fails against the syncRecordsBranch stub.

---

## phase-05 — Records sync creates, fast-forwards, refuses and replays {#phase-05-sync-replay}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium
**Assignment reason:** Replay rewrites local history and one sync now spans two destinations; a slip here loses or duplicates records, so the stronger model designs this new flow.

Implement `syncRecordsBranch` and wire `phax records sync [--replay]` to it, for the dedicated clone and for the in-repo destination against `publish.remote`. The sync then creates the missing local branch, fast-forwards a behind one, refuses a diverged or unrelated one, and on request replays its local-only records onto the remote tip. This passes the acceptance tests of phase-04.

### Detailed instructions

- Implement `src/app/recordsBranchSync.ts` without changing its exported types. Dedicated: run the existing `reconcileRecordsSync` (src/app/recordsSync.ts) and map its refusals unchanged. In-repo: call `git.fetchBranch(repoRoot, publishRemote, phax/records/v1)` and answer `fetched` with path = repoRoot and remote = publishRemote. Then `readRecordsBranch` (src/app/recordsBranch.ts) and act on `recordsSyncActionFor(state, replay)` from `src/domain/records/branchState.ts`.
- create: `updateRef(repo, refs/heads/phax/records/v1, R, null)`, then the outcome `created` with `records` = the length of `listCommitFiles(repo, R, null)`. fast-forward: `updateRef(repo, ref, R, L)`, outcome `fast-forwarded { from: L, to: R }`. none: outcome `unchanged { state, pending }`, where pending is the local-only commit count (`listCommitFiles(repo, L, R)`, or every commit of L when R is null). refuse: the `diverged` result, with the full tips, `localOnly` = the local-only commit count and the --replay remedy, and the ref untouched.
- replay: list the local-only commits with their keys (`listCommitFiles(L, R)` + `recordKeysOf`) and the remote side's (`listCommitFiles(R, null)`). On `findReplayCollision` answer `replay-collision` and touch nothing. Otherwise `recommit` each local-only commit oldest first, onto R, then onto each new commit. Then `updateRef(repo, ref, last, L)` once. Outcome `replayed { count, previousTip: L, newTip, remoteTip: R }`. Never push, never create a merge, never write a named ref for the old tip.
- In `src/cli/definitions/records.ts`, `phax records sync` gains an optional boolean `--replay` flag ('Replay local-only records onto the remote tip when the records branch has diverged'). It calls `syncRecordsBranch` with the repository root and `config.publish.remote`. Its output schema becomes `disabled` or cloned/fetched with a required `branch` outcome. The in-repo `nothing-to-bootstrap` answer is gone from sync; `phax records init` keeps calling `reconcileRecordsSync` and its own output is unchanged.
- Add two error classes. `RecordsBranchDivergedError`, exit 1, has the --json fields `message`, `reason: 'diverged' | 'unrelated'`, `localTip`, `remoteTip`, `localOnly`, `remedy` (§6 normative), with the text `Fetched records into <path>\n✗ records branch is <phrase>: local tip <7>, <remote> tip <7>, <n> local-only record(s)\n  replay them onto <remote>'s tip with \`phax records sync --replay\``. `RecordsReplayCollisionError`, exit 1, has the fields `message`, `key`, `localCommit`, `remoteCommit`, with the text `✗ record <key> exists on both sides (local <7>, <remote> <7>); nothing replayed`. First check how the runner prints an error's text and its glyph, and match the §6 normative lines exactly.
- Render the success lines after the existing `Cloned …` / `Fetched …` line, following §6. created gives `Records branch created at <remote>'s tip <7> (<n> records)`. fast-forwarded gives `Records branch fast-forwarded <7> → <7>`. unchanged-ahead gives `Records branch is ahead of <remote>: <n> record(s) pending`. Other unchanged states give `Records branch is <phrase>`. replayed gives `Replayed <n> record(s) onto <remote>'s tip <7> → new tip <7> (previous tip <7>)`, then `Push them with the next record, or \`git -C <path> push <remote> phax/records/v1\``.
- Remove the `it.fails` markers from `tests/integration/recordsBranchSync.acceptance.test.ts`. That is the only change allowed to that file and to `tests/fixtures/records/branchTipRepos.ts`.
- Write in-phase tests in `tests/integration/recordsBranchSyncUnits.test.ts` for what the acceptance tests do not cover: `--replay` on an in-sync branch replays nothing; the in-repo destination with no records branch on `publish.remote` answers no-remote-branch without error; and the source repository's working tree, index and HEAD are unchanged after an in-repo sync. Update `tests/integration/recordsSync.test.ts` and `tests/integration/recordsJsonContracts.test.ts` only where they assert the old in-repo `nothing to sync` output of sync, or the old sync output shape.
- Regenerate the usage spec and CLI reference with `pnpm gen:usage-spec`, so `phax.usage.kdl` and `docs/cli/reference.md` carry `--replay` and the new shapes.

### Planned files to create

- `tests/integration/recordsBranchSyncUnits.test.ts`

### Planned files to edit

- `src/app/recordsBranchSync.ts`
- `src/cli/definitions/records.ts`
- `tests/integration/recordsBranchSync.acceptance.test.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`

### Optional files that may be edited

- `src/app/recordsSync.ts`
- `src/app/recordsBranch.ts`
- `tests/integration/recordsSync.test.ts`
- `tests/integration/recordsJsonContracts.test.ts`
- `tests/unit/recordsUsage.test.ts`

### Boundary contracts

cli `phax records sync` → app `syncRecordsBranch` → domain `recordsSyncActionFor` / `findReplayCollision` → Git port. The command needs one answer saying what happened to the local branch or why it refused, and renders it. The use case gives the `RecordsBranchSyncResult` union frozen in phase-04. The `--json` refusal fields follow §6 exactly: reason, localTip, remoteTip, localOnly, remedy.

### Test strategy

- --replay on a branch that is not diverged replays nothing and reports the state — medium · example · unchanged outcome and ref before and after · in-phase
- in-repo sync fetches only the records branch from publish.remote and leaves the source repository's working tree, index and HEAD untouched — medium · example · git status, HEAD and index before and after · in-phase
- in-repo sync against a publish.remote with no records branch answers no-remote-branch without error — medium · example · unchanged outcome with state no-remote-branch · in-phase

### Implementation order

1. syncRecordsBranch for create, fast-forward, unchanged and refuse
2. Replay with the collision check
3. In-repo fetch path
4. CLI flag, output schema, errors and rendering
5. Remove the acceptance markers, add in-phase tests, regenerate the usage spec

### Excluded scope

- `phax records status` branch field, pending count and refused-push messages (phase-06).
- Pushing from sync (spec §7).
- Keeping the previous tip under a named ref (settled in Technical arbitrations).

### Verification

The configured `standard` gate profile in phax.json, with the acceptance provider judging the phase-04 tests.

### Expected handoff content

The final `phax records sync` output schema and the two new error classes with their exit codes and --json fields. The exact text lines. Confirm the acceptance tests pass with markers removed and nothing else changed in them. Whether `pnpm gen:usage-spec` changed both generated files. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(records): sync creates, fast-forwards and replays the records branch`

### Commit body

phax records sync now brings the local records branch level with the remote, for the dedicated clone and for the in-repo destination against publish.remote. It creates the missing branch at the remote tip and fast-forwards a behind one. It refuses a diverged or unrelated one with both tips, the local-only count and the remedy. With --replay it recommits each local-only record onto the remote tip with the same tree and message, after checking that no key exists on both sides. Every ref move is a compare-and-swap, and nothing is pushed or forced.

---

## phase-06 — Status reports the branch state and refused pushes name the fix {#phase-06-status-and-push}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

`phax records status` reports the branch state with both tips and its remedy, and counts as pending only local-only records. A refused records push, in publish, run, authoring, decision and review, names the branch state and the `phax records sync` command that fixes it, instead of a plain `git push`.

### Detailed instructions

- In `src/app/recordsStatus.ts`, `computeRecordsPending` uses `recordsBranchLocation` and `readRecordsBranch` from `src/app/recordsBranch.ts`. It replaces the first-parent walk (and MAX_PENDING_WALK) with `listCommitFiles(localPath, L, R)`, or every commit of L when R is missing, and keeps today's grouping of each commit's blob paths into `{ runId, phaseId }`, deduplicated. `RecordsPendingStatus` gains a required `branch: RecordsBranchReading`; it is in-sync with null tips when records are off or L is missing and R too. `pendingCountsByRunId` and `groupPendingByRun` keep their signatures.
- In `src/cli/definitions/records.ts` `phax records status`, the output gains a required `branch: { state: <the seven literals>, localTip: string | null, remoteTip: string | null }` between `remote` and `pending` (§6 normative), with full shas. The text adds, after the destination line, `Records branch: <phrase> (local <7|none>, <remote> <7|none>)`, followed by ` — run \`<remedy>\`` when `recordsBranchRemedy` gives one.
- In `src/app/recordsSync.ts` `pushRecordsBranch`, the `failed` variant gains a required `branch: RecordsBranchReading | null`. After a failed push, call `git.fetchBranch` for the records branch on the push remote, ignoring its failure, then `readRecordsBranch`; the value is null only when that read fails. Never fetch before a push.
- Add `describeRecordsPushFailure(result: failed variant, subject: string): string` to `src/app/recordsBranch.ts`. When the branch state is behind, diverged or unrelated it gives `<subject> push to <remote> refused: the records branch is <phrase> (local <7>, <remote> <7>) — records remain pending; run \`<remedy>\`, then push.`. Otherwise it gives git's message with today's wording and today's `git -C <path> push <remote> phax/records/v1` remedy.
- Use it at every push-failure site: `src/app/publishRun.ts` (subject `Records`, which covers publish and run), `src/app/authorArtifact.ts`, `src/app/writeDecisionRecord.ts` and `src/app/writeReviewRecord.ts` (subjects `authoring record`, `decision record` and `review entry`). Drop the old plain `git push` remedy for the branch-disagreement states. Check `src/app/decideArtifact.ts`, `src/app/decideVerdicts.ts` and `src/app/reviewEntry.ts`, which call the push, and update them only if they format the failure themselves.
- Write `tests/integration/recordsStatusBranch.test.ts` on real git: `ac-status-states` builds a clone in each of the seven states (reusing `tests/fixtures/records/branchTipRepos.ts` read-only), runs `computeRecordsPending` and the status command's --json, and checks `branch.state`, the full or null tips, and the remedy text for behind, diverged, unrelated and no-local-branch. `ac-status-pending` builds a diverged clone sharing 300 records with the remote plus 2 local-only, and checks that pending is 2. `ac-push-message`: another clone pushes after the last fetch, a record is written and the push refused, and the failure text from `pushRecordsBranch` + `describeRecordsPushFailure`, and from publishRun's log line, names the state and `phax records sync` or `--replay` and holds no `git -C … push`.
- Update the existing status, push and writer tests (`tests/integration/recordsPush.test.ts`, `tests/integration/publishRun.test.ts`, the writer tests) for the new required fields and texts, without weakening them. Regenerate with `pnpm gen:usage-spec` if the status shape appears in the generated files.

### Planned files to create

- `tests/integration/recordsStatusBranch.test.ts`

### Planned files to edit

- `src/app/recordsStatus.ts`
- `src/app/recordsSync.ts`
- `src/app/recordsBranch.ts`
- `src/cli/definitions/records.ts`
- `src/app/publishRun.ts`
- `src/app/authorArtifact.ts`
- `src/app/writeDecisionRecord.ts`
- `src/app/writeReviewRecord.ts`

### Optional files that may be edited

- `src/app/decideArtifact.ts`
- `src/app/decideVerdicts.ts`
- `src/app/reviewEntry.ts`
- `tests/integration/recordsPush.test.ts`
- `tests/integration/publishRun.test.ts`
- `tests/integration/writeAuthoringRecord.test.ts`
- `tests/integration/writeDecisionRecord.test.ts`
- `tests/integration/writeReviewRecord.test.ts`
- `tests/integration/recordsJsonContracts.test.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`

### Boundary contracts

cli `phax records status` → app `computeRecordsPending` → Git port: the command needs the branch reading and the local-only records, and renders §6's normative `branch` object. The push sites need one failure sentence, and they get it from app `describeRecordsPushFailure` given the `failed` push result, which now carries the branch reading taken after a refusal.

### Test strategy

- status --json reports each of the seven states with full or null tips, and the text names the remedy for behind, diverged, unrelated and no-local-branch — medium · table · one clone per state against the §4 states and §6 normative branch object · in-phase · ac-status-states
- a diverged clone sharing 300 records with the remote and holding 2 local-only records reports pending 2 — medium · example · pending equals 2 · in-phase · ac-status-pending
- a push refused because another writer pushed names the branch state and phax records sync or --replay, and suggests no plain git push — medium · example · failure text of each push site · in-phase · ac-push-message
- a push that fails for another reason keeps git's message and today's git push remedy — medium · example · failure text against an unreachable remote · in-phase

### Implementation order

1. computeRecordsPending with the branch reading and the range listing
2. status output schema and text
3. pushRecordsBranch's post-refusal fetch and branch reading
4. describeRecordsPushFailure and the push sites
5. Tests and existing test updates

### Excluded scope

- Retrying a refused push (spec §7).
- Fetching before a write or before a push.
- Docs (phase-07).

### Verification

The configured `standard` gate profile in phax.json.

### Expected handoff content

The final `phax records status --json` shape. The status text lines per state. The refused-push sentence per site. Confirm no site still suggests `git push` for behind, diverged or unrelated. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(records): status shows the branch state and refused pushes name the fix`

### Commit body

phax records status reports the records branch state with both tips and its remedy, and counts as pending only the records the remote does not hold, whatever the state. A refused records push fetches the records branch and, when the branch is behind, diverged or unrelated, names that state and phax records sync or phax records sync --replay instead of a plain git push. This holds in publish, run, authoring, decision and review.

---

## phase-07 — Docs for the records branch and its remote {#phase-07-docs}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

Document what an operator does when the records branch and its remote disagree. The guide gets the section §11 asks for, and the 0.35.0 upgrade notes name the changed records commands and JSON shapes.

### Detailed instructions

- In `README.md` under `## Records` (the source of the site page guide/records), add a subsection `### When the records branch and its remote disagree`. Explain the seven branch states in one short list. Explain that a record lands on the remote tip as phax last fetched it. Say what `phax records sync` does in each state and what `--replay` does and keeps (same tree and message; the previous tip is printed). Say that phax never forces the records branch. Then give §11's worked example: `phax records status` shows `Records branch: unrelated to origin (local a41c0de, origin 3f2a9c1)`, the operator runs `phax records sync --replay`, sees `Replayed 3 record(s) onto origin's tip`, and the next push succeeds. Use the exact output lines phase-05 and phase-06 implemented; read `src/cli/definitions/records.ts` for them.
- In `docs/upgrading.md`, add a `### 0.35.0` section above `### 0.34.0`, written the way the 0.34.0 entries are. It covers these points. `phax records sync` now creates, fast-forwards or refuses the local records branch, gains `--replay`, and works for the in-repo destination (it fetches the records branch from `publish.remote` and no longer says `nothing to sync`); its --json answer gains a required `branch` outcome and two new refusals with their fields. `phax records status --json` gains a required `branch` object. Pending now counts only local-only records. A refused records push names the branch state and the sync command. Record format, manifests and versions are unchanged; no migration is needed.
- Keep the words phax's own: name no project. Do not change generated files by hand.

### Planned files to create

- (none)

### Planned files to edit

- `README.md`
- `docs/upgrading.md`

### Optional files that may be edited

- `site/pages.ts`

### Test strategy

- (none)

### Implementation order

1. README Records subsection with the worked example
2. docs/upgrading.md 0.35.0 entry

### Excluded scope

- Any code change.
- Regenerating the CLI reference (done in phase-05 and phase-06).

### Verification

The configured `standard` gate profile in phax.json (its terminal `pnpm site:build` step builds the guide page).

### Expected handoff content

The headings added and the output lines quoted, confirmed against the implemented text. Any deviation from the planned file lists, with the reason.

### Commit subject

`docs(records): explain a records branch that disagrees with its remote`

### Commit body

Add the guide section on the records branch states, phax records sync and --replay, with the worked example of an unrelated branch brought home. Add the 0.35.0 upgrade notes for the changed records sync and status answers and the refused-push messages.
