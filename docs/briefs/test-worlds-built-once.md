Write the phax spec `test-worlds-built-once`: the git repositories phax's integration tests build are built once and
copied, and the many commits a test needs are written in one git process, so the suite takes a fraction of its time
and checks the same things. A change to the tests' fixtures only; phax gains no feature.

## Why

`pnpm test` is a gate step that fires at every phase (`phax.json`, profile `standard`). The whole suite takes about
4 minutes on a 14-core machine, so a plan of six phases waits about 24 minutes on it, before any retry. A phase that
runs the suite itself pays it again: phases spend 27% of their wall time waiting on feedback commands they run
themselves, whole-suite test runs the largest share (`docs/briefs/archive/gate-step-scoped-checks.md`, measured 2026-11-04).

The time is not JavaScript's. It is git's, in the repositories the integration tests build before they check
anything. A faster runtime would not change it: running the CLI under Bun instead of `tsx` cut one launch from about
1 s to 0.2 s, and left the two slowest files at the same 37 s.

## Measures (main at 3a70a28d, 2026-11-19, 14 cores, vitest 5.1)

- **The suite:** 22,390 tests in 734 files, 235 s of wall time. The time spent in each file adds up to 2,712 s:
  2,500 s in the 269 integration files (92%), 212 s in the 465 unit files.
- **Concentrated:** 21 integration files take 30 s or more each, 1,158 s together; 67 take 10 s or more, 2,021 s.
  The slowest: `recordsStatusBranch` (121 s), `heldStopRun` (102 s), `stopRecords` (97 s),
  `recordsBranchSync.acceptance` (79 s), `acceptancePairReview` (78 s), `heldStopClose` (69 s).
- **git, process by process:** `recordsStatusBranch` alone starts git more than 3,400 times in about 40 s, some
  12 ms each. Its one test of 70 s, "counts only the local-only records of a diverged branch sharing 300 with the
  remote", commits 300 records one by one through `commitRecordTree`, each commit several git processes.
- **Rebuilt for each test:** `buildBranchTipWorld` (`tests/fixtures/records/branchTipRepos.ts`) inits a bare remote,
  an upstream clone and a source repository, commits `phax.json`, then the remote's records, in every test that
  calls it. 113 integration files use a builder of this kind (`buildBranchTipWorld`, `heldRunFixture`,
  `stoppedRunFixture`, `tempGit`).
- **Not the CLI:** the two slowest files launch the CLI 16 times in 37 s; replacing `tsx` by Bun for those launches
  changed nothing measurable.
- **One failure under full load:** `phaseGuard`, "lets phax --json-schema print the runner's catalogue", got exit 143
  (killed) instead of 0 in the full run, as the timeouts noted in `vitest.config.ts` did before.

## Settled (do not reopen)

1. **The tests check what they check today.** No assertion removed, no test skipped or moved out of the gate to save
   time; only how their repositories come to exist changes.
2. **Real git.** The repositories stay real repositories, written by git: no mocked git, no hand-written object files.
3. **Deterministic.** A world built once must be byte-identical to the one each test builds today (fixed dates,
   fixed identities, as `buildBranchTipWorld` already does), so a copy is indistinguishable from a fresh build.
4. **Isolated.** Each test gets its own copy and may change it; nothing one test writes reaches another.
5. **No runtime change** for this: the runtime is not where the time goes.

## What the spec must cover

- **Built once, copied:** where a world is built (once per run in vitest's `globalSetup`, once per worker, or once
  per file in `beforeAll`), where it is kept, and how a test gets its copy (a directory copy, `git clone --local`,
  `cp -c` on APFS). Which of the builders above it covers first, by the time they cost.
- **Absolute paths:** a world holds its own paths (the remote's URL `ssh://records.test<path>` in `.git/config`,
  `state.root` in `phax.json`). Say how a copy at another path stays correct: rewritten after the copy, or a world
  built with paths that do not depend on where it sits.
- **Many commits in one process:** the records a world needs (300 in the slowest test) written by
  `git fast-import`, or another single process, instead of one `commitRecordTree` call each, and how the spec keeps
  the property that those records are what phax's real plumbing writes (for instance, one test still writes through
  `commitRecordTree` and compares its commit with the imported one).
- **The environment a builder sets:** `buildBranchTipWorld` sets `GIT_SSH_COMMAND` and the identity variables in
  `process.env`; a builder run once in `globalSetup` runs in another process than the tests.
- **Acceptance:** the suite's wall time and the sum of its files' times before and after, measured as above on the
  same machine, in the plan's last phase; every test that passed before passes after; `recordsStatusBranch` and the
  other files over 30 s each named with their time.

## Open questions

- **Tiers in the gate.** The gate brief already names it as worth doing on its own: `pnpm test` split into
  `pnpm test:unit` at every phase and `pnpm test:integration` where it fires (every phase, or terminal). It cuts what
  each phase waits for, but a phase that breaks an integration test would learn it later. This spec makes the
  integration tier cheap first; whether it then leaves the every-phase gate is the operator's decision.
- **The 143 under load.** Whether `phaseGuard`'s kill comes from the suite's load and goes away once the suite is
  lighter, or needs its own look.
