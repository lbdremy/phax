---
status: Approved
source-spec: docs/specs/2611041509-finding-ids-and-fates.md
completes-spec: false
approved:
  date: 2026-11-17
  baseline: bae802b
---
# Finding ids and the findings list

This is the first of the three plans of the spec finding-ids-and-fates (q-plans `three-plans`). It covers the ids and the read side, §5.1 to §5.8. phax gives every code-review finding an `F<n>` id and every compliance finding a `C<n>` id when it persists a review, and the numbering continues across the run's reviews. The review sessions never write an id: their answers become formats of their own that still refuse the key. A review persisted before ids existed gets its ids by position when it is read, with the fate `unrecorded`. `phax finding list <run>` prints every finding of a run with its id and fate, as text or as a versioned `finding-list` document under `--json`. It reads the run's earlier reviews from the records branch, so a re-review drops no finding.

Every new or changed shape is born at the opened version through a `next` snapshot, whatever stamp the spec's examples show. No test names the opened version or a `next` shape literally: stamps come from `CURRENT_STAMPS`, `currentSchemaUrl` and `packages/schemas/releases.json`.

Criteria this plan proves: AC-ids-assigned, AC-compliance-ids and AC-session-id-refused (in-phase, in phases 01 to 03, where their code is written). Through the acceptance pair (phase-05, passed by phase-06) it proves AC-lift-unrecorded and AC-list-json, as far as a fate record is not needed, and the part of AC-rereview-continues that needs no fate record: F4 and F5 after F1 to F3, with F1 to F5 all listed.

Left to plan 2 (the fate commands and their records):
- AC-rereview-continues's F2 `fixed`;
- AC-list-json's non-empty `history`;
- AC-lift-settable, AC-list-text, AC-fix-commits-named-paths, AC-fix-records, AC-path-classes, AC-fix-refusals, AC-fix-state, AC-machine-fix, AC-dismiss, AC-defer, AC-settle-refusals, AC-machine-never-settles, AC-records-off, AC-record-failure and AC-latest-wins.

Left to plan 3 (the PR description and the fate comments): AC-pr-section, AC-pr-description-not-rewritten, AC-pr-fix-pushes-and-comments, AC-pr-dismiss-defer-comment, AC-pr-no-pr, AC-publish-auto-off, AC-list-local and AC-never-blocks. In this plan, `phax finding list` builds no GitHub layer at all.

## Required commands

- `pnpm exec tsx`
- `pnpm gen:usage-spec`
- `pnpm docs:cli`
- `pnpm test:unit`
- `pnpm test:property:deep`

Every command above already equals an entry of `security.agentCommands` in phax.json, so no security configuration change is needed. `pnpm exec tsx` runs `scripts/schemas-check.ts`: once with `--write` to generate the `next` snapshots and the generated stamp files, then once without it to check them. `pnpm gen:usage-spec` and `pnpm docs:cli` regenerate the usage spec and the CLI reference in the phase that adds `phax finding list`. `pnpm test:property:deep <file>` runs a property file once at depth before handing off a new or changed format.

## Technical arbitrations

- Answer and file split (§5.2, §5.3). Two new answer formats, `code-review-answer` and `compliance-review-answer`, are born at the opened version. Each has exactly today's answer shape (no `id`, every unknown key refused), and the sessions are handed these schemas. The files keep their format ids, `code-review` and `compliance-review`, and move to a new shape whose findings require `id`. Loss accepted: a session's answer now names `code-review-answer` (not `code-review`) in its `$schema`, the package publishes two more formats, and every test that builds an answer must be retargeted. The alternative keeps one format whose answer has no ids under a stamp that names the shape with ids. It would break the rule that a `$schema` stamp names one shape.
- Where a run's reviews are read (q-rereview `records-history`). A run's reviews of one kind are:
  - every entry under `<runId>/code-review/` or `<runId>/compliance-review/` on `phax/records/v1`, oldest first in branch order;
  - then the run folder's file, appended as the newest only when its bytes differ from the newest entry of its kind. That is the case when its record write failed, or records were off.
  The run folder is the live run's, or `<archivePath>/runs` of an archived run when it is present. The highest id already given (§5.1) is read through the same reviews and the same fold just before a new review is written, so persist and list agree. Loss accepted, records off: phax reads the run folder alone. A replaced review's findings are no longer listed, and an id that only a replaced review held may be given again. No fate record can name such an id, because fate commands need records (§5.19).
  When the records branch cannot be read (missing clone, git failure), phax reads the run folder alone and says so on stderr. The review being persisted is never refused for it.
  A review document phax cannot read (a newer stamp, a damaged file) is handled two ways. `phax finding list` refuses it with exit 1, naming it. A persist continues the numbering after the readable reviews, with a warning.
- Lifting ids of reviews persisted before ids (§5.4). For each kind, an id-less review gets ids by position. The numbers continue after the highest id given by the run's reviews before it, oldest first, exactly as §5.1's numbering continues. So two older code reviews of three and two findings lift to F1–F3 and F4–F5, and a new review continues at F6. Loss accepted: a lifted id depends on the set and order of the run's earlier reviews. It is stable because records are append-only and every new review carries ids. Deleting a record by hand would shift lifted ids.
- The `finding-list` answer's history. `fate` is a closed set of all five values now (`open`, `fixed`, `dismissed`, `deferred`, `unrecorded`). `history` is required and typed as an empty tuple, documented as the finding's fate records, oldest first. In this plan every finding is `open` (persisted with its id) or `unrecorded` (lifted). Plan 2 widens `history`'s items to fate-record entries, rather than adding or reshaping keys.
  - If no release is cut between the two plans, the `finding-list` `next` snapshot still exists, plan 2 edits it in place, and the stamp stays the opened version.
  - If a release is cut in between, plan 2 must:
    - open a new `next` snapshot, so the stamp moves to the then-opened version;
    - freeze the cut shape as `src/schemas/history/finding-list/<cut>.ts`;
    - register it as a release of the package's `findingListFormat`;
    - register it as a frozen shape in `tests/helpers/property/formatRegistry.ts`.
  Loss accepted: a reader of this plan's answer sees history items appear only with a shape change. The alternative declares plan 2's entry shape now, and abandons the decisions §10 leaves open on the fate record (manifest, advocate, principles).
- How a run is named. `phax finding list <run>` takes one positional run reference, like `phax path` and `phax enter`: a short name in the current project, or `<namespace>.<short-name>`. It is resolved by `resolveRunRef`. When that fails and the registry holds the run as `archived`, the run resolves from its registry entry (runId, state `archived`). It reads `<archivePath>/runs` when present, and its records.
  A cross-project run reads its own project's records, as a by-hand review records to them (`reviewRecordTargetFor`). When that project cannot be read, phax reads the run folder alone, and the answer says the records were unavailable. Loss accepted: there is no `--run-id` form, so a run the registry no longer knows cannot be listed.
- The `finding-list` answer's shape: `{ $schema, run: { namespace, shortName, runId, state }, records, findings }`.
  - `records` is `read`, `off` or `unavailable`, so a reader knows whether earlier reviews could be read.
  - A code-review finding is `{ id, source: "code-review", severity, file, line, message, lens, escape, criterion, suggestion, fate, history }`.
  - A compliance finding is `{ id, source: "compliance-review", severity, phaseId, dimension, message, fate, history }`.
  - Findings are ordered F before C, each by number.
  Refusals: exit 1 for a run that cannot be resolved, a review document that cannot be read, and a git or file failure; exit 2 for a configuration error, as the `records` group does. Notes go to stderr as message lines.
- Acceptance pair. One acceptance pair covers the surface: `phax finding list`, in phase-05, passed by phase-06. The persist-side criteria (AC-ids-assigned, AC-compliance-ids, AC-session-id-refused, and the numbering of AC-rereview-continues) are tested in-phase in phases 01 to 03. The acceptance tests read the files those phases write, so they must exist first. Loss accepted: those criteria are not frozen before their code is written.

---

## phase-01 — The review answers become their own formats {#phase-01-review-answer-formats}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

The code-review and compliance-review sessions answer two new formats, `code-review-answer` and `compliance-review-answer`, born at the opened version. Each has exactly today's answer shape, so an answer that writes an `id` on a finding is refused by name. The files `code-review.json` and `compliance-review.json` keep their current shape in this phase.

### Detailed instructions

