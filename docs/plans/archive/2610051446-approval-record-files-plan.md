---
status: Completed
source-spec: docs/specs/2610051433-approval-record-files.md
approved:
  date: 2026-10-05
  baseline: 9f92590
---
# Approval record files

Implements the Approved spec `approval-record-files` in full, so the run completes the spec. Every approval record moves out of the shared ledgers (`docs/plans/approvals.json`, `docs/specs/approvals.json`) into its own record file: `docs/plans/approvals/<plan>.json` or `docs/specs/approvals/<spec>.json`. Each record file is a `$schema` document of the new formats `plan-approval-record` / `spec-approval-record`, and it carries `artifact`. A transition then writes only its own artifact's files, so two branches that transition different artifacts merge without conflict. While an old ledger exists, the commands that read or write records refuse with exit 12. The one-time `phax artifact migrate-approvals` command splits the old ledgers in a single commit. After that, phax never writes a ledger again.

The phases go inside-out: formats, then the per-file store with transitions and run completion, then real-git merge acceptance, orphan warnings, the old-ledger refusal, the migration command, and the docs. Every acceptance criterion in spec §8 is mapped to a test in some phase's test strategy. All test ledgers, records and repositories are made up. No phase runs `migrate-approvals` on this repository's own tree. Phase 07 edits `.claude/skills/phax-cli/SKILL.md` and `.claude/skills/phax-spec/SKILL.md`, so this plan must run with `phax run --allow-skill-edits`.

## Required commands

- (none)

This plan adds no commands. It uses `pnpm exec tsx scripts/schemas-check.ts --write`, `pnpm gen:usage-spec` and `pnpm docs:cli`, and `security.agentCommands` in `phax.json` already allows all three (`pnpm exec tsx`, `pnpm gen:usage-spec`, `pnpm docs:cli`). The phax security configuration needs no change.

## Technical arbitrations

- A record file is in a transition's write-set only when it exists before or after the transition. `commitPaths` (`src/infra/git.ts`) runs `git add -A -- <paths>`, and that fails on a pathspec that matches nothing. Approve always lists its own record file, because it writes it. Reopen, complete and abandon list it only when it exists at the start of the transition, and the store reports whether it does. Loss accepted: `transitionWriteSet` stops being a pure function of kind and target and takes `hasRecordFile` as an input. Rejected: making `commitPaths` tolerate pathspecs that match nothing, which would hide a misspelled write-set path.
- `ApprovalLedgerUnreadableError` is renamed to `ApprovalRecordUnreadableError` (spec §10 left this open). It shipped in PR #117 after v0.18.0, so no release carries the old name. Exit code 12 is unchanged, and the README exit-code table is untouched. Loss accepted: none beyond the rename. The old-ledger refusal (§5.14) is a separate error, `ApprovalLedgerMigrationRequiredError`, which names the ledger and `phax artifact migrate-approvals` and also exits 12.
- The brief assumed `preSchema?: never` in `packages/schemas/src/shapes.ts` declares a format born with `$schema`. It does not. That variant (`CurrentPreSchemaSpec`) means the current decoder IS the pre-schema decoder, with `current.name` `pre-schema`, so a record file without `$schema` would read as valid, which contradicts spec §6 ('a record file without `$schema` is unreadable'). Decision (spec §10 leaves it to the planner): add a third `FormatSpec` variant for a format born with `$schema`, plus a matching born-with-`$schema` reader in `src/schemas/persisted.ts`. Package tooling and tests that assume one frozen pre-schema module and a 0.17.0 snapshot for every format id are narrowed to the formats that have them. The new formats get `next` snapshots through `scripts/schemas-check.ts --write`. Loss accepted: the package's 'every format has a pre-schema shape' invariant, so per-format tables gain a with/without-pre-schema distinction.
- The brief split the store (its phase 2) from transitions (its phase 3), but neither half can be committed on its own. The store's API change reaches every caller (`transitionArtifact`, `computeStalenessForPlan`, spec approval info), and the write-set must name the record file in the same commit that starts writing it. So one phase swaps the store, classification, write-set, transitions, run completion and the staleness lookup together, verified with fake ports. The cross-branch real-git merge criteria, real-git complete/abandon and §5.22 get their own following phase. Loss accepted: phase 02 is the largest diff to review, and the real-git proof of the exists rule lands one phase after the rule.
- Between phase 01 and phase 02, `tests/integration/persistedProducer.test.ts` excludes the two new record formats from its 'every format is produced' check, because nothing writes them yet. Phase 02 swaps that exclusion to `plan-approvals` / `spec-approvals`, which phax never writes again (§5.21). Loss accepted: for one phase, the new formats are declared but have no producer.
- The old-ledger refusal is one store-level check, `refuseOldApprovalLedgers`, called first in `transitionArtifact`, `inspectArtifact`, `plansStalenessReport` and `computeStalenessForPlan`. Run completion inherits it through `transitionArtifact` against the worktree-rooted FileSystem, so a run started before migration pauses as ArtifactCompletionFailed, as spec §10 documents. Loss accepted: the refusal is per use case, so a future use case that reads records must remember to call it.
- A record path is derived only for a live artifact path: directly under `docs/plans/` or `docs/specs/`, ending in `.md`. A record lookup for an archive path is 'no record' and never touches disk. Loss accepted: an archived artifact can never carry a record, even one placed by hand, which matches §5.7.
- This repository's own ledgers are migrated after the release, not in this plan (spec §10 default). The run executing this plan is driven by the installed phax 0.18, which still writes `docs/plans/approvals.json` at completion. No phase runs `migrate-approvals` on the real tree. Phase 07 records the post-release migration as a NEXT_STEPS item. Loss accepted: this repository keeps its old ledgers, and the new phax refuses on them, until the author migrates by hand after the release.

---

## phase-01 — Approval record file formats {#phase-01-record-formats}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

Declare `plan-approval-record` and `spec-approval-record` as published persisted formats, born with `$schema`. phax gets a decoder and a reader for each, and `@lbdremy/phax-schemas` gets a parse function for each. The old ledger formats stay readable in every released shape.

### Detailed instructions

