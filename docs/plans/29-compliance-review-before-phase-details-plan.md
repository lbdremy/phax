# Plan — Compliance review before phase details in the PR body

## Overview

Today the PR body is assembled as `HEADER + review-handoff.md + compliance` in
`buildPrBody` (`src/domain/publish/body.ts`), so the **Plan compliance review**
lands at the very end — *after* the per-phase detail. We want the high-level
conformance verdict to appear *before* `## Phase details`, giving the reviewer
the inverted-pyramid order:

```
Run summary
Global reconciliation
Global unplanned changes
Global missing planned changes
Global review attention points
Deviations not explained in any handoff
Plan compliance review      ← moves here
Phase details               ← moves to the very end
```

### Why recompute instead of string-splitting

At publish time the handoff is a flat file re-read from disk and the compliance
is a *second* flat file (`publishRun.ts:352` and `:369`), so a naive reorder
would mean parsing a string we assembled ourselves. Instead we lean on the fact
that the handoff is a **pure function of inputs that are all persisted on disk**:

- `buildReviewHandoffContent(info, global, globalMd, phaseContents)` is pure.
- `global` is *derived* from the per-phase `file-reconciliation.json` files,
  which already have a decode schema (`decodePhaseFileReconciliation`) and a
  pure aggregator (`aggregateGlobalReconciliation`) plus markdown renderer
  (`renderGlobalReconciliationMarkdown`) in `src/domain/reconciliation/global.ts`.
- `phaseContents` is read from per-phase `file-reconciliation.md` and
  `phase-handoff.md`.

So at publish we **re-assemble the handoff in memory** from the persisted
pieces, passing the compliance markdown into the renderer, which slots it in
between the global sections and `## Phase details`. No new schema is required —
we reuse the existing per-phase schema and the pure domain functions.

### Decisions locked in

- The standalone `review-handoff.md` artifact on disk **stays compliance-free**.
  Compliance is inserted only into the assembled PR body.
- No reordering of the run pipeline; the compliance step keeps running after the
  handoff step (it only needs `global-file-reconciliation.md`, not the handoff).

## Required commands

- (none)

## phase-01 — Compliance-aware handoff renderer {#phase-01-compliance-renderer}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Teach the pure handoff renderer to place the Plan compliance review section
immediately before `## Phase details`, so a single function owns the section
order. Behavior of existing callers is unchanged (they pass no compliance).

### Detailed instructions

- In `src/app/reviewHandoff.ts`, change `buildReviewHandoffContent` to accept an
  optional fifth parameter `complianceReviewMd?: string` and **export** it (the
  unit test added below is its external consumer, keeping knip satisfied).
- When `complianceReviewMd` is provided, render a `## Plan compliance review`
  section between `## Deviations not explained in any handoff` and
  `## Phase details`. When it is `undefined`, the output must be byte-identical
  to today's.
- Define the heading text (`## Plan compliance review`) as a local constant in
  `reviewHandoff.ts` so the renderer is the single owner of the section. Be
  careful with blank-line spacing so sections remain separated by exactly one
  blank line (match the surrounding template style).
- The existing call site in `generateReviewHandoff` (`reviewHandoff.ts:194`)
  keeps calling the function with four arguments — no compliance — so the
  written `review-handoff.md` artifact is unchanged.

### Planned files to create

- `tests/unit/reviewHandoffContent.test.ts`

### Planned files to edit

- `src/app/reviewHandoff.ts`

### Optional files that may be edited

- (none)

### Boundary contracts

`buildReviewHandoffContent` is pure rendering over domain types
(`RunReviewInfo`, `GlobalFileReconciliation`, `PhaseContent`). Producer: this
function. Consumers: `generateReviewHandoff` (writes the file artifact) and, in
phase-02, `publishRun` (assembles the PR body). The stable contract is the
parameter list `(info, global, globalMd, phaseContents, complianceReviewMd?)`
and the fixed section order. Crosses no port boundary.

### Test strategy

Pure function → unit tests, written before the implementation:

- With `complianceReviewMd` provided: `## Plan compliance review` appears after
  `## Deviations not explained in any handoff` and before `## Phase details`,
  and contains the supplied markdown.
- With `complianceReviewMd` omitted: output is byte-identical to the
  four-argument call (regression guard for the file artifact).

### Implementation order

Write the unit tests first, then add the optional parameter and the insertion
logic until they pass.

### Excluded scope

- Any change to `publishRun`, `buildPrBody`, or the run pipeline (phase-02).
- Writing compliance into the on-disk `review-handoff.md` artifact (it stays
  compliance-free, by decision).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The new signature
  `buildReviewHandoffContent(info, global, globalMd, phaseContents, complianceReviewMd?)`
  and that it is now exported from `src/app/reviewHandoff.ts`.
- Confirmation that the omitted-compliance path is byte-identical to today's
  output.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(review): render plan compliance review before phase details

### Commit body

Add an optional complianceReviewMd parameter to buildReviewHandoffContent and
export it. When present, the renderer inserts a Plan compliance review section
between the global deviations section and Phase details, making one pure
function the single owner of section order. Existing callers pass no compliance,
so the written review-handoff.md artifact is unchanged. Covered by unit tests
asserting the section order and a byte-identical regression for the
no-compliance path.

## phase-02 — Recompute the PR body with compliance inline {#phase-02-recompute-pr-body}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** high