- Read the Technical arbitrations first (the answer and file split). Read `src/schemas/codeReview.ts`, `src/schemas/complianceReview.ts`, `src/schemas/answerStamp.ts`, `src/schemas/answerSchemas.ts`, `src/schemas/schemaUrl.ts`, `packages/schemas/src/formats/answers.ts` (how `spec-hand-decision-answer` is defined: an answer phax reads but never writes, born with `$schema`), `packages/schemas/build/jsonSchemas.ts`, `docs/property-tests.md` (Registering a format) and `tests/helpers/property/formatRegistry.ts`.
- Register both ids. Append `code-review-answer` then `compliance-review-answer` at the end of `FORMAT_IDS` and of `SCHEMA_BORN_FORMAT_IDS` in `src/schemas/schemaUrl.ts`, keeping the existing order, and extend both doc comments: the answers of the code review and compliance review sessions, of spec finding-ids-and-fates, born at this release.
- In `src/schemas/codeReview.ts`, export `CodeReviewAnswerSchema`: `{ $schema: answerSchemaUrlField("code-review-answer"), findings: Schema.Array(CodeReviewFindingSchema) }`. Also export its decoder with `errors: "all"`, `onExcessProperty: "error"` and `reportInput: true`. `readCodeReviewAnswer` decodes this schema, and its contract does not change: refusal text, or the findings without `$schema`. Leave `CodeReviewFileSchema` exactly as it is, including its `$schema` const naming `code-review` at its current stamp, so the `code-review` snapshot does not move. Update the header comment: the answer and the file are now two formats with the same shape, and the file gains ids in the next phase.
- Do the same in `src/schemas/complianceReview.ts`: export `ComplianceReviewAnswerSchema` with `$schema: answerSchemaUrlField("compliance-review-answer")` and the same fields as the file. `readComplianceReviewAnswer` decodes it. `ComplianceReviewFileSchema` is unchanged.
- In `src/schemas/answerSchemas.ts`, replace the `code-review` and `compliance-review` entries of `ANSWER_FORMATS` with `code-review-answer` (label `code review answer`, schema `CodeReviewAnswerSchema`) and `compliance-review-answer` (label `compliance review answer`, schema `ComplianceReviewAnswerSchema`).
- Hand the sessions the new schemas. In `src/app/reviewCode.ts`, pass `answerSchema: { call: "code-review", schema: answerJsonSchema("code-review-answer") }`; the call id stays `code-review`. Do the same in `src/app/reviewCompliance.ts` with `compliance-review-answer`. In `src/domain/review/codeReviewPrompt.ts`, the schema printed in the prompt and the empty-review example (`{ $schema, findings: [] }`) name `code-review-answer` at its current stamp. In `src/domain/review/compliancePrompt.ts`, the printed schema is `compliance-review-answer`'s.
- In the schemas package, add `codeReviewAnswerFormat` and `complianceReviewAnswerFormat` in `packages/schemas/src/formats/answers.ts`, modelled on `specHandDecisionAnswerFormat`: no pre-schema shape, `releases: []`, current shape from `CURRENT_SHAPES`. Add the parsers `parseCodeReviewAnswer` and `parseComplianceReviewAnswer`, the `toLatest…` functions that drop `$schema`, and the `Latest…`, `…Shapes` and `…Shape` types. Export them and the schemas (`CodeReviewAnswerSchema`, `ComplianceReviewAnswerSchema`) from `packages/schemas/src/index.ts`, and add both to its format map. Add both to `packages/schemas/build/jsonSchemas.ts` (`FORMAT_DEFINITIONS`, and the excess map with `error`).
- Run `pnpm exec tsx scripts/schemas-check.ts --write`. It creates `packages/schemas/snapshots/code-review-answer/next.schema.json` and `packages/schemas/snapshots/compliance-review-answer/next.schema.json`, sets both stamps in `src/schemas/release.ts` to the opened version, and updates `packages/schemas/src/generated/index.ts` and `packages/schemas/shipped-json.json`. Never edit those generated files by hand. Then run `pnpm exec tsx scripts/schemas-check.ts` with no flag and make it pass.
- Add the behaviour corpus cases `tests/behaviourCorpus/cases/formats/code-review-answer.json` and `tests/behaviourCorpus/cases/formats/compliance-review-answer.json`, modelled on the existing `code-review.json` and `compliance-review.json` cases of that folder. Each holds a valid answer and these refusals: a finding carrying `id`, an unknown root key, and a missing `$schema`. The compliance case also refuses an answer stamped with the `compliance-review` URL. Register both subjects in `tests/behaviourCorpus/subjects.ts` and in the coverage list of `tests/unit/behaviourCorpus/coverage.test.ts`. Update `tests/behaviourCorpus/baseline/snapshot-digests.json` only if its check asks for it.
- Register a generator for both ids in `tests/helpers/property/formatRegistry.ts`, as for `spec-hand-decision-answer`: `valid` derived from the answer schema, `$schema` first. `phax` reads through `readCodeReviewAnswer` / `readComplianceReviewAnswer` wrapped as the registry expects; when the reader's shape does not fit, use `writeOnly` with a one-line reason. `parse` is the package's parser, and there is no frozen entry. Then run `pnpm test:property:deep tests/unit/property/persistedFormats.property.test.ts` once and record the seed and the result in the handoff.
- Retarget every test that builds a session answer: its `$schema` becomes `schemaUrl("code-review-answer", CURRENT_STAMPS["code-review-answer"])` or the compliance equivalent. Tests that build a file (`code-review.json`, `compliance-review.json`, review records) keep the file format's stamp. Update the per-format tables the compiler or a test names: `tests/unit/schemaUrl.test.ts`, `tests/type/schemasPackage.ts`, `tests/unit/schemas/answerSchemas.test.ts`, and the `tests/unit/schemasPackage/` files (`documents.ts` gets a valid answer of each format). Never name the opened version in a test.
- Prove AC-session-id-refused in `tests/integration/reviewCodeHeadless.test.ts`. The fake backend answers a code-review answer whose first finding carries `"id": "F1"`, on the first turn and on the corrective resume. The result is `failed`, its reason names `findings[0].id` as an unexpected key, and the run folder holds no `code-review.json`. In `tests/unit/schemas/complianceReview.test.ts`, refuse a compliance answer with an `id` on `perPhase[0].findings[0]`, naming that path. In `tests/unit/schemas/codeReview.test.ts`, refuse a code-review answer with an `id`, naming `findings[0].id`.
- Add the two rows to README.md's `## Persisted formats` table, after the plan extraction row: `Code review answer` | `code-review-answer` | the final message of a headless code review session | `parseCodeReviewAnswer` | `json/code-review-answer.schema.json`; and `Compliance review answer` | `compliance-review-answer` | the final message of a compliance review session | `parseComplianceReviewAnswer` | `json/compliance-review-answer.schema.json`.

### Planned files to create

- `packages/schemas/snapshots/code-review-answer/next.schema.json`
- `packages/schemas/snapshots/compliance-review-answer/next.schema.json`
- `tests/behaviourCorpus/cases/formats/code-review-answer.json`
- `tests/behaviourCorpus/cases/formats/compliance-review-answer.json`

### Planned files to edit

- `src/schemas/codeReview.ts`
- `src/schemas/complianceReview.ts`
- `src/schemas/answerSchemas.ts`
- `src/schemas/schemaUrl.ts`
- `src/schemas/release.ts`
- `src/app/reviewCode.ts`
- `src/app/reviewCompliance.ts`
- `src/domain/review/codeReviewPrompt.ts`
- `src/domain/review/compliancePrompt.ts`
- `packages/schemas/src/formats/answers.ts`
- `packages/schemas/src/index.ts`
- `packages/schemas/src/generated/index.ts`
- `packages/schemas/build/jsonSchemas.ts`
- `packages/schemas/shipped-json.json`
- `README.md`
- `tests/behaviourCorpus/subjects.ts`
- `tests/unit/behaviourCorpus/coverage.test.ts`
- `tests/helpers/property/formatRegistry.ts`
- `tests/unit/schemaUrl.test.ts`
- `tests/type/schemasPackage.ts`
- `tests/unit/schemas/answerSchemas.test.ts`
- `tests/unit/schemas/codeReview.test.ts`
- `tests/unit/schemas/complianceReview.test.ts`
- `tests/unit/schemasPackage/documents.ts`
- `tests/integration/reviewCodeHeadless.test.ts`
- `tests/integration/codeReviewRecord.test.ts`
- `tests/integration/reviewComplianceCommand.test.ts`

### Optional files that may be edited

- `src/schemas/persisted.ts`
- `docs/structured-answers.md`
- `tests/behaviourCorpus/baseline/snapshot-digests.json`
- `tests/unit/architecturalGuards.test.ts`
- `tests/unit/schemasPackage/documents.test.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/currentShapes.test.ts`
- `tests/unit/schemasPackage/jsonSchemas.test.ts`
- `tests/unit/schemasPackage/exports.test.ts`
- `tests/unit/schemasPackage/parseDocument.test.ts`
- `tests/unit/schemasPackage/shippedJson.test.ts`
- `tests/unit/schemas/codeReviewRefusals.test.ts`
- `tests/unit/schemas/strictAnswers.test.ts`
- `tests/unit/schemas/answerRulesKept.test.ts`
- `tests/unit/session/structuredCalls.test.ts`
- `tests/unit/review/codeReviewPrompt.test.ts`
- `tests/unit/review/compliancePrompt.test.ts`
- `tests/unit/providers/mistralVibe.test.ts`
- `tests/unit/cli/reviewCode.test.ts`
- `tests/integration/complianceReviewRecord.test.ts`
- `tests/integration/reviewCompliance.test.ts`
- `tests/integration/reviewCode.test.ts`
- `tests/integration/headlessCodeReviewRunEnd.test.ts`
- `tests/integration/reviewCommandsJson.test.ts`
- `tests/integration/structuredAnswerFlags.test.ts`
- `tests/integration/costLedger.test.ts`
- `tests/integration/persistedProducer.test.ts`
- `tests/e2e/codexOutputSchema.test.ts`
- `tests/e2e/claudeJsonSchema.test.ts`

### Boundary contracts

