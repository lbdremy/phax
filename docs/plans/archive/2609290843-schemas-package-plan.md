---
status: Abandoned
source-spec: docs/specs/2609241238-schemas-package.md
approved:
  date: 2026-09-29
  baseline: f28eb64
---
# schemas-package 2/5 — read every format

This is plan 2 of 5 for the spec `schemas-package` (`docs/specs/2609241238-schemas-package.md`): read every format. Plan 1 landed on 2026-09-29 (PR #104). It built the package `@lbdremy/phax-schemas` under `packages/schemas/` and the reading-history machinery, and proved both on one format, the phase record manifest. The machinery is: `shapes.ts` (`defineFormat`), `document.ts` (`makeDocumentParser`), `parsed.ts`, the frozen modules under `src/history/<format id>/v<N>.ts` pinned in `history.lock.json` by `scripts/schemas-check.ts --write`, and the generated `PACKAGE_VERSION`. This plan reuses that machinery without redesigning it. It gives every other format of spec §5.4 the same treatment, one family per phase. Each phase proves its formats on real documents before the next phase starts.

Phases:

- phase-01: the files of a run directory. These are the run registry, run status, phase status, phax-plan and compliance review. `defineFormat` learns to fall back from phax's current decoder to the frozen module of the same literal.
- phase-02: the files of the repository. These are the plan and spec approvals ledgers and the spec and plan documents. Their legacy history is in this repo's git log.
- phase-03: the record manifests. This adds the authoring record manifest, whose legacy v1 exists in two shapes (with and without `sourceSha`), and the record-manifest union `parseRecordManifest`.
- phase-04: a record's timeline files. These are the gate attribution, the phase file reconciliation, the gate diagnostics document and the gate pending document. They are unversioned, so their legacy shape is `v0`, and `defineFormat` learns that shape.
- phase-05: `parseDocument` is pinned complete over every format id. The build writes one draft-07 JSON Schema per format under `json/`, and fails, naming the format, on any schema it cannot render faithfully.

Each family phase adds, for each of its formats:

- the schema and type, re-exported from phax's own `src/schemas` module under the spec's name;
- a frozen module for each version literal (or `v0`), which imports only `effect`;
- a `parse<Format>` returning the shape id and the exact shape;
- a `toLatest<Format>` that marks absent facts `{ kind: "unknown" }`;
- registration with `parseDocument`;
- parity, type and history tests over real documents copied by hand into `tests/unit/schemasPackage/fixtures/<format id>/<shape>/`, following plan 1's naming contract.

Formats whose history holds more than one shape under one literal. On 2026-09-29 a read-only survey of `~/.phax` checked each document key by key against today's schemas, without running the decoders. It found:

- **Run status v1.** The run status of 8 archived runs, created between 2026-05-28 and 2026-06-10, has no `namespace`, which is required today.
- **phax-plan v1, in three shapes:**
  - 8 runs whose `run` carries `backend` and no `requiredCommands`. In 6 of them the phases also lack the three planned-file arrays.
  - 9 runs whose `run` lacks `requiredCommands`.
  - the current shape.
- **Registry, phase status and compliance review.** Every document on disk fits today's schema: the registry's 117 entries, 434 phase status files (7 of them in `phase-NN.reset-<timestamp>/` backups) and 72 compliance reviews. The phase status shape without `branchName` (before `eb2f344`) survives only in git history.

Still to confirm in the records clone and this repo's history:

- the authoring record manifest v1: a failed session has no `sourceSha`, which today's schema already makes optional;
- the gate diagnostics document (`v0`): created without `class` and `scopes`, which the gate-step-scheduling plan added;
- the phase file reconciliation (`v0`): created without `createdButPlannedEdit` and `editedButPlannedCreate`;
- the approvals ledgers and the spec and plan sidecars.

Each family phase confirms every count by running the decoders. Wherever a literal covers several shapes, one frozen decoder per literal accepts every shape found (§5.13).

Requirements this plan covers. Each is covered in full unless marked otherwise:

- §5.4, §5.5, §5.7, §5.8, §5.12, §5.13, §5.20, §5.21 and §5.22.
- §5.3 and §5.6: the closure guard is extended to refuse every internal schema module. The tarball scan comes in plan 5.
- §5.9, partly: every legacy shape of every format is read. No format has a `$schema` shape until plan 4 writes one.
- §5.10, partly: `parseDocument` recognises every format id. A real `$schema` document of each format comes with plan 4.
- §5.15, partly: one frozen module per shape, pinned by hash and never imported by phax's `src/`. phax reading its own older files comes in plan 4.

Acceptance criteria this plan covers:

- The entry exports every persisted format.
- Same verdict as phax on every document, including the registry with one unknown key, which both accept.
- A bad document is a value, not an exception: a run-status whose `state` is `paused`.
- Package types are phax's types, for every format.
- Every exported format has a usable JSON Schema.
- A format without a JSON Schema fails the build.
- Both legacy authoring shapes parse.
- A record's timeline files parse.
- Upgrading marks the unknown: extended to every format.
- A mixed history parses: on the hand-copied fixtures. The committed corpus comes in plan 3.
- Nothing internal leaks: through the extended closure guard.

Left to later plans:

- Plan 3: §5.16, §5.18 and §5.19, which cover the snapshots, the `next` snapshot, the snapshot gate, the corpus script and the committed corpus.
- Plan 4: §5.14 and the rest of §5.15: phax writes `$schema` and reads its older files through the package.
- Plan 5: §5.1's tarball smoke, §5.17, §5.23 to §5.26, the README persisted-formats table and the docs page.
- §5.27, the code-review document, joins with the headless-review plan. `code-review` stays out of `FORMAT_IDS` here.

Execution caveats:

- The family phases read real documents outside the worktree, so the agent needs read access to all of them:
  - `~/.phax/registry.json`;
  - the live run directories `~/.phax/runs/<namespace>.<shortName>/`;
  - the archived runs under `~/.phax/archive/<key>/runs/`. The 8 oldest keys are a bare `<shortName>`. Each run has `<phaseId>/` folders and sometimes `<phaseId>.reset-<timestamp>/` backups;
  - the local clone of the records repository at `~/.phax/records/phax`. Every commit of `phax/records/v1` carries its own tree, so the phases walk every commit, never only the tip. A record folder also holds a phase `status.json`.
- The fixture files the phases copy are expected unplanned creations: their names are content hashes, which no one can know in advance. They go under `tests/unit/schemasPackage/fixtures/`.
- Regenerated files are declared once here, outside each phase's optional quota:
  - `packages/schemas/history.lock.json`, rewritten by `pnpm exec tsx scripts/schemas-check.ts --write` in every phase that adds a frozen module;
  - `pnpm-lock.yaml`, rewritten by `pnpm add` in phase-05.
- The root version stays `0.16.0`. Nothing is published.

Coordination: artifact-decide, headless-review and oracle-phases (all Approved) change formats this package exports. Their plans come after the schemas-package plans and record their changes as new shapes through plan 3's snapshot gate. This plan implements none of their changes. It changes no persisted shape, no phax decoder verdict and no CLI behaviour. The only edits to phax's `src/` are two `jsonSchema` annotations, which change no verdict.

## Required commands

- `pnpm exec tsx`
- `pnpm add`
- `node`
- `git log`
- `git show-ref`
- `git cat-file`
- `git ls-tree`

`security.agentCommands` in `phax.json` already allows every command above, so no configuration change is needed.

- `pnpm exec tsx` runs `scripts/schemas-check.ts --write` in every phase, and `scripts/schemas-json.ts` in phase-05.
- `pnpm add` adds the draft-07 validator `ajv` as a devDependency in phase-05. It needs registry access.
- `node` reads the real documents: run-directory files with `node:fs`, and git objects through `child_process.execFileSync("git", [...])` with no shell.
- `git log`, `git show-ref`, `git cat-file` and `git ls-tree` walk the history of the schema modules, the approvals ledgers, the sidecars and the records branch. Use `git log -p -- <schema module>` to reconstruct shapes and `git cat-file -p <commit>:<path>` to read an old blob. `git show` is not allowed.

## Technical arbitrations

- Shape discovery is finished at execution, not in this plan. The headless planning session could not run git or the decoders. It surveyed the run directories key by key and read the schema sources and archived plans. Each family phase runs phax's current decoder over every real document it can reach, reads `git log -p` of the format's schema module, and writes one frozen decoder per literal that accepts every shape found. A shape seen only in git history, with no surviving document, is still accepted, and it is tested on a document derived from a real one inside the test file, not as a fixture. The phase-status shape without `branchName` is one such case. Loss accepted: the plan cannot list the older-shape fixture files, and a phase's handoff, not this preamble, is the authority on how many shapes a literal covers.
- Literal fallback in `defineFormat`. When a document's `version` literal names the current shape, phax's own decoder reads it first, as plan 1 does. When that decoder rejects it and a frozen module exists for the same literal, the frozen module reads it under the same shape id. When both reject it, the result is the current decoder's failure. Loss accepted: the package accepts an older shape that phax's current decoder rejects, such as a run status without `namespace`. §5.7 promises parity only for the shape phax currently writes, and §5.9 requires the older shape to be readable. The parity tests therefore use rejections that no historical shape admits.
- A frozen `v<N>` module is the union of every shape written under literal N. Its type is that shape id's value type, and phax's current type must be assignable to it. The two types are equal, and the module's `JSONSchema.make` equals phax's, when the literal only ever had one shape. Loss accepted: for run status and phax-plan, the parse result's `v1` value is wider than phax's type. `toLatest<Format>` is the path to one shape.
- Frozen twins for every format now. Each format gets its frozen `v1` (or `v0`) module in this plan, pinned in `history.lock.json` and proven against phax's decoder on the fixtures, even where phax's decoder still reads that literal. This follows plan 1's frozen-twin arbitration: the twins take over when plan 4 moves every current shape to `next`. Loss accepted: until plan 4, fourteen frozen modules only serve as the fallback.
- Unversioned formats (`v0`). Only a document carrying neither `$schema` nor `version` resolves to shape `v0`, through the same current-then-frozen decoding. `version: 0` is never a known literal. A format without a `v0` shape keeps plan 1's missing-`$schema` failure. Loss accepted: a timeline file without markers is identified by where it lives, as spec §4 defines an unversioned legacy document. `parseDocument` still points it to its format's parse function.
- Per-family modules. Each family's format definitions, parse functions and `toLatest` functions live in `packages/schemas/src/formats/<family>.ts`, and the single entry `packages/schemas/src/index.ts` re-exports them. The phase record manifest's definition moves into `formats/recordManifests.ts` in phase-03. Loss accepted: one more directory, and a move of plan 1's code. The alternative, a single index of sixteen formats, abandons a readable entry.
- Spellings (§10 left open): the package re-exports phax's schemas under the spec's §6 names. `PlanApprovalsSchema` is phax's `ApprovalRecordFileSchema`, `SpecApprovalsSchema` is `SpecApprovalRecordFileSchema`, `GateDiagnosticsSchema` is `GateDiagnosticsDocumentSchema` and `GatePendingSchema` is `GatePendingDocumentSchema`. Every other name matches phax's. The upgrade functions are `toLatest<Format>`, and the upgraded types are `Latest<Format>`. The frozen types are `<Format>V<N>`, and the shape-id types are `<Format>Shape`. Loss accepted: phax's source and the package spell four schemas differently, as plan 1 accepted for the manifest.
- Every `toLatest<Format>` drops `version`, following plan 1's manifest, and it exists for every format, including single-shape and `v0` formats. It marks unknown every fact the older shape lacked, and never invents a value. A field an older shape carried that the latest shape has no place for, such as phax-plan's `run.backend`, is not carried into the upgrade. It stays readable on the parsed value. Loss accepted: several upgrades are near-identities, and an upgrade forgets an obsolete fact that the parse result still holds.
- Record-manifest union. `RecordManifestSchema` is phax's own union from `src/schemas/authoringRecord.ts`. `parseRecordManifest` dispatches in order: a `$schema` naming `phase-record-manifest` or `authoring-record-manifest`, then `kind: "authoring"` (the rule of phax's `isAuthoringRecordManifest`), then the phase record manifest. Its result names `format` as `parseDocument` does. Loss accepted: dispatching on `kind` is written twice, once in phax's guard and once in the package, and a parity test keeps the two in step.
- JSON Schemas are build output. `scripts/schemas-json.ts` runs at the end of the root `build` script. It writes `packages/schemas/json/<format id>.schema.json` for the fifteen format ids, plus `record-manifest.schema.json` for the union, each describing the current shape. `json/` is gitignored and shipped through `files` and the `./json/*` export. Loss accepted: the files cannot be reviewed in a diff. Plan 3's committed snapshots become the reviewed record.
- No silent JSON Schema gap (§5.22). `JSONSchema.make` in the installed Effect (3.21.2) silently drops a refinement that has no `jsonSchema` annotation, and throws only for declarations and similar nodes. The build therefore walks each format's AST. It fails, naming the format, on any refinement without a `jsonSchema` annotation (brands excepted), and on any error thrown by `JSONSchema.make`. The two refinements in the exported closure are annotated in the family phase that freezes their twin, so that each twin copies its annotation. `BranchNameSchema`'s safe-name filter is regular and gets an exact `pattern`. The spec document's traceability filter checks cross-references that JSON Schema cannot express, so it gets a declared-gap `description` naming the checks that only `parseSpecDocument` enforces. Loss accepted: the spec document's JSON Schema accepts a dangling `refs` entry that the parser rejects. The gap is written in the schema, not silent.
- JSON Schema follows each decoder's excess-property setting. A format whose phax decoder ignores unknown keys renders with extra properties allowed: the registry, run status, phase status and the four timeline files. Every other format renders `additionalProperties: false`. Loss accepted: for those seven formats the JSON Schema does not flag a mistyped key, which is exactly phax's own verdict.
- Each JSON Schema's root `title` comes from the renderer's table (`phax <label>`), not from phax's annotation. The spec and plan documents' `(experimental)` titles therefore do not reach `json/`: q-no-experimental removed the stability split. Loss accepted: `phax artifact schema spec|plan` keeps the old title until a later plan touches it.
- Validator: `ajv` (v8, draft-07 by default) becomes a devDependency, used only by tests. It proves that each generated schema loads into a standard draft-07 validator and validates a phax-written document. Loss accepted: one more dev dependency and churn in `pnpm-lock.yaml`. The package's dependency list stays exactly `effect`.
- `parseDocument` grows in each family phase, as each definition joins `makeDocumentParser`. phase-05 pins it complete: `DocumentFormatId` equals `FormatId`. Loss accepted: until phase-05, completeness rests on each phase's tests rather than a single guard.
- Corpus source (spec §10 open, decided in plan 1 and restated here for plan 3): the corpus script takes a required `--records <path>` argument naming a git repository that holds `phax/records/v1`, which for phax is `~/.phax/records/phax`. It walks every commit of that branch. Loss accepted: the script does not follow the records destination in `phax.json`. This plan's hand-copied fixtures already follow the naming contract that script will reproduce.
- P3 (oracle first) is not applied, as in plan 1. The oracle phase kind ships with the oracle-phases spec, which is planned after this one, so each phase writes its own tests first instead. Loss accepted: the implementing agent can edit its own tests.

