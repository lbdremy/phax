---
status: Completed
source-spec: docs/specs/2610271119-acceptance-tests.md
completes-spec: false
approved:
  date: 2026-11-01
  baseline: bb543ac
---
# Acceptance formats

First of the four plans of the spec acceptance-tests: the persisted and published formats. After this run, phax writes plan-document, phax-plan, phax-plan-extraction, run-status, phase-status, gate-attribution and phase-record-manifest at 0.33.0 under the acceptance names, and the new acceptance-request format, born at 0.33.0, replaces oracle-request on the provider's stdin and in the saved checks-attempt-NN.acceptance-request.json. Every shape these replace is frozen first under src/schemas/history/ and pinned in packages/schemas/history.lock.json. phax and @lbdremy/phax-schemas read each one and lift it to the new names. The test line gains the `acceptance` loop, the `boundary` technique and the three reserved criterion words. `phax artifact migrate-documents` lifts live plan sidecars, and EXTRACTOR_VERSION moves from 4 to 5. The plan covers ac-loop, ac-boundary, ac-criterion, ac-status-record, ac-migrate, ac-unmigrated, ac-archived and ac-in-flight, and serves ac-read-old for the readers it adds. Plans 2 to 4 cover the other criteria; `phax plans lint` reports those as uncovered, as warnings.

Order: the plan formats come first. phase-01 handles the test line, which restamps the three plan formats, and phase-02 the phase key. Then comes one acceptance pair for the record and status lift tables, the purest contract of the run: phase-03 writes the tests and phase-04 passes them, renaming and freezing the four formats. phase-05 last: it births acceptance-request, freezes oracle-request at 0.26.0, and writes the 0.33.0 upgrading entry for records and schema readers. Every commit is green under the `standard` gate profile.

The installed phax 0.32.0 drives this run. It reads this repository's phax.json, including the `oracles` key and its `node examples/vitest-oracles/main.mjs` command, which keeps reading the oracle-request 0.32.0 writes, and it lints and extracts this plan with today's words. That is why this plan's own oracle pair is declared with the 0.32.0 header lines and its test lines use the loop word `oracle`. No phase edits phax.json, knip.json, examples/, the skills or the live docs/specs and docs/plans sidecars: the operator runs `phax artifact migrate-documents` with the released 0.33.0. No phase edits a skill, so the run needs no --allow-skill-edits.

No interactive phase is declared. phase-01 sets a pattern that later phases repeat: a frozen history module, a `next` snapshot and a lift. It is the repository's established format-bump pattern, followed by the structured-output plans, not a new one. The operator can still hold any phase with `phax run --hold`.

## Required commands

- `pnpm exec tsx`

`pnpm exec tsx` runs scripts/schemas-check.ts and scripts/schemas-check.ts --write, which write the `next` snapshots, src/schemas/release.ts, the package's generated index and the history lock. It is already in `security.agentCommands` of phax.json, so the plan needs no phax.json change.

## Technical arbitrations

- The lifts are one pure module shared by phax and the package. src/schemas/acceptanceLift.ts imports only effect and the schema types. It holds one function per renamed value or key: test loop `oracle` → `acceptance`; phase key `oracle: { dischargedBy, files }` → `acceptance: { passedBy, files }`; recorded surface `oracle` → `acceptance`; record role `oracle`+`dischargedBy` → `acceptance`+`passedBy`, and `discharging`+`oraclePhase` → `passing`+`acceptancePhase`; hold selection `oracle` → `acceptance`; stop key `oracleStep` → `acceptanceStep`; oracle-request → acceptance-request. Verified surfaces are mapped, then re-sorted, because phax always writes them sorted. Each older stamp is decoded by its own frozen module. phax's readers in src/schemas/persisted.ts then lift it through these functions, and so do the package's `toLatest*` functions. Shapes older than the newly frozen ones (gate-attribution 0.26.0, phase-record-manifest 0.26.0, plan-document 0.26.0 and 0.28.0) lift through the same functions. Every other fact is kept as is. Loss accepted: the package's closure gains one src/schemas module, added to the allowlist in tests/unit/architecturalGuards.test.ts. Rejected: writing the lifts at each site (persisted.ts and each package format module). That gives up the single definition, so phax and the package could disagree on the same record.
- oracle-request stays a format id, frozen at 0.26.0, and acceptance-request is born at 0.33.0. This follows hand-decision-answer at 0.32.0. src/schemas/oracleRequest.ts moves verbatim to src/schemas/history/oracle-request/0.26.0.ts. The format keeps its id and its 0.26.0 snapshot and stamp, and gets no `next`. Its package format lists the frozen module as its 0.26.0 release and as its current shape, so parseDocument still identifies it. phax writes it nowhere. acceptance-request is a new FORMAT_IDS and SCHEMA_BORN_FORMAT_IDS entry whose current shape is `next`. In the package, `parseAcceptanceRequest` dispatches on the `$schema` format: it reads an acceptance-request at its own shapes and an oracle-request at 0.26.0. `toLatestAcceptanceRequest` lifts either to the latest acceptance request. `parseOracleRequest`, `toLatestOracleRequest` and the `OracleRequest*` exports go, per the spec's rename table. In phax, closeStop reads back only `.acceptance-request.json`, since a run stopped under 0.32.0 can no longer resume. records explain lists `.acceptance-request.json`, and for an older record `.oracle-request.json`. Loss accepted: two format ids for one document role, and one parse function that reads two of them. Rejected: one id with oracle-request 0.26.0 as a release of acceptance-request. That gives up the invariant every registry relies on: a `$schema` URL names exactly one format id, one snapshots/<id>/ folder and one history/<id>/ folder.
- The plan.md header lines stay as they are in this run, as the brief says (plan 2 changes them). Plan 1 renames the phase key in JSON only. The parser reads `**Oracle phase:** yes | discharged by phase-NN` and `**Oracle files:**` into `acceptance: { passedBy, files }`. The renderer still writes those two lines, from `acceptance.passedBy` and `acceptance.files`. Plan 2 must switch the reader and the renderer in one commit: the render-then-parse round trip forbids splitting them. Loss accepted: in this run, ac-migrate is proved for the sidecar, the loop and the test line, but not for the `**Acceptance phase:**` header wording. Plan 2 updates that expectation in tests/integration/migrateDocuments.test.ts. Rejected: moving the header-line grammar into plan 1. That gives up the spec's and the brief's split, under which lint, the header lines and their refusals ship together.
- Internal names are renamed in the plan whose surface they serve. This plan renames the identifiers of the formats it changes: PhaseOracleSchema/PhaseOracle → PhaseAcceptanceSchema/PhaseAcceptance, RecordOracleRoleSchema/RecordOracleRole → RecordAcceptanceRoleSchema/RecordAcceptanceRole, and OracleStepSchema → AcceptanceStepSchema. It renames these files: src/schemas/oracleRequest.ts → src/schemas/acceptanceRequest.ts, src/domain/gate/oracleRequest.ts → src/domain/gate/acceptanceRequest.ts, packages/schemas/src/formats/oracleRequest.ts → packages/schemas/src/formats/acceptanceRequest.ts, tests/unit/oracleRequest.test.ts → tests/unit/acceptanceRequest.test.ts, and tests/unit/schemasPackage/oracleRequestFormat.test.ts → tests/unit/schemasPackage/acceptanceRequestFormat.test.ts. readOracleRequestFile becomes readAcceptanceRequestFile.

  These keep "oracle" until plan 2, and a reviewer should not flag them:
  - src/domain/plan/oracleCheck.ts, lint's `oracles` category and every message in it;
  - phaseHeader.ts's labels and its oraclePhase, oracleFiles, oracleDeclaration and OracleDeclaration.dischargedBy;
  - testLineCheck.ts's messages ("oracle loop", "oracle phase"), although its rule now compares the loop to `acceptance`;
  - the CLI words `--hold oracle` and `--skip-oracle`;
  - phaxConfig's `oracles` key;
  - "Oracle preflight failed" and the run preflight check id `oracle-phases`.

  These keep it until plan 3:
  - src/domain/plan/oraclePairs.ts and the review handoff's `## Oracle pairs`;
  - the overview's `oracleRole` JSON key with `dischargedBy`/`oraclePhase`, and its `oracle role` row;
  - records explain's `oracle` row and its "discharges" wording;
  - the `## Oracle role` prompt section and the fix prompt;
  - the internal failedStep value "oracle" (whatsNext, resumeInstructions, effects, events) and the telemetry event `oracle.edits.unjudged`;
  - cliDocs.ts and phax.usage.kdl, including the help text that still names `checks-attempt-NN.oracle-request.json`.

  These keep it until plan 4: the skills, README prose, docs pages, the site, examples/vitest-oracles, phax.json and knip.json.

  A few texts print a recorded value and say `acceptance` from phase-04 on, because the value they print changed: the verified surfaces in records list, the final report and the PR body. Loss accepted: until plan 3, some messages name the old words beside data in the new ones.
