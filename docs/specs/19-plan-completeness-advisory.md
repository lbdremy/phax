---
status: Approved
date: "2026-08-21 (re-approved against main 7b64e98: projection shape shared with the scope provider of spec 18;
  original approval 2026-07-03)"
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---
# Plan-Completeness Advisory

## 1. Context

phax authors a plan before a run: an ordered sequence of phases, each touching a set of files,
captured in `phax-plan.json`. An external auditor may know relationships between parts of a
codebase that the plan implicitly commits to — for example, that introducing one kind of file
requires a later, corresponding file elsewhere.

The plan is a **prediction**, not a contract: implementation may deviate, and the run's gate is the
hard check: the **Gate Step Scheduling** spec (18) fails a completion diagnostic once every scope
it names is closed, and the terminal phase closes all. That spec already hands a registered scope
provider a **plan projection** — the ordered phases with their planned files — on stdin, the
same way the shipped orient provider (spec 17) is driven. phax registers such providers as
top-level `{ "command": … }` entries in `phax.json`.

## 2. Problem

A plan can open a cross-part requirement in an early phase (build one side of a required
connection) that **no later phase satisfies** (the other side is never touched). Nothing surfaces
this until the run reaches its end and the terminal gate fails — after the expensive execution has
already run. The gap is knowable from the plan alone, before any code is written, but phax exposes
no plan-level channel for an external auditor to say so.

## 3. Product goal

After a plan is drafted, phax submits a **projection** of it — the ordered phases and each phase's
touched files, and nothing else — to a registered external **plan auditor**, and surfaces the
auditor's findings to the planning agent as **advisory** feedback, before execution. The check
never blocks planning or the run; hardness stays with the terminal gate.

> Plan-completeness is advice to the planner, not a gate — the plan may deviate or defer, and the
> terminal gate remains the hard check.

## 4. Terminology

- **Plan projection** — the reduced view of `phax-plan.json` the auditor receives: ordered phases,
  each with its touched files. Everything else (models, effort, prompts, commit metadata) is
  withheld. It is the **same projection shape** the scope provider of spec 18 receives, minus the
  gated-phase id (there is no phase being gated at plan time).
- **Plan auditor** — a registered external consumer of the plan projection that returns findings.
- **Advisory finding** — a non-blocking observation surfaced to the planning agent (e.g. an opened
  cross-part requirement with no later phase to satisfy it).

## 5. Functional requirements

### 5.1 Projection handoff

WHEN a plan is drafted THE system SHALL provide the registered plan auditor a projection consisting
only of the ordered phases and each phase's touched files.

### 5.2 Advisory feedback

WHEN the plan auditor returns findings THE system SHALL surface them to the planning agent as
advisory feedback before execution begins.

### 5.3 Non-blocking

THE system SHALL NOT block, reject, or halt planning or execution on the basis of plan-auditor
findings.

### 5.4 Absent auditor

IF no plan auditor is registered THEN THE system SHALL proceed with planning unchanged.

### 5.5 Projection is minimal

THE system SHALL withhold from the plan auditor every plan field other than the ordered phases and
their touched files.

## 6. Surface

Registration — the operator registers one plan auditor in `phax.json`, top-level next to the
`orient` and `scopes` providers (that it registers as its own command is normative; key spelling
and command form **indicative**):

```json
"orient":      { "command": "steme orient --json" },
"scopes":      { "command": "steme scopes --json" },
"planAuditor": { "command": "steme audit-plan --json" }
```

Projection — what the auditor receives on stdin, derived from `phax-plan.json`'s per-phase
`plannedFilesToCreate` / `plannedFilesToEdit` (transport normative: stdin JSON request, stdout JSON
response, as for `orient` and `scopes`). Ordered phases and their files, nothing else, is
**normative** (§5.1, §5.5); field spellings **indicative** but SHALL match whatever spelling the
scope provider's projection (spec 18) settles on — one projection, two consumers. Withheld
(normative): `model`, `effort`, prompts and plan anchors, commit metadata:

```json
{ "phases": [
  { "id": "phase-01", "files": ["src/core/billing/invoice.ts", "src/core/billing/ports.ts"] },
  { "id": "phase-02", "files": ["src/webRpc/billing.ts"] }
] }
```

Findings — returned by the auditor, surfaced to the planning agent in the planning session and
persisted alongside the plan (per §9 defaults). The advisory posture is **normative**; field
spellings, surfacing and artifact form **indicative**:

```json
{ "findings": [
  { "message": "phase-01 opens a billing capability; no later phase touches src/webhooks/**",
    "phases": ["phase-01"] }
] }
```

No new command — the handoff fires at plan finalization inside the existing planning flow (per §9
default).

No visual UI — no design annex.

## 7. Non-goals

- The **content** of the check — what relationships exist, what counts as a hole — is the auditor's
  concern, not phax's.
- **Blocking or gating** on plan findings — the scope-closure and terminal gate of spec 18 is the
  only hard check; this channel is advisory by construction.
- **Merging** the plan auditor into the scope provider — they share the projection, not the
  command; a project may register one without the other.
- **Deferring a part to a future run** as an explicit, tracked decision — noted as a future
  concern, not specified here.
- Auditing anything **beyond the projection** (prompts, model choice, phase internals).

## 8. Acceptance criteria

### Auditor receives only the projection

Given a drafted plan and a registered plan auditor, when phax hands off the plan, then the auditor
receives the ordered phases and touched files and no other plan field. (refs §5.1, §5.5)

### Findings reach the planner as advice

Given a plan whose phase sequence opens a requirement no later phase satisfies, when the auditor
returns that finding, then phax surfaces it to the planning agent before execution. (refs §5.2)

### Findings never block

Given plan-auditor findings, when planning proceeds, then neither planning nor the run is blocked
by them. (refs §5.3)

### No auditor is transparent

Given no registered plan auditor, when a plan is drafted, then planning proceeds unchanged. (refs §5.4)

## 9. Open questions for implementation planning

All questions are **resolved by adopting the recommended default** (review of 2026-07-10):

- **When the handoff fires.** At plan finalization only, or also on plan edits. *Default:* on plan
  finalization, before the run starts.
- **How findings are surfaced.** Inline in the planning session vs a written artifact the planner
  reads. *Default:* surface in the planning session; persist alongside the plan for traceability.

## 10. Implementation-planning note

Settled: the minimal projection, the strictly advisory and non-blocking posture, and transparent
behavior when no auditor is registered. Left open: handoff timing and surfacing form (§9).
Constraint: **phax stays generic** — it exposes the plan projection and a findings channel; the
auditor supplies all meaning. The projection is the one defined with spec 18's scope provider
(ordered phases + planned files); plan it as a single shared shape, not two. This channel must not
acquire teeth; the hard completeness check remains the scope-closure / terminal gate of spec 18.
