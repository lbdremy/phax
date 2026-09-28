---
status: Abandoned
source-spec: docs/specs/2609241238-schemas-package.md
---
# Schemas package

Publish phax's persisted-format decoders as a standalone npm package, `@lbdremy/phax-schemas`. It is built from the same `src/schemas` modules phax imports, has one entry for every format, and ships a `json/` directory with one draft-07 JSON Schema per format. It reads every shape phax has ever written. A legacy document is identified by its `version` literal. Every new document is identified by its `$schema` URL, `https://docs.phax.run/schemas/<format id>/<release>.json`, where the release is the root `package.json` version. An unreleased shape is recorded as `snapshots/<format id>/next.schema.json`, and `release.sh` renames it to the release it cuts. phax itself reads a file it wrote in an older shape through the package's frozen decoders and `toLatest`.

Phases, in the brief's order:

- phase-01 and phase-02: the package skeleton, the `Parsed` API for the shapes phax writes today, and the JSON Schemas.
- phase-03: the reading-history pattern on the phase record alone: frozen v1 and v2 decoders, the shape table, `toLatestPhaseRecord` and the newer-release failure.
- phase-04: the same pattern for every other format, including authoring record v1 with and without `sourceSha`.
- phase-05: `parseDocument`, which identifies a document by its `$schema` alone.
- phase-06: committed snapshots keyed by format and shape, and the snapshot gate.
- phase-07: the history-corpus script and the committed corpus, parsed in every gate, the release gate included.
- phase-08 and phase-09: phax reads each of its own persisted files through one bridge to the package, first building the bridge and then routing every read site through it.
- phase-10 to phase-13: phax writes `$schema` first and drops `version`, one group of formats per phase. The snapshot gate records each change as `next`.
- phase-14: the release workflow, the tarball smoke and `release.sh`.
- phase-15: the README persisted-formats table and "Read phax files from code".

Where each requirement lands:

- §5.1–5.7 and §5.19: phase-01.
- §5.20–5.21: phase-02.
- §5.8, §5.10 and §5.11: phase-03, extended to every format in phase-04. §5.12 is covered in phase-04.
- §5.9: phase-05. Its renamed-file criterion is completed in phase-12.
- §5.15: phase-06.
- §5.17–5.18: phase-07.
- §5.14: phase-03 (frozen and pinned modules), phase-08 and phase-09 (phax reads through the package), and phase-10 (the legacy-registry criterion).
- §5.13: phase-10 to phase-13.
- §5.16 and §5.22–5.25: phase-14.
- The README table: phase-15.
- §5.26 (the code-review document) is not implemented here. The headless-review plan adds it as one more format-registry entry.

What a phase agent can and cannot verify:

- phase-03, phase-04 and phase-07 read real history from the local clone of the records repository at `~/.phax/records/phax`.
- The tarball smoke (phase-14) needs `npm` and the network, so it runs only in CI and in the release workflow. Its first real run is the pull request's CI, and a human must confirm it.
- In this tree the root version stays `0.16.0` until `release.sh 0.17.0` runs. Every shape this plan introduces is therefore `next`, and documents written by the tree name `0.16.0`.

Files declared once here, outside the optional quota:

- Regenerated or extracted files: `pnpm-lock.yaml`; `packages/schemas/src/generated/index.ts` and `packages/schemas/history.lock.json`, both written only by `scripts/schemas-snapshots.ts --write`; snapshots written by `--write`; corpus documents under `packages/schemas/corpus/`.
- Fixture fallout: phase-10 to phase-13 update every test fixture of the formats they change. Each handoff lists those test files as fixture fallout.

Coordination: artifact-decide, headless-review and oracle-phases (all Approved) change formats this package exports. Their plans come after this one. Each records its change as a `next` shape through the snapshot gate, amending `next` by deleting and re-recording it until the release is cut. This plan implements none of their changes.

## Required commands

- `pnpm add`
- `pnpm exec tsx`
- `node`
- `git log`
- `git cat-file`
- `git ls-tree`

Every command above is already allowed by `security.agentCommands` in `phax.json`, so no configuration change is needed.

- `pnpm add` installs `ajv`, the draft-07 validator the JSON Schema tests use.
- `pnpm exec tsx` runs the new build, snapshot and corpus scripts.
- `node` extracts the phase-03 and phase-04 corpus seeds from the records clone, and checks `node dist/src/cli/main.js --version` in phase-08.
- `git log`, `git cat-file` and `git ls-tree` inspect history.

The tarball smoke needs `npm pack` and `npm install`. It runs only in CI and the release workflow, never in a phase agent.

## Technical arbitrations

- Build: a second tsc project over the same sources. `packages/schemas/tsconfig.build.json` sets rootDir to the repo root, includes only the entry, and sets `types: []`, so a `node:` import in the closure fails to compile. Loss accepted: the dist layout mirrors repo paths (`dist/packages/schemas/src/index.js`, `dist/src/schemas/*.js`). An esbuild bundle was rejected: its declarations would no longer be tsc's own output for phax's types.
- Package location: `packages/schemas/`, kept outside the pnpm workspace, driven by root scripts, with `effect` resolved from the root install. Loss accepted: pnpm never installs or checks the package's own dependency list. A unit test pins that list to exactly `effect` at the root range.
- How phax imports the package (q-own-legacy): one bridge module, `src/schemas/ownFormats.ts`, imports the package entry, and a guard forbids every other `src/` import from `packages/`. To allow this, phax's tsconfig rootDir becomes the repo root and `bin` moves to `dist/src/cli/main.js`. The three depth-relative lookups (`package.json`, `phax.usage.kdl`, `.claude/skills`) now resolve through a walk-up helper. Loss accepted: phax's dist layout changes. Rejected: putting the package sources under `src/`, which would place the historical decoders in phax's `src/`, against Q13 and the "phax imports only the current decoder" criterion. Also rejected: linking the built package, which would make typecheck and tests depend on a prior build and see stale schemas.
- Release version (q-release-name): phax and the package take the root `package.json` version from a generated module, `packages/schemas/src/generated/index.ts`. It holds `PACKAGE_VERSION` and each format's current shape name, read from the snapshot file names. Only `scripts/schemas-snapshots.ts` writes it; the gate fails when it differs from `package.json` or from the snapshots; `release.sh` regenerates it in the release commit. It is a derived mirror, never edited by hand, not a second version source. Loss accepted: the version appears in one more committed file. Rejected: a runtime read threaded as an Effect service through about 40 reader and writer sites and every test layer. Also rejected: a JSON import, which prints an ExperimentalWarning on Node 20 for package consumers.
- Development trees: suppose a format has a `next` shape and a document names exactly the package's own version. That document is decoded by `next` first, then by the latest released shape at or before that version. A published package never has a `next` shape, so the rule is inert there. Loss accepted: in development only, two shapes are tried for one release. Without the rule, parity with what phax writes, and phax's own reads, would break in every development cycle.
- phax reading its own files (q-own-legacy): each `readOwn<Format>` tries phax's current decoder. If that fails, it calls the package's parse and `toLatest`, then decodes the upgraded value again with phax's current decoder. The identification markers (`version`, `$schema`) are writer marks, not facts: `readOwn` sets them to what phax writes. Any other `{ kind: "unknown" }` refuses, naming the file and the fact's path. Loss accepted: an in-memory value read from an older file names the reading release until phax rewrites it.
- Frozen twins: while phax still writes a legacy literal, the package decodes that literal with phax's own decoder (the no-copied-schema constraint). Its frozen twin is created early and proven faithful by snapshot equality and corpus decoding. The twin takes over when the format's current shape becomes `next`. Loss accepted: each twin sits unused for a few phases.
- Parse results: success is a union over shapes, each pairing its shape id with its exact value type, and assignable to the normative `Parsed<T>`. `parseDocument` and `parseRecordManifest` also return `format`. Shape ids are `v<N>`, a release string, or `next` in a development tree. The current shape's type keeps the unsuffixed name (`PhaseRecord`); only a frozen shape gets a suffixed name (`PhaseRecordV1`, `PhaseRecord_0_17_0`). Loss accepted: `PhaseRecord` changes meaning at the release that supersedes its shape. A failure's `path` is a dotted string, following the normative `Parsed` shape rather than the array in the §6 history example.
- The unknown marker is `{ kind: "unknown" }`, exported as `Unknown`, `UNKNOWN` and `isUnknown`. `Latest<Format>` types carry no `version` and type `$schema` as `string | Unknown`. Loss accepted: an upgraded value does not say which shape it came from; the parse result's `shape` does.
- Agent-facing contracts stay unchanged: the authored spec and plan document schemas, the extracted-plan schema and the compliance verdict stay at version 1. phax adds `$schema` and drops `version` only when it writes the persisted file. Loss accepted: two schemas per agent-produced format (authored and persisted) must stay in step.
- Snapshots are never overwritten automatically: `--write` creates missing snapshots only. Amending the unreleased `next` means deleting it and recording it again, which shows in review. Released snapshots and frozen modules are pinned by sha256 in `packages/schemas/history.lock.json`. Loss accepted: amending `next` takes two steps.
- Shipped JSON Schemas describe the latest shape only; the per-shape snapshots are not shipped. Loss accepted: a docs pipeline cannot validate an older document from the installed package. Serving each release's schema at docs.phax.run is the docs pipeline's job.
- `SurfaceSchema` moves from `phaxConfig.ts` to `src/schemas/surface.ts`, so the published closure excludes phax.json's config schemas. Loss accepted: one more module. Importers are updated directly, with no re-export shim.
- Corpus source (§10 open): a required `--records <path>` argument names a git repository holding `phax/records/v1` (for phax, `~/.phax/records/phax`). Ledgers and sidecars come from `--repo`, which defaults to the current directory. Loss accepted: the script does not follow the records destination in `phax.json`, so the caller names the clone.
- Parity corpus (§10 open): inline accept and reject cases in one test, each run through both decoders, plus the committed history corpus. Loss accepted: no reusable fixture files for tools outside the repo.
- Tarball install smoke (§10 open): runs in the release workflow and in CI, not in `pnpm check:full` or the phax gate. Loss accepted: a green local gate does not prove that the packed tarball installs.
- Spellings (§10 open):
    - URL: `https://docs.phax.run/schemas/<format id>/<release>.json`, as in the spec;
    - JSON Schema files: `json/<format id>.schema.json`, plus `json/record-manifest.schema.json` for the union;
    - frozen modules: `packages/schemas/src/history/<format id>/<shape>.ts`;
    - snapshots: `packages/schemas/snapshots/<format id>/<shape>.schema.json`;
    - corpus: `packages/schemas/corpus/<format id>/<shape>/<hash16>.json`.
- P3 is not applied. The spec shows its surface, but the oracle phase kind ships with the oracle-phases spec, which is planned after this one. Each phase writes its tests first instead. Loss accepted: the implementing agent can edit its own tests.
- P5: the fixture fallout of phase-10 to phase-13 is not enumerated per file. Those test files show as unplanned edits, and the handoff lists them as fixture fallout. Loss accepted: noisier reconciliation for four phases.

---

## phase-01 — Package skeleton, one entry, Parsed API {#phase-01-package-skeleton}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

A standalone `@lbdremy/phax-schemas` package exists in the repo and is built from phax's own `src/schemas` modules. Its single entry exports, for every persisted format, a schema, a type and a parse function that returns `Parsed`, for the shape phax writes today. Its accept or reject verdict is phax's own decoder's.

### Detailed instructions

- Move `SurfaceSchema` and its `Surface` type from `src/schemas/phaxConfig.ts` to a new `src/schemas/surface.ts`. Update `phaxConfig.ts`, `runRecord.ts`, `gateAttribution.ts` and any other importer tsc reports. Add no re-export in `phaxConfig.ts` (no shim). No schema changes shape.
- Create `packages/schemas/package.json`:
    - `name` `@lbdremy/phax-schemas`; `version` equal to the root `package.json` version (`0.16.0`);
    - `type` `module`, `license` `Apache-2.0`, `engines.node` `>=20`;
    - `dependencies` exactly `{ "effect": <the root range> }`; `files` `["dist", "json"]`;
    - `exports`: `.` as `{ types, default }` pointing at the tsc output (expected: `./dist/packages/schemas/src/index.d.ts` and `.js`; confirm after building), and `"./json/*": "./json/*"`.
    No scripts, no devDependencies. Do not add the package to `pnpm-workspace.yaml`.
- Create `packages/schemas/tsconfig.build.json`, extending `../../tsconfig.json`:
    - `rootDir` `../..`, `outDir` `./dist`, `include` exactly `["src/index.ts"]`;
    - `types` `[]` and lib ES2023, so a `node:` import anywhere in the closure fails to compile;
    - `declaration` true; `declarationMap` and `sourceMap` false.
