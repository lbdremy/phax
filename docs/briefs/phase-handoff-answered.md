Write the phax spec "The phase handoff is an answer". A phase's handoff becomes a structured document, with a published schema, that phax decodes and checks. It must justify every file-plan deviation the reconciliation found, by an entry that names the paths it covers. The agent can check its handoff with a phax command before ending its turn. When the handoff is refused, phax resumes the session with the reasons.

**Why.** Today the handoff is free Markdown. phax checks only that the four section headings are present (`validateHandoffSections`). Its check of the deviations is a substring match: a deviation counts as explained only if its full path appears somewhere in the text (`findUnexplainedDeviations`). Agents explain deviations by group ("the case sources under `app/src/`", "the five packs' `Cargo.toml`") or by kind ("these are git renames, not missing files"). The check reads every such path as unexplained. It then only logs a warning: it never asks the agent again. The same literal match drives the PR body's "needs your review" list (`findUnexplainedGlobalDeviations` in `src/domain/publish/prBody.ts`). The operator and the reviewer therefore see false warnings, run after run, and learn to ignore them, the real unexplained deviations included.

**Measured (2026-11-13):**
- On phax's own records (`~/.phax/records/phax`, every phase that has both a `file-reconciliation.json` and a `phase-handoff.md`): 345 phases. 42 of them were warned. 3,623 of 4,003 deviation paths are not named literally in their handoff.
- Read by hand, the warned handoffs mostly do justify their deviations, by folder or by kind. Two kinds recur:
  - **Renames.** A rename is reported as a planned file missing plus an unplanned file created ("The report does not map renames. Every case and baseline file is an unchanged rename.").
  - **Deletions.** Files planned for edit and deleted with `git rm` are reported as "planned to edit but not edited".
- A run in another project the same day: 4 of its first 5 phases warned, on 88 paths in all. Every phase's handoff justified them in one or two lines each: sources the plan named by folder, and a manifest edit with its reason.

**Settled (do not reopen):**
1. **The handoff is a structured document** with a published schema in `@lbdremy/phax-schemas`. Every key is required and an unknown key is refused, like `interactive-handoff` and `compliance-review`. It carries what the four sections carry today, as fields. It also carries a list of deviation justifications. Each justification names the deviation paths it covers and says why. One entry may cover many paths.
2. **phax validates it in two steps.** First the decoder (shape). Then a coverage check against the phase's reconciliation:
   - every deviation path is covered by exactly one justification;
   - a justification names no path that is not a deviation.
   Matching a free text against paths is gone.
3. **A refused handoff is asked again.** phax resumes the same session with the decoder's or the coverage check's findings, each naming the uncovered or unknown path. This is how the compliance review is handled today ("phax prints the refusal and resumes the session once").
4. **The agent has a tool to check its handoff before ending its turn.** A phax command, run in the worktree, reads the agent's handoff and the phase's reconciliation and prints what the decoder and the coverage check would refuse. It exits non-zero on a refusal. The handoff prompt names the command. The check it runs is the same code phax runs after the turn, never a second copy.
5. **Every reader of the handoff reads the structured document:**
   - the next phase's prompt (`handoffInjection`);
   - the PR body;
   - the review handoff and the compliance review;
   - `records explain`.
   The Markdown the next phase and the reviewer read is rendered from it by phax.
6. **Provider-agnostic.** Claude Code, Codex and Vibe write the same document; the command and the prompt name no provider.

**What exists (read it first):**
- `src/app/handoffGeneration.ts`: the handoff turn, `buildHandoffPrompt`, `buildDeviationBlock`, `validateHandoffSections`, `HandoffValidationError`, the warning.
- `src/app/handoffGuidance.ts`: the four sections and their guidance, also injected into every phase prompt (`src/app/promptGeneration.ts`).
- `src/domain/reconciliation/`: `reconcile.ts` (renames and deletions are already detected there), `explained.ts`, `global.ts`, `render.ts`.
- `src/schemas/interactiveHandoff.ts`, `src/schemas/answerStamp.ts`, `docs/structured-answers.md`: the strict-answer pattern, the schema handed per provider, the decoder as the only judge, and resume-once on refusal.
- The consumers: `src/app/handoffInjection.ts`, `src/domain/publish/prBody.ts`, `src/app/reviewHandoff.ts`, `src/app/loadReviewHandoffInputs.ts`, `src/app/reviewCompliance.ts`, `src/app/recordsExplain.ts`, `src/domain/interactive/seed.ts`.
- `docs/state-machine.md`: `HandoffRequested`, `HandoffValidated`, `HandoffMissing`, `handoff_failed`.

**Out of scope:**
- How the plan names its files: globs or folders in the planned-file lists. That is a plan-format change; it would cut deviations at the source, but it is a separate spec.
- The interactive handoff, already structured.
- The prompt's guidance on what makes a good handoff, beyond moving it into the schema's descriptions.

**Open questions for §9 (each with a recommendation):**
1. **How a justification names its paths.** Options:
   - an explicit list of paths;
   - folder prefixes or globs, expanded by phax against the deviations;
   - both.

   Recommendation: an explicit list, possibly long. The agent's tool can print the deviation list ready to paste; a glob that covers more than it means is the loose match this spec removes.
2. **Renames and deletions.** Should the reconciliation report a rename as one rename, and a planned edit that was a deletion as such, rather than as a missing file plus an unplanned one?

   Recommendation: yes, in this spec. Both are already detected in `reconcile.ts`, and they are the most common false deviation in phax's records. Each becomes a deviation kind the handoff justifies once.
3. **How many asks, and what when they run out.** Options:
   - one resume, then the phase stops in `handoff_failed`;
   - one resume, then a warning, as today.

   Recommendation: two resumes, then `handoff_failed`, which `phax resume` already handles. A warning nobody acts on is the problem this spec solves.
4. **The handoff turn's form.** Options:
   - a file the agent writes under `.phax-context/` and checks with the command;
   - the turn's final message as a structured answer (`--json-schema` / `--output-schema`), like the closing turn.

   Recommendation: the final message as a structured answer, with the command for checking the draft first. The provider then holds the shape and phax holds coverage.
5. **Records.** Keep `phase-handoff.md` in the phase folder as a rendering, beside the new JSON, or only the JSON? Recommendation: write both, the JSON as the record and the Markdown rendered from it. `records explain` and the reviewers keep a readable file.
