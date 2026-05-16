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

Each test run:

1. Copies `tests/e2e/fixtures/minimal-repo/` into a fresh `os.tmpdir()` directory.
2. Runs `git init` + initial commit so phax sees a clean working tree.
3. Points `phax.json`'s `state.root` at a second temp directory (`PHAX_HOME`) so the run folder, worktrees, and locks never touch your real `~/.phax`.
4. Spawns the phax CLI as a child process (via `tsx`) against the temp repo.
5. On success: cleans up both temp directories.
6. On failure: **keeps** both temp directories and prints the failure-artifact block (see below).

The real `~/.phax` is never read or written.

## Reading the failure-artifact block

When a test fails, the helper prints a block like:

```
=== phax E2E failure artifacts ===
Repo path  : /var/folders/.../phax-e2e-XXXX
PHAX_HOME  : /var/folders/.../phax-home-XXXX
Run path   : /var/folders/.../phax-home-XXXX/runs/some-name
Run state  : {"status":"failed", ...}
Last log   : /var/folders/.../phase-01/claude-session.log
---
To inspect:
  cat /var/folders/.../phase-01/claude-session.log
  phax session-info some-name
  PHAX_STATE_ROOT=/var/folders/.../phax-home-XXXX phax resume some-name
  PHAX_STATE_ROOT=/var/folders/.../phax-home-XXXX phax enter some-name
===
```

The suggested commands use `PHAX_STATE_ROOT` to target the isolated PHAX_HOME, so you can resume or enter without touching your own state.

## Manually resuming a failed E2E run

If the run stopped mid-phase (rate limit, gate failure, network error):

```bash
# Resume from the failed phase
PHAX_STATE_ROOT=<PHAX_HOME from artifact block> phax resume <short-name>

# Enter the Claude session for the current phase
PHAX_STATE_ROOT=<PHAX_HOME from artifact block> phax enter-phase <short-name> <phase-id>
```

See the main README for `phax resume` and `phax enter-phase` usage.

## What the fixture tests

`tests/e2e/fixtures/minimal-repo/plan.md` has two phases:

- **phase-01** — adds an `add()` function to `src/index.ts` and commits.
- **phase-02** — documents the function in `README.md` and commits.

The gate is `node --version` (always passes). The model is haiku at low effort. The test asserts structural facts — phase folders created, commits present, state files correct — not exact model output.
