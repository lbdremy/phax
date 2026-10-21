---
status: Approved
source-spec: docs/specs/2610201518-oracle-phases.md
completes-spec: false
approved:
  date: 2026-10-21
  baseline: a0d1d31
---
# Oracle phases

The first of the two plans of the approved spec `oracle-phases` (`docs/specs/2610201518-oracle-phases.md`). After it, a plan can declare an oracle phase and the later phase that discharges it, and it runs wherever an `oracles` provider is configured, whoever wrote that provider. The second plan ships the example Vitest provider (§5.41–§5.48) and declares it in phax's own phax.json (§5.43). Nothing here builds, names or imports a provider, and nothing in `src/` learns a test framework, a marker or a test-file convention (§5.41).

Already landed and not redone here: the phase shape of PR #151. That covers the required `oracle` key on every phase of the plan document and of `phax-plan.json`, the `**Oracle phase:**` / `**Oracle files:**` header lines read by `src/domain/plan/phaseHeader.ts`, the lift that writes `oracle: null`, the well-formedness rows of the `oracles` lint check (§5.5, in `src/domain/plan/oracleCheck.ts`), and the not-yet-supported refusal `unsupportedOracleFindings`, which lint and the `oracle-phases` run preflight check call today. The settled verdicts are not reopened: q-request `oracle-request`, q-example-ships `repo-only`, q-interactive-role `refuse`, the lifted Q1–Q5 and the joint J1–J5.

Four phases, core outwards, every commit green:
1. the `oracles` provider block and the full `oracles` check (§5.6–§5.18), shared by lint and the run/resume preflight, with the not-yet-supported refusal kept so that no commit lets an oracle phase run without its step;
2. the persisted shapes: the new `oracle-request` format, the recorded `oracle` surface in `gate-attribution` and `phase-record-manifest`, the record's oracle role, and the pure pair resolution;
3. the oracle step in the gate loop, the pause and failure paths, attribution, the discharge judging the current oracle commit, discharge edits counted as planned, `phax reset-phase` resetting the discharge first, and the removal of the refusal;
4. everything a person reads around a run: the review handoff, `phax records explain`, the phase prompt's role paragraph, the headless plan authoring prompt, the two skills, `phax --usage`, the README, a docs page, `docs/upgrading.md` and `NEXT_STEPS.md`.

