---
status: Archived
date: "2026-08-10 (revised: explicit source declarations and chain gates;
  original 2026-08-09)"
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---
# Plan Staleness & Lineage

## 1. Context

The artifact lifecycle spec (21) gives specs and plans an enforced status: plans carry a
`Stale` state, reachable — so far — only by hand, and both kinds carry a terminal
`Abandoned` distinct from `Archived`. What flips a plan stale in reality is never a
gesture; it is an event: the source spec was edited after the plan was approved, another
piece of work landed and changed files the plan intends to touch, or the plan file itself
was edited after its approval.

Spec 21 also deliberately left the spec ↔ plan *relationship* out: nothing declares which
spec a plan derives from, so nothing can enforce the chain. That connective tissue is
defined here.

phax already holds most of the raw material: extraction knows every plan's planned file
footprint, extraction is content-addressed (identical plan content re-extracts for free),
per-phase reconciliation records what a run actually changed, and the repository's own
history records what changed regardless of who changed it — a phax run, a teammate, or a
hand commit. What is missing is the record: nothing states what a plan derives from, and
nothing records what an approval was *given against*, so nothing can compute what an
event invalidates. Today phax either trusts a stale plan or the human re-examines
everything.

## 2. Problem

An approval is a judgment about a moment: *this plan, derived from that spec, against this
state of the repository*. phax records none of those three bindings. Consequently a plan
whose spec was rewritten, whose target files were reshaped by an intervening merge, or
whose own text was edited post-approval still reads `Approved` and runs without a warning.
Two chain holes compound it: a plan can be approved — and run — while its source spec is
still `Draft`, and a spec can be retired while plans derived from it are still live;
nothing even records which plans those are. The desktop direction ("dependents go stale →
re-plan only those") and safe multi-plan operation both presuppose exactly this detection,
and it does not exist.

## 3. Product goal

Lineage starts with an explicit declaration: every plan names its source spec, or
explicitly declares it has none — never implicitly. The chain is enforced at the two
gestures where it can break: approving a plan (its declared spec must be Approved) and
retiring a spec (its dependent plans must already be in a terminal status). On top of the
declaration, phax records, at plan approval, what the approval was given against — the
source spec's content, the plan's own content, and a repository baseline — and can
thereafter compute, for any Approved plan, whether that ground still holds. Staleness is
computed on demand and at run start, classified by explicit reasons, surfaced as a report,
and enforced at the one moment it matters: a plan whose ground moved does not run until a
human re-approves it.

> An approval binds a plan to the ground it was judged on; when the ground moves, the
> approval — not the plan — is what expires.

## 4. Terminology

- **Source-spec declaration** — the explicit statement carried by a plan naming the spec
  it derives from, or explicitly naming none. Never inferred.
- **Terminal status** — `Abandoned` or `Archived`, per the lifecycle spec (21).
- **Approval record** — the binding captured when a plan is approved: the plan's content
  fingerprint, the declared source spec's identity and content fingerprint (where the
  declaration names one), and the repository baseline.
- **Content fingerprint** — a stable digest of an artifact's content, excluding its
  phax-managed lifecycle metadata (so recording an approval does not disturb the
  fingerprint it records).
- **Repository baseline** — the repository state (a commit) the approval was judged
  against.
- **Footprint** — the union of a plan's planned files (create, edit, optional), as
  extraction reports them. File-level, deliberately coarse.
- **Staleness reason** — exactly one of: `spec-changed`, `ground-changed`, `self-changed`
  (§5.6). A stale verdict carries every reason that applies.
- **Fresh** — an Approved plan whose staleness computation returns no reason.

## 5. Functional requirements

### 5.1 Explicit source declaration

Every plan SHALL carry a source-spec declaration: either the identity of the spec it
derives from, or an explicit statement that it has none.

IF a plan is validated and carries no source-spec declaration THEN validation SHALL fail
naming the missing declaration. (No back-compat: absence is an error, never treated as
"no spec".)

### 5.2 Declaration validity

IF a plan's declaration names a spec that does not exist THEN validation of that plan
SHALL fail naming the dangling reference.

WHERE a plan explicitly declares no source spec THE system SHALL apply no chain rule to
it (a spec-less plan remains legitimate; `spec-changed` (§5.7) can never apply to it).

### 5.3 Plan approval requires an approved spec

WHEN a plan that declares a source spec is approved (including re-approval) THE system
SHALL refuse the approval unless the declared spec's status is `Approved`, naming the
spec and its current status.

