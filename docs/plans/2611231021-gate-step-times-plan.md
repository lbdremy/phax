---
status: Draft
source-spec: docs/specs/2611231007-gate-step-times.md
completes-spec: true
---
# Gate step times

Every gate attempt records when each step that ran started and how long it ran, how long the protected-paths check took, and how long the attempt took as a whole. The times go in the attempt's gate attribution, under a new `gate-attribution` stamp (the release main is open at, 0.43.0). Older attributions still read, with their times `unknown` (a skipped acceptance step reads `not-run`). `phax records explain` shows the times under its `gates` line, in text and in `--json`. Recording a time never changes a verdict.

The phases run core to surface. phase-01 adds the new shape, freezes the 0.33.0 decoder, lifts every older stamp, moves `@lbdremy/phax-schemas` and makes the writers (`runGates`, `recordProtectedPaths`, the fix loop) take real times through Effect's `Clock`: once the time is required, the writers must supply it, so the format and the writers land together. phase-02 proves the recording against the spec's criteria under a fixed clock (TestClock) and fixes what the tests find. phase-03 adds the `phax records explain` reader and its text and `--json` output. phase-04 documents the change on the `guide/records` page (README `## Records`) and in `docs/upgrading.md`.

No acceptance phase: the surface is a file format and command output that tests read in full (operator brief).

## Required commands

- `pnpm exec tsx`
- `pnpm test:unit`
- `pnpm test:integration`
- `pnpm test`
- `pnpm typecheck`
- `pnpm test:type`
- `pnpm lint`
- `pnpm format`

Every command above is already an entry of `security.agentCommands` (`pnpm exec tsx`, `pnpm test:unit`, `pnpm test:integration`) or a command of the `standard` gate profile (`pnpm test`, `pnpm typecheck`, `pnpm test:type`, `pnpm lint`, `pnpm format`). `pnpm exec tsx` runs `scripts/schemas-check.ts --write`, which regenerates the schemas package's derived files. No `phax.json` change is needed.

## Technical arbitrations

