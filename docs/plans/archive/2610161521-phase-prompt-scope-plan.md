---
status: Completed
source-spec: docs/specs/2610161001-phase-prompt-scope.md
completes-spec: true
approved:
  date: 2026-10-16
  baseline: 0bf5596
---
# Phase prompt scope

Each phase's prompt carries only what that phase executes: the plan's shared preamble, its own section, and an outline of every phase. phax writes the full plan to `.phax-context/plan.md` in the worktree. The machine-readable plan JSON for the whole run leaves the prompt. The current phase's JSON definition stays.

One pure locating rule finds a phase's section by its phase-id heading or by its `planMarkdownAnchor`. `phax plans lint` and the shared run preflight both refuse a phase that this rule cannot locate. The preflight runs before `phax run` names the run, and `phax resume` runs it again. The fix-attempt and handoff-generation prompts stay byte-identical.

The three phases:

- phase-01 makes every phase either locatable or refused. It also updates the test fixtures that give `executePlan` a plan.md with no phase sections, and pins the prompts of resumed sessions by snapshot.
- phase-02 rewrites the prompt using the sections the preflight located.
- phase-03 updates the README, the phax-planning skill and NEXT_STEPS.

phase-03 edits `.claude/skills/phax-planning/SKILL.md`, so run this plan with `phax run --allow-skill-edits`.

## Required commands

- (none)

No new command. Every phase runs only the pnpm scripts of the `standard` gate profile and `pnpm test:integration`, which `phax.json` already allows.

## Technical arbitrations

- What lint can call not locatable without a model. Lint reports a `structure` error for every phase id missing from the sequence phase-01 … phase-NN, where NN is the highest `## phase-NN` heading lint sees. Once the plan parses, lint also runs the shared locating rule over the parsed phases; a parsed phase can only be unlocatable through a parser bug. Loss accepted: a missing phase numbered after the last heading lint sees is caught only by the run preflight, after extraction. A plan numbered with a deliberate gap is now a lint error, although the run would accept it.
- The new preflight check is named `phase-sections`. It is added last to `RUN_PREFLIGHT_CHECKS` and refuses with a new `PlanSectionsPreflightError`, exit 11 like the other preflight refusals. `runPreflights` returns the located sections beside the gate steps, and the prompt builder reads them from there instead of locating them a second time. Loss accepted: every check's signature now also receives the cached sections. When several refusals apply at once, the plan defect is reported after the environment refusals (gate profile, commands, consent, mcp, records, models).
- A section runs from its heading to the next heading that locates a phase of the plan (spec §4). The parser's block split instead stops at the next `##`. Loss accepted: a non-phase `##` section placed between or after phases, such as an appendix, reaches only the phase before it.
- The preamble is the plan body before the first located phase heading, without the frontmatter. Loss accepted: the prompt no longer shows the plan's status and lineage keys. These keys govern the run gate; they are not instructions.
- `.phax-context/plan.md` is written after `setupPhase` on a fresh phase, and again when `phax resume` re-enters a phase whose agent session runs again (from `gates_exhausted` or `handoff_failed`). A commit, cleanup or completion re-entry runs no agent, and its worktree may already be gone, so it writes nothing. A write failure fails the phase, like the `prompt.md` write; it is not a warning like the brief request. Loss accepted: a run does not survive a failed write into its own fresh worktree. In exchange, the prompt never names a file that is missing.
- Phase order: locating, lint, preflight and the test-fixture update come first, and the prompt change second. The fixture update is forced: the new preflight runs inside `executePlan`, and about thirty test files give it a plan.md with no phase sections. It is done once, through a shared `tests/helpers/planMarkdown.ts`. Loss accepted: the `executePlan` prompt snapshots change twice. They change in phase-01 because the fixture plan.md gains sections, and in phase-02 by design. In exchange, the snapshot that pins the resumed-session prompts lands in phase-01, before the prompt changes, so phase-02 proves §5.9 only by leaving that snapshot unchanged.

---

## phase-01 — Locate phase sections; lint and the run preflight refuse unlocatable phases {#phase-01-locate-and-refuse}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

