---
status: Approved
source-spec: docs/specs/2610211432-surface-summary.md
completes-spec: true
approved:
  date: 2026-10-24
  baseline: ff2be76
---
# Surface summaries

Every surface element of a spec document gains a required, one-line `summary` in the consumer's words (surface-summary §5.1–§5.5). The spec-document 0.25.0 shape and its rendering are frozen, and the new shape is stamped at the open release, 0.27.0. `phax artifact migrate-documents` lifts live 0.25.0, 0.17.0 and pre-schema sidecars with a fixed summary placeholder (§5.7–§5.9). `phax artifact approve` and `complete` refuse a spec that still holds one (§5.10). The `phax-spec` skill, `docs/upgrading.md` (0.27.0), the README and `NEXT_STEPS.md` follow (§5.12, §5.13, §11).

The phases go inside out, each commit green:
- phase-01: the format, the freeze, the lift, the renderer, and the authoring and decide schemas.
- phase-02: the placeholder refusals and the migration report's count.
- phase-03: the skill and the docs.

Operator notes:
- Start the run with `phax run --allow-skill-edits`, as the brief asks. Only phase-03 edits a skill file, `.claude/skills/phax-spec/SKILL.md`, and it lists that exact file.
- The installed phax drives the run. Do not install a build of this branch before the run completes.
- The run does not migrate this repository's live sidecars (`headless-review`, `artifact-decide-verdicts`, `test-strategy`, and this spec itself). Other work may edit them on main while this plan runs. Once phase-01 lands, they are below the current shape on the branch. The installed 0.26.0 phax still reads spec-document 0.25.0 as current, so on main it migrates nothing and refuses nothing until a release ships this change. Decided by the operator on 2026-10-24: run `phax artifact migrate-documents` with the released 0.27.0 binary after the cut, then write each spec's summaries and re-approve what the report names. No phase can run it, because the phase guard refuses it in a worktree.
- The run's own completion of `surface-summary` still works. The run's archival commit moves this spec and its 0.25.0 sidecar to `docs/specs/archive/` byte for byte, and the placeholder refusal phase-02 adds reads only a sidecar at the current shape (see Technical arbitrations). phase-02 tests this in `tests/integration/completeRunArtifacts.test.ts`.

## Required commands

- (none)

No new command is needed. Phases run the `standard` gate profile's commands and commands `phax.json` already allows. `pnpm exec tsx scripts/schemas-check.ts --write` regenerates the schema snapshots, current stamps and history lock (covered by the `pnpm exec tsx` allowance). `pnpm gen:usage-spec` and `pnpm docs:cli` regenerate the CLI docs if a help text changes. `phax.json` needs no change. The run needs `phax run --allow-skill-edits`, because phase-03 edits `.claude/skills/phax-spec/SKILL.md`.

## Technical arbitrations

- Three phases, inside out, as the brief lays them out: the format with its freeze and lift, then the refusals and the report count, then the skill and the docs. The lift must land with the format: once the current shape requires `summary`, every reader of an older sidecar needs a value for it. No oracle pair is declared, even though an `oracles` provider is configured. Each acceptance criterion gets its own named in-phase test instead. Loss: the acceptance tests are written in the same session as the code, which could adjust them; the reviewer checks them against §8 by name.
- The summary placeholder is the one-line string `(summary to write — lifted by phax artifact migrate-documents)`. It is exported as `SURFACE_SUMMARY_PLACEHOLDER` from `src/schemas/specDocument.ts`, because the format's reader in `src/schemas/persisted.ts` writes it and schemas cannot import domain code. Placeholder detection lives in the pure domain module `src/domain/artifact/surfaceSummaries.ts` and matches by exact string equality. The current schema accepts the placeholder (q-lift's accepted loss). Loss: an author who writes that exact sentence as a summary is refused at approve and complete.
- §6 prints the summary as `Summary: <summary>`: its own paragraph, a blank line after the `### <surface> — <binding>` heading, before the `before:`/`after:` blocks or the indented `after` block. The key sits directly after `surface` in the element, in `properties` and in `required`. Loss: none beyond fixing the label's spelling. A hand edit that mistypes it in a headless spec diverges the body from its sidecar, which agreement already catches.
- `summary` is `Schema.String` with the pattern `^[^\n\r]+$` and a description annotation, not `Schema.NonEmptyString`. A `$ref` beside a `pattern` has its pattern ignored by draft-07 validators, so the one-line rule would not reach the exported schema. The pattern also rules out the empty string. Loss: a whitespace-only summary decodes. Presence and the one-line shape are all phax checks (§7).
- `phax artifact status` does not report how many summaries are still to write. Loss: an operator browsing status does not see the count. The migration report counts them per spec, and approve and complete name every element that still holds the placeholder.
- The placeholder refusal reads only a spec sidecar decoded at the current shape. A sidecar stamped below it (0.25.0, 0.17.0, pre-schema) holds no summary at all: the placeholders its in-memory lift carries are the reader's, not the file's, so they never refuse. Complete, abandon, stale and run completion keep carrying an older sidecar as they do today. So this run's own completion of `surface-summary` passes whichever phax applies it, and the installed 0.26.0 phax drives the run anyway. Loss: a spec completed before its repository is migrated reaches the archive with no summaries. The release-notes tooling must cope with archived specs without summaries anyway, since archived specs are never migrated (§5.11).
- The freeze follows the plan-document 0.25.0 path. That means a self-contained frozen schema module `src/schemas/history/spec-document/0.25.0.ts` pinned by `packages/schemas/history.lock.json`, a frozen renderer `src/domain/authoring/renderSpecV0_25_0.ts`, a `next` snapshot, and `CURRENT_STAMPS["spec-document"]` moving to 0.27.0. A sidecar stamped 0.25.0 or later, below the current stamp, is read by the 0.25.0 copy. One stamped below 0.25.0 keeps its 0.17.0 reading, and one written before `$schema` keeps its pre-schema reading. All three lift straight to the current shape, with every surface element's `summary` set to the placeholder. Loss: a third self-contained renderer copy, carrying its own question renderers.
- The schemas package never invents a fact. `toLatestSpecDocument` lifts an older element's summary as `Unknown` (`UNKNOWN`), not as the placeholder, mirroring how it lifts an unrecorded `completesSpec`. Its `LatestSpecDocument` type widens each surface element's `summary` to `string | Unknown`. Loss: package consumers handle the widened type, and phax's own reader and the package lift different values for the same older sidecar.
- The run leaves this repository's live sidecars untouched, as the brief settles, and the operator migrates them with the released 0.27.0 binary after the cut (decided 2026-10-24). Loss: until then the live specs carry no summaries, and a spec completed in the meantime is archived with none. The installed 0.26.0 phax reads their 0.25.0 sidecars as current, so nothing is refused in the meantime.
- On approve, the placeholder check runs after the sidecar agreement check (so only an in-sync, current-shape sidecar reaches it) and before the open-questions lock. On complete, it runs before anything is moved or written. Reopen, abandon and stale are never refused for a placeholder. Loss: an Approved spec with placeholders can still be abandoned, by design (§5.10 names approve and complete only).

