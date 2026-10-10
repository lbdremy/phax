---
status: Completed
date: 2026-10-10
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
approved:
  date: 2026-10-10
  baseline: 197f37a
---
# Gate attempt records

## 1. Context

Each phase has a folder of gate-attempt files. Attempt NN writes `checks-attempt-NN.log`, `checks-attempt-NN.request.json` when a step declares `input: "gate-request"`, and one `checks-attempt-NN.report-SS.json` for each readable gate report, SS being the step's position among the steps the attempt runs. The fix attempt that answers the failure of attempt NN writes its transcript as `fix-attempt-NN.jsonl`. The request and the reports are written while the attempt runs. The log, and the phase's single `gate-attribution.json` (`{phase, steps: [{command, surface, result}]}`, overwritten by each attempt), are written only when the attempt ends. Three readers rely on these files. The fix prompt marks a finding `still failing` when the same step's checked report in the previous attempt listed its id (guarantee-reports §5.27). The review handoff gathers review notes from the phase's last attempt, the highest-numbered log (§5.36). `phax records explain --gates` prints each attempt's log, request and reports in number order (§5.42). Attempt numbering continues, from the highest two-digit `checks-attempt-NN.log` in the folder, on one path only: resuming a phase paused at its gate, either because attempts ran out or because of a refusal, which reuses that pause (§5.21). A resume after a rate or usage limit, or after an interruption, re-enters the phase through its agent turn and then runs the gate from attempt 1. Brief records already number one above the highest existing `brief-NN.json`. The shell adapter decodes a step's stdout and stderr chunk by chunk, as each chunk arrives.

Ground read:

- `src/app/executePlan.ts` — maxAttemptIndexInPhaseFolder scans the phase folder with readdirSync for `checks-attempt-(\d{2}).log` only; resumeAttempt is set only when the resumed phase is `gates_exhausted`; runGatesWithFixLoop gets `startAttempt: resumeAttempt + 1` only on that path, so every other entry starts at 1. Commit trailer passes `checks-attempt-01.log` as Gate-Log.
- `src/app/fixLoop.ts` — logPath(attempt) names `checks-attempt-NN.log`; fix transcripts are `fix-attempt-NN.jsonl` with the gate attempt's number; previousFindingIds reads `reportPathFor(logPath(attempt - 1), step)`, with step being the failing step's position.
- `src/app/gates.ts` — The attempt log holds `$ <command>`, optional `stdin: <request>`, then the step's stdout, replaced by `report: <file>` for a readable report. Request and reports are written during the attempt; the log and the per-phase gate-attribution.json ({phase, steps:[{command, surface, result}]}) only when it ends.
- `src/domain/gate/reportPath.ts` — Reports are `checks-attempt-NN.report-SS.json`, SS being the step's position among the steps the attempt runs; parseReportName accepts two or more digits.
- `src/app/loadReviewHandoffInputs.ts` — The last attempt is the highest `checks-attempt-NN.log`; review notes come only from that attempt's reports.
- `src/app/recordsExplain.ts` — gateArtifactsInOrder prints each attempt's log, request and reports in attempt-number order; reports of an attempt with no log are skipped.
- `src/infra/shell.ts` — stdout and stderr are each decoded with `chunk.toString("utf8")` on every `data` event.
- `src/infra/fakes/shell.ts` — The fake shell returns whole strings, so it cannot reproduce a split character; that test needs the real adapter.
- `src/domain/reducer.ts` — RunResumeRequested lifts rate_limited to running+running and interrupted to running with the phase state kept (gates_exhausted becomes running); GateStepRefused reuses the gates_exhausted pause; PhaseResetRequested resets to pending.
- `src/app/resetPhase.ts` — reset-phase archives the phase folder, so a reset phase starts in a fresh folder.
- `src/schemas/phaxConfig.ts` — A gate profile is a non-empty array of steps; nothing refuses two steps with the same command.
- `src/domain/brief/pull.ts` — Brief records already number one above the highest `brief-NN.json`, which is the precedent for numbering.
- `docs/specs/archive/2610091304-guarantee-reports.md` — §5.21–§5.22 refusal pause and resume, §5.26–§5.27 the `still failing` mark, §5.36 review notes from the last attempt, §5.40 reports saved byte for byte, §5.42 records explain --gates.
- `NEXT_STEPS.md` — The three Small follow-ups this spec replaces: attempt numbering restarts, decode stdout once, still failing keyed by position.
- `README.md` — Gate report steps says `still failing` marks ids that "the same step" listed in the previous attempt; troubleshooting points operators at checks-attempt-NN.log.

