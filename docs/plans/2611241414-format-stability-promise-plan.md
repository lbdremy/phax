---
status: Draft
source-spec: docs/specs/2611231918-format-stability-promise.md
completes-spec: true
---
# Format stability promise

Implements every requirement of the approved spec `format-stability-promise` (§5.1–§5.21, every §6 surface, every §8 criterion). From 1.0.0 phax promises the rules by which its persisted shapes change, not frozen shapes, and this plan makes tests and the release cut hold phax to those rules now. Before 1.0.0 every minor release counts as breaking, so today's behaviour already keeps the rules.

The work goes inside-out:
- the stability class of each of the 46 registered formats, and the docs page's generated table (phase-01);
- the newer-than-reader and below-the-floor refusals in both readers, with the released-shapes record they read (phase-02);
- the shared-records-branch refusal (phase-03);
- phax catching up with `@lbdremy/phax-schemas` on every durable shape: the run folder and `phax resume` (phase-04), then spec and plan sidecars (phase-05);
- removing the blocking steps: `migrate-documents` (phase-06) and the old approval ledgers' `migrate-approvals` (phase-07);
- the release cut's new refusals (phase-08);
- the property and guard tests that hold the readers to the promise (phase-09);
- configuration (phase-10);
- the docs page, last (phase-11).

Settled facts every phase relies on:
- A **breaking release** is X.0.0 from 1.0.0 on, and before 1.0.0 any release whose patch is 0 (a minor). Every other release is non-breaking.
- **Classes**: `durable` (registry, run-status, phase-status, phax-plan, compliance-review, plan-approvals, spec-approvals, phase-record-manifest, authoring-record-manifest, gate-attribution, phase-file-reconciliation, spec-document, plan-document, plan-approval-record, spec-approval-record, brief-record, decision-record-manifest, cost-ledger, interactive-session, review-stop, review-record-manifest, code-review, revision-record-manifest, finding-fate-record-manifest), `published` (gate-request, brief-request, architecture-request, oracle-request, acceptance-request, run-list, artifact-status, plan-overview, plan-lint, finding-list) and `answer` (gate-report, brief-report, architecture-report, hand-decision-answer, first-reading, interactive-handoff, decide-verdicts, phax-plan-extraction, spec-hand-decision-answer, plan-hand-decision-answer, code-review-answer, compliance-review-answer).
- **No persisted shape changes in this plan** unless the operator picks `unknown-in-shape` on q-unknown-write. The opened version (0.43.0) already carries a `gate-attribution` `next` shape, so phase-08 makes the `### 0.43.0` entry of `docs/upgrading.md` name `gate-attribution`. CI rehearses that cut on every pull request.
- **Tests never name the opened version.** They compute versions from `package.json`, the ledger or `PHAX_RELEASE`, run every cut in a scratch copy, never run `scripts/release.sh`, and never read `~/.phax`.

No acceptance phase: the surface is file formats, refusals and a release script, and tests read all of it in full. The plan runs beside `security-high-fixes` and `launcher-release-fixes`. It stays off `src/infra/git.ts`, `src/app/worktree.ts`, `src/domain/records/assemble.ts`, `src/app/reviewCode.ts`, `npm/`, `deno.json` and the workflows. It touches `src/app/loadConfig.ts` once, in phase-10, for §5.19 and §5.20 only.

## Required commands

- `pnpm exec tsx`
- `pnpm test`
- `pnpm gen:usage-spec`
- `pnpm docs:cli`

Every command is already granted, so `phax.json` needs no change:
- `pnpm exec tsx`, `pnpm gen:usage-spec` and `pnpm docs:cli` are entries of `security.agentCommands`. `pnpm exec tsx` runs `scripts/schemas-check.ts --write` after a phase changes a generated table. The other two regenerate the usage spec and the CLI docs when a phase changes a command's help text.
- `pnpm test` is a gate command.

## Technical arbitrations

- **Where each format's class lives.** `FORMAT_CLASSES`, typed `{ readonly [F in FormatId]: StabilityClass }`, goes in `src/schemas/schemaUrl.ts` beside `FORMAT_IDS`. That pure module is already the one the schemas package imports, so a format added without a class is a type error in both readers, and the package re-exports the class. The page's table is a generated block of `docs/format-stability.md`, between `<!-- BEGIN generated: format-classes -->` and `<!-- END generated: format-classes -->`. `scripts/schemas-check.ts --write` writes it, its check mode reports drift, and a unit test fails naming any format missing from the table. Loss accepted: `schemas-check` now writes one docs file, and a contributor adding a format regenerates that block, told so by a red check.
- **Which shapes were released, and the floor's history.** A new record, `packages/schemas/released-shapes.json`, holds each format's released shape names and the floor's history (`floors: [{ since, floor }]`). It is seeded once in phase-02, and afterwards only the release cut writes it, never `schemas-check --write`. The cut compares the snapshot tree against it to see a raised floor, a dropped shape or a retired format. `schemas-check` generates `FLOOR_HISTORY` (phase-02) and `RELEASED_SHAPES` (phase-04) from it. The cut reads no git tag, so its refusals stay testable in a scratch copy. Loss accepted: a deliberate hand edit of the record, made together with a deleted snapshot, defeats the check. Review is what catches that.
- **How the cut tells what changed.** The formats that changed shape in a release are those with a `next` snapshot at the cut, before the rename. The release's `### X.Y.Z` entry of `docs/upgrading.md`, read by the release notes' existing entry reader, must name each of them as an inline code span of the format id. A missing entry is now a refusal when any format changed; it stays a warning otherwise. Drops and renames come from a pure comparator in `packages/schemas/build/shapeChanges.ts`. It resolves `$ref`s and walks the latest released snapshot against `next`, reporting a property name that is gone, an `enum`/`const` member that is gone, and a union variant whose discriminant `const` is gone. A rename reads as the drop of the old name. Loss accepted: the comparator judges names, not types, so narrowing a field's type or tightening a pattern without dropping a name passes as an addition.
- **How a below-floor refusal names the release line.** The line is read from `FLOOR_HISTORY`: the first entry whose floor is above the stamp marks the breaking release that stopped reading it (`since`). The line just before it is named `<major−1>.x` when `since` is M.0.0 with M ≥ 2, and `a release before <since>` otherwise. A stamp below the very first floor keeps today's development-build refusal. Loss accepted: the refusal names a whole release line, not the exact last release that reads the document.
- **phax's catch-up with the package, inventoried from the property registry's `packageOnly` entries and repairs.** Today phax refuses:
  - a pre-schema phase-status, or one stamped 0.17.0–0.19.x (`base` never recorded);
  - a pre-schema or 0.17.0 gate-attribution with a `pending` step;
  - a plan-document stamped 0.17.0–0.19.x, or a pre-schema one beside a source spec (`completesSpec` never recorded);
  - a plan-document lift refused at a departing test line or at a non-canonical path.

  Every other durable shape already reads. The answer shapes phax holds to one stamp (first-reading 0.26.0, interactive-handoff 0.26.0, phax-plan-extraction 0.32.0 and 0.33.0) stay refused until 1.0 under the 2026-10-08 rule, guarded in phase-09. The readers that drive a run or a write keep returning the current in-memory value. Display reads get an any-shape value carrying `{ kind: "unknown" }`, following the existing `PhaxPlanRead`/`AnyShapePhaxPlan` pattern. The catch-up is spread over phase-04 (run folder), phase-05 (sidecars) and phase-09 (guards), so each gate stays green. phax keeps the spec surface summary placeholder as its in-memory spelling of an unknown summary: the current spec-document shape requires a string, and the cut already refuses to announce a spec that holds one. Loss accepted: two reading paths per affected format (current for writers, any-shape for display), and one unknown fact spelled as a placeholder string rather than `{ kind: "unknown" }`.
- **`phax artifact migrate-documents` becomes the non-blocking document upgrade of §5.11**, written to q-unknown-write's recommendation. After filling what it can compute, it rewrites a spec or plan sidecar only when the lift holds no unknown and the current rendering of the lifted document already equals the artifact's body. It never writes an `.md`, so approval fingerprints, sidecar agreement and staleness answer the same before and after. It also rewrites 0.19.0 and 0.25.0 approval records with their computed facts (`unattributed`, `code: null`). Every other sidecar stays in its older shape, still read and lifted, and is named as kept, exit 0. Wording that disappears:
  - "run `phax artifact migrate-documents` first" and `DocumentMigrationRequiredError`;
  - "migrate with `phax artifact migrate-documents`" in `phax artifact status`;
  - "Run `phax artifact migrate-documents` first, to rewrite … at its current shape.";
  - the command's own refusals ("a hand edit would be overwritten", the path and test-strategy remedies), which become kept lines.

  The published `artifact-status` shape is not changed: an older sidecar's agreement is judged against its own-shape rendering (in sync or diverged), and the variant that named its older shape is simply no longer produced. Loss accepted: the upgrade cannot bring every document to the current shape (a 0.28.0 or 0.32.0 plan whose rendering moved stays older until an author revises it), and the published shape keeps an unproduced variant until a breaking release removes it.
- **The resume refusal names a range of releases.** run-status never recorded the release that started a run, so §5.17's refusal names the range of releases that wrote the older shape: from its stamp up to the release before that format's next released shape, read from the generated `RELEASED_SHAPES`. Loss accepted: a range, not the exact release.
- **Which configurations stay accepted (§5.18).** The fixture is a frozen copy, `tests/fixtures/configAccepted/accepted.json`, seeded from the behaviour corpus's accepted configuration cases (`tests/behaviourCorpus/cases/config/`) plus this repository's own `phax.json`. A test holds every entry accepted, except one refused for a model or effort the catalog no longer lists. Dropped keys (§5.19) are checked against a table that is empty today, on the raw JSON before strict decoding. Retired models (§5.20) generalize today's `RETIRED_MODEL_IDS`/`RETIRED_MODEL_SUCCESSORS` to every model value of `phax.json`, `phax.local.json`, `providers.json` and `model-routing.json`. Loss accepted: at each breaking release a person reseeds the fixture by hand, and the test's failure message says so.

## Open questions

### q-unknown-write — When decide, revise or the document upgrade rewrites an older spec or plan sidecar whose lift still holds a fact it cannot compute, what does it write? The cases are a 0.17.0–0.19.x plan's `completesSpec` with no frontmatter value, a test strategy line that departs from the grammar, and a planned path with no canonical form.

- keep-older — No shape change: the upgrade keeps such a sidecar in its older shape (still read and lifted, named as kept), and decide or revise refuses that one artifact by name, naming the phase, the fact and the edit to make in plan.md and its sidecar. — abandons: The letter of §5.10 and of AC-doc-upgrade's "`unknown` where it cannot compute" for those few documents. An author fixes that one artifact before decide or revise can rewrite it, though no other command or document waits on it.
- unknown-in-shape — The current plan-document and spec-document shapes gain an explicit `{ "kind": "unknown" }` on `completesSpec`, a phase's test strategy, a phase's planned-file lists and a surface's summary. The upgrade, decide and revise write it, and `plans lint` and `phax run` refuse a plan whose planned files are unknown, naming the phase. — abandons: A current-shape plan or spec is no longer complete by construction. Two shapes change at once (new snapshots and an upgrading entry), and every consumer of those fields gains an unknown branch: renderers, lint, overview, the extraction seed, and the headless authoring schema, which must then refuse an author's unknown separately.

