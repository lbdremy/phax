---
status: Completed
source-spec: docs/specs/2610201518-oracle-phases.md
completes-spec: false
approved:
  date: 2026-10-21
  baseline: 850a8f8
---
# Skip oracle

The second of the oracle-phases spec's three plans. Plan 1 (PR #154) shipped the oracles block, the shared oracles check, the oracle step in the gate loop, the oracle surface, the review handoff's Oracle pairs table, records explain and the reset refusal. This plan adds the recovery the spec settled on 2026-10-21 (§5.28, §5.36, §5.49, §5.50, last bullet of §10 Settled). A wrong oracle is corrected in the stopped phase's worktree and closed with `phax resume <run> --skip-oracle`. That resume runs the phase's configured gate with the usual fix loop and no oracle step. It records the oracle step as `skipped` in that phase's gate-attribution, and `oracle` is then not a verified surface of that phase or of the run.

Two phases, from the core outwards, each green on its own. phase-01 changes the persisted shape and the runtime: gate-attribution's step becomes an explicit union of a configured step and the oracle step, the oracle step gets a `skipped` variant, executePlan gets a one-phase skip option, and every reader of the oracle step's result accepts `skipped`. phase-02 adds the operator surface: the `--skip-oracle` flag and its refusal, the texts that name the recovery (reset refusal, next steps, resume-instructions.md), the CLI help, and the docs.

Ground facts the phases rely on:
- gate-attribution is at its unreleased `next` shape: `packages/schemas/snapshots/gate-attribution/next.schema.json` exists, `package.json` opens 0.26.0, and docs/release.md says a format with a `next` snapshot is stamped with the opened version. The shape therefore changes in place, with no new frozen module.
- `readGateAttributionFile` (src/schemas/persisted.ts) reads every stamped attribution with the current decoder. A 0.20.0 or 0.21.0 step (surface local | structural | product, result pass | fail | refused) is exactly the new configured variant, so older documents still decode.
- The phase record manifest's `verifiedSurfaces` keeps its shape. phase-record-manifest does not change.
- The skip is an operator's choice at resume, never an agent's. A phase worktree refuses `phax resume`. No agent prompt, grant or fix prompt names `--skip-oracle`.
- No phase edits `.claude/`, so the run needs no `--allow-skill-edits`. Neither the phax-cli skill nor the phax-decide-plan skill describes this recovery.

## Required commands

- `pnpm exec tsx`
- `pnpm gen:usage-spec`
- `pnpm docs:cli`

All three are already in `security.agentCommands` in phax.json, so phax.json needs no change. `pnpm exec tsx scripts/schemas-check.ts --write` regenerates the gate-attribution `next` snapshot and the package's generated files (phase-01). `pnpm gen:usage-spec` then `pnpm docs:cli` regenerate phax.usage.kdl, docs/cli/reference.md and README.md's CLI section (phase-02).

## Technical arbitrations

- Refusal exit code for `--skip-oracle` at a phase with no oracle role: 1. This matches how `phax resume` refuses an invalid option today: an unparsable `--provider-priority` returns 1, and so does a commander option error. The §6 surface's `$? = 2` is indicative. Loss accepted: this refusal shares exit 1 with generic failures instead of the plan-validation family (2).
- The skip is a variant of the oracle step, not a flag beside it. `OracleStep` in src/app/gates.ts becomes `{ kind: "run", command, request, timeoutMs } | { kind: "skipped", command }`. runGates records the skipped step only where it would run the oracle step: last, after every configured step it fires has passed. Loss accepted: an attempt whose configured step fails records no oracle step, so its record does not show that a skip was asked for.
- The run's verified surfaces (final report, PR body) exclude a surface that any read phase record holds as a `skipped` step, even when another phase verified it. So the authored verdict that passed does not put `oracle` on the run's line once its discharge was skipped. This is the only reading under which the PR body does not claim the skipped oracle. Loss accepted: that passing authored verdict drops off the run-level line, though it stays in the oracle phase's record and in the handoff's Oracle pairs table. Configured surfaces are unaffected: no configured step is ever `skipped`.
- The rule for whether a phase may skip is pure domain (`oracleSkipRefusal` in src/domain/plan/oraclePairs.ts). `phax resume` calls it after it loads the plan and before it prints the preview, so the refusal also comes without `--yes`. executePlan trusts the caller and applies the skip only to the phase at `startIndex`. Loss accepted: a direct executePlan caller that passes the skip for a phase with no role gets no refusal; the skip simply has no effect.
- A `--skip-oracle` resume whose restart phase does not re-run its gate (a resume from commit, handoff, cleanup or completion) is accepted and changes nothing: the gate does not run, so nothing is skipped. Loss accepted: the operator gets no warning that the flag had no effect.
- Which step stopped the phase reaches the texts as a `failedStep: "configured" | "oracle"` field. It is carried by GateAttemptsExhaustedError, GateStepRefusedError, the FixAttemptsExhausted and GateStepRefused events and ResumeContext, the same value GateFailedError already carries. The alternative, comparing the failing command with `config.oracles.command`, would misread a configured step that runs the same command. Loss accepted: these events and errors take one more field, and the test fixtures that build them change with it.
- gate-attribution changes in place at its `next` shape: no frozen module for plan 1's `next`, which was never released. Loss accepted: that unreleased intermediate shape (the oracle surface with result pass | fail | refused only) is not kept anywhere.

