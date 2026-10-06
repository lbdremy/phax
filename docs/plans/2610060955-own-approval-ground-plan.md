---
status: Draft
source-spec: null
---
# A plan's own approval is never ground change

This plan fixes a small staleness defect, so it has no source spec. It replaces the draft spec `approval-ground` (`docs/specs/2610040727-approval-ground.md`), now abandoned. That spec's §9 assumed the shared approvals ledger, and spec `approval-record-files` (shipped in 0.19.0) removed that ledger. Since 0.19.0, approving a plan writes only two files: the plan's own frontmatter and its own record file `docs/plans/approvals/<plan>.json`. `computeStaleness` (`src/domain/artifact/lineage.ts`) still intersects the plan's footprint with every file changed since the recorded baseline. That baseline is HEAD just before the approval commit. So a plan whose footprint names its own path, or its own record file, reads its own approval commit as `ground-changed` and is stale at once. The README lists this as a known issue ("A plan is stale right after its approval"). The fix: drop exactly those two paths from the ground-change evidence before the intersection. There is one code phase and then one docs phase. The approve transition, the record format, what the baseline means, the staleness reasons and every CLI surface stay unchanged, so `phax.usage.kdl`, `docs/cli/reference.md` and `src/cli/cliDocs.ts` are not touched. Fixtures are made up: nothing from `~/.phax` or another repository enters this repository. The layers hold (`cli → app → domain ← ports ← infra`): no new `node:fs` or `node:child_process` import in `app/`, `domain/` or `cli/`. No skill file needs editing: neither the `phax-planning` nor the `phax-cli` skill tells authors to leave `approvals.json` or a record file out of a plan's lists. So the run needs no `--allow-skill-edits`.

## Required commands

- (none)

No new commands. Every phase is verified by the `standard` gate profile, whose `pnpm` scripts `phax.json` already allows.

## Technical arbitrations

- Exactly two paths are excluded from ground-change evidence: the plan's own path and its own record file (`approvalRecordPathFor("plan", planPath)`). The plan's content is already judged by `self-changed` through the fingerprint, which ignores `status` and `approved`. The record file is machine state that only the plan's own transitions write. Loss accepted: a hand edit to the plan's own record file no longer counts as ground evidence. This is acceptable because the record is still decoded and validated on read (an unreadable record or an `artifact` mismatch is refused), and the fingerprint inside it is what staleness compares (decided by the author, 2026-10-06).
- Rejected: excluding every transition commit after the baseline. It would also hide real ground changes made by transitions, such as another artifact's archive move or its record deletion, and those must stay visible when the footprint names them (decided by the author, 2026-10-06).
- Rejected: moving the baseline to the approval commit. That would change the approve transition and the meaning of a persisted field (`baseline` in the record and the `approved` stamp) (decided by the author, 2026-10-06).
- The plan's own JSON sidecar stays ground evidence when the footprint names it. Approve never writes it, so it never causes this defect. Loss accepted: none in the approval path. A real sidecar change still counts (decided by the author, 2026-10-06).
- How the exclusion reaches the domain: `ComputeStalenessInput` gets one required `planPath` field, and `computeStaleness` derives the record path itself with `approvalRecordPathFor`, rather than taking a list of excluded paths from the caller. Loss accepted: a caller cannot exclude any other path. That is intended, because the set is exactly two by decision, and keeping the rule in the domain stops a caller from passing the wrong pair. For a loose plan outside `docs/plans/`, `approvalRecordPathFor` returns null and only the plan's own path is excluded (such a plan has no record anyway).

---

## phase-01 — Exclude the plan's own path and record from ground change {#phase-01-exclude-own-approval}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

A plan whose footprint names its own path or its own approval record file is fresh right after `phax artifact approve`, both at the `phax run` staleness gate and in `phax plans status`. It still turns stale with `ground-changed` when any other footprint file changes, and with `self-changed` when its own content changes.

### Detailed instructions