- `src/schemas/schemaUrl.ts`: append `plan-approval-record` and `spec-approval-record` to the END of `FORMAT_IDS`, so existing order and generated output stay stable. Update the doc comment's count.
- `src/schemas/approvalRecord.ts`: keep the ledger schemas (`ApprovalRecordFileSchema`, which is the plan-approvals LEDGER) byte-for-byte, and add a comment saying they are the old ledger, read only to migrate. Add `PlanRecordFileSchema` = `Schema.Struct({ $schema: schemaUrlField("plan-approval-record"), artifact: Schema.NonEmptyString, ...ApprovalRecordSchema.fields })`. Add the type `PlanRecordFile`, an in-memory type `PlanRecord` (the file without `$schema`: artifact + planFingerprint, approvedAt, baseline, sourceSpec), `decodePlanRecordFile` (`Schema.decodeUnknownEither` with `onExcessProperty: "error"`) and `encodePlanRecordFile`.
- `src/schemas/specApprovalRecord.ts`: the same for specs. `SpecRecordFileSchema` has `$schema: schemaUrlField("spec-approval-record")`, `artifact`, specFingerprint, approvedAt and baseline (40-hex). Add `SpecRecordFile`, `SpecRecord`, `decodeSpecRecordFile` and `encodeSpecRecordFile`. Leave `SpecApprovalRecordFileSchema` (the spec LEDGER) unchanged and comment it as the old ledger.
- `packages/schemas/src/shapes.ts`: add a third `FormatSpec` variant for a format born with `$schema`, e.g. `SchemaBornSpec<M>` with `preSchema: null`, `releases: ReadonlyArray<ReleaseEntry<M>>` and `current: NamedShape<M, "next" | release>`. Its shape map has no `pre-schema` key. In `defineFormat`, a document without `$schema` for such a format fails at `$schema` with a message naming the label, e.g. `<label> has no $schema — every <label> is written with one`, and no decoder is tried. Update the doc comments that say every map has a pre-schema shape. The two existing variants keep their behaviour exactly.
- `packages/schemas/src/formats/repository.ts`: add `planApprovalRecordFormat` and `specApprovalRecordFormat` with `preSchema: null`, `releases: []` and `current: { name: CURRENT_SHAPES[...], shape: { schema, decode } }`. Export `parsePlanApprovalRecord`, `toLatestPlanApprovalRecord`, `LatestPlanApprovalRecord` and `PlanApprovalRecordShape`, and the spec equivalents. Relabel the existing ledger formats' doc comments as old ledgers read to migrate, keeping their ids, labels and decoders. Update the file header.
- `packages/schemas/src/index.ts`: export `PlanRecordFileSchema as PlanApprovalRecordSchema`, `type PlanRecordFile as PlanApprovalRecord` and the spec equivalents, plus the parse/toLatest functions and types. Add both formats to `DocumentShapes` and to the `parseDocument` map.
- `packages/schemas/build/jsonSchemas.ts`: add both formats to `FORMAT_DEFINITIONS`, and to `EXCESS` as `"error"`.
- `src/schemas/persisted.ts`: support a format with no pre-schema decoder, either through a discriminated `PersistedSpec` variant (`decodePreSchema: null`) or through a sibling `readSchemaBornPersisted`. The newer-release refusal and the current-decoder path stay identical. A document without `$schema` fails with a `PersistedReadError` whose message starts with the file and says it has no `$schema`. Export `readPlanRecordFile: Reader<PlanRecord>` and `readSpecRecordFile: Reader<SpecRecord>`. Do not wire them into the store yet.
- Run `pnpm exec tsx scripts/schemas-check.ts --write` to create `packages/schemas/snapshots/<id>/next.schema.json` for both formats and to regenerate `packages/schemas/src/generated/index.ts`. Never hand-edit generated files. `packages/schemas/history.lock.json` and everything under `src/schemas/history/` stay untouched. If `scripts/schemas-check.ts` or `packages/schemas/build/snapshots.ts` assume a frozen pre-schema module or a pre-schema snapshot for every format id, narrow that to formats with a pre-schema slot.
- Narrow every test invariant that assumes every format id has a frozen pre-schema module or a 0.17.0 snapshot: `tests/unit/schemasPackage/frozenHistory.test.ts` ('one frozen module per format id') and `tests/unit/site/schemas.test.ts` (the real 0.17.0 snapshot per format id). Bump the format count in `tests/unit/schemaUrl.test.ts` (15 → 17). Fill the per-format tables in `tests/unit/schemasPackage/documents.ts`, `tests/unit/architecturalGuards.test.ts` (decoder names per format), `tests/unit/persisted.test.ts` and `tests/type/schemasPackage.ts`, plus any other `Record<FormatId, …>` table the typecheck flags.
- `tests/integration/persistedProducer.test.ts`: the 'covers all format ids' check expects `FORMAT_IDS` minus the two record formats, through a named constant whose comment says phase-02 swaps it (nothing writes them yet).
- README `## Persisted formats` table, forced by `tests/unit/readmePersistedFormats.test.ts`: add the rows `Plan approval record | plan-approval-record | docs/plans/approvals/<plan>.json | parsePlanApprovalRecord | json/plan-approval-record.schema.json` and the spec equivalent. Relabel the old rows `Plan approvals (old ledger, read to migrate)` and `Spec approvals (old ledger, read to migrate)`, exactly as spec §6 shows. Touch nothing else in the README in this phase.

### Planned files to create

- `packages/schemas/snapshots/plan-approval-record/next.schema.json`
- `packages/schemas/snapshots/spec-approval-record/next.schema.json`
- `tests/unit/schemas/approvalRecordFile.test.ts`

### Planned files to edit

- `src/schemas/schemaUrl.ts`
- `src/schemas/approvalRecord.ts`
- `src/schemas/specApprovalRecord.ts`
- `src/schemas/persisted.ts`
- `packages/schemas/src/shapes.ts`
- `packages/schemas/src/formats/repository.ts`
- `packages/schemas/src/index.ts`
- `packages/schemas/src/generated/index.ts`
- `packages/schemas/build/jsonSchemas.ts`
- `README.md`
- `tests/unit/schemaUrl.test.ts`
- `tests/unit/persisted.test.ts`
- `tests/unit/schemasPackage/documents.ts`
- `tests/unit/schemasPackage/repositoryFormats.test.ts`
- `tests/unit/schemasPackage/frozenHistory.test.ts`
- `tests/unit/schemasPackage/exports.test.ts`
- `tests/unit/site/schemas.test.ts`
- `tests/unit/architecturalGuards.test.ts`
- `tests/integration/persistedProducer.test.ts`
- `tests/type/schemasPackage.ts`

### Optional files that may be edited

- `packages/schemas/build/snapshots.ts`
- `packages/schemas/build/generated.ts`
- `packages/schemas/src/document.ts`
- `packages/schemas/README.md`
- `scripts/schemas-check.ts`
- `scripts/schemas-smoke.ts`
- `site/build/schemas.ts`
- `tests/unit/schemasPackage/currentShapes.test.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/jsonSchemas.test.ts`
- `tests/unit/schemasPackage/parseDocument.test.ts`
- `tests/unit/schemasPackage/preSchemaModules.test.ts`
- `tests/unit/schemasPackage/documents.test.ts`
- `tests/unit/schemasPackage/snapshots.test.ts`
- `tests/unit/readmePersistedFormats.test.ts`
- `tests/unit/schemas/specApprovalRecord.test.ts`