---

## phase-01 — Run-directory formats: registry, run and phase status, phax-plan, compliance review {#phase-01-run-directory}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

A reader holding any file of a phax run directory can parse it with phax's verdict, including an older shape: `~/.phax/registry.json`, `run-status.json`, a phase `status.json`, `phax-plan.json` or `compliance-review.json`. The reader gets the shape id and the exact type, and can upgrade the value to the latest shape without phax installed.

### Detailed instructions

- Read plan 1's machinery before you write code: `packages/schemas/src/shapes.ts`, `document.ts`, `parsed.ts`, `index.ts`, `scripts/schemas-check.ts`, and the tests under `tests/unit/schemasPackage/`. Reuse them. Change `shapes.ts` only as the next item says.
- Extend `defineFormat` in `packages/schemas/src/shapes.ts` with the literal fallback:
      - When a document's `version` literal N names the current shape (`current.name === "v<N>"`), decode it with `current` first.
      - If that fails and `legacy[N]` exists, decode it with `legacy[N]` and return shape `v<N>` on success.
      - If both fail, return the current decoder's failure.
      - Update the doc comment's resolution list.
      - Plan 1's phase record manifest behaviour is unchanged, because its frozen v2 equals phax's v2.
- Enumerate the shapes of each format before you write its frozen module:
      - Read `git log -p -- <module>` for `src/schemas/registry.ts`, `src/schemas/status.ts`, `src/schemas/phaxPlan.ts` and `src/schemas/complianceReview.ts`, and list every change to the persisted shape under `version: 1`.
      - Collect every real document with `node`, reading files only:
          - `~/.phax/registry.json`;
          - every `run-status.json`, `phax-plan.json` and `compliance-review.json` of a run, and every phase `status.json` (including `phase-NN.reset-<timestamp>/` backups), under `~/.phax/runs/*/` and `~/.phax/archive/*/runs/`;
          - every distinct `<runId>/<phaseId>/status.json` on `phax/records/v1` in `~/.phax/records/phax`. Resolve the ref with `git show-ref`, list commits with `git log --format=%H <ref>` because each commit carries its own tree, then use `git ls-tree -r --name-only <commit>` and `git cat-file -p <commit>:<path>`.
      - Run phax's current decoder (`decodeRegistry`, `decodeRunStatus`, `decodePhaseStatus`, `decodePhaxPlan`, `decodeComplianceReview`) over every document, and group the rejections by first error.
      - Confirm the survey's findings:
          - 8 archived run statuses without `namespace`;
          - phax-plans in three v1 shapes: 8 whose `run` has `backend` and no `requiredCommands` (6 of them with phases lacking `plannedFilesToCreate`, `plannedFilesToEdit` and `optionalFilesToEdit`), 9 whose `run` lacks `requiredCommands`, and the current shape;
          - every registry entry, phase status and compliance review accepted today.
      - Check `git log -p` for any shape that no surviving document shows. The phase status before `eb2f344` had no `branchName`.
