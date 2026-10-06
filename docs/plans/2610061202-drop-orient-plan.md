---
status: Draft
source-spec: docs/specs/2610060950-drop-orient.md
---
# Drop orient

Implements the Approved spec `drop-orient` (docs/specs/2610060950-drop-orient.md) in full, so this plan completes the spec. phax stops querying an orientation provider at phase start. The first prompt loses its orientation section, and phax no longer writes the orientation brief file. The plan then removes `phax orient` with its grant source and its three telemetry events, then the `orient` config key and the hello-world hook. Last, it sweeps the remaining live docs. All four §9 questions were decided by the author on 2026-10-06 and are not reopened: removals land first, the drop is hard, nothing replaces orient, and kept history is all of docs/specs/, docs/plans/, docs/briefs/, docs/spikes/ and NEXT_STEPS.md except its cross-run item.

The removal is hard (spec §9 Q2). No phase adds a shim, alias, deprecation, migration, dedicated refusal, upgrade note or "removed" section. No test names a leftover `orient` key, command or file. The ordinary unknown-key (exit 2) and unknown-command errors stay as they are and are not re-tested for orient. Every new test is a positive expectation of the no-provider baseline, so a test file never holds the word the final sweep forbids.

Scope boundary: this is the first of four specs that land in order (`drop-orient`, `drop-gate-scopes`, `gate-request`, `brief-provider`). No phase touches the scope provider, pending diagnostics, the gate, the shared provider runner (src/app/providerQuery.ts and its `excerpt`) or the plan auditor. No phase edits another spec, brief, spike or archived artifact. No `@lbdremy/phax-schemas` format, `$schema` URL or `version` field changes: every changed shape is phax-internal (spec §10). Nothing from `~/.phax` or another repository enters this repository. Every fixture is made up and lives under the OS temp dir. No `.claude/skills/` file mentions orient, so the run needs no `--allow-skill-edits`. If a phase finds one, it reports it in its handoff instead of editing it.

File deletions are listed under "Planned files to edit", following the repo's earlier removal plans.

## Required commands

- `git grep`

phase-04 runs the spec's sweep check `git grep -i -l orient -- . ':!docs/specs/' ':!docs/plans/' ':!docs/briefs/' ':!docs/spikes/' ':!NEXT_STEPS.md'`. `security.agentCommands` in phax.json allows `git log`, `git show-ref`, `git cat-file` and `git ls-tree`, but not `git grep`. Before running, add `git grep` to `security.agentCommands` in phax.json, or the preflight fails before any agent spawns. The other commands the phases run are already allowed: `pnpm gen:usage-spec` and `pnpm docs:cli` (phase-02), and `pnpm dev schema upgrade` (phase-03). Every gate step comes from the existing `standard` profile.

## Technical arbitrations

- Sweep enforcement (spec §10, left open): the final phase runs the spec's exact `git grep` check as an agent command and records its empty output and exit 1 in the handoff. Review re-checks it. There is no committed guard test and no new gate step: a test holding the word would break the sweep it checks, and a plan cannot add gate commands. Loss accepted: nothing stops the word from coming back into the live tree after this run.
- Phase cut: four phases instead of the brief's three, each green under `standard`. The README §Orient provider section links to the `phax orient` reference anchor, so phase-02 removes it together with the regenerated reference. The config key, the row schema and the hello-world hook leave together in phase-03, because the example's phax.json stops decoding the moment the key leaves the strict schema. Loss accepted: phase-02 is the largest phase, and for one commit README §Extend phax lists three hooks while the example still ships its orient script.
- Golden prompts and the phase-folder list (spec §10, left open): before touching code, phase-01 records them from the current no-provider path as vitest snapshots and explicit positive lists. The existing promptGeneration snapshot must stay byte-identical. Loss accepted: the golden comes from the worktree's pre-change source, not from a built release binary.

---

## phase-01 — Start every phase on the no-provider baseline {#phase-01-no-provider-phase-start}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

A fresh phase start (phax run, or phax resume after phax reset-phase) does exactly what the current release does when no orientation provider is configured. It starts no process between setup and the agent, builds the same first prompt byte for byte, and writes the same phase-folder files minus the orientation brief file (spec §5.1–§5.4, §5.11).

### Detailed instructions

