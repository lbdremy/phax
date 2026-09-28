---
status: Abandoned
source-spec: docs/specs/2609241238-schemas-package.md
---
# Schemas package

Publish phax's persisted-format decoders as a standalone npm package, `@lbdremy/phax-schemas`. The package is built from the same `src/schemas` modules phax imports. It has a root entry for the eight stable formats, an `/experimental` entry for the spec document, the plan document, the authoring record and the record-manifest union, and ships one draft-07 JSON Schema per format that declares its stability. Its version is always phax's release version. It reads every format version phax has ever written.

The phases follow the brief's order.

- phase-01 and phase-02 build the package skeleton, the `Parsed` API for the current versions and the JSON Schemas.
- phase-03 tries the reading-history pattern on one format first: the phase record, with the frozen v1 decoder, `toLatest` and the newer-version failure. phase-04 then applies it to every format.
- phase-05 adds the committed JSON Schema snapshots and the snapshot gate.
- phase-06 adds the history-corpus script and the committed corpus, which is parsed in every gate (including the release gate).
- phase-07 to phase-10 add `producedBy` to every persisted format with its one-time version bump, so the snapshot gate sees each bump happen.
- phase-11 covers the release workflow and `release.sh`. phase-12 covers the README persisted-formats table and the "Read phax files from code" section.

Where each requirement lands:

| Spec requirement | Phases |
| --- | --- |
| §5.1–5.5, 5.7–5.9, 5.19 | 01 |
| §5.20–5.22 | 02 |
| §5.10–5.13 | 03 and 04 |
| §5.15 | 03, then every bump phase |
| §5.16 | 05 |
| §5.17–5.18 | 06 |
| §5.14 | 07–10 |
| §5.23–5.26 | 11 (lockstep constant from 03) |
| §5.6 | 12 |

§5.27 (the code-review document) is not implemented here. The headless-review plan adds it to the experimental entry through the format registry this plan creates.

What a phase agent can and cannot verify:

- phases 03, 04 and 06 read real history from the local clone of the records repository at `~/.phax/records/phax`. The spec author walked that clone on 2026-09-28.
- The packed-tarball smoke (phase-11) needs `npm` and network. It runs only in CI and the release workflow, so the phase agent cannot run it: its first real verification is the first CI run after merge.

Coordination: artifact-decide, headless-review and oracle-phases (all Approved) change formats this package exports. Their plans come after this one and change shapes through the snapshot gate. This plan implements none of their changes.

## Required commands

- `pnpm add`
- `pnpm exec tsx`
- `node`
- `git log`
- `git cat-file`
- `git ls-tree`

Every command above is already allowed by `security.agentCommands` in `phax.json`, so no configuration change is needed.

- `pnpm add` installs `ajv`, the draft-07 validator for the JSON Schema tests.
- `pnpm exec tsx` runs the new build, snapshot and corpus scripts.
- `node` extracts the phase-03/04 corpus seeds from the records clone.
- `git log`, `git cat-file` and `git ls-tree` inspect history.

The tarball smoke uses `npm pack`/`npm install`, so it runs only in CI and the release workflow, never in a phase agent.

## Technical arbitrations

- Build: a second tsc project over the same sources (`packages/schemas/tsconfig.build.json`, rootDir at the repo root, include limited to the two entry modules so tsc emits only their import closure, `types: []` so a `node:` import is a compile error). Loss accepted: a flat dist layout — the package's dist mirrors repo paths (`dist/packages/schemas/src/index.js`, `dist/src/schemas/*.js`) and the exports map points into it. An esbuild bundle was rejected: its declarations would no longer be tsc's own output for phax's types.
- Package location: `packages/schemas/`, kept outside the pnpm workspace and driven by root scripts, with `effect` resolved from the root install. Loss accepted: pnpm does not install or check the package's own dependency list separately. A unit test pins it to exactly `effect` at the root's range.
- Corpus source (§10 open): the corpus script takes a required `--records <path>` argument naming a git repository that holds `phax/records/v1` (for phax, `~/.phax/records/phax`). Ledgers and sidecars come from `--repo` (default: the current directory). Loss accepted: the script does not follow `phax.json`'s records destination, so the caller must know where their records clone lives.
- Release version: one committed constant, `PHAX_RELEASE_VERSION` in `src/domain/release.ts`. release.sh bumps it and a test pins it to both manifests. It feeds `producedBy` and the package version named in newer-version failures. Loss accepted: a third place a release must bump. Rejected: passing `readPackageVersion` from the CLI through a Context service into every writer, which every use case and test layer would then have to provide.
- Previous-version lift in phax: when a format gains `producedBy`, phax's own decoder for it lifts exactly the previous version (sets the new version literal and `producedBy` to the reading release) before the current decoder judges the document. The frozen historical decoders stay in the package only (§5.15). Loss accepted: the writer is no longer unaware of history — it knows one previous version literal per format. Rejected: refusing the previous version. After an upgrade that would break every command on `~/.phax/registry.json`, block resuming in-flight runs, block approval of sidecars written before the upgrade, make `records explain` reject every existing v2 record, and let the approvals store's empty-on-decode-failure path wipe the ledger.
- Agent-facing contracts stay unchanged. These are the headless spec/plan document schema (`phax artifact schema spec|plan` and the authoring prompt), the extracted-plan schema, and the compliance-review shape in the review prompt. They stay at version 1 without `producedBy`, and phax stamps the field and the bumped version when it writes the persisted file. Loss accepted: two schemas per agent-produced format (authored vs persisted) that must stay in step. Rejected: making the agent write `producedBy`. It does not know phax's release, and the CLI's printed schema would change, which the spec excludes.
- Unknown marker: `{ kind: "unknown" }` with no origin version, and `toLatest*` sets `version` to the latest literal. Loss accepted: the upgraded value no longer says which version it came from, so a consumer that needs it reads `version` before upgrading.
- Authoring record v1 is frozen only in phase-10, when phax stops writing it. Until then v1 is the current version, and parity (§5.8) requires phax's own decoder for it. phase-04 already proves that both legacy shapes (with and without `sourceSha`) parse. Loss accepted: the brief's placement of the frozen authoring v1 decoder in the history phases moves to the bump phase.
- Tarball install smoke (§10 open) runs in the release workflow and CI, not in `pnpm check:full` or the phax gate profile. Loss accepted: a green local gate does not prove that the packed tarball installs and imports.
- Snapshot writes: `--write` only creates missing snapshots and never overwrites one. The later same-release specs change an unreleased version by an explicit snapshot delete plus `--write`, which is visible in review. Loss accepted: the gate alone cannot tell released snapshots from unreleased ones.
- Shipped JSON Schemas describe the current version only (what phax writes), while the committed per-version snapshots stay unshipped. Loss accepted: a docs pipeline cannot validate an older-version document against the shipped JSON Schema.
- `SurfaceSchema` moves from `phaxConfig.ts` to `src/schemas/surface.ts`, so the published closure excludes phax.json's config schemas. Loss accepted: one more module, with importers updated directly (no re-export shim).
- Parity corpus (§10 open): inline accept/reject cases in one test that runs both phax's decoder and the package's parse function on each case. Loss accepted: no fixture files that tools outside the repo could reuse.
- Spellings (§10 open): the field is `producedBy` (`phax@X.Y.Z`); parse functions, schemas and types follow the spec's §6 table; JSON Schema files are `json/<id>.schema.json` with ids registry, run-status, phase-status, phax-plan, compliance-review, plan-approvals, spec-approvals, phase-record, spec-document, plan-document, authoring-record and record-manifest; the stability keyword is `x-phax-stability`; the README section becomes `## Persisted formats` (`#persisted-formats`).

---

## phase-01 — Package skeleton, stable and experimental entries, Parsed API {#phase-01-package-skeleton}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

A standalone `@lbdremy/phax-schemas` package exists in the repo. It builds from phax's own `src/schemas` modules and exports, for the version phax writes today, a schema, a type and a `Parsed`-returning parse function per format: stable formats from the root entry, experimental ones from `/experimental`. Its accept or reject verdict matches phax's own decoder (parity).

### Detailed instructions

- Move `SurfaceSchema` and its `Surface` type from `src/schemas/phaxConfig.ts` to a new `src/schemas/surface.ts`. Update `phaxConfig.ts`, `runRecord.ts` and `gateAttribution.ts` to import it from there, and fix any other importer tsc reports. Do not re-export it from `phaxConfig.ts` (no shim). No schema changes shape.
- Create `packages/schemas/package.json` with:
  - `name` `@lbdremy/phax-schemas` and `version` equal to the root `package.json` version (0.16.0);
  - `type` `module`, `license` `Apache-2.0` and `engines.node` `>=20`;
  - `dependencies` exactly `{ "effect": <the root range, ^3.14.0> }`;
  - `files` `["dist", "json"]`;
  - `exports` for `.` and `./experimental` (each `{ types, default }`, pointing at the tsc output — confirm the emitted paths, expected `./dist/packages/schemas/src/index.{js,d.ts}` and `./dist/packages/schemas/src/experimental.{js,d.ts}`), plus `"./json/*": "./json/*"`.

  No scripts, no devDependencies. Do not add it to `pnpm-workspace.yaml`.
- Create `packages/schemas/tsconfig.build.json` extending `../../tsconfig.json` with:
  - `rootDir` `../..` and `outDir` `./dist`;
  - `include` exactly `["src/index.ts", "src/experimental.ts"]`, so tsc emits only their import closure;
  - `types` `[]` and lib ES2023, so any `node:` import in the closure fails to compile;
  - `declaration` true, `declarationMap` false and `sourceMap` false.
