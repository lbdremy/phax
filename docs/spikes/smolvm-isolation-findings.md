# smolvm isolation — findings synthesis and go/no-go

This document synthesizes the three probe findings from the smolvm isolation spike
(`spikes/smolvm/findings/01-filesystem.md`, `02-network.md`, `03-agents.md`) into a
single decision document for phax's reserved `isolated` security mode.

> **Provisional.** At the time of writing, every probe's `## Results` and `## Verdict`
> section is empty: the real microVM runs are performed out-of-band per the spike's
> execution-model caveat. The go/no-go below is therefore **conditional on the
> hard-coded-IP egress case (`02-network.sh`, case 3) blocking** when a real run is
> performed. The conclusion section restates that conditionality.

## Per-probe summary

### Probe 01 — Filesystem isolation (`findings/01-filesystem.md`)

The harness boots an Alpine guest with `smolvm machine run --image alpine -v
$WORK_DIR:/workspace` and checks five things: (A) the worktree mount round-trips
between host and guest, (B) the host `$HOME` is invisible, (C) the host repo root is
invisible, (D) the guest `/etc` reflects the Alpine image (not the macOS host), and
(E) a `:ro` mount rejects guest writes.

Expected verdict: **PASS** — the guest is a Linux Alpine rootfs in libkrun, so macOS
host paths like `/Users/` cannot exist except as explicit `-v` mounts. The only
non-obvious result is (E): if smolvm enforces `:ro` at the hypervisor layer, a future
`isolated` mode can mount the worktree read-only and require explicit `allowWrite`
shares. If `:ro` is unenforced, the integration must hand-roll write rejection (e.g.
an overlay) or accept that any mounted path is implicitly writable.

### Probe 02 — Per-domain network allowlist (`findings/02-network.md`) — the decisive probe

The harness exercises a five-case matrix with `--net --allow-host example.com`:

| Case | Test                                       | Decides                                                      |
| ---- | ------------------------------------------ | ------------------------------------------------------------ |
| 1    | Allowed domain by name                     | Egress works at all                                          |
| 2    | Non-allowed domain by name                 | Deny-by-default for unlisted hosts                           |
| 3    | **Non-allowed host by hard-coded IP**      | **Whether `--allow-host` is a real boundary or DNS filter**  |
| 4    | Allowed host by raw IP                     | Enforcement layer (SNI/DNS vs egress filter)                 |
| 5    | ICMP                                       | Behavioural detail (smolvm docs: TCP/UDP only)               |

**Case 3 is the go/no-go signal for the entire spike.** If a guest process can reach a
non-allowed host by hard-coding its IP, the allowlist is a DNS convenience rather than
a security boundary — any agent (or attacker code an agent runs) that ships an IP
literal escapes the constraint. In that case, smolvm is not viable as the foundation
for `isolated` mode without an additional egress layer (e.g. a host-side L4 filter or
an enforced HTTP proxy).

Conversely, if case 3 blocks **and** case 2 blocks, `--allow-host` is a real
deny-by-default egress boundary — the gap that spec-14 identified as unenforceable at
the provider-native layer would finally be closeable.

### Probe 03 — Agents-in-guest (`findings/03-agents.md`)

The harness installs the three provider CLIs (`claude`, `codex`, `vibe`) in an
Alpine guest via `apk add nodejs npm && npm install -g <package>`, injects keys via
`smolvm -e KEY=VALUE`, and runs a trivial "create `hello.txt` in `/workspace`" task
in two configurations: **Step A** with `--net --allow-host <provider-api-domain>` and
**Step B** with no `--net` flag at all (zero egress).

What the synthesis cares about regardless of the per-provider details:

1. **In-guest install.** Step B requires the CLI to already be present in the guest
   image, because `apk` and `npm install` themselves need internet. The harness
   intentionally installs fresh per step so this surfaces as a finding. The
   implication for production `isolated` mode is unambiguous: it needs a **pre-baked
   guest image** with each provider CLI installed, not a live `npm install`.