- Runs in flight (ac-in-flight). readPhaxPlanFile reads a run plan stamped from 0.32.0 up to the current stamp with the frozen 0.32.0 decoder, as shape `0.32.0`. It reads one stamped from 0.28.0 up to 0.32.0 with the frozen 0.28.0 decoder, as shape `0.28.0`, which today reads as `current`. Both are lifted to AnyShapePhaxPlan (the phase key renamed, no testLines), so `phax ls` and `phax session-info` still show the run. loadPlan refuses them with olderPhaxPlanMessage (`in the 0.32.0 shape`, naming `phax archive <run> --force`), as spec §5.19 and §7 require. This run's own phax-plan.json was extracted by the installed 0.32.0, and that same binary resumes it, so the run stays resumable to its end. The dev build is never asked to resume it. Loss accepted: a run started by 0.32.0 must be finished with 0.32.0 or archived. Rejected: reading a 0.32.0 run plan as current, as 0.32.0 did for 0.28.0. That gives up the spec's refusal, and would resume a run whose plan.md still holds the old words.
- From phase-04, the hold selection's recorded name and its CLI word differ. `--hold oracle` (still the only word until plan 2) records `"selection": "acceptance"` in run-status.json at 0.33.0. Plan 2 renames the word and refuses the old one. Loss accepted: for one release cycle on main, the input word and the recorded name differ. Nothing is released in between.
- Own-shape rendering for migrate-documents. src/domain/authoring/renderPlanV0_32_0.ts is a verbatim copy of today's renderPlanBody, typed on the frozen 0.32.0 plan document. It renders the own shape of both 0.32.0 and 0.28.0 sidecars, with their `**Oracle phase:**` and `**Oracle files:**` lines and their `oracle` loop, so an unedited body is still told apart from an edited one. Loss accepted: one more frozen renderer to keep. Required by the spec's §10.
- One acceptance pair: phase-03 writes the tests and phase-04 passes them. It covers the record and status lifts and the new names those four formats carry at 0.33.0, tested through phax's readers in src/schemas/persisted.ts and the package's parse and toLatest functions. Those entries all exist today, so each test fails on its assertion. The cases are inline literal documents in a shared case module, which is one of the acceptance test files, so no fixture helper the passing phase may change judges them. The plan formats are not in a pair. Their change is enums and a key, judged by the frozen-decoder tables and the render-then-parse round trip, and a pair would need one passing phase to do both phase-01 and phase-02. The acceptance-request lift is not in a pair either. Its entries (parseAcceptanceRequest, toLatestAcceptanceRequest) do not exist until phase-05, and a stub of them would add package exports early. Loss accepted: these lifts are tested in-phase, by the phase that writes them.
- Frozen modules and `next` snapshots, all stamped through `pnpm exec tsx scripts/schemas-check.ts --write`. Each frozen module is a verbatim, self-contained copy of today's shape, with its own test line, surface and role literals, listed as that format's release and pinned in the lock:
  - plan-document 0.32.0, phax-plan 0.32.0 and phax-plan-extraction 0.32.0 (phase-01);
  - run-status 0.26.0, phase-status 0.26.0, gate-attribution 0.31.0 and phase-record-manifest 0.30.0 (phase-04);
  - oracle-request 0.26.0, frozen as its final shape (phase-05).

  No shape gains an optional field. Every answer schema still passes the strict check.
- The 0.33.0 upgrading entry for records and schema readers is written once, in phase-05, covering every format this plan changes. Plan 4 completes it with the operator steps (phax.json key, hand-written plans, CLI spellings).

---

## phase-01 — Test line at 0.33.0: acceptance loop, boundary, reserved criteria {#phase-01-test-line}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** Restamps three published formats with their frozen modules and lifts, a frozen renderer for the migration, and the run-plan reader's refusal, a change crossing the schemas, domain, app and package layers.

A test line's loop is `acceptance | in-phase`, `boundary` joins the techniques after `example`, and a criterion may be neither `acceptance`, `in-phase` nor `oracle`. plan-document, phax-plan and phax-plan-extraction move to 0.33.0. Their 0.32.0 shapes are frozen and lifted, migrate-documents rewrites a 0.32.0 sidecar's loop, a run plan extracted by an earlier release is refused, and EXTRACTOR_VERSION moves to 5.

### Detailed instructions

- Freeze first. Copy today's PlanDocumentFileSchema, PhaxPlanFileSchema and the phax-plan-extraction answer schema (src/schemas/planExtraction.ts) verbatim into src/schemas/history/plan-document/0.32.0.ts, src/schemas/history/phax-plan/0.32.0.ts and src/schemas/history/phax-plan-extraction/0.32.0.ts. Model them on src/schemas/history/plan-document/0.28.0.ts and phax-plan/0.28.0.ts. Each module is self-contained: its own copy of the test line (loop `oracle | in-phase`, the eight techniques, the 'neither oracle nor in-phase' criterion filter and its message), its own strict NonEmptyString, its own question and lineage checks, and its 0.32.0 `$schema` field exactly as today (the answer const for plan-document and phax-plan-extraction; the release pattern for phax-plan). Export `PlanDocumentV0_32_0Schema`, type `PlanDocumentV0_32_0`, `decodePlanDocumentV0_32_0`, and the same three names for PhaxPlanV0_32_0 and PhaxPlanExtractionV0_32_0. Each must render its packages/schemas/snapshots/<id>/0.32.0.schema.json exactly.
- src/schemas/testLine.ts:
  - TestTechniqueSchema becomes `example, boundary, table, property, metamorphic, stateful, fuzz, contract, smoke`, in that order.
  - TestLoopSchema becomes `acceptance, in-phase`.
  - The criterion's reserved words become a named constant: TEST_LOOPS plus `oracle`. A comment says `oracle` stays reserved so plan 2 can recognize and refuse the old loop by name.
  - The criterion filter's message is exactly `a criterion is neither 'acceptance', 'in-phase' nor 'oracle'`, and its jsonSchema description names the three words, checked by phax.
  - Keep the oracle field's name, its three rules and their messages: they name the fourth field, in its literature sense.
  - Update the module comment.

  The rendered JSON Schema must still hold no lookaround.
- src/domain/plan/testLineCheck.ts: where a rule compares a line's loop to `oracle`, compare it to `acceptance`. Keep every message word for word ("oracle loop", "oracle phase"): plan 2 rewords them. src/domain/plan/testLineGrammar.ts reads TEST_LOOPS and TEST_TECHNIQUES, so it needs no change. A line holding `oracle` in its loop position is now a plain departure, `test line <n> departs from the format`, until plan 2 adds the refusal that names it.
- Create src/schemas/acceptanceLift.ts: pure functions, importing only effect and types from src/schemas. Add `liftTestLoop` (`oracle` → `acceptance`, `in-phase` kept) and a helper that lifts a phase's testLines. Later phases add the other lifts here (see Technical arbitrations).
- src/schemas/persisted.ts:
  - DocumentSidecar reads a plan sidecar stamped 0.32.0 with the frozen 0.32.0 decoder and lifts its test lines to the current shape.
  - A 0.28.0 sidecar is read with the frozen 0.28.0 decoder, stepped to 0.32.0 (identity minus `$schema`) and lifted the same way.
  - Older plan shapes keep their chain, now ending in the same lift.

  readPhaxPlanFile:
  - a stamp in [0.32.0, current) reads with the frozen 0.32.0 decoder, as shape `0.32.0`;
  - a stamp in [0.28.0, 0.32.0) reads with the frozen 0.28.0 decoder, as shape `0.28.0`, no longer `current`.

  Add both to PhaxPlanShape, lift both to AnyShapePhaxPlan (no testLines), and update the doc comments. loadPlan (src/app/loadPlan.ts) then refuses them with olderPhaxPlanMessage, naming `phax archive <run> --force`. `phax ls` and `phax session-info` still read `.plan`.
- src/domain/artifact/sidecar.ts: OlderDocumentShape gains `0.32.0` for plans, and describeStampedShape names it. Create src/domain/authoring/renderPlanV0_32_0.ts, a verbatim copy of today's renderPlanBody and the helpers it uses, typed on PlanDocumentV0_32_0. In src/domain/artifact/documentMigration.ts, renderOwnShape renders `0.32.0` and `0.28.0` plan sidecars with renderPlanBodyV0_32_0, the 0.28.0 one stepped to the 0.32.0 type. Update the comment above it. A migrated 0.32.0 sidecar is rewritten at 0.33.0, and its body is re-rendered by the current renderPlanBody, so its test lines now end `· acceptance` where they ended `· oracle`.
- src/domain/planCache/key.ts: EXTRACTOR_VERSION 4 → 5, with a comment: the test line's loop and techniques changed.
- Package:
  - packages/schemas/src/formats/repository.ts lists plan-document 0.32.0 (the frozen module) as a release, with a toLatest lift through acceptanceLift.
  - runDirectory.ts does the same for phax-plan 0.32.0, and answers.ts for phax-plan-extraction 0.32.0.
  - packages/schemas/src/index.ts exports the three frozen schemas and types beside the other released shapes.
  - Update tests/type/schemasPackage.ts.

  Then run `pnpm exec tsx scripts/schemas-check.ts --write` twice, and the check, which must report current. This writes the three `next` snapshots, src/schemas/release.ts (stamps 0.33.0), the generated index and the lock.
- Update every test fixture that holds the loop `oracle` in a current-shape plan document, phax-plan, extraction answer or plan.md test line to `acceptance`, keeping its scenario. Keep each test's expected loop-rule message unchanged. Leave every `**Oracle phase:**` / `**Oracle files:**` header line as it is (plan 2).
  - A test asserting that a 0.28.0 run plan resumes as current becomes a refusal test.
  - tests/unit/planCacheKey.test.ts expects 5.
  - A test that reads this repository's live or archived sidecars must still pass, through the frozen modules. Do not rewrite those sidecars.
