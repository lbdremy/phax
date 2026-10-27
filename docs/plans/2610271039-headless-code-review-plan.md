---
status: Approved
source-spec: docs/specs/2610271007-headless-code-review.md
completes-spec: false
approved:
  date: 2026-10-27
  baseline: 183d9cf
---
# Review records

The first plan of the spec headless-code-review. It delivers the review entry: a run-level entry on phax/records/v1 that carries one review's file beside the run's phase records, with one shape for both reviews (§5.25). It also makes the compliance review use it: when records are enabled, each compliance-review.json the compliance review generates is committed as an entry, at run end and by hand (§5.24), and a records failure never fails the review (§5.26). The next plan, "Headless code review", only plugs code-review.json into the same writer. Everything else in the spec is left to it, §5.23 included: no review.code.enabled, no headless session, no code-review.json written, and no PR-body heading. phase-01 adds the entry format, its writer and what every records reader does with it. phase-02 wires the compliance review to the writer and documents the entry. Not an oracle pair: the criteria are judged on the records branch's tree, but the entry points they would be tested through (the schema module, the writer's input and result, and the compliance review's composed result) are designed by these phases. An oracle phase would have to freeze those internals before they exist. Each phase writes its own tests against real git instead.

## Required commands

- (none)

No new command. The phases run only the pnpm scripts of the standard gate profile and `pnpm exec tsx scripts/schemas-check.ts --write`, which `pnpm exec tsx` in security.agentCommands already covers.

## Technical arbitrations

