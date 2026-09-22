# Idea: headless authoring — `artifact new spec|plan --headless`

> Status: **brainstorm**. Captured 2026-09-22 from the steme roadmap-1.0 conductor
> design — not a spec, not a plan. Nothing below is committed. Additive to the CLI; the
> spec JSON schema is a new persisted format and should ship marked experimental until
> 1.0's stability promise covers it. Related: [`autopilot.md`](./autopilot.md) (the four
> model-invocation points), [`headless-code-review.md`](./headless-code-review.md) (the
> same move for the review), spec 23 (decision requests: the shape open questions take).

## Why

`phax artifact new spec|plan <slug>` creates a stamped, empty artifact; a human (or a
loop) then writes it in a session with the `phax-spec` / `phax-planning` skill. That
leaves two of the four model invocations outside phax — unrecorded, unresumable, with a
Markdown document as the model's output. The headless review already moved the fourth
point inside phax with a rule: **the agent emits schema-validated JSON only; phax
materialises.** The same rule applies to authoring.

## Shape

```
phax artifact new spec <slug> --headless --brief <file> [--model … --effort …]
phax artifact new plan <slug> --headless --brief <file> [--model … --effort …]
```

- `--brief <file>` is the caller's prompt: what to write, from what ground (a roadmap
  item's title and anchors, a situation report, the corpus root). phax prepends the
  matching skill and the output schema.
- The agent session (recorded like any other) returns **JSON**:
  - for a **plan**, directly in the `phax-plan.json` shape the extractor would have
    produced; phax renders `plan.md` from it and seeds the content-addressed extraction
    cache, so the plan is never re-extracted through a model;
  - for a **spec**, in a **spec schema** that does not exist yet and is the real work of
    this idea: context, problem, EARS requirements, acceptance criteria, consumption
    surface, lifecycle/traceability, **open questions as `{ id, question, options[],
    recommendation, rationale }`** (the decision-request shape of spec 23), and a
    docs-page section. phax renders the Markdown spec from it.
- Both artifacts are stamped and named exactly as today (`<YYMMDDHHMM>-<slug>.md`),
  committed with their JSON sidecar, and written into the records. Validation failure is
  a provider error; nothing half-written lands.
- The interactive path is unchanged: `artifact new` without `--headless` still creates
  the empty file.

## What it gives a loop

- Structured open questions: an arbiter (the steme conductor's `argued` policy today, a
  `phax artifact decide` later) answers data, not prose, and the decision ledger is a
  projection of `{question, options, chosen, abandoned, why}`.
- One recorded session per artifact, resumable and explainable through records.
- A conductor reduced to orchestration: roadmap item → brief → `artifact new --headless`
  → `artifact approve` → `run` → reviews → `publish-pr` → status.

## Costs and open questions

- The spec schema is a new format; render fidelity (a spec that reads well) is a real
  design task, and the `phax-spec` skill must teach the schema, not just the prose.
- Whether the JSON sidecar is the source of truth and Markdown the rendering (as for
  the roadmap on the steme side), or the reverse for hand-edited specs. Probably: the
  sidecar is authoritative only when it exists; a hand-edited spec has none.
- Whether `--brief` should also accept stdin, so a caller never writes a temp file.
