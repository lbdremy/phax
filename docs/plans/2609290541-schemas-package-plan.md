---
status: Draft
source-spec: docs/specs/2609241238-schemas-package.md
---
# schemas-package 1/5 — read the phase record manifest

This is plan 1 of 5 for the spec `schemas-package` (`docs/specs/2609241238-schemas-package.md`): read the phase record manifest. A record is a folder on `phax/records/v1`. Its `record.json` is the manifest, with the format id `phase-record-manifest`.

The plan creates `@lbdremy/phax-schemas` under `packages/schemas/`. The package is built from phax's own `src/schemas` modules, and it has a single entry and the `Parsed` API. The plan proves the reading-history pattern on one format, the phase record manifest, and then stops (steme working principle 6). Plan 2 repeats the pattern for every other format, including a record's timeline files.

Phases:

- phase-01 builds the package skeleton. The single entry exports the phase record manifest's schema, its type and `parsePhaseRecordManifest`. That function wraps phax's own decoder and returns a `Parsed` result. `SurfaceSchema` moves out of `phaxConfig.ts`, and an architectural guard pins the published closure.
- phase-02 reads the phase record manifest's history. It adds the shape table, the frozen v1 and v2 decoders, `toLatestPhaseRecordManifest` and the newer-release failure. It also adds a generated module that carries the root `package.json` version, and a lock that pins every frozen module by hash. Tests run against real v1 and v2 manifests, copied by hand from `~/.phax/records/phax` into test fixtures.
- phase-03 adds `parseDocument`. It identifies a document by its `$schema` alone and recognises the phase record manifest.

Requirements this plan covers. Each is covered in full unless marked otherwise:

- §5.2 and §5.11.
- §5.1, partly: the install smoke of the packed tarball comes in plan 5.
- §5.3 and §5.6, through the closure guard and a `types: []` compile. The tarball scan comes in plan 5.
- §5.4, partly: the entry carries the phase record manifest only. Plan 2 adds every other format.
- §5.7, §5.8, §5.12 and §5.20 for the phase record manifest. Plan 2 adds every other format.
- §5.9 for the phase record manifest, partly: no real format has a `$schema` shape until plan 4 writes one.
- §5.10: `parseDocument` recognises the phase record manifest. Identification by `$schema` is proven on a toy format with a `$schema` shape, because the real manifest gets one only in plan 4.
- §5.15, partly: frozen modules are pinned by hash and never imported by phax's `src/`. phax reading its own older files through the package comes in plan 4.

Acceptance criteria this plan covers:

- The package does no I/O: through the closure guard and the `types: []` compile. The tarball scan comes in plan 5.
- Nothing internal leaks: through the closure guard. The tarball file list comes in plan 5.
- Same verdict as phax on every document: the phase-record-manifest cases, including the record with one unknown key. The registry case comes in plan 2.
- A bad document is a value, not an exception: proven on a manifest whose `outcome` is `paused`. The run-status case comes in plan 2.
- Package types are phax's types: for the phase record manifest.
- A mixed history parses: against the hand-copied fixtures. The committed corpus comes in plan 3.
- A newer document is named.
- Upgrading marks the unknown.
- phax imports only the current decoder: through the guard and the lock.
- A renamed file is still identified: on a toy format with a `$schema` shape. The real manifest follows in plan 4.

Left to later plans:

- Plan 2: the rest of §5.4, §5.5, §5.13, §5.21 and §5.22. Also every other format in §5.7 to §5.12 and §5.20. Its acceptance criteria are "The entry exports every persisted format", "Every exported format has a usable JSON Schema", "A format without a JSON Schema fails the build", "Both legacy authoring shapes parse" and "A record's timeline files parse".
- Plan 3: §5.16, §5.18 and §5.19.
- Plan 4: §5.14 and the rest of §5.15.
- Plan 5: §5.17, §5.23 to §5.26, the Node consumer end to end, the tarball checks and the README table.
- §5.27, the code-review document, joins with the headless-review plan.

Execution caveats:

- phase-02 reads real history from the local clone of the records repository at `~/.phax/records/phax`, so the agent needs read access there. The fixtures it copies under `tests/unit/schemasPackage/fixtures/phase-record-manifest/` are expected unplanned creations: their names are content hashes, which no one can know in advance.
- The root version stays `0.16.0` throughout. The package manifest and the generated module both name `0.16.0`.
- Nothing is published. The package is first released in plan 5.

Coordination: artifact-decide, headless-review and oracle-phases (all Approved) change formats this package exports. Their plans come after the schemas-package plans, and each one records its change as a new shape through the snapshot gate (plan 3). This plan implements none of their changes. It changes no persisted shape, no phax decoder and no CLI behaviour.

## Required commands

- `pnpm exec tsx`
- `node`
- `git log`
- `git show-ref`
- `git cat-file`
- `git ls-tree`

`security.agentCommands` in `phax.json` already allows every command above, so no configuration change is needed.

