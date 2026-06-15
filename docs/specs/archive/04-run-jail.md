# PHAX Spec — Provider-Native Security Mode

## Status

This document specifies the first security hardening layer for PHAX agent execution.

The goal is to make PHAX safer by default without requiring microVM support yet.

This is a functional specification.

It intentionally does not prescribe internal implementation details.

---

# 1. Goal

PHAX runs coding agents that may execute shell commands, edit files, inspect project state, and interact with provider APIs.

Running agents with full host permissions is not an acceptable default.

The default PHAX execution mode must therefore use the strongest available provider-native jail or sandbox for each provider.

PHAX should support three security modes:

```txt
provider-native-secure
  → default mode
  → uses each provider’s own filesystem/network/tool restrictions when available

host-unrestricted
  → unsafe opt-in mode
  → current behavior
  → no jail guarantee

external-sandbox
  → future mode
  → uses smolvm or another VM/container boundary
  → out of scope for this iteration
```

The default is:

```txt
provider-native-secure
```

---

# 2. Product principle

PHAX should assume that agent execution is risky.

Logs and traces are useful, but they are not a security boundary.

Security must be applied before the agent acts, not only audited afterward.

Default rule:

```txt
An agent should only access what it needs for the current phase.
```

For PHAX, the minimum required local access is:

```txt
phase worktree
```

Usually:

```txt
<phase-worktree>
```

Everything else should be denied or unavailable by default when the provider supports that control.

We want user to be able to add more directories, for example for PHAX itself we want to allow access to the PHAX state directory.

```txt
~/.phax
```

---

# 3. Security modes

## 3.1 `provider-native-secure`

This is the default mode.

PHAX uses provider-native restrictions:

```txt
Claude Code
  → Claude Code sandbox and permissions

Codex CLI
  → Codex permission profiles / sandbox

Mistral Vibe
  → workdir/add-dir/tool/MCP restrictions
  → weaker than Claude/Codex until external sandbox exists
```

This mode should fail closed when a provider claims to support required security controls but cannot apply them.

## 3.2 `host-unrestricted`

This is the unsafe mode.

It behaves like the current host execution mode.

The agent runs with the user’s host permissions, subject only to whatever the provider does by default.

This mode must be explicit.

Example intent:

```txt
I understand this gives the agent broad access. Run anyway.
```

PHAX should print a clear warning when this mode is selected.

This mode should never be the default.

## 3.3 `external-sandbox`

This is a future mode.

It will run agents inside a stronger isolation boundary, such as `smolvm`.

This mode is not implemented in this iteration.

It may later provide:

```txt
microVM boundary
host-mounted worktree
controlled network allowlist
mise-based environment setup
aube-based Node package hardening
explicit MCP bridging
```

---

# 4. Default security policy

The default PHAX security policy should be:

```txt
mode:
  provider-native-secure

filesystem:
  allow read/write:
    - current phase worktree
    - ~/.phax (for PHAX itself only)

  deny by default:
    - user home outside ~/.phax
    - ~/.ssh
    - ~/.aws
    - ~/.config
    - ~/.gnupg
    - shell startup files
    - desktop/documents/downloads unless explicitly allowed
    - environment files unless explicitly allowed

network:
  deny by default when provider supports network policy

  allow:
    - current provider API domain
    - optionally other configured provider API domains
    - explicitly configured project domains

MCP:
  disabled or allowlisted by default
```

The default policy should be conservative.

Projects can add required domains or directories explicitly.

---

# 5. Filesystem policy

## 5.1 Allowed paths

PHAX should allow the agent to access:

```txt
phase worktree
```

The phase worktree is where the agent performs code changes.

## 5.2 Denied paths

I think we should have only allow path and by default deny everything else.

---

# 6. Network policy

PHAX should use provider-native network allowlisting when available.

Default network behavior:

```txt
deny all
allow provider API domain required for the selected provider
allow explicitly configured domains
```

Default provider domains:

```txt
Claude Code:
  api.anthropic.com

Codex CLI:
  api.openai.com

Mistral Vibe:
  api.mistral.ai
```

Optional project domains may include:

```txt
registry.npmjs.org
github.com
objects.githubusercontent.com
```

These should not be blindly allowed in the strictest profile.

PHAX should support project-level network profiles:

```txt
provider-only
  → provider API only

dev-allowlist
  → provider API + npm/GitHub/package registries configured by user

open
  → unsafe, explicit opt-in
```

The default should be:

```txt
provider-only
```

unless the phase explicitly needs dependency installation.

---

# 7. MCP policy

MCP must be treated as a separate security surface.

MCP servers can access tools, files, network, credentials, or local processes depending on their implementation.

