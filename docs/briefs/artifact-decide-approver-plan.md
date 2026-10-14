Write the phax plan "Approver attribution and reopen". It is the first of three plans for the approved spec `docs/specs/2610140742-artifact-decide.md`, so it carries `completes-spec: false`. Read the spec in full; this plan implements only the part listed below. Decided with the author on 2026-10-14: the spec is split into three plans, run in order, each authored after the previous one merges:
- A: approver attribution and reopen (this plan).
- B: the question model, the renderer and `migrate-documents`.
- C: the `decide` command, the doctrine skills and the approval lock.

In scope:
- **Requirements:** §5.35–§5.37 (reopen from Approved, its refusals, a reopened spec leaves its plans), §5.40–§5.45 (`--by`, the terminal default, the no-terminal refusal, `approvedBy` on new records, the lift of 0.19.0 records, unattributed stays unattributed) and §5.57 (status names the approver, for specs and plans).
- **Surfaces in §6:** `phax artifact approve`, `phax artifact reopen` and the approval record files, plus the approval-record rows of the persisted-formats table. Also the approver part of `phax artifact status`: the `Approved:` line with `by machine (<grant>)`, `by operator (<name>)` or `unattributed`, for plans as well as specs, and Draft among an Approved artifact's legal transitions.
- **§8 criteria:** "Approvals name their approver", "Records written before attribution read as unattributed", and "Artifact reopen returns an Approved artifact to Draft" and "Reopening a spec names its plans and leaves them", minus their decide steps, which belong to plan C. Their status assertions cover the approver only.

Out of scope, named in the plan's excluded scope:
- **Plan B:** open and arbitrated questions, the `Questions:` status line, the renderer, `spec-document`/`plan-document` shape changes, `migrate-documents`, and the refusals while a sidecar is unmigrated, including reopen's.
- **Plan C:** `decide`, the decision record, decision attribution (§5.25), the doctrine skills, `skills install`, and the approval lock that refuses approval while a question is open (§5.38–§5.39).

Decided with the author on 2026-10-14. Record each in `## Technical arbitrations` with the loss accepted:
- **A grant is a kebab-case slug**, `^[a-z0-9]+(-[a-z0-9]+)*$`; `--by machine:<grant>` with anything else exits 12, naming the pattern. Loss: free-form labels (spaces, dots, `name@1.2`) must be folded into a slug by the caller.
- **An operator approval or reopen without a git `user.name` refuses with exit 12** before writing anything, naming `git config user.name` as the remedy. Loss: a repository with only `user.email` set needs one config line before approving.
- **The approve commit is unchanged**: the record file carries the approver. Only reopen's commit gains a trailer naming the arbiter (§5.35), for Approved → Draft and Stale → Draft alike. Its spelling follows the spec's indicative `Reopened-By: machine (roadmap-loop)` / `Reopened-By: operator (<name>)`.

Ground to read (the spec's §1 is current as of 2026-10-14; these are the files the plan touches):
- **The precedent for a persisted shape change is `e2b55922`** (authoring-record-manifest gained `retry`, shipped in 0.23.0); `docs/plans/archive/*small-fixes-0-23-plan.md` phase 03 spells the steps out. Follow it for both `spec-approval-record` and `plan-approval-record`:
  - freeze each current shape as `src/schemas/history/<format>/0.19.0.ts`, rendering to its 0.19.0 snapshot;
  - list it among the format's releases in the schemas package (`packages/schemas/src/formats/`) and upgrade it with `approvedBy: { kind: "unattributed" }`;
  - lift a file stamped below the current shape in `src/schemas/persisted.ts`;
  - run `pnpm exec tsx scripts/schemas-check.ts --write`, which records each `next` snapshot and moves `src/schemas/release.ts`, `packages/schemas/src/generated/index.ts` and `packages/schemas/history.lock.json`. Never hand-edit those generated files.
- **The spec's "0.24.0" stands for the release that ships it.** 0.24.0 has since shipped, so the new shapes are recorded as `next` snapshots and take the opened version (`package.json`) at the next cut. Never write a release number by hand.
- **`approvedBy` is an explicit per-variant union:** `{ kind: "machine", grant }`, `{ kind: "operator", name }` and `{ kind: "unattributed" }`. It is required at the new shape, comes after `baseline` in spec records and after `sourceSpec` in plan records, and no field becomes optional. A record that phax only reads stays byte-identical on disk.
- **Approval files:** `src/schemas/specApprovalRecord.ts`, `src/schemas/approvalRecord.ts`, `src/domain/artifact/approvalRecordFile.ts` and `src/app/artifactStatus.ts`. `phax artifact migrate-approvals` must now write each split ledger entry at the new shape as `unattributed`.
- **Every reader of plan approval records** (`phax plans status`, `phax run`'s approval gate, staleness) reads through the one lift, and plan staleness is computed as before.
- **Lifecycle:** `src/domain/artifact/status.ts` (Approved → Draft becomes legal for specs and plans; use the `state-machines` skill), `src/domain/artifact/lineage.ts` (reopen changes only `status` and `approved`, which the fingerprint ignores, so a bound plan stays fresh), and the auto-commit of artifact transitions.
- **Two capabilities phax lacks today; route each through a port** (`effect-services`, `boundaries` skills):
  - Reading the committing git identity (`user.name`); no git port reads config today.
  - Telling whether the command runs from a terminal; only `src/cli/commands/prune.ts` and `init.ts` look at it today. Follow their precedent for which stream decides.
- **CLI:** `phax.usage.kdl` gains `--by` on `approve` and `reopen`, and reopen's help widens from "a Stale plan". Run `pnpm gen:usage-spec` and `pnpm docs:cli`.
- **Skills:** `.claude/skills/phax-cli/SKILL.md`, and where they describe approve or reopen, `phax-spec` and `phax-planning`, gain `--by`, the no-terminal refusal and reopen from Approved. The run needs `--allow-skill-edits`, so name exactly these files. The phax-planning generated catalog table is untouched.
- **NEXT_STEPS.md:** the `artifact-decide` entry notes that plan A shipped attribution and reopen.

Phase shape: as few as the gates allow, inside-out. A likely split is (1) the two formats with their frozen 0.19.0 shapes, lifts and `next` snapshots, `migrate-approvals`, and the status approver line, then (2) `--by`, the identity and terminal ports, approve writing `approvedBy`, reopen from Approved with its trailer and bound plans, usage, docs and skills. Merge or split as the gates require. Approve must write a valid record at every commit, so the phase that makes `approvedBy` required also makes approve write it.

Constraints:
- The plan's own phases name only models in the installed 0.23.0 catalog: `claude-opus-5-5` (the default) or `claude-sonnet-5-5` for mechanical work.
- Every phase is verified by the `standard` gate profile, and every command it runs must be allowed by `phax.json`.
- Fixtures and examples are made up.
- It must pass `phax plans lint`.

Output: your final message is the plan document JSON and nothing else — no sentence before or after it, no code fence.
