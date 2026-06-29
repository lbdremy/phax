# Plan — smolvm isolation spike (`isolated` mode feasibility)

## Overview

phax already ships a provider-native security mode (`secure`) and reserves a third
mode, **`isolated`**, that the CLI currently rejects before a run starts. The spec
notes `isolated` is held for "an external sandbox (smolvm or similar)" — a microVM
boundary with a host-mounted worktree, no `$HOME` access, and a real network
allowlist. Separately, spec-14 ("remove network controls") already established that
network allowlisting **cannot** be enforced at the provider-native layer. So the
network boundary the developer actually wants — deny-by-default egress, allow by
**domain**, not just IP — is exactly the gap a microVM is meant to fill.

This plan is a **spike**, not a feature. Its job is to answer the three unknowns
that decide whether `isolated`-on-smolvm is worth building, before any production
code is written:

1. **Network — per-domain or per-IP, and is it a real boundary?** smolvm documents
   hostname allowlisting (`--allow-host` / `allow_hosts = [...]`). We must confirm
   it (a) blocks non-allowed domains, (b) still blocks a non-allowed host reached by
   hard-coded **IP**, and (c) understand the enforcement mechanism (DNS/SNI proxy vs
   true egress filter) so we know whether it's a security boundary or a convenience.
2. **Filesystem — deny-by-default with explicit shares.** Confirm the host FS is
   invisible, that only the mounted worktree is reachable, that `$HOME`/creds are not,
   and whether mounts can be read-only.
3. **Agents-in-guest.** Confirm Claude Code, Codex, and Mistral Vibe actually run in
   the libkrun Linux guest (cross-arch on Apple Silicon), with creds injected via env,
   constrained by the network allowlist — and observe how badly each agent behaves
   when it hits a denied egress (this motivates the capability-preamble prompt).

### Execution-model caveat (read before running this plan)

Booting a microVM needs host virtualization (Hypervisor.framework / KVM), a real
`smolvm` install, real provider credentials, and a human (or e2e harness) watching
whether egress is actually blocked. A phax phase agent running in a worktree cannot
reliably nest a microVM or self-verify a network escape. Therefore, for the probe
phases (02–04), **the agent's mechanical deliverable is the harness script plus a
findings document with an empty `## Results` / `## Verdict` section**; the real VM run
is performed out-of-band and its output pasted into the findings doc. The `fast` gate
(`pnpm format` + `pnpm typecheck` + `pnpm test:unit`) verifies the repo still
type-checks and its unit suite stays green — it does **not** prove the isolation
claims. Treat the synthesis (phase-05) as provisional until a real
run fills in the Results sections. This is called out again in each probe phase's
excluded scope and handoff.

### What this spike deliberately does not do

- It does **not** implement `isolated` mode, an adapter, or any change to
  `SecurityPolicy`, the routing layer, or the provider adapters. Those are a follow-up
  plan, gated on a go decision here.
- It does **not** limit CPU/GPU/memory — by decision, only network and filesystem are
  in scope. The harnesses must not assert anything about resource caps.

### Artifacts

All spike artifacts live under `spikes/smolvm/` (harness scripts + raw findings) and a
single synthesis doc under `docs/spikes/`. Nothing under `src/` is touched.

## Required commands

- smolvm

## Required PHAX security configuration changes

This plan requires the following command to be added to `security.agentCommands` in
`phax.json` before running:

- `smolvm`

Without this configuration the preflight check will fail before any agent spawns.
(The provider CLIs and `npx` are invoked **inside** the guest VM, not as host agent
commands, so they do not need to be declared here.)

## phase-01 — Spike scaffold and smolvm preflight {#phase-01-scaffold}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

Stand up the spike harness directory, document the spike's goal and the
execution-model caveat, and write a preflight script that confirms `smolvm` is
installed and reports the version, backend, and host/guest arch it will use.

### Detailed instructions

- Create `spikes/smolvm/README.md` describing: the three unknowns (network/FS/agents),
  the `isolated`-mode context, the execution-model caveat (probes are run out-of-band),
  and how to run each harness in order.
- Create `spikes/smolvm/00-preflight.sh` (POSIX `sh`, `set -eu`): check `smolvm`
  is on `PATH`, print `smolvm --version`, print the resolved VMM backend and host
  arch, and exit non-zero with a clear message if `smolvm` is missing. It must not
  boot a VM.
- Create `spikes/smolvm/findings/TEMPLATE.md`: a findings skeleton with sections
  `## Environment`, `## Procedure`, `## Results` (raw output), `## Verdict` (pass/fail +
  one-line conclusion), `## Open questions`. The probe phases copy this shape.
