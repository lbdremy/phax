# Security

PHAX applies provider-native execution boundaries to keep agents safe by default. This document describes the security modes, configuration, and how to verify your setup.

## Overview

PHAX supports three security modes:

| Mode       | Description                                                                                                                                                                                         |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `secure`   | Strongest available provider-native sandboxing. Filesystem access limited to worktree and state root, network governed by the `network.profile` (enforced only where the provider supports it — see Provider Capabilities), MCP disabled by default. **This is the default.** |
| `unsafe`   | Host-unrestricted access (legacy behavior). Use with caution.                                                                                                                                       |
| `isolated` | Planned external sandbox mode. Not yet available.                                                                                                                                                   |

## Configuration

Add a `security` block to your `phax.json`:

```json
{
  "version": 1,
  "security": {
    "profile": "secure",
    "filesystem": {
      "allowRead": ["/additional/read/path"],
      "allowWrite": ["/additional/write/path"]
    },
    "network": {
      "profile": "provider-only",
      "allowDomains": ["example.com"]
    },
    "mcp": {
      "mode": "disabled",
      "allow": ["/path/to/mcp-server.json"]
    }
  }
}
```

### Configuration Options

| Field                   | Type                                                                    | Default           | Description                                               |
| ----------------------- | ----------------------------------------------------------------------- | ----------------- | --------------------------------------------------------- |
| `profile`               | `"secure"` \| `"unsafe"` \| `"isolated"`                                | `"secure"`        | The security mode for the run                             |
| `filesystem.allowRead`  | `string[]`                                                              | `[]`              | Additional read paths (added to worktree + state root)    |
| `filesystem.allowWrite` | `string[]`                                                              | `[]`              | Additional write paths (added to worktree + state root)   |
| `network.profile`       | `"provider-only"` \| `"dev-allowlist"` \| `"open"`                      | `"provider-only"` | Network restriction profile                               |
| `network.allowDomains`  | `string[]`                                                              | `[]`              | Additional allowed domains (added to provider API domain) |
| `mcp.mode`              | `"disabled"` \| `"local-only"` \| `"allowlist"` \| `"provider-default"` | `"disabled"`      | MCP access mode                                           |
| `mcp.allow`             | `string[]`                                                              | `[]`              | Paths to MCP server config files passed to the agent via `--mcp-config`. Name-based allowlisting (server names like `"nx-mcp"`) is not supported; phax validates that every entry resolves to a readable file before the run starts. |

### Network Profiles

