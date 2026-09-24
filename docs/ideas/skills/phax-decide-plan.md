---
name: phax-decide-plan
description: Default arbitration doctrine for `phax artifact decide` on a plan and for the planning agent's technical arbitrations when no human is in the session — split by shippable surface, oracle first when the surface is shown, footprint discipline, model and effort left to the planner, docs last.
---

> **Draft, not installed.** Ground for the `artifact-decide` spec (`../artifact-decide.md`).
> Distilled 2026-09-24 from the `phax-planning` skill's *Technical arbitrations* rule, 79
> archived phax plans (2–6 phases typical; median 5 planned files per phase, p90 11), and
> the author's decisions P1–P7 in
> `steme-doc/docs/doctrine/01-vision/roadmap-1.0-arbitration-reflexes.md`. A project
> extends it with `--doctrine <file>`.

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

## Principles (cite by id)

- `P1` **Classify, then decide.** Surface or §9 → escalate; else dominant loss.
- `P2` **Split by surface, not by size.** Each plan ships a piece of surface that is
  useful on its own; split when two pieces are useful separately, never split a piece
  that is only useful whole. Six phases or eleven planned files in one phase are
  *smells* that make you ask the question; they are not the rule.
- `P3` **Oracle first, when the surface is shown.** When the spec shows the surface with
  real before/after artifacts, write tests and disposition matrices in an
  `oracle-authoring` phase that precedes the implementing phase, and list those files
  as read-only for the implementing phase. When the surface is only described, keep
  test and code in one phase and rely on the compliance review's `tests` dimension. If
  an oracle written first turns out wrong, the implementing phase must not touch it: the
  run pauses and the disagreement goes back to the spec — that is the intended
  behaviour, not a failure.
- `P4` **A fix stays inside the run's footprint.** A correction phase may touch the
  files the findings name plus the run's declared footprint. A root cause outside it is
  not fixed here: it becomes a `deviation` to escalate (a spec amendment or a new plan).
- `P5` **Optional files: three per phase, named.** Regenerated artifacts (lockfiles,
  generated references, renders) are declared once at plan level as *regenerated
  files*, outside the quota. A phase that needs more splits or declares.
- `P6` **Model and effort are the planner's.** No doctrine fixes effort by phase kind.
  Follow the catalog rule of the planning skill (default Opus-tier, Sonnet for
  mechanical work, a stated reason for anything above, the lowest effort that
  succeeds); the usage guard protects the operator's margin.
- `P7` **Docs last.** The item's explanatory docs page is the last phase, fed by the
  generated reference and the previous phases' handoffs; it also closes the item's
  explanatory hole.
- `P8` **Inside-out to implement, outside-in to plan and verify** (from the planning
  skill; kept here so a decision can cite it).
- `P9` **Amend, don't drift.** When execution shows the spec was wrong, the plan does not
  quietly deviate; the spec gets a dated amendment and the plan is adjusted against it.

## Output

Same shape as the spec doctrine's output, with `principles` citing `P*` ids, plus
`"phase": "<phase id>"` when the decision concerns one phase. A decision that escalates
carries `"escalate": "<the spec question>"` and the plan is not approved until it is
answered.