Recommendation: keep-older — The documents concerned are pre-0.20 plans and plans with a hand-broken test line or path, almost all archived. The fix stays local to one artifact and never blocks another command or another document. `unknown-in-shape` would weaken the current shape that every new spec and plan is authored in, in order to carry facts that are rare. Phase-06 is written to `keep-older`. With `unknown-in-shape`, phase-05 and phase-06 also change both document shapes and their consumers, and phase-11 names the two formats in the 0.43.0 entry.

### q-approval-ledgers — The spec names `migrate-documents`, but `phax artifact status`, approve, reopen, plan staleness and `migrate-documents` also refuse while an old approval ledger (`plan-approvals`, `spec-approvals`) exists, until `phax artifact migrate-approvals` runs. That is a one-time step on durable formats at the floor. Does this plan remove it too?

- include — Remove it here (phase-07): an artifact with no approval record file takes its approval from the ledger entry, lifted as unattributed, and `migrate-approvals` becomes non-blocking. — abandons: A smaller plan. One more phase touches the approval store that status, approval and staleness all read, a risk for a step few repositories still meet.
- defer — Drop phase-07 and leave `migrate-approvals` blocking. The format-stability page names it as the one step a repository approved before 0.19.0 still meets, and a follow-up goes to NEXT_STEPS.md. — abandons: §5.10 for the old ledgers: this plan completes the spec while a one-time step on a durable format at the floor remains. Unless the follow-up lands first, 1.0 would ship with a step its own promise rules out.

Recommendation: include — With completes-spec: true, the plan should leave no one-time step on a format at the floor, and the change is a read-side fallback plus removed refusals, the same move phase-06 makes for sidecars. If the operator defers it, phase-07 is deleted and phase-11 documents the remaining step.

---

## phase-01 — Stability classes and the format table {#phase-01-stability-classes}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

Every registered format carries exactly one stability class (`durable`, `published` or `answer`). The new `docs/format-stability.md` lists all 46 in a table generated from that registry, and tests fail, naming the format, when one has no class, is missing from the table, or has a current schema that does not require its `$schema` stamp.

### Detailed instructions

- In `src/schemas/schemaUrl.ts`, add `STABILITY_CLASSES = ["durable", "published", "answer"] as const`, `type StabilityClass` and `FORMAT_CLASSES`, typed `{ readonly [F in FormatId]: StabilityClass }` so that a format missing from it is a type error. Give each class a doc comment with its definition from spec §4: durable means phax writes it and reads it back across releases; published means phax writes it for another program and never reads it back; answer means another program writes it for phax to read.
- Fill `FORMAT_CLASSES` exactly as the plan preamble lists the 46 formats: 24 durable, 10 published, 12 answer. Retired formats keep a class: oracle-request is published, hand-decision-answer is answer.
- Re-export `FORMAT_CLASSES`, `STABILITY_CLASSES` and `StabilityClass` from `packages/schemas/src/index.ts`, alongside however it already re-exports from `src/schemas/schemaUrl.ts`, so package consumers can read a format's class.
- Create `packages/schemas/build/formatClasses.ts` with a pure `renderFormatClassTable(): string`. It returns the Markdown table `| Format | Class | Read by |` with one row per format in `FORMAT_IDS` order. Read by is `phax and the package` for durable, `the package` for published, and `phax (every shape from 1.0.0)` for answer, as in spec §6. Format ids appear in backticks.
- In `scripts/schemas-check.ts`, `--write` replaces only the text between `<!-- BEGIN generated: format-classes -->` and `<!-- END generated: format-classes -->` in `docs/format-stability.md`. Check mode reports `✗ docs/format-stability.md: the format-classes table differs from FORMAT_CLASSES — run pnpm exec tsx scripts/schemas-check.ts --write`. A missing page or missing markers is a finding in check mode, and `--write` never creates the page. Add the page to the paths `applySchemasWrite` reports as changed when it rewrites it.
- Create `docs/format-stability.md`: a `# Format stability` heading, a one-paragraph lede (phase-11 writes the rules), then the generated block, written by running `pnpm exec tsx scripts/schemas-check.ts --write`.
- Add the page to `site/pages.ts` next to `/guide/upgrading` (route `/guide/format-stability`, title `Format stability`, a 50–160 character description). The site's page-map test refuses an unmapped docs file.
- The release-cut and release-open unit tests run `applySchemasWrite` in a scratch copy. If they copy a fixed file list, add `docs/format-stability.md` to it so the copy's write and check still pass.
- Tests in a new `tests/unit/formatStability.test.ts`:
  - `FORMAT_CLASSES` keys equal `FORMAT_IDS`;
  - parsing the page's generated table finds each format exactly once, with its class;
  - a missing class or a missing row fails with a message naming the format (check the message through the helper the test uses);
  - for every durable and published format, the current JSON Schema (`FORMAT_DEFINITIONS` / the rendered schema from `packages/schemas/build/jsonSchemas.ts`) lists `$schema` in `required`, and `currentSchemaUrl(id)` is `schemaUrl(id, CURRENT_STAMPS[id])`.

  Add a schemas-check test for the block: stale, then rewritten, with the rest of the page untouched.

### Planned files to create

- `packages/schemas/build/formatClasses.ts`
- `docs/format-stability.md`
- `tests/unit/formatStability.test.ts`

### Planned files to edit

- `src/schemas/schemaUrl.ts`
- `packages/schemas/src/index.ts`
- `scripts/schemas-check.ts`
- `site/pages.ts`

### Optional files that may be edited

- `tests/unit/releaseCut.test.ts`
- `tests/unit/releaseOpen.test.ts`
- `tests/unit/schemasPackage/snapshots.test.ts`
- `tests/unit/site/pageMap.test.ts`
- `tests/behaviourCorpus/baseline/package-exports.json`

### Boundary contracts

The class registry is produced by `src/schemas/schemaUrl.ts` and consumed by the schemas package (through its re-export), by `scripts/schemas-check.ts` (to render the table) and by tests. Its shape is a total map from `FormatId` to one of three literals, and later phases rely on exactly that.

### Test strategy

- every registered format has exactly one class and exactly one row of the page's table with that class — small · table · FORMAT_IDS against FORMAT_CLASSES and the parsed table · in-phase · AC-class
- a format without a class, or missing from the table, fails naming the format — small · example · the failure message naming the format · in-phase · AC-class
- every durable and published format's current schema requires a $schema that names its format at its current stamp — small · table · the rendered JSON Schemas and CURRENT_STAMPS · in-phase · AC-stamp
- schemas-check reports a stale format-classes block, and --write rewrites only that block — medium · example · the page's bytes before and after · in-phase

### Implementation order

1. FORMAT_CLASSES and its types in src/schemas/schemaUrl.ts
2. renderFormatClassTable in packages/schemas/build/formatClasses.ts
3. schemas-check check and write of the block
4. docs/format-stability.md and site/pages.ts
5. the package re-export
6. tests

### Excluded scope

- The page's prose, the six rules and the links from README and docs/upgrading.md (phase-11).
- Any reader behaviour or refusal wording (phase-02 and later).
- A new pnpm script or gate step: the table is written by the existing schemas-check.

### Verification

The `standard` gate profile in phax.json (format, typecheck, test:type, lint, format:check, test, knip, audit:architecture, gen:model-catalog --check).

### Expected handoff content

