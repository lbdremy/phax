Write the phax plan for the Approved spec `gate-attempt-records` (`docs/specs/2610100815-gate-attempt-records.md`, with its sidecar `.json`). The spec is the source of truth. The author decided §9 Q1 and Q2 on 2026-10-10, both as recommended:
- a per-attempt step record in the gate-attribution format;
- a profile that lists one command twice is refused at config load.

Do not reopen them, or anything §10 lists as settled.

**One plan carries the whole spec, so it completes the spec.** The plan carries `completes-spec: true` (it is created with `--last`). Keep it small: two or three phases.

Left to the planner by §10, with the dominant loss of each in `## Technical arbitrations`:
- the step record's file name;
- where bytes become text: inside the shell adapter, or behind a port result that carries bytes;
- the wording of the duplicate-command refusal and of the non-UTF-8 provider-error line.

Phase shape: inside-out, each phase green on its own, with its tests in the same phase (no oracle phases). Suggested; adjust any boundary that is wrong:
1. **Decode once.** The shell adapter decodes a step's stdout and stderr once, after the step ends. A report step whose stdout is not valid UTF-8 is a broken step (§5.10–§5.11). The test drives the real shell adapter with a child that writes one multi-byte character in two writes.
2. **Numbering and the step record.**
   - An attempt takes the next free number on every entry, from any per-attempt file, through the FileSystem port. This replaces `readdirSync` in `executePlan.ts` (§5.1–§5.4).
   - Each attempt writes its step record (§5.5).
   - `still failing` compares a step only with the step that has the same command in the previous attempt, across entries (§5.6–§5.8).
   - The review handoff's last attempt and `records explain --gates` follow the same numbering.
   - Tests: a re-entry after a rate limit, and a profile edited between two attempts.
3. **Duplicate commands and the docs.**
   - Config validation refuses a profile that lists one command twice, with exit 2 (§5.9).
   - README "Gate report steps", and the "A gate keeps failing" entry.
   - NEXT_STEPS: replace the three Small follow-ups entries this spec covers. Add one new entry for the `Gate-Log` trailer, which names `checks-attempt-01.log` whichever attempt passed (§7, left for a follow-up).

Constraints:
- No new persisted format: the step record reuses gate-attribution.
- No back-compat shims, and no migration of run folders written before this change.
- Explicit per-variant enums.
- Respect the layers: no new `node:fs` in `app/`, `domain/` or `cli/`.
- phax stays autonomous: nothing stops a phase for a person.
- Fixtures are made up.
- Tests hold across a release cut: they name literal releases or the formats' current stamps.
- No skill edits are expected. If a phase finds a skill describing attempt numbering, it reports it in the handoff instead of editing it.
- The plan must pass `phax plans lint`, and every phase is verified by the `standard` gate profile.

Output: your final message is the plan document JSON and nothing else — no sentence before or after it, no code fence.