Producer: `src/schemas/codeReview.ts` and `src/schemas/complianceReview.ts` (the answer schemas and their readers), and the schemas package (`parseCodeReviewAnswer`, `parseComplianceReviewAnswer`). Consumers: the review use cases (`src/app/reviewCode.ts`, `src/app/reviewCompliance.ts`), the provider flags through `answerJsonSchema`, the prompts, and external readers of session transcripts. Stable shape: an answer is `$schema` first, naming its answer format at its current stamp, then exactly today's fields. Any other key is refused at any level, `id` included.

### Test strategy

- a code-review answer whose finding carries an id is refused naming findings[0].id as an unexpected key, and no code-review.json is written — medium · example · the failed review's reason after the corrective resume and the run folder without code-review.json · in-phase · AC-session-id-refused
- a compliance-review answer whose finding carries an id is refused naming the key's path — small · example · readComplianceReviewAnswer's refusal text · in-phase
- the published JSON Schema of each answer format accepts exactly the corpus documents its decoder accepts — small · table · the behaviour corpus cases against the next snapshots and the schemas check · in-phase
- phax's answer readers and the schemas package's parsers reach the same verdict on generated answers and on arbitrary JSON — small · property · the persisted-formats property suite on its fixed seed · in-phase
- the review sessions are handed the answer formats' schemas, and the code review prompt's empty answer names the code-review-answer stamp — small · example · answerJsonSchema of each answer format and the prompt text · in-phase

### Implementation order

1. schemaUrl.ts registration
2. the answer schemas and readers in codeReview.ts and complianceReview.ts
3. answerSchemas.ts, the use cases and the prompts
4. the schemas package formats, index and build tables
5. schemas-check --write, then the check
6. corpus cases, property registry and the per-format test tables
7. retargeted answer fixtures and the refusal tests
8. README rows

### Excluded scope

- Any change to the shape or stamp of `code-review.json` or `compliance-review.json` (phase-02).
- Finding ids, their numbering and their lift (phases 02 and 03).
- The call ids `code-review` and `compliance-review` of the structured-call table: they stay as they are.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

List the exported names added to `src/schemas/codeReview.ts`, `src/schemas/complianceReview.ts` and the schemas package. Give the two answer formats' stamps as `src/schemas/release.ts` now holds them, with `next` snapshots. Say how each answer format is registered in `formatRegistry.ts` (a reader or `writeOnly`, with its reason), and give the seed and result of the `pnpm test:property:deep` run. List which test fixtures were retargeted from the file stamp to the answer stamp. Explain any deviation from the planned file lists.

### Commit subject

`feat(review): give the code and compliance review answers their own formats`

### Commit body

The headless code review and the compliance review sessions now answer
code-review-answer and compliance-review-answer, born at this release with
exactly today's answer shape: any unknown key, an id on a finding included,
is refused by name. The run folder's code-review.json and
compliance-review.json keep their shape for now, so the file can gain
finding ids without the session ever writing one (spec finding-ids-and-fates
§5.2). Both answers are published by the schemas package, with their JSON
Schemas, behaviour corpus cases and property-test generators.

---

## phase-02 — Review files carry run-unique finding ids {#phase-02-review-file-finding-ids}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** Two published formats change shape at once, each with a frozen decoder, a shape-tagged reader whose consumers must be adapted, package releases and property entries. The phase also designs the numbering fold that every later phase relies on, so the default effort is not enough.

`code-review.json` gives each finding an `F<n>` id, and `compliance-review.json` gives each finding a `C<n>` id across `perPhase` in document order, under new shapes stamped at the opened version. The 0.32.0 files stay readable through frozen decoders, as id-less older shapes. A pure fold numbers a run's findings: it keeps persisted ids, and it lifts id-less reviews by position after the highest id before them. A review is numbered after the highest id of the run folder's current file.

### Detailed instructions

- Read the Technical arbitrations (where reviews are read, lifting ids). Read `src/schemas/codeReview.ts`, `src/schemas/complianceReview.ts`, `src/schemas/history/code-review/0.29.0.ts`, `src/schemas/history/compliance-review/0.17.0.ts`, the readers `readCodeReviewFile` and `readComplianceReviewFile` in `src/schemas/persisted.ts`, `packages/schemas/src/formats/runDirectory.ts` (codeReviewFormat, complianceReviewFormat), `src/app/reviewCode.ts`, `src/app/reviewCompliance.ts`, `src/app/publishRun.ts`, and `docs/property-tests.md` (frozen shapes).
- Freeze the current shapes first. Create `src/schemas/history/code-review/0.32.0.ts` and `src/schemas/history/compliance-review/0.32.0.ts`, modelled on the 0.29.0 module. Each is self-contained, imports only `effect`, and carries its own closed ids and refusal overrides. Its `$schema` field renders exactly as the released `packages/schemas/snapshots/<id>/0.32.0.schema.json`. Export `CodeReviewV0_32_0Schema`, `CodeReviewV0_32_0` and `decodeCodeReviewV0_32_0`, and the compliance equivalents, each decoder with `onExcessProperty: "error"`. The header comment says never to edit the module: `packages/schemas/history.lock.json` pins its bytes.
- Add the ids to the file shapes. In `src/schemas/codeReview.ts`, export `CodeReviewFindingIdSchema` (a NonEmptyString-based string matching `^F[1-9][0-9]*$`, with a refusal override naming the expected form `F<n>`). The file finding is `{ id, ...the answer finding's fields }`, `id` first. `CodeReviewFileSchema` becomes `{ $schema: answerSchemaUrlField("code-review"), findings: Schema.Array(file finding) }`; keep the const field. Export `PersistedCodeReview`, the in-memory value with ids and no `$schema`. `codeReviewFileText(review: PersistedCodeReview)`. `CodeReview` (no ids) stays the answer's in-memory value.
- In `src/schemas/complianceReview.ts`, do the same with `ComplianceFindingIdSchema` (`^C[1-9][0-9]*$`): a file finding is `{ id, dimension, severity, message }`, `PhaseVerdict` in the file holds file findings, and `PersistedComplianceReview` is the in-memory file value. `complianceReviewFileText(review: PersistedComplianceReview)`. `ComplianceReview` (no ids) stays the answer's value. `AnyShapeComplianceReview` stays the fields every shape carries, with findings that may or may not hold an id.
- Readers in `src/schemas/persisted.ts`. `readCodeReviewFile` returns `CodeReviewRead` = `{ shape: "current"; review: PersistedCodeReview } | { shape: "0.32.0" | "0.29.0"; review: CodeReview }`. It reads a file stamped 0.32.0 or later, below the current stamp, with the frozen 0.32.0 decoder; a file stamped lower with the frozen 0.29.0 decoder; and a current-stamp file with the current decoder, which refuses a finding without `id`. `ComplianceReviewRead` gains `{ shape: "0.32.0"; review: ComplianceReview }`, read by the frozen 0.32.0 decoder for stamps from 0.32.0 below the current stamp; 0.17.0 and pre-schema stay as they are. `current` carries `PersistedComplianceReview`. Update the reader comments and the module's header paragraph. A read never rewrites a file.
- Adapt the readers' consumers. `src/app/publishRun.ts` reads `.review` from the tagged code-review read and uses only the fields every shape carries. `loadCodeReviewWorklist` in `src/app/reviewCode.ts` keeps reading the fields every compliance shape carries. Change no other behaviour of either.
- Create `src/domain/findings/runFindings.ts`, pure and with no I/O. It exports:
  - `RunReview`, a union: `{ source: "code-review"; ids: "persisted"; review: PersistedCodeReview } | { source: "code-review"; ids: "absent"; review: CodeReview } | { source: "compliance-review"; ids: "persisted"; review: PersistedComplianceReview } | { source: "compliance-review"; ids: "absent"; review: AnyShapeComplianceReview }`;
  - `RunFinding`, each finding with `id`, `source`, `origin` (`persisted` or `lifted`) and its fields: severity, file, line, message, lens, escape, criterion and suggestion for a code-review finding; phaseId, dimension, severity and message for a compliance finding;
  - `numberRunFindings(reviews: readonly RunReview[])`. It takes reviews oldest first and returns `{ findings, highest: { F, C } }`. Per kind, a persisted review keeps its ids and raises the highest to its largest. An id-less review gets ids by position after the highest so far, in document order: compliance across `perPhase` in order, then within each phase.
  Findings are returned F before C, each in increasing number. Also export `assignCodeReviewIds(review: CodeReview, after: number): PersistedCodeReview` and `assignComplianceReviewIds(review: ComplianceReview, after: number): PersistedComplianceReview`, each numbering in document order from `after + 1`. Export only what this phase uses: knip runs at the gate.
