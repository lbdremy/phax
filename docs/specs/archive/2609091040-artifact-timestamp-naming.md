---
status: Completed
date: 2026-09-09
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
approved:
  date: 2026-09-10
  baseline: c48a8c1
---

# Timestamp Naming for Specs and Plans

## 1. Context

Specs live under `docs/specs/`, plans under `docs/plans/`; a terminal transition
(`phax artifact complete|abandon`) moves the file into the sibling `archive/` directory.
Both skills prescribe a name of the form `NN-<slug>.md` for a spec and
`NN-<slug>-plan.md` for its plan, with `NN` a zero-padded counter, and say the plan
"mirrors" the spec's name. Nothing in phax reads the counter: the artifact commands,
the approval records (`approvals.json`, keyed by path) and the plan's `source-spec`
frontmatter all identify an artifact by its path. The counter is a pure convention, and
its next value is chosen by whoever writes the file, by looking at the directory.

## 2. Problem

The counter no longer orders anything, and it collides.

- Fourteen numbers are used twice in `docs/plans` (live and archive together): `09`,
  `10`, `11`, `12`, `13`, `14`, `15`, `16`, `17`, `20`, `21`, `22`, `25`, `33`. The
  archive hides a number the moment its file completes, so the next author reuses it.
- Fifteen spec/plan pairs carry different numbers (spec `19` → plan `60`, spec `18` →
  plan `58`, spec `05` → plan `11`). Specs and plans have independent counters, so
  the "mirror" rule never held; the number says nothing about lineage.
- A plan written last week can sort before a plan written in June, because a freed
  number was reused. The one thing the number was for, an authoring-order listing,
  is gone.
- Two people writing artifacts on the same day pick the same "next" number and
  conflict on merge.

## 3. Product goal

The file name of a spec or plan carries the UTC minute at which it was created, so a
directory listing is the authoring history, names never collide across live and
archived artifacts or across authors, and the number needs no lookup to pick. phax
creates the file and stamps it, so the author never computes a timestamp by hand.
Existing artifacts are renamed once so the whole tree, archive included, sorts the
same way.

> A spec or plan is named by when it was written and what it is; nothing else.

## 4. Terminology

- **Stamp** — ten digits `YYMMDDHHMM`, the creation instant in UTC to the minute.
  An ordering key, not a unique key: two artifacts may share a stamp.
- **Slug** — lowercase words joined by single hyphens, `[a-z0-9]+(-[a-z0-9]+)*`.
- **Artifact name** — `<stamp>-<slug>.md` for a spec, `<stamp>-<slug>-plan.md` for a
  plan. The file name, not the path: the same name is valid live and in `archive/`.
- **Repo-tracked artifact** — a file under `docs/specs/` or `docs/plans/`, at any depth.
  A loose `plan.md` elsewhere (`phax run --plan`) is not one.

## 5. Functional requirements

### 5.1 Name grammar

The system **shall** accept a repo-tracked artifact only if its file name matches the
artifact name grammar for its kind.

IF a repo-tracked artifact's file name does not match the grammar THEN every command
that reads the artifact SHALL refuse with exit code 12, naming the file and the expected
grammar.

### 5.2 Creation stamps from the clock

WHEN the user creates a spec or plan through phax THE system SHALL name the file with
the stamp of the current UTC minute and the given slug.

WHEN the user creates a spec THE system SHALL write a `Draft` spec skeleton (the
frontmatter block with `status`, `date`, `audience`, `scope`) at `docs/specs/<name>`.

WHEN the user creates a plan THE system SHALL write a `Draft` plan skeleton (frontmatter
with `status` and `source-spec`) at `docs/plans/<name>`.

IF the given slug does not match the slug grammar THEN the system SHALL refuse with exit
code 12 and not write a file.

IF the target file already exists THEN the system SHALL refuse with exit code 12 and not
write a file.

IF a plan is created against a source spec that does not exist or is not a spec THEN the
system SHALL refuse with exit code 12 and not write a file.

### 5.3 Plan lineage in the name

WHERE a plan declares a source spec THE plan's slug SHALL equal the source spec's slug.

The plan's stamp **shall** be its own creation minute, never the spec's stamp.

IF a plan's slug differs from its source spec's slug THEN `phax plans lint` SHALL report
an error finding.

### 5.4 Sorted history

The system **shall** guarantee that, within each artifact directory, lexical order of
file names equals creation order, ties within one minute excepted.

### 5.5 One-time migration