2. **Denied-egress UX.** The harness's 60s `timeout` wrapper captures whether each
   CLI exits cleanly, times out, or hangs in a retry loop when its API endpoint is
   unreachable. Whatever the per-provider outcome, the design implication is the
   same: the agent must be **told up-front** what it can and cannot reach, or it will
   spend wall-clock retrying behind a wall it can't see (motivating the
   capability-preamble prompt below).
3. **Vibe package name.** `@mistralai/vibe` is unverified in the harness — recorded
   as an open question.

## Go / no-go

**Provisional GO, conditional on probe 02 case 3 blocking.**

The deciding fact is the hard-coded-IP egress test. The other two probes contribute
constraints (read-only mount support, pre-baked image requirement, denial UX) but no
single-fact disqualifier:

- If case 3 **blocks** → `--allow-host` is a real egress boundary. Combined with
  smolvm's deny-by-default `$HOME`/repo-root isolation (probe 01) and confirmed
  in-guest provider execution (probe 03), smolvm is sufficient to back `isolated`
  mode. Proceed to a follow-up implementation plan.
- If case 3 **succeeds** (IP literal escapes the allowlist) → smolvm alone is **not**
  sufficient. The boundary spec-14 identified is still open. Two recoverable options:
  (a) layer a host-side egress filter under smolvm, or (b) require an in-guest HTTP
  proxy and refuse arbitrary outbound sockets. Either is a meaningfully larger build
  than wrapping `smolvm sandbox run`. Stop here and re-scope.

No follow-up implementation plan should be written until the conditional resolves.

## Integration sketch (not for implementation in this spike)

This is the shape a follow-up plan would take. Nothing here is implemented; the
synthesis only fixes terms so a future plan can be written from it without re-reading
the three probe docs.

### Adapter location

A new infrastructure adapter under `src/infra/providers/` (e.g.
`isolatedSandbox.ts`) wraps the existing provider spawn instead of replacing it. The
adapter is selected by the dispatcher when `SecurityPolicy.mode === "isolated"`; for
each provider invocation it:

1. Builds the smolvm argv from the resolved `SecurityPolicy`:
   - `-v <worktreePath>:/workspace[:ro]` from `filesystem.allowRead`/`allowWrite`.
   - `--net --allow-host <domain>` once per allowed domain (provider API + each
     allowed MCP domain — see below). If the resolved policy has no allowed domains,
     omit `--net` entirely (Step B in probe 03).
   - `-e KEY=VALUE` for each provider credential, read from host env.
2. Replaces the inner argv with the existing provider CLI invocation (the same one
   `claudeCode.ts` / `codexCli.ts` / `mistralVibe.ts` already build), but resolved to
   the in-guest path (the pre-baked image installs it at a known location).
3. Streams stdout/stderr back through the existing `Shell` port; the host sees one
   process (smolvm) and the existing telemetry/session capture continues to work.

The stub at `src/cli/commands/run.ts:152-158` (currently rejecting `isolated` mode
with a "planned but not available" message) is the entry point that switches from
rejection to dispatching the wrapped adapter.

### Reuse of `SecurityPolicy`

No new domain type is needed. The existing `SecurityPolicy` in
`src/domain/security/types.ts` already has:

- `filesystem.allowRead` / `filesystem.allowWrite` → `-v` mounts (with `:ro` for
  read-only entries).
- `network.profile` → `--net` toggle; `provider-only` means only the provider API
  domain is allowed.
- `mcp.allow` → see below.
- `agentCommands` → unchanged; the in-guest CLI is one of these.

The `isolated` literal already exists in `SecurityMode` and `SecurityProfileSchema`
(`src/schemas/securityConfig.ts:4`). Removing the stub in `run.ts` and dispatching to
the new adapter is the entire surface-area change at the boundary.

### `secure` vs `isolated` are complementary, not exclusive

`secure` ("agent knows its limits", provider-native) and `isolated` (microVM
enclosure) are layered. `isolated` mode should still spawn each provider CLI with the
same provider-native flags `secure` uses — defence in depth, not either/or. The VM is
the boundary the agent **cannot** see past; the provider-native flags keep the agent
behaving reasonably inside it.

### MCP domain declaration

