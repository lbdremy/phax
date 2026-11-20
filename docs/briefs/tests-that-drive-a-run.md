Write the phax spec `tests-that-drive-a-run`: the integration tests that drive a whole phax run (start it, stop it,
close it, resume it) take a fraction of their time, and so does the suite, while each still checks what it checks
today against real git. A change to the tests only; phax gains no feature.

## Why

`test-worlds-built-once` (PR #253, 2026-11-20) made the worlds of `buildBranchTipWorld` cheap: `recordsStatusBranch`
went from 93 s to about 35 s, its 300-record test from 56 s to 3 s. The suite did not move: 199 s of wall time
before, 199 to 218 s after, on 14 cores (`spikes/test-worlds/measures.md`). The suite is saturated, and its other slow
files spend their time in the run each test drives, not in building a world: `createHeldWorld` and `createWorld`
init one repository with one commit, about one second of `heldStopRun`'s 94 s.

`pnpm test` still fires at every phase of every run, about 3.5 minutes each.

## Measures (main at 0c6135c1, 2026-11-20, 14 cores, vitest 5.1)

- 21 integration files over 30 s, 1,082 s together; after #253, still 19 of them, the same files minus the two
  branch-tip ones.
- The slowest that drive a run: `heldStopRun` 94 s (18 tests), `stopRecords` 86 s (9), `acceptancePairReview` 67 s
  (12), `heldStopClose` 64 s (19), `decideVerdicts` 59 s (99), `heldStopCommands` 47 s, `declaredStopClose` 47 s,
  `declaredStopRun` 46 s, `stopTranscripts` 43 s, `stopSecurityRecord` 38 s.
- They call phax's use cases in process (`dispatch`, `closeStop`, `startHeldRun`, `stopRun`) with the real
  `NodeGitLayer` and `NodeShellLayer` and a fake backend: every phase worktree, branch, commit, gate command and
  record write is a real git or shell process.

## What the spec must cover

- **Where the time goes, measured first**, per file and per test: git processes (count and time, `GIT_TRACE`), gate
  commands run through the shell, records written, worktrees added and removed; and how much of it each test repeats
  that the test before it in the file already did (the same run started, held, stopped).
- **What can be shared without hiding behaviour:** a run driven to a state once per file and copied per test, as
  `test-worlds-built-once` copies a world (its decisions apply: per file, directory copy, no path back to the cached
  copy); gate commands that are a stand-in already (`true`, a script) kept cheap; what must stay per test because it is
  what the test checks.
- **The suite as a whole:** whether the saturation on 14 cores moves once these files are cheaper, and what the
  every-phase gate then waits.

## Settled (do not reopen)

1. The tests check what they check today: no assertion removed, no test skipped or moved out of the gate.
2. Real git and real shell, as `test-worlds-built-once` settled.
3. Nothing under `src/` changes.
