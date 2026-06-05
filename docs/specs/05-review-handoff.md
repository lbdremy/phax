# PHAX Spec — Run Review Handoff and Global File Reconciliation

## Status

This document specifies a PHAX feature that generates a final deterministic review document at the end of a phased run.

The goal is to provide a complete review handoff that can be given to a human reviewer or to a review agent.

This spec stays at the functional level.

---

# 1. Goal

At the end of a PHAX run, PHAX should generate a final review document that aggregates what happened across all phases.

This document should make it easy to understand:

```txt
what each phase did
which files were expected
which files were actually changed
which planned files were not changed
which unplanned files were changed
what the agent justified in each phase
what needs attention during review
```

The final document should be generated deterministically.

It should not require an LLM.

---

# 2. Core artifact

The final artifact should be named:

```txt
review-handoff.md
```

Purpose:

```txt
A final handoff document for review.
```

It is not a “review map”.

It does not decide what the reviewer should inspect.

It gives the reviewer a structured state of the run before review begins.

---

# 3. Required per-phase artifacts

Each phase should produce or already have:

```txt
phase-handoff.md
file-reconciliation.md
file-reconciliation.json
```

If `file-reconciliation.json` does not already exist, this feature should add it.

## 3.1 `phase-handoff.md`

This is the phase-level narrative handoff.

It should explain:

```txt
what was completed
important decisions
current repository state
files changed
invariants to preserve
risks or open points
instructions or warnings for later phases/review
justifications for unplanned file changes
```

The final phase must also produce a `phase-handoff.md`.

The handoff is not only for the next phase.

It is also a phase closure artifact.

## 3.2 `file-reconciliation.md`

This is the human-readable reconciliation for one phase.

It should show:

```txt
planned files
actual files touched
matched planned changes
missing planned changes
unplanned created/modified/deleted files
justification status
```

## 3.3 `file-reconciliation.json`

This is the structured version used by PHAX for deterministic aggregation.

It should contain the same reconciliation data in a machine-readable format.

PHAX should use the JSON version for global aggregation.

PHAX should not parse Markdown to compute global reconciliation.

---

# 4. Global artifacts

At the end of the run, PHAX should generate:

```txt
global-file-reconciliation.md
review-handoff.md
```

Optionally, PHAX may also generate:

```txt
global-file-reconciliation.json
```

if useful for later tooling.

---

# 5. `global-file-reconciliation.md`

This document aggregates all per-phase `file-reconciliation.json` files.

It should deduplicate files across phases.

A file touched in multiple phases should appear once in the global view.

Recommended information per file:

```txt
file path
planned phases
actual touched phases
expected actions
actual actions
final status
whether it was planned
whether it was unplanned
whether it was missing
whether it had extra touches
whether justifications exist
review attention level
```

Example statuses:

```txt
matched
missing
unplanned
extra-touch
partially-matched
deleted
renamed
unknown
```

Example table:

```md
| File | Planned in | Touched in | Status | Notes |
|---|---|---|---|---|
| src/run.ts | phase-01 | phase-01, phase-03 | extra-touch | touched again later |
| src/codex.ts | phase-02 | phase-02 | matched | expected |
| README.md | phase-04 | — | missing | planned but not touched |
| src/tmp.ts | — | phase-03 | unplanned | justified in phase handoff |
```

---

# 6. `review-handoff.md`

`review-handoff.md` should be the final aggregated review entrypoint.

It should contain:

```txt
run summary
global file reconciliation
global unplanned changes
global missing planned changes
phase-by-phase handoffs
phase-by-phase file reconciliations
review attention points
```

Recommended structure:

```md
# Run Review Handoff

## Run summary

## Global file reconciliation

## Global unplanned changes

## Global missing planned changes

## Global review attention points

## Phase details

### Phase 01 — <title>

#### File reconciliation

#### Phase handoff

### Phase 02 — <title>

#### File reconciliation

#### Phase handoff
```

The phase details section should concatenate, for each phase:

```txt
file-reconciliation.md
phase-handoff.md
```

PHAX may add headings to make the final document readable.

PHAX should not rewrite the handoffs with an LLM.

---

# 7. Deterministic generation

The final review handoff must be deterministic.

It should be generated from:

```txt
run metadata
phase metadata
phase-handoff.md
file-reconciliation.md
file-reconciliation.json
```

No LLM should be required to generate:

```txt
global-file-reconciliation.md
review-handoff.md
```

If a required phase artifact is missing, PHAX should report it clearly.

It should not silently invent content.

---

# 8. Missing artifacts

If a phase is missing `phase-handoff.md`, PHAX should mark the phase as incomplete for review handoff generation.

If a phase is missing `file-reconciliation.json`, PHAX should either:

```txt
generate it from deterministic run data if possible
```

or:

```txt
fail the review handoff generation with a clear message
```

PHAX should not parse `file-reconciliation.md` as the main source of truth unless there is no alternative and the user explicitly requests a recovery mode.

---

# 9. Final phase handoff

The final phase must produce a `phase-handoff.md`.

Previously, handoff generation may have been treated as useful only before starting the next phase.

This should change.

Every completed phase, including the last one, should have:

```txt
phase-handoff.md
file-reconciliation.md
file-reconciliation.json
```

Reason:

```txt
The final phase still needs to explain what it did, what changed, and what should be reviewed.
```

---

# 10. Review use case

The intended review workflow is:

```txt
PHAX run completes
  → PHAX generates global-file-reconciliation.md
  → PHAX generates review-handoff.md
  → user gives review-handoff.md to a reviewer agent or human reviewer
  → reviewer uses it as the run-level state of the work
```

This document should make review easier without replacing review.

It should not claim that the work is correct.

It should only provide structured evidence of what happened.

---

# 11. Relationship with review map

This feature is different from a future `review-map`.

```txt
review-handoff.md
  → what happened during the run
  → deterministic aggregation
  → state transfer to review

review-map
  → how to review the PR
  → may include review strategy
  → may be generated later by an agent
```

The review handoff should exist before any review map.

# 12. Commands

PHAX should support a command to generate or regenerate the review handoff.

Recommended command:

```bash
phax review-handoff <run-name>
```

It should be safe to run multiple times.

It should regenerate:

```txt
global-file-reconciliation.md
review-handoff.md
```

If the run is incomplete, PHAX should either fail or generate a clearly marked partial review handoff.

Recommended option:

```bash
phax review-handoff <run-name> --allow-partial
```

---

# 13. Default generation timing

PHAX should generate the review handoff automatically when a run reaches final review state.

Recommended flow:

```txt
final phase gates pass
  → final phase-handoff.md generated
  → final file-reconciliation.md/json generated
  → global-file-reconciliation.md generated
  → review-handoff.md generated
  → run enters review_open
```

If generation fails, the run should not pretend review preparation is complete.

---

# 14. Acceptance criteria

This feature is complete when:

1. Every phase, including the final phase, has a `phase-handoff.md`.
2. Every phase has a human-readable `file-reconciliation.md`.
3. Every phase has or generates a structured `file-reconciliation.json`.
4. PHAX does not rely on Markdown parsing for global file aggregation.
5. PHAX generates `global-file-reconciliation.md`.
6. PHAX deduplicates files touched across multiple phases.
7. PHAX identifies files that were planned and touched.
8. PHAX identifies files that were planned but not touched.
9. PHAX identifies files that were touched but not planned.
10. PHAX identifies files touched in more phases than expected.
11. PHAX surfaces missing justifications for unplanned changes.
12. PHAX generates `review-handoff.md`.
13. `review-handoff.md` includes a global summary.
14. `review-handoff.md` includes global file reconciliation.
15. `review-handoff.md` includes phase-by-phase handoffs.
16. `review-handoff.md` includes phase-by-phase file reconciliations.
17. `review-handoff.md` is generated deterministically without an LLM.
18. The generation command is idempotent.
19. A missing artifact produces a clear diagnostic.
20. The final review state uses `review-handoff.md` as the main review entrypoint.

---

# 15. Product summary

PHAX should end every successful run with a review-ready handoff.

The final reviewer should not have to inspect every phase directory manually.

PHAX should aggregate the important evidence into:

```txt
global-file-reconciliation.md
review-handoff.md
```

The core principle is:

```txt
Phase artifacts explain local work.
Review handoff explains the whole run.
```