- The exact exports added: `STABILITY_CLASSES`, `StabilityClass`, `FORMAT_CLASSES` in `src/schemas/schemaUrl.ts`, and their package re-export.
- The markers and the route of the new page.
- How `schemas-check` finds and rewrites the block (the function names), so phase-11 does not touch the block.
- Any test file whose copied-file list changed.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(schemas): give every persisted format a stability class`

### Commit body

Add FORMAT_CLASSES beside FORMAT_IDS: each of the 46 registered formats is durable, published or answer, and a format without a class is a type error in phax and in the schemas package, which re-exports it.

schemas-check now writes the generated format-classes table of the new docs/format-stability.md and reports it when stale. Tests hold every format to one class and one table row, and every durable and published format's current schema to a required $schema stamp.

---

## phase-02 — Refuse newer and below-floor stamps by name {#phase-02-stamp-refusals}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium
**Assignment reason:** Departs from the default to claude-opus-5-5: the phase designs the floor-history record and the line rule that the cut, resume and both readers later share, a model no code in the repository holds yet, and it changes refusal wording across both readers at once.

Both readers refuse a document stamped newer than themselves with the remedy to upgrade to that release or later, and refuse a document stamped below their floor by naming the floor and the release line that still reads it. The floor's history lives in a new released-shapes record that later phases and the release cut build on.

### Detailed instructions

- Create `packages/schemas/released-shapes.json`: `{ "floors": [{ "since": "0.17.0", "floor": "0.17.0" }], "formats": { "<format id>": ["pre-schema", "0.17.0", …] } }`.
  - Formats go in `FORMAT_IDS` order, each listing every snapshot name under `packages/schemas/snapshots/<id>/` except `next`: `pre-schema` first when present, then releases in ascending order.
  - Seed it from the snapshot directory with a throwaway `pnpm exec tsx -e` invocation, not a committed script, and check it by eye against the directory listing.
  - Only the release cut writes this file from now on (phase-08). Say so in the reader module's comment.
- Create `packages/schemas/build/releasedShapes.ts`: a pure `parseReleasedShapes(text): ReleasedShapes | string` that refuses a malformed record, a floors list that is empty or not ordered by `since`, an unknown snapshot name, or an unordered shape list. Add `readReleasedShapes(repoRoot)` for scripts.
- Generation through `scripts/schemas-check.ts` and `packages/schemas/build/generated.ts`:
  - `FLOOR_HISTORY` (a readonly array of `{ since, floor }`) goes into `packages/schemas/src/generated/index.ts` (`renderGeneratedIndex`) and into `src/schemas/release.ts` (`renderReleaseModule`);
  - `FIRST_SUPPORTED_RELEASE` also goes into `src/schemas/release.ts`, because phax needs its floor;
  - check mode reports drift;
  - a record whose last floor differs from the snapshot-derived `FIRST_SUPPORTED_RELEASE` is not a finding (the cut judges that in phase-08).
- Pure helpers in `src/schemas/schemaUrl.ts`, which both readers already import; keep it importing only `effect`:
  - `newerStampMessage(formatId, release, reader)`: `<format> <release> is newer than <reader> — upgrade <what> to <release> or later`. `reader` is `this phax (<running>)` with what `phax` and the tail `to read it`, or `@lbdremy/phax-schemas <version>` with what `the package`. The exact outputs are spec §6: `run-status 1.4.0 is newer than this phax (1.3.0) — upgrade phax to 1.4.0 or later to read it`, and `phase-status 1.4.0 is newer than @lbdremy/phax-schemas 1.3.0 — upgrade the package to 1.4.0 or later`.
  - `lastLineReading(stamp, floorHistory)`: null when the stamp is at or above the last floor. `"first"` when it is below the first floor ever, which keeps today's development-build or pre-schema refusals. Otherwise the line before the first entry whose floor is above the stamp: `<M−1>.x` when that entry's `since` is M.0.0 with M ≥ 2, else `a release before <since>`.
  - `belowFloorMessage(formatId, stamp, readerLabel, floor, line)`, e.g. `phase-status 1.4.0 is below the floor of @lbdremy/phax-schemas 2.0.0 (2.0.0) — read it with @lbdremy/phax-schemas 1.x`, with the phax variant naming `this phax (<running>)` and `phax <line>`. A document without `$schema` is below any floor after the first; name its shape `pre-schema`.
- In `packages/schemas/src/shapes.ts`:
  - `newerReleaseMessage` uses the new wording;
  - `defineFormat` gains an injectable `floorHistory` option (default `FLOOR_HISTORY`);
  - `bySchemaUrl` and `byPreSchema` refuse below the floor with `belowFloorMessage` at `$schema` whenever `lastLineReading` names a line;
  - `developmentBuildMessage` and `preSchemaUnsupportedMessage` stay for the `first` case.
- In `src/schemas/persisted.ts`, every newer-stamp refusal (`readCurrent`, `readReport`, the record-manifest path through `newerManifestReader`, and any other `upgrade phax to read it`) uses `newerStampMessage` with the format id, not the label. Add the floor check to the shared stamp paths (`readCurrent`, `isStampedBelowCurrent`/`isStampedAtOrAbove` callers, `readReport`, and the pre-schema path of `readPersisted`): below `FIRST_SUPPORTED_RELEASE`, refuse with the phax variant of `belowFloorMessage` when a line is named, or as written by a development build otherwise. With today's single floor, every document phax reads today still reads. Update the module's header comment.
- Update every test and behaviour-corpus case whose captured refusal holds the old wording (grep `upgrade phax to read it` and `— upgrade the package`). Corpus case files under `tests/behaviourCorpus/cases/` may need their expected refusal strings changed. Name each edited case file in the handoff.
- Tests:
  - `tests/unit/schemas/stampRefusals.test.ts`: the pure helpers, with injected floor histories, including `[{since 0.17.0, floor 0.17.0}, {since 2.0.0, floor 2.0.0}]` and a phase-status stamped 1.4.0 giving `1.x`;
  - `tests/unit/schemasPackage/floorRefusals.test.ts`: `defineFormat` with an injected package version and floor history refuses a newer stamp and a below-floor stamp at `$schema` with the spec's wording, and reports the floor as 0.17.0 on today's tree, where a phase record manifest stamped 0.17.0 and a registry without `$schema` both parse, in the package and through phax's readers;
  - the existing property `refuses a newer stamp whatever the body` now also checks that the refusal names the stamp's release as the release to upgrade to.

### Planned files to create

- `packages/schemas/released-shapes.json`
- `packages/schemas/build/releasedShapes.ts`
- `tests/unit/schemas/stampRefusals.test.ts`
- `tests/unit/schemasPackage/floorRefusals.test.ts`

### Planned files to edit

- `src/schemas/schemaUrl.ts`
- `packages/schemas/src/shapes.ts`
- `packages/schemas/build/generated.ts`
- `packages/schemas/src/generated/index.ts`
- `src/schemas/release.ts`
- `src/schemas/persisted.ts`
- `scripts/schemas-check.ts`
- `tests/unit/persisted.test.ts`

### Optional files that may be edited

- `tests/unit/schemasPackage/frozenHistory.test.ts`
- `tests/unit/property/persistedFormats.property.test.ts`
- `tests/helpers/property/jsonInputs.ts`
- `tests/helpers/property/formatRegistry.ts`
- `tests/behaviourCorpus/corpus.ts`
- `tests/behaviourCorpus/cases/formats/run-status.json`
- `tests/behaviourCorpus/cases/formats/phase-status.json`
- `tests/unit/releaseCut.test.ts`
- `tests/unit/releaseOpen.test.ts`
- `tests/unit/schemasPackage/snapshots.test.ts`
- `README.md`

### Boundary contracts

Producer `src/schemas/schemaUrl.ts` gives both readers one wording for the newer and below-floor refusals. Its consumers are `packages/schemas/src/shapes.ts` (refusal at `$schema`) and `src/schemas/persisted.ts` (a `PersistedReadError` message). `packages/schemas/released-shapes.json` is consumed by `schemas-check`, which generates `FLOOR_HISTORY` into both generated modules. Phase-04 adds `RELEASED_SHAPES` from the same record, and phase-08 makes the cut its only writer.

### Test strategy

- phax and the package each refuse a run-status stamped newer than themselves, naming run-status, the stamp, their own release and themselves to upgrade to that release or later — small · example · the spec §6 refusal strings · in-phase · AC-newer
- any newer stamp is refused naming that stamp as the release to upgrade to, whatever the body — small · property · the refusal names the stamp's release · in-phase · AC-newer
- with the floor set to 2.0.0, a phase-status stamped 1.4.0 is refused naming phase-status, 1.4.0, the floor 2.0.0 and the 1.x line — small · example · the spec §6 below-floor string · in-phase · AC-below
- lastLineReading names the line before the floor raise, null at or above the floor, and first below the first floor ever — small · boundary · hand-computed lines for stamps at, just below and just above each floor · in-phase · AC-below
- both readers report the floor as 0.17.0 and read a phase record manifest stamped 0.17.0 and a registry without $schema — small · example · FIRST_SUPPORTED_RELEASE, FLOOR_HISTORY and the read values · in-phase · AC-floor-one
- the generated FLOOR_HISTORY and phax's FIRST_SUPPORTED_RELEASE match the record, and schemas-check reports drift — medium · example · generated modules against the record · in-phase

### Implementation order

1. released-shapes.json and its parser
2. FLOOR_HISTORY and FIRST_SUPPORTED_RELEASE generation
3. pure message and line helpers in schemaUrl.ts
4. the package's defineFormat
5. phax's persisted.ts
6. updated expectations and new tests

### Excluded scope

- The cut writing or checking the record (phase-08).
- RELEASED_SHAPES generation (phase-04).
- The shared-records-branch refusal (phase-03).
- Any change to which shapes phax reads (phase-04 and phase-05).

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

- The record's exact JSON layout and the `ReleasedShapes` type.
- The names of the generated constants in each generated module.
- The helper signatures in `src/schemas/schemaUrl.ts`.
- Where phax's readers apply the floor check.
- Every test or corpus file whose captured wording changed.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(schemas): refuse newer and below-floor stamps with their remedy`

### Commit body

Both readers now refuse a document stamped newer than themselves with the remedy to upgrade to that release or later, naming the format by its id. They refuse a document below their floor by naming the floor and the release line that still reads it, read from a floor history.

The floor history and each format's released shapes live in packages/schemas/released-shapes.json, seeded from the snapshots. From now on only the release cut writes it, and schemas-check generates FLOOR_HISTORY from it into the package and into src/schemas/release.ts, together with phax's FIRST_SUPPORTED_RELEASE. Today the floor is 0.17.0, and every document that read before still reads.

---

## phase-03 — Refuse a records read when records are newer than phax {#phase-03-mixed-records}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

A command reading records from `phax/records/v1` that meets records stamped newer than the running phax refuses as a whole and lists nothing. Its one line names how many records are newer and the newest release they need, instead of silently skipping them.

### Detailed instructions

- In `src/schemas/persisted.ts`, export a pure `newerStamp(input: unknown): { readonly formatId: string; readonly release: string } | null`: the format and release of a `$schema` newer than `PHAX_RELEASE`, else null. Use `parseSchemaUrl` and `compareReleases`, and reuse it inside `newerManifestReader` so there is a single test.
- In `src/domain/errors.ts`, add `RecordsNewerThanPhaxError` (`count`, `newest`, `running`). Its message is `<n> records on phax/records/v1 are newer than this phax (<running>), the newest at <newest> — upgrade phax to <newest> or later` (`1 record … is newer` for one). It is not in any exit-code group, so `exitCodeForError` gives 1, matching spec §6's `$? = 1`. Add a pure `summarizeNewerRecords(releases: readonly string[])` next to it, or in `src/domain/records/` if that is the domain's place for records logic, returning `{ count, newest } | null`.
- `src/app/recordsList.ts`: walk every `record.json` as today. Before decoding each, call `newerStamp`; collect the releases. When any is newer, fail with `RecordsNewerThanPhaxError` and list nothing. Records that are unreadable for any other reason are still skipped as today.
- `src/app/recordsExplain.ts`: when the explained record's manifest, or any record it reads, is stamped newer, fail with the same error, counting the newer records it met.
- `src/app/findingFateRecords.ts` (behind `phax finding list` and the fate history): any fate record stamped newer fails the read with the same error instead of being skipped or failing on its own.
- Make sure the CLI renders the error as one `✗ …` line, through the existing error rendering, with no business logic in `src/cli/`. Update a command's help text only when it describes skipped records.
- Tests in a new `tests/integration/recordsNewer.test.ts`, each in its own temporary repository, never a real home:
  - a records branch holding readable records plus three records stamped at a release computed as the next major after `PHAX_RELEASE` (never written literally): `phax records list` fails, lists nothing, and the message names 3 and that release;
  - `phax records explain` on a newer record does the same.

  A small table test for `summarizeNewerRecords` covers counts, newest-of-several and the singular wording. Build fixtures with the existing records-branch helpers that the records-explain integration tests use.

### Planned files to create

- `tests/integration/recordsNewer.test.ts`

### Planned files to edit

- `src/schemas/persisted.ts`
- `src/domain/errors.ts`
- `src/app/recordsList.ts`
- `src/app/recordsExplain.ts`
- `src/app/findingFateRecords.ts`

### Optional files that may be edited

- `src/cli/definitions/records.ts`
- `src/cli/definitions/recordsExplain.ts`
- `src/cli/definitions/finding.ts`
- `tests/integration/recordsExplain.test.ts`
- `tests/integration/findingFateRecords.test.ts`
- `tests/unit/persisted.test.ts`

### Boundary contracts

The records use cases (consumers) need, for each manifest they read, whether it is stamped newer than phax and at which release. `src/schemas/persisted.ts` produces that through `newerStamp`, a pure read of the stamp that never decodes the body. The use cases turn the collected releases into one domain error the CLI prints unchanged.

### Test strategy

