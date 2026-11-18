# Review findings: ids and fates

A run in `review_open` can carry two reviews: the compliance review against the plan and the headless code review. Each lists findings. This page is for the operator who reads those findings and wants to refer to one, and to see them all in one place. The example run is `gate-retry`.

## Finding ids

phax gives every finding an id when it persists a review:

- `F<n>` for a code-review finding: `F1`, `F2`, …
- `C<n>` for a compliance finding, numbered across the phases in document order: `C1`, `C2`, …

The review session never writes an id. Its answer is a `code-review-answer` or `compliance-review-answer` document, which has no `id` key and refuses one. phax reads the answer, gives each finding its id, and writes `code-review.json` or `compliance-review.json`, whose findings carry it.

The numbering continues across the reviews of the same run. `gate-retry` is reviewed once and its code review has three findings, `F1` to `F3`. After a re-review of two findings, they are `F4` and `F5`, and `F1` to `F3` are still listed. An id is never reused for another finding.

## Fates

A finding's fate says what became of it:

| Fate         | Meaning                                                                          |
| ------------ | -------------------------------------------------------------------------------- |
| `open`       | Nothing has been done about it yet.                                              |
| `fixed`      | A commit fixed it.                                                               |
| `dismissed`  | You decided it is not a problem.                                                 |
| `deferred`   | You decided to leave it for later.                                               |
| `unrecorded` | Its review was persisted before ids existed, so no record can name it. See below. |

In this release a finding is `open`, or `unrecorded` when its review was persisted before ids existed. Fixing, dismissing and deferring come with `phax finding fix`, `dismiss` and `defer`, which a later release adds.

## Older reviews

A review persisted before ids existed has no `id` in its file. phax gives its findings ids by position when it reads them, oldest review first, and marks them `unrecorded`. The numbers continue after the highest id given by the run's earlier reviews: two older code reviews of three and two findings are `F1` to `F3` and `F4` to `F5`, and a new review continues at `F6`.

Stored files are never rewritten. A lifted id depends on the set and order of the run's reviews, so do not delete a review record by hand: it would shift them.

## Listing a run's findings

```bash
phax finding list gate-retry
```

```text
gate-retry (review_open) — 5 findings: 3 open, 2 unrecorded

F1  bug        open        src/app/retry.ts:41  The retry count is never reset after a pass
F2  concern    open        src/app/retry.ts:77  The backoff has no upper bound
F3  info       open        docs/retry.md:9      The page still names the old flag
C1  deviation  unrecorded  phase-02 files       src/gate.ts was edited and not planned
C2  concern    unrecorded  phase-03 tests       No test covers the exhausted case
```

One row per finding: id, severity, fate, location and message. A code-review finding's location is `<file>:<line>`; a compliance finding's is its phase and dimension. Findings are ordered `F` before `C`, each by number. The command takes a short name in the current project, or `<namespace>.<short-name>`.

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
      "fate": "open",
      "history": []
    }
  ]
}
```

`records` is `read`, `off` or `unavailable`, so a reader knows whether earlier reviews could be read. `history` is the finding's fate records, oldest first; it is empty in this release. See [Machine answers](json-output.md) for `--json` in general.

The command reads local files and git only.

## Where findings come from

A run's reviews of one kind are read from two places:

- the run's records on the `phax/records/v1` branch, oldest first: every earlier review, so a re-review drops no finding;
- then the review file in the run folder, as the newest, when it differs from the newest record. That is the case when its record write failed, or when records were off.

With records off, only the run folder is read: a replaced review's findings are no longer listed, and `phax finding list` says so on stderr. When the records branch cannot be read, it reads the run folder alone, says why on stderr, and the document says `"records": "unavailable"`. A review being persisted is never refused for it.

An archived run is read from its archive folder, with the records of its project when they can be read. A run the registry no longer knows cannot be listed.

A review document `phax finding list` cannot read (a damaged file, or one stamped by a newer phax) is refused with exit 1, naming it. Persisting a new review continues the numbering after the readable ones, with a warning.
