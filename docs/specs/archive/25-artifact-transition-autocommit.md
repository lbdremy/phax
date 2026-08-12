---
status: Archived
date: 2026-08-11
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---
# Artifact Transition Auto-Commit

## Amendment — 2026-08-12: `--no-commit` removed

Code review dropped the `--no-commit` opt-out flag: artifact transitions now **always**
commit. Rationale (user decision): anyone who wants an uncommitted transition can simply
commit the write-set themselves afterward, so the escape hatch did not earn its CLI
surface. This supersedes §5.5 (Opt-out), the `[--no-commit]` flag in §6, the "Opt-out
skips the commit" acceptance criterion in §8, and the "`--no-commit` as the only escape"
phrasing in §9–§10. The clean-target precondition (§5.4) is unchanged and still refuses a
dirty target with exit code 12 — the remedy is now "commit or stash them first" with no
flag alternative. The `commit: boolean` toggle on the internal `TransitionArtifactOptions`
survives only as a non-CLI implementation/test seam. All inline references below have been
updated in place to match; the pre-amendment wording is preserved in git history.

## 1. Context

The `phax artifact` command group transitions the lifecycle status of specs
(`docs/specs/`) and plans (`docs/plans/`): `approve`, `stale`, `reopen`, `abandon`,
`archive`. A transition writes files in the main working tree:

- the artifact's `Status:` header line, rewritten in place;
- for plan approvals, an approval record (fingerprint, baseline commit, source-spec
  lineage) in `docs/plans/approvals.json`;
- for terminal transitions (`abandon`, `archive`), a move of the artifact file into the
  matching `archive/` directory.

Today these writes are left uncommitted. Elsewhere in phax, `phax run` commits each
phase's changes in its own worktree; artifact transitions are the only lifecycle
mutation that leaves git state to user discipline.

## 2. Problem

The lifecycle system's value rests on its records: staleness detection compares an
artifact against its recorded approval, and the approval record cites a `baseline`
commit. When the transition's writes sit uncommitted, the record is a half-recorded
fact — it can be lost, drift apart from the artifact, or reference a commit that later
disappears. This is not hypothetical: on 2026-08-11, `approvals.json` sat untracked
while its recorded baseline commit was removed from `main`, leaving dangling approval
records. Every uncommitted transition is an audit-trail gap that the user must notice
and close by hand.

## 3. Product goal

Every artifact status transition leaves the repository with its own changes committed:
one commit per transition, containing exactly what the transition wrote and nothing
else, even when unrelated changes are pending in the working tree. The lifecycle audit
trail becomes a property of the tool, not of user discipline.

> A transition either records itself completely in one commit, or tells you why it
> can't — it never half-records.

## 4. Terminology

- **Transition** — a status change applied by a `phax artifact` subcommand
  (`approve`, `stale`, `reopen`, `abandon`, `archive`). `status` is read-only and is
  not a transition.
- **Transition write-set** — the exact set of paths a given transition creates,
  modifies, or moves: the artifact file, any approval record file, and (for terminal
  transitions) the source and destination of the archive move.
- **Dirty target** — a write-set path that already has uncommitted changes (staged or
  unstaged) before the transition runs.
- **Transition commit** — the git commit created by the transition, containing the
  write-set and nothing else.

## 5. Functional requirements

### 5.1 Transition commit

WHEN a status transition succeeds THE system SHALL create a single git commit whose
content is exactly the transition write-set.

### 5.2 Scope isolation

WHILE unrelated uncommitted changes exist in the working tree THE system SHALL leave
them out of the transition commit and untouched by the transition.

### 5.3 Terminal move capture

WHEN a terminal transition moves the artifact into its `archive/` directory THE system
SHALL capture the removal of the old path and the addition of the new path in the same
transition commit.

### 5.4 Clean-target precondition

IF any write-set path is a dirty target THEN the system SHALL refuse the transition
before writing anything, naming the dirty path(s) and the remedy.

### 5.5 No opt-out (amended 2026-08-12)

THE system SHALL NOT expose a no-commit opt-out on the CLI; every successful transition
commits its write-set unconditionally. (Superseded the original clause, which let a
`--no-commit` flag apply the transition without committing and without enforcing the
clean-target precondition — see the Amendment above.)

### 5.6 No empty commits

IF a transition results in no file changes THEN the system SHALL NOT create a commit.

### 5.7 Commit message

The system SHALL generate a commit message that identifies the transition performed
and the artifact it targeted.

### 5.8 Commit failure reporting

IF the transition's writes succeed but the commit cannot be created THEN the system
SHALL exit non-zero, naming the written paths left uncommitted.

## 6. Surface

Transition subcommands take only the path argument (amended 2026-08-12 — the
`--no-commit` opt-out flag was removed; auto-commit is unconditional):

    phax artifact approve <path>
    phax artifact stale   <path>
    phax artifact reopen  <path>
    phax artifact abandon <path>
    phax artifact archive <path>

