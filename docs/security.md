# Security

PHAX applies provider-native execution boundaries to keep agents safe by default. This document describes the security modes, configuration, and how to verify your setup.

## Overview

PHAX supports three security modes:

| Mode       | Description                                                                                                                                                                                         |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `secure`   | Strongest available provider-native sandboxing. Filesystem access limited to worktree and state root, network restricted to provider API domains, MCP disabled by default. **This is the default.** |
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
      "allow": ["my-trusted-mcp"]
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
| `mcp.allow`             | `string[]`                                                              | `[]`              | Allowed MCP server names/patterns                         |

### Network Profiles

- **`provider-only`**: Only the provider's API domain is allowed (e.g., `api.anthropic.com` for Claude Code)
- **`dev-allowlist`**: Provider API domain plus any configured `allowDomains`
- **`open`**: No network restrictions (not recommended)

### MCP Modes

- **`disabled`**: MCP is disabled entirely
- **`local-only`**: Only local MCP servers are allowed
- **`allowlist`**: Only explicitly allowed MCP servers can be used
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

| Provider       | Filesystem Jail | Network Allowlist | MCP Allowlist |
| -------------- | --------------- | ----------------- | ------------- |
| `claude-code`  | Strong          | Supported         | Supported     |
| `codex-cli`    | Strong          | Supported         | Supported     |
| `mistral-vibe` | Partial         | Unsupported       | Supported     |

### Provider-Specific Behavior

**Claude Code** (`claude-code`):

- Secure mode runs headless with `--permission-mode acceptEdits` (edits auto-approved within the working dirs, denied outside)
- Filesystem restricted to configured paths via the worktree cwd + `--add-dir`
- Network allowlist enforced
- MCP disabled or allowlisted via `--strict-mcp-config`
- Shell is denied by default; only the phase's gate commands are allowlisted (see [Shell command execution](#shell-command-execution))

**Codex CLI** (`codex-cli`):

- Secure mode uses workspace-write sandbox
- Writable roots limited to worktree + state root + configured paths
- Network access governed by allowlist
- Non-escaping approval mode
- Shell runs inside the OS sandbox — any command is permitted but confined (see [Shell command execution](#shell-command-execution))

**Mistral Vibe** (`mistral-vibe`):

- Filesystem isolation is partial (weaker than Claude/Codex)
- Network controls are unsupported
- When secure mode is requested, Vibe is skipped in strict routing unless it's the terminal fallback
- Marked as "partially secured" with appropriate warnings
- Shell tool calls are auto-approved, with no per-command allowlist (see [Shell command execution](#shell-command-execution))

### Shell command execution

The phase prompt and the gate fix-loop both instruct the agent to run the
phase's **gate commands** (the resolved gate profile, e.g. `pnpm typecheck`,
`pnpm test`) to verify — and fix — its own work. How that shell access is
constrained differs by provider, because each provider exposes a different
native control surface. The granularity differs, but in every secure-mode case
the commands run **confined to the worktree**:

| Provider       | Shell model in secure mode                                                                                                                                                                                      |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `claude-code`  | **Per-command allowlist.** Bash is denied by default; phax allowlists exactly the gate commands (`--allowedTools "Bash(<cmd>:*)"`). Every other shell command is denied.                                        |
| `codex-cli`    | **OS-sandboxed execution.** Any command may run, but the `workspace-write` sandbox confines writes to the writable roots and the network profile gates egress. There is no per-command allowlist surface.       |
| `mistral-vibe` | **Approval-policy only.** The `auto-approve` agent permits shell tool calls with no per-command allowlist; isolation rests on the partial filesystem jail (already reflected by the `partial-filesystem` mark). |

Notes:

- Claude's allowlist is **exact**: a `pnpm format:check` gate permits
  `pnpm format:check`, not `pnpm format`. If a phase needs a sibling command
  (such as a formatter's write variant), add it as its own gate entry.
- Codex and Vibe permit broader command execution than Claude, but this is **not**
  a filesystem-isolation downgrade — codex keeps a strong OS sandbox, and Vibe's
  weaker isolation is already surfaced via its security mark. For that reason the
  broader shell surface is documented here rather than emitted as a separate mark.

## Security Artifacts

Each phase writes a `security.json` artifact containing:

```json
{
  "version": 1,
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
  "providerSkippedForSecurity": []
}
```

These artifacts are:

- Written to `<run-path>/<phase-id>/security.json`
- Emitted as `security.policy.applied` semantic telemetry events
- Included in the `final-report.md` under the **Security** section

## Final Report Security Section

The `final-report.md` includes a **Security** section with:

- Run-level security mode
- Per-phase security posture table showing:
  - Mode, provider, sandbox status
  - Network profile and allowed domains
  - MCP mode and allowed servers
  - Downgrade status and marks
  - Providers skipped for security reasons

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
- Mistral Vibe is partial and may be skipped in strict contexts

Skipped providers are recorded in `RoutingResolution.skippedForSecurity` and appear in the security artifact and final report.

## Best Practices

1. **Default to secure**: The default `secure` mode provides the best available protection
2. **Review security artifacts**: Check `security.json` and the Security section in `final-report.md`
3. **Limit additional paths**: Only add necessary paths to `filesystem.allowRead`/`allowWrite`
4. **Use dev-allowlist sparingly**: Prefer `provider-only` network profile
5. **Verify provider capabilities**: Use `phax security status` to confirm your providers support the required controls
6. **Avoid unsafe mode**: Only use `unsafe` for debugging or trusted local development
