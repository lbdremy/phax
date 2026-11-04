---
status: Draft
source-spec: docs/specs/2611041159-project-only-claude-sessions.md
completes-spec: true
---
# Project-only Claude sessions

The only plan of the spec project-only-claude-sessions. After this run, every headless Claude Code session phax launches carries `--setting-sources project` in its argv and `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` in an environment that is otherwise inherited from phax unchanged. That covers phase sessions and their fix attempts, handoff generation, headless authoring, decide's headless handback and its corrective retry, headless and compliance review, the first turn of an interactive phase, and sealed structured completions. Interactive launches (`phax enter`, a stop's continue and fresh-start commands, decide's interactive session, interactive review) and the usage probe are unchanged. A headless session that Claude Code reports as not authenticated fails with its own kind, `not-authenticated`, and a message naming the remedies, and it is never retried as a network or limit failure. Each phase record manifest carries a required `userConfig` (`excluded` for a claude-code phase, `loaded` for codex-cli and mistral-vibe). docs/security.md says what a Claude Code session loads.

Order, core to surface. Every commit is green under the `standard` gate profile. phase-01 cuts the persisted shapes. It freezes phase-record-manifest 0.33.0 and adds `userConfig` at 0.34.0, written `loaded` for every provider at that commit. It also freezes decision-record-manifest 0.30.0 and adds the `not-authenticated` failure at 0.34.0, and adds the kind to the reader's union. phase-02 is the acceptance phase. It writes frozen, expected-failure tests for the launch criteria that fail today and for the record value. phase-03 passes them: the switches go into the headless builders and spawns, and claude-code records say `excluded`. It also adds the in-phase guards for the criteria that already hold today. phase-04 recognises the lost authentication and words it. phase-05 adds the real-session e2e cases, which stay deliberate. phase-06 writes the docs.

The installed phax 0.33.0 drives this run. It reads none of what this plan changes. It writes this run's own records at phase-record-manifest 0.33.0, and the frozen 0.33.0 decoder added in phase-01 keeps them readable. No phase edits phax.json, a skill or `.claude/`, so the run needs no `--allow-skill-edits`. No interactive phase is declared: no phase sets a pattern that a later one repeats, and the operator can still hold any phase with `phax run --hold`. The real-session e2e cases (phase-05) cannot run inside a phase worktree. The operator runs `pnpm test:e2e:real` with `PHAX_E2E_RUN=1` before merging and reports the result, including whether `~/.claude/CLAUDE.md` stays out, in the pull request.

## Required commands

- `pnpm exec tsx`

`pnpm exec tsx` runs `scripts/schemas-check.ts --write`, which regenerates src/schemas/release.ts, packages/schemas/src/generated/index.ts and packages/schemas/history.lock.json after a shape cut. It is already in `security.agentCommands` of phax.json, so the plan needs no phax.json change. No phase runs `pnpm test:e2e:real`, which needs a real, authenticated Claude Code.

## Technical arbitrations

- Where the switches live. `--setting-sources project` is added by the headless argv builders in src/infra/providers/claudeCode.ts: both branches of `buildArgs` (read-only, and secure/unsafe, new session or resume) and `buildCompletionArgs`. It goes right after `--print --output-format stream-json --verbose`, as §6 shows. `buildProbeArgs` is rebuilt from a private sealed core shared with `buildCompletionArgs`, without the flag. The environment comes from a pure `projectOnlyEnvironment` (src/domain/session/claudeProjectOnly.ts). `runClaudeAgent` and `runClaudeCompletion` pass it to `spawnClaude` through a new required `env` parameter, and `runClaudeProbe` passes the inherited environment. Nothing goes into `claudePermissionFlags` or `claudeReadOnlyFlags`, which the interactive stop commands and decide's interactive session share. Loss accepted: the argv half and the environment half live in two places that must agree. phase-02's acceptance tests check both halves on every headless kind, through the real spawn and the recording stub. Rejected: a launch-kind parameter on `spawnClaude` that injects the flag. It gives up an argv that equals what `agent-error.log` and `AgentInvocationError` record, and the e2e tests that spawn `buildArgs` output would stop proving the real flags. Rejected: the shared permission flags, which would give up unchanged interactive launches (§5.7).
- The environment is extended, never replaced. `projectOnlyEnvironment(inherited)` returns a new object: every defined inherited variable is kept as is, and `CLAUDE_CODE_DISABLE_AUTO_MEMORY` is set to `1` over whatever value it had. `process.env` is never mutated, and the probe and interactive launches get no override. Loss accepted: an operator cannot turn auto-memory back on for headless sessions through the environment. q-opt-out already settled this.
- The lost authentication is a kind of its own, `not-authenticated`, added to `FailureKind` and `FAILURE_KINDS` (src/domain/session/outcome.ts). It is not transient, so `isTransientFailure` stays false, `sessionFailureError` raises an `AgentSessionFailedError` (never a limit error), and no network pause or rate-limit wait applies. Only the Claude reader recognises it (src/domain/session/claudeOutcome.ts, wordings in src/domain/session/claudeAuthentication.ts), and it checks before the shared signature table. The signals: an error result whose text matches Claude Code's not-authenticated wordings (`Invalid API key`, `Please run /login`, `OAuth token has expired`, `OAuth token revoked`, `Not logged in`, `authentication_error`, case-insensitive), a synthetic API-error message categorised `authentication_failed`, `api_error_status` 401, or, with no result event, stderr matching the same wordings. The shared table in signatures.ts and the Codex and Vibe readers are unchanged. The message keeps the provider's text on the failure line, `claude-code session failed (not-authenticated): <text>`, followed by two fixed lines. The first is `Claude Code is not authenticated. phax's headless sessions do not load your Claude Code user settings (~/.claude/settings.json), so an apiKeyHelper or env set there is not used.` The second is ``Log in with `claude /login`, or set ANTHROPIC_API_KEY where you run phax.`` `sessionFailureError` appends them to the error's message, and `renderSessionFailure` appends them after the failure line. Loss accepted: §6's indicative heading becomes phax's usual failure line plus the two lines.
- The decision record follows the new kind. Its `DecisionFailureSchema` mirrors the reader's kinds plus three, and tests/type/decisionFailure.ts keeps the two equal. So decision-record-manifest is frozen at 0.30.0 and gains `not-authenticated` in a 0.34.0 shape, cut in phase-01 beside the phase manifest. Loss accepted: a second format cut that the spec does not name. Rejected: mapping the kind to `provider-error` in decision records, which gives up a record that tells a lost login apart from any other provider error and breaks the type test's equality. The interactive-session first-turn `reason` keeps mapping every non-limit failure to `provider-error`, as it already does for `network`. Loss accepted: an interactive phase's first-turn record does not name the authentication cause, while its phase failure and terminal output do.
- The record field is `userConfig: "excluded" | "loaded"`, required in the 0.34.0 phase-record-manifest and placed right after `provider`. A pure `userConfigOf(provider)` (src/domain/records/userConfig.ts, an exhaustive switch) derives it: `excluded` for claude-code, `loaded` for codex-cli and mistral-vibe. `assembleRecord` writes it. Every earlier shape (pre-schema, 0.17.0, 0.26.0, 0.30.0, 0.33.0) lifts to `loaded`, because every earlier phax loaded the user layer for every provider. phase-01 writes `loaded` for every provider, which is true at that commit, and phase-03 flips claude-code to `excluded` in the same commit as the switches. Loss accepted: the schema does not tie the value to the provider, so a claude-code manifest saying `loaded` decodes. The honest lift of older claude-code records needs exactly that combination.
- Which criteria are acceptance tests. Only the criteria that fail against today's code are frozen in phase-02: ac-phase-argv, ac-every-headless, ac-memory-wins, ac-resume and ac-record's provider values. ac-env-kept, ac-interactive, ac-probe and ac-no-touch already hold today, and an expected-failure marker on a passing test fails the gate. They become in-phase regression guards in phase-03, each with its own named test. ac-record's decode refusal is in-phase in phase-01, where the shape lands. ac-auth is in-phase in phase-04: one test, with indicative wording. Loss accepted: these tests are written beside the code they guard, not frozen before it. Rejected: a second acceptance pair for ac-auth, which gives up a phase's worth of cost for one test whose wording the spec leaves open.
- Real-session cases (ac-real-init, ac-skill-grant, ac-protected-path) live in tests/e2e/ and run only through `pnpm test:e2e:real` (vitest.e2e.config.ts) with `PHAX_E2E_RUN=1` and an installed `claude` (`probeProvider("claude")`). The gate's `pnpm test` never includes tests/e2e. Every argv and environment criterion runs against the recording stub (tests/helpers/fakeProviderCli.ts), which already captures each invocation's argv and whole environment. Loss accepted: the real-session criteria are proven only when the operator runs them, not on every gate.
- Release. The new shapes are stamped 0.34.0, the open release, through `packages/schemas/snapshots/<format>/next.schema.json` and `pnpm exec tsx scripts/schemas-check.ts --write`. 0.33.0 (phase manifest) and 0.30.0 (decision manifest) are frozen the way the last cut froze phase-record-manifest 0.30.0: a self-contained history module, its release snapshot unchanged, its lock entry, a reader branch in src/schemas/persisted.ts, and a release entry with a lift in packages/schemas/src/formats/recordManifests.ts.

