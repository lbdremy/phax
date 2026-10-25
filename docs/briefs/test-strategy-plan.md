Write the phax plan "Test strategy as data" for the approved spec `docs/specs/2610231041-test-strategy.md`. It is the spec's only plan, so it carries `completes-spec: true`.

Read the spec in full, sidecar included. These are settled; do not reopen them:
- the five operator decisions of 2026-10-23 in §9b: q-where `parsed-extracted`, q-migrate `parse-or-refuse`, q-lint `graded`, q-command `new-command` and q-architecture `run-provider`;
- everything §10 lists as settled.

Release context. 0.27.0 was released on 2026-10-25, and 0.28.0 is the open release (package.json is at 0.28.0, the last tag is v0.27.0). `src/schemas/release.ts` stamps plan-document at 0.26.0. Read it for the extracted plan's stamp too.

What already exists (read it before planning):
- **The plan document format** (`src/schemas/planDocument.ts`): `testStrategy` is a free `NonEmptyString`. `projectExtractedPlan` builds `phax-plan.json` key by key.
- **The plan renderer** (`src/domain/authoring/renderPlan.ts`).
- **The deterministic plan.md parser.** Lint, estimate and extraction share it, and it skips `### Test strategy` today. The model-fallback extraction and its JSON Schema, and the extraction cache seed (`src/domain/planCache/`), are part of the same path.
- **The frozen history** under `src/schemas/history/plan-document/` (0.25.0 and older), plus the snapshot tooling (`packages/schemas/build/snapshots.ts`, `scripts/schemas-check.ts`, `packages/schemas/history.lock.json`) and `tests/unit/frozenHistory.test.ts`.
- **How plan-document 0.25.0 was frozen when it moved to 0.26.0,** and how spec-document 0.25.0 was frozen for 0.27.0 (`src/schemas/history/spec-document/0.25.0.ts`, `src/domain/authoring/renderSpecV0_25_0.ts`). Follow the same path for plan-document 0.26.0: freeze its schema and its renderer, stamp the new shape 0.28.0, and lift every older shape to it.
  - **Extracted plan.** If the extracted plan (`phax-plan.json`) is a versioned format of its own, cut it the same way.
- **`phax artifact migrate-documents`** (`src/domain/artifact/documentMigration.ts`): its own-shape check, its refusals with a remedy, its report.
- **Lint** (`src/app/lintPlan.ts`, `src/domain/plan/lint.ts`, `lintRender.ts`, `oracleCheck.ts`). Its closed check set, its architecture-provider spawn for part bounds, and its finding order.
- **`phax plans` commands** (`src/cli/commands/plans.ts`) and the way `lint` and `estimate` are wired without a Backend.
- **The architecture report** (`src/schemas/architecture.ts`) and phax's glob dialect used for assignment bounds.
- **The spec document's acceptance criteria**, with their `id` in the sidecar only.
- **The phax-planning skill** (`.claude/skills/phax-planning/SKILL.md`): the Test strategy section and the headless section. Also the plan document JSON Schema printed by `phax artifact schema plan` and carried by the headless authoring prompt.

Live sidecars. Today no live plan sidecar exists under `docs/plans/` (`interactive-phases` was abandoned, and every other plan is archived). This plan's own sidecar will be live while it runs, at the 0.26.0 shape, with its test strategy as strings in the line format. The run must not migrate it on the branch. The run's own completion of this plan must pass whatever check the plan adds; check that, and raise an open question if it cannot. The live spec sidecars (`headless-review`, `artifact-decide-verdicts`, and this spec) are not touched.

Settle in Technical arbitrations, with the dominant loss of each:
- the key spellings left indicative (`loop`, `criterion`, the `testLines` key in `phax-plan.json`), the lint check name, and the rendered and JSON layouts of the overview;
- **The line grammar's edge cases.** Decide them, and give each its own test:
  - a guarantee that itself contains ` — ` or ` · `;
  - an oracle coordinate that contains ` · `;
  - backticks and code spans;
  - trailing spaces;
  - a wrapped continuation line;
  - Unicode line separators;