- Number at persist time. `reviewCodeHeadless` takes a new required option `findingsAfter: number` (the highest F number the run has given) and writes `assignCodeReviewIds(answer, findingsAfter)`. `HeadlessCodeReviewResult`'s accepted `review` is the `PersistedCodeReview`. `reviewCompliance`'s options gain `findingsAfter`, and it writes `assignComplianceReviewIds(answer, findingsAfter)`; its generated result's `review` is the persisted value, and `renderComplianceReviewMarkdown` keeps taking what it needs. `reviewCodeAndRecord` and `reviewComplianceAndRecord` compute `findingsAfter` in this phase from the run folder's current file of their kind. They read it through the reader, turn it into a `RunReview` and take `numberRunFindings([that]).highest`. A missing file counts 0. An unreadable file counts 0, with `opts.output.warn` naming it. Their signatures do not change, so `src/app/executePlan.ts` and `src/cli/definitions/review.ts` need no change unless the compiler says so.
- Schemas package: in `packages/schemas/src/formats/runDirectory.ts`, add the 0.32.0 frozen shape as a release of `codeReviewFormat` and of `complianceReviewFormat`. Extend `CodeReviewShapes` and `ComplianceReviewShapes`. `toLatestCodeReview` and `toLatestComplianceReview` keep every recorded fact. On an older shape, each finding's `id` is `Unknown`, and the doc comment says why: phax lifts it by position across the run's reviews, which one file alone cannot tell. Update the `Latest…` types and the exports in `packages/schemas/src/index.ts`.
- Run `pnpm exec tsx scripts/schemas-check.ts --write`. It creates `packages/schemas/snapshots/code-review/next.schema.json` and `packages/schemas/snapshots/compliance-review/next.schema.json`, moves both stamps in `src/schemas/release.ts` to the opened version, and updates the generated index, `shipped-json.json` and `history.lock.json`. Then run it without the flag and make it pass. Never edit generated files by hand.
- Corpus and property registry. In `tests/behaviourCorpus/cases/formats/code-review.json` and `compliance-review.json`, add current-shape documents with ids, and refusals for a missing id, an id of the wrong kind (`C1` in a code review), `F0` and an unknown key. Keep a 0.32.0-stamped document read as its frozen shape. Update the `encode/` cases to write ids. In `tests/helpers/property/formatRegistry.ts`, add the 0.32.0 frozen entries for both formats (code-review: 0.29.0 then 0.32.0; compliance-review: pre-schema, 0.17.0, 0.32.0). The `valid` generators derive the new shapes, and a repair keeps ids well formed (for example `finding-ids-are-numbered-from-one`) if the derivation does not. Run `pnpm test:property:deep tests/unit/property/persistedFormats.property.test.ts` once and record the seed and the result.
- Tests:
  - `tests/unit/findings/runFindings.test.ts`: a table of review sequences and their expected ids. It covers a persisted review, an id-less review lifted, two id-less reviews lifting F1–F3 then F4–F5, a persisted review after a lifted one, compliance ids across `perPhase`, an empty review, and each kind numbered on its own.
  - `tests/unit/persisted.test.ts`: the reader cases for both formats and every shape.
  - `tests/integration/codeReviewRecord.test.ts`, AC-ids-assigned: a first review answering three findings writes `code-review.json` whose `$schema` equals `currentSchemaUrl("code-review")`, with ids F1, F2, F3 in answer order, and the record's `<runId>/code-review/code-review.json` on the records branch holds the same bytes. A second review answering two findings writes F4 and F5.
  - `tests/integration/complianceReviewRecord.test.ts`, AC-compliance-ids: an answer with one finding in phase-01 and two in phase-02 is written with C1 (phase-01), then C2 and C3 (phase-02).
  Every other test that calls `reviewCodeHeadless` or `reviewCompliance` directly passes `findingsAfter`.

### Planned files to create

- `src/domain/findings/runFindings.ts`
- `src/schemas/history/code-review/0.32.0.ts`
- `src/schemas/history/compliance-review/0.32.0.ts`
- `packages/schemas/snapshots/code-review/next.schema.json`
- `packages/schemas/snapshots/compliance-review/next.schema.json`
- `tests/unit/findings/runFindings.test.ts`

### Planned files to edit

- `src/schemas/codeReview.ts`
- `src/schemas/complianceReview.ts`
- `src/schemas/persisted.ts`
- `src/schemas/release.ts`
- `src/app/reviewCode.ts`
- `src/app/reviewCompliance.ts`
- `src/app/publishRun.ts`
- `packages/schemas/src/formats/runDirectory.ts`
- `packages/schemas/src/index.ts`
- `packages/schemas/src/generated/index.ts`
- `packages/schemas/shipped-json.json`
- `packages/schemas/history.lock.json`
- `tests/behaviourCorpus/cases/formats/code-review.json`
- `tests/behaviourCorpus/cases/formats/compliance-review.json`
- `tests/behaviourCorpus/cases/encode/code-review.json`
- `tests/behaviourCorpus/cases/encode/compliance-review.json`
- `tests/helpers/property/formatRegistry.ts`
- `tests/unit/persisted.test.ts`
- `tests/unit/schemas/codeReview.test.ts`
- `tests/unit/schemas/complianceReview.test.ts`
- `tests/type/schemasPackage.ts`
- `tests/unit/schemasPackage/runDirectoryFormats.test.ts`
- `tests/unit/schemasPackage/documents.ts`
- `tests/integration/codeReviewRecord.test.ts`
- `tests/integration/complianceReviewRecord.test.ts`

### Optional files that may be edited

- `src/app/executePlan.ts`
- `src/cli/definitions/review.ts`
- `src/domain/review/compliancePrompt.ts`
- `packages/schemas/build/jsonSchemas.ts`
- `tests/behaviourCorpus/baseline/snapshot-digests.json`
- `tests/behaviourCorpus/subjects.ts`
- `tests/unit/architecturalGuards.test.ts`
- `tests/unit/schemasPackage/documents.test.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/currentShapes.test.ts`
- `tests/unit/schemasPackage/jsonSchemas.test.ts`
- `tests/unit/schemasPackage/frozenHistory.test.ts`
- `tests/unit/schemasPackage/parseDocument.test.ts`
- `tests/unit/schemasPackage/exports.test.ts`
- `tests/integration/reviewCodeHeadless.test.ts`
- `tests/integration/reviewCompliance.test.ts`
- `tests/integration/reviewComplianceCommand.test.ts`
- `tests/integration/reviewCode.test.ts`
- `tests/integration/headlessCodeReviewRunEnd.test.ts`
- `tests/integration/reviewCommandsJson.test.ts`
- `tests/integration/publishRun.test.ts`
- `tests/integration/persistedProducer.test.ts`
- `tests/unit/review/codeReviewWorklist.test.ts`

### Boundary contracts

Producer: the file schemas and readers (`src/schemas/codeReview.ts`, `src/schemas/complianceReview.ts`, `src/schemas/persisted.ts`), and `src/domain/findings/runFindings.ts`. Consumers: the review use cases, which number and write the files; `publishRun` and the code review's worklist, which read them; and, later, the run's review history (phase-03) and `phax finding list` (phase-06). Stable shape: a current file's findings carry `id` (`F<n>` or `C<n>`, n from 1), and a read reports its shape. An older shape is never given ids by its reader. Ids are given by `numberRunFindings` over the run's reviews, oldest first.

### Test strategy

- a first headless code review answering three findings writes code-review.json at the code-review format's current stamp with ids F1, F2, F3 in answer order, and the review record holds the same bytes — medium · example · the run folder's file against currentSchemaUrl and the records branch blob at the run's code-review key · in-phase · AC-ids-assigned
- a compliance answer with one finding in phase-01 and two in phase-02 is written with C1, then C2 and C3, in document order — medium · example · compliance-review.json as written · in-phase · AC-compliance-ids
- the fold keeps persisted ids, lifts id-less reviews by position after the highest id before them, numbers each kind on its own and reports the highest of each — small · table · hand-written review sequences and their expected ids · in-phase
- a file stamped 0.32.0 or 0.29.0 reads as its older shape without ids, and a current-stamp file whose finding lacks an id is refused — small · example · the readers' tagged results and refusal messages · in-phase
- every shape of code-review and compliance-review, current and frozen, reads its written encoding back and agrees with the schemas package — small · property · the persisted-formats property suite on its fixed seed · in-phase
- the schemas package upgrades an id-less older review with each finding's id Unknown and keeps every other fact — small · example · toLatestCodeReview and toLatestComplianceReview results · in-phase

### Implementation order

1. the frozen 0.32.0 modules
2. the file schemas with ids and the in-memory types
3. the tagged readers in persisted.ts and their consumers
4. src/domain/findings/runFindings.ts and its table test
5. persist-time numbering in the review use cases
6. the schemas package formats
7. schemas-check --write, then the check
8. corpus, property registry and the per-format tests
9. the AC-ids-assigned and AC-compliance-ids integration tests

### Excluded scope

- Reading earlier reviews from the records branch (phase-03): numbering here continues after the run folder's file only.
- The finding-list format and `phax finding list` (phases 04 to 06).
- Showing ids in `compliance-review.md` or in the run's pull request (plan 3).
- Any fate.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

Give the exported names of `src/domain/findings/runFindings.ts` with their signatures, and the new types and schemas of `src/schemas/codeReview.ts` and `src/schemas/complianceReview.ts`. Give the shapes `readCodeReviewFile` and `readComplianceReviewFile` now report. State the stamps in `src/schemas/release.ts` (both formats at the opened version through `next` snapshots). Say where `findingsAfter` is computed today: the run folder's file, so phase-03 knows what to replace. Give the seed and result of the `pnpm test:property:deep` run. Explain any deviation from the planned file lists.

### Commit subject

`feat(review): number review findings with run-unique F and C ids`

### Commit body