## Open questions

### q-e2e-user-layer — Where does the ac-real-init e2e case plant the user layer (a user skill, a non-builtin plugin, a rules file, a user CLAUDE.md, a SessionEnd hook, an auto-memory index) that it proves does not reach a project-only session?

- dedicated-config-dir — In a dedicated Claude Code configuration directory named by PHAX_E2E_CLAUDE_CONFIG_DIR (handed to Claude Code as CLAUDE_CONFIG_DIR), which the operator logs into once or authenticates with ANTHROPIC_API_KEY; the case is skipped when the variable is unset — abandons: a case that runs anywhere `claude` is installed: it runs only on a machine where the operator prepared that directory and logged into it once (on macOS, a fresh configuration directory has its own login)
- plant-real-home — In the operator's real ~/.claude, under uniquely named files plus a SessionEnd hook added to ~/.claude/settings.json, all removed after the case — abandons: the operator's own setup staying untouched by phax's tests: a crash mid-case leaves a hook and planted files in their real settings, which every Claude Code session of theirs then loads
- observe-only — Plant nothing; run against the operator's configuration as it is and assert the init event lists nothing beyond the repository's and the bundled skills — abandons: the proof itself on a machine whose user layer is empty or lacks a kind (no hook, no CLAUDE.md): the criterion then passes without anything to exclude

Recommendation: dedicated-config-dir — Only a planted layer proves exclusion, and only a directory phax's tests own can be planted without touching the operator's real settings. The one-time login is a deliberate step, and the e2e tier is already deliberate. A control run without the switches shows each planted item loading, so a fixture that fails to plant shows up instead of passing vacuously.

---

## phase-01 — Phase and decision record shapes for 0.34.0 {#phase-01-record-shapes}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** Two format cuts at once (frozen modules, readers, package releases, regenerated stamps and lock) across src/schemas, packages/schemas and many tests, where a missed lift fails the gate: more sites than the default effort reliably carries in one commit.

phase-record-manifest has a 0.34.0 shape with a required `userConfig` (`excluded` | `loaded`), written `loaded` for every provider at this commit, and every earlier shape reads with `userConfig: "loaded"`. decision-record-manifest has a 0.34.0 shape whose failure admits `not-authenticated`, and the session reader's `FailureKind` gains that kind, which nothing produces yet.

### Detailed instructions

- Freeze first. Copy today's phase record manifest file schema (RunRecordManifestFileSchema in src/schemas/runRecord.ts, with every nested schema it uses) verbatim into src/schemas/history/phase-record-manifest/0.33.0.ts. Make it self-contained and model it on src/schemas/history/phase-record-manifest/0.30.0.ts. The header comment names the 0.33.0 through 0.33.x writers and says never to edit the module. It exports PhaseRecordManifestV0_33_0Schema, type PhaseRecordManifestV0_33_0 and decodePhaseRecordManifestV0_33_0 (onExcessProperty: error). It must render packages/schemas/snapshots/phase-record-manifest/0.33.0.schema.json exactly; do not edit that snapshot.
- Freeze the decision record the same way. Copy today's DecisionRecordManifestFileSchema (src/schemas/decisionRecord.ts, with its nested schemas) into src/schemas/history/decision-record-manifest/0.30.0.ts, modelled on 0.28.0.ts there. It exports DecisionRecordManifestV0_30_0Schema, its type and decodeDecisionRecordManifestV0_30_0, and must render packages/schemas/snapshots/decision-record-manifest/0.30.0.schema.json exactly.
- src/schemas/runRecord.ts: add `export const UserConfigSchema = Schema.Literal("excluded", "loaded")` with its type `UserConfig`. Add the description: whether the operator's user-level provider configuration was loaded for the phase's headless sessions. Add `userConfig: UserConfigSchema` to runRecordManifestFields right after `provider`, required, not optional. Check that src/schemas/authoringRecord.ts's file union still compiles; the authoring manifest gains no field.
- src/schemas/decisionRecord.ts: add `"not-authenticated"` to DecisionFailureSchema after `"usage-limit"`. src/domain/session/outcome.ts: add `"not-authenticated"` to FailureKind and FAILURE_KINDS at the same position, documented as Claude Code reporting the session is not authenticated. Leave isTransientFailure unchanged, so the kind is never transient. tests/type/decisionFailure.ts must still hold unchanged. Fix any exhaustive switch the compiler names, such as telemetry failureKindOf or decideFailure; no reader produces the kind in this phase.
- src/domain/records/userConfig.ts (new): `userConfigOf(provider: ProviderId): UserConfig`, an exhaustive switch. At this commit it returns `"loaded"` for claude-code, codex-cli and mistral-vibe, because every launch still loads the user layer. A comment says the claude-code case becomes `excluded` once headless Claude Code sessions launch project-only. src/domain/records/assemble.ts sets `userConfig: userConfigOf(input.provider)` right after `provider` in the manifest; AssembleRecordInput is unchanged.
- Readers, in src/schemas/persisted.ts readPhaseRecordManifestAs: a stamp in [0.33.0, current) is decoded by decodePhaseRecordManifestV0_33_0 and lifted by dropping `$schema` and inserting `userConfig: "loaded"` after `provider`. The existing 0.30.0, 0.26.0, 0.17.0 and pre-schema paths also insert `userConfig: "loaded"` in the same position. Update the comment above the reader. In the decision-record-manifest reader (readDecisionRecordManifest), a stamp in [0.30.0, current) is decoded by decodeDecisionRecordManifestV0_30_0 and lifted unchanged except for `$schema`. The existing 0.28.0 and 0.25.0 paths keep their lifts.
- Snapshots and stamps. Create packages/schemas/snapshots/phase-record-manifest/next.schema.json and packages/schemas/snapshots/decision-record-manifest/next.schema.json the way the run-list and artifact-status next snapshots were made: render the current shapes with the package's snapshot build. Then run `pnpm exec tsx scripts/schemas-check.ts --write` twice, then the check without --write. src/schemas/release.ts, packages/schemas/src/generated/index.ts and packages/schemas/history.lock.json are regenerated by it; never hand-edit release.ts. Both formats' CURRENT_STAMPS must read 0.34.0.
- Package. packages/schemas/src/formats/recordManifests.ts lists phase-record-manifest 0.33.0 and decision-record-manifest 0.30.0 as releases with their schema and decoder. Every older release's toLatest lifts to `userConfig: "loaded"` for the phase manifest, and the 0.30.0 decision release lifts as-is. packages/schemas/src/index.ts exports the two frozen schemas and types beside the others, and tests/type/schemasPackage.ts follows.
- Tests (temporary repositories and fake ports; never read ~/.phax, a real HOME or the global git config):
      - tests/unit/runRecord.test.ts: a 0.34.0 manifest without `userConfig` is refused naming the field; one with `excluded` and one with `loaded` decode; an unknown value is refused.
      - tests/unit/persisted.test.ts: one manifest per earlier shape (pre-schema, 0.17.0, 0.26.0, 0.30.0, 0.33.0), written as raw JSON in its frozen shape, reads as current with `userConfig: "loaded"` and every other field as the existing lift gives it. A decision manifest stamped 0.30.0 reads unchanged, and one at 0.34.0 with failure `not-authenticated` decodes.
      - tests/unit/schemasPackage/recordManifests.test.ts and phaseRecordManifestHistory.test.ts: the package parses each phase-record-manifest release and lifts it to latest with `userConfig: "loaded"`, and it parses decision-record-manifest 0.30.0. Update tests/unit/schemasPackage/currentShapes.test.ts and documents.ts to the new current shapes.
      - tests/integration/writeRecord.test.ts: a written phase record.json is stamped phase-record-manifest 0.34.0 and carries `"userConfig": "loaded"` right after `provider` for a claude-code and a codex-cli phase.
      - Update any other fixture or snapshot the suite names to carry the field.

