---
status: Draft
date: 2026-11-22
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---
# Tests that drive a run

## 1. Context

`pnpm test` is a gate step of the `standard` profile, firing at every phase. On main at 3ff18b1c (2026-11-22, 14 cores, vitest 5.1) it is 189–192 s of a `standard` attempt, every other step together about 9 s, at 700–720 s of user CPU and about 515 s of system CPU. The suite takes 188.5 s of wall time for 2,158 s of file time, 11.4 files at once on average: it is bound by its total work, not by its slowest file (84 s). Integration is 2,002 s of the 2,158 (282 files), unit 156 s (474 files). 21 files over 30 s make 939 s, 39 files of 10–30 s make 648 s, 654 files under 5 s make 301 s.

`test-worlds-built-once` (PR #253) made the worlds of `buildBranchTipWorld` cheap, built once per file and copied per test: `recordsStatusBranch` went from 93 s to about 35 s. The suite did not move (199 s before, 199 to 218 s after). Its other slow files spend their time in the run each test drives, not in building a world: `createHeldWorld` and `createWorld` init one repository with one commit, about one second of `heldStopRun`'s time.

The slowest files that drive a run: `heldStopRun` 84 s (18 tests), `stopRecords` 80 s (9), `acceptancePairReview` 60 s (12), `heldStopClose` 57 s (19), `decideVerdicts` 56 s (68), `declaredStopClose` 43 s, `heldStopCommands` 41 s, `stopTranscripts` 39 s, `declaredStopRun` 39 s, `stopSecurityRecord` 36 s, `recordsExplainStop` 34 s. They call phax's use cases in process (`dispatch`, `closeStop`, `startHeldRun`, `stopRun`) with the real `NodeGitLayer` and `NodeShellLayer` and a fake backend: every phase worktree, branch, commit, setup and cleanup command and record write is a real git or shell process; the `pnpm` gate steps are already stand-ins in the scripted shell. `heldStopRun` starts 2,025 git processes (about 110 per test; `rev-parse` 381, `hash-object` 224, `config` 156, `add` 148, `reset` 147), `stopRecords` 2,492 (about 280 per test; `hash-object` 750, `rev-parse` 358, `show` 199).

Most of these tests begin the same way: `heldStopClose`'s `beforeEach` starts the invoice-export run and drives it to its phase-02 hold for each of its 19 tests; most of `heldStopRun`'s tests open with the same `heldAtPhase02()`. What follows the hold (the person's correction, the resume, the close) is what each test checks. A driven run holds its own absolute paths: the phase worktrees are registered in the main repository's `.git/worktrees`, and the run's status files name the worktree and run folders. A driven run also lives partly in memory: the fake backend's calls, the scripted shell's calls, the telemetry events and the closed stops are on the `HeldRun` object, and tests change its config and hooks before they resume.

Ground read:

- `docs/briefs/tests-that-drive-a-run.md` — The brief: the measures on main at 0c6135c1 (2026-11-20) and at 3ff18b1c (2026-11-22), what the spec must cover, and the three settled points.
- `spikes/test-worlds/measures.md` — The before and after measures of test-worlds-built-once: recordsStatusBranch 92.6 s to about 35 s, the suite's wall time and sum of file times unchanged, the run-driving files over 30 s unchanged.
- `docs/specs/archive/2611191142-test-worlds-built-once.md` — The spec this one follows: per-file caching, directory copy, no path back to the cached world, gate profile kept as is (q-build-scope, q-copy, q-paths, q-gate-tiers decided).
- `tests/helpers/heldRunFixture.ts` — createHeldWorld (one repository, one commit at the current time, git isolated) and startHeldRun/resumeHeldRun: the real createRunFolder and executePlan with NodeGitLayer, a scripted shell whose `pnpm` steps are stand-ins while every other command runs, and a fake backend whose calls, hooks and switches live in memory on the HeldRun.
- `tests/helpers/stoppedRunFixture.ts` — createWorld and stopRun: a linked worktree per run and the real stopAtDeclaredPhase; status files hold the worktree's absolute path.
- `tests/integration/heldStopRun.test.ts` — A new world in every beforeEach; most tests start with heldAtPhase02(), which starts the run and builds phase-01 and phase-02 before the test checks anything.
- `tests/integration/heldStopClose.test.ts` — Its beforeEach drives the run to the phase-02 hold for every one of its 19 tests; tests then change `run.config` and backend hooks in memory.
- `tests/integration/stopRecords.test.ts` — A new held world per test, sometimes more (`others`); tests switch records and transcripts on the in-memory config before resuming.
- `tests/integration/decideVerdicts.test.ts` — Drives `phax artifact decide` over a repository built per test through useDecideRepo; in the brief's list of slow files.
- `vitest.config.ts` — Two projects, unit and integration; no concurrent tests configured, so the tests of one file run one after another.

## 2. Problem

Every phase of every run waits about 3.5 minutes on `pnpm test`, and nearly all of it is the integration tier's work. That work is, for the slowest files, the same run driven again in every test: the same plan started, the same phases built, the same hold reached, with the same hundred-odd git processes, before the test does the one thing it checks. A faster world builder does not help, as #253 showed: the world is one commit, and the repeated part is the run.

Only less total work shortens the suite. The run-driving files over 30 s make about 570 s of its 2,158 s of file time; halving them alone removes about an eighth of the work, about 25 s of wall time. A suite that takes a fraction of its time also needs the 10–30 s files (648 s) whose time is the same kind of repetition, and nobody has yet measured, per file and per test, how much of each test's git and shell work is a prefix the test before it already drove. Without that measure, the change would either guess at its targets or, as #253 did, speed up the files it touched and leave the suite where it was.

## 3. Product goal

The work each run-driving test repeats is measured first, per file and per test; then, in the files where that repeated prefix is most of the work, a run is driven to a shared state once per file and restored for each test, so those files and with them the suite take a fraction of their time while every test checks exactly what it checks today, against the real git and the real shell, on the state the real run loop left. A change to the tests only: phax gains no feature and nothing under `src/` changes.

> A restored run must be the run the test would have driven itself, byte for byte on disk and call for call in memory; only the number of times it is driven changes.

## 4. Terminology

- **run-driving test** — An integration test that calls phax's use cases (`dispatch`, `executePlan`, `closeStop`, `startHeldRun`, `stopRun`, `phax artifact decide`) with the real git and shell layers over a world it set up, as opposed to one that only reads prepared files.
- **prefix** — What a run-driving test does before the step it checks: build its world, then drive a run to a state (started, built, held, stopped). In `heldStopClose`, its `beforeEach` up to the phase-02 hold.
- **driven state** — The state a prefix leaves: every file under the world's root (the repository with its refs, worktrees and configuration, the state root with the run folder, the world's HOME), plus the run's in-memory logs.
- **in-memory logs** — What a driven run holds outside the disk and a test may assert on: the fake backend's calls, the scripted shell's calls, the telemetry events and the closed stops.
- **prefix parameters** — Everything a caller passes that changes the driven state: the hold, records on or off, the plan, the provider configuration, the acceptance command, a `prepare` callback, an injected failure. Two prefixes with the same parameters drive the same state.
- **shared prefix** — A prefix driven once per test file for one set of prefix parameters, its driven state kept as a snapshot for the length of the file and never handed to a test directly.
- **restore** — Giving a test the driven state of a shared prefix, from its snapshot, in place of driving the prefix again; the test may change what it gets freely.
- **repeated-prefix share** — For one test file, the fraction of its git processes and shell commands spent in prefixes an earlier test of the same file already drove with the same prefix parameters.
- **covered file** — An integration file whose tests restore shared prefixes after this change.
- **fresh-drive switch** — A setting under which every test drives its own prefix, as today, so the suite can be run both ways.
- **file time** — The time vitest reports for one test file; the sum of file times is the suite's total work, distinct from its wall time, which runs files in parallel.

## 5. Functional requirements

### 5.1 Where the time goes, measured first

WHEN the plan's first phase runs THE phase SHALL record, on main before any other change, for every integration file over 10 s and for each of its tests: the git processes started (count, time, and count per subcommand, from GIT_TRACE), the commands run for real through the shell, the records written, and the worktrees added and removed.

### 5.2 What each test repeats

WHEN the plan's first phase records the measures THE phase SHALL record, for each measured file, its repeated-prefix share and the prefixes it repeats, each named with its prefix parameters and the number of tests that drive it.

### 5.3 Which files are covered

WHEN the before measures are recorded THE phase SHALL name as covered every integration file over 10 s whose repeated-prefix share is at least half of its git processes.

### 5.4 A prefix driven once per file

WHEN a test in a covered file asks for a prefix whose parameters match a shared prefix already driven in the same file THE fixture SHALL restore that shared prefix's driven state for the test instead of driving it again.

### 5.5 A restore is the driven state

The fixture shall restore a driven state byte-identical on disk to the state the prefix left: every ref with its commit id in every repository and worktree, every worktree registration, every repository's configuration, and every file under the world's root.

### 5.6 No path back to the snapshot

IF a restored state holds the snapshot's own location in any of its files THEN the fixture SHALL fail the test that restored it, naming the file that holds the location.

### 5.7 Restores are isolated

The fixture shall keep everything a test writes after its restore out of the snapshot and out of every later test's restored state.

### 5.8 The run's memory, restored

WHEN the fixture restores a driven state THE fixture SHALL give the test a run whose in-memory logs hold what the prefix produced, in objects of the test's own, and whose config, hooks, switches and injected failures start as a run freshly driven by that prefix would have them.

### 5.9 What a test checks stays its own

IF a test's prefix has parameters no shared prefix of its file was driven with (a `prepare` callback, an injected failure, a hook set before the start, a one-off plan or configuration) THEN the test SHALL drive its own prefix as it does today.

### 5.10 The fresh-drive switch

WHERE the fresh-drive switch is set THE fixture SHALL drive every test's prefix itself and restore nothing.

### 5.11 Real stays real, stand-ins stay stand-ins

The change shall leave every command a test runs through the shell after its prefix as it is today: a command run for real stays run for real, and a gate step that is a stand-in today (`true`, a script, the scripted `pnpm`) stays a stand-in.

### 5.12 The same tests, passing

The change shall keep every test that exists before it, under the same file and full name, with the same assertions, passing and not skipped, in the tier and gate step that runs it today.

### 5.13 The covered files take a fraction of their time

The change shall bring the sum of the covered files' file times, within a full `pnpm test` run on the machine of the measures, to at most half of its before value.

### 5.14 The suite measured before and after

WHEN the plan's last phase runs THE phase SHALL record, on the machine of the before measures, before and after the change: the suite's wall time, the sum of file times split by tier, the user and system CPU time, the average number of files at once, every integration file over 30 s with its time, every covered file with its time and git-process count, and the time of the gate's `pnpm test` step.

## 6. Surface

### internal: a shared prefix in a covered test file — indicative

Summary: A test author declares a run's prefix once per file and each test gets that driven run back, instead of waiting for it to be driven again.

before:

    let world: HeldWorld;
    let run: HeldRun;

    beforeEach(async () => {
      world = createHeldWorld();
      vi.stubEnv("HOME", world.home);
      run = await heldAtPhase02(world); // starts the run, builds phase-01 and phase-02, holds
    }, 30_000);

    afterEach(() => {
      vi.unstubAllEnvs();
      world.cleanup();
    });

after:

    const heldAt02 = sharedPrefix("held at phase-02", async (world) => {
      const { run } = await startHeldRun(world, HOLD_PHASE_02); // driven once in this file
      return run;
    });

    beforeEach(async () => {
      ({ world, run } = await heldAt02.restore()); // the driven state, the run's logs copied
      vi.stubEnv("HOME", world.home);
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      world.cleanup(); // removes this test's restored state only
    });

### internal: the fresh-drive switch — indicative

Summary: A maintainer runs the integration tier with every test driving its own run, as before, to check that shared runs change no result.

    $ PHAX_TEST_DRIVE_FRESH=1 pnpm test:integration
     Test Files  282 passed (282)
          Tests  … passed
    # every covered test drove its own prefix; nothing was restored

### internal: the restore guard — indicative

Summary: A test whose restored run still points at the snapshot fails at once, naming the file that holds the stale location.

    Error: restored state /tmp/phax-held-run-test-ab12cd still holds the snapshot location
      /tmp/phax-prefix-cache-x9y8z7/held-at-phase-02
      in state/runs/example.invoice-export/run-status.json

### file: spikes/tests-that-drive-a-run/measures.md — indicative

Summary: A reader sees, per slow integration file and per test, how many git processes and shell commands it runs and how much of that repeats an earlier test's prefix.

    # Measures: tests that drive a run (main at <sha>, 14 cores, vitest 5.1)

    | file            | time | git procs | git time | shell cmds | records | worktrees +/- | repeated share | covered |
    | --------------- | ---- | --------- | -------- | ---------- | ------- | ------------- | -------------- | ------- |
    | heldStopRun     | 84 s | 2,025     | …        | …          | …       | …             | …              | yes     |
    | stopRecords     | 80 s | 2,492     | …        | …          | …       | …             | …              | …       |

    ## heldStopRun, per test
    | test | git procs (rev-parse, hash-object, config, add, …) | prefix | repeats |
    | ---- | -------------------------------------------------- | ------ | ------- |
    | leaves a review commit by Ada Example on C2, … | 112 (…) | held at phase-02 (hold 02, records off) | yes |

### file: the last phase's commit message — indicative

Summary: A reader of the change's history sees the suite's time and work before and after, every covered file's time, and what the every-phase gate waits now.

    Measures (14 cores, vitest 5.1), before -> after:
      suite wall time            188.5 s -> <after> s
      sum of file times        2,158 s   -> <after> s
        integration            2,002 s   -> <after> s
        unit                     156 s   -> <after> s
      CPU user / system        710 / 515 s -> <after>
      files at once (average)     11.4   -> <after>
      gate step `pnpm test`      190 s   -> <after> s
    Covered files, before -> after (git processes):
      heldStopRun      84 s (2,025) -> <after>
      stopRecords      80 s (2,492) -> <after>
      ...
    Integration files over 30 s, before -> after:
      ...

## 7. Non-goals

- No change to phax itself: nothing under `src/` changes and phax gains no feature, flag or config key; batching `git hash-object` in the record write stays out (about 3 s of `stopRecords`).
- No mocked git and no stubbed shell beyond the stand-ins the tests already use: every repository is written by git, every command that runs for real today runs for real.
- No assertion removed, no test skipped, deleted, merged or moved out of the gate or into another tier.
- No shared prefix across test files and no snapshot kept across test runs.
- No concurrent tests inside a file.
- No change to the gate profile in `phax.json` (q-gate-tiers of `test-worlds-built-once` stays decided keep) and no change to the timeouts in `vitest.config.ts`.
- No change to tests that wait on purpose, such as `boundedSpawn`'s `ac-cli-hang` waiting out its 30 s bound.
- No change to the unit tier or to `pnpm test:e2e:real`.
- No fix of the `phax --json-schema` exit 143 under load; it has its own brief.

## 8. Acceptance criteria

### The before measures are per file and per test

Given main before the change, on the machine of the measures, when the plan's first phase runs its measurement, then `spikes/tests-that-drive-a-run/measures.md` lists every integration file over 10 s and each of its tests with its git-process count, git time and count per subcommand, its commands run for real through the shell, its records written and its worktrees added and removed, and `heldStopRun` and `stopRecords` appear with their per-test rows. (refs §5.1)

### The repeated prefixes are named

Given the before measures, when a reader looks up `heldStopClose`, then the file shows its repeated-prefix share and the prefix "held at phase-02" with its parameters (hold phase-02, records off) and the number of its tests that drive it. (refs §5.2)

### The covered files follow the rule

Given the before measures, when the covered list is compared with the measured files, then every file over 10 s whose repeated-prefix share is at least half of its git processes is marked covered, and no other file is. (refs §5.3)

### A second test drives nothing

Given a covered file whose first two tests share the prefix "held at phase-02", when the second test's restore runs under GIT_TRACE, then the trace shows no `worktree add` and no `commit` of the run's start, and the second test's phase-02 worktree HEAD is the same commit as the first test's at its restore. (refs §5.4)

### A restore equals the driven state

Given a shared prefix snapshotted right after it was driven, as every ref with its commit id in every repository and worktree, `git worktree list --porcelain`, every repository's configuration and every file's content under the world's root, when a test restores it and takes the same snapshot, then the two snapshots are equal. (refs §5.5)

### A stale location fails the test

Given a snapshot into which a test plants, under the state root, a file holding the snapshot's own location, when a later test restores it, then the later test fails with an error that names the planted file and the snapshot location. (refs §5.6)

### One test's writes stay in its restore

Given two tests restoring "held at phase-02", when the first corrects `src/invoiceRow.ts` in the phase-02 worktree and closes the stop by `resumeHeldRun`, then the second test finds the phase-02 worktree at C2 with the original header, `run-status.json` in `awaiting_review`, and the snapshot unchanged. (refs §5.7)

### The run's memory is the prefix's, per test

Given a shared prefix whose drive left N backend calls and M telemetry events, when the first test restoring it sets `onHandoff`, switches records on in `run.config` and resumes, and a second test restores it, then the second test's run holds exactly N backend calls and M telemetry events, equal to the prefix's, no `onHandoff` hook, and records off. (refs §5.8)

### A one-off prefix is driven by its test

Given a covered file with a test that starts its run with a `prepare` callback or an injected failure no other test of the file shares, when that test runs under GIT_TRACE, then its trace holds the `worktree add` and the commits of the run's start, as before the change. (refs §5.9)

### The suite passes both ways

Given the change, when `PHAX_TEST_DRIVE_FRESH=1 pnpm test:integration` runs, then `pnpm test:integration` without it, then both pass with the same tests, and under the switch no covered file restores a snapshot. (refs §5.10)

### The same commands run for real

Given the commands each test of the covered files runs through the shell after its prefix, recorded on main before the change and on the change, when the two lists are compared test by test, then they are equal, and no `pnpm` gate step that is a stand-in before runs for real after. (refs §5.11)

### Every test that passed still passes

Given vitest's JSON report of a full `pnpm test` run on main before the change and one after, when the two reports are compared by file and full test name, then every test of the first report is in the second, passed and not skipped, under the same project, and every test the second adds is one of the fixture's own. (refs §5.12)

### The covered files take half their time or less

Given three full `pnpm test` runs on main before the change and three on the change, on the machine of the measures, when the covered files' file times are summed per run and the medians compared, then the after median is at most half the before median. (refs §5.13)

### The measures are recorded

Given the plan's last phase, on the machine the before measures came from, when it runs the full `pnpm test` before and after the change, then its commit message holds the suite's wall time, the sum of file times by tier, user and system CPU, the average files at once, every integration file over 30 s, every covered file with its time and git-process count, and the gate's `pnpm test` step time, each before and after. (refs §5.14)

## 9. Open questions

### q-paths — A driven run holds absolute paths (worktree registrations in `.git/worktrees`, worktree and run folders in its status files). Where is a shared prefix restored?

- same-path — Restore at the path the prefix was driven at: the snapshot is taken from the world's root and copied back to that root before each test of the file — abandons: Concurrency inside a file: its tests must run one after another, and every test of the file sees the same root path.
- relocate — Copy to a fresh path per test, then `git worktree repair` and rewrite every path the run's files hold — abandons: Certainty: the rewrite must know every place a path hides in the run folder and in git, and one it misses points a test at another test's run.

Recommendation: same-path — The tests of a file already run one after another and each gets a fresh root today, so restoring at one path per file costs nothing a test relies on; nothing is rewritten, so a restore is the driven state by construction, and the restore guard still catches a path back to the snapshot.

### q-logs — How does a restored run get the in-memory part of its driven state (backend calls, shell calls, telemetry events, closed stops)?

- recorded — The fixture keeps the prefix's in-memory logs and gives each test its own copy of them — abandons: Simplicity: the copy must reproduce every log a test reads, and a log the fixture forgets to copy would differ from a fresh drive without a test failing.
- own-prefix — Any test that reads a log the prefix wrote keeps driving its own prefix — abandons: Much of the saving: many tests count the backend calls or telemetry events of the whole run, including the prefix's, and would stay as slow as today.

Recommendation: recorded — The logs are plain lists on the run object, few in number and listed in the fixture; the fresh-drive switch runs every test both ways, so a log the copy misses shows up as a test that passes one way and fails the other.

### q-scope — Which files does the change cover?

- named — The run-driving files over 30 s named in the brief — abandons: The suite: those files are about a quarter of its work, so halving them leaves the suite about 12% shorter, not a fraction.
- measured-rule — Every integration file over 10 s whose repeated-prefix share is at least half of its git processes, as measured first — abandons: A scope known before the plan starts: the list of covered files comes out of the first phase's measures.
- all-users — Every file that uses the held-run or stopped-run fixtures (24 files) — abandons: Focus: many of those files are under 10 s or repeat little, so the change pays its cost where nothing is saved.

Recommendation: measured-rule — The suite is bound by its total work, so the target must reach into the 10–30 s files (648 s) as well as the slowest ones; a rule over measures puts the work where repetition is, which is the lesson of #253 sped up a file and not the suite.

### q-target — What target binds the change?

- covered-half — The covered files' summed file time at most half of its before value; the suite's wall time recorded, not bound — abandons: A bound on the suite itself: if the covered files turn out to be a small share of the work, the change can meet its target and leave the gate's wait nearly where it is.
- suite-bound — The suite's wall time under a fixed bound (e.g. 120 s) within a full `pnpm test` — abandons: A target this change controls: the wall time also depends on files it does not touch, on the machine's load and on run-to-run noise of about 20 s.
- report-only — Record before and after, bind nothing — abandons: A check: nothing fails if the change leaves the files where they were, as #253 left the suite.

Recommendation: covered-half — It binds what the change does, measured as a median of three runs to absorb the noise #253 saw; the suite's wall time, CPU and the gate's step time are recorded beside it, so the operator sees whether the suite moved and can open the next brief on those numbers.

## 9b. Arbitrated questions

None.

## 10. Implementation-planning note

Settled:

- The tests check what they check today: no assertion removed, no test skipped or moved out of the gate.
- Real git and real shell: every repository and worktree is written by git through phax's own layers, and every command run for real today stays run for real.
- Nothing under `src/` changes; the shared prefixes, snapshots, restores and the fresh-drive switch live in the test fixtures and helpers.
- The decisions of `test-worlds-built-once` apply: per file, by directory copy, no path back to the cached copy.
- Measures come first: the first phase measures on main and names the covered files before any fixture changes.
- Gate steps that are stand-ins (`pnpm` in the scripted shell, `true`, a script) stay stand-ins.

Left open:

- q-paths: where a shared prefix is restored (same-path recommended).
- q-logs: how a restored run gets its in-memory logs (recorded copies recommended).
- q-scope: which files are covered (the measured rule recommended).
- q-target: what target binds the change (covered files halved recommended).
- Which prefixes each covered file shares, and in what order the files are covered: by the first phase's measures, largest repeated work first.
- How the per-test measures are taken (GIT_TRACE per test, a recording shell, vitest's JSON reporter), as long as they cover what §5 asks.

Constraints:

- The before and after measures come from the same machine and the same vitest version, as in the brief: wall time, sum of file times by tier, files over 30 s, plus CPU and files at once.
- A prefix is driven with git isolated from the person's configuration and with the test's HOME, as `createHeldWorld` and `isolateGit` do today; every repository has git auto-maintenance disabled.
- Existing fixture calls keep compiling (`pnpm test:type`): `HeldRun`, `HeldWorld`, `World` and `StoppedRun` keep their shape.
- Mocks a test file installs (`vi.mock` of `loadConfig`, `loadRouting`, the session layer) are in force when its shared prefix is driven, as they are for its tests today.
- The fresh-drive switch is run by a criterion, not added to the every-phase gate.

## 11. Docs page

None — The change is to phax's own test fixtures; no operator or user of phax sees it, so no docs page changes.
