---
status: Approved
date: 2026-11-19
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
approved:
  date: 2026-11-19
  baseline: b270ecf
---
# Test worlds built once

## 1. Context

`pnpm test` is a gate step of the `standard` profile in `phax.json`, firing at every phase. On main at 3a70a28d (2026-11-19, 14 cores, vitest 5.1) the suite runs 22,390 tests in 734 files in 235 s of wall time. The time spent in each file adds up to 2,712 s: 2,500 s in the 269 integration files (92%), 212 s in the 465 unit files. 21 integration files take 30 s or more each (1,158 s together), 67 take 10 s or more (2,021 s). The slowest are `recordsStatusBranch` (121 s), `heldStopRun` (102 s), `stopRecords` (97 s), `recordsBranchSync.acceptance` (79 s), `acceptancePairReview` (78 s) and `heldStopClose` (69 s).

The time is git's, spent building the repositories a test needs before it checks anything. `buildBranchTipWorld` inits a bare remote, an upstream clone and a source repository, commits `phax.json`, then commits the remote's records one by one through `commitRecordTree`, several git processes per record, at a fixed, increasing date and a fixed identity. `recordsStatusBranch` calls it in every test and starts git more than 3,400 times in about 40 s, some 12 ms each; its test "counts only the local-only records of a diverged branch sharing 300 with the remote" takes 70 s, most of it committing those 300 records. 113 integration files use a builder of this kind (`buildBranchTipWorld`, `createHeldWorld` in `heldRunFixture`, `createWorld` in `stoppedRunFixture`, the `tempGit` helpers).

A world holds its own absolute paths: the remote URL `ssh://records.test<base>/remote.git` in the source repository's and the upstream clone's `.git/config`, and `state.root` in the committed `phax.json`. `buildBranchTipWorld` also sets `GIT_SSH_COMMAND` (a script inside the world) and the four `GIT_AUTHOR_*`/`GIT_COMMITTER_*` identity variables in `process.env`, and puts them back on `cleanup`; `isolateGit` keeps git away from the person's configuration the same way. The held and stopped run builders commit at the current time, not a fixed one, and the bulk of those files' time is plausibly the run they drive afterwards, not the one-commit repository they init.

The CLI is not where the time goes: running it under Bun instead of `tsx` cut one launch from about 1 s to 0.2 s and left the two slowest files at the same 37 s. Under the full load, `phaseGuard`'s "lets phax --json-schema print the runner's catalogue" was killed (exit 143) instead of exiting 0, as the timeouts noted in `vitest.config.ts` were before.

Ground read:

- `docs/briefs/test-worlds-built-once.md` — The brief: the measures on main at 3a70a28d (2026-11-19), the settled points and the two open questions.
- `tests/fixtures/records/branchTipRepos.ts` — buildBranchTipWorld: a bare remote, an upstream clone and a source repository, phax.json committed with state.root and an ssh:// remote URL that both hold the build directory's absolute path; one commitRecordTree call per record at a fixed date; GIT_SSH_COMMAND and the identity variables set in process.env until cleanup.
- `tests/integration/recordsStatusBranch.test.ts` — Builds a new world in every test (newWorld); the 300-record test is the slowest single test of the suite.
- `tests/helpers/heldRunFixture.ts` — createHeldWorld: one repository, one commit at the current time, git isolated; the run's phases are started per test after it.
- `tests/helpers/stoppedRunFixture.ts` — createWorld: one repository, one commit at the current time, git isolated; stopRun drives a run to its stop per test.
- `tests/helpers/isolateGit.ts` — isolateGit keeps every git a test runs away from the person's configuration, through process.env.
- `tests/helpers/tempGit.ts` — disableGitAutoMaintenance and removeTempDir, applied to every repository a test creates.
- `vitest.config.ts` — Two projects, unit and integration; the integration timeouts (90 s per test, 120 s per hook) were raised because a loaded machine failed green changes.
- `phax.json` — Profile standard runs `pnpm test` at every phase.
- `package.json` — `test` runs the whole suite; `test:unit` and `test:integration` run each tier.

## 2. Problem

Every phase of a run waits about 4 minutes on `pnpm test`, so a six-phase plan waits about 24 minutes on it before any retry, and a phase that runs the suite itself pays it again: phases spend 27% of their wall time waiting on feedback commands they run themselves, whole-suite runs the largest share. Nearly all of that time is git processes rebuilding, in every test, repositories that are the same each time: the same commits, at the same dates, by the same identity. The cost grows with what a test needs (300 records cost 300 rounds of several git processes), and the load it puts on the machine is what kills tests like `phaseGuard`'s under the full suite. A faster runtime does not help; only starting fewer git processes does.