### Planned files to create

- `src/schemas/history/phase-record-manifest/0.33.0.ts`
- `src/schemas/history/decision-record-manifest/0.30.0.ts`
- `packages/schemas/snapshots/phase-record-manifest/next.schema.json`
- `packages/schemas/snapshots/decision-record-manifest/next.schema.json`
- `src/domain/records/userConfig.ts`

### Planned files to edit

- `src/schemas/runRecord.ts`
- `src/schemas/decisionRecord.ts`
- `src/domain/session/outcome.ts`
- `src/domain/records/assemble.ts`
- `src/schemas/persisted.ts`
- `src/schemas/release.ts`
- `packages/schemas/src/formats/recordManifests.ts`
- `packages/schemas/src/index.ts`
- `packages/schemas/src/generated/index.ts`
- `packages/schemas/history.lock.json`
- `tests/type/schemasPackage.ts`
- `tests/unit/runRecord.test.ts`
- `tests/unit/persisted.test.ts`
- `tests/unit/schemasPackage/recordManifests.test.ts`
- `tests/unit/schemasPackage/phaseRecordManifestHistory.test.ts`
- `tests/unit/schemasPackage/currentShapes.test.ts`
- `tests/unit/schemasPackage/documents.ts`
- `tests/integration/writeRecord.test.ts`

### Optional files that may be edited

- `src/app/writeRecord.ts`
- `src/app/decideFailure.ts`
- `src/app/telemetry/reportBuilders.ts`
- `src/schemas/authoringRecord.ts`
- `packages/schemas/build/jsonSchemas.ts`
- `packages/schemas/build/snapshots.ts`
- `tests/type/decisionFailure.ts`
- `tests/unit/recordsAssemble.test.ts`
- `tests/unit/authoringRecord.test.ts`
- `tests/unit/vibeUsageLift.test.ts`
- `tests/unit/schemas/acceptanceRecordLiftCases.ts`
- `tests/unit/schemasPackage/acceptanceRecordLifts.test.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/jsonSchemas.test.ts`
- `tests/unit/schemasPackage/parseDocument.test.ts`
- `tests/unit/schemasPackage/documents.test.ts`
- `tests/unit/schemasPackage/exports.test.ts`
- `tests/unit/schemasPackage/snapshots.test.ts`
- `tests/unit/schemasPackage/parse.test.ts`
- `tests/unit/schemasSmoke.test.ts`
- `tests/integration/persistedProducer.test.ts`
- `tests/integration/recordsExplain.test.ts`
- `tests/integration/recordsExplainStop.test.ts`
- `tests/integration/stopRecords.test.ts`
- `tests/integration/__snapshots__/executePlan.test.ts.snap`

### Boundary contracts

Producer: src/schemas/runRecord.ts. Consumers: the record writer (assembleRecord via writeRecord), records explain, the schemas package. Contract: the phase manifest carries a required `userConfig` (`excluded` | `loaded`) after `provider`, stamped 0.34.0. Every earlier stamp reads as current with `loaded`. Producer: src/domain/records/userConfig.ts. Consumer: assembleRecord. Contract: `userConfigOf(provider)`, total over ProviderId. Producer: src/domain/session/outcome.ts. Consumers: every failure reader, sessionFailureError, decideFailure and the decision record. Contract: FailureKind includes the non-transient `not-authenticated`, which DecisionFailureSchema mirrors.

### Test strategy

- a 0.34.0 phase manifest without userConfig is refused on decode, and one with excluded or loaded decodes — small · boundary · the decoder's typed refusal naming the field, and the decoded value · in-phase · ac-record
- every earlier phase-record-manifest shape reads as current with userConfig loaded and its other fields as the existing lift gives them — small · table · the expected current manifest per frozen shape · in-phase
- the frozen 0.33.0 phase manifest and 0.30.0 decision manifest modules render their release snapshots exactly and are pinned in the lock — small · example · the committed release snapshots and history.lock.json · in-phase
- a decision manifest with failure not-authenticated decodes at 0.34.0, and a 0.30.0 decision manifest still reads — small · example · the decoded manifests · in-phase
- the schemas package parses each phase-record-manifest release and lifts it to latest with userConfig loaded — small · table · the expected latest manifest per release · in-phase
- a written record.json is stamped 0.34.0 and says userConfig loaded right after provider at this commit — medium · example · the committed record.json bytes · in-phase

### Implementation order

1. the two frozen history modules, rendering their release snapshots
2. UserConfigSchema and the field in runRecord.ts; not-authenticated in decisionRecord.ts and outcome.ts
3. userConfig.ts and assembleRecord
4. the readers and lifts in persisted.ts
5. next snapshots, then scripts/schemas-check.ts --write twice and the check
6. the schemas package formats, exports and type test
7. tests

### Excluded scope

- Any change to how Claude Code is launched (phase-03).
- Recognising or wording the lost authentication (phase-04).
- A userConfig field on authoring, decision or review record manifests.
- The interactive-session first-turn reason set.
- Showing userConfig in `phax records explain`.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

