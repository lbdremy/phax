Write the phax spec `run-start-and-base`: `phax run` takes, as options, the commit a run starts from and the branch
its pull request targets, records both with the run, and prints them. A run stacked on a branch other than the default
one then needs no edit of the configuration and no switch of the main checkout.

## Why

A run has two bases, and today neither is said on the command line.

- **Where it starts is implicit.** The run's branch is created from whatever branch the main checkout has checked
  out when `phax run` is called. No option names it, and neither `phax run --help` nor the dry run prints it.
- **What its pull request targets is configuration only.** `publish.baseBranch`, else the remote's default branch.
  The two are unrelated: a run started from a branch that is not the default one still opens its pull request
  against the default one, holding that branch's commits beside its own, and nothing says so.

On 2026-11-20 a change had to land in two steps: a preparatory branch, whose pull request fails its checks by design,
then the run that makes them pass. The default branch was to receive nothing until the checks passed, so the run had
to start from the preparatory branch. It took:

- **Moving the main checkout.** The preparatory branch lived in a worktree of its own. A branch cannot be checked out
  twice, so the worktree was removed and the main checkout switched to the branch, for the whole length of the run.
- **Reading the source to know what would happen.** Whether the run would start from the checked-out branch, and
  where its pull request would point, is written nowhere the operator reads.
- **A configuration edit, for the stacked shape.** To have the run's pull request target the preparatory branch, the
  operator writes `publish.baseBranch`: in `phax.json`, a tracked file, so a commit to make and another to undo it; or
  in `phax.local.json`, a file to write and then delete. Either way the setting must stay until the review ends, since
  `phax finding fix` reads the base branch from the configuration at the time it is called, and a second run started
  meanwhile from the default branch would inherit it.

## What

- **`--from <ref>`** (indicative): the run's branch starts at this branch or commit. The main checkout is not switched
  and may hold another branch. Absent, the run starts from the checked-out branch, as today.
- **`--base <branch>`** (indicative): the run's pull request targets this branch. Absent, `publish.baseBranch`, else
  the remote's default branch, as today.
- **Recorded with the run.** Both are written in the run's record at start. `phax resume`, `phax publish-pr`, the
  review commands and `phax finding fix|post` read them from the run, never from the configuration of the day, so a
  run keeps its base when the configuration changes and two runs with different bases can be open at once.
- **Printed.** The dry run and the run's first lines print where the run starts (branch and commit) and what its pull
  request targets. When the start is not contained in the target, the dry run says how many commits the pull request
  will carry that are not the run's.
- **After the merge.** When a stacked run's pull request merges into its base, nothing more is owed by phax: the base
  branch's own pull request is the operator's.

## Questions the spec must settle

- **One option or two.** `--from` and `--base` apart, or one option meaning both (start there and target it), with
  the other shape left to the configuration.
- **Which configuration governs.** With `--from`, the `phax.json`, gate profile and protected paths of the main
  checkout, or those at the starting commit. They differ as soon as the starting branch changed one of them.
- **The plan's freshness.** A plan is approved against the code at a baseline. Whether freshness is judged against
  the starting commit when `--from` names one, and what the refusal names.
- **A start that is not pushed.** Whether phax refuses to open a pull request against a base the remote does not
  have, or pushes it.
- **The diff the review reads.** A review of a stacked run should read the run's change only. Say whether it is taken
  from the starting commit or from the target branch, and that the two agree when the run is stacked.
- **A base that moves.** What `phax resume` and the publish step do when the starting branch gained commits after the
  run began.

## Out of scope

Rebasing or merging a run onto a moved base, opening or merging the base branch's own pull request, and runs that
target several branches.