- Create tests/unit/schemas/acceptanceTestLine.test.ts:
  - The technique enum, exactly and in order, in `answerJsonSchema("plan-document")` and in the rendered phax-plan and phax-plan-extraction schemas.
  - A boundary line decodes.
  - A sidecar whose phase-02 test line 1 has criterion `acceptance`, `in-phase` or `oracle` is refused with the new message, at the path the decoder reports for that phase and line.
  - A plan-document answer with loop `oracle` is refused by the enum's own message, which never names the old loop.

  Create tests/unit/renderPlanV0_32_0.test.ts: on a 0.32.0 fixture, the frozen renderer writes `**Oracle phase:** discharged by phase-04`, `**Oracle files:**` and `· oracle · AC-1`.
- Extend the integration tests:
  - tests/integration/lintTestLines.test.ts and tests/integration/planOverview.test.ts (ac-loop). An oracle phase, still declared with the old header lines, has the line `- every (state, transition) pair is accepted or refused as the table says — small · table · transition table · acceptance · AC-3`. Lint reports no `tests` error. The extracted line has loop `acceptance` and oracle `transition table`. The overview shows AC-3 covered by an `acceptance` line.
  - tests/integration/migrateDocuments.test.ts (ac-migrate, the loop half). A 0.32.0 sidecar migrates to 0.33.0 with loop `acceptance`, its plan.md test line ends `· acceptance · AC-1`, and one commit holds both files.
  - Same file (ac-unmigrated). Before the migration, `phax artifact approve <plan> --by operator` exits 12 naming `phax artifact migrate-documents`.
  - Same file (ac-archived). Plans and specs under `docs/plans/archive/` and `docs/specs/archive/` that hold the oracle names are byte-identical after migrate-documents, and `phax artifact status` reads one without error.
  - tests/integration/legacyRunFiles.test.ts (ac-in-flight). A run whose phax-plan.json is stamped 0.32.0 is refused by `phax resume` and `phax validate --plan`, naming `phax archive <run> --force`, and `phax ls` lists it.

  Use temporary repositories (tests/helpers/isolateGit.ts) and the fake backends. Never read ~/.phax or the global git config.

### Planned files to create

- `src/schemas/history/plan-document/0.32.0.ts`
- `src/schemas/history/phax-plan/0.32.0.ts`
- `src/schemas/history/phax-plan-extraction/0.32.0.ts`
- `src/schemas/acceptanceLift.ts`
- `src/domain/authoring/renderPlanV0_32_0.ts`
- `packages/schemas/snapshots/plan-document/next.schema.json`
- `packages/schemas/snapshots/phax-plan/next.schema.json`
- `packages/schemas/snapshots/phax-plan-extraction/next.schema.json`
- `tests/unit/schemas/acceptanceTestLine.test.ts`
- `tests/unit/renderPlanV0_32_0.test.ts`

### Planned files to edit

- `src/schemas/testLine.ts`
- `src/schemas/persisted.ts`
- `src/schemas/release.ts`
- `src/domain/plan/testLineCheck.ts`
- `src/domain/planCache/key.ts`
- `src/domain/artifact/sidecar.ts`
- `src/domain/artifact/documentMigration.ts`
- `packages/schemas/src/formats/repository.ts`
- `packages/schemas/src/formats/runDirectory.ts`
- `packages/schemas/src/formats/answers.ts`
- `packages/schemas/src/index.ts`
- `packages/schemas/src/generated/index.ts`
- `packages/schemas/history.lock.json`
- `tests/type/schemasPackage.ts`
- `tests/unit/testLineGrammar.test.ts`
- `tests/unit/testLineCheck.test.ts`
- `tests/unit/planDocument.test.ts`
- `tests/unit/renderPlan.test.ts`
- `tests/unit/schemas/answerRulesKept.test.ts`
- `tests/unit/planCacheKey.test.ts`
- `tests/unit/persisted.test.ts`
- `tests/integration/lintTestLines.test.ts`
- `tests/integration/planOverview.test.ts`
- `tests/integration/migrateDocuments.test.ts`
- `tests/integration/legacyRunFiles.test.ts`
- `tests/unit/schemasPackage/repositoryFormats.test.ts`
- `tests/unit/schemasPackage/runDirectoryFormats.test.ts`
- `tests/unit/schemasPackage/currentShapes.test.ts`
- `tests/unit/schemasPackage/documents.ts`

### Optional files that may be edited

- `src/schemas/phaxPlan.ts`
- `src/schemas/planDocument.ts`
- `src/schemas/planExtraction.ts`
- `src/app/loadPlan.ts`
- `src/app/migrateDocuments.ts`
- `src/app/unmigratedDocuments.ts`
- `src/domain/plan/testLineGrammar.ts`
- `src/domain/authoring/renderPlan.ts`
- `packages/schemas/build/jsonSchemas.ts`
- `docs/structured-answers.md`
- `tests/unit/architecturalGuards.test.ts`
- `tests/unit/extractPlan.test.ts`
- `tests/unit/parsePlanMarkdown.test.ts`
- `tests/unit/criterionCoverage.test.ts`
- `tests/unit/planOverview.test.ts`
- `tests/unit/schemas.test.ts`
- `tests/unit/schemas/strictAnswers.test.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/jsonSchemas.test.ts`
- `tests/unit/schemasPackage/parseDocument.test.ts`
- `tests/unit/schemasPackage/documents.test.ts`
- `tests/unit/schemasPackage/exports.test.ts`
- `tests/unit/artifact/documentMigration.test.ts`
- `tests/unit/artifact/sidecar.test.ts`
- `tests/unit/cli/validate.test.ts`
- `tests/integration/artifactStatus.test.ts`
- `tests/integration/decideArtifact.test.ts`
- `tests/integration/planCacheStore.test.ts`
- `tests/integration/oraclePhases.test.ts`
- `tests/integration/runPreflightBeforeNaming.test.ts`
- `tests/integration/holdCli.test.ts`
- `tests/integration/gates.test.ts`
- `tests/integration/fixLoop.test.ts`
- `tests/integration/persistedProducer.test.ts`
- `tests/helpers/liftFixturePhaxPlan.ts`
- `tests/helpers/planMarkdown.ts`

### Boundary contracts

Producer: src/schemas/testLine.ts. Consumers: the plan-document, phax-plan and phax-plan-extraction schemas, the line grammar (src/domain/plan/testLineGrammar.ts) and lint (testLineCheck.ts). Contract: TEST_LOOPS is `acceptance, in-phase` and TEST_TECHNIQUES the nine techniques in the spec's order. Producer: src/schemas/persisted.ts. Consumers: src/domain/artifact/documentMigration.ts, sidecar.ts and src/app/loadPlan.ts. Contract: a plan sidecar of any older shape reads as the current in-memory plan document, its loop lifted. readPhaxPlanFile reports `0.32.0` or `0.28.0` for a run plan an earlier release extracted, never `current`. Producer: src/schemas/acceptanceLift.ts. Consumers: persisted.ts and the package's format modules. Contract: pure lifts named per renamed value.

### Test strategy

- the technique enum is exactly example, boundary, table, property, metamorphic, stateful, fuzz, contract, smoke in the plan-document answer schema and the published phax-plan and phax-plan-extraction schemas — small · table · the expected enum array, in order · in-phase · ac-boundary
- a boundary test line decodes, lints with no tests error, and renders and reads back unchanged — small · example · the decoded line and its round trip · in-phase · ac-boundary
- a plan sidecar whose test line criterion is acceptance, in-phase or oracle is refused naming its phase and line — small · table · the message a criterion is neither 'acceptance', 'in-phase' nor 'oracle' at the line's path · in-phase · ac-criterion
- a test line in the acceptance loop lints with no tests error, extracts with loop acceptance and oracle transition table, and the overview shows AC-3 covered by it — medium · example · lint findings, phax-plan.json and the overview's coverage · in-phase · ac-loop
- a plan-document answer with the loop oracle is refused by the enum, never by name — small · example · the literal enum's own refusal message · in-phase · ac-loop
- a 0.32.0 or 0.28.0 plan sidecar reads through its frozen module with its loop lifted to acceptance — small · table · the lifted plan document · in-phase · ac-migrate
- migrate-documents rewrites a 0.32.0 sidecar at 0.33.0 with loop acceptance and the plan.md test line ending · acceptance · AC-1, both in one commit — medium · example · the rewritten sidecar, plan.md and the commit's files · in-phase · ac-migrate
- the frozen 0.32.0 renderer renders a 0.32.0 sidecar's own body, so a hand-edited body is still refused — small · example · the expected Markdown with its oracle loop and header lines · in-phase
- approve refuses a 0.32.0 plan sidecar with exit 12 naming phax artifact migrate-documents — medium · example · exit code and message · in-phase · ac-unmigrated
- archived plans and specs holding the oracle names are byte-identical after migrate-documents and their status reads without error — medium · example · file bytes before and after, and the status output · in-phase · ac-archived
- a run whose phax-plan.json is stamped 0.32.0 is refused by resume and validate --plan naming phax archive <run> --force, while phax ls lists it — medium · example · exit codes, messages and the ls output · in-phase · ac-in-flight
- an extraction cached under extractor version 4 is never reused — small · example · the cache key's extractor version 5 · in-phase
- every answer schema still passes the strict check — small · table · strictCheckFindings is empty for each answer format · in-phase

