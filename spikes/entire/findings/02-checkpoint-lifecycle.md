# Findings: checkpoint lifecycle through worktree, merge and publish

<!--
Environment and Procedure are filled at authoring time; Results and Verdict are
filled out-of-band from a real run, per the spike's execution-model caveat.
Never paste raw transcript content — this is a public repo. Report field
names, shapes and sizes; redact values.
The teardown record for the whole spike lives in findings/01-hooks-in-jail.md
— do not duplicate it here.
-->

## Environment

<!-- Fill from the observed run: -->

- entire version: _(from `entire --version`; harness authored against 0.10.0)_
- phax version / commit: _(fill)_
- OS: _(fill)_
- repo state: `lbdremy/phax`, run branch `phax/entire-checkpoint-spike`,
  enablement committed at _(sha)_
- date: _(fill)_

Ground facts already established (2026-08-15, before this probe ran):

- phax commits via plain `git commit -m <subject> -m <body>` with **no
  `--no-verify`** (`src/infra/git.ts`), so `prepare-commit-msg` and `post-commit`
  fire on every phase commit — from inside a **linked worktree**, whose hooks
  resolve from the common git dir.
- phax also makes **path-scoped artifact-transition commits** through the same
  commit port (the path-scoped variant in `src/infra/git.ts`); those have no
  agent session behind them.
- The smoke commit (README step 3) already answered the simplest non-agent case:
  a manual commit with no completed session gets **no** `Entire-Checkpoint`
  trailer and creates no shadow branch — absent, not empty.
- Expected checkpoint tree path on `entire/checkpoints/v1`:
  `<xx>/<rest>/metadata.json` plus `0/full.jsonl`, `0/transcript.jsonl`,
  `0/prompt.txt`, where `<xx>/<rest>` splits the checkpoint id after two
  characters. The harness verifies this shape instead of assuming it.

## Procedure

1. Complete the observed run per the README (enable → commit enablement → smoke
   → `phax run` this plan). This probe assumes the hooks ran (probe 01's
   question) and looks only at git-visible effects.
2. From the repo root, **before** the run branch merges:

   ```
   sh spikes/entire/02-checkpoint-lifecycle.sh entire-checkpoint-spike
   ```

   Record the `entire/checkpoints/v1` tip printed by step 5.

3. After the merge and PR publish, run it again with the merge commit:

   ```
   sh spikes/entire/02-checkpoint-lifecycle.sh entire-checkpoint-spike main <merge-sha>
   ```

   Compare the shadow tip against the pre-merge recording, and confirm on the
   GitHub PR that no checkpoint content appears (the shadow branch must stay
   local; the harness also checks `git ls-remote origin 'entire/*'`).

4. Paste both raw outputs into `## Results`, complete the step table, then
   write `## Verdict`.

The five steps:

| #   | Step                                                                | Question it answers                                                                       |
| --- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1   | Trailer injection on every run-branch commit                        | did `prepare-commit-msg` inject `Entire-Checkpoint` from a linked worktree?               |
| 2   | Condensation onto `entire/checkpoints/v1`, tree path per checkpoint | did `post-commit` condense from the worktree, and does the tree match the expected shape? |
| 3   | Phase-commit count vs checkpoint count                              | one checkpoint per phase commit, or many-to-one (fix-loop resume) / missing?              |
| 4   | Non-phase commits (artifact transitions, smoke)                     | is a session-less commit's checkpoint empty or absent?                                    |
| 5   | Merge and publish                                                   | which trailers survive the merge; is the shadow branch unmoved and still local-only?      |

## Results

| #   | Step                            | Observed |
| --- | ------------------------------- | -------- |
| 1   | Trailer injection from worktree |          |
| 2   | Condensation + tree path shape  |          |
| 3   | Commit-to-checkpoint mapping    |          |
| 4   | Non-phase commits               |          |
| 5   | Merge and publish               |          |

Shadow-branch repo weight (feeds phase-05's residual risks):

- total uncompressed blob bytes: _(fill from harness)_
- largest transcript blob: _(bytes + path; do not paste content)_

<!-- Raw harness output below (pre-merge run, then post-merge run).
     Left empty until a real run fills it. -->

## Verdict

<!-- Must answer two questions explicitly:
     1. is the checkpoint record COMPLETE across a full phax run?
     2. does it SURVIVE merge and publish intact?
     pass/fail + one line each. Left empty until Results is filled. -->

## Open questions

<!-- Anything the observation could not settle, for phase-05 to carry.
     Known candidates: does a squash merge collapse several
     Entire-Checkpoint trailers onto one commit or drop all but one (feeds
     phase-04's join analysis); does a fix-loop resume produce a second
     checkpoint for the same phase commit or amend the first; does garbage
     collection ever prune the shadow branch if it is the only ref to its
     objects. -->