code-review.json and compliance-review.json move to new shapes whose
findings carry an id: F<n> for a code-review finding, C<n> for a
compliance finding across perPhase in document order. phax assigns them
when it persists a review, after the highest id the run already holds;
the session never writes one. The 0.32.0 files stay readable through
frozen decoders as id-less shapes, and a pure fold (numberRunFindings)
lifts their ids by position after the reviews before them. The schemas
package reads every shape, an older finding's id as Unknown.

---

## phase-03 — Numbering continues across the run's recorded reviews {#phase-03-numbering-across-recorded-reviews}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

phax reads a run's reviews from the records branch, oldest first, and from the run folder. A new review is numbered after the highest id of all of them, so an id is never reused within a run, even across an empty review or an older review whose ids are lifted. With records off or unreadable, numbering falls back to the run folder and says so.

### Detailed instructions

- Read the Technical arbitrations (where a run's reviews are read, lifting ids). Read `src/app/recordsList.ts` (how the records tip is resolved: the local `phax/records/v1`, else the remote-tracking ref), `src/app/writeReviewRecord.ts` (`reviewRecordKey`, the record's files), `src/app/reviewEntry.ts` (`ReviewRecordTarget`, `ReviewRecordUnresolved`), the Git port (`listCommitFiles`, `readTree`, `readBlob`, `resolveRef`) and `src/domain/findings/runFindings.ts` from phase-02.
- Create `src/app/runReviews.ts`. Export `RunReviewSource`: `{ kind: "off" } | { kind: "repo"; path: string; remoteRef: string } | { kind: "unavailable"; reason: string }`. `path` is the repository holding the records branch (the source repository in-repo, the records clone for a `repo` destination). `remoteRef` is the remote-tracking ref to fall back on: `refs/remotes/<publish.remote>/phax/records/v1` in-repo, `refs/remotes/origin/phax/records/v1` for a clone. Also export `reviewSourceOf(target: ReviewRecordTarget | ReviewRecordUnresolved): RunReviewSource`. Records disabled gives `off`. An unresolved target gives `unavailable` with its reason. A `repo` destination whose clone path is missing gives `unavailable` naming it.
- In the same module export `readRunReviews(input: { runId: string; runFolder: string | null; source: RunReviewSource })`, an Effect over FileSystem and Git. It returns `{ reviews: readonly ReadRunReview[]; records: "read" | "off" | "unavailable"; notes: readonly string[]; unreadable: readonly { where: string; message: string }[] }`, where `ReadRunReview` is `{ review: RunReview; from: "records" | "run-folder"; recordCommit: string | null }`. The steps:
  - With a `repo` source, resolve the tip as `recordsList.ts` does. No branch means no recorded review.
  - List the branch's commits oldest first with `listCommitFiles(path, tip, null)`, and keep those whose paths include `<runId>/code-review/code-review.json` or `<runId>/compliance-review/compliance-review.json`.
  - Read each such file's blob (`readTree`, then `readBlob`), parse it, and read it with `readCodeReviewFile` / `readComplianceReviewFile`, labelled `<sha8>:<path>`. A shape `current` becomes `ids: "persisted"`, any other shape `ids: "absent"`.
  - Then read the run folder's two files, when `runFolder` is not null and the file exists. Append each as the newest review of its kind only when its bytes differ from the newest recorded file of that kind.
  - A document that cannot be parsed or read goes to `unreadable`, never to `reviews`.
  - A git failure while reading the records gives `records: "unavailable"` with a note naming it, and the run folder is still read. `off` gives `records: "off"`.
  No network, and no GitHub.
- Replace phase-02's run-folder-only numbering. `reviewCodeAndRecord` computes `findingsAfter = numberRunFindings(reviews of kind code-review).highest.F` over `readRunReviews({ runId: info.runId, runFolder: info.runPath, source: reviewSourceOf(target) })`, read before the session starts. `reviewComplianceAndRecord` does the same with C. Each note and each unreadable document becomes one `opts.output.warn` line. An unreadable document's line says the numbering continues after the readable reviews. Neither ever fails the review. Delete whatever phase-02 helper this makes unused (knip).
- Create `tests/integration/runReviews.test.ts` with real git in a temporary repository, as `tests/integration/codeReviewRecord.test.ts` sets one up, and records written by `writeReviewRecord`. It covers:
  - two recorded code reviews read oldest first;
  - a run folder file equal to the newest record read once;
  - a run folder file that differs appended last;
  - a 0.32.0-stamped recorded file read with `ids: "absent"`;
  - records off gives `off` with the run folder alone;
  - a missing clone gives `unavailable` with a note;
  - an undecodable recorded file lands in `unreadable`.
- Extend `tests/integration/codeReviewRecord.test.ts` for AC-rereview-continues' numbering. Three reviews run with records in-repo: three findings, then none, then two. The third `code-review.json` holds F4 and F5, although the run folder held an empty review before it. A second case puts a 0.32.0-stamped `code-review.json` of three findings on the records branch as an earlier record (`writeReviewRecord` from a run folder holding that file); the next review then starts at F4. Extend `tests/integration/complianceReviewRecord.test.ts`: a second compliance review continues after the first's C ids. Add a records-off case: numbering continues from the run folder's file, and the warning names records off.

### Planned files to create

- `src/app/runReviews.ts`
- `tests/integration/runReviews.test.ts`

### Planned files to edit

- `src/app/reviewCode.ts`
- `src/app/reviewCompliance.ts`
- `tests/integration/codeReviewRecord.test.ts`
- `tests/integration/complianceReviewRecord.test.ts`

### Optional files that may be edited

- `src/app/recordsList.ts`
- `src/app/reviewEntry.ts`
- `src/domain/findings/runFindings.ts`
- `tests/integration/headlessCodeReviewRunEnd.test.ts`
- `tests/integration/reviewCommandsJson.test.ts`
- `tests/integration/reviewCompliance.test.ts`
- `tests/integration/reviewCodeHeadless.test.ts`

### Boundary contracts

Producer: `src/app/runReviews.ts` (`readRunReviews`, `reviewSourceOf`, `RunReviewSource`, `ReadRunReview`). Consumers: the review use cases (persist-time numbering), and in phase-06 `phax finding list`. Contract: a run's reviews come back oldest first. Recorded reviews come in records-branch order. Then the run folder's file comes, only when its bytes differ from the newest record of its kind. Each review is tagged with where it came from, and the source's state is reported as `read`, `off` or `unavailable`. Unreadable documents are returned apart, never dropped silently. Reading touches only the local repository: no fetch, no GitHub.

### Test strategy

- a review after one of F1 to F3 gets F4 and F5 even when a review with no finding came between them — medium · example · the third code-review.json's ids with the run folder replaced at each review · in-phase · AC-rereview-continues
- a run's reviews are read oldest first from the records branch, with the run folder's file appended only when its bytes differ from the newest entry of its kind — medium · example · the review list against records written by writeReviewRecord in a temporary repository · in-phase
- an id-less review on the records branch is lifted before a new review is numbered after it — medium · example · the new code-review.json's first id · in-phase
- with records off or a records branch that cannot be read, numbering continues from the run folder alone and the review is still written with a warning — medium · example · the written file's ids and the warning text · in-phase
- a second compliance review continues after the first's C ids — medium · example · the second compliance-review.json's ids · in-phase

### Implementation order

1. RunReviewSource and reviewSourceOf
2. readRunReviews over the records branch
3. the run folder's file and its comparison with the newest record
4. persist-time numbering in reviewCodeAndRecord and reviewComplianceAndRecord
5. runReviews.test.ts
6. the numbering cases in the review record tests

### Excluded scope

- `phax finding list` and its answer (phases 04 to 06).
- Fetching the records remote: phax reads only what is local.
- Any change to how a review record is written.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

Give the exports of `src/app/runReviews.ts` with their signatures, and the exact `records` and note wording for `off` and `unavailable`. Say how the records tip is resolved, and whether any helper was extracted from `recordsList.ts`. Say which phase-02 helper was removed. Explain any deviation from the planned file lists.

### Commit subject

`feat(review): continue finding numbering across the run's recorded reviews`

### Commit body

A new review is now numbered after the highest id of every review of the
run: the entries under its code-review and compliance-review keys on
phax/records/v1, oldest first, and the run folder's file when it differs
from the newest of them. An id is never reused across an empty review or
an older review whose ids are lifted by position. With records off or a
records branch that cannot be read, numbering falls back to the run folder
and the review says so; it never fails for it.

---

## phase-04 — The finding-list document format {#phase-04-finding-list-format}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

Register `finding-list`, the versioned document `phax finding list --json` will print. It is born with `$schema` at the opened version, carries the run, whether the records could be read, and every finding with its id, source, fields, fate and history. The schemas package publishes it.

### Detailed instructions

