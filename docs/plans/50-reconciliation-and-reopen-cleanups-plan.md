---
status: Approved
source-spec: null
approved:
  date: 2026-08-15
  baseline: c9abd19
---
# Reconciliation and Reopen Cleanups

> Feed this `plan.md` to `phax extract-plan` to produce `phax-plan.json`, then run it
> with `phax run`. No source spec — these are two independent defect fixes carried over
> from `NEXT_STEPS.md` ("Nice to have improvements"), each small enough that a spec would
> add no information the plan does not already carry.

---

## Required commands

- (none)

Both phases use `pnpm` scripts already present in `package.json`; the plan introduces no
new tool, runtime, or CLI. No `## Required PHAX security configuration changes` section
is needed.

---

## Overview

Two unrelated defects, one phase each. They share no files and no concepts, so the phases
are independently committable and could land in either order; phase-01 goes first only
because it is the one a human sees on every run.

**1. The global reconciliation table calls optional files `unplanned`.** The *per-phase*
reconciler is already correct — `reconcile()` unions `create ∪ edit ∪ optional` into its
plan set (`src/domain/reconciliation/reconcile.ts:24`) and routes a touched optional file
to `optionalTouched`, never to `unplannedCreated`/`unplannedEdited`. The defect is one
layer up, in `aggregateGlobalReconciliation` (`src/domain/reconciliation/global.ts:164`):
the `optionalTouched` loop adds the phase to `touchedInPhases` but never to
`plannedInPhases`, so `deriveStatus` hits `isTouched && !isPlanned` and returns
`"unplanned"`, and the rendered "Planned in" column stays `—`. Surfaced by plan 49's
compliance review, where `tests/integration/adjustPlanCommand.test.ts` and
`tests/unit/cli/run.test.ts` were both flagged despite being listed as optional.

The same three lists are read with different semantics elsewhere: `buildFootprint` unions
`create ∪ edit ∪ optional` into `.all` (`src/domain/planOverlap/compute.ts:25`), which is
what plan staleness and `plans-overlap` consume. Staleness and overlap treat an optional
file as part of the plan; the global reconciler does not. This phase makes the reconciler
agree, without flattening the distinction.

**2. `phax artifact reopen` leaves a dangling approval behind.** `transitionArtifact`
calls `removeApprovalRecord` only on the terminal branch
(`src/app/artifactStatus.ts`, inside `if (isTerminalStatus(target))`), so a plan reopened
`Stale → Draft` keeps both its `approvals.json` entry and its `approved:` frontmatter
mapping — describing a version of the plan that is about to be rewritten. Observed on
plan 45, which carried its 2026-08-11 fingerprint and baseline through a reopen and a
full rewrite. It is inert today (staleness only consults records for `Approved` plans,
and `putApprovalRecord` overwrites by key), but the two exits from `Approved` disagree
with each other, which is the actual defect: completion cleans up, reopen does not.

Note that `Approved → Draft` is not a legal plan transition
(`PLAN_TRANSITIONS` in `src/domain/artifact/status.ts`) — the only reopen is
`Stale → Draft`, so that is the only path this phase changes.

---

## Technical arbitrations

Three arbitrations were settled with the user before the phases were written.

1. **Optional files get their own status, rather than being folded into
   `plannedInPhases`.** Adding a `optional-touched` member to `GlobalFileStatus` and the
   persisted schema union costs enum stability — a new literal every switch must handle.
   Folding them into `plannedInPhases` was rejected for two reasons: it erases the
   reviewer's ability to tell a required delivery from an optional one, and an optional
   file carries no `expectedAction`, so a pure-optional file would satisfy
   `allPlannedTouched` with no aligned `create→added` / `edit→modified` pair and resolve
   to `action-mismatch` — trading one wrong status for another.
