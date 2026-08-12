---
status: Approved
date: 2026-08-09
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---
# Opportunistic Batch Execution of Disjoint Plans

## 1. Context

`phax plans-overlap` already computes, across a set of plans, per-plan file footprints, a
severity-graded conflict matrix, the largest parallel-safe set, and a wave schedule. All
of it is advisory: the analysis is printed and thrown away; runs still execute one plan at
a time. Meanwhile every run is already isolated — its phases execute in dedicated
worktrees on a dedicated branch — so the machinery for side-by-side execution exists.

Upstream, the artifact lifecycle spec (21) makes `Approved` enforceable and the staleness
& lineage spec (22) makes "fresh" computable. What remains is the executable step: letting
a human accept a proposed disjoint set and have phax actually run it in parallel.

The scheduling philosophy is fixed by design (recorded in the desktop idea document): the
human declares **priority order**, never dependencies; the machine detects opportunity
and proposes; disjointness is a **prediction** (plans declare intended files; agents can
overflow); the **merge is the real arbiter**. Optimistic concurrency, honestly labeled.

## 2. Problem

Disjoint plans — the common case in a groomed backlog — serialize today for no reason:
each waits for the previous run's full execute–review–publish cycle. The overlap analysis
that proves they were independent exists and is discarded. And there is no defined story
for what happens when parallel results meet: no ordered merge, no verification of the
combined result, no owner for a conflict. Without that defined meeting point, operators
either don't parallelize, or improvise merges by hand outside phax's evidence trail.

## 3. Product goal

An operator can start a **batch**: an explicitly listed, human-approved set of Approved,
fresh, pairwise-disjoint plans. phax executes each as an ordinary run in parallel, then
merges the results **in the operator's declared order** into a single integration result,
verifies that merged result with the gate profile, and surfaces every failure — overlap
that materialized, a conflicting merge, a red terminal gate — as an event needing a
human, never as silent improvisation. Prior merged members always survive a downstream
failure.

> The human orders the work; phax proposes what may run together; the merge — not the
> prediction — decides.

## 4. Terminology

- **Batch** — an explicitly listed, ordered set of plans the operator asks to execute
  together. The order is the operator's priority order; phax never reorders it.
- **Member** — one plan in a batch, executed as an ordinary run.
- **Disjoint** — no file appears in more than one member's footprint (file-level, per the
  staleness & lineage spec's footprint definition).
- **Integration result** — the single branch of work produced by merging member results in
  batch order.
- **Actual overlap** — a file changed by more than one member's *actual* run results
  (known from per-phase reconciliation), regardless of whether git merges it cleanly.
- **Terminal gate** — the gate profile executed once against the integration result.

## 5. Functional requirements

### 5.1 Batch eligibility

WHEN a batch is requested THE system SHALL verify that every member is `Approved` and
computes fresh (per the staleness & lineage spec) and that members are pairwise disjoint.

IF any check fails THEN the system SHALL refuse the batch naming each violation (the
member, and the stale reason or the overlapping files).

### 5.2 Human-approved, never machine-ordered

The system SHALL execute only batches whose member list and order the operator explicitly
provided; the system SHALL NOT reorder members or add members to a batch.

### 5.3 Parallel execution as ordinary runs

WHEN a batch starts THE system SHALL execute each member as an ordinary run — same
isolation, gates, fix loop, reconciliation, and artifacts — concurrently with the other
members.

### 5.4 Failure containment across members

IF a member run fails or interrupts THEN the other members' runs SHALL continue
unaffected, and the batch SHALL proceed no further than the last member (in batch order)
whose predecessors and self completed.

### 5.5 Ordered merge

WHEN a member's run completes and all its predecessors in batch order have merged THE
system SHALL merge that member's result into the integration result.

### 5.6 Merge conflict is a surfaced event

IF merging a member conflicts THEN the system SHALL halt the batch at that member,
surface it as needing a human with the conflicting files named, and leave all previously
merged members intact in the integration result.

### 5.7 Actual overlap is surfaced even when the merge is clean

IF a member's actual changed files intersect another member's actual changed files or
footprint THEN the system SHALL report that overlap as an attention point in the batch's
review evidence, even when every merge applied cleanly.

### 5.8 Terminal gate on the integration result

WHEN all members have merged THE system SHALL run the gate profile against the
integration result.

IF the terminal gate fails THEN the system SHALL surface the batch as needing a human
with the failing step named, leaving the integration result available for inspection.

