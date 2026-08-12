---
status: Approved
date: 2026-07-03
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---
# Gate Step Scheduling from the Plan

## 1. Context

phax runs external gate steps whose diagnostics feed the same-session fix loop (see the **External
Gate Steps** spec). Each phase runs in a cumulative worktree stacked on the previous, and
`phax-plan.json` records, per phase, the files that phase is planned to touch.

Today every external diagnostic is a hard failure at every phase. This spec adds the missing
notion: *when* a diagnostic is valid in a phased run.

## 2. Problem

Structural findings are not all valid at the same time. Some are **invariants** — a forbidden
dependency must never appear, at any phase. Others only become true at **completion** — a required
wiring that a *later* phase is planned to add. Failing a completion check mid-feature is a **false
failure**: the work is simply not done yet. Without a way to schedule diagnostics, a run either
red-flags legitimate in-progress work or cannot run completion checks at all. phax also has no
signal, derived from the plan, for *when* a unit of the codebase is complete.

## 3. Product goal

Each external diagnostic declares whether it is an **invariant** or a **completion** check bound to
an opaque **scope token**. phax determines, from the plan, which scopes are **closed** at each
phase, and fails a phase for a completion diagnostic only once its scope is closed — otherwise it
records the diagnostic as **pending**. Invariants fail at every phase.

> A gate step's red is always a true red — phax never fails a phase for work a later phase is
> planned to complete.

## 4. Terminology

- **Invariant diagnostic** — a diagnostic that must hold at every phase.
- **Completion diagnostic** — a diagnostic meaningful only once its scope is complete; carries a
  scope token.
- **Scope token** — an opaque, provider-defined identifier grouping files. phax never interprets
  it; it only tracks which tokens are closed.
- **Scope closure (last touch)** — a scope is closed once the last planned phase that touches it
  has landed. The terminal phase closes every scope the run opened.
- **Pending** — a completion diagnostic whose scope is still open: recorded, not failing.

## 5. Functional requirements

### 5.1 Diagnostic classification

THE system SHALL require each external diagnostic to declare a class of either invariant or
completion.

WHERE a diagnostic is a completion diagnostic THE system SHALL require it to carry a scope token.

### 5.2 Scope closure from the plan

THE system SHALL determine, for each phase, the set of closed scope tokens, treating a scope as
closed once the last planned phase touching it has landed.

THE system SHALL treat the run's terminal phase as closing every scope the run opened.

### 5.3 Pending versus failing

WHEN an invariant diagnostic is present THE system SHALL fail the phase gate.

WHEN a completion diagnostic's scope token is closed THE system SHALL fail the phase gate.

WHILE a completion diagnostic's scope token is open THE system SHALL record the diagnostic as
pending and SHALL NOT fail the phase for it.

## 6. Surface

The diagnostic of the External Gate Steps spec gains a class and, on completion diagnostics, a
scope token. The two-class vocabulary (`invariant` | `completion`) and the token's opacity are
**normative**; the exact field spellings **indicative**:

```json
{ "diagnostics": [
  { "rule": "TS_BOUNDARY_001", "class": "invariant",
    "location": { "file": "apps/web/src/core/user.ts", "line": 12 },
    "message": "core must not import web",
    "repair": "skills/scope-boundaries.md" },
  { "rule": "REQUIRED_WIRING_002", "class": "completion", "scope": "billing",
    "location": { "file": "apps/web/src/core/billing/invoice.ts", "line": 1 },
    "message": "billing capability has no webhook handler yet",
    "repair": "skills/required-wiring.md" }
] }
```

Closed-scope supply — per §9 default the provider derives and supplies the closed set per phase
(that phax receives closed tokens is normative; the channel's form **indicative**):

```json
{ "phase": "phase-03", "closedScopes": ["billing"] }
```

A pending completion diagnostic is visible in the phase gate's record as recorded-not-failing,
distinct from a failure (presence normative; rendering **indicative**):

    gate: green — 1 completion diagnostic pending (scope "billing" still open)

No new command — scheduling acts inside the existing gate evaluation and reporting.

No visual UI — no design annex.

## 7. Non-goals

- The **content** of the audit and the **mapping of files to scopes** — the provider's concern;
  phax tracks closure and enforces the pending/failing rule, it does not compute scopes.
- The base mechanism of running external gate steps and feeding the fix loop — the **External Gate
  Steps** spec.
- **Incremental** execution and **live / production trace** checks — out of scope.
- Explicitly **deferring a scope to a future run** — noted as a future concern, not specified here.

## 8. Acceptance criteria

### Invariant fails at every phase

Given an invariant diagnostic, when any phase gate runs, then phax fails that phase regardless of
scope state. (refs §5.1, §5.3)

### Completion is pending while its scope is open

Given a completion diagnostic whose scope token is not yet closed, when the phase gate runs, then
phax records it as pending and does not fail the phase. (refs §5.3)

### Completion fails once its scope is closed

Given a completion diagnostic whose scope token becomes closed at the phase that last touches it,
when that phase gate runs, then phax fails the phase. (refs §5.2, §5.3)

### Terminal phase closes every scope

Given a completion diagnostic still pending before the terminal phase, when the terminal phase gate
runs, then its scope is treated as closed and phax fails if the diagnostic persists. (refs §5.2, §5.3)

## 9. Open questions for implementation planning

All questions are **resolved by adopting the recommended default** (review of 2026-07-10):

- **How closure is supplied.** phax may compute closed scopes from a provider-supplied file→scope
  mapping over the plan's per-phase files, or receive a per-phase closed-set directly from the
  provider. *Default:* the provider derives and supplies the per-phase closed scope tokens; phax
  only tracks and enforces them.
- **Explicit deferral of a scope to a future run.** *Default:* out of scope here — every scope the
  run opens is closed by the terminal phase.

## 10. Implementation-planning note

Settled: the invariant-always / completion-when-closed failing rule, pending for open scopes, and
the terminal phase closing all scopes. Left open: the closure-supply mechanism (§9). Depends on the
**External Gate Steps** spec. Constraint: **phax stays generic** — scope tokens are opaque and phax
encodes no audit semantics (no "prohibition", "obligation", or "scope" meaning); the provider
lowers its meaning onto phax's thin scheduling vocabulary.
