# Findings: checkpoint format readability and the phax join

<!--
Environment and Procedure are filled at authoring time; Results and Verdict are
filled out-of-band from a real run, per the spike's execution-model caveat.
Never paste raw transcript content — this is a public repo. Report field
names, shapes and sizes; redact values (including metadata.json values, which
the harness prints whole).
The teardown record for the whole spike lives in findings/01-hooks-in-jail.md
— do not duplicate it here.
-->

## Environment

<!-- Fill from the observed run: -->

- entire version: _(from `entire --version`; harness authored against 0.10.0)_
- phax version / commit: _(fill)_
- OS: _(fill)_
- jq available: _(yes/no — without it the field inventories degrade to sizes)_
- repo state: `lbdremy/phax`, run branch `phax/entire-checkpoint-spike`,
  checkpoint refs under `refs/entire/checkpoints/**` (8 at the time of the run)
- date: _(fill)_

Ground facts already established (2026-08-15, before this probe ran):

- Checkpoint tree path, **corrected against entire 0.10.0** (see Results): one
  ref per checkpoint at `refs/entire/checkpoints/<last-2-of-ULID>/<ULID>` with the
  tree at the ref root. The documented model below is what the harness was first
  written against and is NOT what ships: `<xx>/<rest>/metadata.json` plus
  `0/full.jsonl`, `0/transcript.jsonl`, `0/prompt.txt`, where `<xx>/<rest>`
  splits the checkpoint id after two characters.
- phax's own commit trailers (`Run-Id`, `Short-Name`, `Phase-Id`, `Phase-Title`,
  `Model`, `Effort`, `Session-Id`, `Gate-Log`) sit in the same commit message as
  entire's `Entire-Checkpoint`, so the forward join is a same-commit read.
- Multi-value trailer extraction (a squash merge can carry several
  `Entire-Checkpoint` trailers on one commit) uses
  `%(trailers:key=K,valueonly,separator=%x0a)` — the same idiom as probe 02.

## Procedure

1. Complete the observed run and probes 01–02 per the README. This probe assumes
   checkpoints exist and reads git state only; the `entire` binary is never
   invoked — that is the point of step 1.
2. Pick one phase commit from probe 02's step-1 table and run, from the repo
   root:

   ```
   sh spikes/entire/03-format-and-join.sh <phase-commit-sha>
   ```

   (Or pass the `Entire-Checkpoint` id directly. Optional second/third args:
   the run short name — default `entire-checkpoint-spike` — and the base ref —
   default `main`.)

3. Paste the raw output into `## Results` **after redacting all values** from
   the printed `metadata.json`, complete the two tables below, then write
   `## Verdict`.

The five steps:

| #   | Step                                | Question it answers                                                                          |
| --- | ----------------------------------- | -------------------------------------------------------------------------------------------- |
| 1   | Raw-git read of one checkpoint tree | can desktop render a checkpoint from git alone, without shelling out to the `entire` binary? |
| 2   | Field inventory                     | do metadata.json / transcript.jsonl carry what the "inspect a run" screen needs?             |
| 3   | Format stability signals            | how safe is reading the format directly (v1 branch name, version fields, append-only JSONL)? |
| 4   | The join, both directions           | are phase → transcript and transcript → phase deterministic, and what breaks them?           |
| 5   | Size per run                        | what does the desktop screen pay per run, per checkpoint?                                    |

## Results

Filled 2026-08-15 from checkpoint `01M030KTF52JZ2WT2KDVE30AGF` (phase-01) and the
run's full join. Read entirely with `git for-each-ref` / `git show` / `git ls-tree`
— **the `entire` binary was never invoked.**

Field inventory (step 2) — what desktop needs vs what the format carries. Two
metadata files exist: `metadata.json` at the ref root (checkpoint-level) and
`0/metadata.json` (session-level, richer).

