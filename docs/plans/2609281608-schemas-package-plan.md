---
status: Draft
source-spec: docs/specs/2609241238-schemas-package.md
---
# Schemas package

Publish phax's persisted-format decoders as a standalone npm package, `@lbdremy/phax-schemas`, built from the same `src/schemas` modules phax imports. The root entry carries the eight stable formats. The `/experimental` entry carries the spec document, the plan document, the authoring record and the record-manifest union. `json/` holds one draft-07 JSON Schema per format, and each one declares its stability. The package version always equals phax's release version. The package reads every shape phax has ever written:

- a legacy document by its `version` literal;
- every new document by its `$schema` URL, `https://docs.phax.run/schemas/<format id>/<release>.json`, which names the format and the release that wrote it. phax starts writing this URL in this plan.

The phases follow the brief's order:

- phase-01 and phase-02: the package skeleton, the `Parsed` API for the shapes phax writes today, and the JSON Schemas.
- phase-03: the reading-history pattern on the phase record alone. It adds frozen v1 and v2 decoders, the shape table, `toLatestPhaseRecord` and the newer-release failure.
- phase-04: the same pattern for every other format, including the authoring record v1 with and without `sourceSha`.
- phase-05: `parseDocument`, which identifies a document by its `$schema` alone.
- phase-06: committed JSON Schema snapshots keyed by format and shape, and the snapshot gate.
- phase-07: the history-corpus script and the committed corpus, parsed in every gate including the release gate.
- phase-08 to phase-11: phax writes `$schema` as the first key of every persisted format and drops `version`, one format group per phase. The snapshot gate records each shape change as `<format id>/0.17.0.schema.json`.
- phase-12: the release workflow, the tarball smoke and `release.sh`.
- phase-13: the README persisted-formats table and the "Read phax files from code" section.

Where each requirement lands:

- §5.1–5.5, 5.7–5.9 and 5.20: phase-01. The parity test holds §5.8 from then on.
- §5.21–5.23: phase-02.
- §5.10, 5.12, 5.13 and 5.16: phase-03 and phase-04.
- §5.14: phase-04.
- §5.11: phase-05. The renamed-file case is completed in phase-10.
- §5.17: phase-06.
- §5.18–5.19: phase-07.
- §5.15: phase-08 to phase-11.
- §5.24–5.27: phase-12, using the release constant from phase-03.
- §5.6: phase-13. §5.22 is already covered by phase-02.

§5.28 (the code-review document) is not implemented here. The headless-review plan adds it to the experimental entry through the format table this plan creates.

What a phase agent can and cannot verify:

- phases 03, 04 and 07 read real history from the local clone of the records repository at `~/.phax/records/phax`. The spec author walked that clone on 2026-09-28.
- The packed-tarball smoke (phase-12) needs `npm` and the network, so it runs only in CI and the release workflow. Its first real verification is the first CI run of the pull request.

Coordination: artifact-decide, headless-review and oracle-phases (all Approved) change formats this package exports. Their plans come after this one and record their changes through the snapshot gate. A change that lands in the same release amends the unreleased `0.17.0` shape: delete its snapshot and record it again. This plan implements none of their changes.

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

The tarball smoke uses `npm pack` and `npm install`, so it runs only in CI and the release workflow, never in a phase agent.

## Technical arbitrations

- Build: a second tsc project over the same sources. `packages/schemas/tsconfig.build.json` sets rootDir to the repo root, includes only the two entry modules so tsc emits only their import closure, and sets `types: []` so a `node:` import is a compile error. Loss accepted: a flat dist layout that mirrors repo paths (`dist/packages/schemas/src/index.js`, `dist/src/schemas/*.js`), with the exports map pointing into it. An esbuild bundle was rejected because its declarations would no longer be tsc's own output for phax's types.
- Package location: `packages/schemas/`, kept outside the pnpm workspace and driven by root scripts, with `effect` resolved from the root install. Loss accepted: pnpm does not install or check the package's own dependency list separately. A unit test pins that list to exactly `effect` at the root's range.
- Corpus source (§10 open): the corpus script takes a required `--records <path>` argument naming a git repository that holds `phax/records/v1` (for phax, `~/.phax/records/phax`). Ledgers and sidecars come from `--repo`, which defaults to the current directory. Loss accepted: the script does not follow the records destination in `phax.json`, so the caller must know where their records clone lives.
- Release version: one committed constant, `PHAX_RELEASE_VERSION` in `src/domain/release.ts`. It names the release this tree ships as next (`0.17.0` now), while the root `package.json` keeps naming the last cut release (`0.16.0`) until `release.sh` runs. phax stamps `$schema` with it, the package names it in newer-release failures, and the snapshot gate names new shapes with it. A release counts as already cut when the constant is at or below the root version. Loss accepted: a second version number exists between releases, and it is bumped by hand at the first shape change after a release (the gate says so). Rejected: taking the release from `package.json`, which would name an already-released version for a new shape. Also rejected: taking it from git tags, which are missing in shallow CI clones.
- Legacy lift in phax: each phax decoder accepts exactly its format's last legacy literal by rewriting `version: N` into a leading `$schema` for the reading release before the current decoder judges the document. It is a one-step migration read, not a historical decoder; the frozen decoders stay in the package only. Loss accepted: the writer knows one legacy literal per format. Rejected: refusing legacy documents after the upgrade. That would break every command on `~/.phax/registry.json` and block resuming in-flight runs. It would block approving sidecars written before the upgrade and make `records explain` reject existing records. Worst of all, the approvals store's empty-on-decode-failure path would wipe the live ledger.
- Agent-facing contracts stay unchanged: the headless spec/plan document schema (`phax artifact schema spec|plan` and the authoring prompt), the extracted-plan schema and the compliance verdict in the review prompt stay at version 1. phax drops `version` and adds `$schema` only when it writes the persisted file. Loss accepted: two schemas per agent-produced format (authored and persisted) that must stay in step. Rejected: making the agent write `$schema`. The agent does not know phax's release, and the CLI's printed schema would change, which the spec excludes.
- Dispatch while a legacy literal is still written: the literal phax currently writes is decoded in the package by phax's own decoder, as the no-copied-schema constraint requires. Its frozen twin is created early (phase-03/04) and proven faithful by JSON Schema equality and corpus decoding. It takes over that literal in the `$schema` phase for its format. Loss accepted: each `$schema` phase flips one table entry per format. Rejected: dispatching to the frozen copy at once, which would make the package decode the shape phax writes with a copy.
- Parse results: each format's parse function returns the normative `Parsed<T>` with a `shape` id added to the success variant (`ParsedShape<T, S>`, which is assignable to `Parsed<T>`). `parseDocument` and `parseRecordManifest` also return the `format`. Legacy shape ids are `v1` and `v2`; release shape ids are the release string, e.g. `0.17.0`. Loss accepted: two closely related result types.
- Unknown marker and latest shapes: absent facts are `{ kind: "unknown" }` (exported as `Unknown`, `UNKNOWN` and `isUnknown`), with no origin shape. `Latest*` types carry no `version`. Their `$schema` is `string | Unknown`, because a legacy document does not say which release wrote it. Loss accepted: an upgraded value does not say which shape it came from, so a consumer that needs to know keeps the parse result's `shape`.
- Identification is split by entry: the root `parseDocument` identifies stable formats only, and `/experimental` exports `parseExperimentalDocument` for experimental formats only. Each one names the other entry when given a format it does not carry. Loss accepted: a reader walking mixed documents calls two functions. Rejected: one function on the root, which would return experimental types (§5.4). Also rejected: one function on `/experimental`, which would parse stable formats there (§5.5).
- phax's decoders accept a `$schema` of their own format id naming any release, because phax's own decoding is otherwise unchanged. The package additionally rejects a release newer than itself (§5.12). Parity (§5.8) is therefore asserted on documents whose release is at or below the package's. Loss accepted: phax and the package disagree on a document that claims a future release.
- Snapshots: `--write` only creates missing snapshots. It never overwrites one, and it refuses to create a release snapshot named at or below the last cut release. A later spec that amends the unreleased `0.17.0` shape deletes the snapshot and runs `--write` again, which is visible in review. Loss accepted: the gate cannot detect a snapshot of an already-released version that someone created by hand.
- Shipped JSON Schemas describe the latest shape only (what phax writes). The committed per-shape snapshots are not shipped. Loss accepted: a docs pipeline cannot validate an older-shape document against a shipped JSON Schema. Serving each release's schema at `docs.phax.run` is the docs pipeline's job (NEXT_STEPS).
- `SurfaceSchema` moves from `phaxConfig.ts` to `src/schemas/surface.ts`, so the published closure excludes phax.json's config schemas. Loss accepted: one more module, with importers updated directly (no re-export shim).
- Parity corpus (§10 open): inline accept/reject cases in one test that runs both phax's decoder and the package's parse function on each case. Loss accepted: there are no fixture files that tools outside the repo could reuse.
- Tarball install smoke (§10 open): runs in the release workflow and in CI, not in `pnpm check:full` or the phax gate profile. Loss accepted: a green local gate does not prove that the packed tarball installs and imports.
- Layout and spellings (§10 open), following spec §6:
  - history modules: `packages/schemas/src/history/<format id>/<shape>.ts`;
  - snapshots: `packages/schemas/snapshots/<format id>/<shape>.schema.json`;
  - corpus: `packages/schemas/corpus/<format id>/<shape>/<hash16>.json`;
  - format ids as in the spec's terminology; the derived `record-manifest` union has no format id and no snapshots, but ships `json/record-manifest.schema.json`;
  - release-shape types: `PhaseRecord_0_17_0`; legacy types: `PhaseRecordV1`;
  - the stability keyword: `x-phax-stability`;
  - the README section: `## Persisted formats` (`#persisted-formats`).

---

## phase-01 — Package skeleton, stable and experimental entries, Parsed API {#phase-01-package-skeleton}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

A standalone `@lbdremy/phax-schemas` package exists in the repo and builds from phax's own `src/schemas` modules. For each format, it exports a schema, a type and a parse function returning `Parsed`, for the shape phax writes today. Stable formats come from the root entry and experimental ones from `/experimental`. Its accept or reject verdict equals phax's own decoder's (parity).

### Detailed instructions

- Move `SurfaceSchema` and its `Surface` type from `src/schemas/phaxConfig.ts` to a new `src/schemas/surface.ts`. Update `phaxConfig.ts`, `runRecord.ts` and `gateAttribution.ts` to import it from there, and fix any other importer tsc reports. Do not re-export it from `phaxConfig.ts` (no shim). No schema changes shape.
- Create `packages/schemas/package.json` with:
  - `name` `@lbdremy/phax-schemas`, and `version` equal to the root `package.json` version (0.16.0);
  - `type` `module`, `license` `Apache-2.0`, `engines.node` `>=20`;
  - `dependencies` exactly `{ "effect": <the root range, ^3.14.0> }`;
  - `files` `["dist", "json"]`;
  - `exports` for `.` and `./experimental`, each `{ types, default }` pointing at the tsc output, plus `"./json/*": "./json/*"`. Confirm the emitted paths; expect `./dist/packages/schemas/src/index.{js,d.ts}` and `./dist/packages/schemas/src/experimental.{js,d.ts}`.

  Add no scripts and no devDependencies. Do not add the package to `pnpm-workspace.yaml`.
- Create `packages/schemas/tsconfig.build.json`, extending `../../tsconfig.json`, with:
  - `rootDir` `../..` and `outDir` `./dist`;
  - `include` exactly `["src/index.ts", "src/experimental.ts"]`;
  - `types` `[]` and lib ES2023, so any `node:` import in the closure fails to compile;
  - `declaration` true, and `declarationMap` and `sourceMap` false.
