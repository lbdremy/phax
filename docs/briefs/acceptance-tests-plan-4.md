Write the last of the four phax plans of the spec `acceptance-tests` (`docs/specs/2610271119-acceptance-tests.md`, re-approved 2026-10-31). Plan 1, the formats, merged as #177; plan 2, lint, CLI and config, as #178; plan 3, prompts, messages, telemetry and the source scan, as #180. This run completes the spec (`completes-spec: true`) and is run with `phax run --allow-skill-edits`. Title it "Acceptance docs and skills".

**Scope.** Plan (4) of the spec's §10 "Plans" line: skills, docs, site and example. That is:
- the four skills that still teach oracle phases, under `.claude/skills/`: phax-planning (§5.22: an `## Acceptance phases` section, an `Acceptance candidate` defaults column, acceptance names a test's purpose and an acceptance test may be `small`, the `boundary` technique, the loop `acceptance | in-phase`), phax-decide-plan, phax-decide-review and phax-review (its `wrong-oracle` escape keeps its name);
- the README's prose outside its generated block, and the live docs: `docs/oracle-phases.md` renamed `docs/acceptance-phases.md`, `docs/plan-overview.md`, `docs/structured-answers.md`, `docs/comparisons/`, `docs/ideas/` and any other page the scan finds;
- the site: `site/pages.ts`'s route `/guide/oracle-phases` becomes `/guide/acceptance-phases` (spec §11), with its title and summary;
- the example `examples/vitest-oracles` renamed (pick the name), reading only an `acceptance-request` and naming `--skip-acceptance` in its remedy; this repository's `phax.json` (`"acceptance": { "command": … }`) and `knip.json` pointing at it;
- `tests/integration/vitestOraclesExample.test.ts`, renamed with the example, building the request again from phax's own `serializeAcceptanceRequest(makeAcceptanceRequest(…))` and decoding this repository's `phax.json` with `decodePhaxConfig` again (plan 2 made it read the raw key until now); `tests/unit/planningSkillOracles.test.ts`, renamed with the skill section;
- the 0.33.0 upgrading entry completed (§5.23, ac-upgrading);
- the ac-oracle-kept scan (`tests/unit/acceptanceWords.test.ts`, plan 3) widened to the README, the live docs (outside `docs/specs/`, `docs/plans/`, `docs/briefs/`, `docs/releases/` and the upgrading entries before 0.33.0), the site sources, the examples and the skills.

It covers ac-skill, ac-upgrading and ac-oracle-kept.

**What exists (read it first):**
- The spec's §5.21–§5.23, §6 `file: the phax-planning skill`, §8 "Oracle survives only in its literature sense", "The planning skill teaches acceptance phases" and "The upgrade entry", §10, and §11 (the docs page and its route).
- `tests/unit/acceptanceWords.test.ts`: its allowlist rules (each pattern spans the word it allows, each pattern must stay live, whole-file entries only for frozen, reader and lift modules) apply to every file this plan adds to the scan.
- The three earlier plans under `docs/plans/archive/`: their Technical arbitrations list what each left for plan 4.
- `docs/upgrading.md`'s `### 0.33.0` entry, which ends with "The provider steps of this release are listed here when they ship." Plan 3 also changed two outputs scripts may read: the telemetry event `oracle.edits.unjudged` is `acceptance.edits.unjudged`, and `phax plans overview --json` gives `acceptanceRole` (kind `acceptance` with `passedBy`, `passing` with `acceptancePhase`, or `none`) in place of `oracleRole`.
- `grep -rliE 'oracle|discharg' README.md docs site examples .claude/skills` for the full list; `site/generated/` is built and ignored.

**Settle in Technical arbitrations, each with its dominant loss:**
- the example's new name, and whether anything else (the docs page, the README, `phax init`, the skills) names its path;
- the old route `/guide/oracle-phases`: a redirect, a stub page, or gone, given the links released docs and external pages already hold;
- which `docs/ideas/` and `docs/comparisons/` mentions are prose about what judges a test (kept) and which name the feature (renamed);
- how the scan reads Markdown, the site's TypeScript and the example's `.mjs`, and which allowlist entries the upgrading entry, the refusals the docs quote and the archived spec slug `oracle-phases` need;
- the order of phases, so every commit is green.

**Constraints:**
- **This repository during the run.** The run is driven by the installed phax 0.32.0. It reads the main checkout's `phax.json` (`oracles`, `node examples/vitest-oracles/main.mjs`) at run and resume, which this run changes only on its branch.
  - **No acceptance pair.** 0.32.0 would send an `oracle-request` to the old example path in the phase worktree, which this plan renames and rewrites to read only an `acceptance-request`. Every test line is `in-phase`, and the plan carries no `**Oracle phase:**` line.
  - Put the `phax.json` and `knip.json` change in the phase that renames the example, and make it the last phase, so that if 0.32.0 reads the worktree's `phax.json` at any point after a phase, only the closing steps are at risk. Say so in the plan.
  - After this plan merges, the installed 0.32.0 refuses this repository's `phax.json`: no `phax run` here until 0.33.0 is released and installed, then the operator runs `phax artifact migrate-documents` on the live sidecars. Say it in the plan's overview; it is the operator's step, not a phase's.
  - Do not migrate this repository's live spec and plan sidecars.
- **Skills.** `.claude/skills/` is what `phax skills install` ships (the `files` list of `package.json`). Edit only the four skills named above; the run needs `--allow-skill-edits`. Keep `wrong-oracle` and the test line's fourth field `oracle`.
- **No back-compat shims.** The example reads only `acceptance-request`; an `oracle-request` is refused by it like any unknown format.
- **Isolation.** Tests never read `~/.phax`, a real `~/.claude`, `~/.codex` or `~/.vibe`, the global git config, or the real `gh`.
- **Registries.** Respect `pnpm audit:architecture`, knip, the site's page registry and link checks, and every exhaustive registry the tests hold. List them as planned edits. `pnpm docs:cli` and the site's generators rewrite generated files; list those too.
- **Gates.** The `standard` profile verifies every phase, and `phax.json` allows every command a phase runs.
- **Models.** Follow the phax-planning skill's model policy. Docs and skill sweeps are Sonnet work; say why any phase needs more.
- **`### Test strategy`.** Use the line format with the spec's criterion ids and cover ac-skill, ac-upgrading and ac-oracle-kept. Every test line's loop is `in-phase`, which 0.32.0 and the built phax both read.
- **Lint.** The plan must pass `phax plans lint` with the installed phax.

**Docs:** this plan is the docs. The upgrading entry names every operator step §5.23 lists, including the telemetry event and the overview JSON from plan 3, and the example's new path for anyone who copied it; drop its closing "provider steps … when they ship" line.

**Phase shape:** as few phases as the gates allow, with every commit green. Skills and docs first, the example with `phax.json` and `knip.json` last, the scan widened where its files are already clean.

**Output:** your final message is the plan document JSON and nothing else: no sentence before or after it, and no code fence.
