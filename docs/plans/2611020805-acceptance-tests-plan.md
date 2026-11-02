---
status: Draft
source-spec: docs/specs/2610271119-acceptance-tests.md
completes-spec: false
---
# Acceptance lint and config

Second of the four plans of the spec acceptance-tests: lint, CLI and config refusals. Plan 1, the formats, merged as #177. After this run, a plan declares an acceptance pair with `**Acceptance phase:** yes | passed by phase-NN` and `**Acceptance test files:**`. Lint checks them under the `acceptance` check, and the `tests` check's loop messages say acceptance. The provider is configured under `acceptance` in phax.json, phax.local.json and ~/.phax/config.json, and in the editor schemas. The CLI words are `--hold acceptance` and `--skip-acceptance`, the run preflight check is `acceptance-phases`, and its refusal reads "Acceptance preflight failed" (exit 11 unchanged). Every old spelling is refused with the spec's §10 wording, word for word: the `**Oracle phase:**` and `**Oracle files:**` lines, the test-line loop `oracle`, the `oracles` key, `--hold oracle` and `--skip-oracle`. The plan covers ac-header, ac-header-rules, ac-header-old, ac-loop-rules, ac-loop-old, ac-provider, ac-request-authored, ac-provider-missing, ac-provider-old, ac-hold, ac-hold-old, ac-skip and ac-skip-old. Plans 1, 3 and 4 cover the other criteria; `phax plans lint` reports those as uncovered warnings.

Order: phase-01 renames the configuration key and the two CLI words, with their refusals, so the provider is configured under `acceptance` from then on. Then one acceptance pair for the plan side, whose refusal messages are normative and stable. phase-02 writes the acceptance tests, marked expected-to-fail, and phase-03 passes them: it switches the header-line reader and renderer in one commit, renames the lint check, rewords the loop messages, refuses the old loop by name, and renames the preflight. Every commit is green under the `standard` gate profile.

The installed phax 0.32.0 drives this run. It reads the main checkout's phax.json, including the `oracles` key and its `node examples/vitest-oracles/main.mjs` command, which keeps receiving the `oracle-request` 0.32.0 writes and judges this plan's acceptance pair. It also lints and extracts this plan in today's words. So this plan's own pair is declared with the 0.32.0 header lines, and its test lines use the loop word `oracle`. The dev build's lint flags those lines as departures, as expected. No phase edits phax.json, knip.json, examples/vitest-oracles, a skill, or the live docs/specs and docs/plans sidecars. Plan 4 renames the first three, and the operator migrates the sidecars after the release. No phase edits a skill, so the run needs no --allow-skill-edits.

No interactive phase is declared. phase-01 follows the existing patterns, the project-only-key refusal and the hold grammar, and the pair's tests are judged by the acceptance provider. The operator can still hold any phase with `phax run --hold`.

## Required commands

- `pnpm gen:usage-spec`
- `pnpm docs:cli`
- `pnpm exec tsx`

`pnpm gen:usage-spec` regenerates phax.usage.kdl from the Commander tree and cliDocs.ts. `pnpm docs:cli` regenerates docs/cli/reference.md and the README's generated CLI block. `pnpm exec tsx` writes the editor schemas phax.schema.json and phax.user.schema.json from the code. All three are already in `security.agentCommands` of phax.json, so the plan needs no phax.json change.

## Technical arbitrations

- The config refusal is one raw-key check per layer in src/app/loadConfig.ts, run before the decode. For phax.json it runs right after the JSON parse. For phax.local.json and ~/.phax/config.json it runs in readUserOverlay, before the project-only-key check. Each layer is checked on its own, so the refusal names the file at fault. The message is `<path>: "oracles" is no longer read: write "acceptance"`, where <path> is the path loadConfig read (absolute, ending phax.json, phax.local.json or .phax/config.json), and ConfigValidationError's `path` is that same path. Each command keeps the exit code it already returns for an invalid configuration (validate, run and plans lint 2; resume 1). Loss accepted: the refusal lives in loadConfig, beside the protected-paths and project-only-key refusals, not in the schema, and it prints the absolute path where §6 shows `phax.json:`. Rejected: a schema field `oracles` that always fails. That gives up dropping `oracles` from the generated editor schemas, which would keep documenting the key.
- `--hold oracle` is refused in src/domain/hold.ts's parseHoldValue, alone or in a list, with `--hold 'oracle' is no longer read: write --hold acceptance`. runRun reads the hold before the config, so it exits 1, the code of every hold refusal, and names no run. `--skip-oracle` stays registered on `phax resume` as a hidden Commander option (`new Option("--skip-oracle").hideHelp()`), and runResume refuses it as its first statement, before the config, the run status or the lock: `--skip-oracle is no longer read: write --skip-acceptance`, exit 1, the code it returns for an invalid --provider-priority. The run's status is untouched. src/cli/introspect.ts and scripts/generate-usage-spec.ts skip only the options a shared constant names as retired (`RETIRED_OPTIONS`, holding `--skip-oracle`), so the usage contract, completions and the CLI reference never list it, and any other hidden option still fails the parity check. Loss accepted: one more constant, emptied when the refusal goes. Rejected (operator, 2026-11-02): skipping every hidden option, which gives up the parity guarantee for any hidden flag added later. Rejected: Commander's own unknown-option error, which gives up the spec's normative message. Also rejected: an argv pre-scan in program.ts, which moves one command's argument rule out of its register file.
- Spellings switch now, words wait. This plan switches every spelling an operator types, wherever a message, help text or recovery step names it: `--skip-acceptance` and `--hold acceptance`, the config key `"acceptance"`, the header labels `**Acceptance phase:**` and `**Acceptance test files:**`, and the loop word `acceptance`. That covers whatWhatsNext's commands, resumeInstructions, resetPhaseRefusal, the `--skip-…:` prefix of oraclePairs.ts's two refusals, and cliDocs.ts. Prose words like "oracle step", "discharging phase" and "oracle file" in those texts stay until plan 3. Loss accepted: this plan touches plan 3's files for spellings only, and until plan 3 some messages put a new spelling beside old words. Rejected: leaving recovery texts on `--skip-oracle`. That gives up a working recovery: the command a message names would be refused.
- Names this plan renames:
    - phase-01 renames OraclesConfigSchema/OraclesConfig → AcceptanceConfigSchema/AcceptanceConfig, the config key and ResolvedConfig field `oracles` → `acceptance`, HoldRequest kind `oracle` → `acceptance`, and the executePlan option `skipOracle` → `skipAcceptance`, with ResumeCommandOptions gaining `skipAcceptance` (its `skipOracle` stays only to be refused).
    - phase-03 renames src/domain/plan/oracleCheck.ts → src/domain/plan/acceptanceCheck.ts (oracleFindings → acceptanceFindings, OracleCheckInput/OracleCheckPhase → AcceptanceCheckInput/AcceptanceCheckPhase), tests/unit/oracleCheck.test.ts → tests/unit/acceptanceCheck.test.ts, and the lint check `oracles` → `acceptance`. In phaseHeader.ts it renames oraclePhase/oracleFiles → acceptancePhase/acceptanceFiles, oracleDeclaration/OracleDeclaration.dischargedBy → acceptanceDeclaration/AcceptanceDeclaration.passedBy, and DISCHARGED_BY_RE → PASSED_BY_RE. It also renames TestLineCheckPhase.oracle → acceptance, OraclePreflightError → AcceptancePreflightError, and the preflight check id `oracle-phases` → `acceptance-phases`.

    These keep "oracle" until plan 3, and a reviewer should not flag them:
    - src/domain/plan/oraclePairs.ts with its functions, prose and `## Oracle pairs`;
    - closeStop's input field `oracles` and its messages;
    - the authoring prompt's provider lines and its `oraclesProvider` parameter;
    - the `## Oracle role` prompt and the fix prompt;
    - whatsNext's and resumeInstructions' prose;
    - the internal failedStep value `oracle` and `oracle.edits.unjudged`;
    - the overview's `oracleRole` and `oracle role` row, and records explain's `oracle` row;
    - OracleCommitMissingError, oracleStepFor and ORACLE_PROVIDER_TIMEOUT_MS in executePlan.ts;
    - the prose of cliDocs.ts and phax.usage.kdl beyond the spellings above.

    These keep it until plan 4: the skills, README prose outside its generated block (it still names `--skip-oracle` and `oracles`), docs/oracle-phases.md and the other docs pages, the site, examples/vitest-oracles (its verdicts.mjs remedy still names `--skip-oracle`, and tests/integration/vitestOraclesExample.test.ts still expects it), phax.json and knip.json.