- `pnpm exec tsx` runs `scripts/schemas-check.ts --write` (phase-02).
- `node` copies the fixture manifests from the records clone through `child_process.execFileSync("git", ["-C", <clone>, ...])` (phase-02).
- `git show-ref`, `git log`, `git cat-file` and `git ls-tree` inspect history. This includes `git log -p -- src/schemas/runRecord.ts`, which reconstructs the v1 shape.

## Technical arbitrations

- Scope of plan 1's entry: the phase record manifest only. The rejected option was to export every format's current shape in phase-01. That option abandons validating on one example first, and plan 2 would then have to change every parse signature from `Parsed` to the union over shapes. Loss accepted: after plan 1 the entry falls short of §5.4 and reads phase record manifests only. Until plan 2, the run-status case of §5.8 is proven on a manifest.
- Build: a second tsc project over the same sources. `packages/schemas/tsconfig.build.json` sets `rootDir` to the repo root, includes only the entry and sets `types: []`, so a `node:` import anywhere in the closure fails to compile. Loss accepted: the dist layout mirrors repo paths (`dist/packages/schemas/src/index.js`, `dist/src/schemas/*.js`). An esbuild bundle was rejected because its declarations would no longer be tsc's own output for phax's types.
- Package location: `packages/schemas/`, outside the pnpm workspace and driven by root scripts, with `effect` resolved from the root install. Loss accepted: pnpm never installs or checks the package's own dependency list. A unit test pins that list to exactly `effect` at the root range.
- Release version (q-release-name): the package reads the root `package.json` version from a generated module, `packages/schemas/src/generated/index.ts`, which exports `PACKAGE_VERSION`. Only `scripts/schemas-check.ts --write` writes it, and the check fails when it differs from `package.json`. Plan 3 extends the module with each format's current shape name, and plan 5's `release.sh` regenerates it in the release commit. The module is a derived mirror that no one edits by hand, not a second version source. Loss accepted: the version appears in one more committed file. Two options were rejected: a runtime read would thread an Effect service through every reader, and a JSON import prints an ExperimentalWarning on Node 20 for package consumers.
- Names (q-manifest-name): the package exports phax's `RunRecordManifestSchema` and `RunRecordManifest` under the spec's names, `PhaseRecordManifestSchema` and `PhaseRecordManifest`, with the format id `phase-record-manifest`. phax's internal symbols keep their names. Loss accepted: phax's source and the package spell the same schema differently. Renaming inside phax would touch every read site for no change in behaviour.
- Development trees: suppose a format's current shape is `next` and a document's `$schema` names exactly the package's own version. Then `next` decodes the document first. If that fails, the latest released shape at or below that version is tried. A published package never has a `next` shape, so the rule has no effect there. Loss accepted: in development only, two shapes are tried for one release. Without the rule, parity with what phax writes would break in every development cycle.
- Frozen twins: while phax still writes version 2, the package decodes v2 documents with phax's own decoder, as the no-copied-schema constraint requires. The frozen v2 module is created now and proven faithful by JSON Schema equality and by decoding the fixtures. It takes over when the manifest's current shape becomes `next` in plan 4. Loss accepted: the v2 twin sits unused until then.
- Parse results: success is a union over shapes. Each variant pairs a shape id with that shape's exact value type, and the union is assignable to the normative `Parsed<T>`. `parseDocument` also returns `format`. A shape id is `v<N>`, a release string, or `next` in a development tree. The current shape's type keeps the unsuffixed name (`PhaseRecordManifest`). Only a frozen shape gets a suffix (`PhaseRecordManifestV1`, `PhaseRecordManifestV2`). Loss accepted: `PhaseRecordManifest` changes meaning at the release that supersedes its shape. A failure's `path` is a dotted string. This follows the normative `Parsed` shape rather than the array in the §6 history example.
- The unknown marker is `{ kind: "unknown" }`. It is exported as the type `Unknown`, the frozen value `UNKNOWN` and the guard `isUnknown`. `LatestPhaseRecordManifest` carries no `version`. Loss accepted: an upgraded value does not say which shape it came from; the parse result's `shape` does.
- `SurfaceSchema` moves from `phaxConfig.ts` to `src/schemas/surface.ts`, so the published closure excludes phax.json's config schemas. Its importers are updated directly, with no re-export shim. Loss accepted: one more module.
- `FORMAT_IDS` lists the fifteen format ids of spec §4 without `code-review`. The headless-review plan adds `code-review` when it ships the document (§5.27). Loss accepted: until then a `code-review` URL reads as a format unknown to the package, which is true of every release before that plan.
- Frozen modules are pinned by sha256 in `packages/schemas/history.lock.json`. `--write` adds missing entries and never changes an existing one, so a changed frozen module fails the check. Loss accepted: fixing a frozen module before its first release means deleting its lock entry by hand, and that deletion shows in review.
- History fixtures for plan 1: a few real v1 and v2 manifests, copied by hand from `~/.phax/records/phax` into `tests/unit/schemasPackage/fixtures/phase-record-manifest/<shape>/`. They are named by content hash, under the naming contract that plan 3's corpus script will reproduce. Loss accepted: until plan 3, history is tested on a hand-picked sample, not on every document phax has written.
- Corpus source (left open in §10, decided now for plan 3): the corpus script will take a required `--records <path>` argument naming a git repository that holds `phax/records/v1`. For phax that is `~/.phax/records/phax`. The script walks every commit of that branch, not only its tip. Loss accepted: the script does not follow the records destination in `phax.json`, so the caller must name the clone.
- `parseDocument` and formats the package cannot read yet: a known format id with no definition in the package fails with the same upgrade-the-package message as an unknown id. Loss accepted: between plan 1 and plan 2, a registry or run-status `$schema` reads as unknown to the package. No package is published before plan 5, so no reader ever sees this.
- P3 (oracle first) is not applied. The oracle phase kind ships with the oracle-phases spec, which is planned after this one, so each phase writes its own tests first instead. Loss accepted: the implementing agent can edit its own tests.