The system **shall** rename every existing repo-tracked artifact, live and archived, to
its artifact name, with the stamp taken from the UTC author time of the first commit
that added the file, following renames, and the slug taken from the current name with
its counter removed.

WHEN an artifact is renamed by the migration THE system SHALL rewrite every reference to
its old path in approval records (keys and source-spec bindings), in plans'
`source-spec`, and in tracked Markdown, so that no tracked file names a pre-migration
path.

IF the migration rewrites the content of an Approved plan THEN the system SHALL carry
the approval over, so the plan is not reported as edited since its approval.

### 5.6 Reference by slug

The spec and planning skills **shall** instruct authors to refer to an artifact by its
slug in prose, commits and pull requests, never by its stamp.

## 6. Surface

Artifact name grammar (normative):

    spec:  <YYMMDDHHMM>-<slug>.md          e.g. 2609091412-plan-prune.md
    plan:  <YYMMDDHHMM>-<slug>-plan.md     e.g. 2609101030-plan-prune-plan.md
    slug:  [a-z0-9]+(-[a-z0-9]+)*
    stamp: UTC, zero-padded, two digits per field

Creation command (normative, spelling included):

    $ phax artifact new spec plan-prune
    created docs/specs/2609091412-plan-prune.md (Draft)

    $ phax artifact new plan plan-prune --spec docs/specs/2609091412-plan-prune.md
    created docs/plans/2609101030-plan-prune-plan.md (Draft, source-spec docs/specs/2609091412-plan-prune.md)

    $ phax artifact new plan catalog-refresh
    created docs/plans/2609101031-catalog-refresh-plan.md (Draft, source-spec null)

Refusals (exit code normative; wording indicative):

    $ phax artifact new spec Plan_Prune
    ✗ slug "Plan_Prune" does not match [a-z0-9]+(-[a-z0-9]+)*
    $? = 12

    $ phax artifact status docs/specs/34-plan-prune.md
    ✗ docs/specs/34-plan-prune.md: name does not match <YYMMDDHHMM>-<slug>.md
    $? = 12

Lint finding (finding class and exit code normative; wording indicative):

    $ phax plans lint docs/plans/2609101030-prune-plan.md
    docs/plans/2609101030-prune-plan.md: error  slug "prune" differs from source spec slug "plan-prune"
    $? = 1

Tree, before → after the migration (indicative sample; stamps are the real first-commit
minutes):

    docs/plans/archive/33-plan-lint-plan.md               →  docs/plans/archive/2609080902-plan-lint-plan.md
    docs/plans/archive/33-resumable-postgate-failures.md  →  docs/plans/archive/2606260810-resumable-postgate-failures-plan.md
    docs/plans/archive/03b-provider-e2e-validation.md     →  docs/plans/archive/2606031656-provider-e2e-validation-plan.md
    docs/specs/23-phase-decision-requests.md              →  docs/specs/2608091526-phase-decision-requests.md

`approvals.json`, before → after (key rewrite normative; record shape unchanged):

    "docs/specs/23-phase-decision-requests.md": { … }  →  "docs/specs/2608091526-phase-decision-requests.md": { … }

Frontmatter: unchanged. `date` stays a required spec key.

## 7. Non-goals

- Stamp uniqueness. Two artifacts created in the same minute are told apart by slug;
  the creation command refuses only an existing path.
- Checking the frontmatter `date` against the stamp.
- Renaming loose `plan.md` files, `examples/`, or run folders and worktree names,
  which derive from the run short-name, not the plan file.
- A `--stamp` override or backdating; the migration is the only path that writes a
  stamp other than "now".
- Rewriting git history, commit messages or closed pull requests that cite old paths.
- Run records. They snapshot the plan under the path it had when the run started; that
  is a historical fact, not a reference to maintain.
- Ordering within one minute.

## 8. Acceptance criteria

### Off-grammar names are refused everywhere

Given `docs/specs/34-foo.md` with valid frontmatter, when `phax artifact status`,
`approve`, `complete` or `phax plans lint` targets it, then the command exits 12 naming
the file and the expected grammar. (refs §5.1)

### Creating a spec stamps the UTC minute

Given the clock reads 2026-09-09T14:12:40Z, when `phax artifact new spec plan-prune`
runs, then `docs/specs/2609091412-plan-prune.md` exists, is `Draft`, carries the four
required frontmatter keys, and `phax artifact status` on it succeeds. (refs §5.2)

### Creating a plan binds its source spec