- Order and the pair. phase-01 (configuration and CLI words) goes first, so the pair's tests configure the provider under `acceptance`, and lint and the preflight read `config.acceptance` before phase-02 freezes them. The plan side gets the acceptance pair. Its entries (lintPlan, runPreflights, loadOrExtractPlan) exist today with stable signatures, and every refusal they must produce is quoted by the spec. phase-01 is not in a pair. Its typed entries change shape (ResolvedConfig, HoldRequest, ResumeCommandOptions), and the `--skip-acceptance` path is reached only through the resume harness's module mocks, which a frozen copy would have to duplicate whole. Loss accepted: the config and CLI refusals are tested in-phase, by the phase that writes them. Rejected: one pair over the whole plan. Its passing phase would carry the config, the CLI and the plan side with all their fixtures in one commit, too large to review.
- The header-line reader (src/domain/plan/phaseHeader.ts) and the renderer (src/domain/authoring/renderPlan.ts) switch together in phase-03, since the render-then-parse round trip forbids splitting them. The frozen renderers renderPlanV0_26_0.ts and renderPlanV0_32_0.ts keep their old lines, so migrate-documents still tells an unedited 0.28.0 or 0.32.0 body from an edited one. A migrated sidecar is re-rendered by the current renderer, so its plan.md now reads `**Acceptance phase:** passed by phase-NN`, which completes ac-migrate's header half, left open by plan 1.
- Old header labels are read like `**Model reason:**`: `Oracle phase` and `Oracle files` are recognized anywhere in a phase, emphasis or not, and never declare anything. Each one present gives one `acceptance` error per phase, before the malformed-line rows: `**Oracle phase:** is no longer read: write **Acceptance phase:**` and `**Oracle files:** is no longer read: write **Acceptance test files:**`. The `acceptance-phases` preflight reports exactly what lint's `acceptance` check reports, so `phax run` and `phax resume` exit 11 with "Acceptance preflight failed" listing both. A phase holding only old lines declares no pair, so it earns no provider row and no pairing row.
- The old loop is recognized by the grammar, not by an alias. TestLineDeparture gains a required `kind: "format" | "retired-loop"`. When a line read with today's loops departs, but reads under the pre-0.33.0 loops (TestLineReadOptions.beforeAcceptance), it departs as `retired-loop`, and departureMessage gives `test line <n> uses the loop 'oracle', which is no longer read: write 'acceptance'`. The rule lives in readTestStrategyText, so every place that refuses a departing line names it: lint's `tests` check, the deterministic extraction, and loadOrExtractPlan's refusal before the cache and any model call. A section read with beforeAcceptance never yields `retired-loop`. Loss accepted: a line that holds `oracle` and another defect is a plain departure.
- This repository during the run. No phase changes phax.json, knip.json or examples/vitest-oracles. tests/integration/vitestOraclesExample.test.ts ("phax's own oracles declaration") reads the `oracles` command from the raw JSON of this repository's phax.json, not through decodePhaxConfig, until plan 4. Loss accepted: until then, no test proves this repository's phax.json loads under the phax being built. The committed editor schemas lose `oracles` and gain `acceptance`, as tests/unit/phaxConfigJsonSchema.test.ts requires, so an editor flags this repository's phax.json until plan 4. Loss accepted. The live spec and plan sidecars are not migrated.
- EXTRACTOR_VERSION stays at 5, as plan 1 set it to the spec's number. Loss accepted: an extraction cached by a dev build between plan 1 and this plan, of a plan.md already holding `**Acceptance phase:**` lines, could be reused. Runs use the released phax, which never wrote one.

---

## phase-01 — Acceptance provider key, --hold acceptance and --skip-acceptance {#phase-01-config-and-cli}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** Renames the configuration key across three layers, two editor schemas and every reader, and two CLI words with their refusals, a retired-option rule in the usage contract and regenerated docs: many sites across the schemas, domain, app and cli layers.

The provider that judges acceptance pairs is configured under `acceptance` in phax.json, phax.local.json, ~/.phax/config.json and the editor schemas, and an `oracles` key is refused, naming its file. `phax run --hold acceptance` holds every acceptance phase, `phax resume --skip-acceptance` skips the acceptance step, and `--hold oracle` and `--skip-oracle` are refused with the new spelling named.

### Detailed instructions

- src/schemas/phaxConfig.ts:
    - Rename OraclesConfigSchema/OraclesConfig to AcceptanceConfigSchema/AcceptanceConfig.
    - In PhaxConfigSchema and PhaxUserOverlaySchema, the key `oracles` becomes `acceptance`, in the same position.
    - ResolvedConfig's `oracles?` becomes `acceptance?: AcceptanceConfig`.
    - The command's description becomes exactly: 'The acceptance provider command. The string is split on whitespace with no shell — use a wrapper script for paths with spaces or pipelines. At the gate of an acceptance phase or its passing phase only, phax writes an acceptance request {"$schema": "https://docs.phax.run/schemas/acceptance-request/<release>.json", "verdict", "phase", "acceptancePhase", "base", "files"} (plus "acceptanceCommit" on a "passed" request) to its stdin, and judges the gate report the provider prints on stdout exactly like an `output: "gate-report"` step, with a fixed 120 s limit. `phax plans lint`, `phax validate`, the run preflight and authoring never run it. Full contract: `phax --usage`, cmd run.'
    - The key's description in both schemas becomes: "The acceptance provider: a command that judges the acceptance tests an acceptance phase writes and its passing phase passes."