### Implementation order

1. frozen 0.32.0 modules for plan-document, phax-plan and phax-plan-extraction
2. testLine.ts, testLineCheck.ts and acceptanceLift.ts
3. persisted.ts readers and lifts, sidecar.ts, renderPlanV0_32_0.ts and documentMigration.ts
4. EXTRACTOR_VERSION 5
5. package formats and exports
6. schemas-check --write twice, then the check
7. fixtures, then the new tests

### Excluded scope

- The phase key `oracle`/`dischargedBy` (phase-02).
- The plan.md header lines, lint's `oracles` category, every lint message, and the named refusal of the old loop (plan 2).
- Record, status, gate-attribution and acceptance-request formats (phase-03 to phase-05).
- Skills, docs pages, the example, phax.json and knip.json (plan 4); migrating this repository's live sidecars (the operator, after the release).

### Verification

The `standard` gate profile in phax.json; also `pnpm exec tsx scripts/schemas-check.ts` reports the derived files current.

### Expected handoff content

The final TEST_TECHNIQUES and TEST_LOOPS, the reserved-criterion constant and its exact message and path form. The frozen modules added and their exported names. The lift functions in src/schemas/acceptanceLift.ts and their signatures. The PhaxPlanShape values and what loadPlan refuses. How renderOwnShape treats 0.28.0 and 0.32.0 sidecars. The stamps CURRENT_STAMPS now gives the three formats. Every test whose expected text still names the oracle loop, for plan 2. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(schemas): acceptance loop, boundary technique and reserved criteria at 0.33.0`

### Commit body

A test line's loop is now acceptance | in-phase, boundary joins the techniques after example, and a criterion may be neither 'acceptance', 'in-phase' nor 'oracle'. plan-document, phax-plan and phax-plan-extraction move to 0.33.0. Their 0.32.0 shapes are frozen and lifted, by phax and by the schemas package, through src/schemas/acceptanceLift.ts. migrate-documents renders a 0.32.0 or 0.28.0 sidecar's own body with a frozen renderer and rewrites its loop. A run plan extracted by an earlier release is now refused by resume and validate --plan, naming phax archive --force. EXTRACTOR_VERSION moves to 5. Lint's messages and the plan header lines keep the old words until the next plan.

---

## phase-02 — Plan phase key acceptance with passedBy {#phase-02-phase-key}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** Renames a key every plan reader shares, across the schemas, the header-line reader and renderer, the run, the overview and the package's lifts, with the render-then-parse round trip to keep.

A plan sidecar's and phax-plan.json's phase states its acceptance tests under `acceptance: { passedBy, files } | null`, in place of `oracle: { dischargedBy, files } | null`. Every older plan shape lifts to it, phax and the schemas package alike, and migrate-documents rewrites the key.

### Detailed instructions

- src/schemas/phaxPlan.ts: PhaseOracleSchema becomes PhaseAcceptanceSchema, `Schema.NullOr(Struct({ passedBy: PhaseId, files: non-empty array of strict NonEmptyString }))`, and type PhaseOracle becomes PhaseAcceptance. The phase key `oracle` becomes `acceptance`, in the same position (directly after `mode`). Descriptions say acceptance phase, acceptance test files and the passing phase; they never say oracle or discharge. src/schemas/planDocument.ts follows. The phax-plan-extraction answer has no phase key and does not change.
- src/schemas/acceptanceLift.ts: add `liftPhaseAcceptance`, which maps `{ dischargedBy, files }` to `{ passedBy, files }` and null to null. In src/schemas/persisted.ts:
  - every plan-document lift (0.32.0, 0.28.0, 0.26.0, and the chain from older shapes, which yields null) produces `acceptance`;
  - every phax-plan lift does too, including liftPhaxPlanPhases (`acceptance: null`);
  - AnyShapePhaxPlan follows the type.
- src/domain/plan/phaseHeader.ts: PhaseKinds becomes `{ mode, acceptance }`. phaseKinds maps an OracleDeclaration's discharge (the next phase, or phase-NN) to `passedBy`, and withPhaseKinds places `acceptance` where `oracle` was. Keep the line labels `Oracle phase` / `Oracle files`, the `discharged by phase-NN` grammar, and the internal names oraclePhase, oracleFiles, oracleDeclaration and OracleDeclaration: plan 2 renames them with the header lines. src/domain/plan/parsePlanMarkdown.ts emits the new key.
- src/domain/authoring/renderPlan.ts: read `phase.acceptance.passedBy` and `phase.acceptance.files`, and keep writing exactly `**Oracle phase:** discharged by phase-NN` and `**Oracle files:** …` (plan 2 changes the words). The render-then-parse round trip must still give back the sidecar's phases. The frozen renderers (renderPlanV0_26_0.ts, renderPlanV0_32_0.ts) are typed on their frozen shapes and do not change.
- Rename every read of a phase's `oracle`/`dischargedBy` to `acceptance`/`passedBy` in the domain and app layers: executePlan.ts, overview.ts, hold.ts, oraclePairs.ts, oracleCheck.ts and any other site the compiler names. Keep every message, rendered row and JSON output as it is. The overview's `oracleRole` with its `dischargedBy`/`oraclePhase` keys is plan 3's, so overview.ts maps the new key onto the old output.
- Package: in packages/schemas/src/formats/repository.ts and runDirectory.ts, every toLatest of an older plan-document and phax-plan lifts the phase key through acceptanceLift. LatestPlanPhase and LatestPhaxPlanPhase carry `acceptance`. Run `pnpm exec tsx scripts/schemas-check.ts --write`, which rewrites the plan-document and phax-plan `next` snapshots, then the check.
- Update every test fixture that builds a current-shape phase with `oracle: { dischargedBy, … }` to `acceptance: { passedBy, … }`, and every expected extracted plan, keeping each scenario. Plan.md fixtures keep their `**Oracle phase:**` lines. Extend tests/integration/migrateDocuments.test.ts (ac-migrate): a 0.32.0 sidecar whose phase-03 has `"oracle": { "dischargedBy": "phase-04", … }` migrates to `"acceptance": { "passedBy": "phase-04", … }` at 0.33.0. The header lines re-rendered from the lifted key are still the old words; add a comment that plan 2 changes them. Add to tests/unit/planDocument.test.ts: a current sidecar carrying an `oracle` phase key is refused as an excess property.

### Planned files to create

- (none)

### Planned files to edit

- `src/schemas/phaxPlan.ts`
- `src/schemas/planDocument.ts`
- `src/schemas/acceptanceLift.ts`
- `src/schemas/persisted.ts`
- `src/domain/plan/phaseHeader.ts`
- `src/domain/plan/parsePlanMarkdown.ts`
- `src/domain/authoring/renderPlan.ts`
- `src/domain/plan/overview.ts`
- `src/app/executePlan.ts`
- `packages/schemas/src/formats/repository.ts`
- `packages/schemas/src/formats/runDirectory.ts`
- `packages/schemas/snapshots/plan-document/next.schema.json`
- `packages/schemas/snapshots/phax-plan/next.schema.json`
- `tests/unit/phaseHeader.test.ts`
- `tests/unit/parsePlanMarkdown.test.ts`
- `tests/unit/renderPlan.test.ts`
- `tests/unit/planDocument.test.ts`
- `tests/unit/extractPlan.test.ts`
- `tests/unit/persisted.test.ts`
- `tests/integration/migrateDocuments.test.ts`
- `tests/unit/schemasPackage/repositoryFormats.test.ts`
- `tests/unit/schemasPackage/runDirectoryFormats.test.ts`

### Optional files that may be edited

- `src/domain/hold.ts`
- `src/domain/plan/oraclePairs.ts`
- `src/domain/plan/oracleCheck.ts`
- `src/domain/plan/testLineCheck.ts`
- `src/domain/plan/overviewRender.ts`
- `src/domain/whatsNext.ts`
- `src/domain/gate/oracleRequest.ts`
- `src/app/lintPlan.ts`
- `src/app/gates.ts`
- `src/app/writeRecord.ts`
- `src/app/closeStop.ts`
- `src/app/promptGeneration.ts`
- `src/app/resumeInstructions.ts`
- `src/app/loadOrExtractPlan.ts`
- `src/schemas/planExtraction.ts`
- `packages/schemas/src/index.ts`
- `packages/schemas/src/generated/index.ts`
- `src/schemas/release.ts`
- `tests/type/schemasPackage.ts`
- `tests/unit/oracleCheck.test.ts`
- `tests/unit/oraclePairs.test.ts`
- `tests/unit/planOverview.test.ts`
- `tests/unit/hold.test.ts`
- `tests/unit/promptGeneration.test.ts`
- `tests/unit/criterionCoverage.test.ts`
- `tests/unit/runPreflight.test.ts`
- `tests/unit/schemas.test.ts`
- `tests/unit/schemas/answerRulesKept.test.ts`
- `tests/unit/schemasPackage/documents.ts`
- `tests/unit/schemasPackage/currentShapes.test.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/integration/oraclePhases.test.ts`
- `tests/integration/gates.test.ts`
- `tests/integration/holdCli.test.ts`
- `tests/integration/runPreflightBeforeNaming.test.ts`
- `tests/integration/resumePreflightRechecks.test.ts`
- `tests/integration/lintPlan.test.ts`
- `tests/integration/planOverview.test.ts`
- `tests/integration/oraclePairReview.test.ts`
- `tests/integration/decideArtifact.test.ts`
- `tests/integration/legacyRunFiles.test.ts`
- `tests/helpers/liftFixturePhaxPlan.ts`
- `tests/helpers/planMarkdown.ts`
- `tests/helpers/heldRunFixture.ts`

### Boundary contracts

Producer: src/domain/plan/phaseHeader.ts (phaseKinds) and parsePlanMarkdown.ts. Consumers: extraction (deterministic and fallback), lint and the run preflight. Contract: a phase's `acceptance` is `{ passedBy, files }` when its header lines declare a well-formed pair, else null. Producer: src/schemas/persisted.ts. Consumers: documentMigration.ts, executePlan.ts, overview and records. Contract: any plan shape reads with the `acceptance` key. Producer: the package's toLatestPlanDocument and toLatestPhaxPlan. Consumers: scripts reading sidecars and run plans. Contract: the same lifted key.

### Test strategy

- a plan sidecar phase carries acceptance with passedBy and files, and a current sidecar with an oracle phase key is refused naming the key — small · example · the decoded phase and the excess-property refusal · in-phase
- the header lines read into acceptance, with passedBy the next phase for yes and phase-NN for discharged by phase-NN — small · table · phaseKinds output per declaration · in-phase
- rendering a plan sidecar and parsing its plan.md gives back the same acceptance key on every phase — small · example · the sidecar's phases · in-phase
- a 0.32.0 sidecar with oracle dischargedBy phase-04 migrates to acceptance passedBy phase-04 at 0.33.0 — medium · example · the rewritten sidecar and plan.md · in-phase · ac-migrate
- the schemas package lifts 0.32.0, 0.28.0 and 0.26.0 plan documents and run plans to acceptance with passedBy — small · table · toLatestPlanDocument and toLatestPhaxPlan results · in-phase

### Implementation order

1. phaxPlan.ts and planDocument.ts
2. acceptanceLift.ts and persisted.ts lifts
3. phaseHeader.ts, parsePlanMarkdown.ts and renderPlan.ts
4. domain and app consumers
5. package lifts, then schemas-check --write and the check
6. fixtures, then the new tests

### Excluded scope

- The header-line words, their refusals and lint's messages (plan 2).
- The overview's oracleRole JSON and rows, the review handoff and the prompt (plan 3).
- Record and status formats (phase-03, phase-04) and the acceptance request (phase-05).

### Verification

The `standard` gate profile in phax.json; also `pnpm exec tsx scripts/schemas-check.ts` reports the derived files current.

### Expected handoff content

The PhaseAcceptance type and its module path. liftPhaseAcceptance's signature. The sites that now read `acceptance` but still print the old words, for plans 2 and 3. Confirmation that the render-then-parse round trip holds. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(schemas): plan phase key acceptance with passedBy`

