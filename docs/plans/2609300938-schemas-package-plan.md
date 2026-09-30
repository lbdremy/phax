---
status: Approved
source-spec: docs/specs/2609241238-schemas-package.md
approved:
  date: 2026-09-30
  baseline: cf24daf
---
# schemas-package 3/5 — support starts now

Third of the five plans that ship the `schemas-package` spec. Plans 1 and 2 (PR #104, PR #105) built `@lbdremy/phax-schemas`. It has every format of spec §5 `formats` under `packages/schemas/src/formats/<family>.ts`, plus `parseDocument`, a `toLatest` per format, one JSON Schema per format and `scripts/schemas-check.ts`. They also built the history reading that the spec has since dropped: frozen `v0`/`v1`/`v2` decoders and real documents copied from the records branch. This plan applies the binding decision q-support-start (2026-09-30). Reading support starts at the first release that writes `$schema`. A document without `$schema` is read by its format's pre-schema decoder, which is exactly the shape phax writes today. If that decoder rejects the document, the parse fails as unsupported. The plan then adds the snapshot guard that records every future shape change.

It works in two halves, in this order. First, it removes history reading and every committed real document (phase-01, phase-02). Second, it adds the snapshot gate (phase-03). phax's own formats, decoders and CLI do not change. phax still writes `version` literals and no `$schema`; that is plan 4.

Privacy: some of the fixtures being deleted hold a private repository's run, and several hold a local home path. Removing them is also a privacy fix. Nothing from `~/.phax`, a records branch or another repository may enter this repository. No phase reads `~/.phax`. Every test document is written by hand, or built by encoding a constructed value through phax's schema. The code of closed PRs #106 and #107 (a shared source walk, a corpus extractor) is not to be reintroduced.

Spec coverage:

- Requirements delivered: `pre-schema-unsupported` (§5.10), `synthetic-fixtures` (§5.11) and `snapshot-gate` (§5.17). Of `history-read` (§5.9), the pre-schema half: a document without `$schema` resolves to shape `pre-schema`. Released shapes only appear once plan 4 writes `$schema`.
- Requirements kept satisfied, on hand-written cases: `parity` (§5.7), `failure` (§5.8), `identify-alone` (§5.12), `history-newer` (§5.13), `to-latest` (§5.14), `types` (§5.19), `json-schema` (§5.20) and `json-build-fail` (§5.21). The same goes for `package`, `dependencies`, `pure`, `formats`, `record-files` and `excluded`. For `history-frozen` (§5.16), the lock check stays, with an empty lock until plan 4 freezes the first module.
- Acceptance criteria covered: `ac-history-read` (the pre-schema and unsupported cases; the released-shape case waits for plan 4), `ac-synthetic-fixtures`, `ac-snapshot-gate` (on synthetic cases, since no shape changes here), `ac-record-files` (every timeline file returns shape `pre-schema`), `ac-failure`, `ac-parity`, `ac-types`, `ac-json`, `ac-identify-alone` and `ac-history-newer`. For `ac-history-frozen`, only the lock half.
- Left to later plans: `schema-url` and `ac-producer` (phax writes `$schema`), `ac-own-legacy`, and freezing each pre-schema shape. These are plan 4. `release-names-shapes`, `lockstep`, `release`, `release-gate`, `bump`, `ac-e2e` and the README table are plan 5. `code-review` comes with the headless-review spec.
- The `pre-schema-unsupported` message names the first supported release only generically ('older than the first supported release'). Plan 4 fixes the release.

## Required commands

- `pnpm exec tsx`

phase-03 runs `pnpm exec tsx scripts/schemas-check.ts --write` to write the committed snapshots. `pnpm exec tsx` is already in `security.agentCommands` in `phax.json`, so no security configuration change is needed. Every gate step comes from the existing `standard` profile.

## Technical arbitrations

- A pre-schema document that its decoder rejects fails at the path of the decoder's first violation. The message starts with the unsupported statement ('<label> older than the first supported release — not supported') and ends with the violation's own message. Loss accepted: the root path that the spec's indicative history example shows for an older document. Without `$schema`, an older document and a malformed current one cannot be told apart, and §5.8 / `ac-failure` needs a run status with state 'paused' to fail at `state`.
- The `Latest*` types keep dropping `version` and lose every `| Unknown` member that the frozen twins' optional fields required. `toLatest*` becomes `Omit<X, 'version'>` (the identity for the four timeline formats), and `UNKNOWN` / `isUnknown` stay exported for plan 4's first real shape change. Loss accepted: in this plan, `Latest*` is not byte-for-byte the pre-schema shape, which still carries `version`. In return, consumers' `Latest*` types do not change a second time when plan 4 drops `version`, and no `Unknown` member is typed that no value could ever hold.
- The snapshot check lives in `scripts/schemas-check.ts`, with its pure rules in `packages/schemas/build/snapshots.ts`. It runs on every gate through the unit test that already runs `checkSchemas` on the committed tree. Loss accepted: the `pnpm schemas:check` package script shown in spec §6 (indicative). Adding it would mean a new script and a gate-profile change for no extra coverage. Plan 5 may add it with the release tooling.
- Snapshots are compared as parsed JSON (deep equality), not as bytes, and `packages/schemas/snapshots` is kept out of oxfmt, just like `packages/schemas/json`. Loss accepted: a check that reformatting a snapshot counts as a change. Without the exclusion, the gate's `pnpm format` step would rewrite the files (by collapsing short arrays). A reformatted but equal snapshot records the same shape.

---

## phase-01 — Read the pre-schema shape only, with synthetic test documents {#phase-01-pre-schema-only}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

Every package parse function reads a document without `$schema` as its format's `pre-schema` shape, using phax's own current decoder. If that decoder rejects the document, the parse returns an 'older than the first supported release' failure and tries nothing else. The frozen history modules, the legacy dispatch and every committed real document are gone. The tests prove parity, failures, `parseDocument`, `toLatest`, the types and the JSON Schemas on made-up documents only.

### Detailed instructions

- Never read `~/.phax`, a records branch or another repository during this phase, and never paste anything from them. Every test document is hand-written and made up, or built by encoding a constructed value (spec §5.11). Use obviously fictional values: run ids like `run-0001`, repo paths like `/work/example-repo`, short names like `example-run`. Use no user name, home directory or real repository name.
- Delete the whole `packages/schemas/src/history/` directory, i.e. all 16 frozen modules: `phase-record-manifest/v1.ts` and `v2.ts`, `authoring-record-manifest/v1.ts`, `compliance-review/v1.ts`, `gate-attribution/v0.ts`, `gate-diagnostics/v0.ts`, `gate-pending/v0.ts`, `phase-file-reconciliation/v0.ts`, `phase-status/v1.ts`, `phax-plan/v1.ts`, `plan-approvals/v1.ts`, `plan-document/v1.ts`, `registry/v1.ts`, `run-status/v1.ts`, `spec-approvals/v1.ts` and `spec-document/v1.ts`. Set `packages/schemas/history.lock.json` to the output of `renderLock({})` (`{}` then a newline). Keep the lock, `refreshLock`, and the lock half of `checkSchemas` in `scripts/schemas-check.ts` unchanged: plan 4 freezes the first module into them. Also keep the `packages/schemas/src/history` entry in `.oxfmtrc.json`, since frozen modules must never be reformatted.
- Rewrite `packages/schemas/src/shapes.ts`. Delete the `LegacyLiteral` type, the `legacy` field, `byShapeLiteral`, `byLiteral`, the `hasUnversionedShape` / `knownLiterals` bookkeeping, and the 'names its shape with a $schema URL or a version literal' failure. Every shape map `M` now has a `'pre-schema'` key. `FormatSpec<M>` becomes two explicit variants. (a) Pre-schema slot unfilled, used by every format in this plan: `current: { name: 'pre-schema', shape }` and `releases: []`, where phax's current decoder is the pre-schema decoder. (b) Pre-schema slot filled, used from plan 4: `preSchema: Shape<M['pre-schema']>` (a frozen module), `releases` as today, and `current: { name: 'next' | <release>, shape }`. Encode the variants however reads best, for example as a discriminated union on the presence of `preSchema`. They must be mutually exclusive at the type level.
- New `parse` resolution in `defineFormat`, documented in its JSDoc in this order. (1) A non-object fails at `""` (unchanged). (2) A document with `$schema` resolves by its URL, exactly as today: malformed URL, unknown format id, another format and newer-than-package fail at `$schema`; a `next` current shape decodes first at the package's own release; otherwise the latest release-named shape at or below the release decodes it; otherwise 'no <id> shape is known at release <X>'. (3) A document without `$schema`, whatever its `version`, is decoded only by the pre-schema decoder: the frozen `preSchema` module when the slot is filled, else `current.shape`. On success it returns `{ ok: true, shape: 'pre-schema', value }`. On rejection it returns a failure whose path is the decoder's first violation path (as `fromEither` computes it) and whose message is `preSchemaUnsupportedMessage(label, <the violation message>)`. It never tries another decoder.
- Export `preSchemaUnsupportedMessage(label: string, violation: string): string` from `shapes.ts`, next to `newerReleaseMessage`. It returns `${label} older than the first supported release — not supported (${violation})`. Plan 4 changes it to name the release. Keep `UNKNOWN`, `isUnknown`, `Unknown`, `unknownFormatMessage`, `newerReleaseMessage`, `malformedSchemaUrlMessage`, `notAnObjectMessage` and `isDocumentObject` unchanged.
- In each `packages/schemas/src/formats/<family>.ts`, remove every import from `../history/`, every `export type { …V0/V1/V2 }` re-export and the comments about frozen twins. Each format's shape map becomes `{ 'pre-schema': <phax's type> }`, for example `PhaseRecordManifestShapes = { 'pre-schema': PhaseRecordManifest }`. Its `*Shape` alias becomes `'pre-schema'`. Its `defineFormat` call uses variant (a) with phax's own schema and decoder, exactly as `current.shape` does today.
- Simplify every `toLatest*` to take the pre-schema value (phax's type). The eleven versioned formats return `Omit<X, 'version'>`, keeping every other field. The four timeline formats (gate attribution, phase file reconciliation, gate diagnostics, gate pending) return the value itself. Redefine each `Latest*` type to match, with no `| Unknown` members: `LatestRunStatus = Omit<RunStatus, 'version'>`, `LatestPhaxPlan = Omit<PhaxPlan, 'version'>`, `LatestPhaseRecordManifest = Omit<PhaseRecordManifest, 'version'>`, `LatestPhaseFileReconciliation = PhaseFileReconciliation`, and so on. Delete `LatestPhaxPlanPhase` and the private `toLatestPhaxPlanPhase`. Keep `parseRecordManifest` as it is: `$schema` routing, then `kind: 'authoring'`, then phase.
- In `packages/schemas/src/index.ts`, remove every exported `…V0` / `…V1` / `…V2` type and `LatestPhaxPlanPhase`. Update the comment above the timeline exports ('each read as the unversioned shape v0' becomes 'each read as its pre-schema shape'). Keep everything else: `Parsed`, `ParsedShape`, `ParsedDocument`, `UNKNOWN`, `isUnknown`, every schema, type, `parse*`, `toLatest*`, `*Shape` and `Latest*`, `DocumentFormatId`, `AnyDocument` and `parseDocument`.
- In `packages/schemas/src/document.ts`, reword `MISSING_SCHEMA_MESSAGE` to drop 'legacy' and 'version literal'. Suggested: 'missing $schema — a pre-schema document is identified by where it lives; read it with its format's parse function (for example, parsePhaseRecordManifest or parseGateAttribution)'. The rest of `makeDocumentParser` is unchanged. If `packages/schemas/src/parsed.ts` still describes shape ids as `v<N>`, update the comment to `pre-schema`, a release, or `next`.
- Create `tests/unit/schemasPackage/documents.ts`, the only source of test documents, replacing `surveyedFixtures.ts`. It exports `validDocuments: { readonly [F in FormatId]: Readonly<Record<string, unknown>> }`, one minimal document per format id. Build each one by encoding a value typed as phax's type through phax's schema (`Schema.encodeSync(<phax schema>)(value)`), so a schema change breaks the build instead of silently staling a fixture. The run status must use a valid `state`. The phase record manifest must use `version: 2`, a non-empty `verifiedSurfaces` and a usage entry. The phax-plan must have one phase with all three planned-file lists. Also export small helpers `withKey(doc, key, value)` and `withoutKey(doc, key)`, which return new objects, and one hand-written `versionOnePhaseRecordManifest`: `version: 1`, no `verifiedSurfaces`, otherwise like the valid one. It stands for a document older than the pre-schema shape.
- Create `tests/unit/schemasPackage/documents.test.ts`. (1) Every entry of `validDocuments` is accepted by phax's own decoder for its format. (2) `tests/unit/schemasPackage/` (walked recursively) contains no `.json` file and no `fixtures` directory. (3) No string anywhere in `validDocuments` or `versionOnePhaseRecordManifest` matches `/Users/`, `/home/` or `~/.phax`.
- Delete `tests/unit/schemasPackage/fixtures/` entirely (every `<format id>/v0.json` / `v1.json`, `phase-record-manifest/v1/*.json`, `phase-record-manifest/v2/*.json` and `record-timeline/*.json`) and `tests/unit/schemasPackage/surveyedFixtures.ts`.
- Rewrite `tests/unit/schemasPackage/shapes.test.ts` over toy formats, dropping every legacy-literal and v0 case. Cover variant (a): a no-`$schema` document is read by the current decoder as `pre-schema`, even with an arbitrary `version` key the toy schema admits; a rejected one fails at the violation path with a message beginning '<label> older than the first supported release — not supported'; a `$schema` document at a release no shape covers fails with 'no <id> shape is known at release <X>'. Cover variant (b), with a frozen `preSchema`, releases 0.10.0 and 0.12.0 and a `next` current shape: a no-`$schema` document is read only by the frozen module (prove with a counting decoder that `current` is never called for it); `$schema` release resolution, the next-first rule, newer-release, unknown-format, other-format and malformed-URL failures are kept from today's cases; nothing ever throws. Keep the unknown-marker tests.
- Rewrite `phaseRecordManifestHistory.test.ts` on `documents.ts`. `validDocuments['phase-record-manifest']` (version 2, no `$schema`) parses as `{ ok: true, shape: 'pre-schema', value }`. `versionOnePhaseRecordManifest` returns `ok: false` with a message starting 'phase record manifest older than the first supported release — not supported', without throwing. A copy with `$schema` naming release `<major+1>.0.0` returns the newer-release failure (keep the derivation from `PACKAGE_VERSION`). `toLatestPhaseRecordManifest` keeps every field except `version`, and never adds a `sourceSha` the document lacks.
- Rewrite `parse.test.ts`, `parseDocument.test.ts`, `parity.test.ts`, `jsonSchemas.test.ts`, `recordManifests.test.ts`, `recordTimeline.test.ts`, `repositoryFormats.test.ts` and `runDirectoryFormats.test.ts` on `documents.ts`. Remove every history-module import, every `surveyGroups` / `readSurveyedFixtures` / `keySignature` use and every `legacy: {}` in toy specs. Expect `shape: 'pre-schema'` wherever `'v0'` / `'v1'` / `'v2'` was expected. Delete the tests whose only subject was a frozen twin or the survey: twin-equals-phax JSON Schemas, signature coverage, the v1 fallback, and the upgrade of pre-namespace or pre-planned-files documents.
- Keep these behaviours tested. Parity: for every format, the package verdict equals phax's decoder verdict on the valid document and on hand-made rejects (a wrong type, a missing required key, one unknown key). A phase record manifest with one unknown key is rejected by both; a registry with one unknown key is accepted by both. `ac-failure`: `parseRunStatus(withKey(validDocuments['run-status'], 'state', 'paused'))` returns `ok: false` with `error.path === 'state'` and a non-empty message, without throwing. JSON Schemas: every `validDocuments` entry validates with ajv against its `json/` schema as rendered by `renderJsonSchemas`. `ac-record-files`: an in-memory record folder written by hand in pre-schema shapes has `record.json`, `gate-attribution.json`, `file-reconciliation.json`, `checks-attempt-01.diagnostics.json` and `checks-attempt-02.pending.json`; each parses `ok` with shape `pre-schema`, and the attempts come back ordered by file name. `parseDocument` and `parseRecordManifest` keep their `$schema`, missing-`$schema`, `kind: 'authoring'` and unknown-format cases.
- In `frozenHistory.test.ts`, change the 'pins every frozen module' expectation to an empty lock (`{}`) and delete the 'frozen v2 twin is faithful' describe block. Keep every lock and generated-index finding test: they already inject synthetic `historyFiles` / `lock` maps and need no real module.
- Update `tests/type/schemasPackage.ts`. Remove every `…V0/V1/V2` import and twin assertion. Assert each `*Shape` equals `'pre-schema'`, that each `parse*` success value is exactly phax's type, and that each `Latest*` equals `Omit<phax type, 'version'>` (or phax's type for the four timeline formats). Keep the package-type ⇄ phax-type assignability in both directions (`ac-types`), and the `ParsedShape` → `Parsed` and `parseDocument` narrowing assertions.
- In `tests/unit/artifactNamesGuard.test.ts`, delete the `VERBATIM_HISTORY_FIXTURES` constant, its comment and the `if (relPath.startsWith(VERBATIM_HISTORY_FIXTURES)) continue;` line. In `.oxfmtrc.json`, remove the `tests/unit/schemasPackage/fixtures` entry.
- Leave `tests/unit/architecturalGuards.test.ts` alone unless it fails. The history-import guard stays (plan 4 relies on it), and the closure allowlist should not change, because the history modules imported only `effect`. Touch `knip.json`, `exports.test.ts`, `manifest.test.ts`, `build/jsonSchemas.ts`, `build/generated.ts` or `scripts/schemas-check.ts` only if the gate requires it, for example stale comments naming `v0`/`v1` or an export knip flags.

### Planned files to create

- `tests/unit/schemasPackage/documents.ts`
- `tests/unit/schemasPackage/documents.test.ts`

### Planned files to edit

- `packages/schemas/src/shapes.ts`
- `packages/schemas/src/document.ts`
- `packages/schemas/src/index.ts`
- `packages/schemas/src/formats/recordManifests.ts`
- `packages/schemas/src/formats/recordTimeline.ts`
- `packages/schemas/src/formats/repository.ts`
- `packages/schemas/src/formats/runDirectory.ts`
- `packages/schemas/history.lock.json`
- `tests/unit/schemasPackage/shapes.test.ts`
- `tests/unit/schemasPackage/parse.test.ts`
- `tests/unit/schemasPackage/parseDocument.test.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/jsonSchemas.test.ts`
- `tests/unit/schemasPackage/recordManifests.test.ts`
- `tests/unit/schemasPackage/recordTimeline.test.ts`
- `tests/unit/schemasPackage/repositoryFormats.test.ts`
- `tests/unit/schemasPackage/runDirectoryFormats.test.ts`
- `tests/unit/schemasPackage/phaseRecordManifestHistory.test.ts`
- `tests/unit/schemasPackage/frozenHistory.test.ts`
- `tests/type/schemasPackage.ts`
- `tests/unit/artifactNamesGuard.test.ts`
- `.oxfmtrc.json`

### Optional files that may be edited

- `packages/schemas/src/parsed.ts`
- `packages/schemas/build/jsonSchemas.ts`
- `packages/schemas/build/generated.ts`
- `scripts/schemas-check.ts`
- `tests/unit/schemasPackage/exports.test.ts`
- `tests/unit/schemasPackage/manifest.test.ts`
- `tests/unit/architecturalGuards.test.ts`
- `knip.json`

### Boundary contracts

Consumer (package users, and plan 4's own-formats bridge) ← producer (`packages/schemas/src/index.ts`). For every format, `parse<Format>(input: unknown): ParsedShape<{ 'pre-schema': <phax type> }>`: it never throws, a success names shape `'pre-schema'`, and a failure is `{ ok: false, error: { path, message } }`. `toLatest<Format>(value: <phax type>): Latest<Format>`. `parseDocument` identifies only by `$schema` and is otherwise unchanged. Plan 4 ← `shapes.ts`: `FormatSpec`'s variant (b) (a frozen `preSchema` plus `releases` plus a `next` / release current shape) exists and is tested, so plan 4 only fills the slot and switches `current` to `next` for each format. `preSchemaUnsupportedMessage` is the single place plan 4 edits to name the first supported release.

### Test strategy

Package logic is unit-tested through vitest (`pnpm test`); the types through `tests/type/schemasPackage.ts` (`pnpm test:type`). Write the new `shapes.test.ts` cases for both `FormatSpec` variants and the pre-schema-unsupported failure before rewriting `defineFormat`: the resolution order is the contract plan 4 builds on. Build `documents.ts` and `documents.test.ts` next, then port each family test onto it. Parity, failures-as-values, JSON Schema validation and the record-folder timeline are asserted on hand-written or schema-encoded documents only; no test reads a file outside the repository.

### Implementation order

1. Write the new `shapes.test.ts` cases, then rewrite `defineFormat` / `FormatSpec` and add `preSchemaUnsupportedMessage`.
2. Port the four `formats/<family>.ts` files to shape maps with only `pre-schema` and the simplified `toLatest*`, then trim `index.ts` and reword `MISSING_SCHEMA_MESSAGE` in `document.ts`.
3. Delete `packages/schemas/src/history/` and empty `history.lock.json`.
4. Create `documents.ts` and `documents.test.ts`.
5. Port every schemasPackage test and `tests/type/schemasPackage.ts` onto `documents.ts`, then delete `fixtures/` and `surveyedFixtures.ts`.
6. Remove the fixture exclusions from `artifactNamesGuard.test.ts` and `.oxfmtrc.json`, then run the gate.

### Excluded scope

- phax writing `$schema`, dropping `version`, or reading its own files through the package (plan 4).
- Freezing any pre-schema shape into a module under `packages/schemas/src/history/` (plan 4).
- The JSON Schema snapshots and their gate (phase-03).
- Removing `scripts/survey-format-shapes.ts` and `docs/briefs/schemas-package-shapes.{md,json}` (phase-02).
- Any change to a phax schema under `src/schemas/`, to phax's decoders or to the CLI.
- Release tooling, the tarball smoke and the README persisted-formats table (plan 5).

### Verification

The `standard` gate profile in `phax.json`: pnpm format, typecheck, test:type, lint, format:check, test, knip, audit:architecture and gen:model-catalog --check.

### Expected handoff content

Record in `phase-handoff.md`:

- The final `FormatSpec` variant encoding and the exact `defineFormat` resolution order.
- The signature and wording of `preSchemaUnsupportedMessage`.
- The public exports removed from `packages/schemas/src/index.ts`.
- The `Latest*` / `toLatest*` definitions per format.
- The exports of `tests/unit/schemasPackage/documents.ts` (`validDocuments`, `withKey`, `withoutKey`, `versionOnePhaseRecordManifest`), which phase-03 and plan 4 reuse.
- Confirmation that `packages/schemas/history.lock.json` is `{}` and that `scripts/schemas-check.ts` still passes on the committed tree.

The reconciliation will flag the planned deletions as deviations: the 16 history modules, `tests/unit/schemasPackage/fixtures/**` and `surveyedFixtures.ts`. The planned-file sections have no deletion list, so name them as intended. Explain any other deviation, including any optional file touched and why.

### Commit subject

`refactor(schemas): read the pre-schema shape only, drop history and real fixtures`

### Commit body

Support starts at the first release that writes $schema (spec q-support-start). A document without $schema is now read by phax's current decoder as shape pre-schema. If that decoder rejects it, the parse fails as older than the first supported release, at the first violation's path, and nothing else is tried.

Remove the 16 frozen history modules and their history.lock.json entries (the lock and its check stay, empty until plan 4). Remove the legacy version-literal dispatch and the unversioned v0 resolution from defineFormat, and the V0/V1/V2 shape types from the entry. The Latest types lose the Unknown members that only the frozen twins needed.

Delete every committed real document: tests/unit/schemasPackage/fixtures/ and its loader surveyedFixtures.ts. Some of those files held a private repository's run and local home paths, so this is also a privacy fix. The tests now build their documents in tests/unit/schemasPackage/documents.ts, by encoding hand-written values through phax's own schemas. A guard test keeps JSON files out of the test directory. Drop the artifact-name guard's verbatim-history exclusion and the fixtures entry in .oxfmtrc.json.

---

## phase-02 — Drop the format-shape survey and its report {#phase-02-drop-survey}

**Recommended model:** claude-sonnet-5
**Recommended effort:** low

The repository no longer carries a tool that walks `~/.phax` or a records branch, nor the report it produced. The survey's only consumer, the fixture loader, went away in phase-01.

### Detailed instructions

- Delete `scripts/survey-format-shapes.ts`, `docs/briefs/schemas-package-shapes.md` and `docs/briefs/schemas-package-shapes.json`. Do not run the survey script first, and do not read `~/.phax`.
- Search the tree, excluding `docs/plans/archive/`, `docs/specs/archive/` and `docs/briefs/schemas-package-plan.md`, for `survey-format-shapes` and `schemas-package-shapes`. Archived plans and older briefs are history and stay untouched. Nothing live should reference either name after phase-01. If something does, stop and record it in the handoff instead of editing it, because this phase plans no edits.
- Do not touch `src/schemas/formatError.ts`, even if the survey was one of its importers: `src/schemas/*.ts` are knip entry points, and phax uses the module elsewhere.

### Planned files to create

- (none)

### Planned files to edit

- (none)

### Optional files that may be edited

- (none)

### Test strategy

No new tests. The phase removes an unreferenced script and two documents. The gate (typecheck, test, knip, lint) proves nothing depended on them.

### Implementation order

1. Search for live references to the two names.
2. Delete the three files.
3. Run the gate.

### Excluded scope

- Rewriting archived plans, archived specs or `docs/briefs/schemas-package-plan.md` that mention the survey.
- Any change under `packages/schemas/` or `tests/`.

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

Record in `phase-handoff.md`:

- The three files deleted, and the result of the reference search (expected: no live reference).

The reconciliation flags the three deletions as deviations, because the planned-file sections have no deletion list. Name them as intended. Explain any other deviation.

### Commit subject

`chore(schemas): drop the format-shape survey and its report`

### Commit body

The revised spec (q-support-start) drops the history corpus, and the tests no longer read the survey. Remove scripts/survey-format-shapes.ts, which walked ~/.phax and the records branch, and its committed report, docs/briefs/schemas-package-shapes.md and .json. Nothing in the repository reads from a phax home any more.

---

## phase-03 — Snapshot gate for every format's shape {#phase-03-snapshot-gate}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

Every persisted format has a committed JSON Schema snapshot of its current shape. Every gate fails when phax's decoder changes a format's shape without recording `<format id>/next.schema.json`, and the message names the format and the snapshot to record. The snapshot check, the frozen-module lock check and the generated-index check all run inside `pnpm test`.

### Detailed instructions

- In `packages/schemas/build/jsonSchemas.ts`, export the per-format table that is currently the private `DEFINITIONS`, as `FORMAT_DEFINITIONS: { readonly [F in FormatId]: { label; current: { name: string; shape: { schema } } } }`. The snapshot check reads each format's current shape name from it. Leave `JSON_SCHEMA_FORMATS` and `renderJsonSchemas` unchanged: a snapshot's content is exactly what `renderJsonSchemas` renders for that format id. The `record-manifest` union has no format id, so it gets no snapshot.
- Create `packages/schemas/build/snapshots.ts`, pure and with no fs; `node:util` for `isDeepStrictEqual` is fine, as `generated.ts` already uses `node:crypto`. Export `SNAPSHOTS_DIR = 'packages/schemas/snapshots'` and `snapshotPath(formatId, name)` (`${SNAPSHOTS_DIR}/<id>/<name>.schema.json`). Export `parseSnapshotName(fileName)`, which returns `'pre-schema' | 'next' | <X.Y.Z>` for `<name>.schema.json` (release names checked with `isRelease`) or `undefined` otherwise. Export `latestReleased(names)`: the highest release by `compareReleases` from `src/schemas/schemaUrl.ts`, else `'pre-schema'` when present, else `undefined`, with `pre-schema` ordered below every release.
- The input type in `snapshots.ts` is: `formats: ReadonlyArray<{ id: FormatId; currentShape: string; generated: { ok: true; content: string } | { ok: false; reason: string } }>` and `snapshots: ReadonlyMap<string /* directory name */, ReadonlyMap<string /* file name */, string /* content */>>`.
- `checkSnapshots(input): string[]` returns one `✗ …` line per finding and compares snapshots as parsed JSON (deep equality). Findings: (1) a render failure: `✗ <id>: <reason>`. (2) a directory that is not a format id: `✗ <SNAPSHOTS_DIR>/<dir>/ names no format`. (3) a file whose name `parseSnapshotName` rejects: `… is not a snapshot name (pre-schema, next or X.Y.Z, then .schema.json)`. (4) a file that is not JSON: `… is not valid JSON`. (5) a format with neither a released snapshot nor `next`: `✗ <id>: no snapshot — run <WRITE_COMMAND>`. (6) no `next`, and the generated schema differs from the latest released snapshot: `✗ <id>: the generated schema differs from the latest released snapshot <path> and from <next path> — record <next path> (run <WRITE_COMMAND>)`. (7) a `next` that differs from the generated schema: `✗ <next path> differs from the generated schema — run <WRITE_COMMAND>`. (8) a `next` equal to the latest released snapshot: `✗ <next path> equals the latest released snapshot <path> — delete it (run <WRITE_COMMAND>)`. `WRITE_COMMAND` comes from `build/generated.ts`.
- `planSnapshotWrites(input): { writes: ReadonlyMap<string /* repo-relative path */, string>; removals: ReadonlyArray<string> }` returns what `--write` does. A format with no snapshot at all gets `<currentShape>.schema.json` when its current shape is `pre-schema`, else `next.schema.json`. A format whose generated schema differs from its latest released snapshot gets `next.schema.json` written with the generated content, overwriting an older `next`. A format whose generated schema equals its latest released snapshot has any `next` removed. `pre-schema` and release-named files are never written once they exist, and never removed. Stray directories and files are only reported. Formats with a render failure are skipped.
- Extend `scripts/schemas-check.ts`. `SchemasState` gains `snapshots` (read from every file under `packages/schemas/snapshots/`, keyed as above; an empty map when the directory is absent) and `formats`. Build `formats` per id of `FORMAT_IDS` from `renderJsonSchemas(JSON_SCHEMA_FORMATS)`: the content of `<id>.schema.json`, or the failure `renderJsonSchemas` reported for that format. Take `currentShape` from `FORMAT_DEFINITIONS[id].current.name`. `checkSchemas` appends `checkSnapshots` findings after today's findings. `writeSchemas` also returns `snapshotWrites` and `snapshotRemovals`, and the `--write` main applies them (`mkdirSync` recursive, `writeFileSync`, `rmSync`) and prints each path. Update the header comment to name the snapshots.
- Add `packages/schemas/snapshots` to `ignorePatterns` in `.oxfmtrc.json`. The gate's `pnpm format` step would otherwise rewrite the snapshots and collapse short arrays.
- Run `pnpm exec tsx scripts/schemas-check.ts --write` to write the 15 `packages/schemas/snapshots/<format id>/pre-schema.schema.json` files: registry, run-status, phase-status, phax-plan, compliance-review, plan-approvals, spec-approvals, phase-record-manifest, authoring-record-manifest, gate-attribution, phase-file-reconciliation, gate-diagnostics, gate-pending, spec-document and plan-document. Do not hand-write or edit them. Running the check without `--write` must then report nothing. No `next.schema.json` may exist at the end of this phase, since phax's shapes do not change here.
- In `tests/unit/schemasPackage/frozenHistory.test.ts`, extend the committed-tree 'passes' and '--write would change nothing' tests. `snapshotWrites` must be empty, `snapshotRemovals` must be empty, and `checkSchemas(state)` must still be `[]`. That test runs in `pnpm test` on every gate, which is how the three checks run on the gate.
- Create `tests/unit/schemasPackage/snapshots.test.ts`. (a) On the committed tree, each of the 15 format directories holds exactly `pre-schema.schema.json`, no `next` exists anywhere, and each file's content equals the renderer's output byte for byte, so `--write` is idempotent. (b) On synthetic states built with `renderJsonSchemas` over toy `Schema.Struct`s under the id `phase-record-manifest`, cover `ac-snapshot-gate`: a generated schema with one added key and no `next` gives exactly one finding naming `phase-record-manifest` and `packages/schemas/snapshots/phase-record-manifest/next.schema.json`. `planSnapshotWrites` writes that `next` and leaves `pre-schema` untouched, and after applying the plan to the state the check passes. (c) Also cover: a `next` equal to the latest released snapshot is reported and removed; a stale `next` is reported and rewritten; `0.10.0` sorts above `0.9.0` and every release above `pre-schema`; bootstrap naming for `currentShape` `pre-schema` versus `next`; a differing released snapshot is never in `writes`; stray directory, bad file name, invalid JSON and render-failure findings. Build every schema and document in the test; read nothing outside the repository.

### Planned files to create

- `packages/schemas/build/snapshots.ts`
- `tests/unit/schemasPackage/snapshots.test.ts`
- `packages/schemas/snapshots/registry/pre-schema.schema.json`
- `packages/schemas/snapshots/run-status/pre-schema.schema.json`
- `packages/schemas/snapshots/phase-status/pre-schema.schema.json`
- `packages/schemas/snapshots/phax-plan/pre-schema.schema.json`
- `packages/schemas/snapshots/compliance-review/pre-schema.schema.json`
- `packages/schemas/snapshots/plan-approvals/pre-schema.schema.json`
- `packages/schemas/snapshots/spec-approvals/pre-schema.schema.json`
- `packages/schemas/snapshots/phase-record-manifest/pre-schema.schema.json`
- `packages/schemas/snapshots/authoring-record-manifest/pre-schema.schema.json`
- `packages/schemas/snapshots/gate-attribution/pre-schema.schema.json`
- `packages/schemas/snapshots/phase-file-reconciliation/pre-schema.schema.json`
- `packages/schemas/snapshots/gate-diagnostics/pre-schema.schema.json`
- `packages/schemas/snapshots/gate-pending/pre-schema.schema.json`
- `packages/schemas/snapshots/spec-document/pre-schema.schema.json`
- `packages/schemas/snapshots/plan-document/pre-schema.schema.json`

### Planned files to edit

- `scripts/schemas-check.ts`
- `packages/schemas/build/jsonSchemas.ts`
- `tests/unit/schemasPackage/frozenHistory.test.ts`
- `.oxfmtrc.json`

### Optional files that may be edited

- `packages/schemas/build/generated.ts`
- `tests/unit/schemasPackage/jsonSchemas.test.ts`
- `knip.json`

### Boundary contracts

Producer: `packages/schemas/build/snapshots.ts` and `scripts/schemas-check.ts`. Consumers: the gate (through `pnpm test`), plan 4 and plan 5. Plan 4 changes each format's shape by dropping `version` and adding `$schema`, and records it with `pnpm exec tsx scripts/schemas-check.ts --write`, which writes `<format id>/next.schema.json`. Plan 5's `release.sh` renames every `<format id>/next.schema.json` to `<format id>/<X.Y.Z>.schema.json`, so the naming `pre-schema | next | X.Y.Z` plus `.schema.json` under `packages/schemas/snapshots/<format id>/` is the stable contract between them. A snapshot's content is `renderJsonSchemas`' output for that format id.

### Test strategy

Write `snapshots.test.ts`'s synthetic cases before `snapshots.ts`: the rules (latest released, the `next` lifecycle, never overwriting a released snapshot) are the contract plan 4 and plan 5 rely on. Unit tests over injected state cover the pure rules. The committed-tree tests in `frozenHistory.test.ts` and `snapshots.test.ts` are the gate check itself. No test reads a document from outside the repository.

### Implementation order

1. Write the synthetic cases in `snapshots.test.ts`.
2. Implement `packages/schemas/build/snapshots.ts`.
3. Export `FORMAT_DEFINITIONS` from `build/jsonSchemas.ts`.
4. Extend `SchemasState`, `readSchemasState`, `checkSchemas`, `writeSchemas` and the `--write` main in `scripts/schemas-check.ts`.
5. Add the oxfmt ignore, run `pnpm exec tsx scripts/schemas-check.ts --write`, and check that it wrote exactly the 15 `pre-schema` snapshots.
6. Extend the committed-tree tests in `frozenHistory.test.ts` and `snapshots.test.ts`, then run the gate.

### Excluded scope

- Any `next.schema.json` snapshot, or any change to a phax schema under `src/schemas/`.
- `release.sh` renaming `next` snapshots, and any release workflow change (plan 5).
- A `pnpm schemas:check` package script or a gate-profile change in `phax.json`.
- Publishing the snapshots in the package tarball (`files` stays `dist` and `json`).
- Freezing pre-schema modules under `packages/schemas/src/history/` (plan 4).

### Verification

The `standard` gate profile in `phax.json`; this is the terminal phase, so it also runs `pnpm build`, `pnpm deno:smoke` and `pnpm deno:smoke-binary`.

### Expected handoff content

Record in `phase-handoff.md`:

- The exports and signatures of `packages/schemas/build/snapshots.ts`.
- The new `SchemasState` / `writeSchemas` fields.
- The exact finding messages, especially the §5.17 one, which plan 4 will see when it records its first `next` snapshots.
- The list of the 15 snapshot files written by `--write`.
- Confirmation that no `next.schema.json` exists and that `checkSchemas` on the committed tree is empty.
- The command plan 4 runs to record a shape change: `pnpm exec tsx scripts/schemas-check.ts --write`.

Explain any deviation from the planned file lists, including any optional file touched.

### Commit subject

`feat(schemas): gate every format's shape on a committed JSON Schema snapshot`

### Commit body

Commit one JSON Schema snapshot per format for its current shape, packages/schemas/snapshots/<format id>/pre-schema.schema.json, generated from phax's own decoder.

scripts/schemas-check.ts now also fails when a format's generated schema differs from its latest released snapshot and from <format id>/next.schema.json, naming the format and the next snapshot to record (spec §5.17). It also reports a stale or redundant next snapshot and any stray file. --write bootstraps missing snapshots, writes or removes next, and never touches a released snapshot. The rules are pure, in packages/schemas/build/snapshots.ts.

The unit test that already runs checkSchemas on the committed tree now covers snapshots too, so the snapshot, frozen-module lock and generated-index checks run on every gate inside pnpm test. No next snapshot exists, because phax's shapes do not change here; the next mechanism is tested on synthetic cases.