- src/domain/config/mergeLayers.ts merges `acceptance` exactly as it merged `oracles` (scalar override of `command`, local over global over project). src/app/loadConfig.ts sets `acceptance` on ResolvedConfig.
- src/app/loadConfig.ts adds the refusal:
    - A helper takes a raw parsed value and its file path. When the value is an object owning the key `oracles`, it returns a ConfigValidationError with message `${filePath}: "oracles" is no longer read: write "acceptance"` and `path: filePath`.
    - Call it on phax.json right after its JSON parse, before the name check, and in readUserOverlay right after the parse, before the PROJECT_ONLY_KEYS loop. A layer is refused even when its block is malformed.
    - filePath is the path loadConfig read: configPath, the phax.local.json path, or join(homedir(), ".phax", "config.json").
- Readers of the config: src/app/lintPlan.ts and src/app/runPreflight.ts compute `providerConfigured` from `config.acceptance`. src/app/executePlan.ts reads `config.acceptance` for the step's command, and passes `oracles: config.acceptance ?? null` to closeStop: CloseStopInput keeps its field name until plan 3. src/cli/commands/artifact.ts passes `oraclesProvider: config.acceptance !== undefined`, a parameter that keeps its name until plan 3. Fix any other site the compiler names. Keep every message: "Oracle preflight failed", the oracles check and its rows are phase-03's.
- Editor schemas: write phax.schema.json and phax.user.schema.json from the code with `pnpm exec tsx -e` (JSON.stringify of getPhaxConfigJsonSchema() and getPhaxUserOverlayJsonSchema(), two-space indent, trailing newline), then let `pnpm format` format them. Do not run `phax schema upgrade` or `pnpm dev`: they load this repository's phax.json, which still says `oracles`. tests/unit/phaxConfigJsonSchema.test.ts must find them equal to the generated ones.
- src/domain/hold.ts:
    - HoldRequest's kind `oracle` becomes `acceptance`.
    - parseHoldValue reads `acceptance` alone as `{ kind: "acceptance" }`.
    - A value whose comma-separated items include `oracle`, alone or in a list, is refused with exactly `--hold 'oracle' is no longer read: write --hold acceptance`, before every other rule.
    - `acceptance` in a list is refused with `--hold '<value>' is not a hold selection: acceptance stands alone`.
    - The generic refusal says `give no value, acceptance, or phase ids such as phase-02,phase-04`.
    - The empty selection says `--hold acceptance selects no phase: the plan declares no acceptance phase`.
    - resolveHold records `request.kind` directly. Drop the comment that maps the CLI word.

    src/cli/program.ts: the `--hold [selection]` help says `acceptance` where it says `oracle`. runRun already reads the hold before the config and returns 1.
- src/cli/commands/resumeRegister.ts:
    - Register `--skip-acceptance` with the help "Skip the acceptance step of the phase this resume restarts at; its configured gate still runs".
    - Keep `--skip-oracle` as a hidden option (`.addOption(new Option("--skip-oracle").hideHelp())`), forwarded as `skipOracle`.

    src/cli/commands/resume.ts:
    - ResumeCommandOptions gains `skipAcceptance?: boolean`. A comment on `skipOracle?` says it is read only to be refused.
    - runResume's first statement: when `opts.skipOracle === true`, `out.error("--skip-oracle is no longer read: write --skip-acceptance")` and return 1.
    - Everything that read `skipOracle` reads `skipAcceptance`.
    - The preview line is exactly `  Skipping the acceptance step of ${id} (--skip-acceptance); its configured gate still runs.`
    - The re-exec argv forwards `--skip-acceptance`.
    - executePlan's option `skipOracle` becomes `skipAcceptance`.
- Add an exported `RETIRED_OPTIONS` constant (in src/cli/introspect.ts, or a module both it and scripts/generate-usage-spec.ts may import under the layer rules), holding `--skip-oracle` with a comment that it lists only flags kept registered to be refused by name. src/cli/introspect.ts skips exactly the options it names, and scripts/generate-usage-spec.ts skips them when it emits flags, so the parity check and the usage contract agree. Any other hidden option is still walked and still fails the parity check when undocumented. Update their comments.
- Switch the flag and hold spellings, and only the spellings:
    - whatsNext.ts's recovery command;
    - resumeInstructions.ts's two `--skip-oracle` mentions;
    - resetPhaseRefusal.ts's two recovery sentences;
    - the `--skip-oracle:` prefix of oraclePairs.ts's two refusals;
    - the doc comments in src/app/gates.ts and src/schemas/gateAttribution.ts;
    - src/cli/cliDocs.ts's resume and run texts and its example `phax resume refunds --yes --skip-acceptance`, plus its mentions of `--hold oracle`, `--skip-oracle` and the config key `"oracles"`.

    Every other word in those texts stays (plan 3). Then run `pnpm gen:usage-spec` and `pnpm docs:cli`, which rewrite phax.usage.kdl, docs/cli/reference.md and the README's generated block.
- docs/upgrading.md, 0.33.0 entry. Add two bullets before the migrate-documents bullet:
    - **Configuration: the `oracles` key is `acceptance`.** It applies in phax.json, phax.local.json and ~/.phax/config.json. A layer that still carries `oracles` is refused with `<file>: "oracles" is no longer read: write "acceptance"`. Run `phax schema upgrade` to refresh the editor schemas.
    - **Command line: `--hold acceptance` and `--skip-acceptance`.** They replace `--hold oracle` and `--skip-oracle`, refused with `--hold 'oracle' is no longer read: write --hold acceptance` and `--skip-oracle is no longer read: write --skip-acceptance`.

    Change the closing line to: "The hand-written plan and provider steps of this release are listed here when they ship."
- Tests, keeping each scenario:
    - Every fixture that configures `oracles` (in a raw phax.json or a ResolvedConfig cast) configures `acceptance`: tests/integration/helpers/preflightRepo.ts, tests/helpers/heldRunFixture.ts, holdCli, runPreflightBeforeNaming, resumePreflightRechecks, oraclePhases, oraclePairReview, lintPlan, lintTestLines, runPreflight, mergeLayers and validate.
    - Every caller passing `skipOracle` to executePlan passes `skipAcceptance`.
    - Every expected `--skip-oracle` in a recovery or refusal text expects `--skip-acceptance`.
    - tests/integration/vitestOraclesExample.test.ts, "phax's own oracles declaration": read `oracles.command` from `JSON.parse` of this repository's phax.json, not through decodePhaxConfig, with a comment saying plan 4 renames the key and restores the decode.
    - If any other test decodes this repository's own phax.json, do the same and name it in the handoff.
