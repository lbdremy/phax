Write the phax spec `approval-record-files`: every approval record lives in its own file, so two branches that approve, reopen or complete different artifacts never edit the same file and never conflict. Today all records of a kind share one ledger, `docs/plans/approvals.json` or `docs/specs/approvals.json`.

Decided with the author on 2026-10-05 (NEXT_STEPS.md §"Small follow-ups", "A run's completion conflicts with approvals made on main during the run"), and not to be reopened: **one file per approval record.** Rejected and why:
- A git merge driver: it lives in each clone's local git config, and GitHub's mergeability check never runs one, so the PR would still show a conflict and CI would still not run.
- Keeping the record at completion and ignoring it on read: two edits to adjacent lines of one JSON object still conflict, and stale records pile up.

The defect, as found on 2026-10-03 on PR #112:
- A run's completion commit, on the run branch, removes the plan's entry from `docs/plans/approvals.json`. Meanwhile, approving another plan on main edits the same JSON object.
- The PR then conflicts, and CI never runs until the branch is rebased by hand, keeping main's ledger minus the completed entry.
- The spec ledger has the same exposure whenever a run completes its source spec while another spec is approved on main.

Decided by the author on 2026-10-05, in answer to the brief's open questions. Write each into §9 as a decided question, giving the options, what each abandons and the decision; do not reopen them:
- **Location: a subfolder beside the artifacts.** `docs/plans/approvals/<plan file name with .json>` and `docs/specs/approvals/<spec file name with .json>`.
  - Rejected: a separate `docs/approvals/{plans,specs}/` tree, which puts the record far from its artifact under a new top-level folder.
  - Rejected: the artifact's own frontmatter, which stops the record being a JSON format the schemas package reads, and puts fingerprints and full SHAs in a file people edit by hand.
  - Accepted loss: every walker of `docs/plans/` and `docs/specs/` skips one more subfolder, as it already skips `archive/`.
- **Migration: a one-time command.** It splits a ledger into record files and deletes it, in a single commit. While an old ledger exists, phax refuses every approval transition and every staleness computation, naming that command.
  - Rejected: splitting automatically at the next transition, which reintroduces the edit-versus-delete conflict when a run branch splits while main still edits the old ledger.
  - Rejected: migrating by hand with no code, which leaves any other user's ledger to them.
  - Accepted loss: one more CLI command before the contract freeze. The spec names it, places it in the command tree (under `artifact` is the natural home), and gives its exit codes; it goes through `phax.usage.kdl`.
- **Orphan records warn.** A record file whose artifact is gone is reported by `phax plans status` and `phax artifact status` as a warning, with the path to delete. Nothing fails.
  - Rejected: a lint error, which blocks every plan's lint on an unrelated leftover.
  - Rejected: ignoring orphans, which leaves dead files nobody notices.
- **A record names its artifact.** Each record file carries the artifact's repo-relative path (e.g. `artifact`), and a record whose path does not match its file name is refused as unreadable (`ApprovalLedgerUnreadableError`, or its successor).
  - Rejected: relying on the file name alone, which lets a record copied or renamed by hand silently approve another artifact.
  - Accepted loss: the path is stored twice.
- **The old formats stay readable, never written.** `plan-approvals` and `spec-approvals` remain in `@lbdremy/phax-schemas` with their released shapes (pre-schema, 0.17.0, 0.18.0). phax writes them no more, and reads them only to migrate.

What the spec must cover:
- **Where a record lives and how it is named.** One file per approved artifact, found from the artifact's path alone (no index file, which would bring the conflict back).
  - The name beside the artifact is taken: a headless-authored artifact already has its JSON sidecar there (`<YYMMDDHHMM>-<slug>[-plan].json`), hence the decided `approvals/` subfolder.
  - Every reader that walks `docs/plans/` or `docs/specs/` must not take a record for an artifact: `classifyArtifactPath`, `plans lint`'s tree walk, `artifact status`, the archive moves. Name which ones change.
- **The record's shape.** Today a plan record holds `planFingerprint`, `approvedAt`, `baseline` (full sha) and `sourceSpec`; a spec record holds `specFingerprint`, `approvedAt` and `baseline`.
  - The per-file record keeps these fields and adds the artifact's path (decided above).
  - Each record file is a persisted format with `$schema`, like every other phax file. Name the new format ids, and what becomes of `plan-approvals` and `spec-approvals` in `@lbdremy/phax-schemas`: released shapes stay readable, since the package reads every format version ever written.
