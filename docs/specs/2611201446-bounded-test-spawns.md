---
status: Draft
date: 2026-11-20
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---
# Bounded test spawns

## 1. Context

About 170 test files start a child process through spawnSync, execFileSync or execSync. 29 of them start the CLI by running tsx on src/cli/main.ts. Most do it through a local runCli with no timeout, for example tests/integration/recordsJsonContracts.test.ts:30 and plansAnswersJson.test.ts:66. There is no shared spawn helper. The only bounded CLI helper is the e2e tier's runCli, which defaults to 300 s, kills with SIGTERM, and reads every SIGTERM ending as its own timeout. tests/unit/phaxHomeGuard.test.ts already scans the test files and refuses a CLI spawn that does not isolate HOME.

vitest gives each test a timeout: 30 s in the unit project and 90 s in the integration project. A synchronous spawn blocks the worker's event loop, so that timeout cannot fire while the spawn waits. When spawnSync is given a timeout, Node sends the kill signal (SIGTERM by default) and then waits for the child to exit. A child that ignores SIGTERM therefore still blocks the worker. tsx is itself a launcher: it starts a node process and relays signals to it.

On the CLI side, main.ts installs the SIGINT and SIGTERM handlers in its module body. That code runs only after every static import has loaded, and loading the imports is most of a 0.7 s `phax --json-schema`. Once the handlers are installed, a SIGTERM makes phax exit 130. phax never exits 143 by itself. A status of 143 with empty stderr therefore points to a SIGTERM that reached tsx, or reached the node process before its handlers were installed. Which of the two is not known.

phax's own children run through the shell adapter. On timeout it sends SIGTERM, then SIGKILL after a 5 s grace, and SIGKILL again from a process 'exit' hook. A configured gate step (format, typecheck, test, and so on) runs with no time cap. Only the acceptance step has one.

Ground read:

- `docs/briefs/bounded-test-spawns.md` — The brief: the four exit-143 kills of 2026-11-20 and 2026-11-19, the 13 h and 3 h hangs, and three settled points: no assertion removed, no timeout raised in vitest.config.ts, the fix goes where the cause is.
- `vitest.config.ts` — testTimeout is 30 s for unit and 90 s for integration, with a 120 s hookTimeout. A spawnSync blocks the worker, so neither timeout can fire while it waits.
- `tests/integration/recordsJsonContracts.test.ts` — A typical CLI spawn: a local runCli calls spawnSync("tsx", [main.ts, ...args]) with no timeout and gives the caller its status and output.
- `tests/e2e/helpers/runCli.ts` — The one CLI helper that has a bound (300 s by default, killed with SIGTERM). It reads any SIGTERM ending as its own timeout, so a SIGTERM from elsewhere looks like a timeout.
- `tests/unit/phaxHomeGuard.test.ts` — A static scan of the test files (unguardedCliSpawns) that refuses a CLI spawn without phaxHomeEnv. It shows a guard over tests/ already exists.
- `tests/helpers/processOutput.ts` — A shared helper for an OutputPort, not for spawning. No shared spawn helper exists.
- `tests/helpers/runnerCall.ts` — Runs phax's program in memory with no child process. It is the existing alternative to spawning the CLI.
- `src/cli/main.ts` — Installs the interrupt handlers at the top of the module body, which runs only after every static import has loaded.
- `src/cli/interruptHandler.ts` — Once installed, both SIGINT and SIGTERM make phax exit 130, not 143.
- `src/cli/commands/runLayers.ts` — phax's own exit codes. 130 is the only one above 128, so phax never exits 143 by itself.
- `src/infra/shell.ts` — Sends SIGTERM when a timeout is reached, then SIGKILL after a 5 s grace and from a process 'exit' hook (#247). The same pattern is in the claudeCode and mistralVibe adapters.
- `src/app/gates.ts` — A configured gate step runs through the shell adapter with no timeoutMs (lines 340 and 342). Only the acceptance step has a time cap.
- `tests/helpers/fakeProviderCli.ts` — Line 167: the fake provider ends itself with process.kill(process.pid, signal), so its signal reaches only itself.
- `tests/integration/nodeShell.test.ts` — Starts children that ignore SIGTERM and kills them by a pid it reads from a file.
- `NEXT_STEPS.md` — Section 6, 'Gates red without a defect', ranks this brief first and has it take over the two Small follow-ups about spawns with no timeout.

## 2. Problem

A gate step can turn red with no defect behind it. Each time, that costs a fix attempt and a relaunch, and once it cost a release. Two failures share one root: tests start child processes with no stated bound and no account of how those children end.

Killed with exit 143. A test spawns `tsx src/cli/main.ts … --json-schema` and gets status 143 with empty stderr instead of 0. This happened four times on 2026-11-20 alone:
- recordsJsonContracts, in the 0.41.0 release gate.
- plansAnswersJson, in a test-worlds-built-once gate.
- In PR #255's CI.
- In main's CI on c15c768e.

phaseGuard had the same kill on 2026-11-19. Each test passed on retry and passes alone, and the command answers alone in 0.7 s. The failure says nothing about who sent the signal, so nobody can fix it. test-worlds-built-once only observed the kill, betting that a lighter suite would remove it. The suite did not get lighter (210 s before and after), and the kill came back the same day.

Hung for hours. usageSpecCompleters held a gate for 13 h on 2026-11-07: `phax ls --complete` never returned and the child ignored SIGTERM. groupCommandsJson held one for 3 h on 2026-11-18, with `cost backfill --json` sitting idle. vitest's timeout could not fire because the spawn was synchronous, and nothing else bounded it.

## 3. Product goal

Every child process a test starts ends within a bound the test states, together with every process it started. A child that ends any other way than by itself fails its test with a message saying what ended it: the bound, or a signal from somewhere else. Whoever is sending the stray SIGTERM under the full suite is found and stopped at the source, so the full suite runs again and again with no exit 143. This changes the tests, and changes phax only where the cause lies in phax. phax gains no feature.

> No test waits on a child longer than the test says, and no child ends without the test saying who ended it.

## 4. Terminology

- **bounded spawn** — The one shared way a test under tests/ starts a child process. It takes the command, its arguments, the options the test needs (cwd, env, stdin) and a bound, and returns the child's ending and output.
- **bound** — The wall-clock time, stated by the test at each call, after which the bounded spawn ends the child itself.
- **grace** — The time between the bounded spawn asking a child to stop at its bound and forcing it, together with every process the child started, to end.
- **descendant** — Any process the child started, directly or through another process. For a CLI spawn through tsx, the node process tsx starts is a descendant.
- **CLI spawn** — A child process running phax from source (tsx on src/cli/main.ts) or from dist (dist/cli/main.js).
- **normal exit** — A child that ended by itself with an exit status, whatever that status is, and was not ended by a signal.
- **signal ending** — A child that ended on a signal. This includes a launcher reporting that the process it started ended on a signal, as an exit status of 128 plus the signal number that the child never uses itself (143 for SIGTERM on a CLI spawn).
- **foreign signal** — A signal ending that the bounded spawn did not cause by reaching the bound.
- **the sender** — The process that sent the SIGTERM ending the CLI spawns in the four 2026-11-20 failures.

## 5. Functional requirements

### 5.1 The sender is named

The change SHALL name the sender. It does so from a reproduction under the full suite, on macOS and on a CI runner, that logs for each killed CLI spawn its signal, its parent process, the process that sent the signal where the platform reports it, and the moment it happened.

### 5.2 The cause is fixed where it lies

IF the sender is phax code or test code THEN that code SHALL be changed so that it never sends a signal to a process it did not start.

### 5.3 An upstream cause is worked around and reported

IF the sender is vitest or tsx THEN the suite SHALL stop taking the path that makes it send the signal, and the change SHALL name the upstream issue reporting it.

### 5.4 A bound with every call

The bounded spawn SHALL refuse a call that states no bound, both when the test suite is type-checked and when the call runs.

### 5.5 The bound ends the child and its descendants

WHEN a child outlives its bound THE bounded spawn SHALL end the child and every descendant by the end of the grace, even if they ignore SIGTERM.

### 5.6 A bound reached fails naming it

WHEN the bounded spawn ends a child at its bound THE bounded spawn SHALL fail the test with an error naming the command, the bound, the fact that the bound ended it, and everything the child wrote on stdout and stderr up to then.

### 5.7 A foreign signal fails naming it

IF a child has a foreign signal ending THEN the bounded spawn SHALL fail the test with an error naming the command, the signal, the fact that the bound did not end it, and everything the child wrote on stdout and stderr.

### 5.8 A test may expect a signal

WHERE a test states that it expects a child to end on a given signal THE bounded spawn SHALL return that signal ending as the result instead of failing.

### 5.9 A normal exit is returned as it is

WHEN a child has a normal exit within its bound THE bounded spawn SHALL return its exit status, stdout and stderr unchanged, whatever the status.

### 5.10 Every test spawn is bounded

Every child process started by a file under tests/ SHALL be started through the bounded spawn.

### 5.11 A new unbounded spawn is refused

IF a file under tests/ starts a child process other than through the bounded spawn THEN `pnpm check:full` SHALL fail, naming the file and the line.

### 5.12 The full suite ends no CLI spawn on a foreign signal

The full suite SHALL complete repeated runs, on macOS and on a CI runner, without a single CLI spawn having a foreign signal ending.

## 6. Surface

### internal: the bounded spawn (tests/helpers) — indicative

Summary: A test starts any child through one helper that takes a required bound and returns the child's ending and output.

before:

    function runCli(args: readonly string[]): SpawnSyncReturns<string> {
      return spawnSync("tsx", [mainTs, ...args], {
        cwd: fixture.repo,
        encoding: "utf8",
        env: phaxHomeEnv(),
        stdio: ["ignore", "pipe", "pipe"],
      });
    }

after:

    const result = boundedSpawn("tsx", [mainTs, "--json-schema"], {
      boundMs: 20_000,          // required: a call without it does not type-check
      cwd: fixture.repo,
      env: phaxHomeEnv(),
      stdin: "ignore",
    });
    // result: { status: 0, stdout: "…", stderr: "" }

    // a test that sends the child SIGINT on purpose:
    boundedSpawn(cmd, args, { boundMs: 10_000, expectSignal: "SIGINT" });
    // result: { signal: "SIGINT", stdout: "…", stderr: "…" }

### internal: the bounded spawn's failure messages — indicative

Summary: A test whose child is ended by its bound or by a signal from elsewhere fails with the command, the bound, the signal, who ended it, and the child's output.

before:

    AssertionError: expected 143 to be +0 // Object.is equality

    - Expected
    + Received

    - 0
    + 143

after:

    bounded spawn: `tsx src/cli/main.ts --json-schema` ended by SIGTERM, not by its bound (20000 ms)
      sent through tsx: exit status 143
      stdout (0 bytes):
      stderr (0 bytes):

    bounded spawn: `tsx src/cli/main.ts ls --complete` reached its bound (20000 ms) and was ended by it
      SIGTERM, then SIGKILL to it and 1 descendant after 2000 ms
      stdout (12 bytes): alpha:running
      stderr (0 bytes):

### internal: the guard against an unbounded spawn — indicative

Summary: `pnpm check:full` refuses a test file that starts a child process without going through the bounded spawn, and names the file and line.

    $ pnpm check:full
    …
    FAIL  unbounded test spawns
      tests/integration/newThing.test.ts:41  spawnSync from node:child_process
      A test starts a child only through boundedSpawn (tests/helpers/boundedSpawn.ts), with a bound.
    $? = 1

## 7. Non-goals

- Raising any timeout in vitest.config.ts. The file is protected, and raising a timeout hides the cause.
- Removing an assertion, skipping a test, or adding a retry to hide a failure.
- Any new phax command, flag or config key. Whether a gate step gets a wall-clock limit is question q-gate-bound, and the recommended answer is a separate spec.
- Changing phax's exit codes or the interrupt handler's behavior, unless the reproduction shows the cause lies there.
- Making the suite faster. The bound is a ceiling on a hang, not a performance target.
- Bounding the children phax starts in production. The shell adapter and the provider adapters already have their own timeouts and kills.
- Windows. The suite and the signals in question are POSIX ones (macOS and Linux CI runners).

## 8. Acceptance criteria

### The sender is named with evidence

Given the reproduction run under the full suite, on macOS and on a CI runner, when a CLI spawn is ended by SIGTERM, then the handoff names the sender and quotes the logged lines (signal, parent, sending process where the platform reports it, moment) from both platforms. (refs §5.1)

### The sender no longer reaches a child it did not start

Given the path through which the sender reached the CLI spawn, driven by a regression test, when that test runs, then no signal reaches a process the sender did not start, and the regression test fails on the code from before the fix. (refs §5.2)

### An upstream sender is avoided and reported

Given a sender that the reproduction shows to be vitest or tsx, when the change is reviewed, then the suite no longer takes the path that makes it send the signal, the handoff links the upstream issue, and ac-suite-clean holds. (refs §5.3)

### No bound, no spawn

Given a call to the bounded spawn that states no bound, when `pnpm test:type` runs, or the call runs with the type check bypassed, then the type check fails on that call, and when it runs the call is refused without starting a child. (refs §5.4)

### A child ignoring SIGTERM ends at its bound

Given a bounded spawn with a 2 s bound of a child that ignores SIGTERM and has started a grandchild that also ignores SIGTERM, when the bound passes, then the call fails within the bound plus the grace, with an error naming the command, the 2000 ms bound and that the bound ended it, plus the child's output so far, and neither the child nor the grandchild is alive afterwards. (refs §5.5, §5.6)

### A hung CLI spawn ends at its bound

Given a CLI spawn through tsx of a command made to wait forever, with its bound set, when the bound passes, then the test fails naming the command and the bound within the bound plus the grace, and no tsx or node process from that spawn is left running. (refs §5.5, §5.6)

### A child killed by a signal fails naming it

Given a bounded spawn of a child that writes a line to stderr and then sends itself SIGTERM, well within its bound, when the child ends, then the call fails with an error naming the command, SIGTERM, that the bound did not end it, and the line the child wrote. (refs §5.7)

### A SIGTERM relayed as exit 143 is named

Given a CLI spawn through tsx whose node process is ended by SIGTERM, so that the launcher reports exit status 143, when the spawn ends, then the call fails naming SIGTERM, saying it was not ended by its bound, and quoting stdout and stderr. (refs §5.7)

### An expected signal is a result

Given a bounded spawn stating that it expects SIGINT, of a child that ends on SIGINT, when the child ends, then the call returns the SIGINT ending and the child's output without failing. (refs §5.8)

### A non-zero exit is returned unchanged

Given a bounded spawn of a CLI command that is refused with exit 64 and a message on stderr, when it ends within its bound, then the call returns status 64 with stdout and stderr exactly as written, and the test's own assertions decide what happens next. (refs §5.9)

### No exemptions left

Given the tree after the change, when the guard runs, then it passes with no exemption list, and every file under tests/ (unit, integration, type, e2e, helpers, fixtures) that starts a child does so through the bounded spawn. (refs §5.10)

### The guard refuses a new unbounded spawn

Given a test file under tests/ that calls spawnSync, execFileSync, execSync, spawn, exec or execFile from node:child_process directly, including one that passes its own timeout, when `pnpm check:full` runs, then it fails, naming the file and the line of the call and pointing to the bounded spawn. (refs §5.11)

### Repeated full suites with no foreign signal

Given the change merged, when `pnpm test` runs 20 times in a row on a macOS laptop under the gate's own load (the standard profile's steps), and the CI test job runs 10 times on a runner, then every run passes, and no CLI spawn ends on a signal or with exit status 143. (refs §5.12, §5.2)

