Write the phax plan for the Approved spec `small-fixes-0-23` (`docs/specs/2610131345-small-fixes-0-23.md`, with its sidecar `.json`). The spec is the source of truth. The author decided §9 Q1–Q3 on 2026-10-13, all as recommended:
- the snapshot comparison ignores annotation keywords (`description`, `title`, `examples`), so the reworded `$schema` description moves no stamp;
- the retry prompt carries the refusal and the instruction to resend the whole document, not the schema;
- a phase committed with no recorded attempt gets `Gate-Log: none`.

Do not reopen them, or anything §10 lists as settled.

**One plan carries the whole spec, so it completes the spec.** The plan carries `completes-spec: true` (it is created with `--last`). Keep it small: three phases, one per fix, since §10 says the fixes are independent.

Left to the planner by §10, with the dominant loss of each in `## Technical arbitrations`:
- the retry prompt and warning wording, and the two retry file names in the session folder;
- how the two turns' usage is summed for each provider;
- the exact new `$schema` description text.

Phase shape: each phase green on its own, with its tests in the same phase (no oracle phases). Suggested order, cheapest first; adjust any boundary that is wrong:
1. **Gate-Log names the passing attempt** (§5.1–§5.3).
2. **The served-schema wording** (§5.14–§5.18): the annotation-blind comparison first, with toy-format tests showing an annotation-only change is not a new shape and a real change still is; then the rewording, which must leave every existing snapshot, `site/retired-schemas/` and `src/schemas/history/` byte for byte as they are.
3. **One authoring retry** (§5.4–§5.13), including the authoring-record-manifest's required `retry` field. That is a real shape change for that format (and the record-manifest union), so it records its own `next` snapshot, through the snapshot tooling, not by hand. Correct the doc comment saying a headless session is never resumed. Phase 2 must land first, so this format's `next` carries the new wording.
   Close with NEXT_STEPS: remove or tick the three "Small follow-ups" entries this spec covers.

Constraints:
- No back-compat shims; `retry` is required.
- Explicit per-variant enums.
- Respect the layers: the retry prompt and the refusal text are pure domain logic; resuming goes through the Backend port.
- phax stays autonomous: nothing waits on a person.
- Fixtures and examples are made up.
- Tests hold across a release cut: stamps through the current-stamp helpers, never literal release numbers; toy formats for snapshot-gate behaviour.
- No skill edits are expected. If a phase finds a skill describing authoring or the `Gate-Log` trailer, it reports it in the handoff instead of editing it.
- The plan must pass `phax plans lint`, and every phase is verified by the `standard` gate profile.

Output: your final message is the plan document JSON and nothing else — no sentence before or after it, no code fence.
