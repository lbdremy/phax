---
status: Approved
source-spec: docs/specs/2610131345-small-fixes-0-23.md
completes-spec: true
approved:
  date: 2026-10-13
  baseline: 7b9caa4
---
# Small fixes for 0.23

Ships the three independent fixes of spec small-fixes-0-23, one phase each, cheapest first. Phase 1 makes each phase commit's `Gate-Log` trailer name the log of the attempt that let the commit through: the passing attempt during the current entry, the highest recorded attempt on a commit-only resume, or `none` when no attempt is recorded (§5.1–§5.3). Phase 2 makes the snapshot check ignore annotation keywords (`description`, `title`, `examples`), then rewords `$schema`'s description. No stamp moves, and no released snapshot, `site/retired-schemas/` copy or `src/schemas/history/` module changes (§5.14–§5.18). Phase 3 retries a headless authoring session once, in the same session, when its document is refused (§5.4–§5.13). It adds the required `retry` field to the authoring record manifest, records that format's `next` snapshot through the snapshot tooling, and ticks the three NEXT_STEPS entries. Phase 2 lands before phase 3 so that authoring-record-manifest's `next` carries the new wording. The spec's §9 decisions (Q1 annotation-blind comparison, Q2 retry prompt without the schema, Q3 `Gate-Log: none`) and its §10 settled points are not reopened.

## Required commands

- (none)

This plan adds no new tool. Every phase uses the repository's existing pnpm scripts and `pnpm exec tsx scripts/schemas-check.ts` (with and without `--write`), as earlier schema-changing plans did. No `phax.json` security change is needed.

## Technical arbitrations

- Retry file names and wording: the retry prompt is written to `retry-prompt.md` and the retry's transcript to `retry-output.jsonl` in the session folder, beside `output.jsonl`. The prompt, warning and twice-refused error follow spec §6's indicative text. Loss accepted: the names leave no room for a second retry, which §5.8 rules out anyway.
- Usage from two turns: for claude-code and codex-cli, the usage extracted from `output.jsonl` and from `retry-output.jsonl` is summed field by field. For mistral-vibe, each distinct session id the two turns report is counted once from its `meta.json`, so a resume that keeps a cumulative meta is not counted twice. If either turn's usage is unavailable, the record's usage is unavailable. Loss accepted: a retried record with one unreadable turn reports no usage rather than a partial count shown as a total.
- New `$schema` description: "The <format id> format's shape, named by the phax release that last changed it (not necessarily the release that wrote this file): https://docs.phax.run/schemas/<format id>/<X.Y.Z>.json". Loss accepted: per Q1, the URLs already served keep the old sentence until each format's next real shape change.
- Annotation stripping knows which keywords hold subschemas. It drops `description`/`title`/`examples` only where they are keywords of a (sub)schema, and walks only the positions that hold subschemas: `properties`, `patternProperties`, `$defs`, `definitions` and `dependentSchemas` values; `items`, `additionalProperties`, `not`, `if`/`then`/`else`, `contains` and `propertyNames`; and the `allOf`/`anyOf`/`oneOf`/`prefixItems` arrays. It never strips inside `enum`, `const`, `default` or `required`, or in property names. Loss accepted: an annotation under a keyword this walker does not know is still compared strictly. That can raise a false new shape, but it can never miss a real one.
- Older authoring records stay readable, and the upgrade fills in `retry: "none"`. phax's own reader (`readRecordManifestFile` in `src/schemas/persisted.ts`) reads an authoring manifest stamped below the format's current stamp with the frozen 0.17.0 decoder. The schemas package reads it through the format's `releases`. Both readers, and the pre-schema step, upgrade to `retry: "none"`, because no earlier phax ever resumed a headless session. Loss accepted: on those records, `none` follows from the release that wrote them and is not recorded in the file. The alternatives were to refuse them, which would make `phax records list` silently drop every existing authoring record, or to add an `Unknown` third value, which would put a variant on a field the spec fixes at two values.

---

## phase-01 — Gate-Log names the passing attempt {#phase-01-gate-log-passing-attempt}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

