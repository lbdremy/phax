---
status: Archived
date: "2026-08-10 (revised: `Abandoned` terminal state; original 2026-08-09)"
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---
# Artifact Lifecycle Status for Specs and Plans

## 1. Context

phax's runs and phases already live under state-machine discipline: an explicit state set,
transitions only through dedicated functions, states persisted and validated. The two
artifacts *upstream* of a run do not.

Specs under `docs/specs/` carry a prose `Status: Draft | Approved | Archived` line by
convention (see the spec skill), enforced by nothing — phax never reads it. Plans under
`docs/plans/` carry no status at all: a `plan.md` is handed to `phax run --plan`, and
nothing distinguishes a draft the author is still editing from a plan a human has approved
for execution. Archival is a directory move (`docs/specs/archive/`) with no link to the
status line, so the two can silently disagree.

A follow-up spec — **staleness & lineage** — will make phax detect when a completed run or
an edited spec invalidates other plans. That spec needs a state to move an invalidated plan
*into*. The state vocabulary is therefore designed here, jointly, so the enum does not have
to be extended one spec later.

## 2. Problem

The `Draft → Approved` gate is where all the quality lives — for specs today it is prose
convention, and for plans it does not exist. Concretely: `phax run` will happily execute a
half-written plan; nothing records that a human ever approved what ran; a spec marked
`Archived` can sit outside `archive/` (and vice versa) with no detection; and there is no
state that can represent "this plan was approved, but the world changed underneath it".
Nor is there a state that distinguishes work that ran from work that was dropped: the only
terminal state is `Archived`, so an abandoned plan and a completed one become
indistinguishable forever. The lifecycle exists in people's heads and in skill prose, not
in the system.

## 3. Product goal

Specs and plans join the state-machine family: every spec and plan carries a required
lifecycle status drawn from an explicit per-artifact state set, transitions follow a fixed
legal set, and phax enforces the one gate that matters — **only an Approved plan can run**.
The plan state set reserves `Stale` so the staleness & lineage spec can populate its
triggers without changing the vocabulary. Both kinds carry two distinct terminal states:
`Archived` means the artifact completed its purpose (a spec was consumed, a plan ran);
`Abandoned` means it was dropped without that completion.

> An artifact's lifecycle is data phax enforces, not prose a human remembers.

## 4. Terminology

- **Artifact** — in this spec: a spec file under `docs/specs/` or a plan file under
  `docs/plans/` (including their `archive/` subdirectories). Runs are not artifacts here.
- **Lifecycle status** — the single required state carried by an artifact, drawn from that
  artifact kind's state set.
- **Transition** — a change of lifecycle status. Legal transitions are enumerated per
  artifact kind; everything else is illegal.
- **Consumption** — the moment phax reads an artifact to act on it (for a plan: starting a
  run from it).
- **Archive location** — the `archive/` subdirectory of the artifact's home directory.

## 5. Functional requirements

### 5.1 Required status

Every spec and plan artifact SHALL carry a lifecycle status.

IF a plan is consumed and carries no lifecycle status THEN the system SHALL refuse the
consumption with a message naming the missing status. (No back-compat: absence is an
error, never treated as an implicit default.)

### 5.2 Explicit per-artifact state sets

The system SHALL accept exactly the state set `Draft, Approved, Abandoned, Archived` for
specs.

The system SHALL accept exactly the state set `Draft, Approved, Stale, Abandoned,
Archived` for plans.

IF an artifact carries a status outside its kind's state set THEN the system SHALL reject
the artifact with a message naming the allowed set.

### 5.3 Legal transitions

WHEN a transition is requested THE system SHALL apply it only if it is in the legal set
for the artifact kind:

- Spec: `Draft → Approved`, `Draft → Abandoned`, `Approved → Abandoned`,
  `Approved → Archived`.
- Plan: `Draft → Approved`, `Draft → Abandoned`, `Approved → Approved` (re-approval — a
  status no-op that refreshes the approval record; record semantics belong to the
  staleness & lineage spec), `Approved → Stale`, `Approved → Abandoned`,
  `Approved → Archived`, `Stale → Approved` (false-positive override: a human reviewed the
  stale verdict and the plan still holds), `Stale → Draft`, `Stale → Abandoned`,
  `Stale → Archived`.

`Abandoned` and `Archived` are terminal for both kinds: no transition leaves them.

IF a requested transition is not in the legal set THEN the system SHALL refuse it and name
the legal transitions from the artifact's current status.

### 5.4 Run gating

WHEN a run is started from a plan THE system SHALL refuse to start unless the plan's
lifecycle status is `Approved`.

