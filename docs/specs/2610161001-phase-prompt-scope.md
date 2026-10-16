---
status: Draft
date: 2026-10-16
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---

# Phase prompt scope — a phase reads its own part of the plan

## 1. Context

Before each phase turn, phax writes the phase's prompt to `phase-NN/prompt.md` in the run folder and passes it to the agent. The prompt carries, in order (`src/app/promptGeneration.ts`):

```
# Execute one implementation phase            (scope rules: "You must only execute the current phase", "Do not anticipate future phases …")
## Source intent/spec document               "(not provided — see human-readable plan below)"
## Human-readable approved plan              the whole plan.md: preamble and every phase's section
## Machine-readable execution plan           the whole extracted plan as JSON: run, and every phase
## Previous phase handoff
## Previous phase file reconciliation        (when there is a previous phase)
## Current phase                             the current phase as JSON
## Brief for this phase                      (when a brief provider is configured)
## Execution rules
## Required output                           ends: "sufficient for the next phase … using only: plan.md; phax-plan.json; the current phase definition; the previous phase-handoff.md"
```

The machine-readable plan repeats what the human-readable plan says (titles, models, efforts, file lists, commit messages); the current phase's JSON repeats its own entry once more. A fix attempt and the handoff generation resume the phase session, so they carry the same prompt in their context.

A plan is read by the deterministic parser, which splits it on `## phase-NN — <title> {#<anchor>}` headings; when that fails, phax extracts it with a model, and the plan.md may then have no such headings. Every phase entry carries a `planMarkdownAnchor`. A plan under `docs/plans/` is committed, so the phase worktree holds it; a loose plan.md given to `phax run` from elsewhere is only in the run folder, outside the worktree. phax already writes files the agent reads into the worktree's gitignored `.phax-context/` (`brief-request.json`).

Measured on this machine's 132 phase turns of the last 30 days (spike `spikes/plan-estimate/`): the median prompt is 69 kB, of which 47 kB (66 %) are the other phases' sections and the machine-readable plan; `artifact-decide`'s phase-04 prompt is 88 kB, its own section 9 kB. The prompt sits in the cached context the agent re-reads on every model call: the context at a phase's first call (median 56 k tokens) is 53 % of what each call reads. Removing that 66 % saves an estimated 7.8 % of phase-turn API-list cost ($33 of $426 over the 30 days; median $0.20 per phase), more on long phases.

## 2. Problem

Every phase pays, on every model call, for the instructions of phases it is told not to execute, twice over. The cost grows with the plan, not with the phase: a short documentation phase at the end of a four-phase plan carries the 80 kB of the three phases before it. It also works against the prompt's own rule — the agent is handed the detailed instructions of future phases and asked not to act on them.

## 3. Product goal

A phase's prompt carries the plan's shared preamble, its own section, and a one-line-per-phase outline of the others; the whole plan stays one file read away when the agent needs it.

> A phase reads in full only what it executes; the rest of the plan is in reach, not in context.

## 4. Terminology

- **Plan preamble** — everything in plan.md before the first phase section: title, required commands, technical arbitrations, and any open or arbitrated questions.
- **Phase section** — one phase's part of plan.md, from its `## phase-NN` heading to the next phase heading.
- **Plan outline** — one entry per phase of the plan: id, title, and its planned files to create and to edit.
- **Full plan** — plan.md as given to `phax run`.

## 5. Functional requirements

### 5.1 Own section only

WHEN phax builds a phase's prompt from a plan whose current phase section it can locate THE system SHALL include the plan preamble and the current phase section, and no other phase section.

### 5.2 No machine-readable plan

The system shall not include the machine-readable plan of the whole run in a phase's prompt.

### 5.3 Current phase definition kept

The system shall keep the current phase's definition (planned files, commit subject and body, model, effort) in the prompt.

### 5.4 Outline of the other phases

The system shall include the plan outline in a phase's prompt, marking the current phase.