- Test-first, before any code change: in tests/integration/executePlan.test.ts, replace the whole `describe("executePlan — orient dispatch weaving", …)` block (its plan fixture, config helper and three cases) with a new `describe("executePlan — phase start on the no-provider baseline", …)`. Name nothing after the removed provider: no fixture, helper, string or comment in the new block may contain the word the final sweep forbids (case-insensitive). Drop the now-unused `type OrientConfig` import.
- New block, case 1 (ac-phase-start): a three-phase made-up plan, setup command `pnpm install` (a fake-shell response), no provider configured. Run phase-01 and phase-02. For each phase, assert that the fake shell starts no process from the end of `pnpm install` to the agent launch. One way: record the shell call count when the fake backend's run is invoked, or compare the ordered call list between the setup call and the backend call. If the fakes cannot observe that ordering, add a minimal hook in src/infra/fakes/backend.ts or src/infra/fakes/shell.ts, such as an onRun callback or a shared ordered call log, without changing existing behaviour.
- Case 1 continued: snapshot each phase's `prompt.md` with `toMatchSnapshot()` into tests/integration/__snapshots__/executePlan.test.ts.snap. Normalize run-specific values (temp-dir paths, ids, timestamps) to fixed placeholders before snapshotting, so the snapshot is deterministic and holds no machine path. Run the test once on the unchanged code so the golden comes from the current no-provider path. It must still match, unchanged, after the code change.
- Case 2 (ac-phase-folder): at phase-01's agent launch, read the names of the files in phase-01's folder and assert they equal an explicit, sorted, positive list. Build that list from what the current no-provider path writes (status.json, agent-binding.json, prompt.md, model-resolution.json, security.json and whatever else it writes at that moment), minus the brief file. Never write the brief file's name in the test. This case fails before the code change and passes after.
- Case 3 (ac-resume): with phase-02 stopped with its gate exhausted, cover a resume of the session, then `reset-phase` for phase-02, then a resume again. Assert the first resume writes no new `prompt.md` and starts no process between setup and agent. After the reset, phase-02 gets a fresh `prompt.md` equal to its golden snapshot and a folder matching case 2's list (adapted to phase-02), and neither resume's outcome differs from the baseline. Put the case where the existing resume/reset harness lives: this block, or tests/integration/resume.test.ts or tests/integration/resetPhase.test.ts. Explain the choice in the handoff.
- In tests/integration/recordsExplain.test.ts, add a positive case (ac-record-read). Build a made-up phase record on a temp `phax/records/v1` ref whose tree also holds a file `legacy-note.json` that the current release never writes. `records list` and `records explain <commit>` (no flag, then `--prompt`, `--diff` and `--gates`) each succeed, print the recorded prompt, diff and gates, and leave `legacy-note.json` byte-for-byte in the record tree. Records code itself does not change (spec §10).
- src/app/executePlan.ts, fresh path only: delete the advisory brief block (the `orientationIndex` / `orientBrief` variables, the `config.orient` query over planned files, the success telemetry, the failure warning, the `not-configured` branch and the atomic write of the brief file with its write-failure warning). Call `buildPhasePrompt` without the orientation option. Remove the now-unused imports: `excerpt` and `queryOrientIndex` from ./orient.js, the row type, `encodeOrientBrief`/`OrientBrief`, `MAX_ORIENTATION_ROWS`, the brief-computed telemetry maker, and `Either` if it is no longer used. Leave both `computeFrozenAgentCommands` calls and their `orientEnabled` argument untouched: phase-02 removes them.
- src/app/promptGeneration.ts: delete `MAX_ORIENTATION_ROWS`, the row-type import, the `orientationIndex` option in both option interfaces, and the section builder and its spread between `## Current phase` and `## Execution rules`. Every other section, its order and its text stay byte-identical.
- tests/unit/promptGeneration.test.ts: delete the six orientation cases (absent-section, undefined-field identity, rows rendering, cap, empty fallback, placement) and the row-type and `MAX_ORIENTATION_ROWS` imports. Keep 'matches the expected snapshot'. tests/unit/__snapshots__/promptGeneration.test.ts.snap must not change: it is the golden of the unit-level prompt.
- Delete src/schemas/orientBrief.ts, tests/unit/orientBrief.test.ts and tests/integration/orientBriefArtifact.test.ts.
- Do not touch src/app/orient.ts, src/schemas/orient.ts, the CLI command, the config schema, agentCommands, or the telemetry event definitions and makers (later phases). src/app/orient.ts remains used by the CLI command until phase-02.

### Planned files to create

- `tests/integration/__snapshots__/executePlan.test.ts.snap`

### Planned files to edit