---

## phase-01 — Record a skipped oracle step and keep it out of verified surfaces {#phase-01-skipped-oracle-step}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

phax can record that an oracle step was skipped, and never counts a skipped oracle as verified. gate-attribution's step becomes an explicit union: a configured step, with surface local | structural | product and result pass | fail | refused, or the oracle step, with surface `oracle` and result pass | fail | refused | skipped. executePlan gains an option that skips the oracle step of the phase it starts at, and only that phase. The gate then runs every configured step with the usual fix loop and records `{ command: <oracles command>, surface: "oracle", result: "skipped" }` last. The phase record, the run's final report and PR body, the review handoff's Oracle pairs table and `phax records explain` all show the skip, and none of them claims `oracle` as verified for it. No CLI flag exists yet.

### Detailed instructions

- Attribution union, in `src/schemas/gateAttribution.ts`. Replace the single `GateStepResultSchema` struct with two structs and their union. `ConfiguredStepResultSchema` is `{ command: Schema.NonEmptyString, surface: SurfaceSchema, result: Schema.Literal("pass", "fail", "refused") }`, using `SurfaceSchema` from `src/schemas/surface.ts`. `OracleStepResultSchema` is `{ command: Schema.NonEmptyString, surface: Schema.Literal("oracle"), result: Schema.Literal("pass", "fail", "refused", "skipped") }`. `GateStepResultSchema = Schema.Union(ConfiguredStepResultSchema, OracleStepResultSchema)`. Keep `GateStepResult` as the union's type, and export `OracleStepResult` (the oracle variant's type) only if a module outside the file imports it, since knip fails on unused exports. Document both variants in the file: the oracle variant is carried only by the step phax appends at an oracle pair's gate, and `skipped` records `phax resume --skip-oracle`. Keep `GateAttributionSchema`, `GateAttributionFileSchema`, `decodeGateAttributionFile` and `encodeGateAttributionFile` as they are. Leave `RecordedSurfaceSchema` in surface.ts: the phase record's `verifiedSurfaces` and the other consumers still use it. gateAttribution.ts no longer imports it.
- Do not touch a frozen module. `src/schemas/history/gate-attribution/{pre-schema,0.17.0,0.20.0,0.21.0}.ts` are pinned by `packages/schemas/history.lock.json`, and no new frozen module is created: the format is at its unreleased `next` shape and changes in place (docs/release.md). Confirm that `readGateAttributionFile` in `src/schemas/persisted.ts` still reads a 0.20.0- and a 0.21.0-stamped attribution through the current decoder, and that its pre-schema lift (every step `pass` or `fail`) still type-checks against the union. Only touch persisted.ts if the compiler requires it.
- Regenerate the schemas package's view of the shape with `pnpm exec tsx scripts/schemas-check.ts --write`. It rewrites `packages/schemas/snapshots/gate-attribution/next.schema.json`, whose step is now an `anyOf` of the two variants. Confirm that no release-named snapshot changed and no other format's `next` snapshot moved. Never hand-edit a generated file. `packages/schemas/src/formats/recordTimeline.ts` needs no change: its current shape is phax's `GateAttributionFile`, and older shapes keep their own frozen types.
- Gate runner, in `src/app/gates.ts`. Turn `OracleStep` into an explicit union: `{ readonly kind: "run"; readonly command: string; readonly request: string; readonly timeoutMs: number } | { readonly kind: "skipped"; readonly command: string }`. Update the `RunGatesOptions.oracleStep` doc comment. After the configured loop, a `run` oracle step behaves exactly as today. For a `skipped` one, spawn nothing and write no `checks-attempt-NN.oracle-request.json`. Push one log line, `oracle step skipped by the operator: <command>`, and a blank line. Append `{ command, surface: "oracle", result: "skipped" }` to `stepResults`, then write the log and the attribution as on a pass. The attempt passes. A configured failure stops the gate before this point, as today, so that attempt records no oracle step. Build each step result as a value of the union, for example with one small helper per variant, rather than spreading a `RecordedSurface` into a struct, so the compiler checks every pushed result against its variant.
- Fix loop, in `src/app/fixLoop.ts`. It passes `oracleStep` unchanged to every attempt. Only its imported type changes, so a skip holds for every attempt of that phase entry.
- Run loop, in `src/app/executePlan.ts`. Add `readonly skipOracle?: boolean | undefined` to `ExecutePlanOptions`. Its comment says it applies only to the phase at `startIndex`, in this invocation, when that phase's gate runs. It is never persisted and never reaches a later phase. The resume command sets it after checking the phase's oracle role. Destructure it as `skipOracle = false`. Give `oracleStepFor` a third parameter, `skip: boolean`. With a role and `skip`, it returns `{ kind: "skipped", command: config.oracles.command }` and builds no request. With a role and no skip, it returns `{ kind: "run", … }` as today. With no role, it returns `undefined`. It still fails with `OraclePreflightError` when `config.oracles` is undefined, whether or not it skips. Call it as `oracleStepFor(phaseFolderPath, phase.id, skipOracle && i === startIndex)`. The discharging pre-check `oracleCommitOf` at the top of the loop is unchanged.
- Phase verified surfaces. `verifiedSurfaces` in `src/domain/gate/verifiedSurfaces.ts` already leaves out a surface with any non-`pass` step. Keep the rule and extend its doc comment: a `skipped` oracle step leaves `oracle` unverified. Add a pure `runVerifiedSurfaces(records: readonly GateAttribution[]): readonly RecordedSurface[]` in the same file. It is the sorted union of each record's `verifiedSurfaces`, minus every surface that any record holds as a `skipped` step. Rewrite `aggregateVerifiedSurfaces` in `src/app/gateAttribution.ts` to read each phase's attribution as today (skipping missing or undecodable files) and return `runVerifiedSurfaces` of what it read. The final report (`src/app/finalReport.ts`) and the PR body (`src/app/publishRun.ts`) already call `aggregateVerifiedSurfaces`, so they need no edit. The phase record writer derives `verifiedSurfaces` from the phase's own attribution, so its manifest leaves out `oracle` for a skipped phase with no change.
- Review handoff. In `src/domain/plan/oraclePairs.ts`, `OraclePairResult` becomes `"pass" | "fail" | "refused" | "skipped" | "not run"`. Keep `renderOraclePairsSection` unchanged, so a skipped verdict renders `skipped` in its column. `loadOracleStepResult` in `src/app/loadReviewHandoffInputs.ts` returns the last oracle step's result, so it carries `skipped` once the type allows it. Edit it only if the compiler asks.
- Records explain. In `src/app/recordsExplain.ts`, `ExplainedRecord["oracleStep"]`'s `result` becomes `"pass" | "fail" | "refused" | "skipped"`. Derive it from the attribution's oracle variant rather than restating the literal. Narrow `lastOracleStep`'s `findLast` to the oracle variant (`step.surface === "oracle"`). `src/cli/commands/records.ts` already prints `<command>: <result>`, so it shows `skipped` with no change.
- Integration harness, in `tests/integration/oraclePhases.test.ts`. Let `h.execute(startIndex, options?)` pass `skipOracle` through to executePlan. If needed, let the fake configured gate step fail on demand. Keep the fake provider recording every call, its cwd and its request.
- Fixtures are made up (`refunds`, `tests/refunds.test.ts`, `node tools/oracles.mjs`). Tests never read `~/.phax`, and they assert `$schema` URLs by format id and release pattern, never by the running version.