### 5.5 Full plan in reach

WHEN phax prepares a phase worktree THE system SHALL write the full plan to `.phax-context/plan.md` and name that path in the prompt as where the rest of the plan can be read.

### 5.6 Section not found

IF phax cannot locate the current phase section in plan.md THEN the system SHALL include the full plan in the prompt, as today, and record that the phase ran with the full plan.

### 5.7 Handoff guidance matches the prompt

The system shall describe, in the prompt's handoff guidance, what the next phase will be given: the plan preamble, its own section, the plan outline, `.phax-context/plan.md`, its definition and the previous handoff.

### 5.8 Resumed sessions unchanged

The system shall leave the fix-attempt and handoff-generation prompts unchanged; they resume the phase session and inherit its prompt.

## 6. Surface

`phase-NN/prompt.md`, before → after (section headings normative where named below; order and the rest of the wording indicative):

Before (phase-04 of a four-phase plan, 88 kB):

```
# Execute one implementation phase
## Source intent/spec document
## Human-readable approved plan
  # Question model and document migration … ## Technical arbitrations …
  ## phase-01 — … ## phase-02 — … ## phase-03 — … ## phase-04 — …
## Machine-readable execution plan
  { "run": { … }, "phases": [ … four phases … ] }
## Previous phase handoff
## Previous phase file reconciliation
## Current phase
## Execution rules
## Required output
```

After (phase-04, ≈ 20 kB):

```
# Execute one implementation phase
## Approved plan: shared preamble
  # Question model and document migration … ## Technical arbitrations …
## Plan outline
  - phase-01 — Open and arbitrated questions in spec and plan documents
      create: src/schemas/questions.ts, …   edit: src/schemas/specDocument.ts, …
  - phase-02 — Render and report questions by id
      …
  - phase-03 — Migrate documents, and wait for it before approve and reopen
      …
  - phase-04 — README, skills and NEXT_STEPS for the question model   ← current phase
  The full plan is at .phax-context/plan.md; read it only when this phase needs another phase's detail.
## Approved plan: current phase
  ## phase-04 — README, skills and NEXT_STEPS for the question model …
## Previous phase handoff
## Previous phase file reconciliation
## Current phase
## Execution rules
## Required output
  … sufficient for the next phase to start in a fresh session using only: the plan preamble, its own section,
  the plan outline, .phax-context/plan.md, its phase definition and this handoff.
```

Normative: no `## Machine-readable execution plan` and no `## Human-readable approved plan` section; the sections `## Plan outline` and `## Approved plan: current phase` exist; the path `.phax-context/plan.md`. Indicative: the preamble heading's wording, the outline's line format.

Fallback (§5.6): the prompt keeps `## Human-readable approved plan` with the full plan and no `## Plan outline`, and the phase's `status.json` records `"planInPrompt": "full"` (`"scoped"` otherwise; key spelling indicative, values normative).

Worktree: `<worktree>/.phax-context/plan.md`, byte-identical to the run folder's `plan.md` (normative).

## 7. Non-goals

- Trimming the compliance review, code review, handoff-generation or fix-attempt prompts.
- Changing the plan.md format, the deterministic parser or the extraction.
- Changing the source-spec line (`## Source intent/spec document`) beyond what removing the full plan requires.
- Choosing models or efforts for phases; that is the other cost lever, for a later spec.
- A measured cost target as an acceptance criterion; the `cost-ledger` spec makes the saving observable.

## 8. Acceptance criteria

### A phase reads only its own section

Given a four-phase plan read by the deterministic parser, when phax builds phase-03's prompt, then the prompt contains the plan preamble and phase-03's section verbatim, and none of the `## phase-01`, `## phase-02` or `## phase-04` sections' detailed instructions. (refs §5.1)

### No machine-readable plan

Given any plan, when phax builds a phase's prompt, then the prompt has no `## Machine-readable execution plan` section and does not contain another phase's commit body. (refs §5.2)

