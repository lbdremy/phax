---
status: Draft
date: 2026-11-17
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---
# Code repository: a plan's process in one repository, its code in another

## 1. Context

Some projects keep their code in a public repository and their process (specs, plans, briefs and their approvals) in a private one. The process repository holds the code repository checked out inside it, at a directory its own .gitignore lists (`code/`, say). phax 0.27 already handles this layout with no changes. Headless authoring runs in the process repository and reads the code under `code/`. `phax artifact approve` and `complete` commit in the process repository. `phax run --plan ../docs/plans/<plan>.md`, run from the code repository, runs the plan as a loose plan: the gates pass and the run reaches review. With `records.destination` `{ "kind": "repo", "remote": <process URL> }` in the code repository's phax.json, the records go to the process repository's remote.

phax judges an Approved plan stale on three kinds of evidence, computed in two places today: `phax run`'s preflight, for plans under docs/plans/ only, and `phax plans status`, which flips stale plans to Stale under `--apply`. `phax resume` and `phax artifact status` do not compute staleness. self-changed compares the plan's fingerprint with the one recorded at approval. spec-changed does the same for its source spec. ground-changed lists the files of the plan's footprint that changed since the approval's baseline, a commit of the plan's own repository. When the baseline commit no longer exists, or the plan has no record, the verdict is missing-record.

The approval record file today:

    {
      "$schema": "https://docs.phax.run/schemas/plan-approval-record/0.25.0.json",
      "artifact": "docs/plans/2611171555-finding-ids-and-fates-plan.md",
      "planFingerprint": "73307e42…",
      "approvedAt": "2026-11-17T16:15:50.352Z",
      "baseline": "bae802b24aed73802ec8d9292ed61df045b9c747",
      "sourceSpec": { "path": "docs/specs/…", "fingerprint": "ddef903b…" },
      "approvedBy": { "kind": "operator", "name": "…" }
    }