| Desktop need              | metadata.json     | 0/metadata.json       | transcript.jsonl      | Notes                                                        |
| ------------------------- | ----------------- | --------------------- | --------------------- | ------------------------------------------------------------ |
| prompt text               | —                 | `prompt_attributions` | `content[].text`      | also whole in `0/prompt.txt` (45 KB for phase-01)            |
| tool name per call        | —                 | —                     | `content[].name`      | observed `Bash`, `Write`; with `.input` and `.result.status` |
| file paths touched        | `files_touched[]` | `files_touched[]`     | inside tool inputs    | checkpoint-level list is the cheap one to render             |
| timestamps                | —                 | `created_at`          | `ts` per record       | `full.jsonl` also has `timestamp` per record                 |
| token counts              | `token_usage`     | `token_usage`         | `input/output_tokens` | input, cache_creation, cache_read, output, api_call_count    |
| model id                  | —                 | **`model`**           | —                     | session-level only                                           |
| session id (for the join) | —                 | **`session_id`**      | —                     | also the `Entire-Session` commit trailer                     |

**All seven are present.** Nothing desktop needs is missing from the format.

Join table (step 4) — `Entire-Session` is read from the **checkpoint commit**, not
from the phax commit (it never appears there):

| sha       | Phase-Id | Session-Id  | Entire-Checkpoint            | join | reverse match |
| --------- | -------- | ----------- | ---------------------------- | ---- | ------------- |
| `a726aff` | phase-01 | `b5218d40…` | `01M030KTF52JZ2WT2KDVE30AGF` | OK   | `a726aff` (1) |
| `39080d3` | phase-02 | `9154050c…` | `01M030V4YH9NRFMKYHRVH54A2T` | OK   | `39080d3` (1) |
| `0d23c1d` | phase-03 | `0fb3446b…` | `01M031RBED5CE2330EQGRXJE5P` | OK   | `0d23c1d` (1) |
| `4bef12c` | phase-04 | `6d081cc4…` | `01M032WN4BDQ675PP31E2YR6MB` | OK   | `4bef12c` (1) |
| `ffa1ed4` | phase-05 | `41e5fd50…` | `01M034VBDEYPYF50ZRM3E4E2N9` | OK   | `ffa1ed4` (1) |
| `2685b57` | —        | —           | — (archival commit)          | —    | —             |

Format stability (step 3):

- Storage path is **unversioned** (`refs/entire/checkpoints/…`), while the docs
  describe a versioned `entire/checkpoints/v1` branch. The layout moved; its
  version marker did not move with it.
- Versioning lives in the payload instead: `cli_version: "0.10.0"` in both metadata
  files, and `"v":1` on every transcript record. A reader must open a checkpoint to
  learn how to read it.
- 13/13 transcript lines parse as standalone JSON; each checkpoint ref is exactly
  1 commit (no in-place rewriting observed).

Size per run (step 5):

- Per checkpoint in this run: 343 KB – 534 KB.
- All 8 refs in the repo: 46 files, **5,002,178 uncompressed bytes**; the 5 run
  checkpoints account for ~2.2 MB. Uncompressed JSONL — packed cost is lower.

## Verdict

1. **Can desktop read this from git alone? Pass.** Every figure in this document
   came from plain git plumbing against a ref namespace; no third-party binary, no
   parsing beyond JSON/JSONL. A run-inspection screen would be a git reader, not a
   shell-out — and the whole field inventory it needs is present.
2. **Is the join deterministic in both directions? Pass, 5/5 both ways.** Forward:
   `Session-Id` → `Entire-Checkpoint` → ref → `Entire-Session`, matching every
   time. Reverse: every run checkpoint maps back to exactly one commit. The join is
   doubly anchored — by checkpoint id and by session id — so either alone suffices.
   Caveat: the namespace is repo-wide, not run-scoped, so a reverse walk sees
   checkpoints from unrelated sessions (`NONE` rows) and must filter by run.

The unproven case for both answers is the squash merge, which would collapse
several `Entire-Checkpoint` trailers onto one commit. None existed to observe here.

## Open questions

<!-- Anything the observation could not settle, for phase-05 to carry.
     Known candidates: does a squash merge collapse several Entire-Checkpoint
     trailers onto one commit, and can the join still be recovered per-phase
     from the shadow branch alone; does a fix-loop resume give one session two
     phases (breaking transcript -> phase uniqueness); is the `0/` directory a
     sequence (a second agent session on the same commit producing `1/`);
     whether metadata.json carries an explicit schema version or only the
     branch-name v1. -->