The exact export names of the two frozen modules and of UserConfigSchema / UserConfig, the `userConfigOf` signature in src/domain/records/userConfig.ts, and the position of `userConfig` in the manifest. The CURRENT_STAMPS of phase-record-manifest and decision-record-manifest after the --write. Every reader path that now inserts `loaded`. Any exhaustive switch that needed a `not-authenticated` case. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(records): add userConfig to phase records and not-authenticated to decision records`

### Commit body

phase-record-manifest 0.33.0 is frozen and the 0.34.0 shape adds a required userConfig, excluded or loaded, after provider. Every earlier shape reads with loaded, because every earlier phax loaded the user layer, and the writer says loaded for every provider until headless Claude Code sessions launch project-only. decision-record-manifest 0.30.0 is frozen and the 0.34.0 shape admits the not-authenticated failure, which the session reader's FailureKind now names and nothing produces yet.

---

## phase-02 — Acceptance tests for project-only launches and the record value {#phase-02-launch-acceptance}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** Frozen tests that reach eight launch kinds through their use cases and must each fail on the stated assertion: a harness no existing test assembles, and one the passing phase cannot correct.
**Acceptance phase:** passed by phase-03
**Acceptance test files:** `tests/helpers/projectOnlyHarness.ts`, `tests/integration/projectOnlyLaunch.test.ts`, `tests/integration/userConfigRecord.test.ts`

Frozen acceptance tests, each marked as an expected failure, state what the next phase must make true. Every headless Claude Code launch kind, including resumes, carries `--setting-sources project` and `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, phax's value wins over the operator's, and a claude-code phase record says `excluded` while a codex-cli one says `loaded`.

### Detailed instructions

- Write three new files and touch no source file. tests/helpers/projectOnlyHarness.ts holds the shared setup. tests/integration/projectOnlyLaunch.test.ts covers the launch criteria. tests/integration/userConfigRecord.test.ts covers the record criterion. Every `it` in the two test files is written `it.fails(...)`, the acceptance marker the configured `node examples/vitest-acceptance/main.mjs` provider recognises. Use no skip, todo, only, skipIf or runIf, and give every test in a block a distinct title. The test command must stay green with the markers in place.
- Each test must fail on its assertion against today's code (the argv lacks `--setting-sources project`, the environment lacks or carries another value for `CLAUDE_CODE_DISABLE_AUTO_MEMORY`, the claude-code record says `loaded`), never because a module, export or type is missing. Use only exports that exist at phase-01: the app use cases, `makeNodeBackendLayer`, `runClaudeAgent`, `runClaudeCompletion`, the fakes, and tests/helpers/fakeProviderCli.ts. Before committing, run each test once without its marker (then restore it) and check that it fails for the stated reason.
- tests/helpers/projectOnlyHarness.ts: install the recording stub with `makeFakeProviderCli(root)` in a fresh temporary directory and put its `env` on process.env with `vi.stubEnv`, as tests/unit/providers/claudeCode.test.ts does. Expose helpers that read the stub's `invocations()` (argv, cwd) and `traces()` (whole environment) per invocation, plus `expectProjectOnly(argv, env)`. It asserts `argv` holds `--setting-sources` immediately followed by `project`, exactly once, and that `env.CLAUDE_CODE_DISABLE_AUTO_MEMORY === "1"`. It assumes nothing else about argv order. Build temporary git repositories the way tests/integration/structuredAnswerFlags.test.ts does, and use the node backend layer for the claude-code provider.
- projectOnlyLaunch.test.ts, `describe("ac-phase-argv")`: drive a run of a one-phase plan whose phase is claude-code under the secure profile, through executePlan with the node backend and the recording stub, the way tests/integration/networkPause.test.ts or protectedPathsNativeRules.test.ts drive a phase. Assert that the phase session's invocation is project-only.
- `describe("ac-every-headless")`: one test per launch kind, each asserting the captured invocation is project-only. Call `runClaudeAgent` directly with a read-only session, with a secure session (a writable path) and with an unsafe session. Call `runClaudeCompletion` for a structured completion. Drive headless spec authoring through authorArtifact, as structuredAnswerFlags.test.ts does. Drive handoff generation through src/app/handoffGeneration.ts, as its existing integration tests do. Drive headless code review through reviewCodeHeadless and compliance review through reviewCompliance.
- `describe("ac-memory-wins")`: with `vi.stubEnv("CLAUDE_CODE_DISABLE_AUTO_MEMORY", "0")`, a headless session (runClaudeAgent, secure) captures `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`.
- `describe("ac-resume")`: a phase whose gate fails once. Use a gate step running a node script that fails on its first run and passes after, with the fix attempt resuming the session. Assert that the fix attempt's invocation carries `--resume <the first session id>` and is project-only. Then a decide whose interactive part runs on the fake Session port (src/infra/fakes/session.ts) and whose first handback answer is refused: script the stub so the first handback answer is invalid and the retry valid, as structuredAnswerFlags.test.ts does for decide. Assert that the handback and the corrective retry each carry `--resume <id>` and are project-only.
- userConfigRecord.test.ts, `describe("ac-record")`: a run of a two-phase plan, phase-01 on claude-code and phase-02 on codex-cli, both completing on the recording stubs, with records written to a temporary destination. Read each phase's committed record.json the way tests/integration/stopRecords.test.ts reads records. Assert that phase-01's carries `"userConfig": "excluded"`, phase-02's `"userConfig": "loaded"`, and both are stamped phase-record-manifest 0.34.0.
- Never read ~/.phax, a real HOME, real ~/.claude or the global git config. The stub's HOME is the test's own, and tests/helpers/isolatePhaxHome.ts applies where the use case reads phax home. No randomness, so no seed is needed.

### Planned files to create