The profile expresses *intent*; enforcement depends on the provider (see
[Provider Capabilities](#provider-capabilities)). No provider applies per-domain filtering;
Codex is the only one that enforces a hard on/off egress boundary.

- **`provider-only`**: Most conservative. Under Codex this disables subprocess network
  entirely; under Claude/Mistral it is recorded but not enforced as a domain filter.
- **`dev-allowlist`**: Provider API domain plus any configured `allowDomains`, recorded in
  the policy. Under Codex this enables egress; no provider filters to the listed domains.
- **`open`**: No network restrictions (not recommended).

### MCP Modes

- **`disabled`**: MCP is disabled entirely
- **`local-only`**: Only local MCP servers are allowed
- **`allowlist`**: Only MCP servers whose config files are listed in `mcp.allow` (as file paths) can be used
- **`provider-default`**: Use the provider's default MCP behavior

## CLI Override

Override the security mode from the command line:

```bash
phax run --security secure    # default, explicit
phax run --security unsafe    # legacy host-unrestricted behavior
phax run --security isolated  # stubbed: exits with error (not yet available)
```

The CLI flag takes precedence over the configuration file.

## Provider Capabilities

PHAX applies the strongest available provider-native controls for each provider:

| Provider       | Filesystem Jail | Network control                | MCP Allowlist |
| -------------- | --------------- | ------------------------------ | ------------- |
| `claude-code`  | Strong          | None enforced (profile recorded) | Supported   |
| `codex-cli`    | Strong          | On/off (sandbox egress toggle)   | Supported   |
| `mistral-vibe` | Strong          | None                             | Unsupported (MCP off) |

**No provider enforces a domain allowlist.** `network.allowDomains` and the
`dev-allowlist` profile are carried into the policy and recorded in `security.json`, but no
provider applies per-domain filtering today. The only enforced network control is Codex's
sandbox egress toggle: under `provider-only`, Codex sets `network_access=false`, blocking
subprocess network entirely; `dev-allowlist`/`open` set it to `true`. Claude Code has no
native domain-allowlist flag — only `network.profile` is carried — and Mistral Vibe has no
network control at all.

### Provider-Specific Behavior

**Claude Code** (`claude-code`):

- Secure mode runs headless with `--permission-mode acceptEdits` (edits auto-approved within the working dirs, denied outside)
- Filesystem restricted to configured paths via the worktree cwd + `--add-dir`
- No native domain-allowlist flag; `network.profile` is recorded but not enforced as a per-domain filter
- MCP disabled or allowlisted via `--strict-mcp-config`
- Shell is denied by default; only the phase's gate commands are allowlisted (see [Shell command execution](#shell-command-execution))

**Codex CLI** (`codex-cli`):

- Secure mode uses workspace-write sandbox
- Writable roots limited to worktree + state root + configured paths
- Network egress toggled on/off by `network.profile` (`provider-only` → off); no domain allowlist
- Non-escaping approval mode
- Shell runs inside the OS sandbox — any command is permitted but confined (see [Shell command execution](#shell-command-execution))

**Mistral Vibe** (`mistral-vibe`):

- Secure mode confines every Vibe invocation through `VIBE_*` environment variables under `--agent accept-edits`: `VIBE_OUTSIDE_WORKDIR=deny`, `VIBE_BYPASS_TOOL_PERMISSIONS=false` and a `VIBE_TOOLS` JSON naming the permitted tools. phax writes no Vibe config file
- Secure mode never auto-approves and never passes `--trust`, whatever the provider entry's default agent says
- A user's own `config.toml` cannot widen a secure or read-only session: its bypass flag, its `outside_workdir`, bash allowlist entries and file-tool allowlists are overridden per invocation, per tool included
- A Vibe agent profile sits above those variables, so phax checks both sides of a turn. Before it, a secure or read-only session is refused when `$VIBE_HOME/agents/accept-edits.toml` (by default `~/.vibe/agents/accept-edits.toml`) exists: it would replace the built-in agent phax runs. Rename it, for example to `my-accept-edits.toml`, and pick it with `--agent my-accept-edits` in your own sessions. After it, phax reads the config the turn ran with from its `export.json` and refuses the turn's result when the bypass flag, `outside_workdir`, a tool setting phax made, MCP or a read-only turn's enabled tools differ, naming the field in `agent-error.log`. This also catches a resumed session that brought back the agent it last ran with
- The worktree is `--workdir`; each writable root beyond it is one `--add-dir`. Vibe trusts an `--add-dir` root as a project and loads the hooks, agents and tools under its `.vibe/` and `.agents/`, so phax refuses a secure session whose extra writable root already holds either, naming it, and `write_file` and `edit` deny `<root>/.vibe/**` and `<root>/.agents/**` in every root, the worktree included. A repository that tracks its own `.vibe/` config cannot have a phase edit it on Vibe
- A read-only session (a stop's first and closing turns, decide, authoring) runs in the worktree alone, with no `--add-dir`
- MCP servers and connectors are off (`VIBE_ENABLE_MCP=false`, `VIBE_ENABLE_CONNECTORS=false`) when `mcp.mode` is `disabled`, and under `allowlist` too: Vibe cannot load only some servers, so it loads none
- Network controls are unsupported
- Shell tool calls are checked against a prefix allowlist of the phase's agent commands through `VIBE_TOOLS` (see [Shell command execution](#shell-command-execution))
- Vibe 3.0.3 or later is required (`uv tool upgrade mistral-vibe`)
- Recorded as filesystem jail `strong` with command enforcement `prefix`, so secure mode forced to `mistral-vibe` runs the phase on Vibe, not on a Claude Code fallback

Example: with `providerPriority` `[mistral-vibe, claude-code]` in secure mode, the phase runs on Vibe, and its `security.json` shows `"provider": "mistral-vibe"`, `"downgraded": false` and `"marks": []`.

**Accepted loss.** Vibe's enforcement is tool-level: code that an allowed agent command runs can still read outside the roots, as under Claude Code's allowlist.

### Skill edit grants (Claude Code)

Claude Code treats `.claude/` as a protected path and never auto-approves writes there. In a headless secure-mode session nobody can approve the prompt, so edits to `.claude/skills/**` are denied by default.

To let a phase edit skill files:

- List each `.claude/skills/...` file in the phase's planned-file sections (create, edit, or optional).
- Start the run with `phax run --allow-skill-edits`.

The phase, including its fix loop and handoff generation, may then edit or create exactly the declared files. Without the flag, a plan that declares skill files is refused before the run is created (exit code 11), with a message naming the phases and files, so re-running with the flag keeps the plan's run name. `phax resume` has no flag of its own: it inherits the consent recorded in the run's `run-status.json`, and a run without recorded consent is refused again.

**Mechanism.** The Claude adapter passes an inline `--settings` JSON with a `PermissionRequest` hook. There is one handler per declared file and per edit tool (`Edit`, `Write`, `MultiEdit`). Each handler is scoped by an absolute `if` permission rule and echoes an allow decision. The grants are recorded in `security.json` as `skillEditGrants` for every provider. Only the Claude adapter acts on them, because Codex and Vibe do not block `.claude/`. With no grants, the argv is unchanged.

**Not covered:**

- Other `.claude/` paths (`.claude/settings.json`, …) and other protected paths such as `.git` keep today's behavior.
- Undeclared sibling files: a grant covers the exact file, not its directory. Declare every file, including `references/*.md`.
- Glob paths: a declared path containing `*`, `?`, `[`, `]`, `(`, `)`, `{` or `}` is dropped, as are absolute paths and paths with `..`.

**Why not something simpler.** A `permissions.allow` rule such as `Edit(.claude/**)` has no effect, because Claude checks protected paths before it reads allow rules. A `PreToolUse` hook that returns `allow` runs, but the write is still denied. Only a `PermissionRequest` allow unblocks it. Note that `if` matches by tool name, so `Edit(...)` does not match a `Write` call, which is why each file gets one handler per tool.

### Protected paths

Some files of a project record a human decision, and a gate reads them. steme's `steme.baseline.json` is one: `steme audit` exits non-zero on a violated leg unless the baseline accepts it. An agent that cannot fix a hole can write its acceptance into that file, and the gate then passes. A plan's prose is not a boundary, and the write sandbox lets the agent, or any command it runs, write anywhere in the worktree. `protectedPaths` lists the files whose change is the operator's decision, and no phase of a run may land a change to them.

```json
{
  "protectedPaths": ["**/steme.baseline.json"]
}
```

**The key.** `protectedPaths` is a top-level key of `phax.json`: a non-empty list of globs in the dialect `assignments` globs use. A malformed entry exits 2, naming `protectedPaths[N]`. `phax.local.json` and `~/.phax/config.json` may not carry it (exit 2, naming the overlay), and a glob inside a submodule declared in `.gitmodules` is refused, since the submodule's files are not the project's tree. The `phax.json` phax loaded is protected too, by its path relative to the git root (`phax.json`, or `pkg/phax.json` for a nested config), so a phase cannot widen its own boundary. `phax validate` lists the protected paths. A project that declares nothing runs exactly as before.

**Native rules.** Where the provider can refuse the write before it happens, phax asks it to, in secure mode only. The rule is passed for every glob that is a literal path or `**/` followed by one; any other glob gets no native rule.

| Provider       | Native rule                                               | Enforcement                 |
| -------------- | --------------------------------------------------------- | --------------------------- |
| `claude-code`  | `Edit(//…)` deny rules in the inline settings              | `enforced` or `partial`     |
| `mistral-vibe` | `write_file` and `edit` denylist entries                   | `enforced` or `partial`     |
| `codex-cli`    | none                                                      | `commit-check-only`         |
| unsafe mode    | none, on any provider                                     | `commit-check-only`         |

`enforced` means every glob of the list has a native rule, `partial` that some do not. The enforcement is recorded in `security.json` with the protected globs (`protectedPaths`).

**The check is the guarantee.** A native rule only covers a provider's own file tools. The check compares the phase's files with the phase base and runs after every gate attempt in the fix loop, whatever the steps' exit codes. It catches what a native rule misses: a shell command the agent runs, a gate step that writes the file, Codex and unsafe mode, a wildcard glob. It sees a created, edited (a type change included), deleted or renamed path, and the files git does not show: untracked and ignored files, an ignored file forced into the index (`git add -f`) and not committed, a tracked file dropped from the index (`git rm --cached`, read as deleted), and tracked files whose index bits hide an edit. A failed attempt goes through the usual fix loop with a prompt naming each path and the phase base commit, and asking that each be put back to its content there; the result is recorded in `gate-attribution.json`. The cost is that every check in a declaring project walks the base tree and lists every ignored file, `node_modules` included.

**Links fail closed.** The check cannot see through a symbolic link or into a nested repository, so it counts one as a protected change wherever a protected glob could match a path below it: any `**/` glob, or a glob whose leading segments match the link's path or a path above it, letter case ignored. It names a new, retargeted or type-changed symbolic link, and an ignored one, as `symlink`, and a gitlink or an untracked directory that is a repository as `nested-repository`. An ignored symbolic link whose target is inside the worktree, such as a package manager's links under `node_modules`, is let through for a `**/` glob that cannot match across the link's own name (`**/steme.baseline.json`, but not `**/pkg/steme.baseline.json` for a link named `pkg`): every file below it is checked at its real path. One that leads outside the worktree, to its root or into `.phax-context/` is named; a package manager that links into a store outside the project (pnpm's global virtual store, for one) fails every phase under a `**/` glob.

**Prefer literal paths or narrow globs.** A `**/` glob matches at any depth, ignored folders included, and the check counts an ignored file as created. A file a setup or gate command writes there, such as a dependency's own `allow.json` under `node_modules` or a copied `.env`, then fails every phase from its first attempt, with nothing the agent can put back. Write `packages/*/steme.baseline.json` rather than `**/steme.baseline.json` when the files sit at known places.

**Letter case is ignored** on every host: `**/Steme.Baseline.json` protects `steme.baseline.json`, and a path that differs only by case matches the same entry.

**After the commit.** The check also runs where the fix loop does not:

- at a commit-only resume (a phase paused as a failed commit), against the phase base, before anything is committed: a protected change pauses the phase as a failed commit again, naming each path;
- after the handoff turn, at every resume out of a failed handoff, and when a held phase is re-entered at its hold point, against the phase's commit: a protected change pauses the phase as a failed handoff, before the handoff is validated and copied and without a phase record. The run's `lastError` names the paths.

**A stop's close is not checked.** A person who edits a protected file at a declared or held stop changes it on purpose. The change is committed with the stop and listed under `reviewCorrections`, as any other correction: in `file-reconciliation.json` at a declared stop, in `correction-reconciliation.json` at a held one.

**Two ways on after a pause.** `resume-instructions.md` names each path still changed, the commit to put it back from by its hash (the phase base after a gate pause, the phase commit after a handoff pause) with the command that does it for each path (`git checkout <commit> -- <path>`, or removing a created one), and both ways: put each file back in the phase worktree and run `phax resume <run> --yes`, or make the change on the base branch yourself and start a new run. `phax reset-phase` is not a way on: it throws the phase's work away.

**Refusals.** A skill edit grant (`--allow-skill-edits`) on a file a protected glob matches is refused at preflight with exit 11, naming the file and the entry, before any phase runs. A protected list in an overlay or over a submodule is refused as the key above says.

### Shell command execution

The phase prompt and the gate fix-loop both instruct the agent to run the
phase's **gate commands** (the resolved gate profile, e.g. `pnpm typecheck`,
`pnpm test`) to verify — and fix — its own work. How that shell access is
constrained differs by provider, because each provider exposes a different
native control surface. The granularity differs, but in every secure-mode case
the commands run **confined to the worktree**. The allowlisted set is every
step's command in the profile, regardless of its `firing` — terminal steps
still execute at the last phase, so their commands must be allowlisted from
the start:

| Provider       | Shell model in secure mode                                                                                                                                                                                      |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `claude-code`  | **Per-command allowlist.** Bash is denied by default; phax allowlists exactly the gate commands (`--allowedTools "Bash(<cmd>:*)"`). Every other shell command is denied.                                        |
| `codex-cli`    | **OS-sandboxed execution.** Any command may run, but the `workspace-write` sandbox confines writes to the writable roots and the network profile gates egress. There is no per-command allowlist surface.       |
| `mistral-vibe` | **Prefix allowlist.** `VIBE_TOOLS` gives `bash` `permission: ask` with an allowlist equal to the phase's agent commands, so any other call is refused in a headless turn. In the 2026-10-27 probe, chained, outside-the-roots and background calls fell outside the prefixes and were refused; the real-CLI suite (`tests/e2e/vibeSecure.test.ts`) checks each from the stream's tool calls. |

Notes:

- Claude's allowlist is **exact**: a `pnpm format:check` gate permits
  `pnpm format:check`, not `pnpm format`. If a phase needs a sibling command
  (such as a formatter's write variant), add it as its own gate entry.
- Codex permits broader command execution than Claude, but this is **not** a
  filesystem-isolation downgrade — codex keeps a strong OS sandbox. For that reason
  the broader shell surface is documented here rather than emitted as a separate mark.
- Vibe's allowlist is a prefix match, recorded as `prefix` enforcement. It checks the
  call, not what an allowed command goes on to do.

## Security Artifacts

Each phase writes a `security.json` artifact containing:

```json
{
  "version": 2,
  "mode": "secure",
  "provider": "claude-code",
  "sandboxEnabled": true,
  "filesystem": {
    "allowRead": ["/path/to/worktree", "/home/user/.phax"],
    "allowWrite": ["/path/to/worktree", "/home/user/.phax"]
  },
  "network": {
    "profile": "provider-only",
    "allowDomains": ["api.anthropic.com"]
  },
  "mcp": {
    "mode": "disabled",
    "allow": []
  },
  "downgraded": false,
  "marks": [],
  "skillEditGrants": [],
  "providerSkippedForSecurity": [],
  "stop": null
}
```

These artifacts are:

- Written to `<run-path>/<phase-id>/security.json`
- Emitted as `security.policy.applied` semantic telemetry events
- Included in the `final-report.md` under the **Security** section

### A stop's security record

`stop` is `null` for a phase that never stopped. When a person closes a declared or held stop (see [Interactive phases](../README.md#interactive-phases)), the close sets it and changes no other field:

```json
"stop": {
  "cause": "held",
  "personWork": "outside-phax-enforcement",
  "turns": [
    { "turn": "closing-turn-01", "kind": "closing-turn", "narrowing": "read-only-tools", "agentCommands": [] }
  ]
}
```

- `personWork` says that what the person did in the worktree, by hand, with any editor or with any agent, ran outside phax's enforcement. The rest of the file is the posture the builder ran under, which the person's work did not have.
- `turns` names each first and closing turn phax ran, retries included, with the posture it actually ran under: `read-only-tools` on Claude Code, `read-only-sandbox` on codex, and `read-only-tools` on mistral-vibe too (`read_file` and `grep` only, in the worktree alone). Every such turn runs with no agent commands. A Vibe closing turn resumes the builder's session; phax refuses its result if the session ran under another agent than the one phax set.
- `version` moved from 1 to 2. A version-1 file reads as a phase that never stopped, and rewriting it at a close makes it version 2.
- The phase's record carries the file.

### What phax reads from a provider's session store

A close copies the transcript of each session it recorded into the run folder, `<run>/<phase>/interactive-transcripts/<session id>.jsonl`, with mode 0600 in a folder with mode 0700. The copies stay there: they never enter a commit or a record, whatever `records.transcript` says, because a session the person continued ran outside phax's enforcement and may hold secrets they typed. The record carries each transcript's sha256 only.

- **Roots.** `~/.claude` and `~/.codex`, moved by `CLAUDE_CONFIG_DIR` and `CODEX_HOME`. An empty variable counts as unset. phax reads no session from `~/.vibe` or `VIBE_HOME`; it only checks whether `agents/accept-edits.toml` exists there before a confined Vibe session.
- **At closing, phax reads only the transcript file of each recorded session.** Claude Code: `projects/<slug>/<session id>.jsonl`, the slug being the worktree path with every character outside `A-Z a-z 0-9` replaced by `-`. When it misses, phax tries the slug of the worktree's real path (`/var/…` is `/private/var/…` on macOS). When both miss, it lists the names under `projects/` and tries `<name>/<session id>.jsonl` in each. Codex: `sessions/YYYY/MM/DD/rollout-*-<session id>.jsonl`, listing the date directories' names.
- **Mistral Vibe: nothing.** The answer, the session id, the usage and the transcript come from the turn's own stream and from the `export.json` Vibe writes into the turn's `--output-dir`, `<turn>.vibe-export/` beside the stream. A close builds a Vibe session's transcript from the turn streams kept in the phase folder whose first entry carries the session id, so a session the person ran in Vibe's TUI has no transcript.
- **Never read:** a provider's credentials or configuration.
- **Session ids** outside letters, digits, `.`, `_` and `-` are refused before any path is built.

## Final Report Security Section

The `final-report.md` includes a **Security** section with:

- Run-level security mode
- Per-phase security posture table showing:
  - Mode, provider, sandbox status
  - Network profile and allowed domains
  - MCP mode and allowed servers
  - Downgrade status and marks
  - Providers skipped for security reasons
- A **Skill Edit Grants** table listing, per phase, the `.claude/skills/**` files granted by `--allow-skill-edits` (omitted when nothing was granted)

## Verification

Check which providers are installed and their security capabilities:

```bash
phax security status
```

This reports per-provider jail, network, and MCP capabilities from live probes.

## Unsafe Mode Warning

When running in `unsafe` mode, PHAX prints a warning:

```
┌─────────────────────────────────────────────────────────────┐
│                    ⚠️  UNSAFE MODE WARNING                      │
│                                                                  │
│  Running in UNSAFE mode: the agent has HOST-UNRESTRICTED       │
│  access to:                                                        │
│    • Filesystem: full host read/write access                   │
│    • Network: no domain restrictions                             │
│    • MCP: no MCP server restrictions                             │
│    • Commands: can run any shell command                        │
│                                                                  │
│  This is NOT RECOMMENDED for production use.                   │
│  Use --security secure or remove --security unsafe.             │
└─────────────────────────────────────────────────────────────┘
```

## Routing and Security

When `secure` mode is active, providers that cannot satisfy strict security requirements are skipped during routing:

- Claude Code is the guaranteed strong baseline (never filtered)
- Codex CLI is strong and supported
- Mistral Vibe is strong (per-invocation confinement) and runs under strict secure mode

Skipped providers are recorded in `RoutingResolution.skippedForSecurity` and appear in the security artifact and final report.

## Supply-chain and distribution security

The controls above govern the *agent* PHAX runs. PHAX also hardens its own
distribution and dependency surface:

- **Verified binary installs.** The npm wrapper (`@lbdremy/phax`) downloads a
  prebuilt binary from the matching GitHub release on first run. Before the
  binary is made executable or run, the installer fetches the published
  `<name>.sha256` sidecar, recomputes the download's SHA-256, and refuses to run
  — deleting the file — on a fetch failure, malformed checksum, or mismatch. A
  tampered, corrupted, or misdirected release asset can never be executed
  silently (`npm/bin/phax`).
- **Reproducible release checksums.** `scripts/build-binaries.ts` writes a
  `sha256sum`-compatible `<name>.sha256` next to every release binary, and the
  release workflow publishes both. `scripts/security/release-audit.sh`
  re-verifies each binary against its sidecar.
- **npm provenance.** The release job publishes with `npm publish --provenance`,
  producing a signed build-provenance attestation that links the package to the
  workflow run and source commit.
- **No install-time code execution.** The npm wrapper defines no
  `install`/`postinstall` lifecycle scripts; nothing runs on `npm install`
  beyond fetching the verified binary on first invocation.
- **Argument-safe subprocess calls.** Every subprocess PHAX spawns (git, gh, the
  provider CLIs) uses `spawn`/`execFile` with an argv array — never a shell
  string — so there is no shell-interpolation surface. External input is decoded
  through an Effect Schema before it reaches the domain.

## Auditing the codebase (`pnpm audit:security`)

PHAX ships a reusable, dependency-free security-audit toolkit under
`scripts/security/`:

```bash
pnpm audit:security          # deps + secrets + code + release
pnpm audit:security code     # run a single check
```

Reports are written to `dist/security-audit/` (`report.md`, `findings.jsonl`,
and any per-tool output). The process exit code is gated by `FAIL_ON`
(`high` by default; `med` or `none` to widen/disable).

| Check     | What it inspects                                                                                     |
| --------- | ---------------------------------------------------------------------------------------------------- |
| `deps`    | `pnpm audit` (production advisories), lockfile hygiene, optional SBOM                                 |
| `secrets` | committed credentials — `gitleaks` if installed, else a built-in pattern scan                        |
| `code`    | injection / unsafe-exec / architecture-boundary patterns; optional `semgrep` deep pass               |
| `release` | npm publish surface, installer checksum verification, release-binary checksums, Actions pinning, provenance |

Each check uses a professional scanner when present and falls back to a built-in
check otherwise, so a fresh checkout can run the full audit with only `bash`,
`git`, and `pnpm`. Install the optional scanners for deeper coverage:

```bash
brew install gitleaks semgrep osv-scanner syft
```

A reviewed false-positive allowlist for the secret scan lives in `.gitleaks.toml`.
See `scripts/security/README.md` for the full toolkit reference.

## Keeping security high

- **Run the audit in CI.** Add a job that runs `pnpm audit:security` on pull
  requests, plus a weekly schedule to catch newly disclosed advisories against
  unchanged code. Install `gitleaks`/`osv-scanner`/`semgrep` in the runner for
  full depth. Start report-only (`FAIL_ON=none`) and move to `FAIL_ON=high` once
  the tree is clean, so a new CVE surfaces without blocking unrelated work.
- **Keep dependencies fresh.** Enable Dependabot or Renovate for both `pnpm` and
  GitHub Actions. Dev/build tooling (esbuild, vite, vitest) is the largest
  advisory surface; upgrade it promptly and re-run `pnpm audit:security deps`.
- **Complete the tracked hardening follow-ups** in `docs/plans/2607020808-security-hardening-plan.md`:
  pin GitHub Actions to commit SHAs, add `--` separators / tighten
  `BranchNameSchema` in the git adapter, and convert `scripts/docs-cli.ts` to
  `execFileSync`.
- **Re-audit the release before publishing.** Run `pnpm deno:build-binaries`
  then `pnpm audit:security release` to confirm the shipped binaries match their
  checksums and the publish surface is clean.
- **Rotate optional-tool coverage.** Periodically run with `SCAN_HISTORY=1` so
  `gitleaks` sweeps the full git history, not just the working tree.

### Example CI job

Add to `.github/workflows/ci.yml` (report-only to start; drop
`FAIL_ON`/`continue-on-error` once the tree is clean to make it blocking):

```yaml
  security-audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "24"
          cache: "pnpm"
      - run: pnpm install
      - name: Security audit
        run: pnpm audit:security
        env:
          FAIL_ON: none   # report-only until the tree is clean, then make blocking
        continue-on-error: true
```

The toolkit runs with only `bash`/`git`/`pnpm`. For deeper coverage, add steps
that install `gitleaks`, `osv-scanner`, and `semgrep` before the audit (e.g.
the `gitleaks/gitleaks-action`, the `google/osv-scanner-action`, or an asset
download pinned by version) — the toolkit auto-detects and uses them.

## Best Practices

1. **Default to secure**: The default `secure` mode provides the best available protection
2. **Review security artifacts**: Check `security.json` and the Security section in `final-report.md`
3. **Limit additional paths**: Only add necessary paths to `filesystem.allowRead`/`allowWrite`
4. **Use dev-allowlist sparingly**: Prefer `provider-only` network profile
5. **Verify provider capabilities**: Use `phax security status` to confirm your providers support the required controls
6. **Avoid unsafe mode**: Only use `unsafe` for debugging or trusted local development
7. **Audit before releasing**: Run `pnpm audit:security` (and the `release` check after building binaries) as part of the release checklist