phax can now find every phase's section in plan.md with one pure rule, and it refuses a plan whose phase it cannot locate. `phax plans lint` reports a structure error naming the phase. `phax run` refuses before it names the run, and `phax resume` refuses before any phase, both with exit 11 and both naming `phax plans lint`. The phase prompt itself is unchanged in this phase. The located sections are returned by the run preflight, ready for phase-02.

### Detailed instructions

- Create `src/domain/plan/sections.ts` as a pure module with no I/O. Use `fromMarkdown` and `toString` the way `src/domain/plan/parsePlanMarkdown.ts` does, and `splitFrontmatter` from `src/domain/artifact/frontmatter.ts`. Do not edit `parsePlanMarkdown.ts` or `finalize.ts`: spec §7 keeps the deterministic parser and the extraction as they are.
- Export two types: `interface LocatablePhase { readonly id: string; readonly planMarkdownAnchor: string }` and `interface PlanSections { readonly preamble: string; readonly sections: ReadonlyMap<string, string> }`. `sections` is keyed by phase id.
- Export `locatePlanSections(planMd: string, phases: readonly LocatablePhase[]): Either.Either<PlanSections, readonly string[]>`. This is the one locating rule: lint, the run preflight and the prompt builder (from phase-02) all call it, and none of them re-implements it. Left lists the ids of the phases it cannot locate, in plan order. The rule:
  - Parse the body after the frontmatter, and consider only depth-2 headings at the root of the document.
  - A phase P's heading is the first such heading whose flattened text begins with a `phase-NN` id equal to P.id (case-insensitive, word-bounded).
  - Failing that, it is the first such heading whose `{#…}` anchor equals P.planMarkdownAnchor. Compare both without a leading `#`.
  - A heading already taken by an earlier phase in the list is not taken again.
  - P is locatable exactly when it has a heading. A line inside a fenced code block is not a heading; mdast already handles this.
- Sections and preamble. Order the taken headings by their source offset. P's section is the body slice from the start of P's heading to the start of the next taken heading, or to the end of the body. Trim trailing whitespace and keep the slice otherwise verbatim. The preamble is the body slice before the first taken heading, with trailing whitespace trimmed. The frontmatter is not part of the preamble.
- Export `phaseHeadingIds(planMd: string): readonly string[]`. It returns, in document order and lowercased, the `phase-NN` ids of the root-level `##` headings whose text begins with one. It must use the same heading recognition as `locatePlanSections`. Lint's gap check uses it.
- In `src/domain/errors.ts`, add `PlanSectionsPreflightError` beside `ModelPreflightError`, with a one-line comment. It is a `Data.TaggedError` with the fields `message: string`, `phases: readonly string[]` and `planPath: string`. In `src/cli/commands/runLayers.ts`, map it to exit 11 in `exitCodeForError`, alongside the other preflight refusals.
- Update `src/app/runPreflight.ts`:
  - Add `planMd: string` and `planPath: string` to both `RunPreflightInput` and `FreshRunPreflightInput`. Document `planPath` as the path the refusal tells the operator to lint. Pass both fields through `freshRunPreflight`.
  - Add `"phase-sections"` as the last entry of `RUN_PREFLIGHT_CHECKS`.
  - In `runPreflights`, build the located sections once with `Effect.cached`, the same way as the gate steps: call `locatePlanSections(input.planMd, input.plan.phases)` and map a Left to a `PlanSectionsPreflightError`.
  - Pass that cached effect to every check as a third argument, and update the `satisfies Record<…>` signature to match.
  - The `phase-sections` check is `Effect.asVoid` of the cached effect. It checks all phases, not only the ones still to run.
  - `runPreflights` returns `{ gateSteps, planSections }`.
  - Add the new error to `RunPreflightRefusal`. If the module comment lists the checks, update it.