- Create `packages/schemas/src/parsed.ts`. It exports `Parsed<T>` exactly as spec §6 gives it: `{ ok: true; value } | { ok: false; error: { path: string; message: string } }`, all readonly. It also exports `fromEither`, which maps an `Either<T, ParseError>` to `Parsed<T>` using `ParseResult.ArrayFormatter`: `path` is the first issue's path joined with `.` (`""` at the root), and `message` is that issue's message. `fromEither` never throws.
- Create `packages/schemas/src/index.ts`, the only entry. For each format it exports a schema constant, a type and a parse function:
    - `RegistrySchema`, `Registry`, `parseRegistry`;
    - `RunStatusSchema`, `RunStatus`, `parseRunStatus`;
    - `PhaseStatusSchema`, `PhaseStatus`, `parsePhaseStatus`;
    - `PhaxPlanSchema`, `PhaxPlan`, `parsePhaxPlan`;
    - `ComplianceReviewSchema`, `ComplianceReview`, `parseComplianceReview`;
    - `PlanApprovalsSchema` and `PlanApprovals` (phax's `ApprovalRecordFileSchema`), `parsePlanApprovals`;
    - `SpecApprovalsSchema`, `SpecApprovals`, `parseSpecApprovals`;
    - `PhaseRecordSchema` and `PhaseRecord` (phax's `RunRecordManifestSchema`), `parsePhaseRecord`;
    - `SpecDocumentSchema`, `SpecDocument`, `parseSpecDocument`;
    - `PlanDocumentSchema`, `PlanDocument`, `parsePlanDocument`;
    - `AuthoringRecordSchema` and `AuthoringRecord` (phax's `AuthoringRecordManifestSchema`), `parseAuthoringRecord`;
    - `RecordManifestSchema`, `RecordManifest`, `parseRecordManifest`;
    - `type Parsed`.
    Each parse function is `(input: unknown) => fromEither(phaxDecodeX(input))` over phax's existing `decodeX` from `src/schemas`. The schema and its `onExcessProperty` setting are therefore phax's own. Never re-declare a schema or a decode option in the package. If a format has no exported decoder, export phax's existing one from its module.
- Change the root `build` script to `tsc -p tsconfig.build.json && tsc -p packages/schemas/tsconfig.build.json`. Add `packages/schemas/src/**/*` to the `include` of `tsconfig.test.json`.
- In `knip.json`, add `packages/schemas/src/index.ts` to `entry` and `packages/schemas/src/**/*.ts` to `project`. Keep knip green in every later phase by adding an export only in the phase that first uses it.
- Add `describe("architectural guard: schemas package closure")` to `tests/unit/architecturalGuards.test.ts`. It resolves relative imports transitively from the entry (mapping `.js` specifiers to `.ts`) and asserts that:
    - every reached file is under `packages/schemas/src/`, `src/schemas/` or `src/domain/`, and none is under `src/app/`, `src/ports/`, `src/infra/` or `src/cli/`;
    - no reached file imports `node:*`, `fs`, `child_process`, `net`, `os`, `path` or `@effect/platform*`, or references `Deno`;
    - the only bare specifiers are `effect` and `effect/*`;
    - `src/schemas/vibeOutput.ts` and `src/schemas/phaxConfig.ts` are not reached.
    Reuse the file's existing source-walking helpers.
- Do not change the CLI, any phax decoder or any persisted shape.

### Planned files to create

- `packages/schemas/package.json`
- `packages/schemas/tsconfig.build.json`
- `packages/schemas/src/index.ts`
- `packages/schemas/src/parsed.ts`
- `src/schemas/surface.ts`
- `tests/unit/schemasPackage/exports.test.ts`
- `tests/unit/schemasPackage/parse.test.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/manifest.test.ts`
- `tests/type/schemasPackage.ts`

### Planned files to edit

- `src/schemas/phaxConfig.ts`
- `src/schemas/runRecord.ts`
- `src/schemas/gateAttribution.ts`
- `package.json`
- `knip.json`
- `tsconfig.test.json`
- `tests/unit/architecturalGuards.test.ts`

### Optional files that may be edited

- `src/schemas/phaxPlan.ts`
- `src/schemas/specApprovalRecord.ts`
- `.oxlintrc.json`

### Boundary contracts

Producer: phax's `src/schemas` modules own each format's schema and its `decodeX`, with its `onExcessProperty` setting. Consumer: the package entry, which re-exports those schemas and types and wraps those decoders into `Parsed`. Contract: the package never declares a schema or a decode option for a shape phax writes; parity holds by construction, and the parity test keeps it. Outside consumer: a Node 20+ ESM program importing `@lbdremy/phax-schemas`, using the shapes and spellings of spec §6.

### Test strategy

Write these first:

- `parse.test.ts`: a valid run status returns `ok: true` with the value. A run status with state `paused` returns `ok: false`, with `error.path` `state` and a non-empty message, and nothing throws. A non-object input fails.
- `parity.test.ts`: for each format, inline accepted and rejected cases, each run through phax's `decodeX` and the package's `parseX`; the verdicts must agree. It includes the acceptance cases: a phase record with one unknown key is rejected by both, and a registry with one unknown key is accepted by both.
- `exports.test.ts`: the entry's runtime export names equal the exact expected set, and the package has no other entry.
- `manifest.test.ts`: name, the single `effect` dependency at the root range, the version equal to the root version, the exports keys and `files`.
- `tests/type/schemasPackage.ts`: for each format, the package type is assignable to phax's internal type and the reverse (§5.19).

The closure guard runs in `pnpm audit:architecture`.

### Implementation order

1. Move SurfaceSchema and update its importers.
2. parsed.ts and its test.
3. The entry, then the parity, exports and type tests.
4. The manifest and build tsconfig, the root build script, tsconfig.test.json and knip.json.
5. The closure guard; run pnpm build and confirm the emitted paths match the exports map.

### Excluded scope

- JSON Schema files (phase-02).
- Historical shapes, toLatest and the newer-release failure (phase-03, phase-04).
- parseDocument (phase-05), snapshots (phase-06) and the corpus (phase-07).
- Writing `$schema` (phase-10 to phase-13), the release (phase-14) and the README (phase-15).
- The code-review document (added by the headless-review plan).

### Verification

The `standard` gate profile in `phax.json`. Run `pnpm build`, a gate command, to confirm that the package compiles.

### Expected handoff content

Record:
- the emitted dist paths and the final `exports` map;
- the entry's export names, and the phax decoder each parse function wraps, including any decoder you had to export;
- the closure guard's describe name and the files it reached;
- the `SurfaceSchema` move and its importers;
- any deviation from the planned file lists, with the reason.

### Commit subject

`feat(schemas-package): add @lbdremy/phax-schemas with one entry and a Parsed API`

### Commit body

Add the schemas package under packages/schemas. A second tsc project builds it from the entry module alone, so tsc emits only that module's import closure. The entry exports a schema, a type and a parse function for each persisted format: run registry, run status, phase status, phax-plan, compliance review, both approvals ledgers, phase record, spec and plan documents, authoring record and the record-manifest union. Each parse function wraps phax's own decoder and returns a Parsed result instead of throwing.

SurfaceSchema moves to src/schemas/surface.ts, so the published closure no longer reaches phax.json's config schemas. An architectural guard pins the closure: no app, ports, infra or cli file, no Node or Deno I/O, and neither vibeOutput.ts nor phaxConfig.ts.

---

## phase-02 — One draft-07 JSON Schema per format, build fails on a gap {#phase-02-json-schemas}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

Building the package produces one draft-07 JSON Schema file per exported format, generated from the same schema its parse function uses. The build fails, naming the format, when a schema cannot be rendered.

### Detailed instructions

- Create `packages/schemas/build/formats.ts`, the format registry. The build, the snapshot gate, the corpus script and the README test all read it. Each exported format has one readonly entry `{ id, label, title, schema }`, where `schema` is imported from the package entry, never from `src/schemas` directly. The ids are `registry`, `run-status`, `phase-status`, `phax-plan`, `compliance-review`, `plan-approvals`, `spec-approvals`, `phase-record`, `spec-document`, `plan-document`, `authoring-record` and the derived `record-manifest`. Labels are human names such as `phase record`; titles are such as `phax run status`.
- Create `packages/schemas/build/jsonSchemas.ts` exporting a pure `renderFormatJsonSchemas(formats)`. For each format it calls `JSONSchema.make(schema)` (Effect v3, draft-07) inside try/catch:
    - a throw becomes a failure `{ id, label, message }`;
    - otherwise the output is the rendered object, plus the registry `title` when the render has none.
    The function returns every file when all formats render, and otherwise the failures and no files.
- Create `scripts/build-schemas-package.ts`, with its logic exported behind a main guard:
    - on any failure it prints `✗ <label>: <message>` per failed format, writes nothing and exits 1;
    - otherwise it empties `packages/schemas/json/` and writes each `<id>.schema.json` as two-space JSON with a trailing newline.
- Change the root `build` script to `tsc -p tsconfig.build.json && tsc -p packages/schemas/tsconfig.build.json && tsx scripts/build-schemas-package.ts`. Add `packages/schemas/json/` to `.gitignore`.
- Run `pnpm add -D ajv` to get a draft-07 validator for the tests.
- Check that every current schema renders with the installed Effect (see `package.json`). If `JSONSchema.make` refuses `BranchNameSchema` (a filter) or the approval record's pattern, add a `jsonSchema` annotation. Annotations only: never change what decodes.
- Register `packages/schemas/build/*.ts` as knip entries if needed.

### Planned files to create

- `packages/schemas/build/formats.ts`
- `packages/schemas/build/jsonSchemas.ts`
- `scripts/build-schemas-package.ts`
- `tests/unit/schemasPackage/jsonSchemas.test.ts`

### Planned files to edit

- `package.json`
- `pnpm-lock.yaml`
- `.gitignore`
- `knip.json`

### Optional files that may be edited

- `src/domain/branded.ts`
- `src/schemas/approvalRecord.ts`
- `tsconfig.test.json`

### Boundary contracts

Producer: the format registry in `packages/schemas/build/formats.ts`. Consumers: the JSON Schema build, and later the snapshot gate (phase-06), the corpus script (phase-07) and the README test (phase-15). Contract: every exported parse function has exactly one registry entry, whose schema is the object that parse function decodes with. Outside consumer: a docs pipeline that reads `node_modules/@lbdremy/phax-schemas/json/<id>.schema.json` with a draft-07 validator.

### Test strategy

Write `tests/unit/schemasPackage/jsonSchemas.test.ts` first. It asserts that:

- the registry has exactly one entry per exported parse function;
- `renderFormatJsonSchemas` succeeds on the real registry, with one file per format;
- ajv in draft-07 mode compiles every file and validates one phax-written document per format (literals the existing tests use, or documents built with phax's encoders);
- an injected entry whose schema `JSONSchema.make` refuses (a `Schema.declare` without annotation, after confirming that the installed Effect refuses it) yields a failure naming that format and no file for it.

### Implementation order

1. The format registry.
2. The renderer and its tests, including the gap case.
3. The build script and the root build script.
4. ajv and the validation tests.
5. Any jsonSchema annotation needed; then pnpm build.

### Excluded scope

- Snapshots and the snapshot gate (phase-06).
- JSON Schemas of historical shapes; the shipped files describe the latest shape only.
- Hosting the schemas at a URL.
- The code-review document.

### Verification

The `standard` gate profile in `phax.json`. Run `pnpm build` to confirm that `packages/schemas/json/` is produced.

### Expected handoff content

Record:
- the registry path, the entry shape and the id list;
- the renderer's signature and failure shape;
- the build script's exported function and the exact root build script;
- any `jsonSchema` annotation added, and where;
- any deviation, with the reason.

### Commit subject

`feat(schemas-package): ship one draft-07 JSON Schema per format`

### Commit body

Add the format registry: the single list of exported formats, each with its id, label, title and current schema. A pure renderer turns each schema into a draft-07 JSON Schema. The build script writes packages/schemas/json/<id>.schema.json, and when any schema cannot be rendered it fails naming the format and writes nothing. pnpm build now runs it. Tests validate one phax-written document per format with ajv.

---

## phase-03 — Phase record history: shape table, frozen v1 and v2, toLatest, newer-release failure {#phase-03-phase-record-history}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

For the phase record alone, a consumer can do three things. Parse every legacy shape phax has written (v1 and v2) and get the exact type with its shape id. Upgrade any of them to the latest shape, with absent facts marked unknown. Get an upgrade-the-package failure for a `$schema` that names a newer release or an unknown format. This proves the pattern on one format before phase-04 repeats it.

### Detailed instructions

- Create `src/schemas/schemaUrl.ts`. It is pure and imports nothing outside `effect`. It exports:
    - `SCHEMA_URL_BASE = "https://docs.phax.run/schemas"`;
    - `FORMAT_IDS`, a readonly tuple of the eleven format ids (registry, run-status, phase-status, phax-plan, compliance-review, plan-approvals, spec-approvals, phase-record, spec-document, plan-document, authoring-record), without code-review, and `type FormatId`;
    - `schemaUrl(formatId, release)`, which builds `<base>/<id>/<release>.json`;
    - `parseSchemaUrl(value: unknown): { formatId: string; release: string } | undefined`, which accepts any lowercase-kebab id so that an unknown id stays reportable;
    - `compareReleases(a, b)`, a numeric X.Y.Z comparison.
- Create `packages/schemas/build/generated.ts`, which is pure:
    - `renderGeneratedIndex({ packageVersion })` returns the source of `packages/schemas/src/generated/index.ts`: a do-not-edit header naming `pnpm exec tsx scripts/schemas-snapshots.ts --write`, then `export const PACKAGE_VERSION = "<version>" as const;`;
    - `refreshLock(lock, files)` takes the path→sha256 map and the current bytes of every file under `packages/schemas/src/history/`. It returns the lock with missing entries added, and the list of paths whose existing entry differs. It never changes an existing entry.
- Create `scripts/schemas-snapshots.ts`, with its logic exported behind a main guard:
    - By default it checks that the committed generated index equals the render for the root `package.json` version, and that every history module has a matching lock entry. It prints each finding as `✗ …` and exits 1 on any finding.
    - With `--write` it rewrites the generated index and adds missing lock entries. It exits 1, changing nothing, when an existing lock entry mismatches.
    Run it with `--write` to create `packages/schemas/src/generated/index.ts` and `packages/schemas/history.lock.json`. Paths in the lock are relative to `packages/schemas`. Never edit either file by hand.
- Extend `packages/schemas/src/parsed.ts`:
    - `ParsedShape<M>`, over a map from shape id to value type, is a union with one `{ ok: true; shape: K; value: M[K] }` per key, plus the failure variant. It is assignable to `Parsed<M[keyof M]>`.
    - Also export `ParseFailure` and `failure(path, message)`.
- Create `packages/schemas/src/shapes.ts`:
    - A `Shape<T>` is `{ schema, decode }`.
    - `defineFormat({ id, label, legacy: Record<number, Shape>, releases: ReadonlyArray<[release, Shape]>, current: { name, shape } }, { packageVersion = PACKAGE_VERSION })` returns the definition and its `parse`. `current.name` is `v<N>`, `next` or a release.
    `parse` never throws. Its rules, in order:
    - A non-object fails at `""`.
    - A document with `$schema`:
      - a malformed URL fails at `$schema`, naming the expected form;
      - an id outside `FORMAT_IDS` fails with `<url> names a format unknown to @lbdremy/phax-schemas <packageVersion> — upgrade the package`;
      - another known id fails with `<url> is a <that id> document, not a <id>`;
      - a release above `packageVersion` fails with `<id> written by phax <release> is newer than @lbdremy/phax-schemas <packageVersion> — upgrade the package`;
      - otherwise, when `current.name` is `next` and the release equals `packageVersion`, decode with `current` first (shape `next`), then fall through;
      - the decoder is then the latest release-named shape (the `releases` entries, plus `current` when its name is a release) at or below the release; with none, it fails with `no <id> shape is known at release <release>`.
    - A document with a numeric `version` and no `$schema`: when `current.name` is `v<N>`, `current` decodes it (phax's decoder); otherwise `legacy[N]` does. An unknown literal fails at `version`, listing the known literals.
    - A document with neither fails at `$schema` (missing).
    Success returns `{ ok: true, shape, value }`. Export the unknown-format and newer-release message builders, so phase-05 reuses the same wording.
- Create `packages/schemas/src/history/phase-record/v1.ts` and `v2.ts`, the frozen decoders:
    - Each imports only `effect` and inlines every sub-schema and annotation of its shape: outcome, token usage, provider id, surface, and so on.
    - Both use `onExcessProperty: "error"`.
    - Reconstruct v1 from `git log -p -- src/schemas/runRecord.ts`: v1 predates `verifiedSurfaces`, added in 0.10. Check it against the real v1 records.
    - v2 is a faithful copy of today's `RunRecordManifestSchema` with identical annotations.
    - Each exports `PhaseRecordV<N>Schema`, `type PhaseRecordV<N>` and `decodePhaseRecordV<N>`.
    Once released, these files never change.
- Update `packages/schemas/src/index.ts`:
    - Define the phase record with `legacy: { 1: frozen v1, 2: frozen v2 }`, `releases: []` and `current: { name: "v2", shape: phax's RunRecordManifestSchema and decoder }`. Phase-06 moves the current name into the generated index.
    - `parsePhaseRecord` returns `ParsedShape<{ v1: PhaseRecordV1; v2: PhaseRecord }>`.
    - Export `Unknown` (`{ readonly kind: "unknown" }`), a frozen `UNKNOWN` and `isUnknown`.
    - Export `LatestPhaseRecord`: the current fields without `version`, with `verifiedSurfaces` typed `ReadonlyArray<Surface> | Unknown`.
    - Export the pure `toLatestPhaseRecord(value: PhaseRecordV1 | PhaseRecordV2 | PhaseRecord): LatestPhaseRecord`, discriminating structurally. From v1 it keeps every field and sets `verifiedSurfaces` to `UNKNOWN`; from v2 it keeps every field. It always drops `version` and never invents a value.
    - Also export the types `PhaseRecordV1`, `PhaseRecordV2` and `PhaseRecordShape`.
- Seed the corpus with `node -e` and `child_process.execFileSync("git", ["-C", <home>/.phax/records/phax, ...])`:
    - resolve `phax/records/v1`, falling back to `refs/remotes/origin/phax/records/v1`;
    - list every commit with `rev-list`, since each commit carries its own tree;
    - list `*/record.json` paths with `ls-tree -r --name-only`, skipping `authoring/`, and read each with `cat-file -p`.
    Write every distinct v1 record and at least three v2 records into `packages/schemas/corpus/phase-record/v1/` and `v2/`. This naming contract binds phase-07: the content is `JSON.stringify(value, null, 2) + "\n"`, and the name is the first 16 hex characters of its sha256, plus `.json`.
- In `.oxfmtrc.json`, add `packages/schemas/src/history`, `packages/schemas/src/generated`, `packages/schemas/corpus`, `packages/schemas/snapshots` and `packages/schemas/history.lock.json` to `ignorePatterns`.
- Add a guard to `architecturalGuards.test.ts`: no module under `src/` imports anything under `packages/schemas/src/history/` (§5.14).
- Stop at the phase record. The other formats come in phase-04.

### Planned files to create

- `src/schemas/schemaUrl.ts`
- `packages/schemas/src/shapes.ts`
- `packages/schemas/src/history/phase-record/v1.ts`
- `packages/schemas/src/history/phase-record/v2.ts`
- `packages/schemas/src/generated/index.ts`
- `packages/schemas/history.lock.json`
- `packages/schemas/build/generated.ts`
- `scripts/schemas-snapshots.ts`
- `tests/unit/schemaUrl.test.ts`
- `tests/unit/schemasPackage/shapes.test.ts`
- `tests/unit/schemasPackage/phaseRecordHistory.test.ts`
- `tests/unit/schemasPackage/frozenHistory.test.ts`

### Planned files to edit

- `packages/schemas/src/index.ts`
- `packages/schemas/src/parsed.ts`
- `tests/unit/schemasPackage/exports.test.ts`
- `tests/unit/architecturalGuards.test.ts`
- `.oxfmtrc.json`
- `knip.json`

### Optional files that may be edited

- `tests/unit/schemasPackage/parity.test.ts`
- `tests/type/schemasPackage.ts`
- `packages/schemas/build/formats.ts`

### Boundary contracts

Producer: `packages/schemas/src/shapes.ts`, which provides the format definition, the resolution rules, `Unknown` and the failure messages. Consumers: every format's parse function (phase-04), `parseDocument` (phase-05), the snapshot gate (phase-06), the corpus script (phase-07) and phax's own reads (phase-08). Contract: a format is a table of shapes:
- legacy literals map to frozen modules that import only `effect`;
- release-named historical shapes map to frozen modules;
- the current shape is decoded by phax, and its name is `v<N>`, `next` or a release.
Producer: `packages/schemas/src/generated/index.ts`, derived from the root `package.json`. Consumers: the package's version checks now, and phax's `$schema` stamping later.

### Test strategy

Write these first:

- `tests/unit/schemaUrl.test.ts`: `schemaUrl` and `parseSchemaUrl` round-trip; unknown ids are accepted and malformed URLs rejected; `compareReleases` orders numeric triples (`0.10.0` is above `0.9.0`).
- `shapes.test.ts`: a toy format with legacy literals 1 and 2, historical release `0.10.0` and current `0.12.0`, at package version `0.13.0`:
  - release `0.11.0` resolves to `0.10.0`, and `0.12.0` to `0.12.0`;
  - `0.9.0` has no shape; `99.0.0` fails with the newer message;
  - an unknown id fails with the upgrade message, and another known id is named;
  - a malformed URL, an unknown literal, neither marker and a non-object all fail;
  - with current named `next` and package version `0.13.0`: a `0.13.0` document of the next shape parses with shape `next`, and a `0.13.0` document of the `0.12.0` shape parses with shape `0.12.0`;
  - nothing throws.
- `phaseRecordHistory.test.ts`:
  - every corpus document parses `ok`, with `shape` equal to its directory, and narrowing on `shape` typechecks to the exact type;
  - a v2 document with `$schema` `https://docs.phax.run/schemas/phase-record/0.19.0.json` fails with the newer message;
  - `toLatestPhaseRecord` of a v1 record gives `verifiedSurfaces` equal to `{ kind: "unknown" }`, keeps every v1 field and has no `version`.
- `frozenHistory.test.ts`:
  - the committed generated index and lock pass the script's check (it fails naming the `--write` command otherwise);
  - every lock entry names an existing file;
  - for the frozen twin of the literal phax writes (v2), `JSONSchema.make` deep-equals phax's current output, and every corpus document of that literal decodes to the same verdict and value with both.

The parity test stays green.

### Implementation order

1. schemaUrl.ts and its test.
2. build/generated.ts, the script, the generated index and the lock.
3. parsed.ts, then shapes.ts with the toy-format tests.
4. The frozen v1 (from git history) and v2 modules; add their lock entries with --write.
5. The corpus seeds.
6. The phase-record definition, toLatestPhaseRecord and the types; the guard and the oxfmt ignores.

### Excluded scope

- Every other format (phase-04).
- parseDocument (phase-05).
- Snapshots and CURRENT_SHAPES in the generated index (phase-06).
- The corpus script (phase-07); the seeds follow its naming contract.
- phax reading through the package (phase-08) and writing `$schema` (phase-10 to phase-13).

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

Record:
- the `shapes.ts` API: the definition, the rules including the `next` rule, and the message builders;
- the `schemaUrl.ts` exports;
- the script's modes and the generated index contents;
- the reconstructed v1 shape and how it differs from v2;
- the seed counts and the naming contract as implemented;
- the new exports.

The corpus files are expected unplanned creations under `packages/schemas/corpus/phase-record/`. Record any other deviation, with the reason.

### Commit subject

`feat(schemas-package): read phase record v1 and v2 history, upgrade to latest`

### Commit body

Validate the reading-history pattern on one format first. A shape table maps a document to its shape: a legacy document by its version literal, and a document carrying $schema by the latest shape released at or before the release its URL names. parsePhaseRecord now reads v1 through a frozen, self-contained decoder and v2 through phax's own decoder, and returns the exact shape with its shape id. A $schema naming a release newer than the package, or an unknown format id, fails without throwing and says to upgrade the package. toLatestPhaseRecord upgrades a v1 record in memory and marks verifiedSurfaces as { kind: "unknown" }.

The package version comes from the root package.json through a generated module that scripts/schemas-snapshots.ts writes and checks. history.lock.json pins every frozen module's bytes. Real v1 and v2 records from the records branch seed the corpus.

---

## phase-04 — History for every format: frozen v1 twins, shape tables, toLatest {#phase-04-history-all-formats}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

Every exported format reads through the same shape table as the phase record. Each one has a frozen twin of the legacy shape phax writes today, a `toLatest` function, and the upgrade-the-package failure. The record-manifest union reads any record on `phax/records/v1`, and both legacy authoring-record v1 shapes parse.

### Detailed instructions

- Freeze today's version-1 schema of registry, run-status, phase-status, phax-plan, compliance-review, plan-approvals, spec-approvals, spec-document, plan-document and authoring-record into `packages/schemas/src/history/<format id>/v1.ts`. Each module:
    - imports only `effect` and inlines every sub-schema and annotation: the state unions, the effort union, a copy of the `BranchNameSchema` predicate and its annotations, token usage, provider id, surface, the baseline pattern, and so on. Its `JSONSchema.make` output must equal phax's current one;
    - keeps phax's excess-property setting: the default for registry, run-status and phase-status, and `"error"` elsewhere;
    - exports `<Format>V1Schema`, `type <Format>V1` and a decode function.
    Add the lock entries with `pnpm exec tsx scripts/schemas-snapshots.ts --write` once each file is final.
- The authoring-record twin copies phax's `AuthoringRecordManifestSchema`, where `sourceSha` is already optional, so it accepts both legacy shapes (§5.12). Verify every authoring seed against phax's decoder and against the twin. If the corpus holds a v1 variant phax rejects, widen only the frozen module, and report it.
- In `index.ts`, define each format through `defineFormat` with `legacy: { 1: frozen v1 }`, `releases: []` and `current: { name: "v1", shape: phax's schema and decoder }`. Each parse function returns `ParsedShape<{ v1: <Format> }>`. Behavior on current documents is unchanged (parity).
- Export the pure functions `toLatestRegistry`, `toLatestRunStatus`, `toLatestPhaseStatus`, `toLatestPhaxPlan`, `toLatestComplianceReview`, `toLatestPlanApprovals`, `toLatestSpecApprovals`, `toLatestSpecDocument`, `toLatestPlanDocument`, `toLatestAuthoringRecord` and `toLatestRecordManifest`. Also export the types `<Format>V1`, `Latest<Format>` and `<Format>Shape`. While a format has one shape, `toLatest` keeps every field and drops `version`.
- Add `ParsedDocument` to `parsed.ts`: a union of `{ ok: true; format: F; shape: S; value: T }` over each format and shape, plus the failure variant. `parseRecordManifest` returns it:
    - a `$schema` document is routed by its format id to `phase-record` or `authoring-record`, and any other id fails;
    - otherwise `kind === "authoring"` goes to the authoring record and anything else to the phase record.
    `toLatestRecordManifest` dispatches the same way.
- Seed every distinct authoring record from the records clone (`authoring/<id>/record.json` across every commit) into `packages/schemas/corpus/authoring-record/v1/`, using the phase-03 method and naming contract. The seeds must include records with and without `sourceSha`.
- Extend `frozenHistory.test.ts` so the twin-fidelity checks cover every new twin. Update `exports.test.ts`.

### Planned files to create

- `packages/schemas/src/history/registry/v1.ts`
- `packages/schemas/src/history/run-status/v1.ts`
- `packages/schemas/src/history/phase-status/v1.ts`
- `packages/schemas/src/history/phax-plan/v1.ts`
- `packages/schemas/src/history/compliance-review/v1.ts`
- `packages/schemas/src/history/plan-approvals/v1.ts`
- `packages/schemas/src/history/spec-approvals/v1.ts`
- `packages/schemas/src/history/spec-document/v1.ts`
- `packages/schemas/src/history/plan-document/v1.ts`
- `packages/schemas/src/history/authoring-record/v1.ts`
- `tests/unit/schemasPackage/formatHistory.test.ts`

### Planned files to edit

- `packages/schemas/src/index.ts`
- `packages/schemas/src/parsed.ts`
- `packages/schemas/history.lock.json`
- `tests/unit/schemasPackage/exports.test.ts`
- `tests/unit/schemasPackage/frozenHistory.test.ts`

### Optional files that may be edited

- `packages/schemas/src/shapes.ts`
- `tests/type/schemasPackage.ts`
- `tests/unit/schemasPackage/parity.test.ts`

### Boundary contracts

Producer: each format's parse and `toLatest` functions. Consumer: a third-party reader walking history, such as the cockpit reading `phax/records/v1` through `parseRecordManifest`. Contract: `parse` returns the exact shape with its shape id (and the `format`, for the union); `toLatest` returns the latest shape with absent facts as `{ kind: "unknown" }` and never an invented value.

### Test strategy

Write `tests/unit/schemasPackage/formatHistory.test.ts` first. For every format it asserts that:

- a current document parses with shape `v1`;
- the same document with a `$schema` naming release `99.0.0` of its format fails with the newer message, and an unknown format id fails with the upgrade message, neither throwing;
- `toLatest` keeps every field except `version`.

For the authoring record and the union, it asserts that:

- every authoring seed parses, with at least one seed with `sourceSha` and one without;
- `parseRecordManifest` reads a v1 and a v2 phase record and a v1 authoring record from the corpus, each with the right `format` and `shape`.

The frozen-history test covers every twin.

### Implementation order

1. Freeze the ten twins and add their lock entries.
2. Define every format on the shape table.
3. Add parseRecordManifest, the toLatest functions and the types.
4. Seed the authoring corpus, write the tests and update the exports set.

### Excluded scope

- parseDocument (phase-05), snapshots (phase-06) and the corpus script (phase-07).
- Any shape change, and handing any literal to its twin (phase-10 to phase-13).

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

Record:
- the new exports;
- the ten frozen modules;
- the authoring seed count, and how many lack `sourceSha`;
- whether the authoring twin had to widen beyond phax's decoder.

The corpus files are expected unplanned creations under `packages/schemas/corpus/authoring-record/v1/`. Record any other deviation, with the reason.

### Commit subject

`feat(schemas-package): shape table, frozen v1 twins and toLatest for every format`

### Commit body

Apply the phase-record history pattern to every exported format. Each format now has a shape table and a frozen, self-contained twin of the version-1 shape phax writes today, proven identical to phax's decoder. Each parse function returns the exact shape with its shape id and fails without throwing on a newer release or an unknown format, and each format has a pure toLatest function. parseRecordManifest dispatches on $schema or kind, so it reads every phase-record shape and authoring records.

Both legacy authoring-record v1 shapes in the records history, with and without sourceSha, are seeded into the corpus and parse.

---

## phase-05 — parseDocument: identification by $schema alone {#phase-05-parse-document}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

A consumer holding any JSON value can ask the package what it is. `parseDocument` reads the format id and the release from the `$schema` alone and returns the format, the shape and the value. For anything it cannot read, it returns a named failure.

### Detailed instructions

- Create `packages/schemas/src/document.ts` with `makeDocumentParser(definitions)`, which returns a parser over values only, never paths. The parser never throws. Its rules:
    - a non-object fails at `""`;
    - a document without `$schema` fails at `$schema`, saying that a legacy document carries only a `version` literal, is identified by where it lives, and must be read with its format's parse function (for example `parsePhaseRecord`);
    - a malformed URL fails at `$schema`;
    - an id outside `FORMAT_IDS` fails with the shared upgrade message;
    - otherwise the parser delegates to that format's parse function, which handles the newer-release and no-shape cases, and returns a `ParsedDocument`.
- In `index.ts`, export `parseDocument` over the eleven format definitions (the union has no format id), and the types `DocumentFormatId` and `AnyDocument`.
- Until phase-10, no format has a `$schema` shape. A `$schema` document of a known format at or below the package version therefore fails with no shape. The tests pin this now, and phase-10 to phase-13 turn it into success.
- Update `exports.test.ts`.

### Planned files to create

- `packages/schemas/src/document.ts`
- `tests/unit/schemasPackage/parseDocument.test.ts`

### Planned files to edit

- `packages/schemas/src/index.ts`
- `tests/unit/schemasPackage/exports.test.ts`

### Optional files that may be edited

- `packages/schemas/src/shapes.ts`
- `packages/schemas/src/parsed.ts`
- `tests/type/schemasPackage.ts`

### Boundary contracts

Producer: `parseDocument`. Consumer: a reader holding documents whose names and locations say nothing, such as exported copies or several files of one format. Contract: identification uses the `$schema` URL alone. The result names the format id, the shape id and the value, or fails with a message the reader can act on: upgrade the package, or use the format's parse function for a legacy document.

### Test strategy

Write `parseDocument.test.ts` first. It asserts that:

- a document without `$schema` fails, naming the parse functions;
- an unknown format id fails, naming the URL, the package version and the upgrade;
- a phase record naming release `0.19.0` fails with the spec's newer message;
- a known format at or below the package version fails with no shape (for now);
- a malformed URL and a non-object fail;
- none of these throws.

The renamed-file criterion is completed in phase-12.

### Implementation order

1. document.ts and its rules.
2. The entry export and its types.
3. The tests and the exports set.

### Excluded scope

- `$schema` shapes for any format (phase-10 to phase-13).
- Reading files or walking the records branch (a spec non-goal).

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

Record:
- the builder's signature and the export names;
- the failure messages, and which ones are shared with `shapes.ts`;
- any deviation, with the reason.

### Commit subject

`feat(schemas-package): identify a document by its $schema alone with parseDocument`

### Commit body

Add parseDocument. It reads the format id and the release from a document's $schema URL, never from a file name or location, and returns the format id, the shape id and the parsed value. An unknown format id or a newer release fails, naming the URL and the package version and saying to upgrade the package. A legacy document without $schema fails, pointing at the format's own parse function. No call throws.

---

## phase-06 — JSON Schema snapshots per format and shape, and the snapshot gate {#phase-06-snapshot-gate}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

Every shape of every format has a committed JSON Schema snapshot. A change to the shape phax writes fails phax's gate until `<format id>/next.schema.json` records it, and a released shape can no longer change.

### Detailed instructions

- Extend each registry entry in `packages/schemas/build/formats.ts` with its `definition` from `shapes.ts`. The `record-manifest` union has none and no snapshots.
- Extend `renderGeneratedIndex` with `CURRENT_SHAPES`: for each format id, the name of its latest snapshot, ordered legacy literals by number, then releases by `compareReleases`, then `next`. Emit it `as const`, so shape-id types follow the literal. In `index.ts`, every format's `current.name` now reads `CURRENT_SHAPES[id]`, and each `<Format>Shape` type derives from it.
- Create `packages/schemas/build/snapshots.ts` exporting a pure `checkSnapshots({ formats, snapshots, lock, index, rootVersion })`. A snapshot's content is the raw `JSONSchema.make` output. It returns these findings:
    - (a) A shape in a table, other than the current one, with no snapshot: `✗ <id>: no snapshot for shape <shape> — run pnpm exec tsx scripts/schemas-snapshots.ts --write`.
    - (b) A frozen module whose schema differs from its shape's snapshot: `✗ <id>: the frozen decoder of shape <shape> differs from snapshots/<id>/<shape>.schema.json`.
    - (c) G, the schema generated from phax's current decoder, compared with L, the latest released (non-next) snapshot:
      - when G differs from L and `next` is missing or differs from G: `✗ <id>: the generated schema differs from the latest released snapshot and from snapshots/<id>/next.schema.json — record next.schema.json`;
      - when G equals L and `next` exists: `✗ <id>: snapshots/<id>/next.schema.json is stale — the generated schema equals the released snapshot <L>; delete it`.
    - (d) The table's historical shapes plus `CURRENT_SHAPES[id]` differ from the ordered snapshot names: name both lists.
    - (e) A snapshot naming no format.
    - (f) The generated index differs from its render for the root version and the snapshot names.
    - (g) A frozen module or released snapshot without a matching lock entry. `next` is never locked.
- Extend `scripts/schemas-snapshots.ts`:
    - The default run is the full check, printing findings and exiting 1 on any.
    - `--write` creates missing snapshots only, as two-space JSON with a trailing newline: historical shapes from their frozen module; the current legacy shape from G at bootstrap; `next` from G when (c) fires and `next` is absent. It never overwrites a file. It then rewrites the index and adds missing lock entries.
    Document at the top of the script how to amend an unreleased `next`: delete it and run `--write` again.
- Run `pnpm exec tsx scripts/schemas-snapshots.ts --write` to create the twelve legacy snapshots, then regenerate the index and lock. Never edit a snapshot by hand.
- In the root `package.json`, add `"schemas:check": "tsx scripts/schemas-snapshots.ts"` and append `&& npm run schemas:check` to `check:full`.
- In `frozenHistory.test.ts`, remove the JSON Schema equality assertions that (b) and (c) now cover. Keep the corpus-decoding twin checks.

### Planned files to create

- `packages/schemas/build/snapshots.ts`
- `tests/unit/schemasPackage/snapshots.test.ts`
- `packages/schemas/snapshots/registry/v1.schema.json`
- `packages/schemas/snapshots/run-status/v1.schema.json`
- `packages/schemas/snapshots/phase-status/v1.schema.json`
- `packages/schemas/snapshots/phax-plan/v1.schema.json`
- `packages/schemas/snapshots/compliance-review/v1.schema.json`
- `packages/schemas/snapshots/plan-approvals/v1.schema.json`
- `packages/schemas/snapshots/spec-approvals/v1.schema.json`
- `packages/schemas/snapshots/phase-record/v1.schema.json`
- `packages/schemas/snapshots/phase-record/v2.schema.json`
- `packages/schemas/snapshots/spec-document/v1.schema.json`
- `packages/schemas/snapshots/plan-document/v1.schema.json`
- `packages/schemas/snapshots/authoring-record/v1.schema.json`

### Planned files to edit

- `packages/schemas/build/formats.ts`
- `packages/schemas/build/generated.ts`
- `scripts/schemas-snapshots.ts`
- `packages/schemas/src/generated/index.ts`
- `packages/schemas/src/index.ts`
- `packages/schemas/history.lock.json`
- `package.json`
- `tests/unit/schemasPackage/frozenHistory.test.ts`

### Optional files that may be edited

- `packages/schemas/src/shapes.ts`
- `knip.json`
- `tests/type/schemasPackage.ts`

### Boundary contracts

Producer: `packages/schemas/snapshots/<format id>/<shape>.schema.json`, one file per shape, with the lock and the generated index. Consumer: the check in `pnpm test`, which every phase gate, CI and the release Gate step run. Contract for phase-10 to phase-13 and for later plans that change a format:
- change phax's schema;
- run the check, which names `next.schema.json`;
- run `--write`, which records `next` and flips `CURRENT_SHAPES` to `next`;
- when a release-named current shape is superseded, first move it into a frozen module named by its release.
`release.sh` renames `next` (phase-14).

### Test strategy

Write `snapshots.test.ts` first:

- `checkSnapshots` on the real registry and the committed files returns no findings. This is the gate.
- The acceptance scenario, on an injected registry: the phase-record current schema gains one key while no `next` exists. The check returns exactly one finding, naming `phase-record` and `phase-record/next.schema.json`. After adding that snapshot and setting the injected current name to `next`, it passes.
- A stale `next`, a drifted frozen module, a missing historical snapshot, a table/snapshot mismatch, an orphan, a stale index and a lock mismatch are each reported.
- The `--write` rules on a temp directory: missing snapshots only, no overwrite.

### Implementation order

1. Definitions in the registry; CURRENT_SHAPES in the generated index.
2. The pure check and its tests, including the injected cases.
3. The script's modes; run --write.
4. The package.json scripts and the frozen-history test update.

### Excluded scope

- Any shape change (phase-10 to phase-13).
- The history corpus (phase-07).
- Renaming `next` at a release (phase-14).

### Verification

The `standard` gate profile in `phax.json`. The snapshot check runs inside `pnpm test`.

### Expected handoff content

Record:
- the `checkSnapshots` signature and the exact messages;
- the `--write` semantics and the recipe for later shape changes;
- the twelve snapshots and which decoder each came from;
- the generated index contents;
- any deviation, with the reason.

### Commit subject

`feat(schemas-package): commit a JSON Schema snapshot per format shape and gate on it`

### Commit body

Commit one JSON Schema snapshot per format and shape under packages/schemas/snapshots/<format id>/<shape>.schema.json. The gate compares the schema generated from phax's decoder with the format's latest released snapshot. When they differ and snapshots/<format id>/next.schema.json does not equal the generated schema, it fails naming the format and next.schema.json. It also checks every frozen decoder against its snapshot, pins released snapshots and frozen modules by hash, and keeps the generated index in step with package.json and the snapshot names.

Each format's current shape name now comes from the generated index. scripts/schemas-snapshots.ts runs in pnpm test and in pnpm schemas:check, part of check:full. With --write it creates missing snapshots only and never overwrites one.

---

## phase-07 — History-corpus extraction script and the committed corpus {#phase-07-history-corpus}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

A committed script extracts every distinct persisted document from git history into a per-format, per-shape corpus. phax's corpus is committed, and every document in it must parse with the package in every gate, including the release gate.

### Detailed instructions

- Export `resolveShape(definition, value)` from `shapes.ts`. It returns the shape id that `parse` would use, or a failure, without decoding.
- Create `packages/schemas/build/corpus.ts`, which is pure:
    - `classifyDocument(source, value)` returns `{ formatId, shape }` or an error. `source` is `record`, `plan-ledger`, `spec-ledger` or `sidecar`.
      - With `$schema`, the URL's id must agree with the source.
      - Without it: a record with `kind` `authoring` is `authoring-record`, and any other record is `phase-record`; the ledgers are their approvals formats; a sidecar's `kind` (`spec` or `plan`) gives the document format.
      - The shape comes from `resolveShape`.
    - `corpusFileFor(value)` returns `{ name, content }` under the phase-03 naming contract.
- Create `scripts/extract-history-corpus.ts`, exporting `extractHistoryCorpus({ records, repo, out })` behind a main guard. Its arguments are `--records <path>` (required), `--repo <path>` (default: the current directory) and `--out` (default: `packages/schemas/corpus`). It uses `execFileSync("git", ["-C", dir, ...])` with no shell, over three sources:
    - records: resolve `phax/records/v1`, falling back to `refs/remotes/origin/phax/records/v1`; for every `rev-list` commit, read every `*/record.json` from `ls-tree -r --name-only` with `cat-file -p <commit>:<path>`;
    - ledgers: `docs/plans/approvals.json` and `docs/specs/approvals.json`, at every commit from `git log --all --format=%H -- <path>`, skipping deletions;
    - sidecars: every `.json` under `docs/specs/` or `docs/plans/`, archives included and the ledgers excluded, at each commit that touches it, skipping deletions.
    A classification error aborts, naming `<commit>:<path>`. Write each file only if absent, and print a count per format and shape.
- Run `pnpm exec tsx scripts/extract-history-corpus.ts --records ~/.phax/records/phax`. It must reproduce the phase-03 and phase-04 seeds under the same names, with no duplicates. Commit the corpus.
- Create `historyCorpus.test.ts`. It walks `packages/schemas/corpus/<id>/<shape>/*.json` and parses each file with the registry parse function for `<id>`, asserting `ok` and `shape === <shape>`. A failure names the file's repo path and the first violation. This is §5.17, and the release workflow's Gate step already runs `pnpm test`.
- Register the script and `build/corpus.ts` in knip.

### Planned files to create

- `scripts/extract-history-corpus.ts`
- `packages/schemas/build/corpus.ts`
- `tests/unit/schemasPackage/corpus.test.ts`
- `tests/unit/schemasPackage/historyCorpus.test.ts`
- `tests/integration/extractHistoryCorpus.test.ts`

### Planned files to edit

- `packages/schemas/src/shapes.ts`
- `knip.json`

### Optional files that may be edited

- `packages/schemas/build/formats.ts`
- `tests/unit/schemasPackage/phaseRecordHistory.test.ts`
- `tests/unit/schemasPackage/formatHistory.test.ts`

### Boundary contracts

Producer: the corpus script, which writes `packages/schemas/corpus/<formatId>/<shape>/<hash16>.json`. Consumers: the corpus parse test (every gate) and phase-10 to phase-13, whose changes must keep every document parsing. Contract: real documents only, named by content hash; a shape directory is named exactly as the parse function names that shape.

### Test strategy

Write the pure tests first:

- `corpus.test.ts`: classification for each source and kind, an id that disagrees with its source, an unresolvable shape, and the naming contract.
- `extractHistoryCorpus.test.ts`: temp git repos, where the records branch has two commits, each with its own tree, and the main repo commits a ledger twice and a sidecar once. It asserts the directories, the deduplication and the names; a record with a string `version` aborts, naming the commit and path.
- `historyCorpus.test.ts` is the gate on the real corpus.

### Implementation order

1. resolveShape, then corpus.ts and its tests.
2. The script and its integration test.
3. Run the script against the records clone and the repo.
4. The corpus parse test, then knip.

### Excluded scope

- Following the records destination in `phax.json`.
- Documents outside git (registry, run and phase status, phax-plan, compliance review).
- Re-extracting automatically at each release.

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

Record:
- the script's arguments and exported function;
- the document count per format and shape (roughly 6 phase-record v1, 51 v2 and 8 authoring-record v1, plus ledgers and sidecars);
- any document that could not be classified.

The corpus files are expected unplanned creations. Record any other deviation, with the reason.

### Commit subject

`feat(schemas-package): extract the history corpus from git and parse it in every gate`

### Commit body

Add scripts/extract-history-corpus.ts. It walks every commit of phax/records/v1 in the records repository named by --records, then every commit in --repo that touches the approvals ledgers or a spec or plan sidecar. It writes each distinct document into packages/schemas/corpus/<format id>/<shape>/, named by content hash, with the shape taken from $schema or from the legacy version literal.

The corpus extracted from phax's history and records clone is committed, and pnpm test parses all of it with the package, so a document that fails stops the release gate, naming the file and its first violation.

---

## phase-08 — The own-formats bridge and the build layout {#phase-08-own-formats-bridge}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

phax has one bridge module through which it can read any of its own persisted files, in any shape phax has ever written, via the package. It refuses by name when a fact it needs is unknown. phax still builds, and its CLI still finds `package.json`, the usage spec and the skills from source, from `dist` and from the binary.

### Detailed instructions

- Change `tsconfig.json` and `tsconfig.build.json` to `rootDir` `.` (outDir stays `./dist`; include stays `src/**/*`). Set the root `package.json` `bin` to `./dist/src/cli/main.js`.
- Create `src/cli/packageRoot.ts`. `packageRoot(fromDir)` walks up from `fromDir` to the first ancestor that contains `phax.usage.kdl`, and throws a named error when there is none. Use it in `usage.ts` (`package.json`), `usageSpec.ts` (`phax.usage.kdl`) and `skills.ts` (`.claude/skills`) in place of the fixed `../../..`. It must hold in development (`src/cli/commands`), in dist (`dist/src/cli/commands`) and in the Deno binary (bundle at `dist/release/bundle`, files included at the VFS root). Update the depth comment in `scripts/build-binaries.ts` if it no longer holds.
- Create `src/schemas/ownFormats.ts`. It is pure, and it is the only `src/` module that imports from `packages/`: `packages/schemas/src/index.ts` and `packages/schemas/src/generated/index.ts`. It exports:
    - `phaxRelease` (the generated `PACKAGE_VERSION`);
    - `OwnReadFailure`: `{ _tag: "Invalid"; message }` or `{ _tag: "UnknownFact"; fact; shape; message }`. Messages never include a file path; callers prefix the path;
    - one `readOwn<Format>(u: unknown): Either<PhaxType, OwnReadFailure>` per format: `readOwnRegistry`, `readOwnRunStatus`, `readOwnPhaseStatus`, `readOwnPhaxPlan`, `readOwnComplianceReview`, `readOwnPlanApprovals`, `readOwnSpecApprovals`, `readOwnPhaseRecord`, `readOwnSpecDocument`, `readOwnPlanDocument`, `readOwnAuthoringRecord` and `readOwnRecordManifest`.
- Implement one generic algorithm behind every `readOwn`:
    1. phax's current decoder; on success, return its value.
    2. Otherwise, the package's parse and `toLatest`. Walk the upgraded value:
       - a top-level `$schema` that is `{ kind: "unknown" }` is set to the marker phax writes for the current shape: while the current shape is legacy (`CURRENT_SHAPES[id]` is `v<N>`), drop it and set `version: N`; afterwards, set `$schema` to `schemaUrl(id, phaxRelease)`;
       - any other unknown fails with `UnknownFact`, naming the dotted path, as `<fact> is unknown in a <format id> <shape> document — phax <phaxRelease> needs it`.
    3. Decode the result again with phax's current decoder, and return it or `Invalid`.
    4. When both reads fail, return `Invalid`, carrying phax's current decoder message (formatted as call sites format it today) followed by the package's `path: message`.
- Add guards to `architecturalGuards.test.ts`:
    - only `src/schemas/ownFormats.ts` imports from `packages/`, and only the two modules named above;
    - the package closure never reaches `src/schemas/ownFormats.ts`.
- Do not change any read site yet (phase-09).

### Planned files to create

- `src/schemas/ownFormats.ts`
- `src/cli/packageRoot.ts`
- `tests/unit/ownFormats.test.ts`
- `tests/unit/cli/packageRoot.test.ts`

### Planned files to edit

- `tsconfig.json`
- `tsconfig.build.json`
- `package.json`
- `src/cli/commands/usage.ts`
- `src/cli/commands/usageSpec.ts`
- `src/cli/commands/skills.ts`
- `tests/unit/architecturalGuards.test.ts`

### Optional files that may be edited

- `scripts/build-binaries.ts`
- `knip.json`
- `tests/unit/schemasPackage/exports.test.ts`

### Boundary contracts

Producer: `src/schemas/ownFormats.ts`. Consumers: every phax site that reads a persisted format (phase-09), and every writer that stamps `$schema` (phase-10 to phase-13). Contract:
- a `readOwn` function returns phax's current type, or a failure whose message the caller prefixes with the file path;
- a legacy document is decoded only by the package's frozen modules;
- phax never imports a history module.

### Test strategy

Write these first:

- `tests/unit/ownFormats.test.ts`:
  - a current document of each format reads through the current decoder;
  - every v1 and v2 phase record from the corpus goes through the package: v2 reads, and v1 fails with `UnknownFact` naming `verifiedSurfaces` and shape `v1`;
  - an invalid document yields `Invalid` with both messages;
  - nothing throws.
- `tests/unit/cli/packageRoot.test.ts`: on temp trees, the walk-up finds the marker at the development depth and at the dist depth, and throws when there is none.

The binary path is proven by the terminal `pnpm deno:smoke-binary` gate (`--version` and `--usage`).

### Implementation order

1. tsconfig rootDir and bin.
2. packageRoot.ts, its test and the three lookups.
3. ownFormats.ts and its test.
4. The guards; run pnpm build, then node dist/src/cli/main.js --version.

### Excluded scope

- Switching read sites (phase-09).
- Any shape change (phase-10 to phase-13).

### Verification

The `standard` gate profile in `phax.json`. Also run `pnpm build` and `node dist/src/cli/main.js --version`.

### Expected handoff content

Record:
- the `ownFormats.ts` API and the exact failure messages;
- the new dist layout and bin;
- the `packageRoot` marker;
- the guard names;
- any deviation, with the reason.

### Commit subject

`feat(schemas): read phax's own persisted files through the schemas package`

### Commit body

Add src/schemas/ownFormats.ts, the one module in phax that imports the schemas package. For each persisted format, readOwn<Format> tries phax's current decoder. Failing that, it reads the document through the package's frozen decoders and toLatest, restamps the identification marker phax writes, and decodes the result again with the current decoder. It refuses, naming the fact, when any other fact comes back unknown. A guard keeps every other src/ module out of packages/.

phax's tsconfig rootDir becomes the repo root so the bridge compiles. bin moves to dist/src/cli/main.js, and the package.json, usage-spec and skills lookups resolve through a walk-up helper that works in development, in dist and in the compiled binary.

---

## phase-09 — Every phax read site through readOwn {#phase-09-read-sites}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

Wherever phax reads a file it wrote, it reads through the bridge. Current documents behave exactly as before, and an older-shape document is read through the package or refused, naming the file and the fact.

### Detailed instructions

- Replace each persisted-format decode at a read site with its `readOwn` function:
    - `src/app/registry.ts`, `resolveRunRef.ts` and `src/cli/commands/run.ts` (registry);
    - `resetPhase.ts`, `effectRunner.ts`, `dispatcher.ts`, `gates.ts`, `resolveRunInfo.ts`, `src/cli/interruptHandler.ts` and `src/cli/commands/resume.ts` (run status);
    - `phaseStatusUpdates.ts`, `effectRunner.ts`, `dispatcher.ts`, `resolveRunInfo.ts` and `src/infra/providers/sessionWriter.ts` (phase status);
    - `loadPlan.ts` and `resolveRunInfo.ts` (phax-plan);
    - `reviewCode.ts` (compliance review);
    - `approvalRecordStore.ts` (both ledgers);
    - `recordsList.ts` and `recordsExplain.ts` (the record-manifest union);
    - `src/domain/artifact/sidecar.ts` (committed spec and plan sidecars).
- Keep each site's error channel and its message format. Where it named a path, prefix the `OwnReadFailure` message with that path. An `UnknownFact` is reported like a decode failure, with its own message.
- Do not change the agent-contract decodes: the compliance verdict the agent writes in `src/app/reviewCompliance.ts`, and the authored document in `src/app/authorArtifact.ts`.
- Keep the approvals store's behavior on files that genuinely cannot be decoded.
- Add a guard: in `src/`, the persisted decoders (`decodeRegistry`, `decodeRunStatus`, `decodePhaseStatus`, `decodePhaxPlan`, `decodeApprovalRecordFile`, `decodeSpecApprovalRecordFile`, `decodeRunRecordManifest`, `decodeAuthoringRecordManifest`, `decodeRecordManifest`, `decodeComplianceReview`, `decodeSpecDocument`, `decodePlanDocument`) are imported only by `src/schemas/ownFormats.ts`, with two exceptions until phase-11 and phase-13 split the agent schemas: `reviewCompliance.ts` (`decodeComplianceReview`) and `authorArtifact.ts` (`decodeSpecDocument` and `decodePlanDocument`).

### Planned files to create

- `tests/integration/ownFormatsReadSites.test.ts`

### Planned files to edit

- `src/app/registry.ts`
- `src/app/resolveRunRef.ts`
- `src/app/resetPhase.ts`
- `src/app/phaseStatusUpdates.ts`
- `src/app/resolveRunInfo.ts`
- `src/app/effectRunner.ts`
- `src/app/dispatcher.ts`
- `src/app/gates.ts`
- `src/app/loadPlan.ts`
- `src/app/reviewCode.ts`
- `src/app/recordsList.ts`
- `src/app/recordsExplain.ts`
- `src/app/approvalRecordStore.ts`
- `src/domain/artifact/sidecar.ts`
- `src/infra/providers/sessionWriter.ts`
- `src/cli/interruptHandler.ts`
- `src/cli/commands/run.ts`
- `src/cli/commands/resume.ts`
- `tests/unit/architecturalGuards.test.ts`

### Optional files that may be edited

- `tests/integration/recordsExplain.test.ts`
- `tests/unit/runRecord.test.ts`
- `src/app/artifactStatus.ts`

### Boundary contracts

Consumers: phax's use cases and CLI read paths. Producer: the bridge. Contract: every read of a phax-written file goes through `readOwn`, so phax-owned code never decodes a legacy shape.

### Test strategy

Write `tests/integration/ownFormatsReadSites.test.ts` first, with fake ports:

- `records list` and `records explain` on a records branch holding a v1 phase record from the corpus report a refusal naming the record path and `verifiedSurfaces`;
- a current v2 record reads as before;
- the run-status and registry read paths return the same values as before on current documents.

The existing suites must stay green unchanged, except for any assertion on the old v1 decode-error text, which you update and list.

### Implementation order

1. The registry and status sites.
2. phax-plan, compliance, approvals and the records sites.
3. sidecar.ts.
4. The guard and the integration test.

### Excluded scope

- Any shape change (phase-10 to phase-13).
- The agent-contract decodes.

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

Record:
- every site switched and how its error message reads now;
- the guard name and its temporary exceptions;
- any deviation, with the reason.

### Commit subject

`refactor(schemas): route every read of a phax-written file through readOwn`

### Commit body

Every site that reads a persisted file phax wrote (registry, run and phase status, phax-plan, compliance review, approvals ledgers, records, sidecars) now decodes it with the matching readOwn function, keeping its path-naming error channel. Documents in the shape phax writes read as before. A document in an older shape reads through the package's frozen decoders, or is refused naming the file and the missing fact. A v1 phase record, for example, is now refused naming verifiedSurfaces.

A guard keeps the persisted-format decoders out of every module except the bridge, the package and the two sites that decode agent output.

---

## phase-10 — $schema for the registry, run status and phase status {#phase-10-schema-url-run-state}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

Every registry, run-status and phase-status document phax writes starts with its `$schema` URL and carries no `version`. Documents written at v1 still read, through the package. The snapshot gate records the change as `next`. This phase sets the recipe that phase-11 to phase-13 repeat.

### Detailed instructions

- In `src/schemas/schemaUrl.ts`, add `SchemaUrlSchema(formatId)`: a `Schema.String` with a `Schema.pattern` accepting that format id at any X.Y.Z release, so that it renders in JSON Schema. In `ownFormats.ts`, add `ownSchemaUrl(formatId)` = `schemaUrl(formatId, phaxRelease)`.
- In `registry.ts` and `status.ts`, make `$schema: SchemaUrlSchema(<id>)` the first field of each struct and remove `version`. Excess-property handling stays the default. Encoding emits keys in field order, so `$schema` comes first.
- Stamp every writer with `$schema: ownSchemaUrl(<id>)` as the first key and no `version`, overriding any value inherited from a spread. The writers are:
    - `src/app/registry.ts`: the empty registry, `upsertRun` and `setRunStatus`;
    - `runFolder.ts`, `phaseFolder.ts`, `effectRunner.ts`, `gates.ts` and `phaseStatusUpdates.ts`;
    - the raw spreads in `resetPhase.ts` and `src/cli/interruptHandler.ts`;
    - `sessionWriter.ts`;
    - any fallback literal in `src/cli/commands/run.ts`.
- Run `pnpm exec tsx scripts/schemas-snapshots.ts` first and copy its findings verbatim into the handoff; this is the gate recording the change. Then run it with `--write`: it creates the three `next` snapshots and sets `CURRENT_SHAPES` for the three formats to `next`, so literal 1 now decodes through the frozen v1 modules.
- In `packages/schemas/src/index.ts`:
    - the parse results become `ParsedShape<{ v1: <Format>V1; next: <Format> }>`, keyed by the generated name;
    - `Latest<Format>` types `$schema` as `string | Unknown`;
    - `toLatest` of a v1 document sets `$schema` to `UNKNOWN` and drops `version`.
    In a development tree, the package reads what phax writes through the `next` rule.
- Update the fixtures:
    - typed literals use a fixed URL, for example `https://docs.phax.run/schemas/registry/0.16.0.json`;
    - assertions on documents phax wrote compare with `ownSchemaUrl(<id>)`;
    - v1 files that tests write to disk may stay v1, since `readOwn` covers them.
    List every test file touched as fixture fallout.

### Planned files to create

- `packages/schemas/snapshots/registry/next.schema.json`
- `packages/schemas/snapshots/run-status/next.schema.json`
- `packages/schemas/snapshots/phase-status/next.schema.json`
- `tests/integration/schemaUrlRunState.test.ts`

### Planned files to edit

- `src/schemas/schemaUrl.ts`
- `src/schemas/ownFormats.ts`
- `src/schemas/registry.ts`
- `src/schemas/status.ts`
- `src/app/registry.ts`
- `src/app/runFolder.ts`
- `src/app/phaseFolder.ts`
- `src/app/effectRunner.ts`
- `src/app/gates.ts`
- `src/app/phaseStatusUpdates.ts`
- `src/app/resetPhase.ts`
- `src/cli/interruptHandler.ts`
- `src/infra/providers/sessionWriter.ts`
- `packages/schemas/src/index.ts`
- `packages/schemas/src/generated/index.ts`
- `tests/unit/schemaUrl.test.ts`
- `tests/unit/schemas.test.ts`
- `tests/integration/registry.test.ts`

### Optional files that may be edited

- `src/cli/commands/run.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/type/schemasPackage.ts`

### Boundary contracts

Producers: `SchemaUrlSchema`, `ownSchemaUrl` and the generated index. Consumers: every writer of these three formats, and phase-11 to phase-13. Contract:
- phax writes only the `$schema` shape;
- phax reads v1 only through `readOwn`, meaning the package's frozen modules;
- the package's current shape is decoded by phax's own decoder.

### Test strategy

Write `tests/integration/schemaUrlRunState.test.ts` first, with fake ports:

- creating a run writes a registry, a run status and a phase status whose first key is `$schema`, equal to `ownSchemaUrl(<id>)`, with no `version`;
- the spec's legacy-registry criterion: with a v1 `~/.phax/registry.json` on disk, the `ls` use case lists its runs; the next registry write produces a file that starts with `$schema` naming `registry/<phaxRelease>`;
- a status transition on a run folder whose files are v1 rewrites them in the new shape, keeping every other field.

Update the `version` assertions in `schemas.test.ts` and `registry.test.ts`. In the package tests, v1 and `next` documents of each format parse with the right shape. The snapshot, corpus, parity and frozen-history tests stay green.

### Implementation order

1. SchemaUrlSchema and ownSchemaUrl, with tests.
2. Change the two schema modules.
3. Stamp every writer.
4. Run the snapshot check, record the findings, then --write.
5. Update the package types and toLatest.
6. Fix fixtures until test:type and test pass.

### Excluded scope

- The other formats (phase-11 to phase-13).
- Any shape change beyond adding `$schema` and dropping `version`.
- Rewriting documents on disk; they take the new shape at their next write.
- `phax.json` and the user overlay.

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

Record:
- the snapshot findings printed before `--write`, verbatim;
- the writer sites stamped;
- the recipe as applied, for phase-11 to phase-13 to repeat;
- the fixture URL convention;
- the fixture-fallout test files;
- any other deviation, with the reason.

### Commit subject

`feat(schemas): write $schema first in the registry and run and phase status, drop version`

### Commit body

The run registry, run-status.json and phase status.json now start with $schema, https://docs.phax.run/schemas/<format id>/<release>.json, where the release is the root package.json version, and carry no version. Every writer stamps it, read-modify-write paths included. A v1 registry or an in-flight v1 run still reads, through the package's frozen v1 decoders and toLatest, and takes the new shape at its next write.

The snapshot gate required registry, run-status and phase-status next.schema.json; they are recorded, and the package now decodes v1 through its frozen modules.

---

## phase-11 — $schema for phax-plan and the compliance review {#phase-11-schema-url-plan-review}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

`phax-plan.json` and `compliance-review.json` start with their `$schema` URL and carry no `version`. The agent-facing contracts (the extracted plan and the compliance verdict) are unchanged, and older run directories still read.

### Detailed instructions

- In `src/schemas/phaxPlan.ts`, the persisted `PhaxPlanSchema` gets `$schema: SchemaUrlSchema("phax-plan")` first and loses `version`. `ExtractedPhaxPlanSchema` stays at version 1 without `$schema`: it is the contract of extraction, the extraction cache and the plan-document projection.
- In `src/domain/plan/finalize.ts`, stop copying `extracted.version`. Build `{ $schema: ownSchemaUrl("phax-plan"), ...the other extracted fields }`. Check that `src/cli/commands/run.ts` and `runFolder.ts` keep `$schema` first.
- In `complianceReview.ts`, split the schema:
    - `AgentComplianceReviewSchema` and `decodeAgentComplianceReview`: the version-1 verdict the prompt describes; `compliancePrompt.ts` does not change;
    - `ComplianceReviewSchema`: the persisted document, with `$schema: SchemaUrlSchema("compliance-review")` first and the agent fields without `version`.
- In `reviewCompliance.ts`, decode the agent's file with the agent decoder. Instead of copying the raw text, write the persisted document, encoded with `ComplianceReviewSchema`. The missing-verdict path keeps its behavior. In the phase-09 guard, replace the `reviewCompliance.ts` exception with `decodeAgentComplianceReview`.
- Run the snapshot check and record the findings, then `--write`. In the package, the two formats gain their `next` shape, with types, `Latest` and `toLatest` as in phase-10.
- Update the fixtures by the phase-10 rule. Update the prompt snapshot only through a fixture using the fixed URL.

### Planned files to create

- `packages/schemas/snapshots/phax-plan/next.schema.json`
- `packages/schemas/snapshots/compliance-review/next.schema.json`
- `tests/integration/schemaUrlPlanReview.test.ts`

### Planned files to edit

- `src/schemas/phaxPlan.ts`
- `src/schemas/complianceReview.ts`
- `src/schemas/ownFormats.ts`
- `src/domain/plan/finalize.ts`
- `src/app/reviewCompliance.ts`
- `packages/schemas/src/index.ts`
- `packages/schemas/src/generated/index.ts`
- `tests/unit/architecturalGuards.test.ts`
- `tests/unit/schemas/complianceReview.test.ts`
- `tests/unit/extractPlanFinalize.test.ts`
- `tests/integration/reviewCompliance.test.ts`

### Optional files that may be edited

- `src/app/runFolder.ts`
- `src/cli/commands/run.ts`
- `tests/unit/__snapshots__/promptGeneration.test.ts.snap`

### Boundary contracts

There are two agent/phax boundaries:
- extraction produces `ExtractedPhaxPlan` v1, which phax finalizes into the persisted phax-plan;
- the compliance agent produces the v1 verdict, which phax persists as `compliance-review.json`.
Contract: the agent-facing shapes and the prompt text are unchanged; only phax knows `$schema`.

### Test strategy

Write `tests/integration/schemaUrlPlanReview.test.ts` first. It asserts that:

- the finalize-and-write path yields a `phax-plan.json` whose first key is `$schema`, equal to `ownSchemaUrl("phax-plan")`, with no `version`;
- a valid v1 verdict from the agent yields a persisted compliance review in the new shape, with the agent's fields unchanged;
- a v1 `phax-plan.json` and a v1 compliance review in an existing run still read through `readOwn`.

Update the listed unit tests. The package, snapshot and corpus tests stay green.

### Implementation order

1. phaxPlan and finalize.
2. The compliance split and reviewCompliance.ts.
3. The snapshot check, the findings, then --write.
4. The package types and toLatest.
5. The fixtures.

### Excluded scope

- The compliance prompt text, the extraction schema or its cache.
- Approvals, records and documents (phase-12 and phase-13).

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

Record:
- the agent and persisted schema names;
- the finalize and write-path changes;
- the snapshot findings, verbatim;
- whether the prompt snapshot changed;
- the fixture-fallout files;
- any other deviation, with the reason.

### Commit subject

`feat(schemas): write $schema first in phax-plan.json and compliance-review.json`

### Commit body

phax-plan.json and compliance-review.json now start with their $schema URL and carry no version. The shapes an agent produces are unchanged at version 1: the extracted plan, and the compliance verdict the review prompt describes. phax adds $schema when it writes the persisted file, and the compliance review is now re-encoded instead of copied verbatim.

Older run directories still read through the package. The snapshot gate recorded phax-plan and compliance-review next.schema.json.

---

## phase-12 — $schema for the approvals ledgers and the phase record {#phase-12-schema-url-ledgers-records}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

Both approvals ledgers and the phase record start with their `$schema` URL and carry no `version`. Existing ledgers keep every record, existing records still read, and the package identifies a renamed copy by `$schema` alone.

### Detailed instructions

- In `approvalRecord.ts` and `specApprovalRecord.ts`, each ledger's first field becomes `$schema: SchemaUrlSchema("plan-approvals")` or `SchemaUrlSchema("spec-approvals")`, and `version` goes.
- In `approvalRecordStore.ts`, write `{ $schema: ownSchemaUrl(<id>), records }`, including the empty stores. A v1 ledger already reads through `readOwn` (phase-09), so its records survive, and the next `put` or `remove` rewrites it: the live-ledger migration the spec names.
- In `runRecord.ts`, `$schema: SchemaUrlSchema("phase-record")` becomes the first field and `version` goes. In `src/domain/records/assemble.ts`, stamp `$schema` first. The union in `authoringRecord.ts` follows from its member schemas.
- Run the snapshot check and record the findings, then `--write`: phase-record's current shape becomes `next`, so v2 now decodes through its frozen twin. Types:
    - `ParsedShape<{ v1: PhaseRecordV1; v2: PhaseRecordV2; next: PhaseRecord }>`;
    - `LatestPhaseRecord` types `verifiedSurfaces` and `$schema` each as their value or `Unknown`;
    - `toLatestPhaseRecord` from v1 marks both unknown, and from v2 marks `$schema` unknown.
    `parseRecordManifest` and `toLatestRecordManifest` follow, and the approvals formats get the phase-10 recipe.
- Extend the package tests with the spec §6 examples:
    - `parseDocument` on a record assembled by phax returns format `phase-record` and shape `CURRENT_SHAPES["phase-record"]` (`next` in this tree; `0.17.0` once released);
    - the renamed-file criterion: the same record, as if copied to `exports/a.json`, and a plan ledger written by the store, as if copied to `exports/b.json`, are passed as values only and return `phase-record` and `plan-approvals`;
    - a record naming `0.19.0` fails with the spec's message.
- In `tests/unit/runRecord.test.ts`, phax's decoder now rejects v1 and v2 alike, while `readOwnPhaseRecord` reads v2 and refuses v1 naming `verifiedSurfaces`.
- Coordination: oracle-phases (an `oracle` surface) and artifact-decide (`approvedBy`) amend these unreleased `next` shapes in their own plans. Implement neither here.

### Planned files to create

- `packages/schemas/snapshots/plan-approvals/next.schema.json`
- `packages/schemas/snapshots/spec-approvals/next.schema.json`
- `packages/schemas/snapshots/phase-record/next.schema.json`
- `tests/integration/schemaUrlLedgersRecords.test.ts`

### Planned files to edit

- `src/schemas/approvalRecord.ts`
- `src/schemas/specApprovalRecord.ts`
- `src/schemas/runRecord.ts`
- `src/app/approvalRecordStore.ts`
- `src/domain/records/assemble.ts`
- `packages/schemas/src/index.ts`
- `packages/schemas/src/generated/index.ts`
- `tests/unit/runRecord.test.ts`
- `tests/unit/schemas/specApprovalRecord.test.ts`
- `tests/unit/schemasPackage/phaseRecordHistory.test.ts`
- `tests/unit/schemasPackage/parseDocument.test.ts`

### Optional files that may be edited

- `src/schemas/authoringRecord.ts`
- `tests/unit/recordsAssemble.test.ts`
- `tests/unit/artifact/lineage.test.ts`

### Boundary contracts

Producers: the approvals store and the record assembler. Consumers: the package's frozen decoders, and phax's readers (`records list`, `records explain`, artifact lineage) through `readOwn`. Contract: phax writes only the `$schema` shapes; older ledgers and records are read only through the package.

### Test strategy

Write `tests/integration/schemaUrlLedgersRecords.test.ts` first. It asserts that:

- approving a plan against a v1 `docs/plans/approvals.json` (fake fs) yields a ledger whose first key is `$schema`, with no `version` and every earlier record kept; likewise for the spec ledger;
- assembling a phase record yields `$schema` first and no `version`;
- `records explain` still reads a v2 record.

The package tests cover the §6 cases. The corpus, snapshot and frozen-history tests stay green.

### Implementation order

1. The approvals schemas and store.
2. The run record and assemble.ts.
3. The snapshot check, the findings, then --write.
4. The package types and toLatest.
5. The tests and fixtures.

### Excluded scope

- oracle-phases' `oracle` surface and artifact-decide's `approvedBy`.
- The store's behavior on corrupt files.
- The documents and the authoring record (phase-13).

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

Record:
- the store's behavior on a v1 ledger;
- the phase-record parse, `Latest` and `toLatest` types;
- the snapshot findings, verbatim;
- the fixture-fallout files;
- any other deviation, with the reason.

### Commit subject

`feat(schemas): write $schema first in approvals ledgers and phase records`

### Commit body

docs/plans/approvals.json, docs/specs/approvals.json and the phase record manifest now start with their $schema URL and carry no version. The approvals store reads a v1 ledger through the package, so an existing ledger keeps every record and is rewritten in the new shape at its next approval. records explain reads existing v2 records through the package.

The package decodes approvals v1 and phase record v1 and v2 through frozen modules. parseDocument identifies a copied record or ledger by its $schema alone. The snapshot gate recorded the three next.schema.json.

---

## phase-13 — $schema for spec and plan sidecars and the authoring record {#phase-13-schema-url-authoring}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

The spec and plan sidecars and the authoring record start with their `$schema` URL and carry no `version`, so every exported format is now identified by `$schema`. The headless authoring contract handed to the agent and printed by `phax artifact schema` is unchanged.

### Detailed instructions

- In `specDocument.ts` and `planDocument.ts`, keep `SpecDocumentSchema` and `PlanDocumentSchema` exactly as they are: they are the authored contract. Add `SpecDocumentSidecarSchema` and `PlanDocumentSidecarSchema`, each with `$schema: SchemaUrlSchema(<id>)` first and then the authored fields without `version`, and a decoder for each.
- In `authorArtifact.ts`, encode the sidecar with the sidecar schema, stamped with `ownSchemaUrl(<id>)` first, keeping the `sourceSpec` override for plans. The session's own `document.json` and the plan-cache seed keep the authored document.
- In `ownFormats.ts`, `readOwnSpecDocument` and `readOwnPlanDocument` now use the sidecar decoders as the current decoder. `sidecar.ts` is already routed through them. In the phase-09 guard, the authored decoders stay allowed only in `authorArtifact.ts`, and the sidecar decoders only in the bridge.
- In `authoringRecord.ts`, `$schema: SchemaUrlSchema("authoring-record")` becomes the first field and `version` goes. `isAuthoringRecordManifest` still discriminates on `kind`. Stamp it in `writeAuthoringRecord.ts`. The test that rejects `version: 2` now asserts that phax's decoder rejects any `version`.
- In the package, `SpecDocumentSchema`, `SpecDocument`, `PlanDocumentSchema` and `PlanDocument` now name the persisted sidecar format. Run the snapshot check and record the findings, then `--write` for the three `next` snapshots. The authoring v1 twin, which accepts both legacy shapes, now decodes literal 1. Update `parseRecordManifest`, `parseDocument` and `toLatest` to match.
- Create `schemaFirst.test.ts`. It asserts that:
    - for every registry format except the union, the current schema is a struct whose first property is `$schema` and which has no `version`;
    - `JSONSchema.make(SpecDocumentSchema)` and `JSONSchema.make(PlanDocumentSchema)` from `src/schemas` still deep-equal the `spec-document/v1` and `plan-document/v1` snapshots, which proves the authoring contract is unchanged.
- Update the fixtures by the phase-10 rule.

### Planned files to create

- `packages/schemas/snapshots/spec-document/next.schema.json`
- `packages/schemas/snapshots/plan-document/next.schema.json`
- `packages/schemas/snapshots/authoring-record/next.schema.json`
- `tests/integration/schemaUrlAuthoring.test.ts`
- `tests/unit/schemasPackage/schemaFirst.test.ts`

### Planned files to edit

- `src/schemas/specDocument.ts`
- `src/schemas/planDocument.ts`
- `src/schemas/authoringRecord.ts`
- `src/schemas/ownFormats.ts`
- `src/app/authorArtifact.ts`
- `src/app/writeAuthoringRecord.ts`
- `packages/schemas/src/index.ts`
- `packages/schemas/src/generated/index.ts`
- `tests/unit/architecturalGuards.test.ts`
- `tests/unit/authoringRecord.test.ts`
- `tests/integration/writeAuthoringRecord.test.ts`
- `tests/unit/artifact/sidecar.test.ts`

### Optional files that may be edited

- `src/domain/artifact/sidecar.ts`
- `src/app/artifactStatus.ts`
- `tests/integration/authorArtifact.test.ts`

### Boundary contracts

The authoring agent produces the authored v1 document, and phax persists the sidecar in the `$schema` shape. Contract: the authored schema, the prompt and the `phax artifact schema spec|plan` output stay byte-identical. The approval gate reads committed sidecars through `readOwn`.

### Test strategy

Write `tests/integration/schemaUrlAuthoring.test.ts` first. With a fake provider, a headless spec session and a headless plan session each write a sidecar and an authoring record whose first key is `$schema`, equal to `ownSchemaUrl(<id>)`, with no `version`.

Write `schemaFirst.test.ts` alongside it. In `sidecar.test.ts`, a v1 sidecar still reads. In the package tests, both legacy authoring shapes parse, and `parseDocument` identifies a new sidecar and a new authoring record. The corpus and snapshot tests stay green.

### Implementation order

1. The sidecar schemas, authorArtifact.ts and the bridge.
2. The authoring record and writeAuthoringRecord.ts.
3. The snapshot check, the findings, then --write; the package types.
4. schemaFirst.test.ts, the guard update and the fixtures.

### Excluded scope

- The authoring prompt, the `phax artifact schema` output, the skills and the renderers.
- headless-review's code-review and review-plan documents.
- artifact-decide's `history` field.

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

Record:
- the authored and sidecar schema names;
- the proof that the printed authoring schema is unchanged;
- the snapshot findings, verbatim;
- the fixture-fallout files;
- any other deviation, with the reason.

### Commit subject

`feat(schemas): write $schema first in spec and plan sidecars and authoring records`

### Commit body

Spec and plan JSON sidecars and authoring record manifests now start with their $schema URL and carry no version. The document an authoring agent returns, which phax artifact schema spec|plan prints, is unchanged at version 1: phax adds $schema only when it writes the sidecar. Artifacts and records authored before the upgrade still read through the package, so they still pass the approval gate.

The package decodes each v1 shape through its frozen module, including both legacy authoring-record shapes. A structural test pins $schema as the first field, with no version, in the latest shape of every format.

---

## phase-14 — Release: lockstep publish, next-snapshot rename, tarball smoke and release.sh {#phase-14-release-lockstep}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

A release tag stage-publishes `@lbdremy/phax` and `@lbdremy/phax-schemas` at the tag's version, or neither. `release.sh` bumps every manifest and renames every `next` snapshot to the release in one commit.

### Detailed instructions

- Add `--release <version>` to `scripts/schemas-snapshots.ts`, backed by a pure planner in `packages/schemas/build/snapshots.ts`. It requires the root `package.json` to already be at `<version>`. It refuses, changing nothing, when:
    - a `<id>/<version>.schema.json` exists;
    - `<version>` is at or below a released snapshot name of any format;
    - the full check has findings other than those the rename resolves.
    Otherwise it renames every `<id>/next.schema.json` to `<id>/<version>.schema.json`, rewrites the generated index (`PACKAGE_VERSION` and `CURRENT_SHAPES`), adds the lock entries of the renamed snapshots, and prints each rename.
- Create `scripts/smoke-schemas-package.sh` (bash, `set -euo pipefail`, after `pnpm build`), working in a temp directory:
    - `npm pack` in `packages/schemas`;
    - fail if the tarball holds a file compiled from `src/app`, `src/ports`, `src/infra` or `src/cli`, or any `.js` importing `node:*`, `fs`, `child_process` or `net`, or referencing `Deno`;
    - `npm init -y` with `"type": "module"`, then `npm install` the tarball;
    - fail if the top-level `node_modules` holds anything besides the package, `effect` and effect's own dependency closure;
    - build a temp git repo whose `phax/records/v1` holds a v2 corpus record at `<runId>/<phaseId>/record.json`;
    - run the spec §6 `read-record.mjs` with that key, and assert that it prints the runId, phaseId and outcome and exits 0.
- In `scripts/prepare-npm.ts`, also set and re-verify the version of `packages/schemas/package.json`.
- Reorder `.github/workflows/release.yml`:
    1. Gate, unchanged; its `pnpm build` builds the package and `pnpm test` runs the snapshot and corpus gates;
    2. build binaries;
    3. `bash scripts/smoke-schemas-package.sh`;
    4. prepare both manifests;
    5. verify that the tag equals `npm/package.json`, `packages/schemas/package.json` and the generated `PACKAGE_VERSION`, and that no `packages/schemas/snapshots/*/next.schema.json` exists;
    6. `npm stage publish --access public --provenance` in `npm`;
    7. the same in `packages/schemas`;
    8. the GitHub release.
    Add the smoke step after Build in `ci.yml`.
- In `scripts/release.sh`:
    - bump `packages/schemas/package.json` with `npm pkg set` alongside the other two manifests;
    - print `renaming snapshots/*/next.schema.json → <version>.schema.json` and run `pnpm exec tsx scripts/schemas-snapshots.ts --release <version>` (aborting on failure);
    - `git add` the schemas manifest, `packages/schemas/snapshots`, the generated index and the lock;
    - end with `approve the staged npm packages at:` and the two npmjs.com URLs, as in spec §6.
- Update `docs/release.md`: two packages, the smoke, the lockstep versions, `next` snapshots renamed by `release.sh`, and two packages to approve by hand.

### Planned files to create

- `scripts/smoke-schemas-package.sh`
- `tests/unit/schemasPackage/releaseSnapshots.test.ts`

### Planned files to edit

- `.github/workflows/release.yml`
- `.github/workflows/ci.yml`
- `scripts/release.sh`
- `scripts/prepare-npm.ts`
- `scripts/schemas-snapshots.ts`
- `packages/schemas/build/snapshots.ts`
- `tests/unit/releaseWorkflow.test.ts`
- `docs/release.md`

### Optional files that may be edited

- `scripts/releaseVersion.ts`
- `tests/unit/schemasPackage/manifest.test.ts`
- `knip.json`

### Boundary contracts

The workflow consumes the gate, the build and the smoke, and publishes to npm. Contract (§5.24): the two stage publishes are the last fallible steps, and before either runs, the manifests, the generated version and the tag agree and no `next` remains. `release.sh` produces one release commit carrying the three manifests, the renamed snapshots, the index and the lock.

### Test strategy

Write these first:

- `releaseSnapshots.test.ts` covers the spec criterion on a temp directory. With `phase-record/next.schema.json` and `registry/next.schema.json` present and the root at `0.17.0`, `--release 0.17.0` renames both, leaves no `next`, and updates the index and the lock. Each refusal case is tested too.
- Extend `releaseWorkflow.test.ts` to assert that:
  - the smoke and the verification run before the first stage publish;
  - there are exactly two stage publishes, in `npm` and `packages/schemas`;
  - prepare-npm handles both manifests;
  - release.sh bumps three manifests, calls `--release`, stages the files in its commit and names both packages last;
  - ci.yml runs the smoke.

The smoke needs `npm` and the network, so it cannot run in the phase agent. Its first run is the pull request's CI.

### Implementation order

1. The --release planner, the script mode and its test.
2. The smoke script.
3. prepare-npm.ts.
4. release.yml and ci.yml.
5. release.sh.
6. The workflow tests, then docs/release.md.

### Excluded scope

- Running the smoke in the phax gate or in check:full.
- Changing how @lbdremy/phax itself is built.
- Hosting schemas at docs.phax.run.

### Verification

The `standard` gate profile in `phax.json`. The first CI run verifies the smoke out of band.

### Expected handoff content

Record:
- the final release.yml step order;
- the smoke's checks and how it picks its record;
- the `--release` rules;
- the release.sh diff;
- a note that the smoke has not run inside the phase and must be confirmed on CI;
- any deviation, with the reason.

### Commit subject

`ci(release): stage-publish @lbdremy/phax-schemas in lockstep with @lbdremy/phax`

### Commit body

The release workflow now installs the packed schemas tarball into an empty Node project, where it parses a phax-written record read from a git records branch, checks the installed dependency set and scans the tarball for I/O. It then verifies that the tag, both manifests and the generated package version agree and that no next snapshot remains, and stage-publishes @lbdremy/phax and @lbdremy/phax-schemas. Every step that can fail runs before the first stage publish.

release.sh bumps the schemas manifest in the same release commit, renames every next snapshot to the version it cuts through schemas-snapshots.ts --release, and names both packages to approve. CI runs the same smoke.

---

## phase-15 — README persisted-formats table and reading phax files from code {#phase-15-readme-formats}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

The README carries one persisted-formats table and a "Read phax files from code" section for tool authors. A test keeps that table in step with the package.

### Detailed instructions

- In `README.md`, replace `## Experimental formats` with `## Persisted formats`. Add the table with columns Format, Where it lives and Read it with, one row per exported format except the union, following spec §6: run registry, run status, phase status, phax-plan, compliance review, plan approvals, spec approvals, phase record, spec document, plan document and authoring record. Under it, note that all of them come from `@lbdremy/phax-schemas`, and that `parseDocument` reads any of them. Precede the table with a short paragraph:
    - every document phax writes starts with `$schema: https://docs.phax.run/schemas/<format id>/<release>.json`, naming its format and the phax release that wrote it;
    - documents written before 0.17.0 carry a `version` literal instead;
    - every shape phax has ever written stays readable;
    - `phax artifact schema spec|plan` still prints the authoring contract.
- Add `## Read phax files from code`, following spec §11:
    - `npm install @lbdremy/phax-schemas`;
    - the §6 `read-record.mjs`: `git show phax/records/v1:<runId>/phase-01/record.json`, then `parsePhaseRecord(JSON.parse(raw))`, then branch on `parsed.ok` and read `parsed.value.outcome`;
    - `toLatestPhaseRecord` for mixed history, with absent facts as `{ kind: "unknown" }`;
    - `parseDocument` for a file whose name says nothing;
    - a pointer to `json/<format>.schema.json` for docs tooling;
    - a closing note: an older shape parses, a newer release asks you to upgrade the package, and the package version always equals the phax version.
- Point every `#experimental-formats` link outside `docs/specs` and `docs/plans` at `#persisted-formats`.
- Create `packages/schemas/README.md` for the npm page. Keep it short, linking to the phax README: what the package is, `Parsed`, `parseDocument`, `toLatest*`, `json/` and lockstep versioning.
- Create `tests/unit/schemasPackage/readmeFormats.test.ts`. It parses the README table and asserts that:
    - every registry format except `record-manifest` has exactly one row, matched by label;
    - each row's Read-it-with function is exported by the package entry;
    - each format's `json/<id>.schema.json` exists after a build, via `renderFormatJsonSchemas`.

### Planned files to create

- `packages/schemas/README.md`
- `tests/unit/schemasPackage/readmeFormats.test.ts`

### Planned files to edit

- `README.md`

### Optional files that may be edited

- `NEXT_STEPS.md`
- `docs/release.md`
- `packages/schemas/build/formats.ts`

### Test strategy

Write `readmeFormats.test.ts` first, against the planned table, then write the README until it passes. The rest of the phase is documentation.

### Implementation order

1. The README test.
2. The README table, the new section and the link fixes.
3. The package README.

### Excluded scope

- The 1.0 stability contract.
- The code-review row (added by the headless-review plan).
- Any change to docs/specs or docs/plans.

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

Record:
- the README section titles and anchors;
- the table rows;
- how the test matches rows to formats;
- any links you updated;
- any deviation, with the reason.

### Commit subject

`docs(readme): persisted-formats table and reading phax files with @lbdremy/phax-schemas`

### Commit body

Replace the README's Experimental formats section with one persisted-formats table. It lists every format the schemas package exports, where it lives and the function that reads it, and explains the $schema URL each document carries. Add a "Read phax files from code" section with the Node consumer example, parseDocument, toLatest and the json/ directory. A test keeps the table and the package's exports in agreement.
