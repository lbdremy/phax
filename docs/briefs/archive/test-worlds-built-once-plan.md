Write the phax plan "Test worlds built once" for the approved spec
`docs/specs/2611191142-test-worlds-built-once.md`. It is the spec's only plan: it carries `completes-spec: true`.

Read the spec in full, sidecar included, and its brief `docs/briefs/test-worlds-built-once.md`. These are settled; do
not reopen them:
- the five operator decisions of 2026-11-19 in §9b: q-build-scope `per-file`, q-copy `dir-copy`, q-paths `split`,
  q-gate-tiers `keep`, q-143 `observe`;
- everything §10 lists as settled, and its constraints; the non-goals of §7 (nothing under `src/` changes, no
  timeout, gate profile or runtime change).

This plan takes every requirement, §5.1 to §5.13, every §6 surface and every §8 criterion.

## Measures on main at 0c6135c1 (2026-11-20, this machine: 14 cores, vitest 5.1)

Taken with `vitest run --reporter=json` on the whole suite, before any change:

- 22,512 tests, 22,482 passed, 30 skipped, 0 failed; 205 s of wall time.
- Sum of file times 2,227 s: integration 2,100 s, unit 127 s. 21 integration files of 30 s or more, 1,082 s together.
- Slowest files: `recordsStatusBranch` 105 s, `heldStopRun` 94 s, `stopRecords` 86 s,
  `recordsBranchSync.acceptance` 70 s, `acceptancePairReview` 67 s, `heldStopClose` 64 s, `decideVerdicts` 59 s.
- Slowest test: the 300-record test of `recordsStatusBranch`, 63 s. Next, `recordsBranchSync.acceptance`'s
  "ac-never-forced" test, 28 s.

These are the "before" the spec's §5.12 starts from. The plan still measures its own before on its base commit (see
below), because main moves.

## Which builders to cover (§10's left-open item, closed here)

- `buildBranchTipWorld` (`tests/fixtures/records/branchTipRepos.ts`) is used by four test files:
  `recordsStatusBranch`, `recordsBranchSync.acceptance`, `recordsBranchSyncUnits`, `recordsSyncText`. Cover it.
- `createHeldWorld` (`tests/helpers/heldRunFixture.ts`) and `createWorld` (`tests/helpers/stoppedRunFixture.ts`) init
  one repository with one commit: about five git processes per test. `heldStopRun` has 18 tests, so its builder costs
  about one second of its 94 s; the rest is the run each test drives. The same holds for `stopRecords`,
  `heldStopClose`, `acceptancePairReview` and `decideVerdicts` (99 tests, no world builder). Covering these builders
  would not move the measures. Leave them out, and say so in Technical arbitrations with the numbers above.
- Search the other integration files for a builder that writes many commits in a loop (as `buildBranchTipWorld` does
  with `commitRecordTree`). Only `recordsWriteParent` and `writeReviewRecord` call `commitRecordTree` outside the
  fixture, and they call it to test it: they keep doing so (§10: records written during a test keep going through
  phax's real plumbing).

## Measuring before and after (§5.12, §5.11)

The `## Required commands` must equal an entry of `security.agentCommands` or a gate command exactly, and an entry
with a space in it covers only itself. `pnpm test`, `pnpm test:unit`, `pnpm test:integration`, `node` and
`pnpm exec tsx` qualify; `pnpm exec vitest …` and `git worktree` do not. Settle in Technical arbitrations how the
before and after are taken and compared. Indicatively, the cheapest shape that meets the spec: the first phase adds a
measuring script under `spikes/test-worlds/` (run with `node`; `spikes/` is outside knip's project, but
format and lint still read it), runs it on the unchanged tree, and commits its compact before report (file, full name, project, state,
duration) beside it; the last phase runs it on the change, compares the two reports test by test, writes the measures
into its commit message (§6's indicative shape) and deletes the report, keeping the script. The comparison goes by file
and full test name, and reports any test missing, failed or newly skipped.

The last phase also observes q-143 over three full runs. Note for it: the same kind of kill hit
`tests/integration/recordsJsonContracts.test.ts` ("--json-schema prints its entry…", exit 143 from `phax --json-schema`)
in the release gate of 0.41.0 on CI, 2026-11-20, and passed on retry. Report both tests.

## Shape

Core to surface: the bulk record write and its equality with `commitRecordTree` (§5.7) first; then the per-file
cache, the copy, the split between the cached path-free part and the per-test path-bound part, and the copy guard;
then `buildBranchTipWorld` on top of them with its environment handling (§5.8, §5.9) and cleanup (§5.10); the measures
last. Every §8 criterion has its own named test, in a test file of the fixture's own (the "Every test that passed still
passes" criterion is met by the last phase's comparison, not by a test). The `BranchTipWorld` a caller receives keeps
its shape, and the four calling files do not change, unless a file must stop building a new world per test to benefit
(`recordsStatusBranch`'s `newWorld`): then it changes how it calls the builder, never what it asserts.

No acceptance phase: the spec changes no surface a user sees (§11 "None"), only test fixtures.

## Lessons from the runs on this repository

- **knip runs at every phase's gate**, in default and `--production --strict` mode against `knip-baseline.json`
  (protected). An export that only a later phase uses fails the gate: export it in the phase that first uses it.
- **`pnpm lint` is type-aware and compared with `lint-baseline.json` (protected).** A lint error is fixed in the code;
  never add a disable directive.
- **CI rehearses the release cut and the next opening on every pull request.** No test may name the opened version.
- **No `docs/upgrading.md` entry**: nothing a user runs changes.
- **Tests never read `~/.phax`, a real provider home or the global git config.** The §8 criterion "The person's
  configuration stays out" plants its own global configuration through `GIT_CONFIG_GLOBAL` in a temporary directory.
- **A counter-example found during the run is a bug in the code under test unless the test made it.** Here the code
  under test is the fixture: a copy that differs from a fresh build is a fixture bug, never a reason to loosen the
  snapshot comparison.