---

## phase-01 — Package skeleton, one entry, Parsed API for the phase record manifest {#phase-01-package-skeleton}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

A standalone `@lbdremy/phax-schemas` package exists in the repo, built from phax's own `src/schemas` modules. Its single entry exports three things for the manifest shape phax writes today (version 2): the phase record manifest's schema, its type, and a parse function that returns `Parsed`. The parse function accepts and rejects exactly what phax's own decoder does.

### Detailed instructions

- Move `SurfaceSchema` and its `Surface` type from `src/schemas/phaxConfig.ts` to a new `src/schemas/surface.ts`:
      - Update `phaxConfig.ts`, `runRecord.ts`, `gateAttribution.ts` and any other importer tsc reports.
      - Add no re-export in `phaxConfig.ts` (no shim).
      - No schema changes shape.
- Create `packages/schemas/package.json` with:
      - `name`: `@lbdremy/phax-schemas`;
      - `version`: the root `package.json` version, `0.16.0`;
      - `type` `module`, `license` `Apache-2.0` and `engines.node` `>=20`;
      - `dependencies`: exactly `{ "effect": <the root range> }`;
      - `files`: `["dist"]`;
      - `exports`: only `.`, as `{ types, default }` pointing at the tsc output. The expected paths are `./dist/packages/schemas/src/index.d.ts` and `.js`; confirm them after building.

    Add no scripts and no devDependencies. Do not add the package to `pnpm-workspace.yaml`. The `./json/*` export and `json` in `files` come with plan 2.
- Create `packages/schemas/tsconfig.build.json`, extending `../../tsconfig.json`, with these settings:
      - `rootDir` `../..`, `outDir` `./dist`, and `include` exactly `["src/index.ts"]`;
      - `types` `[]` and lib ES2023, so a `node:` import anywhere in the closure fails to compile;
      - `declaration` true, and `declarationMap` and `sourceMap` false.
- Create `packages/schemas/src/parsed.ts`. It exports two things:
      - `Parsed<T>`, exactly as spec §6 gives it, with every field readonly: `{ ok: true; value: T } | { ok: false; error: { path: string; message: string } }`.
      - `fromEither`, which maps an `Either<T, ParseError>` to `Parsed<T>` using `ParseResult.ArrayFormatter`. `path` is the first issue's path joined with `.`, or `""` at the root. `message` is that issue's message.

    `fromEither` never throws.
- Create `packages/schemas/src/index.ts`, the only entry. It exports:
      - `PhaseRecordManifestSchema`, which is phax's `RunRecordManifestSchema`;
      - `type PhaseRecordManifest`, which is phax's `RunRecordManifest`;
      - `parsePhaseRecordManifest`, defined as `(input: unknown) => fromEither(decodeRunRecordManifest(input))` over phax's existing decoder in `src/schemas/runRecord.ts`;
      - `type Parsed`.

    The schema and its `onExcessProperty: "error"` setting are therefore phax's own. Never re-declare a schema or a decode option in the package. Export no other format: every other format comes in plan 2.
- Change the root `build` script to `tsc -p tsconfig.build.json && tsc -p packages/schemas/tsconfig.build.json`. Add `packages/schemas/**/*` to the `include` of `tsconfig.test.json`.
- Update `knip.json`:
      - add `packages/schemas/src/index.ts` to `entry`;
      - add `packages/schemas/**/*.ts` to `project`.

    To keep knip green in every later phase, add an export only in the phase that first uses it.
- Add `describe("architectural guard: schemas package closure")` to `tests/unit/architecturalGuards.test.ts`. The guard follows relative imports transitively from `packages/schemas/src/index.ts`, mapping `.js` specifiers to `.ts`. It asserts that:
      - every file it reaches is under `packages/schemas/src/`, `src/schemas/` or `src/domain/`, and none is under `src/app/`, `src/ports/`, `src/infra/` or `src/cli/`;
      - no reached file imports `node:*`, `fs`, `child_process`, `net`, `os`, `path` or `@effect/platform*`, and no reached file references `Deno`;
      - the only bare specifiers are `effect` and `effect/*`;
      - the guard never reaches `src/schemas/vibeOutput.ts` or `src/schemas/phaxConfig.ts`.

    Reuse the file's existing helpers for walking sources (`listTsFiles` and the import scanning the other guards use).
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

