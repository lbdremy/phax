---
status: Approved
date: "2026-08-21 (revised against the shipped spec 15: shrunk to diagnostic-emitting steps;
  original 2026-07-03)"
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---
# External Gate Steps — Structured Diagnostics

## 1. Context

Since v0.10 (spec 15, plan 44) a gate profile is a named list of attributed steps. Each step is a
command carrying a `surface` (`local | structural | product`, closed enum) and a `firing`
(`every-phase | terminal`). Steps run in profile order against the phase's cumulative worktree
(stacked on every previous phase); the first non-zero exit fails the gate, its full log is written
to the attempt log, and the same-session fix loop hands the agent the **failed command, the exit
code and the raw log**. Per-phase attribution (`gate-attribution.json`) records each step's
command, surface and `pass | fail`, and the run record manifest names the phase's
`verifiedSurfaces`.

This means an external tool — an architecture auditor such as `steme audit` — **already registers**
as a gate step today: list it in the profile with `surface: "structural"`, and its exit code
drives the loop. The registration, ordering, firing and cumulative-worktree concerns of the
original spec 16 are shipped and are not re-specified here.

## 2. Problem

What an external auditor feeds the fix loop is an **opaque log**. A structural finding is richer
than that — it names a rule, a location, and a repair pointer (the guide that says how to fix it)
— but the gate flattens it into stdout text the agent must parse by eye. The fix loop cannot tell
one finding from another, cannot point the agent at the repair guide, and nothing downstream
(reporting, the scheduling spec) can reason about individual findings, because from phax's point
of view there are none — only a red command.

## 3. Product goal

A gate step may declare that it **emits structured diagnostics**. For such a step phax reads a
diagnostics document from the step's output, takes the gate verdict from that document, and feeds
each diagnostic — rule, location, message, repair pointer — into the same-session fix loop in
place of a raw log. Everything else about the step (registration, surface, firing, attribution,
cumulative worktree) is unchanged from spec 15.

> A structural failure repairs through the same loop as a failing test — but it arrives as
> findings, not as a log to be read.

## 4. Terminology

- **Gate step** — one command in a gate profile (spec 15). There is no built-in/external
  distinction in phax; every step is a command.
- **Diagnostic step** — a gate step that declares it emits a diagnostics document.
- **Diagnostics document** — the structured output of a diagnostic step: a list of diagnostics.
- **Diagnostic** — one finding: a rule identifier, a location, a message, and a repair pointer.
- **Repair pointer** — a worktree-relative path to the guide the agent should read to repair the
  finding. Opaque to phax.

## 5. Functional requirements

### 5.1 Declaring a diagnostic step

THE system SHALL let a gate step declare that it emits a diagnostics document.

IF a step does not declare it THEN the system SHALL treat the step exactly as today: exit code is
the verdict, the log is what the fix loop sees.

### 5.2 Verdict from the document

WHEN a diagnostic step completes THE system SHALL decode its diagnostics document and SHALL take
the gate verdict from the document: an empty diagnostics list passes the step, a non-empty list
fails it.

IF a diagnostic step produces no decodable diagnostics document (regardless of its exit code)
THEN the system SHALL fail the step as a provider error, naming the step and the decode failure.

### 5.3 Fix-loop integration

WHEN a diagnostic step fails THE system SHALL hand the fix loop the step's diagnostics —
each with its rule, location, message and repair pointer — and SHALL instruct the agent to read
each repair pointer before repairing.

THE system SHALL otherwise drive the fix loop identically for a diagnostic step and a plain step
(same attempts, same budget, same re-verification).

### 5.4 Attribution and records

WHEN a diagnostic step runs THE system SHALL record it in the phase attribution record with the
same command / surface / result fields as any other step.

WHEN a diagnostic step fails THE system SHALL persist its diagnostics document alongside the
attempt log so the findings are readable after the run.

## 6. Surface

`phax.json`, a profile step **before → after**. That a step opts in through a field on the step
object is **normative**; the field's spelling and value (`"output": "diagnostics"`) **indicative**:

```json
{ "command": "steme audit --json", "surface": "structural", "firing": "every-phase" }
```
→
```json
{ "command": "steme audit --json", "surface": "structural", "firing": "every-phase",
  "output": "diagnostics" }
```