Each phase commit's `Gate-Log` trailer names the log of the attempt that let it through. During the current entry, that is the passing attempt (03, or 07 after earlier entries). On a commit-only resume, it is the highest recorded attempt. When no attempt is recorded, the trailer reads the literal `none`, and the run does not pause.

### Detailed instructions

- `src/domain/gate/attemptFiles.ts`: add a pure helper. Given the phase folder's file names, it returns the log name of the highest recorded attempt (`attemptLogName(lastRecordedAttempt(names))`), or undefined when no attempt is recorded. Reuse `lastRecordedAttempt` and `attemptLogName`; do not add a second numbering rule.
- `src/app/commit.ts`: `CommitPhaseOptions.gateLogPath` becomes `string | null`. `buildCommitBody` writes `Gate-Log: <path>` for a string and `Gate-Log: none` for null. The trailer key, its position in the fixed trailer block and every other trailer stay unchanged.
- `src/app/executePlan.ts`: keep the `GateOutcome` that `runGatesWithFixLoop` returns on a pass, instead of discarding it. When the gate ran during this entry, pass `outcome.attemptLogPath` as `gateLogPath`. When the gate did not run, use the new helper over `fs.list(phaseFolderPath)` through the FileSystem port: join the phase folder and the log name, or pass null when there is none. The gate is skipped only on a commit-only resume (`isResumeFromCommit`); the handoff, cleanup and completion resumes never reach the commit. Remove the hard-coded `checks-attempt-01.log`.
- A `Gate-Log: none` commit must not pause or fail the run. It is just the trailer value; no event and no warning is required.
- Do not change attempt numbering, the fix loop's budget, or what the gate writes. Every passing attempt already writes its log (`src/app/gates.ts`).
- If a skill describes the `Gate-Log` trailer, report it in the handoff instead of editing it.

### Planned files to create

- `tests/integration/gateLogTrailer.test.ts`

### Planned files to edit

- `src/app/executePlan.ts`
- `src/app/commit.ts`
- `src/domain/gate/attemptFiles.ts`
- `tests/unit/attemptFiles.test.ts`

### Optional files that may be edited

- `src/app/fixLoop.ts`
- `tests/integration/executePlan.test.ts`
- `tests/integration/resumeFromCommit.test.ts`
- `tests/integration/fixLoop.test.ts`
- `tests/helpers/tempGit.ts`

### Boundary contracts

app → domain: executePlan asks the pure attempt-file helpers which log the highest recorded attempt has, given only file names, and gets a name or undefined. app → app: commitPhase consumes `gateLogPath: string | null`, and null is rendered as the literal `none`. The fix loop's `GateOutcome { attemptLogPath }` is the producer of the in-entry value; it is unchanged.

### Test strategy

Write the tests first. Unit (`tests/unit/attemptFiles.test.ts`): the new helper returns `checks-attempt-07.log` for a folder holding attempts 01–07 among other per-attempt files, ignores request/report/attribution/fix-transcript names when finding the highest log, and returns undefined for a folder with no log. Integration (`tests/integration/gateLogTrailer.test.ts`), with fake gates and a temp git repo as the existing executePlan/resumeFromCommit tests build them, reading the commit body from git: (1) gate fails on attempts 01 and 02 and passes on 03 in one entry → the trailer names `<phase folder>/checks-attempt-03.log`, and no trailer names `checks-attempt-01.log`; (2) the phase folder already holds `checks-attempt-01.log`…`06.log` and a resume runs the gate, which passes first time → the trailer names `checks-attempt-07.log`; (3) a phase left passed after a rejected pre-commit hook, with 01 and 02 recorded → the commit-only resume names `checks-attempt-02.log`, and no new attempt file appears; (4) the same, with no `checks-attempt-NN.log` in the folder → the commit carries `Gate-Log: none`, is created, and the run does not pause. Reuse the existing harness helpers where they fit; extend them only when needed.

### Implementation order

