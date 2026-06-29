# smolvm Isolation Spike

This directory contains the harness scripts and findings documents for the smolvm
isolation feasibility spike. The goal is to answer three unknowns that decide whether
phax's `isolated` mode should be built on smolvm before writing any production code.

## Context: `isolated` mode in phax

phax ships two security modes: `default` (no constraints) and `secure`
(provider-native guardrails, where the agent knows its limits). A third mode,
`isolated`, is reserved in the CLI and rejected before a run starts. The spec notes
`isolated` is intended for "an external sandbox (smolvm or similar)" — a microVM with
a host-mounted worktree, no `$HOME` access, and a real network allowlist. Separately,
spec-14 established that network allowlisting cannot be enforced at the provider-native
layer. The network boundary the developer actually wants — deny-by-default egress,
allow by domain — is exactly the gap a microVM is meant to fill.

## The three unknowns

### 1. Network — per-domain or per-IP, and is it a real boundary?

smolvm documents hostname allowlisting (`--allow-host` / `allow_hosts = [...]`). We
must confirm it:

- (a) blocks non-allowed domains,
- (b) still blocks a non-allowed host reached by hard-coded **IP** (the decisive test),
- (c) explain the enforcement mechanism (DNS/SNI proxy vs true egress filter).

If a non-allowed IP bypasses the allowlist, the boundary is DNS-name filtering only —
not a security boundary. See `02-network.sh` and `findings/02-network.md`.

### 2. Filesystem — deny-by-default with explicit shares

Confirm the host FS is invisible to the guest, only the mounted worktree is reachable,
host `$HOME` and credentials are not accessible, and whether mounts can be read-only.
See `01-filesystem.sh` and `findings/01-filesystem.md`.

### 3. Agents-in-guest

Confirm Claude Code, Codex, and Mistral Vibe actually run in the libkrun Linux guest
(cross-arch on Apple Silicon), with credentials injected via env, constrained by the
network allowlist — and observe how each agent surfaces a denied egress (this motivates
the capability-preamble prompt in the synthesis). See `03-agents.sh` and
`findings/03-agents.md`.

## Execution-model caveat

Booting a microVM requires host virtualization (Hypervisor.framework / KVM), a real
`smolvm` install, real provider credentials, and a human (or e2e harness) watching
whether egress is actually blocked. A phax phase agent running in a worktree cannot
reliably nest a microVM or self-verify a network escape.

Therefore, for the probe phases, **the agent's mechanical deliverable is the harness
script plus a findings document with an empty `## Results` / `## Verdict` section**;
the real VM run is performed out-of-band and its output is pasted into the findings
doc. Treat the synthesis in `docs/spikes/smolvm-isolation-findings.md` as provisional
until a real run fills in the Results sections.

## How to run

Run the harnesses in order on a host with smolvm installed:

```sh
# 0. Preflight — verify smolvm is installed and report version/backend/arch
sh spikes/smolvm/00-preflight.sh

# 1. Filesystem isolation probe
sh spikes/smolvm/01-filesystem.sh

# 2. Network per-domain allowlist probe
sh spikes/smolvm/02-network.sh

# 3. Agents-in-guest execution probe (requires provider credentials in env)
ANTHROPIC_API_KEY=... OPENAI_API_KEY=... MISTRAL_API_KEY=... \
  sh spikes/smolvm/03-agents.sh
```

After each run, paste the raw output into the `## Results` section of the corresponding
findings doc and fill in the `## Verdict`.

## Synthesis

Once all three probes have been run, the synthesis and go/no-go recommendation is in
`docs/spikes/smolvm-isolation-findings.md`.