- Create one frozen module per format under `packages/schemas/src/history/<format id>/v1.ts`, for registry, run-status, phase-status, phax-plan and compliance-review:
      - Put the header comment of plan 1's frozen modules on each one: what it freezes, the commits it was reconstructed from, the hash pin, and a note that it imports only `effect`.
      - Inline every sub-schema and annotation.
      - Keep phax's excess-property setting: the default for registry, run status and phase status, and `onExcessProperty: "error"` for phax-plan and compliance review.
      - Accept every shape found under `version: 1`, for example by a union of whole shapes. The phax-plan module must admit the old `run.backend` and the phases without planned-file arrays while still rejecting every other unknown key.
      - Export `<Format>V1Schema`, `type <Format>V1` and `decode<Format>V1`. The Formats are `Registry`, `RunStatus`, `PhaseStatus`, `PhaxPlan` and `ComplianceReview`.
      - Pin each module with `pnpm exec tsx scripts/schemas-check.ts --write`, and never edit a pinned module afterwards.
- Annotate `BranchNameSchema` in `src/domain/branded.ts` before you freeze the phase-status twin:
      - Add `jsonSchema: { pattern: ... }` to its `Schema.filter(isSafeBranchName, …)`. The pattern must accept exactly what `isSafeBranchName` accepts: non-empty, no leading `-`, no character at or below 0x20, and no 0x7f. For example: `^[^\x00-\x20\x7f-][^\x00-\x20\x7f]*$`.
      - This is an annotation only. The predicate, the message and the brand stay as they are.
      - The frozen phase-status module copies the predicate, the message, the annotation and the brand.
