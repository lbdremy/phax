---
name: phax-decide-review
description: Default doctrine for turning a headless code review's findings into a plan (`phax review-plan`) — the severity scale and its threshold, what a fix may touch, when not to plan at all, and how findings become phases.
---

> Bundled default doctrine, landed by hand on 2026-09-24 from `docs/ideas/skills/`; wired into the
> skill catalog by the `artifact-decide` plan. A project extends it with `--doctrine <file>` or
> replaces it with a project-scoped skill of the same name.

# phax decide — review doctrine

You are turning `code-review.json` into `review-plan.json`. You may be resuming the
review session (you remember why each finding was raised) or starting from the report
alone. Either way: the report is the judge; the plan is its consequence. Do not re-review.

## Severity, and the threshold

| Severity | Meaning | Default treatment |
| --- | --- | --- |
| `bug` | incorrect behaviour | planned |
| `deviation` | departure from the spec or the plan | planned, or escalated when the deviation is the spec's fault (`R3`) |
| `concern` | a risk, a missing test, a security point | planned |
| `info` | style, preference | never planned; written to the handoff note |

`--min-severity` moves the line; the caller owns it. Without it, everything above `info`
is planned. Compliance findings of severity `deviation` join the report's findings —
they share the scale.

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

## Principles (cite by id)

- `R1` (`C4`) **Do not plan on a `divergent` compliance verdict.** The run drifted from its
  plan; fixing code would chase the wrong target. Emit no plan; escalate.
- `R2` (`C2`) **A fix stays inside the footprint** (= plan doctrine `P4`): the files the
  findings name plus the run's declared footprint. A root cause outside becomes a
  `deviation` to escalate, not a phase.
- `R3` (`C1`) **A finding that reveals a contradiction reopens the spec, it is not patched.**
  If two findings, or a finding and a requirement, cannot both be satisfied, the
  disagreement goes back to `decide` on the spec (spec doctrine `S8`). Plan the rest.
- `R4` (`C4`) **Oracles are not fix targets.** A fix phase never plans a test, matrix or
  fixture that judges the code it changes. If the finding says the test is wrong, that is
  an oracle question: escalate (plan doctrine `P3`).
- `R5` (`C1`) **Group by cause, not by file.** One phase per root cause; findings that share a
  cause share a phase; a phase names its findings by id so the next `--headless` pass
  can tick them.
- `R6` (`C4`) **Bounded passes.** The caller bounds the passes (`review.code.maxPasses`); the
  doctrine does not retry. A finding still open after the last pass is reported, never
  silently dropped.
- `R7` (`C3`) **`info` accumulates in the handoff, once.** Style findings are collected in the
  handoff note for the human, deduplicated across passes; they never generate work.

## Output

`review-plan.json` in the `phax-plan` shape: one phase per cause, each phase listing the
finding ids it addresses, its planned files (within `R2`), its gate profile (the run's),
and no oracle files (`R4`). Plus a `decisions[]` block in the decide shape for every
finding escalated under `R1`–`R4`, so the ledger shows what was *not* fixed and why.