2. **Only reopen clears the approval record; `Approved → Stale` keeps it.** The rule is
   that the record survives while the plan still claims its approval (`Approved`,
   `Stale`) and is dropped when the plan is rewritten (`Draft`) or retired (terminal).
   Knowingly abandoned: a uniform "a record exists iff the plan is `Approved`" invariant
   — a `Stale` plan keeps a record nothing currently reads. Clearing on `Approved → Stale`
   was rejected because it would delete the fingerprint and baseline the plan went stale
   *against*, at the exact moment staleness is declared, and `Stale → Approved` is a legal
   direct transition.
3. **Reopen also clears the `approved:` frontmatter mapping.** A `Draft` plan stamped
   `approved: {date, baseline}` is the same false claim as the dangling record, one file
   over. Knowingly abandoned: consistency with the terminal path, which deliberately
   keeps the key on archived plans as fingerprint-neutral history. The asymmetry is
   defensible — an archived plan's stamp is true forever, a reopened plan's is about to
   become false. Clearing is fingerprint-neutral either way: `fingerprintSource` already
   deletes `status` and `approved` before hashing.

---

## phase-01 — Classify touched optional files as `optional-touched` {#phase-01-optional-touched-status}

**Recommended model:** claude-sonnet-5
**Recommended effort:** high

Make the global reconciliation table stop reporting a legitimately delivered optional
file as `unplanned`, while keeping it visibly distinct from a required-planned file.

### Detailed instructions

- In `src/domain/reconciliation/global.ts`:
  - Add `"optional-touched"` to the `GlobalFileStatus` union.
  - Add `optionalInPhases: Set<string>` to the `Accumulator` type and initialise it in
    `getAcc`.
  - In the `phase.optionalTouched` loop, add the phase id to **both**
    `acc.touchedInPhases` and the new `acc.optionalInPhases`. Leave `expectedActions`
    empty — the optional list declares no create/edit intent — and keep the existing
    `acc.actualActions.add("modified")` with its comment.
  - Add `optionalInPhases: readonly string[]` to `GlobalFileEntry`, populated sorted like
    the other phase lists.
  - Extend `deriveStatus` with the optional set. Precedence: `renamed` and `deleted`
    still win first; then, when the file is touched and has **no** entry in
    `plannedInPhases`, return `"optional-touched"` if `optionalInPhases` is non-empty,
    else the existing `"unplanned"`.
  - For a file that is optional in one phase and required-planned in another, keep the
    existing required-file logic but treat optional phases as planned for the subset
    checks: compute `allTouchedPlanned` against `plannedInPhases ∪ optionalInPhases` so
    an optional touch elsewhere does not read as `extra-touch`. `allPlannedTouched` and
    the `missing` derivation keep using `plannedInPhases` alone — an untouched optional
    file must never count as missing (and produces no entry at all today, which is
    correct).
  - Entry booleans: `unplanned` becomes `isTouched && !isPlanned && !isOptional`;
    `planned` keeps meaning required-planned; `missing` and `extraTouch` are unchanged.
  - `attention` is `"ok"` for `"matched"` **and** `"optional-touched"` — the per-phase
    contract is that touching a file from the optional list is never flagged, and the
    global view must not contradict it.
  - Add an `"optional-touched"` arm to `deriveNotes` rendering
    `optional in: <phases>`, and render the "Planned in" column as the required phases
    plus each optional phase suffixed ` (optional)`, so the column is never blank for a
    foreseen file.
- In `src/schemas/globalReconciliation.ts`, add `Schema.Literal("optional-touched")` to
  `GlobalFileStatusSchema` and `optionalInPhases: Schema.Array(Schema.String)` to
  `GlobalFileEntrySchema`. Per repo policy the new field is **required**, not optional —
  there is no back-compat shim for previously written
  `global-file-reconciliation.json` files.
- Check the two decoding consumers, `src/app/adjustPlan.ts` and
  `src/app/analyzePlanOverlap.ts`: both read only `entry.actualActions`, so neither needs
  a change. Confirm that in the handoff rather than editing them.
- In `src/app/reviewHandoff.ts`, `global.unplanned` drives the deviation sections. No
  code change is expected — the slice simply stops containing optional files — but verify
  the rendered sections still read correctly when the only touched files are optional.