- The refusal message. The wording is indicative; the phase ids and the lint command are required. For one phase, the first line is `Plan preflight failed: phase-02 has no section in plan.md (expected a "## phase-02 — …" heading).` and the second line is ``Fix the plan, then check it with `phax plans lint <planPath>`.`` For several phases, the first line reads `phase-02, phase-04 have no section in plan.md (…)`.
- Pass the new inputs through:
  - `src/cli/commands/run.ts` passes `planMd`, which it already reads before the preflight, and `planPath: opts.plan`, the path as the user typed it, which is how lint reports it.
  - `src/app/executePlan.ts` passes `planMd` and `planPath: join(runPath, "plan.md")` to `runPreflights`. That is the run folder's copy, which is what `phax resume` reads. Keep destructuring only `gateSteps`; phase-02 will use `planSections`. Add the new error to `ExecutePlanError`.
  - `src/cli/commands/resume.ts` should need no change: it already prints executePlan errors as `phax resume failed: …` and exits through `exitCodeForError`. Verify this.
- Add two functions to `src/domain/plan/lint.ts`:
  - `sequenceGapFindings(planMd)`: let NN be the highest id that `phaseHeadingIds` returns. For each id missing from phase-01 … phase-NN, return one finding with severity `error`, check `structure`, that phase id, and the message `no section for phase-NN in plan.md (expected a "## phase-NN — …" heading)`. Return nothing when there is no phase heading at all; the parser already reports that case.
  - `unlocatableFindings(planMd, phases)`: return the same finding for each id that `locatePlanSections` puts in its Left.
  Build the message in one shared helper.
- In `src/app/lintPlan.ts`, push `sequenceGapFindings(planMd)` right after `structureFindings(planMd)`, so the gap is reported even when the deterministic parse fails. After a successful finalize, push `unlocatableFindings(planMd, plan.phases)`, before the file checks. Lint stays model-free and never extracts.
- Fix the test fixtures:
  - Create `tests/helpers/planMarkdown.ts` exporting `planMdFor(plan)`. Type its input structurally as `{ run: { title: string }; phases: readonly { id; title; planMarkdownAnchor }[] }`.
  - It returns a made-up plan.md: a `# <title>` heading, then a `## Required commands` section listing `- (none)`, then for each phase a `## <id> — <title> {#<anchor without #>}` heading followed by one made-up instruction line that names the phase.
  - In every test file listed under planned files to edit, find each plan.md without phase sections that the test passes to `executePlan`, `createRunFolder`, `runPreflights` or `freshRunPreflight`. Examples: `"# My Plan"`, `"# Skill Run"`, `"# Greet"`, and the `PLAN_MD` and `BASELINE_PLAN_MD` constants. Replace each one with `planMdFor(<that test's plan>)`.
  - This includes the e2e files. Do not run the e2e suite; `pnpm test:type` covers those files.
  - `tests/integration/runFolder.test.ts` and `persistedProducer.test.ts` never reach the preflight. Leave them unchanged.
- Pin the prompts of resumed sessions before phase-02 changes the phase prompt (spec §5.9):
  - In `tests/integration/executePlan.test.ts`, add a describe block that drives one phase whose gate fails once and then passes.
  - Snapshot the fix-attempt prompt and the handoff-generation prompt that the fake backend receives, normalised with the file's existing normalisation helper: `toMatchSnapshot("fix-attempt prompt")` and `toMatchSnapshot("handoff prompt")`.
  - Do not change `src/domain/gate/fixPrompt.ts`, `src/app/handoffGeneration.ts` or `src/app/handoffGuidance.ts`.
- Regenerate the snapshots with vitest's update flag, through an allowed script: `pnpm test:integration -u`. `tests/integration/__snapshots__/executePlan.test.ts.snap` changes for two reasons: the baseline fixture plan.md now has sections, and it gains the two resumed-prompt entries. The unit prompt snapshot must not change in this phase.

### Planned files to create

- `src/domain/plan/sections.ts`
- `tests/unit/planSections.test.ts`
- `tests/helpers/planMarkdown.ts`

### Planned files to edit