- `src/app/executePlan.ts`
- `src/app/promptGeneration.ts`
- `tests/unit/promptGeneration.test.ts`
- `tests/integration/executePlan.test.ts`
- `tests/integration/recordsExplain.test.ts`
- `src/schemas/orientBrief.ts`
- `tests/unit/orientBrief.test.ts`
- `tests/integration/orientBriefArtifact.test.ts`

### Optional files that may be edited

- `src/infra/fakes/backend.ts`
- `src/infra/fakes/shell.ts`
- `tests/integration/resume.test.ts`
- `tests/integration/resetPhase.test.ts`

### Boundary contracts

app → app: executePlan (consumer) needs from promptGeneration (producer) a prompt for the current phase built from plan markdown, plan JSON, the current phase, the previous handoff/reconciliation and the gate commands, with no optional orientation input. The `buildPhasePrompt` option shape loses `orientationIndex` and keeps every other field. The phase-folder contract with records (writeRecord lists the folder) is unchanged: records carry whatever the folder holds.

### Test strategy

Integration tests with fake ports for the application command (executePlan), written before implementation: golden prompts captured as vitest snapshots from the unchanged no-provider path, the no-process window between setup and agent, the explicit phase-folder list (fails before, passes after), and the resume/reset sequence. A unit snapshot already guards promptGeneration and must stay byte-identical. An integration test covers records explain on a record holding an unknown file. All repos and records are made up under the OS temp dir.

### Implementation order

1. Write the new executePlan baseline block (cases 1 and 3) and run it on unchanged code to record the golden prompt snapshots
2. Write case 2 (phase-folder list) and the records-explain case
3. Remove the orientation section and option from promptGeneration and prune its unit tests
4. Remove the phase-start query and the brief write from executePlan
5. Delete the brief schema module and its two test files
6. Run the standard gate

### Excluded scope

- The `orientEnabled` argument and the `orient` grant source (phase-02)
- `phax orient`, src/app/orient.ts, OrientProviderError and the telemetry events (phase-02)
- The config key, src/schemas/orient.ts and the hello-world hook (phase-03)
- Any change to records code, the fix loop, the resume path beyond the shared phase start, or the shared provider runner
- Docs and generated contract files

### Verification

The project's `standard` gate profile in phax.json.

### Expected handoff content

State that the fresh phase start no longer queries a provider, builds no orientation section and writes no brief file. Give the snapshot file path (tests/integration/__snapshots__/executePlan.test.ts.snap), confirm it was recorded from unchanged code, and list the placeholders used for normalization. Give the explicit phase-folder file list asserted at agent launch. Say where the resume/reset case lives and whether a fake-port hook was added, with its exact name and file. Confirm tests/unit/__snapshots__/promptGeneration.test.ts.snap is unchanged. Note what remains for phase-02: `orientEnabled` at both `computeFrozenAgentCommands` call sites in src/app/executePlan.ts, src/app/orient.ts (used only by the CLI command now), and the brief-computed telemetry maker (now emitted nowhere). Explain every file-plan deviation phax flags, and say whether any `.claude/skills/` file names orient (expected: none).

### Commit subject

`refactor(run): start every phase on the no-provider baseline`

### Commit body

A fresh phase start no longer queries an orientation provider after its setup commands. It no longer weaves an orientation section into the first prompt, and it no longer writes the orientation brief file to the phase folder. Every phase now runs as a phase with no provider configured ran before. The prompt is byte-identical to that baseline, and the phase folder holds the same files minus the brief.

Remove the phase-start query, its two warnings, the brief write and its schema module. Remove the prompt section, its row cap and the orientationIndex option from promptGeneration. New positive tests pin the baseline: golden first prompts captured from the no-provider path before the change, no process between setup and agent launch, an explicit phase-folder file list, resume and reset behaviour, and records explain reading a record that carries a file the current release does not write.

The agent-command grant, the CLI command, the config key and the telemetry events are removed in the following phases.

---

## phase-02 — Remove phax orient, its grant source and its telemetry {#phase-02-drop-orient-command}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

The agent's grants come from config and gate only, and security.json's agent-command source has exactly two values. phax offers no orientation command anywhere in its CLI surface (usage spec, help, reference, README summary), and semantic telemetry has exactly ten event types (spec §5.5, §5.6, §5.9, §5.10, §5.13 for README).

### Detailed instructions