---

## phase-01 — The surface summary in the spec document, with the 0.25.0 shape frozen and lifted {#phase-01-summary-format}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

Every surface element of a spec document requires a one-line `summary`. That holds in the headless authoring answer, in a sidecar at the current shape, and in the revised document a decide session returns, and every JSON Schema phax publishes or embeds says so. §6 prints the summary under each element heading. The spec-document 0.25.0 shape and its rendering are frozen, and older sidecars lift with the summary placeholder. So `phax artifact migrate-documents` restamps them at 0.27.0 and re-renders their §6 with placeholder lines.

### Detailed instructions

- Freeze the spec-document 0.25.0 shape. Create `src/schemas/history/spec-document/0.25.0.ts`, a self-contained module that imports only `effect`, like `src/schemas/history/plan-document/0.25.0.ts`. It reproduces exactly the sidecar shape `SpecDocumentFileSchema` in `src/schemas/specDocument.ts` decodes today, with its keys in today's order: the spec-document `$schema` URL field (copy the pattern and description `schemaUrlField("spec-document")` renders today), then every field of `specDocumentFields`, with the surface element `{ surface, binding, before, after }`. It also carries the spec question schemas (open questions; arbitrated questions with decided and lifted verdicts, without a plan's `phase`), plus the traceability and question checks the 0.25.0 file decoder ran, with their JSON Schema description annotation. Copy the question schemas and `firstQuestionViolation`'s logic from `src/schemas/questions.ts`, and never import them. Export `SpecDocumentV0_25_0Schema`, `type SpecDocumentV0_25_0` and `decodeSpecDocumentV0_25_0` (`onExcessProperty: "error"`). Write a header comment in the style of the plan-document 0.25.0 module: the sidecar phax 0.25.0 and 0.26.0 wrote; never edit this module, because `packages/schemas/history.lock.json` pins its bytes; only `src/schemas/persisted.ts` may import it in phax; the schemas package lists it as the format's 0.25.0 release. The JSON Schema it renders must equal `packages/schemas/snapshots/spec-document/0.25.0.schema.json`.
- In `src/schemas/specDocument.ts`, add `summary` to `SurfaceElementSchema`, directly after `surface`: `Schema.String.pipe(Schema.pattern(/^[^\n\r]+$/))`, annotated with the description "One sentence, in the consumer's words: what whoever consumes this element can now do or sees differently. Never where it lives or how it is built." Do not use `Schema.NonEmptyString`, and extend the existing comment: a `$ref` beside a `pattern` would lose the one-line rule in draft-07 validators, and the pattern already refuses the empty string. The field is required, with no optional variant for older sidecars. The authoring answer (`SpecDocumentSchema`), the sidecar file (`SpecDocumentFileSchema`) and the decide session's revised document (`getSpecDocumentFileJsonSchema`, decoded by `decodeCurrentDocumentSidecar`) all share `specDocumentFields`, so all three require it. Check that each exported JSON Schema lists `summary` in the surface item's `required`, right after `surface`, with `"type": "string"`, the pattern inline (no `$ref`), the description, and `additionalProperties: false` on the item.
- In the same module, export `SURFACE_SUMMARY_PLACEHOLDER = "(summary to write — lifted by phax artifact migrate-documents)"`, with a comment. It is the fixed one-line value the reader lifts into an element that had no summary. The schema accepts it, and approve and complete refuse it (phase-02).
- Run `pnpm exec tsx scripts/schemas-check.ts --write`. It writes `packages/schemas/snapshots/spec-document/next.schema.json`, moves `CURRENT_STAMPS["spec-document"]` in `src/schemas/release.ts` to the opened version (0.27.0), sets `CURRENT_SHAPES["spec-document"]` to `next` in `packages/schemas/src/generated/index.ts`, and adds the frozen module's entry to `packages/schemas/history.lock.json`. Never hand-edit those four files. Rerun the write after any later schema change in this phase. At the end, `pnpm exec tsx scripts/schemas-check.ts` without `--write` must report nothing. The release snapshots are already held to their frozen modules: `tests/unit/schemasPackage/frozenHistory.test.ts` compares them, and `packages/schemas/build/snapshots.ts` (tested by `tests/unit/schemasPackage/snapshots.test.ts`) flags a released snapshot that no decoder reads. Register the new 0.25.0 module where those expect it; write no extra snapshot test.
- In `src/schemas/persisted.ts`, read a spec sidecar stamped below the format's current stamp as follows. At 0.25.0 or later: read it with the frozen 0.25.0 decoder as shape `0.25.0`, and lift it with a new `liftSpecDocumentV0_25_0`. The lift rebuilds every surface element in the current key order (`surface`, `summary: SURFACE_SUMMARY_PLACEHOLDER`, `binding`, `before`, `after`) and keeps the questions as recorded. Below 0.25.0: keep the frozen 0.17.0 decoder (shape `0.17.0`); a sidecar written before `$schema` keeps its pre-schema decoder. Both lifts also rebuild each surface element with the placeholder. Compare releases with `parseSchemaUrl` and `compareReleases`, as `readPlanDocumentSidecar` does. Extend `SpecDocumentSidecar` with `{ kind: "spec"; shape: "0.25.0"; document; older: SpecDocumentV0_25_0Value }`, and export `SpecDocumentV0_25_0Value` (the 0.25.0 value without `$schema`) for the frozen renderer. Update the module's header comments and `readDocumentSidecar`'s doc. Check that `olderDocumentStamp` and `isStampedBelowCurrent` now name a 0.25.0 spec stamp as older; they read stamps only.
- In `src/domain/authoring/renderSpec.ts`, make `renderSurfaceElement` print the heading, a blank line, `Summary: <summary>` as given (prose is never reflowed), a blank line, and then the blocks as today: the indented `after` block when `before` is null, else the labelled `before:` and `after:` blocks. Update the module comment to say the 0.25.0 layout is frozen in `renderSpecV0_25_0.ts`.
- Create `src/domain/authoring/renderSpecV0_25_0.ts`, the spec rendering of spec-document 0.25.0, frozen. It is exactly today's `renderSpecBody` output (no `Summary:` line) and takes a `SpecDocumentV0_25_0Value` imported from `src/schemas/persisted.ts`, as `renderSpecV0_17_0.ts` takes its value. It is self-contained: it copies the helpers it needs from `markdown.ts` and the question renderers from `renderQuestions.ts` instead of importing them, so a later change to those cannot move it. Its header comment says that only `phax artifact migrate-documents` uses it, as the own-shape rendering of a 0.25.0 sidecar. Pin it before you change `renderSpec.ts`: `tests/unit/renderSpecV0_25_0.test.ts` asserts that it renders the `renderSpec.test.ts` fixture (without summaries) to exactly the body that `tests/unit/__snapshots__/renderSpec.test.ts.snap` holds at the start of this phase. Copy that body into the new test as its expected value.
- In `src/domain/artifact/documentMigration.ts`, make `renderOwnShape` render a spec sidecar of shape `0.25.0` with `renderSpecBodyV0_25_0(sidecar.older)`. Shapes `0.17.0` and `pre-schema` keep `renderSpecBodyV0_17_0`. Nothing else in the flow changes:
  - A body that is not its own-shape rendering is refused as hand-edited.
  - Otherwise the sidecar is rewritten at the current stamp, with placeholders.
  - The body is re-rendered with a `Summary:` placeholder line under each heading, the frontmatter kept byte for byte.
  - Exactly those paths are committed in the one migration commit.
  Update the comment above `renderOwnShape`.
