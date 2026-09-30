---
status: Abandoned
source-spec: docs/specs/2609241238-schemas-package.md
approved:
  date: 2026-09-29
  baseline: 85a7878
---
# schemas-package 3/5 — guards

Third of the five plans that ship the schemas-package spec. Plan 1 (read the phase record manifest) and plan 2 (read every format) landed in PR #104 and PR #105. Every format in spec §5.4 is now defined under packages/schemas/src/formats/, with frozen modules under packages/schemas/src/history/<format id>/v<N>.ts pinned in packages/schemas/history.lock.json, toLatest per format, parseDocument, and one JSON Schema per format built by packages/schemas/build/jsonSchemas.ts. This plan adds the guards that keep that history honest. It commits a JSON Schema snapshot for every format and shape, with a gate that fails when phax's decoder changes shape without a recorded `next` snapshot. It adds a committed script that pulls every document phax has ever written out of git history and the phax home into a history corpus, scrubbed for a public repository. And it commits that corpus and parses every document in it on every gate.

Covered here. Requirements: §5.16 `snapshot-gate` (a shape change is recorded as the next shape), §5.18 `corpus` (the history corpus is parsed at every release) and §5.19 `corpus-script` (the corpus is extracted by a committed script). Acceptance criteria: "A shape change must be recorded at its release" (built and tested on synthetic cases; its first real use is plan 4) and "The corpus is extracted and parsed". The corpus also checks "A mixed history parses" and "Both legacy authoring shapes parse" (§5.9, §5.13) against real history rather than fixtures.

Out of scope, left to later plans: §5.14 `$schema` written by phax and §5.15 phax reading its own older files through the package (plan 4, which also records the first real `next` snapshots); §5.17 release.sh renaming `next` snapshots, §5.23–§5.26 lockstep publication, the tarball smoke and the README table (plan 5); §5.27 the code-review document (the headless-review release). artifact-decide, headless-review and oracle-phases record their format changes as new shapes through this plan's gate, in their own plans.

The gate the plan builds:
- **Snapshots.** One committed snapshot per shape at packages/schemas/snapshots/<format id>/<shape>.schema.json, rendered by the same renderer as packages/schemas/json/. The latest released snapshot must equal the schema generated from phax's current decoder, unless snapshots/<format id>/next.schema.json equals it. Released snapshots are pinned in history.lock.json beside the frozen modules.
- **Corpus.** The corpus lives at packages/schemas/corpus/<format id>/<shape>/<content hash>.json, one file per distinct scrubbed document. The shape is the id the package's own parse returns.

## Required commands

- `pnpm exec tsx`

`pnpm exec tsx` is already in `security.agentCommands` in phax.json, so no security configuration change is needed. Phase 01 runs `pnpm exec tsx scripts/schemas-check.ts --write` to write the snapshots. Phase 04 runs `pnpm exec tsx scripts/extract-history-corpus.ts --records ~/.phax/records/phax --repo . --phax-home ~/.phax` to build the corpus. The script calls git itself as a child process, the same way scripts/survey-format-shapes.ts does.

## Technical arbitrations

- Where the guards run: as unit tests inside `pnpm test`, not as a new `every-phase` step in phax.json. tests/unit/schemasPackage/frozenHistory.test.ts already asserts that checkSchemas finds nothing on the committed tree, so extending checkSchemas puts snapshots under the same test. The corpus gets its own test file. `pnpm test` already runs in every phax gate, in CI, in the release workflow's Gate step and (as test:unit) in check:full. Loss accepted: a guard failure shows up as a failed test inside the `pnpm test` step, not as a named gate step of its own.
- How the corpus script finds the records history (spec §10, left open): path arguments. `--records <repo>` is repeatable and names a local clone of the records repository; `--repo <repo>` and `--phax-home <dir>` name the other sources, as in the survey. Loss accepted: no zero-argument run that follows phax.json's records destination. That configuration names a remote, not a local clone, so the maintainer passes ~/.phax/records/phax explicitly.
- What a snapshot records: the snapshot of the shape phax currently writes is rendered from phax's own decoder. Older shapes are rendered from their frozen module, the only source left for them. Loss accepted: a snapshot does not describe everything a legacy literal's frozen decoder accepts. The frozen run-status v1, phax-plan v1 and phase-file-reconciliation v0 are deliberately broader, because one literal covers several written shapes (§5.13). The gate compares what phax writes, which is what §5.16 guards.
- Released snapshots are pinned by hash in packages/schemas/history.lock.json with the same never-overwrite rule as frozen modules; `next.schema.json` is never pinned. Loss accepted: the lock no longer pins only code, and plan 5's release.sh must refresh the lock after it renames `next` (through `--write`). Without the pin, editing the latest released snapshot would silently defeat the gate.
- `--write` creates every missing snapshot and also writes or rewrites `next.schema.json` when the generated schema differs from the latest released snapshot. It never overwrites a released snapshot and never deletes a file. Loss accepted: `next` is not strictly create-only. The spec (§10) says the unreleased snapshot is rewritten until the release is cut, and the alternative is a hand-copied JSON Schema.
- The corpus is additive: the script adds documents it has not seen and never deletes a corpus file. Loss accepted: the corpus is no longer a pure function of today's sources, so a wrongly written file must be removed by hand. Rebuilding it from scratch would drop documents whose sources are gone (cleaned run directories, a maintainer machine without the same ~/.phax), and keeping those is the guarantee.
- The corpus script is all-or-nothing: when any document fails to parse after scrubbing, it prints every failure and writes nothing. Loss accepted: no partial corpus on a machine whose history holds one unreadable document. That document is a real decoder gap, and a human decides how to fix it.