- src/domain/security/agentCommands.ts: delete `ORIENT_COMMAND`, the `orientEnabled` input field and the implicit allowance block. `source` becomes `"config" | "gate"` in the record type and the `seen` map, and the precedence comment drops its third clause. Plan-required commands still only set `requiredByPlan`.
- src/schemas/securityPosture.ts: the agent-command `source` becomes `Schema.Literal("config", "gate")`. `version` stays 1, and no `$schema` is added.
- src/app/executePlan.ts: drop `orientEnabled` from both `computeFrozenAgentCommands` calls (resume path and fresh path). After this phase nothing in executePlan reads `config.orient`.
- tests/unit/security/agentCommands.test.ts: remove the `orientEnabled` argument from every call and delete the whole extra-allowance describe block. Keep every other case unchanged.
- tests/unit/security/posture.test.ts (ac-grant-enum), in the agentCommands section: a posture valid in every other respect decodes with source `config` and with `gate`, and is rejected with source `plugin`.
- Create tests/integration/agentCommandGrants.test.ts (ac-grants). Run in `secure` mode on a fake provider with a command allowlist, with `security.agentCommands: ["node"]`, a gate profile whose only step is `pnpm test`, and no plan-required commands. Start phase-01, then resume it. Each time, assert that phase-01's security.json `agentCommands` holds exactly two records: `{command:"node", source:"config", explicit:true}` and `{command:"pnpm test", source:"gate", explicit:false}`, plus their other fields. Assert also that the allowlist handed to the agent backend (`agentCommands` in the run/resume options) is exactly `node` and `pnpm test`. Reuse helpers from tests/integration/skillEditGrants.test.ts or executePlan.test.ts where they fit, and extend src/infra/fakes/backend.ts only if it does not already capture run/resume options. Made-up temp dirs only.
- Telemetry: in src/domain/telemetry/events.ts, delete the three orient event interfaces, their union members and their three makers. In src/domain/telemetry/snapshot.ts, delete the three switch cases and the fields only they used: `phase`, `fileCount`, `rowCount`, `kind`, `subject`. First check with a search that no other event uses them, and keep any that one does. In src/infra/telemetry/layer.ts, delete their three log lines. In src/schemas/telemetryEvents.ts, delete their three schemas and union members.
- tests/unit/telemetry/events.test.ts: delete the three orient maker describe blocks and imports. Add a case (ac-events) that enumerates the `type` literals accepted by `SemanticTelemetryEventSchema` (walk the union members' AST) and asserts they equal exactly: state.transition, adapter.call.started, adapter.call.succeeded, adapter.call.failed, step.started, step.completed, gate.evaluated, artifact.generated, agent.model.resolved, security.policy.applied. Where a full fake run's semantic trace snapshot is already taken (tests/integration/telemetry/end-to-end.test.ts), add an assertion that every entry's type is in that list. Do not change any committed telemetry snapshot unless it genuinely changed, and explain if it did.
- Delete src/cli/commands/orient.ts, src/app/orient.ts, tests/unit/cli/orient.test.ts, tests/unit/cli/orientContractDocs.test.ts and tests/integration/orient.test.ts. In src/cli/program.ts, remove the `runOrient` import and the `.command("orient")` registration. In src/cli/cliDocs.ts, remove its entry. In src/domain/errors.ts, delete `OrientProviderError` after checking that nothing else uses it. src/app/providerQuery.ts and its `excerpt` stay unchanged. src/schemas/orient.ts stays for now (phase-03).
- tests/integration/cliProgram.test.ts: remove the command from the expected top-level command list. tests/unit/site/links.test.ts: rename the fixture's `phax orient` reference heading, README link and anchor (`phax-orient`) to another real command, e.g. `phax validate` / `phax-validate`, consistently in every case, so the link-check logic is tested exactly as before.
- Regenerate, never hand-edit: run `pnpm gen:usage-spec` (phax.usage.kdl), then `pnpm docs:cli` (docs/cli/reference.md and the README section between the generated CLI markers). Every other command, flag and example must be byte-for-byte unchanged in the regenerated output.
- README.md, by hand outside the generated markers: delete the whole `### Orient provider` subsection under `## Extend phax`, and change "Four hooks let your own tools inform a run." to "Three hooks let your own tools inform a run.". Add no removed note or upgrade note. The remaining subsections are Diagnostics gate steps, Scope provider and Plan auditor, and the hello-world sentence stays.
- Leave the `orient` config key, OrientConfigSchema, mergeLayers, loadConfig, src/schemas/orient.ts, the hello-world example and the config JSON schemas untouched: phase-03 removes them.

### Planned files to create

- `tests/integration/agentCommandGrants.test.ts`

### Planned files to edit

- `src/domain/security/agentCommands.ts`
- `src/schemas/securityPosture.ts`
- `src/app/executePlan.ts`
- `src/cli/program.ts`
- `src/cli/cliDocs.ts`
- `src/domain/errors.ts`
- `src/domain/telemetry/events.ts`
- `src/domain/telemetry/snapshot.ts`
- `src/infra/telemetry/layer.ts`
- `src/schemas/telemetryEvents.ts`
- `tests/unit/security/agentCommands.test.ts`
- `tests/unit/security/posture.test.ts`
- `tests/unit/telemetry/events.test.ts`
- `tests/integration/cliProgram.test.ts`
- `tests/unit/site/links.test.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `README.md`
- `src/cli/commands/orient.ts`
- `src/app/orient.ts`
- `tests/unit/cli/orient.test.ts`
- `tests/unit/cli/orientContractDocs.test.ts`
- `tests/integration/orient.test.ts`

### Optional files that may be edited

- `src/infra/fakes/backend.ts`
- `tests/integration/telemetry/end-to-end.test.ts`
- `tests/integration/telemetry/__snapshots__/end-to-end.test.ts.snap`
- `tests/integration/skillEditGrants.test.ts`
- `tests/integration/finalReport.test.ts`

### Boundary contracts

domain → app: computeFrozenAgentCommands (producer) takes `{configCommands, gateCommands, requiredCommands, provider}` with no orient flag and returns records whose `source` is `config | gate`. executePlan (consumer) passes the same input on the fresh and resume paths. app → persisted file: security.json agentCommands `source` is `config | gate`, version 1, decoded only by finalReport, which already skips an undecodable posture. domain → infra/schemas: the SemanticTelemetryEvent union, its schema union and the log-line switch cover exactly the ten remaining types. cli → generated docs: phax.usage.kdl, docs/cli/reference.md and the README summary are produced from the program by the project scripts.

### Test strategy

Domain unit tests for computeFrozenAgentCommands (pruned). A schema unit test for the two-value posture source, written first. An integration test with fake ports for the grants on fresh start and resume in secure mode, written first. A schema unit test enumerating the ten accepted telemetry types, written first, plus an assertion on a full fake run's trace. The existing drift tests (usageSpecDrift, docsCliDrift, usageParity) prove the regenerated files equal the committed ones. cliProgram proves the command list.

### Implementation order

1. Write the posture-enum, grants and ten-event tests
2. Remove the grant source from agentCommands, securityPosture and both executePlan call sites; prune the agentCommands tests
3. Remove the three telemetry events across domain, snapshot, infra and schemas; prune the events tests
4. Delete the CLI command, its registration, cliDocs entry, the app module, the error and their tests; fix cliProgram and the site links fixture
5. Run pnpm gen:usage-spec then pnpm docs:cli
6. Edit README §Extend phax (drop the subsection, Three hooks)
7. Run the standard gate

### Excluded scope

- The `orient` config key in any layer, OrientConfigSchema, mergeLayers, loadConfig and the config JSON schemas (phase-03)
- src/schemas/orient.ts, the hello-world example and its integration test (phase-03)
- The 1.0 announcement draft, docs/ideas/ and NEXT_STEPS.md (phase-04)
- The shared provider runner, scopes, the plan auditor and the gate
- Any dedicated error, alias or message for a removed command

### Verification

The project's `standard` gate profile in phax.json.

### Expected handoff content

Confirm that agentCommands sources are config and gate only, and give the new signature of `computeFrozenAgentCommands`. Name the new test file tests/integration/agentCommandGrants.test.ts and the fake-port hook it relied on. Say which snapshot fields were removed and whether any was kept because another event uses it. Name the fixture command used in tests/unit/site/links.test.ts. Confirm phax.usage.kdl, docs/cli/reference.md and the README CLI summary were regenerated with pnpm gen:usage-spec and pnpm docs:cli and that no other command's output changed. Confirm README now says "Three hooks" with three subsections. For phase-03, list the remaining live uses: `config.orient` / OrientConfig in src/schemas/phaxConfig.ts, src/domain/config/mergeLayers.ts and src/app/loadConfig.ts, and src/schemas/orient.ts, now used only by tests/integration/exampleProviders.test.ts and tests/unit/schemas/orient.test.ts. Explain every file-plan deviation phax flags.

### Commit subject

`refactor(cli): remove phax orient, its grant source and its telemetry events`

### Commit body

The in-phase agent's commands now come from security.agentCommands and the phase's gate only. security.json agent-command sources are exactly config and gate (version stays 1), and the posture schema decodes no other value. Semantic telemetry is back to ten event types: the three orient events, their makers, schemas, log lines, snapshot cases and the snapshot fields only they used are gone.

Remove `phax orient` with its registration, long help and app module, and the provider error only it used. Regenerate phax.usage.kdl, docs/cli/reference.md and the README CLI summary with pnpm gen:usage-spec and pnpm docs:cli. Remove README's Orient provider section, whose only link pointed at the removed reference entry, and make §Extend phax say "Three hooks". Rename the site link-check fixture to another command's anchor.

New tests pin the two grant sources on a fresh start and a resume in secure mode, the posture enum, and the ten accepted event types.

---

## phase-03 — Remove the config key and the example hook {#phase-03-drop-orient-config-key}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

The configuration contract has no orientation key in any layer. `phax schema upgrade` writes schemas whose top-level properties are exactly the contract's, and the hello-world example declares only the hooks it ships a script for (spec §5.7, §5.8, §5.14).

### Detailed instructions

- src/schemas/phaxConfig.ts: delete `OrientConfigSchema`, its `OrientConfig` type and the `orient` property in the project config schema, in the resolved/loaded config type and in the user overlay schema. Excess-property rejection stays as it is. Keep the `scopes` and `planAuditor` blocks and their descriptions unchanged.
- src/domain/config/mergeLayers.ts: delete the orient scalar override and its spread into the merged result. The precedence of every other key is unchanged. src/app/loadConfig.ts: delete the `orient` passthrough.
- Delete src/schemas/orient.ts, tests/unit/schemas/orient.test.ts, tests/unit/schemas/orientConfig.test.ts and examples/hello-world/orient.mjs.
- examples/hello-world/phax.json: delete the `orient` line. It keeps exactly `scopes`, `planAuditor` and the diagnostics step `node ./audit.mjs`.
- tests/integration/exampleProviders.test.ts: delete the orient-provider describe block, its decoder imports and the two `config.orient` assertions. Rename the config case to, e.g., 'decodes with decodePhaxConfig and has scopes, planAuditor and a diagnostics step'. Add ac-example assertions: the decoded config's hook keys are exactly `scopes` and `planAuditor` plus the diagnostics step command `node ./audit.mjs`. The directory's `.mjs` files (readdir) are exactly `scopes.mjs`, `audit-plan.mjs` and `audit.mjs`. The existing tests for those three scripts still pass.
- tests/unit/mergeLayers.test.ts: delete the orient precedence cases. Add or extend a case (ac-precedence): declare `scopes` and `planAuditor` with different commands in phax.json, ~/.phax/config.json and phax.local.json, all as in-memory made-up layer values. Each resolves from phax.local.json, from ~/.phax/config.json once the local layer is cleared, and from phax.json once both are cleared. No real home directory is read.
- tests/unit/phaxUserOverlaySchema.test.ts: delete the 'accepts an orient block' case. tests/unit/schemas/scopesConfig.test.ts and tests/unit/schemas/planAuditorConfig.test.ts: in the cases that decode a block next to the removed key, drop that key and rename the cases (e.g. 'next to planAuditor' / 'next to scopes'), so each still proves its block decodes alongside the other provider. Do not add any case that decodes a leftover key and expects refusal.
- Regenerate, never hand-edit: run `pnpm dev schema upgrade` at the repo root to rewrite phax.schema.json and phax.user.schema.json. phax.json must stay byte-for-byte unchanged, so check it in the diff.
- tests/unit/phaxConfigJsonSchema.test.ts: delete the orient.command description case. Add ac-schemas: the generated project schema's top-level properties are exactly `$schema, version, name, state, agent, commands, fileReconciliation, security, publish, scopes, planAuditor, review, authoring, gateProfiles, workspaces, records`, and the user schema's are exactly `state, agent, commands, fileReconciliation, security, publish, scopes, planAuditor, review, authoring, gateProfiles, workspaces`. Compare as sets or in order, whichever the test style already uses. Assert also that the committed root files equal the generated ones, unless an existing test (e.g. tests/unit/upgradeConfigSchema.test.ts) already does, in which case extend that test instead.
- Do not touch the scope provider's behaviour, the plan auditor, the shared provider runner, the gate or any docs other than the generated schema files.

### Planned files to create

- (none)

### Planned files to edit

- `src/schemas/phaxConfig.ts`
- `src/domain/config/mergeLayers.ts`
- `src/app/loadConfig.ts`
- `phax.schema.json`
- `phax.user.schema.json`
- `examples/hello-world/phax.json`
- `tests/integration/exampleProviders.test.ts`
- `tests/unit/mergeLayers.test.ts`
- `tests/unit/phaxUserOverlaySchema.test.ts`
- `tests/unit/phaxConfigJsonSchema.test.ts`
- `tests/unit/schemas/scopesConfig.test.ts`
- `tests/unit/schemas/planAuditorConfig.test.ts`
- `src/schemas/orient.ts`
- `tests/unit/schemas/orient.test.ts`
- `tests/unit/schemas/orientConfig.test.ts`
- `examples/hello-world/orient.mjs`

### Optional files that may be edited

- `tests/unit/upgradeConfigSchema.test.ts`
- `tests/unit/buildConfig.test.ts`

### Boundary contracts

schemas → app/domain: the decoded PhaxConfig and user overlay (producer) no longer carry an orientation key. mergeLayers and loadConfig (consumers) resolve every remaining key with today's precedence (phax.local.json, then ~/.phax/config.json, then phax.json). phax schema upgrade (producer) writes the two root JSON Schemas from the same Effect schemas.

### Test strategy

Schema unit tests for the exact top-level properties of both generated JSON Schemas (written first; they fail until the key is removed and the files regenerated). A domain unit test for the precedence of scopes and planAuditor across three in-memory layers (written first; passes before and after). An integration test of the example's exact hooks and scripts. The existing upgradeConfigSchema/buildConfig tests guard the generation path.

### Implementation order

1. Write the exact-properties and precedence tests
2. Remove the key from phaxConfig, mergeLayers and loadConfig, and prune the config tests
3. Delete the row schema and its tests
4. Edit the example's phax.json, delete its orient script and update exampleProviders
5. Run pnpm dev schema upgrade and check phax.json is unchanged
6. Run the standard gate

### Excluded scope

- Any message, refusal, migration or deprecation for a leftover key, and any test of the unknown-key refusal for it
- scopes, planAuditor, pending diagnostics and the shared provider runner
- README, the announcement draft, docs/ideas/ and NEXT_STEPS.md (README done in phase-02; the rest in phase-04)
- Any `version` bump or `@lbdremy/phax-schemas` change

### Verification

The project's `standard` gate profile in phax.json.

### Expected handoff content

Confirm the key is gone from the project config, the resolved config and the user overlay, and from mergeLayers and loadConfig. Confirm phax.schema.json and phax.user.schema.json were regenerated with `pnpm dev schema upgrade`, list their top-level properties, and confirm phax.json is unchanged. Name the test that pins the exact properties and the test that pins the precedence. Confirm examples/hello-world now holds exactly scopes.mjs, audit-plan.mjs and audit.mjs, and that its phax.json declares scopes, planAuditor and the diagnostics step. List any remaining live-tree occurrence you know of for phase-04 (expected: docs/blog/announcing-phax-1.0.md, docs/ideas/coverage-provider.md, docs/ideas/decision-queue-and-proof-chain.md, and the NEXT_STEPS.md cross-run item). Explain every file-plan deviation phax flags.

### Commit subject

`refactor(config): remove the orient key and the hello-world orient hook`

### Commit body

The configuration contract of phax.json, phax.local.json and ~/.phax/config.json no longer has an orientation provider key. Every other key keeps its layer precedence. A leftover key now meets the ordinary unknown-key refusal, with no dedicated message.

Remove OrientConfigSchema from the project config and the user overlay, together with its merge and its loader passthrough. Remove the row and request schemas, which nothing reads any more. Regenerate phax.schema.json and phax.user.schema.json with phax schema upgrade. The hello-world example now declares only scopes, planAuditor and its diagnostics step, and ships a script for each: its orient script is deleted.

New tests pin the exact top-level properties of both generated schemas, the unchanged precedence of scopes and planAuditor across the three layers, and the example's exact hooks and scripts.

---

## phase-04 — Sweep the remaining docs and check the live tree {#phase-04-sweep-docs}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

No live doc describes an orientation provider, and the docs count what they list. The spec's mechanical sweep prints nothing over the live tree (spec §5.12, §5.13, §5.15).

### Detailed instructions

- docs/blog/announcing-phax-1.0.md: delete the whole `## Orientation before the gate` section. In the providers passage, change "three providers" to "two providers" and delete the `orient` bullet, so the bullets are exactly `scopes` (during the gate) and `planAuditor` (before the run). Change "at three points" to "at two points". Reword the lead-in that began "Orient is one of …" so it reads naturally (e.g. "phax has **two providers** you can plug into `phax.json` …"), and fix any other sentence there that refers back to the deleted section. Add no removed note.
- docs/ideas/coverage-provider.md: drop `orient` from the list of existing providers, leaving gate diagnostics and `scopes`, and keep the sentence grammatical. docs/ideas/decision-queue-and-proof-chain.md: reword the plain-English "orient attention" to "direct attention" (or an equivalent that does not contain the swept string), keeping the bold markup.
- NEXT_STEPS.md, cross-run durable context item only: reword it so it names neither the removed provider nor its phase-folder file. Follow spec §6: feed phax's registered providers from phax's own run history; the raw material that already exists and is unread is the per-phase `verifiedSurfaces` manifest field (since 0.10); the plan auditor (since 0.13) could read the same history. Keep the rest of the item's wording. Tick the `drop-orient` item (`- [ ]` → `- [x]`) under the file's 'tick items off as they land' rule, changing nothing else in that item. Do not edit any other item, and do not add the §10 wording for other specs' revisions: the spec does not ask for it here.
- Sweep check: run exactly `git grep -i -l orient -- . ':!docs/specs/' ':!docs/plans/' ':!docs/briefs/' ':!docs/spikes/' ':!NEXT_STEPS.md'`. It must print nothing and exit 1. If it lists a file, remove the occurrence in the spirit of the spec: delete the description of the removed feature, or reword plain English. Never add a removed note. Record each such file as a deviation. Kept history is excluded by the pathspecs and is not touched. Never edit a file under docs/specs/, docs/plans/, docs/briefs/ or docs/spikes/. If the sweep lists a `.claude/skills/` file, do not edit it: report it in the handoff.
- Cross-check the counts by reading: README §Extend phax says "Three hooks" and has exactly Diagnostics gate steps, Scope provider and Plan auditor (done in phase-02). The announcement counts two providers and lists exactly scopes and planAuditor. The NEXT_STEPS item names verifiedSurfaces and the plan auditor and no other provider or phase-folder file.

### Planned files to create

- (none)

### Planned files to edit

- `docs/blog/announcing-phax-1.0.md`
- `docs/ideas/coverage-provider.md`
- `docs/ideas/decision-queue-and-proof-chain.md`
- `NEXT_STEPS.md`

### Optional files that may be edited

- (none)

### Test strategy

Docs-only phase: the standard gate (including the terminal build, site:build and deno smoke steps, which run on this final phase) proves the tree still builds, and the existing site and docs tests keep passing. The spec's sweep criterion is checked mechanically by running its exact git grep command, recorded in the handoff (see Technical arbitrations). No test file is added that holds the swept string.

### Implementation order

1. Edit the announcement draft
2. Edit the two ideas docs
3. Reword the NEXT_STEPS cross-run item and tick the drop-orient item
4. Run the sweep check and fix anything it lists
5. Run the standard gate

### Excluded scope

- Any file under docs/specs/, docs/plans/, docs/briefs/ or docs/spikes/, and every NEXT_STEPS.md item other than the cross-run item and the drop-orient tick
- Code, tests and generated contract files (phases 01–03), except a stray occurrence the sweep finds
- Any removed note, upgrade note or deprecation text
- Redeploying docs.phax.run

### Verification

The project's `standard` gate profile in phax.json, plus the spec's sweep check run as an agent command and recorded in the handoff.

### Expected handoff content

Paste the exact sweep command, its (empty) output and its exit status (1). List each doc edit in one line. Quote the new NEXT_STEPS cross-run item and confirm only it and the drop-orient tick changed in that file. Confirm the announcement now counts two providers with exactly the scopes and planAuditor bullets. Confirm that no file under docs/specs/, docs/plans/, docs/briefs/ or docs/spikes/ was touched, and whether any `.claude/skills/` file named orient (expected: none). Explain every file-plan deviation phax flags, including any extra file the sweep made you edit.

### Commit subject

`docs: sweep the orientation provider from the live docs`

### Commit body

The 1.0 announcement draft no longer presents orientation as a shipped feature. Its Orientation before the gate section is removed, and it now counts two providers, listing exactly scopes and planAuditor, at two points. docs/ideas/coverage-provider.md drops orient from its list of existing providers, and decision-queue-and-proof-chain.md says "direct attention" instead.

The NEXT_STEPS cross-run durable context item now names the per-phase verifiedSurfaces manifest field as its raw material and the plan auditor as a consumer, and no removed provider or phase-folder file. The drop-orient item is ticked as it lands, under the file's own rule. The rest of the queue is unchanged.

The spec's sweep check, git grep -i -l orient over the live tree excluding docs/specs/, docs/plans/, docs/briefs/, docs/spikes/ and NEXT_STEPS.md, now prints nothing.
