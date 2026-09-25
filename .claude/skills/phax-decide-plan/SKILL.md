---
name: phax-decide-plan
description: Default arbitration doctrine for `phax artifact decide` on a plan and for the planning agent's technical arbitrations when no human is in the session — split by shippable surface, oracle first when the surface is shown, footprint discipline, model and effort left to the planner, docs last.
---

> Bundled default doctrine, landed by hand on 2026-09-24 from `docs/ideas/skills/`; wired into the
> skill catalog by the `artifact-decide` plan. A project extends it with `--doctrine <file>` or
> replaces it with a project-scoped skill of the same name.

# phax decide — plan doctrine

You are arbitrating a **plan's technical arbitrations** — the choices the spec left open
("what, not how"): contract shapes, phase decomposition, which layer owns a behaviour,
what a phase may touch. The `phax-planning` skill says: *frame every option by its
dominant loss, recommend the option whose loss is acceptable*. This doctrine says what
to do when there is no human to ask.

## The headless clarify gate (`P1`)

The planning skill stops and asks a human when two viable approaches sacrifice different
things. Without a human, classify first, mechanically:

- If an option **changes the item's public surface** (adds, removes or alters a command,
  flag, config key, file format, API or UI the spec claims) or **contradicts a §9
  decision**, it is a *spec question*: escalate it to `decide` on the spec (spec
  doctrine, fresh session); do not resolve it in the plan.
- Otherwise resolve it by dominant loss and record it in `## Technical arbitrations`.

## The ground and the five principles

Every id below ranks under one of the author's five pairs, and all five stand on one
ground: **`E0` explicit over implicit** — attribution needs explicit things; decisions are
dated, what is abandoned is written, "deliberately not" is recorded.

- `C1` **consistent over new** — the existing default, discipline, source or gesture
  before a new one.
- `C2` **strict over loose** — refuse rather than warn; deviate only toward the stricter.
- `C3` **exhaustive over convenient** — total on inputs and states; write what is left out.
- `C4` **condition over control** — a condition the system verifies rather than a
  procedure a human drives; structural impossibility rather than a check.
- `C5` **surface convenience over core convenience** — the reader's and consumer's ease
  before the implementer's; never an arbitration "because it is simpler in the code".
  Before 1.0 there is no stability contract: break freely so the surface stays
  *coherent*; from 1.0 the contract is signed and the surface stays *stable* (semver).
  At every boundary the surface states the need and the core may propose what costs
  the surface nothing (`phax-planning`, *Boundary contracts*).

**Attention is the cost of reading, not writing.** Writing is free and there is no team
memory; a human reads code they did not write. Strict, exhaustive, explicit form does not
spend that attention, it frees it: every attributed guarantee is something the reader
need not verify. So the five pairs need no "limit on rigor"; the only line to draw is
`C5`'s — **exhaustive where a machine consumes, minimal where a human reads** (surfaces,
handoffs, docs, the PR's tables).

**Precedence when two pairs conflict.**

1. `E0` is eligibility, not a tie-breaker: an option that leaves something implicit is
   not a candidate.
2. Ask who consumes: what a human reads falls under `C5` (minimal, for a named reader);
   what a machine consumes falls under `C3` (exhaustive). They partition, they do not
   conflict.
3. `C2` beats `C1` only when the existing thing is loose — a principle is violated;
   otherwise `C1`, the existing default stands. A refusal that widens the artifact is not
   "strict", it belongs to another artifact.
4. Among what remains, `C4`: the option expressed as a condition the system verifies over
   one that needs control.

## Principles (cite by id)

- `P1` (`C4`) **Classify, then decide.** Surface or §9 → escalate; else dominant loss.
- `P2` (`C5`) **Split by surface, not by size.** Each plan ships a piece of surface that is
  useful on its own; split when two pieces are useful separately, never split a piece
  that is only useful whole. Six phases or eleven planned files in one phase are
  *smells* that make you ask the question; they are not the rule.
- `P3` (`C4`) **Oracle first, when the surface is shown.** When the spec shows the surface with
  real before/after artifacts, write tests and disposition matrices in an
  `oracle-authoring` phase that precedes the implementing phase, and list those files
  as read-only for the implementing phase. When the surface is only described, keep
  test and code in one phase and rely on the compliance review's `tests` dimension. If
  an oracle written first turns out wrong, the implementing phase must not touch it: the
  run pauses and the disagreement goes back to the spec — that is the intended
  behaviour, not a failure.
- `P4` (`C2`) **A fix stays inside the run's footprint.** A correction phase may touch the
  files the findings name plus the run's declared footprint. A root cause outside it is
  not fixed here: it becomes a `deviation` to escalate (a spec amendment or a new plan).
- `P5` (`C3`) **Optional files: three per phase, named.** Regenerated artifacts (lockfiles,
  generated references, renders) are declared once at plan level as *regenerated
  files*, outside the quota. A phase that needs more splits or declares.
- `P6` (`C4`) **Model and effort are the planner's.** No doctrine fixes effort by phase kind.
  Follow the catalog rule of the planning skill (default Opus-tier, Sonnet for
  mechanical work, a stated reason for anything above, the lowest effort that
  succeeds); the usage guard protects the operator's margin.
- `P7` (`C5`) **Docs last.** The item's explanatory docs page is the last phase, fed by the
  generated reference and the previous phases' handoffs; it also closes the item's
  explanatory hole.
- `P8` (`C1`) **Inside-out to implement, outside-in to plan and verify** (from the planning
  skill; kept here so a decision can cite it).
- `P9` (`C1`) **Amend, don't drift.** When execution shows the spec was wrong, the plan does not
  quietly deviate; the spec gets a dated amendment and the plan is adjusted against it.

## Output

Same shape as the spec doctrine's output, with `principles` citing `P*` ids, plus
`"phase": "<phase id>"` when the decision concerns one phase. A decision that escalates
carries `"escalate": "<the spec question>"` and the plan is not approved until it is
answered.
