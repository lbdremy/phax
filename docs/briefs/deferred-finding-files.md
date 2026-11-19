Write the phax spec `deferred-finding-files`: `phax finding defer` writes the deferred finding as a file of its own,
in a directory the project names, and commits it where the run's change lives. A deferral then needs no file prepared
by hand, and a project whose process and code sit in two repositories can defer at all.

## Why

`phax finding defer` records a finding as deferred to a tracked file the operator names with `--to`. On 2026-11-19, on
the first run reviewed under 0.40.0 in a project with a code link, deferring one finding took three refusals:

- **The process repository's tracker is refused.** The run lives in the code repository, and `--to` must be a file
  tracked there. `../docs/NEXT_STEPS.md`, the file where that project tracks what comes next, is "not a tracked file".
- **A file added for the purpose is refused until the merge.** The operator wrote a file on the run's branch to defer
  to. `phax finding defer` is not available inside a phase worktree, and from the main checkout the file is not
  tracked at HEAD, because it exists only on the run's branch. The fate can be recorded only after the pull request
  merges, so the pull request is reviewed and merged with the finding still shown open.
- **The file is written by hand.** phax holds the finding as data and the operator retypes it as prose, in a shape no
  schema names and nothing checks.

What the operator did in the end is the shape worth making first-class: one file per deferred finding, named by a
stamp and a slug, holding the finding as JSON, deleted by the commit that settles it.

## What

- **A directory, declared.** The project names where deferred findings live (indicative: `findings.deferred` in
  `phax.json`, default `docs/findings-deferred/`). In a linked project the code repository's configuration decides,
  since the finding is about its code and is settled by a change there.
- **`defer` writes the file.** `phax finding defer <run> F8 --why …` with no `--to` writes
  `<dir>/<YYYYMMDDHHMM>-<slug>.json` on the run's final branch, commits it, and records the fate with that path. The
  slug is given (`--slug`) or derived from the finding. While the run is open for review the commit joins the pull
  request, as a `fix` does, so the description shows the finding deferred before the merge. `--to` keeps working as
  today for a project that tracks deferrals elsewhere.
- **A format with a schema.** The file starts with `$schema` and holds what a later reader needs to act: severity,
  file, message, suggestion, why it was deferred, and what settles it. Whether it also names the run and the finding
  id is a question (below): a public code repository may not want its process named in its tree.
- **Settled by deletion.** The commit that settles the finding deletes its file. `phax finding list` can then tell a
  deferral still standing from one whose file is gone, and a later `fix --commit` on that finding closes the loop in
  the records.
- **Seen again.** Deferred findings still standing are the natural input of the next plan's authoring and of
  `phax review-plan`: the spec says which commands list them.

## Questions the spec must settle

- **Run identity in the file.** Carry the run and finding id (traceable, but it writes the process's names into the
  code repository), or leave them to the fate record, which already binds the id to the path.
- **After review.** Deferring a finding of a merged or archived run has no run branch to commit to: commit on the
  base branch, open a pull request, or refuse and keep `--to`.
- **The process repository as a target.** Whether a linked project may defer to its process repository instead, and
  what the pull request's comment then names.
- **Lines.** A line number goes stale at the next edit; keep it as recorded, or leave it out.
- **Staleness.** What phax says of a deferred finding whose `file` no longer exists.

## Out of scope

Deciding fates for the operator, any tracker outside the repository, and changing what `fix` and `dismiss` do.
