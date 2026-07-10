# External Gate Steps

Status: Approved

Date: 2026-07-03

Audience: implementation planning with Claude Code

Scope: functional behavior and consumption surface

## 1. Context

phax runs each phase in its own cumulative worktree, stacked on the previous phase, and evaluates a
**gate** after the phase completes. Gate failures open a same-session fix loop that re-runs until
the gate is green or the budget is spent. The gate steps are today a fixed, built-in set
(typecheck / test / lint / build), selected by a coarse depth choice.

Because each phase's worktree is stacked on the previous, the worktree at phase N contains the
accumulated code of phases 1..N, plus everything already merged.

## 2. Problem

The gate set is closed. A tool that verifies **architecture** — that boundaries hold and required
wirings exist, not merely that the code compiles and tests pass — cannot register as a gate step
and drive the existing fix loop. Structural findings therefore have no repair path inside a run:
they are invisible to the gate that already knows how to fail, retry, and re-verify.

## 3. Product goal

phax accepts **external gate steps** whose structured findings feed the existing same-session fix
loop, run against the phase's cumulative worktree. From phax's point of view an external structural
failure has the same shape as a failing test — a failure with a repair pointer — so it drops into
the loop with no new machinery.

> An external audit is just another gate — a structural failure repairs through the same loop as a
> failing test.

## 4. Terminology

- **Gate step** — a command phax runs as part of a phase's gate; built-in or external.
- **External gate step** — a registered, non-built-in gate command (e.g. an architecture auditor).
- **Diagnostic** — a structured finding a gate step returns: a failure with a location and a repair
  pointer, consumable by the fix loop.
- **Cumulative worktree** — the phase's worktree, containing the accumulated code of all phases so
  far.

## 5. Functional requirements

### 5.1 Registration and execution

WHEN an external gate step is registered THE system SHALL run it as part of every phase's gate.

IF no external gate step is registered THEN THE system SHALL run the gate with its built-in steps
only, unchanged.

### 5.2 Fix-loop integration

WHEN an external gate step returns failing diagnostics THE system SHALL feed them into the
same-session fix loop identically to a built-in gate failure.

### 5.3 Cumulative worktree

THE system SHALL run external gate steps against the phase's cumulative worktree — the accumulated
code of all phases so far.

### 5.4 Failure semantics

WHEN an external gate step reports any failing diagnostic THE system SHALL fail the phase gate.

## 6. Surface

An external step registers as one more step in the gate profile (the Gate Profile spec's step
object), its command being the external tool. That it registers through the profile is
**normative**; whether a marker field distinguishes it from a built-in step is **indicative**:

```json
"gateProfiles": {
  "standard": [
    { "command": "pnpm typecheck",               "surface": "local",      "firing": "every-phase" },
    { "command": "steme audit apps/web --json",  "surface": "structural", "firing": "every-phase" }
  ]
}
```

Today the fix loop consumes a built-in gate failure as command + exit code + log
(`GateFailed { command, exitCode, logPath }`) and the fix agent reads the log. An external step
additionally emits structured diagnostics — each a failure with a location and a repair pointer,
per §9 default the same information shape the fix loop already consumes. The location + repair
pointer content is **normative**; the exact field spellings **indicative**, pinned by planning:

```json
{ "diagnostics": [
  { "rule": "TS_BOUNDARY_001",
    "location": { "file": "apps/web/src/core/user.ts", "line": 12 },
    "message": "core must not import web",
    "repair": "skills/scope-boundaries.md" }
] }
```

No new command or output form — external failures surface through the existing gate and fix-loop
reporting unchanged.

No visual UI — no design annex.

## 7. Non-goals

- The **content** of the audit — which rules exist, what they mean — is the external provider's
  concern, not phax's.
- **Repair** beyond feeding diagnostics to the existing fix loop (the provider supplies repair
  guidance; phax owns the loop mechanics).
- **Conditional scheduling** — treating some diagnostics as valid only at completion, and holding
  others as pending — is deliberately excluded here; in this spec every external diagnostic is a
  hard failure. Scheduling is a separate spec.
- **Incremental** (changed-files-only) execution — a whole-worktree pass is acceptable.
- The **orient/brief** channel and the **plan-completeness** advisory — separate specs.

## 8. Acceptance criteria

### External audit feeds the fix loop

Given a registered external gate step that returns a failing diagnostic, when a phase gate runs,
then phax fails the phase and the diagnostic enters the same-session fix loop. (refs §5.1, §5.2, §5.4)

### Runs against the cumulative worktree

Given a phase 2 stacked on phase 1, when the external gate step runs, then it sees code introduced
in phase 1. (refs §5.3)

### Any failing diagnostic fails the phase

Given an external gate step that returns one failing diagnostic, when the gate runs, then the phase
gate is red. (refs §5.4)

### No external step is transparent

Given no registered external gate step, when a phase gate runs, then the gate behaves as it does
today with built-in steps only. (refs §5.1)

## 9. Open questions for implementation planning

All questions are **resolved by adopting the recommended default** (review of 2026-07-10):

- **Ordering of built-in vs external steps in one fix loop.** *Default:* run the built-in
  mechanical gate first, external steps after, within a single fix loop.
- **Diagnostic shape the fix loop consumes.** *Default:* the same shape as a built-in gate failure
  (a location plus a repair pointer); the provider emits that shape.

## 10. Implementation-planning note

Settled: external steps run in every phase's gate, feed the existing fix loop, run against the
cumulative worktree, and hard-fail on any diagnostic. Left open: step ordering and the exact
diagnostic shape (§9). Depends on the **Gate Profile as Attributed Steps** spec, which defines the
profile model an external step registers into (and which removes the depth scalar). Constraint:
**phax stays generic** — it encodes no audit semantics; the provider supplies all meaning.
Follow-on: conditional scheduling of external diagnostics (invariant vs completion, plan-derived
scope closure, pending) is the **Gate Step Scheduling** spec.