- Read the Technical arbitrations (the `finding-list` answer's history, the answer's shape). Read `src/schemas/planLint.ts` and how `plan-lint` is registered everywhere: grep the repository for `plan-lint` outside docs/. Read `packages/schemas/src/formats/commandAnswers.ts`. A finding list is registered the same way: a command answer phax never saves or reads.
- Create `src/schemas/findingList.ts`. Export:
  - `FINDING_FATES = ["open", "fixed", "dismissed", "deferred", "unrecorded"]` and `FindingFateSchema`, a literals schema with a refusal override naming the set;
  - `FindingListRecordsSchema`, the literals `read`, `off` and `unavailable`;
  - `CodeReviewFindingEntrySchema`: `{ id: CodeReviewFindingIdSchema, source: Literal("code-review"), severity: CodeReviewSeveritySchema, file, line, message, lens, escape, criterion, suggestion, fate: FindingFateSchema, history }`, with the same field schemas as the code-review file finding;
  - `ComplianceFindingEntrySchema`: `{ id: ComplianceFindingIdSchema, source: Literal("compliance-review"), severity: compliance SeveritySchema, phaseId: NonEmptyString, dimension: DimensionSchema, message: Schema.String, fate, history }`;
  - `history`, typed as `Schema.Tuple([])` and described as `The finding's fate records, oldest first. Empty until fate records exist.`;
  - the document fields: `run: { namespace, shortName, runId, state: RunStateSchema }` (`namespace`, `shortName` and `runId` NonEmptyString), `records: FindingListRecordsSchema` and `findings: Schema.Array(Schema.Union([code, compliance]))`;
  - `FindingListDocument` (no `$schema`), and `FindingListFileSchema` = `{ $schema: schemaUrlField("finding-list"), ...fields }` (or the const field `planLint.ts` uses, whichever command answers use);
  - `FindingListFile`, `decodeFindingListFile` (onExcessProperty error, reportInput) and `encodeFindingListFile`.
  If the property derivation cannot generate the empty tuple, say so in the handoff and add a repair; never loosen the schema.
- Register the format. Append `finding-list` at the end of `FORMAT_IDS` and `SCHEMA_BORN_FORMAT_IDS` in `src/schemas/schemaUrl.ts` and extend both doc comments: the answer of `phax finding list --json`, of spec finding-ids-and-fates, never saved. In the schemas package, add `findingListFormat`, `parseFindingList`, `toLatestFindingList` (drops `$schema`), and the `LatestFindingList`, `FindingListShapes` and `FindingListShape` types to `packages/schemas/src/formats/commandAnswers.ts`, as for plan-lint. Export them and `FindingListSchema` / `FindingList` from `packages/schemas/src/index.ts`, add the format to its format map, and add it to `packages/schemas/build/jsonSchemas.ts` (`FORMAT_DEFINITIONS`, the excess map `error`).
- Run `pnpm exec tsx scripts/schemas-check.ts --write`. It creates `packages/schemas/snapshots/finding-list/next.schema.json`, sets `CURRENT_STAMPS["finding-list"]` to the opened version, and updates the generated index and `shipped-json.json`. Then run it without the flag and make it pass.
- Add `tests/behaviourCorpus/cases/formats/finding-list.json`. Its valid documents: one with a code-review and a compliance finding, open and unrecorded, and one with no finding and `records: "off"`. Its refusals:
  - an unknown key;
  - a fate outside the five;
  - a code-review entry whose id is `C1`;
  - a compliance entry with a `file`;
  - a non-empty `history`;
  - a missing `$schema`.
  Register the subject in `tests/behaviourCorpus/subjects.ts` and `tests/unit/behaviourCorpus/coverage.test.ts`. Add an `encode/` case only if the coverage test asks for one.
- Register `finding-list` in `tests/helpers/property/formatRegistry.ts` as `plan-lint` is: `phax: null`, `writeOnly: "`phax finding list --json` prints it; phax never saves or reads one"`, and `parse: fromPackage(parseFindingList)`. Run `pnpm test:property:deep tests/unit/property/persistedFormats.property.test.ts` once and record the seed and the result.
- Create `tests/unit/schemas/findingList.test.ts`. A document of each source decodes and round-trips through `encodeFindingListFile`. The refusals above are refused with their paths. `FINDING_FATES` equals the five fates of the spec, in that order. Update the per-format tables the compiler or a test names: `tests/unit/schemaUrl.test.ts`, `tests/type/schemasPackage.ts`, `tests/unit/schemasPackage/commandAnswersFormat.test.ts` and `tests/unit/schemasPackage/documents.ts`. Never name the opened version: take the stamp from `CURRENT_STAMPS`.
- Add a row to README.md's `## Persisted formats` table after the plan lint row: `Finding list` | `finding-list` | the output of `phax finding list --json`, never saved | `parseFindingList` | `json/finding-list.schema.json`.

### Planned files to create

- `src/schemas/findingList.ts`
- `packages/schemas/snapshots/finding-list/next.schema.json`
- `tests/behaviourCorpus/cases/formats/finding-list.json`
- `tests/unit/schemas/findingList.test.ts`

### Planned files to edit

- `src/schemas/schemaUrl.ts`
- `src/schemas/release.ts`
- `packages/schemas/src/formats/commandAnswers.ts`
- `packages/schemas/src/index.ts`
- `packages/schemas/src/generated/index.ts`
- `packages/schemas/build/jsonSchemas.ts`
- `packages/schemas/shipped-json.json`
- `tests/helpers/property/formatRegistry.ts`
- `tests/behaviourCorpus/subjects.ts`
- `tests/unit/behaviourCorpus/coverage.test.ts`
- `tests/unit/schemaUrl.test.ts`
- `tests/type/schemasPackage.ts`
- `tests/unit/schemasPackage/commandAnswersFormat.test.ts`
- `tests/unit/schemasPackage/documents.ts`
- `README.md`

### Optional files that may be edited

- `src/schemas/codeReview.ts`
- `src/schemas/complianceReview.ts`
- `tests/behaviourCorpus/cases/encode/finding-list.json`
- `tests/behaviourCorpus/baseline/snapshot-digests.json`
- `tests/unit/architecturalGuards.test.ts`
- `tests/unit/schemasPackage/documents.test.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/currentShapes.test.ts`
- `tests/unit/schemasPackage/jsonSchemas.test.ts`
- `tests/unit/schemasPackage/exports.test.ts`
- `tests/unit/schemasPackage/parseDocument.test.ts`
- `tests/unit/schemasPackage/shippedJson.test.ts`

### Boundary contracts

Producer: `src/schemas/findingList.ts` and the schemas package's `parseFindingList`. Consumers: `phax finding list --json` (phase-06), its acceptance tests (phase-05), the knowledge index and scripts. Stable shape: `$schema` first, naming `finding-list`. Then come `run` (namespace, shortName, runId, state), `records` (`read`, `off` or `unavailable`) and `findings`. Each finding is discriminated by `source`, carries its id, its review's fields, `fate` (one of five) and `history` (empty in this plan; plan 2 widens its items). Unknown keys are refused.

### Test strategy

- a finding-list document of each source decodes and round-trips, and an unknown key, a fate outside the five, an id of the wrong kind and a non-empty history are refused — small · example · decode of encode equals the input; the refusal's path · in-phase
- the published JSON Schema of finding-list accepts exactly the corpus documents the decoder accepts — small · table · the next snapshot judged by the behaviour corpus and the schemas check · in-phase
- the schemas package's parseFindingList reaches phax's decoder verdict on generated documents and on arbitrary JSON — small · property · the persisted-formats property suite on its fixed seed · in-phase

### Implementation order

1. src/schemas/findingList.ts
2. schemaUrl.ts registration
3. the schemas package format, index and build tables
4. schemas-check --write, then the check
5. corpus case, property registry and the per-format tables
6. findingList.test.ts
7. README row

### Excluded scope

- Producing a finding list, and the command (phase-06).
- Fate records and a non-empty `history` (plan 2).

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

List the exports of `src/schemas/findingList.ts` and of the schemas package. Say how `history` is declared and how its JSON Schema renders. Give the stamp (the opened version, `next` snapshot) and the seed and result of the `pnpm test:property:deep` run. Explain any deviation from the planned file lists.

### Commit subject

`feat(schemas): add the finding-list document format`

### Commit body

Register finding-list, the document phax finding list --json will print,
born with $schema through a next snapshot: the run (namespace, short name,
run id, state), whether its records could be read, and every finding with
its id, source, review fields, fate (open, fixed, dismissed, deferred,
unrecorded) and history, empty until fate records exist. The schemas
package publishes it with its JSON Schema and parser.

---

## phase-05 — Acceptance tests of phax finding list {#phase-05-finding-list-acceptance}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium
**Acceptance phase:** passed by phase-06
**Acceptance test files:** `tests/integration/findingList.test.ts`, `tests/fixtures/findings/findingRunRepo.ts`

Write what `phax finding list` must answer as frozen acceptance tests, through the command runner: older reviews listed as `unrecorded` with lifted ids, the versioned `--json` document, and a re-review that keeps every earlier finding. Each test fails today on its own assertion against a stub `finding` group, and phase-06 passes them.

### Detailed instructions

