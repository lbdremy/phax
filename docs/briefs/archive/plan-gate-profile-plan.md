Write the phax plan "Plan gate profile" for the approved spec `docs/specs/2611251202-plan-gate-profile.md`. It is
the spec's only plan: it carries `completes-spec: true`.

Read the spec in full, sidecar included, and its brief `docs/briefs/archive/plan-gate-profile.md`. These are settled; do not
reopen them:
- the operator's verdicts of 2026-11-25 in §9b: q-scope `per-run`, q-markdown `section`, q-legacy `refuse`,
  q-staleness `removal-only`, q-default `always-declare`, q-verification `extra-checks`, q-records `records-only`;
- q-legacy's note: a run started before the release that adds the field is not resumed under it. When its kept
  `phax-plan.json` fails to decode for the missing field, the refusal says so and names the remedy (finish it with
  the release that started it, or reset). The run's recorded `gateProfileId` stays what resume uses;
- the non-goals of §7.

This plan takes every requirement of §5, every §6 surface and every §8 criterion, and q-records: the run's record
names the gate profile it ran and `phax records explain` shows it (no requirement of §5 says so; the verdict does).

## Facts read on main at d4c0007 (2026-11-25)

- **The pick.** `pickGateProfileId` (`src/cli/definitions/run.ts`, about line 182) returns the first key of
  `config.raw.gateProfiles`; `phax run` and its dry run use it. `src/cli/definitions/resume.ts` (about line 290) takes
  `runStatus.gateProfileId` and falls back to the first key. `recordGateProfileInRunStatus` in
  `src/app/executePlan.ts` records the profile at start.
- **Lint.** `src/app/lintPlan.ts` (about line 224) checks `plan.run.requiredCommands` against the first profile's
  steps, the same blind pick.
- **Resolution.** `resolveGateProfile` in `src/app/gates.ts` layers a workspace's `gateProfiles` entry over the
  project's under the same id; `src/app/runPreflight.ts` calls it; `src/app/loadConfig.ts` validates profiles.
- **The plan's shapes.** The deterministic extractor is `src/domain/plan/parsePlanMarkdown.ts` (it already reads the
  `## Required commands` preamble section); the extracted plan is `src/schemas/phaxPlan.ts` (`run` holds `shortName`,
  `title`, `requiredCommands`); the plan document and its sidecar are `src/schemas/planDocument.ts` with frozen
  versions under `src/schemas/history/plan-document/` and renderers under `src/domain/authoring/renderPlan*.ts`. The
  extraction schema `src/schemas/planExtraction.ts` and the LLM fallback prompt must carry the field too.
- **Authoring.** `src/app/authorArtifact.ts` and `src/app/reviseArtifact.ts` build the planning prompts; the skill is
  `.claude/skills/phax-planning/SKILL.md` ("Required commands declaration", each phase's `### Verification`).
- **The dry run** is `src/app/dryRun.ts`.
- **This repository's `phax.json`** has one profile, `standard`. The criterion "A plan runs the second profile" is
  met with a fixture config, not by adding a profile here (§7).

## Settle in Technical arbitrations, with the dominant loss of each

- **The schema versions.** Which persisted shapes gain the required field (`phax-plan`, the plan document, the
  extraction answer, the record that names the profile), which new versions are frozen under `src/schemas/history/`,
  and what `phax schema upgrade` does with an older document (q-legacy: refuse, no default written).
- **Where the records carry the profile** (q-records): the phase record or a run-level record, and its shape.
- **How resume refuses** a run whose kept `phax-plan.json` lacks the field: where the decode fails, and the refusal
  text with its remedy.
- **One function for "the run's profile"**, used by run, dry run, lint and the preflight, so the first-key pick has
  no caller left and is removed.

## Shape

Indicatively: the shapes and extraction first (schema, extractor, sidecar, renderers, frozen versions, refusal of a
missing or doubled declaration); then lint, preflight, run, dry run and resume using the declared profile; then the
records and `phax records explain`; then authoring (planning prompt lists the profiles, the skill names the profile
once in the preamble and `Verification` stops naming it) and docs. Models: `claude-opus-5-5` at medium for the
shapes and the run path; a mechanical skill and docs phase may run on `claude-sonnet-5`.

The skill edit needs the run's skill-edit grant: declare `.claude/skills/phax-planning/SKILL.md` in the phase that
edits it, and say in the Overview that the run is started with `--allow-skill-edits`.

This plan itself must declare its gate profile in the new form only once the release ships; today it runs under
`standard`, the first and only profile, so do not add a `## Gate profile` section to it.

No acceptance phase: the surface is a plan section, a sidecar field and CLI refusals, all checked by tests that
drive extraction, lint, run and resume against fixture configs.

## Lessons from the runs on this repository

- **knip runs at every phase's gate**, default and `--production --strict`, against `knip-baseline.json`
  (protected). An export that only a later phase uses fails the gate: export it where it is first used.
- **`pnpm lint` is type-aware, against `lint-baseline.json` (protected).** Fix a lint error in the code; never add
  a disable directive.
- **Protected, untouched**: `knip.json`, both baselines, `.oxlintrc.json`, `.oxfmtrc.json`, the tsconfigs,
  `vitest.config.ts`, the workflows, `tests/unit/architecturalGuards*.test.ts`.
- **Tests never read `~/.phax`, a real provider home, the global git config or the network.** A test that spawns a
  child goes through `tests/helpers/boundedSpawn.ts`.
- **Regenerated files**: a CLI help change regenerates `phax.usage.kdl` and `docs/cli/reference.md`
  (`pnpm gen:usage-spec`, `pnpm docs:cli`); a schema change regenerates `packages/schemas/json/` (`pnpm build` runs
  `scripts/schemas-json.ts`). Plan them in the phase that changes the source.
- **A new persisted shape** goes with a `docs/upgrading.md` entry and the frozen copy of the previous version.

Every required command must equal an entry of `security.agentCommands` or a gate command exactly; an entry with a
space in it covers only itself. `pnpm exec tsx`, `pnpm test:unit`, `pnpm test:integration`, `pnpm gen:usage-spec`,
`pnpm docs:cli`, `pnpm dev schema upgrade`, `git log`, `git grep`, `git mv`, `node` are `agentCommands`; `pnpm test`
is a gate command.