- New tests:
    - tests/integration/loadConfigLayers.test.ts (ac-provider-old): a table over phax.json, phax.local.json and ~/.phax/config.json carrying `oracles` is refused, each with the exact message and `path` of that file, under a temporary HOME (tests/helpers/isolatePhaxHome.ts); an `acceptance` key merges across layers.
    - tests/unit/cli/validate.test.ts (ac-provider-old): `phax validate` with phax.local.json carrying `"oracles": { "command": "node scripts/acceptance-verdicts.mjs" }` fails, and its errors contain `phax.local.json: "oracles" is no longer read: write "acceptance"`.
    - tests/unit/hold.test.ts (ac-hold, ac-hold-old): `acceptance` parses; `oracle` and `oracle,phase-02` are refused with the exact message; `acceptance,phase-02` stands alone; resolveHold over a plan with acceptance phases phase-03 and phase-05 gives `{ selection: "acceptance", phases: ["phase-03", "phase-05"] }`.
    - tests/integration/holdCli.test.ts (ac-hold): `--hold acceptance` records that hold in run-status.json stamped 0.33.0 and stops after each; `--hold oracle` exits 1, prints the refusal and creates no run folder.
    - tests/unit/cli/resume.test.ts and tests/unit/resumeArgv.test.ts (ac-skip, ac-skip-old): `--skip-acceptance` is forwarded and prints the exact preview line; `--skip-oracle` is forwarded, then refused by runResume with exit 1 and the exact message, before loadConfig, executePlan or any status write.
    - tests/integration/oraclePhases.test.ts:
      - ac-provider: with `acceptance` configured, the passing phase's gate sends the command an acceptance-request stamped `https://docs.phax.run/schemas/acceptance-request/0.33.0.json`, with verdict `passed`, `acceptancePhase` and `acceptanceCommit`, saved as `checks-attempt-01.acceptance-request.json`, and the appended step carries `"surface": "acceptance"`.
      - ac-request-authored: the acceptance phase's request has verdict `authored`, `phase`, `acceptancePhase`, `base` and `files`, and no `acceptanceCommit`.
      - ac-skip: `skipAcceptance` records the step `skipped` and still runs the configured gate and the protected-path check.

    Use temporary repositories (tests/helpers/isolateGit.ts) and the fake backends. Never read ~/.phax, the real HOME or the global git config.

### Planned files to create

- (none)

### Planned files to edit

- `src/schemas/phaxConfig.ts`
- `src/domain/config/mergeLayers.ts`
- `src/app/loadConfig.ts`
- `src/app/lintPlan.ts`
- `src/app/runPreflight.ts`
- `src/app/executePlan.ts`
- `src/cli/commands/artifact.ts`
- `src/domain/hold.ts`
- `src/cli/program.ts`
- `src/cli/commands/resume.ts`
- `src/cli/commands/resumeRegister.ts`
- `src/cli/introspect.ts`
- `scripts/generate-usage-spec.ts`
- `src/cli/cliDocs.ts`
- `src/domain/whatsNext.ts`
- `src/app/resumeInstructions.ts`
- `src/domain/resetPhaseRefusal.ts`
- `src/domain/plan/oraclePairs.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `README.md`
- `phax.schema.json`
- `phax.user.schema.json`
- `docs/upgrading.md`
- `tests/integration/vitestOraclesExample.test.ts`
- `tests/unit/phaxConfigJsonSchema.test.ts`
- `tests/unit/mergeLayers.test.ts`
- `tests/integration/loadConfigLayers.test.ts`
- `tests/unit/cli/validate.test.ts`
- `tests/unit/hold.test.ts`
- `tests/integration/holdCli.test.ts`
- `tests/unit/cli/resume.test.ts`
- `tests/unit/resumeArgv.test.ts`
- `tests/integration/oraclePhases.test.ts`
- `tests/unit/whatsNext.test.ts`
- `tests/unit/resumeInstructions.test.ts`
- `tests/unit/resetPhaseRefusal.test.ts`
- `tests/integration/resetPhase.test.ts`
- `tests/unit/oraclePairs.test.ts`
- `tests/integration/oraclePairReview.test.ts`
- `tests/integration/helpers/preflightRepo.ts`
- `tests/helpers/heldRunFixture.ts`
- `tests/unit/runPreflight.test.ts`
- `tests/integration/lintPlan.test.ts`
- `tests/integration/lintTestLines.test.ts`
- `tests/integration/runPreflightBeforeNaming.test.ts`
- `tests/integration/resumePreflightRechecks.test.ts`

### Optional files that may be edited

- `src/app/gates.ts`
- `src/schemas/gateAttribution.ts`
- `src/cli/commands/run.ts`
- `src/cli/cliCompleters.ts`
- `src/domain/authoring/prompt.ts`
- `tests/unit/loadConfig.test.ts`
- `tests/unit/phaxUserOverlaySchema.test.ts`
- `tests/unit/upgradeConfigSchema.test.ts`
- `tests/unit/authoringPrompt.test.ts`
- `tests/unit/cli/plans.test.ts`
- `tests/integration/usageParity.test.ts`
- `tests/integration/usageSpecDrift.test.ts`
- `tests/integration/docsCliDrift.test.ts`
- `tests/integration/usageOutput.test.ts`
- `tests/integration/protectedPathsConfig.test.ts`
- `tests/integration/gates.test.ts`
- `tests/integration/fixLoop.test.ts`
- `tests/integration/heldStopClose.test.ts`
- `tests/integration/declaredStopClose.test.ts`
- `tests/unit/architecturalGuards.test.ts`

### Boundary contracts

Producer: src/app/loadConfig.ts. Consumers: every command, through ResolvedConfig. Contract: `acceptance?: { command }` merged across the three layers; a layer owning `oracles` is refused before the decode, as a ConfigValidationError whose message starts with that file's path and whose `path` is the same. Producer: src/domain/hold.ts parseHoldValue. Consumer: runRun. Contract: `{ kind: "acceptance" }` or a refusal string, decided before the config is read. Producer: resumeRegister.ts. Consumer: runResume. Contract: `skipAcceptance` drives executePlan's `skipAcceptance`; `skipOracle` is only ever refused, with exit 1 and nothing read or written.

### Test strategy

- an oracles key in phax.json, phax.local.json or ~/.phax/config.json is refused naming that file, and an acceptance key merges across the layers — medium · table · the exact refusal message and path per file, and the merged command · in-phase · ac-provider-old
- phax validate with an oracles key in phax.local.json fails naming phax.local.json and the new key — medium · example · exit code and the printed refusal · in-phase · ac-provider-old
- the editor schemas carry acceptance and no oracles, and equal the generated ones — small · example · the generated JSON Schemas and their property lists · in-phase
- the passing phase's gate sends an acceptance-request with verdict passed, acceptancePhase and acceptanceCommit, saves it as checks-attempt-01.acceptance-request.json, and attributes the step to the acceptance surface — medium · example · the provider's stdin, the saved file and the gate attribution · in-phase · ac-provider
- the acceptance phase's gate request has verdict authored and no acceptanceCommit — medium · example · the request's keys · in-phase · ac-request-authored
- --hold acceptance selects every acceptance phase and records the selection acceptance — small · table · the resolved hold per plan · in-phase · ac-hold
- phax run --hold acceptance writes the hold into run-status.json at 0.33.0 and stops after each acceptance phase — medium · example · run-status.json and the run's stops · in-phase · ac-hold
- --hold oracle and --hold oracle,phase-02 are refused with the new spelling, exit 1, and name no run — small · table · the refusal --hold 'oracle' is no longer read: write --hold acceptance, and no run folder · in-phase · ac-hold-old
- resume --skip-acceptance prints the skipping line, records the acceptance step skipped, and still runs the configured gate and the protected-path check — medium · example · the printed line and the gate attribution · in-phase · ac-skip
- resume --skip-oracle is refused with the new flag named, exit 1, before the config or the run status is read — small · example · the refusal --skip-oracle is no longer read: write --skip-acceptance and no executePlan call · in-phase · ac-skip-old
- a retired option is absent from the usage contract and the parity snapshot, and any other hidden option is still checked — medium · example · phax.usage.kdl matches the Commander tree · in-phase

### Implementation order

1. phaxConfig.ts, mergeLayers.ts and loadConfig.ts with the refusal
2. config readers in lintPlan, runPreflight, executePlan and artifact
3. hold.ts and the --hold help
4. resumeRegister.ts, resume.ts and executePlan's skipAcceptance
5. introspect.ts and generate-usage-spec.ts
6. recovery and help spellings, then pnpm gen:usage-spec and pnpm docs:cli
7. editor schemas, then docs/upgrading.md
8. fixtures, then the new tests

### Excluded scope

- The plan.md header lines, lint's `oracles` check and its messages, the `tests` loop messages, the old-loop refusal, "Oracle preflight failed" and the check id `oracle-phases` (phase-03).
- Prompts, closeStop's input field and messages, the overview, records-explain and review-handoff rows, telemetry, and every prose word around the renamed spellings (plan 3).
- phax.json, knip.json, examples/vitest-oracles, skills, README prose outside its generated block, and docs pages (plan 4).

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

The AcceptanceConfig type and ResolvedConfig field, and the exact config refusal message and path form for each layer. The HoldRequest kinds and every hold message. ResumeCommandOptions, where runResume refuses skipOracle, and its exit code. Where RETIRED_OPTIONS lives, and how introspect.ts and generate-usage-spec.ts skip exactly its options. Every message that now names `--skip-acceptance` or `--hold acceptance` but keeps old words, for plan 3. The tests that read this repository's phax.json raw, for plan 4. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(config): acceptance provider key, --hold acceptance and --skip-acceptance`