Default MCP policy:

```txt
disabled unless explicitly allowed
```

Supported conceptual MCP modes:

```txt
disabled
  → no MCP servers available to the agent

local-only
  → only explicitly allowed local MCP servers

allowlist
  → only named allowed MCP servers

provider-default
  → use provider configuration as-is
  → unsafe / advanced mode
```

Default mode:

```txt
disabled
```

or, if too restrictive for a given provider:

```txt
allowlist with an empty list
```

PHAX should make MCP access visible in the run trace.

The trace should include:

```txt
MCP mode
allowed MCP servers
denied MCP servers
transport type when known
```

---

# 8. Claude Code security behavior

Claude Code should use the strongest native policy PHAX can apply.

Default Claude PHAX policy:

```txt
sandbox enabled
fail if sandbox unavailable
allow read/write to worktree
allow read/write to ~/.phax
deny sensitive host paths
network allowlist enabled
MCP disabled or allowlisted
unsandboxed commands disallowed
```

Required product behavior:

```txt
If Claude sandboxing cannot be enabled in provider-native-secure mode, PHAX should not silently continue in unrestricted mode.
```

It should either:

```txt
fail with a clear error
```

or require the user to explicitly select:

```txt
host-unrestricted
```

Claude-specific expectations:

```txt
- filesystem access is limited to the worktree and ~/.phax where possible
- sensitive home paths are denied
- network is limited to allowlisted domains where possible
- MCP servers are disabled or allowlisted
- Bash commands should run sandboxed
- unsandboxed command execution is not allowed by default
```

Claude provider-native mode should be considered strong enough for the first PHAX security iteration.

---

# 9. Codex CLI security behavior

Codex should use permission profiles or its equivalent provider-native sandbox.

Default Codex PHAX policy:

```txt
workspace/write access:
  phase worktree

additional write access:
  ~/.phax

network:
  provider API allowlist by default

MCP:
  disabled or allowlisted

approval:
  non-interactive automation should not silently escape sandbox
```

Required product behavior:

```txt
If Codex cannot enforce the configured permission profile, PHAX should not silently continue in unrestricted mode.
```

It should fail and explain the missing capability.

Codex provider-native mode should be considered strong enough for the first PHAX security iteration when the permission profile is successfully applied.

---

# 10. Mistral Vibe security behavior

Mistral Vibe has weaker provider-native isolation for this use case.

PHAX should still harden Vibe as much as possible.

Default Vibe PHAX policy:

```txt
workdir:
  phase worktree

additional dir:
  ~/.phax only if required

agent:
  PHAX-specific agent or auto-approve with restricted tools

tools:
  allow only required tools

MCP:
  disabled or allowlisted
```

Known limitation:

```txt
Mistral Vibe does not currently provide the same documented native network allowlist and filesystem sandbox controls as Claude Code or Codex.
```

Therefore, in `provider-native-secure` mode, Vibe should be marked as:

```txt
partially secured
```

PHAX should display this clearly.

Example message:

```txt
Mistral Vibe is running with provider-native restrictions, but filesystem/network isolation is weaker than Claude Code or Codex. For stronger isolation, use the future external-sandbox mode.
```

PHAX should not pretend that Vibe has equivalent isolation.

If the user requires strict filesystem/network isolation, PHAX should prefer Claude or Codex, or fail when only Vibe is available.

---

# 11. Security profile selection

PHAX should expose simple security profile names.

Recommended profiles:

```txt
secure
  → default
  → provider-native-secure

unsafe
  → host-unrestricted
  → explicit opt-in

future: isolated
  → external-sandbox
  → not implemented yet
```

Suggested user-facing behavior:

```bash
phax run <short-name>
```

Uses:

```txt
secure
```

Explicit unsafe mode:

```bash
phax run <short-name> --security unsafe
```

This should print a warning.

Future isolated mode:

```bash
phax run <short-name> --security isolated
```

For now, this should report:

```txt
external sandbox mode is planned but not available yet
```

---

# 12. Unsafe mode warning

When `host-unrestricted` / `unsafe` mode is used, PHAX should display a clear warning.

Example:

```txt
WARNING: PHAX is running in host-unrestricted mode.

The agent may be able to access files and network resources using your user permissions.
Logs and traces are not a security boundary.
Use this only for trusted projects or debugging.
```

The user must opt in explicitly.

PHAX should not switch to unsafe automatically if secure setup fails.

---

# 13. Provider fallback and security

Provider fallback must respect security requirements.

Example:

```txt
User provider priority:
  mistral-vibe
  codex-cli
  claude-code

Security:
  secure
  strictFilesystemNetwork = true
```

