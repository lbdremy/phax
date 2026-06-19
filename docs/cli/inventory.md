# CLI Surface Inventory

Commander surface as of phase-01. Used as authoritative source for authoring `phax.usage.kdl` in phase-02. The parity gate (phase-06) enforces that the KDL and this live tree stay in sync.

## Top-level commands

| Command | Args | Flags | Description |
|---|---|---|---|
| `validate` | — | `--config <path>` (default: `phax.json`), `--plan <path>` (default: `phax-plan.json`) | Validate phax.json and phax-plan.json without any side effects |
| `unlock` | `<short-name>` | `--force` | Remove a stale run lock |
| `extract-plan` | — | `--plan-md <path>` (required), `--out <path>` (required), `--force`, `--model <model>`, `--effort <effort>` | Extract phax-plan.json from a plan.md by calling Claude Code headlessly |
| `enter` | `<short-name>` | — | Resume the final phase's agent session interactively |
| `enter-phase` | `<short-name> <phase-id>` | — | Resume a specific phase's agent session interactively |
| `session-info` | `<short-name>` | `--debug` | Print session diagnostics for a run |
| `shell` | `<short-name>` | — | Open a shell in the final worktree |
| `path` | `<short-name>` | — | Print the final worktree path (script-friendly, one line) |
| `open` | `<short-name>` | — | Open the final worktree in the configured editor |
| `ls` | — | `--active`, `--failed`, `--review-open`, `--archived`, `--json` | List runs from the registry |
| `archive` | `<short-name>` | `--force` | Archive a completed or review_open run |
| `run` | `[short-name]` | `--plan-md <path>` (default: `plan.md`), `--profile <profile>`, `--workspace <id>`, `--allow-dirty`, `--provider-priority <list>`, `--dry-run`, `--security <mode>` | Extract a plan from plan.md and run all phases, or preview with --dry-run |
| `review-handoff` | `<short-name>` | `--allow-partial` | Regenerate review-handoff.md and global file reconciliation for a review_open run |
| `publish-pr` | `<short-name>` | — | Push the final branch and create (or reuse) a GitHub PR for a review_open run |
| `init` | — | `--force` | Create phax.json and phax.schema.json in the current directory |
| `resume` | `<short-name>` | `-y, --yes`, `--verbose`, `--trace`, `--provider-priority <list>` | Resume a run from its next pending phase |
| `reset-phase` | `<short-name> [phase-id]` | `-y, --yes`, `--verbose`, `--trace` | Reset a stuck or failed phase so phax resume re-runs it from scratch |
| `agent` | — | — | Inspect and manage model routing and provider configuration (has subcommands) |
| `security` | — | — | Manage security configuration (has subcommands) |
| `skills` | — | — | Manage PHAX skills (has subcommands) |
| `schema` | — | — | Manage the local phax.schema.json (has subcommands) |

Global options (on all commands): `--verbose`, `--trace`

## Nested command families

### `agent`

| Subcommand | Args | Flags | Description |
|---|---|---|---|
| `agent models` | — | — | Print the routing table and provider priority |
| `agent resolve` | — | `--model <id>` (required), `--effort <level>` (required), `--json` | Show how a model+effort request resolves to a provider and concrete model |
| `agent probe` | — | — | Check which provider executables are available on PATH |
| `agent setup` | — | — | Set up provider integrations (has subcommands) |
| `agent setup mistral-vibe` | — | `--dry-run`, `--install-model-aliases` | Append PHAX-owned Mistral Vibe model aliases to ~/.vibe/config.toml |
| `agent setup providers` | — | `--write`, `--prune`, `--with-routing` | Reconcile ~/.phax/providers.json enabled flags from live executable probes |

### `security`

| Subcommand | Args | Flags | Description |
|---|---|---|---|
| `security status` | — | — | Show current security configuration and agent command allowlist |

### `skills`

| Subcommand | Args | Flags | Description |
|---|---|---|---|
| `skills install` | `<name>` | — | Install a named skill into `.claude/skills/` |

### `schema`

| Subcommand | Args | Flags | Description |
|---|---|---|---|
| `schema upgrade` | — | — | Upgrade the local phax.schema.json to the current bundled version |

## Removed commands

The `*-last` commands (`shell-last`, `path-last`, `open-last`, `archive-last`) were removed before this plan. They do not appear in the runtime tree and must not appear in `phax.usage.kdl`.

## Intended Usage contract coverage

All 21 top-level commands above are intended for coverage in `phax.usage.kdl`. The nested families (`agent`, `security`, `skills`, `schema`) must be covered with their full subcommand trees. No command is intentionally omitted from the contract.

Commands that will be added in later phases (not yet in the runtime):
- `completions <shell>` — added in phase-05