A run completes its plan (and a last plan's spec) by committing their archival on the run's branch, so the completion merges with the code. The pull request footer names the plan and the spec. Phase commits carry Run-Id, Short-Name, Phase-Id, Phase-Title, Model, Effort and Gate-Log. Gate-Log is relative to the run folder, and no trailer names a local worktree path.

Ground read:

- `docs/briefs/code-repository.md` — The brief: the two-repository layout, what the phax 0.27 trial measured, and the three losses (ground staleness, completion, pull request contents).
- `src/app/planStaleness.ts` — computeStalenessForPlan reads the approval record, checks the baseline exists, then diffs changedFilesSince(record.baseline, repoRoot) in a single repository: the plan's own.
- `src/domain/artifact/lineage.ts` — computeStaleness: the three evidence kinds (spec-changed, ground-changed, self-changed) and missing-record when there is no record or the baseline commit is gone; ground is the changed files that are in the plan's footprint.
- `src/cli/definitions/run.ts` — The run's staleness gate runs only when the plan's path relative to the run's repository classifies as an artifact (docs/plans/...); a ../docs/plans/ path is loose and skips it.
- `src/cli/definitions/plansStatus.ts` — phax plans status reports every Approved plan's verdict and --apply flips stale ones to Stale; its --json evidence for ground-changed is { reason, baseline, files }.
- `src/domain/artifact/render.ts` — Text rendering of the staleness report: 'ground-changed: <files> changed since baseline <sha>' and 'missing-record: <detail> — re-approve with ...'.
- `src/schemas/approvalRecord.ts` — The plan approval record file: $schema, artifact, planFingerprint, approvedAt, baseline (40-hex), sourceSpec, approvedBy; unknown keys rejected.
- `docs/plans/approvals/2611171555-finding-ids-and-fates-plan.json` — A real plan approval record at plan-approval-record 0.25.0.
- `docs/plans/2611171555-finding-ids-and-fates-plan.md` — The frontmatter approved stamp as phax writes it today: approved: { date, baseline: <short sha> }.
- `src/app/completeRunArtifacts.ts` — A plan whose run path does not classify as an artifact is loose: nothing is completed at the run's end.
- `src/app/publishRun.ts` — The pull request footer names the plan run-status.json recorded (a loose ../docs/plans/ path is named as is, in a code span) and the spec its plan copy declares.
- `src/domain/publish/prFooter.ts` — renderPrFooter: '**Plan** <ref> · **Spec** <ref>', then Agents, then Run.
- `src/app/commit.ts` — Phase commit trailers today: Run-Id, Short-Name, Phase-Id, Phase-Title, Model, Effort, Gate-Log; Gate-Log is relative to the run folder or none, and no trailer is a Worktree path.
- `src/app/lintPlan.ts` — plans lint's files check probes each planned path against config.repoRoot, the repository lint runs in.
- `src/domain/config/mergeLayers.ts` — Three config layers: project phax.json, then ~/.phax/config.json, then phax.local.json.

## 2. Problem

In the two-repository layout a plan loses the guarantee that matters most: that it is still true of the code it was planned against. ground-changed diffs the plan's footprint in the plan's own repository, and the code is not there. A plan approved on code that has changed since therefore runs as if it were fresh. Run from the code repository, the plan is loose, so the run's staleness gate is skipped altogether, along with the checks that it is approved and recorded. phax plans status in the process repository reports the same plan as fresh, and plans lint checks the plan's files against the process repository's tree, where none of them exist.

Two smaller losses follow from the plan being loose. Nothing tells the operator that the plan and its spec must be completed by hand after the merge. The code repository's pull request also names the plan by its process path (`../docs/plans/<plan>.md`), which in a public repository points to a private one that readers cannot open.

## 3. Product goal

A project declares, once, that its code lives in a code repository checked out inside its process repository. phax then gives every plan of that project the guarantees a plan has when it lives with its code. Its approval records the code commit it was planned against. Its staleness is judged against the code that changed since then, wherever phax judges staleness. A run from the code repository treats the plan as the process repository's artifact. The code repository's pull request and commits name nothing of the process repository. A project without the link behaves exactly as before. The one change it sees is that its new plan approval records carry an explicit `"code": null` under the newer plan-approval-record version.

> A plan's ground is the code it reads, in whichever repository that code lives.

## 4. Terminology

- **process repository** — The git repository that holds a project's specs, plans and briefs and their approval records, and whose project phax.json declares the code link.
- **code repository** — The git repository that holds a project's code, tests and samples, checked out inside the process repository's tree at the code root and ignored by it.
- **code root** — The directory, relative to the process repository's root, at which the code repository's working tree is checked out (e.g. `code`). Plan file paths and footprint paths of a linked project are relative to it.
- **code link** — The declaration in the process repository's project phax.json that names the code root. A project is linked when it declares one.
- **code baseline** — The code repository's HEAD commit at the moment a plan of a linked project was approved, recorded beside the approval's process baseline.
- **linked run** — A `phax run` started in a code repository on a plan that lives under docs/plans/ of a process repository whose code link names that code repository.
- **footprint** — The set of files a plan says it reads, creates or modifies, as phax already derives it for staleness and overlap; the files ground-changed is judged on.

## 5. Functional requirements

### 5.1 Declaring the code link

WHERE the process repository's project phax.json declares `code.root` THE system SHALL treat the directory it names, resolved against the process repository's root, as the project's code root.

### 5.2 Where the link may be declared

IF `code` is declared in phax.local.json or ~/.phax/config.json, or `code.root` is absolute or resolves outside the process repository's tree, THEN the system SHALL reject the configuration, naming the offending file and field.

### 5.3 A code root that is not a repository

IF the code root does not exist or is not the top level of a git repository THEN `phax validate` and every command that uses the code link SHALL fail, naming the code root and the reason.

### 5.4 A code root the process repository tracks

IF the code root is not ignored by the process repository THEN `phax validate` and every command that uses the code link SHALL fail, naming the code root and telling the operator to ignore it.

### 5.5 The approval records the code baseline

WHEN `phax artifact approve` approves a plan of a linked project THE system SHALL record the code root and the code repository's HEAD commit as the code baseline, both in the required `code` key of the plan's approval record file and in its frontmatter approved stamp.

### 5.6 An unlinked approval records no code

WHERE the process repository declares no code link THE system SHALL write a plan's approval record file with `"code": null` under the newer plan-approval-record version, and the frontmatter stamp with no code key, as it writes the stamp today.

### 5.7 Older approval records are read, never rewritten

WHEN the system reads a plan approval record file stamped with an older plan-approval-record version THE system SHALL read it as carrying `"code": null`, without rewriting or migrating the file.

### 5.8 Ground is judged in the code repository

WHEN the system computes the staleness of a plan of a linked project THE system SHALL report ground-changed for the files of the plan's footprint, relative to the code root, that changed in the code repository since the recorded code baseline, and for no file of the process repository.

### 5.9 self-changed and spec-changed are unchanged

The system shall judge self-changed and spec-changed for a plan of a linked project as it does today, against the plan and spec in the process repository.

### 5.10 A code baseline that no longer exists

IF a plan's recorded code baseline no longer exists in the code repository THEN the system SHALL give the plan the missing-record verdict, naming the code baseline and the code root.

### 5.11 An approval without a code baseline in a linked project

IF the approval record of a linked project's plan carries `"code": null`, written so or read so from an older version, THEN the system SHALL give the plan the missing-record verdict, saying it was approved without a code baseline.

### 5.12 A code baseline without a link

IF a plan's approval record carries a non-null code baseline while the process repository declares no code link THEN the system SHALL give the plan the missing-record verdict, saying the project declares no code link.

### 5.13 A linked run gates the plan as an artifact

WHEN `phax run` in a code repository is given a plan under docs/plans/ of a process repository whose code link names that code repository THE system SHALL refuse the run unless the plan is Approved, has an approval record and is fresh, as it does for a plan that lives with its code.

### 5.14 A linked run leaves completion to the process repository

WHEN a linked run reaches review THE system SHALL leave the plan and its spec unchanged in the process repository and print the `phax artifact complete` command to run in the process repository once the code is merged.

### 5.15 The pull request names nothing of the process repository

WHEN the system publishes a linked run THE system SHALL open a pull request whose body names neither the plan nor its spec, by path, slug or link.

### 5.16 Commits name nothing of the process repository

The system shall write a linked run's commits with the same trailers as any run's, none of which names a path outside the code repository.

### 5.17 plans lint checks files against the code

WHERE the process repository declares a code link THE system SHALL check, in `phax plans lint`, each planned file against the code root's working tree.

### 5.18 No behavior change without a link

The system shall give a project that declares no code link, and a plan run from outside any linked process repository, the same argv, environment, records, verdicts and command output as today, the plan approval record's version and `"code": null` key being the one change.

## 6. Surface

### config: phax.json code (process repository, project layer only) — indicative

Summary: A process repository names the directory where its code repository is checked out, and phax judges its plans against that code.

before:

    {
      "gateProfiles": { "default": [ … ] }
    }

after:

    {
      "gateProfiles": { "default": [ … ] },
      "code": { "root": "code" }
    }

    # .gitignore of the process repository
    /code/

### cli: phax validate (link refusals) — indicative

Summary: Running phax validate in a process repository says when its code root is missing, is not a git repository or is not ignored.

    $ phax validate
    ✗ phax.json code.root "code": not the top level of a git repository
    $ phax validate
    ✗ phax.json code.root "code": not ignored by this repository — add /code/ to .gitignore
    $ phax validate
    ✗ phax.local.json code: the code link is declared in phax.json only

### file: docs/plans/approvals/<plan>.json — indicative

Summary: Every plan approval record states which code commit its plan was approved against, or null when the project has no code link.

before:

    {
      "$schema": "https://docs.phax.run/schemas/plan-approval-record/0.25.0.json",
      "artifact": "docs/plans/2611201030-billing-export-plan.md",
      "planFingerprint": "73307e42…",
      "approvedAt": "2026-11-20T10:42:07.112Z",
      "baseline": "bae802b24aed73802ec8d9292ed61df045b9c747",
      "sourceSpec": { "path": "docs/specs/2611181420-billing-export.md", "fingerprint": "ddef903b…" },
      "approvedBy": { "kind": "operator", "name": "Ada" }
    }

after:

    # linked project
    {
      "$schema": "https://docs.phax.run/schemas/plan-approval-record/0.40.0.json",
      "artifact": "docs/plans/2611201030-billing-export-plan.md",
      "planFingerprint": "73307e42…",
      "approvedAt": "2026-11-20T10:42:07.112Z",
      "baseline": "bae802b24aed73802ec8d9292ed61df045b9c747",
      "code": { "root": "code", "baseline": "9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d" },
      "sourceSpec": { "path": "docs/specs/2611181420-billing-export.md", "fingerprint": "ddef903b…" },
      "approvedBy": { "kind": "operator", "name": "Ada" }
    }

    # project with no code link
    {
      "$schema": "https://docs.phax.run/schemas/plan-approval-record/0.40.0.json",
      …
      "baseline": "bae802b24aed73802ec8d9292ed61df045b9c747",
      "code": null,
      …
    }

### file: plan frontmatter approved stamp — indicative

Summary: An approved plan in a linked project shows the short code commit it was approved against beside its baseline.

before:

    approved:
      date: 2026-11-20
      baseline: bae802b

after:

    approved:
      date: 2026-11-20
      baseline: bae802b
      code: 9c8d7e6

### cli: phax plans status — indicative

Summary: Running phax plans status in a process repository reports a plan stale when the code files it reads have changed since its approval.

before:

    === Plan Staleness Report ===

    docs/plans/2611201030-billing-export-plan.md: fresh

after:

    === Plan Staleness Report ===

    docs/plans/2611201030-billing-export-plan.md: STALE
      ground-changed: src/export/csv.ts changed in code/ since baseline 9c8d7e6f5a4b…
    docs/plans/2611190915-ledger-plan.md: STALE
      missing-record: the recorded code baseline 1a2b3c4 no longer exists in code/ — re-approve with "phax artifact approve docs/plans/2611190915-ledger-plan.md"

### cli: phax run --plan ../docs/plans/<plan>.md (from the code repository) — indicative

Summary: A run from the code repository refuses a plan that is unapproved or stale against the code, and at review it tells the operator to complete the plan in the process repository.

before:

    $ cd code && phax run --plan ../docs/plans/2611201030-billing-export-plan.md
    … phases run, gates pass …
    ✓ review open

after:

    $ cd code && phax run --plan ../docs/plans/2611201030-billing-export-plan.md
    phax run refused: docs/plans/2611201030-billing-export-plan.md is stale
      ground-changed: src/export/csv.ts changed in code/ since baseline 9c8d7e6f5a4b…

    $ cd code && phax run --plan ../docs/plans/2611201030-billing-export-plan.md
    … phases run, gates pass …
    ✓ review open
    The plan lives in the process repository: once merged, run there
      phax artifact complete docs/plans/2611201030-billing-export-plan.md

### file: pull request body footer (code repository) — normative

Summary: A pull request opened from a linked run names neither the plan nor the spec it came from.

before:

    ---

    🛤️ Generated with [phax](https://docs.phax.run) 0.40.0 — the golden path, just facts\
    **Plan** `../docs/plans/2611201030-billing-export-plan.md`\
    **Agents** claude `claude-opus-5-5` at high: 3 phases\
    **Run** `billing-export`

after:

    ---

    🛤️ Generated with [phax](https://docs.phax.run) 0.40.0 — the golden path, just facts\
    **Agents** claude `claude-opus-5-5` at high: 3 phases\
    **Run** `billing-export`

### cli: phax plans lint (process repository) — indicative

Summary: Running phax plans lint in a process repository checks the plan's files against the checked-out code instead of the process repository.

before:

    $ phax plans lint docs/plans/2611201030-billing-export-plan.md
    ✗ files  p1: modifies src/export/csv.ts, which does not exist

after:

    $ phax plans lint docs/plans/2611201030-billing-export-plan.md
    ✓ files  every planned path checked against code/

## 7. Non-goals

- Moving a project's files between the two repositories, and any tool that does it.
- A code repository outside the process repository's tree (a sibling checkout): the code root is inside it.
- Submodules and subtrees.
- Records: their destination in another repository already exists and is unchanged.
- Running a plan from the process repository against the code: `phax run` still runs in the repository it is invoked in.
- Adding staleness to commands that do not compute it today (`phax resume`, `phax artifact status`): the link changes how staleness is judged, not where.
- A code baseline for spec approvals: a spec has no footprint.
- Judging uncommitted changes in the code checkout at approval: the code baseline is the code repository's HEAD commit.
- plans lint's commands and models checks: they read the configuration of the repository lint runs in, as today.
- The text of a plan's commit bodies, which the plan author writes: phax adds no redaction to it.
- Migrating or rewriting stored approval records: older ones are read as `"code": null` and stay as written.

## 8. Acceptance criteria

### A declared code root is the project's code root

Given a process repository whose phax.json declares `"code": { "root": "code" }`, with a git repository checked out at `code/` and `/code/` in its .gitignore, when `phax validate` runs in the process repository, then it succeeds and reports no code-link problem. (refs §5.1)

### The link lives in the project layer only

Given a phax.local.json declaring `code`, and separately a phax.json whose `code.root` is `../elsewhere`, when `phax validate` runs, then it fails each time, naming the file and the `code` field. (refs §5.2)

### A code root that is not a repository is refused

Given a process repository whose phax.json declares `code.root` `code`, where `code/` is missing, or is a plain directory, or is a subdirectory of another repository, when `phax validate` runs, and `phax artifact approve` runs on one of its plans, then both fail, naming `code` and the reason, and no approval is recorded. (refs §5.3)

### A tracked code root is refused

Given a linked process repository whose .gitignore does not ignore `code/`, when `phax validate` runs, and `phax plans status` runs, then `phax validate` fails, naming `code` and telling the operator to ignore it, and `phax plans status` reports each Approved plan as an error carrying the same reason. (refs §5.4)

### Approval records the code baseline

Given a linked process repository with a Draft plan whose spec is Approved and recorded, and the code repository at commit C, when `phax artifact approve` runs on the plan, then the plan's approval record file carries `code` with the code root and the full commit C under the newer plan-approval-record version, and its frontmatter approved stamp carries C's short form. (refs §5.5)

### Unlinked approval records a null code

Given a repository whose phax.json declares no code link, when `phax artifact approve` runs on a plan, then the approval record file is stamped with the newer plan-approval-record version and carries `"code": null` with every other key as today, and the frontmatter stamp carries exactly today's keys. (refs §5.6, §5.18)

### An older record is read as null and left as written

Given a repository with no code link holding a plan approval record stamped plan-approval-record 0.25.0, when `phax plans status` runs, then the plan's verdict is the one it had before, and the record file's bytes are unchanged. (refs §5.7, §5.18)

### A code change in the footprint makes the plan stale

Given a plan of a linked project, approved at code baseline C, whose footprint includes `src/export/csv.ts`, and a commit in the code repository after C that changes `code/src/export/csv.ts`, when `phax plans status` runs in the process repository, then the plan is STALE with ground-changed evidence naming `src/export/csv.ts` and baseline C, and `phax plans status --apply` flips it to Stale. (refs §5.8)

### A code change outside the footprint keeps the plan fresh

Given a plan of a linked project approved at code baseline C, and a later code commit that changes only files outside its footprint, when `phax plans status` runs in the process repository, then the plan is fresh. (refs §5.8)

### Process repository changes are not ground

Given a plan of a linked project approved at code baseline C, and a later process-repository commit that adds a file at `src/export/csv.ts` in the process repository's own tree, when `phax plans status` runs, then the plan is fresh. (refs §5.8)

### self-changed and spec-changed hold under the link

Given a plan of a linked project approved with its spec, with no code change since, when the plan's text is edited, and separately its spec's text is edited, then `phax plans status` runs, then the plan is STALE with self-changed evidence in the first case and spec-changed evidence naming the spec in the second. (refs §5.9)

### A rewritten code history is reported

Given a plan of a linked project whose recorded code baseline was removed from the code repository by a rebase and garbage collection, when `phax plans status` runs, then the plan is reported missing-record, naming the code baseline and `code/`, with the re-approve command. (refs §5.10)

### An approval without a code baseline must be redone

Given a plan approved before its process repository declared the code link, its record either stamped 0.25.0 or carrying `"code": null`, when `phax plans status` runs after the link is declared, then the plan is reported missing-record, saying it was approved without a code baseline. (refs §5.11, §5.7)

### A code baseline without a link is reported

Given a plan whose approval record carries a non-null `code` in a repository whose phax.json declares no code link, when `phax plans status` runs, then the plan is reported missing-record, saying the project declares no code link. (refs §5.12)

### A linked run refuses a stale plan

Given a code repository checked out at `code/` of a linked process repository, and an Approved plan there whose footprint file changed in the code repository since its code baseline, when `phax run --plan ../docs/plans/<plan>.md` runs in the code repository, then it exits non-zero before any phase starts, naming ground-changed and the changed file, and creates no run folder or branch. (refs §5.13, §5.8)

### A linked run refuses an unapproved or unrecorded plan

Given a linked layout whose plan is Draft, and separately one whose plan is Approved with no approval record file, when `phax run --plan ../docs/plans/<plan>.md` runs in the code repository, then it refuses each time with the same refusal a plan living with its code gets. (refs §5.13)

### A plan outside any link stays loose

Given a code repository and a plan file in a directory that is not under docs/plans/ of a process repository linking this code repository, when `phax run --plan <path>` runs, then the run behaves exactly as a loose-plan run does today. (refs §5.18)

### A linked run leaves completion to the operator

Given a fresh Approved plan of a linked project that its source spec's last plan completes, when the linked run reaches review, then the plan and spec files and the process repository's history are unchanged, and the output prints `phax artifact complete` followed by the plan's process-repository path. (refs §5.14)

### The pull request names nothing of the process repository

Given a linked run at review whose plan declares a source spec, when the run is published, then the pull request body contains no `**Plan**` or `**Spec**` entry, and neither the plan's or spec's path or slug nor any process-repository URL. (refs §5.15)

### Commits name nothing outside the code repository

Given a linked run with a passed phase, when its phase commit is read, then its trailers are Run-Id, Short-Name, Phase-Id, Phase-Title, Model, Effort and Gate-Log, and none contains `../` or an absolute path. (refs §5.16)

### plans lint checks files against the code

Given a linked process repository whose plan modifies `src/export/csv.ts`, present at `code/src/export/csv.ts` and absent from the process repository's own tree, when `phax plans lint` runs on the plan in the process repository, then the files check reports no missing file. (refs §5.17)

## 9. Open questions

None.

## 9b. Arbitrated questions

### q-link-side — Which repository declares the code link?

- process-side — The process repository's phax.json names its code root (`"code": { "root": "code" }`); a run from the code repository finds the link through the plan's own repository — abandons: A link visible from the code repository alone: a run from the code repository finds the link only when given a plan inside a linking process repository.
- code-side — The code repository's phax.json names its process root (`"process": { "root": ".." }`) — abandons: Process privacy: the public code repository carries a pointer to a private repository, and the pointer dangles in every clone made outside the process repository.
- both-sides — Each repository names the other, and phax refuses when they disagree — abandons: A single source of truth: two declarations in two repositories, with a code-side pointer that is public, that can drift apart.

Recommendation: process-side — The process repository is the only one that knows the layout, and the plan path a linked run is given already leads to it, so nothing needs to be written in the public repository. The loss is that a link is undiscoverable from a bare code checkout. That is acceptable, because a bare code checkout has no plans to judge.

Decision: process-side — by operator (Rémy Loubradou), 2026-11-17
Why: The process repository is the only one that knows the layout, and the plan path a linked run is given already leads to it, so nothing needs to be written in the public repository. The loss is that a link is undiscoverable from a bare code checkout. That is acceptable, because a bare code checkout has no plans to judge. Advocate: The strongest case for both-sides: each repository can verify the link from its own side, so a run started in the code repository knows it is linked without having to infer it from the plan path it was given. Principles: S1, S4. Reversibility: costly. Revised: none.

### q-run-lifecycle — Is a run from the code repository through the link a lifecycle run?

- gated-artifact — The run gates the plan as the process repository's artifact (Approved, recorded, fresh) but completes nothing; it prints the `phax artifact complete` command for after the merge — abandons: Automatic completion: an operator who skips the printed command leaves a merged plan Approved, so it later shows as stale or open.
- full-lifecycle — The run also completes the plan, and a last plan's spec, by committing in the process repository at the run's end — abandons: Completion tied to the merge: the process repository records the plan as Completed before the code is reviewed, so a rejected pull request leaves a Completed plan whose code never landed.
- loose — The run stays loose, as today — abandons: The staleness gate itself: a loose plan skips the run's staleness, status and record checks, which is the loss this spec exists to fix.

Recommendation: gated-artifact — Today completion is safe because it is committed on the run's branch and merges with the code. Across two repositories nothing can make the two atomic. A manual step that is printed is a smaller loss than a completion that can be false. Staying loose would give up the guarantee the brief asks for.

Decision: gated-artifact — by operator (Rémy Loubradou), 2026-11-17
Why: Today completion is safe because it is committed on the run's branch and merges with the code. Across two repositories nothing can make the two atomic. A manual step that is printed is a smaller loss than a completion that can be false. Staying loose would give up the guarantee the brief asks for. Advocate: The strongest case for full-lifecycle: the system completes the plan as a condition it can verify, instead of a manual procedure that operators will forget, so merged plans never linger as Approved. Principles: S1, S7. Reversibility: cheap. Revised: none.

### q-pr-names — What does a linked run's pull request name of the plan and spec?

- omit — Neither: the footer drops the Plan and Spec entries — abandons: A trail from the pull request to the plan for a team whose two repositories are both private and readable by every reviewer.
- slug — Their slugs, without paths or links — abandons: Process privacy: in a public repository the slug tells everyone where the work is going, and readers cannot open it.
- setting — A publish setting choosing between omitting and naming them (for example `publish.processRefs: "omit" | "name"`) — abandons: One behavior: a new config key whose default still has to be one of the two choices above, and which every linked project has to understand.

Recommendation: omit — The brief's main case is a public code repository with a private process, and there any reference leaks something or cannot be opened. The run's qualified name and its records in the process repository still connect a pull request to its plan for whoever can read them. A setting can be added later without breaking anything.

Decision: omit — by operator (Rémy Loubradou), 2026-11-17
Why: The brief's main case is a public code repository with a private process, and there any reference leaks something or cannot be opened. The run's qualified name and its records in the process repository still connect a pull request to its plan for whoever can read them. A setting can be added later without breaking anything. Advocate: The strongest case for setting: a team whose two repositories are both private keeps the reviewer's direct link from the pull request to its plan, and a public project can still choose to omit it. Principles: S1, S10. Reversibility: cheap. Revised: none.

### q-record-shape — How does the approval record carry the code baseline, given the rule that new persisted fields are required?

- absent-unlinked — A `code` key present only for a linked project's plan, absent otherwise, at the current plan-approval-record version (as the brief states) — abandons: The repository's rule that new persisted fields are required, not optional: the record format gains a key that may be absent.
- required-null — A required `code` key, `null` when unlinked, under a new plan-approval-record version with every existing record migrated — abandons: No change for unlinked projects: every project's records are rewritten and every new record carries `"code": null`, which breaks the brief's additive constraint.

Recommendation: absent-unlinked — The brief makes additivity a hard constraint: a project with no link must see no change in its persisted formats. The record's verdicts stay explicit anyway. A linked plan without the key, or an unlinked plan with it, gets the missing-record verdict, so the optional key never decides a verdict silently.

Decision: required-null — by operator (Rémy Loubradou), 2026-11-17
Why: New persisted fields are required, not optional, and a $schema stamp names one shape: a key that is present for a linked plan and absent otherwise puts two shapes under one stamp. required-null does not migrate or rewrite any stored record: the plan-approval-record format moves to the opened version with a required `code` key (null when the project has no code link, { root, baseline } when it has one), and records written before it are read through the schema history readers as `code: null`, as the review files get their finding ids at read time. The loss accepted: an unlinked project's new approval records carry `"code": null` under the newer stamp, so an @lbdremy/phax-schemas older than that release must be upgraded to read them, which docs/upgrading.md states. Revise the requirements, the approval-record surface, the acceptance criterion on an unlinked approval, and the constraints that say the format changes only by adding a key at its current version. Advocate: The strongest case for absent-unlinked: a project with no link sees no change at all in its persisted formats. No unlinked record moves to a newer stamp, and no older @lbdremy/phax-schemas has to be upgraded to read records from a project that never uses the feature. Principles: E0, S2, S5. Reversibility: costly. Revised: productGoal, requirements, surface, nonGoals, acceptanceCriteria, planningNote.

## 10. Implementation-planning note

Settled:

- The link is a project-level fact of the process repository; the code root is inside the process repository's tree and is a git repository's top level, ignored by the process repository.
- Under the link, ground-changed is judged only in the code repository, from the recorded code baseline, on footprint paths relative to the code root; self-changed and spec-changed stay in the process repository.
- Staleness is judged wherever it is today: `phax run`'s preflight and `phax plans status` (with `--apply`).
- Missing-record covers a vanished code baseline, a linked plan whose record has `"code": null` (written so, or read so from an older version), and an unlinked plan whose record has a non-null code.
- The pull request footer's Plan and Spec entries are the only process references the code repository receives; commit trailers already name nothing of the process repository.
- The plan approval record gains a required `code` key, `{ root, baseline }` or `null`, at the opened plan-approval-record version (q-record-shape: required-null); no stored record is migrated or rewritten.
- Each §9b decision is reflected in §5: r-link-declare and r-run-resolves (q-link-side), r-run-no-completion (q-run-lifecycle), r-pr-omit (q-pr-names), and r-approve-code-baseline, r-approve-unlinked, r-record-older and r-record-without-code (q-record-shape).

Left open:

- The exact spelling of the config key, the record key and the frontmatter key (indicative in §6).
- How a linked run discovers the process repository from the plan path, and how it confirms that the link names the current code repository.
- Whether the ground-changed evidence in `phax plans status --json` gains a field naming the code root, or keeps today's shape with the code baseline in `baseline`.
- The exit codes of the link refusals.

Constraints:

- A project with no link sees no change in argv, environment, records, verdicts or output, and its existing tests pass. The one exception is that its new plan approval records carry `"code": null` under the newer plan-approval-record version.
- The plan-approval-record format moves to the opened version through a `next` snapshot with a required `code` key; records stamped at older versions are read through the schema history readers as `"code": null`, never rewritten. The plan frontmatter's approved block gains one key, for linked plans only.
- docs/upgrading.md states that an @lbdremy/phax-schemas older than the release that ships this change must be upgraded to read the new plan approval records.
- phax knows no project: messages, keys and docs say process repository, code repository and code root.
- All git access to the code repository goes through the Git port; the link is decoded through a schema at the config boundary.

## 11. Docs page

Page: docs/code-repository.md — Process and code in two repositories

Reader: A maintainer who wants to publish a project's code while keeping its specs, plans and briefs private, and who needs phax to keep judging plans against the code.

Example: Check out the code repository at `code/` inside the process repository and add `/code/` to its .gitignore. Declare `"code": { "root": "code" }` in the process repository's phax.json. Then approve a plan and see its record carry the code commit. Change a footprint file in `code/`, watch `phax plans status` report the plan stale, and see `cd code && phax run --plan ../docs/plans/<plan>.md` refuse it until the plan is re-approved.

## 12. Decision log

- 2026-11-17 q-link-side decided process-side — operator (Rémy Loubradou)
- 2026-11-17 q-run-lifecycle decided gated-artifact — operator (Rémy Loubradou)
- 2026-11-17 q-pr-names decided omit — operator (Rémy Loubradou)
- 2026-11-17 q-record-shape decided required-null — operator (Rémy Loubradou) — revised 6 sections
