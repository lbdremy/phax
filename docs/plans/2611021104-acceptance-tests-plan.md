---
status: Approved
source-spec: docs/specs/2610271119-acceptance-tests.md
completes-spec: false
approved:
  date: 2026-11-02
  baseline: 9aecccc
---
# Acceptance words

Third of the four plans of the spec acceptance-tests: prompts, messages and telemetry. Plan 1, the formats, merged as #177, and plan 2, lint, CLI and config, merged as #178. After this run, every prompt, message, recovery step, row and help text phax writes uses the acceptance words of the spec's §10 rename table: the phase prompt's `## Acceptance role` section, the fix prompt's acceptance-provider tail, the authoring prompt's provider lines, the recovery headline `The acceptance step failed after all fix attempts.`, the resume instructions, the reset and close refusals, the overview's `acceptance role` row and its `acceptanceRole` JSON, the records-explain row `acceptance   passes phase-03 — <command>: pass`, the review handoff's `## Acceptance pairs`, and the telemetry event `acceptance.edits.unjudged`. Every internal identifier and file name in `src/` and `packages/schemas/src/` that still says oracle or discharge is renamed too, except the readers, lifts and frozen modules of shapes an earlier release wrote and the old-name refusals. The plan covers ac-words and ac-read-old, and adds the source half of ac-oracle-kept's scan, which plan 4 widens and covers. Plans 1, 2 and 4 cover the other criteria; `phax plans lint` reports those as uncovered warnings.