### Planned files to create

- (none)

### Planned files to edit

- `src/schemas/gateAttribution.ts`
- `src/app/gates.ts`
- `src/app/executePlan.ts`
- `src/domain/gate/verifiedSurfaces.ts`
- `src/app/gateAttribution.ts`
- `src/domain/plan/oraclePairs.ts`
- `src/app/recordsExplain.ts`
- `packages/schemas/snapshots/gate-attribution/next.schema.json`
- `tests/unit/gateAttribution.test.ts`
- `tests/unit/gateAttribution.reader.test.ts`
- `tests/unit/verifiedSurfaces.test.ts`
- `tests/integration/gates.test.ts`
- `tests/integration/oraclePhases.test.ts`
- `tests/integration/reviewHandoff.test.ts`
- `tests/integration/recordsExplain.test.ts`

### Optional files that may be edited

- `src/app/fixLoop.ts`
- `src/app/loadReviewHandoffInputs.ts`
- `src/cli/commands/records.ts`
- `src/schemas/persisted.ts`
- `src/app/writeRecord.ts`
- `packages/schemas/history.lock.json`
- `packages/schemas/src/generated/index.ts`
- `packages/schemas/src/formats/recordTimeline.ts`
- `tests/unit/oraclePairs.test.ts`
- `tests/unit/schemasPackage/documents.ts`
- `tests/unit/schemasPackage/recordTimeline.test.ts`
- `tests/unit/schemasPackage/snapshots.test.ts`
- `tests/unit/schemasPackage/jsonSchemas.test.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/type/schemasPackage.ts`
- `tests/integration/writeRecord.test.ts`
- `tests/integration/fixLoop.test.ts`