- Scripts are documentation/harness only; they are not wired into any phax gate or
  `package.json` script.

### Planned files to create

- `spikes/smolvm/README.md`
- `spikes/smolvm/00-preflight.sh`
- `spikes/smolvm/findings/TEMPLATE.md`

### Planned files to edit

- (none)

### Optional files that may be edited

- (none)

### Boundary contracts

None — this phase adds no code under `src/` and crosses no architectural boundary.

### Test strategy

No automated tests. The harness is a shell script exercised by a human; correctness is
"runs and reports preflight status". Do not add unit/integration tests for shell glue.

### Implementation order

README first (states intent), then the preflight script, then the findings template.

### Excluded scope

- Booting any microVM (phases 02–04).
- Any change under `src/`, `phax.json`, or `package.json`.

### Verification

- The project's configured `fast` gate profile in `phax.json` (`pnpm format` +
  `pnpm typecheck` + `pnpm test:unit`). Since this phase adds only `spikes/` files,
  the gate confirms the repo still type-checks and its unit suite stays green — it does
  not exercise the harness. `fast` (not `full`) is chosen deliberately: a spike's
  scaffolding has no architecture/knip/build surface to protect, and `typecheck` still
  covers any TypeScript scaffolding that appears.

### Expected handoff content

- The exact paths created and a one-line description of each.
- Confirmation that `smolvm` was added to `security.agentCommands` (or a note that the
  developer must do so before `phax run`, since preflight would otherwise fail).
- Any deviation from the planned file lists, with the reason.

### Commit subject

chore(spike): scaffold smolvm isolation spike and preflight

### Commit body

Add the spikes/smolvm harness directory: a README stating the three unknowns
(network/filesystem/agents-in-guest) and the execution-model caveat, a preflight
script that verifies a smolvm install and reports backend/arch, and a findings
template. No src/ changes; this is groundwork for the isolation probes.

## phase-02 — Filesystem isolation probe {#phase-02-filesystem}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Author a harness that boots a microVM with a single host directory mounted as the
worktree and proves the host filesystem is otherwise invisible, plus a findings doc to
capture the real run.

### Detailed instructions

- Create `spikes/smolvm/01-filesystem.sh` (`set -eu`) that:
  - creates a throwaway host dir with a sentinel file, mounts it via `-v
    <hostdir>:/workspace`, and from inside the guest confirms `/workspace` shows the
    sentinel and is writable (write-back visible on host).
  - confirms the host `$HOME`, the repo root, and `/etc` host secrets are **not**
    visible inside the guest (probe a few known host paths and assert absence).
  - attempts a read-only mount if smolvm supports one and records whether a guest write
    is rejected; if read-only is unsupported, record that as a finding (it bears on
    `isolated` defaults).
- Create `spikes/smolvm/findings/01-filesystem.md` from the template with the
  procedure filled in and `## Results`/`## Verdict` left for the real run.
- Keep every smolvm flag the script uses documented inline so the synthesis phase can
  cite exact syntax.

### Planned files to create

- `spikes/smolvm/01-filesystem.sh`
- `spikes/smolvm/findings/01-filesystem.md`

### Planned files to edit

- (none)

### Optional files that may be edited

- `spikes/smolvm/README.md`

### Boundary contracts

None.

### Test strategy

No automated tests (shell harness, human-run). The findings `## Verdict` is the signal.

### Implementation order

Harness script, then findings doc referencing it.

### Excluded scope

- Network behavior (phase-03) and agent execution (phase-04).
- Any resource-limit (CPU/mem) assertions — out of scope by decision.

### Verification

- The project's configured `fast` gate profile in `phax.json` (confirms repo health;
  does not run the harness).

### Expected handoff content

- The exact mount flag syntax used and whether read-only mounts are supported.
- Which host paths were probed for absence.
- That `## Results`/`## Verdict` are intentionally unfilled pending a real run.
- Any deviation from the planned file lists, with the reason.

### Commit subject

test(spike): add smolvm filesystem isolation probe

### Commit body

Add a harness that mounts one host dir as /workspace and asserts the rest of the host
FS (HOME, repo root, /etc) is invisible to the guest, plus a read-only-mount check.
Findings doc captures procedure; Results/Verdict are filled from a real run out-of-band
per the spike's execution-model caveat.

## phase-03 — Network per-domain allowlist probe {#phase-03-network}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

The crux of the spike: prove whether smolvm's `--allow-host` is a real egress
boundary and whether it is enforced by **domain** (not just IP). Author the harness
and findings doc.

### Detailed instructions