- `.oxlintrc.json`
- `.oxfmtrc.json`

### Boundary contracts

Producer: `src/schemas/runRecord.ts`. It owns the manifest's schema and `decodeRunRecordManifest`, with its `onExcessProperty: "error"` setting.

Consumer: the package entry. It re-exports that schema and type under the spec's names and wraps that decoder into `Parsed`.

Contract: the package never declares a schema or a decode option for a shape phax writes. Parity therefore holds by construction, and the parity test keeps it.

Outside consumer: a Node 20+ ESM program that imports `@lbdremy/phax-schemas` and relies on the §6 `Parsed` shape and the spelling `parsePhaseRecordManifest`.

### Test strategy

Write these tests first:

- `tests/unit/schemasPackage/parse.test.ts`:
    - a valid manifest returns `ok: true` with the value;
    - a manifest whose `outcome` is `paused` returns `ok: false`, with `error.path` `outcome` and a non-empty message;
    - a manifest with a wrong `usage.usage.provider` fails with the dotted path;
    - a non-object input fails at `""`;
    - no call throws.
- `tests/unit/schemasPackage/parity.test.ts`: inline accepted and rejected version-2 manifests, each run through phax's `decodeRunRecordManifest` and the package's `parsePhaseRecordManifest`. The two verdicts must agree on every case. The cases include:
    - the acceptance case: a manifest with one unknown key is rejected by both;
    - a manifest missing `verifiedSurfaces`;
    - a manifest without `sourceSha`.
- `tests/unit/schemasPackage/exports.test.ts`: the entry's runtime export names are exactly `PhaseRecordManifestSchema` and `parsePhaseRecordManifest`, and the package manifest's `exports` has only `.`.
- `tests/unit/schemasPackage/manifest.test.ts`: checks the package `package.json`: the name, the single `effect` dependency at the root range, a version equal to the root version, the `exports` keys, `files` and `engines`.
- `tests/type/schemasPackage.ts` (§5.20):
    - the package's `PhaseRecordManifest` is assignable to phax's `RunRecordManifest`, and the reverse;
    - the success value of `parsePhaseRecordManifest` is `PhaseRecordManifest`.

The closure guard runs in `pnpm audit:architecture`.

### Implementation order

1. Move SurfaceSchema and update its importers.
2. Write parsed.ts and its test.
3. Write the entry, then the parity, exports and type tests.
4. Add the package manifest and the build tsconfig, then update the root build script, tsconfig.test.json and knip.json.
5. Add the closure guard. Then run pnpm build and check that the emitted paths match the exports map.

### Excluded scope

- Every format other than the phase record manifest, including the authoring record manifest, the record-manifest union and a record's timeline files (plan 2).
- JSON Schema files and the `json/` export (plan 2).
- Historical shapes, toLatest and the newer-release failure (phase-02).
- parseDocument (phase-03).
- Snapshots and the history corpus (plan 3).
- Writing `$schema` (plan 4).
- The release workflow, the tarball smoke and the README (plan 5).

### Verification

The `standard` gate profile in `phax.json`. Its terminal `pnpm build` step confirms that the package compiles under `types: []`. Run `pnpm build` in the phase too, to confirm the emitted paths.

### Expected handoff content

Record:

- the emitted dist paths and the final `exports` map;
- the entry's export names, and the phax decoder that `parsePhaseRecordManifest` wraps;
- the closure guard's describe name and the files it reached;
- the `SurfaceSchema` move and every importer you updated;
- any deviation from the planned file lists, with the reason.

### Commit subject

`feat(schemas-package): add @lbdremy/phax-schemas with one entry and a Parsed API`

### Commit body

Add the schemas package under packages/schemas. A second tsc project builds it from the entry module alone, so tsc emits only that module's import closure. The entry exports the phase record manifest's schema, its type and parsePhaseRecordManifest. parsePhaseRecordManifest wraps phax's own decoder and returns a Parsed result instead of throwing, so its verdict is phax's, including the rejection of unknown keys.

Move SurfaceSchema to src/schemas/surface.ts, so the published closure no longer reaches phax.json's config schemas. Add an architectural guard that pins the closure: no file from app, ports, infra or cli, no Node or Deno I/O, no bare import other than effect, and neither vibeOutput.ts nor phaxConfig.ts.

---

## phase-02 — Phase record manifest history: shape table, frozen v1 and v2, toLatest, newer-release failure {#phase-02-manifest-history}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

For the phase record manifest alone, a consumer can now:

- parse every legacy shape phax has written (v1 and v2) and get the exact type with its shape id;
- upgrade any of them to the latest shape, with absent facts marked unknown;
- get an upgrade-the-package failure when a `$schema` names a newer release or an unknown format.