### 5.9 Stacked publication

WHERE publication is enabled THE system SHALL publish the batch as one pull request per
member, stacked in batch order, such that merging the stack lands the integration result
in a single operation.

IF the publication provider does not support stacked pull requests THEN the system SHALL
publish a single pull request from the integration result whose body aggregates the
member handoffs.

### 5.10 Batch visibility

WHEN a batch is inspected THE system SHALL report each member's run state, the merge
progress in order, and the terminal-gate outcome, without requiring inspection of the
individual runs.

## 6. Surface

Proposal — the existing analysis proposes; the operator accepts by listing (that the
batch is an explicit operator-provided ordered list is **normative** per §5.2; command
spellings **indicative**):

```
phax plans-overlap docs/plans/*.md
  → parallel-safe: 32-billing-plan, 34-docs-refresh-plan, 36-init-wizard-plan

phax batch run 32-billing-plan.md 34-docs-refresh-plan.md 36-init-wizard-plan.md
```

Refusal on eligibility (refusal naming each violation **normative** per §5.1; wording
**indicative**):

```
✗ batch refused:
  34-docs-refresh-plan.md is STALE (ground-changed: README.md)
  32-billing-plan.md ∩ 36-init-wizard-plan.md: src/schemas/phaxConfig.ts
$? = 1
```

Batch status (per-member state, ordered merge progress, terminal gate **normative** per
§5.10; layout **indicative**):

```
phax batch status
  1. billing.invoice-rework     run: review_open   merged ✓
  2. docs.refresh               run: review_open   merged ✓
  3. init.wizard                run: phase-02/04   merge: waiting
  terminal gate: pending
```

Merge conflict surfacing (halt + named files + intact predecessors **normative** per
§5.6; wording **indicative**):

```
✗ batch halted at member 3 (init.wizard): merge conflict in src/cli/program.ts
  members 1–2 remain merged in phax/batch-20260809
$? = 1
```

Integration result: a branch (existence **normative** per §5.5; naming **indicative**,
sketched above as `phax/batch-20260809`).