- Where a step's time is taken: `Clock.currentTimeMillis` is read immediately before each `shell.run` in `runGates` and immediately after it returns or fails. Judging a report step (parsing stdout, saving the report) and writing the gate or acceptance request are outside the step and inside the attempt. Loss accepted: a report step's figure leaves out phax's reading of its report, which shows only as attempt time minus step times (spec §4, phax's own gate work).
- Where the attempt's time is taken: its start is read at the top of `runGates`, before the first gate-request write. Its end is read once the last step is judged, before the attempt log and the step record are written: a single `persistAttempt` step (end reading, then log, then attribution) replaces today's log-and-attribution writes on the pass, fail and refusal paths. Loss accepted: writing the log and the step record falls in no figure.
- A configured step whose `shell.run` fails (a spawn failure) still propagates its `ShellError` as a fault of the run, with no attribution written, as today. §5.13 forbids changing that, so §5.2's spawn failure or time-cap overrun applies to the acceptance step, the only step whose spawn failure or timeout is judged as a failed step. Loss accepted: a configured step that fails to spawn leaves no time anywhere.
- How the attempt's times survive the protected-paths rewrite (§5.7): `fixLoop.ts`'s `checkAttempt` times `checkProtectedPaths` alone and passes that `MeasuredTime` to `recordProtectedPaths`. That function keeps the `time` and `steps` it re-reads from the step record and adds the time to the protected-paths result. Loss accepted: rewriting the two files falls in no figure.
- The per-variant time types (spec §10) as Effect Schema unions, one set shared by the file schema and the in-memory value: `MeasuredTime` `{ kind: "measured", startedAt, durationMs }`, `UnknownTime` `{ kind: "unknown" }`, `NotRunTime` `{ kind: "not-run" }`. A configured step, the attempt and a non-null protected-paths result take `measured | unknown`. The acceptance step is a union of `{ result: pass|fail|refused, time: measured|unknown }` and `{ result: "skipped", time: not-run }`. Loss accepted: a hand-written document under the new stamp can say `unknown`, which phax never writes. A separate measured-only file schema would need two schemas per variant, and no encode path for a lifted value.
- How older stamps read: one shared module, `src/schemas/gateTimeLift.ts`, used by phax's `readGateAttributionFile` and the package's `toLatestGateAttribution` so the two cannot disagree, turns an untimed attribution into the new shape. Every time becomes `unknown`, except a skipped acceptance step's `not-run`. phax reads [0.33.0, current) with a frozen 0.33.0 decoder, [0.31.0, 0.33.0) with the 0.31.0 one, older stamps with the 0.26.0 one, and pre-schema as today. The package lifts to the latest shape only what it already lifts (0.26.0, 0.31.0, and now 0.33.0). Pre-schema and 0.17.0 to 0.21.0 keep their recorded values under their own types, because their steps can be `pending`. Loss accepted: a package reader of a pre-0.26.0 attribution gets no `time` key, though phax's own reader still reads those as `unknown`.
- How `phax records explain` reads the step records: from the record's artifacts, attempt by attempt. Attempts are numbered from the `checks-attempt-NN.log` names, as `checksAttemptCount` already counts them, and each reads its own `checks-attempt-NN.attribution.json` through `readGateAttributionFile`. An absent file is `absent`; a file that is not JSON or is refused is `unreadable`. Both render `steps unknown`. The phase's `gate-attribution.json` is never a fallback for the last attempt. Loss accepted: a record written before step records existed shows `steps unknown` for every attempt, even where `gate-attribution.json` holds the last attempt's steps (spec §5.15).
- The `--json` answer's `gateAttempts` (indicative in the spec): each entry is discriminated by `stepRecord`. `"read"` carries `attempt`, `time`, `steps` (`command`, `surface`, `result`, `time`) and `protectedPaths` (`null`, or `{ result, time }`). `"absent"` or `"unreadable"` carries only `attempt`. Loss accepted: one key beyond the spec's sample, and the protected-path change list stays in the record's file, not the answer.
- The text view lists every step, with no folding (spec §10's default): durations in seconds with one decimal (`191.3 s`), `time unknown` and `not run` in place of a figure, columns aligned across the record. Loss accepted: a very long command widens every line of the block.

---

## phase-01 — Gate attribution shape with step, attempt and check times {#phase-01-attribution-shape}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium
**Assignment reason:** The phase crosses schemas, app and the published schemas package. It designs the per-variant time unions and the lift that two readers must share, and it moves every writer in the same commit. That needs a stronger model than the default.

Gate attributions move to a new `gate-attribution` shape where every step, the attempt and a non-null protected-paths result carry a required time. phax writes real `measured` times taken through Effect's `Clock`. Every older stamp reads with its times `unknown` (a skipped acceptance step `not-run`), in phax and in `@lbdremy/phax-schemas`.

### Detailed instructions

- Read the precedent first: `git log -p -1 375af754` (the `plan-approval-record` bump that added a required `code` key). Follow it file for file: frozen history decoder, `persisted.ts`, the schemas package, `src/schemas/release.ts`, the behaviour-corpus cases and `subjects.ts`, and `tests/helpers/property/formatRegistry.ts`. Note how its tests reach the new stamp without naming the opened version: no test may name 0.43.0. Use `currentSchemaUrl("gate-attribution")` or `CURRENT_STAMPS`, and name only released stamps (0.33.0, 0.31.0, …) literally.
- Freeze the 0.33.0 shape as `src/schemas/history/gate-attribution/0.33.0.ts`: a standalone module in the style of `0.31.0.ts` (imports only `effect`, its own copy of the `$schema` pattern helper, the header comment saying never to edit it and that only `src/schemas/persisted.ts` may import it in phax), exporting `GateAttributionV0_33_0Schema`, type `GateAttributionV0_33_0` and `decodeGateAttributionV0_33_0`. Its content is exactly today's `src/schemas/gateAttribution.ts` shape (configured step local|structural|product with pass|fail|refused, acceptance step with pass|fail|refused|skipped, protectedPaths null or pass/fail).
- Change `src/schemas/gateAttribution.ts` to the new shape. Add an instant schema `Schema.String.check(isExportedPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/))` (import `isExportedPattern` from `./strictString.js`, as `costLedger.ts` does). `MeasuredTimeSchema` is `{ kind: Literal("measured"), startedAt: instant, durationMs: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)) }`, `UnknownTimeSchema` is `{ kind: Literal("unknown") }`, `NotRunTimeSchema` is `{ kind: Literal("not-run") }`, and `RecordedTime = Union([Measured, Unknown])`. A configured step gains `time: RecordedTime`. The acceptance step becomes `Union([Struct({ command, surface: "acceptance", result: Literals([pass, fail, refused]), time: RecordedTime }), Struct({ command, surface: "acceptance", result: Literal("skipped"), time: NotRunTime })])`. Each protected-paths variant (pass, fail) gains `time: RecordedTime`. The attribution's fields are `phase`, `time: RecordedTime`, `steps`, `protectedPaths`, in that key order (spec §6). Export the types later code needs: `MeasuredTime`, `GateStepResult`, `AcceptanceStepResult`, `ProtectedPathsResult`, `GateAttribution`, `GateAttributionFile`. Export no type nothing imports (knip runs at the gate).
- Create `src/schemas/gateTimeLift.ts`, in the doctrine of `src/schemas/acceptanceLift.ts`: pure, imports only `effect` and types from `src/schemas`, because the schemas package publishes it. Export an untimed step and attribution type (the 0.33.0 in-memory shape: steps without `time`, the attribution without `time`, protected-paths results without `time`), plus `liftUntimedGateAttribution(untimed): GateAttribution`. That function gives every configured step `{ kind: "unknown" }`, a skipped acceptance step `{ kind: "not-run" }`, any other acceptance step `{ kind: "unknown" }`, the attempt `{ kind: "unknown" }`, and a non-null protected-paths result `time: { kind: "unknown" }`. It keeps every other fact. Adjust `liftGateStep` in `src/schemas/acceptanceLift.ts` (and its `GateStepToLift` type) so it lifts an untimed step's `oracle` surface to `acceptance` and returns the untimed step type, not the now-timed `GateStepResult`.
- Rewrite `readGateAttributionFile` in `src/schemas/persisted.ts` (about line 1565). First, `isStampedAtOrAbove("gate-attribution", input, "0.33.0")` reads through `decodeGateAttributionV0_33_0`, then `liftUntimedGateAttribution`. Then the existing 0.31.0 branch: `liftGateStep` on each step, then `liftUntimedGateAttribution`. Then the 0.26.0 branch: `liftGateStep`, `protectedPaths: null`, then `liftUntimedGateAttribution`. The pre-schema branch keeps its pass/fail check, then `protectedPaths: null` and `liftUntimedGateAttribution`. The current stamp decodes with `decodeGateAttributionFile` and drops `$schema`. Update the doc comment. A current-stamp document missing a `time` fails with the decoder's first violation, which names `time`.
- Make the writers supply real times. Create `src/app/gateTime.ts` with `measuredTime(startedAtMs, endedAtMs): MeasuredTime`: `startedAt` is `new Date(startedAtMs).toISOString()`, `durationMs` is `Math.max(0, Math.round(endedAtMs - startedAtMs))`, so a clock stepping backwards gives 0, never a negative. Add `timed(effect)`: it reads `Clock.currentTimeMillis` before and after the effect and succeeds with `[Result<A, E>, MeasuredTime]`, so a failure is timed too (precedent: `src/app/costLedger.ts`).
- In `src/app/gates.ts` `runGates`: read `attemptStartedAt` with `Clock.currentTimeMillis` at the top of the generator, before the step loop. Wrap each configured step's `shell.run` (both the gate-request and the plain call, about line 340) in `timed`. On a failure, re-fail with the same error (`return yield* Effect.fail(outcome.failure)`), so a configured step's `ShellError` still propagates unchanged with nothing written (spec §5.13). Pass the step's `time` into `judgeReport` (a new parameter) and put it on every `stepResults.push` of that step (pass, fail, refused, the unread-report fail). For the acceptance step, replace `Effect.result(shell.run(...))` with `timed(shell.run(...))`. Its spawn-failure or timeout entry is `result: "fail"` with the measured time, and a judged one carries its time through `judgeReport`. A skipped acceptance step carries `time: { kind: "not-run" }`.
- Still in `runGates`: replace today's paired log and attribution writes on the pass path (lines 422–423), inside `failGate`, and on the refusal path in `judgeReport` with one helper, `persistAttempt()`. It reads `Clock.currentTimeMillis` (the attempt's end, just after the last step is judged), writes the attempt log, then writes the step record and `gate-attribution.json` with `time: measuredTime(attemptStartedAt, end)` and `protectedPaths: null`. Keep every error, message and file exactly as today: only the attribution's content gains times.
- In `src/app/gateAttribution.ts` `recordProtectedPaths`: add an input `time: MeasuredTime`. Build the attribution from the re-read record's `phase`, `time` and `steps`, unchanged, and put `protectedPaths: { ...protectedPathsResult(changes), time }` on it. `protectedPathsResult` returns a result that the caller then completes with its time: adjust its return type to the untimed result, or pass the time in. In `src/app/fixLoop.ts` `checkAttempt`: time `checkProtectedPaths(...)` with `timed` (re-fail on failure, unchanged), then pass the time to `recordProtectedPaths`.
- Move the schemas package. In `packages/schemas/src/formats/recordTimeline.ts`, import the 0.33.0 frozen module, add `"0.33.0": GateAttributionV0_33_0` to `GateAttributionShapes`, and add `["0.33.0", { schema, decode }]` to `releases`. In `toLatestGateAttribution`, add `GateAttributionV0_33_0` to the overload that returns `LatestGateAttribution` and to the implementation's unions. Tell the current shape apart by its top-level `time` key: drop `$schema`. A 0.33.0 or 0.31.0 value (has `protectedPaths`, no `time`) gets `liftGateStep` on its steps, then `liftUntimedGateAttribution`. A 0.26.0 value gets the same plus `protectedPaths: null`. Pre-schema and 0.17.0 to 0.21.0 stay as they are. Update the doc comment. In `packages/schemas/src/index.ts`, export `GateAttributionV0_33_0Schema` and its type beside the 0.31.0 ones.
- Run `pnpm exec tsx scripts/schemas-check.ts --write`. It writes `packages/schemas/snapshots/gate-attribution/next.schema.json` and regenerates `packages/schemas/src/generated/index.ts` (`gate-attribution` becomes `next`), `src/schemas/release.ts` (its stamp becomes the running version), `packages/schemas/history.lock.json` (the new frozen module's hash) and `packages/schemas/shipped-json.json`. Never hand-edit those generated files. Run it again after any later change to the schema.
- Update the tests and fixtures that the new shape breaks. In `tests/behaviourCorpus/subjects.ts`, add `frozen("gate-attribution/0.33.0", decodeGateAttributionV0_33_0, "first")` beside the 0.31.0 line. In `tests/helpers/property/formatRegistry.ts`, add `shape("0.33.0", GateAttributionV0_33_0Schema)`. Hand-edit `tests/behaviourCorpus/cases/encode/gate-attribution.json` and `cases/formats/gate-attribution.json` as the precedent did (the corpus is captured on Effect 3 only, so fill both input and expected by hand): the current cases carry times, and the former current cases become 0.33.0 shape cases. Then update every test or fixture that builds a `GateAttribution`, `GateStepResult` or current-stamp attribution JSON, or that compares a written attribution with `toEqual`. In this phase, match written times with `{ kind: "measured", startedAt: expect.any(String), durationMs: expect.any(Number) }` or strip them. Exact fixed-clock assertions belong to phase-02. Run `pnpm test:unit`, `pnpm test:integration` and `pnpm test:type` until green.
- Add the format tests on the Test strategy lines. In `tests/unit/gateAttribution.reader.test.ts`: the current-stamp refusal naming `time`; the 0.33.0 read (a configured pass step, a skipped acceptance step, a passing protected-paths result); a table over pre-schema, 0.17.0, 0.20.0, 0.21.0, 0.26.0, 0.31.0 and 0.33.0; and the per-variant refusals (a skipped acceptance step with a measured time, a run one with `not-run`). In `tests/unit/schemasPackage/recordTimeline.test.ts`: a current-stamp and a 0.31.0 attribution through `parseGateAttribution` then `toLatestGateAttribution` equal `readGateAttributionFile` of the same document. In `tests/type/schemasPackage.ts`: `toLatestGateAttribution` of a 0.33.0 value is `LatestGateAttribution`. Create `tests/unit/gateTime.test.ts` for `measuredTime`. Add sample documents for the new and 0.33.0 shapes in `tests/unit/schemasPackage/documents.ts` where the suite expects one per shape.

### Planned files to create

- `src/schemas/history/gate-attribution/0.33.0.ts`
- `src/schemas/gateTimeLift.ts`
- `src/app/gateTime.ts`
- `packages/schemas/snapshots/gate-attribution/next.schema.json`
- `tests/unit/gateTime.test.ts`

### Planned files to edit

- `src/schemas/gateAttribution.ts`
- `src/schemas/acceptanceLift.ts`
- `src/schemas/persisted.ts`
- `src/schemas/release.ts`
- `src/app/gates.ts`
- `src/app/gateAttribution.ts`
- `src/app/fixLoop.ts`
- `packages/schemas/src/formats/recordTimeline.ts`
- `packages/schemas/src/index.ts`
- `packages/schemas/src/generated/index.ts`
- `packages/schemas/history.lock.json`
- `packages/schemas/shipped-json.json`
- `tests/behaviourCorpus/subjects.ts`
- `tests/behaviourCorpus/cases/encode/gate-attribution.json`
- `tests/behaviourCorpus/cases/formats/gate-attribution.json`
- `tests/helpers/property/formatRegistry.ts`
- `tests/unit/gateAttribution.reader.test.ts`
- `tests/unit/gateAttribution.test.ts`
- `tests/unit/schemasPackage/recordTimeline.test.ts`
- `tests/unit/schemasPackage/documents.ts`
- `tests/type/schemasPackage.ts`
- `tests/integration/gates.test.ts`
- `tests/unit/verifiedSurfaces.test.ts`

### Optional files that may be edited

- `src/app/closeStop.ts`
- `src/app/loadReviewHandoffInputs.ts`
- `src/app/recordsExplain.ts`
- `src/domain/gate/verifiedSurfaces.ts`
- `tests/behaviourCorpus/baseline/package-exports.json`
- `tests/behaviourCorpus/baseline/snapshot-digests.json`
- `tests/unit/persisted.test.ts`
- `tests/unit/schemas/acceptanceRecordLiftCases.ts`
- `tests/unit/schemas/acceptanceRecordLifts.test.ts`
- `tests/unit/schemasPackage/acceptanceRecordLifts.test.ts`
- `tests/unit/schemasPackage/parseDocument.test.ts`
- `tests/unit/schemasPackage/shapes.test.ts`
- `tests/unit/schemasPackage/currentShapes.test.ts`
- `tests/unit/schemasPackage/exports.test.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/jsonSchemas.test.ts`
- `tests/unit/schemasPackage/snapshots.test.ts`
- `tests/unit/schemasPackage/frozenHistory.test.ts`
- `tests/unit/recordsAssemble.test.ts`
- `tests/unit/records/stopArtifacts.test.ts`
- `tests/unit/architecturalGuards.test.ts`
- `tests/integration/fixLoop.test.ts`
- `tests/integration/acceptancePhases.test.ts`
- `tests/integration/acceptancePairReview.test.ts`
- `tests/integration/protectedPathsGate.test.ts`
- `tests/integration/protectedPathsAdditive.test.ts`
- `tests/integration/gateRefusal.test.ts`
- `tests/integration/heldStopClose.test.ts`
- `tests/integration/loadReviewHandoffInputs.test.ts`
- `tests/integration/reviewHandoff.test.ts`
- `tests/integration/finalReport.test.ts`
- `tests/integration/persistedProducer.test.ts`
- `tests/integration/rateLimit.test.ts`
- `tests/integration/writeRecord.test.ts`
- `tests/integration/recordsExplain.test.ts`

### Boundary contracts

Producer `src/schemas/gateAttribution.ts` and consumers `src/app/*` and the schemas package: a `GateAttribution` now carries `time` on the attempt, on every step (configured `measured | unknown`, acceptance `skipped` with `not-run` only, else `measured | unknown`) and on every non-null protected-paths result. Producer `readGateAttributionFile` and consumers `fixLoop`, `closeStop`, `writeRecord`, `recordsExplain`, `loadReviewHandoffInputs`: any stamp reads into that one value, older ones with `unknown` times. Producer `src/schemas/gateTimeLift.ts` and consumers phax's reader and the package's `toLatestGateAttribution`: one lift, so both agree on the same document. Producer `src/app/gateTime.ts` and consumers `gates.ts`, `fixLoop.ts`: `timed(effect)` gives the effect's `Result` and its `MeasuredTime` from Effect's `Clock`.

### Test strategy

- a gate attribution under the current stamp whose step has no `time` is refused, and the refusal names the missing `time` field — small · example · readGateAttributionFile's typed refusal naming the field · in-phase · ac-required
- a 0.33.0 attribution with a passing configured step, a skipped acceptance step and a passing protected-paths result reads with the configured step, attempt and protected-paths times unknown and the acceptance step's time not-run — small · example · the expected in-memory attribution · in-phase · ac-older
- every older stamp (pre-schema, 0.17.0, 0.20.0, 0.21.0, 0.26.0, 0.31.0, 0.33.0) reads with every time unknown, except a skipped acceptance step's not-run — small · table · an expected lifted value per stamp · in-phase · ac-older
- an attribution under the new stamp and one stamped 0.31.0 both give the new shape through parseGateAttribution then toLatestGateAttribution, the first with its measured times and the second with unknown times — small · example · readGateAttributionFile of the same document · in-phase · ac-package
- toLatestGateAttribution of a 0.33.0 value is typed LatestGateAttribution — small · example · the type-level assertion in tests/type · in-phase · ac-package
- under the new stamp, a skipped acceptance step with a measured time and a run acceptance step with not-run are both refused — small · boundary · the decoder's refusal · in-phase
- current-shape attributions survive decode then encode unchanged — small · property · round-trip identity through the format registry, on the fixed seed · in-phase
- measuredTime writes an ISO-8601 UTC instant with milliseconds and a whole duration that is never negative, 0 when the clock steps backwards — small · boundary · expected values at equal, later and earlier end readings · in-phase
- runGates writes a measured time on every step that started and on the attempt, in its step record and in gate-attribution.json alike — small · example · the decoded step record and gate-attribution.json are equal and every time is measured · in-phase

### Implementation order

1. Freeze the 0.33.0 decoder in src/schemas/history/gate-attribution/0.33.0.ts.
2. Change src/schemas/gateAttribution.ts to the timed shape.
3. Add src/schemas/gateTimeLift.ts and adjust liftGateStep in acceptanceLift.ts.
4. Rewrite readGateAttributionFile in persisted.ts.
5. Add src/app/gateTime.ts, then time the steps and the attempt in gates.ts, then the protected-paths check in fixLoop.ts and recordProtectedPaths.
6. Move the schemas package (recordTimeline.ts, index.ts), then run pnpm exec tsx scripts/schemas-check.ts --write.
7. Update the corpus, subjects.ts, formatRegistry.ts and every broken test or fixture; add the format tests.

### Excluded scope

- Exact fixed-clock assertions on recorded instants and durations, and the stop's close and record-branch checks (phase-02).
- Any change to phax records explain (phase-03).
- README, docs/upgrading.md and other docs (phase-04).
- Any change to checks-attempt-NN.log, to the fix prompt, or to a gate verdict, error, message or exit code.
- Timing a configured step whose spawn fails: its ShellError still propagates with no attribution (Technical arbitrations).

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

The exact exports of `src/schemas/gateAttribution.ts` (time schemas and types), `src/schemas/gateTimeLift.ts` and `src/app/gateTime.ts` (`measuredTime`, `timed` signatures). The new `recordProtectedPaths` input. Where `runGates` reads the attempt's start and end (`persistAttempt`). The reader's stamp ranges in `readGateAttributionFile`. What `toLatestGateAttribution` now lifts. The files regenerated by `schemas-check --write`. How tests in this phase match written times (the matcher used), so phase-02 can replace it with exact fixed-clock values. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(gates): record step, attempt and check times in the gate attribution`

### Commit body

Gate attributions move to a new gate-attribution shape. Every step that started, the attempt and a non-null protected-paths result carry a required time: measured with its start instant and whole-millisecond duration, not-run for a skipped acceptance step, unknown for a document written before.

runGates times each step's command and the attempt through Effect's Clock. The fix loop times the protected-paths check, and recordProtectedPaths keeps the step and attempt times it re-reads. The 0.33.0 shape is frozen. phax's reader and @lbdremy/phax-schemas' toLatestGateAttribution lift older attributions through one shared lift, with their times unknown. No verdict, error or exit code changes.

---

## phase-02 — Gate times recorded under a fixed clock {#phase-02-fixed-clock}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium
**Assignment reason:** No test in the repository fixes Effect's Clock yet. The phase must find how TestClock composes with the ports' fakes in Effect 4, and prove ten criteria across the gate, the fix loop, the stop's close and the record writer. That needs a stronger model than the default.

The gate's recording is proven against the spec's criteria under a fixed clock: each step's instant and duration, a failing, refusing, timed-out or skipped step, the attempt's own time, the protected-paths check, a stop's close and the record on the records branch. Recording a time never changes a verdict.

### Detailed instructions

- Read phase-01's handoff first: the time types in `src/schemas/gateAttribution.ts`, `timed` and `measuredTime` in `src/app/gateTime.ts`, and where `runGates` reads the attempt's start and end.
- Create `tests/helpers/gateClock.ts`: a fixed clock that tests advance on purpose. Read `node_modules/effect/src/testing/TestClock.ts` and `Clock.ts` (Effect 4.1.4) first, and prefer `TestClock` (its layer, `adjust`/`setTime`). If `TestClock.adjust` cannot run inside a port's effect (whose requirement type is `never`), write a `Clock` over a mutable instant and provide it through Effect's `Clock` service instead. Export wrappers that advance it: a `Shell` wrapping `FakeShellImpl` that advances by a per-command amount inside `run`, and also when the fake fails (spawn failure or timeout). A `FileSystem` wrapping the fake that advances on `writeAtomic` of a chosen path (the gate request, a saved report). Optionally a `Git` wrapper that advances inside `observeWorktree`. Do not edit `src/infra/fakes/*`. No test reads real time: no `Date.now`, no sleeps, no assertion on a real duration.
- Create `tests/integration/gateStepTimes.test.ts`, driving `runGates` from `src/app/gates.ts` with the fake shell and fake filesystem as `tests/integration/gates.test.ts` does, under the helper's clock. Cover the criteria: three passing configured steps advancing 700, 191000 and 2400 ms give exactly three measured steps with `startedAt` the clock's instant at each start and `durationMs` 700, 191000, 2400 (ac-step-times). A second step exiting non-zero gives exactly two measured entries, the second `fail`, no third (ac-failing-step). A configured `output: "gate-report"` step printing a refused report gives `refused` with a measured time (ac-refused-step). An acceptance step that fails as a timeout, with the clock advanced by `ACCEPTANCE_PROVIDER_TIMEOUT_MS`, gives `fail` with `durationMs` equal to the cap (ac-acceptance-timeout). A skipped acceptance step gives `skipped` with `{ kind: "not-run" }` (ac-acceptance-skipped). The attempt's `time`, with the clock also advancing on the gate-request write and on a report step's report write, is measured, starts no later than the first step, and lasts exactly the sum of the step durations plus those advances (ac-attempt-time). Assert on both the step record (`checks-attempt-01.attribution.json`) and `gate-attribution.json`.
- In the same file, prove that a verdict does not depend on time (ac-no-decision). Run the same steps and outputs once under a clock that never moves and once under a clock advancing hours per step. Compare the step results, the outcome (success, or the failure's error class and fields other than times) and `exitCodeForError` from `src/cli/commands/runLayers.ts`. Then do the same through the fix loop, so the number of attempts and the final outcome are equal too. Reuse the fix-loop harness of `tests/integration/fixLoop.test.ts` or `tests/integration/protectedPathsGate.test.ts`.
- Also in that file, cover the protected-paths check (ac-protected-time). Drive the fix loop with protected paths declared and a passing gate, building on the harness of `tests/integration/protectedPathsGate.test.ts`, with the clock advancing 84 ms inside the worktree observation. Assert `protectedPaths.time` is measured with `durationMs` 84. Assert the step record and `gate-attribution.json` hold exactly the step and attempt times the fixed clock gave before the check, and that both files are equal.
- In `tests/integration/heldStopClose.test.ts`, add a case where a held phase's stop is closed with a gate run, under the helper's clock provided to the `closeStop` effect. The close's step record and its `gate-attribution.json` (under the close's gate folder) carry measured step and attempt times and `protectedPaths: null` (ac-close-gate). The real shell may run there; assert on `kind`, the fixed clock's instants, and that both files are equal, never on a real duration.
- In `tests/integration/writeRecord.test.ts`, add a case where a phase folder holds two attempts (`checks-attempt-01.attribution.json`, `checks-attempt-02.attribution.json`) and `gate-attribution.json`, written with fixed measured times at the current stamp. Write the record and read the three files back from the record's commit on `phax/records/v1`: their bytes equal the phase folder's (ac-record-carries).
- When a test exposes a defect in phase-01's recording (a time missing on a path, a time taken at the wrong point, a step record and `gate-attribution.json` that disagree), fix it in `src/app/gates.ts`, `src/app/gateAttribution.ts`, `src/app/fixLoop.ts` or `src/app/gateTime.ts`, and say so in the handoff. Change no verdict, error, message or exit code.

### Planned files to create

- `tests/helpers/gateClock.ts`
- `tests/integration/gateStepTimes.test.ts`

### Planned files to edit

- `tests/integration/heldStopClose.test.ts`
- `tests/integration/writeRecord.test.ts`

### Optional files that may be edited

- `src/app/gates.ts`
- `src/app/gateAttribution.ts`
- `src/app/fixLoop.ts`
- `src/app/gateTime.ts`
- `src/app/closeStop.ts`
- `tests/integration/gates.test.ts`
- `tests/integration/fixLoop.test.ts`
- `tests/integration/protectedPathsGate.test.ts`
- `tests/integration/declaredStopClose.test.ts`

### Boundary contracts

Consumer: the tests. Producer: Effect's `Clock` service, as the app reads it through `Clock.currentTimeMillis`. A test fixes the clock by providing TestClock, or a `Clock` over a mutable instant, in the effect's context, and advances it only inside port wrappers. The app takes no clock parameter and gains no port (spec §10).

### Test strategy

- three passing configured steps record measured times whose startedAt is the fixed clock's instant at each start and whose durationMs are 700, 191000 and 2400 in step order — small · example · the fixed clock's instants and advances · in-phase · ac-step-times
- a gate whose second of three steps exits non-zero records exactly two measured steps, the second fail, and no third — small · example · the expected step list · in-phase · ac-failing-step
- a configured report step whose report refuses is recorded refused with a measured time — small · example · the expected step entry · in-phase · ac-refused-step
- an acceptance step that outruns its cap is recorded fail with a durationMs equal to the clock's advance up to the failure — small · example · ACCEPTANCE_PROVIDER_TIMEOUT_MS as the clock's advance · in-phase · ac-acceptance-timeout
- a skipped acceptance step is recorded skipped with time not-run — small · example · the expected step entry · in-phase · ac-acceptance-skipped
- the attempt's time is measured, starts no later than the first step and lasts the sum of the step durations plus the clock's advance outside them — small · example · the sum of the fixed clock's advances · in-phase · ac-attempt-time
- the protected-paths check records 84 ms, and the step record and gate-attribution.json keep the step and attempt times they held before the check — medium · example · the fixed clock's advances and the two files' equality · in-phase · ac-protected-time
- a stop's close gate writes measured step and attempt times and protectedPaths null to its step record and gate-attribution.json — medium · example · the decoded close-gate files under the fixed clock · in-phase · ac-close-gate
- a phase record on phax/records/v1 carries both attempts' step records and gate-attribution.json with the phase folder's times — medium · example · byte equality between the record's blobs and the phase folder's files · in-phase · ac-record-carries
- the same steps and outputs give the same step results, gate outcome, fix-loop decision and exit code under a still clock and under one advancing hours per step — small · metamorphic · equality of the two runs' verdicts, attempt counts and exitCodeForError · in-phase · ac-no-decision

### Implementation order

1. Write tests/helpers/gateClock.ts after reading TestClock in node_modules.
2. Write the runGates cases in tests/integration/gateStepTimes.test.ts, then the fix-loop cases (protected paths, no-decision).
3. Add the close case to heldStopClose.test.ts and the record case to writeRecord.test.ts.
4. Fix any recording defect the tests expose.

### Excluded scope

- Any change to the gate-attribution shape or its readers (done in phase-01).
- Any change to phax records explain (phase-03).
- Editing src/infra/fakes/*: the clock wrappers live in tests/helpers.
- Any limit or threshold on a time.

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

The helper's API in `tests/helpers/gateClock.ts` (how to fix and advance the clock, and which wrappers exist), and whether it uses TestClock or a hand-written Clock, with the reason. The criteria each new test covers. Any defect found in phase-01's recording and how it was fixed. Any deviation from the planned file lists, with the reason.

### Commit subject

`test(gates): prove gate step times under a fixed clock`

### Commit body

Adds a fixed-clock helper that advances the clock only inside the shell, file-system and git ports. Covers every recording criterion of the gate-step-times spec with it: step instants and durations, a failing, refusing, timed-out or skipped step, the attempt's own time, the protected-paths check and the times it keeps, a stop's close gate, and the phase record on phax/records/v1. A metamorphic test shows that the gate's verdicts, the fix loop's decisions and the exit codes are the same under a still clock and under a fast one.

---

## phase-03 — Gate attempt times in phax records explain {#phase-03-records-explain}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium
**Assignment reason:** The phase adds a new reader of per-attempt step records across app and cli, and settles the --json answer's union and the text block's layout from an indicative spec. That calls for a stronger model than the default.

`phax records explain <phase commit>` lists each gate attempt under its `gates` line: the attempt's duration, then every step's command, surface, result and duration, then the protected-paths check when it ran. `--json` gains `gateAttempts` with the same facts. Older records show `time unknown`, `not run` or `steps unknown`, never an invented figure.

### Detailed instructions

- In `src/app/recordsExplain.ts`, add to `ExplainedRecord` a field `gateAttempts: readonly ExplainedGateAttempt[]`. `ExplainedGateAttempt` is `{ attempt: number; stepRecord: "read"; attribution: GateAttribution } | { attempt: number; stepRecord: "absent" | "unreadable" }`. Compute it in `explainPhaseRecord` from the artifacts: take every `checks-attempt-NN.log` (the same regex `checksAttemptCount` uses), sorted by numeric attempt. Look up `checks-attempt-NN.attribution.json` (use `stepRecordPathFor` from `src/domain/gate/attemptFiles.ts` on the log name). Read it through `readGateAttributionFile`. Absent is `absent`; not JSON or refused is `unreadable`. Never fall back to `gate-attribution.json`. Keep `acceptanceStep` and every other field as they are.
- In `src/cli/definitions/recordsExplain.ts`, add to `PhaseExplained` a key `gateAttempts`: `Schema.Array(Schema.Union([read, missing]))`. `read` is `Struct({ attempt: Number, stepRecord: Literal("read"), time: GateTime, steps: Array(Struct({ command: String, surface: String, result: String, time: GateTime })), protectedPaths: NullOr(Struct({ result: Literals(["pass", "fail"]), time: GateTime })) })`. `missing` is `Struct({ attempt: Number, stepRecord: Literals(["absent", "unreadable"]) })`. `GateTime` is the union of `{ kind: "measured", startedAt: String, durationMs: Number }`, `{ kind: "unknown" }` and `{ kind: "not-run" }`. Map it in `phaseFacts`, leaving out the protected-path change list.
- In `renderPhase`, right after the `gates    …` line, print each attempt. The attempt line is two spaces, `attempt NN` (two digits), then the duration. Each step line is four spaces, then the command, surface, result and duration columns. Then a `protected paths` line (empty surface) when `protectedPaths` is not null. A duration is `(durationMs / 1000).toFixed(1) + " s"`. An `unknown` time prints `time unknown`, `not-run` prints `not run`. An `absent` or `unreadable` attempt prints `  attempt NN   steps unknown` and no step lines. Align the columns across the whole block: the command column takes the width of the longest command or `protected paths`, the surface column fits `structural`, the result column fits `refused`, durations are right-aligned. The spec's §6 sample is the target, and its exact spacing is indicative. Keep the rendering in the CLI definition: it is view code and holds no business logic.
- Nothing else in the default view changes, and `--gates` output stays as it is. The command still exits 0 whatever the step records hold.
- In `tests/integration/recordsExplain.test.ts`, building records the way that file already does: a phase record with two attempts whose step records carry fixed measured times (write them with `encodeGateAttributionFile` and `withSchemaUrl`, so no test names the current release), one attempt with a failing step and a protected-paths result, one with three steps. Assert the exact text lines under `gates` and the `--json` `gateAttempts` (ac-explain). A record whose attribution files are stamped 0.33.0 (`schemaUrl("gate-attribution", "0.33.0")`) and include a skipped acceptance step shows `time unknown` for the attempt and each step and `not run` for the skipped step. A record with `checks-attempt-02.attribution.json` missing shows `attempt 02   steps unknown`. Both exit 0 with the rest of the record shown (ac-explain-unknown). A step record that is not JSON shows `steps unknown` too.

### Planned files to create

- (none)

### Planned files to edit

- `src/app/recordsExplain.ts`
- `src/cli/definitions/recordsExplain.ts`
- `tests/integration/recordsExplain.test.ts`

### Optional files that may be edited

- `tests/integration/recordsExplainStop.test.ts`
- `tests/fixtures/records/jsonContractsRepo.ts`
- `tests/integration/inspectionCommandsJson.test.ts`
- `tests/integration/groupCommandsJson.test.ts`

### Boundary contracts

Producer `explainRecord` (app) and consumer the `records explain` definition (cli): `ExplainedRecord.gateAttempts` lists every attempt the record holds a log for, in attempt order, each read from its own step record, or marked `absent` or `unreadable`. The CLI renders it and adds no judgement of its own. Producer the CLI and consumers scripts reading `--json`: `gateAttempts` entries discriminated by `stepRecord`.

### Test strategy

- a phase record with two timed attempts lists attempt 01 and attempt 02 under the gates line, each with its duration and every step's command, surface, result and duration in step order, then protected paths when the check ran — medium · example · the expected text lines · in-phase · ac-explain
- --json carries gateAttempts with the same attempts, steps, times and protected-paths results as the text — medium · example · the expected gateAttempts value · in-phase · ac-explain
- a 0.33.0-stamped record shows time unknown for its attempt and steps, a skipped acceptance step shows not run, a missing step record shows steps unknown, and both commands exit 0 with the rest of the record — medium · example · the expected text lines and exit code 0 · in-phase · ac-explain-unknown
- a step record that is not JSON shows steps unknown and the command still exits 0 — medium · boundary · the expected attempt line and exit code 0 · in-phase

### Implementation order

1. Add gateAttempts to ExplainedRecord and compute it in src/app/recordsExplain.ts.
2. Add the --json schema and mapping in src/cli/definitions/recordsExplain.ts.
3. Render the text lines.
4. Write the integration cases.

### Excluded scope

- Any summary of gate times across phases or runs, in phax records, phax cost or a new command (spec §7).
- Folding or capping long step lists.
- Changes to --gates output or to the acceptance line.
- Any change to the gate-attribution format or its writers.

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

The `ExplainedGateAttempt` type and the `gateAttempts` JSON shape, as implemented. The exact text layout chosen (column widths, a sample block) so phase-04 can paste a faithful example into the docs. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(records): show gate attempt and step times in records explain`

### Commit body

phax records explain now lists every gate attempt of a phase record under its gates line: the attempt's duration, then each step's command, surface, result and duration, then the protected-paths check. --json gains gateAttempts with the same facts. Each attempt is read from its own checks-attempt-NN.attribution.json in the record. A record written before times were recorded shows time unknown, a skipped acceptance step shows not run, and a missing or unreadable step record shows steps unknown.

---

## phase-04 — Document gate times and the format change {#phase-04-docs}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

The `guide/records` page shows an operator where a phase's gate time went in `phax records explain`. `docs/upgrading.md` announces the new `gate-attribution` shape and what it means for `@lbdremy/phax-schemas` readers.

### Detailed instructions

- Read phase-03's handoff for the exact text layout, and phase-01's for the format's facts.
- In `README.md`'s `## Records` section (the source of the `guide/records` page, see `site/pages.ts`), add a short paragraph after the paragraph that names `records explain`'s flags. Explain that the default view lists each gate attempt under the `gates` line with its duration and each step's command, surface, result and duration, then the protected-paths check. Explain that this is where the gate time went and what each fix attempt cost, and that times come from the gate attribution of each attempt (`checks-attempt-NN.attribution.json`). Show a short example block in the shape of spec §11, using the layout phase-03 implemented. Say that a record written before times were recorded shows `time unknown`, that a skipped acceptance step shows `not run`, and that a missing step record shows `steps unknown`. Mention `--json`'s `gateAttempts` in one sentence. Keep the README's style: short, plain sentences.
- In `docs/upgrading.md`, under `## Release by release`, add the entry to the `### 0.43.0` section, creating it above `### 0.41.0` if it does not exist. In the style of the 0.31.0 and 0.40.0 entries: `gate-attribution.json` and `checks-attempt-NN.attribution.json` move to a new shape (stamped 0.43.0) with a required `time` on the attempt, on every step and on a non-null `protectedPaths`: `measured` with `startedAt` and `durationMs`, or `not-run` for a skipped acceptance step. Older attributions still read, with their times `unknown`, and are never rewritten. An `@lbdremy/phax-schemas` before 0.43.0 cannot read the new attributions, so upgrade the package. Its `toLatestGateAttribution` gives 0.26.0 to 0.33.0 attributions `unknown` times. Say that no step is needed in a repository.
- If `docs/cli/reference.md` describes `records explain`'s default output in prose, add the attempt lines there in one sentence. Do not regenerate generated docs.

### Planned files to create

- (none)

### Planned files to edit

- `README.md`
- `docs/upgrading.md`

### Optional files that may be edited

- `docs/cli/reference.md`
- `packages/schemas/README.md`

### Test strategy

- (none)

### Implementation order

1. README.md's Records section.
2. docs/upgrading.md's 0.43.0 entry.
3. docs/cli/reference.md, only if it describes the default view.

### Excluded scope

- Any code or test change.
- Edits to site/generated or site/doc_build (generated, ignored by git).
- NEXT_STEPS.md and the archive of the spec, brief or plan (the operator's steps).

### Verification

The `standard` gate profile in `phax.json` (this last phase also runs its terminal steps, `pnpm site:build` among them).

### Expected handoff content

The README paragraph and example as written, the upgrading entry, and whether `docs/cli/reference.md` was touched. Any deviation from the planned file lists, with the reason.

### Commit subject

`docs(records): document gate step times and the gate-attribution shape`

### Commit body

The Records section (the guide/records page) shows how phax records explain lists each gate attempt's steps with their durations, and what time unknown, not run and steps unknown mean. docs/upgrading.md announces the new gate-attribution shape with its required times, how older attributions read, and that @lbdremy/phax-schemas readers must upgrade to read new attributions.