- Read the Technical arbitrations, and phases 02 to 04's handoffs (`numberRunFindings`, `readRunReviews`, `src/schemas/findingList.ts`). Read `tests/helpers/runnerCall.ts`, `tests/integration/reviewCommandsJson.test.ts` (how a run is seeded on disk under a temporary state root, with a temporary PHAX home and `vi.mock("node:os")`), `tests/integration/codeReviewRecord.test.ts` (`reviewCodeAndRecord` with the fake backend over real git and records in-repo), and `src/cli/definitions/path.ts`.
- Write the stub the tests load against. Create `src/cli/definitions/finding.ts` exporting `findingGroup`, a `defineGroup` named `finding` with the summary `Read the findings of a run's reviews and their fates`. It holds one `defineCommand` named `list` with the summary `List a run's findings with their ids and fates`, `input: {}` and `exits: {}`. Its run dies with `not implemented: phax finding list (phase-06)`. Do not add it to `phaxProgram`. Because the stub declares no argument, every call today is refused as undeclared.
- Write `tests/fixtures/findings/findingRunRepo.ts`, a builder that makes, in temporary directories:
  - a git repository (isolateGit) with its own user.name and user.email, and phax.json with a `state.root` inside it, records in-repo enabled with `autoPush: false`, and the code review enabled;
  - a temporary PHAX home;
  - one run registered and on disk in state `review_open` (registry entry, run-status.json, phase-01 status, its git worktree), seeded as the review commands' tests do.
  It returns the run's short name, run id and run folder. It also exports these helpers:
  - `writeOlderReviews()`: writes `code-review.json` stamped `schemaUrl("code-review", "0.32.0")` with three findings, and `compliance-review.json` stamped `schemaUrl("compliance-review", "0.32.0")` with one finding in phase-01 and two in phase-02. These are literal JSON in the frozen 0.32.0 shapes, with no ids.
  - `writeCurrentReviews()`: writes, through `codeReviewFileText` and `complianceReviewFileText`, a code review F1 and F2 and a compliance review C1.
  - `reviewOnce(messages)`: runs `reviewCodeAndRecord` for the run with the fake backend answering a `code-review-answer` whose findings carry those messages.
  It reads nothing outside its temporary directories and never names the opened version.
- Write `tests/integration/findingList.test.ts`. Every test is its own `it.fails(...)`. It calls `runnerCall([findingGroup], argv)` with the process working directory set to the fixture repository, and judges only what the spec states and this plan's arbitrations fix:
  - AC-lift-unrecorded: after `writeOlderReviews()`, `finding list <run> --json` exits 0. The answer's findings are, in order, F1, F2, F3 (source `code-review`) and C1 (phase-01), C2, C3 (phase-02) (source `compliance-review`), each with fate `unrecorded` and an empty history. Both stored files are byte for byte as before the call. Also, `finding list <run>` without `--json` exits 0, and its stdout has one line for each of the six ids, each holding `unrecorded`.
  - AC-list-json: after `writeCurrentReviews()`, `finding list <run> --json` exits 0. Stdout is one JSON value whose first key is `$schema`, equal to `currentSchemaUrl("finding-list")`. `decodeFindingListFile` accepts it. `run` holds the fixture's short name, run id and `review_open`, and `records` is `read`. F1 and F2 carry `file`, `line`, `lens`, `escape`, `criterion` and `suggestion` as stored, C1 carries `phaseId` and `dimension`, and each is `open` with an empty history. Every stderr line parses as a message line (a JSON object whose `kind` is one of the message kinds).
  - AC-rereview-continues: `reviewOnce` with three messages, then with two. The run folder now holds only the second review. `finding list <run> --json` exits 0 and lists F1 to F5, all `open`: F1 to F3 carry the first review's messages, read from the records branch, and F4 and F5 the second's.
- Change no other source file. The tests reach the command only through the runner and the fixture, never a definition's internals. Run the gate and check that each marked test fails on its own assertion: an exit code or a missing document, not a missing module or export.

### Planned files to create

