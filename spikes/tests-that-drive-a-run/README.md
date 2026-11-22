# tests-that-drive-a-run measures

Measuring script for the spec `tests-that-drive-a-run` (§5.1–§5.3, §5.13–§5.14). It times the
suite per file and per test, traces every integration file over 10 s to see how much of each
test's git and shell work repeats a prefix an earlier test of the same file already drove, names
the covered files, and compares before and after test by test.

Everything is run from the repository root with `node`; the script spawns vitest's own binary
from `node_modules/.bin` (put on `PATH`, as `pnpm` does) and sets every variable itself.

## Files

- `measure.mjs` — the script (Node standard library only).
- `vitest.trace.config.mjs` — the integration project of `vitest.config.ts`, unchanged, plus one
  setup file.
- `trace-setup.mjs` — that setup file; inert unless `PHAX_MEASURE_TRACE_DIR` is set.
- `reports/` — gzipped reports. `before-1..3.tsv.gz`: three untraced full runs of the base tree.
  `trace-before.tsv.gz`: the traced run over every integration file over 10 s.
- `measures.md` — the tables (generated between `<!-- BEGIN generated: … -->` markers), the
  prefixes, the verdict, the coverage log the batch phases append to, and the after measures.

## Modes

```
# The whole suite (or the integration project), untraced, through vitest's JSON reporter:
node spikes/tests-that-drive-a-run/measure.mjs run --out spikes/tests-that-drive-a-run/reports/before-1.tsv.gz
node spikes/tests-that-drive-a-run/measure.mjs run --out /tmp/i.tsv.gz --project integration [--fresh]

# Some integration files only: each file's time and each test's state, and the prefix-log
# counts. --fresh sets PHAX_TEST_DRIVE_FRESH=1; --trace also takes the trace over them.
node spikes/tests-that-drive-a-run/measure.mjs files tests/integration/heldStopClose.test.ts
node spikes/tests-that-drive-a-run/measure.mjs files --fresh tests/integration/heldStopClose.test.ts
node spikes/tests-that-drive-a-run/measure.mjs files --trace /tmp/t.tsv.gz tests/integration/heldStopClose.test.ts

# The gate's `pnpm test` step, spawned as the gate runs it (no argument, output discarded):
node spikes/tests-that-drive-a-run/measure.mjs gate-step --out /tmp/gate.tsv

# The traced run, by default over every integration file whose median time in the plain
# reports is over 10 s (or over the files named after the reports):
node spikes/tests-that-drive-a-run/measure.mjs trace --out spikes/tests-that-drive-a-run/reports/trace-before.tsv.gz \
  --from spikes/tests-that-drive-a-run/reports/before-1.tsv.gz spikes/tests-that-drive-a-run/reports/before-2.tsv.gz \
  spikes/tests-that-drive-a-run/reports/before-3.tsv.gz

# The covered list, most repeated git processes first, each with its batch phase:
node spikes/tests-that-drive-a-run/measure.mjs verdict --from <plain report>… --trace <trace report>

# measures.md's generated sections (printed, or written in place with --write):
node spikes/tests-that-drive-a-run/measure.mjs table --from <plain report>… --trace <trace report> \
  [--gate <gate-step file>] [--write spikes/tests-that-drive-a-run/measures.md]

# The §6 block and the test-by-test check; one or more reports per side, medians when several:
node spikes/tests-that-drive-a-run/measure.mjs compare <before…> -- <after…> \
  [--allow-new tests/integration/sharedPrefix.test.ts]… [--verdict spikes/tests-that-drive-a-run/measures.md]
```

`compare` prints suite wall time, the sum of file times by tier, user and system CPU, files at
once (sum of file times over wall time), integration files over 30 s and every covered file (read
from `## Verdict` of measures.md) with the sum and whether it is at most half. It then checks
every before report against every after report: a test missing, no longer passing, newly
skipped, moved to another project, or new outside `--allow-new`. It exits 1 on any problem.