- Create `spikes/smolvm/02-network.sh` (`set -eu`) that boots with `--net --allow-host
  <one-allowed-domain>` and runs, from inside the guest, this matrix (capturing exit
  codes + output for each):
  1. **Allowed domain reachable** — request the allowed host by name → expect success.
  2. **Non-allowed domain blocked** — request a different host by name → expect
     failure/timeout.
  3. **Non-allowed host by hard-coded IP** — resolve a non-allowed host's IP on the
     host beforehand, pass it in, and request it by raw IP from the guest → expect
     failure. **This is the decisive test:** if it succeeds, the allowlist is DNS-name
     filtering only, not an egress boundary.
  4. **Allowed host by raw IP** — request the allowed host by its IP rather than name →
     record whether it works; reveals whether enforcement is SNI/DNS-based.
  5. **Alternate port / protocol** — note that smolvm docs say TCP/UDP only, no ICMP;
     record an ICMP attempt result for completeness.
- Document, inline, the exact flag/`Smolfile` syntax used (`net = true`, `[network]
  allow_hosts = [...]`).
- Create `spikes/smolvm/findings/02-network.md` from the template. The `## Verdict`
  must answer two explicit questions: "Is egress deny-by-default?" and "Is the
  allowlist a security boundary or DNS convenience?" — both left for the real run.

### Planned files to create

- `spikes/smolvm/02-network.sh`
- `spikes/smolvm/findings/02-network.md`

### Planned files to edit

- (none)

### Optional files that may be edited

- `spikes/smolvm/README.md`

### Boundary contracts

None.

### Test strategy

No automated tests (shell harness, human-run). The five-case matrix in the findings
`## Results` is the signal; the `## Verdict` answers the two crux questions.

### Implementation order

Harness with the five-case matrix, then findings doc framing the two crux questions.

### Excluded scope

- Agent execution (phase-04) — this phase uses plain `curl`/`wget`, not the AI CLIs.
- Any attempt to harden or patch smolvm if a bypass is found — only observe and record.

### Verification

- The project's configured `fast` gate profile in `phax.json` (repo health only).

### Expected handoff content

- The exact `--allow-host` / `allow_hosts` syntax used.
- The five test cases and that their Results/Verdict await a real run.
- A clear statement that the hard-coded-IP case (3) is the go/no-go signal for the
  network boundary, feeding phase-05.
- Any deviation from the planned file lists, with the reason.

### Commit subject

test(spike): add smolvm per-domain network allowlist probe

### Commit body

Add the decisive network harness: a five-case matrix (allowed-by-name,
denied-by-name, denied-by-hardcoded-IP, allowed-by-IP, ICMP) that determines whether
smolvm's --allow-host is deny-by-default and a real egress boundary versus DNS-name
filtering. Findings doc frames the two crux questions; Results/Verdict filled from a
real run out-of-band.

## phase-04 — Agents-in-guest execution probe {#phase-04-agents}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Confirm the three provider CLIs phax drives actually run inside the libkrun Linux
guest with creds injected by env and constrained by the network allowlist, and
observe how each agent reacts to a denied egress.

### Detailed instructions

- Create `spikes/smolvm/03-agents.sh` (`set -eu`) parameterized over the three
  providers. For each (Claude Code, Codex, Mistral Vibe):
  - boot with `--net --allow-host <provider-api-domain>`, mount a throwaway worktree at
    `/workspace`, inject the provider key via `-e` (read from the host env; the script
    must **not** hard-code or echo secrets).
  - run the CLI non-interactively on a trivial task (e.g. "create `hello.txt` with one
    line") and confirm the file appears on the host side of the mount.
  - then have the same agent attempt to reach a **non-allowed** domain (or observe it
    incidentally) and capture how it surfaces the denial (clear error vs hang vs retry
    loop) — this directly motivates the capability-preamble prompt in phase-05.
  - record guest arch + how the CLI was installed in-guest (`npx`, prebuilt image,
    etc.) since the guest is Linux cross-arch on Apple Silicon.
- Create `spikes/smolvm/findings/03-agents.md` from the template with a per-provider
  results table (runs?/edits worktree?/respects allowlist?/denial UX) left for the run.

### Planned files to create

- `spikes/smolvm/03-agents.sh`
- `spikes/smolvm/findings/03-agents.md`

### Planned files to edit

- (none)

### Optional files that may be edited

- `spikes/smolvm/README.md`

### Boundary contracts

None — the script invokes provider CLIs inside the guest; it does not touch phax's own
provider adapters in `src/infra/`.

### Test strategy

No automated tests. Per-provider findings table is the signal. Secrets come from host
env only and must never be written to the findings doc or committed.

### Implementation order

Parameterized harness, then per-provider findings table.

### Excluded scope

- Wiring any of this into phax's real provider adapters or `SecurityPolicy` (follow-up
  plan).
