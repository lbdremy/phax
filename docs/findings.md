# Review findings: ids and fates

A run in `review_open` can carry two reviews: the compliance review against the plan and the headless code review. Each lists findings. This page is for the operator who reads those findings and wants to refer to one, and to see them all in one place. The example run is `gate-retry`.

## Finding ids

phax gives every finding an id when it persists a review:

- `F<n>` for a code-review finding: `F1`, `F2`, …
- `C<n>` for a compliance finding, numbered across the phases in document order: `C1`, `C2`, …

The review session never writes an id. Its answer is a `code-review-answer` or `compliance-review-answer` document, which has no `id` key and refuses one. phax reads the answer, gives each finding its id, and writes `code-review.json` or `compliance-review.json`, whose findings carry it.

The numbering continues across the reviews of the same run. `gate-retry` is reviewed once and its code review has three findings, `F1` to `F3`. After a re-review of two findings, they are `F4` and `F5`, and `F1` to `F3` are still listed.

A new review is numbered after the highest id of every review phax can read for the run, so an id is not given twice, with two exceptions:

- With records off, or records unavailable, phax sees only the run folder. A review with no findings then resets the count: the next review starts again at `F1` (or `C1`).
- A recorded review phax cannot read, such as one stamped by a newer phax, is not counted. The next review is numbered after the readable ones and can give again an id that review holds.

## Fates

A finding's fate says what became of it:

| Fate         | Meaning                                                                          |
| ------------ | -------------------------------------------------------------------------------- |
| `open`       | Nothing has been done about it yet.                                              |
| `fixed`      | A commit fixed it.                                                               |
| `dismissed`  | You decided it is not a problem.                                                 |
| `deferred`   | You decided to leave it for later.                                               |
| `unrecorded` | Its review was persisted before ids existed, so no record can name it. See below. |

