Write the phax spec `approval-baseline-identity`: an approved plan's staleness stays computable after the commit
its approval recorded as baseline is rewritten (a rebase, an amend, GitHub's Rebase and merge, a squash), in the
project's repository and in a linked code repository alike.

The follow-up that spec `finding-fix-identity` names in its non-goals (decided `q-phase-commits` → follow-up,
2026-11-22): that spec makes a fixed finding's commit survive a rewrite, and leaves the other shas phax records to
this one. Phase commits already resolve through their trailers; approval baselines do not.

## Why

`phax artifact approve` records, in the artifact's record file, the commit the approval was taken on (`baseline`,
and `code.baseline` in the code repository when the project links one). `phax plans status` judges an Approved
plan's staleness from the files changed since that baseline (`src/app/planStaleness.ts`,
`computeStaleness` in `src/domain/artifact/lineage.ts`).

A baseline is held by sha and by nothing else, so a rewrite breaks it in two ways:

- **Gone.** On a clone that never had the old commit, or once it is garbage-collected, `commitExists` is false and
  the verdict is `missing-record` ("the recorded approval baseline … no longer exists"). The plan's real staleness
  is no longer computed at all: a plan the code has moved under reads the same as one nothing touched.
- **Orphaned, still present.** Before garbage collection the old commit is still in the local object store, so
  `commitExists` is true while the commit is on no branch. The files changed "since the baseline" are then measured
  from a commit outside the history, and the verdict can be wrong without saying so. The brief's author has not
  verified which way phax computes the change set here; the spec must.

Today this rarely bites the project phax is built in, where specs and plans are approved on `main` directly. It
bites a team that approves plans on branches merged through pull requests, and most of all the **code baseline** of a
linked project: the code repository is where pull requests land, and where Rebase and merge or squash is the
common policy.

## What

- **A baseline that can be found again.** Something beside the sha that survives a rewrite and points at the same
  point of the history: the approval commit itself (it carries the record file, so its trailers or its content can
  be found on the base branch), the base branch's commit at or before the approval's date, or the merge-base of the
  approval commit with the base branch.
- **Resolution on read**, in the order `finding-fix-identity` settled for fates: the recorded sha first when it is
  reachable from the base branch, then the fallback; never write on read.
- **A verdict that says how it was measured.** `plans status` names the baseline it measured from and how it was
  found, and an orphaned sha is reported as such rather than measured from.
- **The code baseline too**, in the code repository, with the same rules.

## Questions the spec must settle

- **The fallback anchor.** The approval commit found by its record file, the base branch's commit by date, or the
  merge-base; what each gives after a squash, where the approval commit itself is folded into another.
- **Reachable, not present.** Whether every baseline read checks reachability from the base branch instead of
  existence, and what `plans status` says of a present but unreachable baseline.
- **The code repository's base branch.** Which branch of the code repository a code baseline is resolved against,
  and whether a linked project's approval needs anything recorded that it does not record today.
- **Existing records.** Whether approvals recorded before this spec resolve through the fallback as they are, or need
  re-approval.
- **The frontmatter stamp.** `approved.baseline` in the artifact's frontmatter holds the short sha; whether it keeps
  it, and what a reader of the Markdown is told when it no longer resolves.

## Out of scope

Fixed findings (spec `finding-fix-identity`), phase commits (already resolved through trailers), choosing or
enforcing a merge policy, and changing when a plan is judged stale once the baseline is found.