### Planned files to create

- (none)

### Planned files to edit

- `src/domain/reconciliation/global.ts`
- `src/schemas/globalReconciliation.ts`
- `tests/unit/reconciliation/global.test.ts`

### Optional files that may be edited

- `tests/unit/reconciliation/__snapshots__/global.test.ts.snap`
- `tests/unit/globalReconciliation.test.ts`
- `tests/integration/generateGlobalReconciliation.test.ts`
- `tests/integration/reviewHandoff.test.ts`
- `tests/unit/schemas/reconciliation.test.ts`

The snapshot is listed because `global.test.ts` snapshots the rendered markdown table
including its "Planned in" column; the renderer change will update it. Review the
snapshot diff rather than accepting it blindly — it is the clearest evidence the column
now reads correctly.

### Boundary contracts

- **Producer** `aggregateGlobalReconciliation` (domain) → **consumer**
  `generateGlobalReconciliation` / `loadReviewHandoffInputs` (app). The consumer needs a
  per-file verdict it can render and slice; the stable shape is `GlobalFileEntry` with
  its `status`, its phase lists, and the four booleans. Adding a status member and a
  phase list is additive to that contract; no consumer may branch on the absence of
  `optional-touched`.
- **Producer** the domain entry shape → **consumer** the persisted
  `global-file-reconciliation.json` and its decoder. The schema is the boundary: the
  domain type and `GlobalFileEntrySchema` must stay in agreement, and `pnpm test:type`
  is what proves it.

### Test strategy

Write the tests first — this is a pure domain function with an existing suite, and the
current wrong behavior is already pinned by a test.

- `tests/unit/reconciliation/global.test.ts` — **flip the existing case**
  `"optional touched file with no planned entry → unplanned"` (around line 353) to expect
  `"optional-touched"`, `attention: "ok"`, `unplanned: false`, and
  `optionalInPhases: ["phase-01"]`. Then add:
  - an optional-touched file is absent from `result.unplanned` and from
    `result.attentionPoints`;
  - a file optional in `phase-01` and planned+touched in `phase-02` resolves to
    `"matched"`, not `"extra-touch"` and not `"action-mismatch"`;
  - a file planned in `phase-01`, touched there, and optionally touched in `phase-02`
    resolves to `"matched"` rather than `"extra-touch"`;
  - a genuinely unplanned file still resolves to `"unplanned"` (regression guard for the
    new branch order);
  - the renderer emits `optional in: phase-01` in Notes and a non-blank "Planned in"
    cell carrying the ` (optional)` suffix.
- Type-level: the existing `_StatusCheck` helper in that file keeps the union honest;
  `pnpm test:type` covers the schema/domain agreement.

### Implementation order

Accumulator and entry shape → `deriveStatus` → schema → renderer → consumer verification.
Core-to-surface: no rendering change until the classification is correct.

### Excluded scope

- The per-phase reconciler (`reconcile.ts`) and its `optionalTouched` output — already
  correct; do not touch it.
- `src/domain/planOverlap/compute.ts` and plan staleness — they already union optional
  into the footprint; this phase moves the reconciler toward them, not the reverse.
- `adjustPlan` / `analyzePlanOverlap` behavior — they read `actualActions` only.
- Any change to what the *per-phase* handoff asks an agent to explain.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The final `GlobalFileStatus` union and the exact precedence order in `deriveStatus`.
- The `GlobalFileEntry` shape after the change, naming `optionalInPhases`.
- Confirmation that `adjustPlan.ts` and `analyzePlanOverlap.ts` needed no edit, with the
  reason (they read `actualActions` only).
- Whether `reviewHandoff.ts` needed an edit, and if so what.
- Any deviation from the planned file lists, with the reason.

### Commit subject

fix(reconciliation): classify touched optional files as optional-touched

### Commit body