## 3. Product goal

The repositories the integration tests need are built once and each test gets its own copy, and the many record commits a world holds are written by one git process instead of several per commit, so the suite takes a fraction of its time while every test checks exactly what it checks today, against real repositories written by git. A change to the tests' fixtures only: phax gains no feature and its code does not change.

> A copy must be indistinguishable from the world the test would have built itself; only the number of git processes changes.

## 4. Terminology

- **world** — The set of real git repositories and files a test builds before it checks anything: for `buildBranchTipWorld`, the bare records remote, the upstream clone, the source repository with `phax.json`, the fake ssh script and the folders around them.
- **world builder** — A test helper that builds a world: `buildBranchTipWorld`, `createHeldWorld`, `createWorld` and the helpers built on `tempGit`.
- **parameters** — What a builder's caller passes that changes the world it builds, e.g. `remoteRecords`. Two calls with the same parameters build the same world.
- **cached world** — A world built once during a test run for one set of parameters, kept for the length of the run, and never handed to a test directly.
- **copy** — A test's own world, taken from a cached world at a fresh path of its own, which the test may change freely.
- **fresh build** — What the builder produces today when a test calls it: the world built from nothing at the test's own path.
- **build path** — The absolute path at which a cached world was built.
- **bulk record write** — Writing the many record commits a world holds through one git process, instead of one `commitRecordTree` call (several git processes) per record.
- **file time** — The time vitest reports for one test file; the sum of file times is the total over all files, distinct from the suite's wall time, which runs files in parallel.

## 5. Functional requirements

### 5.1 A world built once per parameters

WHEN a test asks a covered world builder for a world whose parameters match a cached world THE fixture SHALL give the test a copy of that cached world instead of building it again.

### 5.2 A copy is a fresh build

The fixture shall make a copy at a path P byte-identical to a fresh build at P: the same refs pointing at the same commit ids in every repository, the same repository configuration, and the same files in every working tree.

### 5.3 Fixed dates and identities

The fixture shall give every commit a cached world holds a fixed date and a fixed identity, so that two builds with the same parameters at the same path hold the same commit ids.

### 5.4 No path back to the cached world

IF a copy holds the build path in any of its files THEN the fixture SHALL fail the test that took it, naming the file that holds the path.

### 5.5 Copies are isolated

The fixture shall keep everything a test writes in its copy out of the cached world and out of every other test's copy.

### 5.6 Records in one process

The fixture shall build a world with the same number of git processes whatever the number of records it holds.

### 5.7 Bulk records are phax's records

The fixture shall write, through the bulk record write, the same commit id that `commitRecordTree` writes for the same key, origin, artifact, date, identity and parent.

### 5.8 The environment a world needs

WHEN a test takes a copy THE fixture SHALL set, in the test's own process, the environment the world needs (`GIT_SSH_COMMAND` pointing at the copy's own ssh script, and the four identity variables) and SHALL put each variable back as it was when the copy is cleaned up.

### 5.9 Built away from the person's git configuration

The fixture shall build every cached world with git isolated from the person's configuration, as `isolateGit` isolates a test's own git today.

### 5.10 Nothing left behind

WHEN a test run ends THE fixture SHALL remove every cached world it built during the run.

### 5.11 The same tests, passing

The change shall keep every test that exists before it, under the same file and full name, with the same assertions, passing and not skipped, in the tier and gate step that runs it today.

### 5.12 Measured before and after

WHEN the plan's last phase runs THE phase SHALL record, measured on one machine before and after the change, the suite's wall time, the sum of its file times split by tier, and every integration file over 30 s with its time, `recordsStatusBranch` among them.

### 5.13 The 300-record test

The fixture shall let the test "counts only the local-only records of a diverged branch sharing 300 with the remote" complete in under 10 s within a full `pnpm test` run on the machine of the measures.

## 6. Surface

### internal: buildBranchTipWorld — normative

Summary: A test calls the builder exactly as today and gets its own copy of a world built once in the run, instead of waiting for it to be rebuilt.

before:

    const world = await buildBranchTipWorld({ remoteRecords: 300 });
    // inits a bare remote, an upstream clone and a source repo,
    // then 300 commitRecordTree calls: ~3,400 git processes
    const diverged = await putBranchDiverged(world, { localOnly: 2, remoteNew: 1 });
    world.cleanup(); // restores GIT_SSH_COMMAND and the identity, removes the world

