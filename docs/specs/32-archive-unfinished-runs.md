---
status: Draft
date: 2026-09-03
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---

# Archive Unfinished Runs

## 1. Context

A run in the local registry moves through `created → running → review_open → archived`, with
`failed`, `interrupted`, and `rate_limited` as the ways a run stops short of `review_open`.
`archived` is the only terminal state an operator can reach on purpose: `phax archive
<short-name>` moves the run folder and its phase worktrees under `~/.phax/archive/<namespace>.<short-name>/`,
prunes git's worktree records, and marks the registry entry `archived`. Its one guard is the
final worktree: without `--force` the command refuses when that worktree has uncommitted
changes.

Today the archive transition is legal from exactly two states:

    review_open  ──archive──▶  archived
    completed    ──archive──▶  archived

Every other state is rejected by the run state machine. `phax --usage` documents the command
as "Archive a completed or review_open run":

    cmd "archive" {
        help "Archive a completed or review_open run"
        arg "<short-name>"
        flag "--force" { help "Archive even if the final worktree has uncommitted changes" }
    }

The other commands that touch a stopped run are `resume` (continue from where it stopped)
and `reset-phase` (clear a failed phase so `resume` can re-run it). Both push the run
_forward_; neither lets the operator give up on it.

## 2. Problem

A run that stopped before `review_open` has no exit. On 2026-09-03 the registry held 15 such
runs, the oldest from June: first attempts abandoned after a rate limit, an interruption, a
failed gate, or a plan rewrite, each superseded by a `-2` run that was later archived. Every
one of them is refused:

    $ phax archive louloupapers.louloupress-new-features
    Archive failed: Invalid run state transition: failed → archived

The only routes out are to drive the run forward to `review_open` (re-running agents on work
nobody wants) or to hand-edit `run-status.json` to lie about the state, which bypasses the
state machine phax exists to enforce. The result is a registry that grows monotonically:
`phax ls` lists dead attempts forever, their worktrees stay registered in the repository, and
the operator learns that the persisted state is something to edit by hand.

The refusal is also right, for the default case. An unfinished run may hold uncommitted agent
work in a phase worktree, and archiving it silently would discard that. What is missing is a
way to say "I know this run is unfinished and I am giving up on it", not a weaker guard.

## 3. Product goal

An operator can retire any run that is not currently executing, through the same archive
command, by stating explicitly that they accept losing whatever the run had not finished.
The state machine stays the only thing that changes a run's state; the operator never edits
persisted state to get there.

> Every run that is not running has a legal path to `archived`, and taking it always names the
> loss it accepts.

## 4. Terminology

- **Finished run** — a run in `review_open` or `completed`: every phase committed, nothing
  left to execute.
- **Unfinished run** — a run in `created`, `failed`, `interrupted`, `rate_limited`, or
  `stopped`: execution stopped before all phases were committed, and `resume` (with or
  without `reset-phase`) is the forward path.
- **Executing run** — a run in `running`, or any run whose lock is active. Never archivable.
- **Abandoning** — archiving an unfinished run. The result is the ordinary `archived` state;
  the word names the operator's decision, not a new state.

## 5. Functional requirements

### 5.1 Finished runs keep today's behavior

WHEN `phax archive` is invoked on a finished run THE system SHALL archive it under the same
rules as today: refuse without `--force` if the final worktree is dirty, otherwise move the
run folder and worktrees to the archive location and mark the run `archived`.

### 5.2 Unfinished runs are refused by default

WHEN `phax archive` is invoked on an unfinished run without `--force` THE system SHALL refuse,
exit non-zero, name the run's current state, and name `--force` as the remedy.

### 5.3 Unfinished runs archive with explicit consent

WHEN `phax archive --force` is invoked on an unfinished run THE system SHALL archive it: move
the run folder and every existing phase worktree to the archive location, prune the
repository's worktree records, and mark the run `archived`.

### 5.4 Uncommitted work is never a blocker under consent

WHILE `--force` is given THE system SHALL archive an unfinished run regardless of uncommitted
changes in any of its phase worktrees.

