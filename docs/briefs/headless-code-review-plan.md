Write the second and last phax plan of the spec `headless-code-review` (`docs/specs/2610271007-headless-code-review.md`, approved 2026-10-27). Its run completes the spec (`completes-spec: true`). Title it "Headless code review".

**Scope.** Everything in the spec that plan 1 did not deliver:
- §5.1 to §5.23 and their acceptance criteria;
- every §6 surface, except the records layout that plan 1 shipped.

That covers:
- the opt-in `review.code.enabled`: optional, false when absent;
- the headless review at run end, after the compliance review and before the PR is written;
- the versioned code-review document and its checking: `lens` and `escape` are closed literals equal to the `phax-review` skill's ids, kept equal by a test, and `criterion` and `file`/`line` are recorded as given;
- `code-review.json` in the run folder and the run's recorded review session, which `phax review-code <run>` resumes interactively;
- a failed review, which never fails the run;
- `### Code review findings` in the PR body, right before `### Unexplained deviations`;
- `phax review-code <run> --headless` by hand: on a `review_open` run only, replacing `code-review.json`, and leaving an open PR untouched;
- its cost entry with `role: "code-review"`;
- §5.23: each accepted `code-review.json` committed as a review entry through plan 1's writer.

**What plan 1 delivered (#168, merged 2026-10-27; build on it, do not redo it):**
- `src/app/writeReviewRecord.ts`: `writeReviewRecord`, `reviewRecordKey`, `reviewRecordWarning` and `reviewRecordPushWarning`. The `review-record-manifest` 0.29.0 format already admits the `code-review` kind.
- `src/app/reviewCompliance.ts`: `reviewComplianceAndRecord`, `complianceRecordTargetFor`, `complianceRecordWarnings` and `complianceRecordNotice`. These are the model to mirror for the code review. A run's review entry always goes to the records of the run's own project, read from its main checkout (operator decision, 2026-10-27). The previous invocation's review files in `.phax-context/` are removed before the session, so a rerun never records a stale file. The retry command names the real run, and a successful by-hand entry prints `Recorded: <key> (<sha8>)[, pushed to <remote>]`.
- Generalise what the code review shares with the compliance review: the target resolution, the warnings and the notice. Do not copy them. Say in Technical arbitrations what moves and where.

**What else exists (read it first):**
- `phax review-code` (`src/app/reviewCode.ts`, `src/domain/review/codeReviewPrompt.ts`, `src/cli/commands/reviewCode.ts`), its session record `code-review-session.json`, and `review.code` in `src/schemas/phaxConfig.ts`.
- The compliance review: `src/app/reviewCompliance.ts`, `src/domain/review/compliancePrompt.ts`, `src/schemas/complianceReview.ts`, `src/app/finalReview.ts`, `src/app/executePlan.ts`, `src/domain/publish/prBody.ts`, and the cost ledger code.
- The review skill: `.claude/skills/phax-review/SKILL.md`, its bundled copy, and the lens and escape ids.
- The published schemas: `packages/schemas/` and the release table. The new `code-review` document format gets its `$schema` at the opened release, 0.29.0.

**Settle in Technical arbitrations, each with its dominant loss:**
- the code-review document's exact keys, and how the answer is checked and retried, mirroring the compliance review's answer;
- how the headless session is recorded, so that the interactive `phax review-code <run>` resumes it on the provider that ran it, and what `--new-session` does afterwards;
- where the prompt for the headless pass differs from the interactive one. Both carry the `phax-review` skill, the project copy if there is one, else the bundled one;
- the PR body's finding line, and how the cut order keeps the findings within the body's size limit.

**Constraints:**
- No back-compat shims, and no optional field in a persisted shape. `review.code.enabled` is config a person writes and is optional by the spec's decision. No migration.
- Tests never read `~/.phax`, a real `~/.claude`, `~/.codex` or `~/.vibe`, the global git config, or the real `gh`. Use `tests/helpers/isolateGit.ts`, temporary directories, `makeFakeGitHub()` and the fake provider backends.
- The layer rules of `pnpm audit:architecture`, and every exhaustive format registry the schemas package tests hold. Plan 1's review found seven such registries; list them as planned edits.
- Gates: the `standard` profile verifies every phase, and `phax.json` allows every command a phase runs. Regenerate `phax.usage.kdl` and `docs/cli/reference.md` (`pnpm gen:usage-spec`, `pnpm docs:cli`) when help text changes.
- Models: follow the phax-planning skill's model policy.
- `### Test strategy`: use the line format, with the spec's criterion ids. Cover every criterion that plan 1 did not cover. `ac-records-compliance`, `ac-records-shape` and `ac-records-fails` are covered already; `ac-records-code` is this plan's.
- Oracle pair: use one only where the contract is stable before the code exists; the code-review document and its checking are candidates. Say why if you do not use one.
- The plan must pass `phax plans lint`.
- No skill changes, so the run needs no `--allow-skill-edits`. The `phax-review` skill's ids are read, not edited.

**Docs:**
- the README (the `review` config, `review-code`, persisted formats);
- the guide pages on reviewing a run;
- `docs/upgrading.md` only if a user has something to do.

**Phase shape:** as few phases as the gates allow, with every commit green.

**Output:** your final message is the plan document JSON and nothing else: no sentence before or after it, and no code fence.