This proves the pattern on one format before plan 2 repeats it.

### Detailed instructions

- Create `src/schemas/schemaUrl.ts`. It is pure and imports nothing outside `effect`. It exports:
      - `SCHEMA_URL_BASE = "https://docs.phax.run/schemas"`.
      - `FORMAT_IDS`, a readonly tuple of the fifteen format ids of spec §4 without `code-review`: registry, run-status, phase-status, phax-plan, compliance-review, plan-approvals, spec-approvals, phase-record-manifest, authoring-record-manifest, gate-attribution, phase-file-reconciliation, gate-diagnostics, gate-pending, spec-document, plan-document. Also export `type FormatId`.
      - `schemaUrl(formatId, release)`, which builds `<base>/<id>/<release>.json`.
      - `parseSchemaUrl(value: unknown): { formatId: string; release: string } | undefined`. It accepts any lowercase-kebab id, so that an unknown id stays reportable.
      - `compareReleases(a, b)`, a numeric X.Y.Z comparison.
- Create `packages/schemas/build/generated.ts`. It is pure and exports two functions:
      - `renderGeneratedIndex({ packageVersion })` returns the source of `packages/schemas/src/generated/index.ts`: a do-not-edit header naming `pnpm exec tsx scripts/schemas-check.ts --write`, then `export const PACKAGE_VERSION = "<version>" as const;`.
      - `refreshLock(lock, files)` takes the lock (a map from path to sha256) and the current bytes of every file under `packages/schemas/src/history/`. It returns the lock with missing entries added, plus the list of paths whose existing entry differs. It never changes an existing entry.
- Create `scripts/schemas-check.ts`, in the style of `scripts/generate-model-catalog.ts`, with its logic exported behind a main guard. It has two modes:
      - Default: it checks that the committed generated index equals the render for the root `package.json` version, that every history module has a matching lock entry, and that every lock entry names an existing file. It prints each finding as `✗ …` and exits 1 on any finding.
      - `--write`: it rewrites the generated index and adds missing lock entries. When an existing lock entry mismatches, it changes nothing and exits 1.

    Lock paths are relative to `packages/schemas`. Run the script with `--write` to create `packages/schemas/src/generated/index.ts` and `packages/schemas/history.lock.json`, and never edit either file by hand. Plan 3 extends this script with snapshots.
- Extend `packages/schemas/src/parsed.ts`:
      - Add `ParsedShape<M>`, over a map from shape id to value type. It is a union with one `{ ok: true; shape: K; value: M[K] }` variant per key, plus the failure variant, and it must be assignable to `Parsed<M[keyof M]>`.
      - Export `ParseFailure` and `failure(path, message)`.
- Create `packages/schemas/src/shapes.ts`. A `Shape<T>` is `{ schema, decode }`. `defineFormat(spec, options)` takes:
      - `spec`: `{ id, label, legacy: Record<number, Shape>, releases: ReadonlyArray<[release, Shape]>, current: { name, shape } }`, where `current.name` is `v<N>`, `next` or a release;
      - `options`: `{ packageVersion = PACKAGE_VERSION }`.

    It returns the definition and its `parse`. `parse` never throws, and applies these rules in order:
      - A non-object fails at `""`.
      - A document with `$schema`:
        - a malformed URL fails at `$schema`, naming the expected form;
        - an id outside `FORMAT_IDS` fails with `<url> names a format unknown to @lbdremy/phax-schemas <packageVersion> — upgrade the package`;
        - another known id fails with `<url> is a <that id> document, not a <id>`;
        - a release above `packageVersion` fails with `<id> written by phax <release> is newer than @lbdremy/phax-schemas <packageVersion> — upgrade the package`;
        - when `current.name` is `next` and the release equals `packageVersion`, `current` decodes first, giving shape `next`; if that fails, the next rule applies;
        - otherwise the decoder is the latest release-named shape at or below the release. The candidates are the `releases` entries, plus `current` when its name is a release. When there is none, the document fails with `no <id> shape is known at release <release>`.
      - A document with a numeric `version` and no `$schema`:
        - when `current.name` is `v<N>`, `current` decodes it with phax's decoder;
        - otherwise `legacy[N]` decodes it;
        - an unknown literal fails at `version`, listing the known literals.
      - A document with neither marker fails at `$schema`, as missing.

    Success returns `{ ok: true, shape, value }`. Export the builders of the unknown-format and newer-release messages, so phase-03 reuses the same wording.
- Create the frozen decoders `packages/schemas/src/history/phase-record-manifest/v1.ts` and `v2.ts`. Once released, these files never change:
      - Each imports only `effect` and inlines every sub-schema and annotation of its shape: outcome, record shape, token usage, provider id, surface, and so on.
      - Both use `onExcessProperty: "error"`.
      - Reconstruct v1 from `git log -p -- src/schemas/runRecord.ts`. v1 predates `verifiedSurfaces`, which arrived in 0.10. Check the result against the real v1 manifests.
      - v2 is a faithful copy of today's `RunRecordManifestSchema`, with identical annotations.
      - Each exports `PhaseRecordManifestV<N>Schema`, `type PhaseRecordManifestV<N>` and `decodePhaseRecordManifestV<N>`.