- Update the schemas package in `packages/schemas/src/formats/repository.ts`:
  - `specDocumentFormat.releases` gains `["0.25.0", { schema: SpecDocumentV0_25_0Schema, decode: decodeSpecDocumentV0_25_0 }]`, and `SpecDocumentShapes` gains `"0.25.0"`.
  - `toLatestSpecDocument` never invents a summary. It lifts every surface element that has no `summary` key with `summary: UNKNOWN`, in the current key order, and keeps current elements as recorded. An empty surface lifts the same from either shape, so decide per element (`"summary" in element`), not per document.
  - `LatestSpecDocument` becomes the current document with each surface element's `summary` widened to `string | Unknown`.
  Update the header comments. In `packages/schemas/src/index.ts`, export `SpecDocumentV0_25_0Schema` and `type SpecDocumentV0_25_0` beside the 0.17.0 ones.
- Fixtures. Every test fixture that holds a current-shape spec document with surface elements gains a made-up `summary` on each element. Fixtures that stand for a 0.25.0 or 0.17.0 sidecar keep no summary and stamp `schemaUrl("spec-document", "0.25.0")` (or 0.17.0) literally. Assert the current stamp through `currentSchemaUrl("spec-document")` or by format id and release pattern, never through a literal of the running version. Regenerate `tests/unit/__snapshots__/renderSpec.test.ts.snap`, and check that its diff adds only `Summary:` lines and their blank lines.
- Create `tests/unit/archivedSpecSidecars.test.ts`. It picks every `.json` directly under `docs/specs/archive/` that has an `.md` of the same name beside it and whose `$schema` names `spec-document` at 0.17.0 or later (compare with `parseSchemaUrl` and `compareReleases`, never with the running version). Each must read through `readDocumentSidecar("spec", …)` without error. Those stamped 0.25.0 must read as shape `0.25.0`, with every lifted surface element equal to the file's element plus `summary: SURFACE_SUMMARY_PLACEHOLDER`. Edit nothing under `docs/`.
- Leave alone: the placeholder refusals in approve and complete, and the migration report's count (phase-02); the `phax-spec` skill and the docs (phase-03); every sidecar and artifact under `docs/`, live or archived; `phax artifact status`; and the plan document format.
- Phax's reader and the schemas package now lift an older spec sidecar's summary differently: phax writes `SURFACE_SUMMARY_PLACEHOLDER`, the package writes `UNKNOWN`. Update the tests that assume both give one value, rather than weakening either lift:
  - `tests/unit/schemasPackage/documents.ts`: split `latestPreSchema` for spec-document into a phax version (placeholder) and a package version (`UNKNOWN`), and give `validDocuments["spec-document"]` a `summary` on every surface element.
  - `tests/unit/persisted.test.ts` ("reads both shapes to the same in-memory value") and `tests/unit/schemasPackage/repositoryFormats.test.ts` use the matching helper.
  - `tests/unit/schemasPackage/currentShapes.test.ts`: take spec-document out of `PRE_SCHEMA_READ_BY_PHAX` and `UPGRADED_ALIKE`, and add a "where they part" test for the summary, modelled on the plan-document `completesSpec` one.
  - `tests/type/schemasPackage.ts`: the `Equals<LatestSpecDocument, PhaxSpecDocument>` assertions and the spec-document lines change to assert the widened `summary: string | Unknown`.
  - `tests/unit/architecturalGuards.test.ts`: add `src/schemas/history/spec-document/0.25.0.ts` to the schemas-closure allowlist, as was done for plan-document 0.25.0.
  - `tests/unit/schemasPackage/exports.test.ts`: its closed export list gains whatever the package now exports.