Publication (per §5.9): one pull request per member, **stacked in batch order**, merging
as a single operation — the shape is **normative** where the provider supports stacks;
tooling and spellings **indicative** (GitHub ships stacks in public preview via the
`gh stack` CLI extension phax's existing `gh`-based publication can drive):

```
phax batch publish
  stack: #241 billing.invoice-rework ← #242 docs.refresh ← #243 init.wizard
  merges as one operation; top of stack = integration result (phax/batch-20260809)
```

Fallback where stacks are unavailable (**normative** per §5.9): a single pull request
from the integration result, its body aggregating the member handoffs.

No visual UI — no design annex.

## 7. Non-goals

- **Automatic batching** — phax never starts a batch on its own; proposal is advisory,
  execution is an operator gesture.
- **Dependency declaration** — there is deliberately no way to declare inter-plan
  dependencies; ordering is priority, disjointness is inferred. (Design decision, not an
  omission.)
- **Conflict resolution** — phax surfaces a conflicting merge; resolving it (by hand, or
  by re-planning the halted member against the new ground via the staleness machinery) is
  the human's move.
- **Sub-file conflict analysis** — file-level only; two plans touching one file are not
  batchable even if they touch different functions. The cost is a skipped opportunity,
  never a broken merge.
- **Automatic fix loop on the terminal gate** — no agent session owns the integration
  result; a red terminal gate is surfaced, not self-healed (revisitable later).
- **Cross-batch scheduling, nested batches, batching across repositories.**

## 8. Acceptance criteria

### Ineligible batches are refused with every violation

Given a batch request containing one stale member and two members sharing a footprint
file, when the batch is requested, then it is refused, the stale member is named with its
reason, and the shared file is named for the overlapping pair. (refs §5.1)

### Members run in parallel as ordinary runs

Given an eligible three-member batch, when it starts, then three runs execute
concurrently, each producing the same per-phase artifacts an individually started run
produces. (refs §5.3)

### One member's failure does not stop the others

Given a running batch, when member 2's run interrupts, then members 1 and 3 continue to
completion, member 1 merges, and the batch proceeds no further than member 1. (refs §5.4,
§5.5)

### Merges follow the declared order

Given members completing out of order (3 finishes first), when merging proceeds, then
member 3 merges only after members 1 and 2 have merged. (refs §5.5)

### A conflict halts, names, and preserves

Given member 2's result conflicting with the integration result, when its merge is
attempted, then the batch halts at member 2, the conflicting files are named, and member
1's merged result is intact. (refs §5.6)

### Clean merges can still warn

Given two members whose actual changed files intersect on one file that git merges
cleanly, when the batch completes, then the batch's review evidence reports that file as
an actual-overlap attention point. (refs §5.7)

### The integration result is gate-verified

Given all members merged, when the terminal gate runs and one step fails, then the batch
is surfaced as needing a human with the failing step named and the integration branch
still exists for inspection. (refs §5.8)

### Publication is a stack

Given a completed, terminal-gate-green batch with publication enabled on a stack-capable
provider, when it publishes, then one pull request exists per member, stacked in batch
order and mergeable as a single operation. (refs §5.9)

### Fallback is a single integration pull request

Given the same batch on a provider without stack support, when it publishes, then a
single pull request from the integration result exists, its body aggregating the member
handoffs. (refs §5.9)

### The batch is inspectable at a glance

Given a batch mid-flight, when its status is requested, then each member's run state, the
ordered merge progress, and the terminal-gate outcome are reported. (refs §5.10)

## 9. Open questions for implementation planning

All questions are **resolved** (review of 2026-08-09) — the first by the operator, the
rest by adopting the recommended default:

Question: what is the publication shape of a completed batch?

- One integration PR (aggregated handoffs) — abandons: per-member revert granularity at
  the PR level (per-phase commits survive inside it) and per-member review sign-off.
- Per-member PRs merged in order — abandons: phax as the merge arbiter — conflicts and
  ordering move to GitHub, outside the batch's evidence trail, and the terminal gate has
  no single result to verify.

Resolution (operator, 2026-08-09): **neither — stacked pull requests** (GitHub public
preview since 2026-07-30). One PR per member, stacked in batch order, merged as a single
operation. The stack dissolves the arbitration: per-member review sign-off survives, phax
remains the merge arbiter (it constructs the stack locally — a restack conflict is a §5.6
halt), and the terminal gate keeps its single result — the top of the stack *is* the
integration result. Where stacks are unavailable, the fallback is the single integration
PR (§5.9), whose loss profile was the acceptable one.

Question: does merging start incrementally (as ordered predecessors complete) or after
all members complete (barrier)?

- Incremental — abandons: simplicity; merge state advances while runs are still moving.
- Barrier — abandons: early conflict signal — a conflict at member 1 surfaces only after
  member 3's long run finishes, wasting the wall-clock the batch existed to save.

Recommendation: incremental — §5.5 is written for it; the earlier a human sees the halt,
the cheaper it is.

Question: what does the terminal gate run against when the batch halts partway?

- Gate the partial integration (merged prefix) — abandons: the invariant that the
  terminal gate certifies *the batch*; a green partial is easily misread as batch-green.
- No gate until resolved — abandons: knowing whether the merged prefix is even sound
  while the human works on the halted member.

Recommendation: no automatic gate on a partial — the operator can always run the profile
by hand on the integration branch; an ambiguous green is worse than a missing one.

## 10. Implementation-planning note

Settled: eligibility (Approved + fresh + pairwise disjoint, refusals name violations),
the operator as the only scheduler (explicit ordered list, never reordered), members as
ordinary runs with full artifacts, ordered incremental merge, conflict-halts-preserving-
predecessors, actual-overlap attention points on clean merges, terminal gate on the full
integration result only (never on a halted batch's merged prefix), stacked publication
with the single-PR fallback, and batch-level visibility. All §9 questions are resolved.

Left open: command spellings, integration-branch naming, and batch artifact locations.

Publication constraint: stack support is a **provider capability probed explicitly** —
GitHub's stacks are in public preview and ship via the `gh` CLI phax already drives;
absence of the capability selects the single-PR fallback deterministically, never a
mid-publish improvisation. Model the two publication shapes as an explicit per-variant
union, not a permissive superset.

Constraints the plan must respect: this spec consumes 21 (only `Approved` plans),
22 (freshness and footprints — reuse its computation, do not fork a second footprint
notion), and the existing overlap analysis (the proposal side; do not duplicate its
conflict classification). Member runs must remain *ordinary* runs — no batch-special
execution path — so every existing guarantee (gates, fix loop, reconciliation, decision
requests once specced) holds unchanged inside a batch. Batch state is an explicit state
machine under the same transition discipline as runs and phases. Locking must extend to
the batch so members' runs and the integration branch cannot be mutated concurrently by
another phax invocation.
