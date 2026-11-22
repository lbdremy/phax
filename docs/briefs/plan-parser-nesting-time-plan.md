Write the phax plan "Plan parser nesting time" for the approved spec
`docs/specs/2611221308-plan-parser-nesting-time.md`. It is the spec's only plan: it carries `completes-spec: true`.

Read the spec in full, sidecar included, and its brief `docs/briefs/plan-parser-nesting-time.md`. These are settled;
do not reopen them:
- the operator's verdicts of 2026-11-22 in §9b: q-where `guard`, q-limit `limit-32`, q-size `depth-only`,
  q-configurable `constant`, q-upstream `no-report` (no upstream issue; a non-goal now), q-runs `keep-40`;
- everything §10 lists as settled, and its constraints; the non-goals of §7.

This plan takes every requirement of §5, every §6 surface and every §8 criterion.

## Facts read on main at 93a820e (2026-11-22)

- **Three modules call `fromMarkdown`**, each on the plan body:
  - `src/domain/plan/parsePlanMarkdown.ts`: `walkPlan` (line 426), shared by `collectPlanStructureErrors`,
    `readPlanDeterministic`, `extractPlanDeterministic` and `readPlanUnplannablePaths`; `readPlanTestStrategies`
    parses again (line 323);
  - `src/domain/plan/phaseHeader.ts`: `readPhaseHeaders` (line 244);
  - `src/domain/plan/sections.ts`: one parse (line 65) behind `locatePlanSections`, `phaseHeadingIds` and
    `phaseHeadingSources`; `src/domain/plan/finalize.ts` reads `phaseHeadingSources`.
- **The use cases that read a plan**: `lintPlan`, `loadOrExtractPlan` (run), `runPreflight`, `executePlan`,
  `planOverview`, `estimatePlan`, and also `analyzePlanOverlap`, `planStaleness`, `adjustPlan` and `loadConfig`,
  which the spec does not name. A check that sits where the body is parsed covers them all; say in the arbitrations
  what each of those four answers on a plan over the limit.
- **`StructureError` is `{ phase: string | null, message: string }`** (`parsePlanMarkdown.ts:358`); `lint.ts` maps
  them to structure findings. `loadOrExtractPlan` refuses a departing test line before the cache and any model call
  (line 44) and falls back to the model extraction on any other deterministic failure (line 66).
- **The property test** is `tests/unit/property/planParser.property.test.ts`: `TIME_BOUND_MS = 2000`,
  `BOUNDED_TIME_RUNS = 40`, fastest-of-three CPU timing; the fragments are in `tests/helpers/property/planText.ts`.
  The harness reads `PHAX_PROPERTY_SEED` and `PHAX_PROPERTY_RUNS`; `pnpm test:property:deep` is the deep pass.

## Settle in Technical arbitrations, with the dominant loss of each

- **How the depth is measured before parsing** (§10, left open): it may over-count CommonMark's depth, never
  under-count, and its work is linear in the plan's size and stops at the first line over the limit.
- **Where the check sits** so every reader shares it: one function every `fromMarkdown` call on a plan body goes
  through, or a check at each use case's entry. Respect the four layers (`pnpm audit:architecture`).
- **What plans lint still runs** beside the nesting finding (artifact validation and lineage read no Markdown
  structure), and how section location answers a plan over the limit.
- **How the seeded deep pass is verified.** 2,000 inputs do not belong in the gate. The hand-written cases (the
  61,440 `>` text, a nested list over 60 KiB) run in the unit suite on every pull request; say whether a phase runs
  `pnpm test:property:deep` with the failing seed, or the review does.

## Shape

Core to surface: the depth measure and the refusal in the domain, with their unit tests and the corpus test over
every plan under `docs/plans/` (archive included); then the readers and the use cases (lint's single finding, run's
refusal before the cache and the model, overview's and estimate's messages); then `docs/property-tests.md`'s
"The 2-second bound" section. Models: `claude-opus-5-5` at medium for the reasoning phases; a mechanical docs phase
may run on `claude-sonnet-5`.

No acceptance phase: the surface is command output a test reads in full.

## Lessons from the runs on this repository

- **knip runs at every phase's gate**, default and `--production --strict`, against `knip-baseline.json`
  (protected). An export that only a later phase uses fails the gate: export it where it is first used.
- **`pnpm lint` is type-aware, against `lint-baseline.json` (protected).** Fix a lint error in the code; never add
  a disable directive.
- **Protected, untouched**: `knip.json`, both baselines, `.oxlintrc.json`, `.oxfmtrc.json`, the tsconfigs,
  `vitest.config.ts`, the workflows.
- **CI rehearses the release cut and the next opening on every pull request.** No test may name the opened version.
- **Tests never read `~/.phax`, a real provider home or the global git config.** A test that spawns a child goes
  through `tests/helpers/boundedSpawn.ts`; the architectural guard refuses a new unbounded spawn.
- **No test measures wall-clock time**: CPU time or counted work only.

Every required command must equal an entry of `security.agentCommands` or a gate command exactly; an entry with a
space in it covers only itself. `node`, `pnpm exec tsx`, `pnpm test:unit`, `pnpm test:integration`,
`pnpm test:property:deep`, `git log`, `git grep` are `agentCommands`; `pnpm test` is a gate command.
