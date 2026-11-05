Write the third of the four phax plans of the spec `acceptance-tests` (`docs/specs/2610271119-acceptance-tests.md`, re-approved 2026-10-31). Plan 1, the formats, merged as #177; plan 2, lint, CLI and config, merged as #178. Plan 4 follows, so this run does not complete the spec (`completes-spec: false`). Title it "Acceptance words".

**Scope.** Plan (3) of the spec's §10 "Plans" line: prompts, messages and telemetry. That is:
- the phase prompt's `## Acceptance role` section (§6 `internal: the phase prompt's acceptance section`), the fix prompt, and the authoring prompt's provider lines;
- the recovery and resume texts (whatsNext, resumeInstructions, resetPhaseRefusal, stop output), the closeStop messages, and the refusals oraclePairs.ts writes;
- the help texts and the usage contract: the prose of `src/cli/cliDocs.ts`, then `phax.usage.kdl`, `docs/cli/reference.md` and the README's generated block, regenerated;
- the overview's role row, as text and as JSON (`acceptanceRole`, kind `acceptance` with `passedBy`, or `passing` with `acceptancePhase`), the records-explain row (`acceptance   passes phase-03 — <command>: pass`) and the review-handoff rows (§6 `cli: phax plans overview and phax records explain`);
- the telemetry event `acceptance.edits.unjudged` (§6 `file: telemetry event acceptance.edits.unjudged`);
- every internal identifier and file name that still says oracle or discharge in `src/` and `packages/schemas/src/`, outside the readers, lifts and frozen modules of shapes an earlier release wrote, and outside the old-name refusals.

It covers ac-words and ac-read-old. It also clears the sources for ac-oracle-kept, which plan 4 covers: after this run, `oracle` and `discharg` in `src/` and `packages/schemas/src/` appear only where §5.21 allows them.

What plan 4 renames stays as it is in this run, even where the old word remains visible: the skills, README prose outside its generated block, `docs/oracle-phases.md` and the other docs pages, the site, `examples/vitest-oracles` (its remedy still names `--skip-oracle`), and this repository's `phax.json` and `knip.json`.

**What exists (read it first):**
- The spec's §5.20 and §5.21, its §6 surfaces named above, its §8 criteria "Prompts, messages and telemetry use the new names", "Records from 0.32.0 still read" and "Oracle survives only in its literature sense", and its §10 rename table and "Left open" (the wording beyond the quoted strings is free, provided it uses only the new terms).
- Plan 2, `docs/plans/archive/2611020805-acceptance-tests-plan.md`: its Technical arbitrations list, under "These keep "oracle" until plan 3", what this run renames. Plan 1, `docs/plans/archive/2610311031-acceptance-tests-plan.md`, lists the frozen modules and lifts that keep the old names for good.
- Today's sites, by count: `src/app/closeStop.ts`, `src/domain/plan/oraclePairs.ts`, `src/app/executePlan.ts` (OracleCommitMissingError, oracleStepFor, ORACLE_PROVIDER_TIMEOUT_MS), `src/domain/resetPhaseRefusal.ts`, `src/app/gates.ts`, `src/domain/whatsNext.ts`, `src/app/loadReviewHandoffInputs.ts`, `src/app/promptGeneration.ts`, `src/app/resumeInstructions.ts`, `src/domain/plan/overview.ts` and `overviewRender.ts`, `src/domain/errors.ts`, `src/domain/events.ts` (the failedStep value `oracle`, OracleStep and the closure's `oracleStep`), `src/domain/telemetry/events.ts`, `src/schemas/telemetryEvents.ts`, `src/app/telemetry/stopTelemetry.ts`, `src/app/recordsExplain.ts`, `src/app/fixLoop.ts`, `src/domain/gate/fixPrompt.ts`, `src/domain/authoring/prompt.ts`, `src/app/reviewHandoff.ts`, `src/cli/cliDocs.ts`, `src/cli/commands/` (resume, records, stopOutput, runLayers, resumeRegister). `grep -rniE 'oracle|discharg' src packages/schemas/src` gives the full list.

**Settle in Technical arbitrations, each with its dominant loss:**
- which telemetry readers exist, if any: whether a telemetry file written by 0.32.0 is ever read back, and so whether `oracle.edits.unjudged` needs a reader or simply disappears;
- the overview's JSON: whether `phax plans overview --json` carries a versioned stamp, and so whether `acceptanceRole` is a format change or a plain output change;
- the internal failedStep value and the closure's `oracleStep`: confirm neither is persisted, so they rename without a lift;
- which names keep "oracle" for good (readers, lifts, frozen modules, the `oracle-request` 0.26.0 format id, the old-name refusals, the test line's fourth field) and how a reviewer tells them from a miss;
- whether this plan adds the source half of the ac-oracle-kept scan (a test over `src/`, `packages/schemas/src/`, the help texts and the usage contract, with an allowlist of the kept sites), which plan 4 widens to the README, docs, site, example and skills. Without it, nothing stops a later commit from bringing an oracle word back into the sources before plan 4;
- the order of phases, so every commit is green.

**Constraints:**
- **This repository during the run.** The run is driven by the installed phax 0.32.0, which reads this repository's `phax.json` (`oracles` key, `node examples/vitest-oracles/main.mjs`) and sends `oracle-request`. No phase changes `phax.json`, `knip.json` or `examples/vitest-oracles`: plan 4 does. Do not migrate this repository's live spec and plan sidecars.
- **No back-compat shims.** Readers of records written by an earlier release keep reading them (ac-read-old); nothing new accepts an old name as an alias.
- **Behaviour unchanged.** Every existing oracle-pair test keeps its scenario and asserts the new words. Renamed test files keep their cases.
- **Isolation.** Tests never read `~/.phax`, a real `~/.claude`, `~/.codex` or `~/.vibe`, the global git config, or the real `gh`. Use `tests/helpers/isolateGit.ts`, temporary directories, the fake provider backends and `makeFakeGitHub()`.
- **Registries.** Respect the layer rules of `pnpm audit:architecture` and every exhaustive registry the tests hold, including the closure allowlist in `tests/unit/architecturalGuards.test.ts` and the telemetry event registries. List them as planned edits. `pnpm gen:usage-spec` and `pnpm docs:cli` rewrite `phax.usage.kdl`, `docs/cli/reference.md` and the README's generated block; list those too.
- **Gates.** The `standard` profile verifies every phase, and `phax.json` allows every command a phase runs.
- **Models.** Follow the phax-planning skill's model policy. Most of this plan is a mechanical rename: say why any phase needs more than Sonnet.
- **`### Test strategy`.** Use the line format with the spec's criterion ids, and cover ac-words and ac-read-old. While this run is driven by 0.32.0, this plan.md must use today's words: the test lines' loop `oracle`, and `**Oracle phase:** discharged by phase-NN` / `**Oracle files:**` header lines on any acceptance pair. Its own lint runs on 0.32.0; the dev build's lint departs on those lines, as expected.
- **Acceptance pair.** The `## Acceptance role` paragraph, the recovery headline `The acceptance step failed after all fix attempts.` and the records-explain row are quoted by the spec and stable. A pair is judged by `node examples/vitest-oracles/main.mjs`, which this run leaves untouched, so the installed phax's `oracle-request` still reaches it. Use one if it fits; otherwise say why.
- **Lint and skills.** The plan must pass `phax plans lint`. No skill changes, so the run needs no `--allow-skill-edits`.

**Docs:** none beyond the regenerated CLI reference and README block. The upgrading entry's telemetry and overview lines, if any, go to plan 4 with the rest of the entry.

**Phase shape:** as few phases as the gates allow, with every commit green. Rename core to surface: domain and its errors and events first, then the app's messages and prompts, then the CLI texts and the regenerated files.

**Output:** your final message is the plan document JSON and nothing else: no sentence before or after it, and no code fence.