### Commit body

The provider that judges acceptance pairs is configured under acceptance in phax.json, phax.local.json, ~/.phax/config.json and the editor schemas, and its description names the acceptance-request phax now sends. A layer that still carries oracles is refused before the decode, naming its file. phax run --hold acceptance holds every acceptance phase, and phax resume --skip-acceptance skips the acceptance step. --hold oracle and --skip-oracle are refused with the new spelling named. Recovery steps and help name the new spellings, and the usage contract and CLI reference are regenerated. This repository's phax.json keeps oracles for the installed phax until a later plan, so the example test reads that key raw.

---

## phase-02 — Acceptance tests for the header lines, lint and preflight {#phase-02-plan-side-tests}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium
**Oracle phase:** discharged by phase-03
**Oracle files:** `tests/integration/acceptancePlanCases.ts`, `tests/integration/acceptanceLint.test.ts`, `tests/integration/acceptancePreflight.test.ts`

Freeze, as acceptance tests marked expected-to-fail, what lint, the extraction and the run preflight must report once the plan side speaks the acceptance names. The new header lines are read and their pairing rules hold, the loop messages say acceptance, a missing provider is named, and the old lines and the old loop are refused by name.

### Detailed instructions

- Create tests/integration/acceptancePlanCases.ts, a plain module (no test in it). It exports plan.md builders and the expected findings as inline literals.
    - The base plan has four phases, a Draft frontmatter with `source-spec: null`, `## Required commands` `- (none)`, model claude-sonnet-5-5 and effort medium on every phase. phase-03 plans to create `tests/e2e/publish.test.ts`.
    - Each builder takes phase-03's extra header lines and each phase's `### Test strategy` text.
    - The expected rows are literal objects `{ severity, check, phase, message }` holding exactly the spec's strings.
    - Import nothing from tests/helpers or src beyond types. The passing phase may change helpers, never this module.
- Create tests/integration/acceptanceLint.test.ts. It drives `lintPlan` (src/app/lintPlan.ts) over a fake file system, as tests/integration/lintPlan.test.ts does, with a config cast `as unknown as ResolvedConfig` that holds `acceptance: { command: "node scripts/acceptance-verdicts.mjs" }`, except where a case says none. Cases:
    - ac-header: phase-03 carries `**Acceptance phase:** passed by phase-04` and `**Acceptance test files:** `tests/e2e/publish.test.ts``, and has the test line `- publishing refuses a red gate — medium · example · the refusal naming the gate · acceptance` (written with the loop word `acceptance`). Lint reports no error at all.
    - ac-header-rules: one plan with `**Acceptance phase:** discharged by phase-04` on phase-03 reports `{ severity: "error", check: "acceptance", phase: "phase-03", message: '**Acceptance phase:** "discharged by phase-04" is not a declaration: write "yes" or "passed by phase-NN"' }`. Another plan with `**Acceptance phase:** yes` and no files line on phase-02 reports `**Acceptance phase:** without **Acceptance test files:**: write both lines or neither` on phase-02. hasLintErrors is true for both.
    - ac-header-old: phase-03 carries `**Oracle phase:** yes` and `**Oracle files:** `tests/e2e/publish.test.ts``. Lint holds the two `acceptance` rows `**Oracle phase:** is no longer read: write **Acceptance phase:**` and `**Oracle files:** is no longer read: write **Acceptance test files:**`.
    - ac-loop-rules: phase-02 is an ordinary phase with one `acceptance`-loop line, and phase-03 is an acceptance phase (passed by phase-04) with only `in-phase` lines. Lint holds the `tests` rows `test line 1 is in the acceptance loop, but phase-02 is not an acceptance phase` and `phase-03 is an acceptance phase, but none of its test lines is in the acceptance loop`.
    - ac-loop-old: phase-03's line is `- every (state, transition) pair is accepted or refused as the table says — small · table · transition table · oracle · AC-3`. Lint holds the `tests` row `test line 1 uses the loop 'oracle', which is no longer read: write 'acceptance'` on phase-03.
    - ac-provider-missing: the ac-header plan with a config holding no `acceptance` key holds the `acceptance` row `acceptance phase declared, but no "acceptance" provider is configured (phax.json, phax.local.json or ~/.phax/config.json)` on phase-03.
