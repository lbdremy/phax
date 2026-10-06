Write the phax plan "A plan's own approval is never ground change". There is no source spec: it is a small staleness fix, like `docs/plans/archive/2610050933-backlog-fixes-plan.md`. The draft spec `approval-ground` (`docs/specs/2610040727-approval-ground.md`) is abandoned in favour of this plan. Its §9 was built on the shared ledger, which spec `approval-record-files` (shipped in 0.19.0) removed.

**What is left of the defect.** The original defect was "a plan whose footprint names `docs/plans/approvals.json` is stale at its own approval" (NEXT_STEPS.md §"Small follow-ups", and the last happy-path defect under §"Road to 1.0.0"). It is gone: an approval now writes only the plan's own frontmatter and its own record file `docs/plans/approvals/<plan>.json`, and the shared ledger no longer exists. Two cases remain.

`computeStaleness` (`src/domain/artifact/lineage.ts`) intersects the footprint with every file changed since the recorded baseline, and the baseline is HEAD just before the approval commit. So a plan whose footprint names its **own path**, or its **own record file**, reads its own approval commit as `ground-changed` and is stale at once. The README carries this as a known issue ("A plan is stale right after its approval").

Decided by the author on 2026-10-06; record each in the plan's `## Technical arbitrations` with the loss accepted:
- **Exclude exactly two paths from ground-change evidence:** the plan's own path and its own record file (`approvalRecordPathFor("plan", planPath)` in `src/domain/artifact/approvalRecordFile.ts`).
  - The plan's own content is already judged by `self-changed`, through the fingerprint, which ignores `status` and `approved`.
  - Its own record file is machine state, written only by its own transitions.
  - Loss accepted: a hand edit to the plan's own record file is no longer ground evidence. Its content is decoded and validated anyway (an unreadable record or an `artifact` mismatch is refused), and the fingerprint inside it is what staleness compares.
  - Rejected: excluding every transition commit after the baseline, which would hide real ground changes such as another artifact's archive move.
  - Rejected: moving the baseline to the approval commit, which changes the transition and the meaning of a persisted field.
- **The plan's own JSON sidecar stays ground evidence** when the footprint names it. Approve never writes it, so it never causes the defect.
- **No change** to the approve transition, the record format, the baseline's meaning, the staleness reasons, or any CLI surface.

Phase shape: one code phase, then one docs phase.

**Code phase.** `computeStaleness` (pure domain) receives the plan's path, or the two excluded paths, from its caller, and filters them out of `changedFilesSinceBaseline` before the footprint intersection. Update `src/app/planStaleness.ts` (`computeStalenessForPlan`), which serves both the `phax run` staleness gate and `phax plans status`. Tests, written first:
- a unit table in the existing lineage tests: own path excluded; own record excluded; another plan's record still ground evidence; the own sidecar still evidence; self-changed unaffected;
- one real-git integration test, following `tests/integration/approvalRecordGround.test.ts`: a plan whose footprint names its own path and its own record file is fresh right after `approve`, and stale with `ground-changed` once another footprint file changes.

**Docs phase.**
- README: remove the known issue "A plan is stale right after its approval".
- `NEXT_STEPS.md`: tick the §"Small follow-ups" item about a plan stale at its own approval, noting it was fixed by `approval-record-files` and this plan. Tick or remove the §"Road to 1.0.0" item "One known happy-path defect left", saying both happy-path defects are fixed.
- Check the `phax-planning` and `phax-cli` skills for any advice to leave `approvals.json` or a record file out of a plan's lists, and remove it.

Constraints:
- Fixtures are made up; nothing from `~/.phax` or another repository.
- Respect the layers; no new `node:fs` in `app/`, `domain/` or `cli/`.
- Gate: the plan must pass `phax plans lint`; every phase is verified by the `standard` gate profile.
- The docs phase edits `.claude/skills/` only if a skill needs it; if it does, say in the preamble that the run needs `--allow-skill-edits`.

Output: your final message is the plan document JSON and nothing else — no sentence before or after it, no code fence.