- phax records list on a branch with three records stamped newer exits non-zero, lists nothing, and names 3 and the newest release to upgrade to — medium · example · exit code, empty listing and the refusal text · in-phase · AC-mixed
- phax records explain on a newer record refuses with the same count-and-release line — medium · example · the refusal text · in-phase · AC-mixed
- summarizeNewerRecords counts the newer releases and picks the newest, and the message is singular for one record — small · table · hand-written release lists and expected summaries · in-phase

### Implementation order

1. newerStamp in persisted.ts
2. the domain error and summary
3. recordsList, recordsExplain and findingFateRecords
4. tests

### Excluded scope

- Reading the fields an older phax knows of a newer record (q-newer: refuse).
- Skipping and naming newer records instead of refusing (q-mixed: refuse-command).
- Rewriting or migrating any record on phax/records/v1.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

- The `newerStamp` signature.
- The error class name and its message template.
- Exactly which commands now refuse on newer records.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(records): refuse a records read when records are newer than phax`

### Commit body

phax records list, records explain and the finding fate reads used to skip a record.json stamped newer than the running phax, so the listing looked complete while missing the newest history. They now refuse the whole command and list nothing. One line names how many records are newer and the newest release to upgrade to, as decided in q-mixed.

---

## phase-04 — Read every run-folder shape and refuse resuming an older run {#phase-04-run-folder}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium
**Assignment reason:** Departs from the default to claude-opus-5-5: the phase introduces a second, any-shape reading path beside the run-driving readers and a new resume refusal across several layers, a split the repository's readers do not yet make for run-folder formats.

phax reads every durable run-folder shape from the floor up, lifting a fact the older shape never recorded to `{ "kind": "unknown" }` instead of refusing. `phax resume` refuses, with exit 12, a run whose in-flight files are stamped in an older shape, naming the releases that started it and both remedies, while `phax ls` still lists the run.

### Detailed instructions

- Create `src/schemas/unknownFact.ts` with `type Unknown = { readonly kind: "unknown" }`, `UNKNOWN` (frozen) and `isUnknown`, structurally identical to the package's marker in `packages/schemas/src/shapes.ts`. Do not import `packages/` from `src/`. Make `src/schemas/gateTimeLift.ts` use it instead of its local constant.
- Phase status, in `src/schemas/persisted.ts`:
  - Keep `readPhaseStatusFile` as the reader of everything that drives a run, unchanged.
  - Add `readAnyShapePhaseStatus(file, input)`, returning `{ shape: "current" | <release> | "pre-schema", status: AnyShapePhaseStatus }` where `AnyShapePhaseStatus` is `PhaseStatus` with `base: string | Unknown`. It follows the existing `PhaxPlanRead`/`AnyShapePhaxPlan` pattern.
  - It reads a pre-schema status, and one stamped 0.17.0–0.19.x through the frozen `src/schemas/history/phase-status/0.17.0.ts` decoder, with `base: UNKNOWN`, `mode: "headless"` and `stop: null`. It reads 0.20.0 and 0.26.0 as today. It never refuses a document valid in its shape at or above the floor.
  - The awaiting-review check stays.
- Gate attribution: add `readAnyShapeGateAttribution` for display reads. A pre-schema or 0.17.0 attribution with a `pending` step reads that step's result as `UNKNOWN`. Every other step and shape reads as `readGateAttributionFile` does. Writers (`writeRecord`, `fixLoop`, `gateAttribution`) keep the current reader. Switch `src/app/recordsExplain.ts` to the any-shape reader where it only displays.
- Find the reads behind `phax ls` and `phax status` that only display a run (start from `src/app/resolveRunInfo.ts` and `src/domain/runList.ts`). Where one of them reads phase status, switch it to the any-shape reader, so a run whose phase status lacks `base` still lists. Its unknown base is shown the way the command already shows a missing value.
- Generate `RELEASED_SHAPES` (format id → ascending release-named shapes from `packages/schemas/released-shapes.json`) into `src/schemas/release.ts`, through `renderReleaseModule` in `packages/schemas/build/generated.ts` and `scripts/schemas-check.ts`, with a check-mode drift finding.
- Add a pure `shapeReleaseRange(formatId, shape)` in `src/schemas/persisted.ts` or `src/schemas/release`-adjacent code. It returns the shape's own release and the next released shape of that format, or the current stamp when none is released after it. For `pre-schema` it returns `before 0.17.0`.
- `phax resume` (`src/app/resume.ts`): once the run is located, and before any phase is read to drive it, read the stamps of the run's `status.json`, its `phax-plan.json` and every phase's `status.json` that exists, the stamp only. When any is below its format's `CURRENT_STAMPS` (or pre-schema), fail with a new `RunStartedByOlderShapesError` in `src/domain/errors.ts`, mapped to exit 12 in `src/cli/commands/runLayers.ts`. Its message follows spec §6: `run <run> was started by phax <S> to a release before <N>, and its <format> is a <S> shape; phax <PHAX_RELEASE> resumes only runs in its own shapes`, then on a second line `  finish it with phax <S> to a release before <N>, or archive it (phax archive <run> --force) and run its plan again`. The existing `loadPlan` refusal stays for `phax validate --plan`. Update `phax resume`'s help text for exit 12.
- If a test holds the usage spec or the CLI docs in step with help texts, regenerate them with `pnpm gen:usage-spec` and `pnpm docs:cli`, and name the regenerated files in the handoff.
- Property registry (`tests/helpers/property/formatRegistry.ts`):
  - point phase-status's phax reader at the any-shape reader;
  - remove the `packageOnly` reasons on its pre-schema and 0.17.0 frozen shapes;
  - remove the `stepsPassOrFail` repair from gate-attribution's pre-schema and 0.17.0 shapes, with its phax reader the any-shape reader.

  The properties `reads every frozen shape` and `reaches the schemas package's verdict` must then hold for those shapes.
- Tests:
  - `tests/unit/schemas/anyShapeRunFolder.test.ts`: one fixture per older phase-status shape and a pending-step attribution, with expected lifted values; the base and the pending result equal the package's `toLatestPhaseStatus`/`toLatestGateAttribution` facts; `UNKNOWN` deep-equals the package's.
  - `tests/integration/resume.test.ts`: an in-flight run whose phase-status is stamped in an older shape exits 12 with the message and both remedies, `phax ls` still lists it, and no file of the run folder changed (bytes compared before and after).

### Planned files to create

- `src/schemas/unknownFact.ts`
- `tests/unit/schemas/anyShapeRunFolder.test.ts`

### Planned files to edit

- `src/schemas/persisted.ts`
- `src/schemas/gateTimeLift.ts`
- `src/schemas/release.ts`
- `packages/schemas/build/generated.ts`
- `scripts/schemas-check.ts`
- `src/app/resume.ts`
- `src/app/recordsExplain.ts`
- `src/domain/errors.ts`
- `src/cli/commands/runLayers.ts`
- `src/cli/definitions/resume.ts`
- `tests/helpers/property/formatRegistry.ts`
- `tests/integration/resume.test.ts`

### Optional files that may be edited

- `src/app/resolveRunInfo.ts`
- `src/domain/runList.ts`
- `src/cli/definitions/ls.ts`
- `src/app/loadPlan.ts`
- `src/app/loadReviewHandoffInputs.ts`
- `tests/unit/persisted.test.ts`
- `tests/unit/property/persistedFormats.property.test.ts`
- `tests/integration/recordsExplain.test.ts`
- `tests/unit/releaseCut.test.ts`
- `tests/unit/schemasPackage/snapshots.test.ts`

### Boundary contracts

Display use cases (`phax ls`, `phax records explain`) need a run's files read whatever their shape. `src/schemas/persisted.ts` provides `readAnyShapePhaseStatus` and `readAnyShapeGateAttribution`, whose values carry `Unknown` (from `src/schemas/unknownFact.ts`) for facts never recorded. Run-driving use cases keep the current readers. `phax resume` (consumer) needs to know, before driving, whether any in-flight file is older. It reads stamps and `RELEASED_SHAPES` and fails with a domain error that the CLI maps to exit 12.

### Test strategy

- a pre-schema or 0.17.0–0.19.x phase status reads with base unknown, mode headless and stop null, and 0.20.0 and 0.26.0 read as before — small · table · one fixture per frozen shape and the package's toLatestPhaseStatus · in-phase · AC-durable-phax
- an older attribution with a pending step reads with that step's result unknown — small · example · the expected lifted attribution · in-phase · AC-durable-phax
- phax's unknown marker equals the schemas package's UNKNOWN — small · example · deep equality · in-phase
- resuming an in-flight run whose phase-status is stamped in an older shape exits 12, naming the releases that started it and both remedies, while phax ls still lists the run — medium · example · exit code, refusal text and the ls listing · in-phase · AC-resume
- reading an older run folder rewrites no file — medium · example · file bytes before and after · in-phase · AC-durable-phax
- every generated phase-status and gate-attribution document of a frozen shape reads in phax as in the package — small · property · the schemas package's verdict, on the harness's fixed seed · in-phase · AC-durable-phax

### Implementation order

1. src/schemas/unknownFact.ts
2. any-shape readers in persisted.ts
3. RELEASED_SHAPES generation and shapeReleaseRange
4. the resume refusal and its exit code
5. display callers switched
6. registry and tests

### Excluded scope

- Resuming a run across a shape change (spec non-goal).
- Spec and plan sidecars (phase-05).
- Answer formats (phase-09 guards them).
- Changing any persisted shape.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

