Write the phax spec `finding-fix-identity`: a fixed finding stays bound to the commit that fixed it after that
commit's history is rewritten (a rebase of the run's branch, an amend, GitHub's Rebase and merge, a squash), so a
project may merge its pull requests the way it chooses and phax's fates still hold.

## Why

A fixed finding's fate record on `phax/records/v1` holds the fix commit by its sha, and nothing else names the
commit. A sha does not survive a rewrite: rebasing a commit gives it a new parent, so a new sha, and GitHub's Rebase
and merge recreates every commit even when a fast-forward was possible. After such a merge the recorded sha is on no
branch of the project:

- **`phax finding list`** shows a fixed finding's commit that is not in the base branch's history, and nothing says
  which commit of the base branch carries the fix.
- **`phax finding post`** writes that sha into the pull request's comment, a link that leads nowhere once the
  branch is gone.
- **`phax finding fix --commit <sha>`** refuses a commit that is not on the run's final branch or the base branch,
  so the operator cannot re-record the fix under the sha it now has without knowing to look for it.

On 2026-11-21 the operator met the same break outside phax (a formatting commit listed by sha in
`.git-blame-ignore-revs`, rewritten by Rebase and merge) and concluded that every project phax manages must merge
with a merge commit. That is a constraint phax would put on its users, and a weak one: a branch rebased onto its
base during review, an amend after a review note, or one collaborator's habit rewrites the sha before any merge.

The identity is already half there. The commit `phax finding fix` makes carries `Short-Name: <short-name>` and one
`Finding: <id>` per finding in its last paragraph, and a trailer survives a rebase, a Rebase and merge and an amend
(and a squash when the repository keeps the commit messages in the squashed one, GitHub's `COMMIT_MESSAGES`).
`phax records explain` already resolves a phase commit through its trailers, not its sha. What is missing is phax
reading them for a fate.

## What

- **A key that survives.** The fix commit's trailers name the fate unambiguously: the short name is reused once a
  run is pruned, so the spec decides what makes the key unique (a run id or a finding key in a trailer, which the
  `fixCommitBody` note "never a `Run-Id`" currently rules out for release notes' sake).
- **Resolution on read.** Where phax reads a fixed fate (`finding list`, `finding post`, and any other
  reader), the recorded sha comes first; when it is not reachable from the base branch, phax looks there for
  the commit carrying the fate's key, and falls back to the diff's content (`git patch-id --stable`) for a commit
  that carries no trailer, such as one recorded with `--commit`. The answer says which way the commit was found,
  and says so plainly when none was.
- **Recorded once found.** Whether a resolution writes a new fate record with the new sha (so the next read is
  direct and the history shows the rewrite) or stays a read-time lookup is the spec's call.
- **Comments that keep pointing.** `finding post` names what still resolves after the merge (the key, and the sha as
  it stands), and a fixed finding of a merged pull request can be posted once its commit is found on the base branch.
- **`--commit` after a rewrite.** Recording an existing commit accepts one found by the fate's key or its patch id on
  the base branch, so re-recording after a merge needs no sha hunting.

## Questions the spec must settle

- **The unique key.** Run id, a new trailer per fate, or the short name plus the finding id plus a check on the run's
  dates; and how release notes keep folding a commit into its run.
- **Squash.** A squash that keeps the commit messages keeps the trailers but merges several commits into one: one
  base commit then fixes findings that several fix commits fixed. Whether that is one fate per finding still pointing
  at the same commit, and what phax says when the repository squashes with the pull request's description only (the
  trailers are gone and the patch id matches nothing).
- **Ambiguity.** Two base commits carrying the same key (a cherry-pick, a revert then a re-apply): pick the latest,
  list both, or refuse.
- **Cost.** Searching the base branch's history on every read: bound the search (since the run's base commit), cache
  the answer, or write it back as a record.
- **Phase commits.** Whether anything else phax records by sha (held review commits, approvals' baselines) has the
  same break, and whether this spec covers it or names it as a follow-up.

## Out of scope

Choosing a merge policy for the project, enforcing one on GitHub (repository settings, rulesets), rewriting history
on the operator's behalf, and changing what `dismiss` and `defer` record.
