# E2E Testing

phax has two test suites:

- **Unit + integration** (`pnpm test`) — runs on every commit, no network, no Claude Code, no cost.
- **Real E2E** (`pnpm test:e2e:real`) — opt-in, requires Claude Code, makes real API calls, takes several minutes and incurs token cost.

## Prerequisites

- `claude` CLI installed and on `$PATH` (`claude --version` works).
- Authenticated with Claude Code (`claude auth status` shows an active session).
- Network access (the test drives real Claude API calls).
- Expect ~5–15 min and modest token cost (haiku model, low effort, minimal fixture).

## Running the E2E suite

```bash
PHAX_E2E_RUN=1 pnpm test:e2e:real
```

Without `PHAX_E2E_RUN=1`, the suite skips every test immediately with a clear message — it never runs accidentally under `pnpm test`.

## Isolation model

The suites that spawn phax (`realFlow`, `headlessAuthoring` and the `phax run` cases of `vibeSecure`) run it in a temporary [phax home](phax-home.md).

`createTempEnv({ enable, routing })` (`tests/e2e/helpers/tempEnv.ts`):

1. Copies `tests/e2e/fixtures/minimal-repo/` into a fresh `os.tmpdir()` directory, then runs `git init` and an initial commit.
2. Creates a second temporary directory, the phax home, with a `providers.json` that enables `claude-code` plus the providers the suite lists in `enable`, and a `model-routing.json` holding the suite's `routing` or the built-in table. Both are built from the checked-out branch's own types and checked by its decoders, so they are in the branch's format.
3. Sets the fixture's explicit `state.root` to that temporary home, so run folders, worktrees and locks go there.

`runCli(args, env, opts)` takes that environment, not a directory, and refuses to spawn without it. It runs the branch's CLI from source in the temporary repository with `PHAX_HOME` set to the temporary home. `HOME` is unchanged, so the provider CLIs keep their sign-ins, and no credential is written into the temporary home.

The operator's `~/.phax` is left untouched: the spawned phax reads its config, providers, routing and telemetry from the temporary home and writes its telemetry journal there. Whether a suite runs never depends on the operator's `providers.json`. The `claude-code` flow of `realFlow` and `headlessAuthoring` check this by comparing, before and after, the files directly under `~/.phax` and the entry names under its `runs/` and `worktrees/`; `vibeSecure` compares `~/.phax/providers.json`.

The other suites spawn a provider CLI directly, or run phax in process with injected routing and a temporary state root.

On success, both temporary directories are removed. On failure they are **kept** and the failure-artifact block is printed.

## Reading the failure-artifact block

When a test fails, the helper prints a block like:

```
=== phax E2E FAILURE ARTIFACTS ===
Note: tests failed
Temp repo:      /var/folders/.../phax-e2e-repo-XXXX
Temp PHAX_HOME: /var/folders/.../phax-e2e-home-XXXX
Run path:       /var/folders/.../phax-e2e-home-XXXX/runs/<short-name>
...
Resume cmd:     phax resume <short-name> --yes
Enter cmd:      phax enter <short-name>
Session info:   phax session-info <short-name>
Temp dirs kept for debugging (skipping cleanup).
===================================
```

The lines from `Run path` to `Session info` appear only when the suite knows the run's short name. The printed commands name neither directory, so run them as shown below.

## Manually resuming a failed E2E run

If the run stopped mid-phase (rate limit, gate failure, network error), work from the temporary repository and name the temporary home:

```bash
cd <Temp repo from the block>

# Resume from the failed phase
PHAX_HOME=<Temp PHAX_HOME from the block> phax resume <short-name> --yes

# Enter the agent session of a phase
PHAX_HOME=<Temp PHAX_HOME from the block> phax enter-phase <short-name> <phase-id>
```

Here `phax` must be the phax under test, not an installed release: the temporary home is in the branch's format. A run keeps the home it started with, so `phax resume` refuses any other. See the main README for `phax resume` and `phax enter-phase` usage.

## What the fixture tests

`tests/e2e/fixtures/minimal-repo/plan.md` has two phases:

- **phase-01** — adds an `add()` function to `src/index.ts` and commits.
- **phase-02** — documents the function in `README.md` and commits.

The gate is `node --version` (always passes). The model is haiku at low effort. The test asserts structural facts — phase folders created, commits present, state files correct — not exact model output.