### Planned files to create

- `src/schemas/history/spec-document/0.25.0.ts`
- `src/domain/authoring/renderSpecV0_25_0.ts`
- `packages/schemas/snapshots/spec-document/next.schema.json`
- `tests/unit/renderSpecV0_25_0.test.ts`
- `tests/unit/archivedSpecSidecars.test.ts`
- `tests/integration/specSurfaceSummary.test.ts`

### Planned files to edit

- `src/schemas/specDocument.ts`
- `src/schemas/persisted.ts`
- `src/domain/authoring/renderSpec.ts`
- `src/domain/artifact/documentMigration.ts`
- `src/schemas/release.ts`
- `packages/schemas/src/generated/index.ts`
- `packages/schemas/history.lock.json`
- `packages/schemas/src/formats/repository.ts`
- `packages/schemas/src/index.ts`
- `tests/unit/specDocument.test.ts`
- `tests/unit/renderSpec.test.ts`
- `tests/unit/__snapshots__/renderSpec.test.ts.snap`
- `tests/unit/persisted.test.ts`
- `tests/unit/artifact/documentMigration.test.ts`
- `tests/unit/artifact/sidecar.test.ts`
- `tests/unit/decide/prompt.test.ts`
- `tests/unit/schemasPackage/documents.ts`
- `tests/unit/schemasPackage/repositoryFormats.test.ts`
- `tests/integration/authorArtifact.test.ts`
- `tests/integration/authorArtifactRetry.test.ts`
- `tests/integration/artifactNewHeadlessCommand.test.ts`
- `tests/integration/artifactStatus.test.ts`
- `tests/integration/persistedProducer.test.ts`
- `tests/integration/decideArtifact.test.ts`
- `tests/integration/migrateDocuments.test.ts`
- `tests/unit/schemasPackage/currentShapes.test.ts`
- `tests/type/schemasPackage.ts`
- `tests/unit/architecturalGuards.test.ts`
- `tests/unit/schemasPackage/exports.test.ts`

### Optional files that may be edited

- `src/domain/artifact/sidecar.ts`
- `src/app/migrateDocuments.ts`
- `scripts/rerender-spec.ts`
- `tests/unit/rerenderSpec.test.ts`
- `tests/unit/decide/revision.test.ts`
- `tests/unit/artifact/questions.test.ts`
- `tests/unit/artifact/render.test.ts`
- `tests/unit/cli/artifactStatusRender.test.ts`
- `tests/unit/schemasPackage/jsonSchemas.test.ts`
- `tests/unit/schemasPackage/preSchemaModules.test.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/documents.test.ts`
- `tests/integration/documentMigrationRefusal.test.ts`
- `tests/integration/decideLifecycle.test.ts`
- `tests/integration/artifactQuestionsStatus.test.ts`
- `tests/integration/approvalLock.test.ts`

### Boundary contracts

