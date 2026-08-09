# Plan Staleness & Lineage

Status: Approved

Date: 2026-08-09

Audience: implementation planning with Claude Code

Scope: functional behavior and consumption surface

## 1. Context

The artifact lifecycle spec (21) gives plans an enforced status with a `Stale` state,
reachable — so far — only by hand. What flips a plan stale in reality is never a gesture;
it is an event: the source spec was edited after the plan was approved, another piece of
work landed and changed files the plan intends to touch, or the plan file itself was
edited after its approval.

phax already holds most of the raw material: extraction knows every plan's planned file
footprint, extraction is content-addressed (identical plan content re-extracts for free),
per-phase reconciliation records what a run actually changed, and the repository's own
history records what changed regardless of who changed it — a phax run, a teammate, or a
hand commit. What is missing is the connective tissue: nothing records what an approval
was *given against*, so nothing can compute what an event invalidates. Today phax either
trusts a stale plan or the human re-examines everything.

## 2. Problem

An approval is a judgment about a moment: *this plan, derived from that spec, against this
state of the repository*. phax records none of those three bindings. Consequently a plan
whose spec was rewritten, whose target files were reshaped by an intervening merge, or
whose own text was edited post-approval still reads `Approved` and runs without a warning.
The desktop direction ("dependents go stale → re-plan only those") and safe multi-plan
operation both presuppose exactly this detection, and it does not exist.

## 3. Product goal

phax records, at plan approval, what the approval was given against — the source spec's
content, the plan's own content, and a repository baseline — and can thereafter compute,
for any Approved plan, whether that ground still holds. Staleness is computed on demand
and at run start, classified by explicit reasons, surfaced as a report, and enforced at
the one moment it matters: a plan whose ground moved does not run until a human re-approves
it.

> An approval binds a plan to the ground it was judged on; when the ground moves, the
> approval — not the plan — is what expires.

## 4. Terminology

- **Approval record** — the binding captured when a plan is approved: the plan's content
  fingerprint, the source spec's identity and content fingerprint (where one exists), and
  the repository baseline.
- **Content fingerprint** — a stable digest of an artifact's content, excluding its
  phax-managed lifecycle metadata (so recording an approval does not disturb the
  fingerprint it records).
- **Repository baseline** — the repository state (a commit) the approval was judged
  against.
- **Footprint** — the union of a plan's planned files (create, edit, optional), as
  extraction reports them. File-level, deliberately coarse.
- **Staleness reason** — exactly one of: `spec-changed`, `ground-changed`, `self-changed`
  (§5.2). A stale verdict carries every reason that applies.
- **Fresh** — an Approved plan whose staleness computation returns no reason.

## 5. Functional requirements

### 5.1 Approval captures the ground

WHEN a plan transitions to `Approved` (including re-approval) THE system SHALL record an
approval record binding the plan's content fingerprint, the source spec's identity and
content fingerprint where the plan has one, and the repository baseline.

### 5.2 Explicit reasons

WHEN staleness is computed for an Approved plan THE system SHALL report every reason that
applies, drawn from exactly: `spec-changed`, `ground-changed`, `self-changed`.

### 5.3 Spec-changed

IF the current content fingerprint of a plan's source spec differs from the one in the
approval record THEN staleness computation SHALL report the plan stale with reason
`spec-changed`.

### 5.4 Ground-changed

