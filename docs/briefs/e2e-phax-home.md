Write the phax spec `e2e-phax-home`: one place where phax resolves its own home (`~/.phax`), which an
environment variable can point elsewhere, and real-provider e2e tests that each run in a temporary phax home
holding the `providers.json` and routing they need, while the provider CLIs keep their own sign-ins in the real
`HOME`.

## Why

Running the real e2e of a branch reads and depends on the operator's own phax configuration. Found on
2026-11-19 with `vibe-model-flags` (PR #248):

- `tests/e2e/vibeSecure.test.ts` skips unless `mistral-vibe` is enabled in the real `~/.phax/providers.json`,
  because the `phax run` it spawns routes through that file. `createTempEnv` already moves `state.root` to a
  temporary directory, so runs never land in `~/.phax/runs`, but the configuration files are still read from
  the real home.
- That branch refuses a `providers.json` in the 0.40.0 shape (`modelEnvVar`, retired ids), and the released
  0.40.0 that the operator drives runs with refuses the new shape. Checking the branch end to end meant
  migrating the real file and breaking the operator's daily phax, or not checking it.
- The quick fix on that PR moved the cases that call the Vibe adapter directly out of the routed suite. The
  cases that go through `phax run` still need the real file.

Changing `HOME` for the child is not a way out: Claude Code, Codex and Vibe keep their sign-ins under it, and a
real e2e needs them.

## What phax has today, to read first

- `homedir()` is called in about ten places in `src/`, each building its own `~/.phax/...` path:
  `src/app/loadRouting.ts` (`model-routing.json`, `providers.json`), `src/app/loadConfig.ts` (the global
  `config.json`, `~/` expansion), `src/app/loadTelemetryConfig.ts` (`PHAX_HOME_DIR`, `telemetry.json`),
  `src/app/projectContext.ts` and `src/app/initWizard.ts` (the default state root), plus uses that are not
  phax's home: `src/infra/providerStoreRoots.ts` and `src/infra/providers/mistralVibe.ts` (the providers' own
  stores), `src/app/vibeSetup.ts`, `src/app/publishRun.ts` (writing `~` in a PR body),
  `src/cli/definitions/skills.ts`.
- `tests/e2e/helpers/tempEnv.ts` (`createTempEnv`): a temporary repository and state root, nothing else.
- The rule that unit and integration tests never read `~/.phax` or a real provider home: the e2e tier is the
  exception, deliberately, for the provider sign-ins only.

## What to decide

- **The variable**: its name (`PHAX_HOME`), what it moves (every `~/.phax` file: `config.json`,
  `providers.json`, `model-routing.json`, `telemetry.json`, the default state root), and what it never moves
  (the provider CLIs' homes, `~` written in a PR body). Whether `phax doctor` or `--verbose` says which home is
  in use when the variable is set.
- **One resolution point**: a single function or port that every reader goes through, and an architecture
  guard that refuses a new `join(homedir(), ".phax", …)` elsewhere.
- **The e2e side**: `createTempEnv` writes a temporary phax home with the `providers.json` and routing each
  suite needs (Vibe enabled for the Vibe suite, and so on), and every real-provider e2e uses it; which e2e
  files read the real `~/.phax` today (`vibeSecure` is known; check `realFlow`, `semanticTrace.providers` and
  the others).
- **Whether the variable is documented for users** (a second configuration, a CI machine) or kept as a test
  seam named in `docs/testing` only.

## Constraints

- The provider CLIs' sign-ins stay where they are: no copy of a credential into a temporary home, and phax
  still never reads one.
- No fallback: with the variable set, phax reads only that home, never the real one as a second source.
- No back-compat shim: the default stays `~/.phax`, so nothing changes for a user who does not set it.
