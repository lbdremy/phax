# Idea: a fourth provider — `coverage`

> Status: **brainstorm**. Captured 2026-09-23 from the steme roadmap-1.0 conversation —
> not a spec, not a plan. Nothing below is committed. Related: the three existing
> providers (gate diagnostics, `scopes`, `orient`), [`desktop-app.md`](./desktop-app.md)
> (the run screen), steme's `02-product/guarantee-coverage-map.md` and
> `03-architecture/developer-experience/review-map-reading-direction.md`.

## The idea

A review-by-trajectory UI wants, for a run's diff, **which lines a machine already
judged and which ones need a human**. steme can produce that (its coverage map, evaluated
per change, with attribution down to the line), but the UI should not depend on steme:
it should render a document, and any tool that can name what it proved about a line
should be able to emit it. Hence a provider, like the other three.

```
"coverage": { "command": "…" }
Request   { "run": "<id>" } | { "files": ["src/a.ts", …] }
Response  { "cells": [{ surface, mode, meaning, scope, state, rules: [id…] }],
            "nodes": [{ id, kind, … }],
            "lines": [{ file, range: [from, to], kind, meanings: [m…],
                        proved: [{ meaning, rule, grade }], residual: [m…] }],
            "provenance": { tool, version, profile } }
```

- `state` is one of five, never a boolean: no rule exists · rule exists, not selected ·
  rule ran, no applicable site · rule ran, violation waived · rule ran, applied, passed.
- **A line is locked when its `residual` is empty — a computation, never a rule's
  claim.** Three parties, none of which can lock alone: a parser classifies the line's
  `kind` (deterministic); a small human-owned table in the target's stackpack says which
  `meanings` that kind carries (an import: boundaries + contract, never invariant; a
  config key under a schema: contract; a side-effect import is not an "import" because it
  runs code); rules prove one meaning each, and only when they ran, applied, passed, and
  are of structural grade (a heuristic rule may colour a line, not lock it). `residual` is
  the kind's meanings minus the proved ones. A UI folds empty-residual lines and annotates
  partial ones ("boundaries proved; contract: no rule"); attention goes to the complement.
- **No scalar, no average** — steme's decision 15 (no single coverage number) applies to
  the document: the complement is a *list* of lines to read, whose length is visible but
  is not a percentage.

## What a UI does with it

The run screen shows the diff with a per-line overlay (named rules, state), locked lines
folded, the complement listed, and a **reading-direction toggle**: *inside-out* (the
plan's phase order, core first — verification) or *outside-in* (surface → core by the
target's scope order — discovery). Both are sort keys over the same document; the
outside-in order comes from the target's manifest, not from the provider.

## Open

- Whether phax calls the provider at `review_open` and stores the document with the run
  (so the review handoff and the headless code review can cite it), or only the UI does.
- Whether `lines` should carry the phase that produced the line, so the overlay can also
  answer "which phase locked this".
