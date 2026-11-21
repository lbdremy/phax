# Twenty full suites in a row: record

## Machine and command

- The operator's macOS machine, 14 cores (as in findings.md), Darwin 27.0.0, Node 26.13.1,
  vitest 5.1.0, tsx 4.23.15, on 2026-11-21, at phase-12's base. `PHAX_E2E_RUN` unset.
- Command: `node spikes/bounded-test-spawns/repro.mjs --runs 20 --load gate --out /tmp/p12-out`.
  Each round runs the standard profile's every-phase local steps before the suite (format check,
  typecheck, test:type, lint), then `node_modules/.bin/vitest run` with `node_modules/.bin` first on
  PATH, as `pnpm test` does, with `PHAX_SPAWN_DIAG_LOG` on. One suite per round.

## Runs

Every run: vitest exit 0, 22,580 tests, 0 failed, 0 vitest worker losses.

| run | seconds | result | failed tests | non-normal endings in the diagnostic log                          |
| --- | ------- | ------ | ------------ | ----------------------------------------------------------------- |
| 1   | 203.0   | passed | 0            | 6, all from `boundedSpawn.test.ts` (caused on purpose), 0 foreign |
| 2   | 191.2   | passed | 0            | same: 6 / 0 foreign                                               |
| 3   | 192.9   | passed | 0            | same                                                              |
| 4   | 197.4   | passed | 0            | same                                                              |
| 5   | 206.0   | passed | 0            | same                                                              |
| 6   | 188.6   | passed | 0            | same                                                              |
| 7   | 190.4   | passed | 0            | same                                                              |
| 8   | 189.0   | passed | 0            | same                                                              |
| 9   | 192.0   | passed | 0            | same                                                              |
| 10  | 187.7   | passed | 0            | same                                                              |
| 11  | 188.7   | passed | 0            | same                                                              |
| 12  | 202.4   | passed | 0            | same                                                              |
| 13  | 187.5   | passed | 0            | same                                                              |
| 14  | 190.4   | passed | 0            | same                                                              |
| 15  | 189.3   | passed | 0            | same                                                              |
| 16  | 196.6   | passed | 0            | same                                                              |
| 17  | 192.3   | passed | 0            | same                                                              |
| 18  | 190.3   | passed | 0            | same                                                              |
| 19  | 194.7   | passed | 0            | same                                                              |
| 20  | 193.1   | passed | 0            | same                                                              |

## Totals

- 20 of 20 suites passed; 451,600 tests ran, 0 failed, 0 worker losses.
- 120 non-normal endings logged, all 120 from `tests/integration/boundedSpawn.test.ts`, which
  causes each kind on purpose: 40 `bound`, 40 `signal`, 20 `exit` (the relayed 143), 20
  `spawn-error`. 0 foreign: no CLI spawn anywhere else ended on a signal or with status 143.
- No `diagnosis:` block was raised by any test other than the ones that expect it.

## Suite time against 210 s

Suite seconds: min 187.5, max 206.0, mean 193.2 (sum 3,863 s over 20). The 210 s measured before
this change (`test-worlds-built-once`) becomes about 193 s, so the bounded spawn, with its
worker thread (about +0.5 ms per call), did not slow the suite on this machine.

## CI runs (filled at review)

The CI test job, run 10 times on the pull request. For each run, the job link, passed or failed,
and any `diagnosis:` block:

Workflow run 44928452545 on 2adb40a0 (the review fixes), attempt 1 from the push and attempts 2 to 10
rerun one after another on 2026-11-21. Every attempt passed, so no test threw and no `diagnosis:` block was
written; findings.md gains nothing.

| Attempt | Job | Result | Job time |
| --- | --- | --- | --- |
| 1 | [136919617257](https://github.com/lbdremy/phax/actions/runs/44928452545/job/136919617257) | passed | 16 min 35 s |
| 2 | [136927039876](https://github.com/lbdremy/phax/actions/runs/44928452545/job/136927039876) | passed | 10 min 45 s |
| 3 | [136930207747](https://github.com/lbdremy/phax/actions/runs/44928452545/job/136930207747) | passed | 10 min 48 s |
| 4 | [136933332011](https://github.com/lbdremy/phax/actions/runs/44928452545/job/136933332011) | passed | 16 min 51 s |
| 5 | [136938390247](https://github.com/lbdremy/phax/actions/runs/44928452545/job/136938390247) | passed | 13 min 51 s |
| 6 | [136942566846](https://github.com/lbdremy/phax/actions/runs/44928452545/job/136942566846) | passed | 12 min 18 s |
| 7 | [136946017612](https://github.com/lbdremy/phax/actions/runs/44928452545/job/136946017612) | passed | 10 min 46 s |
| 8 | [136949161018](https://github.com/lbdremy/phax/actions/runs/44928452545/job/136949161018) | passed | 12 min 22 s |
| 9 | [136952904833](https://github.com/lbdremy/phax/actions/runs/44928452545/job/136952904833) | passed | 10 min 55 s |
| 10 | [136956076548](https://github.com/lbdremy/phax/actions/runs/44928452545/job/136956076548) | passed | 16 min 41 s |