### Boundary contracts

Producer: `src/schemas/` declares the record file schemas and `persisted.ts` readers. Consumers: the per-file store (phase-02) and the package. Stable shape: a record file is `{ $schema, artifact, ...record fields }`, with no other key, and an unknown key is rejected. In memory, a record is the file without `$schema`. Package consumers get `parsePlanApprovalRecord` / `parseSpecApprovalRecord`, which never throw. A document without `$schema` fails, and a `$schema` naming another format fails.

### Test strategy

Write the format tests BEFORE implementation in `tests/unit/schemas/approvalRecordFile.test.ts`. Cover: a valid plan record (with `sourceSpec` and with null) and a valid spec record decode; a missing `artifact`, an extra key, a non-40-hex baseline and a `$schema` naming `plan-approvals` are rejected; `readPlanRecordFile` / `readSpecRecordFile` refuse a document without `$schema`, a newer-release `$schema` and non-objects, each with a message starting with the file. Extend `tests/unit/schemasPackage/repositoryFormats.test.ts`: both new formats parse their `$schema` documents as shape `next` and fail a `$schema`-less document. `plan-approvals` / `spec-approvals` still parse their pre-schema and 0.17.0/0.18.0 `$schema` shapes, which covers the parse half of the §8 'Old formats stay readable and are never written' criterion; the never-written half is phases 02 and 06. The record format part of §8 'Plan approval writes its own record file' (keys exactly `$schema`, artifact, planFingerprint, approvedAt, baseline, sourceSpec) is pinned by the decoder's excess-property rejection. Existing package tests (snapshots, parity, parseDocument, jsonSchemas, exports, the README formats test) must pass with the new ids.

### Implementation order

1. schemaUrl.ts format ids
2. Record file schemas in approvalRecord.ts / specApprovalRecord.ts plus their unit tests
3. persisted.ts born-with-$schema reader
4. shapes.ts variant, repository.ts formats, index.ts exports, jsonSchemas.ts
5. schemas-check --write (snapshots + generated index)
6. Narrow tooling/test invariants and fill per-format tables
7. README persisted-format rows

### Excluded scope

- Any change to approvalRecordStore.ts, transitions, write-sets or staleness (phase-02).
- Changing or removing plan-approvals / spec-approvals decoders, frozen history modules or history.lock.json.
- Any other README section (phase-07).

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

Name the exact exports: `PlanRecordFileSchema`, `PlanRecordFile`, `PlanRecord`, `decodePlanRecordFile`, `encodePlanRecordFile` (src/schemas/approvalRecord.ts); the Spec* equivalents (src/schemas/specApprovalRecord.ts); `readPlanRecordFile` / `readSpecRecordFile` (src/schemas/persisted.ts) and their failure messages. Give the new `FormatSpec` variant's name and shape. List every test invariant you narrowed and why. Say where the persistedProducer exclusion constant lives so phase-02 can swap it. Explain any deviation from the planned file lists.

### Commit subject

`feat(schemas): add plan-approval-record and spec-approval-record formats`

### Commit body

Declare the two per-artifact approval record formats from spec approval-record-files §5.3 and §9 Q10. Each is a $schema document carrying `artifact` plus every field of the record it replaces. Both are born with $schema: a document without $schema is unreadable, so packages/schemas gains a format variant with no pre-schema shape, and phax gains a matching reader. The formats get next snapshots, package parse functions and README persisted-format rows. plan-approvals and spec-approvals keep every released shape and their frozen decoders (§5.21). Nothing writes the new formats yet.

---

## phase-02 — Per-artifact record store and transitions {#phase-02-record-store}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

Every approval record is read, written and deleted as its own file, named after its artifact. Each transition (approve, reopen, complete, abandon, and run completion) touches only the transitioned artifact's own record file, and record files are never treated as artifacts.

### Detailed instructions

