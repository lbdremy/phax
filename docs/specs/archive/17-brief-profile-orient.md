---
status: Archived
date: 2026-07-03
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---
# Brief Profile — Orientation Fed Forward into a Phase

## 1. Context

phax dispatches each phase by handing its agent a prompt. `phax-plan.json` records, per phase, the
files the phase is planned to touch. Today the prompt carries no orientation about *what the
project already knows* concerning those files — conventions, boundaries, required patterns.

phax already has a corrective leg: the gate runs after a phase and its failures drive a
same-session fix loop.

## 2. Problem

The only structural feedback is corrective — it fires *after* the agent has written code. There is
no preventive channel that arms the agent, *before* it writes, with the constraints already known
for the files it is about to touch. As a result the fix loop burns iterations rediscovering
conventions the system could have supplied up front, and mispredicted or undocumented files get no
guidance at all.

## 3. Product goal

phax computes, for each phase, a **brief** from a registered external **orient provider**, keyed by
the phase's planned files, and weaves it into the phase prompt. The brief is an **index** the agent
can expand on demand, and the agent may also pull orientation for files the plan did not predict.
The channel is purely advisory: it arms the agent, it never gates.

> The brief arms the agent; it never jails it — the gate remains the only leg with teeth.

## 4. Terminology

- **Orient provider** — a registered external source of orientation, keyed by file paths.
- **Brief** — the orientation for a phase: an **index** of rows, not full prose.
- **Index row** — one entry with at least an identifier, a title, a severity, and a trigger; enough
  for the agent to decide whether to expand it.
- **Push (compute)** — phax requesting the brief for a phase's planned files.
- **Pull (query)** — the agent requesting the full body of a row, or orientation for an arbitrary
  file, on demand.

## 5. Functional requirements

### 5.1 Compute and weave

WHEN a phase is dispatched THE system SHALL request a brief from the registered orient provider,
keyed by that phase's planned files, and include the returned index in the phase prompt.

### 5.2 Index, not content

THE system SHALL treat the brief as an index of rows and SHALL make each row's full body
retrievable on demand rather than embedding all bodies in the prompt.

### 5.3 Pull on demand

WHEN the agent requests a row's body during a phase THE system SHALL return the expanded body from
the provider.

WHEN the agent requests orientation for an arbitrary file THE system SHALL return an index for that
file from the provider.

### 5.4 Advisory only

THE system SHALL NOT fail, block, or retry a phase on the basis of the brief; the brief SHALL have
no gating effect.

### 5.5 Absent provider

IF no orient provider is registered THEN THE system SHALL dispatch the phase prompt unchanged.

### 5.6 Demand-without-supply signal

WHEN a pull returns no orientation THE system SHALL record that a request was made and nothing was
supplied.

## 6. Surface

Registration — the operator registers one orient provider in `phax.json` (that it registers is
normative; key spelling and command form **indicative**):

```json
"orient": { "command": "steme orient --json" }
```

Push — phax requests the index keyed by the phase's planned files and the provider returns rows.
The four-field row minimum (id, title, severity, trigger) is **normative**; field spellings and
transport **indicative**:

```json
{ "files": ["src/core/billing/invoice.ts", "src/webRpc/billing.ts"] }
```

```json
{ "rows": [
  { "id": "core-no-adapters",  "title": "core never imports adapters directly",
    "severity": "error", "trigger": "src/core/**" },
  { "id": "rpc-thin-surface",  "title": "webRpc stays a thin layer over capabilities",
    "severity": "info",  "trigger": "src/webRpc/**" }
] }
```

Woven into the phase prompt as an index only — row bodies never inline (**normative**; prompt
wording indicative):

    ## Orientation for this phase (expand a row before touching its files)
    - [error] core-no-adapters — core never imports adapters directly
    - [info]  rpc-thin-surface — webRpc stays a thin layer over capabilities

Pull — from inside a phase the agent expands a row or asks about an arbitrary file. The two
capabilities are **normative**; their concrete form (tool vs command, names below) **indicative**:

    phax orient core-no-adapters          →  the row's full body
    phax orient --file src/jobs/sync.ts   →  an index for that file

A pull that returns nothing is recorded as demand-without-supply in the run's existing
trajectory/telemetry stream (per §9 default; artifact shape **indicative**).

No visual UI — no design annex.

## 7. Non-goals

- The **content** of the brief — which rows exist, how relevance is decided, what a row says — is
  the provider's concern (e.g. a doctrine runtime), not phax's.
- **Ranking or truncating** the index — the index is returned as the provider supplies it.
- Any **gating** behavior — that belongs to the gate/fix-loop legs, not here.
- Turning pulled orientation into enforcement — orientation never becomes a contract.

## 8. Acceptance criteria

### Brief is woven from planned files

Given a phase with planned files and a registered orient provider, when the phase is dispatched,
then the phase prompt contains the provider's index for those files. (refs §5.1)

### Bodies load on demand

Given a brief index in the prompt, when the agent requests a row's body, then phax returns the
expanded body and the prompt did not contain that body up front. (refs §5.2, §5.3)

### Arbitrary-file pull returns an index

Given a file the plan did not predict, when the agent asks about it, then phax returns an index for
that file. (refs §5.3)

### Brief never gates

Given a phase whose agent ignored the brief, when the gate runs, then the phase's pass/fail is
unaffected by the brief. (refs §5.4)

### No provider is transparent

Given no registered orient provider, when a phase is dispatched, then the phase prompt is unchanged.
(refs §5.5)

### Empty pull is recorded

Given a pull that returns nothing, when it completes, then phax records the demand-without-supply
occurrence. (refs §5.6)

## 9. Open questions for implementation planning

Both questions are **resolved by adopting the recommended option** (review of 2026-07-10;
reframed by dominant loss 2026-07-22, resolutions unchanged):

**Row schema minimum.** Does the index row need a field beyond (id, title, severity, trigger)
for the agent to self-budget which bodies to expand?

- Four fields only — abandons: any signal for prioritizing expansions before pulling; a wrong
  guess costs a pull round-trip inside the phase.
- Add a budgeting hint (e.g. body size) — abandons: the minimal provider contract; every
  provider must compute and maintain the hint, even where it is meaningless.

Recommendation: four fields — a mispredicted pull is a cheap, occasional, in-session cost,
while a widened provider contract is permanent; extend only if planning finds a concrete gap.

**Where the fed-forward brief and pulls are recorded.** Needed for later review-by-trajectory.

- Existing trajectory/telemetry stream — abandons: a directly queryable per-phase artifact;
  review-by-trajectory must filter the stream to reconstruct orientation traffic.
- Dedicated per-phase artifact — abandons: zero-new-schema simplicity; a new persisted,
  required schema (no back-compat shims) phax owns forever.

Recommendation: existing stream — stream filtering is a read-time cost paid occasionally at
review; a persisted schema is a write-time contract paid on every run.

## 10. Implementation-planning note

Settled: push-on-dispatch, index-not-content, pull-on-demand, and the strictly advisory posture.
Left open: the exact row schema and where fed-forward briefs/pulls are recorded (§9), and the
concrete form of the pull capability (in-session tool vs `phax orient` CLI command — §6 marks it
indicative). The pull-form choice is a plan-layer arbitration: the plan must surface it under its
Technical arbitrations gate, framing each option by its dominant loss, not decide it silently.
Constraint: **phax stays generic** — it defines the index row shape and the push/pull hooks; the
provider fills them. phax learns nothing about the provider's domain vocabulary.
