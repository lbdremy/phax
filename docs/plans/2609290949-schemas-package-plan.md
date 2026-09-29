---
status: Approved
source-spec: docs/specs/2609241238-schemas-package.md
approved:
  date: 2026-09-29
  baseline: 76d8ab0
---
# schemas-package 2/5 — read every format

This is plan 2 of 5 for the spec `schemas-package` (`docs/specs/2609241238-schemas-package.md`): read every format. Plan 1 landed on 2026-09-29 (PR #104). It built `@lbdremy/phax-schemas` under `packages/schemas/` and its reading-history machinery, and proved both on the phase record manifest:

- `shapes.ts`: `defineFormat`, with legacy shapes, released shapes, and the current shape decoded by phax's own decoder;
- `document.ts`: `makeDocumentParser`, which identifies a document by its `$schema`;
- `parsed.ts`;
- frozen modules under `src/history/<format id>/v<N>.ts`, pinned in `history.lock.json` by `pnpm exec tsx scripts/schemas-check.ts --write`;
- the generated `PACKAGE_VERSION`.

This plan reuses that machinery and does not redesign it. It gives every other format of spec §5.4 the same treatment, one family per phase, and each phase proves its formats on real documents before the next starts:

- phase-01: the files of a run directory. These are the run registry, run status, phase status, phax-plan and compliance review. `defineFormat` gains the literal fallback.
- phase-02: the files of the repository. These are the plan and spec approvals ledgers and the spec and plan documents.
- phase-03: the record manifests. This adds the authoring record manifest (legacy v1, with and without `sourceSha`) and the record-manifest union.
- phase-04: a record's timeline files. These are the gate attribution, phase file reconciliation, gate diagnostics and gate pending. They are unversioned, so their legacy shape is `v0`, and `defineFormat` learns that shape.
- phase-05: `parseDocument` is pinned complete, and the build writes one draft-07 JSON Schema per format under `json/`.

**The shapes are known; no phase discovers them.** `scripts/survey-format-shapes.ts` walked every source on 2026-09-29 and committed its report to `docs/briefs/schemas-package-shapes.md` and `.json`. The report settles the following, and the phases take it as given:

- **phax-plan v1** has 4 key signatures. phax's current decoder rejects 17 documents: 9 without `run.requiredCommands`, 8 with the removed `run.backend`, and 6 whose phases lack the three planned-file lists. The frozen `v1` accepts all four signatures.
- **run-status v1** has 10 signatures. 8 documents are rejected, all for a missing `namespace`. The other signatures differ only by optional keys phax still accepts.
- **phase-file-reconciliation** is never versioned, so its shape is `v0`. It has 5 signatures, and 116 documents are rejected: 87 lack `createdButPlannedEdit` and `editedButPlannedCreate`, and 29 also lack `phaseId`. The frozen `v0` accepts all five.
- **authoring-record-manifest v1** exists with and without `sourceSha`. Both are accepted today.
- **gate-diagnostics and gate-pending**: no document exists anywhere. They have only their current shape, `v0`, and the tests write their documents.
- **Every other format** has one shape, and every document of it is accepted.

Fixtures are real documents copied by hand from the locators in the report's `examples`, at least one per signature. The corpus script is plan 3.

Requirements this plan covers (in full unless marked):

- §5.4, §5.5, §5.7, §5.8, §5.11, §5.12, §5.13, §5.20, §5.21 and §5.22;
- §5.6: the closure guard becomes an exact allowlist. The tarball scan comes in plan 5.
- §5.9, partly: every legacy shape of every format is read. No format has a `$schema` shape until plan 4 writes one.
- §5.10, partly: `parseDocument` dispatches every format id. A real `$schema` document of each format comes with plan 4.
- §5.15, partly: one frozen module per shape, pinned and never imported by `src/`. phax reading its own older files comes in plan 4.

Acceptance criteria this plan covers:

- The entry exports every persisted format.
- Nothing internal leaks, at the source closure. The packed tarball is checked in plan 5.
- Same verdict as phax on every document.
- A bad document is a value, not an exception.
- Package types are phax's types.
- Every exported format has a usable JSON Schema.
- A format without a JSON Schema fails the build.
- Both legacy authoring shapes parse.
- A newer document is named, for every format.
- Upgrading marks the unknown, for every format.
- A record's timeline files parse.

Left to later plans:

- plan 3: §5.16, §5.18 and §5.19;
- plan 4: §5.14 and the rest of §5.15, and the criterion that a renamed file is still identified;
- plan 5: §5.1's tarball smoke, §5.17, §5.23 to §5.26, and the README;
- §5.27, the code-review document, joins with the headless-review plan. `code-review` stays out of `FORMAT_IDS`.

Execution caveat: the phases copy fixtures from outside the worktree. They read `~/.phax/registry.json`, `~/.phax/archive/*/runs/`, the records clone at `~/.phax/records/phax`, and this repository's git history. Prefer those sources. Use a `/Volumes/Work/steme/steme-lab` locator only when a signature has no other example.

Coordination: artifact-decide, headless-review and oracle-phases (all Approved) change formats this package exports. Their plans come later and record their changes as new shapes through plan 3's snapshot gate. This plan implements none of their changes. It changes no persisted shape, no decoder verdict of phax and no CLI behaviour. Its only edits under `src/` are two `jsonSchema` annotations, and neither changes a verdict. The root version stays `0.16.0`, and nothing is published.

## Required commands

- `pnpm exec tsx`
- `pnpm add`
- `git log`
- `git show-ref`
- `git cat-file`

`security.agentCommands` in `phax.json` already allows every command above, so no configuration change is needed.

- `pnpm exec tsx` runs `scripts/schemas-check.ts --write`, which pins each new frozen module, and runs `scripts/schemas-json.ts` in phase-05.
- `pnpm add` adds `ajv` as a devDependency in phase-05. It needs registry access.
- `git log`, `git show-ref` and `git cat-file` copy fixtures from this repository's history and from the records clone. Resolve the branch ref with `git show-ref`, list commits with `git log --format=%H <ref> -- <path>`, and read a blob with `git cat-file -p <commit>:<path>`. `git show` is not allowed.

## Technical arbitrations

- Shapes come from the committed survey report, not from discovery at execution. The abandoned first draft of this plan had each phase rediscover shapes, which is what the survey replaced. Loss accepted: a shape the survey missed surfaces only when plan 3's corpus is parsed at release.
- Literal fallback in `defineFormat`. When a document's `version` literal names the current shape, phax's own decoder reads it first, as in plan 1. If that decoder rejects it and a frozen module exists for the same literal, the frozen module reads it under the same shape id. If both reject it, the result is the current decoder's failure. Loss accepted: for the listed historical signatures (phax-plan v1, run-status v1, reconciliation v0), the package accepts documents phax's current decoder rejects. §5.7 promises parity only for the shape phax currently writes, and §5.13 requires the older shapes to be readable. The alternative, reading them only after plan 4, abandons 141 real documents in this plan.
- A frozen `v<N>` (or `v0`) module is the union of every signature written under that literal, and its type is that shape id's value type. phax's current type must be assignable to it. Where the literal had one signature, the two types are equal and the frozen `JSONSchema.make` equals phax's. Loss accepted: for phax-plan, run status and reconciliation, the `v1`/`v0` value type is wider than phax's type. `toLatest<Format>` is the path to one exact shape.
- Frozen twins for every format now, following plan 1's v2 twin. Each is pinned and proven against phax's decoder beside the live schema, and each takes over when plan 4 moves every current shape to `next`. Loss accepted: until plan 4, the twins of single-signature formats are only a fallback that never fires.
- Unversioned formats. A document with neither `$schema` nor `version` resolves to `v0`, through the same current-then-frozen decoding, but only for a format that declares a `v0` shape. `version: 0` is never a known literal. Loss accepted: a timeline file is identified by where it lives, as spec §4 defines an unversioned legacy document, and `parseDocument` still points it to its format's parse function.
- Fixtures: one file per format and shape, `tests/unit/schemasPackage/fixtures/<format id>/<shape>.json`, an object that maps the survey report's key-signature string to one real document. A test checks that the fixture keys equal the report's signatures and that phax's verdict matches each group's. Loss accepted: two fixture conventions, because plan 1's per-document, hash-named files stay for the phase record manifest. In return, the planned file lists are exact and 'one per signature' is checked mechanically.
- Per-family modules. Each family's definitions, parse functions and upgrades live in `packages/schemas/src/formats/<family>.ts`, re-exported by the single entry `index.ts`. The phase record manifest's definition moves into `formats/recordManifests.ts` in phase-03. Loss accepted: a move of plan 1's code.
- Spellings (§10 left open) follow spec §6. `PlanApprovalsSchema` is phax's `ApprovalRecordFileSchema`, `SpecApprovalsSchema` is `SpecApprovalRecordFileSchema`, `GateDiagnosticsSchema` is `GateDiagnosticsDocumentSchema` and `GatePendingSchema` is `GatePendingDocumentSchema`. Upgrades are `toLatest<Format>` returning `Latest<Format>`, frozen types are `<Format>V<N>`, and shape-id types are `<Format>Shape`. Loss accepted: four schemas are spelled differently in phax and in the package.
- Every format gets `toLatest<Format>`, including single-shape and `v0` formats. It drops `version`, marks `{ kind: "unknown" }` every fact an older signature lacked, and never invents a value. A field the latest shape has no place for, such as phax-plan's `run.backend`, is not carried. Loss accepted: several upgrades are near-identities, and an obsolete fact survives only on the parsed value.
- `parseRecordManifest` dispatches on `$schema` (the two manifest ids), then on `kind === "authoring"` (phax's `isAuthoringRecordManifest` rule), and otherwise treats the document as a phase record manifest. It names `format` as `parseDocument` does, and `RecordManifestSchema` is phax's own union. Loss accepted: the `kind` rule is written twice, and a parity test keeps the two copies in step.
- `parseDocument` grows in each family phase, and phase-05 pins it complete (`DocumentFormatId` equals `FormatId`). Loss accepted: until phase-05, completeness rests on each phase's own tests.
- JSON Schemas are build output. At the end of the root `build` script, `scripts/schemas-json.ts` writes the gitignored `packages/schemas/json/`: 15 `<format id>.schema.json` files plus `record-manifest.schema.json`, each rendered from the current shape's schema. Loss accepted: the files are not reviewable in a diff, until plan 3's committed snapshots become the record.
- No silent gap (§5.22). The installed Effect's `JSONSchema.make` silently drops a refinement that has no `jsonSchema` annotation. The renderer therefore walks each AST and fails, naming the format, on any unannotated refinement (brands excepted) or on a thrown error. Two refinements get annotations before their twins freeze. `BranchNameSchema` gets an exact `pattern` in phase-01. The spec document's traceability filter gets a declared-gap `description` in phase-02. Loss accepted: the spec document's JSON Schema accepts a dangling `refs` entry that `parseSpecDocument` rejects, and the gap is written into the schema.
- JSON Schema follows each decoder's excess-property setting. The registry, run status, phase status and the four timeline formats render with extra properties allowed, and every other format renders with `additionalProperties: false`. Loss accepted: for those seven formats the schema does not flag a mistyped key, which is exactly phax's own verdict.
- Each root `title` is `phax <label>`, taken from the renderer's table. Loss accepted: the spec and plan documents' `(experimental)` titles stay in `phax artifact schema spec|plan` output but do not reach `json/`, per q-no-experimental.
- `ajv` (v8, draft-07) becomes a devDependency, used only by tests, to prove that each schema loads into a standard draft-07 validator. Loss accepted: one dev dependency and churn in `pnpm-lock.yaml`. The package's own dependencies stay exactly `effect`.
- Corpus source (spec §10 open, for plan 3). The corpus script takes a required `--records <path>` argument naming a git repository that holds `phax/records/v1` (for phax, `~/.phax/records/phax`), and it walks every commit. Loss accepted: the script does not follow the records destination in `phax.json`.
- Oracle-first is not applied. The oracle phase kind ships with oracle-phases, which is planned after this plan, so each phase writes its own tests first. Loss accepted: the implementing agent can edit its own tests.

---

## phase-01 — Run-directory formats: registry, run and phase status, phax-plan, compliance review {#phase-01-run-directory}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

A reader holding any file of a phax run directory can parse it with phax's verdict, including every older signature phax wrote under `version: 1`. That covers `~/.phax/registry.json`, `run-status.json`, a phase `status.json`, `phax-plan.json` and `compliance-review.json`. The reader gets the shape id and its type, and can upgrade the value to the latest shape.

### Detailed instructions

- Read plan 1's machinery first and reuse it. That is `packages/schemas/src/shapes.ts`, `document.ts`, `parsed.ts` and `index.ts`, `packages/schemas/build/generated.ts`, `scripts/schemas-check.ts` and every test under `tests/unit/schemasPackage/`. Read `docs/briefs/schemas-package-shapes.md` and `.json` too: they list each format's signatures and example locators.
- Extend `defineFormat` in `shapes.ts` with the literal fallback.
      - In `byLiteral`, when `current.name === "v<N>"`, decode with `current` first.
      - If that fails and `legacy[N]` exists, decode with `legacy[N]`, and on success return shape `v<N>`.
      - If both fail, return the current decoder's failure.
      - Update the doc comment's resolution list.

    Plan 1's behaviour is unchanged, because its frozen v2 equals phax's v2, and the existing test 'decodes a v<N> current shape with the current decoder' must still pass.
- Annotate `BranchNameSchema` in `src/domain/branded.ts`, before you freeze the phase-status twin.
      - Add `jsonSchema: { pattern: "^[^\\x00-\\x20\\x7f-][^\\x00-\\x20\\x7f]*$" }` (or an equivalent pattern) to the options of its `Schema.filter(isSafeBranchName, …)`.
      - The pattern must accept exactly what `isSafeBranchName` accepts: non-empty, no leading `-`, no code unit at or below 0x20, and no 0x7f.
      - Keep the predicate, the message and the brand unchanged.
- Create one frozen module for each format: `packages/schemas/src/history/registry/v1.ts`, `run-status/v1.ts`, `phase-status/v1.ts`, `phax-plan/v1.ts` and `compliance-review/v1.ts`.
      - Header comment: copy the one on plan 1's modules. It says what the module freezes, the commit it was copied from, that it is pinned by hash, and that it imports only `effect`.
      - Inline every sub-schema. The phase-status module copies `BranchNameSchema`'s `minLength`, `maxLength`, predicate, message, new annotation and brand verbatim.
      - Keep phax's excess-property setting: the default for registry, run status and phase status, and `onExcessProperty: "error"` for phax-plan and compliance review.
      - Export `<Format>V1Schema`, `type <Format>V1` and `decode<Format>V1`.
- The frozen modules for registry, phase status and compliance review are exact twins of phax's current schema, because each has one signature.

  The run-status module accepts a missing `namespace`.

  The phax-plan module accepts all four signatures:
      - `run` without `requiredCommands`;
      - `run` with a `backend` (a non-empty string);
      - phases without `plannedFilesToCreate`, `plannedFilesToEdit` and `optionalFilesToEdit`;
      - the current shape.

    It still rejects every other unknown key. Optional fields or a union of whole shapes both work, as long as phax's `PhaxPlan` type stays assignable to `PhaxPlanV1`.

  Pin the five modules with `pnpm exec tsx scripts/schemas-check.ts --write`, and never edit a pinned module afterwards.
- Create `packages/schemas/src/formats/runDirectory.ts`. Define each format with:
      - `defineFormat`, using the id from `FORMAT_IDS` and a human label;
      - `legacy: { 1: frozen v1 }`, `releases: []`;
      - `current: { name: "v1", shape: { schema: phax's schema, decode: phax's decoder } }`.

    Export, for each format:
      - `parse<Format>`;
      - `type <Format>Shape`;
      - `type Latest<Format>`: phax's type without `version`, where each fact an older signature lacked is `T | Unknown`. These are run status `namespace`, phax-plan `run.requiredCommands`, and each phase's three planned-file lists;
      - `toLatest<Format>(value)`, which is pure. It drops `version` and phax-plan's `run.backend`, sets each missing fact to `UNKNOWN`, keeps every other recorded field, and never invents a value.

    Also export each definition, for `parseDocument`.
- Update `packages/schemas/src/index.ts`:
      - Re-export `RegistrySchema`, `RunStatusSchema`, `PhaseStatusSchema`, `PhaxPlanSchema` and `ComplianceReviewSchema`, with their types `Registry`, `RunStatus`, `PhaseStatus`, `PhaxPlan` and `ComplianceReview`, all from phax's own `src/schemas` modules. Never redeclare a current schema.
      - Re-export the new parse and upgrade functions and the new types, including the frozen `<Format>V1` types.
      - Add the five definitions to `DocumentShapes` and to the `makeDocumentParser` call.
- Create `tests/unit/schemasPackage/surveyedFixtures.ts`. It is a test helper that:
      - reads `docs/briefs/schemas-package-shapes.json`;
      - `surveyGroups(formatId)` returns each group's `keys`, `accepted` and `rejected`;
      - `readSurveyedFixtures(formatId, shape)` returns `{ signature, document }` pairs from `tests/unit/schemasPackage/fixtures/<format id>/<shape>.json`.
- Write the five fixture files. Each is a JSON object that maps each of the format's survey `keys` strings to one real document of that signature, pretty-printed with 2 spaces and a trailing newline.
      - Take each document from its group's `examples` locators, never a hand-made one.
      - The registry comes from `~/.phax/registry.json`. You may trim `runs` to a few real entries, but keep one with `archivePath` and one without, so the signature holds.
      - Never edit a key or a value.

    run-status has 10 signatures, phase-status 3, phax-plan 4, and registry and compliance-review 1 each. For a phase-status signature whose only examples are steme-lab records, take the document from that locator.

### Planned files to create

- `packages/schemas/src/formats/runDirectory.ts`
- `packages/schemas/src/history/registry/v1.ts`
- `packages/schemas/src/history/run-status/v1.ts`
- `packages/schemas/src/history/phase-status/v1.ts`
- `packages/schemas/src/history/phax-plan/v1.ts`
- `packages/schemas/src/history/compliance-review/v1.ts`
- `tests/unit/schemasPackage/surveyedFixtures.ts`
- `tests/unit/schemasPackage/runDirectoryFormats.test.ts`
- `tests/unit/schemasPackage/fixtures/registry/v1.json`
- `tests/unit/schemasPackage/fixtures/run-status/v1.json`
- `tests/unit/schemasPackage/fixtures/phase-status/v1.json`
- `tests/unit/schemasPackage/fixtures/phax-plan/v1.json`
- `tests/unit/schemasPackage/fixtures/compliance-review/v1.json`

### Planned files to edit

- `packages/schemas/src/shapes.ts`
- `packages/schemas/src/index.ts`
- `packages/schemas/history.lock.json`
- `src/domain/branded.ts`
- `tests/unit/schemasPackage/shapes.test.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/parse.test.ts`
- `tests/unit/schemasPackage/exports.test.ts`
- `tests/unit/schemasPackage/frozenHistory.test.ts`
- `tests/unit/schemasPackage/parseDocument.test.ts`
- `tests/type/schemasPackage.ts`

### Optional files that may be edited

- `tests/unit/branded.test.ts`

### Boundary contracts

Producers:

- `src/schemas/registry.ts`, `status.ts`, `phaxPlan.ts` and `complianceReview.ts` own each current schema, its decoder and its excess-property setting.
- `src/domain/branded.ts` owns `BranchNameSchema`, which now carries a JSON Schema pattern.

Consumer: `packages/schemas/src/formats/runDirectory.ts` re-exports those schemas and wraps those decoders in `defineFormat`. It declares no current-shape schema of its own.

The contract of the fallback: a current-shape document always gets phax's verdict. A document phax rejects gets a second reading only from the frozen module of its own literal, and when both reject it, the failure reported is phax's.

Later consumers:

- plan 4's own-formats bridge, which reads the registry and the run and phase status through these definitions and `toLatest`;
- phase-05's JSON Schema table.

### Test strategy

Write these tests first.

`tests/unit/schemasPackage/shapes.test.ts`, the fallback on a toy format:

- when the current `v1` rejects a document and the frozen `v1` accepts it, the document parses as shape `v1`;
- a document both reject returns the current decoder's path;
- a current success returns the current decoder's value;
- nothing throws.

`tests/unit/schemasPackage/runDirectoryFormats.test.ts`, for each of the five formats:

- the fixture keys equal the survey's signatures;
- phax's current decoder rejects a fixture exactly when its group's `rejected` is above zero;
- every fixture parses `ok` with shape `v1`, and its value deep-equals phax's decoded value whenever phax accepts it;
- `toLatest<Format>` keeps every recorded field, drops `version`, and marks `{ kind: "unknown" }`: `namespace` for the old run statuses, and `requiredCommands` and the planned-file lists for the old phax-plans. It never adds a key that is absent;
- the frozen twin gives phax's value on every fixture phax accepts;
- for registry, phase status and compliance review, the frozen module's `JSONSchema.make` deep-equals phax's;
- the newer-release failure, on one fixture per format with a `$schema` above `PACKAGE_VERSION`.

`BranchNameSchema`: its pattern agrees with the predicate on a table of names: `''`, `-x`, `a b`, a tab, `\x7f`, `feat/x`, `a-b.c` and a 255-character name.

`parse.test.ts`, the acceptance case: a run status whose `state` is `paused` returns `ok: false` with `error.path` `state` and a non-empty message, and does not throw.

`parity.test.ts`: accepted and rejected current-shape cases for each format, compared with phax's decoder. The rejected cases are ones no frozen module admits, such as a bad enum or a wrong type. The acceptance case is a registry with one unknown key, which both accept. A run status and a phase status with an unknown key are also accepted by both, and a phax-plan and a compliance review with an unknown key are rejected by both.

`tests/type/schemasPackage.ts`:

- each package type is assignable to phax's type, and back;
- phax's type is assignable to each frozen `V1` type, and the two are equal for the three single-signature formats;
- narrowing on `shape` gives the exact type.

Also update:

- `exports.test.ts`: the new runtime export set;
- `frozenHistory.test.ts`: the new lock keys;
- `parseDocument.test.ts`: a registry `$schema` document now reaches the registry definition ('no registry shape is known at release …'). Move the 'not read yet' case to a format no phase has registered yet, such as `gate-pending`.

### Implementation order

1. Read plan 1's package files, the tests and the survey report.
2. Write the literal fallback in shapes.ts, with its toy tests.
3. Annotate BranchNameSchema, and test its pattern.
4. Copy the five fixture files, and write surveyedFixtures.ts.
5. Write the five frozen v1 modules, and pin them with scripts/schemas-check.ts --write.
6. Write formats/runDirectory.ts, the index exports, and the parseDocument registration.
7. Write the format, parity, parse and type tests, then update the exports, frozen-history and parseDocument tests.

### Excluded scope

- Repository formats (phase-02), record manifests (phase-03), timeline files and the v0 rule (phase-04).
- JSON Schema files, the gap detector and ajv (phase-05).
- phax reading its own files through the package, and writing $schema (plan 4).
- Snapshots, the corpus script and the committed corpus (plan 3).
- Any change to a phax decoder's verdict or to a persisted shape.

### Verification

The `standard` gate profile in `phax.json`. The generated-index and lock check runs inside `pnpm test`, through `frozenHistory.test.ts`.

### Expected handoff content

Record:

- the fallback rule as implemented;
- the `BranchNameSchema` pattern;
- how the phax-plan and run-status frozen modules admit their older signatures (optional fields or a union);
- for each fixture file, the locator each document came from;
- the export names added to the entry, and the definitions `formats/runDirectory.ts` exports for later phases;
- any deviation from the planned file lists, with the reason.

### Commit subject

`feat(schemas-package): read every run-directory format with its history`

### Commit body

Add the run registry, run status, phase status, phax-plan and compliance review to @lbdremy/phax-schemas. Each format gets:

- its schema and type, re-exported from phax's own module;
- a frozen v1 module;
- a parse function that returns the shape id and the exact shape;
- a toLatest upgrade that marks absent facts unknown;
- a registration with parseDocument.

defineFormat now falls back from phax's current decoder to the frozen module of the same literal. Documents of the current shape keep phax's verdict, and the older signatures the survey found stay readable: run statuses without namespace, and phax-plans without requiredCommands, with run.backend, or without the planned-file lists.

BranchNameSchema gets a jsonSchema pattern equal to its safe-name predicate. This is an annotation only, and decoding does not change.

Tests run over real documents, one per surveyed signature.

---

## phase-02 — Repository formats: approvals ledgers, spec and plan documents {#phase-02-repository}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

A reader can parse `docs/plans/approvals.json`, `docs/specs/approvals.json`, and the JSON sidecar beside any headless-authored spec or plan. The reader gets phax's verdict, the shape id, and an upgrade to the latest shape.

### Detailed instructions

- The survey found one v1 signature for each document kind, plus an empty-ledger signature (`records{}`) for each ledger. phax accepts every one. So each frozen module is an exact twin.
- Annotate the traceability filter in `src/schemas/specDocument.ts`, before you freeze its twin.
      - Pass `Schema.filter(firstTraceabilityViolation, { jsonSchema: { description } })`.
      - The `description` names the checks JSON Schema cannot express: unique requirement, question and option ids; every `refs` entry naming an existing requirement; every requirement referenced by a criterion; and a `recommendation` that names one of its question's options. Adapt the list to the checks `firstTraceabilityViolation` actually makes.
      - The annotation adds no constraint, and the verdict does not change.
      - If a test pins `phax artifact schema spec` output, update it in `tests/unit/specDocument.test.ts`.
- Create the frozen modules `packages/schemas/src/history/plan-approvals/v1.ts`, `spec-approvals/v1.ts`, `spec-document/v1.ts` and `plan-document/v1.ts`. Follow phase-01's rules:
      - use the same header comment;
      - import only `effect`;
      - inline every sub-schema. The plan-document module inlines phaxPlan's phase fields and effort set. The spec-document module copies the traceability predicate, its helpers and the new annotation;
      - use `onExcessProperty: "error"`, as phax does for all four;
      - export `<Format>V1Schema`, `type <Format>V1` and `decode<Format>V1`.

    Pin them with `--write`.
- Create `packages/schemas/src/formats/repository.ts`. Define the four formats as phase-01 does, with `current: { name: "v1", … }` and `legacy: { 1: twin }`. Export, for each format:
      - `parsePlanApprovals`, `parseSpecApprovals`, `parseSpecDocument` or `parsePlanDocument`;
      - its shape type and its `Latest<Format>` type;
      - `toLatest<Format>`, which drops `version`;
      - its definition.
- Update `packages/schemas/src/index.ts`:
      - re-export `PlanApprovalsSchema` and `type PlanApprovals`, which are phax's `ApprovalRecordFileSchema` and its type;
      - re-export `SpecApprovalsSchema` and `type SpecApprovals`, which are phax's `SpecApprovalRecordFileSchema` and its type;
      - re-export `SpecDocumentSchema`, `type SpecDocument`, `PlanDocumentSchema` and `type PlanDocument`;
      - re-export the new functions and types;
      - register the four definitions with `parseDocument`.
- Write the four fixture files, keyed by the survey signature, in the format phase-01 uses.
      - Ledgers: take the populated signature from the ledger at `HEAD`. You may trim `records` to a few real entries.
      - The empty-ledger signature is `{ "version": 1, "records": {} }`, the ledger as phax first writes it. Copy it from the earliest commit of the ledger that holds it (`git log --reverse --format=%H -- <path>`, then `git cat-file -p`). For plan approvals, whose only example is in steme-lab, write exactly that document.
      - Sidecars: take the smallest `docs/specs/**/*.json` and `docs/plans/**/*-plan.json` sidecar (not `approvals.json`) that phax accepts.

### Planned files to create

- `packages/schemas/src/formats/repository.ts`
- `packages/schemas/src/history/plan-approvals/v1.ts`
- `packages/schemas/src/history/spec-approvals/v1.ts`
- `packages/schemas/src/history/spec-document/v1.ts`
- `packages/schemas/src/history/plan-document/v1.ts`
- `tests/unit/schemasPackage/repositoryFormats.test.ts`
- `tests/unit/schemasPackage/fixtures/plan-approvals/v1.json`
- `tests/unit/schemasPackage/fixtures/spec-approvals/v1.json`
- `tests/unit/schemasPackage/fixtures/spec-document/v1.json`
- `tests/unit/schemasPackage/fixtures/plan-document/v1.json`

### Planned files to edit

- `packages/schemas/src/index.ts`
- `packages/schemas/history.lock.json`
- `src/schemas/specDocument.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/exports.test.ts`
- `tests/unit/schemasPackage/frozenHistory.test.ts`
- `tests/type/schemasPackage.ts`

### Optional files that may be edited

- `tests/unit/specDocument.test.ts`
- `tests/unit/schemasPackage/parseDocument.test.ts`
- `tests/unit/schemasPackage/surveyedFixtures.ts`

### Boundary contracts

Producers: `src/schemas/approvalRecord.ts`, `specApprovalRecord.ts`, `specDocument.ts` and `planDocument.ts`, with `phaxPlan.ts` supplying the plan document's phase fields. `specDocument.ts` now also owns the declared-gap annotation.

Consumer: `packages/schemas/src/formats/repository.ts`.

Outside consumer: the steme docs pipeline and cockpit, which read ledgers and sidecars from a clone through the spec's names and the `Parsed` result.

### Test strategy

Write `tests/unit/schemasPackage/repositoryFormats.test.ts` first. For each of the four formats:

- the fixture keys equal the survey's signatures, and every fixture parses `ok` with shape `v1`, with phax's value;
- `toLatest<Format>` keeps every field and drops `version`;
- the frozen twin's `JSONSchema.make` deep-equals phax's, and the twin gives phax's value on every fixture;
- a spec document with a dangling `refs` entry is rejected by both `parseSpecDocument` and the frozen module;
- the newer-release failure.

`parity.test.ts`, accepted and rejected cases for each format:

- one unknown key: each of the four rejects it, and so does phax;
- a ledger `baseline` that is not 40-hex;
- a plan document whose phase `id` breaks the pattern.

`tests/type/schemasPackage.ts`: types in both directions, and each frozen type equal to phax's.

Update the export set and the lock keys.

### Implementation order

1. Annotate the traceability filter.
2. Copy the fixtures.
3. Write the four frozen twins and pin them.
4. Write formats/repository.ts, the index exports, and the parseDocument registration.
5. Write the format, parity and type tests, then update the exports and frozen-history tests.

### Excluded scope

- Parsing spec or plan Markdown frontmatter (a spec non-goal).
- The artifact-decide ledger changes (their own plan).
- Record manifests and timeline files (phase-03, phase-04); JSON Schema files (phase-05).
- The committed corpus of every ledger commit (plan 3).

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

Record:

- the exact annotation on the traceability filter, and whether `phax artifact schema spec` output changed;
- the locator of each fixture document, and any trimming;
- the export names added;
- any deviation from the planned file lists, with the reason.

### Commit subject

`feat(schemas-package): read approvals ledgers and spec and plan documents`

### Commit body

Add the plan and spec approvals ledgers and the spec and plan documents to @lbdremy/phax-schemas. Each format gets:

- its schema and type, taken from phax's own module;
- a frozen v1 twin;
- a parse function;
- a toLatest upgrade;
- a registration with parseDocument.

The spec document's traceability filter gets a jsonSchema description. It names the cross-reference checks that JSON Schema cannot express and that only the parser enforces, so the gap is declared rather than silent. Decoding does not change.

Tests run over real ledgers and sidecars from this repository's history, one per surveyed signature.

---

## phase-03 — Record manifests: authoring record manifest and the record-manifest union {#phase-03-record-manifests}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

A reader walking `phax/records/v1` can hand any `record.json` to one function and learn whether it is a phase or an authoring manifest, which shape it has, and its exact type. Both legacy authoring shapes, with and without `sourceSha`, parse.

### Detailed instructions

- Move the phase record manifest's definition from `packages/schemas/src/index.ts` into a new `packages/schemas/src/formats/recordManifests.ts`. That covers `parsePhaseRecordManifest`, its types and `toLatestPhaseRecordManifest`. The entry re-exports them unchanged, and plan 1's tests stay green without edits.
- Create `packages/schemas/src/history/authoring-record-manifest/v1.ts`, following phase-01's rules.
      - Import only `effect`, and inline the provider id, token usage and record shape.
      - Use `onExcessProperty: "error"`.
      - `sourceSha` is optional, as in phax today, so one twin accepts both surveyed signatures.
      - Export `AuthoringRecordManifestV1Schema`, `type AuthoringRecordManifestV1` and `decodeAuthoringRecordManifestV1`.

    Pin it.
- In `formats/recordManifests.ts`, define `authoring-record-manifest` with `current: { name: "v1", shape: phax's AuthoringRecordManifestSchema and decodeAuthoringRecordManifest }` and `legacy: { 1: twin }`. Export:
      - `parseAuthoringRecordManifest`;
      - `type AuthoringRecordManifestShape`;
      - `type LatestAuthoringRecordManifest`;
      - `toLatestAuthoringRecordManifest`. It drops `version`, and it keeps `sourceSha` absent when it was absent: an absent `sourceSha` records a session that did not commit, not an unknown fact.
- Add `parseRecordManifest(input)`. It never throws, and it returns `ParsedDocument` over the two manifest formats (`format`, `shape`, `value`). It dispatches in order:
      1. A non-object fails at `""`.
      2. A `$schema` naming `phase-record-manifest` or `authoring-record-manifest` goes to that format's `parse`. Another known format id fails at `$schema` with `<url> is a <format id> document, not a record manifest`. A malformed URL, or an unknown id, fails with the shared messages from `shapes.ts`.
      3. `kind === "authoring"` goes to the authoring manifest.
      4. Everything else goes to the phase record manifest.

    Also export `RecordManifestSchema` and `type RecordManifest` from phax's `src/schemas/authoringRecord.ts`, and `type RecordManifestFormat`.
- Update `packages/schemas/src/index.ts`:
      - re-export `AuthoringRecordManifestSchema`, `type AuthoringRecordManifest`, and the new functions and types;
      - register `authoring-record-manifest` with `parseDocument`.

    The union has no format id, so it is not registered.
- Write `tests/unit/schemasPackage/fixtures/authoring-record-manifest/v1.json`, keyed by the two survey signatures.
      - With `sourceSha`: `authoring/2609241219-headless-review/record.json`.
      - Without `sourceSha`: `authoring/2609281130-oracle-phases/record.json`.

    Both are on `phax/records/v1` in `~/.phax/records/phax`. Resolve the ref with `git show-ref`, find a commit with `git log --format=%H <ref> -- <path>`, and read the blob with `git cat-file -p`.

### Planned files to create

- `packages/schemas/src/formats/recordManifests.ts`
- `packages/schemas/src/history/authoring-record-manifest/v1.ts`
- `tests/unit/schemasPackage/recordManifests.test.ts`
- `tests/unit/schemasPackage/fixtures/authoring-record-manifest/v1.json`

### Planned files to edit

- `packages/schemas/src/index.ts`
- `packages/schemas/history.lock.json`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/exports.test.ts`
- `tests/unit/schemasPackage/frozenHistory.test.ts`
- `tests/type/schemasPackage.ts`

### Optional files that may be edited

- `tests/unit/schemasPackage/phaseRecordManifestHistory.test.ts`
- `tests/unit/schemasPackage/parseDocument.test.ts`

### Boundary contracts

Producer: `src/schemas/authoringRecord.ts` owns:

- `AuthoringRecordManifestSchema` and its decoder;
- the union `RecordManifestSchema` and `decodeRecordManifest`;
- the `isAuthoringRecordManifest` rule.

Consumer: `packages/schemas/src/formats/recordManifests.ts`.

Contract: on current-shape documents, `parseRecordManifest(x).ok` equals `decodeRecordManifest(x)`'s verdict, and `format` agrees with `isAuthoringRecordManifest`.

Outside consumer: the §6 Node consumer walking the branch.

### Test strategy

Write `tests/unit/schemasPackage/recordManifests.test.ts` first.

Acceptance criterion, both legacy authoring shapes parse:

- each fixture parses `ok` with shape `v1`;
- the fixture keys equal the survey's signatures.

`toLatestAuthoringRecordManifest` keeps every field, drops `version`, and never adds `sourceSha`.

`parseRecordManifest`:

- an authoring fixture returns `format: "authoring-record-manifest"`;
- plan 1's phase fixtures, v1 and v2, return `format: "phase-record-manifest"` with their shape;
- a `registry` `$schema` fails, naming the URL;
- a newer release gets the upgrade message;
- a non-object fails;
- nothing throws.

The twin's `JSONSchema.make` equals phax's, and the twin gives phax's value on every fixture.

`parity.test.ts`:

- `parseAuthoringRecordManifest` against `decodeAuthoringRecordManifest`, and `parseRecordManifest` against `decodeRecordManifest`, over accepted and rejected cases. The cases include an unknown key (both reject) and an outcome of `interrupted` on an authoring manifest (both reject).
- For every accepted case, the `format` returned matches `isAuthoringRecordManifest`.

`tests/type/schemasPackage.ts`:

- types in both directions, for the authoring manifest and the union;
- `parseRecordManifest` narrowing on `format` and `shape`.

### Implementation order

1. Move the phase record manifest's definition, keeping plan 1's tests green.
2. Copy the authoring fixtures.
3. Write the authoring twin and pin it.
4. Write the authoring definition, parseRecordManifest and the exports.
5. Write the manifest, parity and type tests, then update the exports and frozen-history tests.

### Excluded scope

- Timeline files of a record (phase-04).
- A helper that walks the records branch (a spec non-goal).
- record-manifest.schema.json (phase-05).
- The oracle-phases and headless-review changes to manifests.

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

Record:

- `parseRecordManifest`'s dispatch order and its failure messages;
- the move of the phase record manifest's definition;
- the commits the two fixtures came from;
- the new export names;
- any deviation from the planned file lists, with the reason.

### Commit subject

`feat(schemas-package): read the authoring record manifest and any record manifest`

### Commit body

Add the authoring record manifest to @lbdremy/phax-schemas. Its frozen v1 module accepts both legacy shapes, with and without sourceSha.

Add parseRecordManifest, which reads any record.json on phax/records/v1. It dispatches on $schema, then on kind "authoring", and otherwise reads a phase record manifest. The result names the format it read. RecordManifestSchema is phax's own union.

The phase record manifest's definition moves beside the authoring one, with no change in behaviour. Tests cover real authoring records from the records branch.

---

## phase-04 — Record timeline files: gate attribution, file reconciliation, gate diagnostics and pending (v0) {#phase-04-record-timeline}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

A reader holding a record folder can parse its `gate-attribution.json`, `file-reconciliation.json` and every `checks-attempt-NN.diagnostics.json` and `checks-attempt-NN.pending.json`. Each file reports shape `v0`, and the reader can show a phase's gate steps, its fix-loop attempts in order, and its file reconciliation.

### Detailed instructions

- Extend `defineFormat` in `packages/schemas/src/shapes.ts` with the unversioned shape.
      - If a format has a `v0` shape (`current.name === "v0"` or `legacy[0]`), a document carrying neither `$schema` nor `version` decodes as `v0`, through phase-01's current-then-frozen fallback.
      - `version: 0` is never a known literal, so a document with a `version` key still resolves by its literal.
      - A format without `v0` keeps the missing-`$schema` failure.
      - Update the doc comment.
      - Adjust `document.ts`'s missing-`$schema` message only if it must mention timeline files.
- Create the frozen modules `packages/schemas/src/history/gate-attribution/v0.ts`, `phase-file-reconciliation/v0.ts`, `gate-diagnostics/v0.ts` and `gate-pending/v0.ts`. Follow phase-01's rules:
      - import only `effect`;
      - inline the surface literal, the diagnostic union with its completion variant, and the positive-integer `line`;
      - keep phax's default excess-property setting for all four, which ignores unknown keys;
      - export `<Format>V0Schema`, `type <Format>V0` and `decode<Format>V0`.

    Gate attribution, gate diagnostics and gate pending are exact twins: one signature, and no document of the last two exists.

    The reconciliation module accepts all five surveyed signatures: `phaseId` is optional, and so are `createdButPlannedEdit` and `editedButPlannedCreate`. If a fixture's `renames` holds an element shape the current schema rejects, accept that too and record it in the handoff. phax's `PhaseFileReconciliation` must stay assignable to `PhaseFileReconciliationV0`.

    Pin all four.
- Create `packages/schemas/src/formats/recordTimeline.ts`. Define the four formats with `legacy: { 0: frozen }`, `releases: []` and `current: { name: "v0", shape: phax's schema and decoder }`. Export, for each format:
      - `parseGateAttribution`, `parsePhaseFileReconciliation`, `parseGateDiagnostics` or `parseGatePending`;
      - its shape type and its `Latest<Format>` type;
      - `toLatest<Format>`. For reconciliation, it marks `phaseId`, `createdButPlannedEdit` and `editedButPlannedCreate` unknown when absent. For the other three formats it is the identity on the current shape;
      - its definition.
- Update `packages/schemas/src/index.ts`:
      - re-export `GateAttributionSchema` and `PhaseFileReconciliationSchema`, with their types;
      - re-export `GateDiagnosticsSchema` and `type GateDiagnostics`, which are phax's `GateDiagnosticsDocumentSchema` and its type;
      - re-export `GatePendingSchema` and `type GatePending`, which are phax's `GatePendingDocumentSchema` and its type;
      - re-export the new functions and types;
      - register the four formats with `parseDocument`.
- Write the fixtures, keyed by the survey signature as in phase-01: `fixtures/gate-attribution/v0.json` (1 signature) and `fixtures/phase-file-reconciliation/v0.json` (5 signatures). Take each document from its group's example locators under `~/.phax/archive/*/runs/phase-NN/`.
- Write the record-timeline fixture: one phase's real files under `tests/unit/schemasPackage/fixtures/record-timeline/`.
      - Copy `gate-attribution.json` and `file-reconciliation.json` from `~/.phax/archive/phax.artifact-timestamp-naming/runs/phase-05/`. If that phase lacks either file, use another phase of the same run that has both.
      - Copy the same phase's `record.json` from `phax/records/v1` in `~/.phax/records/phax`, at key `<runId>/<phaseId>/record.json`, where `runId` comes from that archive's `run-status.json`. If the branch has no such record, copy one of plan 1's v2 manifest fixtures, and say so in the handoff.
      - No diagnostics or pending document exists anywhere, so the test builds `checks-attempt-01.diagnostics.json` and `checks-attempt-02.diagnostics.json`, plus one `checks-attempt-02.pending.json`, as in-memory values keyed by those file names.

### Planned files to create

- `packages/schemas/src/formats/recordTimeline.ts`
- `packages/schemas/src/history/gate-attribution/v0.ts`
- `packages/schemas/src/history/phase-file-reconciliation/v0.ts`
- `packages/schemas/src/history/gate-diagnostics/v0.ts`
- `packages/schemas/src/history/gate-pending/v0.ts`
- `tests/unit/schemasPackage/recordTimeline.test.ts`
- `tests/unit/schemasPackage/fixtures/gate-attribution/v0.json`
- `tests/unit/schemasPackage/fixtures/phase-file-reconciliation/v0.json`
- `tests/unit/schemasPackage/fixtures/record-timeline/record.json`
- `tests/unit/schemasPackage/fixtures/record-timeline/gate-attribution.json`
- `tests/unit/schemasPackage/fixtures/record-timeline/file-reconciliation.json`

### Planned files to edit

- `packages/schemas/src/shapes.ts`
- `packages/schemas/src/index.ts`
- `packages/schemas/history.lock.json`
- `tests/unit/schemasPackage/shapes.test.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/exports.test.ts`
- `tests/unit/schemasPackage/frozenHistory.test.ts`
- `tests/unit/schemasPackage/parseDocument.test.ts`
- `tests/type/schemasPackage.ts`

### Optional files that may be edited

- `packages/schemas/src/document.ts`
- `tests/unit/schemasPackage/surveyedFixtures.ts`

### Boundary contracts

Producers: `src/schemas/gateAttribution.ts`, `reconciliation.ts` (`PhaseFileReconciliationSchema`, not the internal global reconciliation), `gateDiagnostics.ts` and `gatePending.ts`. They own the current schemas and their default excess-property setting.

Consumer: `packages/schemas/src/formats/recordTimeline.ts`.

Contract with the reader: every timeline file resolves to `v0` without a marker. An attempt's order comes from its file name, which the reader supplies, because the package reads values, never paths.

Later consumer: plan 4, which gives these formats their first `$schema` shape.

### Test strategy

Write these tests first.

`shapes.test.ts`, the `v0` rule on a toy format:

- a document with neither marker parses as `v0`, through the current decoder and then the frozen fallback;
- `version: 0` fails as an unknown literal;
- a format without `v0` keeps the missing-`$schema` failure.

`tests/unit/schemasPackage/recordTimeline.test.ts`:

- the fixture keys equal the survey's signatures, and phax's verdict matches each group's;
- every fixture parses `ok` with shape `v0`;
- `toLatestPhaseFileReconciliation` marks the absent facts unknown and keeps every recorded field;
- the twins' `JSONSchema.make` equals phax's for gate attribution, diagnostics and pending;
- the reconciliation module gives phax's value on every fixture phax accepts;
- test-written diagnostics and pending documents, both invariant and completion diagnostics, parse `ok` as `v0`;
- the newer-release failure for each format.

The acceptance criterion, a record's timeline files parse:

- `record.json` parses with `parseRecordManifest`;
- `gate-attribution.json`, `file-reconciliation.json` and the in-memory attempt documents each parse with their own function;
- the four timeline formats report `v0`;
- the diagnostics, sorted by the attempt number in their file names, come back as attempts 01 then 02.

`parity.test.ts`, for each format, accepted and rejected current-shape cases:

- one unknown key, which both accept;
- a rejection no frozen module admits, such as a step `result` outside its literals or a diagnostic `line` of 0.

`parseDocument.test.ts`: the 'not read yet' case now uses an unknown id, because every format is registered.

`tests/type/schemasPackage.ts`: types in both directions, and phax's reconciliation type assignable to `PhaseFileReconciliationV0`.

Update the export set and the lock keys.

### Implementation order

1. Write the v0 rule in shapes.ts, with its toy tests.
2. Copy the fixtures and the record-timeline files.
3. Write the four frozen v0 modules and pin them.
4. Write formats/recordTimeline.ts, the index exports, and the parseDocument registration.
5. Write the timeline, parity, parseDocument and type tests, then update the exports and frozen-history tests.

### Excluded scope

- A record's technical files: agent binding, model resolution, orient brief, security posture and transcript (internal, spec §5.6).
- The run-level global reconciliation (internal).
- A helper that lists a record folder (a spec non-goal).
- JSON Schema files (phase-05).

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

Record:

- the `v0` rule as implemented;
- how the reconciliation module admits its five signatures, and any `renames` variant found;
- the run and phase the record-timeline fixture came from, and any substitution;
- the new export names;
- any deviation from the planned file lists, with the reason.

### Commit subject

`feat(schemas-package): read a record's timeline files as unversioned shape v0`

### Commit body

Add the gate attribution, phase file reconciliation, gate diagnostics and gate pending documents to @lbdremy/phax-schemas. A reader can now rebuild a phase's gate steps, fix-loop attempts and file reconciliation from its record without a parser of its own.

These files never carried a version literal. defineFormat now reads a document with neither $schema nor version as the format's v0 shape: phax's current decoder reads it first, then the frozen v0 module. The frozen reconciliation module accepts the five surveyed signatures, including the documents without createdButPlannedEdit, editedButPlannedCreate or phaseId. toLatest marks those facts unknown.

---

## phase-05 — parseDocument complete and one draft-07 JSON Schema per format {#phase-05-json-schemas}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

A docs pipeline finds a draft-07 JSON Schema per format at `@lbdremy/phax-schemas/json/<format>.schema.json`. Each is generated from the schema the parse function uses, and every phax-written document validates against it. A schema that cannot be rendered faithfully fails the build, naming its format. `parseDocument` reads every format id, and the package reaches no internal module.

### Detailed instructions

- Create `packages/schemas/build/jsonSchemas.ts`, which is pure.

    `JSON_SCHEMA_FORMATS` is a table with one entry per id in `FORMAT_IDS`, plus `record-manifest` for the union. Each entry holds:
      - the file name `<id>.schema.json`;
      - the title `phax <label>`;
      - the schema: the definition's `current.shape.schema`, or `RecordManifestSchema` for the union;
      - `excess: "error" | "ignore"`.

    Take the definitions from the `formats/*.ts` modules, so each schema is exactly the one its parse function uses.

    `findJsonSchemaGaps(schema): string[]` walks the AST and returns the path of every refinement without a `jsonSchema` annotation. It follows each suspend once, and it does not count brands or effect's built-in annotated refinements.

    `renderJsonSchemas(table)` returns `{ files: Map<fileName, content>, failures: Array<{ format, reason }> }`:
      - gaps fail the format, naming their paths;
      - otherwise `JSONSchema.make` renders the schema, and an error it throws fails the format;
      - `ignore` entries allow extra properties. Use `additionalPropertiesStrategy: "allow"` if the installed Effect has it; otherwise remove `additionalProperties: false` from the output;
      - the root `title` comes from the table;
      - the content is `JSON.stringify(value, null, 2) + "\n"`;
      - a failed format gets no file.
- Set `excess` to `ignore` for registry, run-status, phase-status, gate-attribution, phase-file-reconciliation, gate-diagnostics and gate-pending, and to `error` for every other entry.
- The only refinements the gap detector should meet are `BranchNameSchema` and the spec document's traceability filter, and phases 01 and 02 annotated both. If it finds another, do not annotate a schema whose twin is already pinned. Record the finding in the handoff and stop short of changing any frozen module.
- Create `scripts/schemas-json.ts` in the style of `scripts/schemas-check.ts`, with its logic exported behind a main guard.
      - `writeJsonSchemas(table, outDir)` clears `outDir`, writes the rendered files, prints `✗ <format>: <reason>` for each failure, and returns the failures.
      - The main guard writes `packages/schemas/json/` and exits 1 on any failure.

    Change the root `build` script to `tsc -p tsconfig.build.json && tsc -p packages/schemas/tsconfig.build.json && tsx scripts/schemas-json.ts`.
- Update `packages/schemas/package.json`: `files` becomes `["dist", "json"]`, and `exports` gains `"./json/*": "./json/*"` beside `.`.

    Add `packages/schemas/json/` to `.gitignore`, and add it to `.oxfmtrc.json`'s ignore patterns. Do the same in `.oxlintrc.json` only if oxlint would read it.
- Run `pnpm add -D ajv`. Only tests use it, and the package's dependencies stay exactly `effect`.
- Pin `parseDocument` complete:
      - `DocumentShapes` covers every `FormatId`;
      - `tests/type/schemasPackage.ts` asserts `Equals<DocumentFormatId, FormatId>`;
      - a runtime test sends each id in `FORMAT_IDS` a `$schema` document at a release above `PACKAGE_VERSION`, and expects that format's newer-release message, never the unknown-format message.
- Turn the closure guard in `tests/unit/architecturalGuards.test.ts` into an exact allowlist (§5.6). The only `src/` files the entry closure may reach are:
      - `src/domain/branded.ts`;
      - under `src/schemas/`: `schemaUrl.ts`, `runRecord.ts`, `providerId.ts`, `surface.ts`, `registry.ts`, `status.ts`, `phaxPlan.ts`, `complianceReview.ts`, `approvalRecord.ts`, `specApprovalRecord.ts`, `authoringRecord.ts`, `specDocument.ts`, `planDocument.ts`, `gateAttribution.ts`, `reconciliation.ts`, `gateDiagnostics.ts` and `gatePending.ts`.

    Assert that the closure's `src/` files equal this list. If the closure also reaches another pure schema module that one of these formats imports, add it and name it in the handoff.
- Run `pnpm build` and check that `packages/schemas/json/` holds exactly 16 files.

### Planned files to create

- `packages/schemas/build/jsonSchemas.ts`
- `scripts/schemas-json.ts`
- `tests/unit/schemasPackage/jsonSchemas.test.ts`

### Planned files to edit

- `package.json`
- `pnpm-lock.yaml`
- `packages/schemas/package.json`
- `packages/schemas/src/index.ts`
- `.gitignore`
- `.oxfmtrc.json`
- `tests/unit/schemasPackage/manifest.test.ts`
- `tests/unit/schemasPackage/exports.test.ts`
- `tests/unit/schemasPackage/parseDocument.test.ts`
- `tests/unit/architecturalGuards.test.ts`
- `tests/type/schemasPackage.ts`

### Optional files that may be edited

- `knip.json`
- `.oxlintrc.json`
- `packages/schemas/src/document.ts`

### Boundary contracts

Producer: `packages/schemas/build/jsonSchemas.ts`. It takes each schema from the format definitions, the same values the parse functions decode with.

Consumer: `scripts/schemas-json.ts`, run by the root `build` script, which the `standard` gate's terminal `pnpm build` step runs.

Outside consumer: the steme docs pipeline. It reads `node_modules/@lbdremy/phax-schemas/json/<format>.schema.json` and relies on one draft-07 file per exported format, describing its current shape.

Later consumer: plan 3's snapshot gate, which commits these renderings per shape.

### Test strategy

Write `tests/unit/schemasPackage/jsonSchemas.test.ts` first.

The table and the real render:

- one entry per `FORMAT_IDS` id plus `record-manifest`, with unique file names;
- `renderJsonSchemas` over the real table returns no failures and 16 files, each with a draft-07 `$schema` and the table's title.

`findJsonSchemaGaps`:

- finds nothing in the real schemas;
- on a toy `Schema.filter` without an annotation, returns its path;
- does not flag a brand-only refinement.

Acceptance criterion, a format without a JSON Schema fails the build: `writeJsonSchemas` over a toy table, into a temp directory, with one unannotated-filter entry and one clean entry. It returns one failure naming the toy format, writes the clean file, and writes none for the failing one.

Acceptance criterion, every exported format has a usable JSON Schema:

- each rendered schema compiles in `new Ajv()`;
- every fixture its format's parse function accepts through phax's current decoder validates, and so do the record-timeline files and the test-written diagnostics and pending documents.

The `excess` pin: for each format, a phax-accepted fixture with one unknown key added validates exactly when the entry says `ignore`.

The spec document's schema equals `getSpecDocumentJsonSchema()`, apart from the title.

Also update:

- `manifest.test.ts`: `files` and exactly `.` and `./json/*`;
- `exports.test.ts`: the final runtime set. That is every `<Format>Schema`, `parse<Format>` and `toLatest<Format>` of the 15 formats, plus `RecordManifestSchema`, `parseRecordManifest`, `parseDocument`, `UNKNOWN` and `isUnknown`, and nothing else;
- `parseDocument.test.ts`: the completeness cases;
- the closure allowlist.

### Implementation order

1. Write the gap detector and the renderer, with the toy tests.
2. Write the table and pin its excess settings.
3. Write scripts/schemas-json.ts, and wire it into the build script, the package manifest, .gitignore and the oxfmt ignores.
4. Add ajv and the validation tests.
5. Pin parseDocument complete, and turn the closure guard into an allowlist.
6. Run pnpm build and check the json/ output.

### Excluded scope

- Committed snapshots per shape, the next snapshot and the snapshot gate (plan 3).
- Hosting the schemas at docs.phax.run (served by the docs pipeline, not the package).
- The tarball smoke and the packed-tarball scan (plan 5).
- The README persisted-formats table and the docs page (plan 5).

### Verification

The `standard` gate profile in `phax.json`. Its terminal `pnpm build` step now runs `scripts/schemas-json.ts` and fails on any JSON Schema gap.

### Expected handoff content

Record:

- the table, with each entry's file name, title and excess setting;
- how `ignore` is rendered: the Effect option, or post-processing;
- the gap detector's rules, and any unexpected gap it found;
- the final `exports` map and `files`;
- the final runtime export set;
- the closure allowlist;
- the ajv version installed;
- any deviation from the planned file lists, with the reason.

### Commit subject

`feat(schemas-package): ship one draft-07 JSON Schema per format and fail on gaps`

### Commit body

The build now writes packages/schemas/json/<format id>.schema.json for every persisted format, plus record-manifest.schema.json for the union. Each is generated from the schema its parse function uses, and the package ships them under ./json/*.

Effect's JSONSchema.make silently drops a refinement without a jsonSchema annotation. The renderer therefore walks each schema and fails the build, naming the format and writing no file, on any unannotated refinement or rendering error. A format whose decoder ignores unknown keys renders with extra properties allowed, matching phax's verdict.

parseDocument is pinned to read every format id. The closure guard becomes an exact allowlist of the schema modules the package may reach. Tests load every schema into ajv and validate real phax-written documents.