A finding is `open` until a command sets its fate: `phax finding fix`, `dismiss` or `defer`. Each writes a [fate record](#fate-records). The latest record decides the fate, and every record stays in the finding's `history`, so a dismissal you change your mind about is superseded by a later fix. A finding is `unrecorded` when its review was persisted before ids existed; a fate command can still settle it.

## Older reviews

A review persisted before ids existed has no `id` in its file. phax gives its findings ids by position when it reads them, oldest review first, and marks them `unrecorded`. The numbers continue after the highest id given by the run's earlier reviews: two older code reviews of three and two findings are `F1` to `F3` and `F4` to `F5`, and a new review continues at `F6`.

Stored files are never rewritten. A lifted id depends on the set and order of the run's reviews, so do not delete a review record by hand: it would shift them.

## Listing a run's findings

```bash
phax finding list gate-retry
```

```text
gate-retry (review_open) — 5 findings: 2 open, 1 fixed, 1 dismissed, 1 deferred

F1  bug        fixed      src/app/retry.ts:41  The retry count is never reset after a pass
               8c1d2e4 (code, tests)
F2  concern    open       src/app/retry.ts:77  The backoff has no upper bound
F3  info       dismissed  docs/retry.md:9      The page still names the old flag
               Ada Lovelace: the page names it on purpose
F4  concern    deferred   src/gate.ts:12       The gate reads the config twice
               → NEXT_STEPS.md
C1  deviation  open       phase-02 files       src/gate.ts was edited and not planned
```

One row per finding: id, severity, fate, location and message. A fixed finding adds a line per fix (commit and path classes), a dismissed one its operator and reason, a deferred one its pointer. A code-review finding's location is `<file>:<line>`; a compliance finding's is its phase and dimension. Findings are ordered `F` before `C`, each by number. The command takes a short name in the current project, or `<namespace>.<short-name>`.

With `--json` it prints a `finding-list` document, shortened here to one finding:

```json
{
  "$schema": "https://docs.phax.run/schemas/finding-list/0.40.0.json",
  "run": { "namespace": "acme", "shortName": "gate-retry", "runId": "…", "state": "review_open" },
  "records": "read",
  "findings": [
    {
      "id": "F1",
      "source": "code-review",
      "severity": "bug",
      "file": "src/app/retry.ts",
      "line": 41,
      "message": "The retry count is never reset after a pass",
      "lens": "core",
      "escape": "omission",
      "criterion": "…",
      "suggestion": "…",
      "fate": "fixed",
      "history": [
        {
          "fate": "fixed",
          "commit": "8c1d2e4…",
          "pathClasses": ["code", "tests"],
          "by": { "kind": "operator", "name": "Ada Lovelace" },
          "at": "2026-11-18T10:00:00.000Z"
        }
      ]
    }
  ]
}
```

`records` is `read`, `off` or `unavailable`, so a reader knows whether earlier reviews could be read. `history` is the finding's fate records, oldest first; it is empty for an open finding. See [Machine answers](json-output.md) for `--json` in general.

The command reads local files and git only.

## Fixing a finding

Change the files, then name the finding and the paths:

```bash
phax finding fix gate-retry F2 -- tests/gate.test.ts
```

```text
✓ committed 3fa91c2 fix(review): F2 of gate-retry
  paths: tests/gate.test.ts (tests)
✓ recorded F2 fixed on phax/records/v1
```

- It works only while the run is `review_open`, and commits in the run's final worktree.
- It commits exactly the named paths. Other staged or unstaged changes stay where they are. A named directory commits every change under it. A path with no change is refused.
- Paths resolve as git does: from the current directory when it is inside the worktree, else from the worktree's root. A path that leaves the worktree is refused.
- The ids come first (`F2 F5`); every operand from the first one not spelled like an id is a path. `--` is the documented spelling, with flags before it. A path spelled like an id must follow another path or be written `./F2`.
- The subject is `fix(review): F2, F5 of gate-retry`. `-m, --message <subject>` replaces it and `--body <text>` adds a paragraph.
- The last paragraph holds phax's trailers: `Short-Name: gate-retry`, then one `Finding: <id>` per id, in the order named. There is no `Run-Id`, so release notes fold the commit into its run by `Short-Name`.
- `--by operator`, or no `--by` from a terminal, names the operator as git commits. `--by machine:<grant>` records a machine. Without a terminal and without `--by` the call is refused.

The record keeps the set of path classes of the commit, from the paths git reports it changed against its first parent (a rename counts as both its paths). The first rule that matches a path decides:

| Class         | A path is in it when                                                                                                                                  |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gate-config` | it is under `.github/workflows/`, or its name is a gate tool's config: `phax.json`, `knip.json`, `tsconfig.json`, `vitest.config.*`, `.oxlintrc.json`, `eslint.config.*`, `biome.json`, … |
| `tests`       | a directory is `test`, `tests`, `__tests__`, `__snapshots__` or `e2e`, or its name matches `*.test.*`, `*.spec.*`, `*_test.*` or `test_*.py`          |
| `docs`        | it starts with `docs/`, or ends in `.md`, `.mdx`, `.markdown`, `.rst`, `.adoc` or `.txt`                                                              |
| `code`        | anything else, `package.json` and lockfiles included                                                                                                  |

`tests/gate.test.ts` is `tests`, `docs/retry.md` is `docs`, `src/app/retry.ts` is `code`, and `tests/phax.json` is `gate-config`, because the first rule wins. The list of gate configs is fixed, not read from your project: a gate tool missing from it classes its config as `code`.

## Recording an earlier commit

```bash
phax finding fix gate-retry F3 --commit 9f8e7d6 --by operator
```

`--commit <sha>` records a commit that exists and makes none, so it takes no path, `-m` or `--body`. Use it for a finding fixed before ids existed (an `unrecorded` finding), and as the retry that a failed record prints. The commit must be, or be an ancestor of, the run's final-phase branch while the run is live, or the base branch: `publish.baseBranch`, else `main`, local or remote-tracking. A commit that changes no path is refused. A backfilled commit has no `Finding:` trailer and may hold several fixes, so its classes are coarser.

Because it writes only a record, `--commit` runs on any run whose records exist, an archived or merged run included. On a merged or closed pull request it then pushes and posts nothing (see [Which pull request](#which-pull-request)).

## Dismissing and deferring

```bash
phax finding dismiss gate-retry F3 --why "the helper is internal, no caller can reach it"
phax finding defer gate-retry F4 --to NEXT_STEPS.md --why "needs its own plan"
```

```text
✓ recorded F3 dismissed on phax/records/v1 (by Ada Lovelace)
✓ recorded F4 deferred → NEXT_STEPS.md on phax/records/v1
```

- Only an operator dismisses or defers: `--by machine:<grant>` is refused (`only an operator dismisses a finding`). `--by operator` is the default from a terminal and required without one.
- `--by operator` is a declaration the caller makes, not a check: a program without a terminal that passes it dismisses or defers as the committer git config names. phax refuses it only inside its own phase sessions, where every fate command is refused.
- `--why` is required and not empty. `--to` names a file tracked at HEAD (`<to> is not a tracked file` otherwise), read from the current directory and recorded relative to the repository root.
- Several ids in one call write one record each, in the order named.
- Both run on any run whose records exist, archived runs and `unrecorded` findings included.
- A dismissal is a decided verdict: it chooses `dismiss`, abandons `fix` and `defer`, and gives the finding's suggestion (or its message, for a compliance finding) as the case for fixing.

## Fate records

A fate is one record per finding on the `phax/records/v1` branch, keyed `<runId>/finding/<id>/<NN>/record.json`. `NN` is one more than the highest the branch holds for that finding. Each record is one commit, so a call naming several ids writes several commits. Its format is `finding-fate-record-manifest`, with a fixed, a dismissed or a deferred entry. `phax records list` does not show it; `phax finding list` is its reader.

Records must be on. Before any commit or record, a fate command refuses when:

- there is no `records` key in `phax.json`;
- the run's project cannot be read (a run of another project, for instance);
- a dedicated records clone is missing (run `phax records sync`).

A fate command never pushes `phax/records/v1`, whatever `records.autoPush` says. A fate's record reaches the remote with `phax records sync` or the run's next publish, so a pull request comment can name a fate the remote does not hold yet. What a fate command does push and post on the pull request is described in [On the pull request](#on-the-pull-request). If a record fails after a fix commit landed, the commit stays, the command exits 1 and names the ids not recorded and the `--commit` retry. A failed dismissal or deferral is recorded by running the same command again. A call whose records failed pushes and posts nothing.

`phax finding post <run> <id>…` posts the comments of findings already settled. It writes no record, so it never records a fate twice:

```bash
phax finding post gate-retry F2 F3
```

```text
✓ pushed phax/gate-retry--phase-03 to origin
✓ commented F2 on https://github.com/acme/shop/pull/42
✓ commented F3 on https://github.com/acme/shop/pull/42
```

It refuses an unknown id, a finding that is `open` or `unrecorded`, a run with no pull request in `publication.json`, and a `fixed` finding when the pull request is merged or closed: it then pushes and posts nothing, not even the other findings named. Name only the dismissed and deferred ones to post theirs. It ignores `publish.auto`, because it is an explicit request to post.

## On the pull request

### The description

When phax creates the run's pull request, its description gains a `## Review findings` section, right after `## Needs your review`. It reads the findings as `phax finding list` reads them at that moment: every open and deferred finding is named, the fixed and dismissed ones are counted.

```text
## Review findings

Open (2)
- F2 concern — `src/app/retry.ts:77` — The backoff has no upper bound
- C1 deviation — phase-02 files — src/gate.ts was edited and not planned

Deferred (1)
- F4 concern — `src/gate.ts:12` — The gate reads the config twice → `NEXT_STEPS.md`

Fixed: 1 · Dismissed: 1
```

- ` · Unrecorded: n` ends the count line when n is above 0. A block with no finding is left out, and a run with no finding reads `No findings.`.
- When the records branch cannot be read, one line says so and every finding shows as open. When the findings cannot be read at all, one line says why and points to `phax finding list <run>`. Reading findings never fails a publish.
- When the description is too long for GitHub, phax cuts unexplained deviations first, then attention points, deferred findings, open findings and last the review notes. A cut list keeps its header with the full total and its first entries, then `- …and <k> more open findings`. The count line is never cut.
- The description is written once. A pull request that already exists keeps its body, and later fates never rewrite it.

### Fate comments

With `publish.auto` on and a pull request named in the run's `publication.json`, `phax finding fix` pushes the run branch to `publish.remote` (plainly, never forced), then `fix`, `dismiss` and `defer` post one comment per finding they settle:

```bash
phax finding fix gate-retry F2 -- tests/gate.test.ts
```

```text
✓ committed 3fa91c2 fix(review): F2 of gate-retry
  paths: tests/gate.test.ts (tests)
✓ recorded F2 fixed on phax/records/v1
✓ pushed phax/gate-retry--phase-03 to origin
✓ commented F2 on https://github.com/acme/shop/pull/42
```

Each comment's first line is `<id> <fate> — <location> — <message>`; the second depends on the fate:

```text
F2 fixed — `src/app/retry.ts:77` — The backoff has no upper bound
Fixed by 3fa91c2 on main (tests) · gate-retry-1 F2
```

```text
F3 dismissed — `docs/retry.md:9` — The page still names the old flag
Reason: the page names it on purpose
```

```text
F4 deferred — `src/gate.ts:12` — The gate reads the config twice
Taken over by `NEXT_STEPS.md`
```

`@` mentions in a message or reason are rendered as code. A call naming several ids posts several comments.

### Which pull request

The pull request is the one `publication.json` in the run's folder names (its archive copy for an archived run): the one `phax publish-pr` opened, or the one it found already open on the run branch and recorded. phax asks GitHub nothing to find it. A pull request opened by hand with `gh pr create` gets fate comments once `phax publish-pr` has found and recorded it, but its description never gets the Review findings section. Apart from a fix on a merged or closed pull request (below), a pull request is skipped only when `publication.json` does not name it.

A run stays `review_open` until it is archived, even after its pull request was merged on GitHub. So before a fixed finding reaches the pull request, `fix` and `phax finding post` ask GitHub its state (`gh pr view <url> --json state`):

- Open: `fix` pushes and comments as above.
- Merged or closed: `fix` pushes nothing and posts nothing, because its commit is not in the base branch and the push would bring a deleted branch back. The commit and the fates stay, and the command exits 0 and says so (below). `phax finding post` refuses a fixed finding on a closed pull request. On a merged one it pushes nothing, and posts only when every named fix is found on the base branch; otherwise it refuses, naming the `phax finding fix <run> <id> --commit <sha>` retry.
- A state that cannot be read fails like a push or a comment (see below): nothing is pushed or posted.

```text
✓ committed 3fa91c2 fix(review): F2 of gate-retry
  paths: tests/gate.test.ts (tests)
✓ recorded F2 fixed on phax/records/v1
○ the pull request is merged: nothing pushed or commented
```

`dismiss` and `defer` never ask: their comments claim nothing about the code, so a merged or closed pull request still gets them.

### When nothing leaves the machine

- With `publish.auto` off, the fate commands push and post nothing and work offline.
- With no pull request yet, nothing is pushed or posted. The description carries the fates when the pull request is created.
- With `publish.pushBranch` false, `fix` neither pushes nor posts, because its commit could not be seen. `dismiss` and `defer` still comment.
- On a merged or closed pull request, `fix` neither pushes nor posts.
- `dismiss` and `defer` never push. An archived run's `fix --commit` pushes nothing.

The `--json` answers of `fix`, `dismiss` and `defer` carry a `pullRequest` field: `{ "kind": "not-posted", "reason": "publish-auto-off" | "no-pull-request" | "push-branch-off" | "pull-request-merged" | "pull-request-closed" }`, or `{ "kind": "posted", "url", "pushed", "comments" }`. Only `fix` answers `pull-request-merged` or `pull-request-closed`.

### When a push or a comment fails

This covers a pull request state that cannot be read too. The fates stay recorded and a fix's commit stays. The command exits 1 with `✗ pull request not updated: …`, naming the pull request, git's or gh's first line and the ids not posted, and ends with `Retry with: phax finding post <run> <ids>`. Run it: it posts what is left without recording again. When the remote branch has moved, git refuses the push; run `git pull --no-rebase <remote> <branch>` in the run's final worktree first, then retry.

Exit 1 now covers both a fate not recorded and a pull request not updated; under `--json` only the error tag tells them apart. Do not rerun the fate command on a pull request failure, or it records a second, identical fate.

`phax finding list` never calls GitHub, and findings never block completion, publication or merge.

## Exit codes

| Code | Meaning                                                                                                     |
| ---- | ----------------------------------------------------------------------------------------------------------- |
| 0    | The fates are recorded, and the pull request updated when that applies.                                     |
| 1    | A refusal, a git or file failure, a fate not recorded, or a pull request not updated.                       |
| 2    | A configuration that does not decode.                                                                       |
| 64   | A refused call: no `--why` or `--to`, an empty value, an undeclared option, or no `--by` without a terminal. |

## Where findings come from

A run's reviews of one kind are read from two places:

- the run's records on the `phax/records/v1` branch, oldest first: every earlier review, so a re-review drops no finding;
- then the unrecorded reviews kept in the run folder, `code-review.unrecorded-<NN>.json` and `compliance-review.unrecorded-<NN>.json`, oldest first. When a review's record write failed, the next review keeps its file under that name before replacing it, so its findings stay listed;
- then the review file in the run folder, as the newest, when it differs from the newest record. That is the case when its record write failed, or when records were off.

With records off, only the run folder is read and nothing is kept: a replaced review's findings are no longer listed, and `phax finding list` says so on stderr. When the records branch cannot be read (a missing records clone, a git failure, or a run of another project whose records cannot be located), it reads the run folder alone, says why on stderr, and the document says `"records": "unavailable"`. A review being persisted is never refused for it.

An archived run is read from its archive folder, with the records of its project when they can be read. When the archive folder is gone, only the records are listed, and a note on stderr says so. A run the registry no longer knows cannot be listed.

A review document `phax finding list` cannot read (a damaged file, or one stamped by a newer phax) is refused with exit 1, naming it. Persisting a new review continues the numbering after the readable ones, with a warning.

A fate record phax cannot read refuses the whole run the same way: `phax finding list`, `fix`, `dismiss` and `defer` all exit 1, for every finding of the run. The refusal names the record's path on `phax/records/v1` and its records commit. When a later phax wrote it, upgrade phax.