- Create `packages/schemas/src/parsed.ts`. It exports the `Parsed<T>` union exactly as spec §6 gives it (`{ ok: true; value } | { ok: false; error: { path: string; message: string } }`, all readonly) and a `fromEither` helper. The helper turns an `Either<T, ParseError>` into `Parsed<T>` using `ParseResult.ArrayFormatter`: `path` is the first issue's path joined with `.` (`""` at the root), and `message` is that issue's message. It never throws.
- Create `packages/schemas/src/index.ts`, the root entry (stable formats only). For each format it exports a schema constant, a type and a parse function:
  - run registry: `RegistrySchema`, `Registry`, `parseRegistry`;
  - run status: `RunStatusSchema`, `RunStatus`, `parseRunStatus`;
  - phase status: `PhaseStatusSchema`, `PhaseStatus`, `parsePhaseStatus`;
  - phax-plan: `PhaxPlanSchema`, `PhaxPlan`, `parsePhaxPlan`;
  - compliance review: `ComplianceReviewSchema`, `ComplianceReview`, `parseComplianceReview`;
  - plan approvals: `PlanApprovalsSchema` and `PlanApprovals` (phax's `ApprovalRecordFileSchema`), `parsePlanApprovals`;
  - spec approvals: `SpecApprovalsSchema` and `SpecApprovals` (phax's spec approval record file), `parseSpecApprovals`;
  - phase record manifest: `PhaseRecordSchema` and `PhaseRecord` (phax's `RunRecordManifestSchema`), `parsePhaseRecord`;
  - plus `type Parsed`.

  Each parse function is `(input: unknown) => fromEither(phaxDecodeX(input))`, calling phax's existing `decodeX` from `src/schemas`, so the schema and the `onExcessProperty` setting are phax's own. Never re-declare a schema or its decode options. If a format has no exported decoder yet (check `phaxPlan.ts` and `specApprovalRecord.ts`), export phax's existing decode function from its module instead of building one in the package.
- Create `packages/schemas/src/experimental.ts` with the same pattern for the experimental formats:
  - spec document: `SpecDocumentSchema`, `SpecDocument`, `parseSpecDocument`;
  - plan document: `PlanDocumentSchema`, `PlanDocument`, `parsePlanDocument`;
  - authoring record: `AuthoringRecordSchema` and `AuthoringRecord` (phax's `AuthoringRecordManifestSchema`), `parseAuthoringRecord`;
  - record-manifest union: `RecordManifestSchema`, `RecordManifest`, `parseRecordManifest`;
  - plus `type Parsed`.

  No stable format may be exported here.
- Change the root `package.json` `build` script to `tsc -p tsconfig.build.json && tsc -p packages/schemas/tsconfig.build.json`. Leave every other script unchanged.
- Add `packages/schemas/src/**/*` to the `include` of `tsconfig.test.json`, so `pnpm test:type` typechecks the package sources.
- In `knip.json`:
  - add `packages/schemas/src/index.ts` and `packages/schemas/src/experimental.ts` to `entry` (public entry points whose exports consumers use);
  - add `packages/schemas/src/**/*.ts` to `project`.

  Keep knip green in every later phase by adding an export only in the phase that first uses it.
- Add a `describe("architectural guard: schemas package closure")` block to `tests/unit/architecturalGuards.test.ts`. It resolves relative imports transitively from both entry modules (mapping `.js` specifiers to `.ts`) and asserts that:
  - every reached file is under `packages/schemas/src/`, `src/schemas/` or `src/domain/`, and none is under `src/app/`, `src/ports/`, `src/infra/` or `src/cli/`;
  - no reached file imports a `node:` module, `fs`, `child_process`, `net`, `os`, `path` or `@effect/platform*`, and none references `Deno`;
  - the only bare-specifier imports are `effect` and `effect/*`;
  - `src/schemas/vibeOutput.ts` and `src/schemas/phaxConfig.ts` are not reached.

  Reuse the file's existing source-walking helpers.
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

Producer: phax's `src/schemas` modules own each format's schema and its `decodeX` function, with its `onExcessProperty` setting. Consumer: the schemas package's entries, which re-export those schemas and types and wrap those decoders into `Parsed`. Contract: the package never declares a schema or a decode option of its own for a shape phax writes. Parity holds by construction, and the parity test keeps it that way. Consumer outside the repo: a Node 20+ ESM program importing `@lbdremy/phax-schemas` or `@lbdremy/phax-schemas/experimental`, with the shapes and spellings of spec §6.

### Test strategy

Write these first (stable contracts):

- `tests/unit/schemasPackage/parse.test.ts`: a valid run status returns `ok: true` with the value. A run status with state `paused` returns `ok: false`, `error.path` `state` and a non-empty message, and no exception escapes. A non-object input returns a failure.
- `tests/unit/schemasPackage/parity.test.ts`: for each exported format, inline accepted and rejected cases, each run through both phax's `decodeX` and the package's `parseX`, and the verdicts must agree. It includes the acceptance-criteria cases: a phase record with one unknown key is rejected by both, and a registry with one unknown key is accepted by both.
- `tests/unit/schemasPackage/exports.test.ts`: the runtime export names of each entry equal the exact expected set. No stable format is on `/experimental`, and no experimental format is on the root.
- `tests/unit/schemasPackage/manifest.test.ts`: the `name`, the single `effect` dependency at the root range, the version equal to the root version, the `exports` keys and the `files` list.
- `tests/type/schemasPackage.ts`: for each exported format, a value of the package type is assignable to phax's internal type, and the reverse (§5.20).

The closure guard runs in `pnpm audit:architecture`.

### Implementation order

1. Move SurfaceSchema to src/schemas/surface.ts and update its importers.
2. parsed.ts and its unit test.
3. The two entry modules, the parity and exports tests, and the type test.
4. The package manifest and build tsconfig, then the root build script, tsconfig.test.json and knip.json.
5. The closure guard in architecturalGuards.test.ts. Then run pnpm build and confirm the emitted dist paths match the exports map.

### Excluded scope

- JSON Schema files (phase-02).
- Historical shapes, toLatest and the newer-release failure (phase-03 and phase-04).
- parseDocument (phase-05), snapshots (phase-06) and the history corpus (phase-07).
- Writing `$schema` or dropping `version` (phase-08 to phase-11).
- The release workflow, release.sh and the README (phase-12 and phase-13).
- The code-review document (added by the headless-review plan).

### Verification

The `standard` gate profile in `phax.json`. On every phase it runs format, typecheck, test:type, lint, format:check, test, knip, audit:architecture and the model-catalog check. On the terminal phase it adds build and the two Deno smokes. `pnpm build` is itself a gate command; run it to confirm the package compiles.

### Expected handoff content

Record:
- the exact emitted dist paths and the final `exports` map;
- the export names of both entries, and which phax `decodeX` each parse function wraps, including any decoder you had to export from its module;
- the name of the closure-guard describe block and the files it reached;
- the `SurfaceSchema` move and every importer you updated;
- any deviation from the planned file lists, with the reason.

### Commit subject

`feat(schemas-package): add @lbdremy/phax-schemas with stable and experimental entries`

### Commit body

Add the schemas package under packages/schemas. A second tsc project builds it from only the two entry modules, so tsc emits nothing beyond their import closure. The root entry exports a schema, a type and a parse function for each of the eight stable formats. The experimental entry does the same for the spec document, the plan document, the authoring record and the record-manifest union. Each parse function wraps phax's own decoder and returns a Parsed result instead of throwing.

SurfaceSchema moves to src/schemas/surface.ts, so the published closure no longer reaches phax.json's config schemas. An architectural guard pins the closure: no app, ports, infra or cli file, no Node or Deno I/O, and neither vibeOutput.ts nor phaxConfig.ts.

---

## phase-02 — JSON Schema per format with stability, build fails on a gap {#phase-02-json-schemas}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

Building the schemas package produces one draft-07 JSON Schema file per exported format. Each file is generated from the same schema its parse function uses and declares the format as stable or experimental. The build fails, naming the format, when a schema cannot be rendered.

### Detailed instructions

- Create `packages/schemas/build/formats.ts`, the format registry. The build, the snapshot gate (phase-06), the corpus script (phase-07) and the README classification test (phase-13) all read it. Each exported format has one entry with:
  - `id`: the spec's format id, which is also the JSON file stem. Root-entry ids are `registry`, `run-status`, `phase-status`, `phax-plan`, `compliance-review`, `plan-approvals`, `spec-approvals` and `phase-record`. Experimental ids are `spec-document`, `plan-document`, `authoring-record` and the derived `record-manifest`.
  - `label`: the human name, e.g. `phase record`.
  - `title`: e.g. `phax run status`.
  - `stability`: `"stable"` or `"experimental"`. The entry follows from it: stable formats are on the root, experimental ones on `/experimental`.
  - `schema`: the current Effect schema, imported from the package entries, not from `src/schemas` directly.

  Export the list as a readonly array.
- Create `packages/schemas/build/jsonSchemas.ts` exporting a pure `renderFormatJsonSchemas(formats)`. For each format it calls `JSONSchema.make(schema)` (Effect v3, draft-07) inside try/catch. A throw becomes a failure `{ id, label, message }`. Otherwise the output is the rendered object plus `title` (the registry title, when the render has none) and `"x-phax-stability"`. The function returns every file when all formats render, and otherwise the list of failures and no files.
- Create `scripts/build-schemas-package.ts`. It renders the registry. On any failure it prints `✗ <label>: <message>` for each failed format, writes nothing and exits 1. Otherwise it empties `packages/schemas/json/` and writes each `<id>.schema.json` as two-space-indented JSON with a trailing newline. Export the main logic as a function behind a main guard, so tests can call it.
- Change the root `build` script to `tsc -p tsconfig.build.json && tsc -p packages/schemas/tsconfig.build.json && tsx scripts/build-schemas-package.ts`. Add `packages/schemas/json/` to `.gitignore`.
- Run `pnpm add -D ajv` to get a draft-07 validator for the tests.
- Check that every current schema renders with the installed Effect (see `package.json`). `BranchNameSchema` in `src/domain/branded.ts` is a `Schema.filter`, and the approval record uses `Schema.pattern`. If `JSONSchema.make` refuses one of them, add a `jsonSchema` annotation to it. Annotations only: never change what decodes.
- Register `packages/schemas/build/*.ts` and `scripts/build-schemas-package.ts` in `knip.json` as needed, so no export is reported unused.

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
- `tests/unit/schemasPackage/exports.test.ts`
- `tsconfig.test.json`
- `.oxfmtrc.json`

### Boundary contracts

Producer: the format registry in `packages/schemas/build/formats.ts`, which lists the exported formats, their stability and each format's current schema. Consumers: the JSON Schema build, the snapshot gate (phase-06), the corpus script (phase-07) and the README classification test (phase-13). Contract: every exported parse function has exactly one registry entry, and that entry's schema is the same object the parse function decodes with. Consumer outside the repo: a docs pipeline that reads `node_modules/@lbdremy/phax-schemas/json/<id>.schema.json` with a draft-07 validator.

### Test strategy

Write `tests/unit/schemasPackage/jsonSchemas.test.ts` first. It checks that:

- the registry has exactly one entry per exported parse function across both entries;
- `renderFormatJsonSchemas` succeeds on the real registry, with one file per format, and each file's `x-phax-stability` matches its registry stability (`spec-document` declares `experimental`, `run-status` declares `stable`);
- ajv in draft-07 mode compiles every file and validates one phax-written document per format (build each document with phax's encoders or with literals the existing tests use);
- an injected registry entry whose schema `JSONSchema.make` refuses yields a failure naming that format and no file for it. For example, use a `Schema.declare` with no annotation, after confirming the installed Effect refuses it.

### Implementation order

1. The format registry.
2. The pure renderer and its tests, including the gap case.
3. The build script and the root build script change.
4. ajv and the validation tests.
5. Any jsonSchema annotation the real schemas need. Then run pnpm build.

### Excluded scope

- Committed snapshots and the snapshot gate (phase-06).
- JSON Schemas for historical shapes. The shipped files describe the latest shape only.
- Hosting the schemas at a URL.
- The code-review document.

### Verification

The `standard` gate profile in `phax.json`. Run `pnpm build` (a gate command) to confirm `packages/schemas/json/` is produced.

### Expected handoff content

Record:
- the registry module path, its entry shape and the list of ids;
- the renderer's signature and failure shape;
- the build script's exported function name and the exact root build script;
- whether any schema needed a `jsonSchema` annotation, and which one;
- any deviation from the planned file lists, with the reason.

### Commit subject

`feat(schemas-package): ship one draft-07 JSON Schema per format with its stability`

### Commit body

Add the format registry: the single list of exported formats, each with its id, label, title, stability and current schema. A pure renderer turns each current schema into a draft-07 JSON Schema that declares x-phax-stability. The build script writes packages/schemas/json/<id>.schema.json. When any schema cannot be rendered, it fails naming the format and writes nothing. pnpm build now runs it, and tests validate one phax-written document per format with ajv.

---

## phase-03 — Phase record history: shape table, frozen v1 and v2, toLatest, newer-release failure {#phase-03-phase-record-history}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

For the phase record alone, a consumer can:
- parse every legacy shape phax has written (v1 and v2) and get each shape's exact type with its shape id;
- upgrade any of them to the latest shape, with absent facts marked unknown;
- get a clear upgrade-the-package failure for a `$schema` that names a newer release or an unknown format.

This phase proves the pattern on one format before phase-04 repeats it for every format.

### Detailed instructions

- Create `src/domain/release.ts` exporting `PHAX_RELEASE_VERSION = "0.17.0"`. Its doc comment says it names the release this source tree ships as next, not the last one cut. The root `package.json` keeps naming the last cut release until `release.sh` runs. phax stamps `$schema` with this constant (from phase-08), the package names it in newer-release failures, and the snapshot gate names new shapes with it. The module is pure: a string constant, no I/O.
- Create `src/schemas/schemaUrl.ts`. It is pure and imports only `effect` if anything. It exports:
  - `SCHEMA_URL_BASE = "https://docs.phax.run/schemas"`;
  - `FORMAT_IDS`, a readonly tuple of the eleven format ids phax writes: registry, run-status, phase-status, phax-plan, compliance-review, plan-approvals, spec-approvals, phase-record, spec-document, plan-document, authoring-record. Do not add code-review. Also export `type FormatId`.
  - `parseSchemaUrl(value: unknown): { formatId: string; release: string } | undefined`, which accepts `<base>/<lowercase-kebab id>/<X.Y.Z>.json` for any id, so an unknown id stays reportable;
  - `compareReleases(a, b)`, a numeric `X.Y.Z` comparison.

  Do not add the URL builder or a `$schema` Schema yet: phase-08 adds them where phax first uses them (knip).
- Extend `packages/schemas/src/parsed.ts`:
  - `ParsedShape<T, S extends string>` is `{ ok: true; value: T; shape: S }` or the failure variant, and is assignable to `Parsed<T>`;
  - a `ParseFailure` type;
  - a `failure(path, message)` helper.
- Create `packages/schemas/src/shapes.ts`. A `Shape<T>` is `{ schema, decode }`, where `decode` returns an `Either`. A legacy table entry may also carry `frozen: Shape`, the frozen twin of a literal phax still writes. `defineFormat({ id, label, legacy: { [literal]: entry }, releases: [[release, Shape], ...] })` returns the definition together with its `parse`. `parse` never throws. Its rules, in order:
  - An input that is not a plain object fails at `""`.
  - A document with a `$schema` key is handled by the URL:
    - a URL that does not parse fails at `$schema`, naming the expected URL form;
    - a format id outside `FORMAT_IDS` fails at `$schema` with `<url> names a format unknown to @lbdremy/phax-schemas <PHAX_RELEASE_VERSION> — upgrade the package`;
    - a known id other than the definition's fails with `<url> is a <that id> document, not a <id>`;
    - a release above `PHAX_RELEASE_VERSION` fails with `<id> written by phax <release> is newer than @lbdremy/phax-schemas <PHAX_RELEASE_VERSION> — upgrade the package`;
    - otherwise the decoder is the latest release shape at or below the release. If there is none, it fails with `no <id> shape is known at release <release>`.
  - A document without `$schema` whose numeric `version` has a legacy entry is decoded by that entry, and its shape id is `v<N>`.
  - A numeric `version` with no legacy entry fails at `version`, listing the known literals.
  - A document with neither fails at `$schema` (missing).

  On success, return `{ ok: true, value, shape }`, where the shape id is `v<N>` or the release string. Put the unknown-format and newer-release messages in exported helpers, so phase-05 reuses the same wording.
- Create `packages/schemas/src/history/phase-record/v1.ts` and `v2.ts`, the frozen decoders:
  - Each is self-contained: it imports only `effect` and inlines every sub-schema and annotation as it was at that shape (shape, outcome, token usage, provider id, surface). It never imports `src/schemas`.
  - Both use `onExcessProperty: "error"`, as phax does.
  - Reconstruct v1 from `git log -p -- src/schemas/runRecord.ts` (v1 predates `verifiedSurfaces`, added in 0.10) and check it against the real v1 records.
  - v2 is a faithful copy of today's `RunRecordManifestSchema`, with identical annotations, so that its `JSONSchema.make` output is identical.
  - Export `PhaseRecordV1Schema`, `type PhaseRecordV1` and `decodePhaseRecordV1`, and the same three for V2.

  Once released, these files never change.
- Update `packages/schemas/src/index.ts`:
  - Define the phase-record format with `legacy: { 1: frozen v1, 2: { phax's RunRecordManifestSchema and decodeRunRecordManifest, frozen: frozen v2 } }` and `releases: []`. Version 2 is still what phax writes, so phax's own decoder decodes it; its frozen twin takes over in phase-10.
  - `parsePhaseRecord` returns `ParsedShape<AnyPhaseRecord, PhaseRecordShape>`, where `AnyPhaseRecord = PhaseRecordV1 | PhaseRecordV2` and `PhaseRecordShape = "v1" | "v2"`.
  - `PhaseRecordSchema` and `PhaseRecord` stay phax's current schema and type.
  - Export `Unknown` (`{ readonly kind: "unknown" }`), a frozen `UNKNOWN` and `isUnknown`.
  - Export `LatestPhaseRecord`: the latest shape's fields without `version`, with `verifiedSurfaces` typed `ReadonlyArray<Surface> | Unknown`.
  - Export the pure `toLatestPhaseRecord(record: AnyPhaseRecord): LatestPhaseRecord`, discriminating on `version`. For v1 it keeps every v1 field and sets `verifiedSurfaces` to `UNKNOWN`. For v2 it keeps every field. It always drops `version` and never invents a value.
  - Also export the types `PhaseRecordV1`, `PhaseRecordV2`, `AnyPhaseRecord`, `PhaseRecordShape` and `LatestPhaseRecord`.
- Create `packages/schemas/history.lock.json`, mapping each file under `packages/schemas/src/history/` (as a path relative to `packages/schemas`) to the sha256 hex of its bytes. Compute each hash only after the file is final. In `.oxfmtrc.json`, add `packages/schemas/src/history`, `packages/schemas/corpus` and `packages/schemas/snapshots` to `ignorePatterns`, so `pnpm format` never rewrites frozen or recorded bytes.
- Seed the corpus with real phase records, using `node -e` with `child_process.execFileSync("git", ["-C", <home>/.phax/records/phax, ...])`:
  - resolve `phax/records/v1`, falling back to `refs/remotes/origin/phax/records/v1`;
  - list every commit with `rev-list`, since each commit carries its own tree;
  - for each commit, list the `*/record.json` paths with `ls-tree -r --name-only`, skip `authoring/`, and read each path with `cat-file -p`;
  - write every distinct v1 phase record and at least three v2 records into `packages/schemas/corpus/phase-record/v1/` and `packages/schemas/corpus/phase-record/v2/`.

  The naming contract is binding for phase-07's script. A file's content is `JSON.stringify(value, null, 2) + "\n"` of the parsed document. Its name is the first 16 hex characters of the sha256 of that content, plus `.json`.
- Add a guard to `tests/unit/architecturalGuards.test.ts`: no file under `src/` imports anything under `packages/`. phax imports only the decoder of the shape it writes (§5.16).
- Stop at the phase record. The other formats come in phase-04.

### Planned files to create

- `src/domain/release.ts`
- `src/schemas/schemaUrl.ts`
- `packages/schemas/src/shapes.ts`
- `packages/schemas/src/history/phase-record/v1.ts`
- `packages/schemas/src/history/phase-record/v2.ts`
- `packages/schemas/history.lock.json`
- `tests/unit/schemaUrl.test.ts`
- `tests/unit/schemasPackage/shapes.test.ts`
- `tests/unit/schemasPackage/phaseRecordHistory.test.ts`
- `tests/unit/schemasPackage/frozenHistory.test.ts`

### Planned files to edit

- `packages/schemas/src/index.ts`
- `packages/schemas/src/parsed.ts`
- `tests/unit/schemasPackage/exports.test.ts`
- `tests/unit/schemasPackage/manifest.test.ts`
- `tests/unit/architecturalGuards.test.ts`
- `.oxfmtrc.json`

### Optional files that may be edited

- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/parse.test.ts`
- `tests/type/schemasPackage.ts`
- `packages/schemas/build/formats.ts`
- `knip.json`

### Boundary contracts

Producer: `packages/schemas/src/shapes.ts`, which provides the format definition, the shape resolution rules, `Unknown` and the failure messages. Consumers: every format's parse function (from phase-04), `parseDocument` (phase-05), the snapshot gate (phase-06) and the corpus script (phase-07).

Contract: a format is a table of shapes. Legacy literals map to decoders; after its `$schema` phase, every literal a format has maps to a frozen module under `packages/schemas/src/history/<format id>/`, which imports only `effect`. Releases map to decoders, and the latest release maps to phax's own decoder. A `$schema` document is decoded by the latest release shape at or below its release.

Producer: `src/domain/release.ts` (`PHAX_RELEASE_VERSION`). Consumers: the package's newer-release check now, and phax's `$schema` stamping and the snapshot gate later.

### Test strategy

Write these first:

- `tests/unit/schemaUrl.test.ts`: `parseSchemaUrl` accepts known and unknown ids and rejects malformed URLs. `compareReleases` orders by numeric triples (`0.10.0` is above `0.9.0`).
- `tests/unit/schemasPackage/shapes.test.ts`: a toy format with legacy literals 1 and 2 and toy release shapes `0.10.0` and `0.12.0`, used to check every rule:
  - a `$schema` at `0.11.0` resolves to shape `0.10.0`, and `0.12.0` to `0.12.0`;
  - `0.9.0` fails with no shape;
  - `99.0.0` fails, naming the release, `PHAX_RELEASE_VERSION` and upgrade;
  - an unknown id fails with the upgrade message;
  - another known id fails, naming it;
  - a malformed URL fails, as do an unknown legacy literal, neither marker, and a non-object;
  - no case throws.
- `tests/unit/schemasPackage/phaseRecordHistory.test.ts`:
  - every corpus document under `phase-record/v1` and `v2` parses `ok`, with `shape` equal to its directory and `value.version` equal to its literal, and narrowing on `version` typechecks to the exact shape;
  - a v2 document with `$schema` `https://docs.phax.run/schemas/phase-record/0.19.0.json` fails with the spec's newer-release message;
  - `toLatestPhaseRecord` on a v1 corpus record gives `verifiedSurfaces` equal to `{ kind: "unknown" }`, keeps every v1 field, and has no `version`;
  - on a v2 record, it keeps every field except `version`.
- `tests/unit/schemasPackage/frozenHistory.test.ts`:
  - every file under `packages/schemas/src/history/` has a `history.lock.json` entry with a matching sha256, and every entry names an existing file;
  - for each frozen twin of a literal phax still writes, `JSONSchema.make` deep-equals phax's current schema's output, and every corpus document of that literal decodes to the same verdict and value with both.

The manifest test also asserts that `PHAX_RELEASE_VERSION` is at or above the root version, and that the schemas manifest version equals the root version. The parity test must stay green.

### Implementation order

1. src/domain/release.ts, src/schemas/schemaUrl.ts and their tests.
2. parsed.ts, then shapes.ts and the toy-format tests.
3. The frozen v1 module (reconstructed from git history) and the frozen v2 twin.
4. The corpus seeds from the records clone.
5. The phase-record definition in index.ts, toLatestPhaseRecord and the new types.
6. history.lock.json, the frozen-history test, the oxfmt ignores and the src→packages import guard.

### Excluded scope

- Every format other than the phase record (phase-04).
- parseDocument (phase-05).
- The corpus extraction script (phase-07). The seeds here are copied under the binding naming contract.
- Snapshots (phase-06).
- Writing `$schema` in phax (phase-08 to phase-11).

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

Record:
- the `shapes.ts` API: the definition shape, the resolution rules, the failure messages and the helper names phase-05 reuses;
- the `schemaUrl.ts` exports;
- the reconstructed v1 shape and how it differs from v2;
- the number of v1 and v2 seeds written, and the naming contract as implemented;
- the `history.lock.json` format;
- the new export names.

The corpus files are expected unplanned creations under `packages/schemas/corpus/phase-record/`; list them as such. Record any other deviation, with the reason.

### Commit subject

`feat(schemas-package): read phase record v1 and v2 history, upgrade to latest`

### Commit body

Validate the reading-history pattern on one format first. A shape table maps a document to its shape: a legacy document by its version literal, and a document carrying $schema by the latest shape released at or before the release its URL names. parsePhaseRecord now reads v1 with a frozen, self-contained decoder and v2 with phax's own decoder, and returns the exact shape with its shape id. A $schema naming a release newer than the package, or an unknown format id, fails without throwing and says to upgrade the package. toLatestPhaseRecord upgrades a v1 record in memory and marks verifiedSurfaces as { kind: "unknown" }.

PHAX_RELEASE_VERSION in src/domain/release.ts names the release this tree ships as (0.17.0). The frozen v2 twin is proven identical to phax's current decoder. history.lock.json pins every frozen module's bytes, and a guard keeps src/ from importing the package. Real v1 and v2 records from the records branch seed the corpus.

---

## phase-04 — History for every format: frozen v1 twins, shape tables, toLatest {#phase-04-history-all-formats}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

Every format the package exports reads through the same shape table as the phase record. Each has a frozen twin of the legacy shape phax writes today, a `toLatest` function, and the upgrade-the-package failure. The record-manifest union reads any record on `phax/records/v1`, and both legacy authoring-record v1 shapes parse.

### Detailed instructions

- Freeze today's version-1 schema of every other format into `packages/schemas/src/history/<format id>/v1.ts`, for registry, run-status, phase-status, phax-plan, compliance-review, plan-approvals, spec-approvals, spec-document, plan-document and authoring-record. Each module:
  - is self-contained: it imports only `effect` and inlines every sub-schema and annotation (the run and phase state unions, the effort union, a copy of the `BranchNameSchema` predicate, token usage, provider id, surface, the 40-hex baseline pattern, and so on), so that its `JSONSchema.make` output equals phax's current output;
  - keeps the excess-property setting of phax's decoder: the default for registry, run-status and phase-status, and `"error"` elsewhere;
  - exports `<Format>V1Schema`, `type <Format>V1` and a decode function.

  Add each module's sha256 to `packages/schemas/history.lock.json` once the file is final.
- The authoring-record v1 twin copies phax's current `AuthoringRecordManifestSchema`, in which `sourceSha` is already optional. That makes it accept both legacy shapes (§5.14). Verify every authoring corpus seed against both phax's decoder and the frozen one. If the corpus shows a v1 variant that phax's decoder rejects, widen only the frozen module to accept it, and report this in the handoff.
- In `index.ts` and `experimental.ts`, define each format through `defineFormat` with `legacy: { 1: { phax's schema and decoder, frozen: the frozen v1 } }` and `releases: []`. Each parse function returns `ParsedShape<Any<Format>, <Format>Shape>`. Behavior on current documents is unchanged (parity).
- For every format, export a pure `toLatest<Format>`: `toLatestRegistry`, `toLatestRunStatus`, `toLatestPhaseStatus`, `toLatestPhaxPlan`, `toLatestComplianceReview`, `toLatestPlanApprovals`, `toLatestSpecApprovals`, `toLatestSpecDocument`, `toLatestPlanDocument`, `toLatestAuthoringRecord` and `toLatestRecordManifest`. Also export the `<Format>V1`, `Any<Format>`, `Latest<Format>` and `<Format>Shape` types. While a format has one shape, `toLatest` keeps every field and drops `version`. The `$schema` phases widen these functions and types.
- Add `ParsedDocument<F, S, T>` to `parsed.ts`: `{ ok: true; format: F; shape: S; value: T }` or a failure. `parseRecordManifest` returns it. A document carrying `$schema` goes to the phase-record or authoring-record parse function by its format id; any other id fails. Otherwise `kind === "authoring"` goes to `parseAuthoringRecord`, and anything else to `parsePhaseRecord`, so every phase-record shape is readable through the union. `toLatestRecordManifest` dispatches the same way.
- Seed the corpus with every distinct authoring record from the records clone: the `authoring/<id>/record.json` paths across every commit. Use the phase-03 `node` and `git -C` approach and naming contract, and write into `packages/schemas/corpus/authoring-record/v1/`. The seeds must include records with and without `sourceSha`.
- Extend `frozenHistory.test.ts` so the twin-fidelity checks (JSON Schema equality and corpus decoding) cover every new twin. Update `exports.test.ts` for the new runtime exports. Update the format registry's schema references if they need anything new.

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
- `packages/schemas/src/experimental.ts`
- `packages/schemas/src/parsed.ts`
- `packages/schemas/history.lock.json`
- `tests/unit/schemasPackage/exports.test.ts`
- `tests/unit/schemasPackage/frozenHistory.test.ts`

### Optional files that may be edited

- `packages/schemas/src/shapes.ts`
- `packages/schemas/build/formats.ts`
- `tests/type/schemasPackage.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/phaseRecordHistory.test.ts`
- `tests/unit/schemasPackage/parse.test.ts`
- `tests/unit/schemasPackage/jsonSchemas.test.ts`

### Boundary contracts

Producer: each entry's parse function and its `toLatest` function. Consumer: a third-party reader walking history, such as the cockpit walking `phax/records/v1` through `parseRecordManifest`. Contract:
- `parse` returns the exact shape of the document with its shape id. The value is discriminated by `version` for legacy shapes, and additionally by `kind`, and the returned `format`, for the union.
- `toLatest` returns the latest shape with absent facts as `{ kind: "unknown" }`, and never an invented value.

### Test strategy

Write `tests/unit/schemasPackage/formatHistory.test.ts` first. For every format, it checks that:

- a current document parses with shape `v1`;
- the same document with `$schema` naming release `99.0.0` of its format fails with the newer-release message, without throwing;
- a document naming an unknown format id fails with the upgrade message;
- `toLatest` of a current document keeps every field except `version`.

For the authoring record and the union, it checks that:

- every authoring-record corpus seed parses `ok`, with at least one seed with `sourceSha` and one without;
- `parseRecordManifest` reads a v1 phase record, a v2 phase record and a v1 authoring record from the corpus, each with the right `format` and `shape`.

The frozen-history test covers every twin.

### Implementation order

1. Freeze the ten v1 twins and add their lock entries.
2. Define the root-entry formats on the shape table.
3. Define the experimental-entry formats, including the union.
4. Add the toLatest functions and the new types.
5. Seed the authoring corpus, then write the tests and update the exports set.

### Excluded scope

- parseDocument (phase-05), snapshots (phase-06) and the corpus script (phase-07).
- Writing `$schema` in phax, or flipping any table entry to its frozen twin (phase-08 to phase-11).

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

Record:
- the full list of new exports per entry;
- the ten frozen modules and their lock entries;
- the number of authoring-record seeds and how many lack `sourceSha`;
- whether the frozen authoring v1 had to widen beyond phax's decoder, and how;
- any other difference between the legacy shapes.

The corpus files are expected unplanned creations under `packages/schemas/corpus/authoring-record/v1/`. Record any other deviation, with the reason.

### Commit subject

`feat(schemas-package): shape table, frozen v1 twins and toLatest for every format`

### Commit body

Apply the phase-record history pattern to every exported format. Each format now has a shape table and a frozen, self-contained twin of the version-1 shape phax writes today, proven identical to phax's decoder. Each parse function returns the exact shape with its shape id and fails without throwing on a newer release or an unknown format. Each format has a pure toLatest counterpart. parseRecordManifest dispatches on $schema or kind, so it reads every phase-record shape as well as authoring records.

Both legacy authoring-record v1 shapes in the records history, with and without sourceSha, are seeded into the corpus and parse.

---

## phase-05 — parseDocument: identification by $schema alone {#phase-05-parse-document}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

A consumer holding any JSON value can ask the package what it is. `parseDocument` reads the format id and the release from the document's `$schema` alone and returns the format, the shape and the parsed value. For anything the package cannot or must not read, it returns a named failure.

### Detailed instructions

- Create `packages/schemas/src/document.ts` with a builder that takes a list of format definitions (from `shapes.ts`) and the name of the other entry, and returns a document parser. The parser takes only a value, never a path. It never throws. Its rules:
  - An input that is not a plain object fails at `""`.
  - A document without `$schema` fails at `$schema`. The message says a legacy document carries only a `version` literal, is identified by where it lives, and must be read with its format's parse function (e.g. `parsePhaseRecord`).
  - A malformed URL fails at `$schema`.
  - A format id outside `FORMAT_IDS` fails with the same upgrade message `shapes.ts` uses.
  - A known id that belongs to the other entry fails, naming that entry's import path.
  - Otherwise the parser delegates to that format's parse function, which handles the newer-release and no-shape cases, and returns `{ ok: true, format, shape, value }` (`ParsedDocument`).
- In `index.ts`, export `parseDocument` over the eight stable format definitions. Export the `StableFormatId` and `StableDocument` types, where `StableDocument` is the union of each stable format's `Any<Format>`.
- In `experimental.ts`, export `parseExperimentalDocument` over the spec-document, plan-document and authoring-record definitions, and the matching `ExperimentalFormatId` and `ExperimentalDocument` types. The record-manifest union has no format id of its own, so it is not identified here.
- Until phase-08, no format has a release shape. A `$schema` document of a known format, at a release at or below `PHAX_RELEASE_VERSION`, therefore fails with no shape. The tests cover this now, and the `$schema` phases turn it into success.
- Update `exports.test.ts` for the new exports.

### Planned files to create

- `packages/schemas/src/document.ts`
- `tests/unit/schemasPackage/parseDocument.test.ts`

### Planned files to edit

- `packages/schemas/src/index.ts`
- `packages/schemas/src/experimental.ts`
- `tests/unit/schemasPackage/exports.test.ts`

### Optional files that may be edited

- `packages/schemas/src/shapes.ts`
- `packages/schemas/src/parsed.ts`
- `tests/type/schemasPackage.ts`

### Boundary contracts

Producer: `parseDocument` and `parseExperimentalDocument`. Consumer: a reader holding documents whose file names and locations say nothing, such as exported copies, or several files of one format. Contract: identification uses the `$schema` URL alone. The result names the format id, the shape id and the value, or fails with a message the reader can act on: upgrade the package, import the other entry, or use the format's parse function for a legacy document.

### Test strategy

Write `tests/unit/schemasPackage/parseDocument.test.ts` first. It checks that:

- a document without `$schema` fails at `$schema`, naming the format parse functions;
- a document whose `$schema` names an unknown format id fails, naming the URL, `PHAX_RELEASE_VERSION` and upgrade;
- a phase record whose `$schema` names release `0.19.0` fails with the spec's newer-release message;
- `parseDocument` given a `spec-document` URL fails, naming `@lbdremy/phax-schemas/experimental`, and `parseExperimentalDocument` given a `phase-record` URL fails, naming the root entry;
- a known format at a release at or below the package's, before any release shape exists, fails with no shape;
- a malformed URL and a non-object fail;
- none of these throws.

The renamed-file acceptance criterion (a record copied to `exports/a.json` and a ledger to `exports/b.json`) is completed in phase-10, once phax writes `$schema`.

### Implementation order

1. document.ts with its rules.
2. The two entry exports and their types.
3. The tests and the exports set.

### Excluded scope

- Release shapes for any format (phase-08 to phase-11).
- Reading files or walking the records branch (a spec non-goal).

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

Record:
- the builder's signature and the two exported function names;
- the failure messages, and which ones are shared with `shapes.ts`;
- the new exported types;
- any deviation from the planned file lists, with the reason.

### Commit subject

`feat(schemas-package): identify a document by its $schema alone with parseDocument`

### Commit body

Add parseDocument to the root entry and parseExperimentalDocument to the experimental entry. Each one reads the format id and the release from a document's $schema URL, never from a file name or location. It then returns the format id, the shape id and the parsed value.

A document of the other entry's format fails, naming the entry to import. An unknown format id or a newer release fails, naming the URL and the package version and saying to upgrade the package. A legacy document without $schema fails, pointing at the format's own parse function. No call throws.

---

## phase-06 — JSON Schema snapshots per format and shape, and the snapshot gate {#phase-06-snapshot-gate}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

Every shape of every format has a committed JSON Schema snapshot. A change to the shape phax writes fails phax's gate until it is recorded as a snapshot named by the release that makes it. A released shape can no longer change.

### Detailed instructions

- Extend each registry entry in `packages/schemas/build/formats.ts` with its `definition` (the package's format definition from `shapes.ts`, imported from the modules that define it). The derived `record-manifest` union has no definition and no snapshots.
- Create `packages/schemas/build/snapshots.ts` exporting a pure `checkSnapshots({ formats, snapshots, release, lastCut })`:
  - `snapshots` maps `<id>/<shape>` to the parsed snapshot JSON;
  - `release` is `PHAX_RELEASE_VERSION`, and `lastCut` is the root `package.json` version;
  - a snapshot's content is the raw `JSONSchema.make(schema)` output, without the title or stability additions, so a stability change never touches a shape snapshot;
  - shapes order legacy literals first (by number), then releases (by `compareReleases`).

  It returns findings:
  - (a) A shape in a format table, other than the latest, with no snapshot: `✗ <id>: no snapshot for shape <shape> — run pnpm exec tsx scripts/schemas-snapshots.ts --write`.
  - (b) A frozen module (a historical shape, or the frozen twin of the latest legacy literal) whose generated schema differs from its shape's snapshot: `✗ <id>: the frozen decoder of shape <shape> differs from snapshots/<id>/<shape>.schema.json`.
  - (c) The schema G generated for the latest shape (phax's decoder) against the format's latest committed snapshot L:
    - equal: no finding;
    - different, no snapshot for `release`, and `release` above `lastCut`: `✗ <id>: the generated schema differs from snapshots/<id>/<L>.schema.json and no snapshot exists for <release> — record snapshots/<id>/<release>.schema.json`;
    - different, a snapshot for `release` exists, and `release` above `lastCut`: `✗ <id>: the generated schema differs from snapshots/<id>/<release>.schema.json, which is unreleased — delete it and record it again with --write`;
    - different, and `release` at or below `lastCut`: `✗ <id>: the generated schema differs from snapshots/<id>/<L>.schema.json and <release> is already released — set PHAX_RELEASE_VERSION in src/domain/release.ts to the next release, then record snapshots/<id>/<that release>.schema.json`.
  - (d) The latest shape in a format table differs from the name of that format's latest snapshot: `✗ <id>: the latest snapshot is <L> but the format table's latest shape is <S> — add shape <L> to the table, decoded by phax's decoder, and move the previous shape to its frozen module`.
  - (e) A snapshot file that names no format, or no shape in its format's table (other than the case (d) reports).
- Create `scripts/schemas-snapshots.ts`, which reads `packages/schemas/snapshots/`, `PHAX_RELEASE_VERSION` and the root `package.json` version:
  - By default it runs the check, prints the findings and exits 1 if there are any.
  - With `--write` it creates only missing snapshots, as two-space JSON with a trailing newline. A historical shape's snapshot is written from its frozen module; a latest shape's, and case (c)'s `<release>` snapshot, from G. It never overwrites an existing file, and it refuses to create a release snapshot named at or below `lastCut`.

  Document at the top of the file how to amend a shape not yet in any release (e.g. a later spec that changes the same format in the same release): delete its snapshot and run `--write` again, which is visible in review.
- In the root `package.json`, add the script `"schemas:check": "tsx scripts/schemas-snapshots.ts"` and append `&& npm run schemas:check` to `check:full`.
- Generate the twelve legacy-named snapshots with `pnpm exec tsx scripts/schemas-snapshots.ts --write`, and never edit a snapshot by hand. Each latest legacy literal (registry v1, …, phase-record v2, authoring-record v1) is recorded from phax's decoder; phase-record v1 is recorded from its frozen module.
- In `tests/unit/schemasPackage/frozenHistory.test.ts`, remove the JSON Schema twin-equality assertions, now covered by finding (b). Keep the lock-hash and corpus-decoding checks.
- Register the new build module and script in `knip.json` if needed.

### Planned files to create

- `packages/schemas/build/snapshots.ts`
- `scripts/schemas-snapshots.ts`
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
- `package.json`
- `knip.json`
- `tests/unit/schemasPackage/frozenHistory.test.ts`

### Optional files that may be edited

- `packages/schemas/src/shapes.ts`
- `packages/schemas/src/index.ts`
- `packages/schemas/src/experimental.ts`
- `.oxfmtrc.json`

### Boundary contracts

Producer: `packages/schemas/snapshots/<format id>/<shape>.schema.json`, one file per shape. Consumer: the snapshot check that runs in `pnpm test`, and therefore in every phase gate, the release Gate step and CI.

Contract for the `$schema` phases and for later plans (artifact-decide, oracle-phases, headless-review), when they change a format:
- move the latest shape's decoder into a frozen module;
- add the new release shape to the table, decoded by phax;
- record `<id>/<PHAX_RELEASE_VERSION>.schema.json` with `--write`.

Amending an unreleased shape means deleting its snapshot and recording it again. A released shape never changes.

### Test strategy

Write `tests/unit/schemasPackage/snapshots.test.ts` first:

- `checkSnapshots` on the real registry and the committed snapshots returns no findings. This is the gate.
- The acceptance-criteria scenario, on an injected registry: the phase-record latest schema gains one key, with `release` `0.17.0` and `lastCut` `0.16.0`. The check returns exactly one finding, naming `phase-record` and `phase-record/0.17.0.schema.json`. Adding that snapshot and the `0.17.0` table shape (injected) makes it pass.
- The same change with `release` equal to `lastCut` yields the already-released message.
- A change against an existing unreleased `<release>` snapshot yields the delete-and-record-again message.
- A missing historical snapshot, a drifted frozen module, a table/snapshot mismatch (d) and an orphan (e) are each reported.
- The `--write` rules: missing snapshots only, no overwrite, and a refusal at or below `lastCut`, exercised on a temp directory through the script's exported function.

### Implementation order

1. Add the definitions to the registry.
2. The pure check and its tests, including the injected cases.
3. The script with --write. Run it to create the twelve snapshots.
4. The package.json scripts, the frozen-history test update and knip.

### Excluded scope

- Any shape change (phase-08 to phase-11).
- The history corpus (phase-07).
- Snapshots of the record-manifest union.

### Verification

The `standard` gate profile in `phax.json`. The snapshot check runs inside `pnpm test`.

### Expected handoff content

Record:
- the `checkSnapshots` signature and the exact finding messages;
- the snapshot naming and content rule (raw `JSONSchema.make` output);
- the `--write` semantics and the rule for amending an unreleased shape, which phase-08 to phase-11 follow;
- the twelve snapshot files written, and which decoder each came from;
- any deviation, with the reason.

### Commit subject

`feat(schemas-package): commit a JSON Schema snapshot per format shape and gate on it`

### Commit body

Commit one JSON Schema snapshot per format and shape under packages/schemas/snapshots/<format id>/<shape>.schema.json. A pure check compares the schema generated from phax's decoder with the format's latest snapshot. When they differ and no snapshot exists for PHAX_RELEASE_VERSION, the check fails naming the format and the snapshot to record, e.g. snapshots/phase-record/0.17.0.schema.json. It rejects changes to a released shape and requires an unreleased snapshot to be re-recorded rather than drift. It also checks every frozen decoder against its own snapshot.

scripts/schemas-snapshots.ts runs the check; it runs in pnpm test and in pnpm schemas:check, now part of check:full. With --write it creates missing snapshots only, and never overwrites a snapshot or records one for a release already cut.

---

## phase-07 — History-corpus extraction script and the committed corpus {#phase-07-history-corpus}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

A committed script extracts every distinct persisted document from git history into a per-format, per-shape corpus. The corpus it produces for phax is committed. Every document in it must parse with the package in every gate, including the release gate.

### Detailed instructions

- Export `resolveShape(definition, value)` from `packages/schemas/src/shapes.ts`. It returns the shape id the parse function would use (a release shape from `$schema`, or `v<N>` from the literal) or a failure, without decoding.
- Create `packages/schemas/build/corpus.ts` (pure):
  - `classifyDocument(source, value)` maps a document to `{ formatId, shape }` or an error. `source` is `record` (a `record.json`), `plan-ledger`, `spec-ledger` or `sidecar`.
    - A value with `$schema` takes its format id from the URL, and that id must agree with the source: a record is `phase-record` or `authoring-record`, a ledger is its own approvals format, and a sidecar is `spec-document` or `plan-document`.
    - Without `$schema`: a record with `kind` `"authoring"` is `authoring-record`, and any other record is `phase-record`; the ledgers are `plan-approvals` and `spec-approvals`; a sidecar's `kind` `spec` or `plan` gives `spec-document` or `plan-document`.
    - The shape comes from `resolveShape`; an unresolvable document is an error.
  - `corpusFileFor(value)` returns `{ name, content }` under the phase-03 naming contract.
- Create `scripts/extract-history-corpus.ts`, exporting `extractHistoryCorpus({ records, repo, out })` behind a main guard. Its arguments are `--records <path>` (required; a git repository holding `phax/records/v1`), `--repo <path>` (default: the current directory) and `--out` (default: `packages/schemas/corpus`). It runs `execFileSync("git", ["-C", dir, ...])` with no shell, over three sources:
  - Records: resolve `phax/records/v1`, falling back to `refs/remotes/origin/phax/records/v1`. For every commit from `rev-list` (each commit carries its own tree), take every path ending in `/record.json` from `ls-tree -r --name-only` and read it with `cat-file -p <commit>:<path>`.
  - Ledgers: for `docs/plans/approvals.json` and `docs/specs/approvals.json`, read the blob at every commit from `git log --all --format=%H -- <path>`, skipping commits where the file is deleted.
  - Sidecars: for every commit touching a `.json` file under `docs/specs/` or `docs/plans/` (archive folders included, the approvals ledgers excluded), read each touched path's blob, skipping deletions.

  For each document, `JSON.parse` it and classify it. A classification error aborts, naming `<commit>:<path>`. Then write `<out>/<formatId>/<shape>/<name>`, only if absent. Finish by printing a count per format and shape.
- Run `pnpm exec tsx scripts/extract-history-corpus.ts --records ~/.phax/records/phax`. It must reproduce the phase-03/04 seeds under the same names, with no duplicates. Commit the resulting corpus.
- Create `tests/unit/schemasPackage/historyCorpus.test.ts`. It walks `packages/schemas/corpus/<id>/<shape>/*.json` and parses each file with the package parse function for the registry entry `<id>`. It asserts `ok` and `shape === <shape>`. A failure message names the file's repo-relative path and the first violation's path and message. This puts §5.18 in `pnpm test`, which the release workflow's Gate step already runs.
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
- `packages/schemas/src/shapes.ts`
- `.oxfmtrc.json`
- `tsconfig.test.json`
- `tests/unit/schemasPackage/phaseRecordHistory.test.ts`
- `tests/unit/schemasPackage/formatHistory.test.ts`

### Boundary contracts

Producer: `scripts/extract-history-corpus.ts`, which writes `packages/schemas/corpus/<formatId>/<shape>/<hash16>.json`. Consumers: the corpus parse test (every gate and the release gate), and the `$schema` phases, whose table changes must keep every corpus document parsing. Contract: the corpus holds real documents only, named by content hash. A directory never mixes shapes, and a shape directory is named exactly as the parse function names that shape.

### Test strategy

Write the pure tests first:

- `tests/unit/schemasPackage/corpus.test.ts` covers classification for each source and kind, the case where a `$schema` id disagrees with the source, the unresolvable-shape error, and the naming contract (a name matches an existing seed's name).
- `tests/integration/extractHistoryCorpus.test.ts` sets up temp git repos:
  - a records repo whose `phax/records/v1` has two commits, each with its own tree: first a v2 phase record, then that record plus a v1 authoring record;
  - a main repo that commits `docs/plans/approvals.json` twice with different content, and a spec sidecar once.

  It runs `extractHistoryCorpus` and asserts the per-format and per-shape directories, the deduplication and the file names. A record with a string `version` must abort, naming the commit and the path.
- `historyCorpus.test.ts` is the gate on the real corpus.

### Implementation order

1. resolveShape, then corpus.ts and its unit tests.
2. The script and its integration test.
3. Run the script against ~/.phax/records/phax and the repo.
4. The historyCorpus parse test, then knip.

### Excluded scope

- Following the records destination in `phax.json`: the path argument is the chosen interface.
- Documents that live outside git (registry, run status, phase status, phax-plan, compliance review). The spec's corpus sources are the records branch, the ledgers and the sidecars.
- Re-extracting at every release. The script is re-run by hand when needed.

### Verification

The `standard` gate profile in `phax.json`. The corpus parse runs inside `pnpm test`.

### Expected handoff content

Record:
- the script's arguments and exported function, and the `resolveShape` signature;
- the document count per format and shape found in phax's history. Expect roughly 6 phase-record v1, 51 v2 and 8 authoring-record v1, plus the ledgers and sidecars.
- any document that could not be classified.

The corpus files are expected unplanned creations under `packages/schemas/corpus/`. Record any other deviation, with the reason.

### Commit subject

`feat(schemas-package): extract the history corpus from git and parse it in every gate`

### Commit body

Add scripts/extract-history-corpus.ts. It walks every commit of phax/records/v1 in the records repository named by --records, then every commit in --repo that touches the approvals ledgers or a spec or plan sidecar. It writes each distinct document into packages/schemas/corpus/<format id>/<shape>/, named by content hash, where the shape comes from $schema or from the legacy version literal.

The corpus extracted from phax's own history and records clone is committed, and pnpm test parses all of it with the package. A document that fails stops the release gate, naming the file and its first violation.

---

## phase-08 — $schema for the registry, run status and phase status {#phase-08-schema-url-run-state}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

Every run registry, run-status and phase status document phax writes starts with its `$schema` URL and carries no `version`. Documents written at v1 still read: phax reads them through a one-step lift, and the package through the frozen v1 decoders. The snapshot gate records the shape change as `0.17.0`. This phase establishes the recipe that phase-09 to phase-11 repeat.

### Detailed instructions

- In `src/schemas/schemaUrl.ts`, add:
  - `schemaUrl(formatId, release)`, which builds `<base>/<id>/<release>.json`;
  - `SchemaUrlSchema(formatId)`, a `Schema.String` with a `Schema.pattern` accepting that format id at any `X.Y.Z` release, so it renders in JSON Schema.

  Extend `tests/unit/schemaUrl.test.ts` to cover both.
- Create `src/schemas/legacyLift.ts` with a pure `liftLegacy(raw, formatId, literal)`. When `raw` is a plain object with `version === literal` and no `$schema` key, it returns a new object whose first key is `$schema: schemaUrl(formatId, PHAX_RELEASE_VERSION)`, followed by every other key except `version`. Otherwise it returns `raw` unchanged. It is a one-step migration read, not a decoder.
- In `src/schemas/registry.ts` and `src/schemas/status.ts`:
  - make `$schema: SchemaUrlSchema("<id>")` the first field of each struct, and remove `version`;
  - `decodeRegistry`, `decodeRunStatus` and `decodePhaseStatus` become `(u) => current(liftLegacy(u, "<id>", 1))`.

  Encoding a struct emits keys in field order, so `$schema` comes first. Decoding is otherwise unchanged, and `RegistryEntry` does not change.
- Stamp every writer with `$schema: schemaUrl("<id>", PHAX_RELEASE_VERSION)` as the first key and no `version`. Override any value inherited from a spread, so read-modify-write paths name the release doing the write, and build raw objects as `{ $schema, ...rest }` so `$schema` stays first. The writers are:
  - `src/app/registry.ts`: the empty registry, `upsertRun` and `setRunStatus`;
  - `src/app/runFolder.ts`: the new run status;
  - `src/app/phaseFolder.ts`: the new phase status;
  - `src/app/effectRunner.ts`, `src/app/gates.ts` and `src/app/phaseStatusUpdates.ts`;
  - the raw spreads in `src/app/resetPhase.ts` and `src/cli/interruptHandler.ts`;
  - `src/infra/providers/sessionWriter.ts`;
  - any fallback literal in `src/cli/commands/run.ts`.
- In `packages/schemas/src/index.ts`, change the tables of registry, run-status and phase-status:
  - `legacy: { 1: the frozen v1 module }`: flip the twin in;
  - `releases: [["0.17.0", phax's schema and decoder]]`.

  Then:
  - export `Registry_0_17_0`, `RunStatus_0_17_0` and `PhaseStatus_0_17_0`, which are phax's types;
  - widen `Any*` to `V1 | _0_17_0` and the shape ids to `"v1" | "0.17.0"`;
  - `Latest*` carries `$schema: string | Unknown`;
  - `toLatest*` of a v1 document sets `$schema` to `UNKNOWN`, drops `version` and keeps every other field; a `0.17.0` document is returned unchanged.
- Run `pnpm exec tsx scripts/schemas-snapshots.ts` before writing snapshots, and copy its findings into the handoff: this is the gate recording the change. Then run it with `--write` to create `registry/0.17.0`, `run-status/0.17.0` and `phase-status/0.17.0`. The v1 snapshots stay as they are and are now checked against the frozen modules.
- Update the test fixtures:
  - typed literal documents use a fixed URL at release `0.17.0` (e.g. `https://docs.phax.run/schemas/registry/0.17.0.json`);
  - assertions on documents phax wrote compare with `schemaUrl(id, PHAX_RELEASE_VERSION)`;
  - v1 files that tests write to disk may stay v1 where the test is about reading, since the lift covers them.

  Update the parity cases, the JSON Schema fixture documents, the type test and the `parseDocument` tests. A `run-status` document with `$schema` now parses, with format `run-status` and shape `0.17.0`.

### Planned files to create

- `src/schemas/legacyLift.ts`
- `packages/schemas/snapshots/registry/0.17.0.schema.json`
- `packages/schemas/snapshots/run-status/0.17.0.schema.json`
- `packages/schemas/snapshots/phase-status/0.17.0.schema.json`
- `tests/unit/legacyLift.test.ts`
- `tests/integration/schemaUrlRunState.test.ts`

### Planned files to edit

- `src/schemas/schemaUrl.ts`
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
- `tests/unit/schemaUrl.test.ts`
- `tests/unit/schemas.test.ts`
- `tests/integration/registry.test.ts`

### Optional files that may be edited

- `src/cli/commands/run.ts`
- `packages/schemas/build/formats.ts`
- `tests/unit/architecturalGuards.test.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/formatHistory.test.ts`
- `tests/unit/schemasPackage/parseDocument.test.ts`
- `tests/unit/schemasPackage/exports.test.ts`
- `tests/unit/schemasPackage/jsonSchemas.test.ts`
- `tests/unit/schemasPackage/parse.test.ts`
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

Producers: `src/schemas/schemaUrl.ts` (`schemaUrl`, `SchemaUrlSchema`), `src/schemas/legacyLift.ts` and `src/domain/release.ts`. Consumers: every phax writer of these three formats, and phase-09 to phase-11, which reuse the recipe. Contract:
- phax writes only the `$schema` shape;
- phax's decoders accept v1 only by lifting it;
- only the package's frozen modules decode v1 as v1;
- the package's latest release shape is decoded by phax's own decoder.

### Test strategy

Write these first:

- `tests/unit/legacyLift.test.ts`: a v1 object is lifted with `$schema` as its first key and without `version`. Every other key and value is kept. Other literals, objects that already carry `$schema`, and non-objects pass through unchanged.
- `tests/integration/schemaUrlRunState.test.ts`, with fake ports:
  - creating a run writes a registry, a run status and a phase status whose first key is `$schema`, equal to `schemaUrl(id, PHAX_RELEASE_VERSION)`, and which have no `version`;
  - a status transition on a run folder whose files are v1 on disk rewrites them in the new shape, keeping every other field;
  - `decodeRegistry` on a v1 registry succeeds.

Update `tests/unit/schemas.test.ts` and `tests/integration/registry.test.ts`: the `registry.version` assertion becomes a `$schema` assertion. In the package tests, inline v1 and `0.17.0` documents of each format parse with the right shape, and `toLatest` of v1 marks `$schema` unknown. The snapshot, corpus and frozen-history tests stay green.

### Implementation order

1. schemaUrl and SchemaUrlSchema, then legacyLift.ts and their tests.
2. Change the two schema modules and add the lift to their decoders.
3. Stamp every writer.
4. Flip the package tables, add the release shapes, and update the types and toLatest.
5. Run the snapshot check, record its findings, then --write.
6. Fix the test fixtures until test:type and test pass.

### Excluded scope

- phax-plan, the compliance review, the approvals ledgers, the records and the documents (phase-09 to phase-11).
- Any shape change other than adding `$schema` and dropping `version`.
- Any CLI output change.
- Rewriting existing documents on disk. They take the new shape when phax next writes them.
- `phax.json` and the user overlay, which are config, not exported formats.

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

Record:
- the `schemaUrl.ts` additions and the `legacyLift.ts` API;
- the list of writer sites stamped;
- the snapshot-gate findings printed before `--write`, verbatim;
- the recipe as applied, which phase-09 to phase-11 repeat: schema, lift, writers, table flip, release shape, types and toLatest, snapshot, fixtures;
- the fixture URL convention;
- which optional test files changed;
- any deviation, with the reason.

### Commit subject

`feat(schemas): write $schema first in the registry and run and phase status, drop version`

### Commit body

The run registry, run-status.json and the phase status.json now start with $schema, https://docs.phax.run/schemas/<format id>/<release>.json, and carry no version. Every writer, read-modify-write paths included, stamps the release doing the write. phax's decoders lift exactly the last legacy literal, so a v1 registry or an in-flight v1 run still reads after the upgrade and is written in the new shape at its next write.

In the package, v1 now decodes through its frozen module and the new shape is shape 0.17.0. toLatest marks $schema as unknown for a v1 document. The snapshot gate required the three 0.17.0 snapshots, and they are recorded.

---

## phase-09 — $schema for phax-plan and the compliance review {#phase-09-schema-url-plan-review}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

phax-plan.json and compliance-review.json start with their `$schema` URL and carry no `version`. The agent-facing contracts (the extracted plan and the compliance verdict in the review prompt) stay exactly as they are. Older run directories still read, in phax and in the package.

### Detailed instructions

- In `src/schemas/phaxPlan.ts`, the persisted `PhaxPlanSchema` gets `$schema: SchemaUrlSchema("phax-plan")` as its first field and loses `version`. Its decoder lifts v1 through `liftLegacy`. `ExtractedPhaxPlanSchema` stays at version 1 without `$schema`: it is the internal contract of the extraction, the extraction cache and the plan-document projection. The extraction cache does not change.
- In `src/domain/plan/finalize.ts`, stop copying `extracted.version`: build the persisted plan as `{ $schema: schemaUrl("phax-plan", PHAX_RELEASE_VERSION), ...the other extracted fields }`. Check that the spread in `src/cli/commands/run.ts` and the write in `src/app/runFolder.ts` keep `$schema` first.
- In `src/schemas/complianceReview.ts`, split the current shape:
  - `AgentComplianceReviewSchema` and its decoder: the version-1 verdict the agent writes, still described by `src/domain/review/compliancePrompt.ts`, which does not change;
  - `ComplianceReviewSchema`, the persisted document: `$schema: SchemaUrlSchema("compliance-review")` first, then the agent fields without `version`. Its decoder lifts v1.
- In `src/app/reviewCompliance.ts`, decode the agent's file with the agent decoder. Where phax currently copies the raw text into the run directory, write the persisted document instead: `$schema` first, then the agent fields, encoded with `ComplianceReviewSchema`. The missing-verdict path keeps its behavior. Readers such as `src/app/reviewCode.ts` use `decodeComplianceReview`, which includes the lift.
- In the package, apply the phase-08 recipe to phax-plan and compliance-review: flip v1 to its frozen module, add `["0.17.0", phax]`, export `PhaxPlan_0_17_0` and `ComplianceReview_0_17_0`, and widen `Any*`, `Latest*`, the shape ids and `toLatest*`.
- Run the snapshot check and record its findings, then run `--write` for `phax-plan/0.17.0` and `compliance-review/0.17.0`.
- Update the fixtures by the phase-08 rule. The prompt-generation snapshot embeds the plan JSON, so update it only through a fixture that uses the fixed `0.17.0` URL.

### Planned files to create

- `packages/schemas/snapshots/phax-plan/0.17.0.schema.json`
- `packages/schemas/snapshots/compliance-review/0.17.0.schema.json`
- `tests/integration/schemaUrlPlanReview.test.ts`

### Planned files to edit

- `src/schemas/phaxPlan.ts`
- `src/schemas/complianceReview.ts`
- `src/domain/plan/finalize.ts`
- `src/app/reviewCompliance.ts`
- `packages/schemas/src/index.ts`
- `tests/unit/schemas.test.ts`
- `tests/unit/schemas/complianceReview.test.ts`
- `tests/unit/extractPlanFinalize.test.ts`
- `tests/integration/reviewCompliance.test.ts`

### Optional files that may be edited

- `src/app/reviewCode.ts`
- `src/app/runFolder.ts`
- `src/cli/commands/run.ts`
- `packages/schemas/build/formats.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/formatHistory.test.ts`
- `tests/unit/schemasPackage/parseDocument.test.ts`
- `tests/unit/schemasPackage/exports.test.ts`
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

There are two agent/phax boundaries:
- The extraction model and the headless plan projection produce `ExtractedPhaxPlan` v1, which phax finalizes into the persisted phax-plan in the `$schema` shape.
- The compliance agent produces the v1 verdict the prompt describes, and phax persists compliance-review in the `$schema` shape.

Contract: the agent-facing shapes and the prompt text are unchanged; only phax knows `$schema`.

### Test strategy

Write `tests/integration/schemaUrlPlanReview.test.ts` first. It asserts that:

- a run's finalize-and-write path produces a phax-plan.json whose first key is `$schema`, equal to `schemaUrl("phax-plan", PHAX_RELEASE_VERSION)`, with no `version`;
- a compliance review whose agent file is a valid v1 verdict yields a persisted compliance-review.json in the new shape, with the agent's fields unchanged;
- phax decodes a v1 phax-plan and a v1 compliance review through the lift.

Update `tests/unit/schemas/complianceReview.test.ts` (its version assertion), `tests/unit/extractPlanFinalize.test.ts` and `tests/unit/schemas.test.ts`. In the package tests, v1 and `0.17.0` of both formats parse with the right shape, and the snapshot, corpus and frozen-history tests stay green.

### Implementation order

1. Change phaxPlan and add its lift; update finalize.ts.
2. Split the compliance schema; update reviewCompliance.ts.
3. Flip the package tables, add the release shapes, and update the types and toLatest.
4. Run the snapshot check, record its findings, then --write.
5. Update the fixtures.

### Excluded scope

- Changing the compliance prompt text, the extraction schema or the extraction cache.
- Approvals, records and documents (phase-10 and phase-11).
- Any shape change other than adding `$schema` and dropping `version`.

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

Record:
- the names of the agent-facing and persisted compliance schemas;
- the finalize change, and the `reviewCompliance` write path now used;
- the snapshot-gate findings printed before `--write`;
- which optional test files changed, including whether the prompt snapshot changed;
- any deviation, with the reason.

### Commit subject

`feat(schemas): write $schema first in phax-plan.json and compliance-review.json`

### Commit body

phax-plan.json and compliance-review.json now start with their $schema URL and carry no version. The shapes an agent produces are unchanged at version 1: the extracted plan, and the compliance verdict the review prompt describes. phax adds $schema when it writes the persisted file, and the compliance review is now re-encoded instead of copied verbatim.

phax's decoders lift v1. The package decodes v1 through the frozen modules, reads shape 0.17.0 with phax's decoders and marks $schema unknown when upgrading v1. The snapshot gate recorded the two 0.17.0 snapshots.

---

## phase-10 — $schema for the approvals ledgers and the phase record {#phase-10-schema-url-ledgers-records}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

Both approvals ledgers and the phase record manifest start with their `$schema` URL and carry no `version`. Existing ledgers keep every record across the upgrade, and existing records still read in phax. The package reads all three phase-record shapes and identifies a renamed copy by `$schema` alone, as in the spec's §6 reading-history example.

### Detailed instructions

- Change `src/schemas/approvalRecord.ts` and `src/schemas/specApprovalRecord.ts`: each ledger's first field is `$schema: SchemaUrlSchema("plan-approvals")` or `SchemaUrlSchema("spec-approvals")`, with no `version`. Each file decoder lifts v1.
- In `src/app/approvalRecordStore.ts`, write `{ $schema: schemaUrl(<id>, PHAX_RELEASE_VERSION), records }`, including the empty stores. A v1 ledger on disk now decodes through the lift, so its records survive, and the next `put` or `remove` rewrites it in the new shape (the live-ledger migration the spec names). Do not change the store's behavior on genuinely undecodable files.
- Change `src/schemas/runRecord.ts`: `$schema: SchemaUrlSchema("phase-record")` is the first field and `version` goes. `decodeRunRecordManifest` lifts v2; v1 records stay rejected by phax, as they are today. In `src/schemas/authoringRecord.ts`, the union's `decodeRecordManifest` lifts a phase record v2: apply `liftLegacy(u, "phase-record", 2)` only when `kind` is not `"authoring"`. In `src/domain/records/assemble.ts`, stamp `$schema` first and drop `version`.
- In the package:
  - plan-approvals and spec-approvals get the phase-08 recipe;
  - phase-record becomes `legacy: { 1: frozen v1, 2: frozen v2 }` (flip the v2 twin in) and `releases: [["0.17.0", phax]]`;
  - export `PhaseRecord_0_17_0`; `AnyPhaseRecord` becomes `PhaseRecordV1 | PhaseRecordV2 | PhaseRecord_0_17_0`, and `PhaseRecordShape` becomes `"v1" | "v2" | "0.17.0"`;
  - `LatestPhaseRecord` has `verifiedSurfaces` and `$schema` each typed as value or `Unknown`;
  - `toLatestPhaseRecord` from v1 marks both unknown, and from v2 marks `$schema` unknown;
  - `parseRecordManifest` and `toLatestRecordManifest` follow.
- Run the snapshot check and record its findings, then run `--write` for `plan-approvals/0.17.0`, `spec-approvals/0.17.0` and `phase-record/0.17.0`.
- Extend the package tests with the spec §6 examples:
  - `parseDocument` on a phase record assembled by phax returns `{ format: "phase-record", shape: "0.17.0" }`;
  - the renamed-file acceptance criterion: the same record, as if copied to `exports/a.json`, and a plan ledger written by the store, as if copied to `exports/b.json`, are handed to `parseDocument` as values only. They return `phase-record` and `plan-approvals`.
- Update the fixtures by the phase-08 rule. The v1-rejection test in `tests/unit/runRecord.test.ts` still holds; add a lift case for v2.
- Coordination: in the same release, oracle-phases adds an `oracle` surface to the phase record, and artifact-decide adds `approvedBy` to both ledgers. Their plans amend the unreleased `0.17.0` shape through the snapshot gate. Implement neither here.

### Planned files to create

- `packages/schemas/snapshots/plan-approvals/0.17.0.schema.json`
- `packages/schemas/snapshots/spec-approvals/0.17.0.schema.json`
- `packages/schemas/snapshots/phase-record/0.17.0.schema.json`
- `tests/integration/schemaUrlLedgersRecords.test.ts`

### Planned files to edit

- `src/schemas/approvalRecord.ts`
- `src/schemas/specApprovalRecord.ts`
- `src/schemas/runRecord.ts`
- `src/schemas/authoringRecord.ts`
- `src/app/approvalRecordStore.ts`
- `src/domain/records/assemble.ts`
- `packages/schemas/src/index.ts`
- `packages/schemas/src/experimental.ts`
- `tests/unit/runRecord.test.ts`
- `tests/unit/schemas/specApprovalRecord.test.ts`
- `tests/unit/schemasPackage/phaseRecordHistory.test.ts`
- `tests/unit/schemasPackage/parseDocument.test.ts`

### Optional files that may be edited

- `src/app/writeRecord.ts`
- `packages/schemas/build/formats.ts`
- `tests/unit/recordsAssemble.test.ts`
- `tests/unit/authoringRecord.test.ts`
- `tests/unit/artifact/lineage.test.ts`
- `tests/integration/completeRunArtifacts.test.ts`
- `tests/integration/runCarriesCompletion.test.ts`
- `tests/integration/recordsExplain.test.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/formatHistory.test.ts`
- `tests/unit/schemasPackage/exports.test.ts`
- `tests/unit/schemasPackage/jsonSchemas.test.ts`
- `tests/type/schemasPackage.ts`

### Boundary contracts

Producers: phax's approvals store and record assembler. Consumers: the package's frozen decoders, and phax's own readers (`records list` and `records explain`, artifact lineage), whose behavior on existing documents the one-step lift preserves. Contract:
- phax writes only the `$schema` shapes;
- a v1 ledger or a v2 record is read through the lift;
- only the package reads record v1.

### Test strategy

Write `tests/integration/schemaUrlLedgersRecords.test.ts` first. It asserts that:

- approving a plan against a v1 `docs/plans/approvals.json` (fake fs) yields a ledger whose first key is `$schema`, with no `version` and every earlier record preserved; the same holds for the spec ledger;
- assembling and writing a phase record yields `$schema` first and no `version`;
- phax decodes a v2 record through the lift.

Update the listed unit tests. In the package tests:
- the corpus v1 and v2 records parse with their shapes;
- the §6 examples hold, including a record whose `$schema` names `0.19.0` failing with the spec's message;
- the snapshot, corpus and frozen-history tests stay green.

### Implementation order

1. Change the approvals schemas; update the store.
2. Change the run record; update assemble.ts and the union lift.
3. Flip the package tables, add the release shapes, and update the types and toLatest.
4. Run the snapshot check, record its findings, then --write.
5. Update the fixtures and tests, including the parseDocument §6 cases.

### Excluded scope

- oracle-phases' `oracle` surface and artifact-decide's `approvedBy`.
- Changing how the approvals store treats genuinely corrupt files.
- Making phax read v1 records.
- The documents and the authoring record (phase-11).

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

Record:
- the lift sites;
- the approvals store's behavior on a v1 ledger;
- the package's phase-record `Any` and `Latest` types;
- the snapshot-gate findings printed before `--write`;
- which optional files changed;
- any deviation, with the reason.

### Commit subject

`feat(schemas): write $schema first in approvals ledgers and phase records`

### Commit body

docs/plans/approvals.json, docs/specs/approvals.json and the phase record manifest now start with their $schema URL and carry no version. The approvals store lifts a v1 ledger on read, so an existing ledger keeps every record and is rewritten in the new shape at its next approval instead of being dropped. phax's record decoders lift v2, so records explain still reads existing records.

The package decodes approvals v1 and phase record v1 and v2 through frozen modules, and shape 0.17.0 through phax's decoders. toLatestPhaseRecord marks verifiedSurfaces and $schema unknown where a shape lacks them. parseDocument identifies a copied record or ledger by its $schema alone.

---

## phase-11 — $schema for spec and plan sidecars and the authoring record {#phase-11-schema-url-authoring}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

Every experimental format phax writes (the spec and plan sidecars and the authoring record) starts with its `$schema` URL and carries no `version`. With that, every exported format is identified by `$schema`. The headless authoring contract handed to the agent and printed by `phax artifact schema` is unchanged. Artifacts and records written before the upgrade still read.

### Detailed instructions

- In `src/schemas/specDocument.ts` and `planDocument.ts`:
  - keep `SpecDocumentSchema` and `PlanDocumentSchema` exactly as they are. They are the authored contract: handed to the agent, printed by `phax artifact schema spec|plan`, rendered by the renderers and projected into the plan cache.
  - add `SpecDocumentSidecarSchema` and `PlanDocumentSidecarSchema`: `$schema: SchemaUrlSchema("spec-document")` or `SchemaUrlSchema("plan-document")` first, then the authored fields without `version`. Each gets a decoder that lifts v1.
- In `src/app/authorArtifact.ts`, encode the sidecar file with the sidecar schema, stamped with `$schema: schemaUrl(<id>, PHAX_RELEASE_VERSION)` first. Keep the `sourceSpec` override for plans. The session's own `document.json` and the plan-cache seed keep using the authored document.
- In `src/domain/artifact/sidecar.ts`, decode committed sidecars with the sidecar decoders (lift included), so approving a pre-upgrade headless artifact still works. Check the callers in `src/app/artifactStatus.ts`.
- Change `src/schemas/authoringRecord.ts`: `$schema: SchemaUrlSchema("authoring-record")` is the first field and `version` goes. `decodeAuthoringRecordManifest` and the union lift v1 (for the union, only when `kind` is `"authoring"`). `isAuthoringRecordManifest` still discriminates on `kind`. Stamp the record in `src/app/writeAuthoringRecord.ts`. The test in `tests/unit/authoringRecord.test.ts` that rejects `version: 2` now asserts that an unknown literal is rejected.
- In the package's experimental entry:
  - `SpecDocumentSchema`/`SpecDocument` and `PlanDocumentSchema`/`PlanDocument` now name the persisted sidecar format (phax's sidecar schemas);
  - apply the phase-08 recipe to spec-document, plan-document and authoring-record: flip v1 to its frozen module, whose authoring twin accepts both legacy shapes, and add `["0.17.0", phax]`;
  - `parseRecordManifest`, `parseExperimentalDocument` and the `toLatest*` functions follow.

  The type-parity test now maps to the sidecar types.
- Run the snapshot check and record its findings, then run `--write` for the three `0.17.0` snapshots.
- Create `tests/unit/schemasPackage/schemaFirst.test.ts`. For every registry format except the union, it asserts that the latest shape's schema is a struct whose first property is `$schema` and which has no `version` property (the §5.15 structural guard). It also asserts that `JSONSchema.make(SpecDocumentSchema)` and `JSONSchema.make(PlanDocumentSchema)` still deep-equal `packages/schemas/snapshots/spec-document/v1.schema.json` and `plan-document/v1.schema.json`, which proves the printed authoring contract is unchanged.
- Update the fixtures by the phase-08 rule. The exact `toEqual` in `tests/integration/writeAuthoringRecord.test.ts` gains the leading `$schema` and loses `version`.

### Planned files to create

- `packages/schemas/snapshots/spec-document/0.17.0.schema.json`
- `packages/schemas/snapshots/plan-document/0.17.0.schema.json`
- `packages/schemas/snapshots/authoring-record/0.17.0.schema.json`
- `tests/integration/schemaUrlAuthoring.test.ts`
- `tests/unit/schemasPackage/schemaFirst.test.ts`

### Planned files to edit

- `src/schemas/specDocument.ts`
- `src/schemas/planDocument.ts`
- `src/schemas/authoringRecord.ts`
- `src/app/authorArtifact.ts`
- `src/app/writeAuthoringRecord.ts`
- `src/domain/artifact/sidecar.ts`
- `packages/schemas/src/experimental.ts`
- `tests/unit/authoringRecord.test.ts`
- `tests/integration/writeAuthoringRecord.test.ts`
- `tests/unit/artifact/sidecar.test.ts`

### Optional files that may be edited

- `src/app/artifactStatus.ts`
- `packages/schemas/src/index.ts`
- `packages/schemas/build/formats.ts`
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
- `tests/unit/schemasPackage/parseDocument.test.ts`
- `tests/unit/schemasPackage/jsonSchemas.test.ts`
- `tests/unit/schemasPackage/exports.test.ts`
- `tests/type/schemasPackage.ts`

### Boundary contracts

The authoring agent produces the authored document (v1, the schema in its prompt), and phax persists the sidecar in the `$schema` shape. Contract: the authored schema, the prompt and the `phax artifact schema spec|plan` output are byte-identical to before this phase. phax's approval gate reads committed sidecars through the sidecar decoder, lift included.

### Test strategy

Write `tests/integration/schemaUrlAuthoring.test.ts` first. With a fake provider, a headless spec session and a headless plan session each write:

- a sidecar whose first key is `$schema`, equal to `schemaUrl(id, PHAX_RELEASE_VERSION)`, with no `version`;
- an authoring record in the same shape.

`schemaFirst.test.ts` is written alongside it. In `tests/unit/artifact/sidecar.test.ts`, a v1 sidecar still reads through the lift. In the package tests:
- both legacy authoring v1 shapes from the corpus parse through the frozen decoder;
- v1 and `0.17.0` sidecars parse;
- `parseExperimentalDocument` identifies a new sidecar and a new authoring record;
- the corpus, snapshot and frozen-history tests stay green.

### Implementation order

1. Add the sidecar schemas with their lift; update authorArtifact.ts and sidecar.ts.
2. Change the authoring record; update writeAuthoringRecord.ts and the union.
3. Flip the package tables, add the release shapes, and update the types and toLatest.
4. Run the snapshot check, record its findings, then --write.
5. schemaFirst.test.ts, then the fixtures and tests.

### Excluded scope

- Any change to the headless authoring prompt, the `phax artifact schema` output, the phax-planning or phax-spec skills, or the renderers.
- headless-review's code-review document and review-plan document.
- artifact-decide's `history` field in the documents.

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

Record:
- the authored and sidecar schema names;
- every site that now uses the sidecar decoder;
- the proof that the printed authoring schema is unchanged;
- the snapshot-gate findings printed before `--write`;
- the legacy authoring shapes the frozen v1 decoder accepts;
- which optional files changed;
- any deviation, with the reason.

### Commit subject

`feat(schemas): write $schema first in spec and plan sidecars and authoring records`

### Commit body

Spec and plan JSON sidecars and authoring record manifests now start with their $schema URL and carry no version. The document an authoring agent returns, which phax artifact schema spec|plan prints, is unchanged at version 1: phax adds $schema only when it writes the sidecar. phax lifts v1 sidecars and authoring records, so artifacts authored before the upgrade still pass the approval gate.

The package's experimental entry now reads sidecars. It decodes each v1 shape through its frozen module, including both legacy authoring-record shapes, and reads shape 0.17.0 through phax's decoders. A structural test pins $schema as the first field of every format's latest shape, with no version.

---

## phase-12 — Release: lockstep publish, tarball smoke and release.sh {#phase-12-release-lockstep}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

A release tag stage-publishes `@lbdremy/phax` and `@lbdremy/phax-schemas` at the tag's version, or neither. Every check that can fail, including an install-and-parse smoke of the packed tarball, runs before the first stage publish. `release.sh` bumps every version in one release commit.

### Detailed instructions

- Create `scripts/smoke-schemas-package.sh` (bash, `set -euo pipefail`). It expects `pnpm build` to have run and works in a temp directory:
  - `npm pack` in `packages/schemas`.
  - List the tarball, and fail if it contains any file compiled from `src/app`, `src/ports`, `src/infra` or `src/cli`. Scan every `.js` file in it, and fail if one imports `node:*`, `fs`, `child_process` or `net`, or references `Deno`.
  - Create an empty Node project (`npm init -y` with `"type": "module"`) and `npm install` the tarball. Fail if the top-level `node_modules` holds anything besides `@lbdremy/phax-schemas`, `effect` and effect's own dependency closure, read from their package.json files.
  - Create a temp git repo whose `phax/records/v1` branch holds one v2 phase record from `packages/schemas/corpus/phase-record/v2/`, at `<runId>/<phaseId>/record.json`.
  - Write the spec §6 `read-record.mjs` consumer (with `git show`), run it with the record's key, and assert that it prints the runId, phaseId and outcome and exits 0.
- In `scripts/prepare-npm.ts`, also set the version of `packages/schemas/package.json` from the tag and verify it after writing, as the script already does for `npm/package.json`.
- Reorder `.github/workflows/release.yml` to:
  1. the gate: unchanged. It includes `pnpm build`, which now builds the schemas package and its JSON Schemas, and `pnpm test`, which parses the history corpus and runs the snapshot gate.
  2. build the release binaries;
  3. `bash scripts/smoke-schemas-package.sh`;
  4. prepare both npm manifests;
  5. verify that the tag matches `npm/package.json`, `packages/schemas/package.json` and `PHAX_RELEASE_VERSION` in `src/domain/release.ts`;
  6. `npm stage publish --access public --provenance` in `npm`;
  7. the same in `packages/schemas`;
  8. the GitHub release.

  No step that can fail comes after the first stage publish, except the second publish itself.
- In `.github/workflows/ci.yml`, add a step after Build that runs `bash scripts/smoke-schemas-package.sh`.
- In `scripts/release.sh`, after the existing checks and before any change:
  - read `PHAX_RELEASE_VERSION` from `src/domain/release.ts` with sed;
  - if it is above the requested version, abort: shapes are recorded for that release, so release it;
  - if it is below the requested version and any `packages/schemas/snapshots/*/<constant>.schema.json` exists, abort: those shapes would be misnamed.

  Then:
  - bump `packages/schemas/package.json` (`npm pkg set` in that directory);
  - rewrite `PHAX_RELEASE_VERSION` to the requested version;
  - add both files to the release commit's `git add`;
  - end with `approve the staged npm packages at:` followed by the two npmjs.com URLs (`@lbdremy/phax` and `@lbdremy/phax-schemas`), as in spec §6.
- Update `docs/release.md`: the two packages, the smoke step, the lockstep versions, the `PHAX_RELEASE_VERSION` rule (it names the next release; bump it at the first shape change after a release, as the snapshot gate says), and approving two staged packages by hand.

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

The workflow consumes the gate, the build output and the smoke script, and publishes to npm. Contract (§5.26): the two stage publishes are the workflow's last fallible steps, and before either runs, the manifests and the release constant agree with the tag. `release.sh` produces the release commit, in which `package.json`, `npm/package.json`, `packages/schemas/package.json` and `src/domain/release.ts` all carry the new version.

### Test strategy

Extend `tests/unit/releaseWorkflow.test.ts` first. It asserts that:

- in release.yml, the smoke step and the version verification run before the first `npm stage publish`;
- there are exactly two stage-publish steps, in `npm` and in `packages/schemas`;
- prepare-npm handles both manifests;
- release.sh sets the version in the three manifests and in `src/domain/release.ts`, stages them in the release commit, contains both abort rules, and names both packages in its last lines;
- ci.yml runs the smoke.

The manifest test already pins the lockstep versions. The smoke script needs `npm` and the network, so it cannot run in the phase agent. Its first real run is CI on the pull request, and a human should confirm that run.

### Implementation order

1. The smoke script.
2. prepare-npm.ts.
3. The release.yml reordering and ci.yml.
4. release.sh.
5. The workflow tests, then docs/release.md.

### Excluded scope

- Running the smoke in the phax gate profile or in `pnpm check:full`.
- Changing how `@lbdremy/phax` itself is built or published, beyond the step order.
- Hosting JSON Schemas at `docs.phax.run`.

### Verification

The `standard` gate profile in `phax.json`. The first CI run verifies the tarball smoke out-of-band.

### Expected handoff content

Record:
- the final step order of release.yml;
- the smoke script's checks, and how it picks its corpus record;
- a summary of the release.sh diff, including both abort rules;
- a note that the smoke has not run inside the phase and must be confirmed on CI;
- any deviation, with the reason.

### Commit subject

`ci(release): stage-publish @lbdremy/phax-schemas in lockstep with @lbdremy/phax`

### Commit body

The release workflow now builds the schemas package and installs its packed tarball into an empty Node project, where it parses a phax-written record read from a git records branch. It checks the installed dependency set and scans the tarball for I/O. It then verifies that the tag, both manifests and PHAX_RELEASE_VERSION agree, and stage-publishes @lbdremy/phax and @lbdremy/phax-schemas. Every step that can fail runs before the first stage publish.

release.sh bumps the schemas manifest and PHAX_RELEASE_VERSION in the same release commit, refuses a release that would misname recorded shapes, and names both packages to approve. CI runs the same tarball smoke.

---

## phase-13 — README persisted-formats table and reading phax files from code {#phase-13-readme-formats}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

The README carries one persisted-formats table that classifies every exported format as stable or experimental, and a "Read phax files from code" section for tool authors. A test keeps that table, the package's entries and each JSON Schema's stability in agreement.

### Detailed instructions

- In `README.md`, replace `## Experimental formats` with `## Persisted formats` (anchor `#persisted-formats`). Add a table with the columns Format, Where it lives, Stability and Read it with, and one row per exported format, following spec §6's after-table:
  - stable, read with `@lbdremy/phax-schemas`: run registry, run status, phase status, phax-plan, compliance review, plan approvals, spec approvals and phase record;
  - experimental, read with `@lbdremy/phax-schemas/experimental`: spec document, plan document and authoring record.

  Add a short paragraph covering:
  - every document starts with `$schema: https://docs.phax.run/schemas/<format id>/<release>.json`, which names its format and the phax release that wrote it, and documents written before 0.17.0 carry a `version` literal instead;
  - stable means any shape change is recorded as a new shape at the release that makes it, and older shapes stay readable;
  - experimental formats are recorded the same way but may change between any two releases;
  - `phax artifact schema spec|plan` still prints the authoring contract.
- Add a `## Read phax files from code` section beside it, following spec §11:
  - `npm install @lbdremy/phax-schemas`;
  - the §6 `read-record.mjs` script: `git show phax/records/v1:<runId>/phase-01/record.json`, then `parsePhaseRecord(JSON.parse(raw))`, branch on `parsed.ok`, and read `parsed.value.outcome`;
  - `toLatestPhaseRecord` for mixed history, with `{ kind: "unknown" }` for absent facts;
  - `parseDocument` for a document whose file name says nothing;
  - a pointer to `node_modules/@lbdremy/phax-schemas/json/<format>.schema.json` for docs tooling;
  - a note that `/experimental` formats may change between releases, and that the package version always equals the phax version whose files it reads.
- Change the headless-authoring paragraph's link from `#experimental-formats` to `#persisted-formats`. Search the repo for any other `experimental-formats` link outside `docs/specs` and `docs/plans`, which are historical.
- Create `packages/schemas/README.md` for the npm page. It covers what the package is, the two entries, `Parsed`, `parseDocument`, reading history with `toLatest*`, the `json/` directory and lockstep versioning. Keep it short and link to the phax README.
- Create `tests/unit/schemasPackage/classification.test.ts`. It parses the Persisted formats table from `README.md` and asserts that:
  - every registry format except the derived `record-manifest` union has exactly one row, and every row maps to one registry format (match rows to registry labels);
  - each row's stability equals the registry stability;
  - stable formats' parse functions are exported from the root entry, and experimental ones from `/experimental`;
  - each rendered JSON Schema's `x-phax-stability` equals its row's stability.

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

Write `tests/unit/schemasPackage/classification.test.ts` first, against the planned table, then write the README until it passes. The test covers §5.6 and §5.22 together. The rest of the phase is documentation.

### Implementation order

1. The classification test.
2. The README table and the new section, and the link fix.
3. The package README.

### Excluded scope

- The 1.0 stability contract or migration policy.
- The code-review document row (added by the headless-review plan).
- Any change to docs/specs or docs/plans.

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

Record:
- the final README section titles and anchors;
- the table rows;
- how the test matches rows to registry entries;
- any other link you updated;
- any deviation, with the reason.

### Commit subject

`docs(readme): persisted-formats table and reading phax files with @lbdremy/phax-schemas`

### Commit body

Replace the README's Experimental formats section with one persisted-formats table. The table lists every format the schemas package exports, where it lives, its stability and the entry to read it with, and explains the $schema URL each document carries. Add a "Read phax files from code" section with the Node consumer example and the history-reading functions.

The headless-authoring link now points at the new anchor. A test keeps the table, the package entries and each JSON Schema's stability declaration in agreement.