### 5.4 Spec retirement requires terminal plans

WHEN a spec transitions to a terminal status THE system SHALL refuse the transition while
any plan declaring that spec as source is in a non-terminal status, naming each such plan
and its status.

The system SHALL NOT transition any plan as a side effect of a spec transition.

### 5.5 Approval captures the ground

WHEN a plan transitions to `Approved` (including re-approval) THE system SHALL record an
approval record binding the plan's content fingerprint, the declared source spec's
identity and content fingerprint where the declaration names one, and the repository
baseline.

### 5.6 Explicit reasons

WHEN staleness is computed for an Approved plan THE system SHALL report every reason that
applies, drawn from exactly: `spec-changed`, `ground-changed`, `self-changed`.

### 5.7 Spec-changed

IF the current content fingerprint of a plan's declared source spec differs from the one
in the approval record THEN staleness computation SHALL report the plan stale with reason
`spec-changed`.

### 5.8 Ground-changed

IF files changed in the repository since the approval baseline intersect the plan's
footprint THEN staleness computation SHALL report the plan stale with reason
`ground-changed`, naming the intersecting files. (This covers changes from any origin —
a landed phax run, a teammate's merge, a hand commit.)

### 5.9 Self-changed

IF the plan's current content fingerprint differs from the one in the approval record
THEN staleness computation SHALL report the plan stale with reason `self-changed`.

### 5.10 Staleness report

WHEN the operator requests the staleness report THE system SHALL report, for every
Approved plan, either `fresh` or its staleness reasons with their evidence.

### 5.11 Enforcement at run start

WHEN a run is started from an Approved plan THE system SHALL compute staleness first.

IF the plan is stale THEN the system SHALL refuse to start the run, naming each reason
and its evidence, and naming re-approval as the remedy.

### 5.12 Re-approval restores freshness

WHEN a stale-computed plan is re-approved THE system SHALL replace its approval record
(per §5.5) such that an immediately subsequent staleness computation reports it fresh.

### 5.13 Applying verdicts is a gesture

WHERE the operator applies the staleness report THE system SHALL transition each
stale-computed plan `Approved → Stale` through the lifecycle transitions of the artifact
lifecycle spec, recording the reasons.

The system SHALL NOT rewrite a plan's persisted status as a side effect of computing or
reporting staleness.

### 5.14 Missing record

IF an Approved plan carries no approval record THEN staleness computation SHALL report it
stale, naming the missing record. (No back-compat: plans approved before this feature are
stale by definition until re-approved.)

## 6. Surface

Plan header, before → after — the declaration is authored with the plan; the approval
stamp is recorded by `phax artifact approve`. The `Source-Spec:` line — presence and
grammar, path form and `(none)` form — is **normative**; the approval-stamp field names,
format, and whether fingerprints live here or in a sidecar are **indicative**:

```markdown
# Migrate billing — implementation plan        # Migrate billing — implementation plan

Status: Approved                               Status: Approved
                                          →    Source-Spec: docs/specs/32-billing.md
> Feed this `plan.md` to `phax extract-plan`   Approved: 2026-08-09 @ 3f2c9a1

                                               > Feed this `plan.md` to `phax extract-plan`
```

A plan without a spec declares it explicitly (**normative**):

```markdown
Source-Spec: (none)
```

Chain refusals (that approval and retirement are chain-gated is **normative** per
§5.3/§5.4; wording and exit codes **indicative**):

```
✗ approve refused: plan "32-billing-plan.md" declares "docs/specs/32-billing.md", which is Draft — approve the spec first
$? = 1

✗ archive refused: spec "32-billing.md" still has non-terminal plans:
    docs/plans/32-billing-plan.md    Approved
  → abandon or archive them first
$? = 1
```

Staleness report (that it lists every Approved plan with `fresh` or reasons + evidence is
**normative** per §5.6/§5.10; command spelling, layout, wording **indicative**):

```
phax plans status

docs/plans/32-billing-plan.md         STALE   ground-changed: src/domain/billing/rates.ts,
                                              src/domain/billing/invoice.ts changed since 3f2c9a1
                                              spec-changed: docs/specs/32-billing.md edited after approval
docs/plans/34-docs-refresh-plan.md    fresh
docs/plans/36-init-wizard-plan.md     STALE   self-changed: plan edited after approval
```

Applying the report (that the flip is an explicit gesture is **normative** per §5.13; the
flag **indicative**):

```
phax plans status --apply     # transitions the stale-computed plans Approved → Stale
```

Run refusal on a stale plan (refusal, reasons with evidence, and naming re-approval as the
remedy **normative** per §5.11; wording **indicative**):

```
✗ run refused: plan "32-billing-plan.md" is stale
  ground-changed: 2 files in its footprint changed since approval baseline 3f2c9a1
  spec-changed:   docs/specs/32-billing.md edited after approval
  → review, then re-approve: phax artifact approve docs/plans/32-billing-plan.md
$? = 1
```

No visual UI — no design annex.

## 7. Non-goals

- **Inferred lineage** — phax never guesses a plan's source spec from filename numbering,
  blockquote prose, or content similarity. The declaration is the only lineage input; a
  wrong declaration is a human error the fingerprints will surface, not something phax
  second-guesses.
- **Acting on staleness** — invoking re-planning (`adjust-plan`), scheduling, or batch
  execution of fresh disjoint plans belongs to later specs; this one only detects,
  reports, and gates.
- **Spec staleness** — a spec is spent fuel (`Draft → Approved → Archived`, or dropped via
  `Abandoned`); it does not go stale. Spec edits matter here only as a *cause* of plan
  staleness.
- **Sub-file granularity** — footprint intersection is file-level, deliberately coarse; a
  false positive costs one re-approval gesture.
- **Unmerged run awareness** — footprints of completed-but-unpublished runs do not count
  as ground changes here (the repository baseline comparison sees changes when they land);
  revisit with batch execution.
- **Cross-repository lineage.**

## 8. Acceptance criteria

### A plan without a declaration fails validation

Given a plan carrying a `Status:` line but no source-spec declaration, when the plan is
validated, then validation fails naming the missing declaration. (refs §5.1)

### A dangling declaration fails validation

Given a plan declaring a spec path that does not exist, when the plan is validated, then
validation fails naming the dangling reference. (refs §5.2)

### A spec-less plan skips the chain

Given a plan declaring `Source-Spec: (none)`, when it is approved, then approval proceeds,
its approval record carries no spec binding, and no `spec-changed` reason is ever reported
for it. (refs §5.2, §5.5)

### Approval is chain-gated

Given a plan declaring a source spec whose status is `Draft`, when the plan is approved,
then the approval is refused naming the spec and its status; and given the same spec with
status `Approved`, when the plan is approved, then the approval proceeds. (refs §5.3)

### Spec retirement is chain-gated

Given an Approved spec declared as source by an Approved plan, when the spec is archived,
then the transition is refused naming the plan and its status; and given that plan
abandoned, when the spec is archived again, then the transition proceeds and no plan
changed status as a side effect. (refs §5.4)

### Approval records the ground

Given a Draft plan declaring a source spec, when it is approved, then an approval record
exists binding the plan fingerprint, the spec identity and fingerprint, and a repository
baseline. (refs §5.5)

### Spec edit flips the verdict

Given a fresh Approved plan, when its declared source spec's content changes, then the
staleness report shows the plan stale with reason `spec-changed`. (refs §5.6, §5.7)

### Ground change names the files

Given an Approved plan whose footprint includes a file F, when F changes in the repository
after the approval baseline, then the staleness report shows the plan stale with reason
`ground-changed` naming F. (refs §5.6, §5.8)

### Disjoint changes do not flip

Given an Approved plan, when repository changes since its baseline touch no file in its
footprint, then the staleness report shows the plan `fresh`. (refs §5.8, §5.10)

### Plan edit flips the verdict

Given a fresh Approved plan, when the plan's content is edited (beyond lifecycle
metadata), then the staleness report shows it stale with reason `self-changed`. (refs
§5.6, §5.9)

