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
  shadow branch `entire/checkpoints/v1` at _(tip sha)_
- date: _(fill)_

Ground facts already established (2026-08-15, before this probe ran):

- Expected checkpoint tree path on `entire/checkpoints/v1` (from probe 02, which
  verifies rather than assumes it): `<xx>/<rest>/metadata.json` plus
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

Field inventory (step 2) — what desktop needs vs what the format carries:

| Desktop need              | metadata.json | transcript.jsonl | Notes |
| ------------------------- | ------------- | ---------------- | ----- |
| prompt text               |               |                  |       |
| tool name per call        |               |                  |       |
| file paths touched        |               |                  |       |
| timestamps                |               |                  |       |
| token counts              |               |                  |       |
| model id                  |               |                  |       |
| session id (for the join) |               |                  |       |

Join table (step 4) — one row per run-branch commit; blank cells break the
forward join, a checkpoint with no (or several) matching commits breaks the
reverse join:

| sha | Phase-Id | Session-Id | Entire-Checkpoint | Entire-Session | reverse match |
| --- | -------- | ---------- | ----------------- | -------------- | ------------- |
|     |          |            |                   |                |               |

Size per run (step 5, feeds phase-05's residual risks):

- bytes per checkpoint: _(fill from harness)_
- total files / uncompressed bytes on the shadow branch: _(fill)_

<!-- Raw harness output below, values redacted.
     Left empty until a real run fills it. -->

## Verdict

<!-- Must answer two questions explicitly:
     1. can desktop READ this from git alone (no entire binary)?
     2. is the phase <-> transcript join DETERMINISTIC in both directions?
     pass/fail + one line each. Left empty until Results is filled. -->

## Open questions

<!-- Anything the observation could not settle, for phase-05 to carry.
     Known candidates: does a squash merge collapse several Entire-Checkpoint
     trailers onto one commit, and can the join still be recovered per-phase
     from the shadow branch alone; does a fix-loop resume give one session two
     phases (breaking transcript -> phase uniqueness); is the `0/` directory a
     sequence (a second agent session on the same commit producing `1/`);
     whether metadata.json carries an explicit schema version or only the
     branch-name v1. -->
