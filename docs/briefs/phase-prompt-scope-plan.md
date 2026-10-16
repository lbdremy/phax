Write the phax plan "Phase prompt scope" for the approved spec `docs/specs/2610161001-phase-prompt-scope.md`. It is the only plan for that spec, so it carries `completes-spec: true`. Read the spec in full; its §9 is empty and its three arbitrations (outline B, `.phax-context/plan.md` A, refuse at lint and preflight C) are settled — do not reopen them.

Decided with the author on 2026-10-16: this spec runs first among the three approved on that day (phase-prompt-scope, then cost-ledger, then plan-estimate), so every later run gets the shorter prompt. Nothing here depends on the cost ledger.

In scope: every requirement §5.1–§5.9, the §6 surface (the prompt's sections, the worktree file, the lint finding, the preflight refusal) and every §8 criterion.

Ground to read:
- **The prompt:** `src/app/promptGeneration.ts` (`buildPhasePrompt`, `generatePhasePrompt`) and its callers. The `## Required output` guidance at the end names `plan.md; phax-plan.json; …` and must name what §5.8 lists instead.
- **Resumed sessions (§5.9):** `src/app/handoffGeneration.ts` and the fix-attempt prompt. They stay byte-identical; prove it with a test, not by inspection.
- **The worktree context folder:** `PHAX_CONTEXT_DIR` and the `.gitignore` rule in `src/app/worktree.ts`; `src/app/briefProvider.ts` writes `.phax-context/brief-request.json` there today. `.phax-context/plan.md` is byte-identical to the run folder's `plan.md`, for a plan under `docs/plans/` and for a loose one alike, and is there again when `phax resume` re-prepares a phase.
- **The parser:** `src/domain/plan/parsePlanMarkdown.ts` splits on `## phase-NN — <title> {#anchor}` headings. Each extracted phase carries `planMarkdownAnchor` (`src/schemas/phaxPlan.ts`).
- **Lint:** `src/app/lintPlan.ts` and `src/domain/plan/lint.ts` (`check: "structure"`). Lint is model-free and never extracts.
- **Preflight:** `RUN_PREFLIGHT_CHECKS` in `src/app/runPreflight.ts`. It runs before the run is named and again on resume (`src/app/resume.ts`).

Constraints from the spec's §10, restated:
- **One locating rule**, a pure domain function: given plan.md and a phase (its id, its `planMarkdownAnchor`), return the phase's section or say it is not locatable. The prompt builder, the run preflight and lint all use it; none re-implements it, and none ever calls a model.
- The plan preamble is everything before the first phase section. The outline is built from the extracted plan (id, title, planned files to create and edit), marking the current phase. Its line format and the preamble heading's wording are the plan's call, within §6.
- **The new preflight check** joins `RUN_PREFLIGHT_CHECKS` under a name the plan chooses. It refuses before the run is named (no run folder, branch or worktree), names the phase and `phax plans lint <plan>`, and uses the same exit code as the other preflight refusals. `phax resume` re-checks it.
- **No persisted format changes.** No schema, no `$schema` stamp, no snapshot under `src/schemas/`.
- The prompt snapshots `tests/unit/__snapshots__/promptGeneration.test.ts.snap` and `tests/integration/__snapshots__/executePlan.test.ts.snap` change by design; regenerate them and say so in the commit body.

One point the spec leaves to planning, to settle or leave as an open question in the plan's preamble: what lint can call "not locatable" without a model. A plan the deterministic parser reads has, by construction, a section for every phase it found. §8's lint case ("a plan.md whose phase-02 has no section") then means a gap in the phase sequence the parser can see, or a comparison against an extraction lint does not run. State the rule lint applies, and what it abandons.

Docs: §11 says no new page. Update what already describes the prompt, the preflight checks or lint's structure check: the README where it lists them, and `.claude/skills/phax-planning/SKILL.md` where it explains lint's structure check and what a phase is given. The run needs `--allow-skill-edits`, so name that file exactly. The skill's generated model-catalog table is untouched. `NEXT_STEPS.md`: note that cost-ledger is next.

Phase shape: as few phases as the gates allow, from the core outwards, every commit green. A likely split:
1. The locating rule, the preamble and outline builders, and the new prompt, with `.phax-context/plan.md` written when the worktree is prepared, and the snapshots regenerated.
2. Lint's structure error and the run preflight check, on resume too.
3. README, the phax-planning skill and NEXT_STEPS.

Merge them if the gates allow.

Constraints:
- The phases name only models in the installed phax's catalog (`phax agent models`): `claude-opus-5-5` (the default), or `claude-sonnet-5-5` for mechanical work.
- Every phase is verified by the `standard` gate profile, and every command it runs must be allowed by `phax.json`.
- Tests never spawn a real provider.
- Fixtures and examples are made up. None is copied from this repository's own plans or specs, or from another repository.
- It must pass `phax plans lint`.

Output: your final message is the plan document JSON and nothing else — no sentence before or after it, no code fence.