IF the plan's status is `Stale` THEN the refusal SHALL state that the plan is stale —
distinct from the `Draft` refusal — so the operator knows re-planning, not approval, is
the remedy.

IF the plan's status is a terminal one (`Abandoned`, `Archived`) THEN the refusal SHALL
state that the plan is retired — distinct from the `Draft` and `Stale` refusals — so the
operator knows no transition can make this plan runnable again.

The system SHALL NOT gate plan extraction on lifecycle status (previewing a draft's
extraction stays free; only running is gated).

### 5.5 Status and location agree

IF an artifact's status is terminal (`Abandoned`, `Archived`) and the file is outside its
archive location, or the file is inside its archive location with a non-terminal status,
THEN validation of that artifact SHALL fail naming the disagreement.

WHEN a transition to a terminal status is applied through phax THE system SHALL move the
artifact file to its archive location as part of the transition.

### 5.6 Status inspection

WHEN asked for an artifact's status THE system SHALL report the artifact kind, current
status, and the legal transitions from it.

## 6. Surface

Spec header, before → after — the line already exists by convention; its grammar and
vocabulary become **normative** (exact strings `Draft`, `Approved`, `Archived`):

```markdown
Status: Approved        →        Status: Approved     (unchanged, now enforced)
```

Plan header, before → after — plans gain the same line. Presence and vocabulary
(`Draft`, `Approved`, `Stale`, `Abandoned`, `Archived`) **normative**; position within the
header region **indicative**:

```markdown
# Migrate to TypeScript 7 — implementation plan          # Migrate to TypeScript 7 — implementation plan
                                                    →
> Feed this `plan.md` to `phax extract-plan` …           Status: Approved
                                                         > Feed this `plan.md` to `phax extract-plan` …
```

Run refusal on a non-approved plan (refusal, non-zero exit, and naming the status
**normative** per §5.4; wording and exit code value **indicative**):

```
✗ run refused: plan "45-typescript-7-migration-plan.md" is Draft — only an Approved plan can run
$? = 1

✗ run refused: plan "32-billing-plan.md" is Stale — re-plan it (its ground changed), then re-approve
$? = 1
```

Transition and inspection commands (that dedicated commands exist for transition and
inspection is **normative** per §5.3/§5.6; spelling, grouping, and flags **indicative**):

```
phax artifact status  docs/plans/45-typescript-7-migration-plan.md
phax artifact approve docs/plans/45-typescript-7-migration-plan.md
phax artifact archive docs/specs/21-artifact-lifecycle-status.md      # also moves the file to archive/
phax artifact abandon docs/plans/45-typescript-7-migration-plan.md    # dropped without execution; also moves to archive/
phax artifact reopen  docs/plans/32-billing-plan.md                   # Stale → Draft
```

No visual UI — no design annex.

## 7. Non-goals

- **Automatic entry into `Stale`** — which events (a dependency run landing, a source spec
  edit) flip an Approved plan to Stale, and the lineage records that make that computable,
  belong to the staleness & lineage spec. Here `Stale` is reachable manually only.
- **Content-quality gating of approval** — whether a spec or plan is *good enough* to
  approve stays human judgment; phax validates structure, never content.
- **Enforcing the spec → plan chain** — refusing to run a plan whose source spec is not
  Approved requires recorded lineage; deferred to the staleness & lineage spec. Plans
  without any source spec remain legitimate.
- **Run lifecycle changes** — `RunState`/`PhaseState` are untouched.
- **Derived spec views** — regenerating a readable spec from tests is a separate concern.
- **Preventing hand-edits** — artifacts are files in a repo; a human can always edit the
  status line. Enforcement is at consumption and transition time, not at edit time.

## 8. Acceptance criteria

### A plan without status cannot run

Given a plan file carrying no `Status:` line, when a run is started from it, then the run
is refused with a non-zero exit and a message naming the missing status. (refs §5.1)

### Unknown states are rejected per artifact kind

Given a spec whose status line reads `Status: Stale`, when the spec is validated, then
validation fails naming the allowed set `Draft, Approved, Abandoned, Archived`. (refs §5.2)

### Illegal transitions are refused with the legal set

Given a plan with status `Draft`, when a transition to `Stale` is requested, then it is
refused and the response names `Draft → Approved` and `Draft → Abandoned` as the only
legal transitions. (refs §5.3)

### Only an Approved plan runs

Given a plan with status `Draft`, when a run is started from it, then the run is refused
naming the status; and given the same plan with status `Approved`, when a run is started,
then the run proceeds. (refs §5.4)

### Stale refusal is distinct

Given a plan with status `Stale`, when a run is started from it, then the refusal states
the plan is stale and is distinguishable from the Draft refusal. (refs §5.4)