- Mistral/Codex auth flows beyond a single env-injected key; if a provider needs an
  interactive login, record that as a finding rather than solving it here.

### Verification

- The project's configured `fast` gate profile in `phax.json` (repo health only).

### Expected handoff content

- Per-provider: does the CLI run in-guest, edit the mounted worktree, and stay within
  the allowlist; and how it surfaces a denied egress.
- How each CLI was obtained inside the Linux guest.
- Confirmation no secrets were committed.
- That the results table awaits a real run.
- Any deviation from the planned file lists, with the reason.

### Commit subject

test(spike): add smolvm in-guest agent execution probe

### Commit body

Add a parameterized harness that runs Claude Code, Codex, and Mistral Vibe inside the
libkrun Linux guest with env-injected creds and a per-provider network allowlist,
confirming each edits the mounted worktree and observing denied-egress UX. Secrets are
read from host env only. Per-provider findings table filled from a real run.

## phase-05 — Synthesis and go/no-go recommendation {#phase-05-synthesis}

**Recommended model:** claude-opus-4-8
**Recommended effort:** high

Turn the three probe findings into a single decision document: does smolvm back phax's
`isolated` mode, and if so, what does the integration look like.

### Detailed instructions

- Create `docs/spikes/smolvm-isolation-findings.md` that:
  - summarizes each probe's verdict (FS / network / agents), pulling from the three
    findings docs; if a Results section is still unfilled, state the conclusion is
    provisional and mark it.
  - gives an explicit **go / no-go** on smolvm for `isolated` mode, with the network
    per-domain result (phase-03, case 3) as the deciding factor.
  - sketches the integration **without implementing it**: a new wrapper adapter in
    `src/infra/` that wraps the provider spawn in `smolvm sandbox run` instead of a
    direct CLI spawn; reuse of the existing `SecurityPolicy` (filesystem
    `allowRead`/`allowWrite`, network) and the stubbed `isolated` mode; the
    `secure` (provider-native, "agent knows its limits") layer vs the VM enclosure
    being complementary, not exclusive.
  - specifies the **MCP domain-declaration shape**: since the VM can't infer an MCP
    server's outbound hosts, each allowed MCP server must declare its domains, which map
    to `allow_hosts`. Propose where that declaration lives relative to phax's existing
    `mcp.allow`.
  - specifies the **capability-preamble prompt**: an injected description of what the
    agent can and cannot reach (mounted paths, allowed domains), motivated by the
    denied-egress UX observed in phase-04, so the agent does not flail against VM walls.
  - lists residual risks (SNI/DNS bypass if case 3 failed, volume-mount maturity,
    cross-arch guest, boot/perf cost, cred handling) and recommends the next step:
    either a follow-up `isolated`-implementation plan or stop.
- Optionally link the synthesis from `spikes/smolvm/README.md`.

### Planned files to create

- `docs/spikes/smolvm-isolation-findings.md`

### Planned files to edit

- (none)

### Optional files that may be edited

- `spikes/smolvm/README.md`

### Boundary contracts

Informational only: the synthesis describes the *proposed* contract between a future
`isolated`-mode adapter (`src/infra/`) and the existing `SecurityPolicy` / `isolated`
stub (`src/domain/security/`), but introduces no code crossing it.

### Test strategy

No tests — this is a decision document. The synthesis must be self-contained enough that
the follow-up implementation plan can be written from it without re-reading the three
probe docs.

### Implementation order

Read the three findings docs, then write summary → go/no-go → integration sketch → MCP
& prompt design → risks/next-step, in that order.

### Excluded scope

- Any change under `src/`, `phax.json`, the routing layer, or the provider adapters.
- Writing the follow-up implementation plan itself (that is a separate `plan.md`).

### Verification

- The project's configured `fast` gate profile in `phax.json` (confirms the doc-only
  change leaves the repo green).

### Expected handoff content

- The go/no-go decision and the single fact that drove it.
- A pointer to where a follow-up implementation plan should pick up (adapter location,
  `SecurityPolicy` reuse, `isolated` stub).
- Whether any probe Results were still unfilled, making the decision provisional.
- Any deviation from the planned file lists, with the reason.

### Commit subject

docs(spike): synthesize smolvm isolation findings and go/no-go

### Commit body

Add the synthesis doc: per-probe verdicts (filesystem, per-domain network,
agents-in-guest), an explicit go/no-go on smolvm for phax's isolated mode driven by the
hard-coded-IP egress result, and a non-implementing integration sketch (infra wrapper
adapter, SecurityPolicy reuse, MCP domain declaration, capability-preamble prompt) plus
residual risks and the recommended next step.