### Boundary contracts

Producer `src/schemas/gateAttribution.ts` → consumers verifiedSurfaces, the handoff loader, records explain, the fix loop's previous-findings lookup and the schemas package. A step is exactly one of two variants: the configured step (surface local | structural | product, result pass | fail | refused) or the oracle step (surface `oracle`, result pass | fail | refused | skipped). Producer `src/app/gates.ts` `OracleStep` → consumers fixLoop and executePlan: `run` (command, request, cap) or `skipped` (command only). Producer `ExecutePlanOptions.skipOracle` → consumer phase-02's `phax resume`, which sets it only after `oracleSkipRefusal` returned null for the phase it restarts at. Producer `runVerifiedSurfaces` (src/domain/gate/verifiedSurfaces.ts) → consumers final report and PR body, through `aggregateVerifiedSurfaces`.

### Test strategy

Write these before the implementation:
- `tests/unit/gateAttribution.test.ts`, for the union's decode and encode: a configured step and an oracle step each decode and round-trip through `encodeGateAttributionFile`, `$schema` asserted by format id and release pattern; `{ surface: "oracle", result: "skipped" }` decodes; `{ surface: "local", result: "skipped" }` and an unknown surface are refused.
- `tests/unit/gateAttribution.reader.test.ts`, for the lift: a 0.20.0- and a 0.21.0-stamped attribution (URLs built for those releases) read through `readGateAttributionFile` into the union unchanged; and aggregating phase-02 (local pass, oracle pass) with phase-03 (local pass, oracle skipped) gives `["local"]`.
- `tests/unit/verifiedSurfaces.test.ts`: a record whose oracle step is `skipped` verifies its configured surfaces but not `oracle`; `runVerifiedSurfaces` drops a surface any record skipped and is otherwise the sorted union.

Then:
- `tests/integration/gates.test.ts`: with a `skipped` oracle step and passing configured steps, the provider is never spawned, no oracle-request file is written, the attempt passes, and the step record and `gate-attribution.json` end with the skipped step. With a failing configured step, the attribution ends with that failing step and holds no oracle step.
- `tests/integration/reviewHandoff.test.ts`: a pair whose discharge was skipped renders `| phase-02 | phase-03 | pass | skipped |`.
- `tests/integration/recordsExplain.test.ts`: a record whose attribution ends with a skipped oracle step explains `result: "skipped"`.
- `tests/integration/oraclePhases.test.ts`, the whole recovery at executePlan level. A three-phase plan with pair phase-02 → phase-03 and a provider that always finds at the discharge exhausts phase-03 (GateAttemptsExhaustedError). `h.execute(2)` without the skip calls the provider again with a `discharged` request naming the same `oracleCommit`, and exhausts again. `h.execute(2, { skipOracle: true })` with the provider answering findings still makes no provider call. It commits phase-03, ends its `gate-attribution.json` with `{ command: ORACLES, surface: "oracle", result: "skipped" }`, writes no new oracle-request file, and leaves `oracle` out of phase-03's verified surfaces and out of the PR body's verified surfaces.
- Also in `tests/integration/oraclePhases.test.ts`, a skip keeps the configured gate: with the skip and a configured step that fails on the first resumed attempt, the fix loop runs, no oracle request is sent, and the phase commits only once the configured step passes.
- Also there, the skip reaches no later phase: in a four-phase plan with pairs phase-01 → phase-02 and phase-03 → phase-04, a run resumed at phase-02 with the skip still sends phase-03 and phase-04 their requests.

### Implementation order

1. The attribution union in gateAttribution.ts and its unit and reader tests.
2. `pnpm exec tsx scripts/schemas-check.ts --write`, then check the snapshot diff.
3. verifiedSurfaces.ts (`runVerifiedSurfaces`) and gateAttribution.ts (`aggregateVerifiedSurfaces`).
4. The `OracleStep` union in gates.ts and the gates integration tests.
5. executePlan's `skipOracle` and `oracleStepFor`, then the oraclePhases integration tests.
6. OraclePairResult and the records-explain type, with their tests.

