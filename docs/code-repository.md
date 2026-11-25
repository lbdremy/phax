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

The process repository holds specs, plans, briefs and their approvals. The code repository holds the code and its pull requests. Where run records go is up to the code repository's configuration: see [Records](#records).

If you added `code/` to the process repository before ignoring it (`git add code` records it as an embedded repository), untrack it with `git rm -r --cached code`. An ignore rule alone does not untrack it, and phax refuses a code root the process repository still tracks.

## Declaring the link

Declare the link in the process repository's `phax.json`:

```json
{
  "code": { "root": "code" }
}
```

`code` is accepted in `phax.json` only. A `phax.local.json` or `~/.phax/config.json` that carries it is refused, naming the file. `root` is a relative path inside the repository, written with `/` and without `.`, `..`, empty segments or a leading or trailing `/`. It is never the repository root itself. It is resolved against the repository's root.

The `phax.json` that declares the link is the one phax reads for every command: the nearest `phax.json` walking up from the directory you run the command in to the repository's root. A refusal names that file.

`phax validate` checks the link and exits 2 with the reason when it fails. Each run below prints one of these refusals on stderr:

```text
$ phax validate
Config validation failed: code.root "code": does not exist
  at: /home/ada/billing/phax.json
$ phax validate
Config validation failed: code.root "code": not the top level of a git repository
  at: /home/ada/billing/phax.json
$ phax validate
Config validation failed: code.root "code": not ignored by this repository — add /code/ to .gitignore
  at: /home/ada/billing/phax.json
$ phax validate
Config validation failed: code.root "code": tracked by this repository although ignored — untrack it with git rm -r --cached code
  at: /home/ada/billing/phax.json
$ phax validate
Config validation failed: "code" is accepted only in phax.json
  at: /home/ada/billing/phax.local.json
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

Only a plan approval reads the configuration, and only the `code` key of that `phax.json`: no overlay, and none of its other keys, so an unrelated configuration problem does not block an approval. A spec approval reads no configuration at all. A plan approval refuses with exit 2, writing nothing, when the `phax.json` is not a JSON object, when its `code` key does not decode, or when the link fails the checks `phax validate` makes.

A project with no link records `"code": null` and writes no `approved.code`. The record's `root` is informational: verdicts use the link's root. Only the code repository's committed HEAD is recorded, not uncommitted changes in the checkout.

Records written by an earlier release are read as `code: null` and never rewritten.

## Staleness against the code

With a link, **ground** is judged in the code repository: `ground-changed` lists the plan's footprint files that changed in `code/` since the code baseline. Changes elsewhere in the code do not count. `self-changed` and `spec-changed` are judged in the process repository, as before.

```text
$ phax plans status
=== Plan Staleness Report ===

docs/plans/2611190915-ledger-plan.md: STALE
  missing-record: the recorded code baseline 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b no longer exists in code/ — re-approve with "phax artifact approve docs/plans/2611190915-ledger-plan.md"
docs/plans/2611201030-billing-export-plan.md: STALE
  ground-changed: src/export/csv.ts changed in code/ since baseline 9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d
```

`phax plans status --json` gives a linked plan's `ground-changed` evidence a `codeRoot` key beside `baseline` and `files`, which are then the code baseline and paths relative to the code root.

Three cases give `missing-record`, and the remedy of each is to re-approve the plan:

- `approved without a code baseline — the project now links code/`: the plan was approved before the link was declared, or its record says `code: null`.
- `the approval recorded code baseline <sha> but the project declares no code link`: the link was removed after the approval.
- `the recorded code baseline <sha> no longer exists in code/`: the code history was rewritten or the checkout replaced.

Declaring a link therefore makes every plan approved before it `missing-record`. Re-approve them once.

If the link itself is broken, `phax plans status` reports the reason as an error for each approved plan and exits 0:

```text
$ phax plans status
=== Plan Staleness Report ===