- Create tests/integration/acceptancePreflight.test.ts:
    - ac-header: the ac-header plan.md extracts through `loadOrExtractPlan` (src/app/loadOrExtractPlan.ts), set up as tests/integration/loadOrExtractPlan.test.ts sets it up. The phax-plan.json it writes has `$schema` `https://docs.phax.run/schemas/phax-plan/0.33.0.json`, and its phase-03 carries `acceptance` equal to `{ passedBy: "phase-04", files: ["tests/e2e/publish.test.ts"] }`.
    - ac-loop-old: the ac-loop-old plan.md is refused by `loadOrExtractPlan` with exactly `<planMdPath>: phase-03 test line 1 uses the loop 'oracle', which is no longer read: write 'acceptance' — run phax plans lint <planMdPath>`, and the fake shell records no model call.
    - ac-header-old: `runPreflights` (src/app/runPreflight.ts) runs over the ac-header-old plan, its plan.md and a config with the acceptance provider, built as tests/unit/runPreflight.test.ts builds its inputs. It fails with an error whose `_tag` is `AcceptancePreflightError` (compare with toMatchObject, never a typed reference). Its message is exactly `Acceptance preflight failed: 2 error(s).` followed by `  phase-03  **Oracle phase:** is no longer read: write **Acceptance phase:**`, `  phase-03  **Oracle files:** is no longer read: write **Acceptance test files:**` and the existing closing line naming `phax plans lint <planPath>`, in the format runPreflight.test.ts already expects.
- Every test carries `it.fails` (or `it.fails.each`). Each must fail today on an assertion, never because a module, export or type is missing.
    - Today `**Acceptance phase:**` is not read, the `**Oracle phase:**` lines are, the check is `oracles` and the loop messages say oracle, so each case above fails on its own assertion.
    - Pair any assertion that already holds today (such as "no acceptance error") with one that does not, in the same test.
    - Never name the type LintCheck or compare `f.check === "acceptance"`: match whole findings with toContainEqual or toEqual, so the files typecheck under `pnpm test:type` before and after the passing phase.
    - No randomness. Use temporary or fake file systems only; never read ~/.phax or the global git config.
- Do not touch any src/, packages/ or other test file. The gate's `pnpm test` stays green because every test is marked.

### Planned files to create

- `tests/integration/acceptancePlanCases.ts`
- `tests/integration/acceptanceLint.test.ts`
- `tests/integration/acceptancePreflight.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- (none)

### Boundary contracts

Consumer: these acceptance tests. Producers: lintPlan (src/app/lintPlan.ts) returning a LintReport, loadOrExtractPlan (src/app/loadOrExtractPlan.ts) writing phax-plan.json or refusing, and runPreflights (src/app/runPreflight.ts) failing with a tagged error. Contract: a plan.md in the acceptance names lints clean and extracts with `acceptance: { passedBy, files }`; every defect and every old spelling is one finding or refusal carrying the spec's exact string.

### Test strategy

- a phase with the new header lines lints with no error and extracts with acceptance passedBy phase-04 at phax-plan 0.33.0 — medium · example · the lint findings and the written phax-plan.json · oracle · ac-header
- a discharged-by value and a phase line without its files line are each refused with the spec's acceptance message, and lint has errors — medium · table · the literal findings in the shared case module · oracle · ac-header-rules
- the Oracle phase and Oracle files lines are each refused by name in lint, and the run preflight fails with Acceptance preflight failed listing both — medium · example · the literal findings and the exact preflight message · oracle · ac-header-old
- an acceptance-loop line outside an acceptance phase, and an acceptance phase with no acceptance-loop line, are each reported with the acceptance wording — medium · table · the literal tests findings · oracle · ac-loop-rules
- a test line in the oracle loop is refused by name in lint and before the extraction cache with no model call — medium · example · the literal tests finding, the refusal message and the fake shell's empty call log · oracle · ac-loop-old
- an acceptance phase with no acceptance provider in any layer is reported naming the acceptance key — medium · example · the literal acceptance finding · oracle · ac-provider-missing

### Implementation order

1. the case module with the plan builders and expected rows
2. the lint tests
3. the extraction and preflight tests

### Excluded scope

- Any change to src/, packages/ or existing tests (phase-03).
- Configuration and CLI words (phase-01).
- Resume of a run whose plan.md was edited back to the old lines: in-phase in phase-03.

### Verification

The `standard` gate profile in phax.json, with the configured oracles provider judging the authored acceptance tests.

### Expected handoff content

The three file paths, the cases and their expected rows, and the entry each test calls with its setup. Confirmation that every test carries the expected-failure marker and fails today on an assertion. Any deviation from the planned file lists, with the reason.

### Commit subject

`test(plan): acceptance tests for the header lines, lint and preflight`

### Commit body

Freeze, behind expected-failure markers, what lint, the extraction and the run preflight must report once the plan side speaks the acceptance names. The new header lines lint clean and extract into acceptance with passedBy, and their pairing rules use the new words. The loop messages say acceptance, a missing provider names the acceptance key, and the Oracle header lines and the oracle loop are refused by name. The plans and expected findings are inline literals in a shared case module.

---

## phase-03 — Acceptance header lines, lint check and preflight {#phase-03-plan-side}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium
**Assignment reason:** Passes an acceptance pair across the header-line grammar, its renderer, the lint check, the test-line grammar's new departure kind and the run preflight, with fixtures in some twenty test files and acceptance tests it may not edit: a change crossing the domain, app and cli layers.

A plan declares an acceptance pair with `**Acceptance phase:** yes | passed by phase-NN` and `**Acceptance test files:**`, read and rendered in the same commit. Lint checks it under `acceptance` and the loop messages say acceptance. The old header lines and the old loop are refused by name, and the run preflight `acceptance-phases` refuses with "Acceptance preflight failed". phase-02's acceptance tests pass.

### Detailed instructions

- src/domain/plan/phaseHeader.ts:
    - The declaration labels become `Mode`, `Acceptance phase` and `Acceptance test files`.
    - `Oracle phase` and `Oracle files` join `Model reason` as old labels: recognized by LINE_RE anywhere in the phase (header paragraph or elsewhere, as readPhaseBlock already does for Model reason), never declarations.
    - Build LINE_RE with `replaceAll(" ", "\\s+")`: `Acceptance test files` has two spaces.
    - HeaderParagraph gets `acceptancePhase`, `acceptanceFiles`, `hasOraclePhaseLine` and `hasOracleFilesLine`; PhaseHeader merges the two flags across the phase like hasModelReason.
    - Rename oracleDeclaration/OracleDeclaration to acceptanceDeclaration/AcceptanceDeclaration, with `passedBy: { kind: "next" } | { kind: "phase", id }`, and DISCHARGED_BY_RE to PASSED_BY_RE `^passed by (phase-\d{2})$`.
    - phaseKinds and withPhaseKinds keep their contract. Update the comments.
- src/domain/authoring/renderPlan.ts writes `**Acceptance phase:** passed by phase-NN` and `**Acceptance test files:** <code spans>` from `phase.acceptance`. Do not touch renderPlanV0_26_0.ts or renderPlanV0_32_0.ts. The render-then-parse round trip must give back every phase's `acceptance`.
- Move src/domain/plan/oracleCheck.ts to src/domain/plan/acceptanceCheck.ts:
    - acceptanceFindings, AcceptanceCheckInput, AcceptanceCheckPhase.
    - The check is `acceptance` (src/domain/plan/lint.ts's LintCheck: `oracles` → `acceptance`).
    - Rules and their order are unchanged, with the old-label rows first, one per label per phase: `**Oracle phase:** is no longer read: write **Acceptance phase:**` and `**Oracle files:** is no longer read: write **Acceptance test files:**`.

    The reworded messages are exactly:
    - `**Acceptance phase:** without **Acceptance test files:**: write both lines or neither`;
    - `**Acceptance test files:** without **Acceptance phase:**: write both lines or neither`;
    - `**Acceptance phase:** "<value>" is not a declaration: write "yes" or "passed by phase-NN"`;
    - `**<label>:** line sits outside the header paragraph`;
    - `**<label>:** line appears more than once in the header paragraph`;
    - `acceptance phase is passed by the next phase, and <phase> is the last phase`;
    - `acceptance phase is passed by <target>, which is not a phase of this plan`;
    - `acceptance phase is passed by <target>, which is the acceptance phase itself`;
    - `acceptance phase is passed by <target>, which comes before it`;
    - `is both an acceptance phase and the passing phase of <ids>: a phase takes one acceptance role`;
    - `passes more than one acceptance phase (<ids>): one passing phase per acceptance phase`;
    - `**Acceptance test files:** lists no file: an acceptance phase lists at least one acceptance test file`;
    - `acceptance test file <f> is listed more than once on **Acceptance test files:**: list each acceptance test file once`;
    - `acceptance test file <f> is not among this phase's planned files to create or to edit`;
    - `plans <f>, an acceptance test file of <phase>, before <passing> passes it`;
    - `an interactive phase takes no acceptance role: it declares an acceptance phase`;
    - `an interactive phase takes no acceptance role: it passes <ids>`;
    - `acceptance phase declared, but no "acceptance" provider is configured (phax.json, phax.local.json or ~/.phax/config.json)`.

    Move tests/unit/oracleCheck.test.ts to tests/unit/acceptanceCheck.test.ts with the new names, keeping each scenario.