- The entry's key is `<runId>/<review>`, with review one of `compliance-review` and `code-review`. This is the spec's indicative surface, beside the run's `<runId>/phase-NN` phase records. A phase id always matches ^phase-\d{2}$ (PhaseIdSchema), so a review key can never collide with one. Loss accepted: `phax records status` reads a key's two segments as run and phase, so it lists a pending review entry under its run as `compliance-review` among the phase ids, and `phax ls` counts it in the run's RECORDS column. The alternative, a top-level `review/<runId>/<review>` namespace like `authoring/` and `decision/`, would give up "beside the run's phase records" (§5.24).
- The entry carries a manifest, `record.json`, as every record does: `{ $schema, kind: "review", runId, review }`. Its format is the new `review-record-manifest`, born with $schema and stamped 0.29.0 through a `next` snapshot, with every key required and unknown keys refused. The entry's only other file is the review's own file, named by its kind (`compliance-review.json`, later `code-review.json`), copied byte for byte with its own $schema. Loss accepted: the manifest records no shape (there is no transcript), no usage (the cost ledger already counts it) and no source sha, so a reader cannot tell from the entry which commit of the run the review judged. With no manifest, `phax records list` and the schemas package's `parseRecordManifest` could not see or tell apart a review entry, and the plumbing that always writes `record.json` would need a special case.
- The review kind set holds `code-review` from this plan on, though nothing writes it until the next plan. This lets §5.25 be proved here, by writing both kinds through the one writer and comparing them. Loss accepted: until the next plan lands, the published `next` snapshot admits a code-review entry that no phax writes. Both plans ship in 0.29.0, so no stamp moves.
- When the compliance entry is committed: by the compliance review step itself, right after it writes compliance-review.json. At run end that is after the phase records and before publish, so publish's existing records push carries it. By hand (`phax review-compliance`), the entry is pushed at once when records.autoPush is on, as decide pushes its record. Only a compliance-review.json written by this invocation is committed. A review that wrote only compliance-review.md, or failed, commits nothing. A resumed run or a by-hand rerun commits a new entry at the same key: each records commit holds only its own tree, so the earlier file stays in the branch's history. Loss accepted: with publish.auto off, the run-end entry waits for the next push, as the run's phase records already do. At run end the entry's push outcome is `left-to-publish`, a `ReviewRecordPush` variant of its own: the entry was written and publish's push carries it. `no-record` means no entry was written.
- How a failure surfaces: the writer never fails. It returns a status: written, records-off, refused, deferred-destination, or write-failed with the message, the way decide's DecisionRecordStatus does. The caller prints a warning, as decisionRecordWarning words it. A refused destination is a warning too, never the phase record's hard failure. A failed push reuses decisionRecordPushWarning's wording (`src/app/writeDecisionRecord.ts`): the entry stays pending and `phax records status` lists it. `phax records status` reads its pending list from git alone (local commits the remote lacks), so a commit that never happened cannot appear there. A write-failed warning therefore keeps the spec's "pending" word, says the review's file stays in the run folder, and gives the remedy that actually lands it: rerun `phax review-compliance <run>`, which records a new review. It never says `phax records status` lists it. Loss accepted: a failed commit is reported only on that command's stderr, or the run's, not later by `phax records status`. The alternative is a pending-state file that `records status` would read across run folders.
- What the records readers do with a review entry. `phax records list` lists it: a `review` entry kind printed as `<runId>  <review>  -  -  <short sha>  <file>`, with `-` for the shape and outcome columns so the six columns of the phase, authoring and decision lines keep their positions, which `--run` reaches through the commit's `Run-Id` trailer. `phax records status` lists it as pending under its run, with no code change. `phax records explain` ignores it: it resolves a source commit's trailers, and no source commit names a review entry, so the only change is the type guards that keep a review manifest out of the phase, authoring and decision paths. `phax records sync` and the push are untouched. The entry's commit message is `records(review): <review>`, followed by `Run-Id: <runId>` and `Review: <review>` lines.
- No docs/upgrading.md 0.29.0 entry: a user has nothing to do. Runs that finished before this change get no review entry. A tool that reads every record.json with an older @lbdremy/phax-schemas is told to upgrade the package by its unknown-format message, as with every format added before.
- `phax review-compliance --help` states its new side effects: phase-02 rewrites the command's long help in `src/cli/cliDocs.ts` to say it commits the review entry to phax/records/v1 when records are on and pushes it when records.autoPush is on, instead of claiming no filesystem mutations, and regenerates `phax.usage.kdl` (`pnpm gen:usage-spec`) and the CLI docs (`pnpm docs:cli`). Loss accepted: phase-02's smaller footprint and its earlier "no generated CLI docs" exclusion. The command now writes to git and can push to a remote, which is the side effect its help most needs to state (operator decision of 2026-10-27).
- Tests of this plan never reach GitHub: every test that runs the records destination policy or the compliance review uses `makeFakeGitHub()`, or turns transcripts off (`transcript: false`), so `NodeGitHubLayer.visibility` never runs `gh repo view` against the person's gh config and network.

---

## phase-01 — The review entry on phax/records/v1 {#phase-01-review-entry}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

phax can commit any run-level review file to phax/records/v1 as a review entry: `<runId>/<review>/` holds the review's file and a `record.json` in the new `review-record-manifest` format. Every records reader knows what to do with the entry: `phax records list` lists it, `phax records status` lists it as pending, `phax records explain` keeps it out of its other paths, and the schemas package parses it. Nothing calls the writer yet.

### Detailed instructions