### Recording status does not change the fingerprint

Given a plan, when only its phax-managed lifecycle metadata changes, then its content
fingerprint is unchanged and no `self-changed` reason is reported. (refs §5.9)

### A stale plan does not run

Given an Approved plan that computes stale, when a run is started from it, then the run
is refused naming each reason and its evidence, and naming re-approval as the remedy.
(refs §5.11)

### Re-approval restores freshness

Given a stale-computed plan, when it is re-approved and staleness is recomputed, then it
reports `fresh` and a run started from it proceeds. (refs §5.5, §5.11, §5.12)

### The flip is a gesture

Given a stale-computed Approved plan, when the staleness report runs without apply, then
the plan's persisted status still reads `Approved`; and when the report is applied, then
the plan's status reads `Stale`. (refs §5.13)

### No record means stale

Given a plan whose status reads `Approved` but which carries no approval record, when
staleness is computed, then it reports stale naming the missing record. (refs §5.14)

## 9. Open questions for implementation planning

Questions below are **resolved by adopting the recommended default** (reviews of
2026-08-09 and 2026-08-10):

Question: is enforcement at run start hard (refuse) or soft (warn and proceed)?

- Hard refuse — abandons: running through a known-coarse false positive without the
  re-approval gesture.
- Warn — abandons: the guarantee itself; staleness becomes one more advisory and stale
  runs happen exactly when nobody is looking.