### Commit body

A plan sidecar's and phax-plan.json's phase now carries acceptance: { passedBy, files } | null in place of oracle: { dischargedBy, files } | null. Every older plan shape lifts to it, in phax and in the schemas package, and migrate-documents rewrites the key. The header lines are read into the new key and still rendered with their old words, which the next plan renames together with lint.

---

## phase-03 — Acceptance tests for the record and status lifts {#phase-03-record-lift-tests}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium
**Oracle phase:** discharged by phase-04
**Oracle files:** `tests/unit/schemas/acceptanceRecordLiftCases.ts`, `tests/unit/schemas/acceptanceRecordLifts.test.ts`, `tests/unit/schemasPackage/acceptanceRecordLifts.test.ts`

Freeze, as acceptance tests marked expected-to-fail, what phax and the schemas package must read once the record and status formats move to 0.33.0. Older run status, phase status, gate attribution and phase record manifests read under the acceptance names, 0.33.0 documents read with those names, and 0.33.0 documents with the oracle names are refused.

### Detailed instructions

- Create tests/unit/schemas/acceptanceRecordLiftCases.ts, a plain module (no test in it) exporting two tables of inline literal documents. Every document is a complete, valid literal JSON value with its `$schema` URL written out. Import no fixture helper: tests/helpers/*Fixture.ts change in the passing phase.

  Table 1 holds the lift cases: input document, then expected in-memory value:
  - run-status 0.26.0 with `hold: { selection: "oracle", phases: ["phase-03"] }` → `selection: "acceptance"`;
  - phase-status 0.26.0 with a closed held stop carrying `oracleStep: "authored"`, and one with `oracleStep: "none"` → `acceptanceStep` with the same value;
  - gate-attribution 0.31.0 whose appended step has `surface: "oracle"`, `result: "pass"`, and one with `result: "skipped"` → `surface: "acceptance"`;
  - gate-attribution 0.26.0 with an `oracle` step → `acceptance`, with `protectedPaths: null` as today's lift gives;
  - phase-record-manifest 0.30.0 with `oracle: { role: "oracle", dischargedBy: "phase-04" }` and `verifiedSurfaces: ["local", "oracle"]` → `acceptance: { role: "acceptance", passedBy: "phase-04" }` and `["acceptance", "local"]`;
  - the same with `{ role: "discharging", oraclePhase: "phase-03" }` → `{ role: "passing", acceptancePhase: "phase-03" }`, and `oracle: null` → `acceptance: null`;
  - one phase-record-manifest 0.26.0 case with a role.

  The expected value is what phax's reader returns today for that input, `$schema` dropped, with exactly the rename table's changes, and nothing else changed.

  Table 2 holds the same four formats stamped `https://docs.phax.run/schemas/<id>/0.33.0.json`: each once with the new names (expected to read, with that value) and once with the old names (expected to be refused).
- Create tests/unit/schemas/acceptanceRecordLifts.test.ts, testing phax's readers in src/schemas/persisted.ts (readRunStatusFile, readPhaseStatusFile, readGateAttributionFile, readRecordManifestFile), which all exist today:
  - `it.fails.each` over table 1 asserts `Either.isRight` and `toEqual` of the right value against the expected value;
  - `it.fails.each` over table 2 asserts in one test that the new-name document reads with its value and that the old-name document is refused (`Either.isLeft`). The read assertion comes first, so the test fails today on that assertion, since the stamp is newer than the current one.
- Create tests/unit/schemasPackage/acceptanceRecordLifts.test.ts, testing the package's public entries: parseDocument identifies each table-1 document's format, and parseRunStatus, parsePhaseStatus, parseGateAttribution and parsePhaseRecordManifest with their toLatest functions give the expected value. Follow the call pattern of tests/unit/schemasPackage/recordTimeline.test.ts and runDirectoryFormats.test.ts. Assert on the toLatest result with `toEqual`, and assert table 2's new-name documents parse to the expected value. Every test carries `it.fails` or `it.fails.each`.
- Every test is an acceptance test of the acceptance loop. Each must fail today on its assertion, never because a module, export or type is missing. Never read a renamed property directly (`.acceptance`, `.acceptanceStep`): compare whole values with `toEqual`, so the file typechecks under `pnpm test:type` before and after the passing phase. Each test must also fail for its own case: a test made only of refusals that already hold today would pass and break its marker, so pair every refusal with a read in the same test. No randomness.
- Do not touch any src/ or packages/ file. The gate's `pnpm test` stays green because every test is marked.

### Planned files to create

- `tests/unit/schemas/acceptanceRecordLiftCases.ts`
- `tests/unit/schemas/acceptanceRecordLifts.test.ts`
- `tests/unit/schemasPackage/acceptanceRecordLifts.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- (none)

### Boundary contracts

Consumer: these acceptance tests. Producers: phax's readers in src/schemas/persisted.ts and the package's parse*, toLatest* and parseDocument exported from packages/schemas/src/index.ts. Contract: an older or 0.33.0 record or status document reads as the current in-memory value under the acceptance names, or is refused.

### Test strategy

- phax lifts run-status 0.26.0, phase-status 0.26.0, gate-attribution 0.31.0 and 0.26.0, and phase-record-manifest 0.30.0 and 0.26.0 to the acceptance names — small · table · the expected values in the shared case table · oracle · ac-read-old
- phax reads 0.33.0 run status, phase status, gate attribution and record manifests carrying the acceptance names and refuses them carrying the oracle names — small · table · the reader's value or refusal per case · oracle · ac-status-record
- the schemas package lifts the same older documents to the same acceptance names — small · table · toLatest results against the shared case table · oracle · ac-read-old
- the schemas package parses 0.33.0 documents carrying the acceptance names — small · table · the parsed and lifted value per case · oracle · ac-status-record
- a lifted record manifest keeps its verified surfaces sorted, oracle becoming acceptance — small · example · ["acceptance", "local"] · oracle · ac-read-old

### Implementation order

1. the case module with both tables
2. the phax reader tests
3. the package tests

### Excluded scope

- Any change to src/ or packages/ (phase-04).
- The acceptance-request format and its lift (phase-05).
- Plan formats (phase-01, phase-02).

### Verification

The `standard` gate profile in phax.json, with the configured oracles provider judging the authored acceptance tests.

### Expected handoff content

The three file paths, the case tables' rows, and the reader and package entries each test calls. Confirmation that every test carries the expected-failure marker and fails today on an assertion. Any deviation from the planned file lists, with the reason.

### Commit subject

`test(schemas): acceptance tests for the record and status lifts`

### Commit body

Freeze, behind expected-failure markers, what phax's readers and the schemas package must return once run-status, phase-status, gate-attribution and phase-record-manifest move to 0.33.0. Older documents read under the acceptance names, 0.33.0 documents read with them, and 0.33.0 documents carrying the oracle names are refused. The cases are inline literal documents in a shared case module.

---

## phase-04 — Run status, phase status, gate attribution and record manifest at 0.33.0 {#phase-04-record-formats}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium
**Assignment reason:** Passes an acceptance pair across four published formats, their frozen shapes, phax's readers and writers, and the package's lifts: a change crossing the schemas, domain, app, cli and package layers.

phax writes run-status, phase-status, gate-attribution and phase-record-manifest at 0.33.0 under the acceptance names: hold selection `acceptance`, stop key `acceptanceStep`, step and verified surface `acceptance`, and record role `acceptance` with `passedBy` or `passing` with `acceptancePhase`. Each format's previous shape is frozen and lifted, and phase-03's acceptance tests pass.

### Detailed instructions

- Freeze first. Copy today's RunStatusFileSchema, PhaseStatusFileSchema, GateAttributionFileSchema and the phase record manifest's file schema verbatim into src/schemas/history/run-status/0.26.0.ts, src/schemas/history/phase-status/0.26.0.ts, src/schemas/history/gate-attribution/0.31.0.ts and src/schemas/history/phase-record-manifest/0.30.0.ts. Each is self-contained, with its own copies of the hold selection, the stop with `oracleStep`, the recorded surface literal with `oracle` and the role union `oracle`/`discharging`. Model them on the existing modules in those folders. Each must render its existing release snapshot exactly.
- Rename:
  - src/schemas/surface.ts: RecordedSurfaceSchema becomes `local, structural, product, acceptance`, with the comment reworded. A configured gate step keeps SurfaceSchema, so it may still not declare `acceptance`.
  - src/schemas/status.ts: the hold selection literal `oracle` → `acceptance`, and OracleStepSchema → AcceptanceStepSchema (`authored | none` unchanged), with the stop key `oracleStep` → `acceptanceStep` and descriptions reworded.
  - src/schemas/runRecord.ts: RecordOracleRoleSchema → RecordAcceptanceRoleSchema, `{ role: "acceptance", passedBy } | { role: "passing", acceptancePhase }` nullable, and the manifest key `oracle` → `acceptance`.
  - src/schemas/gateAttribution.ts: descriptions.

  No field becomes optional.
- src/schemas/acceptanceLift.ts: add liftRecordedSurface, liftRecordRole, liftVerifiedSurfaces (map, then sort), liftHoldSelection and liftStopStep. In src/schemas/persisted.ts:
  - readRunStatusFile reads a stamp in [0.26.0, current) with the frozen 0.26.0 decoder and lifts the hold selection. Older stamps keep the 0.17.0 path (`hold: { selection: "none" }`).
  - readPhaseStatusFile reads [0.26.0, current) with the frozen 0.26.0 decoder and lifts a closed stop's step, and older stamps keep the 0.20.0 path.
  - readGateAttributionFile reads [0.31.0, current) with the frozen 0.31.0 decoder, and the 0.26.0 and older paths now also lift the surface.
  - readRecordManifestFile reads phase-record-manifest [0.30.0, current) with the frozen 0.30.0 decoder, and the 0.26.0 lift also renames the role and the surfaces.
- Writers and readers in domain, app and cli:
  - src/domain/hold.ts: the CLI word `oracle` (unchanged until plan 2) selects the selection `acceptance`.
  - src/app/closeStop.ts writes `acceptanceStep`.
  - src/app/gates.ts appends the step with `surface: "acceptance"`, `skipped` under `--skip-oracle`.
  - src/domain/gate/verifiedSurfaces.ts, src/app/writeRecord.ts and src/domain/records/assemble.ts write the `acceptance` role key and its values.
  - src/app/recordsExplain.ts and src/cli/commands/records.ts read `manifest.acceptance`, and keep the row label `oracle` and its wording (plan 3).
  - src/app/executePlan.ts and any other site the compiler names.

  The internal failedStep value `oracle` and telemetry stay as they are (plan 3).
- Package:
  - packages/schemas/src/formats/runDirectory.ts lists run-status 0.26.0 and phase-status 0.26.0 as releases with lifts;
  - recordTimeline.ts does the same for gate-attribution 0.31.0, and recordManifests.ts for phase-record-manifest 0.30.0;
  - older releases' toLatest go through the same lifts;
  - index.ts exports the four frozen schemas and types beside the others;
  - update tests/type/schemasPackage.ts.

  Run `pnpm exec tsx scripts/schemas-check.ts --write` twice, then the check.
- Remove every `.fails` marker from tests/unit/schemas/acceptanceRecordLiftCases.ts, tests/unit/schemas/acceptanceRecordLifts.test.ts and tests/unit/schemasPackage/acceptanceRecordLifts.test.ts. That is the only change allowed in them. Every acceptance test must pass without editing it. If one cannot, stop and report it in the handoff; do not change the test.
- Update the other tests and fixtures to the new names, keeping each scenario: tests/helpers/runStatusFixture.ts, phaseStatusFixture.ts, the persisted, runRecord, verifiedSurfaces, gateAttribution, hold, gates, writeRecord, recordsExplain, holdCli and oraclePhases tests, the package's format tests, and any snapshot the compiler or the suite names. Extend tests/integration/oraclePhases.test.ts (ac-status-record): a held stop on acceptance phase phase-03 is closed with a correction whose gate passes the acceptance step. Then status.json's stop carries `"acceptanceStep": "authored"`. phase-03's manifest carries `"acceptance": { "role": "acceptance", "passedBy": "phase-04" }` and lists `acceptance` in verifiedSurfaces, phase-04's carries `{ "role": "passing", "acceptancePhase": "phase-03" }`, and each is stamped 0.33.0. Use temporary repositories and the fake backends.

### Planned files to create

- `src/schemas/history/run-status/0.26.0.ts`
- `src/schemas/history/phase-status/0.26.0.ts`
- `src/schemas/history/gate-attribution/0.31.0.ts`
- `src/schemas/history/phase-record-manifest/0.30.0.ts`
- `packages/schemas/snapshots/run-status/next.schema.json`
- `packages/schemas/snapshots/phase-status/next.schema.json`
- `packages/schemas/snapshots/gate-attribution/next.schema.json`
- `packages/schemas/snapshots/phase-record-manifest/next.schema.json`

### Planned files to edit

- `tests/unit/schemas/acceptanceRecordLiftCases.ts`
- `tests/unit/schemas/acceptanceRecordLifts.test.ts`
- `tests/unit/schemasPackage/acceptanceRecordLifts.test.ts`
- `src/schemas/surface.ts`
- `src/schemas/status.ts`
- `src/schemas/runRecord.ts`
- `src/schemas/gateAttribution.ts`
- `src/schemas/acceptanceLift.ts`
- `src/schemas/persisted.ts`
- `src/schemas/release.ts`
- `src/domain/hold.ts`
- `src/domain/gate/verifiedSurfaces.ts`
- `src/domain/records/assemble.ts`
- `src/app/closeStop.ts`
- `src/app/gates.ts`
- `src/app/writeRecord.ts`
- `src/app/recordsExplain.ts`
- `src/cli/commands/records.ts`
- `packages/schemas/src/formats/runDirectory.ts`
- `packages/schemas/src/formats/recordTimeline.ts`
- `packages/schemas/src/formats/recordManifests.ts`
- `packages/schemas/src/index.ts`
- `packages/schemas/src/generated/index.ts`
- `packages/schemas/history.lock.json`
- `tests/type/schemasPackage.ts`
- `tests/helpers/runStatusFixture.ts`
- `tests/helpers/phaseStatusFixture.ts`
- `tests/unit/persisted.test.ts`
- `tests/unit/runRecord.test.ts`
- `tests/unit/verifiedSurfaces.test.ts`
- `tests/unit/gateAttribution.test.ts`
- `tests/unit/gateAttribution.reader.test.ts`
- `tests/unit/hold.test.ts`
- `tests/integration/gates.test.ts`
- `tests/integration/writeRecord.test.ts`
- `tests/integration/recordsExplain.test.ts`
- `tests/integration/holdCli.test.ts`
- `tests/integration/oraclePhases.test.ts`
- `tests/unit/schemasPackage/runDirectoryFormats.test.ts`
- `tests/unit/schemasPackage/recordTimeline.test.ts`
- `tests/unit/schemasPackage/recordManifests.test.ts`
- `tests/unit/schemasPackage/phaseRecordManifestHistory.test.ts`
- `tests/unit/schemasPackage/currentShapes.test.ts`
- `tests/unit/schemasPackage/documents.ts`

### Optional files that may be edited

- `src/app/executePlan.ts`
- `src/app/recordsList.ts`
- `src/app/finalReport.ts`
- `src/app/publishRun.ts`
- `src/app/resumeInstructions.ts`
- `src/app/resetPhase.ts`
- `src/domain/publish/prBody.ts`
- `src/domain/plan/oraclePairs.ts`
- `src/domain/reducer.ts`
- `src/domain/whatsNext.ts`
- `src/schemas/telemetryEvents.ts`
- `tests/architecturalGuards.test.ts`
- `tests/unit/architecturalGuards.test.ts`
- `tests/unit/recordsAssemble.test.ts`
- `tests/unit/reducerGateRefusal.test.ts`
- `tests/unit/resetPhaseRefusal.test.ts`
- `tests/unit/oraclePairs.test.ts`
- `tests/unit/resumeInstructions.test.ts`
- `tests/unit/whatsNext.test.ts`
- `tests/unit/vibeUsageLift.test.ts`
- `tests/unit/schemas/interactiveFormats.test.ts`
- `tests/unit/schemas.test.ts`
- `tests/unit/schemaUrl.test.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/jsonSchemas.test.ts`
- `tests/unit/schemasPackage/parseDocument.test.ts`
- `tests/unit/schemasPackage/documents.test.ts`
- `tests/unit/schemasPackage/manifest.test.ts`
- `tests/integration/__snapshots__/executePlan.test.ts.snap`
- `tests/integration/__snapshots__/protectedPathsAdditive.test.ts.snap`
- `tests/integration/reviewHandoff.test.ts`
- `tests/integration/oraclePairReview.test.ts`
- `tests/integration/holdPreflight.test.ts`
- `tests/integration/resetPhase.test.ts`
- `tests/integration/recordsExplainStop.test.ts`
- `tests/integration/legacyRunFiles.test.ts`
- `tests/integration/persistedProducer.test.ts`
- `tests/integration/fixLoop.test.ts`
- `tests/helpers/heldRunFixture.ts`
- `tests/helpers/stoppedRunFixture.ts`

### Boundary contracts

Producer: src/schemas/persisted.ts readers. Consumers: records explain, records list, resume, status and the final report. Contract: every record and status document of any shape reads under the acceptance names. Producer: src/app/gates.ts, closeStop.ts and writeRecord.ts. Consumers: scripts reading run folders and records. Contract: written documents are stamped 0.33.0 and carry only the new names. Producer: the package's toLatest functions. Contract: the same lifted values as phax's readers, through the same lift functions.

### Test strategy

- a held, corrected acceptance pair writes status.json with acceptanceStep authored and both record manifests with the acceptance and passing roles, all stamped 0.33.0 — medium · example · status.json and the two manifests · in-phase · ac-status-record
- a skipped acceptance step is recorded with surface acceptance and result skipped and leaves acceptance off the run's verified surfaces — small · example · the gate attribution and runVerifiedSurfaces · in-phase
- a run held with --hold oracle records the hold selection acceptance — medium · example · run-status.json · in-phase
- each newly frozen module renders its released snapshot and is pinned in the lock — small · table · frozenHistory's snapshot and lock comparison · in-phase

### Implementation order

1. frozen modules for the four formats
2. surface.ts, status.ts, runRecord.ts and gateAttribution.ts
3. acceptanceLift.ts and persisted.ts readers
4. writers and readers in domain, app and cli
5. package formats and exports, then schemas-check --write twice and the check
6. remove the markers, then fixtures and the new tests

### Excluded scope

- Any change to the acceptance tests beyond removing their markers.
- The CLI words --hold oracle and --skip-oracle and their refusals (plan 2).
- Records-explain, overview and handoff wording, the failedStep value and telemetry (plan 3).
- The acceptance-request format (phase-05).

### Verification

The `standard` gate profile in phax.json, with the configured oracles provider judging that the acceptance tests passed; also `pnpm exec tsx scripts/schemas-check.ts` reports the derived files current.

### Expected handoff content

The final shapes of the four formats' renamed fields, the frozen modules and releases added, the lift functions and where each reader applies them, and the stamps CURRENT_STAMPS now gives. The sites still printing the old words, for plans 2 and 3. Confirmation that the acceptance tests pass with only their markers removed. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(schemas): acceptance names in status, gate attribution and record manifests`

### Commit body

run-status, phase-status, gate-attribution and phase-record-manifest move to 0.33.0. They carry the hold selection acceptance, the stop key acceptanceStep, the step and verified surface acceptance, and the record role acceptance with passedBy or passing with acceptancePhase. Their previous shapes are frozen. phax and the schemas package read and lift them through the shared lift functions, and the acceptance tests for these lifts now pass. The --hold oracle word still selects the acceptance phases until the next plan.

---

## phase-05 — The acceptance-request format and the 0.33.0 upgrading entry {#phase-05-acceptance-request}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** Births a published format beside a frozen one, with a package reader that parses two format ids, a shape no code in the repository shows yet, and rewires the gate's request writer.

An acceptance provider reads an `acceptance-request` stamped 0.33.0 on stdin, with verdict `authored` or `passed` and keys `phase`, `acceptancePhase`, `base`, `files`, plus `acceptanceCommit` on `passed`. phax saves it as `checks-attempt-NN.acceptance-request.json`. `oracle-request` stays readable at 0.26.0, the schemas package exports `parseAcceptanceRequest` and `toLatestAcceptanceRequest`, and docs/upgrading.md gains its 0.33.0 entry for records and schema readers.

### Detailed instructions

- Freeze first. Move today's OracleRequestFileSchema verbatim into src/schemas/history/oracle-request/0.26.0.ts. It is self-contained, with its own phase-id and full-sha patterns, and exports OracleRequestV0_26_0Schema, type OracleRequestV0_26_0 and decodeOracleRequestV0_26_0. Model it on src/schemas/history/hand-decision-answer/0.25.0.ts. It must render packages/schemas/snapshots/oracle-request/0.26.0.schema.json exactly.
- Remove src/schemas/oracleRequest.ts and create src/schemas/acceptanceRequest.ts. AcceptanceRequestFileSchema is a union of two closed variants, both with `$schema: schemaUrlField("acceptance-request")`:
  - `{ verdict: "authored", phase, acceptancePhase, base, files }`;
  - `{ verdict: "passed", phase, acceptancePhase, base, acceptanceCommit, files }`.

  All keys are required, and the descriptions say acceptance phase, acceptance test files and passing phase. Provide the AcceptanceRequest type without `$schema`, decodeAcceptanceRequestFile (`onExcessProperty: "error"`) and encodeAcceptanceRequestFile.
- Register the format:
  - src/schemas/schemaUrl.ts: append `acceptance-request` to FORMAT_IDS and SCHEMA_BORN_FORMAT_IDS, and update the doc comments. `oracle-request` stays, frozen.
  - packages/schemas/build/jsonSchemas.ts: add the FORMAT_DEFINITIONS, EXCESS (`error`) and JSON_SCHEMA_FORMATS entries.
  - oracle-request's definition lists the frozen 0.26.0 module as its release and as its current shape, with no `next`, as hand-decision-answer does.
- src/schemas/acceptanceLift.ts: add liftOracleRequest. An `authored` verdict stays `authored`, `discharged` becomes `passed`, `oraclePhase` → `acceptancePhase`, and `oracleCommit` → `acceptanceCommit`. Key order follows the acceptance-request variant. In src/schemas/persisted.ts, readOracleRequestFile becomes readAcceptanceRequestFile, which reads the current acceptance-request. phax never reads a saved oracle-request back.
- Rename src/domain/gate/oracleRequest.ts to src/domain/gate/acceptanceRequest.ts. It builds the AcceptanceRequest (`authored` at the acceptance phase; `passed` with `acceptanceCommit` at the passing phase), and its path helper maps `checks-attempt-NN.log` to `checks-attempt-NN.acceptance-request.json`. src/domain/gate/attemptFiles.ts names the new suffix. src/app/gates.ts writes the encoded request on the provider's stdin and saves it. src/app/closeStop.ts reads `.acceptance-request.json` back. src/app/recordsExplain.ts lists `.acceptance-request.json`, and `.oracle-request.json` for records written before. The provider is still configured under `oracles` (plan 2). cliDocs.ts and phax.usage.kdl, which still name the old file, belong to plan 3.
- Package: rename packages/schemas/src/formats/oracleRequest.ts to packages/schemas/src/formats/acceptanceRequest.ts. It holds:
  - oracleRequestFormat: frozen, its current shape the 0.26.0 module;
  - acceptanceRequestFormat: born with `$schema`, current `next`;
  - parseAcceptanceRequest, which reads the `$schema` format and parses an acceptance-request with acceptanceRequestFormat and an oracle-request with oracleRequestFormat, returning a ParsedShape whose shape names the release;
  - toLatestAcceptanceRequest, which drops `$schema` from an acceptance request and lifts an oracle request through liftOracleRequest;
  - LatestAcceptanceRequest and AcceptanceRequestShape.

  packages/schemas/src/index.ts:
  - remove OracleRequestSchema, OracleRequest, parseOracleRequest, toLatestOracleRequest, LatestOracleRequest and OracleRequestShape;
  - add AcceptanceRequestSchema, AcceptanceRequest, parseAcceptanceRequest, toLatestAcceptanceRequest, LatestAcceptanceRequest and AcceptanceRequestShape;
  - export OracleRequestV0_26_0Schema and its type in the frozen block;
  - add `acceptance-request` to DocumentShapes and parseDocument, keeping `oracle-request`.

  Update tests/type/schemasPackage.ts.
- Run `pnpm exec tsx scripts/schemas-check.ts --write` twice, then the check. This writes packages/schemas/snapshots/acceptance-request/next.schema.json and leaves oracle-request at its 0.26.0 snapshot. Then update the registries:
  - README.md's persisted-formats table: an `Acceptance request` row (`acceptance-request`, the provider's stdin and `<run folder>/<phase-id>/checks-attempt-NN.acceptance-request.json`, `parseAcceptanceRequest`, `json/acceptance-request.schema.json`), and the `oracle-request` row saying it is read only, at 0.26.0, through `parseAcceptanceRequest`, in the shape tests/unit/readmePersistedFormats.test.ts requires;
  - `NEVER_WRITTEN` in tests/integration/persistedProducer.test.ts gains `oracle-request`;
  - the closure allowlist and BRIDGE_ONLY_DECODERS in tests/unit/architecturalGuards.test.ts take the new modules and src/schemas/acceptanceLift.ts;
  - tests/unit/schemaUrl.test.ts, and the package's parseDocument, exports and documents fixtures.
- Rename tests/unit/oracleRequest.test.ts to tests/unit/acceptanceRequest.test.ts and tests/unit/schemasPackage/oracleRequestFormat.test.ts to tests/unit/schemasPackage/acceptanceRequestFormat.test.ts, rewriting them for the new format.
  - Cover an exact key set per variant, any other key refused.
  - parseAcceptanceRequest reads a 0.33.0 acceptance request and a 0.26.0 oracle request saved by phax 0.32.0, and toLatestAcceptanceRequest lifts the latter's `discharged` to `passed` with `acceptancePhase` and `acceptanceCommit` (ac-read-old).
  - parseDocument identifies both formats.

  In tests/integration/gates.test.ts, the gate of each pair phase writes the 0.33.0 request on stdin and saves the same bytes as `checks-attempt-01.acceptance-request.json` (`passed` with `acceptanceCommit`; `authored` without). In tests/integration/recordsExplain.test.ts, a 0.32.0 record still lists its `.oracle-request.json`. examples/vitest-oracles stays as it is (plan 4) and keeps its own tests, which send it oracle-request documents.
- docs/upgrading.md: add a `### 0.33.0` entry above 0.32.0 for records and schema readers, in the 0.32.0 entry's style. One bullet per change:
  - plan-document, phax-plan and phax-plan-extraction at 0.33.0: the phase key `acceptance` with `passedBy`, the loop `acceptance`, the technique `boundary`, and the reserved criterion words;
  - run-status, phase-status, gate-attribution and phase-record-manifest at 0.33.0: the hold selection, `acceptanceStep`, the surface `acceptance`, and the roles `acceptance`/`passing` with `passedBy`/`acceptancePhase`;
  - the new `acceptance-request` and its saved file, oracle-request read only at 0.26.0;
  - the schemas package's renamed exports;
  - older records still read under the new names;
  - `phax artifact migrate-documents` once, with approve, reopen and decide refusing until then;
  - runs in flight refused, naming `phax archive <run> --force`.

  End with one sentence saying the configuration, hand-written plan, CLI and provider steps of this release are listed when they ship (plan 4 completes the entry). Do not edit earlier entries.

### Planned files to create

- `src/schemas/acceptanceRequest.ts`
- `src/schemas/history/oracle-request/0.26.0.ts`
- `src/domain/gate/acceptanceRequest.ts`
- `packages/schemas/src/formats/acceptanceRequest.ts`
- `packages/schemas/snapshots/acceptance-request/next.schema.json`
- `tests/unit/acceptanceRequest.test.ts`
- `tests/unit/schemasPackage/acceptanceRequestFormat.test.ts`

### Planned files to edit

- `src/schemas/oracleRequest.ts`
- `src/domain/gate/oracleRequest.ts`
- `packages/schemas/src/formats/oracleRequest.ts`
- `tests/unit/oracleRequest.test.ts`
- `tests/unit/schemasPackage/oracleRequestFormat.test.ts`
- `src/schemas/schemaUrl.ts`
- `src/schemas/release.ts`
- `src/schemas/persisted.ts`
- `src/schemas/acceptanceLift.ts`
- `src/domain/gate/attemptFiles.ts`
- `src/app/gates.ts`
- `src/app/closeStop.ts`
- `src/app/recordsExplain.ts`
- `packages/schemas/build/jsonSchemas.ts`
- `packages/schemas/src/index.ts`
- `packages/schemas/src/generated/index.ts`
- `packages/schemas/history.lock.json`
- `README.md`
- `docs/upgrading.md`
- `tests/type/schemasPackage.ts`
- `tests/integration/gates.test.ts`
- `tests/integration/recordsExplain.test.ts`
- `tests/integration/persistedProducer.test.ts`
- `tests/unit/schemaUrl.test.ts`
- `tests/unit/architecturalGuards.test.ts`
- `tests/unit/schemasPackage/parseDocument.test.ts`
- `tests/unit/schemasPackage/exports.test.ts`
- `tests/unit/schemasPackage/documents.ts`

### Optional files that may be edited

- `src/app/executePlan.ts`
- `src/domain/plan/oraclePairs.ts`
- `tests/unit/readmePersistedFormats.test.ts`
- `tests/unit/schemasPackage/jsonSchemas.test.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/currentShapes.test.ts`
- `tests/unit/schemasPackage/documents.test.ts`
- `tests/unit/schemasPackage/snapshots.test.ts`
- `tests/unit/schemasPackage/parse.test.ts`
- `tests/integration/closeStopNetwork.test.ts`
- `tests/integration/recordsExplainStop.test.ts`
- `tests/integration/oraclePhases.test.ts`
- `tests/integration/oraclePairReview.test.ts`
- `tests/integration/fixLoop.test.ts`
- `site/build/sources.ts`
- `packages/schemas/build/snapshots.ts`

### Boundary contracts

Producer: src/app/gates.ts, through src/domain/gate/acceptanceRequest.ts. Consumer: the configured provider's command. Contract: one acceptance-request document on stdin, stamped 0.33.0, closed per verdict, saved byte for byte beside the attempt's log. Producer: the schemas package's parseAcceptanceRequest and toLatestAcceptanceRequest. Consumers: tools reading run folders. Contract: an acceptance-request or a 0.26.0 oracle-request parses, and lifts to the latest acceptance request.

### Test strategy

- the gate of an acceptance pair writes an acceptance-request stamped 0.33.0, authored without acceptanceCommit and passed with it, and saves the same bytes as checks-attempt-NN.acceptance-request.json — medium · example · the provider's recorded stdin and the saved file · in-phase
- parseAcceptanceRequest reads a 0.33.0 acceptance request and a saved 0.26.0 oracle request, and toLatestAcceptanceRequest lifts discharged to passed with acceptancePhase and acceptanceCommit — small · table · the lifted latest acceptance request · in-phase · ac-read-old
- an acceptance request with any key outside its variant, or a missing one, is refused — small · table · the decoder's refusal naming the key · in-phase
- parseDocument identifies an oracle-request 0.26.0 and an acceptance-request 0.33.0 — small · example · the identified format and shape · in-phase
- records explain lists a record's acceptance request, and an older record's oracle request — medium · example · the listed attempt files · in-phase
- every format registry, the README persisted-formats table and the closure allowlist name acceptance-request and keep oracle-request read only — small · table · the registry and README tests · in-phase

### Implementation order

1. frozen oracle-request 0.26.0 module
2. src/schemas/acceptanceRequest.ts and the format registration
3. liftOracleRequest and the persisted reader
4. the gate's request builder, gates.ts, closeStop.ts and recordsExplain.ts
5. package format module and exports, then schemas-check --write twice and the check
6. README, registries and tests
7. docs/upgrading.md

### Excluded scope

- The `acceptance` config key and the refusal of `oracles` (plan 2).
- Help texts and the usage contract naming the saved file (plan 3).
- examples/vitest-oracles, which still reads an oracle-request, and this repository's phax.json (plan 4).
- The operator steps of the 0.33.0 upgrading entry (plan 4).

### Verification

The `standard` gate profile in phax.json; also `pnpm exec tsx scripts/schemas-check.ts` reports the derived files current.

### Expected handoff content

The acceptance-request shape per verdict, and the module paths of its schema, builder and package format. What parseAcceptanceRequest returns for each format, and the shape names. The exports removed and added. The registries updated. The 0.33.0 upgrading entry's bullets. A note for plan 4 that examples/vitest-oracles must read acceptance-request before this repository's phax.json moves to the `acceptance` key. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(schemas): acceptance-request replaces oracle-request on the provider's stdin`

### Commit body

The gate of an acceptance pair now writes an acceptance-request stamped 0.33.0, with verdict authored or passed and keys phase, acceptancePhase, base, files and, when passed, acceptanceCommit. It is saved as checks-attempt-NN.acceptance-request.json. oracle-request is frozen at 0.26.0 and stays readable: the schemas package's parseAcceptanceRequest reads both formats, and toLatestAcceptanceRequest lifts an old request to the new names. The README's persisted formats and docs/upgrading.md's 0.33.0 entry for records and schema readers follow.