- Create `src/domain/artifact/approvalRecordFile.ts` (pure). It holds `PLAN_APPROVAL_RECORD_DIR = "docs/plans/approvals/"`, `SPEC_APPROVAL_RECORD_DIR = "docs/specs/approvals/"`, and `isLiveArtifactPath(kind, path)`: directly under `docs/plans/` or `docs/specs/` (no further `/`) and ending in `.md`. It also holds `approvalRecordPathFor(kind, artifactPath): string | null` (`.md` → `.json` under the kind's approvals dir, and null for anything not live: archive paths, nested paths, record paths), `artifactPathForRecordFile(recordPath): { kind, artifact } | null` (the inverse, for a `.json` directly under an approvals dir), and `isApprovalRecordPath(path)`.
- `src/domain/artifact/document.ts` `classifyArtifactPath`: return null for any path under `docs/plans/approvals/` or `docs/specs/approvals/`, checked before the generic `docs/plans/` / `docs/specs/` prefixes. `validateArtifact` then refuses such a path with the existing 'not a recognized artifact path' `ArtifactValidationError` (exit 12), and `archivePathFor` never applies to it. Keep the `.md`-only walks in `findDependentPlans` and `plansStalenessReport` unchanged; they already skip the `approvals/` directory entry.
- `src/domain/errors.ts`: rename `ApprovalLedgerUnreadableError` to `ApprovalRecordUnreadableError`, with fields `{ message, recordPath }`, and update its doc comment (a record file that is not JSON, fails to decode, has no `$schema`, names a newer release, or records another artifact). Update every import, union and the exit-12 mapping in `src/cli/commands/runLayers.ts`, along with the doc comment there that names approvals.json.
- `src/domain/artifact/lineage.ts`: delete `APPROVALS_FILE_PATH` and `SPEC_APPROVALS_FILE_PATH`; nothing reads a ledger now, and phase-05 adds old-ledger constants in approvalRecordFile.ts.
- Rewrite `src/app/approvalRecordStore.ts` with no shared object and no read-modify-write. Plan functions: `readPlanApprovalRecord(planPath)`, `putPlanApprovalRecord(planPath, record)`, `removePlanApprovalRecord(planPath)`, `planApprovalRecordExists(planPath)`; spec functions mirror them (`readSpecApprovalRecord`, `putSpecApprovalRecord`, `removeSpecApprovalRecord`, `specApprovalRecordExists`). Read: derive the own path, where null means no record and no disk access; a missing file is null; otherwise readText → JSON.parse → `readPlanRecordFile` / `readSpecRecordFile`. Any failure is `ApprovalRecordUnreadableError` naming the record file. When the decoded `artifact` differs from the path the file name derives, fail with a message like `<recordFile>: records <other>, not <artifact> — restore it from git, or delete it and re-approve` (§5.12). Put: read the own file first, so an unreadable existing file is refused and left byte-identical; then mkdirp the approvals dir and writeAtomic `JSON.stringify(encodePlanRecordFile(withSchemaUrl("plan-approval-record", { artifact, ...record })), null, 2)`, with key order `$schema`, artifact, then the record fields. Remove: read first (refusing unreadable), then `fs.remove` if present. Keep `artifactFingerprint`.
- `src/domain/artifact/writeSet.ts`: `transitionWriteSet(kind, path, target, { hasSidecar, hasRecordFile })`. On Approved, always push the own record path. On plan Draft (reopen) and on terminal targets, push it only when `hasRecordFile`. Stale pushes none. Never push another artifact's path. Order: artifact, sidecar, record file, then the archive paths.
- `src/app/artifactStatus.ts`: compute `hasRecordFile` through the store's exists function before building the write-set. Use the new put/remove/read functions. Keep 'remove the record before the move' so an unreadable record refuses before anything moves. `computeSpecApprovalInfo` and the plan-approval chain gate read the spec's own record file only. Update the reopen comment that names approvals.json.
- `src/app/planStaleness.ts`: `computeStalenessForPlan` reads only `readPlanApprovalRecord(planPath)`. Drop `readApprovalStore` and the stale comment about it. Rename the error in unions. `src/app/completeRunArtifacts.ts`: rename the error in `RunCompletionError`; behaviour is unchanged because transitions already scope to their own record file.
- Update the tests that seeded or asserted ledgers so they seed and assert record files: `tests/unit/artifact/lineage.test.ts` (store tests), `tests/unit/artifact/writeSet.test.ts`, `tests/integration/artifactStatus.test.ts`, `tests/integration/planStaleness.test.ts`, `tests/integration/completeRunArtifacts.test.ts` and `tests/integration/runCarriesCompletion.test.ts`. Keep every behavioural assertion: staleness reasons, chain gate, the unreadable rule.
- `tests/integration/persistedProducer.test.ts`: map `docs/plans/approvals/*.json` → `plan-approval-record` and `docs/specs/approvals/*.json` → `spec-approval-record`, and swap phase-01's exclusion to `plan-approvals` / `spec-approvals`, which phax never writes (§5.21). Assert that no writer touched `docs/plans/approvals.json` or `docs/specs/approvals.json`.
- Respect the layers: no `node:fs` or `node:child_process` in app/, domain/ or cli/; all I/O goes through the FileSystem and Git ports.

### Planned files to create

- `src/domain/artifact/approvalRecordFile.ts`
- `tests/unit/artifact/approvalRecordFile.test.ts`

### Planned files to edit

- `src/domain/errors.ts`
- `src/domain/artifact/lineage.ts`
- `src/domain/artifact/document.ts`
- `src/domain/artifact/writeSet.ts`
- `src/app/approvalRecordStore.ts`
- `src/app/artifactStatus.ts`
- `src/app/planStaleness.ts`
- `src/app/completeRunArtifacts.ts`
- `src/cli/commands/runLayers.ts`
- `tests/unit/artifact/lineage.test.ts`
- `tests/unit/artifact/writeSet.test.ts`
- `tests/unit/artifact/document.test.ts`
- `tests/integration/artifactStatus.test.ts`
- `tests/integration/planStaleness.test.ts`
- `tests/integration/completeRunArtifacts.test.ts`
- `tests/integration/runCarriesCompletion.test.ts`
- `tests/integration/persistedProducer.test.ts`
- `tests/unit/readmeExitCodes.test.ts`

### Optional files that may be edited

- `src/schemas/persisted.ts`
- `src/app/executePlan.ts`
- `src/app/resume.ts`
- `tests/integration/gitCommitPaths.test.ts`
- `tests/integration/repoRootedCli.test.ts`
- `tests/unit/artifact/commitFailedError.test.ts`
- `tests/unit/cli/artifact.test.ts`
- `tests/unit/cli/run.test.ts`

### Boundary contracts

Domain → app: `approvalRecordFile.ts` is the single source of the record path derivation. The store (app) consumes it and exposes per-artifact read/put/remove/exists. The store throws no exceptions. It fails only with `FsError | ApprovalRecordUnreadableError`, and `ApprovalRecordUnreadableError.recordPath` names the file. Transitions (app) consume the store, and `transitionWriteSet` (domain) takes `hasRecordFile` from the app. CLI exit-code mapping: `ApprovalRecordUnreadableError` → 12.

### Test strategy

Write BEFORE implementation: `tests/unit/artifact/approvalRecordFile.test.ts` covers derivation both ways; null for archive, nested, approvals and non-.md paths; `isLiveArtifactPath`. `tests/unit/artifact/writeSet.test.ts` covers the exists rule per kind × target (approve always lists it; reopen/complete/abandon only with `hasRecordFile`; Stale never). Map spec §8 to tests in this phase, using fake ports in `tests/integration/artifactStatus.test.ts`, `planStaleness.test.ts` and `tests/unit/artifact/lineage.test.ts`. 'Plan approval writes its own record file': the record content and the commitPaths paths are exactly plan (+ sidecar) + record file. 'Spec approval writes its own record file': approve, edit the body, re-approve; only that file is replaced. 'Reopen deletes the plan's record file': the other record is byte-identical. 'Complete and abandon delete the record file': with fake git, including that a never-approved Draft spec's abandon write-set excludes the record path. 'Another plan's record is never read': B's record is non-JSON; approving C succeeds; computeStalenessForPlan(A) is fresh; plansStalenessReport reports A fresh and an error only for B; B is byte-identical. 'Record files are not artifacts': classifyArtifactPath and validateArtifact refuse approvals/ paths; plansStalenessReport and the dependent-plan check ignore the approvals/ entry. 'A missing record file is no record': missing-record, unrecorded, and the plan approval refused as unrecorded. 'Unreadable record files are refused and kept': not JSON / no $schema / newer release / failing decode; approve and complete fail with ApprovalRecordUnreadableError; the file is byte-identical and the plan not moved; plans status reports an error entry. 'A copied record does not approve another artifact'. 'Existing staleness, chain-gate and unreadable tests keep passing': the rewritten fixtures keep their assertions. Real-git coverage of these paths follows in phase-03.

### Implementation order

1. approvalRecordFile.ts and its tests
2. classifyArtifactPath refusal and document tests
3. Error rename across errors.ts, runLayers.ts and unions
4. Per-file store and its tests (lineage.test.ts)
5. transitionWriteSet exists rule and its tests
6. artifactStatus.ts, planStaleness.ts, completeRunArtifacts.ts wiring
7. Fixture updates in the integration tests and the persistedProducer swap

### Excluded scope

- Real-git merge tests and §5.22 (phase-03).
- Orphan warnings and the orphanRecords JSON key (phase-04).
- The old-ledger refusal (phase-05) and the migration command (phase-06).
- Help text, README prose and skills (phase-07).
- Any change to fingerprint coverage, baseline meaning or staleness reasons.

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

Give the exact exported names and signatures from `src/domain/artifact/approvalRecordFile.ts` and `src/app/approvalRecordStore.ts`, and the new `transitionWriteSet` options shape. Confirm `ApprovalRecordUnreadableError` and its fields, and record the unreadable and mismatch message formats. Note which tests were rewritten from ledgers to record files, and confirm their behavioural assertions are unchanged. Confirm `APPROVALS_FILE_PATH` / `SPEC_APPROVALS_FILE_PATH` were removed. Explain any deviation from the planned file lists.

### Commit subject

`feat(artifact): store each approval record in its own file`

### Commit body

Replace the read-modify-write approval ledgers with one record file per artifact under docs/plans/approvals/ and docs/specs/approvals/ (spec approval-record-files §5.1–§5.12). A record is located from the artifact path alone. A missing file is no record. An unreadable file, or one whose `artifact` names another path, is refused with exit 12 and left byte-identical. Approve writes the artifact's own record file. Reopen, complete and abandon delete it. Each transition's write-set lists the record file only when it exists before or after the transition, so abandoning a never-approved Draft still commits. Paths under approvals/ never classify as artifacts. Rename ApprovalLedgerUnreadableError to ApprovalRecordUnreadableError.

---

## phase-03 — Real-git merge and staleness acceptance {#phase-03-merge-acceptance}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

Prove with real git merges that transitions of different artifacts on two branches never conflict, that run completion merges after an approval on main, and that another artifact's lifecycle no longer stales a plan.

### Detailed instructions

- Follow the temporary-repository pattern of `tests/integration/completeRunArtifacts.test.ts`: mkdtemp, `git init`, a local user.name/user.email, made-up specs and plans with valid frontmatter and made-up stamps/slugs, and the real rooted Node FileSystem and Git layers. Drive the app use cases (`transitionArtifact`, `completeRunArtifacts`, `computeStalenessForPlan`) with `commit: true`. Test files may call git directly to branch, merge and inspect.
- `tests/integration/approvalRecordMerge.test.ts`, 'Plan transitions on two branches merge cleanly': from one main commit, branch 1 approves Draft plan A and branch 2 completes Approved plan B; variants run reopen (Stale B) and abandon. Merge both into main in both orders. Assert no conflict, `docs/plans/approvals/<A>.json` present, and no record file for a completed or abandoned B.
- Same file, 'Spec transitions on two branches merge cleanly': branch 1 approves Draft spec S1; branch 2 completes Approved spec S2 (no live dependents), with an abandon variant. Merge in both orders. Assert no conflict, S1's record present, S2's absent.
- Same file, 'A run's PR merges after an approval on main': Approved plan B declares an Approved, recorded spec. Add a run worktree on a branch (`git worktree add`). On main, approve Draft plan A and commit. Call `completeRunArtifacts` for B in the worktree, so its commits delete B's record file and, where the chain gate allows, the spec's. Merge the run branch into main. Assert no conflict, A's record present, and both deleted record files absent.
- Same file: 'Complete and abandon delete the record file' on real git. Each commit moves the artifact (and sidecar) into archive/ and deletes its record file; `git ls-files` shows nothing under `docs/plans/archive/approvals/` or `docs/specs/archive/approvals/`; abandoning a never-approved Draft spec commits successfully. Also 'Plan approval writes its own record file': `git show --name-only HEAD` lists exactly the plan, its sidecar when present, and `docs/plans/approvals/<plan>.json`.
- `tests/integration/approvalRecordGround.test.ts`, 'Another plan's lifecycle no longer stales a plan' (§5.22): approve plan P; then approve plan Q and complete Q, both after P's baseline. `computeStalenessForPlan(P, md, footprint)` with a footprint naming `docs/plans/approvals.json` and none of Q's files returns fresh. A variant whose footprint names Q's own record file reports ground-changed (the 'unless' clause of §5.22).
- If a test exposes a defect in phase-02's write-set or store (for example a deletion not committed), fix it in the optional src files and explain in the handoff. Otherwise this phase touches tests only.
- Every repository, ledger and record is made up and created under the OS temp dir. Nothing from `~/.phax` or another repository enters the tests.

### Planned files to create

- `tests/integration/approvalRecordMerge.test.ts`
- `tests/integration/approvalRecordGround.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- `tests/integration/completeRunArtifacts.test.ts`
- `src/domain/artifact/writeSet.ts`
- `src/app/artifactStatus.ts`

### Test strategy

This phase is the real-git acceptance layer for behaviour phase-02 shipped and unit-tested. It maps spec §8: 'Plan transitions on two branches merge cleanly', 'Spec transitions on two branches merge cleanly' and 'A run's PR merges after an approval on main' (approvalRecordMerge.test.ts); 'Complete and abandon delete the record file' and the commit-paths half of 'Plan approval writes its own record file' (approvalRecordMerge.test.ts); 'Another plan's lifecycle no longer stales a plan' (approvalRecordGround.test.ts). Each merge criterion runs in both merge orders.

### Implementation order

1. Shared temp-repo and artifact-fixture helpers inside the new test files
2. Plan and spec two-branch merges
3. Run-completion merge
4. Real-git complete/abandon and approve commit paths
5. §5.22 ground test

### Excluded scope

- New production behaviour; src changes only to fix a defect these tests expose.
- Orphans, the old-ledger refusal and migration.

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

List each §8 criterion covered and its test name. Record any phase-02 defect found and fixed, with the file and the reason. Explain any deviation from the planned file lists.

### Commit subject

`test(artifact): prove approval record files merge cleanly across branches`

### Commit body

Add real-git integration tests in made-up temporary repositories for spec approval-record-files §8. Plan and spec transitions on two branches merge cleanly in either order. A run's completion branch merges after an approval on main. Complete and abandon delete the record file and never create archive/approvals/, and abandoning a never-approved Draft commits. An approve commit holds exactly the plan, its sidecar and its record file. Another artifact's lifecycle is no longer ground change (§5.22).

---

## phase-04 — Orphan record warnings {#phase-04-orphan-records}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

Make orphan record files visible without failing anything. Both status commands warn on stderr, and `phax plans status --json` carries a required `orphanRecords` array.

### Detailed instructions

- Domain (`approvalRecordFile.ts`): add `OrphanApprovalRecord { recordFile, artifact }`. Domain render (`render.ts`): add `renderOrphanRecordWarning(orphan)` → `warning: orphan approval record <recordFile> — <artifact> does not exist; delete the record file`.
- Store: add `findOrphanApprovalRecords(kind)`. List the kind's approvals dir when it exists, keep `.json` entries that `artifactPathForRecordFile` accepts, and report those whose derived artifact does not exist, sorted. It never reads record contents, so an unreadable record is never an orphan error.
- `plansStalenessReport` returns `{ report, orphanRecords }` (plan kind) instead of the bare report. Keep the `.md`-only walk. Update callers: `src/cli/commands/plans.ts`, `tests/integration/repoRootedCli.test.ts` and `tests/unit/cli/plans.test.ts`.
- `src/cli/commands/plans.ts`: in text mode, `out.warn` each orphan's warning (confirm `OutputPort.warn` writes to stderr) and keep the report on stdout. In `--json` mode, stdout is one document `{ report, orphanRecords }`, plus `applied` under `--apply` as today, and `orphanRecords` is always present. The exit code is whatever it would be without orphans.
- `inspectArtifact`: `ArtifactReport` gains a required `orphanRecords` for the inspected artifact's kind. `runArtifactStatus` warns for each orphan on stderr, and its exit code and stdout lines are unchanged.
- The CLI stays thin: one use case per command, rendering through domain functions and OutputPort.

### Planned files to create

- `tests/unit/artifact/render.test.ts`

### Planned files to edit

- `src/domain/artifact/approvalRecordFile.ts`
- `src/domain/artifact/render.ts`
- `src/app/approvalRecordStore.ts`
- `src/app/planStaleness.ts`
- `src/app/artifactStatus.ts`
- `src/cli/commands/plans.ts`
- `src/cli/commands/artifact.ts`
- `tests/integration/planStaleness.test.ts`
- `tests/integration/artifactStatus.test.ts`
- `tests/integration/repoRootedCli.test.ts`
- `tests/unit/cli/plans.test.ts`

### Optional files that may be edited

- `tests/unit/cli/artifact.test.ts`
- `tests/unit/artifact/approvalRecordFile.test.ts`
- `src/cli/cliDocs.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`

### Boundary contracts

App → CLI: `plansStalenessReport` yields `{ report: StalenessReport, orphanRecords: readonly OrphanApprovalRecord[] }`, and `ArtifactReport.orphanRecords` has the same element type. The `--json` contract adds the required key `orphanRecords: [{ recordFile, artifact }]` beside `report`, and `report` keeps its shape.

### Test strategy

Write BEFORE implementation: `tests/unit/artifact/render.test.ts` checks the warning text names the record file, its artifact and the delete remedy. Map §8 'Orphan record files warn': `tests/integration/planStaleness.test.ts` seeds `docs/plans/approvals/<gone-plan>.json` with no plan and asserts `orphanRecords` lists it with its derived artifact, an unreadable orphan is still only an orphan, `report` is unchanged, and it is empty once the file is removed. `tests/integration/artifactStatus.test.ts` seeds a spec orphan and inspects a live spec; the report lists the spec orphan only, and no file changes. `tests/unit/cli/plans.test.ts` checks that text mode warns on stderr with the same exit code, and that `--json` stdout parses to `{ report, orphanRecords }`, with an empty array when there is none.

### Implementation order

1. Orphan type and render function plus render test
2. Store finder
3. plansStalenessReport and inspectArtifact results
4. CLI rendering and its tests

### Excluded scope

- Failing or deleting anything because of an orphan.
- plans lint changes.
- The old-ledger refusal and migration (phases 05–06).

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

Give the new signatures (`findOrphanApprovalRecords`, the `plansStalenessReport` result type, `ArtifactReport.orphanRecords`), the exact warning text from `renderOrphanRecordWarning`, the `--json` document shape, and confirm `out.warn` goes to stderr. Phase-06 reuses `renderOrphanRecordWarning` for migration orphans. Explain any deviation from the planned file lists.

### Commit subject

`feat(plans): warn about orphan approval record files`

### Commit body

`phax plans status` and `phax artifact status` now print a stderr warning for each record file of the reported kind whose artifact does not exist, naming the file to delete, and leave the exit code and every file unchanged (spec approval-record-files §5.13, §9 Q3). `phax plans status --json` gains a required `orphanRecords` array beside `report`, which is empty when there are none (§9 Q8).

---

## phase-05 — Refuse while an old ledger exists {#phase-05-old-ledger-refusal}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

Make the presence of either old ledger an explicit exit-12 refusal, before any write, in every command spec §5.14 lists.

### Detailed instructions

- `approvalRecordFile.ts`: add `OLD_PLAN_LEDGER_PATH = "docs/plans/approvals.json"` and `OLD_SPEC_LEDGER_PATH = "docs/specs/approvals.json"`.
- `src/domain/errors.ts`: add `ApprovalLedgerMigrationRequiredError` `{ message, ledgerPath }`. The message reads like `<ledgerPath> is an approval ledger from an older phax — run \`phax artifact migrate-approvals\` first`. Map it to exit 12 in `exitCodeForError`. The README exit-code table is unchanged.
- Store: add `refuseOldApprovalLedgers()`, which checks the plan ledger and then the spec ledger with `fs.exists` and fails on the first present one.
- Call it as the first step of `transitionArtifact` (covering approve, stale, reopen, complete, abandon, `plans status --apply` and run completion, which runs in the worktree-rooted FileSystem), of `inspectArtifact`, of `plansStalenessReport` (so it fails the whole command, not a per-plan error entry) and of `computeStalenessForPlan` (the `phax run` staleness gate). Widen the error unions, including `RunCompletionError` and `applyStalenessReport`, and confirm that executePlan/resume turn the run-completion failure into the ArtifactCompletionFailed pause like any other member.
- Nothing is written before the check: no frontmatter rewrite, no record write, no commit.
- `phax artifact migrate-approvals` does not exist yet (phase-06); the message names it anyway.

### Planned files to create

- `tests/integration/approvalLedgerRefusal.test.ts`

### Planned files to edit

- `src/domain/artifact/approvalRecordFile.ts`
- `src/domain/errors.ts`
- `src/cli/commands/runLayers.ts`
- `src/app/approvalRecordStore.ts`
- `src/app/artifactStatus.ts`
- `src/app/planStaleness.ts`
- `src/app/completeRunArtifacts.ts`
- `tests/integration/artifactStatus.test.ts`
- `tests/integration/planStaleness.test.ts`

### Optional files that may be edited

- `src/app/executePlan.ts`
- `src/app/resume.ts`
- `src/cli/commands/run.ts`
- `tests/unit/readmeExitCodes.test.ts`
- `tests/unit/artifact/approvalRecordFile.test.ts`
- `tests/integration/completeRunArtifacts.test.ts`
- `tests/unit/cli/run.test.ts`

### Boundary contracts

Store → use cases: `refuseOldApprovalLedgers(): Effect<void, FsError | ApprovalLedgerMigrationRequiredError, FileSystem>`. CLI: `ApprovalLedgerMigrationRequiredError` → exit 12, and its message names the ledger and the command.

### Test strategy

Write BEFORE implementation: `tests/integration/approvalLedgerRefusal.test.ts` (real git, made-up temporary repositories) maps §8 'An old ledger refuses until migrated'. Run one variant with a committed made-up `docs/plans/approvals.json` and one with only `docs/specs/approvals.json`. Approve, complete, inspectArtifact, plansStalenessReport (with a fake Backend layer, never reached), computeStalenessForPlan, and completeRunArtifacts in a worktree each fail with `ApprovalLedgerMigrationRequiredError`. `exitCodeForError` gives 12. The message names the ledger and `phax artifact migrate-approvals`. HEAD and `git status --porcelain` are unchanged. Fake-port tests in `artifactStatus.test.ts` and `planStaleness.test.ts` assert that the refusal precedes any write.

### Implementation order

1. Constants and error, plus the exit-code mapping
2. refuseOldApprovalLedgers
3. Call sites and unions
4. Refusal tests

### Excluded scope

- The migration command (phase-06).
- Any implicit migration.
- README / help prose (phase-07).

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

Name the constants, the error class and its fields, the exact refusal message, and every call site of `refuseOldApprovalLedgers`. Confirm the run-completion pause path. Phase-06 must make sure `migrate-approvals` itself never calls the refusal. Explain any deviation from the planned file lists.

### Commit subject

`feat(artifact): refuse approval commands while an old ledger exists`

### Commit body

While docs/plans/approvals.json or docs/specs/approvals.json exists, every phax artifact transition, phax artifact status, phax plans status, and phax run's staleness gate and run completion now refuse with exit 12 before writing anything. The refusal names the ledger and `phax artifact migrate-approvals` (spec approval-record-files §5.14, §9 Q9). Either ledger refuses commands for both kinds. A run started before migration pauses as ArtifactCompletionFailed.

---

## phase-06 — The migrate-approvals command {#phase-06-migrate-approvals}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

Ship the one-time, one-commit migration from the old ledgers to record files. It is the only reader of old ledgers, and no record is lost or duplicated.

### Detailed instructions

- `src/app/migrateApprovals.ts`: `migrateApprovals({ repoRoot })`. It returns `{ kind: "nothing-to-migrate" } | { kind: "migrated", ledgers: [{ ledgerPath, recordFiles }], orphans: OrphanApprovalRecord[], commit: { hash, subject } }`, with errors `FsError | GitError | ApprovalRecordUnreadableError | ApprovalMigrationRefusedError | ArtifactDirtyWriteSetError | ArtifactCommitFailedError`. It never calls `refuseOldApprovalLedgers`.
- Phase A, with no writes. For each old ledger present, read it with `readPlanApprovalsFile` / `readSpecApprovalsFile`. These cover pre-schema `version: 1` and every `$schema` release through the existing decoders and the frozen history modules. A JSON or decode failure is `ApprovalRecordUnreadableError` naming the ledger. Then refuse with a new `ApprovalMigrationRefusedError` `{ message, path }` (exit 12) when: an entry key is not `isLiveArtifactPath` of the ledger's kind (message like `<ledger>: entry <key> is not a live plan path — remove the entry, then rerun`); or a target record file exists and is unreadable, or differs field for field from the entry plus `artifact` (a target holding the same record is kept, not rewritten). Refuse with `ArtifactDirtyWriteSetError` when `git.dirtyPaths(repoRoot, [ledgers…, targets…])` is non-empty; that covers an untracked ledger. With neither ledger, return nothing-to-migrate.
- Phase B. Write each target record file through the store's record encoder (mkdirp the approvals dirs), remove each ledger, then `git.commitPaths(repoRoot, [deleted ledgers…, created record files…], subject, body)`. The subject is `chore(approvals): migrate approval ledgers to record files`, and the body names the per-ledger record counts. A commit failure is `ArtifactCommitFailedError`. An empty ledger yields a deletion-only commit. Orphans are entries whose artifact does not exist; they still migrate (§5.19).
- Domain render (`render.ts`): `renderMigrationReport(result)` → lines per spec §6 (`<ledger> → N record file(s)`, the indented record paths, `committed <short hash> <subject>`), and `nothing to migrate: no docs/plans/approvals.json or docs/specs/approvals.json`. Orphans reuse `renderOrphanRecordWarning`.
- CLI: register `migrate-approvals` under `artifact` in `src/cli/commands/artifact.ts` with a thin `runArtifactMigrateApprovals(out)`: findGitRoot, the rooted FS + Git layer, the one use case, `out.log` for report lines and `out.warn` for orphans, exit 0; on failure `out.error` + `exitCodeForError` (12 for the refusals). Add `ApprovalMigrationRefusedError` to the exit-12 family.
- Docs surface: add the command's help, long_help (the spec §6 wording) and example `phax artifact migrate-approvals` in `src/cli/cliDocs.ts`. Run `pnpm gen:usage-spec` to regenerate `phax.usage.kdl` and `pnpm docs:cli` to regenerate `docs/cli/reference.md`. Never hand-edit generated output.
- Never run `phax artifact migrate-approvals` (or `pnpm dev artifact migrate-approvals`) against this repository's working tree. Exercise it only in temporary repositories.

### Planned files to create

- `src/app/migrateApprovals.ts`
- `tests/integration/migrateApprovals.test.ts`

### Planned files to edit

- `src/domain/errors.ts`
- `src/domain/artifact/render.ts`
- `src/cli/commands/runLayers.ts`
- `src/cli/commands/artifact.ts`
- `src/cli/cliDocs.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `tests/unit/artifact/render.test.ts`

### Optional files that may be edited

- `src/domain/artifact/approvalRecordFile.ts`
- `src/app/approvalRecordStore.ts`
- `src/cli/program.ts`
- `docs/cli/inventory.md`
- `tests/unit/cli/artifact.test.ts`
- `tests/unit/readmeExitCodes.test.ts`
- `tests/integration/usageOutput.test.ts`
- `tests/integration/usageSpecExamples.test.ts`
- `tests/integration/usageParity.test.ts`

### Boundary contracts

CLI → app: one use case, `migrateApprovals`, with a discriminated result rendered by domain functions. App → ports: FileSystem (read/write/remove/list/exists) and Git (dirtyPaths, commitPaths, headCommit) only. Persisted input is decoded only through the `persisted.ts` ledger readers, and output is encoded only through the phase-01 record file encoders.

### Test strategy

Write BEFORE implementation: `tests/integration/migrateApprovals.test.ts` (real git, made-up temporary repositories, made-up ledgers) maps spec §8. 'Migration splits made-up ledgers with no record lost': a pre-schema plan ledger with 2 records (one with sourceSpec) plus a `$schema` spec ledger with 3 records; one commit whose name-status is exactly 2 deletions + 5 additions; each record file decodes to its entry plus `artifact`; a variant per released `$schema` shape (0.17.0, 0.18.0). 'Running the migration again is a no-op': on a migrated repo and on one that never had a ledger, nothing-to-migrate, exit 0, HEAD and status unchanged. 'An empty ledger is deleted'. 'A gone artifact's entry migrates as an orphan': listed in the result and the warning, and the orphan finder from phase-04 then reports it. 'Migration refusals write nothing': unreadable ledger, archive-path key, uncommitted ledger change, existing differing target, each exit 12 with the tree and HEAD unchanged; plus an existing identical target that proceeds and keeps the file. 'Old formats stay readable and are never written': after migration, put the repo through approve, stale, reopen, complete, abandon and a completeRunArtifacts run, and assert neither ledger path exists after any step. `tests/unit/artifact/render.test.ts` covers the migration report lines. The existing usage-spec drift, parity and example tests cover the generated kdl and reference.

### Implementation order

1. Error class and exit-code mapping
2. Use case Phase A (all refusals) and its tests
3. Use case Phase B (writes and commit) and its tests
4. Render functions and their tests
5. CLI registration, cliDocs, gen:usage-spec, docs:cli

### Excluded scope

- Migrating this repository's own ledgers (post-release, per spec §10).
- Migrating implicitly from any other command.
- Transition help text and README/skills prose (phase-07).

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

Give the use-case signature and result type, the refusal error class and messages, the commit subject and body, and the exact CLI output lines. Confirm the kdl and reference.md were regenerated and not hand-edited, and that the command was never run on this repository's tree. Explain any deviation from the planned file lists.

### Commit subject

`feat(artifact): add migrate-approvals to split old approval ledgers`

### Commit body

Add `phax artifact migrate-approvals` (spec approval-record-files §5.15–§5.20, §9 Q2, Q6, Q7). It reads docs/plans/approvals.json and docs/specs/approvals.json in every released shape and writes one record file per entry, with `artifact` set to the entry's key. It deletes the ledgers and commits exactly those paths in one commit. With no ledger it reports nothing to migrate and exits 0. An empty ledger is deleted. Entries whose artifact is gone migrate and are reported as orphans. It exits 12, writing nothing, on an unreadable ledger, a non-live entry key, an uncommitted change to any path it would write, or an existing record file that holds a different record.

---

## phase-07 — Docs, skills and next steps {#phase-07-docs}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

Make every user-facing description of approvals name per-artifact record files, explain the upgrade path, and record the follow-ups this spec leaves.

### Detailed instructions

- `src/cli/cliDocs.ts`: rewrite the approve/reopen/abandon/complete help per spec §6 ('writes the plan's approval record file, docs/plans/approvals/<plan file name>.json; reopen, abandon and complete delete it in the transition commit; no transition touches another artifact's record file'), with the spec equivalent for specs. Remove every other `approvals.json` mention from help text. Regenerate with `pnpm gen:usage-spec` and `pnpm docs:cli`.
- README: update the approve description (around the current line 230) to record files. Confirm the phase-01 persisted-format rows. Rewrite the known issue 'A plan is stale right after its approval' so it applies only to a plan listing its OWN record file `docs/plans/approvals/<plan>.json` (another plan's approvals no longer affect it). Add the upgrade note 'Approval records are per-artifact files' for a user whose next approve or run refuses with exit 12, with the spec §11 example transcript. Leave the exit-code table unchanged.
- `.claude/skills/phax-cli/SKILL.md` and `.claude/skills/phax-spec/SKILL.md`: replace the ledger descriptions with per-artifact record files, explain 'unrecorded' as 'no record file', and list `phax artifact migrate-approvals` under artifact with its exit codes (0 migrated or nothing to migrate, 12 refusals). Name `approvals.json` only as the migration input.
- `NEXT_STEPS.md`: tick 'A run's completion conflicts with approvals made on main during the run'. Under the approval-ground item, note that its §9 Q2/Q4 now reduce to the plan's own record file and own path. Update the 1.0 persisted-format stability item to name the record formats instead of approvals.json. Add an unchecked item: after the release that ships this, migrate this repository's own ledgers by hand with `phax artifact migrate-approvals`; the spec ledger is still pre-schema.
- Create `tests/unit/approvalRecordDocs.test.ts`. Read `phax.usage.kdl`, `README.md` and the two skill files. Assert that the approve, reopen, abandon and complete help names `approvals/`, and that `migrate-approvals` is listed under `artifact`. Assert that every line mentioning `approvals.json` is either in the migrate-approvals text or upgrade note, or is a persisted-formats row of an old ledger.

### Planned files to create

- `tests/unit/approvalRecordDocs.test.ts`

### Planned files to edit

- `README.md`
- `src/cli/cliDocs.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `.claude/skills/phax-cli/SKILL.md`
- `.claude/skills/phax-spec/SKILL.md`
- `NEXT_STEPS.md`

### Optional files that may be edited

- `docs/cli/inventory.md`
- `src/domain/errors.ts`
- `src/cli/commands/runLayers.ts`

### Test strategy

Write BEFORE editing the docs: `tests/unit/approvalRecordDocs.test.ts` maps the §8 criterion 'Help and docs name record files', and it fails against the current text. The existing README persisted-formats test, README exit-code test and usage-spec drift/parity tests keep the generated kdl and reference in step.

### Implementation order

1. Docs test
2. cliDocs.ts help, then gen:usage-spec and docs:cli
3. README
4. Skills
5. NEXT_STEPS.md

### Excluded scope

- Behaviour changes in src/ beyond help strings.
- docs/ideas/ and archived specs or plans.
- Migrating this repository's ledgers.

### Verification

The `standard` gate profile in `phax.json`. This phase writes `.claude/skills/` files, so the run uses `phax run --allow-skill-edits`.

### Expected handoff content

List each doc and skill section changed. Give the allowed-context rule the docs test enforces. Quote the NEXT_STEPS items added or ticked. Confirm the kdl and reference.md were regenerated. Explain any deviation from the planned file lists.

### Commit subject

`docs: describe per-artifact approval record files`

### Commit body

Update CLI help, the README and the shipped phax-cli and phax-spec skills to describe approval records as per-artifact record files under docs/plans/approvals/ and docs/specs/approvals/. They now name the old approvals.json ledgers only as the input of `phax artifact migrate-approvals` and in the old-ledger persisted-format rows (spec approval-record-files §5.23, §11). Add the README upgrade note. Narrow the 'stale right after its approval' known issue to a plan's own record file. In NEXT_STEPS, tick the completion-conflict item, note that approval-ground's §9 Q2/Q4 reduce to the plan's own record file and path, and add the post-release migration of this repository's ledgers.