Every reader accepts `.tsv` and `.tsv.gz`; every writer gzips when the path ends in `.gz`.

## Plain report (`run`)

Tab-separated, one record per line, paths relative to the repository root:

- `M<TAB>key<TAB>value` — `wall-seconds`, `user-cpu-seconds`, `system-cpu-seconds` (from
  `/usr/bin/time -p`, `n/a` when it wrote none; the locale's decimal comma is read), `cores`,
  `vitest`, `node`, `commit` (`git rev-parse HEAD`), `prefix-log`
  (`<file>:driven=<n>,restored=<n>,fresh=<n>;…`, empty when the log has no line).
- `F<TAB>file<TAB>project<TAB>seconds` — one per test file (vitest's first test start to last
  test end).
- `T<TAB>file<TAB>project<TAB>full name<TAB>state<TAB>duration ms` — one per test. Two tests of a
  file sharing a full name are numbered in report order by the readers.

`PHAX_TEST_PREFIX_LOG` lines, which phase-02's fixture writes, are
`<repo-relative test file><TAB><prefix name><TAB>driven|restored|fresh`.

## Trace report (`trace`, `files --trace`)

- `M` lines — `trace-wall-seconds`, `cores`, `vitest`, `node`, `commit`, `from`, `files`.
- `TF<TAB>file<TAB>mode<TAB>git procs<TAB>git s<TAB>shell cmds<TAB>records<TAB>worktree add<TAB>worktree remove<TAB>hooks git<TAB>repeated git<TAB>share`
  — one per file; mode is `helper` or `sequence`.
- `TT<TAB>file<TAB>full name<TAB>state<TAB>git procs<TAB>git ms<TAB>subcommands<TAB>shell cmds<TAB>records<TAB>worktree add<TAB>worktree remove<TAB>prefix git<TAB>prefix params JSON<TAB>repeats<TAB>repeated git`
  — one per test, in run order, then one `(hooks)` row for the file's work outside any test.
  Subcommands are `name=count` pairs, most frequent first.
- `G<TAB>file<TAB>full name<TAB>segment kind<TAB>normalized argv JSON` — one per git process, in
  start order within each segment.
- `S<TAB>file<TAB>full name<TAB>segment kind<TAB>normalized argv JSON` — one per real shell
  command (a child that is not git), in the order started. **phase-11's command comparison reads
  these lines; keep their shape.**

Segment kinds: `prefix`, `own`, `hooks`. Normalized: temporary roots (`os.tmpdir()` and its
realpath, plus the first path component under it) become `<tmp>`, the repository root `<repo>`,
40- and 64-hex ids `<oid>`. Tests in a file are in run order; a repeated full name keeps its
place (number the repeats in order, as for `T` lines).

## Variables

- `GIT_TRACE2_EVENT` — set by trace-setup.mjs, per segment, to that segment's event file.
- `PHAX_MEASURE_TRACE_DIR` — set by `trace` / `files --trace` to a temporary directory; turns
  trace-setup.mjs on.
- `PHAX_TEST_DRIVE_FRESH` — set to `1` by `run --fresh` and `files --fresh`; unset otherwise.
  Inert until phase-02's fixture reads it.
- `PHAX_TEST_PREFIX_LOG` — always set to a temporary file; its lines are counted into the
  `prefix-log` meta line and the `files` output. Inert until phase-02's fixture writes it.

## How the trace sees a test

trace-setup.mjs, loaded after the project's own setup files:

1. A `beforeEach`, which runs before the file's own hooks, opens the test's `prefix` segment and
   points `GIT_TRACE2_EVENT` at it. The prefix stays open through the run-driving helpers' calls
   and ends at the first git process or shell command the test starts outside such a call; from
   there on the test is in its `own` segment. An `afterEach`, which runs after the file's own,
   puts the file back in its `hooks` segment.
2. `vi.mock` of `tests/helpers/heldRunFixture.ts` and `tests/helpers/stoppedRunFixture.ts` with
   `importOriginal` re-exports everything and wraps `createHeldWorld`, `startHeldRun`,
   `createWorld` and `stopRun` in plain functions (not `vi.fn`, so `vi.clearAllMocks` and
   `vi.restoreAllMocks` cannot reach them). Each call logs its parameters: the helper; for
   `startHeldRun` the hold, records on or off, the plan's title and a digest of its plan.md, a
   digest of the provider config JSON (`default` when none is passed), the acceptance command,
   and `prepare` when a `prepare` callback is passed; for `stopRun` the short name, provider,
   model, and `sessionId-undefined` when the first turn is made to fail. A `vi.mock` in a setup
   file reaches the test files in vitest 5.1.0: the first trace of `heldStopClose` alone showed
   every test's `createHeldWorld` and `startHeldRun` calls with their parameters.
3. `node:child_process` (`spawn`, `spawnSync`, `execFile`, `execFileSync`, `exec`, `execSync`) is
   patched in place through `createRequire` and `syncBuiltinESMExports()`. `boundedSpawn` and
   `boundedOutput` are wrapped through `vi.mock` of `tests/helpers/boundedSpawn.ts` too, because
   they start the child from a worker thread the patch does not reach. Every child that is not git
   is logged (argv, cwd). Where a call passes its own `env`, `GIT_TRACE2_EVENT` is set in a copy of
   it to the current segment, so a test that builds its own environment is traced as well and a
   CLI child's git lands in the segment the CLI was started in.
4. Nothing a test does changes: the wrappers call the originals with the same arguments, the only
   change to a child's environment is the trace variable.

## Prefix and share

- A test's prefix runs from the start of its first `beforeEach` to the first git process or shell
  command it issues outside a call of `createHeldWorld`, `startHeldRun`, `createWorld` or
  `stopRun`. Its parameters are the sequence of those calls with the parameters above. A prefix
  is repeated when an earlier test of the same file drove the same sequence; one with a one-off
  mark never repeats.
- In a file that calls none of those helpers (marked `sequence`), the repeated part of a test is
  the longest head of its normalized git argv sequence shared with an earlier test of the file.
- A file's share is the git processes in repeated prefixes (or repeated heads) over all its git
  processes, its hooks included. Covered: median file time of the plain runs over 10 s and share
  at least 0.5. The batch phase is the first plan list naming the file, else phase-10.
- Records written: git processes `read-tree --empty`, which only the records writer
  (`writeTreeCommit` in `src/infra/git.ts`, used by `src/app/recordPlumbing.ts` alone) issues,
  once per record commit; its `update-ref --stdin` names the ref on stdin, which the trace does
  not show. An `update-ref` naming `refs/heads/phax/records/v1` in argv is counted too.
  Worktrees: `git worktree add` and `git worktree remove` processes.
- Reports: `reports/gate-step.tsv` is the `gate-step` output that `table --gate` reads for the
  summary's last line.

## Blind spots

- None found on the check the plan asks for: the trace counts 2,025 git processes for
  `heldStopRun` and 2,492 for `stopRecords`, the brief's `GIT_TRACE` counts exactly.
- A git process started with an environment that has no `GIT_TRACE2_EVENT` is not counted. The
  wrappers add the variable to every explicit `env` they see, so the remaining gap is a child
  process (a spawned CLI) that builds a fresh environment for its own git.
- Shell commands are counted only where the test process starts them (through the patch or the
  `boundedSpawn` wrappers). A command a spawned CLI runs is part of that CLI's one entry.
- Records written: a record commit made by a spawned CLI is counted (its `read-tree --empty` is
  in the trace); an `update-ref` on the records ref is counted only when the ref is in argv.
- Files on the fake git layer (`makeFakeGit`) show no git process: that is the stand-in, not a gap.
- Tracing slows the traced files (130.9 s for the traced run over 58 files); file times are
  therefore always taken from the untraced runs.
