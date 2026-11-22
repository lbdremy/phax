---
status: Draft
source-spec: docs/specs/2611221732-tests-that-drive-a-run.md
completes-spec: true
---
# Tests that drive a run

Measure, per integration file over 10 s and per test, how much of each run-driving test's git and shell work repeats a prefix an earlier test of the same file already drove. Then, in the files where that repeated prefix is at least half of the git processes, drive each shared prefix once per file and restore it for every test: same path, directory copy, the run's in-memory logs copied per test. Every test keeps its file, full name, assertions, tier and gate step. Real git and the real shell stay real, and stand-ins stay stand-ins. Nothing under `src/` changes; `vitest.config.ts`, `phax.json`, `package.json`, the tsconfigs, `knip.json`, both baselines, `.oxlintrc.json`, `.oxfmtrc.json` and the workflows stay as they are.

The operator's verdicts of 2026-11-22 (spec §9b) bind every phase. q-paths `same-path`: a shared prefix is restored at the root path it was driven at, and the tests of a file run one after another, as they do today. q-logs `recorded`: the fixture keeps the prefix's in-memory logs and gives each test its own copy. q-scope `measured-rule`: the covered files are every integration file over 10 s whose repeated-prefix share is at least half of its git processes, as phase-01 measures it. q-target `covered-half`: the covered files' summed file time, median of three runs, is at most half its before value. The suite's wall time, CPU and the gate's `pnpm test` step are recorded beside it. The decisions of `test-worlds-built-once` still apply: per file, directory copy, no path back to the cached copy.

Shape, core to surface:
- phase-01 measures on the unchanged tree. It commits its reports and the verdict: the covered files, and the batch phase each one goes to.
- phase-02 adds the shared-prefix core and its held-run form, with the fixture's own criterion tests.
- phase-03 covers `heldStopClose` and `heldStopRun`, which sets the pattern.
- phase-04 is an interactive review of that pattern.
- phase-05 and phase-06 cover the remaining held-run files.
- phase-07 adds the stopped-run form of the fixture and covers `declaredStopClose`.
- phase-08 covers the files that drive both kinds of run, and phase-09 the remaining stopped-run files.
- phase-10 covers every covered file outside both fixtures.
- phase-11 measures before and after back to back and checks the criteria test by test.

The covered list is known only after phase-01 (the loss q-scope accepted). So each batch phase names its candidate files under its optional files. It covers exactly the covered ones the verdict assigns to it, and logs the outcome in `spikes/tests-that-drive-a-run/measures.md`.

Start the run with `phax run --hold phase-01`, so the operator reads the verdict before any fixture changes (see the arbitration on a small share).

Candidate files per batch phase. phase-01's verdict maps each covered file to the first phase whose list holds it, and every other covered file to phase-10:
- phase-03: `heldStopClose`, `heldStopRun`.
- phase-05: `stopRecords`, `acceptancePairReview`, `stopSecurityRecord`, `recordsExplainStop`.
- phase-06: `heldStop`, `heldStopReentry`, `stopClosedBy`, `protectedPathsHandoff`, `noStopUnchanged`, `declaredCloseInFlight`.
- phase-07: `declaredStopClose`.
- phase-08: `heldStopCommands`, `stopTranscripts`, `stopTurnCosts`, `runList`.
- phase-09: `stoppedRunCommands`, `enterPhaseStop`, `closeStopNetwork`, `declaredStopProviderArgv`, `structuredAnswerFlags`, `structuredRetriesExhausted`.
- phase-10: any other covered file, for example `declaredStopRun`, `decideVerdicts`, `decideArtifact`, `executePlan`, `recordsExplain`, `findingPullRequestLocal`.

All of them are under `tests/integration/` with the `.test.ts` suffix.

## Required commands

- `node`
- `pnpm test`
- `pnpm test:integration`

Every command is already covered:
- `node` and `pnpm test:integration` are entries of `security.agentCommands` in `phax.json`.
- `pnpm test` is a gate command of the `standard` profile.

No security configuration change is needed. An environment prefix such as `GIT_TRACE=… pnpm exec vitest …` or `PHAX_TEST_DRIVE_FRESH=1 pnpm test:integration` is not a command a phase may run. The measuring script (`node spikes/tests-that-drive-a-run/measure.mjs …`) therefore sets every variable itself and spawns vitest's own binary from `node_modules/.bin`, as `spikes/test-worlds/measure.mjs` does. It spawns `pnpm test` only where it times the gate step's own command. Because `pnpm test:integration` is an entry with a space, it covers only itself: a phase never appends file arguments to it, and runs a subset of files through the measuring script's `files` mode instead.

## Technical arbitrations

