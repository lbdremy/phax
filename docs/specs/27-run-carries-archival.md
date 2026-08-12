---
status: Draft
date: 2026-08-12
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---
# The Run Branch Carries Artifact Archival

## 1. Context

The artifact lifecycle spec (21) gave plans and specs enforced statuses with two distinct
terminal states: `Archived` means the artifact completed its purpose (a spec was consumed,
a plan ran); `Abandoned` means it was dropped without that completion. Transitions are
explicit gestures (`phax artifact archive …`), each auto-committed as a single path-scoped
commit (25). Staleness & lineage (22) binds every plan to a declared source spec and gates
spec retirement on all dependent plans being terminal.

A run executes in its own worktree on a run branch, phase by phase, each phase gated. When
the final phase's gates are green the run enters `review_open` — the kept-open state where
a human reviews the result — and `phax publish-pr <run>` then pushes the run branch and,
where enabled, opens a pull request. Merging that pull request is the moment the plan's
work — and therefore the plan's purpose — lands.

Nothing today connects any of this to the plan's lifecycle: archival is a separate,
post-merge human gesture on `main`.

## 2. Problem

After a run's pull request merges, the plan that produced it still reads `Approved` and
still sits outside `archive/` — the record disagrees with reality until a human remembers
to type `phax artifact archive`. The gesture duplicates a decision already made: merging
the run PR *is* the judgment that the plan completed its purpose. Automating the archival
*after* the merge would need something watching merge events and could still diverge — a
rejected PR must not archive, a reverted merge must un-archive — precisely the
record/reality drift the lifecycle system exists to remove.

## 3. Product goal

When a run's final phase ends with its gates green, the run appends the plan's ordinary
`Approved → Archived` transition to the run branch — before review opens, independent of
the publish mechanism. The reviewer sees the archival in the branch they review, the pull
request carries it in its diff, and the merge lands the work and the record in one
gesture. Where the plan is the last live dependent of its source spec, the spec's archival
rides along on the same branch. An unpublished or rejected run archives nothing on `main`;
a reverted merge reverts the archival with the work — record and reality are the same
commits and cannot diverge.

> The run that completed the plan writes its epitaph on its own branch; the merge is the
> only gesture, and the record can only land — or unland — together with the work.

## 4. Terminology

- **Run completion** — the moment the final phase's gates are green and the run moves
  into its kept-open review state (`review_open`).
- **Archival commit** — a commit on the run branch applying a lifecycle `→ Archived`
  transition (status rewrite plus move into `archive/`), with the write-set scoping of
  spec 25.
- **Ride-along spec archival** — the archival of the plan's declared source spec on the
  same branch, applied only when legal.
- **Chain gate** — spec 22 §5.4: a spec may transition to a terminal status only while no
  plan declaring it as source is in a non-terminal status.

## 5. Functional requirements

### 5.1 Run completion archives the plan on the run branch

WHEN a run's final phase completes with its gates green THE system SHALL apply the plan's
`Approved → Archived` transition on the run branch before the run enters `review_open`.

### 5.2 The transition is the ordinary one

The system SHALL apply completion-time archival through the same lifecycle rules as an
operator-initiated `phax artifact archive`: transition legality (21), status–location
agreement via the move into `archive/` (21 §5.5), and a single commit containing exactly
the transition write-set (25).

### 5.3 Ride-along spec archival

WHERE the plan declares a source spec THE system SHALL, after the plan's archival on the
run branch, also apply the spec's `Approved → Archived` transition there — unless the
chain gate refuses because other non-terminal dependent plans exist, in which case the
system SHALL skip the spec's archival and report the skip with the blocking plans.

### 5.4 Completion is idempotent

IF the plan on the run branch is already `Archived` THEN the completion step SHALL NOT
apply a second transition. (Resuming or re-entering completion stays safe.)

### 5.5 Nothing outside the run branch changes

The system SHALL make no artifact transition, file change, or commit outside the run
branch as part of completion-time archival. (On `main`, statuses change only when the
merge lands the archival commits.)

### 5.6 A failed archival is loud

IF the plan's archival transition cannot be applied at run completion THEN the system
SHALL fail the completion step naming the cause, and the run SHALL NOT silently enter
`review_open` as if the archival had happened.

### 5.7 Archival is reported

WHEN completion applies archival commits THE system SHALL report each archived artifact
and its commit in the run's completion output.

## 6. Surface

No new command, flag, or configuration: the surface is the run's completion output and
the content of the run branch. `phax publish-pr` is mechanically unchanged — the commits
it pushes simply include the archival.

Run completion output, appended lines (presence of per-artifact archival lines with
commit hashes **normative** per §5.7; wording **indicative**):

    ✓ gates green — opening review
    ✓ archived docs/plans/32-billing-plan.md — 9c2d411 (on run branch)
    ✓ archived docs/specs/32-billing.md — 1f04e22 (last dependent plan)

Skip report when the chain gate blocks the spec (**indicative**):

    ✓ archived docs/plans/32-billing-plan.md — 9c2d411 (on run branch)
    ○ spec docs/specs/32-billing.md kept: non-terminal dependent plans remain
        docs/plans/33-billing-refunds-plan.md    Approved

Run branch tip at `review_open` (**indicative** — ordinary transition commits, spec 25
message shape):

    1f04e22 chore(specs): archive 32-billing
    9c2d411 chore(plans): archive 32-billing-plan
    41aa9be <last phase commit of the run>