- src/domain/plan/testLineCheck.ts: TestLineCheckPhase's `oracle` becomes `acceptance`. The messages are exactly `test line <n> is in the acceptance loop, but <phase> is not an acceptance phase` and `<phase> is an acceptance phase, but none of its test lines is in the acceptance loop`. Update the doc comment. src/app/lintPlan.ts passes `acceptance: phase.acceptance` and calls acceptanceFindings.
- src/domain/plan/testLineGrammar.ts:
    - TestLineDeparture gains a required `kind: "format" | "retired-loop"`.
    - In readTestStrategyText, when an entry departs under the current loops and the options do not set beforeAcceptance, and `parseTestLine(text, { beforeAcceptance: true })` reads it, the departure is `retired-loop`; otherwise `format`.
    - departureMessage returns `test line <n> uses the loop 'oracle', which is no longer read: write 'acceptance'` for `retired-loop`, and today's text for `format`.
    - Every site that builds a departure (src/schemas/persisted.ts, documentMigration.ts) sets `kind: "format"`.
    - Keep the module's imports as they are (the schemas package reads it).
- Preflight:
    - src/app/runPreflight.ts: the check id `oracle-phases` becomes `acceptance-phases`, in the same position, and it calls acceptanceFindings.
    - src/domain/errors.ts: OraclePreflightError becomes AcceptancePreflightError, keeping exit 11 wherever the tag is mapped (grep the tag across src/).
    - declarationRefusalMessage("Acceptance", …) gives `Acceptance preflight failed: <n> error(s).`.
    - src/app/executePlan.ts's missing-provider refusal in oracleStepFor uses the same text and error.
    - Rename any telemetry or schema enum value that carries the check id, as the compiler names it.

    OracleCommitMissingError and oracleStepFor keep their names (plan 3).
- src/cli/cliDocs.ts: switch the spellings `**Oracle phase:**`, `**Oracle files:**`, `discharged by phase-NN` (as a line value) and the loop word `oracle` to the new spellings, the check name `oracles` to `acceptance`, and "Oracle preflight failed" to "Acceptance preflight failed". Other words stay (plan 3). Run `pnpm gen:usage-spec` and `pnpm docs:cli`.
- docs/upgrading.md, 0.33.0 entry:
    - Add, after the command-line bullet: **Hand-written plans: the header lines and the loop.** `**Oracle phase:** yes | discharged by phase-NN` is `**Acceptance phase:** yes | passed by phase-NN`, `**Oracle files:**` is `**Acceptance test files:**`, and a test line's loop `oracle` is `acceptance`. `phax plans lint` reports the old lines on its `acceptance` check (formerly `oracles`) with `**Oracle phase:** is no longer read: write **Acceptance phase:**` and `**Oracle files:** is no longer read: write **Acceptance test files:**`, and `phax run` and `phax resume` refuse them with exit 11, "Acceptance preflight failed". The old loop is refused with `test line <n> uses the loop 'oracle', which is no longer read: write 'acceptance'`, before any extraction.
    - In the migrate-documents bullet, say it also re-renders the header lines.
    - The closing line becomes: "The provider steps of this release are listed here when they ship."
- Remove every `.fails` marker from tests/integration/acceptancePlanCases.ts, tests/integration/acceptanceLint.test.ts and tests/integration/acceptancePreflight.test.ts. That is the only change allowed in them. Every acceptance test must pass without editing it. If one cannot, stop and report it in the handoff; do not change the test.
- Update every other test and fixture to the new names, keeping each scenario:
    - plan.md fixtures with `**Oracle phase:**` / `**Oracle files:**` lines (phaseHeader, parsePlanMarkdown, renderPlan, extractPlan, runPreflight, lintPlan, lintTestLines, runPreflightBeforeNaming, resumePreflightRechecks, oraclePhases, holdCli, oraclePairReview, planOverview, migrateDocuments, tests/helpers/planMarkdown.ts and heldRunFixture.ts);
    - expected `oracles` rows and check names;
    - expected loop messages and "Oracle preflight failed";
    - the check id in tests/unit/runPreflight.test.ts and runPreflightBeforeNaming.test.ts.

    Keep renderPlanV0_32_0.test.ts unchanged.

    New and extended tests:
    - tests/integration/migrateDocuments.test.ts (ac-migrate): a migrated 0.32.0 sidecar's plan.md reads `**Acceptance phase:** passed by phase-04` and `**Acceptance test files:** …`. Drop plan 1's comment.
    - tests/integration/resumePreflightRechecks.test.ts (ac-header-old): a run whose plan.md was edited back to the old lines is refused by resume with exit 11 and "Acceptance preflight failed" listing both rows.
    - tests/unit/testLineGrammar.test.ts: a `retired-loop` departure for `· oracle` and `· oracle · AC-3`; a `format` departure for an `oracle` line that also departs elsewhere; no `retired-loop` under beforeAcceptance.
    - tests/unit/phaseHeader.test.ts: the old labels are recognized in and outside the header paragraph and declare nothing.

    Use temporary repositories and the fake backends.