The global reconciliation aggregator added an optional file's phase to
touchedInPhases but never to a planned set, so deriveStatus classified a
legitimately delivered optional file as `unplanned` with a blank "Planned in"
column — contradicting the per-phase reconciler, which already unions the
optional list into its plan set, and the footprint path, which unions it into
`.all`.

Track optional phases in their own accumulator set, expose them as
`optionalInPhases` on the entry, and give them a dedicated `optional-touched`
status with `attention: ok` rather than folding them into `plannedInPhases` —
an optional file carries no expected action, so folding would have resolved it
to `action-mismatch`. A file optional in one phase and planned in another still
resolves to `matched`. Covered by unit tests, including a flipped case that had
pinned the old behavior.

---

## phase-02 — Clear the approval on reopen {#phase-02-clear-approval-on-reopen}

**Recommended model:** claude-opus-4-8
**Recommended effort:** high

Make `phax artifact reopen` (`Stale → Draft`) drop the plan's `approvals.json` record and
its `approved:` frontmatter stamp, so a reopened plan no longer carries an approval of
text that is about to be rewritten.

### Detailed instructions

- In `src/domain/artifact/frontmatter.ts`, add
  `removeFrontmatterKeys(md, keys)`, mirroring `setFrontmatterKeys`: split, parse the
  mapping, `doc.delete(key)` for each key, re-emit with the body byte-identical, and
  return the same `Either<string, FrontmatterProblem>`. Deleting an absent key is a
  no-op, not an error. Do **not** add a delete variant to the `FrontmatterEdit` union —
  keep set and remove as separate operations.
- In `src/domain/artifact/lineage.ts`, add `clearApproved(md)` as the mirror of
  `stampApproved`, delegating to `removeFrontmatterKeys(md, ["approved"])`. Document that
  it is fingerprint-neutral because `fingerprintSource` already deletes `approved` before
  hashing.
- In `src/domain/artifact/writeSet.ts`, extend `transitionWriteSet` so a **plan**
  transitioning to `Draft` also carries `APPROVALS_FILE_PATH`. This is load-bearing, not
  cosmetic: the write-set is both the dirty-file precondition and the exact set
  `finalizeTransition` stages and commits, so without it the reopen would leave
  `approvals.json` modified and uncommitted in the working tree. The condition becomes
  `kind === "plan" && (target === "Approved" || target === "Draft" || isTerminalStatus(target))`.
- In `src/app/artifactStatus.ts`, inside `transitionArtifact`, add a non-terminal reopen
  branch for `kind === "plan" && target === "Draft"`: apply `clearApproved` to the
  already-status-rewritten markdown (lifting a `FrontmatterProblem` into
  `ArtifactValidationError` via `frontmatterProblemMessage`, exactly as the `Approved`
  branch does for `stampApproved`), and call `removeApprovalRecord(repoRelPath)` before
  the file write. Order matters only in that both mutations must land before
  `finalizeTransition` runs, since that is what commits the write-set.
- Leave the terminal branch alone: it keeps calling `removeApprovalRecord` and keeps the
  `approved:` stamp on the archived copy.
- Leave `Approved → Stale` alone — the record is deliberately retained there (see the
  arbitrations above). Add a test that pins this, so a future reader does not "fix" it.
- Specs have a `Draft` status too and no approval records; the `kind === "plan"` guard is
  what keeps a spec reopen out of `approvals.json`. Make sure a spec transition to
  `Draft` does not add the file to its write-set.

### Planned files to create

- (none)

### Planned files to edit

- `src/domain/artifact/frontmatter.ts`
- `src/domain/artifact/lineage.ts`
- `src/domain/artifact/writeSet.ts`
- `src/app/artifactStatus.ts`
- `tests/unit/artifact/writeSet.test.ts`
- `tests/unit/artifact/frontmatter.test.ts`
- `tests/integration/artifactStatus.test.ts`

### Optional files that may be edited

- `tests/unit/artifact/lineage.test.ts`

