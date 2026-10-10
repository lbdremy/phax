Write the phax plan for the Approved spec `pr-description` (`docs/specs/2610100823-pr-description.md`, with its sidecar `.json`). The spec is the source of truth. The author decided §9 Q1 on 2026-10-10, as recommended: the PR body carries the compliance verdict and the attention points only, not the compliance summary paragraph. Do not reopen it, or anything §10 lists as settled.

**One plan carries the whole spec, so it completes the spec.** The plan carries `completes-spec: true` (it is created with `--last`). Keep it small: two phases, three at most.

Left to the planner by §10, with the dominant loss of each in `## Technical arbitrations`:
- the exact wording of the summary, the phase lines, the count line for cut entries, and the shortened note;
- how per-phase deviation counts come from the global reconciliation's phase attribution, as long as an unexplained deviation counts once against each phase it is attributed to.

Phase shape: inside-out, each phase green on its own, with its tests in the same phase (no oracle phases). Suggested; adjust any boundary that is wrong:
1. **The PR body builder.**
   - A pure domain builder in `src/domain/publish/` takes decoded inputs and returns the body: the run summary, `## Phases`, `## Needs your review`, `## Review notes` when any, and `## Full detail` (§5.1–§5.14).
   - The cap and its cut order live in the builder, never cutting the summary, the phase lines, the review-notes heading and intro, or `## Full detail`.
   - The review notes reuse the review handoff's own rendering, so the two never drift (§5.9).
   - Unit tests cover the §8 acceptance criteria with made-up inputs: with and without a compliance review, a skipped phase, no deviations, no notes, records configured or not, and a body over the cap.
2. **Publishing uses it, and the docs.**
   - `src/app/publishRun.ts` gathers the inputs it already loads for the review handoff and builds the body through the new builder. The old header, the handoff-as-body and the "on the branch" truncation note are removed, not kept behind a switch (§5.12, §5.15).
   - `pr-body.md` holds the exact body sent.
   - `review-handoff.md` is unchanged; a test pins that its sections stay (§5.16).
   - README: the review and publish section, as §11 describes.
   - NEXT_STEPS: tick or remove the "A terser PR description" entry this spec covers.

Constraints:
- No new persisted format.
- No back-compat shims.
- Explicit per-variant enums.
- Respect the layers: the body is built in the domain from decoded inputs; reading the run folder stays in the app layer through the FileSystem port.
- Nothing in publishing sends a review note, or the PR body, to an agent.
- phax stays autonomous: nothing stops a phase for a person.
- Fixtures and examples are made up; none copies a real PR body.
- Tests hold across a release cut: they name literal releases or the formats' current stamps.
- No skill edits are expected. If a phase finds a skill describing the PR body, it reports it in the handoff instead of editing it.
- The plan must pass `phax plans lint`, and every phase is verified by the `standard` gate profile.

Output: your final message is the plan document JSON and nothing else — no sentence before or after it, no code fence.
