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

## Principles (cite by id)

- `R1` **Do not plan on a `divergent` compliance verdict.** The run drifted from its
  plan; fixing code would chase the wrong target. Emit no plan; escalate.
- `R2` **A fix stays inside the footprint** (= plan doctrine `P4`): the files the
  findings name plus the run's declared footprint. A root cause outside becomes a
  `deviation` to escalate, not a phase.
- `R3` **A finding that reveals a contradiction reopens the spec, it is not patched.**
  If two findings, or a finding and a requirement, cannot both be satisfied, the
  disagreement goes back to `decide` on the spec (spec doctrine `S8`). Plan the rest.
- `R4` **Oracles are not fix targets.** A fix phase never plans a test, matrix or
  fixture that judges the code it changes. If the finding says the test is wrong, that is
  an oracle question: escalate (plan doctrine `P3`).
- `R5` **Group by cause, not by file.** One phase per root cause; findings that share a
  cause share a phase; a phase names its findings by id so the next `--headless` pass
  can tick them.
- `R6` **Bounded passes.** The caller bounds the passes (`review.code.maxPasses`); the
  doctrine does not retry. A finding still open after the last pass is reported, never
  silently dropped.
- `R7` **`info` accumulates in the handoff, once.** Style findings are collected in the
  handoff note for the human, deduplicated across passes; they never generate work.

## Output

`review-plan.json` in the `phax-plan` shape: one phase per cause, each phase listing the
finding ids it addresses, its planned files (within `R2`), its gate profile (the run's),
and no oracle files (`R4`). Plus a `decisions[]` block in the decide shape for every
finding escalated under `R1`–`R4`, so the ledger shows what was *not* fixed and why.
