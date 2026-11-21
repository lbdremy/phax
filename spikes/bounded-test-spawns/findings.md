# Who sends the stray SIGTERM: findings

The kills on record (spec §2): a test spawns `tsx src/cli/main.ts --json-schema` through a plain
`spawnSync` and gets status 143 with empty stderr instead of 0. phaseGuard on 2026-11-19.
recordsJsonContracts in the 0.41.0 release gate on 2026-11-20, and plansAnswersJson three times
that day: in a test-worlds-built-once gate, in PR #255's CI and in main's CI on c15c768e. Each
passed on retry and alone.

**Short answer.** The sender is the test's own `spawnSync`. Node's `spawnSync` caps what it reads from
a child's stdout at `maxBuffer`, 1 MiB by default. When the output passes the cap, Node ends the
read with `ENOBUFS` and sends the child its `killSignal`, SIGTERM by default. The root
`phax --json-schema` has printed more than 1 MiB since b9fe0324 (2026-11-19 10:24): 1,058,523 bytes
then, 1,057,639 bytes today. So every such call sent tsx a SIGTERM as the last chunk arrived. tsx
turned that SIGTERM into exit 143 whenever its own child had not exited within about 30 ms. That
is rare alone and common under load. The tests read `status` and never `error`, so they saw a
bare 143.

## Candidates

Each candidate from the spec's §10 and the plan, read in the code at 260e3611 (before the bounded
spawn) and at this phase's base (b5e4a163), with vitest 5.1.0, tsx 4.23.15 and Node 26.13.1.

### Node's spawnSync `maxBuffer`: ruled in (the sender)

This candidate was not on the spec's list. Reading the call sites for "anything that signals its
own child" found it.

- Every CLI spawn of the root `--json-schema` before phase-02 was a plain
  `spawnSync("tsx", [mainTs, ...args], { encoding: "utf8", … })` with no `maxBuffer`. For example
  `tests/integration/plansAnswersJson.test.ts:48` and `:65`, `recordsJsonContracts.test.ts:30` and
  `:139`, `phaseGuard.test.ts:39` and `:127`, and `cliRefusedCodes.test.ts:107`, all at 260e3611.
  That is four spawned calls per suite; phaseGuard's other root `--json-schema`, at `:228`, runs
  in-process. Each of the four asserts status 0.
- Node documents `maxBuffer` for `spawnSync` as "Largest amount of data in bytes allowed on stdout
  or stderr. If exceeded, the child process is terminated", with `killSignal` defaulting to
  `'SIGTERM'` and `maxBuffer` to `1024 * 1024`.