IF files changed in the repository since the approval baseline intersect the plan's
footprint THEN staleness computation SHALL report the plan stale with reason
`ground-changed`, naming the intersecting files. (This covers changes from any origin —
a landed phax run, a teammate's merge, a hand commit.)

### 5.5 Self-changed

IF the plan's current content fingerprint differs from the one in the approval record
THEN staleness computation SHALL report the plan stale with reason `self-changed`.

### 5.6 Staleness report

WHEN the operator requests the staleness report THE system SHALL report, for every
Approved plan, either `fresh` or its staleness reasons with their evidence.

### 5.7 Enforcement at run start

WHEN a run is started from an Approved plan THE system SHALL compute staleness first.

IF the plan is stale THEN the system SHALL refuse to start the run, naming each reason
and its evidence, and naming re-approval as the remedy.

### 5.8 Re-approval restores freshness

WHEN a stale-computed plan is re-approved THE system SHALL replace its approval record
(per §5.1) such that an immediately subsequent staleness computation reports it fresh.

### 5.9 Applying verdicts is a gesture

WHERE the operator applies the staleness report THE system SHALL transition each
stale-computed plan `Approved → Stale` through the lifecycle transitions of the artifact
lifecycle spec, recording the reasons.

The system SHALL NOT rewrite a plan's persisted status as a side effect of computing or
reporting staleness.

### 5.10 Missing record

IF an Approved plan carries no approval record THEN staleness computation SHALL report it
stale, naming the missing record. (No back-compat: plans approved before this feature are
stale by definition until re-approved.)

## 6. Surface

Plan header after `phax artifact approve` — that approval visibly records what it bound is
**normative** (§5.1); field names, format, and whether fingerprints live here or in a
sidecar **indicative**:

```markdown
Status: Approved
Approved: 2026-08-09 @ 3f2c9a1
Source-Spec: docs/specs/32-billing.md
```

Staleness report (that it lists every Approved plan with `fresh` or reasons + evidence is
**normative** per §5.2/§5.6; command spelling, layout, wording **indicative**):

```
phax plans status

docs/plans/32-billing-plan.md         STALE   ground-changed: src/domain/billing/rates.ts,
                                              src/domain/billing/invoice.ts changed since 3f2c9a1
                                              spec-changed: docs/specs/32-billing.md edited after approval
docs/plans/34-docs-refresh-plan.md    fresh
docs/plans/36-init-wizard-plan.md     STALE   self-changed: plan edited after approval
```

Applying the report (that the flip is an explicit gesture is **normative** per §5.9; the
flag **indicative**):

```
phax plans status --apply     # transitions the stale-computed plans Approved → Stale
```

Run refusal on a stale plan (refusal, reasons with evidence, and naming re-approval as the
remedy **normative** per §5.7; wording **indicative**):

```
✗ run refused: plan "32-billing-plan.md" is stale
  ground-changed: 2 files in its footprint changed since approval baseline 3f2c9a1
  spec-changed:   docs/specs/32-billing.md edited after approval
  → review, then re-approve: phax artifact approve docs/plans/32-billing-plan.md
$? = 1
```

No visual UI — no design annex.

## 7. Non-goals

- **Acting on staleness** — invoking re-planning (`adjust-plan`), scheduling, or batch
  execution of fresh disjoint plans belongs to later specs; this one only detects,
  reports, and gates.
- **Spec staleness** — a spec is spent fuel (Draft → Approved → Archived); it does not go
  stale. Spec edits matter here only as a *cause* of plan staleness.
- **Sub-file granularity** — footprint intersection is file-level, deliberately coarse; a
  false positive costs one re-approval gesture.
- **Unmerged run awareness** — footprints of completed-but-unpublished runs do not count
  as ground changes here (the repository baseline comparison sees changes when they land);
  revisit with batch execution.
- **Cross-repository lineage.**

## 8. Acceptance criteria

### Approval records the ground

Given a Draft plan with a source spec, when it is approved, then an approval record exists
binding the plan fingerprint, the spec identity and fingerprint, and a repository
baseline. (refs §5.1)

### Spec edit flips the verdict

Given a fresh Approved plan, when its source spec's content changes, then the staleness
report shows the plan stale with reason `spec-changed`. (refs §5.2, §5.3)

### Ground change names the files

Given an Approved plan whose footprint includes a file F, when F changes in the repository
after the approval baseline, then the staleness report shows the plan stale with reason
`ground-changed` naming F. (refs §5.2, §5.4)

### Disjoint changes do not flip

Given an Approved plan, when repository changes since its baseline touch no file in its
footprint, then the staleness report shows the plan `fresh`. (refs §5.4, §5.6)

### Plan edit flips the verdict

Given a fresh Approved plan, when the plan's content is edited (beyond lifecycle
metadata), then the staleness report shows it stale with reason `self-changed`. (refs
§5.2, §5.5)

