Write the phax plan "Vibe model and thinking level by Vibe's own flags" for the approved spec
`docs/specs/2611180902-vibe-model-flags.md`. It is the spec's only plan: it carries `completes-spec: true`.

Read the spec in full, sidecar included, and its brief `docs/briefs/vibe-model-flags.md`. These are settled; do not
reopen them:
- the six operator decisions of 2026-11-18 in §9b: q-thinking-check `model-and-level` (departing), q-setup-command
  `remove`, q-fresh-start `env-model`, q-model-env-var `drop`, q-retired-successor `replace`, q-routing-file `refuse`;
- everything §10 lists as settled, and its constraints.

This plan takes every requirement, §5.1 to §5.18, every §6 surface and every §8 criterion.

## Facts checked on a real Vibe 3.1.3 export (2026-11-18), closing §10's left-open items

Probed by hand with `vibe -p … --agent accept-edits --disabled-tools '*' --output streaming --output-dir <dir>`:

- **New session**, `--model mistral-medium-3.5 --thinking off`: exit 0, `export.json` has
  `config.active_model = "mistral-medium-3.5"`, with Mistral's model catalog on (the config lists
  `mistral-medium-latest` and `mistral-large-4-0` beside it).
- **`config.models` is an object keyed by alias.** Each entry carries `alias`, `name` and `thinking`. The level phax set
  is `config.models["mistral-medium-3.5"].thinking = "off"`, although the model's default is `high`. So the level of a
  turn is `config.models[config.active_model].thinking`. No top-level thinking key exists (only `show_thinking_nodes`).
- **Resumed turn**, `--resume <id>` and neither flag: exit 0, `active_model = "mistral-medium-3.5"` and
  `config.models["mistral-medium-3.5"].thinking = "off"`. Vibe restores the level, so §5.5 holds on resumed turns.
- **Resumed turn with `--model`**: exit 1, stderr `Error: --model only applies to a new session`. §5.2 is required,
  not only tidy.
- `config.models` also lists every alias the user's own `~/.vibe/config.toml` declares (on this machine, phax's old
  `phax-mistral-medium-3.5-*` blocks, retired ones included). phax reads only the entry `active_model` names.

## Release context

0.39.0 is released and installed; 0.40.0 is the opened version. Runs on this repository use the installed phax. The
spec's upgrading example says 0.41.0; derive the version of the `docs/upgrading.md` entry from the code (the opened
version), never from the example.

## Concurrent work

The run `process-and-code-in-two-repositories` (plan `docs/plans/2611180744-code-repository-plan.md`) is open in
parallel. It shares no code file with this plan; it changes config (`src/schemas/phaxConfig.ts`, `codeLink`,
`mergeLayers`, `loadConfig`), the Git port, and the generated `docs/cli/reference.md`, `phax.usage.kdl`,
`phax.schema.json`, plus its own `docs/upgrading.md` entry. Whichever PR merges second is rebased and force-pushed, its
generated files regenerated. So: plan against today's code, keep away from that run's files, add to
`docs/upgrading.md` without reordering it, and regenerate generated files with their scripts rather than editing them.

## What exists (read it before planning)

- **Invocation**: `src/infra/providers/mistralVibe.ts` (`buildVibeArgs`, `spawnVibe`, `runVibeCompletion`, the version
  floor and its refusal text, the post-turn `vibeConfigMismatch` call), `src/domain/session/vibeFlags.ts`
  (`buildVibeFlags`, `buildSealedVibeFlags`, `vibeConfigMismatch`), `src/schemas/vibeExport.ts`.
- **Interactive stop**: `src/domain/session/mistral.ts` (`buildFreshStartCommand`), `src/app/interactiveStop.ts`,
  `src/app/enterPhase.ts`, `src/schemas/reviewStop.ts` (the persisted `{ cwd, argv, env }` stays).
- **Catalog and routing**: `src/domain/routing/defaults.ts` (the `mistral-vibe` entry, the equivalence edges,
  `RETIRED_MODEL_IDS`), `src/schemas/providerConfig.ts`, `src/app/loadRouting.ts`, `src/domain/routing/providerSetup.ts`.
- **Setup**: `src/app/vibeSetup.ts`, `src/schemas/vibeConfig.ts`, `src/cli/definitions/agent.ts`
  (`phax agent setup mistral-vibe` and `phax agent setup providers`).
- **Tests on the alias path**: every unit, integration and behaviour-corpus file that names `phax-mistral-medium-3.5`,
  `VIBE_ACTIVE_MODEL`, `modelEnvVar` or the installer (find them by search), and `tests/e2e/vibeSecure.test.ts`.

## Settle in Technical arbitrations, with the dominant loss of each

- where `--model` and `--thinking` sit in the argv (§10: tests check presence and values, not position);
- the JSON field names `phax agent setup providers --json` adds for the replaced ids and the dropped fields;
- how the post-turn check reads the level (`config.models[config.active_model].thinking`), and what it says when the
  entry or its `thinking` is absent.

## Shape

Every §8 criterion has its own named test. Core to surface: the catalog, retired ids and equivalences; then the argv and
environment of new and resumed sessions with the version floor; then the post-turn model and level check; then the
providers.json and model-routing.json refusals and the setup rewrite; then the installer's removal and the fresh-start
command and note; docs last. Show the surface in an acceptance phase first when an acceptance provider is configured.
Tests never run a real `vibe`, read a real `~/.phax` or `~/.vibe`, or reach the Mistral API, except
`tests/e2e/vibeSecure.test.ts`, which phases update but never run (it needs `PHAX_E2E_RUN=1` and a key; the operator
runs it at review). The docs are `docs/model-routing.md` (§11), `docs/model-catalog.md`, the README's Vibe setup and the
`docs/upgrading.md` entry.

A counter-example found during the run is a bug in the code under test unless the test made it. Never change a
persisted format's shape or stamp: this spec changes none.

## Lessons from the runs on this repository

- **knip runs at every phase's gate.** An export that only a later phase uses fails the gate. Test it in the phase that
  creates it, or export it where it is first used. Removing the installer leaves `vibeSetup.ts` and parts of
  `vibeConfig.ts` unused: delete them in the phase that removes their last caller.
- **CI rehearses the release cut and the next opening on every pull request.** No test may name the opened version or
  expect a `next` shape literally, except behaviour-corpus cases.
- **A catalog change regenerates the skills' catalog regions** (`pnpm gen:model-catalog`, which rewrites the
  marker-delimited model table of the phax-planning skill and the model-routing skill) in the phase that changes
  `DEFAULT_PROVIDER_CONFIG`; `check:full` runs it with `--check`.
- **A removed command or changed flag regenerates the usage spec and the CLI docs** (`pnpm gen:usage-spec`,
  `pnpm docs:cli`) in the phase that changes it.
- **After the acceptance phase, edit only the expected-failure markers in an acceptance test file.** Never retype a
  test's title.

Every required command must equal an entry of `security.agentCommands` or a gate command exactly. An entry with a space
in it covers only itself. `pnpm gen:usage-spec`, `pnpm docs:cli`, `pnpm exec tsx`, `pnpm test:unit` and
`pnpm test:property:deep` are `agentCommands` entries.