- `src/domain/errors.ts`
- `src/domain/plan/lint.ts`
- `src/app/lintPlan.ts`
- `src/app/runPreflight.ts`
- `src/app/executePlan.ts`
- `src/cli/commands/run.ts`
- `src/cli/commands/runLayers.ts`
- `tests/unit/planLint.test.ts`
- `tests/integration/lintPlan.test.ts`
- `tests/unit/runPreflight.test.ts`
- `tests/integration/runPreflightBeforeNaming.test.ts`
- `tests/integration/resumePreflightRechecks.test.ts`
- `tests/integration/runBranchDirtyTree.test.ts`
- `tests/integration/executePlan.test.ts`
- `tests/integration/__snapshots__/executePlan.test.ts.snap`
- `tests/integration/agentCommandGrants.test.ts`
- `tests/integration/briefRecords.test.ts`
- `tests/integration/gateLogTrailer.test.ts`
- `tests/integration/gateRefusal.test.ts`
- `tests/integration/gateRequest.test.ts`
- `tests/integration/modelPreflight.test.ts`
- `tests/integration/perPhaseBranch.test.ts`
- `tests/integration/pushedBrief.test.ts`
- `tests/integration/rateLimit.test.ts`
- `tests/integration/reconciliation.test.ts`
- `tests/integration/resume.test.ts`
- `tests/integration/resumeFromCleanup.test.ts`
- `tests/integration/resumeFromCommit.test.ts`
- `tests/integration/resumeFromCompletion.test.ts`
- `tests/integration/resumeHandoff.test.ts`
- `tests/integration/routing.test.ts`
- `tests/integration/runCarriesCompletion.test.ts`
- `tests/integration/setupFailure.test.ts`
- `tests/integration/skillEditConsent.test.ts`
- `tests/integration/skillEditGrants.test.ts`
- `tests/integration/stateMachineContract.test.ts`
- `tests/integration/telemetry/end-to-end.test.ts`
- `tests/e2e/gateExhaustionResume.test.ts`
- `tests/e2e/resetPhase.test.ts`
- `tests/e2e/semanticTrace.test.ts`
- `tests/e2e/semanticTrace.providers.test.ts`

### Optional files that may be edited

- `src/cli/commands/resume.ts`
- `tests/integration/helpers/preflightRepo.ts`
- `tests/integration/__snapshots__/stateMachineContract.test.ts.snap`
- `tests/integration/telemetry/__snapshots__/end-to-end.test.ts.snap`

### Boundary contracts

domain → app: lint, the run preflight and (from phase-02) the prompt builder call `locatePlanSections(planMd, phases)`. The function guarantees that a Right carries the preamble and one verbatim section per phase id, and that a Left carries the unlocatable phase ids in plan order. It calls no model and does no I/O.

app → cli: `RunPreflightInput` and `FreshRunPreflightInput` gain `planMd` and `planPath`. `phax run` supplies the plan path as typed; `executePlan` supplies the run folder's plan.md. The refusal is a `PlanSectionsPreflightError`, which the CLI prints like the other preflight refusals, with exit 11.

app → app: `runPreflights` returns `planSections` beside `gateSteps`. phase-02's prompt builder reads the sections from there.

### Test strategy

Write `tests/unit/planSections.test.ts` first, against made-up plans. It covers:
- the preamble excludes the frontmatter and every phase;
- each section is verbatim, from its heading to the next;
- a phase is located by its anchor when its heading lacks the id;
- a `## phase-02 …` line inside a fenced code block does not locate phase-02;
- a missing phase-02 gives Left ["phase-02"];
- a non-phase `##` between two phases stays in the section before it;
- `phaseHeadingIds` returns ids in document order.

Then the other unit tests:
- `tests/unit/planLint.test.ts`: a plan with phase-01 and phase-03 gives one `structure` error naming phase-02; a plan with contiguous ids gives none; `unlocatableFindings` maps a Left to findings.
- `tests/unit/runPreflight.test.ts`: the order list ends with `phase-sections`; a plan whose phase-02 has no section is refused with `PlanSectionsPreflightError`, naming phase-02 and `phax plans lint <planPath>`; on success the sections are returned.