- `src/schemas/specDocument.ts` (producer) and every decoder of a spec document (consumers: headless authoring, decide's revised document, the sidecar reader). The contract: a surface element is `{ surface, summary, binding, before, after }`, and `summary` is a required single-line string. The exported JSON Schemas say exactly what the decoders check.
- `src/schemas/persisted.ts` (producer) and every reader of a spec sidecar (consumers: artifact status, approve, reopen, complete, decide, migrate-documents, run completion). The contract is the `SpecDocumentSidecar` union: a current document, or an older one tagged with its shape (`0.25.0`, `0.17.0` or `pre-schema`) together with the value its frozen decoder read. The lifted document carries `SURFACE_SUMMARY_PLACEHOLDER` on every element.
- `src/domain/artifact/documentMigration.ts` (consumer) and the frozen renderers (producers). The contract: one own-shape rendering per older shape, whose output is exactly what that release wrote.
- The schemas package (consumer) and the frozen modules (producers). The contract: `releases` lists `0.25.0`, and `toLatestSpecDocument` lifts a missing summary as `Unknown`, never as invented text.

### Test strategy

- a headless authoring answer whose second surface element has no `summary` key is refused as an invalid document naming `surface[1].summary`, and no spec, sidecar or commit is written — medium · example · typed refusal and an unchanged tree and HEAD (`tests/integration/authorArtifact.test.ts`) · in-phase · ac-answer-missing
- an answer whose only element is `internal: phax-plan.json reconciliation` without a `summary` is refused naming `surface[0].summary` — small · example · `decodeSpecDocument`'s first violation (`tests/unit/specDocument.test.ts`) · in-phase · ac-internal-too
- an element whose `summary` is the empty string is refused naming `surface[0].summary` — small · example · the decoder's first violation (`tests/unit/specDocument.test.ts`) · in-phase · ac-empty
- a summary holding a line break (`\n` or `\r`) between two sentences is refused naming `surface[0].summary`; a long one-line summary decodes — small · table · the decoder's verdict per input (`tests/unit/specDocument.test.ts`) · in-phase · ac-line-break
- a decide session's revised document missing `summary` on one element is refused as invalid naming `surface[<i>].summary`, and the spec and sidecar stay byte for byte as before — medium · example · typed refusal and unchanged files (`tests/integration/decideArtifact.test.ts`) · in-phase · ac-decide-drops
- a live spec whose sidecar is stamped at the current shape but lacks one `summary` is refused by `phax artifact approve <spec> --by operator` for an invalid sidecar naming `surface[<i>].summary`, writing nothing — medium · example · the refusal message and an unchanged tree (`tests/integration/specSurfaceSummary.test.ts`) · in-phase · ac-sidecar-missing
- `getSpecDocumentJsonSchema()` (what `phax artifact schema spec` prints), the headless spec authoring prompt and the decide prompt for a spec each list `summary` in the surface item's `required` right after `surface`, typed string with the inline one-line pattern and the consumer's-words description, the item carrying `additionalProperties: false` — small · example · the JSON Schema object (`tests/unit/specDocument.test.ts`, `tests/integration/authorArtifact.test.ts`, `tests/unit/decide/prompt.test.ts`) · in-phase · ac-schema
- an indicative `config: phax.json assignments` element with a summary and a non-null `before` renders its heading, then the `Summary:` line, then `before:` and `after:`, in that order — small · example · the expected Markdown (`tests/unit/renderSpec.test.ts`) · in-phase · ac-render-before-after
- a normative `cli: phax validate` element with `before: null` renders its heading, then the `Summary:` line, then the indented `after` block — small · example · the expected Markdown (`tests/unit/renderSpec.test.ts`) · in-phase · ac-render-new-element
- the frozen 0.25.0 renderer writes exactly the body today's renderer wrote — small · example · the body pinned from the pre-phase snapshot (`tests/unit/renderSpecV0_25_0.test.ts`) · in-phase
- a repository with a live spec sidecar stamped spec-document 0.25.0 refuses `phax artifact approve` on a spec and on a plan, naming the sidecar, `spec-document 0.25.0` and `phax artifact migrate-documents`, writing nothing — medium · example · the refusal message and an unchanged tree (`tests/integration/specSurfaceSummary.test.ts`) · in-phase · ac-unmigrated-refuses
- a sidecar stamped 0.25.0 reads as shape `0.25.0`, one stamped 0.17.0 as `0.17.0`, and one without `$schema` as `pre-schema`, each lifted with the placeholder on every element and every other field equal; a current sidecar reads as `current` — small · table · the reader's tagged result per stamp (`tests/unit/persisted.test.ts`) · in-phase
- a live Approved 0.25.0 spec with three elements, its body its own-shape rendering, and an Approved plan bound to it: migrate-documents stamps the sidecar at the current shape, sets the placeholder on each element and keeps every other field equal, re-renders §6 with a placeholder line under each heading and the frontmatter byte for byte, commits both files in one `chore(artifacts): migrate documents to their current shapes` commit, and reports the spec as edited since approval and the plan under `stale (spec-changed)` — medium · example · the files, the commit and the report lines (`tests/integration/migrateDocuments.test.ts`) · in-phase · ac-lift
- a live 0.25.0 spec whose body was edited by hand is refused with `migrate refused: <path> is not its sidecar's spec-document 0.25.0 rendering — a hand edit would be overwritten`, and nothing is written or committed — medium · example · the refusal and an unchanged tree and HEAD (`tests/integration/migrateDocuments.test.ts`, with the unit case in `tests/unit/artifact/documentMigration.test.ts`) · in-phase · ac-lift-hand-edited
- an archived 0.25.0 spec and its sidecar beside a live 0.25.0 spec stay byte for byte unchanged and out of the migration commit, and a later `phax artifact approve` is not refused on their account — medium · example · file bytes, the commit's paths and the approve outcome (`tests/integration/migrateDocuments.test.ts`) · in-phase · ac-archive-untouched
- every archived spec sidecar in this repository stamped 0.17.0 or later still reads, the 0.25.0 ones as shape `0.25.0` with placeholders — medium · example · the reader's result per file (`tests/unit/archivedSpecSidecars.test.ts`) · in-phase
- the schemas package parses a 0.25.0 spec document as shape `0.25.0`, and `toLatestSpecDocument` lifts each element's summary as `Unknown` and keeps a current element's summary — small · example · the parsed shape and the lifted value (`tests/unit/schemasPackage/repositoryFormats.test.ts`) · in-phase

### Implementation order

1. Pin today's rendering in `tests/unit/renderSpecV0_25_0.test.ts`, then write the frozen 0.25.0 schema module and the frozen renderer.
2. Add `summary` and `SURFACE_SUMMARY_PLACEHOLDER` to `src/schemas/specDocument.ts`, then run `pnpm exec tsx scripts/schemas-check.ts --write`.
3. Add the readers and lifts in `src/schemas/persisted.ts`, then `renderOwnShape` in `documentMigration.ts`.
4. Add the `Summary:` line to the renderer.
5. Update the schemas package format and its exports.
6. Update the fixtures, add the acceptance tests and `tests/unit/archivedSpecSidecars.test.ts`, then make a final `schemas-check` run without `--write`.

### Excluded scope

- The placeholder refusals in `phax artifact approve` and `complete`, and the migration report's `summaries to write` count (phase-02).
- `phax artifact status` reporting summaries still to write (settled: never).
- The `phax-spec` skill, `docs/upgrading.md`, README and `NEXT_STEPS.md` (phase-03).
- Editing any spec, plan or sidecar under `docs/`, live or archived. The operator runs `phax artifact migrate-documents` after the merge.
- The plan document format, `plan.md` and `phax-plan.json`.
- The release-notes script under `scripts/`.

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

- The frozen module's path and exports (`SpecDocumentV0_25_0Schema`, `SpecDocumentV0_25_0`, `decodeSpecDocumentV0_25_0`), and confirmation that its JSON Schema equals the committed 0.25.0 snapshot.
- The exact name and module of `SURFACE_SUMMARY_PLACEHOLDER` and its text.
- The new `SpecDocumentSidecar` variant and the exported `SpecDocumentV0_25_0Value`; the names of the lift functions in `src/schemas/persisted.ts`.
- `renderSpecBodyV0_25_0`'s path, and how `renderOwnShape` dispatches per spec shape.
- The stamps after `--write`: `spec-document` at 0.27.0, with a `next` snapshot.
- How the schemas package's `LatestSpecDocument` types a lifted summary.
- The test name of each acceptance criterion this phase covers, by criterion id.
- That this repository's live spec sidecars are now unmigrated on the branch, and were left untouched.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(specs): require a one-line summary on every surface element`

### Commit body

Every surface element of a spec document now carries a required summary:
one line, in the consumer's words, saying what changes for them. The
authoring answer, the sidecar and a decide session's revised document
refuse an element without one, or with a line break, naming
surface[<i>].summary, and every exported JSON Schema lists it as a required
string with the one-line pattern. §6 prints it as a Summary: line under
each element heading, before the blocks.

Freeze the spec-document 0.25.0 shape and its rendering, and stamp the new
shape at 0.27.0. Sidecars stamped 0.25.0, 0.17.0 or written before $schema
lift with a fixed summary placeholder, so phax artifact migrate-documents
restamps them and re-renders §6 with placeholder lines. The schemas package
lists the 0.25.0 release and lifts a missing summary as Unknown.

Refs: docs/specs/2610211432-surface-summary.md §5.1–§5.8, §5.11

---

## phase-02 — Placeholder refusals at approve and complete, and summaries counted in the migration report {#phase-02-placeholder-refusals}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

A spec whose current-shape sidecar still holds the summary placeholder cannot be approved or completed. Both refusals name every element still to write, with the remedy. The migration report tells the operator, per lifted spec, how many summaries are left to write. An older-stamped spec, like this run's own spec, still completes.

### Detailed instructions

- Create `src/domain/artifact/surfaceSummaries.ts`, pure, with no I/O:
  - `unwrittenSummaries(sidecar: DocumentSidecar | null): readonly string[]` returns the `surface` value of each element whose `summary` equals `SURFACE_SUMMARY_PLACEHOLDER` (from `src/schemas/specDocument.ts`), in document order. It reads only a spec sidecar decoded at shape `current`. It returns `[]` for a plan, a hand-authored artifact (null), and a sidecar of shape `0.25.0`, `0.17.0` or `pre-schema`, whose placeholders are the reader's lift, not the file's content.
  - `summariesToWrite(document: SpecDocument): number` counts the elements holding the placeholder.
  Use exact string equality.
- In `src/domain/errors.ts`, add `SurfaceSummariesUnwrittenError` (tagged), with fields `gesture` ("Approval refused" or "Completion refused"), `path`, `sidecarPath` and `surfaces`. Its message is:
  - `<gesture>: <path> has <n> surface summaries still to write`, singular `1 surface summary still to write`;
  - then one line `  <surface>` per element;
  - then `  Write each one in <sidecarPath> and on its §6 \`Summary:\` line, then rerun.`
  Map it to exit 12 in `exitCodeForError` in `src/cli/commands/runLayers.ts`, beside `ArtifactOpenQuestionsError`.
- In `src/app/artifactStatus.ts` `transitionArtifact`, refuse with that error, before anything is written:
  - On target `Approved`: after the sidecar agreement check (so only an in-sync, current-shape sidecar reaches it) and before the open-questions lock. Gesture "Approval refused".
  - On target `Completed` for a spec: right after `readSidecar`, before the chain gate, the record-file removal or any move. Gesture "Completion refused".
  Read the elements with `unwrittenSummaries(sidecar.read)`. Reopen, abandon and stale are never refused for a placeholder. Add the error to `TransitionArtifactError` and to `RunCompletionError` in `src/app/completeRunArtifacts.ts`, and follow the type wherever a union of transition errors must name it (run completion turns it into the `ArtifactCompletionFailed` pause like any other member).
- In `src/domain/artifact/documentMigration.ts`, give `DocumentMigration` and `MigratedArtifact` a `summariesToWrite: number`. A migrated spec carries `summariesToWrite(lifted document)`, and a plan carries 0. `groupMigratedArtifacts` carries it through.
- In `src/domain/artifact/render.ts`, change `migratedArtifactLines` as follows. When `summariesToWrite > 0`, append ` · <n> summaries to write` (singular `1 summary to write`) after the question counts on the artifact's line; a spec with an empty surface shows no count. The edited-since-approval line becomes `now edited since approval — write its summaries, then re-approve with \`phax artifact approve <path>\`` when the spec has summaries to write and no open question. With open questions, it becomes `now edited since approval, with open questions <ids> — write its summaries, reopen it and decide <ids> before re-approving`. Without summaries to write, both lines stay as today. Update `renderDocumentMigrationReport`'s doc comment.
- Run completion: prove that an Approved spec whose sidecar is stamped spec-document 0.25.0 still completes through `completeRunArtifacts`, with its md and sidecar moved to `docs/specs/archive/` and the sidecar byte for byte. That is the shape this run's own spec has at its archival commit. Also prove that a current-shape spec still holding a placeholder makes run completion fail with `SurfaceSummariesUnwrittenError`, moving nothing.
- Leave alone: `phax artifact status` (settled: no count there), the reader and the lifts from phase-01, the skill and the docs (phase-03), and every file under `docs/`.

### Planned files to create

- `src/domain/artifact/surfaceSummaries.ts`
- `tests/unit/artifact/surfaceSummaries.test.ts`
- `tests/integration/summaryPlaceholderRefusal.test.ts`

### Planned files to edit

- `src/domain/errors.ts`
- `src/app/artifactStatus.ts`
- `src/app/completeRunArtifacts.ts`
- `src/cli/commands/runLayers.ts`
- `src/domain/artifact/documentMigration.ts`
- `src/domain/artifact/render.ts`
- `tests/unit/artifact/render.test.ts`
- `tests/unit/artifact/documentMigration.test.ts`
- `tests/integration/migrateDocuments.test.ts`
- `tests/integration/completeRunArtifacts.test.ts`

### Optional files that may be edited

- `src/app/executePlan.ts`
- `src/app/migrateDocuments.ts`
- `src/app/planStaleness.ts`
- `src/app/decideArtifact.ts`
- `src/cli/commands/artifact.ts`
- `tests/unit/cli/artifact.test.ts`
- `tests/integration/documentMigrationRefusal.test.ts`
- `tests/integration/approvalLock.test.ts`
- `tests/integration/artifactStatus.test.ts`

### Boundary contracts

- `src/domain/artifact/surfaceSummaries.ts` (producer) and `transitionArtifact` and the migration decision (consumers). The contract: the surfaces still holding the placeholder, read only from a current-shape spec sidecar; an older-stamped sidecar never yields one.
- `transitionArtifact` (producer) and the CLI and run completion (consumers). The contract: `SurfaceSummariesUnwrittenError` names the gesture, the spec, its sidecar and every unwritten element, maps to exit 12, and is raised before anything is written.
- `DocumentMigrationResult` (producer) and the migrate-documents report (consumer). The contract: each migrated artifact carries `summariesToWrite`.

### Test strategy

- `unwrittenSummaries` returns the placeholder surfaces in order for a current spec sidecar, and `[]` for a current spec without placeholders, a lifted 0.25.0, 0.17.0 or pre-schema sidecar, a plan sidecar and no sidecar — small · table · the expected list per sidecar kind and shape (`tests/unit/artifact/surfaceSummaries.test.ts`) · in-phase
- a lifted spec with three elements reports `3 summaries to write` on its report line; one with one element reads `1 summary to write`; an empty surface shows no count; the edited-since-approval line names the summaries with and without open questions — small · table · the expected report lines (`tests/unit/artifact/render.test.ts`, `tests/unit/artifact/documentMigration.test.ts`) · in-phase · ac-lift-report
- `phax artifact migrate-documents` over the three-element Approved 0.25.0 spec prints `3 summaries to write` on that spec's line — medium · example · the report's stdout lines (`tests/integration/migrateDocuments.test.ts`) · in-phase · ac-lift-report
- `phax artifact approve <spec> --by operator` on a migrated spec whose sidecar holds the placeholder on two elements exits 12, names both by their `surface` value with the remedy, and writes nothing (md, sidecar, record file, HEAD) — medium · example · exit code, message and an unchanged tree (`tests/integration/summaryPlaceholderRefusal.test.ts`) · in-phase · ac-placeholder-approve
- `phax artifact complete <spec>` on an Approved spec whose sidecar holds the placeholder on one element is refused naming that element, and the spec stays under `docs/specs/` unchanged with nothing archived — medium · example · the refusal and the unchanged paths (`tests/integration/summaryPlaceholderRefusal.test.ts`) · in-phase · ac-placeholder-complete
- once every placeholder is replaced by the same sentence in the sidecar and on its §6 `Summary:` line, `phax artifact approve <spec> --by operator` approves the spec and writes its record file — medium · example · the new status and the record file (`tests/integration/summaryPlaceholderRefusal.test.ts`) · in-phase · ac-placeholder-written
- run completion of an Approved spec whose sidecar is stamped spec-document 0.25.0 archives the md and moves the sidecar byte for byte; a current-shape Approved spec with a placeholder fails completion with `SurfaceSummariesUnwrittenError` after the plan's archival commit has landed (completion archives the plan first), and the spec and its sidecar stay under `docs/specs/` unchanged — medium · example · archived bytes and the typed failure (`tests/integration/completeRunArtifacts.test.ts`) · in-phase

### Implementation order

1. `src/domain/artifact/surfaceSummaries.ts` and its unit test.
2. The error class and its exit code.
3. The refusals in `transitionArtifact`, and the error unions of run completion.
4. The migration decision's count, then the report lines.
5. The integration tests: the new refusal test, the migration report, and run completion.

### Excluded scope

- `phax artifact status` reporting a count (settled: never).
- Refusing reopen, abandon or stale for a placeholder.
- Any change to the format, the reader, the lifts or the renderers (phase-01).
- The `phax-spec` skill and the docs (phase-03).
- Editing any file under `docs/`.

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

- The path and exports of `src/domain/artifact/surfaceSummaries.ts`.
- `SurfaceSummariesUnwrittenError`'s fields, its message lines and its exit code.
- Where approve and complete call the check in `transitionArtifact`, and confirmation that an older-stamped sidecar is never refused.
- The new report lines, verbatim, as the tests pin them.
- The test name of each acceptance criterion this phase covers, by criterion id, and the run-completion test of a 0.25.0 spec.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(artifacts): refuse approving or completing a spec with summaries to write`

### Commit body

phax artifact approve and complete now refuse a spec whose current-shape
sidecar still holds the summary placeholder. The refusal (exit 12) names
every element still to write by its surface value, and says to write each
summary in the sidecar and on its §6 Summary: line. It is raised before
anything is written. A sidecar stamped below the current shape holds no
summary and is never refused, so complete and run completion still carry an
older sidecar as it is.

phax artifact migrate-documents reports, on each lifted spec's line, how
many summaries it leaves to write, and the edited-since-approval line names
them before re-approval.

Refs: docs/specs/2610211432-surface-summary.md §5.9, §5.10

---

## phase-03 — The phax-spec skill and the docs teach the surface summary {#phase-03-skill-and-docs}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

The `phax-spec` skill that phax ships defines `summary`: one sentence, in the consumer's words, saying what the consumer can now do or sees differently, with one good and one bad example. Its Markdown template shows the `Summary:` line under each §6 element heading, as guidance phax does not check. The upgrade notes for 0.27.0, the README and `NEXT_STEPS.md` say what changed and what the operator runs.

### Detailed instructions

- In `.claude/skills/phax-spec/SKILL.md`, change the sidecar field table row to `| \`surface\` | \`[{ surface, summary, binding, before, after }]\` | §6 Surface |`, keeping the table's column alignment.
- In the field bullets under the table, add a `summary` bullet directly after the `surface` bullet: "one sentence, in the consumer's words: what whoever consumes this element can now do or sees differently. Never where the change lives, never how it is built. One line, no line break; phax refuses a missing, empty or multi-line summary." Give no example in this bullet; point to the Surface section.
- In the Surface section (`## Surface — the consumption contract`), define the summary the same way and give its examples there, exactly one of each, on lines starting `Good:` and `Bad:`: Good: "`phax validate` checks each assignment bound against the routing catalog." Bad: "Adds a bounds check to the validate command's config loader." Say who the consumer is per kind (`cli:`/`config:` the operator, `file:`/`api:` a reading tool or person, `package:` a dependent package, `internal:` the phax code or agent that relies on it). Write no other `Good:` or `Bad:` line anywhere in the skill.
- The skill's canonical Markdown template (its §6 is today a prose placeholder, around `.claude/skills/phax-spec/SKILL.md:144-153`) shows no element heading. Inside that template's §6, add one example element as the spec's §6 lays it out: a `### <kind>: <name> — normative | indicative` heading, a blank line, `Summary: <one sentence: what the consumer can now do or sees differently>` as its own paragraph, a blank line, then the element's blocks, in the form the renderer prints. Say once, next to the template, that in a hand-authored spec this line is guidance phax does not check (q-hand).
- Mention the summary placeholder once in the skill. An element lifted by `phax artifact migrate-documents` carries `(summary to write — lifted by phax artifact migrate-documents)`. The author replaces it with the same sentence in the sidecar and on the §6 `Summary:` line, and approve and complete refuse the spec until they do.
- Extend `tests/unit/skills.test.ts` to read `.claude/skills/phax-spec/SKILL.md` and assert that:
  - the field table row lists `[{ surface, summary, binding, before, after }]`;
  - the whole file holds exactly one line starting `Good:` and one starting `Bad:`, both in the Surface section;
  - the template shows a `Summary:` line directly under a §6 element heading.
- In `docs/upgrading.md`, add a `### 0.27.0` section above `### 0.26.0` with these bullets:
  - the §11 entry: spec sidecars gain a `summary` on every surface element; run `phax artifact migrate-documents` once; it restamps every live spec sidecar, writes a placeholder summary on each element, re-renders §6 and commits; the report counts the summaries left to write per spec; then write each summary, one sentence in the consumer's words, in the sidecar and on its §6 `Summary:` line; `phax artifact approve` and `complete` refuse a spec until its placeholders are gone, and `approve`, `reopen` and `decide` refuse until the migration has run; archived specs are not touched;
  - hand-authored specs: add a `Summary:` line under each §6 element heading if you want the same layout; phax does not check it.
- In `README.md`, update the passages at about line 292 (the line that introduces `phax artifact migrate-documents`), line 905 (the Persisted formats paragraph) and line 1005 (which says `complete`, `abandon` and run completion are not refused: `complete` now refuses a current-shape spec holding a placeholder). Say that a spec sidecar stamped 0.25.0 or 0.17.0, or written before `$schema`, is lifted with a summary placeholder on every surface element when phax reads it, that `migrate-documents` restamps it, and that approve and complete refuse a spec still holding a placeholder. Do not edit the generated CLI reference block (about lines 1011-1080): `tests/integration/docsCliDrift.test.ts` holds it to the CLI help.
- In `NEXT_STEPS.md`, add `surface-summary` under `### In flight` as landed (`[x]`), with its spec path `docs/specs/2610211432-surface-summary.md`, approved 2026-10-21, and this plan as its only plan. Note that the operator runs `phax artifact migrate-documents` on main after the merge and writes the live specs' summaries. Note also that the release-notes script that reads the summaries is the next, separate change.
- Edit no spec, plan or sidecar under `docs/specs/` or `docs/plans/`.

### Planned files to create

- (none)

### Planned files to edit

- `.claude/skills/phax-spec/SKILL.md`
- `tests/unit/skills.test.ts`
- `docs/upgrading.md`
- `README.md`
- `NEXT_STEPS.md`

### Optional files that may be edited

- `docs/arbitration.md`

### Boundary contracts

- The `phax-spec` skill (producer) and headless spec authoring sessions and hand authors (consumers). The contract: the field table and the Surface section say what `summary` is, in words that match what the schema checks (required, one line), and the template shows the line in the form the renderer prints.

### Test strategy

- the shipped `phax-spec` skill lists `surface` as `[{ surface, summary, binding, before, after }]` in its sidecar field table and defines `summary` with exactly one good and one bad example — small · example · the skill file's text (`tests/unit/skills.test.ts`) · in-phase · ac-skill
- the skill's canonical spec template shows a `Summary:` line directly under a §6 element heading — small · example · the skill file's text (`tests/unit/skills.test.ts`) · in-phase · ac-template

### Implementation order

1. The skill: field table, field bullet, Surface section, template.
2. The skill tests.
3. `docs/upgrading.md`, then README, then `NEXT_STEPS.md`.

### Excluded scope

- Any code change.
- The phax-planning skill and the other skills.
- The release-notes script.
- Editing any spec, plan or sidecar under `docs/specs/` or `docs/plans/`.

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

- The skill passages changed: table row, field bullet, Surface section, template line, placeholder note.
- The test names covering ac-skill and ac-template.
- The 0.27.0 upgrading entry, verbatim.
- The README passages changed.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`docs(specs): teach the surface summary in the phax-spec skill and upgrade notes`

### Commit body

The phax-spec skill defines the surface element's summary in its sidecar
field table and its Surface section: one sentence, in the consumer's
words, saying what the consumer can now do or sees differently, never
where it lives or how it is built, with one good and one bad example. Its
Markdown template shows the Summary: line under each §6 element heading,
as guidance phax does not check in a hand-authored spec.

docs/upgrading.md gains a 0.27.0 section: run phax artifact
migrate-documents once, then write each placeholder summary. The README
and NEXT_STEPS.md follow.

Refs: docs/specs/2610211432-surface-summary.md §5.12, §5.13, §11