- Create `packages/schemas/src/parsed.ts`. It exports the `Parsed<T>` union exactly as spec §6 gives it (`{ ok: true; value } | { ok: false; error: { path: string; message: string } }`, all readonly), plus a `fromEither` helper. The helper turns an `Either<T, ParseError>` into `Parsed<T>` using `ParseResult.ArrayFormatter`: `path` is the first issue's path joined with `.` (`""` at the root), and `message` is that issue's message. It must never throw.
- Create `packages/schemas/src/index.ts` (root entry, stable formats only), exporting for each format its schema constant, its type and a parse function:
  - run registry: `RegistrySchema`, `Registry`, `parseRegistry`;
  - run status: `RunStatusSchema`, `RunStatus`, `parseRunStatus`;
  - phase status: `PhaseStatusSchema`, `PhaseStatus`, `parsePhaseStatus`;
  - phax-plan: `PhaxPlanSchema`, `PhaxPlan`, `parsePhaxPlan`;
  - compliance review: `ComplianceReviewSchema`, `ComplianceReview`, `parseComplianceReview`;
  - plan approvals: `PlanApprovalsSchema`/`PlanApprovals` (phax's `ApprovalRecordFileSchema`), `parsePlanApprovals`;
  - spec approvals: `SpecApprovalsSchema`/`SpecApprovals` (phax's spec approval record file), `parseSpecApprovals`;
  - phase record manifest: `PhaseRecordSchema`/`PhaseRecord` (phax's `RunRecordManifestSchema`), `parsePhaseRecord`;
  - plus `type Parsed`.

  Each parse function is `(input: unknown) => fromEither(phaxDecodeX(input))`, calling phax's existing `decodeX` from `src/schemas` so the schema and the `onExcessProperty` setting are phax's own. Never re-declare a schema or its decode options. If a format has no exported decoder yet (check `phaxPlan.ts` and `specApprovalRecord.ts`), export phax's existing decode function from its module rather than building one in the package.
- Create `packages/schemas/src/experimental.ts` with the same pattern for the experimental formats:
  - spec document: `SpecDocumentSchema`, `SpecDocument`, `parseSpecDocument`;
  - plan document: `PlanDocumentSchema`, `PlanDocument`, `parsePlanDocument`;
  - authoring record: `AuthoringRecordSchema`/`AuthoringRecord` (phax's `AuthoringRecordManifestSchema`), `parseAuthoringRecord`;
  - record manifest union: `RecordManifestSchema`, `RecordManifest`, `parseRecordManifest`;
  - plus `type Parsed`.

  No stable format may be exported here.
- Change the root `package.json` `build` script to `tsc -p tsconfig.build.json && tsc -p packages/schemas/tsconfig.build.json`. Leave every other script unchanged.
- Add `packages/schemas/src/**/*` to the `include` of `tsconfig.test.json`, so `pnpm test:type` typechecks the package sources.
- In `knip.json`, add `packages/schemas/src/index.ts` and `packages/schemas/src/experimental.ts` to `entry` (public entry points whose exports are used by consumers) and `packages/schemas/src/**/*.ts` to `project`.
- Add a `describe("architectural guard: schemas package closure")` block to `tests/unit/architecturalGuards.test.ts`. It resolves relative imports transitively from both entry modules (map `.js` specifiers to `.ts`) and asserts that:
  - every reached file is under `packages/schemas/src/`, `src/schemas/` or `src/domain/`, and none is under `src/app/`, `src/ports/`, `src/infra/` or `src/cli/`;
  - no reached file imports a `node:` module, `fs`, `child_process`, `net`, `os`, `path` or `@effect/platform*`, and none references `Deno`;
  - the only bare-specifier imports are `effect` and `effect/*`;
  - `src/schemas/vibeOutput.ts` and `src/schemas/phaxConfig.ts` are not reached.

  Reuse the helpers the file already has for walking sources.
- Do not change the CLI, any phax decoder, or any persisted shape.

### Planned files to create

- `packages/schemas/package.json`
- `packages/schemas/tsconfig.build.json`
- `packages/schemas/src/index.ts`
- `packages/schemas/src/experimental.ts`
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

- `.oxlintrc.json`
- `src/schemas/phaxPlan.ts`
- `src/schemas/specApprovalRecord.ts`

### Boundary contracts

Producer: phax's `src/schemas` modules own each format's schema and `decodeX` function (with its `onExcessProperty` setting). Consumer: the schemas package's entries, which re-export those schemas and types and wrap those decoders into `Parsed`. The contract is that the package never declares a schema or decode option of its own for a version phax writes. Parity holds by construction, and the parity test holds it in place. Consumer outside the repo: a Node 20+ ESM program importing `@lbdremy/phax-schemas` or `@lbdremy/phax-schemas/experimental`, with the shapes and spellings from spec §6.

### Test strategy

Write these first (stable contracts):
- `tests/unit/schemasPackage/parse.test.ts`: a valid run-status value returns `ok: true` with the value; a run-status with state `paused` returns `ok: false`, `error.path` `state` and a non-empty message, with no exception escaping; a non-object input returns a failure.
- `tests/unit/schemasPackage/parity.test.ts`: per exported format, inline accepted and rejected cases, each run through both phax's `decodeX` and the package's `parseX` with the verdicts required to agree. It includes the AC cases: a phase record with one unknown key is rejected by both, and a registry with one unknown key is accepted by both.
- `tests/unit/schemasPackage/exports.test.ts`: the runtime export names of each entry equal the exact expected set; no stable format is on `/experimental` and no experimental one on the root.
- `tests/unit/schemasPackage/manifest.test.ts`: `name`, the single `effect` dependency equal to the root range, the version equal to the root version, the `exports` keys and the `files` list.
- `tests/type/schemasPackage.ts`: for each exported format, a value of the package type is assignable to phax's internal type and the reverse (§5.19).

The closure guard runs in `pnpm audit:architecture`.

### Implementation order

1. Move SurfaceSchema to src/schemas/surface.ts and update its importers.
2. parsed.ts and its unit test.
3. The two entry modules, the parity and exports tests, and the type test.
4. The package manifest and build tsconfig, then the root build script, tsconfig.test.json and knip.json.
5. The closure guard in architecturalGuards.test.ts, then run pnpm build to confirm the emitted dist paths match the exports map.

### Excluded scope

- JSON Schema files (phase-02).
- Any historical version, toLatest or newer-version failure (phases 03–04).
- producedBy or any version bump (phases 07–10).
- Release workflow, release.sh and README (phases 11–12).
- The code-review document (added by the headless-review plan).

### Verification

The `standard` gate profile in `phax.json`: format, typecheck, test:type, lint, format:check, test, knip, audit:architecture and the model-catalog check on every phase; build and the two Deno smokes on the terminal phase. `pnpm build` is itself a gate command, so run it to confirm the package compiles.

### Expected handoff content

- The exact emitted dist paths and the final `exports` map.
- The export names of both entries, and which phax `decodeX` each parse function wraps (including any decoder you had to export from its module).
- The name of the closure-guard describe block and the list of files it reached.
- The `SurfaceSchema` move and every importer you updated.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(schemas-package): add @lbdremy/phax-schemas with stable and experimental entries`

### Commit body

Add the schemas package under packages/schemas. It is built by a second tsc project whose only inputs are the two entry modules, so tsc emits nothing beyond their import closure. The root entry exports a schema, a type and a parse function for the eight stable formats. The experimental entry does the same for the spec document, the plan document, the authoring record and the record-manifest union. Each parse function wraps phax's own decoder and returns a Parsed result instead of throwing.

SurfaceSchema moves to src/schemas/surface.ts so the published closure no longer reaches phax.json's config schemas. An architectural guard pins the closure: no app/ports/infra/cli file, no Node or Deno I/O, and no vibeOutput.ts or phaxConfig.ts.

---

## phase-02 — JSON Schema per format with stability, build fails on a gap {#phase-02-json-schemas}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

Building the schemas package produces one draft-07 JSON Schema file per exported format. Each file is generated from the same schema its parse function uses and declares the format as stable or experimental. The build fails, naming the format, whenever a schema cannot be rendered.

### Detailed instructions

- Create `packages/schemas/build/formats.ts`, the format registry. It is the single source the build, the snapshots (phase-05) and the README classification test (phase-12) read. Each exported format gets one entry with:
  - `id` — the JSON file stem: `registry`, `run-status`, `phase-status`, `phax-plan`, `compliance-review`, `plan-approvals`, `spec-approvals` or `phase-record` for the root entry, and `spec-document`, `plan-document`, `authoring-record` or `record-manifest` for the experimental entry;
  - `label` — the human name used in messages, e.g. `phase record`;
  - `title`, e.g. `phax run status`;
  - `stability` — `"stable"` or `"experimental"` (the entry follows from it: stable is on the root, experimental on `/experimental`);
  - `schema` — the current Effect schema, imported from the package entries rather than from `src/schemas` directly.

  Export the list as a readonly array.
- Create `packages/schemas/build/jsonSchemas.ts`, which exports a pure `renderFormatJsonSchemas(formats)`. For each format it calls `JSONSchema.make(schema)` (Effect v3, draft-07) inside try/catch. A throw becomes a failure `{ id, label, message }`; otherwise the output is the rendered object plus `title` (the registry title when the render has none) and `"x-phax-stability"`. The function returns every file when all formats render, and otherwise the list of failures with no files.
- Create `scripts/build-schemas-package.ts`. It renders the registry. On any failure it prints `✗ <label>: <message>` per failed format, writes nothing and exits 1. Otherwise it empties `packages/schemas/json/` and writes each `<id>.schema.json` as JSON with two-space indent and a trailing newline. Export the main logic as a function behind a main guard so tests can call it.
- Change the root `build` script to `tsc -p tsconfig.build.json && tsc -p packages/schemas/tsconfig.build.json && tsx scripts/build-schemas-package.ts`. Add `packages/schemas/json/` to `.gitignore`.
- Run `pnpm add -D ajv` to get a draft-07 validator for the tests.
- Check that every current schema renders with the installed Effect (see package.json). `BranchNameSchema` in `src/domain/branded.ts` is a `Schema.filter` and `ApprovalRecordSchema` uses `Schema.pattern`. If `JSONSchema.make` refuses one of them, add a `jsonSchema` annotation to it — annotations only, never a change to what decodes.
- Register `packages/schemas/build/*.ts` and `scripts/build-schemas-package.ts` in `knip.json` as needed so no export is reported unused.

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
- `tests/unit/schemasPackage/exports.test.ts`
- `tsconfig.test.json`
- `.oxfmtrc.json`

### Boundary contracts

Producer: the format registry in `packages/schemas/build/formats.ts`, which lists the exported formats, their stability and the current schema per format. Consumers: the JSON Schema build here, the snapshot gate (phase-05) and the README classification test (phase-12). Contract: every exported parse function has exactly one registry entry, and the entry's schema is the same object that parse function decodes with. Consumer outside the repo: a docs pipeline reading `node_modules/@lbdremy/phax-schemas/json/<id>.schema.json` with a draft-07 validator.

### Test strategy

Write `tests/unit/schemasPackage/jsonSchemas.test.ts` first. It checks that:
- the registry has exactly one entry per exported parse function across both entries;
- `renderFormatJsonSchemas` on the real registry succeeds, with one file per format and each file's `x-phax-stability` matching its registry stability (`spec-document` declares `experimental`, `run-status` declares `stable`);
- ajv in draft-07 mode compiles every file and validates one phax-written document per format (build each document with phax's encoders or the literals existing tests use);
- an injected registry entry whose schema `JSONSchema.make` refuses (e.g. a `Schema.declare` without annotation — confirm what the installed Effect refuses) yields a failure naming that format and no file for it.

### Implementation order

1. The format registry.
2. The pure renderer and its tests, including the gap case.
3. The build script and the root build script change.
4. ajv and the validation tests.
5. Any jsonSchema annotation the real schemas need; then run pnpm build.

### Excluded scope

- Committed snapshots and the snapshot gate (phase-05).
- JSON Schemas for historical versions: the shipped files describe the current version only.
- Hosting the schemas at a URL.
- The code-review document.

### Verification

The `standard` gate profile in `phax.json`. Run `pnpm build` (a gate command) to confirm `packages/schemas/json/` is produced.

### Expected handoff content

- The registry module path and its entry shape.
- The list of ids.
- The renderer's signature and failure shape.
- The build script's exported function name.
- Whether any schema needed a jsonSchema annotation, and which one.
- The exact root build script.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(schemas-package): ship one draft-07 JSON Schema per format with its stability`

### Commit body

Add the format registry, the single list of exported formats with their id, label, title and stability. A pure renderer turns each current schema into a draft-07 JSON Schema declaring x-phax-stability. The build script writes packages/schemas/json/<id>.schema.json and fails, naming the format and writing nothing, when any schema cannot be rendered. pnpm build now runs it. Tests validate one phax-written document per format with ajv.

---

## phase-03 — Phase record history: frozen v1, toLatest, newer-version failure {#phase-03-phase-record-history}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

On the phase record alone, a consumer can parse every version phax has written (v1 and v2), get each version's exact shape discriminated by `version`, upgrade it to the latest shape with absent facts marked unknown, and get a clear upgrade-the-package failure for a newer document. The pattern is proven here before phase-04 repeats it for every format.

### Detailed instructions

- Create `src/domain/release.ts` exporting `PHAX_RELEASE_VERSION = "0.16.0"` (the root package.json version). It is pure: a string constant, no I/O.
- Extend `tests/unit/schemasPackage/manifest.test.ts` to assert that `PHAX_RELEASE_VERSION`, the root `package.json` version and `packages/schemas/package.json` version are all equal.
- Create `packages/schemas/src/versioned.ts` with:
  - the unknown marker: `export type Unknown = { readonly kind: "unknown" }` and a frozen `UNKNOWN` constant;
  - a pure semver comparison of numeric `X.Y.Z` triples;
  - a helper that builds a version-dispatching parse function from a label, a map of version number to decode function (each returning `Either`), and the latest version.

  The dispatch works as follows:
  - A non-object input, or a missing or non-numeric `version`, is a failure at path `version` listing the known versions.
  - A `version` above the latest is a failure at path `version` with the message `<label> version <n> (<producedBy>) is newer than @lbdremy/phax-schemas <PHAX_RELEASE_VERSION> — upgrade the package`, dropping the parenthesis when there is no producer.
  - A `producedBy` string of the form `phax@X.Y.Z` newer than `PHAX_RELEASE_VERSION` is the same kind of failure, naming the producer.
  - A known version goes to that version's decoder through `fromEither`.
  - An unknown lower version is a failure listing the known versions.

  It never throws.
- Create `packages/schemas/src/history/phaseRecord.v1.ts`, the frozen v1 decoder:
  - Reconstruct the v1 shape from `git log -p -- src/schemas/runRecord.ts` (v1 predates `verifiedSurfaces`, added in 0.10) and check it against the real v1 records.
  - It is self-contained: it imports only `effect` and inlines every sub-schema as it was at v1 (shape, outcome, token usage, provider id), never importing `src/schemas`.
  - Use the same `onExcessProperty: "error"` as phax.
  - Export `PhaseRecordV1Schema`, `type PhaseRecordV1` and a decode function.

  Once released, this file never changes.
- Update `packages/schemas/src/index.ts`:
  - `parsePhaseRecord` becomes the versioned dispatch over `{ 1: frozen v1, 2: phax's decodeRunRecordManifest }` and returns `Parsed<AnyPhaseRecord>`, where `AnyPhaseRecord = PhaseRecordV1 | PhaseRecordV2` and `PhaseRecordV2` is phax's type. `PhaseRecord` and `PhaseRecordSchema` stay the current version.
  - Export `LatestPhaseRecord`: `PhaseRecord` with `verifiedSurfaces` typed `ReadonlyArray<Surface> | Unknown`.
  - Export the pure `toLatestPhaseRecord(record: AnyPhaseRecord): LatestPhaseRecord`. For v2 it keeps every field. For v1 it keeps every field v1 carried, sets `verifiedSurfaces` to `UNKNOWN` and `version` to 2. It never invents a value.
  - Also export the types `PhaseRecordV1`, `PhaseRecordV2`, `AnyPhaseRecord`, `LatestPhaseRecord` and `Unknown`.
- Create `packages/schemas/history.lock.json`, mapping each file under `packages/schemas/src/history/` (path relative to `packages/schemas`) to the sha256 hex of its bytes. Compute the hash only after the file is final. Add `packages/schemas/src/history`, `packages/schemas/corpus` and `packages/schemas/snapshots` to `ignorePatterns` in `.oxfmtrc.json`, so the formatter never rewrites frozen or generated bytes.
- Seed the corpus with real phase records. Use `node -e` with `child_process.execFileSync("git", ["-C", <home>/.phax/records/phax, ...])`:
  - resolve `phax/records/v1`, falling back to `refs/remotes/origin/phax/records/v1`;
  - list every commit with `rev-list`, since each commit carries its own tree;
  - per commit, list `*/record.json` paths with `ls-tree -r --name-only`, skipping `authoring/`, and read each with `cat-file -p`;
  - write every distinct v1 phase record and at least three v2 ones into `packages/schemas/corpus/phase-record/v1/` and `.../v2/`.

  The naming contract is binding for phase-06's script: file content is `JSON.stringify(value, null, 2) + "\n"` of the parsed document, and the file name is the first 16 hex characters of the sha256 of that content, plus `.json`.
- Add a guard to `tests/unit/architecturalGuards.test.ts`: no file under `src/` imports anything under `packages/schemas/`. phax imports only the decoder of the version it writes (§5.15).
- Stop at the phase record. Other formats come in phase-04.

### Planned files to create

- `src/domain/release.ts`
- `packages/schemas/src/versioned.ts`
- `packages/schemas/src/history/phaseRecord.v1.ts`
- `packages/schemas/history.lock.json`
- `tests/unit/schemasPackage/phaseRecordHistory.test.ts`
- `tests/unit/schemasPackage/frozenHistory.test.ts`

### Planned files to edit

- `packages/schemas/src/index.ts`
- `tests/unit/schemasPackage/exports.test.ts`
- `tests/unit/schemasPackage/manifest.test.ts`
- `tests/unit/architecturalGuards.test.ts`
- `.oxfmtrc.json`

### Optional files that may be edited

- `tests/unit/schemasPackage/parity.test.ts`
- `tests/type/schemasPackage.ts`
- `packages/schemas/build/formats.ts`
- `knip.json`

### Boundary contracts

Producer: `packages/schemas/src/versioned.ts`, which provides the version-dispatch helper, `Unknown`/`UNKNOWN` and the newer-version failure. Consumers: every format's parse function (phase-04 onward) and the producedBy bumps (phases 07–10), which add a frozen decoder to a format's map. Contract: a format's parse function is a map from version to decoder, where the latest version maps to phax's own decoder and every older version maps to a frozen module in `packages/schemas/src/history/` that imports only `effect`. Producer: `src/domain/release.ts` (`PHAX_RELEASE_VERSION`). Consumers: the package's newer-version check now, and phax's `producedBy` stamping from phase-07.

### Test strategy

Write `tests/unit/schemasPackage/phaseRecordHistory.test.ts` first. It checks that:
- every corpus document under `phase-record/v1` and `v2` parses `ok` with `value.version` equal to its directory version, and narrowing on `version` typechecks to the exact shape;
- a v2 document edited to `version: 3` with `producedBy: "phax@99.0.0"` returns a failure whose message names 3, `PHAX_RELEASE_VERSION` and the word upgrade, with no exception;
- a v2 document with a newer producer also fails;
- `toLatestPhaseRecord` on a v1 corpus record gives `verifiedSurfaces` equal to `{ kind: "unknown" }` and every v1 field unchanged;
- on a v2 record it keeps every field.

`tests/unit/schemasPackage/frozenHistory.test.ts` checks that every file under `packages/schemas/src/history/` has a `history.lock.json` entry with a matching sha256, and that every entry names an existing file.

The parity test must stay green for v2.

### Implementation order

1. src/domain/release.ts and the manifest test extension.
2. versioned.ts with unit coverage of dispatch, the newer-version and newer-producer failures, and the semver comparison.
3. The frozen phaseRecord.v1.ts, reconstructed from git history.
4. The corpus seeds from the records clone.
5. The index.ts dispatch, toLatestPhaseRecord and the new types.
6. history.lock.json, the frozen-history test, the oxfmt ignores and the src→package import guard.

### Excluded scope

- Every format other than the phase record (phase-04).
- The corpus extraction script (phase-06); seeds here are copied by hand under the binding naming contract.
- Snapshots (phase-05).
- producedBy and the v3 bump (phase-09).

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

- The `versioned.ts` API (helper signature, `Unknown`, `UNKNOWN`, the failure message format).
- The reconstructed v1 shape and how it differs from v2.
- The number of v1 and v2 seeds written.
- The corpus naming contract as implemented.
- The `history.lock.json` format.
- The new export names.
- The corpus files are expected unplanned creations under `packages/schemas/corpus/phase-record/`; list them as such.
- Any other deviation, with the reason.

### Commit subject

`feat(schemas-package): read phase record v1 and v2 history, upgrade to latest`

### Commit body

Validate the reading-history pattern on one format first. parsePhaseRecord now reads version 1 with a frozen, self-contained decoder and version 2 with phax's own decoder. It returns the exact shape of each version and fails, without throwing, on a version or producer newer than the package, naming the package version to upgrade to. toLatestPhaseRecord upgrades a v1 record in memory and marks verifiedSurfaces as { kind: "unknown" }.

The release version becomes one constant, src/domain/release.ts, pinned to both manifests by test. history.lock.json pins every frozen module's bytes, and a guard keeps src/ from importing the package. Real v1 and v2 records from the records branch seed the corpus.

---

## phase-04 — History for every format: dispatch, toLatest, newer failure {#phase-04-history-all-formats}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

Every format exported by the package reads through the same versioned dispatch as the phase record. Each has a `toLatest` function, and each returns the upgrade-the-package failure for a newer document. The record-manifest union reads any record on `phax/records/v1`, and both legacy authoring-record v1 shapes parse.

### Detailed instructions

- For every exported format other than the phase record, rewrite its parse function as the `versioned.ts` dispatch with a single entry mapping the current version to phax's own decoder. The formats are registry, run status, phase status, phax-plan, compliance review, plan approvals, spec approvals, spec document, plan document and authoring record. Behavior on current-version documents is unchanged (parity).
- For every format, export a pure `toLatest<Format>` function. The names are `toLatestRegistry`, `toLatestRunStatus`, `toLatestPhaseStatus`, `toLatestPhaxPlan`, `toLatestComplianceReview`, `toLatestPlanApprovals`, `toLatestSpecApprovals`, `toLatestSpecDocument`, `toLatestPlanDocument`, `toLatestAuthoringRecord` and `toLatestRecordManifest`. Export `Any<Format>` and `Latest<Format>` types for each. Where a format has one version, `Any` and `Latest` are the current type and `toLatest` returns the record's fields unchanged. The bump phases (07–10) widen them.
- `parseRecordManifest` dispatches on `kind`: `"authoring"` goes to `parseAuthoringRecord`, anything else to `parsePhaseRecord`, so every phase-record version is readable through the union. `toLatestRecordManifest` dispatches the same way.
- The authoring record's v1 is still the version phax writes, so its decoder stays phax's own. Do not create a frozen `authoringRecord.v1.ts` yet (phase-10 does, when v1 stops being written).

  Seed the corpus with every distinct authoring record from the records clone (the `authoring/<id>/record.json` paths across every commit), using the same `node` and `git -C` approach and naming contract as phase-03, into `packages/schemas/corpus/authoring-record/v1/`. The seeds must include records both with and without `sourceSha`.
- Update `tests/unit/schemasPackage/exports.test.ts` for the new runtime exports.
- Keep the format registry in step if its entries need anything new.

### Planned files to create

- `tests/unit/schemasPackage/formatHistory.test.ts`

### Planned files to edit

- `packages/schemas/src/index.ts`
- `packages/schemas/src/experimental.ts`
- `tests/unit/schemasPackage/exports.test.ts`

### Optional files that may be edited

- `packages/schemas/src/versioned.ts`
- `packages/schemas/build/formats.ts`
- `tests/type/schemasPackage.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/phaseRecordHistory.test.ts`
- `tests/unit/schemasPackage/parse.test.ts`

### Boundary contracts

Producer: each entry's parse function and its `toLatest` function. Consumer: a third-party reader walking history, e.g. the cockpit walking `phax/records/v1` through `parseRecordManifest`. Contract: `parse` returns the exact shape of the document's version, discriminated by `version` (and by `kind` for the union); `toLatest` returns the latest shape with absent facts as `{ kind: "unknown" }`, never an invented value.

### Test strategy

Write `tests/unit/schemasPackage/formatHistory.test.ts` first. It checks, for every format:
- a current-version document with `version` set one above the latest fails, naming the version and the package version, without throwing;
- `toLatest` of a current document keeps every field.

For the authoring and union cases it checks that:
- every authoring-record corpus seed parses `ok`, with at least one seed with `sourceSha` and one without;
- `parseRecordManifest` reads a v1 phase record, a v2 phase record and a v1 authoring record from the corpus.

### Implementation order

1. Rewrite the root-entry parse functions on the versioned dispatch.
2. Rewrite the experimental-entry parse functions, including the kind-dispatching union.
3. Add the toLatest functions and the Any/Latest types.
4. Seed the authoring corpus, then write the tests and update the exports set.

### Excluded scope

- Frozen historical decoders for any format other than phase record v1; they come with each bump (phases 07–10).
- Snapshots (phase-05) and the corpus script (phase-06).
- producedBy (phases 07–10).

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

- The full list of new exports per entry.
- The number of authoring-record seeds, and how many lack `sourceSha`.
- Any difference between the legacy shapes beyond `sourceSha`.
- The corpus files are expected unplanned creations under `packages/schemas/corpus/authoring-record/v1/`.
- Any other deviation, with the reason.

### Commit subject

`feat(schemas-package): version dispatch, toLatest and newer-version failure for every format`

### Commit body

Apply the phase-record history pattern to every exported format. Each parse function now dispatches on the document's version, fails without throwing on a version or producer newer than the package, and has a pure toLatest counterpart. parseRecordManifest dispatches on kind, so it reads every phase-record version as well as authoring records.

Both legacy authoring-record v1 shapes from the records history, with and without sourceSha, are seeded into the corpus and parse.

---

## phase-05 — JSON Schema snapshots per version and the snapshot gate {#phase-05-snapshot-gate}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

Every format version has a committed JSON Schema snapshot. A change to the shape of the version phax writes, without a version bump, fails phax's gate with a message naming the format and the next version literal.

### Detailed instructions

- Extend each format registry entry in `packages/schemas/build/formats.ts` with `versions`, a map from each version number to its Effect schema: the current version from phax's schema and older versions from the frozen modules. For now only the phase record has two (v1 frozen, v2 current). The `record-manifest` union has no version literal of its own and has no snapshots, since it is derived from two snapshotted formats.
- Create `packages/schemas/build/snapshots.ts`, exporting a pure `checkSnapshots(formats, snapshots)` that takes the parsed snapshot files keyed by name and returns findings. The snapshot content is the raw `JSONSchema.make(schema)` output, without the title or stability additions, so a stability change never touches a shape snapshot. It reports:
  - the current version differing from `<id>.v<N>.schema.json` (deep equality on parsed JSON): `✗ <label>: the schema of version <N> differs from snapshots/<id>.v<N>.schema.json — bump to version <N+1>`;
  - a missing snapshot for any known version: `✗ <label>: no snapshot for version <N> — run pnpm exec tsx scripts/schemas-snapshots.ts --write`;
  - a historical version whose frozen schema differs from its snapshot: `✗ <label>: the frozen decoder of version <N> differs from its snapshot`;
  - a snapshot file matching no format and version.
- Create `scripts/schemas-snapshots.ts`. By default it reads `packages/schemas/snapshots/`, runs the check, prints the findings and exits 1 if there are any. With `--write` it writes only the missing snapshot files (two-space JSON with a trailing newline) and never overwrites an existing one. Document at the top of the file that amending a version not yet in any release (e.g. a later spec changing the same format in the same release) means deleting that snapshot and re-running `--write`, which is visible in review.
- In the root `package.json`, add the script `"schemas:check": "tsx scripts/schemas-snapshots.ts"` and append `&& npm run schemas:check` to `check:full`.
- Generate the twelve snapshots with `pnpm exec tsx scripts/schemas-snapshots.ts --write`. Do not hand-edit them.
- Register the new build module and script in `knip.json` if needed.

### Planned files to create

- `packages/schemas/build/snapshots.ts`
- `scripts/schemas-snapshots.ts`
- `tests/unit/schemasPackage/snapshots.test.ts`
- `packages/schemas/snapshots/registry.v1.schema.json`
- `packages/schemas/snapshots/run-status.v1.schema.json`
- `packages/schemas/snapshots/phase-status.v1.schema.json`
- `packages/schemas/snapshots/phax-plan.v1.schema.json`
- `packages/schemas/snapshots/compliance-review.v1.schema.json`
- `packages/schemas/snapshots/plan-approvals.v1.schema.json`
- `packages/schemas/snapshots/spec-approvals.v1.schema.json`
- `packages/schemas/snapshots/phase-record.v1.schema.json`
- `packages/schemas/snapshots/phase-record.v2.schema.json`
- `packages/schemas/snapshots/authoring-record.v1.schema.json`
- `packages/schemas/snapshots/spec-document.v1.schema.json`
- `packages/schemas/snapshots/plan-document.v1.schema.json`

### Planned files to edit

- `packages/schemas/build/formats.ts`
- `package.json`
- `knip.json`

### Optional files that may be edited

- `packages/schemas/src/index.ts`
- `packages/schemas/src/experimental.ts`
- `packages/schemas/src/versioned.ts`

### Boundary contracts

Producer: `packages/schemas/snapshots/<id>.v<N>.schema.json`, one per format version. Consumer: the snapshot check that runs in `pnpm test` (every phase gate, the release Gate step and CI). Contract for the bump phases and for later plans (artifact-decide, oracle-phases, headless-review): a shape change needs a new version literal, a frozen module for the old version and `--write` for the new snapshot. Amending an unreleased version means deleting its snapshot and rewriting it.

### Test strategy

Write `tests/unit/schemasPackage/snapshots.test.ts` first. It checks that:
- `checkSnapshots` on the real registry and the committed snapshots returns no findings (this is the gate);
- an injected registry whose phase-record current schema gains one extra key without a version change produces exactly one finding naming `phase record`, version 2 and `bump to version 3`;
- a missing snapshot produces the no-snapshot finding;
- a frozen v1 schema altered in the injected registry produces the frozen-decoder finding;
- an orphan snapshot is reported.

### Implementation order

1. Add the versions map to the registry.
2. The pure check and its tests, including the injected cases.
3. The CLI script, then run --write to create the twelve snapshots.
4. The package.json scripts and knip.

### Excluded scope

- Any version bump (phases 07–10).
- The history corpus (phase-06).
- Snapshots of the record-manifest union.

### Verification

The `standard` gate profile in `phax.json`. The snapshot check runs inside `pnpm test`.

### Expected handoff content

- The `checkSnapshots` signature.
- The exact finding messages.
- The snapshot naming and content rule (raw `JSONSchema.make` output).
- The `--write` semantics and the rule for amending an unreleased version.
- The twelve snapshot files written.
- Any deviation, with the reason.

### Commit subject

`feat(schemas-package): commit JSON Schema snapshots per format version and gate on them`

### Commit body

Commit one JSON Schema snapshot per format version. A pure check compares the schema generated for the version phax writes with its snapshot, and each historical version's frozen decoder with its own. A difference fails pnpm test, naming the format and the next version literal, so a shape change can no longer escape a version bump.

scripts/schemas-snapshots.ts runs the same check (pnpm schemas:check, now part of check:full). With --write it creates missing snapshots and never overwrites an existing one.

---

## phase-06 — History-corpus extraction script and the committed corpus {#phase-06-history-corpus}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

A committed script extracts every distinct persisted document from git history into a per-format, per-version corpus. The corpus it produced for phax is committed, and every document in it must parse with the package in every gate, including the release gate.

### Detailed instructions

- Create `packages/schemas/build/corpus.ts` (pure):
  - `classifyDocument(source, value)` maps a document to `{ formatId, version }` or an error. The source is `record` (for `record.json`), `plan-ledger`, `spec-ledger` or `sidecar`. `record.json` with `kind` `"authoring"` is `authoring-record`, otherwise `phase-record`. The ledgers are `plan-approvals` and `spec-approvals`. A sidecar's `kind` `spec`/`plan` gives `spec-document`/`plan-document`. `version` must be a number, otherwise it is an error.
  - `corpusFileFor(value)` returns `{ name, content }` under the phase-03 naming contract: content `JSON.stringify(value, null, 2) + "\n"`, name the first 16 hex characters of its sha256 plus `.json`.
- Create `scripts/extract-history-corpus.ts`, exporting `extractHistoryCorpus({ records, repo, out })` behind a main guard. Arguments: `--records <path>` (required; a git repo holding `phax/records/v1`), `--repo <path>` (default: the current directory) and `--out` (default `packages/schemas/corpus`). Use `execFileSync("git", ["-C", dir, ...])` with no shell. Sources:
  - Records: resolve `phax/records/v1`, falling back to `refs/remotes/origin/phax/records/v1`. For every commit from `rev-list` (each commit carries its own tree), take every path ending in `/record.json` from `ls-tree -r --name-only` and read it with `cat-file -p <commit>:<path>`.
  - Ledgers: for `docs/plans/approvals.json` and `docs/specs/approvals.json`, read the blob at every commit from `git log --all --format=%H -- <path>`, skipping commits where it is deleted.
  - Sidecars: for every commit touching a `.json` file under `docs/specs/` or `docs/plans/` (archive folders included, the approvals ledgers excluded), read each touched path's blob, skipping deletions.

  For each document: `JSON.parse`, classify (a classification error aborts naming `<commit>:<path>`), then write `<out>/<formatId>/v<N>/<name>` only if absent. Finish with a count per format and version.
- Run it: `pnpm exec tsx scripts/extract-history-corpus.ts --records ~/.phax/records/phax`. The seeds from phases 03–04 must be reproduced under the same names, with no duplicates. Commit the resulting corpus.
- Create `tests/unit/schemasPackage/historyCorpus.test.ts`. It walks `packages/schemas/corpus/<id>/v<N>/*.json` and parses each file with the package parse function whose registry id is `<id>`. It asserts `ok` and `value.version === N`; a failure message names the file's repo-relative path and the first violation's path and message. This makes §5.17 part of `pnpm test`, which the release workflow's Gate step already runs.
- Register the script and `build/corpus.ts` in `knip.json`.

### Planned files to create

- `scripts/extract-history-corpus.ts`
- `packages/schemas/build/corpus.ts`
- `tests/unit/schemasPackage/corpus.test.ts`
- `tests/unit/schemasPackage/historyCorpus.test.ts`
- `tests/integration/extractHistoryCorpus.test.ts`

### Planned files to edit

- `knip.json`

### Optional files that may be edited

- `packages/schemas/build/formats.ts`
- `packages/schemas/src/versioned.ts`
- `.oxfmtrc.json`
- `tsconfig.test.json`

### Boundary contracts

Producer: `scripts/extract-history-corpus.ts`, which writes `packages/schemas/corpus/<formatId>/v<N>/<hash16>.json`. Consumers: the corpus parse test (every gate and the release gate), and the bump phases, whose older-version decoders must keep every corpus document parsing. Contract: the corpus holds real documents only, named by content hash, and never mixes versions within a directory.

### Test strategy

Write the pure tests first. `tests/unit/schemasPackage/corpus.test.ts` covers the classification of each source and kind, the unknown-version error and the naming contract (it matches an existing seed's name).

`tests/integration/extractHistoryCorpus.test.ts` sets up temporary git repos:
- a records repo whose `phax/records/v1` has two commits, each with its own tree (a v2 phase record, then that record plus a v1 authoring record);
- a main repo committing `docs/plans/approvals.json` twice with different content and a spec sidecar once.

It runs `extractHistoryCorpus` and asserts the per-format/version directories, dedup and file names. A document with a string `version` must abort, naming the commit and path. `historyCorpus.test.ts` is the real-corpus gate.

### Implementation order

1. corpus.ts and its unit tests.
2. The script and its integration test.
3. Run the script against ~/.phax/records/phax and the repo.
4. The historyCorpus parse test, then knip.

### Excluded scope

- Following phax.json's records destination; the path argument is the chosen interface.
- Documents that live outside git (registry, run status, phase status, phax-plan, compliance review); the spec's corpus sources are the records branch, the ledgers and the sidecars.
- Re-extracting at every release; the script is re-run by hand when needed.

### Verification

The `standard` gate profile in `phax.json`. The corpus parse runs inside `pnpm test`.

### Expected handoff content

- The script's arguments and exported function.
- The document count per format and version found in phax's history (the expected order of magnitude: phase-record v1 6 and v2 51, authoring-record v1 8, plus the ledgers and sidecars).
- Any document that could not be classified.
- The corpus files are expected unplanned creations under `packages/schemas/corpus/`.
- Any other deviation, with the reason.

### Commit subject

`feat(schemas-package): extract the history corpus from git and parse it in every gate`

### Commit body

Add scripts/extract-history-corpus.ts. It walks every commit of phax/records/v1 in the records repository named by --records, then every commit touching the approvals ledgers or a spec or plan sidecar in --repo. It writes each distinct document into packages/schemas/corpus/<format>/v<N>/, named by content hash.

The committed corpus, extracted from phax's own history and records clone, is parsed with the package in pnpm test. A document that fails stops the release gate, naming the file and its first violation.

---

## phase-07 — producedBy for the registry, run status and phase status {#phase-07-produced-by-run-state}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

Every run registry, run-status and phase status document phax writes names its producer and carries version 2. Documents written at v1 still read, both in phax (through a one-step lift) and in the package (through frozen v1 decoders). The snapshot gate records the bump.

### Detailed instructions

- Add `PHAX_PRODUCER` to `src/domain/release.ts`, equal to `phax@${PHAX_RELEASE_VERSION}`.
- Create `src/schemas/producedBy.ts` with:
  - `ProducedBySchema`: a string matching `phax@` followed by a semver `X.Y.Z` with an optional pre-release suffix, rendered in JSON Schema by `Schema.pattern`;
  - a pure `liftPreviousVersion(raw, from, to)`: when `raw` is an object with `version === from` and no `producedBy` key, it returns `{ ...raw, version: to, producedBy: PHAX_PRODUCER }`; otherwise it returns `raw` unchanged.
- Freeze each current v1 schema before changing it. Create `packages/schemas/src/history/registry.v1.ts`, `runStatus.v1.ts` and `phaseStatus.v1.ts`:
  - each is self-contained, importing only `effect`;
  - inline every sub-schema as it is today, including the run and phase state unions, the effort union and the branch-name rule `BranchNameSchema` enforces (copy its predicate);
  - keep phax's default excess-property behavior for these three.

  Add their sha256 values to `packages/schemas/history.lock.json` once each file is final.
- In `src/schemas/registry.ts` and `src/schemas/status.ts`:
  - set `version` to `Schema.Literal(2)` and add a required `producedBy: ProducedBySchema`;
  - `decodeRegistry`, `decodeRunStatus` and `decodePhaseStatus` become `(u) => current(liftPreviousVersion(u, 1, 2))`.

  Decoding is otherwise unchanged. `RegistryEntry` does not change.
- Stamp every writer with `version: 2, producedBy: PHAX_PRODUCER`, overriding the value inherited from a spread so read-modify-write paths name the release doing the write:
  - `src/app/registry.ts`: the empty registry and `upsertRun`/`setRunStatus`;
  - `src/app/runFolder.ts`: the new run status;
  - `src/app/phaseFolder.ts`: the new phase status;
  - `src/app/effectRunner.ts`, `src/app/gates.ts` and `src/app/phaseStatusUpdates.ts`;
  - `src/app/resetPhase.ts` and `src/cli/interruptHandler.ts`: raw spreads;
  - `src/infra/providers/sessionWriter.ts`;
  - any fallback literal in `src/cli/commands/run.ts`.
- In the package: `parseRegistry`, `parseRunStatus` and `parsePhaseStatus` dispatch `{ 1: frozen v1, 2: phax }`. Export the `RegistryV1`/`RegistryV2`, `RunStatusV1`/`RunStatusV2` and `PhaseStatusV1`/`PhaseStatusV2` types. Widen `Any*`/`Latest*` so `toLatest*` of a v1 document sets `producedBy` to `UNKNOWN` and `version` to 2, keeping every other field. Update the format registry's `versions` maps.
- Run `pnpm exec tsx scripts/schemas-snapshots.ts --write` to add the three v2 snapshots. The v1 snapshots are now checked against the frozen modules.
- Update test fixtures. Typed literal documents use a fixed fixture producer such as `phax@0.0.0-test`, never `PHAX_PRODUCER`, so a release bump never churns fixtures or snapshots. Assertions on documents phax wrote compare with `PHAX_PRODUCER`. v1 files that tests write to disk may stay v1 where the test is about reading, since the lift covers them.

### Planned files to create

- `src/schemas/producedBy.ts`
- `packages/schemas/src/history/registry.v1.ts`
- `packages/schemas/src/history/runStatus.v1.ts`
- `packages/schemas/src/history/phaseStatus.v1.ts`
- `packages/schemas/snapshots/registry.v2.schema.json`
- `packages/schemas/snapshots/run-status.v2.schema.json`
- `packages/schemas/snapshots/phase-status.v2.schema.json`
- `tests/integration/producedByRunState.test.ts`

### Planned files to edit

- `src/domain/release.ts`
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
- `packages/schemas/history.lock.json`
- `packages/schemas/build/formats.ts`
- `tests/unit/schemas.test.ts`
- `tests/integration/registry.test.ts`

### Optional files that may be edited

- `src/cli/commands/run.ts`
- `tests/unit/architecturalGuards.test.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/formatHistory.test.ts`
- `tests/unit/schemasPackage/exports.test.ts`
- `tests/unit/schemasPackage/jsonSchemas.test.ts`
- `tests/type/schemasPackage.ts`
- `tests/unit/registryNamespace.test.ts`
- `tests/unit/resolveRunRef.test.ts`
- `tests/unit/resolveRunInfo.test.ts`
- `tests/unit/cli/ls.test.ts`
- `tests/unit/resume.test.ts`
- `tests/unit/state.test.ts`
- `tests/unit/reviewHandoffContent.test.ts`
- `tests/unit/phaseStatusUpdates.test.ts`
- `tests/unit/cli/resume.test.ts`
- `tests/unit/cli/enterPhase.test.ts`
- `tests/integration/archive.test.ts`
- `tests/integration/adjustPlanCommand.test.ts`
- `tests/integration/dispatcher.test.ts`
- `tests/integration/enter.test.ts`
- `tests/integration/enterPhase.test.ts`
- `tests/integration/eventAdapter.test.ts`
- `tests/integration/executePlan.test.ts`
- `tests/integration/finalReview.test.ts`
- `tests/integration/finalReport.test.ts`
- `tests/integration/fixLoop.test.ts`
- `tests/integration/loadReviewHandoffInputs.test.ts`
- `tests/integration/perPhaseBranch.test.ts`
- `tests/integration/plansOverlapLanded.test.ts`
- `tests/integration/rateLimit.test.ts`
- `tests/integration/resetPhase.test.ts`
- `tests/integration/resetResume.test.ts`
- `tests/integration/resume.test.ts`
- `tests/integration/resumeFromCleanup.test.ts`
- `tests/integration/resumeFromCommit.test.ts`
- `tests/integration/resumeFromCompletion.test.ts`
- `tests/integration/resumeHandoff.test.ts`
- `tests/integration/reviewCodeCommand.test.ts`
- `tests/integration/reviewHandoff.test.ts`
- `tests/integration/reviewHandoffCommand.test.ts`
- `tests/integration/sessionInfo.test.ts`
- `tests/integration/skillEditConsent.test.ts`
- `tests/integration/runFolder.test.ts`
- `tests/integration/telemetry/adapterFailures.test.ts`

### Boundary contracts

Producer: `src/domain/release.ts` (`PHAX_PRODUCER`) and `src/schemas/producedBy.ts` (`ProducedBySchema`, `liftPreviousVersion`). Consumers: every phax writer of these three formats, and phases 08–10, which reuse the same bump recipe. Contract: phax writes only v2; phax's decoders accept v1 only by lifting it to v2; only the package's frozen modules decode v1 as v1.

### Test strategy

Write `tests/integration/producedByRunState.test.ts` first. With fake ports it asserts that:
- creating a run writes a registry, a run-status and a phase status each with `version: 2` and `producedBy` equal to `PHAX_PRODUCER`;
- a status transition on a run folder whose files are v1 on disk rewrites them as v2 with `PHAX_PRODUCER` and keeps every other field;
- `decodeRegistry` on a v1 registry succeeds.

Update `tests/unit/schemas.test.ts` and `tests/integration/registry.test.ts` (the assertion `registry.version` toBe 1 becomes 2). In the package tests, v1 and v2 documents of each format parse with the right `version`, `toLatest` of v1 marks `producedBy` unknown, and the frozen-history and snapshot tests stay green.

### Implementation order

1. release.ts and producedBy.ts.
2. Freeze the three v1 modules and update history.lock.json.
3. Bump the schemas and add the lift in the decoders.
4. Stamp every writer.
5. Update the package dispatch, types and toLatest, and the registry versions.
6. Write the v2 snapshots, then fix the test fixtures until test:type and test pass.

### Excluded scope

- phax-plan, the compliance review, the approvals ledgers, the records and the documents (phases 08–10).
- Any shape change other than producedBy.
- Any CLI output change.
- Rewriting existing documents on disk; they upgrade when phax next writes them.

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

- The `producedBy.ts` API.
- The `PHAX_PRODUCER` location.
- The list of writer sites stamped.
- The three frozen modules and their lock entries.
- The bump recipe as applied, which phases 08–10 repeat.
- The fixture producer literal used in tests.
- Which optional test files you touched.
- Any deviation, with the reason.

### Commit subject

`feat(schemas): stamp producedBy in the registry and run and phase status, bump to v2`

### Commit body

The run registry, run-status.json and the phase status.json now carry a required producedBy ("phax@<release>") and move to version 2. Every writer, read-modify-write paths included, stamps the release doing the write. phax's decoders lift exactly the previous version, so a v1 registry or an in-flight v1 run still reads after the upgrade and is written as v2 at its next write.

The package freezes each v1 decoder in packages/schemas/src/history, reads v1 and v2, and marks producedBy as unknown when upgrading a v1 document. New v2 snapshots record the bump.

---

## phase-08 — producedBy for phax-plan and the compliance review {#phase-08-produced-by-plan-review}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

phax-plan.json and compliance-review.json name their producer at version 2, while the agent-facing contracts (the extracted plan and the compliance verdict in the review prompt) stay exactly as they are. Older run directories still read in phax and in the package.

### Detailed instructions

- Freeze the current `PhaxPlanSchema` into `packages/schemas/src/history/phaxPlan.v1.ts`, and the current `ComplianceReviewSchema` into `complianceReview.v1.ts`. Both are self-contained (only `effect`) and keep phax's `onExcessProperty: "error"`. Add their lock entries.
- In `src/schemas/phaxPlan.ts`, `PhaxPlanSchema` (the persisted plan) gets `version: Schema.Literal(2)` and a required `producedBy`, and its decoder lifts v1 through `liftPreviousVersion`. `ExtractedPhaxPlanSchema` stays at version 1 without `producedBy`: it is the extraction, cache and plan-document projection contract, and is internal. The extraction cache does not change.
- In `src/domain/plan/finalize.ts`, stop copying `extracted.version`: set `version: 2` and `producedBy: PHAX_PRODUCER`. Check that `src/cli/commands/run.ts`'s spread and `src/app/runFolder.ts`'s write keep the field.
- In `src/schemas/complianceReview.ts`, split the current shape into `AgentComplianceReviewSchema` plus its decoder. This is the version-1 verdict the agent writes, still described by `src/domain/review/compliancePrompt.ts`, which does not change. `ComplianceReviewSchema` (persisted) is the agent fields plus `version: Schema.Literal(2)` plus `producedBy`, and its decoder lifts v1.
- In `src/app/reviewCompliance.ts`, decode the agent's file with the agent decoder. Where phax currently copies the raw text into the run directory, write the persisted document instead: the agent fields with `version: 2` and `producedBy: PHAX_PRODUCER`, encoded with `ComplianceReviewSchema`. The missing-verdict path keeps its behavior. Readers such as `src/app/reviewCode.ts` use `decodeComplianceReview` (with the lift).
- In the package: `parsePhaxPlan` and `parseComplianceReview` dispatch `{ 1: frozen, 2: phax }`. Export the V1/V2 types. `toLatest*` marks `producedBy` as `UNKNOWN` for v1. Update the registry `versions`. Run `--write` for the two v2 snapshots.
- Update fixtures with the same rule as phase-07: typed literals use the fixed fixture producer, and assertions on phax-written files use `PHAX_PRODUCER`. The prompt-generation snapshot embeds the plan JSON, so update it only through a fixture that uses the fixed producer literal.

### Planned files to create

- `packages/schemas/src/history/phaxPlan.v1.ts`
- `packages/schemas/src/history/complianceReview.v1.ts`
- `packages/schemas/snapshots/phax-plan.v2.schema.json`
- `packages/schemas/snapshots/compliance-review.v2.schema.json`
- `tests/integration/producedByPlanReview.test.ts`

### Planned files to edit

- `src/schemas/phaxPlan.ts`
- `src/schemas/complianceReview.ts`
- `src/domain/plan/finalize.ts`
- `src/app/reviewCompliance.ts`
- `packages/schemas/src/index.ts`
- `packages/schemas/history.lock.json`
- `packages/schemas/build/formats.ts`
- `tests/unit/schemas.test.ts`
- `tests/unit/schemas/complianceReview.test.ts`
- `tests/unit/extractPlanFinalize.test.ts`
- `tests/integration/reviewCompliance.test.ts`

### Optional files that may be edited

- `src/app/reviewCode.ts`
- `src/app/runFolder.ts`
- `src/cli/commands/run.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/formatHistory.test.ts`
- `tests/unit/schemasPackage/jsonSchemas.test.ts`
- `tests/type/schemasPackage.ts`
- `tests/unit/promptGeneration.test.ts`
- `tests/unit/__snapshots__/promptGeneration.test.ts.snap`
- `tests/unit/dryRun.test.ts`
- `tests/unit/resume.test.ts`
- `tests/unit/cli/validate.test.ts`
- `tests/unit/cli/run.test.ts`
- `tests/unit/extractPlan.test.ts`
- `tests/integration/executePlan.test.ts`
- `tests/integration/modelPreflight.test.ts`
- `tests/integration/orientBriefArtifact.test.ts`
- `tests/integration/perPhaseBranch.test.ts`
- `tests/integration/rateLimit.test.ts`
- `tests/integration/reconciliation.test.ts`
- `tests/integration/resetResume.test.ts`
- `tests/integration/resume.test.ts`
- `tests/integration/resumeFromCleanup.test.ts`
- `tests/integration/resumeFromCommit.test.ts`
- `tests/integration/resumeFromCompletion.test.ts`
- `tests/integration/resumeHandoff.test.ts`
- `tests/integration/routing.test.ts`
- `tests/integration/runCarriesCompletion.test.ts`
- `tests/integration/runFolder.test.ts`
- `tests/integration/scopesScheduling.test.ts`
- `tests/integration/setupFailure.test.ts`
- `tests/integration/skillEditConsent.test.ts`
- `tests/integration/skillEditGrants.test.ts`
- `tests/integration/stateMachineContract.test.ts`
- `tests/integration/telemetry/end-to-end.test.ts`
- `tests/integration/reviewComplianceCommand.test.ts`
- `tests/integration/reviewCode.test.ts`

### Boundary contracts

There are two agent/phax boundaries. The extraction model and the headless plan projection produce `ExtractedPhaxPlan` v1, and phax finalizes it into the persisted phax-plan v2. The compliance agent produces the v1 verdict described by the prompt, and phax persists compliance-review v2. The contract is that the agent-facing shapes and the prompt text are unchanged: only phax knows `producedBy`.

### Test strategy

Write `tests/integration/producedByPlanReview.test.ts` first. It asserts that:
- the finalize-and-write path of a run produces phax-plan.json with `version: 2` and `producedBy` equal to `PHAX_PRODUCER`;
- a compliance review whose agent file is a valid v1 verdict yields a persisted compliance-review.json with `version: 2`, `PHAX_PRODUCER` and the agent's fields unchanged;
- decoding a v1 phax-plan and a v1 compliance review in phax succeeds through the lift.

Update `tests/unit/schemas/complianceReview.test.ts` (its version assertion), `tests/unit/extractPlanFinalize.test.ts` and `tests/unit/schemas.test.ts`. In the package tests, v1 and v2 of both formats parse, and the snapshots and frozen hashes stay green.

### Implementation order

1. Freeze both v1 modules and add their lock entries.
2. Bump phaxPlan with the lift; update finalize.ts.
3. Split the compliance schema; update reviewCompliance.ts.
4. Update the package dispatch, types, toLatest and registry, then write the snapshots.
5. Update the fixtures.

### Excluded scope

- Changing the compliance prompt text, the extraction schema or the extraction cache.
- Approvals, records and documents (phases 09–10).
- Any shape change other than producedBy.

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

- The names of the agent-facing and persisted compliance schemas.
- The finalize change.
- The `reviewCompliance` write path now used.
- The frozen modules and lock entries.
- Which optional test files changed, including whether the prompt snapshot changed.
- Any deviation, with the reason.

### Commit subject

`feat(schemas): stamp producedBy in phax-plan.json and compliance-review.json, bump to v2`

### Commit body

phax-plan.json and compliance-review.json now carry a required producedBy and move to version 2. The shapes an agent produces stay at version 1 and are unchanged: the extracted plan and the compliance verdict the review prompt describes. phax stamps the producer when it writes the persisted file, and the compliance review is now re-encoded instead of copied verbatim.

phax's decoders lift v1. The package freezes both v1 decoders, reads v1 and v2, and marks producedBy as unknown when upgrading. New v2 snapshots record the bump.

---

## phase-09 — producedBy for approvals ledgers and the phase record {#phase-09-produced-by-ledgers-records}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

Both approvals ledgers (v2) and the phase record manifest (v3) name their producer. Existing ledgers keep every record across the upgrade, existing records still read in phax, and the package reads all three phase-record versions, as in the spec's §6 reading-history example.

### Detailed instructions

- Freeze the current approvals file schemas into `packages/schemas/src/history/planApprovals.v1.ts` and `specApprovals.v1.ts`, including the 40-hex baseline pattern, and the current `RunRecordManifestSchema` into `phaseRecord.v2.ts`. All are self-contained (only `effect`, with sub-schemas inlined: token usage, surface and provider id) and use `onExcessProperty: "error"`. Add the lock entries. The v2 snapshot, already committed, must match the frozen v2 module.
- Bump `src/schemas/approvalRecord.ts` and `src/schemas/specApprovalRecord.ts`: `version: Schema.Literal(2)` plus `producedBy`, with each file decoder lifting v1.
- In `src/app/approvalRecordStore.ts`, write `{ version: 2, producedBy: PHAX_PRODUCER, records }`, including the empty stores. A v1 ledger on disk now decodes through the lift, so its records survive and the next `put`/`remove` rewrites it as v2. Do not change the store's behavior on genuinely undecodable files.
- Bump `src/schemas/runRecord.ts`: `version: Schema.Literal(3)` plus `producedBy`. `decodeRunRecordManifest` and the union's `decodeRecordManifest` in `authoringRecord.ts` lift v2 to v3 (v1 records stay rejected by phax, as they are today). In `src/domain/records/assemble.ts`, stamp `version: 3` and `producedBy: PHAX_PRODUCER`.
- In the package:
  - `parsePlanApprovals`/`parseSpecApprovals` dispatch `{ 1: frozen, 2: phax }`;
  - `parsePhaseRecord` dispatches `{ 1: frozen v1, 2: frozen v2, 3: phax }`;
  - export the V3 type; `AnyPhaseRecord` becomes V1 | V2 | V3;
  - `LatestPhaseRecord` has `verifiedSurfaces` and `producedBy` typed as value | `Unknown`;
  - `toLatestPhaseRecord` from v1 marks both unknown, and from v2 marks `producedBy` unknown;
  - `parseRecordManifest` follows.

  Update the registry `versions`. Run `--write` for the three new snapshots.
- Update the phase-record history test to the §6 example: a v1 corpus record upgrades with `verifiedSurfaces` and `producedBy` equal to `{ kind: "unknown" }`, and a record at version 4 with `producedBy: "phax@99.0.0"` fails, naming version 4, the package version and upgrade.
- Update fixtures by the same rule as phase-07. `tests/unit/runRecord.test.ts`'s rejection test for v1 still holds; add a lift case for v2.
- Coordination: oracle-phases adds an `oracle` surface to the phase record, and artifact-decide adds `approvedBy` to both ledgers, in the same release. Their plans amend the unreleased v3/v2 through the snapshot gate. Implement neither here.

### Planned files to create

- `packages/schemas/src/history/planApprovals.v1.ts`
- `packages/schemas/src/history/specApprovals.v1.ts`
- `packages/schemas/src/history/phaseRecord.v2.ts`
- `packages/schemas/snapshots/plan-approvals.v2.schema.json`
- `packages/schemas/snapshots/spec-approvals.v2.schema.json`
- `packages/schemas/snapshots/phase-record.v3.schema.json`
- `tests/integration/producedByLedgersRecords.test.ts`

### Planned files to edit

- `src/schemas/approvalRecord.ts`
- `src/schemas/specApprovalRecord.ts`
- `src/schemas/runRecord.ts`
- `src/app/approvalRecordStore.ts`
- `src/domain/records/assemble.ts`
- `packages/schemas/src/index.ts`
- `packages/schemas/src/experimental.ts`
- `packages/schemas/history.lock.json`
- `packages/schemas/build/formats.ts`
- `tests/unit/runRecord.test.ts`
- `tests/unit/schemas/specApprovalRecord.test.ts`
- `tests/unit/schemasPackage/phaseRecordHistory.test.ts`

### Optional files that may be edited

- `src/schemas/authoringRecord.ts`
- `src/app/writeRecord.ts`
- `tests/unit/recordsAssemble.test.ts`
- `tests/unit/authoringRecord.test.ts`
- `tests/unit/artifact/lineage.test.ts`
- `tests/integration/completeRunArtifacts.test.ts`
- `tests/integration/runCarriesCompletion.test.ts`
- `tests/integration/recordsExplain.test.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/formatHistory.test.ts`
- `tests/unit/schemasPackage/jsonSchemas.test.ts`
- `tests/type/schemasPackage.ts`

### Boundary contracts

Producer: phax's approvals store and record assembler. Consumers: the package's frozen decoders and phax's own readers (`records list`/`explain`, artifact lineage), whose behavior on existing documents is preserved by the one-step lift. Contract: phax writes only ledger v2 and record v3; a ledger v1 or record v2 is read through the lift; only the package reads record v1.

### Test strategy

Write `tests/integration/producedByLedgersRecords.test.ts` first. It asserts that:
- approving a plan against a v1 `docs/plans/approvals.json` (fake fs) yields a v2 ledger with `PHAX_PRODUCER` and every earlier record preserved, and the same for the spec ledger;
- assembling and writing a phase record yields version 3 with `PHAX_PRODUCER`;
- decoding a v2 record in phax succeeds through the lift.

Update the listed unit tests. In the package tests, the corpus v1 and v2 records parse, the §6 example holds, and the snapshots and frozen hashes stay green.

### Implementation order

1. Freeze the three modules and add their lock entries.
2. Bump the approvals schemas and update the store.
3. Bump the run record; update assemble.ts and the union lift.
4. Update the package dispatch and toLatest, the registry and the snapshots.
5. Update the fixtures and tests.

### Excluded scope

- oracle-phases' `oracle` surface and artifact-decide's `approvedBy`.
- Changing how the approvals store treats genuinely corrupt files.
- Making phax read v1 records.
- Documents and the authoring record (phase-10).

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

- The new version literals.
- The lift sites.
- The approvals-store behavior on a v1 ledger.
- The package's phase-record `Any`/`Latest` types.
- The frozen modules and lock entries.
- Which optional files changed.
- Any deviation, with the reason.

### Commit subject

`feat(schemas): stamp producedBy in approvals ledgers and phase records, bump versions`

### Commit body

docs/plans/approvals.json and docs/specs/approvals.json move to version 2, and the phase record manifest moves to version 3, each with a required producedBy.

The approvals store lifts a v1 ledger on read, so an existing ledger keeps every record and is rewritten as v2 at its next approval instead of being dropped. phax's record decoders lift v2, so records explain still reads existing records.

The package freezes approvals v1 and phase record v2. parsePhaseRecord reads v1, v2 and v3, and toLatestPhaseRecord marks verifiedSurfaces and producedBy as unknown where a version lacks them.

---

## phase-10 — producedBy for spec and plan documents and the authoring record {#phase-10-produced-by-authoring}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

Every experimental format phax writes (the spec and plan sidecars and the authoring record) names its producer at version 2. The headless authoring contract handed to the agent, and printed by `phax artifact schema`, is unchanged. Artifacts and records written before the upgrade still read.

### Detailed instructions

- Freeze the current `SpecDocumentSchema` into `packages/schemas/src/history/specDocument.v1.ts`, `PlanDocumentSchema` into `planDocument.v1.ts` and `AuthoringRecordManifestSchema` into `authoringRecord.v1.ts`. All are self-contained (only `effect`), keep `onExcessProperty: "error"` and have lock entries. `authoringRecord.v1.ts` must accept both legacy shapes in the corpus (with and without `sourceSha`), so verify it against `packages/schemas/corpus/authoring-record/v1/`.
- In `src/schemas/specDocument.ts` and `planDocument.ts`:
  - keep `SpecDocumentSchema`/`PlanDocumentSchema` exactly as they are: they are the authored contract handed to the agent, printed by `phax artifact schema spec|plan`, rendered by the renderers and projected into the plan cache;
  - add `SpecDocumentSidecarSchema`/`PlanDocumentSidecarSchema`, the authored fields with `version: Schema.Literal(2)` plus `producedBy`, each with a decoder that lifts v1.
- In `src/app/authorArtifact.ts`, encode the sidecar file with the sidecar schema, stamped `version: 2` and `producedBy: PHAX_PRODUCER`, keeping the `sourceSpec` override for plans. The session's own `document.json` and the plan-cache seed keep using the authored document.

  In `src/domain/artifact/sidecar.ts`, decode committed sidecars with the sidecar decoders (lift included), so approval of a pre-upgrade headless artifact still works. Check `src/app/artifactStatus.ts`'s callers.
- Bump `src/schemas/authoringRecord.ts` to `version: Schema.Literal(2)` plus `producedBy`, with `decodeAuthoringRecordManifest` and the union lifting v1. Stamp in `src/app/writeAuthoringRecord.ts`. In `tests/unit/authoringRecord.test.ts`, the test that rejects `version: 2` now rejects version 3.
- In the package's experimental entry:
  - `SpecDocumentSchema`/`SpecDocument` and `PlanDocumentSchema`/`PlanDocument` now name the persisted sidecar format (phax's sidecar schemas);
  - `parseSpecDocument`/`parsePlanDocument` dispatch `{ 1: frozen, 2: phax sidecar decoder }`;
  - `parseAuthoringRecord` dispatches `{ 1: frozen v1, 2: phax }`, and `parseRecordManifest` follows;
  - `toLatest*` marks `producedBy` as `UNKNOWN` for v1.

  Update the registry `versions` and the type-parity test, which now maps to the sidecar types. Run `--write` for the three v2 snapshots.
- Update fixtures with the same rule as phase-07. `tests/integration/writeAuthoringRecord.test.ts`'s exact `toEqual` gains `version: 2` and `producedBy: PHAX_PRODUCER`.

### Planned files to create

- `packages/schemas/src/history/specDocument.v1.ts`
- `packages/schemas/src/history/planDocument.v1.ts`
- `packages/schemas/src/history/authoringRecord.v1.ts`
- `packages/schemas/snapshots/spec-document.v2.schema.json`
- `packages/schemas/snapshots/plan-document.v2.schema.json`
- `packages/schemas/snapshots/authoring-record.v2.schema.json`
- `tests/integration/producedByAuthoring.test.ts`

### Planned files to edit

- `src/schemas/specDocument.ts`
- `src/schemas/planDocument.ts`
- `src/schemas/authoringRecord.ts`
- `src/app/authorArtifact.ts`
- `src/app/writeAuthoringRecord.ts`
- `src/domain/artifact/sidecar.ts`
- `packages/schemas/src/experimental.ts`
- `packages/schemas/history.lock.json`
- `packages/schemas/build/formats.ts`
- `tests/unit/authoringRecord.test.ts`
- `tests/integration/writeAuthoringRecord.test.ts`
- `tests/unit/artifact/sidecar.test.ts`

### Optional files that may be edited

- `src/app/artifactStatus.ts`
- `tests/unit/specDocument.test.ts`
- `tests/unit/planDocument.test.ts`
- `tests/unit/renderSpec.test.ts`
- `tests/unit/renderPlan.test.ts`
- `tests/integration/authorArtifact.test.ts`
- `tests/integration/artifactNewHeadlessCommand.test.ts`
- `tests/integration/artifactStatus.test.ts`
- `tests/integration/recordsExplain.test.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/formatHistory.test.ts`
- `tests/unit/schemasPackage/jsonSchemas.test.ts`
- `tests/unit/schemasPackage/exports.test.ts`
- `tests/type/schemasPackage.ts`

### Boundary contracts

The authoring agent produces the authored document (v1, the schema in its prompt), and phax persists the sidecar (v2). The contract is that the authored schema, the prompt and the `phax artifact schema spec|plan` output are byte-identical to before this phase. Another boundary: phax's approval gate consumes committed sidecars through the sidecar decoder with the lift.

### Test strategy

Write `tests/integration/producedByAuthoring.test.ts` first. It asserts that a headless spec session and a headless plan session (fake provider) each write a sidecar with `version: 2` and `producedBy: PHAX_PRODUCER`, and an authoring record with version 2 and `PHAX_PRODUCER`.

Also assert that `JSONSchema.make(SpecDocumentSchema)` and `JSONSchema.make(PlanDocumentSchema)` still deep-equal `packages/schemas/snapshots/spec-document.v1.schema.json` and `plan-document.v1.schema.json`, which proves the printed contract is unchanged.

In `tests/unit/artifact/sidecar.test.ts`, a v1 sidecar still reads through the lift. In the package tests, both legacy authoring v1 shapes parse through the frozen decoder, v1 and v2 sidecars parse, and the corpus, snapshots and frozen hashes stay green.

### Implementation order

1. Freeze the three v1 modules and add their lock entries.
2. Add the sidecar schemas with the lift; update authorArtifact.ts and sidecar.ts.
3. Bump the authoring record; update writeAuthoringRecord.ts and the union.
4. Update the package's experimental entry, the registry and the snapshots.
5. Update the fixtures and tests.

### Excluded scope

- Any change to the headless authoring prompt, the `phax artifact schema` output, the phax-planning or phax-spec skills, or the renderers.
- headless-review's code-review document and review-plan document.
- artifact-decide's `history` field in the documents.

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

- The authored vs sidecar schema names.
- Every site that now uses the sidecar decoder.
- The proof that the printed authoring schema is unchanged.
- The frozen modules and lock entries.
- The legacy authoring shapes the frozen v1 decoder accepts.
- Which optional files changed.
- Any deviation, with the reason.

### Commit subject

`feat(schemas): stamp producedBy in spec and plan sidecars and authoring records`

### Commit body

Spec and plan JSON sidecars move to version 2 and authoring record manifests to version 2, each with a required producedBy. The document an authoring agent returns, which phax artifact schema spec|plan prints, is unchanged at version 1: phax stamps the producer only when it writes the sidecar. phax lifts v1 sidecars and authoring records, so artifacts authored before the upgrade still pass the approval gate.

The package's experimental entry now reads sidecars. It freezes spec document, plan document and authoring record v1; the authoring v1 decoder accepts both legacy shapes found in the records history.

---

## phase-11 — Release: lockstep publish, tarball smoke and release.sh {#phase-11-release-lockstep}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

A release tag stage-publishes `@lbdremy/phax` and `@lbdremy/phax-schemas` at the tag's version, or neither: every check that can fail, including an install-and-parse smoke of the packed tarball, runs before the first stage publish. release.sh bumps every version in one release commit.

### Detailed instructions

- Create `scripts/smoke-schemas-package.sh` (bash, `set -euo pipefail`). It expects `pnpm build` to have run, and works in a temp directory:
  - `npm pack` in `packages/schemas`.
  - List the tarball and fail if it contains any file compiled from `src/app`, `src/ports`, `src/infra` or `src/cli`. Scan every `.js` in it and fail if one imports `node:*`, `fs`, `child_process` or `net`, or references `Deno`.
  - Create an empty Node project (`npm init -y`, `"type": "module"`) and `npm install` the tarball.
  - Fail if the top-level `node_modules` holds anything besides `@lbdremy/phax-schemas`, `effect` and effect's own dependency closure (read from their package.json files).
  - Create a temp git repo with a `phax/records/v1` branch holding one phase record from `packages/schemas/corpus/phase-record/` at `<runId>/<phaseId>/record.json`.
  - Write the spec §6 `read-record.mjs` consumer (with `git show`), run it with the record's key, and assert it prints the runId, phaseId and outcome and exits 0.
- In `scripts/prepare-npm.ts`, also set `packages/schemas/package.json`'s version from the tag and verify it after writing, as it already does for `npm/package.json`.
- Reorder `.github/workflows/release.yml` to:
  1. gate (unchanged, including `pnpm build`, which now builds the schemas package and its JSON Schemas);
  2. build release binaries;
  3. `bash scripts/smoke-schemas-package.sh`;
  4. prepare the npm manifests (both);
  5. verify the tag against `npm/package.json`, `packages/schemas/package.json` and `PHAX_RELEASE_VERSION` in `src/domain/release.ts`;
  6. `npm stage publish --access public --provenance` in `npm`;
  7. the same in `packages/schemas`;
  8. the GitHub release.

  No step that can fail comes after the first stage publish, except the second publish itself.
- In `.github/workflows/ci.yml`, add a step after Build that runs `bash scripts/smoke-schemas-package.sh`.
- In `scripts/release.sh`:
  - also bump `packages/schemas/package.json` (`npm pkg set` in that directory);
  - rewrite `PHAX_RELEASE_VERSION` in `src/domain/release.ts`;
  - add both files to the `git add` of the release commit;
  - end with `approve the staged npm packages at:` followed by the two npmjs.com URLs (`@lbdremy/phax` and `@lbdremy/phax-schemas`), as in spec §6.
- Update `docs/release.md`: the two packages, the smoke step, the lockstep versions and approving two staged packages by hand.

### Planned files to create

- `scripts/smoke-schemas-package.sh`

### Planned files to edit

- `.github/workflows/release.yml`
- `.github/workflows/ci.yml`
- `scripts/release.sh`
- `scripts/prepare-npm.ts`
- `tests/unit/releaseWorkflow.test.ts`
- `docs/release.md`

### Optional files that may be edited

- `packages/schemas/package.json`
- `scripts/releaseVersion.ts`
- `tests/unit/schemasPackage/manifest.test.ts`
- `knip.json`

### Boundary contracts

The workflow consumes the gate, the build output and the smoke script, and publishes to npm. The contract (§5.25) is that both stage publishes are the workflow's last fallible steps, and the manifests and constant agree with the tag before either runs. `release.sh` produces the release commit, in which `package.json`, `npm/package.json`, `packages/schemas/package.json` and `src/domain/release.ts` all carry the new version.

### Test strategy

Extend `tests/unit/releaseWorkflow.test.ts` first. It asserts that:
- in release.yml, the smoke step and the version verification run before the first `npm stage publish`;
- there are exactly two stage publish steps, in `npm` and `packages/schemas`;
- prepare-npm handles both manifests;
- release.sh sets the version in all three places plus `src/domain/release.ts`, stages them in the release commit and names both packages in its last lines;
- ci.yml runs the smoke.

The manifest test already pins the lockstep versions. The smoke script needs `npm` and network and cannot run in the phase agent. Its first real run is CI on the pull request, and a human should confirm that run.

### Implementation order

1. The smoke script.
2. prepare-npm.ts.
3. release.yml reordering and ci.yml.
4. release.sh.
5. The workflow tests, then docs/release.md.

### Excluded scope

- Running the smoke in the phax gate profile or `pnpm check:full`.
- Changing how `@lbdremy/phax` itself is built or published beyond the ordering.
- Hosting JSON Schemas at a URL.

### Verification

The `standard` gate profile in `phax.json`. The tarball smoke is verified out-of-band by the first CI run.

### Expected handoff content

- The final step order of release.yml.
- The smoke script's checks and how it chooses its corpus record.
- The release.sh diff summary.
- A note that the smoke has not run inside the phase and must be confirmed on CI.
- Any deviation, with the reason.

### Commit subject

`ci(release): stage-publish @lbdremy/phax-schemas in lockstep with @lbdremy/phax`

### Commit body

The release workflow now builds the schemas package and installs its packed tarball into an empty Node project. There it parses a phax-written record read from a git records branch, checks the installed dependency set and scans the tarball for I/O. It then version-matches both manifests to the tag and stage-publishes @lbdremy/phax and @lbdremy/phax-schemas. Every step that can fail runs before the first stage publish.

release.sh bumps the schemas manifest and PHAX_RELEASE_VERSION in the same release commit and names both packages to approve. CI runs the same tarball smoke.

---

## phase-12 — README persisted-formats table and reading phax files from code {#phase-12-readme-formats}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

The README carries one persisted-formats table that classifies every exported format as stable or experimental, plus a "Read phax files from code" section for tool authors. A test keeps that table, the package's entries and each JSON Schema's stability in agreement.

### Detailed instructions

- In `README.md`, replace `## Experimental formats` with `## Persisted formats` (anchor `#persisted-formats`). Add a table with columns Format, Where it lives, Stability and Read it with, and one row per exported format, following spec §6's after-table:
  - stable (`@lbdremy/phax-schemas`): run registry, run status, phase status, phax-plan, compliance review, plan approvals, spec approvals, phase record;
  - experimental (`@lbdremy/phax-schemas/experimental`): spec document, plan document, authoring record.

  Add one sentence explaining that stable means any shape change bumps the version literal, and that experimental formats bump too but may change between releases. Also mention that `phax artifact schema spec|plan` still prints the authoring contract.
- Add a `## Read phax files from code` section beside it, following spec §11:
  - `npm install @lbdremy/phax-schemas`;
  - the §6 `read-record.mjs` script: `git show phax/records/v1:<runId>/phase-01/record.json`, `parsePhaseRecord(JSON.parse(raw))`, branch on `parsed.ok`, read `parsed.value.outcome`;
  - `toLatestPhaseRecord` for mixed history;
  - a pointer to `node_modules/@lbdremy/phax-schemas/json/<format>.schema.json` for docs tooling;
  - a note that `/experimental` formats may change between releases and that the package version always equals the phax version whose files it reads.
- Update the headless-authoring paragraph's link from `#experimental-formats` to `#persisted-formats`. Search the repo for any other `experimental-formats` link outside `docs/specs` and `docs/plans`, which are historical.
- Create `packages/schemas/README.md` for the npm page: what the package is, the two entries, `Parsed`, reading history with `toLatest*`, the json directory and lockstep versioning. Keep it short and link to the phax README.
- Create `tests/unit/schemasPackage/classification.test.ts`. It parses the Persisted formats table from `README.md` and asserts that:
  - every registry format except the derived `record-manifest` union has exactly one row, and every row maps to one registry format (match rows to registry labels);
  - each row's stability equals the registry stability;
  - stable formats' parse functions are exported from the root entry and experimental ones from `/experimental`;
  - each rendered JSON Schema's `x-phax-stability` equals the row's stability.

### Planned files to create

- `packages/schemas/README.md`
- `tests/unit/schemasPackage/classification.test.ts`

### Planned files to edit

- `README.md`

### Optional files that may be edited

- `packages/schemas/build/formats.ts`
- `NEXT_STEPS.md`
- `docs/release.md`

### Test strategy

Write `tests/unit/schemasPackage/classification.test.ts` first against the planned table, then write the README until it passes. It covers §5.6 and §5.21 together. The rest is documentation.

### Implementation order

1. Write the classification test.
2. Write the README table and the new section, and fix the link.
3. Write the package README.

### Excluded scope

- The 1.0 stability contract or migration policy.
- The code-review document row (added by the headless-review plan).
- Any change to docs/specs or docs/plans.

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

- The final README section titles and anchors.
- The table rows.
- How the test matches rows to registry entries.
- Any other link you updated.
- Any deviation, with the reason.

### Commit subject

`docs(readme): persisted-formats table and reading phax files with @lbdremy/phax-schemas`

### Commit body

Replace the README's Experimental formats section with one persisted-formats table. It lists every format the schemas package exports, with where it lives, its stability and the entry to read it with. Add a "Read phax files from code" section with the Node consumer example.

The headless-authoring link now points at the new anchor. A test keeps the table, the package entries and each JSON Schema's stability declaration in agreement.