Recommendation: hard refuse — the override exists (§5.12) and costs one command, and it
leaves a recorded trace that a human accepted the moved ground.

Question: where does the approval record live?

- Plan header fields — abandons: a machine-noise-free document (fingerprints are digests a
  human never reads).
- Repo sidecar store (e.g. one file under `docs/plans/`) — abandons: single-file
  self-containedness; file and store can drift when plans are moved or hand-edited.

Recommendation: human-meaningful fields (baseline, source spec, date) in the header,
fingerprints in a repo sidecar keyed by plan path — the drift loss is acceptable because
§5.14 makes a missing/unmatched record fail *stale* (safe direction), never silently fresh.

Question: is the footprint read from a frozen copy at approval or recomputed at check time?

- Frozen at approval — abandons: nothing of value — `self-changed` (§5.9) already
  invalidates the approval on any plan edit, so a frozen footprint can never be honestly
  outdated while the approval stands.
- Recomputed via extraction — abandons: independence from the extraction machinery at
  check time (a check needs extraction to succeed).

Recommendation: either is correct given §5.9; default to recomputed through the
content-addressed extraction cache (same content — guaranteed by §5.9 — is a cache hit,
so the check is deterministic and free), and let the plan choose if the machinery argues
otherwise.

Question (added 2026-08-10): where does lineage come from?

- Explicit in-file declaration — abandons: zero authoring cost; every plan, including
  every existing one, must carry the line, stamped by a one-time migration.
- Inference (filename numbering, blockquote prose, approval-time capture) — abandons:
  determinism; a heuristic that guesses wrong records false lineage silently, and
  silent-wrong is the failure mode this spec exists to remove.

Recommendation (adopted): explicit declaration — the cost is one line per plan and a
mechanical migration, and both explicit forms (`<path>` and `(none)`) make every plan's
chain state readable at a glance.

Question (added 2026-08-10): when a spec retires with non-terminal dependents, refuse or
cascade?

- Refuse and name offenders — abandons: one-command convenience for the "archive
  everything about this feature" gesture.
- Cascade (auto-abandon dependents) — abandons: "a flip is a gesture" — §5.13's own
  principle; plans would change state as a side effect, unreviewed.

Recommendation (adopted): refuse — resolving each dependent is one explicit command
apiece, and the refusal lists exactly which plans block.

## 10. Implementation-planning note

Settled: the explicit source-spec declaration with its two normative forms and
absence-is-an-error (§5.1–§5.2), the two chain gates — approval requires an Approved
declared spec (§5.3), spec retirement requires terminal dependents, refuse-not-cascade
(§5.4) — the approval record's three bindings (§5.5), the closed reason set
`spec-changed | ground-changed | self-changed` (§5.6 — an explicit enum; do not add
reasons without a spec change), file-level footprint intersection against the repository
baseline regardless of change origin, hard gating at run start per the §9 default,
status flips only as an explicit gesture (§5.13), and missing-record-means-stale (§5.14).

Left open: approval-record field names and fingerprint placement (§9 default: header +
sidecar), report/apply command spellings, digest algorithm.

Constraints the plan must respect: this spec consumes the artifact lifecycle spec (21) —
all status flips go through its legal transitions (`Approved → Stale` for apply,
`Stale → Approved` / `Approved → Approved` for re-approval, which per §5.5 here refreshes
the record); the state vocabulary — including the terminal statuses `Abandoned` and
`Archived` — is 21's and must not be extended. The `Source-Spec:` declaration grammar is
pinned here, but the one-time stamping of existing plans happens inside the lifecycle
rollout's migration (plan 21), so by the time this spec is implemented every plan already
carries the line; absence then fails validation per §5.1. The approval record and
staleness verdicts are external inputs — decode them through schemas at the boundary.
Ground-change detection compares repository states; it must not depend on phax run
artifacts (a change is a change whether a run, a teammate, or a hand commit made it) —
this is what the desktop's "dependents go stale" screen and a later batch-execution spec
will build on.