- The root catalogue's size, measured at each commit with a detached worktree
  (`tsx src/cli/main.ts --json-schema | wc -c`):

  | commit   | date             | bytes     |                                                 |
  | -------- | ---------------- | --------- | ----------------------------------------------- |
  | ea84e2dd | 2026-11-17 11:31 | 864,715   | under                                           |
  | 683071b4 | 2026-11-18 20:46 | 1,003,426 | under                                           |
  | 4251c329 | 2026-11-19 10:03 | 1,043,847 | under                                           |
  | b9fe0324 | 2026-11-19 10:24 | 1,058,523 | **over** (feat(findings): post fate comments …) |
  | 699762ab | 2026-11-19 12:40 | 1,058,793 | over                                            |
  | c15c768e | 2026-11-20 14:56 | 1,057,639 | over (the main CI kill)                         |
  | b5e4a163 | 2026-11-20       | 1,057,639 | over (this phase's base)                        |

  The cap is 1,048,576 bytes. The first recorded kill (phaseGuard, 2026-11-19) is the day the
  catalogue crossed it, and no kill was recorded before.

- The overshoot is 9,063 bytes, smaller than one pipe read (64 KiB). So the cap is passed by the
  last chunk, after phax has written everything. The test still gets the whole stdout. Node then
  sends SIGTERM to tsx, the direct child, while phax is on its way out.
- What tsx does with it, from `node_modules/tsx/dist/cli.mjs` (`relaySignals`, minified as `Is`):
  on SIGTERM the launcher waits 30 ms for its child to report the same signal over tsx's IPC
  socket. With no report, it sends the child SIGTERM and waits 30 ms more. With still no report,
  it registers `child.on("exit", () => process.exit(128 + 15))` and sends SIGKILL. If phax exits
  inside the first 30 ms, the launcher's `close` handler exits with phax's 0 first. A phax that
  has already called `process.exit` runs no signal handler, so it never reports. Under load, the
  launcher therefore exits 143 with empty stderr, and the test sees `status: 143`.
- Checked directly: a TypeScript child run by `node_modules/.bin/tsx` has a SIGTERM listener that
  exits 130, as phax does. It writes one line and then stays busy for B ms before exiting 0. The
  launcher gets SIGTERM as soon as that line arrives:

  ```text
  busy 0 ms: status 0 signal null stderr ""
  busy 0 ms: status 0 signal null stderr ""
  busy 20 ms: status 0 signal null stderr ""
  busy 20 ms: status 0 signal null stderr ""
  busy 100 ms: status 143 signal null stderr ""
  busy 100 ms: status 143 signal null stderr ""
  busy 300 ms: status 143 signal null stderr ""
  busy 300 ms: status 143 signal null stderr ""
  ```

  A child that would exit 0 becomes a launcher exit of 143, with empty stderr, once it needs more
  than tsx's two 30 ms windows to finish. It never becomes 130. On a loaded machine, a process
  that gets no CPU for 60 ms is common.

- The tests checked `result.status` and never `result.error`, which held `ENOBUFS` on every call
  (see Reproduction). So the kill looked foreign, and the call was flaky only in its exit status.

### vitest tearing a worker down: ruled out

- vitest 5.1's default pool is `forks`. `ForksPoolWorker.stop()`
  (`node_modules/vitest/dist/chunks/index.Di8au7q4.js`) calls `fork.kill()` (SIGTERM), then
  `fork.kill("SIGKILL")` after `SIGKILL_TIMEOUT = 500` ms. Both go to the fork's own pid through
  its ChildProcess handle, never to a process group or to the fork's children.
- The worker answers `stop` only after `await runPromise` (`chunks/init.CO4AB7HZ.js`, `case "stop"`).
  A worker blocked in `spawnSync` cannot even read the message, so no teardown overlaps a spawn.
- If vitest had signalled a worker mid-spawn, the worker would have died: it has no SIGTERM
  listener (`init-forks` adds one only under `--prof`). vitest would then report a worker that
  exited unexpectedly. In every recorded kill the worker survived and reported the 143 as an
  assertion.
- vitest's other `process.kill` calls are `process.kill(pid, 0)` (a lock probe) and SIGTSTP on
  Ctrl-Z in watch mode. Neither applies to `vitest run`.

### tsx relaying a signal: ruled in as the relay that turns the SIGTERM into 143, not as the sender

- `relaySignals` in `cli.mjs` only acts on a signal the launcher itself received. tsx originates
  no signal. Its watch mode (`killProcess`) is not used by the suite.
- The child side (`node_modules/tsx/dist/preflight.cjs`, `bindHiddenSignalsHandler`) adds a hidden
  SIGINT and SIGTERM listener that reports the signal to the launcher. When no other listener
  exists, it calls `process.exit(128 + n)`. So a SIGTERM that reaches the phax process before
  `setupInterruptHandlers()` runs also ends in 143.
- The IPC socket is `${tmpdir}/tsx-${uid}/${pid}.pipe`, and the child connects to its
  `process.ppid`'s socket. A stale socket left by a SIGKILLed launcher can at worst refuse that
  connection. Messages only resolve the launcher's wait and send no signal.
- tsx's 30 ms windows explain why the same SIGTERM gave 0 alone and 143 under load. The
  launcher's reading is arguably harsh: it reports 143 for a child that exited 0. But it receives
  a real SIGTERM, so this is not an upstream sender.

### phax's interrupt handler: ruled out

- `src/cli/interruptHandler.ts` sends no signal. Its `onInterrupt` saves a driven run and calls
  `process.exit(130)`. It is installed in `src/cli/main.ts` after the static imports load
  (`setupInterruptHandlers()` at the top of the module body, unchanged since e68673e6).
- It can only change an exit code. A SIGTERM that reaches phax after it is installed and is
  acknowledged within tsx's window gives 130, not 143. The reproduction never saw 130.

### The shell and provider adapters' timeout, grace timer and `exit` hook: ruled out

- `src/infra/shell.ts`: on `timeoutMs` it calls `proc.kill("SIGTERM")`. It then calls
  `forceKill` (`proc.kill("SIGKILL")`) from a 5 s unref'd timer and from `process.once("exit")`,
  which is cleared on `close` (bd860d16, 2026-11-19 16:50). `src/infra/providers/claudeCode.ts:144`
  sends SIGTERM, then SIGKILL after 5 s. `src/infra/providers/mistralVibe.ts:259` sends SIGTERM
  under `PHAX_VIBE_SPAWN_TIMEOUT_MS`.
- All of them use `ChildProcess.kill`, which signals through the process handle. Node closes the
  handle and sets `_handle = null` when it reaps the child, and `kill` on a closed handle sends
  nothing. Before the reap, the pid belongs to the child or its zombie, so no reused pid can be
  reached.
- Each signal goes to the direct child, not a group, and a CLI spawn under test is never that
  child in the vitest worker. Also, `forceKill` sends SIGKILL, which would show as 137, not 143.

### A test cleanup that kills by a pid read from a file: ruled out

- `tests/integration/nodeShell.test.ts:136` (`withSigtermIgnoringChild`, bd860d16) runs
  `if (existsSync(pidFile) && isAlive(pid())) process.kill(pid(), "SIGKILL")`. A reused pid is
  possible in principle, but the signal is SIGKILL, which gives 137 or a `SIGKILL` signal,
  never 143. It also landed on 2026-11-19 16:50, after the catalogue crossed the cap.
- `tests/integration/briefProvider.test.ts:174` only probes with `process.kill(pid, 0)`.

### The fake provider that signals itself: ruled out

- `tests/helpers/fakeProviderCli.ts:167` runs
  `process.kill(process.pid, script.signal)`. The target is its own pid, and the signal reaches
  only itself (since 0dac9e20, 2026-10-28).

### Anything calling `process.kill` with 0, a negative pid or a pid it did not start: ruled out

- `git grep` over `src`, `tests` and `scripts` for `process.kill`, `.kill(` and `killSignal` at
  260e3611 finds only the sites above and these:
  - `src/infra/lock.ts:16` (`kill(pid, 0)`: a probe);
  - a `spawnSync` `timeout` on its own child (`worldCache.test.ts:299`, a nested vitest run, and
    the e2e tier), none of them a `--json-schema` call;
  - `tests/unit/interruptHandler.test.ts`, which only `process.emit`s the event.
- Nothing calls `process.kill` with a negative pid. The bounded spawn's own `process.kill(-pgid)`
  came in phase-01, after the kills on record, and targets only the group it started.
- Every `--json-schema` call killed on record was killed by its own `spawnSync`, as above.

## Reproduction

All runs were on the operator's macOS machine: 14 cores, Node 26.13.1, vitest 5.1.0,
tsx 4.23.15, on 2026-11-21, at this phase's base plus this phase's files. `PHAX_E2E_RUN` was
unset.

The kill's path is no longer in the suite. Since phase-02, every suite that spawns the CLI goes
through the bounded spawn, which reads a child's output with no cap. So the reproduction checks
two things:

1. That the full suite, with every CLI spawn bounded, logs no foreign-signal ending under rising
   pressure. This is the plan's reproduction.
2. That the pre-phase-02 call, run alongside the same suites, still sends its SIGTERM. That is the
   `--probe`: a plain `spawnSync` of `tsx src/cli/main.ts --json-schema` with its default
   `maxBuffer`, made from a separate node process while the suite runs.

### The kill itself, outside the suite

Plain `spawnSync` of the root `--json-schema` with the default `maxBuffer`, sequentially, nothing
else running (8 calls):

```text
status=0 signal=null error=ENOBUFS stdout=1057625 stderr=0   (8 of 8, ~390 ms each)
```

The same call with 16 copies looping at once (128 calls, 14 cores):

```text
'status=0 signal=null error=ENOBUFS stdout=1057625 stderr=0' => 122
'status=143 signal=null error=ENOBUFS stdout=1057625 stderr=0' => 6
```

That is the kill on record: status 143, empty stderr and a complete stdout (1,057,625 characters,
1,057,639 bytes). All 128 calls are `ENOBUFS`, so Node sent its SIGTERM every time, and load alone
decided whether tsx turned it into 143.

### The full suite: `node spikes/bounded-test-spawns/repro.mjs`

| stage | command                                            | rounds | suites | suite seconds                                              | failing suites | foreign endings | probe calls (all `ENOBUFS`) |
| ----- | -------------------------------------------------- | ------ | ------ | ---------------------------------------------------------- | -------------- | --------------- | --------------------------- |
| check | `--runs 1 --load none --probe 40`                  | 1      | 1      | 193                                                        | 0              | 0               | 40, all status 0            |
| A     | `--runs 10 --load gate --probe 60`                 | 10     | 10     | 181–191 (189, 191, 181, 184, 188, 188, 188, 187, 187, 189) | 0              | 0               | 600, all status 0           |
| B     | `--runs 5 --load gate --max-workers 20 --probe 60` | 5      | 5      | 200–202 (200, 202, 202, 202, 202)                          | 0              | 0               | 300, all status 0           |
| C     | `--runs 5 --load gate --parallel 2 --probe 60`     | 5      | 10     | 376–416 (415, 416, 401, 401, 377, 376, 393, 392, 403, 403) | 0              | 0               | 300, all status 0           |
| all   |                                                    | 21     | 26     |                                                            | 0              | 0               | 1,240, all status 0         |

Each suite ran 22,560 tests, with 0 failed and 0 vitest worker losses.

- The load. `--load gate` runs format check, typecheck, test:type and lint before each round, but
  takes only about 5 s, because tsc is native (TypeScript 7). The gate prelude leaves the machine
  almost idle, so the pressure was raised in the same 20-round budget: stage B uses 20 workers
  above vitest's default, and stage C runs two full suites at once.
- The check run's own summary said "6 logged endings (3 foreign)". That first version of the
  script did not yet set apart `boundedSpawn.test.ts`, and all 6 lines came from that file.
- In stage A's first rounds, the gate's lint and format check exited 1 on this phase's own
  `repro.mjs` while it was being finished. The load they cause is the same either way.
- Stage B's rounds 2 to 5 and stage C ran with this phase's change to the bounded spawn (see
  Logged endings). That change affects only what a non-normal ending logs.

## Logged endings

Every diagnostic line logged across the 26 suites (156 lines) came from
`tests/integration/boundedSpawn.test.ts`. That file causes each kind of ending on purpose: two
bounds, two child signals, one relayed 143 and one spawn error per suite. No other test logged a
line, and no CLI spawn outside that file ended on a signal. The relayed 143 of
`boundedSpawn.test.ts`, at stage A and then at stage B round 5 (`related` elided):

```json
{"ending":"exit","signal":null,"status":143,"command":"tsx src/cli/main.ts --version","worker":{"pid":7487,"ppid":7457,"pgid":null},"child":{"pid":19335,"pgid":19335},"moment":"2026-11-21T09:30:52.665Z","elapsedMs":100,"sender":"not reported by the platform","related":["… 0 ps rows"],"vitestPoolId":"13","testFile":"tests/integration/boundedSpawn.test.ts"}
{"ending":"exit","signal":null,"status":143,"command":"tsx src/cli/main.ts --version","worker":{"pid":61721,"ppid":5446,"pgid":5083},"child":{"pid":77611,"pgid":77611},"moment":"2026-11-21T10:17:30.493Z","elapsedMs":144,"sender":"not reported by the platform","related":["… 49 ps rows"],"vitestPoolId":"18","testFile":"tests/integration/boundedSpawn.test.ts"}
```

The first line shows a gap in the diagnosis that this phase closes. A relayed 143 is an `exit`
ending, and the spawning thread took its ps snapshot only for a signal ending. So the shape of
every kill on record came with `pgid: null` and no ps rows. `tests/helpers/boundedSpawn.ts` now
takes the snapshot for an exit status above 128 as well. `tests/integration/boundedSpawn.test.ts`
(the relayed-143 case) checks that the block names the worker's group, and that check fails on
the code before the change.

The other lines, for the record (stage A round 1, ps rows elided):

```json
{"ending":"bound","signal":"SIGKILL","status":null,"command":"node $TMPDIR/…/child.mjs","worker":{"pid":7487,"ppid":7457,"pgid":7320},"child":{"pid":7488,"pgid":7488},"moment":"2026-11-21T09:30:16.151Z","elapsedMs":4089,"sender":"not reported by the platform","related":["… 39 ps rows"],"vitestPoolId":"13","testFile":"tests/integration/boundedSpawn.test.ts"}
{"ending":"bound","signal":null,"status":143,"command":"tsx src/cli/main.ts completions zsh","worker":{"pid":7487,"ppid":7457,"pgid":7320},"child":{"pid":28403,"pgid":28403},"moment":"2026-11-21T09:30:48.252Z","elapsedMs":32076,"sender":"not reported by the platform","related":["… 39 ps rows"],"vitestPoolId":"13","testFile":"tests/integration/boundedSpawn.test.ts"}
{"ending":"signal","signal":"SIGTERM","status":null,"command":"node $TMPDIR/…/self-term.mjs","worker":{"pid":7487,"ppid":7457,"pgid":7320},"child":{"pid":8945,"pgid":8945},"moment":"2026-11-21T09:30:50.423Z","elapsedMs":55,"sender":"not reported by the platform","related":["… 36 ps rows"],"vitestPoolId":"13","testFile":"tests/integration/boundedSpawn.test.ts"}
{"ending":"signal","signal":"SIGTERM","status":null,"command":"node $TMPDIR/…/self-term-unexpected.mjs","worker":{"pid":7487,"ppid":7457,"pgid":7320},"child":{"pid":20020,"pgid":20020},"moment":"2026-11-21T09:30:52.767Z","elapsedMs":62,"sender":"not reported by the platform","related":["… 36 ps rows"],"vitestPoolId":"13","testFile":"tests/integration/boundedSpawn.test.ts"}
{"ending":"spawn-error","signal":null,"status":null,"command":"$TMPDIR/…/no-such-command","worker":{"pid":7487,"ppid":7457,"pgid":7320},"child":{"pid":null,"pgid":null},"moment":"2026-11-21T09:30:53.494Z","elapsedMs":34,"sender":"not reported by the platform","related":["… 37 ps rows"],"vitestPoolId":"13","testFile":"tests/integration/boundedSpawn.test.ts"}
```

macOS reports no sender for a signal: every line says `sender: not reported by the platform`. The
sender is named from the code and the probe, not from a `siginfo`.

## Sender

**Named: the test's own `spawnSync`, through its default `maxBuffer`.** The evidence:

1. Every recorded kill was a plain `spawnSync` of the root `--json-schema`: phaseGuard:127,
   recordsJsonContracts:139 and plansAnswersJson:65. All four such spawned calls in the suite
   (with cliRefusedCodes:107) had no `maxBuffer`.
2. That output has been over 1 MiB since b9fe0324, the day of the first recorded kill. The
   kill was never recorded before it.
3. Every such call ends with `ENOBUFS`: 8 of 8 alone, 128 of 128 under 16-way load, and all probe
   calls during the suites. Node sends `killSignal` (SIGTERM) to tsx each time.
4. tsx exits 143, with empty stderr and complete stdout, whenever its child takes more than its
   two 30 ms windows to exit. That gave 6 of 128 under 16-way load and 4 of 8 in the controlled
   busy-child check. It is the kill on record, byte for byte.
5. Every other candidate is ruled out in the code (Candidates). The suite with every CLI spawn
   bounded, so with no `maxBuffer` on any CLI spawn, logged no foreign ending in 26 suites
   (586,560 tests).

What the probe did not show: no probe call exited 143 while it ran beside the suite. A single
suite, even at 20 workers, does not load this machine enough to hold phax for 60 ms after its last
write. A gate on a busier machine (other runs, a CI runner with 2 to 4 cores) does: the kills on
record came from such gates and from CI.

## Fix direction

**Test code, already avoided by phase-02. phase-05 makes it explicit and guarded.** This is not
phax production code and not an upstream bug. Node's `maxBuffer` is documented, and tsx relays a
SIGTERM it really received.

- The path: `spawnSync(…)` with no `maxBuffer` on a child that prints more than 1 MiB, with the
  result's `error` unread. Since phase-02, the 26 CLI-spawning suites call
  `boundedSpawn`/`boundedOutput` (`tests/helpers/boundedSpawn.ts`). Its spawning thread collects
  stdout and stderr with no cap (`runCall`: `stdout.push(chunk)`), so no call sends a signal for
  output size.
- What phase-05 should change:
  - `tests/integration/strayTermRegression.test.ts`: drive the path through which the sender
    reached the CLI spawn. Run `boundedSpawn(CLI_LAUNCHER, cliArgs("--json-schema"), { boundMs:
    CLI_BOUND_MS, env: phaxHomeEnv() })` and assert status 0, more than 1 MiB of stdout that
    parses as the whole catalogue, and no logged ending. To make it independent of the
    catalogue's size, also spawn a script that prints, say, 3 MiB through
    `node`/`CLI_LAUNCHER` and assert the full byte count. On the code from before (a plain
    `spawnSync` with no `maxBuffer`), the same call deterministically gets `error.code ===
    "ENOBUFS"` and a SIGTERM to the launcher. That is how to show it failing without depending
    on load.
  - `tests/helpers/boundedSpawn.ts` (optional): a one-line comment at the output collection
    saying the absence of a cap is deliberate (the root `--json-schema` is over 1 MiB), so nobody
    adds a `maxBuffer`-like limit back.
  - No change under `src/`: phax never signals a process it did not start.
- Left for phases 06 to 10, which move the remaining raw spawns: any `spawnSync`/`execFileSync`
  whose output can pass 1 MiB is fixed by the move itself. An `execFileSync` throws on `ENOBUFS`;
  only `spawnSync` hides it in `result.error`. phase-11's guard then keeps a raw `spawnSync` out.
- No upstream issue is needed. If the operator wants one, the only upstream oddity is tsx's: on a
  SIGTERM its launcher exits 143 even when its child exits 0 a few ms after the relay. Its 30 ms
  windows turn a child's exit status into the launcher's signal status under load. That is a
  design choice, not a sender, and this phase drafts no issue for it.

## CI (to fill at review)

The pull request's CI runs the suite with every CLI spawn bounded. A foreign-signal ending there
fails its test with a `diagnosis:` block. Paste each block here, with the job link:

- (none yet)