## 2. Problem

The review of the guarantee-reports run (PR #129, 2026-10-10) found three defects, each confirmed in the code. Two of them are older than that run. (1) Numbering restarts. A re-entry after a rate limit, a usage limit or an interruption runs the gate from attempt 1 again. It overwrites `checks-attempt-01.*` and `fix-attempt-01.jsonl` and leaves the earlier entry's higher-numbered files in place. The review handoff then gathers review notes from an attempt that no longer counts, `still failing` compares against a stale report, and `records explain --gates` mixes two entries under one numbering. The one path that does continue counts only two-digit `.log` names. An attempt cut short before its log was written therefore leaves its request and reports under a number the next attempt reuses, and a report from the cut-short attempt can sit beside the new log as if the new attempt had written it. (2) Chunked decoding. A multi-byte character split across two chunks becomes replacement characters. A gate report is then not saved byte for byte as printed (§5.40), and its decoding can fail on text the provider wrote correctly. (3) Position, not identity. `still failing` reads the previous attempt's report by the failing step's position. If the operator edits `gateProfiles` between two attempts, which a refusal invites before `phax resume`, that position can name another step, and the fix prompt shows a false `still failing` mark. In all three cases a reader takes another attempt's files, another step's files, or a corrupted copy of what a step printed, and presents them as this attempt's record.

## 3. Product goal

A gate attempt's record holds what that attempt saw and nothing else. A phase's attempts are numbered once, across every entry into its gate, so no attempt's files are overwritten or read as another attempt's. Each saved report is tied to the command of the step that printed it, so `still failing` compares a step only with itself. A step's output is recorded as printed. Then the readers built on these files (`still failing`, the review notes, `records explain --gates`) are right because the record is right, with no reader-side guesswork.

> A gate attempt's record holds what that attempt saw, under a number no other attempt has ever had.

## 4. Terminology

- **gate attempt** — One run of a phase's gate steps, numbered NN in the phase folder.
- **entry into the gate** — One start of a phase's gate loop by a phax process. It is either the first, after the phase's agent turn, or a re-entry after `phax resume` following a rate limit, a usage limit, an interruption, attempts running out, or a refusal.
- **per-attempt file** — A file in the phase folder that belongs to one gate attempt: `checks-attempt-NN.log`, `checks-attempt-NN.request.json`, `checks-attempt-NN.report-SS.json`, `checks-attempt-NN.attribution.json` (the step record) and `fix-attempt-NN.jsonl`. `gate-attribution.json` is a per-phase file, not a per-attempt one.
- **step record** — The per-attempt file that lists, in run order, the command, surface and result of each step the attempt ran. A saved report-SS belongs to the step at position SS of that same attempt's step record.
- **recorded attempt** — A gate attempt whose `checks-attempt-NN.log` exists. An attempt cut short before its log was written is not recorded, but its number is still taken.
- **previous attempt** — For attempt N, the phase's recorded attempt with the highest number below N, whichever entry ran it. There is none when no recorded attempt is below N.
- **last attempt** — The phase's recorded attempt with the highest number.
- **same command** — Two steps have the same command when their `command` strings split into the same words, splitting on whitespace the way phax does to run them (`pnpm  test` and `pnpm test` are the same command).

## 5. Functional requirements

### 5.1 An attempt takes the next free number

WHEN a gate attempt starts THE system SHALL number it one above the highest attempt number carried by any per-attempt file in the phase folder, however many digits that number has, or 1 when the folder holds no per-attempt file.

### 5.2 Every entry numbers the same way

The system shall number gate attempts the same way on every entry into a phase's gate: the first entry, and a re-entry after a rate limit, a usage limit, an interruption, attempts running out or a refusal.

### 5.3 Every per-attempt file carries its attempt's number

The system shall name each per-attempt file with the number of the gate attempt it belongs to: the attempt's log, its gate request, each gate report it saved, its step record, and the transcript of the fix attempt that answers its failure.

### 5.4 Existing attempt files are evidence

The system shall never overwrite, renumber or delete a per-attempt file that already exists in a phase folder.

### 5.5 Each attempt records its steps' commands

WHEN a gate attempt ends, whether it passed, failed, was refused or stopped on a broken step, THE system SHALL write that attempt's step record beside its log, listing each step the attempt ran, in run order, with its command.

### 5.6 The previous attempt spans entries

The system shall take a gate attempt's previous attempt to be the phase's recorded attempt with the highest number below it, whichever entry into the gate ran it.

### 5.7 Still failing compares a step with itself

WHEN a step fails on a checked gate report THE fix prompt SHALL mark `still failing` each finding whose id the previous attempt's checked report from the step with the same command listed, wherever that step sat in either attempt.

### 5.8 No same-command report, no mark

IF the previous attempt has no checked report tied, through its step record, to a step with the failing step's command THEN the fix prompt SHALL mark no finding `still failing`. This covers no previous attempt, no step record, that command not run, and a report that refused.

### 5.9 A profile runs each command once

IF a gate profile, top-level or a workspace's, lists two steps with the same command THEN config validation SHALL refuse it with exit 2, naming the profile and the command.

### 5.10 Output is decoded once, after the step ends

The system shall decode each step's stdout and stderr once, from every byte the step printed, after the step ends, for every gate step whether or not it is a report step.

### 5.11 A report must be UTF-8

IF a report step's stdout is not valid UTF-8 THEN the system SHALL treat the step as broken: it fails with the raw log, and no report is saved.

## 6. Surface

### file: <run>/phase-NN/ attempt files after a rate-limited re-entry — normative

before:

    Made-up phase-02: the first entry ran attempts 01 and 02, fix attempt 02 hit a rate limit, and the re-entry passed at what it numbered 01.

    phase-02/
      checks-attempt-01.log              overwritten by the re-entry
      checks-attempt-01.request.json     overwritten by the re-entry
      checks-attempt-01.report-02.json   overwritten by the re-entry
      fix-attempt-01.jsonl               first entry's
      checks-attempt-02.log              first entry's, read as the phase's last attempt
      checks-attempt-02.request.json
      checks-attempt-02.report-02.json   its review notes reach the review handoff
      fix-attempt-02.jsonl               cut short by the rate limit
      gate-attribution.json

after:

    phase-02/
      checks-attempt-01.log              first entry
      checks-attempt-01.request.json
      checks-attempt-01.report-02.json
      checks-attempt-01.attribution.json
      fix-attempt-01.jsonl
      checks-attempt-02.log
      checks-attempt-02.request.json
      checks-attempt-02.report-02.json
      checks-attempt-02.attribution.json
      fix-attempt-02.jsonl               cut short by the rate limit
      checks-attempt-03.log              re-entry after `phax resume`: the last attempt
      checks-attempt-03.request.json
      checks-attempt-03.report-02.json
      checks-attempt-03.attribution.json
      gate-attribution.json              unchanged role: the last attempt's steps

    Normative: one numbering per phase across entries, the existing file names, and no earlier file changed. The step record's file name is indicative (see §9).

### file: <run>/phase-NN/checks-attempt-NN.attribution.json (step record) — indicative

    Written when attempt 02 ends, in the existing gate-attribution format, no new format:

    {
      "$schema": "https://docs.phax.run/schemas/gate-attribution/<release>.json",
      "phase": "phase-02",
      "steps": [
        { "command": "node scripts/lint.mjs", "surface": "local", "result": "pass" },
        { "command": "node scripts/audit.mjs", "surface": "structural", "result": "fail" }
      ]
    }

    `checks-attempt-02.report-02.json` belongs to `node scripts/audit.mjs`, the second entry here. Normative: one step record per attempt, listing the commands in run order. The file name and the reuse of gate-attribution are indicative, pending §9 Q1.

### cli: the fix prompt's `still failing` mark — normative

before:

    The mark follows the step's position. After `node scripts/c.mjs` was inserted as step 2, its finding is compared with the previous attempt's report-02, which `node scripts/b.mjs` printed:

    - src/a.ts:3 · still failing
      rule: a module under src/ imports no node: module

after:

    The mark follows the command. `node scripts/c.mjs` printed no report in the previous attempt, so nothing is marked:

    - src/a.ts:3
      rule: a module under src/ imports no node: module

    The mark text ` · still failing` and the rest of the fix prompt are unchanged.

### file: <run>/phase-NN/checks-attempt-NN.report-SS.json bytes — normative

before:

    A made-up report printed with `é` split across two chunks is saved with two replacement characters:

    "message": "nom non accentu��"

after:

    Saved as printed:

    "message": "nom non accentué"

    A report step whose stdout is not valid UTF-8 is a broken step, and the attempt log reads (wording indicative):

    provider error: … stdout is not valid UTF-8

### config: duplicate command in gateProfiles — normative

before:

    "gateProfiles": {
      "default": [
        { "command": "pnpm test", "surface": "local", "firing": "every-phase" },
        { "command": "node scripts/audit.mjs", "surface": "structural", "firing": "every-phase", "output": "gate-report" },
        { "command": "pnpm  test", "surface": "local", "firing": "terminal" }
      ]
    }
    (accepted today)

after:

    Same config, refused at load:

    ✗ config: gateProfiles.default lists the command "pnpm test" twice (steps 1 and 3)
    $? = 2

    Normative: exit 2, and the message names the profile and the command. A workspace profile is named as `workspaces[<id>].gateProfiles.<profile>`. Wording indicative.

## 7. Non-goals

- The fix-attempt budget on a re-entry: each entry still gets the full budget, as today.
- The agent-turn files that a rate-limited or interrupted re-entry rewrites (`prompt.md`, `output.jsonl`, `security.json`, `agent-binding.json`): they are not gate-attempt records.
- `gate-attribution.json` keeps holding the last attempt's steps, and its readers (verified surfaces, the records writer) are unchanged.
- No migration, detection or renumbering of a run folder written before this change, and no command to repair one.
- `phax reset-phase` keeps archiving the phase folder, and the fresh folder starts again at attempt 01.
- The commit's `Gate-Log` trailer, which names `checks-attempt-01.log` whichever attempt passed. This was found while writing this spec and is left for a separate follow-up.
- What `still failing` compares (the finding id) and what `records explain --gates` prints (log, request, reports; not the step record).
- Brief records (`brief-NN.json`), which already number above the highest existing one.

## 8. Acceptance criteria

### A rate-limited re-entry continues the numbering

Given a made-up phase whose gate attempts 01 and 02 failed on `node scripts/audit.mjs` and whose fix attempt 02 hit a rate limit, when `phax resume` runs and the phase's gate runs again, then the attempt writes `checks-attempt-03.log` and its other files, and every `checks-attempt-01.*`, `checks-attempt-02.*`, `fix-attempt-01.jsonl` and `fix-attempt-02.jsonl` is byte for byte as before the resume. (refs §5.2, §5.1, §5.4)

### Every kind of re-entry continues

Given a phase whose last recorded attempt is 04 and which paused on a usage limit or an interruption during fix attempt 04, or after attempts ran out at 04, or on a refusal in 04, when `phax resume` runs and the phase's gate runs again, then in each case the gate runs as attempt 05. (refs §5.2, §5.1)

### A cut-short attempt's number is never reused

Given a phase folder holding `checks-attempt-04.request.json` and `checks-attempt-04.report-01.json` but no `checks-attempt-04.log`, after a run interrupted mid-gate, with recorded attempt 03, when the gate runs again, then it runs as attempt 05, the 04 files are unchanged, attempt 05's previous attempt is 03, and the review handoff never reads attempt 04. (refs §5.1, §5.4, §5.6)

### Numbering past 99

Given a phase folder whose highest per-attempt file is `checks-attempt-100.log`, when the gate runs again, then it runs as attempt 101. (refs §5.1)

### An attempt's files share its number

Given attempt 03 fails on a report step at position 2 whose request was declared, and a fix attempt follows, when the fix attempt ends, then the files numbered 03 in the phase folder are exactly `checks-attempt-03.log`, `checks-attempt-03.request.json`, `checks-attempt-03.report-02.json`, `checks-attempt-03.attribution.json` and `fix-attempt-03.jsonl`. (refs §5.3, §5.5)

### The step record lists what ran

Given an attempt that runs `node scripts/lint.mjs` then `node scripts/audit.mjs` and ends on the second, whether by passing, failing, refusing or stopping on a broken step, when the attempt ends, then its step record decodes as a gate attribution listing those two commands, in that order, with their results. (refs §5.5)

### Review notes come from the true last attempt

Given a first entry that left attempts 01 and 02, with attempt 02's report holding the made-up review note `check the retry budget`, and a rate-limited re-entry whose gate passes at attempt 03 with no note, in a run where no other phase left a note, when phax generates the review handoff, then the handoff has no `## Review notes` section. (refs §5.2, §5.1)

### records explain shows each attempt once

Given the recorded phase of "A rate-limited re-entry continues the numbering", when `phax records explain --gates` runs, then it prints attempts 01, 02 and 03 once each, in that order, each with only its own log, request and reports. (refs §5.1, §5.4)

### Still failing holds across a re-entry

Given attempt 02's checked report from `node scripts/audit.mjs` listed a finding with id `no-node-import:src/a.ts`, and fix attempt 02 hit a rate limit, when after `phax resume`, attempt 03's report from `node scripts/audit.mjs` lists a finding with that id, then the fix prompt marks that finding ` · still failing`. (refs §5.6, §5.7)

### No previous checked report, no mark

Given either a phase whose first agent turn hit a rate limit before any gate attempt, or a previous attempt in which `node scripts/b.mjs` printed a refused report, when after `phax resume`, the next attempt fails on a checked report from `node scripts/b.mjs`, then no finding is marked `still failing`. (refs §5.6, §5.8)

### An inserted step is not compared with its neighbour

Given attempt 01 ran `node scripts/a.mjs`, which passed, then `node scripts/b.mjs`, which failed at position 2 listing id `x-1`, and the operator then inserts `node scripts/c.mjs` as the second step, when after `phax resume`, attempt 02's `node scripts/c.mjs` fails at position 2 listing id `x-1`, then no finding is marked `still failing`. (refs §5.7, §5.8)

### A moved step is still compared with itself

Given the same attempt 01, and the operator moves `node scripts/b.mjs` to be the first step, when after `phax resume`, attempt 02's `node scripts/b.mjs` fails at position 1 listing id `x-1`, then that finding is marked ` · still failing`. (refs §5.7)

### A folder written before this change is read as it stands

Given a run folder written before this change, holding `checks-attempt-01.*` to `checks-attempt-03.*` and no step record, when `phax resume` re-enters the phase's gate and the attempt fails on a checked report, then the gate runs as attempt 04, no finding is marked `still failing`, and no existing file is changed. (refs §5.1, §5.4, §5.8)

### A split character survives in a report

Given a report step, run through the real shell adapter, that prints a made-up checked report whose message holds `é`, with the two bytes of `é` sent in separate writes, when the gate runs, then the saved report's bytes equal the bytes printed, and the step is judged from that report. (refs §5.10)

### A split character survives in the log

Given a log step, run through the real shell adapter, that prints `✓` on stdout and on stderr, each split across two writes, when the gate runs, then the attempt log holds `✓` twice and no replacement character. (refs §5.10)

### A non-UTF-8 report is a broken step

Given a report step whose stdout holds bytes that are not valid UTF-8, when the gate runs, then the step fails as a broken step, the attempt log says stdout is not valid UTF-8, and no report is saved. (refs §5.11)

### A profile listing a command twice is refused

Given `gateProfiles.default` lists `pnpm test` as its first step and `pnpm  test` as its third, when any phax command loads the config, then it exits 2, naming `gateProfiles.default` and `pnpm test`. (refs §5.9)

## 9. Open questions for implementation planning

### Q1 — How is a saved report tied to the command of the step that printed it? The report has to stay byte for byte as printed, so the command cannot go inside it. (Decided by the author on 2026-10-10; not reopened.)

- A per-attempt step record beside the log (`checks-attempt-NN.attribution.json`), in the existing gate-attribution format; report-SS belongs to entry SS of the same attempt's record — abandons: a lean phase folder: one more file per attempt, which for the last attempt repeats what `gate-attribution.json` holds
- Read the previous attempt's log, taking the `$ <command>` line just before each `report: <file>` line — abandons: decoding a typed record: the log is a transcript that also holds every step's own output, so output that prints a `$ …` line followed by a `report: …` line is misread, and no schema checks it
- Carry the command in the report's file name — abandons: the readable, stable `report-SS` names used by the review handoff, `records explain` and the README; a command fits in a file name only as a digest nobody can read

Recommendation: A per-attempt step record beside the log (`checks-attempt-NN.attribution.json`), in the existing gate-attribution format; report-SS belongs to entry SS of the same attempt's record — Decided by the author on 2026-10-10, as recommended. The duplicated file is the cheapest loss. It needs no new format, since gate-attribution already has a schema and a reader, and the record is decoded rather than scraped from text a step could have printed. The log stays a transcript, and the report names stay as the README describes them.

### Q2 — May one gate profile run the same command twice, and if so, how are the two steps told apart? (Decided by the author on 2026-10-10; not reopened.)

- Config validation refuses a profile listing the same command twice, with exit 2 — abandons: a profile that runs one command twice on purpose, which must now spell one of the two differently (for example `pnpm run test`)
- Allow it, and tell the twins apart by occurrence (the first `pnpm test`, the second) — abandons: the guarantee itself: adding or removing one twin between attempts shifts the occurrence, which is the same false mark this spec removes, only rarer
- Allow it, and mark nothing for a command that appears twice in either attempt — abandons: the `still failing` mark for those steps, silently, and the profile's ambiguity goes unflagged

Recommendation: Config validation refuses a profile listing the same command twice, with exit 2 — Decided by the author on 2026-10-10, as recommended. A gate step reads the worktree and does not write it, so running a command twice gives the same verdict twice. A profile that does this is almost always a mistake, and refusing it is the explicit choice. The refusal happens when the config loads, before any phase runs, so it never stops a phase midway.

## 10. Implementation-planning note

Settled:

- One spec for the three defects. Numbering continues on every re-entry and never restarts. Clearing a phase's attempt files was rejected because the records are the evidence of what ran.
- `still failing` compares only against the step with the same command in the previous attempt, never by position. With no such checked report, nothing is marked.
- A step's stdout and stderr are decoded once, after the step ends, for every step.
- The next number is one above the highest number on any per-attempt file, not only on logs, so an attempt cut short before its log was written keeps its number.
- The previous attempt is the highest-numbered recorded attempt below the current one, across entries. Attempts cut short (no log) are neither previous nor last.
- A run folder written before this change is read as it stands. Re-entering it continues above its highest number. Its attempts have no step record, so they give no `still failing` mark. Nothing is migrated, detected or renumbered.
- §9 recommendations: a per-attempt step record in the gate-attribution format, and duplicate commands refused at config load.

Left open:

- The final name of the step record file, and whether readers of `gate-attribution.json` should later read the last attempt's step record instead of it (not required here).
- Where bytes become text: inside the shell adapter or behind a byte-carrying port result. The contract only requires one decode after the step ends, and that a report's non-UTF-8 stdout is detected.
- The exact wording of the duplicate-command refusal and of the non-UTF-8 provider-error line.

Constraints:

- Respect the layers. The phase-folder scan for the next number goes through the FileSystem port, replacing the `readdirSync` in executePlan.
- Tests reproduce each defect before the fix: a re-entry after a rate limit, a report split in the middle of a multi-byte character, and a profile edited between two attempts. The fake shell returns whole strings, so the split tests drive the real shell adapter with a child that writes the bytes in two writes.
- Fixtures are made up.
- No back-compat shims, and no new persisted format: the step record reuses gate-attribution.
- Explicit per-variant enums. The step record's `result` keeps `pass | fail | refused`.
- phax stays autonomous. Nothing here stops a phase for a person. The duplicate refusal happens at config load, never mid-phase.
- Update README "Gate report steps" ("the same step" becomes "the step with the same command") and replace the three NEXT_STEPS Small follow-ups entries.

## 11. Docs page

Page: README.md — "Gate report steps", plus the "A gate keeps failing" troubleshooting entry

Reader: an operator reading a phase folder after `phax resume`, or editing `gateProfiles` before one

Example: Attempts are numbered once per phase. A resumed phase continues at the next number and never overwrites an earlier attempt's files. The fix prompt marks a finding `still failing` when the step with the same command listed its id in the previous attempt, which is the highest-numbered attempt before this one, even across a `phax resume`. A gate profile may not list the same command twice.