- Create `packages/schemas/src/formats/runDirectory.ts`. For each of the five formats, define it with `defineFormat` using the `FORMAT_IDS` id and a human label, `legacy: { 1: frozen v1 }`, `releases: []`, and `current: { name: "v1", shape: phax's schema and decoder }`. From that definition, export:
      - `parse<Format>`;
      - `type <Format>Shape`;
      - `type Latest<Format>`: the current fields without `version`, where each field that an older v1 shape lacked is typed `T | Unknown`. This covers run status `namespace`, phax-plan `run.requiredCommands` and the three planned-file arrays, and phase status `branchName`;
      - the pure `toLatest<Format>(value)`. It keeps every recorded field the latest shape has, sets each missing fact to `UNKNOWN`, drops `version` and anything the latest shape has no place for (phax-plan's `run.backend`), and never invents a value.

    Export each format's definition so that `index.ts` can register it with `parseDocument`.
- Update `packages/schemas/src/index.ts`:
      - re-export `RegistrySchema`, `RunStatusSchema`, `PhaseStatusSchema`, `PhaxPlanSchema` and `ComplianceReviewSchema`, and their types `Registry`, `RunStatus`, `PhaseStatus`, `PhaxPlan` and `ComplianceReview`, all from phax's own modules;
      - re-export the new parse, toLatest, shape and frozen types;
      - add the five definitions to `DocumentShapes` and to the `makeDocumentParser` call.

    Never re-declare a schema or a decode option for the current shape.
- Copy fixtures into `tests/unit/schemasPackage/fixtures/<format id>/v1/`, using plan 1's naming contract: the content is `JSON.stringify(value, null, 2) + "\n"`, and the name is the first 16 hex characters of its sha256, plus `.json`.
      - Copy up to ten documents of each older shape. That means every run status without `namespace`, and each of the phax-plan shapes, including at least one plan whose phases lack the planned-file arrays.
      - Copy at least three documents of the current shape.
      - For the registry, copy `~/.phax/registry.json`. If it is over 200 KB, keep a subset of its entries, and say so in the handoff.
      - A shape seen only in git history, such as the phase status without `branchName`, gets a derived document built inside the test, not a fixture.
- Create `tests/unit/schemasPackage/fixtures.ts`, a shared helper:
      - `readFixtures(formatId, shape)` returns `[name, content]` pairs, sorted;
      - `assertNamingContract(name, content)`.

    Optionally move `phaseRecordManifestHistory.test.ts` onto the helper.
- Do not change any phax decoder's verdict, any persisted shape or the CLI. Leave phax's read sites alone: plan 4 routes them through the package.

### Planned files to create

- `packages/schemas/src/formats/runDirectory.ts`
- `packages/schemas/src/history/registry/v1.ts`
- `packages/schemas/src/history/run-status/v1.ts`
- `packages/schemas/src/history/phase-status/v1.ts`
- `packages/schemas/src/history/phax-plan/v1.ts`
- `packages/schemas/src/history/compliance-review/v1.ts`
- `tests/unit/schemasPackage/fixtures.ts`
- `tests/unit/schemasPackage/runDirectoryHistory.test.ts`

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
- `tests/type/schemasPackage.ts`

### Optional files that may be edited

- `tests/unit/schemasPackage/phaseRecordManifestHistory.test.ts`
- `tests/unit/schemasPackage/parseDocument.test.ts`
- `tests/unit/branded.test.ts`

### Boundary contracts

Producers: `src/schemas/registry.ts`, `status.ts`, `phaxPlan.ts` and `complianceReview.ts`. They own each current schema, its decoder and its excess-property setting. `src/domain/branded.ts` owns `BranchNameSchema`, which now carries a JSON Schema pattern.

Consumer: `packages/schemas/src/formats/runDirectory.ts`. It re-exports those schemas and wraps those decoders in `defineFormat`. It never declares a current-shape schema of its own.

The contract of `defineFormat`'s literal fallback: a document of the current shape always gets phax's verdict. A document that phax rejects gets a second reading only from the frozen module of its own literal, and when both reject it, the failure reported is phax's.

Later consumers: plan 4's own-formats bridge, which reads the registry and the run and phase status through these definitions and `toLatest`, and refuses when a fact it needs is unknown (for example, a run status without `namespace`). Phase-05's JSON Schema table.

### Test strategy

Write these tests first:

- `tests/unit/schemasPackage/shapes.test.ts`: the literal fallback, on a toy format whose current `v1` rejects a document that its frozen `v1` accepts. The document parses with shape `v1`. A document both reject returns the current decoder's failure. Nothing throws.
- `tests/unit/schemasPackage/runDirectoryHistory.test.ts`, for each of the five formats:
    - every fixture follows the naming contract and parses `ok` with shape `v1`, and narrowing on `shape` typechecks;
    - every older-shape fixture parses `ok`: a run status without `namespace`, and phax-plans without `requiredCommands` or with `run.backend`;
    - a derived phase status without `branchName` parses `ok`;
    - `toLatest<Format>` keeps every recorded field, drops `version`, and marks each absent fact `{ kind: "unknown" }`: `namespace` for the old run status, `requiredCommands` and the planned-file arrays for the old phax-plans, and `branchName` for the derived phase status;
    - the frozen module decodes every current-shape fixture to the same value as phax's decoder;
    - where the literal had one shape, `JSONSchema.make` of the frozen module deep-equals that of phax's schema;
    - the `BranchNameSchema` pattern agrees with `isSafeBranchName` on a table of names: empty, a leading `-`, a space, a tab, `\x7f`, `feat/x`, `a-b.c` and a 255-character name.
- `tests/unit/schemasPackage/parse.test.ts`: the acceptance case. A run-status whose `state` is `paused` returns `ok: false` with `error.path` `state` and a non-empty message, and does not throw.
- `tests/unit/schemasPackage/parity.test.ts`: accepted and rejected current-shape documents for each of the five formats, run through phax's decoder and the package's parse function. The verdicts agree on every case, and the rejections are ones no historical shape admits. The acceptance case is a registry with one unknown key, which both accept. Also cover a run status and a phase status with an unknown key (both accept) and a phax-plan and a compliance review with an unknown key (both reject).
- `tests/type/schemasPackage.ts`: each package type is assignable to phax's type and back. phax's current type is assignable to each frozen `V1` type, and the two are equal where the literal had one shape.

Update `exports.test.ts` to the new runtime export set, and `frozenHistory.test.ts` to the new lock keys.

### Implementation order

1. Read plan 1's package files and tests.
2. Write the literal fallback in shapes.ts with its toy-format tests.
3. Enumerate each format's shapes from git history and the real documents, then copy the fixtures.
4. Annotate BranchNameSchema and test its pattern.
5. Write the five frozen v1 modules and pin them with scripts/schemas-check.ts --write.
6. Write formats/runDirectory.ts and the index exports, and register the formats with parseDocument.
7. Write the history, parity, parse, type, exports and frozen-history tests.

### Excluded scope

- Repository formats: approvals ledgers and spec and plan documents (phase-02).
- Record manifests and the record-manifest union (phase-03); timeline files and the v0 rule (phase-04).
- JSON Schema files, the gap detector and ajv (phase-05).
- phax reading its own registry or run status through the package, and writing $schema (plan 4).
- Snapshots, the corpus script and the committed corpus (plan 3).

### Verification

The `standard` gate profile in `phax.json`. The generated-index and lock check runs inside `pnpm test`, through `frozenHistory.test.ts`.

### Expected handoff content

Record:

- the literal-fallback rule as implemented in `shapes.ts`;
- for each of the five formats, every shape found under `version: 1`, with the commits that introduced each one, the number of real documents per shape, and where they came from (run directories, archive or records branch);
- where the decoder counts differ from the survey figures in this plan's preamble;
- any shape tested only on a derived document, and why no real document survived;
- the export names added to the entry;
- the `BranchNameSchema` pattern.

The fixture files under `tests/unit/schemasPackage/fixtures/` are expected unplanned creations. Record any other deviation from the planned file lists, with the reason.

### Commit subject

`feat(schemas-package): read every run-directory format with its history`

### Commit body

Add the run registry, run status, phase status, phax-plan and compliance review to @lbdremy/phax-schemas. Each gets its schema and type, re-exported from phax's own module, a parse function that returns the shape id and the exact shape, a toLatest upgrade that marks absent facts unknown, and a registration with parseDocument.

Each format gets a frozen v1 module that accepts every shape phax has written under version 1: run statuses without namespace, and phax-plans without requiredCommands or with the old run.backend. defineFormat now falls back from phax's current decoder to that frozen module when a document of the same literal is rejected, so an older shape stays readable while documents of the current shape keep phax's verdict.

BranchNameSchema gets a jsonSchema pattern equal to its safe-name predicate. This is an annotation only; decoding does not change. Tests run over real documents copied from ~/.phax and the records branch, and they cover the spec's paused run status and the registry with an unknown key.

---

## phase-02 — Repository formats: approvals ledgers, spec and plan documents {#phase-02-repository}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

A reader can parse `docs/plans/approvals.json`, `docs/specs/approvals.json`, and the JSON sidecar beside any headless-authored spec or plan, in every shape phax has committed to this repository. The reader gets phax's verdict on the current shape and an upgrade to the latest one.

### Detailed instructions

- Enumerate the shapes from this repository's history:
      - List the ledger commits with `git log --format=%H -- docs/plans/approvals.json` and the same for `docs/specs/approvals.json`. Those are the only two ledger paths git has ever held.
      - List the sidecar commits with `git log --format=%H -- docs/specs docs/plans`, then take the `*.json` paths other than `approvals.json` from `git ls-tree -r --name-only <commit> docs/`.
      - Read each blob with `git cat-file -p <commit>:<path>`, and keep the distinct contents.
      - Run phax's current decoder over every one of them (`decodeApprovalRecordFile`, `decodeSpecApprovalRecordFile`, `decodeSpecDocument`, `decodePlanDocument`), and group the rejections by first error.
      - Read `git log -p` of `src/schemas/approvalRecord.ts`, `specApprovalRecord.ts`, `specDocument.ts`, `planDocument.ts` and `phaxPlan.ts`, which supplies the plan document's phase fields.
      - The spec (§1) reports one ledger shape across 84 commits. Confirm it. Check especially whether older plan sidecars carry phase keys the current plan document rejects.
- Annotate the traceability filter in `src/schemas/specDocument.ts`, `Schema.filter(firstTraceabilityViolation)`, before you freeze its twin:
      - Add a `jsonSchema` annotation whose only key is a `description`. The description names the checks JSON Schema cannot express: unique requirement, question and option ids; every `refs` entry naming an existing requirement; every requirement referenced by a criterion; and a `recommendation` that names one of its question's options.
      - It adds no constraint, and the verdict does not change.
      - If a test pins `phax artifact schema spec` output, update it in `tests/unit/specDocument.test.ts`.
- Create the frozen modules `packages/schemas/src/history/<format id>/v1.ts` for plan-approvals, spec-approvals, spec-document and plan-document, following phase-01's rules:
      - Put the same header comment on each one.
      - Import only `effect`, and inline every sub-schema.
      - The plan-document module inlines phaxPlan's phase fields and effort set.
      - The spec-document module copies the traceability predicate and its annotation.
      - Use `onExcessProperty: "error"`, as phax does for all four.
      - Accept every shape found under `version: 1`.
      - Export `<Format>V1Schema`, `type <Format>V1` and `decode<Format>V1`.

    Pin them with `--write`.
- Create `packages/schemas/src/formats/repository.ts`, defining the four formats with `defineFormat` and `current: { name: "v1", shape: phax's schema and decoder }`, as in phase-01. For each format, export:
      - `parsePlanApprovals`, `parseSpecApprovals`, `parseSpecDocument` or `parsePlanDocument`;
      - its shape type, its `Latest<Format>` type and its `toLatest<Format>`, which drops `version` and marks unknown every fact an older shape lacked.
- Update `packages/schemas/src/index.ts`. Re-export these schemas and types:
      - `PlanApprovalsSchema` and `type PlanApprovals`, which are phax's `ApprovalRecordFileSchema` and `ApprovalRecordFile`;
      - `SpecApprovalsSchema` and `type SpecApprovals`, which are phax's `SpecApprovalRecordFileSchema` and `SpecApprovalRecordFile`;
      - `SpecDocumentSchema`, `type SpecDocument`, `PlanDocumentSchema` and `type PlanDocument`.

    Also re-export the new parse and upgrade functions and their types, and register the four definitions with `parseDocument`.
- Copy fixtures into `tests/unit/schemasPackage/fixtures/<format id>/v1/` using the naming contract:
      - every distinct document of each older shape, up to ten per shape;
      - the oldest and the newest ledger of each kind;
      - at least three sidecars of each document kind in the current shape.
- The ledger's `records` is a map keyed by artifact path, not an array. Keep phax's shape exactly.

### Planned files to create

- `packages/schemas/src/formats/repository.ts`
- `packages/schemas/src/history/plan-approvals/v1.ts`
- `packages/schemas/src/history/spec-approvals/v1.ts`
- `packages/schemas/src/history/spec-document/v1.ts`
- `packages/schemas/src/history/plan-document/v1.ts`
- `tests/unit/schemasPackage/repositoryHistory.test.ts`

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
- `tests/unit/schemasPackage/fixtures.ts`

### Boundary contracts

Producers: `src/schemas/approvalRecord.ts`, `specApprovalRecord.ts`, `specDocument.ts` and `planDocument.ts`, with `phaxPlan.ts` supplying the plan document's phase fields. They own the current schemas and decoders. `specDocument.ts` now also owns the declared-gap annotation of its traceability filter.

Consumer: `packages/schemas/src/formats/repository.ts`, which re-exports the schemas and wraps the decoders.

Outside consumer: the steme docs pipeline and cockpit, which read the ledgers and sidecars from a clone. They rely on the spec's names and the `Parsed` shape.

### Test strategy

Write `tests/unit/schemasPackage/repositoryHistory.test.ts` first. For each of the four formats:

- every fixture follows the naming contract and parses `ok` with shape `v1`;
- older-shape fixtures and derived documents parse;
- `toLatest<Format>` keeps every recorded field, drops `version` and marks absent facts unknown;
- the frozen module agrees with phax's decoder on every current-shape fixture;
- where the literal had one shape, the frozen module's `JSONSchema.make` equals phax's;
- a spec document with a dangling `refs` entry is rejected by both `parseSpecDocument` and the frozen module, with the traceability message.

Also:

- `parity.test.ts`: accepted and rejected current-shape cases for each format, including one unknown key, which every one of the four rejects, and a `baseline` that is not 40-hex.
- `tests/type/schemasPackage.ts`: types in both directions, and phax's type assignable to each frozen type.

Update the export set and the lock keys.

### Implementation order

1. Enumerate the ledger and sidecar shapes from git history, and copy the fixtures.
2. Annotate the spec document's traceability filter.
3. Write the four frozen v1 modules and pin them.
4. Write formats/repository.ts and the index exports, and register the formats with parseDocument.
5. Write the history, parity, type, exports and frozen-history tests.

### Excluded scope

- Parsing spec or plan Markdown frontmatter (a spec non-goal).
- The artifact-decide ledger changes (its own plan, recorded later through the snapshot gate).
- Record manifests and timeline files (phase-03 and phase-04).
- JSON Schema files (phase-05).
- The committed corpus of every ledger commit (plan 3).

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

Record:

- for each of the four formats, every shape found under `version: 1`, with the commits that introduced each one and the number of distinct documents per shape;
- the exact annotation added to the traceability filter;
- the export names added;
- whether `phax artifact schema spec` output changed, and which test you updated.

Fixture files are expected unplanned creations. Record any other deviation, with the reason.

### Commit subject

`feat(schemas-package): read approvals ledgers and spec and plan documents`

### Commit body

Add the plan and spec approvals ledgers and the spec and plan documents to @lbdremy/phax-schemas. Each gets its schema and type from phax's own module, a frozen v1 module that accepts every shape written under version 1, a parse function, a toLatest upgrade and a registration with parseDocument.

The spec document's traceability filter gets a jsonSchema annotation. Its description names the cross-reference checks that JSON Schema cannot express and that the parser enforces, so the gap is declared rather than silent. Decoding does not change.

Tests run over real ledgers and sidecars read from this repository's git history.

---

## phase-03 — Record manifests: authoring record manifest and the record-manifest union {#phase-03-record-manifests}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

A reader walking `phax/records/v1` can hand any `record.json` to one function and get back whether it is a phase or an authoring manifest, which shape it has, and its exact type. Both legacy authoring shapes, with and without `sourceSha`, parse.

### Detailed instructions

- Move the phase record manifest's `defineFormat` definition, `parsePhaseRecordManifest`, its types and `toLatestPhaseRecordManifest` out of `packages/schemas/src/index.ts` and into a new `packages/schemas/src/formats/recordManifests.ts`. The entry re-exports them unchanged, and no behaviour changes.
- Enumerate the authoring shapes:
      - Read `git log -p -- src/schemas/authoringRecord.ts`.
      - Walk every commit of `phax/records/v1` in `~/.phax/records/phax`, as phase-01 does, and collect every distinct `authoring/*/record.json`.
      - Run `decodeAuthoringRecordManifest` over each one.
      - The spec counts 8 at version 1, 2 of them without `sourceSha`. Confirm the count, and check whether today's optional `sourceSha` already admits both, or whether another difference separates them.
- Create `packages/schemas/src/history/authoring-record-manifest/v1.ts`, following phase-01's rules:
      - Put the same header comment on it.
      - Import only `effect`, and inline the provider id, token usage and record shape.
      - Use `onExcessProperty: "error"`.
      - Accept both legacy shapes, with and without `sourceSha`, and any other shape found.
      - Export `AuthoringRecordManifestV1Schema`, `type AuthoringRecordManifestV1` and `decodeAuthoringRecordManifestV1`.

    Pin it.
- In `formats/recordManifests.ts`, define `authoring-record-manifest` with `current: { name: "v1", shape: phax's AuthoringRecordManifestSchema and decodeAuthoringRecordManifest }` and `legacy: { 1: frozen v1 }`. Export:
      - `parseAuthoringRecordManifest`;
      - `type AuthoringRecordManifestShape`;
      - `type LatestAuthoringRecordManifest`;
      - `toLatestAuthoringRecordManifest`. It drops `version` and keeps `sourceSha` absent when it was absent: an absent `sourceSha` records a failed session, it is not an unknown fact.
- Add `parseRecordManifest(input)`. It never throws, and it returns the `ParsedDocument` shape over the two manifest formats (`format`, `shape`, `value`). It dispatches in order:
      - A non-object fails at `""`.
      - A document with `$schema` naming `phase-record-manifest` or `authoring-record-manifest` goes to that format's `parse`. Any other `$schema` fails at `$schema`, naming the URL and saying it is not a record manifest. An unknown format id gets the shared upgrade message.
      - A document with `kind === "authoring"` goes to the authoring manifest, the same rule as phax's `isAuthoringRecordManifest`.
      - Every other document goes to the phase record manifest.
- Also export:
      - `RecordManifestSchema` and `type RecordManifest`, which are phax's union from `src/schemas/authoringRecord.ts`;
      - `type LatestRecordManifest`;
      - the pure `toLatestRecordManifest`, which dispatches on the parsed format.
- Update `packages/schemas/src/index.ts`:
      - re-export `AuthoringRecordManifestSchema` and `type AuthoringRecordManifest`, plus all the new functions and types;
      - register `authoring-record-manifest` with `parseDocument`.

    The union has no format id, so it is not registered.
- Copy every distinct authoring manifest into `tests/unit/schemasPackage/fixtures/authoring-record-manifest/v1/` using the naming contract.

### Planned files to create

- `packages/schemas/src/formats/recordManifests.ts`
- `packages/schemas/src/history/authoring-record-manifest/v1.ts`
- `tests/unit/schemasPackage/recordManifestHistory.test.ts`

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
- `tests/unit/schemasPackage/fixtures.ts`

### Boundary contracts

Producer: `src/schemas/authoringRecord.ts`. It owns `AuthoringRecordManifestSchema`, `decodeAuthoringRecordManifest`, the union `RecordManifestSchema` with `decodeRecordManifest`, and the `isAuthoringRecordManifest` rule.

Consumer: `packages/schemas/src/formats/recordManifests.ts`.

Contract: on current-shape documents, `parseRecordManifest` gives the same verdict as `decodeRecordManifest`, and its `format` agrees with `isAuthoringRecordManifest`.

Outside consumer: the §6 Node consumer walking the branch, which imports `parseRecordManifest` for any `record.json`.

### Test strategy

Write `tests/unit/schemasPackage/recordManifestHistory.test.ts` first.

The acceptance case: the two legacy authoring shapes, one with `sourceSha` and one without. Each fixture parses `ok` with shape `v1`.

For `toLatestAuthoringRecordManifest`: it keeps every field, drops `version` and never adds `sourceSha`.

`parseRecordManifest`:

- over every authoring fixture, it returns `format: "authoring-record-manifest"`;
- over every phase record fixture, v1 and v2, it returns `format: "phase-record-manifest"` with the right shape;
- a `$schema` naming `registry` fails, naming the URL;
- a newer release fails with the upgrade message;
- a non-object fails;
- nothing throws.

`toLatestRecordManifest` gives the same result as the format's own upgrade.

The frozen module agrees with phax's decoder on every fixture, and its `JSONSchema.make` equals phax's if the literal had one shape.

In `parity.test.ts`:

- `parseAuthoringRecordManifest` versus `decodeAuthoringRecordManifest`, and `parseRecordManifest(x).ok` versus `decodeRecordManifest(x)`, over accepted and rejected current-shape cases. These include an unknown key (both reject) and a v2 phase manifest carrying `kind: "authoring"` (both reject).
- For every accepted case, `format === "authoring-record-manifest"` exactly when `isAuthoringRecordManifest` holds.

`tests/type/schemasPackage.ts`: types in both directions for the authoring manifest and the union, and `parseRecordManifest` narrowing on `format` and `shape`.

### Implementation order

1. Move the phase record manifest's definition into formats/recordManifests.ts, and keep the existing tests green.
2. Enumerate the authoring shapes from the records clone, and copy the fixtures.
3. Write the frozen authoring v1 module and pin it.
4. Write the authoring definition, parseRecordManifest and the toLatest functions.
5. Update the entry exports and parseDocument, then the parity, type, exports and frozen-history tests.

### Excluded scope

- Timeline files of a record (phase-04).
- A reading helper that walks the records branch (a spec non-goal).
- JSON Schema files, including record-manifest.schema.json (phase-05).
- The oracle-phases and headless-review changes to manifests (their own plans).

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

Record:

- the authoring shapes found, with document counts and what separates them;
- the dispatch order of `parseRecordManifest` and its failure messages;
- the move of the phase record manifest's definition;
- the new export names.

Fixture files are expected unplanned creations. Record any other deviation, with the reason.

### Commit subject

`feat(schemas-package): read the authoring record manifest and any record manifest`

### Commit body

Add the authoring record manifest to @lbdremy/phax-schemas, with a frozen v1 module that accepts both legacy shapes, with and without sourceSha. Add parseRecordManifest, which reads any record.json on phax/records/v1. It dispatches on $schema, then on kind "authoring", then falls back to the phase record manifest, and names the format it read. RecordManifestSchema is phax's own union.

The phase record manifest's definition moves beside the authoring one, and toLatestRecordManifest upgrades either kind. Tests cover the real authoring records from the records branch.

---

## phase-04 — Record timeline files: gate attribution, file reconciliation, gate diagnostics and pending (v0) {#phase-04-record-timeline}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

A reader holding a record folder can parse its `gate-attribution.json`, `file-reconciliation.json` and every `checks-attempt-NN.diagnostics.json` and `checks-attempt-NN.pending.json` with phax's verdict. Each file reports shape `v0`. The reader can rebuild a phase's gate steps, its fix-loop attempts in order and its file reconciliation.

### Detailed instructions

- Extend `defineFormat` in `packages/schemas/src/shapes.ts` with the unversioned shape:
      - When a format has a `v0` shape (`current.name === "v0"` or `legacy[0]` exists), a document carrying neither `$schema` nor `version` decodes as `v0`, through the same current-then-frozen fallback as phase-01.
      - `version: 0` is never a known literal, so a document with a `version` key keeps resolving by literal.
      - A format without a `v0` shape keeps the missing-`$schema` failure.
      - Update the doc comment.
      - If `document.ts`'s missing-`$schema` message needs a timeline example, adjust the message only.
- Enumerate the shapes:
      - Read `git log -p` of `src/schemas/gateAttribution.ts`, `reconciliation.ts`, `gateDiagnostics.ts` and `gatePending.ts`.
      - Walk every commit of `phax/records/v1` in `~/.phax/records/phax`, as phase-01 does. Collect every distinct `<runId>/<phaseId>/gate-attribution.json`, `file-reconciliation.json`, `checks-attempt-*.diagnostics.json` and `checks-attempt-*.pending.json`. Confirm the exact file names from a tree listing.
      - The run directories under `~/.phax/runs/` and `~/.phax/archive/*/runs/` hold further copies: about 57 `gate-attribution.json` and 383 `file-reconciliation.json`. Include them.
      - Run phax's current decoders over each one: `decodeGateAttribution`, `decodePhaseFileReconciliation`, `decodeGateDiagnosticsDocument` and `decodeGatePendingDocument`.
      - The candidates to confirm are: diagnostics without `class` and `scopes` (from before the gate-step-scheduling plan), attribution results without `pending` (a widening only), and a reconciliation without `createdButPlannedEdit` and `editedButPlannedCreate`.
- Create the frozen modules `packages/schemas/src/history/<format id>/v0.ts` for gate-attribution, phase-file-reconciliation, gate-diagnostics and gate-pending:
      - Put phase-01's header comment on each one.
      - Import only `effect`, and inline the sub-schemas: surface, the diagnostic union and completion diagnostic, and the positive-integer line.
      - Keep phax's default excess-property setting, which ignores unknown keys, for all four.
      - Accept every shape found. For example, a diagnostic without `class` is a third union member.
      - Export `<Format>V0Schema`, `type <Format>V0` and `decode<Format>V0`, for the Formats `GateAttribution`, `PhaseFileReconciliation`, `GateDiagnostics` and `GatePending`.

    Pin them.
- Create `packages/schemas/src/formats/recordTimeline.ts`, defining the four formats with `legacy: { 0: frozen v0 }`, `releases: []` and `current: { name: "v0", shape: phax's schema and decoder }`. For each format, export:
      - `parseGateAttribution`, `parsePhaseFileReconciliation`, `parseGateDiagnostics` or `parseGatePending`;
      - its shape type and its `Latest<Format>` type;
      - its `toLatest<Format>`, which keeps every recorded field and marks unknown each fact an older shape lacked. For example, a legacy diagnostic's `class` becomes `{ kind: "unknown" }`.
- Update `packages/schemas/src/index.ts`. Re-export:
      - `GateAttributionSchema` and `PhaseFileReconciliationSchema`, with their types;
      - `GateDiagnosticsSchema` and `type GateDiagnostics`, which are phax's `GateDiagnosticsDocumentSchema` and `GateDiagnosticsDocument`;
      - `GatePendingSchema` and `type GatePending`, which are phax's `GatePendingDocumentSchema` and `GatePendingDocument`;
      - the new functions and types.

    Register the four definitions with `parseDocument`.
- Copy fixtures into `tests/unit/schemasPackage/fixtures/<format id>/v0/` using the naming contract: every document of each older shape, up to ten per shape, and at least three of the current shape.
- For the acceptance criterion, find a record folder whose phase ran a diagnostics step at least twice. Copy its `record.json`, `gate-attribution.json`, `file-reconciliation.json` and every `checks-attempt-NN.diagnostics.json` and `checks-attempt-NN.pending.json` into `tests/unit/schemasPackage/fixtures/record-folder/<runId>-<phaseId>/`, keeping their names. If no single folder holds both a diagnostics document and a pending document across two attempts, take the richest folder and say so in the handoff.

### Planned files to create

- `packages/schemas/src/formats/recordTimeline.ts`
- `packages/schemas/src/history/gate-attribution/v0.ts`
- `packages/schemas/src/history/phase-file-reconciliation/v0.ts`
- `packages/schemas/src/history/gate-diagnostics/v0.ts`
- `packages/schemas/src/history/gate-pending/v0.ts`
- `tests/unit/schemasPackage/recordTimelineHistory.test.ts`

### Planned files to edit

- `packages/schemas/src/shapes.ts`
- `packages/schemas/src/index.ts`
- `packages/schemas/history.lock.json`
- `tests/unit/schemasPackage/shapes.test.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/exports.test.ts`
- `tests/unit/schemasPackage/frozenHistory.test.ts`
- `tests/type/schemasPackage.ts`

### Optional files that may be edited

- `packages/schemas/src/document.ts`
- `tests/unit/schemasPackage/parseDocument.test.ts`
- `tests/unit/schemasPackage/fixtures.ts`

### Boundary contracts

Producers: `src/schemas/gateAttribution.ts`, `reconciliation.ts` (`PhaseFileReconciliationSchema`, not the internal `globalReconciliation.ts`), `gateDiagnostics.ts` and `gatePending.ts`. They own the current schemas and their default excess-property setting.

Consumer: `packages/schemas/src/formats/recordTimeline.ts`.

Contract with the reader: every timeline file resolves to `v0` without a marker, and an attempt's order comes from its file name, which the reader supplies. The package reads values, never paths.

Later consumer: plan 4, which gives these formats their first `$schema` shape.

### Test strategy

Write these tests first:

- `tests/unit/schemasPackage/shapes.test.ts`: the `v0` rule on a toy format:
    - a document with neither marker parses as `v0`, through the current decoder and then the frozen fallback;
    - `version: 0` fails as an unknown literal;
    - a format without `v0` keeps the missing-`$schema` failure.
- `tests/unit/schemasPackage/recordTimelineHistory.test.ts`:
    - every fixture follows the naming contract and parses `ok` with shape `v0`;
    - older-shape fixtures and derived documents parse;
    - `toLatest<Format>` marks absent facts unknown and keeps every recorded field;
    - the frozen modules agree with phax's decoders on every current-shape fixture, with `JSONSchema.make` equal where a format had one shape;
    - the acceptance case, on the record-folder fixture: every file parses `ok`, the four timeline files report `v0`, `record.json` parses with `parseRecordManifest`, and the attempts' diagnostics, sorted by attempt number from their file names, come back in order, so both fix-loop attempts can be shown.
- `parity.test.ts`: accepted and rejected current-shape cases for each format. Each includes one unknown key, which both phax and the package accept, and a rejection no historical shape admits, such as a gate step whose `result` is `skipped`.
- `tests/type/schemasPackage.ts`: types in both directions.

Update the export set and the lock keys.

### Implementation order

1. Write the v0 rule in shapes.ts with its toy-format tests.
2. Enumerate the timeline shapes from the records clone and the run directories, and copy the fixtures and the record folder.
3. Write the four frozen v0 modules and pin them.
4. Write formats/recordTimeline.ts and the index exports, and register the formats with parseDocument.
5. Write the history, record-folder, parity, type, exports and frozen-history tests.

### Excluded scope

- Technical files of a record: agent binding, model resolution, orient brief, security posture, transcript (internal, spec §5.6).
- The run-level global-file-reconciliation.json (internal).
- A reading helper that lists a record folder (a spec non-goal).
- JSON Schema files (phase-05).

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

Record:

- the `v0` rule as implemented;
- for each format, the shapes found, with their commits and document counts;
- the record folder chosen for the acceptance fixture, and the files it holds;
- the new export names.

Fixture files, including the record folder, are expected unplanned creations. Record any other deviation, with the reason.

### Commit subject

`feat(schemas-package): read a record's timeline files as unversioned shape v0`

### Commit body

Add the gate attribution, phase file reconciliation, gate diagnostics and gate pending documents to @lbdremy/phax-schemas. A reader can now rebuild a phase's gate, fix loops and reconciliation from its record without a parser of its own.

These files never carried a version literal. defineFormat reads a document with neither $schema nor version as the format's v0 shape: phax's current decoder reads it first, then the frozen v0 module that accepts every shape phax wrote, such as diagnostics from before the class field. toLatest marks every fact an older shape lacked as unknown.

Tests cover real record folders from phax/records/v1, including one whose phase ran a diagnostics step twice.

---

## phase-05 — parseDocument complete and one draft-07 JSON Schema per format {#phase-05-json-schemas}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

A docs pipeline finds a draft-07 JSON Schema per format at `@lbdremy/phax-schemas/json/<format>.schema.json`, generated from the same schema the parse function uses, and every phax-written document validates against it. A schema that cannot be rendered faithfully fails the build, naming the format. `parseDocument` reads every format id.

### Detailed instructions

- Create `packages/schemas/build/jsonSchemas.ts`, which is pure:
      - A table `JSON_SCHEMA_FORMATS`. It has one entry per format id in `FORMAT_IDS`, plus `record-manifest` for the union. Each entry holds the file name `<id>.schema.json`, a root title `phax <label>`, the schema re-exported from the package entry, and `excess: "error" | "ignore"`.
      - `findJsonSchemaGaps(schema): string[]`. It walks the AST, following suspends once per node, and returns the path of every `Refinement` without a `jsonSchema` annotation. Brand refinements, and effect's built-in refinements that carry their own annotation, are not gaps.
      - `renderJsonSchemas(table)`, which returns `{ files: Map<fileName, content>, failures: Array<{ format, reason }> }`. For each entry:
          - gaps fail the format, naming its paths;
          - otherwise `JSONSchema.make` renders it, and a thrown error fails the format with its message;
          - an `excess: "ignore"` entry renders with extra properties allowed. Use the `additionalPropertiesStrategy: "allow"` option if the installed Effect has it; otherwise remove every `additionalProperties: false` from the output;
          - the root `title` is set from the table;
          - the content is `JSON.stringify(value, null, 2) + "\n"`;
          - a failed format has no file.
- Set `excess` from each phax decoder's setting:
      - `ignore` for registry, run-status, phase-status, gate-attribution, phase-file-reconciliation, gate-diagnostics and gate-pending;
      - `error` for every other entry.

    A test pins this against real behaviour: a fixture of each format with one unknown key added is accepted by the package if and only if the entry says `ignore`.
- Create `scripts/schemas-json.ts`, in the style of `scripts/schemas-check.ts`, with its logic exported behind a main guard:
      - `writeJsonSchemas(table, outDir)` clears `outDir`, writes the rendered files, prints `✗ <format>: <reason>` for each failure, and returns the failures.
      - The main guard writes `packages/schemas/json/` and exits 1 on any failure.

    Change the root `build` script to `tsc -p tsconfig.build.json && tsc -p packages/schemas/tsconfig.build.json && tsx scripts/schemas-json.ts`.
- Update `packages/schemas/package.json`:
      - `files` becomes `["dist", "json"]`;
      - `exports` gains `"./json/*": "./json/*"` beside `.`.

    Add `packages/schemas/json/` to `.gitignore`, and `packages/schemas/json` to `.oxfmtrc.json` `ignorePatterns`. Do the same in `.oxlintrc.json` if oxlint reads it.
- Add the draft-07 validator with `pnpm add -D ajv`. It is used only in tests, and the package's own dependencies stay exactly `effect`.
- Pin `parseDocument` complete. `DocumentFormatId` must equal `FormatId`: add a type-level `Equals` assertion in `tests/type/schemasPackage.ts`, and a runtime test that every id in `FORMAT_IDS` resolves to its definition. Build a `$schema` document at a release above the package version and expect the newer-release message, never the unknown-format message.
- Extend the closure guard in `tests/unit/architecturalGuards.test.ts` (§5.6) so that the closure never reaches an internal schema module. The list is: `claudeOutput`, `codexOutput`, `vibeOutput`, `vibeConfig`, `phaxConfig`, `securityConfig`, `telemetryConfig`, `providerConfig`, `recordsConfig`, `globalReconciliation`, `codeReviewSession`, `adjustPlanSession`, `phaseAgentBinding`, `modelRouting`, `securityPosture`, `extractedPlanCacheEntry`, `orient`, `orientBrief`, `planAudit`, `telemetryEvents` and `publication`, each under `src/schemas/`.
- Run `pnpm build` and check that `packages/schemas/json/` holds exactly sixteen files.

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

Producer: `packages/schemas/build/jsonSchemas.ts`. It takes its schemas from the package entry, the same values the parse functions use.

Consumer: `scripts/schemas-json.ts`, run by the root `build` script, which the `standard` gate's terminal `pnpm build` step runs.

Outside consumer: the steme docs pipeline. It reads `node_modules/@lbdremy/phax-schemas/json/<format>.schema.json` and relies on one draft-07 file per exported format describing its current shape.

Later consumer: plan 3's snapshot gate, which commits these renderings per shape.

### Test strategy

Write `tests/unit/schemasPackage/jsonSchemas.test.ts` first:

- The table has exactly one entry per `FORMAT_IDS` id plus `record-manifest`, and every file name is unique.
- `renderJsonSchemas` over the real table returns no failures and sixteen files. Each file's `$schema` is draft-07 and its root `title` is `phax <label>`.
- `findJsonSchemaGaps` finds nothing in the real schemas. On a toy schema with an unannotated `Schema.filter`, it returns the filter's path. A brand-only refinement is not a gap.
- The acceptance case (a format without a JSON Schema fails the build): `writeJsonSchemas` over a toy table, one entry with an unannotated filter and one clean entry, into a temp directory. It returns one failure naming the toy format, writes the clean file, and writes no file for the failing format. The script's main guard exits 1 in that case.
- The acceptance case (every exported format has a usable JSON Schema): each rendered schema loads into `new Ajv()` from `ajv`. Every current-shape fixture of its format, and every file of the record-folder fixture, validates.
- The `excess` pin, as described in the detailed instructions.

Also update:

- `manifest.test.ts`: `files` is `["dist", "json"]`, and the exports are exactly `.` and `./json/*`.
- `exports.test.ts`: the final runtime export set, which is every parse, toLatest and schema export of the sixteen formats, plus `parseDocument`, `UNKNOWN` and `isUnknown`, and nothing else.
- The closure guard.

### Implementation order

1. Write the gap detector and the renderer, with the toy-schema tests.
2. Write the table and pin its excess settings.
3. Write scripts/schemas-json.ts, and wire it into the build script, the package manifest, .gitignore and the oxfmt ignores.
4. Add ajv and the validation tests over the fixtures.
5. Pin parseDocument complete, and extend the closure guard.
6. Run pnpm build and check the json/ output.

### Excluded scope

- Committed JSON Schema snapshots per shape, the next snapshot and the snapshot gate (plan 3).
- Hosting schemas at docs.phax.run (a spec non-goal for the package; the docs pipeline serves them).
- The tarball smoke and the scan of the packed tarball (plan 5).
- The README persisted-formats table and the docs page (plan 5).

### Verification

The `standard` gate profile in `phax.json`. Its terminal `pnpm build` step now runs `scripts/schemas-json.ts` and fails on any JSON Schema gap. Run `pnpm build` in the phase as well, to confirm the sixteen files.

### Expected handoff content

Record:

- the table, with each format's file name, title and excess setting;
- how `excess: "ignore"` is rendered (the Effect option or post-processing);
- the gap detector's rules, including what counts as a brand;
- the final `exports` map and `files`;
- the final runtime export set of the entry;
- the internal modules added to the closure guard;
- the installed ajv version and any option it needed.

Record any deviation from the planned file lists, with the reason.

### Commit subject

`feat(schemas-package): ship one draft-07 JSON Schema per format and fail on gaps`

### Commit body

The build now writes packages/schemas/json/<format id>.schema.json for every persisted format, plus record-manifest.schema.json for the union, each generated from the schema its parse function uses. The package ships them under its ./json/* export.

Effect's JSONSchema.make silently drops a refinement that has no jsonSchema annotation. The build therefore walks each schema and fails, naming the format and writing no file for it, on any unannotated refinement or rendering error. A format whose decoder ignores unknown keys renders with extra properties allowed, matching phax's verdict.

parseDocument is pinned to read every format id, and the closure guard now refuses every internal schema module. Tests load each schema into ajv, a draft-07 validator, and validate real phax-written documents.
