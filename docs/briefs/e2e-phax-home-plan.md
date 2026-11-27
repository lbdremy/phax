Write the phax plan "E2e phax home" for the approved spec `docs/specs/2611261455-e2e-phax-home.md`. It is the
spec's only plan: it carries `completes-spec: true`.

Read the spec in full, sidecar included, and its brief `docs/briefs/e2e-phax-home.md`. These are settled; do not
reopen them:
- the operator's verdicts of 2026-11-27 in §9b: q-docs `user-facing`, q-notice `stderr-notice`, q-explicit-root
  `as-written`. The state root resolves in this order, weakest first: the built-in default `~/.phax`; `PHAX_HOME`
  when set; an explicit `state.root` in any config layer (project `phax.json`, local overlay, or the phax home's
  `config.json`), which always wins and is read as written. `state.root` stays optional in every layer, and
  `phax init` keeps not writing it;
- §10's settled list and constraints: no fallback read of `~/.phax` when `PHAX_HOME` is set, the home resolved per
  invocation (never a constant frozen at module load), `PHAX_HOME` decoded through a schema at the edge, the
  provider stores, the PR body's `~` and the user-scope skills install never moving, the temporary home's files
  built from the branch's own types or defaults (never a hand-written JSON fixture), real-provider e2e opt-in only;
- the non-goals of §7.

This plan takes every requirement of §5, every §6 surface and every §8 criterion, and the §11 docs page.

## Facts read on main at e2cf78a (2026-11-27)

- **The five readers of the home**, each building its path from `homedir()`: `src/app/loadRouting.ts`
  (`MODEL_ROUTING_PATH`, `PROVIDER_CONFIG_PATH`, module-load constants), `src/app/loadConfig.ts` (the global layer,
  twice; `stateRoot: expandTilde(config.state?.root ?? "~/.phax")` at line 573), `src/app/loadTelemetryConfig.ts`
  (`PHAX_HOME_DIR`, `TELEMETRY_CONFIG_PATH`; a missing `telemetry.json` is scaffolded), `src/app/projectContext.ts`
  and `src/app/initWizard.ts` (`DEFAULT_STATE_ROOT`, used for the records sync; `buildPhaxConfig` writes no
  `state` key). `PHAX_HOME_DIR` is used by `src/cli/commands/runLayers.ts` (the global telemetry journal, on the
  identity file system) and `src/cli/definitions/report.ts`.
- **Not phax's home** (must not follow `PHAX_HOME`): `src/infra/providerStoreRoots.ts`,
  `src/infra/providers/mistralVibe.ts`, `src/app/publishRun.ts`'s `~` rewrite, `src/cli/definitions/skills.ts`.
- **`state.root` is optional** in `PhaxConfigSchema` and in `PhaxUserOverlaySchema` (`src/schemas/phaxConfig.ts`).
- **`phax validate`** (`src/cli/definitions/validate.ts`): its `--json` answer (`ValidateOutput`) has no `$schema`
  and is not a published format, so adding `home` is no format move. Its help names `~/.phax/config.json`: a help
  change regenerates `phax.usage.kdl` and `docs/cli/reference.md`.
- **Environment reads** live in `src/infra/` and a few CLI files (`processIo.ts`, `usage.ts`, `completions.ts`,
  `sessions.ts`); no schema decodes an environment variable for the home today.
- **Unit and integration isolation.** `tests/helpers/isolatePhaxHome.ts` mocks `node:os` `homedir()` and sets
  `HOME`, because the paths are frozen at import; a spawned child gets `phaxHomeEnv()`.
  `tests/setup/phaxHomeGuard.ts` (a vitest setup file, not protected; `vitest.config.ts` that lists it is) refuses
  any test-process `node:fs` call inside the real `~/.phax`. Neither knows `PHAX_HOME`.
- **The real e2e.** `tests/e2e/helpers/tempEnv.ts` (`createTempEnv()` copies `tests/e2e/fixtures/minimal-repo`,
  whose `phax.json` pins `state.root`, and overrides it with a temporary `phaxHome`), `tests/e2e/helpers/runCli.ts`
  (spawns with `process.env` as is), `tests/e2e/helpers/providers.ts`; the three files that spawn phax:
  `realFlow.test.ts`, `headlessAuthoring.test.ts`, `vibeSecure.test.ts` (its phax run cases skip unless the real
  `providers.json` enables mistral-vibe). `vitest.e2e.config.ts` is protected.
- **Docs.** `docs/e2e-testing.md` (claims `~/.phax` is never read; suggests `PHAX_STATE_ROOT`); the README's
  configuration-layers paragraph; a new page is wired in `site/pages.ts` and `site/build/sources.ts`.