The VM cannot infer an MCP server's outbound hosts. The follow-up plan must extend
the existing `mcp.allow` config so each entry declares the domains it talks to. The
proposed shape is to widen `McpConfigSchema.allow` from `Array<string>` to
`Array<{ name: string; domains: ReadonlyArray<string> }>` (or a parallel
`mcp.domains` map keyed by `name`, if back-compat with existing configs matters —
schemas in this repo deliberately do not carry back-compat shims, so the wider shape
is preferable). At resolution time, the union of declared domains is added to
`--allow-host`.

If an MCP server in the user's config has no declared domains, `isolated` mode
**refuses to start the run** rather than guess. Silent allow-everything would defeat
the boundary.

### Capability-preamble prompt

Motivated directly by probe 03's denied-egress UX: when the agent has no visibility
into what it can and cannot reach, it wastes wall-clock retrying or hangs. The
adapter must inject — once, at the top of the agent's prompt — a deterministic
preamble describing the sandbox:

> You are running inside a microVM sandbox. You can read and write `/workspace`
> (which is your worktree on the host). You cannot see any other host paths. You can
> make network requests to the following domains only: `<list>`. Any other network
> request will fail. Do not attempt to install packages or reach other hosts; report
> the limitation and proceed with what is available.

The preamble is generated from the same `SecurityPolicy` the adapter uses to build
the smolvm argv, so the prompt and the actual sandbox cannot drift.

## Residual risks

1. **Case 3 may not block.** The entire go/no-go hinges on it. If the real run shows
   `--allow-host` is DNS-name only, this synthesis must be rewritten as a no-go with
   a re-scope.
2. **SNI/DNS bypass surface.** Even if case 3 blocks, if enforcement is SNI-based an
   agent that disables SNI or speaks a non-TLS protocol over the allowed IP could
   bypass the boundary. Case 4 in probe 02 surfaces this; a follow-up plan must
   audit it.
3. **Volume-mount maturity.** Probe 01 case E (`:ro` enforcement) decides whether the
   worktree can be mounted read-only. If unsupported, every mount is implicitly
   writable and `allowRead` cannot be distinguished from `allowWrite` at the VM
   boundary.
4. **Cross-arch guest.** Apple Silicon hosts run an arm64 Linux guest; some provider
   CLIs may not ship arm64 Linux binaries or compatible Node engine versions. A
   pre-baked image is required regardless of architecture; the image-bake recipe
   must be cross-arch.
5. **Boot/perf cost.** Each phase boots a microVM. The spike does not measure this;
   if boot adds multiple seconds per phase, large multi-phase runs may be noticeably
   slower than `secure` mode. Acceptable trade-off, but worth measuring before
   release.
6. **Credential handling.** Keys pass via `-e KEY=VALUE`. Logs and telemetry must
   never echo the values; the existing `agentErrorLog` and session writers in
   `src/infra/providers/` must be audited before `isolated` ships.
7. **Pre-baked image distribution.** `isolated` mode cannot run if the user has no
   image with the provider CLIs installed. The follow-up plan must decide whether
   phax ships an image, builds one on first run, or requires the user to bake one.

## Recommended next step

If probe 02 case 3 **blocks** on the real run:

1. Fill the `## Results` and `## Verdict` of all three probe docs and remove the
   "provisional" marker at the top of this document.
2. Write a follow-up implementation plan (`plan.md`) covering: the new
   `isolatedSandbox` adapter in `src/infra/providers/`, the dispatcher switch on
   `SecurityPolicy.mode === "isolated"`, the widened `mcp.allow` schema, the
   capability-preamble prompt builder, the pre-baked guest image recipe, and an e2e
   test under `pnpm test:e2e:real` that boots a real VM.
3. Remove the stub rejection in `src/cli/commands/run.ts:152-158` only at the end of
   the implementation plan, gated on all of the above.

If probe 02 case 3 **succeeds** (IP literal reaches a non-allowed host):

1. Stop the spike. Update this document's verdict to no-go.
2. Open a follow-up scoping question: is a host-side L4 egress filter under smolvm
   acceptable, or should `isolated` mode be re-scoped to a different sandbox
   technology entirely? No code under `src/` should change until that question is
   resolved.
