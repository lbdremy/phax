---
name: phax-spec
description: Write or review a spec under docs/specs/ that the phax-planning skill will turn into a plan.md — functional behavior only, EARS requirements, testable acceptance criteria, lifecycle and traceability.
---

# phax spec skill

Use this skill when you are asked to write or review a **spec** — the artifact under
`docs/specs/` that captures _what_ a change must do and _why_, before any planning or code.

A phax spec is the **input spec**: it exists to be consumed once — by the phax planning skill
to produce a `plan.md`, and by the executing agents to write tests — then it is archived. The
durable source of truth after that is the code and its tests, never a spec file kept in sync
by hand.

## Where the spec sits in the phax pipeline

```
spec (this skill)  →  plan.md (phax-planning)  →  phax-plan.json (extract-plan)  →  phax run (gates + reconciliation)
   what & why            how, decomposed              structured tasks                 executable enforcement
```

A spec is **functional behavior only**: the _what_ and the _why_, never the _how_. Technology
choices, file layout, module names, and phase decomposition belong to the plan, not the spec.
If you find yourself naming functions or sketching code, you have left the spec layer.

## Lifecycle

Every spec carries a status that moves in one direction:

```
Draft  →  Approved  →  Archived
```

- **Draft** — under authoring; ambiguities still open; not yet eligible for planning.
- **Approved** — the human approval gate has passed: scope is bounded, requirements are
  unambiguous, acceptance criteria are testable. Only an Approved spec should be planned.
- **Archived** — consumed. The spec has produced a plan and tests; it moves to
  `docs/specs/archive/`. From here on, code + tests are the source of truth. A readable spec
  _view_ can be regenerated from the tests on demand — it is a derived report, not a file to
  maintain.

Record the status in the header block (below) and keep it accurate.

## File and naming convention

- One feature = one spec file: `docs/specs/NN-<slug>.md` (`NN` zero-padded, `<slug>`
  lowercase-and-hyphens). The plan it produces mirrors the name: `docs/plans/NN-<slug>-plan.md`.
- Keep a spec to **1–3 pages**. If it grows past that, the feature is too big — split it into
  separate specs. A bounded spec is what makes the `Draft → Approved` gate meaningful.

## Canonical spec structure

Start every spec with this header block, then the nine numbered sections. This is the shape
phax specs converge on; follow it so specs stop drifting.

```markdown
# <Title>

Status: Draft | Approved | Archived

Date: YYYY-MM-DD

Audience: implementation planning with <agent>

Scope: functional behavior only

## 1. Context

<The situation today. What exists, what the reader needs to know to understand the change.
Quote the relevant config/artifact/behavior. No problem statement yet — just the ground.>

## 2. Problem

<What is wrong or missing. Why the current state is unacceptable. Concrete, specific, and
honest — the problem motivates every requirement below.>

## 3. Product goal

<The change, stated as outcome (what & why), not solution (how). Close with a guiding rule
as a blockquote — the single principle a reader can hold the whole spec against.>

> <One-sentence guiding rule.>

## 4. Terminology

<Define every domain term the spec uses unambiguously. A reader and an agent must read each
term the same way. Omit only if the spec introduces no terms worth pinning.>

## 5. Functional requirements

<The behavioral contract, as numbered subsections (§5.1, §5.2, …). Each requirement is an
EARS statement (see EARS below). Behavior only — no technology, no file names, no code.>

### 5.1 <Requirement title>

<EARS requirement, e.g.> WHEN the user submits an invalid config THE system SHALL reject it
with an actionable message naming the offending field.

## 6. Non-goals

<What is explicitly NOT in scope. Bounds the agent's exploration and the plan's surface.
A spec without Non-goals is unbounded — always write this section.>

## 7. Acceptance criteria

<Testable Given/When/Then criteria, one per meaningful behavior, each tracing back to a §5
requirement. These are the seed of the E2E tests the plan will produce (see Traceability).>

### <Criterion name>

Given <precondition>, when <action>, then <observable outcome>. (refs §5.1)

## 8. Open questions for implementation planning

<Ambiguities you could not resolve, with a recommended default for each. This is the Clarify
gate: surface every unknown here rather than letting the planner guess. Resolve or default
each before marking the spec Approved.>

## 9. Implementation-planning note

<The handoff to phax-planning: what is settled, what is deliberately left open, and any
constraint the plan must respect. Keep it to the contract — do not start planning here.>
```

## EARS — required for every functional requirement

Every requirement in §5 must follow one of the five EARS (Easy Approach to Requirements
Syntax) patterns. EARS forces each requirement to be atomic and testable — one trigger, one
behavior — which is exactly what makes the acceptance criteria and tests fall out cleanly.

| Pattern          | Template                           | Example                                                               |
| ---------------- | ---------------------------------- | --------------------------------------------------------------------- |
| Ubiquitous       | The system **shall** …             | The system **shall** record the applied security posture per phase.   |
| Event-driven     | **WHEN** … **THE system SHALL** …  | **WHEN** a gate fails THE system SHALL open a same-session fix loop.  |
| State-driven     | **WHILE** … **THE system SHALL** … | **WHILE** a run is rate-limited THE system SHALL show the reset time. |
| Unwanted         | **IF** … **THEN** …                | **IF** a required command is unallowed THEN the preflight SHALL fail. |
| Optional feature | **WHERE** … **THE system SHALL** … | **WHERE** publish is enabled THE system SHALL open a pull request.    |

