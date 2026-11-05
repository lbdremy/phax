Write the phax spec `pr-description`: a small spec that makes the pull request body `phax publish-pr` writes short. It should hold what the reviewer acts on and point to the rest, instead of being the whole review handoff.

Why: the author found the PR description too verbose (2026-10-10). Today the PR body is a header plus the full `review-handoff.md` (`src/domain/publish/body.ts`), cut from its end at 60000 bytes. The guarantee-reports run's PR #129 body was 59387 bytes over 947 lines, at the cap. Most of it is material a reviewer does not act on in the PR:
- the global file reconciliation, 150 lines of planned, edited and optional file lists;
- per phase, the whole file reconciliation again, plus the full phase handoff ("What was delivered", "Key decisions and why", "Exact locations", "What the next phase needs to know"), much of which was written for the next phase's agent rather than for a reviewer;
- the full plan-compliance review, whose per-phase findings repeat the handoffs;
- two top-level headings (`# PHAX Run Review Handoff`, then `# Run Review Handoff`).

The governing rule (the author's rule for the gate and the brief, applied here to the reviewer): **give the reader only what they act on; anything else is too much information.** A reviewer of a phax PR acts on:
- what the run set out to do and whether it did it;
- what needs their judgement: unexplained deviations, unmet promises, the compliance verdict and its attention points, the gate steps' review notes, and a truncation if any;
- where to read more.

Decided (the author, 2026-10-10), not to reopen:
- **The PR body becomes its own short document,** built from the same inputs as the review handoff. It is no longer the handoff with a header.
- **`review-handoff.md` is not cut down by this spec.** It stays the full record in the run folder for whoever reads it (the review-code session, `phax review-handoff`). Only the PR body changes.
- **Review notes keep their place and guarantees** (guarantee-reports §5.36–§5.39): one `## Review notes` section, grouped by owner, never sent to an agent, and in the PR body whenever any note was gathered.
- **phax stays autonomous.** The PR is read after the run, and nothing here stops a phase.
- **Small.** One spec, one short plan.

For the spec to settle (§9 only if a real choice remains):
- **The PR body's sections and their order.** A run summary (spec, plan, phases with one line each, verified surfaces) is likely, followed by what needs the reviewer and a pointer to the full detail. What each section holds is the spec's to decide, under the governing rule.
- **Where "the rest" lives and how the body points to it.** The truncation note today says the full handoff is in `review-handoff.md` on the PR branch. Check whether that is true: the file may only live in the run folder. If so, decide what the pointer names: the run folder path, `phax review-handoff <run>`, `phax records explain`, or a committed file.
- **Whether a size cap is still needed, and what is cut first if it is.** The review-notes section must survive.
- **What one phase's line says,** for example its title, its compliance verdict, and its count of deviations.
- **The `pr-body.md` file written to the run folder.**

Ground to read first:
- `src/domain/publish/body.ts` and `src/app/publishRun.ts`: how the body is built, the header, the cap and the truncation note.
- `src/app/reviewHandoff.ts`: `buildReviewHandoffContent` and its sections.
- `src/app/handoffGeneration.ts`, `src/app/loadReviewHandoffInputs.ts` and `src/domain/review/reviewNotes.ts`.
- `src/app/finalReview.ts`: who else reads `review-handoff.md`.
- The PR #129 body, `gh pr view 129 --json body`, as the worked example of today's verbosity. Do not copy its content into the spec: the spec's examples are made up.
- `docs/specs/archive/2610091304-guarantee-reports.md`: §5.36–§5.39 on review notes.
- The README's publish section, and the `phax-cli` skill where it describes the PR body.

Constraints:
- No back-compat shims.
- Respect the layers.
- Examples and fixtures are made up.
- The PR body is generated, never hand-edited.

Output: your final message is the spec document JSON and nothing else — no sentence before or after it, no code fence.