1. Unit tests and the helper in `src/domain/gate/attemptFiles.ts`.
2. `src/app/commit.ts`: the `string | null` trailer value.
3. `src/app/executePlan.ts`: keep the GateOutcome; use the helper on a commit-only resume.
4. Integration tests in `tests/integration/gateLogTrailer.test.ts`.
5. Run the `standard` gate.

### Excluded scope

- Anything that reads the `Gate-Log` trailer, and rewriting the trailers of existing commits.
- Changes to attempt numbering, the fix loop, gate logs or resume semantics.
- Headless authoring and the schema snapshot check (phases 02 and 03).

### Verification

The project's `standard` gate profile in `phax.json`.

### Expected handoff content

Give the name and signature of the new helper in `src/domain/gate/attemptFiles.ts` and the new type of `CommitPhaseOptions.gateLogPath`. State which resume modes reach the commit without running the gate, as found in `executePlan.ts`. Say which harness the integration tests reuse. Name any skill or doc that describes the `Gate-Log` trailer (reported, not edited). Explain any deviation from the planned file lists.

### Commit subject

`fix(run): name the passing gate attempt in the Gate-Log trailer`

### Commit body

The phase commit's Gate-Log trailer always named checks-attempt-01.log, whichever attempt passed. When the gate runs during this entry, it now names the log of the attempt whose gate passed, taken from the GateOutcome the fix loop returns. A commit-only resume of a phase left passed names the highest recorded attempt in the phase folder. A phase folder with no recorded attempt gets `Gate-Log: none`, and the commit and run go on without pausing.

Refs: spec small-fixes-0-23 §5.1–§5.3.

---

## phase-02 — Annotation-blind snapshots and the `$schema` wording {#phase-02-annotation-blind-snapshots}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

The JSON Schemas phax generates say what a `$schema` stamp names: the release that last changed the format's shape. A wording change no longer counts as a new shape, so no stamp moves and nothing already published changes.

### Detailed instructions

- `packages/schemas/build/snapshots.ts`: add a pure, keyword-aware `withoutAnnotations(schema)` (see Technical arbitrations). Recursively drop the keys `description`, `title` and `examples` from every (sub)schema object. Recurse only into subschema positions: the values of `properties`, `patternProperties`, `$defs`, `definitions` and `dependentSchemas`; `items` (object or array), `additionalProperties`, `not`, `if`, `then`, `else`, `contains`, `propertyNames` and `unevaluatedItems`/`unevaluatedProperties`; and the elements of `allOf`, `anyOf`, `oneOf` and `prefixItems`. Copy every other keyword (`enum`, `const`, `default`, `required`, `pattern`, …) verbatim. Keep the names under `properties` and the like, so a property literally named `description` survives.
- Add `sameShape(a, b)` next to `sameJson`: both parse, and they are deep-equal after `withoutAnnotations`. Use `sameShape` for (1) the generated schema against the latest released snapshot when there is no `next` (the finding), (2) a `next` against the latest released snapshot (the 'equals the latest released snapshot — delete it' finding), and (3) in `planSnapshotWrites`, the generated schema against the latest released snapshot (no write, and remove any `next`). Keep the strict `sameJson` for a `next` against the generated schema, in both `checkSnapshots` and `planSnapshotWrites` (§5.17). Keep today's finding texts exactly. Update the module's header comment to say how annotations are compared.
- Before rewording anything, write the toy-format tests in `tests/unit/schemasPackage/snapshots.test.ts`, building `SnapshotsInput` from synthetic schema strings as the existing tests do. Cover: an annotation-only difference (a changed `description`, an added `title`, changed `examples`, including inside nested `properties` and `anyOf`) gives no finding and an empty `--write` plan; a `type` change, or an added property literally named `description`, gives today's finding, and `--write` plans `next`; a `next` that differs from the generated schema only in a `description` is reported stale and rewritten; a `next` that differs from the latest released snapshot only in annotations is reported as equal to it and planned for removal.
- `src/schemas/schemaUrl.ts`: reword `schemaUrlField`'s description to the text chosen in Technical arbitrations, keeping the `<base>/<format id>/<X.Y.Z>.json` tail. It must not contain "the phax release that wrote this file". Also fix the module doc comment, which says the URL names "the phax release that wrote it". Leave the `pattern` unchanged.
- `tests/unit/schemaUrl.test.ts`: for every id in `FORMAT_IDS`, the rendered field's description states that the stamp names the release that last changed the format's shape, and does not contain "the phax release that wrote this file". If the package's `renderJsonSchemas` is the natural seam for 'the JSON Schemas the package generates', also assert it there (`tests/unit/schemasPackage/jsonSchemas.test.ts`).
- Run `pnpm exec tsx scripts/schemas-check.ts`: it must report no finding. `--write` must change no file: no `next.schema.json` appears, and `src/schemas/release.ts`, `packages/schemas/src/generated/index.ts` and `packages/schemas/history.lock.json` stay as they are. No format has a `next` today. If one does when you run, `--write` may rewrite only that `next`.
- Do not touch any file under `packages/schemas/snapshots/`, `site/retired-schemas/` or `src/schemas/history/`. Confirm with `git diff --stat` that none appears.
- If a test compares the generated schema with a released snapshot outside the snapshot gate (for example a current-shape or frozen-history test) and now fails only on the description, check that it is not one of the §7 non-goals ('ignoring annotations anywhere other than the snapshot comparison'). Move its expectation to the new wording instead of making it annotation-blind. Report each such test in the handoff.
- `README.md`'s Persisted formats paragraph already says what a stamp names. Touch it, or `docs/release.md`, only to add one sentence saying a wording-only change to a schema moves no stamp, if that fits the existing text.