after:

    const world = await buildBranchTipWorld({ remoteRecords: 300 });
    // the same BranchTipWorld, at a path of its own: a copy of the world
    // built for { remoteRecords: 300 } earlier in this run
    const diverged = await putBranchDiverged(world, { localOnly: 2, remoteNew: 1 });
    world.cleanup(); // restores GIT_SSH_COMMAND and the identity, removes this copy only

### internal: world copy guard — indicative

Summary: A test whose copy still points at the cached world fails at once, naming the file that holds the stale path.

    Error: world copy /tmp/phax-branch-tip-ab12cd still holds the build path
      /tmp/phax-world-cache-x9y8z7/branch-tip-300
      in source/.git/config

### file: the last phase's commit message — indicative

Summary: A reader of the change's history sees the suite's time before and after, and every integration file still over 30 s.

    Measures (14 cores, vitest 5.1), before -> after:
      suite wall time            235 s -> <after> s
      sum of file times        2,712 s -> <after> s
        integration            2,500 s -> <after> s
        unit                     212 s -> <after> s
    Integration files over 30 s, before -> after:
      recordsStatusBranch        121 s -> <after> s
      heldStopRun                102 s -> <after> s
      stopRecords                 97 s -> <after> s
      ...

## 7. Non-goals

- No change to phax itself: nothing under `src/` changes and phax gains no feature, flag or config key.
- No runtime change: the CLI stays launched as today, through `tsx`.
- No mocked git and no hand-written object files: every repository is written by git.
- No assertion removed, no test skipped, deleted or moved out of the gate or into another tier to save time.
- No cache kept across test runs: a cached world lives for one run only.
- No change to the gate profile in `phax.json` (whether `pnpm test` splits into tiers is a separate decision, see the open questions).
- No change to the timeouts in `vitest.config.ts`.
- No change to the unit tier or to `pnpm test:e2e:real`.
- No fix of `phaseGuard`'s exit 143 beyond observing whether the lighter suite removes it.

## 8. Acceptance criteria

### A second call builds nothing

Given a test file whose two tests each call `buildBranchTipWorld({ remoteRecords: 300 })`, when the second test's call runs under `withGitTrace`, then the trace shows no `git init` of a remote and no record written for the remote, and the world it answers has the same `remoteTip()` as the first test's world. (refs §5.1)

### A copy equals a fresh build at its path

Given a fresh build at a path P, snapshotted as every ref with its commit id in every repository, every repository's configuration and every working-tree file's content, then removed, when a copy of the cached world with the same parameters is taken at P and snapshotted the same way, then the two snapshots are equal. (refs §5.2)

### Two builds hold the same commits

Given two builds of a world with the same parameters at the same path, one after the other, for `buildBranchTipWorld` and for every other covered builder, when each build's refs are listed with their commit ids, then the two lists are equal, and every commit carries the fixture's fixed identity and a fixed date. (refs §5.3)

### A stale path fails the test

Given a cached world into which a test plants a file under its source repository holding the build path, when a test takes a copy of it, then the test fails with an error that names the planted file and the build path. (refs §5.4)

### One test's writes stay in its copy

Given two tests taking copies of the same cached world, when the first commits records on its records branch and pushes them to its own remote, then the second test's remote tip, and the cached world's, are still the tip the build left. (refs §5.5)

### Records do not cost git processes

Given two builds of `buildBranchTipWorld`, one with `remoteRecords: 4` and one with `remoteRecords: 300`, when each build runs under GIT_TRACE, then both builds start the same number of git processes. (refs §5.6)

### Bulk records match phax's plumbing

Given the same record keys, origin, artifact, dates and identity, when they are written into one repository by the bulk record write and into another by one `commitRecordTree` call each, then the two records branches have the same tip commit id. (refs §5.7)

### The copy's environment, then the test's again

Given a test that sets `GIT_SSH_COMMAND` and `GIT_AUTHOR_NAME` to values of its own, then takes a copy, when it spawns `phax records status` in the copy's source repository, then cleans the copy up, then `phax records status` exits 0 against the copy's own remote, and after cleanup both variables hold the test's values again. (refs §5.8)

### The person's configuration stays out

Given a global git configuration, pointed at by `GIT_CONFIG_GLOBAL` before the run, setting `user.name = Someone Else` and `init.defaultBranch = trunk`, when a cached world is built and a test takes a copy, then every commit in the copy carries the fixture's identity and every repository's first branch is the one the fixture names. (refs §5.9)