### 5.5 Executing runs are never archivable

IF the run is in `running`, or its lock is active, THEN the system SHALL refuse to archive it
even with `--force`, naming the state or the locking process.

### 5.6 Already-archived runs are refused

IF the run is already `archived` THEN the system SHALL refuse with a message saying so, with
or without `--force`.

### 5.7 The stop reason survives archival

WHEN an unfinished run is archived THE system SHALL preserve the run's recorded stop reason and
last error in the archived run status, unchanged.

### 5.8 The archive command documents its widened contract

The system SHALL describe, in `phax --usage`, that `archive` accepts any non-executing run and
that `--force` is required for an unfinished one.

## 6. Surface

Command line, unchanged in shape (normative):

    phax archive <short-name>
    phax archive <short-name> --force

Refusal on an unfinished run without consent (exit code 1 normative; state and flag named
normative; wording indicative):

    $ phax archive phax.plan-27
    Archive refused: run "phax.plan-27" is interrupted, not finished. Re-run with --force to archive it anyway and give up its unfinished work.
    $? = 1

Success on an unfinished run with consent (normative that the outcome is the ordinary
`archived` state; wording indicative):

    $ phax archive phax.plan-27 --force
    Run "phax.plan-27" archived successfully.

Refusal on an executing run, unchanged and unaffected by `--force` (normative):

    $ phax archive phax.provider-contract-discoverability --force
    Archive failed: Run "phax.provider-contract-discoverability" is locked by pid 41022. Release the lock first or use phax unlock.
    $? = 1

`phax --usage`, before → after (help wording indicative; the fact that the help names both
the widened scope and the `--force` requirement normative per §5.8):

    cmd "archive" {
        help "Archive a completed or review_open run"
        flag "--force" { help "Archive even if the final worktree has uncommitted changes" }
    }
                                        ▼
    cmd "archive" {
        help "Archive a run that is not running; --force is required for an unfinished run"
        flag "--force" { help "Archive even if the run is unfinished or a worktree has uncommitted changes" }
    }

Archived run status of an abandoned run, at its archive location (normative that the
pre-existing `stoppedReason` and `lastError` are retained verbatim; no new field):

    {
      "state": "archived",
      "stoppedReason": "rate_limited",
      "lastError": "Gate command failed: pnpm format:check (exit 1)"
    }

## 7. Non-goals

- **No new run state.** Abandoning produces `archived`, not `abandoned`. The artifact
  lifecycle has an `Abandoned` status for specs and plans; runs do not get a parallel one.
- **No new persisted field.** The archived status does not record which state the run was
  in before archival beyond what `stoppedReason` and `lastError` already carry.
- **No new command.** `phax abandon` is not introduced; the archive command is the single
  exit.
- **No bulk archive.** `phax archive` still takes one run. Sweeping every non-running run is
  a shell loop over `phax ls --json`, not a flag.
- **No deletion.** Archiving moves worktrees under `~/.phax/archive/`; it does not delete
  them. Reclaiming disk from the archive is a separate concern.
- **No registry repair.** Runs created before the namespace migration still sit under
  bare-name folders with no `namespace` in their run status and cannot be resolved by any
  command. Making them resolvable is a separate spec; this one assumes a resolvable run.
- **No change to `resume` or `reset-phase`.** The forward path for an unfinished run is
  untouched.

## 8. Acceptance criteria

### Finished run archives as before

Given a run in `review_open` with a clean final worktree, when `phax archive <short-name>`
runs, then the run is `archived` and its folders sit under the archive location. (refs §5.1)

### Finished run with dirty worktree still needs consent

Given a run in `review_open` whose final worktree has uncommitted changes, when
`phax archive <short-name>` runs without `--force`, then it exits 1 and names the dirty
worktree. (refs §5.1)

### Unfinished run is refused by default

Given a run in each of `created`, `failed`, `interrupted`, `rate_limited`, and `stopped`,
when `phax archive <short-name>` runs without `--force`, then it exits 1, the message names
that state, the message names `--force`, and the run's state is unchanged. (refs §5.2)

