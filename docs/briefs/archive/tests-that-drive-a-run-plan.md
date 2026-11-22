Write the phax plan "Tests that drive a run" for the approved spec `docs/specs/2611221732-tests-that-drive-a-run.md`.
It is the spec's only plan: it carries `completes-spec: true`.

Read the spec in full, sidecar included, and its brief `docs/briefs/archive/tests-that-drive-a-run.md` (with its measures of
2026-11-20 and 2026-11-22). These are settled; do not reopen them:
- the operator's verdicts of 2026-11-22 in §9b: q-paths `same-path`, q-logs `recorded`, q-scope `measured-rule`,
  q-target `covered-half`;
- everything §10 lists as settled, and its constraints; the non-goals of §7. Nothing under `src/` changes.

This plan takes every requirement of §5, every §6 surface and every §8 criterion.

## Facts read on main at c4f34f3 (2026-11-22)

- **The run-driving fixtures**: `tests/helpers/heldRunFixture.ts` (`createHeldWorld`, `startHeldRun`,
  `resumeHeldRun`, `HeldRun` with its in-memory logs, `backendCalls`) and `tests/helpers/stoppedRunFixture.ts`
  (`createWorld`, `stopRun`, `StoppedRun`, `writeRegistry`). 16 integration files use them.
- **The repeated prefix, one example**: in `tests/integration/heldStopRun.test.ts` (84 s, 18 tests), 15 tests begin
  with `heldAtPhase02`, which drives phase-01 to its commit and holds phase-02, with records on (7) or off (8): two
  prefixes driven 15 times. The other slow files are listed with their times in the brief.
- **The precedent**: `tests/fixtures/worlds/worldCache.ts` (`cachedWorld`, `copyWorld`, `assertNoBuildPath`), from
  `test-worlds-built-once` (#253): a world built once per file, copied per test, a guard that refuses a copy holding
  the build's path. Reuse it where it fits; its decisions bind (per file, directory copy, no path back to the cache).
- **The measuring tool**: `spikes/test-worlds/measure.mjs` runs the suite with vitest's JSON reporter and compares
  two reports per file and per test. Git processes were counted with `GIT_TRACE` (2,025 in `heldStopRun`, 2,492 in
  `stopRecords`). An environment prefix such as `GIT_TRACE=… pnpm exec vitest …` is not a command a phase may run:
  a measuring script run with `node` sets the variables itself.
- **vitest**: `vitest.config.ts` is protected. Integration tests run one file per worker and the tests of a file one
  after another (no `concurrent`), which q-paths `same-path` relies on; `testTimeout` 90 s, `hookTimeout` 120 s.

## Settle in Technical arbitrations, with the dominant loss of each

- **The first phase's measure and how it decides the covered files** (q-scope `measured-rule`): what counts as one
  prefix (its parameters, §4), how the repeated-prefix share is computed per file, and where the measure and its
  verdict are kept (a spike folder beside `spikes/test-worlds/`, its reports committed as #253's were).
- **Where the snapshot lives and when it is taken**: a file-level hook driving each distinct prefix once, or a lazy
  cache keyed by the prefix parameters; how the restore resets the world's root before each test; how a snapshot of
  a run with records on keeps its records branch and its HOME.
- **The fresh-drive switch** (q-logs `recorded`): how it is set, and which gate or command runs the covered files
  both ways, so a log the copy misses fails a test.
- **What happens when the measure shows a small prefix share.** The plan may end after the measure with no covered
  file, recorded as the result; say how that ending is recorded and what the remaining phases then do.

## Shape

Measure first (a phase that only measures and commits its reports and verdict), then the fixture's snapshot and
restore with their own tests, then the covered files in batches small enough to review, then the after measure
against q-target `covered-half` (median of three runs) with the suite's wall time, CPU and the gate's test step
recorded beside it. Models: `claude-opus-5-5` at medium for the fixture and measure phases; mechanical batches may
run on `claude-sonnet-5-5`.

No acceptance phase: the surface is the tests and the measures, which a test and a report read in full.

## Lessons from the runs on this repository

- **knip runs at every phase's gate**, default and `--production --strict`, against `knip-baseline.json`
  (protected). An export that only a later phase uses fails the gate: export it where it is first used.
- **`pnpm lint` is type-aware, against `lint-baseline.json` (protected).** Fix a lint error in the code; never add
  a disable directive.
- **Protected, untouched**: `knip.json`, both baselines, `.oxlintrc.json`, `.oxfmtrc.json`, the tsconfigs,
  `vitest.config.ts`, the workflows.
- **Tests never read `~/.phax`, a real provider home or the global git config.** A child process goes through
  `tests/helpers/boundedSpawn.ts`; the architectural guard refuses an unbounded spawn.
- **No test measures wall-clock time**; the measures are reports kept beside the change, not assertions.
- **A suite measure is noisy** (about 20 s between runs of the same tree): take before and after on the same machine,
  one after the other, and compare medians.

Every required command must equal an entry of `security.agentCommands` or a gate command exactly; an entry with a
space in it covers only itself. `node`, `pnpm exec tsx`, `pnpm test:unit`, `pnpm test:integration`, `git log`,
`git grep` are `agentCommands`; `pnpm test` is a gate command.