### Planned files to create

- (none)

### Planned files to edit

- `packages/schemas/build/snapshots.ts`
- `tests/unit/schemasPackage/snapshots.test.ts`
- `src/schemas/schemaUrl.ts`
- `tests/unit/schemaUrl.test.ts`

### Optional files that may be edited

- `tests/unit/schemasPackage/jsonSchemas.test.ts`
- `tests/unit/schemasPackage/currentShapes.test.ts`
- `tests/unit/schemasPackage/frozenHistory.test.ts`
- `docs/release.md`
- `README.md`

### Boundary contracts

The schemas-check script is the consumer of `checkSnapshots`/`planSnapshotWrites`; their inputs, finding texts and write plan shape are unchanged. Only the equality used for released-snapshot comparisons changes. `schemaUrlField` is consumed by every file schema; only its annotation changes, never what it accepts.

### Test strategy

Test first, at the unit level, with toy formats only, never by asserting a literal release number: the annotation-blind cases and the still-caught cases in `tests/unit/schemasPackage/snapshots.test.ts`, listed in the instructions. Then the wording test across `FORMAT_IDS` in `tests/unit/schemaUrl.test.ts`. The end-to-end proof is `pnpm exec tsx scripts/schemas-check.ts` reporting nothing on the reworded tree, and `git diff` showing no snapshot, retired copy or history module touched.

### Implementation order

1. Toy-format tests for the annotation-blind comparison (failing).
2. `withoutAnnotations` and `sameShape` in `packages/schemas/build/snapshots.ts`; tests green.
3. Wording test across `FORMAT_IDS` (failing).
4. Reword `schemaUrlField` and the module comment in `src/schemas/schemaUrl.ts`.
5. Run the schemas check and `--write`; confirm no file changes.
6. Run the `standard` gate.

### Excluded scope

- Rewriting any released snapshot, any `site/retired-schemas/` copy or any `src/schemas/history/` module.
- Ignoring annotations in decoders, in served bytes, in the package's generated files, or anywhere other than the snapshot comparison.
- Treating `default`, `deprecated`, `$comment` or any other keyword as an annotation.
- The authoring-record-manifest shape change (phase 03).

### Verification

The project's `standard` gate profile in `phax.json`.

### Expected handoff content

Give the exact new `$schema` description template, and the names and locations of `withoutAnnotations`/`sameShape` and the list of subschema keywords the walker recurses into. Paste the output of `pnpm exec tsx scripts/schemas-check.ts` and confirm that `--write` changed no file. Paste a `git diff --stat` showing that nothing under `packages/schemas/snapshots/`, `site/retired-schemas/` or `src/schemas/history/` changed. List every test whose expectation moved to the new wording, and why. Explain any deviation from the planned file lists. Phase 03 relies on this phase's wording landing in authoring-record-manifest's `next`.

