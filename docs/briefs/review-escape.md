Revise the approved phax spec `headless-review` (`docs/specs/2609250823-headless-review.md`) before it is planned: a review finding says from which angle it was found and why the run's tests did not catch it, so the review feeds the test strategy back instead of ending at a fix.

Why: the review now has a doctrine, the `phax-review` skill (commit 1259ec48), which `phax review-code` embeds in its prompt. The skill makes the reviewer use the change before reading its code, work outside-in, aim at what the tests cannot see, and give every finding a `lens` (the step it was found in) and an `escape` (why the tests missed it). That is prose only. The spec's code-review document is flat, `{ severity, file, line, message, suggestion }`, so a headless pass loses both, and nothing downstream can tell a finding that a missing test let through from one no test could catch. The spec is approved but not planned: changing its finding shape now costs a revision, after the plan it costs a migration.

What already exists (read it; do not restate it as new):
- **The review skill** (`.claude/skills/phax-review/SKILL.md`): the outside-in order, the escape table (`wrong-oracle`, `same-author`, `weakened`, `fake-drift`, `unexplored-input`, `omission`, `untestable`), the lens list (`surface`, `acceptance`, `boundary`, `core`, `edge`, `tests`, `architecture`, `docs`) and the finding form (where, what for whom, severity, lens, escape, criterion, suggestion). Its prompt wiring in `src/domain/review/codeReviewPrompt.ts` and `src/app/reviewCode.ts`: the run worktree's project copy, else the bundled skill.
- **The headless-review spec**: the code-review document (the session's final message), `code-review.json` with its per-variant findings (`source: review | compliance`), run-unique ids, outcomes and history, the review brief of §5.2, the review plan, `### Review passes` in the PR body.
- **The review doctrine** `phax-decide-review`: the severity scale and R1–R7, in particular `R4`, oracles are not fix targets.
- **The test-strategy spec** (`docs/specs/2610231041-test-strategy.md`, approved 2026-10-23): test lines with a `criterion` key, the criterion id of the source spec's acceptance criteria read from the spec's JSON sidecar, and the coverage of criteria by lines.

What is settled (the operator's direction of 2026-10-23 and the repository's standing rules; do not reopen):
1. **A review finding carries `lens`, `escape` and `criterion`**, all three required: `lens` and `escape` are closed literals taking exactly the skill's ids, `criterion` an acceptance criterion id or null. A compliance finding keeps its own variant (`phase`, `dimension`) and carries none of the three (explicit per-variant enums, no permissive superset, no optional field).
2. **The skill and the schema hold the same vocabulary.** A test keeps the skill's escape and lens ids equal to the schema's literals; changing one changes the other.
3. **The headless review session follows `phax-review`** too, with the same project-copy rule as the interactive session; the review brief of §5.2 carries it.
4. **No migration.** No `code-review.json` exists yet; the document and the file simply take the new shape.

Settle in §9, framing each option by what it abandons:
- **Whether `criterion` is checked.** Reject a code-review document naming an id the source spec's sidecar does not have (agent-error exit, nothing written), record it as given, or check it only when the spec has a sidecar. What a run without a source spec, or with a hand-authored spec, does.
- **What the review plan does with an escape.** A `wrong-oracle` finding is an oracle question (`R4`); an `omission` or `unexplored-input` finding asks for a test the plan lacked. Escalate both to the operator, or let a review plan carry an oracle pair for the missing test, or let a fix phase add a test that judges code it does not change. Whether `phax-decide-review` gains a principle keyed on the escape.
- **Where the escape shows.** In the PR body's `### Review passes` row (a count per escape), in `phax ls`, only in `code-review.json` and the records, or in a later report across runs. The PR body is minimal where a human reads (`C5`).
- **Whether the interactive session writes anything.** Today it writes no `code-review.json`; whether an interactive pass may end with the same document, or stays conversation only.

Out of scope: the review map phax computes for the reviewer (its own spec, `review-map`); the oracles provider changes (failing for the right reason, frozen generators, fixed seeds); statistics across runs.