`tests/integration/artifactStatus.test.ts` is the only suite that exercises
`approvalRecordStore` end to end (there is no unit suite for it), which is why it is in
the required edit list rather than here.

### Boundary contracts

- **Producer** `transitionWriteSet` (domain) → **consumer** `transitionArtifact` and
  `finalizeTransition` (app). The consumer needs the complete set of repo-relative paths
  a transition writes; it uses that set unchanged for the dirty precondition and for
  path-scoped staging. Any new write a transition performs must appear in the set, or the
  auto-commit contract from spec 25 breaks silently.
- **Producer** `clearApproved` / `removeApprovalRecord` → **consumer** the reopen path.
  The semantic need is "this plan no longer claims an approval"; the two artifacts of an
  approval (frontmatter stamp, store record) must be cleared together or not at all.

### Test strategy

Write the tests first — this is a state-machine/write-set change where the failure mode
is silent (an uncommitted `approvals.json`), so the tests are the specification.

- `tests/unit/artifact/writeSet.test.ts` — a plan transitioning to `Draft` includes
  `docs/plans/approvals.json`; a **spec** transitioning to `Draft` does not; `Approved`
  and terminal targets are unchanged; a plan transitioning to `Stale` still does **not**
  include it (this is the pinned arbitration).
- `tests/unit/artifact/frontmatter.test.ts` — `removeFrontmatterKeys` deletes the key,
  leaves every other key and the body byte-identical, is a no-op on an absent key, and
  returns `missing-block` / `yaml-syntax` problems on malformed input.
- Round-trip: `clearApproved(stampApproved(md, …))` restores the original frontmatter,
  and `fingerprintSource` is unchanged across both (fingerprint neutrality).
- Integration, in `tests/integration/artifactStatus.test.ts` (the only suite that
  exercises `approvalRecordStore` end to end): approve a plan, stale it, reopen it, then
  assert the plan has no `approved:` key, `approvals.json` has no entry for it, the
  working tree is clean afterwards, and the reopen commit contains both files.

### Implementation order

`removeFrontmatterKeys` → `clearApproved` → `transitionWriteSet` → the `transitionArtifact`
branch. Domain first: the write-set must already name `approvals.json` before the app
layer starts writing it, or the intermediate state has a passing typecheck and a broken
commit contract.

### Excluded scope

- The terminal path's retention of the `approved:` stamp on archived plans.
- `Approved → Stale` record retention.
- Anything about *when* a plan goes stale (`planStaleness.ts`) — this phase changes only
  what a transition writes.
- Any new CLI surface, flag, or output change; `phax artifact reopen` keeps its current
  interface, and its rendered result is unchanged apart from the commit it now makes.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact signature of `removeFrontmatterKeys` and `clearApproved`, with their module
  paths.
- The final `transitionWriteSet` condition, verbatim.
- Confirmation that a spec reopen does not touch `approvals.json`, and that
  `Approved → Stale` still retains the record, each with the test that proves it.
- The integration test's assertion that the working tree is clean after a reopen.
- Any deviation from the planned file lists — in particular any test file created because
  the planned path did not exist — with the reason.

### Commit subject

fix(artifact): clear the approval when a plan is reopened

### Commit body

Reopening a plan (Stale → Draft) cleared neither its approvals.json record nor
its `approved:` frontmatter stamp, so a Draft plan kept an approval describing a
version of itself that was about to be rewritten. The completion path already
calls removeApprovalRecord, so the two exits from Approved disagreed.

Add removeFrontmatterKeys and a clearApproved mirror of stampApproved, clear
both artifacts of the approval on the reopen branch, and extend
transitionWriteSet so a plan reopen carries docs/plans/approvals.json — the
write-set is both the dirty precondition and the path-scoped staging set, so
omitting it would have left the file uncommitted.

Approved → Stale deliberately retains the record: it is the fingerprint and
baseline the plan went stale against, and Stale → Approved is a legal direct
transition. A test pins that. Clearing is fingerprint-neutral, since
fingerprintSource already strips `approved` before hashing.