## 9. Open questions

### q-gate-bound — Should phax give a configured gate step a wall-clock limit, so that a hung step fails its attempt instead of holding a run for hours, in this change or in a separate one?

- separate — A separate spec. This change bounds the tests' own children and adds no phax feature. — abandons: Protection against a hang from a cause other than a test spawn (a hung pnpm install, or a deadlocked tool in a gate step) until that spec ships.
- here — Here. Every gate step gets a time cap, configured in gateProfiles, and a step that reaches it fails its attempt. — abandons: The brief's 'phax gains no feature', and a bounded change. It is a new required config field that every phax.json must declare, since persisted shapes take no optional shims.

Recommendation: separate — Both recorded hangs (13 h and 3 h) were test spawns, and r-bound-ends closes them. A gate-step cap is a config surface with its own questions (a default value, a value per step, how it is recorded), and a spec of its own can answer them. Add it to NEXT_STEPS.md under section 6.

### q-scope — Should every existing spawn under tests/ move to the bounded spawn now, or only the CLI spawns, with the others listed as exemptions?

- all — All of them (about 170 files: CLI, git, and every other child), and the guard has no exemption list. — abandons: A small diff. The change touches most test files at once, and its review is long and mechanical.
- cli-first — The 29 CLI spawns now. The guard carries an explicit list of the other files, to be emptied later. — abandons: The guarantee that every child ends within a bound. A git or helper child that hangs still blocks a worker with no bound, and the exemption list can be left behind and forgotten.