### Excluded scope

- The `--skip-oracle` CLI flag, its refusal and `oracleSkipRefusal` (phase-02).
- Every operator-facing text that names the recovery: reset refusal, next steps, resume-instructions.md, CLI help, README and docs (phase-02).
- Any change to phase-record-manifest, gate-request, gate-report, oracle-request, plan-document or phax-plan shapes, and any new frozen module.
- OracleCommitMissingError and its archive-and-replan wording, which concern an oracle phase that noted no commit, not a wrong oracle.

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The exported names and paths: the union in `src/schemas/gateAttribution.ts` and whichever variant types were exported; the `OracleStep` union in `src/app/gates.ts`, with its two `kind`s; `ExecutePlanOptions.skipOracle` and the `oracleStepFor(phaseFolderPath, phaseId, skip)` signature in `src/app/executePlan.ts`; `runVerifiedSurfaces` in `src/domain/gate/verifiedSurfaces.ts`; the widened `OraclePairResult`.
- The exact log line written for a skipped step.
- Confirmation that `scripts/schemas-check.ts --write` changed only `packages/schemas/snapshots/gate-attribution/next.schema.json` (or which generated files it also touched), and that no frozen module or release-named snapshot changed.
- How `h.execute` in `tests/integration/oraclePhases.test.ts` now takes the skip, so phase-02 can extend the same test.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(oracles): record a skipped oracle step and keep it out of verified surfaces`

### Commit body

gate-attribution's step is now an explicit union. A configured step keeps surface local | structural | product and result pass | fail | refused. The oracle step has surface oracle and result pass | fail | refused | skipped. The format is at its unreleased next shape, so it changes in place. Earlier stamps still decode, since their steps are the configured variant.

The oracle step gains a skipped variant. executePlan's skipOracle option skips it for the phase the invocation starts at, and only that phase. The gate runs every configured step with the usual fix loop, spawns no provider, writes no oracle request, and records the oracle step as skipped, last.

A skipped oracle is never verified. The phase record leaves oracle out of the phase's verified surfaces, and the final report and the PR body leave out any surface a phase skipped. The review handoff's Oracle pairs table and records explain show skipped.

---

## phase-02 — The --skip-oracle flag and the texts that name the recovery {#phase-02-skip-oracle-flag}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

An operator closes a wrong oracle with `phax resume <run> --skip-oracle`. The resume is refused, before any phase runs and with nothing changed, when the phase it restarts at has no oracle role. Every text that names the recovery now gives it. That covers the reset refusal, the next steps printed when an oracle step pauses or fails a phase, resume-instructions.md, the CLI help, README §Oracle provider and docs/oracle-phases.md. Each says: enter the stopped phase, correct the oracle, then resume with `--skip-oracle`, and the configured gate still applies. The archive-and-replan wording plan 1 shipped for a wrong oracle is gone.

### Detailed instructions

- Domain rule, in `src/domain/plan/oraclePairs.ts`. Add a pure `oracleSkipRefusal(phases: ReadonlyArray<PairPhase>, phaseId: string): string | null`. It returns null when `oracleRoleOf(phases, phaseId)` is not null. Otherwise it returns `--skip-oracle: <phaseId> is neither an oracle phase nor a discharging phase; it has no oracle step to skip.`
- Flag, in `src/cli/commands/resumeRegister.ts`. Add `.option("--skip-oracle", "Skip the oracle step of the phase this resume restarts at; its configured gate still runs")` and carry `skipOracle?: boolean` in the action's options type. In `src/cli/commands/resume.ts`, add `skipOracle?: boolean` to `ResumeCommandOptions`. Right after `loadPlan` succeeds and before the `would resume from phase …` line, when `opts.skipOracle === true`, call `oracleSkipRefusal(plan.phases, decision.nextPhaseId)`. On a message, `out.error(message)` and return 1, so the refusal also comes without `--yes` and nothing is written. Exit 1 matches the `--provider-priority` refusal (Technical arbitrations). Otherwise, after the `would resume` line, log `  Skipping the oracle step of <phaseId> (--skip-oracle); its configured gate still runs.` Pass `skipOracle: opts.skipOracle === true` to `executePlan`. The command file holds no other logic.
- Which step stopped the phase. Add `failedStep: "configured" | "oracle"` (required) in these places:
  - `GateAttemptsExhaustedError` and `GateStepRefusedError` in `src/domain/errors.ts`;
  - the `FixAttemptsExhausted` and `GateStepRefused` events in `src/domain/events.ts`;
  - `ResumeContext` in `src/domain/effects.ts`, as optional `failedStep?: "configured" | "oracle" | undefined` beside the optional `refusal`, documented as set for kinds `gates_exhausted` and `gate_refused`.

  Set and carry the value:
  - `src/app/gates.ts` sets it on `GateStepRefusedError` in `judgeReport`, from the surface (`oracle` → `"oracle"`, else `"configured"`), as `failGate` does for GateFailedError;
  - `src/app/fixLoop.ts` copies `error.failedStep` into the GateStepRefused and FixAttemptsExhausted events and into `GateAttemptsExhaustedError`;
  - `src/domain/reducer.ts` copies `event.failedStep` into the WriteResumeInstructions ctx of both cases, and changes no state transition;
  - `src/app/effectRunner.ts` passes `cmd.ctx.failedStep` to `writeResumeInstructions`.
- Next steps, in `src/domain/whatsNext.ts`. The `gates_exhausted` and `gate_refused` scenarios gain a required `failedStep: "configured" | "oracle"`. With `"configured"`, the output is byte for byte today's. For `gates_exhausted` with `"oracle"`, the headline is `The oracle step failed after all fix attempts.`, and the steps are:
  - `Let the fix loop try again — the gate, oracle step included, is re-run first`, with `phax resume <run> --yes`;
  - `Or, if the oracle itself is wrong, correct it in the phase worktree`, with `phax enter-phase <run> <phase>`;
  - `Then resume without the oracle step — the configured gate still runs, with the usual fix loop`, with `phax resume <run> --yes --skip-oracle`.

  For `gate_refused` with `"oracle"`, keep today's headline and two steps, then append the same two oracle-correction steps. Drop the reset-phase step for an oracle failure: a committed oracle phase is never reset, and resetting the discharge discards the person's correction. Update the callers:
  - `src/cli/commands/run.ts` and `src/cli/commands/resume.ts` pass `err.failedStep`;
  - in `src/app/resumeInstructions.ts`, the gate-exhaustion and gate-refusal builders pass `input.failedStep ?? "configured"`, and the commit, cleanup and completion builders pass `"configured"`.
- resume-instructions.md, in `src/app/resumeInstructions.ts`. Add `failedStep?: "configured" | "oracle" | undefined` to `ResumeInstructionsInput`. When it is `"oracle"`, the gate-exhaustion body opens with: `This run paused because the oracle step failed after exhausting all fix attempts.` It goes on: `Either resume as is — the gate, oracle step included, is re-run first — or, if the oracle itself is wrong, correct it in the phase worktree and resume with --skip-oracle: the phase's configured gate still runs, with the usual fix loop, and the oracle step is recorded as skipped.` Then come the why-it-stopped list and the steps. The gate-refusal body adds the same `--skip-oracle` sentence after its opening. With `"configured"` or undefined, both bodies are unchanged.
- Reset refusal, in `src/app/resetPhase.ts`. Replace the `phase_blocked_by_discharge` message with: `Cannot reset "<target>" of run "<run>": its discharging phase "<discharging>" is <state>, and a committed oracle phase is not reset. To correct the oracle, edit it in <discharging> (\`phax enter-phase <run> <discharging>\`), then run \`phax resume <run> --skip-oracle\`: the configured gate still runs.` The reason id and every other behaviour stay as they are.
- CLI help, in `src/cli/cliDocs.ts`. In `resume.longHelp`, replace the sentence `A committed oracle phase is not reset, so a wrong oracle means archiving the run (phax archive <run> --force) and running a corrected plan.` with a paragraph on `--skip-oracle`:
  - it applies only to the phase this resume restarts at, and only in this invocation;
  - that phase's configured gate steps run and must pass, with the usual fix loop;
  - its oracle step does not run, and is recorded as `skipped` in its gate-attribution;
  - `oracle` is then not among that phase's verified surfaces, nor the run's;
  - at a phase that is neither an oracle phase nor a discharging phase, it is refused with exit 1 and nothing changes;
  - a committed oracle phase is never reset, so a wrong oracle is corrected in the stopped phase (`phax enter-phase <run> <phase>`) and closed this way.

  Add `phax resume refunds --yes --skip-oracle` to `resume.examples`. In the `run` entry, replace the wrong-oracle archive-and-replan wording with: an oracle step that exhausts the fix loop or refuses pauses with exit 4, and the next steps name both `phax resume <run>` and the `--skip-oracle` correction. Leave the skipped-oracle-phase (no commit) wording, which still archives the run, as it is. Then run `pnpm gen:usage-spec` and `pnpm docs:cli`, which regenerate `phax.usage.kdl`, `docs/cli/reference.md` and README's CLI section. Never hand-edit those outputs.