### Unfinished run archives with consent

Given a run in each of `created`, `failed`, `interrupted`, `rate_limited`, and `stopped`,
when `phax archive <short-name> --force` runs, then the run is `archived`, its run folder and
every phase worktree that existed sit under the archive location, and the repository lists
none of its worktrees. (refs §5.3)

### Unfinished run with no worktrees archives cleanly

Given a run in `created` that never set up a worktree, when `phax archive <short-name>
--force` runs, then the run is `archived` and only the run folder was moved. (refs §5.3)

### Dirty phase worktree does not block consent

Given an `interrupted` run whose current phase worktree has uncommitted changes, when
`phax archive <short-name> --force` runs, then the run is `archived` and the worktree,
including its uncommitted changes, sits under the archive location. (refs §5.4)

### Running run is never archivable

Given a run in `running`, when `phax archive <short-name> --force` runs, then it exits 1,
names the state or the lock, and the run's state is unchanged. (refs §5.5)

### Locked run is never archivable

Given a run whose lock is active, when `phax archive <short-name> --force` runs, then it
exits 1 and names the locking process. (refs §5.5)

### Archived run is refused

Given a run already `archived`, when `phax archive <short-name>` runs with or without
`--force`, then it exits 1 and says the run is already archived. (refs §5.6)

### Stop reason is preserved

Given a `rate_limited` run whose status records a stop reason and a last error, when
`phax archive <short-name> --force` runs, then the archived run status carries the same
`stoppedReason` and `lastError` values. (refs §5.7)

### Usage documents the widened contract

Given the installed binary, when `phax --usage` is read, then the `archive` command's help
states that it accepts any run that is not running and that `--force` is required for an
unfinished run. (refs §5.8)

## 9. Open questions for implementation planning

All three questions were put to the operator on 2026-09-03 and decided as recorded below;
nothing remains open for the planner.

### Q1. One consent flag or two?

`--force` today means "discard uncommitted changes in the final worktree". Abandoning an
unfinished run is a second, distinct consent.

- Option A, reuse `--force` for both — abandons: the ability to grant one consent without
  the other. An operator forcing past a dirty worktree on a finished run also holds the
  power to abandon, and vice versa.
- Option B, add `--abandon` alongside `--force` — abandons: a single exit. An unfinished run
  with a dirty worktree needs both flags or an implied one, and the help must explain the
  pairing.
- Option C, a separate `phax abandon` command — abandons: one archive mechanic. Two commands
  move runs to the same terminal state through the same steps, and `abandon` collides with
  the artifact lifecycle vocabulary.

Decision (2026-09-03): Option A. Both consents are the same consent, "I accept losing
unfinished work", and an operator who passes `--force` on an unfinished run cannot plausibly
intend anything else. §5 and §6 are written for Option A.

### Q2. Should `stopped` be archivable?

`stopped` is reachable in the state machine but no command reaches it today.

Decision (2026-09-03): yes, treat it as unfinished. Excluding a state nobody produces buys
nothing and leaves a hole if a future command does produce it.

### Q3. Should `phax ls` distinguish abandoned runs?

Decision (2026-09-03): no. `archived` is the outcome; `phax ls --archived --json` already
exposes nothing about the pre-archive state, and §7 rules out a new field. An operator who
cares can read `stoppedReason` in the archived run status.

## 10. Implementation-planning note

Settled: the archive command is the single exit; `--force` is the consent; the outcome is
the ordinary `archived` state with no new field, state, or command; executing and locked
runs stay refused unconditionally; `phax --usage` must reflect the widened contract.

Deliberately open: refusal wording, as marked indicative in §6.

Constraints the plan must respect: the widening lives in the run state machine's archive
rule, not in a bypass around it, so the same rule serves both the command and any future
caller; the existing worktree-move and prune mechanics are reused for unfinished runs rather
than duplicated; the acceptance criteria that enumerate unfinished states become one test
per state.