Given an existing spec `docs/specs/2609091412-plan-prune.md`, when
`phax artifact new plan plan-prune --spec docs/specs/2609091412-plan-prune.md` runs at
2026-09-10T10:30Z, then `docs/plans/2609101030-plan-prune-plan.md` exists with
`status: Draft` and `source-spec: docs/specs/2609091412-plan-prune.md`. (refs §5.2, §5.3)

### Creation refuses bad input without writing

Given each of: slug `Plan_Prune`, an already-existing target name, a `--spec` path that
is missing or is a plan; when `phax artifact new` runs, then it exits 12 and the
directory is unchanged. (refs §5.2)

### Slug mismatch is a lint error

Given a plan named `…-prune-plan.md` whose `source-spec` is `…-plan-prune.md`, when
`phax plans lint` runs, then it reports an error finding naming both slugs and exits 1.
(refs §5.3)

### Listing order is creation order

Given the migrated repository, when the names under `docs/specs/archive/` and
`docs/plans/archive/` are sorted lexically, then the sequence of stamps is
non-decreasing and matches the first-commit order of the files. (refs §5.4, §5.5)

### Migration leaves no dangling path

Given the migrated repository, when tracked files are searched for any pre-migration
artifact path, then none is found, `phax artifact status` succeeds on every live
artifact, and `phax plans status` reports the same plans as before the migration.
(refs §5.5)

### Skills reference by slug

Given the shipped `phax-spec` and `phax-planning` skills, when their naming sections are
read, then they state the artifact name grammar, the creation command, and the
refer-by-slug rule, and no longer mention `NN`. (refs §5.6)

## 9. Open questions for implementation planning

All seven questions below were decided on 2026-09-10 on their recommendation; they are
kept as the record of the arbitration.

Question: stamp granularity.

- Minute — abandons: ordering between two artifacts created within the same minute.
- Second — abandons: a readable identifier; twelve digits are never typed or recognized.

Decision: minute. Uniqueness is the slug's job; the stamp only orders.

Question: migrate the archive or leave it.

- Migrate — abandons: a one-time rename of about ninety files, and every old path in
  `NEXT_STEPS.md` and docs must be rewritten in the same commit.
- Leave — abandons: the goal itself; `26…` sorts between `26-` and `27-`, so new files
  interleave with old ones inside `archive/` forever.

Decision: migrate. The rename is mechanical and the tree is clean once.

Question: the plan's stamp.

- Own creation minute — abandons: reading lineage from the number.
- The spec's stamp — abandons: the plans directory as a plan-authoring history, and it
  breaks for plans without a spec.

Decision: own minute. Lineage is `source-spec` and the shared slug.

Question: where the grammar is enforced.

- Every artifact-reading command — abandons: tolerance for a stray legacy file; one
  off-grammar file blocks its own commands until renamed.
- Only `plans lint` — abandons: the guarantee; a spec is never linted, so a bad spec name
  survives to approval.

Decision: every artifact-reading command, as part of the existing frontmatter and
location validation, plus the lint finding for the slug mismatch.

Question: who owns the spec skeleton that `artifact new spec` writes.

- The command writes the ten canonical headings — abandons: a single source of truth;
  the structure then lives in the `phax-spec` skill and in code, and they drift.
- The command writes frontmatter only — abandons: a guaranteed structure; the author
  fills the body from the skill, as today.

Decision: frontmatter only, for specs and plans alike. Nothing in phax validates
section headings, so a skeleton in code would be a second copy that no check keeps
honest. §5.2 is to be read that way: the skeleton is the frontmatter block.

Question: an Approved plan whose `source-spec` the migration rewrites.

- Carry the approval over — abandons: the rule that any content change after approval
  is an edit; the migration becomes a privileged writer.
- Re-approve by hand — abandons: nothing today (both live plans have no source spec),
  but the migration script would then be wrong the first time it matters.

Decision: carry it over, and only for the exact rewrite the migration made. A
path substitution is not a decision change.

Question: which commit time stamps a migrated file.

- Author time — abandons: nothing observable; rebases and squashes preserve it.
- Committer time — abandons: the creation order whenever history was rebased.

Decision: author time, as §5.5 states.

## 10. Implementation-planning note

Settled: the grammar, UTC minute stamps, creation through phax, own stamp for plans,
slug mirroring as a lint error, migration of live and archived artifacts with
first-commit stamps, and reference-by-slug in the skills. The migration is a one-off
deliverable of the plan, not a shipped command, and lands as a single commit with every
path rewrite. Time must come through a port, never from the agent. Refusal wording is the
planner's call; the subcommand spelling is not. This spec is
itself named under the new grammar; the migration must not rename it.
