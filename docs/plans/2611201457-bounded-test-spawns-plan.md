---
status: Approved
source-spec: docs/specs/2611201446-bounded-test-spawns.md
completes-spec: true
approved:
  date: 2026-11-20
  baseline: a9e91a1
---
# Bounded test spawns

Every child process a test starts ends within a bound the test states, together with every process it started. A child that ends any other way fails its test with a message saying what ended it: the bound, or a signal from somewhere else. The sender of the stray SIGTERM behind the exit-143 kills of 2026-11-19 and 2026-11-20 is named from a reproduction and stopped where it lies. This changes the tests, and phax itself only where the cause is found.

The order runs from core to surface. phase-01 adds the bounded spawn (`tests/helpers/boundedSpawn.ts`) and its tests, which prove every ending criterion. phase-02 moves the 26 suites that spawn the CLI, so every CLI spawn reports how it ended, and adds the diagnostic log. phase-03 stops the run so the operator can review that pattern. phase-04 reproduces the kill under the full suite and names the sender, and phase-05 acts on it. phases 06 to 10 move every other spawn under `tests/`, shared wrappers first. phase-11 lands the guard once nothing is left for it to refuse. phase-12 runs the full suite 20 times and records the result.

Execution-model caveat: a phase runs only on the operator's macOS machine. The CI half of the reproduction (§5.1) and of the repeated suites (§8 ac-suite-clean, 10 CI runs) happens on this run's pull request, which the operator reads at review. The final phase stays open for that. Until then, the sender named in `spikes/bounded-test-spawns/findings.md` rests on macOS evidence and on code reading alone. Each phase leaves `tests/e2e/**` typechecked but never runs it (`PHAX_E2E_RUN` stays unset).

Rules every phase keeps:
- `vitest.config.ts`, `.oxlintrc.json`, `lint-baseline.json`, `knip-baseline.json` and `.github/workflows/**` are protected and stay untouched.
- No assertion is removed, no test is skipped and no retry is added.
- knip runs at every gate: export a name only in the phase that first imports it.
- `pnpm lint` fails when an accepted diagnostic in `lint-baseline.json` goes away, so a moved line that carries one keeps its construct. If a move cannot keep it, name the entry in the handoff for the operator's `pnpm lint --prune`.
- Tests never read `~/.phax`, a real provider home or the global git config.
- A CLI child always gets `phaxHomeEnv()` in its `env`.
- No test names the version that is open.

## Required commands

- `node`
- `pnpm exec tsx`
- `pnpm test:unit`
- `pnpm test:integration`
- `pnpm test`
- `git grep`
- `git log`

Every command above is already covered: `node`, `pnpm exec tsx`, `pnpm test:unit`, `pnpm test:integration`, `git grep` and `git log` are entries of `security.agentCommands`, and `pnpm test` is a command of the `standard` gate profile. The reproduction scripts run under `node` and start vitest from `node_modules/.bin` themselves. No change to `phax.json` is needed.

## Technical arbitrations

- The bounded spawn is synchronous and runs a supervisor. `boundedSpawn` keeps spawnSync's shape, so about 288 call sites and 79 local wrappers move without turning their callers async. A synchronous call cannot end a process group, so it runs a supervisor: `tests/helpers/boundedSpawn.ts`, executed by `process.execPath` as its own main module (`import.meta.main`). The supervisor starts the command detached in its own process group. At the bound it sends SIGTERM to the group, then SIGKILL to the group once the 2 s grace has passed, and it writes an ending report. The caller's spawnSync carries a safety timeout of bound + grace + 5 s with SIGKILL, for a supervisor that never reports. Loss accepted: one extra node process per spawn (tens of ms; phase-01 measures it and phase-12 records the suite time). vitest's own test timeout also stays inert while a call waits, so the per-call bound is the only cap on a hang.
- Descendants are ended through a process group: `detached: true` in the supervisor, then `process.kill(-pgid, signal)`. spawnSync's own `timeout` and `killSignal` reach only the direct child, which is why the supervisor exists. Group members left behind after a normal exit are also ended with SIGKILL, so a leftover never holds the caller's pipes open. Loss accepted: a descendant that leaves the group with setsid is out of the bound's reach. This covers git's detached maintenance, which fixture repos already turn off with `disableGitAutoMaintenance`. Neither recorded hang involved one.
- The bound's numbers are named constants exported from `tests/helpers/boundedSpawn.ts`, each one exported by the phase that first uses it. Every call states the constant it uses (q-bound-form per-call): `GIT_BOUND_MS` 20 000, `CLI_BOUND_MS` 60 000, `LONG_CLI_BOUND_MS` 85 000 for a CLI call that drives a run, and `SCRIPT_BOUND_MS` 25 000 for another tool or script. The grace is a fixed internal 2 000 ms and no call sets it. Sizing: the CLI answers in 0.7 s alone, and under a loaded gate a test with two or three CLI spawns took over 30 s, so one call can take up to about 15 s and 60 s leaves 4× headroom. Every ceiling stays under its project's test timeout (30 s unit, 90 s integration), so a hang is reported by the helper's error within minutes. A call that needs another bound states a literal with a one-line reason, or adds a named constant with its measured need. The e2e helper states its own constant (300 000, today's default). Loss accepted: a healthy call slowed past its ceiling by extreme load now fails at its bound instead of finishing.
- Order of the migration (q-scope all): each file moves once, all its spawns at once. phase-02 moves the 26 suites that spawn the CLI, so the reproduction sees every CLI spawn report how it ended. phase-06 moves the shared wrappers (tests/helpers, tests/fixtures, tests/integration/helpers, tests/unit/releaseNotes). phases 07 to 09 move the rest of tests/integration in alphabetical thirds, and phase-10 moves tests/unit and tests/e2e. The guard lands in phase-11, when nothing is left for it to refuse. It has no exemption list at any time: its only allowed file is the bounded spawn itself. Loss accepted: from phase-02 to phase-10 nothing refuses a new raw spawn, so one added meanwhile is caught only by phase-11.
- Naming the sender, given who can run what. phase-02 makes every foreign-signal ending say who could have sent it. Its error carries a diagnosis block (worker, supervisor and child pids and process groups, the moment, a ps snapshot), so a CI log shows it. It is also logged as one JSON line to the file named by `PHAX_SPAWN_DIAG_LOG` when that variable is set. phase-04 reproduces on macOS with `spikes/bounded-test-spawns/repro.mjs`: up to 20 full suites under the standard profile's load, with escalating pressure. The CI half is this run's pull request CI, which the operator reads at review. If macOS never reproduces the kill within that budget, phase-04 records the negative evidence and rules candidates in or out from the code. phase-05 then changes no phax code, because r-cause-fixed needs a named cause. It records ac-sender-named, ac-sender-stopped and ac-upstream-avoided as open for the pull request's CI and the next gate, where the diagnosis block names the sender at the next kill. Loss accepted: the run can end with the spec's sender criteria still open for the operator's review, but it never invents a sender.
- An upstream sender (vitest or tsx) is avoided in the suite. For tsx, that means changing the launcher in one place: `CLI_LAUNCHER` and `cliArgs` in `tests/helpers/boundedSpawn.ts`. The upstream issue's text is drafted in `spikes/bounded-test-spawns/findings.md`. A phase cannot publish to an outside service, so the operator files the issue, or links an existing one, at review. Loss accepted: the issue link is added at review, not during the run.
- The guard lives in `tests/unit/architecturalGuards.test.ts`, which `pnpm audit:architecture` and `pnpm test:unit` both run inside `pnpm check:full`. It parses every script file under tests/ with oxc-parser, a devDependency `scripts/lint-baseline.ts` already uses. It refuses any value import, require or dynamic import of `node:child_process` or `child_process` outside `tests/helpers/boundedSpawn.ts`, naming the file and the line of each call. `.oxlintrc.json` is protected, so a lint rule is not an option. Loss accepted: the source of a script a test writes to disk and runs is not scanned. Its children are descendants of a bounded child, and the group kill ends them.
- The HOME-isolation scan in `tests/unit/phaxHomeGuard.test.ts` learns the bounded spawn in phase-01: `boundedSpawn(` and `boundedOutput(` calls, and `cliArgs(` as naming the CLI entry. Without that, it would silently stop seeing CLI spawns as they move. The e2e `runCli` becomes a thin wrapper with a required bound, and its 'a SIGTERM means a timeout' reading goes. The CLI-hang test reaches a real command (`phax completions`, whose `usage` child the test replaces with one that never answers), so phax gains no hook.

---

## phase-01 — The bounded spawn and its endings {#phase-01-bounded-spawn}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high
**Assignment reason:** The phase designs a mechanism the repository does not have yet: a synchronous call that supervises a process group, its ending protocol, and typed overloads. Every later phase builds on it.

Tests gain one way to start a child process: `boundedSpawn` in `tests/helpers/boundedSpawn.ts`. It needs a bound at every call. At the bound it ends the child and every descendant, even ones that ignore SIGTERM. It returns a normal exit unchanged, returns an expected signal as a result, and fails naming the command, the bound, the signal and the output on any other ending. Its own tests prove each ending criterion of the spec.

### Detailed instructions

