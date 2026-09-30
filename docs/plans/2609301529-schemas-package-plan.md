---
status: Draft
source-spec: docs/specs/2609241238-schemas-package.md
---
# schemas-package 4/5 — phax writes $schema

This is the fourth of the five plans that ship the `schemas-package` spec. Plans 1 to 3 (PR #104, #105, #108) built `@lbdremy/phax-schemas` under `packages/schemas/`. It has every format of spec §5 `formats`, `parseDocument`, a `toLatest` per format and one JSON Schema per format. It also has one committed `snapshots/<format id>/pre-schema.schema.json` per format, and the snapshot gate in `scripts/schemas-check.ts`, which runs through `pnpm test`. phax itself still writes `version` literals and no `$schema`, and every format's pre-schema slot in `packages/schemas/src/shapes.ts` is still unfilled.

This plan makes phax write `$schema: https://docs.phax.run/schemas/<format id>/<release>.json` as the first key of every persisted format, with the release taken from the root `package.json` and no `version` key. It also makes phax read its own older files through the package (q-own-legacy). A `~/.phax/registry.json`, a run's status files, the repository's approvals ledgers and the sidecars that 0.16.0 wrote must keep working, and they are rewritten with `$schema` the next time phax writes them.

The phases run in this order:

- phase-01 freezes each format's pre-schema shape inside the package before any shape changes.
- phase-02 adds the bridge, the one phax module that imports the package entry. It also adds the `$schema` field and stamping helpers, and widens the TypeScript root so `src/` can import the package.
- phase-03 to phase-08 change one family of formats each, in this order: the run registry; run and phase status; phax-plan and compliance review; the approvals ledgers and authoring sidecars; the record manifests; the record's timeline files. In each of these phases:
  - the persisted-file schema gains `$schema` and loses `version`;
  - the writers stamp `$schema`;
  - every read site goes through the bridge, which tries phax's current decoder first and then the package's frozen pre-schema decoder and `toLatest`;
  - `scripts/schemas-check.ts --write` records the change as `<format id>/next.schema.json`. The `pre-schema` snapshots never change.
- phase-09 checks every writer from end to end.

Contracts that face an agent or a tool do not change. These are:

- the spec and plan document schemas an authoring session emits (`phax artifact schema spec|plan`, the authoring prompt);
- the extracted-plan schema in the extraction prompt, and the extraction cache;
- the compliance verdict shape in the review prompt;
- the diagnostics document a gate step prints on stdout.

phax adds `$schema` and drops `version` only when it writes the persisted file.

Privacy: nothing from `~/.phax`, a records branch or another repository enters this repository. No phase reads `~/.phax`. Every test document is made up, or built by encoding a made-up value through a schema (spec requirement `synthetic-fixtures`). Closed PRs #106 and #107 are not revived. Other Approved specs (artifact-decide, headless-review, oracle-phases) will change some of these formats later; this plan implements none of their changes.

Spec coverage:

- Requirements delivered:
  - `schema-url` (§5.15).
  - `history-frozen` (§5.16): the frozen pre-schema modules, and phax reading its own older files through them.
  - `history-read` (§5.9): the pre-schema slot is filled. A document phax writes resolves to shape `next` until plan 5's release names it.
  - `pre-schema-unsupported` (§5.10): the message names the first supported release as soon as a released snapshot exists.
  - `identify-alone` (§5.12), on the documents phax writes.
- Acceptance criteria covered:
  - `ac-producer`;
  - `ac-own-legacy`;
  - `ac-history-read` (the released-shape case reads as `next` until plan 5);
  - `ac-to-latest`;
  - `ac-identify-alone` (shape `next` instead of `0.17.0` until plan 5);
  - both halves of `ac-history-frozen`.
- Kept satisfied: `parity`, `failure`, `to-latest`, `types`, `json-schema`, `json-build-fail`, `snapshot-gate`, `history-newer`, `synthetic-fixtures`, `package`, `dependencies`, `pure`, `formats`, `record-files` and `excluded`.
- Left to plan 5:
  - `release-names-shapes`: `release.sh` renames the `next` snapshots and the `next` current shapes to the release, then regenerates the generated index;
  - `lockstep`, `release`, `release-gate` and `bump`;
  - the tarball smoke;
  - the README persisted-formats table and the §11 docs page.
- `code-review` comes with the headless-review spec.

## Required commands

- `pnpm exec tsx`
- `pnpm build`
- `pnpm deno:smoke`
- `pnpm deno:smoke-binary`

Every required command is already allowed:

- `pnpm exec tsx` is in `security.agentCommands` in `phax.json`. The phases use it to run `scripts/schemas-check.ts --write`, which pins the frozen modules, regenerates the generated index and writes the `next` snapshots.
- `pnpm build`, `pnpm deno:smoke` and `pnpm deno:smoke-binary` are steps of the `standard` gate profile. phase-02 runs them itself because it changes the TypeScript output layout.

No security configuration change is needed.

## Technical arbitrations

- The first supported release has no committed constant. `scripts/schemas-check.ts` derives it as the lowest release-named snapshot (X.Y.Z) across `packages/schemas/snapshots/*/`, or null when there is none, and writes it into the generated index next to `PACKAGE_VERSION`; the gate checks it like the version. The unsupported message says 'older than phax <X>, the first supported release' once the value exists. Until then it says 'older than the first release that writes $schema'. Loss accepted: before plan 5's release commit renames the first `next` snapshots (to 0.17.0 after 0.16.0), the message carries no release number. A committed '0.17.0' would add a third version source, and it would be wrong if the next cut is not 0.17.0.
- `$schema` lives only at the file boundary. Each persisted format gets a file schema: `$schema` first, then the format's fields, and no `version`. The package exports that file schema and its type as the format's schema and type, as §5.19 requires. phax's in-memory type drops `version` and never carries `$schema`: writers stamp it, and the bridge strips it on read. Loss accepted: one type per format becomes two (the in-memory value and the file), and every test literal that sets `version` must be edited. Putting `$schema` into the in-memory type would instead make every constructor across app, infra and tests invent a URL.
- The `$schema` field accepts any X.Y.Z release of the format's own id (a pattern), not a literal of the running release. Loss accepted: phax's own current decoder does not reject a file that names a newer release; the package's parse functions do that for third-party readers. A release literal would force a new snapshot at every release, and it would reject files the previous release wrote in the same shape.
- phax takes the release it writes from the package's generated `PACKAGE_VERSION`. `schemas-check` writes it from the root `package.json` and the gate checks it. The package entry exports it, and the bridge re-exports it as `PHAX_RELEASE`. Loss accepted: one generated hop between `package.json` and the writer. Reading `package.json` at write time would put file I/O in every encoder and depend on the Deno binary's embedded file.
- phax now imports `packages/schemas/src`, so the root `tsconfig.json` and `tsconfig.build.json` widen `rootDir` from `./src` to `.`. The tsc output moves from `dist/cli/main.js` to `dist/src/cli/main.js`, the root `bin` follows it, and the two `import.meta.url` resolvers learn to find the package root from any layout. Loss accepted: the tsc `dist/` layout changes. The alternative, consuming the package as a built workspace dependency, would create a build cycle, because the package is built from phax's `src/schemas`.
- Contracts that face an agent or a tool keep their schemas: the spec and plan document with `version: 1`, the extracted plan and the extraction cache, the compliance verdict, and the gate diagnostics on stdout. Each persisted file is a separate file schema built from the same field set. Loss accepted: two schemas per such format, kept in step only because they share their fields.
- The bridge is `src/schemas/persisted.ts`. That location lets the domain (`src/domain/artifact/sidecar.ts`), app, infra and cli read sites all import it. Guards make it the only `src/` importer of the package entry and keep it out of the package closure, which would otherwise form a cycle. Loss accepted: `src/schemas/` gains one module that is not a schema declaration and is not published.
- Read sites move to the bridge in the same phase as their family's write change, not all together before the writes as the brief sketched. Until a family's shape changes, phax's current decoder and the frozen pre-schema decoder read the same shape. Moving the read sites earlier would ship a fallback that can never run, and would rewrite every adapter one phase later. Loss accepted: phase-02 ships the bridge with no consumer, proven only on toy formats until phase-03.
- Each frozen pre-schema module is a self-contained copy that imports only `effect`, including the sub-schemas it reaches (branch name, surface, provider id). Its rendered JSON Schema must equal the committed pre-schema snapshot, and that equality proves the copy is exact. Loss accepted: duplicated schema code that intentionally does not follow later edits to phax's shared modules.

---

## phase-01 — Freeze every format's pre-schema shape {#phase-01-freeze-pre-schema}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

Every package parse function reads a document without `$schema` through a frozen module that is exactly today's decoder, pinned by `history.lock.json`. phax's own decoder becomes the format's current shape, `next`, and is still unchanged. The unsupported message names the first supported release once one exists. This lands before any shape changes, so the frozen modules capture what 0.16.0 wrote.

### Detailed instructions

- Read these first: `packages/schemas/src/shapes.ts` (the two `FormatSpec` variants and the `defineFormat` resolution order in its JSDoc), `packages/schemas/src/formats/*.ts`, `packages/schemas/build/{generated,snapshots,jsonSchemas}.ts`, `scripts/schemas-check.ts`, `packages/schemas/snapshots/*/pre-schema.schema.json`, `tests/unit/schemasPackage/*` and `tests/type/schemasPackage.ts`. Do not touch `src/` in this phase.
- Never read `~/.phax`, a records branch or another repository, and never paste anything from them. Every test document is made up (run ids like `run-0001`, paths like `/work/example-repo`) or built by encoding a made-up value.
- Create one module per format id at `packages/schemas/src/history/<format id>/pre-schema.ts`, for all 15 ids in `FORMAT_IDS`. Each module is a verbatim, self-contained copy of the schema phax's decoder uses today, taken from the `src/schemas/*.ts` module the matching `formats/*.ts` imports. Copy every sub-schema it reaches: the branded branch name from `src/domain/branded.ts`, the surface from `src/schemas/surface.ts`, the provider id from `src/schemas/providerId.ts`, and the spec document's refinement with its `jsonSchema` annotation. Keep the same field order and the same annotations (identifier, title, description, jsonSchema), so the JSON Schema it renders is identical.
- Each frozen module imports only `effect`: never `src/`, never another package module, and never another history module. Its decoder uses the same excess-property option as phax's decoder today: `onExcessProperty: 'error'` for the strict formats, and effect's default for registry, run-status, phase-status and the four timeline formats. Mirror `EXCESS` in `build/jsonSchemas.ts`.
- Each frozen module exports exactly its schema, its type and an Either-returning decoder. Spell them after the format, for example `RegistryPreSchemaSchema`, `RegistryPreSchema` and `decodeRegistryPreSchema`. It opens with a comment saying it is the frozen pre-schema shape of `<format id>`, exactly what phax wrote before it wrote `$schema`, and that it must never be edited because `history.lock.json` pins it.
- Use no union of older shapes. The phase record manifest module is today's `version: 2` shape only, and the authoring manifest is today's shape only, with `sourceSha` optional as today.
- Write the modules already formatted in the repository's style: `.oxfmtrc.json` ignores `packages/schemas/src/history`, so `pnpm format` never touches them. Once they are final, run `pnpm exec tsx scripts/schemas-check.ts --write` to pin 15 entries in `packages/schemas/history.lock.json`. If you must change a module afterwards (before the commit only), delete its lock entry and re-run `--write`.
- Fill every format's slot with variant (b) of `FormatSpec`:
  - `preSchema: { schema, decode }` from the frozen module;
  - `releases: []`;
  - `current: { name: 'next', shape: <phax's own schema and decoder, unchanged> }`.

  Each shape map becomes `{ 'pre-schema': <frozen type>; next: <phax's type> }`, and each `*Shape` alias becomes `'pre-schema' | 'next'`. Each `toLatest*` accepts a value of either shape and returns the same `Latest*` as today (`Omit<X, 'version'>`, or the identity for the four timeline formats). No current schema changes, so every generated JSON Schema still equals its pre-schema snapshot, and `--write` must write no `next.schema.json`.
- In `defineFormat`, when a `$schema` document names the package's own release and the `next` decode fails, check for a release-named shape at or below that release. If there is none, return `next`'s own failure (its path and message) instead of 'no <id> shape is known at release <X>'. Otherwise a malformed document phax just wrote would lose its violation path. This matters for `ac-failure` once `validDocuments` carry `$schema`. Update the JSDoc resolution list to match.
- A document with `$schema` naming the package's own release (0.16.0) now decodes as `next`, where it used to fail. Update the tests that expected the failure at 0.16.0 (`parseDocument.test.ts`, `recordManifests.test.ts`, `runDirectoryFormats.test.ts`, `repositoryFormats.test.ts`, `recordTimeline.test.ts`):
  - derive the own release from `PACKAGE_VERSION`, so a version bump never breaks them;
  - keep the 'no <id> shape is known at release <X>' case on a lower release, for example 0.1.0.
- First supported release:
  - In `packages/schemas/build/snapshots.ts`, next to `latestReleased`, add a pure function that returns the lowest release-named snapshot (X.Y.Z) across every format directory, or null. `pre-schema` and `next` are not releases.
  - `renderGeneratedIndex` takes `{ packageVersion, firstSupportedRelease }` and also emits `export const FIRST_SUPPORTED_RELEASE: string | null = <value>;`.
  - `readSchemasState` computes the value from the snapshots it already reads. `checkSchemas` reports a stale generated index when either value differs, naming the `--write` command.
  - Run `--write`: the value is null today.
- In `shapes.ts`, `preSchemaUnsupportedMessage(label, violation, firstSupportedRelease)` returns:
  - when the release is known: `<label> older than phax <X>, the first supported release — not supported (<violation>)`;
  - when it is null: `<label> older than the first release that writes $schema — not supported (<violation>)`.

  `defineFormat` takes `firstSupportedRelease` in its options, defaulting to `FIRST_SUPPORTED_RELEASE` in the same way `packageVersion` defaults, so tests can inject both.
- In `tests/unit/schemasPackage/documents.ts`, add `preSchemaDocuments: { readonly [F in FormatId]: Doc }`. Build one made-up document per format by encoding a value typed as the frozen type through the frozen module's schema, not phax's, so these documents survive phax's shape change in later phases. Keep `validDocuments` built from phax's schemas. Extend `documents.test.ts` so that its no-real-data checks also cover `preSchemaDocuments`, and so that every `preSchemaDocuments` entry is accepted by its frozen decoder.
- Create `tests/unit/schemasPackage/preSchemaModules.test.ts`. For every format id:
  1. The frozen schema, rendered by `renderJsonSchemas` with the format's title (`phax <label>`) and excess, equals `packages/schemas/snapshots/<id>/pre-schema.schema.json` as parsed JSON.
  2. The format's `parse*` reads `preSchemaDocuments[id]` as `{ ok: true, shape: 'pre-schema' }`.
  3. The frozen decoder rejects hand-made rejects: a wrong type, a missing required key, and, for strict formats, one unknown key.
  4. The module's import specifiers are only `effect` or `effect/*`.
- In `frozenHistory.test.ts`, replace 'pins no frozen module yet' with a test that the lock has exactly the 15 entries `src/history/<id>/pre-schema.ts`, one for each `FORMAT_IDS` entry. `checkSchemas` on the committed tree must still return `[]`, and `--write` must still change nothing. Add a finding test for a stale `FIRST_SUPPORTED_RELEASE` in the generated index.
- In `shapes.test.ts` and `phaseRecordManifestHistory.test.ts`, the unsupported message now starts with '… older than the first release that writes $schema — not supported'. Add a toy case in `shapes.test.ts` with `firstSupportedRelease: '0.17.0'` injected that expects '… older than phax 0.17.0, the first supported release — not supported'. Add another case: a `$schema` document at the toy's own release that `next` rejects fails at the violation path.
- In `tests/type/schemasPackage.ts`:
  - every `*Shape` equals `'pre-schema' | 'next'`;
  - each `parse*` success value is the frozen type or phax's type;
  - each `toLatest*` accepts both types;
  - the package ⇄ phax type assignability for the exported schemas' types still holds.

  Keep the `FormatSpec` variant assertions.
- Leave `tests/unit/architecturalGuards.test.ts` alone unless it fails. The frozen modules import only `effect`, so the closure allowlist of `src/` modules does not change, and the no-historical-decoder guard stays.

### Planned files to create

- `packages/schemas/src/history/registry/pre-schema.ts`
- `packages/schemas/src/history/run-status/pre-schema.ts`
- `packages/schemas/src/history/phase-status/pre-schema.ts`
- `packages/schemas/src/history/phax-plan/pre-schema.ts`
- `packages/schemas/src/history/compliance-review/pre-schema.ts`
- `packages/schemas/src/history/plan-approvals/pre-schema.ts`
- `packages/schemas/src/history/spec-approvals/pre-schema.ts`
- `packages/schemas/src/history/phase-record-manifest/pre-schema.ts`
- `packages/schemas/src/history/authoring-record-manifest/pre-schema.ts`
- `packages/schemas/src/history/gate-attribution/pre-schema.ts`
- `packages/schemas/src/history/phase-file-reconciliation/pre-schema.ts`
- `packages/schemas/src/history/gate-diagnostics/pre-schema.ts`
- `packages/schemas/src/history/gate-pending/pre-schema.ts`
- `packages/schemas/src/history/spec-document/pre-schema.ts`
- `packages/schemas/src/history/plan-document/pre-schema.ts`
- `tests/unit/schemasPackage/preSchemaModules.test.ts`

### Planned files to edit

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
- `tests/type/schemasPackage.ts`

### Optional files that may be edited

- `packages/schemas/src/index.ts`
- `packages/schemas/src/document.ts`
- `packages/schemas/src/parsed.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/parse.test.ts`
- `tests/unit/schemasPackage/snapshots.test.ts`
- `tests/unit/schemasPackage/exports.test.ts`
- `tests/unit/schemasPackage/jsonSchemas.test.ts`
- `tests/unit/architecturalGuards.test.ts`
- `knip.json`

### Boundary contracts

Producer: `packages/schemas/src/history/<format id>/pre-schema.ts`, one per format. Each exports a schema, a type and a decoder for the exact shape phax wrote before `$schema`, and never changes after this phase. Consumers: the package's `formats/*.ts` (the `preSchema` slot), and from phase-02 on the bridge through the package's `parse*` and `toLatest*`. phax's `src/` never imports a history module. Producer: the generated index's `FIRST_SUPPORTED_RELEASE` (string or null), consumed by `defineFormat`'s unsupported message.

### Test strategy

Write `preSchemaModules.test.ts` before the modules, so the snapshot-equality assertion drives exact copies. Update the `frozenHistory.test.ts` lock expectation before running `--write`. All tests are unit tests over the package, using toy formats in `shapes.test.ts` and made-up documents. Type-level assertions live in `tests/type/schemasPackage.ts`.

### Implementation order

1. Write `preSchemaModules.test.ts`, then the 15 frozen modules, until their rendered JSON Schemas equal the snapshots.
2. Add the first-supported-release derivation, `renderGeneratedIndex` and the `checkSchemas` finding, plus their tests.
3. Update the unsupported message and `defineFormat` (the options and next's own failure), plus the `shapes.test.ts` cases.
4. Fill the slots in the four `formats/*.ts` files and widen `toLatest*`.
5. Add `preSchemaDocuments` and update the package unit tests and the type test.
6. Run `pnpm exec tsx scripts/schemas-check.ts --write` last and check that it pinned 15 lock entries and wrote no `next` snapshot.

### Excluded scope

- Any change under `src/`: phax still writes `version` and no `$schema`.
- Any change to a format's current schema, and any `next.schema.json`.
- The bridge, build layout and `$schema` helpers (phase-02).
- Renaming `next` to a release (plan 5).

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

The exported names of each frozen module. The final `FormatSpec` shape of one format as an example (`preSchema`, `releases: []`, `current: { name: 'next', … }`). The new `preSchemaUnsupportedMessage` signature and the `defineFormat` options. The name and location of the first-supported-release function and the generated `FIRST_SUPPORTED_RELEASE`. Note for plan 5: its release commit must run `schemas-check --write` after renaming the snapshots, so the generated index names the release. The `preSchemaDocuments` export. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(schemas): freeze every format's pre-schema shape`

### Commit body

Add one frozen module per persisted format under
packages/schemas/src/history/<format id>/pre-schema.ts. Each is a
self-contained copy of the decoder phax uses today and imports only
effect. history.lock.json pins all fifteen, and each module's rendered
JSON Schema equals its committed pre-schema snapshot.

Every format now fills its pre-schema slot: a document without $schema
is read only by the frozen module, and phax's own decoder becomes the
current shape, named next. No shape changes, so no next snapshot is
written.

The generated index also carries FIRST_SUPPORTED_RELEASE, derived from
the lowest release-named snapshot. The unsupported message names that
release once it exists; before that, it says 'older than the first
release that writes $schema'.

When next fails to decode a document at the package's own release and
no released shape covers it, parse now returns next's own violation
instead of 'no shape is known'.

---

## phase-02 — Bridge module, $schema helpers and build layout {#phase-02-bridge}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

phax gains one pure module, `src/schemas/persisted.ts`, that knows the release it writes, stamps `$schema` as a document's first key, and reads a persisted file with the current decoder first and then with the package's frozen pre-schema decoder and `toLatest`. It refuses unknown facts, and every failure names the file. The TypeScript root widens so that `src/` can import the package. No format changes yet.

### Detailed instructions

- Widen `rootDir` from `./src` to `.` in `tsconfig.json` and `tsconfig.build.json`. Keep `include: ['src/**/*']`: the package files come in through imports. The root `pnpm build` then emits `dist/src/…` and `dist/packages/schemas/src/…`, so update the root `package.json` `bin` to `./dist/src/cli/main.js`.
- Fix `readPackageVersion` (`src/cli/commands/usage.ts`) and the usage-spec path (`src/cli/commands/usageSpec.ts`) so they resolve from three places:
  - `src/cli/commands` (tsx);
  - `dist/src/cli/commands` (tsc);
  - `dist/release/bundle` (the Deno bundle; see the comment in `scripts/build-binaries.ts` on why it sits three directories deep).

  The smallest robust change is to walk up from the module's directory to the first directory that holds the file.
- After the build change, run `pnpm build`, `node dist/src/cli/main.js --version`, `pnpm deno:smoke` and `pnpm deno:smoke-binary`. If Deno cannot resolve `effect` from `packages/schemas/src/` once the bridge imports it, fix the resolution in `deno.json`, not in the package manifest.
- In `src/schemas/schemaUrl.ts`, add a field schema bound to one format id, for example `schemaUrlField(formatId)`. It is a `Schema.String` with a `Schema.pattern` accepting exactly `<SCHEMA_URL_BASE>/<that id>/<X.Y.Z>.json` (dots escaped, numeric triple as in `isRelease`), plus a description annotation naming the format. It must render to JSON Schema with no gap (`findJsonSchemaGaps` returns `[]`). The module now imports `effect`, which the closure allows; update its header comment.
- Export `PACKAGE_VERSION` from the package entry (`packages/schemas/src/index.ts`) with a doc comment: the phax release this package was built at. Update `tests/unit/schemasPackage/exports.test.ts`.
- Create `src/schemas/persisted.ts`. It is the only `src/` module that imports `packages/schemas/src/index.js`, and it imports nothing else under `packages/`. It is pure: no I/O and no Effect services, and callers pass the file path only so it can appear in messages. It exports:
  - `PHAX_RELEASE` (the package's `PACKAGE_VERSION`);
  - `persistedSchemaUrl(formatId)`, which is `schemaUrl(formatId, PHAX_RELEASE)`;
  - a stamp, for example `withSchemaUrl(formatId, value)`, that returns `{ $schema: persistedSchemaUrl(formatId), ...value }` with `$schema` as the first key;
  - a `PersistedReadError` value `{ _tag: 'PersistedReadError', file, format, message }`;
  - a generic `readPersisted`.
- `readPersisted` takes the raw JSON value and a spec: the format id and label, the file path, the current file decoder (Either), the package's `parse*` for that format and its `toLatest*`. It resolves in this order:
  1. If the current decoder accepts the value, return it with `$schema` removed.
  2. Otherwise call the package's `parse*`. It routes a `$schema` document by its URL and reads a document without `$schema` only with the frozen pre-schema module. On success, apply `toLatest*`.
  3. Walk the upgraded value (plain objects and arrays) for the first fact where `isUnknown` is true. If one exists, refuse with a message naming the file and the dotted path: phax's in-memory types admit no unknown, so any unknown fact is one phax needs.
  4. If both reads failed, fail with a message naming the file, the current decoder's first violation (`formatFirstViolation` from `src/schemas/formatError.ts`) and the package's message, for example 'older than the first release that writes $schema — not supported (…)'.
- Add no per-format readers in this phase: each family phase adds its own, for example `readRegistryFile`, when it changes that format.
- In `tests/unit/architecturalGuards.test.ts`:
  - Add a guard that no `src/` file other than `src/schemas/persisted.ts` has a module specifier resolving under `packages/`, and that the bridge's only such specifier is the package entry.
  - Add `src/schemas/persisted.ts` to `CLOSURE_FORBIDDEN_FILES`: the closure must never reach it, because that would form a cycle.
  - Add a guard driven by a list, for example `BRIDGE_ONLY_DECODERS` (empty in this phase): no `src/` module other than the bridge and the `src/schemas/*.ts` module that declares a listed decoder may reference its name. Include a self-test of the detector.

  Each family phase appends its file decoders to the list.
- Write `tests/unit/persisted.test.ts` over a toy format built with `defineFormat` (tests may import `packages/schemas/src/shapes.ts`): a frozen pre-schema toy with `version: 1`, and a `next` toy with the `schemaUrlField` of a real id. Cover:
  - the current decoder accepting a document, which returns the value without `$schema`;
  - a pre-schema document read through the fallback and upgraded by `toLatest`;
  - a `toLatest` that returns `UNKNOWN` at a nested key, which is refused with the file and the dotted path;
  - a document both decoders reject, whose failure names the file and both reasons;
  - a `$schema` document naming a newer release, whose failure carries the package's upgrade message;
  - the stamp: `Object.keys(result)[0] === '$schema'`, and the URL equals `schemaUrl(id, <root package.json version read in the test>)`;
  - `PHAX_RELEASE` equals the root `package.json` version.

  Nothing throws.

### Planned files to create

- `src/schemas/persisted.ts`
- `tests/unit/persisted.test.ts`

### Planned files to edit

- `tsconfig.json`
- `tsconfig.build.json`
- `package.json`
- `src/cli/commands/usage.ts`
- `src/cli/commands/usageSpec.ts`
- `src/schemas/schemaUrl.ts`
- `packages/schemas/src/index.ts`
- `tests/unit/architecturalGuards.test.ts`
- `tests/unit/schemaUrl.test.ts`
- `tests/unit/schemasPackage/exports.test.ts`

### Optional files that may be edited

- `tsconfig.test.json`
- `deno.json`
- `knip.json`
- `scripts/build-binaries.ts`
- `tests/type/schemasPackage.ts`
- `tests/integration/cliProgram.test.ts`
- `tests/integration/usageOutput.test.ts`
- `tests/unit/schemasPackage/manifest.test.ts`

### Boundary contracts

Producer: `src/schemas/persisted.ts`, pure, importable from domain, app, infra and cli. It provides:
- `PHAX_RELEASE`;
- `persistedSchemaUrl(formatId)`;
- the stamp `withSchemaUrl(formatId, value)`, which puts `$schema` first;
- `readPersisted(input, spec) → Either<Latest, PersistedReadError>`, where the error names the file and the failing fact or violation.

Consumers: the read and write sites migrated in phases 03 to 08. Producer: `schemaUrlField(formatId)` in `src/schemas/schemaUrl.ts`, consumed by each format's file schema. Producer: the package entry's `PACKAGE_VERSION`, consumed only by the bridge.

### Test strategy

Write `tests/unit/persisted.test.ts` and the new architectural guards first; they are the contract later phases rely on. Unit-test `schemaUrlField` in `tests/unit/schemaUrl.test.ts`. The build-layout change is verified by `pnpm build`, `pnpm deno:smoke` and `pnpm deno:smoke-binary`, run in this phase even though the gate runs them only at the end.

### Implementation order

1. Widen `rootDir`, fix `bin` and the two resolvers, then run `pnpm build`, the dist `--version` and the Deno smokes.
2. Add `schemaUrlField` and its tests.
3. Export `PACKAGE_VERSION` from the package entry.
4. Write the bridge tests, then `src/schemas/persisted.ts`.
5. Add the architectural guards.

### Excluded scope

- Any change to a persisted format's schema, writer or read site (phases 03 to 08).
- Per-format bridge readers.
- Anything in `packages/schemas/src/history/`.
- Release tooling and the npm manifests (plan 5).

### Verification

The `standard` gate profile in `phax.json`, plus `pnpm build`, `pnpm deno:smoke` and `pnpm deno:smoke-binary` run by the agent in this phase.

### Expected handoff content

The exact exports and signatures of `src/schemas/persisted.ts`, and the `schemaUrlField` name. The name of the bridge-only decoder list in `tests/unit/architecturalGuards.test.ts` and how a family phase appends to it. The new tsc output path and how the resolvers find the package root. Anything needed in `deno.json`. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(schemas): add the persisted-format bridge and $schema helpers`

### Commit body

Add src/schemas/persisted.ts, the only module in phax that imports the
schemas package entry. It exposes:
- PHAX_RELEASE, the root package.json version, via the package's
  generated index;
- a stamp that writes $schema as a document's first key;
- readPersisted, which reads a file with phax's current decoder first,
  then with the package's frozen pre-schema decoder and toLatest. It
  refuses a value with an unknown fact and names the file in every
  failure.

schemaUrl.ts gains the $schema field schema: a pattern bound to one
format id.

The root tsconfig rootDir widens to '.' so src/ can import
packages/schemas/src. The tsc output moves to dist/src/, the bin
follows, and the version and usage-spec resolvers find the package
root from any layout.

New guards: only the bridge imports the package, and the package
closure never reaches the bridge. A list of file decoders that only the
bridge may call starts empty.

---

## phase-03 — The run registry writes $schema {#phase-03-registry}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

`~/.phax/registry.json` names its format and release. An existing 0.16.0 registry keeps listing its runs through the package's pre-schema decoder and is rewritten with `$schema` on the next write (`ac-own-legacy`).

### Detailed instructions

- In `src/schemas/registry.ts`:
  - `Registry` (in memory) becomes `{ runs }`, with no `version`.
  - Add the persisted file schema `RegistryFileSchema = Schema.Struct({ $schema: schemaUrlField('registry'), runs })`, with `$schema` as the first property and effect's default excess option (unknown keys ignored, as today), plus `decodeRegistryFile` and `encodeRegistryFile`.
  - Delete `decodeRegistry`, so the compiler finds every read site. Keep `RegistryEntrySchema` unchanged.
- In the bridge, add `readRegistryFile(file, input): Either<Registry, PersistedReadError>`, built on `readPersisted` with `decodeRegistryFile`, the package's `parseRegistry` and `toLatestRegistry`. Append `decodeRegistryFile` to the bridge-only decoder list in `tests/unit/architecturalGuards.test.ts`.
- In the package's `formats/runDirectory.ts`, the registry's `next` shape becomes `{ schema: RegistryFileSchema, decode: decodeRegistryFile }`, and `RegistryShapes = { 'pre-schema': RegistryPreSchema; next: RegistryFile }`. `LatestRegistry` is phax's in-memory `Registry`. `toLatestRegistry` accepts either shape and drops `version` or `$schema`. In `packages/schemas/src/index.ts`, export the file schema and type as the package's `RegistrySchema` and `Registry`.
- Move every registry read site to `readRegistryFile`, keeping each site's error type and behaviour; the message is now the bridge's, which names the file. The sites are:
  - `src/app/registry.ts` `readRegistry` (used by `phax ls` and `phax records status`);
  - `src/cli/commands/run.ts` `readRegistrySync`;
  - `src/app/resolveRunRef.ts`.
- Change the writes. `src/app/registry.ts` `upsertRun` and `setRunStatus` write `encodeRegistryFile(withSchemaUrl('registry', { ...registry, runs }))`. Remove `REGISTRY_VERSION`; the empty registry is `{ runs: [] }` in `src/app/registry.ts` and `src/cli/commands/run.ts`.
- Run `pnpm exec tsx scripts/schemas-check.ts --write`. It must create exactly `packages/schemas/snapshots/registry/next.schema.json` and leave `registry/pre-schema.schema.json` byte-identical.
- Tests:
  - In `tests/integration/registry.test.ts` (`ac-own-legacy`):
    - Seed a made-up registry in the pre-schema shape (`{ version: 1, runs: [ … ] }`). `readRegistry` lists its runs. After `upsertRun`, the file on disk has `$schema` as its first key, equal to `schemaUrl('registry', <root version>)`, no `version`, and the original runs plus the new one.
    - A registry both decoders reject fails with a message naming the file.
  - In `tests/unit/persisted.test.ts`, add the `readRegistryFile` cases: a current file, a pre-schema file, and a rejected file.
  - Drop `version` from typed `Registry` literals in the other tests. A test that seeds a registry file on disk may keep the pre-schema shape (it now exercises the legacy path) or stamp it with `withSchemaUrl`.
  - In the package: `validDocuments.registry` is built through `RegistryFileSchema` from a stamped value. `runDirectoryFormats.test.ts` checks that a pre-schema registry reads as shape `pre-schema`, that a phax-written one reads as `next`, and that `toLatestRegistry` gives the same in-memory value both ways. Parity on file documents is kept, including that a registry with one unknown key is accepted by both. `parseDocument` on a phax-written registry returns format `registry` and shape `next` (`ac-identify-alone`).
  - In `tests/type/schemasPackage.ts`: `RegistryShape` is `'pre-schema' | 'next'`, the package's `Registry` is phax's `RegistryFile`, and `LatestRegistry` is phax's `Registry`.

### Planned files to create

- `packages/schemas/snapshots/registry/next.schema.json`

### Planned files to edit

- `src/schemas/registry.ts`
- `src/schemas/persisted.ts`
- `src/app/registry.ts`
- `src/app/resolveRunRef.ts`
- `src/cli/commands/run.ts`
- `packages/schemas/src/formats/runDirectory.ts`
- `packages/schemas/src/index.ts`
- `tests/unit/architecturalGuards.test.ts`
- `tests/unit/persisted.test.ts`
- `tests/integration/registry.test.ts`
- `tests/unit/schemasPackage/documents.ts`
- `tests/unit/schemasPackage/runDirectoryFormats.test.ts`
- `tests/type/schemasPackage.ts`

### Optional files that may be edited

- `src/app/archive.ts`
- `src/app/runFolder.ts`
- `src/app/effectRunner.ts`
- `src/cli/commands/ls.ts`
- `src/cli/commands/records.ts`
- `tests/unit/registryNamespace.test.ts`
- `tests/unit/resolveRunRef.test.ts`
- `tests/unit/cli/ls.test.ts`
- `tests/unit/schemas.test.ts`
- `tests/integration/archive.test.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/parseDocument.test.ts`
- `tests/unit/schemasPackage/parse.test.ts`
- `tests/unit/schemasPackage/jsonSchemas.test.ts`

### Boundary contracts

Producer: `src/schemas/registry.ts` provides `Registry` (in memory, with no `version` and no `$schema`), plus `RegistryFileSchema`, `decodeRegistryFile` (bridge only) and `encodeRegistryFile`. Producer: the bridge's `readRegistryFile(file, input)`. Consumers: `src/app/registry.ts`, `src/app/resolveRunRef.ts`, `src/cli/commands/run.ts`, and through them `phax ls`, `phax records status` and run creation.

### Test strategy

Write the `ac-own-legacy` integration case in `tests/integration/registry.test.ts` first, while the pre-schema registry still reads through the current decoder. Then change the schema and watch the fallback carry it. Add bridge unit cases, package unit tests and type assertions.

### Implementation order

1. Integration test for a 0.16.0 registry.
2. Registry file schema and in-memory type in `src/schemas/registry.ts`.
3. `readRegistryFile` in the bridge, and the guard list.
4. The package format and its exports.
5. Read sites, then writers.
6. `schemas-check --write`, then the test and type updates.

### Excluded scope

- Run and phase status (phase-04), and every other format.
- Rewriting a registry file that phax only reads.
- Any CLI output change.

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

The names `RegistryFileSchema`, `decodeRegistryFile`, `encodeRegistryFile` and `readRegistryFile`, and the pattern they set for later families (in-memory type, file schema, bridge reader, guard entry, package `next` shape, snapshot). Tests that still seed pre-schema registries on purpose. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(registry): write $schema in the run registry`

### Commit body

~/.phax/registry.json now starts with
$schema: https://docs.phax.run/schemas/registry/<release>.json and
carries no version. The in-memory Registry drops version; the new
registry file schema adds $schema and still ignores unknown keys.

Every registry read goes through the bridge: the current file decoder
first, then the package's frozen pre-schema decoder and
toLatestRegistry. A registry written by 0.16.0 therefore still lists
its runs, and it is rewritten with $schema on the next upsert.

The change is recorded as snapshots/registry/next.schema.json; the
pre-schema snapshot is untouched.

---

## phase-04 — Run and phase status write $schema {#phase-04-run-phase-status}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

A run's `run-status.json` and each phase's `status.json` name their format and release. A run directory written by 0.16.0 keeps working (`phax resume`, `phax enter`, review, reset, interrupts), and its files are rewritten with `$schema` on the next write.

### Detailed instructions

- In `src/schemas/status.ts`:
  - The in-memory `RunStatus` and `PhaseStatus` drop `version`.
  - Add `RunStatusFileSchema` and `PhaseStatusFileSchema`: `$schema` first (`schemaUrlField('run-status')` or `'phase-status'`), then the fields, with the default excess option as today.
  - Add `decodeRunStatusFile` and `decodePhaseStatusFile`, and delete `decodeRunStatus` and `decodePhaseStatus`.
  - Keep the encoder names `encodeRunStatus` and `encodePhaseStatus`, which now encode the file value. The single-status-writer guard matches these exact names, so do not rename them, and do not add them to any file outside that guard's allowlist.
- In the bridge, add `readRunStatusFile` and `readPhaseStatusFile` (`parseRunStatus`/`toLatestRunStatus`, `parsePhaseStatus`/`toLatestPhaseStatus`). Append both file decoders to the bridge-only decoder list.
- In `formats/runDirectory.ts`, the run-status and phase-status `next` shapes become the file schemas and decoders. `Latest*` is phax's in-memory type, and `toLatest*` accepts either shape and drops `version` or `$schema`. In `packages/schemas/src/index.ts`, export the file schemas and types as the package's `RunStatusSchema`, `RunStatus`, `PhaseStatusSchema` and `PhaseStatus`.
- Move every read site to the bridge, keeping each site's error handling:
  - run status: `src/app/effectRunner.ts:50`, `src/app/dispatcher.ts:47`, `src/app/gates.ts:354`, `src/app/resetPhase.ts:232`, `src/app/resolveRunInfo.ts:61`, `src/cli/commands/resume.ts:170`, `src/cli/interruptHandler.ts:42`;
  - phase status: `effectRunner.ts:66`, `dispatcher.ts:61`, `src/app/phaseStatusUpdates.ts:24`, `src/infra/providers/sessionWriter.ts:33`, `resolveRunInfo.ts:88`.
- Change every write so it produces a file value with `$schema` first and no `version`:
  - Writers that use the encoders: `effectRunner.ts:53` and `:69`, `gates.ts:361`, `phaseStatusUpdates.ts:32` and `sessionWriter.ts:40` call `encodeRunStatus(withSchemaUrl('run-status', value))` and the phase-status equivalent.
  - Writers that must not import the encoders (the single-writer guard): `src/app/runFolder.ts:52-65` `createRunFolder` and `src/app/phaseFolder.ts:37-49` `createPhaseFolder` write `JSON.stringify(withSchemaUrl(…, value), null, 2)`.
  - `src/app/resetPhase.ts` `clearRunStatusLastError` and `src/cli/interruptHandler.ts` `syncWriteInterruptedState` no longer spread the raw parsed object. They write `withSchemaUrl('run-status', <bridge-read value with the change applied>)`, still without the encoders.
  - Unknown keys that the ignore-excess decoder tolerated are dropped on these rewrites; this is accepted.
- Drop `version: 1` from the in-memory status literals in `src/` (for example `createRunFolder`, `createPhaseFolder` and any in `src/domain/state.ts`).
- Run `pnpm exec tsx scripts/schemas-check.ts --write`. It must create exactly the two `next.schema.json` files and leave both `pre-schema.schema.json` files byte-identical.
- Create `tests/integration/legacyRunFiles.test.ts` (`ac-own-legacy` for run files), using the in-memory ports the existing dispatcher and resume integration tests use. Seed a made-up run directory in the pre-schema shape (`run-status.json` and one `status.json`, both with `version: 1`). Check that:
  - the dispatcher's state read (`readPhaxState`) and `loadRunReviewInfo` read it;
  - after one dispatched transition, both files start with `$schema` equal to `schemaUrl(<id>, <root version>)`, carry no `version`, and keep every other field;
  - a status file both decoders reject fails with a message naming the file.
- Typed `RunStatus`/`PhaseStatus` literals across `tests/` (unit, integration and e2e, since `pnpm test:type` compiles them all) drop `version`. A test that seeds status files on disk may keep the pre-schema shape (it exercises the legacy path) or stamp them with `withSchemaUrl`. A test that asserts on written file content expects `$schema` and no `version`.
- Update the package tests: `validDocuments` for both formats are built from stamped values, `runDirectoryFormats.test.ts` covers both shapes and `toLatest`, and parity on file documents is kept. `ac-failure` still holds: `parseRunStatus(withKey(validDocuments['run-status'], 'state', 'paused'))` fails at `state`. In `tests/type/schemasPackage.ts`, both formats' package types are phax's file types and their `Latest*` types are phax's in-memory types.

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
- `src/app/dispatcher.ts`
- `src/app/gates.ts`
- `src/app/resetPhase.ts`
- `src/app/phaseStatusUpdates.ts`
- `src/app/resolveRunInfo.ts`
- `src/cli/commands/resume.ts`
- `src/cli/interruptHandler.ts`
- `src/infra/providers/sessionWriter.ts`
- `packages/schemas/src/formats/runDirectory.ts`
- `packages/schemas/src/index.ts`
- `tests/unit/architecturalGuards.test.ts`
- `tests/unit/persisted.test.ts`
- `tests/unit/schemasPackage/documents.ts`
- `tests/unit/schemasPackage/runDirectoryFormats.test.ts`
- `tests/type/schemasPackage.ts`
- `tests/unit/schemas.test.ts`
- `tests/unit/resolveRunInfo.test.ts`
- `tests/unit/phaseStatusUpdates.test.ts`
- `tests/integration/dispatcher.test.ts`
- `tests/integration/resetPhase.test.ts`

### Optional files that may be edited

- `src/domain/state.ts`
- `src/app/archive.ts`
- `tests/unit/state.test.ts`
- `tests/unit/resume.test.ts`
- `tests/unit/resolveRunRef.test.ts`
- `tests/unit/reviewHandoffContent.test.ts`
- `tests/unit/cli/enterPhase.test.ts`
- `tests/unit/cli/resume.test.ts`
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
- `tests/integration/runFolder.test.ts`
- `tests/e2e/resetPhase.test.ts`
- `tests/e2e/gateExhaustionResume.test.ts`
- `tests/e2e/semanticTrace.test.ts`
- `tests/e2e/semanticTrace.providers.test.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/parseDocument.test.ts`
- `tests/unit/schemasPackage/parse.test.ts`

### Boundary contracts

Producer: `src/schemas/status.ts` provides the in-memory `RunStatus` and `PhaseStatus`, `RunStatusFileSchema` and `PhaseStatusFileSchema`, `decode*File` (bridge only), and `encodeRunStatus`/`encodePhaseStatus` over the file value. Producer: the bridge's `readRunStatusFile` and `readPhaseStatusFile`. Consumers: the dispatcher, the effect runner, gates, reset, resume, run info, the SIGINT handler and the session writer.

### Test strategy

Write `tests/integration/legacyRunFiles.test.ts` first, against today's code, so it pins that 0.16.0 run directories keep working before the schema changes. Add bridge unit cases in `tests/unit/persisted.test.ts`. Keep the single-status-writer guard green without widening its allowlist. The package unit tests and type test follow.

### Implementation order

1. The legacy run-directory integration test.
2. The status file schemas, in-memory types and encoders.
3. The bridge readers and the guard list.
4. The package formats and exports.
5. Read sites, then writers (encoders first, then the guard-restricted writers).
6. `schemas-check --write`, then the test sweep.

### Excluded scope

- phax-plan.json and compliance-review.json (phase-05).
- Any change to `RunState`/`PhaseState` transitions or the dispatcher's logic.
- Widening `SINGLE_WRITER_ALLOWLIST` or `DOCUMENTED_METADATA_WRITERS`.

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

The status file schema, decoder and reader names. How the guard-restricted writers stamp `$schema`. Which tests keep pre-schema fixtures on purpose. Any unknown-key loss observed on rewrites. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(status): write $schema in run and phase status`

### Commit body

run-status.json and each phase's status.json now start with
$schema: https://docs.phax.run/schemas/<run-status|phase-status>/<release>.json
and carry no version. The in-memory RunStatus and PhaseStatus drop
version; the file schemas add $schema and still ignore unknown keys.

Every status read goes through the bridge, so a run directory written
by 0.16.0 still resumes, and its files are rewritten with $schema on
the next state change.

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

A run's `phax-plan.json` and `compliance-review.json` name their format and release. The extracted-plan contract, the extraction cache and the compliance verdict the agent emits stay exactly as they are. Existing 0.16.0 run directories still resume and review.

### Detailed instructions

- In `src/schemas/phaxPlan.ts`:
  - Keep `ExtractedPhaxPlanSchema` (`version: 1`), `getExtractedPlanJsonSchema` and `ExtractedPhaseFields` unchanged: they are the extraction contract and feed the extraction cache (`src/schemas/extractedPlanCacheEntry.ts`, which is also unchanged).
  - The in-memory `PhaxPlan` drops `version`.
  - Add `PhaxPlanFileSchema`: `$schema` first, then `run` and `phases`, with `onExcessProperty: 'error'` as today, plus `decodePhaxPlanFile` and an encoder. Delete `decodePhaxPlan`.
  - Point `getPhaxPlanJsonSchema` at the file schema, or delete it if nothing uses it.
- In `src/domain/plan/finalize.ts`, `finalizeExtractedPlan` stops copying `version` into the `PhaxPlan`. The deterministic parse (`src/domain/plan/parsePlanMarkdown.ts`) and `projectExtractedPlan` keep producing the extracted plan with `version: 1`.
- In `src/schemas/complianceReview.ts`:
  - Keep `ComplianceReviewSchema` and `decodeComplianceReview` as the agent verdict contract (`version: 1`, strict). `COMPLIANCE_REVIEW_JSON_SHAPE` in `src/domain/review/compliancePrompt.ts` must not change.
  - Add the in-memory review type without `version`, `ComplianceReviewFileSchema` (`$schema` first, the same fields, strict), `decodeComplianceReviewFile` and an encoder.
- In the bridge, add `readPhaxPlanFile` and `readComplianceReviewFile`, and append both file decoders to the bridge-only list. In `formats/runDirectory.ts`, both `next` shapes become the file schemas, `Latest*` is phax's in-memory type, and `toLatest*` accepts either shape. In the package index, export the file schemas and types as `PhaxPlanSchema`/`PhaxPlan` and `ComplianceReviewSchema`/`ComplianceReview`.
- Change the writes:
  - `src/app/runFolder.ts:47` writes the encoded `withSchemaUrl('phax-plan', plan)`.
  - `src/app/reviewCompliance.ts:319` stops copying the agent's raw text. It writes the file encoding of `withSchemaUrl('compliance-review', <decoded verdict without version>)` to `compliance-review.json`, and the review it returns is that same in-memory value.
- Move the reads to the bridge:
  - `src/app/loadPlan.ts:22`, used by `phax resume` and `phax validate --plan`;
  - `src/app/resolveRunInfo.ts:70`;
  - `src/app/reviewCode.ts:241`, the durable compliance file.

  `src/app/reviewCompliance.ts:299` keeps decoding the agent's `.phax-context` file with the unchanged verdict contract.
- The phase prompt embeds the in-memory plan (`src/app/promptGeneration.ts`), so its snapshot loses `"version": 1`. Update `tests/unit/__snapshots__/promptGeneration.test.ts.snap`, and make no other prompt change.
- Run `pnpm exec tsx scripts/schemas-check.ts --write`: it creates exactly the two `next.schema.json` files, and the pre-schema snapshots stay byte-identical.
- Tests:
  - `tests/integration/runFolder.test.ts`: `phax-plan.json` starts with `$schema` equal to `schemaUrl('phax-plan', <root version>)` and has no `version`.
  - `tests/integration/reviewCompliance.test.ts`: the durable `compliance-review.json` carries `$schema` and no `version`, while the agent's file stays in the `version: 1` contract.
  - `tests/integration/reviewCode.test.ts`: a made-up pre-schema `compliance-review.json` (`version: 1`) and a pre-schema `phax-plan.json` still load.
  - Typed `PhaxPlan` literals across `tests/` drop `version`. Typed `ExtractedPhaxPlan` literals and cache entries keep it.
  - Update the package tests and type test as in phase-04.

### Planned files to create

- `packages/schemas/snapshots/phax-plan/next.schema.json`
- `packages/schemas/snapshots/compliance-review/next.schema.json`

### Planned files to edit

- `src/schemas/phaxPlan.ts`
- `src/schemas/complianceReview.ts`
- `src/schemas/persisted.ts`
- `src/domain/plan/finalize.ts`
- `src/app/runFolder.ts`
- `src/app/loadPlan.ts`
- `src/app/resolveRunInfo.ts`
- `src/app/reviewCompliance.ts`
- `src/app/reviewCode.ts`
- `packages/schemas/src/formats/runDirectory.ts`
- `packages/schemas/src/index.ts`
- `tests/unit/architecturalGuards.test.ts`
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

- `src/domain/plan/parsePlanMarkdown.ts`
- `src/app/extractPlan.ts`
- `src/app/promptGeneration.ts`
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
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/parseDocument.test.ts`

### Boundary contracts

Unchanged, facing the agent: `ExtractedPhaxPlanSchema` and its prompt JSON Schema, the extraction cache entry, `ComplianceReviewSchema`/`decodeComplianceReview` and `COMPLIANCE_REVIEW_JSON_SHAPE`. Producer: `PhaxPlanFileSchema` and `ComplianceReviewFileSchema` (persisted), with the bridge's `readPhaxPlanFile` and `readComplianceReviewFile`. Consumers: `loadPlan` (resume, validate), `loadRunReviewInfo`, `prepareCodeReviewSession` and the phase prompt (in-memory plan).

### Test strategy

Write the integration cases for a pre-schema `phax-plan.json` and `compliance-review.json` first, so 0.16.0 run directories are pinned before the change. Add bridge unit cases. The prompt snapshot changes only by the removed `version` line. The package unit tests and type test follow.

### Implementation order

1. Integration tests for legacy plan and review files.
2. File schemas and in-memory types, keeping the agent contracts untouched.
3. `finalizeExtractedPlan`.
4. Bridge readers, guard list, package formats and exports.
5. Writers (`runFolder`, `reviewCompliance`), then read sites.
6. `schemas-check --write`, then the test sweep.

### Excluded scope

- The extraction prompt, the extracted-plan schema and the extraction cache format.
- The compliance prompt and its hand-written verdict shape.
- The spec and plan documents and the approvals (phase-06).

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

The file schema, decoder and reader names for both formats. Confirmation that the extraction prompt schema, the cache entry and the compliance prompt are unchanged. The in-memory type `reviewCompliance` now returns. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(run): write $schema in phax-plan.json and compliance-review.json`

### Commit body

A run's phax-plan.json and compliance-review.json now start with
$schema and carry no version.

The in-memory PhaxPlan drops version: finalizeExtractedPlan stops
copying it. The contracts that face an agent are unchanged: the
extracted plan and its prompt schema, the extraction cache and the
compliance verdict shape in the review prompt.

The compliance review is no longer copied verbatim from the agent's
file. phax decodes the verdict with its unchanged contract and writes
the persisted file with $schema.

Run-directory reads of both files go through the bridge, so plans and
reviews written by 0.16.0 still load (resume, validate --plan, review
code).

---

## phase-06 — Approvals ledgers and authoring sidecars write $schema {#phase-06-repository-files}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

The two approvals ledgers and every spec or plan document sidecar that phax writes name their format and release. The authoring contract an agent emits is unchanged, and the ledgers and sidecars that 0.16.0 committed (including this repository's own) keep working.

### Detailed instructions

- Approvals ledgers (`src/schemas/approvalRecord.ts`, `src/schemas/specApprovalRecord.ts`):
  - The in-memory ledger types drop `version`.
  - The persisted file schemas carry `$schema` first (`schemaUrlField('plan-approvals')` or `'spec-approvals'`), with `onExcessProperty: 'error'` as today. Keep or take a name ending in `File` for the file schema and decoder: `ApprovalRecordFileSchema`/`decodeApprovalRecordFile` already have one. If you rename the in-memory type, keep it distinct from the file type.
- In `src/app/approvalRecordStore.ts`:
  - `EMPTY_PLAN_STORE` and `EMPTY_SPEC_STORE` have no `version`.
  - `writePlanApprovalStore` and `writeSpecApprovalStore` encode `withSchemaUrl(<id>, ledger)`.
  - `readStoreFile` reads through the bridge (`readPlanApprovalsFile`, `readSpecApprovalsFile`), keeping the missing-file default.

  Do not hand-edit `docs/plans/approvals.json` or `docs/specs/approvals.json`: phax rewrites them at the next approval.
- Spec and plan documents (`src/schemas/specDocument.ts`, `src/schemas/planDocument.ts`):
  - Keep `SpecDocumentSchema`, `PlanDocumentSchema`, `decodeSpecDocument`, `decodePlanDocument`, `getSpecDocumentJsonSchema` and `getPlanDocumentJsonSchema` exactly as they are. They are the authoring contract (`version: 1`, `kind`) used by the authoring prompt, `phax artifact schema spec|plan` and `parseAuthoredDocument`.
  - Add the in-memory document types without `version`, and `SpecDocumentFileSchema`/`PlanDocumentFileSchema`: `$schema` first, the same fields and `kind`, strict. The spec file schema must keep the same refinement and `jsonSchema` annotation as the contract, so its JSON Schema renders with no gap.
  - Add `decodeSpecDocumentFile`/`decodePlanDocumentFile` and their encoders.
- In `src/app/authorArtifact.ts` `encodeDocument` (:193-199), every file phax writes that holds the document uses the file encoding of `withSchemaUrl(<id>, <document without version>)`: the repository sidecar (:282-285), the session folder's `document.json` (:262) and the copy handed to the authoring record (`src/app/writeAuthoringRecord.ts:26`). The document is still decoded from the agent with the contract decoder, and the extraction cache is still seeded with `projectExtractedPlan` from the contract value.
- `src/domain/artifact/sidecar.ts` `renderSidecar` reads through the bridge (`readSpecDocumentFile`, `readPlanDocumentFile`). An invalid sidecar keeps the `invalid` result with the bridge message. `renderSpecBody` and `renderPlanBody` take the in-memory document (no `version`), and the authoring path passes that same shape.
- In the bridge, add the four readers, and append the four file decoders to the bridge-only list. In `formats/repository.ts`, the four `next` shapes become the file schemas and `toLatest*` accepts either shape. In the package index, export the file schemas and types under the spec's names (`PlanApprovalsSchema`/`PlanApprovals`, `SpecApprovalsSchema`/`SpecApprovals`, `SpecDocumentSchema`/`SpecDocument`, `PlanDocumentSchema`/`PlanDocument`).
- Run `pnpm exec tsx scripts/schemas-check.ts --write`: it creates exactly the four `next.schema.json` files, and the pre-schema snapshots stay byte-identical.
- Tests:
  - `tests/integration/authorArtifact.test.ts`: the sidecar and the session `document.json` start with `$schema` and have no `version`, while the prompt's JSON Schema and `phax artifact schema` output are unchanged.
  - `tests/integration/artifactStatus.test.ts`: a made-up pre-schema sidecar (`version: 1`) beside its rendered body is `in-sync`, and a stamped one is too.
  - Approval store: a pre-schema ledger is read, and after a put the file has `$schema` and no `version` (`tests/unit/artifact/lineage.test.ts` or the store's existing test).
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
- `src/domain/artifact/sidecar.ts`
- `src/domain/authoring/renderSpec.ts`
- `src/domain/authoring/renderPlan.ts`
- `packages/schemas/src/formats/repository.ts`
- `packages/schemas/src/index.ts`
- `tests/unit/architecturalGuards.test.ts`
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

- `src/app/writeAuthoringRecord.ts`
- `src/app/artifactStatus.ts`
- `src/app/planStaleness.ts`
- `src/domain/artifact/lineage.ts`
- `src/cli/commands/artifact.ts`
- `tests/unit/renderSpec.test.ts`
- `tests/unit/renderPlan.test.ts`
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

Unchanged, facing the agent: `SpecDocumentSchema`, `PlanDocumentSchema`, their decoders and their JSON Schemas. Producer: the four file schemas and the bridge readers. Consumers: `approvalRecordStore` (approve, staleness, completion), `sidecarAgreement` (`artifact status`/`approve`/transitions) and the authoring session writer.

### Test strategy

Write the integration cases first for a pre-schema sidecar staying in sync and a pre-schema ledger being read. Assert that the authoring prompt's JSON Schema and `phax artifact schema` output do not change. Add bridge unit cases. The package unit tests and type test follow.

### Implementation order

1. Legacy sidecar and ledger tests.
2. File schemas and in-memory types, keeping the authoring contract untouched.
3. Bridge readers, guard list, package formats and exports.
4. Writers (approval store, `encodeDocument`), then readers (`readStoreFile`, `renderSidecar`, the renderers' parameter types).
5. `schemas-check --write`, then the test sweep.

### Excluded scope

- The authoring prompt, `phax artifact schema` output and the extraction cache.
- Rewriting the repository's committed ledgers or sidecars by hand.
- The authoring record manifest itself (phase-07).
- artifact-decide's ledger changes (another spec).

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

The four file schema, decoder and reader names. Confirmation that the authoring contract and its JSON Schema are byte-identical. The in-memory document type the renderers now take. Any deviation from the planned file lists, with the reason.

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
this repository, are read through the bridge. The ledgers are rewritten
with $schema at the next approval.

---

## phase-07 — Record manifests write $schema {#phase-07-record-manifests}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

Every `record.json` phax commits to `phax/records/v1` names its format and release. `phax records list` and `phax records explain` keep reading the manifests already on the branch, and report a version-1 phase manifest as unsupported instead of misreading it.

### Detailed instructions

- In `src/schemas/runRecord.ts`:
  - The in-memory `RunRecordManifest` drops `version`.
  - Add the persisted file schema (`$schema` first, `schemaUrlField('phase-record-manifest')`, the same fields, strict), its decoder ending in `File`, and `encodeRunRecordManifest` over the file value.
  - `src/domain/records/assemble.ts` `assembleRecord` stops setting `version: 2`.
  - `src/app/writeRecord.ts:113` encodes `withSchemaUrl('phase-record-manifest', manifest)`.
- In `src/schemas/authoringRecord.ts`:
  - The in-memory authoring manifest drops `version` and keeps `kind: 'authoring'`.
  - Add its file schema (`$schema` first, strict) and decoder.
  - The union `RecordManifestSchema` becomes the union of the two file schemas, with a union file decoder whose name ends in `File`.
  - `src/app/writeAuthoringRecord.ts:117` encodes `withSchemaUrl('authoring-record-manifest', manifest)`.
- In the bridge, add `readRecordManifestFile(file, input)`. It tries the current union decoder first. If that fails, it calls the package's `parseRecordManifest`, which routes by `$schema`, then by `kind: 'authoring'`, then as a phase manifest. It applies `toLatestPhaseRecordManifest` or `toLatestAuthoringRecordManifest` according to the returned format, then runs the unknown-fact check. Append the three file decoders to the bridge-only list.
- Move `src/app/recordsList.ts:105` and `src/app/recordsExplain.ts:263` to the bridge. Keep their current handling of an undecodable manifest (skip, warn or error, whatever they do today) and use the bridge message, which for a version-1 manifest says it is older than the first supported release.
- In `formats/recordManifests.ts`, both `next` shapes become the file schemas, `toLatest*` accepts either shape, and `parseRecordManifest` is unchanged. In the package index, export the file schemas and types as `PhaseRecordManifestSchema`/`PhaseRecordManifest`, `AuthoringRecordManifestSchema`/`AuthoringRecordManifest` and `RecordManifestSchema`/`RecordManifest`. `build/jsonSchemas.ts` renders the `record-manifest` union from `RecordManifestSchema`: make sure it is the file union.
- Run `pnpm exec tsx scripts/schemas-check.ts --write`: it creates exactly the two `next.schema.json` files, and the pre-schema snapshots stay byte-identical.
- Tests:
  - `tests/integration/writeRecord.test.ts` and `writeAuthoringRecord.test.ts`: the committed `record.json` starts with `$schema` equal to `schemaUrl(<id>, <root version>)` and has no `version`.
  - `tests/integration/recordsExplain.test.ts`: a made-up pre-schema (`version: 2`) phase manifest and a pre-schema authoring manifest committed to a temporary records branch still explain, and a made-up `version: 1` phase manifest is reported with the unsupported message.
  - `phaseRecordManifestHistory.test.ts` (`ac-history-read`, `ac-to-latest`):
    - a pre-schema manifest reads as `pre-schema`;
    - a phax-written one reads as `next`;
    - `versionOnePhaseRecordManifest` fails as older than the first release that writes `$schema`;
    - `toLatestPhaseRecordManifest` on the pre-schema manifest keeps every field it carried and invents no `sourceSha`.
  - `recordManifests.test.ts`: `parseDocument` identifies a phax-written manifest by `$schema` alone (`ac-identify-alone`).
  - Update the typed literals and the type test.

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
- `src/app/recordsList.ts`
- `src/app/recordsExplain.ts`
- `packages/schemas/src/formats/recordManifests.ts`
- `packages/schemas/src/index.ts`
- `tests/unit/architecturalGuards.test.ts`
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
- `tests/integration/recordsSync.test.ts`
- `tests/integration/recordsPush.test.ts`
- `tests/unit/schemasPackage/parseDocument.test.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/jsonSchemas.test.ts`

### Boundary contracts

Producer: the manifest file schemas, the union file decoder and the bridge's `readRecordManifestFile`. Consumers: `recordsList`, `recordsExplain`, and third-party readers through the package's `parsePhaseRecordManifest`, `parseAuthoringRecordManifest`, `parseRecordManifest` and `parseDocument`.

### Test strategy

Write the `recordsExplain` integration cases first (pre-schema v2, pre-schema authoring, and v1 unsupported) against today's code where they apply. Add bridge unit cases for the union reader, package history tests for `ac-history-read` and `ac-to-latest`, and type assertions.

### Implementation order

1. Legacy manifest integration cases.
2. Manifest file schemas, the union and the in-memory types, plus `assembleRecord`.
3. Bridge union reader, guard list, package formats, exports and the JSON Schema union entry.
4. Writers, then `recordsList`/`recordsExplain`.
5. `schemas-check --write`, then the test sweep.

### Excluded scope

- The record's timeline files (phase-08).
- The records branch layout, keys or push behaviour.
- Rewriting manifests already committed on a records branch.

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

The manifest file schema, union decoder and bridge reader names. How `recordsList`/`recordsExplain` report an unsupported manifest. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(records): write $schema in record manifests`

### Commit body

Each record.json on phax/records/v1 now starts with $schema
(phase-record-manifest or authoring-record-manifest) and carries no
version. The in-memory manifests drop version; the authoring manifest
keeps kind 'authoring'.

records list and records explain read manifests through the bridge:
the current file union first, then the package's parseRecordManifest
and the matching toLatest. The version-2 manifests already on the
records branch still list; a version-1 manifest is reported as older
than the first supported release.

---

## phase-08 — Record timeline files write $schema {#phase-08-record-timeline}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

A phase's gate attribution, file reconciliation, and each gate attempt's diagnostics and pending documents name their format and release. Phases written by 0.16.0 still resume, hand off and reconcile. The diagnostics protocol that gate steps print on stdout is unchanged.

### Detailed instructions

- For each of the four modules (`gateAttribution.ts`, `reconciliation.ts`, `gateDiagnostics.ts`, `gatePending.ts`):
  - The in-memory type is unchanged: these formats never had `version`.
  - Add the persisted file schema: `$schema` first, then the same fields, with effect's default excess option (unknown keys ignored, as today).
  - Add a decoder ending in `File`, and an encoder over the file value.

  For gate diagnostics, keep `GateDiagnosticsDocumentSchema`, `decodeGateDiagnosticsDocument`, `DIAGNOSTICS_EXPECTED_SHAPE` (`src/app/gates.ts:40-41`) and the description in `src/schemas/phaxConfig.ts:78` unchanged. They are the stdout contract for gate-step authors.
- Change the writes in `src/app/gates.ts` (`writeAttribution` :104-107, `writePendingDoc` :112-126, `failGate` :143-146) and `src/app/reconcilePhaseFiles.ts:62-66` to encode `withSchemaUrl(<id>, value)`.
- In the bridge, add `readGateAttributionFile` and `readPhaseFileReconciliationFile`. Add `readGateDiagnosticsFile` and `readGatePendingFile` too, even though phax reads neither file back today, so every persisted format has a bridge reader. Append the four file decoders to the bridge-only list.
- Move the read sites to the bridge:
  - attribution: `src/app/writeRecord.ts:144` and `src/app/gateAttribution.ts:25`;
  - reconciliation: `src/app/executePlan.ts:1235`, `src/app/loadReviewHandoffInputs.ts:113` and `src/app/generateGlobalReconciliation.ts:58`.

  `gates.ts:242` keeps decoding stdout with the unchanged contract.
- In `formats/recordTimeline.ts`, the four `next` shapes become the file schemas. `Latest*` stays phax's in-memory type, and `toLatest*` accepts either shape (the identity on pre-schema, dropping `$schema` on `next`). Update the header comment. In the package index, export the file schemas and types under the spec's names (`GateAttributionSchema`/`GateAttribution`, `PhaseFileReconciliationSchema`/`PhaseFileReconciliation`, `GateDiagnosticsSchema`/`GateDiagnostics`, `GatePendingSchema`/`GatePending`).
- Run `pnpm exec tsx scripts/schemas-check.ts --write`: it creates exactly the four `next.schema.json` files, and the pre-schema snapshots stay byte-identical.
- Tests:
  - `tests/integration/gates.test.ts`: the attribution, diagnostics and pending files start with `$schema` equal to `schemaUrl(<id>, <root version>)`, while a gate step's stdout without `$schema` is still accepted.
  - `tests/unit/gateAttribution.reader.test.ts`, `loadReviewHandoffInputs.test.ts` and `generateGlobalReconciliation.test.ts`: a made-up pre-schema attribution and reconciliation (no `$schema`, no `version`) still read.
  - `recordTimeline.test.ts` (`ac-record-files`): a hand-written record folder in pre-schema shapes still parses as `pre-schema`, and the same folder written by phax parses as `next`, with the attempts in order.
  - Update the package parity, documents and type test.

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
- `src/app/writeRecord.ts`
- `src/app/gateAttribution.ts`
- `src/app/executePlan.ts`
- `src/app/loadReviewHandoffInputs.ts`
- `src/app/generateGlobalReconciliation.ts`
- `packages/schemas/src/formats/recordTimeline.ts`
- `packages/schemas/src/index.ts`
- `tests/unit/architecturalGuards.test.ts`
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

Unchanged, facing the tool: the gate-step stdout diagnostics document and its expected-shape message. Producer: the four timeline file schemas and bridge readers. Consumers: the gate runner (writer), `writeRecord`/`readPhaseVerifiedSurfaces` (attribution), resume-from-handoff, the review handoff inputs and the global reconciliation (reconciliation).

### Test strategy

Write the legacy read cases first for attribution and reconciliation, then assert that the stdout contract is still accepted without `$schema`. Add bridge unit cases, and the package `ac-record-files` test over both hand-written pre-schema and phax-written folders.

### Implementation order

1. Legacy read tests and the stdout-contract test.
2. The four file schemas and encoders.
3. Bridge readers, guard list, package formats and exports.
4. Writers in `gates.ts` and `reconcilePhaseFiles.ts`, then the read sites.
5. `schemas-check --write`, then the test sweep.

### Excluded scope

- The gate-step stdout protocol and `phax.json` gate configuration.
- Other files in a record folder (agent binding, model resolution, orient brief, security posture, transcripts): internal formats.
- The global reconciliation document (internal).

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

The four file schema, decoder and reader names. Confirmation that the stdout diagnostics contract is unchanged. The final contents of the bridge-only decoder list. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(records): write $schema in gate and reconciliation timeline files`

### Commit body

gate-attribution.json, file-reconciliation.json and each attempt's
.diagnostics.json and .pending.json now start with $schema. These files
never carried a version, so their in-memory types are unchanged; only
the persisted file schemas gain $schema, and they still ignore unknown
keys.

The diagnostics document a gate step prints on stdout keeps its
contract.

Attribution and reconciliation reads go through the bridge, so phases
recorded by 0.16.0 still resume, review and reconcile.

---

## phase-09 — Every written document names its format and release {#phase-09-producer-check}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

This phase verifies from the outside in that every persisted file phax writes starts with `$schema` naming its format and the release, carries no `version`, and is identified by `parseDocument` from its content alone (`ac-producer`, `ac-identify-alone`). A mechanical check keeps the fifteen formats complete.

### Detailed instructions

- Create `tests/integration/persistedProducer.test.ts` (`ac-producer`). Using the in-memory or temporary-directory ports the existing integration tests use (reuse their helpers), drive at least:
  - `createRunFolder`, which writes run status, phax-plan and the registry;
  - one dispatched transition, which writes run and phase status;
  - a plan approval and a spec approval;
  - a headless authoring session with the fake provider from `tests/integration/authorArtifact.test.ts`, which writes a sidecar and an authoring record;
  - `writeRecord` for a committed phase;
  - one gate run that writes attribution, diagnostics and pending documents, and a file reconciliation.

  Collect every file written whose location maps to one of the 15 format ids. For each, assert that the first key is `$schema`, that it equals `schemaUrl(<format id>, <root package.json version read in the test>)`, and that there is no `version` key. Then copy each document's content under a neutral name (for example `exports/<n>.json`) and check that `parseDocument` returns its format id with shape `next`. Assert that together the collected files cover all 15 format ids. If one writer is impractical to drive, cover it with its existing integration test and name it in the handoff.
- Create `tests/unit/schemasPackage/currentShapes.test.ts`. For every format id in `FORMAT_IDS`:
  - the format definition's `current.name` is `next`;
  - its rendered JSON Schema has `$schema` in `required`, with a pattern naming the format id, and no `version` property;
  - `packages/schemas/snapshots/<id>/next.schema.json` exists and differs from `pre-schema.schema.json`;
  - `history.lock.json` pins `src/history/<id>/pre-schema.ts`.
- In `tests/unit/architecturalGuards.test.ts`, make the bridge-only decoder list a map keyed by format id (`{ readonly [F in FormatId]: ReadonlyArray<string> }`, or an equivalent that fails to compile when an id is missing). Each entry is non-empty. Keep the detector self-test.
- Change no product code unless a test exposes a writer that still emits `version` or omits `$schema`. If one does, fix that writer and record it in the handoff.
- Use only made-up values, and never read `~/.phax`.

### Planned files to create

- `tests/integration/persistedProducer.test.ts`
- `tests/unit/schemasPackage/currentShapes.test.ts`

### Planned files to edit

- `tests/unit/architecturalGuards.test.ts`

### Optional files that may be edited

- `src/schemas/persisted.ts`
- `tests/unit/schemasPackage/parseDocument.test.ts`
- `tests/unit/schemasPackage/documents.ts`
- `tests/type/schemasPackage.ts`
- `tests/unit/persisted.test.ts`

### Test strategy

This phase is the outside-in verification: an integration test over the real writers with in-memory ports, a package unit test over every format's definition and snapshots, and an architectural guard for completeness. Every assertion should already hold after phase-08, so a failure points to a writer that was missed.

### Implementation order

1. `currentShapes.test.ts`.
2. The guard completeness map.
3. `persistedProducer.test.ts`, one writer family at a time.

### Excluded scope

- Renaming `next` shapes or snapshots to a release, and anything in `scripts/release.sh` or the release workflow (plan 5).
- The README persisted-formats table and the §11 docs page (plan 5).
- The code-review document (headless-review spec).

### Verification

The `standard` gate profile in `phax.json`, including its terminal `pnpm build`, `pnpm deno:smoke` and `pnpm deno:smoke-binary` steps.

### Expected handoff content

The list of writers the producer test drives, and any format covered elsewhere with the reason. Any writer fixed in this phase. A summary for plan 5:
- the 15 `next.schema.json` snapshots to rename at the release;
- the `next` current shapes in `packages/schemas/src/formats/*.ts` to rename to the release;
- `schemas-check --write` must run in the release commit so `FIRST_SUPPORTED_RELEASE` and `PACKAGE_VERSION` update;
- the new tsc output path `dist/src/cli/main.js`.

Any deviation from the planned file lists, with the reason.

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
snapshot, and a frozen module pinned in history.lock.json.

The bridge-only decoder guard now requires an entry for every format
id.