Recommendation: all — The goal is 'every child a test starts', and an exemption list is the permissive superset the conventions argue against. Most non-CLI spawns are fast git calls, so moving them is mechanical, and a git waiting on an editor or credentials hangs the same way.

### q-bound-form — Should each call state its own bound, or should a CLI spawn take one shared default that a test can raise?

- per-call — Required at every call, with no default. — abandons: Brevity. Every call states a number, and the numbers can drift from one file to the next.
- default — A shared default bound for each kind of spawn (CLI, git), which a test can raise. — abandons: The bound being visible where the test is read, and the brief's 'a bound the test states'. A default also tempts every caller to accept it without thinking.

Recommendation: per-call — The bound is a statement about this one call, for example a 0.7 s command under a full-suite load. Named constants in the helpers can keep the numbers consistent, while the call still states which one it uses.

## 9b. Arbitrated questions

None.

## 10. Implementation-planning note

Settled:

- The brief's three settled points: no assertion removed, no test skipped, no retry added; no timeout raised in vitest.config.ts; the fix goes where the cause is, and if the cause is upstream the suite avoids it and the issue is reported (r-cause-upstream).
- Finding the sender comes first, before the helper hides the symptom. The bounded spawn's errors are a diagnosis, not the fix.
- What is known before the reproduction: phax never exits 143 by itself; it exits 130 on SIGTERM once its handlers are installed, and they are installed only after main.ts's static imports load. Status 143 points to a SIGTERM that reached tsx, or reached node during module load. The candidates to rule in or out: vitest tearing a worker down, tsx relaying a signal, phax's interrupt handler, an exit hook or grace timer of the shell adapter or a provider adapter reaching a process that is not its own (for example a reused pid), and a test's cleanup killing by a pid read from a file.