Success output, before → after (wording **indicative**; presence of the commit hash
**normative** per §5.1):

    ✓ approved docs/plans/45-typescript-7-migration-plan.md

    →

    ✓ approved docs/plans/45-typescript-7-migration-plan.md
    ✓ committed 3f2a1c9 — chore(plans): approve 45-typescript-7-migration-plan

Commit message shape (**indicative** — scope drawn from the artifact kind, subject
from the transition and slug):

    chore(plans): approve 45-typescript-7-migration-plan
    chore(specs): archive 21-artifact-lifecycle-status

Refusal on a dirty target (exit code 12 **normative**, consistent with existing
transition refusals; wording **indicative**):

    ✗ approve refused: docs/plans/45-typescript-7-migration-plan.md has uncommitted
      changes — commit or stash them first
    $? = 12

No configuration surface: auto-commit is default-on with no `phax.json` switch.

## 7. Non-goals

- No push, no pull request — the commit stays local, consistent with phax never
  publishing on its own.
- No hunk-level staging: the clean-target precondition removes the need to split a
  file's changes; phax never partially stages a file.
- No committing of unrelated pending changes, and no stash/restore choreography around
  them — they are simply left alone.
- No change to run worktree commit behavior (`phax run` phases are out of scope).
- No commit message configuration or templating.
- Hand-edited loose artifacts outside `docs/specs/`|`docs/plans/` remain out of scope,
  as for the rest of the `artifact` group.

## 8. Acceptance criteria

### Transition commits its write-set

Given a clean `docs/plans/NN-x-plan.md` in Draft and unrelated pending edits elsewhere
in the tree, when `phax artifact approve docs/plans/NN-x-plan.md` runs, then a new
commit exists containing the plan's `Status:` change and its approval record, the
unrelated edits remain uncommitted in the working tree, and the command prints the
commit hash. (refs §5.1, §5.2, §5.7)

### Archive move is one commit

Given a clean Approved spec, when `phax artifact archive` runs on it, then a single
new commit both removes the file from `docs/specs/` and adds it under
`docs/specs/archive/`. (refs §5.3)

### Dirty target refuses before writing

Given `docs/plans/NN-x-plan.md` with uncommitted edits, when `phax artifact approve`
runs on it, then the command exits with code 12, names the dirty path, no commit is
created, and the file's content and status are unchanged. (refs §5.4)

### No opt-out (amended 2026-08-12)

Removed. The `--no-commit` flag no longer exists, so there is no opt-out path to
exercise; every transition commits. (refs §5.5)

### No-op transition creates no commit

Given an already-Approved plan whose re-approval changes no file, when
`phax artifact approve` runs on it, then no new commit is created. (refs §5.6)

### Commit failure is loud

Given a repository where committing fails (e.g. no `user.name` configured), when a
transition runs, then the files are written, the command exits non-zero, and the
output names the paths left uncommitted. (refs §5.8)

## 9. Open questions for implementation planning

Question: on dirty target, refuse (recommended) or transition-without-commit plus
warning?

- Refuse — abandons: frictionless transitions while the user has WIP edits on the
  artifact; they must commit/stash first or explicitly pass `--no-commit`.
- Warn + skip commit — abandons: the guarantee that every default-path transition is
  recorded; audit gaps silently reappear on exactly the files most likely to drift.

Recommendation: refuse — the explicit `--no-commit` escape keeps the friction
one flag away, while the silent-gap loss defeats the spec's purpose. (Amended
2026-08-12: refuse was adopted, but the `--no-commit` escape was later removed —
the remedy is now to commit or stash first. See the Amendment above.)

Question: does the approval `baseline` recorded on approve reference the pre-existing
HEAD (recommended) or the transition commit itself?

- Pre-existing HEAD — abandons: nothing observable; the transition commit is a child
  of the baseline.
- The transition commit — abandons: recordability; the commit hash cannot be known
  before the record it must contain is written.

Recommendation: pre-existing HEAD — the alternative is self-referential and
unimplementable without a second commit.

Question: on commit failure after files are written, leave-and-report (recommended) or
roll back the writes?

- Leave and report — abandons: atomicity in a rare failure mode; the user finishes the
  commit by hand from the named paths.
- Roll back — abandons: simplicity and safety; undoing an archive move plus record
  writes is its own failure surface, in the least-tested path.

Recommendation: leave and report — §5.8 makes the failure loud, and the remedy (commit
the named paths) is trivial next to a rollback engine.

## 10. Implementation-planning note

Settled: auto-commit is unconditional (user decision 2026-08-11 made it default-on with
`--no-commit` as the only escape; the 2026-08-12 amendment removed that escape entirely);
path-scoped staging of the write-set only; clean-target precondition refusing with exit
code 12; no configuration surface. The git side
effect goes through the existing git port — no new direct git access outside infra.
Left open deliberately: the three §9 questions, each with a recommended default the
planner may adopt without further consultation. Constraint: the precondition check
must run before any write (refusal leaves the repository byte-identical), and staging
must never use pathless `git add`/`git commit -a` forms.