Order, core to surface, every commit green under the `standard` gate profile: phase-01 renames the identifiers, types, internal values and file names (the pair model, the step and failed-step values, the commit-missing error, the overview's JSON role, the telemetry event), keeping every message's words. phase-02 rewords every message, prompt and row built in the domain, app and cli command layers. phase-03 rewrites the prose of `src/cli/cliDocs.ts`, regenerates the usage contract and the CLI reference, sweeps the remaining comments, and adds the source scan that keeps oracle words out of the sources until plan 4.

The installed phax 0.32.0 drives this run. It reads the main checkout's phax.json, still carrying `oracles` and `node examples/vitest-oracles/main.mjs`, and lints and extracts this plan in today's words. No phase edits phax.json, knip.json, examples/vitest-oracles, a skill, docs pages other than the generated CLI reference, or the live docs/specs and docs/plans sidecars: plan 4 renames the first ones, and the operator migrates the sidecars after the release. No phase edits a skill, so the run needs no --allow-skill-edits. This plan declares no acceptance pair (see Technical arbitrations), so it carries no `**Oracle phase:**` line and every test line is `in-phase`.

No interactive phase is declared: phase-01 is a mechanical rename the compiler and the existing tests check, and the words phase-02 and phase-03 write are the spec's quoted strings. The operator can still hold any phase with `phax run --hold`.

## Required commands

- `pnpm gen:usage-spec`
- `pnpm docs:cli`

`pnpm gen:usage-spec` regenerates phax.usage.kdl from the Commander tree and cliDocs.ts. `pnpm docs:cli` regenerates docs/cli/reference.md and the README's generated CLI block. Both are already in `security.agentCommands` of phax.json, so the plan needs no phax.json change.

## Technical arbitrations

- No acceptance pair in this run. Every entry the quoted strings flow through either changes shape in this very plan (buildPhasePrompt's role option, buildWhatsNext's failedStep, the overview's role field, the pair model itself) or is reached only through the executePlan harness of tests/integration/oraclePhases.test.ts, which a frozen copy would duplicate whole. A frozen test would pin pre-rename types and break `pnpm test:type`, or cast internals through unknown, which is the internal-design oracle the skill forbids. The behaviour does not change, so each existing test keeps its scenario and its expected strings move to the spec's words in the phase that writes them. Loss accepted: the new words are asserted by the phase that writes them, and a reviewer checks the expected strings against the spec's §6 and §10 quotes. Rejected: a pair over the CLI records-explain row alone, which gives up nothing the in-phase ac-read-old test does not already prove, at the cost of a second copy of the records fixture.
- Telemetry has no reader. `decodeSemanticTelemetryEvent` (src/schemas/telemetryEvents.ts) is called only by tests; the JSON-file exporter writes events and nothing in phax reads them back. So `oracle.edits.unjudged` becomes `acceptance.edits.unjudged` everywhere (the domain type, its maker, the schema, the snapshot projection, the console line `phax·acceptance.edits.unjudged  files=[…]`) with no reader or lift of the old name. Loss accepted: an external consumer filtering a telemetry stream on `oracle.edits.unjudged` silently stops matching; plan 4's upgrade entry names it.
- The overview's JSON is not a versioned format: `phax plans overview --json` carries no `$schema`, and no `plan-overview` id is in src/schemas/schemaUrl.ts. So `oracleRole` becomes `acceptanceRole`, kind `oracle` with `dischargedBy` becomes kind `acceptance` with `passedBy`, kind `discharging` with `oraclePhase` becomes kind `passing` with `acceptancePhase`, and `none` stays: a plain output change, no stamp, no reader. Loss accepted: a script parsing the overview breaks without a version signal; plan 4's upgrade entry names it. Rejected: stamping the overview now, which gives up the scope of this plan for a format nothing else asked for.
- Internal values rename without a lift. The failed-step value `oracle` (src/domain/errors.ts, events.ts, effects.ts, src/app/gates.ts, fixLoop.ts, fixPrompt.ts, whatsNext.ts, resumeInstructions.ts, src/cli/commands/run.ts) is never persisted: it flows through events and effects into the reducer's branching, the resume-instructions.md prose and the recovery steps, and no status, record or attribution schema holds it. It becomes `acceptance`, beside `configured` and `protected-paths`. The close's `oracleStep` (events.ts `OracleStep`) is persisted only through the reducer, which already writes it as `acceptanceStep` (plan 1); the closure field becomes `acceptanceStep`. The reset refusal reason `phase_blocked_by_discharge` is in-memory only and becomes `phase_blocked_by_passing`. Loss accepted: none persisted, so nothing written by 0.32.0 changes meaning.
- Names that keep "oracle" or "discharge" for good, and how a reviewer tells them from a miss. Kept: the frozen modules (src/schemas/history/**, src/domain/authoring/renderPlanV0_26_0.ts and renderPlanV0_32_0.ts); the readers and lifts of shapes an earlier release wrote (src/schemas/persisted.ts, src/schemas/acceptanceLift.ts, the lift modules of packages/schemas/src/formats/, recordsExplain's `.oracle-request.json` stem, attemptFiles' file pattern, documentMigration's own-shape comments); the retired `oracle-request` 0.26.0 format id with its exports (`oracleRequestFormat`, `OracleRequestShapes`, `OracleRequestV0_26_0`) in schemaUrl.ts, release.ts, packages/schemas/src/index.ts and generated/index.ts; the old-name refusals (loadConfig's `oracles` key check, hold.ts's `--hold 'oracle'`, resume's `skipOracle` and `RETIRED_OPTIONS`, phaseHeader's old labels and `hasOraclePhaseLine`/`hasOracleFilesLine`, acceptanceCheck's two messages, testLineGrammar's retired loop and the criterion filter); the test line's fourth field `oracle` and `<oracle>`; `wrong-oracle`; and prose about what judges a test (renderPlan.ts's round trip "is the oracle"). phase-03's scan holds them as an allowlist: whole-file entries only for frozen and lift/reader modules, line patterns for everything else, each entry with a reason naming one §5.21 category, and an entry that matches nothing fails the scan. Anything the scan flags is a miss.
- The source half of the ac-oracle-kept scan lands in this plan (phase-03, tests/unit/acceptanceWords.test.ts) over `src/`, `packages/schemas/src/`, phax.usage.kdl and docs/cli/reference.md; plan 4 widens it to the README, docs, site, example and skills and claims the criterion. Loss accepted: an allowlist plan 4 must widen, and a whole-file entry for a lift module lets a new oracle word inside that module pass unflagged. Rejected: waiting for plan 4, which gives up any guard against a later commit bringing an oracle word back into the sources before plan 4 runs.
- Test files follow their subject: tests/unit/oraclePairs.test.ts, tests/integration/oraclePhases.test.ts and tests/integration/oraclePairReview.test.ts move to acceptancePairs.test.ts, acceptancePhases.test.ts and acceptancePairReview.test.ts in phase-01, keeping every case. tests/integration/vitestOraclesExample.test.ts and tests/unit/planningSkillOracles.test.ts keep their names: they test the example and the skill, which plan 4 renames.
- The authoring prompt names the `acceptance` provider and "the skill's acceptance-phase section" from phase-02 on, while the bundled skill still calls it "Oracle phases" until plan 4. Loss accepted: between the two releases' commits a headless author reads a prompt naming a section by its coming title. Rejected: keeping the old prompt lines, which gives up an authoring prompt that agrees with the plan-document schema plan 1 already renamed (`acceptance`, not `oracle`).
- EXTRACTOR_VERSION stays at 5: this plan changes no extraction input or output. The planCache/key.ts history comment that names `oracle` is reworded to name the key an earlier extractor read, as a lift-history note the scan allows.

---

## phase-01 — Acceptance identifiers, step values and telemetry event {#phase-01-acceptance-identifiers}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** A cross-layer rename of one model through the domain, app, cli, infra and schemas layers and dozens of tests, where a missed site fails the gate: more sites than the default effort reliably carries in one commit.

Every type, function, field, internal value and file name of the pair model, the gate step, the close, the overview and the telemetry event says acceptance or passing, not oracle or discharge. `phax plans overview --json` carries `acceptanceRole` and telemetry emits `acceptance.edits.unjudged`; every message keeps its words until phase-02.

### Detailed instructions

- Run `grep -rniE 'oracle|discharg' src packages/schemas/src` first. Leave untouched everything the preamble's Technical arbitrations list as kept for good: src/schemas/history/**, renderPlanV0_26_0.ts, renderPlanV0_32_0.ts, persisted.ts, acceptanceLift.ts, the packages/schemas/src/formats lift modules, the `oracle-request` format id and its exports, loadConfig's `oracles` refusal, hold.ts's `--hold 'oracle'` refusal, resume's `skipOracle` and RETIRED_OPTIONS, phaseHeader's and acceptanceCheck's old-label handling, testLineGrammar's retired loop, the criterion filter, the test line's fourth field `oracle`, and `wrong-oracle`.
- Move src/domain/plan/oraclePairs.ts to src/domain/plan/acceptancePairs.ts (git mv, then edit), with this mapping:
      - OraclePair { oraclePhase, dischargingPhase, files } → AcceptancePair { acceptancePhase, passingPhase, files };
      - OracleRole { role: "oracle" | "discharging", pair } → AcceptanceRole { role: "acceptance" | "passing", pair };
      - oraclePairs → acceptancePairs; oracleRoleOf → acceptanceRoleOf; oracleSkipRefusal → acceptanceSkipRefusal; stopSkipOracleRefusal → stopSkipAcceptanceRefusal; dischargedOracleFiles → passedAcceptanceTestFiles; stopOraclePairs → stopAcceptancePairs; recordOracleRole → recordAcceptanceRole;
      - OraclePairResult → AcceptancePairResult; OraclePairRow { oraclePhase, dischargingPhase, authored, discharged } → AcceptancePairRow { acceptancePhase, passingPhase, authored, passed }; renderOraclePairsSection → renderAcceptancePairsSection.
      Keep every message string and the rendered section text exactly as they are (phase-02 rewords them); only identifiers and the role discriminants change. pairsChangedByCorrections, AuthoredCommitStatus and latestAuthoredCommit keep their names.
- src/domain/errors.ts: OracleCommitMissingError → AcceptanceCommitMissingError (tag included) with fields acceptancePhase and passingPhase; every `failedStep: "configured" | "oracle"` → `"configured" | "acceptance"`. Update src/cli/commands/runLayers.ts's exit-code mapping (exit 11 unchanged).
- src/domain/events.ts: OracleStep → ClosedAcceptanceStep ("authored" | "none"); the closure field `oracleStep` → `acceptanceStep`; failedStep unions say `acceptance`. src/domain/reducer.ts reads `event.closure.acceptanceStep`. src/domain/effects.ts: failedStep `"configured" | "acceptance" | "protected-paths"`. Rename the value `oracle` to `acceptance` in every failedStep union and comparison: src/app/gates.ts (the two `surface === "acceptance" ? "oracle" : "configured"` become `? "acceptance" : "configured"`), src/app/fixLoop.ts, src/domain/gate/fixPrompt.ts, src/domain/whatsNext.ts, src/app/resumeInstructions.ts, src/cli/commands/run.ts, and src/app/effectRunner.ts and eventAdapter.ts if the compiler names them. Keep every message text.
- src/app/gates.ts: the step type OracleStep → AcceptanceGateStep; RunGatesOptions.oracleStep → acceptanceStep; ORACLE_PROVIDER_TIMEOUT_MS → ACCEPTANCE_PROVIDER_TIMEOUT_MS. src/app/fixLoop.ts option `oracleStep` → `acceptanceStep`. src/app/executePlan.ts: oracleStepFor → acceptanceStepFor, oracleCommitOf → acceptanceCommitOf, local names (oracleFolder, oracleCommit, phaseOracleRole) follow; it passes `acceptance: config.acceptance ?? null` to closeStop; reconcilePhaseFiles gets `acceptanceTestFiles: passedAcceptanceTestFiles(...)`. Keep the commit-missing error's two message lines as they are.
- src/app/closeStop.ts: CloseStopInput.oracles → acceptance; CloseReportFacts.oracleStep → acceptanceStep (type ClosedAcceptanceStep); held CloseReport.unjudgedOracleFiles → unjudgedAcceptanceTestFiles; internal helpers and locals named oracle… follow (pairName reads acceptancePhase → passingPhase, same output format). src/cli/commands/stopOutput.ts reads `unjudgedAcceptanceTestFiles` and renames unjudgedOracleWarning → unjudgedAcceptanceTestWarning, keeping its text. src/app/reconcilePhaseFiles.ts option oracleFiles → acceptanceTestFiles.
- Telemetry: in src/domain/telemetry/events.ts, OracleEditsUnjudgedTelemetryEvent → AcceptanceEditsUnjudgedTelemetryEvent with `type: "acceptance.edits.unjudged"`, makeOracleEditsUnjudgedTelemetryEvent → makeAcceptanceEditsUnjudgedTelemetryEvent. src/schemas/telemetryEvents.ts: the schema follows (literal `acceptance.edits.unjudged`). src/domain/telemetry/snapshot.ts: the case and its comment. src/infra/telemetry/layer.ts: the console line becomes exactly `phax·acceptance.edits.unjudged  files=[${files}]`. src/app/telemetry/stopTelemetry.ts: traceUnjudgedOracleEdits → traceUnjudgedAcceptanceEdits. No reader or lift of the old event name.
- Overview: src/domain/plan/overview.ts's OverviewOracleRole → OverviewAcceptanceRole, `{ kind: "acceptance"; passedBy }` | `{ kind: "passing"; acceptancePhase }` | `{ kind: "none" }`, and the phase field `oracleRole` → `acceptanceRole` (so `phax plans overview --json` prints `acceptanceRole`). src/domain/plan/overviewRender.ts reads the new field and kinds, renaming oracleRoleText → acceptanceRoleText, but keeps its row label and texts (`oracle role`, `oracle phase, discharged by …`, `discharges …`) for phase-02.
- Records explain: src/app/recordsExplain.ts's ExplainedRecord.oracleStep → acceptanceStep and lastOracleStep → lastAcceptanceStep (the `.oracle-request.json` stem stays: it reads a 0.32.0 record). src/cli/commands/records.ts reads `record.acceptanceStep`, keeping its row text for phase-02.
- Review handoff: src/app/loadReviewHandoffInputs.ts's loadOraclePairsSection → loadAcceptancePairsSection and loadOracleStepResult → loadAcceptanceStepResult; src/app/reviewHandoff.ts's `oraclePairsMd` → `acceptancePairsMd`. The rendered section text is unchanged in this phase.
- Authoring: src/domain/authoring/prompt.ts's `oraclesProvider` → `acceptanceProvider` and ORACLES_CONFIGURED_LINE / ORACLES_ABSENT_LINE → ACCEPTANCE_CONFIGURED_LINE / ACCEPTANCE_ABSENT_LINE (texts unchanged here); src/app/authorArtifact.ts and src/cli/commands/artifact.ts follow.
- Other consumers the compiler names: src/app/promptGeneration.ts (option `oracleRole` → `acceptanceRole`, oracleRoleLines → acceptanceRoleLines, texts unchanged), src/domain/gate/acceptanceRequest.ts (reads AcceptanceRole, `role.role === "acceptance"`, `pair.acceptancePhase`), src/domain/resetPhaseRefusal.ts (imports, locals, and the reason `phase_blocked_by_discharge` → `phase_blocked_by_passing`; texts unchanged), src/cli/commands/resume.ts (imports the renamed refusals; `skipOracle` stays only to be refused). Fix any other site `pnpm typecheck` and `pnpm test:type` name.
- Update the doc comments of every symbol you rename so they use the new words.
- Tests, keeping each scenario:
      - git mv tests/unit/oraclePairs.test.ts → tests/unit/acceptancePairs.test.ts, tests/integration/oraclePhases.test.ts → tests/integration/acceptancePhases.test.ts, tests/integration/oraclePairReview.test.ts → tests/integration/acceptancePairReview.test.ts; update imports, identifiers and test titles. Message expectations stay as they are in this phase.
      - Every test passing or expecting the failed step `oracle`, the closure's `oracleStep`, `phase_blocked_by_discharge`, `oracleRole`, `unjudgedOracleFiles` or the old identifiers follows the rename.
      - tests/unit/telemetry/events.test.ts: the maker test and the event-type registry expect `acceptance.edits.unjudged`; add a console-line case for `phax·acceptance.edits.unjudged  files=[…]` if no test covers it.
      - tests/unit/planOverview.test.ts and tests/integration/plansOverviewCommand.test.ts: the JSON role is `acceptanceRole` with kind `acceptance` and `passedBy`, `passing` and `acceptancePhase`, or `none`.
      Use temporary repositories (tests/helpers/isolateGit.ts) and fake backends; never read ~/.phax or the global git config.

### Planned files to create

- `src/domain/plan/acceptancePairs.ts`
- `tests/unit/acceptancePairs.test.ts`
- `tests/integration/acceptancePhases.test.ts`
- `tests/integration/acceptancePairReview.test.ts`

### Planned files to edit

- `src/domain/plan/oraclePairs.ts`
- `tests/unit/oraclePairs.test.ts`
- `tests/integration/oraclePhases.test.ts`
- `tests/integration/oraclePairReview.test.ts`
- `src/domain/errors.ts`
- `src/domain/events.ts`
- `src/domain/effects.ts`
- `src/domain/reducer.ts`
- `src/domain/whatsNext.ts`
- `src/domain/resetPhaseRefusal.ts`
- `src/domain/gate/acceptanceRequest.ts`
- `src/domain/gate/fixPrompt.ts`
- `src/domain/plan/overview.ts`
- `src/domain/plan/overviewRender.ts`
- `src/domain/telemetry/events.ts`
- `src/domain/telemetry/snapshot.ts`
- `src/domain/authoring/prompt.ts`
- `src/schemas/telemetryEvents.ts`
- `src/infra/telemetry/layer.ts`
- `src/app/gates.ts`
- `src/app/fixLoop.ts`
- `src/app/executePlan.ts`
- `src/app/closeStop.ts`
- `src/app/telemetry/stopTelemetry.ts`
- `src/app/promptGeneration.ts`
- `src/app/resumeInstructions.ts`
- `src/app/reconcilePhaseFiles.ts`
- `src/app/recordsExplain.ts`
- `src/app/loadReviewHandoffInputs.ts`
- `src/app/reviewHandoff.ts`
- `src/app/authorArtifact.ts`
- `src/cli/commands/resume.ts`
- `src/cli/commands/records.ts`
- `src/cli/commands/stopOutput.ts`
- `src/cli/commands/runLayers.ts`
- `src/cli/commands/artifact.ts`
- `src/cli/commands/run.ts`
- `tests/unit/telemetry/events.test.ts`
- `tests/unit/planOverview.test.ts`
- `tests/integration/plansOverviewCommand.test.ts`
- `tests/unit/resetPhaseRefusal.test.ts`
- `tests/integration/resetPhase.test.ts`
- `tests/unit/events.test.ts`

### Optional files that may be edited

- `src/app/effectRunner.ts`
- `src/app/eventAdapter.ts`
- `src/app/resetPhase.ts`
- `src/domain/gate/verifiedSurfaces.ts`
- `src/cli/commands/plans.ts`
- `tests/integration/gates.test.ts`
- `tests/integration/fixLoop.test.ts`
- `tests/unit/whatsNext.test.ts`
- `tests/unit/fixPrompt.test.ts`
- `tests/unit/resumeInstructions.test.ts`
- `tests/unit/promptGeneration.test.ts`
- `tests/unit/authoringPrompt.test.ts`
- `tests/unit/records/stopRecord.test.ts`
- `tests/unit/reducer.test.ts`
- `tests/unit/reducerHeldStop.test.ts`
- `tests/unit/reducerGateRefusal.test.ts`
- `tests/unit/reducerAwaitingReview.test.ts`
- `tests/unit/acceptanceRequest.test.ts`
- `tests/unit/cli/resume.test.ts`
- `tests/unit/reviewHandoffContent.test.ts`
- `tests/integration/planOverview.test.ts`
- `tests/integration/recordsExplain.test.ts`
- `tests/integration/reviewHandoff.test.ts`
- `tests/integration/heldStopClose.test.ts`
- `tests/integration/declaredStopClose.test.ts`
- `tests/integration/stopRecords.test.ts`
- `tests/integration/stopTranscripts.test.ts`
- `tests/integration/stopTurnCosts.test.ts`
- `tests/integration/authorArtifact.test.ts`
- `tests/integration/resume.test.ts`
- `tests/integration/writeRecord.test.ts`
- `tests/integration/telemetry/jsonFile.test.ts`
- `tests/unit/architecturalGuards.test.ts`

### Boundary contracts

Producer: src/domain/plan/acceptancePairs.ts. Consumers: executePlan, closeStop, gates' request builder, resetPhaseRefusal, the overview, the review handoff and resume. Contract: AcceptancePair { acceptancePhase, passingPhase, files } and AcceptanceRole { role: "acceptance" | "passing", pair }, the same pairs and roles as before. Producer: the gate and fix loop. Consumers: whatsNext, resumeInstructions, fixPrompt, the reducer. Contract: failedStep `configured | acceptance | protected-paths`, never persisted. Producer: closeStop's closure. Consumer: the reducer, which persists it as `acceptanceStep`. Producer: buildOverview. Consumer: `phax plans overview --json` readers. Contract: `acceptanceRole` with kinds `acceptance` (passedBy), `passing` (acceptancePhase) or `none`, unstamped. Producer: the telemetry layer. Contract: event type `acceptance.edits.unjudged` with `files`.

### Test strategy

- the pair model finds the same pairs and roles under the new names, for every pairing the old tests covered — small · example · the expected pairs and roles of each case plan · in-phase
- a held correction to an acceptance test file at the passing phase emits acceptance.edits.unjudged with its files, and the console line reads phax·acceptance.edits.unjudged — small · example · the emitted event and the console line text · in-phase · ac-words
- plans overview --json gives each phase acceptanceRole as acceptance with passedBy, passing with acceptancePhase, or none — medium · table · the expected role per phase of a plan with one pair and an ordinary phase · in-phase
- an exhausted acceptance step still pauses the run, writes the resume instructions and maps to the same exit code, with the failed step named acceptance — medium · example · the run state, the resume instructions and the exit code the old scenario asserted · in-phase
- a close's authored acceptance step is still persisted as acceptanceStep authored in status.json — small · example · the reduced phase status · in-phase

### Implementation order

1. acceptancePairs.ts (moved), errors.ts, events.ts, effects.ts and the reducer
2. telemetry event, schema, snapshot and console line
3. gates, fixLoop, fixPrompt, whatsNext and resumeInstructions failed-step values
4. executePlan, closeStop, reconcilePhaseFiles and stopOutput
5. overview and overviewRender, recordsExplain and records.ts, review handoff loaders
6. authoring prompt parameter, promptGeneration, acceptanceRequest, resetPhaseRefusal, resume and runLayers
7. moved test files, then every test the compiler or the suite names

### Excluded scope

- Any message, prompt, row or help text wording (phase-02 and phase-03).
- Readers, lifts and frozen modules of earlier shapes, and the old-name refusals: they keep the old names for good.
- phax.json, knip.json, examples/vitest-oracles, tests/integration/vitestOraclesExample.test.ts, tests/unit/planningSkillOracles.test.ts, skills and docs pages (plan 4).
- The live spec and plan sidecars.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

The full identifier mapping as applied (module path src/domain/plan/acceptancePairs.ts, every renamed export, type and field), the failed-step union, the closure and CloseReport field names, the overview JSON shape, the telemetry event type and console line. Every message string still holding old words, by file, for phase-02 (including the pair section heading and columns, the overview and records rows, the prompt paragraphs, the commit-missing and reset messages). The renamed test files. Any deviation from the planned file lists, with the reason.

### Commit subject

`refactor(acceptance): rename the pair model, step values and telemetry event`

### Commit body

The pair model moves to src/domain/plan/acceptancePairs.ts as AcceptancePair and AcceptanceRole (acceptance or passing), and every consumer follows. The failed-step value oracle becomes acceptance, the close's oracleStep becomes acceptanceStep, OracleCommitMissingError becomes AcceptanceCommitMissingError, and the reset reason names the passing phase; none of them is persisted. phax plans overview --json now names each phase's acceptanceRole, and telemetry emits acceptance.edits.unjudged, which nothing in phax reads back. Messages keep their words until the next commit, and readers of earlier shapes keep theirs for good.

---

## phase-02 — Acceptance words in prompts, recovery steps and rows {#phase-02-acceptance-messages}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

Every prompt, refusal, recovery step, warning and row phax builds outside the help texts names acceptance phases, acceptance tests, acceptance test files, passing phases and the acceptance provider, step and pair. Records written by 0.32.0 read under the same words.

### Detailed instructions

- Rewrite only strings and their doc comments; identifiers were renamed in phase-01. Use exactly the strings below where the spec quotes them; elsewhere the wording is free, provided it uses only the new terms (§10 "Left open").
- src/app/promptGeneration.ts, the `## Acceptance role` section (heading exactly `## Acceptance role`):
      - acceptance phase: `This phase writes the acceptance tests that ${passingPhase} will pass. In the acceptance test files (${files}), every test you add or modify must carry your test framework's expected-failure marker, so that the test command stays green. You may delete tests. The acceptance provider checks this at the gate.`
      - passing phase: `This phase passes the acceptance tests ${acceptancePhase} wrote. In the acceptance test files (${files}), the only change allowed is removing every expected-failure marker. Make the implementation pass the acceptance tests as written. If an acceptance test cannot pass unchanged, stop and say so in the handoff: that is a spec question, not a bug to work around.`
- src/domain/gate/fixPrompt.ts, the acceptance tail: `The acceptance provider runs only at the gate; it will judge again after your changes. Do not run it yourself.`
- src/domain/authoring/prompt.ts: configured line `- An acceptance provider is configured ("acceptance" in phax config): you may declare an acceptance phase and its passing phase, as the skill's acceptance-phase section says.`; absent line ``- No acceptance provider is configured: declare no acceptance phase; every phase's `acceptance` is null.``
- src/domain/whatsNext.ts: headlines exactly `The acceptance step failed after all fix attempts.` and `The acceptance step failed after all fix attempts, and protected paths changed.`; the sentence exactly `The protected-path check still runs without the acceptance step.`; the step titles say "Or, if the acceptance test itself is wrong, correct it in the phase worktree", "Then resume without the acceptance step — the configured gate still runs, with the usual fix loop", "Let the fix loop try again — the gate, acceptance step included, is re-run first" and "the gate, acceptance step and protected-path check included". Rename oracleCorrectionSteps → acceptanceCorrectionSteps. Every recovery keeps naming `--skip-acceptance`.
- src/app/resumeInstructions.ts: "This run paused because the acceptance step failed after exhausting all fix attempts.", and the skip sentences say "the gate, acceptance step included", "if the acceptance test itself is wrong" and "the acceptance step is recorded as skipped". Rename OracleSkipSentence → AcceptanceSkipSentence.
- src/domain/resetPhaseRefusal.ts: `its passing phase "<id>" is <state>, and a committed acceptance phase is not reset.`, `To correct the acceptance test, edit it in <id> (…), then run … --skip-acceptance: the configured gate still runs.`, and `its passing phase '<id>' is <state>, and the passing phase judges this phase's commit.` Comments say passing phase and acceptance phase.
- src/domain/plan/acceptancePairs.ts: the two `--skip-acceptance:` refusals say acceptance step, acceptance phase and passing phase; the review-handoff section renders `## Acceptance pairs` with the header `| Acceptance phase | Passed by | Authored | Passed |`.
- src/app/executePlan.ts, the commit-missing refusal: `Cannot run passing phase "<id>" of run "<run>": its acceptance phase "<id>" is <state> and noted no commit, so there are no acceptance tests to pass.` and `No resume gives a skipped acceptance phase a commit: archive the run (phax archive <run> --force) and run a corrected plan whose acceptance phase writes its acceptance tests.`
- src/app/closeStop.ts: every message says acceptance test files, acceptance pairs, acceptance step and "undo the acceptance-test-file corrections"; keep each message's structure and the `"acceptance" provider` wording. src/app/gates.ts's log line: `acceptance step skipped by the operator: <command>`. src/cli/commands/stopOutput.ts's warning: `  warning: <file>: an acceptance test file changed at the passing phase; the passing phase was judged before the stop, so the acceptance provider does not see this change`.
- src/domain/plan/overviewRender.ts: the row label `acceptance role` with `acceptance phase, passed by <id>`, `passes <id>` or `none`. src/cli/commands/records.ts: the row `acceptance   <role> — <step>` where role is `acceptance phase, passed by <id>` or `passes <id>` (three spaces after `acceptance`, as §6 shows).
- Sweep the remaining comments in the files this phase touches so they use the new words.
- Tests, keeping each scenario and asserting the new words: tests/unit/promptGeneration.test.ts (both paragraphs, whole), tests/unit/fixPrompt.test.ts, tests/unit/authoringPrompt.test.ts, tests/unit/whatsNext.test.ts (both headlines and `--skip-acceptance`), tests/unit/resumeInstructions.test.ts, tests/unit/resetPhaseRefusal.test.ts and tests/integration/resetPhase.test.ts, tests/unit/acceptancePairs.test.ts, tests/unit/planOverview.test.ts and tests/integration/plansOverviewCommand.test.ts (the text row), tests/integration/reviewHandoff.test.ts and tests/unit/reviewHandoffContent.test.ts (the section and columns), tests/integration/acceptancePhases.test.ts and tests/integration/acceptancePairReview.test.ts (resume instructions, refusals, close messages and the stop warning), and tests/integration/recordsExplain.test.ts (the new row: `acceptance   acceptance phase, passed by phase-03 — node tools/oracles.mjs: pass` and `acceptance   passes phase-02 — node tools/oracles.mjs: skipped`; the ordinary phase holds no `acceptance   ` row). The fixture command string `node tools/oracles.mjs` may become `node tools/acceptance.mjs`.
- ac-read-old: add to tests/integration/recordsExplain.test.ts a case for records written by phax 0.32.0. Commit, on the records branch as the existing cases do, the passing phase's phase-record-manifest stamped `https://docs.phax.run/schemas/phase-record-manifest/0.30.0.json` with `"oracle": { "role": "discharging", "oraclePhase": "phase-03" }` and `verifiedSurfaces` holding `oracle`, and its gate-attribution.json stamped gate-attribution 0.31.0 whose appended step has `"surface": "oracle"` and `"result": "pass"`, written as raw JSON in the frozen shapes of src/schemas/history/phase-record-manifest/0.30.0.ts and gate-attribution/0.31.0.ts (bypass the current encoder). `phax records explain <commit>` shows `acceptance   passes phase-03 — <command>: pass`. Confirm tests/unit/schemasPackage/acceptanceRequestFormat.test.ts already parses a 0.26.0 oracle request with parseAcceptanceRequest and lifts it with toLatestAcceptanceRequest to verdict `passed`, `acceptancePhase` and `acceptanceCommit`; add that case only if it is missing.
- Never read ~/.phax, a real HOME or the global git config: the records tests already use tests/helpers/isolatePhaxHome.ts and temporary repositories.

### Planned files to create

- (none)

### Planned files to edit

- `src/app/promptGeneration.ts`
- `src/domain/gate/fixPrompt.ts`
- `src/domain/authoring/prompt.ts`
- `src/domain/whatsNext.ts`
- `src/app/resumeInstructions.ts`
- `src/domain/resetPhaseRefusal.ts`
- `src/domain/plan/acceptancePairs.ts`
- `src/app/executePlan.ts`
- `src/app/closeStop.ts`
- `src/app/gates.ts`
- `src/cli/commands/stopOutput.ts`
- `src/domain/plan/overviewRender.ts`
- `src/cli/commands/records.ts`
- `tests/unit/promptGeneration.test.ts`
- `tests/unit/fixPrompt.test.ts`
- `tests/unit/authoringPrompt.test.ts`
- `tests/unit/whatsNext.test.ts`
- `tests/unit/resumeInstructions.test.ts`
- `tests/unit/resetPhaseRefusal.test.ts`
- `tests/integration/resetPhase.test.ts`
- `tests/unit/acceptancePairs.test.ts`
- `tests/unit/planOverview.test.ts`
- `tests/integration/plansOverviewCommand.test.ts`
- `tests/integration/reviewHandoff.test.ts`
- `tests/unit/reviewHandoffContent.test.ts`
- `tests/integration/acceptancePhases.test.ts`
- `tests/integration/acceptancePairReview.test.ts`
- `tests/integration/recordsExplain.test.ts`

### Optional files that may be edited

- `src/app/fixLoop.ts`
- `src/app/loadReviewHandoffInputs.ts`
- `src/app/reviewHandoff.ts`
- `src/app/telemetry/stopTelemetry.ts`
- `src/app/recordsExplain.ts`
- `src/domain/telemetry/events.ts`
- `src/domain/gate/acceptanceRequest.ts`
- `src/cli/commands/resume.ts`
- `src/cli/commands/run.ts`
- `tests/unit/schemasPackage/acceptanceRequestFormat.test.ts`
- `tests/integration/gates.test.ts`
- `tests/integration/fixLoop.test.ts`
- `tests/integration/heldStopClose.test.ts`
- `tests/integration/declaredStopClose.test.ts`
- `tests/integration/resume.test.ts`
- `tests/integration/planOverview.test.ts`
- `tests/integration/authorArtifact.test.ts`
- `tests/unit/cli/resume.test.ts`
- `tests/unit/records/stopRecord.test.ts`

### Boundary contracts

Producers: buildPhasePrompt, buildFixPrompt, the authoring prompt, buildWhatsNext, the resume instructions, resetPhaseRefusal, the pair refusals and section, closeStop, executePlan and the stop output. Consumers: the agent of a phase in a pair, the operator reading recovery steps, the review handoff's reader. Contract: the same texts at the same moments, in the new terms, with the spec's quoted strings verbatim. Producer: explainRecord over the lifted manifest and attribution of a 0.32.0 record. Consumer: `phax records explain`. Contract: the row `acceptance   passes <phase> — <command>: <result>` whatever release wrote the record.

### Test strategy

- the passing phase's prompt holds the Acceptance role section with the spec's paragraph, and the acceptance phase's prompt its own paragraph — small · example · the two paragraphs, whole · in-phase · ac-words
- the fix prompt after a failed acceptance step names the acceptance provider and tells the agent not to run it — small · example · the fix prompt's tail · in-phase · ac-words
- an exhausted acceptance step gives the headline The acceptance step failed after all fix attempts. and a recovery naming --skip-acceptance, with or without protected-path changes — small · table · the headline and steps per failed step and protected-path case · in-phase · ac-words
- resume instructions, reset refusals, close refusals and the unjudged-file warning name acceptance phases, passing phases, acceptance test files and the acceptance step — medium · example · the texts each existing scenario asserted, in the new words · in-phase · ac-words
- the overview text row, the records-explain row and the review handoff's Acceptance pairs section use the new labels and values — medium · example · the rows and section header quoted by the spec · in-phase · ac-words
- records explain on a passing phase's record written by 0.32.0 shows acceptance   passes phase-03 with its command and result — medium · example · the explained row over raw 0.30.0 manifest and 0.31.0 attribution · in-phase · ac-read-old
- a 0.26.0 oracle request parses with parseAcceptanceRequest and lifts to verdict passed with acceptancePhase and acceptanceCommit — small · example · the lifted request's keys and values · in-phase · ac-read-old

### Implementation order

1. prompt, fix-prompt and authoring-prompt texts
2. whatsNext, resumeInstructions and resetPhaseRefusal
3. pair refusals and section, executePlan, closeStop, gates log and stop output
4. overview and records rows
5. tests in the same order, then the ac-read-old records case

### Excluded scope

- Identifier and value renames (phase-01).
- The prose of src/cli/cliDocs.ts, the usage contract, the CLI reference and the source scan (phase-03).
- Readers, lifts and frozen modules of earlier shapes, and the old-name refusals.
- phax.json, knip.json, examples/vitest-oracles, skills, README prose and docs pages (plan 4).

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

Every message rewritten, by file, with the exact new text of the ones the spec does not quote. The ac-read-old fixture: which raw shapes and stamps it commits, and whether the schemas-package case already existed. Any remaining oracle or discharge word outside cliDocs.ts in the files touched, with why it is kept. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(acceptance): acceptance words in prompts, recovery steps and rows`

### Commit body

The phase prompt's Acceptance role section, the fix prompt and the authoring prompt name acceptance tests, acceptance test files, the passing phase and the acceptance provider. Recovery steps open with The acceptance step failed after all fix attempts. and still name --skip-acceptance; resume instructions, reset and close refusals and the stop warning follow. The overview's acceptance role row, the records-explain acceptance row and the review handoff's Acceptance pairs section use the new labels, and a record written by 0.32.0 explains the same way.

---

## phase-03 — Acceptance words in help texts, the usage contract and a source scan {#phase-03-help-and-scan}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

The help texts, the usage contract and the CLI reference speak of acceptance phases, passing phases and the acceptance provider, and a test fails whenever oracle or discharge appears in the sources outside the places §5.21 allows.

### Detailed instructions

- src/cli/cliDocs.ts: rewrite every prose mention of oracle phases, oracle steps, oracle pairs, oracle files, oracles, the oracles provider, discharging phases and discharge with the new terms (acceptance phase, acceptance step, acceptance pair, acceptance test files, acceptance tests, the acceptance provider, passing phase, passes). Keep the test line's `<oracle>` field in the format string. The plans overview text describes `acceptanceRole` (acceptance with passedBy, passing with acceptancePhase, or none) and the `acceptance role` row. Keep every quoted refusal and command spelling as it is, and name no old spelling except where a text describes a refusal of it.
- Run `pnpm gen:usage-spec`, then `pnpm docs:cli`: they rewrite phax.usage.kdl, docs/cli/reference.md and the README's generated block. Do not hand-edit those files, and edit no README prose outside its generated block.
- Sweep the remaining comments in `src/` and `packages/schemas/src/` that use oracle or discharge for phax's phase, pair, step or files and are not in a kept place (for example src/domain/gate/verifiedSurfaces.ts, src/app/extractPlan.ts, src/schemas/planExtraction.ts, src/domain/decide/verdicts.ts, src/domain/planCache/key.ts). A comment that describes a shape an earlier release wrote may name its old key, as a lift note.
- Create tests/unit/acceptanceWords.test.ts, the source half of ac-oracle-kept:
      - It reads every file under src/ and packages/schemas/src/ (TypeScript sources), plus phax.usage.kdl and docs/cli/reference.md, from the repository root found through import.meta.url, and matches /oracle/i and /discharg/i on each line.
      - An exported-for-the-test allowlist in the same file: each entry has an id, a reason naming one category of §5.21 (frozen or read-only shape of an earlier release, reader or lift of one, old-name refusal, the retired `oracle-request` format id and exports, the test line's fourth field, the `wrong-oracle` escape, prose about what judges a test), and either a file glob or a (file glob, line pattern) pair.
      - Whole-file entries only for frozen modules (src/schemas/history/**, src/domain/authoring/renderPlanV0_*.ts) and reader or lift modules (src/schemas/persisted.ts, src/schemas/acceptanceLift.ts, and the packages/schemas/src/formats lift modules that need it). Every other kept occurrence is matched by a line pattern scoped to its file.
      - The test fails listing `file:line: text` for every occurrence no entry allows, and fails naming every entry that allows nothing, so the allowlist cannot go stale.
      - Plan 4 widens the scanned set to the README, docs, site, example and skills: say so in a comment at the top.
      - No phax process, no network, no HOME: it reads files only.
- Fix every occurrence the scan reports by renaming or rewording; add an allowlist entry only for a site §5.21 allows, and list each entry in the handoff.

### Planned files to create

- `tests/unit/acceptanceWords.test.ts`

### Planned files to edit

- `src/cli/cliDocs.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`

### Optional files that may be edited

- `README.md`
- `src/domain/gate/verifiedSurfaces.ts`
- `src/domain/planCache/key.ts`
- `src/domain/decide/verdicts.ts`
- `src/domain/artifact/documentMigration.ts`
- `src/app/extractPlan.ts`
- `src/app/resetPhase.ts`
- `src/app/lintPlan.ts`
- `src/schemas/planExtraction.ts`
- `src/schemas/status.ts`
- `src/schemas/schemaUrl.ts`
- `src/schemas/acceptanceRequest.ts`
- `src/domain/plan/testLineCheck.ts`
- `src/domain/plan/acceptanceCheck.ts`
- `src/domain/plan/phaseHeader.ts`
- `src/domain/plan/testLineGrammar.ts`
- `src/domain/gate/attemptFiles.ts`
- `src/domain/hold.ts`
- `src/app/recordsExplain.ts`
- `packages/schemas/src/index.ts`
- `packages/schemas/src/formats/acceptanceRequest.ts`
- `packages/schemas/src/formats/recordTimeline.ts`
- `packages/schemas/src/formats/recordManifests.ts`
- `packages/schemas/src/formats/answers.ts`
- `packages/schemas/src/formats/runDirectory.ts`
- `packages/schemas/src/formats/repository.ts`
- `tests/integration/usageSpecDrift.test.ts`
- `tests/integration/docsCliDrift.test.ts`
- `tests/integration/usageOutput.test.ts`
- `tests/integration/usageParity.test.ts`

### Boundary contracts

Producer: src/cli/cliDocs.ts and the Commander tree. Consumers: `phax --help`, `phax --usage`, phax.usage.kdl, docs/cli/reference.md and the README's generated block, kept equal by the drift tests. Producer: the sources. Consumer: tests/unit/acceptanceWords.test.ts. Contract: oracle and discharge appear only where an allowlist entry, with its §5.21 reason, allows them.

### Test strategy

- the usage contract, the CLI reference and the README's generated block equal what the generators produce from the rewritten help texts — medium · example · the regenerated files compared by the existing drift tests · in-phase
- oracle and discharg appear in src, packages/schemas/src, the usage contract and the CLI reference only where an allowlist entry with a §5.21 reason allows them, and no entry is stale (the source half of ac-oracle-kept) — small · example · the allowlist and the list of unmatched occurrences, empty · in-phase
- the help texts name acceptance phases, the acceptance step and passing phases, and still name every refusal and command spelling — medium · example · phax.usage.kdl and the scan's empty report · in-phase · ac-words

### Implementation order

1. cliDocs.ts prose
2. pnpm gen:usage-spec, then pnpm docs:cli
3. the scan test with its allowlist
4. the comment sweep until the scan is clean

### Excluded scope

- README prose outside its generated block, docs pages other than docs/cli/reference.md, the site, examples/vitest-oracles, phax.json, knip.json and the skills, and widening the scan to them (plan 4).
- The 0.33.0 upgrading entry's telemetry and overview lines (plan 4).
- Any change to a message or identifier beyond what the scan flags.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

The scanned set, every allowlist entry with its reason, and how plan 4 widens the scan (where the scanned roots are declared). The cliDocs.ts passages rewritten. Every comment reworded in the sweep. Whether the README's generated block changed. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(cli): acceptance words in help texts, the usage contract and a source scan`

### Commit body

The help texts speak of acceptance phases, the acceptance step, acceptance pairs, passing phases and the acceptance provider; the usage contract, the CLI reference and the README's generated block are regenerated. A new test scans src, packages/schemas/src, the usage contract and the CLI reference for oracle and discharge, and fails on any occurrence outside an allowlist whose every entry names why the spec keeps it: a frozen shape, a reader or lift, an old-name refusal, the test line's fourth field, the wrong-oracle escape or prose about what judges a test. A later plan widens the scan to the docs, site, example and skills.
