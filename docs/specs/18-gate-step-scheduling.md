---
status: Approved
date: "2026-08-21 (revised against the shipped spec 15: firing is shipped, closure comes from a
  registered scope provider; original 2026-07-03)"
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---
# Gate Step Scheduling from the Plan

## 1. Context

Since v0.10 (spec 15) every gate step declares a `firing`: `every-phase` steps run at each phase
gate, `terminal` steps only at the run's last phase. That already lets an operator defer an
expensive or completion-only check to the end of the run. The **External Gate Steps** spec adds
diagnostic steps whose findings arrive as individual diagnostics; today every diagnostic fails
its step.

`phax-plan.json` records, per ordered phase, the files the phase is planned to create and edit.
Each phase gate evaluates the cumulative worktree, so a gate at phase N sees everything phases
1..N built. phax already registers one orient provider in `phax.json` (spec 17) — a command it
runs with a JSON request on stdin and a JSON response on stdout.

## 2. Problem

Firing is **per step**, but validity is **per diagnostic**. One audit run returns findings that
are not all valid at the same time: an *invariant* (a forbidden dependency) must never appear, at
any phase; a *completion* finding (a required wiring a later phase is planned to add) is only a
true failure once the work that should provide it has landed. With firing alone the operator
must choose between running the auditor every phase — and red-flagging legitimate in-progress
work — or running it terminal-only, catching a missing wiring only in a final fix-up, far from
the phase that owned it. phax has no signal, derived from the plan, for *when* a unit of the
codebase is complete.

## 3. Product goal

Each diagnostic declares whether it is an **invariant** or a **completion** check bound to one or
more opaque **scope tokens**. A registered **scope provider**, given phax's thin projection of the
plan, tells phax which scopes are **closed** at the current phase. phax fails a phase for a
completion diagnostic only once every scope it names is closed; otherwise it records the
diagnostic as **pending**. Invariants fail at every phase; the terminal phase closes every scope.

> A gate step's red is always a true red — phax never fails a phase for work a later phase is
> planned to complete.

## 4. Terminology

- **Invariant diagnostic** — must hold at every phase; fails on sight.
- **Completion diagnostic** — meaningful only once its scopes are closed; names one or more scope
  tokens (one for a finding confined to a scope, two when the missing piece lives in another).
- **Scope token** — an opaque provider-defined identifier. phax never maps files to scopes.
- **Scope provider** — the registered command phax asks, per phase, which scopes are closed.
- **Plan projection** — what phax hands the scope provider: the ordered phase ids with their
  planned files, and the id of the phase being gated. Nothing else from the plan crosses.
- **Closed scope** — a scope no later phase is planned to touch. The terminal phase closes every
  scope.
- **Pending** — a completion diagnostic with at least one open scope: recorded, not failing.

## 5. Functional requirements

### 5.1 Diagnostic classification

THE system SHALL require each diagnostic of a diagnostic step to declare a class of `invariant`
or `completion`.

WHERE a diagnostic is a completion diagnostic THE system SHALL require it to name at least one
scope token, and SHALL reject a completion diagnostic with none at decode.

### 5.2 Scope provider

WHERE a scope provider is registered THE system SHALL, before evaluating a phase gate that has a
diagnostic step, request the closed scope set from the provider with the plan projection for the
phase being gated.

WHILE the phase being gated is the run's terminal phase THE system SHALL treat every scope as
closed without consulting the provider.

IF a diagnostic step returns a completion diagnostic and no scope provider is registered THEN the
system SHALL fail the step as a configuration error naming the missing provider.

IF the scope provider exits non-zero or returns an undecodable response THEN the system SHALL
fail the gate as a provider error, naming the provider.

### 5.3 Pending versus failing

WHEN an invariant diagnostic is present THE system SHALL fail the step.

WHEN every scope a completion diagnostic names is closed THE system SHALL fail the step.

WHILE any scope a completion diagnostic names is open THE system SHALL record the diagnostic as
pending and SHALL NOT fail the step for it.

### 5.4 Pending in the fix loop and the record

WHEN a step fails with both failing and pending diagnostics THE system SHALL hand the fix loop
only the failing ones and SHALL list the pending ones as context the agent must not act on.

WHEN a step has only pending diagnostics THE system SHALL record the step's result as `pending`
in the phase attribution record, and SHALL NOT count the step's surface as verified for that
phase.

WHEN a phase gate completes THE system SHALL persist the pending diagnostics with the attempt so
they are readable after the run.

## 6. Surface

Diagnostic (from the External Gate Steps spec) gains `class` and, on completion diagnostics, a
non-empty `scopes` list. The two-class vocabulary and the all-scopes-closed rule are
**normative**; field spellings **indicative**:

```json
{ "diagnostics": [
  { "rule": "TS_BOUNDARY_001", "class": "invariant",
    "location": { "file": "apps/web/src/core/user.ts", "line": 12 },
    "message": "core must not import web",
    "repair": "docs/skills/scope-boundaries.md" },
  { "rule": "REQUIRED_WIRING_002", "class": "completion", "scopes": ["core", "adapters"],
    "location": { "file": "apps/web/src/core/billing/port.ts", "line": 1 },
    "message": "billing port has no adapter yet",
    "repair": "docs/skills/required-wiring.md" }
] }
```

Scope provider registration in `phax.json`, next to `orient` (that one provider registers is
**normative**; key spelling **indicative**):