- Copy the fixtures from the records clone with `node -e`, using `child_process.execFileSync("git", ["-C", <home>/.phax/records/phax, ...])` and no shell:
      - Resolve `phax/records/v1` with `show-ref`, falling back to `refs/remotes/origin/phax/records/v1`.
      - List every commit with `log --format=%H <ref>`, because each commit carries its own tree.
      - List the `*/record.json` paths with `ls-tree -r --name-only <commit>`, skipping `authoring/`, and read each one with `cat-file -p <commit>:<path>`.
      - Write every distinct v1 manifest (the spec counts 6) and at least three distinct v2 manifests into `tests/unit/schemasPackage/fixtures/phase-record-manifest/v1/` and `v2/`.

    Plan 3's corpus script will reproduce this naming contract: the content is `JSON.stringify(value, null, 2) + "\n"`, and the file name is the first 16 hex characters of the content's sha256, plus `.json`.
- Update `packages/schemas/src/index.ts`:
      - Define the phase record manifest with `defineFormat`, using `id: "phase-record-manifest"`, `legacy: { 1: frozen v1, 2: frozen v2 }`, `releases: []`, and `current: { name: "v2", shape: phax's RunRecordManifestSchema and decodeRunRecordManifest }`. Plan 3 moves the current name into the generated index.
      - `parsePhaseRecordManifest` now returns `ParsedShape<{ v1: PhaseRecordManifestV1; v2: PhaseRecordManifest }>`.
      - Export `type Unknown` (`{ readonly kind: "unknown" }`), a frozen `UNKNOWN` and `isUnknown`.
      - Export `type LatestPhaseRecordManifest`: the current fields without `version`, with `verifiedSurfaces` typed `ReadonlyArray<Surface> | Unknown`. Type every other field that v2 has and v1 lacks as `T | Unknown` as well.
      - Export the pure `toLatestPhaseRecordManifest(value: PhaseRecordManifestV1 | PhaseRecordManifest): LatestPhaseRecordManifest`, which discriminates on `version`. From v1 it keeps every field and sets each field v1 lacks to `UNKNOWN`. From v2 it keeps every field. It always drops `version` and never invents a value.
      - Also export the types `PhaseRecordManifestV1`, `PhaseRecordManifestV2` and `PhaseRecordManifestShape`.
- In `.oxfmtrc.json`, add `packages/schemas/src/history`, `packages/schemas/src/generated`, `packages/schemas/history.lock.json` and `tests/unit/schemasPackage/fixtures` to `ignorePatterns`, so that `pnpm format` never rewrites pinned or generated bytes.
- Add `packages/schemas/build/*.ts` to knip's `entry`, because its only production caller, `scripts/schemas-check.ts`, is outside knip's project. If knip flags the exports of `packages/schemas/src/history/**/*.ts`, add that pattern too.
- Add `describe("architectural guard: phax imports no historical decoder")` to `architecturalGuards.test.ts`. It asserts that no module under `src/` imports anything under `packages/schemas/src/history/` (§5.15).
- Stop at the phase record manifest. Every other format comes in plan 2.

### Planned files to create

- `src/schemas/schemaUrl.ts`
- `packages/schemas/src/shapes.ts`
- `packages/schemas/src/history/phase-record-manifest/v1.ts`
- `packages/schemas/src/history/phase-record-manifest/v2.ts`
- `packages/schemas/src/generated/index.ts`
- `packages/schemas/history.lock.json`
- `packages/schemas/build/generated.ts`
- `scripts/schemas-check.ts`
- `tests/unit/schemaUrl.test.ts`
- `tests/unit/schemasPackage/shapes.test.ts`
- `tests/unit/schemasPackage/phaseRecordManifestHistory.test.ts`
- `tests/unit/schemasPackage/frozenHistory.test.ts`

### Planned files to edit

- `packages/schemas/src/index.ts`
- `packages/schemas/src/parsed.ts`
- `tests/unit/schemasPackage/exports.test.ts`
- `tests/unit/architecturalGuards.test.ts`
- `.oxfmtrc.json`
- `knip.json`

### Optional files that may be edited

- `tests/unit/schemasPackage/parse.test.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/type/schemasPackage.ts`
- `tsconfig.test.json`
- `.oxlintrc.json`

### Boundary contracts

Producer: `packages/schemas/src/shapes.ts`. It provides the format definition, the resolution rules, the unknown marker and the failure messages.

Consumers:

- `parsePhaseRecordManifest`, now;
- `parseDocument`, in phase-03;
- every other format, in plan 2;
- the snapshot gate and the corpus script, in plan 3;
- phax's own reads, in plan 4.

Contract: a format is a table of shapes:

- a legacy literal maps to a frozen module that imports only `effect`;
- a release-named historical shape maps to a frozen module;
- the current shape is decoded by phax's own decoder, and its name is `v<N>`, `next` or a release.