- Add `src/schemas/reviewRecord.ts`. `ReviewRecordKindSchema = Schema.Literal("compliance-review", "code-review")` and its type `ReviewRecordKind`. `REVIEW_RECORD_FILES`, typed `{ readonly [K in ReviewRecordKind]: string }`, maps `compliance-review` to `compliance-review.json` and `code-review` to `code-review.json`. The manifest fields are `kind: Schema.Literal("review")`, `runId: Schema.NonEmptyString` and `review: ReviewRecordKindSchema`. Every key is required, and the file carries nothing else. Export the in-memory type `ReviewRecordManifest` (no $schema), the file schema `ReviewRecordManifestFileSchema` (`$schema: schemaUrlField("review-record-manifest")` first, then the fields), `decodeReviewRecordManifestFile` (`onExcessProperty: "error"`), `encodeReviewRecordManifest` and `isReviewRecordManifest(manifest: object)`. Follow `src/schemas/decisionRecord.ts`.
- Register `review-record-manifest` in `src/schemas/schemaUrl.ts`: append it to `FORMAT_IDS` after `decide-verdicts`, add it to `SCHEMA_BORN_FORMAT_IDS`, and extend both doc comments to name the spec headless-code-review.
- In `src/schemas/authoringRecord.ts`, add `ReviewRecordManifest` to the `RecordManifest` type and `ReviewRecordManifestFileSchema` to `RecordManifestFileSchema`. Update the doc comments that count three manifests.
- In `src/schemas/persisted.ts`, add `readReviewRecordManifest` with `readSchemaBornPersisted` (format `review-record-manifest`, label `review record manifest`, `fromCurrent` dropping $schema), as `readDecisionRecordManifest` does but with no older shape. `readRecordManifestFile` reads `kind: "review"` with it, before the authoring and phase fallbacks. Update its doc comment.
- In `packages/schemas/src/formats/recordManifests.ts`, declare `reviewRecordManifestFormat`: born with $schema, so `preSchema: null` and `releases: []`, and current shape `ReviewRecordManifestFileSchema` and `decodeReviewRecordManifestFile` under `CURRENT_SHAPES["review-record-manifest"]`. Add `parseReviewRecordManifest`, `LatestReviewRecordManifest` and `toLatestReviewRecordManifest`, which drops $schema. Add the format to `RecordManifestShapes` and `recordManifestFormats`. In `parseRecordManifest`, a manifest without $schema and with `kind: "review"` is read as `review-record-manifest`, so it fails as born with $schema. Update the file's and the function's comments.
- Export the new format, its schema, type, parse and toLatest functions from `packages/schemas/src/index.ts`, and add it to the index's format maps where `decision-record-manifest` appears. Add it to both maps in `packages/schemas/build/jsonSchemas.ts`, with `"error"` in the excess-property map.
- Run `pnpm exec tsx scripts/schemas-check.ts --write`. It creates `packages/schemas/snapshots/review-record-manifest/next.schema.json` and regenerates `packages/schemas/src/generated/index.ts` and `src/schemas/release.ts`, where `review-record-manifest` gets `0.29.0`. Never hand-edit those two files or `packages/schemas/history.lock.json`.
- Add the README persisted-formats row after the decision record manifest row: `Review record manifest`, `review-record-manifest`, `<runId>/<review>/record.json on phax/records/v1`, `parseReviewRecordManifest`, `json/review-record-manifest.schema.json`. `pnpm format` aligns the table.
- In `src/app/recordPlumbing.ts`, export the `RecordSkipped` type (records-off, deferred-destination, refused), so a writer without a shape can return it.
- Add `src/app/writeReviewRecord.ts`, following `src/app/writeDecisionRecord.ts`. Its input is `{ repoRoot, recordsClonePath?, records: ResolvedRecordsConfig, runId, runPath, review: ReviewRecordKind }`. Export `reviewRecordKey(runId, review)`, which returns `${runId}/${review}`. `writeReviewRecord(input)` calls `resolveRecordDestination(input)` (the same policy as every record). On write, it calls `commitRecordTree` with `folder: runPath`, `artifactPaths: [REVIEW_RECORD_FILES[review]]`, the key, the encoded manifest `{ kind: "review", runId, review }` stamped with `withSchemaUrl("review-record-manifest", …)`, and the message `records(review): <review>`, a blank line, `Run-Id: <runId>`, `Review: <review>`. It returns `ReviewRecordStatus`: `{ kind: "written", commitSha, branch, key, fileCount } | RecordSkipped | { kind: "write-failed", message }`. Its error channel is `never`: every GitError or FsError, including a missing review file, becomes `write-failed`.
- Also export `reviewRecordWarning(status, review)`. It returns undefined for written and records-off. For deferred-destination it says the entry was not written because the dedicated records clone is not configured, and names `phax records sync`. For refused it gives the message and the remedy. For write-failed it says the `<review>` entry was not committed to phax/records/v1, gives the message, and says the entry is pending: `<file>` stays in the run folder, and rerunning `phax review-compliance <run>` records a new review. It must not say that `phax records status` lists it: that command reads git alone, and no commit was made. Export `ReviewRecordPush = RecordsPushResult | { kind: "no-record" } | { kind: "left-to-publish" }` (`no-record`: no entry was written; `left-to-publish`: the entry was written and publish's records push carries it, as at run end) and `reviewRecordPushWarning(push)`, worded as `decisionRecordPushWarning` but for the review entry: it stays pending, `phax records status` lists it (the commit exists locally), and the git push that shares it. It says nothing for `no-record`, `left-to-publish`, `not-configured` and `pushed`.
- In `src/infra/fakes/git.ts`, add `failNextWriteTreeCommit(stderr)`: the next `writeTreeCommit` fails with a GitError and creates no commit. Like the fake's other `failNext*` helpers, the call is still logged in `calls`, so a test can see the attempt.
- In `src/app/recordsList.ts`, add a `review` variant to `RecordListEntry`: `{ kind: "review", runId, review, recordCommitSha, file }`, with file from `REVIEW_RECORD_FILES`. Push it when `isReviewRecordManifest(manifest)`, checked before the phase fallback. Update the doc comment's list of record kinds. In `src/cli/commands/records.ts`, `runRecordsList` prints a review entry as `<runId>  <review>  -  -  <first 8 of the sha>  <file>`: `-` stands for the shape and outcome columns, so the line keeps the six columns of the phase, authoring and decision lines (`src/cli/commands/records.ts`, `runRecordsList`). Do not change any command description, so the usage spec and the CLI docs stay as generated.
- In `src/app/recordsExplain.ts`, extend `RecordManifest` handling for the union's new member. `explainPhaseRecord` reports a review manifest under a phase key as malformed, as it does for authoring and decision manifests. `manifestKindLabel` names `a review manifest`. `loadRecord` reads `sourceSha` only when the manifest has the key (`"sourceSha" in manifest`). Do not add a trailer or an address: no source commit names a review entry.
- Leave `src/app/recordsStatus.ts` as it is. Its key walk already returns `{ runId, phaseId: "compliance-review" }` for a pending review entry. Only adjust the `PendingRecordEntry` doc comment, to say its second segment is a phase id or a review kind, if you touch the file.
- In `tests/integration/persistedProducer.test.ts`, drive `writeReviewRecord` so the new format has a producer, and its manifest is checked like every written format. Its `formatAt` maps every `record.json` outside `decision/` and `authoring/` to `phase-record-manifest`: classify `records:<runId>/compliance-review/record.json` and `records:<runId>/code-review/record.json` as `review-record-manifest` before that fallback, or the new manifest fails the current-stamp and parseDocument checks. In `tests/unit/schemasPackage/documents.ts`, add the format's example document. Extend `tests/unit/schemasPackage/recordManifests.test.ts` for the new format beside the other manifests.
- Every test that creates a repository uses `tests/helpers/isolateGit.ts`. No test reads ~/.phax, a real ~/.claude, ~/.codex, ~/.vibe or the global git config. Every test that runs the records destination policy uses `makeFakeGitHub()` (or `transcript: false`), never the real GitHub layer: with in-repo records and transcripts on, `NodeGitHubLayer.visibility` would run `gh repo view`.
- The format registries in the tests are exhaustive maps or lists keyed by `FormatId`, so adding `review-record-manifest` requires an entry in each: `tests/type/schemasPackage.ts`, `tests/unit/architecturalGuards.test.ts` (`BRIDGE_ONLY_DECODERS`), `tests/unit/schemaUrl.test.ts`, `tests/unit/schemasPackage/jsonSchemas.test.ts`, `tests/unit/schemasPackage/currentShapes.test.ts` (`PACKAGE_LATEST` and its neighbour), `tests/unit/schemasPackage/parity.test.ts` (`FORMATS`) and `tests/unit/schemasPackage/documents.test.ts` (`DECODERS`). Follow `decision-record-manifest` in each.

### Planned files to create

- `src/schemas/reviewRecord.ts`
- `src/app/writeReviewRecord.ts`
- `packages/schemas/snapshots/review-record-manifest/next.schema.json`
- `tests/unit/reviewRecord.test.ts`
- `tests/integration/writeReviewRecord.test.ts`

### Planned files to edit

- `src/schemas/schemaUrl.ts`
- `src/schemas/release.ts`
- `src/schemas/authoringRecord.ts`
- `src/schemas/persisted.ts`
- `src/app/recordPlumbing.ts`
- `src/app/recordsList.ts`
- `src/app/recordsExplain.ts`
- `src/cli/commands/records.ts`
- `src/infra/fakes/git.ts`
- `packages/schemas/src/formats/recordManifests.ts`
- `packages/schemas/src/index.ts`
- `packages/schemas/src/generated/index.ts`
- `packages/schemas/build/jsonSchemas.ts`
- `README.md`
- `tests/integration/persistedProducer.test.ts`
- `tests/unit/schemasPackage/recordManifests.test.ts`
- `tests/unit/schemasPackage/documents.ts`
- `tests/type/schemasPackage.ts`
- `tests/unit/architecturalGuards.test.ts`
- `tests/unit/schemaUrl.test.ts`
- `tests/unit/schemasPackage/jsonSchemas.test.ts`
- `tests/unit/schemasPackage/currentShapes.test.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/documents.test.ts`

### Optional files that may be edited

- `src/app/recordsStatus.ts`
- `src/app/writeDecisionRecord.ts`
- `src/domain/records/assemble.ts`
- `packages/schemas/history.lock.json`
- `tests/unit/persisted.test.ts`
- `tests/unit/readmePersistedFormats.test.ts`
- `tests/unit/releaseCut.test.ts`
- `tests/unit/schemasPackage/exports.test.ts`
- `tests/unit/schemasPackage/snapshots.test.ts`
- `tests/unit/schemasPackage/parseDocument.test.ts`
- `tests/unit/site/schemas.test.ts`
- `tests/integration/recordsExplain.test.ts`

### Boundary contracts

`writeReviewRecord` (app, producer) takes a run folder, a run id and a review kind, and returns a `ReviewRecordStatus` that never fails. The compliance review (phase-02) and the next plan's code review consume that status and turn it into warnings. All of its I/O goes through the Git, FileSystem and GitHub ports, via `recordPlumbing.ts`. phax's `readRecordManifestFile` and the schemas package's `parseRecordManifest` both read `review-record-manifest` (the producer/consumer pair at the records branch). The records readers consume the manifest union: `listRecords` lists the new kind, and `explainRecord` refuses it under a phase, authoring or decision key.

### Test strategy

- a review manifest decodes for each review kind, and an unknown key, a missing key or a review kind outside compliance-review and code-review is refused — small · table · the decoder's typed refusal · in-phase
- writing a compliance-review entry commits <runId>/compliance-review/compliance-review.json, byte-identical to the run folder's file, and its record.json on phax/records/v1, under the same `<runId>/` key prefix as the run's phase record (each records commit holds only its own files, so "beside" is judged across the branch's commits, never on one tree), leaving the working tree and the index unchanged — medium · example · the records branch's commits (git log, then ls-tree per commit), the run folder's file and git status · in-phase · ac-records-compliance
- a second entry for the same run and review replaces the file at the same key, and the first file is still readable from the branch's history — medium · example · git show of both record commits · in-phase · ac-records-compliance
- a compliance-review entry and a code-review entry of one run have the same tree layout and the same manifest keys, and differ only in the review kind and the file they carry — medium · table · the two entries compared key by key · in-phase · ac-records-shape
- a records commit that fails returns write-failed and never raises, the run folder's file is untouched, and the warning names the pending entry and the file kept in the run folder — small · example · the write status, the file and the warning text · in-phase · ac-records-fails
- records off writes nothing, and a refused or deferred destination is returned, never raised — medium · example · the write status and the unchanged records branch · in-phase
- phax records list shows the review entry under its run with and without --run, records status lists it as pending under its run, and records explain of a phase commit still finds the phase record — medium · example · the listing, the pending entries and the explained record · in-phase
- the schemas package's parseRecordManifest and phax's reader both read a written review manifest as review-record-manifest at the 0.29.0 stamp, and refuse one without $schema — small · example · the parsed format id, the $schema URL and the typed failure · in-phase

### Implementation order

1. The manifest schema, the format registration, the union and the phax reader, with their unit tests.
2. The schemas package format, the index and build maps, `schemas-check --write`, and the README row.
3. The fake's write failure, `writeReviewRecord` and its warnings, and the real-git integration test.
4. The records list kind and its CLI line, the explain type guards, and the persisted-producer and documents fixtures.

### Excluded scope

- Calling the writer from the compliance review, at run end or by hand (phase-02).
- The README Records prose about review entries, and `phax review-compliance`'s help (phase-02).
- Writing code-review.json, review.code.enabled, the headless code review, or the PR body (the next plan).
- Records explain for a review entry, any new commit trailer on a source commit, and changes to command descriptions.
- A docs/upgrading.md entry.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

Record the exact names phase-02 will import from `src/app/writeReviewRecord.ts` and `src/schemas/reviewRecord.ts`: `writeReviewRecord`, its input fields, `ReviewRecordStatus`, `reviewRecordWarning`, `ReviewRecordPush`, `reviewRecordPushWarning`, `reviewRecordKey` and `REVIEW_RECORD_FILES`. Give the exact warning wording, the commit message and trailers, and the stamp `review-record-manifest` got. Name the fake's new helper (`failNextWriteTreeCommit`). List what each records reader does with a review entry. Explain any deviation from the planned file lists, in particular any schemas-package test that had to change.

### Commit subject

`feat(records): add the review entry on phax/records/v1`

### Commit body

A run-level review file can now be committed to phax/records/v1 as a review entry: <runId>/<review>/ holds the review's file and a record.json in the new review-record-manifest format, born with $schema at 0.29.0, which names the run and the review kind (compliance-review or code-review). writeReviewRecord uses the same destination policy and tree-only plumbing as every record, and never fails: a refused, deferred or failed commit comes back as a status with a warning. phax records list lists the entry under its run, records status lists it as pending, records explain keeps it out of its other paths, and the schemas package parses it.

---

## phase-02 — The compliance review commits its entry {#phase-02-compliance-entry}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

With records enabled, every compliance-review.json the compliance review generates is committed to the run's records as a compliance-review entry beside its phase records. This holds at run end, before publish pushes the records, and with `phax review-compliance` by hand, which pushes it when records.autoPush is on. A records failure leaves the file in the run folder, leaves the run in review_open, and prints a warning naming the pending entry. The README documents the entry.

### Detailed instructions

- In `src/app/reviewCompliance.ts`, add and export `reviewComplianceAndRecord(info, config, resolution, security, target, opts)`. `target` is `{ records: ResolvedRecordsConfig, repoRoot: string, recordsClonePath?: string, push: { readonly publishRemote: string } | null }`. It runs `reviewCompliance` unchanged. When the result is `generated` and carries `review` (this invocation wrote compliance-review.json; a verdict-missing review wrote only the .md), it calls `writeReviewRecord` from `src/app/writeReviewRecord.ts` with `review: "compliance-review"`, `runId: info.runId` and `runPath: info.runPath`. Then, only when `target.push` is set and the status is written, it calls `pushRecordsBranch` (`src/app/recordsSync.ts`).
- It returns `{ review: ComplianceReviewResult, record: ReviewRecordStatus | { kind: "no-entry" }, push: ReviewRecordPush }`, and its requirements gain Git and GitHub. Also export `complianceRecordWarnings(outcome): readonly string[]`, which collects `reviewRecordWarning(record, "compliance-review")` and `reviewRecordPushWarning(push)` when they say something. Leave `reviewCompliance` itself and its existing callers' tests untouched.
- In `src/app/executePlan.ts`, the auto-compliance block calls `reviewComplianceAndRecord`. Pass `config.records`, `config.repoRoot`, `recordsClonePath(config.stateRoot, namespace)` when the destination is a dedicated repo (as `writeRecordForPhase` does), and `push: null`: publish's own `pushRecordsIfConfigured` carries the entry when publish.auto is on. With `push: null` and a written entry, the push outcome is `left-to-publish`; with no entry, `no-record`. Write each warning to stderr as `[phax] Warning: <warning>`, as `writeRecordForPhase` does. Keep the existing `catchAll`, so no compliance or records failure ever fails the run or changes its state.
- In `src/cli/commands/reviewCompliance.ts`, call `reviewComplianceAndRecord`, which stays one use case. Pass `config.records`, `config.repoRoot`, `recordsClonePath(config.stateRoot, namespace)` for a dedicated repo destination, where `namespace` is the resolved run's namespace from `resolveResult.right`, as `src/cli/commands/publishPr.ts` passes it (a cross-project run's entry belongs in that project's records clone, not the current project's), and `push: { publishRemote: config.publish.remote }`. Add `NodeGitLayer` and `NodeGitHubLayer` to the command's layer. After the existing verdict and path lines, print each warning with `out.warn`. Exit codes are unchanged: 0 when the review was generated, whatever became of its entry; 1 on the existing refusals and failures.
- In `tests/unit/cli/reviewCompliance.test.ts`, mock `reviewComplianceAndRecord` (and keep `reviewCompliance` mocked). The `vi.mock` factory of `app/reviewCompliance.js` must also export `complianceRecordWarnings` (or build on `importOriginal`), since vitest throws on an import missing from a mock factory and adapt the existing cases to the new result. Add a case where a generated review with a write-failed entry exits 0 and prints the warning.
- Add `tests/integration/complianceReviewRecord.test.ts`. For run end, drive `executePlan` with fake ports as `tests/integration/costLedger.test.ts` does, with the compliance review and in-repo records enabled. The fake backend writes a valid compliance answer under .phax-context. Assert that the fake Git's records commits hold the phase records, then a commit whose paths are `<runId>/compliance-review/compliance-review.json` and `<runId>/compliance-review/record.json`. Arm `failNextWriteTreeCommit` from `backend.impl.setOnRunAgent` when the compliance-review session starts (as `tests/integration/costLedger.test.ts` branches on that session's stream), never up front: armed before `executePlan`, it would fail phase-01's record instead. With it armed that way, the run still ends in review_open, compliance-review.json is in the run folder, and stderr carries the pending warning. A review that writes no JSON answer commits no entry. Every test in this file uses `makeFakeGitHub()` or turns transcripts off, never the real GitHub layer.
- For by hand, in the same file, call `reviewComplianceAndRecord` with real git (`tests/helpers/isolateGit.ts`, a temporary repository and a bare remote) and records.autoPush on. A second accepted review commits a new entry at the same key, the remote's phax/records/v1 holds it, and the first file is in the branch's history.
- In README.md, `## Records`: after the sentence on authoring and decide records, add one or two sentences. With records on, each compliance review the run generates is kept too, as a review entry `<runId>/compliance-review/` beside the run's phase records: its compliance-review.json and a record.json. A later review of the run replaces the file, and the earlier one stays in the branch's history. Say that `phax records list` shows it and `phax records status` lists it while unpushed. In `## Read phax files from code`, extend the paragraph on finding records by trailers: a review entry's commit carries `Run-Id` and `Review`, and its manifest is read by `parseReviewRecordManifest` or `parseRecordManifest`. In the Persisted formats table, the Compliance review row's location gains `<runId>/compliance-review/compliance-review.json` on phax/records/v1 beside `<run folder>/compliance-review.json`. Do not add a docs/upgrading.md entry.
- In `src/cli/cliDocs.ts`, rewrite `phax review-compliance`'s long help: it no longer claims no filesystem mutations. Say that it writes `compliance-review.json` and `compliance-review.md` in the run folder, commits the review entry to phax/records/v1 when records are enabled, and pushes it when records.autoPush is on. Then run `pnpm gen:usage-spec` and `pnpm docs:cli`, and commit the regenerated `phax.usage.kdl` and `docs/cli/reference.md` (`pnpm docs:cli` also refreshes the README's CLI summary, already a planned edit).