Integration tests:
- `tests/integration/lintPlan.test.ts`: a plan.md whose phase-02 heading reads `## Step two — …` gets an error with check `structure` naming phase-02, and `hasLintErrors` is true, so the CLI exits 1.
- `tests/integration/runPreflightBeforeNaming.test.ts`: add a `phase-sections` scenario. The `SCENARIOS` record is keyed by `FreshRunPreflightStep`, so `pnpm test:type` requires it. Simulate a model-extracted plan with a pass-through spy on `loadOrExtractPlan`, the same way `resolveGateProfile` is spied. Make it return a two-phase plan while plan.md holds only phase-01's section. Expect exit 11, a single error line naming phase-02 and `phax plans lint plan.md`, and the existing no-trace assertions: no run folder, registry entry, branch or worktree.
- `tests/integration/resumePreflightRechecks.test.ts`: rewrite the paused run's `<run folder>/plan.md` without phase-02's section. `runResume` must exit 11, naming phase-02 and that path, before any phase-02 worktree is created or the agent is called. Assert this the same way as the file's other re-check cases.

Plus the resumed-prompt snapshots described above. All fixtures are made up.

### Implementation order

1. Write `src/domain/plan/sections.ts` and its unit test.
2. Add `PlanSectionsPreflightError` and its exit-code mapping.
3. Add the `phase-sections` check to `runPreflights`, return `planSections`, and pass the new inputs through `run.ts` and `executePlan.ts`; update the runPreflight unit test.
4. Add the gap and unlocatable lint findings, and update the planLint and lintPlan tests.
5. Create `tests/helpers/planMarkdown.ts` and replace the section-less plan.md fixtures in every listed test file.
6. Add the fresh-run and resume refusal scenarios.
7. Add the snapshot test pinning the resumed-session prompts.
8. Regenerate the executePlan snapshot, then run the `standard` gate.

### Excluded scope

- The phase prompt's content and `.phax-context/plan.md` (phase-02).
- README, skill and NEXT_STEPS updates (phase-03).
- Any change to the deterministic parser, `finalizeExtractedPlan` or the extraction.
- Any change to a persisted format: no schema, no `$schema` stamp, no snapshot under `src/schemas/`.
- Changes to the compliance review, code review, fix-attempt or handoff-generation prompts.

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

- The exports of `src/domain/plan/sections.ts` (`locatePlanSections`, `PlanSections`, `LocatablePhase`, `phaseHeadingIds`), with their signatures.
- The new return shape of `runPreflights` (`{ gateSteps, planSections }`) and the check's place in `RUN_PREFLIGHT_CHECKS`.
- `PlanSectionsPreflightError` and the exact refusal message.
- The `planPath` each caller passes.
- `planMdFor` in `tests/helpers/planMarkdown.ts` and its input type.
- The names of the resumed-prompt snapshots and their describe block in `tests/integration/executePlan.test.ts`.
- Any listed test file left untouched, and why.
- An explanation for every file-plan deviation phax reports.

### Commit subject

`feat(plans): refuse phases whose plan.md section cannot be located`

### Commit body

Add the one locating rule in src/domain/plan/sections.ts. A phase's
section is found by its phase-id heading or by its planMarkdownAnchor,
and the plan preamble is everything before the first one.

phax plans lint reports two new structure errors: a phase id missing
from the phase sequence, and a parsed phase the rule cannot locate.
The shared run preflight gains a phase-sections check. phax run
refuses before naming the run, and phax resume re-checks the plan.
The refusal names the phase and phax plans lint, and exits 11.
runPreflights now also returns the located sections, for the prompt.

Test fixtures that gave executePlan a plan.md with no phase sections
now build one with tests/helpers/planMarkdown.ts. A snapshot pins the
fix-attempt and handoff prompts before the prompt change.
tests/integration/__snapshots__/executePlan.test.ts.snap is
regenerated because the baseline fixture plan.md gained sections.

---

## phase-02 — Scope the phase prompt and write the full plan to .phax-context/plan.md {#phase-02-scoped-prompt}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

A phase's `prompt.md` carries only the plan's shared preamble, its own section, an outline of every phase, and its own phase definition. The full plan sits at `.phax-context/plan.md` in the worktree, one read away. The prompt no longer carries the whole plan.md or the plan JSON for the whole run. The prompts of resumed sessions stay byte-identical.

### Detailed instructions

- Create `src/domain/plan/outline.ts` as a pure module. Export `interface OutlinePhase { readonly id; readonly title; readonly plannedFilesToCreate: readonly string[]; readonly plannedFilesToEdit: readonly string[] }` and `renderPlanOutline(phases: readonly OutlinePhase[], currentPhaseId: string): string`. For each phase it renders:
  - a line `- <id> — <title>`, ending with ` ← current phase` for the current phase;
  - a `  create: ` line and an `  edit: ` line, each listing the paths as comma-separated code spans, or `(none)` when the list is empty.
  Optional files are not part of the outline (spec §4).