A second producer, `packages/schemas/src/generated/index.ts`, is derived from the root `package.json`. Its consumers are the package's version checks now, and phax's `$schema` stamping in plan 4.

### Test strategy

Write these tests first:

- `tests/unit/schemaUrl.test.ts`:
    - `schemaUrl` and `parseSchemaUrl` round-trip;
    - an unknown id is accepted, and a malformed URL is rejected;
    - `compareReleases` orders numeric triples, so `0.10.0` is above `0.9.0`.
- `tests/unit/schemasPackage/shapes.test.ts`, on a toy format with legacy literals 1 and 2, historical release `0.10.0` and current `0.12.0`, at package version `0.13.0`:
    - release `0.11.0` resolves to shape `0.10.0`, and `0.12.0` to `0.12.0`;
    - `0.9.0` has no shape, and `99.0.0` fails with the newer message;
    - an unknown id fails with the upgrade message, and another known id is named;
    - a malformed URL, an unknown literal, a document with neither marker, and a non-object all fail;
    - with current named `next` at package version `0.13.0`, a `0.13.0` document of the next shape parses with shape `next`, and a `0.13.0` document of the `0.12.0` shape parses with shape `0.12.0`;
    - no call throws.
- `tests/unit/schemasPackage/phaseRecordManifestHistory.test.ts`:
    - every fixture parses `ok`, with `shape` equal to its directory, and narrowing on `shape` typechecks to the exact type;
    - a v2 fixture with `$schema` set to `https://docs.phax.run/schemas/phase-record-manifest/0.19.0.json` fails at `$schema` with `phase-record-manifest written by phax 0.19.0 is newer than @lbdremy/phax-schemas 0.16.0 — upgrade the package`, and does not throw;
    - `toLatestPhaseRecordManifest` of a v1 fixture has `verifiedSurfaces` deep-equal to `{ kind: "unknown" }`, keeps the value of every v1 field and has no `version`;
    - `toLatestPhaseRecordManifest` of a v2 fixture keeps every field except `version`.
- `tests/unit/schemasPackage/frozenHistory.test.ts`:
    - the committed generated index and lock pass the script's check;
    - the check fails, naming the `--write` command, on an injected stale index or a mismatched lock entry;
    - `JSONSchema.make` of the frozen v2 schema deep-equals that of phax's `RunRecordManifestSchema`;
    - every v2 fixture decodes to the same verdict and value with both schemas.

Update `parse.test.ts` and `parity.test.ts` to the new success shape. Parity still holds on every version-2 case. A version-1 document is now accepted by the package and rejected by phax. This is by design: §5.7 promises parity only for the shape phax currently writes.

### Implementation order

1. Write schemaUrl.ts and its test.
2. Write build/generated.ts and the check script, then run --write to create the generated index and the lock.
3. Extend parsed.ts, then write shapes.ts with the toy-format tests.
4. Write the frozen v1 module (from git history) and the v2 module, then add their lock entries with --write.
5. Copy the fixtures from the records clone.
6. Add the phase-record-manifest definition, toLatestPhaseRecordManifest and the types. Then update the exports, parse and parity tests, the guard, the oxfmt ignores and knip.

### Excluded scope

- Every other format, including the authoring record manifest's two legacy shapes and the record-manifest union (plan 2).
- parseDocument (phase-03).
- JSON Schema snapshots, CURRENT_SHAPES in the generated index, and the snapshot gate (plan 3).
- The corpus script and the committed corpus (plan 3). The fixtures already follow its naming contract.
- phax reading through the package, and writing `$schema` (plan 4).

### Verification

The `standard` gate profile in `phax.json`. The check of the generated index and the lock runs inside `pnpm test`, through `frozenHistory.test.ts`.

### Expected handoff content

Record:

- the `shapes.ts` API: the definition, the resolution rules (including the `next` rule) and the exported message builders;
- the `schemaUrl.ts` exports and the `FORMAT_IDS` list;
- the check script's modes, its exported function names and the contents of the generated index;
- the reconstructed v1 shape and exactly how it differs from v2;
- the fixture count per shape and the naming contract as implemented;
- the new entry exports.

The fixture files under `tests/unit/schemasPackage/fixtures/phase-record-manifest/` are expected unplanned creations. Record any other deviation, with the reason.

### Commit subject

`feat(schemas-package): read phase record manifest v1 and v2, upgrade to latest`

### Commit body

Validate the reading-history pattern on one format before repeating it. A shape table maps a document to its shape. A legacy document maps by its version literal. A document carrying $schema maps to the latest shape released at or before the release its URL names.

parsePhaseRecordManifest now reads v1 through a frozen, self-contained decoder and v2 through phax's own decoder, and returns the exact shape with its shape id. A $schema naming a release newer than the package, or an unknown format id, fails without throwing and says to upgrade the package. toLatestPhaseRecordManifest upgrades a v1 manifest in memory and marks verifiedSurfaces as { kind: "unknown" }; it never invents a value.

