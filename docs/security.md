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
| `mistral-vibe` | Partial         | None                             | Supported   |

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
- **Complete the tracked hardening follow-ups** in `docs/plans/43-security-hardening-plan.md`:
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