### Commit subject

`fix(schemas): say what a $schema stamp names without moving any stamp`

### Commit body

The snapshot check now compares a format's generated schema with its latest released snapshot, and a `next` with that released snapshot, ignoring the annotation keywords description, title and examples. An annotation-only change is no longer a new shape. Any other difference is still reported, and --write still records a `next`. A `next` that exists is still held equal to the generated schema, annotations included.

With that in place, every format's `$schema` description now says that the stamp names the release that last changed the format's shape, not the release that wrote the file. No stamp moves and no `next` is recorded. Released snapshots, site/retired-schemas/ and src/schemas/history/ stay byte for byte as they were.

Refs: spec small-fixes-0-23 §5.14–§5.18.

---

## phase-03 — One retry for a refused authoring document {#phase-03-authoring-retry}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

A headless authoring session whose document is refused gets one chance, in the same session, to fix it. The operator sees the retry, nothing about the first answer is lost, and the authoring record says whether a retry ran and counts both turns.

### Detailed instructions

- Pure domain, `src/domain/authoring/retry.ts`. Export `RETRY_PROMPT_FILENAME = "retry-prompt.md"` and `RETRY_TRANSCRIPT_FILENAME = "retry-output.jsonl"`. Add a not-JSON check that parses the extracted document text (`extractJsonDocumentText`) and returns either the value or a refusal reason: `the session's final message is not JSON (<parser error> at position <N>): <first 200 chars>`. The parser error and its position are required (§5.5). Some engine messages carry no `at position N`; in that case compute the position deterministically in pure code, for example with a minimal JSON well-formedness scan, and report it against the text that was parsed. Also add `buildRetryPrompt(kind, refusal)`, following spec §6: nothing was written, then `Refusal: <kind> document rejected — <reason>`, then return the whole document again as the final message, one JSON object valid against the schema you were given, no code fence, no commentary, this is your only retry. Do not repeat the schema or the brief (Q2). Add `retryWarning(kind, reason)` (`<kind> document refused — <reason>` plus `resuming the session once to ask for the whole document again`) and `refusedTwiceMessage(kind, first, retry)` (`<kind> document rejected twice — first answer: <first>; retry: <retry>`). Keep `jsonText.ts` as is, unless the parse helper belongs there.
- `src/app/authorArtifact.ts`: `parseAuthoredDocument` uses the domain not-JSON refusal. On a refused first answer only (an `AuthoringDocumentError` from parsing or decoding, never any other error), do the following in order: (1) mark the session as retried (`observed.retry = "retried"`, so even a failed resume records it); (2) write `retry-prompt.md` to the session folder; (3) call `input.output.warn(retryWarning(...))`; (4) call `backend.resumeAgentSession(observed.sessionId, retryPrompt, options)` with the same provider, model, effort, cwd and security as the first run, and `outputJsonlPath` set to `retry-output.jsonl` (the first `output.jsonl` must never be reopened); (5) parse the retry's final text the same way. If it is accepted, continue down today's render/seed/write/commit path unchanged (§5.7). If it is refused, fail with `AuthoringDocumentError` carrying `refusedTwiceMessage` (same error class, same exit code). Any error raised by the resume itself (rate limit, usage limit, agent invocation, missing session id, security enforcement, fs) is re-raised as is, with no further retry (§5.9). Add `AgentSessionIdMissingError` to `AuthorArtifactError`, and map its exit code in `src/cli/commands/artifact.ts` if the CLI needs it. A first-run provider error or a commit failure is never retried. The retry never waits on a person.
- Update the comments in `authorArtifact.ts` that list the session folder's files and the 'one recorded authoring session' doc comment.
- Record (`src/app/writeAuthoringRecord.ts`): the input gains `retry: "none" | "retried"`, and `recordSession` passes it. `AUTHORING_RECORD_FILES` adds `retry-prompt.md`, which is always carried when present, and `retry-output.jsonl`, which falls under `records.transcript` exactly like `output.jsonl` (§5.12). Make `selectRecordArtifacts` in `src/domain/records/assemble.ts` take the transcript file names as a set, or add a sibling, so that both transcripts are kept or dropped together and the shape is `full` only when a transcript is kept. Phase records must behave exactly as before. Usage (§5.13): in `src/app/recordPlumbing.ts`, expose per-transcript usage extraction and sum the two turns as decided in Technical arbitrations (claude/codex field-wise sum; vibe once per distinct session id; unavailable if either turn is unavailable). Phase-record usage must not change.
- Schema (`src/schemas/authoringRecord.ts`): add `retry: Schema.Literal("none", "retried")` (required, its own exported schema/type), and place it after `outcome`. Correct the doc comment: a headless session may be resumed once, to retry a refused document, and still has no pause.
- Freeze and record the shape change, in this order, following the plan-document 0.17.0 and gate-attribution 0.20.0 precedents. (1) Write `src/schemas/history/authoring-record-manifest/0.17.0.ts`: the self-contained current shape before `retry`, with its own inlined `$schema` field, worded exactly as the 0.17.0 snapshot is (the old wording). It must render to `packages/schemas/snapshots/authoring-record-manifest/0.17.0.schema.json`. (2) Add it to the format's `releases` in `packages/schemas/src/formats/recordManifests.ts`, re-export it from `packages/schemas/src/index.ts` as other frozen release shapes are, and widen `AuthoringRecordManifestShapes` / `toLatestAuthoringRecordManifest` so that the pre-schema and 0.17.0 shapes upgrade with `retry: "none"`. Update the file comment, which says the format has no releases. (3) In `src/schemas/persisted.ts`, `readAuthoringRecordManifest`'s pre-schema step adds `retry: "none"`. A `$schema` authoring manifest stamped below `CURRENT_STAMPS["authoring-record-manifest"]` is read by the frozen 0.17.0 decoder and upgraded with `retry: "none"`, so `phax records list`/`explain` keep reading existing authoring records. Phase manifests and every other format are unchanged. (4) Run `pnpm exec tsx scripts/schemas-check.ts --write`. It must write `packages/schemas/snapshots/authoring-record-manifest/next.schema.json` (carrying phase 02's wording), move only authoring-record-manifest's entries in `src/schemas/release.ts` and `packages/schemas/src/generated/index.ts`, and add the lock entry in `packages/schemas/history.lock.json`. Do not hand-edit those generated files. Then run `pnpm exec tsx scripts/schemas-check.ts` with no findings. No other format may gain a `next`.
- Tests and fixtures that build an authoring manifest gain `retry` (`tests/unit/schemasPackage/documents.ts`, `tests/unit/authoringRecord.test.ts`, `tests/integration/writeAuthoringRecord.test.ts`, and the type-level `tests/type/schemasPackage.ts`, whose authoring shape union gains `"0.17.0"`). Assert stamps only through the current-stamp helpers (`currentSchemaUrl`, `CURRENT_SHAPES`, `CURRENT_STAMPS`), never through literal release numbers, except where a frozen 0.17.0 module and its fixtures name their own release, as existing frozen-module tests do.
- `README.md`, headless authoring section (around `phax artifact new … --headless`): one short paragraph saying that a refused document (not JSON, or refused by the schema) is retried once in the same session, that a warning names the refusal (show spec §11's example), that a second refusal fails naming both refusals with nothing written, that limits and provider errors are not retried, and that the record's `retry` field says whether a retry ran. If the Persisted formats table or any authoring record description lists manifest fields, add `retry` there.
- `NEXT_STEPS.md`, Small follow-ups: tick the three entries this spec covers ('The phase commit's `Gate-Log` trailer always names attempt 01.', 'The served schemas still say a stamp names the release that wrote the file.', 'Headless authoring loses a whole session to one malformed JSON character.'). Mark each as shipped by the small-fixes-0-23 spec, as other ticked entries are.
- No skill edits. If a skill (for example `phax-planning`'s or `phax-spec`'s Headless authoring section) describes the session as one-shot, report it in the handoff instead of editing it.

### Planned files to create

- `src/domain/authoring/retry.ts`
- `src/schemas/history/authoring-record-manifest/0.17.0.ts`
- `packages/schemas/snapshots/authoring-record-manifest/next.schema.json`
- `tests/unit/authoring/retry.test.ts`
- `tests/integration/authorArtifactRetry.test.ts`

### Planned files to edit

- `src/app/authorArtifact.ts`
- `src/app/writeAuthoringRecord.ts`
- `src/app/recordPlumbing.ts`
- `src/domain/records/assemble.ts`
- `src/schemas/authoringRecord.ts`
- `src/schemas/persisted.ts`
- `src/schemas/release.ts`
- `packages/schemas/src/formats/recordManifests.ts`
- `packages/schemas/src/index.ts`
- `packages/schemas/src/generated/index.ts`
- `packages/schemas/history.lock.json`
- `tests/integration/writeAuthoringRecord.test.ts`
- `tests/unit/authoringRecord.test.ts`
- `tests/unit/schemasPackage/documents.ts`
- `tests/type/schemasPackage.ts`
- `README.md`
- `NEXT_STEPS.md`

### Optional files that may be edited

- `src/domain/authoring/jsonText.ts`
- `src/domain/authoring/prompt.ts`
- `src/domain/errors.ts`
- `src/cli/commands/artifact.ts`
- `src/infra/fakes/backend.ts`
- `tests/integration/authorArtifact.test.ts`
- `tests/unit/authoring/jsonText.test.ts`
- `tests/unit/recordsAssemble.test.ts`
- `tests/unit/persisted.test.ts`
- `tests/unit/runRecord.test.ts`
- `tests/unit/architecturalGuards.test.ts`
- `tests/unit/schemasPackage/recordManifests.test.ts`
- `tests/unit/schemasPackage/exports.test.ts`
- `tests/unit/schemasPackage/currentShapes.test.ts`
- `tests/unit/schemasPackage/documents.test.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/jsonSchemas.test.ts`
- `tests/unit/schemasPackage/frozenHistory.test.ts`
- `tests/unit/schemasPackage/preSchemaModules.test.ts`
- `tests/integration/recordsExplain.test.ts`
- `tests/integration/persistedProducer.test.ts`

### Boundary contracts

domain → app: `src/domain/authoring/retry.ts` produces the refusal reasons, retry prompt, warning text, the twice-refused message and the two file names. It is pure and has no I/O. app → Backend port: the retry is one `resumeAgentSession(sessionId, prompt, { …firstRunOptions, outputJsonlPath: <folder>/retry-output.jsonl })`. app → OutputPort: one `warn` before the resume; the CLI only renders it. app → records: `writeAuthoringRecord` receives `retry: "none" | "retried"` and reads the session folder's files. The manifest it writes is the authoring-record-manifest `next` shape, with a required `retry`. schemas package → readers: authoring-record-manifest shapes are `pre-schema`, `0.17.0` and the current shape; `toLatestAuthoringRecordManifest` always yields a `retry`.

### Test strategy

Test first. Unit (`tests/unit/authoring/retry.test.ts`): the not-JSON refusal for a document with a stray `.replace("a","b")` inside it names the parser error and a position, including when the engine message has no position; the retry prompt contains the refusal and the instruction and does not contain the schema; the warning and twice-refused texts. Unit (`tests/unit/authoringRecord.test.ts`): a manifest at the current stamp with no `retry`, or with `retry: "maybe"`, is refused, naming `retry`; a 0.17.0-stamped manifest (fixture built from the frozen module) reads through `readRecordManifestFile` and the package and upgrades to `retry: "none"`. Integration (`tests/integration/authorArtifactRetry.test.ts`, FakeBackend, temp git repo, as `tests/integration/authorArtifact.test.ts` builds them), one test per acceptance criterion of §8 for §5.4–§5.13: a schema refusal fixed by the retry (resumed exactly once on the first session id, prompt contains `acceptanceCriteria[0].refs: is missing`, warning printed before the resume, spec and sidecar committed); a not-JSON refusal fixed by the retry (the prompt and warning carry the parser error and position); two refusals (same exit/error class, both refusals named, one resume, no artifact/sidecar/commit, record `failed` + `retried`); rate limit, usage limit, agent invocation error and commit failure on the first run (never resumed, `retry: "none"`); a rate limit during the resume (no second resume, `retry: "retried"`); the first `output.jsonl` holds exactly the first run's lines, with `retry-prompt.md` and `retry-output.jsonl` beside it. Integration (`tests/integration/writeAuthoringRecord.test.ts`): a retried committed session with transcripts kept carries both transcripts and `retry-prompt.md`, has `retry: "retried"`, and its usage sums both turns; a first-answer session has `retry: "none"`; with transcripts off, neither transcript is carried. The snapshot gate itself proves the shape change (`schemas-check` clean after `--write`).

### Implementation order

1. Domain: `src/domain/authoring/retry.ts` and its unit tests.
2. Schema: freeze 0.17.0, add `retry` to `src/schemas/authoringRecord.ts`, wire `releases`/upgrade in the package and the reader in `persisted.ts`; unit tests.
3. Run `pnpm exec tsx scripts/schemas-check.ts --write`, then the check; fix fixtures and type tests.
4. Record writer: files list, transcript policy in `assemble.ts`, usage summing in `recordPlumbing.ts`; writeAuthoringRecord tests.
5. Use case: the retry flow in `src/app/authorArtifact.ts`; integration tests.
6. README paragraph and NEXT_STEPS ticks.
7. Run the `standard` gate.

### Excluded scope

- Retrying any other session (phase, extraction, review, brief, compliance).
- Provider-enforced output schemas (for example, Claude Code structured output).
- More than one retry, or a configurable retry count.
- Retrying on provider errors, limits, security enforcement failures or commit failures.
- Changing any released snapshot, any `site/retired-schemas/` copy or any existing module under `src/schemas/history/`.
- Skill edits.

### Verification

The project's `standard` gate profile in `phax.json`.

### Expected handoff content

Give the exported names and signatures in `src/domain/authoring/retry.ts`, and say how the not-JSON position is found when the engine's message has none. Give the final retry prompt, warning and twice-refused texts. Paste the `schemas-check --write` output: which files it wrote, and confirmation that only authoring-record-manifest gained a `next` and moved its stamp. Say how phax's reader and the package read a 0.17.0-stamped authoring manifest. Describe the usage-summing rule per provider as implemented, including what vibe's resume does to session ids. Explain how `selectRecordArtifacts` now treats both transcripts. List the README and NEXT_STEPS changes. Name any skill that describes headless authoring as one-shot (reported, not edited). Explain any deviation from the planned file lists.

### Commit subject

`feat(authoring): retry a refused headless document once in the same session`

### Commit body

A headless spec/plan authoring session whose final message is a refused document is resumed once in the same session. A refused document is one that is not JSON or that the document decoder rejects. The retry prompt states the refusal, says nothing was written, and asks for the whole document again. A warning naming the refusal is printed before the resume. An accepted retry is rendered, written and committed exactly like a first answer. A second refusal fails without another retry, writes nothing, and names both refusals. A not-JSON refusal now gives the parser's error and the position where parsing failed. Provider errors, limits, security enforcement failures and commit failures are never retried.

The first answer's output.jsonl stays as written. The retry prompt and the retry's transcript go to retry-prompt.md and retry-output.jsonl. The authoring record carries both, under the records.transcript policy, and counts both turns in its usage.

The authoring record manifest gains a required `retry` field (none | retried). This is a real shape change: 0.17.0 is frozen as a history module and listed in the format's releases, `next` is recorded through the snapshot tooling, and the stamp moves. Older records still read and upgrade with retry: none. The schema comment that said a headless session is never resumed is corrected. NEXT_STEPS ticks the three small follow-ups this spec covers.

Refs: spec small-fixes-0-23 §5.4–§5.13.
