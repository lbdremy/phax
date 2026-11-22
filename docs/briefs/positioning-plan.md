Write the phax plan "Positioning" for the approved spec `docs/specs/2611220953-positioning.md`. It is the spec's only
plan: it carries `completes-spec: true`.

Read the spec in full, sidecar included, and its brief `docs/briefs/positioning.md`. These are settled; do not reopen
them:
- the operator's verdicts of 2026-11-22 in §9: q-agent-page `page` (a "Delegating from an agent" page at
  `/guide/delegating`), q-llms-intro `split` (the meta description keeps the person pitch, llms.txt opens with the
  agent pitch);
- the operator's amendment of the same day: the agent pitch is exactly one sentence, and the agent detail sits under
  it on the agent page and in the phax-cli skill, never in `phax --help` or llms.txt;
- everything §10 lists as settled, and its constraints; the non-goals of §7.

This plan takes every requirement of §5, every §6 surface and every §8 criterion.

## Facts read on main at 9fcaa37 (2026-11-22)

- **The program's summary** is `summary: "Drive AI coding agents through isolated, gated phases"` in
  `src/cli/definitions/program.ts:81`. It is also in `phax.usage.kdl`, `docs/cli/reference.md`,
  `tests/fixtures/help/phax-root-help.txt` and `tests/unit/cli/phaxProgram.test.ts`. The first three are generated
  (`pnpm gen:usage-spec`, `pnpm docs:cli`); regenerate them, never hand-edit them.
- **The site's description is the README's first non-badge paragraph** (`readmeDescription`,
  `site/build/generate.ts:88`), used for the home page (line 234) and site-wide (line 480). Rspress builds llms.txt
  from it (`site/rspress.config.ts`, `llms: true`). q-llms-intro `split` therefore needs a build step that replaces
  llms.txt's introduction, or a second description Rspress reads for llms.txt only; check what the installed Rspress
  allows before choosing (ctx7 or its source in `node_modules`).
- **The home page** is `home` in `site/pages.ts`: `text`, `tagline`, nine `features` with a `key`, a `title`,
  `details` and a `link`. Every page also has a `description`, which feeds llms.txt. The page map assigns every
  README section and docs file exactly once; `pnpm site:build` fails on a page or section it misses.
- **The installed skills** come from `src/domain/skills/catalog.ts`; the phax-cli skill's text is
  `.claude/skills/phax-cli/SKILL.md`. Only phax-cli changes (§7).
- **The comparison pages' one-line differences**: `docs/comparisons/spec-kit-vs-phax.md` and
  `docs/comparisons/openspec-vs-phax.md` ("orchestration engine"), and the Spec Kit page's `description` in
  `site/pages.ts` ("a harness of gated, reviewable phases").
- **Where a check can run.** `pnpm check:full` is typecheck, unit, integration, type tests, lint, format check,
  architecture audit, knip and the model-catalog check. It does not build the site: `pnpm site:build` is a terminal
  gate step only. A check of the built llms.txt therefore runs in the site build, or the check reads the sources the
  build reads (README, `site/pages.ts`, the step that writes llms.txt's introduction) from a test.
- **Every route §6 names exists** except `/guide/delegating`, which this plan adds.

## Settle in Technical arbitrations, with the dominant loss of each

- **Where the pitches, the agent detail and their claims are stored once** (§10, left open): one module that the CLI,
  the site build, the README check and the skill check all read, or one file every place is compared with. The CLI's
  summary lives in `src/`, the site in `site/`, the README and the skill are Markdown; say which reads and which is
  compared, and respect the four layers (`pnpm audit:architecture`).
- **How llms.txt gets the agent pitch** (q-llms-intro `split`), and what the drift check reads to see it.
- **Where each check runs** (the claims' proofs, the drift, the rejected names), given that `check:full` does not
  build the site.

## Shape

Core to surface: the single source of the pitches, the agent detail and the claims, with the three checks and their
own tests (the §8 failure criteria are tests that feed a drifted place, an unshipped proof and a rejected name);
then the places, person first (README, both package.json, the home page's tagline and four features, the comparison
pages), then agent (the program summary and its generated files, the phax-cli skill, llms.txt, the new
`/guide/delegating` page in `site/pages.ts` with its description). A mechanical phase (regenerated files, the
comparison pages' wording) may run on `claude-sonnet-5`; the rest on `claude-opus-5-5` at medium.

No acceptance phase: the surface is text a test can read in full.

## Lessons from the runs on this repository

- **knip runs at every phase's gate**, default and `--production --strict`, against `knip-baseline.json`
  (protected). An export that only a later phase uses fails the gate: export it where it is first used.
- **`pnpm lint` is type-aware, against `lint-baseline.json` (protected).** Fix a lint error in the code; never add
  a disable directive.
- **Protected, untouched**: `knip.json`, both baselines, `.oxlintrc.json`, `.oxfmtrc.json`, the tsconfigs,
  `vitest.config.ts`, the workflows.
- **CI rehearses the release cut and the next opening on every pull request.** No test may name the opened version.
- **Tests never read `~/.phax`, a real provider home or the global git config.**
- **A change to the root help changes the help fixtures and the usage spec**: regenerate with the package scripts
  in the same phase.

Every required command must equal an entry of `security.agentCommands` or a gate command exactly; an entry with a
space in it covers only itself. `node`, `pnpm exec tsx`, `pnpm test:unit`, `pnpm test:integration`, `git log`,
`git grep`, `pnpm gen:usage-spec`, `pnpm docs:cli` are `agentCommands`; `pnpm test` and `pnpm site:build` are gate
commands (the latter a terminal step).
