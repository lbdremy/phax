# Harness data spike

What does phax's harness cost the agent, read from the records phax already keeps? The
companion of [`docs/ideas/harness-from-records.md`](../../docs/ideas/harness-from-records.md),
which holds the framing and the open questions. Python 3, standard library only; reads a
records repository, writes only into a scratch directory.

```sh
# every section, on this repository's records
python3 spikes/harness-data/harness_data.py

# another project, one section, snapshots unpacked somewhere you choose
python3 spikes/harness-data/harness_data.py --records ~/.phax/records/<project> \
  --section feedback --work /tmp/phax-harness-data/<project>
```

## What it relies on

- **Records keep every snapshot.** `~/.phax/records/<project>` is a git repository whose
  every commit holds one record (a phase, an authoring session, a decision, a review);
  the branch tip shows only the last. The script unpacks every commit with `git archive`
  (paths are run-scoped, so they do not collide). Pruning runs and worktrees does not
  touch this history: on 2026-11-04 it held 485 commits, 77 runs, 526 transcripts.
- **Transcripts are timestamped.** Each `tool_use` (assistant event) and its
  `tool_result` (user event) carry a `timestamp`; the difference is the command's wall
  time as the agent saw it, including any load from phases running in parallel.
- **Resumed sessions report cumulative cost** (Claude Code ≥ 2.1.280): a
  `fix-attempt-NN.jsonl` total includes the phase it resumes. Compare deltas, never sums.
- **Command classes are heuristic.** `pnpm test` with a file, directory, `-t` or filter
  argument counts as _targeted_, without as _whole_. Good enough for orders of magnitude.

## Sections

| Section       | Question                                                                    |
| ------------- | --------------------------------------------------------------------------- |
| `sessions`    | what each kind of session (phase, fix, authoring, decision) spends calls on |
| `feedback`    | how long the agent waits on its feedback commands, and the trend by month   |
| `feedforward` | how big the context is before the agent acts; which skills/memory it got    |
| `gates`       | which gate step and lint rule failed on the first attempt                   |

## Findings, 2026-11-04 (phax records)

- **Feedback is 27% of phase wall time** (14.0 h of 52.4 h). The agent's own
  whole-suite `pnpm test` runs are the largest share: 6.7 h over 403 calls, against
  1.3 h over 1,193 targeted calls. Median whole-suite run: 20 s (Aug), 17 s (Sep),
  34 s (Oct), 151 s (Nov, n=41). Today the suite takes 270 s wall (`test:unit` 33 s);
  integration is 92% of it and 71% of the time comes from test files added in October
  (`vitest --reporter=json`, file creation dates from git). `typecheck` 1.3 s → 2.3 s,
  `format` 1.0 s → 3.2 s over the same months.
- **Feed-forward is ~50k tokens at the first turn** of a phase (30k–87k), ~49k for
  authoring, ~157k for a decision. Phase sessions load a median 64 skills (max 77,
  up from 32), of which the repository supplies 16; every session (465/465) loaded the
  maintainer's auto-memory index. Neither is in the repository, so neither is portable
  nor recoverable from `sourceSha`.
- **Phase exploration is already tight**: 9 tool calls before the first edit (median,
  14% of the session), 13% of `Read` calls re-read a file, 87% of files read end up
  changed. Authoring is where exploration lives: 99% Grep/Read/Glob, ~18 distinct files
  per session, the same few (`phax.json`, `NEXT_STEPS.md`, `README.md`) in most of them.
- **Gate retries**: 59 of 318 phases needed a second attempt; 50 of them for one lint
  rule (`unicorn(consistent-function-scoping)`). Not a problem in itself — the loop did
  its job, at a marginal ~$0.20 and ~30 s of agent time each, plus a gate rerun.

## Isolation check, 2026-11-04

One-turn Haiku sessions in this repository, `init` event read (see the idea doc's table):
`--setting-sources project,local` plus `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` drops user
skills, plugins, hooks, rules and auto-memory under OAuth; first-turn context 35.5k →
21.4k. Reproduce with `claude -p … --output-format stream-json --verbose --max-turns 1`
and `jq 'select(.subtype=="init")'`.

## Files

- `harness_data.py` — the report.
- `literature.md` — the literature review (≈30 sources, 2024–2026; entries seen only
  through secondary coverage are marked), with questions to ask of the records and a
  protocol for judging a harness change.