Diagnostics document, read from the step's stdout (transport **normative**: stdout, JSON). The
four fields per diagnostic and the empty-list-passes rule are **normative**; field spellings
**indicative**:

```json
{ "diagnostics": [
  { "rule": "TS_BOUNDARY_001",
    "location": { "file": "apps/web/src/core/user.ts", "line": 12 },
    "message": "core must not import web",
    "repair": "docs/skills/scope-boundaries.md" }
] }
```

Fix prompt, what replaces the raw-log block for a diagnostic step (presence of each diagnostic and
of the read-the-pointer instruction **normative**; wording **indicative**):

    # Gate checks failed — fix required
    **Failed step:** `steme audit --json` (1 diagnostic)

    ## Diagnostics
    - TS_BOUNDARY_001 at apps/web/src/core/user.ts:12 — core must not import web
      repair guide: docs/skills/scope-boundaries.md

    ## Required action
    Read each repair guide above before changing code, then fix every diagnostic …

Provider error, when the document is missing or malformed (exit non-zero and step named
**normative**; wording **indicative**):

    ✗ gate step "steme audit --json" declared diagnostics output but returned none:
      invalid JSON at position 0

Persisted next to the attempt log (presence **normative**; name **indicative**):
`checks-attempt-01.diagnostics.json`. Attribution record and `verifiedSurfaces` unchanged.

No new command. No visual UI — no design annex.

## 7. Non-goals

- The **content** of the audit — which rules exist, what a repair guide says — is the provider's.
- **Registration, ordering, firing, cumulative worktree** — shipped by spec 15; not re-specified.
- **Inlining** repair guides into the prompt — phax names the pointer; the agent reads it in the
  worktree.
- **Per-diagnostic scheduling** (invariant vs completion, pending) — the **Gate Step Scheduling**
  spec. Here every diagnostic fails the step.
- **Incremental** (changed-files-only) execution.

## 8. Acceptance criteria

### Diagnostics feed the fix loop

Given a diagnostic step that emits one diagnostic, when the phase gate runs, then the phase gate
is red and the fix prompt lists that diagnostic's rule, location, message and repair pointer and
instructs the agent to read the pointer. (refs §5.2, §5.3)

### Empty document passes

Given a diagnostic step that emits an empty diagnostics list with a non-zero exit code, when the
gate runs, then the step passes. (refs §5.2)

### Missing document is a provider error

Given a diagnostic step that exits 0 with non-JSON stdout, when the gate runs, then the step fails
naming the step and the decode failure. (refs §5.2)

### Plain steps are untouched

Given a profile with no diagnostic step, when a gate fails, then the fix prompt carries the raw
log exactly as before. (refs §5.1)

### Attribution and persistence

Given a failed diagnostic step, when the phase's attribution record and attempt directory are
read, then the record lists the step with `result: "fail"` and its surface, and the diagnostics
document is persisted next to the attempt log. (refs §5.4)

## 9. Open questions for implementation planning

All resolved by the recommended default (revision of 2026-08-21):

- **How phax knows a step emits diagnostics.**
  - Explicit field on the step — abandons zero-config detection.
  - Sniff stdout for a document — abandons explicitness: a tool that happens to print JSON
    silently changes gate semantics.

  Recommendation: explicit field — the profile is the place where a step's contract is declared.
- **Exit code vs document.** For a diagnostic step the document is the verdict; the exit code is
  ignored when a valid document is present (auditors conventionally exit 1 on findings). A
  missing document is a provider error whatever the exit code.
- **Repair pointer handling.** Name it; do not inline. The agent works inside the worktree and can
  read the file; inlining would make phax guess at size and relevance.

## 10. Implementation-planning note

Settled: opt-in per step; document on stdout is the verdict; diagnostics replace the raw log in
the fix prompt with an explicit read-the-pointer instruction; provider error on a missing
document; attribution unchanged; document persisted with the attempt log. Constraint: **phax stays
generic** — it encodes no audit semantics; rule ids and repair pointers are opaque strings. Per
phax schema policy the diagnostics document is decoded through a schema at the boundary; an
unknown field on the step object is rejected as today. Follow-on: the **Gate Step Scheduling**
spec adds a class and scope list to each diagnostic and a `pending` outcome.