- In `src/app/worktree.ts`, next to `PHAX_CONTEXT_DIR`, export `PHASE_PLAN_FILE = join(PHAX_CONTEXT_DIR, "plan.md")` and `writePhasePlanFile(worktreePath, planMd): Effect<void, FsError, FileSystem>`. The function creates `<worktree>/.phax-context` with mkdirp, then writes planMd with `writeAtomic`, unchanged, byte for byte.
- Rewrite `buildPhasePrompt` in `src/app/promptGeneration.ts`.

  Options: remove `planMd` and `planJson`. Add `planPreamble: string`, `phaseSection: string` and `plan: PhaxPlan` (read only to build the outline). Keep `currentPhase`, `previousHandoff`, `previousReconciliation`, `gateCommands` and `briefSection`. Make the same change to `GeneratePhasePromptOptions`.

  Sections, in this order:
  1. The opening rules, unchanged.
  2. `## Source intent/spec document`. Reword its line only as far as the removed heading requires: `(not provided — see the approved plan below)`.
  3. `## Approved plan: shared preamble`, followed by the preamble.
  4. `## Plan outline`, followed by `renderPlanOutline(plan.phases, currentPhase.id)`, a blank line, and `` The full plan is at `.phax-context/plan.md`; read it only when this phase needs another phase's detail. ``. Build the path from `PHASE_PLAN_FILE`.
  5. `## Approved plan: current phase`, followed by the section.
  6. Unchanged: `## Previous phase handoff`, the reconciliation section when present, `## Current phase` (the current phase's JSON), the brief section when present, and `## Execution rules`.

  The prompt has no `## Human-readable approved plan` section and no `## Machine-readable execution plan` section.
- In `## Required output`, the closing list currently names `plan.md`, `phax-plan.json`, the current phase definition and the previous handoff. Replace it with: the plan preamble; its own section of the plan; the plan outline; `.phax-context/plan.md`, the full plan; its phase definition; this `phase-handoff.md`. Do not touch `src/app/handoffGuidance.ts`: the handoff-generation prompt shares it and must stay byte-identical.
- In `src/app/executePlan.ts`:
  - Take `planSections` from `runPreflights`.
  - On a fresh phase, right after `setupPhase`, call `yield* writePhasePlanFile(worktreePath, planMd)`.
  - Pass `planPreamble: planSections.preamble`, `phaseSection` (this phase's entry in `planSections.sections`) and `plan` to `buildPhasePrompt`.
  - A missing entry is a defect that the preflight rules out. Handle it with `Effect.dieMessage` naming the phase. Do not fall back to the full plan.
  - On a resume re-entry from `gates_exhausted` or `handoff_failed`, the two that resume the agent session, write the plan file again once the worktree path is decoded, so `phax resume` restores it. Do not write it on a commit, cleanup or completion re-entry: no agent runs there, and the worktree may already be removed, where a write would recreate a stray directory or fail the phase.
  - Build the fix-attempt and handoff prompts exactly as today.
- Before regenerating the snapshots, run `pnpm test` without the update flag. The only failing snapshots should be the prompt ones: `buildPhasePrompt` in the unit snapshot, and the two `prompt.md` entries in the executePlan snapshot. The `fix-attempt prompt` and `handoff prompt` entries pinned in phase-01 must pass unchanged. If they fail, the change has leaked into a resumed session: fix the code, do not re-snapshot. Then regenerate with `pnpm test -u`.

### Planned files to create

- `src/domain/plan/outline.ts`
- `tests/unit/planOutline.test.ts`

### Planned files to edit

- `src/app/promptGeneration.ts`
- `src/app/worktree.ts`
- `src/app/executePlan.ts`
- `tests/unit/promptGeneration.test.ts`
- `tests/unit/__snapshots__/promptGeneration.test.ts.snap`
- `tests/integration/executePlan.test.ts`
- `tests/integration/__snapshots__/executePlan.test.ts.snap`

### Optional files that may be edited

- `src/app/runPreflight.ts`
- `src/domain/plan/sections.ts`
- `tests/helpers/planMarkdown.ts`

### Boundary contracts

app → app: `executePlan` reads `planSections` from `runPreflights` (added in phase-01) and gives `buildPhasePrompt` the preamble, the phase's section, and the plan for the outline.

domain → app: `renderPlanOutline` produces the outline text.

Worktree contract: `<worktree>/.phax-context/plan.md` is byte-identical to `<run folder>/plan.md`, and is gitignored with the rest of `.phax-context/`.

### Test strategy

Write `tests/unit/planOutline.test.ts` first. It checks that every phase is listed with its title and its create and edit paths, that empty lists show `(none)`, that optional files are absent, and that exactly the current phase is marked.

Rewrite `tests/unit/promptGeneration.test.ts` on a made-up four-phase plan, taking its preamble and sections from `locatePlanSections`. For phase-03's prompt, check that:
- it contains the preamble and phase-03's section verbatim, and none of the instruction lines of phase-01, phase-02 or phase-04;
- it has no `## Machine-readable execution plan` or `## Human-readable approved plan` section, and no other phase's commit body;
- `## Current phase` carries phase-03's planned files, commit subject and body, model and effort;
- `## Plan outline` lists phase-01 to phase-04, with phase-03 marked;
- the prompt names `.phax-context/plan.md`;
- `## Required output` names the six items and does not name `phax-plan.json`.
Keep the existing handoff, reconciliation, brief and determinism cases, and regenerate the snapshot.

In `tests/integration/executePlan.test.ts`:
- Run a loose plan (no `planRepoRelPath`). Phase-02's worktree must hold `.phax-context/plan.md`, byte-identical to `<run folder>/plan.md`, and phase-02's `prompt.md` must name that path.
- Delete the file, then resume from `gates_exhausted`: the resume must write it again.
- The baseline `prompt.md` snapshots are regenerated; the phase-01 resumed-prompt snapshots must stay byte-identical.

All fixtures are made up.

### Implementation order

1. Write `src/domain/plan/outline.ts` and its unit test.
2. Add `PHASE_PLAN_FILE` and `writePhasePlanFile` in `src/app/worktree.ts`.
3. Rewrite `buildPhasePrompt` and update the unit prompt tests.
4. Wire `executePlan`: read the sections from the preflight, write the plan file on fresh phases and on resume re-entry, and build the prompt.
5. Add the integration assertions, check that the resumed-prompt snapshots are unchanged, regenerate the prompt snapshots, then run the `standard` gate.

### Excluded scope

- The compliance review, code review, handoff-generation and fix-attempt prompts.
- Lint and the run preflight (phase-01).
- Any fallback that puts the full plan back into the prompt.
- Any change to a persisted format.
- README, skill and NEXT_STEPS updates (phase-03).

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

- The exports of `src/domain/plan/outline.ts`, and of `PHASE_PLAN_FILE` and `writePhasePlanFile` in `src/app/worktree.ts`.
- The new `BuildPhasePromptOptions` shape and the prompt's section headings, in order.
- The outline line format.
- Where `.phax-context/plan.md` is written, on fresh and resumed phases.
- Confirmation that the resumed-prompt snapshot entries passed unchanged.
- The byte size of the baseline phase-02 `prompt.md`, before and after.
- An explanation for every file-plan deviation phax reports.

### Commit subject

`feat(run): scope each phase prompt to the preamble, its section and an outline`

### Commit body

A phase's prompt no longer carries the whole plan.md and the whole
plan as JSON. It now carries the plan's shared preamble, its own
section, and an outline of every phase: id, title, and planned files
to create and edit, with the current phase marked. The current
phase's JSON definition stays.

phax writes the full plan to .phax-context/plan.md in every phase
worktree, on resume too, and the prompt names that path. The Required
output guidance now names what the next phase is given. The
fix-attempt and handoff prompts are unchanged, and their phase-01
snapshots still pass.

tests/unit/__snapshots__/promptGeneration.test.ts.snap and
tests/integration/__snapshots__/executePlan.test.ts.snap are
regenerated by design.

---

## phase-03 — README, phax-planning skill and NEXT_STEPS for the scoped prompt {#phase-03-docs}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

The README and the phax-planning skill describe what a phase reads, the new lint structure error, and the run preflight refusal. NEXT_STEPS names cost-ledger as the next spec.

### Detailed instructions

- README.md, in the **Run and phase** paragraph under Concepts: add one sentence saying that each phase's prompt carries the plan's preamble, its own section, and an outline of every phase (id, title, planned files to create and edit), and that the full plan is at `.phax-context/plan.md` in its worktree.
- README.md, under `### Check a plan`:
  - Say that the structure check also reports a phase missing from the phase numbering, for example a plan with phase-01 and phase-03 but no `## phase-02` heading.
  - Add that `phax run` and `phax resume` refuse a plan with a phase whose section they cannot find in plan.md. They look for the phase's `## phase-NN` heading or its `{#anchor}`, refuse before the run is named, exit 11, and name the phase and `phax plans lint`.
  - Show a short example of the lint error line, using a made-up plan path.
- `.claude/skills/phax-planning/SKILL.md`, in `## Lint before you run`: extend the description of the **structure** check with the missing-phase-number error. Also say that the run preflight refuses a phase it cannot locate, and that a phase is located by its id heading or its anchor.
- `.claude/skills/phax-planning/SKILL.md`, in `## Planning constraints`: add a bullet **A phase reads its own section.** It explains that a phase's prompt carries the plan preamble, its own section, an outline of every phase (id, title, planned files to create and edit) and its phase definition, and that the full plan is at `.phax-context/plan.md`. It gives authors these consequences:
  - put cross-phase decisions in the preamble, such as Technical arbitrations;
  - make each section self-contained, with no bare 'as in phase-02';
  - rely on the planned file lists to show other phases' footprint;
  - give every phase a `## phase-NN — Title {#anchor}` heading, numbered without gaps.
  Adjust the **Handoff-complete** bullet if it contradicts this. Do not edit the generated model-catalog block between its BEGIN and END markers.
- NEXT_STEPS.md: near `## Next up`, add a short entry for the three cost specs approved on 2026-10-16, in run order:
  - `phase-prompt-scope` (`docs/specs/2610161001-phase-prompt-scope.md`), ticked, landing with this run;
  - `cost-ledger` (`docs/specs/2610160919-cost-ledger.md`), marked **Next**;
  - `plan-estimate` (`docs/specs/2610160909-plan-estimate.md`), after it.
  In the intro paragraph, replace the sentence that says headless-review is next: the three cost specs run first, in that order, then headless-review, then oracle-phases. Do not prune or rewrite other entries.

### Planned files to create

- (none)

### Planned files to edit

- `README.md`
- `.claude/skills/phax-planning/SKILL.md`
- `NEXT_STEPS.md`

### Optional files that may be edited

- (none)

### Test strategy

Documentation only; no new tests. The `standard` gate's format check and `pnpm gen:model-catalog --check` must stay green, so leave the generated catalog table in the skill unchanged.

### Implementation order

1. Update the README.
2. Update the phax-planning skill.
3. Update NEXT_STEPS.
4. Run the `standard` gate.

### Excluded scope

- New documentation pages (spec §11).
- Any code or test change.
- The skill's generated model-catalog table.
- Docs-site pages under `site/`.

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

- The README paragraphs and skill sections that were changed, and where the NEXT_STEPS entry was placed.
- A reminder that this phase edits `.claude/skills/phax-planning/SKILL.md`, so the run needs `--allow-skill-edits`.
- An explanation for every file-plan deviation phax reports.

### Commit subject

`docs: describe the scoped phase prompt and the phase-sections refusal`

### Commit body

The README and the phax-planning skill now say what a phase is given:
the plan preamble, its own section, an outline of every phase, and its
phase definition, with the full plan at .phax-context/plan.md. They
also say that phax plans lint, phax run and phax resume refuse a
phase whose section in plan.md cannot be located.

NEXT_STEPS records the three cost specs approved on 2026-10-16:
phase-prompt-scope lands with this run, cost-ledger is next, and
plan-estimate follows.
