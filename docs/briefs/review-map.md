Write the phax spec `review-map`. When a run reaches review, phax computes, without a model, where the review's attention belongs: the complement of what the run proved. It hands that map to the review session, so the reviewer starts from the criteria no test proves, the oracles that were skipped and the tests a fix loop touched, instead of from a list of changed files.

Why: the `phax-review` skill (commit 1259ec48) tells the reviewer to aim at what the tests cannot see, and to read each acceptance criterion's test against the criterion's text. The reviewer has to rebuild that picture by hand: the code-review prompt carries only the reconciliation's flagged files and the compliance findings. phax already holds the facts: the plan's test lines and their criteria (once `test-strategy` lands), the oracle pairs and each oracle step's result, the gate attempts of each phase, the review notes of the gate reports, the reconciliation. None of them reaches the review session except the reconciliation, and the review notes reach `review-handoff.md` and the PR body but not `review-code`.

What already exists (read it; do not restate it as new):
- **The review skill and its prompt wiring** (`.claude/skills/phax-review/SKILL.md`, `src/domain/review/codeReviewPrompt.ts`, `src/app/reviewCode.ts`): the escape ids, the outside-in order, the worklist section the map would join.
- **The test-strategy spec** (`docs/specs/2610231041-test-strategy.md`, approved 2026-10-23): test lines with size, technique, oracle, loop and `criterion`; the lines join `phax-plan.json` (decision q-where); coverage of criteria by lines; criterion ids read from the source spec's JSON sidecar.
- **Oracle phases** (`docs/specs/archive/2610201518-oracle-phases.md`): the oracle pairs, the oracle step recorded `skipped` after `phax resume --skip-oracle` (`src/schemas/gateAttribution.ts`), oracle is then not among the verified surfaces.
- **Gate attempt records**: `checks-attempt-NN.*` per phase, the attribution file of each attempt, the reports and their review notes.
- **The review handoff** (`src/app/loadReviewHandoffInputs.ts`, `src/app/handoffGeneration.ts`), the global reconciliation, and `phax review-handoff`, which regenerates them.
- **The headless-review spec** (`docs/specs/2609250823-headless-review.md`): the review brief of §5.2 that a headless session receives.

What is settled (the operator's direction of 2026-10-23 and the repository's standing rules; do not reopen):
1. **The map is deterministic and model-free.** It reads the run folder, the plan and the source spec's sidecar on the run's branch; it starts no session.
2. **It never fails a run.** A missing input (no source spec, no test lines, no sidecar, an older run) leaves its part of the map out and says so in one line.
3. **The map holds, at least:** each acceptance criterion with the lines that name it and their loop, the criteria no line names, the criteria named only by `in-phase` lines; the oracle phases whose oracle step was skipped and the criteria they leave unproven; the phases whose gate failed before passing, with their attempt count; the review notes of the run; the reconciliation's flagged files.
4. **The review session receives it**, interactive and headless, as a section of the code-review prompt and of the headless review brief, before the doctrine.

Settle in §9, framing each option by what it abandons:
- **The test files a fix loop changed.** Nothing records today which files a fix attempt edited: fix attempts are not commits. Record the worktree's changed paths at each gate attempt (a new key in the attempt's record), read them from the provider transcripts (provider-specific), or leave this part out and list only the phases that needed fixes.
- **Where the map lives.** Its own run-folder file (`review-map.json`, a persisted format with `$schema`) rendered into the prompt, a section of `review-handoff.md`, or the prompt only; whether `phax review-handoff` regenerates it.
- **Whether the PR body shows any of it.** For instance the unproven criteria under `## Needs your review`, or nothing, the map staying for the reviewer.
- **Architecture parts.** Whether the map lists the architecture parts the run touched with no test line, running the architecture provider as `phax plans overview` does (decision q-architecture of `test-strategy`), or leaves parts out.

Out of scope: the finding shape (`lens`, `escape`, `criterion`), which is the `headless-review` revision of `docs/briefs/review-escape.md`; fakes without a contract test (nothing tells a fake from code deterministically); mutation testing; statistics across runs.

Depends on: `test-strategy` (test lines in `phax-plan.json`) must land first.