- `tests/helpers/projectOnlyHarness.ts`
- `tests/integration/projectOnlyLaunch.test.ts`
- `tests/integration/userConfigRecord.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- (none)

### Boundary contracts

Consumer: the acceptance tests. Producers: the headless entry points as they stand at phase-01 (executePlan, authorArtifact, handoff generation, reviewCodeHeadless, reviewCompliance, decideArtifact, runClaudeAgent, runClaudeCompletion) and the recording stub. Contract: the stub logs each invocation's argv and whole environment. The tests judge only that surface and the committed record.json, never internal helpers or call order.

### Test strategy

- a secure claude-code phase session launched by a run carries --setting-sources project in its argv and CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 in its environment — medium · example · the recording stub's captured argv and environment · acceptance · ac-phase-argv
- read-only, secure and unsafe sessions, a structured completion, headless authoring, handoff generation, headless review and compliance review each launch project-only — medium · table · the captured argv and environment of each launch kind · acceptance · ac-every-headless
- with CLAUDE_CODE_DISABLE_AUTO_MEMORY=0 in phax's environment a headless session still gets 1 — medium · example · the captured environment value · acceptance · ac-memory-wins
- a phase fix attempt, a decide handback and its corrective retry each resume with --resume and launch project-only — medium · example · the captured argv and environment of each resume · acceptance · ac-resume
- a claude-code phase record says userConfig excluded and a codex-cli phase record says loaded — medium · example · the two committed record.json files · acceptance · ac-record

### Implementation order

1. projectOnlyHarness.ts
2. ac-every-headless low-level kinds (runClaudeAgent, runClaudeCompletion), then the use-case kinds
3. ac-memory-wins
4. ac-phase-argv and ac-resume through executePlan and decide
5. ac-record
6. unmarked dry run of each test, markers restored

### Excluded scope

- Any source change: the switches and the record value are phase-03's.
- ac-env-kept, ac-interactive, ac-probe and ac-no-touch, which hold today and are phase-03's in-phase guards.
- ac-auth (phase-04) and the real-session criteria (phase-05).
- Editing tests/helpers/fakeProviderCli.ts.

### Verification

The `standard` gate profile in phax.json, with the `acceptance` provider judging the authored tests.

### Expected handoff content

The test titles per criterion and file. How each launch kind is driven (entry point and setup), so phase-03 knows which spawn each test reaches. The observed failure reason of each test without its marker. Any launch kind that could not be reached through a use case and was driven lower, with the reason. Any deviation from the planned file lists, with the reason.

### Commit subject

`test(claude): acceptance tests for project-only headless launches`

### Commit body

Expected-failure acceptance tests state the next phase's target. Every headless Claude Code launch kind, including a phase fix attempt and decide's handback and retry, carries --setting-sources project and CLAUDE_CODE_DISABLE_AUTO_MEMORY=1, phax's value overrides the operator's, and a claude-code phase record says userConfig excluded while a codex-cli one says loaded. The tests drive the real spawn against the recording stub.

---

## phase-03 — Headless Claude Code sessions launch project-only {#phase-03-project-only-launch}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

Every headless Claude Code session phax spawns carries `--setting-sources project` and runs with `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` added to the inherited environment. The usage probe and every interactive launch are unchanged, and claude-code phase records say `userConfig: "excluded"`.

### Detailed instructions

- src/domain/session/claudeProjectOnly.ts (new, pure): export `CLAUDE_PROJECT_ONLY_FLAGS = ["--setting-sources", "project"] as const`, plus `projectOnlyEnvironment(inherited: Readonly<Record<string, string | undefined>>): Record<string, string>`. The function returns a new object holding every defined inherited variable unchanged, with `CLAUDE_CODE_DISABLE_AUTO_MEMORY` set to `"1"` whatever it was, and never mutates its input. The doc comment names what each switch drops (user settings, skills, plugins, hooks, instructions; auto-memory) and what still loads (repository harness, bundled skills, builtin plugins, managed settings, MCP per the security policy).
- src/infra/providers/claudeCode.ts:
      - buildArgs: in both branches (read-only, and secure/unsafe), insert `...CLAUDE_PROJECT_ONLY_FLAGS` right after `--print --output-format stream-json --verbose`; `--resume <id>` stays last.
      - Split buildCompletionArgs into a private `sealedCompletionFlags(options, table)` (today's list). buildCompletionArgs returns `--print --output-format stream-json --verbose`, the project-only flags, then the rest. buildProbeArgs is built from the sealed core plus `--no-session-persistence --tools ""`, with no `--setting-sources`. Keep its comment that the user's settings still load for the apiKeyHelper.
      - spawnClaude takes a new required `env: Readonly<Record<string, string>> | undefined` parameter on all three overloads. A defined value is passed as the spawn's `env`; undefined spawns with the inherited environment as today. runClaudeAgent and runClaudeCompletion pass `projectOnlyEnvironment(process.env)`, and runClaudeProbe passes undefined.
      - Do not touch claudePermissionFlags, claudeReadOnlyFlags, src/domain/session/claude.ts or src/infra/session.ts: they serve interactive launches.
- src/domain/records/userConfig.ts: `userConfigOf("claude-code")` returns `"excluded"`; codex-cli and mistral-vibe stay `"loaded"`. Update its comment.
- Remove every `.fails` marker from tests/integration/projectOnlyLaunch.test.ts and tests/integration/userConfigRecord.test.ts; that is the only change allowed in them. Do not edit tests/helpers/projectOnlyHarness.ts. Every acceptance test must pass without editing it. If one cannot, stop and report it in the handoff; do not change the test.
- Existing tests whose expected argv now differs: tests/unit/providers/claudeCode.test.ts. Each buildArgs and buildCompletionArgs case expects `--setting-sources project` after `--verbose`, the probe case asserts it is absent, and it asserts that runClaudeAgent and runClaudeCompletion spawn with the memory switch while runClaudeProbe does not. Fix any other test or snapshot the suite names (the optional list) by adding the flag to its expectation, never by loosening the assertion.
- tests/unit/session/claudeProjectOnly.test.ts (new): a table of inherited environments. An empty one, one with unrelated variables, one with `CLAUDE_CODE_DISABLE_AUTO_MEMORY` set to `0`, `1`, `""` and `true`, and one with an undefined entry. For each, check the result's variables, that the memory switch is `1`, that undefined entries are dropped, and that the input object is unchanged.
- tests/unit/records/userConfig.test.ts (new): a table over every ProviderId: claude-code excluded, codex-cli loaded, mistral-vibe loaded. Update tests/integration/writeRecord.test.ts so the claude-code record expects `excluded` and the codex-cli one `loaded`.
- tests/integration/projectOnlyBoundaries.test.ts (new, in-phase guards for criteria that already hold), reusing tests/helpers/projectOnlyHarness.ts read-only:
      - `ac-env-kept`: with ANTHROPIC_API_KEY, CLAUDE_CONFIG_DIR (a temporary directory) and an unrelated variable stubbed on process.env, a headless session's captured environment holds all three with their values unchanged.
      - `ac-interactive`: `phax enter`'s resume, a stop's continue and fresh-start commands, and decide's interactive session, each driven through its use case with the fake Session port (src/infra/fakes/session.ts) recording `{ executable, args, env }`. Where a use case only prints a command, use its invocation builder in src/domain/session/claude.ts. No argv carries `--setting-sources`, and no env phax passes carries `CLAUDE_CODE_DISABLE_AUTO_MEMORY`.
      - `ac-probe`: runClaudeProbe against the recording stub, with the variable absent from the test's environment. The argv carries no `--setting-sources` and the captured environment has no `CLAUDE_CODE_DISABLE_AUTO_MEMORY`.
      - `ac-no-touch`: point CLAUDE_CONFIG_DIR at a temporary configuration root holding a settings.json, a CLAUDE.md, a rules file, a skill and a memory index. Snapshot every file's path, bytes and mtime, run a one-phase claude-code plan through executePlan on the stub, and check that the snapshot is identical. Exclude only the session transcripts the stub itself writes under its store. Also check that phax's only reads under the root are the transcript captures (captureClaudeTranscript), by asserting that the run's captured transcript paths are the only files under the root phax copied into the phase folder.
- Never read ~/.phax, a real HOME, real ~/.claude or the global git config.

### Planned files to create

- `src/domain/session/claudeProjectOnly.ts`
- `tests/unit/session/claudeProjectOnly.test.ts`
- `tests/unit/records/userConfig.test.ts`
- `tests/integration/projectOnlyBoundaries.test.ts`

### Planned files to edit

- `src/infra/providers/claudeCode.ts`
- `src/domain/records/userConfig.ts`
- `tests/integration/projectOnlyLaunch.test.ts`
- `tests/integration/userConfigRecord.test.ts`
- `tests/unit/providers/claudeCode.test.ts`
- `tests/integration/writeRecord.test.ts`

### Optional files that may be edited

- `tests/unit/sessionAdapters.test.ts`
- `tests/integration/structuredAnswerFlags.test.ts`
- `tests/integration/declaredStopProviderArgv.test.ts`
- `tests/integration/protectedPathsNativeRules.test.ts`
- `tests/integration/protectedPathsAdditive.test.ts`
- `tests/integration/agentCommandGrants.test.ts`
- `tests/integration/providerSessionFailures.test.ts`
- `tests/integration/__snapshots__/executePlan.test.ts.snap`
- `tests/integration/__snapshots__/protectedPathsAdditive.test.ts.snap`
- `tests/unit/recordsAssemble.test.ts`
- `tests/unit/architecturalGuards.test.ts`

### Boundary contracts

Producer: src/domain/session/claudeProjectOnly.ts. Consumer: src/infra/providers/claudeCode.ts. Contract: the project-only argv flags and `projectOnlyEnvironment(inherited)`, a pure function returning inherited plus the memory switch at 1. Producer: the claude-code adapter. Consumer: the `claude` process. Contract: every headless spawn (agent session, resume, completion) carries both switches, and the probe carries neither. Interactive launches go through the Session port and are not touched.

### Test strategy

- buildArgs in every mode and on resume, and buildCompletionArgs, carry --setting-sources project after --verbose, while buildProbeArgs does not — small · table · the expected argv per builder and mode · in-phase
- projectOnlyEnvironment keeps every defined inherited variable, sets the memory switch to 1 over any value and leaves its input unchanged — small · table · the expected environment per inherited case and the unchanged input · in-phase
- userConfigOf says excluded for claude-code and loaded for codex-cli and mistral-vibe — small · table · the expected value per provider · in-phase
- ANTHROPIC_API_KEY, CLAUDE_CONFIG_DIR and an unrelated variable reach a headless session unchanged — medium · example · the stubbed values against the captured environment · in-phase · ac-env-kept
- enter, a stop's continue and fresh-start commands and decide's interactive session launch without --setting-sources or a phax-set memory switch — medium · example · the fake Session port's recorded invocations · in-phase · ac-interactive
- the usage probe launches without --setting-sources and without a phax-set memory switch — medium · example · the recording stub's captured argv and environment · in-phase · ac-probe
- a run with one claude-code phase leaves the configuration root's files, bytes and mtimes identical — medium · example · the snapshot taken before the run · in-phase · ac-no-touch

### Implementation order

1. claudeProjectOnly.ts and its unit test
2. claudeCode.ts builders, the sealed core and spawnClaude's env parameter
3. userConfig.ts flip
4. remove the acceptance markers and run the acceptance tests
5. update the existing argv and record expectations
6. projectOnlyBoundaries.test.ts

### Excluded scope

- Recognising or wording a lost authentication (phase-04).
- Codex and Mistral Vibe isolation; their records stay loaded.
- Any change to interactive launches, the Session port or the shared permission flag sets.
- `--bare`, `--disable-slash-commands`, or forwarding any part of the user layer.
- Real-session e2e cases (phase-05).

### Verification

The `standard` gate profile in phax.json, with the `acceptance` provider judging the passed tests.

### Expected handoff content

The exports of src/domain/session/claudeProjectOnly.ts and spawnClaude's new signature. The exact argv position of the flag in each builder. Confirmation that every phase-02 acceptance test passes with only its marker removed, or the one that does not and why. The existing tests whose expectations changed. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(claude): launch headless sessions project-only`