---

## phase-01 — JSON Schema snapshots per shape and the snapshot gate {#phase-01-snapshot-gate}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

Every format has a committed JSON Schema snapshot for every shape it has had, and `pnpm test` fails when phax's decoder for a format changes shape without a matching `next.schema.json`. The failure names the format and the snapshot to record (spec §5.16). No format changes shape in this phase, so the committed tree passes with no `next` snapshot. The `next` path is exercised on synthetic changes.

### Detailed instructions

- Read first: packages/schemas/build/jsonSchemas.ts, packages/schemas/build/generated.ts, packages/schemas/src/shapes.ts (FormatSpec: `legacy`, `releases`, `current`), packages/schemas/src/formats/*.ts, scripts/schemas-check.ts, tests/unit/schemasPackage/frozenHistory.test.ts, and FORMAT_IDS / compareReleases in src/schemas/schemaUrl.ts. Reuse them; do not add a second renderer or a second format table.
- In packages/schemas/build/jsonSchemas.ts, export the per-format definitions table: rename DEFINITIONS to FORMAT_DEFINITIONS and widen its type so each entry also exposes `legacy` and `releases`, casting the way shapes.ts does. Also export `renderShapeJsonSchema(format: FormatId, schema)`, the exact renderer JSON_SCHEMA_FORMATS goes through: `$schema` draft-07, `title: "phax <label>"`, the format's EXCESS strategy, and the findJsonSchemaGaps check. It returns either the file content (pretty JSON with a trailing newline, as renderJsonSchemas writes it) or a failure reason. renderJsonSchemas must keep producing byte-identical files, so jsonSchemas.test.ts stays green unchanged.
- Create packages/schemas/build/snapshots.ts. Keep it pure like generated.ts: no fs and no process. Paths are relative to packages/schemas: `snapshots/<format id>/<shape>.schema.json`, and the unreleased one is `snapshots/<format id>/next.schema.json`.
- In snapshots.ts, define `SnapshotFormat { id, label, released: ReadonlyArray<{ name, schema }>, current: { name, schema } }` and `SNAPSHOT_FORMATS`, built from FORMAT_DEFINITIONS in FORMAT_IDS order. `released` holds every `legacy[N]` as shape `v<N>` (its frozen module's schema) and every `releases` entry (its frozen module). It also holds the current shape when its name is not `next`. When the current shape shares a name with a frozen twin (every format today: v2 for the phase record manifest, v0 for the four timeline files, v1 for the rest), render that snapshot from phax's current decoder (`current.shape.schema`), not from the twin. Say why in a comment: the frozen v1 of run-status, phax-plan and phase-file-reconciliation v0 are deliberately broader than what phax writes (§5.13), and the snapshot records what phax writes.
- In snapshots.ts, export `compareShapeNames(a, b)`. Order `v<N>` shapes by N. Every `v<N>` comes before any release-named shape. Release names order by compareReleases. `next` is never a released shape. The latest released snapshot of a format is the highest-ordered snapshot file present in its directory, excluding `next`. Base it on files, not on the code table, so that plan 5's rename of `next` to `<X.Y.Z>` keeps the gate green on its own.
- In snapshots.ts, export `checkSnapshots(formats, files: ReadonlyMap<path, content>): string[]`. It returns one `✗ …` finding per violation, in format order:
  (1) a released shape in the table has no snapshot file — name the path and WRITE_COMMAND;
  (2) a file under snapshots/ is not named `v<N>.schema.json`, `<X.Y.Z>.schema.json` or `next.schema.json`, or sits in a directory that is not a FormatId;
  (3) a shape's schema cannot be rendered — name the format and the gap, as renderJsonSchemas does;
  (4) the generated schema (renderShapeJsonSchema of `current.schema`) differs from the latest released snapshot and `next.schema.json` is absent or different. Use the spec's wording: `✗ <label>: the generated schema differs from the latest released snapshot and from packages/schemas/snapshots/<id>/next.schema.json — record next.schema.json (run <WRITE_COMMAND>)`;
  (5) `next.schema.json` exists but the generated schema equals the latest released snapshot — say the next snapshot records no change and should be deleted.
- In snapshots.ts, export `writeSnapshots(formats, files): ReadonlyMap<path, content>`, the files `--write` writes. Include a missing released-shape snapshot, rendered as described above. Include `next.schema.json` when the generated schema differs from the latest released snapshot and `next` is missing or different. Never include an existing released snapshot. It never deletes anything.
- Extend scripts/schemas-check.ts:
  - SchemasState gains `snapshotFiles`, read by readSchemasState from packages/schemas/snapshots/ (recursive, utf8, sorted, keyed by path relative to packages/schemas), and `snapshotFormats` (defaults to SNAPSHOT_FORMATS; tests inject synthetic tables).
  - checkSchemas appends the checkSnapshots findings.
  - The lock covers the frozen modules plus every released snapshot, meaning every file under snapshots/ except next.schema.json. Reuse refreshLock. Keep findings distinct: "frozen module" for history files, "released snapshot" for snapshots, with the same never-change wording.
  - writeSchemas also returns `snapshots`, the map to write. Compute the snapshots first, then refresh the lock over the history files plus the released snapshots including the new ones. When any lock entry mismatches, nothing is written, as today.
  - The main block writes the snapshots, creating directories as needed.
  - Update the header comment to name the snapshots.
- Add "packages/schemas/snapshots" to .oxfmtrc.json ignorePatterns. Snapshots are compared byte for byte with the renderer's output, so oxfmt must never reformat them (json/ and history.lock.json are ignored for the same reason).
- Run `pnpm exec tsx scripts/schemas-check.ts --write` to create the 16 snapshots listed in the planned files and their lock entries, then run it without --write and confirm it passes. Do not hand-write any snapshot. If a frozen module's schema cannot be rendered, do not edit the module. It is pinned, and changing it is a human decision. Stop and record it in the handoff.
- Update tests/unit/schemasPackage/frozenHistory.test.ts: the expected list of lock keys now includes the 16 `snapshots/<id>/<shape>.schema.json` paths. The test "--write would change nothing" must also assert that `snapshots` is empty on the committed tree.

### Planned files to create

- `packages/schemas/build/snapshots.ts`
- `packages/schemas/snapshots/authoring-record-manifest/v1.schema.json`
- `packages/schemas/snapshots/compliance-review/v1.schema.json`
- `packages/schemas/snapshots/gate-attribution/v0.schema.json`
- `packages/schemas/snapshots/gate-diagnostics/v0.schema.json`
- `packages/schemas/snapshots/gate-pending/v0.schema.json`
- `packages/schemas/snapshots/phase-file-reconciliation/v0.schema.json`
- `packages/schemas/snapshots/phase-record-manifest/v1.schema.json`
- `packages/schemas/snapshots/phase-record-manifest/v2.schema.json`
- `packages/schemas/snapshots/phase-status/v1.schema.json`
- `packages/schemas/snapshots/phax-plan/v1.schema.json`
- `packages/schemas/snapshots/plan-approvals/v1.schema.json`
- `packages/schemas/snapshots/plan-document/v1.schema.json`
- `packages/schemas/snapshots/registry/v1.schema.json`
- `packages/schemas/snapshots/run-status/v1.schema.json`
- `packages/schemas/snapshots/spec-approvals/v1.schema.json`
- `packages/schemas/snapshots/spec-document/v1.schema.json`
- `tests/unit/schemasPackage/snapshots.test.ts`

### Planned files to edit

- `packages/schemas/build/jsonSchemas.ts`
- `scripts/schemas-check.ts`
- `packages/schemas/history.lock.json`
- `tests/unit/schemasPackage/frozenHistory.test.ts`
- `.oxfmtrc.json`

### Optional files that may be edited

- `packages/schemas/build/generated.ts`
- `scripts/schemas-json.ts`
- `tests/unit/schemasPackage/jsonSchemas.test.ts`

### Boundary contracts

Producer: packages/schemas/build/snapshots.ts, a set of pure functions over a format table and a map of snapshot files. Consumer: scripts/schemas-check.ts. It owns every filesystem read and write and passes their results in as SchemasState. The stable semantic contract: given the formats and the committed files, return the findings (empty means current) and the files `--write` would add. The latest released snapshot is decided from the files present. The generated schema of each format is rendered from phax's own current decoder (`current.shape.schema` of the format definition), through the one renderer packages/schemas/json/ uses. Plan 4 (`$schema`, first real `next`) and plan 5 (release.sh renaming `next`, then `--write` to pin it) both depend on this contract.

### Test strategy

Write tests/unit/schemasPackage/snapshots.test.ts before implementing checkSnapshots and writeSnapshots. The gate is a stable contract later plans rely on. Unit tests over injected state, no fs beyond readSchemasState on the real tree:
(a) on the committed tree, checkSchemas returns [] and writeSchemas has nothing to write;
(b) for every format id, the committed latest snapshot equals the file renderJsonSchemas(JSON_SCHEMA_FORMATS) produces for it, proving one renderer;
(c) acceptance criterion "A shape change must be recorded at its release" on a synthetic table: phase-record-manifest's current schema is RunRecordManifestSchema's fields plus one extra key. With no next, exactly one finding names "phase record manifest" and packages/schemas/snapshots/phase-record-manifest/next.schema.json. After adding the next file that writeSnapshots returns, the findings are empty;
(d) a next that differs from the generated schema fails the same way;
(e) a stale next with no change is reported;
(f) a missing released snapshot is reported and writeSnapshots creates it, while an existing released snapshot is never in the write set;
(g) an edited released snapshot fails through the lock, and --write refuses to write anything;
(h) compareShapeNames orders v1 < v2 < v10 < 0.9.0 < 0.10.0 < 0.17.0, and a present `0.17.0.schema.json` outranks `v2` as the latest released;
(i) a badly named snapshot file and an unknown format directory are reported;
(j) a synthetic format whose schema carries an unannotated Schema.filter is reported, named.
The existing frozenHistory and jsonSchemas tests must stay green.

### Implementation order

1. Export FORMAT_DEFINITIONS and renderShapeJsonSchema from packages/schemas/build/jsonSchemas.ts without changing its output
2. Write tests/unit/schemasPackage/snapshots.test.ts (synthetic cases first)
3. Implement packages/schemas/build/snapshots.ts: table, ordering, checkSnapshots, writeSnapshots
4. Wire snapshots and the extended lock into scripts/schemas-check.ts
5. Add the oxfmt ignore, run `pnpm exec tsx scripts/schemas-check.ts --write`, then the check without --write
6. Update frozenHistory.test.ts for the new lock entries and run the standard gate

### Excluded scope

- Writing `$schema` in any persisted format, dropping `version`, or committing any real next.schema.json (plan 4)
- release.sh renaming `next` snapshots to the release version and refreshing the lock (plan 5)
- Any change to a frozen module under packages/schemas/src/history/ or to a decoder under src/schemas/
- A new gate step in phax.json: the guard runs inside `pnpm test`
- The history corpus and its script (phases 02–04)
- Changes to the published package's entry, exports or files list: snapshots are a repository artifact, not shipped

### Verification

The `standard` gate profile in phax.json. Its `pnpm test` step runs frozenHistory.test.ts (checkSchemas on the committed tree) and snapshots.test.ts, and `pnpm format:check` confirms the snapshots are ignored by oxfmt.

### Expected handoff content

- The exported API of packages/schemas/build/snapshots.ts (SnapshotFormat, SNAPSHOT_FORMATS, compareShapeNames, checkSnapshots, writeSnapshots) and of renderShapeJsonSchema / FORMAT_DEFINITIONS in packages/schemas/build/jsonSchemas.ts, with their signatures.
- The new SchemasState fields (`snapshotFiles`, `snapshotFormats`) and writeSchemas' `snapshots` result.
- The exact wording of the unrecorded-change finding, and how --write records `next`. Plan 4 relies on both.
- Confirmation that the committed tree has 16 snapshots, all pinned in history.lock.json, and no next.schema.json.
- Which shapes were rendered from phax's decoder and which from a frozen module.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(schemas-package): snapshot every shape's JSON Schema and gate unrecorded shape changes`

### Commit body

Commit one JSON Schema snapshot per format and shape under
packages/schemas/snapshots/<format id>/<shape>.schema.json, rendered by
the same renderer as packages/schemas/json/. The current shape is
rendered from phax's own decoder; older shapes from their frozen module.

scripts/schemas-check.ts now fails when the schema generated from phax's
decoder differs from the format's latest released snapshot and
snapshots/<format id>/next.schema.json does not record it (spec §5.16).
It also fails on a missing snapshot, a stale next snapshot, or an edited
released snapshot; released snapshots are pinned in history.lock.json
beside the frozen modules. --write creates missing snapshots and records
next; it never overwrites a released snapshot.

The check runs inside pnpm test through the existing frozenHistory test;
snapshots.test.ts covers the next mechanism on synthetic shape changes.
phax's shapes do not change here: no next snapshot is committed.

---

## phase-02 — Shared walk over every source of persisted documents {#phase-02-source-walk}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

Put the walk that finds every document phax has written into one reusable, tested module: every commit of a records branch, a repository's history for the approvals ledgers and the spec and plan sidecars, and every live and archived run directory plus the registry. The shape survey and the corpus script then read exactly the same sources. The survey's report does not change.

### Detailed instructions

- Read scripts/survey-format-shapes.ts. Everything from `classifyRecordPath` through `walkRunDirs`, plus the records-branch detection and the `--repo` walk in its collect section, is the walk. Extract it verbatim in behavior; do not redesign it.
- Create scripts/formatSources.ts with no top-level side effects: no argv parsing and no reads at import. Export:
  - `FormatSourceDocument { format: FormatId; source: string; text: string }`, using FormatId from src/schemas/schemaUrl.ts;
  - `classifyRecordPath`, `classifyRepoPath` and `classifyRunDirFile`, returning FormatId | null;
  - `expandHome(path, home)` and `shortenHome(path, home)`;
  - `collectFormatDocuments({ phaxHome?: string, records: ReadonlyArray<string>, repos: ReadonlyArray<string>, home: string }): FormatSourceDocument[]`.
- Pass `home` in explicitly instead of calling os.homedir() inside the module, so tests can use a temporary home. The CLIs pass homedir().
- Keep the walk's current semantics:
  - records sources: every commit reachable from `phax/records/v1`, or `origin/phax/records/v1` when only the remote-tracking branch exists, not just the tip;
  - repo sources: `git rev-list --all -- docs/specs docs/plans`;
  - blobs deduplicated by blob sha within one source, read in one `git cat-file --batch`;
  - the phax home: registry.json, runs/<run>/ and archive/<name>/runs/ (the phase-NN subfolders included);
  - sources written home-relative (`~/…`).
- Rewrite scripts/survey-format-shapes.ts to import collectFormatDocuments and the classify functions from ./formatSources.js. It keeps its argument parsing, its per-format content dedupe, its signatures, its grouping and its two output files, all unchanged. For the same inputs its report must be byte-identical.
- Type the survey's DECODERS table with FormatId keys, so a format id added later without a decoder fails to compile, if that fits without changing behavior.

### Planned files to create

- `scripts/formatSources.ts`
- `tests/integration/formatSources.test.ts`

### Planned files to edit

- `scripts/survey-format-shapes.ts`

### Optional files that may be edited

- (none)

### Boundary contracts

Producer: scripts/formatSources.ts `collectFormatDocuments`. Consumers: scripts/survey-format-shapes.ts now, and scripts/extract-history-corpus.ts in phase 03. The contract is the list of every document found in the given sources, each with its FormatId (classified by location, the only identification a legacy document allows), a home-relative source locator, and its raw text. Git blobs are deduplicated per source; content dedupe across sources is left to the consumer. The module performs I/O (git, fs) and lives in scripts/, never in the package or in src/.

### Test strategy

Integration test tests/integration/formatSources.test.ts, written with the extraction. It uses real git in temporary directories (mkdtemp under os.tmpdir()), with commits made through `git -c user.name=… -c user.email=… -c commit.gpgsign=false`:
(a) Records history. A records repository whose `phax/records/v1` branch commits `<run>/phase-01/record.json` at version 1, then replaces it with a version-2 document in a second commit, and adds `authoring/<id>/record.json`, a `gate-attribution.json` and a `checks-attempt-01.diagnostics.json`. Both record versions, the authoring manifest and the timeline files are found with their format ids, so every commit is walked, not just the tip.
(b) Remote-only branch. A clone of that repository where only `origin/phax/records/v1` exists yields the same documents.
(c) Repository history. A repository whose history holds docs/plans/approvals.json and a docs/specs/<stamp>-x.json sidecar yields `plan-approvals` and `spec-document`.
(d) Phax home. A temporary home holding registry.json, runs/<run>/run-status.json, runs/<run>/phase-01/status.json and archive/<name>/runs/phax-plan.json yields registry, run-status, phase-status and phax-plan, with sources starting `~/`.
(e) Unit-level assertions on the classify functions for each file name the walk recognises, and null for others.

### Implementation order

1. Write tests/integration/formatSources.test.ts against the intended module API
2. Create scripts/formatSources.ts by moving the walk out of the survey
3. Point scripts/survey-format-shapes.ts at the module and confirm its behavior is unchanged
4. Run the standard gate

### Excluded scope

- The corpus script, scrubbing and the committed corpus (phases 03 and 04)
- Any change to the survey's report format or to docs/briefs/schemas-package-shapes.*
- Reading steme-lab or any checkout other than the ones passed as arguments
- Moving the walk into packages/schemas or src/: it performs I/O and stays a script module

### Verification

The `standard` gate profile in phax.json. `pnpm test` runs tests/integration/formatSources.test.ts; typecheck and lint cover the refactored survey.

### Expected handoff content

- The exact export list and signatures of scripts/formatSources.ts, in particular `collectFormatDocuments({ phaxHome, records, repos, home })` and FormatSourceDocument. Phase 03 builds on them.
- How the records branch is resolved (local vs remote-tracking), and that every commit is walked.
- Confirmation that the survey's behavior is unchanged, and how that was checked.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`refactor(scripts): extract the persisted-format source walk from the shape survey`

### Commit body

Move the walk that scripts/survey-format-shapes.ts performs into
scripts/formatSources.ts. The walk covers every commit of a records
branch, a repository's history of the approvals ledgers and the spec and
plan sidecars, and every live and archived run directory plus the
registry. Each document it finds is classified by location into a format
id.

The survey now imports the walk and produces the same report. The
history-corpus script builds on the same module in the next phase, so
both read exactly the same sources. An integration test walks temporary
git repositories and a temporary phax home, and checks that every commit
of the records branch is visited.

---

## phase-03 — History-corpus script with deterministic scrubbing {#phase-03-corpus-script}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

A committed script turns every document phax has ever written into a deterministic, public-safe history corpus. It reads the sources through the shared walk, removes home paths and session ids, classifies each document by the shape the package itself parses it as, and adds one file per distinct document under packages/schemas/corpus/. A document the package cannot parse stops the script, named with its first violation. The committed test fixtures are scrubbed the same way, and a test keeps every fixture and corpus file free of private data.

### Detailed instructions

- Create packages/schemas/build/corpus.ts, pure like the other build modules (no fs, no git). Export:
  - `SESSION_ID_FIELDS = ["claudeSessionId"] as const`. It is the only session-id field any exported format defines today: src/schemas/status.ts and the frozen phase-status v1. sessionCostUsd is a cost and is kept.
  - `SESSION_ID_PLACEHOLDER = "00000000-0000-4000-8000-000000000000"`, a UUID like the real values; the decoders only require a non-empty string.
  - `scrubDocument(value, home)`. It returns a deep copy where every occurrence of `home` that is followed by `/` or ends the string, in any string value or object key, is replaced by `~`, and every string value of a SESSION_ID_FIELDS key at any depth is replaced by the placeholder. Everything else is kept as is (SHAs, run names, costs, timestamps, key order). An empty `home` or `/` scrubs no paths.
  - `CORPUS_PARSERS`, one parse function per FormatId, taken from packages/schemas/src/index.ts (parseRegistry, parseRunStatus, … parseGatePending), typed `{ readonly [F in FormatId]: … }` so a new format id fails to compile until it has a parser.
  - `corpusFileContent(value)`, which is `JSON.stringify(value, null, 2) + "\n"`.
  - `corpusPath(format, shape, content)`, which is `<format>/<shape>/<first 16 hex chars of sha256(content)>.json`, reusing sha256 from build/generated.ts and matching the plan-2 fixtures' 16-hex names.
  - `planCorpus(documents: ReadonlyArray<FormatSourceDocument-like { format, source, text }>, home)`. For each document it runs JSON.parse (a non-JSON text is a failure at path ""), scrubs, parses the scrubbed value with CORPUS_PARSERS[format], and takes `shape` from the result. It returns `{ entries: sorted, deduplicated [{ path, content }], failures: [{ source, format, path, message }] }`. Parse the scrubbed value, not the original, so the committed content is exactly what was verified.
- Create scripts/extract-history-corpus.ts, modelled on scripts/schemas-check.ts:
  - Export `extractHistoryCorpus({ records, repos, phaxHome, home, outDir }): { added: number; kept: number; perShape: ReadonlyMap<string, { total: number; added: number }>; failures }` and put the CLI behind an isMain guard.
  - CLI flags: `--records <repo>` (repeatable), `--repo <repo>` (repeatable), `--phax-home <dir>`, and `--out <dir>`, defaulting to packages/schemas/corpus under the repository root. `~` in flags is expanded with expandHome. With no source at all, print usage and exit 2.
  - It collects with collectFormatDocuments (scripts/formatSources.ts), then runs planCorpus.
  - If there are any failures, print one line per failure, `✗ <source> (<format>): <path>: <message>`, exit 1 and write nothing.
  - Otherwise write only the entry paths that do not exist yet (additive; never delete, never rewrite), creating directories as needed. Print one line per `<format>/<shape>` with its total and added counts, then a total line.
  - The header comment documents the canonical invocation: `pnpm exec tsx scripts/extract-history-corpus.ts --records ~/.phax/records/phax --repo . --phax-home ~/.phax`.
- Scrub the two plan-2 fixtures that carry private data, keeping their signature keys and structure:
  - tests/unit/schemasPackage/fixtures/registry/v1.json: `archivePath` `/Users/<name>/.phax/archive/…` becomes `~/.phax/archive/…`;
  - tests/unit/schemasPackage/fixtures/phase-status/v1.json: every `worktreePath` under `/Users/<name>` becomes `~/…`, and every `claudeSessionId` becomes SESSION_ID_PLACEHOLDER.
  The result must be exactly what scrubDocument produces. Every existing schemasPackage test must stay green: scrubbing changes values only, never keys or verdicts.
- Create tests/unit/schemasPackage/publicData.test.ts. It walks every file under tests/unit/schemasPackage/fixtures/ and, when the directory exists, under packages/schemas/corpus/. It asserts:
  - no file contains a POSIX home-directory path (`/Users/<name>` or `/home/<name>` at the start of a path);
  - no file contains the current machine's homedir() when that is longer than `/`;
  - every SESSION_ID_FIELDS value found at any depth of the parsed JSON equals SESSION_ID_PLACEHOLDER.
  The failure names the file.
- In corpusBuild.test.ts, guard that SESSION_ID_FIELDS stays complete. Render every shape of every format (SNAPSHOT_FORMATS and renderShapeJsonSchema from phase 01), collect every property name matching /session_?id$/i, and assert they are all in SESSION_ID_FIELDS. A future format with a session id then fails until it is scrubbed.

### Planned files to create

- `packages/schemas/build/corpus.ts`
- `scripts/extract-history-corpus.ts`
- `tests/unit/schemasPackage/corpusBuild.test.ts`
- `tests/unit/schemasPackage/publicData.test.ts`
- `tests/integration/extractHistoryCorpus.test.ts`

### Planned files to edit

- `tests/unit/schemasPackage/fixtures/registry/v1.json`
- `tests/unit/schemasPackage/fixtures/phase-status/v1.json`

### Optional files that may be edited

- `scripts/formatSources.ts`
- `packages/schemas/build/snapshots.ts`

### Boundary contracts

Consumer: scripts/extract-history-corpus.ts. Producers: scripts/formatSources.ts (the documents and their location-derived format, from phase 02) and the package's own parse functions through CORPUS_PARSERS. A document's shape directory is whatever the package's parse returns (`result.shape`), never a guess from its `version` literal. The corpus layout contract, relied on by phase 04's test and by later plans, is `packages/schemas/corpus/<format id>/<shape>/<16-hex sha256 of the file content>.json`, where the file content is the scrubbed document as 2-space JSON with a trailing newline.

### Test strategy

Write corpusBuild.test.ts before corpus.ts. Unit, pure:
- scrubDocument replaces the home in values and keys (prefix, embedded mid-string, exact match), leaves `/Users/other` and a home-like prefix without a following `/` untouched, replaces claudeSessionId at any depth, and is idempotent;
- planCorpus classifies a phase record v1 and v2 fixture into `phase-record-manifest/v1` and `v2`, and a timeline document without `version` into `v0`;
- identical documents from two sources become one entry, and documents that differ only in their session id collapse once scrubbed;
- the output is sorted and stable across input order;
- a rejected document and a non-JSON text both come back as failures naming source, format, path and message;
- every scrubbed fixture still parses with its format's parser;
- the session-id completeness guard.
Write the integration test tests/integration/extractHistoryCorpus.test.ts after the unit tests, reusing phase 02's temporary-repository setup. With a temporary home whose run directory holds a phase status with a worktreePath under that home and a claudeSessionId, extractHistoryCorpus writes the expected files under a temporary outDir, scrubbed. A second run adds 0 and leaves the files byte-identical. A pre-existing extra corpus file is kept. A records commit carrying an invalid record.json makes the run fail with that document named, and nothing is written. publicData.test.ts runs on the committed fixtures now, and on the corpus once phase 04 commits it.

### Implementation order

1. Write corpusBuild.test.ts
2. Implement packages/schemas/build/corpus.ts
3. Write tests/integration/extractHistoryCorpus.test.ts, then scripts/extract-history-corpus.ts
4. Scrub the two fixtures and add publicData.test.ts
5. Run the standard gate

### Excluded scope

- Running the script against the real sources and committing the corpus (phase 04)
- Any change to a decoder, a frozen module or a format definition, even if a surveyed document turns out to be rejected
- Scrubbing anything beyond home-directory paths and session-id fields (SHAs, run names and costs are kept by decision)
- Sampling or trimming documents
- Wiring the corpus into the release workflow beyond `pnpm test` (plan 5 owns the workflow)

### Verification

The `standard` gate profile in phax.json. `pnpm test` runs corpusBuild.test.ts, publicData.test.ts, the integration test and the existing fixture tests over the scrubbed fixtures.

### Expected handoff content

- The exported API of packages/schemas/build/corpus.ts (SESSION_ID_FIELDS, SESSION_ID_PLACEHOLDER, scrubDocument, CORPUS_PARSERS, corpusFileContent, corpusPath, planCorpus) and of scripts/extract-history-corpus.ts (extractHistoryCorpus and its CLI flags).
- The exact command phase 04 must run, and what its success and failure output look like.
- Confirmation that both fixtures are scrubbed and that every schemasPackage test still passes.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(schemas-package): add the history-corpus extraction script with scrubbing`

### Commit body

Add scripts/extract-history-corpus.ts (spec §5.19). It walks every source
through scripts/formatSources.ts, scrubs each document for a public
repository and classifies it by the shape id the package's own parse
function returns. It then writes
packages/schemas/corpus/<format id>/<shape>/<content hash>.json, one
file per distinct document.

Scrubbing is deterministic and keeps every value decodable: the home
directory becomes `~` in any string, and every session-id field becomes
one fixed placeholder. SHAs, run names and costs are kept. The script is
additive, never deleting a corpus file, and all-or-nothing: a document
that fails to parse is named with its first violation, and nothing is
written.

The two plan-2 fixtures that carried a home path and session ids are
scrubbed the same way. A test fails if any committed fixture or corpus
file contains a home-directory path or a session id other than the
placeholder.

---

## phase-04 — Commit the history corpus and parse it on every gate {#phase-04-committed-corpus}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

The repository holds the history corpus: every distinct document phax has written, from the records clone, this repository's history and the phax home. `pnpm test` parses every one of those documents with the package on every gate, including the release workflow's gate (spec §5.18). A document that fails names itself and its first violation.

### Detailed instructions

- Add "packages/schemas/corpus" to .oxfmtrc.json ignorePatterns. Corpus files are hashed byte for byte, so oxfmt must never reformat them.
- Run exactly: `pnpm exec tsx scripts/extract-history-corpus.ts --records ~/.phax/records/phax --repo . --phax-home ~/.phax`. The phase sandbox can read the worktree and ~/.phax. Do not pass any other checkout.
- If the script reports failures (exit 1), do not change any decoder, frozen module, format definition or the script's policy to make them pass. Record every failure line in phase-handoff.md and stop. A document the package cannot read is a real gap for a human to decide. Otherwise the script has written the corpus under packages/schemas/corpus/.
- Run the same command a second time and confirm it reports 0 added: the corpus is deterministic. Record both summaries (per format/shape totals) in the handoff.
- Create tests/unit/schemasPackage/historyCorpus.test.ts. Read every file under packages/schemas/corpus/<format>/<shape>/*.json with fs and check:
  - the directory structure: `<format>` is a FormatId and there are exactly two directory levels;
  - the name is corpusPath's hash of the file's bytes;
  - parse it with CORPUS_PARSERS[format] and assert ok and `shape` equal to the directory. Use `it.each` keyed by the relative path, with an assertion message `<path>: <error.path>: <error.message>` so a failure names the document and its first violation (§5.18).
  Also assert:
  - the corpus is non-empty;
  - `phase-record-manifest/v1` and `phase-record-manifest/v2` are both non-empty (acceptance criterion "A mixed history parses");
  - `authoring-record-manifest/v1` holds at least one manifest with `sourceSha` and one without ("Both legacy authoring shapes parse", §5.13).
- publicData.test.ts from phase 03 now covers the corpus automatically. Confirm that it passes over the committed corpus.

### Planned files to create

- `tests/unit/schemasPackage/historyCorpus.test.ts`

### Planned files to edit

- `.oxfmtrc.json`

### Optional files that may be edited

- `packages/schemas/build/corpus.ts`

### Test strategy

The corpus is the fixture set for historyCorpus.test.ts, a unit test in `pnpm test`, so it runs in every phax gate, in CI, in check:full (test:unit) and in the release workflow's Gate step. Write the test after the corpus exists, since it asserts over committed data. publicData.test.ts (phase 03) re-checks the corpus for home paths and session ids. Checking by hand: a second extraction run adds nothing.

### Implementation order

1. Add the oxfmt ignore for packages/schemas/corpus
2. Run the extraction script; stop and hand off on any failure
3. Re-run it to confirm 0 added
4. Create tests/unit/schemasPackage/historyCorpus.test.ts
5. Run the standard gate

### Excluded scope

- Changing any decoder, frozen module, format definition or the corpus script to accommodate a document
- Sampling, trimming or hand-editing corpus files
- Sources other than ~/.phax/records/phax, this repository and ~/.phax (steme-lab shapes are covered by the plan-2 fixtures)
- The release workflow, release.sh and the README (plan 5); `$schema` writing (plan 4)

### Verification

The `standard` gate profile in phax.json. `pnpm test` runs historyCorpus.test.ts and publicData.test.ts over the committed corpus, and `pnpm format:check` confirms the corpus is ignored by oxfmt.

### Expected handoff content

- The extraction command as run, and both summaries: documents per `<format>/<shape>` with totals, and the second run's 0 added.
- Which formats (if any) have no corpus documents from these sources.
- Any extraction failure, verbatim, if the phase stopped.
- The file-plan deviation phax will flag: several hundred unplanned files created under packages/schemas/corpus/ by the extraction script. Their paths cannot be known before the run; they are the phase's deliverable.
- Any other deviation from the planned file lists, with the reason.

### Commit subject

`test(schemas-package): commit the history corpus and parse it on every gate`

### Commit body

Commit packages/schemas/corpus/, every distinct document phax has
written. It was extracted with
`scripts/extract-history-corpus.ts --records ~/.phax/records/phax
--repo . --phax-home ~/.phax` and scrubbed of home paths and session
ids.

historyCorpus.test.ts parses every corpus file with its format's parse
function on every gate, including the release workflow's `pnpm test`
(spec §5.18). It checks that the shape matches the directory and that
the file name matches its content hash, and names the file and the first
violation of any document that fails. It also checks against real
history that the phase record's v1 and v2 shapes and both legacy
authoring-record shapes, with and without sourceSha, all parse.