### The definition is still there

Given phase-03 with planned files and a commit subject, when its prompt is built, then the `## Current phase` section carries those planned files, that commit subject and body, its model and effort. (refs §5.3)

### The outline names every phase

Given a four-phase plan, when phax builds phase-03's prompt, then `## Plan outline` lists phase-01 to phase-04 with their titles and planned files to create and edit, and marks phase-03 as current. (refs §5.4)

### The full plan is one read away

Given a run of a loose plan.md outside `docs/plans/`, when phase-02's worktree is prepared, then `.phax-context/plan.md` exists in the worktree, is byte-identical to the run folder's `plan.md`, and the prompt names `.phax-context/plan.md`. (refs §5.5)

### An unlocatable section falls back to the full plan

Given a plan extracted by the model whose plan.md has no `## phase-02` heading, when phax builds phase-02's prompt, then the prompt contains `## Human-readable approved plan` with the full plan and the phase's `status.json` records `"planInPrompt": "full"`. (refs §5.6)

### Handoff guidance names what the next phase gets

Given any phase, when its prompt is built, then the `## Required output` guidance names the plan preamble, its own section, the plan outline, `.phax-context/plan.md`, the phase definition and the previous handoff, and no longer names `phax-plan.json`. (refs §5.7)

### Resumed prompts are untouched

Given a phase whose gate fails once, when the fix attempt and the handoff generation run, then their prompts are byte-identical to what phax writes today for the same inputs. (refs §5.8)

## 9. Open questions for implementation planning

### Q1 — What the prompt keeps of the other phases

- A — nothing — abandons: knowing which files later phases own; the agent may build what a later phase plans, and only the file reconciliation notices, after the fact.
- B — an outline: id, title, planned files to create and edit — abandons: a few kilobytes per call, and a list the agent could mistake for an invitation.
- C — their full sections, as today — abandons: the saving this spec exists for.

Recommendation: B — the file lists are what keep a phase out of another's footprint, at about 2 kB against 47 kB.

### Q2 — How the full plan stays reachable

- A — write it to `.phax-context/plan.md` in every phase worktree — abandons: one more file phax writes per phase, and a full plan the agent may read eagerly, giving back part of the saving.
- B — name the plan's path in the repository when the worktree holds it, nothing otherwise — abandons: reach for a loose plan.md given from outside `docs/plans/`.

Recommendation: A — one rule for every plan; an eager read costs one read, not one per call.

### Q3 — A plan whose phase section cannot be located

- A — fall back to the full plan in the prompt and record it — abandons: the saving on model-extracted plans, and a single prompt shape.
- B — refuse to run the phase — abandons: running a plan phax already accepted, for a prompt optimisation.

Recommendation: A — a phase must not fail on a context-size optimisation; the record shows how often the fallback runs.

## 10. Implementation-planning note

Settled: the prompt keeps the preamble, the current section and an outline; the machine-readable whole-plan JSON goes; the current phase's JSON stays; the full plan is in `.phax-context/plan.md`; resumed sessions are unchanged. Left open: the outline's exact line format and the preamble heading's wording. Constraints: locate the current section with the same rule the deterministic parser uses (the phase id heading, `planMarkdownAnchor`), never with a model; `"planInPrompt"` is a required field of the `phase-status` format (today 0.20.0) at its new shape, with no optional fallback, and an older phase status is lifted through its frozen shape with `"full"` — every phase before this change ran with the full plan; the prompt snapshots in `tests/unit/__snapshots__/promptGeneration.test.ts.snap` and `tests/integration/__snapshots__/executePlan.test.ts.snap` change by design. After it ships, the `cost-ledger` history should show phase-turn cost per call falling; the spike's prompt-size measurement is the yardstick.

## 11. Docs page

None — the phase prompt is internal to a run; the change is visible in `phase-NN/prompt.md` and through `phax records explain`, which need no new page.
