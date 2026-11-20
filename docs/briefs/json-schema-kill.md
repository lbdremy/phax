Write the phax spec `json-schema-kill`, or fix it without one if the cause is plain: under the full suite, a test that
spawns `phax --json-schema` sometimes sees the child end with exit 143 (SIGTERM) and an empty stderr, instead of exit 0.

## Seen

- `tests/integration/phaseGuard.test.ts`, "lets phax --json-schema print the runner's catalogue": killed under the
  full suite, 2026-11-19 (`docs/specs/archive/2611191142-test-worlds-built-once.md` §1).
- `tests/integration/recordsJsonContracts.test.ts:145`, "--json-schema prints its entry, equal to the one in phax
  --json-schema": `all.status` 143, stderr empty, in the Gate step of the 0.41.0 release workflow on CI, 2026-11-20
  (run 44715706434, first attempt); it passed on retry, and passes alone in 6 s.
- `plansAnswersJson`'s `--json-schema` call: killed in a gate run of the last phase of `test-worlds-built-once`,
  2026-11-20.

Three different tests, one shape: the child is `tsx src/cli/main.ts … --json-schema` through `spawnSync` with no
`timeout` option, under a full, loaded suite. `test-worlds-built-once` observed it (q-143 `observe`) on the premise
that a lighter suite would remove it; the suite did not get lighter, and the kill came back.

## What to find

- **Who sends the SIGTERM.** `spawnSync` without `timeout` sends none itself; vitest's worker, `tsx`'s own watchdog, the
  CLI catching a signal and re-raising it, a test's cleanup killing a process group, or the OS. Reproduce under load
  (the full suite, or the three files with `stress` beside them) with the child's signal and its parent's pid logged.
- **Whether `--json-schema` is slow under load**: it builds the whole command catalogue's JSON Schema; how long it
  takes alone and under the full suite.
- **The fix where the cause is**, not a timeout raised in `vitest.config.ts` (protected, and settled out of
  `test-worlds-built-once`).