### Planned files to create

- `tests/integration/complianceReviewRecord.test.ts`

### Planned files to edit

- `src/app/reviewCompliance.ts`
- `src/app/executePlan.ts`
- `src/cli/commands/reviewCompliance.ts`
- `tests/unit/cli/reviewCompliance.test.ts`
- `README.md`
- `src/cli/cliDocs.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`

### Optional files that may be edited

- `src/app/writeReviewRecord.ts`
- `src/cli/commands/runLayers.ts`
- `tests/integration/reviewComplianceCommand.test.ts`
- `tests/integration/reviewCompliance.test.ts`
- `tests/integration/costLedger.test.ts`
- `tests/integration/executePlan.test.ts`
- `tests/integration/cliProgram.test.ts`
- `tests/unit/architecturalGuards.test.ts`

### Boundary contracts

`reviewComplianceAndRecord` (app) is the one use case both callers consume. `executePlan` uses it at run end with no push, and `phax review-compliance` (CLI) uses it by hand with a push. It produces the compliance result unchanged, plus the entry's status and push outcome, and never lets a records concern fail the review. It consumes `writeReviewRecord` and the `reviewRecordWarning`/`reviewRecordPushWarning` wording from `src/app/writeReviewRecord.ts` (phase-01), and `pushRecordsBranch` from `src/app/recordsSync.ts`. The CLI only passes config and renders warnings through the OutputPort.