Left open:

- Whether the bounded spawn is synchronous (smaller change at each call, but vitest's timeout stays inert) or asynchronous (vitest's timeout fires again, but every call becomes an await).
- How to end every descendant. For example, start the child in its own process group and signal the group, or run the CLI as node with tsx's loader so there is no relaying launcher. Either way, ac-ignores-sigterm and ac-cli-hang must hold.
- The grace value, and the bound constants for each kind of spawn (see q-bound-form).
- How the guard is built: a static scan test like phaxHomeGuard's, an architecture-audit rule, or an oxlint restricted-import rule. The guard must run inside `pnpm check:full`.
- Whether the e2e runCli becomes a thin wrapper over the bounded spawn. Its 'SIGTERM means it timed out' reading must go either way.

Constraints:

- vitest.config.ts, lint-baseline.json and knip-baseline.json are protected. Neither the guard nor the move may edit them.
- A synchronous spawn caps its test only through its own bound. Choose bounds so that a hang fails in minutes, not hours, and so that the helper's error, not a later generic timeout, is what reports it.
- The bounded spawn's tests (ac-ignores-sigterm, ac-cli-hang, ac-foreign-signal, ac-relayed-143) must leave no process running after the test file ends, including when an assertion fails.
- Take the 'Small follow-ups' on spawns with no timeout out of NEXT_STEPS.md, since this spec takes them over, and record the q-gate-bound outcome there.
- phax production code changes only where r-cause-fixed puts the cause.

## 11. Docs page

None — Nothing a phax user can see changes: this is about how the test suite starts children. The helper's doc comment and the guard's failure message tell a contributor how to spawn in a test.
