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
  trailer and creates no checkpoint ref — absent, not empty.
- ~~Expected checkpoint tree path on `entire/checkpoints/v1`~~ — **superseded, see
  Results.** Verified on entire 0.10.0: one ref per checkpoint at
  `refs/entire/checkpoints/<last-2-of-ULID>/<ULID>`, tree at the ref root. The
  bullet below is the documented model, which 0.10.0 does not use; kept because
  the doc/ship mismatch is itself a stability finding.
- Documented (not shipped) tree path on `entire/checkpoints/v1`:
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

   Record the checkpoint-ref count printed by step 5 (there is no branch
   tip to record — see Results).

3. After the merge and PR publish, run it again with the merge commit:

   ```
   sh spikes/entire/02-checkpoint-lifecycle.sh entire-checkpoint-spike main <merge-sha>
   ```

   Compare the checkpoint-ref count against the pre-merge recording, and confirm
   on the GitHub PR that no checkpoint content appears (the refs must stay local;
   the harness checks `git ls-remote origin 'refs/entire/*'`).

4. Paste both raw outputs into `## Results`, complete the step table, then
   write `## Verdict`.

The five steps:

| #   | Step                                                              | Question it answers                                                                       |
| --- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1   | Trailer injection on every run-branch commit                      | did `prepare-commit-msg` inject `Entire-Checkpoint` from a linked worktree?               |
| 2   | Condensation into `refs/entire/checkpoints/`, tree per checkpoint | did `post-commit` condense from the worktree, and does the tree match the expected shape? |
| 3   | Phase-commit count vs checkpoint count                            | one checkpoint per phase commit, or many-to-one (fix-loop resume) / missing?              |
| 4   | Non-phase commits (artifact transitions, smoke)                   | is a session-less commit's checkpoint empty or absent?                                    |
| 5   | Merge and publish                                                 | which trailers survive the merge; are the checkpoint refs unmoved and still local-only?   |

## Results

Filled 2026-08-15 from the observed run, **pre-merge**. Steps 1–4 are settled;
step 5 is settled only for publish, not for merge — see the Verdict.

| #   | Step                            | Observed                                                                                                                                                                                                                                                                                                                                          |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Trailer injection from worktree | **5/5 phase commits** carry `Entire-Checkpoint` beside phax's `Run-Id`/`Phase-Id`/`Session-Id`. `prepare-commit-msg` fires from a linked worktree — hooks resolve from the common git dir.                                                                                                                                                        |
| 2   | Condensation + tree shape       | One ref **per checkpoint** at `refs/entire/checkpoints/<last-2-of-ULID>/<ULID>`, tree at the ref root: `metadata.json`, `0/metadata.json`, `0/full.jsonl`, `0/transcript.jsonl`, `0/prompt.txt`, `0/content_hash.txt`. Each ref is exactly 1 commit, trailered `Entire-Session` / `Entire-Strategy: manual-commit` / `Entire-Agent: Claude Code`. |
| 3   | Commit-to-checkpoint mapping    | 5 phase commits → 5 checkpoints → **5 distinct ids**. No many-to-one, no gap. (8 refs exist repo-wide; the extra 3 are from unrelated sessions — the namespace is repo-wide, not run-scoped.)                                                                                                                                                     |
| 4   | Non-phase commits               | `2685b57 chore(plans): complete 51-…` — phax's own path-scoped archival commit, no agent session — has **no trailer and no checkpoint**. Absent, not empty.                                                                                                                                                                                       |
| 5   | Merge and publish               | **Publish: safe.** `git ls-remote origin 'refs/entire/*'` is empty after the run auto-published; `refs/entire/*` sits outside `refs/heads/*` so a normal push does not carry it. **Merge: not yet observed** — the run is `review_open` and the branch is unmerged.                                                                               |

Repo weight (feeds phase-05's residual risks):

- 8 checkpoints, 49 blobs, **5,836,061 uncompressed bytes** total.
- Per phase checkpoint: 343 KB – 534 KB (largest `0/full.jsonl` in the run: 356 KB).
- **~2.2 MB for this 5-phase run.** These phases were cheap doc/shell work on
  `claude-fable-5`; an implementation run with a fix loop would be larger. JSONL
  compresses well, so packed cost is materially lower than the figures above.

> **Correction to this probe's original harness.** Steps 1, 3 and 4 read trailers
> and were correct as written. Step 2, the shadow-commit count, the merge check and
> the repo weighing all targeted a branch named `entire/checkpoints/v1` with
> `<first-2>/<rest>/` subtrees — the model entire's published docs describe, which
> 0.10.0 does not use. Two consequences worth keeping: the shard is the ULID's
> **last** two characters, so slicing the front fails even against the right
> namespace; and the "did it stay local?" check used `ls-remote --heads`, which
> cannot see `refs/entire/*` and would have passed silently no matter what was
> pushed.

## Verdict

1. **Is the checkpoint record complete across a full phax run? Pass.** Every
   agent-authored commit has exactly one checkpoint, with the full transcript tree
   behind it; phax's own bookkeeping commits have none. That boundary is the right
   one, and it is worth stating positively: a records layer built on entire covers
   what the agent did and is structurally blind to what phax did on its own.
2. **Does it survive merge and publish intact? Publish yes; merge unproven.** The
   run auto-published without leaking a single ref to `origin`. The merge half
   cannot be answered until the branch merges — checkpoints attach to the original
   commits, so the expectation is that a fast-forward preserves the mapping intact
   and a squash collapses several `Entire-Checkpoint` trailers onto one commit.
   Re-run this harness after merging and replace this sentence.

## Open questions

- **The merge, still open.** Fast-forward vs squash: does the mapping survive, and
  do multiple trailers land on one commit? Re-run post-merge.
- Does a fix-loop resume produce a second checkpoint for the same phase, or amend
  the first? No gate failed in this run.
- Can `git gc` prune checkpoint objects? `refs/entire/*` is a real ref namespace so
  they should be reachable, but this was not tested — and unlike a branch, nothing
  in the normal workflow ever mentions these refs.
- Nothing fetches or clones `refs/entire/*` by default. Good for exposure; it also
  means the record does **not** travel with the repo without extra refspec work —
  which cuts directly against the "run records travel with the repo" premise.
