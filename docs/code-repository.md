# Process and code in two repositories

Keep a project's specs, plans, briefs and their approvals in a private **process repository**, and its code in a public **code repository**, and phax still judges every plan against the code. This page is for the maintainer who wants that split.

## The layout

Check out the code repository inside the process repository, and keep it out of the process repository's history:

```text
billing/                  the process repository
├── .gitignore            contains /code/
├── phax.json
├── docs/
│   ├── specs/
│   └── plans/
└── code/                 the code repository, its own .git
    └── src/
```

```text
# .gitignore of the process repository
/code/
```

The process repository holds specs, plans, briefs and their approvals. The code repository holds the code, its pull requests and its records.

## Declaring the link

Declare the link in the process repository's `phax.json`:

```json
{
  "code": { "root": "code" }
}
```

`code` is accepted in `phax.json` only. A `phax.local.json` or `~/.phax/config.json` that carries it is refused, naming the file. `root` is a relative path inside the repository, written with `/` and without `.`, `..`, empty segments or a leading or trailing `/`. It is never the repository root itself.

`phax validate` checks the link and exits 2 with the reason when it fails:

```text
$ phax validate
✗ phax.json code.root "code": does not exist
✗ phax.json code.root "code": not the top level of a git repository
✗ phax.json code.root "code": not ignored by this repository — add /code/ to .gitignore
```

A project that declares no link behaves as before.

## Approving a plan

`phax artifact approve` records the code repository's HEAD as the plan's **code baseline**, in the approval record and in the plan's frontmatter. The record, `docs/plans/approvals/<plan>.json`, gains a required `code` key after `baseline`:

```json
{
  "baseline": "bae802b24aed73802ec8d9292ed61df045b9c747",
  "code": { "root": "code", "baseline": "9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d" }
}
```

The frontmatter stamp shows the short commit beside the baseline:

```yaml
approved:
  date: 2026-11-20
  baseline: bae802b
  code: 9c8d7e6
```

A project with no link records `"code": null` and writes no `approved.code`. The record's `root` is informational: verdicts use the link's root. Only the code repository's committed HEAD is recorded, not uncommitted changes in the checkout.

Records written by an earlier release are read as `code: null` and never rewritten.

## Staleness against the code

With a link, **ground** is judged in the code repository: `ground-changed` lists the plan's footprint files that changed in `code/` since the code baseline. Changes elsewhere in the code do not count. `self-changed` and `spec-changed` are judged in the process repository, as before.

```text
$ phax plans status
=== Plan Staleness Report ===

docs/plans/2611201030-billing-export-plan.md: STALE
  ground-changed: src/export/csv.ts changed in code/ since baseline 9c8d7e6f5a4b…
docs/plans/2611190915-ledger-plan.md: STALE
  missing-record: the recorded code baseline 1a2b3c4… no longer exists in code/ — re-approve with "phax artifact approve docs/plans/2611190915-ledger-plan.md"
```

`phax plans status --json` gives a linked plan's `ground-changed` evidence a `codeRoot` key beside `baseline` and `files`, which are then the code baseline and paths relative to the code root.

Three cases give `missing-record`, and the remedy of each is to re-approve the plan:

- `approved without a code baseline — the project now links code/`: the plan was approved before the link was declared, or its record says `code: null`.
- `the approval recorded code baseline <sha> but the project declares no code link`: the link was removed after the approval.
- `the recorded code baseline <sha> no longer exists in code/`: the code history was rewritten or the checkout replaced.

Declaring a link therefore makes every plan approved before it `missing-record`. Re-approve them once.

If the link itself is broken, `phax plans status` reports the reason as an error for each approved plan and exits 0.

## Running from the code repository

Run the plan from the code repository, pointing at the plan in the process repository:

```bash
cd code
phax run --plan ../docs/plans/2611201030-billing-export-plan.md
```

phax finds the process repository from the plan's path: the plan's own git top level, whose `phax.json` must declare a `code` root that is exactly the repository you ran in. The plan must sit where plans live (`docs/plans/`). The run is then gated as the process repository's artifact: it refuses a plan that is not approved, or is stale against the code, with the same wording as `phax plans status`:

```text
phax run refused: docs/plans/2611201030-billing-export-plan.md is stale
  ground-changed: src/export/csv.ts changed in code/ since baseline 9c8d7e6f5a4b…
```

From the process repository's config phax reads `code` only. None of its commands, gates or providers is applied: the run uses the code repository's configuration. A process `phax.json` that declares `code` but does not decode, or a link to this repository that the process repository does not ignore, refuses with exit 2.

When the plan's repository declares no `code`, or its link names another repository, the run is loose, exactly as without this feature, with no warning.

At review, phax completes nothing. It prints the command to run in the process repository once the pull request is merged:

```text
The plan lives in the process repository: once merged, run there
  phax artifact complete docs/plans/2611201030-billing-export-plan.md
```

`phax resume` derives the link again from the recorded plan path.

## What the code repository receives

- **The pull request names neither plan nor spec.** Its footer keeps the phax line, the agents and the run, and omits **Plan** and **Spec**. If the link cannot be read at publish, the footer omits them too.
- **Commits name nothing outside the code repository.** Their trailers carry no plan or spec path of the process repository.
- **Records are as before.** They stay on `phax/records/v1` of the code repository.

## plans lint

`phax plans lint` run in the process repository checks the files a plan creates and edits against `code/`, not against the process repository:

```text
$ phax plans lint docs/plans/2611201030-billing-export-plan.md
✓ files  every planned path checked against code/
```

A broken link refuses with exit 2 rather than reporting a finding.

## Limits

- The code root is inside the process repository. A sibling checkout is not supported, and neither are submodules or subtrees.
- phax moves no files between the two repositories.
- `phax run` runs in the repository you invoke it in. Completing the plan stays a manual step in the process repository.
- The same code checked out elsewhere (a second clone, or a worktree outside the process repository) runs loose, without the gate.
- A process repository that moved or changed its link between a run's start and its publish is judged as it stands at publish.
- Spec approvals carry no code baseline: a spec has no footprint.