The artifact files themselves change exactly as under `phax artifact archive` today
(status value, location under `archive/`), in whichever metadata format the lifecycle
uses (26).

## 7. Non-goals

- **No post-merge automation** — nothing watches merge events; nothing transitions
  anything on `main`. The merge itself lands the record.
- **No derived status** — "has a merged PR" is never read as meaning `Archived`; the
  status stays local data in the artifact file (21), placed there by this spec's commits.
- **No forced spec archival** — when the chain gate refuses, the spec stays live; the
  refusal is a skip, never a cascade over live plans (consistent with 22 §9).
- **No publish-mechanism changes** — `phax publish-pr` gains no flag, step, or output;
  archival is complete before review ever opens.
- **No batch semantics** — spec 24's batch execution applies this per member; which
  member of a stacked batch carries a shared spec's archival is settled when batch is
  implemented, not here.
- **No partial-merge handling** — if a published PR is split or cherry-picked by hand,
  the human owns reconciling the archival commits like any other commit on the branch.
- **Concurrent-approval races are out of scope** — a new dependent plan approved on
  `main` after run completion is not detected by the branch-side chain gate; post-merge,
  its dangling `Source-Spec:` path fails validation loudly (22 §5.2), which is the
  designed safety net for concurrent edits generally.

## 8. Acceptance criteria

### Completion appends the plan's archival

Given a run whose final phase's gates pass, when the run enters `review_open`, then the
run branch contains a commit in which the plan's status reads `Archived` and the plan
file lives under `docs/plans/archive/`, and the working tree and history of `main` are
unchanged. (refs §5.1, §5.5)

### The archival commit is an ordinary transition commit

Given the same completion, then the plan's archival commit contains exactly the
transition write-set (status rewrite and the archive move) and nothing else from the run.
(refs §5.2)

### The last plan takes its spec along

Given a plan that is the only non-terminal dependent of its Approved source spec, when
its run completes, then the run branch also contains a commit archiving the spec under
`docs/specs/archive/`, and the completion output reports both archivals with their
commits. (refs §5.3, §5.7)

### A sibling plan keeps the spec live

Given a second Approved plan declaring the same source spec, when the first plan's run
completes, then the spec's status and location are unchanged on the run branch and the
output reports the skip naming the sibling plan. (refs §5.3, §5.7)

### Re-entering completion applies nothing twice

Given a run whose completion already archived the plan, when completion runs again (e.g.
after a resume), then no new archival commit is created on the run branch. (refs §5.4)

### Publication carries the commits unchanged

Given a completed run, when `phax publish-pr` runs, then the pushed branch (and pull
request, where one is opened) includes the archival commits and publication itself
creates no additional commit. (refs §5.1, §5.5)

### An unpublished run leaves reality honest

Given a completed run that is never published, or whose pull request is closed unmerged,
then on `main` the plan still reads `Approved` under `docs/plans/` with no gesture
required. (refs §5.5)

### A failed archival cannot be missed

Given a run branch on which the plan's status was hand-edited to `Draft` mid-run, when
the final phase's gates pass, then the completion step fails naming the illegal
transition and the run is not reported as cleanly in review. (refs §5.6)

## 9. Open questions for implementation planning

Resolved by user decision (2026-08-12):

Question: when is the archival applied — at run completion or at publication?

- At run completion (chosen) — abandons: nothing on `main`; a completed-but-unpublished
  run's branch claims the plan's completion before anyone proposed landing it (harmless:
  the claim lives only on the branch, and `main` stays honest).
- At publication — abandons: the reviewer seeing the archival in the branch they review;
  the record would appear only in the PR, after the local review gesture.

Decision: at run completion — green gates on the final phase are the run's own statement
that the plan's work is done; review then reviews the *whole* proposed future, archival
included, and publish stays a pure transport step.

Question: how does a chain-gated spec skip report?

- Plain skip line (chosen) — abandons: pressure on the operator to archive the spec later.
- Warning — abandons: signal honesty; a legally live spec with live plans is not a
  defect, and warning on the designed path trains warning-blindness.

Decision: plain skip line naming the blocking plans.

Left genuinely open: none — remaining latitude (output wording, exact failure surfacing
of §5.6 within the run flow) is marked indicative in §6 or delegated in §10.

## 10. Implementation-planning note

Settled: archival happens on the run branch at run completion — after the final phase's
gates are green, before `review_open` — through the existing lifecycle transition
machinery: legality, archive move, path-scoped transition commit (specs 21 and 25 govern;
this spec adds a caller, not new transition semantics). The chain gate (22 §5.4) is
evaluated against the run branch's state. A failed plan archival fails the completion
step (§5.6); a chain-gated spec skip is normal output (§5.3). `phax publish-pr` is
untouched. No new CLI surface.

Constraints the plan must respect: transitions on the run branch go through the same
domain transition functions and git port as `phax artifact` — no parallel archival path;
the archival step is part of the run flow (state transitions through `src/domain/state.ts`
discipline apply to the run side too); how §5.6's failure surfaces reuses the run's
existing failure handling rather than inventing a new channel. Sequence after spec 26's
frontmatter migration if that lands first — this spec is format-agnostic, but the
transition write path it calls is being reworked there. Batch execution (24) will need to
decide which member of a stacked batch carries a shared spec's archival; nothing here may
preclude that being the last-merging member.
