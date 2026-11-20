# Measures: test worlds built once

Machine: 14 cores, vitest 5.1.0, Node v26.13.1, one machine for every run, nothing else heavy running.

- before: the tree of this change with `buildBranchTipWorld` put back to its base version
  (`tests/fixtures/records/branchTipRepos.ts` from 8601df67) and the four new test files set
  aside; the report's `commit` meta line therefore reads 26c29595, the commit the tree was
  built on. 22,512 tests (22,482 passed, 30 skipped).
- after: commit 26c29595, three full runs. 22,544 tests (22,514 passed, 30 skipped, 0 failed),
  that is the 32 new tests of the fixture's own four test files.

A first set of reports taken with the script as phase-01 wrote it had 171 tests failing
before and 172 after, because the script spawned vitest without `node_modules/.bin` on
`PATH` (tests spawn `tsx` by name; `pnpm test` puts it there). The script now sets `PATH`,
`compare` now also flags a new test that fails, and both the before and the three after
runs below were taken again with it.

## §6 block (run 1 of 3, as `compare` prints it)

```
Measures (14 cores, vitest 5.1.0), before -> after:
  suite wall time: 199.4 s -> 217.6 s
  sum of file times: 2271.2 s -> 2480.2 s
    integration: 2103.6 s -> 2318.5 s
    unit: 167.6 s -> 161.7 s

Integration files over 30 s, before -> after:
  recordsStatusBranch: 92.6 s -> 37.3 s
  heldStopRun: 87.2 s -> 98.4 s
  stopRecords: 83.3 s -> 93.0 s
  recordsBranchSync.acceptance: 66.2 s -> 51.5 s
  acceptancePairReview: 60.9 s -> 70.3 s
  heldStopClose: 59.3 s -> 69.4 s
  decideVerdicts: 57.2 s -> 58.6 s
  declaredStopClose: 45.5 s -> 50.3 s
  heldStopCommands: 44.8 s -> 51.5 s
  findingPullRequestLocal: 43.5 s -> 42.8 s
  decideArtifact: 43.3 s -> 39.8 s
  declaredStopRun: 42.6 s -> 48.6 s
  stopTranscripts: 42.4 s -> 45.8 s
  stopSecurityRecord: 37.6 s -> 43.5 s
  structuredAnswerFlags: 33.8 s -> 26.9 s
  recordsExplainStop: 31.1 s -> 36.2 s
  protectedPathsCheck: 30.8 s -> 26.0 s
  findingPost: 30.1 s -> 27.6 s
  recordsExplain: 29.8 s -> 30.6 s
  runList: 29.8 s -> 32.2 s
  inspectionCommandsJson: 18.7 s -> 30.1 s
```

## Across the three runs

| run    | wall   | sum of file times | integration | unit    | recordsStatusBranch | 300-record test |
| ------ | ------ | ----------------- | ----------- | ------- | ------------------- | --------------- |
| before | 199.4s | 2271.2 s          | 2103.6 s    | 167.6 s | 92.6 s              | 55,731 ms       |
| 1      | 217.6s | 2480.2 s          | 2318.5 s    | 161.7 s | 37.3 s              | 2,884 ms        |
| 2      | 198.6s | 2261.6 s          | 2105.0 s    | 156.5 s | 33.7 s              | under 10 s      |
| 3      | 208.4s | 2366.8 s          | 2165.0 s    | 201.8 s | 33.9 s              | under 10 s      |

The suite's wall time and sum of file times do not move beyond run-to-run noise: the suite
is saturated on 14 cores and the files over 30 s other than `recordsStatusBranch` and
`recordsBranchSync.acceptance` do not build branch-tip worlds. What moved is the target:
`recordsStatusBranch` went from 92.6 s to 34 to 37 s and
`recordsBranchSync.acceptance` from 66.2 s to 51.5 s in run 1.

## The 300-record test

"counts only the local-only records of a diverged branch sharing 300 with the remote":
55,731 ms before, 2,884 ms after (run 1), under 10 s: yes. Runs 2 and 3 are under 10 s as
well (see `compare`, "after under 10 s: yes").

## Test by test (each of the three runs, `compare`: "test-by-test check: ok")

- 22,512 tests compared: none missing, none failing, none newly skipped, none changed of project.
- 32 new tests, all in the fixture's own files: `tests/integration/bulkRecords.test.ts`,
  `tests/integration/worldCache.test.ts`, `tests/integration/worldCacheCleanupProbe.test.ts`,
  `tests/integration/branchTipWorldCache.test.ts`.

## Cached worlds left behind

`world-cache-left after the run: (none)` in each of the three runs (no new `phax-world-cache-*`
entry in the temporary directory).

## q-143

| run | phaseGuard "lets phax --json-schema print the runner's catalogue" | recordsJsonContracts "--json-schema prints its entry…" |
| --- | ----------------------------------------------------------------- | ------------------------------------------------------ |
| 1   | passed                                                            | passed                                                 |
| 2   | passed                                                            | passed                                                 |
| 3   | passed                                                            | passed                                                 |

Conclusion: gone. Neither test was killed with exit 143 in any of the three runs, and no
brief is owed. (In the first, discarded set of reports both failed, in the before too, with
`tsx` missing from `PATH`: a measuring-script defect, not exit 143.)
