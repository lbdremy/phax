Write the phax spec `fewer-git-processes`: phax starts fewer git processes for the same work. A phase's start, its
commit and its record write the same refs, trees and records as today, in fewer processes, and a test counts the
processes of one phase so the number cannot creep back up.

## Why

On 2026-11-22 the suite was measured file by file (`spikes/tests-that-drive-a-run/measures.md`, the trace over every
integration file above 10 s). Its time is each test's own work, and about half of that work is git processes:

- `heldStopRun` spends 40.7 s of its 81.0 s in 2,025 git processes, `stopRecords` 44.5 s of 76.1 s in 2,492,
  `recordsBranchSync.acceptance` 46.0 s of 47.4 s in 1,326.
- Under the suite's load a git process costs about 20 ms (40.7 s over 2,025); alone, about 4 ms.

Sharing the tests' setup between tests was measured in the same spike and stopped: the prefixes the tests repeat are
small (`tests-that-drive-a-run`, NEXT_STEPS §7). What is left is the number of processes each step of phax takes.
One held run with records on, two phases on the fake agent and gate (`heldStopRun`, "held at phase-02, records on"),
is 60 git processes: 7 for the test's repository, then for each phase about 15 to branch, open the worktree, commit
and diff, and 23 to write its record.

The trace over the measured files (34,354 git processes, `reports/trace-before.tsv.gz`) shows where they go:

| command                                                          | processes | share |
| ---------------------------------------------------------------- | --------: | ----: |
| `config --local` (the tests' setup; phax never sets a key)       |     4,082 | 11.9% |
| `rev-parse` (`--verify`, `HEAD`, `--show-toplevel`, other forms) |     5,985 | 17.4% |
| `hash-object -w --stdin` (one per record file)                   |     1,945 |  5.7% |
| `read-tree`, `update-index`, `write-tree`, `commit-tree`         |     3,416 | 10.0% |

Who gains, honestly: the suite first, since every test that drives phax pays each process thousands of times over.
Interactive commands that walk records (`phax records explain`, `phax prune`, `phax finding`) answer sooner. A real
run gains little: about 40 processes a phase is about 1 s against minutes of agent and gate.

## What phax has today, to read first

- `src/infra/git.ts`: every git process phax starts. The records writer (about line 225: one `hash-object -w --stdin`
  per file, `read-tree --empty`, `update-index --index-info`, `write-tree`, `commit-tree`, `update-ref --stdin`);
  the protected-paths hashing, which already uses one `hash-object --stdin-paths` for every file (about line 627);
  `diff-tree --stdin` comparing many commits in one process (about line 174), the precedent.
- `src/ports/git.ts`: the port's operations. One operation is often one process today; the spec says whether that
  stays a rule.
- The phase start (`branch`, the two `rev-parse --verify` of the same branch, `worktree add`; `worktree add` itself
  runs `symbolic-ref` and `reset --hard` as nested git, which phax does not choose) and the phase commit
  (`rev-parse HEAD` twice, `diff HEAD^ HEAD` then `diff --name-status HEAD^ HEAD`).
- `tests/helpers/isolateGit.ts` and the 91 test files that set `user.email`, `user.name` and the rest with one
  `git config --local` each.
- The spike's tooling (`spikes/tests-that-drive-a-run/measure.mjs trace`), which counts git processes per test through
  `GIT_TRACE2_EVENT` and can measure the result.
- NEXT_STEPS "Small follow-ups": "A record commit hashes its files one git process each", folded into this spec.

## What to decide

- **The record write.** One process for every blob (`hash-object -w --stdin-paths` from files, or `--stdin` framing),
  the tree built without a scratch index (`mktree`, one per directory, or `--batch`), or the whole commit through one
  `git fast-import`. Whichever it is, the record's tree and commit are the same objects as today's for the same input,
  and the ref still moves by compare-and-swap.
- **Repeated reads inside one command.** The same branch checked twice, `HEAD` read twice, two diffs of the same pair:
  merged into one call where one step makes both, or kept where the second read guards against a change in between.
  Say which reads guard something and keep those; no cache that outlives one command.
- **The test setup.** The repository a test makes takes one `git init` plus a `git config --local` per key. One
  shared helper that writes them in one process (or one `git init` that carries them), adopted by the 91 files or by
  the ones that drive a run; the tests never read the global git config either way.
- **A process budget as a test.** A test that runs one phase (and its record) through the real git adapter and
  counts its git processes against a stated number, failing when it grows; or a count printed by the spike tooling
  and read by hand. Say what the number covers (phax's own processes, not git's nested ones).
- **Scope.** Indicatively the record write, the phase start and commit, and the test setup; the reads of `phax
  records explain` and `phax prune` named and measured, left for later if they need a new port operation.

## Constraints

- No change to what phax writes: the same refs, trees, commits and record files for the same input, so records written
  before and after read the same and no persisted format moves.
- All git through the `Git` port and `src/infra/git.ts`; a new operation is a port operation with its adapter test.
- No dependency on a git newer than the one CI and the documented floor run; check the floor before using a flag.
- A test never reads the operator's global git config or a real `~/.phax`.