```json
"orient": { "command": "steme orient --json" },
"scopes": { "command": "steme scopes --json" }
```

Request on the provider's stdin — the plan projection (the three pieces of content are
**normative**: ordered phase ids, each phase's planned files, the gated phase; spelling
**indicative**):

```json
{ "phase": "phase-02",
  "phases": [
    { "id": "phase-01", "files": ["apps/web/src/core/billing/port.ts"] },
    { "id": "phase-02", "files": ["apps/web/src/core/billing/invoice.ts"] },
    { "id": "phase-03", "files": ["apps/web/src/adapters/billing/stripe.ts"] } ] }
```

Response on stdout (closed-token list **normative**; spelling **indicative**):

```json
{ "closed": ["core"] }
```

Phase gate summary with a pending diagnostic (distinct-from-failure **normative**; rendering
**indicative**):

    gate: green — 1 completion diagnostic pending (scopes still open: adapters)

Attribution record, third result value (presence **normative**; spelling **indicative**):

```json
{ "command": "steme audit --json", "surface": "structural", "result": "pending" }
```

Configuration error (exit non-zero and naming the missing key **normative**; wording
**indicative**):

    ✗ gate step "steme audit --json" returned a completion diagnostic but no "scopes"
      provider is registered in phax.json

No new command. No visual UI — no design annex.

## 7. Non-goals

- The **mapping of files to scopes** and the **content** of the audit — the provider's. phax hands
  over a projection and enforces the answer; it never computes closure itself.
- The diagnostic step mechanism and the fix-loop contract — the **External Gate Steps** spec.
- **Incremental** execution and live / production-trace checks.
- **Deferring a scope to a future run** — every scope the run opens is closed by the terminal
  phase. A future spec may add an explicit deferral.
- **Plan-time advisory** that a plan opens a scope it never closes — the **Plan Completeness
  Advisory** spec (19), which reuses the same projection.

## 8. Acceptance criteria

### Invariant fails at every phase

Given an invariant diagnostic, when any phase gate runs, then the step fails regardless of the
provider's closed set. (refs §5.1, §5.3)

### Completion is pending while a scope is open

Given a completion diagnostic naming `["core", "adapters"]` and a provider answering
`closed: ["core"]`, when a non-terminal phase gate runs, then the step records `pending`, the
phase is not failed for it, and the pending diagnostic is persisted with the attempt.
(refs §5.3, §5.4)

### Completion fails once all its scopes are closed

Given the same diagnostic and a provider answering `closed: ["core", "adapters"]`, when the phase
gate runs, then the step fails and the fix prompt carries that diagnostic. (refs §5.2, §5.3)

### Terminal phase closes every scope

Given a completion diagnostic still pending before the terminal phase, when the terminal phase
gate runs, then the step fails if the diagnostic persists and the provider is not consulted.
(refs §5.2, §5.3)

### Provider receives the projection

Given a run of three phases gated at phase-02, when the provider is invoked, then its stdin is
the ordered phases with their planned files and the gated phase id, and nothing else from the
plan. (refs §5.2)

### Missing provider is a configuration error

Given a completion diagnostic and no `scopes` provider, when the gate runs, then the step fails
naming the missing provider. (refs §5.2)

### Pending never verifies the surface

Given a step whose only diagnostics are pending, when the phase record is read, then the step's
result is `pending` and the step's surface is not among the phase's `verifiedSurfaces`.
(refs §5.4)

### Mixed findings split

Given one failing invariant and one pending completion diagnostic from the same step, when the
fix loop opens, then the prompt asks to fix the invariant only and lists the pending one as not
to be acted on. (refs §5.4)

## 9. Open questions for implementation planning

All resolved by the recommended default (revision of 2026-08-21):

- **How closure is supplied.**
  - phax computes closure from a provider-supplied file→scope map over the plan — abandons the
    provider's freedom to define closure (steme's doctrine treats `files → scopes` as its own
    oracle and may refine it).
  - Provider answers closure from a plan projection phax pushes (orient-style registered
    command) — abandons a self-contained diagnostic step: a second command is registered.
  - Diagnostic step itself receives the projection and emits `pending` — abandons phax's
    enforcement: phax would trust the provider's verdict instead of applying the rule.

  Recommendation: registered scope provider fed with the projection — it mirrors the orient
  contract already shipped and keeps enforcement in phax, mapping in the provider.
- **One scope or many per diagnostic.** A list. A finding whose missing piece lives in another
  scope is true only when both are closed; a single token cannot say that.
- **Deferral to a future run.** Out of scope; terminal closes all.

## 10. Implementation-planning note

Settled: class per diagnostic; `scopes` list on completion diagnostics; a registered scope
provider queried per gated phase with the thin plan projection (ordered phases + planned files +
gated phase id); terminal closes all without a query; invariant-always / completion-when-all-closed
/ pending-otherwise; `pending` as a third attribution result that does not verify a surface;
pending findings persisted and shown to the agent as context only. Depends on the **External Gate
Steps** spec. Constraint: **phax stays generic** — scope tokens are opaque, the projection carries
no model/effort/prompt/commit data, and phax encodes no "obligation" or "scope" meaning; the
provider lowers its semantics onto this vocabulary. Per phax schema policy the provider response
and the extended diagnostic are decoded at the boundary; a completion diagnostic without scopes is
rejected, not defaulted.