- README §Oracle provider. Replace `A committed oracle phase is not reset, so when the discharge shows that the oracle itself is wrong, archive the run (\`phax archive <run> --force\`) and run a corrected plan;` with the recovery: a committed oracle phase is not reset; when the discharge shows that the oracle itself is wrong, correct it in the stopped phase (`phax enter-phase <run> <phase>`) and run `phax resume <run> --skip-oracle`. That phase's configured gate still runs with the usual fix loop, its oracle step is recorded `skipped`, and `oracle` is then not among its verified surfaces or the run's. Keep the `--hold oracle` clause.
- docs/oracle-phases.md. Rewrite the reset paragraph (it begins `A committed oracle phase is not reset`) to describe the same recovery, with a short worked example on the made-up `refunds` run: phase-03 exhausts, `phax enter-phase refunds phase-03`, then `phax resume refunds --yes --skip-oracle`. Also cover:
  - the attribution line `{ "command": "node tools/vitest-oracles.mjs", "surface": "oracle", "result": "skipped" }`;
  - the `skipped` cell in the handoff table;
  - the refusal at a phase with no oracle role (exit 1);
  - that the skip never reaches a later phase.

  In the Refusal bullet, add that a refused oracle step's next steps also name the `--skip-oracle` correction. Keep the skipped-oracle-phase paragraph (archive and run a corrected plan): there is no commit to discharge, and `--skip-oracle` does not apply.