The package version comes from the root package.json through a generated module, which scripts/schemas-check.ts writes and checks. history.lock.json pins the bytes of every frozen module, and a guard keeps phax's src/ from importing any of them. The test fixtures are real v1 and v2 manifests copied from the records branch.

---

## phase-03 — parseDocument: identification by $schema alone, for the phase record manifest {#phase-03-parse-document}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

A consumer holding any JSON value can ask the package what it is. `parseDocument` reads the format id and the release from the `$schema` alone and returns the format, the shape and the value. For anything it cannot read, it returns a named failure. It recognises the phase record manifest, the one format this plan reads.

### Detailed instructions

- Add `ParsedDocument<M>` to `packages/schemas/src/parsed.ts`. It is a union with one `{ ok: true; format: F; shape: S; value: T }` variant per format and shape, plus the failure variant.
- Create `packages/schemas/src/document.ts` with `makeDocumentParser(definitions)`. It returns a parser that takes one value, never a path, and never throws. The parser's rules:
      - A non-object fails at `""`.
      - A document without `$schema` fails at `$schema`. The message says that a legacy document carries only a `version` literal and is identified by where it lives, so it must be read with its format's parse function (for example, `parsePhaseRecordManifest`).
      - A malformed URL fails at `$schema`.
      - An id outside `FORMAT_IDS`, or a known id with no definition in `definitions`, fails with the shared unknown-format upgrade message from `shapes.ts`.
      - Otherwise the parser delegates to that definition's `parse` and adds `format` to the success. That `parse` handles the newer-release, wrong-format and no-shape cases.
- In `packages/schemas/src/index.ts`, export `parseDocument`, built over the phase-record-manifest definition. Also export the types `DocumentFormatId` (the ids the package reads; for now only `phase-record-manifest`) and `AnyDocument`.
- No format has a `$schema` shape until plan 4. So for now, a phase-record-manifest `$schema` document at or below the package version fails with `no phase-record-manifest shape is known at release <release>`. The tests pin this behaviour, and plan 4 turns it into a success.
- Add `parseDocument` to `exports.test.ts`.

### Planned files to create

- `packages/schemas/src/document.ts`
- `tests/unit/schemasPackage/parseDocument.test.ts`

### Planned files to edit

- `packages/schemas/src/index.ts`
- `packages/schemas/src/parsed.ts`
- `tests/unit/schemasPackage/exports.test.ts`

### Optional files that may be edited

- `packages/schemas/src/shapes.ts`
- `tests/type/schemasPackage.ts`

### Boundary contracts

Producer: `parseDocument`.

Consumer: a reader holding documents whose names and locations say nothing, such as exported copies or several files of one format.

Contract: identification uses the `$schema` URL alone. The result names the format id, the shape id and the value. Otherwise the result is a failure the reader can act on: upgrade the package, or read a legacy document with its format's parse function.

Plan 2 passes every format definition to `makeDocumentParser` without changing its rules.

### Test strategy

Write `tests/unit/schemasPackage/parseDocument.test.ts` first.

On the real `parseDocument`:

- A document without `$schema` (a v2 fixture) fails, naming `parsePhaseRecordManifest`.
- An unknown format id fails, naming the URL and the package version and saying to upgrade the package.
- A manifest whose `$schema` names release `0.19.0` fails with the spec's newer message.
- A known id the package does not read yet (`registry`) fails with the upgrade message.
- A phase-record-manifest `$schema` at `0.16.0` fails with no shape, for now.
- A malformed URL and a non-object both fail.
- None of these calls throws.

On `makeDocumentParser`, over a toy format with a release-named `$schema` shape, check the renamed-file criterion on values:

- two documents with identical content are identified with the same format and shape;
- the parser's only parameter is the value, and a type-level assertion checks that it takes exactly one parameter.

### Implementation order

1. Add ParsedDocument to parsed.ts.
2. Write document.ts and its rules, with the toy-format tests.
3. Add the entry export and its types.
4. Write the tests on the real parser and update the exports set.

### Excluded scope

- Every other format in parseDocument (plan 2).
- `$schema` shapes for any real format (plan 4).
- Reading files or walking the records branch (a spec non-goal).

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

Record:

- the signature of `makeDocumentParser` and the new export names;
- every failure message, and which of them are shared with `shapes.ts`;
- how plan 2 extends `parseDocument` through the definitions list;
- any deviation from the planned file lists, with the reason.

### Commit subject

`feat(schemas-package): identify a document by its $schema alone with parseDocument`

### Commit body

Add parseDocument. It reads the format id and the release from a document's $schema URL, never from a file name or location, and returns the format id, the shape id and the parsed value. For now it recognises the phase record manifest; plan 2 adds every other format.

An unknown format id or a newer release fails, naming the URL and the package version and saying to upgrade the package. A legacy document without $schema fails and points to the format's own parse function. No call throws.

The parser takes a value only. A toy format with a $schema shape proves that a document is identified whatever its file is named; the real manifest follows once phax writes $schema.