- The any-shape reader names and their result types.
- The `RunStartedByOlderShapesError` message template.
- The `RELEASED_SHAPES` layout.
- Which display callers now use the any-shape readers.
- Any regenerated usage spec or CLI docs.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(run): read every run-folder shape and refuse resuming an older run`

### Commit body

phax now reads a phase status with no base (pre-schema, 0.17.0 to 0.19.x) and an older attribution with a pending step, lifting each fact never recorded to { kind: "unknown" } in an any-shape value. phax ls and records explain use that value, while the readers that drive a run stay at the current shape.

phax resume refuses with exit 12 a run whose in-flight files are in an older shape. It names the range of releases that wrote that shape, from the new generated RELEASED_SHAPES, and the two remedies: finish it with that release, or archive it and run its plan again.

---

## phase-05 — Lift every older spec and plan sidecar without refusal {#phase-05-sidecar-lifts}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium
**Assignment reason:** Departs from the default to claude-opus-5-5: the phase reshapes the plan sidecar's lift result that six modules consume, keeping every writer's refusals byte for byte while the read itself becomes total.

phax reads every spec and plan sidecar shape from the floor up without refusing. A fact the older shape never recorded, or cannot carry into the current one, is lifted to `{ "kind": "unknown" }` or kept as written, and the commands that rewrite sidecars still refuse exactly the artifacts they refused before.

### Detailed instructions

- In `src/schemas/persisted.ts` (`readPlanDocumentSidecar`), make the plan lift total:
  - a plan stamped 0.17.0–0.19.x is read through the frozen `src/schemas/history/plan-document/0.17.0.ts` decoder with `completesSpec: UNKNOWN`, then stepped as 0.20.0 is;
  - a pre-schema plan beside a source spec gets `completesSpec: UNKNOWN` instead of a refusal;
  - a phase whose test strategy departs from the test-line grammar gets `testStrategy: UNKNOWN`, keeping the departure (phase, line, text) in the read result;
  - a path that is not canonical is kept as written, recorded in the read result with its phase, list and problem (`planPathLiftMessage`'s facts), and never refused.
- Replace the `refused` and `refused-path` variants of `PlanDocumentLift` with one lifted result: `{ kind: "lifted", document: AnyShapePlanDocument, gaps: readonly PlanLiftGap[] }`, where `AnyShapePlanDocument` is `PlanDocument` with `completesSpec: boolean | null | Unknown` and each phase's `testStrategy: TestLine[] | Unknown`. A gap is one of three facts, `completes-spec`, `test-strategy` (phase, line, text) or `plan-path` (phase, list, written, problem), so writers can name it. `src/schemas/acceptanceLift.ts` may need the same change in `liftPlanDocument`.
- Spec sidecars already lift totally. Keep the surface summary placeholder as phax's in-memory spelling of an unknown summary, and say so in the reader's comment.
- Adapt every consumer so its behaviour does not change in this phase:
  - `src/domain/artifact/sidecar.ts` (inspect, agreement);
  - `src/domain/artifact/documentMigration.ts`: still refuses a gap with today's messages and remedies;
  - `src/app/headlessWriter.ts`: still refuses a sidecar that is not current;
  - `src/app/artifactStatus.ts`, and `src/app/unmigratedDocuments.ts` if it reads lifts.

  Only reading stops refusing here; phase-06 changes what the commands do. Rendering a phase whose test strategy is `Unknown` is never needed in this phase, because every renderer is reached only from a current or gap-free document. Make that a type-level fact, not a runtime throw.
- Update `olderDocumentStamp` and `readDocumentSidecar`'s doc comments to the new reading rules.
- Property registry: remove the `packageOnly` reason on plan-document 0.17.0 and the `preSchemaPlanHasNoSourceSpec` repair. Collapse the plan document's `readFile` vs `read` distinction if the lift can no longer be refused. `reads every frozen shape` and `reaches the schemas package's verdict` must hold.
- Tests in a new `tests/unit/schemas/anyShapeSidecars.test.ts`:
  - one plan fixture per frozen shape from pre-schema to 0.33.0, including a 0.17.0 plan and a pre-schema plan beside a spec, with `completesSpec` unknown where never recorded;
  - a 0.32.0 plan with a departing test line reads with that phase's strategy unknown and a gap naming the line;
  - a 0.33.0 plan with a non-canonical path reads with the path as written and a gap;
  - the lifted facts match the package's `toLatestPlanDocument` (it keeps paths as written and gives `UNKNOWN` testStrategy and completesSpec).

  Keep the existing refusal tests of `migrate-documents` and the headless writer green.

### Planned files to create

- `tests/unit/schemas/anyShapeSidecars.test.ts`

### Planned files to edit

- `src/schemas/persisted.ts`
- `src/domain/artifact/sidecar.ts`
- `src/domain/artifact/documentMigration.ts`
- `src/app/headlessWriter.ts`
- `tests/helpers/property/formatRegistry.ts`
- `tests/integration/planPathPersisted.test.ts`

### Optional files that may be edited

- `src/schemas/acceptanceLift.ts`
- `src/app/artifactStatus.ts`
- `src/app/unmigratedDocuments.ts`
- `tests/unit/artifact/documentMigration.test.ts`
- `tests/unit/planPathFormats.test.ts`
- `tests/unit/persisted.test.ts`
- `tests/helpers/liftFixturePhaxPlan.ts`
- `tests/unit/property/persistedFormats.property.test.ts`

### Boundary contracts

`src/schemas/persisted.ts` produces, for any sidecar, a lifted document plus a list of typed gaps, and never a refused read. Consumers in `src/domain/artifact/` and `src/app/` that write a current-shape document need those gaps named precisely (phase, fact, line or path). Consumers that only display need the document. The `Unknown` marker is the one from `src/schemas/unknownFact.ts`.

### Test strategy

- a plan sidecar of every frozen shape from pre-schema up reads, with completesSpec unknown wherever the shape never recorded it — small · table · one fixture per shape and its expected lifted document · in-phase · AC-durable-phax
- a departing test line lifts its phase's strategy to unknown, and a non-canonical path stays as written, each recorded as a gap, never a refused read — small · example · the expected lifted document and gaps · in-phase · AC-lift
- phax reads every generated plan-document of a frozen shape as the schemas package does, 0.17.0 and a pre-schema plan beside a spec included — small · property · the schemas package's verdict, on the harness's fixed seed · in-phase · AC-durable-phax
- migrate-documents and the headless writer refuse the same artifacts, with the same messages, as before this phase — medium · example · the existing refusal tests, unchanged · in-phase

### Implementation order

1. the lifted result type and gaps in persisted.ts
2. sidecar.ts and documentMigration.ts adapted
3. headlessWriter and artifactStatus adapted
4. registry and tests

### Excluded scope

- Removing the migrate-documents refusals or changing what decide, revise, approve or reopen do (phase-06).
- Any change to the current plan-document or spec-document shapes.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

- The new `PlanDocumentLift` shape.
- `AnyShapePlanDocument` and `PlanLiftGap`, with their module paths.
- How each consumer now reads gaps.
- Confirmation that every refusal message is unchanged.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(artifacts): lift every older spec and plan sidecar without refusal`

### Commit body

Reading a plan sidecar no longer refuses:
- a plan from 0.17.0 to 0.19.x, or a pre-schema plan beside a spec, reads with completesSpec unknown;
- a phase whose test strategy departs from the grammar reads with that strategy unknown;
- a path that is not canonical is kept as written.

Each is recorded as a typed gap, so the commands that write a current-shape sidecar can still refuse it, by name, exactly as before.

---

## phase-06 — Drop the one-time document migration step {#phase-06-no-document-step}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium
**Assignment reason:** Departs from the default to claude-opus-5-5: the phase changes the approval, decide and revise lifecycle across app, domain and CLI, and redefines the document upgrade under a no-changed-answer rule that no code in the repository enforces yet.

approve, reopen, decide and revise run on an artifact whose sidecar is stamped in an older shape at or above the floor, without asking for `phax artifact migrate-documents`. That command becomes the non-blocking document upgrade of §5.11: it rewrites only what it can without changing any other command's answer.

### Detailed instructions

- Remove the repository-wide refusal: delete `refuseUnmigratedDocuments` and its calls in `src/app/artifactStatus.ts` (`transitionArtifact` and the arbiter path), delete `DocumentMigrationRequiredError` from `src/domain/errors.ts` and its exit-code mapping in `src/cli/commands/runLayers.ts`, and keep `scanLiveSidecars` only if `migrate-documents` still uses it. If `src/app/unmigratedDocuments.ts` ends up empty, delete it.
- Approve and reopen accept an older sidecar whose body is its own-shape rendering, compared as `migrate-documents` compares today (in sync). They never rewrite the sidecar. A diverged or invalid sidecar is refused as today, with `sidecarRemedy`, and never names a migration. Approving an older sidecar does not bypass the run's own checks: `phax run` still reads plan.md and refuses a non-canonical path at extraction.
- Decide and revise (`src/app/headlessWriter.ts` and whatever decide and revise call to load the sidecar): an older sidecar in sync with its own shape is lifted. Then the computable gaps are filled:
  - a plan's `completesSpec` from its frontmatter `completes-spec`, or `null` beside `source-spec: null`;
  - a non-canonical path from `readPlanPath`'s canonical form when it has one.

  Written to q-unknown-write's recommendation (`keep-older`), any gap still open refuses that one artifact by name, through the existing refusal type, naming the phase, the fact (the departing line and its text, the path and its problem, or `completesSpec`) and the edit to make in plan.md and its sidecar. Nothing names `migrate-documents`. Otherwise the command proceeds and writes the current shape as it does today.
- `phax artifact status`: an older sidecar's agreement is in sync or diverged against its own-shape rendering. The published `artifact-status` shape does not change; the variant that named an older shape is no longer produced. In `src/cli/definitions/artifactStatus.ts`, drop the `migrate with phax artifact migrate-documents` text and the help sentence about older sidecars.
- `phax artifact migrate-documents` becomes the non-blocking upgrade (`src/domain/artifact/documentMigration.ts`, `src/app/migrateDocuments.ts`, `src/domain/artifact/render.ts`):
  - for each live older sidecar in sync with its own shape, fill the computable gaps;
  - rewrite the sidecar at the current shape only when no gap remains and `renderCurrent` of the lifted document equals the artifact's body as it stands (compared as agreement compares);
  - never write an `.md`;
  - otherwise keep it, listing it on stdout with why: the body's rendering moved, an open gap named as decide would name it, or the body is not its own-shape rendering;
  - also rewrite older plan and spec approval records (0.19.0, 0.25.0) at their current shapes with the facts their lifts compute (`approvedBy: unattributed`, `code: null`);
  - commit what it rewrote with the existing subject;
  - exit 0 when it kept some and rewrote none.

  It keeps refusing when the old approval ledgers are present only until phase-07 removes that step: leave `refuseOldApprovalLedgers` in it untouched here.
- Help texts: `src/cli/definitions/artifactMigrations.ts` says the command is optional, that no command waits for it, and that every command answers the same whether it ran or not. Drop `migrate-documents` mentions from `artifactDecide.ts`, `artifactRevise.ts` and `artifactTransitions.ts`. Regenerate the usage spec and CLI docs if a test holds them in step (`pnpm gen:usage-spec`, `pnpm docs:cli`).
- Tests:
  - `tests/integration/olderSidecarNoStep.test.ts`: a temporary repository whose plan sidecar is stamped 0.33.0 (canonical paths), in sync. `phax artifact approve`, `reopen`, `decide` (with an open question, through the existing fake session layer the decide integration tests use) and `revise` each complete, and no output names `migrate-documents` or any other step.
  - A decide on a 0.32.0 plan holding a departing test line refuses that artifact only, naming the phase and the line.
  - `tests/integration/documentUpgrade.test.ts`: a repository with older spec and plan sidecars, 0.19.0 approval records and a records branch. `phax artifact status` (text and `--json`), `phax plans lint` and `phax records list` give identical output before and after `migrate-documents`, the records branch tip is unchanged, and no output names the upgrade before it ran. It rewrote only the sidecars whose body was already their current rendering, plus the approval records, and named the rest as kept.
  - Update `tests/integration/migrateDocuments.test.ts` and `tests/unit/artifact/documentMigration.test.ts` to the new behaviour.

### Planned files to create

- `tests/integration/olderSidecarNoStep.test.ts`
- `tests/integration/documentUpgrade.test.ts`

### Planned files to edit

- `src/app/artifactStatus.ts`
- `src/app/unmigratedDocuments.ts`
- `src/app/headlessWriter.ts`
- `src/app/migrateDocuments.ts`
- `src/domain/artifact/documentMigration.ts`
- `src/domain/artifact/render.ts`
- `src/domain/errors.ts`
- `src/cli/commands/runLayers.ts`
- `src/cli/definitions/artifactMigrations.ts`
- `src/cli/definitions/artifactStatus.ts`
- `src/cli/definitions/artifactTransitions.ts`
- `src/cli/definitions/artifactDecide.ts`
- `src/cli/definitions/artifactRevise.ts`
- `tests/integration/migrateDocuments.test.ts`
- `tests/unit/artifact/documentMigration.test.ts`

### Optional files that may be edited

- `src/domain/artifact/sidecar.ts`
- `src/app/approvalRecordStore.ts`
- `src/app/reviseArtifact.ts`
- `src/app/decideVerdicts.ts`
- `tests/integration/headlessWriter.test.ts`
- `tests/integration/artifactStatus.test.ts`
- `tests/integration/artifactStatusJson.test.ts`
- `tests/integration/artifactTransitionsJson.test.ts`
- `tests/unit/cli/artifactStatusRender.test.ts`

### Boundary contracts

The artifact lifecycle use cases (approve, reopen, decide, revise, status, migrate-documents) consume the total lift and its gaps from `src/schemas/persisted.ts` (phase-05). Each decides only for its own artifact: a writer fills computable gaps and refuses that one artifact on an open gap, and readers compare against the own-shape rendering. No use case scans the whole repository to refuse. The published `artifact-status` answer keeps its shape.

### Test strategy

- approve, reopen, decide and revise complete on a plan whose sidecar is stamped 0.33.0, and none names migrate-documents or another step — medium · example · exit codes, written files and output text · in-phase · AC-no-step
- decide on an older plan whose test strategy keeps a departing line refuses that artifact alone, naming the phase and the line — medium · example · the refusal text and an unchanged tree · in-phase
- artifact status, plans lint and records list answer the same before and after migrate-documents, and phax/records/v1 is unchanged — medium · metamorphic · the two runs' outputs and the records branch tip · in-phase · AC-doc-upgrade
- migrate-documents rewrites a sidecar only when its body is already the current rendering, rewrites older approval records, never writes an .md, and names each kept sidecar — medium · example · files written and its output lines · in-phase · AC-doc-upgrade

### Implementation order

1. remove the repository-wide refusal and its error
2. approve and reopen on older sidecars
3. decide and revise fill gaps or refuse one artifact
4. artifact status agreement
5. migrate-documents as the non-blocking upgrade
6. help texts and generated usage docs
7. tests

### Excluded scope

- The old approval ledgers' migrate-approvals step (phase-07).
- Writing { kind: "unknown" } into a current-shape sidecar (q-unknown-write, unknown-in-shape).
- Rewriting any .md body or any record on phax/records/v1.
- Changing the artifact-status published shape.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

- The removed error and helpers.
- The exact wording of decide and revise's per-artifact refusal for each gap.
- What `migrate-documents` now prints for rewritten and kept artifacts.
- Which help texts changed, and any regenerated usage spec or CLI docs.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(artifacts): drop the one-time document migration step`

