Write the phax spec `phase-graph`: a plan's phases form a graph of dependencies instead of a sequence. A phase
names the phases it depends on. Phases with no dependency between them, whose planned files do not overlap, run at
the same time, each in its own worktree with its own gate. The run merges their branches where a later phase
depends on several of them.

## Why

The operator, 2026-11-19, from a conversation about why an agent would pick phax over its own subagents: an agent
fanning work out (a `Workflow` script, several subagents) runs independent pieces in parallel and changes course
as it goes. phax runs a plan's phases one after the other, so a plan of five phases where three are independent
takes the time of five. The fan-out is what subagents give and phax does not; the gate on every branch is what
phax gives and subagents do not.

It is also the engine of `do-attempts`: N attempts at the same task are N parallel branches of one graph, followed
by a choice among them.

## What phax has today, to read first

- `src/app/worktree.ts`: a phase branch is `<run branch>--<phase-id>`; phase-01 branches off the run branch,
  phase-N off phase-(N-1). The caller keeps `fromBranch` across iterations.
- `src/app/executePlan.ts`: the loop that runs the phases in order.
- `src/domain/state.ts` and `src/domain/reducer.ts`: `RunState` holds one phase sub-state (`{ run: "running",
  phase }`). A graph has several phases in flight. Transitions go only through these functions.
- `src/schemas/phaxPlan.ts`: the extracted plan's phases, each with its planned `files`.
- `phax plans overlap` (`src/app/analyzePlanOverlap.ts`): footprints, pairwise intersections, the conflict
  classes (regenerated files are a hard conflict), a wave schedule. Built for plans; the same reasoning applies
  to the phases of one plan.
- The parked, Approved spec `docs/specs/2608091526-batch-execution-disjoint-plans.md`: parallel disjoint plans
  merged in a declared order, "the merge is the real arbiter", overlap surfaced even when the merge is clean.
  Read it: the merge rules may be the same for phases and for plans, and the two specs should say which one owns
  them.
- Acceptance pairs (`docs/acceptance-phases.md`), holds and interactive phases (`phax run --help`), the kept-open
  final phase, the global reconciliation (`src/app/generateGlobalReconciliation.ts`).
- The plan grammar the `phax-planning` skill teaches and `phax plans lint` checks.

## The direction (the operator's, 2026-11-19)

1. **Declared in the plan, approved with it.** The graph is what the operator approves; phax does not infer it.
2. **Disjoint or dependent.** Two phases that may run at the same time do not overlap in their planned files;
   `phax plans lint` refuses a plan where they do. Regenerated files count as overlap.
3. **Every branch is gated.** A phase passes its own gate in its own worktree before anything depends on it, as
   today.
4. **One end.** The final phase, kept open for review, depends on every other phase, directly or not, so the run
   still ends on one branch and one pull request.
5. **A sequence is a graph.** A plan that names no dependency runs as it does today.

## Questions for the spec's §9

- The plan grammar: a `**Depends on:**` line per phase, its default when absent (the previous phase), and
  whether the extracted plan carries the dependencies as a required field (no back-compat shims in persisted
  formats).
- How a phase with several dependencies gets its base: merging their branches in which order, and what happens
  when a merge conflicts although the footprints were disjoint (unplanned edits: 44% of phases deviate from their
  planned files, `docs/briefs/knowledge-index.md`).
- When a gate re-runs on merged work: only at the phase that merges, or a merge gate of its own.
- How many phases run at once (provider rate limits, the Max five-hour window), and who sets it.
- The run state with several phases in flight: one failure, one usage-limit pause or one hold while siblings
  run. Do siblings finish, stop or get interrupted? What does `phax resume` resume?
- Acceptance pairs, holds and interactive phases inside a graph.
- What `phax plans overview`, `plans estimate`, the records and the review handoff show of the graph.
- Whether this and `batch-execution-disjoint-plans` share one merge component, and which lands first.

## Out of scope

- Changing the graph during a run (amending the plan mid-run, a later idea in `NEXT_STEPS.md`).
- Several attempts at the same phase: `do-attempts`.
- Phases running on another machine.