docs/plans/2611201030-billing-export-plan.md: ERROR — code.root "code": not ignored by this repository — add /code/ to .gitignore
```

## Running from the code repository

Run the plan from the code repository, pointing at the plan in the process repository:

```bash
cd code
phax run --plan ../docs/plans/2611201030-billing-export-plan.md
```

phax finds the process repository from the plan's path: the plan's own git top level. The plan must sit where plans live (`docs/plans/`). phax reads the nearest `phax.json` walking up from the plan's directory to that top level, and of it only the `code` key. None of the process repository's commands, gates or providers is applied: the run uses the code repository's configuration. When that `code.root` is exactly the repository you ran in, the run is gated as the process repository's artifact. It refuses a plan that is not approved, has no approval record, or is stale against the code, with exit 12 and the refusal a plan living with its code gets. A stale plan's refusal carries the evidence `phax plans status` gives:

```text
$ phax run --plan ../docs/plans/2611201030-billing-export-plan.md
docs/plans/2611201030-billing-export-plan.md is stale (ground-changed: src/export/csv.ts changed in code/ since baseline 9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d) — re-approve with "phax artifact approve docs/plans/2611201030-billing-export-plan.md"
```

The run is loose, exactly as without this feature and with no warning, when:

- the plan is not under `docs/plans/` of its own repository;
- that repository has no `phax.json`;
- its `phax.json` has no `code` key, whatever else the file holds, even keys that would not decode;
- its `code.root` resolves to another repository than the one you ran in, or to nothing, whatever else the file holds.

The run refuses with exit 2, before anything is named, in two cases:

- phax cannot tell whether the plan is linked: the `phax.json` is not JSON, is not a JSON object, or has a `code` key with no `root` string. The refusal says so:

  ```text
  phax run refused: Cannot tell whether docs/plans/2611201030-billing-export-plan.md is linked to this repository: "/home/ada/billing/phax.json" is not valid JSON (Expected property name or '}' in JSON at position 2 (line 1 column 3))
  ```

- the link names the repository you ran in but cannot be used: its `code` key does not decode, its root is not written canonically, or it fails a check of `phax validate` (the root is not exactly that repository's top level, or the process repository does not ignore it or still tracks it).

At review, phax completes nothing. It prints the command to run in the process repository once the pull request is merged:

```text
The plan lives in the process repository: once merged, run there
  phax artifact complete docs/plans/2611201030-billing-export-plan.md
```

`phax resume` derives the link again from the recorded plan path.

## What the code repository receives

- **The pull request names neither plan nor spec.** Its footer keeps the phax line, the agents and the run, and omits **Plan** and **Spec**. If the link cannot be read at publish, the footer omits them too.
- **Commits name nothing outside the code repository.** Their trailers carry no plan or spec path of the process repository.
- **Records, if the code repository's configuration sends them there.** They carry plan text: see below.

## Records

Records are written as for any run, by the code repository's `records` configuration, and the link changes nothing about them. Without a `records` key, no record is written. With `"destination": { "kind": "in-repo" }`, each phase's record is committed on the `phax/records/v1` branch of the code repository itself, and with `"autoPush": true` that branch is pushed to the code repository's remote.

A phase's record carries the files of its phase folder. Among them is `prompt.md`, the prompt phax gave the agent: it holds the plan's preamble and the phase's full text, with the source spec's path. It also carries the phase handoff, the diff and the gate reports. With `"transcript": true` it carries the agent session's transcript and the gate, setup and agent error logs too; the transcript's first turn is that same prompt. With `"transcript": false` it carries none of those logs, whatever the record's shape. phax refuses to write transcripts to an in-repo destination of a repository it sees is public, but it writes a record with `"transcript": false` there whatever the visibility, and that record still carries `prompt.md`.

So to keep the process private, send the records to the process repository: in the code repository's `phax.json`, set the destination to the process repository's remote:

```json
{
  "records": {
    "transcript": false,
    "destination": { "kind": "repo", "remote": "git@github.com:acme/billing-process.git" },
    "autoPush": true
  }
}
```

The `remote` must be an `https://`, `ssh://` or `git@host:path` URL. The records are then committed in a local clone of that remote, on its `phax/records/v1` branch, and pushed to it when `autoPush` is true. The code repository receives none of them.

## plans lint

`phax plans lint` run in the process repository checks the files a plan creates and edits against `code/`, not against the process repository. A plan whose files all exist in `code/` reports nothing for them:

```text
$ phax plans lint docs/plans/2611201030-billing-export-plan.md
docs/plans/2611201030-billing-export-plan.md: no findings
```

A planned file missing from `code/` is an error, found in the code repository's tree:

```text
$ phax plans lint docs/plans/2611201030-billing-export-plan.md
docs/plans/2611201030-billing-export-plan.md: 1 error, 0 warnings
error    files        phase-01  edit src/export/pdf.ts: does not exist and no earlier phase creates it
```

A broken link refuses with exit 2 rather than reporting a finding.

## Limits

- The code root is inside the process repository. A sibling checkout is not supported, and neither are submodules or subtrees.
- phax moves no files between the two repositories.
- `phax run` runs in the repository you invoke it in. Completing the plan stays a manual step in the process repository.
- The same code checked out elsewhere (a second clone, or a worktree outside the process repository) runs loose, without the gate.
- A process repository that moved or changed its link between a run's start and its publish is judged as it stands at publish.
- Spec approvals carry no code baseline: a spec has no footprint.