### Recording status does not change the fingerprint

Given a plan, when only its phax-managed lifecycle metadata changes, then its content
fingerprint is unchanged and no `self-changed` reason is reported. (refs §5.5)

### A stale plan does not run

Given an Approved plan that computes stale, when a run is started from it, then the run
is refused naming each reason and its evidence, and naming re-approval as the remedy.
(refs §5.7)

### Re-approval restores freshness

Given a stale-computed plan, when it is re-approved and staleness is recomputed, then it
reports `fresh` and a run started from it proceeds. (refs §5.1, §5.7, §5.8)

### The flip is a gesture

Given a stale-computed Approved plan, when the staleness report runs without apply, then
the plan's persisted status still reads `Approved`; and when the report is applied, then
the plan's status reads `Stale`. (refs §5.9)

### No record means stale

Given a plan whose status reads `Approved` but which carries no approval record, when
staleness is computed, then it reports stale naming the missing record. (refs §5.10)

## 9. Open questions for implementation planning

All questions are **resolved by adopting the recommended default** (review of 2026-08-09):

Question: is enforcement at run start hard (refuse) or soft (warn and proceed)?

- Hard refuse — abandons: running through a known-coarse false positive without the
  re-approval gesture.
- Warn — abandons: the guarantee itself; staleness becomes one more advisory and stale
  runs happen exactly when nobody is looking.

Recommendation: hard refuse — the override exists (§5.8) and costs one command, and it
leaves a recorded trace that a human accepted the moved ground.

Question: where does the approval record live?

- Plan header fields — abandons: a machine-noise-free document (fingerprints are digests a
  human never reads).
- Repo sidecar store (e.g. one file under `docs/plans/`) — abandons: single-file
  self-containedness; file and store can drift when plans are moved or hand-edited.

Recommendation: human-meaningful fields (baseline, source spec, date) in the header,
fingerprints in a repo sidecar keyed by plan path — the drift loss is acceptable because
§5.10 makes a missing/unmatched record fail *stale* (safe direction), never silently fresh.

Question: is the footprint read from a frozen copy at approval or recomputed at check time?

- Frozen at approval — abandons: nothing of value — `self-changed` (§5.5) already
  invalidates the approval on any plan edit, so a frozen footprint can never be honestly
  outdated while the approval stands.
- Recomputed via extraction — abandons: independence from the extraction machinery at
  check time (a check needs extraction to succeed).

Recommendation: either is correct given §5.5; default to recomputed through the
content-addressed extraction cache (same content — guaranteed by §5.5 — is a cache hit,
so the check is deterministic and free), and let the plan choose if the machinery argues
otherwise.

## 10. Implementation-planning note

Settled: the approval record's three bindings (§5.1), the closed reason set
`spec-changed | ground-changed | self-changed` (§5.2 — an explicit enum; do not add
reasons without a spec change), file-level footprint intersection against the repository
baseline regardless of change origin, hard gating at run start per the §9 default,
status flips only as an explicit gesture (§5.9), and missing-record-means-stale (§5.10).

Left open: record field names and fingerprint placement (§9 default: header +
sidecar), report/apply command spellings, digest algorithm.

Constraints the plan must respect: this spec consumes the artifact lifecycle spec (21) —
all status flips go through its legal transitions (`Approved → Stale` for apply,
`Stale → Approved` / `Approved → Approved` for re-approval, which per §5.1 here refreshes
the record); the state vocabulary is 21's and must not be extended. The approval record
and staleness verdicts are external inputs — decode them through schemas at the boundary.
Ground-change detection compares repository states; it must not depend on phax run
artifacts (a change is a change whether a run, a teammate, or a hand commit made it) —
this is what the desktop's "dependents go stale" screen and a later batch-execution spec
will build on.
