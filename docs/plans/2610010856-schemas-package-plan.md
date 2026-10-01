---
status: Draft
source-spec: docs/specs/2609241238-schemas-package.md
---
# schemas-package 4/5 — phax writes $schema

This is the fourth of the five plans that ship the `schemas-package` spec. Plans 1 to 3 (PR #104, #105, #108) built `@lbdremy/phax-schemas` under `packages/schemas/`. The package has every format of spec §5 `formats`, `parseDocument`, a `toLatest` for each format, one JSON Schema per format, one committed `snapshots/<format id>/pre-schema.schema.json` per format, and the snapshot gate in `scripts/schemas-check.ts`, which runs through `pnpm test`. phax itself still writes `version` literals and no `$schema`. Every pre-schema slot in `packages/schemas/src/shapes.ts` is still unfilled, and `history.lock.json` is `{}`.

This plan makes phax write `$schema: https://docs.phax.run/schemas/<format id>/<release>.json` as the first key of every persisted format, with no `version` key. phax also reads its own older files through one bridge (q-own-legacy). The dependency runs one way (spec §9 q-historical-location, revised 2026-10-01). The frozen decoders live in phax under `src/schemas/history/`, and the package re-exports them. No file under `src/` imports `packages/`, and only the bridge, `src/schemas/persisted.ts`, imports `src/schemas/history/`. phax's TypeScript root, `tsconfig.build.json`, its `dist/` layout and its `bin` do not change.

The phases run in this order:

- phase-01 freezes each format's pre-schema shape, before any shape changes. It adds one self-contained module per format under `src/schemas/history/`, pinned by `packages/schemas/history.lock.json`. The package fills every pre-schema slot with these modules.
- phase-02 adds the bridge and moves every phax read site of a persisted file onto it. No document carries `$schema` yet, so from this phase on every existing file is read through its frozen pre-schema decoder.
- phase-03 adds the release constant that both `phax --version` and `$schema` use, then changes the first family: the run registry.
- phase-04 to phase-08 change one family each: run and phase status; phax-plan and compliance review; the approvals ledgers and authoring sidecars; the record manifests; the record's timeline files. In each of these phases:
  - the persisted-file schema gains `$schema` and loses `version`;
  - the writers stamp `$schema`;
  - the bridge's step from the pre-schema shape drops `version`;
  - `scripts/schemas-check.ts --write` records the change as `<format id>/next.schema.json`. The `pre-schema` snapshots never change.
- phase-09 checks every writer from end to end.

An existing `~/.phax/registry.json`, a run's status files, the repository's approvals ledgers and the sidecars that 0.16.0 wrote all keep working. phax rewrites them with `$schema` the next time it writes them.

Contracts that face an agent or a tool do not change. They are:

- the spec and plan document schemas an authoring session emits (`phax artifact schema spec|plan`, the authoring prompt);
- the extracted-plan schema and the extraction cache;
- the compliance verdict in the review prompt;
- the diagnostics document a gate step prints on stdout.

phax adds `$schema` and drops `version` only when it writes the persisted file.

Privacy: nothing from `~/.phax`, a records branch or another repository enters this repository, and no phase reads `~/.phax`. Every test document is made up, or built by encoding a made-up value through a schema (spec requirement `synthetic-fixtures`). Closed PRs #106 and #107 are not revived. Other Approved specs (artifact-decide, headless-review, oracle-phases) will change some of these formats later; this plan implements none of their changes.

Spec coverage:

- Requirements delivered:
  - `schema-url` (§5.15);
  - `history-frozen` (§5.16): the frozen modules in phax, the package re-exporting them, and phax reading its own older files through one bridge;
  - `history-read` (§5.9): every pre-schema slot is filled; until plan 5's release names it, a document phax writes resolves to shape `next`;
  - `pre-schema-unsupported` (§5.10): the package names the first supported release once a released snapshot exists;
  - `identify-alone` (§5.12), on the documents phax writes.
- Acceptance criteria covered:
  - `ac-producer`;
  - `ac-own-legacy`;
  - `ac-history-read` (the released-shape case reads as `next` until plan 5);
  - `ac-to-latest`;
  - `ac-identify-alone` (shape `next` instead of `0.17.0` until plan 5);
  - `ac-history-frozen` (the dependency runs one way).
- Kept satisfied: `parity`, `failure`, `to-latest`, `types`, `json-schema`, `json-build-fail`, `snapshot-gate`, `history-newer`, `synthetic-fixtures`, `package`, `dependencies`, `pure`, `formats`, `record-files` and `excluded`.
- Left to plan 5: `release-names-shapes` (`release.sh` renames the `next` snapshots and the `next` current shapes, then runs `schemas-check --write`), `lockstep`, `release`, `release-gate`, `bump`, the tarball smoke, the README persisted-formats table and the §11 docs page.
- `code-review` arrives with the headless-review spec.

## Required commands

- `pnpm exec tsx`

`pnpm exec tsx` is already in `security.agentCommands` in `phax.json`. The phases use it to run `scripts/schemas-check.ts --write`. That command pins the frozen modules in `packages/schemas/history.lock.json`, regenerates `packages/schemas/src/generated/index.ts` and, from phase-03 on, `src/schemas/release.ts`, and writes the `next` snapshots. No other command is introduced, and no security configuration change is needed.

## Technical arbitrations

- The release phax writes comes from a generated constant. `src/schemas/release.ts` exports `PHAX_RELEASE`, which `scripts/schemas-check.ts --write` writes from the root `package.json`, and the gate fails when the file is stale. `readPackageVersion()` now returns that constant, so `phax --version` and every `$schema` share one source. Loss accepted: `phax --version` stops reading `package.json` at runtime, and phax gains one generated file. The alternative was an Effect service filled from `readPackageVersion()`, and it gives up a contained change: phax has no single composition root (about 25 command files provide their own layers), so every writer's requirements and every test layer would have to provide it.
- The first supported release has no committed constant. The package derives it as the lowest release-named snapshot across `packages/schemas/snapshots/*/`, or null when there is none, and writes it into its generated index as `FIRST_SUPPORTED_RELEASE`. Its unsupported message then says 'older than phax <X>, the first supported release'. While the value is null, it says 'older than the first release that writes $schema'. The value becomes 0.17.0 by itself when plan 5's release commit renames the first `next` snapshots. phax's bridge cannot import the package, so its own message never names a number: it says 'older than the first release that writes $schema, or damaged'. Loss accepted: until plan 5 the package's message carries no release number, and phax's message never does. A committed '0.17.0' would add a version source, and it would be wrong if the next cut is not 0.17.0.
- `$schema` lives only at the file boundary. Each persisted format has a file schema: `$schema` first, then the format's fields, and no `version`. The package exports that file schema and its type as the format's schema and type, as §5.19 requires. phax's in-memory type drops `version` and never carries `$schema`: writers stamp it with `withSchemaUrl`, and the bridge strips it on read. The package's `Latest*` type is exactly phax's in-memory type. Loss accepted: each format has two types (the in-memory value and the file), and every test literal that sets `version` must be edited. Putting `$schema` into the in-memory type would make every constructor, across app, infra and tests, invent a URL for a file it has not written.
- The `$schema` field accepts any X.Y.Z release of the format's own id, as a pattern, not as a literal of the running release. Loss accepted: phax's own decoder does not reject a file that names a newer release; the package's parse functions do that for third-party readers. A release literal would force a new snapshot at every release, and it would reject files the previous release wrote in the same shape.
- Contracts that face an agent or a tool keep their schemas: the spec and plan documents with `version: 1`, the extracted plan and its cache, the compliance verdict, and the gate diagnostics on stdout. Each of those formats gets a separate file schema built from the same fields. Loss accepted: two schemas per such format, kept in step only because they share their fields.
- The bridge is `src/schemas/persisted.ts`. It is pure: callers read the bytes and parse the JSON, and pass the file path only so it appears in messages. Its location lets the domain read site (`src/domain/artifact/sidecar.ts`) and the app, infra and cli read sites all import it. A document with `$schema` is read only by phax's current file decoder. A document without `$schema` is read only by the frozen pre-schema decoder, followed by a step to the current shape that refuses, naming the file and the fact, when a fact phax needs is missing. This mirrors the package's `defineFormat`. Loss accepted: `src/schemas/` gains a module that declares no schema. A document whose `$schema` is malformed or names another format is not rescued by the pre-schema decoder.
- Every read site moves to the bridge in one phase (phase-02), before any write changes, as the brief orders. Until a family changes its shape, its file decoder is today's decoder under a `File` name. Because no existing document carries `$schema`, the frozen fallback runs on every read from phase-02 on, and from then the family phases change only schemas, writers and the bridge's step. Loss accepted: phase-02 is a large mechanical phase of about 23 read-site files, and some file schemas are plain aliases until their family phase.
- Each frozen pre-schema module is a self-contained copy that imports only `effect`, including the sub-schemas it reaches (branch name, surface, provider id, token usage, completion diagnostic, extracted phase fields). Its rendered JSON Schema must equal the committed pre-schema snapshot, and that equality proves the copy is exact. The package re-exports each module's schema and type, but not its Either decoder: the parse functions already expose decoding. Loss accepted: duplicated schema code that intentionally does not follow later edits to phax's shared modules.

---

## phase-01 — Freeze every format's pre-schema shape in phax {#phase-01-freeze-pre-schema}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

Each format's pre-schema shape, exactly what 0.16.0 writes, is frozen in phax as a self-contained module under `src/schemas/history/<format id>/pre-schema.ts`. `packages/schemas/history.lock.json` pins each module, and the package re-exports it. Every package parse function reads a document without `$schema` through that module, and phax's own decoder becomes each format's current shape, `next`, still unchanged. This lands before any shape changes, so the frozen modules capture what 0.16.0 wrote.

### Detailed instructions

- Read these first: `packages/schemas/src/shapes.ts` (the two `FormatSpec` variants and the `defineFormat` resolution order in its JSDoc), `packages/schemas/src/formats/*.ts`, `packages/schemas/build/{generated,snapshots,jsonSchemas}.ts`, `scripts/schemas-check.ts`, `packages/schemas/snapshots/*/pre-schema.schema.json`, `tests/unit/schemasPackage/*`, `tests/type/schemasPackage.ts`, and the schemas-package sections of `tests/unit/architecturalGuards.test.ts`. Do not change any existing module under `src/` in this phase; you only add the frozen modules there.
- Never read `~/.phax`, a records branch or another repository, and never paste anything from them. Every test document is made up (run ids like `run-0001`, paths like `/work/example-repo`) or built by encoding a made-up value.
- Create one module per format id at `src/schemas/history/<format id>/pre-schema.ts`, for all 15 ids in `FORMAT_IDS`. Each is a verbatim, self-contained copy of the schema phax's decoder uses today, taken from the `src/schemas/*.ts` module that the matching `packages/schemas/src/formats/*.ts` imports. Copy every sub-schema it reaches:
    - the branded branch name from `src/domain/branded.ts`, with the same brand;
    - `SurfaceSchema`, `ProviderIdSchema`, and `RecordShapeSchema`/`TokenUsageSchema` from `runRecord.ts`;
    - `CompletionDiagnosticSchema`;
    - the extracted phase and run fields the plan document spreads;
    - the spec document's refinement with its `jsonSchema` annotation.

    Keep the same field order and the same annotations (identifier, title, description, jsonSchema), so the JSON Schema each module renders is identical to today's.
- Each frozen module imports only `effect`: never another `src/` module, never `packages/`, and never another history module. Its decoder uses the excess-property option phax's decoder uses today: `onExcessProperty: 'error'` for the strict formats, and effect's default for registry, run-status, phase-status and the four timeline formats. Mirror `EXCESS` in `packages/schemas/build/jsonSchemas.ts`.
- Each frozen module exports exactly three things: its schema, its type and an Either-returning decoder. Name them after the format, for example `RegistryPreSchemaSchema`, `RegistryPreSchema` and `decodeRegistryPreSchema`. Each module opens with a comment saying four things:
    - it is the frozen pre-schema shape of `<format id>`, exactly what phax wrote before it wrote `$schema`;
    - it must never be edited, because `packages/schemas/history.lock.json` pins it;
    - in phax, only `src/schemas/persisted.ts` may import it;
    - the schemas package re-exports it.
- Use no union of older shapes. The phase record manifest module is today's `version: 2` shape only, and the authoring manifest module is today's shape only, with `sourceSha` optional as it is today.
- In `.oxfmtrc.json`, replace the ignore entry `packages/schemas/src/history` with `src/schemas/history`, so oxfmt never rewrites a pinned module. Write the modules already formatted in the repository's style.
- Move the lock's subject to phax's tree:
    - In `scripts/schemas-check.ts`, `readSchemasState` reads the history modules from the repository's `src/schemas/history/`, not `packages/schemas/src/history/`.
    - Lock keys become repo-relative paths, for example `src/schemas/history/registry/pre-schema.ts`. The lock file stays at `packages/schemas/history.lock.json`.
    - Findings name the module path as it is, and name `packages/schemas/history.lock.json`.
    - Update the script's header comment.

    Once the modules are final, run `pnpm exec tsx scripts/schemas-check.ts --write` to pin 15 entries. If you must change a module after that (before the commit only), delete its lock entry and re-run `--write`.
- Fill every format's slot with variant (b) of `FormatSpec`:
    - `preSchema: { schema, decode }` from the frozen module;
    - `releases: []`;
    - `current: { name: 'next', shape: <phax's own schema and decoder, unchanged> }`.

    Each shape map becomes `{ 'pre-schema': <frozen type>; next: <phax's type> }`, and each `*Shape` alias becomes `'pre-schema' | 'next'`. Each `toLatest*` accepts a value of either shape and returns the same `Latest*` as today: `Omit<X, 'version'>`, or the identity for the four timeline formats. Update the header comments of the four `formats/*.ts` files. No current schema changes, so every generated JSON Schema still equals its pre-schema snapshot, and `--write` must write no `next.schema.json`.
- From `packages/schemas/src/index.ts`, re-export the schema and the type of every frozen module under their own names, for example `RegistryPreSchemaSchema` and `RegistryPreSchema`. Do not re-export the Either decoders. Update `tests/unit/schemasPackage/exports.test.ts`.
- In `defineFormat`, a `$schema` document can name the package's own release while `next` fails to decode it. In that case, look for a release-named shape at or below that release. If there is none, return `next`'s own failure (its path and message) instead of 'no <id> shape is known at release <X>'. Update the JSDoc resolution list to match.
- A document whose `$schema` names the package's own release (0.16.0) now decodes as `next`, where it used to fail. Update the tests that expected the failure at 0.16.0 (`parseDocument.test.ts`, `recordManifests.test.ts`, `runDirectoryFormats.test.ts`, `repositoryFormats.test.ts`, `recordTimeline.test.ts`):
    - derive the own release from `PACKAGE_VERSION`, so a version bump never breaks them;
    - keep the 'no <id> shape is known at release <X>' case on a lower release such as 0.1.0.
- First supported release:
    - In `packages/schemas/build/snapshots.ts`, next to `latestReleased`, add a pure function that returns the lowest release-named snapshot (X.Y.Z) across every format directory, or null. `pre-schema` and `next` are not releases.
    - `renderGeneratedIndex` takes `{ packageVersion, firstSupportedRelease }` and also emits `export const FIRST_SUPPORTED_RELEASE: string | null = <value>;`.
    - `readSchemasState` computes the value from the snapshots it already reads.
    - `checkSchemas` reports a stale generated index when either value differs, naming the `--write` command.

    The value is null today.
- In `shapes.ts`, `preSchemaUnsupportedMessage(label, violation, firstSupportedRelease)` returns:
    - `<label> older than phax <X>, the first supported release — not supported (<violation>)` when the release is known;
    - `<label> older than the first release that writes $schema — not supported (<violation>)` when it is null.

    `defineFormat` takes `firstSupportedRelease` in its options and defaults it to `FIRST_SUPPORTED_RELEASE`, the same way `packageVersion` defaults, so tests can inject both.
- In `tests/unit/schemasPackage/documents.ts`, add `preSchemaDocuments: { readonly [F in FormatId]: Doc }`. Build each entry by encoding a made-up value, typed as the frozen type, through the frozen module's schema, not phax's. These documents then survive phax's shape changes in later phases. Keep `validDocuments` built from phax's schemas. Extend `documents.test.ts` so its no-real-data checks cover `preSchemaDocuments`, and so every entry is accepted by its frozen decoder.
- Create `tests/unit/schemasPackage/preSchemaModules.test.ts`. For every format id, check that:
    1. the frozen schema, rendered by `renderJsonSchemas` with the format's title (`phax <label>`) and excess, equals `packages/schemas/snapshots/<id>/pre-schema.schema.json` as parsed JSON;
    2. the format's `parse*` reads `preSchemaDocuments[id]` as `{ ok: true, shape: 'pre-schema' }`;
    3. the frozen decoder rejects hand-made bad documents: a wrong type, a missing required key, and, for the strict formats, one unknown key.
- In `frozenHistory.test.ts`:
    - Replace 'pins no frozen module yet' with a test that the lock has exactly the 15 entries `src/schemas/history/<id>/pre-schema.ts`, one per `FORMAT_IDS` entry.
    - Update the finding paths in the lock tests to repo-relative `src/schemas/history/...` paths.
    - Add a finding test for a stale `FIRST_SUPPORTED_RELEASE`.

    `checkSchemas` on the committed tree must still return `[]`, and `--write` must still change nothing.
- In `shapes.test.ts` and `phaseRecordManifestHistory.test.ts`, the unsupported message now starts with '… older than the first release that writes $schema — not supported'. In `shapes.test.ts`, add two toy cases:
    - with `firstSupportedRelease: '0.17.0'` injected, the message is '… older than phax 0.17.0, the first supported release — not supported';
    - a `$schema` document at the toy's own release that `next` rejects fails at the violation's path.
- In `tests/type/schemasPackage.ts`:
    - every `*Shape` equals `'pre-schema' | 'next'`;
    - each `parse*` success value is the frozen type or phax's type;
    - each `toLatest*` accepts both;
    - the package's types still equal phax's types for the exported schemas;
    - the re-exported frozen types are exported.

    Keep the `FormatSpec` variant assertions.
- In `tests/unit/architecturalGuards.test.ts`:
    - Replace the 'phax imports no historical decoder' guard (which points at `packages/schemas/src/history/`) with a guard that no `src/` module other than `src/schemas/persisted.ts` has a module specifier that resolves under `src/schemas/history/`. Keep a scanner self-test using a `src/schemas/history/...` path.
    - Add a guard that no file under `src/` has a module specifier that resolves under `packages/`, with a self-test.
    - Add a guard that every module under `src/schemas/history/` imports only `effect` or `effect/*`.
    - In the package-closure guard, add the 15 frozen modules to `CLOSURE_SRC_ALLOWLIST` (they are published now), and add `src/schemas/persisted.ts` to `CLOSURE_FORBIDDEN_FILES`.

### Planned files to create

- `src/schemas/history/registry/pre-schema.ts`
- `src/schemas/history/run-status/pre-schema.ts`
- `src/schemas/history/phase-status/pre-schema.ts`
- `src/schemas/history/phax-plan/pre-schema.ts`
- `src/schemas/history/compliance-review/pre-schema.ts`
- `src/schemas/history/plan-approvals/pre-schema.ts`
- `src/schemas/history/spec-approvals/pre-schema.ts`
- `src/schemas/history/phase-record-manifest/pre-schema.ts`
- `src/schemas/history/authoring-record-manifest/pre-schema.ts`
- `src/schemas/history/gate-attribution/pre-schema.ts`
- `src/schemas/history/phase-file-reconciliation/pre-schema.ts`
- `src/schemas/history/gate-diagnostics/pre-schema.ts`
- `src/schemas/history/gate-pending/pre-schema.ts`
- `src/schemas/history/spec-document/pre-schema.ts`
- `src/schemas/history/plan-document/pre-schema.ts`
- `tests/unit/schemasPackage/preSchemaModules.test.ts`

### Planned files to edit

- `.oxfmtrc.json`
- `packages/schemas/history.lock.json`
- `packages/schemas/src/shapes.ts`
- `packages/schemas/src/generated/index.ts`
- `packages/schemas/build/generated.ts`
- `packages/schemas/build/snapshots.ts`
- `scripts/schemas-check.ts`
- `packages/schemas/src/formats/runDirectory.ts`
- `packages/schemas/src/formats/repository.ts`
- `packages/schemas/src/formats/recordManifests.ts`
- `packages/schemas/src/formats/recordTimeline.ts`
- `packages/schemas/src/index.ts`
- `tests/unit/architecturalGuards.test.ts`
- `tests/unit/schemasPackage/documents.ts`
- `tests/unit/schemasPackage/documents.test.ts`
- `tests/unit/schemasPackage/frozenHistory.test.ts`
- `tests/unit/schemasPackage/shapes.test.ts`
- `tests/unit/schemasPackage/phaseRecordManifestHistory.test.ts`
- `tests/unit/schemasPackage/parseDocument.test.ts`
- `tests/unit/schemasPackage/recordManifests.test.ts`
- `tests/unit/schemasPackage/runDirectoryFormats.test.ts`
- `tests/unit/schemasPackage/repositoryFormats.test.ts`
- `tests/unit/schemasPackage/recordTimeline.test.ts`
- `tests/unit/schemasPackage/exports.test.ts`
- `tests/type/schemasPackage.ts`

### Optional files that may be edited

- `packages/schemas/src/document.ts`
- `packages/schemas/src/parsed.ts`
- `packages/schemas/tsconfig.build.json`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/parse.test.ts`
- `tests/unit/schemasPackage/snapshots.test.ts`
- `tests/unit/schemasPackage/jsonSchemas.test.ts`
- `tests/unit/schemasPackage/manifest.test.ts`
- `knip.json`

### Boundary contracts

Producer: `src/schemas/history/<format id>/pre-schema.ts`, one module per format. Each exports a schema, a type and an Either decoder for the exact shape phax wrote before `$schema`, and never changes after this phase (`packages/schemas/history.lock.json`). Consumers: the package's `formats/*.ts` (the `preSchema` slot), the package entry (re-exports), and from phase-02 on the bridge `src/schemas/persisted.ts`, which is the only `src/` importer. Producer: the package's generated `FIRST_SUPPORTED_RELEASE` (a string or null). Its consumer is `defineFormat`'s unsupported message.

### Test strategy

Write `preSchemaModules.test.ts` before the modules, so the snapshot-equality assertion drives exact copies. Update the `frozenHistory.test.ts` lock expectation before running `--write`. Everything else is a unit test over the package, using toy formats in `shapes.test.ts` and made-up documents. Type-level assertions live in `tests/type/schemasPackage.ts`. The new import guards are architectural tests with detector self-tests.

### Implementation order

1. Write `preSchemaModules.test.ts`, then the 15 frozen modules, until their rendered JSON Schemas equal the snapshots.
2. Move the lock to `src/schemas/history/` in `scripts/schemas-check.ts`, and update `.oxfmtrc.json`.
3. Add the first-supported-release derivation, `renderGeneratedIndex` and the `checkSchemas` finding, with their tests.
4. Update the unsupported message and `defineFormat` (its options and `next`'s own failure), with the `shapes.test.ts` cases.
5. Fill the slots in the four `formats/*.ts` files, widen `toLatest*`, and re-export the frozen schemas and types.
6. Add `preSchemaDocuments`, then update the package unit tests and the type test.
7. Add the architectural guards.
8. Run `pnpm exec tsx scripts/schemas-check.ts --write` last. Check that it pinned 15 lock entries and wrote no `next` snapshot.

### Excluded scope

- Any change to an existing `src/` module: phax still writes `version` and no `$schema`.
- Any change to a format's current schema, and any `next.schema.json`.
- The bridge, the file decoders and the read sites (phase-02).
- The release constant and the `$schema` field schema (phase-03).
- Renaming `next` to a release (plan 5).

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

Include:
- the exported names of each frozen module;
- one format's final `FormatSpec` as an example (`preSchema`, `releases: []`, `current: { name: 'next', … }`);
- the new `preSchemaUnsupportedMessage` signature and the `defineFormat` options;
- the name and location of the first-supported-release function and the generated `FIRST_SUPPORTED_RELEASE`;
- the `preSchemaDocuments` export;
- the names of the new guards in `tests/unit/architecturalGuards.test.ts`;
- any deviation from the planned file lists, with the reason.

### Commit subject

`feat(schemas): freeze every format's pre-schema shape in phax`

### Commit body

Add one frozen module per persisted format under
src/schemas/history/<format id>/pre-schema.ts. Each is a self-contained
copy of the decoder phax uses today and imports only effect. Each
module's rendered JSON Schema equals its committed pre-schema snapshot,
and packages/schemas/history.lock.json pins all fifteen by their
repo-relative paths.

The package fills every format's pre-schema slot with these modules and
re-exports their schemas and types. A document without $schema is read
only by its frozen module; phax's own decoder becomes the current shape,
named next. No shape changes, so no next snapshot is written.

The package's generated index now carries FIRST_SUPPORTED_RELEASE, the
lowest release-named snapshot (null today). The unsupported message
names that release once it exists. When next fails on a document at the
package's own release, parse returns next's own violation.

New guards: no src/ file imports packages/, only
src/schemas/persisted.ts may import src/schemas/history/, and every
frozen module imports only effect.

---

## phase-02 — File decoders, the persisted-file bridge and every read site {#phase-02-bridge-read-sites}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

phax gains one pure module, `src/schemas/persisted.ts`, and every place phax reads a persisted file goes through it. A document with `$schema` is read by phax's current file decoder. A document without `$schema` is read by the frozen pre-schema decoder, then a step to the current shape. Every failure names the file. No document carries `$schema` yet, so from this phase on every existing file is read through its frozen decoder. No shape changes, and phax still writes `version`.

### Detailed instructions

- Read phase-01's handoff, `src/schemas/history/*`, `packages/schemas/src/shapes.ts` (`defineFormat` is the model the bridge mirrors), and `src/schemas/formatError.ts` (`formatFirstViolation`). Never read `~/.phax`. Use only made-up documents.
- Give every format a file decoder in its `src/schemas` module. Keep each format's excess-property option exactly as it is today. Until the format's family phase, the file schema is today's schema, so add a one-line comment saying so. Formats whose decoder reads only files rename it to the `File` form and delete the old name, so the compiler finds every remaining read site:
    - `registry.ts`: `RegistryFileSchema` (an alias of `RegistrySchema` for now), and `decodeRegistryFile` replacing `decodeRegistry`.
    - `status.ts`: `RunStatusFileSchema` and `PhaseStatusFileSchema`, and `decodeRunStatusFile` and `decodePhaseStatusFile` replacing `decodeRunStatus` and `decodePhaseStatus`. Do not touch the encoders.
    - `phaxPlan.ts`: `PhaxPlanFileSchema`, and `decodePhaxPlanFile` replacing `decodePhaxPlan`. `ExtractedPhaxPlanSchema` is unchanged.
    - `runRecord.ts`: `RunRecordManifestFileSchema` and `decodeRunRecordManifestFile`.
    - `authoringRecord.ts`: `AuthoringRecordManifestFileSchema`, `decodeAuthoringRecordManifestFile`, `RecordManifestFileSchema`, and `decodeRecordManifestFile` replacing `decodeRecordManifest`.
    - `gateAttribution.ts`: `decodeGateAttributionFile`.
    - `reconciliation.ts`: `decodePhaseFileReconciliationFile`.
    - `gatePending.ts`: `decodeGatePendingFile` replacing `decodeGatePendingDocument`, which `src/` never uses.
    - The approvals ledgers keep `ApprovalRecordFileSchema`/`decodeApprovalRecordFile` and `SpecApprovalRecordFileSchema`/`decodeSpecApprovalRecordFile`, which are already file names.
- Formats whose decoder is also an agent or tool contract keep that decoder unchanged and gain a separate file decoder:
    - `complianceReview.ts` keeps `ComplianceReviewSchema` and `decodeComplianceReview`, the agent verdict, and adds `ComplianceReviewFileSchema` and `decodeComplianceReviewFile` (strict).
    - `specDocument.ts` and `planDocument.ts` keep their authoring contract and add `SpecDocumentFileSchema`/`decodeSpecDocumentFile` and `PlanDocumentFileSchema`/`decodePlanDocumentFile` (strict).
    - `gateDiagnostics.ts` keeps `GateDiagnosticsDocumentSchema` and `decodeGateDiagnosticsDocument`, the gate-step stdout contract, and adds `GateDiagnosticsFileSchema` and `decodeGateDiagnosticsFile`.
- In the package's four `formats/*.ts` files, every `next` shape uses the file schema and the file decoder. Phase records use `decodeRunRecordManifestFile`. `build/jsonSchemas.ts` keeps rendering the `record-manifest` union from `RecordManifestSchema`, or from its file alias. Every generated JSON Schema still equals its pre-schema snapshot.
- Create `src/schemas/persisted.ts`. It imports `effect`, `src/schemas/*.ts` and `src/schemas/history/*`, and never anything under `packages/`. It is pure: no I/O, no Effect services, and callers pass the file path only for messages. It exports `PersistedReadError`, a value `{ _tag: 'PersistedReadError', file, format, message }` whose message starts with the file, and a generic `readPersisted(input, spec)`. The spec carries the format id, a label, the file, `decodeCurrent`, `decodePreSchema`, `fromCurrent` (the current file value to the in-memory value) and `fromPreSchema`, which returns `Either<InMemory, { fact: string }>`.
- `readPersisted` resolves like `defineFormat`:
    1. A non-object fails with '<file>: a <label> is a JSON object'.
    2. A document with its own `$schema` key is read only by `decodeCurrent`. Success returns `fromCurrent`; failure returns '<file>: <first violation>'.
    3. A document without `$schema` is read only by `decodePreSchema`. On success, `fromPreSchema` runs:
       - a missing fact fails with '<file>: <label> written before $schema lacks <fact>, which phax needs — not supported';
       - a decode failure fails with '<file>: <label> without $schema is not in the pre-schema shape — older than the first release that writes $schema, or damaged (<violation>)'.

    Nothing throws.
- Add one reader per format phax reads. Each has the shape `(file: string, input: unknown) => Either<InMemory, PersistedReadError>`:
    - `readRegistryFile`, `readRunStatusFile`, `readPhaseStatusFile`;
    - `readPhaxPlanFile`, `readComplianceReviewFile`;
    - `readPlanApprovalsFile`, `readSpecApprovalsFile`, `readSpecDocumentFile`, `readPlanDocumentFile`;
    - `readRecordManifestFile`;
    - `readGateAttributionFile`, `readPhaseFileReconciliationFile`.

    `readRecordManifestFile` handles the union. A `$schema` document goes to `decodeRecordManifestFile`. A document without `$schema` goes to the authoring pre-schema decoder when `kind` is 'authoring', and to the phase pre-schema decoder otherwise. A version-1 phase manifest therefore fails as not in the pre-schema shape.

    In this phase every `fromPreSchema` is `Either.right` of the value, and every `fromCurrent` is the identity: the frozen and current shapes are the same. Each family phase replaces them. Add no reader for gate diagnostics or gate pending: phax never reads those files back.
- Move every read site to the bridge. Each site keeps its error type, its control flow and its fallback (for example, a missing file still gives an empty registry or an empty ledger, and `resolveRunInfo`'s plan read stays lenient). Only its message becomes the bridge's message. The sites are:
    - registry: `src/app/registry.ts` `readRegistry`, `src/app/resolveRunRef.ts`, `src/cli/commands/run.ts` (sync);
    - run status: `src/app/dispatcher.ts`, `src/app/effectRunner.ts`, `src/app/gates.ts`, `src/app/resetPhase.ts`, `src/app/resolveRunInfo.ts`, `src/cli/commands/resume.ts`, `src/cli/interruptHandler.ts` (sync);
    - phase status: `dispatcher.ts`, `effectRunner.ts`, `src/app/phaseStatusUpdates.ts`, `src/infra/providers/sessionWriter.ts`, `resolveRunInfo.ts`;
    - phax-plan: `src/app/loadPlan.ts` (resume and `phax validate --plan`), `resolveRunInfo.ts`;
    - compliance review: `src/app/reviewCode.ts` (the durable file);
    - approvals: `src/app/approvalRecordStore.ts` `readStoreFile`;
    - sidecars: `src/domain/artifact/sidecar.ts` `renderSidecar`, which passes the sidecar path, or 'sidecar' when it has none, and keeps the `invalid` result;
    - manifests: `src/app/recordsList.ts`, `src/app/recordsExplain.ts`;
    - attribution: `src/app/writeRecord.ts`, `src/app/gateAttribution.ts`;
    - reconciliation: `src/app/executePlan.ts`, `src/app/loadReviewHandoffInputs.ts`, `src/app/generateGlobalReconciliation.ts`.
- Do not move decodes of agent or tool output:
    - `src/app/reviewCompliance.ts` (the agent's verdict file in `.phax-context`);
    - `src/app/authorArtifact.ts` (the authoring session's output);
    - `src/app/extractPlan.ts` and `src/domain/plan/parsePlanMarkdown.ts` (the extracted plan);
    - `src/app/planCacheStore.ts` (the extraction cache, an internal format);
    - the gate-step stdout decode in `src/app/gates.ts`.

    Where `resetPhase.ts` and `interruptHandler.ts` rewrite the file they read, keep writing what they write today; phase-04 changes those writes.
- In `tests/unit/architecturalGuards.test.ts`, add `BRIDGE_ONLY_DECODERS: { readonly [F in FormatId]: ReadonlyArray<string> }`, which fails to compile when an id is missing and has a non-empty entry for every format. It names every file decoder, for example `decodeRegistryFile`, or `decodeRunRecordManifestFile` with `decodeRecordManifestFile`. The guard is that no `src/` module other than `src/schemas/persisted.ts` and the `src/schemas/*.ts` module that declares a name references it as a whole word. Add a self-test of the detector.
- Write `tests/unit/persisted.test.ts` over toy Effect schemas: a pre-schema toy with `version: 1`, and a current toy with a `$schema` string field. Cover:
    - a non-object;
    - a `$schema` document read only by the current decoder, even when the pre-schema decoder would accept it;
    - a document without `$schema` read through the pre-schema decoder and its step;
    - a step that reports a missing fact, refused with the file and the fact;
    - a document without `$schema` that the pre-schema decoder rejects, whose message names the file and the violation;
    - a `$schema` document the current decoder rejects.

    Nothing throws. Add reader cases on made-up documents: `readRegistryFile` on a pre-schema registry; `readRecordManifestFile` on a pre-schema phase manifest, a pre-schema authoring manifest, and a version-1 phase manifest (refused, naming the file).
- Update the tests that assert a read-site message that is now the bridge's. Keep their intent: the same error type, the same fallback.

### Planned files to create

- `src/schemas/persisted.ts`
- `tests/unit/persisted.test.ts`

### Planned files to edit

- `src/schemas/registry.ts`
- `src/schemas/status.ts`
- `src/schemas/phaxPlan.ts`
- `src/schemas/complianceReview.ts`
- `src/schemas/runRecord.ts`
- `src/schemas/authoringRecord.ts`
- `src/schemas/gateAttribution.ts`
- `src/schemas/reconciliation.ts`
- `src/schemas/gateDiagnostics.ts`
- `src/schemas/gatePending.ts`
- `src/schemas/specDocument.ts`
- `src/schemas/planDocument.ts`
- `src/app/registry.ts`
- `src/app/resolveRunRef.ts`
- `src/cli/commands/run.ts`
- `src/app/dispatcher.ts`
- `src/app/effectRunner.ts`
- `src/app/gates.ts`
- `src/app/resetPhase.ts`
- `src/app/resolveRunInfo.ts`
- `src/cli/commands/resume.ts`
- `src/cli/interruptHandler.ts`
- `src/app/phaseStatusUpdates.ts`
- `src/infra/providers/sessionWriter.ts`
- `src/app/loadPlan.ts`
- `src/app/reviewCode.ts`
- `src/app/approvalRecordStore.ts`
- `src/domain/artifact/sidecar.ts`
- `src/app/recordsList.ts`
- `src/app/recordsExplain.ts`
- `src/app/writeRecord.ts`
- `src/app/gateAttribution.ts`
- `src/app/executePlan.ts`
- `src/app/loadReviewHandoffInputs.ts`
- `src/app/generateGlobalReconciliation.ts`
- `packages/schemas/src/formats/runDirectory.ts`
- `packages/schemas/src/formats/repository.ts`
- `packages/schemas/src/formats/recordManifests.ts`
- `packages/schemas/src/formats/recordTimeline.ts`
- `tests/unit/architecturalGuards.test.ts`

### Optional files that may be edited

- `src/schemas/approvalRecord.ts`
- `src/schemas/specApprovalRecord.ts`
- `src/app/artifactStatus.ts`
- `src/app/planStaleness.ts`
- `packages/schemas/build/jsonSchemas.ts`
- `packages/schemas/src/index.ts`
- `tests/type/schemasPackage.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/integration/registry.test.ts`
- `tests/unit/resolveRunRef.test.ts`
- `tests/unit/resolveRunInfo.test.ts`
- `tests/unit/phaseStatusUpdates.test.ts`
- `tests/unit/resume.test.ts`
- `tests/unit/cli/resume.test.ts`
- `tests/unit/cli/validate.test.ts`
- `tests/unit/schemas.test.ts`
- `tests/unit/runRecord.test.ts`
- `tests/unit/authoringRecord.test.ts`
- `tests/unit/artifact/sidecar.test.ts`
- `tests/unit/artifact/lineage.test.ts`
- `tests/unit/gateAttribution.reader.test.ts`
- `tests/unit/gateAttribution.test.ts`
- `tests/unit/schemas/gatePending.test.ts`
- `tests/unit/schemas/reconciliation.test.ts`
- `tests/unit/schemas/complianceReview.test.ts`
- `tests/integration/dispatcher.test.ts`
- `tests/integration/resetPhase.test.ts`
- `tests/integration/recordsExplain.test.ts`
- `tests/integration/reviewCode.test.ts`
- `tests/integration/writeRecord.test.ts`
- `tests/integration/gates.test.ts`
- `tests/integration/loadReviewHandoffInputs.test.ts`
- `tests/integration/generateGlobalReconciliation.test.ts`
- `tests/integration/artifactStatus.test.ts`
- `tests/integration/planStaleness.test.ts`

### Boundary contracts

Producer: `src/schemas/persisted.ts`, pure and importable from the domain, app, infra and cli layers. It provides `PersistedReadError`, `readPersisted` and one `read<Format>File(file, input) → Either<InMemory, PersistedReadError>` per format phax reads. Producer: each `src/schemas` module's `<X>FileSchema` and `decode<X>File`; only the bridge and the declaring module may name the decoder, and the package's `next` shapes use it. Consumers: the 23 read-site modules listed, and through them `phax ls`, `phax run`, `phax resume`, `phax validate --plan`, the dispatcher, the gates, reviews, artifact status and approval, and `phax records list|explain`. Unchanged: every decoder of agent or tool output.

### Test strategy

Write `tests/unit/persisted.test.ts` and the bridge-only guard (with its detector self-test) first: they are the contract the family phases rely on. The read-site migration is a refactor, so the existing unit and integration suites are its regression net; update only assertions on message text. The package suites must stay green unchanged except for the decoder names.

### Implementation order

1. Write the bridge unit tests over toy schemas, then the generic `readPersisted`.
2. Add the file schemas and decoders in each `src/schemas` module, and point the package's `next` shapes at them.
3. Add the per-format readers.
4. Migrate the read sites one family at a time, running the affected tests after each.
5. Add the bridge-only guard, then run the full gate.

### Excluded scope

- Any change to a persisted format's shape or to a writer: phax still writes `version` and no `$schema`.
- The release constant, `schemaUrlField` and the `$schema` stamp (phase-03).
- Decodes of agent or tool output, and the extraction cache.
- Anything under `src/schemas/history/` (frozen).
- Readers for gate diagnostics and gate pending.

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

Include:
- the exact exports and signatures of `src/schemas/persisted.ts`;
- the list of file decoder names per format, as in `BRIDGE_ONLY_DECODERS`;
- for every read site, the reader it now calls and how its error type wraps `PersistedReadError`;
- the read sites that rewrite what they read (`resetPhase.ts`, `interruptHandler.ts`) and what they still write;
- tests whose message assertions changed;
- any deviation from the planned file lists, with the reason.

### Commit subject

`feat(schemas): read every persisted file through the bridge`

### Commit body

Add src/schemas/persisted.ts, the only src/ module that imports the
frozen decoders under src/schemas/history/. It is pure, and for every
persisted format phax reads it reads the file in one way: a document
with $schema is read by phax's current file decoder; a document without
$schema is read by the frozen pre-schema decoder, then stepped to the
current shape, refusing when a fact phax needs is missing. Every failure
names the file.

Each format's schema module now exposes a file decoder, named with a
File suffix. Until its family changes shape, that decoder is today's
decoder. The decoders of the contracts that face an agent or a tool
keep their names. The package's next shapes use the file decoders.

Every phax read of a registry, a run or phase status, a phax-plan, a
compliance review, an approvals ledger, a sidecar, a record manifest, a
gate attribution or a file reconciliation goes through the bridge. No
existing document carries $schema, so they are all read through their
frozen pre-schema decoder.

A new guard keeps every file decoder to the bridge and its declaring
module.

---

## phase-03 — The release constant, the $schema field and the run registry {#phase-03-release-and-registry}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

phax knows the release it writes, and it is the same constant `phax --version` prints. The run registry is the first format to write `$schema` first and drop `version`. A registry written by 0.16.0 keeps listing its runs through the frozen decoder, and it is rewritten with `$schema` on the next write (`ac-own-legacy`).

### Detailed instructions

- Read the phase-02 handoff first. Never read `~/.phax`; use only made-up registries.
- Release constant:
    - In `packages/schemas/build/generated.ts`, beside `renderGeneratedIndex`, add `renderReleaseModule({ packageVersion })`. It renders a header comment ('Generated by `<WRITE_COMMAND>` — do not edit', then: the root package.json version, which `phax --version` prints and every persisted document names in its `$schema`) and `export const PHAX_RELEASE = "<version>";`.
    - In `scripts/schemas-check.ts`, `SchemasState` gains `releaseModule: string | undefined`, read from `src/schemas/release.ts`. `checkSchemas` reports '✗ src/schemas/release.ts does not match package.json version <v> — run <WRITE_COMMAND>' when the file is missing or stale. `writeSchemas` returns the module and `--write` writes it.
    - Update the script's header comment.
    - Add `src/schemas/release.ts` to the `.oxfmtrc.json` ignore list, beside the package's generated index.
    - Run `pnpm exec tsx scripts/schemas-check.ts --write`.
- `readPackageVersion()` in `src/cli/commands/usage.ts` returns `PHAX_RELEASE` and no longer reads `package.json`. Keep its name and export, and update its comment. Leave the usage-spec and skills path resolution, and the Deno `--include package.json`, as they are.
- In `src/schemas/schemaUrl.ts`, add `schemaUrlField(formatId)`: a `Schema.String` with a `Schema.pattern` that accepts exactly `<SCHEMA_URL_BASE>/<that id>/<X.Y.Z>.json`, with dots escaped and the numeric triple as in `isRelease`. Give it a description annotation naming the format. It must render to JSON Schema with no gap (`findJsonSchemaGaps` returns `[]`). The module now imports `effect`, which the package closure allows; update its header comment. Test it in `tests/unit/schemaUrl.test.ts`: it accepts the format's own URL at any release, and rejects another format id, a malformed release and a non-string.
- In the bridge, add `withSchemaUrl(formatId, value)`. It returns `{ $schema: schemaUrl(formatId, PHAX_RELEASE), ...value }` with `$schema` as the first key.
- Change `src/schemas/registry.ts`:
    - The in-memory `Registry` becomes `{ runs }`, with no `version`.
    - `RegistryFileSchema = Schema.Struct({ $schema: schemaUrlField('registry'), runs })`, with `$schema` first and effect's default excess option (unknown keys ignored, as today).
    - `decodeRegistryFile` decodes it. Add `encodeRegistryFile`, and delete `encodeRegistry`.
    - Keep `RegistryEntrySchema` unchanged.
- In the bridge's `readRegistryFile`:
    - `fromCurrent` drops `$schema`;
    - `fromPreSchema` drops `version`. It never misses a fact: the pre-schema registry carries every field phax needs.
- Change the writers:
    - `upsertRun` and `setRunStatus` in `src/app/registry.ts` write `encodeRegistryFile(withSchemaUrl('registry', { runs }))`.
    - Remove `REGISTRY_VERSION`.
    - The empty registry is `{ runs: [] }` in `src/app/registry.ts` and in `src/cli/commands/run.ts`.
- In the package's `formats/runDirectory.ts`:
    - The registry's `next` shape is the new file schema and decoder.
    - `RegistryShapes = { 'pre-schema': RegistryPreSchema; next: RegistryFile }`.
    - `LatestRegistry` is phax's in-memory `Registry`.
    - `toLatestRegistry` accepts either shape and drops `version` or `$schema`.

    In `packages/schemas/src/index.ts`, export the file schema and type as the package's `RegistrySchema` and `Registry`.
- Run `pnpm exec tsx scripts/schemas-check.ts --write`. It must create exactly `packages/schemas/snapshots/registry/next.schema.json` and leave `registry/pre-schema.schema.json` byte-identical.
- Tests:
    - In `tests/integration/registry.test.ts` (`ac-own-legacy`), seed a made-up registry in the pre-schema shape (`{ version: 1, runs: [ … ] }`). `readRegistry` lists its runs. After `upsertRun`, the file on disk has `$schema` as its first key, equal to `schemaUrl('registry', <root package.json version read in the test>)`, has no `version`, and holds the original runs plus the new one.
    - In `tests/unit/persisted.test.ts`, add `readRegistryFile` cases (a current file, a pre-schema file, a rejected file), plus the `withSchemaUrl` key order and URL.
    - In `frozenHistory.test.ts`, the committed `src/schemas/release.ts` is current. Add findings for a stale module and a missing one.
    - `PHAX_RELEASE` equals the root `package.json` version, and `phax --version` still prints it.
    - Drop `version` from typed `Registry` literals. A test that seeds a registry file on disk may keep the pre-schema shape (it now exercises the legacy path), or stamp it with `withSchemaUrl`.
    - In the package: `validDocuments.registry` is built through `RegistryFileSchema` from a stamped value. `runDirectoryFormats.test.ts` checks that a pre-schema registry reads as `pre-schema`, that a phax-written one reads as `next`, and that `toLatestRegistry` gives the same value both ways. Parity on file documents holds: a registry with one unknown key is accepted by both. `parseDocument` on a phax-written registry returns format `registry` and shape `next` (`ac-identify-alone`).
    - In `tests/type/schemasPackage.ts`: `RegistryShape` is `'pre-schema' | 'next'`, the package's `Registry` is phax's `RegistryFile` both ways, and `LatestRegistry` is phax's `Registry`.

### Planned files to create

- `src/schemas/release.ts`
- `packages/schemas/snapshots/registry/next.schema.json`

### Planned files to edit

- `packages/schemas/build/generated.ts`
- `scripts/schemas-check.ts`
- `.oxfmtrc.json`
- `src/cli/commands/usage.ts`
- `src/schemas/schemaUrl.ts`
- `src/schemas/registry.ts`
- `src/schemas/persisted.ts`
- `src/app/registry.ts`
- `src/cli/commands/run.ts`
- `packages/schemas/src/formats/runDirectory.ts`
- `packages/schemas/src/index.ts`
- `tests/unit/schemaUrl.test.ts`
- `tests/unit/persisted.test.ts`
- `tests/integration/registry.test.ts`
- `tests/unit/schemasPackage/frozenHistory.test.ts`
- `tests/unit/schemasPackage/documents.ts`
- `tests/unit/schemasPackage/runDirectoryFormats.test.ts`
- `tests/type/schemasPackage.ts`

### Optional files that may be edited

- `src/app/resolveRunRef.ts`
- `src/app/archive.ts`
- `src/app/effectRunner.ts`
- `src/app/runFolder.ts`
- `src/app/recordsStatus.ts`
- `src/cli/commands/ls.ts`
- `src/cli/commands/records.ts`
- `tests/unit/registryNamespace.test.ts`
- `tests/unit/resolveRunRef.test.ts`
- `tests/unit/cli/ls.test.ts`
- `tests/unit/schemas.test.ts`
- `tests/integration/archive.test.ts`
- `tests/integration/cliProgram.test.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/parseDocument.test.ts`
- `tests/unit/schemasPackage/parse.test.ts`
- `tests/unit/schemasPackage/jsonSchemas.test.ts`
- `tests/unit/schemasPackage/recordManifests.test.ts`
- `tests/unit/architecturalGuards.test.ts`

### Boundary contracts

Producers:
- `src/schemas/release.ts` provides `PHAX_RELEASE`, consumed by the bridge and by `readPackageVersion`.
- `src/schemas/schemaUrl.ts` provides `schemaUrlField(formatId)`, consumed by every file schema from this phase on.
- The bridge provides `withSchemaUrl(formatId, value)`, which puts `$schema` first. The family phases and the writers consume it.
- `src/schemas/registry.ts` provides `Registry` (in memory: no `version`, no `$schema`), `RegistryFileSchema`, `decodeRegistryFile` (bridge only) and `encodeRegistryFile`.

Consumers: `src/app/registry.ts`, `src/app/resolveRunRef.ts`, `src/cli/commands/run.ts`, and through them `phax ls`, `phax records status` and run creation.

### Test strategy

Write the `ac-own-legacy` case in `tests/integration/registry.test.ts` first, while the pre-schema registry still reads through phase-02's identity step. Then change the schema and watch the step carry it. Unit-test the release module check, `schemaUrlField` and `withSchemaUrl`. The package unit tests and the type test follow.

### Implementation order

1. The release module renderer, the check and `--write`, and `readPackageVersion`.
2. `schemaUrlField` and `withSchemaUrl`, with their tests.
3. The integration test for a 0.16.0 registry.
4. The registry file schema and in-memory type, then the bridge's registry step.
5. The package format and its exports.
6. The writers.
7. `schemas-check --write`, then the test and type updates.

### Excluded scope

- Run and phase status (phase-04) and every other format.
- Rewriting a registry file that phax only reads.
- Any CLI output change.
- The Deno build configuration and the usage-spec path resolution.

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

Include:
- `PHAX_RELEASE`'s module and how `schemas-check` keeps it current;
- the exact signatures of `schemaUrlField` and `withSchemaUrl`;
- the registry names (`RegistryFileSchema`, `decodeRegistryFile`, `encodeRegistryFile`, `readRegistryFile`) and the pattern they set for later families: in-memory type, file schema, bridge step, package `next` shape, snapshot;
- tests that still seed pre-schema registries on purpose;
- a note for plan 5: its release commit must run `schemas-check --write` so `src/schemas/release.ts` follows the bump;
- any deviation from the planned file lists, with the reason.

### Commit subject

`feat(registry): write $schema in the run registry`

### Commit body

phax now knows the release it writes. src/schemas/release.ts exports
PHAX_RELEASE. scripts/schemas-check.ts --write generates it from the
root package.json, and the gate fails when it is stale.
readPackageVersion returns it, so phax --version and every $schema
share one source.

schemaUrl.ts gains schemaUrlField(formatId), a $schema field bound to
one format id, and the bridge gains withSchemaUrl, which writes $schema
as a document's first key.

~/.phax/registry.json now starts with
$schema: https://docs.phax.run/schemas/registry/<release>.json and
carries no version. The in-memory Registry drops version. A registry
written by 0.16.0 still lists its runs through the frozen pre-schema
decoder, and it is rewritten with $schema on the next upsert.

The change is recorded as snapshots/registry/next.schema.json; the
pre-schema snapshot is untouched.

---

## phase-04 — Run and phase status write $schema {#phase-04-run-phase-status}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

A run's `run-status.json` and each phase's `status.json` name their format and release. A run directory written by 0.16.0 keeps working (`phax resume`, `phax enter`, review, reset, interrupts), and its files are rewritten with `$schema` on the next write.

### Detailed instructions

- Read the phase-03 handoff and follow the registry's pattern. Never read `~/.phax`; use only made-up run directories.
- Change `src/schemas/status.ts`:
    - The in-memory `RunStatus` and `PhaseStatus` drop `version`.
    - `RunStatusFileSchema` and `PhaseStatusFileSchema` become `$schema` first (`schemaUrlField('run-status')` or `schemaUrlField('phase-status')`), then the fields, with effect's default excess option as today. `decodeRunStatusFile` and `decodePhaseStatusFile` decode them.
    - Keep the encoder names `encodeRunStatus` and `encodePhaseStatus`; they now encode the file value. The single-status-writer guard matches these exact names, so do not rename them and do not import them outside that guard's allowlist.
- In the bridge's `readRunStatusFile` and `readPhaseStatusFile`:
    - `fromCurrent` drops `$schema`;
    - `fromPreSchema` drops `version`.
- In `formats/runDirectory.ts`:
    - the run-status and phase-status `next` shapes use the file types;
    - `Latest*` is phax's in-memory type;
    - `toLatest*` accepts either shape and drops `version` or `$schema`.

    In `packages/schemas/src/index.ts`, export the file schemas and types as the package's `RunStatusSchema`, `RunStatus`, `PhaseStatusSchema` and `PhaseStatus`.
- Change every write so it produces a file value with `$schema` first and no `version`:
    - Encoder writers call `encodeRunStatus(withSchemaUrl('run-status', value))` or the phase-status equivalent. They are `src/app/effectRunner.ts` (run and phase status), `src/app/gates.ts`, `src/app/phaseStatusUpdates.ts` and `src/infra/providers/sessionWriter.ts`.
    - Writers that must not import the encoders (because of the single-writer guard) write `JSON.stringify(withSchemaUrl(<id>, value), null, 2)`. They are `createRunFolder` in `src/app/runFolder.ts` and `createPhaseFolder` in `src/app/phaseFolder.ts`.
    - `clearRunStatusLastError` in `src/app/resetPhase.ts` and the interrupt write in `src/cli/interruptHandler.ts` write `withSchemaUrl('run-status', <the bridge-read value with the change applied>)`, still without the encoders. Unknown keys that the ignore-excess decoder tolerated are dropped on these rewrites; this is accepted.
- Drop `version: 1` from every in-memory status literal in `src/`.
- Run `pnpm exec tsx scripts/schemas-check.ts --write`. It must create exactly the two `next.schema.json` files and leave both `pre-schema.schema.json` files byte-identical.
- Create `tests/integration/legacyRunFiles.test.ts` (`ac-own-legacy` for run files), using the ports that the existing dispatcher and resume integration tests use. Seed a made-up run directory in the pre-schema shape: a `run-status.json` and one `status.json`, both with `version: 1`. Check that:
    - the dispatcher's state read and `loadRunReviewInfo` read it;
    - after one dispatched transition, both files start with `$schema` equal to `schemaUrl(<id>, <root package.json version>)`, carry no `version`, and keep every other field;
    - a status file that both decoders reject fails with a message naming the file.
- Drop `version` from typed `RunStatus`/`PhaseStatus` literals across `tests/` (unit, integration and e2e: `pnpm test:type` compiles them all). A test that seeds status files on disk may keep the pre-schema shape (it exercises the legacy path) or stamp them with `withSchemaUrl`. A test that asserts written file content (for example `tests/integration/runFolder.test.ts`) expects `$schema` and no `version`.
- Update the package tests:
    - `validDocuments` for both formats are built from stamped values;
    - `runDirectoryFormats.test.ts` covers both shapes and `toLatest`, and parity on file documents holds;
    - `ac-failure` still holds: `parseRunStatus` on a phax-written run status whose `state` is 'paused' fails at `state`.

    In `tests/type/schemasPackage.ts`, the package types for both formats are phax's file types, and their `Latest*` types are phax's in-memory types.

### Planned files to create

- `packages/schemas/snapshots/run-status/next.schema.json`
- `packages/schemas/snapshots/phase-status/next.schema.json`
- `tests/integration/legacyRunFiles.test.ts`

### Planned files to edit

- `src/schemas/status.ts`
- `src/schemas/persisted.ts`
- `src/app/runFolder.ts`
- `src/app/phaseFolder.ts`
- `src/app/effectRunner.ts`
- `src/app/gates.ts`
- `src/app/resetPhase.ts`
- `src/app/phaseStatusUpdates.ts`
- `src/cli/interruptHandler.ts`
- `src/infra/providers/sessionWriter.ts`
- `packages/schemas/src/formats/runDirectory.ts`
- `packages/schemas/src/index.ts`
- `tests/unit/persisted.test.ts`
- `tests/unit/schemasPackage/documents.ts`
- `tests/unit/schemasPackage/runDirectoryFormats.test.ts`
- `tests/type/schemasPackage.ts`
- `tests/unit/schemas.test.ts`
- `tests/unit/resolveRunInfo.test.ts`
- `tests/unit/phaseStatusUpdates.test.ts`
- `tests/unit/resume.test.ts`
- `tests/integration/dispatcher.test.ts`
- `tests/integration/runFolder.test.ts`

### Optional files that may be edited

- `src/app/dispatcher.ts`
- `src/app/resolveRunInfo.ts`
- `src/cli/commands/resume.ts`
- `src/domain/effects.ts`
- `src/app/archive.ts`
- `tests/unit/state.test.ts`
- `tests/unit/resolveRunRef.test.ts`
- `tests/unit/reviewHandoffContent.test.ts`
- `tests/unit/cli/enterPhase.test.ts`
- `tests/unit/cli/resume.test.ts`
- `tests/integration/resetPhase.test.ts`
- `tests/integration/fixLoop.test.ts`
- `tests/integration/plansOverlapLanded.test.ts`
- `tests/integration/finalReview.test.ts`
- `tests/integration/rateLimit.test.ts`
- `tests/integration/enterPhase.test.ts`
- `tests/integration/resumeFromCommit.test.ts`
- `tests/integration/perPhaseBranch.test.ts`
- `tests/integration/reviewCodeCommand.test.ts`
- `tests/integration/eventAdapter.test.ts`
- `tests/integration/adjustPlanCommand.test.ts`
- `tests/integration/sessionInfo.test.ts`
- `tests/integration/reviewHandoffCommand.test.ts`
- `tests/integration/resumeHandoff.test.ts`
- `tests/integration/resumeFromCleanup.test.ts`
- `tests/integration/enter.test.ts`
- `tests/integration/resume.test.ts`
- `tests/integration/executePlan.test.ts`
- `tests/integration/resetResume.test.ts`
- `tests/integration/resumeFromCompletion.test.ts`
- `tests/integration/telemetry/adapterFailures.test.ts`
- `tests/integration/archive.test.ts`
- `tests/integration/reviewHandoff.test.ts`
- `tests/integration/loadReviewHandoffInputs.test.ts`
- `tests/integration/finalReport.test.ts`
- `tests/integration/skillEditConsent.test.ts`
- `tests/e2e/resetPhase.test.ts`
- `tests/e2e/gateExhaustionResume.test.ts`
- `tests/e2e/semanticTrace.test.ts`
- `tests/e2e/semanticTrace.providers.test.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/parseDocument.test.ts`
- `tests/unit/schemasPackage/parse.test.ts`

### Boundary contracts

Producer: `src/schemas/status.ts` provides the in-memory `RunStatus` and `PhaseStatus`, `RunStatusFileSchema` and `PhaseStatusFileSchema`, `decode*File` (bridge only), and `encodeRunStatus`/`encodePhaseStatus` over the file value. Producer: the bridge's `readRunStatusFile` and `readPhaseStatusFile`. Consumers: the dispatcher, the effect runner, the gates, reset, resume, run info, the SIGINT handler and the session writer. `StatePatch` in `src/domain/effects.ts` stays `Partial` over the in-memory types.

### Test strategy

Write `tests/integration/legacyRunFiles.test.ts` first, against phase-03's code, to pin that 0.16.0 run directories keep working before the schema changes. Add bridge unit cases in `tests/unit/persisted.test.ts`. Keep the single-status-writer guard green without widening its allowlist. The package unit tests and the type test follow.

### Implementation order

1. The legacy run-directory integration test.
2. The status file schemas, in-memory types and encoders.
3. The bridge steps.
4. The package formats and exports.
5. The writers: encoders first, then the guard-restricted writers.
6. `schemas-check --write`, then the test sweep.

### Excluded scope

- phax-plan.json and compliance-review.json (phase-05).
- Any change to `RunState`/`PhaseState` transitions or to the dispatcher's logic.
- Widening `SINGLE_WRITER_ALLOWLIST` or `DOCUMENTED_METADATA_WRITERS`.

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

Include:
- the status file schema names;
- how the guard-restricted writers stamp `$schema`;
- which tests keep pre-schema fixtures on purpose;
- any unknown-key loss seen on rewrites;
- any deviation from the planned file lists, with the reason.

### Commit subject

`feat(status): write $schema in run and phase status`

### Commit body

run-status.json and each phase's status.json now start with
$schema: https://docs.phax.run/schemas/<run-status|phase-status>/<release>.json
and carry no version. The in-memory RunStatus and PhaseStatus drop
version; the file schemas add $schema and still ignore unknown keys.

A run directory written by 0.16.0 is still read through the frozen
pre-schema decoders, so it still resumes, and its files are rewritten
with $schema on the next state change.

The status encoders keep their names, so the single-writer guard still
holds. The writers that bypass them (run and phase folder creation, the
reset-phase lastError clear, the SIGINT handler) stamp $schema
themselves.

The changes are recorded as next snapshots; the pre-schema snapshots
are untouched.

---

## phase-05 — phax-plan and compliance review write $schema {#phase-05-plan-and-review}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

A run's `phax-plan.json` and `compliance-review.json` name their format and release. The extracted-plan contract, the extraction cache and the compliance verdict the agent emits stay exactly as they are. Run directories written by 0.16.0 still resume and review.

### Detailed instructions

- Read the phase-04 handoff and follow its pattern. Use only made-up plans and reviews.
- Change `src/schemas/phaxPlan.ts`:
    - Keep `ExtractedPhaxPlanSchema` (`version: 1`), `getExtractedPlanJsonSchema` and `ExtractedPhaseFields` unchanged: they are the extraction contract, and they feed the extraction cache (`src/schemas/extractedPlanCacheEntry.ts`, also unchanged).
    - The in-memory `PhaxPlan` drops `version`.
    - `PhaxPlanFileSchema` becomes `$schema` first (`schemaUrlField('phax-plan')`), then `run` and `phases`, with `onExcessProperty: 'error'` as today. Add its encoder.
    - `getPhaxPlanJsonSchema` is unused in `src/`: delete it unless a test needs it.
- In `src/domain/plan/finalize.ts`, `finalizeExtractedPlan` stops copying `version` into the `PhaxPlan`. The deterministic parse and `projectExtractedPlan` still produce the extracted plan with `version: 1`.
- Change `src/schemas/complianceReview.ts`:
    - Keep `ComplianceReviewSchema` and `decodeComplianceReview` as the agent verdict contract (`version: 1`, strict). `COMPLIANCE_REVIEW_JSON_SHAPE` in `src/domain/review/compliancePrompt.ts` must not change.
    - Add the in-memory review type without `version`.
    - `ComplianceReviewFileSchema` becomes `$schema` first, then the same fields, strict. Add its encoder.
- In the bridge's `readPhaxPlanFile` and `readComplianceReviewFile`, `fromCurrent` drops `$schema` and `fromPreSchema` drops `version`. In `formats/runDirectory.ts`:
    - both `next` shapes use the file types;
    - `Latest*` is phax's in-memory type;
    - `toLatest*` accepts either shape.

    In the package index, export the file schemas and types as `PhaxPlanSchema`/`PhaxPlan` and `ComplianceReviewSchema`/`ComplianceReview`.
- Change the writes:
    - `src/app/runFolder.ts` writes the encoded `withSchemaUrl('phax-plan', plan)`.
    - `src/app/reviewCompliance.ts` stops copying the agent's raw text. It decodes the agent's file with the unchanged contract, as today, and writes the file encoding of `withSchemaUrl('compliance-review', <the decoded verdict without version>)` to `compliance-review.json`. The review it returns is that same in-memory value.
- The phase prompt embeds the in-memory plan, so its snapshot in `tests/unit/__snapshots__/promptGeneration.test.ts.snap` loses `"version": 1`. Make no other prompt change.
- Run `pnpm exec tsx scripts/schemas-check.ts --write`. It creates exactly the two `next.schema.json` files, and the pre-schema snapshots stay byte-identical.
- Tests:
    - `tests/integration/runFolder.test.ts`: `phax-plan.json` starts with `$schema` equal to `schemaUrl('phax-plan', <root version>)` and has no `version`.
    - `tests/integration/reviewCompliance.test.ts`: the durable `compliance-review.json` carries `$schema` and no `version`, while the agent's file keeps the `version: 1` contract.
    - `tests/integration/reviewCode.test.ts`: a made-up pre-schema `compliance-review.json` (`version: 1`) and a pre-schema `phax-plan.json` still load.
    - Typed `PhaxPlan` literals across `tests/` drop `version`. Typed `ExtractedPhaxPlan` literals and cache entries keep it.
    - Update the package tests and the type test as in phase-04.

### Planned files to create

- `packages/schemas/snapshots/phax-plan/next.schema.json`
- `packages/schemas/snapshots/compliance-review/next.schema.json`

### Planned files to edit

- `src/schemas/phaxPlan.ts`
- `src/schemas/complianceReview.ts`
- `src/schemas/persisted.ts`
- `src/domain/plan/finalize.ts`
- `src/app/runFolder.ts`
- `src/app/reviewCompliance.ts`
- `packages/schemas/src/formats/runDirectory.ts`
- `packages/schemas/src/index.ts`
- `tests/unit/persisted.test.ts`
- `tests/unit/schemasPackage/documents.ts`
- `tests/unit/schemasPackage/runDirectoryFormats.test.ts`
- `tests/type/schemasPackage.ts`
- `tests/unit/__snapshots__/promptGeneration.test.ts.snap`
- `tests/unit/extractPlanFinalize.test.ts`
- `tests/unit/schemas/complianceReview.test.ts`
- `tests/integration/runFolder.test.ts`
- `tests/integration/reviewCompliance.test.ts`
- `tests/integration/reviewCode.test.ts`

### Optional files that may be edited

- `src/app/loadPlan.ts`
- `src/app/resolveRunInfo.ts`
- `src/app/reviewCode.ts`
- `src/app/promptGeneration.ts`
- `src/domain/plan/parsePlanMarkdown.ts`
- `src/app/extractPlan.ts`
- `src/schemas/planDocument.ts`
- `src/cli/commands/validate.ts`
- `src/cli/commands/resume.ts`
- `tests/unit/promptGeneration.test.ts`
- `tests/unit/extractPlan.test.ts`
- `tests/unit/planDocument.test.ts`
- `tests/unit/dryRun.test.ts`
- `tests/unit/parsePlanMarkdown.test.ts`
- `tests/unit/schemas.test.ts`
- `tests/unit/loadOrExtractPlan.test.ts`
- `tests/unit/resume.test.ts`
- `tests/unit/cli/validate.test.ts`
- `tests/unit/cli/run.test.ts`
- `tests/integration/reviewComplianceCommand.test.ts`
- `tests/integration/scopesScheduling.test.ts`
- `tests/integration/extractPlanSealed.test.ts`
- `tests/integration/stateMachineContract.test.ts`
- `tests/integration/analyzePlanOverlap.test.ts`
- `tests/integration/plansOverlapLanded.test.ts`
- `tests/integration/plansOverlapCommand.test.ts`
- `tests/integration/reconciliation.test.ts`
- `tests/integration/rateLimit.test.ts`
- `tests/integration/resumeFromCommit.test.ts`
- `tests/integration/perPhaseBranch.test.ts`
- `tests/integration/modelPreflight.test.ts`
- `tests/integration/adjustPlan.test.ts`
- `tests/integration/adjustPlanCommand.test.ts`
- `tests/integration/runCarriesCompletion.test.ts`
- `tests/integration/extractPlanTitles.test.ts`
- `tests/integration/loadOrExtractPlan.test.ts`
- `tests/integration/setupFailure.test.ts`
- `tests/integration/telemetry/end-to-end.test.ts`
- `tests/integration/skillEditGrants.test.ts`
- `tests/integration/resumeHandoff.test.ts`
- `tests/integration/run.test.ts`
- `tests/integration/resumeFromCleanup.test.ts`
- `tests/integration/resume.test.ts`
- `tests/integration/routing.test.ts`
- `tests/integration/executePlan.test.ts`
- `tests/integration/resetResume.test.ts`
- `tests/integration/resumeFromCompletion.test.ts`
- `tests/integration/skillEditConsent.test.ts`
- `tests/integration/orientBriefArtifact.test.ts`
- `tests/e2e/realFlow.test.ts`
- `tests/e2e/resetPhase.test.ts`
- `tests/e2e/gateExhaustionResume.test.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/parseDocument.test.ts`

### Boundary contracts

Unchanged, facing the agent: `ExtractedPhaxPlanSchema` and its prompt JSON Schema, the extraction cache entry, `ComplianceReviewSchema`/`decodeComplianceReview` and `COMPLIANCE_REVIEW_JSON_SHAPE`. Producer: `PhaxPlanFileSchema` and `ComplianceReviewFileSchema` (persisted), and the bridge's `readPhaxPlanFile` and `readComplianceReviewFile`. Consumers: `loadPlan` (resume, validate), `loadRunReviewInfo`, the code-review session, and the phase prompt (the in-memory plan).

### Test strategy

Write the integration cases for a pre-schema `phax-plan.json` and `compliance-review.json` first, so 0.16.0 run directories are pinned before the change. Add bridge unit cases. The prompt snapshot changes only by the removed `version` line. The package unit tests and the type test follow.

### Implementation order

1. Integration tests for legacy plan and review files.
2. File schemas and in-memory types, leaving the agent contracts untouched.
3. `finalizeExtractedPlan`.
4. The bridge steps, the package formats and the exports.
5. The writers (`runFolder`, `reviewCompliance`).
6. `schemas-check --write`, then the test sweep.

### Excluded scope

- The extraction prompt, the extracted-plan schema and the extraction cache format.
- The compliance prompt and its hand-written verdict shape.
- The spec and plan documents and the approvals (phase-06).

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

Include:
- the file schema and encoder names for both formats;
- confirmation that the extraction prompt schema, the cache entry and the compliance prompt are unchanged;
- the in-memory type `reviewCompliance` now returns;
- any deviation from the planned file lists, with the reason.

### Commit subject

`feat(run): write $schema in phax-plan.json and compliance-review.json`

### Commit body

A run's phax-plan.json and compliance-review.json now start with
$schema and carry no version.

The in-memory PhaxPlan drops version: finalizeExtractedPlan stops
copying it. The contracts that face an agent are unchanged: the
extracted plan and its prompt schema, the extraction cache, and the
compliance verdict shape in the review prompt.

The compliance review is no longer copied verbatim from the agent's
file. phax decodes the verdict with its unchanged contract and writes
the persisted file with $schema.

Plans and reviews written by 0.16.0 are read through their frozen
pre-schema decoders, so they still load (resume, validate --plan,
review code).

---

## phase-06 — Approvals ledgers and authoring sidecars write $schema {#phase-06-repository-files}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

The two approvals ledgers, and every spec or plan document sidecar phax writes, name their format and release. The authoring contract an agent emits does not change. The ledgers and sidecars that 0.16.0 committed, including this repository's own, keep working.

### Detailed instructions

- Read the phase-05 handoff and follow its pattern. Use only made-up ledgers and documents.
- Approvals ledgers (`src/schemas/approvalRecord.ts`, `src/schemas/specApprovalRecord.ts`):
    - The in-memory ledger types drop `version`. Name them so they stay distinct from the file types, for example `PlanApprovals` and `SpecApprovals`, or keep `ApprovalRecordFile` for the file.
    - The file schemas carry `$schema` first (`schemaUrlField('plan-approvals')` or `'spec-approvals'`), with `onExcessProperty: 'error'` as today. Add their encoders.
- In `src/app/approvalRecordStore.ts`:
    - `EMPTY_PLAN_STORE` and `EMPTY_SPEC_STORE` have no `version`.
    - The writers encode `withSchemaUrl(<id>, ledger)`.
    - The bridge steps drop `version` and `$schema`.

    Do not hand-edit `docs/plans/approvals.json` or `docs/specs/approvals.json`: phax rewrites them at the next approval.
- Spec and plan documents (`src/schemas/specDocument.ts`, `src/schemas/planDocument.ts`):
    - Keep `SpecDocumentSchema`, `PlanDocumentSchema`, `decodeSpecDocument`, `decodePlanDocument`, `getSpecDocumentJsonSchema`, `getPlanDocumentJsonSchema` and `projectExtractedPlan` exactly as they are. They are the authoring contract (`version: 1`, `kind`).
    - Add the in-memory document types without `version`.
    - `SpecDocumentFileSchema` and `PlanDocumentFileSchema` become `$schema` first, then the same fields and `kind`, strict. The spec file schema keeps the contract's refinement and its `jsonSchema` annotation, so its JSON Schema renders with no gap. Add their encoders.
- In `src/app/authorArtifact.ts`, every file phax writes that holds the document uses the file encoding of `withSchemaUrl(<id>, <document without version>)`: the repository sidecar, the session folder's `document.json`, and the copy handed to the authoring record. The document is still decoded from the agent with the contract decoder, and the extraction cache is still seeded with `projectExtractedPlan` from the contract value.
- `renderSpecBody` and `renderPlanBody` (`src/domain/authoring/renderSpec.ts`, `renderPlan.ts`) take the in-memory document, with no `version`. The authoring path and `src/domain/artifact/sidecar.ts`, which reads through the bridge since phase-02, pass that shape. The bridge steps for both documents drop `version` and `$schema`.
- In `formats/repository.ts`, the four `next` shapes use the file types, and `toLatest*` accepts either shape. In the package index, export the file schemas and types under the spec's names: `PlanApprovalsSchema`/`PlanApprovals`, `SpecApprovalsSchema`/`SpecApprovals`, `SpecDocumentSchema`/`SpecDocument` and `PlanDocumentSchema`/`PlanDocument`.
- Run `pnpm exec tsx scripts/schemas-check.ts --write`. It creates exactly the four `next.schema.json` files, and the pre-schema snapshots stay byte-identical.
- Tests:
    - `tests/integration/authorArtifact.test.ts`: the sidecar and the session's `document.json` start with `$schema` and have no `version`, while the prompt's JSON Schema and the `phax artifact schema` output are byte-identical to before.
    - `tests/integration/artifactStatus.test.ts`: a made-up pre-schema sidecar (`version: 1`) beside its rendered body is `in-sync`, and so is a stamped one.
    - Approval store: a pre-schema ledger is read, and after a put the file has `$schema` and no `version` (`tests/unit/artifact/lineage.test.ts` or the store's own test).
    - Update typed literals, the package tests and the type test as in the earlier phases.

### Planned files to create

- `packages/schemas/snapshots/plan-approvals/next.schema.json`
- `packages/schemas/snapshots/spec-approvals/next.schema.json`
- `packages/schemas/snapshots/spec-document/next.schema.json`
- `packages/schemas/snapshots/plan-document/next.schema.json`

### Planned files to edit

- `src/schemas/approvalRecord.ts`
- `src/schemas/specApprovalRecord.ts`
- `src/schemas/specDocument.ts`
- `src/schemas/planDocument.ts`
- `src/schemas/persisted.ts`
- `src/app/approvalRecordStore.ts`
- `src/app/authorArtifact.ts`
- `src/domain/authoring/renderSpec.ts`
- `src/domain/authoring/renderPlan.ts`
- `packages/schemas/src/formats/repository.ts`
- `packages/schemas/src/index.ts`
- `tests/unit/persisted.test.ts`
- `tests/unit/schemasPackage/documents.ts`
- `tests/unit/schemasPackage/repositoryFormats.test.ts`
- `tests/type/schemasPackage.ts`
- `tests/unit/artifact/sidecar.test.ts`
- `tests/unit/schemas/specApprovalRecord.test.ts`
- `tests/unit/artifact/lineage.test.ts`
- `tests/integration/authorArtifact.test.ts`
- `tests/integration/artifactStatus.test.ts`

### Optional files that may be edited

- `src/domain/artifact/sidecar.ts`
- `src/app/writeAuthoringRecord.ts`
- `src/app/artifactStatus.ts`
- `src/app/planStaleness.ts`
- `src/domain/artifact/lineage.ts`
- `src/cli/commands/artifact.ts`
- `tests/unit/renderSpec.test.ts`
- `tests/unit/renderPlan.test.ts`
- `tests/unit/__snapshots__/renderSpec.test.ts.snap`
- `tests/unit/specDocument.test.ts`
- `tests/unit/planDocument.test.ts`
- `tests/integration/artifactNewHeadlessCommand.test.ts`
- `tests/integration/completeRunArtifacts.test.ts`
- `tests/integration/runCarriesCompletion.test.ts`
- `tests/integration/writeAuthoringRecord.test.ts`
- `tests/integration/planStaleness.test.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/parseDocument.test.ts`

### Boundary contracts

Unchanged, facing the agent: `SpecDocumentSchema`, `PlanDocumentSchema`, their decoders and their JSON Schemas. Producer: the four file schemas and their bridge readers. Consumers: `approvalRecordStore` (approve, staleness, completion), `sidecarAgreement` (`artifact status`, `artifact approve` and transitions), the renderers, and the authoring session writer.

### Test strategy

First write the integration cases for a pre-schema sidecar staying in sync and a pre-schema ledger being read. Assert that the authoring prompt's JSON Schema and the `phax artifact schema` output do not change. Add bridge unit cases. The package unit tests and the type test follow.

### Implementation order

1. Legacy sidecar and ledger tests.
2. File schemas and in-memory types, leaving the authoring contract untouched.
3. The bridge steps, the package formats and the exports.
4. The writers (the approval store, `authorArtifact`), then the renderers' parameter types.
5. `schemas-check --write`, then the test sweep.

### Excluded scope

- The authoring prompt, the `phax artifact schema` output and the extraction cache.
- Rewriting the repository's committed ledgers or sidecars by hand.
- The authoring record manifest itself (phase-07).
- artifact-decide's ledger changes (another spec).

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

Include:
- the four file schema and in-memory type names;
- confirmation that the authoring contract and its JSON Schema are byte-identical;
- the in-memory document type the renderers now take;
- any deviation from the planned file lists, with the reason.

### Commit subject

`feat(artifact): write $schema in approvals ledgers and authoring sidecars`

### Commit body

docs/plans/approvals.json, docs/specs/approvals.json and the JSON
sidecar beside a headless-authored spec or plan now start with $schema
and carry no version.

The spec and plan document schemas an authoring session emits are
unchanged (phax artifact schema spec|plan, the authoring prompt); phax
stamps $schema only when it writes the sidecar.

Ledgers and sidecars written by 0.16.0, including the ones committed in
this repository, are read through their frozen pre-schema decoders.
The ledgers are rewritten with $schema at the next approval.

---

## phase-07 — Record manifests write $schema {#phase-07-record-manifests}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

Every `record.json` phax commits to `phax/records/v1` names its format and release. `phax records list` and `phax records explain` keep reading the manifests already on the branch, and they report a version-1 phase manifest as unsupported instead of misreading it.

### Detailed instructions

- Read the phase-06 handoff and follow its pattern. Use only made-up manifests, committed to temporary records branches in tests.
- Change `src/schemas/runRecord.ts`:
    - The in-memory `RunRecordManifest` drops `version`.
    - `RunRecordManifestFileSchema` becomes `$schema` first (`schemaUrlField('phase-record-manifest')`), then the same fields, strict.
    - `encodeRunRecordManifest` encodes the file value.

    `assembleRecord` in `src/domain/records/assemble.ts` stops setting `version: 2`. `src/app/writeRecord.ts` encodes `withSchemaUrl('phase-record-manifest', manifest)`.
- Change `src/schemas/authoringRecord.ts`:
    - The in-memory authoring manifest drops `version` and keeps `kind: 'authoring'`.
    - `AuthoringRecordManifestFileSchema` becomes `$schema` first, strict.
    - `RecordManifestFileSchema` is the union of the two file schemas, and `RecordManifestSchema` follows it.

    `src/app/writeAuthoringRecord.ts` encodes `withSchemaUrl('authoring-record-manifest', manifest)`.
- In the bridge's `readRecordManifestFile`:
    - a `$schema` document is read by the file union, and `$schema` is stripped;
    - a pre-schema document steps to the in-memory type of its kind by dropping `version`;
    - a version-1 phase manifest stays refused, with the bridge's 'not in the pre-schema shape — older than the first release that writes $schema, or damaged' message.

    `recordsList` and `recordsExplain` keep their phase-02 handling of an undecodable manifest.
- In `formats/recordManifests.ts`:
    - both `next` shapes use the file types;
    - `toLatest*` accepts either shape;
    - `parseRecordManifest` is unchanged.

    In the package index, export the file schemas and types as `PhaseRecordManifestSchema`/`PhaseRecordManifest`, `AuthoringRecordManifestSchema`/`AuthoringRecordManifest` and `RecordManifestSchema`/`RecordManifest`. `build/jsonSchemas.ts` renders the `record-manifest` union from `RecordManifestSchema`; make sure that is the file union.
- Run `pnpm exec tsx scripts/schemas-check.ts --write`. It creates exactly the two `next.schema.json` files, and the pre-schema snapshots stay byte-identical.
- Tests:
    - `tests/integration/writeRecord.test.ts` and `writeAuthoringRecord.test.ts`: the committed `record.json` starts with `$schema` equal to `schemaUrl(<id>, <root version>)` and has no `version`.
    - `tests/integration/recordsExplain.test.ts`: a made-up pre-schema phase manifest (`version: 2`) and a pre-schema authoring manifest still explain. A made-up `version: 1` phase manifest is reported with the unsupported message.
    - `phaseRecordManifestHistory.test.ts` (`ac-history-read`, `ac-to-latest`): a pre-schema manifest reads as `pre-schema` and a phax-written one as `next`. `versionOnePhaseRecordManifest` fails as older than the first release that writes `$schema`. `toLatestPhaseRecordManifest` on the pre-schema manifest keeps every field it carried, and it invents no `sourceSha`.
    - `recordManifests.test.ts`: `parseDocument` identifies a phax-written manifest by `$schema` alone (`ac-identify-alone`).
    - Update the typed literals, the documents and the type test.

### Planned files to create

- `packages/schemas/snapshots/phase-record-manifest/next.schema.json`
- `packages/schemas/snapshots/authoring-record-manifest/next.schema.json`

### Planned files to edit

- `src/schemas/runRecord.ts`
- `src/schemas/authoringRecord.ts`
- `src/schemas/persisted.ts`
- `src/domain/records/assemble.ts`
- `src/app/writeRecord.ts`
- `src/app/writeAuthoringRecord.ts`
- `packages/schemas/src/formats/recordManifests.ts`
- `packages/schemas/src/index.ts`
- `tests/unit/persisted.test.ts`
- `tests/unit/schemasPackage/documents.ts`
- `tests/unit/schemasPackage/recordManifests.test.ts`
- `tests/unit/schemasPackage/phaseRecordManifestHistory.test.ts`
- `tests/type/schemasPackage.ts`
- `tests/unit/runRecord.test.ts`
- `tests/unit/authoringRecord.test.ts`
- `tests/integration/recordsExplain.test.ts`
- `tests/integration/writeAuthoringRecord.test.ts`
- `tests/integration/writeRecord.test.ts`

### Optional files that may be edited

- `packages/schemas/build/jsonSchemas.ts`
- `src/app/recordPlumbing.ts`
- `src/app/recordsList.ts`
- `src/app/recordsExplain.ts`
- `tests/integration/recordsSync.test.ts`
- `tests/integration/recordsPush.test.ts`
- `tests/integration/gitObjectPlumbing.test.ts`
- `tests/unit/schemasPackage/parseDocument.test.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/jsonSchemas.test.ts`

### Boundary contracts

Producer: the manifest file schemas, the file union and the bridge's `readRecordManifestFile`. Consumers: `recordsList` and `recordsExplain`, and third-party readers through the package's `parsePhaseRecordManifest`, `parseAuthoringRecordManifest`, `parseRecordManifest` and `parseDocument`.

### Test strategy

Write the `recordsExplain` integration cases first (pre-schema version 2, pre-schema authoring, and version 1 unsupported), against phase-06's code. Add bridge unit cases for the union reader, package history tests for `ac-history-read` and `ac-to-latest`, and type assertions.

### Implementation order

1. Legacy manifest integration cases.
2. Manifest file schemas, the union and the in-memory types, plus `assembleRecord`.
3. The bridge union step, the package formats, the exports and the JSON Schema union entry.
4. The writers.
5. `schemas-check --write`, then the test sweep.

### Excluded scope

- The record's timeline files (phase-08).
- The records branch layout, keys or push behaviour.
- Rewriting manifests already committed on a records branch.

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

Include:
- the manifest file schema, union and in-memory type names;
- how `recordsList` and `recordsExplain` report an unsupported manifest;
- any deviation from the planned file lists, with the reason.

### Commit subject

`feat(records): write $schema in record manifests`

### Commit body

Each record.json on phax/records/v1 now starts with $schema
(phase-record-manifest or authoring-record-manifest) and carries no
version. The in-memory manifests drop version; the authoring manifest
keeps kind 'authoring'.

records list and records explain keep reading through the bridge. The
version-2 phase manifests and the authoring manifests already on a
records branch still list. A version-1 phase manifest is reported as
older than the first release that writes $schema, and it is never
misread.

---

## phase-08 — Record timeline files write $schema {#phase-08-record-timeline}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

A phase's gate attribution, its file reconciliation, and each gate attempt's diagnostics and pending documents name their format and release. Phases written by 0.16.0 still resume, hand off and reconcile. The diagnostics protocol that gate steps print on stdout does not change.

### Detailed instructions

- Read the phase-07 handoff and follow its pattern. Use only made-up documents.
- Make the same change in each of the four modules (`gateAttribution.ts`, `reconciliation.ts`, `gateDiagnostics.ts`, `gatePending.ts`):
    - The in-memory type is unchanged: these formats never had `version`.
    - The file schema becomes `$schema` first, then the same fields, with effect's default excess option (unknown keys ignored, as today).
    - Add an encoder over the file value.

    For gate diagnostics, keep `GateDiagnosticsDocumentSchema`, `decodeGateDiagnosticsDocument`, `DIAGNOSTICS_EXPECTED_SHAPE` in `src/app/gates.ts` and the description in `src/schemas/phaxConfig.ts` unchanged: they are the stdout contract for gate-step authors.
- Change the writes so they encode `withSchemaUrl(<id>, value)`:
    - in `src/app/gates.ts`: the attribution writer, the pending-document writer and the diagnostics writer;
    - `src/app/reconcilePhaseFiles.ts`.
- In the bridge's `readGateAttributionFile` and `readPhaseFileReconciliationFile`, `fromCurrent` drops `$schema`, and `fromPreSchema` stays the identity.
- In `formats/recordTimeline.ts`:
    - the four `next` shapes use the file types;
    - `Latest*` stays phax's in-memory type;
    - `toLatest*` accepts either shape: the identity on `pre-schema`, and drop `$schema` on `next`;
    - update the header comment.

    In the package index, export the file schemas and types under the spec's names: `GateAttributionSchema`/`GateAttribution`, `PhaseFileReconciliationSchema`/`PhaseFileReconciliation`, `GateDiagnosticsSchema`/`GateDiagnostics` and `GatePendingSchema`/`GatePending`.
- Run `pnpm exec tsx scripts/schemas-check.ts --write`. It creates exactly the four `next.schema.json` files, and the pre-schema snapshots stay byte-identical.
- Tests:
    - `tests/integration/gates.test.ts`: the attribution, diagnostics and pending files start with `$schema` equal to `schemaUrl(<id>, <root version>)`, and a gate step's stdout without `$schema` is still accepted.
    - `tests/unit/gateAttribution.reader.test.ts`, `tests/integration/loadReviewHandoffInputs.test.ts` and `tests/integration/generateGlobalReconciliation.test.ts`: a made-up pre-schema attribution and reconciliation (no `$schema`, no `version`) still read.
    - `recordTimeline.test.ts` (`ac-record-files`): a hand-written record folder in the pre-schema shapes still parses as `pre-schema`, and the same folder written by phax parses as `next`, with the attempts in order.
    - Update the package documents, parity and the type test.

### Planned files to create

- `packages/schemas/snapshots/gate-attribution/next.schema.json`
- `packages/schemas/snapshots/phase-file-reconciliation/next.schema.json`
- `packages/schemas/snapshots/gate-diagnostics/next.schema.json`
- `packages/schemas/snapshots/gate-pending/next.schema.json`

### Planned files to edit

- `src/schemas/gateAttribution.ts`
- `src/schemas/reconciliation.ts`
- `src/schemas/gateDiagnostics.ts`
- `src/schemas/gatePending.ts`
- `src/schemas/persisted.ts`
- `src/app/gates.ts`
- `src/app/reconcilePhaseFiles.ts`
- `packages/schemas/src/formats/recordTimeline.ts`
- `packages/schemas/src/index.ts`
- `tests/unit/persisted.test.ts`
- `tests/unit/schemasPackage/documents.ts`
- `tests/unit/schemasPackage/recordTimeline.test.ts`
- `tests/type/schemasPackage.ts`
- `tests/integration/gates.test.ts`
- `tests/unit/gateAttribution.reader.test.ts`
- `tests/integration/generateGlobalReconciliation.test.ts`
- `tests/integration/loadReviewHandoffInputs.test.ts`

### Optional files that may be edited

- `src/schemas/phaxConfig.ts`
- `tests/unit/gateAttribution.test.ts`
- `tests/unit/schemas/gatePending.test.ts`
- `tests/unit/schemas/gateDiagnostics.test.ts`
- `tests/unit/schemas/reconciliation.test.ts`
- `tests/integration/writeRecord.test.ts`
- `tests/integration/reconciliation.test.ts`
- `tests/integration/reviewHandoff.test.ts`
- `tests/integration/fixLoop.test.ts`
- `tests/integration/executePlan.test.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/parseDocument.test.ts`

### Boundary contracts

Unchanged, facing the tool: the diagnostics document a gate step prints on stdout, and its expected-shape message. Producer: the four timeline file schemas and the bridge readers. Consumers: the gate runner (the writer); `writeRecord` and `readPhaseVerifiedSurfaces` (attribution); resume-from-handoff, the review handoff inputs and the global reconciliation (reconciliation).

### Test strategy

Write the legacy read cases first for attribution and reconciliation, then assert that the stdout contract is still accepted without `$schema`. Add bridge unit cases, and the package `ac-record-files` test over both hand-written pre-schema folders and phax-written ones.

### Implementation order

1. Legacy read tests and the stdout-contract test.
2. The four file schemas and encoders.
3. The bridge steps, the package formats and the exports.
4. The writers in `gates.ts` and `reconcilePhaseFiles.ts`.
5. `schemas-check --write`, then the test sweep.

### Excluded scope

- The gate-step stdout protocol and the `phax.json` gate configuration.
- The other files in a record folder (agent binding, model resolution, orient brief, security posture, transcripts): they are internal formats.
- The global reconciliation document (internal).

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

Include:
- the four file schema and encoder names;
- confirmation that the stdout diagnostics contract is unchanged;
- any deviation from the planned file lists, with the reason.

### Commit subject

`feat(records): write $schema in gate and reconciliation timeline files`

### Commit body

gate-attribution.json, file-reconciliation.json and each attempt's
.diagnostics.json and .pending.json now start with $schema. These files
never carried a version, so their in-memory types are unchanged. Only
the persisted file schemas gain $schema, and they still ignore unknown
keys.

The diagnostics document a gate step prints on stdout keeps its
contract.

Attribution and reconciliation files recorded by 0.16.0 are read
through their frozen pre-schema decoders, so those phases still resume,
review and reconcile.

---

## phase-09 — Every written document names its format and release {#phase-09-producer-check}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

This phase verifies from the outside in that every persisted file phax writes starts with `$schema` naming its format and the release, carries no `version`, and is identified by `parseDocument` from its content alone (`ac-producer`, `ac-identify-alone`). It also checks that phax's own reading of an older file matches what the package gives a third party.

### Detailed instructions

- Create `tests/integration/persistedProducer.test.ts` (`ac-producer`). Reuse the helpers of the existing integration tests (the in-memory or temporary-directory ports) to drive at least:
    - `createRunFolder`, which writes run status, phax-plan and the registry;
    - one dispatched transition, which writes run and phase status;
    - a plan approval and a spec approval;
    - a headless authoring session with the fake provider from `tests/integration/authorArtifact.test.ts`, which writes a sidecar and an authoring record;
    - `writeRecord` for a committed phase;
    - one gate run that writes attribution, diagnostics and pending documents, and a file reconciliation;
    - a compliance review with a fake agent.

    Collect every file written whose location maps to one of the 15 format ids, and check each one:
    - its first key is `$schema`, equal to `schemaUrl(<format id>, <root package.json version read in the test>)`;
    - it has no `version` key;
    - copied under a neutral name (for example `exports/<n>.json`), `parseDocument` returns its format id with shape `next`.

    Assert that the collected files cover all 15 format ids. If one writer is impractical to drive, cover it with its existing integration test and name it in the handoff.
- Create `tests/unit/schemasPackage/currentShapes.test.ts`. For every format id in `FORMAT_IDS`, check that:
    - the format definition's `current.name` is `next`;
    - its rendered JSON Schema lists `$schema` in `required`, with a pattern naming the format id, and has no `version` property;
    - `packages/schemas/snapshots/<id>/next.schema.json` exists and differs from `pre-schema.schema.json`;
    - `packages/schemas/history.lock.json` pins `src/schemas/history/<id>/pre-schema.ts`.
- In the same test, check that the bridge and the package agree. For every format phax reads back, the bridge reader's value on `preSchemaDocuments[id]` equals the package's `toLatest*` applied to its `parse*` value. Formats phax never reads (gate diagnostics, gate pending) are checked on the package side only. Tests may import both `src/` and `packages/`; only `src/` may not import `packages/`.
- Change no product code, unless a test exposes a writer that still emits `version` or omits `$schema`. If one does, fix that writer and record it in the handoff.
- Use only made-up values, and never read `~/.phax`.

### Planned files to create

- `tests/integration/persistedProducer.test.ts`
- `tests/unit/schemasPackage/currentShapes.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- `src/schemas/persisted.ts`
- `tests/unit/architecturalGuards.test.ts`
- `tests/unit/schemasPackage/parseDocument.test.ts`
- `tests/unit/schemasPackage/documents.ts`
- `tests/type/schemasPackage.ts`
- `tests/unit/persisted.test.ts`

### Test strategy

This phase is the outside-in verification: an integration test over the real writers with in-memory ports, and a package unit test over every format's definition, snapshots, lock entry and bridge agreement. Every assertion should already hold after phase-08, so a failure points to a writer that was missed.

### Implementation order

1. `currentShapes.test.ts`, including the bridge-agreement table.
2. `persistedProducer.test.ts`, one writer family at a time.

### Excluded scope

- Renaming `next` shapes or snapshots to a release, and anything in `scripts/release.sh` or the release workflow (plan 5).
- The README persisted-formats table and the §11 docs page (plan 5).
- The code-review document (headless-review spec).

### Verification

The `standard` gate profile in `phax.json`, including its terminal `pnpm build`, `pnpm deno:smoke` and `pnpm deno:smoke-binary` steps.

### Expected handoff content

Include:
- the list of writers the producer test drives, and any format covered elsewhere, with the reason;
- any writer fixed in this phase;
- any deviation from the planned file lists, with the reason;
- a summary for plan 5:
  - the 15 `next.schema.json` snapshots to rename at the release;
  - the `next` current shapes in `packages/schemas/src/formats/*.ts` to rename to the release;
  - `schemas-check --write` must run in the release commit, so `PACKAGE_VERSION`, `FIRST_SUPPORTED_RELEASE` and `src/schemas/release.ts` follow the bump.

### Commit subject

`test(schemas): check that every written document names its format and release`

### Commit body

Add an integration test that drives phax's writers through the
in-memory ports: run creation, a status transition, an approval, a
headless authoring session, a phase record and the gates. Every
persisted file it writes starts with $schema naming its format and the
root package.json release, carries no version, and is identified by
parseDocument from its content alone.

A package test pins every format's current shape: named next, $schema
required, no version, a next snapshot beside an untouched pre-schema
snapshot, and a frozen module under src/schemas/history/ pinned in
history.lock.json. It also checks that phax's bridge and the package's
toLatest agree on every pre-schema document.