Rules:

- One requirement = one EARS sentence. If you need "and also", split it into two requirements.
- The subject is the system (phax) or a named component — never "we" or "the developer".
- State the **observable** behavior, not the mechanism. `WHEN config is invalid THE system
SHALL reject it` — not `THE system SHALL call validateConfig()`.
- Group related EARS requirements under a titled `### 5.N` subsection.

## Acceptance criteria and traceability

Acceptance criteria are the contract made executable. Treat them as the **specification of the
E2E tests** the plan will write.

- Write each criterion in **Given / When / Then** form, against observable behavior.
- Every criterion **traces back** to a §5 requirement with a `(refs §5.N)` citation. Every §5
  requirement should be covered by at least one criterion — an uncovered requirement is either
  untestable (rewrite it) or unowned (add a criterion).
- The plan that consumes this spec **cites these criteria and §5 requirements** in its phases
  (`refs spec §5.2, AC "…"`), and the agents turn the criteria into E2E tests. This is the
  chain that lets the spec be archived safely: the behavior now lives in tests, and a spec
  _view_ can be decompiled from those tests later. The original intent/rationale that does not
  fit a test (perf budget, security posture, UX feel) lives in the spec's Context/Product goal
  and, after archival, in commits/PRs — not in a maintained spec file.

## Doctrine

- **What, not how.** Functional requirements describe behavior. The moment a requirement names
  a function, a module, a library, or a phase order, it has crossed into the plan's territory —
  move it to the Implementation-planning note as a constraint, or drop it.
- **One feature, one spec, 1–3 pages.** Bounded scope is what makes approval meaningful and
  keeps the agent's exploration tight.
- **Every behavior is gate- or test-verifiable.** If an acceptance criterion cannot be checked
  by a test or a gate, the requirement is too vague — sharpen it until it can.
- **No back-compat shims in persisted behavior.** Consistent with phax's schema policy: new
  fields/behaviors are required, removed ones are removed (rejected at validation), not retained
  as ignored-optional. Say so in the spec when it applies.
- **Explicit over permissive.** Prefer per-variant enums and named cases over a permissive
  superset that admits nonsense combinations. Specify the exact allowed set.
- **The spec is spent fuel.** It is consumed once to produce the plan and the tests, then
  archived. Do not design it to be maintained alongside the code.

## Anti-patterns to avoid

- **Over-specification.** "When a spec becomes pseudo-code, you've written the program twice."
  If a requirement reads like an implementation, it is in the wrong layer.
- **Implementation detail in §5.** File names, function signatures, module paths, phase
  ordering — all belong to the plan, not the spec.
- **Untestable acceptance criteria.** "The system should be fast/robust/intuitive" — restate
  as an observable, checkable outcome or cut it.
- **Missing Non-goals.** An unbounded spec invites scope creep in the plan and the run.
- **Unresolved ambiguity smuggled into §5.** Ambiguities go in §8 (Open questions) with a
  recommended default — never hidden as a vague requirement.
- **False confidence.** Matching a wrong spec satisfies no real requirement. The value is the
  thinking done while writing the spec, not the document itself — interrogate the problem.
- **Free-floating requirements.** A §5 requirement with no acceptance criterion, or a criterion
  with no `refs §`, breaks the traceability chain that lets the spec be archived.

## Reviewing a spec

When asked to review rather than write, check, in order:

1. **Layer** — is anything in §5 actually _how_ (implementation)? Move or cut it.
2. **EARS** — does every §5 requirement follow a pattern, atomically?
3. **Coverage** — does every §5 requirement have an acceptance criterion, and does every
   criterion `refs §`?
4. **Bounds** — are Non-goals present and honest? Is the spec ≤ 3 pages?
5. **Clarity gate** — are all §8 open questions resolved or defaulted before `Approved`?
6. **Testability** — could an agent turn every acceptance criterion into a passing test
   without inventing intent the spec did not state?

## Example well-formed slice

```markdown
# Push Branch and Create Pull Request

Status: Approved

Date: 2026-06-12

Audience: implementation planning with Claude Code

Scope: functional behavior only

## 3. Product goal

phax must be able to publish a finished run: push the run's branch and open a pull request
whose body is the run review handoff, so review happens on GitHub, not in the terminal.

> phax never publishes a run that has not passed its gates.

## 5. Functional requirements

### 5.1 Publish gating

WHEN a run has completed with all gates green THE system SHALL make the run eligible to publish.

### 5.2 Pull request creation

WHERE publishing is enabled THE system SHALL push the run branch and open a pull request whose
body is the run review handoff.

### 5.3 Idempotency

IF a pull request already exists for the run branch THEN the system SHALL update it rather than
open a duplicate.

## 7. Acceptance criteria

### Gates gate publishing

Given a run with a red gate, when publish is invoked, then the system refuses and names the
failing gate. (refs §5.1)

### PR carries the handoff

Given a completed green run with publishing enabled, when publish runs, then a pull request
exists whose body is the run review handoff. (refs §5.2)

### Re-publish is idempotent

Given a run already published, when publish runs again, then the existing pull request is
updated and no duplicate is created. (refs §5.3)
```