- what becomes of a run whose `phax-plan.json` was extracted by an older phax (resume, `phax-plan.json` refusal), with its `docs/upgrading.md` entry;
- whether the model-fallback extraction emits test lines through the same JSON Schema, and what happens when it emits a malformed one;
- how the overview reads the source spec's criterion ids: a spec with a sidecar, one without, a spec path that does not exist, and an archived spec;
- **Oracle pairs.** Whether to use one in this plan. A good candidate is the line parser and the lint rules: the oracle phase writes the table tests, and the discharging phase implements. The repository's `oracles` provider in `phax.json` runs the Vitest example. If you use one, follow the phax-planning skill's oracle rules; if not, say why.

Lessons from recent reviews (#157, #158, #161, #162, #163). Plan for these from the start:
1. **Every in-scope §8 criterion has its own test, named in the plan.** Every refusal and every finding has its own case.
2. **Published JSON Schemas match the decoders.** The closed sets reach the exported schema as enums, and a strict decoder publishes `additionalProperties: false`.
3. **All I/O goes through ports.** Tests never read `~/.phax`, a real `~/.claude`, `~/.codex`, `~/.vibe` or the global git config. Use `tests/helpers/isolatePhaxHome.ts` and `tests/helpers/isolateGit.ts`. A test that spawns the CLI passes `env: phaxHomeEnv()`.
4. **A refusal names its remedy.**
5. **The docs say exactly what the code does.** Check every README and docs sentence the plan dictates against the code it describes.
6. **The drift tests pass:** the generated usage spec, the CLI reference and the published schemas. Regenerate with `pnpm gen:usage-spec`, `pnpm docs:cli` and `pnpm exec tsx scripts/schemas-check.ts --write`, and never edit generated output by hand.
7. **Older shapes stay readable through their frozen modules,** never through optional fields.

Constraints:
- **Layers** as in CLAUDE.md. The line grammar, the lint rules, the coverage computation and the placement matching are pure domain logic. The overview's layer has no Backend, like lint's.
- **No back-compat shims.** Every test line key is required, and `criterion` is null when absent. Use explicit per-variant enums (`architecture.kind`, `oracleRole.kind`, `coverage.kind`).
- **Fixtures** are made up. Tests assert `$schema` URLs by format id and release pattern.
- **Gates:** every phase is verified by the `standard` gate profile, and every command it runs must be allowed by `phax.json`.
- **Skill edits:** the phax-planning skill changes, so the plan says `phax run --allow-skill-edits`.
- **Models:** follow the phax-planning skill's model policy, with an `assignmentReason` for any phase that departs from the default. This repository declares no assignment bounds.
- **Lint:** the plan must pass `phax plans lint`.
- **Test strategy:** write every `### Test strategy` in the skill's line format, with the criterion id from the spec sidecar where a line proves one. Once this plan lands, its own test strategy is data that this feature reads.

Docs:
- the new page `docs/plan-overview.md` (§11);
- `docs/upgrading.md` `### 0.28.0`: the plan-sidecar migration, hand-written plans' `### Test strategy`, and runs extracted before the release;
- README, wherever it describes the plan document, lint's checks, `phax plans` and migrate-documents;
- the phax-planning skill;
- `docs/acceptance-coverage.md`, untouched (§7);
- `NEXT_STEPS.md`: move `test-strategy` out of "Approved, not yet planned" in the closing phase.

Phase shape: as few phases as the gates allow, from the core outwards, with every commit green. A likely order (adjust any boundary that is wrong):
1. the test line format, the freeze of plan-document 0.26.0, the renderer and the schemas;
2. the parser, extraction into `phax-plan.json` and the cache seed;
3. the lint rules and the migration;
4. `phax plans overview`;
5. the skill and the docs.

Output: your final message is the plan document JSON and nothing else — no sentence before or after it, no code fence.