If Mistral Vibe cannot provide strict filesystem/network enforcement, PHAX should skip it and try Codex or Claude.

Provider priority should not override security requirements unless the user explicitly allows weaker isolation.

PHAX should record:

```txt
provider skipped because security profile could not be satisfied
```

---

# 14. Security capability reporting

PHAX should make provider security visible before and during execution.

A command such as:

```bash
phax security status
```

or provider probe output should show:

```txt
Provider: Claude Code
Filesystem jail: strong
Network allowlist: supported
MCP allowlist: supported
Default PHAX secure mode: supported

Provider: Codex CLI
Filesystem jail: strong
Network allowlist: supported
MCP policy: partially separate
Default PHAX secure mode: supported

Provider: Mistral Vibe
Filesystem jail: partial
Network allowlist: not confirmed / not supported natively
MCP allowlist: supported
Default PHAX secure mode: partial
```

Run logs should record the selected security posture.

---

# 15. Run trace requirements

Each PHAX run should record:

```txt
security mode
provider selected
provider security capabilities
filesystem policy applied
network policy applied
MCP policy applied
whether sandbox was successfully enabled
whether any provider was skipped for security reasons
whether any downgrade to weaker security occurred
```

This should appear in:

```txt
verbose output
trace logs
run status
final report
```

---

# 16. Failure behavior

In default secure mode:

```txt
fail closed
```

PHAX should fail if:

```txt
provider sandbox cannot start
required filesystem restrictions cannot be applied
required network restrictions cannot be applied
MCP policy cannot be enforced when MCP is disabled/allowlisted
provider would silently run unrestricted
```

PHAX should not degrade to unsafe mode automatically.

The user must explicitly choose unsafe mode.

---

# 17. Project configuration

Projects should be able to extend the default security policy.

Example project-level needs:

```txt
allow npm registry
allow GitHub
allow a local MCP server
allow read-only access to another local directory
```

These extensions should be explicit.

Conceptual project config:

```json
{
  "security": {
    "profile": "secure",
    "filesystem": {
      "allowRead": [],
      "allowWrite": []
    },
    "network": {
      "profile": "provider-only",
      "allowDomains": []
    },
    "mcp": {
      "mode": "disabled",
      "allow": []
    }
  }
}
```

Default project config should not grant broad access.

---

# 18. Relation to future smolvm mode

`smolvm` or another external sandbox remains the stronger long-term solution.

Future external sandbox mode may provide:

```txt
microVM isolation
host-mounted worktree
network allow-host policy
no access to user home
mise-based environment setup
aube-based package install hardening
explicit MCP bridge
```

This is out of scope for this iteration.

However, this spec should not block that future.

The provider-native security layer should be designed as the default immediate protection.

The future external sandbox layer should be able to replace or wrap it later.

---

# 19. Acceptance criteria

This feature is complete when:

1. PHAX default execution mode is `secure`.
2. `secure` means provider-native restrictions are applied.
3. PHAX no longer defaults to unrestricted host execution.
4. `unsafe` / host-unrestricted mode exists only as explicit opt-in.
5. PHAX warns clearly before running in unsafe mode.
6. Claude Code runs with sandboxing enabled when selected in secure mode.
7. Claude Code fails closed if sandboxing is required but unavailable.
8. Claude Code limits filesystem access to the phase worktree and `~/.phax` where possible.
9. Claude Code applies a network allowlist where possible.
10. Claude Code disables or allowlists MCP servers.
11. Codex runs with a restrictive permission profile in secure mode.
12. Codex limits filesystem access to the phase worktree and `~/.phax` where possible.
13. Codex applies a network allowlist where possible.
14. Codex does not silently fall back to unrestricted execution.
15. Mistral Vibe uses `--workdir`, restricted additional directories, restricted tools, and MCP allowlisting where possible.
16. Mistral Vibe is clearly marked as partially secured compared to Claude/Codex.
17. Provider fallback respects security requirements.
18. A provider may be skipped if it cannot satisfy the selected security profile.
19. Security posture is visible in verbose output and run traces.
20. The final report records the security mode and applied provider restrictions.
21. Future `external-sandbox` mode is mentioned but not implemented in this iteration.

---

# 20. Product summary

PHAX should be safe by default.

Default:

```txt
secure provider-native jail
```

Explicit unsafe mode:

```txt
host-unrestricted
```

Future mode:

```txt
smolvm external sandbox
```

The core product rule is:

```txt
If PHAX gives an agent permission to execute a phase, PHAX must first apply the strongest available execution boundary for that provider.

If that boundary cannot be applied, PHAX should fail rather than silently run the agent with full host permissions.
```