- Write the tests first (see Test strategy) and confirm the own-path and own-record cases fail before changing `src/`.
- In `src/domain/artifact/lineage.ts`, add a required `readonly planPath: string` to `ComputeStalenessInput`, with a one-line comment saying it is the repo-relative path of the plan being judged. Do not make it optional: the no-shims rule applies.
- In `computeStaleness`, build the excluded set from `input.planPath` plus `approvalRecordPathFor("plan", input.planPath)` when that is not null. Import it from `./approvalRecordFile.js` (same domain folder; it is pure). Filter `changedFilesSinceBaseline` through the excluded set before the footprint intersection. `self-changed` and `spec-changed` keep their current logic and order. The `ground-changed` evidence lists only the files that are still left.
- Add a short comment above the filter: the plan's own content is judged by self-changed through its fingerprint, and its own record file is written only by its own transitions, so neither counts as ground. Another artifact's record and the plan's own sidecar still count.
- In `src/app/planStaleness.ts`, pass `planPath` (already a parameter of `computeStalenessForPlan`) in all three `computeStaleness` calls: the no-record branch, the missing-baseline branch and the main branch. The signature of `computeStalenessForPlan` does not change, so `src/cli/commands/run.ts` and `computePlanStaleness` need no edit.
- In `tests/unit/artifact/lineage.test.ts`, add `planPath` to every existing `computeStaleness` call. Use one made-up constant such as `docs/plans/2609101222-foo-plan.md` (it matches the existing record fixture's key). Expected verdicts do not change.
- In `tests/integration/approvalRecordGround.test.ts`, add the new describe block and update the header comment so it covers both rules: another artifact's record is ground only when named, and the plan's own path and record are never ground.
- Do not touch the approve transition, the approval record schema, the `baseline` field, `STALENESS_REASONS`, renderers or any CLI file.

### Planned files to create

- (none)

### Planned files to edit

- `src/domain/artifact/lineage.ts`
- `src/app/planStaleness.ts`
- `tests/unit/artifact/lineage.test.ts`
- `tests/integration/approvalRecordGround.test.ts`

### Optional files that may be edited

- (none)

### Boundary contracts

Producer: `computeStaleness(input: ComputeStalenessInput): PlanStalenessVerdict` in `src/domain/artifact/lineage.ts`, now with a required `planPath: string`. It owns the exclusion rule and derives the record path through `approvalRecordPathFor` in `src/domain/artifact/approvalRecordFile.ts`. Consumer: `computeStalenessForPlan` in `src/app/planStaleness.ts`, which passes the path it already receives. Its own signature and error channel are unchanged, so the `phax run` gate (`src/cli/commands/run.ts`) and `phax plans status` (`computePlanStaleness` / `plansStalenessReport`) pick up the fix without edits.

### Test strategy

Test-first, domain then integration. In `tests/unit/artifact/lineage.test.ts`, add a table under `computeStaleness` (made-up paths; PLAN = `docs/plans/2609101222-foo-plan.md`, its record = `docs/plans/approvals/2609101222-foo-plan.json`, its sidecar = `docs/plans/2609101222-foo-plan.json`, OTHER = another made-up plan):
(a) changed [PLAN], footprint [PLAN] → fresh.
(b) changed [record(PLAN)], footprint [record(PLAN)] → fresh.
(c) changed [record(OTHER)], footprint [record(OTHER)] → stale, ground-changed, files [record(OTHER)].
(d) changed [sidecar], footprint [sidecar] → stale, ground-changed, files [sidecar].
(e) changed [PLAN, record(PLAN), `src/a.ts`], footprint all three → ground-changed with files [`src/a.ts`] only.
(f) changed [PLAN], footprint [PLAN], plan fingerprint differs → stale with [self-changed] only.
(g) a loose `plan.md` as planPath, changed and footprint [`plan.md`] → fresh.
Cases (a), (b), (e) and (g) must fail before the change.
In `tests/integration/approvalRecordGround.test.ts`, reuse the existing temp-repo harness (mkdtemp, `git init`, `transitionArtifact` with `commit: true`, `computeStalenessForPlan` on the real rooted Node FileSystem and Git layers). Add a describe "A plan's own approval is never ground change":
- Test 1: capture `baseline = git rev-parse HEAD`, approve PLAN_P, then call `stalenessOfP([PLAN_P, recordOf(PLAN_P), "src/feature/pi.ts"])` → `{ kind: "fresh" }`.
- Test 2: same setup, then write and commit `src/feature/pi.ts` with git → stale with exactly `[{ reason: "ground-changed", baseline, files: ["src/feature/pi.ts"] }]`.
The existing three tests in that file must stay green unchanged.

### Implementation order

1. Unit table and the planPath argument on existing calls in tests/unit/artifact/lineage.test.ts (red on the own-path/own-record cases).
2. Integration describe in tests/integration/approvalRecordGround.test.ts (red on the fresh-after-approve case).
3. planPath on ComputeStalenessInput and the exclusion filter in src/domain/artifact/lineage.ts.
4. Pass planPath in the three computeStaleness calls in src/app/planStaleness.ts.
5. Run the standard gate.

### Excluded scope

- Changing the approve transition, the approval record format, the meaning or position of the baseline, or the staleness reasons.
- Excluding transition commits, other artifacts' record files, or the plan's own JSON sidecar.
- Any CLI surface: phax.usage.kdl, docs/cli/reference.md, src/cli/cliDocs.ts, src/cli/commands/run.ts.
- README, NEXT_STEPS.md and skill edits (phase-02).

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

The new required `planPath` field on `ComputeStalenessInput` in `src/domain/artifact/lineage.ts`, and the exclusion rule: own path plus `approvalRecordPathFor("plan", planPath)` when it is not null. Confirm that `computeStalenessForPlan`'s signature is unchanged and that `run.ts` was not touched. List the unit cases and the two integration tests added, and confirm the existing approvalRecordGround tests are still green. Explain any deviation from the planned file lists.

### Commit subject

`fix(staleness): a plan's own approval is never ground change`

### Commit body

Approving a plan commits two files after the recorded baseline: the plan's own frontmatter and its own record file docs/plans/approvals/<plan>.json. A plan whose footprint named either one read its own approval commit as ground-changed and was stale at once.

computeStaleness now takes the plan's path and removes two paths from the changed files before intersecting them with the footprint: the plan's own path and its own record file (approvalRecordPathFor). The plan's content is still judged by self-changed through the fingerprint. Another artifact's record and the plan's own sidecar are still ground evidence when the footprint names them. The baseline, the record format, the transition and the staleness reasons are unchanged.

Covered by a unit table in the lineage tests and a real-git integration test: a plan that names its own path and record is fresh right after approve, and stale with ground-changed once another footprint file changes.

---

## phase-02 — Retire the known issue and the backlog items {#phase-02-docs-own-approval}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** low

The user-facing docs and the backlog no longer describe a plan as stale at its own approval: the README's known issue is gone, and `NEXT_STEPS.md` records the defect as fixed, along with the last happy-path defect on the road to 1.0.

### Detailed instructions

- README.md: delete the troubleshooting bullet that starts "**A plan is stale right after its approval.**" (in the known-issues list next to "Approval records are per-artifact files"). Change no other README text. The `plans status` paragraph and the artifact transitions paragraph stay as they are.
- NEXT_STEPS.md, §"Small follow-ups": tick the item "**A plan whose footprint names `docs/plans/approvals.json` is stale at its own approval.**" (`- [ ]` → `- [x]`). Append a closing sentence in the style of the neighbouring ticked items: fixed by spec `approval-record-files` (0.19.0: an approval writes only its own frontmatter and record file) and plan `own-approval-ground` (a plan's own path and its own record file are never ground change). Note that spec `approval-ground` was abandoned in favour of the plan. Keep the item's history text.
- NEXT_STEPS.md, §"Road to 1.0.0": tick the item "**One known happy-path defect left.**" and reword it to say both happy-path defects are fixed: the run-before-preflight slug burn (PR #112) and the approval-commit staleness (`approval-record-files` + `own-approval-ground`). Also update the sentence in that section's intro that counts the remaining blockers, if it still counts this item.
- NEXT_STEPS.md, the status line near the top that lists "Drafts waiting on the author": remove `approval-ground` (abandoned). Keep the other drafts named there.
- Re-check `.claude/skills/phax-planning/SKILL.md` and `.claude/skills/phax-cli/SKILL.md` for any advice to leave `approvals.json` or a record file out of a plan's lists. At planning time there was none, so this phase edits no skill file. If you do find such advice, do not edit it, because this run has no `--allow-skill-edits`. Report it in the handoff instead.
- Refer to plans and specs by slug, never by stamp, in any new prose.

### Planned files to create

- (none)

### Planned files to edit

- `README.md`
- `NEXT_STEPS.md`

### Optional files that may be edited

- (none)

### Test strategy

Docs only: no new tests. The `standard` gate's format check covers the Markdown. Check by reading that the README no longer mentions the known issue and that both NEXT_STEPS.md items are ticked with their closing notes.

### Implementation order

1. Delete the README known-issue bullet.
2. Tick and annotate the NEXT_STEPS.md Small follow-ups item.
3. Tick and reword the NEXT_STEPS.md Road to 1.0.0 item and its intro count, and drop approval-ground from the drafts line.
4. Re-check the two skills (read only).
5. Run the standard gate.

### Excluded scope

- Any `.claude/skills/` edit (none needed; the run has no --allow-skill-edits).
- docs/cli/reference.md, phax.usage.kdl, src/cli/cliDocs.ts and the blog post: no CLI surface changed.
- Archived specs, plans and briefs.

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

The README bullet removed, the two NEXT_STEPS.md items ticked with the wording used, and the drafts-line change. Confirm that the skill re-check found no advice to remove, or name what was found and left in place. Explain any deviation from the planned file lists.

### Commit subject

`docs: a plan is no longer stale at its own approval`

### Commit body

Remove the README known issue "A plan is stale right after its approval": a plan's own path and its own approval record file are no longer ground-change evidence.

In NEXT_STEPS.md, tick the Small follow-ups item about a plan stale at its own approval. It was fixed by approval-record-files, which removed the shared ledger, and by own-approval-ground, which excludes the plan's own path and record. Close the Road to 1.0.0 happy-path defect item now that both happy-path defects are fixed, and drop the abandoned approval-ground from the drafts waiting on the author.