### No cached world left behind

Given the temporary directory listed before a full `pnpm test:integration` run, when the run ends, then the temporary directory holds no cached world that was not there before. (refs §5.10)

### Every test that passed still passes

Given vitest's JSON report of a full `pnpm test` run on main before the change and one after, when the two reports are compared by file and full test name, then every test of the first report is in the second, passed and not skipped, the same tests run under `pnpm test:unit` and `pnpm test:integration` as before, and every test the second adds is one of the fixture's own. (refs §5.11)

### The measures are recorded

Given the plan's last phase, on the machine the before measures came from, when it runs the full `pnpm test` on main before the change and on the change, then its commit message holds the suite's wall time, the sum of file times split by tier, and every integration file over 30 s with its time, before and after, `recordsStatusBranch` named with both times. (refs §5.12)

### The 300-record test is fast

Given the change, on the machine of the measures, when the full `pnpm test` runs, then vitest reports the test "counts only the local-only records of a diverged branch sharing 300 with the remote" under 10 s. (refs §5.13)

## 9. Open questions

None.

## 9b. Arbitrated questions

### q-build-scope — Where is a world built once: once per run, once per test file, or once per run on first request?

- per-run — Once per run, in vitest's globalSetup, handed to the tests by path — abandons: Running one test file stays cheap: globalSetup builds every cached world the suite uses, and it runs in another process than the tests, outside their setup files and their environment.
- per-file — Once per test file, on the first test's request, kept until the file ends — abandons: A world shared by many files is built once in each of them instead of once in the run.
- per-run-lazy — Once per run, built by the first worker that asks and shared by the others — abandons: Simplicity: a cross-process build lock every worker waits on, and a failure in one worker's build reaching the others.

Recommendation: per-file — The measured cost is a rebuild per test, and per-file removes it; once records are written in one process a build is a fixed handful of git processes, so repeating it once per file costs seconds, not minutes. It also keeps the builder in the test's own process, with its environment and git isolation as today. Revisit per-run only if the after measures show builds still dominant.

Decision: per-file — by operator (Rémy Loubradou), 2026-11-19
Why: Operator agrees with the recommendation. Advocate: Per-run builds each world once for the whole suite, so a world shared by many files is not rebuilt in each of them; the loss of per-file is that repeated builds. Principles: S1, C1. Reversibility: cheap. Revised: none.

### q-copy — How does a test get its copy?

- dir-copy — A recursive directory copy, copy-on-write where the filesystem offers it — abandons: On a filesystem without copy-on-write, each copy pays for every byte of the world.
- clone-local — `git clone --local` of each repository — abandons: Byte-identity: a clone has its own configuration, remotes and reflogs and lacks the original's remote-tracking refs, so a copy is no longer a fresh build.
- apfs-clone — `cp -c`, the APFS clone — abandons: Linux: CI and any machine off APFS cannot run it.

Recommendation: dir-copy — It is the only option that keeps a copy byte-identical on every platform; the copy-on-write fast path gives macOS what `cp -c` would, and a world of a few hundred small objects copies in milliseconds anyway.

Decision: dir-copy — by operator (Rémy Loubradou), 2026-11-19
Why: Operator agrees with the recommendation. Advocate: `cp -c` gives an instant copy-on-write clone on APFS; the loss of dir-copy is paying for every byte on filesystems without copy-on-write. Principles: S1, C3. Reversibility: cheap. Revised: none.

### q-paths — How does a copy at another path stay correct, given the absolute paths a world holds (remote URLs in `.git/config`, `state.root` in the committed `phax.json`)?