- `tests/integration/findingList.test.ts`
- `tests/fixtures/findings/findingRunRepo.ts`
- `src/cli/definitions/finding.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- `knip.json`

### Boundary contracts

Producer: phase-06's `findingGroup` from `src/cli/definitions/finding.ts`, holding `list`. Consumer: these acceptance tests, through `runnerCall` over a memory Io, with the working directory at the fixture repository. Contract:
- `finding list <run>` takes one positional run reference;
- `--json` writes one `finding-list` document on stdout, `$schema` first, and only message lines on stderr;
- without `--json`, one line per finding;
- exit 0 when the run's reviews can be read.

### Test strategy

- reviews persisted before finding ids list as F1… and C1… in document order across perPhase, each unrecorded with an empty history, and neither stored file changes — medium · example · the answer's ids, sources and fates, the text rows, and the files' bytes before and after the call · acceptance · AC-lift-unrecorded
- finding list --json writes one document with $schema first naming finding-list, whose findings carry id, source, fate and history, and stderr holds only message lines — medium · example · decodeFindingListFile of stdout, its first key against currentSchemaUrl, and each stderr line parsed as a message line · acceptance · AC-list-json
- after a second headless code review of two findings, finding list shows F1 to F5 open, F1 to F3 read from the records branch and F4 and F5 from the run folder's review — medium · example · the answer's ids, fates and messages against the two reviews' answers · acceptance · AC-rereview-continues

### Implementation order

1. the finding.ts stub
2. findingRunRepo.ts
3. findingList.test.ts with a marker on each test
4. run the gate to see each marked test fail on its assertion

### Excluded scope

- Implementing `phax finding list` (phase-06).
- Records off, archived runs and refusals, which phase-06 tests in-phase.
- Any fate other than open and unrecorded (plan 2).

### Verification

The `standard` gate profile in phax.json, with the configured acceptance provider judging the acceptance test files.

### Expected handoff content

Give the stub's export and what `findingRunRepo.ts` builds and returns, including the helpers' signatures. For each acceptance test, give the assertion it fails on today. Confirm that every test carries its own `.fails` marker, that the tests never name the opened version, and that no other source file changed. Explain any deviation from the planned file lists.

### Commit subject

`test(findings): acceptance tests for phax finding list`

### Commit body

Freeze what phax finding list answers before it exists: reviews persisted
before finding ids listed by position as unrecorded, the files untouched;
the --json answer as one finding-list document with $schema first and only
message lines on stderr; and a second headless review whose F4 and F5
join F1 to F3 read from the records branch. Each fails today against a
stub finding group that phase-06 replaces.

---

## phase-06 — phax finding list {#phase-06-finding-list-command}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** This is a new command group whose run resolution covers live, cross-project and archived runs. It must satisfy frozen acceptance tests it cannot change, so it needs more than the default effort.

Operators and scripts can run `phax finding list <run>`. It prints every finding of the run with its id, severity, location, message and fate, and under `--json` the `finding-list` document. It reads the run's reviews from its records and its run folder, live or archived, and never calls GitHub. The acceptance tests of phase-05 pass.

### Detailed instructions

- Read the Technical arbitrations (how a run is named, where reviews are read, the answer's shape), phase-05's handoff and its two acceptance test files. In `tests/integration/findingList.test.ts`, remove only the `.fails` markers. Change nothing else in it or in `tests/fixtures/findings/findingRunRepo.ts`, and never retype a test's title.
- In `src/domain/findings/runFindings.ts`, add `findingFate(finding: RunFinding)`. It answers `open` for a persisted finding and `unrecorded` for a lifted one, typed as the `FindingFateSchema` type. Plan 2 replaces it with the fate of the latest fate record.
- Create `src/app/findingList.ts` exporting `listRunFindings(input: { ref: string; config: ResolvedConfig })`. It returns `{ document: FindingListDocument; notes: readonly string[]; crossProject: boolean }` or a typed failure. The steps:
  - Resolve the run with `resolveRunRef(ref, config, config.stateRoot)`.
  - A live run reads its review source from `reviewSourceOf(reviewRecordTargetFor({ config, namespace, info, crossProject }))`. Its run folder is `info.runPath` and its state `info.runState`.
  - When resolution fails and the registry (`readRegistry`) holds the run in its namespace with state `archived`, the run resolves from that entry: runId, state `archived`, and run folder `<archivePath>/runs` when that directory exists, else null. The source is the current project's records for a run of this namespace, and `unavailable` otherwise.
  - Any other failure is `FindingRunRefError` with the resolver's sentence.
  - Read with `readRunReviews`, and refuse with `FindingReviewUnreadableError` naming the first unreadable document and its message.
  - Fold with `numberRunFindings`, map each finding to its entry with `findingFate` and `history: []`, and carry `records` and the notes. For `off`, the note is `records are off for this project: only the reviews in the run folder are listed`. For `unavailable`, the note names the reason.
  No GitHub port and no network.
- Replace the stub in `src/cli/definitions/finding.ts`. `findingGroup` holds `list` with `input: { args: reject(Schema.Tuple([ShortNameArg])) }` (from `./shared.js`, as `path` does) and `output: reject(FindingListFileSchema.annotate(publishedFormat("finding-list")))`. The output is `withSchemaUrl("finding-list", document)`, and each note goes to stderr through the run's `say` or `notes` hook, as the records commands do. It provides only the Node file system and Git layers. `exits`: `FindingRunRefError` 1, `FindingReviewUnreadableError` 1, `GitError` 1, `FsError` 1, `RegistryCorruptionError` 1, `ConfigValidationError` 2, each with `MessageFields` and a text that is its message. Keep the help short: what it lists, the fates, that earlier reviews come from the records branch, and that `--json` prints the finding-list document. Give examples such as `phax finding list gate-retry` and `phax finding list gate-retry --json`.
- Export `renderFindingList(file)`, the text from the document alone. The first line is `<shortName> (<state>) — <n> findings: <counts>`. The counts follow the order open, fixed, dismissed, deferred, unrecorded, non-zero only, joined by `, `. With no finding it reads `<shortName> (<state>) — no findings`. Then comes an empty line, then one row per finding: id, severity, fate, location and message, each column padded to its widest value and separated by two spaces. A code-review location is `<file>:<line>`; a compliance location is `<phaseId> <dimension>`.
- Register `findingGroup` in `phaxProgram` (`src/cli/definitions/program.ts`), beside the review commands. Run `pnpm gen:usage-spec` and `pnpm docs:cli`, and commit `phax.usage.kdl` and `docs/cli/reference.md` (and `docs/cli/inventory.md` if it changes). Update any per-command table a test names, such as a command catalogue or a completion list.
- In-phase tests. Create `tests/unit/cli/findingList.test.ts` for `renderFindingList`: the header and rows for open and unrecorded findings, the counts, and the no-finding line. Create `tests/integration/findingListSources.test.ts`. It may build its runs with `tests/fixtures/findings/findingRunRepo.ts` without editing it, or seed its own. It covers:
  - an unknown run refused with exit 1 and the resolver's sentence;
  - a run folder holding a `code-review.json` stamped newer than this phax, refused with exit 1 naming the file;
  - records off: the answer's `records` is `off`, the note is on stderr, and the run folder's findings are listed;
  - an archived run (its folder moved under `<archivePath>/runs` and the registry entry archived) listed from that folder and its records, with state `archived`.

### Planned files to create

- `src/app/findingList.ts`
- `tests/unit/cli/findingList.test.ts`
- `tests/integration/findingListSources.test.ts`

### Planned files to edit

- `src/cli/definitions/finding.ts`
- `src/cli/definitions/program.ts`
- `src/domain/findings/runFindings.ts`
- `tests/integration/findingList.test.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`

### Optional files that may be edited

- `docs/cli/inventory.md`
- `src/app/runReviews.ts`
- `src/app/resolveRunRef.ts`
- `src/cli/definitions/shared.ts`
- `knip.json`
- `tests/unit/cli/catalogue.test.ts`

### Boundary contracts

The CLI layer (`src/cli/definitions/finding.ts`) calls one use case (`listRunFindings` in `src/app/findingList.ts`) and renders its answer. It holds no business logic. The use case uses `resolveRunRef`, the registry, `readRunReviews` (FileSystem, Git) and the pure fold. It reaches no GitHub port. Stable contract toward the acceptance tests and scripts:
- `phax finding list <run>` takes one positional run reference;
- `--json` writes the `finding-list` document, `$schema` first, and only message lines on stderr;
- the text form is a header and one row per finding;
- exit 1 for a refused run, an unreadable review or a git or file failure, exit 2 for a configuration error.

### Test strategy

- the text list prints a header with the run's state and its non-zero fate counts, then one aligned row per finding with id, severity, fate, location and message — small · example · the rendered text for open and unrecorded findings and for a run with none · in-phase
- an unknown run, and a review document newer than this phax, are refused with exit 1 naming the run or the document — medium · example · the exit code and the stderr sentence · in-phase
- with records off the list reads the run folder alone, says so on stderr and answers records off — medium · example · the answer's records field, its findings and the note · in-phase
- an archived run lists from its archived run folder and its records, in state archived — medium · example · the answer for a run whose folder was moved under its archive path · in-phase
- the usage spec and the CLI reference hold phax finding list as generated — small · example · the usage and CLI-reference drift tests · in-phase

### Implementation order

1. findingFate in runFindings.ts
2. listRunFindings and its run resolution (live, cross-project, archived)
3. the finding group, its render and its exits
4. registration in phaxProgram, then gen:usage-spec and docs:cli
5. remove the acceptance markers
6. the in-phase tests

### Excluded scope

- `phax finding fix`, `dismiss` and `defer`, fate records and a non-empty history (plan 2).
- Pull request descriptions and comments (plan 3).
- Fetching the records remote before listing.

### Verification

The `standard` gate profile in phax.json, with the configured acceptance provider judging that phase-05's acceptance tests now pass with their markers removed and nothing else changed.

### Expected handoff content

Give the signature of `listRunFindings` and its failure tags with their exit codes. Say how an archived run is resolved and where its reviews are read. Give the exact note wording. Confirm that only the `.fails` markers changed in the acceptance test files, and that `phax.usage.kdl` and `docs/cli/reference.md` were regenerated. Explain any deviation from the planned file lists.

### Commit subject

`feat(cli): add phax finding list`

### Commit body

phax finding list <run> prints every finding of a run's reviews with its
id, severity, location, message and fate (open, or unrecorded for a
review persisted before ids), and --json prints the versioned
finding-list document. It reads earlier reviews from the run's records on
phax/records/v1 and the run folder, live or archived, says on stderr when
records are off or unreadable, and never calls GitHub. The acceptance
tests of the previous commit pass.

---

## phase-07 — Docs: finding ids, fates and the findings list {#phase-07-findings-docs}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

An operator who has reviewed a `review_open` run can read on one page what a finding id is, what each fate means, and how to list a run's findings. The page is `docs/findings.md`, published on the docs site. The README, the machine-answers page, the structured-answers page and the upgrading notes say what changed in this release.

### Detailed instructions

- Read spec §3, §4, §6 and §11, the Technical arbitrations, and the handoffs of phases 01 to 06. Use the exact command output and wording phase-06 produced.
- Create `docs/findings.md`, titled `# Review findings: ids and fates`. Its reader is the operator of §11. Sections:
  - **Finding ids:** `F<n>` for code-review findings and `C<n>` for compliance findings across phases in document order. phax gives them when it persists a review, never the session. Numbering continues across reviews of the same run, and an id is never reused.
  - **Fates:** the five fates and what each means. In this release a finding is `open`, or `unrecorded` when its review was persisted before ids existed. Fixing, dismissing and deferring come with `phax finding fix`, `dismiss` and `defer`, which a later release adds; say so in one sentence, with no option detail.
  - **Older reviews:** ids lifted by position, oldest review first. Stored files are never rewritten.
  - **Listing a run's findings:** `phax finding list <run>` with the §6 text example as the command now prints it, and `--json` with a short `finding-list` example.
  - **Where findings come from:** the run folder and the records branch. Cover records off and an unreadable records branch, and archived runs.
  Keep it concrete, with one example run (`gate-retry`).
- Publish it: add `docs/findings.md` to `SOURCE_FILES` in `site/build/sources.ts`, and add a page to `site/pages.ts`'s `files` with route `/guide/findings`, title `Review findings`, and a one-sentence description. Update any site test that lists the pages, if it asks.
- README.md: where the review commands are described (`phax review-code <run> --headless`, around the code review section), add one line for `phax finding list <run>` linking to docs/findings.md. The format rows were added in phases 01 and 04; check they are there.
- docs/json-output.md: add `finding-list` to the list of published answers on its line about `$schema`.
- docs/structured-answers.md: say that the code review and compliance review sessions answer `code-review-answer` and `compliance-review-answer`, which phax keeps as `code-review.json` and `compliance-review.json` after giving each finding its id.
- docs/upgrading.md: add a `### 0.40.0` section above `### 0.38.0` under `## Release by release`. It says:
  - `code-review` and `compliance-review` move to 0.40.0 shapes whose findings carry an `id`. An `@lbdremy/phax-schemas` before 0.40.0 refuses them, so upgrade the package; the package reads the 0.32.0 shapes with each id `Unknown`.
  - The review sessions now answer the new formats `code-review-answer` and `compliance-review-answer`.
  - `phax finding list --json` prints the new `finding-list` document.
  - No step is needed in a repository.

### Planned files to create

- `docs/findings.md`

### Planned files to edit

- `site/build/sources.ts`
- `site/pages.ts`
- `README.md`
- `docs/json-output.md`
- `docs/structured-answers.md`
- `docs/upgrading.md`

### Optional files that may be edited

- `docs/cli/reference.md`
- `phax.usage.kdl`
- `tests/unit/site/pages.test.ts`
- `tests/unit/site/sources.test.ts`

### Test strategy

- the findings page builds on the docs site with its route, and its links resolve — medium · smoke · pnpm site:build at the terminal gate and the site's page tests · in-phase

### Implementation order

1. docs/findings.md
2. site sources and pages
3. README line and json-output list
4. structured-answers paragraph
5. upgrading section

### Excluded scope

- The options of `phax finding fix`, `dismiss` and `defer` (plan 2).
- The pull request findings section and fate comments (plan 3).
- Any code change.

### Verification

The `standard` gate profile in phax.json, including its terminal `pnpm site:build`.

### Expected handoff content

List the sections of `docs/findings.md` and the route it is published at. List every other doc changed, with one line each. Name the parts plan 2 must extend: the Fates section and the fate commands' sentence. Explain any deviation from the planned file lists.

### Commit subject

`docs(findings): document finding ids, fates and phax finding list`

### Commit body

Add docs/findings.md, published at /guide/findings: what F and C ids are
and how they continue across a run's reviews, the five fates and the two
a finding can have today, how older reviews get their ids, and phax
finding list with its text and --json output. The README, the machine
answers page, the structured answers page and the 0.40.0 upgrading notes
name the new and changed formats.
