Write the phax spec `bounded-test-spawns`: every child process a test starts ends within a bound the test states,
and a child that ends otherwise than by itself says who ended it. Two failures share that root: a test that spawns
the CLI with no bound can hang a gate for hours, and under the full suite a spawned `phax --json-schema` is killed
by a SIGTERM nobody sent on purpose. A change to the tests and, where the cause lies, to phax; phax gains no feature.

## Why

A gate step that turns red without a defect costs a fix attempt, a relaunch, and sometimes a release.

- **Killed, exit 143, empty stderr.** A test spawns `tsx src/cli/main.ts … --json-schema` through `spawnSync` and
  gets `status` 143 (SIGTERM) instead of 0. Four times on 2026-11-20 alone: `recordsJsonContracts` ("--json-schema
  prints its entry…") in the Gate step of the 0.41.0 release workflow (run 44715706434, first attempt);
  `plansAnswersJson` in a gate of `test-worlds-built-once`'s last phase, in PR #255's CI (run 44749391634) and in
  main's CI on c15c768e (run 44754159232, "holds an entry for artifact status, plans overview, plans lint and ls");
  before that `phaseGuard` ("lets phax --json-schema print the runner's catalogue") on 2026-11-19. Each passed on
  retry and passes alone. Alone, `phax --json-schema` answers in 0.7 s: the kill is not a slow command.
- **Hung for hours.** `spawnSync` blocks the vitest worker, so the test's timeout (30 s unit, 90 s integration,
  `vitest.config.ts`) can never fire. `usageSpecCompleters` sat 13 h in a gate of `records-branch-tip`
  (2026-11-07, `phax ls --complete` never returned, the child ignored SIGTERM); `groupCommandsJson` sat 3 h on the
  code-repository review fixes (2026-11-18, `cost backfill --json` idle). Both are in *Small follow-ups* of
  `NEXT_STEPS.md`, which this brief takes over.
- **`test-worlds-built-once` observed the kill** (its q-143 `observe`) on the premise that a lighter suite would
  remove it. The suite did not get lighter (210 s before and after), and the kill came back the same day.

## What phax has today, to read first

- About 170 test files run a child through `spawnSync`, `execFileSync` or `execSync`; 29 of them spawn the CLI
  (`tsx` on `src/cli/main.ts`), most through a local `runCli` with no `timeout` option
  (`tests/integration/recordsJsonContracts.test.ts:30`, `plansAnswersJson.test.ts:66` and the like).
  `tests/helpers/processOutput.ts` and `runnerCall.ts` are the shared helpers that exist.
- The CLI's own signal handling: `src/cli/interruptHandler.ts` (SIGINT and SIGTERM save a run being driven), the
  exit codes in `src/cli/commands/runLayers.ts`.
- The shell adapter's timeouts and kills: `src/infra/shell.ts` (SIGTERM on timeout, SIGKILL after a 5 s grace and
  on the process's `exit`, since #247), the same pattern in `src/infra/providers/claudeCode.ts` and
  `mistralVibe.ts`. The fake provider that signals itself: `tests/helpers/fakeProviderCli.ts:167`.
- vitest 5.1, its pool and worker teardown (`vitest.config.ts`), and how `tsx` relays signals to the node process it
  starts.

## What the spec must cover

- **Who sends the SIGTERM.** Reproduce under the full suite, on a laptop and on a CI runner, with the killed child's
  signal, its parent and the moment logged; candidates to rule in or out: vitest tearing a worker down, `tsx` relaying
  a signal, phax's own interrupt handler, an `exit` hook or timer of the shell adapter reaching a child that is not
  its own, a test's cleanup. Fix it where it is.
- **One bounded spawn for tests.** A helper every test that starts a child goes through: a `timeout` it requires, a
  kill that reaches a child ignoring SIGTERM, and on any ending other than a normal exit (signal, timeout) an error
  that names the command, the bound, the signal and what the child wrote. Which existing spawns move to it (all of
  them, or the CLI spawns first), and a guard (architecture test or lint rule) that refuses a new unbounded spawn in
  `tests/`.
- **The bound.** Per call, or one default for a CLI spawn with a test raising it; how it relates to vitest's own
  timeouts, which a synchronous spawn makes inert.
- **A gate step's own bound.** Whether phax gives a gate command a wall-clock limit, so a hung step fails its
  attempt instead of holding a run for hours (the 13 h gate), or whether that is a separate change.
- **Acceptance:** a child that ignores SIGTERM ends at its bound and the test fails naming it; a child killed by a
  signal fails naming the signal; the guard refusing a new unbounded spawn; and the full suite run repeatedly with no
  exit 143, as many runs as the spec says.

## Settled (do not reopen)

1. No assertion removed, no test skipped, no retry added to hide a failure.
2. No timeout raised in `vitest.config.ts` (protected, and raising it hides the cause).
3. The fix goes where the cause is; if the cause is upstream (vitest, tsx), the spec says what phax does meanwhile.
