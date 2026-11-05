Write the second and last phax plan of the spec `structured-output` (`docs/specs/2610271515-structured-output.md`, re-approved 2026-10-30). Its run completes the spec (`completes-spec: true`). Title it "Structured compliance review".

**Scope.** What §10's "Plans" line gives to plan 2:
- §5.13 to §5.19;
- the criteria `ac-vibe`, `ac-cr-readonly`, `ac-cr-render`, `ac-cr-phases`, `ac-cr-refused`, `ac-cr-file`, and `ac-every-call` for the compliance review;
- the surfaces `phax review-compliance`, `compliance-review.json` and `compliance-review.md`;
- the compliance review's row on the docs page "Structured answers and providers".

In short:
- **The compliance session answers.** It returns a structured `compliance-review` answer, with no files written into `.phax-context/` and nothing read from there (§5.13). It runs read-only on every provider, granted `CODE_REVIEW_AGENT_COMMANDS`, with no worktree snapshot guard (§5.14).
- **phax writes both files.** phax writes `compliance-review.json` and renders `compliance-review.md` from the answer's fields alone (§5.15, q-compliance-prose: fields-only). The Markdown is byte-identical for the same answer, with the sections the spec's surface shows and `None.` for an empty list.
- **Two ledgers, `unplannedChanges` and `unmetPromises`.** Both are required, possibly empty (§5.16).
- **A coherence check.** `perPhase` names each of the run's phases exactly once (§5.17).
- **A twice-refused answer** is reported failed, naming both refusals, and writes neither file nor a records entry. `Verdict: unknown` and `structuredVerdictMissing` disappear (§5.18).
- **The stamp.** `compliance-review.json` and the answer carry `$schema` at the opened release, through a `next` snapshot (§5.19). The answer schema is designed strict from the start and passes plan 1's strict check.
- **Plan 1's path, as a new structured call.** Add a `compliance-review` entry to `STRUCTURED_CALLS` (`src/domain/session/structuredCalls.ts`) and to `ANSWER_FORMATS` (`src/schemas/answerSchemas.ts`):
  - native on Claude Code (schema minus its root `$schema`, re-stamped) and on Codex (`--output-schema`);
  - on Vibe, the full schema in the prompt;
  - the one corrective resume, with its own transcript file beside the first;
  - the existing scan test that only listed call sites set `answerSchema` gains this one.

**What plan 1 delivered (#175, merged 2026-10-30; build on it, do not redo it):**
- the answer-schema machinery: `ANSWER_FORMATS`, `answerJsonSchema`, the strict check and `strictAnswers.test.ts`, `answerStamp.ts`, the strict NonEmptyString;
- the structured call table and its Claude strip and re-stamp;
- `readClaudeOutcome(ended, { schemaHandedNatively })`: the blank-result rule holds only for a schema handed natively;
- the Codex schema file;
- the headless code review's corrective resume and its retry transcript (`code-review-retry.session.jsonl`). Mirror it for the compliance review.
- the e2e files `tests/e2e/claudeJsonSchema.test.ts` and `tests/e2e/codexOutputSchema.test.ts`, which iterate over `ANSWER_FORMATS`.

**What else exists (read it first):**
- the compliance review: `src/app/reviewCompliance.ts`, `src/domain/review/compliancePrompt.ts`, `src/schemas/complianceReview.ts`, `src/cli/commands/reviewCompliance.ts`, `src/app/finalReview.ts`;
- its readers: the PR body (`src/domain/publish/prBody.ts`), the headless code review's prompt, the records entry (`src/app/writeReviewRecord.ts`) and the review handoff that embeds `compliance-review.md`;
- `packages/schemas/` (snapshots and history) and `src/schemas/release.ts`.

**Settle in Technical arbitrations, each with its dominant loss:**
- the answer's exact keys and how they map to `compliance-review.json`: whether the file is the answer as given, or the answer plus fields phax adds;
- how older stamps keep reading (0.17.0 and pre-schema, through the history), and what today's readers do with a file that has no ledgers (§10 constraints);
- the Markdown renderer's place (domain, pure) and its exact layout;
- how the compliance review's records entry and retry command behave on a failure, now that nothing is written.

**Real-CLI e2e.** Plan 1's two e2e files must exercise the compliance-review answer: one more format in `ANSWER_FORMATS`. The phase gate does not run them; the PR review runs them by name. Say so in the test strategy.

**Constraints:**
- **Persisted shapes.** No back-compat shims and no optional field in a persisted shape. Older compliance reviews are read only through the frozen history.
- **This repository's sidecars.** Do not migrate its live spec and plan sidecars. The run is driven by the installed phax 0.31.0. The repo's `scripts/rerender-*.ts` now refuse 0.27.0/0.28.0 sidecars until `migrate-documents` runs with a released 0.32.0, so no phase may rely on them for this repo's own docs.
- **Isolation.** Tests never read `~/.phax`, a real `~/.claude`, `~/.codex` or `~/.vibe`, the global git config, or the real `gh`. Use `tests/helpers/isolateGit.ts`, temporary directories, the fake provider backends and `makeFakeGitHub()`.
- **Registries.** Respect the layer rules of `pnpm audit:architecture` and every exhaustive format registry the schemas package tests hold (including the closure allowlist in `tests/unit/architecturalGuards.test.ts`), and list them as planned edits.
- **Gates.** The `standard` profile verifies every phase, and `phax.json` allows every command a phase runs. Regenerate `phax.usage.kdl` and `docs/cli/reference.md` (`pnpm gen:usage-spec`, `pnpm docs:cli`) when help text or exit codes change. `pnpm docs:cli` also rewrites the README's generated block.
- **Models.** Follow the phax-planning skill's model policy.
- **`### Test strategy`.** Use the line format, with the spec's criterion ids. Cover every plan-2 criterion.
- **Oracle pair.** The renderer (answer → Markdown) and the phase-coverage check are pure and stable contracts. Use an oracle pair if one fits; otherwise say why.
- **Lint.** The plan must pass `phax plans lint`.
- **Skills.** No skill changes, so no `--allow-skill-edits`.

**Docs:**
- the compliance review's row and section on the docs page "Structured answers and providers";
- `docs/upgrading.md` 0.32.0, for records readers: `compliance-review.json` at the new stamp with both ledgers, and no `Verdict: unknown`.

**Phase shape:** as few phases as the gates allow, with every commit green.

**Output:** your final message is the plan document JSON and nothing else: no sentence before or after it, and no code fence.