### Test strategy

- at run end with records and the compliance review on, the generated compliance-review.json is committed as a compliance-review entry after the run's phase records — medium · example · the fake git's records commits, in order, with their paths · in-phase · ac-records-compliance
- a records commit that fails at run end leaves compliance-review.json in the run folder and the run in review_open, and warns of the pending entry — medium · example · the run's state, the run folder and stderr · in-phase · ac-records-fails
- a compliance review that wrote no compliance-review.json commits no review entry — medium · example · the fake git's records commits · in-phase
- a by-hand review commits a new entry at the same key, pushes it when records.autoPush is on, and keeps the earlier file in the branch's history — medium · example · the local and remote records branches and git show of both commits · in-phase · ac-records-compliance
- phax review-compliance exits 0 and prints the warning when the review was generated but its entry could not be committed — small · example · the exit code and the printed warning · in-phase · ac-records-fails

### Implementation order

1. `reviewComplianceAndRecord` and `complianceRecordWarnings` in `src/app/reviewCompliance.ts`.
2. The run-end call in `src/app/executePlan.ts`, and its integration tests.
3. The by-hand command, its layer, its unit test and the by-hand integration test.
4. The README Records and read-from-code paragraphs.

### Excluded scope

- Writing code-review.json or its entry, review.code.enabled, the headless code review and the PR body (the next plan).
- A records push at run end beyond what publish already does.
- Changing reviewCompliance's own result, the compliance prompt, or the review security posture.
- A docs/upgrading.md entry.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

Record the exact signature of `reviewComplianceAndRecord`, its result type and `complianceRecordWarnings`, so the next plan's headless code review can mirror them for code-review.json. Name where the run-end call sits relative to `FinalReviewOpened` and publish. Give the warnings an operator sees at run end and by hand. Explain any deviation from the planned file lists.

### Commit subject

`feat(review): keep each compliance review in the records`

### Commit body

With records enabled, each compliance-review.json the compliance review generates is now committed to the run's records as a compliance-review entry beside its phase records. At run end it lands before publish, so publish's records push carries it. With phax review-compliance by hand, it is pushed when records.autoPush is on. A later review replaces the entry's file, and the earlier one stays in the branch's history. A records failure never fails the review: the file stays in the run folder, the run stays in review_open, and a warning names the pending entry. The README documents the review entry. phax review-compliance --help now states that it commits and may push the entry.
