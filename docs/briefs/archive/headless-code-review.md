Write the phax spec "Headless code review". It is the compliance review's twin for code: an opt-in automatic code review at the end of a run. The review runs headless and returns a JSON document conforming to a schema. Its findings go up into the PR, and the person can then reopen the review session interactively to have the problems fixed. Keep it that small.

**Why.** The Draft spec `headless-review` (`docs/specs/2609250823-headless-review.md`) went much further: review plans, `phax run --append`, a review loop, finding outcomes and history. The operator set it aside on 2026-10-27. Do not carry any of it over, and do not read it for design.

**Mirror the compliance review.** Read how it works and do the same thing wherever possible:
- `src/app/reviewCompliance.ts`, `src/domain/review/compliancePrompt.ts` and `src/schemas/complianceReview.ts`: the end-of-run step, the versioned JSON answer, and `compliance-review.json` in the run folder and the records;
- `review.compliance` in `src/schemas/phaxConfig.ts`: the opt-in, the model and the effort;
- `src/app/finalReview.ts`: where it runs, and what a failure does to the run;
- `src/domain/publish/prBody.ts`: how its verdict and `### Compliance attention points` reach the PR body.

The headless code review takes the same posture (the same tools, commands and read-only rules as the compliance session), the same failure behaviour, the same answer checking and the same records.

**What else exists:**
- `phax review-code <run>` (`src/app/reviewCode.ts`, `src/domain/review/codeReviewPrompt.ts`). It opens an interactive session with the `phax-review` skill in its prompt (the project copy in the run's worktree, else the bundled one), records it in `code-review-session.json`, resumes it unless `--new-session` is given, and reads `review.code.model`/`review.code.effort`.
- The review skill (`.claude/skills/phax-review/SKILL.md`): the lens ids, the escape ids, and the finding form.

**Settled (do not reopen):**
1. **The setting.** It turns the code review on at run end, beside `review.compliance`. It runs after the compliance review and before the PR is written, with `review.code.model`/`effort`.
2. **The session.** It is headless and follows the `phax-review` skill as the interactive review does. Its only output is a versioned code-review document. Each finding has `severity`, `file`, `line`, `message`, `lens`, `escape`, `criterion` and `suggestion`, all required:
   - `lens` and `escape` are closed literals taking exactly the skill's ids, and a test keeps the skill and the schema equal;
   - `criterion` is an acceptance-criterion id or null, recorded as given and not checked.
3. **The file.** phax writes `code-review.json` in the run folder and into the records, as it does `compliance-review.json`.
4. **The PR.** The PR body shows the findings under their own heading, next to the compliance attention points: one line per finding, with its severity, `file:line` and message.
5. **Fixing.** The headless session is recorded as the run's review session. `phax review-code <run>`, interactive, resumes it, so the person asks for the fixes there.
6. **By hand.** `phax review-code <run> --headless` runs the same review on a `review_open` run, for a run that ended without it or to run it again. Say what it does to `code-review.json` and to an open PR. The simplest answer that keeps the records whole wins.
7. **No migration.** The file and the setting are new.

**Out of scope:** review plans, `phax review-plan`, `phax run --append`, any loop, finding outcomes or history, merging the compliance findings into `code-review.json`, `phax ls` columns, changes to `phax-decide-review`, the review map.

**No open questions.** Settle every remaining choice in the body by mirroring the compliance review, and record the choice in §10. Leave §9 empty unless something cannot be decided that way.

**Surfaces.** The surface `summary`, `before` and `after` are read by users in the release notes: a capitalized sentence and short real examples, with no implementation notes. Name `$schema` URLs at 0.29.0.

**Output:** your final message is the spec document JSON and nothing else: no sentence before or after it, and no code fence.