### Commit body

Every headless Claude Code session, whether a phase session, a fix attempt, handoff, authoring, decide's handback, review, compliance review or a structured completion, now carries --setting-sources project and runs with CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 added to the environment phax inherited, so the operator's user settings, skills, plugins, hooks, instructions and auto-memory no longer load. The usage probe keeps the user's settings, and interactive launches are unchanged. Claude-code phase records now say userConfig excluded.

---

## phase-04 — A lost Claude Code authentication is named {#phase-04-auth-failure}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

A headless Claude Code session that ends because Claude Code is not authenticated fails as `not-authenticated`, with a message saying phax's headless sessions skip user settings and naming `claude /login` and `ANTHROPIC_API_KEY`. It is never paused, waited on or retried as a network or limit failure.

### Detailed instructions

- src/domain/session/claudeAuthentication.ts (new, pure): `CLAUDE_NOT_AUTHENTICATED_SIGNATURES`, the case-insensitive substrings `Invalid API key`, `Please run /login`, `OAuth token has expired`, `OAuth token revoked`, `Not logged in` and `authentication_error`. Also `isClaudeNotAuthenticatedText(text)`, which folds typographic apostrophes as signatures.ts does, and `NOT_AUTHENTICATED_REMEDY_LINES`, exactly two strings. The first is `Claude Code is not authenticated. phax's headless sessions do not load your Claude Code user settings (~/.claude/settings.json), so an apiKeyHelper or env set there is not used.` The second is ``Log in with `claude /login`, or set ANTHROPIC_API_KEY where you run phax.``
- src/domain/session/claudeOutcome.ts: in errorResultFailure, before classifyVerdictText, the kind is `not-authenticated` when any of these holds: the result text matches isClaudeNotAuthenticatedText, `apiErrorCategory === "authentication_failed"`, or `result.api_error_status === 401`. The message stays the result's own text, resetAt null. With no result event and an exited process, check stderr's first lines with isClaudeNotAuthenticatedText before failureWithoutVerdict; on a match, fail as `not-authenticated` with stderrMessage's text. The structured-retries subtype keeps its own path first. Update the module comments in claudeOutcome.ts and outcome.ts's reading-order comment.
- Leave signatures.ts's shared table, the Codex reader and the Vibe reader unchanged. Vibe's `invalid_api_key` code stays `provider-error`, and the remedy is Claude-specific.
- src/domain/session/failureError.ts: for kind `not-authenticated`, sessionFailureError still returns an AgentSessionFailedError. Its `message` is the failure line followed by the two remedy lines, each on its own line and indented two spaces. src/cli/commands/sessionFailureOutput.ts renderSessionFailure appends the two remedy lines, indented two spaces, right after the `✗` failure line, when the failure's kind is `not-authenticated`.
- Check that no path retries the kind: isTransientFailure stays false, the network pause and rate-limit handling in src/app/executePlan.ts, fixLoop.ts and handoffGeneration.ts key on `network`, `rate-limit` and `usage-limit` only, and a phase failing on it ends the way a `provider-error` session failure does today. Fix any site that would treat it otherwise.
- tests/unit/session/claudeAuthentication.test.ts (new): a table of Claude error results. Each signature wording as result text, the `authentication_failed` synthetic message category, `api_error_status: 401`, and stderr-only `Invalid API key · Please run /login` each read as `not-authenticated` with the provider's text as message. A rate-limit text with 429, a usage-limit text, a network text (`Unable to connect to API (ECONNREFUSED)`) and an unrelated error read as before. Add a case that Vibe's `invalid_api_key` export still reads as `provider-error` and that Codex is unchanged.
- tests/unit/failureError.test.ts (or the existing test of sessionFailureError and renderSessionFailure): a not-authenticated failure gives an AgentSessionFailedError whose message holds the failure line and both remedy lines, and renderSessionFailure prints the `✗` line, then the two remedy lines, then the pointer line.
- tests/integration/claudeAuthFailure.test.ts (new), `describe("ac-auth")`: script the recording stub (tests/helpers/fakeProviderCli.ts) with a raw `stream`: an init event, an assistant synthetic message with `error: "authentication_failed"`, `is_api_error_message: true` and text `Invalid API key · Please run /login`, then a result with `is_error: true` and that result text, ending with exit code 1. Run a one-phase claude-code plan through executePlan. Assert the phase fails with an AgentSessionFailedError whose failure kind is `not-authenticated` and whose message names the authentication failure, says phax's headless sessions do not load Claude Code user settings, and names `claude /login` and `ANTHROPIC_API_KEY`. Assert the run did not pause as `rate_limited` or on the network, wrote no network resume instructions, and that the stub saw exactly one claude invocation, so no retry or fix attempt resumed the session. Add one decide case: a decide whose handback fails this way writes a decision record with failure `not-authenticated`.
- Never read ~/.phax, a real HOME, real ~/.claude or the global git config.

