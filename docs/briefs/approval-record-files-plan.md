Write the phax plan for the Approved spec `approval-record-files` (`docs/specs/2610051433-approval-record-files.md`, with its sidecar `.json`). The spec is the source of truth. All ten §9 questions were decided by the author on 2026-10-05; implement those decisions and do not reopen them. One plan carries the whole spec, so it completes the spec.

Technical arbitrations already made. Record each in the plan's `## Technical arbitrations`, with the loss accepted:
- **A record file is in a transition's write-set only when it exists before or after the transition.** `commitPaths` (`src/infra/git.ts`) runs `git add -A -- <paths>`, which fails on a pathspec that matches nothing. So abandoning a never-approved Draft must not list a record file that never existed.
  - Approve always lists its own record file, because it writes it.
  - Reopen, complete and abandon list it only when it exists at the start of the transition; the store says whether it does.
  - This satisfies spec §5.9 without loosening the git adapter.
  - Loss accepted: `transitionWriteSet` stops being a pure function of kind and target, and takes whether the record exists as an input.
  - Rejected: making `commitPaths` tolerate pathspecs that match nothing, which would hide a misspelled write-set path.
- **Rename `ApprovalLedgerUnreadableError` to `ApprovalRecordUnreadableError`** (spec §10, left open). It shipped in PR #117 after v0.18.0, so no release carries the old name. Exit code 12 is unchanged, and the README exit-code table is untouched.
  - Loss accepted: none beyond the rename itself.
  - The old-ledger refusal (§5.14) is its own error, naming the ledger and `phax artifact migrate-approvals`, and also exits 12.
- **The package needs no pre-schema shape for the new formats.** `defineFormat` (`packages/schemas/src/shapes.ts`) already accepts a format spec with `preSchema?: never`. Declare `plan-approval-record` and `spec-approval-record` that way, with `next` snapshots through `scripts/schemas-check.ts --write`, as every format got in schemas-package plan 4.
- **This repository's own ledgers are migrated after the release, not in this plan** (spec §10 default). The run executing this plan is driven by the installed phax 0.18, which still writes `docs/plans/approvals.json` at completion. No phase runs `migrate-approvals` on the real tree.
  - The author migrates by hand after the release that ships this; record that as a NEXT_STEPS item in the last phase.

Phase shape: inside-out, each phase green on its own, with its tests in the same phase (no oracle phases). Start from this suggested order and adjust it if a boundary is wrong:
1. **Formats.** The two record schemas in `src/schemas/`, their readers in `src/schemas/persisted.ts`, and the package formats in `packages/schemas/src/formats/repository.ts` with snapshots. `plan-approvals` and `spec-approvals` stay as they are (§5.21).
2. **Per-file store and classification.** Covers `src/app/approvalRecordStore.ts`:
   - lookup from the artifact path alone (§5.2);
   - a missing file means no record (§5.10);
   - an unreadable file is refused and left byte-identical (§5.11);
   - an `artifact` mismatch is unreadable (§5.12);
   - the error rename.

   Also `classifyArtifactPath` refusing paths under `approvals/` (§5.4), with tests showing that the `.md`-only walks skip the subfolder.
3. **Transitions and run completion.** `transitionWriteSet` with the exists rule; approve, reopen, complete and abandon on their own record file only (§5.5–§5.9); `src/app/completeRunArtifacts.ts`. Include the real-git merge acceptance tests (§8: plan and spec transitions on two branches, a run's PR after an approval on main) in temporary repositories.
4. **Staleness and orphans.**
   - `src/app/planStaleness.ts` reads the plan's own record file.
   - Another artifact's transitions are not ground change (§5.22).
   - The orphan warning on stderr in `phax plans status` and `phax artifact status` (§5.13), and the required `orphanRecords` key in `phax plans status --json` (§9 Q8).
5. **Old ledgers.**
   - The refusal while either old ledger exists (§5.14, §9 Q9), in every command the spec lists, before anything is written.
   - `phax artifact migrate-approvals` (§5.15–§5.20): through `phax.usage.kdl`, `pnpm gen:usage-spec`, `pnpm docs:cli` and `src/cli/cliDocs.ts`, as every command is added.
   - It reads every released ledger shape through the existing readers and frozen decoders, and makes one commit with exactly the deleted ledgers and created record files.
6. **Docs.**
   - The transition help text and the README (persisted-formats table rows per spec §6, the "stale right after its approval" known issue, and the §11 upgrade note).
   - `.claude/skills/phax-cli/SKILL.md` and `.claude/skills/phax-spec/SKILL.md`; `approvals.json` appears only where the spec allows it (§5.23).
   - `NEXT_STEPS.md`: tick the "A run's completion conflicts with approvals made on main during the run" item, note under `approval-ground` that its §9 Q2/Q4 now reduce to the plan's own record file and own path, and add the post-release migration of this repository's ledgers.

Constraints:
- Test ledgers, records and repositories are made up. Nothing from `~/.phax` or another repository enters this public repository.
- Respect the layers (`cli → app → domain ← ports ← infra`): no new `node:fs` or `node:child_process` import in `app/`, `domain/` or `cli/`; the migration command is thin (parse, one use case, render).
- No change to fingerprint coverage, `baseline` meaning or the staleness reasons (spec §7).
- Every acceptance criterion in spec §8 maps to at least one test; name the mapping in each phase's test strategy.
- Gate: the plan must pass `phax plans lint`; every phase is verified by the `standard` gate profile, and every phase's commands must be allowed by `phax.json`.

Output: your final message is the plan document JSON and nothing else — no sentence before or after it, no code fence.