- Create `tests/helpers/boundedSpawn.ts`. It is self-contained: it imports only `node:` modules, never vitest or another test helper, and uses erasable TypeScript only. The reason is that node (`process.execPath`) runs the same file directly as the supervisor when `import.meta.main` is true. Its doc comment tells a contributor that a test starts a child only through this module, with a bound stated at the call. If Node 26's type stripping cannot run the file as is, stop and say so in the handoff. Do not add a second file silently: phase-11's guard allows exactly this one file.
- The library side: `boundedSpawn(command: string, args: readonly string[], options)`. `options.boundMs: number` is required in the type. Also offered: `cwd?`, `env?` (the child's whole environment; `process.env` when absent), `input?: string | Buffer` (the child's stdin, which is empty and closed when absent) and `expectSignal?: NodeJS.Signals`. Use overloads: without `expectSignal`, the result is `{ status: number; signal: null; stdout: string; stderr: string }`. With it, the result may also be `{ status: null; signal: NodeJS.Signals; stdout; stderr }`. Add an option such as a Buffer encoding only when a call site needs it.
- Refuse a call before any child starts when `boundMs` is missing, not a finite number, or not above 0. Throw an Error naming the command and saying a bound is required.
- Supervisor protocol. The caller writes a call file (JSON: command, args, cwd, the child's env, boundMs, graceMs = 2000, report path) in a fresh temporary directory. It then runs `spawnSync(process.execPath, [thisFile, callFile], …)` with: stdin set to `input` (or empty), stdout and stderr piped, encoding utf8, a large `maxBuffer` (at least 256 MiB), `timeout: boundMs + grace + 5000` and `killSignal: "SIGKILL"`. Give the supervisor an environment that does NOT carry the call's `NODE_OPTIONS`, because the relayed-143 test below sets it for the child only. Remove the temporary directory before returning or throwing.
- The supervisor starts the command with `detached: true` (its own process group) and stdio inherited, so the child writes straight into the caller's pipes and the output up to any ending is kept. It records each ending in the report file as JSON: the kind (exit, signal, bound, supervisor-signal or spawn-error), status, signal, elapsed ms, the supervisor, child and group ids, and the number of descendants ended. At the bound it sends SIGTERM to `-pgid`. After the grace it lists the group's members (for example with `ps -A -o pid=,pgid=`), sends SIGKILL to `-pgid` and records how many it ended. After a normal exit, it sends SIGKILL to any member left in the group, so no leftover holds the pipes; the exit is still returned unchanged. When the supervisor itself receives SIGTERM, SIGINT or SIGHUP, it records the signal, ends the child's group as at the bound and reports kind supervisor-signal.
- Exported for CLI spawns: `CLI_LAUNCHER` (the absolute path of `node_modules/.bin/tsx`, so no caller relies on PATH) and `cliArgs(...args)`, which returns `[<absolute src/cli/main.ts>, ...args]`. A CLI spawn reads `boundedSpawn(CLI_LAUNCHER, cliArgs("ls"), { boundMs: CLI_BOUND_MS, env: phaxHomeEnv(), … })`. A launcher change, if phase-05 needs one, is then one edit.
- Reading the ending. A child that ends on a signal is a signal ending. So is a CLI spawn (its args name `src/cli/main.ts` or `dist/cli/main.js`) whose status is 128 + n for a signal n, other than 130, which phax uses itself. In that second case, report the signal as sent through the launcher with its exit status. Every other exit status is a normal exit and is returned as is, whatever it is.
- Failures throw a `BoundedSpawnError` (an Error whose message follows the spec's §6 shape):
  - Bound reached: "bounded spawn: `<command line>` reached its bound (<n> ms) and was ended by it", then a line saying SIGTERM and whether SIGKILL followed, to it and how many descendants, after how many ms.
  - Foreign signal: "bounded spawn: `<command line>` ended by SIGTERM, not by its bound (<n> ms)", plus "sent through tsx: exit status 143" for a relayed status, or a line saying the supervisor itself received the signal.
  - Both then give "stdout (<bytes> bytes):" and "stderr (<bytes> bytes):" with the full text.
  - A supervisor that gives no report, and a command that cannot start, each throw naming the command and what happened.

  The command line shows the args relative to the repository root where they are inside it (`tsx src/cli/main.ts --json-schema`). Expose the child's pid on the error so a test can probe it.
- `expectSignal`: when the child's ending is that signal (directly, or relayed for a CLI spawn), return the signal result instead of throwing. Any other signal still throws.
- Also export `boundedOutput(command, args, options): string`, the bounded counterpart of execFileSync that later phases need. It returns stdout on status 0 and otherwise throws a `BoundedSpawnError` naming the command, the status and stderr.
- Export `CLI_BOUND_MS` (60_000), and `GIT_BOUND_MS` (20_000) only if a test of this phase uses it. `LONG_CLI_BOUND_MS` (85_000) and `SCRIPT_BOUND_MS` (25_000) are exported by the phase that first uses them, which keeps knip green. Export a type only when another file imports it.
- Create `tests/integration/boundedSpawn.test.ts`. It imports nothing from `node:child_process`: children are `process.execPath` with small scripts written to a temporary directory, or the CLI through `CLI_LAUNCHER`/`cliArgs`. Each case writes the pids of everything it starts to files. An `afterAll` probes every recorded pid with `process.kill(pid, 0)` and SIGKILLs any survivor by pid, then fails, so the file never leaves a process behind, even when an assertion fails. The cases are:
  - ac-ignores-sigterm: a child that ignores SIGTERM starts a grandchild that ignores SIGTERM, with a 2000 ms bound. The call throws within bound + grace + a 3 s margin, naming the command, 2000 ms, that the bound ended it, and what the child had written. Neither pid is alive afterwards.
  - ac-cli-hang: put a fake `usage` executable (a node shebang script) first on PATH. It writes its pid and its parent's pid, ignores SIGTERM and never exits. Run `cliArgs("completions", "zsh")` with `env: { ...phaxHomeEnv(), PATH: … }` and a literal 30_000 bound, with a comment saying it is long enough for the CLI to reach its `usage` child under a loaded gate. The call fails naming the command and the bound. The usage, node and tsx processes are all gone (tsx's pid is the error's child pid). Read `src/cli/definitions/completions.ts` and `tests/integration/completions.test.ts` first to confirm the command reaches `usage`.
  - ac-foreign-signal: a child writes a line to stderr, then `process.kill(process.pid, "SIGTERM")`, well within its bound. The error names the command, SIGTERM, 'not by its bound' and the line.
  - ac-relayed-143: a CLI spawn whose env sets `NODE_OPTIONS=--import <file URL of a preload>`. The preload, only when `process.argv[1]` is `src/cli/main.ts` (so not in tsx's own process), writes a line to stderr and sends itself SIGTERM before main.ts installs its handlers. The error names SIGTERM, 'not by its bound', 'exit status 143' and quotes stdout and stderr.
  - ac-expected-signal: with `expectSignal: "SIGINT"`, a child that writes output then SIGINTs itself returns `{ status: null, signal: "SIGINT", stdout, stderr }`.
  - ac-normal-exit: a CLI call refused with exit 64 (an unknown option; `EXIT_CODE_MEANINGS` in `src/cli/commands/runLayers.ts` defines 64) returns status 64 and stderr naming the option. A node child that writes known bytes on both streams and exits 64 returns them exactly.
  - ac-bound-missing at run time: calls with the bound missing (through `as unknown as`), 0, NaN and Infinity each throw, and the marker file the command would have written stays absent.
  - `boundedOutput`: stdout on 0, a throw naming command, status and stderr otherwise.
- Create `tests/type/boundedSpawn.ts` (typechecked by `pnpm test:type`, an entry for knip). It contains a call with every option except `boundMs` under `// @ts-expect-error`, and a well-typed call. Its result has `signal: null` in the type when no `expectSignal` is given.
- Edit `tests/unit/phaxHomeGuard.test.ts` so the CLI-spawn HOME scan keeps working as files move:
  - `SPAWN_CALL` also matches `boundedSpawn(` and `boundedOutput(`.
  - A call whose arguments contain `cliArgs(` names the entry.
  - The list of suites that name the entry also takes files containing `cliArgs(`.
  - Add cases to the 'flags a CLI spawn without a temporary HOME' test: a `boundedSpawn(CLI_LAUNCHER, cliArgs("ls"), { boundMs: CLI_BOUND_MS })` without `env` is flagged, and one with `env: phaxHomeEnv()` passes.
- Measure the per-call overhead and put the numbers in the handoff, for example 50 `git --version` calls through `boundedSpawn` against the same through a plain spawn, run with `pnpm exec tsx` from a throwaway script you do not commit.

### Planned files to create

- `tests/helpers/boundedSpawn.ts`
- `tests/integration/boundedSpawn.test.ts`
- `tests/type/boundedSpawn.ts`

### Planned files to edit

- `tests/unit/phaxHomeGuard.test.ts`

### Optional files that may be edited

- `tests/helpers/isolatePhaxHome.ts`

### Boundary contracts

Producer: `tests/helpers/boundedSpawn.ts`. Consumers: every file under tests/ that starts a child, from phase-02 on.
- `boundedSpawn(command, args, { boundMs, cwd?, env?, input?, expectSignal? })` returns `{ status: number, signal: null, stdout, stderr }`, or `{ status: null, signal, stdout, stderr }` only when `expectSignal` is given.
- `boundedOutput(command, args, options)` returns stdout on status 0.
- Every other ending throws `BoundedSpawnError`.
- `CLI_LAUNCHER` and `cliArgs(...args)` name the CLI.
- Named bounds: `CLI_BOUND_MS` and `GIT_BOUND_MS` here; `LONG_CLI_BOUND_MS` and `SCRIPT_BOUND_MS` added where first used.

The semantic need is strict: a required bound, the group ended by bound + grace, and an error that names what ended the child. The exact option names may adapt.

### Test strategy

- a call to boundedSpawn without boundMs does not type-check, and a well-typed call has signal null in its result type — small · example · @ts-expect-error in tests/type/boundedSpawn.ts under pnpm test:type · in-phase · ac-bound-missing
- a call whose bound is missing, 0, NaN or Infinity, with the type check bypassed, throws before any child starts — medium · boundary · the thrown message, and the marker file the command would write stays absent · in-phase · ac-bound-missing
- a child ignoring SIGTERM, with a grandchild ignoring SIGTERM, fails at its 2000 ms bound within bound plus grace, naming the command, the bound, that the bound ended it, and its output so far, and neither process survives — medium · example · error text, elapsed time, and kill(pid, 0) refusing both recorded pids · in-phase · ac-ignores-sigterm
- a CLI spawn of phax completions whose usage child never answers and ignores SIGTERM fails naming the command and its bound, and leaves no tsx, node or usage process — medium · example · error text and kill(pid, 0) refusing the usage, node and tsx pids · in-phase · ac-cli-hang
- a child that writes a stderr line then SIGTERMs itself fails naming the command, SIGTERM, not by its bound, and the line — medium · example · error text · in-phase · ac-foreign-signal
- a CLI spawn whose node process is SIGTERMed during module load fails naming SIGTERM sent through tsx with exit status 143, not by its bound, quoting stdout and stderr — medium · example · error text · in-phase · ac-relayed-143
- a call expecting SIGINT returns the SIGINT ending and the child's output without throwing — medium · example · the returned result object · in-phase · ac-expected-signal
- a CLI call refused with exit 64 returns status 64 and its stderr, and a child writing known bytes then exiting 64 returns them exactly — medium · example · status 64 and the bytes the child wrote · in-phase · ac-normal-exit
- boundedOutput returns stdout on status 0 and throws naming the command, the status and stderr otherwise — medium · example · returned string and error text · in-phase
- the HOME scan flags a boundedSpawn CLI call without phaxHomeEnv and passes one with it — small · example · unguardedCliSpawns line numbers · in-phase

### Implementation order

1. The bound check and the option and result types, with the type test.
2. The supervisor side (main-module branch): detached start, bound, grace, group kill, report file, its own signal handlers.
3. The library side: call file, spawnSync of the supervisor, reading the report, the ending classification and the error messages.
4. boundedOutput, CLI_LAUNCHER, cliArgs and the bound constants.
5. tests/integration/boundedSpawn.test.ts, case by case, with the afterAll survivor probe.
6. The phaxHomeGuard scan update, then the overhead measurement.

### Excluded scope

- Moving any existing spawn to the bounded spawn (phases 02 and 06 to 10).
- The diagnostic log and the diagnosis block of a foreign-signal error (phase-02).
- The guard against an unbounded spawn (phase-11).
- Any change under src/ and any change to vitest.config.ts.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

- The exported signatures of `tests/helpers/boundedSpawn.ts`, with the option names as built.
- Whether node ran the file as the supervisor through type stripping, as planned.
- The exact failure-message shapes, quoting one of each kind.
- What tsx reports when its node child dies of SIGTERM (status 143, as assumed, or otherwise).
- The measured per-call overhead.
- Which bound constants are exported so far.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`test(spawn): add a bounded spawn that ends a child and its descendants`

### Commit body

Add tests/helpers/boundedSpawn.ts. It is the one way a test starts a child, with a bound required at every call. A supervisor (the same file run by node) starts the command in its own process group. At the bound it sends SIGTERM to the group, then SIGKILL after a 2 s grace, and it reports how the child ended. A normal exit is returned unchanged and an expected signal is returned as a result. Any other ending throws an error naming the command, the bound, the signal, who ended the child, and its output. A CLI status of 128 + n relayed by tsx counts as a signal ending.

Its tests cover a child and grandchild that ignore SIGTERM, a hung CLI spawn, a self-sent SIGTERM, a relayed 143, an expected SIGINT, an exit 64, and a call with no bound, both at type check and at run time. The HOME-isolation scan now recognizes the bounded spawn.

---

## phase-02 — Every CLI-spawning suite through the bounded spawn, with a diagnosis {#phase-02-cli-spawns}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

Every test that spawns the CLI starts it through the bounded spawn, so each CLI spawn's ending is now reported. A foreign-signal error carries a diagnosis block, and the same ending is logged to a file when `PHAX_SPAWN_DIAG_LOG` names one, so whoever sends the stray SIGTERM can be identified.

### Detailed instructions

- Read `tests/helpers/boundedSpawn.ts` (from phase-01) first. Its exports are `boundedSpawn`, `boundedOutput`, `BoundedSpawnError`, `CLI_LAUNCHER`, `cliArgs`, `CLI_BOUND_MS` and possibly `GIT_BOUND_MS`. Each failure throws a `BoundedSpawnError`.
- Add the diagnosis to the bounded spawn. On every ending other than a normal exit, the supervisor captures a snapshot at the moment it sees the ending: `ps -A -o pid,ppid,pgid,stat,lstart,command`, run by the supervisor, which is the bounded spawn itself. The report gains: the caller's pid (the vitest worker), its parent pid and process group, the supervisor's pid, parent and group, the child's pid and group, the ISO moment and ms since the start, and the lines of that snapshot for the worker, its ancestors, its process group and the child's group. Where the platform reports the sending process, record it; otherwise write 'not reported by the platform'.
- The `BoundedSpawnError` message for a foreign signal (child signal, relayed status, or supervisor-signal) gains a `diagnosis:` block after the stdout and stderr lines. The block holds the fields above, so a CI log carries them. A bound ending carries no diagnosis.
- When `process.env.PHAX_SPAWN_DIAG_LOG` names a file, the caller appends one JSON line per non-normal ending, bound endings included, holding the same fields plus the command line, the ending, `process.env.VITEST_POOL_ID` and the test file when vitest exposes it without the helper importing vitest (for example an env variable vitest sets). It does nothing when the variable is unset. Document the variable in the module's doc comment.
- Extend `tests/integration/boundedSpawn.test.ts`: a foreign-signal case's error carries the diagnosis block with the child's pid, and with `PHAX_SPAWN_DIAG_LOG` set the case appends exactly one parseable JSON line holding the signal, the pids and the moment. Set and restore the variable inside the test.
- Move every spawn (CLI, git and any other child) of these 26 suites to `boundedSpawn`/`boundedOutput`, each call stating its constant:
  - tests/integration/artifactStatusJson.test.ts
  - artifactTransitionsJson
  - branchTipWorldCache
  - cliErrors
  - cliRefusedCodes
  - completions
  - groupCommandsJson
  - heldStopCommands
  - inspectionCommandsJson
  - lifecycleCommandsJson
  - lsJsonContracts
  - phaseGuard
  - plansAnswersJson
  - plansEstimateCommand
  - plansInspectionJson
  - plansOverviewCommand
  - protectedPathsConfig
  - recordsBranchSync.acceptance
  - recordsJsonContracts
  - recordsStatusBranch
  - recordsSyncText
  - rootHelp
  - runList
  - stoppedRunCommands
  - usageOutput
  - usageSpecCompleters

  After the move, none of these files imports `node:child_process`.
- Move each file's local wrapper first (`runCli`, `git`, `run`, …): rewrite its body over the bounded spawn and keep its signature where callers rely on it. A CLI call becomes `boundedSpawn(CLI_LAUNCHER, cliArgs(...args), { boundMs: CLI_BOUND_MS, cwd, env: phaxHomeEnv(), … })`, keeping exactly the env and stdin the file gave before. An `execFileSync` call becomes `boundedOutput`, which throws on non-zero as before. A call that drives a whole run (`phax run`/`resume` with fake providers and gates) uses `LONG_CLI_BOUND_MS` (85_000), exported here. A git call uses `GIT_BOUND_MS`, exported here if phase-01 did not export it.
- Where a test passed `timeout` to spawnSync, replace it with the bound. Where a test read `result.signal` or `result.error`, read the bounded result or catch the `BoundedSpawnError` instead. Change no assertion: each test still asserts exactly what it asserted. A test that expects a signal states `expectSignal`.
- Before editing a file, read its entries in `lint-baseline.json` and keep each line that carries an accepted diagnostic, so no count drops.
- Run `pnpm test:integration` on the moved files (`pnpm test <files>` through the gate) and `pnpm test:type` before committing. Every moved suite must pass unchanged, and `tests/unit/phaxHomeGuard.test.ts` must still find more than five suites and flag none.

### Planned files to create

- (none)

### Planned files to edit

- `tests/helpers/boundedSpawn.ts`
- `tests/integration/boundedSpawn.test.ts`
- `tests/integration/artifactStatusJson.test.ts`
- `tests/integration/artifactTransitionsJson.test.ts`
- `tests/integration/branchTipWorldCache.test.ts`
- `tests/integration/cliErrors.test.ts`
- `tests/integration/cliRefusedCodes.test.ts`
- `tests/integration/completions.test.ts`
- `tests/integration/groupCommandsJson.test.ts`
- `tests/integration/heldStopCommands.test.ts`
- `tests/integration/inspectionCommandsJson.test.ts`
- `tests/integration/lifecycleCommandsJson.test.ts`
- `tests/integration/lsJsonContracts.test.ts`
- `tests/integration/phaseGuard.test.ts`
- `tests/integration/plansAnswersJson.test.ts`
- `tests/integration/plansEstimateCommand.test.ts`
- `tests/integration/plansInspectionJson.test.ts`
- `tests/integration/plansOverviewCommand.test.ts`
- `tests/integration/protectedPathsConfig.test.ts`
- `tests/integration/recordsBranchSync.acceptance.test.ts`
- `tests/integration/recordsJsonContracts.test.ts`
- `tests/integration/recordsStatusBranch.test.ts`
- `tests/integration/recordsSyncText.test.ts`
- `tests/integration/rootHelp.test.ts`
- `tests/integration/runList.test.ts`
- `tests/integration/stoppedRunCommands.test.ts`
- `tests/integration/usageOutput.test.ts`
- `tests/integration/usageSpecCompleters.test.ts`

### Optional files that may be edited

- `tests/unit/phaxHomeGuard.test.ts`
- `tests/helpers/isolatePhaxHome.ts`

### Boundary contracts

Producer: the bounded spawn. Consumers: the 26 suites, and the operator or phase-04, who read the diagnosis.
- Contract added: a foreign-signal `BoundedSpawnError` message ends with a `diagnosis:` block (worker, supervisor and child pids, parents and groups, the moment, the related ps lines).
- `PHAX_SPAWN_DIAG_LOG` names a JSONL file that gets one line per non-normal ending.
- The suites keep their own wrappers' signatures.

### Test strategy

- a foreign-signal error carries the diagnosis block, and with PHAX_SPAWN_DIAG_LOG set one parseable line per ending is appended — medium · example · error text and the parsed JSON line's signal, pids and moment · in-phase
- every moved CLI-spawning suite passes with its assertions unchanged — medium · smoke · the suites' own assertions under the gate · in-phase
- the HOME scan still finds the moved CLI spawns and flags none — small · example · tests/unit/phaxHomeGuard.test.ts · in-phase

### Implementation order

1. The diagnosis in the supervisor's report and in the error message, then the diagnostic log, with their tests.
2. The four suites the kills hit or that hung (recordsJsonContracts, plansAnswersJson, phaseGuard, usageSpecCompleters, groupCommandsJson), then the remaining 21 suites, each wrapper first.

### Excluded scope

- Running the full suite repeatedly or naming the sender (phase-04).
- Spawns in tests/helpers, tests/fixtures and the other integration, unit and e2e files (phases 06 to 10).
- Any change under src/.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

- The diagnosis block's fields as built, quoting one example.
- How the test file is identified in a log line.
- Whether the platform reports the sending process on macOS.
- The moved suites, and for each one any call that needed `expectSignal`, a literal bound, or `LONG_CLI_BOUND_MS`.
- The bound constants exported so far.
- Any lint-baseline line kept on purpose.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`test(spawn): move the CLI-spawning suites to the bounded spawn, with a diagnosis`

### Commit body

Every test that spawns the CLI now goes through boundedSpawn, with a bound stated at each call, so each CLI spawn reports how it ended. A foreign-signal error carries a diagnosis block: the worker, supervisor and child pids, their parents and process groups, the moment, and the related process snapshot. With PHAX_SPAWN_DIAG_LOG set, each non-normal ending is also appended to a JSONL log, ready for the reproduction of the stray SIGTERM. No assertion changes.

---

## phase-03 — Review the bounded spawn and the migration pattern {#phase-03-review-pattern}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium
**Mode:** interactive

The run stops so the operator can review the bounded spawn and how the CLI-spawning suites moved to it, before the reproduction and the move of about 140 more files repeat that pattern.

### Detailed instructions

- This phase plans no file. The person reviews, and may correct the files listed as optional.
- What to review in `tests/helpers/boundedSpawn.ts`:
  - the call shape and option names;
  - the failure messages against the spec's §6;
  - how a CLI status of 128 + n is read;
  - the diagnosis block;
  - the bound constants (`CLI_BOUND_MS`, `GIT_BOUND_MS`, `LONG_CLI_BOUND_MS`);
  - the measured per-call overhead in phase-01's handoff.
- The pattern at stake is how a file's local wrapper (`runCli`, `git`, `run`) is rewritten over `boundedSpawn`/`boundedOutput`: which constant each kind of call states, how an execFileSync call maps to `boundedOutput`, and how stdin and env are carried. phases 06, 07, 08, 09 and 10 repeat it over every other file under tests/, so a correction here saves it being repeated about 140 times.
- Also check that the 26 moved suites changed no assertion and that `tests/unit/phaxHomeGuard.test.ts` still guards their CLI spawns.

### Planned files to create

- (none)

### Planned files to edit

- (none)

### Optional files that may be edited

- `tests/helpers/boundedSpawn.ts`
- `tests/integration/boundedSpawn.test.ts`
- `tests/type/boundedSpawn.ts`
- `tests/unit/phaxHomeGuard.test.ts`
- `tests/integration/recordsJsonContracts.test.ts`
- `tests/integration/plansAnswersJson.test.ts`
- `tests/integration/phaseGuard.test.ts`

### Test strategy

- (none)

### Implementation order

1. Read phase-01's and phase-02's handoffs.
2. Review the helper, then two or three moved suites.
3. Correct the optional files if needed.

### Excluded scope

- Moving further files, or starting the reproduction.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

- What the reviewer changed, and the rule it sets for the later migration phases (a constant, a mapping, a message).
- Or 'no change' when the pattern stands.

### Commit subject

`test(spawn): review corrections to the bounded spawn pattern`

### Commit body

Corrections from the review of the bounded spawn and of the first suites moved to it, before the remaining test files repeat the pattern.

---

## phase-04 — Reproduce the stray SIGTERM and name its sender {#phase-04-name-sender}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high
**Assignment reason:** This is an investigation whose value is judgment: reading signal paths across vitest, tsx and phax's adapters, and naming a cause from sparse evidence.

A reproduction under the full suite on macOS logs every CLI spawn ended by a signal (its signal, its parent, the sender where the platform reports it, and the moment), and a findings document names the sender from that evidence or records why it could not.

### Detailed instructions

- Create `spikes/bounded-test-spawns/repro.mjs`, a plain Node script with no dependency, run as `node spikes/bounded-test-spawns/repro.mjs [--runs N] [--load gate|none] [--max-workers N]`. For each run it:
  - starts `node_modules/.bin/vitest run` with `node_modules/.bin` prepended to PATH, as pnpm does, because without it every test that spawns `tsx` fails;
  - sets `PHAX_SPAWN_DIAG_LOG` to a per-run file under a temporary directory;
  - passes `--reporter=json --outputFile=<per-run file>`;
  - records the run's duration, exit code and failed tests.

  With `--load gate` it first runs the standard profile's every-phase local steps in the gate's order (format check, typecheck, test:type, lint) from `node_modules/.bin`, so the machine is in the state a gate leaves it in. It prints a summary: runs, failures, and every non-normal ending from the diagnostic logs.
- Before running anything, read the candidates from the spec's §10 and rule each in or out from the code:
  - vitest tearing a worker down (vitest 5.1's default pool; how it ends a worker and whether it signals the worker's process group);
  - tsx relaying a signal (how tsx forwards SIGTERM and SIGINT and what it exits with);
  - phax's interrupt handler (`src/cli/interruptHandler.ts`, installed after main.ts's imports load);
  - the shell adapter's and provider adapters' timeout, grace timer and 'exit' hook (`src/infra/shell.ts`, `src/infra/providers/claudeCode.ts`, `src/infra/providers/mistralVibe.ts`), including a kill reaching a reused pid;
  - a test cleanup that kills by a pid read from a file (`tests/integration/nodeShell.test.ts`);
  - the fake provider that signals itself (`tests/helpers/fakeProviderCli.ts`);
  - anything that calls `process.kill` with 0, a negative pid, or a pid it did not start.

  Use `git grep` and `git log` for the history of each.
- Run the reproduction: `--runs 20 --load gate`, run in the background and polled. Stop early once three foreign-signal endings of a CLI spawn are logged. If none appears, raise the pressure within the same budget (for example `--max-workers` above the default, or two suites in parallel) and say so. A run that passes changes nothing; a run that fails on a foreign signal is the evidence.
- A supervisor-signal ending (the supervisor received the signal and the child's group did not) means the sender signalled the worker's process group or the supervisor. A child-signal or relayed-143 ending means it targeted the child. Use the ps snapshot and the moments of other endings in the same run to identify which process sent it.
- Create `spikes/bounded-test-spawns/findings.md` with these sections:
  - Candidates: each one ruled in or out, with the code it rests on.
  - Reproduction: the command, the runs, load, durations and failures.
  - Logged endings: the diagnostic log lines, quoted.
  - Sender: named, with the evidence; or 'not reproduced on macOS', with what was tried.
  - Fix direction: phax code, test code, or upstream (vitest or tsx), and the path to stop. For an upstream sender, include the draft text of the upstream issue for the operator to file or link.
  - CI (to fill at review): left for the operator to paste the pull request CI's diagnosis blocks.
- Do not fix anything in this phase. Change `tests/helpers/boundedSpawn.ts` only if the diagnosis lacks a field the reproduction needs, and say so in the handoff.

### Planned files to create

- `spikes/bounded-test-spawns/repro.mjs`
- `spikes/bounded-test-spawns/findings.md`

### Planned files to edit

- (none)

### Optional files that may be edited

- `tests/helpers/boundedSpawn.ts`
- `tests/integration/boundedSpawn.test.ts`

### Test strategy

- under repeated full suites on macOS, each CLI spawn ended by a signal is logged with its signal, parent, the sender where reported, and its moment, and findings.md names the sender from those lines — large · smoke · the diagnostic log lines quoted in spikes/bounded-test-spawns/findings.md, completed with the pull request CI's at review · in-phase · ac-sender-named

### Implementation order

1. Rule the candidates in or out from the code.
2. Write repro.mjs and check it on one run.
3. Run the reproduction, raising the pressure if needed.
4. Write findings.md from the evidence.

### Excluded scope

- Fixing the sender (phase-05).
- Changing CI workflows (protected) or vitest.config.ts (protected).
- Filing an upstream issue: the operator does it at review.

### Verification

The `standard` gate profile in phax.json. The gate checks the script's lint and format only. The real signal is in findings.md.

### Expected handoff content

- The sender: named with the log lines that show it, or 'not reproduced on macOS' with the runs, load and pressure tried.
- The candidates ruled out.
- The fix direction (phax code, test code, or upstream) and the exact file and path phase-05 should change.
- For an upstream sender, where the draft issue text sits.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`test(spawn): reproduce the stray SIGTERM and record who sends it`

### Commit body

Add spikes/bounded-test-spawns/repro.mjs. It runs the full suite repeatedly under the gate's load with the bounded spawn's diagnostic log on. Also add findings.md, which rules each candidate sender in or out from the code and names the sender from the logged endings, or records why macOS did not reproduce the kill. The CI half is read on the pull request at review.

---

## phase-05 — Stop the sender where it lies {#phase-05-fix-sender}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high
**Assignment reason:** Where the fix lands is unknown until phase-04's findings, and it may cross src/infra adapters, the CLI entry and test helpers, so the phase designs a fix with no prior pattern.

Whatever sent the stray SIGTERM no longer reaches a process it did not start. A phax or test sender is fixed in its code, under a regression test that fails on the code from before. An upstream sender is avoided by the suite and its issue is drafted. If no sender was named, the open state is recorded honestly.

### Detailed instructions

- Read `spikes/bounded-test-spawns/findings.md` and phase-04's handoff first. Act on the branch it establishes.
- Sender in phax code (for example an adapter's grace timer or exit hook reaching a reused pid) or in test code (for example a cleanup that kills by a pid read from a file): change that code so it never sends a signal to a process it did not start, for example by tracking the ChildProcess it started and signalling only while it is alive. Do not change phax's exit codes or the interrupt handler's behaviour unless the findings put the cause there.
- In that case, create `tests/integration/strayTermRegression.test.ts`. It drives the path through which the sender reached the CLI spawn and asserts that no signal reaches a process the sender did not start, using the bounded spawn for any child. Prove it fails on the code from before the fix: stash the fix, run the test, restore. Put the failing output in the handoff. The test leaves no process running after its file, even when an assertion fails.
- Sender upstream (vitest or tsx): make the suite stop taking the path that makes it send. For tsx, that is a launcher change in one place, `CLI_LAUNCHER` and `cliArgs` in `tests/helpers/boundedSpawn.ts` (for example node with tsx's loader, so no relaying launcher stands between). Update the moved suites only if their calls need it. For vitest, change only test-side code, since `vitest.config.ts` is protected. Write a regression test as above where the path can be driven. Complete the draft upstream issue in findings.md. Do not file it: the operator files or links it at review.
- No sender named: change nothing under src/ and write no regression test. Record in findings.md and in the handoff that ac-sender-named and ac-sender-stopped (or ac-upstream-avoided) stay open for the pull request's CI. The diagnosis block names the sender at the next kill.
- In every case, add a 'Fix' section to findings.md: what changed, where, and why that is where the cause lies. Then run the reproduction once more (`node spikes/bounded-test-spawns/repro.mjs --runs 3 --load gate`) and quote its summary.

### Planned files to create

- `tests/integration/strayTermRegression.test.ts`

### Planned files to edit

- `spikes/bounded-test-spawns/findings.md`

### Optional files that may be edited

- `src/infra/shell.ts`
- `src/infra/providers/claudeCode.ts`
- `src/infra/providers/mistralVibe.ts`
- `src/cli/main.ts`
- `src/cli/interruptHandler.ts`
- `tests/helpers/boundedSpawn.ts`
- `tests/integration/boundedSpawn.test.ts`
- `tests/integration/nodeShell.test.ts`
- `tests/helpers/fakeProviderCli.ts`
- `tests/setup/phaxHomeGuard.ts`
- `tests/setup/providerStores.ts`
- `tests/unit/phaxHomeGuard.test.ts`
- `tests/integration/recordsJsonContracts.test.ts`
- `tests/integration/plansAnswersJson.test.ts`
- `tests/integration/phaseGuard.test.ts`
- `tests/unit/shell.test.ts`

### Boundary contracts

If the fix lands in an adapter under src/infra/, it keeps the Shell port's contract (`src/ports/shell.ts`): a timed-out command still fails its call, and a child that ignores SIGTERM still never outlives the CLI. Only the target of the signal changes.

### Test strategy

- the path through which the sender reached the CLI spawn no longer sends a signal to a process the sender did not start, and the regression test fails on the code from before the fix — medium · example · the regression test's assertion, failing on the stashed pre-fix code and passing after, quoted in the handoff · in-phase · ac-sender-stopped
- an upstream sender's path is no longer taken by the suite, and its issue is drafted for the operator to file — large · smoke · the reproduction's summary after the change and the issue text in findings.md · in-phase · ac-upstream-avoided

### Implementation order

1. Read the findings and pick the branch.
2. Write the regression test against the current code and see it fail.
3. Fix at the cause and see the test pass.
4. Update findings.md and rerun the reproduction.

### Excluded scope

- Moving the remaining spawns (phases 06 to 10).
- A wall-clock limit on gate steps (a separate spec, q-gate-bound).
- Any change in phax beyond the named cause.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

- Which branch was taken (phax code, test code, upstream, or unnamed).
- The files changed and why the cause lies there.
- The regression test's failing output on the pre-fix code.
- For upstream: the launcher or path change, and where the issue draft sits.
- The short reproduction's summary.
- Which criteria stay open for review.
- Any deviation from the planned file lists. If no regression test was written, say that `tests/integration/strayTermRegression.test.ts` was not created, and why.

### Commit subject

`fix(spawns): act on the stray SIGTERM's sender where it lies`

### Commit body

Act on the sender named in spikes/bounded-test-spawns/findings.md. Code that signalled a process it did not start now signals only its own, under a regression test that fails on the code from before. An upstream path is avoided by the suite, with the issue drafted. If no sender was reproduced, the open state is recorded for the pull request's CI. The findings record the fix and a short reproduction after it.

---

## phase-06 — Shared test wrappers through the bounded spawn {#phase-06-shared-helpers}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

Every shared helper and fixture under tests/ that starts a child (git repos, fixture worlds, run harnesses, the release-notes repo) does so through the bounded spawn, so most of the remaining calls in test files are bounded before those files move.

### Detailed instructions

- Read `tests/helpers/boundedSpawn.ts` and phase-03's handoff (the review's rules for the pattern) first.
- Move every spawn in:
  - tests/helpers/tempGit.ts
  - tests/helpers/reviseHarness.ts
  - tests/helpers/projectOnlyHarness.ts
  - tests/helpers/heldRunFixture.ts
  - tests/helpers/decideVerdictsHarness.ts
  - tests/helpers/stoppedRunFixture.ts
  - tests/fixtures/artifact/stdinDocumentsRepo.ts
  - tests/fixtures/codeLink/linkedProject.ts
  - tests/fixtures/codeLink/linkedRun.ts
  - tests/fixtures/findings/fateRunRepo.ts
  - tests/fixtures/findings/findingRunRepo.ts
  - tests/fixtures/findings/prRunRepo.ts
  - tests/fixtures/records/branchTipRepos.ts
  - tests/fixtures/records/bulkRecords.ts
  - tests/fixtures/records/jsonContractsRepo.ts
  - tests/fixtures/run/runCommandsRepo.ts
  - tests/integration/helpers/preflightRepo.ts
  - tests/unit/releaseNotes/repo.ts

  After the move, none of them imports `node:child_process`.
- Keep every exported function's signature and behaviour, so no caller changes. An `execFileSync` call becomes `boundedOutput`, which also throws on non-zero. A git call states `GIT_BOUND_MS`, a CLI call `CLI_BOUND_MS` or `LONG_CLI_BOUND_MS`, and any other tool `SCRIPT_BOUND_MS` (25_000), exported here if this is its first use. A call that needs another bound states a literal with a one-line reason.
- `tests/fixtures/records/bulkRecords.ts` runs `git fast-import` through an async `spawn`. Its stream is a fully built Buffer, so pass it as `input` to a synchronous bounded call. Keep `writeRecordsInBulk` async-returning for its callers, and keep the error text naming the exit code and stderr.
- Keep `GIT_TRACE` parsing, `stdio` choices and env exactly as they were; only the spawn mechanism changes.
- Before editing a file, read its entries in `lint-baseline.json` and keep each line that carries an accepted diagnostic.
- Run the integration and unit suites that use these helpers (`pnpm test:integration`, `pnpm test:unit`) before committing.

### Planned files to create

- (none)

### Planned files to edit

- `tests/helpers/tempGit.ts`
- `tests/helpers/reviseHarness.ts`
- `tests/helpers/projectOnlyHarness.ts`
- `tests/helpers/heldRunFixture.ts`
- `tests/helpers/decideVerdictsHarness.ts`
- `tests/helpers/stoppedRunFixture.ts`
- `tests/fixtures/artifact/stdinDocumentsRepo.ts`
- `tests/fixtures/codeLink/linkedProject.ts`
- `tests/fixtures/codeLink/linkedRun.ts`
- `tests/fixtures/findings/fateRunRepo.ts`
- `tests/fixtures/findings/findingRunRepo.ts`
- `tests/fixtures/findings/prRunRepo.ts`
- `tests/fixtures/records/branchTipRepos.ts`
- `tests/fixtures/records/bulkRecords.ts`
- `tests/fixtures/records/jsonContractsRepo.ts`
- `tests/fixtures/run/runCommandsRepo.ts`
- `tests/integration/helpers/preflightRepo.ts`
- `tests/unit/releaseNotes/repo.ts`

### Optional files that may be edited

- `tests/helpers/boundedSpawn.ts`

### Boundary contracts

Producer: the shared helpers and fixtures. Consumers: the integration and unit suites that import them. Their exported signatures and behaviour stay the same, including which calls throw on a non-zero exit. Only the spawn underneath becomes bounded.

### Test strategy

- every suite that uses these helpers and fixtures passes with its assertions unchanged — medium · smoke · the suites' own assertions under the gate · in-phase
- no file this phase moves imports node:child_process — small · example · git grep over the moved files, quoted in the handoff · in-phase · ac-all-moved

### Implementation order

1. tests/helpers/tempGit.ts and the git wrappers the fixtures share.
2. The fixtures, then the harnesses, then bulkRecords.ts.

### Excluded scope

- Moving spawns in the test files themselves (phases 07 to 10).
- Changing a helper's exported signature.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

- The files moved.
- Any helper whose behaviour needed care (bulkRecords' input, a stdio choice, a literal bound), with its reason.
- The bound constants exported so far.
- Any lint-baseline line kept on purpose.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`test(spawn): move the shared test helpers and fixtures to the bounded spawn`

### Commit body

The helpers and fixtures that build git repos, fixture worlds and run harnesses now start every child through boundedSpawn or boundedOutput, with a bound stated at each call. Their signatures do not change, so the suites that use them are already bounded wherever they go through them.

---

## phase-07 — Integration suites a to f through the bounded spawn {#phase-07-integration-a-to-f}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

The integration suites from approvalAttribution to findingSettleRuns that phase-02 did not move start every child through the bounded spawn.

### Detailed instructions

- Read `tests/helpers/boundedSpawn.ts` and phase-03's handoff (the review's rules for the pattern) first. A file's local wrapper (`git`, `run`, `runCli`) moves first, with its signature kept: an `execFileSync` call becomes `boundedOutput`, and a `spawnSync` call becomes `boundedSpawn`. Every call states its named bound: `GIT_BOUND_MS`, `CLI_BOUND_MS`, `LONG_CLI_BOUND_MS` or `SCRIPT_BOUND_MS`, or a literal with a one-line reason. A CLI call uses `CLI_LAUNCHER`/`cliArgs` with `env: phaxHomeEnv()`.
- Move every spawn in these 32 files, each under tests/integration/:
  - approvalAttribution
  - approvalLedgerRefusal
  - approvalLock
  - approvalRecordCode
  - approvalRecordGround
  - approvalRecordMerge
  - architectureCommand
  - artifactNewHeadlessCommand
  - artifactQuestionsStatus
  - artifactReopen
  - briefCommand
  - codeLinkApproval
  - codeLinkConfig
  - codeReviewRecord
  - completeRunArtifacts
  - complianceReviewRecord
  - decideArtifact
  - decideHandAuthored
  - decideLifecycle
  - declaredStop
  - declaredStopClose
  - declaredStopProviderArgv
  - declaredStopRun
  - docsCliDrift
  - documentMigrationRefusal
  - exampleProviders
  - findingFateRecords
  - findingFixPaths
  - findingPost
  - findingPullRequestLocal
  - findingSettle
  - findingSettleRuns

  After the move, none imports `node:child_process`.
- Change no assertion. Where a test read `result.signal`, `result.error` or passed `timeout`, use the bounded result, catch `BoundedSpawnError`, or state `expectSignal`. Keep env, cwd, stdin and stdio exactly as they were.
- Before editing a file, read its entries in `lint-baseline.json` and keep each line that carries an accepted diagnostic.
- Run `pnpm test:integration` before committing.

### Planned files to create

- (none)

### Planned files to edit

- `tests/integration/approvalAttribution.test.ts`
- `tests/integration/approvalLedgerRefusal.test.ts`
- `tests/integration/approvalLock.test.ts`
- `tests/integration/approvalRecordCode.test.ts`
- `tests/integration/approvalRecordGround.test.ts`
- `tests/integration/approvalRecordMerge.test.ts`
- `tests/integration/architectureCommand.test.ts`
- `tests/integration/artifactNewHeadlessCommand.test.ts`
- `tests/integration/artifactQuestionsStatus.test.ts`
- `tests/integration/artifactReopen.test.ts`
- `tests/integration/briefCommand.test.ts`
- `tests/integration/codeLinkApproval.test.ts`
- `tests/integration/codeLinkConfig.test.ts`
- `tests/integration/codeReviewRecord.test.ts`
- `tests/integration/completeRunArtifacts.test.ts`
- `tests/integration/complianceReviewRecord.test.ts`
- `tests/integration/decideArtifact.test.ts`
- `tests/integration/decideHandAuthored.test.ts`
- `tests/integration/decideLifecycle.test.ts`
- `tests/integration/declaredStop.test.ts`
- `tests/integration/declaredStopClose.test.ts`
- `tests/integration/declaredStopProviderArgv.test.ts`
- `tests/integration/declaredStopRun.test.ts`
- `tests/integration/docsCliDrift.test.ts`
- `tests/integration/documentMigrationRefusal.test.ts`
- `tests/integration/exampleProviders.test.ts`
- `tests/integration/findingFateRecords.test.ts`
- `tests/integration/findingFixPaths.test.ts`
- `tests/integration/findingPost.test.ts`
- `tests/integration/findingPullRequestLocal.test.ts`
- `tests/integration/findingSettle.test.ts`
- `tests/integration/findingSettleRuns.test.ts`

### Optional files that may be edited

- `tests/helpers/boundedSpawn.ts`

### Test strategy

- every moved suite passes with its assertions unchanged — medium · smoke · the suites' own assertions under the gate · in-phase
- no file this phase moves imports node:child_process — small · example · git grep over the moved files, quoted in the handoff · in-phase · ac-all-moved

### Implementation order

1. Each file's local wrapper, then its remaining direct calls, file by file in alphabetical order.

### Excluded scope

- Integration files from gates onward (phases 08 and 09), and the 26 suites phase-02 moved.
- The guard (phase-11).

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

- The files moved.
- Any call that needed `expectSignal`, a literal bound or another constant, with its reason.
- Any lint-baseline line kept on purpose.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`test(spawn): move integration suites a to f to the bounded spawn`

### Commit body

The integration suites from approvalAttribution to findingSettleRuns now start every child through boundedSpawn or boundedOutput, with a bound stated at each call. No assertion changes.

---

## phase-08 — Integration suites g to p through the bounded spawn {#phase-08-integration-g-to-p}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

The integration suites from gates to protectedPathsNativeRules that phase-02 did not move start every child through the bounded spawn.

### Detailed instructions

- Read `tests/helpers/boundedSpawn.ts` and phase-03's handoff (the review's rules for the pattern) first. A file's local wrapper (`git`, `gitIn`, `run`) moves first, with its signature kept: an `execFileSync` call becomes `boundedOutput`, and a `spawnSync` call becomes `boundedSpawn`. Every call states its named bound: `GIT_BOUND_MS`, `CLI_BOUND_MS`, `LONG_CLI_BOUND_MS` or `SCRIPT_BOUND_MS`, or a literal with a one-line reason. A CLI call uses `CLI_LAUNCHER`/`cliArgs` with `env: phaxHomeEnv()`.
- Move every spawn in these 32 files, each under tests/integration/:
  - gates
  - gitAuthorIdentity
  - gitBaseline
  - gitBlobSizes
  - gitCodeLinkContract
  - gitCommitChangedPathsContract
  - gitCommitPaths
  - gitCommitTree
  - gitCommitterName
  - gitDiffNameStatus
  - gitDiffNoIndex
  - gitObjectPlumbing
  - gitPruneQueries
  - gitRecordsBranchContract
  - gitWorktreeSnapshot
  - holdConfigRefused
  - isolateGit
  - linkedRun
  - linkedRunInPhase
  - loadConfigLayers
  - migrateApprovals
  - migrateDocuments
  - networkPause
  - nodeShell
  - partialCommandsConfig
  - perPhaseBranch
  - planLink
  - projectOnlyLaunch
  - protectedPathsAdditive
  - protectedPathsCheck
  - protectedPathsGate
  - protectedPathsNativeRules

  After the move, none imports `node:child_process`.
- `tests/integration/nodeShell.test.ts` starts `tsx -e` scripts that drive the shell adapter, whose children ignore SIGTERM. Move its `spawnSync("tsx", …)` to `boundedSpawn` with `SCRIPT_BOUND_MS` or a literal with its reason. Keep what it asserts about the adapter. If phase-05 already changed its pid-file cleanup, keep that change.
- Change no assertion. Where a test read `result.signal`, `result.error` or passed `timeout`, use the bounded result, catch `BoundedSpawnError`, or state `expectSignal`. Keep env, cwd, stdin and stdio exactly as they were.
- Before editing a file, read its entries in `lint-baseline.json` and keep each line that carries an accepted diagnostic.
- Run `pnpm test:integration` before committing.

### Planned files to create

- (none)

### Planned files to edit

- `tests/integration/gates.test.ts`
- `tests/integration/gitAuthorIdentity.test.ts`
- `tests/integration/gitBaseline.test.ts`
- `tests/integration/gitBlobSizes.test.ts`
- `tests/integration/gitCodeLinkContract.test.ts`
- `tests/integration/gitCommitChangedPathsContract.test.ts`
- `tests/integration/gitCommitPaths.test.ts`
- `tests/integration/gitCommitTree.test.ts`
- `tests/integration/gitCommitterName.test.ts`
- `tests/integration/gitDiffNameStatus.test.ts`
- `tests/integration/gitDiffNoIndex.test.ts`
- `tests/integration/gitObjectPlumbing.test.ts`
- `tests/integration/gitPruneQueries.test.ts`
- `tests/integration/gitRecordsBranchContract.test.ts`
- `tests/integration/gitWorktreeSnapshot.test.ts`
- `tests/integration/holdConfigRefused.test.ts`
- `tests/integration/isolateGit.test.ts`
- `tests/integration/linkedRun.test.ts`
- `tests/integration/linkedRunInPhase.test.ts`
- `tests/integration/loadConfigLayers.test.ts`
- `tests/integration/migrateApprovals.test.ts`
- `tests/integration/migrateDocuments.test.ts`
- `tests/integration/networkPause.test.ts`
- `tests/integration/nodeShell.test.ts`
- `tests/integration/partialCommandsConfig.test.ts`
- `tests/integration/perPhaseBranch.test.ts`
- `tests/integration/planLink.test.ts`
- `tests/integration/projectOnlyLaunch.test.ts`
- `tests/integration/protectedPathsAdditive.test.ts`
- `tests/integration/protectedPathsCheck.test.ts`
- `tests/integration/protectedPathsGate.test.ts`
- `tests/integration/protectedPathsNativeRules.test.ts`

### Optional files that may be edited

- `tests/helpers/boundedSpawn.ts`

### Test strategy

- every moved suite passes with its assertions unchanged — medium · smoke · the suites' own assertions under the gate · in-phase
- no file this phase moves imports node:child_process — small · example · git grep over the moved files, quoted in the handoff · in-phase · ac-all-moved

### Implementation order

1. Each file's local wrapper, then its remaining direct calls, file by file in alphabetical order; nodeShell.test.ts last.

### Excluded scope

- Integration files before gates (phase-07) or after protectedPathsNativeRules (phase-09), and the 26 suites phase-02 moved.
- The guard (phase-11).

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

- The files moved.
- How nodeShell.test.ts was moved.
- Any call that needed `expectSignal`, a literal bound or another constant, with its reason.
- Any lint-baseline line kept on purpose.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`test(spawn): move integration suites g to p to the bounded spawn`

### Commit body

The integration suites from gates to protectedPathsNativeRules now start every child through boundedSpawn or boundedOutput, with a bound stated at each call. No assertion changes.

---

## phase-09 — Integration suites r to w through the bounded spawn {#phase-09-integration-r-to-w}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

The integration suites from recordsExplain to writeRevisionRecord that phase-02 did not move start every child through the bounded spawn, which leaves no unbounded spawn in tests/integration.

### Detailed instructions

- Read `tests/helpers/boundedSpawn.ts` and phase-03's handoff (the review's rules for the pattern) first. A file's local wrapper (`git`, `run`, `runCli`) moves first, with its signature kept: an `execFileSync` call becomes `boundedOutput`, and a `spawnSync` call becomes `boundedSpawn`. Every call states its named bound: `GIT_BOUND_MS`, `CLI_BOUND_MS`, `LONG_CLI_BOUND_MS` or `SCRIPT_BOUND_MS`, or a literal with a one-line reason. A CLI call uses `CLI_LAUNCHER`/`cliArgs` with `env: phaxHomeEnv()`.
- Move every spawn in these 30 files, each under tests/integration/:
  - recordsExplain
  - recordsExplainStop
  - recordsPush
  - recordsSync
  - recordsWriteParent
  - repoRootedCli
  - resumeHandoff
  - reviewCommandsJson
  - reviewHandoffCommand
  - runReviews
  - sessionHandoversJson
  - specSurfaceSummary
  - stopTranscripts
  - structuredAnswerFlags
  - structuredOutputRead
  - summaryPlaceholderRefusal
  - usageParity
  - usageSpecLint
  - userConfigRecord
  - vibeFreshStartNote
  - vibeHomeUntouched
  - vibeModelRecords
  - vitestAcceptanceExample
  - worldCache
  - worldCacheCleanupProbe
  - writeAuthoringRecord
  - writeDecisionRecord
  - writeRecord
  - writeReviewRecord
  - writeRevisionRecord

  After the move, none imports `node:child_process`.
- Change no assertion. Where a test read `result.signal`, `result.error` or passed `timeout`, use the bounded result, catch `BoundedSpawnError`, or state `expectSignal`. Keep env, cwd, stdin and stdio exactly as they were.
- When done, `git grep -l "node:child_process" -- tests/integration` lists nothing. Quote it in the handoff.
- Before editing a file, read its entries in `lint-baseline.json` and keep each line that carries an accepted diagnostic.
- Run `pnpm test:integration` before committing.

### Planned files to create

- (none)

### Planned files to edit

- `tests/integration/recordsExplain.test.ts`
- `tests/integration/recordsExplainStop.test.ts`
- `tests/integration/recordsPush.test.ts`
- `tests/integration/recordsSync.test.ts`
- `tests/integration/recordsWriteParent.test.ts`
- `tests/integration/repoRootedCli.test.ts`
- `tests/integration/resumeHandoff.test.ts`
- `tests/integration/reviewCommandsJson.test.ts`
- `tests/integration/reviewHandoffCommand.test.ts`
- `tests/integration/runReviews.test.ts`
- `tests/integration/sessionHandoversJson.test.ts`
- `tests/integration/specSurfaceSummary.test.ts`
- `tests/integration/stopTranscripts.test.ts`
- `tests/integration/structuredAnswerFlags.test.ts`
- `tests/integration/structuredOutputRead.test.ts`
- `tests/integration/summaryPlaceholderRefusal.test.ts`
- `tests/integration/usageParity.test.ts`
- `tests/integration/usageSpecLint.test.ts`
- `tests/integration/userConfigRecord.test.ts`
- `tests/integration/vibeFreshStartNote.test.ts`
- `tests/integration/vibeHomeUntouched.test.ts`
- `tests/integration/vibeModelRecords.test.ts`
- `tests/integration/vitestAcceptanceExample.test.ts`
- `tests/integration/worldCache.test.ts`
- `tests/integration/worldCacheCleanupProbe.test.ts`
- `tests/integration/writeAuthoringRecord.test.ts`
- `tests/integration/writeDecisionRecord.test.ts`
- `tests/integration/writeRecord.test.ts`
- `tests/integration/writeReviewRecord.test.ts`
- `tests/integration/writeRevisionRecord.test.ts`

### Optional files that may be edited

- `tests/helpers/boundedSpawn.ts`

### Test strategy

- every moved suite passes with its assertions unchanged — medium · smoke · the suites' own assertions under the gate · in-phase
- no file under tests/integration imports node:child_process — small · example · git grep -l node:child_process over tests/integration, empty, quoted in the handoff · in-phase · ac-all-moved

### Implementation order

1. Each file's local wrapper, then its remaining direct calls, file by file in alphabetical order.

### Excluded scope

- tests/unit and tests/e2e (phase-10).
- The guard (phase-11).

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

- The files moved.
- The empty `git grep` over tests/integration.
- Any call that needed `expectSignal`, a literal bound or another constant, with its reason.
- Any lint-baseline line kept on purpose.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`test(spawn): move integration suites r to w to the bounded spawn`

### Commit body

The integration suites from recordsExplain to writeRevisionRecord now start every child through boundedSpawn or boundedOutput, with a bound stated at each call. No unbounded spawn is left under tests/integration, and no assertion changes.

---

## phase-10 — Unit and e2e tests through the bounded spawn {#phase-10-unit-and-e-two-e}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

The unit tests and the e2e tier start every child through the bounded spawn. The e2e `runCli` becomes a thin wrapper with a required bound, and its 'a SIGTERM means a timeout' reading goes.

### Detailed instructions

- Read `tests/helpers/boundedSpawn.ts` and phase-03's handoff (the review's rules for the pattern) first.
- Move every spawn in these 15 unit test files:
  - tests/unit/artifactNamesGuard.test.ts
  - tests/unit/cli/recordsInitWritten.test.ts
  - tests/unit/cli/runnerCommandContracts.test.ts
  - tests/unit/cli/schemaUpgrade.test.ts
  - tests/unit/cli/validate.test.ts
  - tests/unit/commandLibrary/commander/usage.test.ts
  - tests/unit/initProject.test.ts
  - tests/unit/loadConfig.test.ts
  - tests/unit/releaseCut.test.ts
  - tests/unit/releaseNotesCollect.test.ts
  - tests/unit/releaseWorkflow.test.ts
  - tests/unit/schemasSmoke.test.ts
  - tests/unit/site/generate.test.ts
  - tests/unit/site/releaseNotesLinks.test.ts
  - tests/unit/upgradeConfigSchema.test.ts

  The unit project's test timeout is 30 s, so a call there states `GIT_BOUND_MS` or `SCRIPT_BOUND_MS` (25_000), or a literal under 28 s with its reason. An `execSync` shell string becomes `boundedSpawn("/bin/sh", ["-c", …])` or a direct argv when the string has no shell syntax. In `tests/unit/schemasSmoke.test.ts`, the assertion that a generated script imports only `node:child_process` and the schemas package concerns that script's text and stays as it is.
- Rewrite `tests/e2e/helpers/runCli.ts` as a thin wrapper over `boundedSpawn(CLI_LAUNCHER, cliArgs(...args), …)`:
  - `RunCliOptions.boundMs` is required, with no default; a named `E2E_CLI_BOUND_MS = 300_000` exported from the helper is the value callers state.
  - `env` merges over `process.env` as before.
  - The `timedOut` field goes: a bound reached now throws the bounded spawn's error, and any other signal throws a foreign-signal error.
  - `exitCode`, `stdout` and `stderr` stay.

  Update its callers (`tests/e2e/headlessAuthoring.test.ts`, `tests/e2e/realFlow.test.ts`, `tests/e2e/vibeSecure.test.ts`) to state the bound and to stop reading `timedOut`. Assert the same outcome another way only where they asserted it.
- Move every other spawn in tests/e2e:
  - helpers/providers.ts
  - helpers/tempEnv.ts
  - claudeJsonSchema
  - claudePartialCommands
  - claudeProtectedPaths
  - claudeSkillEditGrant
  - codexOutputSchema
  - headlessAuthoring
  - projectOnlySession
  - semanticTrace.declaredStop
  - semanticTrace.heldStop
  - vibeSecure

  A real provider call states a bound sized from its old `timeout` or from `E2E_CLI_BOUND_MS`.
- The e2e tier is typechecked by `pnpm test:type` but never run in this phase: leave `PHAX_E2E_RUN` unset and do not run `pnpm test:e2e:real`.
- When done, `git grep -l "node:child_process" -- tests` lists only `tests/helpers/boundedSpawn.ts`. Quote it in the handoff.
- Before editing a file, read its entries in `lint-baseline.json` and keep each line that carries an accepted diagnostic. Several e2e files carry some.
- Run `pnpm test:unit` and `pnpm test:type` before committing.

### Planned files to create

- (none)

### Planned files to edit

- `tests/unit/artifactNamesGuard.test.ts`
- `tests/unit/cli/recordsInitWritten.test.ts`
- `tests/unit/cli/runnerCommandContracts.test.ts`
- `tests/unit/cli/schemaUpgrade.test.ts`
- `tests/unit/cli/validate.test.ts`
- `tests/unit/commandLibrary/commander/usage.test.ts`
- `tests/unit/initProject.test.ts`
- `tests/unit/loadConfig.test.ts`
- `tests/unit/releaseCut.test.ts`
- `tests/unit/releaseNotesCollect.test.ts`
- `tests/unit/releaseWorkflow.test.ts`
- `tests/unit/schemasSmoke.test.ts`
- `tests/unit/site/generate.test.ts`
- `tests/unit/site/releaseNotesLinks.test.ts`
- `tests/unit/upgradeConfigSchema.test.ts`
- `tests/e2e/helpers/runCli.ts`
- `tests/e2e/helpers/providers.ts`
- `tests/e2e/helpers/tempEnv.ts`
- `tests/e2e/claudeJsonSchema.test.ts`
- `tests/e2e/claudePartialCommands.test.ts`
- `tests/e2e/claudeProtectedPaths.test.ts`
- `tests/e2e/claudeSkillEditGrant.test.ts`
- `tests/e2e/codexOutputSchema.test.ts`
- `tests/e2e/headlessAuthoring.test.ts`
- `tests/e2e/projectOnlySession.test.ts`
- `tests/e2e/semanticTrace.declaredStop.test.ts`
- `tests/e2e/semanticTrace.heldStop.test.ts`
- `tests/e2e/vibeSecure.test.ts`
- `tests/e2e/realFlow.test.ts`

### Optional files that may be edited

- `tests/helpers/boundedSpawn.ts`
- `tests/e2e/gateExhaustionResume.test.ts`
- `tests/e2e/resetPhase.test.ts`

### Boundary contracts

Producer: `tests/e2e/helpers/runCli.ts`. Consumers: the e2e tests. `runCli(args, cwd, { boundMs, env? })` returns `{ exitCode, stdout, stderr }`. The `timedOut` field is gone: a bound reached, or any signal ending, throws the bounded spawn's error.

### Test strategy

- every moved unit test passes with its assertions unchanged — medium · smoke · the tests' own assertions under the gate · in-phase
- the e2e tier type-checks with a required bound at every runCli call and no timedOut read — small · example · pnpm test:type · in-phase
- no file under tests/ but the bounded spawn imports node:child_process — small · example · git grep -l node:child_process over tests, listing only tests/helpers/boundedSpawn.ts, quoted in the handoff · in-phase · ac-all-moved

### Implementation order

1. The unit test files.
2. tests/e2e/helpers/runCli.ts and its callers, then the other e2e helpers.
3. The remaining e2e test files.

### Excluded scope

- Running the e2e tier.
- The guard (phase-11).

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

- The files moved.
- The new `runCli` signature and how each caller that read `timedOut` now asserts.
- The `git grep` over tests listing only the bounded spawn.
- Any literal bound with its reason.
- Any lint-baseline line kept on purpose.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`test(spawn): move the unit and e2e tests to the bounded spawn`

### Commit body

The unit tests and the e2e tier now start every child through boundedSpawn or boundedOutput, with a bound stated at each call. The e2e runCli becomes a thin wrapper with a required bound: it no longer reads any SIGTERM as its own timeout, and a bound reached or a foreign signal fails with the bounded spawn's error. No file under tests/ but the bounded spawn imports node:child_process.

---

## phase-11 — Refuse a new unbounded spawn under tests {#phase-11-spawn-guard}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** The guard is a new AST scan that follows import bindings to their calls across six forms of import. That design is beyond the regex scans the repository's guards use today.

`pnpm check:full` fails on any file under tests/ that starts a child other than through the bounded spawn, naming the file, the line and the bounded spawn. It passes on today's tree with no exemption list.

### Detailed instructions

- Add a `describe("unbounded test spawns", …)` to `tests/unit/architecturalGuards.test.ts`. That file runs in both `pnpm audit:architecture` and `pnpm test:unit`, so in `pnpm check:full` and in every gate.
- The scanner is a pure function of a file's path and text that returns findings `{ file, line, call }`. Parse with `parseSync` from oxc-parser, as `scripts/lint-baseline.ts` already does. It finds:
  - value imports of `node:child_process` or `child_process` (named, default or namespace; `import type` is not a spawn);
  - `require("node:child_process")` / `require("child_process")`, including through `createRequire`;
  - `import("node:child_process")`.

  Then it reports each call of an imported binding (`spawnSync`, `execFileSync`, `execSync`, `spawn`, `exec`, `execFile`, `fork`, or a member of a namespace or required object) at the line of the call. It also reports the import's own line when no call is found (a re-export or a binding passed on). Text inside string or template literals is never code, so a script a test writes to disk is not scanned.
- Walk every `.ts`, `.mts`, `.cts`, `.js`, `.mjs` and `.cjs` file under tests/ (unit, integration, type, e2e, helpers, fixtures, setup, and any other folder). The only file allowed to import `node:child_process` is the bounded spawn itself, `tests/helpers/boundedSpawn.ts`, named by one constant with a comment saying it is the implementation, not an exemption. There is no other list.
- The failure follows the spec's §6. The assertion message reads, one finding per line:
  `tests/integration/newThing.test.ts:41  spawnSync from node:child_process`
  then the line `A test starts a child only through boundedSpawn (tests/helpers/boundedSpawn.ts), with a bound.`
  Compare the findings with `[]` so vitest prints them.
- Tests of the scanner over fixture texts (in-memory strings, no files):
  - each of the six functions `spawnSync`, `execFileSync`, `execSync`, `spawn`, `exec` and `execFile` called directly from a named import is reported at its call line;
  - a `spawnSync` call that passes its own `timeout` is still reported;
  - a namespace import (`cp.spawnSync`), a `require`, a `createRequire` require and a dynamic import are each reported;
  - the bare `child_process` specifier is reported like `node:child_process`;
  - an `import type`, a string or template literal containing `require("node:child_process")`, and a call of `boundedSpawn` are not reported.
- The real-tree test asserts the scan of tests/ returns no finding. Check, with a findings count printed in the handoff, that it scanned more than 300 files.
- Add one sentence to the doc comment of `tests/helpers/boundedSpawn.ts` naming the guard that enforces it, if phase-01 did not.

### Planned files to create

- (none)

### Planned files to edit

- `tests/unit/architecturalGuards.test.ts`

### Optional files that may be edited

- `tests/helpers/boundedSpawn.ts`

### Test strategy

- a test file that calls spawnSync, execFileSync, execSync, spawn, exec or execFile from node:child_process, including one passing its own timeout, through a named, namespace, require, createRequire or dynamic import, is refused at the call's line with a pointer to the bounded spawn — small · table · the scanner's findings and the failure message for each fixture text · in-phase · ac-guard-refuses
- a type-only import, a script held in a string or template literal, and a boundedSpawn call are not refused — small · boundary · an empty findings list for each fixture text · in-phase
- the scan of every script file under tests/ finds nothing, with the bounded spawn as the only file importing node:child_process and no exemption list — small · example · an empty findings list over the real tree · in-phase · ac-all-moved

### Implementation order

1. The scanner function and its fixture-text tests.
2. The real-tree walk and its assertion with the §6 message.

### Excluded scope

- An oxlint rule (`.oxlintrc.json` is protected).
- Any exemption list.
- Scanning outside tests/.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

- The scanner's entry point and what it recognizes.
- The number of files the real-tree scan read.
- The failure message as printed for one fixture.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`test(guard): refuse a child process started outside the bounded spawn`

### Commit body

architecturalGuards now parses every script file under tests/ and refuses any call reached through node:child_process outside tests/helpers/boundedSpawn.ts, naming the file and the line and pointing to the bounded spawn. That includes a call that passes its own timeout. It passes on the tree with no exemption list, and runs in pnpm audit:architecture and pnpm test:unit, so in pnpm check:full and every gate.

---

## phase-12 — Repeated full suites with no foreign signal {#phase-12-repeated-suites}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

The full suite runs 20 times in a row on macOS under the gate's load with every run passing and no CLI spawn ending on a signal or with exit status 143. The record is committed, and NEXT_STEPS.md shows the item done.

### Detailed instructions

- Run `node spikes/bounded-test-spawns/repro.mjs --runs 20 --load gate` in the background and poll it. This is `pnpm test` (vitest run with `node_modules/.bin` on PATH), preceded in each run by the standard profile's every-phase local steps, with the diagnostic log on.
- Create `spikes/bounded-test-spawns/suite-runs.md` with:
  - the machine (macOS version, cores) and the command;
  - one row per run: duration, passed or failed, failed tests, and any non-normal ending from its diagnostic log;
  - the totals;
  - the suite time against the 210 s measured before this change.

  Also add a 'CI runs (filled at review)' section for the operator: the CI test job, run 10 times on the pull request.
- If a run fails or logs a foreign-signal ending, do not retry it away and do not raise a bound to hide it. Record it with its diagnosis block in suite-runs.md and in the handoff, and stop: that is a defect under test or a sender phase-05 did not stop.
- Complete `spikes/bounded-test-spawns/findings.md` with a short 'Outcome' section: the sender as named (or still open), the fix, the run totals, and what the operator still has to do at review. That means pasting the CI's evidence, filing or linking the upstream issue if any, and reading the 10 CI runs.
- Edit `NEXT_STEPS.md` §6 'Gates red without a defect'. Close the `bounded-test-spawns` item the way the file closes a finished item (read `git log -p -- NEXT_STEPS.md` for its convention), pointing at the spec and `spikes/bounded-test-spawns/findings.md`. Keep the 'A wall-clock limit on a gate step' item, which records q-gate-bound `separate`. Check that no *Small follow-ups* entry about a spawn with no timeout remains, and remove one if it does.

### Planned files to create

- `spikes/bounded-test-spawns/suite-runs.md`

### Planned files to edit

- `spikes/bounded-test-spawns/findings.md`
- `NEXT_STEPS.md`

### Optional files that may be edited

- `spikes/bounded-test-spawns/repro.mjs`

### Test strategy

- 20 consecutive full suites on macOS under the standard profile's steps all pass, and no CLI spawn ends on a signal or with exit status 143 — large · smoke · the per-run table and diagnostic logs in spikes/bounded-test-spawns/suite-runs.md, completed at review with 10 CI runs · in-phase · ac-suite-clean

### Implementation order

1. Run the 20 suites.
2. Write suite-runs.md and the findings' Outcome section.
3. Update NEXT_STEPS.md.

### Excluded scope

- Any code change. A failure found here is recorded and stops the phase, rather than being fixed in place.
- The CI runs, which the operator reads on the pull request.

### Verification

The `standard` gate profile in phax.json, whose own `pnpm test` is one more full-suite run.

### Expected handoff content

- The run totals: passes, failures, and any non-normal ending with its diagnosis block quoted.
- The suite time against 210 s.
- The macOS diagnostic lines that name the sender, quoted from findings.md.
- What the operator must do at review: read the 10 CI runs, paste the CI half of the sender evidence, file or link the upstream issue if any.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`docs(spikes): record 20 full suites with no foreign signal`

### Commit body

Run the full suite 20 times in a row on macOS under the gate's load with the bounded spawn's diagnostic log on, and record every run in spikes/bounded-test-spawns/suite-runs.md. Complete the findings with the outcome and what is left for review, which is the 10 CI runs and the CI half of the sender evidence. Close the bounded-test-spawns item in NEXT_STEPS.md.