### Planned files to create

- `src/domain/session/claudeAuthentication.ts`
- `tests/unit/session/claudeAuthentication.test.ts`
- `tests/integration/claudeAuthFailure.test.ts`

### Planned files to edit

- `src/domain/session/claudeOutcome.ts`
- `src/domain/session/outcome.ts`
- `src/domain/session/failureError.ts`
- `src/cli/commands/sessionFailureOutput.ts`

### Optional files that may be edited

- `src/app/executePlan.ts`
- `src/app/fixLoop.ts`
- `src/app/handoffGeneration.ts`
- `src/app/decideFailure.ts`
- `src/domain/whatsNext.ts`
- `src/app/telemetry/reportBuilders.ts`
- `src/schemas/claudeOutput.ts`
- `tests/unit/failureError.test.ts`
- `tests/unit/session/outcome.test.ts`
- `tests/unit/session/claudeOutcome.test.ts`
- `tests/unit/cli/sessionFailureOutput.test.ts`
- `tests/integration/sessionFailureReport.test.ts`
- `tests/integration/providerSessionFailures.test.ts`
- `tests/integration/decideArtifact.test.ts`

### Boundary contracts

Producer: the Claude reader (readClaudeOutcome). Consumers: the Claude adapter, sessionFailureError, the run's pause logic, decide's failure mapping, the CLI's failure rendering. Contract: SessionFailure with kind `not-authenticated` and the provider's text as message, which is not transient. Producer: src/domain/session/claudeAuthentication.ts. Consumers: failureError.ts and sessionFailureOutput.ts. Contract: the two remedy lines, worded once.

### Test strategy

- each Claude not-authenticated wording, the authentication_failed category, status 401 and a stderr-only verdict read as not-authenticated, while limit, network and other verdicts read as before — small · table · the expected failure kind and message per verdict · in-phase
- Vibe's invalid_api_key and Codex failures keep their kinds — small · example · the kinds today's readers give · in-phase
- a not-authenticated failure raises an AgentSessionFailedError whose message and rendering carry both remedy lines after the failure line — small · example · the expected message and rendered lines · in-phase
- a run whose claude-code phase session is refused as not authenticated fails with the named cause and remedies, is not paused or retried, and spawns claude once — medium · example · the raised error, the run state and the stub's invocation count · in-phase · ac-auth
- a decide whose handback is refused as not authenticated records failure not-authenticated — medium · example · the written decision record · in-phase

### Implementation order

1. claudeAuthentication.ts and its table test
2. claudeOutcome.ts recognition
3. failureError.ts and sessionFailureOutput.ts wording
4. check the pause and retry paths
5. claudeAuthFailure.test.ts

### Excluded scope

- A preflight authentication probe, or any fallback or opt-out that loads user settings (q-auth, q-opt-out).
- Recognising lost authentication for Codex or Mistral Vibe.
- Widening the interactive-session first-turn reason set.
- Reading the operator's Claude Code configuration to explain the cause.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