The formats get a phase of their own, apart from the runtime, because the schemas-package work (two frozen modules, three `next` snapshots, a reader lift and the package's type and fixture tests) is mechanical but wide, and the gate runtime is the design work: separate commits keep each one reviewable.

Phase 4 edits `.claude/skills/phax-planning/SKILL.md` and `.claude/skills/phax-decide-plan/SKILL.md`, which §5.39 and §10 require, so run this plan with `phax run --allow-skill-edits`.

Tests use made-up fixtures only (`acme-billing`, `refunds`, `tests/prune.test.ts`, `tests/refunds.test.ts`) and fake provider scripts written into temporary directories. They never read `~/.phax`, and they assert `$schema` URLs by format id and release pattern, never by the running version.

## Required commands

- `pnpm dev schema upgrade`
- `pnpm exec tsx`
- `pnpm gen:usage-spec`
- `pnpm docs:cli`

All four are already in `security.agentCommands` in phax.json, so no phax.json change is needed. `pnpm dev schema upgrade` regenerates phax.schema.json and phax.user.schema.json (phase-01). `pnpm exec tsx scripts/schemas-check.ts --write` writes the schemas package's snapshots, history lock and generated modules (phase-02). `pnpm gen:usage-spec` and `pnpm docs:cli` regenerate phax.usage.kdl and docs/cli/reference.md (phase-04).

## Technical arbitrations

- Where the `oracles` check reads the declarations: from plan.md's header lines (`readPhaseHeaders` and `oracleDeclaration`), not from `phax-plan.json`'s `oracle`, which resolves `yes` on the last phase to null and so could never report §5.6. The planned-file rules (§5.9, §5.10) read the parsed plan's phases. When lint cannot parse the plan, those two rules report nothing, and the structure errors already say why. Loss accepted: on an unparseable plan, lint shows fewer `oracles` rows than it will once the plan parses.
- Where the check sits in RUN_PREFLIGHT_CHECKS: the `oracle-phases` check moves directly before `interactive-phases`. The preflight stops at its first refusal, so a plan with any `oracles` error is refused by the oracles check, printing every `oracles` row lint reports, including the §5.11 and §5.12 rows about interactive phases. A plan whose only errors are interactive ones is refused by the interactive check as today. Loss accepted: until the interactive runtime lands, a plan with both kinds of error shows only its `oracles` rows at `phax run`, while `phax plans lint` shows both. The exit code is 11 either way, and every `oracles` criterion of §8 holds.
- `phax run --dry-run` gets no `Preflight will fail` line for the `oracles` check, as for the assignment and interactive checks today. Loss accepted: a dry run does not show oracle errors; `phax plans lint` and the real preflight do.
- The provider time cap is a fixed 120 s (`ORACLE_PROVIDER_TIMEOUT_MS`), passed to the Shell port's `timeoutMs`. It is not configurable, because the `oracles` block holds exactly `command` (§5.16). Loss accepted: a provider that legitimately needs more than 120 s fails the oracle step as a broken step.
- Two surface enums: `SurfaceSchema` stays the configured three (`local` | `structural` | `product`), used by phax.json gate steps. A new `RecordedSurfaceSchema` adds `oracle` and is used by gate-attribution step results and by the record's `verifiedSurfaces`. Because the configured enum does not change, `"surface": "oracle"` on a configured step stays refused at decode (§5.18), and phax.json's JSON Schema is unchanged. Loss accepted: two names for overlapping enums.
- How the oracle role reaches `phax records explain`: a new required `oracle` key on the phase record manifest, `null`, `{ role: "oracle", dischargedBy }` or `{ role: "discharging", oraclePhase }`. It rides the `next` shape that phase-record-manifest needs anyway for `verifiedSurfaces`. phax's reader lifts a manifest stamped below the current stamp, or a pre-schema one, to `oracle: null`. No earlier phax could run an oracle phase, so null is true for those. The last oracle-step command and result are read from the record's own `gate-attribution.json` artifact. Loss accepted: one more manifest key and a reader lift. Deriving the role from the run's `phax-plan.json` instead would lose it for every record whose run folder is gone, or that lives in a dedicated records repository on another machine.
- The oracle request's `base` and `oracleCommit` come from the oracle phase's own `status.json` (`base`, `commitHash`), never from git. This follows the gate request's rule that a base is never re-derived. Loss accepted: a phase branch moved by hand is not seen, and the provider judges the recorded commit.
- The oracles provider is never granted to the phase agent. Its command is kept out of the frozen effective command set, out of the security grants, and out of the prompt's gate-command list. It runs only from phax, at the gate. Nothing is granted, so no security boundary moves. Loss accepted: the agent cannot check its own oracle verdict before the gate; it learns findings from the fix prompt, at the cost of a fix attempt.
- Discharge edits (§5.34): when a phase discharges a pair, the pair's oracle files join that phase's optional files for reconciliation, not its planned edits. A discharge may leave an oracle file untouched: one where the oracle phase only deleted tests has no marker to remove, and as a planned edit it would show a false missing edit. Loss accepted: reconciliation never flags an untouched oracle file. The provider's `discharged` verdict judges whether markers were left.
- The saved request is `checks-attempt-NN.oracle-request.json`, beside the attempt's log. It counts as a per-attempt file for attempt numbering, and `phax records explain --gates` lists it after the attempt's `.request.json`. The provider's answer keeps the existing `report-SS` naming, SS being the oracle step's position: the number of configured steps the attempt fires, plus one.
- `phax reset-phase` checks the discharge rule (§5.36) before the existing later-committed rule. A discharging phase in any state other than `pending` then refuses with its own reason, naming the discharging phase, even when it is also committed. The run's `phax-plan.json` is read in any shape, lifted. An unreadable plan adds no refusal: such a run cannot resume anyway.
- Wording follows the spec's §6 examples: lint rows, preflight refusal, prompt paragraphs, handoff table, records line, skill and README text. The existing preflight layout (`Oracle preflight failed: N error(s).`, one `  phase-NN  message` row per error, then the lint hint) is kept.

---

## phase-01 — The oracles provider block and the shared oracles check {#phase-01-oracles-check}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

phax.json and both user overlays accept an `oracles: { command }` provider block, merged across layers like `architecture`. One pure domain check computes every `oracles` error of a plan: pairing, roles, oracle files, nothing planned between a pair, no interactive phase inside a pair or in an oracle role, and a configured provider. `phax plans lint` reports exactly those errors, and the `phax run` / `phax resume` start preflight refuses on exactly the same ones with exit 11. The not-yet-supported refusal stays for now, so an oracle phase still cannot run.

### Detailed instructions

- Config (§5.16, §5.17). In `src/schemas/phaxConfig.ts`, add `OraclesConfigSchema = Schema.Struct({ command: Schema.NonEmptyString })` and its type `OraclesConfig`, beside `ArchitectureConfigSchema`. Annotate `command` with a description summarizing the contract: the string is split on whitespace with no shell; at the gate of an oracle phase or its discharging phase only, phax writes an oracle request `{"$schema": "https://docs.phax.run/schemas/oracle-request/<release>.json", "verdict", "phase", "oraclePhase", "base", "files"}` (plus `oracleCommit` on a `discharged` request) on its stdin; it judges the gate report the provider prints on stdout exactly like an `output: "gate-report"` step, with a fixed 120 s limit; lint, validate, the preflight and authoring never run it; full contract in `phax --usage`, cmd run. Add `oracles: Schema.optional(OraclesConfigSchema)` to both `PhaxConfigSchema` and `PhaxUserOverlaySchema`, right after `architecture`, with a block description: the oracles provider, which judges the oracles an oracle phase authors and its discharging phase discharges. Add `readonly oracles?: OraclesConfig` to `ResolvedConfig`.
- Merge it in `src/domain/config/mergeLayers.ts` exactly as `architecture` is: a scalar override, local overlay over global overlay over phax.json. Carry it into the resolved config in `src/app/loadConfig.ts` beside `architecture`. Excess keys in the block (`timeout`) and an empty `command` are already refused at decode, exit 2, because both decoders use `onExcessProperty: "error"` and `NonEmptyString`. Add tests that prove it rather than new code.
- Run `pnpm dev schema upgrade` to regenerate `phax.schema.json` and `phax.user.schema.json`. Both must define `oracles` with a required non-empty `command`, no other key, and the description. The configured gate step's `surface` enum stays `local` | `structural` | `product`.
- §5.18 holds today, because a configured step's `surface` is the three-value `SurfaceSchema`. Lock it with a test: `phax validate` on a gate step with `"surface": "oracle"` exits 2 and names the step's `surface`. phase-02 widens only the recorded surface, so this test must keep passing.
- The check (§5.6–§5.14). Rewrite `src/domain/plan/oracleCheck.ts` so its single export `oracleFindings(input: OracleCheckInput): readonly LintFinding[]` computes every `oracles` error. Input: `{ headers: readonly PhaseHeader[]; phases: readonly OracleCheckPhase[] | null; providerConfigured: boolean }`. `OracleCheckPhase` is `{ id, plannedFilesToCreate, plannedFilesToEdit, optionalFilesToEdit }`. `phases` is null when lint could not parse the plan. Keep it pure: no I/O, no schema import beyond types. Phase order is the order of `headers`, the `## phase-NN` headings in plan.md.
- Keep the existing malformed-line rows (§5.5) exactly as they are. Then, for every header whose `oracleDeclaration(header)` is not null, resolve its discharging phase: `next` is the following header's phase, or none for the last one; `phase` is the named id. Report, each as `{ severity: "error", check: "oracles", phase, message }`:
- §5.6 on the oracle phase: `oracle phase is discharged by the next phase, and phase-05 is the last phase`; `oracle phase is discharged by phase-01, which comes before it` (and `…, which is the oracle phase itself` when it names itself); `oracle phase is discharged by phase-09, which is not a phase of this plan`. Only a declaration whose discharging phase exists and comes after it forms a pair for the rules below.
- §5.7 on the phase concerned: a phase that is both an oracle phase and the discharging phase of a pair gets `is both an oracle phase and the discharging phase of phase-02: a phase takes one oracle role`. A phase that discharges two or more oracle phases gets `discharges more than one oracle phase (phase-01, phase-02): one discharging phase per oracle phase`, once.
- §5.8 on the oracle phase, when its **Oracle files:** line lists no file: `**Oracle files:** lists no file: an oracle phase lists at least one oracle file`.
- §5.9 on the oracle phase, only when `phases` is not null: one row per oracle file not among that phase's own `plannedFilesToCreate` or `plannedFilesToEdit`: `oracle file tests/other.test.ts is not among this phase's planned files to create or to edit`. Its other planned files, such as a stub, are ordinary files, never oracle files.
- §5.10 on the intervening phase, only when `phases` is not null: for each pair and each phase strictly between its two phases, one row per oracle file that phase lists in create, edit or optional: `plans tests/refunds.test.ts, an oracle file of phase-02, before phase-04 discharges it`.
- §5.11 on the interactive phase (`declaresInteractive(header)`) strictly inside a pair: `interactive phase sits between oracle phase-02 and its discharging phase-04`.
- §5.12 on the phase: an interactive phase that declares an oracle phase gets `an interactive phase takes no oracle role: it declares an oracle phase`. An interactive phase that is a pair's discharging phase gets `an interactive phase takes no oracle role: it discharges phase-02`.
- §5.13 on the oracle phase, for every well-formed declaration when `providerConfigured` is false: `oracle phase declared, but no "oracles" provider is configured (phax.json, phax.local.json or ~/.phax/config.json)`.
- Then keep the not-yet-supported refusal: `unsupportedOracleFindings` stays exported and unchanged, and its rows (one per well-formed declaration) come last. phase-03 deletes it. Order the rows: the §5.5 rows per header in plan order, then the rule rows grouped in §5.6 … §5.13 order, each group in plan order, then the refusal rows. Lint and the preflight must give identical lists for the same plan.md, planned files and provider flag.
- Lint (`src/app/lintPlan.ts`). Call `oracleFindings` exactly once per lint. When the deterministic parse or finalization fails, call it on the early-return path with `phases: null`. Otherwise call it with the finalized plan's phases. In both cases pass `providerConfigured: config.oracles !== undefined`. Never spawn the provider (§5.21). Remove the current header-only call beside `interactiveFindings`, so no row is reported twice.
- Preflight (`src/app/runPreflight.ts`). The `oracle-phases` check calls `oracleFindings({ headers, phases: input.plan.phases, providerConfigured: input.config.oracles !== undefined })` and refuses any error with the existing `OraclePreflightError` and `declarationRefusalMessage("Oracle", …)`. Move it directly before `interactive-phases` in RUN_PREFLIGHT_CHECKS (Technical arbitrations). `phax run` runs it before naming the run, and `phax resume` runs it again through executePlan's preflight block, so a resume after the `oracles` block was removed refuses with exit 11. A refused resume marks the run failed today, as every re-check does (NEXT_STEPS.md, Small follow-ups); do not promise otherwise. Exit 11 is already mapped for `OraclePreflightError` in `src/cli/commands/runLayers.ts`.
- Leave `unsupportedInteractiveFindings` and the `interactive` check untouched. Do not touch cliDocs, the README or the skills: phase-04 documents the whole feature.

### Planned files to create

- (none)

### Planned files to edit

- `src/schemas/phaxConfig.ts`
- `src/domain/config/mergeLayers.ts`
- `src/app/loadConfig.ts`
- `src/domain/plan/oracleCheck.ts`
- `src/app/lintPlan.ts`
- `src/app/runPreflight.ts`
- `phax.schema.json`
- `phax.user.schema.json`
- `tests/unit/oracleCheck.test.ts`
- `tests/integration/lintPlan.test.ts`
- `tests/unit/runPreflight.test.ts`
- `tests/integration/runPreflightBeforeNaming.test.ts`
- `tests/integration/resumePreflightRechecks.test.ts`
- `tests/unit/mergeLayers.test.ts`
- `tests/unit/cli/validate.test.ts`
- `tests/unit/phaxConfigJsonSchema.test.ts`

### Optional files that may be edited

- `src/domain/plan/lint.ts`
- `src/domain/errors.ts`
- `src/app/executePlan.ts`
- `tests/unit/loadConfig.test.ts`
- `tests/integration/loadConfigLayers.test.ts`
- `tests/unit/cli/schemaUpgrade.test.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`

### Boundary contracts

Producer `src/domain/plan/oracleCheck.ts` → consumers `src/app/lintPlan.ts` and `src/app/runPreflight.ts`: one pure function `oracleFindings({ headers, phases, providerConfigured })` returning `LintFinding[]` on the `oracles` check. Lint and the preflight must hand it the same inputs for the same plan, so that each lint error is exactly a preflight refusal (§5.14). Producer `src/schemas/phaxConfig.ts` / `src/domain/config/mergeLayers.ts` → every consumer of `ResolvedConfig`: an optional `oracles: { command }`, absent when no layer declares it. Later phases read `config.oracles !== undefined` (provider configured) and `config.oracles.command` (the step's command).

### Test strategy

Write the domain tests first (`tests/unit/oracleCheck.test.ts`), one per §8 lint criterion, from made-up plan.md fragments read through `readPhaseHeaders`. Each test asserts the exact `oracles` rows other than the trailing refusal rows, and that the refusal row is still present. The cases: last phase `yes`; `discharged by phase-01` on phase-02; a named phase absent from the plan; phase-03 in both roles; phase-03 discharging phase-01 and phase-02; an empty Oracle files line; `tests/other.test.ts` not planned, while the stub `src/refunds/index.ts` is not an oracle; `tests/refunds.test.ts` optional in phase-03 inside 02→04, and no row when the file moves to phase-05; an interactive phase-03 inside 02→04, and no row when it moves after phase-04; an interactive discharging phase; no provider configured, then provider configured. Add a case with `phases: null`: no §5.9/§5.10 rows, the others unchanged. Integration: `tests/integration/lintPlan.test.ts` runs `lintPlan` on temp-repo plans with and without `oracles` in phax.local.json only, and the fake `./fake-oracles` command is never spawned (assert through a Shell layer that records calls). Exit 1 comes from `hasLintErrors`. `tests/unit/runPreflight.test.ts` and `tests/integration/runPreflightBeforeNaming.test.ts` show that `phax run` refuses each defective plan with exit 11, printing every `oracles` error lint reports for the same plan and config (a plan that also carries an interactive phase shows its `oracles` rows, since the oracles check now runs first), names no run and creates no worktree or branch. `tests/integration/resumePreflightRechecks.test.ts`: a failed run whose `oracles` block has since been removed refuses `phax resume --yes` with exit 11, and its state and last error are unchanged. Config: `tests/unit/mergeLayers.test.ts` covers the override order; `tests/unit/cli/validate.test.ts` covers the three §8 variants (valid, `timeout` → exit 2 naming it, empty `command` → exit 2 naming it) and a configured step with `"surface": "oracle"` → exit 2 naming the surface; `tests/unit/phaxConfigJsonSchema.test.ts` covers both JSON Schemas describing `oracles`, with a required non-empty `command` and no other key.

### Implementation order

1. Domain check and its unit tests (`oracleCheck.ts`).
2. Config schema, merge and resolved config, with their tests.
3. Lint wiring, then preflight wiring, with their integration tests.
4. `pnpm dev schema upgrade` and the JSON Schema test.

### Excluded scope

- Removing `unsupportedOracleFindings` or letting an oracle phase run (phase-03).
- The oracle-request format, the `oracle` surface and any persisted shape change (phase-02).
- Any change to the interactive check or its refusal.
- A `Preflight will fail` line in `phax run --dry-run`.
- cliDocs, `phax --usage`, README, skills and docs pages (phase-04).

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

The exact signature of `oracleFindings` and of `OracleCheckInput` / `OracleCheckPhase` in `src/domain/plan/oracleCheck.ts`, the order of its rows, and the fact that `unsupportedOracleFindings` still runs last and is still exported (phase-03 deletes it). The name and type of `OraclesConfig` and `ResolvedConfig.oracles`. Where lint calls the check, on its early-return and parsed paths. That RUN_PREFLIGHT_CHECKS is unchanged. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(oracles): check oracle pairs in lint and the run preflight, and accept an oracles provider block`

### Commit body

Add the optional `oracles: { command }` provider block to phax.json and both user overlays, merged across layers like `architecture`, and describe it in phax.schema.json and phax.user.schema.json.

The `oracles` check now holds a plan to every rule of the oracle-phases spec: the discharging phase exists and comes after; one role per phase and one-to-one pairs; at least one oracle file, each planned by the oracle phase; no oracle file planned between a pair; no interactive phase inside a pair or in an oracle role; and a configured provider. One pure function serves `phax plans lint` and the `phax run` / `phax resume` start preflight, which refuses with exit 11 on exactly lint's errors. The not-yet-supported refusal stays until the oracle step can run.

---

## phase-02 — The oracle-request format, the recorded oracle surface and the record's oracle role {#phase-02-oracle-formats}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

phax gains the persisted shapes an oracle step needs. A new `oracle-request` format is born with `$schema`, with two explicit variants. Gate-attribution step results and the phase record's `verifiedSurfaces` accept the `oracle` surface. The phase record manifest carries the phase's oracle role. Each changed format gets a `next` snapshot and a frozen decoder for its current shape, and older documents stay readable. A pure pair resolution names each phase's oracle role, and the record writer already records it.

### Detailed instructions

- Surfaces. In `src/schemas/surface.ts`, keep `SurfaceSchema` / `Surface` as the configured three (phax.json gate steps import it), and add `RecordedSurfaceSchema = Schema.Literal("local", "structural", "product", "oracle")` with its type `RecordedSurface`, documented as the surface a recorded step carries: a configured one, or `oracle`, carried only by the step phax appends. `src/schemas/gateAttribution.ts` step results use `RecordedSurfaceSchema`. Switch every recorded-surface consumer to `RecordedSurface`: `src/domain/gate/verifiedSurfaces.ts`, `src/app/gateAttribution.ts`, `src/domain/records/assemble.ts`, `src/app/writeRecord.ts`, `src/app/finalReport.ts`, `src/domain/publish/prBody.ts`, `src/app/recordsList.ts`. `GateStepSchema` in phaxConfig.ts keeps `SurfaceSchema`. The verified-surface rule is unchanged, so `oracle` is verified by the same rule as any surface (§5.30).
- Phase record manifest. In `src/schemas/runRecord.ts`, `verifiedSurfaces` becomes `Schema.Array(RecordedSurfaceSchema)`, and a new required key `oracle` follows it. Its value is `Schema.NullOr(Schema.Union(Schema.Struct({ role: Schema.Literal("oracle"), dischargedBy: <phase-NN id> }), Schema.Struct({ role: Schema.Literal("discharging"), oraclePhase: <phase-NN id> })))`: explicit per-variant, every key required, no other key. Export the type as `RecordOracleRole`.
- Reader lift (`src/schemas/persisted.ts`). In `readPhaseRecordManifestAs`, a manifest whose `$schema` names phase-record-manifest below its current stamp (`isStampedBelowCurrent`) is decoded by the new frozen 0.17.0 module and lifted with `oracle: null`. A pre-schema manifest is lifted with `oracle: null` too. A current-stamped manifest without `oracle` is refused, with no optional fallback. gate-attribution needs no lift: the current decoder reads every earlier stamp, because the widened enum is a superset.
- Frozen modules: never edit an existing one. Create `src/schemas/history/gate-attribution/0.21.0.ts`: the 0.21.0 shape, `$schema` first, `surface` local | structural | product, `result` pass | fail | refused. Create `src/schemas/history/phase-record-manifest/0.17.0.ts`: today's `RunRecordManifestFileSchema` with no `oracle` and the three-value `verifiedSurfaces`, with every nested schema (token usage, outcome, provider id, shape) inlined. Both import only `effect` and carry the header comment the 0.20.0 gate-attribution module carries. Add them to the frozen-module list in `tests/unit/architecturalGuards.test.ts`.
- New format. Create `src/schemas/oracleRequest.ts`, modelled on `src/schemas/architecture.ts` and `src/schemas/gateRequest.ts`. `OracleRequestFileSchema` is a union of two structs, each with `$schema: schemaUrlField("oracle-request")` first. Authored: `verdict: "authored"`, `phase`, `oraclePhase`, `base`, `files`. Discharged: `verdict: "discharged"`, `phase`, `oraclePhase`, `base`, `oracleCommit`, `files`. Phase ids match `^phase-\d{2}$`. `base` and `oracleCommit` are `FullCommitShaSchema`. `files` is a non-empty array of non-empty strings in declaration order. Every key is required, and `oracleCommit` exists on `discharged` only. Decode with `onExcessProperty: "error"`. Give each key the descriptions §4 and §5.22 use (base: the oracle phase's base commit, on both variants). Export `OracleRequestFile`, `OracleRequest` (without `$schema`), `decodeOracleRequestFile` and `encodeOracleRequestFile`.
- Append `oracle-request` to `FORMAT_IDS` and `SCHEMA_BORN_FORMAT_IDS` in `src/schemas/schemaUrl.ts`, keeping existing order and extending the doc comments.
- Schemas package. Create `packages/schemas/src/formats/oracleRequest.ts`, modelled on `packages/schemas/src/formats/architecture.ts`: `oracleRequestFormat`, `parseOracleRequest`, `LatestOracleRequest`, `toLatestOracleRequest`. Register it in `packages/schemas/src/index.ts` (exports, shape map, format map) and `packages/schemas/build/jsonSchemas.ts`. In `packages/schemas/src/formats/recordTimeline.ts`, add the `0.21.0` release to gate attribution, with its `toLatestGateAttribution` overload. In `packages/schemas/src/formats/recordManifests.ts`, add the `0.17.0` release to the phase record manifest. `toLatestPhaseRecordManifest` keeps returning `LatestPhaseRecordManifest`: it lifts a pre-schema or 0.17.0 manifest to the latest shape, which the package README promises, as phax's own reader does. Write the recorded surface set unchanged, since no earlier phax could run an oracle phase and `oracle` never appears in it. Unlike gate attribution, an older manifest is not a subset of the latest, so it is lifted rather than kept under its own type.
- Run `pnpm exec tsx scripts/schemas-check.ts --write`. It writes `packages/schemas/snapshots/oracle-request/next.schema.json`, `gate-attribution/next.schema.json` and `phase-record-manifest/next.schema.json`, and refreshes `packages/schemas/history.lock.json`, `packages/schemas/src/generated/index.ts` and `src/schemas/release.ts`. Never hand-edit those generated files. Confirm that no release-named snapshot changed, and that gate-request, gate-report, plan-document and phax-plan are untouched.
- Pair resolution. Create `src/domain/plan/oraclePairs.ts`, pure, over `ReadonlyArray<Pick<PhaxPlanPhase, "id" | "oracle">>`. It exports `OraclePair { oraclePhase, dischargingPhase, files }`, `OracleRole = { role: "oracle"; pair } | { role: "discharging"; pair }`, `oraclePairs(phases)` (plan order, from each phase's non-null `oracle`) and `oracleRoleOf(phases, phaseId): OracleRole | null`. It also exports `recordOracleRole(role: OracleRole | null): RecordOracleRole`: null, `{ role: "oracle", dischargedBy }` or `{ role: "discharging", oraclePhase }`.
- Record writer. `AssembleRecordInput` and `WriteRecordInput` gain a required `oracle: RecordOracleRole`. `assembleRecord` places it after `verifiedSurfaces`. In `src/app/executePlan.ts`, `writeRecordForPhase` passes `oracle: recordOracleRole(oracleRoleOf(plan.phases, args.phaseId))`. No other runtime behaviour changes in this phase: no oracle step exists yet.
- README. Add an `Oracle request` row to the persisted-formats table: format id `oracle-request`, written on the oracles provider's stdin and saved as `<run folder>/<phase-id>/checks-attempt-NN.oracle-request.json`, read with `parseOracleRequest`, JSON Schema `json/oracle-request.schema.json`. Follow the existing rows' columns, so `tests/unit/readmePersistedFormats.test.ts` passes.
- Update the schemas-package fixtures and type tests the new format and the new releases require: `tests/unit/schemasPackage/documents.ts` gets a made-up authored oracle-request sample and a manifest sample with `oracle`; `tests/unit/schemasPackage/exports.test.ts` and `tests/type/schemasPackage.ts` get the new exports and frozen types. Then fix whatever other `tests/unit/schemasPackage/*` test lists formats or releases.
- Keep every test and script that builds a current-stamped record or manifest decoding. Add the new required fields to `tests/unit/authoringRecord.test.ts`'s phase manifest and to `smokeRecordManifest` in `scripts/schemas-smoke.ts` (with `tests/unit/schemasSmoke.test.ts`), which CI and the release run. In `tests/integration/persistedProducer.test.ts`, add `oracle-request` to `NEVER_WRITTEN`, with a note saying it holds until the oracle step lands in phase-03.

### Planned files to create

- `src/schemas/oracleRequest.ts`
- `src/schemas/history/gate-attribution/0.21.0.ts`
- `src/schemas/history/phase-record-manifest/0.17.0.ts`
- `packages/schemas/src/formats/oracleRequest.ts`
- `packages/schemas/snapshots/oracle-request/next.schema.json`
- `packages/schemas/snapshots/gate-attribution/next.schema.json`
- `packages/schemas/snapshots/phase-record-manifest/next.schema.json`
- `src/domain/plan/oraclePairs.ts`
- `tests/unit/oraclePairs.test.ts`
- `tests/unit/schemas/oracleRequest.test.ts`
- `tests/unit/schemasPackage/oracleRequestFormat.test.ts`

### Planned files to edit

- `src/schemas/surface.ts`
- `src/schemas/gateAttribution.ts`
- `src/schemas/runRecord.ts`
- `src/schemas/schemaUrl.ts`
- `src/schemas/persisted.ts`
- `src/schemas/release.ts`
- `packages/schemas/src/index.ts`
- `packages/schemas/src/generated/index.ts`
- `packages/schemas/src/formats/recordTimeline.ts`
- `packages/schemas/src/formats/recordManifests.ts`
- `packages/schemas/build/jsonSchemas.ts`
- `packages/schemas/history.lock.json`
- `src/domain/gate/verifiedSurfaces.ts`
- `src/app/gateAttribution.ts`
- `src/domain/records/assemble.ts`
- `src/app/writeRecord.ts`
- `src/app/finalReport.ts`
- `src/domain/publish/prBody.ts`
- `src/app/recordsList.ts`
- `src/app/executePlan.ts`
- `README.md`
- `tests/unit/verifiedSurfaces.test.ts`
- `tests/unit/gateAttribution.test.ts`
- `tests/unit/runRecord.test.ts`
- `tests/unit/recordsAssemble.test.ts`
- `tests/integration/writeRecord.test.ts`
- `tests/unit/schemaUrl.test.ts`
- `tests/unit/persisted.test.ts`
- `tests/unit/schemasPackage/documents.ts`
- `tests/unit/schemasPackage/exports.test.ts`
- `tests/type/schemasPackage.ts`
- `tests/unit/architecturalGuards.test.ts`
- `tests/unit/authoringRecord.test.ts`
- `scripts/schemas-smoke.ts`
- `tests/unit/schemasSmoke.test.ts`
- `tests/integration/persistedProducer.test.ts`

### Optional files that may be edited

- `tests/unit/gateAttribution.reader.test.ts`
- `tests/unit/readmePersistedFormats.test.ts`
- `tests/unit/schemasPackage/recordTimeline.test.ts`
- `tests/unit/schemasPackage/recordManifests.test.ts`
- `tests/unit/schemasPackage/phaseRecordManifestHistory.test.ts`
- `tests/unit/schemasPackage/snapshots.test.ts`
- `tests/unit/schemasPackage/currentShapes.test.ts`
- `tests/unit/schemasPackage/jsonSchemas.test.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/frozenHistory.test.ts`
- `tests/unit/schemasPackage/documents.test.ts`
- `tests/unit/schemasPackage/parseDocument.test.ts`
- `tests/unit/schemasPackage/shapes.test.ts`
- `tests/unit/schemasPackage/manifest.test.ts`
- `tests/integration/recordsExplain.test.ts`
- `tests/integration/finalReport.test.ts`
- `tests/unit/publish/prBody.test.ts`
- `src/cli/commands/records.ts`
- `src/schemas/phaxConfig.ts`

### Boundary contracts

Producer `src/schemas/oracleRequest.ts` → consumers: phase-03's gate runner (encodes a request with `withSchemaUrl("oracle-request", …)`) and the schemas package (`parseOracleRequest`). Two variants keyed by `verdict`, each with exactly its keys. Producer `src/schemas/surface.ts` → `RecordedSurface` for attribution, verified surfaces, records, final report and PR body; configured gate steps keep `Surface`. Producer `src/domain/plan/oraclePairs.ts` → consumers in phases 03 and 04 (gate runtime, reset, reconciliation, prompt, handoff, records): `oraclePairs`, `oracleRoleOf` and `OracleRole`, pure, resolved from `phax-plan.json`'s `oracle` keys. Producer `src/schemas/runRecord.ts` → `phax records explain` (phase-04): a required `oracle: RecordOracleRole` on every phase record manifest.

### Test strategy

Write first: `tests/unit/schemas/oracleRequest.test.ts`. Both variants decode, with `$schema` asserted by format id and release pattern. `oracleCommit` on an authored request, its absence on a discharged one, an extra key, an empty `files`, a short commit and `verdict: "approved"` are each refused. `tests/unit/oraclePairs.test.ts`: pairs and roles for a five-phase plan with pair 02→04, and null for every other phase. Then the shape tests: `tests/unit/gateAttribution.test.ts` and `tests/unit/verifiedSurfaces.test.ts` (an `oracle` step result decodes; `oracle` is verified only when its step passed; sorted output gives `local, oracle, structural`); `tests/unit/runRecord.test.ts` and `tests/unit/recordsAssemble.test.ts` (`oracle` required, both variants, null); `tests/unit/persisted.test.ts` (a 0.17.0-stamped manifest and a pre-schema manifest read with `oracle: null`; a current-stamped manifest without `oracle` refused; a 0.21.0-stamped attribution still reads); `tests/integration/writeRecord.test.ts` (the written manifest carries `oracle`); `tests/unit/schemaUrl.test.ts` (`oracle-request` is a schema-born format id). Schemas package: `tests/unit/schemasPackage/oracleRequestFormat.test.ts`, modelled on `architectureFormats.test.ts`, plus the existing snapshot, history-lock and parity tests, which `pnpm test` runs. `tests/unit/cli/validate.test.ts` from phase-01 must still refuse `"surface": "oracle"` on a configured step.

### Implementation order

1. `surface.ts` split and the attribution / verified-surface consumers.
2. `oracleRequest.ts` and the schema-url lists.
3. `runRecord.ts` `oracle` key, the frozen modules, and the reader lift in `persisted.ts`.
4. `oraclePairs.ts`, then `assemble.ts`, `writeRecord.ts` and the `executePlan.ts` record call.
5. Schemas package formats and registrations, then `pnpm exec tsx scripts/schemas-check.ts --write`.
6. README row, fixtures and type tests.

### Excluded scope

- Running the oracles provider, or any change to gates.ts, fixLoop.ts or the gate request (phase-03).
- Rendering the role in `phax records explain`, the handoff or the prompt (phase-04).
- Any change to gate-request, gate-report, plan-document or phax-plan shapes.
- Removing the not-yet-supported refusal (phase-03).

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

The exported names and module paths: `RecordedSurfaceSchema` / `RecordedSurface` (`src/schemas/surface.ts`); `OracleRequestFileSchema`, `OracleRequest`, `encodeOracleRequestFile` (`src/schemas/oracleRequest.ts`); `RecordOracleRole` (`src/schemas/runRecord.ts`); `OraclePair`, `OracleRole`, `oraclePairs`, `oracleRoleOf`, `recordOracleRole` (`src/domain/plan/oraclePairs.ts`), with their signatures. The paths of the two frozen modules and three `next` snapshots, and confirmation that `scripts/schemas-check.ts --write` produced them and changed no release-named snapshot. How the reader lifts older manifests. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(schemas): add the oracle-request format and the oracle surface to gate attribution and phase records`

### Commit body

Add the `oracle-request` format, born with `$schema`. It has two explicit variants: `authored` (verdict, phase, oraclePhase, base, files) and `discharged` (the same, plus oracleCommit). It joins FORMAT_IDS and SCHEMA_BORN_FORMAT_IDS and gets a schemas-package format and a `next` snapshot.

A recorded step's surface may now be `oracle`, in gate-attribution and in the phase record's verifiedSurfaces. A configured gate step keeps its three surfaces. The phase record manifest gains a required `oracle` role, and older manifests are read with `oracle: null`. Both formats get a frozen module for their current shape (gate-attribution 0.21.0, phase-record-manifest 0.17.0) and a `next` snapshot.

A pure pair resolution names each phase's oracle role, and the record writer records it.

---

## phase-03 — The oracle step in the gate loop, the pause, reset and reconciliation {#phase-03-oracle-step}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium
**Assignment reason:** The phase designs something no code here shows yet: a step phax appends itself, outside the configured profile. Its judging is shared with configured report steps, and it handles spawn failure and a time cap as a broken step. It is threaded through executePlan, resume, reconciliation and reset, across the gate, run-loop and reset parts. This calls for the stronger model.

An oracle phase and its discharging phase run. Once every configured step an attempt fires has passed, phax appends one oracle step. It spawns the configured `oracles` command in the phase's worktree, with an `authored` or `discharged` oracle request on stdin and a 120 s cap. It judges the provider's gate report exactly like an `output: "gate-report"` step and records it last, under the `oracle` surface. Findings drive the fix loop, a refusal pauses the phase with exit 4, provider errors fail the step, and an exhausted loop pauses the run, resumable. The discharge always names the oracle phase's current commit, its oracle-file edits count as planned, and `phax reset-phase` resets the discharge before its oracles. The not-yet-supported refusal is gone.

### Detailed instructions

- Request builder. Create `src/domain/gate/oracleRequest.ts`, pure. `makeOracleRequest({ role, phaseId, base, oracleCommit })` returns an `OracleRequest`: authored when `role.role === "oracle"`, with phase = oraclePhase = phaseId; discharged when `role.role === "discharging"`, with phase = the gated phase, oraclePhase = `role.pair.oraclePhase`, and the given `oracleCommit` (required non-null for this variant). `base` is always the oracle phase's base, and `files` the pair's oracle files in declaration order. Keys follow the format's order: verdict, phase, oraclePhase, base, then oracleCommit on discharged, then files. Also export `oracleRequestPathFor(attemptLogPath)`: `checks-attempt-01.log` → `checks-attempt-01.oracle-request.json`, mirroring `requestPathFor`.
- In `src/domain/gate/attemptFiles.ts`, add `oracle-request\.json` to `CHECKS_FILE`, so the saved request counts for attempt numbering, and extend the doc comment.
- Gate runner (`src/app/gates.ts`). Export `ORACLE_PROVIDER_TIMEOUT_MS = 120_000` and `serializeOracleRequest(request)`: `JSON.stringify(encodeOracleRequestFile(withSchemaUrl("oracle-request", request)), null, 2)`, as `serializeGateRequest` does. Add an optional `oracleStep?: { readonly command: string; readonly request: string; readonly timeoutMs: number }` to `RunGatesOptions`. Step results are `GateStepResult`, whose surface is now the recorded surface.
- Factor the existing `output: "gate-report"` judging block into one local helper used by configured report steps and the oracle step alike. It covers invalid UTF-8, empty stdout, non-JSON, `readGateReport` failure, saving the report as printed at `reportPathFor(log, position)`, the `report:` log line, refused → GateStepRefusedError, no finding with exit 0 → pass, no finding with non-zero exit → broken, and any finding → GateFailedError with `reportFindings`. Behaviour for configured steps must not change: run the existing gate tests unchanged.
- When `oracleStep` is set and every configured step has passed, run it as the attempt's last step. Its position is `steps.length + 1`, and its recorded surface and command are `oracle` and `oracleStep.command`. First write `oracleStep.request` to `oracleRequestPathFor(attemptLogPath)`. Log `$ <command>`, then `stdin: <request file name>`. Spawn through the Shell port with `parseCommandTokens(command)` (whitespace split, no shell), the gate's `cwd`, `stdin: request` and `timeoutMs`. Wrap the spawn in `Effect.either`. A `ShellError` (command not found, the cap reached) records `fail` for the oracle step, logs `provider error: <message>`, and fails the gate as a broken step (`failGate` with the error's `exitCode` when it has one, else -1, and no `reportFindings`). Otherwise hand the result to the shared judging helper. A configured step's failure or refusal still stops the attempt before the oracle step, so the provider is not spawned and the step record ends with the failing configured step.
- Fix loop (`src/app/fixLoop.ts`). Add `oracleStep?` to `RunGatesWithFixLoopOptions` and pass it unchanged to every attempt's `runGates`. Nothing else changes. Findings reach the fix prompt through `reportFindings`, and `previousFindingIds` finds the oracle step's earlier report through the step record by its command. A refusal pauses with no fix attempt (GateStepRefused). Exhaustion gives GateAttemptsExhaustedError, exit 4, resumable at the phase.
- Phase status (`src/app/phaseStatusUpdates.ts`). Add `readPhaseCommit(phaseFolderPath)`, which returns `status.json`'s `commitHash`. It fails with an FsError naming the phase when the hash is absent or is not a full object name.
- Run loop (`src/app/executePlan.ts`). At each gate entry, next to the gate request, compute `oracleRoleOf(plan.phases, phase.id)`. When it is not null, `config.oracles` must be defined, which the preflight guarantees. If it is not, fail with the `OraclePreflightError` built from `oracleFindings`, never skip the step. Build the request from `status.json` facts only, never from git. The authored base is `readPhaseBase(phaseFolderPath)`. For a discharge, the base is `readPhaseBase(join(runPath, pair.oraclePhase))` and `oracleCommit` is `readPhaseCommit(join(runPath, pair.oraclePhase))`. Recompute this on every phase entry, so a resume, a reset or a re-run names the oracle phase's current commit and base (§5.35). Pass `oracleStep: { command: config.oracles.command, request: serializeOracleRequest(...), timeoutMs: ORACLE_PROVIDER_TIMEOUT_MS }` to `runGatesWithFixLoop`. Keep the oracles command out of `gateCommandStrings`, out of every security grant and frozen command set, and out of the prompt's gate commands: it runs only from phax.
- Reconciliation. `src/app/reconcilePhaseFiles.ts` takes an extra `oracleFiles: readonly string[]` (required, possibly empty), merged into the `optional` planned set before `reconcile`. Add a pure helper `dischargedOracleFiles(phases, phaseId)` in `src/domain/plan/oraclePairs.ts`: the pair's files when the phase discharges one, else `[]`. executePlan passes it, so marker removal is never an unplanned edit (§5.34).
- Reset (`src/app/resetPhase.ts`). Add the reason `phase_blocked_by_discharge` to `ResetPhaseError`. After the target is found and before the later-committed rule, read `<runPath>/phax-plan.json` through the FileSystem port with `readPhaxPlanFile`, in any shape. When `oracleRoleOf` says the target is an oracle phase and its discharging phase has a status whose state is not `pending`, refuse: `Cannot reset "phase-02" of run "refunds": its discharging phase "phase-03" is failed — reset phase-03 first.` Change nothing on refusal. An unreadable plan adds no refusal. The CLI already exits 1 on a ResetPhaseError.
- Remove the refusal. Delete `unsupportedOracleFindings` from `src/domain/plan/oracleCheck.ts`, with its call, its doc comment mentions and its tests. A well-formed oracle pair with a configured provider now gives no `oracles` finding in lint or the preflight. Keep `unsupportedInteractiveFindings` as it is.
- Write tests against made-up repositories only (`acme-billing`, `refunds`). Fake providers are small `node` scripts written into the test's temp directory. They record their stdin and cwd to a file, and print a chosen gate report, a refusal, non-JSON, a report without `$schema`, or exit 3, or sleep past a tiny `timeoutMs` the test passes to `runGates`. Integration tests that start a full run follow `tests/integration/gateRefusal.test.ts`, with a fake backend, and give each run its own temporary repository.
- `tests/integration/persistedProducer.test.ts`: remove `oracle-request` from `NEVER_WRITTEN`, and drive `runGates` with an `oracleStep` so that the producer test sees phax write the request. Pass the new `oracleFiles` to its `reconcilePhaseFiles` call. In `tests/unit/phaseStatusUpdates.test.ts`, cover `readPhaseCommit`: a full hash is returned, and an absent or abbreviated hash fails, naming the phase.

### Planned files to create

- `src/domain/gate/oracleRequest.ts`
- `tests/unit/oracleRequest.test.ts`
- `tests/integration/oraclePhases.test.ts`

### Planned files to edit

- `src/app/gates.ts`
- `src/app/fixLoop.ts`
- `src/app/executePlan.ts`
- `src/app/phaseStatusUpdates.ts`
- `src/app/resetPhase.ts`
- `src/app/reconcilePhaseFiles.ts`
- `src/domain/gate/attemptFiles.ts`
- `src/domain/plan/oracleCheck.ts`
- `src/domain/plan/oraclePairs.ts`
- `tests/integration/gates.test.ts`
- `tests/integration/fixLoop.test.ts`
- `tests/integration/resetPhase.test.ts`
- `tests/unit/attemptFiles.test.ts`
- `tests/unit/oracleCheck.test.ts`
- `tests/unit/oraclePairs.test.ts`
- `tests/integration/lintPlan.test.ts`
- `tests/unit/runPreflight.test.ts`
- `tests/integration/runPreflightBeforeNaming.test.ts`
- `tests/integration/resumePreflightRechecks.test.ts`
- `tests/integration/persistedProducer.test.ts`
- `tests/unit/phaseStatusUpdates.test.ts`

### Optional files that may be edited

- `src/domain/errors.ts`
- `src/cli/commands/resetPhase.ts`
- `src/app/resumeInstructions.ts`
- `tests/integration/gateRefusal.test.ts`
- `tests/integration/reconciliation.test.ts`
- `tests/integration/resume.test.ts`
- `tests/unit/reconciliation/reconcile.test.ts`

### Boundary contracts

Consumer `src/app/executePlan.ts` → producer `src/app/gates.ts` (through `src/app/fixLoop.ts`): `oracleStep: { command, request, timeoutMs }`, where `request` is the exact bytes written on stdin and saved beside the log. The runner appends the step only after every configured step passed, records it last under the `oracle` surface, and judges it with the code that judges configured report steps. The runner never decides whether a phase has an oracle role; executePlan does, through `oracleRoleOf`. Consumer `src/app/resetPhase.ts` → producer `src/schemas/persisted.ts` `readPhaxPlanFile` and `src/domain/plan/oraclePairs.ts`. Consumer `src/app/reconcilePhaseFiles.ts` → `dischargedOracleFiles`, merged into the optional set. Shell port contract: `timeoutMs` expiry and spawn failure surface as `ShellError`, which the oracle step turns into a broken step, never an effect error.

### Test strategy

Write first: `tests/unit/oracleRequest.test.ts` (both variants, key order, `oracleCommit` only on discharged, the base is the oracle phase's) and `tests/unit/attemptFiles.test.ts` (`checks-attempt-02.oracle-request.json` numbers attempt 2). `tests/integration/gates.test.ts`, with fake Shell or real node scripts: no spawn when a configured step fails, and the record ends with that step; a pass appends `{ command, surface: "oracle", result: "pass" }` last, and the report is saved byte for byte as `report-SS` at position steps+1; a finding fails with `reportFindings`; a refusal gives GateStepRefusedError with result `refused`; each §5.27 error (missing command, non-JSON, no `$schema`, exit 3 with no finding, sleep past a small `timeoutMs`) records `fail` and the log names the reason; a three-step profile attribution lists the three configured steps unchanged and in order, then only the oracle step; phax reads no oracle file path (a FileSystem layer that records reads); configured steps behave exactly as before. `tests/integration/fixLoop.test.ts`: one finding on attempt 1 and none on attempt 2 with `maxFixAttempts` 1, then the fix prompt carries the finding's message and location, the provider is queried again, and the phase passes. `tests/integration/oraclePhases.test.ts`, full runs with a fake backend: a three-phase plan with pair 02→03 and a two-step profile. Phase-02's provider stdin is authored, base equals phase-01's full commit, files are the two oracle files, there is no `oracleCommit`, cwd is phase-02's worktree before commit, and the request is saved. Phase-03 gets discharged with `oracleCommit` = the full tip of `<run.branch>--phase-02`. A five-phase plan with pair 02→04 calls the provider only at phases 02 and 04, never from lint, validate or the preflight. A refusal exits 4 printing reason and remedy, and `phax resume` runs that gate again. An always-finding discharge exhausts with exit 4, and resume sends the same `oracleCommit`. The discharge edits oracle files it does not list, and `file-reconciliation.json` shows no unplanned edit. Reset of phase-02 while phase-03 is failed refuses naming phase-03 and changes nothing; reset phase-03, then phase-02, then resume, and phase-03's request names phase-02's new commit. A plan with no oracle phase, with and without a provider configured, produces the same attribution, no oracle step and no spawn (§5.40). `tests/integration/resetPhase.test.ts` covers the new reason. Update `tests/unit/oracleCheck.test.ts`, `tests/integration/lintPlan.test.ts`, `tests/unit/runPreflight.test.ts`, `tests/integration/runPreflightBeforeNaming.test.ts` and `tests/integration/resumePreflightRechecks.test.ts`: the refusal row is gone, and a well-formed pair with a provider has no `oracles` finding.

### Implementation order

1. `oracleRequest.ts` builder and `attemptFiles.ts`, with unit tests.
2. Factor the report-judging helper in `gates.ts` with the existing gate tests green, then add the oracle step.
3. `fixLoop.ts` pass-through and `readPhaseCommit`.
4. `executePlan.ts` wiring, then reconciliation.
5. `resetPhase.ts` rule.
6. Delete `unsupportedOracleFindings` and update the lint and preflight tests.
7. `tests/integration/oraclePhases.test.ts` end to end.

### Excluded scope

- The review handoff's oracle pairs, `phax records explain`'s role line and the phase prompt's role paragraph (phase-04).
- The headless plan authoring prompt, the skills and every doc (phase-04).
- Any provider implementation or test-framework knowledge in `src/` (plan 2 ships the example).
- Granting the oracles command to the phase agent.
- Changes to the interactive refusal, the gate request or the gate report.

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

The shape of `RunGatesOptions.oracleStep` and `ORACLE_PROVIDER_TIMEOUT_MS`; `makeOracleRequest`, `oracleRequestPathFor`, `readPhaseCommit` and `dischargedOracleFiles`, with their module paths. Where executePlan builds the request, and that the oracles command is in no grant or prompt list. The saved request file name and the report position rule. The new ResetPhaseError reason and its message. Confirmation that `unsupportedOracleFindings` is deleted and the interactive refusal untouched. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(gates): run the oracles provider at the gate of an oracle phase and its discharging phase`

### Commit body

Once every configured step an attempt fires has passed, the gate of an oracle phase or its discharging phase appends one oracle step. It runs the configured `oracles` command in the phase's worktree, with no shell, an `authored` or `discharged` oracle request on stdin and a 120 s cap. Its gate report is judged by the same code as any report step and recorded last, under the `oracle` surface. Findings drive the fix loop. A refusal pauses the phase with no fix attempt (exit 4). A provider that cannot be spawned, outruns the cap or prints no readable report fails the step. An exhausted loop pauses the run, resumable at that phase.

The discharged request names the oracle phase's current commit and base, read from its status, so a resume, reset or re-run judges the right commit. Marker removal in the oracle files is never an unplanned edit. `phax reset-phase` refuses to reset an oracle phase until its discharging phase is reset. The not-yet-supported refusal of oracle phases is removed.

---

## phase-04 — Oracle pairs in the handoff, records and prompts, and the docs {#phase-04-oracle-surfaces-docs}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

Everything a person or an agent reads around an oracle run now says what happened and what to do. The review handoff lists every oracle pair with each side's last oracle-step result. `phax records explain` names a phase's oracle role, its counterpart and its last oracle-step result. The prompt of an oracle phase and of a discharging phase states the role in a fixed wording that names no framework. The headless plan authoring prompt says whether an `oracles` provider is configured. The phax-planning and phax-decide-plan skills, `phax --usage`, the README, a new docs page, `docs/upgrading.md` and `NEXT_STEPS.md` teach the feature.

### Detailed instructions

- Review handoff (§5.31). In `src/domain/plan/oraclePairs.ts`, add a pure renderer `renderOraclePairsSection(rows)`, with rows of `{ oraclePhase, dischargingPhase, authored, discharged }` and each result `pass` | `fail` | `refused` | `not run`. It produces `## Oracle pairs` and the §6 table (`| Oracle phase | Discharged by | Authored | Discharged |`), and returns undefined for no rows. In `src/app/loadReviewHandoffInputs.ts`, add a loader that reads the run's `phax-plan.json` (`readPhaxPlanFile`, any shape) and, for each pair, each side's `gate-attribution.json`: the last step with surface `oracle`, or `not run`. Pass the section through `ReviewHandoffExtras` as `oraclePairsMd`, rendered in `src/app/reviewHandoff.ts` after `## Deviations not explained in any handoff` and before the compliance review. Write no section when the plan declares no oracle phase. Both handoff builders (the run's and the review-handoff command's) get it.
- Records explain (§5.32). In `src/app/recordsExplain.ts`, add `oracleStep: { command, result } | null` to `ExplainedRecord`: the last step with surface `oracle` in the record's own `gate-attribution.json` artifact, read with `readGateAttributionFile`, or null. Extend `gateArtifactsInOrder` to list `checks-attempt-NN.oracle-request.json` right after the attempt's `.request.json`. In `src/cli/commands/records.ts` `renderFoundRecord`, when `manifest.oracle` is not null, print one line after the gates line: `oracle   oracle phase, discharged by phase-03 — <command>: pass`, or `oracle   discharges phase-02 — <command>: pass` (`not run` when no oracle step is recorded). Print nothing when it is null.
- Phase prompt (§5.33). `BuildPhasePromptOptions` in `src/app/promptGeneration.ts` gains a required `oracleRole: OracleRole | null`. When it is not null, add a `## Oracle role` section right after `## Approved plan: current phase`, with one fixed paragraph per role naming the counterpart phase and the oracle files. Oracle phase: `This phase writes the oracles that phase-03 will discharge. In the oracle files (tests/refunds.test.ts, tests/prune.test.ts), every test you add or modify must carry your test framework's expected-failure marker, so that the test command stays green. You may delete tests. The oracles provider checks this at the gate.` Discharging phase: `This phase discharges the oracles phase-02 wrote. In the oracle files (…), the only change allowed is removing every expected-failure marker. Make the implementation satisfy the oracles as written. If an oracle cannot pass unchanged, stop and say so in the handoff: that is a spec question, not a bug to work around.` Never name a framework or a marker (`fails`, `xfail`, Vitest, pytest, Jest). With null, the prompt is byte for byte unchanged, so the existing snapshot holds. `src/app/executePlan.ts` passes `oracleRoleOf(plan.phases, phase.id)`.
- Authoring prompt (§5.37, §5.38). `AuthoringPromptInput` in `src/domain/authoring/prompt.ts` gains `oraclesProvider: boolean | null` (null for a spec). For a plan, add one bullet right after the architecture bullet. Configured: `- An oracles provider is configured ("oracles" in phax config): you may declare an oracle phase and its discharging phase, as the skill's oracle-phase section says.` Not configured: `- No oracles provider is configured: declare no oracle phase; every phase's \`oracle\` is null.` Spec prompts are unchanged. Thread it through `src/app/authorArtifact.ts`, and from `src/cli/commands/artifact.ts` as `config.oracles !== undefined`, beside `architectureProvider`. Grant nothing new: `src/domain/security/agentCommands.ts` is not touched, and no provider runs at authoring.
- phax-planning skill (§5.39), `.claude/skills/phax-planning/SKILL.md`. Add an `## Oracle phases` section, after `## Planned files and end-of-phase reconciliation`, stating these points. Declare an oracle phase only when an `oracles` provider is configured: the authoring prompt says so, or check `oracles` in phax.json and its overlays by hand; without one, keep tests and code in one phase. The two header lines (`**Oracle phase:** yes` or `discharged by phase-NN`, and `**Oracle files:** <paths>`) sit after the model, effort and Assignment reason lines. The oracle files are a subset of the oracle phase's planned files to create or edit, and the phase may plan stubs that are not oracles. Every test the oracle phase adds or modifies carries the runner's expected-failure marker, and it may delete tests. The discharging phase (the next phase, or the one named) removes the markers and writes the code; removing the markers is its only change to the oracle files. No phase in between plans an oracle file, no interactive phase sits in between or takes an oracle role, and one phase discharges one oracle phase.
- Also update the skill's existing statements that oracle phases are refused. That covers the `**interactive** and **oracles**` lint description, the paragraph after the per-phase field table, the headless authoring bullet `mode: "headless" and oracle: null on every phase in this release`, and the `oracle` row of the field table. Say that oracle phases run when a provider is configured (headless, `oracle: { dischargedBy, files }` in the document), while interactive phases are still refused. Leave the generated blocks (`phase-model-policy`, `model-catalog`) untouched.
- phax-decide-plan skill, `.claude/skills/phax-decide-plan/SKILL.md`, P3: `list those files as read-only for the implementing phase` becomes `the implementing phase changes those files only by removing the markers, judged by the oracles provider`. Rephrase `the implementing phase must not touch it` the same way. Keep the rest of P3.
- `phax --usage` (`src/cli/cliDocs.ts`). In `run`, add a paragraph with the oracle step contract. The step runs only at the gate of an oracle phase or its discharging phase, after every configured step passed. It uses `oracles.command`, split on whitespace with no shell, in the phase worktree before commit, with a 120 s limit. The stdin `oracle-request`, `{$schema, verdict: authored | discharged, phase, oraclePhase, base, files}` plus `oracleCommit` on `discharged`, is saved as `checks-attempt-NN.oracle-request.json`. The stdout gate report is judged as a report step and saved as `report-SS`. Findings fix, a refusal exits 4, provider errors fail the step, and the step is recorded under the `oracle` surface. In `run` and `resume`, describe the `Oracle preflight failed` refusal (exit 11) and that a missing provider refuses there. Rewrite the `plans lint` `oracles` description to name its rules and the provider rule, and to say that the provider is never spawned. Then run `pnpm gen:usage-spec` and `pnpm docs:cli`, and commit the regenerated `phax.usage.kdl` and `docs/cli/reference.md`.
- README: add `### Oracle provider` after `### Architecture provider` (§11), with the `oracles` block example (`{ "oracles": { "command": "node tools/vitest-oracles.mjs" } }`). Explain the two verdicts, the request and answer formats, that lint and the preflight refuse an oracle phase without a provider (exit 11), and the exit-4 pause. Link to the new page. Create `docs/oracle-phases.md` following §11 for both readers (the owner configuring a provider, the planner), with the acme-billing example: phase-02 authors `test.fails('caps a refund at the invoice total', …)`, the authored request, phase-03's discharge, the `toBe(120)` → `toBe(100)` finding driving the fix loop, and the exit-4 pause for an oracle that cannot pass. Register it as `/guide/oracle-phases` in `site/pages.ts` and `site/build/sources.ts`, beside `architecture-provider`.
- `docs/upgrading.md`, 0.26.0: add `- **Oracle phases** need an \`oracles\` provider: \`phax plans lint\` and \`phax run\` refuse an oracle phase without one.` Nothing to run; phase records written earlier read with no oracle role.
- `NEXT_STEPS.md`: move `oracle-phases` to In flight. Plan 1 of 2 (the provider block, the shared check, the oracle step, the formats, and the surfaces around the run) has landed. Plan 2 (the example Vitest provider and phax's own `oracles` declaration) follows. Drop any wording that waits for `steme oracles`.
- README: reword the `phax plans lint` paragraph that says "an interactive or oracle phase is refused until a later release runs it". An interactive phase is still refused. An oracle phase runs with a configured `oracles` provider and is refused without one. Thread the new authoring input through the fixtures of `tests/integration/authorArtifactRetry.test.ts` and `tests/integration/persistedProducer.test.ts`.

### Planned files to create

- `docs/oracle-phases.md`
- `tests/unit/planningSkillOracles.test.ts`

### Planned files to edit

- `src/domain/plan/oraclePairs.ts`
- `src/app/loadReviewHandoffInputs.ts`
- `src/app/reviewHandoff.ts`
- `src/app/recordsExplain.ts`
- `src/cli/commands/records.ts`
- `src/app/promptGeneration.ts`
- `src/app/executePlan.ts`
- `src/domain/authoring/prompt.ts`
- `src/app/authorArtifact.ts`
- `src/cli/commands/artifact.ts`
- `src/cli/cliDocs.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `.claude/skills/phax-planning/SKILL.md`
- `.claude/skills/phax-decide-plan/SKILL.md`
- `README.md`
- `site/pages.ts`
- `site/build/sources.ts`
- `docs/upgrading.md`
- `NEXT_STEPS.md`
- `tests/unit/oraclePairs.test.ts`
- `tests/unit/reviewHandoffContent.test.ts`
- `tests/integration/reviewHandoff.test.ts`
- `tests/integration/recordsExplain.test.ts`
- `tests/unit/promptGeneration.test.ts`
- `tests/unit/authoringPrompt.test.ts`
- `tests/integration/authorArtifact.test.ts`
- `tests/integration/authorArtifactRetry.test.ts`
- `tests/integration/persistedProducer.test.ts`

### Optional files that may be edited

- `tests/unit/__snapshots__/promptGeneration.test.ts.snap`
- `tests/integration/oraclePhases.test.ts`
- `tests/integration/reviewHandoffCommand.test.ts`
- `src/domain/runReviewInfo.ts`
- `tests/unit/skills.test.ts`
- `tests/integration/usageSpecDrift.test.ts`
- `tests/integration/usageSpecExamples.test.ts`

### Boundary contracts

Producer `src/domain/plan/oraclePairs.ts` (`oraclePairs`, `oracleRoleOf`, `renderOraclePairsSection`) → consumers: the handoff loader, the prompt builder and executePlan. Producer: the phase record manifest's `oracle` and the record's `gate-attribution.json` artifact → consumer `src/app/recordsExplain.ts` / `src/cli/commands/records.ts`: the role comes from the manifest, the command and result from the artifact. Producer `src/cli/commands/artifact.ts` → `src/app/authorArtifact.ts` → `src/domain/authoring/prompt.ts`: `oraclesProvider: boolean | null`, null for a spec. Producer `src/cli/cliDocs.ts` → the generated usage spec and CLI reference.

### Test strategy

Write first: `tests/unit/oraclePairs.test.ts` for `renderOraclePairsSection` (one pair pass/pass gives the §6 table; no rows gives undefined) and `tests/unit/promptGeneration.test.ts`. The role paragraph names the counterpart and the files. Prompts for the same pair in two made-up projects are identical apart from those names, and contain none of `fails`, `xfail`, `vitest`, `pytest`, `jest` (case-insensitive). A null role leaves the snapshot unchanged. `tests/unit/reviewHandoffContent.test.ts` and `tests/integration/reviewHandoff.test.ts`: a run with pair 02→03 passed on both sides lists phase-02, phase-03, pass, pass; a run with no oracle phase has no `## Oracle pairs`. `tests/integration/recordsExplain.test.ts`: records for phase-02 and phase-03 of one pair give the two role lines with their results; an ordinary phase has no oracle line; `--gates` lists the oracle request after the attempt's request. `tests/unit/authoringPrompt.test.ts` and `tests/integration/authorArtifact.test.ts`: the configured and absent bullets for a plan, neither for a spec, and no provider spawned. `tests/unit/planningSkillOracles.test.ts` reads the shipped `.claude/skills/phax-planning/SKILL.md`. It asserts that the oracle-phase section states the provider rule, the `**Oracle phase:**` and `**Oracle files:**` lines, the oracle files as a subset of the planned files, and marker removal as the discharge's only change. The usage-spec drift and example tests run in `pnpm test` and need the regenerated files.

### Implementation order

1. `renderOraclePairsSection` and the handoff loader and builder.
2. Records explain artifact reading and CLI line.
3. Phase prompt role section and the executePlan call.
4. Authoring prompt bullet and its threading.
5. Skills, cliDocs and regeneration (`pnpm gen:usage-spec`, `pnpm docs:cli`).
6. README, docs page, site registration, upgrading and NEXT_STEPS.

### Excluded scope

- The example Vitest provider and phax's own `oracles` declaration in phax.json (plan 2).
- Any change to the gate runtime, the formats or the `oracles` check.
- Granting `phax architecture` or any other command to the headless planner because of oracles.
- headless-review and its `--append` (unchanged).

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

Where the `## Oracle pairs` section renders and how results are read. The records explain line format. The exact role paragraphs and the `## Oracle role` section position. The two authoring bullets. The skill sections added or changed, with their headings. The new docs page route. Confirmation that `phax.usage.kdl` and `docs/cli/reference.md` were regenerated, not hand-edited. Any deviation from the planned file lists, with the reason. Note for plan 2: the README and docs page refer to an oracles provider generically and carry `node tools/vitest-oracles.mjs` as a made-up example only.

### Commit subject

`feat(oracles): show oracle pairs in the handoff, records and prompts, and document oracle phases`

### Commit body

The review handoff lists every oracle pair with each side's last oracle-step result, and `phax records explain` names a phase's oracle role, its counterpart and that result. The prompt of an oracle phase and of a discharging phase states the role in a fixed wording that names no test framework. The headless plan authoring prompt says whether an `oracles` provider is configured.

The phax-planning skill gains an oracle-phase section: declare one only with a configured provider; the two declaration lines; oracle files as a subset of the planned files; marker removal as the discharge's only change. phax-decide-plan's P3 no longer calls the oracle files read-only. `phax --usage`, the CLI reference, the README's Oracle provider section, a new oracle-phases docs page, docs/upgrading.md and NEXT_STEPS.md describe the feature.
