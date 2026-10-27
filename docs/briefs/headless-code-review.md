Write the phax spec "Headless code review". A run's code review can run without a person: one headless session reviews the change, following the `phax-review` skill, and ends with a structured JSON document of findings that phax checks and keeps. The person then resumes that same session interactively, starting from the findings. Nothing else.

**Why.** The Draft spec `headless-review` (`docs/specs/2609250823-headless-review.md`) went much further: review plans, `phax run --append`, a review loop, passes in the PR body, finding outcomes and history. Each of those raises questions the operator cannot answer yet without more use. The operator split it on 2026-10-27. This spec is the first half: the review itself, headless and structured. The rest is a later spec, and that Draft stays the source material for it. Do not carry any of it over.

**What already exists (read it; do not restate it as new):**
- `phax review-code <run>` (`src/app/reviewCode.ts`, `src/domain/review/codeReviewPrompt.ts`). It opens an interactive, pre-prompted session in a `review_open` run's final-phase worktree. The prompt carries the `phax-review` skill: the project copy at `.claude/skills/phax-review/SKILL.md` in the run's worktree, else the bundled one. It records the session in `code-review-session.json`, resumes it unless `--new-session` is given, and takes `--model`/`--effort` (default `review.code.model`/`review.code.effort` in `phax.json`, else `claude-opus-5-5` at `high`).
- The review skill (`.claude/skills/phax-review/SKILL.md`): the lens ids (`surface`, `acceptance`, `boundary`, `core`, `edge`, `tests`, `architecture`, `docs`), the escape ids (`wrong-oracle`, `same-author`, `weakened`, `fake-drift`, `unexplored-input`, `omission`, `untestable`), and the finding form (where, what for whom, severity, lens, escape, criterion, suggestion).
- The compliance review: it runs at run completion when `review.compliance.enabled` is set, and its verdict is kept in the run folder and the records. Read how it is wired; the headless code review follows the same path.
- Headless authoring and `phax artifact decide --verdicts`: a versioned JSON answer (`$schema` first), checked by phax, with one corrective resume when it is refused.
- The test-strategy spec (`docs/specs/archive/2610231041-test-strategy.md`): criterion ids come from the source spec's JSON sidecar, and `phax plans lint` checks them only when that sidecar exists.

**Settled (the operator's direction of 2026-10-23 and 2026-10-27; do not reopen):**
1. **The command.** `phax review-code <run> --headless` runs the review with no terminal, read-only: the session changes no worktree file outside `.phax-context/`. The run stays `review_open`.
2. **The answer.** The session's only output is a versioned code-review document. Each finding carries `severity`, `file`, `line`, `message`, `lens`, `escape`, `criterion` and `suggestion`, all of them required. `lens` and `escape` are closed literals taking exactly the skill's ids, and a test keeps the skill and the schema equal. `criterion` is an acceptance-criterion id of the run's source spec, or null. An answer that does not validate is refused, with one corrective resume as in headless authoring, and then exits 5 with nothing written.
3. **The criterion check.** An id that the source spec's sidecar lacks is refused. With no source spec, only null is accepted. With a source spec that has no sidecar, the id is recorded as given (decided 2026-10-27, Q14 of the Draft).
4. **What phax keeps.** It assigns each finding an id (`F1`, `F2`, …) and writes the findings file in the run folder and into the run's records, for the later spec to build on. Each headless review is kept and none overwrites another: say how they are named.
5. **Resuming.** The headless session is the run's recorded review session. A later `phax review-code <run>`, interactive, resumes it, so the person continues from the findings: discussing them, or asking for fixes in the session. `--new-session` still starts fresh.
6. **At run end.** An opt-in `phax.json` setting runs the headless review at run completion, after the compliance review and before the run becomes `review_open`, with `review.code.model`/`effort`. A review that fails there does not fail the run. The run still reaches `review_open`, and a warning names the failure and `phax review-code <run> --headless` to retry.
7. **No migration.** No findings file exists yet; the format is born in this shape.

**Out of scope, for the later spec:** review plans and `phax review-plan`; `phax run --append`; any loop; finding outcomes (fixed, dismissed, awaiting) and history; merging the compliance findings into the findings file; anything in the PR body; changes to `phax-decide-review`; `phax ls` columns; the review map (`review-map`).

**Settle everything you can in the body.** Leave a §9 question only when the operator must choose between two viable behaviours, and frame each option by what it abandons. Keep it to two questions at most.

**Surfaces.** The surface `summary`, `before` and `after` are read by users in the release notes: a capitalized sentence and short real examples, with no implementation notes. Name `$schema` URLs at 0.29.0.

**Output:** your final message is the spec document JSON and nothing else: no sentence before or after it, and no code fence.