Assemble the PR body by recomputing the handoff from persisted inputs and
passing the compliance markdown into the renderer, so the verdict appears before
`## Phase details`. Simplify `buildPrBody` back to header + truncation only.

### Detailed instructions

- Add a read-only loader `loadReviewHandoffInputs(info)` in a new file
  `src/app/loadReviewHandoffInputs.ts` that, **without writing anything**:
  - reads each phase's `file-reconciliation.json`, decodes it with
    `decodePhaseFileReconciliation`, and aggregates with
    `aggregateGlobalReconciliation` to build `global`;
  - renders `globalMd` via `renderGlobalReconciliationMarkdown(global,
    runKey(info.namespace, info.shortName))`;
  - reads each phase's `file-reconciliation.md` and `phase-handoff.md` into
    `phaseContents` (same shape as today's `PhaseContent`);
  - returns `{ global, globalMd, phaseContents }`.
- Extract the per-phase reading loop currently inline in `generateReviewHandoff`
  (`reviewHandoff.ts:155-182`) into a shared `loadPhaseContents(info)` helper in
  the new file and have `generateReviewHandoff` call it, so the two paths do not
  duplicate the per-phase read logic. `generateReviewHandoff` keeps generating
  and persisting `global-file-reconciliation.*` exactly as today (its write
  behavior is unchanged).
- Rewire `publishRun` (`src/app/publishRun.ts`): instead of reading the flat
  `review-handoff.md`, call `loadReviewHandoffInputs(info)`, then
  `buildReviewHandoffContent(info, global, globalMd, phaseContents,
  complianceReviewMd)` (compliance read from `compliance-review.md` as today,
  `undefined` when absent), and pass the result as `reviewHandoffMd` to
  `buildPrBody`. Surface a clear failure via the existing `fail(...)` path if the
  inputs cannot be loaded/decoded.
- Simplify `buildPrBody` (`src/domain/publish/body.ts`): remove the
  `complianceReviewMd` field, the `COMPLIANCE_SECTION_HEADING` constant, and the
  append logic. It becomes `HEADER + reviewHandoffMd` with the existing
  truncation behavior preserved. The truncation note still references
  `review-handoff.md` on the branch.
- Update `tests/unit/publish/body.test.ts` to drop the compliance-specific cases
  (compliance is no longer a `buildPrBody` concern) while keeping header and
  truncation coverage.

### Planned files to create

- `src/app/loadReviewHandoffInputs.ts`
- `tests/integration/loadReviewHandoffInputs.test.ts`

### Planned files to edit

- `src/app/publishRun.ts`
- `src/app/reviewHandoff.ts`
- `src/domain/publish/body.ts`
- `tests/unit/publish/body.test.ts`
- `tests/integration/publishRun.test.ts`

### Optional files that may be edited

- (none)

### Boundary contracts

`loadReviewHandoffInputs` is an application read operation: all reads go through
the `FileSystem` port; decoding goes through the existing
`decodePhaseFileReconciliation` schema (validation boundary) before data enters
the domain aggregator. Producer: `loadReviewHandoffInputs`. Consumer:
`publishRun`. Stable contract: returns `{ global, globalMd, phaseContents }`
ready for `buildReviewHandoffContent`. `buildPrBody`'s contract narrows to
`{ reviewHandoffMd, branch, maxBytes? }`.

### Test strategy

- `loadReviewHandoffInputs` (application command over the FileSystem port) →
  integration test with a fake fs: given persisted per-phase artifacts, it
  rebuilds `global`/`globalMd`/`phaseContents` matching what
  `generateReviewHandoff` produced. Write this before implementation.
- `buildPrBody` (domain) → unit tests: header wrapping and truncation, with the
  compliance cases removed.
- `publishRun` (application) → integration test: assert the written `pr-body.md`
  places `## Plan compliance review` before `## Phase details` when a
  `compliance-review.md` exists, and omits the section when it does not.

### Implementation order

Core to surface: extract `loadPhaseContents` and add `loadReviewHandoffInputs`
(with its integration test) → simplify `buildPrBody` and its unit tests → rewire
`publishRun` → extend the `publishRun` integration test.

### Excluded scope

- Adding compliance to the on-disk `review-handoff.md` artifact (kept
  compliance-free, by decision).
- Reordering the run pipeline or the timing of the compliance step.
- Introducing a decode schema for `global-file-reconciliation.json` (the global
  is recomputed from per-phase artifacts, so none is needed).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The path and signature of `loadReviewHandoffInputs(info)` and the shared
  `loadPhaseContents(info)` helper, and that `generateReviewHandoff` now uses the
  helper.
- The narrowed `buildPrBody` signature (`complianceReviewMd` removed).
- Confirmation that `pr-body.md` now orders compliance before phase details and
  that `review-handoff.md` on disk is unchanged.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(publish): place compliance review before phase details in the PR body

### Commit body

Assemble the PR body by recomputing the review handoff from persisted per-phase
artifacts and passing the compliance markdown into buildReviewHandoffContent, so
the Plan compliance review appears before Phase details. Add a read-only
loadReviewHandoffInputs loader plus a shared loadPhaseContents helper reused by
generateReviewHandoff, and narrow buildPrBody back to header + truncation. The
on-disk review-handoff.md artifact stays compliance-free. Covered by an
integration test for the loader, updated body unit tests, and a publishRun
integration test asserting the new section order.
