Write the phax spec `gate-attempt-records`: a gate attempt's record holds what that attempt saw and nothing else, so the readers built on it (`still failing`, the review notes, `records explain --gates`) never read another attempt's or another step's files, or a corrupted copy of what a step printed.

Why: the review of the guarantee-reports run (PR #129, 2026-10-10) found three defects, all in how gate attempts are numbered and recorded. Two of them predate guarantee-reports. Each was checked in the code on 2026-10-10:

1. **Attempt numbering restarts on most re-entries.**
   - `src/app/executePlan.ts` continues the numbering (`startAttempt: resumeAttempt + 1`, from the highest `checks-attempt-NN.log` in the phase folder) only when a `gates_exhausted` phase is resumed at its gate.
   - Every other way into a phase's gate starts again at attempt 1: a resume after a rate or usage limit hit during a fix attempt, an interrupted run, and a refusal resumed through the same pause.
   - Starting again overwrites `checks-attempt-01.*` and leaves the higher-numbered files of the earlier entry in place.
   - Consequences:
     - the review handoff, which takes the highest-numbered attempt as the phase's last, can gather review notes from an attempt that no longer counts;
     - `still failing` can compare against a stale report;
     - `records explain --gates` mixes two entries' attempts under one numbering.
2. **A step's stdout is decoded chunk by chunk.**
   - `src/infra/shell.ts` runs `chunk.toString("utf8")` on each `data` event, for stdout and stderr alike.
   - A multi-byte character split across two chunks is decoded as replacement characters.
   - A gate report is then not saved byte for byte as printed (guarantee-reports §5.40), and its decode may fail on text the provider wrote correctly.
3. **`still failing` finds the previous report by the step's position.**
   - `src/app/fixLoop.ts` reads `reportPathFor(logPath(attempt - 1), step)`, where `step` is the position among the steps the attempt runs.
   - If the operator edits `gateProfiles` between two attempts, which a refusal invites before `phax resume`, the position can name another step. Findings are then compared against that step's report, and a mark appears that is false.

Decided (the author, 2026-10-10), not to reopen:
- **One spec for the three, small.** They are one concern: what a gate attempt's record means.
- **Numbering continues on every re-entry, never restarts.** A phase's attempts are numbered once, across every entry into its gate, so no file of an earlier attempt is overwritten or left to read as a later one. Clearing the phase's attempt files instead was rejected: the records are the evidence of what ran.
- **`still failing` compares only against the same step.** "Same" means the same command. The step's position never decides it. When the previous attempt has no report from a step with that command, nothing is marked.
- **A step's output is decoded once, after the step ends.** This covers stdout and stderr, for every step, report step or not.
- **phax stays autonomous.** Nothing here stops a phase for a person.

For the spec to settle (§9 only if a real choice remains):
- **How a saved report is tied to its step's command.** Options include a record beside the reports, the log's `$ <command>` line followed by its `report:` line, or the file name. The saved report stays byte for byte as printed, so the command cannot go inside it.
- **What "the previous attempt" is after a resume that ran no gate.** For example, a rate limit during the phase's first agent turn.
- **Whether `fix-attempt-NN.*` and every other per-attempt file follow the same numbering.** List them all.
- **What happens to a run folder written before this change.** It may already hold mixed numbering. No back-compat shims, but say what a reader does with it.
- **Duplicate commands.** Whether one profile may run the same command twice, and if so how the two steps are told apart.

Ground to read first:
- `src/app/executePlan.ts`: the resume paths, `maxAttemptIndexInPhaseFolder`, and where `runGatesWithFixLoop` is called. Note the `readdirSync` there: any new file access goes through the FileSystem port.
- `src/app/fixLoop.ts`: the attempt loop, `stillFailing`, and `startAttempt`.
- `src/app/gates.ts`: the attempt log (`$ <command>`, `report: <file>`), saved reports, and `gate-attribution.json`.
- `src/domain/gate/reportPath.ts`.
- `src/app/loadReviewHandoffInputs.ts`: how the last attempt is chosen.
- `src/app/recordsExplain.ts`.
- `src/infra/shell.ts` and the fake shell.
- The reducer's `rate_limited` and `interrupted` resume transitions in `src/domain/reducer.ts`.
- `docs/specs/archive/2610091304-guarantee-reports.md`: §5.24–§5.27, §5.36 and §5.40.
- `NEXT_STEPS.md`: the three Small follow-ups entries this spec replaces.

Constraints:
- No back-compat shims, and no new persisted format unless one is needed.
- Explicit per-variant enums.
- Respect the layers.
- Tests reproduce each defect before the fix: a re-entry after a rate limit, a report split in the middle of a multi-byte character, and a profile edited between two attempts.
- Fixtures are made up.

Output: your final message is the spec document JSON and nothing else — no sentence before or after it, no code fence.