- **The transitions' write-sets** (`transitionWriteSet` in `src/domain/artifact/writeSet.ts`, `src/app/approvalRecordStore.ts`, `src/app/artifactStatus.ts`, `src/app/completeRunArtifacts.ts`):
  - approve writes the artifact and creates or replaces its own record file;
  - reopen deletes it;
  - complete and abandon delete it beside the move to `archive/`.
  - No transition touches another artifact's record. The path-scoped commit and clean-file precondition keep working, including when the write-set contains a deleted file.
- **Unreadable records.** Keep the rule shipped on 2026-10-05 (PR #117, `ApprovalLedgerUnreadableError`, exit 12): a record file that is missing means "no record", while one that is unreadable — newer release, undecodable, not JSON — is refused and never rewritten.
  - An orphan record warns (decided above). A record whose artifact path does not match its file name is unreadable.
- **Migration of existing ledgers.** Both of this repository's ledgers are `$schema` documents (0.18.0). steme-lab's plan ledger is pre-schema (`version: 1`) and empty, and it has no spec ledger. A migration must handle both forms, and an absent ledger. Precedent: phax reads an older format through its frozen decoder in `src/schemas/history/` and writes the current one (`src/schemas/persisted.ts`).
  - Use the decided one-time command. Specify it fully: the split must be one commit that deletes the ledger and creates every record file, so no record is lost or duplicated. Cover running it twice, on an absent ledger, on an empty one, and on one with a record whose artifact is gone. Name the refusal (and its exit code) that every approval transition and staleness check gives while an old ledger exists.
  - Follow the project rule that persisted formats carry no back-compat shims: once migrated, the old ledger is never written again.
- **The consequence for staleness.** A plan's footprint stops containing other plans' records, so another plan's approval no longer makes it `ground-changed`. Only its own record file and its own path remain to handle.
  - That narrows the open spec `approval-ground` (`docs/specs/2610040727-approval-ground.md`, Draft): its §9 Q2 and Q4 exist because the plan's own record sits inside a shared ledger.
  - State the effect, but do not fix approval-ground here; it is redrafted on top of this spec.
- **Every consumer.** `computeStaleness` and `src/app/planStaleness.ts` (the `phax run` gate and `phax plans status`), the spec approval chain (`readSpecApprovalRecord`, the spec-changed check), `phax artifact status`, run completion, the README and skills text that names `approvals.json` (`.claude/skills/phax-cli/SKILL.md`, `.claude/skills/phax-spec/SKILL.md`), `src/cli/cliDocs.ts`, and the docs site pages built from them.
- **Acceptance criteria.**
  - Two branches from the same main — one approving plan A, one completing plan B — merge in either order with no conflict.
  - The same holds for specs.
  - A run's PR that completes its plan merges cleanly after another plan was approved on main during the run.
  - The existing staleness, chain-gate and unreadable-record behaviours keep their tests.
  - A repository with an old ledger migrates with no record lost, verified against made-up ledgers.

Out of scope, named: approval-ground's own fix (its §9 is redrafted after this spec); a run completing its source spec while more plans are to come (the `completesSpec` plan field, its own spec); any change to what a fingerprint covers or to the staleness reasons.

Ground to read first:
- NEXT_STEPS.md (the entry above and §"Road to 1.0.0", the persisted-format stability promise)
- `src/domain/artifact/lineage.ts` (`APPROVALS_FILE_PATH`, `SPEC_APPROVALS_FILE_PATH`, `computeStaleness`), `src/domain/artifact/writeSet.ts`, `src/domain/artifact/document.ts` (`classifyArtifactPath`, `archivePathFor`), `src/domain/artifact/sidecar.ts` (`sidecarPathFor`)
- `src/app/approvalRecordStore.ts`, `src/app/artifactStatus.ts`, `src/app/completeRunArtifacts.ts`, `src/app/planStaleness.ts`
- `src/schemas/approvalRecord.ts`, `src/schemas/specApprovalRecord.ts`, `src/schemas/persisted.ts`, `packages/schemas/src/formats/repository.ts`
- `phax --usage` (cmd artifact, cmd plans)
- the archived spec that introduced the records: `docs/specs/archive/2608091526-plan-staleness-lineage.md`

Constraints:
- No CLI command, flag or exit code changes beyond the one migration command, which goes through `phax.usage.kdl` like every command.
- Test ledgers and records are made up; nothing from `~/.phax` or another repository enters this public repository.
- §9 records the five decisions above. Add a question only for a genuine choice the brief leaves open (e.g. the migration command's name), with options, what each abandons, and a recommended default.

Output: your final message is the spec document JSON and nothing else — no sentence before or after it, no code fence.