## Settle in Technical arbitrations, with the dominant loss of each

- **Where the home is resolved.** One function or service, its layer (the variable read in `src/infra/` or the CLI
  edge, decoded by a schema in `src/schemas/`, the resolved home handed inward), and how the five readers and the
  journal receive it per invocation instead of a module-load constant.
- **Which commands check an invalid `PHAX_HOME`** before reading anything, and which do not (help, `--version`,
  `--usage`, completions), and where the stderr notice is printed so that it appears once per command and never on
  stdout.
- **The unit and integration isolation** (§10, left open): `isolatePhaxHome` sets `PHAX_HOME` itself, or clears it
  and keeps mocking `homedir()`. Name what each costs the integration tests that spawn the CLI and assert its exact
  stderr, now that a set `PHAX_HOME` prints a notice. Say how a developer's exported `PHAX_HOME` is kept out of
  every unit and integration test (r-test-isolation), through the setup file, without editing `vitest.config.ts`,
  and whether `phaxHomeGuard.ts` also guards a set `PHAX_HOME`.
- **The e2e helper shapes** (§10, left open): how a suite declares its providers and an optional routing table, how
  the temporary `providers.json` is built from the branch's own provider types, and how the phax-spawning helper
  takes a test environment instead of a bare directory so that spawning phax without a temporary home cannot
  compile or is refused (r-no-spawn-without-home).
- **The architecture guard for r-one-point.** `tests/unit/architecturalGuards*.test.ts` is protected and the
  operator's to write. The plan does not edit it: name the guard's rule exactly (which files may read `homedir()`
  for phax's home, which may build a `.phax` path) in the Overview, so the operator writes it after the run. The §8
  criterion "The architecture audit refuses a second resolution point" is met by that guard, not by a phase.

## Shape

Indicatively: the home's schema and its one resolution point, with unit tables (unset, set, empty, relative, not a
directory, explicit `state.root` in each layer); then the readers moved onto it (routing, config, telemetry and the
journal, `report`, the default state root, `init`); then the invalid-home refusal and the stderr notice; then
`phax validate`'s home in text and JSON; then the unit and integration isolation; then the e2e helpers and the three
e2e files; then the docs (`docs/phax-home.md` wired into the site, the README paragraph, `docs/e2e-testing.md`
corrected). Models: `claude-opus-5-5` at medium for the code phases; the docs phase may run on `claude-sonnet-5-5`.

The real e2e does not run at the gate (`PHAX_E2E_RUN=1` is opt-in). The e2e phase is checked by `pnpm test:type`
and by unit tests of the helpers that need no provider; the operator runs the three named e2e files on the run's
branch before merging. Say so in the Overview. No acceptance phase.

Declare `standard` under `## Gate profile`.

## Lessons from the runs on this repository

- **knip runs at every phase's gate**, default and `--production --strict`, against `knip-baseline.json`
  (protected). An export that only a later phase uses fails the gate: export it where it is first used.
- **`pnpm lint` is type-aware, against `lint-baseline.json` (protected).** Fix a lint error in the code; never add
  a disable directive.
- **Both baselines only shrink, and their prune is the operator's.** A phase that deletes code carrying accepted
  debt (an unused export such as a removed path constant, an unsafe assertion in a test it removes) fails its gate
  until the operator prunes. Say in the phase's handoff which debt it removes, so the stop is expected.
- **Protected, untouched**: `knip.json`, both baselines, `.oxlintrc.json`, `.oxfmtrc.json`, the tsconfigs,
  `vitest.config.ts`, `vitest.e2e.config.ts`, the workflows, `tests/unit/architecturalGuards*.test.ts`.
- **Tests never read `~/.phax`, a real provider home, the global git config or the network.** A test that spawns a
  child goes through `tests/helpers/boundedSpawn.ts`. Never run the real e2e tier at a gate.
- **Regenerated files**: a CLI help change regenerates `phax.usage.kdl` and `docs/cli/reference.md`
  (`pnpm gen:usage-spec`, `pnpm docs:cli`, which also rewrites the README's generated block). Plan them in the
  phase that changes the source.
- **A refusal text in the behaviour corpus** changes only with the change that causes it, and the handoff lists
  each case.

Every required command must equal an entry of `security.agentCommands` or a gate command exactly; an entry with a
space in it covers only itself. `pnpm exec tsx`, `pnpm test:unit`, `pnpm test:integration`, `pnpm gen:usage-spec`,
`pnpm docs:cli`, `git log`, `git grep`, `git mv`, `node` are `agentCommands`; `pnpm test` is a gate command.