### Planned files to create

- `src/domain/plan/acceptanceCheck.ts`
- `tests/unit/acceptanceCheck.test.ts`

### Planned files to edit

- `tests/integration/acceptancePlanCases.ts`
- `tests/integration/acceptanceLint.test.ts`
- `tests/integration/acceptancePreflight.test.ts`
- `src/domain/plan/oracleCheck.ts`
- `tests/unit/oracleCheck.test.ts`
- `src/domain/plan/phaseHeader.ts`
- `src/domain/plan/lint.ts`
- `src/domain/plan/testLineCheck.ts`
- `src/domain/plan/testLineGrammar.ts`
- `src/domain/authoring/renderPlan.ts`
- `src/app/lintPlan.ts`
- `src/app/runPreflight.ts`
- `src/app/executePlan.ts`
- `src/domain/errors.ts`
- `src/schemas/persisted.ts`
- `src/cli/cliDocs.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `docs/upgrading.md`
- `tests/unit/phaseHeader.test.ts`
- `tests/unit/parsePlanMarkdown.test.ts`
- `tests/unit/renderPlan.test.ts`
- `tests/unit/extractPlan.test.ts`
- `tests/unit/runPreflight.test.ts`
- `tests/unit/testLineGrammar.test.ts`
- `tests/unit/testLineCheck.test.ts`
- `tests/integration/lintPlan.test.ts`
- `tests/integration/lintTestLines.test.ts`
- `tests/integration/runPreflightBeforeNaming.test.ts`
- `tests/integration/resumePreflightRechecks.test.ts`
- `tests/integration/migrateDocuments.test.ts`
- `tests/integration/oraclePhases.test.ts`
- `tests/integration/holdCli.test.ts`
- `tests/integration/oraclePairReview.test.ts`
- `tests/integration/planOverview.test.ts`

### Optional files that may be edited

- `src/domain/plan/parsePlanMarkdown.ts`
- `src/domain/artifact/documentMigration.ts`
- `src/app/extractPlan.ts`
- `src/app/loadOrExtractPlan.ts`
- `src/cli/commands/plans.ts`
- `src/cli/commands/run.ts`
- `src/cli/commands/resume.ts`
- `src/domain/telemetry/events.ts`
- `src/schemas/telemetryEvents.ts`
- `README.md`
- `tests/helpers/planMarkdown.ts`
- `tests/helpers/heldRunFixture.ts`
- `tests/integration/helpers/preflightRepo.ts`
- `tests/integration/loadOrExtractPlan.test.ts`
- `tests/integration/planStaleness.test.ts`
- `tests/integration/decideArtifact.test.ts`
- `tests/integration/plansOverviewCommand.test.ts`
- `tests/unit/cli/plans.test.ts`
- `tests/unit/criterionCoverage.test.ts`
- `tests/unit/planOverview.test.ts`
- `tests/unit/persisted.test.ts`
- `tests/unit/artifact/documentMigration.test.ts`
- `tests/unit/architecturalGuards.test.ts`
- `tests/integration/usageSpecDrift.test.ts`
- `tests/integration/docsCliDrift.test.ts`

### Boundary contracts

Producer: src/domain/plan/phaseHeader.ts. Consumers: lint, the run preflight, both extraction paths and acceptanceCheck.ts. Contract: a phase's acceptance declaration is read only from `**Acceptance phase:**` and `**Acceptance test files:**`, and old labels surface only as flags. Producer: src/domain/authoring/renderPlan.ts. Consumer: the deterministic parse. Contract: render then parse gives back each phase's `acceptance`. Producer: src/domain/plan/testLineGrammar.ts. Consumers: lint, loadOrExtractPlan and the deterministic parse. Contract: a departure carries its kind, and departureMessage names the old loop for `retired-loop`. Producer: runPreflights. Consumers: `phax run` and `phax resume`. Contract: the `acceptance-phases` check fails with AcceptancePreflightError (exit 11) carrying exactly lint's `acceptance` rows.

### Test strategy

- the new header lines read into acceptance with passedBy the next phase or phase-NN, the old labels are recognized anywhere and declare nothing — small · table · the PhaseHeader fields and phaseKinds output per declaration · in-phase · ac-header
- rendering a plan sidecar and parsing its plan.md gives back the same acceptance key on every phase — small · example · the sidecar's phases · in-phase · ac-header
- every acceptance check rule reports its reworded message, rules and order unchanged — small · table · the expected findings per defect · in-phase · ac-header-rules
- a resumed run whose plan.md was edited back to the old lines exits 11 with Acceptance preflight failed listing both — medium · example · exit code and the refusal text · in-phase · ac-header-old
- a line in the oracle loop departs as retired-loop and any other departure stays format — small · table · the departure kind and message per line · in-phase · ac-loop-old
- the loop rules report the acceptance wording — small · example · the expected tests findings · in-phase · ac-loop-rules
- a migrated 0.32.0 sidecar's plan.md carries the Acceptance header lines — medium · example · the rewritten plan.md · in-phase

### Implementation order

1. phaseHeader.ts and renderPlan.ts together
2. acceptanceCheck.ts and lint.ts
3. testLineCheck.ts and testLineGrammar.ts with the departure kind
4. lintPlan.ts, runPreflight.ts, errors.ts and executePlan.ts
5. cliDocs.ts, then pnpm gen:usage-spec and pnpm docs:cli
6. docs/upgrading.md
7. remove the markers from phase-02's acceptance tests
8. fixtures, then the new tests

### Excluded scope

- Configuration and CLI words (phase-01).
- oraclePairs.ts beyond what the compiler requires, closeStop, prompts, the overview, records-explain and review-handoff rows, OracleCommitMissingError, the failedStep value and telemetry events (plan 3).
- The frozen renderers renderPlanV0_26_0.ts and renderPlanV0_32_0.ts.
- Skills, docs pages, the example, phax.json and knip.json (plan 4).

### Verification

The `standard` gate profile in phax.json, with the configured oracles provider judging the passed acceptance tests.

### Expected handoff content

The HeaderParagraph and AcceptanceDeclaration shapes, the acceptanceFindings module path and its message list, the TestLineDeparture kinds, AcceptancePreflightError and the `acceptance-phases` check id. Confirmation that phase-02's acceptance tests pass with only their markers removed. Every message that still names oracle words, for plan 3. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(plan): acceptance header lines, lint check and preflight`

### Commit body

A plan declares an acceptance pair with **Acceptance phase:** yes | passed by phase-NN and **Acceptance test files:**, read and rendered in this one commit. Lint's oracles check is now acceptance, with every message reworded and the rules unchanged, and the tests check's loop messages say acceptance. The **Oracle phase:** and **Oracle files:** lines and the test-line loop oracle are refused by name: in lint, before the extraction cache, and in the run preflight. That preflight is now acceptance-phases, failing with "Acceptance preflight failed" and exit 11. migrate-documents re-renders the new header lines. The upgrading guide names the hand-written plan steps. The acceptance tests of the previous commit pass with their markers removed.