- NEXT_STEPS.md. In the `oracle-phases` entry, mark plan 2 as landed: `phax resume <run> --skip-oracle`, the skipped oracle-step result, and the recovery texts. Leave plan 3, the example Vitest provider, as next.
- No agent-facing text mentions `--skip-oracle`. That covers the phase prompt's role paragraph, the fix prompt, grants and the authoring prompt. resume-instructions.md and the printed next steps are for the operator only.

### Planned files to create

- (none)

### Planned files to edit

- `src/domain/plan/oraclePairs.ts`
- `src/cli/commands/resumeRegister.ts`
- `src/cli/commands/resume.ts`
- `src/cli/commands/run.ts`
- `src/domain/errors.ts`
- `src/domain/events.ts`
- `src/domain/effects.ts`
- `src/domain/reducer.ts`
- `src/domain/whatsNext.ts`
- `src/app/gates.ts`
- `src/app/fixLoop.ts`
- `src/app/effectRunner.ts`
- `src/app/resumeInstructions.ts`
- `src/app/resetPhase.ts`
- `src/cli/cliDocs.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `README.md`
- `docs/oracle-phases.md`
- `NEXT_STEPS.md`
- `tests/unit/oraclePairs.test.ts`
- `tests/unit/cli/resume.test.ts`
- `tests/unit/resumeArgv.test.ts`
- `tests/unit/whatsNext.test.ts`
- `tests/unit/resumeInstructions.test.ts`
- `tests/unit/reducerGateRefusal.test.ts`
- `tests/integration/fixLoop.test.ts`
- `tests/integration/resetPhase.test.ts`
- `tests/integration/oraclePhases.test.ts`

### Optional files that may be edited

- `tests/unit/reducer.test.ts`
- `tests/unit/events.test.ts`
- `tests/unit/resume.test.ts`
- `tests/unit/cli/run.test.ts`
- `tests/unit/readmeExitCodes.test.ts`
- `tests/integration/stateMachineContract.test.ts`
- `tests/integration/gates.test.ts`
- `tests/integration/resetResume.test.ts`

### Boundary contracts

Producer `oracleSkipRefusal` (src/domain/plan/oraclePairs.ts, pure) → consumer `phax resume` (src/cli/commands/resume.ts), which renders its message and exits 1, or passes `skipOracle: true` to executePlan. Producer gates.ts / fixLoop.ts → the errors, events, ResumeContext and whatsNext scenarios: one `failedStep: "configured" | "oracle"` value, the same that GateFailedError already carries, travels from the failing step to every text that names a next step. The reducer only copies it into the WriteResumeInstructions effect, and no state transition changes.

### Test strategy

Write these before the implementation:
- `tests/unit/oraclePairs.test.ts`: `oracleSkipRefusal` returns null for an oracle phase and a discharging phase, and the exact message for any other phase.
- `tests/unit/whatsNext.test.ts`: `gates_exhausted` and `gate_refused` with `failedStep: "configured"` render exactly as today; with `"oracle"` they name `phax enter-phase <run> <phase>` and `phax resume <run> --yes --skip-oracle`, say the configured gate still runs, and name no reset.
- `tests/unit/cli/resume.test.ts`, for a skip that needs an oracle role: with a plan whose restart phase phase-01 has no role and `--skip-oracle`, `runResume` returns 1, prints the refusal naming phase-01, never calls `executePlan`, and refuses the same way without `--yes`. With a discharging restart phase, it logs the skipping line and passes `skipOracle: true`; without the flag, it passes `skipOracle: false`.

Then:
- `tests/unit/resumeArgv.test.ts`: `--skip-oracle` parses to `skipOracle: true`.
- `tests/unit/resumeInstructions.test.ts`: an oracle-step exhaustion and an oracle-step refusal both name `--skip-oracle` and the configured gate; a configured-step exhaustion is unchanged.
- `tests/unit/reducerGateRefusal.test.ts`: the WriteResumeInstructions ctx carries `failedStep`.
- `tests/integration/fixLoop.test.ts`: `GateAttemptsExhaustedError.failedStep` is `"oracle"` when the oracle step exhausted the loop and `"configured"` otherwise.
- `tests/integration/resetPhase.test.ts`: the new `phase_blocked_by_discharge` message.
- `tests/integration/oraclePhases.test.ts`, extending phase-01's recovery test to cover §8 'An undischargeable oracle pauses the run' and 'A wrong oracle is corrected in place': `resume-instructions.md` names both `phax resume refunds` and `--skip-oracle`; the reset of the committed phase-02 refuses with the new message and changes nothing; a resume with the skip commits phase-03 with the oracle step `skipped` and `oracle` out of its verified surfaces. Also an oracle-step refusal, whose instructions name the `--skip-oracle` correction too.

The usage-spec and CLI-docs freshness tests, which `pnpm test` runs, check the regenerated files.

### Implementation order

1. `oracleSkipRefusal` and its unit test.
2. `failedStep` through errors.ts, events.ts, effects.ts, gates.ts, fixLoop.ts, reducer.ts and effectRunner.ts, with fixture updates.
3. whatsNext.ts and resumeInstructions.ts, then run.ts and resume.ts callers.
4. The `--skip-oracle` flag in resumeRegister.ts and resume.ts, with the CLI tests.
5. The reset refusal message and its tests, then the oraclePhases integration assertions.
6. cliDocs.ts, then `pnpm gen:usage-spec` and `pnpm docs:cli`.
7. README §Oracle provider, docs/oracle-phases.md and NEXT_STEPS.md.

### Excluded scope

- Any change to the persisted shapes or to how the skipped step is recorded (phase-01).
- Persisting the skip in run-status.json, or applying it to any phase but the one the resume restarts at.
- The example Vitest provider and phax.json's `oracles` declaration (plan 3).
- The skipped-oracle-phase case (OracleCommitMissingError): with no commit there is nothing to discharge, and its archive-and-replan wording stays.
- Any `.claude/skills/` edit: no skill describes this recovery, so the run needs no `--allow-skill-edits`.

### Verification

The project's configured `standard` gate profile in `phax.json`; as the last phase, its terminal build, site and smoke steps run too.

### Expected handoff content

- The `oracleSkipRefusal` signature and message.
- The exit code and the exact refusal output of `phax resume <run> --skip-oracle` at a phase with no role.
- The skipping line `phax resume` prints.
- Every type that gained `failedStep`.
- The new texts, verbatim: the reset refusal, both oracle next-step variants, and the resume-instructions sentences.
- Confirmation that `pnpm gen:usage-spec` and `pnpm docs:cli` regenerated phax.usage.kdl, docs/cli/reference.md and README.md.
- Confirmation that no agent-facing prompt names `--skip-oracle`.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(resume): add --skip-oracle and name the wrong-oracle recovery`

### Commit body

phax resume <run> --skip-oracle restarts at an oracle phase or a discharging phase without its oracle step. That phase's configured gate still runs, with the usual fix loop, and the oracle step is recorded as skipped. At a phase with no oracle role, the resume is refused with exit 1 before anything runs, preview included.

A committed oracle phase is never reset, so a wrong oracle is corrected in the stopped phase and closed this way. The texts that named archive-and-replan now name this recovery: the reset refusal, the next steps printed when an oracle step exhausts the fix loop or refuses, resume-instructions.md, the resume and run help, README §Oracle provider and docs/oracle-phases.md. The errors, events and resume context carry which step stopped the phase, so only an oracle failure names the skip. No agent prompt mentions it.