### Extraction is not gated

Given a plan with status `Draft`, when plan extraction is invoked on it, then extraction
proceeds. (refs §5.4)

### Archival moves the file

Given an Approved spec under `docs/specs/`, when a transition to `Archived` is applied
through phax, then the file's status reads `Archived` and the file now lives under
`docs/specs/archive/`. (refs §5.3, §5.5)

### Abandonment is terminal and moves the file

Given an Approved plan under `docs/plans/`, when a transition to `Abandoned` is applied
through phax, then the file's status reads `Abandoned`, the file now lives under
`docs/plans/archive/`, and any further transition request on it is refused. (refs §5.3,
§5.5)

### A retired plan does not run

Given a plan with status `Abandoned`, when a run is started from it, then the refusal
states the plan is retired and is distinguishable from the `Draft` and `Stale` refusals.
(refs §5.4)

### Status/location disagreement fails validation

Given a spec file under `docs/specs/archive/` whose status reads `Approved`, when the
artifact is validated, then validation fails naming the disagreement. (refs §5.5)

### Status is inspectable

Given an Approved plan, when its status is asked for, then the report names the kind
`plan`, the status `Approved`, and the legal transitions `Approved`, `Stale`, `Abandoned`,
`Archived`. (refs §5.6)

## 9. Open questions for implementation planning

All questions are **resolved by adopting the recommended default** (review of 2026-08-09):

Question: where does the status live?

- In-file header line — abandons: machine-exclusive control (a human can hand-edit the
  line to any state, bypassing transition legality until the next validation).
- Sidecar metadata file — abandons: single-file readability and the existing convention
  (the status becomes invisible in the document itself, and file + sidecar can drift).

Recommendation: in-file header line — the hand-edit loss is acceptable because every
consumption re-validates (§5.1–§5.2, §5.5), while sidecar drift would be a *silent* loss;
and it keeps five existing specs' convention as the contract.

Question: is `Stale` reachable from `Draft`?

- Reachable — abandons: the clean invariant that staleness invalidates an *approval*; a
  draft under active editing would be perpetually re-flagged by its own moving ground.
- Approved-only — abandons: a signal on in-progress drafts whose source spec shifted
  underneath them.

Recommendation: approved-only — a draft's author is already in the file; the signal they
would get is noise, and the invariant "Stale means: an approval whose ground moved" is
what the staleness spec builds on.

Question: does the approve transition validate the document body?

- Structural only (status line grammar, location agreement) — abandons: catching a
  malformed or empty document at the approval gesture.
- Content checks (e.g. plan extractability) at approve time — abandons: the clean
  separation between lifecycle and content; approval would fail for reasons unrelated to
  the human's judgment.

Recommendation: structural only — extraction and the run pipeline already validate content
at the moment it matters; duplicating it at approve time couples two concerns.

Question (added in the revision of 2026-08-10, resolved by adoption): how does dropped
work terminate?

- Reuse `Archived` for dropped artifacts — abandons: an honest terminal state; "ran to
  completion" and "dropped without execution" become permanently indistinguishable in the
  artifact record.
- Add a terminal `Abandoned` to both state sets — abandons: the previously frozen
  four-state vocabulary; acceptable only because nothing is implemented yet.

Recommendation (adopted): `Abandoned` on both kinds — the distinction is exactly the kind
of fact this spec exists to make data instead of memory, and the extension also closes a
dead end: a dropped `Draft` spec previously had no legal exit at all.

## 10. Implementation-planning note

Settled: both state sets (including `Stale` for plans and `Abandoned` for both kinds —
the vocabulary is fixed here and the staleness & lineage spec must not extend it), the
legal-transition tables with two terminal states, run gating on `Approved` with distinct
`Stale` and retired refusals, archive-location agreement for both terminal statuses, and
in-file status per the §9 default.

Left open (deliberately): command spelling/grouping (§6 indicative blocks), exit-code
values, and the exact header position of the plan status line.

Constraints the plan must respect: statuses are decoded through a schema before entering
the domain, and transitions go through dedicated domain functions — the same discipline as
`RunState`/`PhaseState`. No back-compat: existing live plans gain their `Status:` line by
a one-time mechanical edit inside this feature's rollout (a migration, not a shim); after
that, absence is an error per §5.1. The follow-up staleness & lineage spec will consume
this one: it defines *when* phax flips `Approved → Stale` automatically (dependency run
landed, source spec edited), the lineage records that make it computable, and the
spec ↔ plan chain rules (source-spec declarations, approve/retirement guards) that build
on the terminal statuses defined here — nothing in this spec should preclude those
triggers and guards being system-initiated rather than operator-typed.
