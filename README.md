# phax

`phax` is a **deterministic orchestrator** for AI coding agents: you give it a plan, and it executes that plan as a sequence of isolated, gated phases. The orchestration itself is plain code — phase sequencing, gates, retries, and state transitions are all deterministic — so the only non-deterministic part is the agent working _inside_ each phase.

Because every phase declares the files it expects to create or edit, phax makes each run **reviewable**: it reconciles the plan against what actually changed and surfaces every deviation — planned-but-not-done, done-but-not-planned, deleted, renamed — which the agent must justify in its handoff. Instead of landing on a pull request full of touched files with no idea what was intended, you get a review that's already framed, phase by phase and across the whole run.

Each phase runs in its own Git worktree, must pass its gates before the next one starts, and has a same-session fix loop for repairing gate failures; the final phase is kept open for human review. The agent itself is interchangeable — Claude Code, Mistral Vibe, or OpenAI Codex — selected by the [model-routing layer](#multi-provider-model-routing), with Claude Code as the default and terminal fallback.

## Quickstart

```bash
#1. install the CLI
npm install -g @lbdremy/phax

# 1.1 Install the phax skills (phax-planning + phax-cli) into your agent
phax skills install --target claude
# 1.2 Install phax CLI auto completions (optional - you need usage CLI to be installed first)
brew install usage
echo 'source <(phax completions zsh)' >> ~/.zshrc

# 2. Have any coding agent draft the plan (here: Claude Code). Point it at the
#    phax-planning skill so the plan.md it writes matches the format phax expects:
claude -p "Write plan.md for specs/<your spec> using the phax-planning skill."

# 3. extract the plan + run every gated phase
phax run --plan plan.md
# 4. push the final branch and open the PR
phax publish-pr <short-name>
```

## Install

**Via npm (recommended)** — the wrapper resolves and downloads the correct platform binary on first run:

```bash
npm install -g @lbdremy/phax
# or without installing:
npx @lbdremy/phax
```

**Direct binary download** — grab the binary and checksum for your platform from
[GitHub Releases](https://github.com/lbdremy/phax/releases):

```bash
# Example: macOS Apple Silicon
curl -LO https://github.com/lbdremy/phax/releases/latest/download/phax-darwin-arm64
curl -LO https://github.com/lbdremy/phax/releases/latest/download/phax-darwin-arm64.sha256
sha256sum --check phax-darwin-arm64.sha256
chmod +x phax-darwin-arm64
sudo mv phax-darwin-arm64 /usr/local/bin/phax
# macOS: remove the quarantine attribute added by the browser/curl
xattr -dr com.apple.quarantine /usr/local/bin/phax
```

> **macOS Gatekeeper note:** binaries are not yet code-signed or notarized. Without the `xattr` step above, macOS will block the binary on first run. Go to System Settings → Privacy & Security to allow it, or run the `xattr` command.

Available targets: `phax-darwin-arm64`, `phax-darwin-x64`, `phax-linux-x64`, `phax-linux-arm64`.

> **Binary size note:** the compiled binary is ~74 MB. The release build bundles the CLI
> with esbuild first (tree-shaken to ~1.5 MB of actually-used code) and then runs
> `deno compile --include` to embed the three runtime-read data files
> (`package.json`, `phax.usage.kdl`, `.claude/skills`). This avoids the un-bundled
> path which would embed ~274 MB of `node_modules` files (~360 MB total). The npm
> wrapper downloads the binary once and caches it per version at
> `~/.phax/bin/<version>/`, so the cost is a one-time download per upgrade.

## Runtime permission posture

The distributed `phax` binary is compiled with an explicit Deno permission set:

| Permission            | Status           | Notes                                                                                                                                   |
| --------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Filesystem read/write | **allowed**      | Required to manage run state, worktrees, locks, and artifacts                                                                           |
| Network               | **denied**       | phax itself makes no network calls                                                                                                      |
| Environment           | **allowed**      | Required so subprocesses can resolve executables via `PATH`                                                                             |
| Subprocess execution  | **unrestricted** | phax may spawn any executable; security comes from the provider-native jail and structured argv invocation, not an executable allowlist |

**Important:** Deno's permissions sandbox _phax_, not the provider CLIs it
launches. Once phax spawns `claude`, `codex`, or `vibe`, those processes run with
their own provider-native permissions and are not constrained by phax's Deno
permission set. Provider-level security (filesystem jail, network restrictions,
tool allowlists) comes from the provider's own sandbox — see
[Security modes](#security-modes) and the
[Security notes](#security-notes) section.

`phax open` uses the OS opener (`open` on macOS, `xdg-open` on Linux) so no editor binary needs to be installed or configured. The meaningful security boundaries are the provider-native jail (filesystem, network, tool restrictions) and phax's structured argv invocation — phax never interpolates user input into shell strings.

Requirements: at least one provider CLI on `$PATH`:

- `claude` — Claude Code (default, and the terminal fallback provider)
- `vibe` — Mistral Vibe (optional)
- `codex` — OpenAI Codex (optional)

Most setups want `claude` installed even when routing prefers another provider, because phax falls back to Claude Code when the preferred provider is unavailable or cannot satisfy the active security posture.

## Configure

Run `phax init` to create `phax.json` and `phax.schema.json` in the current directory. When stdin is a TTY it launches an interactive wizard (like `npm init`) that prompts for the project slug, gate commands, and optional compliance/publish toggles:

```bash
phax init           # interactive wizard (TTY) or non-interactive (detected defaults)
phax init --yes     # non-interactive: accept detected defaults without prompting
phax init --force   # reconfigure an existing phax.json (prompts again in a TTY)
```

In a non-TTY environment (CI, pipes) `phax init` automatically falls back to detected defaults with all optional toggles off — it never hangs waiting for input.

The wizard pre-fills the project slug from `package.json`'s `name` field (slugified), detects the package manager from the `packageManager` field, and suggests gate commands from existing scripts (`typecheck`, `lint`, `test:unit`, `format:check`, `build`). It writes `phax.json`, `phax.schema.json`, and `phax.user.schema.json`.

`phax.schema.json` is a JSON Schema generated from the installed binary's config contract — wire it up as `"$schema": "./phax.schema.json"` for editor validation. After upgrading phax, run `phax schema upgrade` to regenerate it (see [Schema upgrade](#schema-upgrade)).

Or add a `phax.json` manually at your repo root:

```json
{
  "$schema": "./phax.schema.json",
  "version": 1,
  "name": "my-project",
  "security": { "profile": "secure" },
  "fileReconciliation": { "mode": "report_only" },
  "review": { "compliance": { "enabled": true } },
  "publish": { "auto": true, "remote": "origin", "baseBranch": "main" },
  "commands": {
    "setup": ["pnpm install"],
    "cleanup": ["rm -rf node_modules"]
  },
  "gateProfiles": {
    "fast": ["pnpm typecheck", "pnpm test:unit"],
    "full": ["pnpm typecheck", "pnpm lint", "pnpm test", "pnpm build"]
  }
}
```

The top-level `name` is the run namespace — run short-names are scoped under it. Provider routing is **not** configured here — it lives in the global `~/.phax/` config (see [Multi-provider model routing](#multi-provider-model-routing)). The optional `security.profile` (`secure` \| `unsafe` \| `isolated`, default `secure`) sets the default security posture for runs; see [Security modes](#security-modes). The optional `fileReconciliation.mode` (`report_only` \| `warn`, default `report_only`) controls how per-phase file reconciliation reports deviations from the plan; see [Run](#run). The optional `review.compliance` and `publish` blocks turn on an automatic plan-compliance review and a pushed pull request when each run reaches review; see [Compliance review & publishing](#compliance-review--publishing).

Validate it before running:

```bash
phax validate
# also validate a phax-plan.json:
phax validate --plan phax-plan.json
```

## Configuration layers

phax resolves configuration from four layers, least-to-most specific (most personal wins):

| Layer                   | File                           | Purpose                                                 |
| ----------------------- | ------------------------------ | ------------------------------------------------------- |
| Built-in defaults       | —                              | `~/.phax` state root, `maxFixAttempts: 1`, etc.         |
| Project config          | `phax.json` (committed)        | Team baseline: gate profiles, identity, security grants |
| Global user config      | `~/.phax/config.json`          | Machine-wide preferences: model, state root, MCP mode   |
| Per-project user config | `phax.local.json` (gitignored) | This user × this repo overrides                         |

**Scalars** — the highest present layer wins (e.g. `state.root`, `agent.maxFixAttempts`, `security.profile`).

**Allowlists** — union across all layers, so user layers can only _add_ to the project's security baseline, never silently remove it. This applies to `security.filesystem.allowRead`, `security.filesystem.allowWrite`, `security.agentCommands`, `security.mcp.allow`, and `gateProfiles` (union by key; the higher layer's command array wins for a shared key).

`phax.local.json` is gitignored — it is the right place for per-developer preferences like model selection or trust overrides that should not be committed. `~/.phax/config.json` is for preferences that apply to all repos on your machine. A JSON Schema for both user layers is generated alongside `phax.schema.json` as `phax.user.schema.json`.

## Schema upgrade

After upgrading phax, regenerate `phax.schema.json` to match the new binary's config contract:

```bash
phax schema upgrade
```

This rewrites `phax.schema.json` and `phax.user.schema.json` next to the nearest `phax.json` and reports whether the files changed or were already current. It never modifies `phax.json`.

## Write a plan

Author `plan.md` with the [`phax-planning`](.claude/skills/phax-planning/SKILL.md) skill — it is the source of truth for the plan format that `phax extract-plan` consumes. The skill defines the per-phase template contract (heading + `{#phase-NN-<slug>}` anchor, recommended model/effort, the three planned-file lists, gate-profile verification, commit subject/body) and the planning doctrine (plan outside-in, implement inside-out, verify outside-in). Point your agent at that skill when drafting or reviewing a plan; don't hand-roll the format.

In short: `plan.md` is a Markdown document with one `## phase-NN — <title>  {#phase-NN-<slug>}` section per phase, each carrying an objective, detailed instructions, planned-file lists, a gate-profile verification step, and a commit subject/body. See `examples/plan.md` for a worked example and [`.claude/skills/phax-planning/SKILL.md`](.claude/skills/phax-planning/SKILL.md) for the full template contract.

## Extract the plan

```bash
phax extract-plan --plan-md plan.md --out phax-plan.json
```

This invokes the configured extraction agent headlessly with the `phax-plan.json` JSON Schema, validates the structured output, and writes the plan atomically. Add `--force` to overwrite an existing file.

## Run

```bash
phax run --plan plan.md                         # full execution (extracts plan.md, runs every phase)
phax run my-feature --plan plan.md              # set the run short name explicitly
phax run --plan plan.md --dry-run               # preview only — zero side effects
phax run --plan plan.md --allow-dirty           # skip clean-tree guard
phax run --plan plan.md --provider-priority mistral-vibe,claude-code  # override provider priority for this run
phax run --plan plan.md --security unsafe       # override the security mode for this run
```

Each phase:

1. Creates a Git worktree at `~/.phax/worktrees/<short-name>/phase-NN/` on its own branch `<run.branch>--phase-NN`.
2. Runs `commands.setup` inside the worktree.
3. Builds a prompt from the plan and the previous phase's handoff, sends it to the selected provider's agent (resolved by the routing layer; see [Multi-provider model routing](#multi-provider-model-routing)).
4. Runs the gate profile; on failure, resumes the same agent session once and retries.
5. After passing gates, resumes the agent to produce `phase-handoff.md`.
6. Commits with the planned message. If the worktree is clean (no changes), the run stops with a non-zero exit and writes `resume-instructions.md` — use `phax resume` to continue from the next phase.
7. Reconciles the files actually touched against the phase's planned files, writing `file-reconciliation.{json,md}` to the phase folder. Deviations (unplanned creates/edits, missing planned changes) are injected into the next phase's prompt so the agent sees how the prior phase diverged from its plan; with `fileReconciliation.mode: "warn"` they are also logged (default `report_only` only records them).

Each phase gets its own branch (`<run.branch>--phase-01`, `<run.branch>--phase-02`, …), chained: phase-01 branches off `<run.branch>`, phase-N branches off the previous phase's branch. The base `<run.branch>` stays at the run-start commit. The final phase's branch carries the full commit chain and is the ref to review, merge, or push.

Worktrees from every phase persist on disk for the lifetime of the run and are available for inspection until `phax archive` is run.

The final phase stays open for review. A `review-handoff.md` is written to the run folder showing the final phase branch as the review target. When the run reaches review, two optional steps run automatically if enabled in `phax.json` (both are non-fatal — the run stays `review_open` if they fail):

1. **Compliance review** (`review.compliance.enabled`) — a non-mutating plan-compliance pass writes its verdict to the run folder, so it can land in the PR body.
2. **Publish** (`publish.auto`) — pushes the final phase branch to the configured remote and opens (or reuses) a pull request; details are recorded in `publication.json`.

See [Compliance review & publishing](#compliance-review--publishing).

When `phax run` finishes (or is interrupted), it prints an end-of-run recap to the terminal summarizing the run state, the review target branch, any published PR URL, and the next command to run.

**macOS sleep prevention** — long-running `phax run` sessions can be wrapped with
`caffeinate` to prevent macOS from sleeping while phax executes:

```bash
caffeinate -ims phax run --plan plan.md
```

## Review loop

```bash
phax enter <short-name>   # resume the final agent session
phax shell <short-name>   # open $SHELL in the final worktree
phax path  <short-name>   # print the worktree path (script-friendly)
phax open  <short-name>   # open the worktree in the configured editor
```

## Compliance review & publishing

Both steps run automatically at the end of a run when enabled (see [Run](#run)), and can also be invoked on their own against a `review_open` run:

```bash
phax review-compliance <short-name>   # non-mutating plan-compliance review of the agent's work
phax publish-pr <short-name>          # push the final branch and open (or reuse) a PR
```

`phax review-compliance` re-invokes the AI agent with the run's handoff artifacts and the original plan and writes a verdict; it never touches the worktree, registry, or any files. Configure its model/effort under `review.compliance` in `phax.json` (default model `claude-sonnet-4-6`, effort `medium`).

`phax publish-pr` pushes the final worktree branch to the GitHub remote and creates a pull request, reusing an existing PR for the same branch if one exists. It requires a GitHub remote and an authenticated `gh` CLI. Configure the remote, base branch, and title under `publish` in `phax.json`.

## List runs

```bash
phax ls                   # all runs
phax ls --active          # created or running
phax ls --failed
phax ls --review-open
phax ls --archived
phax ls --json            # machine-readable
```

## Archive

Archive is the **only** operation that touches `worktrees/`. It moves:

- `~/.phax/runs/<short-name>` → `~/.phax/archive/<short-name>/runs/`
- `~/.phax/worktrees/<short-name>/` → `~/.phax/archive/<short-name>/worktrees/`

Then runs `git worktree prune` to drop stale admin records. Nothing is destructively deleted — every phase's working state is preserved for later inspection.

```bash
phax archive <short-name>       # requires review_open or completed
phax archive <short-name> --force  # allow uncommitted changes in final worktree
```

## Multi-provider model routing

PHAX can route phase execution through Claude Code, Mistral Vibe, or OpenAI Codex based on a user-editable global routing config (`~/.phax/model-routing.json`). The routing layer maps requested model IDs to stable **model families** and **PHAX tiers**, then selects the best available provider from `providerPriority`.

```bash
phax agent models                              # print routing table + provider priority
phax agent resolve --model claude-sonnet-4-6 --effort medium [--json]
phax agent probe                               # check provider executable availability
phax agent setup mistral-vibe --dry-run        # preview Vibe alias installation
phax agent setup mistral-vibe --install-model-aliases  # install PHAX Vibe aliases
```

The default `providerPriority` is `["mistral-vibe", "codex-cli", "claude-code"]` (the spec §12 multi-provider table). On a clean install, mistral-vibe and codex-cli are `enabled: false` in the default provider config, so all phases run through Claude Code as before. Enabling them via `phax agent setup providers` (or editing `~/.phax/providers.json`) activates the richer routing. See [`docs/model-routing.md`](docs/model-routing.md) for the full resolution pipeline, tier table, relationship semantics, and worked examples.

## Security modes

Every run executes under a security posture, set by `security.profile` in `phax.json` and overridable per run with `--security`:

| Mode       | Behavior                                                                                                                                                                         |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `secure`   | **Default.** Provider-native sandboxing — filesystem jailed to the worktree, network governed by `network.profile` (enforced only where the provider supports it), MCP disabled. |
| `unsafe`   | Host-unrestricted: full filesystem/network access. Prints a warning. Use only for trusted plans.                                                                                 |
| `isolated` | External-sandbox mode — planned, not yet available (the CLI rejects it today).                                                                                                   |

Provider capability matters under `secure`: Claude Code and Codex have strong filesystem jails and run natively, while Mistral Vibe has only a **partial** jail. In strict `secure` mode a partial-jail provider cannot satisfy the policy, so routing skips it and falls back to Claude Code; the applied posture (including any downgrade) is recorded in each phase's `security.json` and the final report. Network controls differ too: no provider enforces a domain allowlist, and Codex is the only one with a hard egress toggle (`provider-only` disables subprocess network); for Claude and Vibe the `network.profile` is recorded but not enforced as a domain filter.

Shell access for the agent (used to run and fix the phase's gate commands) is also constrained per provider, at different granularities — Claude allowlists exactly the gate commands, while Codex and Vibe rely on their sandbox/approval models. See [Shell command execution](docs/security.md#shell-command-execution) in the security docs for the details.

## Testing

```bash
pnpm test               # unit + integration — fast, no network, no provider CLIs
pnpm test:e2e:real      # opt-in real E2E — drives the installed provider CLIs, costs tokens
```

The E2E suite skips automatically unless `PHAX_E2E_RUN=1` is set, so it never runs by accident. It runs one real-flow suite per provider (Claude Code, Mistral Vibe, Codex), each forcing its provider with `--provider-priority` and gated on that provider's CLI being installed — so only the providers you have set up actually run. See [`docs/e2e-testing.md`](docs/e2e-testing.md) for prerequisites, isolation model, and how to read failure artifacts.

## Debugging

Add `--verbose` to any command to print semantic events (state transitions, adapter calls, gate results) to the terminal:

```bash
phax run --plan plan.md --verbose
phax resume <short-name> --verbose
```

Add `--trace` to also write one JSON line per semantic event to `semantic.jsonl` in the run folder (`~/.phax/runs/<short-name>/`):

```bash
phax run --plan plan.md --trace
```

Both flags can be combined. See [`docs/observability.md`](docs/observability.md) for the full observability architecture and [`docs/extract-plan-model.md`](docs/extract-plan-model.md) for how to configure the model used by `extract-plan`.

## Observability

phax emits structured semantic telemetry through the `SystemTelemetry` port — state transitions, adapter calls, gate results, and artifacts. Telemetry is on by default and recorded to a per-run journal; toggle it globally with `"enabled": false` in `~/.phax/telemetry.json`. Two opt-in flags surface it live:

| Flag        | Effect                                                               |
| ----------- | -------------------------------------------------------------------- |
| `--verbose` | Print semantic events to the terminal                                |
| `--trace`   | Write semantic events as JSONL to `semantic.jsonl` in the run folder |

See [`docs/observability.md`](docs/observability.md) for architecture details, the snapshot rule, and the adapter-boundary failure contract.

## Resume

```bash
phax resume <short-name>        # restart from the next pending phase
phax resume <short-name> --yes  # skip confirmation
phax resume <short-name> --yes --provider-priority codex-cli,claude-code  # override provider priority
```

Resume validates the run state, lock, and worktree before proceeding. It never re-runs committed phases. If the run is `review_open`, it refuses and points you at `phax enter`.

## Locks

`phax` writes a lock file at `~/.phax/locks/<short-name>.lock` for every active run. If a process dies, the lock can become stale:

```bash
phax unlock <short-name>        # remove stale lock
phax unlock <short-name> --force  # remove any lock
```

## Exit codes

| Code | Meaning                                         |
| ---- | ----------------------------------------------- |
| 0    | Success                                         |
| 1    | Validation error, config error, or plan error   |
| 2    | Gate failure (after fix loop exhausted)         |
| 3    | Lock conflict                                   |
| 4    | Unsafe git state (dirty worktree)               |
| 5    | Agent invocation error (Claude, Vibe, or Codex) |
| 6    | Handoff generation failed                       |
| 8    | Rate limit or usage limit hit (resumable)       |
| 9    | Phase produced no changes (resumable)           |

## Environment variables

phax has no runtime-configuration env vars — the state root, telemetry, and security posture are all set in `phax.json` (and `~/.phax/telemetry.json`), not via the environment. The one variable phax honors gates the opt-in real E2E suite:

| Variable       | Purpose                                                        |
| -------------- | -------------------------------------------------------------- |
| `PHAX_E2E_RUN` | Set to `1` to enable the real E2E suite (`pnpm test:e2e:real`) |

## Troubleshooting

**`claude` not found** — install Claude Code and ensure the binary is on `$PATH`.

**Lock conflict** — another `phax` process is running, or a previous process died. Run `phax unlock <short-name>` to clear a stale lock.

**Gate failure loop** — increase `maxFixAttempts` in `phax.json`, or reduce gate scope. Check `~/.phax/runs/<short-name>/phase-NN/checks-attempt-01.log` for details.

**Missing `phase-handoff.md` sections** — the phase transitioned to `handoff_failed`. Check the phase status file and resume the agent session with `phax enter`.

**Format conflicts** — run `pnpm format`, do not add lint exceptions. **Knip failures** — remove the dead code or wire it into an entry point, do not add `ignoreDependencies` entries casually.

## State Machine

phax is implemented as an explicit hierarchical state machine. Every signal (gate result, rate limit, agent completion, archive request) is a typed `PhaxEvent`. The pure reducer returns a `Disposition` — `Handled`, `Ignored`, `Stale`, `Rejected`, or `Unexpected` — plus optional side-effect commands. The single `dispatch()` entry point is the only writer to `status.json` and `run-status.json`.

See [`docs/state-machine.md`](docs/state-machine.md) for:

- Mermaid diagrams of the run and phase hierarchies
- The full event-disposition matrix
- The event and command vocabularies
- A worked example of adding a new signal

## Security notes

`phax` never interpolates user-controlled data (branch names, workspace paths, plan fields) into shell command strings. All git and shell invocations pass arguments as separate `argv` tokens. Gate commands from `phax.json` are treated as opaque pre-validated arrays, not shell strings.

## CLI specification (`phax.usage.kdl`)

`phax.usage.kdl` is a machine-readable CLI contract generated from the Commander.js program in `src/cli/`. It is a derived artifact — Commander is the source of truth — and must be regenerated after any change to a command, flag, or argument:

```bash
pnpm gen:usage-spec
```

The integration gate `tests/integration/usageSpecDrift.test.ts` asserts the committed file is byte-identical to the generator output, so a CLI change without regenerating the spec will fail the gate. Downstream tooling (`phax --usage`, shell completions, `docs/cli/reference.md`, and external consumers such as a generated client library or editor integration) all derive from this spec.

## Shell completions

`phax` ships a generated shell completion script via `phax completions <shell>`. Supported shells: `zsh`, `bash`, `fish`, `nu`, `powershell`.

**Prerequisite:** the [`usage` CLI](https://usage.jdx.dev/cli/) must be installed — it is needed both to generate the script and at Tab-time (the generated script calls back into `usage complete-word`):

```bash
brew install usage
```

**Per-shell install:**

```bash
# zsh (default shell on macOS) — write a _phax completion onto your $fpath.
# If you already have a completions dir on $fpath, just drop the file in:
phax completions zsh > "${fpath[1]}/_phax"

# bash
source <(phax completions bash)
# or add to ~/.bashrc:
echo 'source <(phax completions bash)' >> ~/.bashrc

# fish
phax completions fish > ~/.config/fish/completions/phax.fish

# nushell — add to your nu config
phax completions nu | save --force ~/.config/nushell/completions/phax.nu
# source it in env.nu or config.nu

# powershell
phax completions powershell >> $PROFILE
```

**zsh on macOS, from scratch** — if you don't already have a completions directory on `$fpath`, set one up once:

```zsh
# 1. Create a directory for personal completions and put the _phax file in it.
mkdir -p ~/.zsh/completions
phax completions zsh > ~/.zsh/completions/_phax

# 2. Make zsh load it (add to ~/.zshrc). Skip the compinit line if your setup
#    already runs it — frameworks like oh-my-zsh do.
cat >> ~/.zshrc <<'RC'
fpath=(~/.zsh/completions $fpath)
autoload -Uz compinit && compinit
RC

# 3. Reload your shell, then Tab-complete:
exec zsh
phax <Tab>
```

After this, `phax <Tab>` lists subcommands and `phax enter <Tab>` completes run short-names live from your registry.

`phax --usage` and `phax completions` work from the release binary as well as from source. Both commands read `phax.usage.kdl`, which is embedded in the binary at build time via `deno compile --include`.

Once the completion script is installed, Tab also completes run short-names for commands that take one (`phax enter`, `phax resume`, `phax archive`, and others). Candidates are fetched live from `phax ls --complete`, so they reflect the actual runs in your registry at Tab-time.

## CLI command reference

<!-- BEGIN GENERATED CLI REFERENCE -->

Full CLI reference: [`docs/cli/reference.md`](docs/cli/reference.md).

- `phax validate [--plan <path>]` — Validate phax.json and its user overlays without any side effects; pass --plan to also validate a phax-plan.json
- `phax unlock [--force] <short-name>` — Remove a stale run lock; use --force to remove any lock
- `phax extract-plan <FLAGS>` — Extract phax-plan.json from a plan.md by calling Claude Code headlessly
- `phax enter <short-name>` — Attaches to the kept-open agent session in the final worktree, so you can review the agent's work, ask follow-up questions, or apply manual fixes interactively.
- `phax enter-phase <short-name> <phase-id>` — Attaches to the agent session for a specific phase worktree. Useful for inspecting intermediate state or debugging a phase that has not yet been committed to main.
- `phax session-info [--debug] <short-name>` — Prints diagnostic information about a run: its current state, active phase, worktree path, and agent session id. Read-only — no side effects.
- `phax shell <short-name>` — Opens an interactive shell in the final worktree. Useful for manually inspecting files, running tests, or executing commands outside the agent session.
- `phax path <short-name>` — Prints the absolute path to the final worktree on a single line. Useful in scripts: cd $(phax path my-run) or for piping to other tools.
- `phax open <short-name>` — Opens the final worktree in the editor configured in phax.json (or the EDITOR environment variable). Equivalent to running your editor with the worktree path as an argument.
- `phax ls [FLAGS]` — Lists runs from the local registry (~/.phax/runs/). With no filter flags, shows all runs. Use status filters to narrow output: --active (created or running), --failed, --review-open (awaiting human review), or --archived. Use --json for machine-readable output.
- `phax archive [--force] <short-name>` — Archives a run by removing its worktrees and marking it archived in the registry. Without --force, fails when the final worktree has uncommitted changes.
- `phax run <FLAGS> [short-name]` — Extracts a plan from the plan.md given by --plan, creates a run entry in the registry, and executes each phase sequentially in its own Git worktree using the configured AI agent. Each phase runs a gate profile after execution; the final phase worktree stays open for human review.
- `phax review-handoff [--allow-partial] <short-name>` — Regenerate review-handoff.md and global file reconciliation for a review_open run
- `phax publish-pr <short-name>` — Pushes the final worktree branch to the GitHub remote and creates a pull request, or reuses an existing PR for the same branch. Requires a GitHub remote and gh CLI authentication.
- `phax review-compliance <short-name>` — Runs a non-mutating plan-compliance review by invoking the AI agent with the run's handoff artifacts and the original plan. Does not modify the worktree, registry, or any files.
- `phax review-code [FLAGS] <short-name>` — Opens an interactive, pre-prompted code-review session for a review_open run by launching the AI agent in the run's worktree with the code-review prompt. The session is resumable: re-running resumes the existing session, while --new-session starts fresh. The developer takes over the session to investigate, discuss, and apply fixes.
- `phax plans-overlap [FLAGS] <plan>` — Two modes:
- `phax adjust-plan <FLAGS> <plan>` — Opens an interactive, pre-prompted session to help you adjust a plan.md after a landed run has introduced drift. The session establishes which of the plan's declared files, line references, and decisions are invalidated by the landed run's actual changes, asks clarifying questions where needed, proposes concrete edits and waits for your explicit approval, and only then edits and commits the plan — all interactively within the session. The command itself mutates nothing.
- `phax init [--force] [--yes]` — Creates phax.json and phax.schema.json in the current directory. Use --force to overwrite an existing phax.json. Does not connect to any network or external service.
- `phax report [--no-gist] [short-name]` — Creates a GitHub issue from local run telemetry. By default, uploads the full log as a secret GitHub gist and links it in the issue body. Use --no-gist to inline the log directly.
- `phax completions <shell>` — Generate a shell completion script (zsh, bash, fish, nu, powershell). Requires the usage CLI.
- `phax resume [FLAGS] <short-name>` — Picks up a run from its next pending phase, re-entering the same execution loop as phax run. Prompts for confirmation before proceeding unless --yes is set.
- `phax reset-phase [FLAGS] <short-name> [phase-id]` — Reset a stuck or failed phase so phax resume re-runs it from scratch
- `phax agent <SUBCOMMAND>` — Inspect and manage model routing and provider configuration
- `phax agent models` — Print the routing table and provider priority
- `phax agent resolve <FLAGS>` — Show how a model+effort request resolves to a provider and concrete model
- `phax agent probe` — Check which provider executables are available on PATH; never throws on an unavailable provider
- `phax agent setup <SUBCOMMAND>` — Set up provider integrations
- `phax agent setup mistral-vibe [--dry-run] [--install-model-aliases]` — Append PHAX-owned Mistral Vibe model aliases to ~/.vibe/config.toml (append-only, atomic)
- `phax agent setup providers [FLAGS]` — Reconcile ~/.phax/providers.json enabled flags from live executable probes (dry-run by default)
- `phax security [--verbose] [--trace] <SUBCOMMAND>` — Security-related commands
- `phax security status [--verbose] [--trace]` — Show provider security capabilities and availability
- `phax skills <SUBCOMMAND>` — Manage PHAX skills
- `phax skills install <--target <target>> [--scope <scope>] [skill]` — Install bundled PHAX skills into an agent's native skill directory
- `phax schema <SUBCOMMAND>` — Manage the local phax.schema.json
- `phax schema upgrade` — Regenerate phax.schema.json from the installed binary's config contract; never modifies phax.json

<!-- END GENERATED CLI REFERENCE -->