### Commit body

Approve, reopen, decide and revise no longer wait for phax artifact migrate-documents:
- approve and reopen take an older sidecar that is in sync with its own shape;
- decide and revise lift it, fill what they can compute (completes-spec from the frontmatter, a path's canonical form), and refuse that one artifact by name only for a fact they cannot.

migrate-documents becomes the non-blocking document upgrade. It rewrites a sidecar only when its body is already the current rendering, never touches an .md, rewrites older approval records with their computed facts, and names what it kept. Artifact status, plans lint and records list answer the same whether it ran or not.

---

## phase-07 — Read old approval ledgers without a migration step {#phase-07-old-ledgers}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

A repository that still holds the old approval ledgers (`plan-approvals`, `spec-approvals`) is read as it stands, with each artifact's approval taken from its ledger entry when it has no record file. Artifact status, the lifecycle commands, plan staleness and `migrate-documents` no longer refuse until `phax artifact migrate-approvals` has run.

### Detailed instructions

- This phase is written to q-approval-ledgers' recommendation (`include`). If the operator chooses `defer`, the phase is removed from the plan.
- In `src/app/approvalRecordStore.ts`, when an artifact has no approval record file, its approval record is read from the old ledger's entry for it (`readPlanApprovalsFile`/`readSpecApprovalsFile`, through their existing lifts), lifted as the package lifts it: `approvedBy: { kind: "unattributed" }`, and `code: null` for a plan. An artifact with a record file ignores the ledger. Keep the read pure apart from the file reads already behind the `FileSystem` port.
- Remove every call to `refuseOldApprovalLedgers` (`src/app/artifactStatus.ts` twice, `src/app/planStaleness.ts` twice, `src/app/migrateDocuments.ts`), then remove the function and `ApprovalLedgerMigrationRequiredError` together with its exit-code mapping.
- Approve and reopen write the artifact's record file as today; the ledger is never rewritten. `phax artifact migrate-approvals` becomes non-blocking: it writes the record files the ledger implies, with the same lifted facts, and removes the ledgers. Every command then answers the same as before it ran. Update its help text in `src/cli/definitions/artifactMigrations.ts` and regenerate the usage spec and CLI docs if a test holds them.
- Tests in a new `tests/integration/oldApprovalLedgerNoStep.test.ts`, each in a temporary repository holding a pre-schema plan ledger with an Approved plan and no record file:
  - `phax artifact status` reports the approval as unattributed;
  - `phax artifact approve` on another Draft plan and `phax artifact reopen` complete;
  - plan staleness runs;
  - no output names `migrate-approvals`;
  - the status of the ledger-approved plan is identical before and after `phax artifact migrate-approvals`.

### Planned files to create

- `tests/integration/oldApprovalLedgerNoStep.test.ts`

### Planned files to edit

- `src/app/approvalRecordStore.ts`
- `src/app/artifactStatus.ts`
- `src/app/planStaleness.ts`
- `src/app/migrateDocuments.ts`
- `src/app/migrateApprovals.ts`
- `src/domain/errors.ts`
- `src/cli/commands/runLayers.ts`
- `src/cli/definitions/artifactMigrations.ts`

### Optional files that may be edited

- `src/domain/artifact/approvalRecordFile.ts`
- `src/domain/artifact/lineage.ts`
- `tests/integration/artifactStatus.test.ts`
- `tests/integration/migrateDocuments.test.ts`

### Boundary contracts

Status, lifecycle and staleness use cases need one approval record per artifact. `src/app/approvalRecordStore.ts` produces it from the record file, or else from the old ledger's entry lifted to an unattributed record, so no consumer knows the ledger exists.

### Test strategy

- with an old approval ledger present, artifact status, approve, reopen and plan staleness run, and none names migrate-approvals — medium · example · exit codes and output text · in-phase
- an artifact approved only in the old ledger reports the same approval before and after migrate-approvals — medium · metamorphic · artifact status output of the two runs · in-phase · AC-doc-upgrade

### Implementation order

1. ledger fallback in approvalRecordStore
2. refusal calls and error removed
3. migrate-approvals made non-blocking
4. help text
5. tests

### Excluded scope

- Rewriting the old ledgers on any command other than migrate-approvals.
- Spec and plan sidecars (phase-06).

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

- The ledger fallback rule.
- The removed error.
- What `migrate-approvals` now does and prints.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(artifacts): read old approval ledgers without a migration step`

### Commit body

Artifact status, approve, reopen, plan staleness and migrate-documents used to refuse while an old approval ledger existed, until phax artifact migrate-approvals ran. An artifact without an approval record file now takes its approval from the ledger's entry, lifted as unattributed. migrate-approvals becomes a non-blocking upgrade that writes the same records and removes the ledgers, and changes no answer.

---

## phase-08 — Make the release cut hold the stability rules {#phase-08-release-cut}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium
**Assignment reason:** Departs from the default to claude-opus-5-5: the phase designs a JSON Schema comparator for removals (refs, unions, discriminants) and five new pre-write refusals in the release cut, with no existing code to follow.

`scripts/release.sh`'s cut refuses before writing anything when a changed format has no snapshot or no upgrading entry naming it, or when a non-breaking release would drop or rename a field, variant or value, raise the floor, stop reading a recorded shape, or retire a format with shapes at or above the floor. It records each release's shapes and the floor's history.

### Detailed instructions

- Add a pure `isBreakingRelease(release)` to `src/schemas/schemaUrl.ts`: from 1.0.0, minor and patch both 0; before 1.0.0, patch 0.
- Create `packages/schemas/build/shapeChanges.ts` with a pure `removedNames(previous: unknown, next: unknown): readonly Removal[]`, where `Removal = { kind: "field" | "variant" | "value"; path: string; name: string }`. It compares two draft-07 snapshots, resolving `$ref` into `$defs` (cycle-safe), and walks `properties`, `items`, `additionalProperties`, `patternProperties`, `anyOf` and `oneOf`:
  - a property name present before and absent now is a dropped field;
  - an `enum` member or `const` value gone is a dropped value;
  - a union member identified by a discriminant property whose schema is a `const` (such as `kind`, `state` or `result`) whose value is gone is a dropped variant.

  An added property, required or not, is no removal. Annotations are ignored, using `withoutAnnotations` from `equivalence.ts`.
- In `scripts/release-cut.ts`, after the existing refusals and before the notes or any write, collect every finding and throw them all, one `✗` line each:
  1. Changed formats are those with `snapshots/<id>/next.schema.json`. When any exists, the `### <version>` entry of `docs/upgrading.md` must exist and name each changed id as an inline code span. Export the entry reader from `scripts/releaseNotes.ts` and match on code spans of the mdast tree. Wording: `<version> changes the shape of <id>, but the ### <version> entry of docs/upgrading.md does not name `<id>``. With no entry at all: `… but docs/upgrading.md has no ### <version> entry`. With no changed format, a missing entry stays the existing warning.
  2. A format whose generated schema differs from its latest released snapshot with no `next` (reuse `readSchemasState` and `checkSnapshots`): `<id>'s current shape has no snapshot — run pnpm exec tsx scripts/schemas-check.ts --write`.
  3. When `!isBreakingRelease(version)`, for each changed format, `removedNames(latest released, next)`: `<version> is not a major release, yet its <id> shape drops the field `<name>` of <latest> — a field is removed or renamed only at a major`, with `variant` or `value` for the other kinds.
  4. Read `packages/schemas/released-shapes.json` (phase-02's parser). When the release is not breaking:
     - a snapshot-derived `FIRST_SUPPORTED_RELEASE` above the record's last floor gives `<version> is not a major release, yet it raises the floor from <old> to <new> — the floor moves only at a major`;
     - each recorded shape at or above the last floor (pre-schema counts as at the floor) whose snapshot is gone gives `<version> is not a major release, yet it stops reading <id> <shape> — the floor moves only at a major`;
     - each recorded format absent from `FORMAT_IDS` with a shape at or above the floor gives `<version> is not a major release, yet it retires <id>, whose shapes <list> are at or above the floor — the floor moves only at a major`.
- After the renames, the cut rewrites the record and lists it among the changed paths:
  - append `version` to each changed format's list, creating the entry for a new format;
  - at a breaking release whose snapshot-derived floor rose, append `{ since: version, floor }`, and drop shapes below the new floor and formats no longer in `FORMAT_IDS`;
  - `applySchemasWrite` then regenerates `FLOOR_HISTORY` and `RELEASED_SHAPES`.
- The opened version carries a `gate-attribution` `next` snapshot, and CI rehearses its cut on every pull request. Edit the `### 0.43.0` entry of `docs/upgrading.md` so its first bullet names the format id: **`gate-attribution` moves to a 0.43.0 shape** (`gate-attribution.json`, `checks-attempt-NN.attribution.json`), keeping the rest. Check `packages/schemas/snapshots/*/next.schema.json` at phase time and name any other changed format the same way.
- Update `docs/release.md`: the cut's refusals list gains the five refusals above. The warning paragraph says a missing entry is a refusal when shapes changed. Describe the released-shapes record and that only the cut writes it.
- Tests, all in scratch copies made the way `tests/unit/releaseCut.test.ts` makes them, never on the repository's own snapshots, with versions computed from the copy's ledger and never written as the opened version:
  - `tests/unit/schemasPackage/shapeChanges.test.ts`: a table of hand-written schema pairs (dropped property, renamed property, dropped enum member, dropped discriminated variant, an added required field, a `$ref`-held change, a description-only change).
  - In `tests/unit/releaseCut.test.ts`, each refusal asserts that the copy's tree hashes are unchanged:
    - a changed `gate-attribution` with an entry not naming it is refused, naming `gate-attribution` and the entry; with the entry naming it, the cut goes ahead;
    - a changed shape with no `next` is refused, naming the format;
    - a non-breaking copy (opened at the next patch after the ledger's last release) whose `phase-status` `next` drops `stop` is refused, naming `phase-status` and `stop`; the same change at the next major goes ahead, and a `next` that only adds a required field goes ahead at the patch;
    - a non-breaking copy that deletes the lowest release-named snapshots (floor raised), deletes one recorded `phase-status` shape, or holds a recorded made-up format absent from `FORMAT_IDS` is refused, naming the format and the shape; at a major it goes ahead and the record gains the floor entry;
    - a copy cut at 1.0.0 keeps `FIRST_SUPPORTED_RELEASE` and the record's floor at 0.17.0.
  - `isBreakingRelease` gets a table test.

### Planned files to create

- `packages/schemas/build/shapeChanges.ts`
- `tests/unit/schemasPackage/shapeChanges.test.ts`

### Planned files to edit

- `src/schemas/schemaUrl.ts`
- `scripts/release-cut.ts`
- `scripts/releaseNotes.ts`
- `packages/schemas/build/releasedShapes.ts`
- `tests/unit/releaseCut.test.ts`
- `docs/release.md`
- `docs/upgrading.md`

### Optional files that may be edited

- `scripts/schemas-check.ts`
- `scripts/release-notes.ts`
- `packages/schemas/build/snapshots.ts`
- `tests/unit/releaseNotes.test.ts`
- `tests/unit/releaseOpen.test.ts`
- `tests/unit/schemas/stampRefusals.test.ts`

### Boundary contracts

The cut (consumer) needs, before writing, every rule breach between the tree and what was released. Pure producers supply them: `removedNames` (snapshots), `checkSnapshots` (generated vs released), the upgrading entry reader (`scripts/releaseNotes.ts`), the released-shapes parser and `isBreakingRelease`. The cut stays the only writer of `packages/schemas/released-shapes.json`.

### Test strategy

- the comparator names a dropped or renamed property, a dropped enum member and a dropped discriminated variant, and nothing for an added required field or a description-only change — small · table · hand-written schema pairs and their expected removals · in-phase · AC-add-only
- a cut whose changed gate-attribution is not named by the release's upgrading entry refuses before writing, naming the format and the entry, and goes ahead once the entry names it — medium · example · refusal text and the copy's file hashes before and after · in-phase · AC-note
- a cut in which a format's current shape has no snapshot refuses before writing, naming the format — medium · example · refusal text and unchanged file hashes · in-phase · AC-snapshot
- a non-major cut whose phase-status shape drops stop refuses naming phase-status and stop, while the same change at a major, or an added field at the patch, goes ahead — medium · example · refusal text, unchanged hashes, and the completed cut's renamed snapshots · in-phase · AC-add-only
- a non-major cut that raises the floor, drops a recorded shape or retires a recorded format refuses naming the format and the shape, while a major goes ahead and records the new floor — medium · example · refusal text, unchanged hashes, and the record after a major cut · in-phase · AC-floor-moves
- a cut at 1.0.0 keeps the floor at 0.17.0 in the generated index and the record — medium · example · FIRST_SUPPORTED_RELEASE and the record's floors · in-phase · AC-floor-one
- isBreakingRelease follows the spec's breaking-release rule before and after 1.0.0 — small · table · spec §4's definition, case by case · in-phase

### Implementation order

1. isBreakingRelease
2. shapeChanges comparator and its table test
3. the cut's refusals, all collected before any write
4. the record's update after the renames
5. the 0.43.0 upgrading entry and docs/release.md
6. release-cut tests in scratch copies

### Excluded scope

- Running scripts/release.sh, publishing, or reading a git tag from the cut.
- Judging a type narrowing or a tightened pattern as a removal.
- Deciding where a future 2.0.0 puts its floor.

### Verification

The `standard` gate profile in phax.json. CI's rehearsal of the 0.43.0 cut must still pass, so the `### 0.43.0` entry names every changed format.

### Expected handoff content

- The refusal strings.
- The `Removal` type.
- How the cut updates the record at a non-breaking and at a breaking release.
- The exact edit to the `### 0.43.0` entry, and any other format named there.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(release): refuse a cut that breaks the format stability rules`

### Commit body

The release cut now refuses, before writing anything:
- a changed format with no snapshot, or with no upgrading entry naming it;
- in a non-breaking release, a shape that drops or renames a field, variant or value;
- in a non-breaking release, a raised floor, a recorded shape no longer read, or a retired format with shapes at or above the floor.

It appends each release's shapes, and at a major any new floor, to packages/schemas/released-shapes.json. The 0.43.0 upgrading entry now names gate-attribution, so the rehearsed cut passes.

---

## phase-09 — Hold the readers to the promise in property and guard tests {#phase-09-promise-properties}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

Generated documents prove that the package reads every durable and published shape since the floor, that phax reads every durable one, and that every lift is total. A guard holds each answer reader to one shape before 1.0.0 and fails at an opened 1.0.0, naming the 2026-10-08 provider answers rule.

### Detailed instructions

- In `tests/helpers/property/formatRegistry.ts`:
  - give each entry its class from `FORMAT_CLASSES`, and a `lift` (the package's `toLatest*` for the format, from `packages/schemas/src/index.ts`);
  - keep `packageOnly` only on answer-class frozen shapes, and assert that by construction or in the new guard below.
- New property file `tests/unit/property/stabilityPromise.property.test.ts`, using the harness's parameters and fixed seed so the gate never chases a moving counterexample. It imports only allowed roots (see `tests/unit/property/harnessConfig.test.ts`), with one `describe` per format id and these tests:
  - `lifts every frozen shape` (all formats): a stamped document of each frozen shape at or above the floor parses in the package as its own shape and lifts through `lift` without throwing;
  - `reads every durable shape in phax` (durable formats): phax's reader, the any-shape one where one exists, reads it;
  - `parses every published shape` (published formats): the package parses it as its own shape.

  The value lifted for a fact the shape never recorded is checked where a format's registry entry names such facts.
- A table guard in the same file or `tests/unit/property/formatRegistry` sanity tests: no durable or published format has a frozen shape whose readers are `package` only, and the failure names the format and the shape.
- Answer rule guard in a new `tests/unit/answerShapesRule.test.ts`:
  - a pure `answerShapesHeld(release, registry)` lists every answer-class format with a frozen shape at or above the floor that phax refuses (`packageOnly`);
  - a test at the running `PHAX_RELEASE`: when its major is below 1, the list is non-empty (the guard tests still hold each answer reader to one shape); when it is 1 or more, it fails if the list is non-empty, with a message naming the provider answers rule decided 2026-10-08 (NEXT_STEPS.md, Road to 1.0.0: from 1.0 an older answer is read through its frozen shape and lifted) and each format;
  - example tests call the function at `1.0.0` and at a 0.x release and assert those messages.

  No test names the opened version.
- Update `docs/property-tests.md`: list the new properties and the guard under What is covered, with the reporter names Vitest prints.

### Planned files to create

- `tests/unit/property/stabilityPromise.property.test.ts`
- `tests/unit/answerShapesRule.test.ts`

### Planned files to edit

- `tests/helpers/property/formatRegistry.ts`
- `docs/property-tests.md`

### Optional files that may be edited

- `tests/unit/property/persistedFormats.property.test.ts`
- `tests/unit/property/harnessConfig.test.ts`
- `tests/helpers/property/harness.ts`

### Test strategy

- every frozen shape at or above the floor parses in the package as its own shape and lifts to the current one without refusal — small · property · no refusal and no throw from parse and toLatest, on a fixed seed · in-phase · AC-lift
- every durable format's generated documents in every shape from the floor read in the package and lift with its toLatest function — small · property · the package's parse and toLatest succeed, on a fixed seed · in-phase · AC-durable-package
- phax reads every durable format's generated documents in every shape from the floor — small · property · phax's reader succeeds where the package does, on a fixed seed · in-phase · AC-durable-phax
- every published format's generated documents in every shape from the floor parse in the package as their own shape — small · property · the shape the package names, on a fixed seed · in-phase · AC-published
- no durable or published format keeps a shape only the package reads — small · table · the registry's readers per frozen shape · in-phase · AC-durable-phax
- before 1.0.0 the answer readers are held to one shape, and at 1.0.0 the guard fails naming the 2026-10-08 provider answers rule and each format — small · example · answerShapesHeld at 1.0.0 and at a 0.x release · in-phase · AC-answer

### Implementation order

1. registry classes and lifts
2. the three properties
3. the class guard
4. the answer rule guard
5. docs/property-tests.md

### Excluded scope

- Reading older answer shapes in phax (from 1.0, under the 2026-10-08 rule).
- Any production code change: a property that fails names the reader to fix, and the fix belongs to phase-04 or phase-05.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

- The new test names as Vitest reports them.
- The `answerShapesHeld` signature and the answer formats it lists today.
- Any frozen shape the properties revealed that a reader still refuses, with where it was fixed.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`test(schemas): hold the readers to the stability promise`

### Commit body

Property tests on a fixed seed:
- every frozen shape at or above the floor lifts through the package without refusal;
- phax and the package read every durable shape;
- the package reads every published shape.

A guard keeps the shapes only the package reads to answer formats. Another holds each answer reader to its current stamp before 1.0.0, and fails at an opened 1.0.0 naming the 2026-10-08 provider answers rule.

---

## phase-10 — Keep configuration accepted within a breaking line {#phase-10-configuration}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium
**Assignment reason:** Departs from the default to claude-opus-5-5: the phase generalizes the retired-model tables across both configuration loaders and edits src/app/loadConfig.ts, a file later waves share, where a minimal and correct change matters more than speed.

A configuration file one release accepts stays accepted by every later release of its breaking line, and a test proves it. A key dropped at a breaking release is refused by name with what to write instead, and a model or effort the catalog retired is refused at any release, naming the model to write instead.

### Detailed instructions

- Create `src/domain/configCompatibility.ts` (pure):
  - `DroppedConfigKey = { file: "phax.json" | "phax.local.json" | "providers.json" | "model-routing.json"; path: string; since: string; writeInstead: string }`, `DROPPED_CONFIG_KEYS: readonly DroppedConfigKey[] = []` (empty today), and `droppedKeysIn(file, raw, table)`, which finds each dotted path present in the raw JSON;
  - the refusal line `<file>: "<path>" is no longer accepted since phax <since> — write "<writeInstead>" instead`;
  - `retiredModelRefusal(id, successor)`: `model "<id>" is no longer in the catalog — write "<successor>" instead`;
  - `retiredModelsInPhaxConfig(config, retired)`, walking every model value of a decoded phax config: the authoring, review, extraction and other model keys, and each assignment bound's model.
- Generalize today's retired-model tables (`RETIRED_MODEL_IDS`, `RETIRED_MODEL_SUCCESSORS` in `src/domain/routing/defaults.ts`) into one table of retired catalog ids, each with its successor (or null) and why, and keep their existing users working. A model is retired when it is in that table. An id that is neither in the catalog nor retired keeps today's behaviour, and phax.json's efforts are already a closed enum.
- In `src/app/loadConfig.ts` (the file shared with later waves; touch it only here):
  - on each raw `phax.json` and `phax.local.json`, run `droppedKeysIn` with the shipped table before strict decoding, and fail with `ConfigValidationError` naming the file and every finding;
  - after decoding, run `retiredModelsInPhaxConfig` and fail the same way.

  Keep the change to these two calls.
- In `src/app/loadRouting.ts`, `providers.json` and `model-routing.json` refuse a retired id with the same `retiredModelRefusal` line per id, keeping the routing-key move instructions and the `phax agent setup providers --write` remedy.
- Fixture: create `tests/fixtures/configAccepted/accepted.json`, a list of `{ name, file, document }` seeded from every accepted case (`expected.ok`) of `tests/behaviourCorpus/cases/config/*.json` plus this repository's `phax.json`, each tagged with the file kind it decodes as.
- Test `tests/unit/configAccepted.test.ts`: each entry passes its file's decode plus the new checks (pure decoders and checks, no file reads beyond the fixture). A refusal fails, naming the entry, the file and the first key, unless it is a retired-model refusal. The failure message says that a non-breaking release must accept every configuration its breaking line accepted (spec format-stability-promise §5.18), and that at a breaking release the fixture is reseeded by hand.
- Test `tests/unit/configCompatibility.test.ts`:
  - with an injected dropped-key table renaming a real phax.json key to a made-up one, a phax.json holding the old key is refused naming both;
  - with an injected catalog where the made-up `acme-large-2` is retired with successor `acme-large-3`, a phax.json naming `acme-large-2` (accepted before it was retired) is refused naming both;
  - the same for a providers.json entry;
  - with the shipped (empty) dropped-key table, nothing is refused.

### Planned files to create

- `src/domain/configCompatibility.ts`
- `tests/fixtures/configAccepted/accepted.json`
- `tests/unit/configAccepted.test.ts`
- `tests/unit/configCompatibility.test.ts`

### Planned files to edit

- `src/app/loadConfig.ts`
- `src/app/loadRouting.ts`
- `src/domain/routing/defaults.ts`

### Optional files that may be edited

- `src/domain/routing/providerSetup.ts`
- `tests/unit/routing/loadRouting.test.ts`
- `tests/unit/loadConfig.test.ts`
- `tests/integration/loadConfigLayers.test.ts`

### Boundary contracts

The configuration loaders (`src/app/loadConfig.ts`, `src/app/loadRouting.ts`) consume pure checks from `src/domain/configCompatibility.ts`: dropped keys on the raw JSON, retired models on the decoded value. The checks receive their tables as arguments, so tests inject made-up renames and retirements, and the loaders pass the shipped tables.

### Test strategy

- every configuration the frozen fixture holds is still accepted, unless refused for a retired model, and a refusal names the file and the key — small · table · the fixture's documents and their expected acceptance · in-phase · AC-config-accept
- with a key renamed at a breaking release, a phax.json holding the old key is refused naming the old key and the key to write instead — small · example · the refusal line · in-phase · AC-config-refuse
- a phax.json the previous release accepted that names the retired acme-large-2 is refused naming acme-large-2 and acme-large-3 — small · example · the spec §6 refusal line · in-phase · AC-retired-model
- providers.json and model-routing.json refuse a retired id with the same line and keep their remedies — small · example · the loaders' refusal text · in-phase · AC-retired-model

### Implementation order

1. configCompatibility.ts
2. the retired-model table generalized
3. loadRouting refusals
4. loadConfig's two calls
5. fixture and tests

### Excluded scope

- Stamping configuration with a release $schema (q-config: config-breaking-only).
- Freezing phax.json's version: 1.
- Any change to phax.schema.json or the config schemas themselves.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

- The pure checks' signatures.
- The generalized retired-model table.
- The exact lines `loadConfig.ts` gained.
- How to reseed the fixture at a breaking release.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(config): keep configuration accepted within a breaking line`

### Commit body

A frozen fixture of accepted configurations, seeded from the behaviour corpus, fails a test naming the file and key if a non-breaking release would refuse one.

A key dropped at a breaking release is refused by name with what to write instead, through a table that is empty today. A model the catalog retired is refused in phax.json, phax.local.json, providers.json and model-routing.json at any release, naming the model to write instead.

---

## phase-11 — Publish the format stability promise {#phase-11-docs}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

Anyone adopting phax 1.0 or reading its files with `@lbdremy/phax-schemas` finds, on one docs page linked from the README, `docs/upgrading.md` and the site's navigation, the rules by which phax's files and records change, what a reader stops reading and when, and what to do when a reader refuses a document.

### Detailed instructions

- Write `docs/format-stability.md` around the generated table, without touching the block between its markers:
  - the lede and the six numbered rules of spec §6 (stamped; both readers read from the floor, today 0.17.0, up to their release; the floor and a step commands wait for move only at a major; within a major a shape only adds, with fields an older document lacks computed or `unknown`; a shape change ships its snapshot and an upgrading entry naming the format; a document a reader cannot read is refused by name with its remedy, and on a shared `phax/records/v1` every reader must be as new as the newest writer);
  - a paragraph on the non-blocking document upgrade (`phax artifact migrate-documents`): what it rewrites, that it never touches `phax/records/v1` or an `.md`, and that every command answers the same whether it ran or not, set against a step commands wait for;
  - the sentence that a model or effort a provider retired can stop being accepted in a minor release, refused by name with the model to write instead, and that configuration otherwise stays accepted within a major;
  - a section What a refusal tells you, giving each refusal's text (newer document, below the floor, records branch, resume of an older run) and its remedy once;
  - the classes explained above the table;
  - spec §11's example: two teammates on 1.3.0 and 1.4.0 sharing `phax/records/v1`, with `phax records list` refused on 1.3.0, a script on the package refused the same way, and upgrading as the whole remedy.

  Follow the repository's docs style (short sentences, one idea per line where it helps).
- README.md: in the paragraph "A file stays readable as phax evolves", add a link to `docs/format-stability.md` and use the new package refusal wording ("upgrade the package to <release> or later"). Do not add a section: the site's page map pins README sections.
- docs/upgrading.md:
  - under Release by release, replace "phax never asks for a step silently: a command that needs one refuses with exit 12 and names it" with a sentence linking the format stability page and stating that a step commands wait for comes only with a major release;
  - in the `### 0.43.0` entry (which phase-08 made name `gate-attribution`), add bullets: approve, reopen, decide and revise no longer wait for `migrate-documents`, which becomes optional; old approval ledgers no longer need `migrate-approvals`; the newer-than refusals name the release to upgrade to; records commands refuse when records are newer; `phax resume` refuses an older run with exit 12; a retired model in configuration is refused naming its successor.

  Keep No step is needed in a repository.
- site/pages.ts: make sure the page's navigation entry from phase-01 sits where readers of Upgrading find it, and update its description if the page's scope changed.
- Extend `tests/unit/formatStability.test.ts` for the docs criterion:
  - README.md, docs/upgrading.md and site/pages.ts each link to the page (by path or route);
  - the page holds the six numbered rules, the non-blocking upgrade paragraph naming `migrate-documents`, and the retired-model sentence (asserted by key phrases);
  - the generated table still lists every format with its class.

### Planned files to create

- (none)

### Planned files to edit

- `docs/format-stability.md`
- `README.md`
- `docs/upgrading.md`
- `tests/unit/formatStability.test.ts`

### Optional files that may be edited

- `site/pages.ts`
- `NEXT_STEPS.md`
- `docs/release.md`
- `docs/property-tests.md`

### Test strategy

- README, docs/upgrading.md and the site's navigation link to the format-stability page, and the page states the six rules, the non-blocking upgrade versus a step, the retired-model rule, and every format with its class — small · example · the files' links and key phrases, and the generated table · in-phase · AC-docs
- the built docs site renders the page in its navigation — medium · smoke · the terminal gate's site build and its page-map checks · in-phase · AC-docs

### Implementation order

1. docs/format-stability.md prose
2. README link
3. docs/upgrading.md sentence and 0.43.0 bullets
4. site navigation check
5. the docs test

### Excluded scope

- Editing the generated table by hand.
- The CLI contract freeze, a separate 1.0 item.
- Ticking the NEXT_STEPS.md 1.0 item before the operator confirms the run.

### Verification

The `standard` gate profile in phax.json, including its terminal steps (build, site:build and the Deno smokes): this is the final phase.

### Expected handoff content

- The page's section headings.
- The exact links added.
- The bullets added to `### 0.43.0`.
- Anything in the page that the operator should check against the shipped refusal texts.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`docs: publish the format stability promise`

### Commit body

docs/format-stability.md states the six rules by which phax's persisted formats change from 1.0, the difference between a step commands wait for and the non-blocking document upgrade, the retired-model rule, and what each refusal asks of the reader, around the generated table of every format and its class.

The README, docs/upgrading.md and the site's navigation link to it, and the 0.43.0 upgrading entry lists what this release changed for users.