The exports of src/domain/session/claudeAuthentication.ts, the exact remedy lines, the order of checks in errorResultFailure, and the rendered output of a not-authenticated failure. Confirmation that no pause or retry path matches the kind, naming each site checked. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(claude): name a lost authentication in headless sessions`

### Commit body

A Claude Code session that ends not authenticated (Invalid API key, Please run /login, an expired or revoked OAuth token, an authentication_failed API error or a 401) now fails as not-authenticated. The failure says phax's headless sessions do not load Claude Code user settings, and names claude /login and ANTHROPIC_API_KEY as the remedies. The kind is not transient, so no run pauses on it or retries it as a network or limit failure. Codex and Mistral Vibe readers are unchanged.

---

## phase-05 — Real-session e2e cases under project-only sources {#phase-05-real-sessions}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** A real-session fixture no existing test builds (a planted user layer with a control run, canaries and a hook marker) against an external CLI whose loading behaviour is only partly probed, and which the phase cannot run to check itself.

The deliberate e2e tier proves on a real, installed Claude Code that a project-only session does not see a planted user layer and still authenticates and answers, that a granted skill edit still lands while an ungranted `.claude/` edit is denied, and that a protected path stays denied. The gate never runs these cases.

### Detailed instructions

- tests/e2e/projectOnlySession.test.ts (new), `describe("ac-real-init")`, opt-in like tests/e2e/realFlow.test.ts: `describe.skipIf(!shouldRun)` with `PHAX_E2E_RUN === "1"`, `probeProvider("claude")`, and `PHAX_E2E_CLAUDE_CONFIG_DIR` set (open question q-e2e-user-layer, recommended dedicated-config-dir). The file's header comment explains how to prepare that directory once: `CLAUDE_CONFIG_DIR=<dir> claude /login`, or rely on ANTHROPIC_API_KEY. It also says the case never writes to ~/.claude.
- tests/e2e/helpers/userLayer.ts (new): plant the user layer in the dedicated directory under names unique to the run (a random suffix fixed at the start of the case), and remove every planted file in afterAll:
      - a user skill `<dir>/skills/phax-e2e-<id>/SKILL.md`;
      - a rules file `<dir>/rules/phax-e2e-<id>.md` and a `<dir>/CLAUDE.md` section, each holding a distinct canary instruction (if asked for the rules canary, or for the CLAUDE.md canary, answer with its word);
      - a `SessionEnd` hook in `<dir>/settings.json` that touches a marker file in the temporary repository;
      - a non-builtin plugin through a local directory marketplace declared in that settings.json (extraKnownMarketplaces with a directory source, plus enabledPlugins);
      - an auto-memory index `<dir>/projects/<slug of the temporary repo>/memory/MEMORY.md` with a canary line.
      Keep a copy of settings.json and CLAUDE.md before planting and restore them exactly after.
- The case creates a temporary git repository with one committed `.claude/skills/repo-skill/SKILL.md`. With CLAUDE_CONFIG_DIR set to the dedicated directory for the case's duration (vi.stubEnv), it runs two sessions with the same prompt asking for the three canaries, or NONE for each. The control session uses today's launch, buildArgs output with `--setting-sources project` removed and the inherited environment without the memory switch. The project-only session goes through runClaudeAgent (secure, worktree writable), the way phax launches it. Read the init event of each from stream-json.
- Control assertions prove the fixture works. The init event lists the user skill and the plugin, the answer names the canaries, and the hook marker exists. If any planted item does not show in the control, the case fails with a message naming that item, never passing silently. Project-only assertions: the init event lists `repo-skill` and no `phax-e2e-<id>` skill, no non-builtin plugin, and no memory canary. The answer names no rules or memory canary, the hook marker is absent, and the session's result is a success, so it authenticated and answered. The CLAUDE.md canary is asserted absent too. If it appears, the failure message says user CLAUDE.md still loads under project-only sources, so the operator can report it (spec §10).
- tests/e2e/claudeSkillEditGrant.test.ts: rename the describe to name ac-skill-grant. Assert the buildArgs output carries `--setting-sources project`, and spawn with `env: projectOnlyEnvironment(process.env)` from src/domain/session/claudeProjectOnly.ts, so the grant is proven under the real launch. Keep every existing assertion: the granted file is edited and the new one created, the ungranted sibling is unchanged, and its denial is in the trace.
- tests/e2e/claudeProtectedPaths.test.ts: the same for ac-protected-path. Name the criterion in the describe, assert the argv flag, spawn with projectOnlyEnvironment, and keep the denial assertions as they are.
- These cases must not run in the gate: the gate's `pnpm test` (vitest.config.ts) includes only tests/unit and tests/integration, and tests/e2e runs only through `pnpm test:e2e:real`. Do not run `pnpm test:e2e:real` in this phase. It needs an installed, authenticated Claude Code and network access that a phase worktree does not have. The gate typechecks the files through `pnpm test:type`.
- Never write to ~/.claude, ~/.phax or the global git config, and never copy, read or print a credential.

### Planned files to create

- `tests/e2e/projectOnlySession.test.ts`
- `tests/e2e/helpers/userLayer.ts`

### Planned files to edit

- `tests/e2e/claudeSkillEditGrant.test.ts`
- `tests/e2e/claudeProtectedPaths.test.ts`

### Optional files that may be edited

- `tests/e2e/helpers/providers.ts`
- `tests/e2e/helpers/tempEnv.ts`
- `vitest.e2e.config.ts`

### Boundary contracts

Consumer: the e2e cases. Producers: runClaudeAgent and buildArgs (src/infra/providers/claudeCode.ts), projectOnlyEnvironment (src/domain/session/claudeProjectOnly.ts) and a real `claude`. Contract: a project-only launch is the argv phax builds plus the environment projectOnlyEnvironment returns, and Claude Code's init event and stream-json result are what is judged.

### Test strategy

- a project-only real session lists only the repository's and bundled skills, no non-builtin plugin, no auto-memory, no user rule or CLAUDE.md canary, fires no user hook and still answers — large · smoke · the init event, the answer and the hook marker, against a control run that shows every planted item · in-phase · ac-real-init
- under the project-only launch a granted skill file is edited and created while an ungranted .claude file is denied — large · smoke · the files on disk and the permission-denied trace · in-phase · ac-skill-grant
- under the project-only launch an edit of a protected path is denied — large · smoke · the unchanged file and the denial in the trace · in-phase · ac-protected-path

### Implementation order

1. userLayer.ts planting and restoring
2. projectOnlySession.test.ts control and project-only runs
3. the two existing e2e cases under the project-only launch

### Excluded scope

- Running the e2e tier in the gate or in this phase.
- Planting anything in the operator's real ~/.claude.
- A harness manifest of what each session loaded (a separate spec).
- Codex or Vibe real-session cases.

### Verification

The `standard` gate profile in phax.json, which typechecks the e2e files through `pnpm test:type`; the cases themselves run only through `pnpm test:e2e:real` with PHAX_E2E_RUN=1, by the operator.

### Expected handoff content

How to prepare PHAX_E2E_CLAUDE_CONFIG_DIR and the exact command to run the three cases. What each case asserts in its control and project-only runs. A note that the cases were not run in the phase and that the operator must report, in the pull request, whether user CLAUDE.md stays out. Any deviation from the planned file lists, with the reason.

### Commit subject

`test(e2e): real Claude Code sessions under project-only sources`

### Commit body

A deliberate e2e case plants a user skill, plugin, rules file, CLAUDE.md, SessionEnd hook and auto-memory index in a dedicated Claude Code configuration directory. A control run without the switches shows each one, and a project-only session shows none while it still authenticates and answers. The skill-edit grant and protected-path cases now run under the project-only launch. None of them runs in the gate.

---

## phase-06 — What a Claude Code session loads {#phase-06-security-docs}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

docs/security.md tells an operator which parts of their Claude Code setup a phax session sees, headless or interactive, how the launch looks, what the record says and what to do when authentication lived in user settings. docs/upgrading.md names the change for 0.34.0.

### Detailed instructions

- docs/security.md: add a section `What a Claude Code session loads` under `### Provider-Specific Behavior`, for the reader §11 names: an operator with their own skills, plugins, hooks, rules and memory, and a maintainer comparing records across people.
- Open the section with a two-row table, headless and interactive. Its columns are repository harness (CLAUDE.md, .claude/skills, .claude/rules, .claude/settings.json), user skills and plugins, user hooks, user rules and CLAUDE.md, auto-memory, and bundled skills. Headless loads the repository harness and bundled skills only; interactive loads everything. Say which sessions are headless (phase sessions and fix attempts, handoff, headless authoring, decide's headless handback and retry, headless and compliance review, an interactive phase's first turn, structured completions), which are interactive (`phax enter`, a stop's continue and fresh-start commands, decide's interactive session, interactive review), and that the usage probe keeps the user's settings for their authentication.
- Then show the argv of a secure phase session with `--setting-sources project`, and its environment line `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, added to the environment phax runs in, which is otherwise passed unchanged. List what still loads: Claude Code's bundled skills, the builtin cc-plugin-* plugins, managed (organisation) settings, and MCP servers as the security policy's `mcp` settings decide. Under `provider-default`, user-scope servers no longer load. Then show the `"userConfig": "excluded"` line of a claude-code record.json, saying codex-cli and mistral-vibe records say `loaded`.
- Then show the authentication failure an apiKeyHelper or env-in-settings user sees, exactly as phax prints it: the `✗ claude-code session failed (not-authenticated): Invalid API key · Please run /login` line and the two remedy lines. Name the two remedies, `claude /login` or ANTHROPIC_API_KEY in the environment phax runs in. Say phax has no opt-out and that a setting needed in headless sessions belongs in the repository's committed `.claude/settings.json`.
- Fix the rest of docs/security.md so it no longer implies the user layer loads in headless sessions, keeping the `Never read: a provider's credentials or configuration` line true: phax reads only session transcripts.
- docs/upgrading.md: add a 0.34.0 entry in the page's existing style. Headless Claude Code sessions no longer load user settings, skills, plugins, hooks, instructions or auto-memory. An operator authenticating through user settings (apiKeyHelper, an env block, Bedrock or Vertex set there) must run `claude /login` or set ANTHROPIC_API_KEY. Phase records carry `userConfig`. Link to the new security section.
- Follow the existing pages' tone and heading levels. Do not edit any other docs page, the README, the site sources or a skill.

### Planned files to create

- (none)

### Planned files to edit

- `docs/security.md`
- `docs/upgrading.md`

### Optional files that may be edited

- (none)

### Test strategy

- (none)

### Implementation order

1. the new section in docs/security.md
2. the surrounding security.md corrections
3. the docs/upgrading.md entry

### Excluded scope

- README, site sources, skills and other docs pages.
- Documenting Codex or Mistral Vibe isolation, which is not designed yet.
- Release notes, which come from the spec at release cut.

### Verification

The `standard` gate profile in phax.json; its terminal `pnpm site:build` builds the docs site with the edited pages.

### Expected handoff content

The new section's heading and anchor, the exact failure output quoted, every other passage of docs/security.md that was corrected, and the upgrading entry's heading. Any deviation from the planned file lists, with the reason.

### Commit subject

`docs(security): what a Claude Code session loads`

### Commit body

docs/security.md gains a section on what a Claude Code session loads. Headless sessions load the repository's harness and Claude Code's bundled skills only, while interactive sessions keep the person's setup. The section shows the project-only argv and environment, the userConfig line of a phase record, and the authentication failure an apiKeyHelper user sees with its two remedies. docs/upgrading.md names the change for 0.34.0.