- What a prefix is, and how phase-01 computes the repeated-prefix share (q-scope `measured-rule`). A test's prefix runs from the start of its first `beforeEach` up to the first git process or shell command it issues outside a call of a run-driving helper (`createHeldWorld`, `startHeldRun`, `createWorld`, `stopRun`). Its parameters are the sequence of those helper calls with their arguments: the hold, records on or off, the plan's title and a digest of its plan.md, a digest of the provider config, the acceptance command, and a one-off mark for a `prepare` callback or an injected failure (`stopRun`'s `sessionId: undefined`). A test's prefix is repeated when an earlier test of the same file drove the same parameter sequence. In a file that calls none of those helpers, the repeated part of a test is the longest head of its normalized git-command sequence (temporary roots and object ids replaced by placeholders) shared with an earlier test of the file. The file's share is the repeated git processes over all its git processes, hooks included. Loss accepted: in the helper-free files the head of identical commands can overstate what is restorable when a test writes files between identical git commands; the verdict marks those files `sequence` so a reader weighs them, and the rule is applied as written.
- How phase-01 measures per test. A spike vitest config reuses the integration project of `vitest.config.ts` unchanged and adds one setup module. That module points `GIT_TRACE2_EVENT` (git's own trace, one JSON event stream) at a separate file per test and per segment, prefix or own. It wraps the four run-driving helpers by `vi.mock` of the two fixture modules, and logs every non-git child process the worker spawns. Git processes, their time and their subcommands come from the trace's start and exit events. Commands run for real through the shell are the non-git children. Records written are the record-branch ref updates the trace shows. Worktrees added and removed are `git worktree add` and `git worktree remove`. File times come from three separate untraced full runs (median), because tracing slows the files it watches. Loss accepted: a git process spawned with an environment that drops `GIT_TRACE2_EVENT` is not counted; phase-01 checks the counts of `heldStopRun` and `stopRecords` against the brief's 2,025 and 2,492 and records any blind spot.
- Where the measures live: `spikes/tests-that-drive-a-run/`, beside `spikes/test-worlds/`. It holds `measure.mjs` (run with `node`), `trace-setup.mjs`, `vitest.trace.config.mjs`, `README.md`, the gzipped reports under `reports/`, and `measures.md`, whose generated tables the script renders from the reports and whose `## Verdict` lists the covered files with their batch phase. Loss accepted: the per-test tables make `measures.md` long (one row per test of about sixty files).
- Where the snapshot lives and when it is taken. Each shared prefix is declared once per test file, at module level, by a name and a drive function holding its parameters, and is driven lazily, at the first `restore()` of the file. The drive creates the world as today (a `mkdtemp` root, git isolated, HOME set to the world's home for the drive). At the drive's end, the fixture copies the root's whole tree (repository with refs, worktrees and config, state root with the run folder and records branch, the world's HOME with the provider stores) into a per-file cache directory `phax-prefix-cache-*`, and captures the run's memory. Every `restore()`, the first test's included, removes the root and copies the snapshot back to that same path (q-paths `same-path`). It then runs the guard, takes `isolateGit()` and hands back a world whose `cleanup` removes only that root. A module-level `afterAll` removes the cache and the root. Loss accepted: matching is by declaration, not by parameter equality, so a test that wants the same state but writes its own `startHeldRun` call keeps driving it; and the first restoring test pays the drive inside its `beforeEach` budget.
- Reuse of `test-worlds-built-once`: the restore copies with `copyWorld` and guards with `assertNoBuildPath` from `tests/fixtures/worlds/worldCache.ts`, with the snapshot directory as the path that must not appear in the restored root; the error names the restored root, the snapshot location and the file, relative to the root, that holds it. `worldCache.ts` is not changed. Loss accepted: a raw-byte scan of every file per restore, a few milliseconds on these small worlds.
- The run's memory (q-logs `recorded`). At the drive's end, the fixture captures a copy of every field of the `HeldRun` and its backend: calls, the sets of broken handoffs and rate-limited phases, the hooks and switches as the drive left them, builder sessions, transcripts, shell calls, failing gates, closed stops, config, provider config, failWrite, the fake lock's, telemetry's and GitHub fake's recorded state. Every `restore()` builds new objects from that capture, so nothing one test changes reaches another. The capture walks the run's own keys and the backend's, and throws on a key it does not know, so a log added later cannot be silently left out. `HeldRun`, `HeldWorld`, `World` and `StoppedRun` keep their shapes. Loss accepted: the in-memory telemetry's recorded state is private to `InMemoryTelemetry` and is read through a typed cast in the fixture, since nothing under `src/` changes.
- The fresh-drive switch. `PHAX_TEST_DRIVE_FRESH=1` is read at each `restore()`: under it, the restore creates a new world, drives the prefix itself and copies nothing, exactly as the test did before the change. A second test-only variable, `PHAX_TEST_PREFIX_LOG=<file>`, makes the fixture append one line per restore (file, prefix, `driven`, `restored` or `fresh`). The measuring script sets both and checks the log: under the switch, no covered file restores. Each batch phase runs its files both ways through the script's `files` mode, and phase-11 runs the whole integration tier both ways. The switch is not added to the every-phase gate (spec §10). Loss accepted: between the batch phases and phase-11, a log the copy misses shows up only when someone runs the files both ways, not at every gate.
- A small share. When phase-01's verdict names no covered file, that is the change's result: the verdict says so, with each file's share. The run, started with `phax run --hold phase-01`, stops after phase-01. The operator takes phase-01's commit (the measures and the verdict) to main, abandons the run and this plan, and reopens the spec on those numbers. When the verdict assigns no covered file to a batch phase, that phase converts nothing and appends a coverage-log line saying so, which is its commit. phase-07 then adds no stopped-run restore if no stopped-run file is covered. Loss accepted: the hold costs the operator one review stop even when the share is large.
- Batches by fixture family. The candidates are named in the preamble's lists, and each batch phase lists them as optional files. The verdict decides, file by file, which of them each phase covers. A covered file on no list goes to phase-10, whose reconciliation then flags it as unplanned and its handoff explains it. Loss accepted: planned-file reconciliation is coarse for the batch phases, since their real edits are known only from the verdict.
- Where the measures go in the change's history: phax writes each phase's commit body from the plan, before any measure exists. So phase-11 writes the before and after measures, in the shape of the spec's §6 commit-message block, into `spikes/tests-that-drive-a-run/measures.md` in its own commit, and the commit body names that file. This is the same verdict the operator gave `test-worlds-built-once`'s q-measures-message (measures-file, 2026-11-20). Loss accepted: the letter of §5.14 and ac-recorded; a reader of `git log` alone sees where the numbers are, not the numbers.
- Before and after, back to back (q-target `covered-half`). phase-11 takes three before runs of the run's base commit (the `commit` meta line of phase-01's reports), in a detached git worktree that the script adds in a temporary directory and removes when done, with `node_modules` linked from the phase worktree. It alternates them with three after runs on its own tree, on the machine phase-01 measured. The gate step's time is measured as the wall time of `pnpm test` itself, spawned by the script once per side. phase-01's own before runs stay recorded for §5.1–§5.3. Loss accepted: for the length of the measure, the script adds a worktree registration to the repository's `.git`, which a killed script leaves for `git worktree prune`.
- The fixture's own tests live under `tests/integration/`. `vitest.config.ts` is protected and its include globs are kept; they need real git and one machine. No acceptance phase: the surface is the tests and the measures, which a test and a report read in full, so every test line is in-phase. One interactive phase, phase-04, sits directly after phase-03: phase-03 sets the conversion pattern that phase-05, 06, 08, 09 and 10 repeat.

---

## phase-01 — Measure where the run-driving tests spend their time {#phase-01-measure}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium
**Assignment reason:** The phase designs a per-test measuring harness nothing in the repository shows yet: trace segments per test and per prefix, helper wrapping from a setup module, and the repeated-prefix share the verdict rests on.

Measure every integration file over 10 s on the unchanged tree. For each file and each test, record git processes (count, time, subcommands), commands run for real through the shell, records written, and worktrees added and removed. Then compute each file's repeated-prefix share and the prefixes it repeats, and commit the reports with the verdict that names the covered files and the batch phase each goes to.

### Detailed instructions

- Change nothing under `tests/`, `src/`, `vitest.config.ts`, `phax.json` or `package.json`: the before must be taken on the run's base tree. Everything this phase writes is under `spikes/tests-that-drive-a-run/`. `spikes/` is outside knip's project, but `pnpm lint` (oxlint, type-aware) and `pnpm format` / `format:check` (oxfmt) read it: write lint-clean, formatted code and never add a disable directive.
- Create `spikes/tests-that-drive-a-run/measure.mjs`: plain ESM for Node (the repository's Node), standard library only, run from the repository root as `node spikes/tests-that-drive-a-run/measure.mjs <mode> …`. Copy what fits from `spikes/test-worlds/measure.mjs` (its report format, `node_modules/.bin` put on `PATH` for the spawned vitest, repository-relative paths, the per-test name escaping and numbering of repeated full names). Write every report gzipped (`zlib.gzipSync`); every reader accepts `.tsv.gz`.
- Mode `run --out <report.tsv.gz> [--project integration] [--fresh]`: run the suite, or the integration project only, through vitest's own binary with `--reporter=json --outputFile=<tmp>`. Under `--fresh`, set `PHAX_TEST_DRIVE_FRESH=1`. Always set `PHAX_TEST_PREFIX_LOG=<tmp file>`; both variables are inert until phase-02's fixture reads them. Wrap the spawn in `/usr/bin/time -p` and parse its real, user and sys seconds from stderr (record `n/a` and say so if it is missing). Write the meta lines `wall-seconds`, `user-cpu-seconds`, `system-cpu-seconds`, `cores`, `vitest`, `node` and `commit` (`git rev-parse HEAD`), plus `prefix-log` (counts of `driven`, `restored` and `fresh` lines per file, empty when none), then the `F` file lines and `T` test lines as in test-worlds. A failing test does not stop the report; an unreadable JSON exits 2.
- Mode `files [--fresh] [--trace <out.tsv.gz>] <test file>...`: run only those files (integration project, JSON reporter), print each file's time and each test's state, and with `--trace` also take the trace below over just those files. Later phases use it on the files they convert.
- Mode `gate-step --out <file>`: spawn `pnpm test` exactly as the gate step runs it (no extra argument, stdout discarded), time its wall clock and record it with the exit code.
- Create `spikes/tests-that-drive-a-run/vitest.trace.config.mjs`: a vitest config, rooted at the repository root, that reuses the integration project of `vitest.config.ts` as it is (same include globs, pool, isolation and timeouts) and adds `spikes/tests-that-drive-a-run/trace-setup.mjs` to its setup files. Check vitest's config API for extending a project in the installed version (read `node_modules/vitest` or use `ctx7`) rather than guessing. Mode `trace --out <trace.tsv.gz> --from <plain report> [file...]` runs that config over the given files, by default every integration file over 10 s in the plain report. It sets `PHAX_MEASURE_TRACE_DIR=<tmp dir>` and folds the segment files below into the trace report.
- Create `spikes/tests-that-drive-a-run/trace-setup.mjs`, inert unless `PHAX_MEASURE_TRACE_DIR` is set. It has four jobs:
  (1) In a `beforeEach`, which runs before the file's own hooks, open the test's segment list, keyed by the test file and full name (`ctx.task`), and point `process.env.GIT_TRACE2_EVENT` at the test's current segment file. Hook work outside any test goes to a per-file `hooks` segment.
  (2) `vi.mock` `tests/helpers/heldRunFixture.ts` and `tests/helpers/stoppedRunFixture.ts` with `importOriginal`, re-exporting everything and wrapping `createHeldWorld`, `startHeldRun`, `createWorld` and `stopRun` in plain functions, not `vi.fn`, so `vi.clearAllMocks` cannot touch them. A wrapped call opens a `prefix` segment, records its parameters (helper name; hold; records; plan title and sha256 of planMd; sha256 of the provider config JSON; acceptance command; `one-off` when a `prepare` callback is passed or `stopRun` gets `sessionId: undefined`), and when it returns, the next commands go to an `own` segment.
  (3) Patch `node:child_process` (`spawn`, `spawnSync`, `execFile`, `execFileSync`, `exec`, `execSync`) through `createRequire` and `module.syncBuiltinESMExports()`, logging every child that is not git (argv, cwd) into the current segment.
  (4) Never change what a test does. Check that `vi.mock` from a setup file reaches the test files in the installed vitest. If it does not, find helper boundaries another way that leaves the tests untouched, and say how in the README.
- Fold the segments into the trace report. Per test: git processes (distinct trace2 `sid`s with a `start` event), git time (sum of their `exit` `t_abs`), counts per subcommand (the first non-option argv word), shell commands (non-git children), records written (record-branch ref updates: read `src/infra/git.ts` for how a record commit lands and match that), `worktree add` and `worktree remove` counts. Add the prefix: its parameter sequence, its git processes, whether it repeats an earlier test's sequence in the file, and the segment kind of every command. For files where no wrapped helper is called, compute the repeated part as the longest head of the test's normalized git argv sequence shared with any earlier test of the file: replace temporary roots (`/…/phax-*-XXXXXX`, `os.tmpdir()` realpath) with `<tmp>` and 40- or 64-hex ids with `<oid>`. Mark such files `sequence`. Also write one `S` line per real shell command (file, full name, segment kind, normalized argv as JSON) so phase-11 can compare commands test by test.
- Repeated-prefix share of a file = git processes in repeated prefixes (or repeated heads, for `sequence` files) divided by all its git processes, hooks included. Covered = median file time over 10 s and share at least 0.5. Mode `verdict --from <plain reports...> --trace <trace report>` prints the covered list, ordered by repeated git processes (largest first), each with the batch phase it goes to by the plan's candidate lists: phase-03 heldStopClose, heldStopRun; phase-05 stopRecords, acceptancePairReview, stopSecurityRecord, recordsExplainStop; phase-06 heldStop, heldStopReentry, stopClosedBy, protectedPathsHandoff, noStopUnchanged, declaredCloseInFlight; phase-07 declaredStopClose; phase-08 heldStopCommands, stopTranscripts, stopTurnCosts, runList; phase-09 stoppedRunCommands, enterPhaseStop, closeStopNetwork, declaredStopProviderArgv, structuredAnswerFlags, structuredRetriesExhausted; phase-10 every other covered file. Mode `table` renders `measures.md`'s generated sections, between `<!-- BEGIN generated: … -->` / `<!-- END generated: … -->` markers, from the reports.
- Mode `compare <before...> -- <after...> [--allow-new <test file>]...` takes one or more reports per side and prints the §6 commit-message block: suite wall time, sum of file times by tier, user and system CPU, average files at once (sum of file times over wall time), integration files over 30 s, and every covered file with its time. Use medians when a side has several reports. Then run the test-by-test check of `spikes/test-worlds/measure.mjs` against every pair: missing, not passing, newly skipped, changed project, or a new test outside `--allow-new`. Exit 1 on any problem.
- Take the measures with nothing else heavy running, each as its own command so none exceeds the tool's time limit:
  - three `run --out spikes/tests-that-drive-a-run/reports/before-<n>.tsv.gz` (n = 1, 2, 3);
  - one `trace --out spikes/tests-that-drive-a-run/reports/trace-before.tsv.gz --from <the three before reports>`;
  - one `gate-step` (record its seconds in measures.md).
  Check that `heldStopRun` and `stopRecords` show about 2,025 and 2,492 git processes. If they differ by more than a tenth, find why (a blind spot in the trace, or main having moved) and write it down.
- Write `spikes/tests-that-drive-a-run/measures.md`:
  - a header with the machine (cores, vitest, Node), the base commit and the date;
  - the suite summary of the three runs (wall time, sum of file times by tier, CPU, files at once, the `pnpm test` step's time);
  - the generated per-file table (time, git procs, git time, shell cmds, records, worktrees +/-, repeated share, covered, `sequence` mark);
  - one generated per-test table per measured file (git procs with per-subcommand counts, shell cmds, records, worktrees +/-, prefix with its parameters, repeats yes/no);
  - a `## Prefixes` section naming each repeated prefix with its parameters and the number of tests that drive it (for example `heldStopClose`: "held at phase-02", hold phase-02, records off, 19 tests). For `sequence` files, name the prefix from reading the file;
  - `## Verdict`: the covered list with each file's batch phase. When it is empty, say so in one sentence and tell the operator to end the run here;
  - an empty `## Coverage log`, which later phases append to;
  - an empty `## After`, which phase-11 fills.
- Write `spikes/tests-that-drive-a-run/README.md`: what the script is for (the spec `tests-that-drive-a-run`, §5.1–§5.3 and §5.13–§5.14), every mode with an example command, the two report formats, the variables it sets (`GIT_TRACE2_EVENT`, `PHAX_MEASURE_TRACE_DIR`, `PHAX_TEST_DRIVE_FRESH`, `PHAX_TEST_PREFIX_LOG`), the prefix and share definitions above, and any blind spot found.

### Planned files to create

- `spikes/tests-that-drive-a-run/README.md`
- `spikes/tests-that-drive-a-run/measure.mjs`
- `spikes/tests-that-drive-a-run/trace-setup.mjs`
- `spikes/tests-that-drive-a-run/vitest.trace.config.mjs`
- `spikes/tests-that-drive-a-run/measures.md`
- `spikes/tests-that-drive-a-run/reports/before-1.tsv.gz`
- `spikes/tests-that-drive-a-run/reports/before-2.tsv.gz`
- `spikes/tests-that-drive-a-run/reports/before-3.tsv.gz`
- `spikes/tests-that-drive-a-run/reports/trace-before.tsv.gz`

### Planned files to edit

- (none)

### Optional files that may be edited

- (none)

### Boundary contracts

Producer of the verdict that every later phase consumes: `spikes/tests-that-drive-a-run/measures.md` `## Verdict` lists each covered file by repository-relative path, with its batch phase. `## Prefixes` gives, for each repeated prefix, the name a later phase declares it under, its parameters and its test count. The trace report's `S` lines (file, full name, segment kind, normalized argv) are the contract phase-11's command comparison reads. Keep their shape stable, and document it in the README.

### Test strategy

- measures.md lists every integration file over 10 s of the before runs, each with per-test rows of git processes, git time, per-subcommand counts, shell commands, records written and worktrees added and removed — medium · example · the files over 10 s in the three plain reports matched one for one by the trace report's rows, as measure.mjs table renders them · in-phase · ac-measures
- heldStopRun's and stopRecords' git-process counts agree with the brief's GIT_TRACE counts or the difference is explained in measures.md — medium · example · the brief's counts, 2,025 for heldStopRun and 2,492 for stopRecords · in-phase · ac-measures
- heldStopClose shows its repeated-prefix share and the prefix held at phase-02 with hold phase-02, records off and the number of its tests that drive it — medium · example · the file's beforeEach read by hand, one prefix driven by each of its 19 tests · in-phase · ac-repeat
- the covered list holds every file over 10 s whose repeated-prefix share is at least one half, and no other file — small · table · the rule re-applied by measure.mjs verdict to every row of the committed reports · in-phase · ac-covered

### Implementation order

1. measure.mjs `run`, `files` and `gate-step` modes, checked on one small integration file
2. vitest.trace.config.mjs and trace-setup.mjs, checked on heldStopClose alone with `files --trace`
3. the `trace` fold, the share, `verdict`, `table` and `compare`
4. the three plain runs, the trace run and the gate-step run
5. measures.md and README.md

### Excluded scope

- Any change under `tests/`, `src/`, or to `vitest.config.ts`, `phax.json` or `package.json`.
- The shared-prefix fixture (phase-02) and any covered file's conversion.
- The after measures (phase-11).

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The base commit the reports were taken on, and the machine (cores, vitest, Node).
- The three runs' summary (wall time, sum of file times by tier, CPU, files at once) and the `pnpm test` step's time.
- The covered list in order, with each file's share, repeated git processes and batch phase. Say plainly if it is empty, and tell the operator to end the run at this hold.
- For each covered file, its repeated prefixes with parameters and test counts, and its one-off tests.
- The exact modes and flags of `measure.mjs` that later phases call (`files`, `files --fresh`, `files --trace`, `trace`, `compare`), and the trace report's `S` line shape.
- Any blind spot of the trace, and how the `vi.mock` wrapping was confirmed to reach the test files.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`test(spikes): measure the run-driving tests per file and per test`

### Commit body

Add spikes/tests-that-drive-a-run/: a measuring script that runs the suite through vitest's own binary and records file times, CPU and files at once, and a traced run over every integration file over 10 s that counts, per test, git processes (git's trace2 events), real shell commands, records written and worktrees added and removed, split into each test's prefix and its own steps.

The reports of three untraced runs and one traced run on the unchanged tree are committed under reports/, with measures.md: per-file and per-test tables, the repeated prefixes with their parameters, and the verdict naming every file over 10 s whose repeated-prefix share is at least half of its git processes, with the phase that covers it (spec §5.1 to §5.3, q-scope measured-rule).

---

## phase-02 — Shared prefixes for held runs {#phase-02-held-prefix}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium
**Assignment reason:** The phase designs the shared-prefix fixture: snapshot and same-path restore of a git world with worktrees, and a complete per-test copy of a run's in-memory state, which no code in the repository holds yet.

Give a test file a way to drive a held run's prefix once and restore it per test. The restore copies the driven state back to the same root path, byte for byte, and gives the test its own copy of the run's in-memory logs. A guard fails any restore that still points at the snapshot, and the fresh-drive switch makes every test drive its own prefix again. The fixture's own tests prove each of these spec guarantees.

### Detailed instructions

- Read `spikes/tests-that-drive-a-run/measures.md` (`## Verdict`, `## Prefixes`) and the phase-01 handoff first. If the verdict is empty, the run should have ended at phase-01. Stop and say so in the handoff instead of building the fixture.
- Create `tests/helpers/prefixSnapshot.ts`, the kind-independent core. It exports `definePrefix`, which takes:
  - a human name, slugified to one safe path segment (letters, digits, `.`, `_`, `-`); a second prefix of the same file with the same slug throws at definition;
  - `createWorld()`, a fresh world with a `root` and a `cleanup`, git isolated as the kind's world builder does;
  - `homeOf(world)`, the HOME to set for the drive, or undefined;
  - `drive(world)`, which returns the driven state;
  - `capture(state)`, which returns a memory copy;
  - `give(memory, world)`, which returns a new state bound to the given world;
  - `worldAt(root, cleanup)`, which rebuilds the world object for a restored root.
  The returned prefix has `restore(): Promise<{ world, state }>`. The core also exports `snapshotPathOf(prefix)` for the fixture's own tests. It is undefined before the drive.
- `restore()` without the switch:
  (1) At the first call of the file, create the world, set `process.env.HOME` to `homeOf(world)` for the drive only (put the previous value back after it, whether the drive succeeds or fails), and await `drive`. Then take `capture(state)`, copy the root's whole tree into `<cache root>/<slug>` with `copyWorld` from `tests/fixtures/worlds/worldCache.ts`, and release the drive world's git isolation without removing anything. The cache root is a `mkdtemp` `phax-prefix-cache-*` directory in the realpath of `os.tmpdir()`. Concurrent first calls share one pending drive. A failed drive removes the root and the snapshot, is forgotten, and rejects with the drive's error.
  (2) Every call, the first included: remove the root if present and `copyWorld(snapshot, root)` back to the same path (q-paths `same-path`). Run `assertNoBuildPath(root, snapshot)`. If it throws, remove the root and throw an error reading `restored state <root> still holds the snapshot location <snapshot> in <file relative to the root>`. Then take `isolateGit()` and return `worldAt(root, cleanup)` and `give(memory, world)`. That `cleanup` removes the root and releases this isolation, and nothing else.
  (3) A module-level `afterAll` removes the cache root and any root left behind, as `worldCache.ts` does.
- `restore()` under `process.env.PHAX_TEST_DRIVE_FRESH === "1"`, read at each call: create a new world, drive the prefix on it with HOME set as above, and return that world and state unchanged. Do not snapshot, copy or capture anything. When `process.env.PHAX_TEST_PREFIX_LOG` names a file, append one tab-separated line per restore: the test file relative to the repository root (`expect.getState().testPath`), the prefix name, and `driven` (the call that drove the shared state), `restored` or `fresh`.
- In `tests/helpers/heldRunFixture.ts`, export `sharedPrefix(name, drive: (world: HeldWorld) => Promise<HeldRun>)`. It returns `{ restore(): Promise<{ world: HeldWorld; run: HeldRun }> }` built on `definePrefix`, with `createHeldWorld` as `createWorld` and the world's `home` as HOME. `worldAt` rebuilds `{ root, repoRoot, stateRoot, home, cleanup }` from the root as `createHeldWorld` lays it out. Keep `HeldRun`, `HeldWorld`, `HeldBackend` and every existing export as they are.
- The held run's `capture`, taken at the drive's end, is a deep copy of what the drive left:
  - `plan`, `planMd`, `runPath`, `runId`;
  - the backend's `calls` (each call copied, `options` copied), `brokenHandoffs`, `rateLimited`, `onHandoff`, `onBuild`, `onReadOnly`, `firstTurnSession`, `firstTurnFails`, `builderSessions`, `transcripts`;
  - `shellCalls`, `failingGates`, `closed`, `config` (`structuredClone`, or a deep copy of the nested objects if it holds functions), `providerConfig`, `failWrite`;
  - the recorded state of the fake lock (`src/infra/fakes/lock.ts`), the GitHub fake (`src/infra/fakes/github.ts`) and the telemetry's `InMemoryTelemetry` (events, errors, counters, durations: read through a typed cast of its private fields, or replayed through its public methods where that gives the same content).
  Read each fake's source to find what it records. `give` builds new objects (`makeHeldBackend()`, `makeFakeLock()`, `makeFakeGitHub()`, `makeFakeSystemTelemetry()`) and fills them from a fresh copy of the capture, binding the restored world. The capture walks `Object.keys` of the run and of its backend, and throws `unknown HeldRun field <key>` (or `HeldBackend`) on any key it does not handle.
- Create `tests/integration/sharedPrefix.test.ts`, the fixture's own tests. Install the mocks `heldStopClose.test.ts` installs that the tests need (`loadRouting` returning the defaults, and the telemetry journal off where `closeStop` or `dispatch` is used), so nothing reads `~/.phax`. Declare `sharedPrefix("held at phase-02", …)` driving `startHeldRun(world, { selection: "listed", phases: ["phase-02"] })`. The tests run one after another in declaration order; module-level variables carry what one test hands the next. Stub HOME to `world.home` after each restore, and `cleanup` in `afterEach`. Use `gitIn` / `boundedOutput` for every git call (the architecture guard refuses an unbounded spawn).
- ac-driven-once: two consecutive tests restore the prefix. The first records the phase-02 worktree's `HEAD`. The second points `process.env.GIT_TRACE` at a temporary file for its `restore()` only, then asserts the trace holds no `worktree add` and no `commit` (an absent or empty file passes), and that the phase-02 worktree's `HEAD` equals the first test's.
- ac-byte: declare a second prefix whose drive, after `startHeldRun`, takes a fingerprint of the world and keeps it in a module variable. The fingerprint is: `for-each-ref` with object ids in the repository; `rev-parse HEAD` in every worktree; `worktree list --porcelain`; `config --list --local` of the repository; and the sha256 of every regular file under the root, by relative path, hashed before any git command runs. Use only git commands that write nothing (no `status`, which can refresh an index). A later test restores and takes the same fingerprint, and asserts the two are equal.
- ac-isolated: one test restores "held at phase-02", writes `export const header = 'Invoice number';` to `src/invoiceRow.ts` in the phase-02 worktree and closes the stop with `resumeHeldRun`. The next test restores and asserts three things: the phase-02 worktree is at the same C2 commit with the original `invoice_no` header; `run-status.json` reads `awaiting_review`; and a raw-byte fingerprint of the snapshot directory (`snapshotPathOf`) is the same before and after the first test.
- ac-logs: one test restores and notes N (`backendCalls(run).length`) and M (`run.telemetry.impl.events().length`). It checks they equal what the drive left (keep the drive's counts in a module variable), then sets `run.backend.onHandoff`, switches `records.enabled` on in `run.config` and resumes. The next test restores and asserts exactly N backend calls, M telemetry events, `onHandoff` undefined and records off.
- ac-no-path-back: a third prefix. One test restores it and writes `state/planted.json` holding the snapshot's location into `snapshotPathOf(prefix)`. The next test asserts that `restore()` rejects with an error naming `state/planted.json` and the snapshot location, and that the restored root was removed.
- ac-own-prefix: a test builds its own `createHeldWorld()` and calls `startHeldRun` with a `prepare` callback, with `GIT_TRACE` pointed at a temporary file. Assert the trace holds `worktree add` and the commits of the run's start.
- Fresh switch: a test sets `vi.stubEnv("PHAX_TEST_DRIVE_FRESH", "1")`, restores "held at phase-02" with `GIT_TRACE` on, and asserts four things: the trace holds `worktree add`; the world's root differs from the shared root; the run is awaiting review at phase-02; and the snapshot's fingerprint is unchanged. Unstub afterwards.
- Capture guard: a test passes a held run with one extra own key through the capture, through the smallest exported path the fixture offers (for instance a drive that returns the run with the extra key), and asserts the restore rejects naming that key.

### Planned files to create

- `tests/helpers/prefixSnapshot.ts`
- `tests/integration/sharedPrefix.test.ts`

### Planned files to edit

- `tests/helpers/heldRunFixture.ts`

### Optional files that may be edited

- `tests/fixtures/worlds/worldCache.ts`

### Boundary contracts

Producer for every later batch phase.
- `tests/helpers/heldRunFixture.ts` exports `sharedPrefix(name, drive)`. Its `restore()` resolves to `{ world: HeldWorld; run: HeldRun }`: the world's `cleanup` removes only that test's restored root, and the run's in-memory logs are the test's own.
- `tests/helpers/prefixSnapshot.ts` exports `definePrefix` (the kind-independent core that phase-07 and phase-10 reuse) and `snapshotPathOf`.
- Test-only variables: `PHAX_TEST_DRIVE_FRESH=1` (the fresh-drive switch) and `PHAX_TEST_PREFIX_LOG=<file>` (one line per restore). phase-01's measuring script sets them.
- `copyWorld` and `assertNoBuildPath` are consumed from `tests/fixtures/worlds/worldCache.ts` unchanged.

### Test strategy

- a second test restoring the same shared prefix runs no worktree add and no commit, and finds the same phase-02 worktree HEAD as the first — medium · example · a GIT_TRACE file around the restore, and the first test's recorded HEAD · in-phase · ac-driven-once
- a restored state equals the state the prefix left, refs, worktree registrations, configuration and every file under the root — medium · example · a fingerprint taken at the end of the drive and again after a later restore · in-phase · ac-byte
- a restore whose copy holds the snapshot's location fails, naming the planted file and the location — medium · example · the thrown error's text and the removed root · in-phase · ac-no-path-back
- one test's correction and resume never reach the next test's restored state or the snapshot — medium · example · commit C2 with the original header, run-status awaiting_review, the snapshot's byte fingerprint unchanged · in-phase · ac-isolated
- a restored run holds exactly the prefix's backend calls and telemetry events, no hook and records off, whatever the previous test changed — medium · example · the counts the drive left, N backend calls and M telemetry events · in-phase · ac-logs
- a test that starts its run with a prepare callback drives its own prefix — medium · example · a GIT_TRACE file holding worktree add and the commits of the run's start · in-phase · ac-own-prefix
- under the fresh-drive switch a restore drives a new world and leaves the snapshot alone — medium · example · a trace holding worktree add, a root other than the shared one, the snapshot fingerprint unchanged · in-phase · ac-fresh
- a held run carrying a field the capture does not know is refused rather than copied partly — small · example · the error naming the unknown key · in-phase

### Implementation order

1. prefixSnapshot.ts: the drive, the snapshot, the same-path restore, the guard, the switch, the prefix log, afterAll cleanup
2. heldRunFixture.ts: the held run's capture and give, and sharedPrefix
3. sharedPrefix.test.ts: driven once, byte equality, isolation, logs, guard, own prefix, fresh switch, capture guard

### Excluded scope

- Converting any existing integration file (phase-03 onwards).
- The stopped-run form of the fixture (phase-07).
- Any change under `src/`, to `vitest.config.ts`, or to the behaviour of `copyWorld` / `assertNoBuildPath` as `test-worlds-built-once` uses them.

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The exact exports and signatures: `sharedPrefix` in `tests/helpers/heldRunFixture.ts`, and `definePrefix` and `snapshotPathOf` in `tests/helpers/prefixSnapshot.ts`, with a three-line usage example (declare, restore in `beforeEach`, cleanup in `afterEach`).
- Every HeldRun and HeldBackend field the capture copies, and how each fake's recorded state is copied (lock, GitHub, telemetry).
- How HOME and git isolation are set during the drive and after a restore.
- The prefix-log line format.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`test(fixtures): drive a held run's prefix once per file and restore it per test`

### Commit body

Add tests/helpers/prefixSnapshot.ts and sharedPrefix in heldRunFixture: a test file declares a held run's prefix once, the first restore drives it and snapshots the world's whole tree, and every restore copies the snapshot back to the same root path (q-paths same-path) and gives the test its own copy of the run's in-memory logs (q-logs recorded). A guard fails a restore whose files still hold the snapshot's location; PHAX_TEST_DRIVE_FRESH=1 makes every restore drive its own world.

tests/integration/sharedPrefix.test.ts proves the spec's §5.4 to §5.10: a second test drives nothing, a restore equals the driven state, a stale location fails, one test's writes stay in its restore, the run's memory is the prefix's per test, a one-off prefix is driven by its test, and the switch drives anew.

---

## phase-03 — Cover heldStopClose and heldStopRun {#phase-03-held-stop-close-run}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

Make `heldStopClose` and `heldStopRun` restore their shared held-at-phase-02 prefixes instead of driving them in every test. Every test keeps its name and assertions and passes both ways, and the conversion becomes the pattern later batches follow.

### Detailed instructions

- Read `## Verdict` and `## Prefixes` in `spikes/tests-that-drive-a-run/measures.md`. Cover only those of `tests/integration/heldStopClose.test.ts` and `tests/integration/heldStopRun.test.ts` the verdict assigns to phase-03. For a file it does not assign, append a coverage-log line saying it is not covered and why (its share). That is not a deviation to fix.
- The fixture (from phase-02, `tests/helpers/heldRunFixture.ts`): `const p = sharedPrefix("<name>", async (world) => (await startHeldRun(world, HOLD, opts)).run)` at module level, and in a hook or a test `const { world, run } = await p.restore()`. Then `vi.stubEnv("HOME", world.home)` and, in `afterEach`, `world.cleanup()`. Under `PHAX_TEST_DRIVE_FRESH=1` the same call drives a new world.
- `heldStopClose`: its `beforeEach` drives the run to the phase-02 hold for every test. Declare `sharedPrefix("held at phase-02", …)` with exactly the parameters `heldAtPhase02` uses (`HOLD_PHASE_02`, default options), keeping its `expect(...).toBe("awaiting_review")` check where it is today. Replace the `beforeEach`'s `createHeldWorld()` and `heldAtPhase02(world)` with `restore()`, keeping its timeout and the HOME stub. Calls of `heldAtPhase02` on a second world inside a test (`otherWorld`) stay as they are: they drive their own.
- `heldStopRun`: its tests that begin with `heldAtPhase02` drive two prefixes, records on and records off. Declare one shared prefix per parameter set, named as `## Prefixes` names them (for example "held at phase-02, records on"), and replace each such opening with the matching `restore()`. Restructure the file's `beforeEach` / `afterEach` so a restoring test uses the restored world and cleans exactly that world. A test that builds its own world for a one-off prefix keeps doing so.
- A test whose prefix has parameters no shared prefix of its file uses (a `prepare` callback, an injected failure, a hook or switch set before the start, a one-off plan, provider config or acceptance command) keeps driving its own prefix, unchanged (spec §5.9).
- Keep every `describe` and `it` title, every assertion, every timeout and every `vi.mock` exactly as they are: only how a test obtains its world and run changes. Do not merge, split, reorder, skip or move a test. Mocks the file installs stay in force when its shared prefix is driven, because the drive runs inside the file.
- Run the two files both ways: `node spikes/tests-that-drive-a-run/measure.mjs files tests/integration/heldStopClose.test.ts tests/integration/heldStopRun.test.ts`, then the same with `--fresh`. Then once with `--trace <tmp>` to confirm that restored tests show no `worktree add` in their prefix and one-off tests still do. Both ways must pass the same tests.
- Append to `## Coverage log` in measures.md, per covered file: the prefixes declared (name, parameters, tests restoring each), the tests left driving their own and why, and the file's time shared and fresh from the `files` runs.

### Planned files to create

- (none)

### Planned files to edit

- `tests/integration/heldStopClose.test.ts`
- `tests/integration/heldStopRun.test.ts`
- `spikes/tests-that-drive-a-run/measures.md`

### Optional files that may be edited

- `tests/helpers/heldRunFixture.ts`
- `tests/helpers/prefixSnapshot.ts`

### Test strategy

- every test of heldStopClose and heldStopRun is still there under the same full name and passes with shared prefixes — medium · example · phase-01's before rows for the two files, matched by file and full name · in-phase · ac-same-tests
- the two files pass the same tests with and without the fresh-drive switch — medium · example · measure.mjs files runs with and without --fresh, compared test by test · in-phase · ac-fresh
- tests with one-off parameters still drive their own prefix while restored tests drive none — medium · example · a measure.mjs files --trace run of the two files, worktree add per test · in-phase · ac-own-prefix

### Implementation order

1. heldStopClose (one prefix, in beforeEach)
2. heldStopRun (two prefixes, inside tests)
3. both-ways runs, the trace check and the coverage log

### Excluded scope

- Any other integration file.
- Changes to the fixture beyond a fix a conversion reveals; such a fix is named in the handoff.

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The prefixes declared per file, with names, parameters and the tests restoring each, and the tests left driving their own, with the reason.
- The files' times shared and fresh.
- Any fixture fix the conversion needed.
- The conversion pattern in a few lines (where the prefix is declared, how hooks and cleanup are arranged, how second worlds are left alone), for the phase-04 review and the later batches.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`test(stops): restore the phase-02 hold in heldStopClose and heldStopRun`

### Commit body

heldStopClose and heldStopRun now restore their shared held-at-phase-02 prefixes (records off, and records on for heldStopRun) instead of starting the invoice-export run and building phase-01 and phase-02 again in every test. Tests with a one-off prefix (a prepare callback, an injected failure, a second world) still drive their own. Every test keeps its name and assertions and passes both ways, shared and under PHAX_TEST_DRIVE_FRESH=1; the coverage log in spikes/tests-that-drive-a-run/measures.md records the prefixes and the files' times.

---

## phase-04 — Review the shared-prefix conversion pattern {#phase-04-review-pattern}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium
**Mode:** interactive

Stop the run so a person can review how phase-03 converted the first two files to shared prefixes, and correct the pattern before five later phases repeat it.

### Detailed instructions

- What to review, in `tests/integration/heldStopClose.test.ts` and `tests/integration/heldStopRun.test.ts`:
  - where the shared prefixes are declared, and how they are named (the names later appear in the prefix log and measures.md);
  - how `beforeEach` / `afterEach` obtain and clean the restored world, and how HOME is stubbed;
  - that second worlds and one-off prefixes still drive their own;
  - that no title, assertion, timeout or mock changed.
- In `tests/helpers/heldRunFixture.ts` and `tests/helpers/prefixSnapshot.ts`: whether the `sharedPrefix` / `restore()` surface reads well at the call site, and whether a later file with several prefixes or a prefix inside a test fits it without contortion.
- In `spikes/tests-that-drive-a-run/measures.md`: whether the coverage-log rows say enough for the after measure and for a reader.
- The pattern at stake is how a covered file declares and restores its shared prefixes. phase-05 and phase-06 (the remaining held-run files), phase-08 (files that drive held and stopped runs), phase-09 (stopped-run files) and phase-10 (other covered files) repeat it.
- Correct the pattern in place if needed, and say in the closing handoff what the later phases must do differently.

### Planned files to create

- (none)

### Planned files to edit

- (none)

### Optional files that may be edited

- `tests/integration/heldStopClose.test.ts`
- `tests/integration/heldStopRun.test.ts`
- `tests/helpers/heldRunFixture.ts`
- `tests/helpers/prefixSnapshot.ts`
- `tests/integration/sharedPrefix.test.ts`
- `spikes/tests-that-drive-a-run/measures.md`

### Test strategy

- (none)

### Implementation order

1. read the two converted files, then the fixture surface, then the coverage log

### Excluded scope

- Converting any further file.

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The corrections made, if any, and the pattern later phases follow from now on.
- What phase-05, 06, 08, 09 and 10 need to know about naming prefixes, arranging hooks and logging coverage.

### Commit subject

`test(stops): review corrections to the shared-prefix pattern`

### Commit body

A person reviewed how heldStopClose and heldStopRun declare and restore their shared prefixes, and corrected the pattern before the later batches repeat it.

---

## phase-05 — Cover the records and acceptance stop files {#phase-05-records-acceptance-files}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

Make the covered files among `stopRecords`, `acceptancePairReview`, `stopSecurityRecord` and `recordsExplainStop` restore their shared prefixes. Every test keeps its name and assertions and passes both ways.

### Detailed instructions

- Read `## Verdict`, `## Prefixes` and `## Coverage log` in `spikes/tests-that-drive-a-run/measures.md`, and the phase-04 handoff (the pattern as reviewed). Convert exactly the files the verdict assigns to phase-05, from `tests/integration/stopRecords.test.ts`, `tests/integration/acceptancePairReview.test.ts`, `tests/integration/stopSecurityRecord.test.ts` and `tests/integration/recordsExplainStop.test.ts`. If it assigns none, append one coverage-log line saying so and convert nothing.
- The fixture: at module level, `const p = sharedPrefix("<name>", async (world) => (await startHeldRun(world, HOLD, opts)).run)` from `tests/helpers/heldRunFixture.ts`. A test gets its own copy with `const { world, run } = await p.restore()`, then `vi.stubEnv("HOME", world.home)`, and `world.cleanup()` in `afterEach`. Declare one shared prefix per parameter set `## Prefixes` names for the file: hold, records on or off, plan, provider config, acceptance command. Use the name it gives.
- A prefix with records on carries its records branch and its HOME in the snapshot. Tests that change `run.config` (records, transcripts, cleanup commands) before resuming change their own copy. Leave that code as it is.
- A test whose prefix has a `prepare` callback, an injected failure (`failWrite`, `failingGates`, `rateLimited`, `brokenHandoffs` set before the start), a hook set before the start, or a one-off plan or configuration keeps driving its own prefix (spec §5.9). Second worlds (`others`) stay as they are.
- Keep every `describe` and `it` title, assertion, timeout and `vi.mock` exactly as they are. Do not merge, split, reorder, skip or move a test.
- Run the converted files both ways: `node spikes/tests-that-drive-a-run/measure.mjs files <files>` and the same with `--fresh`, then once with `--trace <tmp>` to confirm restored tests drive nothing and one-off tests still drive. Both ways must pass the same tests.
- Append to `## Coverage log`, per file: the prefixes declared (name, parameters, tests restoring), the tests left driving their own and why, and the file's time shared and fresh.

### Planned files to create

- (none)

### Planned files to edit

- `spikes/tests-that-drive-a-run/measures.md`

### Optional files that may be edited

- `tests/integration/stopRecords.test.ts`
- `tests/integration/acceptancePairReview.test.ts`
- `tests/integration/stopSecurityRecord.test.ts`
- `tests/integration/recordsExplainStop.test.ts`
- `tests/helpers/heldRunFixture.ts`

### Test strategy

- every test of the converted files is still there under the same full name and passes with shared prefixes — medium · example · phase-01's before rows for those files, matched by file and full name · in-phase · ac-same-tests
- the converted files pass the same tests with and without the fresh-drive switch — medium · example · measure.mjs files runs with and without --fresh, compared test by test · in-phase · ac-fresh
- tests with one-off parameters still drive their own prefix — medium · example · a measure.mjs files --trace run, worktree add per one-off test · in-phase · ac-own-prefix

### Implementation order

1. the assigned files in the verdict's order, largest repeated work first
2. both-ways runs and the trace check
3. the coverage log

### Excluded scope

- Files not assigned to phase-05 by the verdict.
- Changes to the fixture beyond a fix a conversion reveals; such a fix is named in the handoff.

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- Per converted file: the prefixes, the tests restoring each, the one-off tests, and the time shared and fresh.
- Any fixture fix.
- Any candidate the verdict did not assign, named as not covered.
- Any deviation from the planned file lists, with the reason (an untouched candidate is expected and needs only its verdict).

### Commit subject

`test(stops): restore shared prefixes in the records and acceptance stop files`

### Commit body

The covered files among stopRecords, acceptancePairReview, stopSecurityRecord and recordsExplainStop now restore their shared held-run prefixes per test instead of driving them again; tests with one-off prefixes still drive their own. Every test keeps its name and assertions and passes both ways; the coverage log in spikes/tests-that-drive-a-run/measures.md records the prefixes and times.

---

## phase-06 — Cover the remaining held-run files {#phase-06-held-run-files}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

Make the covered files among `heldStop`, `heldStopReentry`, `stopClosedBy`, `protectedPathsHandoff`, `noStopUnchanged` and `declaredCloseInFlight` restore their shared prefixes. Every test keeps its name and assertions and passes both ways.

### Detailed instructions

- Read `## Verdict`, `## Prefixes` and `## Coverage log` in `spikes/tests-that-drive-a-run/measures.md`, and the phase-04 handoff (the pattern as reviewed). Convert exactly the files the verdict assigns to phase-06, from these candidates:
  - `tests/integration/heldStop.test.ts`
  - `tests/integration/heldStopReentry.test.ts`
  - `tests/integration/stopClosedBy.test.ts`
  - `tests/integration/protectedPathsHandoff.test.ts`
  - `tests/integration/noStopUnchanged.test.ts`
  - `tests/integration/declaredCloseInFlight.test.ts`
  If it assigns none, append one coverage-log line saying so and convert nothing.
- The fixture: at module level, `const p = sharedPrefix("<name>", async (world) => (await startHeldRun(world, HOLD, opts)).run)` from `tests/helpers/heldRunFixture.ts`. A test gets its own copy with `const { world, run } = await p.restore()`, then `vi.stubEnv("HOME", world.home)`, and `world.cleanup()` in `afterEach`. Declare one shared prefix per parameter set `## Prefixes` names for the file, under the name it gives.
- A test whose prefix has a `prepare` callback, an injected failure, a hook set before the start, or a one-off plan, provider config or acceptance command keeps driving its own prefix (spec §5.9). Second worlds stay as they are.
- Keep every `describe` and `it` title, assertion, timeout and `vi.mock` exactly as they are. Do not merge, split, reorder, skip or move a test.
- Run the converted files both ways with `node spikes/tests-that-drive-a-run/measure.mjs files <files>` and `--fresh`, then once with `--trace <tmp>`. Both ways must pass the same tests.
- Append to `## Coverage log`, per file: the prefixes declared (name, parameters, tests restoring), the tests left driving their own and why, and the file's time shared and fresh.

### Planned files to create

- (none)

### Planned files to edit

- `spikes/tests-that-drive-a-run/measures.md`

### Optional files that may be edited

- `tests/integration/heldStop.test.ts`
- `tests/integration/heldStopReentry.test.ts`
- `tests/integration/stopClosedBy.test.ts`
- `tests/integration/protectedPathsHandoff.test.ts`
- `tests/integration/noStopUnchanged.test.ts`
- `tests/integration/declaredCloseInFlight.test.ts`
- `tests/helpers/heldRunFixture.ts`

### Test strategy

- every test of the converted files is still there under the same full name and passes with shared prefixes — medium · example · phase-01's before rows for those files, matched by file and full name · in-phase · ac-same-tests
- the converted files pass the same tests with and without the fresh-drive switch — medium · example · measure.mjs files runs with and without --fresh, compared test by test · in-phase · ac-fresh

### Implementation order

1. the assigned files in the verdict's order
2. both-ways runs and the trace check
3. the coverage log

### Excluded scope

- Files not assigned to phase-06 by the verdict.
- Changes to the fixture beyond a fix a conversion reveals.

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- Per converted file: the prefixes, the tests restoring each, the one-off tests, and the time shared and fresh.
- Any fixture fix.
- Candidates not covered, by the verdict.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`test(stops): restore shared prefixes in the remaining held-run files`

### Commit body

The covered files among heldStop, heldStopReentry, stopClosedBy, protectedPathsHandoff, noStopUnchanged and declaredCloseInFlight now restore their shared held-run prefixes per test; one-off prefixes are still driven by their tests. Every test keeps its name and assertions and passes both ways; the coverage log records the prefixes and times.

---

## phase-07 — Shared prefixes for stopped runs {#phase-07-stopped-prefix}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium
**Assignment reason:** The phase extends the fixture to a second kind of run whose fake backend keeps its recorded and queued state inside a class under src/infra/fakes, which must be copied completely without changing src/.

Extend the shared-prefix fixture to the stopped runs of `tests/helpers/stoppedRunFixture.ts`, so a test file can stop runs once and restore them per test with their fake backends copied. Prove it with its own tests, and cover `declaredStopClose` when the verdict assigns it.

### Detailed instructions

- Read `## Verdict` in `spikes/tests-that-drive-a-run/measures.md`. If no stopped-run candidate is covered (phase-07: declaredStopClose; phase-08: heldStopCommands, stopTranscripts, stopTurnCosts, runList; phase-09: stoppedRunCommands, enterPhaseStop, closeStopNetwork, declaredStopProviderArgv, structuredAnswerFlags, structuredRetriesExhausted), build nothing: append one coverage-log line saying so.
- In `tests/helpers/stoppedRunFixture.ts`, export `sharedStoppedPrefix(name, drive: (world: World) => Promise<readonly StoppedRun[]>)`. It returns `{ restore(): Promise<{ world: World; runs: readonly StoppedRun[] }> }`, built on `definePrefix` from `tests/helpers/prefixSnapshot.ts` (phase-02: drive once at the first restore, same-path copy of the root, guard, `PHAX_TEST_DRIVE_FRESH`, `PHAX_TEST_PREFIX_LOG`). `createWorld` is the world builder. HOME for the drive is `join(world.root, "home")`, the path `stopRun`'s policy names. `worldAt` rebuilds `{ root, repoRoot, stateRoot, cleanup }`. Keep `World`, `StoppedRun` and every existing export as they are.
- The capture of each StoppedRun: its plain fields (`shortName`, `runKey`, `runId`, `runPath`, `phaseFolder`, `worktree`, `report`, `policy`) deep-copied, and its fake backend from `src/infra/fakes/backend.ts`. Read `makeFakeBackend` / `FakeBackendImpl` to find every recorded call list and every queued response or failure. `give` builds a new `makeFakeBackend()` and fills it to the same recorded and queued state, through its public methods where they reproduce it and a typed cast where they do not (nothing under `src/` changes). As in phase-02, the capture throws on any own key of a StoppedRun or of the backend's impl it does not handle.
- Create `tests/integration/sharedStoppedPrefix.test.ts`, with the mocks the stopped-run files install where needed. Declare `sharedStoppedPrefix("stopped at phase-03", async (world) => [await stopRun(world)])` and test:
  - a second restore runs no `worktree add` and no `commit` (a `GIT_TRACE` file), and finds the phase-03 worktree at the first test's `HEAD`;
  - a restore equals the driven state (the fingerprint of phase-02's `sharedPrefix.test.ts`: refs, `rev-parse HEAD` per worktree, `worktree list --porcelain`, local config, sha256 of every file, read-only git only);
  - one test's change in the phase-03 worktree and its backend calls do not reach the next test's restore;
  - the next test's backend holds exactly the calls and queued responses the drive left.
  Use `boundedOutput` / a bounded git helper for every git call.
- If the verdict assigns `tests/integration/declaredStopClose.test.ts` to phase-07, convert it with the pattern phase-04 reviewed. Declare the shared stopped prefixes named in `## Prefixes`, under their names, and restore them per test. Keep one-off prefixes (a rate-limited first turn through `sessionId: undefined`, another provider or model set for one test) driving their own. Keep every title, assertion, timeout and mock. Run it both ways with `node spikes/tests-that-drive-a-run/measure.mjs files` and `--fresh`, and once with `--trace`.
- Append to `## Coverage log`: the stopped-run fixture's surface in one line, and per converted file the prefixes, the restoring tests, the one-off tests and the times shared and fresh.

### Planned files to create

- `tests/integration/sharedStoppedPrefix.test.ts`

### Planned files to edit

- `tests/helpers/stoppedRunFixture.ts`
- `spikes/tests-that-drive-a-run/measures.md`

### Optional files that may be edited

- `tests/integration/declaredStopClose.test.ts`
- `tests/helpers/prefixSnapshot.ts`

### Boundary contracts

Producer for phase-08 and phase-09: `tests/helpers/stoppedRunFixture.ts` exports `sharedStoppedPrefix(name, drive)`. Its `restore()` resolves to `{ world: World; runs: readonly StoppedRun[] }`: each run's fake backend is the test's own copy, and the world's `cleanup` removes only that test's restored root. It consumes `definePrefix` from `tests/helpers/prefixSnapshot.ts` unchanged, or with a fix named in the handoff.

### Test strategy

- a second test restoring a stopped prefix runs no worktree add and no commit and finds the same phase-03 worktree HEAD — medium · example · a GIT_TRACE file around the restore, and the first test's recorded HEAD · in-phase · ac-driven-once
- a restored stopped world equals the state the prefix left — medium · example · a fingerprint taken at the end of the drive and after a later restore · in-phase · ac-byte
- a restored stopped run's fake backend holds exactly the drive's calls and queued responses, whatever the previous test did — medium · example · the call and queue counts the drive left · in-phase · ac-logs
- one test's change in the phase-03 worktree never reaches the next test's restored state — medium · example · the original file content and HEAD in the next restore · in-phase · ac-isolated
- declaredStopClose, when covered, keeps every test under its full name passing both ways — medium · example · phase-01's before rows and measure.mjs files runs with and without --fresh · in-phase · ac-same-tests

### Implementation order

1. the stopped run's capture and give, and sharedStoppedPrefix
2. sharedStoppedPrefix.test.ts
3. declaredStopClose, when assigned, and the coverage log

### Excluded scope

- The other stopped-run and mixed files (phase-08, phase-09).
- Any change under `src/`, including the fake backend.

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The exact export and signature of `sharedStoppedPrefix`, with a usage example.
- What of the fake backend is copied and how.
- declaredStopClose's prefixes, one-off tests and times, when converted.
- Whether nothing was built because no stopped-run file is covered.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`test(fixtures): restore a stopped run's prefix per test`

### Commit body

Add sharedStoppedPrefix to stoppedRunFixture, on the shared-prefix core: the runs a test file stops at their interactive phase are driven once and restored per test at the same path, each with its own copy of the fake backend's calls and queued answers. tests/integration/sharedStoppedPrefix.test.ts proves that a second restore drives nothing, that a restore equals the driven state, that one test's writes and calls stay its own; declaredStopClose restores its shared prefixes when the measures cover it.

---

## phase-08 — Cover the files that drive held and stopped runs {#phase-08-mixed-run-files}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

Make the covered files among `heldStopCommands`, `stopTranscripts`, `stopTurnCosts` and `runList`, which drive both held and stopped runs, restore their shared prefixes. Every test keeps its name and assertions and passes both ways.

### Detailed instructions

- Read `## Verdict`, `## Prefixes` and `## Coverage log` in `spikes/tests-that-drive-a-run/measures.md`, and the phase-04 and phase-07 handoffs. Convert exactly the files the verdict assigns to phase-08, from `tests/integration/heldStopCommands.test.ts`, `tests/integration/stopTranscripts.test.ts`, `tests/integration/stopTurnCosts.test.ts` and `tests/integration/runList.test.ts`. If it assigns none, append one coverage-log line saying so and convert nothing.
- Held prefixes use `sharedPrefix(name, drive)` from `tests/helpers/heldRunFixture.ts`. Its `restore()` resolves to `{ world, run }`; stub HOME to `world.home`, and `world.cleanup()` in `afterEach`. Stopped prefixes use `sharedStoppedPrefix(name, drive)` from `tests/helpers/stoppedRunFixture.ts`. Its `restore()` resolves to `{ world, runs }`; `world.cleanup()` in `afterEach`. A prefix that builds both a held and a stopped run in one world, or stops several runs and writes a registry (`writeRegistry`), is declared whole in one drive. Use `definePrefix` from `tests/helpers/prefixSnapshot.ts` directly when neither form fits. Its capture must still cover every in-memory log the tests read, and throw on an unknown key.
- A test whose prefix has a `prepare` callback, an injected failure, a hook set before the start, or a one-off plan, provider or configuration keeps driving its own prefix (spec §5.9).
- Keep every `describe` and `it` title, assertion, timeout and `vi.mock` exactly as they are. Do not merge, split, reorder, skip or move a test.
- Run the converted files both ways with `node spikes/tests-that-drive-a-run/measure.mjs files <files>` and `--fresh`, then once with `--trace <tmp>`. Both ways must pass the same tests.
- Append to `## Coverage log`, per file: the prefixes (name, parameters, tests restoring), the tests left driving their own and why, and the time shared and fresh.

### Planned files to create

- (none)

### Planned files to edit

- `spikes/tests-that-drive-a-run/measures.md`

### Optional files that may be edited

- `tests/integration/heldStopCommands.test.ts`
- `tests/integration/stopTranscripts.test.ts`
- `tests/integration/stopTurnCosts.test.ts`
- `tests/integration/runList.test.ts`
- `tests/helpers/heldRunFixture.ts`
- `tests/helpers/stoppedRunFixture.ts`
- `tests/helpers/prefixSnapshot.ts`

### Test strategy

- every test of the converted files is still there under the same full name and passes with shared prefixes — medium · example · phase-01's before rows for those files, matched by file and full name · in-phase · ac-same-tests
- the converted files pass the same tests with and without the fresh-drive switch — medium · example · measure.mjs files runs with and without --fresh, compared test by test · in-phase · ac-fresh

### Implementation order

1. the assigned files in the verdict's order
2. both-ways runs and the trace check
3. the coverage log

### Excluded scope

- Files not assigned to phase-08 by the verdict.
- Fixture changes beyond a fix a conversion reveals.

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- Per converted file: the prefixes (and which form of the fixture each uses), the restoring tests, the one-off tests, and the times.
- Any fixture fix.
- Candidates not covered.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`test(stops): restore shared prefixes in files driving held and stopped runs`

### Commit body

The covered files among heldStopCommands, stopTranscripts, stopTurnCosts and runList now restore their shared held and stopped prefixes per test instead of driving them again; one-off prefixes are still driven by their tests. Every test keeps its name and assertions and passes both ways; the coverage log records the prefixes and times.

---

## phase-09 — Cover the remaining stopped-run files {#phase-09-stopped-run-files}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

Make the covered files among `stoppedRunCommands`, `enterPhaseStop`, `closeStopNetwork`, `declaredStopProviderArgv`, `structuredAnswerFlags` and `structuredRetriesExhausted` restore their shared stopped-run prefixes. Every test keeps its name and assertions and passes both ways.

### Detailed instructions

- Read `## Verdict`, `## Prefixes` and `## Coverage log` in `spikes/tests-that-drive-a-run/measures.md`, and the phase-04 and phase-07 handoffs. Convert exactly the files the verdict assigns to phase-09, from these candidates:
  - `tests/integration/stoppedRunCommands.test.ts`
  - `tests/integration/enterPhaseStop.test.ts`
  - `tests/integration/closeStopNetwork.test.ts`
  - `tests/integration/declaredStopProviderArgv.test.ts`
  - `tests/integration/structuredAnswerFlags.test.ts`
  - `tests/integration/structuredRetriesExhausted.test.ts`
  If it assigns none, append one coverage-log line saying so and convert nothing.
- The fixture: at module level, `const p = sharedStoppedPrefix("<name>", async (world) => [await stopRun(world, options)])` from `tests/helpers/stoppedRunFixture.ts` (several runs, or a `writeRegistry`, go in the same drive). A test gets its own copy with `const { world, runs } = await p.restore()`, and `world.cleanup()` in `afterEach`. Declare one shared prefix per parameter set `## Prefixes` names (short name, provider, model, session id), under the name it gives.
- A test with a one-off prefix keeps driving its own (spec §5.9): `sessionId: undefined` making the first turn fail, a provider or model only it uses, or a backend response queued before the stop. Files that drive `phax artifact decide` through `useDecideRepo` (`tests/helpers/decideVerdictsHarness.ts`) as well keep that part as it is, unless `## Prefixes` names it as repeated. In that case, cover it with `definePrefix` from `tests/helpers/prefixSnapshot.ts`, its capture covering every in-memory log the tests read.
- Keep every `describe` and `it` title, assertion, timeout and `vi.mock` exactly as they are. Do not merge, split, reorder, skip or move a test.
- Run the converted files both ways with `node spikes/tests-that-drive-a-run/measure.mjs files <files>` and `--fresh`, then once with `--trace <tmp>`. Both ways must pass the same tests.
- Append to `## Coverage log`, per file: the prefixes, the restoring tests, the one-off tests and why, and the time shared and fresh.

### Planned files to create

- (none)

### Planned files to edit

- `spikes/tests-that-drive-a-run/measures.md`

### Optional files that may be edited

- `tests/integration/stoppedRunCommands.test.ts`
- `tests/integration/enterPhaseStop.test.ts`
- `tests/integration/closeStopNetwork.test.ts`
- `tests/integration/declaredStopProviderArgv.test.ts`
- `tests/integration/structuredAnswerFlags.test.ts`
- `tests/integration/structuredRetriesExhausted.test.ts`
- `tests/helpers/stoppedRunFixture.ts`
- `tests/helpers/prefixSnapshot.ts`

### Test strategy

- every test of the converted files is still there under the same full name and passes with shared prefixes — medium · example · phase-01's before rows for those files, matched by file and full name · in-phase · ac-same-tests
- the converted files pass the same tests with and without the fresh-drive switch — medium · example · measure.mjs files runs with and without --fresh, compared test by test · in-phase · ac-fresh

### Implementation order

1. the assigned files in the verdict's order
2. both-ways runs and the trace check
3. the coverage log

### Excluded scope

- Files not assigned to phase-09 by the verdict.
- Fixture changes beyond a fix a conversion reveals.

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- Per converted file: the prefixes, the restoring tests, the one-off tests, and the times.
- Any fixture fix.
- Candidates not covered.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`test(stops): restore shared prefixes in the stopped-run files`

### Commit body

The covered files among stoppedRunCommands, enterPhaseStop, closeStopNetwork, declaredStopProviderArgv, structuredAnswerFlags and structuredRetriesExhausted now restore their shared stopped-run prefixes per test; one-off prefixes are still driven by their tests. Every test keeps its name and assertions and passes both ways; the coverage log records the prefixes and times.

---

## phase-10 — Cover the remaining covered files {#phase-10-remaining-files}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium
**Assignment reason:** Each remaining covered file builds its prefix through its own helper, so each needs a world layout and an in-memory capture that no earlier phase wrote, under the byte-identical, same-path restore.

Make every covered file the verdict assigns to no earlier phase restore its shared prefixes. These are files that drive runs, or `phax artifact decide`, through helpers other than the held-run and stopped-run fixtures. Every test keeps its name and assertions and passes both ways.

### Detailed instructions

- Read `## Verdict`, `## Prefixes` (including the `sequence` files, whose prefixes phase-01 named by reading the file) and `## Coverage log` in `spikes/tests-that-drive-a-run/measures.md`, and the phase-04 handoff. Convert exactly the files the verdict assigns to phase-10. Likely candidates are `declaredStopRun`, `decideVerdicts`, `decideArtifact`, `executePlan`, `recordsExplain` and `findingPullRequestLocal`, but the verdict decides. If it assigns none, append one coverage-log line saying so and convert nothing.
- For each file, find where its repeated prefix is built: its `beforeEach`, a local helper, or a shared helper such as `useDecideRepo` in `tests/helpers/decideVerdictsHarness.ts`. Declare it with `definePrefix` from `tests/helpers/prefixSnapshot.ts`, giving it:
  - `createWorld`, the world as the file builds it today, git isolated, every repository with auto-maintenance off;
  - `drive`, the prefix as today;
  - `capture` / `give`, a complete copy of every in-memory object the tests read (fake backends, call logs, telemetry, config), throwing on any own key they do not handle;
  - `worldAt`, the world rebuilt from its root.
  A world that keeps state outside one root (a config dir beside a repo dir, as `useDecideRepo` does) must be laid out under one root for the prefix, or snapshotted per directory. Either way the restore must be byte-identical and same-path, and the guard must cover every restored directory.
- When a helper shared with files that are not covered must change (for example `useDecideRepo`), keep its existing callers' behaviour and signature exactly. Add a new export rather than changing an existing one, and use it in this phase so knip sees it used.
- A test with a one-off prefix keeps driving its own (spec §5.9). Keep every `describe` and `it` title, assertion, timeout and `vi.mock` exactly as they are. Do not merge, split, reorder, skip or move a test.
- Run every converted file both ways with `node spikes/tests-that-drive-a-run/measure.mjs files <files>` and `--fresh`, then once with `--trace <tmp>`. Both ways must pass the same tests.
- Append to `## Coverage log`, per file: the prefixes, how the world is laid out for the snapshot, the restoring tests, the one-off tests and why, and the time shared and fresh. A covered file on no candidate list is an unplanned edit that reconciliation flags; name it and its verdict in the handoff.

### Planned files to create

- (none)

### Planned files to edit

- `spikes/tests-that-drive-a-run/measures.md`

### Optional files that may be edited

- `tests/integration/declaredStopRun.test.ts`
- `tests/integration/decideVerdicts.test.ts`
- `tests/integration/decideArtifact.test.ts`
- `tests/integration/executePlan.test.ts`
- `tests/integration/recordsExplain.test.ts`
- `tests/integration/findingPullRequestLocal.test.ts`
- `tests/helpers/decideVerdictsHarness.ts`
- `tests/helpers/prefixSnapshot.ts`

### Test strategy

- every test of the converted files is still there under the same full name and passes with shared prefixes — medium · example · phase-01's before rows for those files, matched by file and full name · in-phase · ac-same-tests
- the converted files pass the same tests with and without the fresh-drive switch — medium · example · measure.mjs files runs with and without --fresh, compared test by test · in-phase · ac-fresh
- a restored world of a converted file holds no path to its snapshot in any of its directories — medium · example · the restore guard passing on every restore of the both-ways runs · in-phase · ac-no-path-back

### Implementation order

1. the assigned files in the verdict's order, largest repeated work first
2. both-ways runs and the trace check
3. the coverage log

### Excluded scope

- Covered files an earlier batch phase owns.
- Any change to a shared helper's existing callers' behaviour.

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- Per converted file: the prefixes, the world layout used for the snapshot, the in-memory objects captured, the restoring and one-off tests, and the times.
- Every new helper export, with its path.
- Any covered file edited outside the candidate list, with its verdict.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`test(integration): restore shared prefixes in the remaining covered files`

### Commit body

The covered files outside the held-run and stopped-run fixtures now declare their repeated prefixes on the shared-prefix core and restore them per test, each with a complete copy of the in-memory objects its tests read; one-off prefixes are still driven by their tests. Every test keeps its name and assertions and passes both ways; the coverage log records the prefixes, world layouts and times.

---

## phase-11 — Measure the suite before and after {#phase-11-after-measure}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium
**Assignment reason:** The phase designs the back-to-back measure from a temporary base worktree and the test-by-test command comparison across two traces, which decide four of the spec's criteria.

Measure the suite before and after the change, back to back on the machine of the before measures. Check the spec's criteria test by test: covered files at most half their time, the same tests passing, the same commands run for real, and both ways passing. Record every measure §5.14 names in `spikes/tests-that-drive-a-run/measures.md`.

### Detailed instructions

- Take the base commit from the `commit` meta line of `spikes/tests-that-drive-a-run/reports/before-1.tsv.gz` (phase-01's tree). Add to `measure.mjs` a mode `paired --base <commit> --runs 3`. It adds a detached worktree of the base commit in a new temporary directory (`git worktree add --detach`, spawned by the script), links `node_modules` there from the current checkout, and alternates runs: base run 1, after run 1, base run 2 and so on. It writes `reports/paired-before-<n>.tsv.gz` and `reports/after-<n>.tsv.gz`, then runs `pnpm test` once in each tree for the gate step's time (base first). In a `finally`, it removes the worktree with `git worktree remove --force` and deletes the temporary directory. If one run would exceed the tool's time limit, run the mode one pair at a time (`--only <n>`).
- Run `node spikes/tests-that-drive-a-run/measure.mjs paired …` with nothing else heavy running. Then run `run --project integration --fresh --out spikes/tests-that-drive-a-run/reports/fresh-integration.tsv.gz` and `run --project integration --out spikes/tests-that-drive-a-run/reports/shared-integration.tsv.gz`. Their `prefix-log` meta must show no `restored` line under `--fresh`, and `restored` lines for every covered file without it. Then run `trace --out spikes/tests-that-drive-a-run/reports/trace-after.tsv.gz` over the covered files.
- Add a mode `compare-commands <trace-before> <trace-after> --covered <files>`. For each test of a covered file, the real shell commands of its `own` segments (normalized argv, in order) must be equal before and after. In the after trace, a test the prefix log marks `restored` has no prefix segment and no `worktree add` before its own steps. A test whose before prefix was `one-off` still has `worktree add` and its start commits. No real command in either trace has `pnpm` as its program (the scripted `pnpm` steps stay stand-ins). Print each difference and exit 1 on any.
- Run `compare` on the paired reports (`paired-before-1..3 -- after-1..3`), with `--allow-new tests/integration/sharedPrefix.test.ts --allow-new tests/integration/sharedStoppedPrefix.test.ts` (and any fixture test file a later phase added). Every test of each before report must be in the after, passed and not skipped, under the same project. Also compare `fresh-integration` with `shared-integration`: the same tests, the same states.
- The covered-files target (q-target `covered-half`): per run, sum the file times of the covered files (the verdict's list, minus any file a batch phase recorded as not converted, with the reason). The median of the three after sums must be at most half the median of the three base sums. If it is not, do not change tests to make it: record the numbers and the shortfall honestly, and say so in the handoff.
- Fill `## After` in measures.md with the §6 commit-message block, each line before and after:
  - suite wall time (median);
  - sum of file times, total and by tier;
  - user and system CPU;
  - average files at once;
  - the `pnpm test` gate step's time;
  - every covered file with its time and git-process count (from the traces);
  - every integration file over 30 s with its time.
  Then add the covered-files sums per run with both medians and the verdict on the target; the outcomes of `compare`, the fresh versus shared check and `compare-commands`; the prefix-log counts; and phase-01's own before runs beside the paired ones. Keep `reports/compare.txt` with the printed comparisons.
- Update `spikes/tests-that-drive-a-run/README.md` with the new modes and how to re-check the committed reports.
- Change no test and no fixture in this phase. A failing check is reported, not fixed here.

### Planned files to create

- `spikes/tests-that-drive-a-run/reports/paired-before-1.tsv.gz`
- `spikes/tests-that-drive-a-run/reports/paired-before-2.tsv.gz`
- `spikes/tests-that-drive-a-run/reports/paired-before-3.tsv.gz`
- `spikes/tests-that-drive-a-run/reports/after-1.tsv.gz`
- `spikes/tests-that-drive-a-run/reports/after-2.tsv.gz`
- `spikes/tests-that-drive-a-run/reports/after-3.tsv.gz`
- `spikes/tests-that-drive-a-run/reports/fresh-integration.tsv.gz`
- `spikes/tests-that-drive-a-run/reports/shared-integration.tsv.gz`
- `spikes/tests-that-drive-a-run/reports/trace-after.tsv.gz`
- `spikes/tests-that-drive-a-run/reports/compare.txt`

### Planned files to edit

- `spikes/tests-that-drive-a-run/measure.mjs`
- `spikes/tests-that-drive-a-run/measures.md`
- `spikes/tests-that-drive-a-run/README.md`

### Optional files that may be edited

- (none)

### Boundary contracts

Consumer of phase-01's report shapes (`M`/`F`/`T` lines, the trace's per-test rows and `S` lines) and of the fixture's `PHAX_TEST_PREFIX_LOG` line format (file, prefix, `driven`/`restored`/`fresh`). Both are read as committed, without changing their producers.

### Test strategy

- the covered files' summed file time, median of three after runs, is at most half the median of three base runs taken back to back — medium · example · the paired base reports of the run's base commit · in-phase · ac-faster
- every test that passed before is present, passed and not skipped after, under the same project, and every new test is one of the fixture's own — medium · example · the paired before reports compared by file and full name · in-phase · ac-same-tests
- the commands each covered test runs for real after its prefix are the same before and after, and no pnpm stand-in runs for real — medium · example · phase-01's trace report, own segments compared test by test · in-phase · ac-commands
- the integration tier passes the same tests with and without the fresh-drive switch, and under the switch nothing is restored — medium · example · the two integration reports and their prefix-log counts · in-phase · ac-fresh
- restored tests drive no prefix of their own in the after trace — medium · example · the prefix log's restored lines against the trace's prefix segments and worktree add counts · in-phase · ac-driven-once
- tests whose before prefix was one-off still drive it after — medium · example · phase-01's one-off prefix marks against worktree add in the after trace · in-phase · ac-own-prefix
- measures.md holds the suite's wall time, file times by tier, CPU, files at once, the files over 30 s, every covered file with time and git processes, and the gate step's time, each before and after — small · example · the §6 commit-message block's list of lines · in-phase · ac-recorded

### Implementation order

1. the `paired` and `compare-commands` modes
2. the paired runs and the gate-step times
3. the integration tier both ways and the after trace
4. the comparisons, measures.md and the README

### Excluded scope

- Any change to a test, a fixture, `src/`, `vitest.config.ts` or `phax.json`.
- Any fix of a check that fails; it is recorded and reported.

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The §6 block as written into measures.md.
- The covered-files medians and whether the target is met.
- The outcome of each check (`compare`, fresh versus shared, `compare-commands`), with every problem listed.
- The base commit and that the temporary worktree was removed.
- Any deviation from the planned file lists, with the reason.
- A reminder for the operator: the numbers are in `spikes/tests-that-drive-a-run/measures.md`, so paste the block into the pull request.

### Commit subject

`test(spikes): measure the suite after shared prefixes`

### Commit body

Measure the suite before and after the change, back to back on the machine of the before measures: three runs of the run's base commit in a temporary worktree alternated with three runs of this tree, the gate's pnpm test step timed on each side, the integration tier run with and without PHAX_TEST_DRIVE_FRESH=1, and a traced run of the covered files.

The before and after measures the spec's §5.14 lists (suite wall time, sum of file times by tier, CPU, files at once, integration files over 30 s, every covered file with its time and git-process count, the gate step's time) are in spikes/tests-that-drive-a-run/measures.md, under After, with the covered files' medians against q-target covered-half and the test-by-test checks of the same tests, the same real commands and both ways passing; reports/ keeps the reports and compare.txt.