- split — Cache only the path-free part (the remote's objects and refs, the record commits) and build the path-bound part per test (remote URLs, `phax.json` and its commit) — abandons: A few git processes per test remain: the source repository's init, its remotes and its one commit.
- rewrite — Copy everything, then rewrite every occurrence of the build path and recommit the committed files that hold it — abandons: Certainty: the rewrite must know every place a path hides (configuration, committed files, worktree links), and one it misses silently points the copy at the cached world.

Recommendation: split — The expensive part of a world, the records, holds no path; the path-bound part is cheap to build and built exactly as today, so it needs no rewrite to get right. The copy guard catches a path either way.

Decision: split — by operator (Rémy Loubradou), 2026-11-19
Why: Operator agrees with the recommendation. Advocate: Rewrite copies the whole world and avoids the few per-test git processes the split keeps; the loss of split is those processes. Principles: S1, C2. Reversibility: cheap. Revised: none.

### q-gate-tiers — Once the integration tier is cheap, does `pnpm test` stay one every-phase gate step, or split into `pnpm test:unit` at every phase and `pnpm test:integration` at the terminal phase?

- keep — Keep `pnpm test` at every phase; decide the split separately on the after measures — abandons: The integration tier's remaining time, paid again at every phase.
- integration-terminal — Split the step: unit at every phase, integration at the terminal phase — abandons: Early detection: a phase that breaks an integration test learns it only at the end of the run, after later phases built on it.

Recommendation: keep — This spec makes the integration tier cheap first; whether it then leaves the every-phase gate is the operator's call on the after measures, and keeping it out of this change keeps the change to fixtures only.

Decision: keep — by operator (Rémy Loubradou), 2026-11-19
Why: Operator agrees with the recommendation. Advocate: Splitting the step cuts what each phase waits for at once; the loss of keep is the integration tier's time paid at every phase. Principles: S1, S9. Reversibility: cheap. Revised: none.

### q-143 — What does this change do about `phaseGuard`'s exit 143 under the full suite?

- observe — Observe: report in the last phase whether the test is still killed over three full runs after the change, and open a brief of its own if it is — abandons: A fix in this change if the kill does not come from load.
- fix-here — Investigate and fix the kill in this change — abandons: The change's bound: a fixture-only change grows into a look at the CLI's catalogue command and the gate's process handling.

Recommendation: observe — The kill matches the load failures that raised the timeouts before; the lighter suite is the cheapest test of that cause, and a kill that survives it has earned a brief of its own.

Decision: observe — by operator (Rémy Loubradou), 2026-11-19
Why: Operator agrees with the recommendation. Advocate: Fixing the kill here would resolve a known failure at once if it does not come from load; the loss of observe is deferring that fix. Principles: S1, S8. Reversibility: cheap. Revised: none.

## 10. Implementation-planning note

Settled:

- The tests check what they check today: no assertion removed, no test skipped or moved out of the gate; only how their repositories come to exist changes.
- Real git: every repository is written by git; no mocked git, no hand-written object files.
- Deterministic: a cached world is byte-identical to a fresh build at the same path, with fixed dates and identities for every commit, including those of builders that commit at the current time today.
- Isolated: each test gets its own copy and may change it.
- No runtime change: the CLI stays launched through `tsx`.
- `buildBranchTipWorld` is covered first: it costs the most (`recordsStatusBranch` 121 s, `recordsBranchSync.acceptance` 79 s) and its cost grows with records.
- Records added during a test (`writeRecords`, `pushRemoteRecords`, `writePhaseRecords`) keep going through phax's real plumbing; only the records a world is built with go through the bulk record write.

Left open:

- q-build-scope: where a world is built once.
- q-copy: how a test gets its copy.
- q-paths: how a copy's absolute paths stay correct.
- q-gate-tiers: whether `pnpm test` splits into tiers in the gate (recommended out of this change).
- q-143: what this change does about `phaseGuard`'s exit 143.
- Which builders after `buildBranchTipWorld`: measure first how much of each file's time is its builder and how much the run it drives (`createHeldWorld` and `createWorld` init one repository with one commit; `heldStopRun`'s and `stopRecords`' time is plausibly the run), and cover the rest in descending order of their build cost.

Constraints:

- Nothing under `src/` changes; the bulk record write, the cache and the copy live in the test fixtures.
- Existing calls to the builders keep compiling and behaving as today (`pnpm test:type`, `pnpm test`): the `BranchTipWorld` a test receives keeps its shape.
- A builder run outside the test's process sets nothing in the test's environment; the test's own process sets what the world needs.
- Every repository of a cached world and of a copy has git auto-maintenance disabled, as `disableGitAutoMaintenance` does today.
- The before and after measures come from the same machine and the same vitest version, measured as in the brief: wall time, sum of file times by tier, files over 30 s.

## 11. Docs page

None — The change is to phax's own test fixtures; no operator or user of phax sees it, so no docs page changes.

## 12. Decision log

- 2026-11-19 q-build-scope decided per-file — operator (Rémy Loubradou)
- 2026-11-19 q-copy decided dir-copy — operator (Rémy Loubradou)
- 2026-11-19 q-paths decided split — operator (Rémy Loubradou)
- 2026-11-19 q-gate-tiers decided keep — operator (Rémy Loubradou)
- 2026-11-19 q-143 decided observe — operator (Rémy Loubradou)
